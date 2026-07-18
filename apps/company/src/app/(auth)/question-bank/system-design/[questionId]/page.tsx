"use client";

import { CompanyStandaloneQuestionIdePage } from "@/components/question-bank/company-standalone-question-ide-page";

export default function SystemDesignQuestionPreviewPage() {
    return (
        <CompanyStandaloneQuestionIdePage
            routeType="system-design"
            type="system_design"
            backHref="/question-bank/system-design"
        />
    );
}
