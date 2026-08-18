-- ===========================================================
--  PATCH: decide admin/customer right when adding the user in
--  Authentication → Users → Add user — no SQL step needed after.
--  Run once in Supabase → SQL Editor.
-- ===========================================================

create or replace function handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  requested_role text;
begin
  requested_role := new.raw_user_meta_data ->> 'role';

  if requested_role is null or requested_role not in ('admin', 'customer') then
    requested_role := 'customer';
  end if;

  insert into profiles (id, phone, email, full_name, role)
  values (new.id, new.phone, new.email, new.raw_user_meta_data ->> 'full_name', requested_role)
  on conflict (id) do update
    set email = coalesce(excluded.email, profiles.email),
        phone = coalesce(excluded.phone, profiles.phone);
  return new;
end;
$$;
