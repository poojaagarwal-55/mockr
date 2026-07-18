// ============================================
// MongoDB Connection (Mongoose)
// ============================================
// Connects to MongoDB for system design questions.
// The main app DB (users, sessions, etc.) stays on
// PostgreSQL via Prisma — this is a separate store
// for system design interview content only.

import mongoose from "mongoose";
import { connectMongoDB as connectUnifiedMongo } from "./mongoose.js";

export async function connectMongoDB(): Promise<typeof mongoose> {
    const connected = await connectUnifiedMongo();
    if (!connected || mongoose.connection.readyState !== 1) {
        throw new Error("Question bank is temporarily unavailable. Please retry in a few seconds.");
    }
    return mongoose;
}

export { mongoose, mongoose as mongodb };
