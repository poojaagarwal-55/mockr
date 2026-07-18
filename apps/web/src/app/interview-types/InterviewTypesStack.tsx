"use client";

import { useRef, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { gsap, ScrollTrigger } from "@/hooks/useGsap";

const INTERVIEW_TYPES_DATA = [
  {
    id: "ai",
    label: "AI Interview",
    title: "AI Interview",
    tagline: "Your 24/7 AI interviewer adapts in real-time, evaluates your code, and scores answers against industry rubrics.",
    image: "/expert_interview_doodle.png",
    route: "/interviews/ai",
    color: "rgb(255,65,108)",
    colorRgb: "255, 65,108",
    available: true,
  },
  {
    id: "peer",
    label: "Peer to Peer",
    title: "Peer to Peer",
    tagline: "Practice with a real peer at your level, take turns as interviewer and interviewee, sharpen communication, and get genuine human feedback.",
    image: "/peer_interview_doodle.png",
    route: "/interviews/peer",
    color: "rgb(124,111,255)",
    colorRgb: "124,111,255",
    available: true,
  },
  {
    id: "expert",
    label: "With Expert",
    title: "With Expert",
    tagline: "Book a 1-on-1 with a FAANG interviewer get insider tips, deep-dive feedback on your weaknesses, and an actionable improvement plan.",
    image: "/ai_interview_doodle_v2.png",
    route: "/interviews/expert",
    color: "rgb(34,197,94)",
    colorRgb: "34,197,94",
    available: false,
  },
];

export default function InterviewTypesStack({ isDark = false }: { isDark?: boolean }) {
  const router = useRouter();
  const sectionRef = useRef<HTMLElement>(null);
  const cardRefs = useRef<(HTMLDivElement | null)[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const isMountedRef = useRef(true);
  const scrollTriggerRef = useRef<ScrollTrigger | null>(null);
  const timelineRef = useRef<gsap.core.Timeline | null>(null);

  useEffect(() => {
    isMountedRef.current = true;

    const section = sectionRef.current;
    const cards = cardRefs.current.filter(Boolean);

    if (!section || cards.length === 0) return;

    const totalCards = cards.length;
    const yOffset = 32;
    const scaleStep = 0.05;

    // Register ScrollTrigger plugin
    gsap.registerPlugin(ScrollTrigger);

    // Initial stacking setup
    cards.forEach((card, i) => {
      if (!card) return;
      const distanceFromFront = totalCards - 1 - i;
      gsap.set(card, {
        y: -distanceFromFront * yOffset,
        scale: 1 - distanceFromFront * scaleStep,
        zIndex: i,
      });
    });

    // Create timeline with ScrollTrigger
    const tl = gsap.timeline({
      scrollTrigger: {
        trigger: section,
        start: "top top",
        end: `+=${totalCards * 150}%`,
        pin: true,
        scrub: 2,
        anticipatePin: 2,
        pinSpacing: true,
        onUpdate: (self) => {
          if (!isMountedRef.current) return;
          // Update active index based on scroll progress
          const progress = self.progress;
          const newIndex = Math.min(totalCards - 1, Math.floor(progress * totalCards));
          setActiveIndex(newIndex);
        },
      },
    });

    timelineRef.current = tl;
    scrollTriggerRef.current = tl.scrollTrigger || null;

    // Animate each card dropping off
    for (let i = totalCards - 1; i >= 0; i--) {
      const label = `drop-${i}`;
      const card = cards[i];
      if (!card) continue;

      // Drop current card
      tl.to(
        card,
        {
          y: window.innerHeight,
          rotation: gsap.utils.random(-20, 20),
          ease: "power2.in",
        },
        label
      );

      // Move remaining cards forward
      for (let j = 0; j < i; j++) {
        const remainingCard = cards[j];
        if (!remainingCard) continue;
        
        const newDistanceFromFront = i - 1 - j;
        tl.to(
          remainingCard,
          {
            y: -newDistanceFromFront * yOffset,
            scale: 1 - newDistanceFromFront * scaleStep,
            ease: "power2.out",
            duration: 0.4,
          },
          `${label}+=0.3`
        );
      }
    }

    return () => {
      isMountedRef.current = false;

      // Cleanup in correct order
      try {
        // First, kill all tweens on cards
        cards.forEach(card => {
          if (card) {
            gsap.killTweensOf(card);
          }
        });

        // Then kill the ScrollTrigger
        if (scrollTriggerRef.current) {
          scrollTriggerRef.current.kill(true);
          scrollTriggerRef.current = null;
        }

        // Finally kill the timeline
        if (timelineRef.current) {
          timelineRef.current.kill();
          timelineRef.current = null;
        }

        // Clean up any orphaned ScrollTriggers
        ScrollTrigger.getAll().forEach((st) => {
          if (st.trigger === section) {
            st.kill(true);
          }
        });
      } catch (error) {
        // Silently catch any cleanup errors
        console.warn("ScrollTrigger cleanup warning:", error);
      }
    };
  }, []);

  const activeType = INTERVIEW_TYPES_DATA[activeIndex];

  return (
    <>
      {/* Header - Outside the pinned section */}
      <div className={`w-full text-center pt-16 pb-8 transition-colors duration-500 ${
        isDark ? "bg-[#222222]" : "bg-[#f4f5f7]"
      }`}>
        <h2
          className={`text-[2rem] md:text-[2.6rem] font-black tracking-tight leading-[1.05] transition-colors duration-500 ${
            isDark ? "text-white" : "text-[#111111]"
          }`}
        >
          Interview <span className="text-[#4A7CFF]">Types</span>
        </h2>
        <p
          className={`text-[15px] font-medium mt-3 leading-relaxed transition-colors duration-300 ${
            isDark ? "text-[#999]" : "text-[#666]"
          }`}
        >
          Choose the format that fits your goals from AI-powered sessions to real human experts.
        </p>
      </div>

      {/* Pinned Section - Only the cards */}
      <section
        ref={sectionRef}
        className={`relative w-full min-h-screen overflow-hidden transition-colors duration-500 ${
          isDark ? "bg-[#222222]" : "bg-[#f4f5f7]"
        }`}
      >
        {/* Main Content - Left Label + Right Cards */}
        <div className="relative w-full h-screen flex items-center justify-center px-4 md:px-8">
          <div className="max-w-[1200px] w-full mx-auto flex flex-col md:flex-row items-center justify-between gap-8 md:gap-16">
            
            {/* Left Side - Switching Labels */}
            <div className="flex-1 max-w-md">
              <div className="space-y-6">
                {INTERVIEW_TYPES_DATA.map((type, idx) => (
                  <div
                    key={type.id}
                    className={`transition-all duration-500 ${
                      idx === activeIndex ? "opacity-100 scale-100" : "opacity-30 scale-95"
                    }`}
                  >
                    <div className="flex items-start gap-4">
                      <span
                        className="text-[13px] font-black tracking-widest mt-1 shrink-0"
                        style={{ color: idx === activeIndex ? "#4A7CFF" : "#aab0c0" }}
                      >
                        {String(idx + 1).padStart(2, "0")}.
                      </span>
                      <div className="flex-1">
                        <h3
                          className={`text-[22px] md:text-[28px] font-extrabold tracking-tight transition-all duration-500 ${
                            isDark
                              ? idx === activeIndex
                                ? "text-[#e5e5e5]"
                                : "text-[#555]"
                              : idx === activeIndex
                              ? "text-[#111]"
                              : "text-[#888]"
                          }`}
                        >
                          {type.label}
                        </h3>
                        {idx === activeIndex && (
                          <p
                            className={`text-[15px] font-medium leading-[1.65] mt-3 transition-opacity duration-500 ${
                              isDark ? "text-[#999]" : "text-[#666]"
                            }`}
                          >
                            {type.tagline}
                          </p>
                        )}
                        {idx === activeIndex && (
                          <div className="mt-5">
                            {type.available ? (
                              <button
                                onClick={() => router.push(type.route)}
                                className={`px-6 py-2.5 rounded-xl font-bold text-[13px] transition-colors flex items-center gap-2 ${
                                  isDark
                                    ? "bg-[#025cd7] text-white hover:bg-[#0250c0]"
                                    : "bg-[#111] text-white hover:bg-[#333]"
                                }`}
                              >
                                Start {type.label}
                                <svg
                                  width="16"
                                  height="16"
                                  viewBox="0 0 18 18"
                                  fill="none"
                                >
                                  <path
                                    d="M4 9h10M10 5l4 4-4 4"
                                    stroke="currentColor"
                                    strokeWidth="2"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                  />
                                </svg>
                              </button>
                            ) : (
                              <span
                                className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl font-bold text-[12px] uppercase tracking-wider transition-colors duration-300 ${
                                  isDark
                                    ? "bg-[#2d3142] text-[#666]"
                                    : "bg-[#f0f3f8] text-[#888]"
                                }`}
                              >
                                <span
                                  className={`w-1.5 h-1.5 rounded-full ${
                                    isDark ? "bg-[#888]" : "bg-[#bbb]"
                                  }`}
                                />
                                Coming Soon
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Right Side - Stacked Cards */}
            <div className="relative w-full md:w-[500px] lg:w-[560px] h-[400px] md:h-[500px] shrink-0">
              {INTERVIEW_TYPES_DATA.map((card, idx) => (
                <div
                  key={card.id}
                  ref={(el) => {
                    cardRefs.current[idx] = el;
                  }}
                  className="absolute inset-0 rounded-[28px] overflow-hidden will-change-transform shadow-[0_20px_60px_rgba(0,0,0,0.12)]"
                  style={{
                    backgroundColor: isDark ? "#1e293b" : card.id === "ai" ? "#eaf2ff" : card.id === "peer" ? "#eff4ff" : "#f3f7ff",
                    backfaceVisibility: "hidden",
                  }}
                >
                  <Image
                    src={card.image}
                    alt={card.label}
                    fill
                    className={`object-cover ${
                      card.id === "ai" ? "object-top" : "object-center"
                    }`}
                    sizes="(max-width: 768px) 100vw, 560px"
                    priority={idx === 0}
                  />
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
