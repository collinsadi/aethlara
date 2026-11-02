-- ai_preferences: which provider a user's AI calls go through, plus optional
-- per-user model overrides. A missing row means provider = 'openrouter' with
-- the server's default models (pre-multi-provider behaviour).
CREATE TABLE ai_preferences (
  user_id      UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  provider     TEXT NOT NULL DEFAULT 'openrouter'
                 CHECK (provider IN ('openrouter', 'anthropic')),
  smart_model  TEXT,
  fast_model   TEXT,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- api_keys already allows one key per (user, provider); restrict provider to
-- the values the AI client knows how to call.
ALTER TABLE api_keys ADD CONSTRAINT api_keys_provider_check
  CHECK (provider IN ('openrouter', 'anthropic'));
