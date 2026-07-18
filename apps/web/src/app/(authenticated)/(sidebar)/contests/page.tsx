'use client';

import { useCallback, useEffect, useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Calendar, Clock, Loader2, Trophy, Users } from 'lucide-react';
import { createSupabaseBrowserClient } from '@/lib/supabase';
import { PeerInterviewBanner } from '@/components/contest/peer-interview-banner';

interface Contest {
  id: string;
  title: string;
  description: string;
  startTime: string;
  endTime: string;
  status: 'UPCOMING' | 'ACTIVE' | 'ENDED';
  showParticipants?: boolean;
  isArchived?: boolean;
  isUnderTesting?: boolean;
  _count: {
    questions: number;
    participants: number;
  };
  isRegistered?: boolean;
  isSubmitted?: boolean;
}

type TabType = 'current' | 'past' | 'my';
type ParticipationStatus = { isRegistered: boolean; isSubmitted: boolean };
type ContestPopupState = {
  title: string;
  message: string;
  tone?: 'default' | 'error';
};

function deriveContestStatus(contest: Pick<Contest, 'startTime' | 'endTime' | 'status'>): Contest['status'] {
  const now = Date.now();
  const start = new Date(contest.startTime).getTime();
  const end = new Date(contest.endTime).getTime();

  if (Number.isFinite(end) && now >= end) return 'ENDED';
  if (Number.isFinite(start) && now >= start) return 'ACTIVE';
  return 'UPCOMING';
}

function isVisibleContest(contest: Contest) {
  return contest.isArchived !== true;
}

function ContestPopup({
  popup,
  onClose,
}: {
  popup: ContestPopupState | null;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!popup) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [popup, onClose]);

  if (!popup) return null;

  const isError = popup.tone === 'error';

  return (
    <div className="fixed inset-0 z-[140] grid place-items-center bg-slate-950/45 p-4 dark:bg-black/65">
      <button
        type="button"
        aria-label="Close popup"
        className="absolute inset-0 cursor-default"
        onClick={onClose}
      />
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="contest-popup-title"
        aria-describedby="contest-popup-message"
        className="relative w-full max-w-sm rounded-lg border border-slate-200 bg-white p-5 shadow-xl dark:border-lc-border dark:bg-lc-surface"
      >
        <h2 id="contest-popup-title" className="font-nunito text-lg font-extrabold text-slate-950 dark:text-white">
          {popup.title}
        </h2>
        <p id="contest-popup-message" className="mt-2 text-sm font-semibold leading-6 text-slate-600 dark:text-slate-300">
          {popup.message}
        </p>
        <div className="mt-5 flex justify-end">
          <Button
            type="button"
            onClick={onClose}
            className={`h-10 rounded-md px-5 font-extrabold ${isError ? 'bg-red-600 hover:bg-red-700 dark:bg-red-500 dark:hover:bg-red-600' : ''}`}
          >
            OK
          </Button>
        </div>
      </section>
    </div>
  );
}

// Global cache shared across all users (for current/upcoming contests)
let globalContestsCache: Contest[] | null = null;

export default function ContestsPage() {
  const router = useRouter();
  const [contests, setContests] = useState<Contest[]>([]);
  const [loading, setLoading] = useState(true);
  const [registering, setRegistering] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabType>('current');
  const [userId, setUserId] = useState<string | null>(null);
  const [nowTick, setNowTick] = useState(Date.now());
  const [popup, setPopup] = useState<ContestPopupState | null>(null);
  const closePopup = useCallback(() => setPopup(null), []);
  
  // User-specific caches
  const userRegistrationCache = useRef<Map<string, ParticipationStatus>>(new Map());
  const myContestsCache = useRef<Contest[] | null>(null);
  const isFetching = useRef(false);

  useEffect(() => {
    fetchUserId();
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setNowTick(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (userId) {
      if (activeTab === 'current') {
        loadCurrentContests();
      } else if (activeTab === 'past') {
        loadPastContests();
      } else if (activeTab === 'my') {
        loadMyContests();
      }
    }
  }, [userId, activeTab]);

  // Monitor active contests and clear caches when they end
  useEffect(() => {
    if (!globalContestsCache) return;

    const activeContests = globalContestsCache.filter(c => deriveContestStatus(c) === 'ACTIVE');
    if (activeContests.length === 0) return;

    // Find the earliest end time
    const earliestEndTime = Math.min(
      ...activeContests.map(c => new Date(c.endTime).getTime())
    );

    const now = Date.now();
    const timeUntilEnd = earliestEndTime - now;

    if (timeUntilEnd > 0) {
      // Set a timer to clear caches when contest ends
      const timer = setTimeout(() => {
        
        // Clear global cache to refetch updated statuses
        globalContestsCache = null;
        
        // If user is on current tab, reload
        if (activeTab === 'current') {
          loadCurrentContests();
        }
      }, timeUntilEnd + 1000); // Add 1 second buffer

      return () => clearTimeout(timer);
    }
  }, [globalContestsCache, activeTab]);

  const fetchUserId = async () => {
    try {
      const supabase = createSupabaseBrowserClient();
      const { data: sessionData } = await supabase.auth.getSession();
      const user = sessionData.session?.user;
      if (user) {
        setUserId(user.id);
      }
    } catch (error) {
    }
  };

  const loadCurrentContests = async () => {
    // Fetch fresh data
    if (isFetching.current) return;
    isFetching.current = true;
    setLoading(true);

    try {
      const supabase = createSupabaseBrowserClient();
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;

      const contestApiUrl = process.env.NEXT_PUBLIC_CONTEST_API_URL || 'http://localhost:3002';
      const response = await fetch(`${contestApiUrl}/contests`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        cache: 'no-store',
      });

      if (!response.ok) throw new Error('Failed to fetch contests');

      const data = await response.json();
      const allContests = (data.contests || []).filter(isVisibleContest);

      // Filter current/upcoming contests.
      const currentContests = allContests.filter(
        (c: Contest) => {
          const status = deriveContestStatus(c);
          return status === 'UPCOMING' || status === 'ACTIVE';
        }
      );

      // Update global cache
      globalContestsCache = currentContests;

      // Add user-specific registration status
      const contestsWithRegistration = await addRegistrationStatus(currentContests);
      setContests(contestsWithRegistration);
    } catch (error) {
    } finally {
      setLoading(false);
      isFetching.current = false;
    }
  };

  const loadPastContests = async () => {
    setLoading(true);
    try {
      const supabase = createSupabaseBrowserClient();
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;

      const contestApiUrl = process.env.NEXT_PUBLIC_CONTEST_API_URL || 'http://localhost:3002';
      const response = await fetch(`${contestApiUrl}/contests`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        cache: 'no-store',
      });

      if (!response.ok) throw new Error('Failed to fetch contests');

      const data = await response.json();
      const allContests = (data.contests || []).filter(isVisibleContest);
      const pastContests = allContests.filter((c: Contest) => deriveContestStatus(c) === 'ENDED');

      // Add registration status for past contests
      const contestsWithRegistration = await addRegistrationStatus(pastContests);
      
      setContests(contestsWithRegistration);
    } catch (error) {
    } finally {
      setLoading(false);
    }
  };

  const loadMyContests = async () => {
    setLoading(true);
    try {
      const supabase = createSupabaseBrowserClient();
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;

      if (!token) {
        setContests([]);
        setLoading(false);
        return;
      }

      const contestApiUrl = process.env.NEXT_PUBLIC_CONTEST_API_URL || 'http://localhost:3002';
      
      // Fetch all contests first
      const response = await fetch(`${contestApiUrl}/contests`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
      });

      if (!response.ok) throw new Error('Failed to fetch contests');

      const data = await response.json();
      const allContests = (data.contests || []).filter(isVisibleContest);

      // Filter only registered contests
      const registeredContests = await Promise.all(
        allContests.map(async (contest: Contest) => {
          const participation = await checkRegistrationStatus(contest.id, token, { forceRefresh: true });
          return participation.isRegistered ? { ...contest, ...participation } : null;
        })
      );

      const myContests = registeredContests.filter((c): c is Contest => c !== null);
      
      // Cache the result
      myContestsCache.current = myContests;
      setContests(myContests);
    } catch (error) {
    } finally {
      setLoading(false);
    }
  };

  const addRegistrationStatus = async (contests: Contest[]): Promise<Contest[]> => {
    const supabase = createSupabaseBrowserClient();
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token;

    if (!token || !userId) {
      return contests.map(c => ({ ...c, isRegistered: false }));
    }

    // Check registration status for each contest
    const contestsWithRegistration = await Promise.all(
      contests.map(async (contest) => {
        // Check cache first
        if (userRegistrationCache.current.has(contest.id)) {
          const participation = userRegistrationCache.current.get(contest.id)!;
          return {
            ...contest,
            ...participation,
          };
        }

        // Fetch from API
        const participation = await checkRegistrationStatus(contest.id, token);
        
        // Update cache
        userRegistrationCache.current.set(contest.id, participation);

        return { ...contest, ...participation };
      })
    );

    return contestsWithRegistration;
  };

  const checkRegistrationStatus = async (
    contestId: string,
    token: string,
    options: { forceRefresh?: boolean } = {}
  ): Promise<ParticipationStatus> => {
    try {
      const submittedFromStorage = localStorage.getItem(`contest-submitted-${contestId}`) === 'true';
      if (!options.forceRefresh && userRegistrationCache.current.has(contestId)) {
        const cached = userRegistrationCache.current.get(contestId)!;
        if (!submittedFromStorage || cached.isSubmitted) return cached;
        const participation = { ...cached, isRegistered: true, isSubmitted: true };
        userRegistrationCache.current.set(contestId, participation);
        return participation;
      }

      const contestApiUrl = process.env.NEXT_PUBLIC_CONTEST_API_URL || 'http://localhost:3002';
      const response = await fetch(
        `${contestApiUrl}/contests/${contestId}/my-rank`,
        { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' }
      );
      if (!response.ok) {
        return submittedFromStorage
          ? { isRegistered: true, isSubmitted: true }
          : { isRegistered: false, isSubmitted: false };
      }

      const data = await response.json();
      const participation = {
        isRegistered: true,
        isSubmitted: Boolean(data.participant?.isSubmitted) || submittedFromStorage,
      };
      userRegistrationCache.current.set(contestId, participation);
      return participation;
    } catch {
      return { isRegistered: false, isSubmitted: false };
    }
  };

  const showAlreadySubmittedPopup = useCallback((contestId: string) => {
    userRegistrationCache.current.set(contestId, { isRegistered: true, isSubmitted: true });
    setContests(prevContests =>
      prevContests.map(contest =>
        contest.id === contestId
          ? { ...contest, isRegistered: true, isSubmitted: true }
          : contest
      )
    );
    setPopup({
      title: 'Contest already submitted',
      message: 'You have already submitted this contest.',
      tone: 'error',
    });
  }, []);

  const handleRegister = async (
    contestId: string,
    options: { enterAfterRegister?: boolean } = {}
  ) => {
    setRegistering(contestId);
    try {
      const supabase = createSupabaseBrowserClient();
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;

      if (!token) {
        router.push('/login');
        return;
      }

      const contestApiUrl = process.env.NEXT_PUBLIC_CONTEST_API_URL || 'http://localhost:3002';
      const response = await fetch(
        `${contestApiUrl}/contests/${contestId}/register`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );

      let participantCountDelta = 1;
      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        const message = error.message || 'Failed to register';
        if (/already registered/i.test(message)) {
          participantCountDelta = 0;
          const participation = await checkRegistrationStatus(contestId, token, { forceRefresh: true });
          if (participation.isSubmitted) {
            showAlreadySubmittedPopup(contestId);
            return;
          }
        } else {
          throw new Error(message);
        }
      }

      // 1. Update user registration cache (most important - prevents refetch)
      userRegistrationCache.current.set(contestId, { isRegistered: true, isSubmitted: false });

      // 2. Update global cache with participant count
      if (globalContestsCache) {
        globalContestsCache = globalContestsCache.map(contest =>
          contest.id === contestId
            ? { 
                ...contest,
                _count: { ...contest._count, participants: contest._count.participants + participantCountDelta } 
              }
            : contest
        );
      }

      // 3. Invalidate "My Contests" cache since user just registered
      myContestsCache.current = null;

      // 4. Update local state immediately for instant UI feedback
      setContests(prevContests =>
        prevContests.map(contest =>
          contest.id === contestId
            ? { 
                ...contest, 
                isRegistered: true, 
                isSubmitted: false,
                _count: { ...contest._count, participants: contest._count.participants + participantCountDelta } 
              }
            : contest
        )
      );
      if (options.enterAfterRegister) {
        router.push(`/contests/${contestId}`);
        return;
      }

      setPopup({
        title: 'Registration complete',
        message: 'Successfully registered for contest.',
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Failed to register for contest.';
      setPopup({
        title: 'Registration failed',
        message,
        tone: 'error',
      });
    } finally {
      setRegistering(null);
    }
  };

  const calculateDuration = (startTime: string, endTime: string) => {
    const start = new Date(startTime);
    const end = new Date(endTime);
    const durationMs = end.getTime() - start.getTime();

    return Math.max(0, Math.ceil(durationMs / (1000 * 60)));
  };

  const formatTimeLeft = (endTime: string) => {
    const end = new Date(endTime).getTime();
    const diffMs = Math.max(0, end - nowTick);

    return Math.ceil(diffMs / (1000 * 60));
  };

  const navigateToContest = async (contest: Contest) => {
    const status = deriveContestStatus(contest);
    if (status === 'ACTIVE') {
      const supabase = createSupabaseBrowserClient();
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;

      if (!token) {
        router.push('/login');
        return;
      }

      const participation = await checkRegistrationStatus(contest.id, token, { forceRefresh: true });
      if (participation.isSubmitted) {
        showAlreadySubmittedPopup(contest.id);
        return;
      }

      if (!participation.isRegistered) {
        await handleRegister(contest.id, { enterAfterRegister: true });
        return;
      }

      router.push(`/contests/${contest.id}`);
      return;
    }

    if (contest.isSubmitted && status !== 'ENDED') {
      router.push(`/contests/${contest.id}/submitted`);
      return;
    }

    router.push(`/contests/${contest.id}`);
  };

  const softButtonClass = "h-10 !rounded-[10px] border-0 bg-slate-200/70 px-8 text-sm font-extrabold text-slate-700 shadow-none transition hover:bg-slate-300/70 hover:text-slate-950 dark:bg-white/10 dark:text-slate-100 dark:hover:bg-white/15";

  const getTimeUntilStart = (startTime: string) => {
    const now = new Date();
    const start = new Date(startTime);
    const diffMs = start.getTime() - now.getTime();
    
    if (diffMs <= 0) return 'Started';
    
    const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diffMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    
    if (days > 0) {
      return `Before start ${days} day${days > 1 ? 's' : ''}`;
    } else if (hours > 0) {
      return `Before start ${hours} hour${hours > 1 ? 's' : ''}`;
    } else {
      const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
      return `Before start ${minutes} minute${minutes > 1 ? 's' : ''}`;
    }
  };

  const getContestEyebrow = (contest: Contest, status: Contest['status']) => {
    if (contest.isSubmitted) return 'Submitted';
    if (status === 'ACTIVE') return 'Live Now';
    if (status === 'UPCOMING') return getTimeUntilStart(contest.startTime).replace('Before start ', 'Starts in ');
    return 'Completed';
  };

  const renderActionButton = (contest: Contest) => {
    const status = deriveContestStatus(contest);
    const submittedButtonClass = "h-10 !rounded-[10px] !bg-primary px-8 text-sm font-extrabold !text-white shadow-none transition hover:!bg-primary/90";
    const registerButtonClass = "h-10 !rounded-[10px] !bg-[#0EA66F] px-8 text-sm font-extrabold !text-white shadow-none transition hover:!bg-[#0B8F60] focus-visible:ring-2 focus-visible:!ring-[#0EA66F]/35 disabled:!bg-[#0EA66F]/70";
    const liveButtonClass = "h-10 !rounded-[10px] !bg-emerald-600 px-8 text-sm font-extrabold !text-white shadow-md shadow-emerald-600/15 transition hover:!bg-emerald-700 focus-visible:ring-2 focus-visible:!ring-emerald-500/35 disabled:!bg-emerald-600/70";
    const registeredButtonClass = registerButtonClass;
    
    // ACTIVE contest (started but not ended)
    if (status === 'ACTIVE') {
      if (contest.isRegistered) {
        if (contest.isSubmitted) {
          return (
            <Button
              size="sm"
              className={submittedButtonClass}
              onClick={() => router.push(`/contests/${contest.id}/submitted`)}
            >
              Summary
            </Button>
          );
        }

        return (
          <Button
            size="sm"
            className={liveButtonClass}
            onClick={() => { void navigateToContest(contest); }}
          >
            Enter
          </Button>
        );
      }

      return (
        <Button
          size="sm"
          className={liveButtonClass}
          onClick={() => handleRegister(contest.id, { enterAfterRegister: true })}
          disabled={registering === contest.id}
        >
          {registering === contest.id ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Entering...
            </>
          ) : (
            <>
              Register Now
            </>
          )}
        </Button>
      );
    }
    
    // UPCOMING contest
    if (status === 'UPCOMING') {
      if (contest.isRegistered) {
        return (
          <Button
            size="sm"
            className={registeredButtonClass}
            onClick={() => { void navigateToContest(contest); }}
          >
            Registered
          </Button>
        );
      } else {
        return (
          <Button
            size="sm"
            className={registerButtonClass}
            onClick={() => handleRegister(contest.id)}
            disabled={registering === contest.id}
          >
            {registering === contest.id ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Registering...
              </>
            ) : (
              <>
                Register Now
              </>
            )}
          </Button>
        );
      }
    }
    
    // ENDED contest
    if (status === 'ENDED') {
      if (contest.isSubmitted) {
        return (
          <Button
            size="sm"
            className={softButtonClass}
            onClick={() => router.push(`/contests/${contest.id}`)}
          >
            View
          </Button>
        );
      }

      return (
        <Button
          size="sm"
          className={softButtonClass}
          onClick={() => { void navigateToContest(contest); }}
        >
          View
        </Button>
      );
    }

    return null;
  };

  return (
    <div className="min-h-screen bg-[#FAFBFC] px-4 py-6 text-slate-950 dark:bg-lc-bg dark:text-white sm:px-6 lg:px-8">
      <main className="mx-auto max-w-6xl">
        <PeerInterviewBanner className="mb-6" />

        <section className="pb-4">
          <h1 className="font-nunito text-3xl font-extrabold tracking-normal">Contests</h1>
        </section>

        <div className="mb-4 flex w-fit gap-1 overflow-x-auto rounded-full bg-white/80 p-1 shadow-sm ring-1 ring-slate-200 dark:bg-white/5 dark:ring-white/10">
          {[
            ['current', 'Current'],
            ['past', 'Past'],
            ['my', 'My Contests'],
          ].map(([key, label]) => (
            <button
              key={key}
              onClick={() => setActiveTab(key as TabType)}
              className={`h-7 whitespace-nowrap rounded-full px-5 text-xs font-extrabold transition ${
                activeTab === key
                  ? 'bg-primary text-white shadow-sm'
                  : 'text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-white/10 dark:hover:text-white'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="grid min-h-[360px] place-items-center">
            <div className="text-center">
              <Loader2 className="mx-auto h-8 w-8 animate-spin text-primary" />
              <p className="mt-4 text-sm font-semibold text-slate-500 dark:text-slate-400">Loading contests...</p>
            </div>
          </div>
        ) : contests.length === 0 ? (
          <div className="grid min-h-[360px] place-items-center text-center">
            <div>
              <Trophy className="mx-auto h-10 w-10 text-slate-300 dark:text-slate-600" />
              <p className="mt-4 text-sm font-semibold text-slate-500 dark:text-slate-400">
                {activeTab === 'current' && 'No live contests.'}
                {activeTab === 'past' && 'No past contests yet.'}
                {activeTab === 'my' && 'You have not participated in a contest yet.'}
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-1">
            {contests.map((contest, index) => {
              const status = deriveContestStatus(contest);
              const isActive = status === 'ACTIVE';
              const isSubmitted = Boolean(contest.isSubmitted);
              const eyebrow = getContestEyebrow(contest, status);
              const eyebrowClass = isSubmitted
                ? 'text-primary'
                : isActive
                  ? 'text-emerald-600 dark:text-emerald-400'
                  : status === 'UPCOMING'
                    ? 'text-primary'
                    : 'text-slate-400';
              const dotClass = isSubmitted ? 'bg-primary' : isActive ? 'bg-emerald-500' : status === 'UPCOMING' ? 'bg-primary' : 'bg-slate-400';
              return (
                <article
                  key={contest.id}
                  className={`grid gap-5 px-5 py-5 transition hover:bg-white/70 dark:hover:bg-white/[0.05] sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center ${
                    index % 2 === 0 ? 'bg-white/55 dark:bg-white/[0.025]' : 'bg-slate-100/65 dark:bg-white/[0.045]'
                  }`}
                >
                  <div className="min-w-0">
                    <button
                      type="button"
                      onClick={() => { void navigateToContest(contest); }}
                      className="min-w-0 text-left"
                    >
                      <p className={`mb-2 flex items-center gap-1.5 text-[10px] font-black uppercase tracking-[0.12em] ${eyebrowClass}`}>
                        <span className={`h-2 w-2 rounded-full ${dotClass}`} />
                        {eyebrow}
                      </p>
                      <h2 className="truncate font-nunito text-lg font-extrabold text-slate-950 dark:text-white">{contest.title}</h2>
                    </button>

                    <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs font-semibold text-slate-600 dark:text-slate-300">
                      <span className="inline-flex items-center gap-1.5">
                        <Calendar className="h-3.5 w-3.5 text-slate-500 dark:text-slate-400" />
                        {new Date(contest.startTime).toLocaleString(undefined, {
                          month: 'short',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                          timeZoneName: 'short',
                        })}
                      </span>
                      {contest.showParticipants && (
                        <span className="inline-flex items-center gap-1.5">
                          <Users className="h-3.5 w-3.5 text-slate-500 dark:text-slate-400" />
                          {contest._count.participants} {status === 'UPCOMING' ? 'enrolled' : 'participating'}
                        </span>
                      )}
                      {isActive ? (
                        <span className="inline-flex items-center gap-1.5 font-black text-red-600 dark:text-red-300">
                          <Clock className="h-3.5 w-3.5" />
                          Time left: {formatTimeLeft(contest.endTime)} mins
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5">
                          <Clock className="h-3.5 w-3.5 text-slate-500 dark:text-slate-400" />
                          Duration: {calculateDuration(contest.startTime, contest.endTime)} mins
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex min-w-0 justify-start sm:justify-end">
                    {renderActionButton(contest)}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </main>
      <ContestPopup popup={popup} onClose={closePopup} />
    </div>
  );
}
