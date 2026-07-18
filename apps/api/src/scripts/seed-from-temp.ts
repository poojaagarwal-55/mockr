/**
 * Seed script — loads questions from the temp/ directory into MongoDB.
 *
 * DSA: upserts by problem_id (keeps existing, updates all fields)
 * CS Fundamentals (OS, OOPS, CN, DBMS): replaces all existing questions for each topic
 *
 * Usage (from project root):
 *   npx tsx apps/api/src/scripts/seed-from-temp.ts
 */

import dns from "node:dns";
dns.setDefaultResultOrder("ipv4first");
try { dns.setServers(["8.8.8.8", "8.8.4.4"]); } catch {}

import * as dotenv from "dotenv";
import { existsSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

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

import mongoose from "mongoose";
import fs from "fs/promises";

import { CSFundamentalQuestion } from "../models/CSFundamentalQuestion.js";
import { DSAQuestion } from "../models/DSAQuestion.js";

// ── Resolve temp/ directory ───────────────────────────────────

function resolveTempDir(): string {
    const candidates = [
        path.resolve(process.cwd(), "temp"),
        path.resolve(currentDir, "../../../../temp"),
    ];
    const found = candidates.find((p) => existsSync(p));
    if (!found) {
        throw new Error(
            `Cannot find temp/ directory. Tried:\n${candidates.join("\n")}`
        );
    }
    return found;
}

// ── Seed DSA ──────────────────────────────────────────────────

async function seedDSA(tempDir: string): Promise<number> {
    const filePath = path.join(tempDir, "DSA_combined_new.txt");
    const raw = await fs.readFile(filePath, "utf-8");

    let questions: any[];
    try {
        questions = JSON.parse(raw);
    } catch {
        throw new Error("DSA_combined_new.txt is not valid JSON");
    }

    let count = 0;
    for (const q of questions) {
        await DSAQuestion.updateOne(
            { problemId: q.problem_id },
            {
                $set: {
                    title: q.title,
                    problemId: q.problem_id,
                    frontendId: q.frontend_id,
                    difficulty: q.difficulty,
                    problemSlug: q.problem_slug,
                    topics: q.topics || [],
                    companyTags: q.company_tags || [],
                    description: q.description,
                    examples: q.examples || [],
                    constraints: q.constraints || [],
                    sampleTestCases: q.sample_test_cases || [],
                    hiddenTestCases: q.hidden_test_cases || [],
                    codeSnippets: q.code_snippets || {},
                    // solution is NOT set here — will be added later
                },
            },
            { upsert: true }
        );
        count++;
        console.log(`  ✓ "${q.title}" (${q.difficulty})`);
    }

    return count;
}

// ── Seed CS Fundamentals ──────────────────────────────────────

const TOPIC_FILE_MAP: { topic: string; file: string }[] = [
    { topic: "OS", file: "OS_questions_new.txt" },
    { topic: "OOPS", file: "OOPS_questions_new.txt" },
    { topic: "CN", file: "CN_questions_new.txt" },
    { topic: "DBMS", file: "DBMS_questions_new.txt" },
];

async function seedCSFundamentals(tempDir: string): Promise<number> {
    let total = 0;

    for (const { topic, file } of TOPIC_FILE_MAP) {
        const filePath = path.join(tempDir, file);
        const raw = await fs.readFile(filePath, "utf-8");

        let questions: { question: string; answer: string }[];
        try {
            questions = JSON.parse(raw);
        } catch {
            console.warn(`  ⚠️  Skipping ${file} — not valid JSON`);
            continue;
        }

        // Delete all existing questions for this topic
        const deleted = await CSFundamentalQuestion.deleteMany({ topic });
        console.log(`  ✗ Deleted ${deleted.deletedCount} existing ${topic} questions`);

        // Insert all new questions
        const docs = questions.map(q => ({ topic, question: q.question, answer: q.answer }));
        await CSFundamentalQuestion.insertMany(docs, { ordered: false });

        console.log(`  ✓ ${file} → ${docs.length} questions inserted (topic: ${topic})`);
        total += docs.length;
    }

    return total;
}

// ── Main ──────────────────────────────────────────────────────

async function main() {
    const uri = process.env.MONGODB_URI;
    if (!uri) {
        console.error("❌ MONGODB_URI is not set in .env");
        process.exit(1);
    }

    console.log("🔌 Connecting to MongoDB...");
    await mongoose.connect(uri, { dbName: "mockr_questions" });
    console.log("✅ Connected\n");

    const tempDir = resolveTempDir();
    console.log(`📁 Temp directory: ${tempDir}\n`);

    console.log("── DSA Questions (upsert) ───────────────");
    const dsaCount = await seedDSA(tempDir);

    console.log("\n── CS Fundamentals (replace) ────────────");
    const csCount = await seedCSFundamentals(tempDir);

    console.log(`\n🎉 Done!`);
    console.log(`   DSA:             ${dsaCount} questions upserted`);
    console.log(`   CS Fundamentals: ${csCount} questions replaced`);

    await mongoose.disconnect();
    console.log("🔌 Disconnected");
}

main().catch((err) => {
    console.error("❌ Seed failed:", err);
    process.exit(1);
});
