-- ===========================================================
--  PATCH: remove category groups entirely
--  The "All Categories" mega-menu now groups by store
--  automatically (Supermarket / Grocery / Cafe), sorted
--  alphabetically — nothing for the admin to fill in.
--  Run once in Supabase → SQL Editor.
-- ===========================================================

drop view if exists category_menu;
alter table categories drop column if exists group_name;
