// ============================================
// Question Bank Types
// ============================================

export type QuestionCategory =
    | 'DSA'
    | 'SQL'
    | 'SystemDesign'
    | 'OS'
    | 'OOP'
    | 'Networking'
    | 'Behavioral';

export type Difficulty = 'Easy' | 'Medium' | 'Hard';

export interface Question {
    id: string;
    slug: string;
    title: string;
    category: QuestionCategory;
    subcategory: string | null;
    difficulty: Difficulty;
    problemMd: string;              // full problem in Markdown
    constraints: string | null;     // "1 <= n <= 10^5"
    examples: QuestionExample[];
    hints: string[];
    followUpQuestions: string[];    // AI cross-questions
    tags: string[];                 // ["hashmap", "sliding-window"]
    companies: string[];            // ["Google", "Amazon"]
    targetRoles: string[];          // ["backend", "fullstack"]
    targetLevels: string[];         // ["SDE1", "SDE2"]
    isActive: boolean;
}

export interface QuestionExample {
    input: string;
    output: string;
    explanation?: string;
}

export interface QuestionStarter {
    id: string;
    questionId: string;
    language: string;               // "python", "java", "cpp"
    starter: string;                // boilerplate code shown in IDE
    // solution is NEVER sent to client — backend only
}

export interface TestCase {
    id: string;
    questionId: string;
    input: string;
    expected: string;
    type: 'sample' | 'hidden' | 'edge';  // explicit categorization
    orderIdx: number;
}

export interface QuestionWithStarters extends Question {
    starterCode: Record<string, string>;  // { python: "...", java: "..." }
    visibleTestCases: TestCase[];
}

export interface QuestionAnalytics {
    questionId: string;
    timesAsked: number;
    timesSolved: number;
    avgTimeSecs: number | null;
    avgScore: number | null;
    passRate: number | null;
}

export interface QuestionSelectionCriteria {
    category: QuestionCategory;
    difficulty?: Difficulty[];
    targetRole: string;
    targetLevel: string;
    excludeIds: string[];           // already asked in this session
    limit?: number;
}
