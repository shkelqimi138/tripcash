-- Apply once in the production Supabase SQL Editor before enabling receipt scans.
-- This is intentionally account-scoped: the endpoint verifies a confirmed user,
-- then this function atomically consumes that user's quota before contacting OpenAI.

begin;

create table if not exists public.receipt_scan_limits (
  user_id uuid primary key references auth.users(id) on delete cascade,
  window_started_at timestamptz not null default now(),
  request_count integer not null default 0 check (request_count >= 0)
);

alter table public.receipt_scan_limits enable row level security;
revoke all on public.receipt_scan_limits from public, anon, authenticated;

create or replace function public.consume_receipt_scan_quota()
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  quota_now timestamptz := clock_timestamp();
  allowed boolean;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;

  insert into public.receipt_scan_limits (user_id, window_started_at, request_count)
  values (auth.uid(), quota_now, 1)
  on conflict (user_id) do update
    set window_started_at = case
          when public.receipt_scan_limits.window_started_at <= quota_now - interval '1 minute' then quota_now
          else public.receipt_scan_limits.window_started_at
        end,
        request_count = case
          when public.receipt_scan_limits.window_started_at <= quota_now - interval '1 minute' then 1
          else public.receipt_scan_limits.request_count + 1
        end
  where public.receipt_scan_limits.window_started_at <= quota_now - interval '1 minute'
     or public.receipt_scan_limits.request_count < 8
  returning true into allowed;

  return coalesce(allowed, false);
end;
$$;

revoke all on function public.consume_receipt_scan_quota() from public, anon;
grant execute on function public.consume_receipt_scan_quota() to authenticated;

commit;
