"use client";

import { useEditor, EditorContent } from "@tiptap/react";
import { Node } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import Link from "@tiptap/extension-link";
import TextStyle from "@tiptap/extension-text-style";
import { Color } from "@tiptap/extension-color";
import Underline from "@tiptap/extension-underline";
import { Table } from "@tiptap/extension-table";
import { TableRow } from "@tiptap/extension-table-row";
import { TableCell } from "@tiptap/extension-table-cell";
import { TableHeader } from "@tiptap/extension-table-header";
import { useEffect, useState, useCallback, useRef } from "react";
import { PublishModal } from "./PublishModal";
import { ImageUpload } from "./ImageUpload";
import NextLink from "next/link";
import { BlogStorageService } from "@/lib/blog-storage";
import { useTheme } from "next-themes";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneLight } from "react-syntax-highlighter/dist/esm/styles/prism";
import { vscDarkPlus } from "react-syntax-highlighter/dist/esm/styles/prism";
import { apiFetch } from "@/lib/api";
import { createSupabaseBrowserClient } from "@/lib/supabase";

/* ΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉ Types & Interfaces ΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉ */

interface ColorPalette {
  name: string;
  light: string;
  dark: string;
  variable: string;
  class: string;
}

interface FloatingToolbarPosition {
  top: number;
  left: number;
}

interface MediumEditorProps {
  initialContent?: string;
  initialTitle?: string;
  initialSubtitle?: string;
  initialCoverImage?: string;
  initialTitleColor?: string;
  initialShowAuthorName?: boolean;
  draftId?: string;
  parentPostId?: string;
  loadedFromLocalStorage?: boolean;
  onSave?: (data: { title: string; subtitle?: string; content: string; coverImage?: string; titleColor?: string; showAuthorName?: boolean; id?: string }) => void;
}

/* ΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉ Constants ΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉ */

const PROGRAMMING_LANGUAGES = [
  'javascript', 'typescript', 'python', 'java', 'cpp', 'c', 'csharp',
  'php', 'ruby', 'go', 'rust', 'swift', 'kotlin', 'html', 'css',
  'sql', 'bash', 'json', 'xml', 'yaml', 'markdown'
];

/* ΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉ Utility Functions ΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉ */

const normalizeSubtitle = (text: string): string => text.replace(/\s+/g, ' ').trim().slice(0, 300);

const createAutoSubtitle = (html: string, title: string): string => {
  if (typeof window === "undefined" || !html) return "";

  const doc = new DOMParser().parseFromString(html, "text/html");
  const candidates = Array.from(doc.body.querySelectorAll("p, blockquote, li"))
    .map((node) => normalizeSubtitle(node.textContent || ""))
    .filter(Boolean);

  const subtitle = candidates.find((text) => text.toLowerCase() !== title.trim().toLowerCase());
  return subtitle || "";
};

const isThemeBreakingColor = (value: string): boolean => {
  const color = value.trim().toLowerCase().replace(/\s*!important\s*$/, "");
  if (!color) return false;

  if (["black", "white", "#000", "#000000", "#fff", "#ffffff"].includes(color)) {
    return true;
  }

  const rgbMatch = color.match(/^rgba?\(([^)]+)\)$/);
  if (rgbMatch) {
    const [r, g, b, a = "1"] = rgbMatch[1]
      .split(",")
      .map((part) => part.trim().replace("%", ""));

    const channels = [r, g, b].map(Number);
    const alpha = Number(a);
    if (channels.some(Number.isNaN) || Number.isNaN(alpha) || alpha === 0) return false;

    return channels.every((channel) => channel <= 8) || channels.every((channel) => channel >= 247);
  }

  const hslMatch = color.match(/^hsla?\(([^)]+)\)$/);
  if (hslMatch) {
    const parts = hslMatch[1].split(",").map((part) => part.trim());
    const lightness = Number(parts[2]?.replace("%", ""));
    const alpha = parts[3] === undefined ? 1 : Number(parts[3]);
    if (Number.isNaN(lightness) || Number.isNaN(alpha) || alpha === 0) return false;

    return lightness <= 4 || lightness >= 96;
  }

  return false;
};

const normalizePastedHtmlColors = (html: string): string => {
  if (typeof window === "undefined" || !html) return html;

  const doc = new DOMParser().parseFromString(html, "text/html");
  doc.body.querySelectorAll<HTMLElement>("[style]").forEach((element) => {
    const color = element.style.color;
    if (color && isThemeBreakingColor(color)) {
      element.style.removeProperty("color");
    }

    if (!element.getAttribute("style")?.trim()) {
      element.removeAttribute("style");
    }
  });

  return doc.body.innerHTML;
};

const createColorPalette = (): ColorPalette[] => [
  { name: 'Ink', light: '#1f2933', dark: '#f4f1ea', variable: 'var(--blog-default)', class: 'text-default' },
  { name: 'Slate', light: '#52606d', dark: '#c7ced6', variable: 'var(--blog-gray)', class: 'text-gray' },
  { name: 'Blue', light: '#2f5d8c', dark: '#8fb7df', variable: 'var(--blog-primary)', class: 'text-primary' },
  { name: 'Forest', light: '#3f6b57', dark: '#9bbfac', variable: 'var(--blog-success)', class: 'text-success' },
  { name: 'Olive', light: '#6f7652', dark: '#c3c99f', variable: 'var(--blog-lime)', class: 'text-lime' },
  { name: 'Navy', light: '#243b6b', dark: '#9db2e5', variable: 'var(--blog-indigo)', class: 'text-indigo' },
];

/* ΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉ CodeBlock Component ΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉ */

const BlogImage = Node.create({
  name: "image",
  group: "block",
  atom: true,
  draggable: true,
  selectable: true,

  addAttributes() {
    return {
      src: {
        default: null,
        parseHTML: (element) => {
          if (element.tagName.toLowerCase() === "figure") {
            return element.querySelector("img")?.getAttribute("src") || null;
          }

          return element.getAttribute("src");
        },
      },
      alt: {
        default: null,
        parseHTML: (element) => {
          if (element.tagName.toLowerCase() === "figure") {
            return element.querySelector("img")?.getAttribute("alt") || null;
          }

          return element.getAttribute("alt");
        },
      },
      title: {
        default: null,
        parseHTML: (element) => {
          if (element.tagName.toLowerCase() === "figure") {
            return element.querySelector("img")?.getAttribute("title") || null;
          }

          return element.getAttribute("title");
        },
      },
      caption: {
        default: null,
        parseHTML: (element) => {
          if (element.tagName.toLowerCase() === "figure") {
            return element.querySelector("figcaption")?.textContent?.trim() || null;
          }

          return element.getAttribute("data-caption") || element.getAttribute("title") || null;
        },
        renderHTML: (attributes) => {
          if (!attributes.caption) return {};
          return {
            "data-caption": attributes.caption,
          };
        },
      },
    };
  },

  parseHTML() {
    return [
      { tag: 'figure[data-type="image"]' },
      { tag: "img[src]" },
    ];
  },

  renderHTML({ node, HTMLAttributes }) {
    const caption = node.attrs.caption;
    const { caption: _caption, class: className, ...imageAttributes } = HTMLAttributes;
    const imageClass = [className, "rounded-lg"].filter(Boolean).join(" ");
    const figureChildren: any[] = [
      "figure",
      { "data-type": "image", class: "blog-image-figure" },
      ["img", { ...imageAttributes, class: imageClass, "data-caption": caption || undefined }],
    ];

    if (caption) {
      figureChildren.push(["figcaption", { class: "blog-image-caption" }, caption]);
    }

    return figureChildren as any;
  },
});

const CodeBlock = ({ node, updateAttributes, deleteNode }: any) => {
  const [language, setLanguage] = useState(node?.attrs?.language || 'javascript');
  const [code, setCode] = useState(node?.textContent || '');
  const [isEditing, setIsEditing] = useState(false);
  const { resolvedTheme } = useTheme();

  const handleSave = useCallback(() => {
    if (updateAttributes) {
      updateAttributes({ language, code });
    }
    setIsEditing(false);
  }, [updateAttributes, language, code]);

  const handleCancel = useCallback(() => {
    setIsEditing(false);
  }, []);

  const handleDelete = useCallback(() => {
    if (deleteNode) {
      deleteNode();
    }
  }, [deleteNode]);

  if (isEditing) {
    return (
      <div className="border border-gray-300 dark:border-gray-600 rounded-lg p-4 my-4">
        <div className="flex items-center gap-2 mb-3">
          <select
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
            className="px-3 py-1 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
          >
            {PROGRAMMING_LANGUAGES.map(lang => (
              <option key={lang} value={lang}>{lang}</option>
            ))}
          </select>
          <button
            onClick={handleSave}
            className="px-3 py-1 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors"
          >
            Save
          </button>
          <button
            onClick={handleCancel}
            className="px-3 py-1 bg-gray-600 text-white rounded hover:bg-gray-700 transition-colors"
          >
            Cancel
          </button>
          {deleteNode && (
            <button
              onClick={handleDelete}
              className="px-3 py-1 bg-red-600 text-white rounded hover:bg-red-700 transition-colors"
            >
              Delete
            </button>
          )}
        </div>
        <textarea
          value={code}
          onChange={(e) => setCode(e.target.value)}
          className="w-full h-40 p-3 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-white font-mono text-sm resize-vertical"
          placeholder="Enter your code here..."
        />
      </div>
    );
  }

  return (
    <div className="relative group my-4">
      <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity z-10">
        <button
          onClick={() => setIsEditing(true)}
          className="px-2 py-1 bg-gray-800 text-white text-xs rounded hover:bg-gray-700 transition-colors"
        >
          Edit
        </button>
      </div>
      <SyntaxHighlighter
        language={language}
        style={resolvedTheme === 'dark' ? vscDarkPlus : oneLight}
        customStyle={{
          margin: 0,
          borderRadius: '0.5rem',
          fontSize: '0.875rem',
        }}
        showLineNumbers={true}
        wrapLines={true}
      >
        {code || '// Enter your code here'}
      </SyntaxHighlighter>
    </div>
  );
};

/* ΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉ Main Component ΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉ */

export function MediumEditor({ 
  initialContent = "", 
  initialTitle = "", 
  initialSubtitle = "",
  initialCoverImage = "", 
  initialTitleColor = "", 
  initialShowAuthorName = true,
  draftId, 
  parentPostId, 
  loadedFromLocalStorage = false, 
  onSave 
}: MediumEditorProps) {
  const { resolvedTheme } = useTheme();
  
  /* ΓöÇΓöÇΓöÇ State Management ΓöÇΓöÇΓöÇ */
  const [title, setTitle] = useState(initialTitle);
  const [subtitle, setSubtitle] = useState(initialSubtitle);
  const [coverImage, setCoverImage] = useState(initialCoverImage);
  const [titleColor] = useState<string>(initialTitleColor);
  const [showAuthorName] = useState(initialShowAuthorName);
  const [wordCount, setWordCount] = useState(0);
  
  /* ΓöÇΓöÇΓöÇ UI State ΓöÇΓöÇΓöÇ */
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [showFloatingToolbar, setShowFloatingToolbar] = useState(false);
  const [showTableControls, setShowTableControls] = useState(false);
  const [floatingToolbarPosition, setFloatingToolbarPosition] = useState<FloatingToolbarPosition>({ top: 0, left: 0 });
  const [showPublishModal, setShowPublishModal] = useState(false);
  const [showImageUpload, setShowImageUpload] = useState(false);
  const [imageUploadMode, setImageUploadMode] = useState<'cover' | 'content'>('content');
  
  /* ΓöÇΓöÇΓöÇ Save State ΓöÇΓöÇΓöÇ */
  const [isSaving, setIsSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [isOnline, setIsOnline] = useState(true);
  const [hasLoadedWithOfflineChanges, setHasLoadedWithOfflineChanges] = useState(false);
  
  /* ΓöÇΓöÇΓöÇ Refs ΓöÇΓöÇΓöÇ */
  const isSavingRef = useRef(false);
  const saveTimerRef = useRef<NodeJS.Timeout | null>(null);
  const hasTriggeredInitialSyncRef = useRef(false);
  const floatingToolbarRef = useRef<HTMLDivElement>(null);
  const titleInputRef = useRef<HTMLTextAreaElement>(null);
  const subtitleInputRef = useRef<HTMLTextAreaElement>(null);

  /* ΓöÇΓöÇΓöÇ Constants ΓöÇΓöÇΓöÇ */
  const colorPalette = createColorPalette();

  useEffect(() => {
    const resizeTextarea = (element: HTMLTextAreaElement | null) => {
      if (!element) return;
      element.style.height = "auto";
      element.style.height = `${element.scrollHeight}px`;
    };

    resizeTextarea(titleInputRef.current);
    resizeTextarea(subtitleInputRef.current);
  }, [title, subtitle]);

  /* ΓöÇΓöÇΓöÇ Utility Functions ΓöÇΓöÇΓöÇ */
  const getCurrentColor = useCallback((colorName: string) => {
    const color = colorPalette.find(c => c.name === colorName);
    if (!color) return resolvedTheme === 'dark' ? '#ffffff' : '#000000';
    return resolvedTheme === 'dark' ? color.dark : color.light;
  }, [colorPalette, resolvedTheme]);

  const getStatusText = useCallback(() => {
    if (!isOnline) return "Offline - Saved locally";
    if (isSaving) return "Saving...";
    if (hasUnsavedChanges) return "Unsaved changes";
    if (lastSaved) {
      const now = new Date();
      const diff = Math.floor((now.getTime() - lastSaved.getTime()) / 1000);
      if (diff < 60) return "Saved just now";
      if (diff < 3600) return `Saved ${Math.floor(diff / 60)} min ago`;
      return `Saved ${Math.floor(diff / 3600)} hr ago`;
    }
    return "";
  }, [isOnline, isSaving, hasUnsavedChanges, lastSaved]);

  /* ΓöÇΓöÇΓöÇ Editor Configuration ΓöÇΓöÇΓöÇ */

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: {
          levels: [2, 3],
        },
      }),
      Placeholder.configure({
        placeholder: "Tell your story...",
      }),
      BlogImage.configure({
        inline: false,
        allowBase64: true,
        HTMLAttributes: {
          class: 'rounded-lg',
        },
      }),
      Link.configure({
        openOnClick: false,
      }),
      TextStyle,
      Color.configure({ types: ['textStyle'] }),
      // @ts-ignore
      Underline.configure(),
      // @ts-ignore
      Table.configure({
        resizable: true,
      }),
      // @ts-ignore
      TableRow,
      // @ts-ignore
      TableHeader,
      // @ts-ignore
      TableCell,
    ] as any,
    content: initialContent,
    editorProps: {
      attributes: {
        class: "prose prose-xl max-w-none focus:outline-none min-h-[500px] px-4",
      },
      handleKeyDown: (view, event) => {
        const selection = view.state.selection as any;
        const isTypingText =
          event.key.length === 1 &&
          !event.ctrlKey &&
          !event.metaKey &&
          !event.altKey;

        if (selection.node?.type?.name === "image" && isTypingText) {
          event.preventDefault();

          const paragraph = view.state.schema.nodes.paragraph.create();
          const tr = view.state.tr
            .insert(selection.to, paragraph)
            .insertText(event.key, selection.to + 1);

          view.dispatch(tr.scrollIntoView());
          return true;
        }

        if (selection.node?.type?.name === "image" && event.key === "Enter") {
          event.preventDefault();

          const paragraph = view.state.schema.nodes.paragraph.create();
          const tr = view.state.tr.insert(selection.to, paragraph);
          view.dispatch(tr.scrollIntoView());
          return true;
        }

        // Handle Tab key for indentation
        if (event.key === 'Tab') {
          event.preventDefault();
          
          const { state, dispatch } = view;
          const { selection } = state;
          const { $from } = selection;
          
          // Check if we're in a list
          const inList = $from.node(-1)?.type.name === 'listItem';
          
          if (inList) {
            // For lists, we'll handle this after editor is created
            return false;
          } else {
            // Not in a list - insert tab character or spaces
            const transaction = state.tr.insertText(event.shiftKey ? '' : '\t');
            dispatch(transaction);
            return true;
          }
        }

        // Handle Enter key in headings to always transition to paragraph
        if (event.key === 'Enter' && !event.shiftKey) {
          const { state } = view;
          const { selection } = state;
          const { $from, empty } = selection;
          
          if (empty && $from.parent.type.name === 'heading') {
            // If cursor is at the end of the heading, insert a paragraph below
            if ($from.parentOffset === $from.parent.content.size) {
              // We use setTimeout to let the default Enter behavior happen if needed, 
              // or we can just override it completely. 
              // Overriding completely is safer for this requirement.
              event.preventDefault();
              editor?.chain()
                .focus()
                .insertContentAt($from.after(), { type: 'paragraph' })
                .setTextSelection($from.after() + 1)
                .run();
              return true;
            }
          }
        }
        
        return false;
      },
      handlePaste: (view, event) => {
        const items = event.clipboardData?.items;
        if (!items) return false;
        
        let handled = false;
        for (const item of Array.from(items)) {
          if (item.type.indexOf("image") === 0) {
            const file = item.getAsFile();
            if (file) {
              if (file.size > 5 * 1024 * 1024) {
                alert("File size must be less than 5MB");
                return true;
              }
              handled = true;
              
              // Prompt for caption (optional)
              const caption = window.prompt("Image caption (optional):")?.trim() || null;
              
              (async () => {
                try {
                  const supabase = createSupabaseBrowserClient();
                  const { data: sessionData } = await supabase.auth.getSession();
                  if (!sessionData.session?.access_token) {
                    alert("You must be logged in to upload images");
                    return;
                  }
                  
                  const formData = new FormData();
                  formData.append("image", file);
                  
                  const result = await apiFetch<{ url: string }>("/blog/images", {
                    method: "POST",
                    body: formData,
                    token: sessionData.session.access_token,
                  });
                  
                  if (result?.url) {
                    const { schema } = view.state;
                    const imageNode = schema.nodes.image.create({ src: result.url, caption });
                    const paragraphNode = schema.nodes.paragraph.create();
                    const transaction = view.state.tr.replaceSelectionWith(imageNode, false);
                    transaction.insert(transaction.selection.to, paragraphNode);
                    view.dispatch(transaction);
                  } else {
                    alert("Failed to upload pasted image: No URL returned");
                  }
                } catch (error: any) {
                  console.error("Paste upload error:", error);
                  alert(error.message || "Failed to upload pasted image");
                }
              })();
            }
          }
        }
        return handled;
      },
      handleDrop: (view, event) => {
        const files = Array.from(event.dataTransfer?.files || []);
        const imageFiles = files.filter(file => file.type.indexOf("image") === 0);
        if (imageFiles.length === 0) return false;

        event.preventDefault();

        for (const file of imageFiles) {
          if (file.size > 5 * 1024 * 1024) {
            alert("File size must be less than 5MB");
            continue;
          }

          const caption = window.prompt("Image caption (optional):")?.trim() || null;

          (async () => {
            try {
              const supabase = createSupabaseBrowserClient();
              const { data: sessionData } = await supabase.auth.getSession();
              if (!sessionData.session?.access_token) {
                alert("You must be logged in to upload images");
                return;
              }

              const formData = new FormData();
              formData.append("image", file);

              const result = await apiFetch<{ url: string }>("/blog/images", {
                method: "POST",
                body: formData,
                token: sessionData.session.access_token,
              });

              if (result?.url) {
                const { schema } = view.state;
                const imageNode = schema.nodes.image.create({ src: result.url, caption });
                const paragraphNode = schema.nodes.paragraph.create();

                const transaction = view.state.tr.replaceSelectionWith(imageNode, false);
                transaction.insert(transaction.selection.to, paragraphNode);
                view.dispatch(transaction);
              } else {
                alert("Failed to upload dropped image: No URL returned");
              }
            } catch (error: any) {
              console.error("Drop upload error:", error);
              alert(error.message || "Failed to upload dropped image");
            }
          })();
        }

        return true;
      },
      transformPastedHTML: (html) => normalizePastedHtmlColors(html),
    },
    onUpdate: ({ editor: ed }) => {
      setHasUnsavedChanges(true);
      const text = ed.getText();
      const words = text.trim() ? text.trim().split(/\s+/).length : 0;
      setWordCount(words);
    },
    onSelectionUpdate: ({ editor: ed }) => {
      if (!ed || ed.isDestroyed) return;
      
      try {
        // Show floating toolbar when text is selected
        const { from, to } = ed.state.selection;
        const hasSelection = from !== to;
        
        if (hasSelection) {
          setShowFloatingToolbar(true);
          // Position the floating toolbar near the selection
          const { view } = ed;
          try {
            const start = view.coordsAtPos(from);
            const end = view.coordsAtPos(to);
            
            // Calculate center position above the selection
            const left = (start.left + end.left) / 2;
            const top = start.top - 60; // 60px above the selection
            
            setFloatingToolbarPosition({ top, left });
          } catch (error) {
            // Fallback positioning if coordsAtPos fails
            setFloatingToolbarPosition({ top: 100, left: 200 });
          }
        } else {
          setShowFloatingToolbar(false);
        }
      } catch (error) {
        console.warn("Selection update error:", error);
      }
    },
  });

  /* ΓöÇΓöÇΓöÇ Effects ΓöÇΓöÇΓöÇ */
  
  useEffect(() => {
    if (!showFloatingToolbar) {
      // Any cleanup when floating toolbar closes
    }
  }, [showFloatingToolbar]);

  // Close table controls when table is no longer active
  useEffect(() => {
    if (!editor?.isActive("table")) {
      setShowTableControls(false);
    }
  }, [editor?.isActive("table")]);

  // Close table controls on Escape key
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && showTableControls) {
        setShowTableControls(false);
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [showTableControls]);

  /* ΓöÇΓöÇΓöÇ Save Functions ΓöÇΓöÇΓöÇ */
  
  // Autosave functionality - saves to both server and localStorage
  const saveContent = useCallback(async () => {
    if (!editor || isSavingRef.current) return;

    const content = editor.getHTML();
    const resolvedSubtitle = subtitle.trim() || createAutoSubtitle(content, title);
    
    // Don't save if content is empty
    if (!title.trim() && content === "<p></p>") {
      return;
    }

    isSavingRef.current = true;
    setIsSaving(true);

    try {
      // Save to localStorage first (instant backup)
      BlogStorageService.saveDraft(draftId, {
        id: draftId,
        title,
        subtitle: resolvedSubtitle,
        content,
        coverImage,
        titleColor,
        showAuthorName,
      });

      // Then save to server (only if online)
      if (isOnline && onSave) {
        await onSave({
          title,
          subtitle: resolvedSubtitle,
          content,
          coverImage,
          titleColor,
          showAuthorName,
          id: draftId,
        });
        
        // Clear localStorage after successful server save
        // Server is now the source of truth
        if (draftId) {
          BlogStorageService.deleteDraft(draftId);
        }
        
        setLastSaved(new Date());
        setHasUnsavedChanges(false);
        setHasLoadedWithOfflineChanges(false); // Clear the flag after successful sync
      } else if (!isOnline) {
        // Offline - saved to localStorage only
        // Keep hasUnsavedChanges as true so we know to sync when back online
        console.log("[BlogEditor] Offline - saved to localStorage only");
        // Don't set hasUnsavedChanges to false - we still need to sync to server
      }
    } catch (error) {
      console.error("Failed to save:", error);
      // Even if server save fails, localStorage backup is still there
      // Keep hasUnsavedChanges as true so we retry
    } finally {
      setIsSaving(false);
      isSavingRef.current = false;
    }
  }, [editor, title, subtitle, coverImage, titleColor, showAuthorName, draftId, isOnline, onSave]);

  /* ΓöÇΓöÇΓöÇ Image Functions ΓöÇΓöÇΓöÇ */
  
  const addImage = useCallback((url: string, caption?: string) => {
    console.log("[MediumEditor] addImage called with URL:", url);
    if (editor) {
      console.log("[MediumEditor] Editor exists, inserting image...");
      try {
        editor
          .chain()
          .focus()
          .insertContent([
            { type: "image", attrs: { src: url, caption: caption || null } },
            { type: "paragraph" },
          ])
          .run();
        console.log("[MediumEditor] Image inserted successfully");
        setHasUnsavedChanges(true);
      } catch (error) {
        console.error("[MediumEditor] Failed to insert image:", error);
      }
    } else {
      console.error("[MediumEditor] Editor is null, cannot insert image");
    }
  }, [editor]);

  // Debounced autosave - waits 1 second after user stops typing
  useEffect(() => {
    if (!hasUnsavedChanges) return;

    // Clear existing timer
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
    }

    // Set new timer for 1 second
    saveTimerRef.current = setTimeout(() => {
      saveContent();
    }, 1000);

    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
      }
    };
  }, [hasUnsavedChanges, title, subtitle, coverImage, titleColor, saveContent]);

  // Monitor online/offline status
  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      console.log("[BlogEditor] Back online - syncing...");
      // Trigger save when coming back online
      if (hasUnsavedChanges || hasLoadedWithOfflineChanges) {
        saveContent();
      }
    };

    const handleOffline = () => {
      setIsOnline(false);
      console.log("[BlogEditor] Offline - saving to localStorage only");
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    // Check initial status
    setIsOnline(navigator.onLine);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [hasUnsavedChanges, hasLoadedWithOfflineChanges, saveContent]);

  // Check if we loaded with offline changes and trigger sync
  useEffect(() => {
    if (!editor || !draftId || !isOnline || hasTriggeredInitialSyncRef.current) return;
    
    // Check if we were explicitly told we loaded from localStorage
    if (loadedFromLocalStorage) {
      console.log("[BlogEditor] Loaded from localStorage, syncing to server...");
      hasTriggeredInitialSyncRef.current = true;
      setHasLoadedWithOfflineChanges(true);
      setHasUnsavedChanges(true);
      // Trigger save after a short delay to ensure editor is ready
      setTimeout(() => {
        saveContent();
      }, 500);
      return;
    }
    
    // Also check localStorage directly as fallback
    const local = BlogStorageService.getDraft(draftId);
    if (local && local.version > 0) {
      // We have local changes, trigger immediate sync
      console.log("[BlogEditor] Detected offline changes in localStorage, syncing to server...");
      hasTriggeredInitialSyncRef.current = true;
      setHasLoadedWithOfflineChanges(true);
      setHasUnsavedChanges(true);
      // Trigger save after a short delay to ensure editor is ready
      setTimeout(() => {
        saveContent();
      }, 500);
    }
  }, [editor, draftId, isOnline, loadedFromLocalStorage, saveContent]);

  // Save to localStorage on every change (instant backup)
  useEffect(() => {
    if (!editor) return;

    const handleUpdate = () => {
      const content = editor.getHTML();
      const resolvedSubtitle = subtitle.trim() || createAutoSubtitle(content, title);
      
      // Save to localStorage immediately (no debounce for local backup)
      if (title.trim() || content !== "<p></p>") {
        BlogStorageService.saveDraft(draftId, {
          id: draftId,
          title,
          subtitle: resolvedSubtitle,
          content,
          coverImage,
          titleColor,
          showAuthorName,
        });
      }
    };

    // Listen to editor updates
    editor.on("update", handleUpdate);

    return () => {
      editor.off("update", handleUpdate);
    };
  }, [title, subtitle, coverImage, titleColor, showAuthorName, draftId, editor]);

  // Save on page leave, tab close, or browser close
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (hasUnsavedChanges && !isSavingRef.current) {
        // Save synchronously before page unload
        saveContent();
        
        // Show browser warning
        e.preventDefault();
        e.returnValue = "";
      }
    };

    const handleVisibilityChange = () => {
      if (document.hidden && hasUnsavedChanges && !isSavingRef.current) {
        // Save when tab becomes hidden
        saveContent();
      }
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [hasUnsavedChanges, saveContent]);

  /* ΓöÇΓöÇΓöÇ Early Return for Loading State ΓöÇΓöÇΓöÇ */

  if (!editor) {
    return (
      <div className="absolute inset-0 bg-white dark:bg-[#1a1a1a] flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="absolute inset-0 bg-white dark:bg-[#1a1a1a] overflow-y-auto">
      {/* Clean Minimal Toolbar - Sticky */}
      <div className="sticky top-0 z-50 bg-white dark:bg-[#1a1a1a] border-b border-gray-200 dark:border-gray-800 shadow-sm">
        <div className="max-w-6xl mx-auto px-6 py-2.5 flex items-center justify-between gap-3">
          {/* Left: Back + Undo/Redo + Formatting Tools */}
          <div className="flex items-center gap-1 flex-1 justify-center">
            {/* Back Button */}
            <NextLink
              href="/blog/my-blogs"
              className="px-3 py-1.5 rounded-lg transition-all duration-150 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"
              title="Back to My Blogs"
            >
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                <path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"/>
              </svg>
            </NextLink>

            {/* Separator */}
            <div className="w-px h-6 bg-gray-200 dark:bg-gray-700 mx-1"></div>

            {/* Undo */}
            <button
              onClick={() => editor.chain().focus().undo().run()}
              disabled={!editor.can().undo()}
              className="px-3 py-1.5 rounded-lg transition-all duration-150 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-30 disabled:cursor-not-allowed"
              title="Undo"
            >
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12.5 8c-2.65 0-5.05.99-6.9 2.6L2 7v9h9l-3.62-3.62c1.39-1.16 3.16-1.88 5.12-1.88 3.54 0 6.55 2.31 7.6 5.5l2.37-.78C21.08 11.03 17.15 8 12.5 8z"/>
              </svg>
            </button>

            {/* Redo */}
            <button
              onClick={() => editor.chain().focus().redo().run()}
              disabled={!editor.can().redo()}
              className="px-3 py-1.5 rounded-lg transition-all duration-150 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-30 disabled:cursor-not-allowed"
              title="Redo"
            >
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                <path d="M18.4 10.6C16.55 8.99 14.15 8 11.5 8c-4.65 0-8.58 3.03-9.96 7.22L3.9 16c1.05-3.19 4.05-5.5 7.6-5.5 1.95 0 3.73.72 5.12 1.88L13 16h9V7l-3.6 3.6z"/>
              </svg>
            </button>

            {/* Separator */}
            <div className="w-px h-6 bg-gray-200 dark:bg-gray-700 mx-1"></div>

            {/* Text Style Dropdown */}
            <select
              onChange={(e) => {
                const value = e.target.value;
                if (value === "normal") {
                  editor.chain().focus().setParagraph().run();
                } else if (value === "h1") {
                  editor.chain().focus().toggleHeading({ level: 2 }).run();
                } else if (value === "h2") {
                  editor.chain().focus().toggleHeading({ level: 3 }).run();
                }
              }}
              value={
                editor.isActive("heading", { level: 2 }) ? "h1" :
                editor.isActive("heading", { level: 3 }) ? "h2" :
                "normal"
              }
              className="px-3 py-1.5 text-sm font-medium border-0 rounded-lg bg-transparent text-gray-600 dark:text-gray-400 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-800 focus:outline-none transition-all duration-150 min-w-[130px]"
            >
              <option value="normal">Normal text</option>
              <option value="h1">Heading 1</option>
              <option value="h2">Heading 2</option>
            </select>

            {/* Color Picker Dropdown */}
            <div className="relative">
              <button
                onClick={() => {
                  setShowColorPicker(!showColorPicker);
                }}
                className={`px-3 py-1.5 rounded-lg transition-all duration-150 flex items-center gap-2 ${
                  editor?.isActive("textStyle") && editor?.getAttributes("textStyle").color
                    ? "bg-gray-200 dark:bg-gray-700 text-gray-900 dark:text-white"
                    : "text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"
                }`}
                title="Text Color"
              >
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M12 3c-4.97 0-9 4.03-9 9s4.03 9 9 9c.83 0 1.5-.67 1.5-1.5 0-.39-.15-.74-.39-1.01-.23-.26-.38-.61-.38-.99 0-.83.67-1.5 1.5-1.5H16c2.76 0 5-2.24 5-5 0-4.42-4.03-8-9-8zm-5.5 9c-.83 0-1.5-.67-1.5-1.5S5.67 9 6.5 9 8 9.67 8 10.5 7.33 12 6.5 12zm3-4C8.67 8 8 7.33 8 6.5S8.67 5 9.5 5s1.5.67 1.5 1.5S10.33 8 9.5 8zm5 0c-.83 0-1.5-.67-1.5-1.5S13.67 5 14.5 5s1.5.67 1.5 1.5S15.33 8 14.5 8zm3 4c-.83 0-1.5-.67-1.5-1.5S16.67 9 17.5 9s1.5.67 1.5 1.5-.67 1.5-1.5 1.5z"/>
                </svg>
              </button>
              
              {showColorPicker && (
                <>
                  {/* Backdrop to close dropdown */}
                  <div 
                    className="fixed inset-0 z-40" 
                    onClick={() => setShowColorPicker(false)}
                  />
                  
                  {/* Color palette dropdown */}
                  <div className="absolute top-full left-0 mt-2 w-[320px] max-w-[calc(100vw-2rem)] bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-xl p-3 z-50 overflow-hidden">
                    <div className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-2 px-1">
                      Text Color
                    </div>
                    <div className="grid grid-cols-3 gap-2 max-h-[300px] overflow-y-auto overflow-x-hidden">
                      {colorPalette.map((color) => {
                        const themeColor = color.variable;
                        const isActive = editor?.getAttributes("textStyle").color === themeColor;
                        
                        return (
                          <button
                            key={color.name}
                            onClick={() => {
                              if (!editor) return;
                              
                              // Apply variable-based color
                              editor.chain().focus().setColor(color.variable).run();
                              
                              setShowColorPicker(false);
                            }}
                          className={`flex min-w-0 items-center gap-2 px-2.5 py-2 rounded-md transition-colors text-left ${
                              isActive 
                                ? "bg-blue-100 dark:bg-blue-900/30 ring-2 ring-blue-500" 
                                : "hover:bg-gray-100 dark:hover:bg-gray-700"
                            }`}
                          >
                            <div 
                              className="w-4 h-4 rounded-full border border-gray-300 dark:border-gray-600 flex-shrink-0"
                              style={{ backgroundColor: themeColor }}
                            />
                          <span className="min-w-0 truncate text-sm text-gray-700 dark:text-gray-300">
                              {color.name}
                            </span>
                            {isActive && (
                              <svg className="w-3 h-3 ml-auto text-blue-600 dark:text-blue-400 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                                <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd"/>
                              </svg>
                            )}
                          </button>
                        );
                      })}
                    </div>
                    <div className="border-t border-gray-200 dark:border-gray-700 mt-2 pt-2">
                      <button
                        onClick={() => {
                          if (!editor) return;
                          editor.chain().focus().unsetColor().run();
                          setShowColorPicker(false);
                        }}
                        className="w-full px-3 py-2 text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-md transition-colors text-left"
                      >
                        Reset to default
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>

            {/* Bold */}
            <button
              onMouseDown={(e) => {
                e.preventDefault();
                if (!editor) return;
                editor.chain().focus().toggleBold().run();
              }}
              className={`px-4 py-1.5 text-sm font-bold rounded-lg transition-all duration-150 ${
                editor.isActive("bold")
                  ? "bg-gray-200 dark:bg-gray-700 text-gray-900 dark:text-white"
                  : "text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"
              }`}
              title="Bold (Ctrl+B)"
            >
              B
            </button>

            {/* Italic */}
            <button
              onMouseDown={(e) => {
                e.preventDefault();
                if (!editor) return;
                editor.chain().focus().toggleItalic().run();
              }}
              className={`px-4 py-1.5 text-sm font-medium italic rounded-lg transition-all duration-150 ${
                editor.isActive("italic")
                  ? "bg-gray-200 dark:bg-gray-700 text-gray-900 dark:text-white"
                  : "text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"
              }`}
              title="Italic (Ctrl+I)"
            >
              I
            </button>

            {/* Underline */}
            <button
              onMouseDown={(e) => {
                e.preventDefault();
                if (!editor) return;
                (editor.chain().focus() as any).toggleUnderline().run();
              }}
              className={`px-4 py-1.5 text-sm font-medium underline rounded-lg transition-all duration-150 ${
                editor.isActive("underline")
                  ? "bg-gray-200 dark:bg-gray-700 text-gray-900 dark:text-white"
                  : "text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"
              }`}
              title="Underline (Ctrl+U)"
            >
              U
            </button>

            {/* Strikethrough */}
            <button
              onMouseDown={(e) => {
                e.preventDefault();
                if (!editor) return;
                editor.chain().focus().toggleStrike().run();
              }}
              className={`px-4 py-1.5 text-sm font-medium line-through rounded-lg transition-all duration-150 ${
                editor.isActive("strike")
                  ? "bg-gray-200 dark:bg-gray-700 text-gray-900 dark:text-white"
                  : "text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"
              }`}
              title="Strikethrough"
            >
              S
            </button>

            {/* Separator */}
            <div className="w-px h-6 bg-gray-200 dark:bg-gray-700 mx-1"></div>

            {/* Bullet List - just icon */}
            <button
              onClick={(e) => {
                e.preventDefault();
                
                // Get the current selection
                const { from, to } = editor.state.selection;
                const selectedText = editor.state.doc.textBetween(from, to, '\n');
                
                // Check if we're already in a list
                if (editor.isActive('bulletList')) {
                  // If already a list, just toggle it off
                  editor.chain().focus().toggleBulletList().run();
                } else if (selectedText.includes('\n')) {
                  // Multiple lines selected - split into separate list items
                  const lines = selectedText.split('\n').filter(line => line.trim());
                  
                  // Build HTML for bullet list with each line as a separate list item
                  const listHTML = `<ul>${lines.map(line => `<li><p>${line}</p></li>`).join('')}</ul>`;
                  
                  // Delete the selected text and insert the list
                  editor.chain().focus().deleteSelection().insertContent(listHTML).run();
                } else {
                  // Single line - just toggle
                  editor.chain().focus().toggleBulletList().run();
                }
              }}
              className={`px-3 py-1.5 rounded-lg transition-all duration-150 ${
                editor.isActive("bulletList")
                  ? "bg-gray-200 dark:bg-gray-700 text-gray-900 dark:text-white"
                  : "text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"
              }`}
              title="Bulleted list"
            >
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                <path d="M4 10.5c-.83 0-1.5.67-1.5 1.5s.67 1.5 1.5 1.5 1.5-.67 1.5-1.5-.67-1.5-1.5-1.5zm0-6c-.83 0-1.5.67-1.5 1.5S3.17 7.5 4 7.5 5.5 6.83 5.5 6 4.83 4.5 4 4.5zm0 12c-.83 0-1.5.68-1.5 1.5s.68 1.5 1.5 1.5 1.5-.68 1.5-1.5-.67-1.5-1.5-1.5zM7 19h14v-2H7v2zm0-6h14v-2H7v2zm0-8v2h14V5H7z"/>
              </svg>
            </button>

            {/* Numbered List - just icon */}
            <button
              onMouseDown={(e) => {
                e.preventDefault();
                editor.chain().focus().toggleOrderedList().run();
              }}
              className={`px-3 py-1.5 rounded-lg transition-all duration-150 ${
                editor.isActive("orderedList")
                  ? "bg-gray-200 dark:bg-gray-700 text-gray-900 dark:text-white"
                  : "text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"
              }`}
              title="Numbered list"
            >
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                <path d="M2 17h2v.5H3v1h1v.5H2v1h3v-4H2v1zm1-9h1V4H2v1h1v3zm-1 3h1.8L2 13.1v.9h3v-1H3.2L5 10.9V10H2v1zm5-6v2h14V5H7zm0 14h14v-2H7v2zm0-6h14v-2H7v2z"/>
              </svg>
            </button>

            {/* Quote - just icon */}
            <button
              onMouseDown={(e) => {
                e.preventDefault();
                editor.chain().focus().toggleBlockquote().run();
              }}
              className={`px-3 py-1.5 rounded-lg transition-all duration-150 ${
                editor.isActive("blockquote")
                  ? "bg-gray-200 dark:bg-gray-700 text-gray-900 dark:text-white"
                  : "text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"
              }`}
              title="Quote"
            >
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                <path d="M6 17h3l2-4V7H5v6h3zm8 0h3l2-4V7h-6v6h3z"/>
              </svg>
            </button>

            {/* Code Block with Syntax Highlighting */}
            <button
              onClick={(e) => {
                e.preventDefault();
                if (!editor) return;
                
                // Create a proper code block with React Syntax Highlighter
                const codeBlockHTML = `
                  <div class="syntax-code-block" data-language="javascript">
                    <pre><code class="language-javascript">// Enter your code here
console.log('Hello, World!');</code></pre>
                  </div>
                `;
                
                editor.chain().focus().insertContent(codeBlockHTML).run();
                setHasUnsavedChanges(true);
              }}
              className={`px-3 py-1.5 rounded-lg transition-all duration-150 font-mono text-base ${
                editor.isActive("codeBlock")
                  ? "bg-gray-200 dark:bg-gray-700 text-gray-900 dark:text-white"
                  : "text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"
              }`}
              title="Code block with syntax highlighting"
            >
              &lt;&gt;
            </button>

            {/* Insert Table */}
            <div className="relative">
              <button
                onMouseDown={(e) => {
                  e.preventDefault();
                  if (editor.isActive("table")) {
                    // If already in a table, toggle the controls
                    setShowTableControls(!showTableControls);
                  } else {
                    // Insert new table
                    editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();
                  }
                }}
                className={`px-3 py-1.5 rounded-lg transition-all duration-150 ${
                  editor.isActive("table") && showTableControls
                    ? "bg-blue-200 dark:bg-blue-700 text-blue-900 dark:text-blue-100"
                    : editor.isActive("table")
                    ? "bg-gray-200 dark:bg-gray-700 text-gray-900 dark:text-white"
                    : "text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"
                }`}
                title={editor.isActive("table") ? "Table Controls" : "Insert Table (3├ù3 with header)"}
              >
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M5 4h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zm0 2v4h4V6H5zm6 0v4h4V6h-4zm6 0v4h2V6h-2zM5 12v6h4v-6H5zm6 0v6h4v-6h-4zm6 0v6h2v-6h-2z" />
                </svg>
              </button>
              
              {/* Table Controls Floating Panel */}
              {editor.isActive("table") && showTableControls && (
                <>
                  {/* Backdrop to close panel */}
                  <div 
                    className="fixed inset-0 z-40" 
                    onClick={() => setShowTableControls(false)}
                  />
                  
                  {/* Floating Table Controls */}
                  <div className="absolute top-full left-0 mt-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-xl p-4 z-50 min-w-[320px] max-w-[400px]">
                    <div className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-3 px-1">
                      Table Controls
                    </div>
                    
                    {/* Add Operations */}
                    <div className="mb-3">
                      <div className="text-xs font-medium text-gray-600 dark:text-gray-400 mb-2">Add Elements</div>
                      <div className="flex items-center gap-2">
                        <button
                          onMouseDown={(e) => { 
                            e.preventDefault(); 
                            editor.chain().focus().addRowAfter().run(); 
                            setShowTableControls(false);
                          }}
                          className="group flex items-center gap-2 px-3 py-2 text-sm font-medium text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-900/30 hover:bg-blue-100 dark:hover:bg-blue-800/50 rounded-lg border border-blue-200/50 dark:border-blue-600/30 transition-all duration-200 hover:scale-105"
                          title="Add Row Below"
                        >
                          <svg className="w-4 h-4 group-hover:scale-110 transition-transform" fill="currentColor" viewBox="0 0 24 24">
                            <path d="M13 7h-2v4H7v2h4v4h2v-4h4v-2h-4V7z"/>
                            <path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H5V5h14v14z"/>
                          </svg>
                          <span>Add Row</span>
                        </button>
                        
                        <button
                          onMouseDown={(e) => { 
                            e.preventDefault(); 
                            editor.chain().focus().addColumnAfter().run(); 
                            setShowTableControls(false);
                          }}
                          className="group flex items-center gap-2 px-3 py-2 text-sm font-medium text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-900/30 hover:bg-blue-100 dark:hover:bg-blue-800/50 rounded-lg border border-blue-200/50 dark:border-blue-600/30 transition-all duration-200 hover:scale-105"
                          title="Add Column Right"
                        >
                          <svg className="w-4 h-4 group-hover:scale-110 transition-transform" fill="currentColor" viewBox="0 0 24 24">
                            <path d="M13 7h-2v4H7v2h4v4h2v-4h4v-2h-4V7z"/>
                            <path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H5V5h14v14z"/>
                          </svg>
                          <span>Add Column</span>
                        </button>
                      </div>
                    </div>

                    {/* Delete Operations */}
                    <div className="mb-3">
                      <div className="text-xs font-medium text-gray-600 dark:text-gray-400 mb-2">Remove Elements</div>
                      <div className="flex items-center gap-2">
                        <button
                          onMouseDown={(e) => { 
                            e.preventDefault(); 
                            editor.chain().focus().deleteRow().run(); 
                            setShowTableControls(false);
                          }}
                          className="group flex items-center gap-2 px-3 py-2 text-sm font-medium text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-900/30 hover:bg-red-100 dark:hover:bg-red-800/50 rounded-lg border border-red-200/50 dark:border-red-600/30 transition-all duration-200 hover:scale-105"
                          title="Delete Current Row"
                        >
                          <svg className="w-4 h-4 group-hover:scale-110 transition-transform" fill="currentColor" viewBox="0 0 24 24">
                            <path d="M19 13H5v-2h14v2z"/>
                            <path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H5V5h14v14z"/>
                          </svg>
                          <span>Delete Row</span>
                        </button>
                        
                        <button
                          onMouseDown={(e) => { 
                            e.preventDefault(); 
                            editor.chain().focus().deleteColumn().run(); 
                            setShowTableControls(false);
                          }}
                          className="group flex items-center gap-2 px-3 py-2 text-sm font-medium text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-900/30 hover:bg-red-100 dark:hover:bg-red-800/50 rounded-lg border border-red-200/50 dark:border-red-600/30 transition-all duration-200 hover:scale-105"
                          title="Delete Current Column"
                        >
                          <svg className="w-4 h-4 group-hover:scale-110 transition-transform" fill="currentColor" viewBox="0 0 24 24">
                            <path d="M19 13H5v-2h14v2z"/>
                            <path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H5V5h14v14z"/>
                          </svg>
                          <span>Delete Column</span>
                        </button>
                      </div>
                    </div>

                    {/* Separator */}
                    <div className="border-t border-gray-200 dark:border-gray-700 my-3"></div>

                    {/* Delete Table */}
                    <div>
                      <div className="text-xs font-medium text-gray-600 dark:text-gray-400 mb-2">Danger Zone</div>
                      <button
                        onMouseDown={(e) => { 
                          e.preventDefault(); 
                          editor.chain().focus().deleteTable().run(); 
                          setShowTableControls(false);
                        }}
                        className="group flex items-center gap-2 px-3 py-2 text-sm font-medium text-red-800 dark:text-red-200 bg-gradient-to-r from-red-100 to-red-50 dark:from-red-900/40 dark:to-red-800/40 hover:from-red-200 hover:to-red-100 dark:hover:from-red-800/60 dark:hover:to-red-700/60 rounded-lg border border-red-300/50 dark:border-red-500/30 transition-all duration-200 hover:scale-105"
                        title="Delete Entire Table"
                      >
                        <svg className="w-4 h-4 group-hover:scale-110 transition-transform" fill="currentColor" viewBox="0 0 24 24">
                          <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>
                        </svg>
                        <span>Delete Entire Table</span>
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>

            {/* Image */}
            <button
              onMouseDown={(e) => {
                e.preventDefault();
                setImageUploadMode('content');
                setShowImageUpload(true);
              }}
              className="px-3 py-1.5 rounded-lg text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition-all duration-150"
              title="Insert image"
            >
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                <path d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z"/>
              </svg>
            </button>
          </div>

          {/* Right: Status & Actions */}
          <div className="flex items-center gap-3">
            {/* Offline indicator */}
            {!isOnline && (
              <div className="flex items-center gap-2 px-3 py-1.5 bg-orange-100 dark:bg-orange-900/30 rounded-lg">
                <svg className="w-4 h-4 text-orange-600 dark:text-orange-400" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M23.64 7c-.45-.34-4.93-4-11.64-4-1.5 0-2.89.19-4.15.48L18.18 13.8 23.64 7zm-6.6 8.22L3.27 1.44 2 2.72l2.05 2.06C1.91 5.76.59 6.82.36 7l11.63 14.49.01.01.01-.01 3.9-4.86 3.32 3.32 1.27-1.27-3.46-3.46z"/>
                </svg>
                <span className="text-xs font-medium text-orange-600 dark:text-orange-400">Offline</span>
              </div>
            )}
            
            {/* Fixed width container for status text with rolling animation */}
            <div className="w-32 h-5 overflow-hidden relative">
              <span 
                key={getStatusText()} 
                className="absolute inset-0 text-xs font-medium text-gray-500 dark:text-gray-400 animate-roll-in"
              >
                {getStatusText()}
              </span>
            </div>
            {/* Publish/Republish Button */}
            {parentPostId && 
             parentPostId.trim() !== "" && 
             parentPostId !== "null" && 
             parentPostId !== "undefined" && 
             parentPostId !== "0" ? (
              <button
                onClick={() => setShowPublishModal(true)}
                disabled={isSaving}
                className="px-5 py-1.5 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-150 flex items-center gap-2"
                title="Update the published version with current changes"
              >
                Republish
              </button>
            ) : (
              <button
                onClick={() => setShowPublishModal(true)}
                disabled={isSaving}
                className="px-5 py-1.5 bg-[#025cd7] text-white text-sm font-medium rounded-lg hover:bg-[#0247a6] disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-150 flex items-center gap-2"
                title="Publish your story to make it public"
              >
                Publish
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Editor Content */}
      <div className="max-w-4xl mx-auto px-6 py-12">
        {/* Cover Image Section */}
        {coverImage ? (
          <div className="mb-8 relative group" style={{ aspectRatio: "21/9" }}>
            <img
              src={coverImage}
              alt="Cover"
              className="w-full h-full object-cover rounded-2xl"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/20 to-transparent rounded-2xl" />
            <button
              onClick={() => {
                setCoverImage("");
                setHasUnsavedChanges(true);
              }}
              className="absolute top-4 right-4 p-2 bg-white/90 dark:bg-black/90 rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
              title="Remove cover image"
            >
              <svg className="w-5 h-5 text-red-600" fill="currentColor" viewBox="0 0 24 24">
                <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>
              </svg>
            </button>
            <button
              onClick={() => {
                setImageUploadMode('cover');
                setShowImageUpload(true);
              }}
              className="absolute top-4 left-4 px-4 py-2 bg-white/90 dark:bg-black/90 rounded-full opacity-0 group-hover:opacity-100 transition-opacity text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-white dark:hover:bg-black"
              title="Change cover image"
            >
              Change Cover
            </button>
          </div>
        ) : (
          <div className="mb-8">
            <button
              onClick={() => {
                setImageUploadMode('cover');
                setShowImageUpload(true);
              }}
              className="w-full border-2 border-dashed border-gray-300 dark:border-gray-700 rounded-2xl p-12 hover:border-blue-500 dark:hover:border-blue-500 transition-colors group"
              style={{ aspectRatio: "21/9" }}
            >
              <div className="flex flex-col items-center justify-center h-full">
                <svg className="w-12 h-12 text-gray-400 dark:text-gray-600 mb-3 group-hover:text-blue-500 transition-colors" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z"/>
                </svg>
                <p className="text-gray-600 dark:text-gray-400 font-medium group-hover:text-blue-500 transition-colors">
                  Add Cover Image
                </p>
                <p className="text-sm text-gray-500 dark:text-gray-500 mt-1">
                  Recommended: 1200 x 630 pixels
                </p>
              </div>
            </button>
          </div>
        )}

        {/* Title */}
        <div className="mb-4">
          <textarea
            ref={titleInputRef}
            value={title}
            onChange={(e) => {
              setTitle(e.target.value);
              setHasUnsavedChanges(true);
            }}
            placeholder="Title"
            rows={1}
            className="w-full resize-none overflow-hidden text-[2.25rem] md:text-[2.875rem] lg:text-[3.25rem] font-bold leading-[1.12] tracking-normal border-none outline-none bg-transparent text-[#242424] dark:text-[#f2f2f2] placeholder-gray-400 dark:placeholder-gray-600"
            style={{ 
              fontFamily: "'Söhne', 'Sohne', 'Inter', 'Helvetica Neue', Arial, sans-serif",
              fontWeight: 800
            }}
          />
        </div>

        {/* Subtitle */}
        <textarea
          ref={subtitleInputRef}
          value={subtitle}
          onChange={(e) => {
            setSubtitle(e.target.value);
            setHasUnsavedChanges(true);
          }}
          placeholder="Subtitle"
          maxLength={300}
          rows={1}
          className="mb-4 w-full resize-none overflow-hidden border-none bg-transparent text-[1.35rem] md:text-[1.5rem] leading-snug text-[#6b6b6b] dark:text-[#b8b8b8] outline-none placeholder-gray-400 dark:placeholder-gray-600"
          style={{
            fontFamily: "'Söhne', 'Sohne', 'Inter', 'Helvetica Neue', Arial, sans-serif",
            fontWeight: 400
          }}
        />

        {/* Editor */}
        <EditorContent editor={editor} />

        {/* Live Word Count Badge */}
        <div className="fixed bottom-6 right-6 z-40 flex items-center gap-2 px-4 py-2 bg-white dark:bg-[#252525] border border-gray-200 dark:border-gray-700 rounded-full shadow-lg text-xs font-semibold text-gray-500 dark:text-gray-400 select-none pointer-events-none">
          <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>
          <span>{wordCount.toLocaleString()} word{wordCount !== 1 ? "s" : ""}</span>
        </div>
      </div>

      {/* Floating Toolbar for Selected Text */}
      {showFloatingToolbar && editor && (
        <div
          ref={floatingToolbarRef}
          className="fixed z-50 bg-gray-900 dark:bg-gray-800 rounded-lg shadow-2xl border border-gray-700 px-2 py-1.5 flex items-center gap-1 animate-fade-in"
          style={{
            top: `${floatingToolbarPosition.top}px`,
            left: `${floatingToolbarPosition.left}px`,
            transform: 'translateX(-50%)',
          }}
        >
          {/* Bold */}
          <button
            onClick={(e) => {
              e.preventDefault();
              editor.chain().focus().toggleBold().run();
            }}
            className={`px-3 py-1.5 text-sm font-bold rounded transition-colors ${
              editor.isActive("bold")
                ? "bg-blue-600 text-white"
                : "text-gray-300 hover:bg-gray-700"
            }`}
            title="Bold"
          >
            B
          </button>

          {/* Italic */}
          <button
            onClick={(e) => {
              e.preventDefault();
              editor.chain().focus().toggleItalic().run();
            }}
            className={`px-3 py-1.5 text-sm font-medium italic rounded transition-colors ${
              editor.isActive("italic")
                ? "bg-blue-600 text-white"
                : "text-gray-300 hover:bg-gray-700"
            }`}
            title="Italic"
          >
            I
          </button>

          {/* Underline */}
          <button
            onClick={(e) => {
              e.preventDefault();
              (editor.chain().focus() as any).toggleUnderline().run();
            }}
            className={`px-3 py-1.5 text-sm font-medium underline rounded transition-colors ${
              editor.isActive("underline")
                ? "bg-blue-600 text-white"
                : "text-gray-300 hover:bg-gray-700"
            }`}
            title="Underline"
          >
            U
          </button>

          {/* Strikethrough */}
          <button
            onClick={(e) => {
              e.preventDefault();
              editor.chain().focus().toggleStrike().run();
            }}
            className={`px-3 py-1.5 text-sm font-medium line-through rounded transition-colors ${
              editor.isActive("strike")
                ? "bg-blue-600 text-white"
                : "text-gray-300 hover:bg-gray-700"
            }`}
            title="Strikethrough"
          >
            S
          </button>

          {/* Link */}
          <button
            onClick={(e) => {
              e.preventDefault();
              const url = window.prompt('Enter URL:');
              if (url) {
                editor.chain().focus().setLink({ href: url }).run();
              }
            }}
            className={`px-2 py-1.5 rounded transition-colors ${
              editor.isActive("link")
                ? "bg-blue-600 text-white"
                : "text-gray-300 hover:bg-gray-700"
            }`}
            title="Add Link"
          >
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
              <path d="M3.9 12c0-1.71 1.39-3.1 3.1-3.1h4V7H7c-2.76 0-5 2.24-5 5s2.24 5 5 5h4v-1.9H7c-1.71 0-3.1-1.39-3.1-3.1zM8 13h8v-2H8v2zm9-6h-4v1.9h4c1.71 0 3.1 1.39 3.1 3.1s-1.39 3.1-3.1 3.1h-4V17h4c2.76 0 5-2.24 5-5s-2.24-5-5-5z"/>
            </svg>
          </button>
        </div>
      )}

      {/* Modals */}
      {showPublishModal && (
        <PublishModal
          title={title}
          subtitle={subtitle.trim() || createAutoSubtitle(editor.getHTML(), title)}
          content={editor.getHTML()}
          coverImage={coverImage}
          titleColor={titleColor}
          showAuthorName={showAuthorName}
          draftId={draftId}
          parentPostId={parentPostId}
          onClose={() => setShowPublishModal(false)}
        />
      )}

      {showImageUpload && (
        <ImageUpload
          onImageSelect={(url, caption) => {
            if (url) {
              if (imageUploadMode === 'cover') {
                setCoverImage(url);
                setHasUnsavedChanges(true);
              } else {
                addImage(url, caption);
              }
            }
            setShowImageUpload(false);
          }}
          onClose={() => setShowImageUpload(false)}
          captionEnabled={imageUploadMode === 'content'}
        />
      )}

      {/* Custom Styles */}
      {/* @ts-ignore */}
      <style jsx global>{`
        .ProseMirror {
          outline: none;
          font-size: 1.125rem; /* 18px - increased from default */
          line-height: 1.75;
          tab-size: 4;
          white-space: pre-wrap;
          font-family: Charter, 'Bitstream Charter', Georgia, Cambria, 'Times New Roman', serif;
        }
        .ProseMirror p {
          font-size: 1.125rem; /* 18px */
          line-height: 1.75;
          font-family: Charter, 'Bitstream Charter', Georgia, Cambria, 'Times New Roman', serif;
        }
        .ProseMirror h1, .ProseMirror h2, .ProseMirror h3, .ProseMirror h4, .ProseMirror h5, .ProseMirror h6 {
          font-family: 'Söhne', 'Sohne', 'Inter', 'Helvetica Neue', Arial, sans-serif;
        }
        .ProseMirror li {
          font-family: Charter, 'Bitstream Charter', Georgia, Cambria, 'Times New Roman', serif;
        }
        .ProseMirror blockquote {
          font-family: Charter, 'Bitstream Charter', Georgia, Cambria, 'Times New Roman', serif;
        }
        .ProseMirror p.is-editor-empty:first-child::before {
          content: attr(data-placeholder);
          float: left;
          color: #adb5bd;
          pointer-events: none;
          height: 0;
          font-family: Charter, 'Bitstream Charter', Georgia, Cambria, 'Times New Roman', serif;
        }
        
        /* Ensure consistent base font */
        .ProseMirror {
          font-family: Charter, 'Bitstream Charter', Georgia, Cambria, 'Times New Roman', serif;
        }
        
        /* Font family styles - these will override the default when applied */
        .ProseMirror [style*="font-family: Georgia"] {
          font-family: Georgia, serif !important;
        }
        .ProseMirror [style*="font-family: 'Times New Roman'"] {
          font-family: 'Times New Roman', serif !important;
        }
        .ProseMirror [style*="font-family: 'Courier New'"] {
          font-family: 'Courier New', monospace !important;
        }
        .ProseMirror [style*="font-family: Verdana"] {
          font-family: Verdana, sans-serif !important;
        }
        .ProseMirror [style*="font-family: 'Helvetica Neue'"] {
          font-family: 'Helvetica Neue', sans-serif !important;
        }
        .ProseMirror [style*="font-family: 'Inter'"] {
          font-family: 'Inter', sans-serif !important;
        }
        .ProseMirror [style*="font-family: 'Roboto'"] {
          font-family: 'Roboto', sans-serif !important;
        }
        
        /* Theme-aware text colors using CSS variables */
        .ProseMirror .text-default { color: var(--blog-default); }
        .ProseMirror .text-primary { color: var(--blog-primary); }
        .ProseMirror .text-success { color: var(--blog-success); }
        .ProseMirror .text-warning { color: var(--blog-warning); }
        .ProseMirror .text-danger { color: var(--blog-danger); }
        .ProseMirror .text-purple { color: var(--blog-purple); }
        .ProseMirror .text-pink { color: var(--blog-pink); }
        .ProseMirror .text-teal { color: var(--blog-teal); }
        .ProseMirror .text-indigo { color: var(--blog-indigo); }
        .ProseMirror .text-gray { color: var(--blog-gray); }
        .ProseMirror .text-orange { color: var(--blog-orange); }
        .ProseMirror .text-cyan { color: var(--blog-cyan); }
        .ProseMirror .text-mint { color: var(--blog-mint); }
        .ProseMirror .text-brown { color: var(--blog-brown); }
        .ProseMirror .text-yellow { color: var(--blog-yellow); }
        .ProseMirror .text-lime { color: var(--blog-lime); }
        .ProseMirror .text-magenta { color: var(--blog-magenta); }
        .ProseMirror .text-rose { color: var(--blog-rose); }
        
        .ProseMirror h1 {
          font-family: 'Söhne', 'Sohne', 'Inter', 'Helvetica Neue', Arial, sans-serif;
          font-size: clamp(2rem, 6vw, 3rem);
          font-weight: 800;
          line-height: 1.15;
          margin: clamp(1.5rem, 4vw, 2rem) 0 clamp(0.875rem, 2.5vw, 1.25rem) 0;
          overflow-wrap: anywhere;
          word-break: normal;
        }
        .ProseMirror h2 {
          font-family: 'Söhne', 'Sohne', 'Inter', 'Helvetica Neue', Arial, sans-serif;
          font-size: clamp(1.75rem, 4.8vw, 2.25rem);
          font-weight: 700;
          line-height: 1.25;
          margin: clamp(1.35rem, 3.5vw, 1.75rem) 0 clamp(0.75rem, 2vw, 1rem) 0;
          overflow-wrap: anywhere;
          word-break: normal;
        }
        .ProseMirror h3 {
          font-family: 'Söhne', 'Sohne', 'Inter', 'Helvetica Neue', Arial, sans-serif;
          font-size: clamp(1.35rem, 3.8vw, 1.75rem);
          font-weight: 700;
          line-height: 1.35;
          margin: clamp(1.125rem, 3vw, 1.5rem) 0 clamp(0.5rem, 1.8vw, 0.75rem) 0;
          overflow-wrap: anywhere;
          word-break: normal;
        }
        .ProseMirror h4 {
          font-family: 'Söhne', 'Sohne', 'Inter', 'Helvetica Neue', Arial, sans-serif;
          font-size: clamp(1.15rem, 3vw, 1.35rem);
          font-weight: 600;
          line-height: 1.4;
          margin: clamp(1rem, 2.5vw, 1.25rem) 0 0.5rem 0;
          color: #374151;
          overflow-wrap: anywhere;
          word-break: normal;
        }
        .dark .ProseMirror h4 {
          color: #d1d5db;
        }
        /* ΓöÇΓöÇ Lists ΓöÇΓöÇ */
        .ProseMirror ul,
        .ProseMirror ol {
          padding-left: 2rem;
          margin: 0.75rem 0;
        }
        .ProseMirror ul {
          list-style-type: disc;
        }
        .ProseMirror ul ul {
          list-style-type: circle;
          margin: 0.25rem 0;
          padding-left: 2rem;
        }
        .ProseMirror ul ul ul {
          list-style-type: square;
          margin: 0.25rem 0;
          padding-left: 2rem;
        }
        .ProseMirror ol {
          list-style-type: decimal;
        }
        .ProseMirror ol ol {
          list-style-type: lower-alpha;
          margin: 0.25rem 0;
          padding-left: 2rem;
        }
        .ProseMirror ol ol ol {
          list-style-type: lower-roman;
          margin: 0.25rem 0;
          padding-left: 2rem;
        }
        .ProseMirror li {
          margin: 0.3rem 0;
          padding-left: 0.25rem;
          display: list-item;
        }
        /* Word-paste: li often contains a bare <p> ΓÇö strip its margin */
        .ProseMirror li > p {
          margin: 0;
          display: inline;
        }
        .ProseMirror li > p + p {
          display: block;
          margin-top: 0.25rem;
        }
        .ProseMirror blockquote {
          border-left: 4px solid #4A7CFF;
          padding-left: 1rem;
          margin: 1rem 0;
          font-style: italic;
          color: #6b7280;
        }
        .dark .ProseMirror blockquote {
          border-left-color: #0A84FF;
          color: #9ca3af;
        }
        .ProseMirror code {
          background: #f3f4f6;
          padding: 0.2rem 0.4rem;
          border-radius: 0.25rem;
          font-size: 0.875em;
          color: #1f2937;
          font-family: 'Courier New', monospace;
        }
        .dark .ProseMirror code {
          background: #374151;
          color: #e5e7eb;
        }
        .ProseMirror pre {
          background: #1e1e1e;
          color: #fff;
          padding: 1rem;
          border-radius: 0.5rem;
          overflow-x: auto;
          margin: 1rem 0;
          position: relative;
        }
        .dark .ProseMirror pre {
          background: #0d0d0d;
        }
        .ProseMirror pre code {
          background: transparent;
          padding: 0;
          color: inherit;
          font-family: 'Courier New', monospace;
          font-size: 0.875rem;
          line-height: 1.5;
        }
        
        /* Syntax highlighter overrides */
        .ProseMirror .syntax-highlighter {
          margin: 1rem 0;
          border-radius: 0.5rem;
          overflow: hidden;
        }
        .ProseMirror .syntax-highlighter pre {
          margin: 0 !important;
          padding: 1rem !important;
          background: transparent !important;
        }
        .ProseMirror .syntax-highlighter code {
          font-family: 'Courier New', monospace !important;
          font-size: 0.875rem !important;
          line-height: 1.5 !important;
        }
        .ProseMirror img {
          max-width: 100%;
          height: auto;
          border-radius: 0.5rem;
          margin: 1rem 0;
        }
        .ProseMirror figure.blog-image-figure {
          margin: 1.5rem 0;
          text-align: center;
        }
        .ProseMirror figure.blog-image-figure img {
          display: block;
          margin: 0 auto !important;
        }
        .ProseMirror figcaption.blog-image-caption {
          margin: 0.75rem auto 0;
          color: #6b7280;
          font-family: 'Söhne', 'Sohne', 'Inter', 'Helvetica Neue', Arial, sans-serif;
          font-size: 0.95rem;
          line-height: 1.45;
          text-align: center;
          max-width: 90%;
        }
        .dark .ProseMirror figcaption.blog-image-caption {
          color: #9ca3af;
        }

        /* Table styles */
        .ProseMirror table {
          border-collapse: collapse;
          table-layout: fixed;
          width: 100%;
          margin: 1.5rem 0;
          overflow: hidden;
          border-radius: 8px;
          box-shadow: 0 1px 3px 0 rgba(0, 0, 0, 0.1), 0 1px 2px 0 rgba(0, 0, 0, 0.06);
          border: 1px solid #e5e7eb;
        }
        .dark .ProseMirror table {
          border-color: #374151;
          box-shadow: 0 1px 3px 0 rgba(0, 0, 0, 0.3), 0 1px 2px 0 rgba(0, 0, 0, 0.2);
        }
        .ProseMirror td,
        .ProseMirror th {
          min-width: 1em;
          border: 1px solid #e5e7eb;
          padding: 12px 16px;
          vertical-align: top;
          box-sizing: border-box;
          position: relative;
          transition: all 0.2s ease;
        }
        .dark .ProseMirror td,
        .dark .ProseMirror th {
          border-color: #374151;
        }
        .ProseMirror th {
          font-weight: 600;
          text-align: left;
          background: linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%);
          color: #1e293b;
          font-size: 0.875rem;
          letter-spacing: 0.025em;
        }
        .dark .ProseMirror th {
          background: linear-gradient(135deg, #1f2937 0%, #111827 100%);
          color: #f9fafb;
        }
        .ProseMirror td:hover,
        .ProseMirror th:hover {
          background-color: #f8fafc;
        }
        .dark .ProseMirror td:hover,
        .dark .ProseMirror th:hover {
          background-color: #1f2937;
        }
        .ProseMirror .selectedCell:after {
          z-index: 2;
          position: absolute;
          content: "";
          left: 0; right: 0; top: 0; bottom: 0;
          background: rgba(59, 130, 246, 0.15);
          border: 2px solid #3b82f6;
          border-radius: 4px;
          pointer-events: none;
        }
        .ProseMirror .column-resize-handle {
          position: absolute;
          right: -2px;
          top: 0;
          bottom: -2px;
          width: 4px;
          background: linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%);
          border-radius: 2px;
          pointer-events: none;
          opacity: 0;
          transition: opacity 0.2s ease;
        }
        .ProseMirror table:hover .column-resize-handle {
          opacity: 1;
        }

        /* Rolling dice animation for status text */
        @keyframes roll-in {
          0% {
            transform: translateY(-100%) rotateX(-90deg);
            opacity: 0;
          }
          50% {
            transform: translateY(0%) rotateX(-45deg);
            opacity: 0.5;
          }
          100% {
            transform: translateY(0%) rotateX(0deg);
            opacity: 1;
          }
        }

        .animate-roll-in {
          animation: roll-in 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
        }

        /* Fade in animation for floating toolbar */
        @keyframes fade-in {
          0% {
            opacity: 0;
            transform: translateX(-50%) translateY(-10px);
          }
          100% {
            opacity: 1;
            transform: translateX(-50%) translateY(0);
          }
        }

        .animate-fade-in {
          animation: fade-in 0.2s ease-out;
        }
      `}</style>
    </div>
  );
}
