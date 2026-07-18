"use client";

import { useEffect, useState } from "react";

const completedText = new Set<string>();

export function TypewriterPrompt({
  text,
  onComplete,
}: {
  text: string;
  onComplete?: () => void;
}) {
  const [typedText, setTypedText] = useState("");

  useEffect(() => {
    if (completedText.has(text)) {
      setTypedText(text);
      onComplete?.();
      return;
    }

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduceMotion) {
      setTypedText(text);
      completedText.add(text);
      onComplete?.();
      return;
    }

    setTypedText("");
    let index = 0;
    const timer = window.setInterval(() => {
      index += 1;
      setTypedText(text.slice(0, index));
      if (index >= text.length) {
        window.clearInterval(timer);
        completedText.add(text);
        window.setTimeout(() => onComplete?.(), 250);
      }
    }, 42);

    return () => window.clearInterval(timer);
  }, [onComplete, text]);

  return (
    <p className="mt-2 h-[94px] overflow-hidden text-[13px] leading-6 text-[#344256] dark:text-[#c8d1e2]">
      {typedText}
      <span className="typewriter-cursor" aria-hidden="true">
        |
      </span>
    </p>
  );
}
