import Link from "next/link";
import Image from "next/image";

type FooterProps = {
    variant?: "default" | "dark";
};

export function Footer({ variant = "default" }: FooterProps) {
    if (variant === "dark") {
        return (
            <footer className="relative overflow-hidden py-16 text-[#999]" style={{ background: "linear-gradient(135deg, #000000 60%, #0c1c38 100%)" }}>
                <div className="max-w-[1200px] mx-auto px-6">
                    <div className="grid md:grid-cols-4 gap-12 mb-12">
                        <div className="md:col-span-2">
                            <Image src="/logo_big_dark.png" alt="Mockr" width={140} height={40} className="h-8 w-auto mb-5" />
                            <p className="max-w-xs text-sm leading-relaxed">
                                The only AI-native interview preparation platform designed for the highest level of technical assessment.
                            </p>
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
                    </div>
                </div>
            </footer>
        );
    }

    return (
        <footer className="w-full mt-12 py-8 bg-transparent">
            <div className="max-w-7xl mx-auto px-8 flex flex-col md:flex-row items-center justify-between gap-4">
                <div className="flex items-center gap-2">
                    <span className="text-xs md:text-sm font-semibold font-nunito text-slate-500 dark:text-[#ababab]">
                        © {new Date().getFullYear()} Mockr. All rights reserved.
                    </span>
                </div>
                <div className="flex items-center flex-wrap justify-center md:justify-end gap-x-6 gap-y-2">
                    <Link href="/about" className="text-xs md:text-sm font-medium font-nunito text-slate-500 hover:text-slate-900 dark:text-[#ababab] dark:hover:text-white transition-colors">
                        About Us
                    </Link>
                    <Link href="/contact" className="text-xs md:text-sm font-medium font-nunito text-slate-500 hover:text-slate-900 dark:text-[#ababab] dark:hover:text-white transition-colors">
                        Contact Us
                    </Link>
                    <Link href="/terms" className="text-xs md:text-sm font-medium font-nunito text-slate-500 hover:text-slate-900 dark:text-[#ababab] dark:hover:text-white transition-colors">
                        Terms & Conditions
                    </Link>
                    <Link href="/privacy" className="text-xs md:text-sm font-medium font-nunito text-slate-500 hover:text-slate-900 dark:text-[#ababab] dark:hover:text-white transition-colors">
                        Privacy Policy
                    </Link>
                    <Link href="/settings/licenses" className="text-xs md:text-sm font-medium font-nunito text-slate-500 hover:text-slate-900 dark:text-[#ababab] dark:hover:text-white transition-colors">
                        Licenses
                    </Link>
                </div>
            </div>
        </footer>
    );
}
