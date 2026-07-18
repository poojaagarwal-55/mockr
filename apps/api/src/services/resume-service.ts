import { prisma } from "../lib/prisma.js";
import { encrypt, decrypt, isEncrypted } from "../lib/encryption.js";
import { GEMINI_MODEL, GEMINI_THINKING_MEDIUM, generateJsonWithRetry } from "../lib/gemini.js";

// ── System Instructions (cached by Gemini across calls) ─────────

const RESUME_CLASSIFIER_SYSTEM = `You are a document classifier. Determine if text is from a resume/CV.
A resume typically contains: a person's name, work experience, education, skills, or contact information.
Documents that are NOT resumes include: academic papers, articles, invoices, receipts, legal documents, random text, code files, etc.
Return ONLY valid JSON: { "isResume": boolean, "reason": "string (one sentence explanation)" }`;

const RESUME_ANALYSIS_SYSTEM = `You are an expert technical recruiter and resume analyst.
Analyze resume text and extract structured information.

Be thorough and accurate:
- Extract ALL skills, experiences, and projects mentioned
- Identify red flags like employment gaps (between roles), vague descriptions, or missing details
- Do NOT evaluate or flag employment dates as "outdated", "missing recent experience", or complain about gaps leading up to the present, since you do not know the current actual date.
- Identify strengths like strong projects, relevant experience, or notable achievements
- Generate 5-10 tailored interview questions based on the candidate's background
- Rate overall strength as weak/moderate/strong based on content quality

Return ONLY valid JSON matching this exact structure:
{
  "summary": {
    "name": "string",
    "totalYearsExperience": number | null,
    "currentRole": "string | null",
    "currentCompany": "string | null",
    "education": [{ "institution": "string", "degree": "string", "field": "string", "year": number | null }],
    "skills": [{ "category": "string (e.g. Languages, Frameworks, Databases, Tools)", "skills": ["string"] }],
    "experience": [{ "company": "string", "role": "string", "duration": "string", "highlights": ["string"] }],
    "projects": [{ "name": "string", "description": "string", "techStack": ["string"] }],
    "redFlags": ["string — gaps, inconsistencies, or concerns"],
    "strengths": ["string — strong points and highlights"]
  },
  "suggestedQuestions": ["string — 5-10 tailored interview questions"],
  "overallStrength": "weak" | "moderate" | "strong"
}`;

const ATS_ANALYSIS_SYSTEM = `You are an expert ATS (Applicant Tracking System) and technical recruiter.
Analyze resume text against a given Context (Job Description or target Role).
Give a harsh, realistic evaluation just like a real ATS would.
IMPORTANT: Do NOT penalize, deduct points, or evaluate the resume based on the recency of the dates (e.g. "outdated experience", "resume stops at 2023") because you do not know the current date. Assess purely on the skill overlap, formatting, and achievements.

Return ONLY valid JSON matching this exact structure:
{
  "categories": {
    "keywords": { "score": number (0-100), "feedback": "string" },
    "experience": { "score": number (0-100), "feedback": "string" },
    "education": { "score": number (0-100), "feedback": "string" },
    "formatting": { "score": number (0-100), "feedback": "string" },
    "achievements": { "score": number (0-100), "feedback": "string" }
  },
  "suggestions": ["string - specific actionable improvements"],
  "matchedKeywords": ["string"],
  "missingKeywords": ["string"],
  "summary": "string - 2-3 sentences overall ATS impression"
}`;

// ── Fixed weights for ATS overall score (must sum to 1.0) ───────
// AI gives category scores → we calculate overallScore with fixed math
// Same resume = same score, always.
const ATS_WEIGHTS = {
    keywords:     0.30,  // 30% — most important: keyword match
    experience:   0.25,  // 25% — work experience relevance
    achievements: 0.20,  // 20% — quantified impact
    education:    0.10,  // 10% — degree & field match
    formatting:   0.15,  // 15% — ATS-parseable structure
} as const;

type AtsCategoryKey = keyof typeof ATS_WEIGHTS;
const ATS_CATEGORY_KEYS = Object.keys(ATS_WEIGHTS) as AtsCategoryKey[];

/** Coerce any model-provided value into a sane 0-100 integer score. */
function clampScore(value: unknown): number {
    const n = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(n)) return 0;
    return Math.max(0, Math.min(100, Math.round(n)));
}

/**
 * Normalize the AI's `categories` object so every expected category exists
 * with a numeric score and string feedback. The model occasionally omits a
 * category or returns a non-numeric score; without this the downstream score
 * math (and the ATS report UI) would crash on a partial response.
 */
function normalizeAtsCategories(raw: any): Record<AtsCategoryKey, { score: number; feedback: string }> {
    const out = {} as Record<AtsCategoryKey, { score: number; feedback: string }>;
    for (const key of ATS_CATEGORY_KEYS) {
        const cat = raw?.[key] ?? {};
        out[key] = {
            score: clampScore(cat.score),
            feedback: typeof cat.feedback === "string" ? cat.feedback : "",
        };
    }
    return out;
}

function calculateATSOverallScore(categories: Record<AtsCategoryKey, { score: number }>): number {
    const score =
        categories.keywords.score     * ATS_WEIGHTS.keywords +
        categories.experience.score   * ATS_WEIGHTS.experience +
        categories.achievements.score * ATS_WEIGHTS.achievements +
        categories.education.score    * ATS_WEIGHTS.education +
        categories.formatting.score   * ATS_WEIGHTS.formatting;
    return Math.round(score);
}

// ── Shared generation config ────────────────────────────────────

const GENERATION_CONFIG = {
    responseMimeType: "application/json" as const,
    thinkingConfig: GEMINI_THINKING_MEDIUM,
};

// ── Service Functions ────────────────────────────────────────────

/**
 * Quick AI check to verify the uploaded document is actually a resume.
 * Fails open (treats as a resume) so a flaky classification never blocks a
 * legitimate upload — the retry wrapper handles transient model hiccups.
 */
export async function validateIsResume(rawText: string): Promise<{ isResume: boolean; reason: string }> {
    const parsed = await generateJsonWithRetry<{ isResume?: unknown; reason?: unknown }>({
        model: GEMINI_MODEL,
        contents: `Document text:\n${rawText.slice(0, 3000)}`,
        config: {
            systemInstruction: RESUME_CLASSIFIER_SYSTEM,
            ...GENERATION_CONFIG,
        },
    });
    return {
        isResume: typeof parsed.isResume === "boolean" ? parsed.isResume : true,
        reason: typeof parsed.reason === "string" ? parsed.reason : "Unable to classify document confidently.",
    };
}

export async function analyzeResume(rawText: string) {
    return generateJsonWithRetry({
        model: GEMINI_MODEL,
        contents: `Resume Text:\n${rawText}`,
        config: {
            systemInstruction: RESUME_ANALYSIS_SYSTEM,
            ...GENERATION_CONFIG,
        },
    });
}

export async function analyzeResumeATS(rawText: string, mode: "jd" | "role", context: string) {
    const contextLabel = mode === "jd" ? "Job Description" : "Target Role";

    const parsed = await generateJsonWithRetry<any>({
        model: GEMINI_MODEL,
        contents: `Context to evaluate against:\n${contextLabel}:\n${context}\n\nResume Text:\n${rawText}`,
        config: {
            systemInstruction: ATS_ANALYSIS_SYSTEM,
            ...GENERATION_CONFIG,
        },
    });

    // ── Deterministic overall score ──────────────────────────
    // Normalize first so a partial AI response (missing a category or a
    // non-numeric score) can't crash the score math or the report UI.
    // AI gives per-category scores (0-100 each); we calculate overallScore
    // with fixed weights — not AI — so the same resume + JD = same score.
    const categories = normalizeAtsCategories(parsed.categories);
    const overallScore = calculateATSOverallScore(categories);

    return {
        ...parsed,
        categories,
        suggestions: Array.isArray(parsed.suggestions) ? parsed.suggestions : [],
        matchedKeywords: Array.isArray(parsed.matchedKeywords) ? parsed.matchedKeywords : [],
        missingKeywords: Array.isArray(parsed.missingKeywords) ? parsed.missingKeywords : [],
        summary: typeof parsed.summary === "string" ? parsed.summary : "",
        overallScore,
    };
}

export async function createResume(
    userId: string,
    fileName: string,
    fileUrl: string,
    rawText: string,
    analysis: any
) {
    return prisma.resume.create({
        data: {
            userId,
            fileName,
            fileUrl,
            rawText: encrypt(rawText),
            analysis: analysis ? (encrypt(JSON.stringify(analysis)) as any) : null,
        },
    });
}

export async function getUserResumes(userId: string) {
    return prisma.resume.findMany({
        where: { userId },
        orderBy: { uploadedAt: "desc" },
        select: {
            id: true,
            fileName: true,
            fileUrl: true,
            analysis: true,
            atsAnalysis: true,
            uploadedAt: true,
        },
    });
}

export async function getResumeById(id: string, userId: string) {
    const resume = await prisma.resume.findFirst({
        where: { id, userId },
    });

    if (!resume) return null;

    return {
        ...resume,
        rawText: resume.rawText && isEncrypted(resume.rawText)
            ? decrypt(resume.rawText)
            : resume.rawText,
        analysis: resume.analysis && typeof resume.analysis === "string" && isEncrypted(resume.analysis as string)
            ? JSON.parse(decrypt(resume.analysis as string))
            : resume.analysis,
    };
}

export async function deleteResume(id: string, userId: string) {
    return prisma.resume.deleteMany({
        where: { id, userId },
    });
}

export async function updateResumeAnalysis(id: string, userId: string, analysis: any) {
    return prisma.resume.updateMany({
        where: { id, userId },
        data: { analysis: encrypt(JSON.stringify(analysis)) as any },
    });
}

export async function updateResumeAtsAnalysis(id: string, userId: string, atsAnalysis: any) {
    return prisma.resume.updateMany({
        where: { id, userId },
        data: { atsAnalysis: atsAnalysis as any },
    });
}

export async function updateResumeFileName(id: string, userId: string, fileName: string) {
    return prisma.resume.updateMany({
        where: { id, userId },
        data: { fileName },
    });
}
