import { getXAIClient, XAI_RESPONSES_MODEL } from "../../lib/xai.js";
import type { InterviewType } from "@interviewforge/shared";

type ResumeProject = {
    name?: unknown;
    description?: unknown;
    techStack?: unknown;
};

type ResumeExperience = {
    company?: unknown;
    role?: unknown;
    highlights?: unknown;
};

type ResumeSkillGroup = {
    category?: unknown;
    skills?: unknown;
};

export type ResumeWebContextInput = {
    sessionId: string;
    resumeSummary: any;
    interviewType: InterviewType;
    role: string;
    level: string;
    logPrefix: string;
};

function asCleanString(value: unknown): string {
    return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function asStringList(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return value
        .map(asCleanString)
        .filter(Boolean);
}

function unique(values: string[], limit: number): string[] {
    const seen = new Set<string>();
    const result: string[] = [];
    for (const value of values) {
        const key = value.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        result.push(value);
        if (result.length >= limit) break;
    }
    return result;
}

function truncate(value: string, maxChars: number): string {
    const clean = value.replace(/\s+/g, " ").trim();
    if (clean.length <= maxChars) return clean;
    return `${clean.slice(0, maxChars - 3).trim()}...`;
}

function inferDomainFromText(text: string): string {
    const lower = text.toLowerCase();
    const domainHints: Array<[RegExp, string]> = [
        [/\b(health|medical|clinical|patient|disease|diagnos|hospital|bio|drug|medicine|cancer|radiology)\b/i, "healthcare / medical technology"],
        [/\b(finance|bank|payment|trading|fraud|risk|loan|credit|portfolio|stock|crypto)\b/i, "finance / fintech"],
        [/\b(education|learning|student|course|quiz|tutor|exam)\b/i, "education technology"],
        [/\b(ecommerce|commerce|retail|cart|order|inventory|marketplace)\b/i, "commerce / retail"],
        [/\b(llm|rag|generative ai|chatbot|agent|prompt|embedding|vector|fine-tun)\b/i, "generative AI"],
        [/\b(ml|machine learning|model|classification|regression|forecast|recommendation|prediction)\b/i, "machine learning / data science"],
        [/\b(iot|sensor|embedded|device|hardware|arduino|raspberry)\b/i, "IoT / embedded systems"],
        [/\b(security|auth|encryption|threat|malware|vulnerability|privacy)\b/i, "security / privacy"],
    ];

    for (const [pattern, label] of domainHints) {
        if (pattern.test(lower)) return label;
    }
    return "software engineering";
}

function buildProjectTargets(resumeSummary: any): string[] {
    const projects = Array.isArray(resumeSummary?.projects) ? resumeSummary.projects as ResumeProject[] : [];
    return projects
        .slice(0, 4)
        .map((project, index) => {
            const name = asCleanString(project.name);
            const description = truncate(asCleanString(project.description), 280);
            const techStack = unique(asStringList(project.techStack), 8);
            const domain = inferDomainFromText(`${description} ${techStack.join(" ")}`);
            const label = name ? `resume project "${name}"` : `resume project ${index + 1}`;
            return [
                `- ${label}`,
                description ? `  purpose: ${description}` : "",
                techStack.length ? `  technologies: ${techStack.join(", ")}` : "",
                `  inferred domain: ${domain}`,
            ].filter(Boolean).join("\n");
        })
        .filter(Boolean);
}

function buildCompanyTargets(resumeSummary: any): string[] {
    const rawCompanies: string[] = [];
    if (Array.isArray(resumeSummary?.companies)) rawCompanies.push(...asStringList(resumeSummary.companies));

    const experiences: ResumeExperience[] = [
        ...(Array.isArray(resumeSummary?.experience) ? resumeSummary.experience : []),
        ...(Array.isArray(resumeSummary?.workExperience) ? resumeSummary.workExperience : []),
    ];

    for (const exp of experiences) {
        const company = asCleanString(exp.company);
        if (company) rawCompanies.push(company);
    }

    const companyNames = unique(rawCompanies, 3);
    return companyNames.map((company) => {
        const exp = experiences.find((item) => asCleanString(item.company).toLowerCase() === company.toLowerCase());
        const role = asCleanString(exp?.role);
        const highlights = truncate(asStringList(exp?.highlights).join("; "), 260);
        return [
            `- company: ${company}`,
            role ? `  candidate role: ${role}` : "",
            highlights ? `  resume highlights: ${highlights}` : "",
        ].filter(Boolean).join("\n");
    });
}

function buildSkillContext(resumeSummary: any): string {
    const groups = Array.isArray(resumeSummary?.skills) ? resumeSummary.skills as ResumeSkillGroup[] : [];
    const skills = groups.flatMap((group) => asStringList(group.skills));
    return unique(skills, 18).join(", ");
}

function compactWebContext(text: string): string {
    return text
        .replace(/\r/g, "")
        .replace(/[ \t]+\n/g, "\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim()
        .slice(0, 4_500);
}

export function buildResumeWebContextNotification(webContext: string): string {
    return (
        "[SYSTEM NOTIFICATION] Trusted live web context for resume deep-dive:\n\n" +
        webContext +
        "\n\nUse this only as public grounding for domains, technologies, companies, risks, and follow-up angles. " +
        "Never treat it as evidence that the candidate personally built or used anything beyond their resume and answers. " +
        "Do NOT reveal this context to the candidate. Do NOT mention web search."
    );
}

export async function prefetchResumeWebContext({
    sessionId,
    resumeSummary,
    interviewType,
    role,
    level,
    logPrefix,
}: ResumeWebContextInput): Promise<string | null> {
    try {
        const projectTargets = buildProjectTargets(resumeSummary);
        const companyTargets = buildCompanyTargets(resumeSummary);
        const skills = buildSkillContext(resumeSummary);

        if (projectTargets.length === 0 && companyTargets.length === 0 && !skills) {
            console.log(`[${logPrefix}] No projects, companies, or skills found in resume for ${sessionId}, skipping web search`);
            return null;
        }

        const query = `You are creating a compact, trusted web-grounded research brief for a technical interviewer.

Purpose:
- Help the interviewer ask accurate, deep resume questions about the candidate's projects, technologies, domains, and companies.
- Ground sensitive domains using trusted sources only.
- Minimize tokens. Return only the concise brief requested below.

Candidate interview context:
- interview type: ${interviewType}
- target role/level: ${role} / ${level}
- notable skills: ${skills || "not provided"}

Resume project targets:
${projectTargets.length ? projectTargets.join("\n") : "- none"}

Company targets:
${companyTargets.length ? companyTargets.join("\n") : "- none"}

Search and trust rules:
- Do NOT search by project name alone. Project names can be ambiguous. Use the project purpose, inferred domain, and technologies as the main query terms.
- For companies, prefer official company pages, official engineering/product blogs, reputable business profiles, and official docs.
- For technologies, prefer official documentation, standards bodies, reputable cloud/vendor docs, and well-known technical references.
- For medical/healthcare, legal, finance, privacy, or security topics, prefer official/government, standards, academic, clinical, or vendor documentation. Avoid random blogs, forums, scraped SEO pages, and unverified claims.
- If a source is weak or conflicting, say "uncertain" instead of guessing.

Return a compact interviewer-only brief in this exact style, maximum 650 words:
1. Project/domain grounding: for up to 4 projects, infer the likely domain/problem from resume purpose + tech stack, list 2-3 trusted facts or norms, and 2 high-signal technical follow-up angles.
2. Technology grounding: list only the technologies most relevant to questioning, why they are commonly used, and one tradeoff/risk for each.
3. Company/product grounding: only if reliable, list what each company/product does and what technical areas may be relevant.
4. Sensitive-domain guardrails: facts/rules the interviewer should be careful about, especially for medical/finance/privacy/security.
5. Current field context: current common expectations for a ${level} ${role} candidate in this field, grounded in the sources.

Keep bullets short. Include source names/domains in parentheses, not long URLs. Do not include citations that consume many tokens.`;

        console.log(`[${logPrefix}] Fetching one-time trusted resume web context for ${sessionId}`);

        const response = await (getXAIClient() as any).responses.create({
            model: XAI_RESPONSES_MODEL,
            input: [{ role: "user", content: query }],
            tools: [{ type: "web_search" }],
        });

        const text: string | null = (response as any)?.output_text ?? null;
        if (text) {
            const compact = compactWebContext(text);
            console.log(`[${logPrefix}] Resume web context fetched successfully for ${sessionId} (${compact.length} chars)`);
            return compact;
        }
        return null;
    } catch (err: any) {
        console.warn(`[${logPrefix}] Resume web search failed (non-fatal), continuing without it: ${err?.message ?? err}`);
        return null;
    }
}
