"use client";

import ReportsListPage from "@/components/reports-list-page";
import { AIInterviewTabs } from "../ai-interview-tabs";

export default function AIReportsPage() {
    return (
        <ReportsListPage
            documentTitle="AI Interview Reports | Mockr"
            headerTitleNode={<AIInterviewTabs active="reports" />}
            backUrl="/interviews"
            reportsEndpoint="/users/me/reports"
            getTypeHref={(type) => `/interviews/ai/reports/type/${encodeURIComponent(type)}`}
            getReportHref={(report) => `/reports/${report.sessionId}`}
        />
    );
}
