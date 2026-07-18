"use client";

import { useState, useEffect, useRef, useCallback } from "react";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";
const DEBOUNCE_MS = 1500;

interface UseLatexAutosaveOptions {
    resumeId: string;
    source: string;
    title: string;
    token: string;
}

export function useLatexAutosave({ resumeId, source, title, token }: UseLatexAutosaveOptions) {
    const [saveStatus, setSaveStatus] = useState<"saved" | "saving" | "unsaved" | "error">("saved");
    const lastSavedSource = useRef(source);
    const lastSavedTitle = useRef(title);
    const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    const save = useCallback(async (newSource: string, newTitle: string) => {
        if (!token) return;

        const body: Record<string, string> = {};
        if (newSource !== lastSavedSource.current) body.latexSource = newSource;
        if (newTitle !== lastSavedTitle.current) body.title = newTitle;

        if (Object.keys(body).length === 0) {
            setSaveStatus("saved");
            return;
        }

        setSaveStatus("saving");

        try {
            const res = await fetch(`${API_BASE}/latex-resumes/${resumeId}`, {
                method: "PATCH",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify(body),
            });

            if (!res.ok) throw new Error("Save failed");

            lastSavedSource.current = newSource;
            lastSavedTitle.current = newTitle;
            setSaveStatus("saved");
        } catch {
            setSaveStatus("error");
        }
    }, [resumeId, token]);

    // Debounced save on source/title change
    useEffect(() => {
        if (source === lastSavedSource.current && title === lastSavedTitle.current) return;

        setSaveStatus("unsaved");

        if (debounceTimer.current) clearTimeout(debounceTimer.current);
        debounceTimer.current = setTimeout(() => {
            save(source, title);
        }, DEBOUNCE_MS);

        return () => {
            if (debounceTimer.current) clearTimeout(debounceTimer.current);
        };
    }, [source, title, save]);

    // Warn on unload
    useEffect(() => {
        const handleBeforeUnload = (e: BeforeUnloadEvent) => {
            if (saveStatus === "unsaved" || saveStatus === "saving") {
                e.preventDefault();
            }
        };
        window.addEventListener("beforeunload", handleBeforeUnload);
        return () => window.removeEventListener("beforeunload", handleBeforeUnload);
    }, [saveStatus]);

    return { saveStatus };
}
