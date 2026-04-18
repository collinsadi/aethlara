-- extension_tokens: single-use handshake tokens for Chrome extension auth
CREATE TABLE extension_tokens (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL UNIQUE,
  used        BOOLEAN NOT NULL DEFAULT false,
  expires_at  TIMESTAMPTZ NOT NULL,
  origin      TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_extension_tokens_hash    ON extension_tokens(token_hash);
CREATE INDEX idx_extension_tokens_expires ON extension_tokens(expires_at);
