import type { Metadata } from "next";
import type { ReactNode } from "react";
import { JsonLd } from "@/components/json-ld";

type BlogMetadata = {
  slug: string;
  title: string;
  subtitle: string | null;
  coverImage: string | null;
  publishedAt: string;
  readTimeMinutes: number;
  tags: string[];
  author: {
    name: string | null;
    avatar: string | null;
  };
};

type Props = {
  children: ReactNode;
  params: Promise<{ slug: string }>;
};

function getServerApiBaseUrl() {
  return (process.env.NEXT_PUBLIC_API_URL || process.env.API_URL || "http://127.0.0.1:3001").replace(/\/$/, "");
}

function absoluteUrl(value: string | null | undefined) {
  if (!value) return "https://www.practers.com/logo_big.png";
  if (/^https?:\/\//i.test(value)) return value;
  return `https://www.practers.com${value.startsWith("/") ? value : `/${value}`}`;
}

async function getBlogMetadata(slug: string): Promise<BlogMetadata | null> {
  try {
    const response = await fetch(`${getServerApiBaseUrl()}/blog/posts/${encodeURIComponent(slug)}/metadata`, {
      cache: "no-store",
    });

    if (!response.ok) return null;
    return (await response.json()) as BlogMetadata;
  } catch {
    return null;
  }
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const post = await getBlogMetadata(slug);

  if (!post) {
    return {
      title: "Mockr Blog",
      description: "Read Mockr interview preparation guides on AI mock interviews, coding, system design, resumes, and reports.",
      alternates: { canonical: `/blog/${slug}` },
    };
  }

  const title = post.title;
  const description =
    post.subtitle ||
    "Read Mockr interview preparation guides on AI mock interviews, coding, system design, resumes, and reports.";
  const canonical = `/blog/${post.slug}`;
  const image = absoluteUrl(post.coverImage);

  return {
    title,
    description,
    alternates: { canonical },
    openGraph: {
      title,
      description,
      url: canonical,
      siteName: "Mockr",
      type: "article",
      publishedTime: post.publishedAt,
      authors: [post.author.name || "Mockr team"],
      tags: post.tags,
      images: [
        {
          url: image,
          width: 1200,
          height: 630,
          alt: title,
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [image],
    },
  };
}

export default async function BlogSlugLayout({ children, params }: Props) {
  const { slug } = await params;
  const post = await getBlogMetadata(slug);

  if (!post) return children;

  const pageUrl = `https://www.practers.com/blog/${post.slug}`;
  const title = post.title;
  const description =
    post.subtitle ||
    "Read Mockr interview preparation guides on AI mock interviews, coding, system design, resumes, and reports.";
  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "BlogPosting",
        "@id": `${pageUrl}#blogposting`,
        headline: title,
        description,
        image: absoluteUrl(post.coverImage),
        datePublished: post.publishedAt,
        author: {
          "@type": "Organization",
          name: post.author.name || "Mockr team",
          url: "https://www.practers.com",
        },
        publisher: {
          "@type": "Organization",
          name: "Mockr",
          logo: {
            "@type": "ImageObject",
            url: "https://www.practers.com/logo_small.png",
          },
        },
        mainEntityOfPage: {
          "@type": "WebPage",
          "@id": pageUrl,
        },
        keywords: post.tags.join(", "),
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
            name: "Blog",
            item: "https://www.practers.com/blog",
          },
          {
            "@type": "ListItem",
            position: 3,
            name: title,
            item: pageUrl,
          },
        ],
      },
    ],
  };

  return (
    <>
      <JsonLd data={jsonLd} />
      {children}
    </>
  );
}
