-- api_keys: stores encrypted per-user OpenRouter API keys.
-- Hard delete only — no soft delete, no deleted_at.
CREATE TABLE api_keys (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  encrypted_key       TEXT NOT NULL,
  key_prefix          TEXT NOT NULL,
  provider            TEXT NOT NULL DEFAULT 'openrouter',
  label               TEXT,
  last_used_at        TIMESTAMPTZ,
  last_validated_at   TIMESTAMPTZ,
  validation_status   TEXT NOT NULL DEFAULT 'unvalidated'
                        CHECK (validation_status IN ('unvalidated', 'valid', 'invalid', 'revoked')),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One key per user per provider — enforced at DB level.
CREATE UNIQUE INDEX idx_api_keys_user_provider ON api_keys(user_id, provider);
CREATE INDEX idx_api_keys_user_id ON api_keys(user_id);

-- email_change_requests: tracks pending email-change OTP flows.
CREATE TABLE email_change_requests (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  new_email   TEXT NOT NULL,
  otp_hash    TEXT NOT NULL,
  attempts    INTEGER NOT NULL DEFAULT 0,
  used        BOOLEAN NOT NULL DEFAULT false,
  expires_at  TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_email_change_user_id  ON email_change_requests(user_id);
CREATE INDEX idx_email_change_expires  ON email_change_requests(expires_at);
