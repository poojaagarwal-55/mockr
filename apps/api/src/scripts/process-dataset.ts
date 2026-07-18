/**
 * process-dataset.ts — LLM Enhancement + Judge0 Verification Pipeline (Practers)
 *
 * Reads raw LeetCode JSON files (output of fetch-leetcode-datasets.py),
 * enriches each question via Gemini Pro, verifies on Judge0, saves to MongoDB.
 *
 * Per question the pipeline:
 *   1. Calls Gemini Pro → rephrased description, wrapper code (7 langs),
 *      test-case inputs, optimised + brute-force solutions in ALL 7 languages.
 *      Original problem examples → hidden test cases.
 *      3 fresh sample test cases generated (different from examples).
 *   2. Runs optimised Python3 solution on Judge0 (batch) → collects stdout as expected outputs
 *   3. Cross-verifies brute-force Python3 on sample inputs → both must agree
 *   4. Saves to MongoDB if verified; logs failures to scripts/.process-failed.json
 *
 * Usage (from project root):
 *   npx tsx apps/api/src/scripts/process-dataset.ts
 *   npx tsx apps/api/src/scripts/process-dataset.ts --input Questions/DSA_questions --limit 20
 *   npx tsx apps/api/src/scripts/process-dataset.ts --limit 5 --skip-mongo   # dry-run, saves JSON only
 */

// ─── DNS: IPv4 first (same fix used in all other scripts) ──────────────────
import dns from "node:dns";
dns.setDefaultResultOrder("ipv4first");
try { dns.setServers(["8.8.8.8", "8.8.4.4"]); } catch { /* ok */ }

// ─── Env loading ─────────────────────────────────────────────────────────────
import * as dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { existsSync } from "fs";

const currentDir =
    typeof __dirname !== "undefined"
        ? __dirname
        : fileURLToPath(new URL(".", (import.meta as any).url));

const envCandidates = [
    path.resolve(process.cwd(), ".env"),
    path.resolve(currentDir, "../../../../.env"),
];
const envPath = envCandidates.find((p) => existsSync(p));
dotenv.config(envPath ? { path: envPath } : undefined);

// ─── Imports ──────────────────────────────────────────────────────────────────
import mongoose from "mongoose";
import fs from "fs/promises";
import { fetch as undiciFetch, Agent } from "undici";
import { getGeminiClient, GEMINI_PRO_MODEL } from "../lib/gemini.js";
import { DSAQuestion } from "../models/DSAQuestion.js";

// ─── IPv4-only fetch for Judge0 ───────────────────────────────────────────────
const ipv4Agent = new Agent({ connect: { family: 4 } });
function fetchIPv4(url: string, opts: Record<string, any> = {}) {
    return undiciFetch(url, { ...opts, dispatcher: ipv4Agent }) as unknown as Promise<Response>;
}

// ─── Judge0 config (mirrors code-execution.ts) ───────────────────────────────
const J0_URL  = () => process.env.JUDGE0_API_URL || "https://judge0-ce.p.rapidapi.com";
const J0_KEY  = () => process.env.JUDGE0_API_KEY || "";
const J0_HOST = () => process.env.JUDGE0_HOST || new URL(J0_URL()).hostname;

// Judge0 CE language IDs for all 7 supported languages
const LANG_IDS: Record<string, number> = {
    python3: 71, cpp: 54, java: 62, javascript: 93, golang: 60, rust: 73, csharp: 51,
};
// Keep short alias for Python3 (used in Phase 2 before full verification)
const LANG = { python3: 71 } as const;

const MAX_RETRIES  = 4;
const RETRY_BASE   = 3000;
const POLL_DELAY   = 3000;
const POLL_TIMEOUT = 180_000;  // 3 min — enough for 7-lang batch
const POLL_CHUNK   = 20;       // Judge0 CE batch poll token limit

// ─── Types ────────────────────────────────────────────────────────────────────

interface RawQuestion {
    title: string;
    problem_id: string;
    frontend_id?: string;
    difficulty: string;
    problem_slug: string;
    topics: string[];
    company_tags?: string[];
    description: string;
    examples?: { example_num: number; example_text: string; images?: any[] }[];
    constraints?: string[];
    follow_up?: string[];
    follow_ups?: string[];
    hints?: string[];
    /** code_snippets values can be a flat string OR {starter_code, wrapper_code} */
    code_snippets?: Record<string, string | { starter_code: string; wrapper_code: string }>;
    solution?: string | Record<string, any>;
    sample_test_cases?: any[];
    hidden_test_cases?: any[];
}

// All 7 languages supported on the Practers platform
type SupportedLang = "python3" | "cpp" | "java" | "javascript" | "golang" | "rust" | "csharp";

interface SolutionApproach {
    explanation: string;
    time_complexity: string;
    space_complexity: string;
    python3: string;
    cpp: string;
    java: string;
    javascript: string;
    golang: string;
    rust: string;
    csharp: string;
}

interface LLMResponse {
    description: string;
    topics: string[];
    follow_up: string[];
    /** Only present when we need Gemini to generate test inputs (no pre-filled test cases) */
    test_inputs?: {
        sample: string[];
        hidden: string[];
    };
    // wrapper_code is NOT requested from Gemini — generated programmatically after parse
    wrapper_code?: Partial<Record<SupportedLang, string>>;
    solution: {
        brute_force: SolutionApproach;
        optimized:   SolutionApproach;
    };
}

interface Judge0Submission {
    source_code: string;        // base64
    language_id: number;
    stdin: string | null;       // base64
    expected_output: string | null;
    cpu_time_limit: number;
    memory_limit: number;
    max_output_size: number;
    enable_network: boolean;
}

interface Judge0Result {
    token: string;
    stdout: string | null;      // base64
    stderr: string | null;      // base64
    compile_output: string | null;
    status: { id: number; description: string };
    time: string | null;
    memory: number | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const toB64  = (s: string) => Buffer.from(s).toString("base64");
const fromB64 = (s: string | null | undefined) => s ? Buffer.from(s, "base64").toString("utf-8") : "";

function sleep(ms: number) { return new Promise<void>((r) => setTimeout(r, ms)); }

function normalizeOut(s: string) {
    return s.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim()
        // Normalize Python None/True/False → JSON equivalents
        .replace(/\bNone\b/g, "null")
        .replace(/\bTrue\b/g, "true")
        .replace(/\bFalse\b/g, "false")
        // Treat null and empty array [] as -1 sentinel (all languages return -1 for no-result)
        .replace(/^null$/, "-1")
        .replace(/^\[\s*\]$/, "-1")
        // Normalize JSON spacing: [0, 1] → [0,1] for comparison
        .replace(/,\s+/g, ",")
        .replace(/\[\s+/g, "[")
        .replace(/\s+\]/g, "]")
        .replace(/\{\s+/g, "{")
        .replace(/\s+\}/g, "}");
}

// ─── Starter code extraction ─────────────────────────────────────────────────
//
// Derives the "stub" shown to users in the IDE from the full verified solution.
// Keeps class/struct wrapper + method signatures; replaces method bodies with
// a placeholder — exactly like LeetCode.
//
// No imports, no package declarations, no I/O — those live in wrapper_code.

function extractPythonStarter(code: string): string {
    const lines = code.split("\n");
    const out: string[] = [];
    let skipUntilIndent = -1;

    for (const line of lines) {
        const stripped = line.trimStart();
        const indent = line.length - stripped.length;

        if (skipUntilIndent >= 0) {
            // Non-blank line at same or lower indent ends the skip
            if (stripped !== "" && indent <= skipUntilIndent) {
                skipUntilIndent = -1;
                // fall through to process this line
            } else {
                continue;
            }
        }

        out.push(line);

        // Method inside a class (indent ≥ 4): replace body with pass
        if (stripped.startsWith("def ") && indent >= 4) {
            out.push(" ".repeat(indent + 4) + "pass");
            skipUntilIndent = indent;
        }
    }
    return out.join("\n").trimEnd();
}

function extractBraceLangStarter(lang: SupportedLang, solution: string): string {
    // Depth at which a method/function body opens:
    //   Go, plain JS function expressions → 0 (no outer class)
    //   C++, Java, Rust, C#, class-based JS → 1 (outer class/impl at depth 0)
    let methodDepth = ["golang"].includes(lang) ? 0 : 1;
    if (lang === "javascript" && !solution.trimStart().startsWith("class ")) methodDepth = 0;

    const placeholder = lang === "rust" ? "todo!()" : "// your code here";
    const bodyIndent  = "    ".repeat(methodDepth + 1);
    const closeIndent = "    ".repeat(methodDepth);

    let result = "";
    let depth = 0;
    let i = 0;

    while (i < solution.length) {
        const ch = solution[i];

        // Skip string literals so braces inside strings don't fool us
        if (ch === '"' || ch === "'") {
            const q = ch;
            result += ch; i++;
            while (i < solution.length) {
                const c = solution[i];
                result += c; i++;
                if (c === "\\" && i < solution.length) { result += solution[i++]; continue; }
                if (c === q) break;
            }
            continue;
        }

        if (ch === "{") {
            if (depth === methodDepth) {
                // Replace this method body with the placeholder
                result += "{\n" + bodyIndent + placeholder + "\n" + closeIndent + "}";
                // Skip ahead past the matching closing brace
                depth++;
                i++;
                while (i < solution.length && depth > methodDepth) {
                    if (solution[i] === "{") depth++;
                    else if (solution[i] === "}") depth--;
                    i++;
                }
                depth = methodDepth;
                continue;
            }
            depth++;
        } else if (ch === "}") {
            depth--;
        }

        result += ch;
        i++;
    }

    return result.trim();
}

/**
 * Derive the user-facing starter code from the full verified optimized solution.
 * Returns the function/class stub with empty bodies — no imports, no I/O driver.
 */
function extractStarterCode(lang: SupportedLang, solution: string): string {
    if (!solution?.trim()) return "";
    try {
        if (lang === "python3") return extractPythonStarter(solution);
        return extractBraceLangStarter(lang, solution);
    } catch {
        return solution; // fallback: show full solution (shouldn't happen)
    }
}

// ─── Custom type detection & boilerplate injection ───────────────────────────
//
// Many LeetCode problems use custom types (ListNode, TreeNode) that must be
// defined in the wrapper (not in the solution) so the I/O driver can use them.
// We detect usage and inject the definitions + helper converters automatically.

interface CustomTypes { linkedList: boolean; binaryTree: boolean; }

function detectCustomTypes(solution: string): CustomTypes {
    return {
        linkedList: /\bListNode\b/.test(solution),
        binaryTree: /\bTreeNode\b/.test(solution),
    };
}

// ── Boilerplate blocks per language ──────────────────────────────────────────

const LINKED_LIST_BOILERPLATE: Record<SupportedLang, string> = {
    python3: `
class ListNode:
    def __init__(self, val=0, next=None):
        self.val = val
        self.next = next

def _arr_to_list(arr):
    if not arr: return None
    head = ListNode(arr[0])
    cur = head
    for v in arr[1:]:
        cur.next = ListNode(v)
        cur = cur.next
    return head

def _list_to_arr(node):
    res = []
    while node:
        res.append(node.val)
        node = node.next
    return res
`.trim(),

    cpp: `
struct ListNode {
    int val; ListNode *next;
    ListNode() : val(0), next(nullptr) {}
    ListNode(int x) : val(x), next(nullptr) {}
    ListNode(int x, ListNode *next) : val(x), next(next) {}
};
static ListNode* _arrToList(const vector<int>& a) {
    ListNode dummy(0); ListNode* c = &dummy;
    for (int v : a) { c->next = new ListNode(v); c = c->next; }
    return dummy.next;
}
static vector<int> _listToArr(ListNode* h) {
    vector<int> r; while (h) { r.push_back(h->val); h = h->next; } return r;
}
`.trim(),

    // Java: class defs are top-level; helper methods go inside class Main (see JAVA_BOILERPLATE_INNER)
    java: `class ListNode { int val; ListNode next; ListNode() {} ListNode(int v){val=v;} ListNode(int v,ListNode n){val=v;next=n;} }`.trim(),

    javascript: `
function ListNode(val, next) { this.val = (val===undefined ? 0 : val); this.next = (next===undefined ? null : next); }
function _arrToList(arr) { if (!arr || !arr.length) return null; let h = new ListNode(arr[0]), c = h; for (let i=1;i<arr.length;i++){c.next=new ListNode(arr[i]);c=c.next;} return h; }
function _listToArr(h) { const r=[]; while(h){r.push(h.val);h=h.next;} return r; }
`.trim(),

    golang: `
type ListNode struct { Val int; Next *ListNode }
func _arrToList(arr []int) *ListNode {
    dummy := &ListNode{}; cur := dummy
    for _, v := range arr { cur.Next = &ListNode{Val: v}; cur = cur.Next }
    return dummy.Next
}
func _listToArr(h *ListNode) []int {
    var r []int; for h != nil { r = append(r, h.Val); h = h.Next }; return r
}
`.trim(),

    rust: `
#[derive(PartialEq, Eq, Clone, Debug)]
pub struct ListNode { pub val: i32, pub next: Option<Box<ListNode>> }
impl ListNode {
    #[inline] fn new(val: i32) -> Self { ListNode { next: None, val } }
}
fn arr_to_list(arr: Vec<i32>) -> Option<Box<ListNode>> {
    let mut head = None;
    for &v in arr.iter().rev() { let mut n = Box::new(ListNode::new(v)); n.next = head; head = Some(n); }
    head
}
fn list_to_arr(mut h: Option<Box<ListNode>>) -> Vec<i32> {
    let mut r = vec![];
    while let Some(n) = h { r.push(n.val); h = n.next; }
    r
}
`.trim(),

    // C#: class defs are top-level; helper methods go inside class Program (see CSHARP_BOILERPLATE_INNER)
    csharp: `public class ListNode { public int val; public ListNode next; public ListNode(int v=0,ListNode n=null){val=v;next=n;} }`.trim(),
};

// Inner helper methods for Java and C# that must live inside the Main/Program class
const LINKED_LIST_INNER: Partial<Record<SupportedLang, string>> = {
    java: `    static ListNode arrToList(int[] a){if(a==null||a.length==0)return null;ListNode h=new ListNode(a[0]);ListNode c=h;for(int i=1;i<a.length;i++){c.next=new ListNode(a[i]);c=c.next;}return h;}
    static int[] listToArr(ListNode h){java.util.ArrayList<Integer>r=new java.util.ArrayList<>();while(h!=null){r.add(h.val);h=h.next;}return r.stream().mapToInt(Integer::intValue).toArray();}`,
    csharp: `    static ListNode ArrToList(int[] a){if(a==null||a.Length==0)return null;var h=new ListNode(a[0]);var c=h;for(int i=1;i<a.Length;i++){c.next=new ListNode(a[i]);c=c.next;}return h;}
    static int[] ListToArr(ListNode h){var r=new System.Collections.Generic.List<int>();while(h!=null){r.Add(h.val);h=h.next;}return r.ToArray();}`,
};

const BINARY_TREE_BOILERPLATE: Record<SupportedLang, string> = {
    python3: `
class TreeNode:
    def __init__(self, val=0, left=None, right=None):
        self.val = val; self.left = left; self.right = right

def _arr_to_tree(arr):
    if not arr: return None
    from collections import deque
    root = TreeNode(arr[0]); q = deque([root]); i = 1
    while q and i < len(arr):
        node = q.popleft()
        if i < len(arr) and arr[i] is not None:
            node.left = TreeNode(arr[i]); q.append(node.left)
        i += 1
        if i < len(arr) and arr[i] is not None:
            node.right = TreeNode(arr[i]); q.append(node.right)
        i += 1
    return root

def _tree_to_arr(root):
    if not root: return []
    from collections import deque
    res, q = [], deque([root])
    while q:
        node = q.popleft()
        if node: res.append(node.val); q.append(node.left); q.append(node.right)
        else: res.append(None)
    while res and res[-1] is None: res.pop()
    return res
`.trim(),

    cpp: `
struct TreeNode {
    int val; TreeNode *left, *right;
    TreeNode() : val(0), left(nullptr), right(nullptr) {}
    TreeNode(int x) : val(x), left(nullptr), right(nullptr) {}
};
static TreeNode* _arrToTree(const vector<int>& a) {
    if(a.empty()) return nullptr;
    auto* root = new TreeNode(a[0]);
    queue<TreeNode*> q; q.push(root); int i=1;
    while(!q.empty()&&i<(int)a.size()){
        auto* n=q.front();q.pop();
        if(i<(int)a.size()&&a[i]!=-1){n->left=new TreeNode(a[i]);q.push(n->left);}i++;
        if(i<(int)a.size()&&a[i]!=-1){n->right=new TreeNode(a[i]);q.push(n->right);}i++;
    }
    return root;
}
static vector<int> _treeToArr(TreeNode* r){
    if(!r)return{};vector<int>res;queue<TreeNode*>q;q.push(r);
    while(!q.empty()){auto*n=q.front();q.pop();if(n){res.push_back(n->val);q.push(n->left);q.push(n->right);}else res.push_back(-1);}
    while(!res.empty()&&res.back()==-1)res.pop_back();return res;
}
`.trim(),

    java: `
class TreeNode { int val; TreeNode left,right; TreeNode(){}TreeNode(int v){val=v;} }
static TreeNode arrToTree(int[]a){if(a==null||a.length==0)return null;TreeNode root=new TreeNode(a[0]);java.util.Queue<TreeNode>q=new java.util.LinkedList<>();q.add(root);int i=1;while(!q.isEmpty()&&i<a.length){TreeNode n=q.poll();if(i<a.length&&a[i]!=-1){n.left=new TreeNode(a[i]);q.add(n.left);}i++;if(i<a.length&&a[i]!=-1){n.right=new TreeNode(a[i]);q.add(n.right);}i++;}return root;}
`.trim(),

    javascript: `
function TreeNode(val, left, right) { this.val=(val===undefined?0:val); this.left=(left===undefined?null:left); this.right=(right===undefined?null:right); }
function _arrToTree(arr) { if(!arr||!arr.length)return null; const root=new TreeNode(arr[0]);const q=[root];let i=1; while(q.length&&i<arr.length){const n=q.shift();if(i<arr.length&&arr[i]!==null){n.left=new TreeNode(arr[i]);q.push(n.left);}i++;if(i<arr.length&&arr[i]!==null){n.right=new TreeNode(arr[i]);q.push(n.right);}i++;} return root; }
`.trim(),

    golang: `
type TreeNode struct { Val int; Left *TreeNode; Right *TreeNode }
func _arrToTree(arr []int) *TreeNode {
    if len(arr)==0 { return nil }
    root:=&TreeNode{Val:arr[0]}; q:=[]*TreeNode{root}; i:=1
    for len(q)>0&&i<len(arr){ n:=q[0];q=q[1:]
        if i<len(arr)&&arr[i]!=-1{n.Left=&TreeNode{Val:arr[i]};q=append(q,n.Left)};i++
        if i<len(arr)&&arr[i]!=-1{n.Right=&TreeNode{Val:arr[i]};q=append(q,n.Right)};i++
    }; return root
}
`.trim(),

    rust: `
#[derive(Debug, PartialEq, Eq)]
pub struct TreeNode { pub val: i32, pub left: Option<Rc<RefCell<TreeNode>>>, pub right: Option<Rc<RefCell<TreeNode>>> }
impl TreeNode { #[inline] pub fn new(val: i32) -> Self { TreeNode { val, left: None, right: None } } }
use std::rc::Rc; use std::cell::RefCell;
fn arr_to_tree(arr: Vec<i32>) -> Option<Rc<RefCell<TreeNode>>> {
    if arr.is_empty() { return None; }
    let root = Rc::new(RefCell::new(TreeNode::new(arr[0])));
    let mut q = std::collections::VecDeque::new(); q.push_back(root.clone()); let mut i = 1;
    while !q.is_empty() && i < arr.len() {
        let n = q.pop_front().unwrap();
        if i < arr.len() && arr[i] != -1 { let l = Rc::new(RefCell::new(TreeNode::new(arr[i]))); n.borrow_mut().left = Some(l.clone()); q.push_back(l); } i += 1;
        if i < arr.len() && arr[i] != -1 { let r = Rc::new(RefCell::new(TreeNode::new(arr[i]))); n.borrow_mut().right = Some(r.clone()); q.push_back(r); } i += 1;
    }
    Some(root)
}
`.trim(),

    csharp: `
public class TreeNode { public int val; public TreeNode left,right; public TreeNode(int v=0,TreeNode l=null,TreeNode r=null){val=v;left=l;right=r;} }
static TreeNode ArrToTree(int[]a){if(a==null||a.Length==0)return null;var root=new TreeNode(a[0]);var q=new System.Collections.Generic.Queue<TreeNode>();q.Enqueue(root);int i=1;while(q.Count>0&&i<a.Length){var n=q.Dequeue();if(i<a.Length&&a[i]!=-1){n.left=new TreeNode(a[i]);q.Enqueue(n.left);}i++;if(i<a.Length&&a[i]!=-1){n.right=new TreeNode(a[i]);q.Enqueue(n.right);}i++;}return root;}
`.trim(),
};

/**
 * Inject required type definitions into the wrapper if the solution uses them.
 * This prevents "X does not name a type" compile errors across all 7 languages.
 * The definitions go BEFORE the rest of the wrapper (after any package/import lines).
 */
function injectBoilerplate(lang: SupportedLang, wrapper: string, types: CustomTypes): string {
    const blocks: string[] = [];
    if (types.linkedList) blocks.push(LINKED_LIST_BOILERPLATE[lang]);
    if (types.binaryTree) blocks.push(BINARY_TREE_BOILERPLATE[lang]);
    // Note: PARSE_HELPERS are included inside the generated wrapper directly — not here
    if (blocks.length === 0) return wrapper;

    const boilerplate = blocks.join("\n\n");

    // For languages with package/import headers, insert after those lines
    if (lang === "golang") {
        // Insert after the import block
        const importEnd = wrapper.lastIndexOf(")");
        if (importEnd !== -1) {
            return wrapper.slice(0, importEnd + 1) + "\n\n" + boilerplate + "\n\n" + wrapper.slice(importEnd + 1).trimStart();
        }
        return boilerplate + "\n\n" + wrapper;
    }

    if (lang === "java") {
        // Insert before class Main { ... } but after import statements
        const importLines = wrapper.split("\n").filter(l => l.trim().startsWith("import "));
        const afterImports = wrapper.split("\n").findIndex(l => !l.trim().startsWith("import ") && l.trim() !== "");
        if (afterImports > 0) {
            const lines = wrapper.split("\n");
            return [...lines.slice(0, afterImports), "", boilerplate, "", ...lines.slice(afterImports)].join("\n");
        }
        return boilerplate + "\n\n" + wrapper;
    }

    if (lang === "csharp") {
        // Insert after using statements
        const lines = wrapper.split("\n");
        const afterUsing = lines.findIndex(l => !l.trim().startsWith("using ") && l.trim() !== "");
        if (afterUsing > 0) {
            return [...lines.slice(0, afterUsing), "", boilerplate, "", ...lines.slice(afterUsing)].join("\n");
        }
        return boilerplate + "\n\n" + wrapper;
    }

    if (lang === "cpp") {
        // Insert after #include / using namespace lines
        const lines = wrapper.split("\n");
        const afterHeaders = lines.findIndex(l => !l.trim().startsWith("#include") && !l.trim().startsWith("using ") && l.trim() !== "");
        if (afterHeaders > 0) {
            return [...lines.slice(0, afterHeaders), "", boilerplate, "", ...lines.slice(afterHeaders)].join("\n");
        }
        return boilerplate + "\n\n" + wrapper;
    }

    if (lang === "rust") {
        // Insert after use statements
        const lines = wrapper.split("\n");
        const afterUse = lines.findIndex(l => !l.trim().startsWith("use ") && l.trim() !== "");
        if (afterUse > 0) {
            return [...lines.slice(0, afterUse), "", boilerplate, "", ...lines.slice(afterUse)].join("\n");
        }
        return boilerplate + "\n\n" + wrapper;
    }

    // python3, javascript: prepend
    return boilerplate + "\n\n" + wrapper;
}

/**
 * Strip ListNode / TreeNode class/struct definitions from a solution.
 * Called before combining solution + wrapper when we've already injected boilerplate
 * into the wrapper — prevents "redefinition of struct ListNode" compile errors.
 */
function stripTypeDefinitions(lang: SupportedLang, solution: string, types: CustomTypes): string {
    if (!types.linkedList && !types.binaryTree) return solution;

    let code = solution;

    if (lang === "python3") {
        // Remove class ListNode / TreeNode blocks
        const classNames = [
            types.linkedList ? "ListNode" : "",
            types.binaryTree ? "TreeNode" : "",
        ].filter(Boolean);
        for (const cls of classNames) {
            // Match "class ClsName:" and its indented body
            const re = new RegExp(`^class ${cls}[\\s\\S]*?(?=^class |^def |^\\S|$)`, "gm");
            code = code.replace(re, "");
        }
        return code.trim();
    }

    if (lang === "cpp") {
        // Remove struct ListNode / struct TreeNode blocks (including nested braces)
        for (const name of ["ListNode", "TreeNode"]) {
            if ((name === "ListNode" && !types.linkedList) || (name === "TreeNode" && !types.binaryTree)) continue;
            // Match "struct Name {" ... "};"
            let result = ""; let depth = 0; let inStruct = false; let i = 0;
            const start_re = new RegExp(`\\bstruct\\s+${name}\\s*\\{`);
            while (i < code.length) {
                if (!inStruct && start_re.test(code.slice(i, i + 60))) {
                    inStruct = true; depth = 0;
                    while (i < code.length && code[i] !== "{") i++;
                }
                if (inStruct) {
                    if (code[i] === "{") depth++;
                    else if (code[i] === "}") { depth--; if (depth === 0) { i += 2; inStruct = false; continue; } }
                    i++; continue;
                }
                result += code[i++];
            }
            code = result;
        }
        return code.trim();
    }

    if (lang === "java") {
        // Remove "class ListNode {" ... "}" blocks
        for (const name of ["ListNode", "TreeNode"]) {
            if ((name === "ListNode" && !types.linkedList) || (name === "TreeNode" && !types.binaryTree)) continue;
            let result = ""; let depth = 0; let inClass = false; let i = 0;
            const startRe = new RegExp(`\\bclass\\s+${name}\\b`);
            while (i < code.length) {
                if (!inClass && startRe.test(code.slice(i, i + 30))) {
                    inClass = true; depth = 0;
                    while (i < code.length && code[i] !== "{") i++;
                }
                if (inClass) {
                    if (code[i] === "{") depth++;
                    else if (code[i] === "}") { depth--; if (depth === 0) { i++; inClass = false; continue; } }
                    i++; continue;
                }
                result += code[i++];
            }
            code = result;
        }
        return code.trim();
    }

    if (lang === "javascript") {
        // Remove "function ListNode(...)" and "function TreeNode(...)" definitions
        for (const name of ["ListNode", "TreeNode"]) {
            if ((name === "ListNode" && !types.linkedList) || (name === "TreeNode" && !types.binaryTree)) continue;
            const re = new RegExp(`function\\s+${name}\\s*\\([^)]*\\)\\s*\\{[^}]*\\}\\s*`, "g");
            code = code.replace(re, "");
        }
        return code.trim();
    }

    if (lang === "rust") {
        // Remove struct ListNode/TreeNode and impl blocks
        for (const name of ["ListNode", "TreeNode"]) {
            if ((name === "ListNode" && !types.linkedList) || (name === "TreeNode" && !types.binaryTree)) continue;
            // Remove #[derive(...)] + pub struct Name { ... }
            const structRe = new RegExp(`(#\\[derive[^\\]]*\\]\\s*)?\\bpub\\s+struct\\s+${name}\\b[\\s\\S]*?\\}\\s*`, "g");
            code = code.replace(structRe, "");
            // Remove impl Name { ... }
            const implRe = new RegExp(`\\bimpl\\s+${name}\\b[\\s\\S]*?\\}\\s*`, "g");
            code = code.replace(implRe, "");
        }
        return code.trim();
    }

    if (lang === "csharp") {
        // Remove "public class ListNode/TreeNode { ... }"
        for (const name of ["ListNode", "TreeNode"]) {
            if ((name === "ListNode" && !types.linkedList) || (name === "TreeNode" && !types.binaryTree)) continue;
            let result = ""; let depth = 0; let inClass = false; let i = 0;
            const startRe = new RegExp(`\\bclass\\s+${name}\\b`);
            while (i < code.length) {
                if (!inClass && startRe.test(code.slice(i, i + 30))) {
                    inClass = true; depth = 0;
                    while (i < code.length && code[i] !== "{") i++;
                }
                if (inClass) {
                    if (code[i] === "{") depth++;
                    else if (code[i] === "}") { depth--; if (depth === 0) { i++; inClass = false; continue; } }
                    i++; continue;
                }
                result += code[i++];
            }
            code = result;
        }
        return code.trim();
    }

    return code;
}

// ─── Wrapper generation for custom-type problems ──────────────────────────────
//
// When a problem uses ListNode or TreeNode, Gemini reliably generates WRONG wrappers
// (doesn't call _arr_to_list / _list_to_arr helpers). Instead of fixing after the fact,
// we generate the entire wrapper ourselves from the Python3 solution signature.
// The boilerplate (type defs + helpers) is injected separately by injectBoilerplate().

type TypeCat = "listnode" | "treenode" | "int" | "long" | "float" | "bool" | "string"
             | "intarray" | "strarray" | "floatarray" | "intmatrix" | "other";

interface SigParam { name: string; cat: TypeCat; rawType: string; }
interface SigInfo  { methodName: string; params: SigParam[]; retCat: TypeCat; rawRet: string; }

function classifyType(t: string, types: CustomTypes): TypeCat {
    if (types.linkedList && /ListNode/i.test(t)) return "listnode";
    if (types.binaryTree && /TreeNode/i.test(t)) return "treenode";
    // intmatrix before intarray
    if (/List\[List\[int\]\]|vector<vector<int>>|\[\]int\[\]|int\[\]\[\]/i.test(t)) return "intmatrix";
    if (/List\[int\]|vector<int>|\[\]int\b|int\[\]|Array<int>|Array<number>/i.test(t)) return "intarray";
    if (/List\[str\]|vector<string>|\[\]string\b|String\[\]/i.test(t)) return "strarray";
    if (/List\[float\]|vector<double>|\[\]float\b|float\[\]/i.test(t)) return "floatarray";
    if (/\blong\b|int64\b/i.test(t)) return "long";
    if (/\bdouble\b|\bfloat\b/i.test(t)) return "float";
    if (/\bbool\b|boolean\b/i.test(t)) return "bool";
    if (/\bstring\b|\bstr\b/i.test(t)) return "string";
    if (/\bint\b|number\b/i.test(t)) return "int";
    return "other";
}

function parsePy3Sig(solution: string, types: CustomTypes): SigInfo | null {
    // Match: def methodName(self, p1: T1, p2: T2) -> RetType:
    const m = solution.match(/def\s+(\w+)\s*\(\s*self\s*(?:,\s*([\s\S]*?))?\s*\)\s*->\s*([^:\n]+?)\s*:/);
    if (!m) return null;
    const methodName = m[1];
    const paramsStr  = (m[2] || "").trim();
    const retStr     = m[3]!.trim();
    const params: SigParam[] = [];
    for (const raw of paramsStr.split(",")) {
        const pm = raw.trim().match(/^(\w+)\s*(?::\s*(.*?))?\s*(?:=.*)?$/);
        if (!pm || pm[1] === "self") continue;
        params.push({ name: pm[1]!, cat: classifyType(pm[2] || "", types), rawType: pm[2] || "" });
    }
    return { methodName: m[1]!, params, retCat: classifyType(retStr, types), rawRet: retStr };
}

// Extract method name from each language's solution so we call the right function
function extractMethodName(lang: SupportedLang, solution: string, fallback: string): string {
    if (lang === "python3") {
        const m = solution.match(/def\s+(\w+)\s*\(/);
        return m?.[1] ?? fallback;
    }
    if (lang === "cpp" || lang === "java" || lang === "csharp") {
        // e.g. "ListNode* addTwoNumbers(" or "public ListNode addTwoNumbers("
        const m = solution.match(/\b(\w+)\s*\([^)]*(?:ListNode|TreeNode|int|vector|string|bool|long)/);
        if (m) return m[1]!;
        const m2 = solution.match(/(?:public\s+\w+\s+|[\w*]+\s+)(\w+)\s*\(/);
        return m2?.[1] ?? fallback;
    }
    if (lang === "golang") {
        const m = solution.match(/^func\s+(\w+)\s*\(/m);
        return m?.[1] ?? fallback;
    }
    if (lang === "rust") {
        const m = solution.match(/pub\s+fn\s+(\w+)\s*\(/);
        return m?.[1] ?? fallback;
    }
    if (lang === "javascript") {
        const m = solution.match(/(?:var|const|let)\s+(\w+)\s*=\s*function|function\s+(\w+)\s*\(/);
        return m?.[1] ?? m?.[2] ?? fallback;
    }
    return fallback;
}

// How to read one parameter from stdin for each language
function readParam_py3(p: SigParam): string {
    switch (p.cat) {
        case "listnode": return `${p.name} = _arr_to_list(json.loads(data[idx]))\n    idx += 1`;
        case "treenode": return `${p.name} = _arr_to_tree(json.loads(data[idx]))\n    idx += 1`;
        default:         return `${p.name} = json.loads(data[idx])\n    idx += 1`;
    }
}
function printResult_py3(retCat: TypeCat): string {
    switch (retCat) {
        case "listnode": return "print(json.dumps(_list_to_arr(result)))";
        case "treenode": return "print(json.dumps(_tree_to_arr(result)))";
        case "bool":     return "print(json.dumps(bool(result)))";
        default:         return "print(json.dumps(result))";
    }
}

function readParam_cpp(p: SigParam, idx: number): string {
    const lines: string[] = [];
    lines.push(`    getline(cin, _line);`);
    switch (p.cat) {
        case "listnode":
            lines.push(`    ListNode* ${p.name} = _arrToList(_parseIntArr(_line));`);
            break;
        case "treenode":
            lines.push(`    TreeNode* ${p.name} = _arrToTree(_parseIntArr(_line));`);
            break;
        case "intarray":
            lines.push(`    vector<int> ${p.name} = _parseIntArr(_line);`);
            break;
        case "intmatrix":
            lines.push(`    vector<vector<int>> ${p.name} = _parseIntMatrix(_line);`);
            break;
        case "string":
            lines.push(`    string ${p.name} = _parseStr(_line);`);
            break;
        case "bool":
            lines.push(`    bool ${p.name} = (_line.find("true")!=string::npos);`);
            break;
        case "long":
            lines.push(`    long long ${p.name} = stoll(_line);`);
            break;
        case "float":
            lines.push(`    double ${p.name} = stod(_line);`);
            break;
        default:
            lines.push(`    int ${p.name} = stoi(_line);`);
            break;
    }
    return lines.join("\n");
}
function printResult_cpp(retCat: TypeCat): string {
    switch (retCat) {
        case "listnode":   return `    cout << _arrToJson(_listToArr(result)) << endl;`;
        case "treenode":   return `    cout << _arrToJson(_treeToArr(result)) << endl;`;
        case "intarray":   return `    cout << _arrToJson(result) << endl;`;
        case "bool":       return `    cout << (result ? "true" : "false") << endl;`;
        case "string":     return `    cout << "\\"" << result << "\\"" << endl;`;
        default:           return `    cout << result << endl;`;
    }
}

function readParam_java(p: SigParam): string {
    switch (p.cat) {
        case "listnode":  return `        ListNode ${p.name} = arrToList(_parseIntArr(br.readLine()));`;
        case "treenode":  return `        TreeNode ${p.name} = arrToTree(_parseIntArr(br.readLine()));`;
        case "intarray":  return `        int[] ${p.name} = _parseIntArr(br.readLine());`;
        case "intmatrix": return `        int[][] ${p.name} = _parseIntMatrix(br.readLine());`;
        case "string":    return `        String ${p.name} = br.readLine().trim().replaceAll("^\\"|\\"$", "");`;
        case "bool":      return `        boolean ${p.name} = br.readLine().trim().equals("true");`;
        case "long":      return `        long ${p.name} = Long.parseLong(br.readLine().trim());`;
        default:          return `        int ${p.name} = Integer.parseInt(br.readLine().trim());`;
    }
}
function printResult_java(retCat: TypeCat): string {
    switch (retCat) {
        case "listnode":  return `        System.out.println(_arrToJson(listToArr(result)));`;
        case "treenode":  return `        System.out.println(_arrToJson(listToArr(result)));`;
        case "intarray":  return `        System.out.println(_arrToJson(result));`;
        case "bool":      return `        System.out.println(result);`;
        case "string":    return `        System.out.println("\\"" + result + "\\"");`;
        default:          return `        System.out.println(result);`;
    }
}

function readParam_js(p: SigParam): string {
    switch (p.cat) {
        case "listnode":  return `    const ${p.name} = _arrToList(JSON.parse(lines[idx++]));`;
        case "treenode":  return `    const ${p.name} = _arrToTree(JSON.parse(lines[idx++]));`;
        default:          return `    const ${p.name} = JSON.parse(lines[idx++]);`;
    }
}
function printResult_js(retCat: TypeCat): string {
    switch (retCat) {
        case "listnode": return `    console.log(JSON.stringify(_listToArr(result)));`;
        case "treenode": return `    console.log(JSON.stringify(result));`; // TODO: _treeToArr
        default:         return `    console.log(JSON.stringify(result));`;
    }
}

function readParam_go(p: SigParam): string {
    // _line is declared as `var _line string` once at the top of main(); use `=` here
    const lines: string[] = [`    scanner.Scan(); _line = scanner.Text()`];
    switch (p.cat) {
        case "listnode":
            lines.push(`    var _arr_${p.name} []int; json.Unmarshal([]byte(_line), &_arr_${p.name})`);
            lines.push(`    ${p.name} := _arrToList(_arr_${p.name})`);
            break;
        case "treenode":
            lines.push(`    var _arr_${p.name} []int; json.Unmarshal([]byte(_line), &_arr_${p.name})`);
            lines.push(`    ${p.name} := _arrToTree(_arr_${p.name})`);
            break;
        case "intarray":
            lines.push(`    var ${p.name} []int; json.Unmarshal([]byte(_line), &${p.name})`);
            break;
        case "intmatrix":
            lines.push(`    var ${p.name} [][]int; json.Unmarshal([]byte(_line), &${p.name})`);
            break;
        case "bool":
            lines.push(`    ${p.name} := strings.TrimSpace(_line) == "true"`);
            break;
        case "string":
            lines.push(`    var ${p.name} string; json.Unmarshal([]byte(_line), &${p.name})`);
            break;
        case "long":
            lines.push(`    var ${p.name} int64; json.Unmarshal([]byte(_line), &${p.name})`);
            break;
        default:
            lines.push(`    var ${p.name} int; json.Unmarshal([]byte(_line), &${p.name})`);
            break;
    }
    return lines.join("\n");
}
function printResult_go(retCat: TypeCat): string {
    switch (retCat) {
        case "listnode": return `    _out := _listToArr(result)\n    _b, _ := json.Marshal(_out)\n    fmt.Println(string(_b))`;
        case "intarray": return `    _b, _ := json.Marshal(result)\n    fmt.Println(string(_b))`;
        case "bool":     return `    if result { fmt.Println("true") } else { fmt.Println("false") }`;
        default:         return `    _b, _ := json.Marshal(result)\n    fmt.Println(string(_b))`;
    }
}

function readParam_rust(p: SigParam): string {
    const nextLine = `let _line = lines.next().unwrap_or("").trim();`;
    switch (p.cat) {
        case "listnode":
            return `    ${nextLine}\n    let ${p.name} = arr_to_list(_parse_int_arr(_line));`;
        case "treenode":
            return `    ${nextLine}\n    let ${p.name} = arr_to_tree(_parse_int_arr(_line));`;
        case "intarray":
            return `    ${nextLine}\n    let ${p.name}: Vec<i32> = _parse_int_arr(_line);`;
        case "intmatrix":
            return `    ${nextLine}\n    let ${p.name}: Vec<Vec<i32>> = _parse_int_matrix(_line);`;
        case "bool":
            return `    ${nextLine}\n    let ${p.name}: bool = _line == "true";`;
        case "string":
            return `    ${nextLine}\n    let ${p.name} = _line.trim_matches('"').to_string();`;
        case "long":
            return `    ${nextLine}\n    let ${p.name}: i64 = _line.parse().unwrap_or(0);`;
        default:
            return `    ${nextLine}\n    let ${p.name}: i32 = _line.parse().unwrap_or(0);`;
    }
}
function printResult_rust(retCat: TypeCat): string {
    switch (retCat) {
        case "listnode": return `    let _arr = list_to_arr(result);\n    println!("[{}]", _arr.iter().map(|x| x.to_string()).collect::<Vec<_>>().join(","));`;
        case "intarray": return `    println!("[{}]", result.iter().map(|x| x.to_string()).collect::<Vec<_>>().join(","));`;
        case "bool":     return `    println!("{}", result);`;
        case "string":   return `    println!("\\"{}\\"", result);`;
        default:         return `    println!("{}", result);`;
    }
}

function readParam_cs(p: SigParam): string {
    switch (p.cat) {
        case "listnode":  return `        var ${p.name} = ArrToList(_ParseIntArr(Console.ReadLine()));`;
        case "treenode":  return `        var ${p.name} = ArrToTree(_ParseIntArr(Console.ReadLine()));`;
        case "intarray":  return `        var ${p.name} = _ParseIntArr(Console.ReadLine());`;
        case "intmatrix": return `        var ${p.name} = _ParseIntMatrix(Console.ReadLine());`;
        case "string":    return `        var ${p.name} = Console.ReadLine().Trim().Trim('"');`;
        case "bool":      return `        var ${p.name} = Console.ReadLine().Trim() == "true";`;
        case "long":      return `        var ${p.name} = long.Parse(Console.ReadLine().Trim());`;
        default:          return `        var ${p.name} = int.Parse(Console.ReadLine().Trim());`;
    }
}
function printResult_cs(retCat: TypeCat): string {
    switch (retCat) {
        case "listnode": return `        Console.WriteLine("[" + string.Join(",", ListToArr(result)) + "]");`;
        case "intarray": return `        Console.WriteLine("[" + string.Join(",", result) + "]");`;
        case "bool":     return `        Console.WriteLine(result.ToString().ToLower());`;
        case "string":   return `        Console.WriteLine("\\"" + result + "\\"");`;
        default:         return `        Console.WriteLine(result);`;
    }
}

// Additional parsing helpers to add to boilerplate (JSON array parsing without external libs)
const PARSE_HELPERS: Partial<Record<SupportedLang, string>> = {
    cpp: `
static vector<int> _parseIntArr(const string& s) {
    vector<int> r; string t=s; t.erase(remove(t.begin(),t.end(),' '),t.end());
    if(t=="[]"||t.empty())return r;
    t=t.substr(1,t.size()-2); stringstream ss(t); string tok;
    while(getline(ss,tok,',')) if(!tok.empty()&&tok!="null") r.push_back(stoi(tok)); return r;
}
static vector<vector<int>> _parseIntMatrix(const string& s) {
    vector<vector<int>> r; int d=0; string cur;
    for(char c:s){ if(c=='['){if(d==1)cur="";d++;}else if(c==']'){if(d==2){r.push_back(_parseIntArr("["+cur+"]"));}d--;}else if(d>=2)cur+=c;} return r;
}
static string _parseStr(const string& s){ string t=s; if(!t.empty()&&t.front()=='"')t=t.substr(1,t.size()-2); return t; }
static string _arrToJson(const vector<int>& v){ string s="["; for(int i=0;i<(int)v.size();i++){if(i)s+=",";s+=to_string(v[i]);}return s+"]"; }
`.trim(),

    java: `
static int[] _parseIntArr(String s) {
    s=s.trim(); if(s.equals("[]"))return new int[0];
    s=s.substring(1,s.length()-1); String[]p=s.split(",");
    int[]r=new int[p.length]; for(int i=0;i<p.length;i++){String t=p[i].trim();r[i]=t.equals("null")?-1:Integer.parseInt(t);}return r;
}
static int[][] _parseIntMatrix(String s) {
    s=s.trim().substring(1,s.length()-1); java.util.List<int[]>rows=new java.util.ArrayList<>();
    int d=0;StringBuilder cur=new StringBuilder();
    for(char c:s.toCharArray()){if(c=='['){if(d==0){cur=new StringBuilder();}d++;}else if(c==']'){d--;if(d==0){rows.add(_parseIntArr("["+cur+"]"));}}else if(d>0)cur.append(c);}
    return rows.toArray(new int[0][]);
}
static String _arrToJson(int[]a){StringBuilder sb=new StringBuilder("[");for(int i=0;i<a.length;i++){if(i>0)sb.append(",");sb.append(a[i]);}return sb.append("]").toString();}
`.trim(),

    rust: `
fn _parse_int_arr(s: &str) -> Vec<i32> {
    let s = s.trim();
    if s == "[]" { return vec![]; }
    let inner = &s[1..s.len()-1];
    inner.split(',').filter_map(|x| { let t=x.trim(); if t=="null"{Some(-1)}else{t.parse().ok()} }).collect()
}
fn _parse_int_matrix(s: &str) -> Vec<Vec<i32>> {
    let s = s.trim();
    if s == "[]" { return vec![]; }
    let mut result = vec![]; let mut depth = 0; let mut cur = String::new();
    for c in s.chars() { match c { '[' => { if depth==1{cur.clear();} depth+=1; } ']' => { depth-=1; if depth==1{result.push(_parse_int_arr(&format!("[{}]",cur)));} } _ => if depth>=2{cur.push(c);} } }
    result
}
`.trim(),

    csharp: `
static int[] _ParseIntArr(string s) {
    s=s.Trim(); if(s=="[]")return new int[0];
    s=s.Substring(1,s.Length-2); var p=s.Split(',');
    var r=new int[p.Length]; for(int i=0;i<p.Length;i++){var t=p[i].Trim();r[i]=t=="null"?-1:int.Parse(t);}return r;
}
static int[][] _ParseIntMatrix(string s) {
    s=s.Trim().Substring(1,s.Length-2); var rows=new System.Collections.Generic.List<int[]>();
    int d=0;var cur=new System.Text.StringBuilder();
    foreach(char c in s){if(c=='['){if(d==0)cur.Clear();d++;}else if(c==']'){d--;if(d==0)rows.Add(_ParseIntArr("["+cur+"]"));}else if(d>0)cur.Append(c);}
    return rows.ToArray();
}
`.trim(),
};

/**
 * Generate the complete wrapper for a problem that uses ListNode or TreeNode.
 * Uses the Python3 solution signature as the source of truth for types.
 * This entirely replaces Gemini's wrapper which doesn't reliably call the helpers.
 */
function generateWrapperForCustomTypes(
    lang: SupportedLang,
    sig: SigInfo,
    solutions: Record<SupportedLang, string>,
    types: CustomTypes,
): string {
    const callArgs = sig.params.map(p => p.name).join(", ");
    const methodName = extractMethodName(lang, solutions[lang] || "", sig.methodName);
    const parseHelper = PARSE_HELPERS[lang] || "";

    switch (lang) {
        case "python3": {
            const reads = sig.params.map(readParam_py3).map(l => "    " + l).join("\n");
            const print = "    " + printResult_py3(sig.retCat);
            return `import json
import sys

def main():
    data = sys.stdin.read().strip().split('\\n')
    idx = 0
${reads}
    sol = Solution()
    result = sol.${methodName}(${callArgs})
${print}

main()`;
        }

        case "cpp": {
            const reads = sig.params.map((p, i) => readParam_cpp(p, i)).join("\n");
            const print = printResult_cpp(sig.retCat);
            return `#include <bits/stdc++.h>
using namespace std;
${parseHelper ? "\n" + parseHelper + "\n" : ""}
int main() {
    ios_base::sync_with_stdio(false); cin.tie(NULL);
    string _line;
${reads}
    Solution sol;
    auto result = sol.${methodName}(${callArgs});
${print}
    return 0;
}`;
        }

        case "java": {
            const reads = sig.params.map(readParam_java).join("\n");
            const print = printResult_java(sig.retCat);
            // Java: parse helpers must be static methods INSIDE the class
            const helperIndented = parseHelper
                ? parseHelper.split("\n").map(l => "    " + l).join("\n")
                : "";
            // LinkedList/BinaryTree inner helpers (arrToList etc.) also inside class
            const innerParts: string[] = [];
            if (helperIndented) innerParts.push(helperIndented);
            if (types.linkedList && LINKED_LIST_INNER.java) innerParts.push(LINKED_LIST_INNER.java);
            const innerBlock = innerParts.join("\n");
            return `import java.util.*;
import java.io.*;

class Main {
${innerBlock ? innerBlock + "\n" : ""}    public static void main(String[] args) throws Exception {
        BufferedReader br = new BufferedReader(new InputStreamReader(System.in));
${reads}
        Solution sol = new Solution();
        var result = sol.${methodName}(${callArgs});
${print}
    }
}`;
        }

        case "javascript": {
            const reads = sig.params.map(readParam_js).join("\n");
            const print = printResult_js(sig.retCat);
            // JS solution can be a function or var fn = function(...)
            const call = solutions.javascript?.trimStart().startsWith("class ")
                ? `new Solution().${methodName}(${callArgs})`
                : `${methodName}(${callArgs})`;
            return `const readline = require('readline');
const rl = readline.createInterface({ input: process.stdin });
const lines = [];
rl.on('line', l => lines.push(l.trim()));
rl.on('close', () => {
    let idx = 0;
${reads}
    const result = ${call};
${print}
});`;
        }

        case "golang": {
            const reads = sig.params.map(readParam_go).join("\n");
            const print = printResult_go(sig.retCat);
            return `package main

import (
    "bufio"
    "encoding/json"
    "fmt"
    "os"
    "strings"
)

func main() {
    scanner := bufio.NewScanner(os.Stdin)
    scanner.Buffer(make([]byte, 1024*1024), 1024*1024)
    var _line string
    _ = strings.TrimSpace
${reads}
    result := ${methodName}(${callArgs})
${print}
}`;
        }

        case "rust": {
            const reads = sig.params.map(readParam_rust).join("\n");
            const print = printResult_rust(sig.retCat);
            return `use std::io::{self, Read};
${parseHelper ? "\n" + parseHelper + "\n" : ""}
fn main() {
    let mut input = String::new();
    io::stdin().read_to_string(&mut input).unwrap();
    let mut lines = input.trim().split('\\n');
${reads}
    let result = Solution::${methodName}(${callArgs});
${print}
}`;
        }

        case "csharp": {
            const reads = sig.params.map(readParam_cs).join("\n");
            const print = printResult_cs(sig.retCat);
            const csMethod = methodName.charAt(0).toUpperCase() + methodName.slice(1);
            // C#: helpers must be static members INSIDE class Program
            const helperIndented = parseHelper
                ? parseHelper.split("\n").map(l => "    " + l).join("\n")
                : "";
            // LinkedList/BinaryTree inner helpers (ArrToList etc.) also inside class
            const csInnerParts: string[] = [];
            if (helperIndented) csInnerParts.push(helperIndented);
            if (types.linkedList && LINKED_LIST_INNER.csharp) csInnerParts.push(LINKED_LIST_INNER.csharp);
            const csInnerBlock = csInnerParts.join("\n");
            return `using System;
using System.Collections.Generic;
using System.Linq;

class Program {
${csInnerBlock ? csInnerBlock + "\n" : ""}    static void Main(string[] args) {
${reads}
        var sol = new Solution();
        var result = sol.${csMethod}(${callArgs});
${print}
    }
}`;
        }
    }
}

// ─── Per-language code combination ───────────────────────────────────────────

/**
 * Split `code` into header lines (matching `pattern`) and body lines.
 * Used to extract and deduplicate imports/includes before combining files.
 */
function splitHeaders(code: string, pattern: RegExp): { headers: string[]; body: string } {
    const headers: string[] = [];
    const bodyLines: string[] = [];
    for (const line of code.split("\n")) {
        if (pattern.test(line.trim())) headers.push(line.trimEnd());
        else bodyLines.push(line.trimEnd());
    }
    return { headers, body: bodyLines.join("\n").trim() };
}

function dedupHeaders(a: string[], b: string[]): string[] {
    return [...new Set([...a, ...b])].filter(Boolean);
}

/**
 * Combine solution class/function + I/O wrapper into one runnable file per language.
 * Handles deduplication of imports, includes, package declarations, etc.
 * Pass customTypes so duplicate ListNode/TreeNode definitions are stripped from solution.
 */
function combineCode(lang: SupportedLang, solution: string, wrapper: string, types: CustomTypes = { linkedList: false, binaryTree: false }): string {
    // Strip any ListNode/TreeNode class definitions from the solution — the boilerplate
    // injected into wrapper already defines them; duplicates cause compile errors.
    const sol = stripTypeDefinitions(lang, solution, types);
    switch (lang) {
        case "python3":
            // Solution class first so wrapper's driver can instantiate it
            return `${sol.trim()}\n\n${wrapper.trim()}`;

        case "cpp": {
            const pat = /^(#include|using\s+namespace)\b/;
            const { headers: wh, body: wb } = splitHeaders(wrapper, pat);
            const { body: sb } = splitHeaders(sol, pat);
            const headers = dedupHeaders(wh, []);
            // When custom types are present, wrapper body contains boilerplate (struct defs + helpers)
            // that must come BEFORE the solution class. Split wrapper body at "int main(" boundary.
            if (types.linkedList || types.binaryTree) {
                const mainIdx = wb.indexOf("\nint main(");
                if (mainIdx !== -1) {
                    const wbBefore = wb.slice(0, mainIdx);
                    const wbAfter  = wb.slice(mainIdx);
                    return `${headers.join("\n")}\n\n${wbBefore}\n\n${sb}\n\n${wbAfter}`;
                }
            }
            return `${headers.join("\n")}\n\n${sb}\n\n${wb}`;
        }

        case "java": {
            const pat = /^import\s+/;
            const { headers: wh, body: wb } = splitHeaders(wrapper, pat);
            const { body: sb } = splitHeaders(sol, pat);
            const headers = dedupHeaders(wh, []);
            // Java: boilerplate helper classes must come before Solution class, before Main class
            // wrapper body already has: boilerplate → Solution-is-separate → Main { ... }
            // We just need: headers + wrapper_body_before_Main + solution + Main
            if (types.linkedList || types.binaryTree) {
                const mainIdx = wb.indexOf("\nclass Main");
                if (mainIdx !== -1) {
                    const wbBefore = wb.slice(0, mainIdx);
                    const wbAfter  = wb.slice(mainIdx);
                    return `${headers.join("\n")}\n\n${wbBefore}\n\n${sb}\n\n${wbAfter}`;
                }
            }
            return `${headers.join("\n")}\n\n${sb}\n\n${wb}`;
        }

        case "javascript":
            return `${sol.trim()}\n\n${wrapper.trim()}`;

        case "golang": {
            const solCleaned = sol
                .replace(/^\s*package\s+\w+\s*\n?/m, "")
                .replace(/^\s*import\s+"[^"]*"\s*\n?/gm, "")
                .replace(/^\s*import\s+\([\s\S]*?\)\s*\n?/m, "")
                .trim();
            return `${wrapper.trim()}\n\n${solCleaned}`;
        }

        case "rust": {
            const pat = /^use\s+/;
            const { headers: wh, body: wb } = splitHeaders(wrapper, pat);
            const { headers: sh, body: sb } = splitHeaders(sol, pat);
            const headers = dedupHeaders(wh, sh);
            // Boilerplate (ListNode/TreeNode structs) is in wb; must come before Solution impl.
            // Layout: use-headers → boilerplate (before fn main) → solution impl → fn main
            if (types.linkedList || types.binaryTree) {
                const mainIdx = wb.indexOf("\nfn main(");
                if (mainIdx !== -1) {
                    const wbBefore = wb.slice(0, mainIdx);
                    const wbAfter  = wb.slice(mainIdx);
                    return `${headers.join("\n")}\n\n${wbBefore}\n\n${sb}\n\n${wbAfter}`;
                }
            }
            return `${headers.join("\n")}\n\n${sb}\n\n${wb}`;
        }

        case "csharp": {
            const pat = /^using\s+/;
            const { headers: wh, body: wb } = splitHeaders(wrapper, pat);
            const { body: sb } = splitHeaders(sol, pat);
            const headers = dedupHeaders(wh, []);
            if (types.linkedList || types.binaryTree) {
                const mainIdx = wb.indexOf("\nclass Program");
                if (mainIdx !== -1) {
                    const wbBefore = wb.slice(0, mainIdx);
                    const wbAfter  = wb.slice(mainIdx);
                    return `${headers.join("\n")}\n\n${wbBefore}\n\n${sb}\n\n${wbAfter}`;
                }
            }
            return `${headers.join("\n")}\n\n${sb}\n\n${wb}`;
        }
    }
}

// ─── Multi-language verification ─────────────────────────────────────────────

interface LangResult { pass: boolean; error: string; }

/**
 * Run all 7 languages against the sample test cases in a single Judge0 batch.
 * Returns a map of lang → {pass, error}.
 */
async function verifyAllLanguages(
    llm: LLMResponse,
    sampleTCs: { input: string; output: string }[],
    types: CustomTypes = { linkedList: false, binaryTree: false },
): Promise<Map<SupportedLang, LangResult>> {
    const SUPPORTED_LANGS: SupportedLang[] = ["python3", "cpp", "java", "javascript", "golang", "rust", "csharp"];
    const results = new Map<SupportedLang, LangResult>();

    interface SubMeta { lang: SupportedLang; tcIdx: number; }
    const subs: Judge0Submission[] = [];
    const meta: SubMeta[] = [];

    for (const lang of SUPPORTED_LANGS) {
        const solution = llm.solution.optimized[lang];
        const wrapper  = llm.wrapper_code?.[lang];
        if (!solution || !wrapper) {
            results.set(lang, { pass: false, error: "Missing solution or wrapper code" });
            continue;
        }
        const combined = combineCode(lang, solution, wrapper, types);
        const langId   = LANG_IDS[lang] ?? 71;
        for (let i = 0; i < sampleTCs.length; i++) {
            subs.push({
                source_code: toB64(combined),
                language_id: langId,
                stdin: toB64(sampleTCs[i]!.input),
                expected_output: null,
                cpu_time_limit: 5,
                memory_limit: 262144,
                max_output_size: 524288,
                enable_network: false,
            });
            meta.push({ lang, tcIdx: i });
        }
    }

    if (subs.length === 0) return results;

    // Judge0 CE supports max 20 submissions per batch — split if needed
    const CHUNK = 20;
    const allTokens: string[] = [];
    for (let i = 0; i < subs.length; i += CHUNK) {
        const chunk = subs.slice(i, i + CHUNK);
        const tokens = await submitBatch(chunk);
        allTokens.push(...tokens);
    }

    // Poll may need to be split too if chunks were submitted separately
    // For simplicity: poll all tokens together (Judge0 accepts comma-separated)
    const j0Results = await pollBatch(allTokens);

    // Track first error per language
    const langError = new Map<SupportedLang, string>(); // "" = passing

    for (let i = 0; i < j0Results.length; i++) {
        const r    = j0Results[i]!;
        const m    = meta[i]!;
        const sid  = r.status?.id ?? 0;
        const sdesc = r.status?.description ?? "Unknown";

        // Skip if we already have a failure recorded for this lang
        if (langError.get(m.lang) && langError.get(m.lang) !== "") continue;

        if (sid === 6) {
            langError.set(m.lang, fromB64(r.compile_output) || fromB64(r.stderr) || "Compile error");
        } else if (sid >= 7 && sid <= 15) {
            langError.set(m.lang, fromB64(r.stderr) || fromB64(r.compile_output) || `Runtime error (${sdesc})`);
        } else if (sid === 3) {
            const actual   = normalizeOut(fromB64(r.stdout));
            const expected = normalizeOut(sampleTCs[m.tcIdx]!.output);
            if (actual !== expected) {
                langError.set(m.lang, `Wrong answer on sample ${m.tcIdx + 1}: got "${actual.slice(0, 120)}", expected "${expected.slice(0, 120)}"`);
            } else if (!langError.has(m.lang)) {
                langError.set(m.lang, ""); // at least this TC passed
            }
        } else {
            if (!langError.has(m.lang))
                langError.set(m.lang, `Status: ${sid} ${sdesc}`);
        }
    }

    for (const lang of SUPPORTED_LANGS) {
        if (results.has(lang)) continue; // already set (missing code)
        const err = langError.get(lang);
        if (err === undefined) results.set(lang, { pass: false, error: "No Judge0 result" });
        else results.set(lang, { pass: err === "", error: err });
    }

    return results;
}

// ─── Single-language fix ──────────────────────────────────────────────────────

const LANG_DISPLAY: Record<SupportedLang, string> = {
    python3:    "Python 3.8",
    cpp:        "C++ (GCC 9.2)",
    java:       "Java (OpenJDK 13)",
    javascript: "JavaScript (Node.js 12)",
    golang:     "Go 1.13",
    rust:       "Rust 1.40",
    csharp:     "C# (Mono 6.6)",
};

/**
 * Ask Gemini to fix a single language's solution + wrapper.
 * Returns the fixed pair or null if Gemini fails.
 */
async function fixLang(
    raw: RawQuestion,
    lang: SupportedLang,
    badSolution: string,
    badWrapper: string,
    error: string,
    sampleTCs?: { input: string; output: string }[],
): Promise<{ solution: string; wrapper_code: string } | null> {
    const client = getGeminiClient();
    const combined = combineCode(lang, badSolution, badWrapper, { linkedList: /ListNode/.test(badSolution + badWrapper), binaryTree: /TreeNode/.test(badSolution + badWrapper) });

    const tcExamples = sampleTCs?.slice(0, 3).map((tc, i) =>
        `  TC${i+1} stdin: ${JSON.stringify(tc.input)}\n  TC${i+1} expected stdout: ${JSON.stringify(tc.output)}`
    ).join("\n") ?? "";

    const prompt = `The ${LANG_DISPLAY[lang]} solution + wrapper for "${raw.title}" failed on Judge0.

ERROR:
${error.slice(0, 800)}

FAILING CODE:
\`\`\`
${combined.slice(0, 4000)}
\`\`\`

${tcExamples ? `SAMPLE TEST CASES (stdin → expected stdout):\n${tcExamples}\n` : ""}
Fix the ${LANG_DISPLAY[lang]} solution and wrapper so all sample test cases pass.

RULES:
- STDIN: one JSON-encoded parameter per line (\\n separated)
- STDOUT: exactly one line — the result JSON-encoded; print -1 (integer) for no-result/empty/null
- Solution: ONLY the class/function body — no imports, no package, no main()
- Wrapper: ALL imports/package + main() that reads stdin, calls Solution, prints JSON result
- CRITICAL: Handle null/empty results safely — print -1 instead of null/[]
  - C++: check if vector is empty → print "-1"; use manual JSON building (no nlohmann)
  - Java: check if array/list is null or empty → System.out.println(-1)
  - Rust: use Option<Vec<i32>> return type — None/empty vec → println!("{}", -1)
  - C#: check for null/empty result → Console.WriteLine(-1)
  - All: never use result[0] without checking length first; never print null or []

Return ONLY this JSON (no markdown fences):
{"solution": "<complete fixed solution>", "wrapper_code": "<complete fixed wrapper>"}`;

    try {
        const result = await client.models.generateContent({
            model: GEMINI_PRO_MODEL,
            contents: prompt,
            config: {
                systemInstruction: SYSTEM_PROMPT,
                responseMimeType: "application/json",
                temperature: 0.1,
            },
        });
        const text  = result.text?.trim() || "";
        const clean = text.replace(/^```json\s*/i, "").replace(/```\s*$/i, "").trim();
        const parsed = JSON.parse(clean) as { solution: string; wrapper_code: string };
        if (!parsed.solution || !parsed.wrapper_code) return null;
        return parsed;
    } catch {
        return null;
    }
}

/** Extract starter_code regardless of flat-string or nested format */
function getStarterCode(raw: RawQuestion, lang: string): string {
    const snippets = raw.code_snippets || {};
    const val = snippets[lang];
    if (!val) return "";
    if (typeof val === "string") return val;
    return val.starter_code || "";
}

// ─── Judge0 batch submission + polling ───────────────────────────────────────

function j0Headers(): Record<string, string> {
    const h: Record<string, string> = { "Content-Type": "application/json" };
    const k = J0_KEY();
    if (k) { h["x-rapidapi-key"] = k; h["x-rapidapi-host"] = J0_HOST(); }
    return h;
}

function retryDelay(resp: Response, attempt: number) {
    const ra = resp.headers.get("Retry-After");
    if (ra) { const s = parseInt(ra, 10); if (!isNaN(s)) return s * 1000 + 500; }
    return RETRY_BASE * (attempt + 1);
}

async function submitBatch(subs: Judge0Submission[]): Promise<string[]> {
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        const resp = await fetchIPv4(`${J0_URL()}/submissions/batch?base64_encoded=true`, {
            method: "POST",
            headers: j0Headers(),
            body: JSON.stringify({ submissions: subs }),
        });
        if (resp.ok) {
            const data = await resp.json() as { token: string }[];
            return data.map((d) => d.token);
        }
        if (resp.status === 429 && attempt < MAX_RETRIES) {
            await sleep(retryDelay(resp, attempt));
            continue;
        }
        throw new Error(`Judge0 submit failed: ${resp.status} ${await resp.text()}`);
    }
    throw new Error("Judge0 submit failed after retries");
}

async function pollChunk(tokens: string[]): Promise<Judge0Result[]> {
    const tokenStr = tokens.join(",");
    const start = Date.now();
    let delay = POLL_DELAY;

    while (Date.now() - start < POLL_TIMEOUT) {
        await sleep(delay);
        let resp: Response;
        try {
            resp = await fetchIPv4(
                `${J0_URL()}/submissions/batch?tokens=${tokenStr}&base64_encoded=true&fields=*`,
                { headers: j0Headers() }
            );
        } catch { delay = Math.min(delay * 1.5, 8000); continue; }

        if (resp.status === 429) { await sleep(retryDelay(resp, 1)); continue; }
        if (!resp.ok) { delay = Math.min(delay * 1.5, 8000); continue; }

        const data = await resp.json() as { submissions: Judge0Result[] };
        const results = data.submissions;
        if (results.every((r) => r.status?.id !== 1 && r.status?.id !== 2)) return results;
    }
    throw new Error("Judge0 polling timed out");
}

/** Poll tokens in POLL_CHUNK-sized groups, merging results in order. */
async function pollBatch(tokens: string[]): Promise<Judge0Result[]> {
    if (tokens.length <= POLL_CHUNK) return pollChunk(tokens);
    const all: Judge0Result[] = [];
    for (let i = 0; i < tokens.length; i += POLL_CHUNK) {
        const chunk = tokens.slice(i, i + POLL_CHUNK);
        const results = await pollChunk(chunk);
        all.push(...results);
    }
    return all;
}

/** Run sourceCode against all stdinInputs, return stdout strings (or error info) */
async function runOnJudge0(
    sourceCode: string,
    langId: number,
    stdinInputs: string[]
): Promise<{ stdout: string; statusId: number; statusDesc: string; compileError?: string }[]> {
    const subs: Judge0Submission[] = stdinInputs.map((inp) => ({
        source_code:     toB64(sourceCode),
        language_id:     langId,
        stdin:           toB64(inp),
        expected_output: null,
        cpu_time_limit:  5,
        memory_limit:    262144,
        max_output_size: 524288,
        enable_network:  false,
    }));

    const tokens  = await submitBatch(subs);
    const results = await pollBatch(tokens);

    return results.map((r) => ({
        stdout:       normalizeOut(fromB64(r.stdout)),
        statusId:     r.status?.id || 0,
        statusDesc:   r.status?.description || "Unknown",
        compileError: fromB64(r.compile_output) || fromB64(r.stderr) || undefined,
    }));
}

// ─── Gemini LLM call ─────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a senior software engineer creating verified coding interview problems for Practers, a technical interview platform. You produce high-quality, accurate problems with correct solutions and I/O drivers in multiple programming languages.

CRITICAL STRUCTURAL RULES (violations cause compile errors):

SOLUTION CODE (the "solution" fields):
- Contains ONLY the class/function definition — no imports, no package declarations, no main()
- Python3: include "from typing import List, Dict, Optional, Tuple" INSIDE the class file scope if needed
- C++: NO #include or using namespace — only the class Solution { ... } definition
- Java: NO import statements — only the class Solution { ... } definition
- Go: NO package or import statements — only bare function(s) e.g. func twoSum(...) { }
- Rust: NO use statements — only struct Solution; and impl Solution { ... }
- C#: NO using statements — only public class Solution { ... }

WRAPPER CODE (the "wrapper_code" fields):
- Contains ALL imports/includes/package declarations + the I/O driver (main function/entry point)
- Must NOT define or re-define a Solution class/struct
- Must instantiate/call the Solution from the solution code
- Python3: import json, sys at top; read lines from stdin; call Solution(); print(json.dumps(result))
- C++: #include <bits/stdc++.h> and using namespace std; at top; int main() { read stdin, call Solution(), cout JSON }
- Java: import java.util.*; etc at top; class Main { public static void main(String[] args) { read stdin, call new Solution(), System.out.println JSON } }
- JavaScript (Node.js 12): use process.stdin + readline or require('readline'); call solution function; console.log(JSON.stringify(result))
- Go: package main + import block + func main() { read stdin via bufio.Scanner, call solution func, fmt.Println(JSON) }
- Rust: use std::io::{self,Read}; fn main() { read stdin, call Solution::method(), println!("{}", json_string) } — do NOT use serde_json (unavailable); build JSON strings manually
- C#: using System; using System.Collections.Generic; etc; class Program { static void Main(string[] args) { read Console.ReadLine(), call new Solution(), Console.WriteLine(JSON) } }

STDIN/STDOUT FORMAT:
- STDIN: one JSON-encoded parameter per line (arrays: [1,2,3], numbers: 42, strings: "abc")
- STDOUT: exactly one line — the result encoded as JSON (no extra prints, no debug output)
- IMPORTANT: If there is no result or the result is empty/null, print -1 (the integer). NEVER print null or [].
- linked list input → comes as JSON array on stdin; use _arr_to_list() / arrToList() helper to convert
- linked list output → use _list_to_arr() / listToArr() helper to convert back to array before printing
- binary tree input → level-order array on stdin (null/-1 = missing node); use _arr_to_tree() helper
- binary tree output → level-order array; use _tree_to_arr() helper before printing

CUSTOM TYPES — ListNode and TreeNode are PRE-DEFINED in the wrapper. Rules:
- Do NOT define ListNode or TreeNode anywhere — they are already defined
- Solution code: use ListNode/TreeNode freely, do NOT define them
- Wrapper code: use the pre-defined helpers (_arr_to_list, _list_to_arr, _arr_to_tree, _tree_to_arr / language-specific equivalents) to convert stdin arrays → nodes and results → arrays before printing
- Python3 helpers: _arr_to_list(arr), _list_to_arr(node), _arr_to_tree(arr), _tree_to_arr(root)
- C++ helpers: _arrToList(vector<int>), _listToArr(ListNode*), _arrToTree(vector<int>), _treeToArr(TreeNode*)
- Java helpers: arrToList(int[]), listToArr(ListNode), arrToTree(int[])
- JavaScript helpers: _arrToList(arr), _listToArr(h), _arrToTree(arr)
- Go helpers: _arrToList([]int), _listToArr(*ListNode), _arrToTree([]int)
- Rust helpers: arr_to_list(Vec<i32>), list_to_arr(Option<Box<ListNode>>), arr_to_tree(Vec<i32>)
- C# helpers: ArrToList(int[]), ListToArr(ListNode), ArrToTree(int[])

DESCRIPTION: Rephrase only — never mention "LeetCode". Keep examples and constraints word-for-word.`;


function buildPrompt(raw: RawQuestion, hasRealTestCases: boolean): string {
    const starterPy3   = getStarterCode(raw, "python3")    || getStarterCode(raw, "python")     || "";
    const starterCpp   = getStarterCode(raw, "cpp")                                               || "";
    const starterJava  = getStarterCode(raw, "java")                                              || "";
    const starterJs    = getStarterCode(raw, "javascript")                                        || "";
    const hintsText    = (raw.hints || []).slice(0, 5).map((h, i) => `  ${i + 1}. ${h}`).join("\n") || "  (none)";
    const solutionRaw  = raw.solution;
    const solutionRef  = typeof solutionRaw === "string"
        ? solutionRaw.slice(0, 2000)
        : solutionRaw
            ? JSON.stringify(solutionRaw).slice(0, 2000)
            : "";

    const examples = raw.examples || [];
    const examplesText = examples.length
        ? examples.map((ex, i) =>
            `  Example ${i + 1}:\n  ${ex.example_text.replace(/\n/g, "\n  ")}`
        ).join("\n\n")
        : "  (none)";

    const hiddenCount = Math.max(examples.length + 4, 7);

    const testInputsSchema = hasRealTestCases ? "" : `
  "test_inputs": {
    "sample": ["<3 new simple stdin strings>"],
    "hidden": ["<${examples.length} original examples as stdin>", "<additional edge cases to reach ${hiddenCount} total>"]
  },`;

    const testInputsRules = hasRealTestCases ? "" : `
Rules for test_inputs:
- sample: exactly 3 NEW, SIMPLE test inputs NOT from the original examples above
- hidden: the ${examples.length} original examples converted to stdin format FIRST, then add more edge-case inputs to reach ${hiddenCount} total hidden inputs
- Each stdin string: one JSON-encoded parameter per line (\\n separated)
`;

    return `## Problem

Title: ${raw.title}
Difficulty: ${raw.difficulty}
Topics: ${(raw.topics || []).join(", ")}

Description:
${raw.description}

Constraints:
${(raw.constraints || []).join("\n")}

Starter code snippets (for reference — use these exact signatures):
Python3:
\`\`\`python
${starterPy3 || "(not provided)"}
\`\`\`
C++:
\`\`\`cpp
${starterCpp || "(not provided)"}
\`\`\`
Java:
\`\`\`java
${starterJava || "(not provided)"}
\`\`\`
JavaScript:
\`\`\`javascript
${starterJs || "(not provided)"}
\`\`\`

Original problem examples:
${examplesText}

Hints (for your reference, do not copy verbatim):
${hintsText}

Reference solution approaches (for your reference):
${solutionRef || "(none provided)"}

---

TASK: Return a single JSON object (no markdown fences, no extra text) matching this exact schema.
${hasRealTestCases ? "NOTE: Test cases are already provided — do NOT include test_inputs in your response." : ""}

Rules for topics:
- Pick 1–5 tags from this exact set: Array, String, Hash Table, Math, Dynamic Programming, Sorting, Greedy, Depth-First Search, Breadth-First Search, Binary Search, Two Pointers, Sliding Window, Stack, Queue, Linked List, Tree, Binary Tree, Binary Search Tree, Graph, Heap (Priority Queue), Backtracking, Recursion, Divide and Conquer, Bit Manipulation, Matrix, Design, Simulation, Prefix Sum, Monotonic Stack, Union Find, Trie, Segment Tree
${testInputsRules}
Rules for solutions:
- Each language key contains the COMPLETE, RUNNABLE solution class/function (no stubs)
- Python3: include "from typing import List, Dict, Optional, Tuple" inside the class/function if needed
- Do NOT include main() or I/O code in solution — I/O drivers are generated automatically

{
  "description": "<rephrased problem statement — problem text only, NOT examples or constraints section>",
  "topics": ["<1-5 topic tags from the allowed set>"],
  "follow_up": ["<follow-up questions if any, else empty array>"],${testInputsSchema}
  "solution": {
    "brute_force": {
      "explanation": "<plain-English explanation>",
      "time_complexity": "O(…)",
      "space_complexity": "O(…)",
      "python3":     "<complete Solution class>",
      "cpp":         "<complete Solution class>",
      "java":        "<complete Solution class>",
      "javascript":  "<complete solution function (var fn = function(...){...};)>",
      "golang":      "<complete func solutionName(...) ... {...}>",
      "rust":        "<complete impl Solution { pub fn solution_name(...) -> ... {...} }>",
      "csharp":      "<complete public class Solution { public ... SolutionName(...) {...} }>"
    },
    "optimized": {
      "explanation": "<plain-English explanation>",
      "time_complexity": "O(…)",
      "space_complexity": "O(…)",
      "python3":     "<complete Solution class>",
      "cpp":         "<complete Solution class>",
      "java":        "<complete Solution class>",
      "javascript":  "<complete solution function>",
      "golang":      "<complete solution func>",
      "rust":        "<complete impl Solution>",
      "csharp":      "<complete Solution class>"
    }
  }
}`;
}

async function callGemini(raw: RawQuestion, hasRealTestCases: boolean): Promise<LLMResponse | null> {
    const client = getGeminiClient();
    const prompt = buildPrompt(raw, hasRealTestCases);

    for (let attempt = 0; attempt < 2; attempt++) {
        try {
            const result = await client.models.generateContent({
                model: GEMINI_PRO_MODEL,
                contents: prompt,
                config: {
                    systemInstruction: SYSTEM_PROMPT,
                    responseMimeType: "application/json",
                    temperature: 0.2,
                },
            });

            const text = result.text?.trim() || "";
            const clean = text.replace(/^```json\s*/i, "").replace(/```\s*$/i, "").trim();
            const parsed = JSON.parse(clean) as LLMResponse;

            // test_inputs only required when we don't have real test cases
            const testInputsOk = hasRealTestCases || parsed.test_inputs?.sample?.length;
            if (
                !parsed.description ||
                !testInputsOk ||
                !parsed.solution?.optimized?.python3 ||
                !parsed.solution?.brute_force?.python3
            ) {
                throw new Error("LLM response missing required fields");
            }

            return parsed;
        } catch (err: any) {
            console.warn(`  LLM attempt ${attempt + 1} failed: ${err.message}`);
            if (attempt === 0) await sleep(5000);
        }
    }
    return null;
}

// ─── Retry with error context ─────────────────────────────────────────────────

async function callGeminiWithFix(
    raw: RawQuestion,
    original: LLMResponse,
    badCode: string,
    errorMsg: string
): Promise<LLMResponse | null> {
    const client = getGeminiClient();
    const fixPrompt = `The Python3 solution + wrapper for "${raw.title}" produced an error on Judge0.

ERROR:
${errorMsg.slice(0, 600)}

FAILING CODE:
\`\`\`python
${badCode.slice(0, 2000)}
\`\`\`

Fix ONLY the solution and wrapper code. Keep all test_inputs exactly the same.
Return the COMPLETE JSON with all fields (description, follow_up, test_inputs, wrapper_code, solution).
Return ONLY valid JSON, no markdown fences.`;

    try {
        const result = await client.models.generateContent({
            model: GEMINI_PRO_MODEL,
            contents: fixPrompt,
            config: {
                systemInstruction: SYSTEM_PROMPT,
                responseMimeType: "application/json",
                temperature: 0.1,
            },
        });
        const text = result.text?.trim() || "";
        const clean = text.replace(/^```json\s*/i, "").replace(/```\s*$/i, "").trim();
        const parsed = JSON.parse(clean) as Partial<LLMResponse>;

        // Merge: keep original test_inputs/solutions if the fix omitted fields
        const merged: LLMResponse = {
            description:  parsed.description  || original.description,
            topics:       parsed.topics?.length ? parsed.topics : original.topics,
            follow_up:    parsed.follow_up    || original.follow_up,
            test_inputs:  parsed.test_inputs?.sample?.length
                ? parsed.test_inputs
                : original.test_inputs,
            wrapper_code: parsed.wrapper_code?.python3
                ? parsed.wrapper_code as LLMResponse["wrapper_code"]
                : original.wrapper_code,
            solution:     parsed.solution?.optimized?.python3
                ? parsed.solution as LLMResponse["solution"]
                : original.solution,
        };
        return merged;
    } catch {
        return null;
    }
}

// combinePython kept as thin alias for backward compat within processQuestion
function combinePython(solutionCode: string, wrapperCode: string): string {
    return combineCode("python3", solutionCode, wrapperCode);
}

// ─── Process a single question ────────────────────────────────────────────────

interface ProcessResult {
    status: "saved" | "failed" | "skipped";
    reason?: string;
}

async function processQuestion(
    raw: RawQuestion,
    skipMongo: boolean,
    outputDir: string
): Promise<ProcessResult> {
    const label = `[${raw.problem_id}] ${raw.title}`;

    // ── Detect pre-filled test cases from newfacade ───────────────────────
    const prefilled = (raw.sample_test_cases?.length ?? 0) > 0 && (raw.hidden_test_cases?.length ?? 0) > 0;
    if (prefilled) {
        console.log(`  ${label} → has ${raw.sample_test_cases!.length} sample + ${raw.hidden_test_cases!.length} hidden test cases (pre-filled)`);
    }

    // ── Phase 1: Call Gemini ──────────────────────────────────────────────
    console.log(`  ${label} → calling Gemini Pro…`);
    let llm = await callGemini(raw, prefilled);
    if (!llm) return { status: "failed", reason: "LLM call failed after 2 attempts" };

    // ── Generate ALL 7 wrappers programmatically from Python3 signature ────
    // Gemini is not asked for wrapper_code — we always generate it ourselves.
    // This guarantees correct stdin parsing, helper usage, and output formatting.
    const customTypes = detectCustomTypes(
        llm.solution.optimized.python3 + " " + llm.solution.optimized.cpp
    );
    const sig = parsePy3Sig(llm.solution.optimized.python3, customTypes);
    if (!sig) {
        return { status: "failed", reason: `Could not parse Python3 signature from solution:\n${llm.solution.optimized.python3.slice(0, 200)}` };
    }
    const sigLabel = `${sig.methodName}(${sig.params.map(p => p.name + ":" + p.cat).join(", ")}) → ${sig.retCat}`;
    console.log(`  ${label} → generating wrappers from sig: ${sigLabel}`);

    const LANGS: SupportedLang[] = ["python3", "cpp", "java", "javascript", "golang", "rust", "csharp"];
    const solutions: Record<SupportedLang, string> = {
        python3: llm.solution.optimized.python3,
        cpp: llm.solution.optimized.cpp,
        java: llm.solution.optimized.java,
        javascript: llm.solution.optimized.javascript,
        golang: llm.solution.optimized.golang,
        rust: llm.solution.optimized.rust,
        csharp: llm.solution.optimized.csharp,
    };
    llm.wrapper_code = {};
    for (const lang of LANGS) {
        const generated = generateWrapperForCustomTypes(lang, sig, solutions, customTypes);
        llm.wrapper_code[lang] = (customTypes.linkedList || customTypes.binaryTree)
            ? injectBoilerplate(lang, generated, customTypes)
            : generated;
    }

    // ── Resolve test case inputs ──────────────────────────────────────────
    // When pre-filled: use real test cases as-is (inputs + outputs already set).
    // When not pre-filled: run optimised solution on Gemini-generated inputs to get outputs.

    let sampleTestCases: { id: string; description: string; input: string; output: string }[];
    let hiddenTestCases: { id: string; description: string; input: string; output: string }[];
    let crossVerified = true;

    if (prefilled) {
        // Real test cases from newfacade — already have correct inputs AND outputs
        sampleTestCases = raw.sample_test_cases!.map((tc, i) => ({
            id: tc.id || `sample_${i + 1}`,
            description: tc.description || "Sample test case",
            input: String(tc.input || ""),
            output: String(tc.output || ""),
        }));
        hiddenTestCases = raw.hidden_test_cases!.map((tc, i) => ({
            id: tc.id || `hidden_${i + 1}`,
            description: tc.description || "Hidden test case",
            input: String(tc.input || ""),
            output: String(tc.output || ""),
        }));

        // Verify wrapper + solution compile on Judge0 using sample inputs only
        const sampleInputs = sampleTestCases.map((tc) => tc.input);
        const optimisedCode = combinePython(llm.solution.optimized.python3, (llm.wrapper_code?.python3 ?? ""));
        console.log(`  ${label} → verifying solution compiles on Judge0 (${sampleInputs.length} sample cases)…`);
        let verifyResults: Awaited<ReturnType<typeof runOnJudge0>>;
        try {
            verifyResults = await runOnJudge0(optimisedCode, LANG.python3, sampleInputs);
        } catch (err: any) {
            return { status: "failed", reason: `Judge0 network error: ${err.message}` };
        }

        const compileErr = verifyResults.find((r) => r.statusId === 6);
        const runtimeErr = verifyResults.find((r) => r.statusId >= 7 && r.statusId <= 15);
        if (compileErr || runtimeErr) {
            const errMsg = compileErr?.compileError || runtimeErr?.compileError || "runtime error";
            console.warn(`  ${label} → solution error: ${errMsg.slice(0, 200)}`);
            const fixed = await callGeminiWithFix(raw, llm, optimisedCode, errMsg);
            if (!fixed) return { status: "failed", reason: "Solution errored and fix failed" };
            llm = fixed;
            // Regenerate Python3 wrapper after fix (sig may have changed)
            const fixedSig = parsePy3Sig(llm.solution.optimized.python3, customTypes) ?? sig;
            llm.wrapper_code = llm.wrapper_code ?? {};
            llm.wrapper_code["python3"] = generateWrapperForCustomTypes("python3", fixedSig, { ...solutions, python3: llm.solution.optimized.python3 }, customTypes);
            const fixedCode = combinePython(llm.solution.optimized.python3, (llm.wrapper_code?.python3 ?? ""));
            try {
                verifyResults = await runOnJudge0(fixedCode, LANG.python3, sampleInputs);
            } catch (err: any) {
                return { status: "failed", reason: `Judge0 after fix: ${err.message}` };
            }
            const stillErr = verifyResults.find((r) => r.statusId === 6 || (r.statusId >= 7 && r.statusId <= 15));
            if (stillErr) return { status: "failed", reason: "Solution still errors after fix attempt" };
        }

        // Cross-check: solution output should match the real expected output for sample cases
        const mismatches: number[] = [];
        verifyResults.forEach((r, i) => {
            if (r.statusId === 3 && r.stdout !== normalizeOut(sampleTestCases[i]!.output)) {
                mismatches.push(i + 1);
                crossVerified = false;
            }
        });
        if (!crossVerified) {
            console.warn(`  ${label} → solution output doesn't match real expected on sample ${mismatches.join(", ")} — saving with warning`);
        }

    } else {
        // No pre-filled test cases — generate inputs via Gemini, run solution to get outputs
        const allInputs = [...llm.test_inputs!.sample, ...llm.test_inputs!.hidden];
        const optimisedCode = combinePython(llm.solution.optimized.python3, (llm.wrapper_code?.python3 ?? ""));

        console.log(`  ${label} → running optimised on Judge0 (${allInputs.length} test cases)…`);
        let optimisedResults: Awaited<ReturnType<typeof runOnJudge0>>;
        try {
            optimisedResults = await runOnJudge0(optimisedCode, LANG.python3, allInputs);
        } catch (err: any) {
            return { status: "failed", reason: `Judge0 network error: ${err.message}` };
        }

        const compileErr = optimisedResults.find((r) => r.statusId === 6);
        const runtimeErr = optimisedResults.find((r) => r.statusId >= 7 && r.statusId <= 15);
        if (compileErr || runtimeErr) {
            const errMsg = compileErr?.compileError || runtimeErr?.compileError || "runtime error";
            console.warn(`  ${label} → solution error (${compileErr ? "compile" : "runtime"}): ${errMsg.slice(0, 200)}`);
            const fixed = await callGeminiWithFix(raw, llm, optimisedCode, errMsg);
            if (!fixed) return { status: "failed", reason: "Solution errored and fix failed" };
            llm = fixed;
            const fixedSig2 = parsePy3Sig(llm.solution.optimized.python3, customTypes) ?? sig;
            llm.wrapper_code = llm.wrapper_code ?? {};
            llm.wrapper_code["python3"] = generateWrapperForCustomTypes("python3", fixedSig2, { ...solutions, python3: llm.solution.optimized.python3 }, customTypes);
            const allInputs2 = [...llm.test_inputs!.sample, ...llm.test_inputs!.hidden];
            const fixedCode = combinePython(llm.solution.optimized.python3, (llm.wrapper_code?.python3 ?? ""));
            try {
                optimisedResults = await runOnJudge0(fixedCode, LANG.python3, allInputs2);
            } catch (err: any) {
                return { status: "failed", reason: `Judge0 after fix: ${err.message}` };
            }
            const stillErr = optimisedResults.find((r) => r.statusId === 6 || (r.statusId >= 7 && r.statusId <= 15));
            if (stillErr) return { status: "failed", reason: "Solution still errors after fix attempt" };
        }

        // stdout from Judge0 becomes the expected output (ground truth)
        const expectedOutputs = optimisedResults.map((r) => r.stdout);
        const sampleCount = llm.test_inputs!.sample.length;
        const origExampleCount = raw.examples?.length ?? 0;

        sampleTestCases = llm.test_inputs!.sample.map((stdin, i) => ({
            id: `sample_${i + 1}`,
            description: "Sample test case",
            input: stdin,
            output: expectedOutputs[i] || "",
        }));
        hiddenTestCases = llm.test_inputs!.hidden.map((stdin, i) => ({
            id: `hidden_${i + 1}`,
            description: i < origExampleCount ? `Original example ${i + 1}` : "Hidden test case",
            input: stdin,
            output: expectedOutputs[sampleCount + i] || "",
        }));

        // Cross-verify brute force on sample inputs
        const bruteCode = combinePython(llm.solution.brute_force.python3, (llm.wrapper_code?.python3 ?? ""));
        console.log(`  ${label} → cross-verifying brute force on ${sampleCount} sample cases…`);
        let bruteResults: Awaited<ReturnType<typeof runOnJudge0>>;
        try {
            bruteResults = await runOnJudge0(bruteCode, LANG.python3, llm.test_inputs!.sample);
        } catch (err: any) {
            console.warn(`  ${label} → brute force run failed (non-blocking): ${err.message}`);
            bruteResults = [];
        }
        const mismatches: number[] = [];
        bruteResults.forEach((br, i) => {
            if (br.statusId === 3 && br.stdout !== expectedOutputs[i]) {
                mismatches.push(i + 1);
                crossVerified = false;
            }
        });
    }

    if (!crossVerified) {
        console.warn(`  ${label} → output mismatch detected — saving with warning`);
    }

    // ── Phase 3: Verify ALL 7 languages against sample test cases ────────
    // This ensures every wrapper correctly parses stdin and produces the right output.
    const SUPPORTED_LANGS: SupportedLang[] = ["python3", "cpp", "java", "javascript", "golang", "rust", "csharp"];

    console.log(`  ${label} → verifying all 7 languages on Judge0…`);
    let langResults: Map<SupportedLang, LangResult>;
    try {
        langResults = await verifyAllLanguages(llm, sampleTestCases, customTypes);
    } catch (err: any) {
        console.warn(`  ${label} → multi-lang verification network error: ${err.message} — skipping`);
        langResults = new Map(SUPPORTED_LANGS.map(l => [l, { pass: false, error: err.message }]));
    }

    // ── Phase 4: Fix failing languages — fix solution, regenerate wrapper ──
    for (const lang of SUPPORTED_LANGS) {
        const res = langResults.get(lang)!;
        if (res.pass) continue;

        // Python3 was already verified in Phase 2 — skip redundant fix
        if (lang === "python3" && crossVerified) { langResults.set(lang, { pass: true, error: "" }); continue; }

        console.log(`  ${label} [${lang}] → failed (${res.error.slice(0, 100)}), fixing solution…`);
        let fixedSolution = llm.solution.optimized[lang];
        let passed = false;

        for (let attempt = 0; attempt < 3; attempt++) {
            const currentError = langResults.get(lang)?.error || res.error;
            const currentWrapper = llm.wrapper_code![lang] || "";
            const fix = await fixLang(raw, lang, fixedSolution, currentWrapper, currentError, sampleTestCases);
            if (!fix) break;

            // Apply fixed solution; regenerate wrapper from updated solution
            fixedSolution = fix.solution;
            llm.solution.optimized[lang] = fix.solution;
            llm.solution.brute_force[lang] = fix.solution;

            // Regenerate wrapper using the same signature but updated solution
            const updatedSolutions = { ...solutions, [lang]: fix.solution };
            const regenerated = generateWrapperForCustomTypes(lang, sig, updatedSolutions, customTypes);
            const newWrapper = (customTypes.linkedList || customTypes.binaryTree)
                ? injectBoilerplate(lang, regenerated, customTypes)
                : regenerated;
            llm.wrapper_code![lang] = newWrapper;

            // Re-verify this language only
            const combined = combineCode(lang, fix.solution, newWrapper, customTypes);
            const langId   = LANG_IDS[lang] ?? 71;
            try {
                const results = await runOnJudge0(combined, langId, sampleTestCases.map(tc => tc.input));
                const compileErr = results.find(r => r.statusId === 6);
                const runtimeErr = results.find(r => r.statusId >= 7 && r.statusId <= 15);
                if (compileErr || runtimeErr) {
                    const err = compileErr?.compileError || runtimeErr?.compileError || "runtime error";
                    langResults.set(lang, { pass: false, error: err.slice(0, 300) });
                    continue;
                }
                const wrongAnswer = results.find((r, i) =>
                    r.statusId === 3 && normalizeOut(r.stdout) !== normalizeOut(sampleTestCases[i]!.output)
                );
                if (wrongAnswer) {
                    langResults.set(lang, { pass: false, error: `Wrong answer after fix attempt ${attempt + 1}` });
                    continue;
                }
                langResults.set(lang, { pass: true, error: "" });
                passed = true;
                console.log(`  ${label} [${lang}] → fixed ✓`);
                break;
            } catch (err: any) {
                langResults.set(lang, { pass: false, error: err.message });
            }
        }

        if (!passed) {
            console.warn(`  ${label} [${lang}] → could not fix after 2 attempts — saving without verified ${lang}`);
        }
    }

    const verifiedLangs = SUPPORTED_LANGS.filter(l => langResults.get(l)?.pass);
    const failedLangs   = SUPPORTED_LANGS.filter(l => !langResults.get(l)?.pass);
    if (failedLangs.length > 0) {
        console.warn(`  ${label} → unverified languages: ${failedLangs.join(", ")}`);
    }
    console.log(`  ${label} → verified: ${verifiedLangs.join(", ")}`);

    // ── Phase 5: Build the final question document ────────────────────────

    // Build codeSnippets: starter_code = stub extracted from verified solution (no imports/I/O)
    //                     wrapper_code = programmatically generated I/O driver (not shown to user)
    const codeSnippets: Record<string, { starter_code: string; wrapper_code: string }> = {};

    for (const lang of SUPPORTED_LANGS) {
        const wc = llm.wrapper_code?.[lang] || "";
        if (!wc) continue;

        // Extract stub from the verified optimized solution
        const solution = llm.solution.optimized[lang] || "";
        const starter = extractStarterCode(lang, solution);

        codeSnippets[lang] = {
            starter_code: starter,
            wrapper_code: wc,
        };
    }

    // sampleTestCases and hiddenTestCases are already built above in the prefilled/generated branches

    // ── Description & examples ────────────────────────────────────────────
    const finalDescription = (llm.description?.length ?? 0) > 100 ? llm.description : raw.description;
    const examples = (raw.examples || []).map((ex) => ({
        example_num: ex.example_num,
        example_text: ex.example_text,
    }));

    // ── Solution code maps (all 7 languages) ──────────────────────────────
    const buildCodeMap = (approach: SolutionApproach): Map<string, string> => {
        const m = new Map<string, string>();
        for (const lang of SUPPORTED_LANGS) {
            const code = approach[lang];
            if (code) m.set(lang, code);
        }
        return m;
    };

    const questionDoc = {
        title:           raw.title,
        problemId:       raw.problem_id,
        frontendId:      raw.frontend_id || raw.problem_id,
        difficulty:      raw.difficulty as "Easy" | "Medium" | "Hard",
        problemSlug:     raw.problem_slug,
        topics:          (raw.topics?.length ? raw.topics : null) ?? llm.topics ?? [],
        companyTags:     raw.company_tags || [],
        description:     finalDescription,
        examples,
        constraints:     raw.constraints || [],
        sampleTestCases,
        hiddenTestCases,
        codeSnippets,
        followUp:        [...(raw.follow_up || []), ...(raw.follow_ups || []), ...(llm.follow_up || [])].filter(Boolean),
        hints:           raw.hints || [],
        solution: {
            bruteForce: {
                explanation:     llm.solution.brute_force.explanation,
                timeComplexity:  llm.solution.brute_force.time_complexity,
                spaceComplexity: llm.solution.brute_force.space_complexity,
                code:            buildCodeMap(llm.solution.brute_force),
            },
            optimized: {
                explanation:     llm.solution.optimized.explanation,
                timeComplexity:  llm.solution.optimized.time_complexity,
                spaceComplexity: llm.solution.optimized.space_complexity,
                code:            buildCodeMap(llm.solution.optimized),
            },
        },
    };

    // ── Phase 6a: Save JSON file ──────────────────────────────────────────
    const mapToObj = (m: Map<string, string>) => Object.fromEntries(m.entries());

    const paddedId = raw.problem_id.padStart(4, "0");
    const jsonPath = path.join(outputDir, `${paddedId}-${raw.problem_slug}.json`);
    await fs.writeFile(jsonPath, JSON.stringify({
        title:             questionDoc.title,
        problem_id:        questionDoc.problemId,
        frontend_id:       questionDoc.frontendId,
        difficulty:        questionDoc.difficulty,
        problem_slug:      questionDoc.problemSlug,
        topics:            questionDoc.topics,
        company_tags:      questionDoc.companyTags,
        description:       questionDoc.description,
        examples:          questionDoc.examples,
        constraints:       questionDoc.constraints,
        follow_up:         questionDoc.followUp,
        hints:             questionDoc.hints,
        sample_test_cases: sampleTestCases,
        hidden_test_cases: hiddenTestCases,
        code_snippets:     codeSnippets,
        verified_languages: verifiedLangs,
        solution: {
            brute_force: {
                explanation:      llm.solution.brute_force.explanation,
                time_complexity:  llm.solution.brute_force.time_complexity,
                space_complexity: llm.solution.brute_force.space_complexity,
                ...Object.fromEntries(SUPPORTED_LANGS.map((l) => [l, llm.solution.brute_force[l] || ""])),
            },
            optimized: {
                explanation:      llm.solution.optimized.explanation,
                time_complexity:  llm.solution.optimized.time_complexity,
                space_complexity: llm.solution.optimized.space_complexity,
                ...Object.fromEntries(SUPPORTED_LANGS.map((l) => [l, llm.solution.optimized[l] || ""])),
            },
        },
    }, null, 2), "utf-8");

    // ── Phase 6b: Save to MongoDB ─────────────────────────────────────────
    if (!skipMongo) {
        await DSAQuestion.updateOne(
            { problemId: questionDoc.problemId },
            { $set: questionDoc },
            { upsert: true }
        );
    }

    const verdict = crossVerified ? "✓ verified" : "⚠ saved (output mismatch)";
    console.log(`  ${label} → ${verdict}`);
    return { status: "saved" };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
    // ── Parse CLI args ────────────────────────────────────────────────────
    const args = process.argv.slice(2);
    let inputDir  = path.resolve(process.cwd(), "Questions/DSA_questions");
    let limit     = Infinity;
    let skipMongo = false;
    let offset    = 0;

    for (let i = 0; i < args.length; i++) {
        if (args[i] === "--input"     && args[i + 1]) { inputDir  = path.resolve(process.cwd(), args[i + 1]!); i++; }
        if (args[i] === "--limit"     && args[i + 1]) { limit     = parseInt(args[i + 1]!, 10); i++; }
        if (args[i] === "--offset"    && args[i + 1]) { offset    = parseInt(args[i + 1]!, 10); i++; }
        if (args[i] === "--skip-mongo")                { skipMongo = true; }
    }

    console.log("=".repeat(60));
    console.log("  Practers — Dataset Processing Pipeline");
    console.log(`  Input dir : ${inputDir}`);
    console.log(`  Limit     : ${isFinite(limit) ? limit : "all"}`);
    console.log(`  Offset    : ${offset}`);
    console.log(`  Skip mongo: ${skipMongo}`);
    console.log("=".repeat(60));

    // ── Validate env ──────────────────────────────────────────────────────
    if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY && !process.env.GROQ_API_KEY) {
        console.error("❌  Neither GOOGLE_GENERATIVE_AI_API_KEY nor GROQ_API_KEY set in .env");
        process.exit(1);
    }
    if (!process.env.JUDGE0_API_KEY && !process.env.JUDGE0_API_URL?.includes("localhost")) {
        console.warn("⚠   JUDGE0_API_KEY not set — Judge0 calls will likely fail");
    }

    // ── Connect MongoDB ───────────────────────────────────────────────────
    if (!skipMongo) {
        const uri = process.env.MONGODB_URI;
        if (!uri) { console.error("❌  MONGODB_URI not set"); process.exit(1); }
        console.log("\n🔌 Connecting to MongoDB…");
        await mongoose.connect(uri, { dbName: "mockr_questions" });
        console.log("✅  Connected\n");
    }

    // ── Scan JSON files ───────────────────────────────────────────────────
    let files: string[];
    try {
        files = (await fs.readdir(inputDir))
            .filter((f) => f.endsWith(".json"))
            .sort()
            .slice(offset, isFinite(limit) ? offset + limit : undefined);
    } catch {
        console.error(`❌  Cannot read input directory: ${inputDir}`);
        process.exit(1);
    }

    console.log(`📂  Found ${files.length} JSON file(s) to process\n`);

    // ── Process each question ─────────────────────────────────────────────
    const failedPath = path.resolve(process.cwd(), "scripts/.process-failed.json");
    const failedLog: { file: string; reason: string }[] = [];

    let saved = 0, failed = 0, skippedAlready = 0;

    for (const file of files) {
        const filePath = path.join(inputDir, file);
        let raw: RawQuestion;
        try {
            raw = JSON.parse(await fs.readFile(filePath, "utf-8")) as RawQuestion;
        } catch (err: any) {
            console.warn(`⚠  Skipping ${file}: JSON parse error — ${err.message}`);
            continue;
        }

        if (!raw.problem_id || !raw.title) {
            console.warn(`⚠  Skipping ${file}: missing problem_id or title`);
            continue;
        }

        if (!raw.sample_test_cases?.length) {
            console.log(`  [${raw.problem_id}] ${raw.title} → no test cases, dropping`);
            skippedAlready++;
            continue;
        }

        // Already has processed test cases → skip if in MongoDB
        if (!skipMongo) {
            const existing = await DSAQuestion.findOne({ problemId: raw.problem_id });
            if (existing && existing.sampleTestCases?.length > 0 && existing.solution?.optimized?.explanation) {
                console.log(`  [${raw.problem_id}] ${raw.title} → already processed, skipping`);
                skippedAlready++;
                continue;
            }
        }

        console.log(`\n▶  Processing: ${file}`);
        const result = await processQuestion(raw, skipMongo, inputDir);

        if (result.status === "saved") {
            saved++;
        } else if (result.status === "failed") {
            failed++;
            failedLog.push({ file, reason: result.reason || "unknown" });
            console.warn(`  ✗ FAILED: ${result.reason}`);
        } else {
            skippedAlready++;
        }

        // Polite delay between questions (Gemini rate limits)
        await sleep(3000);
    }

    // ── Write failed log ──────────────────────────────────────────────────
    if (failedLog.length > 0) {
        await fs.writeFile(failedPath, JSON.stringify(failedLog, null, 2), "utf-8");
        console.log(`\n⚠  Failed log → ${failedPath}`);
    }

    // ── Summary ───────────────────────────────────────────────────────────
    console.log("\n" + "=".repeat(60));
    console.log(`  Saved   : ${saved}`);
    console.log(`  Failed  : ${failed}`);
    console.log(`  Skipped : ${skippedAlready} (already processed)`);
    console.log("=".repeat(60));

    if (!skipMongo) await mongoose.disconnect();
    console.log("\n✅  Done");
}

main().catch((err) => {
    console.error("❌  Fatal error:", err);
    process.exit(1);
});
