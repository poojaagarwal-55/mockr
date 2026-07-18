// ============================================
// Mongoose Model: System Design Questions
// ============================================
// Stores system design interview questions with
// rubricLite (used during interview) and rubricFull
// (used at evaluation/report time).
//
// This is a MongoDB collection, separate from the
// PostgreSQL question bank used for DSA/SQL questions.

import { mongoose } from "../lib/mongodb.js";

const SystemDesignQuestionSchema = new mongoose.Schema({
    slug: {
        type: String,
        required: true,
        unique: true,
        lowercase: true,
        trim: true,
    },
    title: {
        type: String,
        required: true,
        trim: true,
    },
    difficulty: {
        type: String,
        required: true,
        enum: ["Easy", "Medium", "Hard"],
    },
    problemStatement: {
        type: String,
        required: true,
    },
    rubricLite: {
        type: mongoose.Schema.Types.Mixed,
        required: true,
        // Shape: {
        //   requiredComponents: string[],
        //   keyTradeoffs: string[],
        //   antiPatterns: string[],
        //   followUpTriggers: [{ condition: string, question: string }]
        // }
    },
    rubricFull: {
        type: mongoose.Schema.Types.Mixed,
        required: true,
        // Shape: {
        //   sampleAnswer: string,
        //   scoringDimensions: [{ name: string, weight: number, criteria: string }]
        // }
    },
    hints: {
        type: [String],
        default: [],
    },
    followUpQuestions: {
        type: [String],
        default: [],
    },
    architectureDiagram: {
        type: mongoose.Schema.Types.Mixed,
        default: null,
        // Shape: {
        //   nodes: [{ id: string, label: string, type: 'client'|'service'|'cache'|'db'|'queue'|... }],
        //   edges: [{ from: string, to: string, label?: string }],
        //   notes: string[]
        // }
    },
    sampleDiagramUrl: {
        type: String,
        default: null,
        // Public R2 CDN URL for the reference architecture diagram image
        // e.g. https://pub-xxx.r2.dev/system-design/diagrams/design-url-shortener.webp
    },
}, {
    timestamps: true,
    collection: "system_design_questions",
});

export const SystemDesignQuestion = mongoose.model(
    "SystemDesignQuestion",
    SystemDesignQuestionSchema
);
