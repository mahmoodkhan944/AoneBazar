// Shared helpers for the Cashfree API routes (files starting with "_"
// are NOT exposed as endpoints by Vercel).
//
// Required env vars (Vercel -> Project -> Settings -> Environment Variables):
//   CASHFREE_APP_ID, CASHFREE_SECRET_KEY
//   CASHFREE_ENV            "sandbox" (default) or "production"
//   SUPABASE_SERVICE_ROLE_KEY   (server only - NEVER put in frontend)
// Optional: SUPABASE_URL (defaults to the project URL below)

const crypto = require("crypto");

const SUPABASE_URL = process.env.SUPABASE_URL || "https://qwqtialuqxnegqkzbtlo.supabase.co";
const CF_BASE = process.env.CASHFREE_ENV === "production"
  ? "https://api.cashfree.com/pg"
  : "https://sandbox.cashfree.com/pg";
const CF_VERSION = "2023-08-01";

function cfHeaders() {
  return {
    "Content-Type": "application/json",
    "x-api-version": CF_VERSION,
    "x-client-id": process.env.CASHFREE_APP_ID,
    "x-client-secret": process.env.CASHFREE_SECRET_KEY
  };
}

function sbHeaders(extra) {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return Object.assign({ apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, extra || {});
}

function checkEnv() {
  const missing = ["CASHFREE_APP_ID", "CASHFREE_SECRET_KEY", "SUPABASE_SERVICE_ROLE_KEY"].filter(k => !process.env[k]);
  return missing.length ? "Missing env vars: " + missing.join(", ") : null;
}

async function getOrderRow(orderId) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/orders?id=eq.${encodeURIComponent(orderId)}&select=*`, { headers: sbHeaders() });
  const rows = await r.json();
  return Array.isArray(rows) ? rows[0] : null;
}

// What the customer must pay online, computed from the stored order
// (never trusted from the browser).
function amountDue(row) {
  const total = Number(row.total);
  return row.payment_option === "full" ? total : Math.ceil(total / 2);
}

async function cfGetOrder(orderId) {
  const r = await fetch(`${CF_BASE}/orders/${encodeURIComponent(orderId)}`, { headers: cfHeaders() });
  return { status: r.status, body: await r.json() };
}

async function cfGetPayments(orderId) {
  const r = await fetch(`${CF_BASE}/orders/${encodeURIComponent(orderId)}/payments`, { headers: cfHeaders() });
  const body = await r.json();
  return Array.isArray(body) ? body : [];
}

// Marks the order paid in Supabase. Idempotent.
async function markPaid(row, cfOrder, cfPaymentId) {
  if (row.payment_status === "paid") return;
  const paid = Number(cfOrder.order_amount);
  const patch = {
    payment_status: "paid",
    payment: "ONLINE",
    amount_paid: paid,
    balance_due: Math.max(0, Number(row.total) - paid),
    cashfree_order_id: cfOrder.cf_order_id ? String(cfOrder.cf_order_id) : row.id,
    cashfree_payment_id: cfPaymentId || null
  };
  const r = await fetch(`${SUPABASE_URL}/rest/v1/orders?id=eq.${encodeURIComponent(row.id)}`, {
    method: "PATCH", headers: sbHeaders({ Prefer: "return=minimal" }), body: JSON.stringify(patch)
  });
  if (!r.ok) throw new Error("Supabase update failed: " + (await r.text()));
}

// Confirms with Cashfree (server-to-server) and updates Supabase.
async function verifyAndSync(orderId) {
  const row = await getOrderRow(orderId);
  if (!row) return { found: false };
  const { body: cfOrder } = await cfGetOrder(orderId);
  const isPaid = cfOrder && cfOrder.order_status === "PAID" &&
    Number(cfOrder.order_amount) === amountDue(row);
  if (isPaid) {
    const payments = await cfGetPayments(orderId);
    const ok = payments.find(p => p.payment_status === "SUCCESS");
    await markPaid(row, cfOrder, ok ? String(ok.cf_payment_id) : null);
  }
  return { found: true, paid: !!isPaid, status: cfOrder && cfOrder.order_status, row };
}

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", c => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function verifyWebhookSignature(rawBody, timestamp, signature) {
  const expected = crypto.createHmac("sha256", process.env.CASHFREE_SECRET_KEY)
    .update(timestamp + rawBody).digest("base64");
  const a = Buffer.from(expected), b = Buffer.from(signature || "");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

module.exports = { CF_BASE, cfHeaders, checkEnv, getOrderRow, amountDue, cfGetOrder, verifyAndSync, readRawBody, verifyWebhookSignature };