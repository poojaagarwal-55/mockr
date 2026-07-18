"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

const steps = [
  {
    number: "01",
    title: "Verify and choose your practice mode",
    text:
      "Create your account, verify your phone number, and use 3 practice credits to begin. Pick a quick role or add a job description for a more tailored session.",
    mockTitle: "Credits unlocked",
    rows: [
      ["Free interview minutes", "60"],
      ["Phone verification", "Complete"],
      ["First session", "Ready"],
    ],
  },
  {
    number: "02",
    title: "Answer realistic interview questions",
    text:
      "Speak through prompts shaped around your target role. Resume and JD context can help Mockr ask sharper follow-ups, but you can also start directly.",
    mockTitle: "Live practice",
    rows: [
      ["Role-specific prompt", "Active"],
      ["Voice response", "Listening"],
      ["Transcript", "Saved"],
    ],
  },
  {
    number: "03",
    title: "Review your scorecard and debrief",
    text:
      "After the session, see section-wise scoring, feedback notes, and progress signals so your next attempt has a clear focus. Track what improved, what slipped, and what to rehearse next.",
    mockTitle: "Scorecard",
    rows: [
      ["Communication", "82"],
      ["Skills", "76"],
      ["Next step", "Add one impact metric"],
    ],
  },
];

const STEP_DURATION_MS = 4200;

const scorecardFrames = [
  {
    readiness: 75,
    label: "Strong foundation",
    bars: [
      ["Communication", "84", "84%"],
      ["Role skills", "72", "72%"],
    ],
    next: "Re-answer with one metric, one trade-off, and one result.",
  },
  {
    readiness: 82,
    label: "Clear improvement",
    bars: [
      ["Communication", "88", "88%"],
      ["Role skills", "79", "79%"],
    ],
    next: "Shorten the opening and add a stronger business outcome.",
  },
  {
    readiness: 68,
    label: "Needs structure",
    bars: [
      ["Communication", "71", "71%"],
      ["Role skills", "66", "66%"],
    ],
    next: "Use STAR format before adding technical details.",
  },
];

function getNextStepIndex(current: number) {
  return current === steps.length - 1 ? 0 : current + 1;
}

function StepMock({ active }: { active: number }) {
  const step = steps[active];
  const [scoreFrameIndex, setScoreFrameIndex] = useState(0);

  useEffect(() => {
    if (active !== 2) return;

    const timer = window.setInterval(() => {
      setScoreFrameIndex((current) => (current + 1) % scorecardFrames.length);
    }, 1800);

    return () => window.clearInterval(timer);
  }, [active]);

  const scoreFrame = scorecardFrames[scoreFrameIndex];

  if (active === 2) {
    return (
      <div className="rounded-[1.35rem] bg-white p-6 shadow-[0_26px_80px_rgba(35,50,90,0.14)] dark:bg-[#2a2a2a] dark:shadow-[0_26px_80px_rgba(0,0,0,0.24)]">
        <div className="flex items-center justify-between pb-5">
          <p className="text-sm font-black text-[#111] dark:text-[#f4f6fb]">Interview scorecard</p>
          <p className="text-xs font-black text-[#7b8798] dark:text-[#9aa4b5]">Report ready</p>
        </div>

        <div className="rounded-[1.25rem] bg-[#f8fbff] p-5 dark:bg-[#20242c]">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.18em] text-[#4A7CFF]">
                Overall readiness
              </p>
              <p key={scoreFrame.label} className="scorecard-pop mt-2 text-sm font-bold text-[#64748b] dark:text-[#a8b2c4]">
                {scoreFrame.label}
              </p>
            </div>
            <div key={scoreFrame.readiness} className="scorecard-pop flex h-16 w-16 items-center justify-center rounded-full bg-[#eef4ff] text-xl font-black text-[#4A7CFF] dark:bg-white/10 dark:text-[#9bb7ff]">
              {scoreFrame.readiness}
            </div>
          </div>
        </div>

        <div key={`bars-${scoreFrameIndex}`} className="mt-5 space-y-4">
          {scoreFrame.bars.map(([label, score, width], index) => (
            <div key={label} className="scorecard-pop" style={{ animationDelay: `${index * 90}ms` }}>
              <div className="mb-2 flex justify-between text-sm font-black text-[#526174] dark:text-[#b7c0d0]">
                <span>{label}</span>
                <span className="text-[#111] dark:text-[#f4f6fb]">{score}</span>
              </div>
              <div className="h-2 rounded-full bg-[#edf2fb] dark:bg-white/10">
                <div className="h-2 rounded-full bg-[#4A7CFF]" style={{ width }} />
              </div>
            </div>
          ))}
        </div>

        <div className="mt-5 rounded-[1.25rem] bg-[#eef4ff] p-5 dark:bg-[#1f2938]">
          <p className="text-xs font-black uppercase tracking-[0.16em] text-[#4A7CFF]">
            Next practice instruction
          </p>
          <p key={scoreFrame.next} className="scorecard-pop mt-3 whitespace-nowrap text-sm font-bold leading-6 text-[#344256] dark:text-[#c8d1e2]">
            {scoreFrame.next}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-[1.35rem] bg-white p-6 shadow-[0_26px_80px_rgba(35,50,90,0.14)] dark:bg-[#2a2a2a] dark:shadow-[0_26px_80px_rgba(0,0,0,0.24)]">
      <div className="flex items-center justify-between pb-5">
        <p className="text-sm font-black text-[#111] dark:text-[#f4f6fb]">Interview workspace</p>
        <p className="text-xs font-black text-[#7b8798] dark:text-[#9aa4b5]">Demo flow</p>
      </div>

      <div className="pt-3">
        <p className="text-xs font-black uppercase tracking-[0.18em] text-[#4A7CFF]">
          {step.mockTitle}
        </p>
        <div className="mt-5 space-y-3">
          {step.rows.map(([label, meta], index) => {
            const liveVoice = active === 1 && label === "Voice response";
            const selected = liveVoice || (active !== 1 && index === 0);
            return (
              <div
                key={label}
                className={`flex min-h-[68px] items-center justify-between gap-4 rounded-[1.1rem] px-5 py-4 text-sm font-black ${
                  liveVoice
                    ? "bg-[#fff7bd] text-[#111] dark:bg-[#3a3517] dark:text-[#FFE500]"
                    : selected
                      ? "bg-[#eef4ff] text-[#4A7CFF] dark:bg-[#1f2938] dark:text-[#9bb7ff]"
                      : "bg-[#f8fbff] text-[#526174] dark:bg-[#202020] dark:text-[#b7c0d0]"
                }`}
              >
                <span className="leading-5">{label}</span>
                <span
                  className={`shrink-0 rounded-full px-3 py-1 text-[11px] ${
                    liveVoice
                      ? "bg-[#FFE500] text-[#111]"
                      : selected
                        ? "bg-[#4A7CFF] text-white"
                        : "bg-white text-[#7b8798] dark:bg-white/10 dark:text-[#a8b2c4]"
                  }`}
                >
                  {meta}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export function DemoJourney() {
  const [active, setActive] = useState(0);
  const [progress, setProgress] = useState(0);
  const [paused, setPaused] = useState(false);
  const activeRef = useRef(0);
  const progressRef = useRef(0);
  const activeStep = steps[active];

  useEffect(() => {
    activeRef.current = active;
  }, [active]);

  useEffect(() => {
    progressRef.current = progress;
  }, [progress]);

  useEffect(() => {
    if (paused) return;

    const interval = window.setInterval(() => {
      const nextProgress = progressRef.current + (100 / STEP_DURATION_MS) * 80;

      if (nextProgress >= 100) {
        const nextActive = getNextStepIndex(activeRef.current);
        activeRef.current = nextActive;
        progressRef.current = 0;
        setActive(nextActive);
        setProgress(0);
        return;
      }

      progressRef.current = nextProgress;
      setProgress(nextProgress);
    }, 80);

    return () => window.clearInterval(interval);
  }, [paused]);

  function selectStep(index: number) {
    if (index === active) {
      setPaused((current) => !current);
      return;
    }

    activeRef.current = index;
    progressRef.current = 0;
    setActive(index);
    setProgress(0);
    setPaused(false);
  }

  return (
    <section className="mt-8 overflow-hidden rounded-[2rem] bg-white shadow-[0_24px_72px_rgba(35,50,90,0.14)] dark:bg-[#252525] dark:shadow-[0_24px_72px_rgba(0,0,0,0.24)]">
      <div className="grid min-h-[500px] lg:grid-cols-[1fr_1px_0.92fr]">
        <div className="flex flex-col justify-between p-8 md:p-10">
          <div className="space-y-12">
            {steps.map((step, index) => {
              const isActive = index === active;

              return (
                <button
                  key={step.number}
                  type="button"
                  onClick={() => selectStep(index)}
                  className="grid w-full grid-cols-[2rem_1fr] gap-5 text-left"
                >
                  <span
                    className={`pt-1 text-sm font-black ${
                      isActive ? "text-[#4A7CFF]" : "text-[#8a97aa]"
                    }`}
                  >
                    {step.number}
                  </span>
                  <span className="min-w-0">
                    {isActive && (
                      <span className="mb-3 block h-1.5 overflow-hidden rounded-full bg-[#edf2fb]">
                        <span
                          className="block h-full rounded-full bg-[#4A7CFF] transition-[width] duration-100 ease-linear"
                          style={{ width: `${progress}%` }}
                        />
                      </span>
                    )}
                    <span className="flex items-center gap-4">
                      <span
                        className={`text-lg font-black leading-6 ${
                          isActive ? "text-[#111] dark:text-[#f4f6fb]" : "text-[#657084] dark:text-[#8f99aa]"
                        }`}
                      >
                        {step.title}
                      </span>
                    </span>
                    {isActive && (
                      <span
                        key={`${step.number}-copy`}
                        className="demo-step-copy mt-4 block max-w-[620px] text-[15px] font-semibold leading-7 text-[#526174] dark:text-[#b7c0d0]"
                      >
                        {step.text}
                      </span>
                    )}
                  </span>
                </button>
              );
            })}
          </div>

          <Link
            href="/login?tab=signup"
            className="ml-6 mt-2 inline-flex w-fit rounded-full bg-[#4A7CFF] px-7 py-3.5 text-sm font-black text-white shadow-[0_16px_34px_rgba(74,124,255,0.22)] transition hover:-translate-y-0.5 hover:bg-[#3d6ff2]"
          >
            Get started
          </Link>
        </div>

        <div className="hidden bg-[#eef3fb] lg:block dark:bg-white/10" />

        <div className="flex items-center justify-center bg-[radial-gradient(circle_at_78%_12%,rgba(74,124,255,0.18),transparent_32%),radial-gradient(circle_at_14%_86%,rgba(74,124,255,0.12),transparent_36%),linear-gradient(145deg,#edf4ff_0%,#ffffff_58%,#f5f8ff_100%)] p-8 md:p-10 dark:bg-[radial-gradient(circle_at_78%_12%,rgba(74,124,255,0.20),transparent_32%),radial-gradient(circle_at_14%_86%,rgba(74,124,255,0.12),transparent_36%),linear-gradient(145deg,#1f2938_0%,#252525_58%,#20242c_100%)]">
          <div key={activeStep.number} className="demo-mock-in w-full max-w-[480px]">
            <StepMock active={active} />
          </div>
        </div>
      </div>
      <style>{`
        @keyframes demoCopyIn {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes demoMockIn {
          from { opacity: 0; transform: translateY(12px) scale(.985); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
        @keyframes scorecardPop {
          from { opacity: 0; transform: scale(.96); filter: blur(6px); }
          to { opacity: 1; transform: scale(1); filter: blur(0); }
        }
        .demo-step-copy { animation: demoCopyIn 320ms ease-out both; }
        .demo-mock-in { animation: demoMockIn 360ms ease-out both; }
        .scorecard-pop { animation: scorecardPop 360ms cubic-bezier(.2,.8,.2,1) both; }
      `}</style>
    </section>
  );
}
