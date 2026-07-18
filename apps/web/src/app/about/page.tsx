"use client";

import Link from "next/link";
import Image from "next/image";
import { useEffect, useRef } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useGSAP } from "@gsap/react";
import { LandingNav } from "@/components/landing-nav";
import { ThemeSync } from "@/components/theme-sync";
import { useTheme } from "next-themes";

if (typeof window !== "undefined") {
    gsap.registerPlugin(ScrollTrigger);
}

const BLUE = "#4A7CFF";

export default function AboutPage() {
    const containerRef = useRef<HTMLDivElement>(null);
    const textRef = useRef<HTMLDivElement>(null);
    const imageRef = useRef<HTMLDivElement>(null);
    const { resolvedTheme } = useTheme();
    const isDark = resolvedTheme === "dark";

    // Hero fade-in — same pattern as HeroAnimation on interview-types
    useEffect(() => {
        const tl = gsap.timeline();
        tl.fromTo(textRef.current, { opacity: 0 }, { opacity: 1, duration: 3.5 }, 0);
        tl.fromTo(imageRef.current, { opacity: 0 }, { opacity: 1, duration: 3.5 }, 0);
        return () => { tl.kill(); };
    }, []);

    useGSAP(() => {
        const ctx = gsap.context(() => {
            // Build section animations
            const buildRows = gsap.utils.toArray(".build-row");
            buildRows.forEach((row: any) => {
                const isFlipped = row.classList.contains("flex-row-reverse") || row.querySelector(".lg\\:flex-row-reverse");

                gsap.fromTo(row.querySelector(".build-image-side"),
                    { opacity: 0, x: isFlipped ? 80 : -80 },
                    {
                        opacity: 1, x: 0, duration: 1, ease: "power2.out",
                        scrollTrigger: { trigger: row, start: "top 85%" }
                    }
                );

                gsap.fromTo(row.querySelector(".build-text-side"),
                    { opacity: 0, x: isFlipped ? -80 : 80 },
                    {
                        opacity: 1, x: 0, duration: 1, ease: "power2.out",
                        scrollTrigger: { trigger: row, start: "top 85%" }
                    }
                );
            });

            // Build section header
            gsap.fromTo(".build-card", { opacity: 0, y: 30 }, {
                opacity: 1, y: 0, duration: 0.8, stagger: 0.2, ease: "power2.out",
                scrollTrigger: { trigger: ".build-section", start: "top 80%" }
            });

            ScrollTrigger.refresh();
        }, containerRef);
        return () => ctx.revert();
    }, { scope: containerRef, dependencies: [resolvedTheme] });

    return (
        <div ref={containerRef} className={`min-h-screen overflow-x-hidden transition-colors duration-300 ${isDark ? "bg-[#222222] text-[#e5e5e5]" : "bg-[#f4f5f7] text-[#1a1a1a]"}`} style={{ fontFamily: "'Inter', sans-serif" }}>
            <ThemeSync />
            <LandingNav />

            <main>
                {/* ── HERO ── */}
                <section className={`relative w-full overflow-visible pt-16 pb-0 transition-colors duration-300 ${isDark ? "bg-[#222222]" : "bg-white"}`}>
                    <style>{`@keyframes heroBreathe { 0%,100%{transform:scale(1);opacity:.85}50%{transform:scale(1.06);opacity:1} }`}</style>

                    {!isDark && <div className="absolute top-[-100px] left-[-100px] w-[800px] h-[800px] rounded-full pointer-events-none z-0" style={{ background: "radial-gradient(circle,#fdf0ff 0%,#f5f7ff 40%,transparent 70%)", filter: "blur(40px)", animation: "heroBreathe 8s ease-in-out infinite alternate" }} />}
                    {isDark && <div className="absolute top-0 left-0 w-[500px] h-full pointer-events-none z-0 opacity-30" style={{ background: "radial-gradient(ellipse at 0% 50%,rgba(74,124,255,0.2) 0%,transparent 60%)" }} />}

                    {!isDark && <>
                        <div className="absolute -top-20 -right-20 w-[500px] h-[500px] rounded-full opacity-[0.06]" style={{ background: BLUE }} />
                        <div className="absolute top-40 -left-16 w-[250px] h-[250px] rounded-full opacity-[0.05]" style={{ background: BLUE }} />
                        <svg className="absolute top-16 right-[14%] w-20 h-20 opacity-20 z-0" viewBox="0 0 100 100"><circle cx="50" cy="50" r="42" fill="none" stroke={BLUE} strokeWidth="2.5" strokeDasharray="8 5" /></svg>
                        <svg className="absolute top-10 left-[8%] w-4 h-4 opacity-30 z-0" viewBox="0 0 20 20"><circle cx="10" cy="10" r="8" fill={BLUE} /></svg>
                    </>}
                    {isDark && <>
                        <div className="absolute right-[20%] top-[20%] w-[150px] h-[150px] rounded-full border-2 border-dashed border-blue-500 opacity-20 z-0" />
                        <div className="absolute right-[15%] top-[15%] w-3 h-3 rounded-full bg-blue-500 opacity-40 z-0" />
                    </>}

                    {/* Desktop absolute image — shifted left compared to before */}
                    <div ref={imageRef} style={{ opacity: 0 }} className="absolute right-[-5%] lg:right-[0%] top-0 w-[48%] max-w-[760px] hidden lg:block h-[90vh] z-10 pointer-events-none">
                        <img src="/image-removebg-preview.png" alt="About Mockr" className="absolute top-0 bottom-[120px] left-0 w-full h-full object-contain object-left" />
                    </div>

                    <div className="w-full max-w-[1200px] mx-auto px-6 relative z-10">
                        <div className="grid lg:grid-cols-2 gap-12 items-center">
                            {/* Left text */}
                            <div ref={textRef} style={{ opacity: 0 }} className="flex flex-col gap-6 pt-4 pb-24 md:pt-6 md:pb-36">
                                <h1 className={`text-[3.8rem] md:text-[5rem] leading-[1.05] font-extrabold tracking-tight ${isDark ? "text-[#e5e5e5]" : "text-[#1a1a1a]"}`}>
                                    About{" "}
                                    <span style={{ color: BLUE }}>Mockr.</span>
                                </h1>
                                <p className={`text-[18px] md:text-[20px] font-medium leading-[1.65] max-w-lg ${isDark ? "text-[#999]" : "text-[#6b7280]"}`}>
                                    Mockr is your all-in-one platform to land your dream job. AI mock interviews, resume building, live coding, system design, and real-time feedback, everything you need, in one place.
                                </p>
                                <div>
                                    <Link href="/login?tab=signup" className="inline-flex items-center gap-2 bg-[#FFE500] text-[#1a1a1a] px-8 py-4 rounded-full font-semibold text-[16px] hover:bg-[#ffd900] transition-colors">
                                        Get Started
                                        <span className="material-symbols-outlined text-xl">arrow_forward</span>
                                    </Link>
                                </div>
                            </div>
                            {/* Mobile image */}
                            <div className="relative flex lg:hidden items-center justify-end overflow-hidden pb-10">
                                <div className="w-[100%] translate-x-[15%]">
                                    <img src="/image-removebg-preview.png" alt="About Mockr" className="w-full h-auto" />
                                </div>
                            </div>
                        </div>
                    </div>
                </section>

                {/* ── OUR MISSION — image left, text right, slide from sides ── */}
                <section className={`mission-section py-16 md:py-20 relative transition-colors duration-300 ${isDark ? "bg-[#2a2a2a]" : "bg-white"}`}>
                    {/* Dark mode transition from Hero */}
                    {isDark && <div className="absolute top-0 left-0 w-full h-24 bg-gradient-to-b from-[#222222] to-transparent pointer-events-none" />}

                    <div className="max-w-[1200px] mx-auto px-6 grid lg:grid-cols-2 gap-16 items-center">
                        <div className="mission-img rounded-[2.5rem] overflow-hidden shadow-xl">
                            <img src="/story.png" alt="Our Mission" className="w-full h-auto object-cover" />
                        </div>
                        <div className="mission-text flex flex-col gap-6">
                            <div>
                                <div className="flex items-center justify-center mb-4">
                                    <span className="text-[14px] font-black tracking-widest text-[#4A7CFF] uppercase">About Us</span>
                                </div>
                                <h2 className={`text-[2.5rem] md:text-[3.2rem] font-black leading-[1.1] mb-6 ${isDark ? "text-[#e5e5e5]" : "text-[#1a1a1a]"}`}>
                                    To replace anxiety with{" "}
                                    <span className="italic" style={{ color: BLUE }}>readiness.</span>
                                </h2>
                                <p className={`text-lg leading-relaxed ${isDark ? "text-[#999]" : "text-[#555]"}`}>
                                    We believe that technical talent should never be held back by the &quot;interview game.&quot; Our mission is to provide an elite, AI-powered preparation ecosystem that levels the playing field regardless of background or budget.
                                </p>
                            </div>
                            <div className={`grid grid-cols-2 gap-4 pt-8 border-t ${isDark ? "border-gray-700" : "border-gray-100"}`}>
                                {[
                                    { icon: "psychology", title: "Adaptive AI", desc: "Tailored to your skill gap" },
                                    { icon: "star", title: "Elite Standards", desc: "Targeted for L5+ roles" },
                                    { icon: "analytics", title: "Actionable Data", desc: "Granular performance logs" },
                                    { icon: "verified", title: "Total Readiness", desc: "Zero anxiety, pure mastery" }
                                ].map((item) => (
                                    <div key={item.title} className={`p-4 rounded-2xl flex flex-col gap-2 transition-all group hover:bg-gradient-to-br hover:from-[#4A7CFF] hover:to-[#00D4FF] hover:shadow-lg hover:shadow-blue-500/20 ${isDark ? "bg-[#333] border border-gray-800" : "bg-white border border-gray-100 shadow-[0_4px_12px_rgba(0,0,0,0.03)]"}`}>
                                        <span className="material-symbols-outlined text-[#4A7CFF] text-[20px] group-hover:text-white transition-colors">{item.icon}</span>
                                        <div>
                                            <div className={`text-[14px] font-black group-hover:text-white transition-colors ${isDark ? "text-white" : "text-[#1a1a1a]"}`}>{item.title}</div>
                                            <div className={`text-[10px] font-bold uppercase tracking-wider group-hover:text-white/80 transition-colors ${isDark ? "text-gray-500" : "text-gray-400"}`}>{item.desc}</div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                </section>

                {/* ── OUR STORY — numbered cards left, quote right ── */}
                <section className="story-section py-16 md:py-20 px-6 relative overflow-hidden">
                    {/* Gradient transition from Mission */}
                    <div className={`absolute top-0 left-0 w-full h-32 bg-gradient-to-b ${isDark ? "from-[#2a2a2a] to-transparent" : "from-white to-transparent"} pointer-events-none`} />

                    <div className="max-w-[1200px] mx-auto grid lg:grid-cols-2 gap-16 items-start">
                        {/* Left: numbered cards */}
                        <div className="flex flex-col gap-6">
                            {[
                                { num: "1", title: "The Frustration", desc: "A group of engineers kept watching brilliant friends get rejected not because they couldn't code, but because they didn't know how to play the interview game." },
                                { num: "2", title: "The Idea", desc: "We realized elite interview coaching was a luxury. Expensive coaches, fragmented tools, zero real feedback. We decided to fix that with AI." },
                                { num: "3", title: "Where We Are", desc: "We're early and growing. Every user session helps us build something that feels less like a tool and more like the mentor we all wished we had." }
                            ].map((item) => (
                                <div
                                    key={item.num}
                                    className="story-card p-7 rounded-[24px] flex gap-5 items-start transition-all duration-300 relative overflow-hidden"
                                >
                                    {/* Fading Background */}
                                    <div
                                        className={`absolute inset-0 z-0 transition-colors duration-300 ${isDark ? "bg-[#2a2a2a]" : "bg-white shadow-[0_10px_40px_rgba(0,0,0,0.03)]"
                                            }`}
                                        style={{
                                            maskImage: 'linear-gradient(to bottom, black 20%, transparent 100%)',
                                            WebkitMaskImage: 'linear-gradient(to bottom, black 20%, transparent 100%)'
                                        }}
                                    />

                                    {/* Content (Fully Opaque) */}
                                    <div className="relative z-10 flex gap-5 items-start">
                                        <span className="text-5xl font-black leading-none select-none shrink-0" style={{ color: BLUE }}>{item.num}</span>
                                        <div>
                                            <h3 className={`font-bold text-lg mb-1 ${isDark ? "text-[#e5e5e5]" : "text-[#1a1a1a]"}`}>{item.title}</h3>
                                            <p className={`text-sm leading-relaxed ${isDark ? "text-[#888]" : "text-[#666]"}`}>{item.desc}</p>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>

                        {/* Right: quote block */}
                        <div className={`story-right sticky top-12 flex flex-col gap-5`}>
                            <div className="flex items-center justify-center mb-2">
                                <span className="text-[14px] font-black tracking-widest text-[#4A7CFF] uppercase">Our Story</span>
                            </div>
                            <h2 className={`text-[2.5rem] md:text-[3rem] font-black leading-[1.1] ${isDark ? "text-[#e5e5e5]" : "text-[#1a1a1a]"}`}>
                                We are the{" "}
                                <span className="italic" style={{ color: BLUE }}>mentors</span>{" "}
                                we wished we had.
                            </h2>
                            <p className={`text-lg leading-relaxed ${isDark ? "text-[#999]" : "text-[#555]"}`}>
                                Mockr didn&apos;t start in a boardroom. It started with late-night sessions, rejected offers, and a shared question why is good interview prep only for those who can afford it?
                            </p>
                            <blockquote className={`p-7 rounded-2xl border-l-4 border-[#4A7CFF] italic text-lg font-medium ${isDark ? "bg-[#2a2a2a] text-[#a8b3cf]" : "bg-blue-50 text-[#444]"}`}>
                                &quot;Elite interview preparation shouldn&apos;t be a luxury. We&apos;re leveling the playing field, one simulation at a time.&quot;
                                <div className={`mt-4 text-sm font-bold not-italic ${isDark ? "text-[#e5e5e5]" : "text-[#1a1a1a]"}`}>- Mockr</div>
                            </blockquote>
                        </div>
                    </div>
                </section>

                {/* ── WHAT WE'RE BUILDING — Uber-style alternating rows ── */}
                <section className={`build-section transition-colors duration-300 relative ${isDark ? "bg-[#111111]" : "bg-white"}`}>
                    {/* Gradient transition from Story */}
                    <div className={`absolute top-0 left-0 w-full h-32 bg-gradient-to-b ${isDark ? "from-[#222222] to-transparent" : "from-[#f4f5f7] to-transparent"} pointer-events-none`} />

                    {/* Section header */}
                    <div className="max-w-[1200px] mx-auto px-6 pt-12 pb-6 text-center relative z-10">
                        <h2 className={`build-card opacity-0 text-[2.5rem] md:text-[3.5rem] font-black leading-[1.1] mb-4 ${isDark ? "text-white" : "text-[#1a1a1a]"}`}>
                            What we&apos;re <span style={{ color: BLUE }}>building.</span>
                        </h2>
                        <p className={`build-card opacity-0 text-lg max-w-2xl mx-auto ${isDark ? "text-gray-400" : "text-[#555]"}`}>
                            One platform. Everything you need to go from first application to signed offer.
                        </p>
                    </div>

                    {[
                        {
                            title: "The All-In-One Hub",
                            desc: "Unified question banks, mock sessions, and analytics. Track your entire journey from application to signed offer in one streamlined workflow.",
                            img: "/question_bank-removebg-preview.png",
                            imgBg: isDark ? "#2a2a1e" : "#fffbeb",
                            flip: false,
                        },
                        {
                            title: "Technical Tutor",
                            desc: "A high-fidelity mentor that understands your code and critiques your design. It adapts to your speed for a bespoke path to mastery.",
                            img: "/AI_tutor_new.png",
                            imgBg: isDark ? "#1e2a3a" : "#eaf2ff",
                            flip: true,
                        },
                        {
                            title: "Peer-to-Peer Interview",
                            desc: "Live practice with ambitious engineers. Give and receive feedback to simulate real interview dynamics while building your professional network.",
                            img: "/smart-removebg-preview.png",
                            imgBg: isDark ? "#1e2e1e" : "#f0fdf4",
                            flip: false,
                        },
                        {
                            title: "High-Fidelity Simulations",
                            desc: "Real-time voice and coding environments. Practice under pressure with simulations that replicate the exact standards of top-tier tech companies.",
                            img: "/smart-removebg-preview.png",
                            imgBg: isDark ? "#2a1e3a" : "#f5f3ff",
                            flip: true,
                        },
                    ].map((item, i) => (
                        <div
                            key={i}
                            className={`build-row transition-colors duration-300`}
                        >
                            <div className={`max-w-[1200px] mx-auto px-6 py-4 md:py-6 flex flex-col ${item.flip ? "lg:flex-row-reverse" : "lg:flex-row"} ${!item.flip ? "lg:gap-20" : "lg:gap-12"} gap-8 items-center`}>
                                {/* Image side */}
                                <div className="build-image-side w-full lg:w-[480px] shrink-0 rounded-[2rem] overflow-hidden flex items-center justify-center" style={{ backgroundColor: item.imgBg, minHeight: "280px" }}>
                                    <img src={item.img} alt={item.title} className="w-full max-w-[360px] h-auto object-contain p-8" />
                                </div>
                                {/* Text side */}
                                <div className="build-text-side flex-1">
                                    <h3 className={`text-[1.8rem] md:text-[2.2rem] font-black mb-5 leading-tight ${isDark ? "text-white" : "text-[#1a1a1a]"}`}>
                                        {item.title}
                                    </h3>
                                    <p className={`text-lg leading-relaxed max-w-lg ${isDark ? "text-gray-400" : "text-[#555]"}`}>
                                        {item.desc}
                                    </p>
                                    <div className="mt-8">
                                        <Link href="/login?tab=signup" className="text-[#4A7CFF] font-semibold text-[15px] hover:underline inline-flex items-center gap-1">
                                            Get started
                                            <span className="material-symbols-outlined text-base">arrow_forward</span>
                                        </Link>
                                    </div>
                                </div>
                            </div>
                        </div>
                    ))}
                </section>


                {/* ── CTA ── */}
                <section className="py-16 px-6 text-center relative overflow-hidden">
                    {/* Gradient transition from Building */}
                    <div className={`absolute top-0 left-0 w-full h-32 bg-gradient-to-b ${isDark ? "from-[#111111] to-transparent" : "from-white to-transparent"} pointer-events-none`} />
                    <div className="cta-section max-w-2xl mx-auto flex flex-col items-center gap-8 relative z-10">
                        <h2 className={`text-[2rem] md:text-[2.8rem] font-black leading-tight ${isDark ? "text-[#e5e5e5]" : "text-[#1a1a1a]"}`}>
                            Help us build the future of hiring.
                        </h2>
                        <div className="flex flex-wrap justify-center gap-3">
                            <Link href="/login?tab=signup" className="bg-[#4A7CFF] text-white px-7 py-3 rounded-full font-bold text-sm hover:scale-105 transition-transform shadow-lg">
                                Join our Journey
                            </Link>
                            <Link href="/blog" className={`px-7 py-3 rounded-full font-bold text-sm border transition-all ${isDark ? "bg-[#303030] text-[#e5e5e5] border-gray-700 hover:bg-[#3a3a3a]" : "bg-white text-[#1a1a1a] border-gray-200 hover:bg-gray-50"}`}>
                                Read our Blog
                            </Link>
                        </div>
                    </div>
                </section>
            </main>

            {/* ── FOOTER — matches landing page ── */}
            <footer className="relative overflow-hidden py-16 text-[#999]" style={{ background: "linear-gradient(135deg,#000000 60%,#0c1c38 100%)" }}>
                <div className="max-w-[1200px] mx-auto px-6">
                    <div className="grid md:grid-cols-4 gap-12 mb-12">
                        <div className="md:col-span-2">
                            <img src="/logo_big_dark.png" alt="Mockr" className="h-8 w-auto mb-5" />
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
                    <div className="pt-8 border-t border-white/10 flex flex-col md:flex-row justify-between gap-4 items-center text-xs">
                        <p>© {new Date().getFullYear()} Mockr. All rights reserved.</p>
                        <div className="flex gap-4">
                            {[
                                { href: "https://x.com/practerscom?s=11", icon: <path d="M18.901 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.638 7.584H.474l8.6-9.83L0 1.154h7.594l5.243 6.932ZM17.61 20.644h2.039L6.486 3.24H4.298Z" fill="white" /> },
                                { href: "https://www.linkedin.com/company/practers/", icon: <path d="M19 0h-14c-2.761 0-5 2.239-5 5v14c0 2.761 2.239 5 5 5h14c2.762 0 5-2.239 5-5v-14c0-2.761-2.238-5-5-5zm-11 19h-3v-11h3v11zm-1.5-12.268c-.966 0-1.75-.79-1.75-1.764s.784-1.764 1.75-1.764 1.75.79 1.75 1.764-.783 1.764-1.75 1.764zm13.5 12.268h-3v-5.604c0-3.368-4-3.113-4 0v5.604h-3v-11h3v1.765c1.396-2.586 7-2.777 7 2.476v6.759z" fill="white" /> },
                            ].map(({ href, icon }) => (
                                <a key={href} href={href} target="_blank" rel="noopener noreferrer" className="w-10 h-10 rounded-full bg-[#111] border border-[#222] flex items-center justify-center hover:-translate-y-1 transition-transform shadow-lg">
                                    <svg width="15" height="15" viewBox="0 0 24 24">{icon}</svg>
                                </a>
                            ))}
                            <a href="https://www.instagram.com/trypracters" target="_blank" rel="noopener noreferrer" className="w-10 h-10 rounded-full bg-[#111] border border-[#222] flex items-center justify-center hover:-translate-y-1 transition-transform shadow-lg">
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <rect x="2" y="2" width="20" height="20" rx="5" /><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" /><line x1="17.5" y1="6.5" x2="17.51" y2="6.5" />
                                </svg>
                            </a>
                            <a href="https://t.me/practers" target="_blank" rel="noopener noreferrer" className="w-10 h-10 rounded-full bg-[#111] border border-[#222] flex items-center justify-center hover:-translate-y-1 transition-transform shadow-lg">
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="white">
                                    <path d="M23.91 3.79L20.3 20.84c-.25 1.21-.98 1.5-2 .94l-5.5-4.07-2.66 2.57c-.3.3-.55.56-1.1.56-.72 0-.6-.27-.84-.95L6.3 13.7l-5.45-1.7c-1.18-.36-1.19-1.16.26-1.75l21.26-8.2c.97-.43 1.9.24 1.53 1.73z" />
                                </svg>
                            </a>
                            <a href="https://chat.whatsapp.com/DARzbWxP9YU2ENTOa8Idj4" target="_blank" rel="noopener noreferrer" className="w-10 h-10 rounded-full bg-[#111] border border-[#222] flex items-center justify-center hover:-translate-y-1 transition-transform shadow-lg">
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="white">
                                    <path d="M.057 24l1.687-6.163a11.867 11.867 0 0 1-1.587-5.946C.16 5.335 5.495 0 12.05 0a11.817 11.817 0 0 1 8.413 3.488 11.824 11.824 0 0 1 3.48 8.414c-.003 6.557-5.338 11.892-11.893 11.892a11.9 11.9 0 0 1-5.688-1.448L.057 24zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884-.001 2.225.651 3.891 1.746 5.634l-.999 3.648 3.742-.981zm11.387-5.464c-.074-.124-.272-.198-.57-.347-.297-.149-1.758-.868-2.031-.967-.272-.099-.47-.149-.669.149-.198.297-.768.967-.941 1.165-.173.198-.347.223-.644.074-.297-.149-1.255-.462-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.521.151-.172.2-.296.3-.495.099-.198.05-.372-.025-.521-.075-.148-.669-1.611-.916-2.206-.242-.579-.487-.501-.669-.51l-.57-.01c-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.626.712.226 1.36.194 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.695.248-1.29.173-1.414z" />
                                </svg>
                            </a>
                        </div>
                    </div>
                </div>
            </footer>
        </div>
    );
}
