"use client";

import { PageHeader } from "@/components/page-header";
import { Footer } from "@/components/footer";
import { useEffect, useState, useMemo } from "react";

// ─── Types ───────────────────────────────────────────────────────────────────

type LicenseEntry = {
    name: string;
    version: string;
    license: string;
    repository: string | null;
    publisher: string | null;
    url: string | null;
};

// ─── License normalisation ───────────────────────────────────────────────────
// Some packages (e.g. GSAP) use freeform strings instead of SPDX identifiers.
// Map known freeform values to a short, human-readable label.
const LICENSE_ALIASES: Record<string, string> = {
    // GSAP — proprietary but free-to-use commercially since Webflow acquisition
    "Standard 'no charge' license: https://gsap.com/standard-license.": "No-Charge",
};

function normalizeLicense(raw: string): string {
    const trimmed = raw.replace(/\*$/, "").trim();
    return LICENSE_ALIASES[trimmed] ?? trimmed;
}

// ─── License badge colours ────────────────────────────────────────────────────

const LICENSE_COLORS: Record<string, { bg: string; text: string }> = {
    MIT:            { bg: "bg-emerald-100 dark:bg-emerald-900/30", text: "text-emerald-700 dark:text-emerald-400" },
    "Apache-2.0":   { bg: "bg-blue-100 dark:bg-blue-900/30",     text: "text-blue-700 dark:text-blue-400" },
    ISC:            { bg: "bg-violet-100 dark:bg-violet-900/30", text: "text-violet-700 dark:text-violet-400" },
    "BSD-2-Clause": { bg: "bg-amber-100 dark:bg-amber-900/30",  text: "text-amber-700 dark:text-amber-400" },
    "BSD-3-Clause": { bg: "bg-amber-100 dark:bg-amber-900/30",  text: "text-amber-700 dark:text-amber-400" },
    "BlueOak-1.0.0":{ bg: "bg-sky-100 dark:bg-sky-900/30",      text: "text-sky-700 dark:text-sky-400" },
    "0BSD":         { bg: "bg-teal-100 dark:bg-teal-900/30",    text: "text-teal-700 dark:text-teal-400" },
    "Python-2.0":   { bg: "bg-yellow-100 dark:bg-yellow-900/30",text: "text-yellow-700 dark:text-yellow-400" },
    // Custom/proprietary-but-free
    "No-Charge":    { bg: "bg-orange-100 dark:bg-orange-900/30", text: "text-orange-700 dark:text-orange-400" },
};

function licenseBadgeClasses(license: string) {
    const key = normalizeLicense(license);
    const c = LICENSE_COLORS[key];
    if (c) return `${c.bg} ${c.text}`;
    return "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400";
}


// ─── Component ───────────────────────────────────────────────────────────────

export default function LicensesPage() {
    const [packages, setPackages] = useState<LicenseEntry[]>([]);
    const [loading, setLoading] = useState(true);
    const [query, setQuery] = useState("");
    const [filterLicense, setFilterLicense] = useState("All");

    useEffect(() => {
        document.title = "Open-source Licenses | Mockr";
        fetch("/licenses.json")
            .then((r) => r.json())
            .then((data: LicenseEntry[]) => {
                setPackages(data);
                setLoading(false);
            })
            .catch(() => setLoading(false));
    }, []);

    // Unique sorted license list for the filter dropdown
    const licenseOptions = useMemo(() => {
        const set = new Set(packages.map((p) => normalizeLicense(p.license)));
        return ["All", ...Array.from(set).sort()];
    }, [packages]);

    const filtered = useMemo(() => {
        const q = query.toLowerCase().trim();
        return packages.filter((p) => {
            const normalised = normalizeLicense(p.license);
            const matchesQuery =
                !q ||
                p.name.toLowerCase().includes(q) ||
                (p.publisher ?? "").toLowerCase().includes(q) ||
                normalised.toLowerCase().includes(q);
            const matchesLicense =
                filterLicense === "All" ||
                normalised === filterLicense;
            return matchesQuery && matchesLicense;
        });
    }, [packages, query, filterLicense]);


    return (
        <div className="flex-1 overflow-auto bg-[#FAFBFC] dark:bg-lc-bg flex flex-col relative">
            <PageHeader
                titleNode={
                    <h1 className="text-[28px] font-bold text-slate-900 dark:text-white font-nunito tracking-[-0.02em]">
                        Open-source Licenses
                    </h1>
                }
                showBack
                backUrl="/settings"
            />

            <main className="flex-1 flex flex-col items-center py-8 px-4">
                <div className="w-full max-w-[800px] space-y-6">

                    {/* ── Intro card ── */}
                    <div className="bg-white dark:bg-lc-surface rounded-xl shadow-sm border border-slate-200 dark:border-lc-border p-6">
                        <h2 className="text-[17px] font-bold text-slate-800 dark:text-white font-nunito mb-2">
                            Third-party acknowledgements
                        </h2>
                        <p className="text-[14px] text-slate-500 dark:text-[#ababab] leading-relaxed">
                            Mockr is built on top of amazing open-source software.
                            Below is a complete list of the third-party packages shipped
                            in this product, along with their respective licenses.
                            We are grateful to every maintainer and contributor.
                        </p>
                    </div>

                    {/* ── Search + filter bar ── */}
                    <div className="flex flex-col sm:flex-row gap-3">
                        <div className="relative flex-1">
                            <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-[18px] pointer-events-none">
                                search
                            </span>
                            <input
                                id="license-search"
                                type="text"
                                placeholder="Search packages…"
                                value={query}
                                onChange={(e) => setQuery(e.target.value)}
                                className="w-full pl-9 pr-4 py-2.5 text-[14px] bg-white dark:bg-lc-surface border border-slate-200 dark:border-lc-border rounded-xl outline-none focus:border-primary focus:ring-1 focus:ring-primary dark:text-white placeholder:text-slate-400 transition-colors"
                            />
                        </div>
                        <select
                            id="license-filter"
                            value={filterLicense}
                            onChange={(e) => setFilterLicense(e.target.value)}
                            className="px-4 py-2.5 text-[14px] bg-white dark:bg-lc-surface border border-slate-200 dark:border-lc-border rounded-xl outline-none focus:border-primary focus:ring-1 focus:ring-primary dark:text-white transition-colors cursor-pointer min-w-[160px]"
                        >
                            {licenseOptions.map((l) => (
                                <option key={l} value={l}>{l}</option>
                            ))}
                        </select>
                    </div>

                    {/* ── Result count ── */}
                    {!loading && (
                        <p className="text-[13px] text-slate-400 dark:text-[#888] px-1">
                            Showing{" "}
                            <span className="font-bold text-slate-600 dark:text-[#ccc]">
                                {filtered.length}
                            </span>{" "}
                            of{" "}
                            <span className="font-bold text-slate-600 dark:text-[#ccc]">
                                {packages.length}
                            </span>{" "}
                            packages
                        </p>
                    )}

                    {/* ── Package list ── */}
                    {loading ? (
                        <div className="flex flex-col gap-3">
                            {Array.from({ length: 8 }).map((_, i) => (
                                <div
                                    key={i}
                                    className="h-[64px] rounded-xl bg-slate-100 dark:bg-lc-surface animate-pulse"
                                />
                            ))}
                        </div>
                    ) : filtered.length === 0 ? (
                        <div className="text-center py-16 text-slate-400 dark:text-[#666]">
                            <span className="material-symbols-outlined text-[48px] block mb-3">
                                search_off
                            </span>
                            <p className="text-[15px] font-medium">No packages match your search.</p>
                        </div>
                    ) : (
                        <div className="bg-white dark:bg-lc-surface rounded-xl shadow-sm border border-slate-200 dark:border-lc-border overflow-hidden">
                            {filtered.map((pkg, idx) => (
                                <div
                                    key={`${pkg.name}@${pkg.version}`}
                                    className={`flex items-center justify-between px-5 py-3.5 gap-4 ${
                                        idx !== 0
                                            ? "border-t border-slate-100 dark:border-lc-border"
                                            : ""
                                    }`}
                                >
                                    {/* Left: name + publisher */}
                                    <div className="flex flex-col min-w-0">
                                        <div className="flex items-baseline gap-2 flex-wrap">
                                            {pkg.repository ? (
                                                <a
                                                    href={pkg.repository}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    className="text-[14px] font-semibold text-slate-800 dark:text-white font-nunito hover:text-primary dark:hover:text-primary transition-colors truncate"
                                                >
                                                    {pkg.name}
                                                </a>
                                            ) : (
                                                <span className="text-[14px] font-semibold text-slate-800 dark:text-white font-nunito truncate">
                                                    {pkg.name}
                                                </span>
                                            )}
                                            <span className="text-[11px] text-slate-400 dark:text-[#666] shrink-0">
                                                v{pkg.version}
                                            </span>
                                        </div>
                                        {pkg.publisher && (
                                            <span className="text-[12px] text-slate-400 dark:text-[#888] truncate mt-0.5">
                                                {pkg.publisher}
                                            </span>
                                        )}
                                    </div>

                                    {/* Right: license badge */}
                                    <span
                                        className={`shrink-0 text-[11px] font-bold px-2.5 py-1 rounded-full font-nunito tracking-wide ${licenseBadgeClasses(pkg.license)}`}
                                    >
                                        {normalizeLicense(pkg.license)}
                                    </span>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </main>

            <Footer />
        </div>
    );
}
