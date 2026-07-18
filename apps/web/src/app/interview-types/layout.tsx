import type { Metadata } from "next";

export const metadata: Metadata = {
    title: "Interview Types: AI, Peer & Expert Mock Interviews",
    description:
        "Explore Mockr interview types including AI mock interviews, peer-to-peer practice, expert interviews, coding, system design, behavioural, PM, data science, and Gen AI.",
    alternates: {
        canonical: "/interview-types",
    },
    openGraph: {
        title: "Mockr Interview Types: AI, Peer & Expert Mock Interviews",
        description:
            "Practice the exact interview round you need with AI interviewers, peer practice, expert feedback, role-specific questions, and detailed reports.",
        url: "https://www.practers.com/interview-types",
        siteName: "Mockr",
        type: "website",
    },
};

export default function Layout({ children }: { children: React.ReactNode }) {
    return <>{children}</>;
}
