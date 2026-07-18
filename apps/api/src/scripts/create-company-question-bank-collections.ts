import { config } from "dotenv";
import dns from "node:dns";
import mongoose from "mongoose";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

config();
config({ path: path.resolve(__dirname, "../../../../.env"), override: false });
config({ path: path.resolve(__dirname, "../../.env"), override: false });

const COMPANY_QUESTIONS_DB_NAME =
    process.env.COMPANY_QUESTIONS_MONGODB_DB || "company_questions";

const COMPANY_COLLECTIONS = [
    "dsa_questions",
    "sql_questions",
    "system_design_questions",
    "cs_fundamental_questions",
] as const;

async function main() {
    const uri = process.env.MONGODB_URI;
    if (!uri) {
        throw new Error("MONGODB_URI is not set.");
    }

    dns.setServers(["8.8.8.8", "8.8.4.4"]);
    mongoose.set("bufferCommands", false);

    await mongoose.connect(uri, {
        dbName: process.env.MONGODB_DB || "mockr_questions",
        serverSelectionTimeoutMS: 10_000,
    });

    const db = mongoose.connection.useDb(COMPANY_QUESTIONS_DB_NAME, { useCache: true }).db;
    if (!db) {
        throw new Error("MongoDB connection is not ready.");
    }

    const {
        CompanyDSAQuestion,
        CompanySQLQuestion,
        CompanySystemDesignQuestion,
        CompanyCSFundamentalQuestion,
    } = await import("../models/CompanyQuestionBank.js");

    for (const collectionName of COMPANY_COLLECTIONS) {
        const existing = await db
            .listCollections({ name: collectionName })
            .toArray();

        if (existing.length === 0) {
            await db.createCollection(collectionName);
            console.log(`Created collection: ${COMPANY_QUESTIONS_DB_NAME}.${collectionName}`);
        } else {
            console.log(`Collection already exists: ${COMPANY_QUESTIONS_DB_NAME}.${collectionName}`);
        }
    }

    await CompanyDSAQuestion.syncIndexes();
    await CompanySQLQuestion.syncIndexes();
    await CompanySystemDesignQuestion.syncIndexes();
    await CompanyCSFundamentalQuestion.syncIndexes();
    console.log(`Synced indexes for all company question bank collections.`);

    const legacyCollectionName = "company_questions";
    const legacyCollection = await db
        .listCollections({ name: legacyCollectionName })
        .toArray();

    if (legacyCollection.length > 0) {
        const count = await db.collection(legacyCollectionName).countDocuments();
        if (count === 0) {
            await db.collection(legacyCollectionName).drop();
            console.log(`Dropped empty legacy collection: ${COMPANY_QUESTIONS_DB_NAME}.${legacyCollectionName}`);
        } else {
            console.log(`Skipped legacy collection with ${count} document(s): ${COMPANY_QUESTIONS_DB_NAME}.${legacyCollectionName}`);
        }
    }
}

main()
    .catch((error) => {
        console.error(error instanceof Error ? error.message : error);
        process.exitCode = 1;
    })
    .finally(async () => {
        await mongoose.disconnect();
    });
