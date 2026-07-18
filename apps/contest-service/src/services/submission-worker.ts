import { submissionQueue, SubmissionJob } from '../lib/queue.js';
import { prisma } from '../lib/prisma.js';
import { judge0Client, LANGUAGE_IDS, SupportedLanguage, Judge0ExecutionLimits, Judge0ResultResponse } from '../lib/judge0-client.js';
import { finalizeSubmissionScore } from './scoring-service.js';
import { redis } from '../lib/redis.js';
import { publishSubmissionNotification } from '../lib/notification-bus.js';
import { isJudge0InfrastructureError } from '../lib/judge0-errors.js';
import { env } from '../lib/env.js';
import { runWithJudge0Concurrency } from '../lib/judge0-concurrency.js';
import * as questionService from './question-service.js';
import { runChecker, runCheckerBatch } from './execution-service.js';

type Checker = { code: string; language: string | null } | null;

/**
 * Submission Worker
 *
 * Mirrors the main API (code-execution.ts) execution behavior:
 *   1. Fetch a normalized execution question, including hidden tests
 *   2. Extract test cases using the same input/output field fallbacks
 *   3. Apply wrapperCode from the normalized wrapper map
 *   4. Submit to Judge0 one test at a time, poll for result
 *   5. Normalize output before comparison (trim whitespace, normalize line endings)
 *   6. Persist final verdict + notify via WebSocket + Redis
 */

export const JUDGING_DEFERRED_STATUS = 'JUDGING_DEFERRED';

// ─── Test case normalisation and comparison (mirrors main API) ────────────────

function normalizeOutput(output: string): string {
  return output
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .join('\n')
    .replace(/\n+$/, '')
    .trim();
}

/**
 * Tries to parse Python-like literals (True/False/None) and convert to JSON.
 * Mirrors the main API's tryParsePythonLikeLiteral function.
 */
function tryParsePythonLikeLiteral(input: string): unknown {
  const transformed = input
    .replace(/\bTrue\b/g, 'true')
    .replace(/\bFalse\b/g, 'false')
    .replace(/\bNone\b/g, 'null')
    .replace(/'([^'\\]*(?:\\.[^'\\]*)*)'/g, (_, content: string) => {
      const escaped = content.replace(/\\"/g, '"').replace(/"/g, '\\"');
      return `"${escaped}"`;
    });

  return JSON.parse(transformed);
}

/**
 * Canonicalizes output for comparison by:
 * 1. Normalizing whitespace
 * 2. Parsing as JSON if possible (handles spacing differences)
 * 3. Parsing as Python literal if JSON fails
 * 4. Handling primitives (numbers, booleans, null)
 * 
 * This ensures [1,2] matches [1, 2], True matches true, etc.
 * Mirrors the main API's canonicalizeComparableOutput function.
 */
function canonicalizeComparableOutput(output: string): string {
  const normalized = normalizeOutput(output);
  if (!normalized) return normalized;

  try {
    return JSON.stringify(JSON.parse(normalized));
  } catch {
    try {
      return JSON.stringify(tryParsePythonLikeLiteral(normalized));
    } catch {
      // Ignore Python-literal parse failures and continue with primitive checks
    }

    // Not JSON — allow common unquoted primitives for robust comparison
    if (/^-?\d+(?:\.\d+)?$/.test(normalized)) {
      return JSON.stringify(Number(normalized));
    }
    if (/^(true|false)$/i.test(normalized)) {
      return JSON.stringify(normalized.toLowerCase() === 'true');
    }
    if (normalized === 'null' || normalized === 'None') {
      return JSON.stringify(null);
    }
    return normalized;
  }
}

/**
 * Compares actual program output with expected output after canonicalization.
 * Returns whether the test passed.
 * Mirrors the main API's compareOutput function.
 */
export function compareOutput(actual: string, expected: string): boolean {
  const normalizedActual = canonicalizeComparableOutput(actual);
  const normalizedExpected = canonicalizeComparableOutput(expected);
  return normalizedActual === normalizedExpected;
}

// ─── Wrapper-code application (mirrors main API's combineCodeWithWrapper) ──────

/**
 * Extracts wrapper code from either raw codeSnippets or normalized wrapper_code maps.
 */
function getWrapperCode(codeSnippets: any, language: string): string | null {
  if (!codeSnippets) return null;

  const aliases: Record<string, string[]> = {
    cpp:        ['cpp', 'c++', 'cplusplus'],
    python:     ['python', 'python3'],
    python3:    ['python3', 'python'],
    java:       ['java'],
    javascript: ['javascript', 'js', 'nodejs'],
    typescript: ['typescript', 'ts'],
    c:          ['c'],
    csharp:     ['csharp', 'c#'],
    go:         ['go'],
    rust:       ['rust'],
    ruby:       ['ruby'],
  };

  const candidates = aliases[language] ?? [language];

  // Mongoose Maps expose .get(); plain objects use bracket access
  const get = (key: string) =>
    typeof codeSnippets.get === 'function'
      ? codeSnippets.get(key)
      : codeSnippets[key];

  for (const candidate of candidates) {
    const snippet = get(candidate);
    if (typeof snippet === 'string' && snippet.trim()) {
      return snippet;
    }
    if (snippet && typeof snippet === 'object') {
      const rawWrapper = snippet.wrapper_code ?? snippet.wrapperCode ?? snippet.wrapper;
      if (typeof rawWrapper === 'string' && rawWrapper.trim()) return rawWrapper;
    }
  }
  return null;
}

function splitParams(params: string): string[] {
  const trimmed = params.trim();
  if (!trimmed) return [];
  return trimmed
    .split(',')
    .map((param) => param.trim())
    .filter(Boolean);
}

function extractSimpleArgName(param: string, fallback: string): string {
  const withoutDefault = param.replace(/=[\s\S]*$/, '').trim();
  const match = withoutDefault.match(/([A-Za-z_$][\w$]*)\s*$/);
  return match?.[1] || fallback;
}

function buildPythonClassSolutionAdapters(userCode: string): string {
  if (!/\bclass\s+Solution\b/.test(userCode)) return '';

  const lines = userCode.split('\n');
  const methods: Array<{ name: string; params: string }> = [];
  let insideSolution = false;
  let classIndent = 0;

  for (const line of lines) {
    const classMatch = line.match(/^(\s*)class\s+Solution\b/);
    if (classMatch) {
      insideSolution = true;
      classIndent = classMatch[1]?.length ?? 0;
      continue;
    }

    if (!insideSolution) continue;

    const trimmed = line.trim();
    if (!trimmed) continue;

    const indent = line.length - line.trimStart().length;
    if (indent <= classIndent) {
      insideSolution = false;
      continue;
    }

    const methodMatch = line.match(/^\s*def\s+([A-Za-z_]\w*)\s*\(([^)]*)\)\s*:/);
    if (!methodMatch) continue;

    const name = methodMatch[1] || '';
    if (!name || name.startsWith('__')) continue;

    const rawParams = splitParams(methodMatch[2] || '');
    const callableParams = rawParams[0] === 'self' || rawParams[0] === 'cls'
      ? rawParams.slice(1)
      : rawParams;
    methods.push({ name, params: callableParams.join(', ') });
  }

  const adapters: string[] = [];
  const seen = new Set<string>();

  for (const method of methods) {
    if (seen.has(method.name)) continue;
    seen.add(method.name);

    const topLevelFunction = new RegExp(`^def\\s+${method.name}\\s*\\(`, 'm').test(userCode);
    if (topLevelFunction) continue;

    const args = splitParams(method.params)
      .map((param, index) => extractSimpleArgName(param, `arg${index}`))
      .join(', ');

    adapters.push(`def ${method.name}(${method.params}):`);
    adapters.push(`    return Solution().${method.name}(${args})`);
    adapters.push('');
  }

  return adapters.join('\n');
}

function buildJavaScriptClassSolutionAdapters(userCode: string): string {
  if (!/\bclass\s+Solution\b/.test(userCode)) return '';

  const reserved = new Set(['constructor', 'if', 'for', 'while', 'switch', 'catch', 'function']);
  const methods: Array<{ name: string; params: string; isStatic: boolean; isAsync: boolean }> = [];
  const methodPattern = /^\s*(static\s+)?(async\s+)?([A-Za-z_$][\w$]*)\s*\(([^)]*)\)\s*\{/gm;
  let match: RegExpExecArray | null;

  while ((match = methodPattern.exec(userCode)) !== null) {
    const name = match[3] || '';
    if (!name || reserved.has(name)) continue;
    methods.push({
      name,
      params: (match[4] || '').trim(),
      isStatic: Boolean(match[1]),
      isAsync: Boolean(match[2]),
    });
  }

  const adapters: string[] = [];
  const seen = new Set<string>();

  for (const method of methods) {
    if (seen.has(method.name)) continue;
    seen.add(method.name);

    const topLevelFunction = new RegExp(`^\\s*(?:async\\s+)?function\\s+${method.name}\\s*\\(`, 'm').test(userCode);
    if (topLevelFunction) continue;

    const args = splitParams(method.params)
      .map((param, index) => extractSimpleArgName(param, `arg${index}`))
      .join(', ');
    const asyncPrefix = method.isAsync ? 'async ' : '';
    const receiver = method.isStatic ? 'Solution' : 'new Solution()';
    const awaitPrefix = method.isAsync ? 'await ' : '';

    adapters.push(`${asyncPrefix}function ${method.name}(${method.params}) {`);
    adapters.push(`  return ${awaitPrefix}${receiver}.${method.name}(${args});`);
    adapters.push('}');
    adapters.push('');
  }

  return adapters.join('\n');
}

function stripUserCodePlaceholder(wrapperCode: string): string {
  return wrapperCode
    .replace(/^[ \t]*<USER_CODE>[ \t]*;?[ \t]*(?:\r?\n)?/gm, '')
    .replace(/<USER_CODE>/g, '');
}

function extractJavaSolutionMethodNames(userCode: string): string[] {
  if (!/\bclass\s+Solution\b/.test(userCode)) return [];

  const names = new Set<string>();
  const reserved = new Set(['if', 'for', 'while', 'switch', 'catch', 'main', 'Solution']);
  const methodPattern = /\b(?:public|private|protected)?\s*(?:static\s+)?(?:final\s+)?[\w<>\[\], ?&]+\s+([A-Za-z_]\w*)\s*\([^)]*\)\s*(?:throws\s+[^{]+)?\{/g;
  let match: RegExpExecArray | null;

  while ((match = methodPattern.exec(userCode)) !== null) {
    const name = match[1] || '';
    if (name && !reserved.has(name)) {
      names.add(name);
    }
  }

  return Array.from(names);
}

function rewriteJavaDirectSolutionCalls(wrapperCode: string, userCode: string): string {
  let rewritten = wrapperCode;

  for (const name of extractJavaSolutionMethodNames(userCode)) {
    const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    rewritten = rewritten.replace(
      new RegExp(`(^|[^A-Za-z0-9_\\.])${escapedName}\\s*\\(`, 'g'),
      `$1new Solution().${name}(`
    );
  }

  return rewritten;
}

/**
 * Combines user code with wrapper code in a language-aware manner.
 *
 * Ported directly from the main API's combineCodeWithWrapper() in code-execution.ts.
 *
 * Final output order for C++:
 *   1. #include / using lines (from wrapper)
 *   2. Pre-user lines (forward declarations, helpers from wrapper, before Solution class)
 *   3. User's class Solution { ... }
 *   4. Auto-generated adapter functions (free functions calling Solution methods)
 *   5. Post-user lines (main/runner from wrapper, after Solution class)
 */
export function buildFinalCode(userCode: string, wrapperCode: string | null, language: string): string {
  if (!wrapperCode) return userCode;

  const wrapperHasUserCodePlaceholder = wrapperCode.includes('<USER_CODE>');
  const userUsesClassSolution = /\bclass\s+Solution\b/.test(userCode);
  const effectiveWrapperCode = wrapperHasUserCodePlaceholder && userUsesClassSolution
    ? stripUserCodePlaceholder(wrapperCode)
    : wrapperCode;

  if (wrapperHasUserCodePlaceholder && !userUsesClassSolution) {
    return wrapperCode.replace(/<USER_CODE>/g, userCode);
  }

  const lang = (language || '').toLowerCase();

  if (lang === 'go' || lang === 'golang') {
    return wrapperCode + '\n' + userCode;
  }

  if (lang === 'csharp' || lang === 'c#' || lang === 'cs') {
    const wrapperLines = wrapperCode.split('\n');
    const usingLines: string[] = [];
    const restLines: string[] = [];
    for (const line of wrapperLines) {
      if (line.trim().startsWith('using ')) usingLines.push(line);
      else restLines.push(line);
    }
    const parts: string[] = [];
    if (usingLines.length > 0) parts.push(usingLines.join('\n'));
    parts.push(userCode);
    if (restLines.join('\n').trim()) parts.push(restLines.join('\n'));
    return parts.join('\n');
  }

  if (lang === 'java') {
    const wrapperLines = rewriteJavaDirectSolutionCalls(effectiveWrapperCode, userCode).split('\n');
    const importLines: string[] = [];
    const restLines: string[] = [];
    let insideClass = false;
    let braceCount = 0;
    for (const line of wrapperLines) {
      const t = line.trim();
      if (t.startsWith('import ') || t.startsWith('package ')) { importLines.push(line); continue; }
      if (!insideClass && t.match(/^(public\s+)?class\s+\w+/) && !t.includes('class Main')) {
        insideClass = true; braceCount = 0; continue;
      }
      if (insideClass) {
        for (const ch of line) { if (ch === '{') braceCount++; if (ch === '}') braceCount--; }
        if (braceCount < 0) insideClass = false;
        continue;
      }
      restLines.push(line);
    }
    const parts: string[] = [];
    if (importLines.length > 0) parts.push(importLines.join('\n'));
    parts.push(userCode);
    if (restLines.join('\n').trim()) parts.push(restLines.join('\n'));
    return parts.join('\n');
  }

  if (lang === 'cpp' || lang === 'c++') {
    const wrapperLines = effectiveWrapperCode.split('\n');
    const headerLines: string[] = [];
    const preUserLines: string[] = [];
    const postUserLines: string[] = [];
    const hasBitsHeader = /#include\s*<bits\/stdc\+\+\.h>/.test(effectiveWrapperCode);
    let sawUsingStd = /\busing\s+namespace\s+std\s*;/.test(effectiveWrapperCode);
    const userUsesStdQualified = /\bstd::/.test(userCode);

    const countBraces = (line: string) =>
      (line.match(/\{/g) || []).length - (line.match(/\}/g) || []).length;

    const parseFnProto = (line: string) => {
      const t = line.trim();
      if (!t || t.includes('=') || t.startsWith('#')) return null;
      const m = t.match(/^(.+?)\s+([A-Za-z_]\w*)\s*\(([^;{}]*)\)\s*;$/);
      if (!m) return null;
      return { returnType: m[1]?.trim() || '', name: m[2]?.trim() || '', params: m[3]?.trim() || '' };
    };

    const extractArgNames = (params: string) => {
      const t = params.trim();
      if (!t || t === 'void') return [];
      return t.split(',').map((p, idx) => {
        const m = p.replace(/=[^,]+$/, '').trim().match(/([A-Za-z_]\w*)\s*(?:\[[^\]]*\])?\s*$/);
        return m?.[1] || `arg${idx}`;
      });
    };

    const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    const wrapperUsesFunction = (name: string, lines: string[]) => {
      const source = lines.join('\n');
      const pattern = new RegExp(`(^|[^\\w:.>])${escapeRegExp(name)}\\s*\\(`);
      return pattern.test(source);
    };

    const parseUserSolutionMethods = () => {
      if (!/\bclass\s+Solution\b/.test(userCode)) return [] as Array<{ returnType: string; name: string; params: string }>;

      const methods: Array<{ returnType: string; name: string; params: string }> = [];
      const seen = new Set<string>();
      const methodPattern = /^([~\w:<>,\s*&]+?)\s+([A-Za-z_]\w*)\s*\(([^()]*)\)\s*(?:const\s*)?(?:\{|;)\s*$/;
      const lines = userCode.split('\n');
      let insideSolution = false;
      let depth = 0;
      let access: 'public' | 'private' | 'protected' = 'private';

      for (const line of lines) {
        const trimmed = line.trim();

        if (!insideSolution) {
          if (/^class\s+Solution\b/.test(trimmed)) {
            insideSolution = true;
            depth = countBraces(line);
            access = 'private';
          }
          continue;
        }

        const accessMatch = trimmed.match(/^(public|private|protected)\s*:/);
        if (accessMatch) {
          access = accessMatch[1] as 'public' | 'private' | 'protected';
          depth += countBraces(line);
          if (depth <= 0) insideSolution = false;
          continue;
        }

        if (
          access === 'public' &&
          depth === 1 &&
          trimmed &&
          !trimmed.startsWith('//') &&
          !trimmed.startsWith('return ') &&
          !trimmed.startsWith('friend ') &&
          !trimmed.startsWith('using ') &&
          !trimmed.includes(' operator')
        ) {
          const methodMatch = trimmed.match(methodPattern);
          if (methodMatch) {
            const candidate = {
              returnType: methodMatch[1]?.trim() || '',
              name: methodMatch[2]?.trim() || '',
              params: methodMatch[3]?.trim() || '',
            };
            if (candidate.returnType && candidate.name !== 'Solution') {
              const key = `${candidate.returnType}|${candidate.name}|${candidate.params}`;
              if (!seen.has(key)) {
                seen.add(key);
                methods.push(candidate);
              }
            }
          }
        }

        depth += countBraces(line);
        if (depth <= 0) insideSolution = false;
      }

      return methods;
    };

    const buildAdapters = (prelude: string[], wrapperUsageLines: string[]) => {
      if (!/\bclass\s+Solution\b/.test(userCode)) return [];
      const adapters: string[] = [];
      const seen = new Set<string>();
      let depth = 0;
      for (const line of prelude) {
        if (depth === 0) {
          const p = parseFnProto(line);
          if (p) {
            const key = `${p.returnType}|${p.name}|${p.params}`;
            if (!seen.has(key)) {
              seen.add(key);
              const args = extractArgNames(p.params).join(', ');
              adapters.push(`${p.returnType} ${p.name}(${p.params}) {`);
              adapters.push('    Solution sol;');
              adapters.push(p.returnType === 'void' ? `    sol.${p.name}(${args});` : `    return sol.${p.name}(${args});`);
              adapters.push('}', '');
            }
          }
        }
        depth += countBraces(line);
        if (depth < 0) depth = 0;
      }

      for (const method of parseUserSolutionMethods()) {
        const key = `${method.returnType}|${method.name}|${method.params}`;
        if (seen.has(key)) continue;
        if (!wrapperUsesFunction(method.name, wrapperUsageLines)) continue;
        seen.add(key);
        const args = extractArgNames(method.params).join(', ');
        adapters.push(`${method.returnType} ${method.name}(${method.params}) {`);
        adapters.push('    Solution sol;');
        adapters.push(method.returnType === 'void' ? `    sol.${method.name}(${args});` : `    return sol.${method.name}(${args});`);
        adapters.push('}', '');
      }

      return adapters;
    };

    let insideSolution = false;
    let solDepth = 0;
    let solSeen = false;

    for (const line of wrapperLines) {
      const t = line.trim();
      if (t.startsWith('#include') || t.startsWith('using namespace') || t.startsWith('using std::')) {
        headerLines.push(line);
        if (/^using\s+namespace\s+std\s*;/.test(t)) sawUsingStd = true;
        continue;
      }
      if (!insideSolution && t.match(/^class\s+Solution\b/)) {
        insideSolution = true; solSeen = true;
        solDepth = countBraces(line);
        if (solDepth <= 0 && t.includes('};')) insideSolution = false;
        continue;
      }
      if (insideSolution) {
        solDepth += countBraces(line);
        if (solDepth <= 0) insideSolution = false;
        continue;
      }
      if (!solSeen) preUserLines.push(line);
      else postUserLines.push(line);
    }

    if (!solSeen) {
      const mainIdx = preUserLines.findIndex(l => l.trim().match(/^int\s+main\s*\(/));
      if (mainIdx >= 0) {
        postUserLines.push(...preUserLines.slice(mainIdx));
        preUserLines.splice(mainIdx);
      }
    }

    const adapters = buildAdapters(preUserLines, [...preUserLines, ...postUserLines]);
    const parts: string[] = [];
    if (!hasBitsHeader) parts.push('#include <bits/stdc++.h>');
    if (headerLines.length > 0) parts.push(headerLines.join('\n'));
    if (!sawUsingStd && !userUsesStdQualified) parts.push('using namespace std;');
    if (preUserLines.join('\n').trim()) parts.push(preUserLines.join('\n'));
    parts.push(userCode);
    if (adapters.length > 0) parts.push(adapters.join('\n'));
    if (postUserLines.join('\n').trim()) parts.push(postUserLines.join('\n'));
    return parts.join('\n');
  }

  if (lang === 'python' || lang === 'python3') {
    const adapters = buildPythonClassSolutionAdapters(userCode);
    return [userCode, adapters, effectiveWrapperCode].filter((part) => part.trim()).join('\n');
  }

  if (lang === 'javascript' || lang === 'js' || lang === 'nodejs' || lang === 'typescript' || lang === 'ts') {
    const adapters = buildJavaScriptClassSolutionAdapters(userCode);
    return [userCode, adapters, effectiveWrapperCode].filter((part) => part.trim()).join('\n');
  }

  // Other languages.
  return userCode + '\n' + effectiveWrapperCode;
}

// ─── Core processor ────────────────────────────────────────────────────────────

export async function processSubmissionJob(job: SubmissionJob): Promise<void> {
  const { submissionId, userId, contestId, questionId, code, language, attemptNumber } = job;

  console.log(`[Worker] Processing submission ${submissionId} (attempt ${attemptNumber}, lang=${language})`);

  try {
    // 1. Mark PROCESSING
    await prisma.contestSubmission.update({
      where: { id: submissionId },
      data: { status: 'PROCESSING' },
    });

    // 2. Fetch the raw MongoDB doc (dsa_questions collection)
    const { testCases, wrapperCode, limits, checker } = await fetchDSAQuestionTestCases(questionId, language);

    if (testCases.length === 0) {
      throw new Error(`No test cases found for question ${questionId}`);
    }

    console.log(`[Worker] ${testCases.length} test cases, wrapperCode=${wrapperCode ? 'yes' : 'no'}`);

    // 3. Normalize language key to what Judge0Client understands
    const normalizedLang = normalizeLanguage(language);
    if (!normalizedLang) {
      throw new Error(`Unsupported language: ${language}`);
    }

    // 4. Build the final code (user solution + wrapper, language-aware, same as main API)
    const finalCode = buildFinalCode(code, wrapperCode, normalizedLang);

    // 5. Run all test cases through Judge0
    const results = await runAllTestCases(finalCode, normalizedLang, testCases, limits, checker);

    // 6. Tally
    const testCasesPassed = results.filter((r) => r.passed).length;
    const testCasesTotal  = results.length;
    const allPassed       = testCasesPassed === testCasesTotal;
    const firstFailedIndex = results.findIndex((r) => !r.passed);
    const firstFailedTest = firstFailedIndex >= 0
      ? {
          source: 'hidden' as const,
          status: results[firstFailedIndex]?.status,
          input: testCases[firstFailedIndex]?.input ?? '',
          expected: testCases[firstFailedIndex]?.expected ?? '',
          actual: results[firstFailedIndex]?.stdout ?? '',
          stderr: results[firstFailedIndex]?.stderr ?? '',
          compileOutput: results[firstFailedIndex]?.compileOutput ?? '',
        }
      : undefined;

    // 7. Determine verdict
    const finalStatus = determineVerdict(results, allPassed);

    // 8. Look up contest question for scoring
    const contestQuestion = await prisma.contestQuestion.findUnique({
      where: { contestId_questionId: { contestId, questionId } },
    });
    if (!contestQuestion) {
      throw new Error(`Contest question not found: ${contestId}/${questionId}`);
    }

    const rawMaxTime = results.length > 0 ? Math.max(...results.map((r) => parseFloat(r.time || '0'))) : 0;
    const rawMaxMem  = results.length > 0 ? Math.max(...results.map((r) => r.memory || 0)) : 0;

    const score = await finalizeSubmissionScore(
      submissionId,
      userId,
      contestId,
      questionId,
      contestQuestion.points,
      contestQuestion.negativePoints,
      contestQuestion.negativeCap,
      testCasesPassed,
      testCasesTotal,
      finalStatus,
      rawMaxTime > 0 ? Math.round(rawMaxTime * 1000) : null,
      rawMaxMem > 0 ? rawMaxMem : null,
    );

    console.log(
      `[Worker] ${submissionId} → ${finalStatus} ` +
      `(${testCasesPassed}/${testCasesTotal}, ${score.pointsAwarded} pts)`
    );

    // 11. Notify user
    await publishResult(submissionId, userId, {
      status: finalStatus,
      testCasesPassed,
      testCasesTotal,
      pointsAwarded: score.pointsAwarded,
      totalScore:    score.newTotalScore,
      executionTime: rawMaxTime > 0 ? Math.round(rawMaxTime * 1000) : null,
      memoryUsed:    rawMaxMem  > 0 ? rawMaxMem  : null,
      failedTest: firstFailedTest,
      errorDetails:
        firstFailedTest?.compileOutput ||
        firstFailedTest?.stderr ||
        undefined,
    });

  } catch (error: any) {
    if (isJudge0InfrastructureError(error)) {
      console.warn(
        `[Worker] Judge0 infrastructure failure for submission ${submissionId}; deferring for retry:`,
        error.message
      );

      try {
        await prisma.contestSubmission.update({
          where: { id: submissionId },
          data: {
            status: JUDGING_DEFERRED_STATUS as any,
            pointsAwarded: 0,
          },
        });
      } catch (inner) {
        console.error('[Worker] Failed to persist Judge0 deferred state:', inner);
      }

      throw error;
    }

    console.error(`[Worker] Error processing submission ${submissionId}:`, error?.message ?? error);

    try {
      await prisma.contestSubmission.update({
        where: { id: submissionId },
        data: { status: 'RUNTIME_ERROR', testCasesPassed: 0, testCasesTotal: 0, pointsAwarded: 0 },
      });
      await publishResult(submissionId, userId, {
        status: 'RUNTIME_ERROR', testCasesPassed: 0, testCasesTotal: 0,
        pointsAwarded: 0, totalScore: 0,
        errorDetails: 'Submission judging failed before a detailed verdict was available.',
      });
    } catch (inner) {
      console.error('[Worker] Failed to persist error state:', inner);
    }

    throw error;
  }
}

// ─── DSA question fetcher ──────────────────────────────────────────────────────

interface TestCaseRow {
  input: string;
  expected: string;
}

async function fetchDSAQuestionTestCases(
  questionId: string,
  language: string
): Promise<{ testCases: TestCaseRow[]; wrapperCode: string | null; limits: Judge0ExecutionLimits; checker: Checker }> {

  const doc: any = await questionService.getQuestionExecutionById(questionId);

  const toStr = (v: any) => {
    if (v === null || v === undefined) return '';
    return typeof v === 'string' ? v : JSON.stringify(v);
  };

  const sampleRows: TestCaseRow[] = (doc.sample_tests ?? doc.sampleTestCases ?? []).map((tc: any) => ({
    input:    toStr(tc.stdin ?? tc.input ?? ''),
    expected: toStr(tc.expected_output ?? tc.output ?? tc.expected ?? tc.expectedOutput ?? ''),
  }));

  const hiddenRows: TestCaseRow[] = (doc.hidden_tests ?? doc.hiddenTestCases ?? []).map((tc: any) => ({
    input:    toStr(tc.stdin ?? tc.input ?? ''),
    expected: toStr(tc.expected_output ?? tc.output ?? tc.expected ?? tc.expectedOutput ?? ''),
  }));

  // Skip sample tests on submit — only hidden tests determine the verdict.
  // This mirrors the main API's paid-plan behaviour (skipSampleTests=true).
  const testCases = hiddenRows.length > 0 ? hiddenRows : sampleRows;

  console.log(
    `[Worker] Question ${questionId}: running ` +
    `${testCases.length} ${hiddenRows.length > 0 ? 'hidden' : 'sample'} test cases`
  );

  // Extract wrapperCode for the requested language from codeSnippets
  const wrapperCode = getWrapperCode(doc.wrapper_code ?? doc.codeSnippets, normalizeLanguage(language) ?? language);
  const limits: Judge0ExecutionLimits = {
    cpuTimeLimitSeconds: Number(doc.timeLimit || 2),
    memoryLimitMb: Number(doc.memoryLimit || 256),
  };

  const checker: Checker = doc.judgeType === 'custom' && doc.checkerCode
    ? { code: String(doc.checkerCode), language: doc.checkerLanguage ?? null }
    : null;

  return { testCases, wrapperCode, limits, checker };
}

// ─── Language normalisation ────────────────────────────────────────────────────

function normalizeLanguage(lang: string): SupportedLanguage | null {
  const map: Record<string, SupportedLanguage> = {
    cpp: 'cpp', 'c++': 'cpp', cplusplus: 'cpp',
    python: 'python3', python3: 'python3',
    java: 'java',
    javascript: 'javascript', js: 'javascript', nodejs: 'javascript',
    typescript: 'typescript', ts: 'typescript',
    c: 'c',
    csharp: 'csharp', 'c#': 'csharp',
    go: 'go',
    rust: 'rust',
    ruby: 'ruby',
  };
  return map[lang.toLowerCase()] ?? null;
}

// ─── Judge0 execution ──────────────────────────────────────────────────────────

export interface RunResult {
  passed: boolean;
  status: string;
  stdout: string | null;
  stderr: string | null;
  compileOutput: string | null;
  time: string | null;
  memory: number | null;
}

interface FailedTestPayload {
  source: 'hidden';
  status?: string;
  input: string;
  expected: string;
  actual: string;
  stderr?: string;
  compileOutput?: string;
}

export async function runAllTestCases(
  finalCode: string,
  language: SupportedLanguage,
  testCases: TestCaseRow[],
  limits?: Judge0ExecutionLimits,
  checker?: Checker
): Promise<RunResult[]> {
  if (testCases.length === 0) {
    return [];
  }

  // Run the first test alone so a compilation error short-circuits the rest:
  // no point batching every hidden case when the code doesn't even compile.
  const firstResult = await runSingleTestCase(finalCode, language, testCases[0]!, 0, testCases.length, limits, checker);

  if (firstResult.status.toLowerCase().includes('compilation error')) {
    console.log('[Worker] Compilation error - applying verdict to all hidden tests without extra Judge0 calls');
    return testCases.map(() => ({ ...firstResult }));
  }

  const rest = testCases.slice(1);
  if (rest.length === 0) {
    return [firstResult];
  }

  // Batch the remaining test cases into a single Judge0 batch request (chunked
  // at JUDGE0_MAX_BATCH_SIZE) instead of one HTTP submit+poll per test case —
  // ~15-20x fewer Judge0 calls and far less latency under contest load.
  try {
    const batchResults = await runWithJudge0Concurrency(() =>
      judge0Client.executeBatch(finalCode, language, rest.map((tc) => tc.input), limits)
    );
    // Exact-match base verdicts (no per-test Judge0 checker calls).
    const mappedResults = rest.map((tc, index) => toBaseRunResult(batchResults[index], tc));

    // Custom checker: run every checker-eligible case (code produced an Accepted
    // Judge0 status) in ONE batch instead of one Judge0 call per passing test.
    if (checker) {
      const eligibleIdx = rest
        .map((_, i) => i)
        .filter((i) => (batchResults[i]?.status.description ?? '').toLowerCase() === 'accepted');
      if (eligibleIdx.length > 0) {
        const verdicts = await runWithJudge0Concurrency(() =>
          runCheckerBatch(
            checker.code,
            checker.language,
            eligibleIdx.map((i) => ({
              input: rest[i]!.input,
              output: batchResults[i]?.stdout ?? '',
              expected: rest[i]!.expected,
            })),
            limits!
          )
        );
        eligibleIdx.forEach((i, k) => {
          const ok = verdicts[k] ?? false;
          mappedResults[i]!.passed = ok;
          mappedResults[i]!.status = ok ? 'Accepted' : 'Wrong Answer';
        });
      }
    }
    return [firstResult, ...mappedResults];
  } catch (err: any) {
    if (isJudge0InfrastructureError(err)) {
      console.warn('[Worker] Judge0 infrastructure error during batch run:', err.message);
      throw err;
    }

    // Non-infrastructure failure: fall back to per-test execution so a single
    // bad case can't sink the whole submission.
    console.error('[Worker] Batch run failed, falling back to per-test execution:', err?.message);
    const remainingResults = await Promise.all(
      rest.map((tc, index) =>
        runSingleTestCase(finalCode, language, tc, index + 1, testCases.length, limits, checker)
      )
    );
    return [firstResult, ...remainingResults];
  }
}

/**
 * Map a Judge0 batch result to a RunResult using exact-match comparison only.
 * The custom checker (if any) is applied separately in one batched pass by the
 * caller, so this stays synchronous and issues no Judge0 calls of its own.
 */
function toBaseRunResult(
  result: Judge0ResultResponse | undefined,
  tc: TestCaseRow
): RunResult {
  if (!result) {
    return {
      passed: false,
      status: 'Runtime Error',
      stdout: null,
      stderr: 'No Judge0 result returned for this test case',
      compileOutput: null,
      time: '0',
      memory: 0,
    };
  }

  const actualRaw = result.stdout ?? '';
  const statusDesc = result.status.description ?? '';
  const passed = compareOutput(actualRaw, tc.expected);
  const status = passed
    ? 'Accepted'
    : statusDesc.toLowerCase() === 'accepted'
      ? 'Wrong Answer'
      : statusDesc || 'Wrong Answer';

  return {
    passed,
    status,
    stdout: result.stdout,
    stderr: result.stderr,
    compileOutput: result.compile_output,
    time: result.time,
    memory: result.memory,
  };
}

async function runSingleTestCase(
  finalCode: string,
  language: SupportedLanguage,
  tc: TestCaseRow,
  index: number,
  total: number,
  limits?: Judge0ExecutionLimits,
  checker?: Checker
): Promise<RunResult> {
  console.log(`[Worker] Running test case ${index + 1}/${total}`);

  try {
    const result = await runWithJudge0Concurrency(() =>
      judge0Client.executeCode(finalCode, language, tc.input, undefined, limits)
    );

    const actualRaw = result.stdout ?? '';
    const statusDesc = result.status.description ?? '';
    const passed = checker && statusDesc.toLowerCase() === 'accepted'
      ? await runChecker(checker.code, checker.language, tc.input, actualRaw, tc.expected, limits!)
      : compareOutput(actualRaw, tc.expected);
    const status = passed
      ? 'Accepted'
      : statusDesc.toLowerCase() === 'accepted'
        ? 'Wrong Answer'
        : statusDesc || 'Wrong Answer';

    return {
      passed,
      status,
      stdout: result.stdout,
      stderr: result.stderr,
      compileOutput: result.compile_output,
      time: result.time,
      memory: result.memory,
    };
  } catch (err: any) {
    if (isJudge0InfrastructureError(err)) {
      console.warn(`[Worker] Judge0 infrastructure error on test ${index + 1}:`, err.message);
      throw err;
    }

    console.error(`[Worker] Judge0 error on test ${index + 1}:`, err?.message);
    return {
      passed: false,
      status: 'Runtime Error',
      stdout: null,
      stderr: err?.message ?? 'Unknown error',
      compileOutput: null,
      time: '0',
      memory: 0,
    };
  }
}

// ─── Verdict determination ─────────────────────────────────────────────────────

export function determineVerdict(results: RunResult[], allPassed: boolean): string {
  if (allPassed) return 'ACCEPTED';

  for (const r of results) {
    if (r.passed) continue;
    const s = (r.status || '').toLowerCase();
    if (s.includes('time limit'))                                        return 'TIME_LIMIT_EXCEEDED';
    if (s.includes('memory limit'))                                      return 'MEMORY_LIMIT_EXCEEDED';
    if (s.includes('compilation error') || s.includes('compile error')) return 'COMPILATION_ERROR';
    if (s.includes('runtime error') || (r.stderr && !r.stdout))         return 'RUNTIME_ERROR';
  }

  return 'WRONG_ANSWER';
}

// ─── Notification ──────────────────────────────────────────────────────────────

async function publishResult(
  submissionId: string,
  userId: string,
  data: {
    status: string;
    testCasesPassed: number;
    testCasesTotal:  number;
    pointsAwarded:   number;
    totalScore:      number;
    executionTime?:  number | null;
    memoryUsed?:     number | null;
    failedTest?:     FailedTestPayload;
    errorDetails?:   string;
  }
): Promise<void> {
  try {
    const notification = {
      type: 'submission_completed',
      submissionId,
      userId,
      ...data,
      timestamp: new Date().toISOString(),
    };

    // Push over WebSocket across instances: the worker may be on a different
    // Cloud Run instance than the one holding the user's socket, so publish to
    // the bus and let whichever instance has the socket deliver it.
    await publishSubmissionNotification(userId, notification);
    console.log(`[Worker] WS notification published for ${userId.slice(0, 8)}…`);

    // Always store in Redis (Upstash REST) so the polling endpoint can serve it
    // — the reliable fallback regardless of WS state.
    await redis.set(`submission:result:${submissionId}`, notification, { ex: 600 });
  } catch (err) {
    console.error('[Worker] publishResult error (non-fatal):', err);
  }
}

// ─── Worker lifecycle ──────────────────────────────────────────────────────────

export function startWorker(): void {
  submissionQueue.process(env.QUEUE_CONCURRENCY, processSubmissionJob);
  console.log(`[Worker] Submission worker started (concurrency=${env.QUEUE_CONCURRENCY})`);
}

export async function stopWorker(): Promise<void> {
  await submissionQueue.close();
  console.log('[Worker] Submission worker stopped');
}
