import Link from "next/link";
import { notFound } from "next/navigation";

const CATEGORY_COPY = {
    dsa: {
        title: "Data Structures & Algorithms",
        icon: "code",
        description: "Company-owned coding problems with starter code, wrapper code, visible tests, and hidden tests.",
    },
    sql: {
        title: "SQL",
        icon: "database",
        description: "Database query questions with schemas, wrappers, expected outputs, and private solutions.",
    },
    "system-design": {
        title: "System Design",
        icon: "account_tree",
        description: "Architecture prompts, rubrics, hints, follow-up questions, and reference diagrams.",
    },
    "cs-fundamentals": {
        title: "CS Fundamentals",
        icon: "menu_book",
        description: "OS, DBMS, Networks, and OOP questions owned by your company workspace.",
    },
} as const;

type CategoryKey = keyof typeof CATEGORY_COPY;

export default async function QuestionBankCategoryPage({
    params,
}: {
    params: Promise<{ category: string }>;
}) {
    const { category } = await params;
    if (!(category in CATEGORY_COPY)) notFound();

    const details = CATEGORY_COPY[category as CategoryKey];

    return (
        <main className="min-h-full bg-[#FAFBFC] px-4 py-8 dark:bg-lc-bg sm:px-6 lg:px-10">
            <div className="mx-auto flex max-w-7xl flex-col gap-8">
                <section className="flex flex-col gap-5">
                    <Link
                        href="/question-bank"
                        className="inline-flex w-fit items-center gap-2 text-sm font-bold text-slate-500 transition hover:text-primary dark:text-slate-400"
                    >
                        <span className="material-symbols-outlined text-[18px]">arrow_back</span>
                        Question Bank
                    </Link>

                    <div className="flex items-center gap-3">
                        <span className="flex size-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
                            <span className="material-symbols-outlined">{details.icon}</span>
                        </span>
                        <div>
                            <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-400 dark:text-slate-500">Company Question Bank</p>
                            <h1 className="font-nunito text-3xl font-extrabold tracking-tight text-slate-950 dark:text-white sm:text-4xl">{details.title}</h1>
                        </div>
                    </div>
                    <p className="max-w-3xl text-sm leading-6 text-slate-500 dark:text-slate-400">{details.description}</p>
                </section>

                <section className="grid min-h-[360px] place-items-center rounded-lg border border-dashed border-slate-200 bg-white p-10 text-center shadow-sm dark:border-lc-border dark:bg-lc-surface">
                    <div>
                        <span className="mx-auto flex size-16 items-center justify-center rounded-xl bg-primary/10 text-primary">
                            <span className="material-symbols-outlined text-4xl">library_add</span>
                        </span>
                        <h2 className="mt-5 font-nunito text-2xl font-extrabold text-slate-950 dark:text-white">Question list coming next</h2>
                        <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-slate-500 dark:text-slate-400">
                            This category is connected to the company-scoped database. Next we can add the table, filters, and create-question flow.
                        </p>
                    </div>
                </section>
            </div>
        </main>
    );
}
