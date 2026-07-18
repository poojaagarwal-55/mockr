"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/auth-context";
import { useBilling } from "@/hooks/use-billing";
import { api } from "@/lib/api";

type ExpertAdminUser = {
    id: string;
    email: string;
    fullName: string;
    avatarUrl: string | null;
    isExpert: boolean;
    createdAt: string;
    profile: {
        expertiseTags: string[];
        yearsExperience: number | null;
        acceptingBookings: boolean;
        sessionsCompleted: number;
    } | null;
};

function NotAuthorized() {
    const router = useRouter();
    useEffect(() => {
        const timer = setTimeout(() => router.replace("/dashboard"), 2000);
        return () => clearTimeout(timer);
    }, [router]);

    return (
        <main className="flex min-h-[60vh] flex-col items-center justify-center px-6 text-center">
            <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-rose-50 text-rose-500">
                <span className="material-symbols-outlined text-3xl">lock</span>
            </div>
            <h1 className="text-xl font-bold text-slate-950 dark:text-white">Page not found</h1>
            <p className="mt-2 text-sm text-slate-500">Redirecting you back to the dashboard...</p>
        </main>
    );
}

export default function AdminExpertsPage() {
    const { session } = useAuth();
    const { snapshot, loading: billingLoading } = useBilling();
    const token = session?.access_token;

    const [search, setSearch] = useState("");
    const [expertsOnly, setExpertsOnly] = useState(false);
    const [users, setUsers] = useState<ExpertAdminUser[]>([]);
    const [loading, setLoading] = useState(false);
    const [savingEmail, setSavingEmail] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [notice, setNotice] = useState<string | null>(null);

    const stats = useMemo(() => {
        const experts = users.filter((user) => user.isExpert).length;
        const accepting = users.filter((user) => user.profile?.acceptingBookings).length;
        return { total: users.length, experts, accepting };
    }, [users]);

    const loadUsers = useCallback(async () => {
        if (!token || !snapshot?.isAdmin) return;
        setLoading(true);
        setError(null);
        try {
            const params = new URLSearchParams();
            if (search.trim()) params.set("search", search.trim());
            if (expertsOnly) params.set("expertsOnly", "true");
            const result = await api.get<{ users: ExpertAdminUser[] }>(
                `/admin/experts?${params.toString()}`,
                token
            );
            setUsers(result.users);
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to load users");
        } finally {
            setLoading(false);
        }
    }, [token, snapshot?.isAdmin, search, expertsOnly]);

    useEffect(() => {
        loadUsers();
    }, [loadUsers]);

    async function toggleExpert(user: ExpertAdminUser) {
        if (!token) return;
        setSavingEmail(user.email);
        setError(null);
        setNotice(null);
        try {
            const next = !user.isExpert;
            await api.patch("/admin/experts/role", { email: user.email, isExpert: next }, token);
            setUsers((current) =>
                current.map((item) => (item.id === user.id ? { ...item, isExpert: next } : item))
            );
            setNotice(`${user.fullName || user.email} is ${next ? "now" : "no longer"} an expert.`);
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to update expert role");
        } finally {
            setSavingEmail(null);
        }
    }

    if (!billingLoading && !snapshot?.isAdmin) return <NotAuthorized />;

    return (
        <main className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
            <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm dark:border-lc-border dark:bg-lc-surface">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                    <div>
                        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-emerald-600">Admin</p>
                        <h1 className="mt-1 text-2xl font-bold text-slate-950 dark:text-white">Expert access</h1>
                        <p className="mt-2 max-w-2xl text-sm text-slate-500 dark:text-slate-400">
                            Assign trusted interviewers by email. Experts keep their normal candidate tools and get a dedicated expert workspace.
                        </p>
                    </div>
                    <div className="grid grid-cols-3 gap-2 text-center">
                        <div className="rounded-lg border border-slate-200 px-4 py-3 dark:border-lc-border">
                            <div className="text-xl font-bold text-slate-950 dark:text-white">{stats.total}</div>
                            <div className="text-xs text-slate-500">Shown</div>
                        </div>
                        <div className="rounded-lg border border-slate-200 px-4 py-3 dark:border-lc-border">
                            <div className="text-xl font-bold text-emerald-600">{stats.experts}</div>
                            <div className="text-xs text-slate-500">Experts</div>
                        </div>
                        <div className="rounded-lg border border-slate-200 px-4 py-3 dark:border-lc-border">
                            <div className="text-xl font-bold text-sky-600">{stats.accepting}</div>
                            <div className="text-xs text-slate-500">Accepting</div>
                        </div>
                    </div>
                </div>
            </section>

            <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm dark:border-lc-border dark:bg-lc-surface">
                <div className="flex flex-col gap-3 md:flex-row md:items-center">
                    <div className="relative flex-1">
                        <span className="material-symbols-outlined pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[20px] text-slate-400">
                            search
                        </span>
                        <input
                            value={search}
                            onChange={(event) => setSearch(event.target.value)}
                            placeholder="Search by name or email"
                            className="h-11 w-full rounded-lg border border-slate-200 bg-white pl-10 pr-3 text-sm outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100 dark:border-lc-border dark:bg-lc-bg dark:text-white"
                        />
                    </div>
                    <label className="flex h-11 items-center gap-2 rounded-lg border border-slate-200 px-3 text-sm font-medium text-slate-700 dark:border-lc-border dark:text-slate-200">
                        <input
                            type="checkbox"
                            checked={expertsOnly}
                            onChange={(event) => setExpertsOnly(event.target.checked)}
                            className="h-4 w-4 rounded border-slate-300 text-emerald-600"
                        />
                        Experts only
                    </label>
                    <button
                        onClick={loadUsers}
                        disabled={loading}
                        className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-slate-950 px-4 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                        <span className="material-symbols-outlined text-[19px]">refresh</span>
                        Refresh
                    </button>
                </div>
                {error && <p className="mt-3 text-sm font-medium text-rose-600">{error}</p>}
                {notice && <p className="mt-3 text-sm font-medium text-emerald-700">{notice}</p>}
            </section>

            <section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm dark:border-lc-border dark:bg-lc-surface">
                <div className="border-b border-slate-200 px-4 py-3 text-sm font-semibold text-slate-700 dark:border-lc-border dark:text-slate-200">
                    Users
                </div>
                <div className="divide-y divide-slate-100 dark:divide-lc-border">
                    {loading && (
                        <div className="px-4 py-10 text-center text-sm text-slate-500">Loading users...</div>
                    )}
                    {!loading && users.length === 0 && (
                        <div className="px-4 py-10 text-center text-sm text-slate-500">No users found.</div>
                    )}
                    {!loading && users.map((user) => (
                        <div key={user.id} className="flex flex-col gap-4 px-4 py-4 lg:flex-row lg:items-center lg:justify-between">
                            <div className="min-w-0">
                                <div className="flex flex-wrap items-center gap-2">
                                    <h2 className="truncate text-base font-bold text-slate-950 dark:text-white">{user.fullName}</h2>
                                    {user.isExpert && (
                                        <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700">
                                            Expert
                                        </span>
                                    )}
                                    {user.profile?.acceptingBookings && (
                                        <span className="rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-xs font-semibold text-sky-700">
                                            Accepting
                                        </span>
                                    )}
                                </div>
                                <p className="mt-1 text-sm text-slate-500">{user.email}</p>
                                {user.profile && (
                                    <p className="mt-2 text-xs text-slate-500">
                                        {user.profile.sessionsCompleted} sessions
                                        {user.profile.yearsExperience ? `, ${user.profile.yearsExperience} years exp.` : ""}
                                        {user.profile.expertiseTags.length > 0 ? `, ${user.profile.expertiseTags.join(", ")}` : ""}
                                    </p>
                                )}
                            </div>
                            <button
                                onClick={() => toggleExpert(user)}
                                disabled={savingEmail === user.email}
                                className={`inline-flex h-10 items-center justify-center gap-2 rounded-lg px-4 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-60 ${
                                    user.isExpert
                                        ? "border border-rose-200 bg-white text-rose-700 hover:bg-rose-50"
                                        : "bg-emerald-600 text-white hover:bg-emerald-700"
                                }`}
                            >
                                <span className="material-symbols-outlined text-[19px]">
                                    {user.isExpert ? "person_remove" : "workspace_premium"}
                                </span>
                                {user.isExpert ? "Remove expert" : "Make expert"}
                            </button>
                        </div>
                    ))}
                </div>
            </section>
        </main>
    );
}
