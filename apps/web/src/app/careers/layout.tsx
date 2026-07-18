import type { Metadata } from "next";

export const metadata: Metadata = {
    title: "Careers at Mockr",
    description:
        "Join Mockr and help build interview practice tools for AI mock interviews, peer interviews, expert feedback, coding prep, system design practice, and candidate reports.",
    alternates: {
        canonical: "/careers",
    },
};

export default function Layout({ children }: { children: React.ReactNode }) {
    return <>{children}</>;
}
