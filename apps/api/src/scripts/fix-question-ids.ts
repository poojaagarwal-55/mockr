#!/usr/bin/env node
/**
 * Script to fix DSA question frontendIds to be sequential (1, 2, 3, ...)
 * 
 * Usage:
 *   npx tsx apps/api/src/scripts/fix-question-ids.ts
 */

import { config } from "dotenv";
import { resolve } from "path";
import { mongoose } from "../lib/mongodb.js";
import { DSAQuestion } from "../models/DSAQuestion.js";

// Load environment variables from root .env file
const rootDir = resolve(process.cwd(), "../..");
config({ path: resolve(rootDir, ".env") });

// Also try loading from current directory
config({ path: resolve(process.cwd(), ".env") });

async function fixQuestionIds() {
    try {
        console.log("🔌 Connecting to MongoDB...");
        const uri = process.env.MONGODB_URI;
        if (!uri) {
            throw new Error("MONGODB_URI not found in environment variables");
        }

        await mongoose.connect(uri, {
            dbName: process.env.MONGODB_DB || "mockr_questions",
        });
        console.log("✅ Connected to MongoDB\n");

        // Fetch all questions sorted by their current frontendId (numeric sort)
        console.log("📥 Fetching all DSA questions...");
        const questions = await DSAQuestion.find({}).sort({ frontendId: 1 }).exec();
        console.log(`Found ${questions.length} questions\n`);

        if (questions.length === 0) {
            console.log("No questions found. Exiting.");
            await mongoose.disconnect();
            return;
        }

        console.log("🔄 Updating frontendIds to be sequential...");
        
        // Update each question with a new sequential frontendId
        for (let i = 0; i < questions.length; i++) {
            const question = questions[i];
            const newFrontendId = String(i + 1);
            
            if (question.frontendId !== newFrontendId) {
                await DSAQuestion.updateOne(
                    { _id: question._id },
                    { $set: { frontendId: newFrontendId } }
                );
                console.log(`  Updated: "${question.title}" - ${question.frontendId} → ${newFrontendId}`);
            } else {
                console.log(`  Skipped: "${question.title}" - already ${newFrontendId}`);
            }
        }

        console.log("\n✅ All question IDs have been updated!");
        console.log(`   Total questions: ${questions.length}`);
        console.log(`   IDs now range from: 1 to ${questions.length}`);

        await mongoose.disconnect();
        console.log("\n🔌 Disconnected from MongoDB");
    } catch (error) {
        console.error("❌ Error:", error);
        process.exit(1);
    }
}

// Run the script
fixQuestionIds();
