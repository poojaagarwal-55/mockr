"use client";

import { Suspense, useEffect } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/context/auth-context";
import { checkAndSendReminders, recordUserSignup } from "@/lib/notifications";
import { useCreditNotifications } from "@/hooks/use-credit-notifications";
import { ThemeSync } from "@/components/theme-sync";

export default function AuthenticatedLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    return (
        <Suspense fallback={null}>
            <AuthenticatedLayoutContent>{children}</AuthenticatedLayoutContent>
        </Suspense>
    );
}

function AuthenticatedLayoutContent({
    children,
}: {
    children: React.ReactNode;
}) {
    const { session, loading, error } = useAuth();
    const router = useRouter();
    const pathname = usePathname();
    const searchParams = useSearchParams();

    // Enable credit notifications for authenticated users
    useCreditNotifications();

    useEffect(() => {
        if (!loading && !session) {
            // Carry the session-expired message to the login page so it can
            // display it as a notice rather than leaving the user confused.
            const params = new URLSearchParams();
            const query = searchParams.toString();
            const next = `${pathname}${query ? `?${query}` : ""}`;
            if (error) params.set("reason", error);
            params.set("next", next);
            router.replace(`/login?${params.toString()}`);
        }
    }, [session, loading, error, pathname, router, searchParams]);


    // Initialize notification system when user is authenticated
    useEffect(() => {
        if (session && !loading) {
            // For brand-new users: record signup time and send welcome notification.
            // recordUserSignup is idempotent (no-op if called again later).
            // It also seeds REMINDER_CHECKED_KEY so reminders only run after 24 h.
            recordUserSignup();

            // Run reminder check on mount (no-op for new users in first 24 h)
            checkAndSendReminders();

            // Re-check every 24 hours
            const intervalId = setInterval(() => {
                checkAndSendReminders();
            }, 24 * 60 * 60 * 1000); // 24 hours

            return () => clearInterval(intervalId);
        }
    }, [session, loading]);

    // Show nothing (or a global loading spinner) while determining auth state
    if (loading) {
        return (
            <div className="h-screen w-full flex items-center justify-center bg-[#FAFBFC]">
                <div className="w-10 h-10 border-4 border-primary border-t-transparent rounded-full animate-spin" />
            </div>
        );
    }

    if (!session) {
        return null;
    }

    return (
        <>
            <ThemeSync />
            {children}
        </>
    );
}
