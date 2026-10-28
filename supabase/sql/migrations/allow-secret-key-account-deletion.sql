-- Allows only the granted service role to call account deletion with current Supabase secret keys.
begin;

create or replace function public.delete_user_by_id(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.trips set status = 'ended'
  where creator_id = p_user_id and status = 'active';
  update public.expenses set created_by_name = 'Deleted user'
  where created_by = p_user_id;
  update public.members set name = 'Deleted user', paypal_link = null
  where user_id = p_user_id;
  delete from auth.users where id = p_user_id;
end;
$$;

revoke all on function public.delete_user_by_id(uuid) from public, anon, authenticated;
grant execute on function public.delete_user_by_id(uuid) to service_role;

commit;
