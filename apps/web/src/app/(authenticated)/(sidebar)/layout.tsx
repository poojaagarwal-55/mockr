"use client";

import Sidebar from "@/components/sidebar";
import { TopHeader } from "@/components/top-header";
import { MobileBottomNav } from "@/components/mobile-bottom-nav";
import { SidebarProvider } from "@/context/sidebar-context";
import { GettingStartedModal } from "@/components/onboarding/GettingStartedModal";
import { useAuth } from "@/context/auth-context";
import { useState, useEffect } from "react";

export default function DashboardLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    const { user, session } = useAuth();
    const [showGettingStarted, setShowGettingStarted] = useState(false);
    const [hasChecked, setHasChecked] = useState(false);

    // Only show the pop up for new users immediately after the onboarding page.
    useEffect(() => {
        if (!user || !session || hasChecked) return;
        const hasSeenGettingStarted = localStorage.getItem(`practers-getting-started-completed-${user.id}`);

        // If the backend says onboarding isn't complete, and they haven't seen it in this browser
        if (!user.onboardingCompleted && !hasSeenGettingStarted) {
            setShowGettingStarted(true);
        }
        setHasChecked(true);
    }, [user, session, hasChecked]);

    const handleCloseGettingStarted = () => {
        setShowGettingStarted(false);
        if (user) {
            // Mark as completed in localStorage to prevent hallucinated popups on other pages
            localStorage.setItem(`practers-getting-started-completed-${user.id}`, 'true');
        }
    };

    return (
        <SidebarProvider>
            <div className="flex flex-col h-screen overflow-hidden bg-[#FAFBFC] dark:bg-lc-bg print:h-auto print:overflow-visible">
                <TopHeader />
                <div className="flex flex-1 overflow-hidden print:overflow-visible print:h-auto">
                    <Sidebar />
                    <div className="flex-1 flex flex-col overflow-x-hidden overflow-y-auto relative print:overflow-visible print:h-auto print:block pb-[60px] md:pb-0">{children}</div>
                </div>
                <MobileBottomNav />

                {/* Getting Started Modal - appears over everything for new users */}
                {showGettingStarted && (
                    <GettingStartedModal onClose={handleCloseGettingStarted} />
                )}
            </div>
        </SidebarProvider>
    );
}
