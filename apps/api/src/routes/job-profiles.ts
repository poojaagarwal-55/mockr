import { FastifyInstance } from "fastify";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { prisma } from "../lib/prisma.js";
import { cacheDel } from "../lib/redis.js";
import { checkRateLimit } from "../lib/rate-limiter.js";
import { getPresignedDownloadUrl, uploadToR2Avatar } from "../lib/r2.js";
import { generateTextWithRetry, GEMINI_MODEL, extractJsonObject } from "../lib/gemini.js";
import { getXAIClient, XAI_MODEL } from "../lib/xai.js";

const jobApplyProfile = (prisma as any).jobApplyProfile;

// ── Voice onboarding (Grok TTS + Deepgram STT) ──────────────────────────────
const XAI_TTS_URL = "https://api.x.ai/v1/tts";
// "rex" is the confident interviewer voice; "gemma" is warmer/female for the
// friendly profile guide. Falls back to rex if the account lacks the voice.
const ONBOARD_TTS_VOICE = process.env.XAI_ONBOARD_TTS_VOICE || "gemma";
const DEEPGRAM_LISTEN_URL = "https://api.deepgram.com/v1/listen?model=nova-2&smart_format=true&punctuate=true";

/** Wrap raw signed-16-bit little-endian mono PCM in a minimal WAV container. */
function pcmToWav(pcm: Buffer, sampleRate = 24000): Buffer {
    const numChannels = 1;
    const bitsPerSample = 16;
    const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
    const blockAlign = (numChannels * bitsPerSample) / 8;
    const header = Buffer.alloc(44);
    header.write("RIFF", 0);
    header.writeUInt32LE(36 + pcm.length, 4);
    header.write("WAVE", 8);
    header.write("fmt ", 12);
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20); // PCM
    header.writeUInt16LE(numChannels, 22);
    header.writeUInt32LE(sampleRate, 24);
    header.writeUInt32LE(byteRate, 28);
    header.writeUInt16LE(blockAlign, 32);
    header.writeUInt16LE(bitsPerSample, 34);
    header.write("data", 36);
    header.writeUInt32LE(pcm.length, 40);
    return Buffer.concat([header, pcm]);
}

const speakSchema = z.object({
    text: z.string().trim().min(1).max(600),
});

const improveFieldSchema = z.object({
    field: z.enum(["about", "headline", "experience", "project", "featured", "education"]),
    text: z.string().trim().min(1).max(2600),
    context: z.string().trim().max(400).optional().nullable(),
});

const extractSchema = z.object({
    transcript: z.string().trim().min(1).max(2000),
    fields: z
        .array(
            z.object({
                key: z.string().trim().min(1).max(40),
                label: z.string().trim().min(1).max(80),
                hint: z.string().trim().max(200).optional().nullable(),
            })
        )
        .min(1)
        .max(24),
});

const IMPROVE_GUIDANCE: Record<string, string> = {
    about:
        "This is the 'About' summary on a job-seeker's public profile. Rewrite it as a confident, warm, first-person professional summary of 3-5 sentences. Lead with who they are and their strongest value, then what they're great at, then what they want next.",
    headline:
        "This is a profile headline (like a professional tagline). Rewrite it as ONE punchy line under 120 characters, no period at the end, that tells recruiters what this person does best.",
    experience:
        "This is the description of ONE work experience / internship. Rewrite it as 2-4 tight, impact-first bullet-style sentences using strong action verbs (built, led, shipped, reduced, automated). Keep every fact from the original.",
    project:
        "This is the description of ONE project. Rewrite it as 2-4 clear sentences: what it does, the problem it solves, and the person's role/impact. Keep it concrete and recruiter-friendly.",
    featured:
        "This is the description of a featured highlight (a launch, award, or write-up). Rewrite it as 1-2 crisp, engaging sentences.",
    education:
        "This is an education detail. Rewrite it into clean, correctly-formatted, professional wording.",
};

// ── Autofill from resume (PDF → structured profile) ─────────────────────────
// pdf-parse v1.1.1 is CJS-only; load it through createRequire in ESM context.
const requirePdf = createRequire(import.meta.url);
async function extractTextFromPdf(buffer: Buffer): Promise<string> {
    const pdfParse = requirePdf("pdf-parse");
    const data = await pdfParse(buffer);
    return data.text as string;
}

const AUTOFILL_SYSTEM =
    "You are a precise resume parser. Read the resume text and extract the candidate's profile as strict JSON. " +
    "Use ONLY information present in the resume — never invent employers, dates, skills, or metrics. " +
    "Return ONLY a JSON object with this exact shape (omit a field or use an empty string/array if unknown):\n" +
    "{\n" +
    '  "headline": string (a one-line professional headline),\n' +
    '  "industry": string,\n' +
    '  "city": string,\n' +
    '  "country": string,\n' +
    '  "about": string (a 2-4 sentence professional summary in first person),\n' +
    '  "openTo": string (roles they are targeting),\n' +
    '  "linkedinUrl": string, "githubUrl": string,\n' +
    '  "leetcodeUrl": string, "geeksforgeeksUrl": string, "codeforcesUrl": string, "codechefUrl": string,\n' +
    '  "skills": string[],\n' +
    '  "experiences": [{ "title": string, "company": string, "employmentType": string, "startDate": "YYYY-MM", "endDate": "YYYY-MM or empty if current", "location": string, "description": string }],\n' +
    '  "education": [{ "school": string, "degree": string, "field": string, "startDate": "YYYY-MM", "endDate": "YYYY-MM" }],\n' +
    '  "projects": [{ "title": string, "role": string, "startDate": "YYYY-MM", "endDate": "YYYY-MM", "description": string, "technologies": string[] }]\n' +
    "}\n" +
    "Dates must be 'YYYY-MM' (or 'YYYY-MM-DD') when the resume gives them, otherwise empty string. Return ONLY the JSON.";

function str(value: unknown, max: number): string {
    if (value == null || typeof value === "object") return "";
    return String(value).trim().slice(0, max);
}
function strArray(value: unknown, max: number, itemMax: number): string[] {
    if (!Array.isArray(value)) return [];
    return value
        .map((v) => str(v, itemMax))
        .filter(Boolean)
        .slice(0, max);
}
function optUrl(value: unknown): string {
    const s = str(value, 500);
    return /^https?:\/\//i.test(s) ? s : "";
}

function sanitizeAutofill(obj: Record<string, unknown>) {
    const asArray = (v: unknown): Record<string, unknown>[] =>
        Array.isArray(v) ? v.filter((x) => x && typeof x === "object") : [];

    return {
        headline: str(obj.headline, 220),
        industry: str(obj.industry, 120),
        city: str(obj.city, 120),
        country: str(obj.country, 120),
        about: str(obj.about, 2600),
        openTo: str(obj.openTo, 180),
        linkedinUrl: optUrl(obj.linkedinUrl),
        githubUrl: optUrl(obj.githubUrl),
        leetcodeUrl: optUrl(obj.leetcodeUrl),
        geeksforgeeksUrl: optUrl(obj.geeksforgeeksUrl),
        codeforcesUrl: optUrl(obj.codeforcesUrl),
        codechefUrl: optUrl(obj.codechefUrl),
        skills: strArray(obj.skills, 50, 80),
        experiences: asArray(obj.experiences)
            .map((e) => ({
                title: str(e.title, 160),
                company: str(e.company, 160),
                employmentType: str(e.employmentType, 80),
                startDate: str(e.startDate, 40),
                endDate: str(e.endDate, 40),
                location: str(e.location, 160),
                description: str(e.description, 1200),
            }))
            .filter((e) => e.title || e.company)
            .slice(0, 20),
        education: asArray(obj.education)
            .map((e) => ({
                school: str(e.school, 180),
                degree: str(e.degree, 180),
                field: str(e.field, 180),
                startDate: str(e.startDate, 40),
                endDate: str(e.endDate, 40),
            }))
            .filter((e) => e.school || e.degree)
            .slice(0, 20),
        projects: asArray(obj.projects)
            .map((p) => ({
                title: str(p.title, 160),
                role: str(p.role, 120),
                startDate: str(p.startDate, 40),
                endDate: str(p.endDate, 40),
                description: str(p.description, 1200),
                technologies: strArray(p.technologies, 20, 80),
            }))
            .filter((p) => p.title)
            .slice(0, 30),
    };
}

const usernameSchema = z
    .string()
    .trim()
    .min(3)
    .max(32)
    .regex(/^[a-z0-9](?:[a-z0-9_-]*[a-z0-9])?$/i, "Use 3-32 letters, numbers, underscores, or hyphens.");

const shortText = (max: number) => z.string().trim().max(max).optional().nullable();
const optionalUrl = z.preprocess(
    (value) => (typeof value === "string" && value.trim() === "" ? null : value),
    z.string().url().max(500).optional().nullable()
);
const optionalUuid = z.preprocess(
    (value) => (typeof value === "string" && value.trim() === "" ? null : value),
    z.string().uuid().optional().nullable()
);

const experienceSchema = z.object({
    id: z.string().min(1).max(80),
    title: z.string().trim().min(1).max(160),
    company: z.string().trim().min(1).max(160),
    employmentType: shortText(80),
    startDate: z.string().trim().min(1).max(40),
    endDate: shortText(40),
    location: shortText(160),
    locationType: shortText(80),
    description: shortText(1200),
    logoUrl: optionalUrl,
});

const educationSchema = z.object({
    id: z.string().min(1).max(80),
    school: z.string().trim().min(1).max(180),
    degree: z.string().trim().min(1).max(180),
    field: shortText(180),
    startDate: z.string().trim().min(1).max(40),
    endDate: shortText(40),
    logoUrl: optionalUrl,
});

const skillSchema = z.object({
    id: z.string().min(1).max(80),
    name: z.string().trim().min(1).max(80),
    context: shortText(180),
});

const featuredSchema = z.object({
    id: z.string().min(1).max(80),
    title: z.string().trim().min(1).max(160),
    description: shortText(500),
    imageUrl: optionalUrl,
    linkUrl: optionalUrl,
});

const projectSchema = z.object({
    id: z.string().min(1).max(80),
    title: z.string().trim().min(1).max(160),
    role: shortText(120),
    startDate: z.string().trim().max(40).optional().nullable(),
    endDate: shortText(40),
    description: shortText(1200),
    technologies: z.array(z.string().trim().min(1).max(80)).max(20).optional().nullable(),
    imageUrl: optionalUrl,
});

const jobProfileSchema = z.object({
    profileLanguage: z.string().trim().min(1).max(60).optional(),
    pronouns: shortText(40),
    headline: shortText(220),
    industry: shortText(120),
    city: shortText(120),
    country: shortText(120),
    postalCode: shortText(20),
    about: shortText(2600),
    openTo: shortText(180),
    coverImageUrl: optionalUrl,
    selectedResumeId: optionalUuid,
    leetcodeUrl: optionalUrl,
    geeksforgeeksUrl: optionalUrl,
    codeforcesUrl: optionalUrl,
    codechefUrl: optionalUrl,
    experiences: z.array(experienceSchema).max(20).optional(),
    education: z.array(educationSchema).max(20).optional(),
    skills: z.array(skillSchema).max(50).optional(),
    featured: z.array(featuredSchema).max(12).optional(),
    projects: z.array(projectSchema).max(30).optional(),
    isPublished: z.boolean().optional(),
});

const codingProfilesSchema = z.object({
    leetcodeUrl: optionalUrl,
    geeksforgeeksUrl: optionalUrl,
    codeforcesUrl: optionalUrl,
    codechefUrl: optionalUrl,
});

const usernameParamSchema = z.object({
    username: usernameSchema,
});

function normalizeUsername(username: string) {
    return username.trim().toLowerCase();
}

function getResumeObjectKey(fileUrl: string) {
    if (fileUrl.startsWith("/uploads/resumes/")) {
        const filename = fileUrl.replace("/uploads/resumes/", "");
        return `resumes/${filename}`;
    }

    if (fileUrl.startsWith("/uploads/")) {
        const filename = fileUrl.replace("/uploads/", "");
        return `resumes/${filename}`;
    }

    if (fileUrl.startsWith("http")) {
        const pathSegments = new URL(fileUrl).pathname.replace(/^\//, "").split("/");
        return pathSegments.slice(1).join("/");
    }

    throw new Error("Invalid resume file URL format");
}

async function getSelectedResumePreview(profile: any, userId: string) {
    if (!profile?.selectedResumeId) return null;

    const resume = await prisma.resume.findFirst({
        where: { id: profile.selectedResumeId, userId },
        select: { id: true, fileName: true, fileUrl: true, uploadedAt: true },
    });

    if (!resume) return null;

    try {
        const previewUrl = await getPresignedDownloadUrl(getResumeObjectKey(resume.fileUrl), 3600);
        return {
            id: resume.id,
            fileName: resume.fileName,
            uploadedAt: resume.uploadedAt,
            previewUrl,
        };
    } catch {
        return {
            id: resume.id,
            fileName: resume.fileName,
            uploadedAt: resume.uploadedAt,
            previewUrl: null,
        };
    }
}

async function buildProfileResponse(user: any, profile: any) {
    return {
        user: {
            id: user.id,
            fullName: user.fullName,
            email: user.email,
            username: user.username,
            avatarUrl: user.avatarUrl,
            location: user.location,
            website: user.website,
            githubUrl: user.githubUrl,
            linkedinUrl: user.linkedinUrl,
            skills: user.skills,
            workExperience: user.workExperience,
            education: user.education,
        },
        profile: profile ?? null,
        resume: await getSelectedResumePreview(profile, user.id),
    };
}

export default async function jobProfileRoutes(fastify: FastifyInstance) {
    fastify.addHook("preHandler", fastify.authenticate);

    fastify.get("/job-profiles/me", async (request, reply) => {
        const user = await prisma.user.findUnique({
            where: { id: request.user!.id },
            select: {
                id: true,
                fullName: true,
                email: true,
                username: true,
                avatarUrl: true,
                location: true,
                website: true,
                githubUrl: true,
                linkedinUrl: true,
                skills: true,
                workExperience: true,
                education: true,
            },
        });

        if (!user) {
            return reply.status(404).send({ error: "Not Found", message: "User not found." });
        }

        const profile = await jobApplyProfile.findUnique({
            where: { userId: request.user!.id },
        });

        return buildProfileResponse(user, profile);
    });

    fastify.put("/job-profiles/me", async (request, reply) => {
        const parsed = jobProfileSchema.safeParse(request.body);
        if (!parsed.success) {
            return reply.status(400).send({
                error: "Validation Error",
                details: parsed.error.flatten().fieldErrors,
            });
        }

        const userId = request.user!.id;
        const data = { ...parsed.data, isPublished: true };
        const rl = checkRateLimit(`job-profile:update:${userId}`, 40, 600_000);
        if (!rl.allowed) {
            return reply.status(429).send({
                error: "Too Many Requests",
                message: `Profile update limit reached. Retry in ${Math.ceil(rl.retryAfterMs / 1000)}s.`,
            });
        }

        const owner = await prisma.user.findUnique({
            where: { id: userId },
            select: { username: true },
        });
        if (!owner?.username) {
            return reply.status(400).send({
                error: "Username Required",
                message: "Save a unique username before saving your public profile.",
            });
        }

        if (data.selectedResumeId) {
            const resume = await prisma.resume.findFirst({
                where: { id: data.selectedResumeId, userId },
                select: { id: true },
            });
            if (!resume) {
                return reply.status(400).send({
                    error: "Validation Error",
                    message: "Selected resume does not belong to this account.",
                });
            }
        }

        const profile = await jobApplyProfile.upsert({
            where: { userId },
            create: {
                userId,
                ...data,
            },
            update: data,
        });

        await cacheDel([`api:users:${userId}:profile`]);
        return { profile };
    });

    fastify.post("/job-profiles/assets", async (request, reply) => {
        const userId = request.user!.id;
        const rl = checkRateLimit(`job-profile:asset:${userId}`, 12, 600_000);
        if (!rl.allowed) {
            return reply.status(429).send({
                error: "Too Many Requests",
                message: `Upload limit reached. Retry in ${Math.ceil(rl.retryAfterMs / 1000)}s.`,
            });
        }

        const data = await request.file();
        if (!data) {
            return reply.status(400).send({ error: "No file provided", message: "Choose an image file." });
        }

        const allowedTypes = ["image/jpeg", "image/png", "image/webp"];
        if (!allowedTypes.includes(data.mimetype)) {
            return reply.status(400).send({
                error: "Invalid file type",
                message: "Only JPEG, PNG, or WebP images are allowed.",
            });
        }

        const buffer = await data.toBuffer();
        if (buffer.length > 3 * 1024 * 1024) {
            return reply.status(400).send({
                error: "File too large",
                message: "Image must be under 3MB.",
            });
        }

        const ext = data.mimetype === "image/jpeg" ? "jpg" : data.mimetype.split("/")[1];
        const key = `job-profiles/${userId}/covers/${randomUUID()}.${ext}`;
        const fileUrl = await uploadToR2Avatar(key, buffer, data.mimetype);

        return reply.status(201).send({ fileUrl });
    });

    fastify.patch("/job-profiles/coding-profiles", async (request, reply) => {
        const parsed = codingProfilesSchema.safeParse(request.body);
        if (!parsed.success) {
            return reply.status(400).send({
                error: "Validation Error",
                details: parsed.error.flatten().fieldErrors,
            });
        }

        const userId = request.user!.id;
        const profile = await jobApplyProfile.upsert({
            where: { userId },
            create: {
                userId,
                ...parsed.data,
            },
            update: parsed.data,
        });

        await cacheDel([`api:users:${userId}:profile`]);
        return {
            codingProfiles: {
                leetcodeUrl: profile.leetcodeUrl,
                geeksforgeeksUrl: profile.geeksforgeeksUrl,
                codeforcesUrl: profile.codeforcesUrl,
                codechefUrl: profile.codechefUrl,
            },
        };
    });

    fastify.get("/job-profiles/username/:username", async (request, reply) => {
        const parsed = usernameParamSchema.safeParse(request.params);
        if (!parsed.success) {
            return reply.status(400).send({ error: "Validation Error", details: parsed.error.flatten().fieldErrors });
        }

        const username = normalizeUsername(parsed.data.username);
        const existing = await prisma.user.findFirst({
            where: {
                username,
                id: { not: request.user!.id },
            },
            select: { id: true },
        });

        return { username, available: !existing };
    });

    fastify.patch("/job-profiles/username", async (request, reply) => {
        const parsed = z.object({ username: usernameSchema }).safeParse(request.body);
        if (!parsed.success) {
            return reply.status(400).send({ error: "Validation Error", details: parsed.error.flatten().fieldErrors });
        }

        const userId = request.user!.id;
        const username = normalizeUsername(parsed.data.username);
        const rl = checkRateLimit(`job-profile:username:${userId}`, 12, 600_000);
        if (!rl.allowed) {
            return reply.status(429).send({
                error: "Too Many Requests",
                message: `Username check limit reached. Retry in ${Math.ceil(rl.retryAfterMs / 1000)}s.`,
            });
        }

        const existing = await prisma.user.findFirst({
            where: {
                username,
                id: { not: userId },
            },
            select: { id: true },
        });

        if (existing) {
            return reply.status(409).send({
                error: "Username Taken",
                message: "That profile URL is already taken.",
            });
        }

        const user = await prisma.user.update({
            where: { id: userId },
            data: { username },
            select: { id: true, username: true },
        });

        await cacheDel([`api:users:${userId}:profile`]);
        return { username: user.username };
    });

    fastify.get("/job-profiles/by-username/:username", async (request, reply) => {
        const parsed = usernameParamSchema.safeParse(request.params);
        if (!parsed.success) {
            return reply.status(400).send({ error: "Validation Error", details: parsed.error.flatten().fieldErrors });
        }

        const user = await prisma.user.findUnique({
            where: { username: normalizeUsername(parsed.data.username) },
            select: {
                id: true,
                fullName: true,
                email: true,
                username: true,
                avatarUrl: true,
                location: true,
                website: true,
                githubUrl: true,
                linkedinUrl: true,
                skills: true,
                workExperience: true,
                education: true,
            },
        });

        if (!user) {
            return reply.status(404).send({ error: "Not Found", message: "Profile not found." });
        }

        const profile = await jobApplyProfile.findUnique({
            where: { userId: user.id },
        });

        if (!profile?.isPublished) {
            return reply.status(404).send({ error: "Not Found", message: "Profile not found." });
        }

        return buildProfileResponse(user, profile);
    });

    // Grok TTS — make the onboarding guide "speak" a line. Returns WAV audio.
    fastify.post("/job-profiles/voice/speak", async (request, reply) => {
        const parsed = speakSchema.safeParse(request.body);
        if (!parsed.success) {
            return reply.status(400).send({ error: "Validation Error", details: parsed.error.flatten().fieldErrors });
        }

        const userId = request.user!.id;
        const rl = checkRateLimit(`job-profile:speak:${userId}`, 120, 600_000);
        if (!rl.allowed) {
            return reply.status(429).send({
                error: "Too Many Requests",
                message: `Voice limit reached. Retry in ${Math.ceil(rl.retryAfterMs / 1000)}s.`,
            });
        }

        const apiKey = process.env.XAI_API_KEY;
        if (!apiKey) {
            return reply.status(503).send({ error: "Voice Unavailable", message: "Voice guide is not configured." });
        }

        const requestTts = (voiceId: string) =>
            fetch(XAI_TTS_URL, {
                method: "POST",
                headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
                body: JSON.stringify({
                    text: parsed.data.text,
                    voice_id: voiceId,
                    language: "en",
                    output_format: { codec: "pcm", sample_rate: 24000 },
                }),
            });

        try {
            // Prefer the warmer configured voice; fall back to the proven "rex"
            // voice if the account doesn't have it, so speech never silently dies.
            let upstream = await requestTts(ONBOARD_TTS_VOICE);
            if (!upstream.ok && ONBOARD_TTS_VOICE !== "rex") {
                upstream = await requestTts("rex");
            }

            if (!upstream.ok || !upstream.body) {
                const detail = await upstream.text().catch(() => "");
                request.log.warn({ status: upstream.status, detail }, "onboard TTS failed");
                return reply.status(502).send({ error: "Voice Failed", message: "Could not generate speech." });
            }

            const pcm = Buffer.from(await upstream.arrayBuffer());
            const wav = pcmToWav(pcm, 24000);
            reply.header("Content-Type", "audio/wav");
            reply.header("Cache-Control", "no-store");
            return reply.send(wav);
        } catch (err) {
            request.log.error({ err }, "onboard TTS error");
            return reply.status(502).send({ error: "Voice Failed", message: "Could not generate speech." });
        }
    });

    // Deepgram STT — transcribe a short spoken answer into text.
    fastify.post("/job-profiles/voice/transcribe", async (request, reply) => {
        const userId = request.user!.id;
        const rl = checkRateLimit(`job-profile:transcribe:${userId}`, 120, 600_000);
        if (!rl.allowed) {
            return reply.status(429).send({
                error: "Too Many Requests",
                message: `Voice limit reached. Retry in ${Math.ceil(rl.retryAfterMs / 1000)}s.`,
            });
        }

        const dgKey = process.env.DEEPGRAM_API_KEY;
        if (!dgKey) {
            return reply.status(503).send({ error: "Voice Unavailable", message: "Voice input is not configured." });
        }

        const data = await request.file();
        if (!data) {
            return reply.status(400).send({ error: "No audio", message: "No audio was received." });
        }
        const buffer = await data.toBuffer();
        if (buffer.length === 0 || buffer.length > 8 * 1024 * 1024) {
            return reply.status(400).send({ error: "Invalid audio", message: "Audio clip is empty or too large." });
        }

        try {
            const upstream = await fetch(DEEPGRAM_LISTEN_URL, {
                method: "POST",
                headers: {
                    Authorization: `Token ${dgKey}`,
                    "Content-Type": data.mimetype || "audio/webm",
                },
                body: new Uint8Array(buffer),
            });
            const payload = (await upstream.json().catch(() => ({}))) as any;
            if (!upstream.ok) {
                request.log.warn({ status: upstream.status, payload }, "deepgram transcribe failed");
                return reply.status(502).send({ error: "Transcription Failed", message: "Could not understand the audio." });
            }
            const transcript: string =
                payload?.results?.channels?.[0]?.alternatives?.[0]?.transcript ?? "";
            return { transcript: transcript.trim() };
        } catch (err) {
            request.log.error({ err }, "deepgram transcribe error");
            return reply.status(502).send({ error: "Transcription Failed", message: "Could not understand the audio." });
        }
    });

    // Gemini — rewrite a single free-text field into polished, structured English.
    fastify.post("/job-profiles/improve", async (request, reply) => {
        const parsed = improveFieldSchema.safeParse(request.body);
        if (!parsed.success) {
            return reply.status(400).send({ error: "Validation Error", details: parsed.error.flatten().fieldErrors });
        }

        const userId = request.user!.id;
        const rl = checkRateLimit(`job-profile:improve:${userId}`, 40, 600_000);
        if (!rl.allowed) {
            return reply.status(429).send({
                error: "Too Many Requests",
                message: `AI improve limit reached. Retry in ${Math.ceil(rl.retryAfterMs / 1000)}s.`,
            });
        }

        const { field, text, context } = parsed.data;
        const guidance = IMPROVE_GUIDANCE[field] ?? IMPROVE_GUIDANCE.about;
        const systemInstruction =
            "You are an expert career writer helping a job seeker polish their public profile. " +
            "Rewrite the user's text into clear, professional, grammatically-correct English. " +
            "STRICT RULES: Never invent facts, numbers, employers, dates, or achievements that are not in the original. " +
            "Keep the person's own voice and meaning. Do not add markdown, quotes, headings, or commentary. " +
            "Return ONLY the rewritten text, nothing else.";

        const prompt =
            `${guidance}\n\n` +
            (context ? `Context: ${context}\n\n` : "") +
            `Original text:\n"""\n${text}\n"""\n\n` +
            "Rewrite it now. Output only the improved text.";

        // Prefer Grok (same working key as the voice guide); fall back to Gemini
        // if xAI is unavailable, so the feature survives either provider's outage.
        const runXai = async () => {
            const completion = await getXAIClient().chat.completions.create({
                model: XAI_MODEL,
                messages: [
                    { role: "system", content: systemInstruction },
                    { role: "user", content: prompt },
                ],
                temperature: 0.5,
                max_tokens: 900,
            });
            return completion.choices?.[0]?.message?.content ?? "";
        };
        const runGemini = () =>
            generateTextWithRetry({
                model: GEMINI_MODEL,
                contents: prompt,
                config: { systemInstruction, temperature: 0.5 },
            });

        try {
            let raw = "";
            try {
                raw = await runXai();
            } catch (xaiErr) {
                request.log.warn({ err: xaiErr }, "job-profile improve: xAI failed, trying Gemini");
                raw = await runGemini();
            }
            const improved = raw
                .replace(/^```[a-z]*\n?/i, "")
                .replace(/```$/i, "")
                .replace(/^["']|["']$/g, "")
                .trim();
            if (!improved) {
                return reply.status(502).send({ error: "Improve Failed", message: "Could not improve the text." });
            }
            return { improved };
        } catch (err) {
            request.log.error({ err }, "job-profile improve error");
            return reply.status(502).send({ error: "Improve Failed", message: "Could not improve the text right now." });
        }
    });

    // Grok — turn one spoken sentence into structured values for the step's
    // fields. e.g. "Bangalore, India, fintech" → {city, country, industry}.
    fastify.post("/job-profiles/extract", async (request, reply) => {
        const parsed = extractSchema.safeParse(request.body);
        if (!parsed.success) {
            return reply.status(400).send({ error: "Validation Error", details: parsed.error.flatten().fieldErrors });
        }

        const userId = request.user!.id;
        const rl = checkRateLimit(`job-profile:extract:${userId}`, 120, 600_000);
        if (!rl.allowed) {
            return reply.status(429).send({
                error: "Too Many Requests",
                message: `Voice limit reached. Retry in ${Math.ceil(rl.retryAfterMs / 1000)}s.`,
            });
        }

        const { transcript, fields } = parsed.data;
        const fieldList = fields
            .map((f) => `- ${f.key}: ${f.label}${f.hint ? ` (${f.hint})` : ""}`)
            .join("\n");

        const system =
            "You convert a job seeker's spoken answer into structured profile fields. " +
            "You are given a list of fields (key: label) and what the user said. " +
            "Return a JSON object mapping field keys to the value the user intends for that field. " +
            "Rules: Only include keys the user actually provided — omit every field they did not mention. " +
            "Infer the mapping sensibly from meaning, not word order (a city name goes to a city field, a country to a country field, a domain like 'fintech' or 'SaaS' to industry). " +
            "Fix casing and obvious speech-to-text errors, but NEVER invent facts. Every value must be a plain string. " +
            "Return ONLY a JSON object, nothing else.";
        const user = `Fields:\n${fieldList}\n\nThe user said:\n"""${transcript}"""\n\nReturn the JSON object.`;

        try {
            const completion = await getXAIClient().chat.completions.create({
                model: XAI_MODEL,
                messages: [
                    { role: "system", content: system },
                    { role: "user", content: user },
                ],
                temperature: 0.1,
                max_tokens: 500,
            });
            const raw = completion.choices?.[0]?.message?.content ?? "{}";

            let obj: Record<string, unknown> = {};
            try {
                obj = extractJsonObject<Record<string, unknown>>(raw);
            } catch {
                obj = {};
            }

            const allowed = new Set(fields.map((f) => f.key));
            const values: Record<string, string> = {};
            for (const [key, value] of Object.entries(obj)) {
                if (!allowed.has(key) || value == null || typeof value === "object") continue;
                const str = String(value).trim();
                if (str) values[key] = str.slice(0, 2000);
            }
            return { values };
        } catch (err) {
            request.log.error({ err }, "job-profile extract error");
            return reply.status(502).send({ error: "Extract Failed", message: "Could not understand that. Try again or type." });
        }
    });

    // Autofill — parse an uploaded resume PDF and return a structured profile
    // that pre-fills the whole onboarding flow.
    fastify.post("/job-profiles/autofill", async (request, reply) => {
        const userId = request.user!.id;
        const rl = checkRateLimit(`job-profile:autofill:${userId}`, 8, 600_000);
        if (!rl.allowed) {
            return reply.status(429).send({
                error: "Too Many Requests",
                message: `Autofill limit reached. Retry in ${Math.ceil(rl.retryAfterMs / 1000)}s.`,
            });
        }

        const apiKey = process.env.XAI_API_KEY;
        if (!apiKey) {
            return reply.status(503).send({ error: "Autofill Unavailable", message: "Resume autofill is not configured." });
        }

        const data = await request.file();
        if (!data) {
            return reply.status(400).send({ error: "No file", message: "Upload a PDF resume." });
        }
        if (data.mimetype !== "application/pdf") {
            return reply.status(400).send({ error: "Invalid file type", message: "Only PDF resumes are accepted." });
        }
        const buffer = await data.toBuffer();
        if (buffer.length === 0 || buffer.length > 6 * 1024 * 1024) {
            return reply.status(400).send({ error: "Invalid file", message: "Resume is empty or larger than 6MB." });
        }

        let rawText: string;
        try {
            rawText = await extractTextFromPdf(buffer);
        } catch (err) {
            request.log.warn({ err }, "autofill pdf parse failed");
            return reply.status(422).send({ error: "PDF Error", message: "Could not read that PDF. Make sure it has selectable text (not a scan)." });
        }
        if (!rawText || rawText.trim().length < 50) {
            return reply.status(422).send({ error: "Insufficient Content", message: "That PDF has too little text to parse." });
        }

        try {
            const completion = await getXAIClient().chat.completions.create({
                model: XAI_MODEL,
                messages: [
                    { role: "system", content: AUTOFILL_SYSTEM },
                    { role: "user", content: `Resume text:\n"""\n${rawText.slice(0, 18000)}\n"""\n\nReturn the JSON profile.` },
                ],
                temperature: 0.2,
                max_tokens: 3000,
            });
            const raw = completion.choices?.[0]?.message?.content ?? "{}";
            let obj: Record<string, unknown> = {};
            try {
                obj = extractJsonObject<Record<string, unknown>>(raw);
            } catch {
                obj = {};
            }
            return { profile: sanitizeAutofill(obj) };
        } catch (err) {
            request.log.error({ err }, "job-profile autofill error");
            return reply.status(502).send({ error: "Autofill Failed", message: "Could not parse the resume right now." });
        }
    });
}
