-- ===========================================================
--  PATCH: admin dashboard data functions
--  Run once in Supabase → SQL Editor.
-- ===========================================================

-- Headline numbers + last-7-days order counts for the dashboard.
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
    )
  ) into result;

  return result;
end;
$$;

grant execute on function get_admin_dashboard_stats() to authenticated;

-- Best-selling products, computed from the items stored on every order.
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
