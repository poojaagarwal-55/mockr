"use client";

import { useState, useEffect } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase";
import { apiFetch } from "@/lib/api";

interface ImageUploadProps {
  onImageSelect: (url: string, caption?: string) => void;
  onClose: () => void;
  captionEnabled?: boolean;
}

export function ImageUpload({ onImageSelect, onClose, captionEnabled = true }: ImageUploadProps) {
  const [imageUrl, setImageUrl] = useState("");
  const [caption, setCaption] = useState("");
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [isOnline, setIsOnline] = useState(true);
  const [imageLoadError, setImageLoadError] = useState(false);
  const imageUrlHost = (() => {
    try {
      return imageUrl.trim() ? new URL(imageUrl).hostname : "";
    } catch {
      return "This image URL";
    }
  })();

  // Monitor online/offline status
  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    // Check initial status
    setIsOnline(navigator.onLine);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      // Validate file size (5MB max)
      if (file.size > 5 * 1024 * 1024) {
        setUploadError("File size must be less than 5MB");
        return;
      }

      // Validate file type
      const validTypes = ["image/jpeg", "image/jpg", "image/png", "image/gif", "image/webp"];
      if (!validTypes.includes(file.type)) {
        setUploadError("Only JPEG, PNG, GIF, and WebP images are allowed");
        return;
      }

      setUploadError(null);
      setImageFile(file);
      const reader = new FileReader();
      reader.onloadend = () => {
        setPreview(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleSubmit = async () => {
    console.log("[ImageUpload] handleSubmit called");
    console.log("[ImageUpload] imageUrl:", imageUrl);
    console.log("[ImageUpload] imageFile:", imageFile);
    
    setUploadError(null);

    // If user provided a URL, use it directly (no upload needed)
    if (imageUrl.trim()) {
      console.log("[ImageUpload] Processing URL:", imageUrl);
      // Validate URL format
      try {
        const url = new URL(imageUrl);
        console.log("[ImageUpload] URL parsed successfully:", url.href);
        // Check if it has a protocol (http or https)
        if (!url.protocol.startsWith('http')) {
          console.log("[ImageUpload] Invalid protocol:", url.protocol);
          setUploadError("URL must start with http:// or https://");
          return;
        }
        // Allow inserting even if preview failed - might work in blog
        console.log("[ImageUpload] Calling onImageSelect with URL:", imageUrl);
        onImageSelect(imageUrl, captionEnabled ? caption.trim() || undefined : undefined);
        console.log("[ImageUpload] onImageSelect called successfully");
        return;
      } catch (error) {
        console.error("[ImageUpload] URL parsing failed:", error);
        // If URL parsing fails, check if it's a relative URL
        if (imageUrl.startsWith('/')) {
          setUploadError("Please enter a complete URL starting with https://");
        } else {
          setUploadError("Please enter a valid URL");
        }
        return;
      }
    }

    // If user selected a file, check if online first
    if (imageFile) {
      // Check if online
      if (!navigator.onLine) {
        setUploadError("You're offline. Please connect to the internet to upload images, or use an external image URL instead.");
        return;
      }
      
      setIsUploading(true);
      
      // Online - upload through the API to Cloudflare R2
      try {
        const supabase = createSupabaseBrowserClient();
        const { data: sessionData } = await supabase.auth.getSession();

        if (!sessionData.session?.access_token) {
          setUploadError("You must be logged in to upload images");
          return;
        }

        const formData = new FormData();
        formData.append("image", imageFile);

        const result = await apiFetch<{ url: string }>("/blog/images", {
          method: "POST",
          body: formData,
          token: sessionData.session.access_token,
        });

        if (!result.url) {
          setUploadError("Failed to get image URL");
          return;
        }

        onImageSelect(result.url, captionEnabled ? caption.trim() || undefined : undefined);
      } catch (error: any) {
        console.error("Upload error:", error);
        setUploadError(error.message || "Failed to upload image");
      } finally {
        setIsUploading(false);
      }
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-md max-h-[90vh] overflow-y-auto bg-white dark:bg-[#1e1e1e] rounded-2xl shadow-2xl p-6">
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-xl font-bold text-gray-900 dark:text-white">Add Image</h3>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-full transition-colors"
          >
            <span className="material-symbols-outlined text-gray-600 dark:text-gray-400">close</span>
          </button>
        </div>

        {/* Error Message */}
        {uploadError && (
          <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
            <p className="text-sm text-red-600 dark:text-red-400">{uploadError}</p>
          </div>
        )}

        {/* Offline Warning */}
        {!isOnline && (
          <div className="mb-4 p-3 bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800 rounded-lg">
            <div className="flex items-start gap-2">
              <svg className="w-5 h-5 text-orange-600 dark:text-orange-400 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M23.64 7c-.45-.34-4.93-4-11.64-4-1.5 0-2.89.19-4.15.48L18.18 13.8 23.64 7zm-6.6 8.22L3.27 1.44 2 2.72l2.05 2.06C1.91 5.76.59 6.82.36 7l11.63 14.49.01.01.01-.01 3.9-4.86 3.32 3.32 1.27-1.27-3.46-3.46z"/>
              </svg>
              <div>
                <p className="text-sm font-medium text-orange-600 dark:text-orange-400">You're offline</p>
                <p className="text-xs text-orange-600 dark:text-orange-400 mt-1">
                  File uploads are disabled. You can use external image URLs instead.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* URL Input */}
        <div className="mb-4">
          <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
            Image URL
          </label>
          <input
            type="url"
            value={imageUrl}
            onChange={(e) => {
              const url = e.target.value;
              setImageUrl(url);
              setImageFile(null);
              setUploadError(null);
              setImageLoadError(false);
              
              // Show preview if URL looks valid
              if (url.trim()) {
                try {
                  new URL(url);
                  setPreview(url);
                } catch {
                  setPreview(null);
                }
              } else {
                setPreview(null);
              }
            }}
            placeholder="https://example.com/image.jpg"
            className="w-full px-4 py-3 border border-gray-200 dark:border-gray-700 bg-white dark:bg-[#1a1a1a] rounded-lg focus:border-blue-500 focus:ring-2 focus:ring-blue-500 outline-none transition-colors text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-600"
          />
        </div>

        {/* Divider */}
        <div className="relative my-6">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-gray-200 dark:border-gray-700" />
          </div>
          <div className="relative flex justify-center text-sm">
            <span className="px-4 bg-white dark:bg-[#1e1e1e] text-gray-500 dark:text-gray-400 font-medium">
              OR
            </span>
          </div>
        </div>

        {/* File Upload */}
        <div className="mb-6">
          <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
            Upload File
          </label>
          <div className="relative">
            <input
              type="file"
              accept="image/*"
              onChange={handleFileChange}
              className="hidden"
              id="image-upload"
            />
            <label
              htmlFor="image-upload"
              className="flex flex-col items-center justify-center w-full h-32 border-2 border-dashed border-gray-300 dark:border-gray-700 rounded-lg cursor-pointer hover:border-blue-500 dark:hover:border-blue-500 transition-colors bg-gray-50 dark:bg-gray-900"
            >
              <span className="material-symbols-outlined text-4xl text-gray-400 dark:text-gray-600 mb-2">
                cloud_upload
              </span>
              <span className="text-sm text-gray-600 dark:text-gray-400">
                Click to upload or drag and drop
              </span>
              <span className="text-xs text-gray-500 dark:text-gray-500 mt-1">
                PNG, JPG, GIF up to 5MB
              </span>
            </label>
          </div>
        </div>

        {captionEnabled && (
          <div className="mb-6">
            <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
              Image caption
            </label>
            <input
              type="text"
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              maxLength={180}
              placeholder="Add a short caption shown below the image"
              className="w-full px-4 py-3 border border-gray-200 dark:border-gray-700 bg-white dark:bg-[#1a1a1a] rounded-lg focus:border-blue-500 focus:ring-2 focus:ring-blue-500 outline-none transition-colors text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-600"
            />
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{caption.length}/180</p>
          </div>
        )}

        {/* Preview */}
        {(preview || imageUrl) && !imageLoadError && (
          <div className="mb-6">
            <p className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">Preview</p>
            <div className="relative">
              <img
                src={preview || imageUrl}
                alt="Preview"
                onError={(e) => {
                  console.log("[ImageUpload] Failed to load image preview");
                  setImageLoadError(true);
                }}
                onLoad={() => {
                  console.log("[ImageUpload] Image loaded successfully");
                  setImageLoadError(false);
                }}
                className="w-full h-48 object-cover rounded-lg border border-gray-200 dark:border-gray-700"
              />
              {captionEnabled && caption.trim() && (
                <p className="mt-3 text-center text-sm leading-relaxed text-gray-500 dark:text-gray-400">
                  {caption.trim()}
                </p>
              )}
            </div>
          </div>
        )}

        {/* Image Load Error - Premium CORS Warning */}
        {imageLoadError && imageUrl && (
          <div className="mb-4 relative overflow-hidden rounded-xl bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-900/50 dark:to-slate-800/50 border border-slate-200 dark:border-slate-700 shadow-sm">
            {/* Subtle gradient overlay */}
            <div className="absolute inset-0 bg-gradient-to-br from-orange-500/5 to-red-500/5 dark:from-orange-500/10 dark:to-red-500/10"></div>
            
            <div className="relative p-5">
              {/* Header with icon */}
              <div className="flex items-center gap-3 mb-3">
                <div className="flex-shrink-0 w-10 h-10 rounded-full bg-gradient-to-br from-orange-100 to-red-100 dark:from-orange-900/30 dark:to-red-900/30 flex items-center justify-center">
                  <svg className="w-5 h-5 text-orange-600 dark:text-orange-400" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                </div>
                <div className="flex-1">
                  <h4 className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                    Image Cannot Be Displayed
                  </h4>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                    {imageUrlHost}
                  </p>
                </div>
              </div>

              {/* Description */}
              <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed mb-4">
                This website restricts external access to their images. The image won't appear in your blog.
              </p>

              {/* Solutions - Clean card style */}
              <div className="bg-white/60 dark:bg-slate-900/40 backdrop-blur-sm rounded-lg p-4 border border-slate-200/50 dark:border-slate-700/50">
                <p className="text-xs font-semibold text-slate-700 dark:text-slate-300 mb-3 flex items-center gap-2">
                  <svg className="w-4 h-4 text-blue-500" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/>
                  </svg>
                  Recommended Solutions
                </p>
                <div className="space-y-2.5">
                  <div className="flex items-start gap-2.5">
                    <div className="w-1.5 h-1.5 rounded-full bg-blue-500 mt-1.5 flex-shrink-0"></div>
                    <div className="flex-1">
                      <p className="text-xs text-slate-700 dark:text-slate-300">
                        <span className="font-medium">Upload directly</span>
                        <span className="text-slate-500 dark:text-slate-400"> — Download and upload from your device</span>
                      </p>
                    </div>
                  </div>
                  <div className="flex items-start gap-2.5">
                    <div className="w-1.5 h-1.5 rounded-full bg-blue-500 mt-1.5 flex-shrink-0"></div>
                    <div className="flex-1">
                      <p className="text-xs text-slate-700 dark:text-slate-300">
                        <span className="font-medium">Use image hosting</span>
                        <span className="text-slate-500 dark:text-slate-400"> — Try Imgur, Cloudinary, or Unsplash</span>
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="sticky bottom-0 -mx-6 -mb-6 mt-2 flex gap-3 border-t border-gray-200 bg-white/95 p-6 backdrop-blur dark:border-gray-700 dark:bg-[#1e1e1e]/95">
          <button
            onClick={onClose}
            className="flex-1 px-6 py-3 border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300 rounded-full font-semibold hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={(!imageUrl && !preview) || isUploading || imageLoadError}
            className="flex-1 px-6 py-3 bg-blue-600 text-white rounded-full font-semibold hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {isUploading ? (
              <>
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                <span>Uploading...</span>
              </>
            ) : imageLoadError ? (
              <>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
                </svg>
                <span>Unable to Insert</span>
              </>
            ) : (
              "Insert Image"
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
