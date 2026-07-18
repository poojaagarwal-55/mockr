"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { useAuth } from "@/context/auth-context";

interface PublishModalProps {
  title: string;
  subtitle?: string;
  content: string;
  coverImage?: string;
  titleColor?: string;
  showAuthorName?: boolean;
  draftId?: string;
  parentPostId?: string;
  onClose: () => void;
}

export function PublishModal({ title, subtitle: initialSubtitle = "", content, coverImage, titleColor, showAuthorName: initialShowAuthorName = true, draftId, parentPostId, onClose }: PublishModalProps) {
  const router = useRouter();
  const { session } = useAuth();
  const [subtitle, setSubtitle] = useState(initialSubtitle);
  const [showAuthorName, setShowAuthorName] = useState(initialShowAuthorName);
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");
  const [isPublishing, setIsPublishing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Validate parentPostId - must be a valid non-empty string
  const isRepublishing = !!parentPostId && parentPostId.trim() !== "" && parentPostId !== "null" && parentPostId !== "undefined";

  const addTag = () => {
    if (tagInput.trim() && tags.length < 5 && !tags.includes(tagInput.trim())) {
      setTags([...tags, tagInput.trim()]);
      setTagInput("");
    }
  };

  const removeTag = (tagToRemove: string) => {
    setTags(tags.filter((tag) => tag !== tagToRemove));
  };

  const handlePublish = async () => {
    if (!session) {
      setError("You must be logged in to publish");
      return;
    }

    if (!title.trim()) {
      setError("Title is required");
      return;
    }

    if (content.length < 100) {
      setError("Content must be at least 100 characters");
      return;
    }

    if (!isRepublishing && tags.length === 0) {
      setError("At least one tag is required");
      return;
    }

    setIsPublishing(true);
    setError(null);

    try {
      if (isRepublishing) {
        // Republish: send full live editor content directly ΓÇö never rely on stale draft DB data
        const response = await api.post<{ slug: string }>(
          "/blog/republish",
          {
            draftId,
            parentPostId,
            title,
            subtitle,
            content,
            coverImage,
            titleColor,
            showAuthorName,
            tags: tags.length > 0 ? tags : undefined,
          },
          session.access_token
        );
        router.push(`/blog/${response.slug}`);
      } else {
        // Regular publish
        const response = await api.post<{ slug: string }>(
          "/blog/publish",
          {
            id: draftId,
            title,
            subtitle,
            content,
            coverImage,
            titleColor,
            showAuthorName,
            tags,
          },
          session.access_token
        );
        router.push(`/blog/${response.slug}`);
      }
    } catch (err: any) {
      setError(err.message || `Failed to ${isRepublishing ? 'republish' : 'publish'} blog post`);
      setIsPublishing(false);
    }
  };

  // Calculate read time
  const wordCount = content.split(/\s+/).length;
  const readTime = Math.max(1, Math.ceil(wordCount / 200));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-[600px] max-h-[90vh] overflow-y-auto bg-white dark:bg-[#1e1e1e] rounded-2xl shadow-2xl">
        <div className="p-6">
          {/* Header */}
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white">
              {isRepublishing ? "Republish Your Story" : "Publish Your Story"}
            </h2>
            <button
              onClick={onClose}
              className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-full transition-colors"
            >
              <span className="material-symbols-outlined text-gray-600 dark:text-gray-400">close</span>
            </button>
          </div>

          {error && (
            <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-sm text-red-700 dark:text-red-200 flex items-center gap-2">
              <span className="material-symbols-outlined text-lg">error</span>
              {error}
            </div>
          )}

          {/* Preview */}
          <div className="mb-6 p-4 bg-gray-50 dark:bg-gray-900 rounded-xl">
            <p className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-3">
              Story Preview
            </p>
            {coverImage && (
              <img
                src={coverImage}
                alt="Cover"
                className="w-full h-32 object-cover rounded-lg mb-3"
              />
            )}
            <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-1 line-clamp-2">
              {title || "Untitled"}
            </h3>
            {subtitle && (
              <p className="text-sm text-gray-600 dark:text-gray-400 line-clamp-2">{subtitle}</p>
            )}
            <div className="mt-3 flex items-center gap-3 text-xs text-gray-500 dark:text-gray-400">
              <span>{readTime} min read</span>
              <span>ΓÇó</span>
              <span>{wordCount} words</span>
            </div>
          </div>

          {/* Subtitle */}
          <div className="mb-6">
            <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
              Subtitle
            </label>
            <input
              type="text"
              value={subtitle}
              onChange={(e) => setSubtitle(e.target.value)}
              placeholder="This is auto-filled from your first paragraph if left blank"
              maxLength={300}
              className="w-full px-4 py-3 border border-gray-200 dark:border-gray-700 bg-white dark:bg-[#1a1a1a] rounded-lg focus:border-blue-500 focus:ring-2 focus:ring-blue-500 outline-none transition-colors text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-600"
            />
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{subtitle.length}/300</p>
          </div>

          {/* Tags */}
          <div className="mb-6 rounded-xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-900">
            <label className="flex cursor-pointer items-start gap-3">
              <input
                type="checkbox"
                checked={showAuthorName}
                onChange={(e) => setShowAuthorName(e.target.checked)}
                className="mt-1 h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <span>
                <span className="block text-sm font-semibold text-gray-800 dark:text-gray-200">
                  Show author name on the blog
                </span>
                <span className="mt-1 block text-xs text-gray-500 dark:text-gray-400">
                  When off, readers will only see the date and reading time.
                </span>
              </span>
            </label>
          </div>

          {/* Tags */}
          <div className="mb-6">
            <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
              Tags {isRepublishing ? "(Optional ΓÇö leave empty to keep existing)" : "(1-5 required)"}
            </label>
            <div className="flex gap-2 mb-3">
              <input
                type="text"
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyPress={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addTag();
                  }
                }}
                placeholder="Add a tag..."
                disabled={tags.length >= 5}
                className="flex-1 px-4 py-2 border border-gray-200 dark:border-gray-700 bg-white dark:bg-[#1a1a1a] rounded-lg focus:border-blue-500 focus:ring-2 focus:ring-blue-500 outline-none transition-colors text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-600 disabled:opacity-50"
              />
              <button
                onClick={addTag}
                disabled={!tagInput.trim() || tags.length >= 5}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Add
              </button>
            </div>
            <div className="flex flex-wrap gap-2">
              {tags.map((tag) => (
                <span
                  key={tag}
                  className="inline-flex items-center gap-1 px-3 py-1 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded-full text-sm font-medium"
                >
                  {tag}
                  <button
                    onClick={() => removeTag(tag)}
                    className="hover:text-blue-900 dark:hover:text-blue-100"
                  >
                    <span className="material-symbols-outlined text-sm">close</span>
                  </button>
                </span>
              ))}
            </div>
            {tags.length === 0 && !isRepublishing && (
              <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                Add at least one tag to help readers find your story
              </p>
            )}
            {tags.length === 0 && isRepublishing && (
              <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                Existing tags will be kept if left empty
              </p>
            )}
          </div>

          {/* Info Box */}
          <div className="mb-6 p-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
            <div className="flex items-start gap-3">
              <span className="material-symbols-outlined text-blue-600 dark:text-blue-400 text-xl">info</span>
              <div className="text-sm text-blue-900 dark:text-blue-200">
                <p className="font-semibold mb-1">
                  {isRepublishing ? "Ready to republish?" : "Ready to publish?"}
                </p>
                <p>
                  {isRepublishing 
                    ? "Your changes will be applied to the published post and visible to all readers immediately."
                    : "Your story will be visible to all readers. You can edit or unpublish it anytime."}
                </p>
              </div>
            </div>
          </div>

          {/* Actions */}
          <div className="flex gap-3">
            <button
              onClick={onClose}
              className="flex-1 px-6 py-3 border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300 rounded-full font-semibold hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handlePublish}
              disabled={isPublishing || !title.trim() || (!isRepublishing && tags.length === 0)}
              className={`flex-1 px-6 py-3 text-white rounded-full font-semibold transition-all shadow-lg disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 ${
                isRepublishing 
                  ? 'bg-gradient-to-r from-green-500 to-green-600 hover:from-green-600 hover:to-green-700'
                  : 'bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700'
              }`}
            >
              {isPublishing ? (
                <>
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  {isRepublishing ? "Republishing..." : "Publishing..."}
                </>
              ) : (
                <>
                  <span className="material-symbols-outlined text-xl">check_circle</span>
                  {isRepublishing ? "Republish Now" : "Publish Now"}
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
