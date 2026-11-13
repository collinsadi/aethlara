-- Email-only applying. Every application is an email that a background
-- worker sends at a scheduled time (spaced out, inside the user's sending
-- window) instead of during the run. Resend reports each email's delivery
-- (delivered, bounced, spam complaint ...) back through the webhook, and
-- addresses that bounce or complain are never emailed again.

-- agent_outbox: one row per email the agent will send. A cold email can
-- cover several applications to the same address (applications.outbox_id).
-- body is the message without the signature, which is added when sending.
CREATE TABLE agent_outbox (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind             TEXT NOT NULL CHECK (kind IN ('application', 'cold_email')),
  to_address       TEXT NOT NULL,
  subject          TEXT NOT NULL,
  body             TEXT NOT NULL,
  resume_job_id    UUID REFERENCES jobs(id) ON DELETE SET NULL,
  resume_id        UUID REFERENCES resumes(id) ON DELETE SET NULL,
  status           TEXT NOT NULL DEFAULT 'scheduled'
                     CHECK (status IN ('scheduled', 'sending', 'sent', 'failed', 'cancelled')),
  scheduled_at     TIMESTAMPTZ NOT NULL,
  locked_until     TIMESTAMPTZ,
  attempts         INTEGER NOT NULL DEFAULT 0,
  last_error       TEXT,
  provider_id      TEXT,
  sent_at          TIMESTAMPTZ,
  delivery_status  TEXT CHECK (delivery_status IN ('delayed', 'delivered', 'failed', 'suppressed', 'bounced', 'complained')),
  delivery_detail  TEXT,
  delivery_at      TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_agent_outbox_due ON agent_outbox(scheduled_at) WHERE status IN ('scheduled', 'sending');
CREATE INDEX idx_agent_outbox_user ON agent_outbox(user_id, scheduled_at DESC);
CREATE INDEX idx_agent_outbox_to ON agent_outbox(user_id, lower(to_address));
CREATE INDEX idx_agent_outbox_sent ON agent_outbox(sent_at) WHERE status = 'sent';
CREATE UNIQUE INDEX idx_agent_outbox_provider ON agent_outbox(provider_id) WHERE provider_id IS NOT NULL;

-- email_suppressions: addresses no agent may email again (hard bounces,
-- spam complaints, Resend suppressions). Platform-wide, because every agent
-- mailbox shares the sending domain's reputation. address is lower-case.
CREATE TABLE email_suppressions (
  address     TEXT PRIMARY KEY,
  reason      TEXT NOT NULL CHECK (reason IN ('bounce', 'complaint', 'suppressed')),
  detail      TEXT,
  user_id     UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- applications: the scheduled email, and where its address came from
-- (posting | hiring | general | person | user) and the page it was
-- published on. 'scheduled' = prepared, waiting for its send time.
ALTER TABLE applications ADD COLUMN outbox_id UUID REFERENCES agent_outbox(id) ON DELETE SET NULL;
ALTER TABLE applications ADD COLUMN recipient_kind TEXT;
ALTER TABLE applications ADD COLUMN recipient_source TEXT;
ALTER TABLE applications DROP CONSTRAINT IF EXISTS applications_status_check;
ALTER TABLE applications ADD CONSTRAINT applications_status_check
  CHECK (status IN ('queued', 'preparing', 'ready', 'in_progress', 'needs_input', 'scheduled',
                    'submitted', 'failed', 'cancelled'));
CREATE INDEX idx_applications_outbox ON applications(outbox_id) WHERE outbox_id IS NOT NULL;

-- Sending pause: set by the user, or by the circuit breaker after bounces
-- or a spam complaint. Scheduled emails wait while it is in the future.
ALTER TABLE agent_profiles ADD COLUMN sending_paused_until TIMESTAMPTZ;
ALTER TABLE agent_profiles ADD COLUMN sending_pause_reason TEXT;

-- Applications that were waiting for the Chrome extension go back to the
-- queue; the next run prepares them as emails (reusing the tailored resume).
UPDATE applications
SET status = 'queued', needs = NULL, claimed_at = NULL, claim_expires_at = NULL,
    attempts = 0, last_error = NULL, updated_at = NOW()
WHERE channel = 'browser' AND status IN ('ready', 'in_progress', 'needs_input');

UPDATE job_leads l SET status = 'approved', updated_at = NOW()
FROM applications a
WHERE a.lead_id = l.id AND a.status = 'queued' AND l.status = 'applying';
