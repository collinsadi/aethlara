-- sender_auth records whether an inbound email passed sender authentication
-- (Resend reports SPF/DKIM/DMARC). Mail that explicitly FAILS authentication
-- is still stored and triaged, but never moves the tracker or triggers
-- alerts: anyone can email the agent address and spoof a "you got an offer".
ALTER TABLE agent_messages ADD COLUMN sender_auth TEXT NOT NULL DEFAULT 'unknown'
  CHECK (sender_auth IN ('pass', 'fail', 'unknown'));
