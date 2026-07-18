// ============================================
// SQL Execution Service
// ============================================
// Handles SQL query execution via Judge0 (SQLite, language ID 82).
//
// Flow:
//   1. Combine wrapper code (DDL + DML) with user's SQL query
//   2. Submit to Judge0 as SQLite source code
//   3. Poll for results
//   4. Compare stdout against expected output
//   5. Return structured pass/fail result
//
// Judge0 SQLite runs the entire script through `sqlite3 :memory:`.
// The output of the last SELECT is printed to stdout.

import { fetch as undiciFetch, Agent } from "undici";

const ipv4Agent = new Agent({ connect: { family: 4 } });

function fetchIPv4(url: string, options: Record<string, any> = {}): Promise<Response> {
    return undiciFetch(url, { ...options, dispatcher: ipv4Agent }) as unknown as Promise<Response>;
}

type Judge0Runtime = "standard" | "extra";

function getSqlJudge0Runtime(): Judge0Runtime {
    const configured = String(process.env.SQL_JUDGE0_RUNTIME || process.env.JUDGE0_SQL_RUNTIME || "standard").toLowerCase();
    return configured === "standard" ? "standard" : "extra";
}

function getJudge0Url(runtime: Judge0Runtime = getSqlJudge0Runtime()): string {
    const legacyUrl = process.env.JUDGE0_API_URL || "";
    if (runtime === "extra") {
        return process.env.JUDGE0_EXTRA_CE_URL || (legacyUrl.includes("extra") ? legacyUrl : "") || "https://judge0-extra-ce.p.rapidapi.com";
    }
    return process.env.JUDGE0_CE_URL || (legacyUrl && !legacyUrl.includes("extra") ? legacyUrl : "") || "https://judge0-ce.p.rapidapi.com";
}
function getJudge0Key(): string {
    return process.env.JUDGE0_API_KEY || "";
}
function getJudge0Host(runtime: Judge0Runtime = getSqlJudge0Runtime()): string {
    const legacyHost = process.env.JUDGE0_HOST || "";
    if (runtime === "extra") {
        return process.env.JUDGE0_EXTRA_CE_HOST || (legacyHost.includes("extra") ? legacyHost : "") || new URL(getJudge0Url(runtime)).hostname;
    }
    return process.env.JUDGE0_CE_HOST || (legacyHost && !legacyHost.includes("extra") ? legacyHost : "") || new URL(getJudge0Url(runtime)).hostname;
}

function isSubscriptionFailure(err: unknown): boolean {
    const message = String((err as any)?.message || err || "").toLowerCase();
    return message.includes("not subscribed") || message.includes("subscription") || message.includes("401") || message.includes("403");
}

function isLanguageRuntimeFailure(err: unknown): boolean {
    const message = String((err as any)?.message || err || "").toLowerCase();
    return message.includes("language_id") || message.includes("language with id") || message.includes("doesn't exist");
}

function getHeaders(runtime: Judge0Runtime = getSqlJudge0Runtime()): Record<string, string> {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    const key = getJudge0Key();
    if (key) {
        headers["x-rapidapi-key"] = key;
        headers["x-rapidapi-host"] = getJudge0Host(runtime);
    }
    return headers;
}

function toBase64(str: string): string {
    return Buffer.from(str).toString("base64");
}
function fromBase64(str: string | null | undefined): string {
    if (!str) return "";
    try { return Buffer.from(str, "base64").toString("utf-8"); } catch { return str; }
}
function sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
}

export const SQLITE_LANGUAGE_ID = 82;
const PYTHON_LANGUAGE_ID = 71;
const MAX_RETRIES = 5;
const RETRY_BASE_MS = 3000;
const POLL_DELAY_MS = 500;
const POLL_TIMEOUT_MS = 60000;

function getLanguageId(runtime: Judge0Runtime): number {
    if (runtime === "extra") {
        return Number(process.env.SQL_JUDGE0_EXTRA_LANGUAGE_ID || process.env.JUDGE0_EXTRA_SQL_LANGUAGE_ID || PYTHON_LANGUAGE_ID);
    }
    return Number(process.env.SQL_JUDGE0_CE_LANGUAGE_ID || process.env.JUDGE0_SQL_LANGUAGE_ID || SQLITE_LANGUAGE_ID);
}

function stripSqliteDotCommands(sourceCode: string): string {
    return sourceCode
        .split(/\r?\n/)
        .filter((line) => !line.trim().startsWith("."))
        .join("\n");
}

function buildPythonSqliteRunner(sourceCode: string): string {
    const sqlJson = JSON.stringify(stripSqliteDotCommands(sourceCode));
    return [
        "import sqlite3",
        "import sys",
        "",
        `sql_script = ${sqlJson}`,
        "",
        "def split_sql(script):",
        "    statements = []",
        "    buffer = ''",
        "    for line in script.splitlines():",
        "        stripped = line.strip()",
        "        if not stripped:",
        "            continue",
        "        buffer += line + '\\n'",
        "        if sqlite3.complete_statement(buffer):",
        "            statements.append(buffer.strip())",
        "            buffer = ''",
        "    if buffer.strip():",
        "        statements.append(buffer.strip())",
        "    return statements",
        "",
        "def cell(value):",
        "    if value is None:",
        "        return 'NULL'",
        "    return str(value)",
        "",
        "try:",
        "    conn = sqlite3.connect(':memory:')",
        "    cur = conn.cursor()",
        "    last_headers = None",
        "    last_rows = None",
        "    for stmt in split_sql(sql_script):",
        "        cur.execute(stmt)",
        "        if cur.description:",
        "            last_headers = [col[0] for col in cur.description]",
        "            last_rows = cur.fetchall()",
        "        else:",
        "            conn.commit()",
        "    if last_headers is not None:",
        "        print('\\t'.join(last_headers))",
        "        for row in last_rows or []:",
        "            print('\\t'.join(cell(v) for v in row))",
        "except Exception as exc:",
        "    print(str(exc), file=sys.stderr)",
        "    sys.exit(1)",
        "",
    ].join("\n");
}

function prepareSubmissionSource(sourceCode: string, runtime: Judge0Runtime): string {
    return runtime === "extra" ? buildPythonSqliteRunner(sourceCode) : sourceCode;
}

// ── Submit a single SQL script to Judge0 ───────────────────────────────

async function submitSql(sourceCode: string, runtime: Judge0Runtime): Promise<string> {
    const headers = getHeaders(runtime);
    const submissionSource = prepareSubmissionSource(sourceCode, runtime);
    const languageId = getLanguageId(runtime);

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        console.log(`[SqlExec] Submitting SQL to Judge0 ${runtime} (language ${languageId}, attempt ${attempt + 1})...`);

        const res = await fetchIPv4(
            `${getJudge0Url(runtime)}/submissions/batch?base64_encoded=true`,
            {
                method: "POST",
                headers,
                body: JSON.stringify({
                    submissions: [{
                        source_code: toBase64(submissionSource),
                        language_id: languageId,
                        stdin: null,
                        cpu_time_limit: 5,
                        memory_limit: 262144,
                        max_output_size: 65536,
                    }],
                }),
            }
        );

        if (res.ok) {
            const data = (await res.json()) as { token: string }[];
            if (!data || data.length === 0 || !data[0]?.token) throw new Error("Invalid response from Judge0");
            console.log(`[SqlExec] Submitted, token: ${data[0].token}`);
            return data[0].token;
        }

        if (res.status === 429 && attempt < MAX_RETRIES) {
            const delay = RETRY_BASE_MS * (attempt + 1);
            console.warn(`[SqlExec] 429 rate limited, waiting ${delay}ms...`);
            await sleep(delay);
            continue;
        }

        const errText = await res.text();
        throw new Error(`SQL execution failed (${res.status}): ${errText}`);
    }
    throw new Error("SQL execution failed after retries.");
}

// ── Poll for a single token result ─────────────────────────────────────

async function pollToken(token: string, runtime: Judge0Runtime): Promise<{
    stdout: string;
    stderr: string;
    compileOutput: string;
    status: { id: number; description: string };
    time: string;
    memory: number;
}> {
    const headers = getHeaders(runtime);
    const startTime = Date.now();
    let delay = POLL_DELAY_MS;

    while (Date.now() - startTime < POLL_TIMEOUT_MS) {
        let res: Response;
        try {
            res = await fetchIPv4(
                `${getJudge0Url(runtime)}/submissions/batch?tokens=${token}&base64_encoded=true&fields=*`,
                { method: "GET", headers }
            );
        } catch {
            await sleep(delay);
            delay = Math.min(delay * 1.5, 8000);
            continue;
        }

        if (res.status === 429) {
            await sleep(RETRY_BASE_MS * 2);
            continue;
        }
        if (!res.ok) {
            delay = Math.min(delay * 1.5, 8000);
            continue;
        }

        const data = (await res.json()) as { submissions: any[] };
        const sub = data.submissions[0];
        const statusId = sub.status?.id;

        // 1=In Queue, 2=Processing → wait and keep polling
        if (statusId === 1 || statusId === 2) {
            await sleep(delay);
            continue;
        }

        return {
            stdout: fromBase64(sub.stdout),
            stderr: fromBase64(sub.stderr),
            compileOutput: fromBase64(sub.compile_output),
            status: sub.status,
            time: sub.time || "0",
            memory: sub.memory || 0,
        };
    }
    throw new Error("SQL execution timed out.");
}

// ── Normalize SQL output for comparison ────────────────────────────────
// Trims whitespace, normalizes line endings, and sorts rows for
// order-insensitive comparison (SQL results often aren't ordered).
function normalizeOutput(raw: string): string {
    return raw
        .trim()
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
        .sort()
        .join("\n");
}

// ── Build the full script sent to Judge0 ───────────────────────────────
// Injects .headers/.mode pragmas so SQLite output is human-readable.

function buildFullScript(wrapperCode: any, queryCode: any): string {
    const safeWrapper = typeof wrapperCode === 'string' ? wrapperCode : "";

    let safeQuery = "";
    if (typeof queryCode === 'string') {
        safeQuery = queryCode;
    } else if (queryCode && typeof queryCode === 'object') {
        // If solution is mapped per-language (e.g., { sqlite: "..." })
        safeQuery = Object.values(queryCode)[0] as string || "";
    } else if (queryCode !== undefined && queryCode !== null) {
        safeQuery = String(queryCode);
    }

    if (typeof safeQuery !== 'string') safeQuery = "";

    const pragmas = ".headers on\n.mode column";
    const injection = `${pragmas}\n\n${safeQuery.trim()}`;

    if (safeWrapper.includes("{{USER_QUERY}}")) {
        return safeWrapper.replace("{{USER_QUERY}}", injection);
    }

    return [
        safeWrapper.trim(),
        "",
        pragmas,
        "",
        safeQuery.trim()
    ].join("\n");
}

async function executeSql(sourceCode: string) {
    const primary = getSqlJudge0Runtime();
    try {
        const token = await submitSql(sourceCode, primary);
        return await pollToken(token, primary);
    } catch (err) {
        if (primary === "standard" && (isSubscriptionFailure(err) || isLanguageRuntimeFailure(err))) {
            console.warn("[SqlExec] Standard Judge0 CE unavailable for SQL; retrying on Judge0 CE Extra via Python sqlite3.");
            const token = await submitSql(sourceCode, "extra");
            return pollToken(token, "extra");
        }
        throw err;
    }
}

// Global cache to avoid re-running Judge0 logic for expected outputs across runs.
// Judge0 produces raw text tabular formatting which we must exactly match.
export const LOCAL_EXPECTED_OUTPUT_CACHE = new Map<string, string>();

// ════════════════════════════════════════════════════════════════════════
// PUBLIC API
// ════════════════════════════════════════════════════════════════════════

export interface SqlRunResult {
    success: boolean;
    passed: boolean;
    actualOutput: string;
    expectedOutput: string;
    error?: string;
    stderr?: string;
    time?: string;
    memory?: number;
}

/**
 * Run a SQL query against Judge0 SQLite and compare output.
 *
 * @param wrapperCode    - DDL + DML to set up the database (CREATE TABLE, INSERT, etc.)
 * @param userCode       - The user's SQL query
 * @param expectedOutput - The expected query result (stdout from running the solution)
 */
export async function runSqlQuery(
    wrapperCode: string,
    userCode: string,
    expectedOutput: string,
): Promise<SqlRunResult> {
    const fullScript = buildFullScript(wrapperCode, userCode);

    console.log(`[SqlExec] Full script length: ${fullScript.length} chars`);

    try {
        const result = await executeSql(fullScript);

        // Status 3 = Accepted (ran successfully)
        if (result.status.id !== 3) {
            return {
                success: true,
                passed: false,
                actualOutput: result.stderr || result.compileOutput || result.status.description,
                expectedOutput,
                error: result.stderr || result.compileOutput || `Execution error: ${result.status.description}`,
                stderr: result.stderr,
                time: result.time,
                memory: result.memory,
            };
        }

        const passed = normalizeOutput(result.stdout) === normalizeOutput(expectedOutput);

        return {
            success: true,
            passed,
            actualOutput: result.stdout.trim(),
            expectedOutput: expectedOutput.trim(),
            time: result.time,
            memory: result.memory,
        };
    } catch (err: any) {
        return {
            success: false,
            passed: false,
            actualOutput: "",
            expectedOutput,
            error: err.message || "SQL execution failed",
        };
    }
}

/**
 * Run the solution SQL to generate the expected output.
 * Used once at question-load time to capture the correct answer.
 */
export async function generateExpectedOutput(
    wrapperCode: string,
    solutionCode: string,
): Promise<string> {
    const fullScript = buildFullScript(wrapperCode, solutionCode);

    const result = await executeSql(fullScript);

    if (result.status.id !== 3) {
        throw new Error(`Solution execution failed: ${result.stderr || result.status.description}`);
    }

    return result.stdout.trim();
}

/**
 * Asynchronously pre-warms the expected output cache for all test cases
 * of a given question to remove the cold-cache execution penalty.
 */
export async function warmSqlCache(
    questionId: string,
    solution: string,
    hiddenTestCases: any[]
): Promise<void> {
    try {
        console.log(`[SqlExec] Async warming expected output cache for question: ${questionId}`);
        const promises = hiddenTestCases.map(async (tc) => {
            const cacheKey = `${questionId}_${tc.id || "test"}`;
            if (!LOCAL_EXPECTED_OUTPUT_CACHE.has(cacheKey)) {
                const out = await generateExpectedOutput(tc.wrapper_code, solution);
                LOCAL_EXPECTED_OUTPUT_CACHE.set(cacheKey, out);
            }
        });
        await Promise.allSettled(promises);
        console.log(`[SqlExec] Cache warming completed for question: ${questionId}`);
    } catch (err) {
        console.error(`[SqlExec] Background cache warm failed for ${questionId}:`, err);
    }
}

// ════════════════════════════════════════════════════════════════════════
// BATCH EXECUTION API
// ════════════════════════════════════════════════════════════════════════

export async function submitBatchSql(sourceCodes: string[], runtime: Judge0Runtime = getSqlJudge0Runtime()): Promise<string[]> {
    const headers = getHeaders(runtime);
    const languageId = getLanguageId(runtime);

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        console.log(`[SqlExec] Submitting batch of ${sourceCodes.length} to Judge0 ${runtime} (language ${languageId}, attempt ${attempt + 1})...`);

        const res = await fetchIPv4(
            `${getJudge0Url(runtime)}/submissions/batch?base64_encoded=true`,
            {
                method: "POST",
                headers,
                body: JSON.stringify({
                    submissions: sourceCodes.map(sc => ({
                        source_code: toBase64(prepareSubmissionSource(sc, runtime)),
                        language_id: languageId,
                        stdin: null,
                        cpu_time_limit: 5,
                        memory_limit: 262144,
                        max_output_size: 65536,
                    })),
                }),
            }
        );

        if (res.ok) {
            const data = (await res.json()) as { token: string }[];
            console.log(`[SqlExec] Batch submitted, ${data.length} tokens received.`);
            return data.map(d => d.token);
        }

        if (res.status === 429 && attempt < MAX_RETRIES) {
            const delay = RETRY_BASE_MS * (attempt + 1);
            console.warn(`[SqlExec] 429 rate limited, waiting ${delay}ms...`);
            await sleep(delay);
            continue;
        }

        const errText = await res.text();
        throw new Error(`SQL batch execution failed (${res.status}): ${errText}`);
    }
    throw new Error("SQL batch execution failed after retries.");
}

export async function pollBatchTokens(tokens: string[], runtime: Judge0Runtime = getSqlJudge0Runtime()): Promise<{
    stdout: string;
    stderr: string;
    compileOutput: string;
    status: { id: number; description: string };
    time: string;
    memory: number;
}[]> {
    const headers = getHeaders(runtime);
    const startTime = Date.now();
    // Start with a small 500ms delay for batches too
    let delay = Math.max(POLL_DELAY_MS, 500);

    const tokenStr = tokens.join(",");

    while (Date.now() - startTime < POLL_TIMEOUT_MS) {
        let res: Response;
        try {
            res = await fetchIPv4(
                `${getJudge0Url(runtime)}/submissions/batch?tokens=${tokenStr}&base64_encoded=true&fields=*`,
                { method: "GET", headers }
            );
        } catch {
            await sleep(delay);
            delay = Math.min(delay * 1.5, 8000);
            continue;
        }

        if (res.status === 429) {
            await sleep(RETRY_BASE_MS * 2);
            continue;
        }
        if (!res.ok) {
            delay = Math.min(delay * 1.5, 8000);
            continue;
        }

        const data = (await res.json()) as { submissions: any[] };

        // Check if ALL submissions are completed (i.e. not in Queue=1 or Processing=2)
        const allDone = data.submissions.every(sub => {
            const statusId = sub.status?.id;
            return statusId !== 1 && statusId !== 2;
        });

        if (!allDone) {
            await sleep(delay);
            continue;
        }

        return data.submissions.map(sub => ({
            stdout: fromBase64(sub.stdout),
            stderr: fromBase64(sub.stderr),
            compileOutput: fromBase64(sub.compile_output),
            status: sub.status,
            time: sub.time || "0",
            memory: sub.memory || 0,
        }));
    }
    throw new Error("SQL batch execution timed out.");
}

export async function runBatchSqlQueries(
    testCases: { id: string; label: string; wrapperCode: string; expectedOutput: string }[],
    userCode: string,
): Promise<(SqlRunResult & { id: string; label: string })[]> {

    if (testCases.length === 0) return [];

    const fullScripts = testCases.map(tc => buildFullScript(tc.wrapperCode, userCode));

    console.log(`[SqlExec] Batch generating full scripts for ${fullScripts.length} test cases...`);

    try {
        const runtime = getSqlJudge0Runtime();
        let results: Awaited<ReturnType<typeof pollBatchTokens>>;

        try {
            results = await pollBatchTokens(await submitBatchSql(fullScripts, runtime), runtime);
        } catch (err) {
            if (runtime !== "standard" || (!isSubscriptionFailure(err) && !isLanguageRuntimeFailure(err))) {
                throw err;
            }

            console.warn("[SqlExec] Standard Judge0 CE unavailable for SQL batch; retrying on Judge0 CE Extra via Python sqlite3.");
            results = await pollBatchTokens(await submitBatchSql(fullScripts, "extra"), "extra");
        }

        return results.map((result, idx) => {
            const tc = testCases[idx];
            if (!tc) throw new Error(`Missing test case at index ${idx}`);
            const expectedOutput = tc.expectedOutput;

            if (result.status.id !== 3) {
                return {
                    id: tc.id,
                    label: tc.label,
                    success: true,
                    passed: false,
                    actualOutput: result.stderr || result.compileOutput || result.status.description,
                    expectedOutput,
                    error: result.stderr || result.compileOutput || `Execution error: ${result.status.description}`,
                    stderr: result.stderr,
                    time: result.time,
                    memory: result.memory,
                };
            }

            const passed = normalizeOutput(result.stdout) === normalizeOutput(expectedOutput);

            return {
                id: tc.id,
                label: tc.label,
                success: true,
                passed,
                actualOutput: result.stdout.trim(),
                expectedOutput: expectedOutput.trim(),
                time: result.time,
                memory: result.memory,
            };
        });
    } catch (err: any) {
        return testCases.map(tc => ({
            id: tc.id,
            label: tc.label,
            success: false,
            passed: false,
            actualOutput: "",
            expectedOutput: tc.expectedOutput,
            error: err.message || "SQL batch execution failed",
        }));
    }
}
