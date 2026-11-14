-- Jobs with no address to email are dropped instead of waiting for the
-- user to supply one: the application is cancelled and the lead dismissed
-- (reason no_email). Drop the ones parked before this change.
UPDATE job_leads l
SET status = 'dismissed', dismiss_reason = 'no_email', updated_at = NOW()
FROM applications a
WHERE a.lead_id = l.id AND a.status = 'needs_input' AND a.needs->>'reason' = 'no_email';

UPDATE applications
SET status = 'cancelled', last_error = left(needs->>'message', 500), needs = NULL,
    claimed_at = NULL, claim_expires_at = NULL, updated_at = NOW()
WHERE status = 'needs_input' AND needs->>'reason' = 'no_email';

-- Prepare what is still queued now rather than at the next scheduled run.
UPDATE agent_profiles p
SET next_run_at = NOW()
WHERE p.enabled AND p.next_run_at > NOW()
  AND EXISTS (SELECT 1 FROM applications a WHERE a.user_id = p.user_id AND a.status = 'queued');
