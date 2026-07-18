"use client";

import React, { Component, ReactNode } from "react";

interface HydrationErrorBoundaryProps {
    children: ReactNode;
    fallback?: ReactNode;
}

interface HydrationErrorBoundaryState {
    hasError: boolean;
    isHydrating: boolean;
}

/**
 * Error boundary that catches hydration mismatch errors in Safari
 * and forces client-side rendering for affected components.
 * 
 * **Validates: Requirements 5.1, 5.2, 5.3, 5.4, 5.5**
 */
export class HydrationErrorBoundary extends Component<
    HydrationErrorBoundaryProps,
    HydrationErrorBoundaryState
> {
    constructor(props: HydrationErrorBoundaryProps) {
        super(props);
        this.state = {
            hasError: false,
            isHydrating: true,
        };
    }

    static getDerivedStateFromError(error: Error): Partial<HydrationErrorBoundaryState> | null {
        // Check if it's a hydration mismatch error
        const isHydrationError =
            error.message.includes("Hydration") ||
            error.message.includes("did not match") ||
            error.message.includes("hydration") ||
            error.message.includes("Text content does not match") ||
            error.message.includes("Prop") ||
            error.message.includes("attribute");

        if (isHydrationError) {
            console.warn("[HydrationErrorBoundary] Caught hydration error:", error.message);
            return { hasError: true };
        }

        // Not a hydration error, let it propagate
        return null;
    }

    componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
        // Log hydration errors for debugging without breaking the UI
        const isHydrationError =
            error.message.includes("Hydration") ||
            error.message.includes("did not match") ||
            error.message.includes("hydration");

        if (isHydrationError) {
            console.error("[HydrationErrorBoundary] Hydration error details:", {
                error: error.message,
                componentStack: errorInfo.componentStack,
            });
        }
    }

    componentDidMount() {
        // Mark hydration as complete
        this.setState({ isHydrating: false });
    }

    render() {
        // If hydration error occurred during hydration phase, force client-side rendering
        if (this.state.hasError && this.state.isHydrating) {
            return this.props.fallback || <ClientOnlyWrapper>{this.props.children}</ClientOnlyWrapper>;
        }

        // If error occurred after hydration, show fallback or children
        if (this.state.hasError) {
            return this.props.fallback || this.props.children;
        }

        return this.props.children;
    }
}

/**
 * Wrapper component that only renders children on the client after mount.
 * Shows a placeholder during SSR to prevent hydration mismatches.
 * 
 * **Validates: Requirements 5.1, 5.3, 5.4**
 */
export function ClientOnlyWrapper({ 
    children, 
    placeholder 
}: { 
    children: ReactNode; 
    placeholder?: ReactNode;
}) {
    const [hasMounted, setHasMounted] = React.useState(false);

    React.useEffect(() => {
        setHasMounted(true);
    }, []);

    if (!hasMounted) {
        return placeholder || <div className="hydration-placeholder" style={{ minHeight: "inherit" }} />;
    }

    return <>{children}</>;
}
