-- Normalized hiring pipeline rounds.
-- Rounds are rows, not dynamic columns: every job can have any number of
-- application, assignment, OA, interview, or final rounds in any order.

CREATE TABLE IF NOT EXISTS public.job_rounds (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  job_id TEXT NOT NULL,
  company_id TEXT NOT NULL,
  round_number INTEGER NOT NULL,
  round_type TEXT NOT NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  opens_at TIMESTAMPTZ,
  closes_at TIMESTAMPTZ,
  resource_id TEXT,
  config JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS job_rounds_job_id_round_number_key
  ON public.job_rounds(job_id, round_number);
CREATE INDEX IF NOT EXISTS job_rounds_company_status_created_idx
  ON public.job_rounds(company_id, status, created_at);
CREATE INDEX IF NOT EXISTS job_rounds_job_type_status_idx
  ON public.job_rounds(job_id, round_type, status);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'job_rounds_job_id_fkey'
  ) THEN
    ALTER TABLE public.job_rounds
      ADD CONSTRAINT job_rounds_job_id_fkey
      FOREIGN KEY (job_id) REFERENCES public.company_job_openings(id) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'job_rounds_company_id_fkey'
  ) THEN
    ALTER TABLE public.job_rounds
      ADD CONSTRAINT job_rounds_company_id_fkey
      FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.job_round_candidates (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  round_id TEXT NOT NULL,
  application_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'invited',
  advanced BOOLEAN NOT NULL DEFAULT FALSE,
  score INTEGER NOT NULL DEFAULT 0,
  metadata JSONB,
  submitted_at TIMESTAMPTZ,
  evaluated_at TIMESTAMPTZ,
  advanced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS job_round_candidates_round_application_key
  ON public.job_round_candidates(round_id, application_id);
CREATE INDEX IF NOT EXISTS job_round_candidates_round_status_score_idx
  ON public.job_round_candidates(round_id, status, score);
CREATE INDEX IF NOT EXISTS job_round_candidates_application_created_idx
  ON public.job_round_candidates(application_id, created_at);
CREATE INDEX IF NOT EXISTS job_round_candidates_user_created_idx
  ON public.job_round_candidates(user_id, created_at);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'job_round_candidates_round_id_fkey'
  ) THEN
    ALTER TABLE public.job_round_candidates
      ADD CONSTRAINT job_round_candidates_round_id_fkey
      FOREIGN KEY (round_id) REFERENCES public.job_rounds(id) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'job_round_candidates_application_id_fkey'
  ) THEN
    ALTER TABLE public.job_round_candidates
      ADD CONSTRAINT job_round_candidates_application_id_fkey
      FOREIGN KEY (application_id) REFERENCES public.job_applications(id) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'job_round_candidates_user_id_fkey'
  ) THEN
    ALTER TABLE public.job_round_candidates
      ADD CONSTRAINT job_round_candidates_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.job_round_evaluation_reports (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  round_candidate_id TEXT NOT NULL UNIQUE,
  job_round_id TEXT NOT NULL,
  application_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  round_type TEXT NOT NULL,
  overall_score INTEGER NOT NULL DEFAULT 0,
  repo_head_sha TEXT,
  evidence_snapshot JSONB,
  rubric_breakdown JSONB,
  ai_summary TEXT,
  report JSONB,
  evaluated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS job_round_evaluation_reports_round_score_idx
  ON public.job_round_evaluation_reports(job_round_id, overall_score);
CREATE INDEX IF NOT EXISTS job_round_evaluation_reports_application_evaluated_idx
  ON public.job_round_evaluation_reports(application_id, evaluated_at);
CREATE INDEX IF NOT EXISTS job_round_evaluation_reports_user_evaluated_idx
  ON public.job_round_evaluation_reports(user_id, evaluated_at);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'job_round_evaluation_reports_round_candidate_id_fkey'
  ) THEN
    ALTER TABLE public.job_round_evaluation_reports
      ADD CONSTRAINT job_round_evaluation_reports_round_candidate_id_fkey
      FOREIGN KEY (round_candidate_id) REFERENCES public.job_round_candidates(id) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'job_round_evaluation_reports_job_round_id_fkey'
  ) THEN
    ALTER TABLE public.job_round_evaluation_reports
      ADD CONSTRAINT job_round_evaluation_reports_job_round_id_fkey
      FOREIGN KEY (job_round_id) REFERENCES public.job_rounds(id) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'job_round_evaluation_reports_application_id_fkey'
  ) THEN
    ALTER TABLE public.job_round_evaluation_reports
      ADD CONSTRAINT job_round_evaluation_reports_application_id_fkey
      FOREIGN KEY (application_id) REFERENCES public.job_applications(id) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'job_round_evaluation_reports_user_id_fkey'
  ) THEN
    ALTER TABLE public.job_round_evaluation_reports
      ADD CONSTRAINT job_round_evaluation_reports_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;
  END IF;
END $$;

ALTER TABLE public.technical_assignments
  ADD COLUMN IF NOT EXISTS round_id TEXT;

ALTER TABLE public.technical_assignments
  DROP CONSTRAINT IF EXISTS technical_assignments_job_id_key;
DROP INDEX IF EXISTS technical_assignments_job_id_key;

CREATE INDEX IF NOT EXISTS technical_assignments_job_id_closes_at_idx
  ON public.technical_assignments(job_id, closes_at);

DROP INDEX IF EXISTS technical_assignments_round_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS technical_assignments_round_id_key
  ON public.technical_assignments(round_id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'technical_assignments_round_id_fkey'
  ) THEN
    ALTER TABLE public.technical_assignments
      ADD CONSTRAINT technical_assignments_round_id_fkey
      FOREIGN KEY (round_id) REFERENCES public.job_rounds(id) ON DELETE SET NULL;
  END IF;
END $$;

ALTER TABLE public.technical_assignment_submissions
  ADD COLUMN IF NOT EXISTS round_candidate_id TEXT,
  ADD COLUMN IF NOT EXISTS next_round_type TEXT,
  ADD COLUMN IF NOT EXISTS next_round_moved_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS technical_assignment_submissions_round_candidate_idx
  ON public.technical_assignment_submissions(round_candidate_id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'technical_assignment_submissions_round_candidate_id_fkey'
  ) THEN
    ALTER TABLE public.technical_assignment_submissions
      ADD CONSTRAINT technical_assignment_submissions_round_candidate_id_fkey
      FOREIGN KEY (round_candidate_id) REFERENCES public.job_round_candidates(id) ON DELETE SET NULL;
  END IF;
END $$;

-- Backfill existing applications as the first normalized application-review round.
WITH jobs_needing_application_round AS (
  SELECT
    j.id AS job_id,
    j.company_id,
    j.title,
    j.published_at,
    j.created_at,
    j.application_deadline,
    COALESCE((
      SELECT CASE
        WHEN MIN(r.round_number) IS NULL THEN 1
        WHEN MIN(r.round_number) > 1 THEN MIN(r.round_number) - 1
        ELSE MAX(r.round_number) + 1
      END
      FROM public.job_rounds r
      WHERE r.job_id = j.id
    ), 1) AS round_number
  FROM public.company_job_openings j
  WHERE EXISTS (
    SELECT 1 FROM public.job_applications a WHERE a.job_id = j.id
  )
  AND NOT EXISTS (
    SELECT 1 FROM public.job_rounds r
    WHERE r.job_id = j.id AND r.round_type = 'application_review'
  )
)
INSERT INTO public.job_rounds (
  id, job_id, company_id, round_number, round_type, title, status,
  opens_at, closes_at, config, created_at, updated_at
)
SELECT
  gen_random_uuid()::text,
  job_id,
  company_id,
  round_number,
  'application_review',
  title || ' - application review',
  CASE WHEN application_deadline IS NOT NULL AND application_deadline < NOW() THEN 'closed' ELSE 'open' END,
  COALESCE(published_at, created_at, NOW()),
  application_deadline,
  jsonb_build_object('source', 'migration_backfill'),
  NOW(),
  NOW()
FROM jobs_needing_application_round
ON CONFLICT (job_id, round_number) DO NOTHING;

WITH application_scores AS (
  SELECT
    a.id,
    a.job_id,
    a.user_id,
    a.submitted_at,
    a.updated_at,
    CASE
      WHEN a.recruiter_report->>'overallScore' ~ '^-?[0-9]+(\.[0-9]+)?$' THEN (a.recruiter_report->>'overallScore')::numeric
      WHEN a.github_analysis->>'overallScore' ~ '^-?[0-9]+(\.[0-9]+)?$' THEN (a.github_analysis->>'overallScore')::numeric
      WHEN a.github_analysis->>'score' ~ '^-?[0-9]+(\.[0-9]+)?$' THEN (a.github_analysis->>'score')::numeric
      ELSE 0
    END AS overall_score,
    a.github_analysis,
    a.coding_analysis,
    a.evidence_pack,
    a.recruiter_analysis,
    a.recruiter_report,
    a.next_round_moved_at
  FROM public.job_applications a
)
INSERT INTO public.job_round_candidates (
  id, round_id, application_id, user_id, status, advanced, score,
  metadata, submitted_at, evaluated_at, advanced_at, created_at, updated_at
)
SELECT
  gen_random_uuid()::text,
  r.id,
  a.id,
  a.user_id,
  CASE WHEN a.next_round_moved_at IS NOT NULL THEN 'shortlisted' ELSE 'evaluated' END,
  a.next_round_moved_at IS NOT NULL,
  LEAST(100, GREATEST(0, ROUND(a.overall_score)))::integer,
  jsonb_build_object(
    'source', 'application_review_backfill',
    'githubAnalysis', a.github_analysis,
    'codingAnalysis', a.coding_analysis
  ),
  a.submitted_at,
  COALESCE(a.updated_at, a.submitted_at),
  a.next_round_moved_at,
  NOW(),
  NOW()
FROM application_scores a
JOIN public.job_rounds r
  ON r.job_id = a.job_id AND r.round_type = 'application_review'
ON CONFLICT (round_id, application_id) DO UPDATE SET
  status = EXCLUDED.status,
  advanced = public.job_round_candidates.advanced OR EXCLUDED.advanced,
  score = EXCLUDED.score,
  submitted_at = COALESCE(public.job_round_candidates.submitted_at, EXCLUDED.submitted_at),
  evaluated_at = COALESCE(public.job_round_candidates.evaluated_at, EXCLUDED.evaluated_at),
  advanced_at = COALESCE(public.job_round_candidates.advanced_at, EXCLUDED.advanced_at),
  updated_at = NOW();

INSERT INTO public.job_round_evaluation_reports (
  id, round_candidate_id, job_round_id, application_id, user_id, round_type,
  overall_score, evidence_snapshot, rubric_breakdown, ai_summary, report,
  evaluated_at, created_at, updated_at
)
SELECT
  gen_random_uuid()::text,
  c.id,
  c.round_id,
  a.id,
  a.user_id,
  'application_review',
  c.score,
  a.evidence_pack,
  jsonb_build_object(
    'githubAnalysis', a.github_analysis,
    'codingAnalysis', a.coding_analysis
  ),
  a.recruiter_analysis->>'profileSummary',
  COALESCE(a.recruiter_report, a.recruiter_analysis),
  COALESCE(a.updated_at, a.submitted_at, NOW()),
  NOW(),
  NOW()
FROM public.job_round_candidates c
JOIN public.job_rounds r
  ON r.id = c.round_id AND r.round_type = 'application_review'
JOIN public.job_applications a
  ON a.id = c.application_id
ON CONFLICT (round_candidate_id) DO UPDATE SET
  overall_score = EXCLUDED.overall_score,
  evidence_snapshot = EXCLUDED.evidence_snapshot,
  rubric_breakdown = EXCLUDED.rubric_breakdown,
  ai_summary = EXCLUDED.ai_summary,
  report = EXCLUDED.report,
  evaluated_at = EXCLUDED.evaluated_at,
  updated_at = NOW();

-- Backfill legacy technical assignments into normalized technical rounds.
WITH pending_assignments AS (
  SELECT
    ta.id AS assignment_id,
    gen_random_uuid()::text AS round_id,
    ta.job_id,
    ta.company_id,
    ta.title,
    ta.status,
    ta.closes_at,
    ta.created_at,
    ROW_NUMBER() OVER (PARTITION BY ta.job_id ORDER BY ta.created_at, ta.id)
      + COALESCE((
        SELECT MAX(r.round_number)
        FROM public.job_rounds r
        WHERE r.job_id = ta.job_id
      ), 0) AS round_number
  FROM public.technical_assignments ta
  WHERE ta.round_id IS NULL
),
inserted_assignment_rounds AS (
  INSERT INTO public.job_rounds (
    id, job_id, company_id, round_number, round_type, title, status,
    opens_at, closes_at, resource_id, config, created_at, updated_at
  )
  SELECT
    round_id,
    job_id,
    company_id,
    round_number,
    'technical_assignment',
    title,
    CASE WHEN status = 'closed' OR closes_at <= NOW() THEN 'closed' ELSE 'open' END,
    created_at,
    closes_at,
    assignment_id,
    jsonb_build_object('source', 'legacy_technical_assignment'),
    created_at,
    NOW()
  FROM pending_assignments
  ON CONFLICT (job_id, round_number) DO NOTHING
  RETURNING id
)
UPDATE public.technical_assignments ta
SET round_id = p.round_id
FROM pending_assignments p
WHERE ta.id = p.assignment_id
  AND EXISTS (SELECT 1 FROM inserted_assignment_rounds i WHERE i.id = p.round_id);

-- Backfill legacy non-assignment next rounds.
WITH legacy_next_rounds AS (
  SELECT
    j.id AS job_id,
    j.company_id,
    j.title,
    a.next_round_type AS round_type,
    MIN(a.next_round_moved_at) AS opens_at,
    ROW_NUMBER() OVER (PARTITION BY j.id ORDER BY MIN(a.next_round_moved_at), a.next_round_type)
      + COALESCE((
        SELECT MAX(r.round_number)
        FROM public.job_rounds r
        WHERE r.job_id = j.id
      ), 0) AS round_number
  FROM public.job_applications a
  JOIN public.company_job_openings j ON j.id = a.job_id
  WHERE a.next_round_type IS NOT NULL
    AND a.next_round_type <> 'technical_assignment'
  GROUP BY j.id, j.company_id, j.title, a.next_round_type
)
INSERT INTO public.job_rounds (
  id, job_id, company_id, round_number, round_type, title, status,
  opens_at, config, created_at, updated_at
)
SELECT
  gen_random_uuid()::text,
  job_id,
  company_id,
  round_number,
  round_type,
  title || ' - ' || replace(round_type, '_', ' '),
  'open',
  COALESCE(opens_at, NOW()),
  jsonb_build_object('source', 'legacy_next_round'),
  NOW(),
  NOW()
FROM legacy_next_rounds
WHERE NOT EXISTS (
  SELECT 1 FROM public.job_rounds r
  WHERE r.job_id = legacy_next_rounds.job_id
    AND r.round_type = legacy_next_rounds.round_type
    AND r.config->>'source' = 'legacy_next_round'
)
ON CONFLICT (job_id, round_number) DO NOTHING;

INSERT INTO public.job_round_candidates (
  id, round_id, application_id, user_id, status, advanced, score,
  metadata, advanced_at, created_at, updated_at
)
SELECT
  gen_random_uuid()::text,
  r.id,
  a.id,
  a.user_id,
  'invited',
  FALSE,
  0,
  jsonb_build_object('source', 'legacy_next_round_backfill'),
  NULL,
  NOW(),
  NOW()
FROM public.job_applications a
JOIN public.job_rounds r
  ON r.job_id = a.job_id
  AND r.round_type = a.next_round_type
  AND r.config->>'source' = 'legacy_next_round'
WHERE a.next_round_type IS NOT NULL
  AND a.next_round_type <> 'technical_assignment'
ON CONFLICT (round_id, application_id) DO NOTHING;

-- Backfill candidate membership for technical assignment rounds.
INSERT INTO public.job_round_candidates (
  id, round_id, application_id, user_id, status, advanced, score,
  metadata, submitted_at, evaluated_at, created_at, updated_at
)
SELECT
  gen_random_uuid()::text,
  ta.round_id,
  s.application_id,
  s.user_id,
  CASE
    WHEN s.next_round_moved_at IS NOT NULL THEN 'shortlisted'
    WHEN s.status = 'evaluated' THEN 'evaluated'
    ELSE 'submitted'
  END,
  s.next_round_moved_at IS NOT NULL,
  LEAST(100, GREATEST(0, s.score))::integer,
  jsonb_build_object('source', 'technical_submission_backfill', 'assignmentId', ta.id),
  s.submitted_at,
  CASE WHEN s.status = 'evaluated' THEN s.submitted_at ELSE NULL END,
  NOW(),
  NOW()
FROM public.technical_assignment_submissions s
JOIN public.technical_assignments ta ON ta.id = s.assignment_id
WHERE ta.round_id IS NOT NULL
  AND s.application_id IS NOT NULL
ON CONFLICT (round_id, application_id) DO UPDATE SET
  status = EXCLUDED.status,
  advanced = public.job_round_candidates.advanced OR EXCLUDED.advanced,
  score = EXCLUDED.score,
  submitted_at = COALESCE(public.job_round_candidates.submitted_at, EXCLUDED.submitted_at),
  evaluated_at = COALESCE(public.job_round_candidates.evaluated_at, EXCLUDED.evaluated_at),
  updated_at = NOW();

WITH latest_technical_assignment AS (
  SELECT DISTINCT ON (ta.job_id)
    ta.job_id,
    ta.id AS assignment_id,
    ta.round_id
  FROM public.technical_assignments ta
  WHERE ta.round_id IS NOT NULL
  ORDER BY ta.job_id, ta.created_at DESC, ta.id DESC
)
INSERT INTO public.job_round_candidates (
  id, round_id, application_id, user_id, status, advanced, score,
  metadata, created_at, updated_at
)
SELECT
  gen_random_uuid()::text,
  ta.round_id,
  a.id,
  a.user_id,
  'invited',
  FALSE,
  0,
  jsonb_build_object('source', 'legacy_technical_invite_backfill', 'assignmentId', ta.assignment_id),
  NOW(),
  NOW()
FROM public.job_applications a
JOIN latest_technical_assignment ta ON ta.job_id = a.job_id
WHERE a.next_round_type = 'technical_assignment'
ON CONFLICT (round_id, application_id) DO NOTHING;

UPDATE public.technical_assignment_submissions s
SET round_candidate_id = c.id
FROM public.technical_assignments ta
JOIN public.job_round_candidates c
  ON c.round_id = ta.round_id
WHERE s.assignment_id = ta.id
  AND s.application_id = c.application_id
  AND s.round_candidate_id IS NULL;

INSERT INTO public.job_round_evaluation_reports (
  id, round_candidate_id, job_round_id, application_id, user_id, round_type,
  overall_score, repo_head_sha, evidence_snapshot, rubric_breakdown, ai_summary, report,
  evaluated_at, created_at, updated_at
)
SELECT
  gen_random_uuid()::text,
  c.id,
  c.round_id,
  c.application_id,
  s.user_id,
  'technical_assignment',
  LEAST(100, GREATEST(0, s.score))::integer,
  COALESCE(s.evidence#>>'{repoSignals,headSha}', s.evidence->>'headSha'),
  s.evidence,
  s.evidence->'scorecard',
  s.report->>'summary',
  s.report,
  s.submitted_at,
  NOW(),
  NOW()
FROM public.technical_assignment_submissions s
JOIN public.job_round_candidates c ON c.id = s.round_candidate_id
WHERE s.status = 'evaluated'
ON CONFLICT (round_candidate_id) DO UPDATE SET
  overall_score = EXCLUDED.overall_score,
  repo_head_sha = EXCLUDED.repo_head_sha,
  evidence_snapshot = EXCLUDED.evidence_snapshot,
  rubric_breakdown = EXCLUDED.rubric_breakdown,
  ai_summary = EXCLUDED.ai_summary,
  report = EXCLUDED.report,
  evaluated_at = EXCLUDED.evaluated_at,
  updated_at = NOW();

UPDATE public.job_round_candidates c
SET
  advanced = TRUE,
  advanced_at = COALESCE(c.advanced_at, s.next_round_moved_at),
  status = 'shortlisted',
  updated_at = NOW()
FROM public.technical_assignment_submissions s
WHERE s.round_candidate_id = c.id
  AND s.next_round_moved_at IS NOT NULL;

ALTER TABLE public.job_rounds ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.job_round_candidates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.job_round_evaluation_reports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS job_rounds_company_select ON public.job_rounds;
CREATE POLICY job_rounds_company_select
  ON public.job_rounds
  FOR SELECT
  USING (company_id = auth.uid()::text);

DROP POLICY IF EXISTS job_rounds_company_write ON public.job_rounds;
CREATE POLICY job_rounds_company_write
  ON public.job_rounds
  FOR ALL
  USING (company_id = auth.uid()::text)
  WITH CHECK (company_id = auth.uid()::text);

DROP POLICY IF EXISTS job_round_candidates_user_select ON public.job_round_candidates;
CREATE POLICY job_round_candidates_user_select
  ON public.job_round_candidates
  FOR SELECT
  USING (user_id = auth.uid()::text);

DROP POLICY IF EXISTS job_round_candidates_company_select ON public.job_round_candidates;
CREATE POLICY job_round_candidates_company_select
  ON public.job_round_candidates
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.job_rounds r
      WHERE r.id = round_id AND r.company_id = auth.uid()::text
    )
  );

DROP POLICY IF EXISTS job_round_candidates_company_write ON public.job_round_candidates;
CREATE POLICY job_round_candidates_company_write
  ON public.job_round_candidates
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.job_rounds r
      WHERE r.id = round_id AND r.company_id = auth.uid()::text
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.job_rounds r
      WHERE r.id = round_id AND r.company_id = auth.uid()::text
    )
  );

DROP POLICY IF EXISTS job_round_reports_user_select ON public.job_round_evaluation_reports;
CREATE POLICY job_round_reports_user_select
  ON public.job_round_evaluation_reports
  FOR SELECT
  USING (user_id = auth.uid()::text);

DROP POLICY IF EXISTS job_round_reports_company_select ON public.job_round_evaluation_reports;
CREATE POLICY job_round_reports_company_select
  ON public.job_round_evaluation_reports
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.job_rounds r
      WHERE r.id = job_round_id AND r.company_id = auth.uid()::text
    )
  );

DROP POLICY IF EXISTS job_round_reports_company_write ON public.job_round_evaluation_reports;
CREATE POLICY job_round_reports_company_write
  ON public.job_round_evaluation_reports
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.job_rounds r
      WHERE r.id = job_round_id AND r.company_id = auth.uid()::text
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.job_rounds r
      WHERE r.id = job_round_id AND r.company_id = auth.uid()::text
    )
  );
