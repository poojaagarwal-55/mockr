export function UnderDevelopment({
    title,
    description,
    icon = "construction",
}: {
    title: string;
    description: string;
    icon?: string;
}) {
    return (
        <main className="min-h-full bg-[#FAFBFC] px-4 py-8 dark:bg-lc-bg sm:px-6 lg:px-10">
            <div className="mx-auto flex max-w-6xl flex-col gap-8">
                <section className="flex flex-col gap-3">
                    <div className="flex items-center gap-3">
                        <span className="flex size-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
                            <span className="material-symbols-outlined">{icon}</span>
                        </span>
                        <div>
                            <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-400 dark:text-slate-500">Company Workspace</p>
                            <h1 className="font-nunito text-3xl font-extrabold tracking-tight text-slate-950 dark:text-white sm:text-4xl">{title}</h1>
                        </div>
                    </div>
                    <p className="max-w-2xl text-sm leading-6 text-slate-500 dark:text-slate-400">{description}</p>
                </section>

                <section className="grid gap-5 lg:grid-cols-[1.35fr_0.65fr]">
                    <div className="rounded-lg border border-slate-200 bg-white p-8 shadow-sm dark:border-lc-border dark:bg-lc-surface">
                        <div className="flex min-h-[320px] flex-col items-center justify-center text-center">
                            <div className="mb-5 flex size-16 items-center justify-center rounded-2xl bg-slate-100 text-slate-500 dark:bg-lc-hover dark:text-slate-300">
                                <span className="material-symbols-outlined text-4xl">{icon}</span>
                            </div>
                            <h2 className="font-nunito text-2xl font-extrabold text-slate-900 dark:text-white">Under development</h2>
                            <p className="mt-3 max-w-md text-sm leading-6 text-slate-500 dark:text-slate-400">
                                This page is intentionally parked while we lock the B2B workflow and product decisions.
                            </p>
                        </div>
                    </div>

                    <aside className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm dark:border-lc-border dark:bg-lc-surface">
                        <p className="text-sm font-bold text-slate-900 dark:text-white">Planned surface</p>
                        <div className="mt-5 space-y-4">
                            {["Workflow design", "API contracts", "Team permissions"].map((item) => (
                                <div key={item} className="flex items-center gap-3">
                                    <span className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
                                        <span className="material-symbols-outlined text-base">pending</span>
                                    </span>
                                    <span className="text-sm font-medium text-slate-600 dark:text-slate-300">{item}</span>
                                </div>
                            ))}
                        </div>
                    </aside>
                </section>
            </div>
        </main>
    );
}
