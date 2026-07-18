"use client";

import Link from "next/link";
import Image from "next/image";
import { useAuth } from "@/context/auth-context";

export function LandingNav() {
    const { session } = useAuth();

    return (
        <header className="sticky top-0 z-40 w-full bg-[#f4f5f7]/90 backdrop-blur-md border-b border-[#e8e8e8] dark:bg-[#222222]/90 dark:border-[#3e3e3e] transition-colors duration-300">
            <div className="max-w-[1200px] mx-auto px-6 h-16 flex items-center justify-between">
                <Link href="/">
                    <Image src="/logo_big.png" alt="Mockr" width={180} height={51} className="h-11 w-auto" />
                </Link>
                <nav className="hidden md:flex items-center gap-9">
                    {[
                        { label: "Interviews", href: "/ai-mock-interview" },
                        { label: "Questions", href: "/interview-questions" },
                        { label: "FAQ", href: "/faq" },
                        { label: "Blog", href: "/blog" }
                    ].map((item) => (
                        <Link
                            key={item.label}
                            href={item.href}
                            className="text-[15px] font-medium tracking-tight text-[#333] dark:text-[#eff2f6] hover:text-[#4A7CFF] dark:hover:text-[#4A7CFF] transition-colors"
                        >
                            {item.label}
                        </Link>
                    ))}
                </nav>

                <div className="flex items-center gap-3">
                    <Link href="/login" className="hidden sm:block text-sm text-[#1a1a1a] dark:text-[#eff2f6] px-4 py-2">
                        Log In
                    </Link>
                    <Link
                        href="/login?tab=signup"
                        className="bg-[#1a1a1a] dark:bg-[#FFE500] text-white dark:text-[#1a1a1a] text-sm px-5 py-2.5 rounded-full hover:bg-[#333] dark:hover:bg-[#ffd900] transition-colors"
                    >
                        Get Started
                    </Link>
                </div>
            </div>
        </header>
    );
}
