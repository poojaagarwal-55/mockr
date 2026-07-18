/**
 * expire-recordings.ts
 *
 * Daily cron job that:
 * 1. Deletes recordings from R2 that have passed their expiresAt date
 * 2. Marks them as EXPIRED in the database
 * 3. Cleans up orphaned multipart uploads (zombies older than 48h)
 *
 * Run via: npx tsx apps/api/src/scripts/expire-recordings.ts
 * Schedule: daily at 2am UTC via Railway cron / Cloudflare Cron Trigger
 */

import { PrismaClient } from "@prisma/client";
import { deleteRecording, abortMultipartUpload } from "../lib/r2.js";

const prisma = new PrismaClient();

const BATCH_SIZE = 100;
const ZOMBIE_THRESHOLD_MS = 48 * 60 * 60 * 1000; // 48 hours

async function expireReadyRecordings(): Promise<number> {
    let totalExpired = 0;
    let batch: { id: string; r2Key: string }[];

    do {
        batch = await prisma.interviewRecording.findMany({
            where: {
                status: "READY",
                expiresAt: { lt: new Date() },
            },
            take: BATCH_SIZE,
            select: { id: true, r2Key: true },
        });

        for (const rec of batch) {
            try {
                await deleteRecording(rec.r2Key);
                await prisma.interviewRecording.update({
                    where: { id: rec.id },
                    data: { status: "EXPIRED", r2Key: "" },
                });
                totalExpired++;
                console.log(`[ExpireRecordings] Expired: ${rec.id}`);
            } catch (err) {
                console.error(`[ExpireRecordings] Failed for ${rec.id}:`, err);
                // Continue — don't let one failure block the batch
            }
        }
    } while (batch.length === BATCH_SIZE);

    return totalExpired;
}

async function cleanupZombieUploads(): Promise<number> {
    const cutoff = new Date(Date.now() - ZOMBIE_THRESHOLD_MS);
    let totalCleaned = 0;

    const zombies = await prisma.interviewRecording.findMany({
        where: {
            status: "RECORDING",
            createdAt: { lt: cutoff },
            r2UploadId: { not: null },
        },
        take: BATCH_SIZE,
        select: { id: true, r2Key: true, r2UploadId: true },
    });

    for (const rec of zombies) {
        try {
            if (rec.r2UploadId) {
                await abortMultipartUpload(rec.r2Key, rec.r2UploadId);
            }
            await prisma.interviewRecording.update({
                where: { id: rec.id },
                data: { status: "FAILED", r2UploadId: null },
            });
            totalCleaned++;
            console.log(`[ExpireRecordings] Cleaned zombie: ${rec.id}`);
        } catch (err) {
            console.error(`[ExpireRecordings] Failed to clean zombie ${rec.id}:`, err);
        }
    }

    return totalCleaned;
}

async function main() {
    console.log("[ExpireRecordings] Starting expiry job...");

    const expired = await expireReadyRecordings();
    console.log(`[ExpireRecordings] Expired ${expired} recordings`);

    const cleaned = await cleanupZombieUploads();
    console.log(`[ExpireRecordings] Cleaned ${cleaned} zombie uploads`);

    console.log("[ExpireRecordings] Done.");
}

main()
    .catch((err) => {
        console.error("[ExpireRecordings] Fatal error:", err);
        process.exit(1);
    })
    .finally(() => prisma.$disconnect());
