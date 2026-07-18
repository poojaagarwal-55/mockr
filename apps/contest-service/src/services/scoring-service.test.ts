const zaddMock = jest.fn();
const expireMock = jest.fn();
const queryRawMock = jest.fn();
const contestSubmissionUpdateMock = jest.fn();
const contestParticipantUpdateMock = jest.fn();
const transactionMock = jest.fn();

jest.mock('../lib/redis.js', () => ({
  redis: {
    zadd: zaddMock,
    expire: expireMock,
  },
}));

jest.mock('../lib/prisma.js', () => ({
  prisma: {
    $transaction: transactionMock,
  },
}));

const { finalizeSubmissionScore } = require('./scoring-service.js') as typeof import('./scoring-service.js');

const tx = {
  $queryRaw: queryRawMock,
  contestSubmission: {
    update: contestSubmissionUpdateMock,
    updateMany: jest.fn(),
  },
  contestParticipant: {
    update: contestParticipantUpdateMock,
  },
};

function primeTransaction(submissions: Array<{ id: string; status: string; pointsAwarded: number }>, totalScore: number) {
  queryRawMock
    .mockResolvedValueOnce(submissions)
    .mockResolvedValueOnce([{ totalScore }]);
}

describe('finalizeSubmissionScore', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    tx.contestSubmission.updateMany.mockResolvedValue({ count: 0 });
    transactionMock.mockImplementation(async (fn) => fn(tx));
    zaddMock.mockResolvedValue(undefined);
    expireMock.mockResolvedValue(undefined);
  });

  it('does not add points again when a completed accepted submission is re-run', async () => {
    primeTransaction([
      { id: 'sub-1', status: 'ACCEPTED', pointsAwarded: 100 },
    ], 150);

    const result = await finalizeSubmissionScore(
      'sub-1',
      'user-1',
      'contest-1',
      'question-1',
      100,
      10,
      30,
      5,
      5,
      'ACCEPTED',
      123,
      456,
    );

    expect(result).toEqual({
      pointsAwarded: 100,
      previousTotalScore: 150,
      newTotalScore: 150,
    });
    expect(contestSubmissionUpdateMock).not.toHaveBeenCalled();
    expect(contestParticipantUpdateMock).not.toHaveBeenCalled();
    expect(zaddMock).toHaveBeenCalledWith('contest:contest-1:leaderboard:live', {
      score: 150,
      member: 'user-1',
    });
  });

  it('does not apply a negative penalty again when a finalized failed submission is re-run', async () => {
    primeTransaction([
      { id: 'sub-1', status: 'WRONG_ANSWER', pointsAwarded: -10 },
    ], 40);

    const result = await finalizeSubmissionScore(
      'sub-1',
      'user-1',
      'contest-1',
      'question-1',
      100,
      10,
      30,
      2,
      5,
      'WRONG_ANSWER',
      123,
      456,
    );

    expect(result).toEqual({
      pointsAwarded: -10,
      previousTotalScore: 40,
      newTotalScore: 40,
    });
    expect(contestSubmissionUpdateMock).not.toHaveBeenCalled();
    expect(contestParticipantUpdateMock).not.toHaveBeenCalled();
  });

  it('stores zero points for failed submissions and leaves the live score unchanged', async () => {
    primeTransaction([
      { id: 'sub-1', status: 'QUEUED', pointsAwarded: 0 },
    ], 70);

    const result = await finalizeSubmissionScore(
      'sub-1',
      'user-1',
      'contest-1',
      'question-2',
      100,
      10,
      30,
      2,
      5,
      'WRONG_ANSWER',
      123,
      456,
    );

    expect(result).toEqual({
      pointsAwarded: 0,
      previousTotalScore: 70,
      newTotalScore: 70,
    });
    expect(contestSubmissionUpdateMock).toHaveBeenCalledWith({
      where: { id: 'sub-1' },
      data: expect.objectContaining({
        status: 'WRONG_ANSWER',
        pointsAwarded: 0,
        testCasesPassed: 2,
        testCasesTotal: 5,
      }),
    });
    expect(contestParticipantUpdateMock).toHaveBeenCalledWith({
      where: {
        contestId_userId: {
          contestId: 'contest-1',
          userId: 'user-1',
        },
      },
      data: {
        totalScore: 70,
      },
    });
  });

  it('deducts capped prior wrong-attempt penalties only when the question is accepted', async () => {
    primeTransaction([
      { id: 'wrong-1', status: 'WRONG_ANSWER', pointsAwarded: 0 },
      { id: 'wrong-2', status: 'RUNTIME_ERROR', pointsAwarded: 0 },
      { id: 'wrong-3', status: 'WRONG_ANSWER', pointsAwarded: 0 },
      { id: 'sub-4', status: 'PROCESSING', pointsAwarded: 0 },
    ], 0);

    const result = await finalizeSubmissionScore(
      'sub-4',
      'user-1',
      'contest-1',
      'question-1',
      100,
      10,
      30,
      5,
      5,
      'ACCEPTED',
      123,
      456,
    );

    expect(result).toEqual({
      pointsAwarded: 70,
      previousTotalScore: 0,
      newTotalScore: 70,
    });
    expect(contestSubmissionUpdateMock).toHaveBeenCalledWith({
      where: { id: 'sub-4' },
      data: expect.objectContaining({
        status: 'ACCEPTED',
        pointsAwarded: 70,
      }),
    });
    expect(contestParticipantUpdateMock).toHaveBeenCalledWith({
      where: {
        contestId_userId: {
          contestId: 'contest-1',
          userId: 'user-1',
        },
      },
      data: {
        totalScore: 70,
      },
    });
  });

  it('awards zero points when the same question is accepted again after already being solved', async () => {
    primeTransaction([
      { id: 'prior-sub', status: 'ACCEPTED', pointsAwarded: 100 },
      { id: 'sub-2', status: 'QUEUED', pointsAwarded: 0 },
    ], 100);

    const result = await finalizeSubmissionScore(
      'sub-2',
      'user-1',
      'contest-1',
      'question-1',
      100,
      10,
      30,
      5,
      5,
      'ACCEPTED',
      123,
      456,
    );

    expect(result).toEqual({
      pointsAwarded: 0,
      previousTotalScore: 100,
      newTotalScore: 100,
    });
    expect(contestSubmissionUpdateMock).toHaveBeenCalledWith({
      where: { id: 'sub-2' },
      data: expect.objectContaining({
        status: 'ACCEPTED',
        pointsAwarded: 0,
        testCasesPassed: 5,
        testCasesTotal: 5,
      }),
    });
    expect(contestParticipantUpdateMock).toHaveBeenCalledWith({
      where: {
        contestId_userId: {
          contestId: 'contest-1',
          userId: 'user-1',
        },
      },
      data: {
        totalScore: 100,
      },
    });
  });

  it('refunds legacy negative failed rows before applying accepted question penalty', async () => {
    primeTransaction([
      { id: 'wrong-1', status: 'WRONG_ANSWER', pointsAwarded: -10 },
      { id: 'wrong-2', status: 'WRONG_ANSWER', pointsAwarded: -10 },
      { id: 'sub-3', status: 'PROCESSING', pointsAwarded: 0 },
    ], -20);

    const result = await finalizeSubmissionScore(
      'sub-3',
      'user-1',
      'contest-1',
      'question-1',
      100,
      10,
      30,
      5,
      5,
      'ACCEPTED',
      123,
      456,
    );

    expect(result).toEqual({
      pointsAwarded: 80,
      previousTotalScore: -20,
      newTotalScore: 80,
    });
    expect(tx.contestSubmission.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['wrong-1', 'wrong-2'] } },
      data: { pointsAwarded: 0 },
    });
    expect(contestSubmissionUpdateMock).toHaveBeenCalledWith({
      where: { id: 'sub-3' },
      data: expect.objectContaining({
        status: 'ACCEPTED',
        pointsAwarded: 80,
      }),
    });
    expect(contestParticipantUpdateMock).toHaveBeenCalledWith({
      where: {
        contestId_userId: {
          contestId: 'contest-1',
          userId: 'user-1',
        },
      },
      data: {
        totalScore: 80,
      },
    });
  });
});
