import { z } from 'zod';
import { LANGUAGE_IDS } from '../lib/judge0-client.js';

/**
 * Execution Types and Validation Schemas
 */

// Supported languages
export const supportedLanguages = Object.keys(LANGUAGE_IDS) as Array<keyof typeof LANGUAGE_IDS>;

/**
 * Run Code Request Schema
 */
export const runCodeSchema = z.object({
  code: z.string().min(1, 'Code is required').max(262144, 'Code too large (max 256KB)'),
  language: z.enum(supportedLanguages as [string, ...string[]], {
    errorMap: () => ({ message: 'Unsupported language' }),
  }),
  questionId: z.string().min(1, 'Question ID is required'),
  // User-added custom test cases. They have no known expected output, so they
  // are executed for output only (never affect pass/fail or submission).
  customTests: z
    .array(z.object({ stdin: z.string().max(20000, 'Custom input too large') }))
    .max(15, 'Too many custom test cases')
    .optional(),
});

export type RunCodeRequest = z.infer<typeof runCodeSchema>;

/**
 * Submit Code Request Schema
 */
export const submitCodeSchema = z.object({
  code: z.string().min(1, 'Code is required').max(262144, 'Code too large (max 256KB)'),
  language: z.enum(supportedLanguages as [string, ...string[]], {
    errorMap: () => ({ message: 'Unsupported language' }),
  }),
  questionId: z.string().min(1, 'Question ID is required'),
  contestId: z.string().min(1, 'Contest ID is required'),
  idempotencyKey: z.string().uuid('Invalid idempotency key format'),
});

export type SubmitCodeRequest = z.infer<typeof submitCodeSchema>;

/**
 * Test Case Result
 */
export interface TestCaseResult {
  testCaseId: string;
  passed: boolean;
  input: any;
  expectedOutput: any;
  actualOutput: string | null;
  error: string | null;
  executionTime: string | null;
  memory?: number | null;
  status: string;
  // True for user-added custom test cases (output only, no expected answer).
  custom?: boolean;
}

/**
 * Run Code Response
 */
export interface RunCodeResponse {
  success: boolean;
  results: TestCaseResult[];
  totalTests: number;
  passedTests: number;
}

/**
 * Submit Code Response
 */
export interface SubmitCodeResponse {
  success: boolean;
  submissionId: string;
  status: string;
  message: string;
}
