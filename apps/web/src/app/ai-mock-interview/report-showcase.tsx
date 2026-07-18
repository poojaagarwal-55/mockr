"use client";

import { useEffect, useState } from "react";

const reportFrames = [
  {
    score: 6.8,
    questions: 6,
    role: "Software Engineer",
    best: "CS Knowledge",
    weakest: "Communication",
    verdict: "Good base",
    bars: [
      ["CS Knowledge", 78],
      ["Communication", 61],
      ["Problem Solving", 66],
    ],
    strength: "Good grasp of fundamentals when explaining database and OS concepts.",
    weakness: "Spoken answers need clearer structure before moving into details.",
    nextSteps: [
      "Open with one-line context before the technical explanation.",
      "Use a short example after defining each concept.",
      "Repeat one CS fundamentals round with voice answers.",
    ],
  },
  {
    score: 7.4,
    questions: 8,
    role: "Software Engineer",
    best: "Problem Solving",
    weakest: "Structure",
    verdict: "Strong first try",
    bars: [
      ["CS Knowledge", 84],
      ["Communication", 68],
      ["Problem Solving", 72],
    ],
    strength: "Clear technical reasoning when explaining trade-offs.",
    weakness: "Project answers need stronger impact metrics.",
    nextSteps: [
      "Add one measurable result to every project answer.",
      "Close with what changed because of your decision.",
      "Practice a follow-up question on ownership and trade-offs.",
    ],
  },
  {
    score: 8.1,
    questions: 10,
    role: "Software Engineer",
    best: "Communication",
    weakest: "CS Depth",
    verdict: "Interview ready",
    bars: [
      ["CS Knowledge", 76],
      ["Communication", 86],
      ["Problem Solving", 81],
    ],
    strength: "Confident communication with concise answer flow.",
    weakness: "A few CS depth answers need more precise terminology.",
    nextSteps: [
      "Rehearse CS fundamentals with exact definitions.",
      "Use follow-up questions to stress-test weak concepts.",
      "Record one shorter version of the same answer.",
    ],
  },
];

export function ReportShowcase() {
  const [frameIndex, setFrameIndex] = useState(0);
  const frame = reportFrames[frameIndex];

  useEffect(() => {
    const timer = window.setInterval(() => {
      setFrameIndex((current) => (current + 1) % reportFrames.length);
    }, 2200);

    return () => window.clearInterval(timer);
  }, []);

  return (
    <section className="relative overflow-hidden bg-[#4A7CFF] px-6 py-10 md:py-14">
      <style>{`
        @keyframes reportPopIn {
          0% { opacity: 0; transform: scale(.96); filter: blur(8px); }
          100% { opacity: 1; transform: scale(1); filter: blur(0); }
        }
        .report-pop-in { animation: reportPopIn 520ms cubic-bezier(.2,.8,.2,1) both; }
      `}</style>

      <div className="relative mx-auto max-w-[1180px]">
        <div className="scroll-reveal reveal-fade mx-auto max-w-[900px] text-center">
          <h2 className="text-[2rem] font-black leading-tight text-white md:text-[2.72rem]">
            Get a <span className="text-[#FFE500]">detailed scorecard</span> after every AI mock interview.
          </h2>
          <p className="mx-auto mt-4 max-w-[780px] text-[1.05rem] font-medium leading-8 text-white/84">
            After every AI mock interview, your report shows section-wise scores, strengths,
            weak areas, and the exact next practice focus.
          </p>
        </div>

        <div className="scroll-reveal reveal-scale mx-auto mt-9 max-w-[1040px] overflow-hidden rounded-[2.2rem] bg-white shadow-[0_34px_95px_rgba(9,30,82,0.28)] dark:bg-[#252525] dark:shadow-[0_34px_95px_rgba(0,0,0,0.34)]">
          <div className="bg-[linear-gradient(135deg,#f8fbff_0%,#e7f1ff_100%)] p-5 md:p-6 dark:bg-[linear-gradient(135deg,#2a3140_0%,#1f2938_100%)]">
            <div className="grid gap-6 md:grid-cols-[0.9fr_1.1fr] md:items-center">
              <div>
                <p className="text-sm font-black uppercase tracking-[0.16em] text-[#5e769f]">
                  Overall performance
                </p>
                <div className="mt-3 flex items-end gap-3">
                  <span className="text-[4.2rem] font-black leading-none text-[#111827] transition-all duration-500 dark:text-[#f4f6fb]">
                    {frame.score.toFixed(1)}
                  </span>
                  <span className="pb-3 text-2xl font-black text-[#334155] dark:text-[#c8d1e2]">/10</span>
                </div>
                <div className="mt-4 h-3 max-w-[280px] rounded-full bg-white/70">
                  <div
                    className="h-3 rounded-full bg-[#4A7CFF] transition-all duration-700 ease-out"
                    style={{ width: `${frame.score * 10}%` }}
                  />
                </div>
                <div className="mt-4 inline-flex rounded-full bg-[#e8fff7] px-4 py-2 text-sm font-black text-[#07866c] transition-all duration-500">
                  Verdict: {frame.verdict}
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                {[
                  ["Questions", frame.questions],
                  ["Role", frame.role],
                  ["Best category", frame.best],
                  ["Weakest", frame.weakest],
                ].map(([label, value], index) => (
                  <div
                    key={`${label}-${value}`}
                    className="report-pop-in rounded-2xl bg-white px-5 py-3.5 shadow-[0_12px_32px_rgba(74,124,255,0.08)] dark:bg-white/10 dark:shadow-[0_12px_32px_rgba(0,0,0,0.16)]"
                    style={{ animationDelay: `${index * 70}ms` }}
                  >
                    <p className="text-xs font-black uppercase tracking-[0.14em] text-[#8da0c3]">
                      {label}
                    </p>
                    <p className="mt-2 text-base font-black text-[#111827] dark:text-[#f4f6fb]">{value}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="grid gap-0 md:grid-cols-[1.08fr_0.92fr]">
            <div className="p-5 md:p-6">
              <h3 className="text-xl font-black text-[#111827] dark:text-[#f4f6fb]">Performance breakdown</h3>
              <div className="mt-5 space-y-4">
                {frame.bars.map(([label, value], index) => (
                  <div
                    key={`${label}-${value}`}
                    className="report-pop-in"
                    style={{ animationDelay: `${index * 90}ms` }}
                  >
                    <div className="mb-2 flex items-center justify-between gap-4 text-sm font-black">
                      <span className="text-[#263247] dark:text-[#c8d1e2]">{label}</span>
                      <span className="text-[#4A7CFF]">{value}/100</span>
                    </div>
                    <div className="h-2.5 rounded-full bg-[#edf2fb] dark:bg-white/10">
                      <div
                        className="h-2.5 rounded-full bg-[#4A7CFF] transition-all duration-700 ease-out"
                        style={{ width: `${value}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>

              <div key={`notes-${frameIndex}`} className="mt-6 grid gap-4 sm:grid-cols-2">
                <div className="report-pop-in rounded-2xl bg-[#ecfff8] p-4 dark:bg-[#12332b]">
                  <p className="text-xs font-black uppercase tracking-[0.14em] text-[#0E9F82]">
                    Strength
                  </p>
                  <p className="mt-2 text-sm font-bold leading-6 text-[#17342d] dark:text-[#bdf2df]">
                    {frame.strength}
                  </p>
                </div>
                <div className="report-pop-in rounded-2xl bg-[#fff1f3] p-4 dark:bg-[#3a1c25]" style={{ animationDelay: "120ms" }}>
                  <p className="text-xs font-black uppercase tracking-[0.14em] text-[#e91e63]">
                    Weak spot
                  </p>
                  <p className="mt-2 text-sm font-bold leading-6 text-[#42242c] dark:text-[#ffc8d6]">
                    {frame.weakness}
                  </p>
                </div>
              </div>
            </div>

            <div className="bg-[#f8fbff] p-5 md:p-6 dark:bg-[#20242c]">
              <h3 className="text-xl font-black text-[#111827] dark:text-[#f4f6fb]">Recommended next steps</h3>
              <div key={`steps-${frameIndex}`} className="mt-5 space-y-4">
                {frame.nextSteps.map((text, index) => (
                  <div
                    key={text}
                    className="report-pop-in flex gap-4 rounded-2xl bg-white p-4 shadow-[0_10px_30px_rgba(74,124,255,0.08)] dark:bg-white/10 dark:shadow-[0_10px_30px_rgba(0,0,0,0.16)]"
                    style={{ animationDelay: `${index * 100}ms` }}
                  >
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#4A7CFF] text-sm font-black text-white">
                      {index + 1}
                    </span>
                    <p className="text-sm font-bold leading-6 text-[#334155] dark:text-[#c8d1e2]">{text}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
