/**
 * Safari-specific utilities for handling hydration and attribute normalization.
 * 
 * **Validates: Requirements 5.1, 5.3, 5.4, 5.5**
 */

import { useEffect, useRef } from "react";

/**
 * Detects if the current browser is Safari.
 * Uses user agent detection as a fallback for Safari-specific handling.
 */
export function isSafariBrowser(): boolean {
    if (typeof window === "undefined") return false;
    
    const ua = navigator.userAgent.toLowerCase();
    const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
    const isIOS = /iphone|ipad|ipod/.test(ua);
    
    return isSafari || isIOS;
}

/**
 * Normalizes boolean attributes for Safari compatibility.
 * Safari handles boolean attributes differently than other browsers,
 * which can cause hydration mismatches.
 * 
 * @param element - The HTML element to normalize
 */
export function normalizeBooleanAttributes(element: HTMLElement): void {
    const booleanAttrs = [
        "hidden",
        "disabled",
        "readonly",
        "checked",
        "selected",
        "required",
        "autofocus",
        "autoplay",
        "controls",
        "loop",
        "muted",
        "multiple",
    ];

    booleanAttrs.forEach((attr) => {
        if (element.hasAttribute(attr)) {
            const value = element.getAttribute(attr);
            // Normalize empty string or "true" to the attribute name itself
            if (value === "" || value === "true") {
                element.setAttribute(attr, attr);
            }
        }
    });
}

/**
 * Normalizes all attributes on an element for Safari compatibility.
 * Handles common attribute mismatches that cause hydration errors.
 * 
 * @param element - The HTML element to normalize
 */
export function normalizeAttributes(element: HTMLElement): void {
    // Normalize boolean attributes
    normalizeBooleanAttributes(element);

    // Normalize style attribute (Safari sometimes adds extra spaces)
    const style = element.getAttribute("style");
    if (style) {
        const normalized = style.trim().replace(/\s+/g, " ");
        if (normalized !== style) {
            element.setAttribute("style", normalized);
        }
    }

    // Normalize class attribute (Safari sometimes reorders classes)
    const className = element.getAttribute("class");
    if (className) {
        const normalized = className.trim().replace(/\s+/g, " ");
        if (normalized !== className) {
            element.setAttribute("class", normalized);
        }
    }
}

/**
 * React hook for Safari-safe attribute handling.
 * Automatically normalizes attributes on the referenced element for Safari compatibility.
 * 
 * **Validates: Requirements 5.1, 5.3, 5.4**
 * 
 * @returns A ref to attach to the element that needs Safari-safe attributes
 * 
 * @example
 * ```tsx
 * function MyComponent() {
 *   const ref = useSafariSafeAttributes<HTMLDivElement>();
 *   return <div ref={ref}>Content</div>;
 * }
 * ```
 */
export function useSafariSafeAttributes<T extends HTMLElement>() {
    const ref = useRef<T>(null);

    useEffect(() => {
        if (!ref.current) return;

        const element = ref.current;
        const isSafari = isSafariBrowser();

        if (isSafari) {
            // Normalize attributes on mount
            normalizeAttributes(element);

            // Set up a mutation observer to handle dynamic attribute changes
            const observer = new MutationObserver((mutations) => {
                mutations.forEach((mutation) => {
                    if (mutation.type === "attributes" && mutation.target instanceof HTMLElement) {
                        normalizeAttributes(mutation.target);
                    }
                });
            });

            observer.observe(element, {
                attributes: true,
                subtree: true,
            });

            return () => {
                observer.disconnect();
            };
        }
    }, []);

    return ref;
}

/**
 * Suppresses hydration warnings in development for known Safari issues.
 * Use sparingly and only for components where hydration mismatches are unavoidable.
 * 
 * **Validates: Requirements 5.4**
 */
export function suppressHydrationWarning(): { suppressHydrationWarning: true } {
    return { suppressHydrationWarning: true };
}

/**
 * Checks if the current environment is client-side.
 * Useful for conditional rendering to avoid hydration mismatches.
 */
export function isClient(): boolean {
    return typeof window !== "undefined";
}

/**
 * Checks if the current environment is server-side.
 * Useful for conditional rendering to avoid hydration mismatches.
 */
export function isServer(): boolean {
    return typeof window === "undefined";
}
