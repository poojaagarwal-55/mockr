import type { Metadata } from "next";
import "./globals.css";
import { AuthProvider } from "@/context/auth-context";
import { ThemeProvider } from "@/components/theme-provider";
import { ThemeSync } from "@/components/theme-sync";
import { QueryProvider } from "@/components/query-provider";
import { JsonLd } from "@/components/json-ld";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";

export const metadata: Metadata = {
  metadataBase: new URL("https://www.practers.com"),
  title: {
    default: "Mockr | Practice smarter, Interview better",
    template: "%s | Mockr",
  },
  description:
    "Practice with an AI that understands code architecture, system design, and soft skills. Tailored for FAANG+ standards.",
  icons: {
    icon: "/favicon.png",
    apple: "/favicon.png",
  },
};

const siteJsonLd = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      "@id": "https://www.practers.com/#organization",
      name: "Mockr",
      url: "https://www.practers.com",
      logo: "https://www.practers.com/logo_small.png",
      description:
        "Mockr is an interview preparation platform for AI mock interviews, coding practice, system design, peer practice, expert interviews, question banks, and resume building.",
    },
    {
      "@type": "WebSite",
      "@id": "https://www.practers.com/#website",
      name: "Mockr",
      url: "https://www.practers.com",
      publisher: {
        "@id": "https://www.practers.com/#organization",
      },
    },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning data-scroll-behavior="smooth">
      <head>
        {/* Blocking script: read localStorage before first paint to prevent dark-mode flash */}
        <script dangerouslySetInnerHTML={{ __html: `(function(){try{var legacy=localStorage.getItem('practers-dark');var theme=localStorage.getItem('theme');var dark=legacy==='true'||theme==='dark';var light=legacy==='false'||theme==='light';if(dark&&!light){document.documentElement.classList.add('dark');document.documentElement.dataset.dark='true';localStorage.setItem('theme','dark');localStorage.setItem('practers-dark','true');}else if(light){document.documentElement.classList.remove('dark');document.documentElement.dataset.dark='';localStorage.setItem('theme','light');localStorage.setItem('practers-dark','false');}}catch(e){}})();` }} />
        <JsonLd data={siteJsonLd} />
        <script
          src="https://analytics.ahrefs.com/analytics.js"
          data-key="8WNRO8MD7V3vXFyWOsYz4g"
          async
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&family=Playfair+Display:ital,wght@0,400;0,500;0,600;0,700;1,400;1,500&family=Syne:wght@400;700;800&family=Outfit:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;700&family=Nunito:wght@700;800;900&display=swap"
          rel="stylesheet"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="antialiased dark:bg-lc-bg dark:text-[#eff1f6] overflow-x-hidden">
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange={false}
          storageKey="theme"
        >
          <ThemeSync />
          <QueryProvider>
            <AuthProvider>{children}</AuthProvider>
          </QueryProvider>
        </ThemeProvider>
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
