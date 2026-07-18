/**
 * validate-sql-questions.cjs
 *
 * Scans SQL questions in MongoDB, runs each solution against Judge0 ONCE,
 * stamps validated questions with { validatedAt, validationStatus } so they
 * are NEVER re-tested on subsequent runs — protecting your Judge0 billing.
 *
 * Usage:
 *   node apps/api/scripts/validate-sql-questions.cjs
 *
 * Flags:
 *   --force   Re-validate ALL questions, even previously validated ones
 *   --dry-run Print what would be tested without calling Judge0
 *
 * Required env vars (or .env):
 *   MONGODB_URI, JUDGE0_API_URL, JUDGE0_API_KEY, JUDGE0_HOST
 */

require("dotenv").config({ path: require("path").resolve(__dirname, "../../../.env") });

const mongoose = require("mongoose");

const FORCE   = process.argv.includes("--force");
const DRY_RUN = process.argv.includes("--dry-run");

// Strip surrounding quotes that dotenv sometimes leaves in values
function stripQuotes(s) { return (s || "").replace(/^["']|["']$/g, "").trim(); }

const JUDGE0_URL  = stripQuotes(process.env.JUDGE0_API_URL)  || "https://judge0-ce.p.rapidapi.com";
const JUDGE0_KEY  = stripQuotes(process.env.JUDGE0_API_KEY)  || "";
const JUDGE0_HOST = stripQuotes(process.env.JUDGE0_HOST)     || new URL(JUDGE0_URL).hostname;
const MONGO_URI   = stripQuotes(process.env.MONGODB_URI)     || stripQuotes(process.env.DATABASE_URL) || "";

// ── Minimal Judge0 helpers ────────────────────────────────────────────

function getHeaders() {
    const h = { "Content-Type": "application/json" };
    if (JUDGE0_KEY) {
        h["x-rapidapi-key"]  = JUDGE0_KEY;
        h["x-rapidapi-host"] = JUDGE0_HOST;
    }
    return h;
}

function b64(str) { return Buffer.from(str || "").toString("base64"); }
function fromb64(str) {
    if (!str) return "";
    try { return Buffer.from(str, "base64").toString("utf-8"); } catch { return str; }
}
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function runSolution(wrapperCode, solutionCode, languageId) {
    const isSQLite = languageId === 82;
    const query = typeof solutionCode === "string"
        ? solutionCode
        : (Object.values(solutionCode)[0] || "");

    const script = isSQLite
        ? [wrapperCode.trim(), "", ".headers on", ".mode column", "", query.trim()].join("\n")
        : [wrapperCode.trim(), "", query.trim()].join("\n");

    // Submit — ONE call per question
    const submitRes = await fetch(
        `${JUDGE0_URL}/submissions/batch?base64_encoded=true`,
        {
            method: "POST",
            headers: getHeaders(),
            body: JSON.stringify({
                submissions: [{
                    source_code: b64(script),
                    language_id: languageId,
                    stdin: null,
                    cpu_time_limit: 5,
                    memory_limit: 262144,
                }],
            }),
        }
    );

    if (!submitRes.ok) {
        const txt = await submitRes.text();
        throw new Error(`Submit failed (${submitRes.status}): ${txt}`);
    }

    const [{ token }] = await submitRes.json();

    // Poll until done
    for (let i = 0; i < 20; i++) {
        await sleep(1500);
        const pollRes = await fetch(
            `${JUDGE0_URL}/submissions/batch?tokens=${token}&base64_encoded=true&fields=*`,
            { method: "GET", headers: getHeaders() }
        );
        if (!pollRes.ok) continue;
        const { submissions: [sub] } = await pollRes.json();
        if (sub.status?.id === 1 || sub.status?.id === 2) continue; // still running

        return {
            statusId:      sub.status?.id,
            statusDesc:    sub.status?.description,
            stdout:        fromb64(sub.stdout),
            stderr:        fromb64(sub.stderr),
            compileOutput: fromb64(sub.compile_output),
        };
    }
    throw new Error("Timed out waiting for Judge0");
}

// ── MongoDB schema ────────────────────────────────────────────────────

const SQLQuestionSchema = new mongoose.Schema({
    title:              String,
    wrapperCode:        String,
    solution:           mongoose.Schema.Types.Mixed,
    judge0LanguageId:   Number,
    hiddenTestCases:    [{ id: String, wrapper_code: String }],
    // Validation tracking fields — written by this script
    validatedAt:        Date,
    validationStatus:   String,   // "ok" | "failed" | "error"
    validationError:    String,
}, { collection: "sql_questions" });

const SQLQuestion = mongoose.model("SQLQuestion", SQLQuestionSchema);

// ── Main ──────────────────────────────────────────────────────────────

async function main() {
    if (!MONGO_URI) {
        console.error("❌  MONGODB_URI not set");
        process.exit(1);
    }

    console.log(`Mode: ${DRY_RUN ? "DRY RUN" : "LIVE"}${FORCE ? " + FORCE (re-validate all)" : ""}\n`);

    await mongoose.connect(MONGO_URI);
    console.log("Connected to MongoDB.\n");

    // Only fetch questions that haven't been validated yet (unless --force)
    const filter = FORCE ? {} : { validatedAt: { $exists: false } };
    const questions = await SQLQuestion.find(filter).lean();

    if (questions.length === 0) {
        console.log("✅  All questions already validated. Nothing to do.");
        console.log("    Run with --force to re-validate everything.");
        await mongoose.disconnect();
        return;
    }

    console.log(`Found ${questions.length} question(s) to validate.\n`);

    const results = { ok: [], failed: [], skipped: [] };

    for (const q of questions) {
        const langId  = q.judge0LanguageId || 82;
        const wrapper = q.hiddenTestCases?.[0]?.wrapper_code || q.wrapperCode || "";
        const label   = `"${q.title}" (lang=${langId})`;

        if (DRY_RUN) {
            console.log(`  [DRY RUN] Would test: ${label}`);
            results.skipped.push(q.title);
            continue;
        }

        process.stdout.write(`  Testing: ${label} ... `);

        let validationStatus, validationError;

        try {
            const r = await runSolution(wrapper, q.solution, langId);

            if (r.statusId === 3) {
                console.log("✅  OK");
                validationStatus = "ok";
                results.ok.push(q.title);
            } else {
                const err = r.stderr || r.compileOutput || r.statusDesc || "";
                console.log(`❌  FAIL — ${r.statusDesc}`);
                console.log(`         ${err.split("\n")[0]}`);
                validationStatus = "failed";
                validationError  = err.slice(0, 500); // cap stored error length
                results.failed.push({ title: q.title, langId, error: err });
            }
        } catch (e) {
            console.log(`❌  ERROR — ${e.message}`);
            validationStatus = "error";
            validationError  = e.message.slice(0, 500);
            results.failed.push({ title: q.title, langId, error: e.message });
        }

        // Stamp the question — prevents re-testing on future runs
        await SQLQuestion.updateOne(
            { _id: q._id },
            {
                $set: {
                    validatedAt:      new Date(),
                    validationStatus,
                    ...(validationError ? { validationError } : { $unset: { validationError: "" } }),
                },
            }
        );

        // Throttle to avoid Judge0 rate limits (1 submission every ~500ms)
        await sleep(600);
    }

    // ── Summary ───────────────────────────────────────────────────────
    console.log("\n─────────────────────────────────────────");
    if (DRY_RUN) {
        console.log(`Would have tested: ${results.skipped.length} questions`);
    } else {
        console.log(`✅  Passed : ${results.ok.length}`);
        console.log(`❌  Failed : ${results.failed.length}`);

        if (results.failed.length > 0) {
            console.log("\nFailed questions — fix by updating judge0LanguageId in MongoDB:");
            for (const f of results.failed) {
                console.log(`\n  • "${f.title}" (current lang=${f.langId})`);
                console.log(`    Error  : ${f.error?.split("\n")[0]}`);
                console.log(`    Fix    : db.sql_questions.updateOne(`);
                console.log(`               { title: "${f.title}" },`);
                console.log(`               { $set: { judge0LanguageId: 87, validatedAt: null } }`);
                console.log(`             )`);
                console.log(`    Then re-run this script to confirm the fix.`);
            }
        }
    }

    await mongoose.disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
