import Fastify from 'fastify';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import { env } from './lib/env.js';
import { prisma } from './lib/prisma.js';
import { redis } from './lib/redis.js';
import { resetEventLoopMetrics } from './lib/metrics.js';
import { connectMongoDB, disconnectMongo } from './lib/mongodb.js';
import { registerQuestionModels } from './lib/question-models.js';
import { contestRoutes } from './routes/contests.js';
import { contestQuestionRoutes } from './routes/contest-questions.js';
import { contestRoundRoutes } from './routes/contest-rounds.js';
import { questionRoutes } from './routes/questions.js';
import { executionRoutes } from './routes/execution.js';
import { metricsRoutes } from './routes/metrics.js';
import { startContestStateManager, stopContestStateManager } from './services/contest-state-manager.js';
import { registerWebSocketRoutes, startHeartbeat, stopHeartbeat, subscribeToSubmissionNotifications, closeAllConnections } from './lib/websocket-gateway.js';

/**
 * Contest Service Entry Point
 * Separate backend service for contest management, code execution, and leaderboard
 */

// Extend Fastify instance to include prisma
declare module 'fastify' {
  interface FastifyInstance {
    prisma: typeof prisma;
  }
}

let stateManagerInterval: NodeJS.Timeout | null = null;
let heartbeatInterval: NodeJS.Timeout | null = null;
let redisSubscriber: any = null;

const fastify = Fastify({
  logger: {
    level: env.NODE_ENV === 'development' ? 'info' : 'warn',
    transport:
      env.NODE_ENV === 'development'
        ? {
            target: 'pino-pretty',
            options: {
              colorize: true,
              translateTime: 'HH:MM:ss Z',
              ignore: 'pid,hostname',
            },
          }
        : undefined,
  },
});

/**
 * Register plugins
 */
const allowedOrigins = (env.ALLOWED_ORIGINS ?? '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

await fastify.register(cors, {
  origin:
    env.NODE_ENV === 'production'
      ? (origin, cb) => {
          if (!origin || allowedOrigins.includes(origin)) {
            cb(null, true);
            return;
          }
          cb(new Error('Not allowed by CORS'), false);
        }
      : true,
  credentials: true,
});

await fastify.register(cookie, {
  secret: env.SUPABASE_SERVICE_ROLE_KEY, // Use service role key as cookie secret
  parseOptions: {
    httpOnly: true,
    secure: env.NODE_ENV === 'production',
    sameSite: 'strict',
  },
});

/**
 * Decorate fastify with prisma
 */
fastify.decorate('prisma', prisma);

/**
 * Health check (LIVENESS) — shallow and dependency-free.
 *
 * Must NOT touch the DB or Redis. Under a contest load spike, a deep check would
 * queue behind an exhausted Postgres pool / Upstash quota and return 503, causing
 * Cloud Run / the load balancer to kill a busy-but-perfectly-alive instance right
 * when capacity is scarcest — a death spiral. If the process can answer, it's live.
 */
fastify.get('/health', async () => {
  return {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    service: 'contest-service',
    version: '0.1.0',
  };
});

/**
 * Readiness / dependency probe (for dashboards & manual checks, NOT liveness).
 * This one may report dependency failures without risking instance kills.
 */
fastify.get('/ready', async (_request, reply) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    await redis.ping();
    return { status: 'ready', timestamp: new Date().toISOString() };
  } catch (error) {
    reply.status(503);
    return {
      status: 'not-ready',
      timestamp: new Date().toISOString(),
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
});

/**
 * Root endpoint
 */
fastify.get('/', async () => {
  return {
    service: 'Contest Service',
    version: '0.1.0',
    status: 'running',
  };
});

/**
 * Register routes (will be added in subsequent tasks)
 */
await fastify.register(contestRoutes);
await fastify.register(contestQuestionRoutes);
await fastify.register(contestRoundRoutes);
await fastify.register(questionRoutes);
await fastify.register(executionRoutes);
await fastify.register(metricsRoutes);
await registerWebSocketRoutes(fastify);

// Import and register leaderboard routes
const { leaderboardRoutes } = await import('./routes/leaderboard.js');
await fastify.register(leaderboardRoutes);

/**
 * Start server
 */
async function start() {
  try {
    // Connect to MongoDB
    await connectMongoDB();
    
    // Register MongoDB question models
    registerQuestionModels();
    console.log('✅ MongoDB question models registered');

    // Start Fastify server
    await fastify.listen({
      port: env.PORT,
      host: '0.0.0.0',
    });

    // Start contest state manager
    stateManagerInterval = startContestStateManager();

    // Start submission worker
    const { startWorker } = await import('./services/submission-worker.js');
    startWorker();

    // Start WebSocket heartbeat
    heartbeatInterval = startHeartbeat();

    // Subscribe to Redis Pub/Sub for notifications
    redisSubscriber = await subscribeToSubmissionNotifications();

    resetEventLoopMetrics();

    console.log(`
╔═══════════════════════════════════════════════════════════╗
║                                                           ║
║   🏆  Contest Service Started Successfully                ║
║                                                           ║
║   Port:        ${env.PORT}                                      ║
║   Environment: ${env.NODE_ENV}                           ║
║   Database:    Connected ✅                               ║
║   Redis:       Connected ✅                               ║
║   MongoDB:     Connected ✅                               ║
║   Worker:      Started ✅                                 ║
║   WebSocket:   Started ✅                                 ║
║                                                           ║
╚═══════════════════════════════════════════════════════════╝
    `);
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
}

/**
 * Graceful shutdown
 */
process.on('SIGINT', async () => {
  console.log('\n🛑 Shutting down gracefully...');
  
  // Stop state manager
  if (stateManagerInterval) {
    stopContestStateManager(stateManagerInterval);
  }
  
  // Stop worker
  const { stopWorker } = await import('./services/submission-worker.js');
  await stopWorker();
  
  // Stop WebSocket
  if (heartbeatInterval) {
    stopHeartbeat(heartbeatInterval);
  }
  closeAllConnections();
  if (redisSubscriber) {
    await redisSubscriber.quit();
  }
  
  // Close queue
  const { closeQueue } = await import('./lib/queue.js');
  await closeQueue();
  
  // Close server and databases
  await fastify.close();
  await prisma.$disconnect();
  await disconnectMongo();

  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\n🛑 Shutting down gracefully...');
  
  // Stop state manager
  if (stateManagerInterval) {
    stopContestStateManager(stateManagerInterval);
  }
  
  // Stop worker
  const { stopWorker } = await import('./services/submission-worker.js');
  await stopWorker();
  
  // Stop WebSocket
  if (heartbeatInterval) {
    stopHeartbeat(heartbeatInterval);
  }
  closeAllConnections();
  if (redisSubscriber) {
    await redisSubscriber.quit();
  }
  
  // Close queue
  const { closeQueue } = await import('./lib/queue.js');
  await closeQueue();
  
  // Close server and databases
  await fastify.close();
  await prisma.$disconnect();
  await disconnectMongo();

  process.exit(0);
});

// Start the server
start();
