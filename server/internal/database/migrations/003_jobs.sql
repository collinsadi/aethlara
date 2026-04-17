-- jobs
CREATE TABLE jobs (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  resume_id             UUID NOT NULL REFERENCES resumes(id),

  job_title             TEXT NOT NULL DEFAULT '',
  company               TEXT NOT NULL DEFAULT '',
  location              TEXT,
  is_remote             BOOLEAN NOT NULL DEFAULT false,
  job_url               TEXT,
  employment_type       TEXT CHECK (employment_type IN (
                          'full_time', 'part_time', 'contract',
                          'freelance', 'internship', 'temporary'
                        )),
  experience_level      TEXT CHECK (experience_level IN (
                          'entry', 'mid', 'senior', 'lead', 'executive'
                        )),
  salary_min            INTEGER,
  salary_max            INTEGER,
  salary_currency       TEXT DEFAULT 'USD',

  input_method          TEXT NOT NULL CHECK (input_method IN ('url', 'text')),
  raw_input_ref         TEXT,

  extracted_job_json    JSONB,
  extraction_status     TEXT NOT NULL DEFAULT 'pending'
                          CHECK (extraction_status IN (
                            'pending', 'processing', 'completed', 'failed'
                          )),
  extraction_error      TEXT,

  tailored_resume_json  JSONB,
  match_score           SMALLINT CHECK (match_score BETWEEN 1 AND 100),
  alignment_status      TEXT NOT NULL DEFAULT 'pending'
                          CHECK (alignment_status IN (
                            'pending', 'processing', 'completed', 'failed', 'misaligned'
                          )),
  alignment_error       TEXT,

  pdf_r2_key            TEXT,
  pdf_generated_at      TIMESTAMPTZ,

  status                TEXT NOT NULL DEFAULT 'not_applied'
                          CHECK (status IN (
                            'not_applied', 'applied', 'interview', 'offer', 'rejected', 'withdrawn'
                          )),
  applied_at            TIMESTAMPTZ,
  notes                 TEXT,

  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at            TIMESTAMPTZ DEFAULT NULL
);

CREATE INDEX idx_jobs_user_id     ON jobs(user_id);
CREATE INDEX idx_jobs_user_active ON jobs(user_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_jobs_status      ON jobs(user_id, status) WHERE deleted_at IS NULL;
CREATE INDEX idx_jobs_match_score ON jobs(user_id, match_score DESC) WHERE deleted_at IS NULL;
CREATE INDEX idx_jobs_created_at  ON jobs(user_id, created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX idx_jobs_resume_id   ON jobs(resume_id);

-- analytics_snapshots (pre-aggregated for performance)
CREATE TABLE analytics_snapshots (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  period_start    TIMESTAMPTZ NOT NULL,
  period_end      TIMESTAMPTZ NOT NULL,
  total_jobs      INTEGER NOT NULL DEFAULT 0,
  applied_jobs    INTEGER NOT NULL DEFAULT 0,
  avg_match_rate  NUMERIC(5,2),
  total_resumes   INTEGER NOT NULL DEFAULT 0,
  computed_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, period_start, period_end)
);
