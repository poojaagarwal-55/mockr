import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { JsonLd } from "@/components/json-ld";
import { LandingNav } from "@/components/landing-nav";
import { QuestionPreviewIde } from "../../question-preview-ide";
import {
  normalizeQuestionTypography,
  questionCategories,
  type PublicQuestionCategory,
} from "@/lib/public-question-previews";
import { getLivePublicQuestionBySlug } from "@/lib/live-public-question-catalog";

type Props = { params: Promise<{ category: string; slug: string }> };

export const dynamic = "force-dynamic";
export const revalidate = 0;

function isCategory(value: string): value is PublicQuestionCategory {
  return value in questionCategories;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { category, slug } = await params;
  if (!isCategory(category)) return {};
  const question = await getLivePublicQuestionBySlug(category, slug);
  if (!question) return {};
  const title = normalizeQuestionTypography(question.title);
  const categoryData = questionCategories[category];
  const pageTitle = `${title} Interview Question | Practice in IDE`;
  const description = `${question.summary} Preview the question, examples, hints, and log in to solve it in the Mockr IDE.`;
  const canonical = `/interview-questions/${category}/${slug}`;

  return {
    title: pageTitle,
    description,
    alternates: { canonical },
    openGraph: {
      title: pageTitle,
      description,
      url: canonical,
      siteName: "Mockr",
      type: "article",
      images: [
        {
          url: "/logo_big.png",
          width: 1200,
          height: 630,
          alt: `${title} ${categoryData.shortLabel} interview question`,
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: pageTitle,
      description,
      images: ["/logo_big.png"],
    },
  };
}

export default async function QuestionPreviewPage({ params }: Props) {
  const { category, slug } = await params;
  if (!isCategory(category)) notFound();
  const question = await getLivePublicQuestionBySlug(category, slug);
  if (!question) notFound();
  const categoryData = questionCategories[category];
  const title = normalizeQuestionTypography(question.title);
  const pageUrl = `https://www.practers.com/interview-questions/${category}/${slug}`;
  const categoryUrl = `https://www.practers.com${categoryData.href}`;
  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Question",
        "@id": `${pageUrl}#question`,
        name: title,
        text: normalizeQuestionTypography(question.prompt || question.summary),
        url: pageUrl,
        inLanguage: "en",
        about: categoryData.label,
        keywords: [categoryData.shortLabel, ...question.tags].filter(Boolean).join(", "),
        isPartOf: {
          "@type": "CollectionPage",
          name: categoryData.label,
          url: categoryUrl,
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
            name: categoryData.shortLabel,
            item: categoryUrl,
          },
          {
            "@type": "ListItem",
            position: 4,
            name: title,
            item: pageUrl,
          },
        ],
      },
    ],
  };

  return (
    <main className="min-h-screen bg-[#f6f9ff] text-[#111827] dark:bg-[#1a1a1a] dark:text-white">
      <JsonLd data={jsonLd} />
      <LandingNav />
      <section className="border-b border-slate-200 bg-[#f6f9ff] px-6 py-5 dark:border-[#333333] dark:bg-[#1a1a1a]">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-2.5 text-sm font-extrabold text-[#667287] dark:text-[#ababab]">
          <Link href="/interview-questions" className="transition hover:text-[#4A7CFF]">Interview Questions</Link>
          <span className="text-slate-300 dark:text-[#555]">/</span>
          <Link href={categoryData.href} className="transition hover:text-[#4A7CFF]">{categoryData.shortLabel}</Link>
          <span className="text-slate-300 dark:text-[#555]">/</span>
          <span className="max-w-full truncate text-slate-900 dark:text-white">{title}</span>
        </div>
      </section>
      <QuestionPreviewIde question={question} />
    </main>
  );
}
