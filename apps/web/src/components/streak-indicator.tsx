"use client";

// No lucide-react icons needed since we're using custom SVGs

interface StreakIndicatorProps {
    streak: number;
}

export function StreakIndicator({ streak }: StreakIndicatorProps) {
    return (
        <div
            className="flex items-center gap-1 p-2 mr-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors select-none"
            title={`${streak} day streak`}
        >
            {streak > 0 ? (
                <>
                    <svg className="w-[24px] h-[24px] drop-shadow-sm" viewBox="0 0 24 24" stroke="none">
                        <defs>
                            <linearGradient id="streak-gradient" x1="0" y1="0" x2="1" y2="1">
                                <stop offset="0%" stopColor="#FFA03A" />
                                <stop offset="100%" stopColor="#F96300" />
                            </linearGradient>
                        </defs>
                        <path
                            fill="url(#streak-gradient)"
                            d="M12 22a8 8 0 0 1-5.657-13.657 1 1 0 0 1 .792-.262 1 1 0 0 1 .632.483C8.423 9.771 9.75 11 11.5 11a1 1 0 0 0 .949-1.316C12.138 8.736 12 7.82 12 7c0-2.5 1.5-4 2-5a1 1 0 0 1 1.761.34A12.067 12.067 0 0 1 18 8.5C19.349 10.82 20 13.3 20 16a8 8 0 0 1-8 6z"
                        />
                    </svg>
                    <span className="text-[20px] font-bold text-[#F98A2C] leading-none pt-[2px]">
                        {streak}
                    </span>
                </>
            ) : (
                <>
                    <svg className="w-[24px] h-[24px] text-slate-600 dark:text-slate-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                        <path d="M12 22a8 8 0 0 1-5.657-13.657 1 1 0 0 1 .792-.262 1 1 0 0 1 .632.483C8.423 9.771 9.75 11 11.5 11a1 1 0 0 0 .949-1.316C12.138 8.736 12 7.82 12 7c0-2.5 1.5-4 2-5a1 1 0 0 1 1.761.34A12.067 12.067 0 0 1 18 8.5C19.349 10.82 20 13.3 20 16a8 8 0 0 1-8 6z" />
                    </svg>
                    <span className="text-[18px] font-bold text-slate-600 dark:text-slate-300 leading-none pt-[1px]">
                        {streak}
                    </span>
                </>
            )}
        </div>
    );
}
