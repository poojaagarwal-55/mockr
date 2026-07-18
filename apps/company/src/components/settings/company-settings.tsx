"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { useTheme } from "next-themes";
import { api, ApiError, getApiBaseUrl } from "@/lib/api";
import { useCompanyAuth, type CompanyProfile } from "@/context/company-auth-context";

type CompanySize = "" | "1-10" | "11-50" | "51-200" | "201-500" | "501-1000" | "1000+";
type WorkMode = "Remote" | "Hybrid" | "On-site";
type EmploymentType = "Full-time" | "Internship" | "Contract" | "Part-time";
type Currency = "INR" | "USD" | "EUR" | "GBP";

type CompanySettingsForm = {
    name: string;
    contactName: string;
    websiteUrl: string;
    logoUrl: string;
    industry: string;
    companySize: CompanySize;
    headquarters: string;
    defaultTimezone: string;
    defaultWorkMode: WorkMode;
    defaultEmploymentType: EmploymentType;
    defaultCurrency: Currency;
    defaultAssessmentDeadlineDays: number;
    notifyNewApplications: boolean;
    notifyAssessmentSubmissions: boolean;
    notifyWeeklyDigest: boolean;
    notifyTeamChanges: boolean;
};

const companySizes: CompanySize[] = ["", "1-10", "11-50", "51-200", "201-500", "501-1000", "1000+"];
const industries = [
    "",
    "Software",
    "AI / ML",
    "Fintech",
    "Edtech",
    "Healthcare",
    "E-commerce",
    "Consulting",
    "Manufacturing",
    "Other",
];
const timezones = ["Asia/Kolkata", "UTC", "America/New_York", "America/Los_Angeles", "Europe/London", "Asia/Singapore"];
const workModes: WorkMode[] = ["Remote", "Hybrid", "On-site"];
const employmentTypes: EmploymentType[] = ["Full-time", "Internship", "Contract", "Part-time"];
const currencies: Currency[] = ["INR", "USD", "EUR", "GBP"];

function formFromCompany(company: CompanyProfile | null): CompanySettingsForm {
    return {
        name: company?.name || "",
        contactName: company?.contactName || "",
        websiteUrl: company?.websiteUrl || "",
        logoUrl: company?.logoUrl || "",
        industry: company?.industry || "",
        companySize: (company?.companySize as CompanySize) || "",
        headquarters: company?.headquarters || "",
        defaultTimezone: company?.defaultTimezone || "Asia/Kolkata",
        defaultWorkMode: company?.defaultWorkMode || "Hybrid",
        defaultEmploymentType: company?.defaultEmploymentType || "Full-time",
        defaultCurrency: company?.defaultCurrency || "INR",
        defaultAssessmentDeadlineDays: company?.defaultAssessmentDeadlineDays || 7,
        notifyNewApplications: company?.notifyNewApplications ?? true,
        notifyAssessmentSubmissions: company?.notifyAssessmentSubmissions ?? true,
        notifyWeeklyDigest: company?.notifyWeeklyDigest ?? true,
        notifyTeamChanges: company?.notifyTeamChanges ?? true,
    };
}

function roleLabel(role?: string) {
    if (!role) return "Member";
    return role.charAt(0).toUpperCase() + role.slice(1);
}

function apiErrorMessage(err: unknown, fallback: string) {
    return err instanceof ApiError ? err.message : fallback;
}

export function CompanySettings() {
    const { company, session, refreshCompany, resetPassword } = useCompanyAuth();
    const { theme, setTheme } = useTheme();
    const [form, setForm] = useState<CompanySettingsForm>(() => formFromCompany(company));
    const [saving, setSaving] = useState(false);
    const [uploadingLogo, setUploadingLogo] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState<string | null>(null);
    const [resetStatus, setResetStatus] = useState<"idle" | "sending" | "sent">("idle");

    const canEdit = company?.role === "owner" || company?.role === "admin";
    const isOAuthUser = session?.user?.app_metadata?.provider === "google";
    const providerLabel = isOAuthUser ? "Google" : "Email";
    const accountEmail = session?.user?.email || company?.email || "";

    useEffect(() => {
        document.title = "Company Settings | Practers";
    }, []);

    useEffect(() => {
        setForm(formFromCompany(company));
    }, [company]);

    const completion = useMemo(() => {
        const values = [form.name, form.contactName, form.websiteUrl, form.industry, form.companySize, form.headquarters];
        const filled = values.filter(Boolean).length;
        return Math.round((filled / values.length) * 100);
    }, [form]);

    function update<K extends keyof CompanySettingsForm>(key: K, value: CompanySettingsForm[K]) {
        setForm((current) => ({ ...current, [key]: value }));
        setSuccess(null);
        setError(null);
    }

    async function submitSettings(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (!session?.access_token || !canEdit) return;

        setSaving(true);
        setError(null);
        setSuccess(null);

        try {
            const response = await api.patch<{ company: CompanyProfile }>(
                "/companies/settings",
                {
                    ...form,
                    companySize: form.companySize || null,
                    defaultAssessmentDeadlineDays: Number(form.defaultAssessmentDeadlineDays),
                },
                session.access_token
            );

            setForm(formFromCompany(response.company));
            await refreshCompany();
            setSuccess("Company settings saved.");
        } catch (err) {
            setError(apiErrorMessage(err, "Failed to save company settings."));
        } finally {
            setSaving(false);
        }
    }

    async function uploadLogo(file: File | null) {
        if (!file || !session?.access_token || uploadingLogo) return;
        if (!canEdit) {
            setError("Only company owners and admins can upload the company logo.");
            return;
        }

        setUploadingLogo(true);
        setError(null);
        setSuccess(null);

        try {
            const body = new FormData();
            body.append("file", file);

            const res = await fetch(`${getApiBaseUrl()}/companies/settings/logo`, {
                method: "POST",
                headers: { Authorization: `Bearer ${session.access_token}` },
                credentials: "include",
                body,
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                throw new ApiError(res.status, data.message || data.error || "Failed to upload logo.", data);
            }

            setForm((current) => ({ ...current, logoUrl: data.fileUrl || "" }));
            await refreshCompany();
            setSuccess("Company logo uploaded.");
        } catch (err) {
            setError(apiErrorMessage(err, "Failed to upload company logo."));
        } finally {
            setUploadingLogo(false);
        }
    }

    async function sendPasswordReset() {
        if (!accountEmail || resetStatus === "sending") return;

        setResetStatus("sending");
        setError(null);
        try {
            await resetPassword(accountEmail);
            setResetStatus("sent");
        } catch (err) {
            setResetStatus("idle");
            setError(apiErrorMessage(err, "Failed to send password reset email."));
        }
    }

    if (!company) {
        return (
            <main className="min-h-full bg-[#FAFBFC] px-4 py-8 dark:bg-lc-bg sm:px-6 lg:px-10">
                <section className="grid min-h-[420px] place-items-center rounded-lg border border-slate-200 bg-white shadow-sm dark:border-lc-border dark:bg-lc-surface">
                    <div className="h-10 w-10 animate-spin rounded-full border-4 border-primary/20 border-t-primary" />
                </section>
            </main>
        );
    }

    return (
        <main className="min-h-full bg-[#FAFBFC] px-4 py-8 dark:bg-lc-bg sm:px-6 lg:px-10">
            <form onSubmit={submitSettings} className="mx-auto flex max-w-7xl flex-col gap-7">
                <section className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                    <div className="flex items-center gap-3">
                        <span className="flex size-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
                            <span className="material-symbols-outlined">settings</span>
                        </span>
                        <div>
                            <p className="text-xs font-bold uppercase text-slate-400 dark:text-slate-500">Company Workspace</p>
                            <h1 className="font-nunito text-3xl font-extrabold text-slate-950 dark:text-white sm:text-4xl">Settings</h1>
                        </div>
                    </div>

                    <button
                        type="submit"
                        disabled={!canEdit || saving}
                        className="inline-flex h-12 items-center justify-center gap-2 rounded-full bg-primary px-5 text-sm font-bold text-white shadow-lg shadow-primary/20 transition hover:bg-primary-dark disabled:cursor-not-allowed disabled:opacity-50"
                    >
                        {saving ? <span className="size-4 animate-spin rounded-full border-2 border-white/40 border-t-white" /> : <span className="material-symbols-outlined text-[20px]">save</span>}
                        {saving ? "Saving" : "Save changes"}
                    </button>
                </section>

                {!canEdit && (
                    <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800 dark:border-amber-300/20 dark:bg-amber-400/10 dark:text-amber-200">
                        Your role can view settings. Owners and admins can edit them.
                    </div>
                )}

                {error && (
                    <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700 dark:border-red-400/30 dark:bg-red-400/10 dark:text-red-300">
                        {error}
                    </div>
                )}

                {success && (
                    <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-700 dark:border-emerald-400/30 dark:bg-emerald-400/10 dark:text-emerald-200">
                        {success}
                    </div>
                )}

              

                <section className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
                    <div className="space-y-5">
                        <SettingsSection icon="corporate_fare" title="Company Profile">
                            <div className="grid gap-4 md:grid-cols-2">
                                <Field label="Company name" value={form.name} onChange={(value) => update("name", value)} disabled={!canEdit} required />
                                <Field label="Primary contact" value={form.contactName} onChange={(value) => update("contactName", value)} disabled={!canEdit} placeholder="Hiring lead or founder" />
                                <Field label="Website" value={form.websiteUrl} onChange={(value) => update("websiteUrl", value)} disabled={!canEdit} placeholder="https://company.com" />
                                <LogoUploadField
                                    disabled={!canEdit}
                                    logoUrl={form.logoUrl}
                                    uploading={uploadingLogo}
                                    onChoose={uploadLogo}
                                    onRemove={() => update("logoUrl", "")}
                                />
                                <SelectField label="Industry" value={form.industry} onChange={(value) => update("industry", value)} disabled={!canEdit} options={industries} placeholder="Choose industry" />
                                <SelectField label="Company size" value={form.companySize} onChange={(value) => update("companySize", value as CompanySize)} disabled={!canEdit} options={companySizes} placeholder="Choose size" />
                                <Field label="Headquarters" value={form.headquarters} onChange={(value) => update("headquarters", value)} disabled={!canEdit} placeholder="Jaipur, India" />
                                <ReadOnlyField label="Company domain" value={company.domain} />
                            </div>
                        </SettingsSection>

                       

                        <SettingsSection icon="notifications_active" title="Notifications">
                            <div className="divide-y divide-slate-100 dark:divide-lc-border">
                                <ToggleRow label="New applications" checked={form.notifyNewApplications} onChange={(value) => update("notifyNewApplications", value)} disabled={!canEdit} />
                                <ToggleRow label="Assessment submissions" checked={form.notifyAssessmentSubmissions} onChange={(value) => update("notifyAssessmentSubmissions", value)} disabled={!canEdit} />
                                <ToggleRow label="Weekly hiring digest" checked={form.notifyWeeklyDigest} onChange={(value) => update("notifyWeeklyDigest", value)} disabled={!canEdit} />
                                <ToggleRow label="Team membership changes" checked={form.notifyTeamChanges} onChange={(value) => update("notifyTeamChanges", value)} disabled={!canEdit} />
                            </div>
                        </SettingsSection>
                    </div>

                    <aside className="space-y-5">
                        <SettingsSection icon="badge" title="Brand Preview">
                            <div className="flex items-center gap-4">
                                <div className="grid size-16 shrink-0 place-items-center overflow-hidden rounded-lg border border-slate-200 bg-slate-50 text-xl font-extrabold text-primary dark:border-lc-border dark:bg-lc-elevated">
                                    {form.logoUrl ? <img src={form.logoUrl} alt="" className="h-full w-full object-contain p-2" /> : form.name.charAt(0).toUpperCase() || "C"}
                                </div>
                                <div className="min-w-0">
                                    <p className="truncate font-nunito text-xl font-extrabold text-slate-950 dark:text-white">{form.name || "Company"}</p>
                                    <p className="mt-1 truncate text-sm font-medium text-slate-500 dark:text-slate-400">{form.websiteUrl || company.domain}</p>
                                </div>
                            </div>
                        </SettingsSection>

                        <SettingsSection icon="shield_lock" title="Security">
                            <InfoRow label="Sign-in email" value={accountEmail} />
                            <InfoRow label="Provider" value={providerLabel} />
                            <InfoRow label="Access type" value={company.accessType === "owner" ? "Owner account" : "Team member"} />
                            {!isOAuthUser && (
                                <button
                                    type="button"
                                    onClick={sendPasswordReset}
                                    disabled={resetStatus === "sending"}
                                    className="mt-4 inline-flex h-10 w-full items-center justify-center gap-2 rounded-full border border-slate-200 px-4 text-sm font-bold text-slate-700 transition hover:border-primary/40 hover:text-primary disabled:cursor-wait disabled:opacity-60 dark:border-lc-border dark:text-slate-200"
                                >
                                    <span className="material-symbols-outlined text-[18px]">lock_reset</span>
                                    {resetStatus === "sent" ? "Reset email sent" : resetStatus === "sending" ? "Sending" : "Send password reset"}
                                </button>
                            )}
                        </SettingsSection>

                        <SettingsSection icon="groups" title="Workspace">
                            <Link href="/team" className="flex h-11 items-center justify-between rounded-lg border border-slate-200 px-4 text-sm font-bold text-slate-700 transition hover:border-primary/40 hover:text-primary dark:border-lc-border dark:text-slate-200">
                                Team and roles
                                <span className="material-symbols-outlined text-[18px]">arrow_forward</span>
                            </Link>
                         
                        </SettingsSection>

                        <SettingsSection icon="palette" title="Appearance">
                            <div className="grid grid-cols-3 gap-2">
                                {["light", "dark", "system"].map((option) => (
                                    <button
                                        key={option}
                                        type="button"
                                        onClick={() => setTheme(option)}
                                        className={`h-10 rounded-lg border text-xs font-bold capitalize transition ${
                                            theme === option
                                                ? "border-primary bg-primary text-white"
                                                : "border-slate-200 text-slate-600 hover:border-primary/40 dark:border-lc-border dark:text-slate-300"
                                        }`}
                                    >
                                        {option}
                                    </button>
                                ))}
                            </div>
                        </SettingsSection>
                    </aside>
                </section>
            </form>
        </main>
    );
}

function SettingsSection({ children, icon, title }: { children: ReactNode; icon: string; title: string }) {
    return (
        <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm dark:border-lc-border dark:bg-lc-surface">
            <div className="mb-5 flex items-center gap-3">
                <span className="grid size-9 place-items-center rounded-lg bg-primary/10 text-primary">
                    <span className="material-symbols-outlined text-[20px]">{icon}</span>
                </span>
                <h2 className="font-nunito text-xl font-extrabold text-slate-950 dark:text-white">{title}</h2>
            </div>
            {children}
        </section>
    );
}

function Field({
    disabled,
    label,
    onChange,
    placeholder,
    required,
    value,
}: {
    disabled?: boolean;
    label: string;
    onChange: (value: string) => void;
    placeholder?: string;
    required?: boolean;
    value: string;
}) {
    return (
        <label>
            <span className="text-xs font-bold uppercase text-slate-500 dark:text-slate-400">{label}</span>
            <input
                value={value}
                onChange={(event) => onChange(event.target.value)}
                disabled={disabled}
                required={required}
                maxLength={2000}
                placeholder={placeholder}
                className="mt-2 h-12 w-full rounded-lg border border-slate-200 bg-white px-4 text-sm font-bold text-slate-950 outline-none transition placeholder:text-slate-400 focus:border-primary focus:ring-4 focus:ring-primary/10 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-500 dark:border-lc-border dark:bg-lc-input dark:text-white dark:disabled:bg-lc-elevated"
            />
        </label>
    );
}

function LogoUploadField({
    disabled,
    logoUrl,
    onChoose,
    onRemove,
    uploading,
}: {
    disabled?: boolean;
    logoUrl: string;
    onChoose: (file: File | null) => void;
    onRemove: () => void;
    uploading: boolean;
}) {
    return (
        <div>
            <span className="text-xs font-bold uppercase text-slate-500 dark:text-slate-400">Company logo</span>
            <div className="mt-2 flex min-h-12 items-center gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2 dark:border-lc-border dark:bg-lc-input">
                <div className="grid size-9 shrink-0 place-items-center overflow-hidden rounded-lg bg-slate-100 text-sm font-extrabold text-slate-500 dark:bg-lc-hover dark:text-slate-200">
                    {logoUrl ? <img src={logoUrl} alt="" className="h-full w-full object-contain p-1" /> : <span className="material-symbols-outlined text-[20px]">image</span>}
                </div>

                <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-bold text-slate-700 dark:text-slate-200">
                        {uploading ? "Uploading logo..." : logoUrl ? "Logo uploaded" : "PNG, JPG, or WebP up to 3MB"}
                    </p>
                    {logoUrl && <p className="truncate text-xs font-medium text-slate-400">Saved to company profile</p>}
                </div>

                <label className={`inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-full border border-slate-200 px-3 text-xs font-bold transition dark:border-lc-border ${
                    disabled || uploading
                        ? "cursor-not-allowed text-slate-400 opacity-60"
                        : "cursor-pointer text-slate-700 hover:border-primary/40 hover:text-primary dark:text-slate-200"
                }`}>
                    <span className="material-symbols-outlined text-[17px]">{uploading ? "hourglass_empty" : "upload"}</span>
                    Choose file
                    <input
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        disabled={disabled || uploading}
                        className="sr-only"
                        onChange={(event) => {
                            onChoose(event.target.files?.[0] || null);
                            event.currentTarget.value = "";
                        }}
                    />
                </label>

                {logoUrl && (
                    <button
                        type="button"
                        disabled={disabled || uploading}
                        onClick={onRemove}
                        className="grid size-9 shrink-0 place-items-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-lc-hover"
                        title="Remove logo"
                    >
                        <span className="material-symbols-outlined text-[18px]">delete</span>
                    </button>
                )}
            </div>
        </div>
    );
}

function NumberField({
    disabled,
    label,
    max,
    min,
    onChange,
    value,
}: {
    disabled?: boolean;
    label: string;
    max: number;
    min: number;
    onChange: (value: number) => void;
    value: number;
}) {
    return (
        <label>
            <span className="text-xs font-bold uppercase text-slate-500 dark:text-slate-400">{label}</span>
            <input
                type="number"
                min={min}
                max={max}
                value={value}
                onChange={(event) => onChange(Number(event.target.value))}
                disabled={disabled}
                className="mt-2 h-12 w-full rounded-lg border border-slate-200 bg-white px-4 text-sm font-bold text-slate-950 outline-none transition focus:border-primary focus:ring-4 focus:ring-primary/10 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-500 dark:border-lc-border dark:bg-lc-input dark:text-white dark:disabled:bg-lc-elevated"
            />
        </label>
    );
}

function SelectField({
    disabled,
    label,
    onChange,
    options,
    placeholder,
    value,
}: {
    disabled?: boolean;
    label: string;
    onChange: (value: string) => void;
    options: string[];
    placeholder?: string;
    value: string;
}) {
    return (
        <label>
            <span className="text-xs font-bold uppercase text-slate-500 dark:text-slate-400">{label}</span>
            <select
                value={value}
                onChange={(event) => onChange(event.target.value)}
                disabled={disabled}
                className="mt-2 h-12 w-full rounded-lg border border-slate-200 bg-white px-4 text-sm font-bold text-slate-950 outline-none transition focus:border-primary focus:ring-4 focus:ring-primary/10 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-500 dark:border-lc-border dark:bg-lc-input dark:text-white dark:disabled:bg-lc-elevated"
            >
                {options.map((option) => (
                    <option key={option || "empty"} value={option}>
                        {option || placeholder || "None"}
                    </option>
                ))}
            </select>
        </label>
    );
}

function ReadOnlyField({ label, value }: { label: string; value: string }) {
    return (
        <div>
            <span className="text-xs font-bold uppercase text-slate-500 dark:text-slate-400">{label}</span>
            <div className="mt-2 flex h-12 items-center rounded-lg border border-slate-200 bg-slate-50 px-4 text-sm font-bold text-slate-500 dark:border-lc-border dark:bg-lc-elevated dark:text-slate-300">
                {value}
            </div>
        </div>
    );
}

function ToggleRow({
    checked,
    disabled,
    label,
    onChange,
}: {
    checked: boolean;
    disabled?: boolean;
    label: string;
    onChange: (value: boolean) => void;
}) {
    return (
        <label className="flex items-center justify-between gap-4 py-4 first:pt-0 last:pb-0">
            <span className="text-sm font-bold text-slate-700 dark:text-slate-200">{label}</span>
            <input
                type="checkbox"
                checked={checked}
                disabled={disabled}
                onChange={(event) => onChange(event.target.checked)}
                className="size-5 rounded border-slate-300 text-primary focus:ring-primary disabled:cursor-not-allowed disabled:opacity-50"
            />
        </label>
    );
}

function InfoRow({ label, value }: { label: string; value: string }) {
    return (
        <div className="border-b border-slate-100 py-3 first:pt-0 last:border-0 last:pb-0 dark:border-lc-border">
            <p className="text-xs font-bold uppercase text-slate-400 dark:text-slate-500">{label}</p>
            <p className="mt-1 truncate text-sm font-bold text-slate-800 dark:text-slate-100">{value}</p>
        </div>
    );
}

function Metric({
    icon,
    label,
    tone,
    value,
}: {
    icon: string;
    label: string;
    tone: "primary" | "slate" | "green" | "amber";
    value: string;
}) {
    const toneClass = {
        primary: "bg-primary/10 text-primary",
        slate: "bg-slate-100 text-slate-600 dark:bg-lc-hover dark:text-slate-200",
        green: "bg-emerald-50 text-emerald-700 dark:bg-emerald-400/10 dark:text-emerald-200",
        amber: "bg-amber-50 text-amber-700 dark:bg-amber-400/10 dark:text-amber-200",
    }[tone];

    return (
        <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm dark:border-lc-border dark:bg-lc-surface">
            <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                    <p className="text-sm font-bold text-slate-500 dark:text-slate-400">{label}</p>
                    <p className="mt-1 truncate font-nunito text-2xl font-extrabold text-slate-950 dark:text-white">{value}</p>
                </div>
                <span className={`grid size-11 place-items-center rounded-lg ${toneClass}`}>
                    <span className="material-symbols-outlined">{icon}</span>
                </span>
            </div>
        </div>
    );
}
