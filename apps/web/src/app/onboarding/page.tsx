"use client";

import Image from "next/image";
import Link from "next/link";
import { useMemo, useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import gsap from "gsap";
import party from "party-js";
import { useAuth } from "@/context/auth-context";
import { api } from "@/lib/api";

type Step = {
  prompt: string;
  options: string[];
};

const FIELD_OPTIONS = ["Data", "Engineering", "Design", "Finance", "PM"];
const POSITION_OPTIONS: Record<string, string[]> = {
  Data: ["Data Analyst", "Data Scientist", "ML Engineer", "BI Analyst", "Data Engineer"],
  Engineering: ["Frontend Engineer", "Backend Engineer", "Full Stack Engineer", "SDE 1", "SDE 2"],
  Design: ["Product Designer", "UX Designer", "UI Designer", "Visual Designer", "Design Researcher"],
  Finance: ["Financial Analyst", "Investment Analyst", "FP and A Analyst", "Risk Analyst", "Finance Manager"],
  PM: ["Associate PM", "Product Manager", "Growth PM", "Technical PM", "Platform PM"],
};
const COMPANY_OPTIONS = ["Top Product Company", "Fast Growth Startup", "Global Enterprise", "Remote First Team", "Unicorn Startup"];
const TRACK_OPTIONS = ["Internship", "Entry Level", "Mid Level", "Senior", "Leadership"];
const TIMELINE_OPTIONS = ["2 weeks", "1 month", "2 months", "3 months", "This year"];

export default function OnboardingPage() {
  const router = useRouter();
  const { session } = useAuth();
  const [started, setStarted] = useState(false);
  const [activeStep, setActiveStep] = useState(0);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [answers, setAnswers] = useState<string[]>(Array(5).fill(""));
  const [isDone, setIsDone] = useState(false);
  const [showSummary, setShowSummary] = useState(false);
  const [finalSequence, setFinalSequence] = useState(0);

  const welcomeRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const circlesRef = useRef<HTMLDivElement>(null);

  const floatRef1 = useRef<HTMLDivElement>(null);
  const floatRef2 = useRef<HTMLDivElement>(null);
  const floatRef3 = useRef<HTMLDivElement>(null);
  const floatRef4 = useRef<HTMLDivElement>(null);
  const floatRef5 = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Floating background animations
    if (floatRef1.current) gsap.to(floatRef1.current, { y: "-=30", x: "+=20", rotation: 10, duration: 4, yoyo: true, repeat: -1, ease: "sine.inOut" });
    if (floatRef2.current) gsap.to(floatRef2.current, { y: "+=40", x: "-=30", rotation: -15, duration: 5, yoyo: true, repeat: -1, ease: "sine.inOut" });
    if (floatRef3.current) gsap.to(floatRef3.current, { scale: 1.1, opacity: 0.8, duration: 3, yoyo: true, repeat: -1, ease: "sine.inOut" });
    if (floatRef4.current) gsap.to(floatRef4.current, { y: "-=50", x: "+=50", rotation: 45, duration: 6, yoyo: true, repeat: -1, ease: "sine.inOut" });
    if (floatRef5.current) gsap.to(floatRef5.current, { y: "+=20", x: "+=40", rotation: -20, duration: 4.5, yoyo: true, repeat: -1, ease: "sine.inOut" });

    // Initial image load slide-in animation
    if (imageRef.current) {
      gsap.fromTo(
        imageRef.current,
        { opacity: 0, x: 850 },
        { opacity: 1, x: 687.5, duration: 1.8, ease: "power3.out" }
      );
    }
    // Welcome text animation
    if (welcomeRef.current) {
      gsap.fromTo(
        welcomeRef.current.children,
        { opacity: 0, x: -100 },
        { opacity: 1, x: 0, duration: 1.8, stagger: 0.2, ease: "power3.out" }
      );
    }
  }, []);

  const steps = useMemo<Step[]>(() => {
    const selectedField = answers[0];
    return [
      { prompt: "I'm interested in the field of", options: FIELD_OPTIONS },
      { prompt: "I'm preparing for the position of", options: POSITION_OPTIONS[selectedField] ?? POSITION_OPTIONS.Engineering },
      { prompt: "I'm looking to join", options: COMPANY_OPTIONS },
      { prompt: "I'm targeting to the", options: TRACK_OPTIONS },
      { prompt: "I plan to land my new job in", options: TIMELINE_OPTIONS },
    ];
  }, [answers]);

  const transitionToDashboard = () => {
    if (isTransitioning) return;
    setIsTransitioning(true);

    if (!containerRef.current) {
      router.replace("/dashboard");
      return;
    }

    gsap.to(containerRef.current, {
      opacity: 0,
      duration: 0.9,
      delay: 1.2,
      ease: "power2.inOut",
      onComplete: () => {
        router.replace("/dashboard");
      },
    });
  };

  const handleStart = () => {
    if (started) return;
    
    gsap.to(welcomeRef.current, {
      y: -20,
      opacity: 0,
      duration: 0.3,
      ease: "power2.in",
      onComplete: () => {
        setStarted(true);
      }
    });
  };

  const handleSelect = (value: string, stepIndex: number) => {
    if (stepIndex !== activeStep || isDone || showSummary) return;

    setAnswers((prev) => {
      const next = [...prev];
      next[activeStep] = value;
      return next;
    });

    const currentQuestionEls = document.querySelectorAll(`.step-content-${activeStep}`);
    gsap.to(currentQuestionEls, {
      y: -20,
      opacity: 0,
      duration: 0.3,
      stagger: 0.05,
      ease: "power2.in",
      onComplete: () => {
        if (activeStep === steps.length - 1) {
          setShowSummary(true);
          return;
        }
        setActiveStep((prev) => prev + 1);
      }
    });
  };

  const handleDotClick = (index: number) => {
    if (isDone || index === activeStep) return;
    if (index > activeStep && !showSummary) return; // can't jump forward

    const outEls = showSummary
      ? document.querySelectorAll(".summary-content, .dots-container")
      : document.querySelectorAll(`.step-content-${activeStep}`);

    gsap.to(outEls, {
      y: -20,
      opacity: 0,
      duration: 0.25,
      ease: "power2.in",
      onComplete: () => {
        setShowSummary(false);
        setActiveStep(index);
      },
    });
  };

  const handleReadyToGo = () => {
    setIsDone(true);
    gsap.to(".summary-content, .dots-container", {
      y: -20,
      opacity: 0,
      duration: 0.4,
      ease: "power2.in",
      onComplete: () => {
        setFinalSequence(1);
        
        // Sequence animations
        const seq1 = document.querySelector(".seq-1");
        const seq2 = document.querySelector(".seq-2");
        const seq3 = document.querySelector(".seq-3");
        const seq4 = document.querySelector(".seq-4");
        
        const tl = gsap.timeline();
        if (seq1 && seq2 && seq3 && seq4) {
          tl
            .fromTo(seq1, { y: 20, opacity: 0 }, { y: 0, opacity: 1, duration: 0.6, ease: "power2.out" })
            .to(seq1, { y: -20, opacity: 0, duration: 0.4, delay: 1 })
            .call(() => setFinalSequence(2))
            .fromTo(seq2, { y: 20, opacity: 0 }, { y: 0, opacity: 1, duration: 0.6, ease: "power2.out" })
            .to(seq2, { y: -20, opacity: 0, duration: 0.4, delay: 1 })
            .call(() => setFinalSequence(3))
            .fromTo(seq3, { y: 20, opacity: 0 }, { y: 0, opacity: 1, duration: 0.6, ease: "power2.out" })
            .to(seq3, { y: -20, opacity: 0, duration: 0.4, delay: 1 })
            .call(() => setFinalSequence(4))
            // Save onboarding answers but DON'T mark as completed yet
            // User needs to finish/skip the getting started tour first
            .call(() => { (async () => {
              try {
                if (session?.access_token) {
                  console.log('[Onboarding] Saving onboarding answers...');
                  await api.patch(
                    "/users/me",
                    {
                      onboardingField: answers[0],
                      onboardingPosition: answers[1],
                      onboardingCompany: answers[2],
                      onboardingTrack: answers[3],
                      onboardingTimeline: answers[4],
                    },
                    session.access_token
                  );
                  console.log('[Onboarding] Answers saved, redirecting to dashboard for getting started tour');
                }
              } catch (error) {
                console.error("Failed to save onboarding answers:", error);
              }
            })(); })
            .call(() => {
              party.confetti(seq4 as HTMLElement, {
                count: party.variation.range(40, 120),
                size: party.variation.range(0.8, 1.2),
              });
            })
            .fromTo(seq4, { y: 20, opacity: 0 }, { y: 0, opacity: 1, duration: 0.6, ease: "power2.out" })
            .call(() => {
              transitionToDashboard();
            });
        }
      }
    });
    
    // Fade out visuals cleanly
    gsap.to(imageRef.current, { opacity: 0, duration: 1 });
    gsap.to(circlesRef.current, { opacity: 0, duration: 1 });
  };

  useEffect(() => {
    if (!started || showSummary || isDone) return;
    const currentQuestionEls = document.querySelectorAll(`.step-content-${activeStep}`);
    gsap.fromTo(
      currentQuestionEls,
      { y: 20, opacity: 0 },
      { y: 0, opacity: 1, duration: 0.4, stagger: 0.06, ease: "power2.out" }
    );
  }, [activeStep, started, showSummary, isDone]);

  useEffect(() => {
    if (showSummary) {
      gsap.fromTo(
        ".summary-item",
        { y: 20, opacity: 0 },
        { y: 0, opacity: 1, duration: 0.5, stagger: 0.1, ease: "power2.out" }
      );
    }
  }, [showSummary]);

  return (
    <div
      className="w-full min-h-screen xl:h-screen xl:overflow-hidden overflow-y-auto text-text-black relative cursor-pointer __className_a05e8d bg-white text-[#121212]"
      onClick={handleStart}
      role="presentation"
      ref={containerRef}
    >
      <div style={{ opacity: 1 }}>
        <div className="pt-12 flex justify-center relative z-10 transition-opacity" style={{ opacity: finalSequence > 0 ? 0 : 1 }}>
          <Image src="/logo_big.png" alt="Mockr Logo" width={160} height={40} priority />
        </div>

        <div className="absolute right-5 top-5 z-20 transition-opacity" style={{ opacity: finalSequence > 0 ? 0 : 1 }}>
          <Link
            href="/"
            onClick={(e) => e.stopPropagation()}
            className="rounded-full border border-black/15 bg-white/90 px-5 py-2 text-sm font-semibold text-black/70 transition-colors hover:bg-black hover:text-white"
          >
            Back
          </Link>
        </div>

        {/* Welcome Section */}
        {!started && (
          <div
            ref={welcomeRef}
            className="relative xl:absolute left-0 xl:left-52 top-0 mt-[280px] md:mt-[450px] xl:mt-0 xl:top-[320px] z-10 font-light text-center xl:text-left w-full max-w-[90vw] md:max-w-[85vw] mx-auto xl:mx-0 pb-20"
          >
            <h1 className="mb-2 text-5xl md:text-7xl xl:text-6xl">Welcome.</h1>
            <p className="mb-8 text-2xl md:text-4xl xl:text-3xl">Please share your career goal to begin.</p>
            <p className="bg-clip-text text-transparent bg-gradient-to-r from-[#3E29F0] to-[#9123FF] text-2xl md:text-4xl xl:text-3xl">Click anywhere to start</p>
          </div>
        )}

        {/* Questions Section */}
        {started && !showSummary && !isDone && steps[activeStep] && (
          <div className="relative xl:absolute left-0 xl:left-52 top-0 mt-[260px] md:mt-[420px] xl:mt-0 xl:top-[280px] z-10 font-light w-full max-w-[95vw] md:max-w-[85vw] px-4 xl:px-0 text-center xl:text-left pb-24" onClick={(e) => e.stopPropagation()} role="presentation">
            <div className={`flex flex-wrap items-center justify-center xl:justify-start gap-2 mb-6 md:mb-12 relative step-content-${activeStep}`}>
              <h1 className="text-3xl md:text-5xl xl:text-3xl text-black/80">{steps[activeStep].prompt}</h1>
              <div className="relative mt-1">
                <span className={`text-3xl md:text-5xl xl:text-4xl ${answers[activeStep] ? "text-black" : "text-black/20"}`}>
                  {answers[activeStep] || "______"}
                </span>
                <div
                  className="absolute bottom-0 left-0 h-[2px] md:h-[4px] xl:h-[3px] w-full"
                  style={{
                    display: answers[activeStep] ? "block" : "none",
                    backgroundColor: "black",
                  }}
                />
              </div>
              <span className="text-3xl md:text-5xl xl:text-4xl text-black/60">{"."}</span>
            </div>

            <div className="font-light grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-8 xl:gap-x-10 xl:gap-y-4 mx-auto xl:mx-0 xl:max-w-[550px]">
              {steps[activeStep].options.map((option) => {
                const selected = answers[activeStep] === option;
                return (
                  <div
                    key={option}
                    onClick={() => handleSelect(option, activeStep)}
                    className={`flex items-center justify-start gap-4 p-4 md:p-6 xl:p-3 cursor-pointer text-left step-content-${activeStep}`}
                  >
                    <div
                      className="w-6 h-6 md:w-8 md:h-8 border-2 md:border-4 rounded-full transition-colors duration-200 shrink-0"
                      style={{
                        backgroundColor: selected ? "#121212" : "transparent",
                        borderColor: selected ? "#121212" : "rgba(0, 0, 0, 0.2)",
                      }}
                    />
                    <span className="text-2xl md:text-4xl xl:text-2xl">{option}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Summary Section */}
        {showSummary && !isDone && (
          <div className="relative xl:absolute left-0 xl:left-52 top-0 mt-[260px] md:mt-[420px] xl:mt-0 xl:top-[240px] z-10 font-light summary-content w-full max-w-[95vw] md:max-w-[85vw] px-4 xl:px-0 text-center xl:text-left pb-24 md:pb-32 xl:pb-0" onClick={(e) => e.stopPropagation()} role="presentation">
            <div className="space-y-6 md:space-y-10 mb-12 md:mb-20">
              {steps.map((step, index) => (
                <div key={index} className="text-2xl md:text-4xl xl:text-3xl summary-item flex flex-wrap items-center justify-center xl:justify-start gap-2 md:gap-4">
                  <span className="text-black/50">{step.prompt}</span>
                  <span className="text-[#6B46FF] border-b-2 md:border-b-4 border-[#6B46FF] pb-0.5 inline-block -mb-1">{answers[index]}</span>
                  <span className="text-black/50">.</span>
                </div>
              ))}
            </div>
            
            <button
              onClick={handleReadyToGo}
              className="summary-item text-[#6B46FF] text-3xl md:text-5xl xl:text-4xl flex items-center justify-center xl:justify-start gap-4 hover:opacity-80 transition-opacity mx-auto xl:mx-0"
            >
              Ready To Go 
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-8 h-8 md:w-12 md:h-12">
                <path d="M7 17L17 7M17 7H7M17 7V17" />
              </svg>
            </button>
          </div>
        )}

        {/* Progress Dots */}
        {!isDone && (
          <div
            className="absolute left-1/2 -translate-x-1/2 top-[200px] md:top-[360px] xl:left-20 xl:translate-x-0 xl:top-[308px] xl:-translate-y-1/2 flex space-x-6 md:space-x-10 xl:space-x-0 xl:flex-col xl:space-y-6 z-10 transition-opacity duration-300 dots-container"
            style={{ opacity: started ? 1 : 0 }}
          >
            {steps.map((_, index) => (
               <div
                 key={`dot-${index}`}
                 onClick={() => handleDotClick(index)}
                 className={`w-3 h-3 md:w-5 md:h-5 xl:w-4 xl:h-4 rounded-full transition-colors duration-300 ${index <= activeStep || showSummary ? "bg-[#141414]" : "bg-[#C4C4C4]"} ${(index < activeStep || showSummary) ? "cursor-pointer hover:opacity-60" : "cursor-default"}`}
               />
            ))}
          </div>
        )}

        {/* Background Images */}
        <div ref={circlesRef} style={{ opacity: 1, transition: 'opacity 1s ease' }}>
          <div className="absolute inset-0 pointer-events-none">
            <div className="absolute left-0 top-[80px] md:top-[120px] xl:top-[154px]">
              <Image
                alt=""
                width={948}
                height={948}
                src="/circle.png"
                className="w-[340px] h-[340px] md:w-[660px] md:h-[660px] xl:w-[948px] xl:h-[948px]"
              />
            </div>
            <div className="absolute right-0 top-[-100px] translate-x-[20px] md:top-[-220px] md:translate-x-[60px] xl:top-[-350px] xl:translate-x-[200px]">
              <Image
                alt=""
                width={948}
                height={948}
                src="/circle2.png"
                className="w-[340px] h-[340px] md:w-[660px] md:h-[660px] xl:w-[948px] xl:h-[948px]"
              />
            </div>
          </div>
          <div className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-white via-white/80 to-transparent pointer-events-none" />
        </div>
          
        {/* Floating Elements */}
        <div className="absolute inset-0 pointer-events-none overflow-hidden" style={{ opacity: started ? 0.6 : 1, transition: 'opacity 1s ease' }}>
          <div ref={floatRef1} className="absolute top-[15%] left-[8%] w-8 h-8 rounded-full bg-gradient-to-br from-[#3E29F0] to-[#9123FF] opacity-30 blur-[2px]" />
          <div ref={floatRef2} className="absolute top-[70%] left-[15%] w-12 h-12 rounded-full border-2 border-[#9123FF] opacity-20 xl:hidden" />
          <div ref={floatRef3} className="absolute top-[25%] right-[40%] opacity-30 text-[#3E29F0] text-4xl font-light">✦</div>
          <div ref={floatRef4} className="absolute bottom-[25%] right-[25%] w-10 h-10 opacity-20 bg-gradient-to-tr from-[#FF2393] to-[#9123FF]" style={{ clipPath: "polygon(50% 0%, 0% 100%, 100% 100%)" }} />
          <div ref={floatRef5} className="absolute bottom-[15%] left-[35%] opacity-20 text-[#FF2393] text-2xl font-bold rotate-12">●</div>
        </div>

        <div
          ref={imageRef}
          className="absolute top-[232px] left-0 right-[300px] bottom-0 pointer-events-none hidden xl:block"
          style={{ transform: "translateX(687.5px)", opacity: 0 }}
        >
          <div
            className="relative w-full mx-auto"
            style={{
              height: "calc(100% + 300px)",
              transform: "translateY(-300px)",
              width: "100%",
            }}
          >
            <Image
              alt=""
              src="/girl.svg"
              fill
              priority
              sizes="10vw"
              className="object-contain"
              style={{
                color: "transparent",
                filter: "blur(0px)",
                maskImage: "linear-gradient(transparent 0%, black 10%, black 90%, transparent 100%)",
                WebkitMaskImage: "linear-gradient(transparent 0%, black 10%, black 90%, transparent 100%)",
              }}
            />
          </div>
        </div>
      </div>

      {/* Final Sequences */}
      {isDone && (
        <div className="absolute inset-0 flex items-center justify-center text-[28px] font-light pointer-events-none z-50">
          <div className="absolute seq-1" style={{ opacity: 0 }}>
            Memory Updated
          </div>
          <div className="absolute seq-2" style={{ opacity: 0 }}>
            Personal Study Plan Created
          </div>
          <div className="absolute seq-3" style={{ opacity: 0 }}>
            Daily Tasks Ready
          </div>
          <div className="absolute seq-4 text-[32px] md:text-[48px] flex items-center gap-2 text-center px-4" style={{ opacity: 0 }}>
            Welcome To Mockr <span className="text-[#6B46FF]"></span>
          </div>
        </div>
      )}
    </div>
  );
}
