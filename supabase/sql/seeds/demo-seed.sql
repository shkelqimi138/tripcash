do $seed$
declare
  target_user constant uuid := 'ee06bc9c-209c-4aa4-94a4-8c38b61602fd';
  trip_id uuid;
  me_id uuid;
  member_2 uuid;
  member_3 uuid;
  expense_id uuid;
begin
  if not exists (select 1 from auth.users where id = target_user) then
    raise exception 'TripCash seed user % does not exist', target_user;
  end if;

  perform set_config('request.jwt.claim.sub', target_user::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);

  if not exists (
    select 1 from public.trips
    where creator_id = target_user and name = 'Demo: Albanian Riviera'
  ) then
    insert into public.trips
      (name, creator_id, currency, budget, start_date, end_date, current_day, emoji, status, created_at)
    values
      ('Demo: Albanian Riviera', target_user, 'EUR', 1800, date '2026-08-21', date '2026-08-28', 4, '🏖️', 'active', now() - interval '4 days')
    returning id into trip_id;

    insert into public.trip_members (trip_id, user_id, role)
    values (trip_id, target_user, 'creator');

    insert into public.members (trip_id, user_id, name)
    values (trip_id, target_user, 'Shkelqim') returning id into me_id;
    insert into public.members (trip_id, name)
    values (trip_id, 'Arta') returning id into member_2;
    insert into public.members (trip_id, name)
    values (trip_id, 'Luan') returning id into member_3;

    insert into public.expenses
      (trip_id, title, amount, currency, original_amount, exchange_rate, paid_by, created_by, created_by_name, day_number, category, split_type, note, created_at)
    values
      (trip_id, 'Beach apartment', 420, 'EUR', 420, 1, me_id, target_user, 'Shkelqim', 1, 'hotel', 'equal', 'Four nights near the beach', now() - interval '4 days')
    returning id into expense_id;
    insert into public.expense_splits (expense_id, member_id, share_amount)
    values (expense_id, me_id, 140), (expense_id, member_2, 140), (expense_id, member_3, 140);

    insert into public.expenses
      (trip_id, title, amount, currency, original_amount, exchange_rate, paid_by, created_by, created_by_name, day_number, category, split_type, note, created_at)
    values
      (trip_id, 'Fuel to the coast', 96, 'EUR', 96, 1, member_2, target_user, 'Shkelqim', 1, 'transport', 'equal', null, now() - interval '3 days 20 hours')
    returning id into expense_id;
    insert into public.expense_splits (expense_id, member_id, share_amount)
    values (expense_id, me_id, 32), (expense_id, member_2, 32), (expense_id, member_3, 32);

    insert into public.expenses
      (trip_id, title, amount, currency, original_amount, exchange_rate, paid_by, created_by, created_by_name, day_number, category, split_type, note, created_at)
    values
      (trip_id, 'Seafood lunch', 84, 'EUR', 84, 1, member_3, target_user, 'Shkelqim', 2, 'food', 'equal', null, now() - interval '2 days 5 hours')
    returning id into expense_id;
    insert into public.expense_splits (expense_id, member_id, share_amount)
    values (expense_id, me_id, 28), (expense_id, member_2, 28), (expense_id, member_3, 28);

    insert into public.expenses
      (trip_id, title, amount, currency, original_amount, exchange_rate, paid_by, created_by, created_by_name, day_number, category, split_type, note, created_at)
    values
      (trip_id, 'Kafe by the sea', 18, 'EUR', 18, 1, me_id, target_user, 'Shkelqim', 3, 'drinks', 'equal', null, now() - interval '1 day 6 hours')
    returning id into expense_id;
    insert into public.expense_splits (expense_id, member_id, share_amount)
    values (expense_id, me_id, 6), (expense_id, member_2, 6), (expense_id, member_3, 6);

    insert into public.expenses
      (trip_id, title, amount, currency, original_amount, exchange_rate, paid_by, created_by, created_by_name, day_number, category, split_type, note, created_at)
    values
      (trip_id, 'Qadra and sunbeds', 45, 'EUR', 45, 1, member_2, target_user, 'Shkelqim', 4, 'other', 'equal', 'Umbrella and three sunbeds', now() - interval '3 hours')
    returning id into expense_id;
    insert into public.expense_splits (expense_id, member_id, share_amount)
    values (expense_id, me_id, 15), (expense_id, member_2, 15), (expense_id, member_3, 15);

    insert into public.payments (trip_id, from_member, to_member, amount, note, day_number, paid_at)
    values (trip_id, member_3, me_id, 50, 'Part of the apartment balance', 4, now() - interval '2 hours');

    insert into public.activity_log (trip_id, user_id, action, description, created_at)
    values
      (trip_id, target_user, 'trip_created', 'Created Demo: Albanian Riviera', now() - interval '4 days'),
      (trip_id, target_user, 'members_added', 'Added Arta and Luan', now() - interval '3 days 23 hours'),
      (trip_id, target_user, 'payment_recorded', 'Recorded a EUR 50.00 payment from Luan to Shkelqim', now() - interval '2 hours');
  end if;

  if not exists (
    select 1 from public.trips
    where creator_id = target_user and name = 'Demo: Berlin Weekend'
  ) then
    insert into public.trips
      (name, creator_id, currency, budget, start_date, end_date, current_day, emoji, status, created_at)
    values
      ('Demo: Berlin Weekend', target_user, 'EUR', 900, date '2026-09-11', date '2026-09-13', 1, '🎉', 'active', now() - interval '2 days')
    returning id into trip_id;

    insert into public.trip_members (trip_id, user_id, role)
    values (trip_id, target_user, 'creator');
    insert into public.members (trip_id, user_id, name)
    values (trip_id, target_user, 'Shkelqim') returning id into me_id;
    insert into public.members (trip_id, name)
    values (trip_id, 'Mia') returning id into member_2;

    insert into public.expenses
      (trip_id, title, amount, currency, original_amount, exchange_rate, paid_by, created_by, created_by_name, day_number, category, split_type, note, created_at)
    values
      (trip_id, 'Hotel booking', 320, 'EUR', 320, 1, me_id, target_user, 'Shkelqim', 1, 'hotel', 'equal', 'Two nights', now() - interval '2 days')
    returning id into expense_id;
    insert into public.expense_splits (expense_id, member_id, share_amount)
    values (expense_id, me_id, 160), (expense_id, member_2, 160);

    insert into public.expenses
      (trip_id, title, amount, currency, original_amount, exchange_rate, paid_by, created_by, created_by_name, day_number, category, split_type, note, created_at)
    values
      (trip_id, 'Train tickets', 78, 'EUR', 78, 1, member_2, target_user, 'Shkelqim', 1, 'transport', 'equal', null, now() - interval '1 day 22 hours')
    returning id into expense_id;
    insert into public.expense_splits (expense_id, member_id, share_amount)
    values (expense_id, me_id, 39), (expense_id, member_2, 39);

    insert into public.expenses
      (trip_id, title, amount, currency, original_amount, exchange_rate, paid_by, created_by, created_by_name, day_number, category, split_type, note, created_at)
    values
      (trip_id, 'Museum passes', 36, 'EUR', 36, 1, me_id, target_user, 'Shkelqim', 1, 'activities', 'exact', 'Shkelqim 20, Mia 16', now() - interval '1 day')
    returning id into expense_id;
    insert into public.expense_splits (expense_id, member_id, share_amount)
    values (expense_id, me_id, 20), (expense_id, member_2, 16);

    insert into public.activity_log (trip_id, user_id, action, description, created_at)
    values
      (trip_id, target_user, 'trip_created', 'Created Demo: Berlin Weekend', now() - interval '2 days'),
      (trip_id, target_user, 'member_added', 'Added Mia', now() - interval '1 day 23 hours');
  end if;

  if not exists (
    select 1 from public.trips
    where creator_id = target_user and name = 'Demo: Lake Como'
  ) then
    insert into public.trips
      (name, creator_id, currency, budget, start_date, end_date, current_day, emoji, status, created_at)
    values
      ('Demo: Lake Como', target_user, 'EUR', 1400, date '2026-07-03', date '2026-07-06', 4, '🏔️', 'ended', now() - interval '54 days')
    returning id into trip_id;

    insert into public.trip_members (trip_id, user_id, role)
    values (trip_id, target_user, 'creator');
    insert into public.members (trip_id, user_id, name)
    values (trip_id, target_user, 'Shkelqim') returning id into me_id;
    insert into public.members (trip_id, name)
    values (trip_id, 'Elira') returning id into member_2;
    insert into public.members (trip_id, name)
    values (trip_id, 'Noel') returning id into member_3;

    insert into public.expenses
      (trip_id, title, amount, currency, original_amount, exchange_rate, paid_by, created_by, created_by_name, day_number, category, split_type, note, created_at)
    values
      (trip_id, 'Lakeside stay', 540, 'EUR', 540, 1, me_id, target_user, 'Shkelqim', 1, 'hotel', 'equal', 'Three nights', now() - interval '53 days')
    returning id into expense_id;
    insert into public.expense_splits (expense_id, member_id, share_amount)
    values (expense_id, me_id, 180), (expense_id, member_2, 180), (expense_id, member_3, 180);

    insert into public.expenses
      (trip_id, title, amount, currency, original_amount, exchange_rate, paid_by, created_by, created_by_name, day_number, category, split_type, note, created_at)
    values
      (trip_id, 'Ferry tickets', 72, 'EUR', 72, 1, member_2, target_user, 'Shkelqim', 2, 'transport', 'equal', null, now() - interval '52 days')
    returning id into expense_id;
    insert into public.expense_splits (expense_id, member_id, share_amount)
    values (expense_id, me_id, 24), (expense_id, member_2, 24), (expense_id, member_3, 24);

    insert into public.expenses
      (trip_id, title, amount, currency, original_amount, exchange_rate, paid_by, created_by, created_by_name, day_number, category, split_type, note, created_at)
    values
      (trip_id, 'Dinner by the lake', 126, 'EUR', 126, 1, member_3, target_user, 'Shkelqim', 3, 'food', 'equal', null, now() - interval '51 days')
    returning id into expense_id;
    insert into public.expense_splits (expense_id, member_id, share_amount)
    values (expense_id, me_id, 42), (expense_id, member_2, 42), (expense_id, member_3, 42);

    insert into public.expenses
      (trip_id, title, amount, currency, original_amount, exchange_rate, paid_by, created_by, created_by_name, day_number, category, split_type, note, created_at)
    values
      (trip_id, 'Villa tour', 90, 'EUR', 90, 1, me_id, target_user, 'Shkelqim', 4, 'activities', 'equal', null, now() - interval '50 days')
    returning id into expense_id;
    insert into public.expense_splits (expense_id, member_id, share_amount)
    values (expense_id, me_id, 30), (expense_id, member_2, 30), (expense_id, member_3, 30);

    insert into public.payments (trip_id, from_member, to_member, amount, note, day_number, paid_at)
    values
      (trip_id, member_2, me_id, 120, 'Final trip settlement', 4, now() - interval '49 days'),
      (trip_id, member_3, me_id, 80, 'Final trip settlement', 4, now() - interval '49 days');

    insert into public.activity_log (trip_id, user_id, action, description, created_at)
    values
      (trip_id, target_user, 'trip_created', 'Created Demo: Lake Como', now() - interval '54 days'),
      (trip_id, target_user, 'trip_ended', 'Ended Demo: Lake Como', now() - interval '49 days');
  end if;
end
$seed$;

select
  t.id,
  t.name,
  t.status,
  t.currency,
  (select count(*) from public.members m where m.trip_id = t.id) as members,
  (select count(*) from public.expenses e where e.trip_id = t.id) as expenses,
  (select coalesce(sum(e.amount), 0) from public.expenses e where e.trip_id = t.id) as preview_total
from public.trips t
where t.creator_id = 'ee06bc9c-209c-4aa4-94a4-8c38b61602fd'
  and t.name like 'Demo:%'
order by t.created_at desc;
