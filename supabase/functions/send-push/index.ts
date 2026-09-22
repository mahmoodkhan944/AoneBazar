// supabase/functions/send-push/index.ts
//
// Sends a real Web Push notification to every device a customer has
// enabled "Order Updates" on. This is the ONLY place the VAPID
// PRIVATE key is ever used — it lives in this function's own secrets
// (set via `supabase secrets set`), never in any file shipped to the
// browser.
//
// Called from the admin panel (js/admin.js) whenever an order's
// status changes, with a body like:
//   { "customer_id": "...", "title": "...", "body": "...", "url": "/index.html" }
//
// Deploy (from the project's root folder, once the Supabase CLI is
// installed and you've run `supabase login` and `supabase link`):
//
//   supabase secrets set VAPID_PUBLIC_KEY="BC6MXL7JZJZB4nZaaxCrEsUTHIrI8iXJTOtRC4t85BKDnZJq9l7Qr1OkLKhre_cknobEFHCoVvn-rx9ZJF9UQHQ"
//   supabase secrets set VAPID_PRIVATE_KEY="-9G6WpAoDRd5eDvHp0gDYVf_UalzcNZwUANo2wZ2ees"
//   supabase secrets set VAPID_SUBJECT="mailto:you@example.com"
//   supabase functions deploy send-push
//
// (SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are already available
// automatically inside every Edge Function — no need to set those
// yourself.)

import { createClient } from "npm:@supabase/supabase-js@2";
import webPush from "npm:web-push@3";

const supabaseAdmin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

webPush.setVapidDetails(
  Deno.env.get("VAPID_SUBJECT") || "mailto:admin@aonebazar.co.in",
  Deno.env.get("VAPID_PUBLIC_KEY")!,
  Deno.env.get("VAPID_PRIVATE_KEY")!
);

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  try {
    const { customer_id, title, body, url } = await req.json();

    if (!customer_id || !title) {
      return new Response(JSON.stringify({ error: "customer_id and title are required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" }
      });
    }

    const { data: subs, error: fetchError } = await supabaseAdmin
      .from("push_subscriptions")
      .select("*")
      .eq("customer_id", customer_id);

    if (fetchError) throw fetchError;

    if (!subs || subs.length === 0) {
      return new Response(JSON.stringify({ sent: 0, note: "This customer has no push subscriptions" }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    }

    const payload = JSON.stringify({ title, body: body || "", url: url || "/index.html" });

    let sent = 0;
    const staleEndpoints: string[] = [];

    for (const sub of subs) {
      try {
        await webPush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: { p256dh: sub.p256dh, auth: sub.auth_key }
          },
          payload
        );
        sent++;
      } catch (err) {
        // 404/410 means the subscription is dead (browser data
        // cleared, uninstalled, etc.) — clean it up so future sends
        // don't keep retrying it.
        if (err.statusCode === 404 || err.statusCode === 410) {
          staleEndpoints.push(sub.endpoint);
        } else {
          console.error("Push send failed:", sub.endpoint, err.message);
        }
      }
    }

    if (staleEndpoints.length > 0) {
      await supabaseAdmin.from("push_subscriptions").delete().in("endpoint", staleEndpoints);
    }

    return new Response(JSON.stringify({ sent, removed_stale: staleEndpoints.length }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  } catch (err) {
    console.error(err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
});