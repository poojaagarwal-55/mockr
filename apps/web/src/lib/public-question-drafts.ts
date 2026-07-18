export type PublicQuestionDraftKind = "dsa" | "sql" | "system-design";

export type PublicQuestionDraft = {
  content: string;
  kind: PublicQuestionDraftKind;
  language?: string;
  systemDesignElements?: unknown[];
  updatedAt: number;
};

const PREFIX = "practers-public-question-draft:";

function canUseStorage() {
  return typeof window !== "undefined" && Boolean(window.localStorage);
}

export function publicQuestionDraftKey(authPath: string) {
  return `${PREFIX}${authPath}`;
}

export function solveDraftPath(kind: PublicQuestionDraftKind, questionId: string) {
  const encodedId = encodeURIComponent(questionId);
  if (kind === "sql") return `/questions/sql/solve?id=${encodedId}`;
  if (kind === "system-design") return `/questions/system-design/solve?id=${encodedId}`;
  return `/questions/dsa/solve?id=${encodedId}`;
}

export function readPublicQuestionDraft(authPath: string): PublicQuestionDraft | null {
  if (!canUseStorage()) return null;
  try {
    const raw = window.localStorage.getItem(publicQuestionDraftKey(authPath));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PublicQuestionDraft>;
    if (!parsed || typeof parsed.content !== "string" || !parsed.kind) return null;
    return {
      content: parsed.content,
      kind: parsed.kind,
      language: parsed.language,
      systemDesignElements: Array.isArray(parsed.systemDesignElements) ? parsed.systemDesignElements : undefined,
      updatedAt: typeof parsed.updatedAt === "number" ? parsed.updatedAt : Date.now(),
    };
  } catch {
    return null;
  }
}

export function writePublicQuestionDraft(authPath: string, draft: Omit<PublicQuestionDraft, "updatedAt">) {
  if (!canUseStorage() || !authPath) return;
  try {
    window.localStorage.setItem(
      publicQuestionDraftKey(authPath),
      JSON.stringify({ ...draft, updatedAt: Date.now() })
    );
  } catch {}
}

export function clearPublicQuestionDraft(authPath: string) {
  if (!canUseStorage() || !authPath) return;
  try {
    window.localStorage.removeItem(publicQuestionDraftKey(authPath));
  } catch {}
}
