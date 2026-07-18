import Link from "next/link";
import { ArrowRight, Circle } from "lucide-react";
import { normalizeQuestionTypography, questionCategories, type PublicQuestionPreview } from "@/lib/public-question-previews";

const difficultyColors: Record<PublicQuestionPreview["difficulty"], string> = {
  Easy: "text-emerald-500",
  Medium: "text-amber-500",
  Hard: "text-red-500",
};

export function PublicQuestionList({ questions }: { questions: PublicQuestionPreview[] }) {
  return (
    <div className="overflow-hidden rounded-[24px] bg-white shadow-[0_18px_60px_rgba(15,23,42,0.08)] dark:bg-[#242424] dark:shadow-[0_18px_60px_rgba(0,0,0,0.30)]">
      {questions.map((question, index) => (
        <Link
          key={`${question.category}-${question.slug}`}
          href={`/interview-questions/${question.category}/${question.slug}`}
          className={`group flex items-center gap-4 px-4 py-3 transition-colors ${
            index % 2 === 0
              ? "bg-slate-50 hover:bg-slate-100 dark:bg-[#202020] dark:hover:bg-[#2c2c2c]"
              : "bg-white hover:bg-slate-50 dark:bg-[#242424] dark:hover:bg-[#2c2c2c]"
          }`}
        >
          <div className="flex h-6 w-6 shrink-0 items-center justify-center">
            <Circle className="h-[18px] w-[18px] text-slate-300 dark:text-slate-600" />
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-baseline gap-2">
              <span className="shrink-0 text-sm font-semibold text-slate-500">
                {index + 1}.
              </span>
              <h3 className="truncate text-base font-semibold text-slate-950 dark:text-white">
                {normalizeQuestionTypography(question.title)}
              </h3>
            </div>
            <p className="mt-1 line-clamp-1 text-sm font-medium text-slate-500 dark:text-slate-400">
              {question.summary}
            </p>
          </div>

          <div className="hidden shrink-0 items-center gap-2 md:flex">
            <span className="rounded-full bg-[#edf3ff] px-3 py-1 text-xs font-black text-[#4A7CFF] dark:bg-blue-500/15 dark:text-blue-300">
              {questionCategories[question.category].shortLabel}
            </span>
            <span className={`min-w-[58px] text-right text-sm font-semibold ${difficultyColors[question.difficulty]}`}>
              {question.difficulty === "Medium" ? "Med" : question.difficulty}
            </span>
          </div>

          <ArrowRight className="h-5 w-5 shrink-0 text-slate-300 transition group-hover:translate-x-1 group-hover:text-[#4A7CFF] dark:text-slate-600 dark:group-hover:text-blue-300" />
        </Link>
      ))}
    </div>
  );
}
