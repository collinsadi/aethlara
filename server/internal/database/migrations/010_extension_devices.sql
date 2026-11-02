-- extension_devices: long-lived, revocable credentials for the Chrome
-- extension so the autopilot can run without reconnecting every 15 minutes.
-- The device token rotates on every refresh; presenting the previous token
-- after rotation revokes the device (stolen-token detection).
CREATE TABLE extension_devices (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name                 TEXT NOT NULL DEFAULT 'Chrome extension',
  token_hash           TEXT NOT NULL UNIQUE,
  previous_token_hash  TEXT,
  user_agent           TEXT,
  last_used_at         TIMESTAMPTZ,
  revoked_at           TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_extension_devices_user ON extension_devices(user_id) WHERE revoked_at IS NULL;
CREATE INDEX idx_extension_devices_prev ON extension_devices(previous_token_hash) WHERE previous_token_hash IS NOT NULL;
