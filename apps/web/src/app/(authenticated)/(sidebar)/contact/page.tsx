"use client";

import Link from "next/link";
import { useTheme } from "next-themes";
import { Footer } from "@/components/footer";

const BLUE = "#4A7CFF";

export default function ContactPage() {
    const { resolvedTheme } = useTheme();
    const isDark = resolvedTheme === "dark";

    return (
        <div className="flex flex-col h-full overflow-hidden bg-white dark:bg-lc-bg">
            {/* ── HERO SECTION ── */}
            <section className="relative pt-12 pb-12 px-6">
                <div className="max-w-[1000px] mx-auto text-center relative">
                    <div className="mb-4">
                        <h1 className={`text-[3rem] md:text-[4.5rem] font-black leading-tight tracking-tight font-outfit ${isDark ? "text-white" : "text-[#1a1a1a]"}`}>
                            Contact <span style={{ color: BLUE }}>Us.</span>
                        </h1>
                    </div>
                    
                    <p className={`text-base md:text-lg max-w-2xl mx-auto leading-relaxed font-outfit font-medium ${isDark ? "text-gray-400" : "text-[#555]"}`}>
                        Need help with your account, billing, or interview preparation workflows? Reach out and we will get back to you as quickly as possible.
                    </p>
                </div>
            </section>

            {/* ── CONTACT CARDS ── */}
            <section className="px-6 pb-6 flex-1 flex flex-col justify-center relative z-10">
                <div className="max-w-[900px] mx-auto w-full grid md:grid-cols-2 gap-6">
                    {/* Support Card */}
                    <div className={`group p-8 rounded-[2rem] transition-all duration-500 hover:-translate-y-2 hover:scale-[1.02] ${
                        isDark ? "bg-[#1f1f1f] shadow-[0_20px_50px_rgba(0,0,0,0.4)] hover:shadow-blue-500/10" 
                               : "bg-white shadow-[0_20px_40px_rgba(0,0,0,0.06)] hover:shadow-blue-500/10"
                    }`}>
                        <div className="w-12 h-12 rounded-xl bg-blue-50 dark:bg-blue-900/30 flex items-center justify-center mb-6 transition-transform duration-500 group-hover:scale-110">
                            <span className="material-symbols-outlined text-2xl text-[#4A7CFF]">mail</span>
                        </div>
                        <h3 className={`text-xl font-bold mb-2 font-outfit ${isDark ? "text-white" : "text-[#1a1a1a]"}`}>Support</h3>
                        <p className={`mb-4 text-sm leading-relaxed font-outfit ${isDark ? "text-gray-400" : "text-[#666]"}`}>
                            For technical issues or account inquiries, our support team is ready to help.
                        </p>
                        <a 
                            href="mailto:support@practers.com"
                            className="inline-flex items-center gap-2 text-base font-bold group/link font-outfit"
                            style={{ color: BLUE }}
                        >
                            support@practers.com
                            <span className="material-symbols-outlined text-lg transition-transform group-hover/link:translate-x-1">arrow_forward</span>
                        </a>
                    </div>

                    {/* Website Card */}
                    <div className={`group p-8 rounded-[2rem] transition-all duration-500 hover:-translate-y-2 hover:scale-[1.02] ${
                        isDark ? "bg-[#1f1f1f] shadow-[0_20px_50px_rgba(0,0,0,0.4)] hover:shadow-blue-500/10" 
                               : "bg-white shadow-[0_20px_40px_rgba(0,0,0,0.06)] hover:shadow-blue-500/10"
                    }`}>
                        <div className="w-12 h-12 rounded-xl bg-blue-50 dark:bg-blue-900/30 flex items-center justify-center mb-6 transition-transform duration-500 group-hover:scale-110">
                            <span className="material-symbols-outlined text-2xl text-[#4A7CFF]">language</span>
                        </div>
                        <h3 className={`text-xl font-bold mb-2 font-outfit ${isDark ? "text-white" : "text-[#1a1a1a]"}`}>Official Website</h3>
                        <p className={`mb-4 text-sm leading-relaxed font-outfit ${isDark ? "text-gray-400" : "text-[#666]"}`}>
                            Explore our latest features and interview preparation resources on our official site.
                        </p>
                        <Link 
                            href="https://www.practers.com"
                            target="_blank"
                            className="inline-flex items-center gap-2 text-base font-bold group/link font-outfit"
                            style={{ color: BLUE }}
                        >
                            www.practers.com
                            <span className="material-symbols-outlined text-lg transition-transform group-hover/link:translate-x-1">open_in_new</span>
                        </Link>
                    </div>
                </div>
            </section>

            <div className="mt-auto">
                <Footer />
            </div>
        </div>
    );
}

