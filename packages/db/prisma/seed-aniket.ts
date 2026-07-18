/**
 * One-off seed: demo account "Aniket" with a history of completed interviews.
 *
 * Idempotent — safe to re-run. It reuses the existing auth/user if present and
 * wipes the previously-seeded interview sessions before recreating them.
 *
 * Run from packages/db:
 *   SUPABASE_URL=... SERVICE_ROLE_KEY=... DATABASE_URL=... DIRECT_URL=... npx tsx prisma/seed-aniket.ts
 */
import { PrismaClient, Prisma } from "@prisma/client";

const prisma = new PrismaClient();

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SERVICE_ROLE_KEY = process.env.SERVICE_ROLE_KEY!;

const EMAIL = "imaniket@gmail.com";
const PASSWORD = "Practers@2026";
const FULL_NAME = "Aniket";

// ── Supabase Auth Admin helpers (REST, no extra deps) ─────────────────────────
const authHeaders = {
    apikey: SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
    "Content-Type": "application/json",
};

async function findAuthUserByEmail(email: string): Promise<string | null> {
    // Admin list supports filtering by email on recent gotrue versions.
    const res = await fetch(
        `${SUPABASE_URL}/auth/v1/admin/users?email=${encodeURIComponent(email)}`,
        { headers: authHeaders },
    );
    if (!res.ok) return null;
    const body: any = await res.json();
    const users: any[] = body.users ?? body ?? [];
    const match = users.find(
        (u) => (u.email ?? "").toLowerCase() === email.toLowerCase(),
    );
    return match?.id ?? null;
}

async function ensureAuthUser(): Promise<string> {
    const create = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({
            email: EMAIL,
            password: PASSWORD,
            email_confirm: true, // confirmed -> can log in right away
            user_metadata: { full_name: FULL_NAME },
        }),
    });

    if (create.ok) {
        const body: any = await create.json();
        console.log("✓ Created Supabase auth user");
        return body.id ?? body.user?.id;
    }

    const err: any = await create.json().catch(() => ({}));
    const msg = (err.msg || err.message || JSON.stringify(err)).toLowerCase();
    if (create.status === 422 || msg.includes("already") || msg.includes("registered") || msg.includes("exist")) {
        const existingId = await findAuthUserByEmail(EMAIL);
        if (!existingId) {
            throw new Error(
                "Auth user already exists but could not be looked up. Reset its password manually or delete it in Supabase.",
            );
        }
        // Make sure password + confirmation match what we promised.
        await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${existingId}`, {
            method: "PUT",
            headers: authHeaders,
            body: JSON.stringify({
                password: PASSWORD,
                email_confirm: true,
                user_metadata: { full_name: FULL_NAME },
            }),
        });
        console.log("✓ Reused existing Supabase auth user (password reset)");
        return existingId;
    }

    throw new Error(`Failed to create auth user: ${create.status} ${JSON.stringify(err)}`);
}

// ── Interview content ─────────────────────────────────────────────────────────
type Spec = {
    type: string;
    role: string;
    level: string;
    count: number; // how many interviews to seed (0 = skip this domain)
    overall: number; // starting overall score (0-100)
    climb: number; // total points gained across the domain's takes
    rubric: Array<{ category: string; label: string }>;
    strengths: string[];
    improvements: string[];
    sections: Array<{ stage: string; summary: string }>;
};

// 8 interviews, oldest -> newest. Overall trends up with mild jitter.
const SPECS: Spec[] = [
    {
        type: "coding",
        role: "Software Engineer",
        level: "SDE-1",
        count: 5,
        overall: 47,
        climb: 14,
        rubric: [
            { category: "problem_solving", label: "Problem Solving" },
            { category: "code_quality", label: "Code Quality" },
            { category: "speed", label: "Speed" },
        ],
        strengths: ["Arrived at a working brute-force solution quickly."],
        improvements: ["Practice recognizing when hashing can drop a nested loop.", "Walk through edge cases before coding."],
        sections: [{ stage: "Coding", summary: "Solved the array problem but missed the optimal time complexity." }],
    },
    {
        type: "cs_fundamentals",
        role: "Software Engineer",
        level: "SDE-1",
        count: 0,
        overall: 61,
        climb: 12,
        rubric: [
            { category: "cs_knowledge", label: "CS Knowledge" },
            { category: "communication", label: "Communication" },
            { category: "problem_solving", label: "Problem Solving" },
        ],
        strengths: ["Solid grasp of basic data structures."],
        improvements: ["Brush up on OS concurrency primitives.", "Be more precise when defining time/space tradeoffs."],
        sections: [{ stage: "Fundamentals", summary: "Comfortable with DS basics; shaky on OS and networking depth." }],
    },
    {
        type: "full_interview",
        role: "Backend Engineer",
        level: "SDE-1",
        count: 4,
        overall: 54,
        climb: 16,
        rubric: [
            { category: "problem_solving", label: "Problem Solving" },
            { category: "code_quality", label: "Code Quality" },
            { category: "communication", label: "Communication" },
            { category: "cs_knowledge", label: "CS Knowledge" },
        ],
        strengths: ["Communicated thought process clearly throughout."],
        improvements: ["Tighten up code structure under time pressure.", "Verify assumptions with the interviewer earlier."],
        sections: [{ stage: "Overall", summary: "Steady mock interview; clear communication, average execution speed." }],
    },
    {
        type: "behavioural",
        role: "Backend Engineer",
        level: "SDE-2",
        count: 5,
        overall: 60,
        climb: 15,
        rubric: [
            { category: "leadership_and_initiative", label: "Leadership & Initiative" },
            { category: "conflict_resolution", label: "Conflict Resolution" },
            { category: "teamwork", label: "Teamwork" },
            { category: "adaptability", label: "Adaptability" },
        ],
        strengths: ["Used the STAR format naturally.", "Concrete ownership examples."],
        improvements: ["Quantify impact with metrics where possible.", "Show more reflection on what you'd do differently."],
        sections: [{ stage: "Behavioural", summary: "Strong storytelling; could anchor outcomes in measurable impact." }],
    },
    {
        type: "system_design",
        role: "Backend Engineer",
        level: "SDE-2",
        count: 0,
        overall: 69,
        climb: 12,
        rubric: [
            { category: "system_design", label: "System Design" },
            { category: "communication", label: "Communication" },
            { category: "problem_solving", label: "Problem Solving" },
        ],
        strengths: ["Started from clear requirements and capacity estimates.", "Reasoned well about read/write paths."],
        improvements: ["Discuss failure modes and partitioning earlier.", "Cover caching invalidation tradeoffs."],
        sections: [{ stage: "System Design", summary: "Designed a workable URL shortener; needed more depth on scale bottlenecks." }],
    },
    {
        type: "data_science_role",
        role: "Data Scientist",
        level: "Mid",
        count: 0,
        overall: 72,
        climb: 12,
        rubric: [
            { category: "ds_statistics", label: "Statistics" },
            { category: "sql_proficiency", label: "SQL" },
            { category: "data_analysis", label: "Data Analysis" },
            { category: "business_metrics", label: "Business Metrics" },
        ],
        strengths: ["Clean, correct SQL with window functions.", "Connected analysis back to business goals."],
        improvements: ["Be more rigorous about A/B test assumptions.", "Watch for sample-size caveats in conclusions."],
        sections: [{ stage: "Data Science", summary: "Strong SQL and framing; statistical rigor improving." }],
    },
    {
        type: "gen_ai_role",
        role: "AI Engineer",
        level: "Mid",
        count: 4,
        overall: 52,
        climb: 18,
        rubric: [
            { category: "genai_fundamentals", label: "GenAI Fundamentals" },
            { category: "genai_system_design", label: "GenAI System Design" },
            { category: "ai_tool_proficiency", label: "AI Tooling" },
            { category: "ai_ethics", label: "AI Ethics" },
        ],
        strengths: ["Clear on RAG architecture and tradeoffs.", "Practical with embeddings and vector stores."],
        improvements: ["Deepen evaluation/guardrail strategies.", "Address prompt-injection risks explicitly."],
        sections: [{ stage: "Gen AI", summary: "Good applied LLM knowledge; safety/eval coverage growing." }],
    },
    {
        type: "pm_role",
        role: "Product Manager",
        level: "APM",
        count: 8,
        overall: 66,
        climb: 22,
        rubric: [
            { category: "product_ownership", label: "Product Ownership" },
            { category: "product_case_structuring", label: "Case Structuring" },
            { category: "product_metrics", label: "Product Metrics" },
            { category: "product_strategy", label: "Product Strategy" },
        ],
        strengths: ["Structured the case crisply.", "Prioritized with a clear framework.", "Defined sharp success metrics."],
        improvements: ["Stress-test the riskiest assumption sooner.", "Tie strategy back to user segments."],
        sections: [{ stage: "Product", summary: "Excellent structure and metric sense; well-rounded PM mock." }],
    },
    {
        type: "problem_solving_case",
        role: "Software Engineer",
        level: "Mid",
        count: 5,
        overall: 56,
        climb: 16,
        rubric: [
            { category: "logical_reasoning", label: "Logical Reasoning" },
            { category: "hint_absorption", label: "Hint Absorption" },
            { category: "conviction_under_pressure", label: "Conviction Under Pressure" },
        ],
        strengths: ["Broke the problem into clear sub-cases.", "Adjusted quickly after a hint."],
        improvements: ["Hold your ground when an early approach is actually correct.", "State assumptions out loud before diving in."],
        sections: [{ stage: "Problem Solving", summary: "Logical decomposition is solid; gains confidence as the case progresses." }],
    },
    {
        type: "resume_round",
        role: "Software Engineer",
        level: "SDE-1",
        count: 4,
        overall: 49,
        climb: 13,
        rubric: [
            { category: "claim_confidence", label: "Claim Confidence" },
            { category: "project_ownership", label: "Project Ownership" },
            { category: "technical_depth", label: "Technical Depth" },
            { category: "impact_evidence", label: "Impact Evidence" },
        ],
        strengths: ["Owned project decisions end to end.", "Comfortable defending technical choices."],
        improvements: ["Back claims with concrete metrics.", "Clarify your individual contribution on team projects."],
        sections: [{ stage: "Resume Round", summary: "Confident ownership narrative; impact would land harder with numbers." }],
    },
];

function jitter(base: number, seed: number, spread: number): number {
    // deterministic pseudo-jitter in [-spread, spread]
    const x = Math.sin(seed * 12.9898) * 43758.5453;
    const frac = x - Math.floor(x);
    return base + Math.round((frac * 2 - 1) * spread);
}

function buildRubricScores(spec: Spec, overall: number, idx: number) {
    const target = overall / 10; // ~0-10
    return spec.rubric.map((r, i) => {
        let s = jitter(target, idx * 10 + i, 1.1);
        s = Math.max(3, Math.min(10, s));
        return {
            category: r.category,
            score: Number(s.toFixed(1)),
            maxScore: 10 as const,
            feedback: `${r.label}: ${
                s >= 8 ? "strong, consistent performance." : s >= 6 ? "solid with room to refine." : "developing — a clear focus area."
            }`,
        };
    });
}

function buildSectionFeedback(spec: Spec, overall: number) {
    return spec.sections.map((sec) => ({
        stage: sec.stage,
        summary: sec.summary,
        score: Number((overall / 10).toFixed(1)),
        details: sec.summary,
    }));
}

function buildQuestions(spec: Spec, overall: number) {
    return [
        {
            id: `${spec.type}-q1`,
            title:
                spec.type === "coding"
                    ? "Two Sum (variants)"
                    : spec.type === "system_design"
                      ? "Design a URL shortener"
                      : `${spec.role} core question`,
            category: spec.type,
            difficulty: "medium",
            score: Number((overall / 10).toFixed(1)),
            aiNotes: spec.sections[0]?.summary ?? null,
            finalCode: null,
            codeLanguage: null,
            sampleAnswer: null,
        },
    ];
}

async function main() {
    if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
        throw new Error("SUPABASE_URL and SERVICE_ROLE_KEY env vars are required.");
    }

    const userId = await ensureAuthUser();

    // Account created ~100 days ago; interviews spread roughly weekly after.
    const now = new Date();
    const accountCreated = new Date(now.getTime() - 100 * 24 * 3600 * 1000);

    await prisma.user.upsert({
        where: { id: userId },
        update: {
            email: EMAIL,
            fullName: FULL_NAME,
            emailVerified: true,
            emailVerifiedAt: accountCreated,
            onboardingCompleted: true,
        },
        create: {
            id: userId,
            email: EMAIL,
            fullName: FULL_NAME,
            emailVerified: true,
            emailVerifiedAt: accountCreated,
            onboardingCompleted: true,
            onboardingTrack: "job_seeker",
            onboardingPosition: "Software Engineer",
            country: "India",
            location: "Bengaluru, India",
            skills: ["JavaScript", "TypeScript", "Python", "SQL", "System Design"],
            createdAt: accountCreated,
            currentStreak: 3,
            longestStreak: 6,
            lastActivityDate: now,
        },
    });
    console.log(`✓ Upserted public.users row (${userId})`);

    // Idempotency: clear previously seeded sessions (cascades to reports).
    const del = await prisma.interviewSession.deleteMany({ where: { userId } });
    if (del.count) console.log(`  cleared ${del.count} existing session(s)`);

    // Variable number of interviews per domain (some domains skipped via count: 0).
    // Scores trend gently upward within each domain but with real variance, so
    // per-domain averages land all over the place (not all clustered at 75%+).
    const windowStart = now.getTime() - 70 * 24 * 3600 * 1000;
    const windowEnd = now.getTime() - 3 * 24 * 3600 * 1000;

    let total = 0;
    for (let d = 0; d < SPECS.length; d++) {
        const spec = SPECS[d];
        if (spec.count <= 0) continue;

        // Per-domain upward slope: start at spec.overall, climb spec.climb total.
        const start = spec.overall;
        const end = Math.min(95, start + spec.climb);
        const step = Math.max(1, spec.count - 1);

        for (let n = 0; n < spec.count; n++) {
            // Stagger each domain's dates so they interleave naturally.
            const frac = (n + d * 0.12) / (step + SPECS.length * 0.12);
            const ts = windowStart + (windowEnd - windowStart) * Math.min(1, frac);
            const at = new Date(ts);
            const completedAt = new Date(ts + 45 * 60 * 1000);

            // Bigger jitter (±4) breaks up the straight line so it reads as real.
            const trend = start + ((end - start) * n) / step;
            const overall = Math.max(38, Math.min(95, jitter(trend, d * 100 + n + 1, 4)));

            const session = await prisma.interviewSession.create({
                data: {
                    userId,
                    role: spec.role,
                    level: spec.level,
                    type: spec.type,
                    mode: "mock",
                    stage: "DONE",
                    status: "COMPLETED",
                    startedAt: at,
                    completedAt,
                    createdAt: at,
                },
            });

            await prisma.evaluationReport.create({
                data: {
                    sessionId: session.id,
                    userId,
                    overallScore: new Prisma.Decimal(overall),
                    rubricScores: buildRubricScores(spec, overall, n) as unknown as Prisma.InputJsonValue,
                    sectionFeedback: buildSectionFeedback(spec, overall) as unknown as Prisma.InputJsonValue,
                    strengths: spec.strengths,
                    improvements: spec.improvements,
                    benchmark: {
                        role: spec.role,
                        level: spec.level,
                        percentile: Math.min(95, 40 + n * 6),
                        totalCandidates: 1200 + n * 37,
                        message: `Scored in the top ${Math.max(5, 60 - n * 6)}% for ${spec.role} (${spec.level}).`,
                    } as unknown as Prisma.InputJsonValue,
                    questions: buildQuestions(spec, overall) as unknown as Prisma.InputJsonValue,
                    generatedAt: completedAt,
                },
            });
            total++;
        }
        console.log(`  ✓ ${spec.type.padEnd(20)} ${spec.count} interviews (${start} → ${Math.round(end)})`);
    }

    const seededDomains = SPECS.filter((s) => s.count > 0).length;
    console.log(`\n✓ Created ${total} interviews across ${seededDomains} domains`);
    console.log("\n✅ Done. Login with:");
    console.log(`   email:    ${EMAIL}`);
    console.log(`   password: ${PASSWORD}`);
}

main()
    .catch((e) => {
        console.error("❌ Seed failed:", e);
        process.exit(1);
    })
    .finally(() => prisma.$disconnect());
