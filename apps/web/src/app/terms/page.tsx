import { LegalDocument } from "@/components/legal/legal-document";
import { TERMS_TEXT } from "@/lib/legal-static-content";
import { parseLegalSection } from "@/lib/legal-content";

function hasAlphabet(text: string): boolean {
    return /[A-Za-z]/.test(text);
}

function toNormalCase(text: string): string {
    if (!hasAlphabet(text)) {
        return text;
    }

    const lower = text.toLowerCase();
    return lower.charAt(0).toUpperCase() + lower.slice(1);
}

function normalizeTermsContent(lines: string[]): string[] {
    let activeSection: "none" | "disclaimers" | "liability" = "none";

    return lines.map((line) => {
        const trimmed = line.trim();

        if (/^15\.\s+Disclaimers$/i.test(trimmed)) {
            activeSection = "disclaimers";
            return line;
        }

        if (/^16\.\s+Limitation of Liability$/i.test(trimmed)) {
            activeSection = "liability";
            return line;
        }

        if (/^17\.\s+/.test(trimmed)) {
            activeSection = "none";
            return line;
        }

        const shouldNormalize =
            (activeSection === "disclaimers" || activeSection === "liability") &&
            hasAlphabet(trimmed) &&
            trimmed === trimmed.toUpperCase();

        return shouldNormalize ? toNormalCase(line) : line;
    });
}

export default function TermsPage() {
    const parsed = parseLegalSection(TERMS_TEXT);
    const normalizedLines = normalizeTermsContent(parsed.contentLines);

    return (
        <LegalDocument
            title={parsed.title}
            subtitle={parsed.subtitle}
            effectiveLine="Last Updated: 15 April 2026"
            contentLines={normalizedLines}
        />
    );
}
