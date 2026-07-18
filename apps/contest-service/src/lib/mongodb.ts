import mongoose from 'mongoose';
import { env } from './env.js';
import { registerQuestionModels } from './question-models.js';

/**
 * MongoDB connection singleton for the question bank.
 *
 * IMPORTANT: Mongo is NOT required for the contest hot path. Contest entry,
 * registration, timer, submission, judging and scoring are all Postgres-backed.
 * Mongo only serves question CONTENT. So a Mongo failure must NEVER crash the
 * process — doing so previously caused a boot crash-loop under Atlas saturation,
 * which turned a partial outage into a total one. We start anyway; content routes
 * degrade to 503 until Mongo recovers.
 */
let isConnected = false;

export function isMongoConnected(): boolean {
  return isConnected && mongoose.connection.readyState === 1;
}

export async function connectMongoDB(): Promise<boolean> {
  if (isConnected) {
    return true;
  }

  try {
    await mongoose.connect(env.MONGODB_URI, {
      dbName: process.env.MONGODB_DB || 'mockr_questions',
      maxPoolSize: 25,
      minPoolSize: 5,
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
    });

    // Register question models
    registerQuestionModels();

    isConnected = true;
    console.log('✅ MongoDB connected successfully');
    return true;
  } catch (error) {
    // Do NOT process.exit — degrade gracefully instead.
    console.error('❌ MongoDB connection failed (continuing without it):', error);
    isConnected = false;
    return false;
  }
}

export async function disconnectMongo(): Promise<void> {
  try {
    await mongoose.disconnect();
  } catch {
    // Best-effort during shutdown.
  }
}

// Keep the connected flag honest if the connection drops/recovers at runtime.
mongoose.connection.on('disconnected', () => {
  isConnected = false;
});
mongoose.connection.on('connected', () => {
  isConnected = true;
});

// NOTE: shutdown (SIGINT/SIGTERM) is handled by the single orchestrator in index.ts,
// which calls disconnectMongo(). We deliberately do NOT register process.exit()
// handlers here — competing handlers used to exit the process before the main drain
// (worker, queue, fastify, prisma) finished, dropping in-flight contest work.
