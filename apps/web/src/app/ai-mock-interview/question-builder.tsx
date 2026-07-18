"use client";

import Link from "next/link";
import { useState } from "react";

const questionModes = [
  {
    id: "cs",
    label: "CS Fundamentals",
    value: "OS, DBMS, networks, OOP",
    helper: "Creates focused interview practice around core computer science concepts and technical explanation clarity.",
    questionSets: [
      [
        "Explain indexing in databases and when an index can make a query slower.",
        "What happens between typing a URL and seeing the page load in the browser?",
        "How would you compare process, thread, and coroutine in practical terms?",
      ],
      [
        "What is normalization, and when would you intentionally denormalize a table?",
        "Explain deadlock using a simple operating-system example.",
        "How does TCP differ from UDP in an interview scenario?",
      ],
      [
        "What is polymorphism, and how would you explain it without code?",
        "Why do databases use transactions, and what does ACID protect?",
        "How would you describe memory paging to a beginner?",
      ],
    ],
  },
  {
    id: "coding",
    label: "Coding",
    value: "DSA, complexity, edge cases",
    helper: "Generates coding interview questions that test problem solving, trade-offs, complexity, and edge-case thinking.",
    questionSets: [
      [
        "Given a stream of numbers, how would you return the median after each insertion?",
        "How would you detect a cycle in a linked list and explain the proof of correctness?",
        "Design a cache with O(1) get and put operations. What edge cases matter?",
      ],
      [
        "How would you find the longest substring without repeating characters?",
        "Given intervals, how would you merge overlaps and analyze complexity?",
        "How would you choose between BFS and DFS for a grid problem?",
      ],
      [
        "Explain how you would solve top K frequent elements efficiently.",
        "How would you validate edge cases for a binary search solution?",
        "Design a stack that can return the minimum element in O(1).",
      ],
    ],
  },
  {
    id: "sql",
    label: "SQL",
    value: "Joins, windows, query logic",
    helper: "Creates SQL interview questions for joins, aggregations, window functions, query optimization, and data reasoning.",
    questionSets: [
      [
        "How would you find the second highest salary in each department?",
        "Explain the difference between WHERE and HAVING with an interview-ready example.",
        "When would you use a window function instead of a GROUP BY query?",
      ],
      [
        "Write a query to find users who purchased in consecutive months.",
        "How would you debug a SQL query that returns duplicate rows after a join?",
        "Explain ROW_NUMBER, RANK, and DENSE_RANK with a practical example.",
      ],
      [
        "How would you calculate a 7-day rolling average in SQL?",
        "What makes a query slow, and how would you investigate it?",
        "How would you find customers who bought product A but not product B?",
      ],
    ],
  },
  {
    id: "system-design",
    label: "System Design",
    value: "Scale, APIs, architecture",
    helper: "Builds system design interview questions around requirements, trade-offs, data models, scaling, and reliability.",
    questionSets: [
      [
        "Design a URL shortener and explain the database schema you would choose.",
        "How would you scale a notification system for millions of users?",
        "What trade-offs matter when designing an interview scheduling platform?",
      ],
      [
        "Design a real-time chat system and explain how messages stay ordered.",
        "How would you build rate limiting for an API used by many clients?",
        "What would you cache in a feed system, and what should remain fresh?",
      ],
      [
        "Design a file upload service with secure access and short-lived URLs.",
        "How would you make a search service reliable during traffic spikes?",
        "What database would you choose for an activity timeline and why?",
      ],
    ],
  },
];

export function QuestionBuilder() {
  const [activeId, setActiveId] = useState(questionModes[0].id);
  const [setIndex, setSetIndex] = useState(0);
  const active = questionModes.find((mode) => mode.id === activeId) ?? questionModes[0];
  const activeQuestions = active.questionSets[setIndex % active.questionSets.length];
  const displaySetNumber = (setIndex % active.questionSets.length) + 1;
  const activeQuestionBankHref =
    active.id === "cs" ? "/interview-questions/cs-fundamentals" : `/interview-questions/${active.id}`;

  return (
    <div className="relative mt-9 overflow-hidden rounded-[2.4rem] bg-[linear-gradient(135deg,#ffffff_0%,#f4f8ff_48%,#ffffff_100%)] p-4 shadow-[0_-30px_88px_rgba(74,124,255,0.16)] backdrop-blur md:p-6 dark:bg-[linear-gradient(135deg,#2a2a2a_0%,#20242c_48%,#252525_100%)] dark:shadow-[0_-30px_88px_rgba(0,0,0,0.24)]">
      <style>{`
        @keyframes questionLineIn {
          0% { opacity: 0; transform: translateX(-16px); filter: blur(8px); }
          100% { opacity: 1; transform: translateX(0); filter: blur(0); }
        }
        @keyframes generatePulse {
          0%, 100% { transform: scale(1); opacity: .72; }
          50% { transform: scale(1.08); opacity: 1; }
        }
        .question-line-in { animation: questionLineIn 520ms cubic-bezier(.2,.8,.2,1) both; }
        .generate-pulse { animation: generatePulse 1.8s ease-in-out infinite; }
      `}</style>
      <div className="relative overflow-hidden rounded-[2rem] p-5 md:p-8">
        <div className="relative">
          <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
            <div className="max-w-[610px]">
              <h3 className="text-[1.85rem] font-black leading-tight text-[#111827] dark:text-[#f4f6fb]">
                Pick a topic and generate interview questions for practice.
              </h3>
              <p className="mt-4 text-sm font-medium leading-7 text-[#5b6678] dark:text-[#b7c0d0]">
                Choose a focus area, then use the generated set for voice-based AI mock interview
                practice with role-aware follow-ups and feedback.
              </p>
            </div>
            <div className="rounded-[1.35rem] bg-white/80 px-5 py-4 shadow-[0_16px_42px_rgba(74,124,255,0.12)] dark:bg-white/10 dark:shadow-[0_16px_42px_rgba(0,0,0,0.18)]">
              <p className="text-[11px] font-black uppercase tracking-[0.15em] text-[#4A7CFF]">
                Selected topic
              </p>
              <p className="mt-1 text-base font-black text-[#111827] dark:text-[#f4f6fb]">{active.label}</p>
            </div>
          </div>

          <div className="mt-8 grid gap-3 md:grid-cols-4">
            {questionModes.map((mode) => {
              const isActive = mode.id === active.id;
              return (
                <button
                  key={mode.id}
                  type="button"
                  onClick={() => {
                    setActiveId(mode.id);
                    setSetIndex(0);
                  }}
                  className={`relative overflow-hidden rounded-[1.35rem] px-5 py-4 text-left transition duration-300 ${
                    isActive
                      ? "bg-[#4A7CFF] text-white shadow-[0_18px_42px_rgba(74,124,255,0.26)]"
                      : "bg-white/82 text-[#111827] shadow-[0_12px_34px_rgba(74,124,255,0.08)] hover:-translate-y-0.5 hover:shadow-[0_18px_44px_rgba(74,124,255,0.13)] dark:bg-white/10 dark:text-[#f4f6fb] dark:shadow-[0_12px_34px_rgba(0,0,0,0.16)]"
                  }`}
                >
                  <span className="block text-sm font-black">{mode.label}</span>
                  <span
                    className={`mt-2 block text-xs font-bold leading-5 ${
                      isActive ? "text-white/82" : "text-[#6b7280] dark:text-[#a8b2c4]"
                    }`}
                  >
                    {mode.value}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="mt-8 rounded-[1.75rem] p-2 md:p-3">
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.18em] text-[#4A7CFF]">
                  Generated set 0{displaySetNumber}
                </p>
                <h3 className="mt-2 text-xl font-black text-[#111827] dark:text-[#f4f6fb]">
                  {active.label} interview questions
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setSetIndex((current) => current + 1)}
                className="group inline-flex items-center justify-center gap-3 rounded-2xl bg-[linear-gradient(135deg,#eef4ff_0%,#ffffff_100%)] px-5 py-3 text-sm font-black text-[#315fd8] shadow-[0_14px_34px_rgba(74,124,255,0.14)] ring-1 ring-[#dce7ff] transition hover:-translate-y-0.5 hover:shadow-[0_18px_44px_rgba(74,124,255,0.20)] dark:bg-[linear-gradient(135deg,#1f2938_0%,#2a2a2a_100%)] dark:text-[#9bb7ff] dark:ring-white/10 dark:shadow-[0_14px_34px_rgba(0,0,0,0.18)]"
              >
                <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-[#4A7CFF] shadow-[0_10px_22px_rgba(74,124,255,0.28)] transition group-hover:rotate-45">
                  <span className="generate-pulse h-2.5 w-2.5 rounded-full bg-white" />
                </span>
                Generate another set
              </button>
            </div>

            <div key={`${active.id}-${setIndex}`} className="relative mt-7 space-y-4">
              {activeQuestions.map((question, index) => {
                return (
                  <div
                    key={question}
                    className="question-line-in rounded-[1.35rem] bg-[linear-gradient(180deg,#ffffff,#f8fbff)] p-5 shadow-[0_12px_34px_rgba(74,124,255,0.09)] dark:bg-[linear-gradient(180deg,#2a2a2a,#222834)] dark:shadow-[0_12px_34px_rgba(0,0,0,0.16)]"
                    style={{ animationDelay: `${index * 140}ms` }}
                  >
                    <div className="flex items-start gap-4">
                      <span className="mt-2 h-2.5 w-2.5 shrink-0 rounded-full bg-[#4A7CFF]" />
                      <div>
                        <p className="text-[11px] font-black uppercase tracking-[0.16em] text-[#4A7CFF]">
                          Expected interview question
                        </p>
                        <p className="mt-2 text-[15px] font-black leading-7 text-[#172033] dark:text-[#e8edf7]">
                          {question}
                        </p>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="mt-6 flex justify-end">
              <Link
                href={activeQuestionBankHref}
                className="inline-flex items-center justify-center rounded-full bg-[#4A7CFF] px-5 py-3 text-sm font-black text-white shadow-[0_16px_36px_rgba(74,124,255,0.24)] transition hover:-translate-y-0.5 hover:bg-[#3d6ff2]"
              >
                View question bank
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
