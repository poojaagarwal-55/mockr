"use client";

import React, { useState, useEffect } from "react";

export interface PageCurlSliderProps<T> {
    items: T[];
    renderSlide: (item: T, index: number) => React.ReactNode;
    renderControls?: (
        currentIndex: number,
        isAnimating: boolean,
        handleNext: () => void,
        handlePrev: () => void,
        isLastSlide: boolean
    ) => React.ReactNode;
    onComplete?: () => void;
    animationDuration?: number;
    className?: string;
}

export function PageCurlSlider<T>({
    items,
    renderSlide,
    renderControls,
    onComplete,
    animationDuration = 1000,
    className = "",
}: PageCurlSliderProps<T>) {
    const [currentIndex, setCurrentIndex] = useState(0);
    const [targetIndex, setTargetIndex] = useState<number | null>(null);
    const [isAnimating, setIsAnimating] = useState(false);
    const [direction, setDirection] = useState<'next' | 'prev'>('next');
    
    const activeIndex = targetIndex !== null ? targetIndex : currentIndex;
    const isLastSlide = activeIndex === items.length - 1;

    const handleNext = () => {
        if (isAnimating) return;
        if (activeIndex === items.length - 1) {
            onComplete?.();
            return;
        }
        
        setDirection('next');
        setTargetIndex(activeIndex + 1);
        setIsAnimating(true);
        
        // Make button clickable earlier - after 60% of animation
        setTimeout(() => {
            setIsAnimating(false);
        }, animationDuration * 0.6);
        
        // Complete the transition
        setTimeout(() => {
            setCurrentIndex(activeIndex + 1);
            setTargetIndex(null);
        }, animationDuration);
    };

    const handlePrev = () => {
        if (isAnimating) return;
        if (activeIndex === 0) return;
        
        setDirection('prev');
        setTargetIndex(activeIndex - 1);
        setIsAnimating(true);
        
        // Make button clickable earlier - after 60% of animation
        setTimeout(() => {
            setIsAnimating(false);
        }, animationDuration * 0.6);
        
        // Complete the transition
        setTimeout(() => {
            setCurrentIndex(activeIndex - 1);
            setTargetIndex(null);
        }, animationDuration);
    };

    return (
        <div className={`relative overflow-hidden ${className}`}>
            {/* Standard React style tag for dynamic values without styled-jsx issues */}
            <style dangerouslySetInnerHTML={{ __html: `
                @keyframes clipMaskLeft {
                    0% { clip-path: inset(0 0% 0 0); }
                    100% { clip-path: inset(0 100% 0 0); }
                }
                .clip-mask-left {
                    animation: clipMaskLeft ${animationDuration}ms cubic-bezier(0.4, 0.0, 0.2, 1) forwards;
                    will-change: clip-path;
                }

                @keyframes foldSlideLeft {
                    0% { transform: translateX(0%); }
                    100% { transform: translateX(-100%); }
                }
                .fold-slide-left {
                    animation: foldSlideLeft ${animationDuration}ms cubic-bezier(0.4, 0.0, 0.2, 1) forwards;
                    will-change: transform;
                }

                @keyframes clipMaskRight {
                    0% { clip-path: inset(0 0 0 0%); }
                    100% { clip-path: inset(0 0 0 100%); }
                }
                .clip-mask-right {
                    animation: clipMaskRight ${animationDuration}ms cubic-bezier(0.4, 0.0, 0.2, 1) forwards;
                    will-change: clip-path;
                }

                @keyframes foldSlideRight {
                    0% { transform: translateX(0%); }
                    100% { transform: translateX(100%); }
                }
                .fold-slide-right {
                    animation: foldSlideRight ${animationDuration}ms cubic-bezier(0.4, 0.0, 0.2, 1) forwards;
                    will-change: transform;
                }

                .fold-slide-left::before {
                    content: '';
                    position: absolute;
                    right: 0;
                    top: -10%;
                    bottom: -10%;
                    width: 140px;
                    background: linear-gradient(
                        to right, 
                        rgba(0,0,0,0) 0%, 
                        rgba(0,0,0,0.15) 15%, 
                        rgba(255,255,255,0.9) 40%, 
                        #f8fafc 55%, 
                        #cbd5e1 85%, 
                        rgba(15,23,42,0.5) 100%
                    );
                    border-left: 1px solid rgba(255,255,255,0.4);
                    box-shadow: inset -2px 0 10px rgba(0,0,0,0.1);
                    pointer-events: none;
                }

                .fold-slide-left::after {
                    content: '';
                    position: absolute;
                    left: 100%;
                    top: -10%;
                    bottom: -10%;
                    width: 100px;
                    background: linear-gradient(to right, rgba(0,0,0,0.5) 0%, rgba(0,0,0,0.1) 40%, transparent 100%);
                    pointer-events: none;
                }

                .fold-slide-right::before {
                    content: '';
                    position: absolute;
                    left: 0;
                    top: -10%;
                    bottom: -10%;
                    width: 140px;
                    background: linear-gradient(
                        to left, 
                        rgba(0,0,0,0) 0%, 
                        rgba(0,0,0,0.15) 15%, 
                        rgba(255,255,255,0.9) 40%, 
                        #f8fafc 55%, 
                        #cbd5e1 85%, 
                        rgba(15,23,42,0.5) 100%
                    );
                    border-right: 1px solid rgba(255,255,255,0.4);
                    box-shadow: inset 2px 0 10px rgba(0,0,0,0.1);
                    pointer-events: none;
                }

                .fold-slide-right::after {
                    content: '';
                    position: absolute;
                    right: 100%;
                    top: -10%;
                    bottom: -10%;
                    width: 100px;
                    background: linear-gradient(to left, rgba(0,0,0,0.5) 0%, rgba(0,0,0,0.1) 40%, transparent 100%);
                    pointer-events: none;
                }
            `}} />

            {/* Base Layer (Incoming Slide) */}
            <div className="absolute inset-0 z-10" style={{ transform: 'translateZ(0)' }}>
                {renderSlide(items[activeIndex], activeIndex)}
            </div>

            {/* Outgoing Slide (Animated Mask Layer) */}
            {isAnimating && targetIndex !== null && (
                <div 
                    className="absolute top-0 bottom-0 z-20 pointer-events-none"
                    style={{ left: '-30%', right: '-30%', transform: 'skewX(15deg) translateZ(0)' }}
                >
                    <div className={`w-full h-full ${direction === 'next' ? 'clip-mask-left' : 'clip-mask-right'}`}>
                        {/* Counter-skew and exactly center the inner content to perfectly match the base slide */}
                        <div 
                            className="absolute top-0 bottom-0 pointer-events-auto" 
                            style={{ left: '18.75%', right: '18.75%', transform: 'skewX(-15deg)' }}
                        >
                            {renderSlide(items[currentIndex], currentIndex)}
                        </div>
                    </div>
                </div>
            )}

            {/* Realistic Fold & Shadow Overlay (Sibling to out-slide so it isn't clipped) */}
            {isAnimating && (
                <div 
                    className="absolute top-0 bottom-0 z-30 pointer-events-none"
                    style={{ left: '-30%', right: '-30%', transform: 'skewX(15deg) translateZ(0)' }}
                >
                    <div className={`w-full h-full ${direction === 'next' ? 'fold-slide-left' : 'fold-slide-right'}`} />
                </div>
            )}

            {/* Fixed Navigation & Controls Layer (Always on top, untouched by transforms) */}
            {renderControls && (
                <div className="absolute inset-0 z-40 pointer-events-none flex flex-col">
                    {renderControls(activeIndex, isAnimating, handleNext, handlePrev, isLastSlide)}
                </div>
            )}
        </div>
    );
}
