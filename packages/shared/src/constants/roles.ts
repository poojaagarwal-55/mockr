// ============================================
// Role & Level Constants
// ============================================

import type { Role, Level } from '../types/user.js';

export const ROLES: { value: Role; label: string; description: string }[] = [
    { value: 'backend', label: 'Backend SDE', description: 'APIs, databases, server-side logic' },
    { value: 'frontend', label: 'Frontend SDE', description: 'UI/UX, React, browser performance' },
    { value: 'fullstack', label: 'Full Stack SDE', description: 'End-to-end product development' },
    { value: 'mle', label: 'ML/AI Engineer', description: 'Machine learning, data pipelines' },
    { value: 'devops', label: 'DevOps/SRE', description: 'Infrastructure, CI/CD, reliability' },
    { value: 'genai', label: 'GenAI Engineer', description: 'LLMs, RAG, agents, AI product development' },
    { value: 'datascience', label: 'Data Scientist', description: 'Analytics, statistical modeling, data insights' },
];

export const LEVELS: { value: Level; label: string; yearsRange: string }[] = [
    { value: 'SDE1', label: 'SDE 1 (Junior)', yearsRange: '0-2 years' },
    { value: 'SDE2', label: 'SDE 2 (Mid-Level)', yearsRange: '2-5 years' },
    { value: 'SDE3', label: 'SDE 3 (Senior)', yearsRange: '5-10 years' },
    { value: 'Staff', label: 'Staff Engineer', yearsRange: '10+ years' },
];

export const ROLE_VALUES = ROLES.map(r => r.value);
export const LEVEL_VALUES = LEVELS.map(l => l.value);
