// Upsert system design questions from /sys_design/*.json into MongoDB.
// Each file contains the new architectureDiagram + notes fields. Existing
// docs are matched on `slug` and updated; new ones are inserted.
//
// Usage:  node scripts/push_system_design_questions.mjs
//
// Required env: MONGODB_URI

import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { MongoClient } from "mongodb";
import dotenv from "dotenv";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, "../.env") });
dotenv.config({ path: path.resolve(__dirname, "../apps/api/.env") });

const uri = process.env.MONGODB_URI;
if (!uri) {
    console.error("MONGODB_URI is not set. Define it in .env or apps/api/.env.");
    process.exit(1);
}

const DB_NAME = process.env.MONGODB_DB || "mockr_questions";
const COLLECTION = "system_design_questions";

async function run() {
    const client = new MongoClient(uri);
    await client.connect();

    const collection = client.db(DB_NAME).collection(COLLECTION);

    const folder = path.resolve(__dirname, "../sys_design");
    const files = (await fs.readdir(folder)).filter((f) => f.endsWith(".json"));
    console.log(`Found ${files.length} JSON files in ${folder}`);

    let upserts = 0;
    let inserts = 0;

    for (const file of files) {
        const raw = await fs.readFile(path.join(folder, file), "utf-8");
        const doc = JSON.parse(raw);

        // Mongo extended-JSON cleanup — strip {$date}/{$oid} wrappers if any.
        if (doc.createdAt?.$date) doc.createdAt = new Date(doc.createdAt.$date);
        if (doc.updatedAt?.$date) doc.updatedAt = new Date(doc.updatedAt.$date);
        delete doc._id;
        delete doc.__v;

        if (!doc.slug) {
            console.warn(`Skipping ${file}: no slug`);
            continue;
        }

        const update = {
            $set: {
                title: doc.title,
                difficulty: doc.difficulty,
                problemStatement: doc.problemStatement,
                rubricLite: doc.rubricLite,
                rubricFull: doc.rubricFull,
                hints: doc.hints || [],
                followUpQuestions: doc.followUpQuestions || [],
                architectureDiagram: doc.architectureDiagram || null,
                updatedAt: new Date(),
            },
            $setOnInsert: {
                slug: doc.slug,
                createdAt: doc.createdAt || new Date(),
            },
        };

        const res = await collection.updateOne({ slug: doc.slug }, update, { upsert: true });
        if (res.upsertedCount > 0) {
            inserts++;
            console.log(`  + inserted ${doc.slug}`);
        } else if (res.modifiedCount > 0) {
            upserts++;
            console.log(`  ~ updated  ${doc.slug}`);
        } else {
            console.log(`  = unchanged ${doc.slug}`);
        }
    }

    console.log(`\nDone. Inserted ${inserts}, updated ${upserts}.`);
    await client.close();
}

run().catch((err) => {
    console.error(err);
    process.exit(1);
});
