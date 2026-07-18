'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Clock,
  Lock,
  ShieldCheck,
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { createSupabaseBrowserClient } from '@/lib/supabase';
import {
  clearContestCodeDrafts,
  getContestAutoSubmissionType,
  getContestBlockedShortcutReason,
  normalizeClipboardText,
} from '@/lib/contest-integrity';
import { DEFAULT_CONTEST_INSTRUCTIONS } from '@interviewforge/shared';
import { WebcamGateModal } from '@/components/contest/webcam-gate-modal';

const CONTEST_API = process.env.NEXT_PUBLIC_CONTEST_API_URL || 'http://localhost:3002';
const INTEGRITY_WARNING_LIMIT = 10;
const INTEGRITY_COOLDOWN_MS = 1200;
const CONTEST_DETAIL_CACHE_TTL_MS = 30 * 60_000;
const QUESTION_LOAD_RETRY_DELAYS_MS = [350, 800, 1500, 2500, 4000];
const RECORD_LANDING_PAGE_INTEGRITY_WARNINGS = false;

interface Question {
  id: string;
  title: string;
  difficulty: 'EASY' | 'MEDIUM' | 'HARD';
  points: number;
  negativePoints?: number;
  order: number;
  status?: 'not_attempted' | 'attempted' | 'solved';
  attempts?: number;
}

interface Contest {
  id: string;
  title: string;
  description: string;
  instructions?: string | null;
  showDifficultyTags?: boolean;
  roundFlow?: 'dsa_only' | 'mcq_only' | 'mcq_then_dsa';
  showScoreOnHub?: boolean;
  mcqSequential?: boolean;
  startTime: string;
  endTime: string;
  status: 'UPCOMING' | 'ACTIVE' | 'ENDED';
}

type ContestStatus = Contest['status'];

interface ContestRoundsState {
  settings: {
    roundFlow: 'dsa_only' | 'mcq_only' | 'mcq_then_dsa';
    showScoreOnHub: boolean;
    mcqSequential: boolean;
  };
  participant: {
    isSubmitted: boolean;
    totalScore: number | null;
  };
  rounds: {
    mcq: {
      status: 'not_started' | 'in_progress' | 'submitted' | 'auto_submitted';
      questionCount: number;
      submittedCount: number;
      unlocked: boolean;
      nextAllowedOrder: number | null;
      warningCount?: number;
    };
    dsa: {
      status: 'not_started' | 'in_progress' | 'submitted' | 'auto_submitted';
      unlocked: boolean;
      warningCount?: number;
    };
  };
}

interface ContestDetailCache {
  contest: Contest;
  questions: Question[];
  userScore: number;
  isSubmitted: boolean;
  savedAt: number;
}

function contestDetailCacheKey(contestId: string) {
  return `contest-detail-cache-${contestId}`;
}

function wait(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function readContestDetailCache(contestId: string): ContestDetailCache | null {
  if (typeof window === 'undefined' || !contestId) return null;

  try {
    const raw = window.sessionStorage.getItem(contestDetailCacheKey(contestId));
    if (!raw) return null;

    const parsed = JSON.parse(raw) as Partial<ContestDetailCache>;
    if (!parsed.contest || !Array.isArray(parsed.questions) || typeof parsed.savedAt !== 'number') {
      return null;
    }

    if (Date.now() - parsed.savedAt > CONTEST_DETAIL_CACHE_TTL_MS) {
      return null;
    }

    if (deriveContestStatus(parsed.contest as Contest) !== 'UPCOMING' && parsed.questions.length === 0) {
      return null;
    }

    return {
      contest: parsed.contest,
      questions: parsed.questions,
      userScore: Number(parsed.userScore || 0),
      isSubmitted: Boolean(parsed.isSubmitted),
      savedAt: parsed.savedAt,
    };
  } catch {
    return null;
  }
}

function writeContestDetailCache(contestId: string, snapshot: Omit<ContestDetailCache, 'savedAt'>) {
  if (typeof window === 'undefined' || !contestId) return;

  try {
    window.sessionStorage.setItem(contestDetailCacheKey(contestId), JSON.stringify({
      ...snapshot,
      savedAt: Date.now(),
    }));
  } catch {
    // Best effort cache for instant back-navigation only.
  }
}

function deriveContestStatus(contest: Pick<Contest, 'startTime' | 'endTime' | 'status'>): ContestStatus {
  const now = Date.now();
  const start = new Date(contest.startTime).getTime();
  const end = new Date(contest.endTime).getTime();

  if (Number.isFinite(end) && now >= end) return 'ENDED';
  if (Number.isFinite(start) && now >= start) return 'ACTIVE';
  return 'UPCOMING';
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value));
}

function formatClock(ms: number) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function integrityReasonLabel(reason: string) {
  return reason
    .replace(/^auto_/, '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function difficultyLabel(difficulty?: string | null) {
  const value = String(difficulty || '').toUpperCase();
  if (value === 'EASY') return 'Easy';
  if (value === 'MEDIUM') return 'Medium';
  if (value === 'HARD') return 'Hard';
  return String(difficulty || '');
}

function difficultyClass(difficulty?: string | null) {
  const value = String(difficulty || '').toUpperCase();
  if (value === 'EASY') return 'bg-emerald-50 text-emerald-700 dark:bg-emerald-400/10 dark:text-emerald-300';
  if (value === 'HARD') return 'bg-red-50 text-red-700 dark:bg-red-400/10 dark:text-red-300';
  return 'bg-amber-50 text-amber-700 dark:bg-amber-400/10 dark:text-amber-300';
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object' && 'message' in error) {
    return String((error as { message?: unknown }).message || '');
  }
  return '';
}

function instructionLines(value?: string | null) {
  return String(value || DEFAULT_CONTEST_INSTRUCTIONS)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

export default function ContestDetailPage() {
  const router = useRouter();
  const params = useParams();
  const { toast } = useToast();
  const contestId = params.id as string;

  const [contest, setContest] = useState<Contest | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [userScore, setUserScore] = useState(0);
  const [loading, setLoading] = useState(true);
  const [questionsLoading, setQuestionsLoading] = useState(false);
  const [questionsLoadError, setQuestionsLoadError] = useState<string | null>(null);
  const [questionLoadAttempt, setQuestionLoadAttempt] = useState(0);
  const [roundsState, setRoundsState] = useState<ContestRoundsState | null>(null);
  const [contestEnded, setContestEnded] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [isRegistered, setIsRegistered] = useState(false);
  const [registrationChecked, setRegistrationChecked] = useState(false);
  const [isRegistering, setIsRegistering] = useState(false);
  const [showSubmitConfirm, setShowSubmitConfirm] = useState(false);
  const [showFullscreenPrompt, setShowFullscreenPrompt] = useState(false);
  const [showInstructions, setShowInstructions] = useState(false);
  const [instructionsReviewOnly, setInstructionsReviewOnly] = useState(false);
  const [instructionsAcknowledged, setInstructionsAcknowledged] = useState(false);
  const [pendingQuestionId, setPendingQuestionId] = useState<string | null>(null);
  const [integrityStarted, setIntegrityStarted] = useState(false);
  const [hasEnteredFullscreen, setHasEnteredFullscreen] = useState(false);
  const [warningCount, setWarningCount] = useState(0);
  const [nowTick, setNowTick] = useState(() => Date.now());
  const [webcamGranted, setWebcamGranted] = useState(false);

  const isSubmittingRef = useRef(false);
  const integrityStartedRef = useRef(false);
  const hasEnteredFullscreenRef = useRef(false);
  const lastIntegrityViolationRef = useRef<{ at: number; reason: string } | null>(null);
  const questionsLoadedRef = useRef(false);
  const internalClipboardRef = useRef('');
  const altSwitchCandidateRef = useRef(false);

  const violationStorageKey = `contest-violations-${contestId}`;
  const autoSubmitStorageKey = `contest-auto-submit-${contestId}`;
  const submittedStorageKey = `contest-submitted-${contestId}`;
  const instructionsAckStorageKey = `contest-instructions-ack-${contestId}`;
  const integrityStartedStorageKey = `contest-integrity-started-${contestId}`;
  const webcamGrantedStorageKey = `contest-webcam-ok-${contestId}`;
  const contestInstructionLines = useMemo(() => instructionLines(contest?.instructions), [contest?.instructions]);
  const shouldShowDifficultyTags = contest?.showDifficultyTags !== false;

  const currentStatus = useMemo(() => {
    if (!contest) return 'UPCOMING' as ContestStatus;
    if (contestEnded) return 'ENDED' as ContestStatus;
    return deriveContestStatus(contest);
  }, [contest, contestEnded]);

  const singleRoundEntryPath = useMemo(() => {
    if (!contest || currentStatus !== 'ACTIVE' || isSubmitted) return null;
    if (contest.roundFlow === 'mcq_only') return `/contests/${contestId}/mcq`;
    if (contest.roundFlow === 'dsa_only') return `/contests/${contestId}/dsa`;
    return null;
  }, [contest, contestId, currentStatus, isSubmitted]);

  const singleRoundPracticePath = useMemo(() => {
    if (!contest || currentStatus !== 'ENDED') return null;
    if (contest.roundFlow === 'mcq_only') return `/contests/${contestId}/mcq/practice`;
    if (contest.roundFlow === 'dsa_only') return `/contests/${contestId}/dsa/practice`;
    return null;
  }, [contest, contestId, currentStatus]);

  const timeRemaining = useMemo(() => {
    if (!contest) return '00:00:00';
    return formatClock(new Date(contest.endTime).getTime() - nowTick);
  }, [contest, nowTick]);

  const timeUntilStart = useMemo(() => {
    if (!contest) return '00:00:00';
    return formatClock(new Date(contest.startTime).getTime() - nowTick);
  }, [contest, nowTick]);

  const getToken = useCallback(async () => {
    const supabase = createSupabaseBrowserClient();
    const { data: sessionData } = await supabase.auth.getSession();
    return sessionData.session?.access_token || null;
  }, []);

  const refreshContestDetails = useCallback(async (): Promise<Contest | null> => {
    try {
      const token = await getToken();
      if (!token) return null;

      const url = new URL(`${CONTEST_API}/contests/${contestId}`);
      url.searchParams.set('_ts', Date.now().toString());

      const response = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
      });

      if (!response.ok) return null;
      const data = await response.json();
      const nextContest = data.contest as Contest | undefined;
      if (!nextContest) return null;

      setContest(nextContest);
      setContestEnded(false);
      return nextContest;
    } catch {
      return null;
    }
  }, [contestId, getToken]);

  const armContestIntegrity = useCallback(() => {
    integrityStartedRef.current = true;
    setIntegrityStarted(true);
    localStorage.setItem(integrityStartedStorageKey, 'true');
  }, [integrityStartedStorageKey]);

  const submitContest = useCallback(async (submissionType: string) => {
    if (isSubmitted || isSubmittingRef.current) return;

    isSubmittingRef.current = true;
    setIsSubmitting(true);

    try {
      const token = await getToken();
      if (!token) {
        router.push('/login');
        return;
      }

      const response = await fetch(`${CONTEST_API}/contests/${contestId}/submit`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ submissionType }),
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        if (String(error.message || '').toLowerCase().includes('already submitted')) {
          localStorage.setItem(submittedStorageKey, 'true');
          localStorage.removeItem(integrityStartedStorageKey);
          clearContestCodeDrafts(contestId);
          setIsSubmitted(true);
          router.replace(`/contests/${contestId}/submitted`);
          return;
        }
        throw new Error(error.message || 'Failed to submit contest');
      }

      localStorage.setItem(submittedStorageKey, 'true');
      localStorage.removeItem(integrityStartedStorageKey);
      clearContestCodeDrafts(contestId);
      if (submissionType !== 'manual' && submissionType !== 'auto_time') {
        localStorage.setItem(autoSubmitStorageKey, JSON.stringify({
          reason: submissionType,
          timestamp: Date.now(),
          violationCount: INTEGRITY_WARNING_LIMIT,
          threshold: INTEGRITY_WARNING_LIMIT,
        }));
      }

      setIsSubmitted(true);
      setShowSubmitConfirm(false);

      if (submissionType === 'auto_time') {
        toast({
          title: 'Contest ended',
          description: 'Time is up. Your contest was submitted.',
        });
        router.replace(`/contests/${contestId}/submitted`);
        return;
      }

      router.replace(`/contests/${contestId}/submitted`);
    } catch (error: unknown) {
      const message = getErrorMessage(error);
      if (submissionType === 'auto_time' && /still active/i.test(message)) {
        setContestEnded(false);
        void refreshContestDetails();
        return;
      }
      toast({
        title: 'Submit failed',
        description: message || 'Failed to submit contest',
        variant: 'destructive',
      });
    } finally {
      isSubmittingRef.current = false;
      setIsSubmitting(false);
    }
  }, [autoSubmitStorageKey, contestId, getToken, integrityStartedStorageKey, isSubmitted, refreshContestDetails, router, submittedStorageKey, toast]);

  const requestContestFullscreen = useCallback(async () => {
    const shouldUseContestLayout = Boolean(contest && currentStatus === 'ACTIVE' && !isSubmitted);
    if (shouldUseContestLayout) {
      document.body.classList.add('contest-active-hide-nav');
    }

    try {
      if (!document.fullscreenElement) {
        await document.documentElement.requestFullscreen();
      }
      window.requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
      hasEnteredFullscreenRef.current = true;
      setHasEnteredFullscreen(true);
      setShowFullscreenPrompt(false);
      // Only surface instructions before the contest is under way. Once integrity
      // has started (e.g. returning from a finished MCQ round), re-entering
      // fullscreen must not re-open the instructions popup.
      if (!integrityStartedRef.current && !instructionsAcknowledged && !localStorage.getItem(instructionsAckStorageKey)) {
        setShowInstructions(true);
      }
      return true;
    } catch {
      if (shouldUseContestLayout && !integrityStartedRef.current) {
        document.body.classList.remove('contest-active-hide-nav');
      }
      setShowFullscreenPrompt(true);
      return false;
    }
  }, [contest, currentStatus, instructionsAckStorageKey, instructionsAcknowledged, isSubmitted]);

  const acknowledgeInstructions = useCallback(() => {
    setInstructionsReviewOnly(false);
    armContestIntegrity();
    localStorage.setItem(instructionsAckStorageKey, 'true');
    setInstructionsAcknowledged(true);
    setShowInstructions(false);

    const questionId = pendingQuestionId;
    setPendingQuestionId(null);

    if (questionId && currentStatus === 'ACTIVE' && !isSubmitted) {
      router.push(`/contests/${contestId}/solve/${questionId}`);
    }
  }, [armContestIntegrity, contestId, currentStatus, instructionsAckStorageKey, isSubmitted, pendingQuestionId, router]);

  const openInstructionsReview = useCallback(() => {
    setInstructionsReviewOnly(true);
    setShowInstructions(true);
  }, []);

  const closeInstructionsReview = useCallback(() => {
    setShowInstructions(false);
    setInstructionsReviewOnly(false);
  }, []);

  const recordIntegrityWarning = useCallback(async (reason: string) => {
    if (!RECORD_LANDING_PAGE_INTEGRITY_WARNINGS) return;
    if (!contest || currentStatus !== 'ACTIVE' || isSubmitted || isSubmittingRef.current) return;
    if (!integrityStartedRef.current) return;
    if (localStorage.getItem(submittedStorageKey)) return;

    const now = Date.now();
    const lastViolation = lastIntegrityViolationRef.current;
    if (lastViolation && now - lastViolation.at < INTEGRITY_COOLDOWN_MS) {
      return;
    }
    lastIntegrityViolationRef.current = { at: now, reason };

    const stored = Number(localStorage.getItem(violationStorageKey) || '0');
    const nextCount = (Number.isFinite(stored) ? Math.max(0, stored) : 0) + 1;
    localStorage.setItem(violationStorageKey, String(nextCount));
    setWarningCount(nextCount);

    const label = integrityReasonLabel(reason);

    toast({
      title: `Integrity warning ${nextCount}`,
      description: nextCount >= INTEGRITY_WARNING_LIMIT
        ? `${label}. Warning limit reached; submitting your contest.`
        : `${label}. This warning was recorded.`,
      variant: 'destructive',
    });

    if (nextCount >= INTEGRITY_WARNING_LIMIT) {
      await submitContest(getContestAutoSubmissionType(reason));
      return;
    }

    if (reason === 'auto_fullscreen_exit') {
      setShowFullscreenPrompt(true);
      void requestContestFullscreen();
    }
  }, [contest, currentStatus, isSubmitted, requestContestFullscreen, submitContest, submittedStorageKey, toast, violationStorageKey]);

  const fetchContestDetails = useCallback(async () => {
    try {
      const token = await getToken();
      if (!token) {
        router.push('/login');
        return;
      }

      const url = new URL(`${CONTEST_API}/contests/${contestId}`);
      url.searchParams.set('_ts', Date.now().toString());

      const response = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
      });

      if (!response.ok) throw new Error('Failed to fetch contest');
      const data = await response.json();
      setContest(data.contest);
    } catch {
      toast({
        title: 'Error',
        description: 'Failed to load contest details',
        variant: 'destructive',
      });
      setLoading(false);
    }
  }, [contestId, getToken, router, toast]);

  const registerForActiveContest = useCallback(async (token: string) => {
    const response = await fetch(`${CONTEST_API}/contests/${contestId}/register`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });

    if (response.ok) {
      setIsRegistered(true);
      setRegistrationChecked(true);
      return true;
    }

    const errorBody = await response.json().catch(() => ({}));
    const alreadyRegistered = /already registered/i.test(String(errorBody.message || ''));
    if (alreadyRegistered) {
      setIsRegistered(true);
      setRegistrationChecked(true);
    }
    return alreadyRegistered;
  }, [contestId]);

  const fetchRegistrationStatus = useCallback(async () => {
    try {
      const token = await getToken();
      if (!token) {
        setRegistrationChecked(true);
        return;
      }

      const response = await fetch(`${CONTEST_API}/contests/${contestId}/my-rank`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
      });

      if (response.ok) {
        const data = await response.json();
        setIsRegistered(true);
        setUserScore(data.totalScore ?? 0);
        if (data.participant?.isSubmitted) {
          localStorage.setItem(submittedStorageKey, 'true');
          setIsSubmitted(true);
        }
        return;
      }

      if (response.status === 404) {
        setIsRegistered(false);
      }
    } catch {
    } finally {
      setRegistrationChecked(true);
    }
  }, [contestId, getToken, submittedStorageKey]);

  const handleRegister = useCallback(async () => {
    if (isRegistering || isRegistered) return;
    setIsRegistering(true);

    try {
      const token = await getToken();
      if (!token) {
        router.push('/login');
        return;
      }

      const response = await fetch(`${CONTEST_API}/contests/${contestId}/register`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        const message = String(error.message || 'Failed to register for contest');
        if (!/already registered/i.test(message)) {
          throw new Error(message);
        }
      }

      setIsRegistered(true);
      setRegistrationChecked(true);
      toast({
        title: 'Registered',
        description: 'You are registered for this contest.',
      });
    } catch (error: unknown) {
      const message = getErrorMessage(error);
      toast({
        title: 'Registration failed',
        description: message || 'Failed to register for contest',
        variant: 'destructive',
      });
    } finally {
      setIsRegistering(false);
    }
  }, [contestId, getToken, isRegistered, isRegistering, router, toast]);

  const fetchQuestions = useCallback(async () => {
    setQuestionsLoading(true);
    setQuestionsLoadError(null);

    try {
      const token = await getToken();
      if (!token) return;

      let lastError: Error | null = null;
      for (let attempt = 0; attempt <= QUESTION_LOAD_RETRY_DELAYS_MS.length; attempt += 1) {
        setQuestionLoadAttempt(attempt + 1);

        const url = new URL(`${CONTEST_API}/contests/${contestId}/questions`);
        url.searchParams.set('_ts', Date.now().toString());

        const response = await fetch(url.toString(), {
          headers: { Authorization: `Bearer ${token}` },
          cache: 'no-store',
        });

        if (!response.ok) {
          const errorBody = await response.json().catch(() => ({}));
          const message = errorBody.message || 'Failed to fetch questions';
          lastError = new Error(message);
          if (response.status === 403 || response.status === 404) {
            if (currentStatus === 'ACTIVE' && await registerForActiveContest(token)) {
              await wait(300);
              continue;
            }
            throw lastError;
          }
        } else {
          const data = await response.json();
          const nextQuestions = Array.isArray(data.questions) ? data.questions : [];
          if (nextQuestions.length > 0) {
            setQuestions(nextQuestions);
            setQuestionsLoadError(null);
            questionsLoadedRef.current = true;
            return;
          }
          lastError = new Error('Questions are still loading. Please retry if this continues.');
        }

        const delay = QUESTION_LOAD_RETRY_DELAYS_MS[attempt];
        if (delay === undefined) break;
        // Jitter (±30%) so a thundering herd of entrants doesn't retry in lockstep
        // and hammer the backend at the exact same instants.
        const jitteredDelay = Math.round(delay * (0.7 + Math.random() * 0.6));
        await wait(jitteredDelay);
      }

      questionsLoadedRef.current = false;
      setQuestionsLoadError(lastError?.message || 'Questions could not be loaded.');
    } catch (error) {
      questionsLoadedRef.current = false;
      setQuestionsLoadError(error instanceof Error ? error.message : 'Failed to load questions');
      toast({
        title: 'Error',
        description: 'Failed to load questions',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
      setQuestionsLoading(false);
      setQuestionLoadAttempt(0);
    }
  }, [contestId, currentStatus, getToken, registerForActiveContest, toast]);

  const fetchUserScore = useCallback(async () => {
    try {
      const token = await getToken();
      if (!token) return;

      const response = await fetch(`${CONTEST_API}/contests/${contestId}/my-rank`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
      });

      if (response.ok) {
        const data = await response.json();
        setUserScore(data.totalScore ?? 0);
      }
    } catch {
    }
  }, [contestId, getToken]);

  const fetchRounds = useCallback(async () => {
    try {
      const token = await getToken();
      if (!token) return;

      const response = await fetch(`${CONTEST_API}/contests/${contestId}/rounds`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) return;
      setRoundsState(data as ContestRoundsState);
      if (typeof data?.participant?.totalScore === 'number') {
        setUserScore(data.participant.totalScore);
      }
      if (data?.participant?.isSubmitted) {
        setIsSubmitted(true);
      }
    } catch {
      setRoundsState(null);
    }
  }, [contestId, getToken]);

  const checkSubmissionStatus = useCallback(async () => {
    try {
      const token = await getToken();
      if (!token) return;

      const response = await fetch(`${CONTEST_API}/contests/${contestId}/my-rank`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
      });

      if (response.ok) {
        const data = await response.json();
        const submitted = data.participant?.isSubmitted || false;
        setUserScore(data.totalScore ?? 0);
        setIsSubmitted(submitted);
        if (submitted && currentStatus === 'ACTIVE') {
          router.replace(`/contests/${contestId}/submitted`);
        }
      } else if (currentStatus === 'ACTIVE' && (response.status === 403 || response.status === 404)) {
        if (await registerForActiveContest(token)) {
          setIsSubmitted(false);
          return;
        }
        router.replace('/contests');
      }
    } catch {
    }
  }, [contestId, currentStatus, getToken, registerForActiveContest, router]);

  useLayoutEffect(() => {
    if (!contestId) return;
    const cached = readContestDetailCache(contestId);
    const submittedFromStorage = localStorage.getItem(submittedStorageKey) === 'true';
    const startedFromStorage = localStorage.getItem(integrityStartedStorageKey) === 'true' && !submittedFromStorage;
    if (submittedFromStorage) {
      localStorage.removeItem(integrityStartedStorageKey);
    }

    questionsLoadedRef.current = false;
    integrityStartedRef.current = startedFromStorage;
    setIntegrityStarted(startedFromStorage);
    hasEnteredFullscreenRef.current = Boolean(document.fullscreenElement);
    setHasEnteredFullscreen(Boolean(document.fullscreenElement));
    setShowFullscreenPrompt(false);
    if (cached) {
      const submitted = cached.isSubmitted || submittedFromStorage;
      setContest(cached.contest);
      setQuestions(cached.questions);
      setRoundsState(null);
      setUserScore(cached.userScore);
      setIsSubmitted(submitted);
      setQuestionsLoadError(null);
      setQuestionsLoading(false);
      setLoading(false);
      if (startedFromStorage && !submitted && deriveContestStatus(cached.contest) === 'ACTIVE') {
        document.body.classList.add('contest-active-hide-nav');
        setShowFullscreenPrompt(!document.fullscreenElement);
      }

    } else {
      setContest(null);
      setQuestions([]);
      setRoundsState(null);
      setUserScore(0);
      setIsSubmitted(submittedFromStorage);
      setQuestionsLoadError(null);
      setQuestionsLoading(false);
      setLoading(true);
    }

    setWarningCount(Number(localStorage.getItem(violationStorageKey) || '0'));
    setInstructionsAcknowledged(localStorage.getItem(instructionsAckStorageKey) === 'true');
    setWebcamGranted(sessionStorage.getItem(webcamGrantedStorageKey) === 'true');
    setShowInstructions(false);
    setInstructionsReviewOnly(false);
    setPendingQuestionId(null);
    setContestEnded(false);
    setRegistrationChecked(false);
    setIsRegistered(false);
    void fetchContestDetails();
  }, [contestId, fetchContestDetails, instructionsAckStorageKey, integrityStartedStorageKey, submittedStorageKey, violationStorageKey, webcamGrantedStorageKey]);

  useEffect(() => {
    if (!contest || loading) return;
    void fetchRegistrationStatus();
  }, [contest, fetchRegistrationStatus, loading]);

  useEffect(() => {
    if (!contest || loading) return;

    if (currentStatus !== 'UPCOMING' && questions.length === 0) return;

    writeContestDetailCache(contestId, {
      contest,
      questions,
      userScore,
      isSubmitted,
    });
  }, [contest, contestId, currentStatus, isSubmitted, loading, questions, userScore]);

  useEffect(() => {
    const interval = window.setInterval(() => setNowTick(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!contest) return;

    if (currentStatus === 'UPCOMING') {
      setLoading(false);
      return;
    }

    const singleRoundTargetPath = singleRoundEntryPath || singleRoundPracticePath;
    if (singleRoundTargetPath) {
      setLoading(false);
      router.replace(singleRoundTargetPath);
      return;
    }

    const isRoundBasedContest = contest.roundFlow === 'mcq_only' || contest.roundFlow === 'mcq_then_dsa';

    if (isRoundBasedContest) {
      questionsLoadedRef.current = true;
      setQuestionsLoading(false);
      setQuestionsLoadError(null);
      setLoading(false);
      void fetchRounds();
    } else if (!questionsLoadedRef.current && !questionsLoading) {
      void fetchQuestions();
    }

    if (currentStatus === 'ACTIVE' && !isSubmitted) {
      void fetchUserScore();
      void checkSubmissionStatus();
    } else if (currentStatus === 'ENDED') {
      void fetchUserScore();
    }
  }, [checkSubmissionStatus, contest, currentStatus, fetchQuestions, fetchRounds, fetchUserScore, isSubmitted, questionsLoading, router, singleRoundEntryPath, singleRoundPracticePath]);

  useEffect(() => {
    const targetPath = singleRoundEntryPath || singleRoundPracticePath;
    if (!targetPath) return;
    router.replace(targetPath);
  }, [router, singleRoundEntryPath, singleRoundPracticePath]);

  // Back-navigation guard: a submitted, still-active contest must not be re-entered from the hub.
  useEffect(() => {
    if (!contest || currentStatus !== 'ACTIVE' || !isSubmitted) return;
    router.replace(`/contests/${contestId}/submitted`);
  }, [contest, contestId, currentStatus, isSubmitted, router]);

  useEffect(() => {
    if (!contest || isSubmitted) return;
    if (contest.status !== 'ACTIVE' && currentStatus !== 'ACTIVE') return;

    // Jitter the poll period per-mount (15–22s) so 150+ entrants don't refresh on
    // the exact same second — a synchronized spike on the contest API.
    const period = 15000 + Math.floor(Math.random() * 7000);
    const interval = window.setInterval(() => {
      void refreshContestDetails();
    }, period);

    return () => window.clearInterval(interval);
  }, [contest, currentStatus, isSubmitted, refreshContestDetails]);

  useEffect(() => {
    const shouldUseContestLayout = Boolean(
      contest &&
      currentStatus === 'ACTIVE' &&
      !isSubmitted &&
      (integrityStarted || pendingQuestionId || showFullscreenPrompt)
    );

    if (!shouldUseContestLayout) {
      document.body.classList.remove('contest-active-hide-nav');
      if (!pendingQuestionId) {
        setShowFullscreenPrompt(false);
      }
      return;
    }

    document.body.classList.add('contest-active-hide-nav');
    const isFullscreen = !!document.fullscreenElement;
    if (isFullscreen) {
      hasEnteredFullscreenRef.current = true;
      setHasEnteredFullscreen(true);
    }
    setShowFullscreenPrompt(!isFullscreen);

    return () => {
      document.body.classList.remove('contest-active-hide-nav');
    };
  }, [contest, currentStatus, integrityStarted, isSubmitted, pendingQuestionId, showFullscreenPrompt]);

  useEffect(() => {
    if (!contest || currentStatus !== 'ACTIVE' || isSubmitted || !integrityStarted) return;

    const handleFullscreenChange = () => {
      const isFullscreen = !!document.fullscreenElement;
      if (isFullscreen) {
        hasEnteredFullscreenRef.current = true;
        setHasEnteredFullscreen(true);
        setShowFullscreenPrompt(false);
        // A mid-contest fullscreen re-entry (e.g. after finishing the MCQ round)
        // must not re-open the instructions popup.
        if (!integrityStartedRef.current && !instructionsAcknowledged && !localStorage.getItem(instructionsAckStorageKey)) {
          setShowInstructions(true);
        }
        return;
      }

      if (hasEnteredFullscreenRef.current) {
        void recordIntegrityWarning('auto_fullscreen_exit');
      } else {
        setShowFullscreenPrompt(true);
      }
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, [contest, currentStatus, instructionsAckStorageKey, instructionsAcknowledged, integrityStarted, isSubmitted, recordIntegrityWarning]);

  useEffect(() => {
    if (!contest || currentStatus !== 'ACTIVE' || isSubmitted || !integrityStarted) return;

    const handleVisibilityChange = () => {
      if (document.hidden) {
        const reason = altSwitchCandidateRef.current ? 'auto_alt_tab' : 'auto_tab_switch';
        altSwitchCandidateRef.current = false;
        void recordIntegrityWarning(reason);
      }
    };

    const handleBlur = () => {
      window.setTimeout(() => {
        if (document.hidden || !document.hasFocus()) {
          const reason = altSwitchCandidateRef.current ? 'auto_alt_tab' : 'auto_window_blur';
          altSwitchCandidateRef.current = false;
          void recordIntegrityWarning(reason);
        }
      }, 150);
    };

    const handlePageHide = () => {
      if (!hasEnteredFullscreenRef.current) return;
      const reason = altSwitchCandidateRef.current ? 'auto_alt_tab' : 'auto_page_hide';
      altSwitchCandidateRef.current = false;
      void recordIntegrityWarning(reason);
    };

    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!hasEnteredFullscreenRef.current) return;
      void recordIntegrityWarning('auto_page_leave');
      e.preventDefault();
      e.returnValue = 'You have an active contest. Leaving may submit your contest.';
      return e.returnValue;
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('blur', handleBlur);
    window.addEventListener('pagehide', handlePageHide);
    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('blur', handleBlur);
      window.removeEventListener('pagehide', handlePageHide);
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [contest, currentStatus, integrityStarted, isSubmitted, recordIntegrityWarning]);

  useEffect(() => {
    if (!contest || currentStatus !== 'ACTIVE' || isSubmitted || !integrityStarted) return;

    const getElement = (target: EventTarget | null) => target instanceof Element ? target : target instanceof Node ? target.parentElement : null;

    const readAllowedSelection = (target: Element | null) => {
      const input = target?.closest('input, textarea') as HTMLInputElement | HTMLTextAreaElement | null;
      if (input && typeof input.selectionStart === 'number' && typeof input.selectionEnd === 'number') {
        return input.value.slice(input.selectionStart, input.selectionEnd);
      }
      return window.getSelection()?.toString() || '';
    };

    const trackInternalClipboard = (e: ClipboardEvent, action: 'copy' | 'cut') => {
      const target = getElement(e.target);
      if (target?.closest('input') || target?.closest('textarea') || target?.closest('.monaco-editor')) {
        internalClipboardRef.current = normalizeClipboardText(readAllowedSelection(target));
        return;
      }

      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      void recordIntegrityWarning(action === 'cut' ? 'auto_question_cut' : 'auto_question_copy');
    };

    const handleCopy = (e: ClipboardEvent) => {
      trackInternalClipboard(e, 'copy');
    };

    const handleCut = (e: ClipboardEvent) => {
      trackInternalClipboard(e, 'cut');
    };

    const handlePaste = (e: ClipboardEvent) => {
      const target = getElement(e.target);
      if (!target?.closest('input') && !target?.closest('textarea') && !target?.closest('.monaco-editor')) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        void recordIntegrityWarning('auto_paste_outside_editor');
        return;
      }

      const pastedText = normalizeClipboardText(e.clipboardData?.getData('text/plain') || e.clipboardData?.getData('text') || '');
      if (!internalClipboardRef.current || pastedText !== internalClipboardRef.current) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        void recordIntegrityWarning('auto_external_paste');
      }
    };

    const handleContextMenu = (e: MouseEvent) => {
      const target = getElement(e.target);
      if (target?.closest('input') || target?.closest('textarea') || target?.closest('.monaco-editor')) return;
      e.preventDefault();
      void recordIntegrityWarning('auto_context_menu');
    };

    const handleSelectStart = (e: Event) => {
      const target = getElement(e.target);
      if (target?.closest('input') || target?.closest('textarea') || target?.closest('.monaco-editor')) return;
      e.preventDefault();
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      const target = getElement(e.target);
      const inEditor = !!target?.closest('.monaco-editor');

      if (key === 'alt' || key === 'meta' || key === 'os') {
        altSwitchCandidateRef.current = true;
        window.setTimeout(() => {
          altSwitchCandidateRef.current = false;
        }, 1500);
      }

      const blockedReason = getContestBlockedShortcutReason(e, { inEditor });

      if (blockedReason) {
        if (blockedReason === 'auto_alt_tab' || blockedReason === 'auto_macos_app_switch') {
          altSwitchCandidateRef.current = false;
        }
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        void recordIntegrityWarning(blockedReason);
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      if (key === 'alt' || key === 'meta' || key === 'os') {
        altSwitchCandidateRef.current = false;
      }

      if (key !== 'printscreen' && key !== 'print') return;
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      void recordIntegrityWarning('auto_screenshot_printscreen');
    };

    document.addEventListener('copy', handleCopy, true);
    document.addEventListener('cut', handleCut, true);
    document.addEventListener('paste', handlePaste, true);
    document.addEventListener('contextmenu', handleContextMenu);
    document.addEventListener('selectstart', handleSelectStart);
    document.addEventListener('keydown', handleKeyDown, true);
    document.addEventListener('keyup', handleKeyUp, true);

    return () => {
      document.removeEventListener('copy', handleCopy, true);
      document.removeEventListener('cut', handleCut, true);
      document.removeEventListener('paste', handlePaste, true);
      document.removeEventListener('contextmenu', handleContextMenu);
      document.removeEventListener('selectstart', handleSelectStart);
      document.removeEventListener('keydown', handleKeyDown, true);
      document.removeEventListener('keyup', handleKeyUp, true);
    };
  }, [contest, currentStatus, integrityStarted, isSubmitted, recordIntegrityWarning]);

  useEffect(() => {
    if (!contest || currentStatus !== 'ACTIVE' || isSubmitted) return;

    const handleAppSwitchKeyDown = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      if (key === 'alt' || key === 'meta' || key === 'os') {
        altSwitchCandidateRef.current = true;
        window.setTimeout(() => {
          altSwitchCandidateRef.current = false;
        }, 1500);
      }

      const blockedReason = getContestBlockedShortcutReason(e);
      if (blockedReason !== 'auto_alt_tab' && blockedReason !== 'auto_macos_app_switch') return;

      altSwitchCandidateRef.current = false;
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      void recordIntegrityWarning(blockedReason);
    };

    const handleAppSwitchKeyUp = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      if (key === 'alt' || key === 'meta' || key === 'os') {
        altSwitchCandidateRef.current = false;
      }
    };

    document.addEventListener('keydown', handleAppSwitchKeyDown, true);
    document.addEventListener('keyup', handleAppSwitchKeyUp, true);

    return () => {
      document.removeEventListener('keydown', handleAppSwitchKeyDown, true);
      document.removeEventListener('keyup', handleAppSwitchKeyUp, true);
    };
  }, [contest, currentStatus, isSubmitted, recordIntegrityWarning]);

  useEffect(() => {
    if (!contest || contest.status !== 'ACTIVE' || contestEnded || isSubmitted) return;
    if (new Date(contest.endTime).getTime() - nowTick <= 0) {
      setContestEnded(true);
      void (async () => {
        const freshContest = await refreshContestDetails();
        const latestEndTime = freshContest?.endTime || contest.endTime;
        const latestEndAt = new Date(latestEndTime).getTime();
        if (Number.isFinite(latestEndAt) && Date.now() < latestEndAt) {
          setContestEnded(false);
          return;
        }
        await submitContest('auto_time');
      })();
    }
  }, [contest, contestEnded, isSubmitted, nowTick, refreshContestDetails, submitContest]);

  if (loading || !contest) {
    return (
      <div className="grid min-h-screen place-items-center bg-[#f7f9fc] text-slate-600 dark:bg-lc-bg dark:text-slate-300">
        <div className="text-center">
          <div className="mx-auto h-10 w-10 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          <p className="mt-4 text-sm font-semibold">Loading contest...</p>
        </div>
      </div>
    );
  }

  const singleRoundRedirectPath = singleRoundEntryPath || singleRoundPracticePath;
  if (singleRoundRedirectPath) {
    const isPracticeRedirect = Boolean(singleRoundPracticePath);
    const roundName = contest.roundFlow === 'mcq_only' ? 'MCQ' : 'DSA';
    return (
      <div className="grid min-h-screen place-items-center bg-[#f7f9fc] text-slate-600 dark:bg-lc-bg dark:text-slate-300">
        <div className="text-center">
          <div className="mx-auto h-10 w-10 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          <p className="mt-4 text-sm font-semibold">
            Opening {roundName} {isPracticeRedirect ? 'review' : 'round'}...
          </p>
        </div>
      </div>
    );
  }

  const statusTimeLabel = currentStatus === 'ACTIVE' ? 'Time Remaining' : currentStatus === 'UPCOMING' ? 'Starts In' : 'Ended';
  const statusTimeValue = currentStatus === 'ACTIVE' ? timeRemaining : currentStatus === 'UPCOMING' ? timeUntilStart : formatDateTime(contest.endTime);
  const totalPossibleScore = questions.reduce((sum, question) => sum + Math.max(0, Number(question.points || 0)), 0);
  const shouldShowHubScore = contest.showScoreOnHub !== false || isSubmitted || currentStatus === 'ENDED';
  const scoreDisplay = totalPossibleScore > 0 ? `${userScore} / ${totalPossibleScore}` : String(userScore);
  const displayedWarningCount = Math.max(
    warningCount,
    Number(roundsState?.rounds.mcq.warningCount ?? 0) + Number(roundsState?.rounds.dsa.warningCount ?? 0)
  );
  const isRoundBasedContest = contest.roundFlow === 'mcq_only' || contest.roundFlow === 'mcq_then_dsa';
  const isRoundPracticeMode = currentStatus === 'ENDED';
  const mcqRoundSubmitted = roundsState?.rounds.mcq.status === 'submitted' || roundsState?.rounds.mcq.status === 'auto_submitted';
  // During the live contest the MCQ round is one-shot: once submitted it locks.
  // (In practice/review mode the card stays open so candidates can review.)
  const mcqRoundLocked = !isRoundPracticeMode && Boolean(mcqRoundSubmitted);
  const dsaRoundUnlocked = Boolean(roundsState?.rounds.dsa.unlocked);
  // Live contests require a shared camera before the candidate can start. The gate
  // is client-side only (no recording, no server load), so it scales to any number
  // of simultaneous entrants.
  const needsWebcamGate =
    !loading && currentStatus === 'ACTIVE' && isRegistered && !isSubmitted && registrationChecked && !webcamGranted;

  const grantWebcam = () => {
    setWebcamGranted(true);
    try {
      sessionStorage.setItem(webcamGrantedStorageKey, 'true');
    } catch {
      // Session storage is a convenience only; the gate still works without it.
    }
  };

  return (
    <div className="flex h-screen overflow-hidden bg-[#FAFBFC] px-4 py-6 text-slate-950 dark:bg-lc-bg dark:text-white sm:px-6 lg:px-8">
      <main className="mx-auto flex min-h-0 w-full max-w-6xl flex-1 flex-col">
        <section className="shrink-0 pt-2">
          <div className="flex flex-col gap-4 pb-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => router.push('/contests')}
                className="grid h-11 w-11 shrink-0 place-items-center text-slate-600 transition hover:text-slate-950 dark:text-slate-300 dark:hover:text-white"
                aria-label="Back to contests"
              >
                <ArrowLeft className="h-5 w-5" />
              </button>
              <h1 className="font-nunito text-3xl font-black text-slate-950 dark:text-white">{contest.title}</h1>
            </div>
            <div className="flex flex-wrap items-center gap-3 sm:justify-end">
              {currentStatus === 'ENDED' && (
                <div className="flex h-12 rounded-[18px] bg-white/80 p-1 shadow-sm ring-1 ring-slate-200 dark:bg-white/5 dark:ring-white/10">
                  <button
                    type="button"
                    className="rounded-[14px] bg-primary px-6 text-sm font-extrabold text-white shadow-sm"
                    aria-current="page"
                  >
                    View
                  </button>
                  <button
                    type="button"
                    onClick={() => router.push(`/contests/${contestId}/submitted`)}
                    className="rounded-[14px] px-6 text-sm font-extrabold text-slate-500 transition hover:bg-slate-100 hover:text-slate-950 dark:text-slate-300 dark:hover:bg-white/10 dark:hover:text-white"
                  >
                    {isSubmitted ? 'Result' : 'Leaderboard'}
                  </button>
                </div>
              )}

              {currentStatus !== 'ENDED' && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={openInstructionsReview}
                  size="lg"
                  className="h-12 !rounded-[18px] bg-white/80 px-10 font-extrabold shadow-sm dark:bg-white/5"
                >
                  See Instructions
                </Button>
              )}

              {currentStatus === 'UPCOMING' && (
                isRegistered ? (
                  <span className="inline-flex h-12 items-center rounded-[18px] bg-[#0EA66F] px-10 text-sm font-extrabold text-white shadow-sm">
                    Registered
                  </span>
                ) : (
                  <Button
                    onClick={handleRegister}
                    disabled={isRegistering || !registrationChecked}
                    size="lg"
                    className="h-12 !rounded-[18px] !bg-[#0EA66F] px-10 font-extrabold !text-white shadow-sm transition hover:!bg-[#0B8F60] focus-visible:ring-2 focus-visible:!ring-[#0EA66F]/35 disabled:!bg-[#0EA66F]/70"
                  >
                    {!registrationChecked ? 'Checking...' : isRegistering ? 'Registering...' : 'Register Now'}
                  </Button>
                )
              )}

              {currentStatus === 'ACTIVE' && !isSubmitted && (
                <Button onClick={() => setShowSubmitConfirm(true)} disabled={isSubmitting} size="lg" className="h-12 !rounded-[18px] bg-primary px-10 font-extrabold text-white shadow-sm hover:bg-primary/90">
                  {isSubmitting ? 'Submitting...' : 'Submit Contest'}
                </Button>
              )}
            </div>
          </div>

          <div className="grid gap-6 border-b border-slate-200 py-6 text-left dark:border-white/10 sm:grid-cols-4">
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">Start Time</p>
              <p className="mt-1 text-base font-black text-slate-950 dark:text-slate-100">{formatDateTime(contest.startTime)}</p>
            </div>
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">{statusTimeLabel}</p>
              <p className={`mt-1 text-base font-black ${currentStatus === 'ACTIVE' ? 'font-mono text-red-500' : 'text-slate-950 dark:text-slate-100'}`}>{statusTimeValue}</p>
            </div>
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">Scored</p>
              {shouldShowHubScore ? (
                <p className="mt-1 text-base font-black text-slate-950 dark:text-white">{scoreDisplay}</p>
              ) : (
                <p className="mt-1 inline-flex items-center gap-2 text-base font-black text-slate-950 dark:text-white">
                  <Lock className="h-4 w-4 text-slate-500 dark:text-slate-400" />
                  <span>/ {totalPossibleScore}</span>
                </p>
              )}
            </div>
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">Warnings</p>
              <p className="mt-1 inline-flex items-center gap-2 text-base font-black text-slate-950 dark:text-white">
                <span className="h-2.5 w-2.5 rounded-full bg-red-600 shadow-[0_0_8px_rgba(220,38,38,0.45)]" />
                {displayedWarningCount}
              </p>
            </div>
          </div>
        </section>

        {currentStatus === 'UPCOMING' ? (
          <section className="grid min-h-[320px] place-items-center border-t border-slate-200 py-12 text-center dark:border-lc-border">
            <div>
              <Clock className="mx-auto h-10 w-10 text-slate-300 dark:text-slate-600" />
              <h2 className="mt-4 font-nunito text-2xl font-extrabold">Contest has not started yet</h2>
            </div>
          </section>
        ) : isRoundBasedContest ? (
          <section className="flex min-h-0 flex-1 flex-col border-t border-slate-200 pt-6 dark:border-lc-border">
            <div className="mb-5">
              <h2 className="font-nunito text-2xl font-extrabold">Rounds</h2>
            </div>
            <div className={`grid gap-4 ${contest.roundFlow === 'mcq_only' ? 'md:grid-cols-1' : 'md:grid-cols-2'}`}>
              <button
                type="button"
                disabled={
                  (!isRoundPracticeMode && (currentStatus !== 'ACTIVE' || isSubmitted || mcqRoundLocked)) ||
                  (roundsState ? (roundsState.rounds.mcq.questionCount ?? 0) === 0 : false)
                }
                onClick={() => router.push(isRoundPracticeMode ? `/contests/${contestId}/mcq/practice` : `/contests/${contestId}/mcq`)}
                className="min-h-[180px] rounded-2xl border border-slate-200 bg-white p-5 text-left shadow-sm transition hover:border-primary hover:shadow-md disabled:cursor-not-allowed disabled:opacity-60 dark:border-lc-border dark:bg-lc-surface"
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-xs font-black uppercase tracking-[0.16em] text-primary">
                      {isRoundPracticeMode ? 'MCQ Review' : contest.roundFlow === 'mcq_only' ? 'MCQ Round' : 'Phase 1'}
                    </p>
                    <h3 className="mt-2 font-nunito text-2xl font-extrabold">MCQ Test</h3>
                  </div>
                  <span className="grid h-10 w-10 place-items-center rounded-full border border-slate-200 text-slate-600 dark:border-white/10 dark:text-slate-200">
                    {mcqRoundLocked ? <Lock className="h-5 w-5" /> : <ArrowRight className="h-5 w-5" />}
                  </span>
                </div>
                <p className="mt-6 text-sm font-bold text-slate-500 dark:text-slate-400">
                  {roundsState?.rounds.mcq.submittedCount ?? 0} of {roundsState?.rounds.mcq.questionCount ?? 0} submitted
                </p>
                <p className="mt-2 text-sm font-extrabold text-slate-950 dark:text-white">
                  {isRoundPracticeMode ? 'Practice available' : roundsState?.rounds.mcq.status === 'submitted' || roundsState?.rounds.mcq.status === 'auto_submitted' ? 'Submitted' : 'Unlocked'}
                </p>
              </button>

              {contest.roundFlow === 'mcq_then_dsa' && (
                <button
                  type="button"
                  disabled={!isRoundPracticeMode && (currentStatus !== 'ACTIVE' || isSubmitted || !roundsState?.rounds.dsa.unlocked)}
                  onClick={async () => {
                    if (isRoundPracticeMode) {
                      router.push(`/contests/${contestId}/dsa/practice`);
                      return;
                    }
                    // Require fullscreen before entering the coding round. If the
                    // candidate has dropped out of fullscreen, prompt to re-enter
                    // instead of navigating into an unproctored round.
                    const fullscreenReady = document.fullscreenElement || await requestContestFullscreen();
                    if (!fullscreenReady) return;
                    router.push(`/contests/${contestId}/dsa`);
                  }}
                  className="min-h-[180px] rounded-2xl border border-slate-200 bg-white p-5 text-left shadow-sm transition hover:border-primary hover:shadow-md disabled:cursor-not-allowed disabled:opacity-60 dark:border-lc-border dark:bg-lc-surface"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-xs font-black uppercase tracking-[0.16em] text-primary">{isRoundPracticeMode ? 'DSA Review' : 'Phase 2'}</p>
                      <h3 className="mt-2 font-nunito text-2xl font-extrabold">DSA Coding Test</h3>
                    </div>
                    <span className="grid h-10 w-10 place-items-center rounded-full border border-slate-200 text-slate-600 dark:border-white/10 dark:text-slate-200">
                      {dsaRoundUnlocked ? <ArrowRight className="h-5 w-5" /> : <Lock className="h-5 w-5" />}
                    </span>
                  </div>
                  <p className="mt-6 text-sm font-bold text-slate-500 dark:text-slate-400">
                    {isRoundPracticeMode ? 'Practice coding questions without contest proctoring.' : roundsState?.rounds.dsa.unlocked ? 'Coding round is available.' : 'Submit MCQ round to unlock coding.'}
                  </p>
                  <p className="mt-2 text-sm font-extrabold text-slate-950 dark:text-white">
                    {isRoundPracticeMode ? 'Practice available' : roundsState?.rounds.dsa.status === 'submitted' || roundsState?.rounds.dsa.status === 'auto_submitted' ? 'Submitted' : roundsState?.rounds.dsa.unlocked ? 'Unlocked' : 'Locked'}
                  </p>
                </button>
              )}
            </div>
          </section>
        ) : (
          <section className="flex min-h-0 flex-1 flex-col border-t border-slate-200 pt-6 dark:border-lc-border">
            <div className="mb-5 flex shrink-0 flex-wrap items-end justify-between gap-3">
              <div>
                <h2 className="font-nunito text-2xl font-extrabold">Questions</h2>
              </div>
            </div>

            {questionsLoading && questions.length === 0 ? (
              <div className="grid min-h-0 flex-1 place-items-center rounded-lg border border-slate-200 bg-slate-50 px-5 py-8 text-center dark:border-lc-border dark:bg-[#202020]">
                <Clock className="mx-auto h-8 w-8 animate-pulse text-primary" />
                <p className="mt-3 font-nunito text-lg font-extrabold">Loading questions...</p>
                {questionLoadAttempt > 1 && (
                  <p className="mt-1 text-sm font-semibold text-slate-500 dark:text-slate-400">
                    Retrying connection {questionLoadAttempt}
                  </p>
                )}
              </div>
            ) : questions.length === 0 ? (
              <div className="grid min-h-0 flex-1 place-items-center rounded-lg border border-amber-200 bg-amber-50 px-5 py-8 text-center text-amber-900 dark:border-amber-400/30 dark:bg-amber-400/10 dark:text-amber-100">
                <AlertTriangle className="mx-auto h-8 w-8" />
                <p className="mt-3 font-nunito text-lg font-extrabold">Questions did not load</p>
                <p className="mx-auto mt-1 max-w-xl text-sm font-semibold">
                  {questionsLoadError || 'Please retry once. Your contest timer is still server-side.'}
                </p>
                <Button
                  type="button"
                  onClick={() => {
                    questionsLoadedRef.current = false;
                    void fetchQuestions();
                  }}
                  className="mt-5 rounded-full font-extrabold"
                >
                  Retry Questions
                </Button>
              </div>
            ) : (
              <div className="min-h-0 flex-1 overflow-y-scroll pr-5 [scrollbar-color:#94a3b8_#e2e8f0] [scrollbar-gutter:stable] [scrollbar-width:auto] dark:[scrollbar-color:#64748b_#1f2937] [&::-webkit-scrollbar]:w-3 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:border-2 [&::-webkit-scrollbar-thumb]:border-slate-200 [&::-webkit-scrollbar-thumb]:bg-slate-400 dark:[&::-webkit-scrollbar-thumb]:border-slate-800 dark:[&::-webkit-scrollbar-thumb]:bg-slate-500 [&::-webkit-scrollbar-track]:rounded-full [&::-webkit-scrollbar-track]:bg-slate-200 dark:[&::-webkit-scrollbar-track]:bg-slate-800">
                <div className="space-y-2 pb-4">
                  {questions.map((question, index) => {
                const isSolved = question.status === 'solved';
                const isEnded = currentStatus === 'ENDED';
                const hasPenalty = question.negativePoints !== undefined && question.negativePoints > 0;

                return (
                  <button
                    key={question.id}
                    type="button"
                    className={`group grid w-[calc(100%-0.75rem)] grid-cols-[2.25rem_minmax(0,1fr)_auto_auto] items-center gap-4 rounded-none px-1 py-5 text-left transition hover:bg-slate-100/80 dark:hover:bg-lc-hover/70 sm:px-4 ${
                      isSolved
                        ? 'bg-emerald-50/70 dark:bg-emerald-400/10'
                        : ''
                    }`}
                    onClick={async () => {
                      if (isEnded) {
                        router.push(`/questions/dsa/solve?id=${question.id}&contestId=${contestId}`);
                        return;
                      }
                      if (isSubmitted) return;
                      setPendingQuestionId(question.id);
                      const fullscreenReady = document.fullscreenElement || await requestContestFullscreen();
                      if (!fullscreenReady) return;
                      armContestIntegrity();
                      if (instructionsAcknowledged || localStorage.getItem(instructionsAckStorageKey) === 'true') {
                        setPendingQuestionId(null);
                        router.push(`/contests/${contestId}/solve/${question.id}`);
                        return;
                      }
                      setShowInstructions(true);
                    }}
                  >
                    <span className="font-mono text-xs font-black text-slate-300 dark:text-slate-600">
                      {String(index + 1).padStart(2, '0')}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-extrabold text-slate-800 dark:text-slate-100">{question.title}</span>
                      <span className="mt-2 flex flex-wrap items-center gap-2">
                        {shouldShowDifficultyTags && (
                          <span className={`rounded-full px-2.5 py-1 text-[11px] font-extrabold ${difficultyClass(question.difficulty)}`}>
                            {difficultyLabel(question.difficulty)}
                          </span>
                        )}
                        {hasPenalty && (
                          <span className="text-xs font-bold text-red-500 dark:text-red-400">
                            Penalty: -{question.negativePoints} per wrong submission
                          </span>
                        )}
                        {question.attempts !== undefined && question.attempts > 0 && (
                          <span className="text-xs font-bold text-slate-500 dark:text-slate-400">{question.attempts} attempts</span>
                        )}
                      </span>
                    </span>
                    <span className="text-right text-xs font-black text-slate-950 dark:text-white">
                      {question.points}
                      <span className="mt-0.5 block font-bold text-slate-500 dark:text-slate-400">Points</span>
                    </span>
                    <span className={`grid h-9 w-9 place-items-center rounded-full border transition ${
                      isSolved
                        ? 'border-transparent bg-transparent text-emerald-600 dark:text-emerald-400'
                        : 'border-slate-300 bg-white text-slate-600 group-hover:border-primary group-hover:text-primary dark:border-white/20 dark:bg-white/5 dark:text-slate-300'
                    }`}>
                      {isSolved ? <CheckCircle2 className="h-5 w-5" /> : <ArrowRight className="h-4 w-4" />}
                    </span>
                  </button>
                );
                })}
                </div>
              </div>
            )}
          </section>
        )}

        {currentStatus === 'ACTIVE' && !isSubmitted && integrityStarted && (
          <p className="mt-auto flex shrink-0 items-center gap-2 border-t border-slate-200 py-2.5 text-xs font-semibold text-slate-950 dark:border-white/10 dark:text-white">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span>
              Fullscreen, tab focus, clipboard, and blocked shortcut events are recorded as warnings.
            </span>
          </p>
        )}
      </main>

      <WebcamGateModal
        open={needsWebcamGate}
        onGranted={grantWebcam}
        onLeave={() => router.push('/contests')}
      />

      {showFullscreenPrompt && currentStatus === 'ACTIVE' && !isSubmitted && (integrityStarted || pendingQuestionId) && (
        <div className="fixed inset-0 z-[120] grid place-items-center bg-black/80 p-4 backdrop-blur-sm">
          <section className="w-full max-w-md rounded-lg bg-white p-6 shadow-2xl dark:bg-[#262626]">
            <div className="flex items-start gap-3">
              <ShieldCheck className="mt-1 h-6 w-6 shrink-0 text-slate-700 dark:text-slate-200" />
              <div>
                <h2 className="font-nunito text-xl font-extrabold">
                  {hasEnteredFullscreen ? 'Return to fullscreen' : 'Enter fullscreen'}
                </h2>
                <p className="mt-2 text-sm font-semibold leading-6 text-slate-500 dark:text-slate-400">
                  {hasEnteredFullscreen
                    ? 'Fullscreen is required for this contest. Browser rules may require you to confirm re-entry.'
                    : 'Fullscreen is required before you start this contest. You can still leave before entering.'}
                </p>
              </div>
            </div>
            <div className="mt-6 flex justify-end gap-3">
              {!hasEnteredFullscreen && (
                <Button variant="outline" onClick={() => router.push('/contests')} className="rounded-full font-extrabold">
                  Leave
                </Button>
              )}
              <Button
                onClick={async () => {
                  const fullscreenReady = document.fullscreenElement || await requestContestFullscreen();
                  if (!fullscreenReady) return;
                  armContestIntegrity();

                  if (pendingQuestionId && currentStatus === 'ACTIVE' && !isSubmitted) {
                    if (instructionsAcknowledged || localStorage.getItem(instructionsAckStorageKey) === 'true') {
                      const questionId = pendingQuestionId;
                      setPendingQuestionId(null);
                      router.push(`/contests/${contestId}/solve/${questionId}`);
                      return;
                    }
                    setShowInstructions(true);
                  }
                }}
                className="rounded-full bg-slate-950 font-extrabold text-white hover:bg-slate-800 dark:bg-white dark:text-slate-950 dark:hover:bg-slate-200"
              >
                {hasEnteredFullscreen ? 'Return Fullscreen' : 'Enter Fullscreen'}
              </Button>
            </div>
          </section>
        </div>
      )}

      {showInstructions && !isSubmitted && (
        <div className="fixed inset-0 z-[125] grid place-items-center bg-black/60 p-4">
          <section className="w-full max-w-2xl overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl dark:border-lc-border dark:bg-[#262626]">
            <div className="border-b border-slate-200 px-6 py-5 dark:border-lc-border">
              <div className="flex items-start gap-4">
                <ShieldCheck className="mt-1 h-6 w-6 shrink-0 text-slate-950 dark:text-white" />
                <div className="min-w-0">
                  <h2 className="font-nunito text-2xl font-extrabold text-slate-950 dark:text-white">Contest instructions</h2>
                </div>
              </div>
            </div>

            <div className="max-h-[56vh] overflow-y-auto px-6 py-5">
              <div className="grid gap-4">
                {contestInstructionLines.map((line, index) => (
                  <div key={`${index}-${line}`} className="grid grid-cols-[auto_minmax(0,1fr)] gap-3">
                    <span className="pt-0.5 text-sm font-extrabold text-slate-950 dark:text-white">
                      {index + 1}
                    </span>
                    <p className="text-sm font-semibold leading-6 text-slate-700 dark:text-slate-200">{line}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex justify-end border-t border-slate-200 px-6 py-4 dark:border-lc-border">
              <Button
                onClick={instructionsReviewOnly ? closeInstructionsReview : acknowledgeInstructions}
                variant="outline"
                className="h-11 !rounded-[14px] px-6 font-extrabold"
              >
                {instructionsReviewOnly ? 'Done' : 'I understand'}
              </Button>
            </div>
          </section>
        </div>
      )}

      {showSubmitConfirm && (
        <div className="fixed inset-0 z-[130] grid place-items-center bg-black/60 p-4">
          <section className="w-full max-w-md rounded-lg bg-white p-6 shadow-2xl dark:bg-lc-surface">
            <h2 className="font-nunito text-xl font-extrabold">Submit contest?</h2>
            <p className="mt-2 text-sm font-semibold leading-6 text-slate-500 dark:text-slate-400">
              Your current score will be finalized now. Unsubmitted MCQ answers and unsolved coding questions will count as zero.
            </p>
            <div className="mt-6 flex justify-end gap-3">
              <Button variant="outline" onClick={() => setShowSubmitConfirm(false)} disabled={isSubmitting} className="rounded-full font-extrabold">
                Cancel
              </Button>
              <Button onClick={() => submitContest('manual')} disabled={isSubmitting} className="rounded-full font-extrabold">
                {isSubmitting ? 'Submitting...' : 'Submit'}
              </Button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
