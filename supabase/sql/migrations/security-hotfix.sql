-- Fix active invite joins after Security Stage 2 hardening.
begin;

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

revoke all on function public.is_trip_joinable(uuid) from public, anon, authenticated;
grant execute on function public.is_trip_joinable(uuid) to authenticated;

drop policy if exists "trip_members_insert" on public.trip_members;
create policy "trip_members_insert" on public.trip_members for insert to authenticated
with check (
  user_id = auth.uid()
  and public.is_trip_joinable(trip_id)
  and (role = 'member' or (role = 'creator' and public.is_trip_creator(trip_id)))
);

commit;
