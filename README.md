# AOne Bazaar

Multi-store grocery/supermarket/cafe e-commerce website for AOne Bazaar
(Lahideeh, Azamgarh) — built with plain HTML/CSS/JavaScript on the
frontend and [Supabase](https://supabase.com) (Postgres + Auth + Storage)
on the backend.

## Structure

```
├── index.html              Homepage — store picker, mega-menu, hero/banner
├── about.html               About page
├── contact.html             Contact page
├── product.html              Standalone shareable product page
├── admin.html                 Admin dashboard (own login, own page)
├── css/
│   ├── design-system.css     Colors, type, base tokens
│   ├── style.css              Storefront styles
│   └── admin.css               Admin dashboard styles
├── js/
│   ├── supabase-client.js     Supabase client + site-content loader + mobile nav
│   ├── app.js                  Storefront logic (cart, checkout, wishlist, reviews…)
│   └── admin.js                 Admin dashboard logic
├── images/                    Logo assets
├── supabase/                  SQL schema + incremental patch files
└── scripts/                   One-off migration script (Firestore → Supabase)
```

## Setting up the backend

1. Create a Supabase project.
2. Run `supabase/supabase-schema.sql` in the Supabase SQL Editor (fresh
   project only — it's idempotent, but it's meant to be the full base
   schema, not something to layer onto an already-customized database).
3. Update `SUPABASE_URL` / `SUPABASE_ANON_KEY` in `js/supabase-client.js`
   with your own project's values.
4. In Supabase → Authentication → Sign In / Providers, enable:
   - **Anonymous sign-ins** (used for customer checkout)
   - **Email** (used for admin login)
   - Optionally **Phone (Twilio)** if you want OTP-verified customer login
     instead of the current unverified-phone flow.
5. Grant yourself admin access — see `supabase/patch-role-from-metadata.sql`
   for the easiest way (set a `role` in the user's metadata when adding
   them from Authentication → Users → Add user).

## Deploying the frontend

This is a static site — no build step. Deploy the whole folder as-is to
any static host (Netlify, Vercel, GitHub Pages, etc.), or upload it to
your own web server.

## Admin dashboard

Visit `admin.html` directly, or tap the site logo 5 times on the
storefront to be redirected there. Sign in with an account that has
`role = 'admin'` in the `profiles` table.
