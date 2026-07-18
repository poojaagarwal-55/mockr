// ============================================
// Code Execution Service
// ============================================
// Handles the complete lifecycle of code execution:
//   1. Fetch test cases from the database
//   2. Submit code to Judge0 via RapidAPI
//   3. Poll for results
//   4. Compare outputs
//   5. Format structured response for the frontend
//
// Flow: Monaco Editor â POST /ide/run or /ide/submit â this service â Judge0 â results â frontend

import { ContestDSAQuestion, DSAQuestion } from "../models/DSAQuestion.js";
import { CompanyDSAQuestion } from "../models/CompanyQuestionBank.js";
import { normalizeDSAQuestion } from "../lib/question-helpers.js";
import { fetch as undiciFetch, Agent } from "undici";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { prisma } from "../lib/prisma.js";

// Custom undici agent that forces IPv4 connections.
// User's network doesn't support IPv6, and Node.js's built-in fetch
// tries IPv6 first, causing "fetch failed" errors.
const ipv4Agent = new Agent({
    connect: { family: 4 },
});

/**
 * IPv4-only fetch wrapper using undici.
 * Passes all requests through the ipv4Agent dispatcher.
 */
function fetchIPv4(url: string, options: Record<string, any> = {}): Promise<Response> {
    return undiciFetch(url, {
        ...options,
        dispatcher: ipv4Agent,
    }) as unknown as Promise<Response>;
}

// ââ Environment Configuration ââââââââââââââââââââââââââââââââââââââââââ
// IMPORTANT: These are functions, not constants, because ES module imports
// are hoisted before dotenv.config() runs in index.ts. Reading process.env
// at call time ensures the values are available.
type Judge0Runtime = "standard" | "extra";

function getJudge0Url(runtime: Judge0Runtime = "standard"): string {
    const legacyUrl = process.env.JUDGE0_API_URL || "";
    if (runtime === "extra") {
        return (
            process.env.JUDGE0_EXTRA_CE_URL ||
            (legacyUrl.includes("extra") ? legacyUrl : "") ||
            "https://judge0-extra-ce.p.rapidapi.com"
        );
    }
    return (
        process.env.JUDGE0_CE_URL ||
        (legacyUrl && !legacyUrl.includes("extra") ? legacyUrl : "") ||
        "https://judge0-ce.p.rapidapi.com"
    );
}
function getJudge0Key(): string {
    return process.env.JUDGE0_API_KEY || "";
}
function getJudge0Host(runtime: Judge0Runtime = "standard"): string {
    const legacyHost = process.env.JUDGE0_HOST || "";
    if (runtime === "extra") {
        return process.env.JUDGE0_EXTRA_CE_HOST || (legacyHost.includes("extra") ? legacyHost : "") || new URL(getJudge0Url(runtime)).hostname;
    }
    return process.env.JUDGE0_CE_HOST || (legacyHost && !legacyHost.includes("extra") ? legacyHost : "") || new URL(getJudge0Url(runtime)).hostname;
}

// ââ Language Mapping âââââââââââââââââââââââââââââââââââââââââââââââââââ
// Maps language name strings to Judge0 language IDs
const LANGUAGE_MAP: Record<string, number> = {
    javascript: 93,  // Node.js (18.15.0)
    nodejs: 93,
    python: 71,       // Python (3.8.1)
    python3: 71,
    cpp: 54,          // C++ (GCC 9.2.0)
    "c++": 54,
    java: 62,         // Java (OpenJDK 13.0.1)
    c: 50,            // C (GCC 9.2.0)
    go: 60,           // Go (1.13.5)
    rust: 73,         // Rust (1.40.0)
    ruby: 72,         // Ruby (2.7.0)
    csharp: 51,       // C# (Mono 6.6.0.161)
};

// ââ Default Constraints ââââââââââââââââââââââââââââââââââââââââââââââââ
const DEFAULT_CPU_TIME_LIMIT = 2;       // seconds
const MAX_CPU_TIME_LIMIT = 5;           // seconds (security hard cap)
const DEFAULT_MEMORY_LIMIT = 262144;    // KB (256 MB)
const DEFAULT_MAX_OUTPUT_SIZE = 1048576; // 1MB
const REMOTE_CSV_CACHE = new Map<string, string>();
export type DsaQuestionSource = "contest-bank";

// ââ RapidAPI Rate Limit Configuration ââââââââââââââââââââââââââââââââââ
// RapidAPI free tier has strict per-second rate limits.
// We submit in bounded chunks with capped parallelism to balance throughput and safety.
const MAX_RETRIES = 5;                  // Max retries on 429
const RETRY_BASE_DELAY_MS = 3000;       // Starting retry delay (3s)
function getJudge0MaxBatchSize(): number {
    return Math.max(
        1,
        Number.parseInt(process.env.JUDGE0_MAX_BATCH_SIZE || "20", 10) || 20
    );
}

function getJudge0ChunkConcurrency(): number {
    return Math.min(
        5,
        Math.max(1, Number.parseInt(process.env.JUDGE0_CHUNK_CONCURRENCY || "2", 10) || 2)
    );
}

function getJudge0InterChunkDelayMs(): number {
    return Math.max(
        0,
        Number.parseInt(process.env.JUDGE0_INTER_CHUNK_DELAY_MS || "250", 10) || 250
    );
}

function getJudge0PollInitialDelayMs(): number {
    return Math.max(
        100,
        Number.parseInt(process.env.JUDGE0_POLL_INITIAL_DELAY_MS || "700", 10) || 700
    );
}

function getJudge0PollMaxDelayMs(): number {
    const configured = Math.max(
        200,
        Number.parseInt(process.env.JUDGE0_POLL_MAX_DELAY_MS || "2500", 10) || 2500
    );
    return Math.max(configured, getJudge0PollInitialDelayMs());
}

function getJudge0PollTimeoutMs(): number {
    return Math.max(
        10000,
        Number.parseInt(process.env.JUDGE0_POLL_TIMEOUT_MS || "60000", 10) || 60000
    );
}

function getPositiveEnvNumber(names: string[], fallback: number): number {
    for (const name of names) {
        const raw = process.env[name];
        if (!raw) continue;
        const value = Number.parseFloat(raw);
        if (Number.isFinite(value) && value > 0) return value;
    }
    return fallback;
}

function getOptionalEnvNumber(names: string[]): number | undefined {
    for (const name of names) {
        const raw = process.env[name];
        if (!raw) continue;
        const value = Number.parseFloat(raw);
        if (Number.isFinite(value) && value > 0) return value;
    }
    return undefined;
}

function getOptionalEnvBoolean(names: string[]): boolean | undefined {
    for (const name of names) {
        const raw = process.env[name];
        if (!raw) continue;
        return ["1", "true", "yes", "on"].includes(raw.trim().toLowerCase());
    }
    return undefined;
}

function getDefaultCpuTimeLimit(): number {
    return clampCpuTimeLimit(getPositiveEnvNumber(
        ["JUDGE0_DSA_CPU_TIME_LIMIT_SECONDS", "JUDGE0_CPU_TIME_LIMIT_SECONDS"],
        DEFAULT_CPU_TIME_LIMIT
    ));
}

function getDefaultMemoryLimit(): number {
    return getPositiveEnvNumber(
        ["JUDGE0_DSA_MEMORY_LIMIT_KB", "JUDGE0_MEMORY_LIMIT_KB"],
        DEFAULT_MEMORY_LIMIT
    );
}

function clampCpuTimeLimit(value: number): number {
    return Math.min(MAX_CPU_TIME_LIMIT, Math.max(0.1, value));
}

function clampMemoryLimitKb(value: number): number {
    return Math.min(DEFAULT_MEMORY_LIMIT, Math.max(16 * 1024, Math.round(value)));
}

function getJudge0MaxOutputSize(): number {
    return Math.max(
        131072,
        Number.parseInt(process.env.JUDGE0_MAX_OUTPUT_SIZE || String(DEFAULT_MAX_OUTPUT_SIZE), 10) || DEFAULT_MAX_OUTPUT_SIZE
    );
}

function isJudge0SourceDebugEnabled(): boolean {
    return ["1", "true", "yes", "on"].includes(
        (process.env.JUDGE0_DEBUG_SOURCE || process.env.DEBUG_JUDGE0_SOURCE || "").trim().toLowerCase()
    );
}

if (isJudge0SourceDebugEnabled()) {
    console.warn("[CodeExec][Judge0SourceDebug] enabled");
}

function withLineNumbers(source: string): string {
    return source
        .replace(/\r\n/g, "\n")
        .split("\n")
        .map((line, index) => `${String(index + 1).padStart(4, " ")} | ${line}`)
        .join("\n");
}

function logJudge0SourceDebug(params: {
    questionId: string;
    language: string;
    mode: string;
    phase: "prepared" | "compile_error";
    sourceCode: string;
    wrapperCode: string | null;
    finalCode: string;
    compileOutput?: string | null;
    stderr?: string | null;
}): void {
    if (!isJudge0SourceDebugEnabled()) return;

    console.log(
        [
            `[CodeExec][Judge0SourceDebug] phase=${params.phase} question=${params.questionId} lang=${params.language} mode=${params.mode}`,
            params.compileOutput ? `--- compile_output ---\n${params.compileOutput}` : null,
            params.stderr ? `--- stderr ---\n${params.stderr}` : null,
            `--- user source (${params.sourceCode.length} chars) ---\n${withLineNumbers(params.sourceCode)}`,
            params.wrapperCode
                ? `--- wrapper source (${params.wrapperCode.length} chars) ---\n${withLineNumbers(params.wrapperCode)}`
                : "--- wrapper source ---\n(no wrapper)",
            `--- final Judge0 source (${params.finalCode.length} chars) ---\n${withLineNumbers(params.finalCode)}`,
            "--- end Judge0 source debug ---",
        ].filter(Boolean).join("\n")
    );
}

function getJudge0LimitFields(cpuTimeLimit: number, memoryLimit: number): Pick<
    Judge0Submission,
    | "cpu_time_limit"
    | "cpu_extra_time"
    | "wall_time_limit"
    | "memory_limit"
    | "enable_network"
    | "enable_per_process_and_thread_time_limit"
    | "enable_per_process_and_thread_memory_limit"
> {
    const effectiveCpuTimeLimit = clampCpuTimeLimit(cpuTimeLimit);
    const cpuExtraTime = getOptionalEnvNumber([
        "JUDGE0_DSA_CPU_EXTRA_TIME_SECONDS",
        "JUDGE0_CPU_EXTRA_TIME_SECONDS",
    ]);
    const wallTimeLimit = getOptionalEnvNumber([
        "JUDGE0_DSA_WALL_TIME_LIMIT_SECONDS",
        "JUDGE0_WALL_TIME_LIMIT_SECONDS",
    ]) ?? Math.max(effectiveCpuTimeLimit + 2, effectiveCpuTimeLimit * 2);
    const timePerProcess = getOptionalEnvBoolean([
        "JUDGE0_DSA_ENABLE_PER_PROCESS_AND_THREAD_TIME_LIMIT",
        "JUDGE0_ENABLE_PER_PROCESS_AND_THREAD_TIME_LIMIT",
    ]);
    const memoryPerProcess = getOptionalEnvBoolean([
        "JUDGE0_DSA_ENABLE_PER_PROCESS_AND_THREAD_MEMORY_LIMIT",
        "JUDGE0_ENABLE_PER_PROCESS_AND_THREAD_MEMORY_LIMIT",
    ]);

    return {
        cpu_time_limit: effectiveCpuTimeLimit,
        ...(cpuExtraTime !== undefined ? { cpu_extra_time: cpuExtraTime } : {}),
        wall_time_limit: wallTimeLimit,
        memory_limit: clampMemoryLimitKb(memoryLimit),
        enable_network: false,
        ...(timePerProcess !== undefined ? { enable_per_process_and_thread_time_limit: timePerProcess } : {}),
        ...(memoryPerProcess !== undefined ? { enable_per_process_and_thread_memory_limit: memoryPerProcess } : {}),
    };
}

// ââ Types ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ

interface TestCase {
    id: string;
    input: string;
    expected: string;
    type: string;      // "sample" | "hidden" | "edge"
    orderIdx: number;
}

interface Judge0Submission {
    source_code: string;       // base64 encoded
    language_id: number;
    stdin: string | null;      // base64 encoded
    expected_output: string | null; // base64 encoded
    cpu_time_limit: number;
    cpu_extra_time?: number;
    wall_time_limit?: number;
    memory_limit: number;
    max_output_size: number;
    enable_network?: boolean;
    enable_per_process_and_thread_time_limit?: boolean;
    enable_per_process_and_thread_memory_limit?: boolean;
}

interface Judge0Result {
    token: string;
    stdout: string | null;     // base64 encoded
    stderr: string | null;     // base64 encoded
    compile_output: string | null; // base64 encoded
    status: {
        id: number;
        description: string;
    };
    time: string | null;       // seconds as string
    memory: number | null;     // KB
}

interface TestResult {
    input: string;
    expectedOutput: string;
    actualOutput: string;
    passed: boolean;
    verdictColor: "green" | "red";
    status: string;
    time: string;
    memory: string;
    stderr?: string;
    compileOutput?: string;
}

interface HiddenTestResult {
    passed: boolean;
    status: string;
    time: string;
    memory: string;
}

interface HiddenFirstFailedResult {
    input: string;
    expectedOutput: string;
    actualOutput: string;
    status: string;
    time: string;
    memory: string;
    stderr?: string;
    compileOutput?: string;
}

export interface RunCodeResult {
    success: boolean;
    error?: string;
    compileOutput?: string;
    stderr?: string;
    sample?: {
        tests: TestResult[];
        summary: {
            total: number;
            passed: number;
        };
    };
    hidden?: {
        summary: {
            total: number;
            passed: number;
        };
        firstFailed?: HiddenFirstFailedResult;
    };
}

function hasContestEnded(contest: { status: string; endTime: Date } | null): boolean {
    if (!contest) return false;
    return contest.status === "ENDED" || contest.endTime <= new Date();
}

async function findQuestionInModel(model: typeof DSAQuestion, questionId: string) {
    let doc = null;
    try {
        doc = await model.findById(questionId);
    } catch {
        // questionId was not a valid ObjectId.
    }

    if (!doc) {
        doc = await model.findOne({
            $or: [
                { problemId: questionId },
                { problemSlug: questionId },
                { frontendId: questionId },
            ],
        });
    }

    return doc;
}

async function findPracticeDsaQuestion(
    questionId: string,
    contestId?: string,
    questionSource?: DsaQuestionSource
) {
    if (questionSource === "contest-bank") {
        return findQuestionInModel(ContestDSAQuestion, questionId);
    }

    const primaryDoc = await findQuestionInModel(DSAQuestion, questionId);
    if (primaryDoc) return primaryDoc;
    if (!contestId) return null;

    const [contest, contestQuestion] = await Promise.all([
        prisma.contest.findUnique({
            where: { id: contestId },
            select: { status: true, endTime: true },
        }),
        prisma.contestQuestion.findUnique({
            where: {
                contestId_questionId: {
                    contestId,
                    questionId,
                },
            },
            select: { questionId: true },
        }),
    ]);

    if (!contestQuestion || !hasContestEnded(contest)) {
        return null;
    }

    return findQuestionInModel(ContestDSAQuestion, contestQuestion.questionId);
}

// ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
// 1. FETCH TEST CASES FROM DATABASE (MongoDB)
// ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ

/**
 * Fetches test cases for a given question from MongoDB, separated into
 * sample and hidden. Uses the DSAQuestion Mongoose model which stores
 * sampleTestCases and hiddenTestCases as embedded arrays.
 */
async function fetchTestCases(
    questionId: string,
    contestId?: string,
    questionSource?: DsaQuestionSource
): Promise<{
    sampleTests: TestCase[];
    hiddenTests: TestCase[];
    constraints: string | null;
    problemSlug: string | null;
    timeLimit: number | null;
    memoryLimit: number | null;
    judgeType: "default" | "custom";
    checkerLanguage: string | null;
    checkerCode: string | null;
}> {
    const doc = await findPracticeDsaQuestion(questionId, contestId, questionSource);

    if (!doc) {
        throw new Error(`Question not found: ${questionId}`);
    }

    const normalized = normalizeDSAQuestion(doc);

    const sampleTests: TestCase[] = normalized.testCases
        .filter((tc) => tc.type === "sample")
        .map((tc) => ({
            id: tc.id,
            input: tc.input,
            expected: tc.expected,
            type: tc.type,
            orderIdx: tc.orderIdx,
        }));

    const hiddenTests: TestCase[] = normalized.testCases
        .filter((tc) => tc.type !== "sample")
        .map((tc) => ({
            id: tc.id,
            input: tc.input,
            expected: tc.expected,
            type: tc.type,
            orderIdx: tc.orderIdx,
        }));

    return {
        sampleTests,
        hiddenTests,
        constraints: normalized.constraints,
        problemSlug: normalized.problemSlug || null,
        timeLimit: Number(normalized.timeLimit || 0) || null,
        memoryLimit: Number(normalized.memoryLimit || 0) || null,
        judgeType: (normalized as any).judgeType === "custom" ? "custom" : "default",
        checkerLanguage: (normalized as any).checkerLanguage || null,
        checkerCode: (normalized as any).checkerCode || null,
    };
}

// ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
// 2. PARSE CONSTRAINTS
// ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ

/**
 * Parses the free-text `constraints` field from the database to extract
 * time and memory limits for Judge0. Falls back to defaults if not found.
 *
 * The constraints field in the DB stores human-readable text like:
 * "2 <= nums.length <= 10^4\n-10^9 <= nums[i] <= 10^9"
 * These don't contain explicit time/memory limits, so we use defaults.
 */
function parseConstraints(constraintsStr: string | null): {
    cpuTimeLimit: number;
    memoryLimit: number;
} {
    let cpuTimeLimit = getDefaultCpuTimeLimit();
    let memoryLimit = getDefaultMemoryLimit();

    if (constraintsStr) {
        // Try to extract time limit if explicitly mentioned (e.g., "Time Limit: 750ms" or "Time Limit: 1.5s")
        const timeMatch = constraintsStr.match(/time\s*limit\s*[:=]\s*(\d+(?:\.\d+)?)\s*(ms|s)/i);
        if (timeMatch && timeMatch[1] && timeMatch[2]) {
            const value = parseFloat(timeMatch[1]);
            cpuTimeLimit = clampCpuTimeLimit(timeMatch[2].toLowerCase() === "ms" ? value / 1000 : value);
        }

        // Try to extract memory limit if explicitly mentioned (e.g., "Memory Limit: 256MB")
        const memMatch = constraintsStr.match(/memory\s*limit\s*[:=]\s*(\d+)\s*(MB|KB)/i);
        if (memMatch && memMatch[1] && memMatch[2]) {
            const value = parseInt(memMatch[1], 10);
            memoryLimit = memMatch[2].toUpperCase() === "MB" ? value * 1024 : value;
        }
    }

    return { cpuTimeLimit: clampCpuTimeLimit(cpuTimeLimit), memoryLimit: clampMemoryLimitKb(memoryLimit) };
}

// ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
// 3. JUDGE0 INTEGRATION â BATCH SUBMISSION + POLLING
// ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ

/**
 * Helper: Base64 encode a string for Judge0
 */
function toBase64(str: string | null | undefined): string | null {
    if (!str && str !== "") return null;
    return Buffer.from(str).toString("base64");
}

/**
 * Helper: Base64 decode a string from Judge0
 */
function fromBase64(str: string | null | undefined): string {
    if (!str) return "";
    try {
        return Buffer.from(str, "base64").toString("utf-8");
    } catch {
        return str; // Return as-is if not valid base64
    }
}

/**
 * Builds the headers for Judge0 RapidAPI requests.
 * Never logs the API key for security.
 */
function getJudge0Headers(runtime: Judge0Runtime = "standard"): Record<string, string> {
    const headers: Record<string, string> = {
        "Content-Type": "application/json",
    };

    const key = getJudge0Key();
    if (key) {
        headers["x-rapidapi-key"] = key;
        headers["x-rapidapi-host"] = getJudge0Host(runtime);
    }

    return headers;
}

/**
 * Helper: sleep for N milliseconds
 */
function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Extracts the retry delay from a 429 response.
 * Checks the Retry-After header (RapidAPI sends this).
 * Falls back to exponential backoff based on attempt number.
 */
function getRetryDelay(response: Response, attempt: number): number {
    const retryAfter = response.headers.get("Retry-After");
    if (retryAfter) {
        const seconds = parseInt(retryAfter, 10);
        if (!isNaN(seconds)) {
            return seconds * 1000 + 500; // Add 500ms buffer
        }
    }
    // Exponential backoff: 3s, 6s, 9s, 12s, 15s
    return RETRY_BASE_DELAY_MS * (attempt + 1);
}

/**
 * Submits all test cases as a BATCH to Judge0 via RapidAPI.
 * Uses: POST /submissions/batch?base64_encoded=true
 *
 * This is the ONLY submission endpoint that works with the RapidAPI
 * subscription â individual /submissions returns 401.
 *
 * Retries on 429 with exponential backoff.
 * Returns array of tokens in the same order as submissions.
 */
async function submitToJudge0(
    submissions: Judge0Submission[],
    runtime: Judge0Runtime = "standard"
): Promise<string[]> {
    const headers = getJudge0Headers(runtime);
    const payloadSubmissions = submissions.map((submission) => {
        const clean: Record<string, unknown> = { ...submission };
        delete clean.enable_network;
        return clean;
    });

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        console.log(`[CodeExec] Submitting batch of ${submissions.length} test case(s)... (attempt ${attempt + 1})`);

        const response = await fetchIPv4(
            `${getJudge0Url(runtime)}/submissions/batch?base64_encoded=true`,
            {
                method: "POST",
                headers,
                body: JSON.stringify({ submissions: payloadSubmissions }),
            }
        );

        if (response.ok) {
            const data = (await response.json()) as { token: string }[];
            const tokens = data.map((item) => item.token);
            console.log(`[CodeExec] Batch submitted successfully, got ${tokens.length} token(s)`);
            return tokens;
        }

        // Handle transient submission failures with backoff retries.
        // RapidAPI Judge0 can intermittently return 400/5xx for valid payloads.
        const retryableStatus = response.status === 429 || response.status === 400 || response.status >= 500;
        if (retryableStatus && attempt < MAX_RETRIES) {
            const retryDelay = getRetryDelay(response, attempt);
            console.warn(
                `[CodeExec] submit retry status=${response.status} (attempt ${attempt + 1}/${MAX_RETRIES}), waiting ${retryDelay}ms...`
            );
            await sleep(retryDelay);
            continue;
        }

        // Any other error â throw with details
        const errText = await response.text();
        console.error(`[CodeExec] Batch submission failed: ${response.status} â ${errText}`);
        throw new Error(`Code execution failed (${response.status}): ${errText.slice(0, 300)}`);
    }

    throw new Error("Code execution failed after multiple retries. Please wait a moment and try again.");
}

/**
 * Polls Judge0 for results using the BATCH polling endpoint.
 * Uses: GET /submissions/batch?tokens=...&base64_encoded=true&fields=*
 *
 * This matches the exact RapidAPI endpoint format.
 * Retries on 429 with backoff.
 * Times out after POLL_TIMEOUT_MS (60s).
 */
async function pollResults(tokens: string[], runtime: Judge0Runtime = "standard"): Promise<Judge0Result[]> {
    const headers = getJudge0Headers(runtime);

    const tokenStr = tokens.join(",");
    const startTime = Date.now();
    let delay = getJudge0PollInitialDelayMs();
    const maxDelay = getJudge0PollMaxDelayMs();
    const timeoutMs = getJudge0PollTimeoutMs();

    while (Date.now() - startTime < timeoutMs) {
        await sleep(delay);

        let response: Response;
        try {
            response = await fetchIPv4(
                `${getJudge0Url(runtime)}/submissions/batch?tokens=${tokenStr}&base64_encoded=true&fields=*`,
                { method: "GET", headers }
            );
        } catch (err) {
            console.warn("[CodeExec] Poll network error:", err);
            delay = Math.min(Math.ceil(delay * 1.35), maxDelay);
            continue;
        }

        // Handle 429 on polling
        if (response.status === 429) {
            const retryDelay = getRetryDelay(response, Math.floor((Date.now() - startTime) / RETRY_BASE_DELAY_MS));
            console.warn(`[CodeExec] Poll 429, waiting ${retryDelay}ms...`);
            await sleep(retryDelay);
            delay = Math.min(Math.ceil(delay * 1.15), maxDelay);
            continue;
        }

        if (!response.ok) {
            console.warn(`[CodeExec] Poll returned ${response.status}`);
            delay = Math.min(Math.ceil(delay * 1.35), maxDelay);
            continue;
        }

        const data = (await response.json()) as { submissions: Judge0Result[] };
        const results: Judge0Result[] = data.submissions;

        // Check if all submissions have finished
        // Status IDs 1 (In Queue) and 2 (Processing) mean still running
        const allDone = results.every(
            (r) => r.status && r.status.id !== 1 && r.status.id !== 2
        );

        if (allDone) {
            console.log(`[CodeExec] All ${results.length} result(s) ready`);
            return results;
        }

        console.log(`[CodeExec] ${results.filter(r => r.status?.id === 1 || r.status?.id === 2).length} still processing...`);
        delay = Math.min(Math.ceil(delay * 1.2), maxDelay);
    }

    // Timeout â return whatever we have
    console.warn(`[CodeExec] Polling timed out after ${timeoutMs}ms`);
    throw new Error("Code execution timed out. Judge0 did not return results in time. Please try again.");
}

function splitJudge0ResultsBySampleCount(
    combinedResults: Judge0Result[],
    sampleCount: number
): { sampleJudge0Results: Judge0Result[]; hiddenJudge0Results: Judge0Result[] } {
    const safeSampleCount = Math.max(0, Math.min(sampleCount, combinedResults.length));
    return {
        sampleJudge0Results: combinedResults.slice(0, safeSampleCount),
        hiddenJudge0Results: combinedResults.slice(safeSampleCount),
    };
}

/**
 * Judge0 RapidAPI enforces a max submissions-per-batch limit (typically 20).
 * Execute submissions in bounded chunks with safe parallelism and stable ordering.
 */
async function executeSubmissionsInChunks(
    submissions: Judge0Submission[],
    runtime: Judge0Runtime = "standard"
): Promise<Judge0Result[]> {
    if (submissions.length === 0) return [];

    const maxBatchSize = getJudge0MaxBatchSize();
    const configuredConcurrency = getJudge0ChunkConcurrency();
    const interChunkDelayMs = getJudge0InterChunkDelayMs();

    const chunks: Judge0Submission[][] = [];
    for (let i = 0; i < submissions.length; i += maxBatchSize) {
        chunks.push(submissions.slice(i, i + maxBatchSize));
    }

    const workerCount = Math.min(configuredConcurrency, chunks.length);
    const chunkResults: Judge0Result[][] = new Array(chunks.length);
    let nextChunkIndex = 0;

    console.log(
        `[CodeExec] Executing ${chunks.length} chunk(s) with concurrency=${workerCount} ` +
        `(max batch size=${maxBatchSize})`
    );

    const runWorker = async (workerId: number): Promise<void> => {
        while (true) {
            const chunkIndex = nextChunkIndex;
            nextChunkIndex += 1;

            if (chunkIndex >= chunks.length) {
                return;
            }

            const chunk = chunks[chunkIndex]!;
            console.log(
                `[CodeExec] Worker ${workerId} executing chunk ${chunkIndex + 1}/${chunks.length} ` +
                `(${chunk.length} submission(s))`
            );

            const tokens = await submitToJudge0(chunk, runtime);
            const results = await pollResults(tokens, runtime);
            chunkResults[chunkIndex] = results;

            // Brief spacing before this worker grabs another chunk to reduce burstiness.
            if (interChunkDelayMs > 0 && nextChunkIndex < chunks.length) {
                await sleep(interChunkDelayMs);
            }
        }
    };

    await Promise.all(
        Array.from({ length: workerCount }, (_, idx) => runWorker(idx + 1))
    );

    return chunkResults.flat();
}

// ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
// 4. OUTPUT NORMALIZATION & COMPARISON
// ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ

/**
 * Normalizes output for comparison:
 * - Convert CRLF to LF
 * - Trim leading/trailing whitespace on each line
 * - Remove trailing empty lines
 * - Trim overall leading/trailing whitespace
 */
function normalizeOutput(output: string): string {
    return output
        .replace(/\r\n/g, "\n")      // CRLF â LF
        .split("\n")                   // Split into lines
        .map((line) => line.trim())    // Trim each line
        .join("\n")                    // Rejoin
        .replace(/\n+$/, "")          // Remove trailing newlines
        .trim();                       // Final trim
}

function tryParsePythonLikeLiteral(input: string): unknown {
    const transformed = input
        .replace(/\bTrue\b/g, "true")
        .replace(/\bFalse\b/g, "false")
        .replace(/\bNone\b/g, "null")
        .replace(/'([^'\\]*(?:\\.[^'\\]*)*)'/g, (_, content: string) => {
            const escaped = content.replace(/\\"/g, '"').replace(/"/g, '\\"');
            return `"${escaped}"`;
        });

    return JSON.parse(transformed);
}

/**
 * Tries to parse a normalized output as JSON/primitive so semantically
 * equivalent outputs (e.g. [0,1] vs [0, 1]) compare as equal.
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
            // Ignore Python-literal parse failures and continue with primitive checks.
        }

        // Not JSON â allow common unquoted primitives for robust comparison
        if (/^-?\d+(?:\.\d+)?$/.test(normalized)) {
            return JSON.stringify(Number(normalized));
        }
        if (/^(true|false)$/i.test(normalized)) {
            return JSON.stringify(normalized.toLowerCase() === "true");
        }
        if (normalized === "null" || normalized === "None") {
            return JSON.stringify(null);
        }
        return normalized;
    }
}

function tryParseStructuredOutput(output: string): unknown {
    const normalized = normalizeOutput(output);
    if (!normalized) return normalized;

    try {
        return JSON.parse(normalized);
    } catch {
        return tryParsePythonLikeLiteral(normalized);
    }
}

function isMatrixOfStrings(value: unknown): value is string[][] {
    return Array.isArray(value)
        && value.every((row) => Array.isArray(row) && row.every((cell) => typeof cell === "string"));
}

function canonicalizeUnorderedStringGroups(groups: string[][]): string {
    const normalizedGroups = groups
        .map((group) => [...group].sort())
        .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));

    return JSON.stringify(normalizedGroups);
}

interface ComparisonContext {
    problemSlug?: string | null;
}

/**
 * Compares actual program output with expected output after normalization.
 * Returns whether the test passed and the verdict color.
 */
function compareOutput(
    actual: string,
    expected: string,
    context?: ComparisonContext
): { passed: boolean; verdictColor: "green" | "red" } {
    if (context?.problemSlug === "group-anagrams") {
        try {
            const actualParsed = tryParseStructuredOutput(actual);
            const expectedParsed = tryParseStructuredOutput(expected);
            if (isMatrixOfStrings(actualParsed) && isMatrixOfStrings(expectedParsed)) {
                const passed =
                    canonicalizeUnorderedStringGroups(actualParsed) ===
                    canonicalizeUnorderedStringGroups(expectedParsed);
                return {
                    passed,
                    verdictColor: passed ? "green" : "red",
                };
            }
        } catch {
            // Fall back to default comparison behavior.
        }
    }

    const normalizedActual = canonicalizeComparableOutput(actual);
    const normalizedExpected = canonicalizeComparableOutput(expected);

    const passed = normalizedActual === normalizedExpected;
    return {
        passed,
        verdictColor: passed ? "green" : "red",
    };
}

// ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
// 5. RESULT FORMATTING â Map Judge0 status to human-readable verdict
// ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ

/**
 * Maps Judge0 status ID to a human-friendly status string.
 */
function getStatusDescription(statusId: number, statusDesc: string): string {
    switch (statusId) {
        case 3: return "Accepted";
        case 4: return "Wrong Answer";
        case 5: return "Time Limit Exceeded";
        case 6: return "Compilation Error";
        case 7: return "Runtime Error (SIGSEGV)";
        case 8: return "Runtime Error (SIGXFSZ)";
        case 9: return "Runtime Error (SIGFPE)";
        case 10: return "Runtime Error (SIGABRT)";
        case 11: return "Runtime Error (NZEC)";
        case 12: return "Runtime Error (Other)";
        case 13: return "Internal Error";
        case 14: return "Exec Format Error";
        default: return statusDesc || "Unknown";
    }
}

/**
 * Processes a single Judge0 result against its corresponding test case.
 * Decodes base64 output, compares with expected, builds TestResult.
 */
function processTestResult(
    result: Judge0Result,
    testCase: TestCase,
    context?: ComparisonContext
): TestResult {
    const actualOutput = fromBase64(result.stdout);
    const stderr = fromBase64(result.stderr);
    const compileOutput = fromBase64(result.compile_output);
    const statusId = result.status?.id || 0;
    const statusDesc = result.status?.description || "Unknown";

    // For non-accepted statuses, the test has failed regardless of output
    let passed = false;
    let verdictColor: "green" | "red" = "red";
    let status = getStatusDescription(statusId, statusDesc);

    if (statusId === 3 || statusId === 4) {
        // Judge0 may report Wrong Answer due strict formatting differences.
        // We always run our own normalized comparison.
        const comparison = compareOutput(actualOutput, testCase.expected, context);
        passed = comparison.passed;
        verdictColor = comparison.verdictColor;
        status = passed ? "Accepted" : "Wrong Answer";
    }

    return {
        input: testCase.input,
        expectedOutput: testCase.expected,
        actualOutput: actualOutput || compileOutput || stderr || "",
        passed,
        verdictColor,
        status,
        time: result.time ? `${result.time}s` : "N/A",
        memory: result.memory ? `${result.memory}KB` : "N/A",
        ...(stderr ? { stderr } : {}),
        ...(compileOutput ? { compileOutput } : {}),
    };
}

/**
 * Processes a hidden test result â same logic but doesn't expose input/expected.
 */
function processHiddenTestResult(
    result: Judge0Result,
    testCase: TestCase,
    context?: ComparisonContext
): HiddenTestResult {
    const actualOutput = fromBase64(result.stdout);
    const statusId = result.status?.id || 0;
    const statusDesc = result.status?.description || "Unknown";

    let passed = false;
    let status = getStatusDescription(statusId, statusDesc);

    if (statusId === 3 || statusId === 4) {
        const comparison = compareOutput(actualOutput, testCase.expected, context);
        passed = comparison.passed;
        status = passed ? "Accepted" : "Wrong Answer";
    }

    return {
        passed,
        status,
        time: result.time ? `${result.time}s` : "N/A",
        memory: result.memory ? `${result.memory}KB` : "N/A",
    };
}

/**
 * Builds an expanded hidden-test failure payload for the first failing hidden case.
 */
function buildHiddenFailureDetail(
    result: Judge0Result,
    testCase: TestCase,
    context?: ComparisonContext
): HiddenFirstFailedResult {
    const actualOutput = fromBase64(result.stdout);
    const stderr = fromBase64(result.stderr);
    const compileOutput = fromBase64(result.compile_output);
    const statusId = result.status?.id || 0;
    const statusDesc = result.status?.description || "Unknown";

    let passed = false;
    let status = getStatusDescription(statusId, statusDesc);

    if (statusId === 3 || statusId === 4) {
        const comparison = compareOutput(actualOutput, testCase.expected, context);
        passed = comparison.passed;
        status = passed ? "Accepted" : "Wrong Answer";
    }

    return {
        input: testCase.input,
        expectedOutput: testCase.expected,
        actualOutput: actualOutput || compileOutput || stderr || "",
        status,
        time: result.time ? `${result.time}s` : "N/A",
        memory: result.memory ? `${result.memory}KB` : "N/A",
        ...(stderr ? { stderr } : {}),
        ...(compileOutput ? { compileOutput } : {}),
    };
}

// ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
// 6. CODE COMBINATION â Language-aware merging of user code + wrapper
// ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ

function splitParams(params: string): string[] {
    const trimmed = params.trim();
    if (!trimmed) return [];
    return trimmed
        .split(",")
        .map((param) => param.trim())
        .filter(Boolean);
}

function extractSimpleArgName(param: string, fallback: string): string {
    const withoutDefault = param.replace(/=[\s\S]*$/, "").trim();
    const match = withoutDefault.match(/([A-Za-z_$][\w$]*)\s*$/);
    return match?.[1] || fallback;
}

function buildPythonClassSolutionAdapters(userCode: string): string {
    if (!/\bclass\s+Solution\b/.test(userCode)) return "";

    const lines = userCode.split("\n");
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

        const name = methodMatch[1] || "";
        if (!name || name.startsWith("__")) continue;

        const rawParams = splitParams(methodMatch[2] || "");
        const callableParams = rawParams[0] === "self" || rawParams[0] === "cls"
            ? rawParams.slice(1)
            : rawParams;
        methods.push({ name, params: callableParams.join(", ") });
    }

    const adapters: string[] = [];
    const seen = new Set<string>();

    for (const method of methods) {
        if (seen.has(method.name)) continue;
        seen.add(method.name);

        const topLevelFunction = new RegExp(`^def\\s+${method.name}\\s*\\(`, "m").test(userCode);
        if (topLevelFunction) continue;

        const args = splitParams(method.params)
            .map((param, index) => extractSimpleArgName(param, `arg${index}`))
            .join(", ");

        adapters.push(`def ${method.name}(${method.params}):`);
        adapters.push(`    return Solution().${method.name}(${args})`);
        adapters.push("");
    }

    return adapters.join("\n");
}

function buildJavaScriptClassSolutionAdapters(userCode: string): string {
    if (!/\bclass\s+Solution\b/.test(userCode)) return "";

    const reserved = new Set(["constructor", "if", "for", "while", "switch", "catch", "function"]);
    const methods: Array<{ name: string; params: string; isStatic: boolean; isAsync: boolean }> = [];
    const methodPattern = /^\s*(static\s+)?(async\s+)?([A-Za-z_$][\w$]*)\s*\(([^)]*)\)\s*\{/gm;
    let match: RegExpExecArray | null;

    while ((match = methodPattern.exec(userCode)) !== null) {
        const name = match[3] || "";
        if (!name || reserved.has(name)) continue;
        methods.push({
            name,
            params: (match[4] || "").trim(),
            isStatic: Boolean(match[1]),
            isAsync: Boolean(match[2]),
        });
    }

    const adapters: string[] = [];
    const seen = new Set<string>();

    for (const method of methods) {
        if (seen.has(method.name)) continue;
        seen.add(method.name);

        const topLevelFunction = new RegExp(`^\\s*(?:async\\s+)?function\\s+${method.name}\\s*\\(`, "m").test(userCode);
        if (topLevelFunction) continue;

        const args = splitParams(method.params)
            .map((param, index) => extractSimpleArgName(param, `arg${index}`))
            .join(", ");
        const asyncPrefix = method.isAsync ? "async " : "";
        const receiver = method.isStatic ? "Solution" : "new Solution()";
        const awaitPrefix = method.isAsync ? "await " : "";

        adapters.push(`${asyncPrefix}function ${method.name}(${method.params}) {`);
        adapters.push(`  return ${awaitPrefix}${receiver}.${method.name}(${args});`);
        adapters.push("}");
        adapters.push("");
    }

    return adapters.join("\n");
}

function stripUserCodePlaceholder(wrapperCode: string): string {
    return wrapperCode
        .replace(/^[ \t]*<USER_CODE>[ \t]*;?[ \t]*(?:\r?\n)?/gm, "")
        .replace(/<USER_CODE>/g, "");
}

function extractJavaSolutionMethodNames(userCode: string): string[] {
    if (!/\bclass\s+Solution\b/.test(userCode)) return [];

    const names = new Set<string>();
    const reserved = new Set(["if", "for", "while", "switch", "catch", "main", "Solution"]);
    const methodPattern = /\b(?:public|private|protected)?\s*(?:static\s+)?(?:final\s+)?[\w<>\[\], ?&]+\s+([A-Za-z_]\w*)\s*\([^)]*\)\s*(?:throws\s+[^{]+)?\{/g;
    let match: RegExpExecArray | null;

    while ((match = methodPattern.exec(userCode)) !== null) {
        const name = match[1] || "";
        if (name && !reserved.has(name)) {
            names.add(name);
        }
    }

    return Array.from(names);
}

function rewriteJavaDirectSolutionCalls(wrapperCode: string, userCode: string): string {
    let rewritten = wrapperCode;

    for (const name of extractJavaSolutionMethodNames(userCode)) {
        const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        rewritten = rewritten.replace(
            new RegExp(`(^|[^A-Za-z0-9_\\.])${escapedName}\\s*\\(`, "g"),
            `$1new Solution().${name}(`
        );
    }

    return rewritten;
}

/**
 * Combines user code with wrapper code in a language-aware manner.
 *
 * The key challenge: Java requires `import` statements at the very top of the file,
 * and C++ requires `#include` directives at the top. If the wrapper code contains
 * these, we must extract them and place them before the user's code.
 *
 * Final output order:
 *   1. Import/include statements (extracted from wrapper)
 *   2. User's code (e.g., class Solution { ... })
 *   3. Remaining wrapper code (e.g., public class Main { ... })
 */
function combineCodeWithWrapper(
    userCode: string,
    wrapperCode: string,
    language: string
): string {
    const lang = (language || "").toLowerCase();
    const wrapperHasUserCodePlaceholder = wrapperCode.includes("<USER_CODE>");
    const userUsesClassSolution = /\bclass\s+Solution\b/.test(userCode);

    const usesSupportedExplicitPlaceholder = wrapperHasUserCodePlaceholder && [
        "cpp",
        "c++",
        "java",
        "python",
        "python3",
        "javascript",
        "js",
        "nodejs",
    ].includes(lang);

    if (usesSupportedExplicitPlaceholder) {
        return wrapperCode.replace(/<USER_CODE>/g, userCode);
    }

    const effectiveWrapperCode = wrapperHasUserCodePlaceholder && userUsesClassSolution
        ? stripUserCodePlaceholder(wrapperCode)
        : wrapperCode;

    if (wrapperHasUserCodePlaceholder && !userUsesClassSolution) {
        return wrapperCode.replace(/<USER_CODE>/g, userCode);
    }

    if (lang === "golang" || lang === "go") {
        // Go requires package/import declarations at the top of the file.
        return wrapperCode + "\n" + userCode;
    }

    if (lang === "csharp" || lang === "c#" || lang === "cs") {
        // For C#: `using` directives must be at top-level before class declarations.
        const wrapperLines = effectiveWrapperCode.split("\n");
        const usingLines: string[] = [];
        const restLines: string[] = [];

        for (const line of wrapperLines) {
            const trimmed = line.trim();
            if (trimmed.startsWith("using ")) {
                usingLines.push(line);
            } else {
                restLines.push(line);
            }
        }

        const parts: string[] = [];
        if (usingLines.length > 0) parts.push(usingLines.join("\n"));
        parts.push(userCode);
        if (restLines.join("\n").trim()) parts.push(restLines.join("\n"));
        return parts.join("\n");
    }

    if (lang === "java") {
        // For Java: extract `import` and `package` lines from wrapper,
        // place them at the top, then user code, then the rest of wrapper
        const wrapperLines = wrapperCode.split("\n");
        const importLines: string[] = [];
        const restLines: string[] = [];
        let insideClassDefinition = false;
        let braceCount = 0;

        for (const line of wrapperLines) {
            const trimmed = line.trim();
            
            // Extract imports and package declarations
            if (trimmed.startsWith("import ") || trimmed.startsWith("package ")) {
                importLines.push(line);
                continue;
            }
            
            // Skip any class definition in wrapper (user provides this)
            // Match patterns like: class ClassName, public class ClassName, etc.
            if (trimmed.match(/^(public\s+)?class\s+\w+/) && !trimmed.includes("class Main")) {
                insideClassDefinition = true;
                braceCount = 0;
                continue;
            }
            
            if (insideClassDefinition) {
                // Count braces to know when class definition ends
                for (const char of line) {
                    if (char === '{') braceCount++;
                    if (char === '}') braceCount--;
                }
                
                // Class definition ended
                if (braceCount < 0) {
                    insideClassDefinition = false;
                }
                continue;
            }
            
            restLines.push(line);
        }

        const parts: string[] = [];
        if (importLines.length > 0) parts.push(importLines.join("\n"));
        parts.push(userCode);
        if (restLines.join("\n").trim()) parts.push(restLines.join("\n"));
        return parts.join("\n");
    }

    if (lang === "cpp" || lang === "c++") {
        // For C++: keep include/using lines and helper type declarations (e.g. ListNode)
        // before user code, remove wrapper Solution class if present, then keep runner/main.
        // If wrapper expects global function calls but user submits class Solution methods,
        // generate small adapter functions.
        const wrapperLines = effectiveWrapperCode.split("\n");
        const headerLines: string[] = [];
        const preUserLines: string[] = [];
        const postUserLines: string[] = [];
        const hasBitsHeader = /#include\s*<bits\/stdc\+\+\.h>/.test(effectiveWrapperCode);
        let sawUsingNamespaceStd = /\busing\s+namespace\s+std\s*;/.test(effectiveWrapperCode);
        const userUsesStdQualified = /\bstd::/.test(userCode);

        const countBraces = (line: string): number => {
            const open = (line.match(/\{/g) || []).length;
            const close = (line.match(/\}/g) || []).length;
            return open - close;
        };

        const parseFunctionPrototype = (line: string): { returnType: string; name: string; params: string } | null => {
            const trimmed = line.trim();
            if (!trimmed || trimmed.includes("=") || trimmed.startsWith("#")) return null;
            const match = trimmed.match(/^(.+?)\s+([A-Za-z_]\w*)\s*\(([^;{}]*)\)\s*;$/);
            if (!match) return null;
            const returnType = match[1]?.trim() || "";
            const name = match[2]?.trim() || "";
            const params = match[3]?.trim() || "";
            if (!returnType || !name) return null;
            return { returnType, name, params };
        };

        const extractArgNames = (params: string): string[] => {
            const trimmed = params.trim();
            if (!trimmed || trimmed === "void") return [];

            return trimmed
                .split(",")
                .map((raw) => raw.replace(/=[^,]+$/, "").trim())
                .map((param, idx) => {
                    const match = param.match(/([A-Za-z_]\w*)\s*(?:\[[^\]]*\])?\s*$/);
                    return match?.[1] || `arg${idx}`;
                });
        };

        const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

        const wrapperUsesFunction = (name: string, lines: string[]): boolean => {
            const source = lines.join("\n");
            const pattern = new RegExp(`(^|[^\\w:.>])${escapeRegExp(name)}\\s*\\(`);
            return pattern.test(source);
        };

        const parseUserSolutionMethods = (): Array<{ returnType: string; name: string; params: string }> => {
            if (!/\bclass\s+Solution\b/.test(userCode)) return [];

            const methods: Array<{ returnType: string; name: string; params: string }> = [];
            const seen = new Set<string>();
            const methodPattern = /^([~\w:<>,\s*&]+?)\s+([A-Za-z_]\w*)\s*\(([^()]*)\)\s*(?:const\s*)?(?:\{|;)\s*$/;
            const lines = userCode.split("\n");
            let insideSolution = false;
            let depth = 0;
            let access: "public" | "private" | "protected" = "private";

            for (const line of lines) {
                const trimmed = line.trim();

                if (!insideSolution) {
                    if (/^class\s+Solution\b/.test(trimmed)) {
                        insideSolution = true;
                        depth = countBraces(line);
                        access = "private";
                    }
                    continue;
                }

                const accessMatch = trimmed.match(/^(public|private|protected)\s*:/);
                if (accessMatch) {
                    access = accessMatch[1] as "public" | "private" | "protected";
                    depth += countBraces(line);
                    if (depth <= 0) insideSolution = false;
                    continue;
                }

                if (
                    access === "public" &&
                    depth === 1 &&
                    trimmed &&
                    !trimmed.startsWith("//") &&
                    !trimmed.startsWith("return ") &&
                    !trimmed.startsWith("friend ") &&
                    !trimmed.startsWith("using ") &&
                    !trimmed.includes(" operator")
                ) {
                    const methodMatch = trimmed.match(methodPattern);
                    if (methodMatch) {
                        const candidate = {
                            returnType: methodMatch[1]?.trim() || "",
                            name: methodMatch[2]?.trim() || "",
                            params: methodMatch[3]?.trim() || "",
                        };
                        if (candidate.returnType && candidate.name !== "Solution") {
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

        const buildCppAdapters = (preludeLines: string[], wrapperUsageLines: string[]): string[] => {
            if (!/\bclass\s+Solution\b/.test(userCode)) return [];

            const adapterLines: string[] = [];
            const seen = new Set<string>();
            let topLevelBraceDepth = 0;

            for (const line of preludeLines) {
                if (topLevelBraceDepth === 0) {
                    const parsed = parseFunctionPrototype(line);
                    if (parsed) {
                        const key = `${parsed.returnType}|${parsed.name}|${parsed.params}`;
                        if (!seen.has(key)) {
                            seen.add(key);

                            const args = extractArgNames(parsed.params).join(", ");
                            adapterLines.push(`${parsed.returnType} ${parsed.name}(${parsed.params}) {`);
                            adapterLines.push("    Solution sol;");
                            if (parsed.returnType === "void") {
                                adapterLines.push(`    sol.${parsed.name}(${args});`);
                            } else {
                                adapterLines.push(`    return sol.${parsed.name}(${args});`);
                            }
                            adapterLines.push("}");
                            adapterLines.push("");
                        }
                    }
                }

                topLevelBraceDepth += countBraces(line);
                if (topLevelBraceDepth < 0) topLevelBraceDepth = 0;
            }

            for (const method of parseUserSolutionMethods()) {
                const key = `${method.returnType}|${method.name}|${method.params}`;
                if (seen.has(key)) continue;
                if (!wrapperUsesFunction(method.name, wrapperUsageLines)) continue;

                seen.add(key);
                const args = extractArgNames(method.params).join(", ");
                adapterLines.push(`${method.returnType} ${method.name}(${method.params}) {`);
                adapterLines.push("    Solution sol;");
                if (method.returnType === "void") {
                    adapterLines.push(`    sol.${method.name}(${args});`);
                } else {
                    adapterLines.push(`    return sol.${method.name}(${args});`);
                }
                adapterLines.push("}");
                adapterLines.push("");
            }

            return adapterLines;
        };

        let insideSolutionClass = false;
        let solutionBraceDepth = 0;
        let solutionClassEncountered = false;

        for (const line of wrapperLines) {
            const trimmed = line.trim();

            // Extract headers
            if (trimmed.startsWith("#include") || trimmed.startsWith("using namespace") || trimmed.startsWith("using std::")) {
                headerLines.push(line);
                if (/^using\s+namespace\s+std\s*;/.test(trimmed)) {
                    sawUsingNamespaceStd = true;
                }
                continue;
            }

            // Skip wrapper's Solution class (user provides this class).
            if (!insideSolutionClass && trimmed.match(/^class\s+Solution\b/)) {
                insideSolutionClass = true;
                solutionClassEncountered = true;
                solutionBraceDepth = countBraces(line);
                if (solutionBraceDepth <= 0 && trimmed.includes("};")) {
                    insideSolutionClass = false;
                }
                continue;
            }

            if (insideSolutionClass) {
                solutionBraceDepth += countBraces(line);
                if (solutionBraceDepth <= 0) {
                    insideSolutionClass = false;
                }
                continue;
            }

            if (!solutionClassEncountered) {
                preUserLines.push(line);
            } else {
                postUserLines.push(line);
            }
        }

        // If wrapper has no Solution class, keep runner/main after user code.
        if (!solutionClassEncountered) {
            const mainStartIdx = preUserLines.findIndex((line) =>
                line.trim().match(/^int\s+main\s*\(/)
            );
            if (mainStartIdx >= 0) {
                postUserLines.push(...preUserLines.slice(mainStartIdx));
                preUserLines.splice(mainStartIdx);
            }
        }

        const adapterLines = buildCppAdapters(preUserLines, [...preUserLines, ...postUserLines]);
        const parts: string[] = [];
        if (!hasBitsHeader) {
            parts.push("#include <bits/stdc++.h>");
        }
        if (headerLines.length > 0) parts.push(headerLines.join("\n"));
        if (!sawUsingNamespaceStd && !userUsesStdQualified) {
            parts.push("using namespace std;");
        }
        if (preUserLines.join("\n").trim()) parts.push(preUserLines.join("\n"));
        parts.push(userCode);
        if (adapterLines.length > 0) parts.push(adapterLines.join("\n"));
        if (postUserLines.join("\n").trim()) parts.push(postUserLines.join("\n"));
        return parts.join("\n");
    }

    if (lang === "python" || lang === "python3") {
        const adapters = buildPythonClassSolutionAdapters(userCode);
        return [userCode, adapters, effectiveWrapperCode].filter((part) => part.trim()).join("\n");
    }

    if (lang === "javascript" || lang === "js" || lang === "nodejs" || lang === "typescript" || lang === "ts") {
        const adapters = buildJavaScriptClassSolutionAdapters(userCode);
        return [userCode, adapters, effectiveWrapperCode].filter((part) => part.trim()).join("\n");
    }

    // For other languages: user code first, then wrapper
    return userCode + "\n" + effectiveWrapperCode;
}

function getCodeSnippetByLanguage(codeSnippets: any, language: string): any | null {
    if (!codeSnippets) return null;

    const aliases: Record<string, string[]> = {
        cpp: ["cpp", "c++", "cplusplus"],
        python: ["python", "python3"],
        java: ["java"],
        javascript: ["javascript", "js", "nodejs"],
        typescript: ["typescript", "ts"],
        c: ["c"],
        csharp: ["csharp", "c#"],
        go: ["go"],
        rust: ["rust"],
        ruby: ["ruby"],
    };

    const normalizedLanguage = (language || "").toLowerCase();
    const candidates = aliases[normalizedLanguage] ?? [normalizedLanguage];
    const getSnippet = (key: string) =>
        typeof codeSnippets.get === "function" ? codeSnippets.get(key) : codeSnippets[key];

    for (const candidate of candidates) {
        const snippet = getSnippet(candidate);
        if (snippet) return snippet;
    }

    return null;
}

// ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
// 7. WRAPPER CODE FETCHER (MongoDB)
// ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ

/**
 * Fetches the wrapper code for a given question and language from MongoDB.
 * The wrapper code contains the I/O parsing logic (main function, input reading,
 * output formatting) that wraps around the user's solution code.
 *
 * @returns The wrapper code string, or null if not found.
 */
async function fetchWrapperCode(
    questionId: string,
    language: string,
    contestId?: string,
    questionSource?: DsaQuestionSource
): Promise<string | null> {
    const doc = await findPracticeDsaQuestion(questionId, contestId, questionSource);
    if (!doc) return null;

    // codeSnippets may be a Mongoose Map or a plain object depending on the source collection.
    const snippet = getCodeSnippetByLanguage(doc.codeSnippets, language);
    return snippet?.wrapper_code ?? snippet?.wrapperCode ?? null;
}

// ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
// 7. MAIN ORCHESTRATOR â runCodeForQuestion
// ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ

/**
 * Main function to execute code for a question.
 *
 * @param questionId - ID of the coding question (from the `questions` table)
 * @param sourceCode - Raw source code from the Monaco Editor
 * @param languageId - Judge0 language ID (optional if language name is provided)
 * @param language   - Language name string (e.g., "python", "cpp")
 * @param mode       - "run" for sample tests only, "submit" for sample + hidden
 *
 * @returns Structured JSON result matching the frontend response format
 */

const CHECKER_INPUT_MARKER = "===OUTPUT===";
const CHECKER_EXPECTED_MARKER = "===EXPECTED===";

function resolveCheckerLanguageId(language: string | null | undefined): number {
    const key = String(language || "cpp").toLowerCase().replace("c++", "cpp");
    return LANGUAGE_MAP[key] || LANGUAGE_MAP.cpp || 54;
}

/**
 * Wraps the problem-setter's `check(...)` function with a per-language harness
 * that reads stdin, splits the input / user-output / expected sections, calls
 * check(), and prints `1` or `0`. The setter never writes the parsing boilerplate.
 */
export function wrapCheckerCode(checkerCode: string, checkerLanguage: string | null): string {
    const lang = String(checkerLanguage || "cpp").toLowerCase().replace("c++", "cpp");
    if (lang === "python" || lang === "python3") {
        return `${checkerCode}\n\nimport sys as _sys\ndef _run():\n    _d = _sys.stdin.read()\n    _A = "===OUTPUT==="\n    _B = "===EXPECTED==="\n    _p = _d.find(_A); _q = _d.find(_B)\n    _inp = _d[:_p] if _p >= 0 else _d\n    _out = _d[_p+len(_A):_q] if (_p >= 0 and _q >= 0) else ""\n    _exp = _d[_q+len(_B):] if _q >= 0 else ""\n    print(1 if check(_inp, _out, _exp) else 0)\n_run()\n`;
    }
    if (lang === "java") {
        return `import java.util.*;\nimport java.io.*;\n${checkerCode}\n\npublic class Main {\n    public static void main(String[] _a) throws Exception {\n        String _all = new String(System.in.readAllBytes());\n        String _A = "===OUTPUT===", _B = "===EXPECTED===";\n        int _p = _all.indexOf(_A), _q = _all.indexOf(_B);\n        String input = _p >= 0 ? _all.substring(0, _p) : _all;\n        String output = (_p >= 0 && _q >= 0) ? _all.substring(_p + _A.length(), _q) : "";\n        String expected = _q >= 0 ? _all.substring(_q + _B.length()) : "";\n        System.out.print(Checker.check(input, output, expected) ? 1 : 0);\n    }\n}\n`;
    }
    if (lang === "javascript") {
        return `${checkerCode}\n\n(function(){\n    const _all = require('fs').readFileSync(0, 'utf8');\n    const _A = "===OUTPUT===", _B = "===EXPECTED===";\n    const _p = _all.indexOf(_A), _q = _all.indexOf(_B);\n    const input = _p >= 0 ? _all.slice(0, _p) : _all;\n    const output = (_p >= 0 && _q >= 0) ? _all.slice(_p + _A.length, _q) : "";\n    const expected = _q >= 0 ? _all.slice(_q + _B.length) : "";\n    process.stdout.write(check(input, output, expected) ? "1" : "0");\n})();\n`;
    }
    // C++ (default)
    return `#include <bits/stdc++.h>\nusing namespace std;\n${checkerCode}\n\nint main(){\n    std::stringstream _buf; _buf << std::cin.rdbuf();\n    std::string _all = _buf.str(), _A = "===OUTPUT===", _B = "===EXPECTED===";\n    size_t _p = _all.find(_A), _q = _all.find(_B);\n    std::string input = (_p == std::string::npos) ? _all : _all.substr(0, _p);\n    std::string output = (_p == std::string::npos || _q == std::string::npos) ? std::string() : _all.substr(_p + _A.size(), _q - (_p + _A.size()));\n    std::string expected = (_q == std::string::npos) ? std::string() : _all.substr(_q + _B.size());\n    std::cout << (check(input, output, expected) ? 1 : 0);\n    return 0;\n}\n`;
}

/**
 * Runs a custom checker (special judge) for one test case via Judge0.
 * The checker gets on stdin: <input>\n===OUTPUT===\n<userOutput>\n===EXPECTED===\n<expected>
 * and must print `1` (accepted) or `0` (rejected) as its first token.
 * Used for problems with multiple valid outputs.
 */
async function runChecker(
    checkerCode: string,
    checkerLanguage: string | null,
    testInput: string,
    userOutput: string,
    expectedOutput: string,
    cpuTimeLimit: number,
    memoryLimit: number
): Promise<boolean> {
    const stdin = `${testInput}\n${CHECKER_INPUT_MARKER}\n${userOutput}\n${CHECKER_EXPECTED_MARKER}\n${expectedOutput}\n`;
    const submission: Judge0Submission = {
        source_code: toBase64(wrapCheckerCode(checkerCode, checkerLanguage))!,
        language_id: resolveCheckerLanguageId(checkerLanguage),
        stdin: toBase64(stdin),
        expected_output: null,
        ...getJudge0LimitFields(cpuTimeLimit, memoryLimit),
        max_output_size: getJudge0MaxOutputSize(),
    };

    try {
        const results = await executeSubmissionsInChunks([submission]);
        const result = results[0];
        if (!result) return false;
        const out = fromBase64(result.stdout).trim();
        const firstToken = out.split(/\s+/)[0]?.toLowerCase() || "";
        return firstToken === "1" || firstToken === "ok" || firstToken === "yes" || firstToken === "ac" || firstToken === "accepted";
    } catch (err) {
        console.error("[CodeExec] Checker execution failed:", err);
        return false;
    }
}

function isCheckerAcceptOutput(stdoutB64: string | null | undefined): boolean {
    const firstToken = fromBase64(stdoutB64).trim().split(/\s+/)[0]?.toLowerCase() || "";
    return firstToken === "1" || firstToken === "ok" || firstToken === "yes" || firstToken === "ac" || firstToken === "accepted";
}

/**
 * Runs the custom checker for MANY test cases in a single batched Judge0 pass.
 * The wrapped checker source is identical for every case (only the stdin
 * differs), so we dispatch all cases through one executeSubmissionsInChunks
 * call instead of one submit+poll per passing test — turning O(passing tests)
 * Judge0 calls into O(1) chunked batch. Returns verdicts aligned with `items`.
 */
async function runCheckerBatch(
    checkerCode: string,
    checkerLanguage: string | null,
    items: Array<{ input: string; output: string; expected: string }>,
    cpuTimeLimit: number,
    memoryLimit: number
): Promise<boolean[]> {
    if (items.length === 0) return [];
    const wrappedSource = toBase64(wrapCheckerCode(checkerCode, checkerLanguage))!;
    const languageId = resolveCheckerLanguageId(checkerLanguage);
    const submissions: Judge0Submission[] = items.map((it) => ({
        source_code: wrappedSource,
        language_id: languageId,
        stdin: toBase64(`${it.input}\n${CHECKER_INPUT_MARKER}\n${it.output}\n${CHECKER_EXPECTED_MARKER}\n${it.expected}\n`),
        expected_output: null,
        ...getJudge0LimitFields(cpuTimeLimit, memoryLimit),
        max_output_size: getJudge0MaxOutputSize(),
    }));
    try {
        const results = await executeSubmissionsInChunks(submissions);
        return items.map((_, i) => (results[i] ? isCheckerAcceptOutput(results[i]!.stdout) : false));
    } catch (err) {
        console.error("[CodeExec] Checker batch execution failed:", err);
        return items.map(() => false);
    }
}

export async function runCodeForQuestion({
    questionId,
    sourceCode,
    languageId,
    language,
    mode = "run",
    maxHiddenTests,
    skipSampleTests = false,
    contestId,
    questionSource,
    customTests,
}: {
    questionId: string;
    sourceCode: string;
    languageId?: number;
    language?: string;
    mode?: "run" | "submit";
    maxHiddenTests?: number | null;
    skipSampleTests?: boolean;
    contestId?: string;
    questionSource?: DsaQuestionSource;
    // User-added custom test cases (run mode only): executed for output only,
    // never compared/scored.
    customTests?: Array<{ stdin?: string }>;
}): Promise<RunCodeResult> {
    // ââ Step 1: Resolve language ID ââââââââââââââââââââââââââââââââââââ
    console.log(`[CodeExec] Incoming params: language="${language}", languageId=${languageId}, questionId=${questionId}`);
    let resolvedLangId = languageId;
    const resolvedLangName = language?.toLowerCase() || "cpp";
    if (!resolvedLangId) {
        resolvedLangId = LANGUAGE_MAP[resolvedLangName];
    }
    if (!resolvedLangId) {
        resolvedLangId = 54; // Default to C++
    }

    // ââ Step 2: Fetch test cases from the database ââââââââââââââââââââ
    // eslint-disable-next-line prefer-const
    let { sampleTests, hiddenTests, constraints, problemSlug, timeLimit, memoryLimit: storedMemoryLimitMb, judgeType, checkerLanguage, checkerCode } = await fetchTestCases(questionId, contestId, questionSource);
    const useCustomChecker = judgeType === "custom" && !!checkerCode;

    // Always run generated stress guards before ordinary hidden tests. Some
    // plans cap hidden execution, so guards must be inside the first slice.
    hiddenTests = [
        ...hiddenTests.filter((tc) => tc.id.startsWith("hidden_stress")),
        ...hiddenTests.filter((tc) => !tc.id.startsWith("hidden_stress")),
    ];

    // Apply entitlement-based cap on hidden tests (used by PLUS plan).
    // null/undefined = no cap (PRO/MAX). 0 = blocked (FREE) â caller should have rejected already.
    if (mode === "submit" && typeof maxHiddenTests === "number" && maxHiddenTests >= 0) {
        hiddenTests = hiddenTests.slice(0, maxHiddenTests);
    }

    if (sampleTests.length === 0 && hiddenTests.length === 0) {
        return {
            success: false,
            error: "No test cases found for this question.",
        };
    }

    // ââ Step 3: Parse constraints for Judge0 limits âââââââââââââââââââ
    const parsedLimits = parseConstraints(constraints);
    const cpuTimeLimit = timeLimit ? clampCpuTimeLimit(timeLimit) : parsedLimits.cpuTimeLimit;
    const memoryLimit = storedMemoryLimitMb ? clampMemoryLimitKb(storedMemoryLimitMb * 1024) : parsedLimits.memoryLimit;

    // ââ Step 4: Fetch wrapper code and combine with user code âââââââââ
    const wrapperCode = await fetchWrapperCode(questionId, resolvedLangName, contestId, questionSource);

    // Combine user code + wrapper code in a language-aware way.
    // Key issue: Java requires imports at the top of the file, and C++ requires
    // #include directives at the top. We must extract these from the wrapper and
    // place them before the user code.
    let finalCode: string;
    if (wrapperCode) {
        finalCode = combineCodeWithWrapper(sourceCode, wrapperCode, resolvedLangName);
        console.log(`[CodeExec] Combined user code (${sourceCode.length} chars) with ${resolvedLangName} wrapper (${wrapperCode.length} chars) â final (${finalCode.length} chars)`);
    } else {
        finalCode = sourceCode;
        console.warn(`[CodeExec] No wrapper code found for question=${questionId}, lang=${resolvedLangName}. Sending raw user code.`);
    }
    logJudge0SourceDebug({
        questionId,
        language: resolvedLangName,
        mode,
        phase: "prepared",
        sourceCode,
        wrapperCode,
        finalCode,
    });

    // ââ Step 5: Build Judge0 submissions ââââââââââââââââââââââââââââââ
    const encodedSource = toBase64(finalCode)!;

    // Helper to convert JSON input to plain text format expected by wrapper
    const convertJsonInputToPlainText = (jsonInput: string): string => {
        try {
            const parsed = JSON.parse(jsonInput);
            
            // Handle LRUCache format: {"capacity":2,"operations":[...]}
            if (parsed.capacity !== undefined && parsed.operations && Array.isArray(parsed.operations)) {
                const lines: string[] = [];
                // First line: N capacity
                lines.push(`${parsed.operations.length} ${parsed.capacity}`);
                // Next N lines: operation details
                for (const op of parsed.operations) {
                    if (Array.isArray(op)) {
                        // op is like ["put", 1, 1] or ["get", 1]
                        lines.push(op.join(' '));
                    }
                }
                return lines.join('\n');
            }
            
            // Handle array input format: {"nums":[...], "k":...}
            if (parsed.nums && Array.isArray(parsed.nums)) {
                const nums = parsed.nums;
                const k = parsed.k || parsed.target || 0;
                return `${nums.length}\n${nums.join(' ')}\n${k}`;
            }
            
            // Handle other formats - keep as JSON for wrapper to parse
            return jsonInput;
        } catch {
            // If not JSON, return as-is
            return jsonInput;
        }
    };

    const buildSubmissions = (testCases: TestCase[]): Judge0Submission[] =>
        testCases.map((tc) => {
            const plainTextInput = convertJsonInputToPlainText(tc.input);
            return {
                source_code: encodedSource,
                language_id: resolvedLangId!,
                stdin: toBase64(plainTextInput),
                // Judge0 output matching is too strict for JSON spacing.
                // We compare outputs ourselves using normalized semantics.
                expected_output: null,
                ...getJudge0LimitFields(cpuTimeLimit, memoryLimit),
                max_output_size: getJudge0MaxOutputSize(),
            };
        });

    try {
        // ââ Step 6: Run Judge0 submissions ââââââââââââââââââââââââââââ
        const shouldRunHidden = mode === "submit" && hiddenTests.length > 0;

        // User-added custom cases (run mode only) — executed for output only.
        const customCases: TestCase[] = (!shouldRunHidden && Array.isArray(customTests))
            ? customTests.map((c, i) => ({
                id: `custom_${i}`,
                input: String(c?.stdin ?? ""),
                expected: "",
                type: "custom",
                orderIdx: sampleTests.length + i,
            }))
            : [];

        // For paid plans on submit, skip sample tests to save API calls
        // Sample tests have already been run during the "Run" phase
        const testsToExecute = shouldRunHidden
            ? (skipSampleTests ? hiddenTests : [...sampleTests, ...hiddenTests])
            : [...sampleTests, ...customCases];

        const executionStart = Date.now();
        const judge0Results = testsToExecute.length > 0
            ? await executeSubmissionsInChunks(buildSubmissions(testsToExecute))
            : [];

        console.log(
            `[CodeExec] Judge0 returned ${judge0Results.length}/${testsToExecute.length} ` +
            `result(s) in ${Date.now() - executionStart}ms (mode=${mode}, skipSampleTests=${skipSampleTests})`
        );

        const { sampleJudge0Results, hiddenJudge0Results } = skipSampleTests && shouldRunHidden
            ? { sampleJudge0Results: [], hiddenJudge0Results: judge0Results }
            : splitJudge0ResultsBySampleCount(judge0Results, sampleTests.length);

        let sampleResults: TestResult[] = [];

        if (skipSampleTests && shouldRunHidden) {
            // For paid plans on submit, assume sample tests passed (they were run during "Run" phase)
            // Create mock passing results for sample tests
            sampleResults = sampleTests.map((test) => ({
                passed: true,
                status: "Accepted",
                input: test.input,
                expectedOutput: test.expected,
                actualOutput: test.expected, // Assume correct
                verdictColor: "green",
                time: "0s",
                memory: "0KB",
            }));
        } else if (sampleJudge0Results.length > 0) {
            // Check for global compilation error (all tests fail with same compile error)
            const firstResult = sampleJudge0Results[0];
            if (firstResult?.status?.id === 6) {
                const compileOutput = fromBase64(firstResult.compile_output);
                const stderr = fromBase64(firstResult.stderr);
                logJudge0SourceDebug({
                    questionId,
                    language: resolvedLangName,
                    mode,
                    phase: "compile_error",
                    sourceCode,
                    wrapperCode,
                    finalCode,
                    compileOutput,
                    stderr,
                });
                return {
                    success: false,
                    error: "Compilation Error",
                    compileOutput,
                    stderr,
                };
            }

            // Process each sample test result
            sampleResults = sampleJudge0Results.map((result, idx) =>
                processTestResult(result, sampleTests[idx]!, { problemSlug })
            );
        }

        // Custom checker (special judge): re-decide verdicts by the checker's
        // rules for questions with multiple valid outputs. Only for results that
        // actually ran (skip compile/runtime errors).
        if (useCustomChecker) {
            const eligible = sampleResults.filter((r) => r.status === "Accepted" || r.status === "Wrong Answer");
            if (eligible.length > 0) {
                const verdicts = await runCheckerBatch(
                    checkerCode!,
                    checkerLanguage,
                    eligible.map((r) => ({ input: String(r.input ?? ""), output: r.actualOutput, expected: String(r.expectedOutput ?? "") })),
                    cpuTimeLimit,
                    memoryLimit
                );
                eligible.forEach((r, k) => {
                    const ok = verdicts[k] ?? false;
                    r.passed = ok;
                    r.verdictColor = ok ? "green" : "red";
                    r.status = ok ? "Accepted" : "Wrong Answer";
                });
            }
        }

        const sampleSummary = {
            total: sampleResults.length,
            passed: sampleResults.filter((r) => r.passed).length,
        };

        // ââ Step 7: Process HIDDEN test cases (only on submit) âââââââââ
        let hiddenSummary: { total: number; passed: number } | undefined;
        let hiddenFirstFailed: HiddenFirstFailedResult | undefined;

        if (shouldRunHidden) {
            const hiddenResults = hiddenJudge0Results.map((result, idx) =>
                processHiddenTestResult(result, hiddenTests[idx]!, { problemSlug })
            );
            // Custom checker: re-decide hidden verdicts by the checker's rules, in
            // ONE batched Judge0 pass instead of one call per passing test.
            if (useCustomChecker) {
                const eligibleIdx: number[] = [];
                hiddenResults.forEach((base, idx) => {
                    if (base.status === "Accepted" || base.status === "Wrong Answer") eligibleIdx.push(idx);
                });
                if (eligibleIdx.length > 0) {
                    const verdicts = await runCheckerBatch(
                        checkerCode!,
                        checkerLanguage,
                        eligibleIdx.map((idx) => ({
                            input: hiddenTests[idx]!.input,
                            output: fromBase64(hiddenJudge0Results[idx]!.stdout),
                            expected: hiddenTests[idx]!.expected,
                        })),
                        cpuTimeLimit,
                        memoryLimit
                    );
                    eligibleIdx.forEach((idx, k) => {
                        const ok = verdicts[k] ?? false;
                        hiddenResults[idx]!.passed = ok;
                        hiddenResults[idx]!.status = ok ? "Accepted" : "Wrong Answer";
                    });
                }
            }

            hiddenSummary = {
                total: hiddenResults.length,
                passed: hiddenResults.filter((r) => r.passed).length,
            };

            const firstFailedIndex = hiddenResults.findIndex((r) => !r.passed);
            if (firstFailedIndex >= 0) {
                hiddenFirstFailed = buildHiddenFailureDetail(
                    hiddenJudge0Results[firstFailedIndex]!,
                    hiddenTests[firstFailedIndex]!,
                    { problemSlug }
                );
            }
        }

        // ââ Step 8: Build and return structured response ââââââââââââââ
        const sampleAccepted = sampleSummary.passed === sampleSummary.total;
        const hiddenAccepted = !hiddenSummary || hiddenSummary.passed === hiddenSummary.total;
        const accepted = sampleAccepted && hiddenAccepted;

        // Custom cases (run mode) — executed for OUTPUT ONLY, never scored.
        // In run mode the post-sample Judge0 results are the custom cases.
        const customResults: TestResult[] = (!shouldRunHidden && customCases.length > 0)
            ? hiddenJudge0Results.slice(0, customCases.length).map((result, idx) => {
                const base = processTestResult(result, customCases[idx]!, { problemSlug });
                const ran = (result.status?.id || 0) === 3;
                return {
                    ...base,
                    expectedOutput: "",
                    passed: false,
                    verdictColor: "red" as const,
                    status: ran ? "Finished" : base.status,
                };
            })
            : [];

        const response: RunCodeResult = {
            success: accepted,
            ...(accepted
                ? {}
                : {
                    error:
                        hiddenFirstFailed?.status ||
                        sampleResults.find((result) => !result.passed)?.status ||
                        "Some test cases failed.",
                }),
            sample: {
                // Custom results appended after samples; the frontend tests array
                // is [samples, customs], so index-based mapping stays aligned.
                tests: [...sampleResults, ...customResults],
                summary: sampleSummary,
            },
        };

        if (hiddenSummary) {
            response.hidden = {
                summary: hiddenSummary,
                ...(hiddenFirstFailed ? { firstFailed: hiddenFirstFailed } : {}),
            };
        }

        return response;
    } catch (err: any) {
        console.error("[CodeExec] Execution error:", err);
        return {
            success: false,
            error: err.message || "Code execution failed.",
        };
    }
}

/**
 * Resolves a language name to a Judge0 language ID.
 * Exported for use by routes.
 */
export function resolveLanguageId(
    languageId?: number,
    languageName?: string
): number {
    if (languageId) return languageId;
    if (languageName) {
        return LANGUAGE_MAP[languageName.toLowerCase()] || 54;
    }
    return 54; // Default C++
}

// Test-only helpers for unit tests.
export const __testUtils = {
    normalizeOutput,
    compareOutput,
    combineCodeWithWrapper,
    buildHiddenFailureDetail,
    splitJudge0ResultsBySampleCount,
    buildDSHiddenCodeBefore,
    buildDSDatasetInjectionScript,
};

export async function runCodeForGenAIQuestion({
    sourceCode,
    language,
    mode = "run",
    sampleTestCases,
    hiddenTestCases = [],
    maxHiddenTests,
    skipSampleTests = false,
}: {
    sourceCode: string;
    language: string;
    mode?: "run" | "submit";
    sampleTestCases: Array<{ id: string; description: string; input: string; expectedOutput?: string; output?: string }>;
    hiddenTestCases?: Array<{ id: string; description?: string; input: string; expectedOutput?: string; output?: string }>;
    maxHiddenTests?: number | null;
    skipSampleTests?: boolean;
}): Promise<RunCodeResult> {
    const resolvedLangName = language?.toLowerCase() || "python";
    const resolvedLangId = LANGUAGE_MAP[resolvedLangName] ?? 71;
    const cappedHiddenTestCases =
        mode === "submit" && typeof maxHiddenTests === "number" && maxHiddenTests >= 0
            ? hiddenTestCases.slice(0, maxHiddenTests)
            : hiddenTestCases;
    const shouldRunHidden = mode === "submit" && cappedHiddenTestCases.length > 0;

    if (sampleTestCases.length === 0 && !shouldRunHidden) {
        return {
            success: false,
            error: "No test cases available for this GenAI coding task.",
        };
    }

    const executableSource =
        resolvedLangName.startsWith("python") && !sourceCode.trimStart().startsWith("from __future__ import annotations")
            ? `from __future__ import annotations\n${sourceCode}`
            : sourceCode;
    const sampleTests: TestCase[] = sampleTestCases.map((tc, i) => ({
        id: tc.id || "tc_" + i,
        input: tc.input,
        expected: tc.expectedOutput ?? tc.output ?? "",
        type: "sample",
        orderIdx: i,
    }));
    const hiddenTests: TestCase[] = cappedHiddenTestCases.map((tc, i) => ({
        id: tc.id || "hidden_" + i,
        input: tc.input,
        expected: tc.expectedOutput ?? tc.output ?? "",
        type: "hidden",
        orderIdx: i,
    }));
    const testsToExecute = shouldRunHidden
        ? (skipSampleTests ? hiddenTests : [...sampleTests, ...hiddenTests])
        : sampleTests;

    const encodedSource = toBase64(executableSource)!;
    const submissions: Judge0Submission[] = testsToExecute.map((tc) => ({
        source_code: encodedSource,
        language_id: resolvedLangId,
        stdin: tc.input ? toBase64(tc.input) : null,
        expected_output: null,
        ...getJudge0LimitFields(getDefaultCpuTimeLimit(), getDefaultMemoryLimit()),
        max_output_size: getJudge0MaxOutputSize(),
    }));

    try {
        const judge0Results = await executeSubmissionsInChunks(submissions);
        const firstResult = judge0Results[0];
        if (firstResult?.status?.id === 6) {
            return {
                success: false,
                error: "Compilation Error",
                compileOutput: fromBase64(firstResult.compile_output),
                stderr: fromBase64(firstResult.stderr),
            };
        }

        const { sampleJudge0Results, hiddenJudge0Results } = skipSampleTests && shouldRunHidden
            ? { sampleJudge0Results: [], hiddenJudge0Results: judge0Results }
            : splitJudge0ResultsBySampleCount(judge0Results, sampleTests.length);

        const sampleResults = skipSampleTests && shouldRunHidden
            ? sampleTests.map((test) => ({
                passed: true,
                status: "Accepted",
                input: test.input,
                expectedOutput: test.expected,
                actualOutput: test.expected,
                verdictColor: "green" as const,
                time: "0s",
                memory: "0KB",
            }))
            : sampleJudge0Results.map((result, idx) =>
                processTestResult(result, sampleTests[idx]!, { problemSlug: null })
            );

        let hiddenSummary: { total: number; passed: number } | undefined;
        let hiddenFirstFailed: HiddenFirstFailedResult | undefined;
        if (shouldRunHidden) {
            const hiddenResults = hiddenJudge0Results.map((result, idx) =>
                processHiddenTestResult(result, hiddenTests[idx]!, { problemSlug: null })
            );
            hiddenSummary = {
                total: hiddenResults.length,
                passed: hiddenResults.filter((r) => r.passed).length,
            };
            const firstFailedIndex = hiddenResults.findIndex((r) => !r.passed);
            if (firstFailedIndex >= 0) {
                hiddenFirstFailed = buildHiddenFailureDetail(
                    hiddenJudge0Results[firstFailedIndex]!,
                    hiddenTests[firstFailedIndex]!,
                    { problemSlug: null }
                );
            }
        }

        const response: RunCodeResult = {
            success: true,
            sample: {
                tests: sampleResults,
                summary: {
                    total: sampleResults.length,
                    passed: sampleResults.filter((r) => r.passed).length,
                },
            },
        };
        if (hiddenSummary) {
            response.hidden = {
                summary: hiddenSummary,
                ...(hiddenFirstFailed ? { firstFailed: hiddenFirstFailed } : {}),
            };
        }
        return response;
    } catch (err: any) {
        console.error("[CodeExec][GenAI] Execution error:", err);
        return {
            success: false,
            error: err.message || "Code execution failed.",
        };
    }
}

export async function runCodeForCompanyDSAQuestion({
    questionId,
    companyId,
    sourceCode,
    languageId,
    language,
    mode = "run",
}: {
    questionId: string;
    companyId: string;
    sourceCode: string;
    languageId?: number;
    language?: string;
    mode?: "run" | "submit";
}): Promise<RunCodeResult> {
    let resolvedLangId = languageId;
    const resolvedLangName = language?.toLowerCase() || "cpp";
    if (!resolvedLangId) {
        resolvedLangId = LANGUAGE_MAP[resolvedLangName];
    }
    if (!resolvedLangId) {
        resolvedLangId = 54;
    }

    const doc = await CompanyDSAQuestion.findOne({
        _id: questionId,
        "company.id": companyId,
    }).select("+hiddenTestCases +solution");

    if (!doc) {
        throw new Error(`Company question not found: ${questionId}`);
    }

    const normalized = normalizeDSAQuestion(doc as any);
    const sampleTests = normalized.testCases
        .filter((tc) => tc.type === "sample")
        .map((tc) => ({
            id: tc.id,
            input: tc.input,
            expected: tc.expected,
            type: tc.type,
            orderIdx: tc.orderIdx,
        }));
    const hiddenTests = normalized.testCases
        .filter((tc) => tc.type !== "sample")
        .map((tc) => ({
            id: tc.id,
            input: tc.input,
            expected: tc.expected,
            type: tc.type,
            orderIdx: tc.orderIdx,
        }));

    if (sampleTests.length === 0 && hiddenTests.length === 0) {
        return {
            success: false,
            error: "No test cases found for this company question.",
        };
    }

    const parsedLimits = parseConstraints(normalized.constraints);
    const cpuTimeLimit = normalized.timeLimit ? clampCpuTimeLimit(Number(normalized.timeLimit)) : parsedLimits.cpuTimeLimit;
    const memoryLimit = normalized.memoryLimit ? clampMemoryLimitKb(Number(normalized.memoryLimit) * 1024) : parsedLimits.memoryLimit;
    const wrapperLanguageKeys = resolvedLangName === "c++"
        ? ["cpp", "c++"]
        : resolvedLangName === "python"
            ? ["python", "python3"]
            : [resolvedLangName];
    const wrapperCode =
        normalized.starters.find((starter) => wrapperLanguageKeys.includes(starter.language))?.wrapperCode ||
        normalized.starters.find((starter) => starter.wrapperCode)?.wrapperCode ||
        null;
    const finalCode = wrapperCode
        ? combineCodeWithWrapper(sourceCode, wrapperCode, resolvedLangName)
        : sourceCode;
    const encodedSource = toBase64(finalCode)!;

    const convertJsonInputToPlainText = (jsonInput: string): string => {
        try {
            const parsed = JSON.parse(jsonInput);

            if (parsed.capacity !== undefined && parsed.operations && Array.isArray(parsed.operations)) {
                const lines: string[] = [];
                lines.push(`${parsed.operations.length} ${parsed.capacity}`);
                for (const op of parsed.operations) {
                    if (Array.isArray(op)) lines.push(op.join(" "));
                }
                return lines.join("\n");
            }

            if (parsed.nums && Array.isArray(parsed.nums)) {
                const nums = parsed.nums;
                const k = parsed.k || parsed.target || 0;
                return `${nums.length}\n${nums.join(" ")}\n${k}`;
            }

            return jsonInput;
        } catch {
            return jsonInput;
        }
    };

    const buildSubmissions = (testCases: TestCase[]): Judge0Submission[] =>
        testCases.map((tc) => ({
            source_code: encodedSource,
            language_id: resolvedLangId!,
            stdin: toBase64(convertJsonInputToPlainText(tc.input)),
            expected_output: null,
            ...getJudge0LimitFields(cpuTimeLimit, memoryLimit),
            max_output_size: getJudge0MaxOutputSize(),
        }));

    try {
        const shouldRunHidden = mode === "submit" && hiddenTests.length > 0;
        const testsToExecute = shouldRunHidden ? [...sampleTests, ...hiddenTests] : sampleTests;
        const judge0Results = testsToExecute.length > 0
            ? await executeSubmissionsInChunks(buildSubmissions(testsToExecute))
            : [];
        const { sampleJudge0Results, hiddenJudge0Results } =
            splitJudge0ResultsBySampleCount(judge0Results, sampleTests.length);

        let sampleResults: TestResult[] = [];
        if (sampleJudge0Results.length > 0) {
            const firstResult = sampleJudge0Results[0];
            if (firstResult?.status?.id === 6) {
                return {
                    success: false,
                    error: "Compilation Error",
                    compileOutput: fromBase64(firstResult.compile_output),
                    stderr: fromBase64(firstResult.stderr),
                };
            }

            sampleResults = sampleJudge0Results.map((result, idx) =>
                processTestResult(result, sampleTests[idx]!, { problemSlug: normalized.problemSlug || null })
            );
        }

        const sampleSummary = {
            total: sampleResults.length,
            passed: sampleResults.filter((r) => r.passed).length,
        };

        let hiddenSummary: { total: number; passed: number } | undefined;
        let hiddenFirstFailed: HiddenFirstFailedResult | undefined;

        if (shouldRunHidden) {
            const hiddenResults = hiddenJudge0Results.map((result, idx) =>
                processHiddenTestResult(result, hiddenTests[idx]!, { problemSlug: normalized.problemSlug || null })
            );
            hiddenSummary = {
                total: hiddenResults.length,
                passed: hiddenResults.filter((r) => r.passed).length,
            };

            const firstFailedIndex = hiddenResults.findIndex((r) => !r.passed);
            if (firstFailedIndex >= 0) {
                hiddenFirstFailed = buildHiddenFailureDetail(
                    hiddenJudge0Results[firstFailedIndex]!,
                    hiddenTests[firstFailedIndex]!,
                    { problemSlug: normalized.problemSlug || null }
                );
            }
        }

        const accepted = sampleSummary.passed === sampleSummary.total &&
            (!hiddenSummary || hiddenSummary.passed === hiddenSummary.total);

        return {
            success: accepted,
            ...(accepted ? {} : { error: hiddenFirstFailed?.status || sampleResults.find((result) => !result.passed)?.status || "Some test cases failed." }),
            sample: {
                tests: sampleResults,
                summary: sampleSummary,
            },
            ...(hiddenSummary ? {
                hidden: {
                    summary: hiddenSummary,
                    ...(hiddenFirstFailed ? { firstFailed: hiddenFirstFailed } : {}),
                },
            } : {}),
        };
    } catch (err: any) {
        return {
            success: false,
            error: err.message || "Code execution failed.",
        };
    }
}

function getDSJudge0LanguageId(question: any): number {
    const configured = Number.parseInt(
        process.env.JUDGE0_DS_PYTHON_LANGUAGE_ID ||
        process.env.JUDGE0_PYTHON_ML_LANGUAGE_ID ||
        "",
        10
    );
    if (Number.isFinite(configured) && configured > 0) return configured;
    const questionLanguageId = Number(question.metadata?.judgeLanguageId);
    if (Number.isFinite(questionLanguageId) && questionLanguageId > 0 && questionLanguageId !== 71) {
        return questionLanguageId;
    }
    return 25;
}

const DS_DATASET_MAP: Record<string, string> = {
    "ds-001": "iris_v1.pkl",
    "ds-002": "churn_v1.pkl",
};

const DS_LEGACY_DATASET_DIR = "/datasets";
const DS_LOCAL_DATASET_DIR = "/tmp/datasets";
const DS_DATASET_SOURCE_DIR_ENV_KEYS = ["DS_DATASET_SOURCE_DIR", "DATASET_LOCAL_DIR"];

function normalizeDatasetQuestionId(value: unknown): string | null {
    return typeof value === "string" && value.trim() ? value.trim().toLowerCase() : null;
}

function getDatasetQuestionIds(question: any): string[] {
    return [
        question?.questionId,
        question?.metadata?.questionId,
        question?.metadata?.id,
        question?.metadata?.slug,
    ]
        .map(normalizeDatasetQuestionId)
        .filter((id): id is string => Boolean(id));
}

function getDatasetPublicBaseUrl(): string {
    return (
        process.env.R2_DATASET_PUBLIC_URL ||
        process.env.R2_PUBLIC_URL ||
        ""
    ).trim().replace(/\/$/, "");
}

function getDatasetForQuestion(question: any): { r2Url: string | null; localPath: string; filename: string } | null {
    const questionId = getDatasetQuestionIds(question).find((id) => DS_DATASET_MAP[id]);
    if (!questionId) return null;

    const filename = DS_DATASET_MAP[questionId]!;
    const publicBaseUrl = getDatasetPublicBaseUrl();
    return {
        filename,
        r2Url: publicBaseUrl && !publicBaseUrl.includes("your-dataset-public-url")
            ? `${publicBaseUrl}/${filename}`
            : null,
        localPath: `${DS_LOCAL_DATASET_DIR}/${filename}`,
    };
}

function toPythonStringLiteral(value: string): string {
    return JSON.stringify(value);
}

function rewriteDSDatasetPaths(source: string, dataset: { filename: string; localPath: string }): string {
    return source
        .replaceAll(`${DS_LEGACY_DATASET_DIR}/${dataset.filename}`, dataset.localPath)
        .replaceAll(`${DS_LOCAL_DATASET_DIR}/${dataset.filename}`, dataset.localPath);
}

function referencesDSDataset(source: string, dataset: { filename: string }): boolean {
    return source.includes(dataset.filename) ||
        source.includes(`${DS_LEGACY_DATASET_DIR}/`) ||
        source.includes(`${DS_LOCAL_DATASET_DIR}/`);
}

async function materializeRemoteCsvReads(source: string): Promise<string> {
    const readCsvUrlPattern = /pd\.read_csv\(\s*(['"])(https?:\/\/[^'"]+)\1\s*\)/g;
    const matches = Array.from(source.matchAll(readCsvUrlPattern));
    if (matches.length === 0) return source;

    let rewritten = source.includes("from io import StringIO")
        ? source
        : `from io import StringIO\n${source}`;

    for (const match of matches) {
        const fullCall = match[0];
        const url = match[2];
        if (!url) continue;

        let csv = REMOTE_CSV_CACHE.get(url);
        if (!csv) {
            const response = await fetchIPv4(url);
            if (!response.ok) {
                throw new Error(`Failed to preload dataset (${response.status}) from ${url}`);
            }
            csv = await response.text();
            REMOTE_CSV_CACHE.set(url, csv);
        }

        rewritten = rewritten.replace(fullCall, `pd.read_csv(StringIO(${JSON.stringify(csv)}))`);
    }

    return rewritten;
}

function getDatasetSourcePath(filename: string): string | null {
    const envDirs = DS_DATASET_SOURCE_DIR_ENV_KEYS
        .map((key) => process.env[key])
        .filter((value): value is string => Boolean(value?.trim()))
        .map((value) => value.trim());

    const candidateDirs = [
        ...envDirs,
        path.join(process.cwd(), "datasets"),
        path.join(process.cwd(), "apps", "api", "datasets"),
    ];

    for (const dir of candidateDirs) {
        const candidate = path.resolve(dir, filename);
        if (existsSync(candidate)) return candidate;
    }

    return null;
}

async function readDatasetAsBase64(dataset: { filename: string; r2Url: string | null }): Promise<string> {
    const sourcePath = getDatasetSourcePath(dataset.filename);
    if (sourcePath) {
        return readFileSync(sourcePath).toString("base64");
    }

    if (!dataset.r2Url) {
        throw new Error(
            `Missing local dataset file ${dataset.filename}. ` +
            "Set DS_DATASET_SOURCE_DIR to a directory containing it, or set R2_DATASET_PUBLIC_URL for server-side fetch."
        );
    }

    const response = await fetchIPv4(dataset.r2Url);
    if (!response.ok) {
        throw new Error(`Failed to fetch dataset ${dataset.filename} from R2: HTTP ${response.status}`);
    }

    return Buffer.from(await response.arrayBuffer()).toString("base64");
}

function chunkString(value: string, chunkSize = 76): string[] {
    const chunks: string[] = [];
    for (let i = 0; i < value.length; i += chunkSize) {
        chunks.push(value.slice(i, i + chunkSize));
    }
    return chunks;
}

function buildDSDatasetInjectionScript(dataset: { localPath: string }, base64Dataset: string): string {
    const encodedChunks = chunkString(base64Dataset)
        .map((chunk) => `    ${toPythonStringLiteral(chunk)}`)
        .join("\n");

    return [
        "import base64",
        "import os",
        "",
        `os.makedirs(${toPythonStringLiteral(DS_LOCAL_DATASET_DIR)}, exist_ok=True)`,
        "_DATASET_B64 = (",
        encodedChunks,
        ")",
        `with open(${toPythonStringLiteral(dataset.localPath)}, "wb") as f:`,
        "    f.write(base64.b64decode(_DATASET_B64))",
    ].join("\n");
}

async function buildDSHiddenCodeBefore(question: any): Promise<string> {
    const originalHiddenCode = question.hiddenCodeBefore || question.starterCode || "";
    const materializedHiddenCode = await materializeRemoteCsvReads(originalHiddenCode);
    const dataset = getDatasetForQuestion(question);
    if (!dataset || !referencesDSDataset(materializedHiddenCode, dataset)) {
        return materializedHiddenCode;
    }

    const rewrittenHiddenCode = rewriteDSDatasetPaths(materializedHiddenCode, dataset);

    const datasetBase64 = await readDatasetAsBase64(dataset);
    const injectionScript = buildDSDatasetInjectionScript(dataset, datasetBase64);

    return [injectionScript, rewrittenHiddenCode].filter(Boolean).join("\n\n");
}

export async function runCodeForDSCodingQuestion({
    sourceCode,
    question,
    mode = "run",
}: {
    sourceCode: string;
    question: any;
    mode?: "run" | "submit";
}): Promise<RunCodeResult> {
    const hiddenCodeBefore = await buildDSHiddenCodeBefore(question);
    const hiddenCodeAfter = question.hiddenCodeAfter || question.structuralAssertions || "";
    const finalCode = [
        hiddenCodeBefore,
        sourceCode,
        hiddenCodeAfter,
    ].filter(Boolean).join("\n\n");
    const dsCpuTimeLimit = clampCpuTimeLimit(Number(question.timeLimit || getDefaultCpuTimeLimit()));
    const dsMemoryLimit = clampMemoryLimitKb(Number(question.memoryLimit || 256) * 1024);

    logJudge0SourceDebug({
        questionId: question.id || question._id?.toString?.() || question.questionId || "unknown-ds-question",
        language: question.language || "cpp",
        mode,
        phase: "prepared",
        sourceCode,
        wrapperCode: [hiddenCodeBefore, hiddenCodeAfter].filter(Boolean).join("\n\n") || null,
        finalCode,
    });

    const submission: Judge0Submission = {
        source_code: toBase64(finalCode)!,
        language_id: getDSJudge0LanguageId(question),
        stdin: null,
        expected_output: null,
        ...getJudge0LimitFields(dsCpuTimeLimit, dsMemoryLimit),
        max_output_size: getJudge0MaxOutputSize(),
    };

    try {
        const [result] = await executeSubmissionsInChunks([submission], "extra");
        if (!result) {
            return { success: false, error: "No execution result returned." };
        }

        const stdout = fromBase64(result.stdout)?.trim() || "";
        const stderr = fromBase64(result.stderr);
        const compileOutput = fromBase64(result.compile_output);
        const accepted = result.status?.id === 3 && !stdout.startsWith("ERROR:");

        if (result.status?.id === 6) {
            logJudge0SourceDebug({
                questionId: question.id || question._id?.toString?.() || question.questionId || "unknown-ds-question",
                language: question.language || "cpp",
                mode,
                phase: "compile_error",
                sourceCode,
                wrapperCode: [hiddenCodeBefore, hiddenCodeAfter].filter(Boolean).join("\n\n") || null,
                finalCode,
                compileOutput,
                stderr,
            });
        }

        const sampleCases = question.sampleTestCases || [];
        const sampleTests: TestResult[] = sampleCases.map((tc: any) => ({
            input: tc.input || "",
            expectedOutput: tc.output || tc.expectedOutput || "",
            actualOutput: accepted
                ? (tc.output || tc.expectedOutput || "Passed")
                : stdout || stderr || compileOutput || result.status?.description || "Failed",
            passed: accepted,
            verdictColor: accepted ? "green" : "red",
            status: accepted ? "Accepted" : (result.status?.description || "Failed"),
            time: result.time ? result.time + "s" : "0s",
            memory: result.memory ? result.memory + "KB" : "0KB",
            stderr: stderr || undefined,
            compileOutput: compileOutput || undefined,
        }));

        const hiddenCases = question.hiddenTestCases || [];
        const hiddenTotal = mode === "submit" ? hiddenCases.length : 0;
        const hiddenPassed = mode === "submit" && accepted ? hiddenTotal : 0;

        return {
            success: accepted,
            error: accepted ? undefined : (stdout || stderr || compileOutput || result.status?.description || "Validation failed."),
            compileOutput: compileOutput || undefined,
            stderr: stderr || undefined,
            sample: {
                tests: sampleTests,
                summary: {
                    total: sampleTests.length,
                    passed: accepted ? sampleTests.length : 0,
                },
            },
            ...(mode === "submit"
                ? {
                    hidden: {
                        summary: { total: hiddenTotal, passed: hiddenPassed },
                        ...(accepted
                            ? {}
                            : {
                                firstFailed: {
                                    input: "Hidden validation",
                                    expectedOutput: "All validation checks pass",
                                    actualOutput: stdout || stderr || compileOutput || result.status?.description || "Validation failed.",
                                    status: result.status?.description || "Failed",
                                    time: result.time ? result.time + "s" : "0s",
                                    memory: result.memory ? result.memory + "KB" : "0KB",
                                    stderr: stderr || undefined,
                                    compileOutput: compileOutput || undefined,
                                },
                            }),
                    },
                }
                : {}),
        };
    } catch (err: any) {
        console.error("[CodeExec][DSCoding] Execution error:", err);
        return {
            success: false,
            error: err.message || "DS coding execution failed.",
        };
    }
}
