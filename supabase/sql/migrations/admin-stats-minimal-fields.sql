-- Limits admin statistics to the fields the admin screen shows.
-- Apply once in the production Supabase SQL Editor; replaces only public.admin_stats().
begin;

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

revoke all on function public.admin_stats() from public, anon, authenticated;
grant execute on function public.admin_stats() to authenticated;

commit;
