"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { CheckCircle2, Clock, RotateCcw, XCircle } from "lucide-react";
import { Group, Panel, Separator } from "react-resizable-panels";
import { useAuth } from "@/context/auth-context";
import { RichQuestionContent } from "@/components/question-content/rich-question-content";
import { useContestManagerCheck } from "@/hooks/use-contest-manager-check";

const contestApiUrl = process.env.NEXT_PUBLIC_CONTEST_API_URL || "http://localhost:3002";

type McqOption = {
  id: string;
  text: string;
  order: number;
};

type McqPreviewQuestion = {
  id: string;
  problemId?: string;
  frontendId?: string;
  title: string;
  difficulty?: string;
  questionText: string;
  statement?: string;
  topics?: string[];
  options: McqOption[];
  correctOptionId: string;
  explanation: string;
};

type PreviewPayload = {
  message?: string;
  question?: McqPreviewQuestion;
};

type PreviewTab = "answer" | "solution";

function NotAuthorized() {
  const router = useRouter();
  useEffect(() => {
    const timer = window.setTimeout(() => router.replace("/dashboard"), 2500);
    return () => window.clearTimeout(timer);
  }, [router]);

  return (
    <div className="flex min-h-[60vh] flex-1 flex-col items-center justify-center px-6 text-center">
      <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-rose-50 text-rose-500 dark:bg-rose-500/10">
        <span className="material-symbols-outlined text-4xl">lock</span>
      </div>
      <h1 className="text-xl font-bold text-slate-950 dark:text-white">Page not found</h1>
      <p className="mt-2 text-sm font-semibold text-slate-500">Redirecting you back to the dashboard...</p>
    </div>
  );
}

export default function ContestMcqPreviewPage() {
  const params = useParams();
  const router = useRouter();
  const { session } = useAuth();
  const { isContestManager, loading: managerLoading } = useContestManagerCheck();
  const token = session?.access_token;
  const questionId = String(params.questionId || "");

  const [question, setQuestion] = useState<McqPreviewQuestion | null>(null);
  const [activeTab, setActiveTab] = useState<PreviewTab>("answer");
  const [selectedOptionId, setSelectedOptionId] = useState("");
  const [submittedOptionId, setSubmittedOptionId] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadQuestion = useCallback(async () => {
    if (!token || !questionId) return;
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`${contestApiUrl}/admin/contest-questions/mcq/${encodeURIComponent(questionId)}`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      const data = await response.json().catch(() => ({})) as PreviewPayload;
      if (!response.ok) throw new Error(data.message || "Failed to load MCQ preview");
      setQuestion(data.question || null);
      setActiveTab("answer");
      setSelectedOptionId("");
      setSubmittedOptionId("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load MCQ preview");
      setQuestion(null);
    } finally {
      setLoading(false);
    }
  }, [questionId, token]);

  useEffect(() => {
    if (!isContestManager || !token) return;
    void loadQuestion();
  }, [isContestManager, loadQuestion, token]);

  const selectedOption = useMemo(
    () => question?.options.find((option) => option.id === selectedOptionId) || null,
    [question?.options, selectedOptionId]
  );
  const submittedOption = useMemo(
    () => question?.options.find((option) => option.id === submittedOptionId) || null,
    [question?.options, submittedOptionId]
  );
  const correctOption = useMemo(
    () => question?.options.find((option) => option.id === question.correctOptionId) || null,
    [question?.correctOptionId, question?.options]
  );
  const hasSubmitted = Boolean(submittedOptionId);
  const isCorrect = hasSubmitted && submittedOptionId === question?.correctOptionId;

  const submitPreviewAnswer = () => {
    if (!question) return;
    if (!selectedOptionId) {
      setError("Select an option before submitting the preview answer.");
      return;
    }
    setError(null);
    setSubmittedOptionId(selectedOptionId);
    setActiveTab("solution");
  };

  const resetPreview = () => {
    setSelectedOptionId("");
    setSubmittedOptionId("");
    setActiveTab("answer");
    setError(null);
  };

  if (managerLoading || loading) {
    return (
      <main className="grid min-h-screen place-items-center bg-[#f6f8fb] dark:bg-[#282828]">
        <Clock className="h-8 w-8 animate-pulse text-primary" />
      </main>
    );
  }

  if (!isContestManager) return <NotAuthorized />;

  return (
    <main className="min-h-screen bg-[#f6f8fb] text-slate-950 dark:bg-[#282828] dark:text-white">
      <header className="sticky top-0 z-20 bg-[#f6f8fb]/95 px-5 py-3 backdrop-blur dark:bg-[#282828]/95">
        <div className="flex min-h-16 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-4">
            <Link
              href="/admin/contest-questions"
              aria-label="Back to question bank"
              className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#eef3f8] text-slate-500 shadow-sm transition hover:bg-[#e7edf5] hover:text-primary dark:bg-[#333333] dark:text-slate-300 dark:hover:bg-[#3a3a3a]"
            >
              <span className="material-symbols-outlined text-[20px]">arrow_back</span>
            </Link>
            <div className="min-w-0">
              <p className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-400">MCQ Preview</p>
              <p className="mt-1 truncate text-sm font-extrabold text-slate-700 dark:text-slate-200">Question bank preview workspace</p>
            </div>
          </div>
          <Link
            href="/admin/contest-questions"
            className="hidden rounded-xl bg-[#eef3f8] px-4 py-2.5 text-sm font-extrabold text-slate-700 shadow-sm transition hover:bg-[#e7edf5] dark:bg-[#333333] dark:text-slate-200 dark:hover:bg-[#3a3a3a] sm:inline-flex"
          >
            Question bank
          </Link>
        </div>
      </header>

      {error && (
        <div className="mx-5 mt-4 rounded-xl bg-rose-50 px-4 py-3 text-sm font-bold text-rose-700 shadow-sm dark:bg-rose-500/10 dark:text-rose-200">
          {error}
        </div>
      )}

      {!question ? (
        <section className="grid min-h-[60vh] place-items-center px-6 text-center">
          <div>
            <h2 className="font-nunito text-2xl font-extrabold">MCQ not found</h2>
            <button
              type="button"
              onClick={() => router.push("/admin/contest-questions")}
              className="mt-4 rounded-xl bg-primary px-5 py-3 text-sm font-extrabold text-white"
            >
              Back to bank
            </button>
          </div>
        </section>
      ) : (
        <section className="h-[calc(100vh-86px)] overflow-hidden">
          <Group className="h-full" orientation="horizontal">
            <Panel defaultSize={52} minSize={25}>
          <article className="h-full min-w-0 overflow-y-auto bg-[#f3f6fa] p-6 dark:bg-[#363636] lg:p-10">
            <div className="mb-8 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-400">Question</p>
                  {question.frontendId || question.problemId ? (
                    <span className="rounded-full bg-[#eef3f8] px-2.5 py-0.5 text-[11px] font-black text-slate-600 dark:bg-[#333333] dark:text-slate-300">
                      #{question.frontendId || question.problemId}
                    </span>
                  ) : null}
                  <span className="rounded-full bg-amber-50 px-2.5 py-0.5 text-[11px] font-black text-amber-700 dark:bg-amber-500/10 dark:text-amber-300">
                    {question.difficulty || "Medium"}
                  </span>
                </div>
                <h2 className="mt-2 font-nunito text-2xl font-extrabold text-slate-950 dark:text-white">{question.title}</h2>
              </div>
              {question.topics?.length ? (
                <div className="flex max-w-xl flex-wrap gap-2 sm:justify-end">
                  {question.topics.slice(0, 5).map((topic) => (
                    <span key={topic} className="rounded-full bg-[#eef3f8] px-3 py-1 text-xs font-extrabold text-slate-500 dark:bg-[#333333] dark:text-slate-300">
                      {topic}
                    </span>
                  ))}
                </div>
              ) : null}
            </div>
            <div className="max-w-4xl text-[15px] font-semibold leading-8 text-slate-700 dark:text-slate-100">
              <RichQuestionContent content={question.questionText || question.statement || ""} />
            </div>
          </article>
            </Panel>

            <Separator className="group relative flex w-1.5 cursor-col-resize items-center justify-center bg-[#dfe7f0] transition-colors hover:bg-teal-500 dark:bg-[#303030] dark:hover:bg-teal-500">
              <div className="h-6 w-0.5 rounded-full bg-slate-400 transition-colors group-hover:bg-teal-100 dark:bg-slate-500 dark:group-hover:bg-teal-100" />
            </Separator>

            <Panel defaultSize={48} minSize={30}>
          <aside className="flex h-full min-w-0 flex-col bg-[#f3f6fa] dark:bg-[#363636]">
            <div className="bg-[#f3f6fa] px-6 py-5 dark:bg-[#363636]">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-400">Workspace</p>
                  <h2 className="mt-1 text-base font-extrabold text-slate-950 dark:text-white">Answer preview</h2>
                </div>
                <button
                  type="button"
                  onClick={resetPreview}
                  disabled={!selectedOptionId && !submittedOptionId}
                  className="inline-flex items-center gap-2 rounded-xl bg-[#eef3f8] px-3 py-2 text-xs font-extrabold text-slate-600 shadow-sm transition hover:bg-[#e7edf5] disabled:cursor-not-allowed disabled:opacity-40 dark:bg-[#2a2a2a] dark:text-slate-200 dark:hover:bg-[#404040]"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  Reset
                </button>
              </div>

              <div className="mt-5 grid grid-cols-2 rounded-xl bg-[#e1e8f1] p-1 dark:bg-[#2a2a2a]">
                {[
                  { label: "Answer", value: "answer" as const },
                  { label: "Solution", value: "solution" as const },
                ].map((tab) => (
                  <button
                    key={tab.value}
                    type="button"
                    onClick={() => setActiveTab(tab.value)}
                    className={`rounded-lg px-4 py-2.5 text-sm font-extrabold transition ${
                      activeTab === tab.value
                        ? "bg-[#f8fafc] text-slate-950 shadow-sm dark:bg-[#3a3a3a] dark:text-white"
                        : "text-slate-500 hover:text-slate-950 dark:text-slate-400 dark:hover:text-white"
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-6 lg:p-8">
              {activeTab === "answer" ? (
                <div className="space-y-4">
                  {question.options.map((option) => {
                    const selected = selectedOptionId === option.id;
                    const submittedSelected = submittedOptionId === option.id;
                    const correct = hasSubmitted && option.id === question.correctOptionId;
                    const wrongSelected = hasSubmitted && submittedSelected && !correct;
                    return (
                      <button
                        key={option.id}
                        type="button"
                        onClick={() => {
                          setSelectedOptionId(option.id);
                          setError(null);
                        }}
                        className={`flex w-full items-start gap-4 rounded-xl bg-[#f9fbfe] p-4 text-left shadow-[0_10px_24px_rgba(15,23,42,0.08)] transition dark:bg-[#282828] dark:shadow-none ${
                          correct
                            ? "bg-emerald-50 dark:bg-emerald-500/10"
                            : wrongSelected
                              ? "bg-rose-50 dark:bg-rose-500/10"
                              : selected
                                ? "bg-[#e8f1ff] shadow-[0_12px_28px_rgba(59,130,246,0.16)] dark:bg-[#333a4a]"
                                : "hover:bg-[#f3f7fc] dark:hover:bg-[#343434]"
                        }`}
                      >
                        <span className={`mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full text-[11px] font-black ${
                          correct
                            ? "bg-emerald-500 text-white"
                            : wrongSelected
                              ? "bg-rose-500 text-white"
                              : selected
                                ? "bg-primary text-white"
                                : "bg-[#e7edf5] text-slate-500 dark:bg-[#3a3a3a] dark:text-slate-300"
                        }`}>
                          {correct ? <CheckCircle2 className="h-4 w-4" /> : wrongSelected ? <XCircle className="h-4 w-4" /> : option.id}
                        </span>
                        <span className="min-w-0 flex-1 text-sm font-semibold leading-6 text-slate-700 dark:text-slate-100">
                          <RichQuestionContent content={option.text} compact />
                        </span>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="space-y-4">
                  {!hasSubmitted ? (
                    <div className="rounded-xl bg-[#f9fbfe] p-6 text-center shadow-[0_10px_24px_rgba(15,23,42,0.08)] dark:bg-[#282828] dark:shadow-none">
                      <p className="font-nunito text-xl font-extrabold text-slate-950 dark:text-white">Submit an answer to reveal the solution.</p>
                      <p className="mt-2 text-sm font-semibold leading-6 text-slate-500 dark:text-slate-400">
                        This keeps preview behavior close to the candidate flow while still letting coordinators verify the explanation.
                      </p>
                      <button
                        type="button"
                        onClick={() => setActiveTab("answer")}
                        className="mt-5 rounded-xl bg-primary px-5 py-3 text-sm font-extrabold text-white shadow-lg shadow-primary/20"
                      >
                        Go to answer
                      </button>
                    </div>
                  ) : (
                    <>
                      <div className={`rounded-xl p-5 shadow-sm ${
                        isCorrect
                          ? "bg-emerald-50 dark:bg-emerald-500/10"
                          : "bg-rose-50 dark:bg-rose-500/10"
                      }`}>
                        <div className="flex items-start gap-3">
                          {isCorrect ? (
                            <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600 dark:text-emerald-300" />
                          ) : (
                            <XCircle className="mt-0.5 h-5 w-5 shrink-0 text-rose-600 dark:text-rose-300" />
                          )}
                          <div>
                            <p className={`text-sm font-black ${isCorrect ? "text-emerald-700 dark:text-emerald-300" : "text-rose-700 dark:text-rose-300"}`}>
                              {isCorrect ? "Correct answer" : "Incorrect answer"}
                            </p>
                            <p className="mt-1 text-sm font-semibold leading-6 text-slate-700 dark:text-slate-200">
                              {isCorrect ? "The selected option matches the stored solution." : "The selected option does not match the stored solution."}
                            </p>
                          </div>
                        </div>
                      </div>

                      <div className="grid gap-4 md:grid-cols-2">
                        <div className="rounded-xl bg-[#f9fbfe] p-4 shadow-sm dark:bg-[#282828] dark:shadow-none">
                          <p className="text-xs font-black uppercase tracking-[0.16em] text-slate-400">Selected option</p>
                          <p className="mt-2 text-sm font-extrabold text-slate-950 dark:text-white">{submittedOption?.id || "-"}</p>
                          <div className="mt-2 text-sm font-semibold leading-6 text-slate-600 dark:text-slate-300">
                            {submittedOption ? <RichQuestionContent content={submittedOption.text} compact /> : "No option selected."}
                          </div>
                        </div>
                        <div className="rounded-xl bg-emerald-50 p-4 shadow-sm dark:bg-emerald-500/10 dark:shadow-none">
                          <p className="text-xs font-black uppercase tracking-[0.16em] text-emerald-700 dark:text-emerald-300">Correct option</p>
                          <p className="mt-2 text-sm font-extrabold text-slate-950 dark:text-white">{correctOption?.id || question.correctOptionId}</p>
                          <div className="mt-2 text-sm font-semibold leading-6 text-slate-700 dark:text-slate-200">
                            {correctOption ? <RichQuestionContent content={correctOption.text} compact /> : "Correct option text is unavailable."}
                          </div>
                        </div>
                      </div>

                      <div className="rounded-xl bg-[#f9fbfe] p-5 shadow-sm dark:bg-[#282828] dark:shadow-none">
                        <p className="text-xs font-black uppercase tracking-[0.16em] text-slate-400">Explanation</p>
                        <div className="mt-3 text-sm font-semibold leading-7 text-slate-700 dark:text-slate-100">
                          <RichQuestionContent content={question.explanation || "No explanation added."} compact />
                        </div>
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>

            <div className="bg-[#f3f6fa] p-5 dark:bg-[#363636]">
              {hasSubmitted && activeTab === "answer" && (
                <div className={`mb-4 rounded-xl px-4 py-3 text-sm font-bold shadow-sm ${
                  isCorrect
                    ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300"
                    : "bg-rose-50 text-rose-700 dark:bg-rose-500/10 dark:text-rose-300"
                }`}>
                  {isCorrect ? "Correct. Open the Solution tab for the explanation." : "Incorrect. Open the Solution tab for the correct answer and explanation."}
                </div>
              )}

              {activeTab === "answer" ? (
                <button
                  type="button"
                  onClick={submitPreviewAnswer}
                  disabled={!selectedOptionId}
                  className="h-12 w-full rounded-xl bg-primary text-sm font-black text-white shadow-lg shadow-primary/20 transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {hasSubmitted ? "Submit again" : selectedOption ? `Submit ${selectedOption.id}` : "Select an option"}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => setActiveTab("answer")}
                  className="h-12 w-full rounded-xl bg-[#f9fbfe] text-sm font-black text-slate-700 shadow-sm transition hover:bg-[#e7edf5] dark:bg-[#2a2a2a] dark:text-slate-200 dark:hover:bg-[#404040]"
                >
                  Back to answer
                </button>
              )}
            </div>
          </aside>
            </Panel>
          </Group>
        </section>
      )}
    </main>
  );
}
