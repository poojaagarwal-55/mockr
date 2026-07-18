"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { ThemeSync } from "@/components/theme/theme-sync";
import { CompanySidebar } from "@/components/layout/company-sidebar";
import { CompanyTopHeader } from "@/components/layout/company-top-header";
import { useCompanyAuth } from "@/context/company-auth-context";
import { SidebarProvider } from "@/context/sidebar-context";

export default function CompanyAuthenticatedLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    const { session, loading } = useCompanyAuth();
    const router = useRouter();

    useEffect(() => {
        if (!loading && !session) {
            router.replace("/login");
        }
    }, [session, loading, router]);

    if (loading) {
        return (
            <div className="flex h-screen w-full items-center justify-center bg-[#FAFBFC] dark:bg-lc-bg">
                <div className="h-10 w-10 animate-spin rounded-full border-4 border-primary border-t-transparent" />
            </div>
        );
    }

    if (!session) return null;

    return (
        <SidebarProvider>
            <ThemeSync />
            <div className="flex h-screen flex-col overflow-hidden bg-[#FAFBFC] dark:bg-lc-bg">
                <CompanyTopHeader />
                <div className="flex flex-1 overflow-hidden">
                    <CompanySidebar />
                    <div className="relative flex flex-1 flex-col overflow-x-hidden overflow-y-auto">{children}</div>
                </div>
            </div>
        </SidebarProvider>
    );
}
