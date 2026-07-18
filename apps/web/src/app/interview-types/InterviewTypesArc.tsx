"use client";

import { useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { gsap, ScrollTrigger } from "@/hooks/useGsap";

const INTERVIEW_TYPES_DATA = [
  {
    id: "full-interview",
    title: "Full Interview",
    category: "Full Loop",
    duration: "45m",
    description: "Your 24/7 AI interviewer adapts in real-time, evaluates your code, and scores answers against industry rubrics.",
    longDescription: "A complete mock interview covering coding, CS Fundamentals, and system design. Experience the full interview process with real-time feedback and comprehensive evaluation.",
    tags: ["Full Interview", "Live Coding", "CS Fundamentals", "System Design"],
    route: "/interviews/ai?type=full-interview",
  },
  {
    id: "cs-fundamentals",
    title: "CS Fundamentals",
    category: "Concepts",
    duration: "30m",
    description: "Deep dive into OS, DBMS, networks, and core CS concepts to build a strong foundation.",
    longDescription: "Master fundamental computer science concepts including operating systems, database management, networking protocols, and core CS principles essential for technical interviews.",
    tags: ["Operating Systems", "DBMS", "Networks", "Core Concepts"],
    route: "/interviews/ai?type=cs-fundamentals",
  },
  {
    id: "system-design",
    title: "System Design",
    category: "Architecture",
    duration: "60m",
    description: "Practice scalability, architecture, and system design interviews to master large-scale systems.",
    longDescription: "Learn to design scalable, distributed systems with high availability. Practice architecture decisions, trade-offs, and system design patterns used by top tech companies in production environments.",
    tags: ["Scalability", "Architecture", "Distributed Systems", "Design Patterns"],
    route: "/interviews/ai?type=system-design",
  },
  {
    id: "coding",
    title: "Data Structures",
    category: "Algorithms",
    duration: "45m",
    description: "Sharpen your data structures and algorithms skills with challenging coding problems.",
    longDescription: "Practice essential data structures and algorithms. Solve coding challenges, optimize solutions, and master problem-solving techniques for technical interviews.",
    tags: ["Arrays", "Trees", "Graphs", "Dynamic Programming"],
    route: "/interviews/ai?type=coding",
  },
  {
    id: "behavioral",
    title: "Behavioral",
    category: "Soft Skills",
    duration: "30m",
    description: "Practice HR and STAR-based behavioral questions to master leadership communication.",
    longDescription: "Prepare for behavioral interviews with STAR method practice. Develop compelling stories that showcase your leadership, teamwork, and problem-solving abilities.",
    tags: ["STAR Method", "Leadership", "Teamwork", "Communication"],
    route: "/interviews/ai?type=behavioral",
  },
  {
    id: "data-science",
    title: "Data Science",
    category: "Analytics",
    duration: "45m",
    description: "Practice essential data science concepts including statistics, ML algorithms, and model evaluation.",
    longDescription: "Master data science fundamentals with hands on practice in statistical analysis, machine learning algorithms, and model evaluation techniques used in real-world data science roles.",
    tags: ["Statistics", "ML Algorithms", "Feature Engineering", "Model Evaluation"],
    route: "/interviews/ai?type=data-science",
  },
  {
    id: "gen-ai",
    title: "Gen AI",
    category: "AI/ML",
    duration: "40m",
    description: "Deep dive into generative AI, LLMs, prompt engineering, and RAG architectures.",
    longDescription: "Explore generative AI concepts including transformer architectures, large language models, retrieval-augmented generation, and fine-tuning techniques for production AI systems.",
    tags: ["LLMs", "Prompt Engineering", "RAG", "Fine-tuning"],
    route: "/interviews/ai?type=gen-ai",
  },
  {
    id: "product-management",
    title: "Product Management",
    category: "Strategy",
    duration: "35m",
    description: "Practice product strategy, roadmap planning, and stakeholder management for PM roles.",
    longDescription: "Develop product management skills through case studies on product strategy, feature prioritization, user research analysis,  and cross-functional stakeholder communication.",
    tags: ["Product Strategy", "Prioritization", "User Research", "Roadmapping"],
    route: "/interviews/ai?type=product-management",
  },
];

export default function InterviewTypesArc({ isDark = false }: { isDark?: boolean }) {
  const router = useRouter();
  const sectionRef = useRef<HTMLElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const section = sectionRef.current;
    const wrapper = wrapperRef.current;
    const container = containerRef.current;

    if (!section || !wrapper || !container) return;

    const getScrollAmount = () => container.scrollWidth - wrapper.offsetWidth;

    const tween = gsap.to(container, {
      x: () => -getScrollAmount(),
      ease: "none",
      scrollTrigger: {
        trigger: section,
        pin: true,
        pinSpacing: true,
        scrub: 1.2,
        start: "top top",
        end: () => `+=${getScrollAmount()}`,
        invalidateOnRefresh: true,
        anticipatePin: 1,
      }
    });

    // Force refresh after mount to ensure all cards are measured
    setTimeout(() => {
      ScrollTrigger.refresh();
    }, 100);

    return () => {
      tween.kill();
      ScrollTrigger.getAll().forEach(t => {
        if (t.trigger === section) t.kill();
      });
    };
  }, []);

  return (
    <section
      ref={sectionRef}
      className={`relative w-full transition-colors duration-500 overflow-hidden ${
        isDark ? 'bg-[#222222]' : 'bg-[#f4f5f7]'
      }`}
    >
      {/* Header - inside section, positioned to stay visible */}
      <div className="w-full text-center py-3 md:py-2">
        <h2
          className={`text-[2rem] md:text-[2.6rem] font-black tracking-tight leading-[1.05] transition-colors duration-500 ${
            isDark ? 'text-white' : 'text-[#111111]'
          }`}
        >
          Master your <span className="text-[#4A7CFF]">Interview Focus</span>
        </h2>
      </div>

      <div ref={wrapperRef} className="w-full relative h-screen flex items-center">
        <div ref={containerRef} className="flex gap-6 md:gap-10 px-[10vw] md:px-[15vw] w-max will-change-transform items-center">

          {INTERVIEW_TYPES_DATA.map((card, idx) => (
            <div
              key={card.id}
              className="group relative flex-shrink-0 w-[85vw] md:w-[340px] lg:w-[360px] h-[480px] md:h-[520px] transition-all duration-500 hover:-translate-y-2 cursor-pointer drop-card"
              style={{
                background: isDark ? '#1e293b' : '#e8f2ff',
                boxShadow: isDark
                  ? 'inset 20px 20px 20px rgba(0, 0, 0, 0.2), 25px 35px 20px rgba(0, 0, 0, 0.2), 25px 30px 30px rgba(0, 0, 0, 0.2), inset -20px -20px 25px rgba(255, 255, 255, 0.05)'
                  : 'inset 20px 20px 20px rgba(0, 0, 0, 0.05), 25px 35px 20px rgba(0, 0, 0, 0.08), 25px 30px 30px rgba(0, 0, 0, 0.08), inset -20px -20px 25px rgba(255, 255, 255, 0.9)',
                borderRadius: '32px',
                animationDelay: `${idx * 0.5}s`,
              }}
              onClick={() => router.push(card.route)}
            >
              {/* Glassmorphic shine effects */}
              <div
                className="absolute rounded-full opacity-80"
                style={{
                  top: '50px',
                  left: '75px',
                  width: '35px',
                  height: '35px',
                  background: isDark ? 'rgba(255, 255, 255, 0.1)' : 'rgba(255, 255, 255, 0.95)',
                }}
              />
              <div
                className="absolute rounded-full opacity-80"
                style={{
                  top: '90px',
                  left: '100px',
                  width: '15px',
                  height: '15px',
                  background: isDark ? 'rgba(255, 255, 255, 0.1)' : 'rgba(255, 255, 255, 0.95)',
                }}
              />

              {/* Content wrapper */}
              <div className="relative h-full flex flex-col justify-between p-8 text-center">
                <div className="flex flex-col gap-4">
                  <h3 className={`text-[24px] md:text-[28px] font-bold tracking-tight leading-tight ${
                    isDark ? 'text-white' : 'text-[#2c3e50]'
                  }`}>
                    {card.title}
                  </h3>

                  <p className={`text-[14px] md:text-[15px] leading-[1.7] font-medium ${
                    isDark ? 'text-[#94a3b8]' : 'text-[#5a6c7d]'
                  }`}>
                    {card.longDescription}
                  </p>

                  {/* Feature Tags */}
                  <div className="flex flex-wrap justify-center gap-2 mt-2">
                    {card.tags.map((tag, tagIdx) => (
                      <span
                        key={tagIdx}
                        className={`px-3 py-1.5 rounded-full text-[11px] font-semibold ${
                          isDark
                            ? 'bg-[#334155] text-[#cbd5e1]'
                            : 'bg-[#d4e4ff] text-[#2c5aa0]'
                        }`}
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                </div>

                <div className="flex flex-col gap-4">
                  {/* Stats */}
                  <div className={`flex items-center justify-center gap-6 text-[13px] font-semibold ${
                    isDark ? 'text-[#cbd5e1]' : 'text-[#5a6c7d]'
                  }`}>
                    <div className="flex items-center gap-2">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
                        <circle cx="12" cy="7" r="4"></circle>
                      </svg>
                      {card.category}
                    </div>
                    <div className="flex items-center gap-2">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
                        <line x1="16" y1="2" x2="16" y2="6"></line>
                        <line x1="8" y1="2" x2="8" y2="6"></line>
                        <line x1="3" y1="10" x2="21" y2="10"></line>
                      </svg>
                      {card.duration}
                    </div>
                  </div>

                  {/* Start Button */}
                  <button
                    onClick={(e) => { e.stopPropagation(); router.push(card.route); }}
                    className={`w-full px-6 py-3 rounded-full font-bold text-[15px] transition-all duration-300 hover:scale-105 cursor-pointer ${
                      isDark
                        ? 'bg-[#4A7CFF] text-white hover:bg-[#5B8FFF]'
                        : 'bg-[#4A7CFF] text-white hover:bg-[#5B8FFF]'
                    }`}
                    style={{
                      boxShadow: 'rgba(74, 124, 255, 0.3) 0px 4px 12px'
                    }}
                    aria-label={`Start practicing ${card.title}`}
                  >
                    Start {card.title}
                  </button>
                </div>
              </div>
            </div>
          ))}

        </div>
      </div>

      <style jsx>{`
        @keyframes morphShape {
          0%, 100% {
            border-radius: 32px;
          }
          50% {
            border-radius: 40px;
          }
        }

        .drop-card {
          animation: morphShape 4s infinite alternate ease-in-out;
        }
      `}</style>
    </section>
  );
}
