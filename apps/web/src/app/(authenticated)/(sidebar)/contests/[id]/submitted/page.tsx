'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { CheckCircle2, Lock, MessageSquare, Star } from 'lucide-react';
import { Chart as ChartJS, ArcElement, Tooltip, Legend } from 'chart.js';
import { Doughnut, Pie } from 'react-chartjs-2';
import { createSupabaseBrowserClient } from '@/lib/supabase';
import { clearContestCodeDrafts } from '@/lib/contest-integrity';
import { ShareAchievement } from '@/components/contest/achievement-share';
import { PeerInterviewBanner } from '@/components/contest/peer-interview-banner';

ChartJS.register(ArcElement, Tooltip, Legend);

const LEADERBOARD_PAGE_SIZE = 25;

interface SubmissionData {
  totalScore: number;
  submittedAt: string;
  questionsAttempted: number;
  totalQuestions: number;
  rank?: number | null;
  mcqScore?: number;
  codingScore?: number;
  timeSeconds?: number;
  scoreBreakdown?: ScoreBreakdown;
}

interface ContestQuestion {
  id: string;
  title?: string;
  points?: number;
  status?: string;
}

interface ScoreBreakdown {
  showBreakdown?: boolean;
  hasMcq?: boolean;
  hasDsa?: boolean;
  isMixed?: boolean;
  isMcqOnly?: boolean;
  scoreHidden?: boolean;
  totalScore?: number | null;
  mcqScore?: number;
  codingScore?: number;
  mcqPossibleScore?: number;
  codingPossibleScore?: number;
  totalPossibleScore?: number;
}

interface QuestionSummary {
  dsaCount: number;
  mcqCount: number;
  dsaPossibleScore: number;
  mcqPossibleScore: number;
}

interface McqReviewQuestion {
  id: string;
  title: string;
  questionText: string;
  points: number;
  selectedOptionId?: string | null;
  selectedOptionText?: string | null;
  correctOptionId: string;
  correctOptionText?: string | null;
  isCorrect: boolean;
  pointsAwarded: number;
  explanation?: string;
}

interface CachedContestDetail {
  contest?: {
    id?: string;
    title?: string;
    status?: 'UPCOMING' | 'ACTIVE' | 'ENDED';
    endTime?: string;
    showParticipants?: boolean;
    roundFlow?: 'dsa_only' | 'mcq_only' | 'mcq_then_dsa';
    round_flow?: 'dsa_only' | 'mcq_only' | 'mcq_then_dsa';
  };
  questions?: ContestQuestion[];
  userScore?: number;
  isSubmitted?: boolean;
  savedAt?: number;
}

interface LeaderboardEntry {
  rank: number;
  userId?: string;
  participant?: string;
  hacker: string;
  username?: string;
  displayName?: string;
  score: number;
  totalScore?: number;
  mcqScore?: number;
  codingScore?: number;
  scoreBreakdown?: ScoreBreakdown;
  timeSeconds: number;
  submittedAt?: string | null;
  isCurrentUser?: boolean;
}

interface LeaderboardState {
  available: boolean;
  status: 'PENDING' | 'GENERATING' | 'READY' | 'FAILED';
  entries: LeaderboardEntry[];
  message: string;
  generatedAt?: string;
  totalParticipants?: number;
  scoreBreakdown?: ScoreBreakdown;
}

function percent(value: number, total: number) {
  if (!total || total <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((value / total) * 100)));
}

function formatDate(value?: string) {
  if (!value) return '—';
  return new Date(value).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function formatDuration(totalSeconds?: number) {
  const safeSeconds = Math.max(0, Number(totalSeconds) || 0);
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const seconds = safeSeconds % 60;
  const paddedMinutes = hours > 0 ? String(minutes).padStart(2, '0') : String(minutes);
  const paddedSeconds = String(seconds).padStart(2, '0');
  return hours > 0 ? `${hours}:${paddedMinutes}:${paddedSeconds}` : `${paddedMinutes}:${paddedSeconds}`;
}

function contestDetailCacheKey(contestId: string) {
  return `contest-detail-cache-${contestId}`;
}

function readContestDetailCache(contestId: string): CachedContestDetail | null {
  if (typeof window === 'undefined' || !contestId) return null;

  try {
    const raw = window.sessionStorage.getItem(contestDetailCacheKey(contestId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedContestDetail;
    if (!parsed.contest && !Array.isArray(parsed.questions)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function deriveContestEnded(contest?: CachedContestDetail['contest']) {
  const endTime = new Date(contest?.endTime || '').getTime();
  return contest?.status === 'ENDED' || (Number.isFinite(endTime) && Date.now() >= endTime);
}

function getScoreAccent(scorePercent: number) {
  if (scorePercent > 70) return '#10b981';
  if (scorePercent >= 40) return '#f59e0b';
  return '#ef4444';
}

function chartOptions() {
  return {
    maintainAspectRatio: false,
    plugins: {
      tooltip: { enabled: false },
      legend: { display: false },
    },
  };
}

function ScoreChartCard({ score, total }: { score: number; total: number }) {
  const displayTotal = Math.max(total, score, 0);
  const scorePercent = percent(score, displayTotal);
  const accent = getScoreAccent(scorePercent);
  const chartTotal = displayTotal > 0 ? displayTotal : 1;
  const scoreValue = Math.max(0, Math.min(score, chartTotal));
  const scoreLabel = 'Total Score';
  const data = {
    labels: ['Score', 'Remaining'],
    datasets: [
      {
        data: [scoreValue, Math.max(chartTotal - scoreValue, 0)],
        backgroundColor: [accent, 'rgba(148, 163, 184, 0.22)'],
        borderWidth: 0,
        cutout: '80%',
      },
    ],
  };

  return (
    <div className="relative overflow-hidden rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_18px_50px_rgba(15,23,42,0.07)] dark:border-white/10 dark:bg-white/[0.04]">
      <div className="absolute inset-x-0 top-0 h-1" style={{ backgroundColor: accent }} />
      <div className="relative flex items-center gap-5">
        <div className="relative size-32 shrink-0">
          <Doughnut data={data} options={chartOptions()} />
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="font-nunito text-3xl font-black leading-none tracking-tight" style={{ color: accent }}>
              {score}
            </span>
            <span className="mt-1 text-[10px] font-bold uppercase tracking-widest text-slate-400">/ {displayTotal}</span>
          </div>
        </div>
        <div className="min-w-0">
          <p className="text-xs font-extrabold uppercase tracking-[0.14em] text-slate-400">Score</p>
          <p className="mt-2 font-nunito text-xl font-extrabold text-slate-950 dark:text-white">{scoreLabel}</p>
          <p className="mt-1 text-sm font-bold text-slate-500 dark:text-slate-400">{scorePercent}% of total points</p>
          <div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-white/10">
            <div className="h-full rounded-full" style={{ width: `${scorePercent}%`, backgroundColor: accent }} />
          </div>
        </div>
      </div>
    </div>
  );
}

function RoundScoreCard({
  label,
  score,
  total,
  accent,
}: {
  label: string;
  score: number;
  total: number;
  accent: string;
}) {
  const displayTotal = Math.max(total, Math.abs(score), 0);
  const scorePercent = displayTotal > 0 ? percent(Math.max(score, 0), displayTotal) : 0;
  const chartTotal = displayTotal > 0 ? displayTotal : 1;
  const scoreValue = Math.max(0, Math.min(score, chartTotal));
  const data = {
    labels: [label, 'Remaining'],
    datasets: [
      {
        data: [scoreValue, Math.max(chartTotal - scoreValue, 0)],
        backgroundColor: [accent, 'rgba(148, 163, 184, 0.22)'],
        borderWidth: 0,
        cutout: '80%',
      },
    ],
  };

  return (
    <div className="relative overflow-hidden rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_18px_50px_rgba(15,23,42,0.07)] dark:border-white/10 dark:bg-white/[0.04]">
      <div className="absolute inset-x-0 top-0 h-1" style={{ backgroundColor: accent }} />
      <div className="relative flex items-center gap-5">
        <div className="relative size-32 shrink-0">
          <Doughnut data={data} options={chartOptions()} />
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="font-nunito text-3xl font-black leading-none tracking-tight" style={{ color: score < 0 ? '#ef4444' : accent }}>
              {score}
            </span>
            <span className="mt-1 text-[10px] font-bold uppercase tracking-widest text-slate-400">/ {displayTotal}</span>
          </div>
        </div>
        <div className="min-w-0">
          <p className="text-xs font-extrabold uppercase tracking-[0.14em] text-slate-400">Score</p>
          <p className="mt-2 font-nunito text-xl font-extrabold text-slate-950 dark:text-white">{label}</p>
          <p className="mt-1 text-sm font-bold text-slate-500 dark:text-slate-400">{scorePercent}% of round points</p>
          <div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-white/10">
            <div className="h-full rounded-full" style={{ width: `${scorePercent}%`, backgroundColor: accent }} />
          </div>
        </div>
      </div>
    </div>
  );
}

function LineMetricCard({
  label,
  value,
  total,
  accent,
}: {
  label: string;
  value: number;
  total: number;
  accent: string;
}) {
  const safeTotal = Math.max(total, 0);
  const clampedValue = Math.max(0, Math.min(value, safeTotal));
  const metricPercent = percent(clampedValue, safeTotal);

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_18px_50px_rgba(15,23,42,0.07)] dark:border-white/10 dark:bg-white/[0.04]">
      <p className="text-xs font-extrabold uppercase tracking-[0.14em] text-slate-400">{label}</p>
      <div className="mt-4 flex items-end justify-between gap-4">
        <p className="font-nunito text-4xl font-black leading-none text-slate-950 dark:text-white">
          {clampedValue}<span className="text-lg text-slate-400">/{safeTotal}</span>
        </p>
        <p className="text-sm font-extrabold" style={{ color: accent }}>{metricPercent}%</p>
      </div>
      <div className="mt-6">
        <div className="h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-white/10">
          <div className="h-full rounded-full" style={{ width: `${metricPercent}%`, backgroundColor: accent }} />
        </div>
        <div className="mt-3 flex justify-between text-[10px] font-black uppercase tracking-[0.14em] text-slate-400">
          <span>0</span>
          <span>{safeTotal}</span>
        </div>
      </div>
    </div>
  );
}

function McqOutcomeCard({
  correct,
  incorrect,
  answered,
  total,
  reviewAvailable,
}: {
  correct: number;
  incorrect: number;
  answered: number;
  total: number;
  reviewAvailable: boolean;
}) {
  const safeTotal = Math.max(total, correct + incorrect, answered, 0);
  const unattempted = Math.max(safeTotal - (reviewAvailable ? correct + incorrect : answered), 0);
  const segments = reviewAvailable
    ? [
        { label: 'Correct', value: correct, color: '#10b981' },
        { label: 'Incorrect', value: incorrect, color: '#ef4444' },
        { label: 'Unattempted', value: unattempted, color: 'rgba(148, 163, 184, 0.35)' },
      ]
    : [
        { label: 'Submitted', value: answered, color: '#3b82f6' },
        { label: 'Unattempted', value: unattempted, color: 'rgba(148, 163, 184, 0.35)' },
      ];
  const chartSegments = segments.filter((segment) => segment.value > 0);
  const data = {
    labels: chartSegments.length > 0 ? chartSegments.map((segment) => segment.label) : ['No MCQs'],
    datasets: [
      {
        data: chartSegments.length > 0 ? chartSegments.map((segment) => segment.value) : [1],
        backgroundColor: chartSegments.length > 0 ? chartSegments.map((segment) => segment.color) : ['rgba(148, 163, 184, 0.22)'],
        borderWidth: 0,
      },
    ],
  };

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-white/[0.03] lg:col-span-2">
      <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
        <div className="relative size-28 shrink-0">
          <Pie data={data} options={chartOptions()} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-extrabold uppercase tracking-[0.14em] text-slate-400">MCQ Outcomes</p>
          <p className="mt-2 font-nunito text-3xl font-extrabold leading-none text-slate-950 dark:text-white">
            {reviewAvailable ? `${correct}/${safeTotal}` : `${answered}/${safeTotal}`}
          </p>
          <div className="mt-4 grid gap-2 sm:grid-cols-3">
            {segments.map((segment) => (
              <div key={segment.label} className="flex items-center gap-2 rounded-xl bg-slate-50 px-3 py-2 dark:bg-white/[0.04]">
                <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: segment.color }} />
                <span className="text-xs font-extrabold text-slate-500 dark:text-slate-300">{segment.label}</span>
                <span className="ml-auto font-mono text-sm font-extrabold text-slate-950 dark:text-white">{segment.value}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function ContestSubmittedPage() {
  const params = useParams();
  const router = useRouter();
  const contestId = params.id as string;

  const [loading, setLoading] = useState(true);
  const [submissionData, setSubmissionData] = useState<SubmissionData | null>(null);
  const [cachedScore, setCachedScore] = useState(0);
  const [contestTitle, setContestTitle] = useState('');
  const [contestStatus, setContestStatus] = useState<'UPCOMING' | 'ACTIVE' | 'ENDED' | null>(null);
  const [contestRoundFlow, setContestRoundFlow] = useState<'dsa_only' | 'mcq_only' | 'mcq_then_dsa' | null>(null);
  const [contestEnded, setContestEnded] = useState(false);
  const [participantSubmitted, setParticipantSubmitted] = useState(false);
  const [showParticipants, setShowParticipants] = useState(false);
  const [showReviewLocked, setShowReviewLocked] = useState(false);
  const [questions, setQuestions] = useState<ContestQuestion[]>([]);
  const [questionSummary, setQuestionSummary] = useState<QuestionSummary>({
    dsaCount: 0,
    mcqCount: 0,
    dsaPossibleScore: 0,
    mcqPossibleScore: 0,
  });
  const [mcqReviewAvailable, setMcqReviewAvailable] = useState(false);
  const [mcqReviewQuestions, setMcqReviewQuestions] = useState<McqReviewQuestion[]>([]);
  const [leaderboardState, setLeaderboardState] = useState<LeaderboardState>({
    available: false,
    status: 'PENDING',
    entries: [],
    message: 'Leaderboard will be available soon.',
  });
  const [leaderboardPage, setLeaderboardPage] = useState(0);
  const [feedbackRating, setFeedbackRating] = useState(0);
  const [feedbackHoverRating, setFeedbackHoverRating] = useState(0);
  const [feedbackComment, setFeedbackComment] = useState('');
  const [feedbackSaving, setFeedbackSaving] = useState(false);
  const [feedbackSubmitted, setFeedbackSubmitted] = useState(false);
  const [feedbackError, setFeedbackError] = useState<string | null>(null);
  const [currentUserId, setCurrentUserId] = useState('');
  const [currentUserName, setCurrentUserName] = useState('You');
  const feedbackFinishedRef = useRef(false);

  const fetchSubmissionData = useCallback(async () => {
    try {
      const supabase = createSupabaseBrowserClient();
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      const sessionUser = sessionData.session?.user;
      if (sessionUser) {
        setCurrentUserId(sessionUser.id || '');
        const metadata = (sessionUser.user_metadata || {}) as Record<string, unknown>;
        const nameFromSession = String(
          metadata.full_name || metadata.name || metadata.user_name || sessionUser.email || 'You'
        ).trim();
        setCurrentUserName(nameFromSession || 'You');
      }

      if (!token) {
        router.push('/login');
        return;
      }

      const contestApiUrl = process.env.NEXT_PUBLIC_CONTEST_API_URL || 'http://localhost:3002';
      const [contestResponse, rankResponse, dsaQuestionsResponse, mcqQuestionsResponse, leaderboardResponse, feedbackResponse, mcqReviewResponse] = await Promise.all([
        fetch(`${contestApiUrl}/contests/${contestId}`, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' }),
        fetch(`${contestApiUrl}/contests/${contestId}/my-rank`, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' }),
        fetch(`${contestApiUrl}/contests/${contestId}/questions?phase=dsa`, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' }),
        fetch(`${contestApiUrl}/contests/${contestId}/questions?phase=mcq`, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' }),
        fetch(`${contestApiUrl}/contests/${contestId}/leaderboard/generated?limit=10000`, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' }),
        fetch(`${contestApiUrl}/contests/${contestId}/feedback/me`, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' }),
        fetch(`${contestApiUrl}/contests/${contestId}/mcq/review`, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' }),
      ]);

      if (contestResponse.ok) {
        const contestData = await contestResponse.json();
        const contest = contestData.contest;
        const derivedContestStatus = deriveContestEnded(contest)
          ? 'ENDED'
          : contest?.status === 'ACTIVE'
            ? 'ACTIVE'
            : 'UPCOMING';
        setContestTitle(contest?.title || 'Contest');
        setContestStatus(derivedContestStatus);
        setContestRoundFlow(contest?.roundFlow || contest?.round_flow || null);
        setContestEnded(derivedContestStatus === 'ENDED');
        setShowParticipants(contest?.showParticipants === true);
      }

      const dsaQuestionData = dsaQuestionsResponse.ok ? await dsaQuestionsResponse.json().catch(() => ({})) : {};
      const mcqQuestionData = mcqQuestionsResponse.ok ? await mcqQuestionsResponse.json().catch(() => ({})) : {};
      const dsaQuestions = Array.isArray(dsaQuestionData.questions) ? dsaQuestionData.questions : [];
      const mcqQuestions = Array.isArray(mcqQuestionData.questions) ? mcqQuestionData.questions : [];
      const nextQuestions = [...dsaQuestions, ...mcqQuestions];
      const nextQuestionSummary = {
        dsaCount: dsaQuestions.length,
        mcqCount: mcqQuestions.length,
        dsaPossibleScore: dsaQuestions.reduce((sum: number, question: ContestQuestion) => sum + (Number(question.points) || 0), 0),
        mcqPossibleScore: mcqQuestions.reduce((sum: number, question: ContestQuestion) => sum + (Number(question.points) || 0), 0),
      };
      setQuestions((previous) => (nextQuestions.length > 0 || previous.length === 0 ? nextQuestions : previous));
      setQuestionSummary((previous) => (
        nextQuestions.length > 0 || previous.dsaCount + previous.mcqCount === 0 ? nextQuestionSummary : previous
      ));

      if (mcqReviewResponse.ok) {
        const mcqReviewData = await mcqReviewResponse.json().catch(() => ({}));
        setMcqReviewAvailable(Boolean(mcqReviewData.available));
        setMcqReviewQuestions(Array.isArray(mcqReviewData.questions) ? mcqReviewData.questions : []);
      } else {
        setMcqReviewAvailable(false);
        setMcqReviewQuestions([]);
      }

      if (rankResponse.ok) {
        const rankData = await rankResponse.json();
        const rankScoreBreakdown = rankData.scoreBreakdown as ScoreBreakdown | undefined;
        const rankTotalScore = Number(rankData.totalScore ?? rankScoreBreakdown?.totalScore ?? 0);
        setParticipantSubmitted(Boolean(rankData.participant?.isSubmitted));
        setCachedScore(rankTotalScore);
        setSubmissionData({
          totalScore: rankTotalScore,
          submittedAt: rankData.participant?.submittedAt || '',
          questionsAttempted: rankData.questionsAttempted || 0,
          totalQuestions: rankData.totalQuestions || 0,
          rank: rankData.rank || null,
          mcqScore: Number(rankData.mcqScore ?? rankScoreBreakdown?.mcqScore ?? 0),
          codingScore: Number(rankData.codingScore ?? rankScoreBreakdown?.codingScore ?? 0),
          timeSeconds: Number(rankData.timeSeconds ?? 0),
          scoreBreakdown: rankScoreBreakdown,
        });
      }

      if (leaderboardResponse.ok) {
        const leaderboardData = await leaderboardResponse.json();
        setLeaderboardState({
          available: Boolean(leaderboardData.available),
          status: leaderboardData.status || 'PENDING',
          entries: leaderboardData.leaderboard || [],
          message: leaderboardData.message || 'Leaderboard will be available soon.',
          generatedAt: leaderboardData.generatedAt,
          totalParticipants: leaderboardData.totalParticipants,
          scoreBreakdown: leaderboardData.scoreBreakdown,
        });
      }

      if (feedbackResponse.ok) {
        const feedbackData = await feedbackResponse.json();
        const savedFeedback = feedbackData.feedback;
        if (savedFeedback) {
          setFeedbackSubmitted(true);
          setFeedbackRating(Number(savedFeedback.rating) || 0);
          setFeedbackComment(savedFeedback.comment || '');
        } else {
          setFeedbackSubmitted(false);
        }
      } else {
        setFeedbackSubmitted(false);
      }
    } catch {
    } finally {
      setLoading(false);
    }
  }, [contestId, router]);

  useEffect(() => {
    const cached = readContestDetailCache(contestId);
    setLoading(true);
    setSubmissionData(null);
    setCachedScore(Number(cached?.userScore || 0));
    setContestTitle(cached?.contest?.title || '');
    setContestStatus(cached?.contest?.status || null);
    setContestRoundFlow(cached?.contest?.roundFlow || cached?.contest?.round_flow || null);
    setContestEnded(deriveContestEnded(cached?.contest));
    setParticipantSubmitted(Boolean(cached?.isSubmitted));
    setShowParticipants(cached?.contest?.showParticipants === true);
    setQuestions(Array.isArray(cached?.questions) ? cached.questions : []);
    setQuestionSummary({
      dsaCount: 0,
      mcqCount: 0,
      dsaPossibleScore: 0,
      mcqPossibleScore: 0,
    });
    setMcqReviewAvailable(false);
    setMcqReviewQuestions([]);
    setLeaderboardState({
      available: false,
      status: 'PENDING',
      entries: [],
      message: 'Leaderboard will be available soon.',
    });
    setLeaderboardPage(0);
    setFeedbackRating(0);
    setFeedbackHoverRating(0);
    setFeedbackComment('');
    setFeedbackSaving(false);
    setFeedbackSubmitted(false);
    setFeedbackError(null);
    clearContestCodeDrafts(contestId);
    void fetchSubmissionData();
  }, [contestId, fetchSubmissionData]);

  // A user "attended" the contest only if /my-rank returned their participant
  // record (non-participants get a 404, so submissionData stays null). The
  // leaderboard itself is visible to everyone, but personal sections and the
  // mandatory feedback gate are only for participants.
  const isParticipant = Boolean(submissionData);
  const feedbackRequired = !loading && isParticipant && !feedbackSubmitted;

  useEffect(() => {
    feedbackFinishedRef.current = !feedbackRequired;
  }, [feedbackRequired]);

  useEffect(() => {
    if (!feedbackRequired) {
      document.body.classList.remove('contest-active-hide-nav');
      return;
    }

    document.body.classList.add('contest-active-hide-nav');
    return () => document.body.classList.remove('contest-active-hide-nav');
  }, [feedbackRequired]);

  useEffect(() => {
    if (!feedbackRequired || document.fullscreenElement) return;
    void document.documentElement.requestFullscreen().catch(() => undefined);
  }, [feedbackRequired]);

  useEffect(() => {
    if (!feedbackRequired) return;

    const keepFullscreen = () => {
      if (feedbackFinishedRef.current || document.fullscreenElement) return;
      window.setTimeout(() => {
        if (!feedbackFinishedRef.current && !document.fullscreenElement) {
          void document.documentElement.requestFullscreen().catch(() => undefined);
        }
      }, 120);
    };

    document.addEventListener('fullscreenchange', keepFullscreen);
    document.addEventListener('visibilitychange', keepFullscreen);
    return () => {
      document.removeEventListener('fullscreenchange', keepFullscreen);
      document.removeEventListener('visibilitychange', keepFullscreen);
    };
  }, [feedbackRequired]);

  const submitFeedback = useCallback(async () => {
    if (feedbackRating < 1) {
      setFeedbackError('Choose a star rating to finish your contest checkout.');
      return;
    }

    setFeedbackSaving(true);
    setFeedbackError(null);

    try {
      const supabase = createSupabaseBrowserClient();
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;

      if (!token) {
        router.push('/login');
        return;
      }

      const contestApiUrl = process.env.NEXT_PUBLIC_CONTEST_API_URL || 'http://localhost:3002';
      const response = await fetch(`${contestApiUrl}/contests/${contestId}/feedback`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          rating: feedbackRating,
          comment: feedbackComment,
        }),
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.message || 'Unable to save feedback right now.');
      }

      setFeedbackSubmitted(true);
      feedbackFinishedRef.current = true;
      document.body.classList.remove('contest-active-hide-nav');
      if (document.fullscreenElement) {
        await document.exitFullscreen().catch(() => undefined);
      }
    } catch (error: unknown) {
      setFeedbackError(error instanceof Error ? error.message : 'Unable to save feedback right now.');
    } finally {
      setFeedbackSaving(false);
    }
  }, [contestId, feedbackComment, feedbackRating, router]);

  const totalPossibleScore = useMemo(() => {
    return questions.reduce((sum, question) => sum + (Number(question.points) || 0), 0);
  }, [questions]);

  const scoreBreakdown = submissionData?.scoreBreakdown || leaderboardState.scoreBreakdown;
  const flowHasMcq = contestRoundFlow ? contestRoundFlow !== 'dsa_only' : undefined;
  const flowHasDsa = contestRoundFlow ? contestRoundFlow !== 'mcq_only' : undefined;
  const hasMcqInContest = Boolean(scoreBreakdown?.hasMcq ?? scoreBreakdown?.isMcqOnly ?? scoreBreakdown?.isMixed ?? flowHasMcq ?? questionSummary.mcqCount > 0);
  const hasDsaInContest = Boolean(scoreBreakdown?.hasDsa ?? (scoreBreakdown?.isMixed ? true : undefined) ?? flowHasDsa ?? questionSummary.dsaCount > 0);
  const isMixedContest = Boolean(scoreBreakdown?.isMixed ?? (contestRoundFlow === 'mcq_then_dsa' ? true : undefined) ?? (hasMcqInContest && hasDsaInContest));
  const isMcqOnlyContest = Boolean(scoreBreakdown?.isMcqOnly ?? (contestRoundFlow === 'mcq_only' ? true : undefined) ?? (hasMcqInContest && !hasDsaInContest));
  const mcqPossibleScore = Number(scoreBreakdown?.mcqPossibleScore ?? questionSummary.mcqPossibleScore ?? 0);
  const codingPossibleScore = Number(scoreBreakdown?.codingPossibleScore ?? questionSummary.dsaPossibleScore ?? 0);
  const totalBreakdownPossibleScore = Number(scoreBreakdown?.totalPossibleScore ?? (mcqPossibleScore + codingPossibleScore));
  const mcqScore = Number(scoreBreakdown?.mcqScore ?? submissionData?.mcqScore ?? 0);
  const codingScore = Number(scoreBreakdown?.codingScore ?? submissionData?.codingScore ?? 0);
  const score = submissionData?.totalScore ?? cachedScore;
  const attemptedFromQuestions = questions.filter((question) => {
    const status = question.status?.toLowerCase();
    return status === 'attempted' || status === 'solved' || status === 'submitted';
  }).length;
  const attempted = Math.max(submissionData?.questionsAttempted || 0, attemptedFromQuestions);
  const totalQuestions = submissionData?.totalQuestions || questions.length || 0;
  const solvedDsaCount = questions.filter((question) => question.status?.toLowerCase() === 'solved').length;
  const mcqTotalQuestions = Math.max(questionSummary.mcqCount, mcqReviewQuestions.length, isMcqOnlyContest ? totalQuestions : 0);
  const mcqCorrectCount = mcqReviewAvailable ? mcqReviewQuestions.filter((question) => question.isCorrect).length : 0;
  const mcqIncorrectCount = mcqReviewAvailable
    ? mcqReviewQuestions.filter((question) => Boolean(question.selectedOptionId) && !question.isCorrect).length
    : 0;
  const mcqAnsweredCount = mcqReviewAvailable
    ? mcqReviewQuestions.filter((question) => Boolean(question.selectedOptionId)).length
    : Math.min(attempted, mcqTotalQuestions);
  const solved = solvedDsaCount + (mcqReviewAvailable ? mcqCorrectCount : 0);
  const possibleScore = totalBreakdownPossibleScore || totalPossibleScore || Math.max(score, 0);
  const leaderboardScoreBreakdown = leaderboardState.scoreBreakdown || scoreBreakdown;
  const showLeaderboardBreakdown = Boolean((leaderboardScoreBreakdown?.hasMcq ?? hasMcqInContest) && (leaderboardScoreBreakdown?.hasDsa ?? hasDsaInContest));
  const leaderboardHasDsa = Boolean(leaderboardScoreBreakdown?.hasDsa ?? hasDsaInContest);
  const scoreDisplay = `${score} / ${possibleScore || 0}`;
  const showRankStat = leaderboardState.available && Boolean(submissionData?.rank);
  const rankLabel = showRankStat ? `#${submissionData?.rank}` : '';
  const summaryStatusLabel = participantSubmitted
    ? 'Submitted'
    : contestStatus === 'ACTIVE'
      ? 'In Progress'
      : contestStatus === 'UPCOMING'
        ? 'Upcoming'
        : 'Completed';
  const totalLeaderboardPages = Math.max(1, Math.ceil(leaderboardState.entries.length / LEADERBOARD_PAGE_SIZE));
  const safeLeaderboardPage = Math.min(leaderboardPage, totalLeaderboardPages - 1);
  const currentUserEntry = leaderboardState.entries.find(
    (entry) => entry.isCurrentUser || (currentUserId && entry.userId === currentUserId)
  );
  // LeetCode-style: always pin the current user at the top so they never have to
  // scroll the full leaderboard to find themselves. If they ranked beyond the
  // fetched entries, fall back to their own rank data (from /my-rank).
  const currentUserRow: LeaderboardEntry | null = !isParticipant
    ? null
    : currentUserEntry
    ? { ...currentUserEntry, isCurrentUser: true }
    : leaderboardState.available && submissionData?.rank
      ? {
          rank: submissionData.rank,
          userId: currentUserId,
          participant: currentUserName,
          hacker: currentUserName,
          username: currentUserName,
          displayName: currentUserName,
          score: submissionData.totalScore,
          totalScore: submissionData.totalScore,
          mcqScore: submissionData.mcqScore,
          codingScore: submissionData.codingScore,
          scoreBreakdown: submissionData.scoreBreakdown,
          timeSeconds: submissionData.timeSeconds ?? 0,
          isCurrentUser: true,
        }
      : null;
  const visibleLeaderboardEntries = leaderboardState.entries
    .slice(safeLeaderboardPage * LEADERBOARD_PAGE_SIZE, safeLeaderboardPage * LEADERBOARD_PAGE_SIZE + LEADERBOARD_PAGE_SIZE)
    .filter((entry) => !entry.isCurrentUser && !(currentUserRow && entry.userId === currentUserRow.userId));
  const summaryCards = (
    <>
      <ScoreChartCard score={score} total={possibleScore || 0} />
      {isMixedContest ? (
        <>
          <RoundScoreCard
            label="MCQ Score"
            score={mcqScore}
            total={mcqPossibleScore}
            accent="#8b5cf6"
          />
          <RoundScoreCard
            label="Coding Score"
            score={codingScore}
            total={codingPossibleScore}
            accent="#3b82f6"
          />
        </>
      ) : isMcqOnlyContest ? (
        <McqOutcomeCard
          correct={mcqCorrectCount}
          incorrect={mcqIncorrectCount}
          answered={mcqAnsweredCount}
          total={mcqTotalQuestions}
          reviewAvailable={mcqReviewAvailable}
        />
      ) : (
        <>
          <LineMetricCard label="Attempted" value={attempted} total={totalQuestions || 0} accent="#3b82f6" />
          <LineMetricCard label="Solved" value={solved} total={totalQuestions || 0} accent="#10b981" />
        </>
      )}
    </>
  );

  if (loading) {
    return (
      <div className="grid min-h-screen place-items-center bg-[#f7f9fc] text-slate-600 dark:bg-lc-bg dark:text-slate-300">
        <div className="text-center">
          <div className="mx-auto h-9 w-9 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          <p className="mt-4 text-sm font-semibold">Loading submission...</p>
        </div>
      </div>
    );
  }

  if (!contestEnded && !isMixedContest) {
    return (
      <div className="min-h-screen bg-[#FAFBFC] px-4 py-6 text-slate-950 dark:bg-lc-bg dark:text-white sm:px-6 lg:px-8">
        <main className="mx-auto max-w-6xl">
          <section className="pt-2">
            <div className="pb-5">
              <h1 className="font-nunito text-3xl font-black text-slate-950 dark:text-white">{contestTitle || 'Contest'}</h1>
            </div>

            <div className="grid gap-6 border-b border-slate-200 py-6 text-left dark:border-white/10 sm:grid-cols-4">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">Submitted</p>
                <p className="mt-1 text-base font-black text-slate-950 dark:text-slate-100">
                  {isParticipant ? formatDate(submissionData?.submittedAt) : 'Not Attempted'}
                </p>
              </div>
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">Status</p>
                <p className="mt-1 text-base font-black text-slate-950 dark:text-slate-100">
                  {isParticipant ? summaryStatusLabel : '—'}
                </p>
              </div>
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">Scored</p>
                <p className="mt-1 text-base font-black text-slate-950 dark:text-white">
                  {isParticipant ? scoreDisplay : '—'}
                </p>
              </div>
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">Questions</p>
                <p className="mt-1 text-base font-black text-slate-950 dark:text-white">
                  {isParticipant ? attempted : 0} / {totalQuestions || 0}
                </p>
              </div>
            </div>
          </section>

          <section className="border-t border-slate-200 pt-6 dark:border-white/10">
            {isParticipant && (
              <>
                <div className="mb-5">
                  <h2 className="font-nunito text-2xl font-extrabold">Summary</h2>
                </div>

                <div className="grid gap-4 lg:grid-cols-[1.15fr_1fr_1fr]">
                  {summaryCards}
                </div>
              </>
            )}

            <div className="mt-8 rounded-xl border border-dashed border-slate-300 bg-white px-5 py-8 text-center dark:border-white/10 dark:bg-white/[0.03]">
              <p className="font-nunito text-xl font-extrabold text-slate-950 dark:text-white">
                Result will be available after the contest ends.
              </p>
            </div>
          </section>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#FAFBFC] px-4 py-6 text-slate-950 dark:bg-lc-bg dark:text-white sm:px-6 lg:px-8">
      <main className="mx-auto max-w-6xl">
        <PeerInterviewBanner className="mb-6" />
        <section className="pt-2">
          <div className="flex flex-col gap-4 pb-5 sm:flex-row sm:items-center sm:justify-between">
            <h1 className="font-nunito text-3xl font-black text-slate-950 dark:text-white">{contestTitle || 'Contest'}</h1>
            <div className="flex flex-wrap items-center gap-3 sm:justify-end">
              <div className="flex h-12 rounded-[18px] bg-white/80 p-1 shadow-sm ring-1 ring-slate-200 dark:bg-white/5 dark:ring-white/10">
                <button
                  type="button"
                  onClick={() => {
                    if (feedbackRequired) return;
                    // The contest review (question breakdown / solutions) only
                    // unlocks once the contest ends. Until then, explain why
                    // instead of bouncing the candidate back to this page.
                    if (!contestEnded) {
                      setShowReviewLocked(true);
                      return;
                    }
                    router.push(`/contests/${contestId}`);
                  }}
                  disabled={feedbackRequired}
                  className="rounded-[14px] px-6 text-sm font-extrabold text-slate-500 transition hover:bg-slate-100 hover:text-slate-950 disabled:cursor-not-allowed disabled:opacity-50 dark:text-slate-300 dark:hover:bg-white/10 dark:hover:text-white"
                >
                  View
                </button>
                <button
                  type="button"
                  className="rounded-[14px] bg-primary px-6 text-sm font-extrabold text-white shadow-sm"
                  aria-current="page"
                >
                  Result
                </button>
              </div>
            </div>
          </div>

          <div className="grid gap-6 border-b border-slate-200 py-6 text-left dark:border-white/10 sm:grid-cols-4">
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">Submitted</p>
              <p className="mt-1 text-base font-black text-slate-950 dark:text-slate-100">
                {isParticipant ? formatDate(submissionData?.submittedAt) : 'Not Attempted'}
              </p>
            </div>
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">Rank</p>
              <p className="mt-1 text-base font-black text-slate-950 dark:text-slate-100">
                {isParticipant ? (showRankStat ? rankLabel : '—') : '—'}
              </p>
            </div>
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">Scored</p>
              <p className="mt-1 text-base font-black text-slate-950 dark:text-white">
                {isParticipant ? scoreDisplay : '—'}
              </p>
            </div>
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">Questions</p>
              <p className="mt-1 text-base font-black text-slate-950 dark:text-white">
                {isParticipant ? attempted : 0} / {totalQuestions || 0}
              </p>
            </div>
          </div>
        </section>

        {isParticipant && (
          <section className="pt-6">
            <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h2 className="font-nunito text-2xl font-extrabold">Result summary</h2>
              </div>
            </div>

            <div className="grid gap-4 lg:grid-cols-[1.15fr_1fr_1fr]">
              {summaryCards}
            </div>
          </section>
        )}

        <section className="mt-8 pt-2">
          <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 className="font-nunito text-2xl font-extrabold">Leaderboard</h2>
            </div>
            {leaderboardState.available && showParticipants && (
              <div className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-extrabold text-slate-600 shadow-sm dark:border-white/10 dark:bg-white/[0.04] dark:text-slate-300">
                {leaderboardState.totalParticipants || leaderboardState.entries.length} participants
              </div>
            )}
          </div>

          {!leaderboardState.available ? (
            <div className="rounded-xl border border-dashed border-slate-300 bg-white px-5 py-8 text-center dark:border-white/10 dark:bg-white/[0.03]">
              <p className="font-nunito text-xl font-extrabold text-slate-950 dark:text-white">
                Leaderboard will be available soon.
              </p>
            </div>
          ) : leaderboardState.entries.length === 0 ? (
            <div className="rounded-xl border border-slate-200 bg-white px-5 py-8 text-center dark:border-white/10 dark:bg-white/[0.03]">
              <p className="font-bold text-slate-500 dark:text-slate-400">No leaderboard entries yet.</p>
            </div>
          ) : (
            <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_22px_70px_rgba(15,23,42,0.08)] dark:border-white/10 dark:bg-white/[0.04]">
              <div className="flex flex-col gap-2 border-b border-slate-200 px-5 py-4 dark:border-white/10 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="font-nunito text-lg font-black text-slate-950 dark:text-white">Contest standings</p>
                </div>
                <p className="text-sm font-extrabold text-slate-500 dark:text-slate-300">
                  Page {safeLeaderboardPage + 1} of {totalLeaderboardPages}
                </p>
              </div>
              <div className="overflow-x-auto">
                <table className={`w-full text-sm ${showLeaderboardBreakdown ? (leaderboardHasDsa ? 'min-w-[760px]' : 'min-w-[680px]') : 'min-w-[620px]'}`}>
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50/80 text-left text-xs font-extrabold uppercase tracking-[0.14em] text-slate-400 dark:border-white/10 dark:bg-white/[0.05]">
                      <th className="px-5 py-4">Participant</th>
                      <th className="px-5 py-4 text-center">Rank</th>
                      <th className="px-5 py-4 text-right">Total</th>
                      {showLeaderboardBreakdown && <th className="px-5 py-4 text-right">MCQ</th>}
                      {showLeaderboardBreakdown && leaderboardHasDsa && <th className="px-5 py-4 text-right">Coding</th>}
                      <th className="px-5 py-4 text-right">Time</th>
                    </tr>
                  </thead>
                  <tbody>
                    {currentUserRow && (() => {
                      const displayName = currentUserRow.participant || currentUserRow.displayName || currentUserRow.username || currentUserRow.hacker;
                      const entryTotalScore = Number(currentUserRow.totalScore ?? currentUserRow.score ?? 0);
                      const entryMcqScore = Number(currentUserRow.mcqScore ?? currentUserRow.scoreBreakdown?.mcqScore ?? 0);
                      const entryCodingScore = Number(currentUserRow.codingScore ?? currentUserRow.scoreBreakdown?.codingScore ?? 0);
                      return (
                        <tr
                          key={`current-${currentUserRow.rank}-${currentUserRow.userId || displayName}`}
                          className="sticky top-0 z-10 border-b border-primary/20 bg-[#eef5ff] shadow-[0_8px_24px_rgba(37,99,235,0.08)] dark:border-primary/30 dark:bg-primary/15"
                        >
                          <td className="px-5 py-4">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-extrabold text-slate-950 dark:text-white">{displayName}</span>
                              <span className="inline-flex h-7 items-center rounded-full bg-primary px-3 text-[11px] font-black uppercase leading-none tracking-[0.1em] text-white">You</span>
                              <ShareAchievement
                                name={displayName}
                                rank={currentUserRow.rank}
                                score={entryTotalScore}
                                possibleScore={possibleScore}
                                solved={solved}
                                totalQuestions={totalQuestions}
                                timeLabel={formatDuration(currentUserRow.timeSeconds)}
                                contestTitle={contestTitle || 'this contest'}
                                shareUrl={typeof window !== 'undefined' ? `${window.location.origin}/contests/${contestId}` : ''}
                                mcqScore={entryMcqScore}
                                codingScore={entryCodingScore}
                                showBreakdown={showLeaderboardBreakdown}
                              />
                            </div>
                          </td>
                          <td className="px-5 py-4 text-center">
                            <span className="font-mono text-base font-black text-slate-950 dark:text-white">
                              {String(currentUserRow.rank).padStart(2, '0')}
                            </span>
                          </td>
                          <td className="px-5 py-4 text-right font-mono text-base font-extrabold">{entryTotalScore}</td>
                          {showLeaderboardBreakdown && (
                            <td className="px-5 py-4 text-right font-mono text-base font-semibold text-slate-600 dark:text-slate-200">
                              {entryMcqScore}
                            </td>
                          )}
                          {showLeaderboardBreakdown && leaderboardHasDsa && (
                            <td className="px-5 py-4 text-right font-mono text-base font-semibold text-slate-600 dark:text-slate-200">
                              {entryCodingScore}
                            </td>
                          )}
                          <td className="px-5 py-4 text-right font-mono text-base font-semibold text-slate-500 dark:text-slate-300">
                            {formatDuration(currentUserRow.timeSeconds)}
                          </td>
                        </tr>
                      );
                    })()}
                    {visibleLeaderboardEntries.map((entry, index) => {
                      const displayName = entry.participant || entry.displayName || entry.username || entry.hacker;
                      const entryTotalScore = Number(entry.totalScore ?? entry.score ?? 0);
                      const entryMcqScore = Number(entry.mcqScore ?? entry.scoreBreakdown?.mcqScore ?? 0);
                      const entryCodingScore = Number(entry.codingScore ?? entry.scoreBreakdown?.codingScore ?? 0);
                      return (
                        <tr
                          key={`${entry.rank}-${entry.userId || displayName}-${index}`}
                          className="border-b border-slate-100 transition hover:bg-slate-50 last:border-0 dark:border-white/10 dark:hover:bg-white/[0.04]"
                        >
                          <td className="px-5 py-4">
                            <span className="font-extrabold text-slate-950 dark:text-white">
                              {displayName}
                            </span>
                          </td>
                          <td className="px-5 py-4 text-center">
                            <span className="font-mono text-base font-black text-slate-950 dark:text-white">
                              {String(entry.rank).padStart(2, '0')}
                            </span>
                          </td>
                          <td className="px-5 py-4 text-right font-mono text-base font-extrabold">{entryTotalScore}</td>
                          {showLeaderboardBreakdown && (
                            <td className="px-5 py-4 text-right font-mono text-base font-semibold text-slate-600 dark:text-slate-200">
                              {entryMcqScore}
                            </td>
                          )}
                          {showLeaderboardBreakdown && leaderboardHasDsa && (
                            <td className="px-5 py-4 text-right font-mono text-base font-semibold text-slate-600 dark:text-slate-200">
                              {entryCodingScore}
                            </td>
                          )}
                          <td className="px-5 py-4 text-right font-mono text-base font-semibold text-slate-500 dark:text-slate-300">
                            {formatDuration(entry.timeSeconds)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="flex flex-col gap-3 border-t border-slate-200 bg-slate-50/60 px-5 py-4 dark:border-white/10 dark:bg-white/[0.03] sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm font-bold text-slate-500 dark:text-slate-400">
                  Showing ranks {safeLeaderboardPage * LEADERBOARD_PAGE_SIZE + 1}-{Math.min((safeLeaderboardPage + 1) * LEADERBOARD_PAGE_SIZE, leaderboardState.entries.length)} of {leaderboardState.entries.length}
                </p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setLeaderboardPage((page) => Math.max(0, page - 1))}
                    disabled={safeLeaderboardPage === 0}
                    className="h-10 rounded-xl border border-slate-200 bg-white px-5 text-sm font-extrabold text-slate-700 shadow-sm transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/10 dark:bg-white/10 dark:text-slate-100 dark:hover:bg-white/15"
                  >
                    Back
                  </button>
                  <button
                    type="button"
                    onClick={() => setLeaderboardPage((page) => Math.min(totalLeaderboardPages - 1, page + 1))}
                    disabled={safeLeaderboardPage >= totalLeaderboardPages - 1}
                    className="h-10 rounded-xl bg-primary px-5 text-sm font-extrabold text-white shadow-sm transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Next
                  </button>
                </div>
              </div>
            </div>
          )}
        </section>
      </main>

      {showReviewLocked && (
        <div className="fixed inset-0 z-[140] grid place-items-center bg-slate-950/45 p-4 dark:bg-black/65">
          <button
            type="button"
            aria-label="Close popup"
            className="absolute inset-0 cursor-default"
            onClick={() => setShowReviewLocked(false)}
          />
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="review-locked-title"
            aria-describedby="review-locked-message"
            className="relative w-full max-w-sm rounded-lg border border-slate-200 bg-white p-5 shadow-xl dark:border-lc-border dark:bg-lc-surface"
          >
            <div className="flex items-start gap-3">
              <div className="mt-0.5 grid size-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
                <Lock className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <h2 id="review-locked-title" className="font-nunito text-lg font-extrabold text-slate-950 dark:text-white">
                  Review locks until the contest ends
                </h2>
                <p id="review-locked-message" className="mt-2 text-sm font-semibold leading-6 text-slate-600 dark:text-slate-300">
                  You&apos;ve submitted your attempt. Questions, answers, and solutions stay hidden while the contest is still live. You can review the full breakdown here once it ends.
                </p>
              </div>
            </div>
            <div className="mt-5 flex justify-end">
              <button
                type="button"
                onClick={() => setShowReviewLocked(false)}
                className="h-10 rounded-md bg-primary px-5 text-sm font-extrabold text-white shadow-sm transition hover:bg-primary/90"
              >
                Got it
              </button>
            </div>
          </section>
        </div>
      )}

      {feedbackRequired && (
        <div className="fixed inset-0 z-[1000] flex items-center justify-center overflow-y-auto bg-slate-100 px-4 py-4 text-slate-950 dark:bg-[#111111] dark:text-white sm:py-6">
          <div className="my-auto w-full max-w-[520px] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-white/10 dark:bg-[#242424]">
            <div className="border-b border-slate-200 px-5 py-4 dark:border-white/10">
              <div className="flex items-start gap-4">
                <div className="mt-1 grid size-10 shrink-0 place-items-center rounded-xl bg-[#00b8a3]/15 text-[#00b8a3]">
                  <CheckCircle2 className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <p className="text-[11px] font-extrabold uppercase tracking-[0.18em] text-slate-400 dark:text-neutral-400">Contest feedback</p>
                  <h2 className="mt-1.5 font-nunito text-xl font-extrabold leading-tight text-slate-950 dark:text-white sm:text-2xl">
                    How was {contestTitle || 'this contest'}?
                  </h2>
                  <p className="mt-1.5 text-sm font-semibold leading-5 text-slate-500 dark:text-neutral-300">
                    Please rate your experience before leaving fullscreen. Your response helps us improve the next contest.
                  </p>
                </div>
              </div>
            </div>

            <div className="max-h-[calc(100vh-210px)] space-y-4 overflow-y-auto px-5 py-4">
              <div>
                <p className="mb-2.5 text-sm font-extrabold text-slate-700 dark:text-neutral-200">Your rating</p>
                <div className="flex items-center gap-2" onMouseLeave={() => setFeedbackHoverRating(0)}>
                  {[1, 2, 3, 4, 5].map((value) => {
                    const active = (feedbackHoverRating || feedbackRating) >= value;
                    return (
                      <button
                        key={value}
                        type="button"
                        onClick={() => {
                          setFeedbackRating(value);
                          setFeedbackError(null);
                        }}
                        onMouseEnter={() => setFeedbackHoverRating(value)}
                        className={`grid size-10 place-items-center rounded-xl border transition ${
                          active
                            ? 'border-amber-300 bg-amber-50 text-amber-500 dark:bg-amber-300/15 dark:text-amber-300'
                            : 'border-slate-200 bg-slate-50 text-slate-400 hover:border-amber-300/60 hover:text-amber-400 dark:border-white/10 dark:bg-white/[0.04] dark:text-neutral-500 dark:hover:border-amber-300/60 dark:hover:text-amber-300'
                        }`}
                        aria-label={`Rate ${value} out of 5`}
                      >
                        <Star className="h-5 w-5" fill={active ? 'currentColor' : 'none'} />
                      </button>
                    );
                  })}
                </div>
              </div>

              <label className="block">
                <span className="mb-3 flex items-center gap-2 text-sm font-extrabold text-slate-700 dark:text-neutral-200">
                  <MessageSquare className="h-4 w-4 text-slate-400 dark:text-neutral-400" />
                  Feedback note <span className="text-xs font-bold text-slate-400 dark:text-neutral-500">(optional)</span>
                </span>
                <textarea
                  value={feedbackComment}
                  onChange={(event) => setFeedbackComment(event.target.value)}
                  maxLength={600}
                  rows={3}
                  placeholder="We would love to hear what felt smooth, what was confusing, or what you want improved next time."
                  className="w-full resize-none rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold leading-6 text-slate-950 outline-none transition placeholder:text-slate-400 focus:border-[#00b8a3] focus:bg-white dark:border-white/10 dark:bg-white/[0.04] dark:text-white dark:placeholder:text-neutral-500 dark:focus:bg-white/[0.07]"
                />
                <span className="mt-1.5 block text-right text-xs font-bold text-slate-400 dark:text-neutral-500">{feedbackComment.length}/600</span>
              </label>

              {feedbackError && (
                <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700 dark:border-rose-400/30 dark:bg-rose-500/10 dark:text-rose-200">
                  {feedbackError}
                </div>
              )}

              <button
                type="button"
                onClick={submitFeedback}
                disabled={feedbackSaving}
                className="w-full rounded-xl bg-[#00b8a3] px-5 py-2.5 text-sm font-extrabold text-white shadow-lg shadow-[#00b8a3]/20 transition hover:bg-[#009f8f] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {feedbackSaving ? 'Saving feedback...' : 'Submit feedback'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
