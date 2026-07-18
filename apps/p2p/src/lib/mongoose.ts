// Note: IPv4-first DNS resolution is set in index.ts before this module loads.
import dns from "node:dns";
import mongoose from "mongoose";

/**
 * Connect to MongoDB Atlas using the MONGODB_URI env var.
 * Should be called once during server startup.
 */
export async function connectMongoDB(): Promise<void> {
    const uri = process.env.MONGODB_URI;
    if (!uri) {
        console.error("❌ MONGODB_URI is not set. MongoDB features will be unavailable.");
        return;
    }

    // Use Google DNS to resolve MongoDB Atlas SRV records (local DNS often fails)
    try {
        dns.setServers(["8.8.8.8", "8.8.4.4"]);
    } catch {
        // setServers may throw if already connected; safe to ignore
    }

    try {
        await mongoose.connect(uri, {
            dbName: "mockr_questions", // dedicated database for questions
        });
        console.log("✅ MongoDB connected successfully");
    } catch (err) {
        console.error("❌ MongoDB connection error:", err);
        // Don't crash the server — MongoDB is additive, Prisma/Postgres is primary
    }

    mongoose.connection.on("error", (err) => {
        console.error("MongoDB runtime error:", err);
    });

    mongoose.connection.on("disconnected", () => {
        console.warn("⚠️  MongoDB disconnected");
    });
}
