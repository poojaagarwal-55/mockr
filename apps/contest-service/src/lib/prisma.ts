import { PrismaClient } from '@interviewforge/db';
import { env } from './env.js';

/**
 * Prisma Client singleton with connection pooling
 * Reuses the same client instance across the application
 */
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma: PrismaClient =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
    datasources: {
      db: {
        url: env.DATABASE_URL,
      },
    },
  });

if (env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

// NOTE: shutdown is handled by the single orchestrator in index.ts, which awaits the
// full drain (worker → queue → fastify → prisma.$disconnect → mongo) before exiting.
// We deliberately do NOT register process.exit() handlers here — a competing handler
// that exited first used to truncate that drain and drop in-flight contest work.
