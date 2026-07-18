import type { Metadata } from "next";

export const metadata: Metadata = {
    title: "Terms of Service",
    description:
        "Read the Mockr terms of service for using mock interviews, AI practice, peer and expert interviews, question banks, reports, resume tools, and interview prep features.",
    alternates: {
        canonical: "/terms",
    },
};

export default function Layout({ children }: { children: React.ReactNode }) {
    return <>{children}</>;
}
