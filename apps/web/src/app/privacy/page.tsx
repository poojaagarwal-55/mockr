import { LegalDocument } from "@/components/legal/legal-document";
import { parseLegalSection } from "@/lib/legal-content";
import { PRIVACY_TEXT } from "@/lib/legal-static-content";

export default function PrivacyPage() {
    const parsed = parseLegalSection(PRIVACY_TEXT);

    return (
        <LegalDocument
            title={parsed.title}
            subtitle={parsed.subtitle}
            effectiveLine="Last Updated: 15 April 2026"
            contentLines={parsed.contentLines}
        />
    );
}
