"use client";

import { useEffect, useRef } from "react";
import { useTheme } from "next-themes";

export function ThemeSync() {
    const { setTheme, resolvedTheme } = useTheme();
    const isInitialSync = useRef(true);
    const isSyncing = useRef(false);

    useEffect(() => {
        if (!isInitialSync.current) return;

        const practersDark = localStorage.getItem("practers-dark");
        if (practersDark !== null) {
            isSyncing.current = true;
            setTheme(practersDark === "true" ? "dark" : "light");
            setTimeout(() => {
                isSyncing.current = false;
                isInitialSync.current = false;
            }, 100);
            return;
        }

        isInitialSync.current = false;
    }, [setTheme]);

    useEffect(() => {
        if (!isInitialSync.current && !isSyncing.current && resolvedTheme) {
            localStorage.setItem("practers-dark", String(resolvedTheme === "dark"));
        }
    }, [resolvedTheme]);

    useEffect(() => {
        const handleStorageChange = (event: StorageEvent) => {
            if (event.key !== "practers-dark" || event.newValue === null || isSyncing.current) return;

            isSyncing.current = true;
            setTheme(event.newValue === "true" ? "dark" : "light");
            setTimeout(() => {
                isSyncing.current = false;
            }, 100);
        };

        window.addEventListener("storage", handleStorageChange);
        return () => window.removeEventListener("storage", handleStorageChange);
    }, [setTheme]);

    return null;
}
