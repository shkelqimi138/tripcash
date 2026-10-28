-- TripCash Security Stage 1: expiring invitations, trusted activity and admin MFA.
-- Safe to run once against the existing production database.

begin;

create table if not exists public.trip_invites (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null unique references public.trips(id) on delete cascade,
  token uuid not null unique default gen_random_uuid(),
  expires_at timestamptz not null default (now() + interval '30 days'),
  created_at timestamptz not null default now()
);

alter table public.trip_invites enable row level security;
revoke all on public.trip_invites from anon, authenticated;

drop policy if exists "profiles_select" on public.profiles;
create policy "profiles_select" on public.profiles
for select to authenticated using (id = auth.uid());

drop policy if exists "trip_members_insert" on public.trip_members;
create policy "trip_members_insert" on public.trip_members
for insert to authenticated
with check (user_id = auth.uid() and role = 'creator' and public.is_trip_creator(trip_id));

drop function if exists public.get_trip_preview(uuid);
create function public.get_trip_preview(p_invite_token uuid)
returns table(id uuid, name text, emoji text)
language sql stable security definer set search_path = ''
as $$
  select t.id, t.name, t.emoji
  from public.trip_invites i
  join public.trips t on t.id = i.trip_id
  where i.token = p_invite_token and i.expires_at > now() and t.status = 'active';
$$;

create or replace function public.get_or_create_trip_invite(p_trip_id uuid)
returns table(token uuid, expires_at timestamptz)
language plpgsql security definer set search_path = ''
as $$
begin
  if auth.uid() is null or not public.is_trip_creator(p_trip_id) then raise exception 'Access denied'; end if;
  insert into public.trip_invites (trip_id)
  values (p_trip_id)
  on conflict (trip_id) do update
    set token = case when public.trip_invites.expires_at <= now() then gen_random_uuid() else public.trip_invites.token end,
        expires_at = case when public.trip_invites.expires_at <= now() then now() + interval '30 days' else public.trip_invites.expires_at end;
  return query select i.token, i.expires_at from public.trip_invites i where i.trip_id = p_trip_id;
end;
$$;

create or replace function public.rotate_trip_invite(p_trip_id uuid)
returns table(token uuid, expires_at timestamptz)
language plpgsql security definer set search_path = ''
as $$
begin
  if auth.uid() is null or not public.is_trip_creator(p_trip_id) then raise exception 'Access denied'; end if;
  insert into public.trip_invites (trip_id, token, expires_at)
  values (p_trip_id, gen_random_uuid(), now() + interval '30 days')
  on conflict (trip_id) do update set token = excluded.token, expires_at = excluded.expires_at, created_at = now();
  return query select i.token, i.expires_at from public.trip_invites i where i.trip_id = p_trip_id;
end;
$$;

create or replace function public.accept_trip_invite(p_invite_token uuid)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare target_trip uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select i.trip_id into target_trip
  from public.trip_invites i
  join public.trips t on t.id = i.trip_id
  where i.token = p_invite_token and i.expires_at > now() and t.status = 'active'
  for update of i;
  if target_trip is null then raise exception 'Invite is invalid or expired'; end if;
  insert into public.trip_members (trip_id, user_id, role)
  values (target_trip, auth.uid(), case when public.is_trip_creator(target_trip) then 'creator' else 'member' end)
  on conflict (trip_id, user_id) do nothing;
  return target_trip;
end;
$$;

drop policy if exists "activity_log_insert" on public.activity_log;
revoke insert on public.activity_log from authenticated;
drop trigger if exists activity_set_user on public.activity_log;
drop function if exists public.set_activity_user();

create or replace function public.log_trip_change()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare target_trip uuid; event_action text; event_description text;
begin
  if tg_table_name = 'expenses' and tg_op = 'INSERT' then
    target_trip := new.trip_id; event_action := 'expense_added';
    event_description := 'Added expense "' || new.title || '" (' || coalesce(new.original_amount, new.amount) || ' ' || new.currency || ')';
  elsif tg_table_name = 'members' and tg_op = 'INSERT' then
    target_trip := new.trip_id; event_action := 'member_added'; event_description := 'Added member "' || new.name || '"';
  elsif tg_table_name = 'settlements' and tg_op = 'INSERT' then
    target_trip := new.trip_id; event_action := 'day_settled'; event_description := 'Settled Day ' || new.day_number;
  elsif tg_table_name = 'payments' and tg_op = 'INSERT' then
    target_trip := new.trip_id; event_action := 'payment_recorded'; event_description := 'Recorded payment of ' || new.amount;
  elsif tg_table_name = 'trips' and tg_op = 'UPDATE' and old.status = 'active' and new.status = 'ended' then
    target_trip := new.id; event_action := 'trip_ended'; event_description := 'Trip ended';
  else
    return new;
  end if;
  insert into public.activity_log (trip_id, user_id, action, description)
  values (target_trip, auth.uid(), event_action, left(event_description, 500));
  return new;
end;
$$;

drop trigger if exists expenses_log_activity on public.expenses;
drop trigger if exists members_log_activity on public.members;
drop trigger if exists settlements_log_activity on public.settlements;
drop trigger if exists payments_log_activity on public.payments;
drop trigger if exists trips_log_activity on public.trips;
create trigger expenses_log_activity after insert on public.expenses for each row execute function public.log_trip_change();
create trigger members_log_activity after insert on public.members for each row execute function public.log_trip_change();
create trigger settlements_log_activity after insert on public.settlements for each row execute function public.log_trip_change();
create trigger payments_log_activity after insert on public.payments for each row execute function public.log_trip_change();
create trigger trips_log_activity after update on public.trips for each row execute function public.log_trip_change();

create or replace function public.admin_stats()
returns jsonb language plpgsql security definer set search_path = ''
as $$
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and is_admin = true) then raise exception 'Access denied'; end if;
  if coalesce(auth.jwt() ->> 'aal', '') <> 'aal2' then raise exception 'Multi-factor authentication required'; end if;
  return jsonb_build_object(
    'trips', (select coalesce(jsonb_agg(t order by t.created_at desc), '[]'::jsonb) from public.trips t),
    'profiles', (select coalesce(jsonb_agg(p order by p.created_at desc), '[]'::jsonb) from public.profiles p),
    'trip_members', (select coalesce(jsonb_agg(tm), '[]'::jsonb) from public.trip_members tm),
    'total_expenses', (select count(*) from public.expenses),
    'total_amount', (select coalesce(sum(amount), 0) from public.expenses)
  );
end;
$$;

create or replace function public.create_expense_with_splits(p_expense jsonb, p_splits jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_expense_id uuid := (p_expense ->> 'id')::uuid;
  v_trip_id uuid := (p_expense ->> 'trip_id')::uuid;
  v_expense_amount numeric := (p_expense ->> 'amount')::numeric;
  existing public.expenses%rowtype;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if jsonb_typeof(p_expense) <> 'object' or jsonb_typeof(p_splits) <> 'array'
    or jsonb_array_length(p_splits) < 1 or jsonb_array_length(p_splits) > 100 then
    raise exception 'Invalid expense payload';
  end if;
  if not public.can_access_trip(v_trip_id)
    or not exists (
      select 1 from public.trips t
      where t.id = v_trip_id and t.status = 'active'
        and (p_expense ->> 'day_number')::int between 1 and t.current_day
    )
    or exists (
      select 1 from public.settlements s
      where s.trip_id = v_trip_id and s.day_number = (p_expense ->> 'day_number')::int
    )
    or not exists (
      select 1 from public.members m
      where m.id = (p_expense ->> 'paid_by')::uuid and m.trip_id = v_trip_id
    ) then
    raise exception 'Expense is not allowed';
  end if;
  select * into existing from public.expenses where id = v_expense_id for update;
  if found then
    if existing.created_by is distinct from auth.uid()
      or existing.trip_id is distinct from v_trip_id
      or existing.amount is distinct from v_expense_amount then
      raise exception 'Expense identifier conflict';
    end if;
  else
    insert into public.expenses (
      id, trip_id, title, amount, currency, original_amount, exchange_rate,
      rate_date, paid_by, created_by, created_by_name, day_number, category,
      split_type, note, receipt_url, created_at
    ) values (
      v_expense_id, v_trip_id, p_expense ->> 'title', v_expense_amount,
      coalesce(p_expense ->> 'currency', 'EUR'), nullif(p_expense ->> 'original_amount', '')::numeric,
      coalesce(nullif(p_expense ->> 'exchange_rate', '')::numeric, 1),
      coalesce(nullif(p_expense ->> 'rate_date', '')::timestamptz, now()),
      (p_expense ->> 'paid_by')::uuid, auth.uid(), p_expense ->> 'created_by_name',
      coalesce(nullif(p_expense ->> 'day_number', '')::int, 1),
      coalesce(p_expense ->> 'category', 'other'), coalesce(p_expense ->> 'split_type', 'equal'),
      nullif(p_expense ->> 'note', ''), nullif(p_expense ->> 'receipt_url', ''),
      coalesce(nullif(p_expense ->> 'created_at', '')::timestamptz, now())
    );
  end if;
  insert into public.expense_splits (id, expense_id, member_id, share_amount)
  select (split.value ->> 'id')::uuid, v_expense_id,
    (split.value ->> 'member_id')::uuid, (split.value ->> 'share_amount')::numeric
  from jsonb_array_elements(p_splits) as split(value)
  where exists (
    select 1 from public.members m
    where m.id = (split.value ->> 'member_id')::uuid and m.trip_id = v_trip_id
  )
  on conflict (id) do nothing;
  if (select count(*) from public.expense_splits where expense_splits.expense_id = v_expense_id)
      <> jsonb_array_length(p_splits)
    or abs(v_expense_amount - coalesce((
      select sum(es.share_amount) from public.expense_splits es
      where es.expense_id = v_expense_id
    ), 0)) > 0.009 then
    raise exception 'Expense splits must exactly match the expense amount';
  end if;
  return v_expense_id;
end;
$$;

revoke insert on public.expenses, public.expense_splits from authenticated;

revoke all on function public.get_trip_preview(uuid) from public, anon, authenticated;
revoke all on function public.get_or_create_trip_invite(uuid) from public, anon, authenticated;
revoke all on function public.rotate_trip_invite(uuid) from public, anon, authenticated;
revoke all on function public.accept_trip_invite(uuid) from public, anon, authenticated;
grant execute on function public.get_trip_preview(uuid) to anon, authenticated;
grant execute on function public.get_or_create_trip_invite(uuid) to authenticated;
grant execute on function public.rotate_trip_invite(uuid) to authenticated;
grant execute on function public.accept_trip_invite(uuid) to authenticated;
revoke all on function public.create_expense_with_splits(jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.create_expense_with_splits(jsonb, jsonb) to authenticated;
revoke all on function public.admin_stats() from public, anon, authenticated;
grant execute on function public.admin_stats() to authenticated;

drop function if exists public.is_trip_joinable(uuid);

commit;
