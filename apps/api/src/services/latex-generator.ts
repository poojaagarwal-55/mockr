import Handlebars from 'handlebars';

export interface ResumeData {
    personalInfo: {
        name: string;
        phone: string;
        email: string;
        linkedin: string;
        github: string;
        portfolio: string;
        summary: string;
    };
    education: {
        institution: string;
        location: string;
        degree: string;
        duration: string;
        gpa: string;
    }[];
    experience: {
        company: string;
        location: string;
        role: string;
        duration: string;
        bullets: string[];
    }[];
    projects: {
        name: string;
        technologies: string;
        role: string;
        duration: string;
        bullets: string[];
    }[];
    skills: {
        category: string;
        items: string;
    }[];
}

/**
 * Escapes characters that have special meaning in LaTeX.
 */
function escapeLatex(str: string): string {
    if (!str) return '';
    return str
        .replace(/\\/g, '\\textbackslash') // MUST BE FIRST!
        .replace(/&/g, '\\&')
        .replace(/%/g, '\\%')
        .replace(/\$/g, '\\$')
        .replace(/#/g, '\\#')
        .replace(/_/g, '\\_')
        .replace(/\{/g, '\\{')
        .replace(/\}/g, '\\}')
        .replace(/~/g, '\\textasciitilde{}')
        .replace(/\^/g, '\\textasciicircum{}');
}

/**
 * Recursively escapes all string values in an object.
 */
function escapeObject(obj: any): any {
    if (obj === null || obj === undefined) return obj;
    if (typeof obj === 'string') return escapeLatex(obj);
    if (Array.isArray(obj)) return obj.map(escapeObject);
    if (typeof obj === 'object') {
        const escaped: any = {};
        for (const key in obj) {
            escaped[key] = escapeObject(obj[key]);
        }
        return escaped;
    }
    return obj;
}

/**
 * Injects form data into a LaTeX template using Handlebars.
 */
export function populateTemplate(templateSource: string, formData: ResumeData): string {
    // Escape all content before injecting
    const escapedData = escapeObject(formData);
    
    // We use Handlebars with triple curly braces {{{var}}} in the templates 
    // to prevent Handlebars from HTML-escaping our already LaTeX-escaped strings.
    const template = Handlebars.compile(templateSource, { noEscape: true });
    
    return template(escapedData);
}
