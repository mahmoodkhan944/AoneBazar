-- ===========================================================
--  PATCH: category groups (for the "All Categories" mega-menu)
--  Run once in Supabase → SQL Editor.
-- ===========================================================

alter table categories add column if not exists group_name text;

-- Backfill sensible group names for the starter categories, if present.
update categories set group_name = 'Breakfast, Dips & Spreads' where store = 'supermarket' and name = 'Packaged Foods' and group_name is null;
update categories set group_name = 'Cleaning & Household' where store = 'supermarket' and name = 'Household' and group_name is null;
update categories set group_name = 'Atta, Rice & Dals' where store = 'grocery' and name = 'Atta, Rice & Dal' and group_name is null;
update categories set group_name = 'Masalas, Oils & Dry Fruits' where store = 'grocery' and name = 'Masale & Oil' and group_name is null;
update categories set group_name = 'Hot & Cold Beverages' where store = 'cafe' and name = 'Hot Beverages' and group_name is null;
update categories set group_name = 'Chips, Biscuits & Namkeens' where store = 'cafe' and name = 'Snacks' and group_name is null;

-- A helper view the mega-menu queries: every category, grouped,
-- with "Other" as the fallback group for anything not assigned yet.
create or replace view category_menu as
select
  id,
  store,
  name,
  coalesce(nullif(group_name, ''), 'Other') as group_name
from categories
order by group_name, store, name;
