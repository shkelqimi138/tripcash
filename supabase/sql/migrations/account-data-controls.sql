-- TripCash account-data controls migration.
-- Apply once to the intended project through the reviewed Supabase migration workflow.

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

  update public.trips set status = 'ended', creator_id = null where creator_id = requesting_user;
  update public.expenses set created_by = null, created_by_name = 'TripCash user' where created_by = requesting_user;
  update public.activity_log set user_id = null, description = 'Activity by an anonymized TripCash user' where user_id = requesting_user;
  update public.members set user_id = null, name = 'TripCash user', paypal_link = null where user_id = requesting_user;
  delete from public.trip_members where user_id = requesting_user;
  delete from public.contacts where owner_id = requesting_user;
  update public.profiles
  set display_name = 'TripCash user', username = null, avatar_url = null,
      paypal_link = null, home_currency = 'EUR', default_split = 'equal',
      theme_preference = 'system', preferences_initialized = false
  where id = requesting_user;
end;
$$;

revoke all on function public.delete_current_user_data() from public, anon, authenticated;
grant execute on function public.delete_current_user_data() to authenticated;
