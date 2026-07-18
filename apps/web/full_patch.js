const fs = require('fs');
const path = 'apps/web/src/app/(authenticated)/(sidebar)/reports/type/[type]/page.tsx';
let txt = fs.readFileSync(path, 'utf8');

const targetHeading = \<PageHeader showBack backUrl="/reports" title={interviewTypeLabel} />\;
txt = txt.replace(targetHeading, \<PageHeader showBack backUrl="/reports" title={
                <h1 className="text-[28px] font-bold text-slate-900 dark:text-white font-nunito tracking-[-0.02em] capitalize">
                    {interviewTypeLabel}
                </h1>
            } />\);

const targetFilters = \                            <div className="flex flex-wrap items-center gap-3 pr-2 pb-2 sm:pb-0 px-2 sm:px-0">
                                {timeFilter === "customDate" && (
                                    <div className="relative group flex-1 sm:flex-none animate-in fade-in zoom-in-95 duration-200">
                                        <input
                                            type="date"
                                            value={customDate}
                                            onChange={(e) => setCustomDate(e.target.value)}
                                            className="h-10 w-full sm:w-[140px] cursor-text rounded-xl border border-slate-200 bg-white px-3 text-xs font-bold text-slate-700 shadow-sm outline-none transition-all hover:bg-slate-50 focus:border-[#6C63FF] focus:ring-2 focus:ring-[#6C63FF]/20 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 relative z-10"
                                        />
                                    </div>
                                )}

                                <div className="relative group flex-1 sm:flex-none min-w-[160px]">
                                    <select
                                        value={sortOrder}
                                        onChange={(e) => setSortOrder(e.target.value as SortOption)}
                                        className="h-10 w-full appearance-none cursor-pointer rounded-xl border border-slate-200 bg-white px-4 pr-10 text-xs font-bold text-slate-700 shadow-sm outline-none transition-all hover:bg-slate-50 focus:border-[#6C63FF] focus:ring-2 focus:ring-[#6C63FF]/20 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800/50 relative z-10"
                                    >
                                        <option value="newest">Newest First</option>
                                        <option value="oldest">Oldest First</option>
                                        <option value="highestScore">Highest Score First</option>
                                        <option value="lowestScore">Lowest Score First</option>
                                    </select>
                                    <span className="material-symbols-outlined absolute right-3 top-1/2 -translate-y-1/2 text-[18px] text-slate-400 pointer-events-none z-20 transition-colors group-hover:text-[#6C63FF] dark:group-hover:text-[#B7B2FF]">
                                        sort
                                    </span>
                                </div>
                            </div>\
                             
txt = txt.replace(targetFilters, \                            <div className="flex flex-wrap items-center gap-3 pr-2 pb-2 sm:pb-0 px-2 sm:px-0">
                                {timeFilter === "customDate" && (
                                    <CustomDatePicker 
                                        date={customDate} 
                                        onChange={setCustomDate} 
                                        validDates={validDates} 
                                    />
                                )}
                                <CustomSortDropdown value={sortOrder} onChange={setSortOrder} />
                            </div>\);

const imports = \import { useEffect, useMemo, useState, useRef } from "react";\;
txt = txt.replace('import { useEffect, useMemo, useState } from "react";', imports);

const components = \
function CustomDatePicker({ date, onChange, validDates }: { date: string, onChange: (d: string) => void, validDates: Set<string> }) {
    const [open, setOpen] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);
    const [viewYear, setViewYear] = useState(() => date ? parseInt(date.split('-')[0]) : new Date().getFullYear());
    const [viewMonth, setViewMonth] = useState(() => date ? parseInt(date.split('-')[1]) - 1 : new Date().getMonth());
    
    // Auto-update internal view when external date changes
    useEffect(() => {
        if(date) {
            setViewYear(parseInt(date.split('-')[0]));
            setViewMonth(parseInt(date.split('-')[1]) - 1);
        }
    }, [date]);

    // Click outside handler
    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (open && containerRef.current && !containerRef.current.contains(e.target as Node)) {
                setOpen(false);
            }
        };
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, [open]);

    // Calendar generation
    const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
    const firstDay = new Date(viewYear, viewMonth, 1).getDay(); // 0 is Sunday
    const days = [];
    const today = new Date();
    today.setHours(0,0,0,0);

    for (let i = 0; i < firstDay; i++) days.push(null);
    for (let i = 1; i <= daysInMonth; i++) days.push(i);

    const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    const yearRange = Array.from({length: 10}, (_, i) => new Date().getFullYear() - i);

    return (
        <div className="relative z-50 group flex-1 sm:flex-none animate-in fade-in zoom-in-95 duration-200" ref={containerRef}>
            <button
                className="flex items-center justify-between h-10 w-full sm:w-[150px] rounded-xl border border-slate-200 bg-white px-3 text-xs font-bold text-slate-700 shadow-sm outline-none transition-all hover:bg-slate-50 focus:border-[#6C63FF] focus:ring-2 focus:ring-[#6C63FF]/20 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800/50"
                onClick={() => setOpen(!open)}
            >
                <span className="truncate">{date ? new Date(parseInt(date.split('-')[0]), parseInt(date.split('-')[1])-1, parseInt(date.split('-')[2])).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "Select Date"}</span>
                <span className="material-symbols-outlined text-[16px] text-slate-400 group-hover:text-[#6C63FF] dark:group-hover:text-[#B7B2FF]">calendar_month</span>
            </button>

            {open && (
                <div className="absolute right-0 top-[calc(100%+8px)] w-[320px] rounded-2xl border border-slate-200/80 bg-white p-4 shadow-xl dark:border-slate-700 dark:bg-slate-900 flex flex-col gap-4 animate-in zoom-in-95 duration-200">
                    <div className="flex items-center gap-3 w-full">
                        {/* Year Section */}
                        <div className="flex-1 relative group/select">
                            <select
                                className="w-full appearance-none rounded-xl border border-slate-200 bg-slate-50/50 px-3 py-2 text-xs font-bold text-slate-700 shadow-inner outline-none hover:bg-white focus:border-[#6C63FF] dark:border-slate-700/80 dark:bg-slate-800 dark:text-slate-200 cursor-pointer"
                                value={viewYear}
                                onChange={e => setViewYear(Number(e.target.value))}
                            >
                                {yearRange.map(y => (
                                    <option key={y} value={y}>{y}</option>
                                ))}
                            </select>
                            <span className="material-symbols-outlined absolute right-2 top-1/2 -translate-y-1/2 text-[14px] text-slate-400 pointer-events-none">expand_more</span>
                        </div>
                        {/* Month Section */}
                        <div className="flex-[1.5] relative group/select">
                            <select
                                disabled={viewYear === today.getFullYear() && viewMonth > today.getMonth()}
                                className="w-full appearance-none rounded-xl border border-slate-200 bg-slate-50/50 px-3 py-2 text-xs font-bold text-slate-700 shadow-inner outline-none hover:bg-white focus:border-[#6C63FF] dark:border-slate-700/80 dark:bg-slate-800 dark:text-slate-200 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                                value={viewMonth}
                                onChange={e => setViewMonth(Number(e.target.value))}
                            >
                                {months.map((m, i) => (
                                    <option key={m} value={i} disabled={viewYear === today.getFullYear() && i > today.getMonth()}>
                                        {m}
                                    </option>
                                ))}
                            </select>
                            <span className="material-symbols-outlined absolute right-2 top-1/2 -translate-y-1/2 text-[14px] text-slate-400 pointer-events-none">expand_more</span>
                        </div>
                    </div>

                    {/* Date Section */}
                    <div className="w-full">
                        <div className="grid grid-cols-7 mb-2">
                            {['Su','Mo','Tu','We','Th','Fr','Sa'].map(day => (
                                <div key={day} className="text-center text-[10px] font-bold text-slate-400 uppercase">{day}</div>
                            ))}
                        </div>
                        <div className="grid grid-cols-7 gap-1">
                            {days.map((dayNum, i) => {
                                if (!dayNum) return <div key={\empty-\\} className="h-8 w-8" />;
                                
                                const dateStr = \\-\-\\;
                                const dObj = new Date(viewYear, viewMonth, dayNum);
                                const isFuture = dObj.getTime() > today.getTime();
                                const isValid = validDates.has(dateStr);
                                const isSelected = date === dateStr;

                                // Base style for neutral
                                let cellStyle = "flex h-8 w-8 items-center justify-center rounded-lg text-xs font-semibold cursor-pointer transition-all duration-300 relative group/cell ";
                                
                                if (isFuture) {
                                    cellStyle += "text-slate-300 dark:text-slate-700 cursor-not-allowed";
                                } else if (isSelected) {
                                    cellStyle += "bg-[#6C63FF] text-white shadow-md shadow-[#6C63FF]/30 scale-105";
                                } else if (!isValid) {
                                    cellStyle += "text-slate-400 dark:text-slate-500 hover:bg-red-50 hover:text-red-500 hover:ring-1 hover:ring-red-200 dark:hover:bg-red-900/20 dark:hover:text-red-400 cursor-[not-allowed]";
                                } else {
                                    cellStyle += "text-slate-700 dark:text-slate-200 hover:bg-slate-100 hover:text-[#6C63FF] dark:hover:bg-slate-800 dark:hover:text-[#B7B2FF]";
                                }

                                return (
                                    <div key={dayNum} className="relative flex items-center justify-center">
                                        <button 
                                            disabled={isFuture || !isValid}
                                            onClick={() => {
                                                if (!isFuture && isValid) {
                                                    onChange(dateStr);
                                                    setOpen(false);
                                                }
                                            }}
                                            className={cellStyle}
                                        >
                                            {dayNum}
                                            
                                            {/* Red cross empty state hover panel */}
                                            {(!isValid && !isFuture) && (
                                                <div className="absolute opacity-0 group-hover/cell:opacity-100 transition-opacity pointer-events-none group-hover/cell:scale-100 scale-95 duration-200 bottom-[calc(100%+4px)] left-1/2 -translate-x-1/2 bg-red-600 text-white text-[10px] px-2 py-1 rounded-[6px] shadow-lg whitespace-nowrap z-50 flex items-center gap-1 font-nunito font-semibold filter drop-shadow-sm">
                                                    <span className="material-symbols-outlined text-[12px]">close</span>
                                                    No interviews for this date
                                                    <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-red-600" />
                                                </div>
                                            )}
                                        </button>
                                        {isValid && !isSelected && (
                                            <div className="absolute bottom-0.5 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-[#63C6FF] group-hover/cell:bg-[#6C63FF]" />
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

function CustomSortDropdown({ value, onChange }: { value: SortOption, onChange: (v: SortOption) => void }) {
    const [open, setOpen] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);
    
    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (open && containerRef.current && !containerRef.current.contains(e.target as Node)) {
                setOpen(false);
            }
        };
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, [open]);

    const options: {v: SortOption, l: string, icon: string}[] = [
        { v: "newest", l: "Newest First", icon: "arrow_downward" },
        { v: "oldest", l: "Oldest First", icon: "arrow_upward" },
        { v: "highestScore", l: "Highest Score First", icon: "trending_up" },
        { v: "lowestScore", l: "Lowest Score First", icon: "trending_down" },
    ];

    const selectedOption = options.find(o => o.v === value) || options[0];

    return (
        <div className="relative z-40 group flex-1 sm:flex-none min-w-[180px]" ref={containerRef}>
            <button
                className="flex items-center justify-between h-10 w-full rounded-xl border border-slate-200 bg-white px-4 text-xs font-bold text-slate-700 shadow-sm outline-none transition-all hover:bg-slate-50 focus:border-[#6C63FF] focus:ring-2 focus:ring-[#6C63FF]/20 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800/50"
                onClick={() => setOpen(!open)}
            >
                <div className="flex items-center gap-2">
                    <span className="material-symbols-outlined text-[16px] text-slate-400 group-hover:text-[#6C63FF]">{selectedOption.icon}</span>
                    <span>{selectedOption.l}</span>
                </div>
                <span className={\material-symbols-outlined text-[16px] text-slate-400 transition-transform duration-300 \\}>expand_more</span>
            </button>

            {open && (
                <div className="absolute right-0 top-[calc(100%+8px)] w-full sm:w-[220px] rounded-2xl border border-slate-200/80 bg-white p-2 shadow-xl dark:border-slate-700 dark:bg-slate-900 flex flex-col gap-1 animate-in zoom-in-95 duration-200">
                    {options.map((opt) => (
                        <button
                            key={opt.v}
                            onClick={() => { onChange(opt.v); setOpen(false); }}
                            className={\lex items-center gap-2.5 w-full text-left px-3 py-2.5 rounded-xl text-xs font-semibold transition-all duration-200 \\}
                        >
                            <span className="material-symbols-outlined text-[16px] opacity-80">{opt.icon}</span>
                            {opt.l}
                            {value === opt.v && <span className="material-symbols-outlined ml-auto text-[16px]">check</span>}
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}

export default function ReportTypePage() {\

txt = txt.replace('export default function ReportTypePage() {', components);

const validDatesInjection = \    const validDates = useMemo(() => {
        const set = new Set<string>();
        reports.forEach(report => {
            if (report.session.type === type) {
                const d = new Date(report.generatedAt);
                set.add(\\\\\\-\\\-\\\\\\);
            }
        });
        return set;
    }, [reports, type]);

    const interviewTypeLabel = useMemo(() => {
\
txt = txt.replace('    const interviewTypeLabel = useMemo(() => {', validDatesInjection);

fs.writeFileSync('apps/web/src/app/(authenticated)/(sidebar)/reports/type/[type]/page.tsx', txt);
console.log('PATCH_DONE');
