-- Cold emails: when the agent cannot read a posting, it emails an address
-- the company publishes instead (applications.channel 'cold_email').
ALTER TABLE applications DROP CONSTRAINT IF EXISTS applications_channel_check;
ALTER TABLE applications ADD CONSTRAINT applications_channel_check
  CHECK (channel IN ('browser', 'email', 'cold_email'));
