// ============================================
// LaTeX Resume Service — CRUD + AI Assistance
// ============================================

import { prisma } from "../lib/prisma.js";
import { encrypt, decrypt, isEncrypted } from "../lib/encryption.js";
import { GEMINI_MODEL, GEMINI_PRO_MODEL, GEMINI_THINKING_HIGH, GEMINI_THINKING_MEDIUM, generateJsonWithRetry, generateTextWithRetry } from "../lib/gemini.js";
import { getTemplateBySlug } from "./latex-templates.js";
import { populateTemplate } from "./latex-generator.js";
import {
    LATEX_REWRITE_SYSTEM,
    LATEX_FIX_SYSTEM,
    LATEX_SUGGEST_SYSTEM,
    LATEX_CHAT_SYSTEM,
} from "./latex-ai-prompts.js";

// ── Shared Gemini config ────────────────────────────────────

const LATEX_AI_GENERATION_CONFIG = {
    responseMimeType: "application/json" as const,
    thinkingConfig: GEMINI_THINKING_HIGH,
};

// ── CRUD ────────────────────────────────────────────────────

export async function createLatexResume(
    userId: string,
    title: string,
    templateSlug: string,
    formData?: any
) {
    const template = getTemplateBySlug(templateSlug);
    let source = template?.source ?? "";

    if (formData && source) {
        source = populateTemplate(source, formData);
    }

    return prisma.latexResume.create({
        data: {
            userId,
            title,
            template: templateSlug,
            latexSource: encrypt(source),
        },
    });
}

export async function getUserLatexResumes(userId: string) {
    return prisma.latexResume.findMany({
        where: { userId },
        orderBy: { updatedAt: "desc" },
        select: {
            id: true,
            title: true,
            template: true,
            compiledUrl: true,
            compiledAt: true,
            createdAt: true,
            updatedAt: true,
        },
    });
}

export async function getLatexResumeById(id: string, userId: string) {
    const resume = await prisma.latexResume.findFirst({
        where: { id, userId },
    });

    if (!resume) return null;

    return {
        ...resume,
        latexSource:
            resume.latexSource && isEncrypted(resume.latexSource)
                ? decrypt(resume.latexSource)
                : resume.latexSource,
    };
}

export async function updateLatexResume(
    id: string,
    userId: string,
    data: { title?: string; latexSource?: string }
) {
    const updateData: Record<string, unknown> = {};
    if (data.title !== undefined) updateData.title = data.title;
    if (data.latexSource !== undefined) updateData.latexSource = encrypt(data.latexSource);

    return prisma.latexResume.updateMany({
        where: { id, userId },
        data: updateData,
    });
}

export async function rebuildLatexResumeFromFormData(
    id: string,
    userId: string,
    title: string,
    templateSlug: string,
    formData: any
) {
    const template = getTemplateBySlug(templateSlug);
    if (!template) {
        throw new Error("Template not found");
    }

    const source = populateTemplate(template.source, formData);

    return prisma.latexResume.updateMany({
        where: { id, userId },
        data: {
            title,
            template: templateSlug,
            latexSource: encrypt(source),
            compiledUrl: null,
            compiledAt: null,
        },
    });
}

export async function updateLatexResumeCompiled(
    id: string,
    userId: string,
    compiledUrl: string
) {
    return prisma.latexResume.updateMany({
        where: { id, userId },
        data: { compiledUrl, compiledAt: new Date() },
    });
}

export async function deleteLatexResume(id: string, userId: string) {
    return prisma.latexResume.deleteMany({
        where: { id, userId },
    });
}

// ── AI Assistance ───────────────────────────────────────────

export async function latexAiRewrite(selectedText: string, fullSource: string) {
    const parsed = await generateJsonWithRetry<any>({
        model: GEMINI_PRO_MODEL,
        contents: `Full LaTeX document:\n${fullSource}\n\n---\nSelected section to rewrite:\n${selectedText}`,
        config: {
            systemInstruction: LATEX_REWRITE_SYSTEM,
            ...LATEX_AI_GENERATION_CONFIG,
        },
    });
    // Inject originalText so the frontend can do reliable string-based replacement
    return { ...parsed, originalText: selectedText };
}

export async function latexAiFix(fullSource: string, errorMessages?: string) {
    const prompt = errorMessages
        ? `LaTeX source:\n${fullSource}\n\n---\nCompilation errors:\n${errorMessages}`
        : `LaTeX source:\n${fullSource}`;

    return generateJsonWithRetry({
        model: GEMINI_PRO_MODEL,
        contents: prompt,
        config: {
            systemInstruction: LATEX_FIX_SYSTEM,
            ...LATEX_AI_GENERATION_CONFIG,
        },
    });
}

export async function latexAiSuggest(fullSource: string) {
    return generateJsonWithRetry({
        model: GEMINI_PRO_MODEL,
        contents: `LaTeX resume source:\n${fullSource}`,
        config: {
            systemInstruction: LATEX_SUGGEST_SYSTEM,
            ...LATEX_AI_GENERATION_CONFIG,
        },
    });
}

export async function latexAiChat(chatMessage: string, fullSource: string) {
    return generateJsonWithRetry({
        model: GEMINI_PRO_MODEL,
        contents: `Current LaTeX document:\n${fullSource}\n\n---\nUser message:\n${chatMessage}`,
        config: {
            systemInstruction: LATEX_CHAT_SYSTEM,
            ...LATEX_AI_GENERATION_CONFIG,
        },
    });
}
export async function latexAiGenerateSummary(formData: any) {
    const systemPrompt = `You are an expert resume writer and career coach.
Your job is to write a highly professional, impactful, and concise "Professional Summary" for the user based purely on the data they have provided (Education, Experience, Projects, Skills).
Follow these strict instructions:
1. Write a 3-4 sentence paragraph that highlights their top skills, significant achievements, and overall career trajectory.
2. DO NOT use an em dash (—). Em dashes strictly break the LaTeX compiler. Use a hyphen (-) instead.
3. Be direct, authoritative, and do not use "I" or "My".
4. Return ONLY the text of the summary. Do NOT return JSON. Do not wrap in quotes. Just the raw text.`;

    const rawText = await generateTextWithRetry({
        model: GEMINI_MODEL,
        contents: `Here is the user's resume data:\n${JSON.stringify(formData, null, 2)}`,
        config: {
            systemInstruction: systemPrompt,
        },
    });

    return rawText.trim();
}

export async function latexAiRephraseSummary(text: string) {
    const systemPrompt = `You are an expert resume writer and career coach.
Your job is to professionally rephrase the user's "Professional Summary".
Follow these strict instructions:
1. Make it a 3-4 sentence paragraph that highlights their top skills and overall career trajectory based on their original text.
2. DO NOT use an em dash (—). Em dashes strictly break the LaTeX compiler. Use a hyphen (-) instead.
3. Be direct, authoritative, and do not use "I" or "My".
4. Return ONLY the rephrased text. Do NOT return JSON. Do not wrap in quotes. Just the raw text.`;

    const rawText = await generateTextWithRetry({
        model: GEMINI_MODEL,
        contents: `Here is the user's current summary draft:\n${text}`,
        config: {
            systemInstruction: systemPrompt,
        },
    });

    return rawText.trim();
}

export async function latexAiExtractResume(rawText: string) {
    const systemPrompt = `You are a strict data extraction AI.
Your job is to read the raw text of a user's uploaded PDF resume and extract the key information into a perfectly formatted JSON object that patches directly into a strict schema.
If an array is empty, return an empty list []. Extract as much meaningful detail as possible. Do NOT use em dashes.
CRITICAL: If a specific field like phone or email is missing, leave it blank (""). Do NOT hallucinate data or insert the location (e.g. "Jaipur, India") into the phone field.
The JSON must perfectly match this structure:
{
  "personalInfo": {
    "name": "string",
    "email": "string",
    "phone": "string",
    "linkedin": "string",
    "github": "string",
    "portfolio": "string",
    "summary": "string"
  },
  "education": [
    {
      "institution": "string",
      "location": "string",
      "degree": "string",
      "duration": "string",
      "gpa": "string"
    }
  ],
  "experience": [
    {
      "company": "string",
      "location": "string",
      "role": "string",
      "duration": "string",
      "bullets": ["string"]
    }
  ],
  "projects": [
    {
      "name": "string",
      "technologies": "string",
      "role": "string",
      "duration": "string",
      "bullets": ["string"]
    }
  ],
  "skills": [
    {
      "category": "string",
      "items": "string"
    }
  ]
}
Return ONLY valid JSON. No markdown backticks, no explanations.`;

    // generateJsonWithRetry retries transient model errors AND malformed JSON,
    // so a flaky response no longer silently yields an empty form. If it still
    // fails after retries it throws, and the route surfaces a real error to the
    // user instead of leaving the form mysteriously blank.
    return generateJsonWithRetry({
        model: GEMINI_MODEL,
        contents: `Raw resume text to parse:\n${rawText}`,
        config: {
            systemInstruction: systemPrompt,
            responseMimeType: "application/json",
            thinkingConfig: GEMINI_THINKING_MEDIUM,
        },
    });
}

/**
 * True when an extraction actually contains usable resume data. Used to
 * distinguish a successful-but-empty model response (which should surface as
 * an error) from a real extraction.
 */
export function extractionHasData(ext: any): boolean {
    if (!ext || typeof ext !== "object") return false;
    const personalFilled = ext.personalInfo && Object.values(ext.personalInfo).some(
        (v) => typeof v === "string" && v.trim().length > 0
    );
    return Boolean(
        personalFilled ||
        ext.education?.length ||
        ext.experience?.length ||
        ext.projects?.length ||
        ext.skills?.length
    );
}

export async function latexAiGenerateImprovementQuestions(rawText: string, atsAnalysis: any) {
    const systemPrompt = `You are an expert Resume Improvement Interviewer AI.
The user wants to improve their resume based on their ATS Action Plan. 
Your job is to generate a list of targeted questions asking ONLY for the critical missing information required to execute the ATS action plan suggestions and fix missing keywords.
If the resume lacks a summary or it is flagged as weak, ask them about their career goals and highlights to help generate a strong summary.
IMPORTANT: 
- Do NOT ask the user any questions regarding dates, working duration, chronological gaps, or recency of experience (e.g., "What have you been doing since 2023?"). Assume the user works presently or dates do not matter.
- When you identify achievements that lack quantification, ask specific questions about metrics (e.g., "How many users did your feature impact?", "What percentage improvement did you achieve?", "How much time/cost did you save?")
- Focus on getting concrete numbers and metrics that can strengthen their accomplishments

Return a perfectly formatted JSON object with a single "questions" array.
Schema:
{
  "questions": [
    {
       "id": "q1",
       "question": "What specific cloud technologies did you use at Example Corp?",
       "type": "text"
    },
    {
       "id": "q2",
       "question": "Did you manage a team during your senior role?",
       "type": "choice",
       "options": ["Yes", "No"]
    }
  ]
}
Return ONLY valid JSON. No markdown backticks.`;

    return generateJsonWithRetry({
        model: GEMINI_MODEL,
        contents: `Resume Text:\n${rawText}\n\nATS Feedback & Suggestions:\n${JSON.stringify(atsAnalysis?.suggestions)}\n\nMissing Keywords:\n${JSON.stringify(atsAnalysis?.missingKeywords)}`,
        config: {
            systemInstruction: systemPrompt,
            responseMimeType: "application/json",
            thinkingConfig: GEMINI_THINKING_MEDIUM,
        },
    });
}

export async function latexAiImproveFormData(rawText: string, atsAnalysis: any, qaPairs: {question: string, answer: string}[]) {
    const systemPrompt = `You are an advanced Resume Writer AI.
Your job is to read the user's original pdf raw text, the ATS analysis feedback they received, and the new answers they provided to your targeted improvement questions.
You must construct a massively improved, perfectly formatted JSON resume formData object that patches directly into a strict schema.
You MUST:
1. Ensure the resume has a strong Professional Summary. If the user didn't have one, generate one using their old experience and new answers.
2. Incorporate their new answers intelligently into their experience bullet points and skills list.
3. Address the ATS missing keywords and action plan suggestions natively in the text.
4. Do NOT use em dashes.
5. CRITICAL: NEVER invent specific numbers, percentages, or metrics that are not in the original resume or user's answers. Only use quantitative data that the user explicitly provided.

The JSON must perfectly match this structure:
{
  "personalInfo": {
    "name": "string",
    "email": "string",
    "phone": "string",
    "linkedin": "string",
    "github": "string",
    "portfolio": "string",
    "summary": "string"
  },
  "education": [
    {
      "institution": "string",
      "location": "string",
      "degree": "string",
      "duration": "string",
      "gpa": "string"
    }
  ],
  "experience": [
    {
      "company": "string",
      "location": "string",
      "role": "string",
      "duration": "string",
      "bullets": ["string"]
    }
  ],
  "projects": [
    {
      "name": "string",
      "technologies": "string",
      "role": "string",
      "duration": "string",
      "bullets": ["string"]
    }
  ],
  "skills": [
    {
      "category": "string",
      "items": "string"
    }
  ]
}
Return ONLY valid JSON. No markdown backticks.`;

    return generateJsonWithRetry({
        model: GEMINI_MODEL,
        contents: `Original Resume:\n${rawText}\n\nATS Feedback:\n${JSON.stringify(atsAnalysis)}\n\nUser's Interview Answers:\n${JSON.stringify(qaPairs)}`,
        config: {
            systemInstruction: systemPrompt,
            responseMimeType: "application/json",
            thinkingConfig: GEMINI_THINKING_MEDIUM,
        },
    });
}
