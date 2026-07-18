import type { Metadata } from "next";

export const metadata: Metadata = {
    title: "FAQ: Interview Practice, Mock Interviews & Reports",
    description:
        "Find answers about Mockr interview practice, AI mock interviews, peer and expert interviews, coding prep, question banks, reports, pricing, and account setup.",
    alternates: {
        canonical: "/faq",
    },
    openGraph: {
        title: "Mockr FAQ: Interview Practice, Mock Interviews & Reports",
        description:
            "Everything candidates need to know about practicing interviews on Mockr with AI, peer, and expert-led interview preparation.",
        url: "https://www.practers.com/faq",
        siteName: "Mockr",
        type: "website",
    },
};

export default function Layout({ children }: { children: React.ReactNode }) {
    return <>{children}</>;
}
