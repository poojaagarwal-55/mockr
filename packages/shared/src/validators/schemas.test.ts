import {
  CodeExecutionRequestSchema,
  CreateQuestionSchema,
  StartInterviewSchema,
  SupportedLanguageSchema,
} from './schemas';

describe('shared zod schemas', () => {
  test('StartInterviewSchema applies defaults', () => {
    const parsed = StartInterviewSchema.parse({
      role: 'backend',
      level: 'SDE2',
    });

    expect(parsed).toEqual({
      type: 'full_interview',
      role: 'backend',
      level: 'SDE2',
      mode: 'mock',
      resumeId: null,
    });
  });

  test('SupportedLanguageSchema rejects unknown language', () => {
    const result = SupportedLanguageSchema.safeParse('rust');
    expect(result.success).toBe(false);
  });

  test('CodeExecutionRequestSchema enforces code length', () => {
    const tooLong = 'a'.repeat(50_001);

    const result = CodeExecutionRequestSchema.safeParse({
      sessionId: '4fcf0e9f-057f-4986-98f0-ffba2d50e2f8',
      questionId: 'ec33188c-069f-4a83-ad90-42e0467784f9',
      language: 'typescript',
      code: tooLong,
    });

    expect(result.success).toBe(false);
  });

  test('CreateQuestionSchema validates slug pattern and defaults arrays', () => {
    const valid = CreateQuestionSchema.parse({
      slug: 'two-sum-ii',
      title: 'Two Sum II',
      category: 'DSA',
      difficulty: 'Easy',
      problemMd: 'Find two values with target sum.',
    });

    expect(valid.examples).toEqual([]);
    expect(valid.hints).toEqual([]);
    expect(valid.tags).toEqual([]);

    const invalid = CreateQuestionSchema.safeParse({
      slug: 'Two Sum',
      title: 'Two Sum',
      category: 'DSA',
      difficulty: 'Easy',
      problemMd: 'Find two values with target sum.',
    });

    expect(invalid.success).toBe(false);
  });
});
