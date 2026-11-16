// POST { orderId } -> { payment_session_id, mode }
// The order row must already exist in Supabase (created by the
// browser). Amount is taken from that row, not from the request.
const cf = require("./_cashfree");

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const envErr = cf.checkEnv();
  if (envErr) return res.status(500).json({ error: envErr });

  try {
    const { orderId } = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
    if (!orderId) return res.status(400).json({ error: "orderId required" });

    const row = await cf.getOrderRow(orderId);
    if (!row) return res.status(404).json({ error: "Order not found" });
    if (row.payment_status === "paid") return res.status(200).json({ alreadyPaid: true });

    const mode = process.env.CASHFREE_ENV === "production" ? "production" : "sandbox";
    const proto = req.headers["x-forwarded-proto"] || "https";
    const origin = `${proto}://${req.headers.host}`;
    const phone = String(row.customer_phone || "").replace(/\D/g, "").slice(-10);

    const r = await fetch(`${cf.CF_BASE}/orders`, {
      method: "POST",
      headers: cf.cfHeaders(),
      body: JSON.stringify({
        order_id: row.id,
        order_amount: cf.amountDue(row),
        order_currency: "INR",
        customer_details: {
          customer_id: "C" + phone,
          customer_phone: phone,
          customer_name: row.customer_name
        },
        order_meta: {
          return_url: `${origin}/index.html?cf_order_id={order_id}`,
          notify_url: `${origin}/api/cashfree-webhook`
        }
      })
    });
    let data = await r.json();

    // Order already exists at Cashfree (customer retrying) -> reuse it.
    if (!r.ok && (data.code === "order_already_exists" || r.status === 409)) {
      const existing = await cf.cfGetOrder(row.id);
      data = existing.body;
      if (data.order_status === "PAID") {
        await cf.verifyAndSync(row.id);
        return res.status(200).json({ alreadyPaid: true });
      }
    } else if (!r.ok) {
      return res.status(502).json({ error: data.message || "Cashfree error" });
    }

    if (!data.payment_session_id) return res.status(502).json({ error: "No payment session returned" });
    return res.status(200).json({ payment_session_id: data.payment_session_id, mode });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};