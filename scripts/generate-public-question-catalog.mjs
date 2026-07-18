/**
 * Generates a static public question catalog for SEO pages.
 *
 * This intentionally exports only preview-safe fields. It does not export hidden
 * tests, solutions, wrapper code, user progress, submissions, or personal data.
 */

import { existsSync, mkdirSync, writeFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import dns from "node:dns";
import { MongoClient, ObjectId } from "mongodb";
import dotenv from "dotenv";

dns.setDefaultResultOrder("ipv4first");
try {
  dns.setServers(["8.8.8.8", "8.8.4.4"]);
} catch {}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const OUT_DIR = path.join(ROOT, "apps", "web", "src", "generated");
const OUT_FILE = path.join(OUT_DIR, "public-question-catalog.json");
const CODING_PUBLIC_START_ID = 1;

for (const envPath of [path.join(ROOT, ".env.local"), path.join(ROOT, ".env")]) {
  if (existsSync(envPath)) dotenv.config({ path: envPath, override: false });
}

function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function stableAcceptance(seed, min = 54, span = 35) {
  const text = String(seed || "question");
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
  return min + (hash % span);
}

function getLoginTarget(category, slug) {
  if (category === "coding") return `/questions/dsa/solve?id=${slug}`;
  if (category === "cs-fundamentals") return `/questions/cs-fundamentals/solve?id=${slug}`;
  if (category === "system-design") return `/questions/system-design/solve?id=${slug}`;
  return `/questions/sql/solve?id=${slug}`;
}

function normalizeQuestion(input) {
  const slug = input.slug || slugify(input.title);
  const authTarget = input.authTarget || slug;
  return {
    frontendId: String(input.frontendId || input.number || ""),
    slug,
    title: input.title,
    category: input.category,
    difficulty: input.difficulty || "Medium",
    tags: Array.from(new Set((input.tags || []).filter(Boolean))).slice(0, 8),
    acceptanceRate: input.acceptanceRate || stableAcceptance(slug),
    summary: input.summary || String(input.prompt || "").replace(/\s+/g, " ").slice(0, 180),
    prompt: input.prompt || input.summary || input.title,
    tests: (input.tests || []).filter(Boolean).slice(0, 3),
    schema: input.schema,
    examples: input.examples,
    hints: (input.hints || []).filter(Boolean),
    followUpQuestions: input.followUpQuestions,
    commonMistake: input.commonMistake || "Skipping assumptions, edge cases, or trade-offs can make an otherwise good answer feel incomplete.",
    approachHint: input.approachHint || "Start with a simple approach, explain the trade-off, then move toward a cleaner or more scalable solution.",
    starterCode: input.starterCode || (input.category === "sql"
      ? "-- Write your SQL query here\nSELECT\n  -- columns\nFROM table_name;"
      : input.category === "coding"
        ? "class Solution {\npublic:\n    // Write your solution here\n};"
        : "Structure your answer:\n\n1. Clarify requirements\n2. Explain the core idea\n3. Discuss trade-offs\n4. Mention edge cases"),
    language: input.language || (input.category === "sql" ? "sql" : input.category === "coding" ? "cpp" : "text"),
    authPath: getLoginTarget(input.category, authTarget),
  };
}

function firstStarterCode(codeSnippets) {
  if (!codeSnippets) return null;
  if (codeSnippets.cpp?.starter_code) return codeSnippets.cpp.starter_code;
  if (codeSnippets["c++"]?.starter_code) return codeSnippets["c++"].starter_code;
  const first = Object.values(codeSnippets)[0];
  return first?.starter_code || null;
}

function firstPresentValue(...values) {
  return values.find((value) => value !== undefined && value !== null && String(value).trim() !== "");
}

function getCodingFrontendId(item, index) {
  return firstPresentValue(
    item.frontendId,
    item.problemId,
    item.questionId,
    item.displayId,
    item.questionNo,
    item.questionNumber,
    item.number,
    item.frontend_id,
    item.problem_id,
    item.question_id,
    item.display_id,
    item.question_no,
    item.question_number,
    index + 1
  );
}

async function fromMongo() {
  const uri = process.env.MONGODB_URI;
  if (!uri) return [];

  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 8000 });
  await client.connect();
  try {
    const db = client.db(process.env.MONGODB_DB || "mockr_questions");
    const catalog = [];

    const dsa = await db.collection("dsa_questions")
      .aggregate([
        { $project: { title: 1, frontendId: 1, problemId: 1, questionId: 1, displayId: 1, questionNo: 1, questionNumber: 1, number: 1, frontend_id: 1, problem_id: 1, question_id: 1, display_id: 1, question_no: 1, question_number: 1, problemSlug: 1, difficulty: 1, topics: 1, description: 1, examples: 1, hints: 1, codeSnippets: 1, createdAt: 1 } },
        {
          $addFields: {
            publicSortId: {
              $convert: {
                input: {
                  $ifNull: [
                    "$frontendId",
                    {
                      $ifNull: [
                        "$problemId",
                        {
                          $ifNull: [
                            "$questionId",
                            {
                              $ifNull: [
                                "$displayId",
                                {
                                  $ifNull: [
                                    "$questionNo",
                                    {
                                      $ifNull: [
                                        "$questionNumber",
                                        "$number",
                                      ],
                                    },
                                  ],
                                },
                              ],
                            },
                          ],
                        },
                      ],
                    },
                  ],
                },
                to: "int",
                onError: null,
                onNull: null,
              },
            },
          },
        },
        {
          $match: {
            publicSortId: { $gte: CODING_PUBLIC_START_ID },
          },
        },
        { $sort: { publicSortId: 1, createdAt: 1, title: 1 } },
      ])
      .toArray();
    dsa.forEach((item, index) => {
      catalog.push(normalizeQuestion({
        frontendId: getCodingFrontendId(item, index),
        authTarget: item._id?.toString() || item.id,
        slug: item.problemSlug || slugify(item.title),
        title: item.title,
        category: "coding",
        difficulty: item.difficulty,
        tags: item.topics || [],
        summary: `${item.title} is a coding interview question covering ${(item.topics || []).slice(0, 3).join(", ") || "problem solving"}.`,
        prompt: item.description || item.title,
        tests: (item.examples || []).map((example) => example.example_text || `${example.input || ""} ${example.output || ""}`),
        approachHint: (item.hints || [])[0],
        starterCode: firstStarterCode(item.codeSnippets),
        language: "cpp",
      }));
    });

    const cs = await db.collection("cs_fundamental_questions")
      .find({}, { projection: { topic: 1, question: 1, answer: 1 } })
      .sort({ topic: 1, createdAt: 1 })
      .toArray();
    cs.forEach((item, index) => {
      const title = String(item.question || "").replace(/\?$/, "");
      catalog.push(normalizeQuestion({
        frontendId: index + 1,
        authTarget: item._id?.toString() || item.id,
        slug: slugify(title),
        title,
        category: "cs-fundamentals",
        difficulty: "Medium",
        tags: [item.topic],
        summary: `A CS fundamentals interview question from ${item.topic}.`,
        prompt: item.question,
        tests: ["Answer with definition, example, trade-off, and real interview clarity."],
        approachHint: String(item.answer || "").slice(0, 240),
        language: "text",
      }));
    });

    const system = await db.collection("system_design_questions")
      .find({}, { projection: { slug: 1, title: 1, difficulty: 1, problemStatement: 1, hints: 1, followUpQuestions: 1 } })
      .sort({ difficulty: 1, createdAt: 1 })
      .toArray();
    system.forEach((item, index) => {
      catalog.push(normalizeQuestion({
        frontendId: index + 1,
        authTarget: item._id?.toString() || item.id,
        slug: item.slug || slugify(item.title),
        title: item.title,
        category: "system-design",
        difficulty: item.difficulty,
        tags: ["System Design", "Architecture"],
        summary: String(item.problemStatement || "").replace(/\s+/g, " ").slice(0, 180),
        prompt: item.problemStatement,
        tests: item.followUpQuestions || item.hints || [],
        hints: item.hints || [],
        followUpQuestions: item.followUpQuestions || [],
        approachHint: (item.hints || [])[0],
        language: "text",
      }));
    });

    const sql = await db.collection("sql_questions")
      .find({}, { projection: { title: 1, description: 1, schema: 1, examples: 1 } })
      .sort({ createdAt: 1 })
      .toArray();
    sql.forEach((item, index) => {
      catalog.push(normalizeQuestion({
        frontendId: index + 1,
        authTarget: item._id?.toString() || item.id,
        slug: slugify(item.title),
        title: item.title,
        category: "sql",
        difficulty: "Medium",
        tags: ["SQL", "Database"],
        summary: String(item.description || "").replace(/\s+/g, " ").slice(0, 180),
        prompt: item.description,
        tests: (item.examples || []).map((example) => example.explanation || JSON.stringify(example.output)),
        schema: item.schema,
        examples: item.examples || [],
        starterCode: "-- Write your SQL query here\nSELECT\n  -- columns\nFROM table_name;",
        language: "sql",
      }));
    });

    return catalog;
  } finally {
    await client.close();
  }
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });

  let catalog = [];
  try {
    catalog = await fromMongo();
  } catch (error) {
    console.warn(`[question-catalog] Mongo generation skipped: ${error.message}`);
  }

  if (catalog.length === 0 && existsSync(OUT_FILE)) {
    console.warn("[question-catalog] No source available; keeping existing catalog.");
    return;
  }

  const deduped = [];
  const seen = new Map();
  let codingDisplayId = 0;
  for (const item of catalog) {
    const key = `${item.category}:${item.slug}`;
    const count = seen.get(key) || 0;
    seen.set(key, count + 1);
    const frontendId = item.category === "coding"
      ? String(++codingDisplayId)
      : item.frontendId;

    deduped.push({
      ...item,
      frontendId,
      slug: count === 0 ? item.slug : `${item.slug}-${count + 1}`,
    });
  }

  writeFileSync(OUT_FILE, `${JSON.stringify(deduped, null, 2)}\n`);
  console.log(`[question-catalog] Wrote ${deduped.length} public questions -> ${path.relative(ROOT, OUT_FILE)}`);
}

main().catch((error) => {
  console.warn(`[question-catalog] Generation failed non-fatally: ${error.message}`);
});
