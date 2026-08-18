-- ===========================================================
--  PATCH: product variants (pack of 4, 1kg, 250ml, etc.)
--  Run once in Supabase → SQL Editor.
-- ===========================================================

alter table products add column if not exists variants jsonb not null default '[]'::jsonb;

-- variants format: [{"label": "250g", "price": 40}, {"label": "1kg", "price": 140}]
-- When empty, the product just uses its normal single price as before —
-- fully backward compatible with every existing product.
