-- TripCash non-destructive production migration.
-- Safe to run in Supabase SQL Editor after the budget/date migration.

begin;

alter table public.trips
  add column if not exists budget numeric(12,2),
  add column if not exists start_date date,
  add column if not exists end_date date;

create unique index if not exists idx_settlements_trip_day_unique
  on public.settlements(trip_id, day_number);

-- Protect ownership and privilege-bearing columns from client writes.
create or replace function public.protect_profile_privileges()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user = 'authenticated' then
    if tg_op = 'INSERT' then
      new.is_admin := false;
    else
      new.id := old.id;
      new.is_admin := old.is_admin;
      new.created_at := old.created_at;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_protect_privileges on public.profiles;
create trigger profiles_protect_privileges
before insert or update on public.profiles
for each row execute function public.protect_profile_privileges();

create or replace function public.protect_trip_ownership()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user = 'authenticated' then
    new.creator_id := old.creator_id;
    new.created_at := old.created_at;
  end if;
  return new;
end;
$$;

drop trigger if exists trips_protect_ownership on public.trips;
create trigger trips_protect_ownership
before update on public.trips
for each row execute function public.protect_trip_ownership();

create or replace function public.protect_member_identity()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user = 'authenticated' then
    new.trip_id := old.trip_id;
    new.user_id := old.user_id;
    new.created_at := old.created_at;
  end if;
  return new;
end;
$$;

drop trigger if exists members_protect_identity on public.members;
create trigger members_protect_identity
before update on public.members
for each row execute function public.protect_member_identity();

create or replace function public.set_activity_user()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user = 'authenticated' then
    new.user_id := auth.uid();
  end if;
  return new;
end;
$$;

drop trigger if exists activity_set_user on public.activity_log;
create trigger activity_set_user
before insert on public.activity_log
for each row execute function public.set_activity_user();

drop policy if exists "trip_members_delete" on public.trip_members;
create policy "trip_members_delete"
on public.trip_members
for delete
to authenticated
using (public.is_trip_creator(trip_id));

drop policy if exists "members_delete" on public.members;
create policy "members_delete"
on public.members
for delete
to authenticated
using (user_id is null and public.is_trip_creator(trip_id));

drop policy if exists "trip_members_insert" on public.trip_members;
create policy "trip_members_insert"
on public.trip_members
for insert
to authenticated
with check (
  user_id = auth.uid()
  and (role = 'member' or (role = 'creator' and public.is_trip_creator(trip_id)))
);

drop policy if exists "payments_insert" on public.payments;
create policy "payments_insert"
on public.payments
for insert
to authenticated
with check (
  public.can_access_trip(trip_id)
  and from_member <> to_member
  and exists (
    select 1 from public.members recipient
    where recipient.id = to_member
      and recipient.trip_id = payments.trip_id
  )
  and (
    public.is_trip_creator(trip_id)
    or exists (
      select 1 from public.members m
      where m.id = from_member
        and m.trip_id = payments.trip_id
        and m.user_id = auth.uid()
    )
  )
);

drop policy if exists "settlements_insert" on public.settlements;
create policy "settlements_insert"
on public.settlements
for insert
to authenticated
with check (
  public.is_trip_creator(trip_id)
  and exists (
    select 1 from public.trips t
    where t.id = settlements.trip_id
      and t.status = 'active'
      and settlements.day_number between 1 and t.current_day
  )
);

drop policy if exists "expenses_insert" on public.expenses;
create policy "expenses_insert"
on public.expenses
for insert
to authenticated
with check (
  public.can_access_trip(trip_id)
  and created_by = auth.uid()
  and exists (
    select 1 from public.trips t
    where t.id = expenses.trip_id
      and t.status = 'active'
      and expenses.day_number between 1 and t.current_day
  )
  and not exists (
    select 1 from public.settlements s
    where s.trip_id = expenses.trip_id
      and s.day_number = expenses.day_number
  )
  and exists (
    select 1 from public.members payer
    where payer.id = paid_by and payer.trip_id = expenses.trip_id
  )
);

drop policy if exists "expenses_delete" on public.expenses;
create policy "expenses_delete"
on public.expenses
for delete
to authenticated
using (
  (public.is_trip_creator(trip_id) or created_by = auth.uid())
  and not exists (
    select 1 from public.settlements s
    where s.trip_id = expenses.trip_id
      and s.day_number = expenses.day_number
  )
);

-- The client has no expense/split edit operation. Removing stale update/delete
-- policies prevents direct API callers from rewriting another member's data.
drop policy if exists "expenses_update" on public.expenses;
drop policy if exists "expense_splits_update" on public.expense_splits;
drop policy if exists "expense_splits_delete" on public.expense_splits;

drop policy if exists "expense_splits_insert" on public.expense_splits;
create policy "expense_splits_insert"
on public.expense_splits
for insert
to authenticated
with check (
  exists (
    select 1
    from public.expenses expense
    join public.members participant
      on participant.id = member_id
      and participant.trip_id = expense.trip_id
    where expense.id = expense_id
      and (
        public.is_trip_creator(expense.trip_id)
        or expense.created_by = auth.uid()
      )
  )
);

-- Replace broad grants (which included TRUNCATE/TRIGGER/REFERENCES) with the
-- exact operations used by the browser client. RLS still filters every row.
revoke all on public.profiles, public.contacts, public.trips,
  public.trip_members, public.members, public.expenses,
  public.expense_splits, public.settlements, public.payments,
  public.activity_log from anon, authenticated;

grant select, insert on public.profiles to authenticated;
grant update (display_name, username, avatar_url, paypal_link, is_anonymous)
  on public.profiles to authenticated;
grant select, insert, update, delete on public.contacts to authenticated;
grant select, insert, update, delete on public.trips to authenticated;
grant select, insert, delete on public.trip_members to authenticated;
grant select, insert, update, delete on public.members to authenticated;
grant select, insert, delete on public.expenses to authenticated;
grant select, insert on public.expense_splits to authenticated;
grant select, insert on public.settlements to authenticated;
grant select, insert, delete on public.payments to authenticated;
grant select, insert on public.activity_log to authenticated;

-- Retire the unauthenticated client-written auth log. Supabase Auth audit logs
-- are the authoritative source and already have platform abuse controls.
revoke all on public.auth_logs from anon, authenticated;

alter function public.is_trip_creator(uuid) set search_path = '';
alter function public.can_access_trip(uuid) set search_path = '';
alter function public.get_trip_preview(uuid) set search_path = '';
alter function public.admin_stats() set search_path = '';
alter function public.delete_current_user() set search_path = '';

revoke all on function public.is_trip_creator(uuid) from public, anon, authenticated;
revoke all on function public.can_access_trip(uuid) from public, anon, authenticated;
revoke all on function public.get_trip_preview(uuid) from public, anon, authenticated;
revoke all on function public.admin_stats() from public, anon, authenticated;
revoke all on function public.delete_current_user() from public, anon, authenticated;
grant execute on function public.is_trip_creator(uuid) to authenticated;
grant execute on function public.can_access_trip(uuid) to authenticated;
grant execute on function public.get_trip_preview(uuid) to anon, authenticated;
grant execute on function public.admin_stats() to authenticated;
grant execute on function public.delete_current_user() to authenticated;

create or replace function public.leave_trip(p_trip_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  requesting_user uuid := auth.uid();
  visible_member uuid;
  member_balance numeric := 0;
begin
  if requesting_user is null then
    raise exception 'Authentication required';
  end if;

  if exists (
    select 1 from public.trips
    where id = p_trip_id and creator_id = requesting_user
  ) then
    raise exception 'Trip creators cannot leave their own trip';
  end if;

  if not exists (
    select 1 from public.trip_members
    where trip_id = p_trip_id and user_id = requesting_user
  ) then
    raise exception 'You are not a member of this trip';
  end if;

  select id into visible_member
  from public.members
  where trip_id = p_trip_id and user_id = requesting_user
  limit 1;

  if visible_member is not null then
    select
      coalesce((select sum(e.amount) from public.expenses e where e.trip_id = p_trip_id and e.paid_by = visible_member), 0)
      - coalesce((select sum(es.share_amount) from public.expense_splits es join public.expenses e on e.id = es.expense_id where e.trip_id = p_trip_id and es.member_id = visible_member), 0)
      + coalesce((select sum(p.amount) from public.payments p where p.trip_id = p_trip_id and p.from_member = visible_member), 0)
      - coalesce((select sum(p.amount) from public.payments p where p.trip_id = p_trip_id and p.to_member = visible_member), 0)
    into member_balance;

    if abs(member_balance) > 0.009 then
      raise exception 'You cannot leave with an unpaid balance';
    end if;

    update public.members
    set user_id = null
    where id = visible_member;
  end if;

  delete from public.trip_members
  where trip_id = p_trip_id and user_id = requesting_user;
end;
$$;

revoke all on function public.leave_trip(uuid) from public, anon;
grant execute on function public.leave_trip(uuid) to authenticated;

commit;
