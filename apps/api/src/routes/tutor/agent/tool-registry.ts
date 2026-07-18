/**
 * Agent tool registry.
 *
 * Function declarations sent to Gemini as `tools`, plus a single
 * dispatcher that routes a model-emitted function call to the
 * matching handler. Each handler is explicit about its inputs (Zod-
 * validated) and reads only what it needs from Postgres / Redis.
 *
 * Privacy / safety guarantees enforced here:
 *   - userId is ALWAYS injected from the verified session, never trusted from args
 *   - all inputs Zod-validated before any Prisma call
 *   - per-tool timeout
 *   - results clipped to safe sizes before being fed back to the model
 */

import { type Tool, Type } from "@google/genai";
import { z } from "zod";
import { prisma } from "../../../lib/prisma.js";
import { getRedis } from "../../../lib/redis.js";
import { WeakAreaStatus, MistakeType } from "@prisma/client";
import { buildEffectiveInterviewConfig, buildModuleConfigSummary, inferQuestionModule } from "../module-context.js";
import { resolveQuestionLabels } from "../tools/get-question-activity-snapshot.js";

// Phase 3 handler imports
import {
    getUserProfileArgs,
    updateUserProfileArgs,
    getTutorMemoriesArgs,
    saveMemoryArgs,
    recallRelevantMemoriesArgs,
    handleGetUserProfile,
    handleUpdateUserProfile,
    handleGetTutorMemories,
    handleSaveMemory,
    handleRecallRelevantMemories,
} from "./handlers/profile.js";
import {
    updateWeakAreaStatusArgs,
    identifyPatternsArgs,
    compareToBenchmarkArgs,
    handleUpdateWeakAreaStatus,
    handleIdentifyPatterns,
    handleCompareToBenchmark,
} from "./handlers/analytics.js";
import {
    searchQuestionsArgs,
    getQuestionArgs,
    getTopicGuideArgs,
    handleSearchQuestions,
    handleGetQuestion,
    handleGetTopicGuide,
} from "./handlers/catalog.js";
import {
    listArtifactsArgs,
    getArtifactArgs,
    archiveArtifactArgs,
    handleListArtifacts,
    handleGetArtifact,
    handleArchiveArtifact,
} from "./handlers/artifacts.js";
import {
    createQuestionSheetArgs,
    createActionPlanArgs,
    createQuizArgs,
    handleCreateQuestionSheet,
    handleCreateActionPlan,
    handleCreateQuiz,
} from "./handlers/skills.js";
import {
    getUserContextPackArgs,
    getTopicMasteryArgs,
    getTopicProgressionArgs,
    getCompanyBlueprintArgs,
    getRecentQuestionHistoryArgs,
    getCalendarContextArgs,
    validateArtifactQualityArgs,
    handleGetUserContextPack,
    handleGetTopicMastery,
    handleGetTopicProgression,
    handleGetCompanyBlueprint,
    handleGetRecentQuestionHistory,
    handleGetCalendarContext,
    handleValidateArtifactQuality,
} from "./handlers/context.js";
import {
    proposeQuestionSheetArgs,
    reviseQuestionSheetArgs,
    proposeActionPlanArgs,
    reviseActionPlanArgs,
    proposeQuizArgs,
    reviseQuizArgs,
    commitArtifactArgs,
    requestClarificationArgs,
    handleProposeQuestionSheet,
    handleReviseQuestionSheet,
    handleProposeActionPlan,
    handleReviseActionPlan,
    handleProposeQuiz,
    handleReviseQuiz,
    handleCommitArtifact,
    handleRequestClarification,
} from "./handlers/skills-conversational.js";

const TOOL_TIMEOUT_MS = 12_000;
const TOOL_TIMEOUT_EXTENDED_MS = 30_000; // For heavy operations like plan generation
const MAX_TREND_LIMIT = 50;
const MAX_WEAK_AREAS_RETURNED = 25;
const MAX_MISTAKES_RETURNED = 25;

// ─────────────────────────────────────────────────────────────────
// Function declarations sent to Gemini
// ─────────────────────────────────────────────────────────────────

export const TUTOR_AGENT_TOOLS: Tool[] = [
    {
        functionDeclarations: [
            {
                name: "list_recent_reports",
                description:
                    "List the user's most recent interview reports (id, type, role, level, score, generatedAt, modular configuration summary). Use first when the user references a past interview without specifying which one, or to ground percentile / comparison answers.",
                parameters: {
                    type: Type.OBJECT,
                    properties: {
                        limit: {
                            type: Type.NUMBER,
                            description: "Max reports to return. Default 10, max 25.",
                        },
                        type: {
                            type: Type.STRING,
                            description:
                                "Optional session type filter, e.g. 'full_interview', 'coding', 'system_design', 'cs_fundamentals', 'sql', 'behavioural', 'gen_ai_role', 'data_science_role', 'pm_role', 'problem_solving_case'.",
                        },
                    },
                },
            },
            {
                name: "get_report_summary",
                description:
                    "Fetch a single interview report's summary: modular configuration, rubric scores, behavioural competency scores/tags, strengths, improvements, overall score. Use when the user asks about a specific report you have the id for.",
                parameters: {
                    type: Type.OBJECT,
                    properties: {
                        reportId: {
                            type: Type.STRING,
                            description: "The report id from list_recent_reports.",
                        },
                    },
                    required: ["reportId"],
                },
            },
            {
                name: "get_report_stage_transcript_context",
                description:
                    "Fetch transcript messages for one specific interview stage only. Use after get_report_summary/list_recent_reports when the user asks for exact wording, answer rewrite, contradiction checks, where they got stuck, or feedback about a named stage/module. Do not use for broad 'review my interview' questions.",
                parameters: {
                    type: Type.OBJECT,
                    properties: {
                        reportId: {
                            type: Type.STRING,
                            description: "The report id from list_recent_reports or get_report_summary.",
                        },
                        stage: {
                            type: Type.STRING,
                            description:
                                "Optional explicit stage such as DSA, FUNDAMENTALS, DS_SQL, RESUME_PROJECTS, PM_CASE, BEHAVIOURAL. If omitted, the backend infers from the user's message.",
                        },
                        query: {
                            type: Type.STRING,
                            description: "Optional user wording to infer the stage from when stage is omitted.",
                        },
                    },
                    required: ["reportId"],
                },
            },
            {
                name: "get_session_question_detail",
                description:
                    "Fetch the actual questions/problems/tasks asked in an interview session, including title, category/module, difficulty, score, timing, code/answer availability, and notes. Use when the user asks what was asked, asks for all questions from an interview, or asks for CS/DSA/SQL questions from a previous interview. Do not use practice-sheet tools for this retrieval request.",
                parameters: {
                    type: Type.OBJECT,
                    properties: {
                        reportId: {
                            type: Type.STRING,
                            description: "The report id from list_recent_reports or get_report_summary.",
                        },
                    },
                    required: ["reportId"],
                },
            },
            {
                name: "get_user_report_trend",
                description:
                    "Get a time-series of the user's recent interview scores. Use to answer 'how am I improving', 'what's my trend', or to ground recommendations. Returns score deltas, weakest rubrics per report, and type distribution.",
                parameters: {
                    type: Type.OBJECT,
                    properties: {
                        periodDays: {
                            type: Type.NUMBER,
                            description: "Days back from today. Default 30. Max 365.",
                        },
                        type: {
                            type: Type.STRING,
                            description: "Optional session type filter.",
                        },
                        module: {
                            type: Type.STRING,
                            description: "Optional enabled module filter, e.g. coding, cs_fundamentals, sql, genai, data_science, product_management.",
                        },
                        topic: {
                            type: Type.STRING,
                            description: "Optional selected topic filter, e.g. graphs, dp, OS, CN, DBMS, OOPS, RAG, statistics, product_metrics.",
                        },
                        limit: {
                            type: Type.NUMBER,
                            description: "Max reports to include. Default 20, max 50.",
                        },
                    },
                },
            },
            {
                name: "get_score_percentile",
                description:
                    "For a given report, return where it sits among the user's own reports (their personal percentile). Use when asked 'is this score good?' or 'how does this compare to my average?'.",
                parameters: {
                    type: Type.OBJECT,
                    properties: {
                        reportId: {
                            type: Type.STRING,
                            description: "The report id.",
                        },
                    },
                    required: ["reportId"],
                },
            },
            {
                name: "get_question_activity_snapshot",
                description:
                    "Snapshot of the user's recent practice/interview question activity: total attempted, total solved, breakdown by category, recent submissions with human-readable question titles. Use titles in responses; do not expose internal IDs.",
                parameters: {
                    type: Type.OBJECT,
                    properties: {
                        periodDays: {
                            type: Type.NUMBER,
                            description: "Days back. Default 30, max 180.",
                        },
                    },
                },
            },
            {
                name: "get_weak_areas",
                description:
                    "Read the user's persisted weak areas (extracted from completed interviews). Use this BEFORE making practice recommendations — it tells you exactly what topics they're struggling with.",
                parameters: {
                    type: Type.OBJECT,
                    properties: {
                        status: {
                            type: Type.STRING,
                            description: "Filter: 'open', 'improving', 'resolved', or 'all'. Default 'open'.",
                        },
                        category: {
                            type: Type.STRING,
                            description: "Optional category filter, e.g. 'data_structures', 'system_design'.",
                        },
                        limit: {
                            type: Type.NUMBER,
                            description: "Max items. Default 12, max 25.",
                        },
                    },
                },
            },
            {
                name: "get_recent_mistakes",
                description:
                    "Read the user's recent specific mistakes (extracted per-question from interviews). Each mistake has a description, mistake type, and suggested correct approach. Use when the user asks 'what did I get wrong' or to give pattern-based feedback.",
                parameters: {
                    type: Type.OBJECT,
                    properties: {
                        limit: {
                            type: Type.NUMBER,
                            description: "Max items. Default 10, max 25.",
                        },
                        mistakeType: {
                            type: Type.STRING,
                            description:
                                "Optional filter: 'wrong_approach', 'edge_case_missed', 'complexity_error', 'syntax_error', 'conceptual_gap', 'communication'.",
                        },
                        reportId: {
                            type: Type.STRING,
                            description: "Optional: only mistakes from this report.",
                        },
                    },
                },
            },

            // ── Profile + memory ──────────────────────────────────
            {
                name: "get_user_profile",
                description:
                    "Read the user's tutor profile: target company, role, level, deadline, weekly study hours, preferred language and topics. Call before recommendations or planning so suggestions match the user's actual goals.",
                parameters: { type: Type.OBJECT, properties: {} },
            },
            {
                name: "update_user_profile",
                description:
                    "Update one or more fields on the user's tutor profile (target company / role / level / deadline / hoursPerWeek / preferredLanguage / preferredTopics / notes). Pass only fields the user actually stated. Use when the user reveals or changes a goal.",
                parameters: {
                    type: Type.OBJECT,
                    properties: {
                        targetCompany: { type: Type.STRING },
                        targetRole: { type: Type.STRING },
                        targetLevel: { type: Type.STRING },
                        targetDate: {
                            type: Type.STRING,
                            description: "ISO 8601 date or null to clear. Example: '2026-08-15'.",
                        },
                        hoursPerWeek: { type: Type.NUMBER },
                        preferredLanguage: { type: Type.STRING },
                        preferredTopics: { type: Type.ARRAY, items: { type: Type.STRING } },
                        notes: { type: Type.STRING },
                    },
                },
            },
            {
                name: "get_tutor_memories",
                description:
                    "Read free-form memories the tutor has saved about the user across past chats (preferences, goals, facts, feedback). Pull at the start of a conversation to stay coherent across sessions.",
                parameters: {
                    type: Type.OBJECT,
                    properties: {
                        kind: {
                            type: Type.STRING,
                            description: "Optional filter: 'preference', 'goal', 'fact', 'feedback'.",
                        },
                        limit: { type: Type.NUMBER, description: "Default 10, max 25." },
                    },
                },
            },
            {
                name: "recall_relevant_memories",
                description:
                    "Keyword search across saved memories. Use when get_user_context_pack returned only general memories but you need ones related to the current topic (e.g. user mentions 'graphs' — search for memories tagged with that).",
                parameters: {
                    type: Type.OBJECT,
                    properties: {
                        query: {
                            type: Type.STRING,
                            description: "Words to search for in memory key + value.",
                        },
                        kind: {
                            type: Type.STRING,
                            description: "Optional filter: 'preference' | 'goal' | 'fact' | 'feedback'.",
                        },
                        limit: { type: Type.NUMBER, description: "Default 8, max 25." },
                    },
                    required: ["query"],
                },
            },
            {
                name: "save_memory",
                description:
                    "Persist a small fact, preference, goal, or feedback the tutor should remember in future conversations. Use sparingly — only for things the user explicitly stated or that would clearly be useful next time.",
                parameters: {
                    type: Type.OBJECT,
                    properties: {
                        kind: {
                            type: Type.STRING,
                            description: "'preference' | 'goal' | 'fact' | 'feedback'.",
                        },
                        key: {
                            type: Type.STRING,
                            description: "Short canonical key, e.g. 'preferred_explanation_style'.",
                        },
                        value: { type: Type.STRING, description: "The content to remember." },
                        source: {
                            type: Type.STRING,
                            description: "'user_stated' | 'inferred' | 'tutor_set'. Default 'inferred'.",
                        },
                        expiresInDays: {
                            type: Type.NUMBER,
                            description: "Optional TTL — useful for short-term goals.",
                        },
                    },
                    required: ["kind", "key", "value"],
                },
            },

            // ── Weak-area management + analytics ──────────────────
            {
                name: "update_weak_area_status",
                description:
                    "Mark a weak area as 'improving' or 'resolved' when the user has demonstrated progress (correct re-attempt, taught concept back, passed quiz). Pass the weakAreaId from get_weak_areas.",
                parameters: {
                    type: Type.OBJECT,
                    properties: {
                        weakAreaId: { type: Type.STRING },
                        status: {
                            type: Type.STRING,
                            description: "'open' | 'improving' | 'resolved'.",
                        },
                        reason: {
                            type: Type.STRING,
                            description: "Optional one-liner: why the status changed.",
                        },
                    },
                    required: ["weakAreaId", "status"],
                },
            },
            {
                name: "identify_patterns",
                description:
                    "Cluster the user's open weak areas and recent mistakes into themes. Returns weakness clusters by category, mistake-type counts, and recurring topic tags. Use to give big-picture feedback like 'you keep failing on DP subsequence problems'.",
                parameters: {
                    type: Type.OBJECT,
                    properties: {
                        focus: {
                            type: Type.STRING,
                            description: "'weaknesses' | 'mistakes' | 'both'. Default 'both'.",
                        },
                        lookbackDays: {
                            type: Type.NUMBER,
                            description: "Days back to analyze. Default 60, max 365.",
                        },
                        limit: {
                            type: Type.NUMBER,
                            description: "Max clusters / patterns to return. Default 8, max 15.",
                        },
                    },
                },
            },
            {
                name: "compare_to_benchmark",
                description:
                    "Compare the user's recent (last 5 reports) performance to their own historical baseline (next 25 reports). Returns score delta and per-rubric deltas. Use to ground 'am I getting better' answers in real numbers.",
                parameters: {
                    type: Type.OBJECT,
                    properties: {
                        type: {
                            type: Type.STRING,
                            description: "Optional session type filter, e.g. 'dsa', 'system_design'.",
                        },
                    },
                },
            },

            // ── Catalog ───────────────────────────────────────────
            {
                name: "search_questions",
                description:
                    "Search the DSA question bank by topics / companies / difficulty / keyword. Returns lightweight rows. Use when the user asks for practice on a topic, or to gather candidates before calling create_question_sheet.",
                parameters: {
                    type: Type.OBJECT,
                    properties: {
                        topics: { type: Type.ARRAY, items: { type: Type.STRING } },
                        companies: { type: Type.ARRAY, items: { type: Type.STRING } },
                        difficulty: {
                            type: Type.STRING,
                            description: "'easy' | 'medium' | 'hard'.",
                        },
                        keyword: { type: Type.STRING },
                        excludeSlugs: { type: Type.ARRAY, items: { type: Type.STRING } },
                        limit: { type: Type.NUMBER, description: "Default 10, max 25." },
                    },
                },
            },
            {
                name: "get_question",
                description:
                    "Fetch a single question's full detail (description, examples, constraints, hints). Use when the user wants a walkthrough or explanation of a specific problem.",
                parameters: {
                    type: Type.OBJECT,
                    properties: {
                        questionId: {
                            type: Type.STRING,
                            description: "ObjectId, problemSlug, problemId, or frontendId.",
                        },
                    },
                    required: ["questionId"],
                },
            },
            {
                name: "get_topic_guide",
                description:
                    "Get a curated short primer on a specific interview topic (when to use, common pitfalls, practice progression). Returns curated:false for unknown topics — fall back to your own knowledge then.",
                parameters: {
                    type: Type.OBJECT,
                    properties: {
                        topic: {
                            type: Type.STRING,
                            description: "Topic key, e.g. 'two_pointers', 'dynamic_programming'.",
                        },
                    },
                    required: ["topic"],
                },
            },

            // ── Artifacts ─────────────────────────────────────────
            {
                name: "list_artifacts",
                description:
                    "List the user's generated artifacts (question sheets, action plans, quizzes, study notes). Use to see what's already been produced before creating a duplicate.",
                parameters: {
                    type: Type.OBJECT,
                    properties: {
                        type: {
                            type: Type.STRING,
                            description: "'question_sheet' | 'action_plan' | 'quiz' | 'study_note'.",
                        },
                        status: {
                            type: Type.STRING,
                            description: "'active' | 'archived' | 'superseded' | 'all'. Default 'active'.",
                        },
                        limit: { type: Type.NUMBER, description: "Default 10, max 25." },
                    },
                },
            },
            {
                name: "get_artifact",
                description:
                    "Fetch full content of a specific artifact (question list, plan weeks, quiz items).",
                parameters: {
                    type: Type.OBJECT,
                    properties: {
                        artifactId: { type: Type.STRING },
                    },
                    required: ["artifactId"],
                },
            },
            {
                name: "archive_artifact",
                description:
                    "Soft-delete an artifact (status → archived). Use when the user is done with a sheet or plan, or when superseding it.",
                parameters: {
                    type: Type.OBJECT,
                    properties: {
                        artifactId: { type: Type.STRING },
                    },
                    required: ["artifactId"],
                },
            },

            // ── Skills (the agent's high-leverage actions) ────────
            {
                name: "create_question_sheet",
                description:
                    "Generate and persist a personalized practice sheet of DSA problems from the question bank. Use for 'give me practice problems', 'make me a sheet', 'find me questions on X'. DO NOT use for quiz requests — use create_quiz instead.",
                parameters: {
                    type: Type.OBJECT,
                    properties: {
                        title: { type: Type.STRING },
                        focusTopics: {
                            type: Type.ARRAY,
                            items: { type: Type.STRING },
                            description: "Override topics to focus on. If empty, uses the user's open weak areas.",
                        },
                        companies: { type: Type.ARRAY, items: { type: Type.STRING } },
                        difficultyMix: {
                            type: Type.OBJECT,
                            properties: {
                                easy: { type: Type.NUMBER },
                                medium: { type: Type.NUMBER },
                                hard: { type: Type.NUMBER },
                            },
                            description:
                                "Counts per difficulty. Must sum to totalQuestions; otherwise a balanced default is used.",
                        },
                        totalQuestions: {
                            type: Type.NUMBER,
                            description: "Total questions in the sheet. 1-25, default 10.",
                        },
                        excludeSeen: {
                            type: Type.BOOLEAN,
                            description: "If true (default), skip questions the user has already attempted.",
                        },
                        conversationId: { type: Type.STRING },
                    },
                },
            },
            {
                name: "create_action_plan",
                description:
                    "Generate and persist a week-by-week interview-prep action plan. Pulls the user's profile + weak areas + recent reports, asks Gemini Pro for a structured plan, and writes a TutorArtifact. Returns the artifactId.",
                parameters: {
                    type: Type.OBJECT,
                    properties: {
                        title: { type: Type.STRING },
                        targetCompany: { type: Type.STRING },
                        targetLevel: { type: Type.STRING },
                        deadline: {
                            type: Type.STRING,
                            description: "ISO date string. Falls back to profile.targetDate or 8 weeks from today.",
                        },
                        hoursPerWeek: { type: Type.NUMBER },
                        priorityWeakAreaTopics: {
                            type: Type.ARRAY,
                            items: { type: Type.STRING },
                        },
                        conversationId: { type: Type.STRING },
                    },
                },
            },
            {
                name: "create_quiz",
                description:
                    "Generate an interactive quiz with MCQ and short-answer questions on a specific topic. Use for 'quiz me', 'create a quiz', 'test me on X'. DO NOT use create_question_sheet for quiz requests. Persists as a TutorArtifact and returns artifactId + items.",
                parameters: {
                    type: Type.OBJECT,
                    properties: {
                        topic: { type: Type.STRING },
                        questionCount: { type: Type.NUMBER, description: "3-15, default 8." },
                        difficulty: {
                            type: Type.STRING,
                            description: "'easy' | 'medium' | 'hard' | 'mixed'. Default 'mixed'.",
                        },
                        title: { type: Type.STRING },
                        conversationId: { type: Type.STRING },
                    },
                    required: ["topic"],
                },
            },

            // ── Track 2: combined context + domain knowledge ──────
            {
                name: "get_user_context_pack",
                description:
                    "PREFERRED FIRST CALL for any non-trivial answer. Single round-trip that returns profile + open weak areas + recent mistakes + activity snapshot + recent reports + active memories + active accepted plans. Replaces calling get_user_profile / get_weak_areas / get_recent_mistakes / get_question_activity_snapshot / get_tutor_memories separately.",
                parameters: {
                    type: Type.OBJECT,
                    properties: {
                        scope: {
                            type: Type.STRING,
                            description: "'full' (default) or 'minimal' (skip mistakes / reports / plans for faster reads).",
                        },
                    },
                },
            },
            {
                name: "get_topic_mastery",
                description:
                    "Derived 0-100 mastery score for a topic, computed from open weak areas, mistakes, and activity. Use to decide 'should I drill this or skip it?'. Returns band (strong/developing/weak/critical), signals, and reasons.",
                parameters: {
                    type: Type.OBJECT,
                    properties: {
                        topic: {
                            type: Type.STRING,
                            description: "Canonical topic key, e.g. 'dynamic_programming'.",
                        },
                    },
                    required: ["topic"],
                },
            },
            {
                name: "get_topic_progression",
                description:
                    "Curated easy → medium → hard question ladder for a topic, with a one-line note on what each rung tests. Use when building a sheet so difficulty actually progresses instead of being random.",
                parameters: {
                    type: Type.OBJECT,
                    properties: {
                        topic: { type: Type.STRING },
                    },
                    required: ["topic"],
                },
            },
            {
                name: "get_company_blueprint",
                description:
                    "Curated profile of a target company's interview structure (rounds, DSA topic mix, system-design depth, behavioral weight, notes). Use when the user mentions a target company so plans + sheets match the company's actual signal.",
                parameters: {
                    type: Type.OBJECT,
                    properties: {
                        company: { type: Type.STRING },
                        role: { type: Type.STRING },
                        level: { type: Type.STRING },
                    },
                    required: ["company"],
                },
            },
            {
                name: "get_recent_question_history",
                description:
                    "Last N days of attempted/solved questions + recent submissions with human-readable titles. Use BEFORE building a sheet to avoid recommending what they just did, and to answer recent-practice questions. Treat internal ids as private; never show them to users.",
                parameters: {
                    type: Type.OBJECT,
                    properties: {
                        days: { type: Type.NUMBER, description: "1-60, default 14." },
                        limit: { type: Type.NUMBER, description: "1-50, default 20." },
                    },
                },
            },
            {
                name: "get_calendar_context",
                description:
                    "Active accepted action plans + days until target date. Use to avoid double-booking a new plan, and to ground 'how much time do I have?' questions in real numbers.",
                parameters: { type: Type.OBJECT, properties: {} },
            },
            {
                name: "validate_artifact_quality",
                description:
                    "Internal QA. Pass an artifact spec; returns issues[] (empty = ok). Call BEFORE committing a sheet/plan/quiz — catches duplicates, flat difficulty, missing milestones, missing explanations.",
                parameters: {
                    type: Type.OBJECT,
                    properties: {
                        artifactType: {
                            type: Type.STRING,
                            description: "'question_sheet' | 'action_plan' | 'quiz'.",
                        },
                        spec: {
                            type: Type.OBJECT,
                            description: "The spec to validate (e.g. the content payload of an artifact).",
                            properties: {},
                        },
                    },
                    required: ["artifactType", "spec"],
                },
            },

            // ── Track 1: conversational propose / revise / commit ─────
            // STRONGLY PREFERRED over create_*. Always propose first, let
            // the user revise, then commit.
            {
                name: "propose_question_sheet",
                description:
                    "PREFERRED for sheet creation. Builds a DRAFT sheet with rationale per question and shows it to the user for approval. Pass focusTopics + difficultyMix only if you've gathered the user's intent (otherwise call request_clarification first). Use this instead of create_question_sheet when you want the user to confirm or edit.",
                parameters: {
                    type: Type.OBJECT,
                    properties: {
                        title: { type: Type.STRING },
                        focusTopics: {
                            type: Type.ARRAY,
                            items: { type: Type.STRING },
                            description: "If empty, uses the user's open weak areas.",
                        },
                        companies: { type: Type.ARRAY, items: { type: Type.STRING } },
                        difficultyMix: {
                            type: Type.OBJECT,
                            properties: {
                                easy: { type: Type.NUMBER },
                                medium: { type: Type.NUMBER },
                                hard: { type: Type.NUMBER },
                            },
                        },
                        totalQuestions: { type: Type.NUMBER, description: "1-25, default 8." },
                        excludeSeen: { type: Type.BOOLEAN },
                        rationale: {
                            type: Type.STRING,
                            description: "One-line note on why this composition.",
                        },
                        conversationId: { type: Type.STRING },
                    },
                },
            },
            {
                name: "revise_question_sheet",
                description:
                    "Apply edits to a DRAFT sheet (add/remove topics, swap specific questions, change mix or total). Returns the updated draft. The draft stays draft — only commit_artifact finalizes it.",
                parameters: {
                    type: Type.OBJECT,
                    properties: {
                        draftId: { type: Type.STRING },
                        addTopics: { type: Type.ARRAY, items: { type: Type.STRING } },
                        removeTopics: { type: Type.ARRAY, items: { type: Type.STRING } },
                        swapQuestionIds: {
                            type: Type.ARRAY,
                            items: { type: Type.STRING },
                            description: "Question IDs to drop and replace.",
                        },
                        difficultyMix: {
                            type: Type.OBJECT,
                            properties: {
                                easy: { type: Type.NUMBER },
                                medium: { type: Type.NUMBER },
                                hard: { type: Type.NUMBER },
                            },
                        },
                        totalQuestions: { type: Type.NUMBER },
                        title: { type: Type.STRING },
                        rationale: { type: Type.STRING },
                    },
                    required: ["draftId"],
                },
            },
            {
                name: "propose_action_plan",
                description:
                    "PREFERRED for plan creation. Generates a DRAFT day-by-day plan with specific questions using profile + weak areas. Show to user, gather edits via revise_action_plan, then commit_artifact. CRITICAL: If deadline or hours_per_week are unclear, use request_clarification ONCE. When you receive a message starting with [clarify:id], that means the user has answered your clarification - you MUST IMMEDIATELY call this tool (propose_action_plan) with those values. DO NOT ask follow-up questions, DO NOT wait, CALL THIS TOOL RIGHT AWAY with the clarification answers.",
                parameters: {
                    type: Type.OBJECT,
                    properties: {
                        title: { type: Type.STRING },
                        targetCompany: { type: Type.STRING },
                        targetLevel: { type: Type.STRING },
                        deadline: { type: Type.STRING, description: "ISO date." },
                        hoursPerWeek: { type: Type.NUMBER },
                        priorityWeakAreaTopics: {
                            type: Type.ARRAY,
                            items: { type: Type.STRING },
                        },
                        rationale: { type: Type.STRING },
                        conversationId: { type: Type.STRING },
                    },
                },
            },
            {
                name: "revise_action_plan",
                description:
                    "Apply edits to a DRAFT plan. Changing deadline / hoursPerWeek / priority topics regenerates the weekly breakdown; lighter edits (title, rationale) just patch the draft.",
                parameters: {
                    type: Type.OBJECT,
                    properties: {
                        draftId: { type: Type.STRING },
                        deadline: { type: Type.STRING },
                        hoursPerWeek: { type: Type.NUMBER },
                        priorityWeakAreaTopics: {
                            type: Type.ARRAY,
                            items: { type: Type.STRING },
                        },
                        title: { type: Type.STRING },
                        rationale: { type: Type.STRING },
                    },
                    required: ["draftId"],
                },
            },
            {
                name: "propose_quiz",
                description:
                    "PREFERRED for quiz creation. Generates a DRAFT quiz on a given topic with explanations. Show to user, gather edits via revise_quiz, commit_artifact when approved. Confirm topic + count + difficulty with the user first if unclear. After approval, describe quizzes as saved in this chat, not saved to a library.",
                parameters: {
                    type: Type.OBJECT,
                    properties: {
                        topic: { type: Type.STRING },
                        questionCount: { type: Type.NUMBER, description: "3-15, default 8." },
                        difficulty: {
                            type: Type.STRING,
                            description: "'easy' | 'medium' | 'hard' | 'mixed'. Default 'mixed'.",
                        },
                        title: { type: Type.STRING },
                        rationale: { type: Type.STRING },
                        conversationId: { type: Type.STRING },
                    },
                    required: ["topic"],
                },
            },
            {
                name: "revise_quiz",
                description:
                    "Apply edits to a DRAFT quiz. Changing topic / count / difficulty regenerates items; light edits just patch the draft.",
                parameters: {
                    type: Type.OBJECT,
                    properties: {
                        draftId: { type: Type.STRING },
                        topic: { type: Type.STRING },
                        questionCount: { type: Type.NUMBER },
                        difficulty: { type: Type.STRING },
                        title: { type: Type.STRING },
                        rationale: { type: Type.STRING },
                    },
                    required: ["draftId"],
                },
            },
            {
                name: "commit_artifact",
                description:
                    "Finalize a DRAFT artifact (sheet / plan / quiz). Call only after the user has explicitly approved the draft. Sheets and plans become available from their normal frontend surfaces; quizzes should be described as saved in this chat because there is no separate quiz library page.",
                parameters: {
                    type: Type.OBJECT,
                    properties: {
                        draftId: { type: Type.STRING },
                    },
                    required: ["draftId"],
                },
            },
            {
                name: "request_clarification",
                description:
                    "Ask the user for structured info before proposing a sheet / plan / quiz. The UI renders chip / text / number / date inputs inline. After this tool returns, briefly acknowledge to the user that you need their input, then end the turn — the user will reply via the UI.",
                parameters: {
                    type: Type.OBJECT,
                    properties: {
                        context: {
                            type: Type.STRING,
                            description: "One-line note explaining why you need this info.",
                        },
                        slots: {
                            type: Type.ARRAY,
                            description: "1-5 inputs to ask for.",
                            items: {
                                type: Type.OBJECT,
                                properties: {
                                    id: { type: Type.STRING },
                                    label: { type: Type.STRING },
                                    type: {
                                        type: Type.STRING,
                                        description: "'chip' | 'text' | 'number' | 'date'.",
                                    },
                                    options: {
                                        type: Type.ARRAY,
                                        items: { type: Type.STRING },
                                        description: "For type=chip — up to 8 options.",
                                    },
                                    placeholder: { type: Type.STRING },
                                    required: { type: Type.BOOLEAN },
                                },
                                required: ["id", "label", "type"],
                            },
                        },
                    },
                    required: ["context", "slots"],
                },
            },
        ],
    },
];

// Names callable by the agent — used to validate model output.
export const TUTOR_AGENT_TOOL_NAMES = new Set([
    // Phase 2 — reports + KB reads
    "list_recent_reports",
    "get_report_summary",
    "get_report_stage_transcript_context",
    "get_session_question_detail",
    "get_user_report_trend",
    "get_score_percentile",
    "get_question_activity_snapshot",
    "get_weak_areas",
    "get_recent_mistakes",
    // Phase 3 — profile + memory
    "get_user_profile",
    "update_user_profile",
    "get_tutor_memories",
    "save_memory",
    "recall_relevant_memories",
    // Phase 3 — analytics + weak-area management
    "update_weak_area_status",
    "identify_patterns",
    "compare_to_benchmark",
    // Phase 3 — catalog
    "search_questions",
    "get_question",
    "get_topic_guide",
    // Phase 3 — artifacts
    "list_artifacts",
    "get_artifact",
    "archive_artifact",
    // Phase 3 — skills
    "create_question_sheet",
    "create_action_plan",
    "create_quiz",
    // Track 2 — combined + domain knowledge
    "get_user_context_pack",
    "get_topic_mastery",
    "get_topic_progression",
    "get_company_blueprint",
    "get_recent_question_history",
    "get_calendar_context",
    "validate_artifact_quality",
    // Track 1 — conversational propose / revise / commit
    "propose_question_sheet",
    "revise_question_sheet",
    "propose_action_plan",
    "revise_action_plan",
    "propose_quiz",
    "revise_quiz",
    "commit_artifact",
    "request_clarification",
]);

// ─────────────────────────────────────────────────────────────────
// Input schemas (Zod)
// ─────────────────────────────────────────────────────────────────

const listRecentReportsArgs = z.object({
    limit: z.coerce.number().int().min(1).max(25).optional().default(10),
    type: z.string().trim().min(1).max(50).optional(),
});

const getReportSummaryArgs = z.object({
    reportId: z.string().trim().min(1).max(64),
});

const getReportStageTranscriptContextArgs = z.object({
    reportId: z.string().trim().min(1).max(64),
    stage: z.string().trim().min(1).max(80).optional(),
    query: z.string().trim().min(1).max(500).optional(),
});

const getSessionQuestionDetailArgs = z.object({
    reportId: z.string().trim().min(1).max(64),
});

const getUserReportTrendArgs = z.object({
    periodDays: z.coerce.number().int().min(1).max(365).optional().default(30),
    type: z.string().trim().min(1).max(50).optional(),
    module: z.string().trim().min(1).max(80).optional(),
    topic: z.string().trim().min(1).max(80).optional(),
    limit: z.coerce.number().int().min(1).max(MAX_TREND_LIMIT).optional().default(20),
});

const getScorePercentileArgs = z.object({
    reportId: z.string().trim().min(1).max(64),
});

const getQuestionActivitySnapshotArgs = z.object({
    periodDays: z.coerce.number().int().min(1).max(180).optional().default(30),
});

const getWeakAreasArgs = z.object({
    status: z.enum(["open", "improving", "resolved", "all"]).optional().default("open"),
    category: z.string().trim().min(1).max(80).optional(),
    limit: z.coerce.number().int().min(1).max(MAX_WEAK_AREAS_RETURNED).optional().default(12),
});

const getRecentMistakesArgs = z.object({
    limit: z.coerce.number().int().min(1).max(MAX_MISTAKES_RETURNED).optional().default(10),
    mistakeType: z
        .enum([
            "wrong_approach",
            "edge_case_missed",
            "complexity_error",
            "syntax_error",
            "conceptual_gap",
            "communication",
        ])
        .optional(),
    reportId: z.string().trim().min(1).max(64).optional(),
});

// ─────────────────────────────────────────────────────────────────
// Dispatcher
// ─────────────────────────────────────────────────────────────────

export type ToolExecutionResult = {
    name: string;
    ok: boolean;
    latencyMs: number;
    data?: unknown;
    errorCode?: string;
    errorMessage?: string;
};

export async function executeAgentTool(
    userId: string,
    name: string,
    rawArgs: Record<string, unknown>
): Promise<ToolExecutionResult> {
    const startedAt = Date.now();

    if (!TUTOR_AGENT_TOOL_NAMES.has(name)) {
        return {
            name,
            ok: false,
            latencyMs: Date.now() - startedAt,
            errorCode: "UNKNOWN_TOOL",
            errorMessage: `Tool ${name} is not registered.`,
        };
    }

    try {
        // Use extended timeout for heavy operations like plan generation and quiz generation
        const timeout = (name === "propose_action_plan" || name === "revise_action_plan" || name === "propose_quiz" || name === "revise_quiz") 
            ? TOOL_TIMEOUT_EXTENDED_MS 
            : TOOL_TIMEOUT_MS;
        const handler = withTimeout(dispatch(userId, name, rawArgs), timeout, name);
        const data = await handler;
        return { name, ok: true, latencyMs: Date.now() - startedAt, data };
    } catch (err: any) {
        const code = typeof err?.code === "string" ? err.code : "TOOL_FAILED";
        return {
            name,
            ok: false,
            latencyMs: Date.now() - startedAt,
            errorCode: code,
            errorMessage: typeof err?.message === "string" ? err.message.slice(0, 300) : "tool failed",
        };
    }
}

async function dispatch(userId: string, name: string, rawArgs: Record<string, unknown>): Promise<unknown> {
    const args = rawArgs ?? {};
    switch (name) {
        // Phase 2
        case "list_recent_reports":
            return handleListRecentReports(userId, listRecentReportsArgs.parse(args));
        case "get_report_summary":
            return handleGetReportSummary(userId, getReportSummaryArgs.parse(args));
        case "get_report_stage_transcript_context":
            return handleGetReportStageTranscriptContext(userId, getReportStageTranscriptContextArgs.parse(args));
        case "get_session_question_detail":
            return handleGetSessionQuestionDetail(userId, getSessionQuestionDetailArgs.parse(args));
        case "get_user_report_trend":
            return handleGetUserReportTrend(userId, getUserReportTrendArgs.parse(args));
        case "get_score_percentile":
            return handleGetScorePercentile(userId, getScorePercentileArgs.parse(args));
        case "get_question_activity_snapshot":
            return handleGetQuestionActivity(userId, getQuestionActivitySnapshotArgs.parse(args));
        case "get_weak_areas":
            return handleGetWeakAreas(userId, getWeakAreasArgs.parse(args));
        case "get_recent_mistakes":
            return handleGetRecentMistakes(userId, getRecentMistakesArgs.parse(args));

        // Phase 3 — profile + memory
        case "get_user_profile":
            return handleGetUserProfile(userId, getUserProfileArgs.parse(args));
        case "update_user_profile":
            return handleUpdateUserProfile(userId, updateUserProfileArgs.parse(args));
        case "get_tutor_memories":
            return handleGetTutorMemories(userId, getTutorMemoriesArgs.parse(args));
        case "save_memory":
            return handleSaveMemory(userId, saveMemoryArgs.parse(args));
        case "recall_relevant_memories":
            return handleRecallRelevantMemories(userId, recallRelevantMemoriesArgs.parse(args));

        // Phase 3 — weak-area management + analytics
        case "update_weak_area_status":
            return handleUpdateWeakAreaStatus(userId, updateWeakAreaStatusArgs.parse(args));
        case "identify_patterns":
            return handleIdentifyPatterns(userId, identifyPatternsArgs.parse(args));
        case "compare_to_benchmark":
            return handleCompareToBenchmark(userId, compareToBenchmarkArgs.parse(args));

        // Phase 3 — catalog
        case "search_questions":
            return handleSearchQuestions(userId, searchQuestionsArgs.parse(args));
        case "get_question":
            return handleGetQuestion(userId, getQuestionArgs.parse(args));
        case "get_topic_guide":
            return handleGetTopicGuide(userId, getTopicGuideArgs.parse(args));

        // Phase 3 — artifacts
        case "list_artifacts":
            return handleListArtifacts(userId, listArtifactsArgs.parse(args));
        case "get_artifact":
            return handleGetArtifact(userId, getArtifactArgs.parse(args));
        case "archive_artifact":
            return handleArchiveArtifact(userId, archiveArtifactArgs.parse(args));

        // Phase 3 — skills
        case "create_question_sheet":
            return handleCreateQuestionSheet(userId, createQuestionSheetArgs.parse(args));
        case "create_action_plan":
            return handleCreateActionPlan(userId, createActionPlanArgs.parse(args));
        case "create_quiz":
            return handleCreateQuiz(userId, createQuizArgs.parse(args));

        // Track 2 — combined context + domain knowledge
        case "get_user_context_pack":
            return handleGetUserContextPack(userId, getUserContextPackArgs.parse(args));
        case "get_topic_mastery":
            return handleGetTopicMastery(userId, getTopicMasteryArgs.parse(args));
        case "get_topic_progression":
            return handleGetTopicProgression(userId, getTopicProgressionArgs.parse(args));
        case "get_company_blueprint":
            return handleGetCompanyBlueprint(userId, getCompanyBlueprintArgs.parse(args));
        case "get_recent_question_history":
            return handleGetRecentQuestionHistory(userId, getRecentQuestionHistoryArgs.parse(args));
        case "get_calendar_context":
            return handleGetCalendarContext(userId, getCalendarContextArgs.parse(args));
        case "validate_artifact_quality":
            return handleValidateArtifactQuality(userId, validateArtifactQualityArgs.parse(args));

        // Track 1 — conversational propose / revise / commit
        case "propose_question_sheet":
            return handleProposeQuestionSheet(userId, proposeQuestionSheetArgs.parse(args));
        case "revise_question_sheet":
            return handleReviseQuestionSheet(userId, reviseQuestionSheetArgs.parse(args));
        case "propose_action_plan":
            return handleProposeActionPlan(userId, proposeActionPlanArgs.parse(args));
        case "revise_action_plan":
            return handleReviseActionPlan(userId, reviseActionPlanArgs.parse(args));
        case "propose_quiz":
            return handleProposeQuiz(userId, proposeQuizArgs.parse(args));
        case "revise_quiz":
            return handleReviseQuiz(userId, reviseQuizArgs.parse(args));
        case "commit_artifact":
            return handleCommitArtifact(userId, commitArtifactArgs.parse(args));
        case "request_clarification":
            return handleRequestClarification(userId, requestClarificationArgs.parse(args));

        default:
            throw Object.assign(new Error(`unknown_tool:${name}`), { code: "UNKNOWN_TOOL" });
    }
}

function withTimeout<T>(p: Promise<T>, ms: number, name: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        const t = setTimeout(() => {
            const err = new Error(`tool_timeout:${name}`);
            (err as any).code = "TOOL_TIMEOUT";
            reject(err);
        }, ms);
        p.then(
            (v) => {
                clearTimeout(t);
                resolve(v);
            },
            (e) => {
                clearTimeout(t);
                reject(e);
            }
        );
    });
}

// ─────────────────────────────────────────────────────────────────
// Handlers
// ─────────────────────────────────────────────────────────────────

async function handleListRecentReports(userId: string, args: z.infer<typeof listRecentReportsArgs>) {
    const reports = await prisma.evaluationReport.findMany({
        where: {
            userId,
            ...(args.type ? { session: { is: { type: args.type } } } : {}),
        },
        orderBy: { generatedAt: "desc" },
        take: args.limit,
        select: {
            id: true,
            sessionId: true,
            overallScore: true,
            generatedAt: true,
            session: { select: { type: true, role: true, level: true, moduleConfig: true } },
        },
    });

    return {
        count: reports.length,
        reports: reports.map((r) => ({
            reportId: r.id,
            sessionId: r.sessionId,
            type: r.session.type,
            role: r.session.role,
            level: r.session.level,
            effectiveInterviewConfig: buildEffectiveInterviewConfig(r.session.type, r.session.moduleConfig),
            moduleConfigSummary: buildModuleConfigSummary(r.session.type, r.session.moduleConfig),
            overallScore: Math.round(Number(r.overallScore) || 0),
            generatedAt: r.generatedAt.toISOString(),
        })),
    };
}

async function handleGetReportSummary(userId: string, args: z.infer<typeof getReportSummaryArgs>) {
    const report = await prisma.evaluationReport.findFirst({
        where: { id: args.reportId, userId },
        select: {
            id: true,
            sessionId: true,
            overallScore: true,
            rubricScores: true,
            strengths: true,
            improvements: true,
            competencyScores: true,
            generatedAt: true,
            session: { select: { type: true, role: true, level: true, moduleConfig: true, completedAt: true } },
        },
    });
    if (!report) throw Object.assign(new Error("report_not_found"), { code: "NOT_FOUND" });
    return {
        reportId: report.id,
        sessionId: report.sessionId,
        type: report.session.type,
        role: report.session.role,
        level: report.session.level,
        effectiveInterviewConfig: buildEffectiveInterviewConfig(report.session.type, report.session.moduleConfig),
        moduleConfigSummary: buildModuleConfigSummary(report.session.type, report.session.moduleConfig),
        overallScore: Math.round(Number(report.overallScore) || 0),
        rubricScores: report.rubricScores,
        competencyScores: normalizeCompetencyScores(report.competencyScores),
        strengths: report.strengths,
        improvements: report.improvements,
        generatedAt: report.generatedAt.toISOString(),
        completedAt: report.session.completedAt?.toISOString() ?? null,
    };
}

async function handleGetSessionQuestionDetail(userId: string, args: z.infer<typeof getSessionQuestionDetailArgs>) {
    const report = await prisma.evaluationReport.findFirst({
        where: { id: args.reportId, userId },
        select: {
            id: true,
            sessionId: true,
            questions: true,
            session: { select: { type: true, role: true, level: true, moduleConfig: true } },
        },
    });
    if (!report) throw Object.assign(new Error("report_not_found"), { code: "NOT_FOUND" });

    const reportQuestions = Array.isArray(report.questions) ? report.questions as any[] : [];
    if (reportQuestions.length > 0) {
        const questions = reportQuestions.map((question, index) => {
            const title = String(question?.title || "").trim();
            const category = String(question?.category || "unknown").trim().toLowerCase();
            const finalCode = typeof question?.finalCode === "string" && question.finalCode.trim()
                ? question.finalCode
                : null;
            return {
                ordinal: index + 1,
                questionRef: question?.id || question?.questionId || `report-question-${index + 1}`,
                title: !title || title.toLowerCase() === "unknown question" ? `Question ${index + 1}` : title,
                category: category || "unknown",
                module: inferQuestionModule(category),
                difficulty: question?.difficulty || null,
                score: question?.score !== null && question?.score !== undefined ? Math.round(Number(question.score)) : null,
                hasFinalCode: Boolean(finalCode),
                finalCode,
                aiNotes: question?.aiNotes || null,
                sampleAnswer: !finalCode && question?.sampleAnswer ? String(question.sampleAnswer).slice(0, 500) : null,
                source: "evaluation_report.questions",
            };
        });

        return {
            reportId: report.id,
            sessionId: report.sessionId,
            interviewType: report.session.type,
            effectiveInterviewConfig: buildEffectiveInterviewConfig(report.session.type, report.session.moduleConfig),
            moduleConfigSummary: buildModuleConfigSummary(report.session.type, report.session.moduleConfig),
            source: "evaluation_report.questions",
            questionCount: questions.length,
            questions,
            byModule: questions.reduce((acc, question) => {
                const key = question.module || "unknown";
                acc[key] = (acc[key] || 0) + 1;
                return acc;
            }, {} as Record<string, number>),
        };
    }

    const sessionQuestions = await prisma.sessionQuestion.findMany({
        where: { sessionId: report.sessionId },
        orderBy: { askedAt: "asc" },
        select: {
            id: true,
            questionId: true,
            questionSqlId: true,
            questionFundamentalId: true,
            questionTitle: true,
            questionCategory: true,
            questionDifficulty: true,
            finalCode: true,
            score: true,
            hintsUsed: true,
            timeSpent: true,
            aiNotes: true,
            sampleAnswer: true,
            askedAt: true,
        },
    });

    const questions = sessionQuestions.map((question, index) => {
        const category = question.questionCategory || "unknown";
        const finalCode = typeof question.finalCode === "string" && question.finalCode.trim()
            ? question.finalCode
            : null;
        return {
            ordinal: index + 1,
            questionRef: question.questionId || question.questionSqlId || question.questionFundamentalId || question.id,
            title: question.questionTitle || "Untitled Question",
            category,
            module: inferQuestionModule(category),
            difficulty: question.questionDifficulty || null,
            askedAt: question.askedAt?.toISOString() ?? null,
            timeSpentSeconds: question.timeSpent || null,
            hintsUsed: question.hintsUsed ?? 0,
            score: question.score !== null && question.score !== undefined ? Math.round(Number(question.score)) : null,
            hasFinalCode: Boolean(finalCode),
            finalCode,
            aiNotes: question.aiNotes || null,
            sampleAnswer: !finalCode && question.sampleAnswer ? question.sampleAnswer.slice(0, 500) : null,
        };
    });

    return {
        reportId: report.id,
        sessionId: report.sessionId,
        interviewType: report.session.type,
        effectiveInterviewConfig: buildEffectiveInterviewConfig(report.session.type, report.session.moduleConfig),
        moduleConfigSummary: buildModuleConfigSummary(report.session.type, report.session.moduleConfig),
        questionCount: questions.length,
        questions,
        byModule: questions.reduce((acc, question) => {
            const key = question.module || "unknown";
            acc[key] = (acc[key] || 0) + 1;
            return acc;
        }, {} as Record<string, number>),
    };
}

const STAGE_ALIASES: Record<string, string[]> = {
    INTRO: ["intro", "introduction", "resume", "background"],
    DSA: ["dsa", "coding", "algorithm", "leetcode", "graph", "dp", "binary search", "code"],
    FUNDAMENTALS: ["fundamentals", "cs", "os", "operating system", "cn", "network", "dbms", "oops", "sql"],
    SYSTEM_DESIGN: ["system design", "architecture", "scalability", "scale"],
    BEHAVIOURAL: ["behavioural", "behavioral", "star", "leadership", "conflict"],
    GEN_AI_CONCEPTS: ["genai", "gen ai", "llm", "rag", "prompting", "model evaluation"],
    GEN_AI_CODING: ["genai coding", "ai coding"],
    GEN_AI_SYSTEM_DESIGN: ["genai system design", "ai system design"],
    DS_CONCEPTS: ["data science", "statistics", "machine learning", "ml"],
    DS_SQL: ["ds sql", "data science sql", "sql"],
    DS_CODING: ["ds coding", "data science coding", "pandas", "python"],
    DS_BUSINESS_CASE: ["business case", "metrics case", "business metrics"],
    PM_CASE: ["pm case", "product case", "circles"],
    PM_CONCEPTS: ["pm concepts", "product metrics", "product sense"],
    PM_STRATEGY: ["strategy", "product strategy"],
    PM_BEHAVIORAL: ["pm behavioral", "pm behavioural"],
    PROBLEM_SOLVING: ["problem solving", "case", "analytical"],
    RESUME_STUDIES: ["education", "studies", "degree", "college"],
    RESUME_PROJECTS: ["project", "projects"],
    RESUME_EXPERIENCE: ["experience", "work experience", "internship"],
    RESUME_RESPONSIBILITY: ["responsibility", "position of responsibility", "por"],
    RESUME_SKILLS: ["skills", "claims", "tools"],
};

function inferStageForTranscript(message: string, enabledStages: string[], explicitStage?: string): string | null {
    if (explicitStage && enabledStages.includes(explicitStage)) return explicitStage;
    const normalizedExplicit = explicitStage?.trim().toUpperCase();
    if (normalizedExplicit && enabledStages.includes(normalizedExplicit)) return normalizedExplicit;

    const lower = message.toLowerCase();
    const direct = enabledStages.find((stage) => lower.includes(stage.toLowerCase()));
    if (direct) return direct;

    const matches = enabledStages
        .filter((stage) => stage !== "CLOSING")
        .filter((stage) => (STAGE_ALIASES[stage] || []).some((alias) => lower.includes(alias)));

    if (matches.length === 1) return matches[0];
    if (lower.includes("sql")) {
        if (enabledStages.includes("DS_SQL")) return "DS_SQL";
        if (enabledStages.includes("FUNDAMENTALS")) return "FUNDAMENTALS";
    }
    return null;
}

function clipStageTranscript(full: string): { transcript: string; clipped: boolean } {
    const maxChars = 6500;
    if (full.length <= maxChars) return { transcript: full, clipped: false };
    return {
        transcript: `${full.slice(0, 2800).trimEnd()}\n...[stage middle omitted]...\n${full.slice(-3200).trimStart()}`,
        clipped: true,
    };
}

async function handleGetReportStageTranscriptContext(
    userId: string,
    args: z.infer<typeof getReportStageTranscriptContextArgs>
) {
    const report = await prisma.evaluationReport.findFirst({
        where: { id: args.reportId, userId },
        select: {
            id: true,
            sessionId: true,
            session: { select: { type: true, moduleConfig: true } },
        },
    });
    if (!report) throw Object.assign(new Error("report_not_found"), { code: "NOT_FOUND" });

    const effectiveConfig = buildEffectiveInterviewConfig(report.session.type, report.session.moduleConfig);
    const availableStages = (effectiveConfig.enabledStages || []).filter((stage: string) => stage !== "CLOSING");
    const requestedStage = inferStageForTranscript(args.query || "", availableStages, args.stage);

    if (!requestedStage) {
        return {
            transcriptAvailable: false,
            reason: "stage_not_clear",
            availableStages,
            guidance: "Ask which stage/module to inspect, or answer from report summary.",
            transcript: "",
        };
    }

    const messages = await prisma.sessionMessage.findMany({
        where: {
            sessionId: report.sessionId,
            stage: requestedStage,
            role: { in: ["user", "assistant"] },
        },
        orderBy: { createdAt: "asc" },
        select: { role: true, content: true, createdAt: true },
        take: 80,
    });
    const full = messages.map((message) => `${message.role.toUpperCase()}: ${message.content}`).join("\n");
    const clipped = clipStageTranscript(full);

    return {
        transcriptAvailable: messages.length > 0,
        reportId: report.id,
        stage: requestedStage,
        availableStages,
        messageCount: messages.length,
        excerptPolicy: clipped.clipped ? "stage_head_tail_6500" : "stage_full",
        transcript: clipped.transcript,
    };
}

function normalizeCompetencyScores(raw: unknown) {
    if (!Array.isArray(raw)) return [];
    return raw
        .map((x: any) => ({
            id: String(x?.id || "").trim(),
            label: String(x?.label || "").trim(),
            score: Math.max(0, Math.min(10, Math.round(Number(x?.score) || 0))),
            strength: String(x?.strength || "").trim(),
            evidence: typeof x?.evidence === "string" ? x.evidence : "",
            tip: typeof x?.tip === "string" ? x.tip : "",
        }))
        .filter((x) => x.id && x.label);
}

async function handleGetUserReportTrend(userId: string, args: z.infer<typeof getUserReportTrendArgs>) {
    const since = new Date(Date.now() - args.periodDays * 24 * 60 * 60 * 1000);
    const sessionFilter: any = {
        OR: [{ completedAt: { gte: since } }, { completedAt: null, startedAt: { gte: since } }],
    };
    if (args.type) sessionFilter.type = args.type;

    const reports = await prisma.evaluationReport.findMany({
        where: { userId, session: { is: sessionFilter } },
        orderBy: { generatedAt: "desc" },
        take: args.limit,
        select: {
            id: true,
            overallScore: true,
            rubricScores: true,
            generatedAt: true,
            session: { select: { type: true, moduleConfig: true } },
        },
    });

    const trend = reports
        .map((r) => {
        const effectiveInterviewConfig = buildEffectiveInterviewConfig(r.session.type, r.session.moduleConfig);
        const weakestRubrics = Array.isArray(r.rubricScores)
            ? (r.rubricScores as any[])
                  .map((x) => ({ category: String(x.category || "general"), score: Number(x.score) || 0 }))
                  .sort((a, b) => a.score - b.score)
                  .slice(0, 2)
                  .map((x) => x.category)
            : [];
        return {
            reportId: r.id,
            generatedAt: r.generatedAt.toISOString(),
            type: r.session.type,
            effectiveInterviewConfig,
            moduleConfigSummary: buildModuleConfigSummary(r.session.type, r.session.moduleConfig),
            overallScore: Math.round(Number(r.overallScore) || 0),
            weakestRubrics,
        };
    })
        .filter((item) => {
            const moduleFilter = args.module?.toLowerCase().replace(/\s+/g, "_");
            const topicFilter = args.topic?.toLowerCase().replace(/\s+/g, "_");
            if (moduleFilter && !item.effectiveInterviewConfig.enabledModules.some((m: string) => m.toLowerCase() === moduleFilter)) {
                return false;
            }
            if (topicFilter) {
                const topics = [
                    ...item.effectiveInterviewConfig.selectedDsaTopics,
                    ...item.effectiveInterviewConfig.selectedCsTopics,
                    ...item.effectiveInterviewConfig.selectedGenAITopics,
                    ...item.effectiveInterviewConfig.selectedDSTopics,
                ].map((topic: string) => topic.toLowerCase().replace(/\s+/g, "_"));
                if (!topics.some((topic: string) => topic.includes(topicFilter) || topicFilter.includes(topic))) return false;
            }
            return true;
        });

    const newest = trend[0]?.overallScore ?? null;
    const oldest = trend[trend.length - 1]?.overallScore ?? null;
    const scoreDelta = newest !== null && oldest !== null ? newest - oldest : 0;

    const typeCounts: Record<string, number> = {};
    for (const t of trend) typeCounts[t.type] = (typeCounts[t.type] || 0) + 1;

    return {
        periodDays: args.periodDays,
        typeFilter: args.type ?? null,
        moduleFilter: args.module ?? null,
        topicFilter: args.topic ?? null,
        count: trend.length,
        trend,
        scoreDelta,
        averageScore: trend.length
            ? Math.round(trend.reduce((s, t) => s + t.overallScore, 0) / trend.length)
            : null,
        typeCounts,
    };
}

async function handleGetScorePercentile(userId: string, args: z.infer<typeof getScorePercentileArgs>) {
    const target = await prisma.evaluationReport.findFirst({
        where: { id: args.reportId, userId },
        select: { id: true, overallScore: true, generatedAt: true, session: { select: { type: true } } },
    });
    if (!target) throw Object.assign(new Error("report_not_found"), { code: "NOT_FOUND" });

    const all = await prisma.evaluationReport.findMany({
        where: { userId, session: { is: { type: target.session.type } } },
        select: { overallScore: true },
    });
    const scores = all.map((r) => Number(r.overallScore) || 0).sort((a, b) => a - b);
    const targetScore = Number(target.overallScore) || 0;
    const below = scores.filter((s) => s < targetScore).length;
    const percentile = scores.length > 0 ? Math.round((below / scores.length) * 100) : null;
    const avg = scores.length > 0 ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null;

    return {
        reportId: target.id,
        targetScore: Math.round(targetScore),
        sessionType: target.session.type,
        peerCount: scores.length,
        personalPercentile: percentile,
        personalAverage: avg,
        bestScore: scores.length > 0 ? Math.round(scores[scores.length - 1]) : null,
    };
}

async function handleGetQuestionActivity(userId: string, args: z.infer<typeof getQuestionActivitySnapshotArgs>) {
    const since = new Date(Date.now() - args.periodDays * 24 * 60 * 60 * 1000);

    const [progress, recentSubmissions] = await Promise.all([
        prisma.userQuestionProgress.findMany({
            where: { userId, lastAttemptedAt: { gte: since } },
            select: { status: true, language: true, lastAttemptedAt: true, bestScore: true, questionId: true },
            orderBy: { lastAttemptedAt: "desc" },
            take: 200,
        }),
        prisma.userQuestionSubmission.findMany({
            where: { userId, createdAt: { gte: since } },
            orderBy: { createdAt: "desc" },
            take: 25,
            select: {
                id: true,
                questionId: true,
                status: true,
                language: true,
                score: true,
                createdAt: true,
            },
        }),
    ]);

    const statusCounts: Record<string, number> = {};
    const languageCounts: Record<string, number> = {};
    for (const p of progress) {
        statusCounts[p.status] = (statusCounts[p.status] || 0) + 1;
        if (p.language) languageCounts[p.language] = (languageCounts[p.language] || 0) + 1;
    }
    const labels = await resolveQuestionLabels([
        ...progress.map((p) => p.questionId),
        ...recentSubmissions.map((s) => s.questionId),
    ]);

    return {
        periodDays: args.periodDays,
        attempted: progress.length,
        solved: statusCounts["solved"] || 0,
        statusCounts,
        languageCounts,
        recentSolvedQuestions: progress
            .filter((p) => p.status === "solved")
            .slice(0, 20)
            .map((p) => {
                const label = labels.get(p.questionId);
                return {
                    title: label?.title || "Question title unavailable",
                    category: label?.category || "Question",
                    language: p.language,
                    solvedAt: p.lastAttemptedAt.toISOString(),
                };
            }),
        recentSubmissions: recentSubmissions.map((s) => ({
            submissionId: s.id,
            title: labels.get(s.questionId)?.title || "Question title unavailable",
            category: labels.get(s.questionId)?.category || "Question",
            status: s.status,
            language: s.language,
            score: s.score ? Number(s.score) : null,
            createdAt: s.createdAt.toISOString(),
        })),
    };
}

async function handleGetWeakAreas(userId: string, args: z.infer<typeof getWeakAreasArgs>) {
    const where: any = { userId };
    if (args.status !== "all") {
        where.status =
            args.status === "open"
                ? WeakAreaStatus.OPEN
                : args.status === "improving"
                    ? WeakAreaStatus.IMPROVING
                    : WeakAreaStatus.RESOLVED;
    }
    if (args.category) where.category = args.category;

    const rows = await prisma.userWeakArea.findMany({
        where,
        orderBy: [{ severity: "asc" }, { lastSeenAt: "desc" }],
        take: args.limit,
        select: {
            id: true,
            category: true,
            subcategory: true,
            topic: true,
            severity: true,
            evidence: true,
            status: true,
            occurrences: true,
            firstSeenAt: true,
            lastSeenAt: true,
            reportId: true,
        },
    });

    return {
        count: rows.length,
        weakAreas: rows.map((r) => ({
            id: r.id,
            category: r.category,
            subcategory: r.subcategory,
            topic: r.topic,
            severity: r.severity.toLowerCase(),
            evidence: r.evidence,
            status: r.status.toLowerCase(),
            occurrences: r.occurrences,
            firstSeenAt: r.firstSeenAt.toISOString(),
            lastSeenAt: r.lastSeenAt.toISOString(),
            reportId: r.reportId,
        })),
    };
}

async function handleGetRecentMistakes(userId: string, args: z.infer<typeof getRecentMistakesArgs>) {
    const where: any = { userId };
    if (args.mistakeType) {
        const enumKey = args.mistakeType.toUpperCase() as keyof typeof MistakeType;
        if (MistakeType[enumKey]) where.mistakeType = MistakeType[enumKey];
    }
    if (args.reportId) where.reportId = args.reportId;

    const rows = await prisma.userMistake.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: args.limit,
        select: {
            id: true,
            reportId: true,
            questionRef: true,
            questionTitle: true,
            mistakeType: true,
            description: true,
            correctApproach: true,
            topicTags: true,
            createdAt: true,
        },
    });

    return {
        count: rows.length,
        mistakes: rows.map((r) => ({
            id: r.id,
            reportId: r.reportId,
            questionRef: r.questionRef,
            questionTitle: r.questionTitle,
            mistakeType: r.mistakeType.toLowerCase(),
            description: r.description,
            correctApproach: r.correctApproach,
            topicTags: r.topicTags,
            createdAt: r.createdAt.toISOString(),
        })),
    };
}

// Reserved for future cache plumbing (stats, trend memoization).
// Keeps the redis import live so adding cached handlers doesn't regress.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _redisHandle = () => getRedis();
