"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAdminCheck } from "@/hooks/use-admin-check";
import { useAuth } from "@/context/auth-context";
import { api, ApiError } from "@/lib/api";

type AdminUser = {
    id: string;
    email: string;
    fullName: string;
    role: string;
    placementCollegeEmailDomain: string | null;
    createdAt?: string;
};

function NotAuthorized() {
    const router = useRouter();

    useEffect(() => {
        const timeout = setTimeout(() => router.replace("/dashboard"), 2500);
        return () => clearTimeout(timeout);
    }, [router]);

    return (
        <div className="flex min-h-[60vh] flex-col items-center justify-center px-6 text-center">
            <div className="mb-5 grid h-16 w-16 place-items-center rounded-full bg-rose-50 text-rose-500">
                <span className="material-symbols-outlined text-[34px]">lock</span>
            </div>
            <h1 className="text-xl font-bold text-slate-950 dark:text-white">Page not found</h1>
            <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">Redirecting you back to the dashboard...</p>
        </div>
    );
}

function roleBadge(user: AdminUser) {
    if (user.role === "contest_creator") {
        return (
            <span className="inline-flex items-center rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 text-xs font-bold text-blue-700 dark:border-blue-400/30 dark:bg-blue-400/10 dark:text-blue-300">
                Contest Creator
            </span>
        );
    }

    if (user.role === "placement_coordinator") {
        return (
            <span className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-bold text-emerald-700 dark:border-emerald-400/30 dark:bg-emerald-400/10 dark:text-emerald-300">
                Coordinator
            </span>
        );
    }

    return (
        <span className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-bold text-slate-600 dark:border-lc-border dark:bg-lc-hover dark:text-slate-300">
            User
        </span>
    );
}

export default function ContestCreatorsAdminPage() {
    const { session } = useAuth();
    const { isAdmin, loading: adminLoading } = useAdminCheck();
    const token = session?.access_token;

    const [creators, setCreators] = useState<AdminUser[]>([]);
    const [searchResults, setSearchResults] = useState<AdminUser[]>([]);
    const [search, setSearch] = useState("");
    const [loading, setLoading] = useState(true);
    const [searching, setSearching] = useState(false);
    const [savingId, setSavingId] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState<string | null>(null);

    const loadCreators = useCallback(async () => {
        if (!token || !isAdmin) return;
        setLoading(true);
        setError(null);

        try {
            const data = await api.get<{ creators: AdminUser[] }>("/admin/contest-creators?limit=100", token);
            setCreators(data.creators);
        } catch (err) {
            setError(err instanceof ApiError ? err.message : "Failed to load contest creators");
        } finally {
            setLoading(false);
        }
    }, [isAdmin, token]);

    useEffect(() => {
        void loadCreators();
    }, [loadCreators]);

    const handleSearch = async (event: FormEvent) => {
        event.preventDefault();
        if (!token || search.trim().length < 2) return;

        setSearching(true);
        setError(null);
        setSuccess(null);

        try {
            const data = await api.get<{ users: AdminUser[] }>(
                `/admin/users/search?query=${encodeURIComponent(search.trim())}&limit=25`,
                token
            );
            setSearchResults(data.users);
        } catch (err) {
            setError(err instanceof ApiError ? err.message : "Failed to search users");
        } finally {
            setSearching(false);
        }
    };

    const assignCreator = async (user: AdminUser) => {
        if (!token) return;

        setSavingId(user.id);
        setError(null);
        setSuccess(null);

        try {
            const data = await api.patch<{ creator: AdminUser }>(`/admin/users/${user.id}/contest-creator`, {}, token);
            setSuccess(`${data.creator.fullName} can now create and manage contests.`);
            setSearchResults((prev) => prev.map((item) => (item.id === user.id ? data.creator : item)));
            await loadCreators();
        } catch (err) {
            setError(err instanceof ApiError ? err.message : "Failed to assign contest creator");
        } finally {
            setSavingId(null);
        }
    };

    const removeCreator = async (user: AdminUser) => {
        if (!token) return;

        setSavingId(user.id);
        setError(null);
        setSuccess(null);

        try {
            const data = await api.delete<{ user: AdminUser }>(`/admin/users/${user.id}/contest-creator`, token);
            setSuccess(`${data.user.fullName} is no longer a contest creator.`);
            setSearchResults((prev) => prev.map((item) => (item.id === user.id ? data.user : item)));
            await loadCreators();
        } catch (err) {
            setError(err instanceof ApiError ? err.message : "Failed to remove contest creator");
        } finally {
            setSavingId(null);
        }
    };

    if (adminLoading) {
        return (
            <div className="grid min-h-[60vh] place-items-center">
                <div className="h-9 w-9 animate-spin rounded-full border-4 border-primary/20 border-t-primary" />
            </div>
        );
    }

    if (!isAdmin) return <NotAuthorized />;

    return (
        <main className="min-h-full bg-slate-50 px-4 py-8 dark:bg-lc-bg sm:px-6">
            <div className="mx-auto max-w-7xl space-y-6">
                <header className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-lc-border dark:bg-lc-surface">
                    <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
                        <div>
                            <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-primary/15 bg-primary/5 px-3 py-1 text-xs font-bold text-primary">
                                <span className="material-symbols-outlined text-[16px]">manage_accounts</span>
                                Admin Access
                            </div>
                            <h1 className="font-nunito text-[30px] font-extrabold tracking-tight text-slate-950 dark:text-white">
                                Contest Creators
                            </h1>
                            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600 dark:text-slate-300">
                                Give trusted users access to create contest questions, build contests, and manage contest settings.
                            </p>
                        </div>
                        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-lc-border dark:bg-lc-hover sm:min-w-[220px]">
                            <p className="text-xs font-bold uppercase text-slate-500 dark:text-slate-400">Contest Creators</p>
                            <p className="mt-1 text-3xl font-extrabold text-slate-950 dark:text-white">{creators.length}</p>
                        </div>
                    </div>
                </header>

                {(error || success) && (
                    <div
                        className={`rounded-xl border px-4 py-3 text-sm font-semibold ${
                            error
                                ? "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-400/30 dark:bg-rose-400/10 dark:text-rose-200"
                                : "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-400/30 dark:bg-emerald-400/10 dark:text-emerald-200"
                        }`}
                    >
                        {error || success}
                    </div>
                )}

                <section className="rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-lc-border dark:bg-lc-surface">
                    <div className="border-b border-slate-200 p-5 dark:border-lc-border">
                        <h2 className="text-lg font-extrabold text-slate-950 dark:text-white">Assign Role</h2>
                        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                            Search by name or email. This role does not need a domain.
                        </p>
                    </div>
                    <div className="p-5">
                        <form onSubmit={handleSearch} className="flex flex-col gap-3 md:flex-row">
                            <input
                                value={search}
                                onChange={(event) => setSearch(event.target.value)}
                                placeholder="Search user by name or email"
                                className="min-h-11 flex-1 rounded-lg border border-slate-200 bg-white px-4 text-sm outline-none transition focus:border-primary focus:ring-4 focus:ring-primary/10 dark:border-lc-border dark:bg-lc-bg dark:text-white"
                            />
                            <button
                                type="submit"
                                disabled={searching || search.trim().length < 2}
                                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-primary px-5 text-sm font-bold text-white shadow-sm transition hover:bg-primary/90 disabled:opacity-60"
                            >
                                <span className={`material-symbols-outlined text-[18px] ${searching ? "animate-spin" : ""}`}>search</span>
                                {searching ? "Searching" : "Search"}
                            </button>
                        </form>

                        <div className="mt-5 overflow-x-auto rounded-xl border border-slate-200 dark:border-lc-border">
                            <table className="min-w-full divide-y divide-slate-200 text-sm dark:divide-lc-border">
                                <thead className="bg-slate-50 text-left text-xs font-bold uppercase tracking-wide text-slate-500 dark:bg-lc-hover dark:text-slate-400">
                                    <tr>
                                        <th className="px-4 py-3">User</th>
                                        <th className="px-4 py-3">Current role</th>
                                        <th className="px-4 py-3">Access</th>
                                        <th className="px-4 py-3 text-right">Action</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100 dark:divide-lc-border">
                                    {searchResults.length === 0 ? (
                                        <tr>
                                            <td colSpan={4} className="px-4 py-8 text-center text-slate-500 dark:text-slate-400">
                                                Search for a user to assign contest creator access.
                                            </td>
                                        </tr>
                                    ) : (
                                        searchResults.map((user) => (
                                            <tr key={user.id} className="bg-white dark:bg-lc-surface">
                                                <td className="px-4 py-4">
                                                    <p className="font-bold text-slate-950 dark:text-white">{user.fullName}</p>
                                                    <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{user.email}</p>
                                                </td>
                                                <td className="px-4 py-4">{roleBadge(user)}</td>
                                                <td className="px-4 py-4 text-sm font-semibold text-slate-600 dark:text-slate-300">
                                                    {user.role === "contest_creator" ? "Can manage contests" : "No contest creator access"}
                                                </td>
                                                <td className="px-4 py-4 text-right">
                                                    {user.role === "contest_creator" ? (
                                                        <button
                                                            type="button"
                                                            onClick={() => removeCreator(user)}
                                                            disabled={savingId === user.id}
                                                            className="inline-flex items-center gap-2 rounded-lg border border-rose-200 px-3 py-2 text-xs font-bold text-rose-700 transition hover:bg-rose-50 disabled:opacity-60 dark:border-rose-400/30 dark:text-rose-300 dark:hover:bg-rose-400/10"
                                                        >
                                                            <span className="material-symbols-outlined text-[16px]">person_remove</span>
                                                            Remove
                                                        </button>
                                                    ) : (
                                                        <button
                                                            type="button"
                                                            onClick={() => assignCreator(user)}
                                                            disabled={savingId === user.id}
                                                            className="inline-flex items-center gap-2 rounded-lg bg-slate-950 px-3 py-2 text-xs font-bold text-white transition hover:bg-slate-800 disabled:opacity-60 dark:bg-white dark:text-slate-950"
                                                        >
                                                            <span className="material-symbols-outlined text-[16px]">person_add</span>
                                                            Assign
                                                        </button>
                                                    )}
                                                </td>
                                            </tr>
                                        ))
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </section>

                <section className="rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-lc-border dark:bg-lc-surface">
                    <div className="flex items-center justify-between border-b border-slate-200 p-5 dark:border-lc-border">
                        <div>
                            <h2 className="text-lg font-extrabold text-slate-950 dark:text-white">Current Contest Creators</h2>
                            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                                These users can access contest management and question creation.
                            </p>
                        </div>
                        <button
                            type="button"
                            onClick={() => void loadCreators()}
                            className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 dark:border-lc-border dark:text-slate-200 dark:hover:bg-lc-hover"
                        >
                            <span className="material-symbols-outlined text-[16px]">refresh</span>
                            Refresh
                        </button>
                    </div>
                    <div className="overflow-x-auto">
                        <table className="min-w-full divide-y divide-slate-200 text-sm dark:divide-lc-border">
                            <thead className="bg-slate-50 text-left text-xs font-bold uppercase tracking-wide text-slate-500 dark:bg-lc-hover dark:text-slate-400">
                                <tr>
                                    <th className="px-5 py-3">Creator</th>
                                    <th className="px-5 py-3">Role</th>
                                    <th className="px-5 py-3 text-right">Action</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100 dark:divide-lc-border">
                                {loading ? (
                                    <tr>
                                        <td colSpan={3} className="px-5 py-10 text-center text-slate-500 dark:text-slate-400">
                                            Loading contest creators...
                                        </td>
                                    </tr>
                                ) : creators.length === 0 ? (
                                    <tr>
                                        <td colSpan={3} className="px-5 py-10 text-center text-slate-500 dark:text-slate-400">
                                            No contest creators assigned yet.
                                        </td>
                                    </tr>
                                ) : (
                                    creators.map((user) => (
                                        <tr key={user.id}>
                                            <td className="px-5 py-4">
                                                <p className="font-bold text-slate-950 dark:text-white">{user.fullName}</p>
                                                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{user.email}</p>
                                            </td>
                                            <td className="px-5 py-4">{roleBadge(user)}</td>
                                            <td className="px-5 py-4 text-right">
                                                <button
                                                    type="button"
                                                    onClick={() => removeCreator(user)}
                                                    disabled={savingId === user.id}
                                                    className="inline-flex items-center gap-2 rounded-lg border border-rose-200 px-3 py-2 text-xs font-bold text-rose-700 transition hover:bg-rose-50 disabled:opacity-60 dark:border-rose-400/30 dark:text-rose-300 dark:hover:bg-rose-400/10"
                                                >
                                                    <span className="material-symbols-outlined text-[16px]">person_remove</span>
                                                    Remove
                                                </button>
                                            </td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>
                </section>
            </div>
        </main>
    );
}
