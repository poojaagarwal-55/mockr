import { prisma } from '../lib/prisma.js';
import { redis, CacheKeys, CacheTTL } from '../lib/redis.js';
import mongoose from 'mongoose';

/**
 * Question Service
 * Handles question retrieval for contests with caching
 */

// Type for MongoDB question document
interface MongoQuestion {
  _id: any;
  problemId?: string;
  frontendId?: string | number;
  title?: string;
  difficulty?: string;
  timeLimit?: number;
  memoryLimit?: number;
  description?: string;
  statement?: string;
  examples?: any[];
  constraints?: string | string[];
  sampleTestCases?: any[];
  sample_tests?: any[];
  hiddenTestCases?: any[];
  hidden_tests?: any[];
  codeSnippets?: Record<string, any> | Map<string, any>;
  starter_code?: Record<string, any>;
  wrapper_code?: Record<string, any>;
  topics?: string[];
  hints?: string[];
  [key: string]: any;
}

const LANGUAGE_KEY_ALIASES: Record<string, string> = {
  'c++': 'cpp',
  cplusplus: 'cpp',
  'c#': 'csharp',
  'c-sharp': 'csharp',
  nodejs: 'javascript',
  js: 'javascript',
};

function normalizeLanguageKey(language: string): string {
  const normalized = (language || '').trim().toLowerCase();
  return LANGUAGE_KEY_ALIASES[normalized] || normalized;
}

const CONTEST_QUESTION_FETCH_RETRY_DELAYS_MS = [250, 700, 1400];
const contestQuestionHydrationPromises = new Map<string, Promise<any[]>>();

type ContestQuestionRow = {
  questionId: string;
  questionType: 'dsa' | 'mcq';
  phase: 'dsa' | 'mcq';
  difficulty: string;
  points: number;
  negativePoints: number;
  order: number;
  phaseOrder: number;
};

type ContestQuestionPhase = 'dsa' | 'mcq';

function normalizeQuestionType(value: unknown): 'dsa' | 'mcq' {
  return String(value || '').toLowerCase() === 'mcq' ? 'mcq' : 'dsa';
}

function normalizePhase(value: unknown, fallback: 'dsa' | 'mcq'): ContestQuestionPhase {
  const phase = String(value || '').toLowerCase();
  return phase === 'mcq' || phase === 'dsa' ? phase : fallback;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getNumericQuestionIds(questionIds: string[]) {
  return questionIds
    .map((id) => Number(id))
    .filter((id) => Number.isFinite(id));
}

function matchesQuestionIdentifier(questionIds: string[], question: MongoQuestion) {
  const mongoId = question._id?.toString();
  const frontendId = question.frontendId === undefined || question.frontendId === null
    ? ''
    : String(question.frontendId);

  return questionIds.find((id) => (
    id === mongoId ||
    id === question.problemId ||
    id === frontendId
  ));
}

async function safeRedisGet<T>(key: string): Promise<T | null> {
  try {
    return await redis.get<T>(key);
  } catch {
    return null;
  }
}

async function safeRedisSetex(key: string, ttlSeconds: number, value: unknown) {
  try {
    await redis.setex(key, ttlSeconds, value as object);
  } catch {
    // Cache is best-effort. Contest question loading must still work if Redis blips.
  }
}

async function safeRedisDel(...keys: string[]) {
  try {
    if (keys.length > 0) {
      await redis.del(...keys);
    }
  } catch {
    // Cache invalidation is best-effort here; incomplete cache is revalidated by count/id.
  }
}

function indentLines(value: string, spaces: number): string {
  const prefix = ' '.repeat(spaces);
  return value
    .split(/\r?\n/)
    .map((line) => `${prefix}${line}`)
    .join('\n');
}

function ensureCppStarterUsesClassSolution(starter: string): string {
  const trimmed = starter.trim();
  if (!trimmed || /\bclass\s+Solution\b/.test(trimmed)) return starter;

  const indented = indentLines(trimmed, 4);
  if (/^\s*(public:|private:|protected:)\s*$/m.test(trimmed)) {
    return `class Solution {\n${indented}\n};`;
  }

  return `class Solution {\npublic:\n${indented}\n};`;
}

function ensureJavaStarterUsesClassSolution(starter: string): string {
  const trimmed = starter.trim();
  if (!trimmed || /\bclass\s+Solution\b/.test(trimmed)) return starter;
  return `class Solution {\n${indentLines(trimmed, 4)}\n}`;
}

function ensurePythonStarterUsesClassSolution(starter: string): string {
  const trimmed = starter.trim();
  if (!trimmed || /\bclass\s+Solution\b/.test(trimmed) || !/^def\s+/.test(trimmed)) {
    return starter;
  }

  const lines = trimmed.split(/\r?\n/);
  const firstLine = lines[0] || '';
  const match = firstLine.match(/^def\s+([A-Za-z_]\w*)\s*\(([^)]*)\)\s*:/);
  if (!match) return starter;

  const params = (match[2] || '').trim();
  const methodParams = params ? `self, ${params}` : 'self';
  lines[0] = firstLine.replace(/\(([^)]*)\)/, `(${methodParams})`);

  return `class Solution:\n${indentLines(lines.join('\n'), 4)}`;
}

function ensureJavaScriptStarterUsesClassSolution(starter: string): string {
  const trimmed = starter.trim();
  if (!trimmed || /\bclass\s+Solution\b/.test(trimmed)) return starter;

  const match = trimmed.match(/^function\s+([A-Za-z_$][\w$]*)\s*\(([^)]*)\)\s*\{/);
  if (!match) return starter;

  const methodStarter = trimmed.replace(/^function\s+([A-Za-z_$][\w$]*)\s*\(([^)]*)\)\s*\{/, `${match[1]}(${match[2] || ''}) {`);
  return `class Solution {\n${indentLines(methodStarter, 2)}\n}`;
}

export function normalizeStarterCodeForLanguage(language: string, starter: string): string {
  const normalizedLanguage = normalizeLanguageKey(language);
  if (normalizedLanguage === 'cpp') return ensureCppStarterUsesClassSolution(starter);
  if (normalizedLanguage === 'java') return ensureJavaStarterUsesClassSolution(starter);
  if (normalizedLanguage === 'python' || normalizedLanguage === 'python3') return ensurePythonStarterUsesClassSolution(starter);
  if (normalizedLanguage === 'javascript') return ensureJavaScriptStarterUsesClassSolution(starter);
  return starter;
}

function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(max, Math.max(min, numeric));
}

function toDisplayString(value: any): string {
  if (value === null || value === undefined) return '';
  return typeof value === 'string' ? value : JSON.stringify(value);
}

function cleanEscapedText(value: any): string {
  return toDisplayString(value)
    .replace(/\\n(?![A-Za-z])/g, '\n')
    .replace(/\\\//g, '/')
    .trim();
}

function normalizeConstraints(constraints: MongoQuestion['constraints']): string {
  const raw = Array.isArray(constraints) ? constraints.join('\n') : constraints || '';
  return cleanEscapedText(raw);
}

function normalizeExamples(examples: any[] = []) {
  return examples.map((example) => {
    if (example?.input !== undefined || example?.output !== undefined) {
      return {
        input: cleanEscapedText(example.input ?? example.stdin ?? ''),
        output: cleanEscapedText(example.output ?? example.expected_output ?? example.expected ?? example.expectedOutput ?? ''),
        explanation: cleanEscapedText(example.explanation ?? example.description ?? ''),
      };
    }

    const text = cleanEscapedText(example?.example_text ?? example?.text ?? '');
    const inputMatch = text.match(/Input:?\s*([\s\S]*?)(?=\s*Output\b)/i);
    const outputMatch = text.match(/Output:?\s*([\s\S]*?)(?=\s*Explanation\b|$)/i);
    const explanationMatch = text.match(/Explanation:?\s*([\s\S]*?)$/i);

    return {
      input: inputMatch?.[1]?.trim() ?? '',
      output: outputMatch?.[1]?.trim() ?? '',
      explanation: explanationMatch?.[1]?.trim() ?? '',
    };
  });
}

function normalizeSampleTests(question: MongoQuestion) {
  const rawTests = question.sample_tests || question.sampleTestCases || question.visibleTestCases || [];

  return rawTests.map((testCase: any, index: number) => {
    const input = cleanEscapedText(testCase?.stdin ?? testCase?.input ?? '');
    const output = cleanEscapedText(
      testCase?.expected_output ??
      testCase?.output ??
      testCase?.expected ??
      testCase?.expectedOutput ??
      ''
    );

    return {
      id: testCase?.id || `sample_${index}`,
      stdin: input,
      expected_output: output,
      input,
      output,
    };
  });
}

function normalizeHiddenTests(question: MongoQuestion) {
  const rawTests = question.hidden_tests || question.hiddenTestCases || [];

  return rawTests.map((testCase: any, index: number) => {
    const input = cleanEscapedText(testCase?.stdin ?? testCase?.input ?? '');
    const output = cleanEscapedText(
      testCase?.expected_output ??
      testCase?.output ??
      testCase?.expected ??
      testCase?.expectedOutput ??
      ''
    );

    return {
      id: testCase?.id || `hidden_${index}`,
      stdin: input,
      expected_output: output,
      input,
      output,
    };
  });
}

function toEntries(input: Record<string, any> | Map<string, any> | undefined): Array<[string, any]> {
  if (!input) return [];
  if (input instanceof Map) return Array.from(input.entries());
  if (typeof input === 'object') return Object.entries(input);
  return [];
}

function normalizeCodeMaps(question: MongoQuestion) {
  const starterCode: Record<string, string> = {};
  const wrapperCode: Record<string, string> = {};

  const addSnippet = (language: string, value: any) => {
    const normalizedLanguage = normalizeLanguageKey(language);
    if (!normalizedLanguage) return;

    const rawStarter =
      typeof value === 'string'
        ? value
        : value?.starter_code ?? value?.starterCode ?? value?.starter ?? value?.code ?? '';
    const rawWrapper =
      typeof value === 'object'
        ? value?.wrapper_code ?? value?.wrapperCode ?? value?.wrapper ?? ''
        : '';

    if (typeof rawStarter === 'string' && rawStarter.trim() && !starterCode[normalizedLanguage]) {
      starterCode[normalizedLanguage] = normalizeStarterCodeForLanguage(normalizedLanguage, rawStarter);
    }

    if (typeof rawWrapper === 'string' && rawWrapper.trim() && !wrapperCode[normalizedLanguage]) {
      wrapperCode[normalizedLanguage] = rawWrapper;
    }
  };

  for (const [language, value] of toEntries(question.starter_code)) {
    addSnippet(language, value);
  }

  for (const [language, value] of toEntries(question.codeSnippets)) {
    addSnippet(language, value);
  }

  for (const [language, value] of toEntries(question.wrapper_code)) {
    const normalizedLanguage = normalizeLanguageKey(language);
    if (normalizedLanguage && typeof value === 'string' && value.trim() && !wrapperCode[normalizedLanguage]) {
      wrapperCode[normalizedLanguage] = value;
    }
  }

  return { starterCode, wrapperCode };
}

function normalizeContestQuestion(question: MongoQuestion, modelName: string, linkedQuestionId: string) {
  const { starterCode, wrapperCode } = normalizeCodeMaps(question);

  return {
    id: linkedQuestionId,
    title: question.title || '',
    difficulty: question.difficulty || 'Medium',
    timeLimit: clampNumber(question.timeLimit, 2, 0.1, 5),
    memoryLimit: clampNumber(question.memoryLimit, 256, 16, 256),
    statement: cleanEscapedText(question.statement || question.description || ''),
    examples: normalizeExamples(question.examples || []),
    constraints: normalizeConstraints(question.constraints),
    sample_tests: normalizeSampleTests(question),
    starter_code: starterCode,
    wrapper_code: wrapperCode,
    topics: question.topics || [],
    hints: Array.isArray(question.hints) ? question.hints.map((hint) => cleanEscapedText(hint)).filter(Boolean) : [],
    // Special judge / custom checker (optional).
    judgeType: (question as any).judgeType === 'custom' ? 'custom' : 'default',
    checkerLanguage: (question as any).checkerLanguage || null,
    checkerCode: (question as any).checkerCode || null,
    type: modelName,
  };
}

function normalizeContestMcqQuestion(question: MongoQuestion, linkedQuestionId: string) {
  const rawOptions = Array.isArray(question.options) ? question.options : [];
  const options = rawOptions
    .map((option: any, index: number) => ({
      id: String(option?.id ?? index + 1),
      text: cleanEscapedText(String(option?.text ?? '')),
      order: Number.isFinite(Number(option?.order)) ? Number(option.order) : index,
    }))
    .filter((option) => option.id && option.text)
    .sort((a, b) => a.order - b.order);

  return {
    id: linkedQuestionId,
    title: question.title || '',
    difficulty: question.difficulty || 'Medium',
    statement: cleanEscapedText(question.questionText || question.statement || question.description || ''),
    questionText: cleanEscapedText(question.questionText || question.statement || question.description || ''),
    options,
    topics: question.topics || [],
    type: 'ContestMCQQuestion',
    questionType: 'mcq',
  };
}

function normalizeExecutionQuestion(question: MongoQuestion, modelName: string, linkedQuestionId: string) {
  return {
    ...normalizeContestQuestion(question, modelName, linkedQuestionId),
    hidden_tests: normalizeHiddenTests(question),
  };
}

async function findQuestionDocument(questionId: string, includeHiddenTests = false) {
  const questionModels = [
    'ContestDSAQuestion',
    'DSAQuestion',
    'DSSQLQuestion',
    'DSCodingQuestion',
    'DSConceptQuestion',
    'SQLQuestion',
    'CSFundamentalQuestion',
    'GenAICodingQuestion',
    'GenAIConceptQuestion',
    'GenAIEthicsQuestion',
    'GenAISystemDesignQuestion',
    'PMCaseQuestion',
    'PMConceptQuestion',
    'PMStrategyQuestion',
  ];

  for (const modelName of questionModels) {
    const Model = mongoose.model(modelName);

    let question: MongoQuestion | null = null;
    const selectClause = includeHiddenTests ? '-solution' : '-hiddenTestCases -solution';

    if (mongoose.Types.ObjectId.isValid(questionId)) {
      question = await Model.findById(questionId)
        .select(selectClause)
        .lean<MongoQuestion>();
    }

    if (!question) {
      const numericFrontendId = Number(questionId);
      question = await Model.findOne({
        $or: [
          { problemId: questionId },
          { frontendId: questionId },
          ...(Number.isFinite(numericFrontendId) ? [{ frontendId: numericFrontendId }] : []),
        ],
      })
        .select(selectClause)
        .lean<MongoQuestion>();
    }

    if (question) {
      const mongoId = question._id.toString();
      const linkedQuestionId = matchesQuestionIdentifier([questionId], question) ?? mongoId;
      return { question, modelName, linkedQuestionId };
    }
  }

  return null;
}

/**
 * Calculate points based on difficulty
 */
function calculatePoints(difficulty: string): number {
  const normalizedDifficulty = difficulty.toUpperCase();
  
  console.log(`[calculatePoints] Input: "${difficulty}" -> Normalized: "${normalizedDifficulty}"`);
  
  switch (normalizedDifficulty) {
    case 'EASY':
      console.log('[calculatePoints] Returning 150 for EASY');
      return 150;
    case 'HARD':
      console.log('[calculatePoints] Returning 500 for HARD');
      return 500;
    case 'MEDIUM':
      console.log('[calculatePoints] Returning 300 for MEDIUM');
      return 300;
    default:
      console.log('[calculatePoints] Returning 300 for default (unknown difficulty)');
      return 300;
  }
}

/**
 * Get questions for a contest
 * Returns questions with sample test cases only (no hidden tests)
 * Uses Redis caching to reduce MongoDB queries
 */
async function getContestQuestionRows(contestId: string, phase: ContestQuestionPhase): Promise<ContestQuestionRow[]> {
  const rows = await prisma.$queryRawUnsafe<Array<{
    questionId: string;
    questionType: string | null;
    phase: string | null;
    difficulty: string;
    points: number;
    negativePoints: number;
    order: number;
    phaseOrder: number | null;
  }>>(
    `SELECT
      question_id AS "questionId",
      COALESCE(question_type, 'dsa') AS "questionType",
      COALESCE(phase, 'dsa') AS phase,
      difficulty::text AS difficulty,
      points,
      negative_points AS "negativePoints",
      "order",
      COALESCE(phase_order, "order", 0) AS "phaseOrder"
     FROM contest_questions
     WHERE contest_id = $1
       AND COALESCE(phase, 'dsa') = $2
     ORDER BY COALESCE(phase_order, "order", 0) ASC, "order" ASC`,
    contestId,
    phase
  );

  return rows.map((row) => {
    const questionType = normalizeQuestionType(row.questionType);
    return {
      questionId: row.questionId,
      questionType,
      phase: normalizePhase(row.phase, questionType),
      difficulty: row.difficulty,
      points: row.points,
      negativePoints: row.negativePoints,
      order: row.order,
      phaseOrder: row.phaseOrder ?? row.order ?? 0,
    };
  });
}

export async function getContestQuestions(contestId: string, userId?: string, phase: ContestQuestionPhase = 'dsa') {
  // Questions are cached without user-specific data; status is merged after.
  const cacheKey = phase === 'mcq'
    ? `${CacheKeys.contestQuestions(contestId)}:mcq:v1`
    : `${CacheKeys.contestQuestions(contestId)}:dsa:v1`;

  // Get contest questions from PostgreSQL first. It is the source of truth for
  // how many questions must be visible; Redis only caches the Mongo hydration.
  const contestQuestions = await getContestQuestionRows(contestId, phase);

  if (contestQuestions.length === 0) {
    await safeRedisDel(cacheKey);
    return [];
  }

  const questionIds = contestQuestions.map((q) => q.questionId);
  const cachedQuestions = await safeRedisGet<any[]>(cacheKey);
  let baseQuestions: any[] = Array.isArray(cachedQuestions) ? cachedQuestions : [];
  const cachedIds = new Set(Array.isArray(baseQuestions) ? baseQuestions.map((q) => q?.id).filter(Boolean) : []);
  const cacheIsComplete =
    Array.isArray(baseQuestions) &&
    baseQuestions.length === questionIds.length &&
    cachedIds.size === questionIds.length &&
    questionIds.every((questionId) => cachedIds.has(questionId));

  if (!cacheIsComplete) {
    if (cachedQuestions !== null) {
      await safeRedisDel(cacheKey);
    }

    let hydrationPromise = contestQuestionHydrationPromises.get(cacheKey);
    if (!hydrationPromise) {
      hydrationPromise = hydrateContestQuestionsForCache(cacheKey, contestQuestions, questionIds, phase);
      contestQuestionHydrationPromises.set(cacheKey, hydrationPromise);
    }

    try {
      baseQuestions = await hydrationPromise;
    } finally {
      if (contestQuestionHydrationPromises.get(cacheKey) === hydrationPromise) {
        contestQuestionHydrationPromises.delete(cacheKey);
      }
    }
  }

  // If no userId, return without status (e.g. public view)
  if (!userId) return baseQuestions;

  if (phase === 'mcq') {
    const userAnswers = await prisma.$queryRawUnsafe<Array<{
      questionId: string;
      status: string;
    }>>(
      `SELECT question_id AS "questionId", status
       FROM contest_mcq_answers
       WHERE contest_id = $1 AND user_id = $2`,
      contestId,
      userId
    );

    const answerMap = new Map(userAnswers.map((answer) => [answer.questionId, answer.status]));
    return baseQuestions.map((q: any) => ({
      ...q,
      status: answerMap.get(q.id) === 'submitted' ? 'submitted' : answerMap.has(q.id) ? 'attempted' : 'not_attempted',
      attempts: answerMap.has(q.id) ? 1 : 0,
    }));
  }

  // Fetch this user's accepted contest submissions for all questions in this contest
  const userSubmissions = await prisma.contestSubmission.findMany({
    where: { contestId, userId },
    select: { questionId: true, status: true },
  });

  // Build a per-question summary: { [questionId]: { status, attempts } }
  const submissionMap: Record<string, { status: 'solved' | 'attempted' | 'not_attempted'; attempts: number }> = {};
  for (const sub of userSubmissions) {
    const qid = sub.questionId;
    if (!submissionMap[qid]) {
      submissionMap[qid] = { status: 'not_attempted', attempts: 0 };
    }
    submissionMap[qid].attempts += 1;
    if (sub.status === 'ACCEPTED') {
      submissionMap[qid].status = 'solved';
    } else if (submissionMap[qid].status !== 'solved') {
      submissionMap[qid].status = 'attempted';
    }
  }

  // Merge status & attempts into each question
  return baseQuestions.map((q: any) => ({
    ...q,
    status: submissionMap[q.id]?.status ?? 'not_attempted',
    attempts: submissionMap[q.id]?.attempts ?? 0,
  }));
}

async function hydrateContestQuestionsForCache(
  cacheKey: string,
  contestQuestions: ContestQuestionRow[],
  questionIds: string[],
  phase: ContestQuestionPhase = 'dsa'
) {
  let mongoQuestions: any[] = [];
  for (let attempt = 0; attempt <= CONTEST_QUESTION_FETCH_RETRY_DELAYS_MS.length; attempt += 1) {
    mongoQuestions = phase === 'mcq'
      ? await fetchMcqQuestionsFromMongoDB(questionIds)
      : await fetchQuestionsFromMongoDB(questionIds);

    if (mongoQuestions.length >= questionIds.length) break;
    const delay = CONTEST_QUESTION_FETCH_RETRY_DELAYS_MS[attempt];
    if (delay === undefined) break;
    await sleep(delay);
  }

  const mongoById = new Map(mongoQuestions.map((question) => [question.id, question]));
  const baseQuestions = contestQuestions
    .map((contestQuestion) => {
      const mongoQuestion = mongoById.get(contestQuestion.questionId);
      if (!mongoQuestion) return null;

      return {
        ...mongoQuestion,
        difficulty: contestQuestion.difficulty || mongoQuestion.difficulty,
        points: contestQuestion.points || 0,
        negativePoints: contestQuestion.negativePoints || 0,
        order: contestQuestion.order || 0,
        phase: contestQuestion.phase,
        phaseOrder: contestQuestion.phaseOrder || 0,
        questionType: contestQuestion.questionType,
      };
    })
    .filter(Boolean) as any[];

  baseQuestions.sort((a, b) => a.order - b.order);

  if (baseQuestions.length !== questionIds.length) {
    const foundIds = new Set(baseQuestions.map((question) => String(question.id)));
    const missingQuestionIds = questionIds.filter((questionId) => !foundIds.has(questionId));
    await safeRedisDel(cacheKey);
    const error = new Error(`Contest questions are still loading (${baseQuestions.length}/${questionIds.length})`);
    (error as Error & { missingQuestionIds?: string[] }).missingQuestionIds = missingQuestionIds;
    throw error;
  }

  await safeRedisSetex(cacheKey, CacheTTL.contestQuestions, baseQuestions);
  return baseQuestions;
}

/**
 * Fetch questions from MongoDB
 * Searches across all question model types
 */
async function fetchQuestionsFromMongoDB(questionIds: string[]) {
  const questionModels = [
    'ContestDSAQuestion',
    'DSAQuestion',
    'DSSQLQuestion',
    'DSCodingQuestion',
    'DSConceptQuestion',
    'SQLQuestion',
    'CSFundamentalQuestion',
    'GenAICodingQuestion',
    'GenAIConceptQuestion',
    'GenAIEthicsQuestion',
    'GenAISystemDesignQuestion',
    'PMCaseQuestion',
    'PMConceptQuestion',
    'PMStrategyQuestion',
  ];

  const allQuestions: any[] = [];
  const seenQuestionIds = new Set<string>();
  const numericQuestionIds = getNumericQuestionIds(questionIds);

  for (const modelName of questionModels) {
    const Model = mongoose.model(modelName);
    
    const objectIds = questionIds
      .filter((id) => mongoose.Types.ObjectId.isValid(id))
      .map((id) => new mongoose.Types.ObjectId(id));

    const query = {
      $or: [
        ...(objectIds.length > 0 ? [{ _id: { $in: objectIds } }] : []),
        { problemId: { $in: questionIds } },
        { frontendId: { $in: questionIds } },
        ...(numericQuestionIds.length > 0 ? [{ frontendId: { $in: numericQuestionIds } }] : []),
      ],
    };

    const questions = await Model.find(query)
      .select('-hiddenTestCases -solution') // Exclude hidden test cases and solutions
      .lean<MongoQuestion[]>();

    for (const q of questions) {
      const mongoId = q._id.toString();
      const linkedQuestionId = matchesQuestionIdentifier(questionIds, q) ?? mongoId;

      if (seenQuestionIds.has(linkedQuestionId)) continue;
      seenQuestionIds.add(linkedQuestionId);
      allQuestions.push(normalizeContestQuestion(q, modelName, linkedQuestionId));
    }
  }

  return allQuestions;
}

async function fetchMcqQuestionsFromMongoDB(questionIds: string[]) {
  const Model = mongoose.model('ContestMCQQuestion');
  const objectIds = questionIds
    .filter((id) => mongoose.Types.ObjectId.isValid(id))
    .map((id) => new mongoose.Types.ObjectId(id));

  const query = {
    $or: [
      ...(objectIds.length > 0 ? [{ _id: { $in: objectIds } }] : []),
      { problemId: { $in: questionIds } },
      { frontendId: { $in: questionIds } },
    ],
  };

  const questions = await Model.find(query)
    .select('-correctOptionId -explanation')
    .lean<MongoQuestion[]>();

  const allQuestions: any[] = [];
  const seenQuestionIds = new Set<string>();
  for (const q of questions) {
    const mongoId = q._id.toString();
    const linkedQuestionId = matchesQuestionIdentifier(questionIds, q) ?? mongoId;
    if (seenQuestionIds.has(linkedQuestionId)) continue;
    seenQuestionIds.add(linkedQuestionId);
    allQuestions.push(normalizeContestMcqQuestion(q, linkedQuestionId));
  }

  return allQuestions;
}

/**
 * Get a single question by ID
 * Used for the contest IDE page
 */
export async function getQuestionById(questionId: string) {
  const found = await findQuestionDocument(questionId, false);
  if (found) {
    return normalizeContestQuestion(found.question, found.modelName, found.linkedQuestionId);
  }

  throw new Error('Question not found');
}

export async function getQuestionExecutionById(questionId: string) {
  const found = await findQuestionDocument(questionId, true);
  if (found) {
    return normalizeExecutionQuestion(found.question, found.modelName, found.linkedQuestionId);
  }

  throw new Error('Question not found');
}

/**
 * Invalidate contest questions cache
 * Called when contest questions are updated
 */
export async function invalidateContestQuestionsCache(contestId: string) {
  const baseKey = CacheKeys.contestQuestions(contestId);
  await safeRedisDel(
    baseKey,
    `${baseKey}:ide-v4`,
    `${baseKey}:ide-v5`,
    `${baseKey}:ide-v6`,
    `${baseKey}:ide-v7`,
    `${baseKey}:ide-v8`,
    `${baseKey}:dsa:v1`,
    `${baseKey}:mcq:v1`
  );
}
