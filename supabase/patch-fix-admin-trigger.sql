-- ===========================================================
--  PATCH: fix prevent_role_self_escalation trigger
--  Problem: this trigger was blocking YOUR OWN manual
--  "update profiles set role='admin'" run from the SQL Editor,
--  not just self-promotion attempts from the app.
--  Run this once in Supabase → SQL Editor.
-- ===========================================================

create or replace function prevent_role_self_escalation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Only enforce this for requests that came through the app with a
  -- logged-in user (auth.uid() is set). Direct SQL run from the
  -- Supabase SQL Editor / service role has no auth.uid(), so the
  -- project owner can still grant admin manually there.
  if auth.uid() is not null and not is_admin() then
    new.role := old.role;
  end if;
  return new;
end;
$$;

-- Now actually grant yourself admin (replace with your real uuid,
-- found in Authentication → Users):
-- update profiles set role = 'admin' where id = 'YOUR-UUID-HERE';
