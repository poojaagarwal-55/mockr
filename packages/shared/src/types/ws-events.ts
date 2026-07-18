// ============================================
// WebSocket Event Types
// ============================================
// All real-time communication between client ↔ server
// uses these typed events over Socket.io

import type { InterviewStage, InterviewType } from './interview.js';
import type { QuestionWithStarters } from './question.js';
import type { CodeExecutionResult } from './code-execution.js';
import type { EvaluationReport } from './evaluation.js';

// ---- Server → Client Events ----

export interface ServerToClientEvents {
    /** Single token streamed from AI response */
    'ai:token': (payload: { token: string; messageId: string }) => void;

    /** AI finished generating full response */
    'ai:done': (payload: { messageId: string; fullContent: string }) => void;

    /** Interview stage has changed */
    'stage:change': (payload: { stage: InterviewStage; reason: string }) => void;

    /** A question has been assigned to the candidate */
    'question:assign': (payload: { question: QuestionWithStarters }) => void;

    /** Code execution results are ready */
    'code:result': (payload: CodeExecutionResult) => void;

    /** AI is requesting the user's code for review */
    'code:request-snapshot': () => void;

    /** AI generated a hint */
    'hint:show': (payload: { hint: string; hintNumber: number; totalHints: number }) => void;

    /** Interview has ended, report is being generated */
    'session:ending': (payload: { message: string }) => void;

    /** Report is ready */
    'session:report-ready': (payload: { reportId: string; report: EvaluationReport }) => void;

    /** Error occurred */
    'error': (payload: { code?: string; message: string }) => void;

    // ── Voice Mode Events ──────────────────────────────────

    /** Gemini Live connection is ready (setupComplete received) */
    'voice:ready': () => void;

    /** AI audio chunk (base64-encoded PCM 24kHz) for playback */
    'voice:audio': (payload: { data: string }) => void;

    /** AI finished speaking a turn */
    'voice:turn-complete': () => void;

    /** Server-side transcription of AI speech */
    'voice:ai-transcript': (payload: { text: string }) => void;

    /** Server-side transcription of candidate speech */
    'voice:user-transcript': (payload: { text: string }) => void;

    /** Interim (live) transcription of candidate speech for real-time feedback */
    'voice:interim-transcript': (payload: { text: string; confidence: number }) => void;

    /** AI generation was interrupted by user speaking (barge-in) */
    'voice:interrupted': () => void;

    /** Voice session ended */
    'voice:ended': (payload: { reason: string }) => void;
}

// ---- Client → Server Events ----

export interface ClientToServerEvents {
    /** User sends a chat message */
    'chat:message': (payload: { content: string }) => void;

    /** User sends a code snapshot (auto every 30s or manual) */
    'code:snapshot': (payload: {
        code: string;
        language: string;
        cursorLine: number | null;
    }) => void;

    /** User requests code execution */
    'code:run': (payload: {
        code: string;
        language: string;
        questionId: string;
    }) => void;

    /** User submits final code for a question */
    'code:submit': (payload: {
        code: string;
        language: string;
        questionId: string;
    }) => void;

    /** User requests a hint */
    'hint:request': () => void;

    /** User requests to skip to next phase */
    'stage:skip': () => void;

    /** User ends the interview early */
    'session:end': () => void;

    // ── Voice Mode Events ──────────────────────────────────

    /** Start a voice session (opens Gemini Live connection on server) */
    'voice:start': () => void;

    /** Candidate audio chunk (base64-encoded PCM 16kHz) */
    'voice:audio': (payload: { data: string; mimeType: string }) => void;

    /** Send a text message through the voice session */
    'voice:text': (payload: { text: string }) => void;

    /** Update mute state */
    'voice:mute': (payload: { muted: boolean }) => void;

    /** Stop the voice session */
    'voice:stop': () => void;
}

