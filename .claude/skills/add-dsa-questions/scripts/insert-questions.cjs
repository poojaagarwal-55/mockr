#!/usr/bin/env node
/**
 * Validate and insert DSA question JSON files into MongoDB.
 *
 * Usage:
 *   node insert-questions.cjs <q1.json> [q2.json ...] [options]
 *   node insert-questions.cjs --list [regex]        # list existing questions, then exit
 *
 * Options:
 *   --collection <name>  Target collection (default: dsa_questions)
 *   --db <name>          Database name (default: from the connection string)
 *   --dry-run            Validate + check duplicates, insert nothing
 *   --update             If the slug already exists, replace that document
 *
 * Reads MONGODB_URI from apps/api/.env (falls back to apps/api/.env.local, root .env).
 * Validation is intentionally strict: a question with ANY empty field, a missing
 * language, identical brute/optimized code, or a fake company tag is rejected.
 */

const fs = require("fs");
const path = require("path");
const dns = require("dns");

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..");
for (const envPath of [
  path.join(REPO_ROOT, "apps", "api", ".env"),
  path.join(REPO_ROOT, "apps", "api", ".env.local"),
  path.join(REPO_ROOT, ".env"),
]) {
  if (fs.existsSync(envPath)) require("dotenv").config({ path: envPath });
}

const { MongoClient } = require("mongodb");

const LANGS = ["python3", "cpp", "java", "javascript"];
const FAKE_TAG = /^(ai|a\.i\.|gpt|chatgpt|claude|llm|openai|anthropic|gemini|generated|auto[- ]?generated|bot|test|sample|unknown|n\/a)$/i;

// ── CLI parsing ─────────────────────────────────────────────────────────────

const argv = process.argv.slice(2);
const flags = { collection: "dsa_questions", db: null, dryRun: false, update: false, list: null };
const files = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === "--collection") flags.collection = argv[++i];
  else if (a === "--db") flags.db = argv[++i];
  else if (a === "--dry-run") flags.dryRun = true;
  else if (a === "--update") flags.update = true;
  else if (a === "--list") flags.list = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : ".*";
  else files.push(a);
}

// ── Validation ──────────────────────────────────────────────────────────────

function isNonEmptyString(v, min = 1) {
  return typeof v === "string" && v.trim().length >= min;
}

function normCode(s) {
  return String(s || "").replace(/\s+/g, "");
}

function validateTestCase(tc, where, errors) {
  if (!isNonEmptyString(tc.id)) errors.push(`${where}: missing id`);
  if (!isNonEmptyString(tc.description)) errors.push(`${where} (${tc.id}): empty description`);
  if (!isNonEmptyString(String(tc.input ?? ""))) errors.push(`${where} (${tc.id}): empty input`);
  if (!isNonEmptyString(String(tc.output ?? ""))) errors.push(`${where} (${tc.id}): empty output`);
  if (typeof tc.input !== "string" || typeof tc.output !== "string")
    errors.push(`${where} (${tc.id}): input/output must be plain strings (stdin/stdout text)`);
}

function validateApproach(sol, name, errors) {
  if (!sol) { errors.push(`solution.${name}: missing entirely`); return; }
  if (!isNonEmptyString(sol.explanation, 100))
    errors.push(`solution.${name}.explanation: missing or under 100 chars`);
  if (!isNonEmptyString(sol.timeComplexity)) errors.push(`solution.${name}.timeComplexity: empty`);
  if (!isNonEmptyString(sol.spaceComplexity)) errors.push(`solution.${name}.spaceComplexity: empty`);
  for (const lang of LANGS) {
    const code = sol.code && sol.code[lang];
    if (!isNonEmptyString(code)) errors.push(`solution.${name}.code.${lang}: missing/empty`);
    else if (!code.includes("class Solution"))
      errors.push(`solution.${name}.code.${lang}: must define 'class Solution'`);
  }
}

function validateQuestion(q) {
  const errors = [];
  const warnings = [];

  if (!isNonEmptyString(q.title)) errors.push("title: empty");
  if (!["Easy", "Medium", "Hard"].includes(q.difficulty))
    errors.push(`difficulty: must be Easy|Medium|Hard (got '${q.difficulty}')`);
  if (!isNonEmptyString(q.problemSlug) || !/^[a-z0-9-]+$/.test(q.problemSlug))
    errors.push("problemSlug: must be non-empty kebab-case [a-z0-9-]");
  if (!isNonEmptyString(q.description, 400))
    errors.push("description: missing or under 400 chars — write the full house-style statement");
  for (const section of ["Function Description", "Input Format", "Output Format"])
    if (!String(q.description || "").includes(section))
      warnings.push(`description: missing '### ${section}' section (house style)`);

  if (!Array.isArray(q.topics) || q.topics.length < 1) errors.push("topics: need at least 1");
  if (!Array.isArray(q.constraints) || q.constraints.length < 3)
    errors.push("constraints: need at least 3");
  if (!Array.isArray(q.examples) || q.examples.length < 2)
    errors.push("examples: need at least 2");
  else q.examples.forEach((ex, i) => {
    if (!isNonEmptyString(ex.example_text, 50)) errors.push(`examples[${i}]: empty/too short`);
    else if (!/Explanation/i.test(ex.example_text))
      warnings.push(`examples[${i}]: no Explanation block`);
  });

  if (!Array.isArray(q.followUp) || q.followUp.length < 1) errors.push("followUp: need at least 1");
  if (!Array.isArray(q.hints) || q.hints.length < 2) errors.push("hints: need at least 2");

  (q.companyTags || []).forEach((tag) => {
    if (!isNonEmptyString(tag)) errors.push("companyTags: contains an empty tag");
    else if (FAKE_TAG.test(tag.trim()))
      errors.push(`companyTags: '${tag}' is not a real company tag — use real companies or []`);
  });

  if (!Array.isArray(q.sampleTestCases) || q.sampleTestCases.length < 2)
    errors.push("sampleTestCases: need at least 2");
  else q.sampleTestCases.forEach((tc) => validateTestCase(tc, "sampleTestCases", errors));

  if (!Array.isArray(q.hiddenTestCases) || q.hiddenTestCases.length < 10)
    errors.push(`hiddenTestCases: need at least 10 (got ${(q.hiddenTestCases || []).length})`);
  else {
    q.hiddenTestCases.forEach((tc) => validateTestCase(tc, "hiddenTestCases", errors));
    const ids = q.hiddenTestCases.map((t) => t.id);
    if (new Set(ids).size !== ids.length) errors.push("hiddenTestCases: duplicate ids");
    const guards = q.hiddenTestCases.filter((t) => /^tle_/.test(t.id || ""));
    if (guards.length < 2)
      errors.push(`hiddenTestCases: need >=2 'tle_*' guard cases (got ${guards.length})`);
    const payload = q.hiddenTestCases.reduce(
      (n, t) => n + String(t.input).length + String(t.output).length, 0);
    if (payload > 8_000_000)
      errors.push(`hiddenTestCases: total payload ${(payload / 1e6).toFixed(1)}MB — too close to Mongo's 16MB doc limit`);
  }

  const snippets = q.codeSnippets || {};
  for (const lang of LANGS) {
    const s = snippets[lang];
    if (!s) { errors.push(`codeSnippets.${lang}: missing`); continue; }
    if (!isNonEmptyString(s.starter_code)) errors.push(`codeSnippets.${lang}.starter_code: empty`);
    else if (!s.starter_code.includes("class Solution"))
      errors.push(`codeSnippets.${lang}.starter_code: must define 'class Solution'`);
    if (!isNonEmptyString(s.wrapper_code)) errors.push(`codeSnippets.${lang}.wrapper_code: empty`);
    else {
      if (s.wrapper_code.includes("<USER_CODE>"))
        errors.push(`codeSnippets.${lang}.wrapper_code: contains <USER_CODE> — class approach only`);
      if (!s.wrapper_code.includes("Solution"))
        errors.push(`codeSnippets.${lang}.wrapper_code: never instantiates Solution`);
    }
  }

  validateApproach(q.solution && q.solution.bruteForce, "bruteForce", errors);
  validateApproach(q.solution && q.solution.optimized, "optimized", errors);

  if (q.solution && q.solution.bruteForce && q.solution.optimized) {
    const bf = q.solution.bruteForce, op = q.solution.optimized;
    if (normCode(bf.timeComplexity) === normCode(op.timeComplexity))
      errors.push(`solution: brute and optimized have the SAME time complexity ` +
        `('${bf.timeComplexity}') — they must be genuinely different algorithms`);
    for (const lang of LANGS) {
      const a = normCode(bf.code && bf.code[lang]);
      const b = normCode(op.code && op.code[lang]);
      if (a && b && a === b)
        errors.push(`solution.code.${lang}: brute force is IDENTICAL to optimized — rejected`);
    }
  }

  if (q.timeLimit != null && (q.timeLimit < 0.1 || q.timeLimit > 5))
    errors.push("timeLimit: out of range 0.1–5");
  if (q.memoryLimit != null && (q.memoryLimit < 16 || q.memoryLimit > 256))
    errors.push("memoryLimit: out of range 16–256");

  return { errors, warnings };
}

// ── DB helpers ──────────────────────────────────────────────────────────────

async function nextFrontendId(col) {
  const top = await col
    .find({ frontendId: { $regex: "^\\d+$" } }, { projection: { frontendId: 1 } })
    .collation({ locale: "en", numericOrdering: true })
    .sort({ frontendId: -1 })
    .limit(1)
    .toArray();
  return top.length ? String(parseInt(top[0].frontendId, 10) + 1) : "1";
}

function buildDoc(q) {
  const now = new Date();
  return {
    title: q.title.trim(),
    problemId: q.problemId || q.problemSlug,
    frontendId: q.frontendId, // filled by caller when absent
    difficulty: q.difficulty,
    problemSlug: q.problemSlug,
    timeLimit: q.timeLimit ?? 2,
    memoryLimit: q.memoryLimit ?? 256,
    topics: q.topics,
    companyTags: q.companyTags || [],
    description: q.description,
    examples: q.examples,
    constraints: q.constraints,
    sampleTestCases: q.sampleTestCases,
    hiddenTestCases: q.hiddenTestCases,
    codeSnippets: q.codeSnippets,
    solution: q.solution,
    followUp: q.followUp,
    hints: q.hints,
    usedInContests: [],
    isUsedInContest: false,
    currentlyChoosedForContest: false,
    judgeType: "default",
    checkerLanguage: null,
    checkerCode: null,
    createdAt: now,
    updatedAt: now,
  };
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const uri = process.env.MONGODB_URI;
  const needDb = flags.list !== null || files.length > 0;
  if (!needDb) {
    console.error("Nothing to do. Pass question JSON files or --list.");
    process.exit(2);
  }

  // Offline validation first — no DB needed for --dry-run failures.
  const loaded = [];
  let offlineFailed = false;
  for (const file of files) {
    let q;
    try {
      q = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch (e) {
      console.error(`${file}: cannot read/parse JSON — ${e.message}`);
      offlineFailed = true;
      continue;
    }
    const { errors, warnings } = validateQuestion(q);
    console.log(`\n=== ${file} — "${q.title || "?"}" (${q.problemSlug || "?"}) ===`);
    warnings.forEach((w) => console.log(`  WARN  ${w}`));
    if (errors.length) {
      errors.forEach((e) => console.log(`  ERROR ${e}`));
      console.log(`  ✗ ${errors.length} error(s) — fix before inserting`);
      offlineFailed = true;
    } else {
      console.log(`  ✓ schema validation passed (${warnings.length} warning(s))`);
      loaded.push({ file, q });
    }
  }
  if (offlineFailed && !flags.list) process.exit(1);

  if (!uri) {
    console.error("\nMONGODB_URI not found in apps/api/.env / .env.local / root .env");
    process.exit(2);
  }
  if (uri.startsWith("mongodb+srv://")) {
    dns.setServers(
      (process.env.MONGODB_DNS_SERVERS || "1.1.1.1,8.8.8.8,8.8.4.4")
        .split(",").map((s) => s.trim()).filter(Boolean)
    );
  }

  const client = new MongoClient(uri);
  await client.connect();
  try {
    const db = flags.db ? client.db(flags.db) : client.db();
    const col = db.collection(flags.collection);

    if (flags.list !== null) {
      const re = new RegExp(flags.list, "i");
      const docs = await col
        .find(
          { $or: [{ title: re }, { problemSlug: re }, { topics: re }] },
          { projection: { frontendId: 1, title: 1, problemSlug: 1, difficulty: 1, topics: 1 } }
        )
        .collation({ locale: "en", numericOrdering: true })
        .sort({ frontendId: 1 })
        .toArray();
      console.log(`\n${docs.length} question(s) in '${flags.collection}' matching /${flags.list}/i:`);
      for (const d of docs)
        console.log(`  [${d.frontendId ?? "-"}] ${d.title}  (${d.problemSlug}, ${d.difficulty}) — ${(d.topics || []).join(", ")}`);
      return;
    }

    let inserted = 0;
    for (const { file, q } of loaded) {
      const dup = await col.findOne(
        {
          $or: [
            { problemSlug: q.problemSlug },
            { problemId: q.problemId || q.problemSlug },
            { title: new RegExp(`^${q.title.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i") },
          ],
        },
        { projection: { _id: 1, title: 1, problemSlug: 1, frontendId: 1 } }
      );

      if (dup && !flags.update) {
        console.log(`\n${file}: DUPLICATE of existing "${dup.title}" (${dup.problemSlug}) — skipped.` +
          ` Use --update to replace, or change the slug/title.`);
        continue;
      }

      const doc = buildDoc(q);
      if (!doc.frontendId) {
        doc.frontendId = dup ? dup.frontendId : await nextFrontendId(col);
      }

      if (flags.dryRun) {
        console.log(`\n${file}: dry-run OK — would ${dup ? "REPLACE" : "INSERT"} ` +
          `"${doc.title}" as frontendId ${doc.frontendId} into '${flags.collection}'`);
        continue;
      }

      if (dup) {
        doc.createdAt = undefined;
        delete doc.createdAt;
        await col.replaceOne({ _id: dup._id }, { ...doc, createdAt: new Date() });
        console.log(`\n${file}: REPLACED "${doc.title}" (${doc.problemSlug})`);
      } else {
        await col.insertOne(doc);
        console.log(`\n${file}: INSERTED "${doc.title}" (${doc.problemSlug}) ` +
          `frontendId=${doc.frontendId} — ${doc.hiddenTestCases.length} hidden cases`);
      }
      inserted++;
    }

    if (!flags.dryRun)
      console.log(`\nDone: ${inserted}/${loaded.length} question(s) written to '${flags.collection}'.`);
  } finally {
    await client.close();
  }
}

main().catch((e) => {
  console.error("FATAL:", e.message);
  process.exit(1);
});
