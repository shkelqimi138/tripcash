-- TripCash Security Stage 2 migration.
-- Run once in Supabase SQL Editor only after explicit production approval.

begin;

-- Enforce the same boundaries server-side that the interface applies. NOT VALID
-- keeps legacy rows from blocking deployment while protecting every new write.
alter table public.profiles
  add constraint profiles_display_name_length check (char_length(trim(display_name)) between 1 and 40) not valid,
  add constraint profiles_username_length check (username is null or char_length(username) between 1 and 40) not valid,
  add constraint profiles_avatar_url_length check (avatar_url is null or char_length(avatar_url) <= 2048) not valid,
  add constraint profiles_paypal_link_valid check (paypal_link is null or (char_length(paypal_link) <= 255 and paypal_link ~ '^https://(www\.)?paypal\.me/[A-Za-z0-9._-]+/?$')) not valid;

alter table public.contacts
  add constraint contacts_name_length check (char_length(trim(name)) between 1 and 40) not valid;

alter table public.trips
  add constraint trips_name_length check (char_length(trim(name)) between 1 and 60) not valid,
  add constraint trips_current_day_positive check (current_day >= 1) not valid,
  add constraint trips_date_order check (start_date is null or end_date is null or start_date <= end_date) not valid,
  add constraint trips_emoji_length check (char_length(emoji) between 1 and 32) not valid;

alter table public.members
  add constraint members_name_length check (char_length(trim(name)) between 1 and 40) not valid,
  add constraint members_paypal_link_valid check (paypal_link is null or (char_length(paypal_link) <= 255 and paypal_link ~ '^https://(www\.)?paypal\.me/[A-Za-z0-9._-]+/?$')) not valid;

alter table public.expenses
  add constraint expenses_title_length check (char_length(trim(title)) between 1 and 80) not valid,
  add constraint expenses_original_amount_positive check (original_amount is null or original_amount > 0) not valid,
  add constraint expenses_exchange_rate_positive check (exchange_rate > 0) not valid,
  add constraint expenses_day_positive check (day_number >= 1) not valid,
  add constraint expenses_created_by_name_length check (char_length(trim(created_by_name)) between 1 and 80) not valid,
  add constraint expenses_note_length check (note is null or char_length(note) <= 200) not valid,
  add constraint expenses_receipt_url_length check (receipt_url is null or char_length(receipt_url) <= 2048) not valid;

alter table public.expense_splits
  add constraint expense_splits_share_positive check (share_amount > 0) not valid;

alter table public.settlements
  add constraint settlements_day_positive check (day_number >= 1) not valid,
  add constraint settlements_note_length check (note is null or char_length(note) <= 200) not valid;

alter table public.payments
  add constraint payments_day_positive check (day_number >= 1) not valid,
  add constraint payments_note_length check (note is null or char_length(note) <= 200) not valid;

alter table public.activity_log
  add constraint activity_action_length check (char_length(trim(action)) between 1 and 80) not valid,
  add constraint activity_description_length check (char_length(trim(description)) between 1 and 500) not valid;

create or replace function public.get_trip_preview(p_trip_id uuid)
returns table(id uuid, name text, emoji text)
language sql
stable
security definer
set search_path = ''
as $$
  select t.id, t.name, t.emoji
  from public.trips t
  where t.id = p_trip_id
    and t.status = 'active';
$$;

create or replace function public.is_trip_joinable(p_trip_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.trips
    where id = p_trip_id and status = 'active'
  );
$$;

create or replace function public.trip_member_balance(p_trip_id uuid, p_member_id uuid)
returns numeric
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  result numeric;
begin
  if auth.uid() is null or not public.can_access_trip(p_trip_id) then
    raise exception 'Access denied';
  end if;
  if not exists (select 1 from public.members where id = p_member_id and trip_id = p_trip_id) then
    raise exception 'Member does not belong to this trip';
  end if;

  select
    coalesce((select sum(e.amount) from public.expenses e where e.trip_id = p_trip_id and e.paid_by = p_member_id), 0)
    - coalesce((select sum(es.share_amount) from public.expense_splits es join public.expenses e on e.id = es.expense_id where e.trip_id = p_trip_id and es.member_id = p_member_id), 0)
    + coalesce((select sum(p.amount) from public.payments p where p.trip_id = p_trip_id and p.from_member = p_member_id), 0)
    - coalesce((select sum(p.amount) from public.payments p where p.trip_id = p_trip_id and p.to_member = p_member_id), 0)
  into result;
  return result;
end;
$$;

create or replace function public.validate_payment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  trip_status text;
  trip_day integer;
  from_balance numeric;
  to_balance numeric;
begin
  if auth.uid() is null then return new; end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(new.trip_id::text, 0));
  select status, current_day into trip_status, trip_day from public.trips where id = new.trip_id;
  if trip_status is distinct from 'active' or new.day_number not between 1 and trip_day then
    raise exception 'Payments require an active trip day';
  end if;
  if exists (select 1 from public.settlements where trip_id = new.trip_id and day_number = new.day_number) then
    raise exception 'Settled days are read-only';
  end if;
  if exists (
    select 1 from public.expenses e
    where e.trip_id = new.trip_id
      and abs(e.amount - coalesce((select sum(es.share_amount) from public.expense_splits es where es.expense_id = e.id), 0)) > 0.009
  ) then
    raise exception 'Every expense must be completely split before recording payments';
  end if;
  if new.from_member = new.to_member
    or not exists (select 1 from public.members where id = new.from_member and trip_id = new.trip_id)
    or not exists (select 1 from public.members where id = new.to_member and trip_id = new.trip_id) then
    raise exception 'Invalid payment members';
  end if;

  from_balance := public.trip_member_balance(new.trip_id, new.from_member);
  to_balance := public.trip_member_balance(new.trip_id, new.to_member);
  if from_balance >= -0.009 or to_balance <= 0.009
    or new.amount > least(-from_balance, to_balance) + 0.009 then
    raise exception 'Payment exceeds the outstanding balance';
  end if;
  new.paid_at := now();
  return new;
end;
$$;

drop trigger if exists payments_validate on public.payments;
create trigger payments_validate
before insert on public.payments
for each row execute function public.validate_payment();

create or replace function public.validate_expense_split()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  expense_total numeric;
begin
  if auth.uid() is null then return new; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(new.expense_id::text, 0));
  select amount into expense_total from public.expenses where id = new.expense_id;
  if expense_total is null
    or coalesce((select sum(share_amount) from public.expense_splits where expense_id = new.expense_id), 0) + new.share_amount > expense_total + 0.009 then
    raise exception 'Expense splits cannot exceed the expense amount';
  end if;
  return new;
end;
$$;

drop trigger if exists expense_splits_validate on public.expense_splits;
create trigger expense_splits_validate
before insert on public.expense_splits
for each row execute function public.validate_expense_split();

create or replace function public.protect_trip_ownership()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user <> 'authenticated' then return new; end if;
  new.creator_id := old.creator_id;
  new.created_at := old.created_at;

  if old.status = 'ended' and new is distinct from old then
    raise exception 'Ended trips are read-only';
  end if;
  if new.current_day is distinct from old.current_day then
    if new.current_day <> old.current_day + 1
      or not exists (select 1 from public.settlements where trip_id = old.id and day_number = old.current_day) then
      raise exception 'Settle the current day before opening the next day';
    end if;
  end if;
  if old.status = 'active' and new.status = 'ended' then
    if exists (
      select 1 from public.expenses e
      where e.trip_id = old.id
        and abs(e.amount - coalesce((select sum(es.share_amount) from public.expense_splits es where es.expense_id = e.id), 0)) > 0.009
    ) then
      raise exception 'Every expense must be completely split before ending the trip';
    end if;
    if exists (
      select 1 from public.members m
      where m.trip_id = old.id and abs(public.trip_member_balance(old.id, m.id)) > 0.009
    ) then
      raise exception 'Settle all balances before ending the trip';
    end if;
  end if;
  return new;
end;
$$;

drop policy if exists "trip_members_insert" on public.trip_members;
create policy "trip_members_insert" on public.trip_members for insert to authenticated
with check (
  user_id = auth.uid()
  and public.is_trip_joinable(trip_id)
  and (role = 'member' or (role = 'creator' and public.is_trip_creator(trip_id)))
);

drop policy if exists "members_insert" on public.members;
create policy "members_insert" on public.members for insert to authenticated
with check (
  exists (select 1 from public.trips t where t.id = members.trip_id and t.status = 'active')
  and ((user_id is null and public.is_trip_creator(trip_id)) or (user_id = auth.uid() and public.can_access_trip(trip_id)))
);

drop policy if exists "members_update" on public.members;
create policy "members_update" on public.members for update to authenticated
using (
  exists (select 1 from public.trips t where t.id = members.trip_id and t.status = 'active')
  and ((user_id is null and public.is_trip_creator(trip_id)) or user_id = auth.uid())
)
with check (
  exists (select 1 from public.trips t where t.id = members.trip_id and t.status = 'active')
  and ((user_id is null and public.is_trip_creator(trip_id)) or user_id = auth.uid())
);

drop policy if exists "members_delete" on public.members;
create policy "members_delete" on public.members for delete to authenticated
using (
  user_id is null and public.is_trip_creator(trip_id)
  and exists (select 1 from public.trips t where t.id = members.trip_id and t.status = 'active')
);

drop policy if exists "expenses_delete" on public.expenses;
create policy "expenses_delete" on public.expenses for delete to authenticated
using (
  (public.is_trip_creator(trip_id) or created_by = auth.uid())
  and exists (select 1 from public.trips t where t.id = expenses.trip_id and t.status = 'active')
  and not exists (select 1 from public.settlements s where s.trip_id = expenses.trip_id and s.day_number = expenses.day_number)
);

drop policy if exists "expenses_insert" on public.expenses;
create policy "expenses_insert" on public.expenses for insert to authenticated
with check (
  public.can_access_trip(trip_id)
  and created_by = auth.uid()
  and split_type in ('equal', 'exact')
  and exists (
    select 1 from public.trips t
    where t.id = expenses.trip_id and t.status = 'active'
      and expenses.day_number between 1 and t.current_day
  )
  and not exists (select 1 from public.settlements s where s.trip_id = expenses.trip_id and s.day_number = expenses.day_number)
  and exists (select 1 from public.members payer where payer.id = paid_by and payer.trip_id = expenses.trip_id)
);

drop policy if exists "expense_splits_insert" on public.expense_splits;
create policy "expense_splits_insert" on public.expense_splits for insert to authenticated
with check (
  exists (
    select 1 from public.expenses e
    join public.trips t on t.id = e.trip_id and t.status = 'active'
    join public.members m on m.id = expense_splits.member_id and m.trip_id = e.trip_id
    where e.id = expense_splits.expense_id
      and not exists (select 1 from public.settlements s where s.trip_id = e.trip_id and s.day_number = e.day_number)
      and (public.is_trip_creator(e.trip_id) or e.created_by = auth.uid())
  )
);

drop policy if exists "payments_insert" on public.payments;
create policy "payments_insert" on public.payments for insert to authenticated
with check (
  public.can_access_trip(trip_id)
  and (public.is_trip_creator(trip_id) or exists (
    select 1 from public.members m
    where m.id = from_member and m.trip_id = payments.trip_id and m.user_id = auth.uid()
  ))
);

drop policy if exists "settlements_insert" on public.settlements;
create policy "settlements_insert" on public.settlements for insert to authenticated
with check (
  public.is_trip_creator(trip_id)
  and exists (
    select 1 from public.trips t
    where t.id = settlements.trip_id and t.status = 'active'
      and settlements.day_number between 1 and t.current_day
  )
  and not exists (
    select 1 from public.expenses e
    where e.trip_id = settlements.trip_id and e.day_number = settlements.day_number
      and abs(e.amount - coalesce((select sum(es.share_amount) from public.expense_splits es where es.expense_id = e.id), 0)) > 0.009
  )
);

drop policy if exists "payments_delete" on public.payments;
create policy "payments_delete" on public.payments for delete to authenticated
using (
  public.is_trip_creator(trip_id)
  and exists (select 1 from public.trips t where t.id = payments.trip_id and t.status = 'active')
  and not exists (select 1 from public.settlements s where s.trip_id = payments.trip_id and s.day_number = payments.day_number)
);

create or replace function public.delete_current_user()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  requesting_user uuid := auth.uid();
begin
  if requesting_user is null then raise exception 'Authentication required'; end if;

  -- Shared records remain anonymized, but a deleted creator cannot leave an
  -- ownerless active trip that other members can continue modifying.
  update public.trips set status = 'ended' where creator_id = requesting_user and status = 'active';
  update public.expenses set created_by_name = 'Deleted user' where created_by = requesting_user;
  update public.members set name = 'Deleted user', paypal_link = null where user_id = requesting_user;
  delete from auth.users where id = requesting_user;
end;
$$;

revoke all on function public.trip_member_balance(uuid, uuid) from public, anon, authenticated;
revoke all on function public.is_trip_joinable(uuid) from public, anon, authenticated;
revoke all on function public.validate_payment() from public, anon, authenticated;
revoke all on function public.validate_expense_split() from public, anon, authenticated;
grant execute on function public.trip_member_balance(uuid, uuid) to authenticated;
grant execute on function public.is_trip_joinable(uuid) to authenticated;

commit;
