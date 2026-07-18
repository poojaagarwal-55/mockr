"use client";

import { CompanyStandaloneQuestionIdePage } from "@/components/question-bank/company-standalone-question-ide-page";

export default function DSAQuestionPreviewPage() {
    return (
        <CompanyStandaloneQuestionIdePage
            routeType="dsa"
            type="dsa"
            backHref="/question-bank/dsa"
        />
    );
}
