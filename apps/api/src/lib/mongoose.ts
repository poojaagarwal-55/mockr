// Note: IPv4-first DNS resolution is set in index.ts before this module loads.
import dns from "node:dns";
import mongoose from "mongoose";

let mongoConnectPromise: Promise<boolean> | null = null;
let mongoListenersAttached = false;

function attachMongoListenersOnce(): void {
    if (mongoListenersAttached) return;
    mongoose.connection.on("error", (err) => {
        console.error("MongoDB runtime error:", err);
    });

    mongoose.connection.on("disconnected", () => {
        console.warn("⚠️  MongoDB disconnected");
    });

    mongoListenersAttached = true;
}

/**
 * Connect to MongoDB Atlas using the MONGODB_URI env var.
 * Should be called once during server startup.
 */
export async function connectMongoDB(): Promise<boolean> {
    const uri = process.env.MONGODB_URI;
    if (!uri) {
        console.error("❌ MONGODB_URI is not set. MongoDB features will be unavailable.");
        return false;
    }

    attachMongoListenersOnce();

    if (mongoose.connection.readyState === 1) {
        return true;
    }

    if (mongoose.connection.readyState === 2 && mongoConnectPromise) {
        return mongoConnectPromise;
    }

    // Use Google DNS to resolve MongoDB Atlas SRV records (local DNS often fails)
    try {
        dns.setServers(["8.8.8.8", "8.8.4.4"]);
    } catch {
        // setServers may throw if already connected; safe to ignore
    }

    mongoose.set("bufferCommands", false);

    mongoConnectPromise = mongoose.connect(uri, {
        dbName: "mockr_questions", // dedicated database for questions
        serverSelectionTimeoutMS: 5000,
        // Explicit pool sizing so hundreds of concurrent question reads don't
        // starve on Mongoose's implicit default of 10 connections.
        maxPoolSize: 25,
        minPoolSize: 5,
    }).then(() => {
        console.log("✅ MongoDB connected successfully");
        return true;
    }).catch((err) => {
        console.error("❌ MongoDB connection error:", err);
        // Don't crash the server — MongoDB is additive, Prisma/Postgres is primary
        return false;
    }).finally(() => {
        mongoConnectPromise = null;
    });

    return mongoConnectPromise;
}

export async function ensureMongoDBConnected(): Promise<void> {
    const connected = await connectMongoDB();
    if (!connected || mongoose.connection.readyState !== 1) {
        throw new Error("Question bank is temporarily unavailable. Please retry in a few seconds.");
    }
}

export function isMongoConnected(): boolean {
    return mongoose.connection.readyState === 1;
}
