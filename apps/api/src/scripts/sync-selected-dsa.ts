import dns from "node:dns";
dns.setDefaultResultOrder("ipv4first");
try { dns.setServers(["8.8.8.8", "8.8.4.4"]); } catch {}

import * as dotenv from "dotenv";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import mongoose from "mongoose";

const currentDir =
  typeof __dirname !== "undefined"
    ? __dirname
    : fileURLToPath(new URL(".", (import.meta as any).url));

const envCandidates = [
  path.resolve(process.cwd(), ".env"),
  path.resolve(process.cwd(), "../../.env"),
  path.resolve(currentDir, "../../../../.env"),
];
const envPath = envCandidates.find((p) => existsSync(p));
dotenv.config(envPath ? { path: envPath } : undefined);

const SELECTED_FILES = [
  "0008-string-to-integer-atoi.json",
  "0013-roman-to-integer.json",
  "0021-merge-two-sorted-lists.json",
  "0023-merge-k-sorted-lists.json",
  "0024-swap-nodes-in-pairs.json",
  "0031-next-permutation.json",
  "0034-find-first-and-last-position-of-element-in-sorted-array.json",
  "0036-valid-sudoku.json",
  "0037-sudoku-solver.json",
  "0043-multiply-strings.json",
];

function resolveQuestionsDir(): string {
  const candidates = [
    path.resolve(process.cwd(), "Questions", "DSA_questions"),
    path.resolve(currentDir, "../../../../Questions/DSA_questions"),
  ];
  const found = candidates.find((p) => existsSync(p));
  if (!found) {
    throw new Error(`Cannot find Questions/DSA_questions. Tried:\n${candidates.join("\n")}`);
  }
  return found;
}

type AnyObj = Record<string, any>;

function buildApproach(raw: any): AnyObj | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;

  const approach: AnyObj = {};
  if (typeof raw.explanation === "string") approach.explanation = raw.explanation;
  if (typeof raw.timeComplexity === "string") approach.timeComplexity = raw.timeComplexity;
  if (typeof raw.spaceComplexity === "string") approach.spaceComplexity = raw.spaceComplexity;

  const code: Record<string, string> = {};
  const metadataKeys = new Set(["explanation", "timeComplexity", "spaceComplexity", "code"]);

  if (raw.code && typeof raw.code === "object" && !Array.isArray(raw.code)) {
    for (const [lang, snippet] of Object.entries(raw.code)) {
      if (typeof snippet === "string") code[lang] = snippet;
    }
  }

  for (const [k, v] of Object.entries(raw)) {
    if (metadataKeys.has(k)) continue;
    if (typeof v === "string") code[k] = v;
  }

  if (Object.keys(code).length > 0) approach.code = code;
  return Object.keys(approach).length > 0 ? approach : undefined;
}

function buildSolution(raw: any): AnyObj | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;

  const bruteRaw = raw.brute_force ?? raw.bruteForce;
  const optRaw = raw.optimized;

  const bruteForce = buildApproach(bruteRaw);
  const optimized = buildApproach(optRaw);

  const out: AnyObj = {};
  if (bruteForce) out.bruteForce = bruteForce;
  if (optimized) out.optimized = optimized;
  return Object.keys(out).length > 0 ? out : undefined;
}

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error("MONGODB_URI is not set in .env");
  }

  const dsaDir = resolveQuestionsDir();
  const docs: AnyObj[] = [];

  for (const file of SELECTED_FILES) {
    const fullPath = path.join(dsaDir, file);
    const raw = await fs.readFile(fullPath, "utf8");
    const q = JSON.parse(raw);

    const doc: AnyObj = {
      title: q.title,
      problemId: String(q.problem_id),
      frontendId: q.frontend_id ? String(q.frontend_id) : undefined,
      difficulty: q.difficulty,
      problemSlug: q.problem_slug,
      topics: Array.isArray(q.topics) ? q.topics : [],
      companyTags: Array.isArray(q.company_tags) ? q.company_tags : [],
      description: q.description,
      examples: Array.isArray(q.examples) ? q.examples : [],
      constraints: Array.isArray(q.constraints) ? q.constraints : [],
      sampleTestCases: Array.isArray(q.sample_test_cases) ? q.sample_test_cases : [],
      hiddenTestCases: Array.isArray(q.hidden_test_cases) ? q.hidden_test_cases : [],
      codeSnippets: q.code_snippets && typeof q.code_snippets === "object" ? q.code_snippets : {},
      followUp: Array.isArray(q.follow_up)
        ? q.follow_up
        : Array.isArray(q.follow_ups)
          ? q.follow_ups
          : [],
      hints: Array.isArray(q.hints) ? q.hints : [],
    };

    const solution = buildSolution(q.solution);
    if (solution) doc.solution = solution;

    docs.push(doc);
  }

  const problemIds = docs.map((d) => d.problemId);

  await mongoose.connect(uri, { dbName: process.env.MONGODB_DB || "mockr_questions" });

  const coll = mongoose.connection.collection("dsa_questions");
  const beforeCount = await coll.countDocuments({ problemId: { $in: problemIds } });

  const deleteRes = await coll.deleteMany({ problemId: { $in: problemIds } });
  const insertRes = await coll.insertMany(docs, { ordered: true });
  const afterCount = await coll.countDocuments({ problemId: { $in: problemIds } });

  console.log(JSON.stringify({
    selectedFiles: SELECTED_FILES.length,
    matchedBeforeDelete: beforeCount,
    deleted: deleteRes.deletedCount,
    inserted: insertRes.insertedCount,
    matchedAfterInsert: afterCount,
    problemIds,
  }, null, 2));

  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error("sync-selected-dsa failed:", err?.message || err);
  try { await mongoose.disconnect(); } catch {}
  process.exit(1);
});
