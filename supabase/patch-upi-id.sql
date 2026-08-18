-- ===========================================================
--  PATCH: add upi_id to site_content (used for the half-payment
--  QR code shown at checkout). Run once in Supabase → SQL Editor.
-- ===========================================================

insert into site_content (key, value)
values ('upi_id', '')
on conflict (key) do nothing;
