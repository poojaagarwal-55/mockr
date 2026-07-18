import { CompanyPageAccess } from "@/components/auth/company-page-access";
import { DirectInterviewsWorkspace } from "@/components/direct-interviews/direct-interviews-workspace";

export default function DirectInterviewsPage() {
    return (
        <CompanyPageAccess
            blockedRoles={["viewer"]}
            description="Viewer accounts cannot open Direct Interviews. Ask a company owner or admin to change your team role if you need interview access."
            icon="record_voice_over"
            title="Direct Interviews"
        >
            <DirectInterviewsWorkspace />
        </CompanyPageAccess>
    );
}
