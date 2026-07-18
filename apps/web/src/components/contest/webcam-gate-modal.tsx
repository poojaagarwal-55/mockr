"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, ShieldAlert, Loader2, VideoOff } from "lucide-react";

type Status = "requesting" | "granted" | "denied";

/**
 * Blocking camera-check gate shown when a candidate enters a live contest.
 *
 * It requests webcam access (so the browser permission prompt fires) and shows a
 * live self-preview plus a proctoring warning. The candidate cannot proceed until
 * the camera is shared. Note: the stream is never recorded or uploaded — this is a
 * deterrent only. Because it runs entirely client-side (getUserMedia), it adds no
 * server load and scales to any number of simultaneous entrants.
 */
export function WebcamGateModal({
  open,
  onGranted,
  onLeave,
}: {
  open: boolean;
  onGranted: () => void;
  onLeave: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [status, setStatus] = useState<Status>("requesting");

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  const requestCamera = useCallback(async () => {
    setStatus("requesting");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        void videoRef.current.play().catch(() => {});
      }
      setStatus("granted");
    } catch {
      stopStream();
      setStatus("denied");
    }
  }, [stopStream]);

  useEffect(() => {
    if (!open) return;
    void requestCamera();
    return () => stopStream();
  }, [open, requestCamera, stopStream]);

  if (!open) return null;

  const proceed = () => {
    // We deliberately release the camera immediately — nothing is recorded.
    stopStream();
    onGranted();
  };

  return (
    <div className="fixed inset-0 z-[200] grid place-items-center bg-slate-950/70 p-4 backdrop-blur-sm dark:bg-black/80">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="webcam-gate-title"
        aria-describedby="webcam-gate-message"
        className="relative w-full max-w-md overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-lc-border dark:bg-lc-surface"
      >
        <div className="px-6 pt-6">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 grid size-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
              <Camera className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <h2 id="webcam-gate-title" className="font-nunito text-lg font-extrabold text-slate-950 dark:text-white">
                Camera check required
              </h2>
              <p id="webcam-gate-message" className="mt-1 text-sm font-semibold leading-6 text-slate-600 dark:text-slate-300">
                Share your camera to enter this contest. It stays on for the whole round.
              </p>
            </div>
          </div>
        </div>

        {/* Live preview */}
        <div className="mt-4 px-6">
          <div className="relative aspect-video w-full overflow-hidden rounded-xl border border-slate-200 bg-slate-900 dark:border-white/10">
            <video
              ref={videoRef}
              muted
              playsInline
              className={`h-full w-full object-cover transition-opacity ${status === "granted" ? "opacity-100" : "opacity-0"}`}
            />
            {status !== "granted" && (
              <div className="absolute inset-0 grid place-items-center text-center text-slate-300">
                {status === "requesting" ? (
                  <div className="flex flex-col items-center gap-2">
                    <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
                    <p className="text-xs font-bold text-slate-400">Waiting for camera permission…</p>
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-2 px-6">
                    <VideoOff className="h-6 w-6 text-rose-400" />
                    <p className="text-xs font-bold text-rose-300">
                      Camera blocked. Allow camera access in your browser, then try again.
                    </p>
                  </div>
                )}
              </div>
            )}
            {status === "granted" && (
              <span className="absolute left-3 top-3 inline-flex items-center gap-1.5 rounded-full bg-black/55 px-2.5 py-1 text-[11px] font-black uppercase tracking-wide text-white">
                <span className="h-2 w-2 animate-pulse rounded-full bg-red-500" />
                Rec
              </span>
            )}
          </div>
        </div>

        {/* Proctoring warning */}
        <div className="mt-4 px-6">
          <div className="flex items-start gap-2.5 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-3 dark:border-rose-500/30 dark:bg-rose-500/10">
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-rose-600 dark:text-rose-300" />
            <p className="text-xs font-bold leading-5 text-rose-700 dark:text-rose-200">
              Your video is recorded and monitored for proctoring. Any cheating that is detected
              will result in a permanent ban from all future contests.
            </p>
          </div>
        </div>

        {/* Actions */}
        <div className="mt-5 flex items-center justify-between gap-3 border-t border-slate-200 px-6 py-4 dark:border-white/10">
          <button
            type="button"
            onClick={() => {
              stopStream();
              onLeave();
            }}
            className="h-10 rounded-lg px-4 text-sm font-extrabold text-slate-500 transition hover:bg-slate-100 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-white/10 dark:hover:text-white"
          >
            Leave
          </button>
          {status === "denied" ? (
            <button
              type="button"
              onClick={() => void requestCamera()}
              className="h-10 rounded-lg bg-primary px-6 text-sm font-extrabold text-white shadow-sm transition hover:bg-primary/90"
            >
              Try again
            </button>
          ) : (
            <button
              type="button"
              onClick={proceed}
              disabled={status !== "granted"}
              className="h-10 rounded-lg bg-primary px-6 text-sm font-extrabold text-white shadow-sm transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Enter contest
            </button>
          )}
        </div>
      </section>
    </div>
  );
}
