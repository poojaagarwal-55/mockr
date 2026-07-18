/**
 * Backfills companyTags: [] on all DSA documents that are missing the field.
 *
 * Usage (from project root):
 *   npx tsx apps/api/src/scripts/backfill-company-tags.ts
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
import { DSAQuestion } from "../models/DSAQuestion.js";

async function main() {
    const uri = process.env.MONGODB_URI;
    if (!uri) {
        console.error("❌ MONGODB_URI is not set in .env");
        process.exit(1);
    }

    console.log("🔌 Connecting to MongoDB...");
    await mongoose.connect(uri, { dbName: "mockr_questions" });
    console.log("✅ Connected\n");

    const result = await DSAQuestion.updateMany(
        { companyTags: { $exists: false } },
        { $set: { companyTags: [] } }
    );

    console.log(`✅ Backfilled companyTags: [] on ${result.modifiedCount} documents`);

    await mongoose.disconnect();
    console.log("🔌 Disconnected");
}

main().catch((err) => {
    console.error("❌ Failed:", err);
    process.exit(1);
});
