-- ===========================================================
--  PATCH: easy admin promotion by email
--  Run this once in Supabase → SQL Editor. After this, making
--  someone admin is just ONE line — no UUID hunting needed:
--
--    select make_admin('their-email@example.com');
--
--  This is locked down so ONLY someone running SQL directly in
--  the dashboard can call it — the website itself (anon/logged-in
--  users) has no permission to call this function, so nobody can
--  self-promote through the app.
-- ===========================================================

create or replace function make_admin(p_email text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  target_id uuid;
begin
  select id into target_id from auth.users where email = p_email;

  if target_id is null then
    raise exception 'No user found with email %. Make sure they have signed up / been added under Authentication → Users first.', p_email;
  end if;

  insert into profiles (id, role)
  values (target_id, 'admin')
  on conflict (id) do update set role = 'admin';

  return 'Done — ' || p_email || ' is now an admin.';
end;
$$;

-- Lock it down: only the project owner (running SQL directly) can
-- call this — the app's anon/authenticated roles get no access.
revoke all on function make_admin(text) from public, anon, authenticated;

-- ===========================================================
--  USAGE — run this next, with the real admin email:
-- ===========================================================
-- select make_admin('your-admin-email@example.com');

-- To check who's currently an admin:
-- select p.id, u.email, p.phone, p.role
-- from profiles p join auth.users u on u.id = p.id
-- where p.role = 'admin';

-- To remove admin access from someone:
-- update profiles set role = 'customer' where id =
--   (select id from auth.users where email = 'someone@example.com');
