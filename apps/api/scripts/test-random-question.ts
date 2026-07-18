/**
 * Test Script: Random Question Fetching
 * ======================================
 * Verifies that the handleFetchQuestion logic returns different questions
 * across multiple calls (statistical randomness test).
 *
 * Usage: npx tsx apps/api/scripts/test-random-question.ts
 * Run from: d:\Mockr\interview_prep
 *
 * Prerequisites: .env with DATABASE_URL configured
 */

import * as dotenv from "dotenv";
import { existsSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

// Load env vars
const currentDir = path.dirname(fileURLToPath(import.meta.url));
const envCandidates = [
    path.resolve(process.cwd(), ".env"),
    path.resolve(process.cwd(), "../../.env"),
    path.resolve(currentDir, "../../../.env"),
];
const envPath = envCandidates.find((p) => existsSync(p));
dotenv.config(envPath ? { path: envPath } : undefined);

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function testRandomQuestion() {
    console.log("=== Random Question Fetch Test ===\n");

    const category = "DSA";
    const difficulties = ["Easy", "Medium", "Hard"];
    const askedQuestionIds: string[] = [];
    const NUM_TRIALS = 20;

    // Count available questions
    const totalQuestions = await prisma.question.count({
        where: {
            category,
            difficulty: { in: difficulties },
            isActive: true,
        },
    });

    console.log(`Total ${category} questions in DB: ${totalQuestions}`);
    if (totalQuestions < 2) {
        console.log("⚠ Need at least 2 questions to test randomness. Skipping.");
        await prisma.$disconnect();
        return;
    }

    // Simulate the randomized fetch logic NUM_TRIALS times
    const questionIds: string[] = [];
    for (let i = 0; i < NUM_TRIALS; i++) {
        const whereClause = {
            category,
            difficulty: { in: difficulties },
            isActive: true,
            id: { notIn: askedQuestionIds },
        };
        const totalMatching = await prisma.question.count({ where: whereClause });
        if (totalMatching === 0) break;

        const randomSkip = Math.floor(Math.random() * totalMatching);
        const question = await prisma.question.findFirst({
            where: whereClause,
            skip: randomSkip,
            select: { id: true, title: true },
        });

        if (question) {
            questionIds.push(question.id);
            console.log(`  Trial ${i + 1}: ${question.title} (skip=${randomSkip})`);
        }
    }

    // Verify randomness: unique IDs should be > 1 if we have > 1 question
    const uniqueIds = new Set(questionIds);
    console.log(`\nResults:`);
    console.log(`  Trials: ${NUM_TRIALS}`);
    console.log(`  Unique questions returned: ${uniqueIds.size}`);
    console.log(`  Available questions: ${totalQuestions}`);

    if (uniqueIds.size > 1) {
        console.log(`\n✅ PASS: Random selection is working (${uniqueIds.size} different questions returned)`);
    } else if (totalQuestions === 1) {
        console.log(`\n✅ PASS: Only 1 question in DB, so same question is expected`);
    } else {
        console.log(`\n❌ FAIL: Expected different questions but got same one every time`);
        process.exitCode = 1;
    }

    await prisma.$disconnect();
}

testRandomQuestion().catch((err) => {
    console.error("Test failed:", err);
    process.exitCode = 1;
});
