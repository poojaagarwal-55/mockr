"use client";

import { useEffect, useRef, useState } from "react";

interface Props {
    title: string;
    subtitle?: string;
    icon?: string;
    placeholder: string;
    value: string;
    onChange: (next: string) => void;
}

interface SpeechRecognitionLike {
    continuous: boolean;
    interimResults: boolean;
    lang: string;
    onresult: ((event: any) => void) | null;
    onerror: ((event: any) => void) | null;
    onend: (() => void) | null;
    onstart: (() => void) | null;
    start: () => void;
    stop: () => void;
    abort: () => void;
}

export default function RequirementCard({
    title,
    placeholder,
    value,
    onChange,
}: Props) {
    const [listening, setListening] = useState(false);
    const [interim, setInterim] = useState("");
    const [unsupported, setUnsupported] = useState(false);

    const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
    const valueRef = useRef(value);
    const stopRequestedRef = useRef(false);
    
    useEffect(() => {
        valueRef.current = value;
    }, [value]);

    useEffect(() => {
        if (typeof window === "undefined") return;
        const Ctor = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
        if (!Ctor) setUnsupported(true);
        return () => {
            if (recognitionRef.current) {
                try { recognitionRef.current.abort(); } catch {}
            }
        };
    }, []);

    const startMic = () => {
        if (typeof window === "undefined") return;
        
        const Ctor = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
        if (!Ctor) {
            setUnsupported(true);
            return;
        }

        // Stop any existing recognition first
        if (recognitionRef.current) {
            try { recognitionRef.current.abort(); } catch {}
            recognitionRef.current = null;
        }

        // Small delay to ensure previous recognition is fully stopped
        setTimeout(() => {
            try {
                const recognition: SpeechRecognitionLike = new Ctor();
                recognition.continuous = true;
                recognition.interimResults = true;
                recognition.lang = "en-US";

                recognition.onresult = (event: any) => {
                    let finals = "";
                    let interims = "";
                    for (let i = 0; i < event.results.length; i++) {
                        const r = event.results[i];
                        const t = r[0]?.transcript || "";
                        if (r.isFinal) finals += t;
                        else interims += t;
                    }

                    if (finals) {
                        const current = valueRef.current ?? "";
                        const sep = current && !/\s$/.test(current) ? " " : "";
                        const next = (current + sep + finals).replace(/\s+/g, " ").trimStart();
                        valueRef.current = next.trimEnd();
                        onChange(next.trimEnd());
                    }
                    setInterim(interims);
                };

                recognition.onerror = (event: any) => {
                    const code = event?.error;
                    // Only stop on hard errors
                    if (code === "not-allowed" || code === "service-not-allowed" || code === "audio-capture") {
                        stopRequestedRef.current = true;
                        setListening(false);
                        setInterim("");
                    }
                    // For other errors, don't stop - let onend handle it
                };

                recognition.onend = () => {
                    setInterim("");
                    // Only restart if we're still supposed to be listening
                    if (listening && !stopRequestedRef.current) {
                        // Try to restart after a delay
                        setTimeout(() => {
                            if (listening && !stopRequestedRef.current) {
                                try {
                                    recognitionRef.current?.start();
                                } catch {
                                    // If restart fails, try creating new instance
                                    startMic();
                                }
                            }
                        }, 300);
                    } else {
                        setListening(false);
                    }
                };

                recognition.onstart = () => {
                    setListening(true);
                };

                recognitionRef.current = recognition;
                stopRequestedRef.current = false;
                recognition.start();
            } catch (err) {
                console.error("Failed to start recognition:", err);
                setListening(false);
            }
        }, 100);
    };

    const stopMic = () => {
        stopRequestedRef.current = true;
        setListening(false);
        setInterim("");
        if (recognitionRef.current) {
            try { recognitionRef.current.stop(); } catch {}
            recognitionRef.current = null;
        }
    };

    const toggleMic = () => {
        if (listening) {
            stopMic();
        } else {
            startMic();
        }
    };

    return (
        <div
            className={`flex flex-col h-full bg-white dark:bg-[#1f1f1f] rounded-xl shadow-sm overflow-hidden transition-shadow ${
                listening ? "ring-2 ring-blue-300 dark:ring-blue-700/60" : ""
            }`}
        >
            <div className="flex items-center justify-between px-4 py-3">
                <div className="flex items-center gap-2.5 min-w-0">
                    <div className="min-w-0">
                        <div className="text-[18px] font-semibold text-slate-900 dark:text-white leading-tight truncate">
                            {title}
                        </div>
                    </div>
                </div>

                <button
                    type="button"
                    onClick={toggleMic}
                    disabled={unsupported}
                    title={
                        unsupported
                            ? "Speech recognition not supported in this browser"
                            : listening
                            ? "Stop dictation"
                            : "Dictate (Web Speech API)"
                    }
                    className={`relative flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[12px] font-semibold transition-all disabled:opacity-50 disabled:cursor-not-allowed ${
                        listening
                            ? "bg-blue-600 text-white shadow-md shadow-blue-500/40"
                            : "bg-blue-50 dark:bg-blue-900/40 text-blue-600 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-900/60"
                    }`}
                >
                    {listening && (
                        <span className="absolute -inset-0.5 rounded-full bg-blue-400/30 animate-ping" />
                    )}
                    <span className="material-symbols-outlined text-[16px] relative">
                        {listening ? "stop_circle" : "mic"}
                    </span>
                    <span className="relative">{listening ? "Listening" : "Dictate"}</span>
                </button>
            </div>

            <div className="flex-1 relative px-1 pb-1">
                <textarea
                    value={value}
                    onChange={(e) => {
                        valueRef.current = e.target.value;
                        onChange(e.target.value);
                    }}
                    placeholder={placeholder}
                    className="w-full h-full px-3 py-2 text-[14px] leading-relaxed text-slate-800 dark:text-slate-100 bg-transparent placeholder:text-slate-400 dark:placeholder:text-slate-500 resize-none focus:outline-none rounded-md"
                />
                {listening && interim && (
                    <div className="absolute left-3 right-3 bottom-2 px-2.5 py-1.5 rounded-md bg-blue-50/95 dark:bg-blue-900/40 backdrop-blur-sm text-[12px] text-blue-700 dark:text-blue-200 italic flex items-start gap-2 shadow-sm pointer-events-none">
                        <span className="material-symbols-outlined text-[14px] mt-0.5">graphic_eq</span>
                        <span className="line-clamp-2">{interim}</span>
                    </div>
                )}
            </div>

            <div className="px-4 py-2 flex items-center justify-end text-[11px] text-slate-400 dark:text-slate-500">
                <span>{value.length} chars</span>
            </div>
        </div>
    );
}
