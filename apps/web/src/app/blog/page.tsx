"use client";

import React, { useState, useEffect } from "react";
import { Search, Calendar, Clock, User, ArrowRight, BookOpen, Eye, MessageCircle, Star, PenSquare } from "lucide-react";
import Link from "next/link";
import Image from "next/image";
import { useTheme } from "next-themes";
import { useAuth } from "@/context/auth-context";
import { api } from "@/lib/api";
import { publicBlogFallbackPosts } from "@/lib/public-blog-fallback";
// import { CaretLeft } from "@phosphor-icons/react";
import { CaretDown, CaretLeft } from "@phosphor-icons/react";
const BLUE = "#4A7CFF";
const YELLOW = "#FFE500";

interface BlogPost {
  id: string;
  slug: string;
  title: string;
  subtitle: string | null;
  coverImage: string | null;
  content: string;
  author: {
    id: string;
    name: string;
    avatar: string | null;
  };
  publishedAt: string;
  readTimeMinutes: number;
  views: number;
  tags: string[];
  featured: boolean;
}

function getPublicBlogAuthor(author: BlogPost["author"]) {
  return {
    name: author.name,
    avatar: author.avatar,
  };
}

const Blog = () => {
  const { user } = useAuth();
  const { resolvedTheme } = useTheme();
  const [selectedCategory, setSelectedCategory] = useState("All");
  const [visiblePosts, setVisiblePosts] = useState(6);
  const [isDark, setIsDark] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [posts, setPosts] = useState<BlogPost[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted) return;
    const darkMode = resolvedTheme === "dark" || localStorage.getItem("practers-dark") === "true";
    setIsDark(darkMode);
    document.documentElement.dataset.dark = darkMode ? "true" : "";
  }, [mounted, resolvedTheme]);

  // Fetch blog posts from API
  useEffect(() => {
    api
      .get<BlogPost[]>("/blog/posts")
      .then((data) => {
        setPosts(data);
        setIsLoading(false);
      })
      .catch(() => {
        setPosts(publicBlogFallbackPosts);
        setIsLoading(false);
      });
  }, []);

  // Scroll reveal animation
  useEffect(() => {
    const elements = document.querySelectorAll('.article-card');
    elements.forEach((element, index) => {
      setTimeout(() => {
        element.classList.add('visible');
      }, index * 100);
    });
  }, []);

  // Re-trigger animations when filters change
  useEffect(() => {
    setVisiblePosts(6);
    const elements = document.querySelectorAll('.article-card');
    elements.forEach((element) => {
      element.classList.remove('visible');
    });

    const timer = setTimeout(() => {
      elements.forEach((element) => {
        element.classList.add('visible');
      });
    }, 100);

    return () => clearTimeout(timer);
  }, [selectedCategory]);

  const categories = React.useMemo(() => {
    const tagCounts: Record<string, number> = {};
    posts.forEach(p => {
      p.tags.forEach(tag => {
        tagCounts[tag] = (tagCounts[tag] || 0) + 1;
      });
    });
    
    const sortedTags = Object.entries(tagCounts)
      .sort((a, b) => b[1] - a[1])
      .map(entry => entry[0])
      .slice(0, 7);

    return ["All", ...sortedTags];
  }, [posts]);

  const featuredArticle = posts.find(p => p.featured);
  const featuredAuthor = featuredArticle ? getPublicBlogAuthor(featuredArticle.author) : null;

  const articles = posts.filter(p => !p.featured);

  const filteredArticles = articles.filter(article => {
    return selectedCategory === "All" || article.tags.includes(selectedCategory);
  });

  const loadMore = () => {
    setVisiblePosts(prev => prev + 3);
  };

  // Prevent hydration mismatch
  if (!mounted) {
    return (
      <div className="min-h-screen antialiased overflow-x-hidden bg-white text-[#1a1a1a]" style={{ fontFamily: "'Inter', sans-serif" }}>
        <header className="sticky top-0 z-40 w-full backdrop-blur-md border-b bg-white/90 border-gray-200">
          <div className="max-w-[1200px] mx-auto px-6 h-16 flex items-center justify-between">
            <Link href="/">
              <Image src="/logo_big.png" alt="Mockr" width={180} height={51} className="h-11 w-auto" />
            </Link>
            <nav className="hidden md:flex items-center gap-9">
              {[

                { label: "Interviews", href: "/ai-mock-interview", isHash: false },
                { label: "Questions", href: "/interview-questions", isHash: false },
                { label: "FAQ", href: "/faq", isHash: false },
                { label: "Blog", href: "/blog", isHash: false }
              ].map((item) => (
                <Link key={item.label} className="text-[15px] font-medium tracking-tight text-[#333] hover:text-[#4A7CFF] transition-colors cursor-pointer" href={item.href}>
                  {item.label}
                </Link>
              ))}
            </nav>
            <div className="flex items-center gap-3">
              <Link href="/login" className="hidden sm:block text-sm px-4 py-2 text-[#1a1a1a]">Log In</Link>
              <Link href="/login?tab=signup" className="text-sm px-5 py-2.5 rounded-full transition-colors bg-[#1a1a1a] text-white hover:bg-[#333]">
                Get Started
              </Link>
            </div>
          </div>
        </header>
      </div>
    );
  }

  return (
    <div className={`min-h-screen antialiased overflow-x-hidden transition-colors duration-300 ${
      isDark 
        ? 'bg-[#222222] text-[#e5e5e5]' 
        : 'bg-white text-[#1a1a1a]'
    }`} style={{ fontFamily: "'Inter', sans-serif" }}>
      {/* Navbar */}
      <header className={`sticky top-0 z-40 w-full backdrop-blur-md border-b transition-colors duration-300 ${
        isDark
          ? 'bg-[#222222]/90 border-[#2d3142]'
          : 'bg-white/90 border-gray-200'
      }`}>
        <div className="max-w-[1200px] mx-auto px-6 h-16 flex items-center justify-between">
          <Link href="/">
            <Image 
              src="/logo_big.png" 
              alt="Mockr" 
              width={180} 
              height={51} 
              className="h-11 w-auto" 
            />
          </Link>
          <nav className="hidden md:flex items-center gap-9">
            {[

              { label: "Interviews", href: "/ai-mock-interview", isHash: false },
              { label: "Questions", href: "/interview-questions", isHash: false },
              { label: "FAQ", href: "/faq", isHash: false },
              { label: "Blog", href: "/blog", isHash: false }
            ].map((item) => (
              <Link 
                key={item.label} 
                className={`text-[15px] font-medium tracking-tight transition-colors cursor-pointer ${
                  isDark
                    ? 'text-[#e5e5e5] hover:text-[#4A7CFF]'
                    : 'text-[#333] hover:text-[#4A7CFF]'
                }`}
                href={item.href}
              >
                {item.label}
              </Link>
            ))}
          </nav>
          <div className="flex items-center gap-3">
            {user ? (
              <>
                <Link 
                  href="/blog/editor" 
                  className={`flex items-center gap-2 text-sm px-5 py-2.5 rounded-full transition-colors ${
                    isDark
                      ? 'bg-[#4A7CFF] text-white hover:bg-[#5B8FFF]'
                      : 'bg-[#4A7CFF] text-white hover:bg-[#5B8FFF]'
                  }`}
                >
                  <PenSquare className="w-4 h-4" />
                  Write
                </Link>
                <Link 
                  href="/dashboard" 
                  className={`hidden sm:block text-sm px-4 py-2 ${
                    isDark ? 'text-[#e5e5e5]' : 'text-[#1a1a1a]'
                  }`}
                >
                  Dashboard
                </Link>
              </>
            ) : (
              <>
                <Link href="/login" className={`hidden sm:block text-sm px-4 py-2 ${
                  isDark ? 'text-[#e5e5e5]' : 'text-[#1a1a1a]'
                }`}>Log In</Link>
                <Link href="/login?tab=signup" className={`text-sm px-5 py-2.5 rounded-full transition-colors ${
                  isDark
                    ? 'bg-[#4A7CFF] text-white hover:bg-[#5B8FFF]'
                    : 'bg-[#1a1a1a] text-white hover:bg-[#333]'
                }`}>
                  Get Started
                </Link>
              </>
            )}
          </div>
        </div>
      </header>

      {/* Loading State */}
      {isLoading && (
        <div className="flex items-center justify-center min-h-[60vh]">
          <div className="w-12 h-12 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
        </div>
      )}

      {/* Content - Only show when not loading */}
      {!isLoading && (
        <>
      {/* Blog Heading */}
      <section className="pt-6 md:pt-8 pb-2">
        <div className="max-w-[1100px] mx-auto px-6">
          <h1 className={`text-[2rem] md:text-[2.8rem] font-extrabold tracking-tight transition-colors duration-300 ${
            isDark ? 'text-[#e5e5e5]' : 'text-[#111]'
          }`}>
            Blog
          </h1>
        </div>
      </section>



      {/* OLD Hero Section - COMMENTED OUT */}
      {/* <section className="py-12 bg-gradient-to-br from-blue-50 via-white to-yellow-50 relative overflow-hidden">
        <div className="absolute inset-0 opacity-30">
          <div className="absolute top-20 left-10 w-32 h-32 rounded-full blur-3xl animate-pulse" style={{ backgroundColor: BLUE }}></div>
          <div className="absolute top-40 right-20 w-24 h-24 rounded-full blur-2xl animate-pulse" style={{ backgroundColor: YELLOW, animationDelay: '1s' }}></div>
          <div className="absolute bottom-32 left-1/4 w-28 h-28 rounded-full blur-3xl animate-pulse" style={{ backgroundColor: BLUE, animationDelay: '2s' }}></div>
        </div>

        <div className="container mx-auto px-6 lg:px-12 py-8 relative z-10">
          <div className="max-w-7xl mx-auto">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-center">
              <div className="space-y-6">
                <div className="inline-flex items-center gap-3 px-4 py-2 rounded-full bg-white/80 backdrop-blur-sm border shadow-lg animate-slideInLeft" style={{ borderColor: BLUE }}>
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full animate-pulse" style={{ backgroundColor: BLUE }}></div>
                    <BookOpen className="w-4 h-4" style={{ color: BLUE }} />
                  </div>
                  <span className="text-xs text-gray-700 font-semibold">Mockr Blog</span>
                </div>

                <div className="space-y-3">
                  <h1 className="text-4xl md:text-5xl font-bold leading-tight">
                    <span className="block text-gray-900 animate-slideInLeft" style={{ animationDelay: '0.2s' }}>
                      Insights &amp;
                    </span>
                    <span className="block animate-slideInLeft" style={{ color: BLUE, animationDelay: '0.4s' }}>
                      Innovation
                    </span>
                  </h1>
                  <p className="text-lg text-gray-600 leading-relaxed max-w-2xl animate-slideInLeft" style={{ animationDelay: '0.8s' }}>
                    Discover the latest trends in AI-powered interview preparation, career development, and workplace innovation. Expert insights to help you navigate the future of technical interviews.
                  </p>
                </div>

                <div className="animate-slideInLeft" style={{ animationDelay: '1s' }}>
                  <div className="relative max-w-lg">
                    <Search className="absolute left-4 top-1/2 transform -translate-y-1/2 text-gray-500 w-5 h-5" />
                    <input
                      type="text"
                      placeholder="Search articles, topics, or authors..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="w-full pl-12 pr-4 py-3 rounded-2xl bg-white/95 backdrop-blur-md border shadow-xl text-gray-800 placeholder-gray-500 focus:outline-none focus:ring-4 transition-all duration-300"
                      style={{ borderColor: BLUE }}
                    />
                  </div>
                </div>
              </div>

              <div className="relative flex justify-center items-center animate-slideInRight">
                <div className="relative w-full max-w-lg">
                  <div className="absolute inset-0 rounded-3xl blur-xl transform scale-110" style={{ background: `linear-gradient(to bottom right, ${BLUE}30, ${YELLOW}20)` }}></div>

                  <div className="relative bg-white rounded-3xl shadow-2xl overflow-hidden border-4 border-white/50 transform hover:scale-105 transition-transform duration-500">
                    <Image
                      src="/blogherosection.png"
                      alt="Blog Insights and Innovation"
                      width={500}
                      height={350}
                      className="w-full h-[350px] object-cover"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-blue-900/20 via-transparent to-transparent"></div>

                    <div className="absolute bottom-4 left-4 right-4 bg-white/95 backdrop-blur-md rounded-xl p-3 shadow-lg border border-white/50">
                      <div className="text-center">
                        <h4 className="font-bold text-base mb-1" style={{ color: BLUE }}>Stay Informed</h4>
                        <p className="text-gray-600 text-xs">Latest insights from industry experts</p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section> */}

      {/* Featured Article - Editor's Pick */}
      {featuredArticle && (
        <section className="pt-6 pb-16 relative">
        {/* Uniform Padding Wrapper */}
        <div className="container mx-auto px-6 lg:px-12">
          <div className="max-w-7xl mx-auto">
            <div className="text-center mb-10">
              <div className="inline-block mb-4 px-4 py-2 rounded-full text-sm font-bold shadow-lg" style={{ backgroundColor: YELLOW, color: '#111' }}>
                Featured Story
              </div>
              <h2 className={`text-3xl md:text-4xl font-bold mb-4 ${
                isDark ? 'text-[#4A7CFF]' : 'text-gray-900'
              }`}>Editor's Pick</h2>
            </div>

            <Link 
              href={`/blog/${featuredArticle.slug}`}
              className="overflow-hidden shadow-2xl border-0 rounded-3xl group hover:shadow-3xl transition-all duration-500 block" 
              style={{
                background: isDark 
                  ? "linear-gradient(to right, rgb(42, 42, 42) 0%, rgb(42, 42, 42) 60%, rgba(74, 124, 255, 0.1) 100%)"
                  : "linear-gradient(to bottom right, #ffffff 0%, #ffffff 35%, #f4f5f7 70%, rgba(244, 245, 247, 0) 100%)"
              }}
            >
              <div className="grid lg:grid-cols-2 gap-0">
                {/* Image */}
                <div className="relative overflow-hidden">
                  <img
                    src={featuredArticle.coverImage || '/bloghero.png'}
                    alt={featuredArticle.title}
                    className="w-full h-80 lg:h-full object-cover group-hover:scale-110 transition-transform duration-700"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-transparent"></div>

                  {/* Badge Overlay */}
                  <div className="absolute top-4 left-4">
                    <div className="flex items-center gap-1 px-3 py-1 rounded-full text-white shadow-lg" style={{ backgroundColor: YELLOW }}>
                      <Star className="w-4 h-4 text-gray-900" />
                      <span className="text-gray-900 font-bold text-sm">Featured</span>
                    </div>
                  </div>

                  {/* Stats Overlay */}
                  <div className="absolute bottom-4 left-4 right-4 flex justify-between">
                    <div className="flex items-center gap-4 text-white text-sm">
                      <div className="flex items-center gap-1">
                        <Eye className="w-4 h-4" />
                        {featuredArticle.views >= 1000 ? `${(featuredArticle.views / 1000).toFixed(1)}K` : featuredArticle.views}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Content */}
                <div className="p-8 lg:p-12 flex flex-col justify-center">
                  <div className={`flex items-center gap-4 mb-4 ${
                    isDark ? 'text-[#999]' : 'text-gray-600'
                  }`}>
                    <div className="flex items-center gap-1">
                      <Calendar className="w-4 h-4" />
                      {new Date(featuredArticle.publishedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                    </div>
                    <div className="flex items-center gap-1">
                      <Clock className="w-4 h-4" />
                      {featuredArticle.readTimeMinutes} min read
                    </div>
                  </div>

                  <h3 className={`text-3xl md:text-4xl font-bold mb-4 transition-colors ${
                    isDark ? 'text-[#4A7CFF]' : ''
                  }`} style={!isDark ? { color: BLUE } : {}}>
                    {featuredArticle.title}
                  </h3>

                  <p className={`text-lg leading-relaxed mb-6 ${
                    isDark ? 'text-[#ffffff]' : 'text-gray-600'
                  }`}>
                    {featuredArticle.subtitle}
                  </p>

                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full flex items-center justify-center" style={{ backgroundColor: YELLOW }}>
                        {featuredAuthor?.avatar ? (
                          <img src={featuredAuthor.avatar} alt={featuredAuthor.name} className="w-full h-full rounded-full object-cover" />
                        ) : (
                          <User className="w-5 h-5 text-gray-900" />
                        )}
                      </div>
                      <div>
                        <p className={`font-semibold ${
                          isDark ? 'text-[#e5e5e5]' : 'text-gray-900'
                        }`}>{featuredAuthor?.name}</p>
                        <p className={`text-sm ${
                          isDark ? 'text-[#ffe1ae]' : 'text-gray-600'
                        }`}>Author</p>
                      </div>
                    </div>

                   
                  </div>
                </div>
              </div>
            </Link>
          </div>
        </div>
      </section>
      )}

      {/* Categories Filter */}
      <section className={`py-8 transition-colors duration-300 ${
          isDark ? 'bg-[#222222]' : 'bg-transparent'
        }`}>
        {/* Uniform Padding Wrapper */}
        <div className="container mx-auto px-6 lg:px-12">
          <div className="max-w-7xl mx-auto">
            <div className="flex flex-wrap justify-center gap-3">
              {categories.map((category) => (
                <button
                  key={category}
                  onClick={() => setSelectedCategory(category)}
                  className={`px-6 py-3 rounded-full transition-all duration-300 font-medium ${
                    selectedCategory === category
                      ? 'text-white shadow-lg scale-105'
                      : isDark
                      ? 'bg-[#2a2a2a] hover:bg-[#333] text-[#e5e5e5] border border-[#2d3142]'
                      : 'bg-white hover:bg-blue-50 text-gray-700 border border-gray-200'
                  }`}
                  style={selectedCategory === category ? { backgroundColor: BLUE } : {}}
                >
                  {category}
                </button>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Articles Grid */}
      <section className={`py-16 transition-colors duration-300 ${
        isDark ? 'bg-[#222222]' : 'bg-transparent'
      }`}>
        {/* Uniform Padding Wrapper */}
        <div className="container mx-auto px-6 lg:px-12">
          <div className="max-w-7xl mx-auto">
            <div className="text-center mb-12">
              <h2 className={`text-4xl md:text-5xl font-bold mb-4 ${
                isDark ? 'text-[#e5e5e5]' : 'text-gray-900'
              }`}>
                Latest <span style={{ color: BLUE }}>Articles</span>
              </h2>
              <p className={`text-xl max-w-2xl mx-auto ${
                isDark ? 'text-[#999]' : 'text-gray-600'
              }`}>
                Explore our collection of insights, tips, and industry knowledge
              </p>
            </div>

            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
              {filteredArticles.slice(0, visiblePosts).map((article, index) => {
                const author = getPublicBlogAuthor(article.author);

                return (
                <Link
                  key={`${article.id}-${selectedCategory}`}
                  href={`/blog/${article.slug}`}
                  className={`article-card group flex h-full min-h-[540px] flex-col rounded-[24px] p-5 lg:p-6 transition-all duration-300 hover:-translate-y-2 cursor-pointer relative overflow-hidden ${
                    isDark ? 'bg-[#2a2a2a]' : ''
                  }`}
                  style={{ 
                    background: isDark 
                      ? "#2a2a2a"
                      : "linear-gradient(to bottom, #ffffff 0%, #ffffff 35%, #f4f5f7 70%, rgba(244, 245, 247, 0) 100%)",
                    boxShadow: isDark 
                      ? "0 4px 20px rgba(0,0,0,0.3)"
                      : "0 4px 20px rgba(0,0,0,0.08)"
                  }}
                >
                  {/* Image */}
                  <div className="relative overflow-hidden rounded-2xl mb-4">
                    <img
                      src={article.coverImage || '/blog.jpg'}
                      alt={article.title}
                      className="w-full h-48 object-cover group-hover:scale-110 transition-transform duration-500"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/20 via-transparent to-transparent"></div>

                    {/* Badge */}
                    <div className="absolute top-3 left-3">
                      <span className="px-3 py-1 rounded-full text-xs font-bold text-white shadow-lg" style={{ backgroundColor: BLUE }}>
                        {article.tags[0] || 'Article'}
                      </span>
                    </div>
                  </div>

                  {/* Content */}
                  <div className="flex flex-1 flex-col space-y-3">
                    <div className={`flex items-center gap-3 text-sm ${
                      isDark ? 'text-[#999]' : 'text-gray-600'
                    }`}>
                      <div className="flex items-center gap-1">
                        <Calendar className="w-3 h-3" />
                        {new Date(article.publishedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                      </div>
                      <div className="flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {article.readTimeMinutes} min read
                      </div>
                    </div>

                    <h3 className={`min-h-[84px] text-xl font-bold group-hover:text-[#4A7CFF] transition-colors leading-tight line-clamp-3 ${
                      isDark ? 'text-[#e5e5e5]' : 'text-gray-900'
                    }`}>
                      {article.title}
                    </h3>

                    <p className={`min-h-[66px] leading-relaxed text-sm line-clamp-3 ${
                      isDark ? 'text-[#999]' : 'text-gray-600'
                    }`}>
                      {article.subtitle}
                    </p>

                    <div className={`mt-auto flex items-center justify-between pt-3 border-t ${
                      isDark ? 'border-[#2d3142]' : 'border-gray-200'
                    }`}>
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-full flex items-center justify-center" style={{ backgroundColor: YELLOW }}>
                          {author.avatar ? (
                            <img src={author.avatar} alt={author.name} className="w-full h-full rounded-full object-cover" />
                          ) : (
                            <User className="w-4 h-4 text-gray-900" />
                          )}
                        </div>
                        <div>
                          <p className={`text-sm font-medium ${
                            isDark ? 'text-[#e5e5e5]' : 'text-gray-900'
                          }`}>{author.name}</p>
                        </div>
                      </div>

                      <div className={`flex items-center gap-3 text-sm ${
                        isDark ? 'text-[#666]' : 'text-gray-500'
                      }`}>
                        <div className="flex items-center gap-1">
                          <Eye className="w-3 h-3" />
                          {article.views >= 1000 ? `${(article.views / 1000).toFixed(1)}K` : article.views}
                        </div>
                      </div>
                    </div>
                  </div>
                </Link>
              );
              })}
            </div>

            {/* Load More Button */}
            {filteredArticles.length > visiblePosts && (
              <div className="text-center mt-12">
                <button
                  onClick={loadMore}
                  className="px-8 py-4 rounded-full text-white font-bold shadow-lg hover:shadow-xl transition-all duration-300 hover:scale-105"
                  style={{ backgroundColor: BLUE }}
                >
                  Load More Articles
                </button>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Animation Styles */}
      <style jsx>{`
        @keyframes slideInUp {
          from { opacity: 0; transform: translateY(30px); }
          to { opacity: 1; transform: translateY(0); }
        }

        @keyframes slideInLeft {
          from { opacity: 0; transform: translateX(-30px); }
          to { opacity: 1; transform: translateX(0); }
        }

        @keyframes slideInRight {
          from { opacity: 0; transform: translateX(30px); }
          to { opacity: 1; transform: translateX(0); }
        }

        .animate-slideInLeft {
          animation: slideInLeft 0.8s ease-out forwards;
        }

        .animate-slideInRight {
          animation: slideInRight 0.8s ease-out forwards;
        }

        .scroll-reveal {
          opacity: 0;
          transform: translateY(50px);
          transition: all 0.8s cubic-bezier(0.4, 0, 0.2, 1);
        }

        .scroll-reveal.visible {
          opacity: 1;
          transform: translateY(0);
        }

        .article-card {
          opacity: 1;
          transform: translateY(0);
          transition: all 0.8s cubic-bezier(0.4, 0, 0.2, 1);
        }

        .article-card.visible {
          opacity: 1;
          transform: translateY(0);
        }

        .line-clamp-3 {
          display: -webkit-box;
          -webkit-line-clamp: 3;
          -webkit-box-orient: vertical;
          overflow: hidden;
        }
      `}</style>

      {/* Footer */}
      <footer className="relative overflow-hidden py-16 text-[#999]" style={{ background: "linear-gradient(135deg, #000000 60%, #0c1c38 100%)" }}>
        <div className="max-w-[1200px] mx-auto px-6">
          <div className="grid md:grid-cols-4 gap-12 mb-12">
            <div className="md:col-span-2">
              <Image src="/logo_big_dark.png" alt="Mockr" width={140} height={40} className="h-8 w-auto mb-5" />
              <p className="max-w-xs text-sm leading-relaxed">The only AI-native interview preparation platform designed for the highest level of technical assessment.</p>
            </div>
            <div>
              <h4 className="text-white font-extrabold tracking-tight text-[16px] mb-5">Product</h4>
              <ul className="space-y-3 text-sm">
                <li><Link className="hover:text-white transition-colors" href="/#features">Features</Link></li>
                <li><Link className="hover:text-white transition-colors" href="/ai-mock-interview">Interviews</Link></li>
                <li><Link className="hover:text-white transition-colors" href="/interview-types">Interview Types</Link></li>
                <li><Link className="hover:text-white transition-colors" href="/interview-questions">Questions</Link></li>
                <li><Link className="hover:text-white transition-colors" href="/blog">Blog</Link></li>
                <li><Link className="hover:text-white transition-colors" href="/faq">FAQ</Link></li>

                <li><Link className="hover:text-white transition-colors" href="/#testimonials">Testimonials</Link></li>
              </ul>
            </div>
            <div>
              <h4 className="text-white font-extrabold tracking-tight text-[16px] mb-5">Company</h4>
              <ul className="space-y-3 text-sm">
                <li><Link className="hover:text-white transition-colors" href="/about">About Us</Link></li>
                <li><Link className="hover:text-white transition-colors" href="/careers">Careers</Link></li>
                <li><Link className="hover:text-white transition-colors" href="/privacy">Privacy Policy</Link></li>
                <li><Link className="hover:text-white transition-colors" href="/terms">Terms of Service</Link></li>
              </ul>
            </div>
          </div>
          <div className="pt-8 flex flex-col md:flex-row justify-between gap-4 items-center text-xs">
            <p>&copy; 2026 Mockr. All rights reserved.</p>
            <div className="flex gap-4">
              <a href="https://x.com/mockrrin?s=21" target="_blank" rel="noopener noreferrer" className="w-10 h-10 rounded-full bg-[#111] border border-[#222] flex items-center justify-center hover:-translate-y-1 transition-transform shadow-lg cursor-pointer">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="white">
                  <path d="M18.901 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.638 7.584H.474l8.6-9.83L0 1.154h7.594l5.243 6.932ZM17.61 20.644h2.039L6.486 3.24H4.298Z"/>
                </svg>
              </a>
              <a href="https://www.linkedin.com/company/mockrai/" target="_blank" rel="noopener noreferrer" className="w-10 h-10 rounded-full bg-[#111] border border-[#222] flex items-center justify-center hover:-translate-y-1 transition-transform shadow-lg cursor-pointer">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="white">
                  <path d="M19 0h-14c-2.761 0-5 2.239-5 5v14c0 2.761 2.239 5 5 5h14c2.762 0 5-2.239 5-5v-14c0-2.761-2.238-5-5-5zm-11 19h-3v-11h3v11zm-1.5-12.268c-.966 0-1.75-.79-1.75-1.764s.784-1.764 1.75-1.764 1.75.79 1.75 1.764-.783 1.764-1.75 1.764zm13.5 12.268h-3v-5.604c0-3.368-4-3.113-4 0v5.604h-3v-11h3v1.765c1.396-2.586 7-2.777 7 2.476v6.759z"/>
                </svg>
              </a>
              <a href="https://www.instagram.com/mockr.in?igsh=MWowM2RuYTM5NmVydQ%3D%3D&utm_source=qr" target="_blank" rel="noopener noreferrer" className="w-10 h-10 rounded-full bg-[#111] border border-[#222] flex items-center justify-center hover:-translate-y-1 transition-transform shadow-lg cursor-pointer">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="2" y="2" width="20" height="20" rx="5" ry="5"></rect>
                  <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"></path>
                  <line x1="17.5" y1="6.5" x2="17.51" y2="6.5"></line>
                </svg>
              </a>
            </div>
          </div>
        </div>
      </footer>
        </>
      )}
    </div>
  );
};

export default Blog;
