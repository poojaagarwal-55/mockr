export type ParsedLegalDocument = {
    title: string;
    subtitle: string;
    effectiveLine: string;
    contentLines: string[];
};

export function parseLegalSection(sectionText: string): ParsedLegalDocument {
    const lines = sectionText
        .split(/\r?\n/)
        .map((line) => line.replace(/\u2028/g, "").trimEnd());

    const compact = lines.filter((line) => line.trim().length > 0);

    const title = compact[0] || "";
    const subtitle = compact[1] || "";
    const effectiveLine = compact[2] || "";

    const contentStart = 3;
    const contentLines = compact.slice(contentStart);

    return { title, subtitle, effectiveLine, contentLines };
}
