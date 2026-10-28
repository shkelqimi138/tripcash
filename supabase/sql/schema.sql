-- TripCash fresh Supabase schema.
-- WARNING: this drops and recreates all TripCash app tables.

create extension if not exists pgcrypto;

drop table if exists public.activity_log cascade;
drop table if exists public.receipt_scan_limits cascade;
drop table if exists public.payments cascade;
drop table if exists public.settlements cascade;
drop table if exists public.expense_splits cascade;
drop table if exists public.expenses cascade;
drop table if exists public.members cascade;
drop table if exists public.trip_members cascade;
drop table if exists public.trip_invites cascade;
drop table if exists public.trips cascade;
drop table if exists public.contacts cascade;
drop table if exists public.profiles cascade;

drop function if exists public.is_trip_creator(uuid);
drop function if exists public.can_access_trip(uuid);
drop function if exists public.is_trip_joinable(uuid);
drop function if exists public.set_trip_creator();
drop function if exists public.set_expense_created_by();
drop function if exists public.get_trip_preview(uuid);
drop function if exists public.get_or_create_trip_invite(uuid);
drop function if exists public.rotate_trip_invite(uuid);
drop function if exists public.accept_trip_invite(uuid);
drop function if exists public.admin_stats();
drop function if exists public.delete_current_user();
drop function if exists public.delete_current_user_data();
drop function if exists public.leave_trip(uuid);
drop function if exists public.protect_profile_privileges();
drop function if exists public.protect_trip_ownership();
drop function if exists public.protect_member_identity();
drop function if exists public.set_activity_user();
drop function if exists public.log_trip_change();
drop function if exists public.trip_member_balance(uuid, uuid);
drop function if exists public.validate_payment();
drop function if exists public.validate_expense_split();
drop function if exists public.create_expense_with_splits(jsonb, jsonb);
drop function if exists public.claim_welcome_email();
drop function if exists public.complete_welcome_email();
drop function if exists public.consume_receipt_scan_quota();

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  username text unique,
  avatar_url text,
  paypal_link text,
  home_currency text not null default 'EUR' check (home_currency in ('EUR', 'USD', 'CHF', 'GBP', 'ALL')),
  default_split text not null default 'equal' check (default_split in ('equal', 'exact')),
  theme_preference text not null default 'system' check (theme_preference in ('system', 'light', 'dark')),
  preferences_initialized boolean not null default false,
  welcome_email_claimed_at timestamptz,
  welcome_email_sent_at timestamptz,
  is_anonymous boolean not null default false,
  is_admin boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.contacts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(trim(name)) >= 1),
  created_at timestamptz not null default now(),
  unique (owner_id, name)
);

create table public.trips (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  creator_id uuid references auth.users(id) on delete set null,
  currency text not null default 'EUR' check (currency in ('EUR', 'USD', 'CHF', 'GBP', 'ALL')),
  budget numeric(12,2) check (budget is null or budget >= 0),
  start_date date,
  end_date date,
  current_day int not null default 1,
  emoji text not null default 'plane',
  status text not null default 'active' check (status in ('active', 'ended')),
  created_at timestamptz not null default now()
);

create table public.trip_members (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('creator', 'member')),
  joined_at timestamptz not null default now(),
  unique (trip_id, user_id)
);

create table public.trip_invites (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null unique references public.trips(id) on delete cascade,
  token uuid not null unique default gen_random_uuid(),
  expires_at timestamptz not null default (now() + interval '30 days'),
  created_at timestamptz not null default now()
);

create table public.members (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  name text not null,
  paypal_link text,
  created_at timestamptz not null default now(),
  unique (trip_id, user_id)
);

create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  title text not null,
  amount numeric(10,2) not null check (amount > 0),
  currency text not null default 'EUR' check (currency in ('EUR', 'USD', 'CHF', 'GBP', 'ALL')),
  original_amount numeric(10,2),
  exchange_rate numeric(18,8) not null default 1,
  rate_date timestamptz not null default now(),
  paid_by uuid not null references public.members(id) on delete restrict,
  created_by uuid references auth.users(id) on delete set null,
  created_by_name text not null default 'Guest',
  day_number int not null default 1,
  category text not null default 'other'
    check (category in ('food', 'drinks', 'transport', 'hotel', 'activities', 'other')),
  split_type text not null default 'equal'
    check (split_type in ('equal', 'exact', 'percent', 'shares')),
  note text,
  receipt_url text,
  created_at timestamptz not null default now()
);

create table public.expense_splits (
  id uuid primary key default gen_random_uuid(),
  expense_id uuid not null references public.expenses(id) on delete cascade,
  member_id uuid not null references public.members(id) on delete cascade,
  share_amount numeric(10,2) not null,
  unique (expense_id, member_id)
);

create table public.settlements (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  day_number int not null,
  note text,
  settled_at timestamptz not null default now(),
  unique (trip_id, day_number)
);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  from_member uuid not null references public.members(id) on delete restrict,
  to_member uuid not null references public.members(id) on delete restrict,
  amount numeric(10,2) not null check (amount > 0),
  note text,
  day_number int not null default 1,
  paid_at timestamptz not null default now()
);

create table public.activity_log (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  action text not null,
  description text not null,
  created_at timestamptz not null default now()
);

create table public.receipt_scan_limits (
  user_id uuid primary key references auth.users(id) on delete cascade,
  window_started_at timestamptz not null default now(),
  request_count integer not null default 0 check (request_count >= 0)
);

alter table public.profiles
  add constraint profiles_display_name_length check (char_length(trim(display_name)) between 1 and 40),
  add constraint profiles_username_length check (username is null or char_length(username) between 1 and 40),
  add constraint profiles_avatar_url_length check (avatar_url is null or char_length(avatar_url) <= 2048),
  add constraint profiles_paypal_link_valid check (paypal_link is null or (char_length(paypal_link) <= 255 and paypal_link ~ '^https://(www\.)?paypal\.me/[A-Za-z0-9._-]+/?$'));

alter table public.contacts
  add constraint contacts_name_length check (char_length(trim(name)) between 1 and 40);

alter table public.trips
  add constraint trips_name_length check (char_length(trim(name)) between 1 and 60),
  add constraint trips_current_day_positive check (current_day >= 1),
  add constraint trips_date_order check (start_date is null or end_date is null or start_date <= end_date),
  add constraint trips_emoji_length check (char_length(emoji) between 1 and 32);

alter table public.members
  add constraint members_name_length check (char_length(trim(name)) between 1 and 40),
  add constraint members_paypal_link_valid check (paypal_link is null or (char_length(paypal_link) <= 255 and paypal_link ~ '^https://(www\.)?paypal\.me/[A-Za-z0-9._-]+/?$'));

alter table public.expenses
  add constraint expenses_title_length check (char_length(trim(title)) between 1 and 80),
  add constraint expenses_original_amount_positive check (original_amount is null or original_amount > 0),
  add constraint expenses_exchange_rate_positive check (exchange_rate > 0),
  add constraint expenses_day_positive check (day_number >= 1),
  add constraint expenses_created_by_name_length check (char_length(trim(created_by_name)) between 1 and 80),
  add constraint expenses_note_length check (note is null or char_length(note) <= 200),
  add constraint expenses_receipt_url_length check (receipt_url is null or char_length(receipt_url) <= 2048);

alter table public.expense_splits
  add constraint expense_splits_share_positive check (share_amount > 0);

alter table public.settlements
  add constraint settlements_day_positive check (day_number >= 1),
  add constraint settlements_note_length check (note is null or char_length(note) <= 200);

alter table public.payments
  add constraint payments_day_positive check (day_number >= 1),
  add constraint payments_note_length check (note is null or char_length(note) <= 200);

alter table public.activity_log
  add constraint activity_action_length check (char_length(trim(action)) between 1 and 80),
  add constraint activity_description_length check (char_length(trim(description)) between 1 and 500);

create or replace function public.is_trip_creator(p_trip_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.trips
    where id = p_trip_id
      and creator_id = auth.uid()
  );
$$;

create or replace function public.can_access_trip(p_trip_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.trips
    where id = p_trip_id
      and creator_id = auth.uid()
  )
  or exists (
    select 1
    from public.trip_members
    where trip_id = p_trip_id
      and user_id = auth.uid()
  );
$$;

create or replace function public.get_trip_preview(p_invite_token uuid)
returns table(id uuid, name text, emoji text)
language sql
stable
security definer
set search_path = ''
as $$
  select t.id, t.name, t.emoji
  from public.trip_invites i
  join public.trips t on t.id = i.trip_id
  where i.token = p_invite_token
    and i.expires_at > now()
    and t.status = 'active';
$$;

create or replace function public.get_or_create_trip_invite(p_trip_id uuid)
returns table(token uuid, expires_at timestamptz)
language plpgsql
security definer
set search_path = ''
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
language plpgsql
security definer
set search_path = ''
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
language plpgsql
security definer
set search_path = ''
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

create or replace function public.set_trip_creator()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.creator_id := auth.uid();
  return new;
end;
$$;

create trigger trips_set_creator
before insert on public.trips
for each row
execute function public.set_trip_creator();

create or replace function public.set_expense_created_by()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.created_by := auth.uid();
  new.created_by_name := coalesce(
    (select display_name from public.profiles where id = auth.uid()),
    'Guest'
  );
  return new;
end;
$$;

create trigger expenses_set_created_by
before insert on public.expenses
for each row
execute function public.set_expense_created_by();

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

create trigger expense_splits_validate
before insert on public.expense_splits
for each row execute function public.validate_expense_split();

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
  select
    (split.value ->> 'id')::uuid,
    v_expense_id,
    (split.value ->> 'member_id')::uuid,
    (split.value ->> 'share_amount')::numeric
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

create or replace function public.protect_profile_privileges()
returns trigger
language plpgsql
set search_path = ''
as $$
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

create trigger profiles_protect_privileges
before insert or update on public.profiles
for each row execute function public.protect_profile_privileges();

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

create trigger members_protect_identity
before update on public.members
for each row execute function public.protect_member_identity();

create or replace function public.log_trip_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_trip uuid;
  event_action text;
  event_description text;
begin
  if tg_table_name = 'expenses' and tg_op = 'INSERT' then
    target_trip := new.trip_id;
    event_action := 'expense_added';
    event_description := 'Added expense "' || new.title || '" (' || coalesce(new.original_amount, new.amount) || ' ' || new.currency || ')';
  elsif tg_table_name = 'members' and tg_op = 'INSERT' then
    target_trip := new.trip_id;
    event_action := 'member_added';
    event_description := 'Added member "' || new.name || '"';
  elsif tg_table_name = 'settlements' and tg_op = 'INSERT' then
    target_trip := new.trip_id;
    event_action := 'day_settled';
    event_description := 'Settled Day ' || new.day_number;
  elsif tg_table_name = 'payments' and tg_op = 'INSERT' then
    target_trip := new.trip_id;
    event_action := 'payment_recorded';
    event_description := 'Recorded payment of ' || new.amount;
  elsif tg_table_name = 'trips' and tg_op = 'UPDATE' and old.status = 'active' and new.status = 'ended' then
    target_trip := new.id;
    event_action := 'trip_ended';
    event_description := 'Trip ended';
  else
    return new;
  end if;
  insert into public.activity_log (trip_id, user_id, action, description)
  values (target_trip, auth.uid(), event_action, left(event_description, 500));
  return new;
end;
$$;

create trigger expenses_log_activity after insert on public.expenses for each row execute function public.log_trip_change();
create trigger members_log_activity after insert on public.members for each row execute function public.log_trip_change();
create trigger settlements_log_activity after insert on public.settlements for each row execute function public.log_trip_change();
create trigger payments_log_activity after insert on public.payments for each row execute function public.log_trip_change();
create trigger trips_log_activity after update on public.trips for each row execute function public.log_trip_change();

alter table public.profiles enable row level security;
alter table public.contacts enable row level security;
alter table public.trips enable row level security;
alter table public.trip_members enable row level security;
alter table public.trip_invites enable row level security;
alter table public.members enable row level security;
alter table public.expenses enable row level security;
alter table public.expense_splits enable row level security;
alter table public.settlements enable row level security;
alter table public.payments enable row level security;
alter table public.activity_log enable row level security;
alter table public.receipt_scan_limits enable row level security;

create policy "profiles_select"
on public.profiles
for select
to authenticated
using (
  id = auth.uid()
);

create policy "profiles_insert"
on public.profiles
for insert
to authenticated
with check (id = auth.uid());

create policy "profiles_update"
on public.profiles
for update
to authenticated
using (id = auth.uid())
with check (id = auth.uid());

create policy "contacts_all"
on public.contacts
for all
to authenticated
using (owner_id = auth.uid())
with check (owner_id = auth.uid());

create policy "trips_select"
on public.trips
for select
to authenticated
using (public.can_access_trip(id));

create policy "trips_insert"
on public.trips
for insert
to authenticated
with check (creator_id = auth.uid());

create policy "trips_update"
on public.trips
for update
to authenticated
using (public.is_trip_creator(id))
with check (public.is_trip_creator(id));

create policy "trips_delete"
on public.trips
for delete
to authenticated
using (public.is_trip_creator(id));

create policy "trip_members_select"
on public.trip_members
for select
to authenticated
using (user_id = auth.uid() or public.can_access_trip(trip_id));

create policy "trip_members_insert"
on public.trip_members
for insert
to authenticated
with check (
  user_id = auth.uid()
  and role = 'creator'
  and public.is_trip_creator(trip_id)
);

create policy "trip_members_delete"
on public.trip_members
for delete
to authenticated
using (public.is_trip_creator(trip_id));

create policy "members_select"
on public.members
for select
to authenticated
using (public.can_access_trip(trip_id));

create policy "members_insert"
on public.members
for insert
to authenticated
with check (
  exists (select 1 from public.trips t where t.id = members.trip_id and t.status = 'active')
  and ((user_id is null and public.is_trip_creator(trip_id))
    or (user_id = auth.uid() and public.can_access_trip(trip_id)))
);

create policy "members_update"
on public.members
for update
to authenticated
using (
  exists (select 1 from public.trips t where t.id = members.trip_id and t.status = 'active')
  and ((user_id is null and public.is_trip_creator(trip_id)) or user_id = auth.uid())
)
with check (
  exists (select 1 from public.trips t where t.id = members.trip_id and t.status = 'active')
  and ((user_id is null and public.is_trip_creator(trip_id)) or user_id = auth.uid())
);

create policy "members_delete"
on public.members
for delete
to authenticated
using (
  user_id is null and public.is_trip_creator(trip_id)
  and exists (select 1 from public.trips t where t.id = members.trip_id and t.status = 'active')
);

create policy "expenses_select"
on public.expenses
for select
to authenticated
using (public.can_access_trip(trip_id));

create policy "expenses_insert"
on public.expenses
for insert
to authenticated
with check (
  public.can_access_trip(trip_id)
  and created_by = auth.uid()
  and split_type in ('equal', 'exact')
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
    select 1 from public.members m
    where m.id = paid_by and m.trip_id = expenses.trip_id
  )
);

create policy "expenses_delete"
on public.expenses
for delete
to authenticated
using (
  (public.is_trip_creator(trip_id) or created_by = auth.uid())
  and exists (select 1 from public.trips t where t.id = expenses.trip_id and t.status = 'active')
  and not exists (
    select 1 from public.settlements s
    where s.trip_id = expenses.trip_id
      and s.day_number = expenses.day_number
  )
);

create policy "expense_splits_select"
on public.expense_splits
for select
to authenticated
using (
  exists (
    select 1
    from public.expenses e
    where e.id = expense_id
      and public.can_access_trip(e.trip_id)
  )
);

create policy "expense_splits_insert"
on public.expense_splits
for insert
to authenticated
with check (
  exists (
    select 1
    from public.expenses e
    join public.trips t on t.id = e.trip_id and t.status = 'active'
    join public.members m on m.id = expense_splits.member_id and m.trip_id = e.trip_id
    where e.id = expense_splits.expense_id
      and not exists (select 1 from public.settlements s where s.trip_id = e.trip_id and s.day_number = e.day_number)
      and (public.is_trip_creator(e.trip_id) or e.created_by = auth.uid())
  )
);

create policy "settlements_select"
on public.settlements
for select
to authenticated
using (public.can_access_trip(trip_id));

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
  and not exists (
    select 1 from public.expenses e
    where e.trip_id = settlements.trip_id and e.day_number = settlements.day_number
      and abs(e.amount - coalesce((select sum(es.share_amount) from public.expense_splits es where es.expense_id = e.id), 0)) > 0.009
  )
);

create policy "payments_select"
on public.payments
for select
to authenticated
using (public.can_access_trip(trip_id));

create policy "payments_insert"
on public.payments
for insert
to authenticated
with check (
  public.can_access_trip(trip_id)
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

create policy "payments_delete"
on public.payments
for delete
to authenticated
using (
  public.is_trip_creator(trip_id)
  and exists (select 1 from public.trips t where t.id = payments.trip_id and t.status = 'active')
  and not exists (select 1 from public.settlements s where s.trip_id = payments.trip_id and s.day_number = payments.day_number)
);

create policy "activity_log_select"
on public.activity_log
for select
to authenticated
using (public.can_access_trip(trip_id));

create or replace function public.admin_stats()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and is_admin = true
  ) then
    raise exception 'Access denied';
  end if;
  if coalesce(auth.jwt() ->> 'aal', '') <> 'aal2' then
    raise exception 'Multi-factor authentication required';
  end if;

  -- Only the fields the admin screen shows; never PayPal links, preferences or email state.
  return jsonb_build_object(
    'trips', (select coalesce(jsonb_agg(jsonb_build_object(
      'id', t.id, 'name', t.name, 'emoji', t.emoji, 'currency', t.currency,
      'current_day', t.current_day, 'status', t.status, 'created_at', t.created_at
    ) order by t.created_at desc), '[]'::jsonb) from public.trips t),
    'profiles', (select coalesce(jsonb_agg(jsonb_build_object(
      'id', p.id, 'display_name', p.display_name, 'is_anonymous', p.is_anonymous, 'created_at', p.created_at
    ) order by p.created_at desc), '[]'::jsonb) from public.profiles p),
    'trip_members', (select coalesce(jsonb_agg(jsonb_build_object(
      'trip_id', tm.trip_id, 'user_id', tm.user_id
    )), '[]'::jsonb) from public.trip_members tm),
    'total_expenses', (select count(*) from public.expenses),
    'total_amount', (select coalesce(sum(amount), 0) from public.expenses)
  );
end;
$$;

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

create or replace function public.delete_user_by_id(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.trips
  set status = 'ended'
  where creator_id = p_user_id
    and status = 'active';

  update public.expenses
  set created_by_name = 'Deleted user'
  where created_by = p_user_id;

  update public.members
  set name = 'Deleted user',
      paypal_link = null
  where user_id = p_user_id;

  delete from auth.users
  where id = p_user_id;
end;
$$;

create or replace function public.delete_current_user_data()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  requesting_user uuid := auth.uid();
begin
  if requesting_user is null then raise exception 'Authentication required'; end if;

  update public.trips
  set status = 'ended', creator_id = null
  where creator_id = requesting_user;

  update public.expenses
  set created_by = null, created_by_name = 'TripCash user'
  where created_by = requesting_user;

  update public.activity_log
  set user_id = null, description = 'Activity by an anonymized TripCash user'
  where user_id = requesting_user;

  update public.members
  set user_id = null, name = 'TripCash user', paypal_link = null
  where user_id = requesting_user;

  delete from public.trip_members where user_id = requesting_user;
  delete from public.contacts where owner_id = requesting_user;

  update public.profiles
  set display_name = 'TripCash user', username = null, avatar_url = null,
      paypal_link = null, home_currency = 'EUR', default_split = 'equal',
      theme_preference = 'system', preferences_initialized = false
  where id = requesting_user;
end;
$$;

create or replace function public.claim_welcome_email()
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  claimed boolean;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  update public.profiles
  set welcome_email_claimed_at = now()
  where id = auth.uid()
    and welcome_email_sent_at is null
    and (welcome_email_claimed_at is null or welcome_email_claimed_at < now() - interval '15 minutes')
  returning true into claimed;
  return coalesce(claimed, false);
end;
$$;

create or replace function public.complete_welcome_email()
returns void
language sql
security definer
set search_path = ''
as $$
  update public.profiles
  set welcome_email_sent_at = now(), welcome_email_claimed_at = null
  where id = auth.uid() and welcome_email_sent_at is null and welcome_email_claimed_at is not null;
$$;

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

grant usage on schema public to anon, authenticated, service_role;

revoke all on public.profiles, public.contacts, public.trips,
  public.trip_members, public.trip_invites, public.members, public.expenses,
  public.expense_splits, public.settlements, public.payments,
  public.activity_log, public.receipt_scan_limits from anon, authenticated;

grant select, insert on public.profiles to authenticated;
grant update (preferences_initialized) on public.profiles to authenticated;
grant update (display_name, username, avatar_url, paypal_link, home_currency,
  default_split, theme_preference, is_anonymous)
  on public.profiles to authenticated;
grant select, insert, update, delete on public.contacts to authenticated;
grant select, insert, update, delete on public.trips to authenticated;
grant select, insert, delete on public.trip_members to authenticated;
grant select, insert, update, delete on public.members to authenticated;
grant select, delete on public.expenses to authenticated;
grant select on public.expense_splits to authenticated;
revoke insert on public.expenses, public.expense_splits from authenticated;
grant select, insert on public.settlements to authenticated;
grant select, insert, delete on public.payments to authenticated;
grant select on public.activity_log to authenticated;
revoke all on public.receipt_scan_limits from public, anon, authenticated;

revoke all on all functions in schema public from public, anon, authenticated;

grant execute on function public.is_trip_creator(uuid) to authenticated;
grant execute on function public.can_access_trip(uuid) to authenticated;
grant execute on function public.get_trip_preview(uuid) to anon, authenticated;
grant execute on function public.get_or_create_trip_invite(uuid) to authenticated;
grant execute on function public.rotate_trip_invite(uuid) to authenticated;
grant execute on function public.accept_trip_invite(uuid) to authenticated;
grant execute on function public.create_expense_with_splits(jsonb, jsonb) to authenticated;
grant execute on function public.admin_stats() to authenticated;
grant execute on function public.delete_user_by_id(uuid) to service_role;
grant execute on function public.delete_current_user_data() to authenticated;
grant execute on function public.claim_welcome_email() to authenticated;
grant execute on function public.complete_welcome_email() to authenticated;
grant execute on function public.consume_receipt_scan_quota() to authenticated;
grant execute on function public.leave_trip(uuid) to authenticated;
grant execute on function public.trip_member_balance(uuid, uuid) to authenticated;

create index idx_contacts_owner on public.contacts(owner_id);
create index idx_trip_members_user on public.trip_members(user_id);
create index idx_trip_members_trip on public.trip_members(trip_id);
create index idx_members_trip on public.members(trip_id);
create index idx_expenses_trip on public.expenses(trip_id);
create index idx_expenses_day on public.expenses(trip_id, day_number);
create index idx_expense_splits_expense on public.expense_splits(expense_id);
create index idx_expense_splits_member on public.expense_splits(member_id);
create index idx_settlements_trip on public.settlements(trip_id);
create index idx_payments_trip on public.payments(trip_id);
create index idx_activity_log_trip_created on public.activity_log(trip_id, created_at desc);

-- After first login, make yourself admin:
-- update public.profiles
-- set is_admin = true
-- where id = (select id from auth.users where email = 'your@email.com');
