// ============================================
// Resume Analysis Types
// ============================================

export interface ResumeUpload {
    id: string;
    userId: string;
    fileName: string;
    fileUrl: string;          // S3/R2 URL
    rawText: string | null;   // extracted via pdf-parse
    analysis: ResumeAnalysis | null;
    uploadedAt: string;
}

export interface ResumeAnalysis {
    summary: ResumeSummary;
    suggestedQuestions: string[];
    overallStrength: 'weak' | 'moderate' | 'strong';
}

export interface ResumeSummary {
    name: string;
    totalYearsExperience: number | null;
    currentRole: string | null;
    currentCompany: string | null;
    education: EducationEntry[];
    skills: SkillGroup[];
    experience: ExperienceEntry[];
    projects: ProjectEntry[];
    redFlags: string[];
    strengths: string[];
}

export interface EducationEntry {
    institution: string;
    degree: string;
    field: string;
    year: number | null;
}

export interface SkillGroup {
    category: string;       // "Languages", "Frameworks", "Databases"
    skills: string[];
}

export interface ExperienceEntry {
    company: string;
    role: string;
    duration: string;
    highlights: string[];
}

export interface ProjectEntry {
    name: string;
    description: string;
    techStack: string[];
}
