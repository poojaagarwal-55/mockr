"use client";

import Link from "next/link";

const QUESTION_CATEGORIES = [
    {
        href: "/question-bank/dsa",
        title: "Data Structures & Algorithms",
        description: "Build and manage company-owned coding interview problems.",
        icon: "code",
    },
    {
        href: "/question-bank/sql",
        title: "SQL",
        description: "Create database query questions with schemas, wrappers, and test cases.",
        icon: "database",
    },
    {
        href: "/question-bank/system-design",
        title: "System Design",
        description: "Organize architecture prompts, rubrics, follow-ups, and diagrams.",
        icon: "account_tree",
    },
    {
        href: "/question-bank/cs-fundamentals",
        title: "CS Fundamentals",
        description: "Maintain OS, DBMS, Networks, and OOP question libraries.",
        icon: "menu_book",
    },
];

export default function QuestionBankPage() {
    return (
        <main className="min-h-full bg-[#FAFBFC] px-4 pb-16 pt-8 dark:bg-lc-bg sm:px-6 sm:pb-20 lg:px-10">
            <div className="mx-auto flex max-w-7xl flex-col gap-10">
                <section className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
                    <div className="flex flex-col gap-3">
                        <div className="flex items-center gap-3">
                            <span className="flex size-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
                                <span className="material-symbols-outlined">library_books</span>
                            </span>
                            <div>
                                <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-400 dark:text-slate-500">Company Workspace</p>
                                <h1 className="font-nunito text-3xl font-extrabold tracking-tight text-slate-950 dark:text-white sm:text-4xl">Question Bank</h1>
                            </div>
                        </div>
                        <p className="max-w-3xl text-sm leading-6 text-slate-500 dark:text-slate-400">
                            Company-owned coding, SQL, system design, and behavioral question libraries will be organized here.
                        </p>
                    </div>
                    <Link
                        href="/question-bank/sets"
                        className="inline-flex h-14 shrink-0 items-center justify-center gap-2 rounded-full bg-primary px-6 text-sm font-extrabold text-white shadow-lg shadow-primary/20 transition hover:bg-primary/90 focus:outline-none focus:ring-4 focus:ring-primary/20"
                    >
                        <span className="material-symbols-outlined text-[21px]">add</span>
                        Create new set
                    </Link>
                </section>

                <section className="pb-14">
                    <div className="grid gap-6 pb-10 md:grid-cols-2">
                        {QUESTION_CATEGORIES.map((category) => (
                            <Link
                                key={category.href}
                                href={category.href}
                                className="group flex min-h-[260px] flex-col justify-center rounded-lg bg-white p-8 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-[0_20px_45px_-30px_rgba(15,23,42,0.45)] focus:outline-none focus:ring-4 focus:ring-primary/15 dark:bg-lc-surface dark:shadow-[0_18px_42px_-32px_rgba(0,0,0,0.9)]"
                            >
                                <span className="flex size-14 items-center justify-center rounded-xl bg-primary/10 text-primary transition group-hover:scale-105 dark:bg-primary/15">
                                    <span className="material-symbols-outlined text-[32px]">{category.icon}</span>
                                </span>
                                <h2 className="mt-9 font-nunito text-xl font-extrabold tracking-tight text-slate-950 dark:text-white">
                                    {category.title}
                                </h2>
                                <p className="mt-3 text-sm font-medium leading-6 text-slate-500 dark:text-slate-400">
                                    {category.description}
                                </p>
                            </Link>
                        ))}
                    </div>
                </section>
            </div>
        </main>
    );
}
