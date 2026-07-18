import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, BookOpen, Code2, Database, Network } from "lucide-react";
import { Footer } from "@/components/footer";
import { JsonLd } from "@/components/json-ld";
import { LandingNav } from "@/components/landing-nav";
import { questionCategories, type PublicQuestionCategory } from "@/lib/public-question-previews";

export const metadata: Metadata = {
  title: "Interview Questions for Coding, SQL, CS & System Design",
  description:
    "Preview coding, SQL, CS fundamentals, and system design interview questions, then log in to solve them in the Mockr IDE.",
  alternates: { canonical: "/interview-questions" },
  openGraph: {
    title: "Interview Questions for Coding, SQL, CS & System Design",
    description:
      "Preview coding, SQL, CS fundamentals, and system design interview questions, then solve them in the Mockr IDE.",
    url: "/interview-questions",
    siteName: "Mockr",
    images: [
      {
        url: "/logo_big.png",
        width: 1200,
        height: 630,
        alt: "Mockr interview questions",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Interview Questions for Coding, SQL, CS & System Design",
    description:
      "Preview coding, SQL, CS fundamentals, and system design interview questions, then solve them in the Mockr IDE.",
    images: ["/logo_big.png"],
  },
};

export default function InterviewQuestionsPage() {
  const categoryEntries: Array<{
    key: PublicQuestionCategory;
    icon: typeof Code2;
  }> = [
    { key: "coding", icon: Code2 },
    { key: "sql", icon: Database },
    { key: "system-design", icon: Network },
    { key: "cs-fundamentals", icon: BookOpen },
  ];

  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "CollectionPage",
        "@id": "https://www.practers.com/interview-questions#collection",
        name: "Mockr Interview Questions",
        url: "https://www.practers.com/interview-questions",
        description:
          "Preview coding, SQL, CS fundamentals, and system design interview questions before solving them in the Mockr IDE.",
        isPartOf: {
          "@id": "https://www.practers.com/#website",
        },
        hasPart: categoryEntries.map(({ key }) => ({
          "@type": "CollectionPage",
          name: questionCategories[key].label,
          url: `https://www.practers.com${questionCategories[key].href}`,
        })),
      },
      {
        "@type": "BreadcrumbList",
        "@id": "https://www.practers.com/interview-questions#breadcrumb",
        itemListElement: [
          {
            "@type": "ListItem",
            position: 1,
            name: "Home",
            item: "https://www.practers.com",
          },
          {
            "@type": "ListItem",
            position: 2,
            name: "Interview Questions",
            item: "https://www.practers.com/interview-questions",
          },
        ],
      },
    ],
  };

  return (
    <main className="min-h-screen bg-[#f6f9ff] text-[#111827] dark:bg-[#1a1a1a] dark:text-white">
      <JsonLd data={jsonLd} />
      <LandingNav />
      <section className="relative overflow-hidden px-6 py-14 md:py-18">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_18%_12%,rgba(74,124,255,0.24),transparent_34%),radial-gradient(circle_at_86%_10%,rgba(74,124,255,0.15),transparent_30%),linear-gradient(180deg,#eaf2ff_0%,#f6f9ff_54%,#ffffff_100%)] dark:bg-[radial-gradient(circle_at_18%_12%,rgba(74,124,255,0.18),transparent_34%),radial-gradient(circle_at_86%_10%,rgba(74,124,255,0.12),transparent_30%),linear-gradient(180deg,#202734_0%,#1a1a1a_58%,#1a1a1a_100%)]" />
        <div className="relative mx-auto max-w-6xl">
          <div className="mb-10 max-w-5xl">
            <h1 className="font-nunito text-[36px] font-black leading-[1.08] tracking-[-0.02em] text-slate-950 dark:text-white md:text-[54px]">
              <span className="text-[#4A7CFF]">Mockr</span> interview questions for practice
            </h1>
            <p className="mt-5 max-w-4xl text-base font-semibold leading-8 text-slate-600 dark:text-[#d6d6d6] md:text-lg">
              Browse coding, SQL, system design, and CS fundamentals questions before you log in to solve them in a real practice workspace.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:gap-6">
            {categoryEntries.map(({ key, icon: Icon }) => {
              const category = questionCategories[key];
              return (
                <Link
                  key={key}
                  href={category.href}
                  className="group flex min-h-[220px] cursor-pointer flex-col overflow-hidden rounded-2xl bg-white text-left shadow-[0_0_16px_rgba(0,0,0,0.04)] transition-all duration-200 hover:-translate-y-1 hover:shadow-[0_0_24px_rgba(0,0,0,0.08)] dark:bg-[#242424] dark:shadow-[0_18px_44px_rgba(0,0,0,0.28)] dark:hover:shadow-[0_22px_54px_rgba(0,0,0,0.36)]"
                >
                  <div className="flex flex-1 flex-col p-8">
                    <div className="mb-6 flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-blue-50 shadow-sm transition-transform duration-300 group-hover:-rotate-3 group-hover:scale-110 dark:bg-blue-500/15">
                      <Icon className="h-7 w-7 text-blue-500 dark:text-blue-400" strokeWidth={2.5} />
                    </div>
                    <h2 className="mb-2.5 font-nunito text-[20px] font-bold tracking-tight text-slate-800 dark:text-white">
                      {category.label}
                    </h2>
                    <p className="flex-1 text-[14px] leading-relaxed text-slate-500 dark:text-[#ababab]">
                      {category.description}
                    </p>
                  </div>
                </Link>
              );
            })}
          </div>

          <div className="mt-10 flex flex-col gap-6 rounded-3xl bg-white/82 p-7 shadow-[0_18px_70px_rgba(74,124,255,0.12)] backdrop-blur md:flex-row md:items-center md:justify-between md:p-8 dark:bg-[#242424]/92 dark:shadow-[0_18px_70px_rgba(0,0,0,0.34)]">
            <div className="max-w-3xl">
              <h2 className="font-nunito text-2xl font-black tracking-[-0.02em] text-slate-950 dark:text-white">
                Practice interview questions before the real round
              </h2>
              <p className="mt-3 text-sm leading-7 text-slate-600 dark:text-[#d6d6d6] md:text-base">
                Mockr helps you preview technical interview questions across coding, SQL, system design, and CS fundamentals before you commit to a session. Read the prompt, understand the expected approach, and then open the same question in the IDE when you are ready to write code, run queries, submit answers, or build a focused practice sheet.
              </p>
            </div>
            <Link
              href="/interview-questions/coding"
              className="inline-flex shrink-0 items-center justify-center gap-2 rounded-full bg-[#4A7CFF] px-6 py-3 text-sm font-extrabold text-white shadow-[0_14px_34px_rgba(74,124,255,0.34)] transition-all duration-200 hover:-translate-y-0.5 hover:bg-[#3e6cf0] hover:shadow-[0_18px_42px_rgba(74,124,255,0.42)]"
            >
              Start with coding questions
              <ArrowRight className="h-4 w-4" strokeWidth={2.5} />
            </Link>
          </div>
        </div>
      </section>

      <Footer variant="dark" />
    </main>
  );
}
