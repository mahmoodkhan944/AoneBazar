-- ===========================================================
--  PATCH: dashboard breakdowns — active products per store,
--  and orders grouped by status. Run once in SQL Editor.
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
