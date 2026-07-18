import { CompanyPageAccess } from "@/components/auth/company-page-access";
import { TechnicalAssignmentDashboard } from "@/components/assessments/technical-assignment-dashboard";

export default function AssessmentsPage() {
    return (
        <CompanyPageAccess
            blockedRoles={["viewer"]}
            description="Viewer accounts cannot open Assessments. Ask a company owner or admin to change your team role if you need assignment access."
            icon="assignment_turned_in"
            title="Assessments"
        >
            <TechnicalAssignmentDashboard />
        </CompanyPageAccess>
    );
}
