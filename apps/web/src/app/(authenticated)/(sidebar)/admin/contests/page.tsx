"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/auth-context";
import { useContestManagerCheck } from "@/hooks/use-contest-manager-check";

interface Contest {
  id: string;
  title: string;
  description: string;
  startTime: string;
  endTime: string;
  status: "UPCOMING" | "ACTIVE" | "ENDED";
  showParticipants?: boolean;
  isArchived?: boolean;
  isUnderTesting?: boolean;
  _count: {
    questions: number;
    participants: number;
  };
}

type ApiErrorPayload = {
  message?: string;
};

function NotAuthorized() {
  const router = useRouter();
  useEffect(() => {
    const t = setTimeout(() => router.replace("/dashboard"), 2500);
    return () => clearTimeout(t);
  }, [router]);
  return (
    <div className="flex flex-col items-center justify-center flex-1 min-h-[60vh] text-center px-6">
      <div className="w-16 h-16 rounded-full bg-rose-50 flex items-center justify-center mb-5">
        <svg viewBox="0 0 24 24" className="h-8 w-8 text-rose-500" fill="none" stroke="currentColor" strokeWidth="2">
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
        </svg>
      </div>
      <h1 className="text-xl font-bold text-neutral-900">Page not found</h1>
      <p className="mt-2 text-sm text-neutral-500">Redirecting you back to the dashboard...</p>
    </div>
  );
}

export default function AdminContestsPage() {
  const router = useRouter();
  const { session } = useAuth();
  const { isContestManager, loading: managerLoading } = useContestManagerCheck();
  const token = session?.access_token;
  const [contests, setContests] = useState<Contest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [generatingLeaderboardFor, setGeneratingLeaderboardFor] = useState<string | null>(null);
  const [togglingParticipantsFor, setTogglingParticipantsFor] = useState<string | null>(null);
  const [togglingArchiveFor, setTogglingArchiveFor] = useState<string | null>(null);

  const fetchContests = useCallback(async () => {
    if (!token) return;
    try {
      const contestApiUrl = process.env.NEXT_PUBLIC_CONTEST_API_URL || "http://localhost:3002";
      const response = await fetch(`${contestApiUrl}/admin/contests`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) throw new Error("Failed to fetch contests");

      const data = await response.json();
      setContests(data.contests || []);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to fetch contests");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    if (!isContestManager || !token) return;
    fetchContests();
  }, [fetchContests, isContestManager, token]);

  const handleCreateContest = () => {
    router.push("/admin/contests/new");
  };

  const handleManageContest = (contestId: string) => {
    router.push(`/admin/contests/${contestId}/manage`);
  };

  const handleCreateLeaderboard = async (contestId: string) => {
    if (!session?.access_token) return;
    setError(null);
    setNotice(null);
    setGeneratingLeaderboardFor(contestId);

    try {
      const contestApiUrl = process.env.NEXT_PUBLIC_CONTEST_API_URL || "http://localhost:3002";
      const response = await fetch(`${contestApiUrl}/admin/contests/${contestId}/leaderboard/generated`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      });

      const data = await response.json().catch(() => ({})) as ApiErrorPayload & { totalParticipants?: number };
      if (!response.ok) {
        throw new Error(data.message || "Failed to create leaderboard");
      }

      setNotice(`Leaderboard created with ${data.totalParticipants || 0} participants.`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to create leaderboard");
    } finally {
      setGeneratingLeaderboardFor(null);
    }
  };

  const handleToggleParticipants = async (contest: Contest) => {
    if (!token) return;
    const nextShowParticipants = !contest.showParticipants;
    setError(null);
    setNotice(null);
    setTogglingParticipantsFor(contest.id);

    try {
      const contestApiUrl = process.env.NEXT_PUBLIC_CONTEST_API_URL || "http://localhost:3002";
      const response = await fetch(`${contestApiUrl}/contests/${contest.id}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ showParticipants: nextShowParticipants }),
      });

      const data = await response.json().catch(() => ({})) as ApiErrorPayload;
      if (!response.ok) {
        throw new Error(data.message || "Failed to update participant visibility");
      }

      setContests((current) =>
        current.map((item) =>
          item.id === contest.id ? { ...item, showParticipants: nextShowParticipants } : item
        )
      );
      setNotice(`Participant count is now ${nextShowParticipants ? "visible" : "hidden"} for ${contest.title}.`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to update participant visibility");
    } finally {
      setTogglingParticipantsFor(null);
    }
  };

  const handleToggleArchive = async (contest: Contest) => {
    if (!token) return;
    const nextArchived = !contest.isArchived;
    setError(null);
    setNotice(null);
    setTogglingArchiveFor(contest.id);

    try {
      const contestApiUrl = process.env.NEXT_PUBLIC_CONTEST_API_URL || "http://localhost:3002";
      const response = await fetch(`${contestApiUrl}/contests/${contest.id}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ isArchived: nextArchived }),
      });

      const data = await response.json().catch(() => ({})) as ApiErrorPayload;
      if (!response.ok) {
        throw new Error(data.message || "Failed to update contest archive state");
      }

      setContests((current) =>
        current.map((item) =>
          item.id === contest.id ? { ...item, isArchived: nextArchived } : item
        )
      );
      setNotice(`${contest.title} is now ${nextArchived ? "archived" : "unarchived"}.`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to update contest archive state");
    } finally {
      setTogglingArchiveFor(null);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "UPCOMING":
        return "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300";
      case "ACTIVE":
        return "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300";
      case "ENDED":
        return "bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-300";
      default:
        return "bg-gray-100 text-gray-800";
    }
  };

  if (managerLoading) {
    return (
      <div className="flex items-center justify-center flex-1 min-h-[60vh]">
        <div className="size-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!isContestManager) return <NotAuthorized />;

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-lg text-slate-600 dark:text-slate-400">Loading contests...</div>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8 max-w-7xl">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold text-slate-900 dark:text-white">Manage Contests</h1>
          <p className="text-slate-600 dark:text-slate-400 mt-2">
            Create and manage coding contests
          </p>
        </div>
        <button
          onClick={handleCreateContest}
          className="px-6 py-3 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700 transition-colors"
        >
          + Create Contest
        </button>
      </div>

      {error && (
        <div className="mb-6 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-red-700 dark:text-red-200">
          {error}
        </div>
      )}
      {notice && (
        <div className="mb-6 p-4 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 rounded-lg text-emerald-700 dark:text-emerald-200">
          {notice}
        </div>
      )}

      {contests.length === 0 ? (
        <div className="text-center py-16">
          <div className="text-6xl mb-4">🏆</div>
          <h3 className="text-xl font-semibold text-slate-900 dark:text-white mb-2">
            No contests yet
          </h3>
          <p className="text-slate-600 dark:text-slate-400 mb-6">
            Create your first contest to get started
          </p>
          <button
            onClick={handleCreateContest}
            className="px-6 py-3 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700 transition-colors"
          >
            Create Contest
          </button>
        </div>
      ) : (
        <div className="grid gap-6">
          {contests.map((contest) => (
            <div
              key={contest.id}
              className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 p-6 hover:shadow-md transition-shadow"
            >
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-2">
                    <h3 className="text-xl font-bold text-slate-900 dark:text-white">
                      {contest.title}
                    </h3>
                    <span
                      className={`px-3 py-1 rounded-full text-xs font-semibold ${getStatusColor(
                        contest.status
                      )}`}
                    >
                      {contest.status}
                    </span>
                    {contest.isArchived && (
                      <span className="rounded-full bg-rose-100 px-3 py-1 text-xs font-semibold text-rose-700 dark:bg-rose-500/15 dark:text-rose-200">
                        ARCHIVED
                      </span>
                    )}
                    {contest.isUnderTesting && (
                      <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-700 dark:bg-amber-500/15 dark:text-amber-200">
                        TESTING
                      </span>
                    )}
                  </div>
                  <p className="text-slate-600 dark:text-slate-400 mb-4">
                    {contest.description}
                  </p>
                  <div className="flex items-center gap-6 text-sm text-slate-500 dark:text-slate-400">
                    <div>
                      <span className="font-semibold">Start:</span>{" "}
                      {new Date(contest.startTime).toLocaleString()}
                    </div>
                    <div>
                      <span className="font-semibold">End:</span>{" "}
                      {new Date(contest.endTime).toLocaleString()}
                    </div>
                    <div>
                      <span className="font-semibold">Questions:</span> {contest._count.questions}
                    </div>
                    <div>
                      <span className="font-semibold">Participants:</span>{" "}
                      {contest._count.participants}
                    </div>
                    <div>
                      <span className="font-semibold">Public count:</span>{" "}
                      {contest.showParticipants ? "Shown" : "Hidden"}
                    </div>
                  </div>
                </div>
                <div className="ml-4 flex shrink-0 flex-col gap-2 sm:flex-row">
                  <button
                    onClick={() => handleToggleParticipants(contest)}
                    disabled={togglingParticipantsFor === contest.id}
                    className="px-4 py-2 bg-slate-100 dark:bg-slate-700 text-slate-900 dark:text-white rounded-lg font-medium hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {togglingParticipantsFor === contest.id
                      ? "Saving..."
                      : contest.showParticipants
                        ? "Hide Count"
                        : "Show Count"}
                  </button>
                  <button
                    onClick={() => handleToggleArchive(contest)}
                    disabled={togglingArchiveFor === contest.id}
                    className={`px-4 py-2 rounded-lg font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
                      contest.isArchived
                        ? "bg-emerald-600 text-white hover:bg-emerald-700"
                        : "bg-rose-600 text-white hover:bg-rose-700"
                    }`}
                  >
                    {togglingArchiveFor === contest.id
                      ? "Saving..."
                      : contest.isArchived
                        ? "Unarchive Contest"
                        : "Archive Contest"}
                  </button>
                  {contest.status === "ENDED" && (
                    <button
                      onClick={() => handleCreateLeaderboard(contest.id)}
                      disabled={generatingLeaderboardFor === contest.id}
                      className="px-4 py-2 bg-emerald-600 text-white rounded-lg font-medium hover:bg-emerald-700 transition-colors disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {generatingLeaderboardFor === contest.id ? "Creating..." : "Create Leaderboard"}
                    </button>
                  )}
                  <button
                    onClick={() => handleManageContest(contest.id)}
                    className="px-4 py-2 bg-slate-100 dark:bg-slate-700 text-slate-900 dark:text-white rounded-lg font-medium hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors"
                  >
                    Manage
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
