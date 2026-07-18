// ============================================
// Admin access control
// ============================================
// Source of truth for admin emails:
//   1. ADMIN_EMAILS env var (comma-separated), trimmed & lowercased
// The verified email on request.user (issued by Supabase JWT) is the
// ONLY value ever compared — never trust client-provided email.
// ============================================

let cachedAdmins: Set<string> | null = null;

export function getAdminEmails(): Set<string> {
    if (cachedAdmins) return cachedAdmins;
    const raw = process.env.ADMIN_EMAILS ?? "";
    const list = raw
        .split(",")
        .map((s) => s.trim().toLowerCase())
        .filter(s => s && s !== "undefined" && s !== "null" && s !== '""' && s !== "''");
        
    const set = new Set<string>(list);
    
    cachedAdmins = set;
    return set;
}

export function isAdminEmail(email: string | null | undefined): boolean {
    if (!email) return false;
    return getAdminEmails().has(email.toLowerCase());
}
