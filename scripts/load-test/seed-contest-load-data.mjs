import { PrismaClient } from '@prisma/client';
import { MongoClient } from 'mongodb';

const DATABASE_URL = process.env.DATABASE_URL;
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/interviewforge_load';
const CONTEST_ID = process.env.LOAD_TEST_CONTEST_ID || 'load-contest-1000';
const QUESTION_ID = process.env.LOAD_TEST_QUESTION_ID || 'load-q-1';
const USER_COUNT = Number(process.env.LOAD_TEST_USERS || '1000');
const HIDDEN_TESTS = Number(process.env.LOAD_TEST_HIDDEN_TESTS || '20');

if (!DATABASE_URL) {
  throw new Error('DATABASE_URL is required');
}

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: DATABASE_URL,
    },
  },
});

const users = Array.from({ length: USER_COUNT }, (_, index) => ({
  userId: `load-user-${String(index + 1).padStart(4, '0')}`,
}));

async function seedPostgres() {
  await prisma.contestSubmission.deleteMany({ where: { contestId: CONTEST_ID } });
  await prisma.contestParticipant.deleteMany({ where: { contestId: CONTEST_ID } });
  await prisma.contestQuestion.deleteMany({ where: { contestId: CONTEST_ID } });
  await prisma.contest.deleteMany({ where: { id: CONTEST_ID } });

  const now = new Date();
  await prisma.contest.create({
    data: {
      id: CONTEST_ID,
      title: 'Local 1000 User Load Test',
      description: 'Synthetic contest for local load proof',
      startTime: new Date(now.getTime() - 60 * 60 * 1000),
      endTime: new Date(now.getTime() + 60 * 60 * 1000),
      status: 'ACTIVE',
      questions: {
        create: {
          questionId: QUESTION_ID,
          difficulty: 'EASY',
          points: 150,
          order: 1,
        },
      },
      participants: {
        createMany: {
          data: users,
        },
      },
    },
  });
}

async function seedMongo() {
  const client = new MongoClient(MONGODB_URI);
  await client.connect();

  try {
    const db = client.db();
    const collection = db.collection('dsa_questions');
    const hiddenTestCases = Array.from({ length: HIDDEN_TESTS }, (_, index) => ({
      input: String(index + 1),
      output: String(index + 1),
    }));

    await collection.updateOne(
      { problemId: QUESTION_ID },
      {
        $set: {
          problemId: QUESTION_ID,
          title: 'Echo Input',
          difficulty: 'Easy',
          topics: ['load-test'],
          sampleTestCases: [{ input: '1', output: '1' }],
          hiddenTestCases,
          codeSnippets: {
            cpp: {
              wrapperCode: null,
              starterCode: 'int main(){return 0;}',
            },
          },
          usedInContests: [CONTEST_ID],
          isUsedInContest: true,
          updatedAt: new Date(),
        },
        $setOnInsert: {
          createdAt: new Date(),
        },
      },
      { upsert: true }
    );
  } finally {
    await client.close();
  }
}

try {
  await seedPostgres();
  await seedMongo();
  console.log(JSON.stringify({
    ok: true,
    contestId: CONTEST_ID,
    questionId: QUESTION_ID,
    users: USER_COUNT,
    hiddenTests: HIDDEN_TESTS,
  }, null, 2));
} finally {
  await prisma.$disconnect();
}
