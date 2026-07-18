"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useCompanyAuth } from "@/context/company-auth-context";
import { api, ApiError } from "@/lib/api";

type TeamRole = "admin" | "member" | "viewer";
type TeamMemberStatus = "active" | "pending_invite" | "inactive" | "removed";

type TeamMember = {
    id: string;
    companyAccountId?: string | null;
    invitationId?: string | null;
    email: string;
    name: string;
    avatarUrl?: string | null;
    role: TeamRole;
    status: TeamMemberStatus;
    joinedAt?: string | null;
    invitation?: {
        id: string;
        status: string;
        expiresAt?: string | null;
        acceptedAt?: string | null;
    } | null;
};

type CompanyTeam = {
    id: string;
    name: string;
    description?: string | null;
    avatarColor?: string | null;
    createdAt?: string | null;
    members: TeamMember[];
    counts: {
        total: number;
        active: number;
        pending: number;
    };
};

type ModalMode = "existing" | "new";

const roleOptions: Array<{ value: TeamRole; label: string; icon: string; note: string }> = [
    { value: "admin", label: "Admin", icon: "admin_panel_settings", note: "Manage hiring workflows" },
    { value: "member", label: "Member", icon: "person", note: "Work on assigned rounds" },
    { value: "viewer", label: "Viewer", icon: "visibility", note: "Read-only access" },
];

const avatarColors = ["#4A7CFF", "#14B8A6", "#F97316", "#7C3AED", "#0F766E", "#DC2626"];

const emptyForm = {
    teamId: "",
    teamName: "",
    description: "",
    avatarColor: avatarColors[0],
    email: "",
    nameHint: "",
    role: "member" as TeamRole,
    message: "",
};

function apiErrorMessage(err: unknown, fallback: string) {
    return err instanceof ApiError ? err.message : fallback;
}

function memberInitials(nameOrEmail: string) {
    const clean = nameOrEmail.trim();
    if (!clean) return "TM";
    const parts = clean.includes("@") ? [clean.split("@")[0]] : clean.split(/\s+/);
    return parts
        .slice(0, 2)
        .map((part) => part[0]?.toUpperCase())
        .join("") || "TM";
}

function roleLabel(role: string) {
    return role.charAt(0).toUpperCase() + role.slice(1);
}

function roleIcon(role: TeamRole) {
    if (role === "admin") return "admin_panel_settings";
    if (role === "viewer") return "visibility";
    return "person";
}

function isExpired(member: TeamMember) {
    if (member.status !== "pending_invite" || !member.invitation?.expiresAt) return false;
    return new Date(member.invitation.expiresAt).getTime() <= Date.now();
}

function isSameCompanyPerson(first: TeamMember, second: TeamMember) {
    if (first.companyAccountId && second.companyAccountId && first.companyAccountId === second.companyAccountId) return true;
    return first.email.trim().toLowerCase() === second.email.trim().toLowerCase();
}

function statusView(member: TeamMember) {
    if (isExpired(member)) {
        return {
            label: "Invite expired",
            className: "bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-400/10 dark:text-amber-200 dark:ring-amber-300/20",
            icon: "schedule",
        };
    }

    if (member.status === "active") {
        return {
            label: "Active",
            className: "bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-400/10 dark:text-emerald-200 dark:ring-emerald-300/20",
            icon: "check_circle",
        };
    }

    if (member.status === "pending_invite") {
        return {
            label: "Invite sent",
            className: "bg-sky-50 text-sky-700 ring-sky-200 dark:bg-sky-400/10 dark:text-sky-200 dark:ring-sky-300/20",
            icon: "mail",
        };
    }

    return {
        label: roleLabel(member.status),
        className: "bg-slate-100 text-slate-600 ring-slate-200 dark:bg-lc-hover dark:text-slate-300 dark:ring-lc-border",
        icon: "remove_circle",
    };
}

function withCounts(team: CompanyTeam): CompanyTeam {
    const visibleMembers = team.members.filter((member) => member.status !== "removed");
    return {
        ...team,
        counts: {
            total: visibleMembers.length,
            active: visibleMembers.filter((member) => member.status === "active").length,
            pending: visibleMembers.filter((member) => member.status === "pending_invite").length,
        },
    };
}

export function TeamManagement() {
    const { session, company } = useCompanyAuth();
    const [teams, setTeams] = useState<CompanyTeam[]>([]);
    const [selectedTeamId, setSelectedTeamId] = useState("");
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState<string | null>(null);
    const [modalOpen, setModalOpen] = useState(false);
    const [modalMode, setModalMode] = useState<ModalMode>("existing");
    const [form, setForm] = useState(emptyForm);
    const [submitting, setSubmitting] = useState(false);
    const [updatingMemberId, setUpdatingMemberId] = useState<string | null>(null);
    const loadedCompanyIdRef = useRef<string | null>(null);
    const accessToken = session?.access_token || "";
    const companyId = company?.id || "";
    const canInviteMembers = company?.role === "owner" || company?.role === "admin" || company?.role === "member";
    const canChangeRoles = company?.role === "owner" || company?.role === "admin";
    const assignableRoleOptions = useMemo(
        () => (canChangeRoles ? roleOptions : roleOptions.filter((role) => role.value !== "admin")),
        [canChangeRoles]
    );

    useEffect(() => {
        if (!accessToken || !companyId) return;
        if (loadedCompanyIdRef.current === companyId) return;

        let cancelled = false;

        async function loadTeams() {
            setLoading(true);
            setError(null);
            try {
                const response = await api.get<{ teams: CompanyTeam[] }>("/companies/teams", accessToken);
                if (cancelled) return;

                const loadedTeams = response.teams.map(withCounts);
                setTeams(loadedTeams);
                setSelectedTeamId((current) => current || loadedTeams[0]?.id || "");
                loadedCompanyIdRef.current = companyId;
            } catch (err) {
                if (!cancelled) {
                    setError(apiErrorMessage(err, "Failed to load teams."));
                }
            } finally {
                if (!cancelled) setLoading(false);
            }
        }

        loadTeams();

        return () => {
            cancelled = true;
        };
    }, [accessToken, companyId]);

    const selectedTeam = useMemo(
        () => teams.find((team) => team.id === selectedTeamId) || teams[0] || null,
        [teams, selectedTeamId]
    );

    const totals = useMemo(() => {
        const allMembers = teams.flatMap((team) => team.members);
        return {
            teams: teams.length,
            active: allMembers.filter((member) => member.status === "active").length,
            pending: allMembers.filter((member) => member.status === "pending_invite").length,
        };
    }, [teams]);

    function openAddMember() {
        if (!canInviteMembers) {
            setError("You don't have access to add team members. Ask a company owner, admin, or member to do this.");
            setSuccess(null);
            return;
        }

        const mode: ModalMode = teams.length ? "existing" : "new";
        setModalMode(mode);
        setForm({
            ...emptyForm,
            teamId: selectedTeam?.id || teams[0]?.id || "",
        });
        setModalOpen(true);
        setError(null);
        setSuccess(null);
    }

    function closeModal() {
        if (submitting) return;
        setModalOpen(false);
    }

    function updateForm<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
        setForm((current) => ({ ...current, [key]: value }));
    }

    async function updateMemberRole(teamId: string, member: TeamMember, role: TeamRole) {
        if (!session?.access_token || member.role === role || updatingMemberId) return;
        if (!canChangeRoles) {
            setError("You don't have access to change team roles. Ask a company owner or admin to do this.");
            setSuccess(null);
            return;
        }

        setUpdatingMemberId(member.id);
        setError(null);
        setSuccess(null);

        try {
            const response = await api.patch<{ member: TeamMember }>(
                `/companies/teams/${teamId}/members/${member.id}`,
                { role },
                session.access_token
            );

            setTeams((current) =>
                current.map((team) =>
                    withCounts({
                        ...team,
                        members: team.members.map((item) => {
                            if (item.id === response.member.id) return response.member;
                            if (isSameCompanyPerson(item, response.member)) return { ...item, role: response.member.role };
                            return item;
                        }),
                    })
                )
            );
            setSuccess(`${member.name || member.email} is now ${roleLabel(response.member.role)} across all teams.`);
        } catch (err) {
            setError(apiErrorMessage(err, "Failed to change member role."));
        } finally {
            setUpdatingMemberId(null);
        }
    }

    async function submitMemberFlow(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (!session?.access_token) return;

        setSubmitting(true);
        setError(null);
        setSuccess(null);

        const memberPayload = {
            email: form.email.trim(),
            role: form.role,
            nameHint: form.nameHint.trim() || undefined,
            message: form.message.trim() || undefined,
        };

        try {
            if (modalMode === "new") {
                const response = await api.post<{ team: CompanyTeam; emailQueued: boolean }>(
                    "/companies/teams",
                    {
                        name: form.teamName.trim(),
                        description: form.description.trim() || undefined,
                        avatarColor: form.avatarColor,
                        initialMember: memberPayload,
                    },
                    session.access_token
                );

                const nextTeam = withCounts(response.team);
                setTeams((current) => [
                    nextTeam,
                    ...current.map((team) =>
                        withCounts({
                            ...team,
                            members: team.members.map((item) => {
                                const syncedMember = nextTeam.members.find((nextMember) => isSameCompanyPerson(item, nextMember));
                                return syncedMember ? { ...item, role: syncedMember.role } : item;
                            }),
                        })
                    ),
                ]);
                setSelectedTeamId(nextTeam.id);
                setSuccess(response.emailQueued ? "Team created and member processed." : "Team created. Email delivery needs attention.");
            } else {
                const teamId = form.teamId || selectedTeam?.id;
                if (!teamId) throw new Error("Choose a team first.");

                const response = await api.post<{ member: TeamMember; delivery: "added" | "invited"; emailQueued: boolean }>(
                    `/companies/teams/${teamId}/members`,
                    memberPayload,
                    session.access_token
                );

                setTeams((current) =>
                    current.map((team) =>
                        withCounts({
                            ...team,
                            members: [
                                ...team.members.map((item) =>
                                    isSameCompanyPerson(item, response.member) ? { ...item, role: response.member.role } : item
                                ),
                                ...(team.id === teamId ? [response.member] : []),
                            ],
                        })
                    )
                );
                setSuccess(response.delivery === "added" ? "Member added to the team with their company role." : "Invitation sent and reserved with the same company role.");
            }

            setModalOpen(false);
        } catch (err) {
            setError(apiErrorMessage(err, "Failed to update team members."));
        } finally {
            setSubmitting(false);
        }
    }

    return (
        <main className="min-h-full bg-[#FAFBFC] px-4 py-8 dark:bg-lc-bg sm:px-6 lg:px-10">
            <div className="mx-auto flex max-w-7xl flex-col gap-7">
                <section className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                    <div className="flex items-center gap-3">
                        <span className="flex size-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
                            <span className="material-symbols-outlined">badge</span>
                        </span>
                        <div>
                            <p className="text-xs font-bold uppercase text-slate-400 dark:text-slate-500">Company Workspace</p>
                            <h1 className="font-nunito text-3xl font-extrabold text-slate-950 dark:text-white sm:text-4xl">Team</h1>
                        </div>
                    </div>

                    <button
                        type="button"
                        onClick={openAddMember}
                        className="inline-flex h-12 items-center justify-center gap-2 rounded-full bg-primary px-5 text-sm font-bold text-white shadow-lg shadow-primary/20 transition hover:bg-primary-dark"
                    >
                        <span className="material-symbols-outlined text-[20px]">person_add</span>
                        Add member
                    </button>
                </section>

                <section className="grid gap-4 md:grid-cols-3">
                    <Metric label="Teams" value={totals.teams} icon="hub" />
                    <Metric label="Active members" value={totals.active} icon="verified_user" />
                    <Metric label="Pending invites" value={totals.pending} icon="outgoing_mail" />
                </section>

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

                {loading ? (
                    <section className="grid min-h-[420px] place-items-center rounded-lg border border-slate-200 bg-white shadow-sm dark:border-lc-border dark:bg-lc-surface">
                        <div className="h-10 w-10 animate-spin rounded-full border-4 border-primary/20 border-t-primary" />
                    </section>
                ) : teams.length === 0 ? (
                    <section className="flex min-h-[420px] flex-col items-center justify-center rounded-lg border border-dashed border-slate-200 bg-white p-8 text-center shadow-sm dark:border-lc-border dark:bg-lc-surface">
                        <div className="mb-5 grid size-16 place-items-center rounded-2xl bg-slate-100 text-slate-500 dark:bg-lc-hover dark:text-slate-300">
                            <span className="material-symbols-outlined text-4xl">group_add</span>
                        </div>
                        <h2 className="font-nunito text-2xl font-extrabold text-slate-950 dark:text-white">Create your first team</h2>
                        <p className="mt-2 max-w-md text-sm leading-6 text-slate-500 dark:text-slate-400">
                            Teams keep recruiters, interviewers, admins, and viewers organized around the same hiring workspace.
                        </p>
                        <button type="button" onClick={openAddMember} className="mt-6 inline-flex h-11 items-center gap-2 rounded-full bg-primary px-5 text-sm font-bold text-white">
                            <span className="material-symbols-outlined text-[20px]">add</span>
                            Create team
                        </button>
                    </section>
                ) : (
                    <section className="grid gap-5 xl:grid-cols-[280px_minmax(0,1fr)]">
                        <aside className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm dark:border-lc-border dark:bg-lc-surface">
                            <div className="flex items-center justify-between">
                                <h2 className="font-nunito text-lg font-extrabold text-slate-950 dark:text-white">Teams</h2>
                                <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-500 dark:bg-lc-hover dark:text-slate-300">{teams.length}</span>
                            </div>

                            <div className="mt-4 space-y-2">
                                {teams.map((team) => {
                                    const active = team.id === selectedTeam?.id;
                                    return (
                                        <button
                                            key={team.id}
                                            type="button"
                                            onClick={() => setSelectedTeamId(team.id)}
                                            className={`w-full rounded-lg border p-3 text-left transition ${
                                                active
                                                    ? "border-primary bg-primary/5"
                                                    : "border-transparent hover:border-slate-200 hover:bg-slate-50 dark:hover:border-lc-border dark:hover:bg-lc-hover"
                                            }`}
                                        >
                                            <div className="flex items-center gap-3">
                                                <span
                                                    className="grid size-10 shrink-0 place-items-center rounded-lg text-sm font-extrabold text-white"
                                                    style={{ backgroundColor: team.avatarColor || avatarColors[0] }}
                                                >
                                                    {memberInitials(team.name)}
                                                </span>
                                                <span className="min-w-0">
                                                    <span className="block truncate text-sm font-bold text-slate-950 dark:text-white">{team.name}</span>
                                                    <span className="mt-0.5 block text-xs font-medium text-slate-500 dark:text-slate-400">
                                                        {team.counts.active} active, {team.counts.pending} pending
                                                    </span>
                                                </span>
                                            </div>
                                        </button>
                                    );
                                })}
                            </div>
                        </aside>

                        <section className="rounded-lg border border-slate-200 bg-white shadow-sm dark:border-lc-border dark:bg-lc-surface">
                            {selectedTeam && (
                                <>
                                    <div className="flex flex-col gap-4 border-b border-slate-200 p-5 dark:border-lc-border md:flex-row md:items-start md:justify-between">
                                        <div className="flex min-w-0 gap-4">
                                            <span
                                                className="grid size-12 shrink-0 place-items-center rounded-lg text-base font-extrabold text-white"
                                                style={{ backgroundColor: selectedTeam.avatarColor || avatarColors[0] }}
                                            >
                                                {memberInitials(selectedTeam.name)}
                                            </span>
                                            <div className="min-w-0">
                                                <h2 className="font-nunito text-2xl font-extrabold text-slate-950 dark:text-white">{selectedTeam.name}</h2>
                                                <p className="mt-1 text-sm leading-6 text-slate-500 dark:text-slate-400">
                                                    {selectedTeam.description || `${company?.name || "This company"} team access and invitation status.`}
                                                </p>
                                            </div>
                                        </div>
                                        <button
                                            type="button"
                                            onClick={openAddMember}
                                            className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-full border border-slate-200 px-4 text-sm font-bold text-slate-700 transition hover:border-primary/40 hover:text-primary dark:border-lc-border dark:text-slate-200"
                                        >
                                            <span className="material-symbols-outlined text-[18px]">person_add</span>
                                            Add
                                        </button>
                                    </div>

                                    <div className="overflow-x-auto">
                                        <table className="w-full min-w-[720px] border-collapse text-left">
                                            <thead>
                                                <tr className="border-b border-slate-200 text-xs font-bold uppercase text-slate-400 dark:border-lc-border dark:text-slate-500">
                                                    <th className="px-5 py-3">Member</th>
                                                    <th className="px-5 py-3">Role</th>
                                                    <th className="px-5 py-3">Status</th>
                                                    <th className="px-5 py-3">Joined</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {selectedTeam.members.map((member) => {
                                                    const status = statusView(member);
                                                    return (
                                                        <tr key={member.id} className="border-b border-slate-100 last:border-0 dark:border-lc-border">
                                                            <td className="px-5 py-4">
                                                                <div className="flex items-center gap-3">
                                                                    {member.avatarUrl ? (
                                                                        <img src={member.avatarUrl} alt="" className="size-10 rounded-full object-cover" />
                                                                    ) : (
                                                                        <span className="grid size-10 place-items-center rounded-full bg-slate-100 text-sm font-extrabold text-slate-600 dark:bg-lc-hover dark:text-slate-200">
                                                                            {memberInitials(member.name || member.email)}
                                                                        </span>
                                                                    )}
                                                                    <div className="min-w-0">
                                                                        <p className="truncate text-sm font-bold text-slate-950 dark:text-white">{member.name}</p>
                                                                        <p className="truncate text-xs font-medium text-slate-500 dark:text-slate-400">{member.email}</p>
                                                                    </div>
                                                                </div>
                                                            </td>
                                                            <td className="px-5 py-4">
                                                                {canChangeRoles ? (
                                                                    <div className="inline-flex items-center gap-2">
                                                                        <span className="material-symbols-outlined text-[18px] text-slate-500 dark:text-slate-300">{roleIcon(member.role)}</span>
                                                                        <select
                                                                            value={member.role}
                                                                            disabled={updatingMemberId === member.id}
                                                                            onChange={(event) => updateMemberRole(selectedTeam.id, member, event.target.value as TeamRole)}
                                                                            className="h-9 rounded-full border border-slate-200 bg-slate-100 px-3 pr-8 text-xs font-bold text-slate-700 outline-none transition focus:border-primary focus:ring-4 focus:ring-primary/10 disabled:cursor-wait disabled:opacity-60 dark:border-lc-border dark:bg-lc-hover dark:text-slate-200"
                                                                            title="Change role"
                                                                        >
                                                                            {roleOptions.map((role) => (
                                                                                <option key={role.value} value={role.value}>{role.label}</option>
                                                                            ))}
                                                                        </select>
                                                                    </div>
                                                                ) : (
                                                                    <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-600 dark:bg-lc-hover dark:text-slate-200">
                                                                        <span className="material-symbols-outlined text-[15px]">{roleIcon(member.role)}</span>
                                                                        {roleLabel(member.role)}
                                                                    </span>
                                                                )}
                                                            </td>
                                                            <td className="px-5 py-4">
                                                                <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold ring-1 ${status.className}`}>
                                                                    <span className="material-symbols-outlined text-[15px]">{status.icon}</span>
                                                                    {status.label}
                                                                </span>
                                                            </td>
                                                            <td className="px-5 py-4 text-sm font-medium text-slate-500 dark:text-slate-400">
                                                                {member.joinedAt ? new Date(member.joinedAt).toLocaleDateString() : "Waiting"}
                                                            </td>
                                                        </tr>
                                                    );
                                                })}
                                            </tbody>
                                        </table>
                                    </div>
                                </>
                            )}
                        </section>

                     
                    </section>
                )}
            </div>

            {modalOpen && (
                <div className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/40 px-4 py-6 backdrop-blur-sm">
                    <form onSubmit={submitMemberFlow} className="max-h-full w-full max-w-2xl overflow-y-auto rounded-lg bg-white p-6 shadow-2xl dark:bg-lc-surface">
                        <div className="flex items-start justify-between gap-4">
                            <div>
                                <h2 className="font-nunito text-2xl font-extrabold text-slate-950 dark:text-white">Add member</h2>
                                <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Create a team with the member or add them to an existing team.</p>
                            </div>
                            <button type="button" onClick={closeModal} className="grid size-9 place-items-center rounded-full text-slate-500 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-lc-hover" title="Close">
                                <span className="material-symbols-outlined">close</span>
                            </button>
                        </div>

                        <div className="mt-5 grid grid-cols-2 rounded-lg bg-slate-100 p-1 dark:bg-lc-hover">
                            <button
                                type="button"
                                onClick={() => setModalMode("existing")}
                                disabled={!teams.length}
                                className={`h-10 rounded-md text-sm font-bold transition disabled:cursor-not-allowed disabled:opacity-50 ${
                                    modalMode === "existing" ? "bg-white text-slate-950 shadow-sm dark:bg-lc-surface dark:text-white" : "text-slate-500 dark:text-slate-300"
                                }`}
                            >
                                Existing team
                            </button>
                            <button
                                type="button"
                                onClick={() => setModalMode("new")}
                                className={`h-10 rounded-md text-sm font-bold transition ${
                                    modalMode === "new" ? "bg-white text-slate-950 shadow-sm dark:bg-lc-surface dark:text-white" : "text-slate-500 dark:text-slate-300"
                                }`}
                            >
                                New team
                            </button>
                        </div>

                        <div className="mt-5 grid gap-4 md:grid-cols-2">
                            {modalMode === "existing" ? (
                                <label className="md:col-span-2">
                                    <span className="text-xs font-bold uppercase text-slate-500 dark:text-slate-400">Team</span>
                                    <select
                                        value={form.teamId || selectedTeam?.id || ""}
                                        onChange={(event) => updateForm("teamId", event.target.value)}
                                        className="mt-2 h-12 w-full rounded-lg border border-slate-200 bg-white px-4 text-sm font-bold text-slate-950 outline-none transition focus:border-primary focus:ring-4 focus:ring-primary/10 dark:border-lc-border dark:bg-lc-input dark:text-white"
                                    >
                                        {teams.map((team) => (
                                            <option key={team.id} value={team.id}>{team.name}</option>
                                        ))}
                                    </select>
                                </label>
                            ) : (
                                <>
                                    <label>
                                        <span className="text-xs font-bold uppercase text-slate-500 dark:text-slate-400">Team name</span>
                                        <input
                                            value={form.teamName}
                                            onChange={(event) => updateForm("teamName", event.target.value)}
                                            required
                                            maxLength={100}
                                            placeholder="Recruiting"
                                            className="mt-2 h-12 w-full rounded-lg border border-slate-200 bg-white px-4 text-sm font-bold text-slate-950 outline-none transition placeholder:text-slate-400 focus:border-primary focus:ring-4 focus:ring-primary/10 dark:border-lc-border dark:bg-lc-input dark:text-white"
                                        />
                                    </label>
                                    <div>
                                        <span className="text-xs font-bold uppercase text-slate-500 dark:text-slate-400">Color</span>
                                        <div className="mt-2 flex h-12 items-center gap-2">
                                            {avatarColors.map((color) => (
                                                <button
                                                    key={color}
                                                    type="button"
                                                    onClick={() => updateForm("avatarColor", color)}
                                                    title={color}
                                                    className={`size-8 rounded-full ring-2 ring-offset-2 ring-offset-white transition dark:ring-offset-lc-surface ${
                                                        form.avatarColor === color ? "ring-slate-900 dark:ring-white" : "ring-transparent"
                                                    }`}
                                                    style={{ backgroundColor: color }}
                                                />
                                            ))}
                                        </div>
                                    </div>
                                    <label className="md:col-span-2">
                                        <span className="text-xs font-bold uppercase text-slate-500 dark:text-slate-400">Description</span>
                                        <input
                                            value={form.description}
                                            onChange={(event) => updateForm("description", event.target.value)}
                                            maxLength={600}
                                            placeholder="Recruiter and interview coordination"
                                            className="mt-2 h-12 w-full rounded-lg border border-slate-200 bg-white px-4 text-sm font-medium text-slate-950 outline-none transition placeholder:text-slate-400 focus:border-primary focus:ring-4 focus:ring-primary/10 dark:border-lc-border dark:bg-lc-input dark:text-white"
                                        />
                                    </label>
                                </>
                            )}

                            <label>
                                <span className="text-xs font-bold uppercase text-slate-500 dark:text-slate-400">Email</span>
                                <input
                                    type="email"
                                    value={form.email}
                                    onChange={(event) => updateForm("email", event.target.value)}
                                    required
                                    placeholder="member@company.com"
                                    className="mt-2 h-12 w-full rounded-lg border border-slate-200 bg-white px-4 text-sm font-bold text-slate-950 outline-none transition placeholder:text-slate-400 focus:border-primary focus:ring-4 focus:ring-primary/10 dark:border-lc-border dark:bg-lc-input dark:text-white"
                                />
                            </label>

                            <label>
                                <span className="text-xs font-bold uppercase text-slate-500 dark:text-slate-400">Role</span>
                                <select
                                    value={form.role}
                                    onChange={(event) => updateForm("role", event.target.value as TeamRole)}
                                    className="mt-2 h-12 w-full rounded-lg border border-slate-200 bg-white px-4 text-sm font-bold text-slate-950 outline-none transition focus:border-primary focus:ring-4 focus:ring-primary/10 dark:border-lc-border dark:bg-lc-input dark:text-white"
                                >
                                    {assignableRoleOptions.map((role) => (
                                        <option key={role.value} value={role.value}>{role.label}</option>
                                    ))}
                                </select>
                            </label>

                            <label>
                                <span className="text-xs font-bold uppercase text-slate-500 dark:text-slate-400">Name hint</span>
                                <input
                                    value={form.nameHint}
                                    onChange={(event) => updateForm("nameHint", event.target.value)}
                                    maxLength={120}
                                    placeholder="Optional"
                                    className="mt-2 h-12 w-full rounded-lg border border-slate-200 bg-white px-4 text-sm font-medium text-slate-950 outline-none transition placeholder:text-slate-400 focus:border-primary focus:ring-4 focus:ring-primary/10 dark:border-lc-border dark:bg-lc-input dark:text-white"
                                />
                            </label>

                            <label>
                                <span className="text-xs font-bold uppercase text-slate-500 dark:text-slate-400">Message</span>
                                <input
                                    value={form.message}
                                    onChange={(event) => updateForm("message", event.target.value)}
                                    maxLength={600}
                                    placeholder="Optional"
                                    className="mt-2 h-12 w-full rounded-lg border border-slate-200 bg-white px-4 text-sm font-medium text-slate-950 outline-none transition placeholder:text-slate-400 focus:border-primary focus:ring-4 focus:ring-primary/10 dark:border-lc-border dark:bg-lc-input dark:text-white"
                                />
                            </label>
                        </div>

                        <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
                            <button type="button" onClick={closeModal} className="h-11 rounded-full border border-slate-200 px-5 text-sm font-bold text-slate-700 transition hover:bg-slate-50 dark:border-lc-border dark:text-slate-200 dark:hover:bg-lc-hover">
                                Cancel
                            </button>
                            <button type="submit" disabled={submitting} className="inline-flex h-11 items-center justify-center gap-2 rounded-full bg-primary px-5 text-sm font-bold text-white transition hover:bg-primary-dark disabled:cursor-not-allowed disabled:opacity-60">
                                {submitting && <span className="size-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />}
                                {modalMode === "new" ? "Create team and add" : "Add to team"}
                            </button>
                        </div>
                    </form>
                </div>
            )}
        </main>
    );
}

function Metric({ label, value, icon }: { label: string; value: number; icon: string }) {
    return (
        <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm dark:border-lc-border dark:bg-lc-surface">
            <div className="flex items-center justify-between gap-3">
                <div>
                    <p className="text-sm font-bold text-slate-500 dark:text-slate-400">{label}</p>
                    <p className="mt-1 font-nunito text-3xl font-extrabold text-slate-950 dark:text-white">{value}</p>
                </div>
                <span className="grid size-11 place-items-center rounded-lg bg-primary/10 text-primary">
                    <span className="material-symbols-outlined">{icon}</span>
                </span>
            </div>
        </div>
    );
}
