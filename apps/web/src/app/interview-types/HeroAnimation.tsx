"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import gsap from "gsap";

const BLUE = "#2C3E96";

export default function HeroAnimation({ isDark = false }: { isDark?: boolean }) {
  const sectionRef = useRef<HTMLElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLDivElement>(null);
  const ballRef = useRef<HTMLDivElement>(null);
  const splashRef = useRef<HTMLDivElement>(null);
  const [splashed, setSplashed] = useState(false);
  const heroImages = ["/1.png", "/2.png", "/3.png"];
  const [imageIndex, setImageIndex] = useState(0);

  // Typewriter effect state
  const [typewriterText, setTypewriterText] = useState("AI-Powered");
  const typewriterWords = ["AI-Powered", "Peer to Peer", "Expert"];
  const [wordIndex, setWordIndex] = useState(0);

  // Synchronize image and text changes
  useEffect(() => {
    const interval = setInterval(() => {
      setWordIndex((prev) => {
        const nextIndex = (prev + 1) % typewriterWords.length;
        setImageIndex(nextIndex); // Change image at the same time
        return nextIndex;
      });
    }, 3000); // Change both every 3 seconds
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const currentWord = typewriterWords[wordIndex];
    let charIndex = 0;
    setTypewriterText("");

    const typingInterval = setInterval(() => {
      if (charIndex <= currentWord.length) {
        setTypewriterText(currentWord.slice(0, charIndex));
        charIndex++;
      } else {
        clearInterval(typingInterval);
      }
    }, 100); // Type each character every 100ms

    return () => clearInterval(typingInterval);
  }, [wordIndex]);

  useEffect(() => {
    const tl = gsap.timeline({ defaults: { ease: "power2.out" } });

    // ─── Phase 1: Entrance — fade in (opacity only, very slow) ───────────
    tl.fromTo(
      textRef.current,
      { opacity: 0 },
      { opacity: 1, duration: 3.5 },
      0
    ).fromTo(
      imageRef.current,
      { opacity: 0 },
      { opacity: 1, duration: 3.5 },
      0
    );

    // ─── Phase 2: Single blue ball drops from top ────────────────────────
    tl.fromTo(
      ballRef.current,
      { y: "-100vh", x: 0, scale: 1, opacity: 1 },
      {
        y: "0vh",
        duration: 0.55,
        ease: "power3.in",
        onComplete: triggerSplash,
      },
      ">"
    );

    return () => { tl.kill(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function triggerSplash() {
    // Instantly hide ball
    if (ballRef.current) {
      gsap.to(ballRef.current, { scale: 0, opacity: 0, duration: 0.08 });
    }

    // Reveal + spring-scale the splash image
    setSplashed(true);
    if (splashRef.current) {
      gsap.fromTo(
        splashRef.current,
        { scale: 0, opacity: 0 },
        { scale: 1, opacity: 1, duration: 0.7, ease: "elastic.out(1, 0.45)" }
      );
    }
  }

  return (
    <section
      ref={sectionRef}
      className={`relative w-full overflow-visible pt-16 pb-0 transition-colors duration-300 ${
        isDark ? 'bg-[#222222]' : 'bg-transparent'
      }`}
    >
      {/* ── Keyframes ────────────────────────────────────────────────── */}
      <style>{`
        @keyframes heroBreathe {
          0%, 100% { transform: scale(1);    opacity: .85; }
          50%       { transform: scale(1.06); opacity: 1;   }
        }
        @keyframes heroFloat {
          0%, 100% { transform: translateY(0) rotate(0deg); }
          50%       { transform: translateY(-18px) rotate(5deg); }
        }
        @keyframes blink {
          0%, 100% { opacity: 1; }
          50% { opacity: 0; }
        }
        @keyframes pulse {
          0%, 100% { opacity: 0.4; transform: scale(1); }
          50% { opacity: 0.8; transform: scale(1.05); }
        }
      `}</style>

      {/* ── Ambient background gradient ───────────────────────────────── */}
      {!isDark && (
        <div
          className="absolute top-[-100px] left-[-100px] w-[800px] h-[800px] rounded-full pointer-events-none z-0"
          style={{
            background: "radial-gradient(circle, #fdf0ff 0%, #f5f7ff 40%, transparent 70%)",
            filter: "blur(40px)",
            animation: "heroBreathe 8s ease-in-out infinite alternate",
          }}
        />
      )}

      {/* ── Dark mode gradient on left side ───────────────────────────── */}
      {isDark && (
        <div
          className="absolute top-0 left-0 w-[500px] h-full pointer-events-none z-0 opacity-30"
          style={{
            background: "radial-gradient(ellipse at 0% 50%, rgba(2,92,215,0.2) 0%, transparent 60%)",
          }}
        />
      )}

      {/* ── Doodle decorations ────────────────────────────────────────── */}
      {!isDark && (
        <>
          <div className="absolute -top-20 -right-20 w-[500px] h-[500px] rounded-full opacity-[0.06]" style={{ background: BLUE }} />
          <div className="absolute top-40 -left-16 w-[250px] h-[250px] rounded-full opacity-[0.05]" style={{ background: BLUE }} />
          {/* Blue doodle decorations */}
          <svg className="hero-doodle absolute top-16 right-[14%] w-20 h-20 opacity-20" viewBox="0 0 100 100"><circle cx="50" cy="50" r="42" fill="none" stroke={BLUE} strokeWidth="2.5" strokeDasharray="8 5" /></svg>
          <svg className="hero-doodle absolute top-10 left-[8%] w-4 h-4 opacity-30" viewBox="0 0 20 20"><circle cx="10" cy="10" r="8" fill={BLUE} /></svg>
          <svg className="hero-doodle absolute bottom-36 left-[5%] w-14 h-14 opacity-10" viewBox="0 0 100 100"><rect x="10" y="10" width="80" height="80" rx="18" fill="none" stroke={BLUE} strokeWidth="2.5" strokeDasharray="10 6" /></svg>
        </>
      )}

      {/* ── Dark mode decorative elements ───────────────────────────── */}
      {isDark && (
        <>
          {/* Simple circles - matching light mode style */}
          <div className="absolute right-[20%] top-[20%] w-[150px] h-[150px] rounded-full border border-[#025cd7] opacity-20 z-0" style={{ borderStyle: 'dashed', borderWidth: '2px' }} />
          <div className="absolute right-[35%] top-[45%] w-[100px] h-[100px] rounded-full border border-[#025cd7] opacity-15 z-0" style={{ borderStyle: 'solid', borderWidth: '2px' }} />
          
          {/* Small dots */}
          <div className="absolute right-[15%] top-[15%] w-[12px] h-[12px] rounded-full bg-[#025cd7] opacity-40 z-0" />
          <div className="absolute right-[40%] top-[30%] w-[8px] h-[8px] rounded-full bg-[#025cd7] opacity-30 z-0" />
        </>
      )}

      <div
        ref={imageRef}
        style={{ opacity: 0 }}
        className="absolute -right-4 lg:-right-10 xl:-right-20 top-0 w-[55%] max-w-[850px] hidden lg:block h-[90vh] z-10 pointer-events-none"
      >
        {heroImages.map((src, i) => (
          <img
            key={src}
            src={src}
            alt="AI Interview Coach"
            className={`absolute top-0 bottom-[120px] left-0 w-full h-full object-contain object-right transition-opacity duration-[1500ms] ease-in-out ${i === imageIndex ? "opacity-100" : "opacity-0"
              }`}
          />
        ))}
      </div>

      {/* ── Main content container ────────────────────────────────────── */}
      <div className="w-full max-w-[1200px] mx-auto px-6 relative z-10">
        <div className="grid lg:grid-cols-2 gap-12 items-center">

          {/* Left — text side */}
          <div ref={textRef} style={{ opacity: 0 }} className="flex flex-col gap-5">


            <h1 className={`text-[3rem] md:text-[3.8rem] leading-[1.1] font-extrabold tracking-tight transition-colors duration-300 ${
              isDark ? 'text-[#e5e5e5]' : 'text-[#1a1a1a]'
            }`}>
              <span className="inline-block min-w-[280px] md:min-w-[380px]">
                {typewriterText}
                <span className="inline-block w-[3px] h-[0.9em] bg-[#4F75FF] ml-1 align-middle" style={{ animation: "blink 1s infinite" }} />
              </span>
              {" "}
              <span className="relative inline-block">
                <span className="italic" style={{ fontFamily: "'Playfair Display', serif" }}>
                  Interviews
                </span>
              </span>
            </h1>

            <p className={`text-[15px] md:text-[16px] font-medium leading-[1.6] max-w-lg mt-2 transition-colors duration-300 ${
              isDark ? 'text-[#999]' : 'text-[#6b7280]'
            }`}>
              Engineered to impress, the AI interviewer captivated recruiters with
              smart insights and seamless interaction gaining traction and trust worldwide
            </p>

            <div className="hero-cta pt-1">
              <Link href="/login" className={`inline-flex items-center gap-2 px-7 py-3.5 rounded-full font-semibold text-[15px] transition-colors ${
                isDark
                  ? 'bg-[#FFE500] text-[#1a1a1a] hover:bg-[#ffd900]'
                  : 'bg-[#FFE500] text-[#1a1a1a] hover:bg-[#ffd900]'
              }`}>
                Get Started
                <span className="material-symbols-outlined text-xl">arrow_forward</span>
              </Link>
            </div>
          </div>

          {/* Right — mobile hero image (desktop handled by absolute div above) */}
          <div className="relative flex lg:hidden items-center justify-end overflow-hidden pb-10">
            <div className="w-[100%] translate-x-[15%] relative">
              {/* Invisible spacer to maintain aspect ratio based on first image */}
              <img src={heroImages[0]} alt="" className="w-full h-auto opacity-0" aria-hidden="true" />
              {heroImages.map((src, i) => (
                <img
                  key={src}
                  src={src}
                  alt="AI Interview Coach"
                  className={`absolute top-0 left-0 w-full h-full object-contain transition-opacity duration-[1500ms] ease-in-out ${i === imageIndex ? "opacity-100" : "opacity-0"
                    }`}
                />
              ))}
            </div>
          </div>

        </div>
      </div>
    </section>
  );
}