const mockContestQuestionFindMany = jest.fn();
const mockContestSubmissionFindMany = jest.fn();
const mockQueryRawUnsafe = jest.fn();
const mockGetCachedOrFetch = jest.fn();
const mockMongooseModel = jest.fn();
const mockObjectIdIsValid = jest.fn();

jest.mock('../lib/prisma.js', () => ({
  prisma: {
    $queryRawUnsafe: mockQueryRawUnsafe,
    contestQuestion: {
      findMany: mockContestQuestionFindMany,
    },
    contestSubmission: {
      findMany: mockContestSubmissionFindMany,
    },
  },
}));

jest.mock('../lib/redis.js', () => ({
  redis: {
    get: jest.fn().mockResolvedValue(null),
    setex: jest.fn(),
    del: jest.fn(),
  },
  CacheKeys: {
    contestQuestions: (contestId: string) => `contest:${contestId}:questions`,
  },
  CacheTTL: {
    contestQuestions: 300,
  },
  getCachedOrFetch: mockGetCachedOrFetch,
}));

jest.mock('mongoose', () => ({
  __esModule: true,
  default: {
    model: mockMongooseModel,
    Types: {
      ObjectId: {
        isValid: mockObjectIdIsValid,
      },
    },
  },
}));

const { getContestQuestions, getQuestionById, getQuestionExecutionById } = require('./question-service.js') as typeof import('./question-service.js');

const questionDoc = {
  _id: { toString: () => 'mongo-object-id' },
  problemId: 'load-q-1',
  frontendId: 'CQ-101',
  title: 'Echo Input',
  difficulty: 'Easy',
  sampleTestCases: [{ input: '1', output: '1' }],
  hiddenTestCases: [{ input: '2', output: '2' }],
  codeSnippets: {
    cpp: {
      starterCode: 'int solve(vector<int>& nums, int k) { return 0; }',
      wrapperCode: 'int main(){return 0;}',
    },
    python3: {
      starterCode: 'def solve(nums, k):\n    return 0',
      wrapperCode: 'print(solve([], 0))',
    },
    javascript: {
      starterCode: 'function solve(nums, k) {\n  return 0;\n}',
      wrapperCode: 'console.log(solve([], 0));',
    },
  },
};

function chainResolved(value: unknown) {
  return {
    select: jest.fn().mockReturnValue({
      lean: jest.fn().mockResolvedValue(value),
    }),
  };
}

describe('question service Mongo lookup', () => {
  const dsaModel = {
    find: jest.fn(),
    findById: jest.fn(),
    findOne: jest.fn(),
  };
  const emptyModel = {
    find: jest.fn(),
    findById: jest.fn(),
    findOne: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();

    mockObjectIdIsValid.mockReturnValue(false);
    mockGetCachedOrFetch.mockImplementation((_key, _ttl, fetcher) => fetcher());
    mockQueryRawUnsafe.mockResolvedValue([
      {
        questionId: 'load-q-1',
        questionType: 'dsa',
        phase: 'dsa',
        difficulty: 'EASY',
        points: 150,
        negativePoints: 0,
        order: 1,
        phaseOrder: 1,
      },
    ]);
    mockContestQuestionFindMany.mockResolvedValue([
      {
        questionId: 'load-q-1',
        difficulty: 'EASY',
        points: 150,
        negativePoints: 0,
        order: 1,
      },
    ]);
    mockContestSubmissionFindMany.mockResolvedValue([]);

    dsaModel.find.mockReturnValue(chainResolved([questionDoc]));
    dsaModel.findOne.mockReturnValue(chainResolved(questionDoc));
    dsaModel.findById.mockReturnValue(chainResolved(null));
    emptyModel.find.mockReturnValue(chainResolved([]));
    emptyModel.findOne.mockReturnValue(chainResolved(null));
    emptyModel.findById.mockReturnValue(chainResolved(null));

    mockMongooseModel.mockImplementation((modelName: string) => (
      modelName === 'DSAQuestion' ? dsaModel : emptyModel
    ));
  });

  it('returns contest questions linked by problemId when questionId is not a Mongo ObjectId', async () => {
    const questions = await getContestQuestions('load-contest-1000', 'load-user-0001');

    expect(dsaModel.find).toHaveBeenCalledWith({
      $or: [
        { problemId: { $in: ['load-q-1'] } },
        { frontendId: { $in: ['load-q-1'] } },
      ],
    });
    expect(questions).toHaveLength(1);
    expect(questions[0]).toMatchObject({
      id: 'load-q-1',
      title: 'Echo Input',
      points: 150,
      status: 'not_attempted',
    });
  });

  it('falls back to problemId for single-question lookup', async () => {
    const question = await getQuestionById('load-q-1');

    expect(dsaModel.findById).not.toHaveBeenCalled();
    expect(dsaModel.findOne).toHaveBeenCalledWith({
      $or: [
        { problemId: 'load-q-1' },
        { frontendId: 'load-q-1' },
      ],
    });
    expect(question).toMatchObject({
      id: 'load-q-1',
      title: 'Echo Input',
    });
  });

  it('loads contest questions linked by frontendId', async () => {
    mockQueryRawUnsafe.mockResolvedValueOnce([
      {
        questionId: 'CQ-101',
        questionType: 'dsa',
        phase: 'dsa',
        difficulty: 'EASY',
        points: 150,
        negativePoints: 0,
        order: 1,
        phaseOrder: 1,
      },
    ]);

    const questions = await getContestQuestions('frontend-contest-1000', 'load-user-0001');

    expect(dsaModel.find).toHaveBeenCalledWith({
      $or: [
        { problemId: { $in: ['CQ-101'] } },
        { frontendId: { $in: ['CQ-101'] } },
      ],
    });
    expect(questions).toHaveLength(1);
    expect(questions[0]).toMatchObject({
      id: 'CQ-101',
      title: 'Echo Input',
    });
  });

  it('returns hidden tests and wrapper code for execution lookup', async () => {
    const question = await getQuestionExecutionById('load-q-1');

    expect(question.hidden_tests).toEqual([
      expect.objectContaining({
        input: '2',
        expected_output: '2',
      }),
    ]);
    expect(question.wrapper_code.cpp).toBe('int main(){return 0;}');
  });

  it('normalizes simple starters to the class Solution contract', async () => {
    const question = await getQuestionById('load-q-1');

    expect(question.starter_code.cpp).toContain('class Solution');
    expect(question.starter_code.cpp).toContain('public:');
    expect(question.starter_code.cpp).toContain('int solve(vector<int>& nums, int k)');
    expect(question.starter_code.python3).toContain('class Solution:');
    expect(question.starter_code.python3).toContain('def solve(self, nums, k):');
    expect(question.starter_code.javascript).toContain('class Solution');
    expect(question.starter_code.javascript).toContain('solve(nums, k)');
  });
});
