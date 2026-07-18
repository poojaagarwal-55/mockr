import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import mongoose from 'mongoose';
import { z } from 'zod';
import { authenticate, getAuthenticatedUserId } from '../middleware/auth.js';
import { verifyContestManager } from '../middleware/admin.js';
import { reconcileContestQuestionUsage } from '../services/contest-service.js';
import { normalizeStarterCodeForLanguage } from '../services/question-service.js';

const CONTEST_DSA_COUNTER_ID = 'contest_questions_frontend_id';
const CONTEST_MCQ_COUNTER_ID = 'contest_mcq_questions_frontend_id';
const MAX_ID_ALLOCATION_ATTEMPTS = 5;
const CONTEST_QUESTIONS_COLLECTION = 'contest_questions';
const CONTEST_MCQ_QUESTIONS_COLLECTION = 'contest_mcq_questions';
const QUESTION_CREATE_BODY_LIMIT_BYTES = 10 * 1024 * 1024;

type CounterDocument = {
  _id: string;
  seq?: number;
  createdAt?: Date;
  updatedAt?: Date;
};

const testCaseSchema = z.object({
  id: z.string().trim().min(1),
  description: z.string().trim().max(500).default(''),
  input: z.string(),
  output: z.string(),
});

const exampleSchema = z.object({
  example_num: z.coerce.number().int().min(1),
  example_text: z.string().trim().min(1),
});

const codeSnippetSchema = z.object({
  starter_code: z.string(),
  wrapper_code: z.string(),
});

const solutionCodeSchema = z.object({
  time_complexity: z.string().optional(),
  space_complexity: z.string().optional(),
  python3: z.string().optional(),
  cpp: z.string().optional(),
  java: z.string().optional(),
  javascript: z.string().optional(),
});

const solutionApproachSchema = z.object({
  explaination: z.string().optional(),
  explanation: z.string().optional(),
  timeComplexity: z.string().default(''),
  spaceComplexity: z.string().default(''),
  code: solutionCodeSchema.default({}),
});

const createContestDsaQuestionSchema = z.object({
  title: z.string().trim().min(1, 'Title is required').max(240),
  problemId: z.string().optional(),
  frontendId: z.string().optional(),
  difficulty: z.enum(['Easy', 'Medium', 'Hard']),
  problemSlug: z.string().trim().min(1, 'Problem slug is required').max(240),
  timeLimit: z.coerce.number().min(0.1).max(5).default(2),
  memoryLimit: z.coerce.number().int().min(16).max(256).default(256),
  topics: z.array(z.string().trim().min(1)).min(1, 'At least one topic is required').max(30),
  companyTags: z.array(z.string().trim().min(1)).max(30).default([]),
  description: z.string().trim().min(1, 'Description is required').max(30000),
  examples: z.array(exampleSchema).min(1, 'At least one example is required').max(20),
  constraints: z.array(z.string().trim().min(1)).min(1, 'At least one constraint is required').max(100),
  sampleTestCases: z.array(testCaseSchema).min(1, 'At least one sample test case is required').max(50),
  hiddenTestCases: z.array(testCaseSchema).min(1, 'At least one hidden test case is required').max(200),
  codeSnippets: z.object({
    python3: codeSnippetSchema,
    cpp: codeSnippetSchema,
    java: codeSnippetSchema,
    javascript: codeSnippetSchema,
  }),
  followUp: z.array(z.string().trim().min(1)).max(50).default([]),
  hints: z.array(z.string().trim().min(1)).max(50).default([]),
  // Special judge / custom checker (optional).
  judgeType: z.enum(['default', 'custom']).default('default'),
  checkerLanguage: z.enum(['python3', 'cpp', 'java', 'javascript']).optional().nullable(),
  checkerCode: z.string().max(60000).optional().nullable(),
  solution: z.object({
    bruteForce: solutionApproachSchema.optional(),
    optimized: solutionApproachSchema.optional(),
  }).optional(),
});

type CreateContestDsaQuestionBody = z.infer<typeof createContestDsaQuestionSchema>;

const mcqOptionSchema = z.object({
  id: z.string().trim().min(1).max(16),
  text: z.string().trim().min(1, 'Option text is required').max(10000),
  order: z.coerce.number().int().min(0).max(20).optional(),
});

const createContestMcqQuestionSchema = z.object({
  title: z.string().trim().min(1, 'Title is required').max(240),
  difficulty: z.enum(['Easy', 'Medium', 'Hard']),
  questionText: z.string().trim().min(1, 'Question text is required').max(30000),
  topics: z.array(z.string().trim().min(1)).min(1, 'At least one topic is required').max(30),
  companyTags: z.array(z.string().trim().min(1)).max(30).default([]),
  options: z.array(mcqOptionSchema).min(2, 'At least two options are required').max(6, 'At most six options are allowed'),
  correctOptionId: z.string().trim().min(1, 'Correct option is required').max(16),
  explanation: z.string().trim().min(1, 'Explanation is required').max(30000),
}).superRefine((data, ctx) => {
  const optionIds = data.options.map((option) => option.id);
  const uniqueOptionIds = new Set(optionIds);
  if (uniqueOptionIds.size !== optionIds.length) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['options'],
      message: 'Option IDs must be unique',
    });
  }

  if (!uniqueOptionIds.has(data.correctOptionId)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['correctOptionId'],
      message: 'Correct option must match one of the options',
    });
  }
});

type CreateContestMcqQuestionBody = z.infer<typeof createContestMcqQuestionSchema>;

const contestQuestionListQuerySchema = z.object({
  type: z.enum(['dsa', 'mcq', 'all']).default('dsa'),
  search: z.string().trim().max(200).optional(),
  difficulty: z.enum(['Easy', 'Medium', 'Hard']).optional(),
  topic: z.string().trim().max(100).optional(),
  used: z.enum(['all', 'used', 'unused']).default('all'),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

const questionIdParamSchema = z.object({
  questionId: z.string().trim().min(1).max(140),
});

function collection() {
  const db = mongoose.connection.db;
  if (!db) {
    throw new Error('MongoDB connection is not ready');
  }
  return db.collection<Record<string, any>>(CONTEST_QUESTIONS_COLLECTION);
}

function mcqCollection() {
  const db = mongoose.connection.db;
  if (!db) {
    throw new Error('MongoDB connection is not ready');
  }
  return db.collection<Record<string, any>>(CONTEST_MCQ_QUESTIONS_COLLECTION);
}

function countersCollection() {
  const db = mongoose.connection.db;
  if (!db) {
    throw new Error('MongoDB connection is not ready');
  }
  return db.collection<CounterDocument>('counters');
}

function isDuplicateKeyError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as any).code === 11000;
}

async function getMaxNumericFrontendId() {
  const [maxQuestion] = await collection()
    .aggregate([
      {
        $project: {
          numericFrontendId: {
            $convert: {
              input: '$frontendId',
              to: 'int',
              onError: 0,
              onNull: 0,
            },
          },
        },
      },
      { $sort: { numericFrontendId: -1 } },
      { $limit: 1 },
    ])
    .toArray();

  return Number(maxQuestion?.numericFrontendId || 0);
}

async function getMaxNumericMcqFrontendId() {
  const [maxQuestion] = await mcqCollection()
    .aggregate([
      {
        $project: {
          numericFrontendId: {
            $convert: {
              input: { $toString: '$frontendId' },
              to: 'int',
              onError: 0,
              onNull: 0,
            },
          },
        },
      },
      { $sort: { numericFrontendId: -1 } },
      { $limit: 1 },
    ])
    .toArray();

  return Number(maxQuestion?.numericFrontendId || 0);
}

async function syncCounterToCollectionMax() {
  const maxExistingId = await getMaxNumericFrontendId();

  await countersCollection().updateOne(
    { _id: CONTEST_DSA_COUNTER_ID },
    {
      $max: { seq: maxExistingId },
      $set: { updatedAt: new Date() },
      $setOnInsert: { createdAt: new Date() },
    },
    { upsert: true }
  );

  const counter = await countersCollection().findOne({ _id: CONTEST_DSA_COUNTER_ID });
  return Number(counter?.seq || maxExistingId);
}

async function syncMcqCounterToCollectionMax() {
  const maxExistingId = await getMaxNumericMcqFrontendId();

  await countersCollection().updateOne(
    { _id: CONTEST_MCQ_COUNTER_ID },
    {
      $max: { seq: maxExistingId },
      $set: { updatedAt: new Date() },
      $setOnInsert: { createdAt: new Date() },
    },
    { upsert: true }
  );

  const counter = await countersCollection().findOne({ _id: CONTEST_MCQ_COUNTER_ID });
  return Number(counter?.seq || maxExistingId);
}

async function getNextQuestionIdPreview() {
  const current = await syncCounterToCollectionMax();
  return String(current + 1);
}

async function getNextMcqQuestionIdPreview() {
  const current = await syncMcqCounterToCollectionMax();
  return String(current + 1);
}

async function allocateNextQuestionId() {
  await syncCounterToCollectionMax();

  const counter = await countersCollection().findOneAndUpdate(
    { _id: CONTEST_DSA_COUNTER_ID },
    {
      $inc: { seq: 1 },
      $set: { updatedAt: new Date() },
    },
    { returnDocument: 'after' }
  );

  const updatedCounter = 'value' in (counter || {}) ? (counter as any).value : counter;
  const nextId = Number(updatedCounter?.seq);
  if (!Number.isFinite(nextId) || nextId < 1) {
    throw new Error('Failed to allocate contest question ID');
  }

  return String(nextId);
}

async function allocateNextMcqQuestionId() {
  await syncMcqCounterToCollectionMax();

  const counter = await countersCollection().findOneAndUpdate(
    { _id: CONTEST_MCQ_COUNTER_ID },
    {
      $inc: { seq: 1 },
      $set: { updatedAt: new Date() },
    },
    { returnDocument: 'after' }
  );

  const updatedCounter = 'value' in (counter || {}) ? (counter as any).value : counter;
  const nextId = Number(updatedCounter?.seq);
  if (!Number.isFinite(nextId) || nextId < 1) {
    throw new Error('Failed to allocate contest MCQ question ID');
  }

  return String(nextId);
}

function slugifyQuestionTitle(value: string) {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 220);

  return slug || 'mcq-question';
}

async function buildUniqueMcqSlug(title: string, assignedId: string) {
  const baseSlug = slugifyQuestionTitle(title);
  const existing = await mcqCollection().findOne({ problemSlug: baseSlug });
  if (!existing) return baseSlug;
  return `${baseSlug}-${assignedId}`;
}

function buildListQuery(query: z.infer<typeof contestQuestionListQuerySchema>) {
  const mongoQuery: Record<string, any> = {};
  const addAndCondition = (condition: Record<string, any>) => {
    mongoQuery.$and = [
      ...(Array.isArray(mongoQuery.$and) ? mongoQuery.$and : []),
      condition,
    ];
  };

  if (query.search) {
    const escaped = query.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    mongoQuery.$or = [
      { title: { $regex: escaped, $options: 'i' } },
      { problemSlug: { $regex: escaped, $options: 'i' } },
      { problemId: { $regex: escaped, $options: 'i' } },
      { frontendId: { $regex: escaped, $options: 'i' } },
    ];
  }

  if (query.difficulty) {
    mongoQuery.difficulty = query.difficulty;
  }

  if (query.topic) {
    mongoQuery.topics = { $in: [query.topic] };
  }

  if (query.used === 'used') {
    addAndCondition({
      $or: [
        { currentlyChoosedForContest: true },
        { isUsedInContest: true },
        { 'usedInContests.0': { $exists: true } },
      ],
    });
  } else if (query.used === 'unused') {
    addAndCondition({
      $and: [
        {
          $or: [
            { currentlyChoosedForContest: { $exists: false } },
            { currentlyChoosedForContest: false },
          ],
        },
        {
          $or: [
            { isUsedInContest: { $exists: false } },
            { isUsedInContest: false },
          ],
        },
        { 'usedInContests.0': { $exists: false } },
      ],
    });
  }

  return mongoQuery;
}

function serializeQuestion(question: any) {
  return {
    id: question._id?.toString(),
    problemId: question.problemId,
    frontendId: question.frontendId,
    title: question.title,
    difficulty: question.difficulty,
    timeLimit: question.timeLimit ?? 2,
    memoryLimit: question.memoryLimit ?? 256,
    problemSlug: question.problemSlug,
    topics: question.topics || [],
    companyTags: question.companyTags || [],
    usedInContests: question.usedInContests || [],
    isUsedInContest: Boolean(question.isUsedInContest),
    currentlyChoosedForContest: Boolean(question.currentlyChoosedForContest),
    createdAt: question.createdAt,
    updatedAt: question.updatedAt,
    createdBy: question.createdBy,
  };
}

function serializeMcqQuestion(question: any) {
  return {
    id: question._id?.toString(),
    problemId: question.problemId,
    frontendId: question.frontendId,
    title: question.title,
    difficulty: question.difficulty,
    problemSlug: question.problemSlug,
    questionText: question.questionText,
    topics: question.topics || [],
    companyTags: question.companyTags || [],
    optionCount: Array.isArray(question.options) ? question.options.length : 0,
    usedInContests: question.usedInContests || [],
    isUsedInContest: Boolean(question.isUsedInContest),
    currentlyChoosedForContest: Boolean(question.currentlyChoosedForContest),
    createdAt: question.createdAt,
    updatedAt: question.updatedAt,
    createdBy: question.createdBy,
    questionType: 'mcq',
  };
}

function normalizeMcqOptionsForStorage(options: CreateContestMcqQuestionBody['options']) {
  return options.map((option, index) => ({
    id: option.id,
    text: option.text,
    order: option.order ?? index,
  }));
}

function buildQuestionIdentifierQuery(questionId: string) {
  const objectIds = mongoose.Types.ObjectId.isValid(questionId)
    ? [new mongoose.Types.ObjectId(questionId)]
    : [];
  const numericQuestionId = Number(questionId);

  return {
    $or: [
      ...(objectIds.length > 0 ? [{ _id: { $in: objectIds } }] : []),
      { problemId: questionId },
      { frontendId: questionId },
      ...(Number.isFinite(numericQuestionId) ? [{ frontendId: numericQuestionId }] : []),
    ],
  };
}

function serializeMcqQuestionPreview(question: any) {
  return {
    ...serializeMcqQuestion(question),
    statement: question.statement || question.questionText || '',
    options: Array.isArray(question.options)
      ? question.options
          .map((option: any, index: number) => ({
            id: String(option?.id || index + 1),
            text: String(option?.text || ''),
            order: Number.isFinite(Number(option?.order)) ? Number(option.order) : index,
          }))
          .sort((a: any, b: any) => a.order - b.order)
      : [],
    correctOptionId: String(question.correctOptionId || ''),
    explanation: question.explanation || '',
  };
}

function normalizeCodeSnippetsForStorage(
  codeSnippets: CreateContestDsaQuestionBody['codeSnippets']
): CreateContestDsaQuestionBody['codeSnippets'] {
  return {
    python3: {
      ...codeSnippets.python3,
      starter_code: normalizeStarterCodeForLanguage('python3', codeSnippets.python3.starter_code),
    },
    cpp: {
      ...codeSnippets.cpp,
      starter_code: normalizeStarterCodeForLanguage('cpp', codeSnippets.cpp.starter_code),
    },
    java: {
      ...codeSnippets.java,
      starter_code: normalizeStarterCodeForLanguage('java', codeSnippets.java.starter_code),
    },
    javascript: {
      ...codeSnippets.javascript,
      starter_code: normalizeStarterCodeForLanguage('javascript', codeSnippets.javascript.starter_code),
    },
  };
}

export async function contestQuestionRoutes(fastify: FastifyInstance) {
  fastify.get(
    '/admin/contest-questions/dsa/next-id',
    { preHandler: [authenticate, verifyContestManager] },
    async (_request: FastifyRequest, reply: FastifyReply) => {
      try {
        const nextId = await getNextQuestionIdPreview();
        return reply.send({ success: true, nextId });
      } catch (error) {
        fastify.log.error({ error }, 'Failed to fetch next contest question ID');
        return reply.status(500).send({
          error: 'Internal Server Error',
          message: 'Failed to fetch next contest question ID',
        });
      }
    }
  );

  fastify.get(
    '/admin/contest-questions/mcq/next-id',
    { preHandler: [authenticate, verifyContestManager] },
    async (_request: FastifyRequest, reply: FastifyReply) => {
      try {
        const nextId = await getNextMcqQuestionIdPreview();
        return reply.send({ success: true, nextId });
      } catch (error) {
        fastify.log.error({ error }, 'Failed to fetch next contest MCQ question ID');
        return reply.status(500).send({
          error: 'Internal Server Error',
          message: 'Failed to fetch next contest MCQ question ID',
        });
      }
    }
  );

  fastify.post(
    '/admin/contest-questions/dsa',
    {
      bodyLimit: QUESTION_CREATE_BODY_LIMIT_BYTES,
      preHandler: [authenticate, verifyContestManager],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const validation = createContestDsaQuestionSchema.safeParse(request.body);
        if (!validation.success) {
          return reply.status(400).send({
            error: 'Validation Error',
            details: validation.error.issues,
          });
        }

        const body = {
          ...validation.data,
          codeSnippets: normalizeCodeSnippetsForStorage(validation.data.codeSnippets),
        };
        const createdBy = getAuthenticatedUserId(request);
        const existing = await collection().findOne({ problemSlug: body.problemSlug });
        if (existing) {
          return reply.status(400).send({
            error: 'Bad Request',
            message: 'A contest question already exists with this slug',
          });
        }

        for (let attempt = 0; attempt < MAX_ID_ALLOCATION_ATTEMPTS; attempt += 1) {
          const assignedId = await allocateNextQuestionId();
          const now = new Date();
          const document = {
            ...body,
            problemId: assignedId,
            frontendId: assignedId,
            createdBy,
            isUsedInContest: false,
            currentlyChoosedForContest: false,
            usedInContests: [],
            createdAt: now,
            updatedAt: now,
          };

          try {
            const result = await collection().insertOne(document);
            return reply.status(201).send({
              success: true,
              message: 'Contest question created successfully',
              questionId: result.insertedId.toString(),
              problemId: assignedId,
              frontendId: assignedId,
            });
          } catch (insertError) {
            if (isDuplicateKeyError(insertError)) {
              const duplicateSlug = await collection().findOne({ problemSlug: body.problemSlug });
              if (duplicateSlug) {
                return reply.status(400).send({
                  error: 'Bad Request',
                  message: 'A contest question already exists with this slug',
                });
              }
              continue;
            }
            throw insertError;
          }
        }

        return reply.status(409).send({
          error: 'Conflict',
          message: 'Could not assign a unique contest question ID. Please submit again.',
        });
      } catch (error) {
        fastify.log.error({ error }, 'Failed to create contest question');
        return reply.status(500).send({
          error: 'Internal Server Error',
          message: 'Failed to create contest question',
        });
      }
    }
  );

  fastify.post(
    '/admin/contest-questions/mcq',
    {
      bodyLimit: QUESTION_CREATE_BODY_LIMIT_BYTES,
      preHandler: [authenticate, verifyContestManager],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const validation = createContestMcqQuestionSchema.safeParse(request.body);
        if (!validation.success) {
          return reply.status(400).send({
            error: 'Validation Error',
            details: validation.error.issues,
          });
        }

        const body = validation.data;
        const createdBy = getAuthenticatedUserId(request);

        for (let attempt = 0; attempt < MAX_ID_ALLOCATION_ATTEMPTS; attempt += 1) {
          const assignedId = await allocateNextMcqQuestionId();
          const problemSlug = await buildUniqueMcqSlug(body.title, assignedId);
          const now = new Date();
          const document = {
            ...body,
            problemSlug,
            questionText: body.questionText,
            statement: body.questionText,
            options: normalizeMcqOptionsForStorage(body.options),
            problemId: assignedId,
            frontendId: assignedId,
            createdBy,
            isUsedInContest: false,
            currentlyChoosedForContest: false,
            usedInContests: [],
            createdAt: now,
            updatedAt: now,
          };

          try {
            const result = await mcqCollection().insertOne(document);
            return reply.status(201).send({
              success: true,
              message: 'Contest MCQ question created successfully',
              questionId: result.insertedId.toString(),
              problemId: assignedId,
              frontendId: assignedId,
            });
          } catch (insertError) {
            if (isDuplicateKeyError(insertError)) {
              continue;
            }
            throw insertError;
          }
        }

        return reply.status(409).send({
          error: 'Conflict',
          message: 'Could not assign a unique contest MCQ question ID. Please submit again.',
        });
      } catch (error) {
        fastify.log.error({ error }, 'Failed to create contest MCQ question');
        return reply.status(500).send({
          error: 'Internal Server Error',
          message: 'Failed to create contest MCQ question',
        });
      }
    }
  );

  fastify.get(
    '/admin/contest-questions/mcq/:questionId',
    { preHandler: [authenticate, verifyContestManager] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const params = questionIdParamSchema.safeParse(request.params);
        if (!params.success) {
          return reply.status(400).send({
            error: 'Validation Error',
            details: params.error.flatten().fieldErrors,
          });
        }

        const question = await mcqCollection().findOne(buildQuestionIdentifierQuery(params.data.questionId));
        if (!question) {
          return reply.status(404).send({
            error: 'Not Found',
            message: 'Contest MCQ question not found',
          });
        }

        return reply.send({
          success: true,
          question: serializeMcqQuestionPreview(question),
        });
      } catch (error) {
        fastify.log.error({ error }, 'Failed to load contest MCQ question preview');
        return reply.status(500).send({
          error: 'Internal Server Error',
          message: 'Failed to load contest MCQ question preview',
        });
      }
    }
  );

  // ── GET a full DSA question (for the edit form) ──────────────────────
  fastify.get(
    '/admin/contest-questions/dsa/:questionId',
    { preHandler: [authenticate, verifyContestManager] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const params = questionIdParamSchema.safeParse(request.params);
        if (!params.success) {
          return reply.status(400).send({ error: 'Validation Error', details: params.error.flatten().fieldErrors });
        }
        const question = await collection().findOne(buildQuestionIdentifierQuery(params.data.questionId));
        if (!question) {
          return reply.status(404).send({ error: 'Not Found', message: 'Contest question not found' });
        }
        const { _id, ...rest } = question as any;
        return reply.send({ success: true, question: { id: String(_id), ...rest } });
      } catch (error) {
        fastify.log.error({ error }, 'Failed to load contest DSA question');
        return reply.status(500).send({ error: 'Internal Server Error', message: 'Failed to load contest DSA question' });
      }
    }
  );

  // ── UPDATE a DSA question ────────────────────────────────────────────
  fastify.put(
    '/admin/contest-questions/dsa/:questionId',
    { bodyLimit: QUESTION_CREATE_BODY_LIMIT_BYTES, preHandler: [authenticate, verifyContestManager] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const params = questionIdParamSchema.safeParse(request.params);
        if (!params.success) {
          return reply.status(400).send({ error: 'Validation Error', details: params.error.flatten().fieldErrors });
        }
        const validation = createContestDsaQuestionSchema.safeParse(request.body);
        if (!validation.success) {
          return reply.status(400).send({ error: 'Validation Error', details: validation.error.issues });
        }
        const existing = await collection().findOne(buildQuestionIdentifierQuery(params.data.questionId));
        if (!existing) {
          return reply.status(404).send({ error: 'Not Found', message: 'Contest question not found' });
        }
        if (validation.data.problemSlug !== existing.problemSlug) {
          const dup = await collection().findOne({ problemSlug: validation.data.problemSlug });
          if (dup && String(dup._id) !== String(existing._id)) {
            return reply.status(400).send({ error: 'Bad Request', message: 'Another question already uses this slug' });
          }
        }
        const { problemId: _pid, frontendId: _fid, ...rest } = validation.data;
        const update = {
          ...rest,
          codeSnippets: normalizeCodeSnippetsForStorage(validation.data.codeSnippets),
          problemId: existing.problemId,
          frontendId: existing.frontendId,
          updatedAt: new Date(),
        };
        await collection().updateOne({ _id: existing._id }, { $set: update });
        return reply.send({ success: true, message: 'Contest question updated successfully', questionId: String(existing._id) });
      } catch (error) {
        fastify.log.error({ error }, 'Failed to update contest DSA question');
        return reply.status(500).send({ error: 'Internal Server Error', message: 'Failed to update contest DSA question' });
      }
    }
  );

  // ── GET a full MCQ question (for the edit form, includes the answer) ──
  fastify.get(
    '/admin/contest-questions/mcq/:questionId/full',
    { preHandler: [authenticate, verifyContestManager] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const params = questionIdParamSchema.safeParse(request.params);
        if (!params.success) {
          return reply.status(400).send({ error: 'Validation Error', details: params.error.flatten().fieldErrors });
        }
        const question = await mcqCollection().findOne(buildQuestionIdentifierQuery(params.data.questionId));
        if (!question) {
          return reply.status(404).send({ error: 'Not Found', message: 'Contest MCQ question not found' });
        }
        const { _id, ...rest } = question as any;
        return reply.send({ success: true, question: { id: String(_id), ...rest } });
      } catch (error) {
        fastify.log.error({ error }, 'Failed to load contest MCQ question');
        return reply.status(500).send({ error: 'Internal Server Error', message: 'Failed to load contest MCQ question' });
      }
    }
  );

  // ── UPDATE an MCQ question ───────────────────────────────────────────
  fastify.put(
    '/admin/contest-questions/mcq/:questionId',
    { bodyLimit: QUESTION_CREATE_BODY_LIMIT_BYTES, preHandler: [authenticate, verifyContestManager] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const params = questionIdParamSchema.safeParse(request.params);
        if (!params.success) {
          return reply.status(400).send({ error: 'Validation Error', details: params.error.flatten().fieldErrors });
        }
        const validation = createContestMcqQuestionSchema.safeParse(request.body);
        if (!validation.success) {
          return reply.status(400).send({ error: 'Validation Error', details: validation.error.issues });
        }
        const existing = await mcqCollection().findOne(buildQuestionIdentifierQuery(params.data.questionId));
        if (!existing) {
          return reply.status(404).send({ error: 'Not Found', message: 'Contest MCQ question not found' });
        }
        const update = {
          ...validation.data,
          questionText: validation.data.questionText,
          statement: validation.data.questionText,
          options: normalizeMcqOptionsForStorage(validation.data.options),
          problemId: existing.problemId,
          frontendId: existing.frontendId,
          updatedAt: new Date(),
        };
        await mcqCollection().updateOne({ _id: existing._id }, { $set: update });
        return reply.send({ success: true, message: 'Contest MCQ question updated successfully', questionId: String(existing._id) });
      } catch (error) {
        fastify.log.error({ error }, 'Failed to update contest MCQ question');
        return reply.status(500).send({ error: 'Internal Server Error', message: 'Failed to update contest MCQ question' });
      }
    }
  );

  fastify.get(
    '/admin/contest-questions',
    { preHandler: [authenticate, verifyContestManager] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const validation = contestQuestionListQuerySchema.safeParse(request.query);
        if (!validation.success) {
          return reply.status(400).send({
            error: 'Validation Error',
            details: validation.error.flatten().fieldErrors,
          });
        }

        await reconcileContestQuestionUsage();

        const { limit, offset, type } = validation.data;
        const query = buildListQuery(validation.data);

        if (type === 'mcq') {
          const [questions, total] = await Promise.all([
            mcqCollection()
              .find(query)
              .project({
                title: 1,
                questionText: 1,
                problemId: 1,
                frontendId: 1,
                problemSlug: 1,
                difficulty: 1,
                topics: 1,
                companyTags: 1,
                options: 1,
                usedInContests: 1,
                isUsedInContest: 1,
                currentlyChoosedForContest: 1,
                createdAt: 1,
                updatedAt: 1,
                createdBy: 1,
              })
              .sort({ createdAt: -1, title: 1 })
              .skip(offset)
              .limit(limit)
              .toArray(),
            mcqCollection().countDocuments(query),
          ]);

          return reply.send({
            success: true,
            questions: questions.map(serializeMcqQuestion),
            total,
            limit,
            offset,
          });
        }

        if (type === 'all') {
          const [dsaQuestions, mcqQuestions, dsaTotal, mcqTotal] = await Promise.all([
            collection()
              .find(query)
              .project({
                title: 1,
                problemId: 1,
                frontendId: 1,
                problemSlug: 1,
                difficulty: 1,
                timeLimit: 1,
                memoryLimit: 1,
                topics: 1,
                companyTags: 1,
                usedInContests: 1,
                isUsedInContest: 1,
                currentlyChoosedForContest: 1,
                createdAt: 1,
                updatedAt: 1,
                createdBy: 1,
              })
              .sort({ createdAt: -1, title: 1 })
              .limit(limit)
              .toArray(),
            mcqCollection()
              .find(query)
              .project({
                title: 1,
                questionText: 1,
                problemId: 1,
                frontendId: 1,
                problemSlug: 1,
                difficulty: 1,
                topics: 1,
                companyTags: 1,
                options: 1,
                usedInContests: 1,
                isUsedInContest: 1,
                currentlyChoosedForContest: 1,
                createdAt: 1,
                updatedAt: 1,
                createdBy: 1,
              })
              .sort({ createdAt: -1, title: 1 })
              .limit(limit)
              .toArray(),
            collection().countDocuments(query),
            mcqCollection().countDocuments(query),
          ]);

          const merged = [
            ...dsaQuestions.map((question) => ({ ...serializeQuestion(question), questionType: 'dsa' })),
            ...mcqQuestions.map(serializeMcqQuestion),
          ]
            .sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime())
            .slice(offset, offset + limit);

          return reply.send({
            success: true,
            questions: merged,
            total: dsaTotal + mcqTotal,
            limit,
            offset,
          });
        }

        const [questions, total] = await Promise.all([
          collection()
            .find(query)
            .project({
              title: 1,
              problemId: 1,
              frontendId: 1,
              problemSlug: 1,
              difficulty: 1,
              timeLimit: 1,
              memoryLimit: 1,
              topics: 1,
              companyTags: 1,
              usedInContests: 1,
              isUsedInContest: 1,
              currentlyChoosedForContest: 1,
              createdAt: 1,
              updatedAt: 1,
              createdBy: 1,
            })
            .sort({ createdAt: -1, title: 1 })
            .skip(offset)
            .limit(limit)
            .toArray(),
          collection().countDocuments(query),
        ]);

        return reply.send({
          success: true,
          questions: questions.map((question) => ({ ...serializeQuestion(question), questionType: 'dsa' })),
          total,
          limit,
          offset,
        });
      } catch (error) {
        fastify.log.error({ error }, 'Failed to fetch contest questions');
        return reply.status(500).send({
          error: 'Internal Server Error',
          message: 'Failed to fetch contest questions',
        });
      }
    }
  );
}
