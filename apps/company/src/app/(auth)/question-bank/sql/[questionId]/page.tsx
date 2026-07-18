"use client";

import { CompanyStandaloneQuestionIdePage } from "@/components/question-bank/company-standalone-question-ide-page";

export default function SQLQuestionPreviewPage() {
    return (
        <CompanyStandaloneQuestionIdePage
            routeType="sql"
            type="sql"
            backHref="/question-bank/sql"
        />
    );
}
