"use client";

interface CompanyTagsSidebarProps {
    companies?: Array<{ name: string; count: number }>;
    onCompanyClick?: (company: string) => void;
}

const DEFAULT_COMPANIES = [
    { name: "Uber", count: 363 },
    { name: "Amazon", count: 1954 },
    { name: "Google", count: 2244 },
    { name: "Bloomberg", count: 1182 },
    { name: "Apple", count: 320 },
    { name: "Microsoft", count: 1374 },
    { name: "TikTok", count: 361 },
    { name: "Meta", count: 1387 },
    { name: "LinkedIn", count: 177 },
    { name: "Adobe", count: 165 },
    { name: "Goldman Sachs", count: 259 },
    { name: "Airbnb", count: 61 },
    { name: "Nvidia", count: 135 },
    { name: "Salesforce", count: 193 },
    { name: "Snowflake", count: 105 },
    { name: "Citadel", count: 94 },
    { name: "DoorDash", count: 82 },
    { name: "Walmart Labs", count: 146 },
    { name: "Oracle", count: 334 },
    { name: "IBM", count: 173 },
];

export function CompanyTagsSidebar({
    companies = DEFAULT_COMPANIES,
    onCompanyClick,
}: CompanyTagsSidebarProps) {
    return (
        <div className="w-80 flex-shrink-0 bg-white dark:bg-[#1c160d] border-l border-slate-200 dark:border-[#3e3e3e] p-6 overflow-y-auto">
            {/* Header with Navigation */}
            <div className="flex items-center justify-between mb-4">
                <h2 className="font-semibold text-slate-900 dark:text-white text-lg">
                    Trending Companies
                </h2>
                <div className="flex items-center gap-1">
                    <button className="p-1 hover:bg-slate-100 dark:hover:bg-[#282828] rounded transition-colors">
                        <span className="material-symbols-outlined text-slate-400 text-xl">
                            chevron_left
                        </span>
                    </button>
                    <button className="p-1 hover:bg-slate-100 dark:hover:bg-[#282828] rounded transition-colors">
                        <span className="material-symbols-outlined text-slate-400 text-xl">
                            chevron_right
                        </span>
                    </button>
                </div>
            </div>

            {/* Search Bar */}
            <div className="relative mb-4">
                <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-lg">
                    search
                </span>
                <input
                    type="text"
                    placeholder="Search for a company..."
                    className="w-full pl-9 pr-4 py-2 bg-slate-50 dark:bg-[#282828] border border-slate-200 dark:border-[#3e3e3e] rounded-lg text-sm text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-teal-500 dark:focus:ring-teal-400"
                />
            </div>

            {/* Company Badges Grid */}
            <div className="flex flex-wrap gap-2">
                {companies.map((company) => (
                    <button
                        key={company.name}
                        onClick={() => onCompanyClick?.(company.name)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 dark:bg-[#282828] hover:bg-slate-200 dark:hover:bg-[#3e3e3e] rounded-full text-sm font-medium text-slate-700 dark:text-slate-300 transition-colors"
                    >
                        {company.name}
                        <span className="text-xs font-bold text-white bg-amber-500 rounded-full px-1.5 py-0.5 min-w-[24px] text-center">
                            {company.count}
                        </span>
                    </button>
                ))}
            </div>

            {/* Additional Info */}
            <div className="mt-8 pt-6 border-t border-slate-200 dark:border-[#3e3e3e]">
                <div className="space-y-3 text-xs text-slate-500 dark:text-slate-400">
                    <a href="#" className="block hover:text-teal-600 dark:hover:text-teal-400 transition-colors">
                        Support
                    </a>
                    <a href="#" className="block hover:text-teal-600 dark:hover:text-teal-400 transition-colors">
                        Terms
                    </a>
                    <a href="#" className="block hover:text-teal-600 dark:hover:text-teal-400 transition-colors">
                        Privacy Policy
                    </a>
                    <a href="#" className="block hover:text-teal-600 dark:hover:text-teal-400 transition-colors">
                        More
                    </a>
                </div>
                
                <div className="mt-4 text-xs text-slate-400 dark:text-slate-500">
                    Copyright © 2026 InterviewForge
                </div>
                
                <div className="mt-2 flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                    <span className="inline-block w-5 h-3 bg-gradient-to-r from-blue-500 via-white to-red-500 rounded-sm border border-slate-300 dark:border-slate-600"></span>
                    <span>United States</span>
                </div>
            </div>
        </div>
    );
}
