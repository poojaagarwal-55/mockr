export const USER_ROLE = {
    USER: "user",
    PLACEMENT_COORDINATOR: "placement_coordinator",
    CONTEST_CREATOR: "contest_creator",
} as const;

export function normalizePlacementEmailDomain(domain: string): string {
    const trimmed = domain.trim().toLowerCase();
    return trimmed.startsWith("@") ? trimmed : `@${trimmed}`;
}

export function isValidPlacementEmailDomain(domain: string): boolean {
    return /^@[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/.test(domain);
}
