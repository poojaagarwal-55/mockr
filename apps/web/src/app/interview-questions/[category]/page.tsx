import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Footer } from "@/components/footer";
import { JsonLd } from "@/components/json-ld";
import { LandingNav } from "@/components/landing-nav";
import {
  normalizeQuestionTypography,
  questionCategories,
  type PublicQuestionCategory,
} from "@/lib/public-question-previews";
import { getLivePublicQuestions } from "@/lib/live-public-question-catalog";
import { PublicQuestionBrowser } from "../public-question-browser";

type Props = { params: Promise<{ category: string }> };

export const dynamic = "force-dynamic";
export const revalidate = 0;

function isCategory(value: string): value is PublicQuestionCategory {
  return value in questionCategories;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { category } = await params;
  if (!isCategory(category)) return {};
  const data = questionCategories[category];
  return {
    title: `${data.label} to Practice Online`,
    description: data.heroDescription,
    alternates: { canonical: data.href },
    openGraph: {
      title: `${data.label} to Practice Online`,
      description: data.heroDescription,
      url: data.href,
      siteName: "Mockr",
      images: [
        {
          url: "/logo_big.png",
          width: 1200,
          height: 630,
          alt: `${data.label} on Mockr`,
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: `${data.label} to Practice Online`,
      description: data.heroDescription,
      images: ["/logo_big.png"],
    },
  };
}

export default async function CategoryPage({ params }: Props) {
  const { category } = await params;
  if (!isCategory(category)) notFound();
  const data = questionCategories[category];
  const questions = await getLivePublicQuestions(category);
  const [heroPrefix, heroSuffix = ""] = data.heroTitle.split(data.heroHighlight);
  const pageUrl = `https://www.practers.com${data.href}`;
  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "CollectionPage",
        "@id": `${pageUrl}#collection`,
        name: data.label,
        url: pageUrl,
        description: data.heroDescription,
        isPartOf: {
          "@id": "https://www.practers.com/interview-questions#collection",
        },
        mainEntity: {
          "@type": "ItemList",
          numberOfItems: questions.length,
          itemListElement: questions.slice(0, 30).map((question, index) => ({
            "@type": "ListItem",
            position: index + 1,
            name: normalizeQuestionTypography(question.title),
            url: `${pageUrl}/${question.slug}`,
          })),
        },
      },
      {
        "@type": "BreadcrumbList",
        "@id": `${pageUrl}#breadcrumb`,
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
          {
            "@type": "ListItem",
            position: 3,
            name: data.shortLabel,
            item: pageUrl,
          },
        ],
      },
    ],
  };

  return (
    <main className="min-h-screen bg-[#f7faff] text-[#111827] dark:bg-[#1a1a1a] dark:text-white">
      <JsonLd data={jsonLd} />
      <LandingNav />
      <section className="px-6 pb-8 pt-12 md:pt-14">
        <div className="mx-auto max-w-7xl rounded-[32px] bg-[linear-gradient(135deg,#ffffff_0%,#edf4ff_68%,#dfeaff_100%)] p-7 shadow-[0_22px_70px_rgba(74,124,255,0.12)] dark:bg-[linear-gradient(135deg,#282828_0%,#20283a_70%,#1d2942_100%)] dark:shadow-[0_22px_70px_rgba(0,0,0,0.32)] md:p-10">
          <Link
            href="/interview-questions"
            aria-label="Back to Interview Questions"
            className="mb-6 inline-flex h-10 w-10 items-center justify-center rounded-full bg-white/80 text-[#4A7CFF] shadow-sm ring-1 ring-[#d9e5ff] transition hover:-translate-y-0.5 hover:bg-white hover:text-[#315fe0] dark:bg-white/10 dark:ring-white/10 dark:hover:bg-white/15"
          >
            <ArrowLeft className="h-4 w-4" strokeWidth={2.5} />
          </Link>
          <h1 className="max-w-6xl font-nunito text-[30px] font-black leading-[1.08] tracking-[-0.02em] text-slate-950 dark:text-white md:whitespace-nowrap md:text-[40px] lg:text-[44px]">
            {heroPrefix}
            <span className="text-[#4A7CFF]">{data.heroHighlight}</span>
            {heroSuffix}
          </h1>
          <p className="mt-4 max-w-4xl text-sm font-semibold leading-7 text-[#4f5d73] dark:text-[#d0d5df] md:text-base">
            {data.heroDescription}
          </p>
        </div>
      </section>

      <section className="px-6 py-8">
        <div className="mx-auto max-w-7xl">
          <PublicQuestionBrowser
            questions={questions}
            category={category}
            categoryLabel={data.label}
            emptySearchHint={data.emptySearchHint}
          />

          <div className="mt-10 rounded-[28px] bg-white p-7 shadow-[0_16px_54px_rgba(74,124,255,0.08)] dark:bg-[#242424] dark:shadow-[0_16px_54px_rgba(0,0,0,0.28)] md:p-8">
            <h2 className="font-nunito text-2xl font-black tracking-[-0.02em] text-slate-950 dark:text-white">
              {data.seoBlockTitle}
            </h2>
            <p className="mt-3 max-w-5xl text-sm leading-7 text-slate-600 dark:text-[#d0d5df] md:text-base">
              {data.seoBlock}
            </p>
          </div>
        </div>
      </section>

      <Footer />
    </main>
  );
}
