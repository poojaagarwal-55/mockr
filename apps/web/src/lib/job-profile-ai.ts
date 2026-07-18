import { api, getApiBaseUrl } from "@/lib/api";

export type ImproveField = "about" | "headline" | "experience" | "project" | "featured" | "education";

export type AutofillProfile = {
    headline?: string;
    industry?: string;
    city?: string;
    country?: string;
    about?: string;
    openTo?: string;
    leetcodeUrl?: string;
    geeksforgeeksUrl?: string;
    codeforcesUrl?: string;
    codechefUrl?: string;
    skills?: string[];
    experiences?: { title: string; company: string; employmentType: string; startDate: string; endDate: string; location: string; description: string }[];
    education?: { school: string; degree: string; field: string; startDate: string; endDate: string }[];
    projects?: { title: string; role: string; startDate: string; endDate: string; description: string; technologies: string[] }[];
};

/** Parse an uploaded resume PDF into a structured profile that fills the flow. */
export async function autofillFromResume(file: File, token: string): Promise<AutofillProfile> {
    const form = new FormData();
    form.append("file", file, file.name);
    const res = await fetch(`${getApiBaseUrl()}/job-profiles/autofill`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: form,
        credentials: "include",
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.message || body.error || "Could not read that resume");
    return (body.profile as AutofillProfile) || {};
}

/** Ask Grok to speak a line. Returns an object URL for a playable WAV blob. */
export async function fetchSpeech(text: string, token: string, signal?: AbortSignal): Promise<string> {
    const res = await fetch(`${getApiBaseUrl()}/job-profiles/voice/speak`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ text }),
        credentials: "include",
        signal,
    });
    if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message || body.error || "Voice unavailable");
    }
    const blob = await res.blob();
    return URL.createObjectURL(blob);
}

/** Send a recorded audio clip to Deepgram and get the transcript back. */
export async function transcribeAudio(blob: Blob, token: string): Promise<string> {
    const form = new FormData();
    const ext = blob.type.includes("ogg") ? "ogg" : blob.type.includes("mp4") ? "mp4" : "webm";
    form.append("file", blob, `answer.${ext}`);
    const res = await fetch(`${getApiBaseUrl()}/job-profiles/voice/transcribe`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: form,
        credentials: "include",
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.message || body.error || "Could not transcribe audio");
    return (body.transcript as string) || "";
}

export type VoiceField = { key: string; label: string; hint?: string };

/** Turn one spoken sentence into structured values for the given fields. */
export async function extractFields(
    transcript: string,
    fields: VoiceField[],
    token: string
): Promise<Record<string, string>> {
    const res = await api.post<{ values: Record<string, string> }>(
        "/job-profiles/extract",
        { transcript, fields },
        token
    );
    return res.values || {};
}

/** Rewrite a single free-text field into polished, structured English. */
export async function improveText(
    field: ImproveField,
    text: string,
    token: string,
    context?: string
): Promise<string> {
    const res = await api.post<{ improved: string }>(
        "/job-profiles/improve",
        { field, text, context },
        token
    );
    return res.improved;
}
