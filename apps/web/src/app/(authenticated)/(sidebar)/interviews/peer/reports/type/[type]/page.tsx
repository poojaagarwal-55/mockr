"use client";

import ReportTypeView from "@/components/report-type-view";

export default function PeerReportTypePage() {
    return (
        <ReportTypeView
            backUrl="/interviews/peer/reports"
            reportsEndpoint="/p2p/me/reports"
            getReportHref={(report) => `/interviews/peer/session/${report.sessionId}/report`}
            deleteReportEndpoint={null}
        />
    );
}
