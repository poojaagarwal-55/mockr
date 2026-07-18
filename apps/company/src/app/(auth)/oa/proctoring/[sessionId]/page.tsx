import { CompanyPageAccess } from "@/components/auth/company-page-access";
import { OnlineAssessmentProctoringReview } from "@/components/online-assessments/proctoring-review";

export default async function OnlineAssessmentProctoringPage({
    params,
}: {
    params: Promise<{ sessionId: string }>;
}) {
    const { sessionId } = await params;

    return (
        <CompanyPageAccess
            blockedRoles={["viewer"]}
            description="Viewer accounts cannot open secure OA proctoring reports. Ask a company owner or admin to change your team role if you need access."
            icon="shield"
            title="Secure OA report"
        >
            <OnlineAssessmentProctoringReview sessionId={sessionId} />
        </CompanyPageAccess>
    );
}
