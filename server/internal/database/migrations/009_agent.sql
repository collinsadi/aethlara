-- Autopilot: the agent searches for jobs, the user approves the ones to
-- apply to, and the next run applies (email) or queues them for the browser
-- extension. Replies land in the agent's mailbox and update the tracker.

-- agent_profiles: one row per user with search preferences, the answers the
-- agent uses on application forms, apply rules and the run schedule.
CREATE TABLE agent_profiles (
  user_id              UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  enabled              BOOLEAN NOT NULL DEFAULT false,
  resume_id            UUID REFERENCES resumes(id) ON DELETE SET NULL,
  mailbox_address      TEXT UNIQUE,
  search_prefs         JSONB NOT NULL DEFAULT '{}'::jsonb,
  application_profile  JSONB NOT NULL DEFAULT '{}'::jsonb,
  apply_settings       JSONB NOT NULL DEFAULT '{}'::jsonb,
  run_interval_hours   INTEGER NOT NULL DEFAULT 24 CHECK (run_interval_hours BETWEEN 1 AND 168),
  next_run_at          TIMESTAMPTZ,
  last_run_at          TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_agent_profiles_due ON agent_profiles(next_run_at) WHERE enabled;

-- agent_runs: one execution of the agent loop (inbox, apply, discover).
CREATE TABLE agent_runs (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  trigger      TEXT NOT NULL CHECK (trigger IN ('schedule', 'manual')),
  status       TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'completed', 'failed')),
  stats        JSONB NOT NULL DEFAULT '{}'::jsonb,
  error        TEXT,
  started_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at  TIMESTAMPTZ
);

CREATE INDEX idx_agent_runs_user ON agent_runs(user_id, started_at DESC);
-- At most one running run per user.
CREATE UNIQUE INDEX idx_agent_runs_one_running ON agent_runs(user_id) WHERE status = 'running';

-- job_leads: postings the agent discovered, scored against the resume.
CREATE TABLE job_leads (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  run_id           UUID REFERENCES agent_runs(id) ON DELETE SET NULL,
  source           TEXT NOT NULL,
  source_label     TEXT NOT NULL DEFAULT '',
  external_id      TEXT,
  dedupe_key       TEXT NOT NULL,
  title            TEXT NOT NULL,
  company          TEXT NOT NULL DEFAULT '',
  location         TEXT,
  is_remote        BOOLEAN NOT NULL DEFAULT false,
  employment_type  TEXT,
  salary_min       INTEGER,
  salary_max       INTEGER,
  salary_currency  TEXT,
  salary_text      TEXT,
  url              TEXT NOT NULL,
  apply_url        TEXT,
  apply_email      TEXT,
  ats              TEXT,
  description      TEXT NOT NULL DEFAULT '',
  posted_at        TIMESTAMPTZ,
  match_score      SMALLINT CHECK (match_score BETWEEN 0 AND 100),
  match_fit        TEXT,
  match_summary    TEXT,
  match_pros       JSONB,
  match_gaps       JSONB,
  dealbreaker      TEXT,
  scored_at        TIMESTAMPTZ,
  status           TEXT NOT NULL DEFAULT 'new'
                     CHECK (status IN ('new', 'approved', 'dismissed', 'applying', 'applied', 'failed', 'expired')),
  dismiss_reason   TEXT,
  decided_at       TIMESTAMPTZ,
  job_id           UUID REFERENCES jobs(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_job_leads_dedupe ON job_leads(user_id, dedupe_key);
CREATE INDEX idx_job_leads_review ON job_leads(user_id, status, match_score DESC NULLS LAST, created_at DESC);
CREATE INDEX idx_job_leads_unscored ON job_leads(user_id) WHERE scored_at IS NULL AND status = 'new';

-- applications: one per approved lead. channel 'email' is sent by the
-- server; channel 'browser' is claimed and submitted by the extension.
CREATE TABLE applications (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  lead_id           UUID NOT NULL REFERENCES job_leads(id) ON DELETE CASCADE,
  job_id            UUID REFERENCES jobs(id) ON DELETE SET NULL,
  channel           TEXT NOT NULL DEFAULT 'browser' CHECK (channel IN ('browser', 'email')),
  status            TEXT NOT NULL DEFAULT 'queued'
                      CHECK (status IN ('queued', 'preparing', 'ready', 'in_progress', 'needs_input',
                                        'submitted', 'failed', 'cancelled')),
  apply_url         TEXT,
  apply_email       TEXT,
  ats               TEXT,
  cover_letter      TEXT,
  use_original_resume BOOLEAN NOT NULL DEFAULT false,
  attempts          INTEGER NOT NULL DEFAULT 0,
  last_error        TEXT,
  needs             JSONB,
  result            JSONB,
  claimed_at        TIMESTAMPTZ,
  claim_expires_at  TIMESTAMPTZ,
  submitted_at      TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_applications_lead ON applications(lead_id);
CREATE INDEX idx_applications_queue ON applications(user_id, status, updated_at);

-- agent_events: activity feed shown on the autopilot dashboard.
CREATE TABLE agent_events (
  id              BIGSERIAL PRIMARY KEY,
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  run_id          UUID REFERENCES agent_runs(id) ON DELETE SET NULL,
  kind            TEXT NOT NULL,
  level           TEXT NOT NULL DEFAULT 'info' CHECK (level IN ('info', 'success', 'warning', 'error')),
  message         TEXT NOT NULL,
  lead_id         UUID REFERENCES job_leads(id) ON DELETE SET NULL,
  application_id  UUID REFERENCES applications(id) ON DELETE SET NULL,
  data            JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_agent_events_user ON agent_events(user_id, id DESC);

-- agent_messages: the agent mailbox (Resend inbound + email applications).
-- Only plain text is stored; untrusted HTML is never rendered.
CREATE TABLE agent_messages (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  direction        TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  provider_id      TEXT,
  message_id       TEXT,
  from_address     TEXT NOT NULL,
  from_name        TEXT,
  to_addresses     JSONB NOT NULL DEFAULT '[]'::jsonb,
  subject          TEXT NOT NULL DEFAULT '',
  text_body        TEXT NOT NULL DEFAULT '',
  links            JSONB,
  attachments      JSONB,
  category         TEXT,
  summary          TEXT,
  extracted        JSONB,
  important        BOOLEAN NOT NULL DEFAULT false,
  application_id   UUID REFERENCES applications(id) ON DELETE SET NULL,
  job_id           UUID REFERENCES jobs(id) ON DELETE SET NULL,
  triage_status    TEXT NOT NULL DEFAULT 'pending'
                     CHECK (triage_status IN ('pending', 'done', 'failed', 'skipped')),
  triage_attempts  INTEGER NOT NULL DEFAULT 0,
  read_at          TIMESTAMPTZ,
  received_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_agent_messages_provider ON agent_messages(user_id, provider_id) WHERE provider_id IS NOT NULL;
CREATE INDEX idx_agent_messages_user ON agent_messages(user_id, received_at DESC);
CREATE INDEX idx_agent_messages_pending ON agent_messages(received_at) WHERE triage_status = 'pending';

-- agent_answers: answers to application questions the agent could not
-- infer, collected from the user once and reused on every later form.
CREATE TABLE agent_answers (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  question_key  TEXT NOT NULL,
  question      TEXT NOT NULL,
  answer        TEXT NOT NULL,
  source        TEXT NOT NULL DEFAULT 'user' CHECK (source IN ('user', 'agent')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_agent_answers_key ON agent_answers(user_id, question_key);

-- Jobs tailored by the agent for approved leads.
ALTER TABLE jobs DROP CONSTRAINT jobs_input_method_check;
ALTER TABLE jobs ADD CONSTRAINT jobs_input_method_check
  CHECK (input_method IN ('url', 'text', 'extension', 'agent'));
