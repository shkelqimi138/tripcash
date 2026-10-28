-- TripCash one-time welcome-email state and authenticated claim functions.
-- Apply once in Supabase SQL Editor before deploying functions/api/welcome.js.

begin;

alter table public.profiles
  add column if not exists welcome_email_claimed_at timestamptz,
  add column if not exists welcome_email_sent_at timestamptz;

create or replace function public.protect_profile_privileges()
returns trigger language plpgsql set search_path = '' as $$
begin
  if current_user = 'authenticated' then
    if tg_op = 'INSERT' then
      new.is_admin := false;
      new.welcome_email_claimed_at := null;
      new.welcome_email_sent_at := null;
    else
      new.id := old.id;
      new.is_admin := old.is_admin;
      new.created_at := old.created_at;
      new.welcome_email_claimed_at := old.welcome_email_claimed_at;
      new.welcome_email_sent_at := old.welcome_email_sent_at;
    end if;
  end if;
  return new;
end;
$$;

create or replace function public.claim_welcome_email()
returns boolean language plpgsql security definer set search_path = '' as $$
declare claimed boolean;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  update public.profiles set welcome_email_claimed_at = now()
  where id = auth.uid() and welcome_email_sent_at is null
    and (welcome_email_claimed_at is null or welcome_email_claimed_at < now() - interval '15 minutes')
  returning true into claimed;
  return coalesce(claimed, false);
end;
$$;

create or replace function public.complete_welcome_email()
returns void language sql security definer set search_path = '' as $$
  update public.profiles set welcome_email_sent_at = now(), welcome_email_claimed_at = null
  where id = auth.uid() and welcome_email_sent_at is null and welcome_email_claimed_at is not null;
$$;

revoke all on function public.claim_welcome_email() from public, anon;
revoke all on function public.complete_welcome_email() from public, anon;
grant execute on function public.claim_welcome_email() to authenticated;
grant execute on function public.complete_welcome_email() to authenticated;

commit;
