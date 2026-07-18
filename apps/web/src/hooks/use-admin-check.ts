"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/context/auth-context";
import { api, ApiError } from "@/lib/api";

type AdminState = {
    isAdmin: boolean;
    loading: boolean;
    error: string | null;
};

export function useAdminCheck(): AdminState {
    const { session } = useAuth();
    const [state, setState] = useState<AdminState>({
        isAdmin: false,
        loading: true,
        error: null,
    });

    useEffect(() => {
        let mounted = true;
        const token = session?.access_token;

        if (!token) {
            setState({ isAdmin: false, loading: false, error: null });
            return () => {
                mounted = false;
            };
        }

        setState((prev) => ({ ...prev, loading: true, error: null }));

        api.get<{ isAdmin: boolean }>("/admin/check", token)
            .then(() => {
                if (!mounted) return;
                setState({ isAdmin: true, loading: false, error: null });
            })
            .catch((err) => {
                if (!mounted) return;
                if (err instanceof ApiError && (err.status === 401 || err.status === 404)) {
                    setState({ isAdmin: false, loading: false, error: null });
                    return;
                }
                setState({
                    isAdmin: false,
                    loading: false,
                    error: err instanceof Error ? err.message : "Failed to check admin status",
                });
            });

        return () => {
            mounted = false;
        };
    }, [session?.access_token]);

    return state;
}
