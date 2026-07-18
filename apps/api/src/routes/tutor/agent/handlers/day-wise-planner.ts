/**
 * Day-wise action plan generator with question selection.
 * 
 * Generates comprehensive daily schedules with specific questions across
 * DSA, CS Fundamentals, SQL, and System Design categories.
 */

import { WeakAreaSeverity } from "@prisma/client";
import { ensureMongoDBConnected } from "../../../../lib/mongoose.js";
import { DSAQuestion } from "../../../../models/DSAQuestion.js";
import { SQLQuestion } from "../../../../models/SQLQuestion.js";
import { CSFundamentalQuestion } from "../../../../models/CSFundamentalQuestion.js";
import { SystemDesignQuestion } from "../../../../models/system-design-question.js";

// ─────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────

type WeakAreaInfo = {
    topic: string;
    category: string;
    severity: WeakAreaSeverity;
    occurrences: number;
};

type DayQuestion = {
    id: string;
    slug: string | null;
    title: string;
    difficulty: string;
    topics: string[];
    estimatedMinutes: number;
    why: string;
    solveUrl: string;
};

type DayPlan = {
    dayNumber: number;
    date: string;
    title: string;
    focusAreas: string[];
    estimatedHours: number;
    goals: string[];
    tips: string[];
    milestone: string | null;
    questions: {
        dsa: DayQuestion[];
        csFundamentals: DayQuestion[];
        sql: DayQuestion[];
        systemDesign: DayQuestion[];
    };
    completed: boolean;
    completedQuestions: string[];
};

// ─────────────────────────────────────────────────────────────────
// Configuration
// ─────────────────────────────────────────────────────────────────

// Default time allocation when user doesn't specify focus
const DEFAULT_TIME_ALLOCATION = {
    dsa: 0.50,              // 50% of time
    csFundamentals: 0.20,   // 20% of time
    sql: 0.15,              // 15% of time
    systemDesign: 0.15,     // 15% of time
};

const MINUTES_PER_QUESTION = {
    easy: 20,
    medium: 35,
    hard: 50,
    sql: 30,
    csFundamentals: 15,
    systemDesign: 60,
};

function escapeRegex(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ─────────────────────────────────────────────────────────────────
// Focus detection
// ─────────────────────────────────────────────────────────────────

function detectUserFocus(
    priorityTopics: string[],
    weakAreas: WeakAreaInfo[]
): { dsa: number; csFundamentals: number; sql: number; systemDesign: number } {
    // Analyze priority topics and weak areas to determine focus
    const allTopics = [
        ...priorityTopics.map(t => t.toLowerCase()),
        ...weakAreas.map(w => w.topic.toLowerCase())
    ];
    
    let sqlCount = 0;
    let csCount = 0;
    let systemDesignCount = 0;
    let dsaCount = 0;
    
    for (const topic of allTopics) {
        if (topic.includes("sql") || topic.includes("database") || topic.includes("query")) {
            sqlCount++;
        } else if (topic.includes("system") || topic.includes("design") || topic.includes("architecture")) {
            systemDesignCount++;
        } else if (topic.includes("network") || topic.includes("os") || topic.includes("oops") || 
                   topic.includes("dbms") || topic.includes("fundamental")) {
            csCount++;
        } else {
            dsaCount++;
        }
    }
    
    const total = sqlCount + csCount + systemDesignCount + dsaCount;
    
    // If user has specific focus, allocate time proportionally
    if (total > 0) {
        return {
            dsa: dsaCount / total,
            csFundamentals: csCount / total,
            sql: sqlCount / total,
            systemDesign: systemDesignCount / total,
        };
    }
    
    // Default allocation
    return DEFAULT_TIME_ALLOCATION;
}

// ─────────────────────────────────────────────────────────────────
// Difficulty progression
// ─────────────────────────────────────────────────────────────────

function getDifficultyMix(dayNumber: number, totalDays: number): { easy: number; medium: number; hard: number } {
    const progress = dayNumber / totalDays;
    
    if (progress < 0.25) {
        // Days 1-25%: Focus on easy problems
        return { easy: 0.70, medium: 0.30, hard: 0.00 };
    } else if (progress < 0.50) {
        // Days 25-50%: Balanced easy/medium
        return { easy: 0.50, medium: 0.50, hard: 0.00 };
    } else if (progress < 0.75) {
        // Days 50-75%: More medium, introduce hard
        return { easy: 0.30, medium: 0.50, hard: 0.20 };
    } else {
        // Days 75-100%: Challenge mode
        return { easy: 0.20, medium: 0.50, hard: 0.30 };
    }
}

// ─────────────────────────────────────────────────────────────────
// Topic selection
// ─────────────────────────────────────────────────────────────────

function selectTopicsForDay(
    dayNumber: number,
    totalDays: number,
    weakAreas: WeakAreaInfo[],
    priorityTopics: string[]
): string[] {
    // Prioritize explicitly requested priorityTopics
    const customTopics = priorityTopics.map(t => ({ topic: t, category: 'dsa' as any, severity: WeakAreaSeverity.CRITICAL, occurrences: 1 }));
    
    // Rotate through priority topics, then weak areas by severity
    const critical = weakAreas.filter(w => w.severity === WeakAreaSeverity.CRITICAL && !priorityTopics.includes(w.topic));
    const moderate = weakAreas.filter(w => w.severity === WeakAreaSeverity.MODERATE && !priorityTopics.includes(w.topic));
    const minor = weakAreas.filter(w => w.severity === WeakAreaSeverity.MINOR && !priorityTopics.includes(w.topic));
    
    const allTopics = [...customTopics, ...critical, ...moderate, ...minor];
    if (allTopics.length === 0) return ["array", "string", "hash table"];
    
    // Cycle through topics, spending more days on critical areas
    const topicIndex = (dayNumber - 1) % allTopics.length;
    const primaryTopic = allTopics[topicIndex];
    
    // Add 1-2 related topics
    const relatedTopics = allTopics
        .filter(t => t.category === primaryTopic.category && t.topic !== primaryTopic.topic)
        .slice(0, 2);
    
    return [primaryTopic.topic, ...relatedTopics.map(t => t.topic)].slice(0, 3);
}

// ─────────────────────────────────────────────────────────────────
// Question fetching
// ─────────────────────────────────────────────────────────────────

async function fetchDSAQuestions(
    topics: string[],
    timeMinutes: number,
    difficultyMix: { easy: number; medium: number; hard: number },
    excludeIds: Set<string>,
    weakAreas: WeakAreaInfo[]
): Promise<DayQuestion[]> {
    await ensureMongoDBConnected();
    
    const targetCounts = {
        easy: Math.floor((timeMinutes / MINUTES_PER_QUESTION.easy) * difficultyMix.easy),
        medium: Math.floor((timeMinutes / MINUTES_PER_QUESTION.medium) * difficultyMix.medium),
        hard: Math.floor((timeMinutes / MINUTES_PER_QUESTION.hard) * difficultyMix.hard),
    };
    if (targetCounts.easy + targetCounts.medium + targetCounts.hard === 0) {
        targetCounts.easy = 1;
    }

    const buildFilter = (difficulty: "Easy" | "Medium" | "Hard", includeTopics = true) => {
        const filter: any = { difficulty };
        if (includeTopics && topics.length > 0) {
            filter.topics = { $in: topics.map(t => {
                let term = t.replace(/_/g, " ");
                if (term.endsWith("s") && !term.endsWith("ss")) term = term.slice(0, -1);
                return new RegExp(`^${escapeRegex(term)}`, "i");
            }) };
        }
        if (excludeIds.size > 0) {
            filter._id = { $nin: Array.from(excludeIds) };
        }
        return filter;
    };

    // Optimize: Fetch all difficulties in a single aggregation pipeline
    const totalTarget = targetCounts.easy + targetCounts.medium + targetCounts.hard;
    const allDocs = await DSAQuestion.aggregate([
        {
            $match: {
                difficulty: { $in: ["Easy", "Medium", "Hard"] },
                ...(topics.length > 0 ? {
                    topics: { $in: topics.map(t => {
                        let term = t.replace(/_/g, " ");
                        if (term.endsWith("s") && !term.endsWith("ss")) term = term.slice(0, -1);
                        return new RegExp(`^${escapeRegex(term)}`, "i");
                    }) }
                } : {}),
                ...(excludeIds.size > 0 ? { _id: { $nin: Array.from(excludeIds) } } : {}),
            }
        },
        { $sample: { size: totalTarget * 4 } } // Sample more than needed for better distribution
    ]);

    // Separate by difficulty
    const easyDocs = allDocs.filter(d => d.difficulty === "Easy");
    const mediumDocs = allDocs.filter(d => d.difficulty === "Medium");
    const hardDocs = allDocs.filter(d => d.difficulty === "Hard");
    
    // If we don't have enough, do a fallback query without topic filter
    const needsMore = easyDocs.length < targetCounts.easy || 
                      mediumDocs.length < targetCounts.medium || 
                      hardDocs.length < targetCounts.hard;
    
    if (needsMore) {
        const fallbackDocs = await DSAQuestion.aggregate([
            {
                $match: {
                    difficulty: { $in: ["Easy", "Medium", "Hard"] },
                    ...(excludeIds.size > 0 ? { _id: { $nin: Array.from(excludeIds) } } : {}),
                }
            },
            { $sample: { size: totalTarget * 2 } }
        ]);
        
        easyDocs.push(...fallbackDocs.filter(d => d.difficulty === "Easy"));
        mediumDocs.push(...fallbackDocs.filter(d => d.difficulty === "Medium"));
        hardDocs.push(...fallbackDocs.filter(d => d.difficulty === "Hard"));
    }
    
    const questions: DayQuestion[] = [];
    const used = new Set<string>();
    
    const pickFromBucket = (docs: any[], target: number, difficulty: string) => {
        for (const doc of docs) {
            if (questions.length >= targetCounts.easy + targetCounts.medium + targetCounts.hard) break;
            const id = String(doc._id);
            if (used.has(id) || excludeIds.has(id)) continue;
            
            used.add(id);
            const docTopics: string[] = Array.isArray(doc.topics) ? doc.topics : [];
            const matchedWeak = weakAreas.find(w => 
                docTopics.some(t => t.toLowerCase().includes(w.topic.toLowerCase()))
            );
            
            const why = matchedWeak
                ? `Targets your ${matchedWeak.severity.toLowerCase()} weak area: ${matchedWeak.topic.replace(/_/g, " ")}`
                : `Builds ${difficulty.toLowerCase()} proficiency in ${topics[0]?.replace(/_/g, " ") || "core concepts"}`;
            
            questions.push({
                id,
                slug: doc.problemSlug || null,
                title: String(doc.title || "Untitled"),
                difficulty: difficulty.toLowerCase(),
                topics: docTopics,
                estimatedMinutes: MINUTES_PER_QUESTION[difficulty.toLowerCase() as keyof typeof MINUTES_PER_QUESTION],
                why,
                solveUrl: `/questions/dsa/solve?id=${id}`,
            });
            
            if (questions.filter(q => q.difficulty === difficulty.toLowerCase()).length >= target) break;
        }
    };
    
    pickFromBucket(easyDocs, targetCounts.easy, "Easy");
    pickFromBucket(mediumDocs, targetCounts.medium, "Medium");
    pickFromBucket(hardDocs, targetCounts.hard, "Hard");
    
    return questions;
}

// ─────────────────────────────────────────────────────────────────
// SQL Question fetching
// ─────────────────────────────────────────────────────────────────

async function fetchSQLQuestions(
    timeMinutes: number,
    excludeIds: Set<string>
): Promise<DayQuestion[]> {
    await ensureMongoDBConnected();
    
    const targetCount = Math.max(1, Math.floor(timeMinutes / 30)); // ~30 min per SQL question
    
    const docs = await SQLQuestion.aggregate([
        {
            $match: {
                ...(excludeIds.size > 0 ? { _id: { $nin: Array.from(excludeIds) } } : {}),
            }
        },
        { $sample: { size: targetCount * 3 } }
    ]);
    
    const questions: DayQuestion[] = [];
    const used = new Set<string>();
    
    for (const doc of docs) {
        if (questions.length >= targetCount) break;
        const id = String(doc._id);
        if (used.has(id) || excludeIds.has(id)) continue;
        
        used.add(id);
        questions.push({
            id,
            slug: null,
            title: String(doc.title || "Untitled SQL Problem"),
            difficulty: "medium", // SQL questions don't have explicit difficulty
            topics: ["sql"],
            estimatedMinutes: 30,
            why: "Practice SQL query writing and database concepts",
            solveUrl: `/questions/sql/solve?id=${id}`,
        });
    }
    
    return questions;
}

// ─────────────────────────────────────────────────────────────────
// CS Fundamentals Question fetching
// ─────────────────────────────────────────────────────────────────

async function fetchCSFundamentalsQuestions(
    timeMinutes: number,
    excludeIds: Set<string>
): Promise<DayQuestion[]> {
    await ensureMongoDBConnected();
    
    const targetCount = Math.max(1, Math.floor(timeMinutes / 15)); // ~15 min per CS question
    
    // Rotate through topics: CN, DBMS, OOPS, OS
    const topics = ["CN", "DBMS", "OOPS", "OS"];
    const questionsPerTopic = Math.ceil(targetCount / topics.length);
    
    const allQuestions: DayQuestion[] = [];
    
    for (const topic of topics) {
        const docs = await CSFundamentalQuestion.aggregate([
            {
                $match: {
                    topic,
                    ...(excludeIds.size > 0 ? { _id: { $nin: Array.from(excludeIds) } } : {}),
                }
            },
            { $sample: { size: questionsPerTopic } }
        ]);
        
        for (const doc of docs) {
            if (allQuestions.length >= targetCount) break;
            const id = String(doc._id);
            if (excludeIds.has(id)) continue;
            
            const topicNames: Record<string, string> = {
                CN: "Computer Networks",
                DBMS: "Database Management",
                OOPS: "Object-Oriented Programming",
                OS: "Operating Systems",
            };
            
            allQuestions.push({
                id,
                slug: null,
                title: String(doc.question || "Untitled CS Question").slice(0, 100),
                difficulty: "medium",
                topics: [topic.toLowerCase()],
                estimatedMinutes: 15,
                why: `Build ${topicNames[topic]} fundamentals`,
                solveUrl: `/questions/cs-fundamentals/solve?id=${id}`,
            });
        }
    }
    
    return allQuestions.slice(0, targetCount);
}

// ─────────────────────────────────────────────────────────────────
// System Design Question fetching
// ─────────────────────────────────────────────────────────────────

async function fetchSystemDesignQuestions(
    timeMinutes: number,
    excludeIds: Set<string>
): Promise<DayQuestion[]> {
    await ensureMongoDBConnected();
    
    const targetCount = Math.max(1, Math.floor(timeMinutes / 60)); // ~60 min per system design
    
    const docs = await SystemDesignQuestion.aggregate([
        {
            $match: {
                ...(excludeIds.size > 0 ? { _id: { $nin: Array.from(excludeIds) } } : {}),
            }
        },
        { $sample: { size: targetCount * 2 } }
    ]);
    
    const questions: DayQuestion[] = [];
    const used = new Set<string>();
    
    for (const doc of docs) {
        if (questions.length >= targetCount) break;
        const id = String(doc._id);
        if (used.has(id) || excludeIds.has(id)) continue;
        
        used.add(id);
        questions.push({
            id,
            slug: doc.slug || null,
            title: String(doc.title || "Untitled System Design"),
            difficulty: (doc.difficulty || "Medium").toLowerCase(),
            topics: ["system design"],
            estimatedMinutes: 60,
            why: "Practice system design and architecture skills",
            solveUrl: `/questions/system-design/solve?id=${id}`,
        });
    }
    
    return questions;
}

// ─────────────────────────────────────────────────────────────────
// Main day-wise planner
// ─────────────────────────────────────────────────────────────────

export async function generateDayWisePlan(input: {
    userId: string;
    totalDays: number;
    hoursPerDay: number;
    weakAreas: WeakAreaInfo[];
    priorityTopics: string[];
    excludeQuestionIds: Set<string>;
}): Promise<DayPlan[]> {
    const { totalDays, hoursPerDay, weakAreas, priorityTopics, excludeQuestionIds } = input;
    const today = new Date();

    // Detect user's focus areas from priority topics and weak areas
    const timeAllocation = detectUserFocus(priorityTopics, weakAreas);

    // Build per-day specs synchronously (no IO), then fetch all questions in parallel.
    const daySpecs = Array.from({ length: totalDays }, (_, i) => {
        const dayNum = i + 1;
        const dayDate = new Date(today);
        dayDate.setDate(today.getDate() + dayNum);
        const topics = selectTopicsForDay(dayNum, totalDays, weakAreas, priorityTopics);
        const difficultyMix = getDifficultyMix(dayNum, totalDays);
        const totalMinutes = hoursPerDay * 60;
        
        return {
            dayNum,
            dayDate,
            topics,
            difficultyMix,
            dsaMinutes: Math.floor(totalMinutes * timeAllocation.dsa),
            sqlMinutes: Math.floor(totalMinutes * timeAllocation.sql),
            csMinutes: Math.floor(totalMinutes * timeAllocation.csFundamentals),
            systemDesignMinutes: Math.floor(totalMinutes * timeAllocation.systemDesign),
        };
    });

    // Fetch all days in parallel — dramatically cuts latency for multi-day plans.
    const globalUsedIds = new Set<string>(excludeQuestionIds);
    
    const allQuestionsPerDay = await Promise.all(
        daySpecs.map(async ({ topics, difficultyMix, dsaMinutes, sqlMinutes, csMinutes, systemDesignMinutes }) => {
            const [dsa, sql, cs, systemDesign] = await Promise.all([
                dsaMinutes > 0 
                    ? fetchDSAQuestions(topics, dsaMinutes, difficultyMix, new Set(globalUsedIds), weakAreas)
                    : Promise.resolve([]),
                sqlMinutes > 0
                    ? fetchSQLQuestions(sqlMinutes, new Set(globalUsedIds))
                    : Promise.resolve([]),
                csMinutes > 0
                    ? fetchCSFundamentalsQuestions(csMinutes, new Set(globalUsedIds))
                    : Promise.resolve([]),
                systemDesignMinutes > 0
                    ? fetchSystemDesignQuestions(systemDesignMinutes, new Set(globalUsedIds))
                    : Promise.resolve([]),
            ]);
            
            return { dsa, sql, cs, systemDesign };
        })
    );

    const days: DayPlan[] = daySpecs.map(({ dayNum, dayDate, topics, difficultyMix }, idx) => {
        const { dsa, sql, cs, systemDesign } = allQuestionsPerDay[idx];
        const totalQuestions = dsa.length + sql.length + cs.length + systemDesign.length;

        const goals: string[] = [];
        if (dsa.length > 0) goals.push(`Solve ${dsa.length} DSA problem${dsa.length !== 1 ? "s" : ""}`);
        if (sql.length > 0) goals.push(`Complete ${sql.length} SQL challenge${sql.length !== 1 ? "s" : ""}`);
        if (cs.length > 0) goals.push(`Review ${cs.length} CS fundamental${cs.length !== 1 ? "s" : ""}`);
        if (systemDesign.length > 0) goals.push(`Design ${systemDesign.length} system${systemDesign.length !== 1 ? "s" : ""}`);
        
        if (goals.length === 0) {
            goals.push(`Focus on ${topics.slice(0, 2).map(t => t.replace(/_/g, " ")).join(" and ")}`);
        }

        const tips: string[] = [];
        if (dayNum <= 3) {
            tips.push("Start with easier problems to build confidence");
            tips.push("Focus on understanding patterns, not memorizing solutions");
        } else if (dayNum <= totalDays * 0.5) {
            tips.push("Time yourself - aim to solve within the estimated time");
            tips.push("Write clean, well-commented code");
        } else {
            tips.push("Explain your approach out loud before coding");
            tips.push("Consider edge cases and optimize for time/space complexity");
        }

        const milestone =
            dayNum % 7 === 0
                ? `Week ${Math.floor(dayNum / 7)} complete! ${Math.round((dayNum / totalDays) * 100)}% through your plan`
                : null;

        return {
            dayNumber: dayNum,
            date: dayDate.toISOString(),
            title: `Master ${topics[0]?.replace(/_/g, " ") || "Core Concepts"}`,
            focusAreas: topics.map(t => t.replace(/_/g, " ")),
            estimatedHours: hoursPerDay,
            goals,
            tips,
            milestone,
            questions: {
                dsa,
                csFundamentals: cs,
                sql,
                systemDesign,
            },
            completed: false,
            completedQuestions: [],
        };
    });

    return days;
}

// ─────────────────────────────────────────────────────────────────
// Summary generation
// ─────────────────────────────────────────────────────────────────

export function generatePlanSummary(days: DayPlan[]): {
    totalQuestions: number;
    questionsByDifficulty: { easy: number; medium: number; hard: number };
    topicCoverage: Array<{ topic: string; count: number }>;
} {
    let totalQuestions = 0;
    const difficultyCount = { easy: 0, medium: 0, hard: 0 };
    const topicCount: Record<string, number> = {};
    
    for (const day of days) {
        // Count DSA questions
        for (const q of day.questions.dsa) {
            totalQuestions++;
            difficultyCount[q.difficulty as keyof typeof difficultyCount]++;
            
            for (const topic of q.topics.slice(0, 2)) {
                const key = topic.toLowerCase();
                topicCount[key] = (topicCount[key] || 0) + 1;
            }
        }
        
        // Count SQL questions
        for (const q of day.questions.sql) {
            totalQuestions++;
            topicCount["sql"] = (topicCount["sql"] || 0) + 1;
        }
        
        // Count CS Fundamentals questions
        for (const q of day.questions.csFundamentals) {
            totalQuestions++;
            for (const topic of q.topics) {
                const key = topic.toLowerCase();
                topicCount[key] = (topicCount[key] || 0) + 1;
            }
        }
        
        // Count System Design questions
        for (const q of day.questions.systemDesign) {
            totalQuestions++;
            topicCount["system design"] = (topicCount["system design"] || 0) + 1;
        }
    }
    
    const topicCoverage = Object.entries(topicCount)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([topic, count]) => ({ topic, count }));
    
    return {
        totalQuestions,
        questionsByDifficulty: difficultyCount,
        topicCoverage,
    };
}
