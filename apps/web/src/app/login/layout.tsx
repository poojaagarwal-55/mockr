import type { Metadata } from "next";

export const metadata: Metadata = {
    title: "Log In",
    description: "Log in to Mockr to start mock interviews, practice coding and system design, review reports, and continue your interview preparation.",
};

export default function Layout({ children }: { children: React.ReactNode }) {
    return <>{children}</>;
}
