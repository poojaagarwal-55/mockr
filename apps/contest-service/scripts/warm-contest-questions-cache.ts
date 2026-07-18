import mongoose from 'mongoose';
import { prisma } from '../src/lib/prisma.js';
import { redis, CacheKeys, CacheTTL } from '../src/lib/redis.js';
import { connectMongoDB } from '../src/lib/mongodb.js';
import { getContestQuestions } from '../src/services/question-service.js';

function parseArgs() {
  const args = process.argv.slice(2);
  const contestId = args.find((arg) => !arg.startsWith('--'));
  const ttlArg = args.find((arg) => arg.startsWith('--ttl='));
  const ttlSeconds = ttlArg
    ? Number(ttlArg.slice('--ttl='.length))
    : CacheTTL.contestQuestions;

  if (!contestId) {
    throw new Error('Usage: npm run cache:warm-contest-questions -- <contestId> [--ttl=21600]');
  }

  if (!Number.isInteger(ttlSeconds) || ttlSeconds <= 0) {
    throw new Error('--ttl must be a positive number of seconds');
  }

  return { contestId, ttlSeconds };
}

async function main() {
  const { contestId, ttlSeconds } = parseArgs();
  const cacheKey = `${CacheKeys.contestQuestions(contestId)}:ide-v8`;

  console.log(`[warm-contest-cache] Contest: ${contestId}`);
  console.log(`[warm-contest-cache] Cache key: ${cacheKey}`);
  console.log(`[warm-contest-cache] TTL: ${ttlSeconds}s`);

  await connectMongoDB();

  const contest = await prisma.contest.findUnique({
    where: { id: contestId },
    select: {
      id: true,
      title: true,
      status: true,
      startTime: true,
      endTime: true,
      _count: { select: { questions: true } },
    },
  });

  if (!contest) {
    throw new Error(`Contest not found: ${contestId}`);
  }

  console.log(`[warm-contest-cache] Title: ${contest.title}`);
  console.log(`[warm-contest-cache] Status: ${contest.status}`);
  console.log(`[warm-contest-cache] Window: ${contest.startTime.toISOString()} -> ${contest.endTime.toISOString()}`);
  console.log(`[warm-contest-cache] Expected questions: ${contest._count.questions}`);

  await redis.del(cacheKey);
  const questions = await getContestQuestions(contestId);

  if (questions.length !== contest._count.questions) {
    throw new Error(
      `Cache warmup incomplete: cached ${questions.length}/${contest._count.questions} questions`
    );
  }

  await redis.setex(cacheKey, ttlSeconds, questions);

  const cachedQuestions = await redis.get<any[]>(cacheKey);
  const cachedCount = Array.isArray(cachedQuestions) ? cachedQuestions.length : 0;
  const ttl = typeof (redis as any).ttl === 'function' ? await (redis as any).ttl(cacheKey) : ttlSeconds;

  if (cachedCount !== contest._count.questions) {
    throw new Error(
      `Redis verification failed: Redis has ${cachedCount}/${contest._count.questions} questions`
    );
  }

  console.log(`[warm-contest-cache] Redis verified: ${cachedCount} questions cached`);
  console.log(`[warm-contest-cache] Redis TTL: ${ttl}s`);
}

main()
  .catch((error) => {
    console.error('[warm-contest-cache] Failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => {});
    await mongoose.disconnect().catch(() => {});
  });
