export type CompanyRoundType = "ai_interview" | "mock_oa" | "technical_assignment" | "final_interview";

export function asCompanyRoundType(value?: string | null): CompanyRoundType | null {
    return value === "ai_interview" || value === "mock_oa" || value === "technical_assignment" || value === "final_interview"
        ? value
        : null;
}

export function companyRoundMonitorPath(value?: string | null) {
    const type = asCompanyRoundType(value);
    if (type === "final_interview") return "/direct-interviews";
    if (type === "technical_assignment") return "/assessments";
    if (type === "ai_interview") return "/interviews";
    if (type === "mock_oa") return "/oa";
    return null;
}
