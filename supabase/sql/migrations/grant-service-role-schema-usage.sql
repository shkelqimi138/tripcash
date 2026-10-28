-- Lets the server-side service role resolve public functions such as delete_user_by_id.
-- Applied manually in production on 2026-10-14; recorded here so rebuilds keep it.
begin;

grant usage on schema public to service_role;

commit;
