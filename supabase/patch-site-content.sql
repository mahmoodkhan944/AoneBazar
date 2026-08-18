-- ===========================================================
--  PATCH: add site_content table (editable homepage/about/
--  contact text + promo banner). Run once in SQL Editor.
-- ===========================================================

create table if not exists site_content (
  key text primary key,
  value text not null default '',
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_site_content_updated_at on site_content;
create trigger trg_site_content_updated_at
before update on site_content
for each row execute function touch_updated_at();

alter table site_content enable row level security;

drop policy if exists "public read site_content" on site_content;
create policy "public read site_content" on site_content for select using (true);

drop policy if exists "admin write site_content" on site_content;
create policy "admin write site_content" on site_content for all
  using (is_admin()) with check (is_admin());

insert into site_content (key, value) values
  ('hero_title', 'Three stores, one bazaar.'),
  ('hero_subtitle', 'Where would you like to shop today? Pick a store below to browse fresh stock and order in a minute.'),
  ('banner_active', 'false'),
  ('banner_text', 'Free delivery on orders above ₹500 this week!'),
  ('about_intro', 'AOne Bazaar started in Lahideeh, Azamgarh with a simple idea — put the supermarket, the daily kirana shop, and the neighbourhood cafe under one roof, and let people order all of it without leaving home.'),
  ('contact_phone', '+91 8009555567'),
  ('contact_address', 'Master Naseem Complex, Lahideeh Bazar, Azamgarh')
on conflict (key) do nothing;
