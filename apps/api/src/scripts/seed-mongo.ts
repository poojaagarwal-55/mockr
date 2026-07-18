/**
 * Seed script — loads all question files from Questions/ into MongoDB.
 *
 * Usage:  npx tsx apps/api/src/scripts/seed-mongo.ts
 * Run from project root (d:\Mockr\interview_prep).
 */

// Force IPv4 DNS resolution — must be before any network imports
import dns from "node:dns";
dns.setDefaultResultOrder("ipv4first");
// Use Google DNS for MongoDB Atlas SRV resolution (local DNS often fails)
try { dns.setServers(["8.8.8.8", "8.8.4.4"]); } catch {}


import * as dotenv from "dotenv";
import { existsSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

// ── Load .env ────────────────────────────────────────────────
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
import { SQLQuestion } from "../models/SQLQuestion.js";

// ── Resolve Questions directory ──────────────────────────────
function resolveQuestionsDir(): string {
    const candidates = [
        path.resolve(process.cwd(), "Questions"),
        path.resolve(currentDir, "../../../../Questions"),
    ];
    const found = candidates.find((p) => existsSync(p));
    if (!found) {
        throw new Error(
            `Cannot find Questions/ directory. Tried:\n${candidates.join("\n")}`
        );
    }
    return found;
}

// ── Seed CS Fundamentals ─────────────────────────────────────
async function seedCSFundamentals(questionsDir: string): Promise<number> {
    const dir = path.join(questionsDir, "CS_fundamentals");
    const files = await fs.readdir(dir);
    let count = 0;

    for (const file of files) {
        if (!file.endsWith(".txt")) continue;

        // Derive topic from filename: "CN_questions.txt" → "CN"
        const topic = file.replace("_questions.txt", "").toUpperCase();
        const raw = await fs.readFile(path.join(dir, file), "utf-8");

        let questions: { question: string; answer: string }[];
        try {
            questions = JSON.parse(raw);
        } catch (err) {
            console.warn(`  ⚠️  Skipping ${file} — not valid JSON`);
            continue;
        }

        for (const q of questions) {
            await CSFundamentalQuestion.updateOne(
                { topic, question: q.question },
                { $set: { topic, question: q.question, answer: q.answer } },
                { upsert: true }
            );
            count++;
        }
        console.log(`  ✓ ${file} → ${questions.length} questions (topic: ${topic})`);
    }

    return count;
}

// ── Seed DSA Questions ───────────────────────────────────────
async function seedDSAQuestions(questionsDir: string): Promise<number> {
    const dir = path.join(questionsDir, "DSA_questions");
    const files = await fs.readdir(dir);
    let count = 0;

    for (const file of files) {
        if (!file.endsWith(".json")) continue;

        const raw = await fs.readFile(path.join(dir, file), "utf-8");
        let data: any;
        try {
            data = JSON.parse(raw);
        } catch (err) {
            console.warn(`  ⚠️  Skipping ${file} — not valid JSON`);
            continue;
        }

        await DSAQuestion.updateOne(
            { problemId: data.problem_id },
            {
                $set: {
                    title: data.title,
                    problemId: data.problem_id,
                    frontendId: data.frontend_id,
                    difficulty: data.difficulty,
                    problemSlug: data.problem_slug,
                    topics: data.topics || [],
                    description: data.description,
                    examples: data.examples || [],
                    constraints: data.constraints || [],
                    sampleTestCases: data.sample_test_cases || [],
                    hiddenTestCases: data.hidden_test_cases || [],
                    codeSnippets: data.code_snippets || {},
                    followUp: data.follow_up || data.follow_ups || [],
                    hints: data.hints || [],
                },
            },
            { upsert: true }
        );
        count++;
        console.log(`  ✓ ${file} → "${data.title}" (${data.difficulty})`);
    }

    return count;
}

// ── Seed SQL Questions ───────────────────────────────────────
async function seedSQLQuestions(questionsDir: string): Promise<number> {
    const dir = path.join(questionsDir, "SQL_questions");
    const files = await fs.readdir(dir);
    let count = 0;

    for (const file of files) {
        if (!file.endsWith(".sql")) continue;

        const raw = await fs.readFile(path.join(dir, file), "utf-8");
        let data: any;
        try {
            data = JSON.parse(raw);
        } catch (err) {
            console.warn(`  ⚠️  Skipping ${file} — not valid JSON`);
            continue;
        }

        await SQLQuestion.updateOne(
            { title: data.title },
            {
                $set: {
                    title: data.title,
                    description: data.description,
                    examples: data.examples || [],
                    testCases: data.test_cases || [],
                    wrapperCode: data.wrapper_code,
                    solution: data.solution,
                    judge0LanguageId: data.judge0_language_id,
                    hiddenTestCases: data.hidden_test_cases || [],
                },
            },
            { upsert: true }
        );
        count++;
        console.log(`  ✓ ${file} → "${data.title}"`);
    }

    return count;
}

// ── Main ─────────────────────────────────────────────────────
async function main() {
    const uri = process.env.MONGODB_URI;
    if (!uri) {
        console.error("❌ MONGODB_URI is not set in .env");
        process.exit(1);
    }

    console.log("🔌 Connecting to MongoDB...");
    await mongoose.connect(uri, { dbName: "mockr_questions" });
    console.log("✅ Connected\n");

    const questionsDir = resolveQuestionsDir();
    console.log(`📁 Questions directory: ${questionsDir}\n`);

    console.log("── CS Fundamentals ──────────────────");
    const csCount = await seedCSFundamentals(questionsDir);

    console.log("\n── DSA Questions ────────────────────");
    const dsaCount = await seedDSAQuestions(questionsDir);

    console.log("\n── SQL Questions ────────────────────");
    const sqlCount = await seedSQLQuestions(questionsDir);

    console.log(`\n🎉 Seeding complete!`);
    console.log(`   CS Fundamentals: ${csCount} questions`);
    console.log(`   DSA:             ${dsaCount} questions`);
    console.log(`   SQL:             ${sqlCount} questions`);
    console.log(`   Total:           ${csCount + dsaCount + sqlCount} questions`);

    await mongoose.disconnect();
    console.log("\n🔌 MongoDB disconnected");
}

main().catch((err) => {
    console.error("❌ Seed failed:", err);
    process.exit(1);
});
