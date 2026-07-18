// ============================================
// LaTeX Resume Types
// ============================================

export interface LatexResumeDoc {
    id: string;
    userId: string;
    title: string;
    latexSource: string;
    template: string;
    compiledUrl: string | null;
    compiledAt: string | null;
    createdAt: string;
    updatedAt: string;
}

export interface LatexResumeListItem {
    id: string;
    title: string;
    template: string;
    compiledUrl: string | null;
    compiledAt: string | null;
    createdAt: string;
    updatedAt: string;
}

export interface LatexCompileResult {
    success: boolean;
    pdfUrl?: string;
    errors?: LatexError[];
    warnings?: string[];
}

export interface LatexError {
    line: number;
    message: string;
    severity: 'error' | 'warning';
}

export interface LatexAiSuggestion {
    id: string;
    type: 'rewrite' | 'fix' | 'suggestion';
    description: string;
    originalText?: string;
    replacement: string;
}

export interface LatexAiChatMessage {
    role: 'user' | 'assistant';
    content: string;
    suggestions?: LatexAiSuggestion[];
    timestamp: string;
}

export interface LatexTemplate {
    slug: string;
    name: string;
    description: string;
    source: string;
}
