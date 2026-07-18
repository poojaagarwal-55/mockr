"use client";

import Image from "next/image";
import { useState } from "react";
import { AudioLines, Mic2, Send, User } from "lucide-react";
import { TypewriterPrompt } from "./typewriter-prompt";

const heroPrompt =
  "Walk me through a project that matches this role. What problem did you solve, what did you personally own, and how did you measure the impact?";

function VoiceWave() {
  return (
    <div className="flex h-8 items-center gap-1.5 rounded-full bg-[#111827] px-3">
      {[14, 22, 30, 20, 34, 24, 16, 28, 20, 32, 18, 26].map((height, index) => (
        <span
          key={`${height}-${index}`}
          className="voice-bar w-1.5 rounded-full bg-[#8bb0ff]"
          style={{ height, animationDelay: `${index * 80}ms` }}
        />
      ))}
    </div>
  );
}

export function HeroVisual() {
  const [showCandidateVoice, setShowCandidateVoice] = useState(false);

  return (
    <div className="relative mx-auto w-full max-w-[720px] lg:-mt-6 lg:ml-6 lg:mr-0 lg:w-[720px]">
      <div className="relative w-full rounded-[2.15rem] border border-white bg-white/80 p-3 shadow-[0_32px_100px_rgba(74,124,255,0.20)] backdrop-blur dark:border-white/10 dark:bg-[#2a2a2a]/86 dark:shadow-[0_32px_100px_rgba(0,0,0,0.34)]">
        <div className="overflow-hidden rounded-[1.7rem] border border-[#dbe7ff] bg-[#f8fbff] dark:border-white/10 dark:bg-[#202020]">
          <div className="flex items-center justify-between border-b border-[#dfe7f7] bg-white/95 px-5 py-3.5 dark:border-white/10 dark:bg-[#2a2a2a]">
            <Image src="/logo_big.png" alt="Mockr" width={118} height={34} className="h-7 w-auto" />
            <div className="flex items-center gap-2">
              <div className="hidden items-center gap-2 rounded-full bg-[#eef4ff] px-3 py-1.5 text-xs font-black text-[#4A7CFF] sm:flex dark:bg-white/10 dark:text-[#9bb7ff]">
                <span className="h-2 w-2 rounded-full bg-[#0E9F82]" />
                Record
              </div>
              <div className="rounded-full bg-[#e91e63] px-4 py-2 text-xs font-black text-white shadow-[0_10px_22px_rgba(233,30,99,0.22)]">
                End Interview
              </div>
            </div>
          </div>

          <div className="grid min-h-[390px] gap-3 p-3 md:grid-cols-[0.72fr_1fr]">
            <div className="space-y-3">
              <div className="relative overflow-hidden rounded-3xl border border-[#d8e4ff] bg-[#eaf2ff] p-3.5 dark:border-white/10 dark:bg-[#273042]">
                <div className="mb-2.5 inline-flex items-center gap-2 rounded-full bg-[#31415f] px-3 py-1.5 text-xs font-black text-white shadow-[0_10px_24px_rgba(74,124,255,0.18)]">
                  <span className="h-2.5 w-2.5 rounded-full bg-[#10d3a0]" />
                  INTERVIEWER
                </div>
                <div className="mx-auto flex h-[122px] max-w-[210px] items-end justify-center rounded-[1.65rem] bg-[linear-gradient(140deg,#ffffff,#d8e6ff)] dark:bg-[linear-gradient(140deg,#343c4d,#1e2635)]">
                  <Image
                    src="/interviewer.png"
                    alt="AI interviewer preview"
                    width={190}
                    height={150}
                    className="h-[116px] w-auto object-contain"
                  />
                </div>
              </div>

              <div className="relative overflow-hidden rounded-3xl border border-[#d8e4ff] bg-[#eef2ff] p-3.5 dark:border-white/10 dark:bg-[#252b3a]">
                <div className="mb-3 inline-flex items-center gap-2 rounded-full bg-[#111827] px-3 py-1.5 text-xs font-black text-white shadow-[0_10px_24px_rgba(74,124,255,0.18)]">
                  <span className="h-2.5 w-2.5 rounded-full bg-[#10d3a0]" />
                  YOU
                </div>
                <div className="mx-auto flex h-[88px] w-[88px] items-center justify-center rounded-full border-4 border-[#cfe0ff] bg-[#dce8ff] text-[#5f769d] dark:border-[#3f5578] dark:bg-[#1d2635] dark:text-[#8aa2c9]">
                  <User className="h-7 w-7" />
                </div>
              </div>
            </div>

            <div className="flex min-h-[364px] flex-col overflow-hidden rounded-3xl border border-[#d8e4ff] bg-white dark:border-white/10 dark:bg-[#262626]">
              <div className="flex items-center gap-3 border-b border-[#e5ecfb] px-4 py-3 dark:border-white/10">
                <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-[#eef4ff] text-[#4A7CFF] dark:bg-white/10 dark:text-[#9bb7ff]">
                  <AudioLines className="h-[18px] w-[18px]" />
                </div>
                <div>
                  <p className="text-sm font-black text-[#111] dark:text-[#f4f6fb]">Interview Transcript</p>
                  <p className="text-xs font-bold text-[#7b8798] dark:text-[#9aa4b5]">Voice answers captured live</p>
                </div>
              </div>

              <div className="flex-1 space-y-3 p-4">
                <div className="h-[148px] w-[96%] rounded-2xl bg-[#f1f5ff] p-3.5 dark:bg-[#1f2938]">
                  <p className="text-xs font-black uppercase tracking-[0.14em] text-[#4A7CFF]">
                    Interviewer
                  </p>
                  <TypewriterPrompt
                    text={heroPrompt}
                    onComplete={() => setShowCandidateVoice(true)}
                  />
                </div>

                <div
                  className={`ml-auto mt-1 w-[78%] rounded-2xl bg-[#111827] p-3 text-white transition-opacity duration-700 ease-out ${
                    showCandidateVoice
                      ? "opacity-100"
                      : "pointer-events-none opacity-0"
                  }`}
                >
                  <p className="text-xs font-black uppercase tracking-[0.14em] text-[#93b5ff]">
                    Candidate voice
                  </p>
                  <div className="mt-2">
                    <VoiceWave />
                  </div>
                </div>
              </div>

              <div className="border-t border-[#e5ecfb] p-3 dark:border-white/10">
                <div className="flex items-center gap-3 rounded-2xl border border-[#dce6fb] bg-[#f8fbff] px-4 py-2.5 dark:border-white/10 dark:bg-[#202020]">
                  <span className="flex-1 text-sm font-semibold text-[#8a97aa] dark:text-[#8f99aa]">
                    Type to chat alongside voice...
                  </span>
                  <Send className="h-5 w-5 text-[#4A7CFF]" />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
