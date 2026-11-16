-- ONLY for ajccsftbgsvfmuwirjux. Run before deliberately re-enabling its Data API.
-- Restores the pre-fix role configuration; the harmless empty schema is retained.
begin;
alter role authenticator reset pgrst.db_schemas;
notify pgrst;
commit;
