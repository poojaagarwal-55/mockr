import { PrismaClient } from '@prisma/client';
import { CSFundamentalQuestion } from '../models/CSFundamentalQuestion.js';
import mongoose from 'mongoose';

const prisma = new PrismaClient();

async function run() {
    await mongoose.connect(process.env.MONGODB_URI || "mongodb://localhost:27017/interviewforge");
    
    // Get the most recent completed cs_fundamentals session
    const session = await prisma.interviewSession.findFirst({
        where: { type: 'cs_fundamentals', status: 'COMPLETED' },
        orderBy: { createdAt: 'desc' },
        include: { sessionQuestions: { orderBy: { askedAt: 'asc' } } }
    });
    
    if (!session) {
        console.log("No completed cs_fundamentals session found.");
        process.exit(0);
    }
    
    const sessionMessages = await prisma.sessionMessage.findMany({
        where: { sessionId: session.id, stage: { notIn: ['INTRO', 'CLOSING'] } },
        orderBy: { createdAt: 'asc' }
    });
    
    console.log(`Testing Session: ${session.id}`);
    console.log(`Pre-fetched DB questions count: ${session.sessionQuestions.length}`);
    
    // Extract QA like the route
    const qMsgIndices = [];
    for (let i = 0; i < sessionMessages.length; i++) {
        const m = sessionMessages[i];
        if (m.role !== "assistant") continue;
        if (m.content.length < 30) continue;
        const hasQuestion = m.content.includes("?");
        const hasImperative = /\b(explain|describe|define|discuss|compare|differentiate|decompose|design)\b/i.test(m.content);
        if (hasQuestion || hasImperative) {
            qMsgIndices.push(i);
        }
    }
    
    const conversationQAs = [];
    for (let qi = 0; qi < qMsgIndices.length; qi++) {
        const qIdx = qMsgIndices[qi];
        const nextQIdx = qi + 1 < qMsgIndices.length ? qMsgIndices[qi + 1] : sessionMessages.length;
        const ac = sessionMessages[qIdx].content;
        
        const sentences = ac.split(/(?<=[.!?])\s+/);
        const qSentences = sentences.filter(s => s.trim().endsWith("?"));
        let title = qSentences.length > 0 ? qSentences[qSentences.length - 1].trim() : ac;
        
        const userMsgs = sessionMessages.slice(qIdx + 1, nextQIdx).filter(m => m.role === "user").map(m => m.content.trim()).filter(Boolean);
        if (userMsgs.length > 0) {
            conversationQAs.push({ title, ua: userMsgs.join("\n") });
        }
    }
    
    console.log("Extracted QA titles:");
    conversationQAs.forEach((qa, i) => {
        console.log(`  [${i}] ${qa.title.slice(0, 80)}`);
    });

    const STOP_WORDS = new Set(["what", "where", "when", "which", "your", "this", "that", "with", "from", "have", "been", "will", "would", "could", "should", "about", "they", "their", "them", "does", "were", "being", "into", "some", "other", "over", "such", "only", "very", "just", "then", "here", "also", "each", "more", "than", "like", "make", "know", "take"]);
    function extractKeywords(text) {
        return [...new Set(text.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(w => w.length > 3 && !STOP_WORDS.has(w)))];
    }
    
    const usedSqIndices = new Set();
    const matchResults = [];
    for (const qa of conversationQAs) {
        const cKw = extractKeywords(qa.title + " " + (qa.ua || ""));
        let bestIdx = -1, bestScore = 0, bestRatio = 0;
        
        for (let i = 0; i < session.sessionQuestions.length; i++) {
            if (usedSqIndices.has(i)) continue;
            const sq = session.sessionQuestions[i];
            
            let sqText = "";
            if (sq.questionFundamentalId) {
                const doc = await CSFundamentalQuestion.findById(sq.questionFundamentalId);
                if (doc) sqText = doc.question;
            }
            if (!sqText) continue;
            
            const sqKw = extractKeywords(sqText);
            const overlap = cKw.filter(kw => sqKw.includes(kw)).length;
            if (overlap === 0) continue;
            const forwardRatio = overlap / Math.max(1, sqKw.length);
            
            if (overlap > bestScore || (overlap === bestScore && forwardRatio > bestRatio)) {
                bestScore = overlap; bestRatio = forwardRatio; bestIdx = i;
            }
        }
        
        let finalMatch = -1;
        if (bestScore >= 2 || (bestScore >= 1 && bestRatio >= 0.2)) finalMatch = bestIdx;
        
        matchResults.push({ title: qa.title, bestScore, finalMatch });
        if (finalMatch >= 0) usedSqIndices.add(finalMatch);
    }
    
    console.log("\nMatch Results:");
    let finalOutput = [];
    for (let i = 0; i < matchResults.length; i++) {
        const mr = matchResults[i];
        let sampleAnswer = null;
        if (mr.finalMatch >= 0) {
            const sq = session.sessionQuestions[mr.finalMatch];
            if (sq.questionFundamentalId) {
                const doc = await CSFundamentalQuestion.findById(sq.questionFundamentalId);
                sampleAnswer = doc?.answer;
            }
        }
        finalOutput.push({
           index: i,
           title: mr.title,
           score: mr.bestScore,
           matchIdx: mr.finalMatch,
           hasAnswer: !!sampleAnswer,
           sampleAnswerStart: sampleAnswer ? sampleAnswer.substring(0, 50) : null
        });
    }
    
    console.log(JSON.stringify(finalOutput, null, 2));
    
    process.exit(0);
}

run().catch(console.error);
