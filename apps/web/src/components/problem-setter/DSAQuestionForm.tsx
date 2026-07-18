"use client";

import { useEffect, useRef, useState } from "react";
import party from "party-js";
import { ApiError, api } from "@/lib/api";
import { useAuth } from "@/context/auth-context";
import { BasicInfoSection } from "./sections/BasicInfoSection";
import { DescriptionSection } from "./sections/DescriptionSection";
import { TestCasesSection } from "./sections/TestCasesSection";
import { CodeSnippetsSection } from "./sections/CodeSnippetsSection";
import { SolutionSection } from "./sections/SolutionSection";

export type LanguageTestStatus = "untested" | "running" | "passed" | "failed" | "tle";

export interface TestResultsState {
    bruteForce: {
        python3: LanguageTestStatus;
        cpp: LanguageTestStatus;
        java: LanguageTestStatus;
        javascript: LanguageTestStatus;
    };
    optimized: {
        python3: LanguageTestStatus;
        cpp: LanguageTestStatus;
        java: LanguageTestStatus;
        javascript: LanguageTestStatus;
    };
}

export interface DSAQuestionData {
    title: string;
    problemId: string;
    frontendId: string;
    difficulty: "Easy" | "Medium" | "Hard";
    problemSlug: string;
    timeLimit: number;
    memoryLimit: number;
    topics: string[];
    companyTags: string[];
    description: string;
    examples: Array<{ example_num: number; example_text: string }>;
    constraints: string[];
    sampleTestCases: Array<{ id: string; description: string; input: string; output: string }>;
    hiddenTestCases: Array<{ id: string; description: string; input: string; output: string }>;
    codeSnippets: {
        python3: { starter_code: string; wrapper_code: string };
        cpp: { starter_code: string; wrapper_code: string };
        java: { starter_code: string; wrapper_code: string };
        javascript: { starter_code: string; wrapper_code: string };
    };
    followUp: string[];
    hints: string[];
    // Special judge / custom checker. "custom" validates output via checkerCode
    // (for problems with multiple valid outputs) instead of exact match.
    judgeType: "default" | "custom";
    checkerLanguage: "python3" | "cpp" | "java" | "javascript";
    checkerCode: string;
    solution?: {
        bruteForce?: {
            explanation: string;
            timeComplexity: string;
            spaceComplexity: string;
            code: { python3?: string; cpp?: string; java?: string; javascript?: string };
        };
        optimized?: {
            explanation: string;
            timeComplexity: string;
            spaceComplexity: string;
            code: { python3?: string; cpp?: string; java?: string; javascript?: string };
        };
    };
}

interface DSAQuestionFormProps {
    initialData?: DSAQuestionData;
    onPreview: (data: DSAQuestionData) => void;
    autosaveKey?: string;
    fetchNextId?: (accessToken?: string) => Promise<{ success: boolean; nextId: string }>;
    submitQuestion?: (payload: DSAQuestionData, accessToken?: string) => Promise<void>;
    successMessage?: string;
    successDetail?: string;
    onSubmitSuccess?: () => void;
}

type ValidationDetail = {
    path?: Array<string | number>;
    message?: string;
};

const AUTOSAVE_KEY = "practers:dsa-question-form:draft:v1";

const tabs = [
    { name: "Question", shortName: "Question" },
    { name: "Test Cases", shortName: "Tests" },
    { name: "Code Snippets", shortName: "Code" },
    { name: "Solution", shortName: "Solution" },
    { name: "Quality Check", shortName: "Review" },
];

const AI_IMPORT_PROMPT = `Create one original DSA coding contest problem for a competitive programming platform.

Return ONLY valid JSON. Do not wrap it in prose. A markdown code fence is okay, but no explanation outside the JSON.

The JSON must match this schema exactly:
{
  "title": "Problem title",
  "difficulty": "Easy | Medium | Hard",
  "problemSlug": "kebab-case-title",
  "timeLimitMs": 2000,
  "memoryLimit": 256,
  "topics": ["Array", "Binary Search"],
  "companyTags": [],
  "description": "Full problem statement in Markdown. Use LaTeX with $x$ for inline math and $$x^2$$ for block math. Use \\n\\n between paragraphs.",
  "examples": [
    {
      "example_num": 1,
      "example_text": "Input:\\n...\\n\\nOutput:\\n...\\n\\nExplanation:\\n..."
    }
  ],
  "constraints": [
    "$1 \\le n \\le 2 \\cdot 10^5$"
  ],
  "sampleTestCases": [
    {
      "id": "sample_1",
      "input": "...",
      "output": "..."
    }
  ],
  "hiddenTestCases": [
    {
      "id": "hidden_1",
      "input": "...",
      "output": "..."
    }
  ],
  "codeSnippets": {
    "python3": {
      "starter_code": "class Solution:\\n    def solve(self):\\n        pass",
      "wrapper_code": ""
    },
    "cpp": {
      "starter_code": "class Solution {\\npublic:\\n    int solve() {\\n        return 0;\\n    }\\n};",
      "wrapper_code": ""
    },
    "java": {
      "starter_code": "class Solution {\\n    public int solve() {\\n        return 0;\\n    }\\n}",
      "wrapper_code": ""
    },
    "javascript": {
      "starter_code": "class Solution {\\n  solve() {\\n    return 0;\\n  }\\n}",
      "wrapper_code": ""
    }
  },
  "hints": [
    "Hint 1 in Markdown. LaTeX like $O(n \\log n)$, images, and :::note blocks are allowed."
  ],
  "followUp": [
    "Optional follow-up in Markdown. LaTeX and images are allowed."
  ],
  "solution": {
    "bruteForce": {
      "explanation": "Short brute force explanation.",
      "timeComplexity": "O(...)",
      "spaceComplexity": "O(...)",
      "code": {
        "python3": "",
        "cpp": "",
        "java": "",
        "javascript": ""
      }
    },
    "optimized": {
      "explanation": "Optimized approach explanation.",
      "timeComplexity": "O(...)",
      "spaceComplexity": "O(...)",
      "code": {
        "python3": "",
        "cpp": "",
        "java": "",
        "javascript": ""
      }
    }
  }
}

Rules:
- Make the problem self-contained and unambiguous.
- Include at least 2 examples, 2 sample tests, and 8 hidden tests.
- Hidden tests should cover minimum sizes, maximum-ish sizes, duplicates, sorted/reversed data, impossible cases, and tricky edge cases.
- Inputs and outputs must be raw stdin/stdout strings. Use \\n for multiple input lines inside JSON strings.
- Examples can include Markdown, tables, LaTeX, and image markdown if a public image URL is provided.
- The optimized solution code must be complete enough to pass every sample and hidden test in all four languages.
- Wrapper code can be empty unless the platform needs custom stdin/stdout glue.`;

const AI_FIELD_ASSIST_PROMPT = `You are helping write one field of a DSA coding contest question.

Return ONLY the requested field content. Do not return JSON unless I explicitly ask for JSON. Do not add explanations outside the requested content.

Important copy rule:
- Wrap normal field content in a fenced Markdown block so I can copy it without losing spaces or new lines:
\`\`\`md
<content here>
\`\`\`
- For raw test case input or raw test case output, use a text block instead:
\`\`\`text
<raw stdin/stdout here>
\`\`\`
- Do not put extra text before or after the fenced block.

Use these formats:

Problem Description:
- Write in clean Markdown.
- Use real blank lines between paragraphs.
- Use inline LaTeX like $n \\log n$.
- Use block LaTeX like:
$$
x^2 - 5x + 6 = 0
$$
- You may use Markdown tables and image markdown if I provide image URLs.
- Do not include "Input:", "Output:", or "Explanation:" unless I ask for an example field.

Example:
Use exactly this structure:
Input:
<raw sample input>

Output:
<raw expected output>

Explanation:
<short explanation with Markdown/LaTeX if needed>

Constraints:
- Return one constraint at a time unless I ask for multiple.
- Write in Markdown.
- Use LaTeX for mathematical bounds, for example $1 \\le n \\le 10^5$.
- You may use short notes or images if needed.
- Wrap it in \`\`\`md.

Test case input:
- Return raw stdin only.
- Use real new lines for multiple input lines.
- Wrap it in \`\`\`text.

Test case output:
- Return raw stdout only.
- If multiple answers are valid, explain the accepted-output rule separately instead of inventing one fixed output.
- Wrap fixed raw output in \`\`\`text.

Hints:
- Return one rich hint at a time unless I ask for multiple hints.
- Write in Markdown.
- You may use LaTeX, images, and callout blocks such as :::note, :::tip, or :::warning.
- Wrap them in \`\`\`md.

Follow-up:
- Return one follow-up question or extension at a time unless I ask for multiple.
- Write in Markdown.
- You may use LaTeX, images, and short context.
- Wrap it in \`\`\`md.

Solution explanation:
- Explain the approach, why it works, and complexity.
- Keep it suitable for a contest setter review.
- Wrap it in \`\`\`md.

When I ask for a field, answer only that field.`;

const AI_JSON_PROMPT = `You are helping me create a DSA competitive programming question for my contest platform.

First, ask me what kind of question I want. Ask about:
- The topic / data structure / algorithm (e.g. arrays, graphs, DP, greedy, etc.)
- The difficulty level (Easy / Medium / Hard)
- Any specific theme or twist I have in mind
- Input/output format preference (stdin/stdout)

Once I describe the question I want, generate ONLY the question description JSON in this exact schema inside a markdown code fence:

\`\`\`json
{
  "title": "Problem Title",
  "difficulty": "Easy | Medium | Hard",
  "problemSlug": "kebab-case-title",
  "topics": ["Array", "Greedy"],
  "companyTags": [],
  "description": "Full problem statement in premium, highly polished Markdown. Group related sentences into proper paragraphs (do NOT line-break after every sentence). Use **bold** for key concepts and inline LaTeX ($x$) for variables. Use block LaTeX ($$...$$) for complex equations. Include ### Input Format and ### Output Format sections.",
  "examples": [
    {
      "example_num": 1,
      "example_text": "**Input:**\\n...\\n\\n**Output:**\\n...\\n\\n**Explanation:**\\n..."
    }
  ],
  "constraints": [
    "$1 \\\\le n \\\\le 2 \\\\cdot 10^5$"
  ],
  "hints": ["Hint with LaTeX like $O(n \\\\log n)$."],
  "followUp": ["Optional follow-up question."]
}
\`\`\`

Rules:
- Do NOT include sampleTestCases, hiddenTestCases, codeSnippets, or solution in the JSON. I will add those separately.
- Include at least 2 examples with **Input:**, **Output:**, and **Explanation:** bolded.
- Include at least 2 constraints using proper LaTeX formatting.
- Include at least 2 hints that progressively guide the solver.
- **Formatting is critical:** Use rich Markdown. Group related sentences into proper natural paragraphs. Do NOT insert a newline after every single sentence. Bold important terms, and ensure all math and variables use proper LaTeX ($...$ or $$...$$).
- The description must include **### Input Format** and **### Output Format** heading sections, using bulleted lists for the variables.
- Wrap the JSON response inside a \`\`\`json code fence.
- Make the problem original, self-contained, and unambiguous.`;

const fieldTabIndex: Record<string, number> = {
    title: 0,
    problemId: 0,
    frontendId: 0,
    difficulty: 0,
    problemSlug: 0,
    topics: 0,
    companyTags: 0,
    description: 0,
    examples: 0,
    constraints: 0,
    followUp: 0,
    hints: 0,
    sampleTestCases: 1,
    hiddenTestCases: 1,
    codeSnippets: 2,
    solution: 3,
};

function createUntestedStatus(): TestResultsState {
    return {
        bruteForce: {
            python3: "untested",
            cpp: "untested",
            java: "untested",
            javascript: "untested",
        },
        optimized: {
            python3: "untested",
            cpp: "untested",
            java: "untested",
            javascript: "untested",
        },
    };
}

function createEmptyQuestionData(): DSAQuestionData {
    return {
        title: "",
        problemId: "",
        frontendId: "",
        difficulty: "Easy",
        problemSlug: "",
        timeLimit: 2,
        memoryLimit: 256,
        topics: [],
        companyTags: [],
        description: "",
        examples: [{ example_num: 1, example_text: "" }],
        constraints: [""],
        sampleTestCases: [{ id: "sample_1", description: "Sample test case", input: "", output: "" }],
        hiddenTestCases: [{ id: "hidden_1", description: "Hidden test case", input: "", output: "" }],
        codeSnippets: {
            python3: { starter_code: "", wrapper_code: "" },
            cpp: { starter_code: "", wrapper_code: "" },
            java: { starter_code: "", wrapper_code: "" },
            javascript: { starter_code: "", wrapper_code: "" },
        },
        followUp: [],
        hints: [],
        judgeType: "default",
        checkerLanguage: "cpp",
        checkerCode: "",
        solution: {
            bruteForce: {
                explanation: "",
                timeComplexity: "",
                spaceComplexity: "",
                code: {},
            },
            optimized: {
                explanation: "",
                timeComplexity: "",
                spaceComplexity: "",
                code: {},
            },
        },
    };
}

function toStringArray(value: unknown): string[] | undefined {
    if (Array.isArray(value)) {
        return value.map((item) => String(item).trim()).filter(Boolean);
    }
    if (typeof value === "string") {
        return value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
    }
    return undefined;
}

function normalizeExamples(value: unknown): DSAQuestionData["examples"] | undefined {
    if (!Array.isArray(value)) return undefined;
    const examples = value
        .map((item, index) => {
            if (typeof item === "string") {
                return { example_num: index + 1, example_text: item };
            }
            if (typeof item === "object" && item !== null) {
                const raw = item as Record<string, unknown>;
                const text = raw.example_text ?? raw.exampleText ?? raw.text ?? raw.example;
                if (typeof text === "string") {
                    return {
                        example_num: Number(raw.example_num ?? raw.exampleNum ?? index + 1),
                        example_text: text,
                    };
                }
            }
            return null;
        })
        .filter((item): item is { example_num: number; example_text: string } => Boolean(item?.example_text?.trim()));
    return examples.length ? examples : undefined;
}

function normalizeTestCases(value: unknown, prefix: "sample" | "hidden"): DSAQuestionData["sampleTestCases"] | undefined {
    if (!Array.isArray(value)) return undefined;
    const cases = value
        .map((item, index) => {
            if (typeof item !== "object" || item === null) return null;
            const raw = item as Record<string, unknown>;
            const input = raw.input ?? raw.Input;
            const output = raw.output ?? raw.expectedOutput ?? raw.expected_output ?? raw.Output;
            if (input === undefined || output === undefined) return null;
            return {
                id: String(raw.id ?? `${prefix}_${index + 1}`),
                description: String(raw.description ?? `${prefix === "sample" ? "Sample" : "Hidden"} test case ${index + 1}`),
                input: typeof input === "string" ? input : JSON.stringify(input),
                output: typeof output === "string" ? output : JSON.stringify(output),
            };
        })
        .filter((item): item is { id: string; description: string; input: string; output: string } => Boolean(item));
    return cases.length ? cases : undefined;
}

function normalizeCodeSnippets(value: unknown): Partial<DSAQuestionData["codeSnippets"]> | undefined {
    if (typeof value !== "object" || value === null) return undefined;
    const raw = value as Record<string, unknown>;
    const normalized: Partial<DSAQuestionData["codeSnippets"]> = {};

    (["python3", "cpp", "java", "javascript"] as const).forEach((language) => {
        const snippet = raw[language] || raw[language === "python3" ? "python" : language];
        if (typeof snippet === "object" && snippet !== null) {
            const snippetData = snippet as Record<string, unknown>;
            normalized[language] = {
                starter_code: String(snippetData.starter_code ?? snippetData.starterCode ?? ""),
                wrapper_code: String(snippetData.wrapper_code ?? snippetData.wrapperCode ?? ""),
            };
        }
    });

    return Object.keys(normalized).length ? normalized : undefined;
}

function normalizeSolutionCode(value: unknown): DSAQuestionData["solution"] extends infer Solution
    ? Solution extends { optimized?: infer Approach }
        ? Approach extends { code: infer Code }
            ? Partial<Code>
            : never
        : never
    : never {
    if (typeof value !== "object" || value === null) return {};
    const raw = value as Record<string, unknown>;
    const normalized: { python3?: string; cpp?: string; java?: string; javascript?: string } = {};

    (["python3", "cpp", "java", "javascript"] as const).forEach((language) => {
        const alias = language === "python3" ? "python" : language;
        const code = raw[language] ?? raw[alias];
        if (typeof code === "string" && code.trim()) {
            normalized[language] = code;
        }
    });

    return normalized;
}

function normalizeSolutionApproach(value: unknown): NonNullable<DSAQuestionData["solution"]>["optimized"] | undefined {
    if (typeof value !== "object" || value === null) return undefined;
    const raw = value as Record<string, unknown>;
    return {
        explanation: String(raw.explanation ?? raw.explaination ?? raw.description ?? ""),
        timeComplexity: String(raw.timeComplexity ?? raw.time_complexity ?? ""),
        spaceComplexity: String(raw.spaceComplexity ?? raw.space_complexity ?? ""),
        code: normalizeSolutionCode(raw.code),
    };
}

function normalizeSolution(value: unknown): DSAQuestionData["solution"] | undefined {
    if (typeof value !== "object" || value === null) return undefined;
    const raw = value as Record<string, unknown>;
    const bruteForce = normalizeSolutionApproach(raw.bruteForce ?? raw.brute_force);
    const optimized = normalizeSolutionApproach(raw.optimized ?? raw.optimal);
    if (!bruteForce && !optimized) return undefined;
    return { bruteForce, optimized };
}

function normalizeImportedQuestion(raw: unknown): Partial<DSAQuestionData> {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
        throw new Error("Question JSON must be a single object.");
    }

    const data = raw as Record<string, unknown>;
    const title = typeof data.title === "string" ? data.title : "";
    const difficultyText = String(data.difficulty ?? "").trim().toLowerCase();
    const difficulty = difficultyText === "medium" ? "Medium" : difficultyText === "hard" ? "Hard" : "Easy";
    const problemSlug =
        typeof data.problemSlug === "string"
            ? data.problemSlug
            : typeof data.problem_slug === "string"
                ? data.problem_slug
                : title
                    .trim()
                    .toLowerCase()
                    .replace(/[^a-z0-9]+/g, "-")
                    .replace(/^-+|-+$/g, "");

    const rawTimeLimitMs = data.timeLimitMs ?? data.time_limit_ms;
    const rawTimeLimit = data.timeLimit ?? data.time_limit;

    return {
        title,
        difficulty,
        problemSlug,
        timeLimit: rawTimeLimitMs !== undefined ? Number(rawTimeLimitMs) / 1000 : Number(rawTimeLimit ?? 2),
        memoryLimit: Number(data.memoryLimit ?? data.memory_limit ?? 256),
        topics: toStringArray(data.topics) ?? [],
        companyTags: toStringArray(data.companyTags ?? data.company_tags) ?? [],
        description: String(data.description ?? data.problemDescription ?? data.problem_statement ?? ""),
        examples: normalizeExamples(data.examples),
        constraints: toStringArray(data.constraints),
        sampleTestCases: normalizeTestCases(data.sampleTestCases ?? data.sample_test_cases, "sample"),
        hiddenTestCases: normalizeTestCases(data.hiddenTestCases ?? data.hidden_test_cases, "hidden"),
        codeSnippets: normalizeCodeSnippets(data.codeSnippets ?? data.code_snippets) as DSAQuestionData["codeSnippets"] | undefined,
        followUp: toStringArray(data.followUp ?? data.follow_up) ?? [],
        hints: toStringArray(data.hints) ?? [],
        judgeType: data.judgeType === "custom" ? "custom" : "default",
        checkerLanguage: (["python3", "cpp", "java", "javascript"].includes(String(data.checkerLanguage))
            ? String(data.checkerLanguage)
            : "cpp") as DSAQuestionData["checkerLanguage"],
        checkerCode: typeof data.checkerCode === "string" ? data.checkerCode : "",
        solution: normalizeSolution(data.solution),
    };
}

function parseImportedQuestionJson(rawJson: string) {
    const trimmed = rawJson.trim();
    if (!trimmed) {
        throw new Error("Paste the AI-generated question JSON first.");
    }

    const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const candidates = [
        fencedMatch?.[1]?.trim(),
        trimmed,
        trimmed.slice(trimmed.indexOf("{"), trimmed.lastIndexOf("}") + 1),
    ].filter((value): value is string => Boolean(value?.trim()));

    for (const candidate of candidates) {
        try {
            return JSON.parse(candidate);
        } catch {
            // Try the next candidate. AI tools often return fenced JSON with a short preface.
        }
    }

    throw new Error("Invalid JSON. Copy only the object returned by AI, or include it inside a ```json code fence.");
}

function stripAssignedIds(data: DSAQuestionData): DSAQuestionData {
    return {
        ...data,
        problemId: "",
        frontendId: "",
    };
}

function mergeWithDefaultData(data: Partial<DSAQuestionData>): DSAQuestionData {
    const fallback = createEmptyQuestionData();
    return {
        ...fallback,
        ...data,
        problemId: "",
        frontendId: "",
        topics: Array.isArray(data.topics) ? data.topics : fallback.topics,
        companyTags: Array.isArray(data.companyTags) ? data.companyTags : fallback.companyTags,
        examples: Array.isArray(data.examples) && data.examples.length ? data.examples : fallback.examples,
        constraints: Array.isArray(data.constraints) && data.constraints.length ? data.constraints : fallback.constraints,
        sampleTestCases: Array.isArray(data.sampleTestCases) && data.sampleTestCases.length ? data.sampleTestCases : fallback.sampleTestCases,
        hiddenTestCases: Array.isArray(data.hiddenTestCases) && data.hiddenTestCases.length ? data.hiddenTestCases : fallback.hiddenTestCases,
        codeSnippets: {
            ...fallback.codeSnippets,
            ...(data.codeSnippets || {}),
        },
        solution: {
            ...fallback.solution,
            ...(data.solution || {}),
        },
    };
}

function loadAutosavedDraft(autosaveKey: string): DSAQuestionData | null {
    if (typeof window === "undefined") return null;
    try {
        const raw = window.localStorage.getItem(autosaveKey);
        return raw ? mergeWithDefaultData(JSON.parse(raw) as Partial<DSAQuestionData>) : null;
    } catch {
        return null;
    }
}

function hasMeaningfulDraft(data: DSAQuestionData): boolean {
    return Boolean(
        data.title.trim() ||
        data.problemSlug.trim() ||
        data.description.trim() ||
        data.topics.some((topic) => topic.trim()) ||
        data.companyTags.some((company) => company.trim()) ||
        data.examples.some((example) => example.example_text.trim()) ||
        data.constraints.some((constraint) => constraint.trim()) ||
        data.sampleTestCases.some((testCase) => testCase.input.trim() || testCase.output.trim()) ||
        data.hiddenTestCases.some((testCase) => testCase.input.trim() || testCase.output.trim()) ||
        Object.values(data.codeSnippets).some((snippet) => snippet.starter_code.trim() || snippet.wrapper_code.trim()) ||
        Boolean(data.solution?.bruteForce?.explanation?.trim()) ||
        Boolean(data.solution?.optimized?.explanation?.trim())
    );
}

function humanizePath(path: Array<string | number> | undefined): string {
    if (!path?.length) return "Form";
    return path
        .map((part) => String(part))
        .join(".")
        .replace(/([A-Z])/g, " $1")
        .replace(/\b\w/g, (char) => char.toUpperCase());
}

function getValidationDetails(error: unknown): ValidationDetail[] {
    if (!(error instanceof ApiError)) return [];
    const body = error.body as { details?: unknown } | undefined;
    return Array.isArray(body?.details) ? body.details as ValidationDetail[] : [];
}

function formatValidationError(error: unknown): string | null {
    const details = getValidationDetails(error);
    if (!details.length) return null;
    return details
        .map((detail) => `${humanizePath(detail.path)}: ${detail.message || "Invalid value"}`)
        .join("\n");
}

function validateFormDataBeforeSubmit(data: DSAQuestionData): { message: string; tabIndex: number } | null {
    const checks: Array<{ valid: boolean; message: string; tabIndex: number }> = [
        { valid: !!data.title.trim(), message: "Title is required.", tabIndex: 0 },
        { valid: !!data.problemSlug.trim(), message: "Problem slug is required.", tabIndex: 0 },
        { valid: Number.isFinite(data.timeLimit) && data.timeLimit >= 0.1 && data.timeLimit <= 5, message: "CPU time limit must be between 100 and 5000 ms.", tabIndex: 3 },
        { valid: Number.isFinite(data.memoryLimit) && data.memoryLimit >= 16 && data.memoryLimit <= 256, message: "Memory limit must be between 16 and 256 MB.", tabIndex: 3 },
        { valid: data.topics.some((topic) => topic.trim()), message: "Add at least one topic.", tabIndex: 0 },
        { valid: !!data.description.trim(), message: "Problem description is required.", tabIndex: 0 },
        { valid: data.examples.some((example) => example.example_text.trim()), message: "Add at least one structured example.", tabIndex: 0 },
        { valid: data.constraints.some((constraint) => constraint.trim()), message: "Add at least one constraint.", tabIndex: 0 },
        { valid: data.sampleTestCases.some((testCase) => testCase.input.trim() && testCase.output.trim()), message: "Add at least one complete sample test case.", tabIndex: 1 },
        { valid: data.hiddenTestCases.some((testCase) => testCase.input.trim() && testCase.output.trim()), message: "Add at least one complete hidden test case.", tabIndex: 1 },
    ];
    return checks.find((check) => !check.valid) || null;
}

function isLanguageCodeEmpty(code: string | undefined | null) {
    return !code || code.trim() === "";
}

function statusPillClass(status: LanguageTestStatus | "empty") {
    if (status === "passed") return "bg-emerald-50 text-emerald-700 dark:bg-emerald-400/10 dark:text-emerald-200";
    if (status === "failed") return "bg-red-50 text-red-700 dark:bg-red-400/10 dark:text-red-200";
    if (status === "running") return "bg-primary/10 text-primary";
    if (status === "empty") return "bg-slate-100 text-slate-500 dark:bg-lc-surface dark:text-slate-400";
    return "bg-amber-50 text-amber-700 dark:bg-amber-400/10 dark:text-amber-200";
}

export function DSAQuestionForm({
    initialData,
    onPreview,
    autosaveKey = AUTOSAVE_KEY,
    fetchNextId,
    submitQuestion,
    successMessage = "Question submitted successfully",
    successDetail = "The problem is saved with a fresh server-assigned ID.",
    onSubmitSuccess,
}: DSAQuestionFormProps) {
    const { session } = useAuth();
    const successModalRef = useRef<HTMLDivElement | null>(null);
    const [loading, setLoading] = useState(false);
    const [success, setSuccess] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [activeTab, setActiveTab] = useState(0);
    const [autosaveStatus, setAutosaveStatus] = useState<"idle" | "saved" | "restored">("idle");
    const [importOpen, setImportOpen] = useState(false);
    const [importText, setImportText] = useState("");
    const [importError, setImportError] = useState<string | null>(null);
    const [fieldPromptCopied, setFieldPromptCopied] = useState(false);
    const [jsonPromptCopied, setJsonPromptCopied] = useState(false);
    const [testStatus, setTestStatus] = useState<TestResultsState>(() => createUntestedStatus());
    const [formData, setFormData] = useState<DSAQuestionData>(() => {
        if (initialData) return initialData;
        return loadAutosavedDraft(autosaveKey) || createEmptyQuestionData();
    });

    useEffect(() => {
        if (!initialData && loadAutosavedDraft(autosaveKey)) {
            setAutosaveStatus("restored");
        }
    }, [initialData, autosaveKey]);

    useEffect(() => {
        if (initialData || success) return;
        const timer = window.setTimeout(() => {
            if (!hasMeaningfulDraft(formData)) {
                window.localStorage.removeItem(autosaveKey);
                setAutosaveStatus("idle");
                return;
            }
            window.localStorage.setItem(autosaveKey, JSON.stringify(stripAssignedIds(formData)));
            setAutosaveStatus("saved");
        }, 600);
        return () => window.clearTimeout(timer);
    }, [formData, initialData, success, autosaveKey]);

    useEffect(() => {
        if (!success || !successModalRef.current) return;
        party.confetti(successModalRef.current, {
            count: party.variation.range(80, 140),
            size: party.variation.range(0.75, 1.25),
        });
    }, [success]);

    useEffect(() => {
        const loadNextId = async () => {
            if (formData.problemId) return;
            try {
                const response = fetchNextId
                    ? await fetchNextId(session?.access_token)
                    : await api.get<{ success: boolean; nextId: string }>("/problem-setter/dsa/next-id", session?.access_token);
                if (response.success && response.nextId) {
                    setFormData((prev) => ({
                        ...prev,
                        problemId: response.nextId,
                        frontendId: response.nextId,
                    }));
                }
            } catch (err) {
                console.error("Failed to fetch next ID:", err);
            }
        };
        if (session?.access_token) {
            loadNextId();
        }
    }, [session?.access_token, formData.problemId, fetchNextId]);

    useEffect(() => {
        const slug = formData.title
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-+|-+$/g, "");
        if (slug && formData.problemSlug !== slug) {
            setFormData((prev) => ({ ...prev, problemSlug: slug }));
        }
    }, [formData.problemSlug, formData.title]);

    const optimizedPassed =
        testStatus.optimized.python3 === "passed" &&
        testStatus.optimized.cpp === "passed" &&
        testStatus.optimized.java === "passed" &&
        testStatus.optimized.javascript === "passed";

    const bruteForcePassedOrEmpty = (lang: "python3" | "cpp" | "java" | "javascript") => {
        const code = formData.solution?.bruteForce?.code?.[lang];
        // A brute force that TLEs is acceptable — the problem is designed for it
        // to time out. Only a real failure (WA/CE/RE) blocks submission.
        const status = testStatus.bruteForce[lang];
        return isLanguageCodeEmpty(code) || status === "passed" || status === "tle";
    };

    const brutePassed =
        bruteForcePassedOrEmpty("python3") &&
        bruteForcePassedOrEmpty("cpp") &&
        bruteForcePassedOrEmpty("java") &&
        bruteForcePassedOrEmpty("javascript");

    const canSubmit = optimizedPassed && brutePassed;

    const optimizedStatusItems = [
        { label: "Python 3", status: testStatus.optimized.python3 },
        { label: "C++", status: testStatus.optimized.cpp },
        { label: "Java", status: testStatus.optimized.java },
        { label: "JavaScript", status: testStatus.optimized.javascript },
    ];

    const bruteStatusItems = [
        { label: "Python 3", status: testStatus.bruteForce.python3, hasCode: !isLanguageCodeEmpty(formData.solution?.bruteForce?.code?.python3) },
        { label: "C++", status: testStatus.bruteForce.cpp, hasCode: !isLanguageCodeEmpty(formData.solution?.bruteForce?.code?.cpp) },
        { label: "Java", status: testStatus.bruteForce.java, hasCode: !isLanguageCodeEmpty(formData.solution?.bruteForce?.code?.java) },
        { label: "JavaScript", status: testStatus.bruteForce.javascript, hasCode: !isLanguageCodeEmpty(formData.solution?.bruteForce?.code?.javascript) },
    ];

    const optionalBruteMissing = canSubmit && bruteStatusItems.some((item) => !item.hasCode);
    const autosaveLabel = autosaveStatus === "restored" ? "Draft restored" : autosaveStatus === "saved" ? "Draft saved" : "Draft not saved yet";
    const autosaveMessage = autosaveStatus === "restored"
        ? "Draft restored from this browser. A fresh question ID preview will be assigned automatically."
        : "Draft autosaved in this browser. Question ID will refresh on reload and be finalized on submit.";

    const importQuestionFromJson = (rawJson: string) => {
        try {
            const parsed = parseImportedQuestionJson(rawJson);
            const importedData = stripAssignedIds(mergeWithDefaultData(normalizeImportedQuestion(parsed)));
            setFormData(importedData);
            setTestStatus(createUntestedStatus());
            setActiveTab(0);
            setError(null);
            setImportError(null);
            setImportText("");
            setImportOpen(false);
            setAutosaveStatus("saved");
        } catch (err: unknown) {
            setImportError(err instanceof Error ? err.message : "Invalid question JSON.");
        }
    };

    const copyFieldPrompt = async () => {
        try {
            await navigator.clipboard.writeText(AI_FIELD_ASSIST_PROMPT);
            setFieldPromptCopied(true);
            setImportError(null);
            window.setTimeout(() => setFieldPromptCopied(false), 1800);
        } catch {
            setImportOpen(true);
            setImportError("Clipboard access was blocked. Copy the AI prompt below manually.");
        }
    };

    const copyJsonPrompt = async () => {
        try {
            await navigator.clipboard.writeText(AI_JSON_PROMPT);
            setJsonPromptCopied(true);
            setImportError(null);
            window.setTimeout(() => setJsonPromptCopied(false), 1800);
        } catch {
            setImportOpen(true);
            setImportError("Clipboard access was blocked. Copy the JSON prompt below manually.");
        }
    };

    const handleSubmit = async (event: React.FormEvent) => {
        event.preventDefault();

        const clientValidationError = validateFormDataBeforeSubmit(formData);
        if (clientValidationError) {
            setActiveTab(clientValidationError.tabIndex);
            setError(clientValidationError.message);
            return;
        }

        if (!canSubmit) {
            setActiveTab(3);
            setError("Please run tests for all mandatory optimized solutions and any provided brute force solutions, and ensure they pass before submitting.");
            return;
        }

        setLoading(true);
        setError(null);
        setSuccess(false);

        try {
            const payload = {
                ...stripAssignedIds(formData),
                constraints: formData.constraints.filter((constraint) => constraint.trim()),
                examples: formData.examples.filter((example) => example.example_text.trim()),
                hints: formData.hints.filter((hint) => hint.trim()),
                followUp: formData.followUp.filter((question) => question.trim()),
                companyTags: [],
            };

            if (submitQuestion) {
                await submitQuestion(payload, session?.access_token);
            } else {
                await api.post("/problem-setter/dsa", payload, session?.access_token);
            }

            window.localStorage.removeItem(autosaveKey);
            setSuccess(true);

            if (onSubmitSuccess) {
                setTimeout(onSubmitSuccess, 1200);
            } else {
                setTimeout(() => window.location.reload(), 2800);
            }
        } catch (err: unknown) {
            const details = getValidationDetails(err);
            const firstField = details[0]?.path?.[0];
            if (typeof firstField === "string" && fieldTabIndex[firstField] !== undefined) {
                setActiveTab(fieldTabIndex[firstField]);
            }
            setError(formatValidationError(err) || (err instanceof Error ? err.message : null) || "Failed to submit question");
        } finally {
            setLoading(false);
        }
    };

    const handlePreview = () => onPreview(formData);

    return (
        <form onSubmit={handleSubmit} className="space-y-6">
            {success && (
                <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-400/30 dark:bg-emerald-400/10">
                    <p className="font-semibold text-emerald-800 dark:text-emerald-200">
                        Question submitted successfully. Returning to the question bank...
                    </p>
                </div>
            )}

            {success && (
                <div className="fixed inset-0 z-[220] flex items-center justify-center bg-slate-950/60 px-4 backdrop-blur-sm">
                    <div
                        ref={successModalRef}
                        className="relative w-full max-w-md overflow-hidden rounded-2xl bg-white p-8 text-center shadow-2xl ring-1 ring-slate-200 dark:bg-lc-surface dark:ring-lc-border"
                    >
                        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-emerald-50 text-emerald-600 ring-1 ring-emerald-200 dark:bg-emerald-400/10 dark:text-emerald-200 dark:ring-emerald-400/20">
                            <span className="material-symbols-outlined text-[34px]">check_circle</span>
                        </div>
                        <p className="mt-6 text-xs font-extrabold uppercase tracking-[0.18em] text-emerald-600 dark:text-emerald-200">
                            Submission complete
                        </p>
                        <h2 className="mt-3 font-nunito text-3xl font-extrabold tracking-tight text-slate-950 dark:text-white">
                            {successMessage}
                        </h2>
                        <p className="mt-3 text-sm font-semibold leading-6 text-slate-500 dark:text-slate-400">
                            {successDetail}
                        </p>
                    </div>
                </div>
            )}

            {!success && autosaveStatus !== "idle" && (
                <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 dark:bg-primary/10">
                    <p className="text-sm font-semibold text-primary">{autosaveMessage}</p>
                </div>
            )}

            {error && (
                <div className="rounded-lg border border-red-200 bg-red-50 p-4 dark:border-red-400/30 dark:bg-red-400/10">
                    <p className="whitespace-pre-line font-semibold text-red-800 dark:text-red-200">{error}</p>
                </div>
            )}

            <div className="overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-slate-200 dark:bg-lc-surface dark:ring-lc-border">
                <div className="grid gap-4 p-4 lg:grid-cols-[1fr_auto] lg:items-center">
                    <div className="flex gap-4">
                        <div className="hidden size-12 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary sm:grid dark:bg-primary/15">
                            <span className="material-symbols-outlined">auto_awesome</span>
                        </div>
                        <div>
                            <p className="text-xs font-extrabold uppercase tracking-[0.18em] text-primary">AI-assisted import</p>
                            <h2 className="mt-1 font-nunito text-xl font-extrabold text-slate-950 dark:text-white">Generate once, paste once</h2>
                            <p className="mt-1 max-w-3xl text-sm font-semibold leading-6 text-slate-500 dark:text-slate-400">
                                Copy the JSON prompt to start a conversation with AI about your question idea. AI will ask what you want, then return a JSON with title, description, examples, constraints, and hints. Paste it here to fill the Question tab. Test cases, code snippets, and solutions are added by you separately.
                            </p>
                        </div>
                    </div>

                    <div className="flex flex-wrap gap-3 lg:justify-end">
                        <button
                            type="button"
                            onClick={copyJsonPrompt}
                            className="inline-flex h-11 items-center gap-2 rounded-full border border-primary/30 bg-primary/5 px-5 text-sm font-extrabold text-primary transition hover:bg-primary/10 dark:bg-primary/10 dark:hover:bg-primary/15"
                        >
                            <span className="material-symbols-outlined text-[20px]">content_copy</span>
                            {jsonPromptCopied ? "JSON prompt copied" : "Copy JSON prompt"}
                        </button>
                        <button
                            type="button"
                            onClick={copyFieldPrompt}
                            className="inline-flex h-11 items-center gap-2 rounded-full border border-slate-200 px-5 text-sm font-extrabold text-slate-700 transition hover:bg-slate-50 dark:border-lc-border dark:text-slate-200 dark:hover:bg-lc-hover"
                        >
                            <span className="material-symbols-outlined text-[20px]">format_quote</span>
                            {fieldPromptCopied ? "Field prompt copied" : "Copy field prompt"}
                        </button>
                        <button
                            type="button"
                            onClick={() => {
                                setImportOpen((value) => !value);
                                setImportError(null);
                            }}
                            className="inline-flex h-11 items-center gap-2 rounded-full border border-primary/30 px-5 text-sm font-extrabold text-primary transition hover:bg-primary/10 dark:hover:bg-primary/15"
                        >
                            <span className="material-symbols-outlined text-[20px]">data_object</span>
                            {importOpen ? "Close paste box" : "Paste AI JSON"}
                        </button>
                    </div>
                </div>

                {importOpen && (
                    <div className="border-t border-slate-200 bg-slate-50 p-4 dark:border-lc-border dark:bg-lc-elevated">
                        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
                            <div>
                                <label className="mb-2 block text-sm font-extrabold text-slate-800 dark:text-slate-100">
                                    AI response JSON
                                </label>
                                <textarea
                                    value={importText}
                                    onChange={(event) => setImportText(event.target.value)}
                                    rows={13}
                                    className="w-full resize-y rounded-lg border border-slate-200 bg-white px-4 py-3 font-mono text-sm leading-6 text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-primary focus:ring-4 focus:ring-primary/10 dark:border-lc-border dark:bg-lc-input dark:text-white dark:placeholder:text-slate-500"
                                    placeholder={"Paste the full JSON object here. ```json fenced output also works."}
                                />

                                {importError && (
                                    <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 dark:border-red-400/30 dark:bg-red-400/10">
                                        <p className="text-sm font-semibold text-red-800 dark:text-red-200">{importError}</p>
                                    </div>
                                )}

                                <div className="mt-4 flex flex-wrap gap-3">
                                    <button
                                        type="button"
                                        onClick={() => importQuestionFromJson(importText)}
                                        disabled={!importText.trim()}
                                        className="rounded-full bg-primary px-6 py-3 text-sm font-extrabold text-white transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
                                    >
                                        Fill Question tab from JSON
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setImportText("");
                                            setImportError(null);
                                        }}
                                        className="rounded-full border border-slate-200 px-6 py-3 text-sm font-extrabold text-slate-700 transition hover:bg-white dark:border-lc-border dark:text-slate-200 dark:hover:bg-lc-hover"
                                    >
                                        Clear paste
                                    </button>
                                </div>
                            </div>

                            <div className="rounded-xl bg-white p-4 ring-1 ring-slate-200 dark:bg-lc-surface dark:ring-lc-border">
                                <p className="text-xs font-extrabold uppercase tracking-[0.16em] text-slate-400 dark:text-slate-500">Setter flow</p>
                                <div className="mt-4 space-y-3">
                                    {[
                                        "Copy JSON prompt and paste it into ChatGPT / Claude. Describe the kind of question you want.",
                                        "AI will return a JSON with title, description, examples, constraints, and hints. Copy it.",
                                        "Paste the JSON here and click Fill form. This fills only the Question tab.",
                                        "Add test cases, code snippets, and solutions manually. Run tests, then submit.",
                                    ].map((step, index) => (
                                        <div key={step} className="flex gap-3 rounded-lg bg-slate-50 p-3 dark:bg-lc-elevated">
                                            <span className="grid size-7 shrink-0 place-items-center rounded-full bg-primary/10 text-xs font-extrabold text-primary dark:bg-primary/15">
                                                {index + 1}
                                            </span>
                                            <p className="text-sm font-bold leading-5 text-slate-600 dark:text-slate-300">{step}</p>
                                        </div>
                                    ))}
                                </div>
                                <details className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-lc-border dark:bg-lc-elevated">
                                    <summary className="cursor-pointer text-sm font-extrabold text-slate-700 dark:text-slate-200">View full JSON import prompt</summary>
                                    <pre className="mt-3 max-h-72 overflow-auto whitespace-pre-wrap rounded-lg bg-white p-3 text-xs leading-5 text-slate-600 dark:bg-lc-input dark:text-slate-300">
                                        {AI_IMPORT_PROMPT}
                                    </pre>
                                </details>
                                <details className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-lc-border dark:bg-lc-elevated">
                                    <summary className="cursor-pointer text-sm font-extrabold text-slate-700 dark:text-slate-200">View AI prompt text</summary>
                                    <pre className="mt-3 max-h-72 overflow-auto whitespace-pre-wrap rounded-lg bg-white p-3 text-xs leading-5 text-slate-600 dark:bg-lc-input dark:text-slate-300">
                                        {AI_FIELD_ASSIST_PROMPT}
                                    </pre>
                                </details>
                            </div>
                        </div>
                    </div>
                )}
            </div>

            <div className="overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-slate-200 dark:bg-lc-surface dark:ring-lc-border">
                <div className="flex overflow-x-auto border-b border-slate-200 bg-white dark:border-lc-border dark:bg-lc-surface">
                    {tabs.map((tab, index) => (
                        <button
                            key={tab.name}
                            type="button"
                            onClick={() => setActiveTab(index)}
                            className={`group relative flex min-w-[220px] items-center gap-4 whitespace-nowrap px-7 py-5 text-sm font-extrabold uppercase tracking-[0.02em] transition-colors ${
                                activeTab === index
                                    ? "text-primary"
                                    : "text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
                            }`}
                        >
                            {index < tabs.length - 1 && (
                                <span className="pointer-events-none absolute right-0 top-0 h-full w-8 translate-x-1/2 skew-x-[-24deg] border-r border-slate-200 bg-white group-hover:bg-slate-50 dark:border-lc-border dark:bg-lc-surface dark:group-hover:bg-lc-hover" />
                            )}
                            <span className={`relative z-10 grid size-9 place-items-center rounded-full border-2 text-sm font-extrabold ${
                                activeTab === index
                                    ? "border-primary bg-primary text-white"
                                    : "border-slate-300 bg-white text-slate-400 dark:border-lc-border dark:bg-lc-elevated dark:text-slate-400"
                            }`}>
                                {index + 1}
                            </span>
                            <span className="relative z-10 hidden sm:inline">{tab.name}</span>
                            <span className="relative z-10 sm:hidden">{tab.shortName}</span>
                        </button>
                    ))}
                    <div className="ml-auto hidden items-center px-6 text-xs font-extrabold uppercase tracking-[0.14em] text-slate-400 lg:flex dark:text-slate-500">
                        {autosaveLabel}
                    </div>
                </div>

                <div className="p-6 sm:p-8">
                    <div className="mb-5 text-xs font-extrabold uppercase tracking-[0.14em] text-slate-400 lg:hidden dark:text-slate-500">
                        {autosaveLabel}
                    </div>
                    {activeTab === 0 && (
                        <div className="space-y-8">
                            <BasicInfoSection formData={formData} setFormData={setFormData} />
                            <DescriptionSection formData={formData} setFormData={setFormData} />
                        </div>
                    )}
                    {activeTab === 1 && <TestCasesSection formData={formData} setFormData={setFormData} />}
                    {activeTab === 2 && <CodeSnippetsSection formData={formData} setFormData={setFormData} setTestStatus={setTestStatus} />}
                    {activeTab === 3 && <SolutionSection formData={formData} setFormData={setFormData} testStatus={testStatus} setTestStatus={setTestStatus} />}
                    {activeTab === 4 && (
                        <div className="space-y-6">
                            <div className="rounded-xl bg-slate-50 p-5 ring-1 ring-slate-200 dark:bg-lc-elevated dark:ring-lc-border">
                                <div className="mb-5 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                                    <div>
                                        <h2 className="font-nunito text-xl font-extrabold text-slate-950 dark:text-white">Quality Check</h2>
                                        <p className="mt-1 text-sm font-semibold text-slate-500 dark:text-slate-400">
                                            Run solution tests before saving this question to the contest bank.
                                        </p>
                                    </div>
                                    <span className={`rounded-full px-3 py-1 text-xs font-extrabold ${canSubmit ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-400/10 dark:text-emerald-200" : "bg-amber-50 text-amber-700 dark:bg-amber-400/10 dark:text-amber-200"}`}>
                                        {canSubmit ? "Ready to submit" : "Tests pending"}
                                    </span>
                                </div>

                                <div className="grid gap-4 lg:grid-cols-2">
                                    <div className="rounded-xl bg-white p-4 ring-1 ring-slate-200 dark:bg-lc-surface dark:ring-lc-border">
                                        <p className="text-xs font-extrabold uppercase tracking-[0.14em] text-slate-400 dark:text-slate-500">Optimized solution</p>
                                        <div className="mt-4 grid gap-2">
                                            {optimizedStatusItems.map((item) => (
                                                <div key={item.label} className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 dark:bg-lc-elevated">
                                                    <span className="text-sm font-bold text-slate-700 dark:text-slate-200">{item.label}</span>
                                                    <span className={`rounded-full px-2.5 py-1 text-xs font-extrabold ${statusPillClass(item.status)}`}>
                                                        {item.status}
                                                    </span>
                                                </div>
                                            ))}
                                        </div>
                                    </div>

                                    <div className="rounded-xl bg-white p-4 ring-1 ring-slate-200 dark:bg-lc-surface dark:ring-lc-border">
                                        <p className="text-xs font-extrabold uppercase tracking-[0.14em] text-slate-400 dark:text-slate-500">Brute force solution</p>
                                        <p className="mt-1 text-xs font-semibold text-slate-500 dark:text-slate-400">Optional unless code is provided.</p>
                                        <div className="mt-4 grid gap-2">
                                            {bruteStatusItems.map((item) => (
                                                <div key={item.label} className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 dark:bg-lc-elevated">
                                                    <span className="text-sm font-bold text-slate-700 dark:text-slate-200">{item.label}</span>
                                                    <span className={`rounded-full px-2.5 py-1 text-xs font-extrabold ${statusPillClass(item.hasCode ? item.status : "empty")}`}>
                                                        {item.hasCode ? item.status : "empty"}
                                                    </span>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                </div>
                            </div>
                            <button
                                type="button"
                                onClick={handlePreview}
                                className="inline-flex h-12 items-center justify-center rounded-full bg-primary px-6 text-sm font-extrabold text-white shadow-lg shadow-primary/20 transition hover:bg-primary/90"
                            >
                                Preview Question
                            </button>
                        </div>
                    )}
                </div>
            </div>

            <div className="flex flex-col gap-4 rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200 dark:bg-lc-surface dark:ring-lc-border lg:flex-row lg:items-center lg:justify-between">
                <div className="flex gap-3">
                    {activeTab > 0 && (
                        <button
                            type="button"
                            onClick={() => setActiveTab(activeTab - 1)}
                            className="rounded-full border border-slate-200 px-6 py-3 text-sm font-extrabold text-slate-700 transition hover:bg-slate-50 dark:border-lc-border dark:text-slate-200 dark:hover:bg-lc-hover"
                        >
                            Previous
                        </button>
                    )}
                    {activeTab < tabs.length - 1 && (
                        <button
                            type="button"
                            onClick={() => setActiveTab(activeTab + 1)}
                            className="rounded-full bg-primary px-6 py-3 text-sm font-extrabold text-white transition hover:bg-primary/90"
                        >
                            Next
                        </button>
                    )}
                </div>

                <div className="flex flex-wrap items-center gap-3">
                    {optionalBruteMissing && (
                        <span className="rounded-full bg-amber-50 px-3 py-1.5 text-xs font-extrabold text-amber-700 ring-1 ring-amber-200 dark:bg-amber-400/10 dark:text-amber-200 dark:ring-amber-400/20">
                            Brute force code missing
                        </span>
                    )}
                    <button
                        type="button"
                        onClick={handlePreview}
                        className="rounded-full border border-primary/30 px-6 py-3 text-sm font-extrabold text-primary transition hover:bg-primary/10 dark:hover:bg-primary/15"
                    >
                        Preview
                    </button>
                    <button
                        type="button"
                        onClick={() => {
                            window.localStorage.removeItem(autosaveKey);
                            window.location.reload();
                        }}
                        className="rounded-full border border-slate-200 px-6 py-3 text-sm font-extrabold text-slate-700 transition hover:bg-slate-50 dark:border-lc-border dark:text-slate-200 dark:hover:bg-lc-hover"
                    >
                        Reset
                    </button>
                    <button
                        type="submit"
                        disabled={loading || !canSubmit}
                        className="rounded-full bg-emerald-600 px-8 py-3 text-sm font-extrabold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
                        title={!canSubmit ? "All optimized solutions must be tested and passed. A brute force solution must pass or TLE (a wrong/error verdict blocks submission)." : ""}
                    >
                        {loading ? "Submitting..." : "Submit Question"}
                    </button>
                </div>
            </div>
        </form>
    );
}
