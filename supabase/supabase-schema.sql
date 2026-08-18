-- ===========================================================
--  AONE BAZAAR — SUPABASE SCHEMA (Supabase Auth edition)
--  Paste this whole file into Supabase → SQL Editor → Run
--  Safe to re-run: uses IF NOT EXISTS / CREATE OR REPLACE.
--
--  Firebase has been fully removed. Login (customer phone OTP
--  via Twilio, and admin email/password) now runs on Supabase
--  Auth, so RLS can use auth.uid() directly — no custom JWT
--  bridging needed.
-- ===========================================================

-- -----------------------------------------------------------
-- EXTENSIONS
-- -----------------------------------------------------------
create extension if not exists "pgcrypto";

-- NOTE: This file is fully idempotent — every "create table" below
-- uses "if not exists", so running this file again on a live project
-- will NOT touch, drop, or reset anything that already exists
-- (including profiles/admin roles, products, orders, etc.). It only
-- fills in whatever is missing. There is no destructive "clean
-- slate" step anymore — an earlier version of this file had one,
-- and running it wiped out admin role assignments each time.

-- -----------------------------------------------------------
-- 1. PROFILES
--    One row per Supabase Auth user (auth.users). role decides
--    admin vs customer. A row is created automatically the
--    moment someone signs up (see trigger below).
-- -----------------------------------------------------------
create table if not exists profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  phone text,
  email text,
  full_name text,
  role text not null default 'customer' check (role in ('customer', 'admin')),
  created_at timestamptz not null default now()
);

-- Auto-create a profile row whenever someone signs up
create or replace function handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  requested_role text;
begin
  -- Lets you decide admin vs customer right when adding the user in
  -- Authentication → Users → Add user, via the "User Metadata" field:
  -- {"role": "admin"}  — no separate SQL step needed afterward.
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

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function handle_new_user();

-- Keep email in sync if it changes later
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

-- -----------------------------------------------------------
-- 2. STORES / CATEGORIES
-- -----------------------------------------------------------
create table if not exists categories (
  id uuid primary key default gen_random_uuid(),
  store text not null check (store in ('supermarket', 'grocery', 'cafe')),
  name text not null,
  created_at timestamptz not null default now(),
  unique (store, name)
);

-- -----------------------------------------------------------
-- 3. PRODUCTS
-- -----------------------------------------------------------
create table if not exists products (
  id uuid primary key default gen_random_uuid(),
  store text not null check (store in ('supermarket', 'grocery', 'cafe')),
  category text not null,
  name text not null,
  price numeric(10, 2) not null check (price >= 0),
  images text[] not null default '{}',
  variants jsonb not null default '[]'::jsonb, -- e.g. [{"label":"250g","price":40},{"label":"1kg","price":140}]
  in_stock boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_products_store on products (store);
create index if not exists idx_products_category on products (store, category);
create index if not exists idx_products_name_search on products using gin (to_tsvector('english', name));

-- -----------------------------------------------------------
-- 4. COUPONS
-- -----------------------------------------------------------
create table if not exists coupons (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  discount_type text not null check (discount_type in ('percent', 'flat')),
  discount_value numeric(10, 2) not null check (discount_value > 0),
  min_order numeric(10, 2) not null default 0,
  usage_limit integer,
  used_count integer not null default 0,
  active boolean not null default true,
  expires_at timestamptz,
  created_at timestamptz not null default now()
);

-- -----------------------------------------------------------
-- 5. ORDERS
-- -----------------------------------------------------------
create table if not exists orders (
  id text primary key,                 -- e.g. ORD1755...
  invoice_no text unique not null,
  customer_id uuid references auth.users (id),
  customer_phone text not null,
  customer_name text not null,
  address text not null,
  items jsonb not null,                -- [{id,name,price,qty}, ...]
  subtotal numeric(10, 2) not null,
  coupon_code text,
  discount numeric(10, 2) not null default 0,
  total numeric(10, 2) not null,
  payment text not null default 'COD',
  status text not null default 'NEW' check (status in ('NEW', 'PROCESSING', 'DELIVERED', 'CANCELLED')),
  created_at timestamptz not null default now()
);

create index if not exists idx_orders_customer on orders (customer_id);
create index if not exists idx_orders_status on orders (status);

-- -----------------------------------------------------------
-- 6. REVIEWS
-- -----------------------------------------------------------
create table if not exists reviews (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products (id) on delete cascade,
  customer_id uuid not null references auth.users (id),
  customer_name text not null,
  rating integer not null check (rating between 1 and 5),
  comment text,
  created_at timestamptz not null default now(),
  unique (product_id, customer_id)
);

create index if not exists idx_reviews_product on reviews (product_id);

-- -----------------------------------------------------------
-- 7. WISHLIST
-- -----------------------------------------------------------
create table if not exists wishlists (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references auth.users (id),
  product_id uuid not null references products (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (customer_id, product_id)
);

create index if not exists idx_wishlists_customer on wishlists (customer_id);

-- -----------------------------------------------------------
-- HELPER VIEW: average rating per product
-- -----------------------------------------------------------
create or replace view product_ratings as
select
  product_id,
  round(avg(rating)::numeric, 1) as avg_rating,
  count(*) as review_count
from reviews
group by product_id;

-- -----------------------------------------------------------
-- updated_at auto-touch trigger for products
-- -----------------------------------------------------------
create or replace function touch_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_products_updated_at on products;
create trigger trg_products_updated_at
before update on products
for each row execute function touch_updated_at();

-- ===========================================================
--  ROW LEVEL SECURITY
--  Everything below uses auth.uid() — Supabase's own, native
--  concept of "who is calling this" once someone is signed in
--  via supabase.auth (phone OTP for customers, email/password
--  for admin). No custom token bridging required.
-- ===========================================================

alter table categories enable row level security;
alter table products enable row level security;
alter table coupons enable row level security;
alter table orders enable row level security;
alter table reviews enable row level security;
alter table wishlists enable row level security;
alter table profiles enable row level security;

-- Helper: is the current user an admin?
create or replace function is_admin()
returns boolean
language sql stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from profiles
    where id = auth.uid()
      and role = 'admin'
  )
$$;

-- ---- categories: public read, admin write ----
drop policy if exists "public read categories" on categories;
create policy "public read categories" on categories for select using (true);
drop policy if exists "admin write categories" on categories;
create policy "admin write categories" on categories for all
  using (is_admin()) with check (is_admin());

-- ---- products: public read, admin write ----
drop policy if exists "public read products" on products;
create policy "public read products" on products for select using (true);
drop policy if exists "admin write products" on products;
create policy "admin write products" on products for all
  using (is_admin()) with check (is_admin());

-- ---- coupons: public read active ones, admin manages all ----
drop policy if exists "public read active coupons" on coupons;
create policy "public read active coupons" on coupons for select
  using (active = true or is_admin());
drop policy if exists "admin write coupons" on coupons;
create policy "admin write coupons" on coupons for all
  using (is_admin()) with check (is_admin());

-- ---- orders: a customer sees/creates only their own; admin sees/updates all ----
drop policy if exists "customer insert own order" on orders;
create policy "customer insert own order" on orders for insert
  with check (customer_id = auth.uid());
drop policy if exists "customer read own orders" on orders;
create policy "customer read own orders" on orders for select
  using (customer_id = auth.uid() or is_admin());
drop policy if exists "admin update orders" on orders;
create policy "admin update orders" on orders for update
  using (is_admin()) with check (is_admin());

-- ---- reviews: public read, customer writes/edits their own ----
drop policy if exists "public read reviews" on reviews;
create policy "public read reviews" on reviews for select using (true);
drop policy if exists "customer write own review" on reviews;
create policy "customer write own review" on reviews for insert
  with check (customer_id = auth.uid());
drop policy if exists "customer update own review" on reviews;
create policy "customer update own review" on reviews for update
  using (customer_id = auth.uid())
  with check (customer_id = auth.uid());
drop policy if exists "customer delete own review" on reviews;
create policy "customer delete own review" on reviews for delete
  using (customer_id = auth.uid() or is_admin());

-- ---- wishlists: fully private to the owning customer ----
drop policy if exists "customer manage own wishlist" on wishlists;
create policy "customer manage own wishlist" on wishlists for all
  using (customer_id = auth.uid())
  with check (customer_id = auth.uid());

-- ---- profiles: read your own (or admin reads all); update your own
--      fields, but role can only be changed by an admin ----
drop policy if exists "self read profile" on profiles;
create policy "self read profile" on profiles for select
  using (id = auth.uid() or is_admin());
drop policy if exists "self update profile" on profiles;
create policy "self update profile" on profiles for update
  using (id = auth.uid() or is_admin())
  with check (id = auth.uid() or is_admin());

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

drop trigger if exists trg_prevent_role_self_escalation on profiles;
create trigger trg_prevent_role_self_escalation
before update on profiles
for each row execute function prevent_role_self_escalation();

-- Easiest way to grant admin: by email, no UUID hunting needed.
-- Locked down so only the SQL Editor (not the app/API) can call it.
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

revoke all on function make_admin(text) from public, anon, authenticated;

-- Usage from the SQL Editor:
--   select make_admin('your-admin-email@example.com');

-- ===========================================================
--  COUPON HELPERS (RPC functions)
-- ===========================================================

create table if not exists coupon_redemptions (
  id uuid primary key default gen_random_uuid(),
  coupon_code text not null,
  customer_id uuid not null references auth.users (id) on delete cascade,
  redeemed_at timestamptz not null default now(),
  unique (coupon_code, customer_id)
);

alter table coupon_redemptions enable row level security;

drop policy if exists "admin read coupon redemptions" on coupon_redemptions;
create policy "admin read coupon redemptions" on coupon_redemptions for select
  using (is_admin());

create or replace function validate_coupon(p_code text, p_order_total numeric)
returns table (
  code text,
  discount_type text,
  discount_value numeric,
  discount_amount numeric
)
language plpgsql
security definer
set search_path = public
as $$
declare
  c coupons%rowtype;
  amount numeric;
begin
  select * into c from coupons
    where coupons.code = upper(p_code)
      and active = true
    limit 1;

  if not found then
    raise exception 'Invalid or inactive coupon code';
  end if;

  if c.expires_at is not null and c.expires_at < now() then
    raise exception 'This coupon has expired';
  end if;

  if c.usage_limit is not null and c.used_count >= c.usage_limit then
    raise exception 'This coupon has reached its usage limit';
  end if;

  if p_order_total < c.min_order then
    raise exception 'Minimum order for this coupon is ₹%', c.min_order;
  end if;

  if auth.uid() is not null and exists (
    select 1 from coupon_redemptions
    where coupon_code = c.code and customer_id = auth.uid()
  ) then
    raise exception 'You''ve already used this coupon';
  end if;

  if c.discount_type = 'percent' then
    amount := round(p_order_total * c.discount_value / 100, 2);
  else
    amount := c.discount_value;
  end if;

  amount := least(amount, p_order_total);

  return query select c.code, c.discount_type, c.discount_value, amount;
end;
$$;

grant execute on function validate_coupon(text, numeric) to anon, authenticated;

create or replace function redeem_coupon(p_code text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update coupons
    set used_count = used_count + 1
    where code = upper(p_code)
      and active = true
      and (usage_limit is null or used_count < usage_limit);

  if not found then
    raise exception 'Coupon could not be redeemed';
  end if;

  if auth.uid() is not null then
    insert into coupon_redemptions (coupon_code, customer_id)
    values (upper(p_code), auth.uid());
  end if;
end;
$$;

grant execute on function redeem_coupon(text) to anon, authenticated;

create or replace function uppercase_coupon_code()
returns trigger
language plpgsql
as $$
begin
  new.code = upper(new.code);
  return new;
end;
$$;

drop trigger if exists trg_coupon_uppercase on coupons;
create trigger trg_coupon_uppercase
before insert or update on coupons
for each row execute function uppercase_coupon_code();

-- ===========================================================
--  ADMIN DASHBOARD DATA FUNCTIONS
-- ===========================================================

create or replace function get_admin_dashboard_stats()
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  result json;
begin
  if not is_admin() then
    raise exception 'Admin only';
  end if;

  select json_build_object(
    'today_sales', coalesce((
      select sum(total) from orders where created_at::date = current_date
    ), 0),
    'today_orders', coalesce((
      select count(*) from orders where created_at::date = current_date
    ), 0),
    'total_orders', (select count(*) from orders),
    'total_revenue', coalesce((select sum(total) from orders), 0),
    'pending_orders', (select count(*) from orders where status in ('NEW','PROCESSING')),
    'total_products', (select count(*) from products),
    'orders_last_7_days', (
      select coalesce(json_agg(row_to_json(d)), '[]'::json) from (
        select
          to_char(day, 'Dy') as label,
          coalesce(o.count, 0) as count
        from generate_series(current_date - interval '6 days', current_date, interval '1 day') as day
        left join (
          select created_at::date as d, count(*) as count
          from orders
          where created_at::date >= current_date - interval '6 days'
          group by created_at::date
        ) o on o.d = day::date
        order by day
      ) d
    ),
    'products_by_store', (
      select coalesce(json_agg(row_to_json(s)), '[]'::json) from (
        select
          store,
          count(*) filter (where in_stock) as active_count,
          count(*) filter (where not in_stock) as inactive_count
        from products
        group by store
        order by store
      ) s
    ),
    'orders_by_status', (
      select coalesce(json_agg(row_to_json(s)), '[]'::json) from (
        select status, count(*) as count
        from orders
        group by status
        order by status
      ) s
    )
  ) into result;

  return result;
end;
$$;

grant execute on function get_admin_dashboard_stats() to authenticated;

create or replace function get_top_products(p_limit int default 5)
returns table(name text, total_qty bigint, total_revenue numeric)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_admin() then
    raise exception 'Admin only';
  end if;

  return query
  select
    (item ->> 'name')::text as name,
    sum((item ->> 'qty')::int)::bigint as total_qty,
    sum((item ->> 'price')::numeric * (item ->> 'qty')::int) as total_revenue
  from orders, jsonb_array_elements(items) as item
  group by item ->> 'name'
  order by total_qty desc
  limit p_limit;
end;
$$;

grant execute on function get_top_products(int) to authenticated;

-- ===========================================================
--  STORAGE: product images bucket
-- ===========================================================
insert into storage.buckets (id, name, public)
values ('product-images', 'product-images', true)
on conflict (id) do nothing;

drop policy if exists "public read product images" on storage.objects;
create policy "public read product images"
on storage.objects for select
using (bucket_id = 'product-images');

drop policy if exists "admin upload product images" on storage.objects;
create policy "admin upload product images"
on storage.objects for insert
with check (bucket_id = 'product-images' and is_admin());

drop policy if exists "admin update product images" on storage.objects;
create policy "admin update product images"
on storage.objects for update
using (bucket_id = 'product-images' and is_admin());

drop policy if exists "admin delete product images" on storage.objects;
create policy "admin delete product images"
on storage.objects for delete
using (bucket_id = 'product-images' and is_admin());

-- ===========================================================
--  SITE CONTENT (simple key → value CMS)
--  Lets the admin edit homepage/about/contact text and the
--  promo banner without touching code.
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
  ('contact_address', 'Master Naseem Complex, Lahideeh Bazar, Azamgarh'),
  ('upi_id', '')
on conflict (key) do nothing;

-- ===========================================================
--  SEED DATA
-- ===========================================================
insert into coupons (code, discount_type, discount_value, min_order, usage_limit)
values ('WELCOME50', 'flat', 50, 200, 100)
on conflict (code) do nothing;

insert into categories (store, name) values
  ('supermarket', 'Packaged Foods'),
  ('supermarket', 'Household'),
  ('grocery', 'Atta, Rice & Dal'),
  ('grocery', 'Masale & Oil'),
  ('cafe', 'Hot Beverages'),
  ('cafe', 'Snacks')
on conflict (store, name) do nothing;
