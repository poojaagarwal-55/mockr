/**
 * fix-genai-starter-code.ts
 *
 * Patches the starterCode of two GenAI coding questions that use Python 3.9+
 * list[dict] type hints, which crash on Judge0's Python 3.8 runtime with:
 *   TypeError: 'type' object is not subscriptable
 *
 * Fix: prepend `from __future__ import annotations` so all annotations are
 * treated as strings (lazy evaluation) — fully backwards-compatible to Py 3.7.
 *
 * Run with:
 *   npx tsx src/scripts/fix-genai-starter-code.ts
 */

import mongoose from "mongoose";
import * as dotenv from "dotenv";
import * as path from "path";
import * as url from "url";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
// .env lives at monorepo root — 4 levels up from src/scripts/
dotenv.config({ path: path.resolve(__dirname, "../../../../.env") });

const MONGO_URI = process.env.MONGODB_URI || process.env.MONGO_URI || "";
if (!MONGO_URI) {
    console.error("❌ No MONGODB_URI in environment. Check your .env file.");
    process.exit(1);
}

// The two question IDs that need fixing
const FIXES: Array<{ id: string; title: string; reason: string }> = [
    {
        id: "69f436b39333db3a46f2b730",
        title: "Build a RAG Retrieval Function",
        reason: "retrieve() return type uses list[dict] — Python 3.9+ only",
    },
    {
        id: "69f436b39333db3a46f2b732",
        title: "Build a Token-Aware Context Window Manager",
        reason: "get_context() return type uses list[dict] — Python 3.9+ only",
    },
];

const FUTURE_IMPORT = "from __future__ import annotations\n";

async function main() {
    console.log("🔌 Connecting to MongoDB…");
    await mongoose.connect(MONGO_URI);
    const db = mongoose.connection.db!;
    const col = db.collection("genai_coding_questions");

    for (const fix of FIXES) {
        const oid = new mongoose.Types.ObjectId(fix.id);
        const doc = await col.findOne({ _id: oid });

        if (!doc) {
            console.warn(`⚠️  Document ${fix.id} not found — skipping.`);
            continue;
        }

        const currentCode: string = doc.starterCode ?? "";

        if (currentCode.startsWith(FUTURE_IMPORT)) {
            console.log(`✅ "${fix.title}" already patched — skipping.`);
            continue;
        }

        const patchedCode = FUTURE_IMPORT + currentCode;

        await col.updateOne({ _id: oid }, { $set: { starterCode: patchedCode } });
        console.log(`✅ Patched "${fix.title}"`);
        console.log(`   Reason: ${fix.reason}`);
        console.log(`   First line added: ${FUTURE_IMPORT.trim()}`);
    }

    console.log("\n🎉 Done. Restart the dev server for changes to take effect.");
    await mongoose.disconnect();
}

main().catch((err) => {
    console.error("❌ Script failed:", err);
    process.exit(1);
});
