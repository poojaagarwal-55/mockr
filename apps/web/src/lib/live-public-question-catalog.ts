import { MongoClient } from "mongodb";
import {
  publicQuestions,
  type PublicQuestionCategory,
  type PublicQuestionPreview,
} from "@/lib/public-question-previews";

const CODING_PUBLIC_START_ID = 1;

type MongoQuestionInput = {
  frontendId?: string | number;
  authTarget?: string;
  slug?: string;
  title: string;
  category: PublicQuestionCategory;
  difficulty?: PublicQuestionPreview["difficulty"];
  tags?: string[];
  summary?: string;
  prompt?: string;
  tests?: string[];
  schema?: unknown;
  examples?: PublicQuestionPreview["examples"];
  hints?: string[];
  followUpQuestions?: string[];
  approachHint?: string;
  commonMistake?: string;
  starterCode?: string;
  language?: PublicQuestionPreview["language"];
};

type PublicDsaPreviewResponse = {
  success: boolean;
  questions?: Array<{
    _id?: string;
    title?: string;
    problemId?: string;
    frontendId?: string | number;
    problemSlug?: string;
    difficulty?: PublicQuestionPreview["difficulty"];
    topics?: string[];
    description?: string;
    examples?: Array<{ example_text?: string; input?: unknown; output?: unknown }>;
    hints?: string[];
    starterCode?: string;
  }>;
};

declare global {
  // eslint-disable-next-line no-var
  var __practersPublicMongoClient: Promise<MongoClient> | undefined;
}

function slugify(value: string) {
  return String(value || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function cleanText(value: unknown) {
  return String(value || "").replace(/[\u2013\u2014]/g, "-").replace(/\s+/g, " ").trim();
}

function stableAcceptance(seed: string, min = 54, span = 35) {
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 31 + seed.charCodeAt(index)) >>> 0;
  }
  return min + (hash % span);
}

function getLoginTarget(category: PublicQuestionCategory, target: string) {
  const encodedTarget = encodeURIComponent(target);
  if (category === "coding") return `/questions/dsa/solve?id=${encodedTarget}`;
  if (category === "cs-fundamentals") return `/questions/cs-fundamentals/solve?id=${encodedTarget}`;
  if (category === "system-design") return `/questions/system-design/solve?id=${encodedTarget}`;
  return `/questions/sql/solve?id=${encodedTarget}`;
}

function starterFor(category: PublicQuestionCategory) {
  if (category === "sql") return "-- Write your SQL query here\nSELECT\n  -- columns\nFROM table_name;";
  if (category === "coding") return "class Solution {\npublic:\n    // Write your solution here\n};";
  return "Structure your answer:\n\n1. Clarify requirements\n2. Explain the core idea\n3. Discuss trade-offs\n4. Mention edge cases";
}

function languageFor(category: PublicQuestionCategory): PublicQuestionPreview["language"] {
  if (category === "sql") return "sql";
  if (category === "coding") return "cpp";
  return "text";
}

function normalizeQuestion(input: MongoQuestionInput): PublicQuestionPreview {
  const title = cleanText(input.title || "Practice Question");
  const slug = input.slug || slugify(title);
  const language = input.language || languageFor(input.category);
  const authTarget = input.authTarget || slug;

  return {
    frontendId: String(input.frontendId || ""),
    slug,
    title,
    category: input.category,
    difficulty: input.difficulty || "Medium",
    tags: Array.from(new Set((input.tags || []).filter(Boolean))).slice(0, 8),
    acceptanceRate: stableAcceptance(slug),
    summary: cleanText(input.summary || input.prompt || title).slice(0, 180),
    prompt: input.prompt || input.summary || title,
    tests: (input.tests || []).filter(Boolean).slice(0, 3),
    schema: input.schema,
    examples: input.examples,
    hints: input.hints?.filter(Boolean),
    followUpQuestions: input.followUpQuestions,
    commonMistake: input.commonMistake || "Skipping assumptions, edge cases, or trade-offs can make an otherwise good answer feel incomplete.",
    approachHint: input.approachHint || "Start with the simplest clear approach, explain the trade-off, then move toward the cleaner answer.",
    starterCode: input.starterCode || starterFor(input.category),
    language,
    authPath: getLoginTarget(input.category, authTarget),
  };
}

function uniqueSlugs(catalog: PublicQuestionPreview[]) {
  const seen = new Map<string, number>();

  return catalog.map((item) => {
    const key = `${item.category}:${item.slug}`;
    const count = seen.get(key) || 0;
    seen.set(key, count + 1);

    if (count === 0) return item;
    return { ...item, slug: `${item.slug}-${count + 1}` };
  });
}

function formatMixed(value: unknown) {
  if (value == null) return "";
  if (typeof value === "string") return value;
  return JSON.stringify(value, null, 2);
}

function firstStarterCode(codeSnippets: any) {
  if (!codeSnippets) return "";
  if (codeSnippets.cpp?.starter_code) return codeSnippets.cpp.starter_code;
  if (codeSnippets["c++"]?.starter_code) return codeSnippets["c++"].starter_code;
  const first = Object.values(codeSnippets)[0] as { starter_code?: string } | undefined;
  return first?.starter_code || "";
}

function firstPresentValue(...values: unknown[]): string | number | undefined {
  const value = values.find((item) => item !== undefined && item !== null && String(item).trim() !== "");
  if (typeof value === "string" || typeof value === "number") return value;
  return value === undefined ? undefined : String(value);
}

function getCodingFrontendId(item: any, index: number): string | number {
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
  ) ?? index + CODING_PUBLIC_START_ID;
}

function numericFrontendId(question: PublicQuestionPreview) {
  const value = Number.parseInt(String(question.frontendId || ""), 10);
  return Number.isFinite(value) ? value : null;
}

function isPublicQuestionAllowed(question: PublicQuestionPreview) {
  if (question.category !== "coding") return true;
  const id = numericFrontendId(question);
  return id !== null && id >= CODING_PUBLIC_START_ID;
}

function applyPublicDisplayNumbering(catalog: PublicQuestionPreview[]) {
  let codingIndex = 0;

  return catalog.map((question) => {
    if (question.category !== "coding") return question;
    codingIndex += 1;
    return {
      ...question,
      frontendId: String(codingIndex),
    };
  });
}

function getServerApiBaseUrl() {
  return (process.env.NEXT_PUBLIC_API_URL || process.env.API_URL || "http://127.0.0.1:3001").replace(/\/$/, "");
}

async function getApiCodingCatalog(): Promise<PublicQuestionPreview[]> {
  const url = new URL("/problem-setter/dsa", `${getServerApiBaseUrl()}/`);
  url.searchParams.set("publicPreview", "1");
  url.searchParams.set("minFrontendId", String(CODING_PUBLIC_START_ID));
  url.searchParams.set("limit", "1000");

  const response = await fetch(url.toString(), { cache: "no-store" });
  if (!response.ok) return [];

  const payload = await response.json() as PublicDsaPreviewResponse;
  if (!payload.success || !Array.isArray(payload.questions)) return [];

  return payload.questions.map((item, index) => normalizeQuestion({
    frontendId: index + 1,
    authTarget: item._id,
    slug: item.problemSlug || slugify(item.title || ""),
    title: item.title || "Coding Interview Question",
    category: "coding",
    difficulty: item.difficulty,
    tags: item.topics || [],
    summary: `${item.title || "This question"} is a coding interview question covering ${(item.topics || []).slice(0, 3).join(", ") || "problem solving"}.`,
    prompt: item.description || item.title || "",
    tests: (item.examples || []).map((example) => example.example_text || `${formatMixed(example.input)} ${formatMixed(example.output)}`),
    approachHint: (item.hints || [])[0],
    starterCode: item.starterCode,
    language: "cpp",
  }));
}

async function getClient() {
  const uri = process.env.MONGODB_URI;
  if (!uri) return null;
  globalThis.__practersPublicMongoClient ??= new MongoClient(uri, {
    serverSelectionTimeoutMS: 3500,
  }).connect().catch((error) => {
    globalThis.__practersPublicMongoClient = undefined;
    throw error;
  });

  return globalThis.__practersPublicMongoClient;
}

async function getMongoCatalog() {
  const client = await getClient();
  if (!client) return [];

  const db = client.db(process.env.MONGODB_DB || "mockr_questions");
  const catalog: PublicQuestionPreview[] = [];

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

  dsa.forEach((item: any, index) => {
    catalog.push(normalizeQuestion({
      frontendId: index + 1,
      authTarget: item._id?.toString(),
      slug: item.problemSlug || slugify(item.title),
      title: item.title,
      category: "coding",
      difficulty: item.difficulty,
      tags: item.topics || [],
      summary: `${item.title} is a coding interview question covering ${(item.topics || []).slice(0, 3).join(", ") || "problem solving"}.`,
      prompt: item.description || item.title,
      tests: (item.examples || []).map((example: any) => example.example_text || `${formatMixed(example.input)} ${formatMixed(example.output)}`),
      approachHint: (item.hints || [])[0],
      starterCode: firstStarterCode(item.codeSnippets),
      language: "cpp",
    }));
  });

  const cs = await db.collection("cs_fundamental_questions")
    .find({}, { projection: { topic: 1, question: 1, createdAt: 1 } })
    .sort({ topic: 1, createdAt: 1 })
    .toArray();

  cs.forEach((item: any, index) => {
    const title = cleanText(item.question || "").replace(/\?$/, "");
    catalog.push(normalizeQuestion({
      frontendId: index + 1,
      authTarget: item._id?.toString(),
      slug: slugify(title),
      title,
      category: "cs-fundamentals",
      difficulty: "Medium",
      tags: [item.topic],
      summary: `A CS fundamentals interview question from ${item.topic}.`,
      prompt: item.question,
      tests: ["Login to view the full answer and save this CS fundamentals question."],
      approachHint: "Answer with a definition, a concrete example, trade-offs, and one real interview caveat.",
      language: "text",
    }));
  });

  const system = await db.collection("system_design_questions")
    .find({}, { projection: { slug: 1, title: 1, difficulty: 1, problemStatement: 1, hints: 1, followUpQuestions: 1, createdAt: 1 } })
    .sort({ difficulty: 1, createdAt: 1 })
    .toArray();

  system.forEach((item: any, index) => {
    catalog.push(normalizeQuestion({
      frontendId: index + 1,
      authTarget: item._id?.toString(),
      slug: item.slug || slugify(item.title),
      title: item.title,
      category: "system-design",
      difficulty: item.difficulty,
      tags: ["System Design", "Architecture"],
      summary: cleanText(item.problemStatement).slice(0, 180),
      prompt: item.problemStatement,
      tests: item.followUpQuestions || item.hints || [],
      hints: item.hints || [],
      followUpQuestions: item.followUpQuestions || [],
      approachHint: (item.hints || [])[0],
      language: "text",
    }));
  });

  const sql = await db.collection("sql_questions")
    .find({}, { projection: { title: 1, description: 1, schema: 1, examples: 1, createdAt: 1 } })
    .sort({ createdAt: 1 })
    .toArray();

  sql.forEach((item: any, index) => {
    catalog.push(normalizeQuestion({
      frontendId: index + 1,
      authTarget: item._id?.toString(),
      slug: slugify(item.title),
      title: item.title,
      category: "sql",
      difficulty: "Medium",
      tags: ["SQL", "Database"],
      summary: cleanText(item.description).slice(0, 180),
      prompt: item.description,
      tests: (item.examples || []).map((example: any) => {
        const input = formatMixed(example.input);
        const output = formatMixed(example.output);
        const explanation = cleanText(example.explanation);
        return `Input:\n${input}\nOutput:\n${output}${explanation ? `\nExplanation:\n${explanation}` : ""}`;
      }),
      schema: item.schema,
      examples: item.examples || [],
      starterCode: starterFor("sql"),
      language: "sql",
    }));
  });

  return uniqueSlugs(catalog);
}

export async function getLivePublicQuestions(category?: PublicQuestionCategory) {
  let apiCodingQuestions: PublicQuestionPreview[] = [];
  try {
    apiCodingQuestions = await getApiCodingCatalog();
  } catch (error) {
    console.warn("[public-question-catalog] API coding catalog unavailable.", error);
  }

  let mongoQuestions: PublicQuestionPreview[] = [];
  try {
    mongoQuestions = await getMongoCatalog();
  } catch (error) {
    console.warn("[public-question-catalog] Live Mongo catalog unavailable.", error);
  }

  const source = (() => {
    if (mongoQuestions.length > 0) {
      const nonCoding = mongoQuestions.filter((question) => question.category !== "coding");
      const coding = apiCodingQuestions.length > 0
        ? apiCodingQuestions
        : mongoQuestions.filter((question) => question.category === "coding");

      return applyPublicDisplayNumbering([...coding, ...nonCoding]);
    }

    if (apiCodingQuestions.length > 0) {
      const nonCodingFallback = publicQuestions.filter((question) => question.category !== "coding");
      return applyPublicDisplayNumbering([...apiCodingQuestions, ...nonCodingFallback]);
    }

    return applyPublicDisplayNumbering(publicQuestions.filter(isPublicQuestionAllowed));
  })();

  return category ? source.filter((question) => question.category === category) : source;
}

export async function getLivePublicQuestionBySlug(category: PublicQuestionCategory, slug: string) {
  const questions = await getLivePublicQuestions(category);
  return questions.find((question) => question.slug === slug);
}
