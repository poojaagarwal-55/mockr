import { CompanyPageAccess } from "@/components/auth/company-page-access";
import { OnlineAssessmentsWorkspace } from "@/components/online-assessments/online-assessments-workspace";

export default function OnlineAssessmentsPage() {
    return (
        <CompanyPageAccess
            blockedRoles={["viewer"]}
            description="Viewer accounts cannot open Online Assessments. Ask a company owner or admin to change your team role if you need OA access."
            icon="quiz"
            title="Online Assessments"
        >
            <OnlineAssessmentsWorkspace />
        </CompanyPageAccess>
    );
}
