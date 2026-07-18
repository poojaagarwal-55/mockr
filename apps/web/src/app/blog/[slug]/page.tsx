"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import { useTheme } from "next-themes";
import { api } from "@/lib/api";
import { useAuth } from "@/context/auth-context";
import { Clock, User, ArrowLeft } from "lucide-react";

interface BlogPost {
  id: string;
  slug: string;
  title: string;
  subtitle: string | null;
  content: string;
  coverImage: string | null;
  titleColor?: string | null;
  author: {
    id: string;
    name: string;
    avatar: string | null;
  };
  publishedAt: string;
  readTimeMinutes: number;
  views: number;
  tags: string[];
  showAuthorName?: boolean;
  createdAt: string;
}

function getPublicBlogAuthor(author: BlogPost["author"]) {
  return {
    name: author.name,
    avatar: author.avatar,
  };
}

export default function BlogPostPage() {
  const params = useParams();
  const router = useRouter();
  const slug = params.slug as string;
  const { user, session } = useAuth();
  const { resolvedTheme } = useTheme();

  const [post, setPost] = useState<BlogPost | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    const darkMode = resolvedTheme === "dark" || localStorage.getItem("practers-dark") === "true";
    setIsDark(darkMode);
    document.documentElement.dataset.dark = darkMode ? "true" : "";
  }, [resolvedTheme]);

  useEffect(() => {
    if (!slug) return;

    api
      .get<BlogPost>(`/blog/posts/${slug}`)
      .then((data) => {
        setPost(data);
        setIsLoading(false);
      })
      .catch((err) => {
        setError(err.message || "Failed to load blog post");
        setIsLoading(false);
      });
  }, [slug]);

  if (isLoading) {
    return (
      <div className={`min-h-screen flex items-center justify-center ${
        isDark ? 'bg-[#1a1a1a]' : 'bg-white'
      }`}>
        <div className="w-12 h-12 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (error || !post) {
    return (
      <div className={`min-h-screen flex items-center justify-center ${
        isDark ? 'bg-[#1a1a1a]' : 'bg-white'
      }`}>
        <div className="text-center">
          <h1 className={`text-2xl font-bold mb-4 ${
            isDark ? 'text-white' : 'text-gray-900'
          }`}>
            {error || "Blog post not found"}
          </h1>
          <Link
            href="/blog"
            className="text-blue-600 hover:text-blue-700 font-semibold"
          >
            ΓåÉ Back to Blog
          </Link>
        </div>
      </div>
    );
  }

  const publicAuthor = getPublicBlogAuthor(post.author);

  return (
    <div className={`min-h-screen transition-colors duration-300 ${
      isDark ? 'bg-[#1a1a1a] text-white' : 'bg-white text-gray-900'
    }`}>
      {/* Header */}
      <header className={`sticky top-0 z-40 backdrop-blur-md border-b transition-colors duration-300 ${
        isDark ? 'bg-[#1a1a1a]/90 border-gray-800' : 'bg-white/90 border-gray-200'
      }`}>
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <Link href="/">
            <Image
              src="/logo_big.png"
              alt="Mockr"
              width={180}
              height={51}
              className="h-11 w-auto"
            />
          </Link>
          <Link 
            href={user && post.author.id === user.id ? "/blog/my-blogs" : "/blog"} 
            className="flex items-center gap-2 text-blue-600 hover:text-blue-700 font-semibold"
          >
            <ArrowLeft className="w-5 h-5" />
            Back to Blog
          </Link>
        </div>
      </header>

      {/* Content */}
      <article className="mx-auto max-w-[850px] px-6 py-10 md:py-14">
        {/* Tags */}
        <div className="mb-8 flex flex-wrap gap-2">
          {post.tags.map((tag) => (
            <span
              key={tag}
              className={`rounded-full border px-3 py-1 text-sm font-medium ${
                isDark
                  ? 'border-gray-700 text-gray-300'
                  : 'border-gray-200 text-gray-700'
              }`}
            >
              {tag}
            </span>
          ))}
        </div>

        {/* Title */}
        <h1 
          className={`max-w-[820px] text-[2.25rem] md:text-[2.875rem] lg:text-[3.25rem] leading-[1.12] tracking-normal ${
            isDark ? 'text-[#f2f2f2]' : 'text-[#242424]'
          }`}
          style={{
            fontFamily: "'Söhne', 'Sohne', 'Inter', 'Helvetica Neue', Arial, sans-serif",
            fontWeight: 800
          }}
        >
          {post.title}
        </h1>

        {/* Subtitle */}
        {post.subtitle && (
          <p
            className={`mt-4 max-w-[760px] text-[1.35rem] md:text-[1.5rem] leading-snug ${
            isDark ? 'text-[#b8b8b8]' : 'text-[#6b6b6b]'
          }`}
            style={{
              fontFamily: "'Söhne', 'Sohne', 'Inter', 'Helvetica Neue', Arial, sans-serif",
              fontWeight: 400
            }}
          >
            {post.subtitle}
          </p>
        )}

        {/* Meta */}
        <div className={`mt-8 flex flex-wrap items-center gap-x-4 gap-y-3 pb-8 border-b ${
          isDark ? 'border-gray-800' : 'border-gray-200'
        }`}>
          <div className={`flex flex-wrap items-center gap-x-3 gap-y-2 text-sm ${
            isDark ? 'text-gray-400' : 'text-gray-600'
          }`}>
            {(post.showAuthorName ?? true) && (
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800">
                  {publicAuthor.avatar ? (
                    <img
                      src={publicAuthor.avatar}
                      alt={publicAuthor.name}
                      className="w-full h-full rounded-full object-cover"
                    />
                  ) : (
                    <User className="h-5 w-5 text-gray-500 dark:text-gray-400" />
                  )}
                </div>
                <span className={`font-semibold ${
                  isDark ? 'text-[#f2f2f2]' : 'text-[#242424]'
                }`}>
                  {publicAuthor.name}
                </span>
              </div>
            )}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              {(post.showAuthorName ?? true) && <span>·</span>}
              <span>
                {new Date(post.publishedAt).toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                })}
              </span>
              <span>·</span>
              <span className="inline-flex items-center gap-1">
                <Clock className="h-4 w-4" />
                {post.readTimeMinutes} min read
              </span>
            </div>
          </div>
        </div>

        {post.coverImage && (
          <div className="mt-10 overflow-hidden bg-gray-100 dark:bg-gray-900">
            <img
              src={post.coverImage}
              alt={post.title}
              className="aspect-[16/9] w-full object-cover"
            />
          </div>
        )}

        {/* Content */}
        <div
          className={`prose prose-lg mt-10 max-w-none ${
            isDark ? 'prose-invert' : ''
          }`}
          dangerouslySetInnerHTML={{ __html: post.content }}
        />
      </article>

      {/* Custom Styles */}
      <style jsx global>{`
        .prose {
          color: inherit;
          font-family: Charter, 'Bitstream Charter', Georgia, Cambria, 'Times New Roman', serif;
        }
        
        /* Default story body font when no font is explicitly set */
        .prose *:not([style*="font-family"]) {
          font-family: Charter, 'Bitstream Charter', Georgia, Cambria, 'Times New Roman', serif;
        }
        
        /* Font family styles - these will override the default when applied */
        .prose [style*="font-family: Georgia"] {
          font-family: Georgia, serif !important;
        }
        .prose [style*="font-family: 'Times New Roman'"] {
          font-family: 'Times New Roman', serif !important;
        }
        .prose [style*="font-family: 'Courier New'"] {
          font-family: 'Courier New', monospace !important;
        }
        .prose [style*="font-family: Verdana"] {
          font-family: Verdana, sans-serif !important;
        }
        .prose [style*="font-family: 'Helvetica Neue'"] {
          font-family: 'Helvetica Neue', sans-serif !important;
        }
        .prose [style*="font-family: 'Inter'"] {
          font-family: 'Inter', sans-serif !important;
        }
        .prose [style*="font-family: 'Roboto'"] {
          font-family: 'Roboto', sans-serif !important;
        }
        
        /* Theme-aware text colors using CSS variables */
        .prose .text-default { color: var(--blog-default); }
        .prose .text-primary { color: var(--blog-primary); }
        .prose .text-success { color: var(--blog-success); }
        .prose .text-warning { color: var(--blog-warning); }
        .prose .text-danger { color: var(--blog-danger); }
        .prose .text-purple { color: var(--blog-purple); }
        .prose .text-pink { color: var(--blog-pink); }
        .prose .text-teal { color: var(--blog-teal); }
        .prose .text-indigo { color: var(--blog-indigo); }
        .prose .text-gray { color: var(--blog-gray); }
        .prose .text-orange { color: var(--blog-orange); }
        .prose .text-cyan { color: var(--blog-cyan); }
        .prose .text-mint { color: var(--blog-mint); }
        .prose .text-brown { color: var(--blog-brown); }
        .prose .text-yellow { color: var(--blog-yellow); }
        .prose .text-lime { color: var(--blog-lime); }
        .prose .text-magenta { color: var(--blog-magenta); }
        .prose .text-rose { color: var(--blog-rose); }
        
        .prose h1 {
          font-family: 'Söhne', 'Sohne', 'Inter', 'Helvetica Neue', Arial, sans-serif !important;
          font-size: clamp(2rem, 6vw, 3rem) !important;
          font-weight: 800 !important;
          line-height: 1.15 !important;
          margin: clamp(1.5rem, 4vw, 2rem) 0 clamp(0.875rem, 2.5vw, 1.25rem) 0 !important;
          overflow-wrap: anywhere !important;
          word-break: normal !important;
        }
        .prose h2 {
          font-family: 'Söhne', 'Sohne', 'Inter', 'Helvetica Neue', Arial, sans-serif !important;
          font-size: clamp(1.75rem, 4.8vw, 2.25rem) !important;
          font-weight: 700 !important;
          line-height: 1.25 !important;
          margin: clamp(1.35rem, 3.5vw, 1.75rem) 0 clamp(0.75rem, 2vw, 1rem) 0 !important;
          overflow-wrap: anywhere !important;
          word-break: normal !important;
        }
        .prose h3 {
          font-family: 'Söhne', 'Sohne', 'Inter', 'Helvetica Neue', Arial, sans-serif !important;
          font-size: clamp(1.35rem, 3.8vw, 1.75rem) !important;
          font-weight: 700 !important;
          line-height: 1.35 !important;
          margin: clamp(1.125rem, 3vw, 1.5rem) 0 clamp(0.5rem, 1.8vw, 0.75rem) 0 !important;
          overflow-wrap: anywhere !important;
          word-break: normal !important;
        }
        .prose h4 {
          font-family: 'Söhne', 'Sohne', 'Inter', 'Helvetica Neue', Arial, sans-serif !important;
          font-size: clamp(1.15rem, 3vw, 1.35rem) !important;
          font-weight: 600 !important;
          line-height: 1.4 !important;
          margin: clamp(1rem, 2.5vw, 1.25rem) 0 0.5rem 0 !important;
          color: ${isDark ? '#d1d5db' : '#374151'} !important;
          overflow-wrap: anywhere !important;
          word-break: normal !important;
        }
        .prose p {
          font-size: 1.125rem;
          margin-bottom: 1.5rem;
          line-height: 1.75;
          font-family: Charter, 'Bitstream Charter', Georgia, Cambria, 'Times New Roman', serif;
        }
        .prose ul,
        .prose ol {
          margin: 0.75rem 0;
          padding-left: 2rem;
        }
        .prose ul {
          list-style-type: disc;
        }
        .prose ul ul {
          list-style-type: circle;
          margin: 0.25rem 0;
          padding-left: 2rem;
        }
        .prose ul ul ul {
          list-style-type: square;
          margin: 0.25rem 0;
          padding-left: 2rem;
        }
        .prose ol {
          list-style-type: decimal;
        }
        .prose ol ol {
          list-style-type: lower-alpha;
          margin: 0.25rem 0;
          padding-left: 2rem;
        }
        .prose ol ol ol {
          list-style-type: lower-roman;
          margin: 0.25rem 0;
          padding-left: 2rem;
        }
        .prose li {
          margin: 0.3rem 0;
          padding-left: 0.25rem;
          display: list-item;
        }
        .prose li > p {
          margin: 0;
          display: inline;
        }
        .prose li > p + p {
          display: block;
          margin-top: 0.25rem;
        }
        .prose blockquote {
          border-left: 4px solid #4A7CFF;
          padding-left: 1rem;
          margin: 1rem 0;
          font-style: italic;
          color: #6b7280;
        }
        .dark .prose blockquote {
          border-left-color: #0A84FF;
          color: #9ca3af;
        }
        .prose pre {
          background: #1e1e1e;
          color: #fff;
          padding: 1rem;
          border-radius: 0.5rem;
          overflow-x: auto;
          margin: 1rem 0;
          position: relative;
        }
        .dark .prose pre {
          background: #0d0d0d;
        }
        .prose code {
          background: ${isDark ? '#374151' : '#f3f4f6'};
          padding: 0.2rem 0.4rem;
          border-radius: 0.25rem;
          font-size: 0.875em;
          color: ${isDark ? '#e5e7eb' : '#1f2937'};
          font-family: 'Courier New', monospace;
        }
        .prose pre code {
          background: transparent;
          padding: 0;
          color: inherit;
          font-family: 'Courier New', monospace;
          font-size: 0.875rem;
          line-height: 1.5;
        }
        
        /* Syntax highlighter in published posts */
        .prose .syntax-code-block {
          margin: 1.5rem 0;
          border-radius: 0.5rem;
          overflow: hidden;
        }
        .prose .syntax-code-block pre {
          margin: 0 !important;
          padding: 1rem !important;
        }
        .prose img {
          max-width: 100%;
          height: auto;
          border-radius: 0.5rem;
          margin: 2rem 0;
        }
        .prose figure.blog-image-figure {
          margin: 2rem 0;
          text-align: center;
        }
        .prose figure.blog-image-figure img {
          display: block;
          margin: 0 auto !important;
        }
        .prose figcaption.blog-image-caption {
          margin: 0.75rem auto 0;
          color: ${isDark ? '#9ca3af' : '#6b7280'};
          font-family: 'Söhne', 'Sohne', 'Inter', 'Helvetica Neue', Arial, sans-serif;
          font-size: 0.95rem;
          line-height: 1.45;
          text-align: center;
          max-width: 90%;
        }
        .prose table {
          border-collapse: collapse;
          table-layout: fixed;
          width: 100%;
          margin: 1.5rem 0;
          overflow: hidden;
          border-radius: 8px;
          box-shadow: 0 1px 3px 0 rgba(0, 0, 0, 0.1), 0 1px 2px 0 rgba(0, 0, 0, 0.06);
          border: 1px solid #e5e7eb;
        }
        .dark .prose table {
          border-color: #374151;
          box-shadow: 0 1px 3px 0 rgba(0, 0, 0, 0.3), 0 1px 2px 0 rgba(0, 0, 0, 0.2);
        }
        .prose td,
        .prose th {
          min-width: 1em;
          border: 1px solid #e5e7eb;
          padding: 12px 16px;
          vertical-align: top;
          box-sizing: border-box;
          position: relative;
          transition: all 0.2s ease;
        }
        .dark .prose td,
        .dark .prose th {
          border-color: #374151;
        }
        .prose th {
          font-family: 'Söhne', 'Sohne', 'Inter', 'Helvetica Neue', Arial, sans-serif !important;
          font-weight: 600;
          text-align: left;
          background: linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%);
          color: #1e293b;
          font-size: 0.875rem;
          letter-spacing: 0.025em;
        }
        .dark .prose th {
          background: linear-gradient(135deg, #1f2937 0%, #111827 100%);
          color: #f9fafb;
        }
        .prose td:hover,
        .prose th:hover {
          background-color: #f8fafc;
        }
        .dark .prose td:hover,
        .dark .prose th:hover {
          background-color: #1f2937;
        }
        .prose td p,
        .prose th p {
          margin: 0;
        }
        .prose a {
          color: #4A7CFF;
          text-decoration: underline;
        }
        .prose a:hover {
          color: #3a6cef;
        }
        .dark .prose a {
          color: #0A84FF;
        }
        .dark .prose a:hover {
          color: #64D2FF;
        }
      `}</style>
    </div>
  );
}

