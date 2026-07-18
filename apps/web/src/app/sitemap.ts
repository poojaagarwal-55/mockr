import type { MetadataRoute } from "next";
import { getLivePublicQuestions } from "@/lib/live-public-question-catalog";

const baseUrl = "https://www.practers.com";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type SitemapEntry = {
  path: string;
  priority: number;
  lastModified?: Date;
  changeFrequency?: MetadataRoute.Sitemap[number]["changeFrequency"];
};

type PublishedBlogPost = {
  slug: string;
  publishedAt?: string | null;
  updatedAt?: string | null;
};

const routes = [
  { path: "/", priority: 1.0, changeFrequency: "weekly" },
  { path: "/ai-mock-interview", priority: 0.95, changeFrequency: "weekly" },
  { path: "/interview-questions", priority: 0.9, changeFrequency: "daily" },
  { path: "/interview-questions/coding", priority: 0.84, changeFrequency: "daily" },
  { path: "/interview-questions/cs-fundamentals", priority: 0.82, changeFrequency: "daily" },
  { path: "/interview-questions/system-design", priority: 0.84, changeFrequency: "daily" },
  { path: "/interview-questions/sql", priority: 0.82, changeFrequency: "daily" },
  { path: "/interview-types", priority: 0.85, changeFrequency: "monthly" },
  { path: "/blog", priority: 0.8, changeFrequency: "weekly" },
  { path: "/faq", priority: 0.75, changeFrequency: "monthly" },
  { path: "/about", priority: 0.7, changeFrequency: "monthly" },
  { path: "/careers", priority: 0.45, changeFrequency: "monthly" },
  { path: "/privacy", priority: 0.25, changeFrequency: "yearly" },
  { path: "/terms", priority: 0.25, changeFrequency: "yearly" },
] satisfies SitemapEntry[];

function getServerApiBaseUrl() {
  return (process.env.NEXT_PUBLIC_API_URL || process.env.API_URL || "http://127.0.0.1:3001").replace(/\/$/, "");
}

function parseDate(value: string | null | undefined) {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

async function getPublishedBlogPosts(): Promise<PublishedBlogPost[]> {
  try {
    const response = await fetch(`${getServerApiBaseUrl()}/blog/posts`, {
      cache: "no-store",
    });

    if (!response.ok) return [];
    const posts = (await response.json()) as PublishedBlogPost[];
    return posts.filter((post) => Boolean(post.slug));
  } catch {
    return [];
  }
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const lastModified = new Date();
  const [publicQuestions, publishedBlogPosts] = await Promise.all([
    getLivePublicQuestions(),
    getPublishedBlogPosts(),
  ]);

  const questionRoutes: SitemapEntry[] = publicQuestions.map((question) => ({
    path: `/interview-questions/${question.category}/${question.slug}`,
    priority: question.category === "coding" || question.category === "system-design" ? 0.76 : 0.72,
    changeFrequency: "weekly",
  }));

  const blogRoutes: SitemapEntry[] = publishedBlogPosts.map((post) => ({
    path: `/blog/${post.slug}`,
    priority: 0.78,
    changeFrequency: "monthly",
    lastModified: parseDate(post.updatedAt) || parseDate(post.publishedAt),
  }));

  const uniqueRoutes = new Map<string, SitemapEntry>();
  [...routes, ...questionRoutes, ...blogRoutes].forEach((route) => {
    uniqueRoutes.set(route.path, route);
  });

  return Array.from(uniqueRoutes.values()).map((route) => ({
    url: `${baseUrl}${route.path}`,
    lastModified: route.lastModified || lastModified,
    changeFrequency: route.changeFrequency || "monthly",
    priority: route.priority,
  }));
}
