import { FastifyInstance } from "fastify";
import { z } from "zod";
import { checkRateLimit } from "../lib/rate-limiter.js";
import { connectMongoDB } from "../lib/mongodb.js";
import { DSAQuestion } from "../models/DSAQuestion.js";
import { GenAICodingQuestion } from "../models/GenAICodingQuestion.js";
import { normalizeDSAQuestion } from "../lib/question-helpers.js";
import { wrapCheckerCode } from "../services/code-execution.js";

// Fallback mapping (used if dynamic lookup fails or on server errors)
const JUDGE0_LANG_MAP: Record<string, number> = {
    java: 62,
    cpp: 54,
    python: 71,
    javascript: 93,
    typescript: 74,
    go: 60,
};

// Global in-memory cache for resolved language IDs: url -> { langKey -> resolvedId }
const resolvedLangsCache: Record<string, Record<string, number>> = {};

async function getLanguageId(language: string, judge0Url: string, apiKey?: string): Promise<number> {
    const langKey = language.toLowerCase();
    
    // Check in-memory cache first to avoid redundant API calls
    if (resolvedLangsCache[judge0Url]?.[langKey]) {
        return resolvedLangsCache[judge0Url][langKey];
    }
    
    try {
        const headers: Record<string, string> = {
            "Content-Type": "application/json",
        };
        if (apiKey) {
            headers["x-rapidapi-key"] = apiKey;
            headers["x-rapidapi-host"] = process.env.JUDGE0_CE_HOST || process.env.JUDGE0_HOST || new URL(judge0Url).hostname;
        }

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 4000);

        const res = await fetch(`${judge0Url}/languages`, { 
            headers,
            signal: controller.signal
        });
        clearTimeout(timeoutId);
        if (!res.ok) {
            throw new Error(`HTTP ${res.status} ${res.statusText}`);
        }
        
        const languages = (await res.json()) as Array<{ id: number; name: string }>;
        if (Array.isArray(languages) && languages.length > 0) {
            const mapped: Record<string, number> = {};
            
            const findBestMatch = (key: string, rawCandidates: Array<{ id: number; name: string }>) => {
                const nameContains = (name: string, str: string) => name.toLowerCase().includes(str.toLowerCase());
                const nameExcludes = (name: string, str: string) => !name.toLowerCase().includes(str.toLowerCase());
                
                // Filter out MPI/OpenRTE and testing frameworks globally to avoid runtime issues
                const candidates = rawCandidates.filter(c => 
                    nameExcludes(c.name, "mpi") && 
                    nameExcludes(c.name, "test") && 
                    nameExcludes(c.name, "openrte")
                );
                
                if (key === "cpp") {
                    const gcc = candidates.find(c => nameContains(c.name, "C++ (GCC") && nameExcludes(c.name, "mpi") && nameExcludes(c.name, "test"));
                    if (gcc) return gcc.id;
                    const clang = candidates.find(c => nameContains(c.name, "C++ (Clang") && nameExcludes(c.name, "mpi") && nameExcludes(c.name, "test"));
                    if (clang) return clang.id;
                    const plain = candidates.find(c => nameContains(c.name, "C++") && nameExcludes(c.name, "test") && nameExcludes(c.name, "mpi"));
                    if (plain) return plain.id;
                    const anyCpp = candidates.find(c => nameContains(c.name, "C++") && nameExcludes(c.name, "test") && nameExcludes(c.name, "mpi"));
                    if (anyCpp) return anyCpp.id;
                }
                
                if (key === "python") {
                    const py3 = candidates.find(c => nameContains(c.name, "Python (3.") || nameContains(c.name, "Python 3."));
                    if (py3) return py3.id;
                    const pyML = candidates.find(c => nameContains(c.name, "Python for ML"));
                    if (pyML) return pyML.id;
                    const pyPy = candidates.find(c => nameContains(c.name, "Python") && nameContains(c.name, "3."));
                    if (pyPy) return pyPy.id;
                    const anyPy = candidates.find(c => nameContains(c.name, "Python"));
                    if (anyPy) return anyPy.id;
                }
                
                if (key === "java") {
                    const plainJava = candidates.find(c => nameContains(c.name, "Java (") && nameExcludes(c.name, "test") && nameExcludes(c.name, "javascript") && nameExcludes(c.name, "javafx"));
                    if (plainJava) return plainJava.id;
                    const anyJava = candidates.find(c => nameContains(c.name, "Java") && nameExcludes(c.name, "javascript"));
                    if (anyJava) return anyJava.id;
                }
                
                if (key === "javascript") {
                    const node = candidates.find(c => nameContains(c.name, "JavaScript (Node") || nameContains(c.name, "Node.js"));
                    if (node) return node.id;
                    const anyJS = candidates.find(c => nameContains(c.name, "JavaScript"));
                    if (anyJS) return anyJS.id;
                }
                
                if (key === "typescript") {
                    const ts = candidates.find(c => nameContains(c.name, "TypeScript"));
                    if (ts) return ts.id;
                }
                
                if (key === "go") {
                    const go = candidates.find(c => nameContains(c.name, "Go (") || nameContains(c.name, "Golang"));
                    if (go) return go.id;
                }
                
                return null;
            };

            for (const key of Object.keys(JUDGE0_LANG_MAP)) {
                const matchedId = findBestMatch(key, languages);
                if (matchedId !== null) {
                    mapped[key] = matchedId;
                } else {
                    mapped[key] = JUDGE0_LANG_MAP[key];
                }
            }
            
            resolvedLangsCache[judge0Url] = mapped;
            
            if (mapped[langKey]) {
                return mapped[langKey];
            }
        }
    } catch (err) {
        console.error(`Error resolving Judge0 languages dynamically from ${judge0Url}:`, err);
    }
    
    // Default fallback
    return JUDGE0_LANG_MAP[langKey] || JUDGE0_LANG_MAP.cpp;
}

function getJudge0UrlForLanguage(language: string): { url: string; host: string } {
    const lang = language.toLowerCase();
    const isJsOrTs = lang === "javascript" || lang === "typescript";
    
    // If it's JS or TS, it MUST run on standard CE (judge0-ce)
    if (isJsOrTs) {
        const url = process.env.JUDGE0_CE_URL || "https://judge0-ce.p.rapidapi.com";
        const host = process.env.JUDGE0_CE_HOST || new URL(url).hostname;
        return { url, host };
    }
    
    // For other languages, use standard CE if configured, otherwise fallback to API_URL (which can be extra-ce or ce)
    const url = process.env.JUDGE0_CE_URL || process.env.JUDGE0_API_URL || "https://judge0-extra-ce.p.rapidapi.com";
    const host = process.env.JUDGE0_CE_HOST || process.env.JUDGE0_HOST || new URL(url).hostname;
    return { url, host };
}

// Environment variables will be read inside the execution function
// to ensure we always get the latest values without needing a full server restart
// or dealing with module-level caching.

const runCodeSchema = z.object({
    questionId: z.string().min(1),
    language: z.string(),
    code: z.string(),
    runHiddenTests: z.boolean().default(false),
});

const testRunSchema = z.object({
    language: z.string(),
    code: z.string(),
    timeLimit: z.coerce.number().min(0.1).max(5).optional(),
    memoryLimit: z.coerce.number().int().min(16).max(256).optional(),
    testCases: z.array(z.object({
        id: z.string(),
        input: z.string(),
        expected: z.string(),
        type: z.enum(["sample", "hidden", "edge"]).optional()
    })).min(1, "At least one test case is required"),
    // Optional custom checker (special judge) for previewing draft questions
    // with multiple valid outputs.
    checker: z.object({
        language: z.string(),
        code: z.string().max(60000),
    }).optional().nullable(),
});

interface Judge0Response {
    stdout: string | null;
    stderr: string | null;
    compile_output: string | null;
    status: { id: number; description: string };
    time: string | null;
    memory: number | null;
}

const MAX_CPU_TIME_LIMIT = 5;
const DEFAULT_MAX_OUTPUT_SIZE = 1048576;

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

function clampCpuTimeLimit(value: number): number {
    return Math.min(MAX_CPU_TIME_LIMIT, Math.max(0.1, value));
}

function clampMemoryLimitKb(value: number): number {
    return Math.max(16 * 1024, Math.min(256 * 1024, Math.round(value)));
}

function getJudge0MaxOutputSize(): number {
    return Math.max(
        131072,
        Number.parseInt(process.env.JUDGE0_MAX_OUTPUT_SIZE || String(DEFAULT_MAX_OUTPUT_SIZE), 10) || DEFAULT_MAX_OUTPUT_SIZE
    );
}

type Judge0LimitOverrides = {
    timeLimit?: number;
    memoryLimit?: number;
};

function getJudge0LimitFields(overrides: Judge0LimitOverrides = {}) {
    const cpuTimeLimit = clampCpuTimeLimit(overrides.timeLimit ?? getPositiveEnvNumber(
        ["JUDGE0_DSA_CPU_TIME_LIMIT_SECONDS", "JUDGE0_CPU_TIME_LIMIT_SECONDS"],
        2
    ));
    const cpuExtraTime = getOptionalEnvNumber([
        "JUDGE0_DSA_CPU_EXTRA_TIME_SECONDS",
        "JUDGE0_CPU_EXTRA_TIME_SECONDS",
    ]);
    const wallTimeLimit = getOptionalEnvNumber([
        "JUDGE0_DSA_WALL_TIME_LIMIT_SECONDS",
        "JUDGE0_WALL_TIME_LIMIT_SECONDS",
    ]) ?? Math.max(cpuTimeLimit + 2, cpuTimeLimit * 2);
    const memoryLimit = clampMemoryLimitKb(overrides.memoryLimit
        ? overrides.memoryLimit * 1024
        : getPositiveEnvNumber(
            ["JUDGE0_DSA_MEMORY_LIMIT_KB", "JUDGE0_MEMORY_LIMIT_KB"],
            262144
        ));
    const timePerProcess = getOptionalEnvBoolean([
        "JUDGE0_DSA_ENABLE_PER_PROCESS_AND_THREAD_TIME_LIMIT",
        "JUDGE0_ENABLE_PER_PROCESS_AND_THREAD_TIME_LIMIT",
    ]);
    const memoryPerProcess = getOptionalEnvBoolean([
        "JUDGE0_DSA_ENABLE_PER_PROCESS_AND_THREAD_MEMORY_LIMIT",
        "JUDGE0_ENABLE_PER_PROCESS_AND_THREAD_MEMORY_LIMIT",
    ]);

    return {
        cpu_time_limit: cpuTimeLimit,
        ...(cpuExtraTime !== undefined ? { cpu_extra_time: cpuExtraTime } : {}),
        wall_time_limit: wallTimeLimit,
        memory_limit: memoryLimit,
        max_output_size: getJudge0MaxOutputSize(),
        enable_network: false,
        ...(timePerProcess !== undefined ? { enable_per_process_and_thread_time_limit: timePerProcess } : {}),
        ...(memoryPerProcess !== undefined ? { enable_per_process_and_thread_memory_limit: memoryPerProcess } : {}),
    };
}

async function executeOnJudge0(
    code: string,
    languageId: number,
    stdin: string,
    judge0Url: string,
    host: string
): Promise<Judge0Response> {
    const payload = {
        source_code: Buffer.from(code).toString("base64"),
        language_id: languageId,
        stdin: Buffer.from(stdin).toString("base64"),
        base64_encoded: true,
        wait: true,
        ...getJudge0LimitFields(),
    };

    const headers: Record<string, string> = {
        "Content-Type": "application/json",
    };
    if (process.env.JUDGE0_API_KEY) {
        headers["x-rapidapi-key"] = process.env.JUDGE0_API_KEY;
        headers["x-rapidapi-host"] = host;
    }

    const response = await fetch(
        `${judge0Url}/submissions?base64_encoded=true&wait=true`,
        {
            method: "POST",
            headers,
            body: JSON.stringify(payload),
        }
    );

    if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Judge0 API error (${response.status}): ${errText}`);
    }

    const result = (await response.json()) as Judge0Response;

    // Decode base64 fields
    if (result.stdout) {
        result.stdout = Buffer.from(result.stdout, "base64").toString("utf-8");
    }
    if (result.stderr) {
        result.stderr = Buffer.from(result.stderr, "base64").toString("utf-8");
    }
    if (result.compile_output) {
        result.compile_output = Buffer.from(result.compile_output, "base64").toString("utf-8");
    }

    return result;
}

async function executeBatchOnJudge0(
    code: string,
    languageId: number,
    inputs: string[],
    judge0Url: string,
    host: string,
    limits?: Judge0LimitOverrides
): Promise<Judge0Response[]> {
    const headers: Record<string, string> = {
        "Content-Type": "application/json",
    };
    const apiKey = process.env.JUDGE0_API_KEY;
    if (apiKey) {
        headers["x-rapidapi-key"] = apiKey;
        headers["x-rapidapi-host"] = host;
    }

    const submissions = inputs.map(stdin => ({
        source_code: Buffer.from(code).toString("base64"),
        language_id: languageId,
        stdin: Buffer.from(stdin).toString("base64"),
        ...getJudge0LimitFields(limits),
    }));

    // Submit all submissions in a single batch request
    const response = await fetch(
        `${judge0Url}/submissions/batch?base64_encoded=true`,
        {
            method: "POST",
            headers,
            body: JSON.stringify({ submissions }),
        }
    );

    if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Judge0 Batch API error (${response.status}): ${errText}`);
    }

    const tokensData = (await response.json()) as { token: string }[];
    const tokens = tokensData.map(t => t.token);

    // Poll for the batch results
    const tokenStr = tokens.join(",");
    const startTime = Date.now();
    const pollTimeoutMs = 12000;
    let delay = 1000;

    while (Date.now() - startTime < pollTimeoutMs) {
        await new Promise(resolve => setTimeout(resolve, delay));

        const pollRes = await fetch(
            `${judge0Url}/submissions/batch?tokens=${tokenStr}&base64_encoded=true&fields=stdout,stderr,compile_output,status,time,memory`,
            {
                method: "GET",
                headers,
            }
        );

        if (!pollRes.ok) {
            delay = Math.min(delay * 1.5, 3000);
            continue;
        }

        const pollData = (await pollRes.json()) as { submissions: Judge0Response[] };
        const results = pollData.submissions;

        const allDone = results.every(
            r => r.status && r.status.id !== 1 && r.status.id !== 2
        );

        if (allDone) {
            for (const result of results) {
                if (result.stdout) result.stdout = Buffer.from(result.stdout, "base64").toString("utf-8");
                if (result.stderr) result.stderr = Buffer.from(result.stderr, "base64").toString("utf-8");
                if (result.compile_output) result.compile_output = Buffer.from(result.compile_output, "base64").toString("utf-8");
            }
            return results;
        }

        delay = Math.min(delay * 1.2, 2000);
    }

    throw new Error("Batch execution timed out on Judge0");
}

async function executeAllInputs(
    code: string,
    languageId: number,
    inputs: string[],
    judge0Url: string,
    host: string,
    limits?: Judge0LimitOverrides
): Promise<Judge0Response[]> {
    const maxBatchSize = 20; // Judge0 standard batch limit
    const batches: string[][] = [];
    for (let i = 0; i < inputs.length; i += maxBatchSize) {
        batches.push(inputs.slice(i, i + maxBatchSize));
    }

    const batchPromises = batches.map(batch => executeBatchOnJudge0(code, languageId, batch, judge0Url, host, limits));
    const batchResults = await Promise.all(batchPromises);
    return batchResults.flat();
}

export default async function codeExecutionRoutes(fastify: FastifyInstance) {
    // All routes require authentication
    fastify.addHook("preHandler", fastify.authenticate);

    // ─── Run Code Against Test Cases ──────────────────────────
    fastify.post("/code/test-run", async (request, reply) => {
        const rl = checkRateLimit(`code:testrun:${request.user!.id}`, 30, 300_000);
        if (!rl.allowed) {
            return reply.status(429).send({
                error: "Too Many Requests",
                message: `Code execution limit reached. Please wait ${Math.ceil(rl.retryAfterMs / 1000)}s before running again.`,
            });
        }

        const parsed = testRunSchema.safeParse(request.body);
        if (!parsed.success) {
            return reply.status(400).send({
                error: "Validation Error",
                details: parsed.error.flatten().fieldErrors,
            });
        }

        const { language, code, testCases, timeLimit, memoryLimit, checker } = parsed.data;
        const mappedLang = language === "python3" ? "python" : language.toLowerCase();
        
        if (!JUDGE0_LANG_MAP[mappedLang]) {
            return reply.status(400).send({
                error: "Unsupported Language",
                message: `Language "${language}" is not supported. Use: ${Object.keys(JUDGE0_LANG_MAP).join(", ")}`,
            });
        }

        const { url: judge0Url, host } = getJudge0UrlForLanguage(mappedLang);
        const languageId = await getLanguageId(mappedLang, judge0Url, process.env.JUDGE0_API_KEY);

        let allPassed = true;
        let totalRuntimeMs = 0;
        let maxRuntimeMs = 0;
        let maxMemoryKb = 0;
        const results = [];

        try {
            const inputs = testCases.map(tc => tc.input);
            const judge0Results = await executeAllInputs(code, languageId, inputs, judge0Url, host, { timeLimit, memoryLimit });

            // Custom checker: run the checker (once per ran test) and record its
            // verdict so the exact-match comparison below is overridden.
            const checkerVerdict = new Map<number, boolean>();
            if (checker && checker.code) {
                const checkerLang = checker.language === "python3" ? "python" : checker.language.toLowerCase();
                if (JUDGE0_LANG_MAP[checkerLang]) {
                    const { url: cUrl, host: cHost } = getJudge0UrlForLanguage(checkerLang);
                    const cLangId = await getLanguageId(checkerLang, cUrl, process.env.JUDGE0_API_KEY);
                    const idxToRun: number[] = [];
                    const checkerInputs: string[] = [];
                    for (let i = 0; i < testCases.length; i++) {
                        if (judge0Results[i]?.status.id === 3) {
                            idxToRun.push(i);
                            checkerInputs.push(
                                `${testCases[i].input}\n===OUTPUT===\n${(judge0Results[i].stdout || "").trim()}\n===EXPECTED===\n${testCases[i].expected.trim()}\n`
                            );
                        }
                    }
                    if (checkerInputs.length > 0) {
                        const checkerSource = wrapCheckerCode(checker.code, checker.language);
                        const checkerResults = await executeAllInputs(checkerSource, cLangId, checkerInputs, cUrl, cHost, { timeLimit, memoryLimit });
                        for (let k = 0; k < idxToRun.length; k++) {
                            const token = (checkerResults[k]?.stdout || "").trim().split(/\s+/)[0]?.toLowerCase() || "";
                            checkerVerdict.set(idxToRun[k], token === "1" || token === "ok" || token === "yes" || token === "ac" || token === "accepted");
                        }
                    }
                }
            }

            for (let i = 0; i < testCases.length; i++) {
                const tc = testCases[i];
                const resObj = judge0Results[i];

                const runtimeMs = resObj.time
                    ? Math.round(parseFloat(resObj.time) * 1000)
                    : 0;
                totalRuntimeMs += runtimeMs;
                maxRuntimeMs = Math.max(maxRuntimeMs, runtimeMs);
                maxMemoryKb = Math.max(maxMemoryKb, Number(resObj.memory || 0));

                const actualOutput = (resObj.stdout || "").trim();
                const expectedOutput = tc.expected.trim();
                const passed = resObj.status.id === 3 && (
                    checker && checker.code ? (checkerVerdict.get(i) ?? false) : actualOutput === expectedOutput
                );

                let status: string;
                if (resObj.status.id === 6) status = "CE";
                else if (resObj.status.id === 5) status = "TLE";
                else if (/memory/i.test(resObj.status.description || "")) status = "MLE";
                else if (resObj.status.id >= 7 && resObj.status.id <= 12) status = "RE";
                else if (passed) status = "AC";
                else status = "WA";

                if (!passed) allPassed = false;

                results.push({
                    testCaseId: tc.id,
                    input: tc.input,
                    expected: expectedOutput,
                    actual: actualOutput,
                    passed,
                    runtimeMs,
                    memory: resObj.memory ?? null,
                    type: tc.type || "sample",
                    status,
                    stderr: resObj.stderr || null,
                    compileOutput: resObj.compile_output || null,
                });
            }
        } catch (err: unknown) {
            allPassed = false;
            const errorMessage = err instanceof Error ? err.message : "Unknown execution error";
            for (const tc of testCases) {
                results.push({
                    testCaseId: tc.id,
                    input: tc.input,
                    expected: tc.expected.trim(),
                    actual: "",
                    passed: false,
                    runtimeMs: 0,
                    memory: null,
                    type: tc.type || "sample",
                    status: "RE",
                    stderr: errorMessage,
                    compileOutput: null,
                });
            }
        }

        return reply.send({
            allPassed,
            totalRuntimeMs,
            maxRuntimeMs,
            maxMemoryKb,
            totalTests: testCases.length,
            passedTests: results.filter((r) => r.passed).length,
            results,
        });
    });

    fastify.post("/code/run", async (request, reply) => {
        // Rate limit: 15 executions per 5 minutes per user
        const rl = checkRateLimit(`code:run:${request.user!.id}`, 15, 300_000);
        if (!rl.allowed) {
            return reply.status(429).send({
                error: "Too Many Requests",
                message: `Code execution limit reached. Please wait ${Math.ceil(rl.retryAfterMs / 1000)}s before running again.`,
            });
        }

        const parsed = runCodeSchema.safeParse(request.body);
        if (!parsed.success) {
            return reply.status(400).send({
                error: "Validation Error",
                details: parsed.error.flatten().fieldErrors,
            });
        }

        const { questionId, language, code, runHiddenTests } = parsed.data;

        // Validate language
        const mappedLang = language === "python3" ? "python" : language.toLowerCase();
        if (!JUDGE0_LANG_MAP[mappedLang]) {
            return reply.status(400).send({
                error: "Unsupported Language",
                message: `Language "${language}" is not supported. Use: ${Object.keys(JUDGE0_LANG_MAP).join(", ")}`,
            });
        }

        const { url: judge0Url, host } = getJudge0UrlForLanguage(mappedLang);
        const languageId = await getLanguageId(mappedLang, judge0Url, process.env.JUDGE0_API_KEY);

        // Fetch test cases from Mongo-backed question bank.
        await connectMongoDB();

        // ── GenAI Coding path ─────────────────────────────────────────────────
        // GenAI coding questions store descriptive test cases (not binary stdin/stdout)
        // so we run the code as-is and return raw stdout. No pass/fail comparison.
        let genAIQuestion = null;
        try {
            genAIQuestion = await GenAICodingQuestion.findById(questionId).lean();
        } catch {
            genAIQuestion = null;
        }

        if (genAIQuestion) {
            // Execute via Judge0 — no stdin, just run the full code block
            try {
                const result = await executeOnJudge0(code, languageId, "", judge0Url, host);
                const stdout = result.stdout || "";
                const stderr = result.stderr || "";
                const compileOutput = result.compile_output || "";

                // Judge0 status codes: 3=Accepted, 6=CE, 5=TLE, 7-12=RE
                let status: "AC" | "CE" | "RE" | "TLE" | "WA";
                if (result.status.id === 6) status = "CE";
                else if (result.status.id === 5) status = "TLE";
                else if (result.status.id >= 7 && result.status.id <= 12) status = "RE";
                else status = "AC";

                const runtimeMs = result.time ? Math.round(parseFloat(result.time) * 1000) : 0;

                return reply.send({
                    allPassed: status === "AC",
                    totalRuntimeMs: runtimeMs,
                    totalTests: 1,
                    passedTests: status === "AC" ? 1 : 0,
                    results: [
                        {
                            testCaseId: "run",
                            input: "(code executed as-is)",
                            expected: "(descriptive — see problem statement)",
                            actual: stdout,
                            passed: status === "AC",
                            runtimeMs,
                            type: "sample" as const,
                            status,
                            stderr: stderr || null,
                            compileOutput: compileOutput || null,
                        },
                    ],
                });
            } catch (err: unknown) {
                const errorMessage = err instanceof Error ? err.message : "Unknown execution error";
                return reply.send({
                    allPassed: false,
                    totalRuntimeMs: 0,
                    totalTests: 1,
                    passedTests: 0,
                    results: [
                        {
                            testCaseId: "run",
                            input: "(code executed as-is)",
                            expected: "(descriptive — see problem statement)",
                            actual: "",
                            passed: false,
                            runtimeMs: 0,
                            type: "sample" as const,
                            status: "RE",
                            stderr: errorMessage,
                            compileOutput: null,
                        },
                    ],
                });
            }
        }

        // ── DSA path ─────────────────────────────────────────────────────────
        let dsaQuestion = null;
        try {
            dsaQuestion = await DSAQuestion.findById(questionId);
        } catch {
            dsaQuestion = null;
        }

        if (!dsaQuestion) {
            dsaQuestion = await DSAQuestion.findOne({ problemId: questionId });
        }
        if (!dsaQuestion) {
            dsaQuestion = await DSAQuestion.findOne({ problemSlug: questionId });
        }

        if (!dsaQuestion) {
            return reply.status(404).send({
                error: "Question Not Found",
                message: "Question not found in question bank",
            });
        }

        const normalized = normalizeDSAQuestion(dsaQuestion as any);
        const testCases = (normalized.testCases || [])
            .filter((tc) => runHiddenTests || tc.type === "sample")
            .sort((a, b) => a.orderIdx - b.orderIdx);

        if (testCases.length === 0) {
            return reply.status(404).send({
                error: "No Test Cases",
                message: "No test cases found for this question",
            });
        }

        // Execute code against each test case
        let allPassed = true;
        let totalRuntimeMs = 0;
        const results = [];

        try {
            const inputs = testCases.map(tc => tc.input);
            const judge0Results = await executeAllInputs(code, languageId, inputs, judge0Url, host);

            for (let i = 0; i < testCases.length; i++) {
                const tc = testCases[i];
                const resObj = judge0Results[i];

                const actualOutput = (resObj.stdout || "").trim();
                const expectedOutput = tc.expected.trim();
                const passed = actualOutput === expectedOutput;

                if (!passed) allPassed = false;

                const runtimeMs = resObj.time
                    ? Math.round(parseFloat(resObj.time) * 1000)
                    : 0;
                totalRuntimeMs += runtimeMs;

                let status: string;
                if (resObj.status.id === 6) status = "CE";
                else if (resObj.status.id === 5) status = "TLE";
                else if (resObj.status.id >= 7 && resObj.status.id <= 12) status = "RE";
                else if (passed) status = "AC";
                else status = "WA";

                results.push({
                    testCaseId: tc.id,
                    input: tc.input,
                    expected: expectedOutput,
                    actual: actualOutput,
                    passed,
                    runtimeMs,
                    type: tc.type as "sample" | "hidden" | "edge",
                    status,
                    stderr: resObj.stderr || null,
                    compileOutput: resObj.compile_output || null,
                });
            }
        } catch (err: unknown) {
            allPassed = false;
            const errorMessage = err instanceof Error ? err.message : "Unknown execution error";
            for (const tc of testCases) {
                results.push({
                    testCaseId: tc.id,
                    input: tc.input,
                    expected: tc.expected.trim(),
                    actual: "",
                    passed: false,
                    runtimeMs: 0,
                    type: tc.type as "sample" | "hidden" | "edge",
                    status: "RE",
                    stderr: errorMessage,
                    compileOutput: null,
                });
            }
        }

        return reply.send({
            allPassed,
            totalRuntimeMs,
            totalTests: testCases.length,
            passedTests: results.filter((r) => r.passed).length,
            results,
        });
    });
}
