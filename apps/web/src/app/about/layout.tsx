import type { Metadata } from "next";

export const metadata: Metadata = {
    title: "About Mockr: Interview Practice Platform",
    description:
        "Learn about Mockr, an interview practice platform for AI mock interviews, peer-to-peer practice, expert interviews, coding prep, system design, question banks, and feedback reports.",
    alternates: {
        canonical: "/about",
    },
    openGraph: {
        title: "About Mockr: Interview Practice Platform",
        description:
            "Mockr helps candidates prepare for technical interviews with AI practice, peer interviews, expert feedback, role-specific questions, and reports.",
        url: "https://www.practers.com/about",
        siteName: "Mockr",
        type: "website",
    },
};

export default function Layout({ children }: { children: React.ReactNode }) {
    return <>{children}</>;
}
