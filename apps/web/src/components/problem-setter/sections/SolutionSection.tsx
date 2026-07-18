import { useState } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/context/auth-context";
import { DSAQuestionData, LanguageTestStatus, TestResultsState } from "../DSAQuestionForm";
import { MarkdownQuestionEditor } from "@/components/question-content/markdown-question-editor";

interface Props {
    formData: DSAQuestionData;
    setFormData: (data: DSAQuestionData) => void;
    testStatus?: TestResultsState;
    setTestStatus?: React.Dispatch<React.SetStateAction<TestResultsState>>;
}

type Approach = "bruteForce" | "optimized";
type LanguageId = "python3" | "cpp" | "java" | "javascript";

interface AdminTestRunCaseResult {
    input?: string;
    expected?: string;
    actual?: string;
    status?: string;
    passed?: boolean;
    runtimeMs?: number | string | null;
    memory?: number | string | null;
}

interface AdminTestRunResponse {
    allPassed?: boolean;
    passedTests?: number;
    totalTests?: number;
    totalRuntimeMs?: number;
    maxRuntimeMs?: number;
    maxMemoryKb?: number;
    error?: string;
    results?: AdminTestRunCaseResult[];
}

const languages: Array<{ id: LanguageId; name: string; short: string }> = [
    { id: "python3", name: "Python 3", short: "PY" },
    { id: "cpp", name: "C++", short: "C++" },
    { id: "java", name: "Java", short: "JAVA" },
    { id: "javascript", name: "JavaScript", short: "JS" },
];

function statusClasses(status: LanguageTestStatus | undefined) {
    if (status === "passed") return "bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-400/10 dark:text-emerald-200 dark:ring-emerald-400/20";
    if (status === "failed") return "bg-red-50 text-red-700 ring-red-200 dark:bg-red-400/10 dark:text-red-200 dark:ring-red-400/20";
    if (status === "tle") return "bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-400/10 dark:text-amber-200 dark:ring-amber-400/20";
    if (status === "running") return "bg-primary/10 text-primary ring-primary/20";
    return "bg-slate-100 text-slate-500 ring-slate-200 dark:bg-lc-elevated dark:text-slate-400 dark:ring-lc-border";
}

function statusLabel(status: LanguageTestStatus | undefined) {
    if (status === "tle") return "TLE (expected)";
    return status || "untested";
}

function formatMemoryKb(value: unknown): string {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric <= 0) return "N/A";
    return `${(numeric / 1024).toFixed(1)} MB`;
}

function formatRuntimeMs(value: unknown): string {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric < 0) return "N/A";
    return `${numeric} ms`;
}

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
        const callableParams = rawParams[0] === "self" || rawParams[0] === "cls" ? rawParams.slice(1) : rawParams;
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

function combineSolutionWithWrapper(userCode: string, wrapperCode: string, language: LanguageId): string {
    if (!wrapperCode.trim()) return userCode;

    if (wrapperCode.includes("<USER_CODE>")) {
        return wrapperCode.replace(/<USER_CODE>/g, userCode);
    }

    if (language === "java") {
        const wrapperLines = wrapperCode.split("\n");
        const importLines: string[] = [];
        const restLines: string[] = [];
        let insideClassDefinition = false;
        let braceCount = 0;

        for (const line of wrapperLines) {
            const trimmed = line.trim();
            if (trimmed.startsWith("import ") || trimmed.startsWith("package ")) {
                importLines.push(line);
                continue;
            }

            if (!insideClassDefinition && trimmed.match(/^(public\s+)?class\s+\w+/) && !trimmed.includes("class Main")) {
                insideClassDefinition = true;
                braceCount = 0;
                continue;
            }

            if (insideClassDefinition) {
                for (const char of line) {
                    if (char === "{") braceCount += 1;
                    if (char === "}") braceCount -= 1;
                }
                if (braceCount < 0) insideClassDefinition = false;
                continue;
            }

            restLines.push(line);
        }

        return [importLines.join("\n"), userCode, restLines.join("\n")].filter((part) => part.trim()).join("\n");
    }

    if (language === "cpp") {
        const wrapperLines = wrapperCode.split("\n");
        const headerLines: string[] = [];
        const preUserLines: string[] = [];
        const postUserLines: string[] = [];
        const hasBitsHeader = /#include\s*<bits\/stdc\+\+\.h>/.test(wrapperCode);
        let sawUsingNamespaceStd = /\busing\s+namespace\s+std\s*;/.test(wrapperCode);
        const userUsesStdQualified = /\bstd::/.test(userCode);

        const countBraces = (line: string) => (line.match(/\{/g) || []).length - (line.match(/\}/g) || []).length;

        const parseFunctionPrototype = (line: string): { returnType: string; name: string; params: string } | null => {
            const trimmed = line.trim();
            if (!trimmed || trimmed.includes("=") || trimmed.startsWith("#")) return null;
            const match = trimmed.match(/^(.+?)\s+([A-Za-z_]\w*)\s*\(([^;{}]*)\)\s*;$/);
            if (!match) return null;
            return {
                returnType: match[1]?.trim() || "",
                name: match[2]?.trim() || "",
                params: match[3]?.trim() || "",
            };
        };

        const extractArgNames = (params: string) => {
            const trimmed = params.trim();
            if (!trimmed || trimmed === "void") return [];
            return trimmed.split(",").map((param, index) => {
                const match = param.replace(/=[^,]+$/, "").trim().match(/([A-Za-z_]\w*)\s*(?:\[[^\]]*\])?\s*$/);
                return match?.[1] || `arg${index}`;
            });
        };

        const buildAdapters = (prelude: string[]) => {
            if (!/\bclass\s+Solution\b/.test(userCode)) return [];
            const adapters: string[] = [];
            const seen = new Set<string>();
            let depth = 0;

            for (const line of prelude) {
                if (depth === 0) {
                    const parsed = parseFunctionPrototype(line);
                    if (parsed) {
                        const key = `${parsed.returnType}|${parsed.name}|${parsed.params}`;
                        if (!seen.has(key)) {
                            seen.add(key);
                            const args = extractArgNames(parsed.params).join(", ");
                            adapters.push(`${parsed.returnType} ${parsed.name}(${parsed.params}) {`);
                            adapters.push("    Solution sol;");
                            adapters.push(
                                parsed.returnType === "void"
                                    ? `    sol.${parsed.name}(${args});`
                                    : `    return sol.${parsed.name}(${args});`
                            );
                            adapters.push("}");
                            adapters.push("");
                        }
                    }
                }
                depth += countBraces(line);
                if (depth < 0) depth = 0;
            }

            return adapters;
        };

        let insideSolution = false;
        let solutionDepth = 0;
        let solutionSeen = false;

        for (const line of wrapperLines) {
            const trimmed = line.trim();
            if (trimmed.startsWith("#include") || trimmed.startsWith("using namespace") || trimmed.startsWith("using std::")) {
                headerLines.push(line);
                if (/^using\s+namespace\s+std\s*;/.test(trimmed)) {
                    sawUsingNamespaceStd = true;
                }
                continue;
            }

            if (!insideSolution && trimmed.match(/^class\s+Solution\b/)) {
                insideSolution = true;
                solutionSeen = true;
                solutionDepth = countBraces(line);
                if (solutionDepth <= 0 && trimmed.includes("};")) insideSolution = false;
                continue;
            }

            if (insideSolution) {
                solutionDepth += countBraces(line);
                if (solutionDepth <= 0) insideSolution = false;
                continue;
            }

            if (!solutionSeen) preUserLines.push(line);
            else postUserLines.push(line);
        }

        if (!solutionSeen) {
            const mainIndex = preUserLines.findIndex((line) => line.trim().match(/^int\s+main\s*\(/));
            if (mainIndex >= 0) {
                postUserLines.push(...preUserLines.slice(mainIndex));
                preUserLines.splice(mainIndex);
            }
        }

        const adapters = buildAdapters(preUserLines);
        const parts: string[] = [];
        if (!hasBitsHeader) parts.push("#include <bits/stdc++.h>");
        if (headerLines.length > 0) parts.push(headerLines.join("\n"));
        if (!sawUsingNamespaceStd && !userUsesStdQualified) parts.push("using namespace std;");
        if (preUserLines.join("\n").trim()) parts.push(preUserLines.join("\n"));
        parts.push(userCode);
        if (adapters.length > 0) parts.push(adapters.join("\n"));
        if (postUserLines.join("\n").trim()) parts.push(postUserLines.join("\n"));
        return parts.join("\n");
    }

    if (language === "python3") {
        const adapters = buildPythonClassSolutionAdapters(userCode);
        return [userCode, adapters, wrapperCode].filter((part) => part.trim()).join("\n");
    }

    if (language === "javascript") {
        const adapters = buildJavaScriptClassSolutionAdapters(userCode);
        return [userCode, adapters, wrapperCode].filter((part) => part.trim()).join("\n");
    }

    return `${userCode}\n${wrapperCode}`;
}

export function SolutionSection({ formData, setFormData, testStatus, setTestStatus }: Props) {
    const { session } = useAuth();
    const [testResults, setTestResults] = useState<Record<string, AdminTestRunResponse & { activeApproach?: Approach }>>({});
    const [activeApproach, setActiveApproach] = useState<Approach>("optimized");
    const [activeLanguage, setActiveLanguage] = useState<LanguageId>("python3");

    const currentSolution = formData.solution?.[activeApproach];
    const activeLang = languages.find((language) => language.id === activeLanguage) || languages[0];
    const activeStatus = testStatus?.[activeApproach]?.[activeLanguage];
    const activeResult = testResults[`${activeApproach}:${activeLanguage}`];

    const updateSolution = (approach: Approach, field: string, value: string) => {
        setFormData({
            ...formData,
            solution: {
                ...formData.solution,
                [approach]: {
                    ...formData.solution?.[approach],
                    [field]: value,
                },
            },
        });
    };

    const updateSolutionCode = (approach: Approach, lang: LanguageId, value: string) => {
        setFormData({
            ...formData,
            solution: {
                ...formData.solution,
                [approach]: {
                    ...formData.solution?.[approach],
                    code: {
                        ...formData.solution?.[approach]?.code,
                        [lang]: value,
                    },
                },
            },
        });
        setTestStatus?.((prev) => ({
            ...prev,
            [approach]: {
                ...prev[approach],
                [lang]: "untested",
            },
        }));
    };

    const handleRunTests = async (langId: LanguageId) => {
        if (!setTestStatus) return;
        setTestStatus((prev) => ({
            ...prev,
            [activeApproach]: {
                ...prev[activeApproach],
                [langId]: "running",
            },
        }));

        try {
            const wrapperCode = formData.codeSnippets[langId]?.wrapper_code || "";
            const solutionCode = formData.solution?.[activeApproach]?.code?.[langId] || "";
            const combinedCode = combineSolutionWithWrapper(solutionCode, wrapperCode, langId);

            const testCases = [...formData.sampleTestCases, ...formData.hiddenTestCases].map((testCase) => ({
                id: testCase.id,
                input: testCase.input,
                expected: testCase.output,
                type: formData.sampleTestCases.includes(testCase) ? "sample" as const : "hidden" as const,
            }));

            const res = await api.post<AdminTestRunResponse>("/code/test-run", {
                language: langId,
                code: combinedCode,
                timeLimit: formData.timeLimit,
                memoryLimit: formData.memoryLimit,
                testCases,
                ...(formData.judgeType === "custom" && formData.checkerCode
                    ? { checker: { language: formData.checkerLanguage || "cpp", code: formData.checkerCode } }
                    : {}),
            }, session?.access_token);

            let anyFailed = !res.allPassed;
            let bruteForceTle = false;
            if (activeApproach === "bruteForce") {
                // For a brute-force approach, a TLE/MLE is EXPECTED (the problem is
                // designed so the slow solution times out). Only wrong-answer /
                // compile / runtime errors mean the brute force is actually broken.
                const hasRealFailure = res.results?.some((result) =>
                    result.status === "WA" || result.status === "CE" || result.status === "RE"
                ) || res.error;
                bruteForceTle = !!res.results?.some((result) => result.status === "TLE" || result.status === "MLE");
                anyFailed = !!hasRealFailure;
            }

            setTestStatus((prev) => ({
                ...prev,
                [activeApproach]: {
                    ...prev[activeApproach],
                    [langId]: anyFailed ? "failed" : bruteForceTle ? "tle" : "passed",
                },
            }));
            setTestResults((prev) => ({
                ...prev,
                [`${activeApproach}:${langId}`]: { ...res, activeApproach },
            }));
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : "Failed to execute tests";
            setTestStatus((prev) => ({
                ...prev,
                [activeApproach]: {
                    ...prev[activeApproach],
                    [langId]: "failed",
                },
            }));
            setTestResults((prev) => ({
                ...prev,
                [`${activeApproach}:${langId}`]: { error: message },
            }));
        }
    };

    return (
        <div className="space-y-7">
            <div className="rounded-xl bg-amber-50 p-5 ring-1 ring-amber-100 dark:bg-amber-500/10 dark:ring-amber-400/20">
                <h2 className="font-nunito text-xl font-extrabold text-slate-950 dark:text-white">Solution Validation</h2>
                <p className="mt-2 text-sm font-semibold leading-6 text-slate-600 dark:text-slate-300">
                    Optimized code is required for all languages. Brute force is optional, but if you add it for a language, it must pass before submission.
                </p>
            </div>

            <section className="grid gap-5 md:grid-cols-2">
                <div>
                    <label className="mb-2 block text-sm font-extrabold text-slate-800 dark:text-slate-100">
                        CPU time limit <span className="text-red-500">*</span>
                    </label>
                    <div className="relative">
                        <input
                            type="number"
                            min={100}
                            max={5000}
                            step={50}
                            value={Math.round(formData.timeLimit * 1000)}
                            onChange={(event) => setFormData({ ...formData, timeLimit: Number(event.target.value) / 1000 })}
                            required
                            className="h-12 w-full rounded-lg border border-slate-200 bg-white px-4 pr-20 text-sm font-semibold text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-primary focus:ring-4 focus:ring-primary/10 dark:border-lc-border dark:bg-lc-input dark:text-white dark:placeholder:text-slate-500"
                        />
                        <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-xs font-extrabold uppercase tracking-[0.12em] text-slate-400">ms</span>
                    </div>
                    <p className="mt-2 text-xs font-semibold text-slate-500 dark:text-slate-400">
                        Enter milliseconds per test case. Judge0 receives this as decimal seconds.
                    </p>
                </div>

                <div>
                    <label className="mb-2 block text-sm font-extrabold text-slate-800 dark:text-slate-100">
                        Memory limit <span className="text-red-500">*</span>
                    </label>
                    <div className="relative">
                        <input
                            type="number"
                            min={16}
                            max={256}
                            step={1}
                            value={formData.memoryLimit}
                            onChange={(event) => setFormData({ ...formData, memoryLimit: Number(event.target.value) })}
                            required
                            className="h-12 w-full rounded-lg border border-slate-200 bg-white px-4 pr-20 text-sm font-semibold text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-primary focus:ring-4 focus:ring-primary/10 dark:border-lc-border dark:bg-lc-input dark:text-white dark:placeholder:text-slate-500"
                        />
                        <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-xs font-extrabold uppercase tracking-[0.12em] text-slate-400">MB</span>
                    </div>
                    <p className="mt-2 text-xs font-semibold text-slate-500 dark:text-slate-400">
                        Judge0 memory cap per test case. The hard cap is 256 MB.
                    </p>
                </div>
            </section>

            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex flex-wrap gap-2">
                    {[
                        { id: "optimized" as const, title: "Optimized Approach", eyebrow: "Required" },
                        { id: "bruteForce" as const, title: "Brute Force Approach", eyebrow: "Optional" },
                    ].map((approach) => (
                        <button
                            key={approach.id}
                            type="button"
                            onClick={() => setActiveApproach(approach.id)}
                            className={`h-11 rounded-full px-4 text-sm font-extrabold transition ${
                                activeApproach === approach.id
                                    ? "bg-primary text-white shadow-sm"
                                    : "bg-white text-slate-600 ring-1 ring-slate-200 hover:text-primary dark:bg-lc-surface dark:text-slate-200 dark:ring-lc-border dark:hover:bg-lc-hover dark:hover:text-white"
                            }`}
                        >
                            <span className="mr-2 text-xs uppercase opacity-75">{approach.eyebrow}</span>
                            {approach.title}
                        </button>
                    ))}
                </div>
            </div>

            <div className="grid gap-5 lg:grid-cols-[1.1fr_0.9fr]">
                <div className="rounded-xl bg-slate-50 p-5 ring-1 ring-slate-200 dark:bg-lc-elevated dark:ring-lc-border">
                    <MarkdownQuestionEditor
                        value={currentSolution?.explanation || ""}
                        onChange={(value) => updateSolution(activeApproach, "explanation", value)}
                        label="Explanation"
                        rows={8}
                        placeholder="Explain the approach, intuition, proof, edge cases, and why it works. Markdown, LaTeX, images, and notes are supported."
                    />
                </div>

                <div className="grid gap-4">
                    <div className="rounded-xl bg-slate-50 p-5 ring-1 ring-slate-200 dark:bg-lc-elevated dark:ring-lc-border">
                        <label className="mb-2 block text-sm font-extrabold text-slate-700 dark:text-slate-200">Time Complexity</label>
                        <input
                            type="text"
                            value={currentSolution?.timeComplexity || ""}
                            onChange={(event) => updateSolution(activeApproach, "timeComplexity", event.target.value)}
                            className="h-11 w-full rounded-lg border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-900 outline-none transition focus:border-primary focus:ring-4 focus:ring-primary/10 dark:border-lc-border dark:bg-lc-input dark:text-white dark:placeholder:text-slate-500"
                            placeholder="e.g., O(n log n)"
                        />
                    </div>
                    <div className="rounded-xl bg-slate-50 p-5 ring-1 ring-slate-200 dark:bg-lc-elevated dark:ring-lc-border">
                        <label className="mb-2 block text-sm font-extrabold text-slate-700 dark:text-slate-200">Space Complexity</label>
                        <input
                            type="text"
                            value={currentSolution?.spaceComplexity || ""}
                            onChange={(event) => updateSolution(activeApproach, "spaceComplexity", event.target.value)}
                            className="h-11 w-full rounded-lg border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-900 outline-none transition focus:border-primary focus:ring-4 focus:ring-primary/10 dark:border-lc-border dark:bg-lc-input dark:text-white dark:placeholder:text-slate-500"
                            placeholder="e.g., O(1)"
                        />
                    </div>
                </div>
            </div>

            <section className="rounded-xl bg-slate-50 p-6 ring-1 ring-slate-200 dark:bg-lc-elevated dark:ring-lc-border">
                <div className="mb-5 flex flex-col justify-between gap-4 md:flex-row md:items-center">
                    <div>
                        <p className="text-xs font-extrabold uppercase tracking-[0.14em] text-slate-400 dark:text-slate-500">Solution code</p>
                        <h3 className="mt-2 font-nunito text-xl font-extrabold text-slate-950 dark:text-white">{activeLang.name}</h3>
                    </div>
                    <div className="grid gap-2 sm:grid-cols-4">
                        {languages.map((language) => {
                            const status = testStatus?.[activeApproach]?.[language.id];
                            const active = activeLanguage === language.id;
                            return (
                                <button
                                    key={language.id}
                                    type="button"
                                    onClick={() => setActiveLanguage(language.id)}
                                    className={`rounded-lg px-4 py-3 text-left text-sm font-extrabold transition ${
                                        active
                                            ? "bg-primary text-white shadow-sm"
                                            : `${statusClasses(status)} ring-1 hover:text-primary`
                                    }`}
                                >
                                    <span className="block text-[11px] font-extrabold uppercase tracking-[0.14em] opacity-75">{language.short}</span>
                                    <span className="mt-1 block">{statusLabel(status)}</span>
                                </button>
                            );
                        })}
                    </div>
                </div>

                <textarea
                    value={currentSolution?.code?.[activeLanguage] || ""}
                    onChange={(event) => updateSolutionCode(activeApproach, activeLanguage, event.target.value)}
                    rows={18}
                    className="w-full rounded-lg border border-slate-200 bg-white px-4 py-3 font-mono text-sm text-slate-900 outline-none transition focus:border-primary focus:ring-4 focus:ring-primary/10 dark:border-lc-border dark:bg-lc-input dark:text-white dark:placeholder:text-slate-500"
                    placeholder={`Enter the ${activeApproach === "bruteForce" ? "brute force" : "optimized"} solution code in ${activeLang.name}.`}
                />

                <div className="mt-4 flex flex-wrap items-center gap-3">
                    <button
                        type="button"
                        onClick={() => handleRunTests(activeLanguage)}
                        disabled={activeStatus === "running"}
                        className="rounded-full bg-primary px-6 py-3 text-sm font-extrabold text-white transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                        {activeStatus === "running" ? "Running tests..." : `Run ${activeLang.short} tests`}
                    </button>
                    <span className={`rounded-full px-4 py-2 text-xs font-extrabold uppercase tracking-[0.12em] ring-1 ${statusClasses(activeStatus)}`}>
                        {statusLabel(activeStatus)}
                    </span>
                </div>

                {activeResult && (
                    <div className="mt-5 max-h-[360px] overflow-y-auto rounded-xl bg-white p-4 text-sm shadow-sm ring-1 ring-slate-200 dark:bg-lc-surface dark:ring-lc-border">
                        {activeResult.error ? (
                            <pre className="whitespace-pre-wrap text-red-700 dark:text-red-200">{activeResult.error}</pre>
                        ) : (
                            <div className="space-y-4">
                                <div className="flex flex-wrap gap-2">
                                    <span className={`rounded-full px-3 py-1 text-xs font-extrabold ${
                                        activeResult.allPassed
                                            ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-400/10 dark:text-emerald-200"
                                            : "bg-red-50 text-red-700 dark:bg-red-400/10 dark:text-red-200"
                                    }`}>
                                        Passed {activeResult.passedTests} / {activeResult.totalTests}
                                    </span>
                                    <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-extrabold text-slate-500 dark:bg-lc-elevated dark:text-slate-300">
                                        Total {formatRuntimeMs(activeResult.totalRuntimeMs)}
                                    </span>
                                    <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-extrabold text-slate-500 dark:bg-lc-elevated dark:text-slate-300">
                                        Max CPU {formatRuntimeMs(activeResult.maxRuntimeMs)}
                                    </span>
                                    <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-extrabold text-slate-500 dark:bg-lc-elevated dark:text-slate-300">
                                        Max memory {formatMemoryKb(activeResult.maxMemoryKb)}
                                    </span>
                                </div>

                                {activeResult.results?.map((result: AdminTestRunCaseResult, index: number) => (
                                    <div
                                        key={index}
                                        className={`rounded-xl border p-4 ${
                                            result.passed
                                                ? "border-emerald-200 bg-emerald-50 dark:border-emerald-400/20 dark:bg-emerald-400/10"
                                                : "border-red-200 bg-red-50 dark:border-red-400/20 dark:bg-red-400/10"
                                        }`}
                                    >
                                        <div className="mb-2 flex items-center justify-between gap-3">
                                            <span className="text-sm font-extrabold text-slate-950 dark:text-white">Test Case {index + 1}</span>
                                            <span className="rounded-full bg-white px-3 py-1 text-xs font-extrabold text-slate-500 ring-1 ring-slate-200 dark:bg-lc-elevated dark:text-slate-300 dark:ring-lc-border">
                                                {result.status || "Error"}
                                            </span>
                                        </div>
                                        <div className="mb-3 flex flex-wrap gap-2 text-xs font-bold text-slate-500 dark:text-slate-300">
                                            <span className="rounded-full bg-white px-3 py-1 ring-1 ring-slate-200 dark:bg-lc-elevated dark:ring-lc-border">
                                                CPU {formatRuntimeMs(result.runtimeMs)}
                                            </span>
                                            <span className="rounded-full bg-white px-3 py-1 ring-1 ring-slate-200 dark:bg-lc-elevated dark:ring-lc-border">
                                                Memory {formatMemoryKb(result.memory)}
                                            </span>
                                        </div>
                                        <pre className="whitespace-pre-wrap rounded-lg bg-slate-950 p-3 text-xs text-slate-100">Input: {result.input}</pre>
                                        {!result.passed && (
                                            <div className="mt-2 grid gap-2 md:grid-cols-2">
                                                <pre className="whitespace-pre-wrap rounded-lg bg-slate-950 p-3 text-xs text-emerald-100">Expected: {result.expected}</pre>
                                                <pre className="whitespace-pre-wrap rounded-lg bg-slate-950 p-3 text-xs text-red-100">Actual: {result.actual}</pre>
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                )}
            </section>
        </div>
    );
}
