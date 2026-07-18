"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft,
  BookOpen,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  Code2,
  Grid2X2,
  Lightbulb,
  Lock,
  X,
  XCircle,
} from "lucide-react";
import { Group, Panel, Separator } from "react-resizable-panels";
import { RichQuestionContent } from "@/components/question-content/rich-question-content";
import { contestServiceFetch } from "@/lib/contest-service-fetch";

type McqOption = {
  id: string;
  text: string;
  order?: number;
};

type McqReviewQuestion = {
  id: string;
  title: string;
  questionText: string;
  difficulty?: string;
  points: number;
  options?: McqOption[];
  selectedOptionId?: string | null;
  selectedOptionText?: string | null;
  correctOptionId: string;
  correctOptionText?: string | null;
  isCorrect: boolean;
  pointsAwarded: number;
  explanation?: string;
};

type ContestDetails = {
  title?: string;
  instructions?: string | null;
  startTime?: string | null;
  endTime?: string | null;
  roundFlow?: "dsa_only" | "mcq_only" | "mcq_then_dsa";
};

type DrawerType = "sections" | "questions" | "guidelines" | null;

function formatDateTime(value?: string | null) {
  if (!value) return "Not available";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Not available";
  return date.toLocaleString("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function optionLabel(index: number) {
  return String.fromCharCode(65 + index);
}

function uniqueOptions(question: McqReviewQuestion | null): McqOption[] {
  if (!question) return [];
  const map = new Map<string, McqOption>();
  for (const option of question.options || []) {
    if (!option?.id || !option.text) continue;
    map.set(option.id, option);
  }
  if (question.selectedOptionId && question.selectedOptionText && !map.has(question.selectedOptionId)) {
    map.set(question.selectedOptionId, {
      id: question.selectedOptionId,
      text: question.selectedOptionText,
      order: map.size,
    });
  }
  if (question.correctOptionId && question.correctOptionText && !map.has(question.correctOptionId)) {
    map.set(question.correctOptionId, {
      id: question.correctOptionId,
      text: question.correctOptionText,
      order: map.size,
    });
  }
  return Array.from(map.values()).sort((a, b) => Number(a.order ?? 0) - Number(b.order ?? 0));
}

function difficultyLabel(value?: string) {
  const normalized = String(value || "").toUpperCase();
  if (normalized === "EASY") return "Easy";
  if (normalized === "HARD") return "Hard";
  return "Medium";
}

function difficultyClass(value?: string) {
  const normalized = String(value || "").toUpperCase();
  if (normalized === "EASY") return "bg-emerald-50 text-emerald-700 dark:bg-emerald-400/10 dark:text-emerald-300";
  if (normalized === "HARD") return "bg-red-50 text-red-700 dark:bg-red-400/10 dark:text-red-300";
  return "bg-amber-50 text-amber-700 dark:bg-amber-400/10 dark:text-amber-300";
}

function reviewQuestionState(question: McqReviewQuestion) {
  if (question.isCorrect) return "correct";
  if (question.selectedOptionId) return "wrong";
  return "unanswered";
}

function reviewQuestionButtonClass(question: McqReviewQuestion, active: boolean) {
  const activeClass = active
    ? "ring-2 ring-[#1573e6] ring-offset-2 ring-offset-white dark:ring-offset-[#282828]"
    : "";
  const state = reviewQuestionState(question);
  if (state === "correct") return `${activeClass} bg-[#08c468] text-white hover:bg-[#06b760]`;
  if (state === "wrong") return `${activeClass} bg-[#ef4444] text-white hover:bg-[#dc2626]`;
  return `${activeClass} bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-[#333333] dark:text-slate-200 dark:hover:bg-[#3a3a3a]`;
}

export default function ContestMcqPracticeQuestionPage() {
  const router = useRouter();
  const params = useParams();
  const contestId = String(params.id || "");
  const questionId = String(params.questionId || "");
  const [contestTitle, setContestTitle] = useState("MCQ Review");
  const [contestDetails, setContestDetails] = useState<ContestDetails | null>(null);
  const [questions, setQuestions] = useState<McqReviewQuestion[]>([]);
  const [question, setQuestion] = useState<McqReviewQuestion | null>(null);
  const [selectedOptionId, setSelectedOptionId] = useState("");
  const [checked, setChecked] = useState(false);
  const [activeTab, setActiveTab] = useState<"answer" | "solution">("answer");
  const [activeDrawer, setActiveDrawer] = useState<DrawerType>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [contestResponse, reviewResponse] = await Promise.all([
        contestServiceFetch(`/contests/${contestId}`),
        contestServiceFetch(`/contests/${contestId}/mcq/review`),
      ]);

      if (!contestResponse || !reviewResponse) {
        router.push("/login");
        return;
      }

      const contestData = await contestResponse.json().catch(() => ({}));
      const reviewData = await reviewResponse.json().catch(() => ({}));
      if (contestResponse.status === 401 || reviewResponse.status === 401) {
        router.push("/login");
        return;
      }
      if (contestResponse.ok) {
        setContestTitle(contestData.contest?.title || "MCQ Review");
        setContestDetails(contestData.contest || null);
      }
      if (!reviewResponse.ok || reviewData.available === false) {
        throw new Error(reviewData.message || "MCQ review is available after the contest ends.");
      }
      const nextQuestions = Array.isArray(reviewData.questions) ? reviewData.questions : [];
      const nextQuestion = nextQuestions.find((item: McqReviewQuestion) => item.id === questionId) || null;
      if (!nextQuestion) throw new Error("MCQ question not found in this review.");
      setQuestions(nextQuestions);
      setQuestion(nextQuestion);
      setSelectedOptionId(nextQuestion.selectedOptionId || "");
      setChecked(Boolean(nextQuestion.selectedOptionId));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load MCQ review");
    } finally {
      setLoading(false);
    }
  }, [contestId, questionId, router]);

  useEffect(() => {
    void load();
  }, [load]);

  const options = useMemo(() => uniqueOptions(question), [question]);
  const activeIndex = questions.findIndex((item) => item.id === questionId);
  const questionNumber = activeIndex >= 0 ? activeIndex + 1 : 1;
  const selectedIsCorrect = Boolean(selectedOptionId && question && selectedOptionId === question.correctOptionId);
  const answeredCount = questions.filter((item) => Boolean(item.selectedOptionId)).length;
  const correctCount = questions.filter((item) => item.isCorrect).length;
  const wrongCount = questions.filter((item) => Boolean(item.selectedOptionId) && !item.isCorrect).length;
  const notAttemptedCount = Math.max(0, questions.length - answeredCount);
  const attemptedPercent = questions.length > 0 ? Math.round((answeredCount / questions.length) * 100) : 0;
  const clearSelectionDisabled = !selectedOptionId;
  const guidelineText = String(contestDetails?.instructions || "").trim()
    || "Review mode is available after the contest ends.\nNo fullscreen, proctoring, warning tracking, or contest submissions are active here.\nUse the answer tab to try an option locally, and the solution tab to review the official answer and explanation.";
  const contestBackPath = contestDetails?.roundFlow === "mcq_only" ? "/contests" : `/contests/${contestId}`;

  const goToQuestion = (index: number) => {
    const target = questions[index];
    if (!target || target.id === questionId) return;
    router.push(`/contests/${contestId}/mcq/practice/${target.id}`);
  };

  const closeDrawerAndGoToQuestion = (index: number) => {
    setActiveDrawer(null);
    goToQuestion(index);
  };

  const clearSelectedOption = () => {
    if (clearSelectionDisabled) return;
    setSelectedOptionId("");
    setChecked(false);
  };

  if (loading) {
    return (
      <div className="grid min-h-screen place-items-center bg-white text-slate-700 dark:bg-lc-bg dark:text-slate-300">
        <div className="text-center">
          <Clock className="mx-auto h-8 w-8 animate-pulse text-[#1573e6]" />
          <p className="mt-3 text-sm font-semibold">Loading MCQ review...</p>
        </div>
      </div>
    );
  }

  if (error || !question) {
    return (
      <main className="grid min-h-screen place-items-center bg-white p-6 text-slate-950 dark:bg-lc-bg dark:text-white">
        <div className="max-w-md rounded-xl border border-rose-200 bg-rose-50 p-6 text-center text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-100">
          <XCircle className="mx-auto h-8 w-8" />
          <h1 className="mt-3 font-nunito text-xl font-extrabold">Unable to open review</h1>
          <p className="mt-2 text-sm font-semibold">{error || "Question not found."}</p>
          <button
            type="button"
            onClick={() => router.push(contestBackPath)}
            className="mt-5 rounded-lg bg-[#1573e6] px-5 py-2.5 text-sm font-extrabold text-white"
          >
            {contestDetails?.roundFlow === "mcq_only" ? "Back to contests" : "Back to contest"}
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="contest-mcq-ide min-h-screen overflow-hidden bg-white text-[#111827] dark:bg-lc-bg dark:text-white">
      <div className="flex h-[52px] items-center border-b border-[#dde3ea] bg-white px-7 dark:border-[#3e3e3e] dark:bg-[#282828]">
        <div className="flex w-[260px] items-center gap-4">
          <button
            type="button"
            onClick={() => router.push(`/contests/${contestId}/mcq/practice`)}
            className="grid h-8 w-8 shrink-0 place-items-center text-[#3f526d] transition hover:text-[#111827] dark:text-slate-300 dark:hover:text-white"
            aria-label="Back to MCQ review"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div>
            <p className="text-xs font-black uppercase tracking-[0.16em] text-[#1573e6]">Practice mode</p>
            <p className="truncate text-sm font-extrabold text-[#26364f] dark:text-slate-100">{contestTitle}</p>
          </div>
        </div>

        <div className="flex min-w-0 flex-1 items-center justify-center gap-3">
          <button
            type="button"
            onClick={() => setActiveDrawer("sections")}
            className="flex h-8 w-32 items-center justify-between rounded-lg border border-[#dfe5ec] bg-white px-3 text-left text-[13px] font-semibold text-[#26364f] shadow-sm transition hover:bg-[#f8fafc] dark:border-[#3e3e3e] dark:bg-[#333333] dark:text-slate-100 dark:hover:bg-[#3a3a3a]"
          >
            Section
            <ChevronDown className="h-4 w-4 text-[#c4ccd7]" />
          </button>
          <button
            type="button"
            onClick={() => goToQuestion(activeIndex - 1)}
            disabled={activeIndex <= 0}
            className="grid h-8 w-8 place-items-center rounded-md border border-[#dfe5ec] bg-white text-[#3f526d] shadow-sm transition hover:bg-[#f8fafc] disabled:cursor-not-allowed disabled:text-[#cbd5e1] dark:border-[#3e3e3e] dark:bg-[#333333] dark:text-slate-200 dark:hover:bg-[#3a3a3a] dark:disabled:text-slate-600"
            aria-label="Previous question"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <div className="flex items-center gap-1.5">
            {questions.slice(0, 10).map((item, index) => {
              const active = item.id === questionId;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => goToQuestion(index)}
                  className={`grid h-8 min-w-8 place-items-center rounded-md px-3 text-[13px] font-extrabold shadow-sm transition ${reviewQuestionButtonClass(item, active)}`}
                >
                  {index + 1}
                </button>
              );
            })}
          </div>
          <button
            type="button"
            onClick={() => goToQuestion(activeIndex + 1)}
            disabled={activeIndex < 0 || activeIndex >= questions.length - 1}
            className="grid h-8 w-8 place-items-center rounded-md border border-[#dfe5ec] bg-white text-[#3f526d] shadow-sm transition hover:bg-[#f8fafc] disabled:cursor-not-allowed disabled:text-[#cbd5e1] dark:border-[#3e3e3e] dark:bg-[#333333] dark:text-slate-200 dark:hover:bg-[#3a3a3a] dark:disabled:text-slate-600"
            aria-label="Next question"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => setActiveDrawer("questions")}
            className="flex h-8 items-center gap-2 rounded-md border border-[#dfe5ec] bg-white px-2.5 text-[13px] font-semibold text-[#26364f] shadow-sm transition hover:bg-[#f8fafc] dark:border-[#3e3e3e] dark:bg-[#333333] dark:text-slate-100 dark:hover:bg-[#3a3a3a]"
          >
            {questions.length}
            <Grid2X2 className="h-4 w-4 text-[#4b6280]" />
          </button>
        </div>

        <div className="flex w-[260px] items-center justify-end">
          <button
            type="button"
            onClick={() => setActiveDrawer("guidelines")}
            className="inline-flex h-8 items-center gap-2 rounded-md border border-[#dfe5ec] bg-white px-4 text-[13px] font-semibold text-[#26364f] shadow-sm transition hover:bg-[#f8fafc] dark:border-[#3e3e3e] dark:bg-[#333333] dark:text-slate-100 dark:hover:bg-[#3a3a3a]"
          >
            <Lightbulb className="h-4 w-4 fill-yellow-300 text-yellow-500" />
            Guidelines
          </button>
        </div>
      </div>

      <div className="flex h-9 items-center justify-center border-b border-[#d4e9ff] bg-[#e6f4ff] text-[13px] font-bold text-[#0873df] dark:border-[#23384f] dark:bg-[#13293d] dark:text-[#7bb8ff]">
        Contest review mode. No proctoring, fullscreen, or warning tracking is active.
      </div>

      <div className="relative h-[calc(100vh-157px)] overflow-hidden bg-white dark:bg-lc-bg">
        <Group orientation="horizontal" className="h-full">
          <Panel defaultSize={50} minSize={32} className="min-w-0">
            <div className="h-full overflow-y-auto px-12 py-12">
              <div className="mb-8 grid grid-cols-[minmax(0,1fr)_220px] items-start gap-8">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-[18px] font-extrabold leading-none text-black dark:text-white">Question {questionNumber}.</p>
                    <span className={`rounded-full px-2.5 py-1 text-[11px] font-extrabold ${difficultyClass(question.difficulty)}`}>
                      {difficultyLabel(question.difficulty)}
                    </span>
                  </div>
                  <div className="mt-6 text-[16px] leading-7 text-slate-800 dark:text-slate-100">
                    <RichQuestionContent content={question.questionText || question.title || ""} />
                  </div>
                </div>
                <div className="justify-self-end whitespace-nowrap rounded-full bg-white px-4 py-2 shadow-[0_8px_24px_rgba(15,23,42,0.08)] ring-1 ring-[#dfe5ec] dark:bg-[#282828] dark:ring-[#3e3e3e]">
                  <span className="text-[12px] font-extrabold uppercase tracking-[0.08em] text-[#7890ad]">Total Marks:</span>
                  <span className="ml-2 text-[18px] font-extrabold leading-none text-black dark:text-white">{question.points}</span>
                </div>
              </div>
            </div>
          </Panel>

          <Separator className="relative z-20 flex w-1 cursor-col-resize items-center justify-center bg-[#dfe5ec] transition-colors hover:bg-[#2bb8a6] dark:bg-[#3e3e3e]">
            <div className="h-8 w-0.5 rounded-full bg-[#b9c3cf]" />
          </Separator>

          <Panel defaultSize={50} minSize={32} className="min-w-0">
            <div className="flex h-full flex-col">
              <div className="border-b border-[#e3e7ed] px-10 py-8 dark:border-[#3e3e3e] dark:bg-[#282828]">
                <p className="text-xs font-black uppercase tracking-[0.18em] text-[#7890ad]">Workspace</p>
                <h2 className="mt-2 text-[20px] font-extrabold leading-none text-black dark:text-white">Answer review</h2>
                <div className="mt-7 grid grid-cols-2 rounded-xl bg-[#edf2f7] p-1 dark:bg-[#1a1a1a]">
                  <button
                    type="button"
                    onClick={() => setActiveTab("answer")}
                    className={`h-10 rounded-lg text-sm font-extrabold transition ${
                      activeTab === "answer" ? "bg-white text-black shadow-sm dark:bg-[#333333] dark:text-white" : "text-[#64748b] dark:text-slate-400"
                    }`}
                  >
                    Answer
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveTab("solution")}
                    className={`h-10 rounded-lg text-sm font-extrabold transition ${
                      activeTab === "solution" ? "bg-white text-black shadow-sm dark:bg-[#333333] dark:text-white" : "text-[#64748b] dark:text-slate-400"
                    }`}
                  >
                    Solution
                  </button>
                </div>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto px-10 py-9 dark:bg-[#282828]">
                {activeTab === "answer" ? (
                  <div className="space-y-4">
                    {options.map((option, index) => {
                      const selected = selectedOptionId === option.id;
                      const correct = question.correctOptionId === option.id;
                      const showResult = checked;
                      return (
                        <button
                          key={option.id}
                          type="button"
                          onClick={() => {
                            setSelectedOptionId((current) => (current === option.id ? "" : option.id));
                            setChecked(false);
                          }}
                          className={`flex min-h-[62px] w-full items-start gap-4 rounded-md border bg-white px-4 py-3.5 text-left transition dark:bg-[#1a1a1a] ${
                            showResult && correct
                              ? "border-emerald-400 bg-emerald-50 dark:bg-emerald-400/10"
                              : showResult && selected && !correct
                                ? "border-rose-300 bg-rose-50 dark:bg-rose-400/10"
                                : selected
                                  ? "border-[#1573e6] bg-[#f8fbff] shadow-[0_0_0_2px_rgba(21,115,230,0.08)] dark:bg-[#16243a]"
                                  : "border-[#e2e5ea] hover:border-[#b8c4d2] hover:bg-[#fbfcfe] dark:border-[#3e3e3e] dark:hover:border-[#64748b] dark:hover:bg-[#202020]"
                          }`}
                        >
                          <span className={`mt-1 grid h-6 w-6 shrink-0 place-items-center rounded-full border text-xs font-extrabold ${
                            showResult && correct
                              ? "border-emerald-500 bg-emerald-500 text-white"
                              : showResult && selected && !correct
                                ? "border-rose-500 bg-rose-500 text-white"
                                : selected
                                  ? "border-[#1573e6] text-[#1573e6]"
                                  : "border-[#9aa8b8] text-[#52667f]"
                          }`}>
                            {showResult && correct ? <CheckCircle2 className="h-4 w-4" /> : showResult && selected && !correct ? <XCircle className="h-4 w-4" /> : optionLabel(index)}
                          </span>
                          <span className="min-w-0 flex-1 text-[14px] font-semibold leading-6 text-slate-800 dark:text-slate-100 [&_p]:!m-0">
                            <RichQuestionContent content={option.text} compact />
                          </span>
                        </button>
                      );
                    })}

                    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[#dfe5ec] bg-[#f8fafc] px-4 py-4 dark:border-[#3e3e3e] dark:bg-[#202020]">
                      <div>
                        <p className="text-sm font-extrabold text-[#111827] dark:text-white">
                          {checked
                            ? selectedIsCorrect
                              ? "Correct answer"
                              : "Incorrect answer"
                            : "Choose an option to practice"}
                        </p>
                        <p className="mt-1 text-xs font-semibold text-[#64748b] dark:text-slate-400">
                          Your contest score for this MCQ was {question.pointsAwarded} / {question.points}.
                        </p>
                      </div>
                      <div className="flex items-center gap-3">
                        <button
                          type="button"
                          onClick={clearSelectedOption}
                          disabled={clearSelectionDisabled}
                          className="h-10 rounded-lg bg-[#e5e7eb] px-5 text-sm font-extrabold text-[#344054] shadow-sm transition hover:bg-[#d9dde3] disabled:cursor-not-allowed disabled:bg-[#eef0f3] disabled:text-slate-400 dark:bg-[#3a3a3a] dark:text-slate-100 dark:hover:bg-[#444444] dark:disabled:bg-[#333333] dark:disabled:text-slate-500"
                        >
                          Clear
                        </button>
                        <button
                          type="button"
                          onClick={() => setChecked(true)}
                          disabled={!selectedOptionId}
                          className="h-10 rounded-lg bg-[#1573e6] px-5 text-sm font-extrabold text-white shadow-sm transition hover:bg-[#0f66d4] disabled:cursor-not-allowed disabled:bg-[#dbe3ee] disabled:text-[#7b8ba3] dark:disabled:bg-[#333333] dark:disabled:text-slate-500"
                        >
                          Check Answer
                        </button>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-5">
                    <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-5 dark:border-emerald-400/30 dark:bg-emerald-400/10">
                      <p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-700">Correct answer</p>
                      <p className="mt-3 text-base font-extrabold text-emerald-950 dark:text-emerald-100">
                        {question.correctOptionText || options.find((option) => option.id === question.correctOptionId)?.text || question.correctOptionId}
                      </p>
                    </div>
                    <div className="rounded-xl border border-[#dfe5ec] bg-white p-5 dark:border-[#3e3e3e] dark:bg-[#1a1a1a]">
                      <p className="text-xs font-black uppercase tracking-[0.18em] text-[#7890ad]">Solution explanation</p>
                      <div className="mt-3 text-sm leading-7 text-slate-700 dark:text-slate-200">
                        <RichQuestionContent content={question.explanation || "No explanation was added for this MCQ."} />
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </Panel>
        </Group>
      </div>

      <div className="flex h-16 items-center justify-end gap-3 border-t border-[#e3e7ed] bg-white px-7 dark:border-[#3e3e3e] dark:bg-[#282828]">
        <button
          type="button"
          onClick={() => router.push(`/contests/${contestId}/mcq/practice`)}
          className="inline-flex h-10 items-center rounded-lg border border-[#dfe5ec] bg-white px-5 text-sm font-extrabold text-[#26364f] shadow-sm transition hover:bg-[#f8fafc] dark:border-[#3e3e3e] dark:bg-[#333333] dark:text-slate-100 dark:hover:bg-[#3a3a3a]"
        >
          Back to MCQ Review
        </button>
        <button
          type="button"
          onClick={() => goToQuestion(activeIndex + 1)}
          disabled={activeIndex < 0 || activeIndex >= questions.length - 1}
          className="inline-flex h-10 items-center gap-2 rounded-lg bg-[#1573e6] px-6 text-sm font-extrabold text-white shadow-sm transition hover:bg-[#0f66d4] disabled:cursor-not-allowed disabled:bg-[#dbe3ee] disabled:text-[#7b8ba3]"
        >
          Next
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      {activeDrawer && (
        <div className="fixed inset-0 z-[9000] flex">
          <button
            type="button"
            aria-label="Close panel"
            onClick={() => setActiveDrawer(null)}
            className="absolute inset-0 bg-black/65"
          />
          <div className="relative ml-auto flex h-full w-full max-w-[620px] flex-col bg-white text-[#222] shadow-2xl dark:bg-[#242424] dark:text-white">
            <div className="flex h-[78px] shrink-0 items-center justify-between border-b border-[#e2e5e9] px-6 dark:border-[#3e3e3e]">
              <div>
                <h2 className="text-[20px] font-semibold tracking-tight">
                  {activeDrawer === "sections" ? "Sections" : activeDrawer === "questions" ? "Question Summary" : "Guidelines"}
                </h2>
                {activeDrawer === "questions" && (
                  <p className="mt-1 text-xs font-semibold text-[#6b7280] dark:text-slate-400">
                    {answeredCount} answered, {notAttemptedCount} unanswered
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={() => setActiveDrawer(null)}
                className="grid h-9 w-9 place-items-center rounded-full text-[#333] transition hover:bg-[#f2f4f7] dark:text-slate-200 dark:hover:bg-white/10"
                aria-label="Close panel"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6">
              {activeDrawer === "sections" && (
                <div className="space-y-4">
                  <button
                    type="button"
                    onClick={() => setActiveDrawer(null)}
                    className="flex w-full items-center gap-4 rounded-xl border border-[#d9e4f5] bg-[#f5f9ff] p-4 text-left shadow-sm dark:border-[#315b90] dark:bg-[#172337]"
                  >
                    <span className="grid h-11 w-11 place-items-center rounded-full bg-[#1573e6] text-white">
                      <BookOpen className="h-5 w-5" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-base font-extrabold text-[#111827] dark:text-white">MCQ Review</span>
                      <span className="mt-1 block text-sm font-semibold text-[#64748b] dark:text-slate-400">
                        {answeredCount}/{questions.length} answered
                      </span>
                    </span>
                    <span className="rounded-full bg-[#dff7eb] px-3 py-1 text-xs font-extrabold text-[#0f8a4b] dark:bg-emerald-400/10 dark:text-emerald-300">Active</span>
                  </button>

                  <div className="flex w-full items-center gap-4 rounded-xl border border-[#e5e7eb] bg-[#f7f7f8] p-4 text-left opacity-80 dark:border-[#3e3e3e] dark:bg-[#1a1a1a]">
                    <span className="grid h-11 w-11 place-items-center rounded-full bg-[#e5e7eb] text-[#6b7280] dark:bg-[#333333] dark:text-slate-300">
                      <Code2 className="h-5 w-5" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-base font-extrabold text-[#111827] dark:text-white">DSA Coding Review</span>
                      <span className="mt-1 block text-sm font-semibold text-[#64748b] dark:text-slate-400">Open coding review from contest overview.</span>
                    </span>
                    <span className="inline-flex items-center gap-1 rounded-full bg-white px-3 py-1 text-xs font-extrabold text-[#64748b] dark:bg-[#333333] dark:text-slate-300">
                      <Lock className="h-3 w-3" />
                      Separate
                    </span>
                  </div>
                </div>
              )}

              {activeDrawer === "questions" && (
                <div className="space-y-6">
                  <div className="rounded-lg bg-[#f4f4f4] p-3 dark:bg-[#1a1a1a]">
                    <div className="flex items-center gap-8 bg-white p-5 dark:bg-[#242424]">
                      <div
                        className="grid h-36 w-36 shrink-0 place-items-center rounded-full"
                        style={{ background: `conic-gradient(#08c468 ${attemptedPercent}%, #eeeeee 0)` }}
                      >
                        <div className="grid h-28 w-28 place-items-center rounded-full bg-white text-center dark:bg-[#242424]">
                          <div>
                            <p className="text-2xl font-bold text-[#333] dark:text-white">{questions.length}</p>
                            <p className="text-sm leading-5 text-[#4b5563] dark:text-slate-400">Total<br />Questions</p>
                          </div>
                        </div>
                      </div>
                      <div className="space-y-3 text-sm">
                        <p className="flex items-center gap-3 font-medium text-[#333] dark:text-slate-200">
                          <span className="h-4 w-4 rounded-sm bg-[#08c468]" />
                          Correct: {correctCount}
                        </p>
                        <p className="flex items-center gap-3 font-medium text-[#333] dark:text-slate-200">
                          <span className="h-4 w-4 rounded-sm bg-[#ef4444]" />
                          Wrong: {wrongCount}
                        </p>
                        <p className="flex items-center gap-3 font-medium text-[#333] dark:text-slate-200">
                          <span className="h-4 w-4 rounded-sm bg-slate-100 ring-1 ring-slate-300 dark:bg-[#333333] dark:ring-[#4b5563]" />
                          Unanswered: {notAttemptedCount}
                        </p>
                      </div>
                    </div>
                  </div>

                  <div>
                    <h3 className="mb-3 text-xl font-semibold text-[#333] dark:text-white">Section summary</h3>
                    <div className="rounded-lg border border-[#d8dde5] bg-white p-4 dark:border-[#3e3e3e] dark:bg-[#1a1a1a]">
                      <p className="mb-3 text-sm font-semibold text-[#333] dark:text-slate-200">MCQ</p>
                      <div className="flex flex-wrap gap-2">
                        {questions.map((item, index) => {
                          const active = item.id === questionId;
                          return (
                            <button
                              key={item.id}
                              type="button"
                              onClick={() => closeDrawerAndGoToQuestion(index)}
                              className={`grid h-9 min-w-9 place-items-center rounded px-3 text-sm font-extrabold transition ${reviewQuestionButtonClass(item, active)}`}
                            >
                              {index + 1}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {activeDrawer === "guidelines" && (
                <div className="space-y-4">
                  <div className="rounded-xl border border-[#cfd5de] bg-white dark:border-[#3e3e3e] dark:bg-[#1a1a1a]">
                    <div className="flex items-center justify-between px-5 py-4">
                      <h3 className="text-base font-semibold text-[#333] dark:text-white">Key Instructions</h3>
                      <ChevronDown className="h-4 w-4 rotate-180 text-[#333] dark:text-slate-300" />
                    </div>
                    <div className="px-5 pb-5 text-sm font-medium leading-6 text-[#4a4a4a] dark:text-slate-300">
                      <div className="whitespace-pre-wrap">{guidelineText}</div>
                    </div>
                  </div>

                  <div className="rounded-xl border border-[#cfd5de] bg-white dark:border-[#3e3e3e] dark:bg-[#1a1a1a]">
                    <div className="flex items-center justify-between px-5 py-4">
                      <h3 className="text-base font-semibold text-[#333] dark:text-white">Timelines & Questions</h3>
                      <ChevronDown className="h-4 w-4 rotate-180 text-[#333] dark:text-slate-300" />
                    </div>
                    <div className="px-5 pb-5 text-sm font-medium leading-6 text-[#4a4a4a] dark:text-slate-300">
                      <ul className="list-disc space-y-2 pl-5">
                        <li>Assessment Window: {formatDateTime(contestDetails?.startTime)} to {formatDateTime(contestDetails?.endTime)}</li>
                        <li>Total MCQs in review: {questions.length}</li>
                        <li>Practice choices are local to this review screen and do not change contest submissions.</li>
                      </ul>
                    </div>
                  </div>

                  <div className="rounded-xl border border-[#cfd5de] bg-white dark:border-[#3e3e3e] dark:bg-[#1a1a1a]">
                    <div className="flex items-center justify-between px-5 py-4">
                      <h3 className="text-base font-semibold text-[#333] dark:text-white">Marking</h3>
                      <ChevronDown className="h-4 w-4 rotate-180 text-[#333] dark:text-slate-300" />
                    </div>
                    <div className="px-5 pb-5 text-sm font-medium leading-6 text-[#4a4a4a] dark:text-slate-300">
                      <ul className="list-disc space-y-2 pl-5">
                        <li>This question was worth {question.points} marks.</li>
                        <li>Your recorded score for this MCQ was {question.pointsAwarded} / {question.points}.</li>
                        <li>Use the Solution tab to see the official answer and explanation.</li>
                      </ul>
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="flex h-[88px] shrink-0 items-center border-t border-[#e5e7eb] px-6 dark:border-[#3e3e3e]">
              <button
                type="button"
                onClick={() => setActiveDrawer(null)}
                className="rounded-md bg-[#e63d00] px-5 py-2.5 text-sm font-extrabold text-white transition hover:bg-[#cc3600]"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
