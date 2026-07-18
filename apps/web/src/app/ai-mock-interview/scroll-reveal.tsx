"use client";

import { useEffect } from "react";

export function ScrollReveal() {
  useEffect(() => {
    const elements = Array.from(document.querySelectorAll<HTMLElement>(".scroll-reveal"));

    if (!("IntersectionObserver" in window)) {
      elements.forEach((element) => element.classList.add("is-visible"));
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
            observer.unobserve(entry.target);
          }
        });
      },
      { rootMargin: "0px 0px -12% 0px", threshold: 0.12 },
    );

    elements.forEach((element) => observer.observe(element));

    return () => observer.disconnect();
  }, []);

  return (
    <style>{`
      .scroll-reveal {
        opacity: 0;
        transform: translateY(42px) scale(.985);
        filter: blur(8px);
        transition:
          opacity 760ms cubic-bezier(.2,.8,.2,1),
          transform 760ms cubic-bezier(.2,.8,.2,1),
          filter 760ms cubic-bezier(.2,.8,.2,1);
        will-change: opacity, transform, filter;
      }

      .scroll-reveal.reveal-fade {
        transform: none;
      }

      .scroll-reveal.reveal-left {
        transform: translateX(-52px);
      }

      .scroll-reveal.reveal-right {
        transform: translateX(52px);
      }

      .scroll-reveal.reveal-scale {
        transform: translateY(18px) scale(.94);
      }

      .scroll-reveal.is-visible {
        opacity: 1;
        transform: translateY(0) scale(1);
        filter: blur(0);
      }

      @media (prefers-reduced-motion: reduce) {
        .scroll-reveal {
          opacity: 1;
          transform: none;
          filter: none;
          transition: none;
        }
      }
    `}</style>
  );
}
