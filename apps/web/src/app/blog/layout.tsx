import type { Metadata } from "next";

export const metadata: Metadata = {
    title: "Interview Prep Blog: Mock Interviews, DSA & System Design",
    description:
        "Read Mockr interview prep guides on mock interviews, AI practice, peer interviews, expert feedback, coding interviews, DSA, CS fundamentals, system design, and resumes.",
    alternates: {
        canonical: "/blog",
    },
    openGraph: {
        title: "Mockr Blog: Interview Prep, DSA & System Design",
        description:
            "Actionable interview preparation guides for candidates practicing technical interviews with AI feedback, peer practice, expert review, and reports.",
        url: "https://www.practers.com/blog",
        siteName: "Mockr",
        type: "website",
    },
};

export default function Layout({ children }: { children: React.ReactNode }) {
    return <>{children}</>;
}
