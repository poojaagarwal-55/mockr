"use client";

import Link from "next/link";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { ForceLight } from "@/components/force-light";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/auth-context";
import { gsap, ScrollTrigger } from "@/hooks/useGsap";
import HeroAnimation from "./HeroAnimation";
import InterviewTypesArc from "./InterviewTypesArc";
import InterviewTypesStack from "./InterviewTypesStack";

const BLUE = "#4A7CFF";
const YELLOW = "#FFE500";

// ─── Interview Type Data ────────────────────────────────────────────
const INTERVIEW_TYPES = [
  {
    id: "ai",
    label: "AI Interview",
    tagline: "Your 24/7 AI interviewer adapts in real-time, evaluates your code, and scores answers against industry rubrics.",
    description:
      "Practice with an intelligent AI interviewer that adapts in real-time. It evaluates your code, asks contextual follow-ups, and scores your answers against industry rubrics exactly like a real onsite.",
    tags: ["Full Interview", "Live Coding", "Behavioral", "System Design"],
    href: "/interviews/ai",
    available: true,
    badge: null,
    image: "/ai_interview_doodle_v2.png",
    bg: "#eaf2ff",
    accent: BLUE,
    iconColor: "#ffffff",
    num: "01",
    icon: (
      <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
        <rect width="28" height="28" rx="8" fill={BLUE} />
        <path
          d="M14 7v7l4 2"
          stroke="white"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle cx="14" cy="14" r="8" stroke="white" strokeWidth="1.5" strokeDasharray="2 2" />
      </svg>
    ),
    bullets: [
      "Real-time code evaluation in 40+ languages",
      "Adaptive follow-up questions based on your answers",
      "Rubric-scored feedback report after each session",
      "Voice and text interview modes",
    ],
  },
  {
    id: "peer",
    label: "Peer to Peer",
    tagline: "Practice with a real peer at your level, take turns as interviewer and interviewee, sharpen communication, and get genuine human feedback.",
    description:
      "Interview with a real person at your level. Take turns playing interviewer and interviewee gain perspective from both sides, and sharpen your communication with genuine human feedback.",
    tags: ["Live Session", "Collaborative", "Real Feedback", "Turn-based"],
    href: "/interviews/peer",
    available: true,
    badge: null,
    image: "/peer_interview_doodle.png",
    bg: "#eff4ff",
    accent: "#7C6FFF",
    iconColor: "#ffffff",
    num: "02",
    icon: (
      <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
        <rect width="28" height="28" rx="8" fill="#7C6FFF" />
        <circle cx="10" cy="11" r="3" stroke="white" strokeWidth="1.5" />
        <circle cx="18" cy="11" r="3" stroke="white" strokeWidth="1.5" />
        <path
          d="M4 21c0-3.3 2.7-6 6-6h8c3.3 0 6 2.7 6 6"
          stroke="white"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
      </svg>
    ),
    bullets: [
      "Matched with a candidate at your experience level",
      "Structured turn-based interview format",
      "Build confidence with real human interaction",
      "Schedule sessions at your convenience",
    ],
  },
  {
    id: "expert",
    label: "With Expert",
    tagline: "Book a 1-on-1 with a FAANG interviewer get insider tips, deep-dive feedback on your weaknesses, and an actionable improvement plan.",
    description:
      "Book a 1-on-1 session with a seasoned interviewer from a top tech company. Get bespoke mentorship, insider tips on what FAANG interviewers actually look for, and actionable guidance to accelerate your journey.",
    tags: ["1-on-1 Session", "FAANG Expert", "Mentorship", "Career Guidance"],
    href: "/interviews/expert",
    available: true,
    badge: null,
    image: "/expert_interview_doodle.png",
    bg: "#f3f7ff",
    accent: "#22C55E",
    iconColor: "#ffffff",
    num: "03",
    icon: (
      <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
        <rect width="28" height="28" rx="8" fill="#22C55E" />
        <path
          d="M14 6l2 4 5 .5-3.5 3.5.8 5L14 17l-4.3 2 .8-5L7 10.5 12 10z"
          stroke="white"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
      </svg>
    ),
    bullets: [
      "Interviewers from Google, Meta, Amazon & more",
      "Deep-dive into your specific weaknesses",
      "Resume review included in every session",
      "Actionable improvement plan delivered post-session",
    ],
  },
];

function InterviewTypeSwitcher({ types, onCTA, isDark = false }: { types: any[], onCTA: (available: boolean, href: string | null) => void, isDark?: boolean }) {
  const [activeIndex, setActiveIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const imageWrapperRef = useRef<HTMLDivElement>(null);
  const prevIndexRef = useRef(0);
  const imgRefs = useRef<(HTMLDivElement | null)[]>([]);
  // Track scroll direction
  const scrollDirRef = useRef<1 | -1>(1);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // Directional slide transition — slide up when scrolling down, slide down when scrolling up
  useEffect(() => {
    const prev = prevIndexRef.current;
    const next = activeIndex;
    if (prev === next) return;
    prevIndexRef.current = next;

    if (!mountedRef.current) return;
    const incoming = imgRefs.current[next];
    if (!incoming || !incoming.isConnected) return;

    // Determine slide direction based on scroll direction
    // scrollDirRef: 1 = scrolling down, -1 = scrolling up
    // When scrolling down (1), slide up from bottom (100%)
    // When scrolling up (-1), slide down from top (-100%)
    const fromY = scrollDirRef.current === 1 ? "100%" : "-100%";

    // Kill all active tweens
    imgRefs.current.forEach(el => {
      if (el && el.isConnected) gsap.killTweensOf(el);
    });

    // Reset all images to their base state
    imgRefs.current.forEach((el, i) => {
      if (el && el.isConnected) {
        if (i === next) {
          // Incoming image: start from off-screen
          gsap.set(el, { y: fromY, zIndex: 10 });
        } else if (i === prev) {
          // Outgoing image: keep at 0 with lower z-index
          gsap.set(el, { y: "0%", zIndex: 1 });
        } else {
          // Other images: hidden
          gsap.set(el, { y: "0%", zIndex: 0 });
        }
      }
    });

    // Animate incoming image sliding in over the existing image
    gsap.to(incoming, {
      y: "0%",
      duration: 0.65,
      ease: "power2.inOut",
      onComplete: () => {
        if (!mountedRef.current) return;
        // After animation, keep incoming on top and hide others
        imgRefs.current.forEach((el, i) => {
          if (el && el.isConnected) {
            gsap.set(el, { zIndex: i === next ? 10 : 0 });
          }
        });
      }
    });
  }, [activeIndex]);

  // ScrollTrigger pin — smooth lock with no lag
  useEffect(() => {
    if (!containerRef.current) return;
    const st = ScrollTrigger.create({
      trigger: containerRef.current,
      pin: true,
      pinSpacing: true,
      anticipatePin: 0,
      start: "top top",
      end: "+=200%",
      scrub: 0.5,
      onUpdate: (self) => {
        scrollDirRef.current = self.direction as 1 | -1;
        const buffer = 0.06;
        const adjusted = Math.max(0, (self.progress - buffer) / (1 - buffer));
        const newIndex = Math.min(types.length - 1, Math.floor(adjusted * types.length));
        setActiveIndex(newIndex);
      },
    });

    // Throttle fast wheel scrolls only while this section is pinned
    const SLOW_STEP = 80; // max px per wheel tick inside this section
    const cooldownRef = { current: false };

    const onWheel = (e: WheelEvent) => {
      // Only intercept when the section is currently pinned (active)
      if (!st.isActive) return;

      const delta = e.deltaY;
      if (Math.abs(delta) <= SLOW_STEP) return; // already slow enough

      e.preventDefault();
      e.stopPropagation();

      if (cooldownRef.current) return;
      cooldownRef.current = true;

      // Scroll by a fixed slow amount in the same direction
      window.scrollBy({ top: delta > 0 ? SLOW_STEP : -SLOW_STEP, behavior: "auto" });

      // Short cooldown to prevent stacking
      setTimeout(() => { cooldownRef.current = false; }, 60);
    };

    window.addEventListener("wheel", onWheel, { passive: false });

    return () => {
      st.kill();
      window.removeEventListener("wheel", onWheel);
    };
  }, [types.length]);

  const activeType = types[activeIndex];
  const taglineRef = useRef<HTMLParagraphElement>(null);

  // Staggered word animation for tagline with proper wrapping
  useEffect(() => {
    if (!activeType || !taglineRef.current) return;

    const text = taglineRef.current;
    const originalText = activeType.tagline;
    const words = originalText.split(' ');
    
    // Clear and rebuild with word spans
    text.textContent = '';
    const wordSpans = words.map((word: string, idx: number) => {
      const span = document.createElement('span');
      span.className = 'word';
      span.textContent = word + (idx < words.length - 1 ? ' ' : '');
      span.style.cssText = 'opacity: 0; transform: translateY(8px); display: inline; transition: none;';
      text.appendChild(span);
      return span;
    });

    // Animate each word with stagger
    wordSpans.forEach((span: HTMLSpanElement, i: number) => {
      setTimeout(() => {
        span.style.transition = `opacity 0.15s ease, transform 0.15s ease`;
        span.style.opacity = '1';
        span.style.transform = 'translateY(0)';
      }, i * 40);
    });
  }, [activeIndex, types]);

  return (
    <div ref={containerRef} className="max-w-[1140px] mx-auto will-change-transform relative">

      {/* Blue gradient — only in light mode */}
      {!isDark && (
        <>
          <div className="absolute top-0 -left-[300px] w-[600px] h-[400px] pointer-events-none" style={{
            background: "radial-gradient(ellipse at 0% 0%, rgba(74,124,255,0.28) 0%, rgba(74,124,255,0.12) 45%, transparent 72%)",
            filter: "blur(50px)",
          }} />
          {/* Soft circle blob — right edge only */}
          <div className="absolute -right-[300px] top-[5%] w-[520px] h-[520px] rounded-full pointer-events-none" style={{
            background: "radial-gradient(circle, rgba(220,225,255,0.7) 0%, rgba(220,225,255,0.3) 50%, transparent 75%)",
          }} />
        </>
      )}

      {/* Centered heading */}
      <div className="text-center mb-10 mt-8">
        <h2 className="text-[2rem] md:text-[2.5rem] font-extrabold tracking-tight" style={{ color: BLUE }}>
          Interview Types
        </h2>
        <p className={`text-[15px] font-medium mt-3 leading-relaxed transition-colors duration-300 ${
          isDark ? 'text-[#999]' : 'text-[#666]'
        }`}>
          Choose the format that fits your goals from AI-powered sessions to real human experts.
        </p>
      </div>

      <div className="flex flex-col lg:flex-row gap-10 lg:gap-16 items-stretch mt-12">

        {/* ── Left: numbered accordion list ── */}
        <div className="flex-1 flex flex-col gap-5">
          {types.map((type, idx) => {
            const isActive = idx === activeIndex;
            return (
              <div
                key={type.id}
                role="button"
                tabIndex={0}
                onClick={() => {
                  const st = ScrollTrigger.getAll().find(s => s.trigger === containerRef.current);
                  if (st) {
                    const buffer = 0.06;
                    const targetProgress = buffer + (1 - buffer) * ((idx + 0.5) / types.length);
                    window.scrollTo({ top: st.start + (st.end - st.start) * targetProgress, behavior: "smooth" });
                  } else {
                    setActiveIndex(idx);
                  }
                }}
                onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.click(); }}
                className={`w-full text-left rounded-[20px] px-7 py-7 transition-all duration-300 cursor-pointer relative ${
                  isActive
                    ? ""
                    : (isDark
                        ? "bg-transparent hover:bg-[#1e293b]/60"
                        : "bg-transparent hover:bg-white/60")
                }`}
                style={isActive ? {
                  background: isDark
                    ? 'linear-gradient(to bottom, #1e293b 0%, #1e293b 50%, rgba(30,41,59,0.7) 75%, rgba(34,34,34,0.3) 90%, #222222 100%)'
                    : 'linear-gradient(to bottom, #ffffff 0%, #ffffff 50%, rgba(255,255,255,0.7) 70%, rgba(248,249,251,0.4) 85%, rgba(244,245,247,0.2) 95%, #f4f5f7 100%)'
                } : undefined}
              >
                <div className="flex items-start gap-4">
                  <span className="text-[13px] font-black tracking-widest mt-1 shrink-0" style={{ color: isActive ? BLUE : "#aab0c0" }}>
                    {String(idx + 1).padStart(2, "0")}.
                  </span>
                  <div className="flex-1">
                    <h3 className={`text-[22px] font-extrabold tracking-tight transition-all duration-700 ${
                      isDark 
                        ? (isActive ? "text-[#e5e5e5]" : "text-[#888]")
                        : (isActive ? "text-[#111]" : "text-[#555]")
                    }`}>
                      {type.label}
                    </h3>
                    {isActive && (
                      <>
                        <p 
                          ref={taglineRef}
                          className={`text-[15px] font-medium leading-[1.65] mt-3 max-w-sm transition-opacity duration-300 ${
                            isDark ? 'text-[#999]' : 'text-[#666]'
                          }`} 
                          style={{ opacity: isActive ? 1 : 0 }}
                        >
                          {type.tagline}
                        </p>
                        <div className="mt-5" style={{ opacity: isActive ? 1 : 0, transform: isActive ? 'translateY(0)' : 'translateY(8px)', transition: 'all 1s ease-out 0.4s' }}>
                          {type.available ? (
                            <button
                              onClick={(e) => { e.stopPropagation(); onCTA(type.available, type.href); }}
                              className={`px-6 py-2.5 rounded-xl font-bold text-[13px] transition-colors flex items-center gap-2 ${
                                isDark
                                  ? 'bg-[#025cd7] text-white hover:bg-[#0250c0]'
                                  : 'bg-[#111] text-white hover:bg-[#333]'
                              }`}
                            >
                              Start {type.label}
                              <svg width="16" height="16" viewBox="0 0 18 18" fill="none"><path d="M4 9h10M10 5l4 4-4 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
                            </button>
                          ) : (
                            <span className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl font-bold text-[12px] uppercase tracking-wider transition-colors duration-300 ${
                              isDark ? 'bg-[#2d3142] text-[#666]' : 'bg-[#f0f3f8] text-[#888]'
                            }`}>
                              <span className={`w-1.5 h-1.5 rounded-full ${isDark ? 'bg-[#888]' : 'bg-[#bbb]'}`} />
                              Coming Soon
                            </span>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* ── Right: stacked images with slide-up transition ── */}
        <div className="w-full lg:w-[520px] xl:w-[560px] shrink-0 self-stretch">
          <div
            ref={imageWrapperRef}
            className="relative w-full h-full min-h-[420px] rounded-[28px] overflow-hidden shadow-[0_20px_60px_rgba(0,0,0,0.12)]"
          >
            {types.map((type, idx) => (
              <div
                key={type.id}
                ref={el => { imgRefs.current[idx] = el; }}
                className="absolute inset-0"
                style={{
                  zIndex: idx === 0 ? 2 : 1,
                  backgroundColor: type.bg,
                }}
              >
                <Image
                  src={type.image}
                  alt={type.label}
                  fill
                  className={`object-cover ${type.id === "ai" ? "object-top" : "object-center"}`}
                  sizes="(max-width: 768px) 100vw, 560px"
                />
              </div>
            ))}
          </div>
        </div>

      </div>
    </div>
  );
}

// ─── Main Page Component ────────────────────────────────────────────
export default function InterviewTypesPage() {
  const router = useRouter();
  const { session } = useAuth();
  const heroRef = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    setMounted(true);
    
    // Check dark mode from localStorage (synced with landing page)
    const darkMode = localStorage.getItem("practers-dark") === "true";
    setIsDark(darkMode);
    document.documentElement.dataset.dark = darkMode ? "true" : "";

    // GSAP Animations for cards — direct tweens, no gsap.context to avoid removeChild errors
    const tweens: gsap.core.Tween[] = [];
    const scrollTriggers: ScrollTrigger[] = [];

    // ── "We Offer Best Services" section — slow fade in on load ──
    const featuresInner = document.querySelector("#features-inner");
    if (featuresInner) {
      tweens.push(gsap.fromTo(featuresInner,
        { opacity: 0 },
        { opacity: 1, duration: 3.5, ease: "power1.out", delay: 0.3 }
      ));
    }

    // ── "Top Interview Tracks" cards ──
    const trackCards = document.querySelectorAll(".track-card");
    if (trackCards.length) {
      tweens.push(gsap.fromTo(trackCards,
        { opacity: 0, y: 60, scale: 0.94 },
        {
          opacity: 1, y: 0, scale: 1,
          duration: 0.7, stagger: 0.15, ease: "back.out(1.2)",
          scrollTrigger: { trigger: ".track-cards-grid", start: "top 80%" },
        }
      ));
    }

    // ── "Core Benefits" cards ── (animation removed)

    return () => {
      tweens.forEach(t => t.kill());
      scrollTriggers.forEach(st => st.kill());
    };
  }, []);

  const handleCTA = (available: boolean, href: string | null) => {
    if (!available || !href) return;
    if (session) {
      router.push(href);
    } else {
      router.push("/login");
    }
  };

  return (
    <ForceLight>
      {/* ── Page shell ── */}
      <div
        className={`min-h-screen antialiased overflow-x-hidden transition-colors duration-300 ${
          isDark 
            ? 'bg-[#222222] text-[#e5e5e5]' 
            : 'bg-[#f4f5f7] text-[#1a1a1a]'
        }`}
        style={{ fontFamily: "'Inter', sans-serif" }}
      >
        {/* ── Sticky Header ── */}
        <header className={`sticky top-0 z-40 w-full backdrop-blur-md border-b transition-colors duration-300 ${
          isDark
            ? 'bg-[#222222]/90 border-[#2d3142]'
            : 'bg-[#f4f5f7]/90 border-[#e8e8e8]'
        }`}>
          <div className="max-w-[1200px] mx-auto px-6 h-16 flex items-center justify-between">
            <Link href="/">
              <Image 
                src="/logo_big.png"
                alt="Mockr" 
                width={180} 
                height={51} 
                className="h-10 w-auto" 
                style={isDark ? { filter: 'brightness(0) saturate(100%) invert(27%) sepia(98%) saturate(2618%) hue-rotate(201deg) brightness(98%) contrast(101%)' } : {}}
              />
            </Link>
            <nav className="hidden md:flex items-center gap-9">
              {[
                { label: "Interviews", href: "/ai-mock-interview", isHash: false },
                { label: "Questions", href: "/interview-questions", isHash: false },
                { label: "FAQ", href: "/faq", isHash: false },
                { label: "Blog", href: "/blog", isHash: false }
              ].map((item) => (
                <a
                  key={item.label}
                  className={`text-[15px] font-medium tracking-tight transition-colors cursor-pointer ${
                    isDark
                      ? 'text-[#e5e5e5] hover:text-[#4A7CFF]'
                      : 'text-[#333] hover:text-[#4A7CFF]'
                  }`}
                  href={item.href}
                  onClick={(e) => {
                    if (item.isHash) {
                      e.preventDefault();
                      const target = document.querySelector(item.href);
                      if (target) {
                        const y = target.getBoundingClientRect().top + window.scrollY - 100;
                        window.scrollTo({ top: y, behavior: 'smooth' });
                      }
                    }
                  }}
                >
                  {item.label}
                </a>
              ))}
            </nav>
            <div className="flex items-center gap-3">
              <Link href="/login" className={`hidden sm:block text-sm px-4 py-2 ${
                isDark ? 'text-[#e5e5e5]' : 'text-[#1a1a1a]'
              }`}>Log In</Link>
              <Link href="/login?tab=signup" className={`text-sm px-5 py-2.5 rounded-full transition-colors ${
                isDark
                  ? 'bg-[#4A7CFF] text-white hover:bg-[#5B8FFF]'
                  : 'bg-[#1a1a1a] text-white hover:bg-[#333]'
              }`}>
                Get Started
              </Link>
            </div>
          </div>
        </header>

        {/* ── Hero (animated) ── */}
        <HeroAnimation isDark={isDark} />

        {/* ── We Offer Best Services ── */}
        <section className="scroll-mt-28 relative pt-96 md:pt-40 pb-6 md:pb-8 overflow-x-clip border-none z-0 transition-colors duration-300" id="features" style={{
          background: isDark 
            ? "linear-gradient(180deg, #222222 0%, #222222 100%)"
            : "transparent"
        }}>
          {/* Blue tint blob — only in light mode */}
          {!isDark && (
            <div className="absolute top-0 left-0 w-[600px] h-[400px] pointer-events-none" style={{
              background: "radial-gradient(ellipse at 0% 0%, rgba(74,124,255,0.28) 0%, rgba(74,124,255,0.12) 45%, transparent 72%)",
              filter: "blur(50px)",
            }} />
          )}
          
          {/* Soft circle blob — right edge only in dark mode */}
          {isDark && (
            <div className="absolute -right-[200px] top-[10%] w-[500px] h-[500px] rounded-full pointer-events-none" style={{
              background: "radial-gradient(circle, rgba(2,92,215,0.15) 0%, rgba(2,92,215,0.08) 40%, transparent 70%)",
              filter: "blur(60px)",
            }} />
          )}
          <div className="max-w-[1260px] mx-auto px-2 md:px-6">
            <div id="features-inner" className={`relative rounded-xl md:rounded-3xl overflow-hidden transition-colors duration-300 ${
              isDark ? 'bg-[#2a2a2a]' : 'bg-white'
            }`} style={{ opacity: 0 }}>
              <div className="p-10 md:p-14 relative">

                <h2 className={`text-[2rem] md:text-[2.6rem] font-black tracking-tight mb-8 -mt-2 transition-colors duration-300 ${
                  isDark ? 'text-[#e5e5e5]' : 'text-[#111]'
                }`}>Why Choose <span style={{ color: BLUE }}>Mockr</span></h2>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 md:gap-7 mt-12">
                  {[
                    {
                      title: "Smart Interviews",
                      desc: "Practice with AI, peers, or experts tailored to every stage of your preparation.",
                      img: "/smart-removebg-preview.png",
                    },
                    {
                      title: "Question Bank",
                      desc: "Hundreds of curated questions across DSA, system design, and behavioural topics.",
                      img: "/question_bank-removebg-preview.png",
                    },
                    {
                      title: "AI Tutor",
                      desc: "Get instant help, clear doubts, and learn concepts faster with your personal AI guide.",
                      img: "/AI_tutor_new.png",
                    },
                    {
                      title: "Resume Manager",
                      desc: "Create, refine, and score your resume with AI to stand out in every job application.",
                      img: "/resume_manager-removebg.png",
                    }
                  ].map((card, idx) => (
                    <div
                      key={idx}
                      className={`service-card w-full rounded-[20px] flex flex-col items-center pt-12 pb-10 px-6 shadow-[0_2px_12px_rgba(0,0,0,0.05)] transition-all duration-200 hover:-translate-y-[5px] cursor-pointer ${
                        isDark 
                          ? 'bg-[#2f2b25] hover:shadow-[2px_16px_20px_rgba(74,124,255,0.35)]'
                          : 'bg-[#f9fafb] hover:shadow-[2px_16px_20px_rgba(74,124,255,0.28)]'
                      }`}
                    >
                      {/* Image — natural aspect ratio, consistent height */}
                      <div className="h-[160px] flex items-center justify-center mb-6 shrink-0 rounded-xl p-2">
                        <img
                          src={card.img}
                          alt={card.title}
                          className={card.title === "AI Tutor" ? "h-[170px] w-auto max-w-[200px] object-contain" : "h-[150px] w-auto max-w-[180px] object-contain"}
                        />
                      </div>
                      {/* Text — fixed min-height so all cards align */}
                      <div className="text-center">
                        <h3 className={`text-[16px] font-extrabold mb-2 tracking-[-0.02em] transition-colors duration-300 ${
                          isDark ? 'text-[#e5e5e5]' : 'text-[#111]'
                        }`}>
                          {card.title}
                        </h3>
                        <p className={`text-[13px] leading-[1.65] font-medium transition-colors duration-300 ${
                          isDark ? 'text-[#999]' : 'text-[#6b7280]'
                        }`}>
                          {card.desc}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
                
                {/* Bottom gradient to merge with next section */}
                <div className="absolute bottom-0 left-0 right-0 h-40 pointer-events-none" style={{
                  background: isDark 
                    ? 'linear-gradient(to bottom, transparent 0%, rgba(34,34,34,0.3) 40%, rgba(34,34,34,0.7) 70%, #222222 100%)'
                    : 'linear-gradient(to bottom, transparent 0%, rgba(244,245,247,0.3) 40%, rgba(244,245,247,0.7) 70%, #f4f5f7 100%)'
                }} />
              </div>
            </div>
          </div>
        </section>

        {/* ── Interview Types Arc (Semi-circular Glossy Cards) ── */}
        {/* Moved below tab switcher */}

        {/* ── Top Interview Tracks ── */}

        {/* ── Interview Type Cards — Stacked Card Drop Animation ── */}
        <InterviewTypesStack isDark={isDark} />

        {/* ── Interview Types Arc (Semi-circular Glossy Cards) ── */}
        <InterviewTypesArc isDark={isDark} />

        {/* ── Core Benefits Section ── */}
        <section className={`relative py-12 overflow-hidden transition-colors duration-300 ${
          isDark ? 'bg-[#222222]' : 'bg-[#f4f5f7]'
        }`}>
          <div className="max-w-[1100px] mx-auto px-6">
            <div className="text-center mb-16 max-w-2xl mx-auto">
              <p className="text-[12px] font-extrabold tracking-[0.12em] uppercase mb-3" style={{ color: BLUE }}>
                CORE BENEFITS
              </p>
              <h2 className={`text-[2rem] md:text-[2.6rem] font-black tracking-tight leading-[1.15] mb-5 transition-colors duration-300 ${
                isDark ? 'text-[#e5e5e5]' : 'text-[#111]'
              }`}>
                We Offer <span style={{ color: BLUE }}>Best Services</span>
              </h2>
              <p className={`text-[15px] md:text-[17px] font-medium leading-relaxed transition-colors duration-300 ${
                isDark ? 'text-[#999]' : 'text-[#555]'
              }`}>
                Top candidates trust us to land their dream roles. Here’s why:
              </p>
            </div>

            {/* ── Staggered Pinned Cards Grid (Dribbble Inspired) ── */}
            <div className="relative max-w-[900px] mx-auto w-full z-10 pb-16 benefit-cards-grid">
              
              {/* Connecting Strings SVG */}
              <svg className="absolute inset-0 w-full h-full pointer-events-none -z-10 hidden md:block">
                <line x1="25%" y1="15%" x2="75%" y2="35%" stroke="#cbd5e1" strokeWidth="2" strokeDasharray="8 8" />
                <line x1="75%" y1="35%" x2="25%" y2="65%" stroke="#cbd5e1" strokeWidth="2" strokeDasharray="8 8" />
                <line x1="25%" y1="65%" x2="75%" y2="85%" stroke="#cbd5e1" strokeWidth="2" strokeDasharray="8 8" />
              </svg>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-16 gap-y-20 md:gap-y-24">
                {[
                  {
                    id: 1,
                    title: "10x More Practice Reps",
                    desc: "Practice unlimited rounds with AI, no scheduling, no waiting. Get consistent reps across DSA, system design, and behavioural rounds whenever you want.",
                    theme: { bgInner: "#fdf4e7", iconColor: "#c2410c", pinLight: "#fb923c", pinDark: "#c2410c", darkBg: "#4a3520" },
                    rotate: "-rotate-[3deg]",
                    posClass: "",
                    innerPad: "p-6 md:p-8",
                    icon: (
                      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="17 1 21 5 17 9" />
                        <path d="M3 11V9a4 4 0 0 1 4-4h14" />
                        <polyline points="7 23 3 19 7 15" />
                        <path d="M21 13v2a4 4 0 0 1-4 4H3" />
                      </svg>
                    )
                  },
                  {
                    id: 2,
                    title: "Real-time AI Feedback",
                    desc: "Instant, actionable feedback on clarity, depth, and delivery not just a score.",
                    theme: { bgInner: "#fef2f2", iconColor: "#b91c1c", pinLight: "#f87171", pinDark: "#b91c1c", darkBg: "#4a2525" },
                    rotate: "rotate-[3deg]",
                    posClass: "left-2 md:left-8",
                    innerPad: "p-6 md:p-8",
                    icon: (
                      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                        <path d="M13 8L9 12 7 10" />
                      </svg>
                    )
                  },
                  {
                    id: 3,
                    title: "All Interview Types",
                    desc: "DSA, System Design, HR, Behavioural, and Group Discussion — every interview format covered in one place, so you never have to switch platforms.",
                    theme: { bgInner: "#f0fdf4", iconColor: "#15803d", pinLight: "#4ade80", pinDark: "#15803d", darkBg: "#254a30" },
                    rotate: "rotate-[3deg]",
                    posClass: "",
                    innerPad: "p-6 md:p-8",
                    icon: (
                      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polygon points="12 2 2 7 12 12 22 7 12 2" />
                        <polyline points="2 12 12 17 22 12" />
                        <polyline points="2 17 12 22 22 17" />
                      </svg>
                    )
                  },
                  {
                    id: 4,
                    title: "Track Your Growth",
                    desc: "Monitor scores, weak areas, and readiness trends across every session over time.",
                    theme: { bgInner: "#faf5ff", iconColor: "#7e22ce", pinLight: "#c084fc", pinDark: "#7e22ce", darkBg: "#3a254a" },
                    rotate: "-rotate-[3deg]",
                    posClass: "left-6 md:left-16 top-8 md:top-16",
                    innerPad: "p-6 md:p-8",
                    icon: (
                      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
                      </svg>
                    )
                  }
                ].map((item, index) => {
                  // Calculate rotation angle
                  const rotationDeg = item.rotate === '-rotate-[3deg]' ? -3 : 3;
                  
                  return (
                    <div 
                      key={item.id} 
                      className={`benefit-card group relative flex flex-col p-3 md:p-4 rounded-[32px] transition-all duration-500 ease-out hover:scale-[1.05] hover:-translate-y-2 hover:z-30 cursor-pointer ${index % 2 === 1 ? 'md:mt-32' : ''} ${
                        isDark 
                          ? 'bg-[#1e293b] shadow-[0_12px_40px_rgba(0,0,0,0.3)] hover:shadow-[0_20px_60px_rgba(2,92,215,0.3)] border border-[#2d3142]'
                          : 'bg-white shadow-[0_12px_40px_rgba(0,0,0,0.06)] hover:shadow-[0_20px_60px_rgba(0,0,0,0.12)]'
                      }`}
                      style={{
                        transform: `rotate(${rotationDeg}deg)`,
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.transform = 'rotate(0deg) scale(1.05) translateY(-0.5rem)';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.transform = `rotate(${rotationDeg}deg)`;
                      }}
                    >
                    
                    {/* Sophisticated 3D Colored Pin */}
                    <div className="absolute -top-3 left-1/2 -translate-x-1/2 w-7 h-7 rounded-full shadow-[0_6px_10px_rgba(0,0,0,0.3),inset_0_-3px_6px_rgba(0,0,0,0.3),inset_0_3px_6px_rgba(255,255,255,0.6)] border border-black/10 z-20 transition-all duration-500 ease-in-out group-hover:-translate-y-16 group-hover:scale-110 group-hover:opacity-0"
                      style={{ background: `radial-gradient(circle at 30% 30%, ${item.theme.pinLight}, ${item.theme.pinDark})` }}>
                      <div className="absolute top-[3px] left-[4px] w-2 h-2 rounded-full bg-white opacity-80 blur-[0.5px]" />
                    </div>

                    {/* Inner Colored Card */}
                    <div className={`flex-1 flex flex-col justify-center ${item.innerPad} rounded-[20px] transition-colors duration-300`} style={{ 
                      backgroundColor: isDark ? item.theme.darkBg : item.theme.bgInner 
                    }}>
                      <div className="mb-5" style={{ color: item.theme.iconColor }}>
                        {item.icon}
                      </div>
                      <h3 className={`text-[19px] md:text-[22px] font-extrabold leading-tight tracking-tight mb-3 transition-colors duration-300 ${
                        isDark ? 'text-[#e5e5e5]' : 'text-[#111]'
                      }`}>{item.title}</h3>
                      <p className={`text-[14px] md:text-[15px] font-medium leading-relaxed transition-colors duration-300 ${
                        isDark ? 'text-[#999]' : 'text-[#555]'
                      }`}>{item.desc}</p>
                    </div>

                  </div>
                  );
                })}
              </div>
            </div>
          </div>
        </section>

        {/* ── Comparison Table (commented out) ──
        <section className="bg-[#f4f5f7] pb-20">
          <div className="max-w-[1100px] mx-auto px-6">
            <div className="it-reveal">
              <div className="text-center mb-12">
                <h2 className="text-[2rem] md:text-[2.6rem] font-black text-[#111] tracking-tight mb-2">
                  Compare <span style={{ color: BLUE }}>Interview Formats</span>
                </h2>
              </div>
              <div className="rounded-3xl overflow-hidden shadow-[0_12px_50px_-10px_rgba(0,0,0,0.08)]" style={{ background: "linear-gradient(to bottom, #fff 0%, #fff 80%, #f4f5f7 100%)" }}>
                <div className="grid grid-cols-4 gap-0 border-b border-[#f0f0f0]">
                  <div className="p-5 md:p-6 col-span-1" />
                  {INTERVIEW_TYPES.map((t) => (
                    <div key={t.id} className="p-5 md:p-6 text-center border-l border-[#f0f0f0]">
                      <div className="flex justify-center mb-1.5">{t.icon}</div>
                      <p className="text-[13px] font-black text-[#111] tracking-tight">{t.label}</p>
                    </div>
                  ))}
                </div>
                {[
                  { label: "Available Now", values: [true, false, false], type: "bool" },
                  { label: "Live Coding", values: [true, true, true], type: "bool" },
                  { label: "Instant Feedback", values: [true, false, false], type: "bool" },
                  { label: "Human Interaction", values: [false, true, true], type: "bool" },
                  { label: "Expert Mentorship", values: [false, false, true], type: "bool" },
                ].map((row, ri) => (
                  <div key={ri} className="grid grid-cols-4 gap-0 border-b border-[#f8f8f8] last:border-0 hover:bg-[#fafbfc] transition-colors">
                    <div className="p-4 md:p-5 col-span-1 flex items-center">
                      <span className="text-[13px] font-semibold text-[#444]">{row.label}</span>
                    </div>
                    {row.values.map((val, vi) => (
                      <div key={vi} className="p-4 md:p-5 border-l border-[#f0f0f0] flex items-center justify-center">
                        {val ? (
                          <Image src="/tick_no_background.png" alt="Available" width={20} height={20} className="w-5 h-5" />
                        ) : (
                          <Image src="/cross_no_background.png" alt="Not available" width={20} height={20} className="w-5 h-5" />
                        )}
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>
        ── */}

        {/* ── Final CTA ── */}
        <section className={`transition-colors duration-300 ${
          isDark ? 'bg-[#1a1a1a]' : ''
        }`} style={{ 
          background: isDark ? '#FFE500' : YELLOW 
        }}>
          <div className="max-w-[1200px] mx-auto px-6 py-16 flex flex-col md:flex-row items-center justify-between gap-8">
            <div>
              <h2 className={`text-3xl md:text-4xl font-black mb-3 transition-colors duration-300 ${
                isDark ? 'text-[#1A1A1A]' : 'text-[#1a1a1a]'
              }`}>
                Ready to ace your interview?
              </h2>
              <p className={`text-lg max-w-xl transition-colors duration-300 ${
                isDark ? 'text-[#786d0f]' : 'text-[#1a1a1a]/60'
              }`}>
                Practice with AI voice interviews, live coding, and instant rubric-scored reports. No credit card required.
              </p>
            </div>
            <Link
              href="/login"
              className={`px-7 py-3.5 rounded-full font-semibold text-sm transition-colors whitespace-nowrap shrink-0 ${
                isDark
                  ? 'bg-[#1A1A1A] text-white hover:bg-[#0250c0]'
                  : 'bg-[#1a1a1a] text-white hover:bg-[#333]'
              }`}
            >
              Start Practicing Free
            </Link>
          </div>
        </section>

        {/* ── Footer ── */}
        <footer className={`relative overflow-hidden py-16 transition-colors duration-300 ${
          isDark ? 'text-[#999]' : 'text-[#999]'
        }`} style={{ 
          background: isDark 
            ? "linear-gradient(135deg, #000000 60%, #0c1c38 100%)" 
            : "linear-gradient(135deg, #000000 60%, #0c1c38 100%)" 
        }}>
          <div className="max-w-[1200px] mx-auto px-6">
            <div className="grid md:grid-cols-4 gap-12 mb-12">
              <div className="md:col-span-2">
                <Image src="/logo_big_dark.png" alt="Mockr" width={140} height={40} className="h-8 w-auto mb-5" />
                <p className="max-w-xs text-sm leading-relaxed">The only AI-native interview preparation platform designed for the highest level of technical assessment.</p>
              </div>
              <div>
                <h4 className="text-white font-extrabold tracking-tight text-[16px] mb-5">Product</h4>
                <ul className="space-y-3 text-sm">
                  <li><Link className="hover:text-white transition-colors" href="/#features">Features</Link></li>
                  <li><Link className="hover:text-white transition-colors" href="/ai-mock-interview">Interviews</Link></li>
                  <li><Link className="hover:text-white transition-colors" href="/interview-types">Interview Types</Link></li>
                  <li><Link className="hover:text-white transition-colors" href="/interview-questions">Questions</Link></li>
                  <li><Link className="hover:text-white transition-colors" href="/blog">Blog</Link></li>
                  <li><Link className="hover:text-white transition-colors" href="/faq">FAQ</Link></li>

                  <li><Link className="hover:text-white transition-colors" href="/#testimonials">Testimonials</Link></li>
                </ul>
              </div>
              <div>
                <h4 className="text-white font-extrabold tracking-tight text-[16px] mb-5">Company</h4>
                <ul className="space-y-3 text-sm">
                  <li><Link className="hover:text-white transition-colors" href="/about">About Us</Link></li>
                  <li><Link className="hover:text-white transition-colors" href="/careers">Careers</Link></li>
                  <li><Link className="hover:text-white transition-colors" href="/privacy">Privacy Policy</Link></li>
                  <li><Link className="hover:text-white transition-colors" href="/terms">Terms of Service</Link></li>
                </ul>
              </div>
            </div>
            <div className="pt-8 flex flex-col md:flex-row justify-between gap-4 items-center text-xs">
              <p>&copy; 2026 Mockr. All rights reserved.</p>
              <div className="flex gap-4">
                <a href="https://x.com/mockrrin?s=21" target="_blank" rel="noopener noreferrer" className="w-10 h-10 rounded-full bg-[#111] border border-[#222] flex items-center justify-center hover:-translate-y-1 transition-transform shadow-lg cursor-pointer">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="white">
                    <path d="M18.901 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.638 7.584H.474l8.6-9.83L0 1.154h7.594l5.243 6.932ZM17.61 20.644h2.039L6.486 3.24H4.298Z"/>
                  </svg>
                </a>
                <a href="https://www.linkedin.com/company/mockrai/" target="_blank" rel="noopener noreferrer" className="w-10 h-10 rounded-full bg-[#111] border border-[#222] flex items-center justify-center hover:-translate-y-1 transition-transform shadow-lg cursor-pointer">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="white">
                    <path d="M19 0h-14c-2.761 0-5 2.239-5 5v14c0 2.761 2.239 5 5 5h14c2.762 0 5-2.239 5-5v-14c0-2.761-2.238-5-5-5zm-11 19h-3v-11h3v11zm-1.5-12.268c-.966 0-1.75-.79-1.75-1.764s.784-1.764 1.75-1.764 1.75.79 1.75 1.764-.783 1.764-1.75 1.764zm13.5 12.268h-3v-5.604c0-3.368-4-3.113-4 0v5.604h-3v-11h3v1.765c1.396-2.586 7-2.777 7 2.476v6.759z"/>
                  </svg>
                </a>
                <a href="https://www.instagram.com/mockr.in?igsh=MWowM2RuYTM5NmVydQ%3D%3D&utm_source=qr" target="_blank" rel="noopener noreferrer" className="w-10 h-10 rounded-full bg-[#111] border border-[#222] flex items-center justify-center hover:-translate-y-1 transition-transform shadow-lg cursor-pointer">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="2" y="2" width="20" height="20" rx="5" ry="5"></rect>
                    <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"></path>
                    <line x1="17.5" y1="6.5" x2="17.51" y2="6.5"></line>
                  </svg>
                </a>
              </div>
            </div>
          </div>
        </footer>
      </div>

      {/* ── Scroll-reveal + entrance animation CSS ── */}
      <style>{``}</style>
    </ForceLight>
  );
}
