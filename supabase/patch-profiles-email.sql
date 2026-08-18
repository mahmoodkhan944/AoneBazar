-- ===========================================================
--  PATCH: add email to profiles + keep it in sync
--  Lets the admin dashboard show a Users list with email +
--  role, without needing direct access to auth.users (which
--  the anon/authenticated API can't read).
--  Run once in Supabase → SQL Editor.
-- ===========================================================

alter table profiles add column if not exists email text;

-- Backfill existing users
update profiles p
set email = u.email
from auth.users u
where p.id = u.id and p.email is distinct from u.email;

-- Keep it in sync going forward: update handle_new_user() to also
-- store the email at signup time.
create or replace function handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into profiles (id, phone, email, full_name)
  values (new.id, new.phone, new.email, new.raw_user_meta_data ->> 'full_name')
  on conflict (id) do update
    set email = coalesce(excluded.email, profiles.email),
        phone = coalesce(excluded.phone, profiles.phone);
  return new;
end;
$$;

-- Also sync if someone's email changes later (e.g. admin resets it)
create or replace function handle_user_email_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update profiles set email = new.email where id = new.id;
  return new;
end;
$$;

drop trigger if exists on_auth_user_email_updated on auth.users;
create trigger on_auth_user_email_updated
after update of email on auth.users
for each row execute function handle_user_email_change();
