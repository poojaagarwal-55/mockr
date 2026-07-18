import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import {
  ArrowRight,
  ChevronDown,
  ClipboardList,
  FileText,
  Gauge,
  Layers3,
  LineChart,
  Mic2,
} from "lucide-react";
import { JsonLd } from "@/components/json-ld";
import { LandingNav } from "@/components/landing-nav";
import { DemoJourney } from "./demo-journey";
import { HeroVisual } from "./hero-visual";
import { QuestionBuilder } from "./question-builder";
import { ReportShowcase } from "./report-showcase";
import { ScrollReveal } from "./scroll-reveal";

export const metadata: Metadata = {
  title: "AI Mock Interview Practice With Free Demo",
  description:
    "Practice AI mock interviews with voice answers, JD-based questions, section-wise scores, detailed reports, progress tracking, and a free demo.",
  alternates: {
    canonical: "https://www.practers.com/ai-mock-interview",
  },
  openGraph: {
    title: "AI Mock Interview Practice With Voice Answers and Feedback",
    description:
      "Take a free demo on Mockr, answer by voice, prepare from a job description, and get detailed interview feedback reports.",
    url: "https://www.practers.com/ai-mock-interview",
    siteName: "Mockr",
    images: [
      {
        url: "https://www.practers.com/ai_interview_doodle_v2.png",
        width: 1200,
        height: 630,
        alt: "Mockr AI interview practice",
      },
    ],
  },
};

const features = [
  {
    title: "Modular practice",
    description:
      "Choose a complete AI interview practice session or focus on one round at a time, from behavioral answers to role-specific preparation.",
    icon: Layers3,
  },
  {
    title: "Voice answers",
    description:
      "Answer interview questions by voice so your practice feels closer to a real conversation, with pacing, clarity, and structure all visible.",
    icon: Mic2,
  },
  {
    title: "Custom prep with JD",
    description:
      "Add a job description to shape prompts around the company, responsibilities, and skills you are targeting in your next interview.",
    icon: FileText,
  },
  {
    title: "Section-wise scores",
    description:
      "Review section-wise interview scores for communication, relevance, answer structure, clarity, and role fit after every practice attempt.",
    icon: Gauge,
  },
  {
    title: "Detailed reports",
    description:
      "Get a detailed AI interview feedback report with strengths, gaps, improvement notes, and next steps instead of generic advice.",
    icon: ClipboardList,
  },
  {
    title: "Progress tracking",
    description:
      "Track interview performance over time, compare attempts, and repeat weak areas so each mock interview has a measurable outcome.",
    icon: LineChart,
  },
];

const reasons = [
  {
    title: "Practice mock interviews anytime",
    text:
      "Start an online mock interview whenever you need practice, without waiting for a peer, mentor, or scheduled slot.",
  },
  {
    title: "Build stronger spoken answers",
    text:
      "Voice-based interview practice improves pacing, clarity, confidence, and answer structure before the real conversation.",
  },
  {
    title: "Improve with AI interview feedback",
    text:
      "Section-wise scores, feedback reports, and progress history show what changed from one practice attempt to the next.",
  },
];

const interviewTypes = [
  {
    title: "Full interview",
    type: "full_interview",
    eyebrow: "Complete loop",
    duration: "60 min",
    description:
      "Take a full AI mock interview with voice answers, coding practice, CS fundamentals, system design prompts, and a detailed scorecard.",
  },
  {
    title: "CS fundamentals",
    type: "cs_fundamentals",
    eyebrow: "Core concepts",
    duration: "25 min",
    description:
      "Prepare for CS fundamentals interview questions across OS, DBMS, networking, OOP, and core computer science concepts.",
  },
  {
    title: "System design",
    type: "system_design",
    eyebrow: "Architecture",
    duration: "30 min",
    description:
      "Practice system design interview questions by explaining requirements, APIs, data models, scalability, reliability, and trade-offs.",
  },
  {
    title: "Coding",
    type: "coding",
    eyebrow: "DSA round",
    duration: "40 min",
    description:
      "Use AI coding interview practice to solve DSA problems, discuss edge cases, analyze complexity, and improve problem solving.",
  },
  {
    title: "Behaviour",
    type: "behavioural",
    eyebrow: "STAR stories",
    duration: "20 min",
    description:
      "Practice behavioural mock interview answers for ownership, conflict, teamwork, failure, leadership, and measurable workplace impact.",
  },
  {
    title: "Product management",
    type: "pm_role",
    eyebrow: "PM cases",
    duration: "40 min",
    description:
      "Prepare for product manager interviews with product sense cases, prioritization, metrics, strategy, and stakeholder questions.",
  },
  {
    title: "Data science",
    type: "data_science_role",
    eyebrow: "Analytics + ML",
    duration: "60 min",
    description:
      "Practice data science interview questions on statistics, SQL, machine learning, experiments, business metrics, and analysis prompts.",
  },
  {
    title: "Gen AI",
    type: "gen_ai_role",
    eyebrow: "LLM roles",
    duration: "50 min",
    description:
      "Prepare for Gen AI interview questions covering LLMs, prompt engineering, RAG, model evaluation, AI products, and responsible AI.",
  },
];

const faqs = [
  {
    question: "What is an AI mock interview?",
    answer:
      "It is an online practice interview where an AI interviewer asks questions, listens to your answers, and gives feedback so you can prepare before the real round.",
  },
  {
    question: "Are AI mock interviews free on Mockr?",
    answer:
      "New users can start with a free demo interview to experience the flow, voice answers, scoring, and report before choosing a plan.",
  },
  {
    question: "What AI mock interview questions can I practice?",
    answer:
      "You can practice questions based on your goal, job description, role, and interview section. Mockr keeps the session focused on what you need to improve.",
  },
  {
    question: "Can I answer by voice?",
    answer:
      "Yes. Mockr supports voice answers so practice feels closer to a real conversation.",
  },
  {
    question: "Can I prepare using a job description?",
    answer:
      "Yes. Add a JD to make your session more relevant to the company, role, and skills you are targeting.",
  },
  {
    question: "How is Mockr different from other AI mock interview platforms?",
    answer:
      "Mockr combines voice-based practice, modular sessions, job description-based preparation, section-wise scoring, detailed reports, and progress tracking.",
  },
];

const jsonLd = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "WebApplication",
      "@id": "https://www.practers.com/ai-mock-interview#webapplication",
      name: "Mockr AI Mock Interview",
      url: "https://www.practers.com/ai-mock-interview",
      applicationCategory: "EducationalApplication",
      operatingSystem: "Web",
      description:
        "Practice AI mock interviews with voice answers, job description-based questions, section-wise scores, detailed reports, progress tracking, and a free demo.",
      publisher: {
        "@id": "https://www.practers.com/#organization",
      },
      offers: {
        "@type": "Offer",
        price: "0",
        priceCurrency: "INR",
        description: "Free demo interview for new Mockr users.",
      },
    },
    {
      "@type": "BreadcrumbList",
      "@id": "https://www.practers.com/ai-mock-interview#breadcrumb",
      itemListElement: [
        {
          "@type": "ListItem",
          position: 1,
          name: "Home",
          item: "https://www.practers.com",
        },
        {
          "@type": "ListItem",
          position: 2,
          name: "AI Mock Interview",
          item: "https://www.practers.com/ai-mock-interview",
        },
      ],
    },
    {
      "@type": "FAQPage",
      "@id": "https://www.practers.com/ai-mock-interview#faq",
      mainEntity: faqs.map((faq) => ({
        "@type": "Question",
        name: faq.question,
        acceptedAnswer: {
          "@type": "Answer",
          text: faq.answer,
        },
      })),
    },
  ],
};

function SectionKicker({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-3 text-xs font-black uppercase tracking-[0.2em] text-[#4A7CFF]">
      {children}
    </p>
  );
}

function PrimaryCta({ className = "" }: { className?: string }) {
  return (
    <Link
      href="/login?tab=signup"
      className={`group inline-flex items-center justify-center gap-2 rounded-full bg-[#4A7CFF] px-6 py-3 text-sm font-extrabold text-white shadow-[0_16px_36px_rgba(74,124,255,0.28)] transition hover:-translate-y-0.5 hover:bg-[#3d6ff2] ${className}`}
    >
      Start Free Demo Interview
      <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" />
    </Link>
  );
}

export default function AiMockInterviewPage() {
  return (
    <>
      <JsonLd data={jsonLd} />
      <ScrollReveal />
      <style>{`
        @keyframes voicePulse {
          0%, 100% { transform: scaleY(.48); opacity: .72; }
          50% { transform: scaleY(1); opacity: 1; }
        }
        @keyframes floatSoft {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-12px); }
        }
        @keyframes glowSweep {
          0% { transform: translateX(-100%); opacity: 0; }
          30% { opacity: .4; }
          100% { transform: translateX(100%); opacity: 0; }
        }
        @keyframes cursorBlink {
          0%, 45% { opacity: 1; }
          46%, 100% { opacity: 0; }
        }
        @keyframes questionDrift {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-8px); }
        }
        @keyframes contextGlow {
          0%, 100% { opacity: .52; transform: scaleX(.76); }
          50% { opacity: 1; transform: scaleX(1); }
        }
        .voice-bar { animation: voicePulse 980ms ease-in-out infinite; transform-origin: center; }
        .float-soft { animation: floatSoft 4.8s ease-in-out infinite; }
        .float-soft-delayed { animation: floatSoft 5.4s ease-in-out infinite 600ms; }
        .question-drift { animation: questionDrift 4.6s ease-in-out infinite; }
        .context-glow { animation: contextGlow 2.8s ease-in-out infinite; transform-origin: left; }
        .typewriter-cursor {
          display: inline-block;
          margin-left: 2px;
          color: #4A7CFF;
          animation: cursorBlink 850ms infinite;
        }
        .shine-card::after {
          content: "";
          position: absolute;
          inset: 0;
          background: linear-gradient(110deg, transparent 20%, rgba(255,255,255,.7), transparent 72%);
          animation: glowSweep 5s ease-in-out infinite;
          pointer-events: none;
        }
        .pulse-ring { box-shadow: 0 0 0 0 rgba(74,124,255,.35); animation: ringPulse 2s infinite; }
        @keyframes ringPulse {
          0% { box-shadow: 0 0 0 0 rgba(74,124,255,.38); }
          70% { box-shadow: 0 0 0 14px rgba(74,124,255,0); }
          100% { box-shadow: 0 0 0 0 rgba(74,124,255,0); }
        }
      `}</style>

      <div className="min-h-screen bg-[#f4f5f7] text-[#151515] transition-colors duration-300 dark:bg-[#222222] dark:text-[#eff2f6]">
        <LandingNav />

        <main>
          <section className="relative overflow-hidden bg-[radial-gradient(ellipse_at_8%_8%,rgba(74,124,255,0.24),transparent_36%),radial-gradient(ellipse_at_78%_18%,rgba(255,229,0,0.16),transparent_30%),linear-gradient(180deg,#f4f8ff_0%,#f4f5f7_72%,#ffffff_100%)] px-6 pb-12 pt-12 transition-colors duration-300 md:pb-20 md:pt-16 dark:bg-[radial-gradient(ellipse_at_8%_8%,rgba(74,124,255,0.18),transparent_36%),radial-gradient(ellipse_at_78%_18%,rgba(255,229,0,0.10),transparent_30%),linear-gradient(180deg,#222222_0%,#1f1f1f_72%,#222222_100%)]">
            <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
              <div
                className="absolute inset-x-0 top-0 h-[78%] opacity-[0.32]"
                style={{
                  backgroundImage:
                    "radial-gradient(rgba(74,124,255,0.34) 1px, transparent 1px)",
                  backgroundSize: "28px 28px",
                  maskImage: "linear-gradient(90deg, transparent 0%, black 18%, black 82%, transparent 100%)",
                }}
              />
              <div className="absolute left-[7%] top-[8%] h-16 w-16 rounded-full border border-[#4A7CFF]/25 bg-white/45 shadow-[0_18px_55px_rgba(74,124,255,0.16)]" />
              <div className="absolute left-[10%] top-[14%] h-5 w-5 rounded-full bg-[#FFE500]/55 shadow-[0_10px_30px_rgba(255,229,0,0.25)]" />
              <svg className="absolute right-[11%] top-[9%] h-20 w-20 opacity-20" viewBox="0 0 100 100" fill="none">
                <circle cx="50" cy="50" r="40" stroke="#4A7CFF" strokeWidth="2.5" strokeDasharray="8 6" />
              </svg>
              <svg className="absolute bottom-[22%] left-[4%] h-14 w-14 opacity-15" viewBox="0 0 100 100" fill="none">
                <rect x="12" y="12" width="76" height="76" rx="18" stroke="#4A7CFF" strokeWidth="2.5" strokeDasharray="10 7" />
              </svg>
            </div>

            <div className="relative z-10 mx-auto grid max-w-[1400px] items-center gap-12 lg:grid-cols-[1.03fr_1.08fr]">
              <div className="mx-auto max-w-[720px] md:mx-0 md:ml-6 md:-mt-4">
                <h1 className="text-[2.2rem] font-black leading-[1.06] tracking-tight text-[#111] md:text-[3.08rem] dark:text-[#f4f6fb]">
                  <span className="whitespace-nowrap">AI Mock Interview</span> Platform That{" "}
                  <span className="text-[#4A7CFF]">Simulates Real Interviews</span>
                </h1>
                <p className="mt-6 max-w-[590px] text-[1.08rem] leading-8 text-[#4b5563] md:text-[1.2rem] dark:text-[#b9c0cc]">
                  Start a free AI mock interview on Mockr, answer by voice, prepare from
                  a job description, and review section-wise scores with a detailed report.
                </p>
                <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                  <PrimaryCta />
                </div>
              </div>

              <HeroVisual />
            </div>
          </section>

          <section id="how-to-start" className="bg-[linear-gradient(180deg,#ffffff_0%,#f7faff_54%,#e7f0ff_100%)] px-6 pb-7 pt-5 transition-colors duration-300 md:pb-10 md:pt-7 dark:bg-[linear-gradient(180deg,#222222_0%,#20242b_54%,#1d2635_100%)]">
            <div className="scroll-reveal mx-auto max-w-[1120px]">
              <div className="text-center">
                <div className="mx-auto max-w-[980px]">
                  <h2 className="text-[2rem] font-black leading-tight text-[#111] md:whitespace-nowrap md:text-[2.75rem] dark:text-[#f4f6fb]">
                    Give your first <span className="text-[#4A7CFF]">AI mock interview</span> today
                  </h2>
                  <p className="mx-auto mt-4 max-w-[1060px] text-[1rem] leading-7 text-[#566174] md:whitespace-nowrap dark:text-[#b7c0d0]">
                    Start with 60 free interview minutes, answer role-specific questions by voice,
                    and use a detailed feedback report to improve your next attempt.
                  </p>
                </div>
              </div>
              <DemoJourney />
            </div>
          </section>

          <section className="relative overflow-hidden bg-[linear-gradient(180deg,#e7f0ff_0%,#eef5ff_48%,#e7f0ff_100%)] px-6 py-10 transition-colors duration-300 md:py-14 dark:bg-[linear-gradient(180deg,#1d2635_0%,#222b3a_48%,#1d2635_100%)]">
            <div className="scroll-reveal reveal-scale mx-auto max-w-[1180px]">
              <div className="mx-auto max-w-[860px] text-center">
                <h2 className="text-[2rem] font-black leading-tight text-[#111] md:text-[2.75rem] dark:text-[#f4f6fb]">
                  Choose your <span className="text-[#4A7CFF]">interview type</span>
                </h2>
                <p className="mx-auto mt-4 max-w-[1050px] text-[1.05rem] font-medium leading-8 text-[#566174] md:whitespace-nowrap dark:text-[#b7c0d0]">
                  Start broad with a full AI mock interview or focus on one question set for your
                  next technical, product, data, or Gen AI round.
                </p>
              </div>

              <div className="mt-10 grid gap-7 sm:grid-cols-2 lg:grid-cols-4">
                {interviewTypes.map((type) => (
                  <div
                    key={type.title}
                    className="group relative flex min-h-[285px] flex-col overflow-hidden rounded-[1.75rem] bg-[linear-gradient(145deg,#ffffff_0%,#eef5ff_48%,#dfeaff_100%)] p-5 transition duration-300 hover:-translate-y-3 hover:scale-[1.025] dark:bg-[linear-gradient(145deg,#2b2b2b_0%,#262a31_54%,#20242b_100%)]"
                    style={{
                      boxShadow:
                        "inset 0 1px 0 rgba(255,255,255,0.95), 0 24px 54px rgba(45, 84, 158, 0.16), 0 8px 18px rgba(74, 124, 255, 0.10)",
                    }}
                  >
                    <div className="pointer-events-none absolute inset-x-5 top-0 h-px bg-white/70 dark:bg-transparent" />
                    <div className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-[linear-gradient(180deg,rgba(255,255,255,0.66),rgba(255,255,255,0))] dark:hidden" />
                    <div className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-[linear-gradient(0deg,rgba(74,124,255,0.08),rgba(74,124,255,0))] dark:bg-[linear-gradient(0deg,rgba(74,124,255,0.10),rgba(74,124,255,0))]" />

                    <div className="relative z-10 flex items-start justify-between gap-3">
                      <div>
                        <h3 className="text-[1.28rem] font-black leading-tight text-[#111827] dark:text-[#f4f6fb]">
                          {type.title}
                        </h3>
                        <p className="mt-2 text-[11px] font-black uppercase tracking-[0.16em] text-[#4A7CFF]">
                          {type.eyebrow}
                        </p>
                      </div>
                      <span className="shrink-0 rounded-full bg-white/85 px-3 py-1.5 text-xs font-black text-[#4A7CFF] shadow-[0_8px_18px_rgba(74,124,255,0.10)]">
                        {type.duration}
                      </span>
                    </div>

                    <p className="relative z-10 mt-5 flex-1 text-[14px] font-semibold leading-7 text-[#526174] dark:text-[#b8c2d3]">
                      {type.description}
                    </p>

                    <Link
                      href={`/interviews/ai?type=${type.type}`}
                      className="relative z-10 mt-6 inline-flex items-center justify-center gap-2 rounded-full bg-white/88 px-4 py-3 text-sm font-black text-[#3f6ff0] shadow-[inset_0_1px_0_rgba(255,255,255,0.95),0_12px_24px_rgba(74,124,255,0.12)] transition duration-300 group-hover:bg-[#4A7CFF] group-hover:text-white group-hover:shadow-[0_16px_36px_rgba(74,124,255,0.30)] dark:bg-white/10 dark:text-[#9bb7ff] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_12px_24px_rgba(0,0,0,0.18)]"
                    >
                      Start this interview
                      <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" />
                    </Link>
                  </div>
                ))}
              </div>
            </div>
          </section>

          <section className="relative overflow-hidden bg-[linear-gradient(180deg,#e7f0ff_0%,#eef5ff_42%,#f8fbff_78%,#f7faff_100%)] px-4 pb-9 pt-10 transition-colors duration-300 md:px-6 md:pb-14 md:pt-14 dark:bg-[linear-gradient(180deg,#1d2635_0%,#222222_42%,#222222_100%)]">
            <div
              className="pointer-events-none absolute left-0 top-12 h-[360px] w-[560px]"
              style={{
                background:
                  "radial-gradient(ellipse at 0% 0%, rgba(74,124,255,0.16) 0%, rgba(74,124,255,0.08) 45%, transparent 72%)",
                filter: "blur(46px)",
              }}
            />
            <div className="scroll-reveal reveal-left relative mx-auto max-w-[1260px]">
              <div className="overflow-hidden rounded-[2rem] bg-[linear-gradient(180deg,#ffffff_0%,#ffffff_50%,#f7faff_76%,rgba(247,250,255,0)_100%)] shadow-[0_-18px_70px_rgba(74,124,255,0.10)] dark:bg-[linear-gradient(180deg,#2a2a2a_0%,#252525_54%,#222222_86%,rgba(34,34,34,0)_100%)] dark:shadow-[0_-18px_70px_rgba(0,0,0,0.18)]">
                <div className="relative p-8 md:p-12">
                  <div className="pointer-events-none absolute inset-x-0 bottom-0 h-28 bg-[linear-gradient(180deg,rgba(247,250,255,0)_0%,#f7faff_88%)] dark:bg-[linear-gradient(180deg,rgba(34,34,34,0)_0%,#222222_88%)]" />
                  <div className="max-w-[780px]">
                    <h2 className="text-[2rem] font-black leading-tight text-[#111] md:text-[2.75rem] dark:text-[#f4f6fb]">
                      What our <span className="text-[#4A7CFF]">AI interview</span> has to offer
                    </h2>
                  </div>

                  <div className="mt-10 grid gap-x-10 gap-y-10 md:grid-cols-2">
                    {features.map((feature) => {
                      const Icon = feature.icon;
                      return (
                        <div
                          key={feature.title}
                          className="feature-card relative z-10 flex h-full flex-row items-start gap-6 p-2 md:gap-8"
                        >
                          <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl border border-[#f4f4f4] bg-white shadow-[0_8px_30px_rgba(0,0,0,0.04)] md:h-[72px] md:w-[72px] dark:border-white/10 dark:bg-[#2b2b2b]">
                            <Icon className="h-7 w-7 text-[#4A7CFF]" />
                          </div>
                          <div className="pt-1">
                            <h3 className="text-[1.2rem] font-black tracking-tight text-[#111] dark:text-[#f4f6fb]">
                              {feature.title}
                            </h3>
                            <p className="mt-2 max-w-[410px] text-[15px] font-medium leading-[1.75] text-[#555f70] dark:text-[#b7c0d0]">
                              {feature.description}
                            </p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          </section>

          <ReportShowcase />

          <section className="relative overflow-hidden bg-[linear-gradient(180deg,#ffffff_0%,#e8f1ff_28%,#f2f7ff_68%,#ffffff_100%)] px-6 pb-12 pt-9 transition-colors duration-300 md:pb-16 md:pt-12 dark:bg-[linear-gradient(180deg,#222222_0%,#1f2938_34%,#222222_100%)]">
            <div
              aria-hidden="true"
              className="absolute left-1/2 top-[95px] h-[420px] w-[980px] -translate-x-1/2 rounded-full bg-[#4A7CFF]/[0.10] blur-3xl"
            />
            <div className="scroll-reveal reveal-scale relative mx-auto max-w-[1160px]">
              <div className="mx-auto max-w-[900px] text-center">
                <h2 className="text-[2rem] font-black leading-tight text-[#111] md:text-[2.72rem] dark:text-[#f4f6fb]">
                  <span className="text-[#4A7CFF]">Interview questions</span> built around your role
                </h2>
                <p className="mx-auto mt-5 max-w-[820px] text-[1.05rem] font-medium leading-8 text-[#4b5563] dark:text-[#b7c0d0]">
                  Choose a role, add a job description when you have one, and Mockr turns that
                  context into focused interview practice instead of a generic question list.
                </p>
              </div>

              <QuestionBuilder />
            </div>
          </section>

          <section className="bg-[linear-gradient(180deg,#ffffff_0%,#f7faff_38%,#eef3fb_76%,#f4f5f7_100%)] px-6 py-10 transition-colors duration-300 md:py-14 dark:bg-[linear-gradient(180deg,#222222_0%,#20242b_45%,#222222_100%)]">
            <div className="scroll-reveal reveal-right mx-auto max-w-[1180px] text-center">
              <h2 className="mx-auto max-w-[840px] text-[2rem] font-black leading-tight text-[#111] md:text-[2.65rem] dark:text-[#f4f6fb]">
                Why practice with an <span className="text-[#4A7CFF]">AI interviewer</span> before the real round
              </h2>
              <p className="mx-auto mt-5 max-w-[960px] text-[1.05rem] font-medium leading-8 text-[#5b6678] md:whitespace-nowrap dark:text-[#b7c0d0]">
                AI interview practice helps you rehearse spoken answers, get structured feedback,
                and improve before real interviews.
              </p>

              <div className="mt-10 grid items-stretch gap-7 md:grid-cols-3">
                {reasons.map((reason, index) => (
                  <div key={reason.title} className="group relative flex h-full flex-col pt-9">
                    <div className="relative z-10 mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-[#111827] text-2xl font-black text-white shadow-[0_18px_38px_rgba(17,24,39,0.16)] transition duration-300 group-hover:-translate-y-1 group-hover:bg-[#4A7CFF] group-hover:shadow-[0_20px_42px_rgba(74,124,255,0.28)]">
                      {index + 1}
                    </div>
                    <div className="relative mt-[-2rem] flex min-h-[250px] flex-1 flex-col justify-start overflow-hidden rounded-[1.65rem] bg-white px-7 pb-8 pt-14 shadow-[0_22px_70px_rgba(35,50,90,0.10)] transition duration-300 group-hover:-translate-y-1 group-hover:shadow-[0_28px_82px_rgba(35,50,90,0.14)] dark:bg-[#2a2a2a] dark:shadow-[0_22px_70px_rgba(0,0,0,0.22)]">
                      <h3 className="text-xl font-black text-[#111] dark:text-[#f4f6fb]">{reason.title}</h3>
                      <p className="mx-auto mt-4 max-w-[285px] text-[15px] font-medium leading-7 text-[#5b6678] dark:text-[#b7c0d0]">
                        {reason.text}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </section>

          <section className="bg-[#f4f5f7] px-6 py-12 transition-colors duration-300 md:py-20 dark:bg-[#222222]">
            <div className="scroll-reveal reveal-left mx-auto max-w-[1180px]">
              <div className="mx-auto max-w-[900px] text-center">
                <h2 className="text-[2.25rem] font-black leading-tight text-[#111] md:text-[3.25rem] dark:text-[#f4f6fb]">
                  Frequently Asked <span className="text-[#4A7CFF]">Questions</span>
                </h2>
                <p className="mt-5 text-lg font-medium leading-8 text-[#4b5563] dark:text-[#b7c0d0]">
                  Everything you need to know about the platform.
                </p>
              </div>
              <div className="mx-auto mt-10 max-w-[1040px] divide-y divide-[#dedede] border-y border-[#dedede] dark:divide-[#3e3e3e] dark:border-[#3e3e3e]">
                {faqs.slice(0, 4).map((faq) => (
                  <details key={faq.question} className="group">
                    <summary className="flex cursor-pointer list-none items-center justify-between gap-6 py-7 text-left text-lg font-black text-[#111] md:text-xl dark:text-[#f4f6fb]">
                      {faq.question}
                      <ChevronDown className="h-5 w-5 shrink-0 text-[#111] transition-transform group-open:rotate-180 dark:text-[#f4f6fb]" />
                    </summary>
                    <p className="max-w-[780px] pb-7 text-[15px] font-medium leading-7 text-[#4b5563] dark:text-[#b7c0d0]">
                      {faq.answer}
                    </p>
                  </details>
                ))}
              </div>
              <div className="mt-10 text-center">
                <Link href="/faq" className="text-lg font-black text-[#111] underline decoration-[#111]/25 underline-offset-4 transition hover:text-[#4A7CFF] dark:text-[#f4f6fb] dark:decoration-white/25">
                  View more
                </Link>
              </div>
            </div>
          </section>

          <section className="bg-[#FFE500] px-6 py-9 md:py-11">
            <div className="scroll-reveal reveal-fade mx-auto flex max-w-[1180px] flex-col gap-6 md:flex-row md:items-center md:justify-between">
              <div className="max-w-[680px]">
                <h2 className="text-[2rem] font-black leading-tight text-[#111] md:text-[2.45rem]">
                  Ready to ace your interview?
                </h2>
                <p className="mt-3 max-w-[620px] text-base font-medium leading-7 text-[#6d6300] md:text-lg">
                  Practice with AI voice interviews, targeted question sets, and instant rubric-scored
                  reports. New users get 60 free interview minutes after phone verification.
                </p>
              </div>
              <Link
                href="/login?tab=signup"
                className="inline-flex shrink-0 items-center justify-center rounded-full bg-[#111827] px-8 py-4 text-base font-black text-white shadow-[0_18px_42px_rgba(17,24,39,0.22)] transition hover:-translate-y-0.5 hover:bg-[#050816]"
              >
                Start Practicing Free
              </Link>
            </div>
          </section>

          <footer className="relative overflow-hidden py-14 text-[#999]" style={{ background: "linear-gradient(135deg, #000000 60%, #0c1c38 100%)" }}>
            <div className="mx-auto max-w-[1200px] px-6">
              <div className="mb-10 grid gap-10 md:grid-cols-4">
                <div className="md:col-span-2">
                  <Image src="/logo_big_dark.png" alt="Mockr" width={140} height={40} className="mb-5 h-8 w-auto" />
                  <p className="max-w-xs text-sm leading-relaxed">
                    The AI-native interview preparation platform for realistic practice,
                    feedback reports, and measurable progress.
                  </p>
                </div>
                <div>
                  <h4 className="mb-5 text-[16px] font-extrabold tracking-tight text-white">Product</h4>
                  <ul className="space-y-3 text-sm">
                    <li><Link className="transition-colors hover:text-white" href="/#features">Features</Link></li>
                    <li><Link className="transition-colors hover:text-white" href="/ai-mock-interview">Interviews</Link></li>
                    <li><Link className="transition-colors hover:text-white" href="/interview-types">Interview Types</Link></li>
                    <li><Link className="transition-colors hover:text-white" href="/interview-questions">Questions</Link></li>
                    <li><Link className="transition-colors hover:text-white" href="/blog">Blog</Link></li>
                    <li><Link className="transition-colors hover:text-white" href="/faq">FAQ</Link></li>
                    <li><Link className="transition-colors hover:text-white" href="/#testimonials">Testimonials</Link></li>
                  </ul>
                </div>
                <div>
                  <h4 className="mb-5 text-[16px] font-extrabold tracking-tight text-white">Company</h4>
                  <ul className="space-y-3 text-sm">
                    <li><Link className="transition-colors hover:text-white" href="/about">About Us</Link></li>
                    <li><Link className="transition-colors hover:text-white" href="/careers">Careers</Link></li>
                    <li><Link className="transition-colors hover:text-white" href="/privacy">Privacy Policy</Link></li>
                    <li><Link className="transition-colors hover:text-white" href="/terms">Terms of Service</Link></li>
                  </ul>
                </div>
              </div>
              <div className="flex flex-col items-center justify-between gap-4 border-t border-white/10 pt-7 text-xs md:flex-row">
                <p>&copy; 2026 Mockr. All rights reserved.</p>
                <div className="flex gap-4">
                  <a href="https://x.com/practerscom?s=11" target="_blank" rel="noopener noreferrer" className="flex h-10 w-10 items-center justify-center rounded-full border border-[#222] bg-[#111] shadow-lg transition-transform hover:-translate-y-1">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="white">
                      <path d="M18.901 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.638 7.584H.474l8.6-9.83L0 1.154h7.594l5.243 6.932ZM17.61 20.644h2.039L6.486 3.24H4.298Z"/>
                    </svg>
                  </a>
                  <a href="https://www.linkedin.com/company/practers/" target="_blank" rel="noopener noreferrer" className="flex h-10 w-10 items-center justify-center rounded-full border border-[#222] bg-[#111] shadow-lg transition-transform hover:-translate-y-1">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="white">
                      <path d="M19 0h-14c-2.761 0-5 2.239-5 5v14c0 2.761 2.239 5 5 5h14c2.762 0 5-2.239 5-5v-14c0-2.761-2.238-5-5-5zm-11 19h-3v-11h3v11zm-1.5-12.268c-.966 0-1.75-.79-1.75-1.764s.784-1.764 1.75-1.764 1.75.79 1.75 1.764-.783 1.764-1.75 1.764zm13.5 12.268h-3v-5.604c0-3.368-4-3.113-4 0v5.604h-3v-11h3v1.765c1.396-2.586 7-2.777 7 2.476v6.759z"/>
                    </svg>
                  </a>
                  <a href="https://www.instagram.com/trypracters?igsh=MWowM2RuYTM5NmVydQ%3D%3D&utm_source=qr" target="_blank" rel="noopener noreferrer" className="flex h-10 w-10 items-center justify-center rounded-full border border-[#222] bg-[#111] shadow-lg transition-transform hover:-translate-y-1">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="2" y="2" width="20" height="20" rx="5" ry="5"></rect>
                      <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"></path>
                      <line x1="17.5" y1="6.5" x2="17.51" y2="6.5"></line>
                    </svg>
                  </a>
                  <a href="https://t.me/practers" target="_blank" rel="noopener noreferrer" className="flex h-10 w-10 items-center justify-center rounded-full border border-[#222] bg-[#111] shadow-lg transition-transform hover:-translate-y-1">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="white">
                      <path d="M23.91 3.79L20.3 20.84c-.25 1.21-.98 1.5-2 .94l-5.5-4.07-2.66 2.57c-.3.3-.55.56-1.1.56-.72 0-.6-.27-.84-.95L6.3 13.7l-5.45-1.7c-1.18-.36-1.19-1.16.26-1.75l21.26-8.2c.97-.43 1.9.24 1.53 1.73z"></path>
                    </svg>
                  </a>
                  <a href="https://chat.whatsapp.com/DARzbWxP9YU2ENTOa8Idj4" target="_blank" rel="noopener noreferrer" className="flex h-10 w-10 items-center justify-center rounded-full border border-[#222] bg-[#111] shadow-lg transition-transform hover:-translate-y-1">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="white">
                      <path d="M.057 24l1.687-6.163a11.867 11.867 0 0 1-1.587-5.946C.16 5.335 5.495 0 12.05 0a11.817 11.817 0 0 1 8.413 3.488 11.824 11.824 0 0 1 3.48 8.414c-.003 6.557-5.338 11.892-11.893 11.892a11.9 11.9 0 0 1-5.688-1.448L.057 24zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884-.001 2.225.651 3.891 1.746 5.634l-.999 3.648 3.742-.981zm11.387-5.464c-.074-.124-.272-.198-.57-.347-.297-.149-1.758-.868-2.031-.967-.272-.099-.47-.149-.669.149-.198.297-.768.967-.941 1.165-.173.198-.347.223-.644.074-.297-.149-1.255-.462-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.521.151-.172.2-.296.3-.495.099-.198.05-.372-.025-.521-.075-.148-.669-1.611-.916-2.206-.242-.579-.487-.501-.669-.51l-.57-.01c-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.626.712.226 1.36.194 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.695.248-1.29.173-1.414z"></path>
                    </svg>
                  </a>
                </div>
              </div>
            </div>
          </footer>
        </main>
      </div>
    </>
  );
}
