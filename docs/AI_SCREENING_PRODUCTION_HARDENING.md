# Company AI Screening — Production Hardening Plan

Scope: `apps/api/src/services/company-ai-screening/*`, the company start/submit flow in `apps/api/src/routes/jobs.ts`, the recruiter UI in `apps/company/src/components/ai-interviews/ai-interviews-workspace.tsx`, and the candidate room in `apps/web/.../screening-room/[roundCandidateId]/page.tsx`.

This is a product, not a prototype. The goal of this list is to get the company AI screening round to the point where a recruiter can trust it as their **first-round filter** and prefer it over a resume/ATS keyword screen. Items are grouped by problem class and ordered by priority within each group.

---

## 0. The one architectural issue underneath everything

There are **two interview engines** and they don't share evaluation:

1. **Live engine (production):** Grok drives the interview. The recruiter blueprint is injected as a *prompt directive* (`buildCompanyScreeningRuntimeDirective`). The transcript is the only evidence. `attempt.answers` is **empty** in this path.
2. **Deterministic engine (test/mock):** `runtime.ts` state machine asks questions in order, enforces follow-up counts, and records `attempt.answers`. Used only under the mock/text flag.

The report (`generateCompanyAiScreeningReport`) and the unused `scoring.ts` were built around the deterministic engine's structured answers, but in production they receive only a flat transcript. So in the live path:

- Configured questions are *requested* of Grok but never *verified* to have been asked.
- Per-question typed answers don't exist, so the report can't reliably map evidence to questions.
- The deterministic fallback scores transcript word-count, not rubric performance.

Almost every item below is a consequence of this gap. The strategic fix is to make the **live transcript carry question identity** (tag each AI turn with the `questionId` it's covering) so evaluation can be per-question and per-dimension regardless of engine. Decide this first — it shapes items in sections 1 and 2.

---

## 1. Setup configurations that are not wired / not enforced / untested

These are recruiter-facing config fields that currently look configurable but don't fully drive the interview or are unvalidated.

1. **Rubric weight validation is UI-only and bypassable.** `ai-interviews-workspace.tsx` blocks the *step* when `rubricTotal !== 100`, but `normalizeRubric` in `blueprint.ts` defaults missing weights to `0` and never re-validates server-side. A blueprint saved via API, an edited draft, or a 0-weight dimension produces `normalizeWeights` → all zeros → **overall score 0 regardless of how well the candidate did.** Fix: enforce the 100% sum (and ≥1 non-zero dimension) in `buildScreeningBlueprint`, and reject/normalize on save in the route, not just in the wizard.

2. **`maxFollowUps` is silently capped at 2 and only soft-enforced.** `blueprint.ts` clamps to `[0,2]` and `runtime.ts` re-clamps, but in the **live path Grok decides** how many follow-ups to ask — the cap is just a sentence in the directive. Recruiters who set "0 follow-ups" or expect "exactly 2" get no guarantee. Decide whether follow-up counts are a hard contract; if yes, enforce via turn accounting, not prompt text.

3. **`timeLimitMinutes` per question and `durationMinutes` total are collected but not enforced at runtime.** There is no per-question timer or phase budget in the live room. A candidate can spend 40 minutes on one question. Either enforce time budgets in the room or stop advertising them as limits in setup.

4. **`difficulty` is collected and dropped.** It's in the form and the question type but never reaches the directive or the report. Either feed it into the prompt/scoring or remove it from the UI so recruiters don't think it does something.

5. **`category` → phase mapping is lossy and fixed to the SDE template.** `phaseTypeForCategory` collapses anything unknown to `custom`, and the whole thing is hardcoded `template: "sde_screening"`. A recruiter screening for a non-SDE role (data, PM, support, sales) gets SDE phase titles ("CS fundamentals and SQL") regardless. Untested for any non-SDE round.

6. **"Coding" / "system design" categories imply capabilities that don't exist in the room.** A coding question is asked **verbally** — there is no IDE, no code execution, no diagram canvas in the screening room (the `code_result` evidence source in `scoring.ts` is never produced). Either wire the existing IDE into the screening room for coding phases or relabel these as "talk through your approach" so expectations match reality.

7. **`expectedPoints.rubricDimensionId` routing is not closed.** Setup lets each expected point carry competency tags / a dimension, `blueprint.ts` resolves a `rubricDimensionId`, but nothing downstream uses that routing to score the matching dimension. The data model is ahead of the evaluator.

8. **No save-time test of the compiled blueprint.** `buildScreeningBlueprint` runs at start AND at submit AND in the report; there's no test that the recruiter's saved config round-trips to a sane blueprint (e.g., questions with empty prompts get the placeholder "Ask the candidate a structured screening question," which would silently ship a junk question). Add a "preview compiled interview" step so the recruiter sees exactly what the AI will ask before publishing.

---

## 2. Report generation issues on recruiter-defined rubrics (must-fix)

The headline weakness: **the report is not actually tested against, or driven by, the recruiter's rubric in the live path.**

1. **`scoring.ts` is dead code.** `calculateScreeningScore` / `ScreeningEvidenceItem` (the proper coverage→weighted-score engine, the *right* abstraction) is imported nowhere. `report.ts` re-implements scoring inline and differently. Wire the real scoring engine in, or delete it — but right now the "good" evaluator is unused and the "rough" one ships.

2. **Deterministic fallback gives every rubric dimension the same score.** In `deterministicReport`, `dimensionScores.map(... score: finalScore ...)` assigns the identical transcript-word-quality number to *all* dimensions. So "Technical correctness" and "Communication" always tie. Any recruiter who reads the per-dimension breakdown in fallback mode is being shown noise. This fires whenever the Gemini key is missing **or** Gemini errors/rate-limits — i.e., in real outages, not just local dev.

3. **Overall score can ignore rubric weights.** In the Gemini path, `normalizeReport` computes a correct weight-normalized `weightedScore`, but then `overallScore` prefers the **model's** `raw.overallScore` and only falls back to the computed one. The LLM can return an overall number inconsistent with the dimension weights the recruiter set. Make the weighted dimension score authoritative; treat the model's overall as advisory only.

4. **Live path has no per-question typed answers, so `questionSignals` are LLM guesses over an untagged transcript.** Evidence is mapped to questions only by the model eyeballing the transcript. With no `questionId` tags on AI turns (see section 0), a misattributed or skipped question is invisible. This is the difference between "we asked your 6 questions and here's how they did on each" and "here's a vibe from the transcript."

5. **No completeness/coverage signal.** The report never states *which configured questions were actually asked and answered*. If Grok drifts and skips Q4, the recruiter can't tell. Add an explicit coverage map (asked / answered / skipped per question) computed from the transcript, independent of the LLM's narrative.

6. **Integrity penalty is a flat heuristic.** `integrityPenalty = (100 - integrityScore) * 0.25` in fallback, and in the Gemini path integrity is narrative-only and doesn't affect the score at all. Decide a single, documented integrity→score policy and apply it consistently across both paths.

7. **Recommendation thresholds are magic numbers with no calibration.** `>=75 advance, >=55 review, >=35 hold, else reject` are invented. Before recruiters lean on "advance," these need at least a documented rationale and ideally calibration against a labeled set. Until then, lead the UI with evidence and let recommendation be clearly advisory.

8. **No regeneration determinism / versioning surfaced.** Regenerate can produce a different score for the same transcript (LLM), and the report stores `generatedAt`/`model` but the recruiter UI doesn't show "this report is v2, regenerated, score changed from X." For a hiring artifact this matters for auditability.

---

## 3. Robustness features to add (reliability + defensibility)

1. **Interviewer-brain fallback.** Grok is a single point of failure for the *entire* live interview, not just TTS. Add a provider abstraction with a second LLM so a Grok outage mid-screening degrades gracefully instead of stranding a candidate.

2. **TTS provider abstraction with real fallback.** Replace the text-only-TTS escape hatch with an interface (xAI primary + one fallback voice). The current "drop to text" behavior is a cheating surface in production and a bad candidate experience.

3. **Session resume / recovery.** A practice user tolerates a dropped session; a job candidate will not. Persist enough state to resume after a refresh/disconnect within a grace window, and make the room reconnect cleanly. (The submit flow already 409s on missing/incomplete sessions — pair that with actual recovery.)

4. **Idempotent start and submit.** Double-clicks / retries should not create duplicate sessions or duplicate reports. Key start/submit on `roundCandidateId` + attempt state.

5. **Live blueprint-adherence guardrail.** Since live mode can't hard-enforce the agenda, add a post-hoc (or mid-flight) check that compares transcript questions against the blueprint and flags drift (missed questions, extra invented questions) to both the report and your own monitoring.

6. **Proctoring evidence retention + audit trail.** These are hiring decisions. Define retention, candidate data-access/deletion handling, and an immutable audit log of report versions and recruiter overrides. This is also a sales requirement for any serious employer.

7. **Bias / fairness guardrails.** Document and test that the model isn't keying on name, accent, or non-job-relevant signals; give recruiters a "scored on rubric only" statement they can stand behind. This is both ethics and legal defensibility (EEOC-style scrutiny of automated hiring tools).

8. **Automated test suite for the two engines.** Start, submit, report generate/regenerate, fallback path, mock path, and a "live transcript → report" fixture. This is also the guard that keeps the company flow from regressing the practice flow (they share `voice-pipeline.ts`, `interview-orchestrator.ts`, `websocket.ts`).

---

## 4. Recruiter-facing options that make this beat an ATS/resume screen

This is the product wedge. An ATS keyword-matches a PDF; this round actually *talks to the candidate*. Lean into that.

1. **Question bank + role templates.** Ship curated, editable templates per role family (frontend, backend, data, PM, support, sales) so a recruiter publishes a credible screen in 2 minutes instead of authoring questions cold. The current single hardcoded `sde_screening` template is the opposite of this.

2. **Resume-aware questions.** Auto-generate the resume/project probe from the candidate's actual resume/GitHub (the resume category prompt already hints at this). "Tell me about the caching layer in your X project" beats any keyword match and is the single most ATS-killing feature.

3. **JD-to-rubric autodraft.** Paste a job description → propose rubric dimensions, weights, and questions. Recruiter edits instead of authoring. Lowers activation energy dramatically.

4. **Knockout / must-have criteria.** Let recruiters mark dimensions or expected points as hard gates (e.g., "must have production K8s") that auto-flag, separate from the weighted score. This is the thing ATS does (filtering) but grounded in an actual conversation.

5. **Configurable strictness / interview persona.** A "strict vs. supportive" dial and tone control, so the screen matches the company's brand and seniority level.

6. **Calibration / preview mode for recruiters.** Let a recruiter run the screen on themselves or a sample answer and see the report before publishing — builds trust in the score and catches bad question config (ties into 1.8).

7. **Candidate experience as a selling point.** Configurable intro, accommodations (extra time), retake policy, and a branded room. Candidates hate black-box ATS rejection; a fair conversational screen with a clear structure is a recruiting-brand asset.

8. **Comparison / shortlist view.** Recruiters screen *cohorts*. A ranked, rubric-aligned, side-by-side view across candidates in a round (with the coverage + integrity columns) is what replaces the ATS list and is where they'll spend their time.

9. **Explainable, exportable report.** "Why this score," per dimension, tied to transcript quotes, exportable/shareable with the hiring manager. ATS gives a match %; you give defensible evidence.

10. **ATS integration, not ATS replacement (go-to-market).** Push results back into Greenhouse/Lever/Workday so this becomes the *first round inside their existing pipeline* rather than a tool they have to switch to. Lowers adoption friction more than any feature.

---

## Suggested sequencing

1. **Decide section 0** (tag transcript turns with `questionId`) — it unblocks honest per-question scoring.
2. **Section 2 fixes #1–#5 + section 1 #1** — make the rubric actually drive a trustworthy score. Without this, nothing in section 4 is credible.
3. **Section 3 #1–#4 + #8** — reliability and tests so real candidates don't hit failures.
4. **Section 1 #3–#6** — make setup match runtime reality (or trim the UI).
5. **Section 4** — the differentiation features, starting with templates (#1), resume-aware questions (#2), and the shortlist view (#8), which are the strongest ATS displacers.
