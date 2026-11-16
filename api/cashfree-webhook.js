// Cashfree -> us. Safety net in case the customer closes the tab
// right after paying. Signature verified with HMAC-SHA256.
// Set this URL in Cashfree dashboard -> Developers -> Webhooks:
//   https://aonebazar.co.in/api/cashfree-webhook
const cf = require("./_cashfree");

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).end();
  const envErr = cf.checkEnv();
  if (envErr) return res.status(500).end();
  try {
    const raw = await cf.readRawBody(req);
    const ts = req.headers["x-webhook-timestamp"];
    const sig = req.headers["x-webhook-signature"];
    if (!ts || !sig || !cf.verifyWebhookSignature(raw, ts, sig)) return res.status(401).end();

    const event = JSON.parse(raw);
    const orderId = event && event.data && event.data.order && event.data.order.order_id;
    if (orderId && event.type === "PAYMENT_SUCCESS_WEBHOOK") await cf.verifyAndSync(orderId);
    return res.status(200).end();
  } catch (e) {
    return res.status(500).end();
  }
};
// Need the raw body for signature verification.
module.exports.config = { api: { bodyParser: false } };