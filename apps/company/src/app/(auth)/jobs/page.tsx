import { CompanyPageAccess } from "@/components/auth/company-page-access";
import { JobOpeningBuilder } from "@/components/jobs/job-opening-builder";

export default function JobsPage() {
    return (
        <CompanyPageAccess
            blockedRoles={["viewer"]}
            description="Viewer accounts cannot open Jobs. Ask a company owner or admin to change your team role if you need hiring access."
            icon="work"
            title="Jobs"
        >
            <JobOpeningBuilder />
        </CompanyPageAccess>
    );
}
