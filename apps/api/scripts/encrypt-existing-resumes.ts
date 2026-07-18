/**
 * One-time migration script to encrypt existing plaintext resume data.
 *
 * Usage: npx tsx apps/api/scripts/encrypt-existing-resumes.ts
 *
 * This will encrypt `rawText` and `analysis` fields for all resumes
 * that are not yet encrypted.
 */

import * as dotenv from "dotenv";
import { existsSync } from "fs";
import path from "path";

// Load env before anything else
const envCandidates = [
    path.resolve(process.cwd(), ".env"),
    path.resolve(process.cwd(), "../../.env"),
];
const envPath = envCandidates.find((p) => existsSync(p));
dotenv.config(envPath ? { path: envPath } : undefined);

import { PrismaClient } from "@prisma/client";
import { encrypt, isEncrypted } from "../src/lib/encryption.js";

const prisma = new PrismaClient();

async function main() {
    const resumes = await prisma.resume.findMany({
        select: { id: true, rawText: true, analysis: true },
    });

    console.log(`Found ${resumes.length} resumes to check.`);
    let encrypted = 0;

    for (const resume of resumes) {
        const updates: Record<string, unknown> = {};

        if (resume.rawText && !isEncrypted(resume.rawText)) {
            updates.rawText = encrypt(resume.rawText);
        }

        if (resume.analysis) {
            const analysisStr = JSON.stringify(resume.analysis);
            if (!isEncrypted(analysisStr)) {
                updates.analysis = encrypt(analysisStr) as unknown;
            }
        }

        if (Object.keys(updates).length > 0) {
            await prisma.resume.update({
                where: { id: resume.id },
                data: updates,
            });
            encrypted++;
        }
    }

    console.log(`Encrypted ${encrypted} resumes. ${resumes.length - encrypted} were already encrypted or empty.`);
}

main()
    .catch((err) => {
        console.error("Migration failed:", err);
        process.exit(1);
    })
    .finally(() => prisma.$disconnect());
