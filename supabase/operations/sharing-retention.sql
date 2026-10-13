-- Run ONLY in the new isolated calendar-sharing Preview project, as migration/database owner.
-- This operation is intentionally separate from the portable migration/PGlite suite.
-- The daily owner-role job also removes 90-day history for inactive calendars.
begin;
create extension if not exists pg_cron;
select cron.schedule('luna-sharing-retention', '23 3 * * *',
  $$select luna_sharing.prune_history(null);$$);
commit;
-- Verify deployment: inspect cron.job and cron.job_run_details for this job name.
-- No service role, client role, or public RPC receives EXECUTE on prune_history.
