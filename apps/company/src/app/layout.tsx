import type { Metadata } from "next";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { CompanyAuthProvider } from "@/context/company-auth-context";
import { ThemeProvider } from "@/components/theme/theme-provider";
import "./globals.css";

export const metadata: Metadata = {
    title: {
        default: "Practers for Companies",
        template: "%s | Practers for Companies",
    },
    description: "Company hiring workspace for Practers.",
    icons: {
        icon: "/favicon.png",
        apple: "/favicon.png",
    },
};

export default function RootLayout({
    children,
}: Readonly<{
    children: React.ReactNode;
}>) {
    return (
        <html lang="en" suppressHydrationWarning data-scroll-behavior="smooth">
            <head>
                <script
                    dangerouslySetInnerHTML={{
                        __html:
                            "(function(){try{if(localStorage.getItem('practers-dark')==='true'){document.documentElement.classList.add('dark');document.documentElement.dataset.dark='true';}}catch(e){}})();",
                    }}
                />
                <link
                    href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&family=Syne:wght@400;700;800&family=Outfit:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;700&family=Nunito:wght@700;800;900&display=swap"
                    rel="stylesheet"
                />
                <link
                    href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&display=swap"
                    rel="stylesheet"
                />
            </head>
            <body className="antialiased dark:bg-lc-bg dark:text-[#eff1f6]">
                <ThemeProvider
                    attribute="class"
                    defaultTheme="system"
                    enableSystem
                    disableTransitionOnChange={false}
                    storageKey="theme"
                >
                    <CompanyAuthProvider>{children}</CompanyAuthProvider>
                </ThemeProvider>
                <Analytics />
                <SpeedInsights />
            </body>
        </html>
    );
}
