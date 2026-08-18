-- ===========================================================
--  DIAGNOSTIC: run these one at a time in Supabase SQL Editor
-- ===========================================================

-- STEP 1: Make sure the trigger patch actually ran (safe to re-run)
create or replace function prevent_role_self_escalation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is not null and not is_admin() then
    new.role := old.role;
  end if;
  return new;
end;
$$;

-- STEP 2: Does this user even exist in auth.users?
select id, email, phone, created_at
from auth.users
where id = '6a6ba4d9-f0d4-4c2b-bef2-6f17a8e9ab31';

-- STEP 3: Does a matching row exist in profiles?
select id, phone, full_name, role
from profiles
where id = '6a6ba4d9-f0d4-4c2b-bef2-6f17a8e9ab31';

-- STEP 4: If step 3 returned ZERO rows, the profile was never
-- created (the auto-create trigger didn't fire for this user).
-- This creates it directly as admin — safe to run even if a row
-- already exists, it'll just update it:
insert into profiles (id, role)
values ('6a6ba4d9-f0d4-4c2b-bef2-6f17a8e9ab31', 'admin')
on conflict (id) do update set role = 'admin';

-- STEP 5: Confirm
select id, phone, role
from profiles
where id = '6a6ba4d9-f0d4-4c2b-bef2-6f17a8e9ab31';
