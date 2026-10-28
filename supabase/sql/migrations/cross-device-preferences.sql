-- TripCash cross-device profile preferences migration.
-- Apply once in Supabase SQL Editor only after explicit production approval.

begin;

alter table public.profiles
  add column if not exists preferences_initialized boolean not null default false,
  add column if not exists home_currency text,
  add column if not exists default_split text,
  add column if not exists theme_preference text;

update public.profiles
set home_currency = case
      when home_currency in ('EUR', 'USD', 'CHF', 'GBP', 'ALL') then home_currency
      else 'EUR'
    end,
    default_split = case
      when default_split in ('equal', 'exact') then default_split
      else 'equal'
    end,
    theme_preference = case
      when theme_preference in ('system', 'light', 'dark') then theme_preference
      else 'system'
    end;

alter table public.profiles
  alter column home_currency set default 'EUR',
  alter column home_currency set not null,
  alter column default_split set default 'equal',
  alter column default_split set not null,
  alter column theme_preference set default 'system',
  alter column theme_preference set not null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_home_currency_valid') then
    alter table public.profiles add constraint profiles_home_currency_valid
      check (home_currency in ('EUR', 'USD', 'CHF', 'GBP', 'ALL'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'profiles_default_split_valid') then
    alter table public.profiles add constraint profiles_default_split_valid
      check (default_split in ('equal', 'exact'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'profiles_theme_preference_valid') then
    alter table public.profiles add constraint profiles_theme_preference_valid
      check (theme_preference in ('system', 'light', 'dark'));
  end if;
end
$$;

grant update (home_currency, default_split, theme_preference)
  on public.profiles to authenticated;
grant update (preferences_initialized) on public.profiles to authenticated;

commit;
