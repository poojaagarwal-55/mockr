"use client";

import { MediumEditor } from "@/components/blog/MediumEditor";
import { useAuth } from "@/context/auth-context";
import { api } from "@/lib/api";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { BlogStorageService } from "@/lib/blog-storage";

export default function BlogEditorPage() {
  const { session } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialDraftId = searchParams.get("id");

  const [draftId, setDraftId] = useState<string | undefined>(initialDraftId || undefined);
  const [initialData, setInitialData] = useState<{
    title: string;
    subtitle?: string;
    content: string;
    coverImage: string;
    titleColor?: string;
    showAuthorName?: boolean;
    parentPostId?: string;
    loadedFromLocalStorage?: boolean;
  } | null>(null);
  const [isLoading, setIsLoading] = useState(!!initialDraftId);

  useEffect(() => {
    if (initialDraftId && session) {
      // Load draft from server
      api
        .get<{
          title: string;
          subtitle: string | null;
          content: string;
          coverImage: string | null;
          titleColor?: string | null;
          showAuthorName?: boolean | null;
          status: string;
          id?: string;
          parentPostId: string | null;
          updatedAt: string;
        }>(`/blog/drafts/${initialDraftId}`, session.access_token)
        .then((draft) => {
          // Check if there's a local version with newer changes
          const local = BlogStorageService.getDraft(initialDraftId);
          
          if (local && BlogStorageService.isLocalNewer(local, draft.updatedAt)) {
            // Local version is newer - user made offline changes
            setInitialData({
              title: local.title,
              subtitle: local.subtitle || "",
              content: local.content,
              coverImage: local.coverImage || "",
              titleColor: local.titleColor || "",
              showAuthorName: local.showAuthorName ?? draft.showAuthorName ?? true,
              parentPostId: draft.parentPostId || (draft.status === "published" ? initialDraftId : undefined),
              loadedFromLocalStorage: true, // Flag to trigger sync
            });
            // Don't clear localStorage - it has unsaved changes
          } else {
            // Server version is newer or same - use server
            setInitialData({
              title: draft.title,
              subtitle: draft.subtitle || "",
              content: draft.content,
              coverImage: draft.coverImage || "",
              titleColor: draft.titleColor || "",
              showAuthorName: draft.showAuthorName ?? true,
              parentPostId: draft.parentPostId || (draft.status === "published" ? initialDraftId : undefined),
            });
            
            // Clear localStorage only if server is newer
            // This means local changes were already synced
            if (local) {
              BlogStorageService.deleteDraft(initialDraftId);
            }
          }
          
          setIsLoading(false);
        })
        .catch((error) => {
          console.error("Failed to load draft:", error);
          
          // If server fails, try to load from localStorage as fallback
          const local = BlogStorageService.getDraft(initialDraftId);
          if (local) {
            console.log("[BlogEditor] Server failed, using localStorage backup");
            setInitialData({
              title: local.title,
              subtitle: local.subtitle || "",
              content: local.content,
              coverImage: local.coverImage || "",
              titleColor: local.titleColor || "",
              showAuthorName: local.showAuthorName ?? true,
            });
          }
          
          setIsLoading(false);
        });
    } else if (!initialDraftId) {
      // New draft - check if there's an unsaved local draft
      const local = BlogStorageService.getDraft(undefined);
      if (local) {
        setInitialData({
          title: local.title,
          subtitle: local.subtitle || "",
          content: local.content,
          coverImage: local.coverImage || "",
          titleColor: local.titleColor || "",
          showAuthorName: local.showAuthorName ?? true,
        });
      }
    }
  }, [initialDraftId, session]);

  const handleSave = async (data: {
    title: string;
    subtitle?: string;
    content: string;
    coverImage?: string;
    titleColor?: string;
    showAuthorName?: boolean;
    id?: string;
  }) => {
    if (!session) return;

    try {
      const response = await api.post<{ id: string; parentPostId?: string | null }>(
        "/blog/drafts",
        {
          id: data.id,
          title: data.title,
          subtitle: data.subtitle,
          content: data.content,
          coverImage: data.coverImage,
          titleColor: data.titleColor,
          showAuthorName: data.showAuthorName,
          tags: [],
        },
        session.access_token
      );

      // If this was a new draft (no id), update the draft ID and URL
      if (!data.id && response.id) {
        setDraftId(response.id);
        router.replace(`/blog/editor?id=${response.id}`);
        
        // Clear the "new" draft from localStorage since it now has an ID
        BlogStorageService.deleteDraft(undefined);
      } else if (data.id) {
        if (response.id && response.id !== data.id) {
          setDraftId(response.id);
          router.replace(`/blog/editor?id=${response.id}`);
          setInitialData((current) =>
            current
              ? {
                  ...current,
                  parentPostId: response.parentPostId || current.parentPostId,
                }
              : current
          );
          BlogStorageService.deleteDraft(response.id);
        }

        // Clear localStorage for this draft after successful server save
        BlogStorageService.deleteDraft(data.id);
      }
    } catch (error) {
      console.error("Failed to save draft:", error);
      // Don't throw - localStorage backup is still there
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
    <MediumEditor
      initialTitle={initialData?.title || ""}
      initialSubtitle={initialData?.subtitle || ""}
      initialContent={initialData?.content || ""}
      initialCoverImage={initialData?.coverImage || ""}
      initialTitleColor={initialData?.titleColor || ""}
      initialShowAuthorName={initialData?.showAuthorName ?? true}
      draftId={draftId || undefined}
      parentPostId={initialData?.parentPostId}
      loadedFromLocalStorage={initialData?.loadedFromLocalStorage}
      onSave={handleSave}
    />
  );
}
