"use client";

import ReportTypeView from "@/components/report-type-view";

export default function AIReportTypePage() {
    return (
        <ReportTypeView
            backUrl="/interviews/ai/reports"
            reportsEndpoint="/users/me/reports"
            getReportHref={(report) => `/reports/${report.sessionId}`}
            deleteReportEndpoint={(reportId) => `/users/me/reports/${reportId}`}
        />
    );
}
