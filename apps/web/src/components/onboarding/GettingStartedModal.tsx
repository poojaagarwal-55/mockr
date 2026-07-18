"use client";

import { useState } from "react";
import Image from "next/image";
import { useAuth } from "@/context/auth-context";
import { api } from "@/lib/api";
import { PageCurlSlider } from "@/components/ui/page-curl-slider";

interface OnboardingSlide {
    title: string;
    description: string;
    features: string[];
    icon: string;
}

const ONBOARDING_SLIDES: OnboardingSlide[] = [
    {
        title: "Let's Begin",
        description: "Your AI-powered interview preparation platform",
        features: [
            "Practice with AI interviewers tailored to your target role",
            "Get instant feedback and detailed performance reports",
            "Track your progress and improve systematically",
            "Access comprehensive resources for every interview type"
        ],
        icon: "celebration"
    },
    {
        title: "AI Mock Interviews",
        description: "Experience realistic interview scenarios",
        features: [
            "Coding interviews with live code execution",
            "System design discussions with visual diagrams",
            "Behavioral interviews with STAR method guidance",
            "CS fundamentals and technical deep-dives"
        ],
        icon: "psychology"
    },
    {
        title: "AI Tutor",
        description: "Your personal interview coach",
        features: [
            "Ask questions about any interview topic",
            "Get personalized study plans based on your performance",
            "Practice with curated question sets",
            "Review past interviews and learn from mistakes"
        ],
        icon: "school"
    },
    {
        title: "Resume Analysis",
        description: "Optimize your resume with AI",
        features: [
            "ATS compatibility scoring and optimization",
            "Detailed feedback on content and structure",
            "Role-specific recommendations for improvement",
            "Track and compare multiple resume versions"
        ],
        icon: "description"
    },
    {
        title: "Question Bank",
        description: "Comprehensive practice resources",
        features: [
            "1000+ curated interview questions across all topics",
            "DSA, System Design, SQL, and CS Fundamentals",
            "Difficulty-based filtering and smart recommendations",
            "Company-specific question tags and patterns"
        ],
        icon: "quiz"
    },
    {
        title: "Performance Analytics",
        description: "Track your improvement over time",
        features: [
            "Detailed rubric-based scoring for every session",
            "Performance trends and insights with visualizations",
            "Identify weak areas and track strengths",
            "Calendar view of all your practice sessions"
        ],
        icon: "analytics"
    }
];

const playClickSound = () => {
    try {
        const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
        if (!AudioContext) return;
        const ctx = new AudioContext();
        
        // Gentle, soft UI click
        const osc = ctx.createOscillator();
        const gainNode = ctx.createGain();
        
        osc.type = "sine";
        // Start around 1000Hz and drop very quickly to create a subtle percussive "tick"
        osc.frequency.setValueAtTime(1000, ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(200, ctx.currentTime + 0.03);
        
        // Very quick, gentle volume envelope
        gainNode.gain.setValueAtTime(0, ctx.currentTime);
        gainNode.gain.linearRampToValueAtTime(0.1, ctx.currentTime + 0.002); // Instant soft hit
        gainNode.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.04); // Fast decay
        
        osc.connect(gainNode);
        gainNode.connect(ctx.destination);
        
        osc.start();
        osc.stop(ctx.currentTime + 0.05);
    } catch (e) {
        console.error("Audio API not supported", e);
    }
};

const playPageTurnSound = () => {
    try {
        const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
        if (!AudioContext) return;
        const ctx = new AudioContext();
        
        // Create a realistic page turn sound using noise and filtering
        const bufferSize = ctx.sampleRate * 0.3; // 300ms duration
        const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
        const data = buffer.getChannelData(0);
        
        // Generate noise with envelope
        for (let i = 0; i < bufferSize; i++) {
            const t = i / bufferSize;
            // Envelope: quick attack, sustained, quick release
            let envelope = 1;
            if (t < 0.05) {
                envelope = t / 0.05; // Attack
            } else if (t > 0.85) {
                envelope = (1 - t) / 0.15; // Release
            }
            // White noise with envelope
            data[i] = (Math.random() * 2 - 1) * envelope * 0.15;
        }
        
        const source = ctx.createBufferSource();
        source.buffer = buffer;
        
        // Create filter to shape the noise into a "swoosh"
        const filter = ctx.createBiquadFilter();
        filter.type = 'bandpass';
        filter.frequency.setValueAtTime(2000, ctx.currentTime);
        filter.frequency.exponentialRampToValueAtTime(800, ctx.currentTime + 0.15);
        filter.Q.value = 1.5;
        
        // Add a subtle low-frequency thump at the start
        const lowOsc = ctx.createOscillator();
        const lowGain = ctx.createGain();
        lowOsc.type = 'sine';
        lowOsc.frequency.setValueAtTime(80, ctx.currentTime);
        lowOsc.frequency.exponentialRampToValueAtTime(40, ctx.currentTime + 0.08);
        lowGain.gain.setValueAtTime(0, ctx.currentTime);
        lowGain.gain.linearRampToValueAtTime(0.2, ctx.currentTime + 0.005);
        lowGain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.08);
        
        // Master gain
        const masterGain = ctx.createGain();
        masterGain.gain.value = 0.3;
        
        // Connect everything
        source.connect(filter);
        filter.connect(masterGain);
        lowOsc.connect(lowGain);
        lowGain.connect(masterGain);
        masterGain.connect(ctx.destination);
        
        // Play
        source.start();
        lowOsc.start();
        source.stop(ctx.currentTime + 0.3);
        lowOsc.stop(ctx.currentTime + 0.08);
    } catch (e) {
        console.error("Audio API not supported", e);
    }
};

interface GettingStartedModalProps {
    onClose: () => void;
}

export function GettingStartedModal({ onClose }: GettingStartedModalProps) {
    const { session, refreshUser } = useAuth();
    const [isClosing, setIsClosing] = useState(false);

    // Mark onboarding as complete in the backend
    const markOnboardingComplete = async () => {
        try {
            if (session?.access_token) {
                console.log('[GettingStarted] Marking onboarding as complete...');
                await api.patch(
                    "/users/me",
                    { onboardingCompleted: true },
                    session.access_token
                );
                await refreshUser();
                console.log('[GettingStarted] Onboarding marked as complete');
            }
        } catch (error) {
            console.error('[GettingStarted] Failed to mark onboarding as complete:', error);
        }
    };

    const handleComplete = () => {
        setIsClosing(true);
        markOnboardingComplete(); // Fire and forget
        setTimeout(() => {
            onClose();
        }, 800);
    };

    const handleSkip = () => {
        setIsClosing(true);
        markOnboardingComplete(); // Fire and forget
        setTimeout(() => {
            onClose();
        }, 800);
    };

    const renderSlideContent = (slide: OnboardingSlide) => {
        if (!slide) return null;
        
        return (
            <div className="absolute inset-0 w-full h-full bg-gradient-to-br from-[#FAFBFC] via-white to-[#eaf2ff] dark:from-[#1e293b] dark:via-[#1e293b] dark:to-[#1e293b]/50 overflow-hidden rounded-[2rem]">
                {/* Background decorative elements */}
                <div className="absolute top-0 -left-[300px] w-[600px] h-[400px] pointer-events-none" style={{
                    background: "radial-gradient(ellipse at 0% 0%, rgba(74,124,255,0.45) 0%, rgba(74,124,255,0.25) 45%, transparent 72%)",
                    filter: "blur(50px)",
                }} />
                <div className="absolute -right-[300px] top-[5%] w-[520px] h-[520px] rounded-full pointer-events-none dark:opacity-30" style={{
                    background: "radial-gradient(circle, rgba(180,200,255,0.9) 0%, rgba(180,200,255,0.5) 50%, transparent 75%)",
                }} />
                <div className="absolute bottom-[10%] left-[20%] w-[400px] h-[400px] rounded-full pointer-events-none opacity-70" style={{
                    background: "radial-gradient(circle, rgba(124,111,255,0.25) 0%, rgba(124,111,255,0.15) 50%, transparent 75%)",
                    filter: "blur(40px)",
                }} />
                <div className="absolute right-[10%] top-[20%] w-[500px] h-[500px] rounded-full pointer-events-none opacity-60" style={{
                    background: "radial-gradient(circle, rgba(124,111,255,0.4) 0%, rgba(74,124,255,0.25) 40%, transparent 70%)",
                    filter: "blur(60px)",
                }} />
                <div className="absolute left-[5%] top-[15%] w-[400px] h-[300px] rounded-full pointer-events-none opacity-30" style={{
                    background: "radial-gradient(ellipse, rgba(255,229,100,0.2) 0%, rgba(255,229,100,0.1) 50%, transparent 75%)",
                    filter: "blur(50px)",
                }} />
                <div className="absolute top-[40%] left-[15%] w-[150px] h-[150px] rounded-full pointer-events-none opacity-35" style={{
                    background: "radial-gradient(circle, rgba(74,124,255,0.5) 0%, transparent 70%)",
                    filter: "blur(30px)",
                }} />
                <div className="absolute bottom-[25%] right-[25%] w-[200px] h-[200px] rounded-full pointer-events-none opacity-30" style={{
                    background: "radial-gradient(circle, rgba(147,51,234,0.4) 0%, transparent 70%)",
                    filter: "blur(40px)",
                }} />
                <div className="absolute top-[60%] right-[15%] w-[120px] h-[120px] rounded-full pointer-events-none opacity-40" style={{
                    background: "radial-gradient(circle, rgba(59,130,246,0.5) 0%, transparent 70%)",
                    filter: "blur(35px)",
                }} />

                <div className="h-full px-8 sm:px-12 lg:px-16 flex flex-col lg:flex-row items-center justify-between gap-8 py-8 pb-0 relative z-10">
                    <div className="flex-1 w-full lg:w-[65%] flex flex-col items-start max-w-4xl pt-0 pb-32">
                        <div className="w-full flex flex-col">
                            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold text-[#4A7CFF] dark:text-[#4A7CFF] mb-6 font-nunito tracking-tight break-words">
                                {slide.title}
                            </h1>
                            <p className="text-2xl font-semibold text-neutral-600 dark:text-neutral-300 mb-10">
                                {slide.description}
                            </p>
                            <ul className="space-y-4 mb-12">
                                {slide.features.map((feature, idx) => (
                                    <li key={idx} className="flex items-start gap-3">
                                        <div className="flex-shrink-0 w-6 h-6 rounded-full bg-gradient-to-br from-[#4A7CFF] to-[#6B9FFF] flex items-center justify-center mt-0.5 shadow-sm">
                                            <span className="material-symbols-outlined text-white text-sm font-bold">done</span>
                                        </div>
                                        <span className="text-neutral-700 dark:text-neutral-300 text-lg">{feature}</span>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    </div>
                    <div className="flex-1 w-full lg:w-[35%] flex items-end justify-center relative h-full pb-0">
                        <div className="relative w-full h-full flex items-end justify-center">
                            <Image 
                                src="/girl.svg" 
                                alt="Mockr AI Assistant" 
                                width={1600}
                                height={1600}
                                className="w-full max-w-6xl h-auto object-contain object-bottom drop-shadow-2xl"
                                priority
                                style={{ maxHeight: '100%', marginBottom: '-2rem' }}
                            />
                            <div className="absolute inset-0 -z-10 bg-gradient-to-br from-[#4A7CFF]/20 to-purple-500/20 rounded-full blur-3xl opacity-30 animate-pulse" />
                        </div>
                    </div>
                </div>
            </div>
        );
    };

    const renderControls = (activeIndex: number, isAnimating: boolean, handleNext: () => void, handlePrev: () => void, isLastSlide: boolean) => {
        return (
            <>
                {/* Absolute positioning for controls - anchors to bottom-left */}
                <div className="absolute bottom-24 left-8 sm:left-12 lg:left-16 z-40 pointer-events-auto w-full lg:w-[65%] max-w-4xl">
                    <div className="space-y-4 w-full">
                        <div className="flex gap-4">
                            <button
                                onClick={() => {
                                    if (!isAnimating) {
                                        playPageTurnSound();
                                    }
                                    handleNext();
                                }}
                                disabled={isAnimating}
                                className="group inline-flex items-center gap-3 px-8 py-3 bg-gradient-to-r from-[#4A7CFF] to-[#6B9FFF] hover:from-[#3a63cc] hover:to-[#5B8FEF] text-white rounded-3xl font-semibold text-lg transition-all duration-200 shadow-[0_8px_30px_rgba(74,124,255,0.3)] hover:shadow-[0_12px_40px_rgba(74,124,255,0.5)] hover:-translate-y-0.5 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                {isLastSlide ? "Start Preparing" : "Next"}
                                <span className="material-symbols-outlined text-xl transition-transform group-hover:translate-x-2">
                                    arrow_forward
                                </span>
                            </button>
                        </div>
                        <div className="flex items-center gap-2">
                            {ONBOARDING_SLIDES.map((_, idx) => (
                                <div
                                    key={idx}
                                    className={`h-2 rounded-full transition-all duration-300 ${
                                        idx === activeIndex 
                                            ? 'w-8 bg-[#4A7CFF]' 
                                            : idx < activeIndex 
                                                ? 'w-2 bg-[#4A7CFF]/50' 
                                                : 'w-2 bg-neutral-200 dark:bg-neutral-700'
                                    }`}
                                />
                            ))}
                        </div>
                    </div>
                </div>
                
                {!isLastSlide && (
                    <button
                        onClick={handleSkip}
                        disabled={isAnimating}
                        className="absolute top-3 right-3 md:top-6 md:right-6 z-40 px-4 py-2 text-sm text-neutral-500 hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-200 transition-colors font-medium rounded-full hover:bg-neutral-100 dark:hover:bg-neutral-800 pointer-events-auto disabled:opacity-50"
                    >
                        Skip tour
                    </button>
                )}
            </>
        );
    };

    return (
        <div className={`fixed inset-0 z-[100] flex items-center justify-center p-4 backdrop-blur-md bg-[#FAFBFC]/80 dark:bg-[#1a1a1a]/80 transition-all duration-[800ms] ease-in-out ${isClosing ? 'opacity-0 backdrop-blur-none' : 'opacity-100'}`}>
            {/* Modal Container */}
            <div className={`relative w-full max-w-7xl h-[90vh] rounded-[2rem] shadow-2xl transition-all duration-[800ms] ease-in-out ${isClosing ? 'scale-90 -translate-y-8' : 'scale-100 translate-y-0'}`}>
                <PageCurlSlider
                    items={ONBOARDING_SLIDES}
                    renderSlide={renderSlideContent}
                    renderControls={renderControls}
                    onComplete={handleComplete}
                    animationDuration={1000}
                    className="w-full h-full rounded-[2rem]"
                />
            </div>
        </div>
    );
}
