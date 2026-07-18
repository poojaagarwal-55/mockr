// ============================================
// Supported Programming Languages
// ============================================

import type { SupportedLanguage } from '../types/user.js';

export interface LanguageConfig {
    value: SupportedLanguage;
    label: string;
    monacoId: string;       // Monaco Editor language ID
    judge0Id: number;        // Judge0 language ID
    extension: string;
    defaultTemplate: string;
}

export const LANGUAGES: LanguageConfig[] = [
    {
        value: 'python',
        label: 'Python 3',
        monacoId: 'python',
        judge0Id: 71,
        extension: '.py',
        defaultTemplate: '# Write your solution here\n\ndef solution():\n    pass\n',
    },
    {
        value: 'javascript',
        label: 'JavaScript',
        monacoId: 'javascript',
        judge0Id: 93,             // Node.js 18.15.0 on RapidAPI Judge0 CE
        extension: '.js',
        defaultTemplate: '// Write your solution here\n\nfunction solution() {\n  \n}\n',
    },
    {
        value: 'typescript',
        label: 'TypeScript',
        monacoId: 'typescript',
        judge0Id: 74,
        extension: '.ts',
        defaultTemplate: '// Write your solution here\n\nfunction solution(): void {\n  \n}\n',
    },
    {
        value: 'java',
        label: 'Java',
        monacoId: 'java',
        judge0Id: 62,
        extension: '.java',
        defaultTemplate: 'class Solution {\n    public static void main(String[] args) {\n        \n    }\n}\n',
    },
    {
        value: 'cpp',
        label: 'C++',
        monacoId: 'cpp',
        judge0Id: 54,
        extension: '.cpp',
        defaultTemplate: '#include <bits/stdc++.h>\nusing namespace std;\n\nint main() {\n    \n    return 0;\n}\n',
    },
    {
        value: 'go',
        label: 'Go',
        monacoId: 'go',
        judge0Id: 60,
        extension: '.go',
        defaultTemplate: 'package main\n\nimport "fmt"\n\nfunc main() {\n    fmt.Println("Hello")\n}\n',
    },
];

export const LANGUAGE_MAP = Object.fromEntries(
    LANGUAGES.map(l => [l.value, l])
) as Record<SupportedLanguage, LanguageConfig>;

export const SUPPORTED_LANGUAGE_VALUES = LANGUAGES.map(l => l.value);
