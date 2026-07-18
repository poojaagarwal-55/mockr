"use client";

import { useAuth } from "@/context/auth-context";
import { useAdminCheck } from "@/hooks/use-admin-check";

export function useContestManagerCheck() {
    const { user, loading: authLoading } = useAuth();
    const { isAdmin, loading: adminLoading, error } = useAdminCheck();
    const isContestCreator = user?.role === "contest_creator";

    return {
        isAdmin,
        isContestCreator,
        isContestManager: Boolean(isAdmin || isContestCreator),
        loading: authLoading || adminLoading,
        error,
    };
}
