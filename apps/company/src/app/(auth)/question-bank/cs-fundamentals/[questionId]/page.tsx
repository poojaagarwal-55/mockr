"use client";

import { CompanyStandaloneQuestionIdePage } from "@/components/question-bank/company-standalone-question-ide-page";

export default function CSFundamentalsQuestionPreviewPage() {
    return (
        <CompanyStandaloneQuestionIdePage
            routeType="cs-fundamentals"
            type="cs_fundamentals"
            backHref="/question-bank/cs-fundamentals"
        />
    );
}
