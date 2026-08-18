-- ===========================================================
--  PATCH: fix make_admin (case-insensitive email + diagnostics)
--  Run this whole file in Supabase → SQL Editor.
-- ===========================================================

-- Case-insensitive + trims stray spaces, which is the most common
-- reason "no user found" fires even though the account exists.
create or replace function make_admin(p_email text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  target_id uuid;
begin
  select id into target_id
  from auth.users
  where lower(email) = lower(trim(p_email))
  limit 1;

  if target_id is null then
    raise exception 'No user found with email %. Make sure they show up under Authentication → Users first.', p_email;
  end if;

  insert into profiles (id, role)
  values (target_id, 'admin')
  on conflict (id) do update set role = 'admin';

  return 'Done — ' || p_email || ' is now an admin.';
end;
$$;

revoke all on function make_admin(text) from public, anon, authenticated;

-- ===========================================================
--  Run this next, with the real email — replace the text below:
-- ===========================================================
select make_admin('PASTE_THE_EMAIL_HERE');

-- ===========================================================
--  If that still errors, run these one at a time to see what's
--  actually going on:
-- ===========================================================

-- 1) Does this email exist in auth.users at all? (case-insensitive)
-- select id, email, created_at from auth.users where lower(email) = lower('PASTE_THE_EMAIL_HERE');

-- 2) List every user, so you can copy the exact email as stored:
-- select id, email from auth.users order by created_at desc;

-- 3) Check the profile + role directly once you have the id:
-- select * from profiles where id = 'PASTE_UUID_HERE';
