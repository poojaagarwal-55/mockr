import type { Metadata } from "next";

export const metadata: Metadata = {
    title: "Privacy Policy",
    description:
        "Read the Mockr privacy policy to understand how account, interview practice, resume, and product usage data are handled.",
    alternates: {
        canonical: "/privacy",
    },
};

export default function Layout({ children }: { children: React.ReactNode }) {
    return <>{children}</>;
}
