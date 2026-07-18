"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/context/auth-context";
import { api } from "@/lib/api";
import Link from "next/link";
import { Calendar, Clock, Edit, Trash2, Eye } from "lucide-react";

interface BlogDraft {
  id: string;
  slug: string;
  title: string;
  subtitle: string | null;
  coverImage: string | null;
  content: string;
  status: string;
  tags: string[];
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
  hasDraftVersion: boolean;
  draftVersionId: string | null;
}

export default function MyBlogsPage() {
  const { session } = useAuth();
  const [posts, setPosts] = useState<BlogDraft[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!session) return;

    api
      .get<BlogDraft[]>("/blog/my-posts", session.access_token)
      .then((data) => {
        setPosts(data);
        setIsLoading(false);
      })
      .catch((err) => {
        setError(err.message || "Failed to load posts");
        setIsLoading(false);
      });
  }, [session]);

  const handleDelete = async (id: string, status: string) => {
    if (!session) return;
    const confirmMessage = status === "draft" 
      ? "Are you sure you want to delete this draft?" 
      : "Are you sure you want to delete this published post?";
    if (!confirm(confirmMessage)) return;

    try {
      await api.delete(`/blog/drafts/${id}`, session.access_token);
      setPosts(posts.filter((d) => d.id !== id));
    } catch (err: any) {
      alert(err.message || "Failed to delete post");
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="w-12 h-12 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#FAFBFC] dark:bg-lc-bg p-6">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">
              My Blogs
            </h1>
            <p className="text-gray-600 dark:text-gray-400">
              Manage your blog posts and drafts
            </p>
          </div>
          <Link
            href="/blog/editor"
            className="flex items-center gap-2 px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-semibold"
          >
            <Edit className="w-5 h-5" />
            Write New Post
          </Link>
        </div>

        {/* Error State */}
        {error && (
          <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4 mb-6">
            <p className="text-red-800 dark:text-red-200">{error}</p>
          </div>
        )}

        {/* Empty State */}
        {posts.length === 0 && !error && (
          <div className="text-center py-16">
            <div className="w-24 h-24 mx-auto mb-6 bg-gray-100 dark:bg-gray-800 rounded-full flex items-center justify-center">
              <Edit className="w-12 h-12 text-gray-400" />
            </div>
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
              No blog posts yet
            </h2>
            <p className="text-gray-600 dark:text-gray-400 mb-6">
              Start writing your first blog post to share your knowledge
            </p>
            <Link
              href="/blog/editor"
              className="inline-flex items-center gap-2 px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-semibold"
            >
              <Edit className="w-5 h-5" />
              Write Your First Post
            </Link>
          </div>
        )}

        {/* Posts Grid */}
        {posts.length > 0 && (
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {posts.map((post) => (
              <div
                key={post.id}
                className="bg-white dark:bg-lc-surface rounded-xl shadow-sm border border-gray-200 dark:border-lc-border overflow-hidden hover:shadow-md transition-shadow flex flex-col"
              >
                {/* Cover Image */}
                {post.coverImage && (
                  <div className="relative h-48 bg-gray-100 dark:bg-gray-800">
                    <img
                      src={post.coverImage}
                      alt={post.title}
                      className="w-full h-full object-cover"
                    />
                  </div>
                )}

                {/* Content */}
                <div className="p-5 flex flex-col flex-1">
                  {/* Status Badge */}
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <span className={`px-3 py-1 text-xs font-semibold rounded-full ${
                        post.status === "draft"
                          ? "bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-200"
                          : "bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-200"
                      }`}>
                        {post.status === "draft" ? "Draft" : "Published"}
                      </span>
                      {post.hasDraftVersion && (
                        <span className="px-2 py-1 text-xs font-semibold rounded-full bg-orange-100 dark:bg-orange-900/30 text-orange-800 dark:text-orange-200">
                          Pending Changes
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
                      <Clock className="w-4 h-4" />
                      {new Date(post.updatedAt).toLocaleDateString()}
                    </div>
                  </div>

                  {/* Title */}
                  <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-2 line-clamp-2">
                    {post.title || "Untitled"}
                  </h3>

                  {/* Subtitle */}
                  {post.subtitle && (
                    <p className="text-sm text-gray-600 dark:text-gray-400 mb-4 line-clamp-2">
                      {post.subtitle}
                    </p>
                  )}

                  {/* Tags */}
                  {post.tags && post.tags.length > 0 && (
                    <div className="flex flex-wrap gap-2 mb-4">
                      {post.tags.slice(0, 3).map((tag) => (
                        <span
                          key={tag}
                          className="px-2 py-1 bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-300 text-xs rounded"
                        >
                          {tag}
                        </span>
                      ))}
                      {post.tags.length > 3 && (
                        <span className="px-2 py-1 bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 text-xs rounded">
                          +{post.tags.length - 3}
                        </span>
                      )}
                    </div>
                  )}

                  {/* Spacer to push actions to bottom */}
                  <div className="flex-1"></div>

                  {/* Actions */}
                  <div className="flex items-center gap-2 pt-4 border-t border-gray-200 dark:border-gray-700">
                    <Link
                      href={`/blog/editor?id=${post.hasDraftVersion ? post.draftVersionId : post.id}`}
                      className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm font-semibold"
                    >
                      <Edit className="w-4 h-4" />
                      Edit
                    </Link>
                    {post.status === "published" && (
                      <Link
                        href={`/blog/${post.slug}`}
                        className="flex items-center justify-center gap-2 px-4 py-2 bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors text-sm font-semibold"
                      >
                        <Eye className="w-4 h-4" />
                      </Link>
                    )}
                    <button
                      onClick={() => handleDelete(post.id, post.status)}
                      className="flex items-center justify-center gap-2 px-4 py-2 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 rounded-lg hover:bg-red-100 dark:hover:bg-red-900/30 transition-colors text-sm font-semibold"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
