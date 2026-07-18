"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";

/**
 * Promo banner for the peer-to-peer interview & practice feature, styled after a
 * flat "support team" hero: cyan gradient on the left with heading + CTA, and a
 * white area on the right holding the two-people illustration, split by a single
 * smooth two-tone swoosh. Rendered on the contests hub and result page.
 *
 * The dismiss (X) only hides it for the current view — it reappears on reload
 * (state is intentionally not persisted).
 */
export function PeerInterviewBanner({ className = "" }: { className?: string }) {
  const [dismissed, setDismissed] = useState(false);

  if (dismissed) return null;

  const dismiss = (event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    setDismissed(true);
  };

  return (
    <Link
      href="/interviews/peer"
      className={`group relative block min-h-[150px] overflow-hidden rounded-2xl bg-[#45c1ea] shadow-[0_18px_50px_-14px_rgba(56,189,248,0.5)] sm:min-h-[196px] sm:bg-white ${className}`}
    >
      {/* Background: white canvas with a single smooth two-tone cyan swoosh */}
      <svg
        className="absolute inset-0 h-full w-full"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <defs>
          <linearGradient id="peerCyan" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#7fd6f1" />
            <stop offset="60%" stopColor="#45c1ea" />
            <stop offset="100%" stopColor="#2fb4e0" />
          </linearGradient>
        </defs>
        {/* Lighter accent, a touch wider and sitting behind the main swoosh */}
        <path className="hidden sm:block" d="M0 0 L57 0 C70 27 62 63 48 100 L0 100 Z" fill="#b6e6f7" />
        {/* Main cyan swoosh — one smooth S-curve (desktop only) */}
        <path className="hidden sm:block" d="M0 0 L50 0 C63 27 55 63 41 100 L0 100 Z" fill="url(#peerCyan)" />
        {/* Mobile: plain full-width cyan, no swoosh or illustration */}
        <rect className="sm:hidden" width="100" height="100" fill="url(#peerCyan)" />
      </svg>

      {/* The illustration — oversized and bled past the top/bottom so it reads
          large on the white side without making the whole banner tall. */}
      <div className="pointer-events-none absolute inset-y-[-16%] right-3 hidden w-[56%] sm:block md:right-5 md:w-[54%]">
        <Image
          src="/peertopeerbanner.png"
          alt="Two people in a peer mock interview"
          fill
          sizes="(max-width: 768px) 65vw, 700px"
          className="object-contain object-right transition-transform duration-500 ease-out group-hover:scale-[1.03]"
          priority
        />
      </div>

      {/* Left copy + CTA */}
      <div className="relative z-10 flex h-full max-w-full flex-col justify-center px-5 py-5 sm:max-w-[52%] sm:px-9 sm:py-6">
        <h2 className="font-nunito text-[22px] font-black leading-tight tracking-tight text-[#14173f] sm:text-[30px]">
          Peer-to-Peer Mock Interviews
        </h2>
        <p className="mt-1.5 max-w-md text-[13px] font-semibold leading-5 text-[#183a4d] sm:mt-2 sm:text-sm sm:leading-6 sm:text-[#2c3e52]">
          Pair up with real peers, run timed interview rounds, and get instant feedback.
        </p>

        <span className="mt-4 inline-flex w-fit items-center gap-2 rounded-full bg-white px-7 py-2.5 text-[13px] font-black uppercase tracking-[0.12em] text-[#0f77b8] shadow-md transition-all group-hover:-translate-y-0.5 group-hover:shadow-lg sm:mt-5 sm:px-8 sm:text-sm sm:tracking-[0.14em]">
          Start Now
        </span>
      </div>

      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss banner"
        className="absolute right-3 top-3 z-20 grid h-7 w-7 place-items-center rounded-full text-[#14173f]/40 transition-colors hover:bg-[#14173f]/10 hover:text-[#14173f]"
      >
        <span className="text-lg leading-none">&times;</span>
      </button>
    </Link>
  );
}
