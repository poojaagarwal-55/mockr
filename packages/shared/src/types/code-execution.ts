// ============================================
// Code Execution Types (Judge0 Integration)
// ============================================

export type ExecutionStatus =
    | 'AC'    // Accepted — all tests passed
    | 'WA'    // Wrong Answer
    | 'TLE'   // Time Limit Exceeded
    | 'MLE'   // Memory Limit Exceeded
    | 'RE'    // Runtime Error
    | 'CE';   // Compilation Error

export interface CodeExecutionRequest {
    sessionId: string;
    questionId: string;
    language: string;         // "python", "java", etc.
    code: string;
    runHiddenTests: boolean;  // true only on final submit
}

export interface CodeExecutionResult {
    status: ExecutionStatus;
    stdout: string;
    stderr: string;
    compileOutput: string | null;
    runtimeMs: number;
    memoryKb: number;
    testResults: TestResult[];
}

export interface TestResult {
    testCaseId: string;
    input: string;
    expected: string;
    actual: string;
    passed: boolean;
    runtimeMs: number;
    type: 'sample' | 'hidden' | 'edge';
}

export interface CodeSnapshot {
    sessionId: string;
    questionId: string;
    language: string;
    code: string;
    cursorLine: number | null;
    timestamp: string;
}
