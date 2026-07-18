// ============================================
// User Types
// ============================================

export interface User {
    id: string;
    email: string;
    username?: string | null;
    mobile?: string | null;
    mobileVerified?: boolean;
    mobileVerifiedAt?: string | null;
    country?: string | null;
    fullName: string;
    avatarUrl?: string | null;
    createdAt: string;
    updatedAt: string;
}

export interface UserProfile extends User {
    totalInterviews: number;
    averageScore: number;
}

export type Role = 'backend' | 'frontend' | 'fullstack' | 'mle' | 'devops' | 'genai' | 'datascience';
export type Level = 'SDE1' | 'SDE2' | 'SDE3' | 'Staff';
export type SupportedLanguage = 'python' | 'javascript' | 'typescript' | 'java' | 'cpp' | 'go';
