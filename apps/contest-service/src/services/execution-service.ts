import { judge0Client, SupportedLanguage, isAccepted, getStatusDescription, Judge0ExecutionLimits } from '../lib/judge0-client.js';
import { TestCaseResult } from '../types/execution.js';
import * as questionService from './question-service.js';
import { buildFinalCode, compareOutput } from './submission-worker.js';

/**
 * Execution Service
 * Handles code execution for run and submit operations
 */

function normalizeLanguageKey(language: string): string {
  const normalized = (language || '').trim().toLowerCase();
  const aliases: Record<string, string> = {
    'c++': 'cpp',
    cplusplus: 'cpp',
    js: 'javascript',
    nodejs: 'javascript',
    'c#': 'csharp',
    'c-sharp': 'csharp',
  };
  return aliases[normalized] || normalized;
}

function getWrapperCode(wrapperCode: any, language: string): string | null {
  if (!wrapperCode) return null;

  const normalizedLanguage = normalizeLanguageKey(language);
  const candidates: Record<string, string[]> = {
    cpp: ['cpp', 'c++', 'cplusplus'],
    python: ['python', 'python3'],
    python3: ['python3', 'python'],
    java: ['java'],
    javascript: ['javascript', 'js', 'nodejs'],
    typescript: ['typescript', 'ts'],
    c: ['c'],
    csharp: ['csharp', 'c#'],
    go: ['go', 'golang'],
    rust: ['rust'],
    ruby: ['ruby'],
  };

  const keys = candidates[normalizedLanguage] || [normalizedLanguage];
  for (const key of keys) {
    const value = typeof wrapperCode.get === 'function' ? wrapperCode.get(key) : wrapperCode[key];
    if (typeof value === 'string' && value.trim()) return value;
    if (value && typeof value === 'object') {
      const rawWrapper = value.wrapper_code ?? value.wrapperCode ?? value.wrapper;
      if (typeof rawWrapper === 'string' && rawWrapper.trim()) return rawWrapper;
    }
  }

  return null;
}

/**
 * Run code against sample test cases
 * Returns results immediately (no queuing)
 */
/**
 * Runs a custom checker (special judge) for one test case via Judge0.
 * Checker stdin: <input>\n===OUTPUT===\n<userOutput>\n===EXPECTED===\n<expected>
 * Checker must print `1` (accepted) or `0` (rejected) as its first token.
 * Used for problems with multiple valid outputs.
 */
export function wrapCheckerCode(checkerCode: string, checkerLanguage: string | null): string {
  const lang = String(checkerLanguage || 'cpp').toLowerCase().replace('c++', 'cpp');
  if (lang === 'python' || lang === 'python3') {
    return `${checkerCode}\n\nimport sys as _sys\ndef _run():\n    _d = _sys.stdin.read()\n    _A = "===OUTPUT==="\n    _B = "===EXPECTED==="\n    _p = _d.find(_A); _q = _d.find(_B)\n    _inp = _d[:_p] if _p >= 0 else _d\n    _out = _d[_p+len(_A):_q] if (_p >= 0 and _q >= 0) else ""\n    _exp = _d[_q+len(_B):] if _q >= 0 else ""\n    print(1 if check(_inp, _out, _exp) else 0)\n_run()\n`;
  }
  if (lang === 'java') {
    return `import java.util.*;\nimport java.io.*;\n${checkerCode}\n\npublic class Main {\n    public static void main(String[] _a) throws Exception {\n        String _all = new String(System.in.readAllBytes());\n        String _A = "===OUTPUT===", _B = "===EXPECTED===";\n        int _p = _all.indexOf(_A), _q = _all.indexOf(_B);\n        String input = _p >= 0 ? _all.substring(0, _p) : _all;\n        String output = (_p >= 0 && _q >= 0) ? _all.substring(_p + _A.length(), _q) : "";\n        String expected = _q >= 0 ? _all.substring(_q + _B.length()) : "";\n        System.out.print(Checker.check(input, output, expected) ? 1 : 0);\n    }\n}\n`;
  }
  if (lang === 'javascript') {
    return `${checkerCode}\n\n(function(){\n    const _all = require('fs').readFileSync(0, 'utf8');\n    const _A = "===OUTPUT===", _B = "===EXPECTED===";\n    const _p = _all.indexOf(_A), _q = _all.indexOf(_B);\n    const input = _p >= 0 ? _all.slice(0, _p) : _all;\n    const output = (_p >= 0 && _q >= 0) ? _all.slice(_p + _A.length, _q) : "";\n    const expected = _q >= 0 ? _all.slice(_q + _B.length) : "";\n    process.stdout.write(check(input, output, expected) ? "1" : "0");\n})();\n`;
  }
  return `#include <bits/stdc++.h>\nusing namespace std;\n${checkerCode}\n\nint main(){\n    std::stringstream _buf; _buf << std::cin.rdbuf();\n    std::string _all = _buf.str(), _A = "===OUTPUT===", _B = "===EXPECTED===";\n    size_t _p = _all.find(_A), _q = _all.find(_B);\n    std::string input = (_p == std::string::npos) ? _all : _all.substr(0, _p);\n    std::string output = (_p == std::string::npos || _q == std::string::npos) ? std::string() : _all.substr(_p + _A.size(), _q - (_p + _A.size()));\n    std::string expected = (_q == std::string::npos) ? std::string() : _all.substr(_q + _B.size());\n    std::cout << (check(input, output, expected) ? 1 : 0);\n    return 0;\n}\n`;
}

export async function runChecker(
  checkerCode: string,
  checkerLanguage: string | null,
  testInput: string,
  userOutput: string,
  expectedOutput: string,
  limits: Judge0ExecutionLimits
): Promise<boolean> {
  const lang = normalizeLanguageKey(checkerLanguage || 'cpp') as SupportedLanguage;
  const stdin = `${testInput}\n===OUTPUT===\n${userOutput}\n===EXPECTED===\n${expectedOutput}\n`;
  try {
    const result = await judge0Client.executeCode(wrapCheckerCode(checkerCode, checkerLanguage), lang, stdin, undefined, limits);
    const out = String(result.stdout ?? '').trim();
    const firstToken = out.split(/\s+/)[0]?.toLowerCase() || '';
    return firstToken === '1' || firstToken === 'ok' || firstToken === 'yes' || firstToken === 'ac' || firstToken === 'accepted';
  } catch {
    return false;
  }
}

function isCheckerAccept(stdout: string | null | undefined): boolean {
  const firstToken = String(stdout ?? '').trim().split(/\s+/)[0]?.toLowerCase() || '';
  return firstToken === '1' || firstToken === 'ok' || firstToken === 'yes' || firstToken === 'ac' || firstToken === 'accepted';
}

/**
 * Runs the custom checker for MANY test cases in a SINGLE Judge0 batch.
 * The wrapped checker source is identical for every case (only the stdin —
 * input/output/expected — differs), so we compile + dispatch once instead of
 * one Judge0 call per passing test. This turns a custom-judge submission from
 * O(passing tests) checker calls into O(1) batch, which is the difference
 * between ~15 Judge0 calls and ~2 for a Monsters-style problem under load.
 *
 * Returns a boolean verdict array aligned index-for-index with `items`.
 * On any failure the whole batch resolves to `false` (rejected), matching the
 * conservative behaviour of the single-case runChecker.
 */
export async function runCheckerBatch(
  checkerCode: string,
  checkerLanguage: string | null,
  items: Array<{ input: string; output: string; expected: string }>,
  limits: Judge0ExecutionLimits
): Promise<boolean[]> {
  if (items.length === 0) return [];
  const lang = normalizeLanguageKey(checkerLanguage || 'cpp') as SupportedLanguage;
  const wrapped = wrapCheckerCode(checkerCode, checkerLanguage);
  const stdins = items.map(
    (it) => `${it.input}\n===OUTPUT===\n${it.output}\n===EXPECTED===\n${it.expected}\n`
  );
  try {
    const results = await judge0Client.executeBatch(wrapped, lang, stdins, limits);
    return items.map((_, i) => isCheckerAccept(results[i]?.stdout));
  } catch {
    return items.map(() => false);
  }
}

export async function runCode(
  code: string,
  language: SupportedLanguage,
  questionId: string,
  customTests?: Array<{ stdin?: string }>
): Promise<{ results: TestCaseResult[]; totalTests: number; passedTests: number }> {
  const normalizedLanguage = normalizeLanguageKey(language) as SupportedLanguage;
  const question = await questionService.getQuestionExecutionById(questionId);
  const wrapperCode = getWrapperCode((question as any).wrapper_code, normalizedLanguage);
  const finalCode = buildFinalCode(code, wrapperCode, normalizedLanguage);
  const limits: Judge0ExecutionLimits = {
    cpuTimeLimitSeconds: Number((question as any).timeLimit || 2),
    memoryLimitMb: Number((question as any).memoryLimit || 256),
  };
  const useCustomChecker = (question as any).judgeType === 'custom' && !!(question as any).checkerCode;
  const checkerCode = (question as any).checkerCode as string | null;
  const checkerLanguage = (question as any).checkerLanguage as string | null;

  if (!question.sample_tests || question.sample_tests.length === 0) {
    throw new Error('No sample test cases available');
  }

  // Execute code against each sample test case
  const results: TestCaseResult[] = [];

  for (const testCase of question.sample_tests) {
    try {
      const input = testCase.stdin ?? testCase.input ?? '';
      const expected = testCase.expected_output ?? testCase.output ?? testCase.expected ?? '';

      // Prepare input
      const stdin = typeof input === 'string'
        ? input
        : JSON.stringify(input);

      // Execute code
      const result = await judge0Client.executeCode(finalCode, normalizedLanguage, stdin, undefined, limits);

      // Check if passed
      const expectedOutput = typeof expected === 'string'
        ? expected
        : JSON.stringify(expected);

      const actualOutput = result.stdout ?? null;
      const passed = isAccepted(result) && (
        useCustomChecker
          ? await runChecker(checkerCode!, checkerLanguage, stdin, actualOutput ?? '', expectedOutput, limits)
          : compareOutput(actualOutput ?? '', expectedOutput)
      );
      const judgeStatus = result.status.description || getStatusDescription(result.status.id);
      const status = passed
        ? 'Accepted'
        : judgeStatus.toLowerCase() === 'accepted'
          ? 'Wrong Answer'
          : judgeStatus || 'Wrong Answer';

      results.push({
        testCaseId: testCase.id,
        passed,
        input,
        expectedOutput: expected,
        actualOutput,
        error: result.stderr || result.compile_output || result.message || null,
        executionTime: result.time,
        memory: result.memory,
        status,
      });
    } catch (error: any) {
      results.push({
        testCaseId: testCase.id,
        passed: false,
        input: testCase.stdin ?? testCase.input ?? '',
        expectedOutput: testCase.expected_output ?? testCase.output ?? testCase.expected ?? '',
        actualOutput: null,
        error: error.message,
        executionTime: null,
        status: 'Error',
      });
    }
  }

  const passedTests = results.filter((r) => r.passed).length;
  const totalTests = results.length;

  // Run user-provided custom test cases for OUTPUT ONLY. They have no known
  // expected answer, so they never affect pass/fail counts or submissions —
  // we just execute the code against the user's input and return the output.
  if (customTests && customTests.length > 0) {
    for (let i = 0; i < customTests.length; i++) {
      const stdin = String(customTests[i]?.stdin ?? '');
      try {
        const result = await judge0Client.executeCode(finalCode, normalizedLanguage, stdin, undefined, limits);
        const ran = isAccepted(result);
        const judgeStatus = result.status.description || getStatusDescription(result.status.id);
        results.push({
          testCaseId: `custom-${i}`,
          custom: true,
          passed: false,
          input: stdin,
          expectedOutput: null,
          actualOutput: result.stdout ?? null,
          error: result.stderr || result.compile_output || result.message || null,
          executionTime: result.time,
          memory: result.memory,
          status: ran ? 'Finished' : (judgeStatus || 'Error'),
        });
      } catch (error: any) {
        results.push({
          testCaseId: `custom-${i}`,
          custom: true,
          passed: false,
          input: stdin,
          expectedOutput: null,
          actualOutput: null,
          error: error.message,
          executionTime: null,
          status: 'Error',
        });
      }
    }
  }

  return {
    results,
    totalTests,
    passedTests,
  };
}
