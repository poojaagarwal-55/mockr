"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { api } from "@/lib/api";

// ── Types ────────────────────────────────────────────────────

export type RecordingState =
    | "idle"
    | "requesting"
    | "recording"
    | "uploading"
    | "done"
    | "failed";

type UseRecordingOptions = {
    sessionId: string;
    micAudioTrack: MediaStreamTrack | null;
    aiAudioStream: MediaStream | null;
    ensureAiAudioStream: () => MediaStream | null;
    isPremium: boolean;
    token: string | undefined;
    onError: (msg: string) => void;
};

type UseRecordingReturn = {
    recordingState: RecordingState;
    uploadProgress: number;
    durationSec: number;
    startRecording: () => Promise<void>;
    stopRecording: () => Promise<void>;
};

// ── Detect supported mimeType ────────────────────────────────

function getSupportedMimeType(): string {
    if (typeof window === "undefined" || !("MediaRecorder" in window)) return "video/webm";
    const candidates = [
        "video/webm;codecs=vp8,opus",
        "video/webm;codecs=vp9,opus",
        "video/webm",
        "video/mp4",
    ];
    return candidates.find((m) => MediaRecorder.isTypeSupported(m)) ?? "video/webm";
}

// ── Constants ────────────────────────────────────────────────

const PART_TARGET_BYTES = 5 * 1024 * 1024; // 5 MB — R2 minimum part size
const TIMESLICE_MS = 2000; // MediaRecorder fires ondataavailable every 2s

// ── Hook ─────────────────────────────────────────────────────

export function useRecording({
    sessionId,
    micAudioTrack,
    aiAudioStream,
    ensureAiAudioStream,
    isPremium,
    token,
    onError,
}: UseRecordingOptions): UseRecordingReturn {
    const [recordingState, setRecordingState] = useState<RecordingState>("idle");
    const [uploadProgress, setUploadProgress] = useState(0);
    const [durationSec, setDurationSec] = useState(0);

    // Refs to avoid stale closures
    const recorderRef = useRef<MediaRecorder | null>(null);
    const screenStreamRef = useRef<MediaStream | null>(null);
    const recordingAudioContextRef = useRef<AudioContext | null>(null);
    const uploadIdRef = useRef<string | null>(null);
    const r2KeyRef = useRef<string | null>(null);
    const bufferRef = useRef<Blob[]>([]);
    const bufferSizeRef = useRef(0);
    const partNumberRef = useRef(1);
    const uploadedPartsRef = useRef<{ partNumber: number; ETag: string }[]>([]);
    const totalBytesUploadedRef = useRef(0);
    const startTimeRef = useRef(0);
    const durationTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const recordingStateRef = useRef<RecordingState>("idle");
    const mimeTypeRef = useRef("video/webm");

    // Keep ref in sync with state
    useEffect(() => {
        recordingStateRef.current = recordingState;
    }, [recordingState]);

    // Duration timer
    useEffect(() => {
        if (recordingState === "recording") {
            startTimeRef.current = Date.now();
            durationTimerRef.current = setInterval(() => {
                setDurationSec(Math.floor((Date.now() - startTimeRef.current) / 1000));
            }, 1000);
        } else {
            if (durationTimerRef.current) {
                clearInterval(durationTimerRef.current);
                durationTimerRef.current = null;
            }
        }
        return () => {
            if (durationTimerRef.current) {
                clearInterval(durationTimerRef.current);
            }
        };
    }, [recordingState]);

    // ── Flush buffer to R2 ──────────────────────────────────

    const flushBuffer = useCallback(async () => {
        if (bufferRef.current.length === 0) return;

        const partBlob = new Blob(bufferRef.current, { type: mimeTypeRef.current });
        bufferRef.current = [];
        bufferSizeRef.current = 0;

        const currentPart = partNumberRef.current;
        partNumberRef.current++;

        // Get presigned URL from API
        const { presignedUrl } = await api.post<{ presignedUrl: string }>(
            `/interviews/${sessionId}/recording/presign-part`,
            { uploadId: uploadIdRef.current, partNumber: currentPart },
            token
        );

        // PUT directly to R2 — no API server bandwidth used
        const res = await fetch(presignedUrl, {
            method: "PUT",
            body: partBlob,
            headers: { "Content-Type": mimeTypeRef.current },
        });

        if (!res.ok) {
            throw new Error(`Part ${currentPart} upload failed: ${res.status}`);
        }

        // R2 returns ETag in response header — required for CompleteMultipartUpload
        const etag = res.headers.get("ETag");
        if (!etag) {
            throw new Error(`Part ${currentPart}: R2 did not return ETag header (check CORS ExposeHeaders)`);
        }

        uploadedPartsRef.current.push({ partNumber: currentPart, ETag: etag });
        totalBytesUploadedRef.current += partBlob.size;

        // Progress: rough estimate based on elapsed time (assume 30 min max)
        const elapsedSec = (Date.now() - startTimeRef.current) / 1000;
        const estimatedProgress = Math.min(90, Math.round((elapsedSec / 1800) * 100));
        setUploadProgress(estimatedProgress);
    }, [sessionId, token]);

    // ── Start Recording ─────────────────────────────────────

    const startRecording = useCallback(async () => {
        if (!isPremium || recordingStateRef.current !== "idle") return;

        setRecordingState("requesting");
        mimeTypeRef.current = getSupportedMimeType();

        try {
            // getDisplayMedia MUST be called directly inside user gesture handler
            const screenStream = await navigator.mediaDevices.getDisplayMedia({
                video: { width: 1920, height: 1080, frameRate: 15 },
                audio: false,
            });

            // Combine screen video + interview audio into one stream.
            const tracks: MediaStreamTrack[] = [...screenStream.getVideoTracks()];
            const activeAiAudioStream = aiAudioStream ?? ensureAiAudioStream();
            const liveAiAudioTracks = activeAiAudioStream
                ?.getAudioTracks()
                .filter((track) => track.readyState === "live") ?? [];

            if (liveAiAudioTracks.length > 0) {
                const audioContext = new AudioContext();
                const mixedAudioDestination = audioContext.createMediaStreamDestination();

                if (micAudioTrack && micAudioTrack.readyState === "live") {
                    const micSource = audioContext.createMediaStreamSource(new MediaStream([micAudioTrack]));
                    micSource.connect(mixedAudioDestination);
                }

                for (const aiAudioTrack of liveAiAudioTracks) {
                    const aiSource = audioContext.createMediaStreamSource(new MediaStream([aiAudioTrack]));
                    aiSource.connect(mixedAudioDestination);
                }

                tracks.push(...mixedAudioDestination.stream.getAudioTracks());
                recordingAudioContextRef.current = audioContext;
            } else if (micAudioTrack && micAudioTrack.readyState === "live") {
                tracks.push(micAudioTrack);
            }
            const combinedStream = new MediaStream(tracks);
            screenStreamRef.current = screenStream;

            // Create multipart upload session on the server
            const { uploadId, r2Key } = await api.post<{
                recordingId: string;
                uploadId: string;
                r2Key: string;
            }>(
                `/interviews/${sessionId}/recording/start`,
                { mimeType: mimeTypeRef.current },
                token
            );
            uploadIdRef.current = uploadId;
            r2KeyRef.current = r2Key;

            // Reset part tracking
            bufferRef.current = [];
            bufferSizeRef.current = 0;
            partNumberRef.current = 1;
            uploadedPartsRef.current = [];
            totalBytesUploadedRef.current = 0;

            // Set up MediaRecorder
            const recorder = new MediaRecorder(combinedStream, {
                mimeType: mimeTypeRef.current,
                videoBitsPerSecond: 1_500_000,
                audioBitsPerSecond: 128_000,
            });
            recorderRef.current = recorder;

            // Accumulate chunks, flush when ≥ 5 MB
            recorder.ondataavailable = async (e) => {
                if (e.data.size === 0) return;
                bufferRef.current.push(e.data);
                bufferSizeRef.current += e.data.size;

                if (bufferSizeRef.current >= PART_TARGET_BYTES) {
                    try {
                        await flushBuffer();
                    } catch (err) {
                        console.error("[Recording] Part upload failed:", err);
                        onError("Recording chunk upload failed. Recording will continue, but some data may be lost.");
                    }
                }
            };

            // Handle user stopping the screen share via the browser's native "Stop sharing" button
            screenStream.getVideoTracks()[0]?.addEventListener("ended", () => {
                if (recorderRef.current && recorderRef.current.state !== "inactive") {
                    recorderRef.current.stop();
                }
            });

            recorder.onstop = async () => {
                setRecordingState("uploading");
                try {
                    // Final flush — last part is allowed to be < 5 MB
                    await flushBuffer();

                    const finalDuration = Math.floor((Date.now() - startTimeRef.current) / 1000);

                    // Tell API to assemble all parts
                    await api.post(
                        `/interviews/${sessionId}/recording/complete`,
                        {
                            uploadId: uploadIdRef.current,
                            parts: uploadedPartsRef.current.map((p) => ({
                                partNumber: p.partNumber,
                                ETag: p.ETag,
                            })),
                            durationSec: finalDuration,
                            fileSizeBytes: totalBytesUploadedRef.current,
                        },
                        token
                    );

                    setUploadProgress(100);
                    setRecordingState("done");
                } catch (err) {
                    console.error("[Recording] Complete failed:", err);
                    setRecordingState("failed");
                    onError("Recording upload failed. Please check your connection.");
                } finally {
                    // Clean up screen stream tracks
                    screenStreamRef.current?.getTracks().forEach((t) => t.stop());
                    screenStreamRef.current = null;
                    recordingAudioContextRef.current?.close().catch(() => { });
                    recordingAudioContextRef.current = null;
                }
            };

            recorder.onerror = () => {
                setRecordingState("failed");
                onError("Recording error occurred.");
                screenStreamRef.current?.getTracks().forEach((t) => t.stop());
                screenStreamRef.current = null;
                recordingAudioContextRef.current?.close().catch(() => { });
                recordingAudioContextRef.current = null;
            };

            recorder.start(TIMESLICE_MS);
            setRecordingState("recording");
        } catch (err: any) {
            console.error("[Recording] Start failed:", err);
            setRecordingState("idle");
            // Don't show error for user cancellation of getDisplayMedia
            if (err?.name !== "NotAllowedError" && err?.name !== "AbortError") {
                onError(err?.message || "Failed to start recording.");
            }
            screenStreamRef.current?.getTracks().forEach((t) => t.stop());
            screenStreamRef.current = null;
            recordingAudioContextRef.current?.close().catch(() => { });
            recordingAudioContextRef.current = null;
        }
    }, [isPremium, sessionId, micAudioTrack, aiAudioStream, ensureAiAudioStream, token, flushBuffer, onError]);

    // ── Stop Recording ──────────────────────────────────────

    const stopRecording = useCallback(async () => {
        if (recorderRef.current && recorderRef.current.state !== "inactive") {
            recorderRef.current.stop();
            // onstop handler does the final flush + complete
        }
    }, []);

    // ── Cleanup on unmount ───────────────────────────────────

    useEffect(() => {
        return () => {
            // Stop any active screen tracks
            screenStreamRef.current?.getTracks().forEach((t) => t.stop());
            recordingAudioContextRef.current?.close().catch(() => { });
            recordingAudioContextRef.current = null;

            // Best-effort abort if recording was in progress
            if (
                recordingStateRef.current === "recording" &&
                uploadIdRef.current
            ) {
                api.post(
                    `/interviews/${sessionId}/recording/abort`,
                    { uploadId: uploadIdRef.current },
                    token
                ).catch(() => { });
            }
        };
    }, [sessionId, token]);

    return {
        recordingState,
        uploadProgress,
        durationSec,
        startRecording,
        stopRecording,
    };
}
