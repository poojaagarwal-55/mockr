"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { toBlob, toPng } from "html-to-image";
import { Check, Download, Link2, Loader2, Share2, X } from "lucide-react";

function LinkedInIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M20.45 20.45h-3.55v-5.57c0-1.33-.02-3.04-1.85-3.04-1.85 0-2.14 1.45-2.14 2.94v5.66H9.36V9h3.41v1.56h.05c.47-.9 1.64-1.85 3.37-1.85 3.6 0 4.27 2.37 4.27 5.46v6.28zM5.34 7.43a2.06 2.06 0 1 1 0-4.12 2.06 2.06 0 0 1 0 4.12zM7.12 20.45H3.55V9h3.57v11.45zM22.22 0H1.77C.79 0 0 .77 0 1.73v20.54C0 23.22.79 24 1.77 24h20.45c.98 0 1.78-.78 1.78-1.73V1.73C24 .77 23.2 0 22.22 0z" />
    </svg>
  );
}

function InstagramIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="2" y="2" width="20" height="20" rx="5" ry="5" />
      <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
      <line x1="17.5" y1="6.5" x2="17.51" y2="6.5" />
    </svg>
  );
}

const STORY_W = 1080;
const STORY_H = 1920;

// Brand palette (kept in sync with globals.css --color-primary etc.)
const BRAND_PRIMARY = "#4A7CFF";

// The link printed on the share image. Stays a clean brand domain regardless of
// the current host (localhost / preview URLs). Override via NEXT_PUBLIC_SITE_URL.
const BRAND_DOMAIN = (process.env.NEXT_PUBLIC_SITE_URL || "practers.com")
  .replace(/^https?:\/\//, "")
  .replace(/\/+$/, "");

export interface AchievementShareProps {
  name: string;
  rank: number;
  score: number;
  possibleScore?: number;
  solved?: number;
  totalQuestions?: number;
  timeLabel?: string;
  contestTitle: string;
  shareUrl: string;
  mcqScore?: number;
  codingScore?: number;
  showBreakdown?: boolean;
}

function ordinalSuffix(n: number) {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return s[(v - 20) % 10] || s[v] || s[0];
}

function ordinal(n: number) {
  return n + ordinalSuffix(n);
}

// Pick the trophy art by finishing rank: 1st gold, 2nd silver, 3rd bronze,
// anything else gets the consolation trophy.
function trophyForRank(rank: number) {
  if (rank === 1) return "/gold.png";
  if (rank === 2) return "/silver.png";
  if (rank === 3) return "/bronze.png";
  return "/consolation2.png";
}

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/**
 * The 1080x1920 Instagram-story card. Rendered off-screen at full resolution
 * and captured to a PNG with html-to-image so it pixel-matches the site styling.
 */
function StoryCard({
  cardRef,
  name,
  rank,
  score,
  possibleScore,
  solved,
  totalQuestions,
  timeLabel,
  contestTitle,
}: AchievementShareProps & { cardRef: React.RefObject<HTMLDivElement | null> }) {
  const host = BRAND_DOMAIN;

  const stats: Array<{ value: string; label: string }> = [
    { value: `${score}`, label: possibleScore ? `Score / ${possibleScore}` : "Score" },
    ...(typeof solved === "number" && typeof totalQuestions === "number" && totalQuestions > 0
      ? [{ value: `${solved}/${totalQuestions}`, label: "Solved" }]
      : []),
    ...(timeLabel ? [{ value: timeLabel, label: "Finish Time" }] : []),
  ];

  return (
    <div
      style={{
        // Off-screen but fully laid out at true size (explicit width/height so
        // the card never collapses) for html-to-image capture.
        position: "fixed",
        top: 0,
        left: -100000,
        width: STORY_W,
        height: STORY_H,
        zIndex: -1,
        pointerEvents: "none",
      }}
      aria-hidden
    >
      <div
        ref={cardRef}
        style={{
          width: STORY_W,
          height: STORY_H,
          boxSizing: "border-box",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "104px 90px",
          // Use a guaranteed-available system font. html-to-image runs with
          // skipFonts (to avoid the cross-origin cssRules crash), so web fonts
          // like Outfit aren't embedded; without an explicit safe family it
          // falls back to a wide serif that makes text wrap and overlap.
          fontFamily: "Arial, 'Helvetica Neue', Helvetica, sans-serif",
          color: "#ffffff",
          position: "relative",
          overflow: "hidden",
          background: "linear-gradient(160deg, #0b1226 0%, #16245c 46%, #2f4fb5 100%)",
        }}
      >
        {/* Decorative glows */}
        <div
          style={{
            position: "absolute",
            top: -160,
            right: -120,
            width: 520,
            height: 520,
            borderRadius: "9999px",
            background: "rgba(74,124,255,0.45)",
            filter: "blur(120px)",
          }}
        />
        <div
          style={{
            position: "absolute",
            bottom: -180,
            left: -140,
            width: 560,
            height: 560,
            borderRadius: "9999px",
            background: "rgba(124,77,255,0.30)",
            filter: "blur(140px)",
          }}
        />

        {/* ===== Coding-themed background accents (subtle, behind content) ===== */}
        {[
          { x: 64, y: 150, ws: [70, 120, 44] },
          { x: 64, y: 180, ws: [100, 56] },
          { x: 64, y: 210, ws: [44, 90, 130] },
          { x: 64, y: 240, ws: [76, 34] },
          { x: 64, y: 270, ws: [120, 64, 40] },
          { x: 720, y: 1500, ws: [120, 70, 40] },
          { x: 720, y: 1530, ws: [60, 110] },
          { x: 760, y: 1560, ws: [40, 90, 120] },
          { x: 800, y: 1590, ws: [80, 40] },
          { x: 720, y: 1620, ws: [110, 60, 44] },
        ].map((row, ri) => (
          <div key={`code-${ri}`} style={{ position: "absolute", left: row.x, top: row.y, whiteSpace: "nowrap" }}>
            {row.ws.map((w, wi) => (
              <span
                key={wi}
                style={{
                  display: "inline-block",
                  width: w,
                  height: 10,
                  borderRadius: 9999,
                  marginRight: 12,
                  background: wi % 2 ? "#4666A6" : "#36486B",
                  opacity: 0.5,
                }}
              />
            ))}
          </div>
        ))}

        {/* code symbols */}
        <span style={{ position: "absolute", right: 92, top: 300, fontFamily: "monospace", fontSize: 84, fontWeight: 800, color: "#5172AE", opacity: 0.22 }}>{"</>"}</span>
        <span style={{ position: "absolute", left: 84, top: 1500, fontFamily: "monospace", fontSize: 72, fontWeight: 800, color: "#5172AE", opacity: 0.2 }}>{"</>"}</span>
        <span style={{ position: "absolute", left: 60, top: 770, fontFamily: "monospace", fontSize: 104, fontWeight: 800, color: "#4A689F", opacity: 0.18 }}>{"{ }"}</span>
        <span style={{ position: "absolute", right: 70, top: 1180, fontFamily: "monospace", fontSize: 96, fontWeight: 800, color: "#4A689F", opacity: 0.18 }}>{"{ }"}</span>

        {/* dot grids */}
        {[
          { x: 120, y: 640 },
          { x: 868, y: 760 },
        ].flatMap((g, gi) =>
          Array.from({ length: 16 }, (_, k) => {
            const r = Math.floor(k / 4);
            const c = k % 4;
            return (
              <span
                key={`dot-${gi}-${k}`}
                style={{
                  position: "absolute",
                  left: g.x + c * 22,
                  top: g.y + r * 22,
                  width: 7,
                  height: 7,
                  borderRadius: 9999,
                  background: "#3E5C95",
                  opacity: 0.38,
                }}
              />
            );
          }),
        )}

        {/*
          Five top-level blocks distributed with `justify-content: space-between`
          on the parent so the content fills the card top-to-bottom instead of
          bunching in the middle. Spacing inside each block uses marginBottom
          (never flex `gap`, which html-to-image drops during serialization).
        */}

        {/* Brand wordmark — white version, no background pill */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/logo_big_dark.png"
          alt="Mockr"
          style={{ position: "relative", height: 116, width: 280, objectFit: "contain", display: "block" }}
        />

        {/* Trophy */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={trophyForRank(rank)}
          alt="Trophy"
          style={{ position: "relative", height: 460, width: 460, objectFit: "contain", display: "block" }}
        />

        {/* Achievement statement — kept tight as one readable unit */}
        <div style={{ position: "relative", display: "flex", flexDirection: "column", alignItems: "center" }}>
          <span
            style={{
              fontSize: 80,
              fontWeight: 800,
              textAlign: "center",
              lineHeight: 1.1,
              maxWidth: 900,
              whiteSpace: "nowrap",
              marginBottom: 18,
            }}
          >
            {name}
          </span>
          <span
            style={{
              fontSize: 36,
              fontWeight: 600,
              lineHeight: 1.3,
              color: "rgba(255,255,255,0.78)",
              textAlign: "center",
              whiteSpace: "nowrap",
              marginBottom: 4,
            }}
          >
            ranked
          </span>
          <div
            style={{
              display: "flex",
              alignItems: "flex-start",
              justifyContent: "center",
              lineHeight: 1,
              marginBottom: 6,
            }}
          >
            <span style={{ fontSize: 200, fontWeight: 800, lineHeight: 1, color: "#9DB8FF" }}>{rank}</span>
            <span style={{ fontSize: 78, fontWeight: 800, lineHeight: 1, color: "#9DB8FF", marginTop: 26, marginLeft: 8 }}>
              {ordinalSuffix(rank)}
            </span>
          </div>
          <span
            style={{
              fontSize: 46,
              fontWeight: 800,
              textAlign: "center",
              maxWidth: 900,
              lineHeight: 1.2,
              whiteSpace: "nowrap",
            }}
          >
            <span style={{ color: "rgba(255,255,255,0.66)", fontWeight: 700 }}>in </span>
            <span
              style={{
                background: "linear-gradient(90deg, #FFE066 0%, #FFB020 48%, #FF7A1A 100%)",
                WebkitBackgroundClip: "text",
                backgroundClip: "text",
                color: "transparent",
                WebkitTextFillColor: "transparent",
              }}
            >
              {contestTitle}
            </span>
          </span>
        </div>

        {/* Stats row */}
        <div style={{ position: "relative", display: "flex", width: "100%", justifyContent: "center" }}>
          {stats.map((stat, i) => (
            <div
              key={stat.label}
              style={{
                flex: 1,
                maxWidth: 300,
                marginLeft: i === 0 ? 0 : 24,
                background: "rgba(255,255,255,0.08)",
                border: "1px solid rgba(255,255,255,0.16)",
                borderRadius: 32,
                padding: "36px 18px",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
              }}
            >
              <span style={{ fontSize: 62, fontWeight: 800, lineHeight: 1, marginBottom: 14 }}>{stat.value}</span>
              <span
                style={{
                  fontSize: 24,
                  fontWeight: 700,
                  lineHeight: 1.2,
                  letterSpacing: "0.1em",
                  textTransform: "uppercase",
                  color: "rgba(255,255,255,0.66)",
                  textAlign: "center",
                }}
              >
                {stat.label}
              </span>
            </div>
          ))}
        </div>

        {/* Footer / CTA */}
        <div style={{ position: "relative", display: "flex", flexDirection: "column", alignItems: "center" }}>
          <div style={{ width: 540, height: 2, background: "rgba(255,255,255,0.18)", marginBottom: 26 }} />
          <span style={{ fontSize: 36, fontWeight: 700, lineHeight: 1.3, color: "rgba(255,255,255,0.9)", whiteSpace: "nowrap", marginBottom: 24 }}>
            Think you can beat my rank?
          </span>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: BRAND_PRIMARY,
              color: "#ffffff",
              fontSize: 36,
              fontWeight: 800,
              lineHeight: 1.2,
              borderRadius: "9999px",
              padding: "24px 56px",
              boxShadow: "0 24px 60px rgba(74,124,255,0.5)",
            }}
          >
            Compete on {host}
          </div>
        </div>
      </div>
    </div>
  );
}

export function ShareAchievement(props: AchievementShareProps) {
  const [open, setOpen] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [showHint, setShowHint] = useState(false);
  const [mounted, setMounted] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);
  const blobRef = useRef<Blob | null>(null);

  // Portal the modal to <body> so its `fixed` positioning is relative to the
  // viewport, not a transformed/scrolling ancestor (which was clipping it).
  useEffect(() => setMounted(true), []);

  const shareText = `I just ranked ${ordinal(props.rank)} in ${props.contestTitle}! 🏆`;

  const generate = useCallback(async (): Promise<Blob | null> => {
    const node = cardRef.current;
    if (!node) return null;
    setGenerating(true);
    setError(null);
    try {
      if (document.fonts?.ready) await document.fonts.ready;
      // Make sure every embedded image (logo + trophy) has loaded before capturing.
      const images = Array.from(node.querySelectorAll("img"));
      await Promise.all(
        images
          .filter((img) => !img.complete)
          .map(
            (img) =>
              new Promise((resolve) => {
                img.onload = () => resolve(null);
                img.onerror = () => resolve(null);
              }),
          ),
      );
      await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));

      const options = {
        width: STORY_W,
        height: STORY_H,
        pixelRatio: 1,
        cacheBust: true,
        backgroundColor: "#0b1226",
        // Force the cloned node to its true dimensions. Without this the clone
        // can collapse to a narrow width during serialization, which makes the
        // text wrap and the whole layout bunch toward the center.
        style: {
          width: `${STORY_W}px`,
          height: `${STORY_H}px`,
          margin: "0",
          transform: "none",
        },
        // Skip inlining @font-face rules: reading cross-origin font stylesheets
        // (e.g. Google Fonts) throws a SecurityError on cssRules. The card uses
        // bold system-fallback fonts which render fine without embedding.
        skipFonts: true,
      };
      const blob = await toBlob(node, options);
      const url = await toPng(node, options);
      blobRef.current = blob;
      setPreviewUrl(url);
      return blob;
    } catch {
      setError("Couldn't build your share card. Please try again.");
      return null;
    } finally {
      setGenerating(false);
    }
  }, []);

  useEffect(() => {
    if (open && !previewUrl && !generating) void generate();
  }, [open, previewUrl, generating, generate]);

  const ensureBlob = useCallback(async () => blobRef.current ?? (await generate()), [generate]);

  // Reset the cached render whenever the sheet closes, so reopening (or editing
  // the card during development) always rebuilds a fresh image instead of
  // showing a stale PNG held in state.
  const closeSheet = useCallback(() => {
    setOpen(false);
    setPreviewUrl(null);
    setError(null);
    setShowHint(false);
    blobRef.current = null;
  }, []);

  // Save the image, then show a short hint guiding the user to post it as their
  // Instagram story. We deliberately keep the OS share sheet out of the way (it
  // posts to feed, not story) and let them upload it as a story themselves.
  const handleInstagram = useCallback(async () => {
    const blob = await ensureBlob();
    if (!blob) return;
    downloadBlob(blob, "practers-achievement.png");
    setShowHint(true);
  }, [ensureBlob]);

  const openInstagram = useCallback(() => {
    const isMobile =
      typeof navigator !== "undefined" && /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || "");
    // On mobile, deep-link straight to the story camera; on desktop just open IG.
    window.open(
      isMobile ? "instagram://story-camera" : "https://www.instagram.com",
      "_blank",
      "noopener,noreferrer",
    );
  }, []);

  const handleDownload = useCallback(async () => {
    const blob = await ensureBlob();
    if (blob) downloadBlob(blob, "practers-achievement.png");
  }, [ensureBlob]);

  const handleLinkedIn = useCallback(async () => {
    const blob = await ensureBlob();
    const statsLine =
      props.possibleScore
        ? `Scored ${props.score}/${props.possibleScore}${
            typeof props.solved === "number" && typeof props.totalQuestions === "number" && props.totalQuestions > 0
              ? `, solving ${props.solved}/${props.totalQuestions} problems`
              : ""
          }. `
        : "";
    const message = [
      "🏆 Achievement Unlocked!",
      "",
      `I just ranked ${ordinal(props.rank)} in ${props.contestTitle} on Mockr! 🚀`,
      ...(statsLine ? [statsLine.trim()] : []),
      "",
      "Every contest pushes me to think faster and code sharper — on to the next one! 💪",
      "",
      "Think you can beat my rank? Come compete 👇",
      props.shareUrl,
      "",
      "#coding #dsa #competitiveprogramming #problemsolving #practers",
    ].join("\n");
    const isMobile =
      typeof navigator !== "undefined" && /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || "");

    // Mobile only: native share sheet lets the user pick LinkedIn with the image
    // attached. On desktop the OS share sheet has no LinkedIn target, so we skip
    // it and go straight to the download + web composer flow.
    if (isMobile && blob) {
      const file = new File([blob], "practers-achievement.png", { type: "image/png" });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        try {
          await navigator.share({ files: [file], title: "My Mockr achievement", text: message });
          return;
        } catch {
          // User dismissed the sheet — fall through to the web flow.
        }
      }
    }

    // Desktop (and mobile fallback): download the image, then open LinkedIn's
    // post composer. LinkedIn's web composer supports uploading the photo.
    if (blob) downloadBlob(blob, "practers-achievement.png");
    window.open(
      `https://www.linkedin.com/feed/?shareActive=true&text=${encodeURIComponent(message)}`,
      "_blank",
      "noopener,noreferrer",
    );
  }, [ensureBlob, props.shareUrl, shareText]);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(props.shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      setError("Couldn't copy the link.");
    }
  }, [props.shareUrl]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex h-7 items-center gap-1.5 rounded-full bg-primary px-3 text-[11px] font-black uppercase leading-none tracking-[0.1em] text-white shadow-sm transition hover:bg-primary/90"
        title="Share your achievement"
      >
        <Share2 className="h-3.5 w-3.5" />
        Share
      </button>

      <StoryCard {...props} cardRef={cardRef} />

      {open && mounted && createPortal(
        <div className="fixed inset-0 z-[1000] flex items-center justify-center overflow-y-auto bg-slate-950/60 p-4 backdrop-blur-sm">
          <button type="button" aria-label="Close" className="absolute inset-0 cursor-default" onClick={closeSheet} />
          <div className="relative my-auto flex max-h-[86vh] w-full max-w-md flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-white/10 dark:bg-[#1f1f1f]">
            <div className="flex shrink-0 items-center justify-between border-b border-slate-200 px-5 py-4 dark:border-white/10">
              <div>
                <p className="text-[11px] font-extrabold uppercase tracking-[0.18em] text-slate-400 dark:text-slate-500">Share achievement</p>
                <h2 className="mt-1 font-nunito text-xl font-extrabold text-slate-950 dark:text-white">Show off your rank</h2>
              </div>
              <button
                type="button"
                onClick={closeSheet}
                className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-slate-500 transition hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-white/10"
                aria-label="Close"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
              {/* Preview — shrinks in the hint view so the steps + button fit */}
              <div
                className="mx-auto flex items-center justify-center overflow-hidden rounded-2xl border border-slate-200 bg-slate-100 dark:border-white/10 dark:bg-white/5"
                style={{ height: showHint ? "min(28vh, 240px)" : "min(40vh, 360px)", aspectRatio: "9 / 16" }}
              >
                {previewUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={previewUrl} alt="Achievement preview" className="h-full w-full object-cover" />
                ) : (
                  <div className="flex flex-col items-center gap-3 text-slate-400">
                    <Loader2 className="h-7 w-7 animate-spin" />
                    <span className="text-sm font-bold">Building your card…</span>
                  </div>
                )}
              </div>

              {error && (
                <p className="mt-3 text-center text-sm font-bold text-rose-600 dark:text-rose-300">{error}</p>
              )}

              {!showHint ? (
                <>
                  {/* Actions */}
                  <div className="mt-5 space-y-2.5">
                    <button
                      type="button"
                      onClick={() => void handleInstagram()}
                      disabled={generating}
                      className="flex w-full items-center justify-center gap-2.5 rounded-xl bg-gradient-to-r from-[#feda75] via-[#d62976] to-[#962fbf] px-5 py-3.5 text-sm font-extrabold text-white shadow-md transition hover:opacity-95 disabled:opacity-60"
                    >
                      <InstagramIcon className="h-5 w-5" />
                      Share to Instagram Story
                    </button>

                    <div className="grid grid-cols-3 gap-2.5">
                      <button
                        type="button"
                        onClick={() => void handleDownload()}
                        disabled={generating}
                        className="flex flex-col items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white px-2 py-3 text-xs font-extrabold text-slate-700 transition hover:bg-slate-50 disabled:opacity-60 dark:border-white/10 dark:bg-white/5 dark:text-slate-200 dark:hover:bg-white/10"
                      >
                        <Download className="h-5 w-5" />
                        Download
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleLinkedIn()}
                        disabled={generating}
                        className="flex flex-col items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white px-2 py-3 text-xs font-extrabold text-slate-700 transition hover:bg-slate-50 disabled:opacity-60 dark:border-white/10 dark:bg-white/5 dark:text-slate-200 dark:hover:bg-white/10"
                      >
                        <LinkedInIcon className="h-5 w-5 text-[#0a66c2]" />
                        LinkedIn
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleCopy()}
                        className="flex flex-col items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white px-2 py-3 text-xs font-extrabold text-slate-700 transition hover:bg-slate-50 dark:border-white/10 dark:bg-white/5 dark:text-slate-200 dark:hover:bg-white/10"
                      >
                        {copied ? <Check className="h-5 w-5 text-emerald-500" /> : <Link2 className="h-5 w-5" />}
                        {copied ? "Copied" : "Copy link"}
                      </button>
                    </div>
                  </div>

                  <p className="mt-4 text-center text-xs font-semibold leading-5 text-slate-400 dark:text-slate-500">
                    We&apos;ll save the image, then show you how to put it on your story.
                  </p>
                </>
              ) : (
                /* Post-save hint — framed as the user sharing their own moment */
                <div className="mt-5 rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-white/10 dark:bg-white/[0.04]">
                  <div className="flex items-center gap-2">
                    <span className="grid h-7 w-7 place-items-center rounded-full bg-emerald-500/15 text-emerald-500">
                      <Check className="h-4 w-4" />
                    </span>
                    <p className="font-nunito text-base font-extrabold text-slate-900 dark:text-white">Saved to your device</p>
                  </div>
                  <p className="mt-1.5 text-sm font-bold leading-5 text-slate-600 dark:text-slate-300">
                    Put it on your story and let everyone see what you pulled off 🔥
                  </p>
                  <ol className="mt-3 space-y-2 text-sm font-semibold leading-5 text-slate-600 dark:text-slate-300">
                    <li className="flex gap-2">
                      <span className="font-extrabold text-slate-400">1.</span>
                      <span>Open Instagram and start a new <span className="font-extrabold text-slate-800 dark:text-white">Story</span></span>
                    </li>
                    <li className="flex gap-2">
                      <span className="font-extrabold text-slate-400">2.</span>
                      <span>Pick the image you just saved from your gallery</span>
                    </li>
                    <li className="flex gap-2">
                      <span className="font-extrabold text-slate-400">3.</span>
                      <span>Tag the friends you want to challenge 👀</span>
                    </li>
                  </ol>
                  <button
                    type="button"
                    onClick={openInstagram}
                    className="mt-4 flex w-full items-center justify-center gap-2.5 rounded-xl bg-gradient-to-r from-[#feda75] via-[#d62976] to-[#962fbf] px-5 py-3 text-sm font-extrabold text-white shadow-md transition hover:opacity-95"
                  >
                    <InstagramIcon className="h-5 w-5" />
                    Open Instagram
                  </button>
                  <div className="mt-2 grid grid-cols-2 gap-2.5">
                    <button
                      type="button"
                      onClick={() => void handleDownload()}
                      className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-xs font-extrabold text-slate-700 transition hover:bg-slate-50 dark:border-white/10 dark:bg-white/5 dark:text-slate-200 dark:hover:bg-white/10"
                    >
                      Save again
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowHint(false)}
                      className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-xs font-extrabold text-slate-700 transition hover:bg-slate-50 dark:border-white/10 dark:bg-white/5 dark:text-slate-200 dark:hover:bg-white/10"
                    >
                      Back
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
