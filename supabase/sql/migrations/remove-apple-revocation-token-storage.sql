-- Apply after apple-revocation-tokens.sql if that migration was previously run.
-- TripCash now exchanges a fresh native Apple authorization code during account
-- deletion, so long-term provider-token storage is no longer required.

begin;

drop function if exists public.get_apple_revocation_token();
drop function if exists public.store_apple_revocation_token(text, text, text);
drop table if exists public.apple_revocation_tokens;

commit;
