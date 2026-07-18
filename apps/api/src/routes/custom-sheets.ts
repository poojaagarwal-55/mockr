import { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { CSFundamentalQuestion } from "../models/CSFundamentalQuestion.js";
import { DSAQuestion } from "../models/DSAQuestion.js";
import { SQLQuestion } from "../models/SQLQuestion.js";
import { SystemDesignQuestion } from "../models/system-design-question.js";
import mongoose from "mongoose";

const createSheetSchema = z.object({
    name: z.string().min(1).max(100),
    description: z.string().max(500).optional(),
});

const addQuestionSchema = z.object({
    questionId: z.union([
        z.string().min(1), // Single question ID
        z.array(z.string().min(1)) // Multiple question IDs
    ]),
    questionType: z.enum(['cs', 'dsa', 'sql', 'sd']).optional(), // Add question type
});

const updateProgressSchema = z.object({
    questionId: z.string().min(1),
    status: z.enum(["unattempted", "attempted", "completed"]),
    userAnswer: z.string().optional(),
    feedback: z.any().optional(),
});

export default async function customSheetsRoutes(fastify: FastifyInstance) {
    // ─── Get all custom sheets for user ─────────────────────
    fastify.get("/custom-sheets", {
        preHandler: [fastify.authenticate],
    }, async (request, reply) => {
        const userId = request.user!.id;

        const sheets = await prisma.customQuestionSheet.findMany({
            where: { userId },
            orderBy: { createdAt: "desc" },
            select: {
                id: true,
                name: true,
                description: true,
                questionIds: true,
                createdAt: true,
                updatedAt: true,
            },
        });

        return {
            success: true,
            data: sheets.map(sheet => ({
                ...sheet,
                questionCount: Array.isArray(sheet.questionIds) ? sheet.questionIds.length : 0,
            })),
        };
    });

    // ─── Get single custom sheet ────────────────────────────
    fastify.get("/custom-sheets/:sheetId", {
        preHandler: [fastify.authenticate],
    }, async (request, reply) => {
        const { sheetId } = request.params as { sheetId: string };
        const userId = request.user!.id;

        const sheet = await prisma.customQuestionSheet.findFirst({
            where: { id: sheetId, userId },
        });

        if (!sheet) {
            return reply.status(404).send({
                error: "Not Found",
                message: "Custom sheet not found",
            });
        }

        // Fetch full question details for all question IDs
        const questionData = Array.isArray(sheet.questionIds) ? sheet.questionIds as any[] : [];
        console.log(`[Custom Sheet ${sheetId}] Found ${questionData.length} questions:`, questionData);
        
        const questions: any[] = [];
        const progress: Record<string, { status: string; attempts: number; lastAnswer: string | null; feedback: any }> = {};

        // Process questions (support both old string format and new object format)
        for (const qData of questionData) {
            try {
                let qId: string;
                let qType: string;
                
                const meta = (typeof qData === "object" && qData !== null) ? qData as Record<string, any> : null;
                const status = meta?.status === "completed" || meta?.status === "attempted" || meta?.status === "unattempted"
                    ? meta.status
                    : "unattempted";
                const attempts = Number.isFinite(Number(meta?.attempts)) ? Number(meta?.attempts) : 0;
                const lastAnswer = typeof meta?.lastAnswer === "string" ? meta.lastAnswer : null;
                const feedback = meta?.feedback ?? null;

                if (typeof qData === 'string') {
                    // Old format: just the MongoDB ObjectId
                    qId = qData;
                    qType = 'unknown'; // We'll try to detect the type
                } else if (typeof qData === 'object' && qData.id) {
                    // New format: object with metadata
                    qId = qData.id;
                    qType = qData.type || 'unknown';
                } else {
                    console.log(`[Custom Sheet] Invalid question data:`, qData);
                    continue;
                }
                
                console.log(`[Custom Sheet] Processing question ID: ${qId}, type: ${qType}`);
                
                // Check if it's a valid MongoDB ObjectId
                if (!mongoose.Types.ObjectId.isValid(qId)) {
                    console.log(`[Custom Sheet] Invalid MongoDB ObjectId: ${qId}`);
                    continue;
                }
                
                // Try fetching from the appropriate collection based on type
                let question = null;
                
                if (qType === 'cs' || qType === 'unknown') {
                    question = await CSFundamentalQuestion.findById(qId).lean();
                    if (question) {
                        console.log(`[Custom Sheet] Found CS Fundamentals question`);
                        const sheetQuestionId = `cs-${qId}`;
                        questions.push({
                            id: sheetQuestionId,
                            question: question.question,
                            category: question.topic || 'cs_fundamentals',
                            difficulty: 'medium',
                            whatWeAreLookingFor: question.answer || '',
                        });
                        progress[sheetQuestionId] = { status, attempts, lastAnswer, feedback };
                        continue;
                    }
                }
                
                if (qType === 'dsa' || qType === 'unknown') {
                    question = await DSAQuestion.findById(qId).select('title difficulty').lean();
                    if (question) {
                        console.log(`[Custom Sheet] Found DSA question`);
                        const sheetQuestionId = `dsa-${qId}`;
                        questions.push({
                            id: sheetQuestionId,
                            question: question.title,
                            category: 'coding',
                            difficulty: question.difficulty?.toLowerCase() || 'medium',
                            whatWeAreLookingFor: '',
                        });
                        progress[sheetQuestionId] = { status, attempts, lastAnswer, feedback };
                        continue;
                    }
                }
                
                if (qType === 'sql' || qType === 'unknown') {
                    question = await SQLQuestion.findById(qId).select('title').lean();
                    if (question) {
                        console.log(`[Custom Sheet] Found SQL question`);
                        const sheetQuestionId = `sql-${qId}`;
                        questions.push({
                            id: sheetQuestionId,
                            question: question.title,
                            category: 'sql',
                            difficulty: 'medium',
                            whatWeAreLookingFor: '',
                        });
                        progress[sheetQuestionId] = { status, attempts, lastAnswer, feedback };
                        continue;
                    }
                }
                
                if (qType === 'sd' || qType === 'unknown') {
                    question = await SystemDesignQuestion.findById(qId).select('title difficulty').lean();
                    if (question) {
                        console.log(`[Custom Sheet] Found System Design question`);
                        const sheetQuestionId = `sd-${qId}`;
                        questions.push({
                            id: sheetQuestionId,
                            question: question.title,
                            category: 'system_design',
                            difficulty: question.difficulty?.toLowerCase() || 'medium',
                            whatWeAreLookingFor: '',
                        });
                        progress[sheetQuestionId] = { status, attempts, lastAnswer, feedback };
                        continue;
                    }
                }
                
                console.log(`[Custom Sheet] Question ${qId} not found in any collection`);
            } catch (err) {
                console.error(`[Custom Sheet] Failed to fetch question:`, err);
            }
        }

        console.log(`[Custom Sheet ${sheetId}] Successfully fetched ${questions.length} questions`);

        return {
            success: true,
            data: {
                id: sheet.id,
                name: sheet.name,
                description: sheet.description,
                createdAt: sheet.createdAt,
                updatedAt: sheet.updatedAt,
                questionCount: questions.length,
                questions,
                progress,
            },
        };
    });

    // ─── Create new custom sheet ────────────────────────────
    fastify.post("/custom-sheets", {
        preHandler: [fastify.authenticate],
    }, async (request, reply) => {
        const parsed = createSheetSchema.safeParse(request.body);
        if (!parsed.success) {
            return reply.status(400).send({
                error: "Validation Error",
                details: parsed.error.flatten().fieldErrors,
            });
        }

        const userId = request.user!.id;
        const { name, description } = parsed.data;

        const sheet = await prisma.customQuestionSheet.create({
            data: {
                userId,
                name,
                description,
                questionIds: [],
            },
        });

        return reply.status(201).send({
            success: true,
            data: {
                ...sheet,
                questionCount: 0,
            },
        });
    });

    // ─── Add question to custom sheet ───────────────────────
    fastify.post("/custom-sheets/:sheetId/questions", {
        preHandler: [fastify.authenticate],
    }, async (request, reply) => {
        const { sheetId } = request.params as { sheetId: string };
        const userId = request.user!.id;

        const parsed = addQuestionSchema.safeParse(request.body);
        if (!parsed.success) {
            return reply.status(400).send({
                error: "Validation Error",
                details: parsed.error.flatten().fieldErrors,
            });
        }

        const { questionId, questionType } = parsed.data;

        // Find the sheet
        const sheet = await prisma.customQuestionSheet.findFirst({
            where: { id: sheetId, userId },
        });

        if (!sheet) {
            return reply.status(404).send({
                error: "Not Found",
                message: "Custom sheet not found",
            });
        }

        // Get current questions (support both old format and new format)
        const currentQuestions = Array.isArray(sheet.questionIds) ? sheet.questionIds as any[] : [];
        
        // Handle both single and multiple question IDs
        const questionIds = Array.isArray(questionId) ? questionId : [questionId];
        const newQuestions: any[] = [];
        const duplicates: string[] = [];
        
        for (const qId of questionIds) {
            // Check if question already exists
            const questionExists = currentQuestions.some((q: any) => {
                if (typeof q === 'string') {
                    return q === qId;
                } else if (typeof q === 'object' && q.id) {
                    return q.id === qId;
                }
                return false;
            });

            if (questionExists) {
                duplicates.push(qId);
            } else {
                // Create question object with metadata
                const questionObject = {
                    id: qId,
                    type: questionType || 'dsa', // Default to DSA for backward compatibility
                    addedAt: new Date().toISOString(),
                    status: "unattempted",
                    attempts: 0,
                    lastAnswer: null,
                    feedback: null,
                };
                newQuestions.push(questionObject);
            }
        }

        // If all questions are duplicates, return error
        if (newQuestions.length === 0) {
            return reply.status(400).send({
                error: "Duplicate",
                message: duplicates.length === 1 
                    ? "Question already exists in this sheet"
                    : "All questions already exist in this sheet",
            });
        }

        // Add the new questions
        const updatedSheet = await prisma.customQuestionSheet.update({
            where: { id: sheetId },
            data: {
                questionIds: [...currentQuestions, ...newQuestions],
            },
        });

        return {
            success: true,
            data: {
                ...updatedSheet,
                questionCount: Array.isArray(updatedSheet.questionIds) ? updatedSheet.questionIds.length : 0,
                added: newQuestions.length,
                duplicates: duplicates.length,
            },
        };
    });

    // ─── Update progress for custom sheet question ─────────
    fastify.patch("/custom-sheets/:sheetId/progress", {
        preHandler: [fastify.authenticate],
    }, async (request, reply) => {
        const { sheetId } = request.params as { sheetId: string };
        const userId = request.user!.id;

        const parsed = updateProgressSchema.safeParse(request.body);
        if (!parsed.success) {
            return reply.status(400).send({
                error: "Validation Error",
                details: parsed.error.flatten().fieldErrors,
            });
        }

        const { questionId, status, userAnswer, feedback } = parsed.data;

        const incomingMatch = questionId.match(/^(cs|dsa|sql|sd)-(.+)$/);
        const incomingType = incomingMatch?.[1] ?? "unknown";
        const incomingRawId = incomingMatch?.[2] ?? questionId;

        const sheet = await prisma.customQuestionSheet.findFirst({
            where: { id: sheetId, userId },
        });

        if (!sheet) {
            return reply.status(404).send({
                error: "Not Found",
                message: "Custom sheet not found",
            });
        }

        const currentQuestions = Array.isArray(sheet.questionIds) ? [...(sheet.questionIds as any[])] : [];

        const targetIndex = currentQuestions.findIndex((entry: any) => {
            if (typeof entry === "string") {
                return entry === incomingRawId || entry === questionId;
            }
            if (entry && typeof entry === "object" && typeof entry.id === "string") {
                return entry.id === incomingRawId || entry.id === questionId;
            }
            return false;
        });

        if (targetIndex === -1) {
            return reply.status(400).send({
                error: "Invalid Request",
                message: "Question not found in this custom sheet",
            });
        }

        const existingEntry = currentQuestions[targetIndex];
        const nowIso = new Date().toISOString();
        const existingAttempts =
            typeof existingEntry === "object" && existingEntry !== null && Number.isFinite(Number(existingEntry.attempts))
                ? Number(existingEntry.attempts)
                : 0;

        const nextEntry: Record<string, any> =
            typeof existingEntry === "object" && existingEntry !== null
                ? { ...existingEntry }
                : {
                    id: incomingRawId,
                    type: incomingType,
                    addedAt: nowIso,
                };

        nextEntry.id = typeof nextEntry.id === "string" ? nextEntry.id : incomingRawId;
        nextEntry.type = typeof nextEntry.type === "string" ? nextEntry.type : incomingType;
        nextEntry.addedAt = typeof nextEntry.addedAt === "string" ? nextEntry.addedAt : nowIso;
        nextEntry.status = status;
        nextEntry.attempts = existingAttempts + 1;
        if (userAnswer !== undefined) {
            nextEntry.lastAnswer = userAnswer;
        } else if (nextEntry.lastAnswer === undefined) {
            nextEntry.lastAnswer = null;
        }
        if (feedback !== undefined) {
            nextEntry.feedback = feedback;
        } else if (nextEntry.feedback === undefined) {
            nextEntry.feedback = null;
        }

        currentQuestions[targetIndex] = nextEntry;

        await prisma.customQuestionSheet.update({
            where: { id: sheetId },
            data: { questionIds: currentQuestions },
        });

        return {
            success: true,
            data: {
                sheetId,
                questionId,
                status,
                attempts: nextEntry.attempts,
            },
        };
    });

    // ─── Remove question from custom sheet ──────────────────
    fastify.delete("/custom-sheets/:sheetId/questions/:questionId", {
        preHandler: [fastify.authenticate],
    }, async (request, reply) => {
        const { sheetId, questionId } = request.params as { sheetId: string; questionId: string };
        const userId = request.user!.id;

        const sheet = await prisma.customQuestionSheet.findFirst({
            where: { id: sheetId, userId },
        });

        if (!sheet) {
            return reply.status(404).send({
                error: "Not Found",
                message: "Custom sheet not found",
            });
        }

        const currentQuestions = Array.isArray(sheet.questionIds) ? sheet.questionIds as any[] : [];
        
        // Filter out the question (support both old string format and new object format)
        const updatedQuestions = currentQuestions.filter((q: any) => {
            if (typeof q === 'string') {
                return q !== questionId;
            } else if (typeof q === 'object' && q.id) {
                return q.id !== questionId;
            }
            return true; // Keep unknown formats for safety
        });

        const updatedSheet = await prisma.customQuestionSheet.update({
            where: { id: sheetId },
            data: { questionIds: updatedQuestions },
        });

        return {
            success: true,
            data: {
                ...updatedSheet,
                questionCount: updatedQuestions.length,
            },
        };
    });

    // ─── Update custom sheet ────────────────────────────────
    fastify.patch("/custom-sheets/:sheetId", {
        preHandler: [fastify.authenticate],
    }, async (request, reply) => {
        const { sheetId } = request.params as { sheetId: string };
        const userId = request.user!.id;

        const parsed = createSheetSchema.partial().safeParse(request.body);
        if (!parsed.success) {
            return reply.status(400).send({
                error: "Validation Error",
                details: parsed.error.flatten().fieldErrors,
            });
        }

        const sheet = await prisma.customQuestionSheet.findFirst({
            where: { id: sheetId, userId },
        });

        if (!sheet) {
            return reply.status(404).send({
                error: "Not Found",
                message: "Custom sheet not found",
            });
        }

        const updatedSheet = await prisma.customQuestionSheet.update({
            where: { id: sheetId },
            data: parsed.data,
        });

        return {
            success: true,
            data: {
                ...updatedSheet,
                questionCount: Array.isArray(updatedSheet.questionIds) ? updatedSheet.questionIds.length : 0,
            },
        };
    });

    // ─── Delete custom sheet ────────────────────────────────
    fastify.delete("/custom-sheets/:sheetId", {
        preHandler: [fastify.authenticate],
    }, async (request, reply) => {
        const { sheetId } = request.params as { sheetId: string };
        const userId = request.user!.id;

        const sheet = await prisma.customQuestionSheet.findFirst({
            where: { id: sheetId, userId },
        });

        if (!sheet) {
            return reply.status(404).send({
                error: "Not Found",
                message: "Custom sheet not found",
            });
        }

        await prisma.customQuestionSheet.delete({
            where: { id: sheetId },
        });

        return {
            success: true,
            message: "Custom sheet deleted successfully",
        };
    });
}
