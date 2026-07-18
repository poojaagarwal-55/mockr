import { handleToolCall } from "./src/services/agent/tool-handlers.js";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function run() {
    console.log("Starting test fetch_question tool...");
    const ctx = {
        sessionId: "test-session",
        userId: "test-user",
        interviewType: "coding",
        currentStage: "DSA",
        askedQuestionIds: [],
        role: "backend",
        level: "SDE2",
        stageOrder: ["INTRO", "DSA", "CLOSING"],
        emit: (event: string, payload: any) => {
            console.log(`[EMIT] ${event}`, payload);
        }
    };

    try {
        const result = await handleToolCall("fetch_question", { category: "DSA" }, ctx as any);
        console.log("TOOL RESULT:");
        console.log(result.substring(0, 500) + "...");
    } catch (e) {
        console.error("TOOL CRASHED:");
        console.error(e);
    }
}

run().finally(() => prisma.$disconnect());
