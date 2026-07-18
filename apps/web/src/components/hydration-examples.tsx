/**
 * Examples demonstrating how to use hydration error boundary and Safari utilities.
 * 
 * This file provides practical examples for handling Safari hydration errors
 * and ensuring cross-browser compatibility.
 * 
 * **Validates: Requirements 5.1, 5.2, 5.3, 5.4, 5.5**
 */

"use client";

import React from "react";
import { HydrationErrorBoundary, ClientOnlyWrapper } from "./hydration-error-boundary";
import { useSafariSafeAttributes, isSafariBrowser, suppressHydrationWarning } from "@/lib/safari-utils";

/**
 * Example 1: Wrapping a component that has hydration issues
 */
export function ExampleWithErrorBoundary() {
    return (
        <HydrationErrorBoundary>
            <ComponentThatMightHaveHydrationIssues />
        </HydrationErrorBoundary>
    );
}

/**
 * Example 2: Using ClientOnlyWrapper for components that should only render on client
 */
export function ExampleClientOnly() {
    return (
        <ClientOnlyWrapper placeholder={<div>Loading...</div>}>
            <ComponentThatNeedsClientSideOnly />
        </ClientOnlyWrapper>
    );
}

/**
 * Example 3: Using Safari-safe attributes hook
 */
export function ExampleSafariSafeAttributes() {
    const ref = useSafariSafeAttributes<HTMLDivElement>();
    
    return (
        <div ref={ref} className="my-component">
            Content with Safari-safe attributes
        </div>
    );
}

/**
 * Example 4: Conditional rendering based on Safari detection
 */
export function ExampleSafariDetection() {
    const [isSafari, setIsSafari] = React.useState(false);

    React.useEffect(() => {
        setIsSafari(isSafariBrowser());
    }, []);

    return (
        <div>
            {isSafari ? (
                <div>Safari-specific rendering</div>
            ) : (
                <div>Standard rendering</div>
            )}
        </div>
    );
}

/**
 * Example 5: Suppressing hydration warnings for known issues
 */
export function ExampleSuppressHydrationWarning() {
    return (
        <div {...suppressHydrationWarning()}>
            {/* Content that has unavoidable hydration differences */}
            {new Date().toLocaleString()}
        </div>
    );
}

/**
 * Example 6: Combining multiple strategies for robust hydration handling
 */
export function ExampleComprehensive() {
    const ref = useSafariSafeAttributes<HTMLDivElement>();
    const [mounted, setMounted] = React.useState(false);

    React.useEffect(() => {
        setMounted(true);
    }, []);

    return (
        <HydrationErrorBoundary fallback={<div>Loading...</div>}>
            <div ref={ref} className="comprehensive-example">
                {mounted ? (
                    <ClientOnlyWrapper>
                        <DynamicContent />
                    </ClientOnlyWrapper>
                ) : (
                    <div>Loading...</div>
                )}
            </div>
        </HydrationErrorBoundary>
    );
}

/**
 * Example 7: Handling theme-dependent content (common hydration issue)
 */
export function ExampleThemeDependent() {
    const [mounted, setMounted] = React.useState(false);

    React.useEffect(() => {
        setMounted(true);
    }, []);

    // Prevent hydration mismatch by not rendering theme-dependent content until mounted
    if (!mounted) {
        return <div className="theme-placeholder" />;
    }

    return (
        <div className="theme-dependent-content">
            {/* Theme-dependent content here */}
        </div>
    );
}

/**
 * Example 8: Wrapping third-party components that cause hydration issues
 */
export function ExampleThirdPartyComponent() {
    return (
        <HydrationErrorBoundary>
            <ClientOnlyWrapper placeholder={<div className="skeleton-loader" />}>
                {/* Third-party component that might have hydration issues */}
                <ThirdPartyComponent />
            </ClientOnlyWrapper>
        </HydrationErrorBoundary>
    );
}

// Mock components for examples
function ComponentThatMightHaveHydrationIssues() {
    return <div>Component content</div>;
}

function ComponentThatNeedsClientSideOnly() {
    return <div>Client-only content</div>;
}

function DynamicContent() {
    return <div>Dynamic content</div>;
}

function ThirdPartyComponent() {
    return <div>Third-party component</div>;
}
