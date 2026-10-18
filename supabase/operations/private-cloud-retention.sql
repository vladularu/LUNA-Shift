-- Apply only to the identified personal-data environment, after migration and test approval.
-- Requires pg_cron. Preview and Production are configured independently.
select cron.schedule(
  'luna-private-cloud-retention',
  '17 2 * * *',
  $$select public.private_cloud_retention();$$
);
