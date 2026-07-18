// ============================================
// Built-in LaTeX Resume Templates
// ============================================

import type { LatexTemplate } from "@interviewforge/shared";
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// @ts-ignore
const currentDir = typeof __dirname !== 'undefined' ? __dirname : fileURLToPath(new URL(".", (import.meta as any).url));

const loadTemplate = (filename: string) => {
    try {
        return fs.readFileSync(path.join(currentDir, 'templates_tmp', filename), 'utf-8');
    } catch (e) {
        console.error(`Failed to load template ${filename}`, e);
        return "";
    }
};

export const LATEX_TEMPLATES: LatexTemplate[] = [
    {
        slug: "classic",
        name: "The Classic",
        description: "A clean and timeless single-column resume format",
        source: loadTemplate("classic.tex"),
    },
    {
        slug: "two-column",
        name: "Two Column Pro",
        description: "A modern two-column layout highlighting your skills",
        source: loadTemplate("two_column.tex"),
    },
    {
        slug: "minimalist",
        name: "Clean Minimalist",
        description: "Minimalist and systems-focused design",
        source: loadTemplate("minimalist.tex"),
    },
    {
        slug: "executive",
        name: "Executive Split",
        description: "Professional split layout for executive roles",
        source: loadTemplate("executive.tex"),
    },
];

export function getTemplateBySlug(slug: string): LatexTemplate | undefined {
    return LATEX_TEMPLATES.find((t) => t.slug === slug);
}
