// ============================================
// Question Helpers — MongoDB → Prisma-shape adapters
// ============================================
// These helpers convert MongoDB Mongoose documents
// into the exact shapes the rest of the codebase expects
// (frontends, code execution, tool handlers, etc.).
// This avoids changing every consumer; only the data
// layer changes.

import type { IDSAQuestion } from "../models/DSAQuestion.js";
import type { ISQLQuestion } from "../models/SQLQuestion.js";
import type { ICSFundamentalQuestion } from "../models/CSFundamentalQuestion.js";

type RawSolutionApproach = {
    explaination?: string;
    description?: string;
    explanation?: string;
    timeComplexity?: string;
    spaceComplexity?: string;
    code?: Map<string, string> | Record<string, string>;
};

type NormalizedSolutionApproach = {
    explaination?: string;
    explanation?: string;
    timeComplexity?: string;
    spaceComplexity?: string;
    code?: Record<string, string>;
};

const LANGUAGE_KEY_ALIASES: Record<string, string> = {
    "c++": "cpp",
    cplusplus: "cpp",
    "c#": "csharp",
    "c-sharp": "csharp",
};

const SUPPORTED_SOLUTION_CODE_LANGUAGES = new Set([
    "python",
    "python3",
    "cpp",
    "java",
    "javascript",
    "typescript",
    "c",
    "csharp",
    "go",
    "rust",
    "ruby",
    "swift",
    "kotlin",
    "php",
]);

function normalizeLanguageKey(language: string): string {
    const normalized = (language || "").trim().toLowerCase();
    return LANGUAGE_KEY_ALIASES[normalized] || normalized;
}

function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return fallback;
    return Math.min(max, Math.max(min, numeric));
}

function ensureCppStarterUsesClassSolution(starter: string): string {
    const trimmed = starter.trim();
    if (!trimmed) return starter;
    if (/\bclass\s+Solution\b/.test(trimmed)) return starter;

    const indented = trimmed
        .split("\n")
        .map((line) => `    ${line}`)
        .join("\n");

    if (/^\s*(public:|private:|protected:)\s*$/m.test(trimmed)) {
        return `class Solution {\n${indented}\n};`;
    }

    return `class Solution {\npublic:\n${indented}\n};`;
}

function indentLines(value: string, spaces: number): string {
    const prefix = " ".repeat(spaces);
    return value
        .split(/\r?\n/)
        .map((line) => `${prefix}${line}`)
        .join("\n");
}

function ensureJavaStarterUsesClassSolution(starter: string): string {
    const trimmed = starter.trim();
    if (!trimmed || /\bclass\s+Solution\b/.test(trimmed)) return starter;
    return `class Solution {\n${indentLines(trimmed, 4)}\n}`;
}

function ensurePythonStarterUsesClassSolution(starter: string): string {
    const trimmed = starter.trim();
    if (!trimmed || /\bclass\s+Solution\b/.test(trimmed) || !/^def\s+/.test(trimmed)) {
        return starter;
    }

    const lines = trimmed.split(/\r?\n/);
    const firstLine = lines[0] || "";
    const match = firstLine.match(/^def\s+([A-Za-z_]\w*)\s*\(([^)]*)\)\s*:/);
    if (!match) return starter;

    const params = (match[2] || "").trim();
    const methodParams = params ? `self, ${params}` : "self";
    lines[0] = firstLine.replace(/\(([^)]*)\)/, `(${methodParams})`);

    return `class Solution:\n${indentLines(lines.join("\n"), 4)}`;
}

function ensureJavaScriptStarterUsesClassSolution(starter: string): string {
    const trimmed = starter.trim();
    if (!trimmed || /\bclass\s+Solution\b/.test(trimmed)) return starter;

    const match = trimmed.match(/^function\s+([A-Za-z_$][\w$]*)\s*\(([^)]*)\)\s*\{/);
    if (!match) return starter;

    const methodStarter = trimmed.replace(
        /^function\s+([A-Za-z_$][\w$]*)\s*\(([^)]*)\)\s*\{/,
        `${match[1]}(${match[2] || ""}) {`
    );
    return `class Solution {\n${indentLines(methodStarter, 2)}\n}`;
}

function ensureStarterUsesClassSolution(language: string, starter: string): string {
    if (language === "cpp") return ensureCppStarterUsesClassSolution(starter);
    if (language === "java") return ensureJavaStarterUsesClassSolution(starter);
    if (language === "python" || language === "python3") return ensurePythonStarterUsesClassSolution(starter);
    if (language === "javascript") return ensureJavaScriptStarterUsesClassSolution(starter);
    return starter;
}

function firstNonEmptyString(...values: Array<unknown>): string | undefined {
    for (const value of values) {
        if (typeof value === "string") {
            const trimmed = value.trim();
            if (trimmed) return trimmed;
        }
    }
    return undefined;
}

function normalizeComplexityValue(value?: string): string | undefined {
    const normalized = firstNonEmptyString(value);
    if (!normalized) return undefined;
    const lowered = normalized.toLowerCase();
    if (lowered === "unknown" || lowered === "n/a" || lowered === "na" || lowered === "none") {
        return undefined;
    }
    return normalized;
}

function toStringRecord(input?: Map<string, string> | Record<string, string>): Record<string, string> {
    if (!input) return {};
    if (input instanceof Map) {
        return Object.fromEntries(input.entries());
    }
    if (typeof input === "object") {
        return Object.entries(input).reduce((acc, [key, value]) => {
            if (typeof value === "string") {
                acc[key] = value;
            }
            return acc;
        }, {} as Record<string, string>);
    }
    return {};
}

function parseSolutionExplanation(explanation?: string): {
    description?: string;
    timeComplexity?: string;
    spaceComplexity?: string;
} {
    if (!explanation) return {};

    const descriptionMatch = explanation.match(
        /(?:^|\n)\s*Description\s*:\s*([\s\S]*?)(?=\n\s*(?:Time\s*Complexity|Space\s*Complexity)\s*:|$)/i
    );
    const timeMatch = explanation.match(/(?:^|\n)\s*Time\s*Complexity\s*:\s*([^\n]+)/i);
    const spaceMatch = explanation.match(/(?:^|\n)\s*Space\s*Complexity\s*:\s*([^\n]+)/i);

    return {
        description: descriptionMatch?.[1]?.trim(),
        timeComplexity: timeMatch?.[1]?.trim(),
        spaceComplexity: spaceMatch?.[1]?.trim(),
    };
}

function normalizeSolutionApproach(raw?: RawSolutionApproach | null): NormalizedSolutionApproach | undefined {
    if (!raw) return undefined;

    const rawExplanation = firstNonEmptyString(raw.explanation);
    const parsed = parseSolutionExplanation(rawExplanation);
    const explaination = firstNonEmptyString(raw.explaination, raw.description, parsed.description, rawExplanation);
    const timeComplexity = normalizeComplexityValue(raw.timeComplexity) || normalizeComplexityValue(parsed.timeComplexity);
    const spaceComplexity = normalizeComplexityValue(raw.spaceComplexity) || normalizeComplexityValue(parsed.spaceComplexity);

    const explanation = firstNonEmptyString(raw.explanation, explaination);

    const rawCode = toStringRecord(raw.code);
    const normalizedCode = Object.entries(rawCode).reduce((acc, [lang, snippet]) => {
        const normalizedLang = normalizeLanguageKey(lang);
        if (!SUPPORTED_SOLUTION_CODE_LANGUAGES.has(normalizedLang)) {
            return acc;
        }
        if (!acc[normalizedLang] || !acc[normalizedLang].trim()) {
            acc[normalizedLang] = snippet;
        }
        return acc;
    }, {} as Record<string, string>);

    if (!explaination && !explanation && !timeComplexity && !spaceComplexity && Object.keys(normalizedCode).length === 0) {
        return undefined;
    }

    return {
        explaination,
        explanation,
        timeComplexity,
        spaceComplexity,
        code: Object.keys(normalizedCode).length > 0 ? normalizedCode : undefined,
    };
}

// ── DSA normalization ──────────────────────────────────────────

/**
 * Converts a MongoDB DSAQuestion document into the shape that
 * the rest of the codebase previously got from Prisma.
 *
 * Prisma shape expected:
 *   - id: string (UUID)
 *   - title, difficulty, problemMd, constraints (string)
 *   - examples: JSON array with {input, output, explanation}
 *   - starters: { language, starter, wrapperCode }[]
 *   - testCases: { id, input, expected, type, orderIdx }[]
 *   - hints, tags, etc.
 */
function cleanExampleText(value: string): string {
    return (value || "")
        .replace(/\u200b|\u200c|\u200d|\ufeff/g, "")
        .replace(/\[cite:\s*\d+\]/gi, "")
        .replace(/\*\*/g, "")
        .replace(/\\\[/g, "[")
        .replace(/\\\]/g, "]")
        .replace(/\\\//g, "/")
        .replace(/\\_/g, "_")
        .replace(/\\-/g, "-")
        .replace(/\\\*/g, "*")
        .replace(/\\"/g, "\"")
        .trim();
}

function extractExampleSection(text: string, label: "Input" | "Output" | "Explanation", nextLabels: string[]): string {
    const nextPattern = nextLabels.map((next) => `${next}\\s*:?`).join("|");
    const pattern = nextPattern
        ? new RegExp(`\\b${label}\\s*:?\\s*([\\s\\S]*?)(?=\\s*(?:${nextPattern})|$)`, "i")
        : new RegExp(`\\b${label}\\s*:?\\s*([\\s\\S]*?)$`, "i");
    return cleanExampleText(text.match(pattern)?.[1] || "");
}

export function normalizeDSAQuestion(doc: IDSAQuestion) {
    const id = doc._id.toString();

    // Convert codeSnippets Map → starters array
    const starterByLanguage: Record<string, { starter: string; wrapperCode: string | null }> = {};
    if (doc.codeSnippets) {
        // Mongoose Maps: iterate via forEach or entries
        const snippetsObj = doc.codeSnippets instanceof Map
            ? doc.codeSnippets
            : new Map(Object.entries(doc.codeSnippets as any));

        snippetsObj.forEach((value: any, key: string) => {
            const language = normalizeLanguageKey(key);
            const rawStarter = value?.starter_code || value?.starterCode || "";
            const starter = ensureStarterUsesClassSolution(language, rawStarter);
            const wrapperCode = value?.wrapper_code || value?.wrapperCode || null;

            const existing = starterByLanguage[language];
            if (!existing) {
                starterByLanguage[language] = { starter, wrapperCode };
                return;
            }

            starterByLanguage[language] = {
                starter: existing.starter || starter,
                wrapperCode: existing.wrapperCode || wrapperCode,
            };
        });
    }
    const starters = Object.entries(starterByLanguage).map(([language, value]) => ({
        language,
        starter: value.starter,
        wrapperCode: value.wrapperCode,
    }));

    const rawSolution: any = doc.solution || {};
    const normalizedSolution = {
        bruteForce: normalizeSolutionApproach(rawSolution.bruteForce || rawSolution.brute_force),
        optimized: normalizeSolutionApproach(rawSolution.optimized),
    };
    const solution = normalizedSolution.bruteForce || normalizedSolution.optimized
        ? normalizedSolution
        : undefined;

    // Convert sampleTestCases → testCases with type "sample"
    const sampleTestCases = (doc.sampleTestCases || []).map((tc, idx) => ({
        id: tc.id || `sample_${idx}`,
        input: typeof tc.input === "string" ? tc.input : JSON.stringify(tc.input),
        expected: typeof tc.output === "string" ? tc.output : JSON.stringify(tc.output),
        type: "sample" as const,
        orderIdx: idx,
    }));

    // Convert hiddenTestCases → testCases with type "hidden"
    const hiddenTestCases = (doc.hiddenTestCases || []).map((tc, idx) => ({
        id: tc.id || `hidden_${idx}`,
        input: typeof tc.input === "string" ? tc.input : JSON.stringify(tc.input),
        expected: typeof tc.output === "string" ? tc.output : JSON.stringify(tc.output),
        type: "hidden" as const,
        orderIdx: sampleTestCases.length + idx,
    }));

    // All test cases combined
    const testCases = [...sampleTestCases, ...hiddenTestCases];

    // Constraints: MongoDB stores string[], Prisma stored a single string
    let constraints = Array.isArray(doc.constraints)
        ? doc.constraints.join("\n")
        : (doc.constraints || null);
    
    // Clean up escaped characters in constraints
    if (constraints) {
        constraints = constraints.replace(/\\\[/g, '[');
        constraints = constraints.replace(/\\\]/g, ']');
        constraints = constraints.replace(/\\\//g, '/');
        constraints = constraints.replace(/\\_/g, '_');
        constraints = constraints.replace(/\\-/g, '-');
        constraints = constraints.replace(/\\\*/g, '*');
    }

    // Examples: The MongoDB schema stores { example_num, example_text }.
    // The example_text can be in different formats:
    //   Format A (LeetCode-style): "Input\n[\"LRUCache\", ...]\n[[2], ...]\nOutput\n[null, ...]"
    //   Format B: "Input: nums = [2,7,11,15], target = 9\nOutput: [0,1]\nExplanation: ..."
    // The frontend expects { input, output, explanation } as separate fields.
    const examples = (doc.examples || []).map((ex) => {
        const cleanText = cleanExampleText(ex.example_text || "");

        return {
            input: extractExampleSection(cleanText, "Input", ["Output", "Explanation"]),
            output: extractExampleSection(cleanText, "Output", ["Explanation"]),
            explanation: extractExampleSection(cleanText, "Explanation", []),
        };
    });

    return {
        id,
        title: doc.title,
        problemId: doc.problemId,
        frontendId: doc.frontendId,
        difficulty: doc.difficulty,
        problemSlug: doc.problemSlug,
        timeLimit: clampNumber(doc.timeLimit, 2, 0.1, 5),
        memoryLimit: clampNumber(doc.memoryLimit, 256, 16, 256),
        topics: doc.topics || [],
        companyTags: doc.companyTags || [],
        category: "DSA",
        problemMd: doc.description, // MongoDB: `description`, Prisma expected: `problemMd`
        constraints,
        examples,
        hints: doc.hints || [],
        isActive: true,
        starters,
        testCases,
        solution,
        // Special Judge / custom checker (optional). "custom" means the output is
        // validated by `checkerCode` instead of exact match — for problems with
        // multiple valid outputs.
        judgeType: (doc as any).judgeType === "custom" ? "custom" : "default",
        checkerLanguage: (doc as any).checkerLanguage || null,
        checkerCode: (doc as any).checkerCode || null,
        // Convenience: visibleTestCases (sample only, for frontend display)
        visibleTestCases: sampleTestCases,
    };
}

/**
 * Formats the description text to HTML with proper formatting:
 * - Removes duplicate sections (Examples, Constraints, Topics)
 * - Highlights important words in bold
 * - Preserves code snippets
 * - Formats lists properly
 * - Handles escaped characters like \[ \] \* \_ \/
 * - Converts markdown images to HTML img tags
 * - Converts markdown links to HTML anchor tags
 * - Auto-detects image URLs and displays them as images
 */
function formatDescription(description: string): string {
    if (!description) return "";
    
    let formatted = description;
    
    // First, decode HTML entities and escaped characters
    formatted = formatted.replace(/\\n/g, '\n');
    formatted = formatted.replace(/\\\[/g, '[');
    formatted = formatted.replace(/\\\]/g, ']');
    formatted = formatted.replace(/\\\//g, '/');
    formatted = formatted.replace(/\\\*/g, '*ESCAPED*');
    formatted = formatted.replace(/\\_/g, '_');
    formatted = formatted.replace(/\\-/g, '-');
    
    // Convert markdown images to HTML before processing other markdown
    // Format: ![alt text](image-url) or ![](image-url)
    formatted = formatted.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" class="max-w-full h-auto my-4 rounded-lg border border-slate-200 dark:border-slate-700" />');
    
    // Convert markdown links to HTML
    // Format: [text](url)
    // Check if URL is an image (ends with common image extensions)
    formatted = formatted.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (match, text, url) => {
        const imageExtensions = /\.(png|jpg|jpeg|gif|svg|webp|bmp)(\?.*)?$/i;
        if (imageExtensions.test(url)) {
            // It's an image URL - display as image
            return `<img src="${url}" alt="${text}" class="max-w-full h-auto my-4 rounded-lg border border-slate-200 dark:border-slate-700" />`;
        } else {
            // It's a regular link - make it clickable
            return `<a href="${url}" target="_blank" rel="noopener noreferrer" class="text-teal-600 dark:text-teal-400 hover:underline">${text}</a>`;
        }
    });
    
    // Also detect standalone image URLs (not in markdown format) and convert them
    // Match URLs that end with image extensions
    formatted = formatted.replace(/https?:\/\/[^\s<]+\.(png|jpg|jpeg|gif|svg|webp|bmp)(\?[^\s<]*)?/gi, (url) => {
        return `<img src="${url}" alt="Image" class="max-w-full h-auto my-4 rounded-lg border border-slate-200 dark:border-slate-700" />`;
    });
    
    // Remove everything after the main description ends - be more aggressive
    // Split at the FIRST occurrence of these markers
    const markers = [
        /\*\*Example/i,
        /Example \d+:/i,
        /\*\*Constraints:\*\*/i,
        /^Constraints:/im,
        /^Topics:/im,
        /\*\*Topics\*\*/i,
    ];
    
    for (const marker of markers) {
        const match = formatted.match(marker);
        if (match && match.index !== undefined) {
            formatted = formatted.substring(0, match.index);
            break; // Stop at the first marker found
        }
    }
    
    // Remove trailing "Examples", "Constraints", etc.
    formatted = formatted.replace(/\s*(Examples?|Constraints?|Topics?)\s*$/gi, '');
    
    // Clean up excessive asterisks - replace ** with bold tags
    formatted = formatted.replace(/\*\*([^*]+)\*\*/g, '<BOLD>$1</BOLD>');
    
    // Remove any remaining single asterisks (but not our ESCAPED ones)
    formatted = formatted.replace(/(?<!\w)\*(?!\w)/g, '');
    
    // Restore escaped asterisks
    formatted = formatted.replace(/\*ESCAPED\*/g, '*');
    
    // Format inline code with backticks
    formatted = formatted.replace(/`([^`]+)`/g, '<code class="px-1.5 py-0.5 bg-slate-100 dark:bg-slate-800 rounded text-sm font-mono">$1</code>');
    
    // Restore bold formatting
    formatted = formatted.replace(/<BOLD>([^<]+)<\/BOLD>/g, '<strong class="font-semibold text-slate-900 dark:text-white">$1</strong>');
    
    // Format bullet points (lines starting with * followed by space)
    formatted = formatted.replace(/^\s*\*\s+(.+)$/gm, '<li class="ml-6 mb-2">$1</li>');
    
    // Wrap consecutive list items in ul
    formatted = formatted.replace(/(<li class="ml-6 mb-2">.*?<\/li>\s*)+/g, '<ul class="list-disc mb-4 space-y-1">$&</ul>');
    
    // Format numbered lists
    formatted = formatted.replace(/^\s*(\d+)\.\s+(.+)$/gm, '<li class="ml-6 mb-2">$2</li>');
    
    // Convert to paragraphs
    const lines = formatted.split('\n');
    const result: string[] = [];
    let currentPara = '';
    let inList = false;
    
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i]?.trim() || '';
        
        if (!line) {
            if (currentPara && !inList) {
                result.push(`<p class="mb-4 leading-relaxed text-slate-700 dark:text-slate-300">${currentPara}</p>`);
                currentPara = '';
            }
            continue;
        }
        
        if (line.startsWith('<ul') || line.startsWith('<ol') || line.startsWith('<li')) {
            if (currentPara) {
                result.push(`<p class="mb-4 leading-relaxed text-slate-700 dark:text-slate-300">${currentPara}</p>`);
                currentPara = '';
            }
            result.push(line);
            inList = line.startsWith('<ul') || line.startsWith('<ol');
            if (line.includes('</ul>') || line.includes('</ol>')) {
                inList = false;
            }
        } else if (line.startsWith('<img')) {
            // Handle images - add them directly without wrapping in paragraph
            if (currentPara) {
                result.push(`<p class="mb-4 leading-relaxed text-slate-700 dark:text-slate-300">${currentPara}</p>`);
                currentPara = '';
            }
            result.push(line);
        } else if (line.startsWith('<')) {
            if (currentPara) {
                result.push(`<p class="mb-4 leading-relaxed text-slate-700 dark:text-slate-300">${currentPara}</p>`);
                currentPara = '';
            }
            result.push(line);
        } else {
            if (currentPara) {
                currentPara += ' ' + line;
            } else {
                currentPara = line;
            }
        }
    }
    
    if (currentPara) {
        result.push(`<p class="mb-4 leading-relaxed text-slate-700 dark:text-slate-300">${currentPara}</p>`);
    }
    
    return result.join('\n');
}

/**
 * Build IDE API response from a normalized DSA question.
 * This is the shape returned by GET /ide/question and GET /ide/question/:id.
 */
export function buildIDEResponse(
    normalized: ReturnType<typeof normalizeDSAQuestion>,
    options: { preserveMarkdown?: boolean } = {}
) {
    const starterCode = normalized.starters.reduce((acc, s) => {
        acc[s.language] = s.starter;
        return acc;
    }, {} as Record<string, string>);

    const wrapperCode = normalized.starters.reduce((acc, s) => {
        if (s.wrapperCode) acc[s.language] = s.wrapperCode;
        return acc;
    }, {} as Record<string, string>);

    // ONLY sample test cases for the IDE response (hidden stay hidden)
    const sampleTests = normalized.visibleTestCases.map(tc => ({
        id: tc.id,
        stdin: tc.input,
        expected_output: tc.expected,
    }));

    return {
        id: normalized.id,
        title: normalized.title,
        statement: options.preserveMarkdown ? normalized.problemMd : formatDescription(normalized.problemMd),
        category: normalized.category,
        difficulty: normalized.difficulty,
        timeLimit: normalized.timeLimit,
        memoryLimit: normalized.memoryLimit,
        constraints: normalized.constraints,
        examples: normalized.examples,
        hints: normalized.hints,
        topics: normalized.topics,
        companyTags: normalized.companyTags || [],
        language: Object.keys(starterCode).length > 0 ? Object.keys(starterCode)[0] : "cpp",
        starter_code: starterCode,
        wrapper_code: wrapperCode,
        sample_tests: sampleTests,
        solution: normalized.solution,
    };
}

// ── SQL normalization ──────────────────────────────────────────

/**
 * Converts a MongoDB SQLQuestion document into the shape
 * used throughout the codebase.
 */
export function normalizeSQLQuestion(doc: ISQLQuestion & { _id: { toString(): string } }) {
    const id = doc._id.toString();

    return {
        id,
        title: doc.title,
        category: "SQL",
        difficulty: "Medium" as const,
        description: doc.description,
        examples: doc.examples || [],
        hints: [] as string[],
        wrapperCode: doc.wrapperCode,
        solution: doc.solution,
        judge0LanguageId: doc.judge0LanguageId,
        testCases: (doc.testCases || []).map((tc, idx) => ({
            id: String(tc.id || `sql_${idx}`),
            label: tc.label || `Test Case ${idx + 1}`,
            input: tc.input,
            expected_output: tc.expected_output,
        })),
        hiddenTestCases: (doc.hiddenTestCases || []).map((tc, idx) => ({
            id: tc.id || `sql_hidden_${idx}`,
            label: tc.label || `Hidden Test Case ${idx + 1}`,
            expected_output: tc.expected_output,
            wrapper_code: tc.wrapper_code,
        })),
    };
}

// ── CS Fundamental normalization ───────────────────────────────

/**
 * Maps MongoDB topic codes → the category names used by fetch_question.
 * The AI calls fetch_question with categories like "OS", "OOP", "Networking".
 * MongoDB stores topics as "CN", "DBMS", "OOPS", "OS".
 */
const TOPIC_TO_CATEGORY: Record<string, string> = {
    CN: "Networking",
    DBMS: "DBMS",
    OOPS: "OOP",
    OS: "OS",
};

const CATEGORY_TO_TOPIC: Record<string, string> = {
    Networking: "CN",
    DBMS: "DBMS",
    OOP: "OOPS",
    OS: "OS",
    // Also accept direct codes
    CN: "CN",
    OOPS: "OOPS",
};

/**
 * Converts a fetch_question category into the MongoDB topic code.
 */
export function categoryToMongoTopic(category: string): string | null {
    return CATEGORY_TO_TOPIC[category] ?? null;
}

/**
 * Converts a MongoDB CSFundamentalQuestion document into the shape
 * used by the tool handlers (mimicking the Prisma QuestionFundamental shape).
 */
export function normalizeCSFundamental(doc: ICSFundamentalQuestion) {
    const id = doc._id.toString();

    return {
        questionID: id,
        questionType: TOPIC_TO_CATEGORY[doc.topic] || doc.topic,
        question: doc.question,
        answer: doc.answer,
        hint: null as string | null,  // CS Fundamental model doesn't store hints
    };
}
