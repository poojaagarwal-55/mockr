"use client";

import { useState, useEffect, useRef } from "react";
import { ForceLight } from "@/components/force-light";
import { JsonLd } from "@/components/json-ld";
import Link from "next/link";
import Image from "next/image";
import { MagnifyingGlass, CaretDown, CaretLeft } from "@phosphor-icons/react";

const FAQ_DATA = [
  {
    category: "General",
    questions: [
      { q: "What is Mockr?", a: "Mockr is an AI-powered interview preparation platform that helps you practice technical interviews with realistic AI interviewers, get instant feedback, and improve your skills with personalized coaching." },
      { q: "What kind of interviews can I practice?", a: "You can practice Data Structures & Algorithms (DSA), System Design, Behavioral interviews, CS Fundamentals, and Full Mock Interviews tailored to FAANG-level standards." },
      { q: "How do interview minutes work?", a: "Each interview session requires the planned minutes for that interview type. You can purchase minute packs or subscribe to a plan that includes monthly interview minutes. Minutes are reserved when you start an interview, and unused reserved minutes are returned after completion." },
      { q: "Is there a free trial?", a: "Yes! New users get 60 free interview minutes after phone verification. You can practice interviews and experience our AI interviewer before committing to a paid plan." },
      { q: "Where can I share feedback?", a: "We love feedback! You can reach out via email at support@practers.com or through our contact page." }
    ]
  },
  {
    category: "AI Interview",
    questions: [
      { q: "How does the AI interviewer work?", a: "Our AI interviewer conducts realistic technical interviews, asks follow-up questions based on your responses, evaluates your code in real-time, and adapts the difficulty based on your performance." },
      { q: "What programming languages are supported?", a: "We support 40+ programming languages including Python, JavaScript, Java, C++, Go, Rust, and more. You can write and execute code during the interview." },
      { q: "How does the AI feedback work?", a: "After each interview, you receive a detailed rubric-scored report analyzing your code efficiency, problem-solving approach, communication skills, and technical depth. The AI provides specific suggestions for improvement." },
      { q: "Can I practice with voice or text?", a: "You can practice in both voice mode (realistic interview simulation) and text mode (chat-based interview). Voice mode provides the most realistic experience." }
    ]
  },
  {
    category: "AI Tutor",
    questions: [
      { q: "What is the AI Tutor?", a: "AI Tutor is your personal coding assistant that helps you understand concepts, debug code, clarify doubts, and learn from your interview performance. It's available 24/7 to support your learning journey." },
      { q: "How do I use the AI Tutor?", a: "Access the AI Tutor from your dashboard. You can ask questions about algorithms, data structures, system design concepts, or get help understanding your interview feedback." },
      { q: "Can the AI Tutor help me prepare for specific companies?", a: "Yes! The AI Tutor can provide company-specific interview tips, common question patterns, and preparation strategies for FAANG and other top tech companies." }
    ]
  },
  {
    category: "Resume Builder",
    questions: [
      { q: "How does the Resume Builder work?", a: "Our Resume Builder helps you create, analyze, and optimize your resume with AI-powered insights. It checks for ATS compatibility, suggests improvements, and scores your resume." },
      { q: "Can I upload my existing resume?", a: "Yes! You can upload your existing resume in PDF format. Our AI will analyze it and provide detailed feedback on formatting, keywords, and content optimization." },
      { q: "How does resume analysis help with interviews?", a: "When you upload your resume, our AI can tailor interview questions to your experience and background, making practice sessions more relevant and personalized." }
    ]
  },
  {
    category: "Question Bank",
    questions: [
      { q: "How many questions are available?", a: "We have hundreds of curated questions across DSA, System Design, Behavioral, and CS Fundamentals categories, all aligned with FAANG-level standards." },
      { q: "Can I practice specific topics?", a: "Yes! You can filter questions by difficulty, topic (arrays, trees, graphs, etc.), and company tags to focus on specific areas you want to improve." },
      { q: "Are solutions provided?", a: "Yes, each question comes with detailed solutions, multiple approaches, time/space complexity analysis, and best practices." }
    ]
  },
  {
    category: "Interviews & Sessions",
    questions: [
      { q: "How long does a typical interview last?", a: "Interview sessions typically last 45-60 minutes, similar to real technical interviews. You can choose shorter practice sessions for specific topics." },
      { q: "Can I pause or stop an interview?", a: "Yes, you can end an interview session at any time. Your progress will be saved and you'll receive feedback on the portion you completed." },
      { q: "How do I join an interview?", a: "Navigate to your dashboard, select the interview type you want to practice, and click 'Start Interview'. Make sure your microphone is ready if using voice mode." },
      { q: "Can I run and test my code during the interview?", a: "Yes! Our built-in code execution engine supports 40+ languages and runs your code in real-time so you can test and debug during the interview." },
      { q: "What happens after an interview?", a: "You'll receive a comprehensive report with your performance scores, transcript, code analysis, and personalized improvement suggestions. You can review this with the AI Tutor for deeper insights." }
    ]
  },
  {
    category: "Pricing & Subscription",
    questions: [
      { q: "What payment methods do you accept?", a: "We accept all major credit/debit cards, UPI, and net banking through our secure payment gateway powered by Razorpay." },
      { q: "Can I cancel my subscription?", a: "Yes, you can cancel your subscription anytime from your account settings. You'll retain access until the end of your billing period." },
      { q: "Do unused minutes roll over?", a: "Subscription interview minutes reset monthly. However, minutes purchased as one-time packs never expire and can be used anytime." },
      { q: "Is there a refund policy?", a: "We offer refunds within 7 days of purchase if you haven't used any purchased minutes. Please contact support@practers.com for refund requests." }
    ]
  },
  {
    category: "Technical Support",
    questions: [
      { q: "Which browsers are supported?", a: "We recommend Google Chrome, Microsoft Edge, or Firefox for the best experience. Safari is also supported but Chrome provides the most stable performance." },
      { q: "Why isn't my microphone working?", a: "Please ensure you have granted browser permissions for microphone access. Check your system settings and refresh the page. You can also use text mode if audio issues persist." },
      { q: "Can I use Mockr on mobile?", a: "While you can browse the platform on mobile, we strongly recommend using a desktop or laptop for interview sessions to access the full coding environment and features." },
      { q: "What if I encounter a bug?", a: "Please report any bugs or issues to support@practers.com with details about what happened. We actively monitor and fix issues to ensure a smooth experience." }
    ]
  }
];

const faqJsonLd = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: FAQ_DATA.flatMap((section) =>
    section.questions.map((faq) => ({
      "@type": "Question",
      name: faq.q,
      acceptedAnswer: {
        "@type": "Answer",
        text: faq.a,
      },
    }))
  ),
};

export default function FAQPage() {
  const [searchQuery, setSearchQuery] = useState("");
  const [isDark, setIsDark] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // Check dark mode from localStorage (synced with landing page)
    const darkMode = localStorage.getItem("practers-dark") === "true";
    setIsDark(darkMode);
    document.documentElement.dataset.dark = darkMode ? "true" : "";
  }, []);

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchQuery(e.target.value);
  };

  const filteredData = FAQ_DATA.map(section => {
    const filteredQuestions = section.questions.filter(faq => 
      faq.q.toLowerCase().includes(searchQuery.toLowerCase()) || 
      faq.a.toLowerCase().includes(searchQuery.toLowerCase())
    );
    return { ...section, questions: filteredQuestions };
  }).filter(section => section.questions.length > 0);

  return (
    <ForceLight>
      <JsonLd data={faqJsonLd} />
      <div
        className={`min-h-screen antialiased overflow-x-hidden transition-colors duration-300 ${
          isDark 
            ? 'bg-[#222222] text-[#e5e5e5]' 
            : 'bg-[#f4f5f7] text-[#1a1a1a]'
        }`}
        style={{ fontFamily: "'Inter', sans-serif" }}
        suppressHydrationWarning
      >
        {/* ── Navbar ── */}
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
              { label: "Interviews", href: "/ai-mock-interview" },
              { label: "Questions", href: "/interview-questions" },
              { label: "FAQ", href: "/faq" },
              { label: "Blog", href: "/blog" }
            ].map((item) => (
              <Link 
                key={item.label} 
                href={item.href} 
                className={`text-[15px] font-medium tracking-tight transition-colors ${
                  isDark
                    ? 'text-[#e5e5e5] hover:text-[#4A7CFF]'
                    : 'text-[#333] hover:text-[#4A7CFF]'
                }`}
              >
                {item.label}
              </Link>
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

      <main className={`min-h-screen pb-0 transition-colors duration-300 ${
        isDark ? 'bg-[#222222]' : 'bg-[#f4f5f7]'
      }`}>
        {/* ── Hero Search Section ── */}
        <section className="pt-16 md:pt-24 pb-12 px-6">
          <div className="max-w-[800px] mx-auto text-center">
            <div className="flex items-center justify-center mb-10 mt-4 md:mt-0">
              <h1 className={`text-[2.6rem] md:text-[3.5rem] font-extrabold tracking-tight transition-colors duration-300 ${
                isDark ? 'text-[#e5e5e5]' : 'text-[#111]'
              }`}>
                Frequently Asked <span className="text-[#4A7CFF]">Questions</span>
              </h1>
            </div>

            {/* ── Search Bar ── */}
            <div className="relative max-w-[450px] mx-auto">
              <div className="absolute inset-y-0 left-5 flex items-center pointer-events-none">
                <MagnifyingGlass className={`w-5 h-5 ${isDark ? 'text-[#666]' : 'text-[#999]'}`} weight="bold" />
              </div>
              <input
                ref={inputRef}
                type="text"
                placeholder="Type your question here"
                defaultValue=""
                onChange={handleSearchChange}
                className={`w-full border text-[16px] rounded-full py-3.5 pl-14 pr-6 focus:outline-none focus:border-[#4A7CFF] transition-colors ${
                  isDark
                    ? 'bg-[#2a2a2a] border-[#2d3142] text-[#e5e5e5] placeholder:text-[#666] hover:border-[#3d4e6f]'
                    : 'bg-white border-[#cccccc] text-[#111] placeholder:text-[#999] hover:border-[#a0a0a0]'
                }`}
              />
            </div>
          </div>
        </section>

        {/* ── FAQ Content ── */}
        <section className="px-6 pb-20">
          <div className="max-w-[1000px] mx-auto">
            {filteredData.length === 0 ? (
              <div className={`text-center py-20 rounded-3xl border transition-colors duration-300 ${
                isDark ? 'bg-[#2a2a2a] border-[#2d3142]' : 'bg-white border-[#e8e8e8]'
              }`}>
                <p className={`text-lg font-medium transition-colors duration-300 ${
                  isDark ? 'text-[#999]' : 'text-[#555]'
                }`}>No results found for "{searchQuery}". Try adjusting your search.</p>
              </div>
            ) : (
              <div className="flex flex-col gap-14">
                {filteredData.map((section, sIdx) => (
                  <div key={sIdx}>
                    <h2 className={`text-[28px] md:text-[32px] font-extrabold mb-6 tracking-tight flex items-center gap-3 transition-colors duration-300 ${
                      isDark ? 'text-[#e5e5e5]' : 'text-[#111]'
                    }`}>
                      {section.category}
                    </h2>
                    <div className={`flex flex-col border-t transition-colors duration-300 ${
                      isDark ? 'border-[#2d3142]' : 'border-[#e8e8e8]'
                    }`}>
                      {section.questions.map((faq, i) => (
                        <details key={i} className={`group border-b overflow-hidden transition-all duration-200 ${
                          isDark ? 'border-[#2d3142]' : 'border-[#e8e8e8]'
                        }`}>
                          <summary className={`cursor-pointer py-5 md:py-6 font-semibold text-[16px] md:text-[17px] transition-colors duration-300 group-hover:text-[#4A7CFF] group-open:text-[#4A7CFF] flex justify-between items-center list-none select-none [&::-webkit-details-marker]:hidden pr-2 ${
                            isDark ? 'text-[#e5e5e5]' : 'text-[#222]'
                          }`}>
                            {faq.q}
                            <span className={`transition-colors duration-300 group-hover:text-[#4A7CFF] group-open:text-[#4A7CFF] shrink-0 ml-4 ${
                              isDark ? 'text-[#e5e5e5]' : 'text-[#111]'
                            }`}>
                              <span className="block transition-transform duration-300 group-open:rotate-180">
                                <svg fill="none" height="20" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" viewBox="0 0 24 24" width="20"><path d="M6 9l6 6 6-6"></path></svg>
                              </span>
                            </span>
                          </summary>
                          <div className={`pb-5 md:pb-6 pr-12 text-[14px] md:text-[15px] font-medium leading-[1.65] transition-colors duration-300 ${
                            isDark ? 'text-[#999]' : 'text-[#555]'
                          }`}>
                            {faq.a}
                          </div>
                        </details>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>

        {/* ── Contact Section ── */}
        <section className={`px-6 py-8 border-t transition-colors duration-300 ${
          isDark ? 'border-[#2d3142] bg-[#222222]' : 'border-[#e8e8e8] bg-[#f4f5f7]'
        }`}>
          <div className="max-w-[1000px] mx-auto text-center">
            <p className={`text-sm font-medium transition-colors duration-300 ${
              isDark ? 'text-[#999]' : 'text-[#555]'
            }`}>
              If you have any queries, contact us at{' '}
              <a 
                href="mailto:support@practers.com" 
                className="text-[#4A7CFF] hover:underline font-semibold"
              >
                support@practers.com
              </a>
            </p>
          </div>
        </section>
      </main>

      {/* ── Footer ── */}
      <footer className="relative overflow-hidden py-16 text-[#999]" style={{ 
        background: "linear-gradient(135deg, #000000 60%, #0c1c38 100%)" 
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
    </ForceLight>
  );
}
