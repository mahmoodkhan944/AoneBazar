-- ===========================================================
--  PATCH: one coupon use per customer
--  Run once in Supabase → SQL Editor.
-- ===========================================================

create table if not exists coupon_redemptions (
  id uuid primary key default gen_random_uuid(),
  coupon_code text not null,
  customer_id uuid not null references auth.users (id) on delete cascade,
  redeemed_at timestamptz not null default now(),
  unique (coupon_code, customer_id)
);

alter table coupon_redemptions enable row level security;

-- No direct client access — only the SECURITY DEFINER functions
-- below touch this table. Admins can still see it if needed.
drop policy if exists "admin read coupon redemptions" on coupon_redemptions;
create policy "admin read coupon redemptions" on coupon_redemptions for select
  using (is_admin());

-- Re-check a coupon: now also blocks a customer who already used it.
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

-- Actually consuming a coupon now also records who used it — the
-- unique constraint on coupon_redemptions is a hard backstop even
-- if two tabs somehow race past the check above.
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
