// POST { orderId } -> { paid, status }. Asks Cashfree directly and
// updates Supabase if truly paid.
const cf = require("./_cashfree");

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const envErr = cf.checkEnv();
  if (envErr) return res.status(500).json({ error: envErr });
  try {
    const { orderId } = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
    if (!orderId) return res.status(400).json({ error: "orderId required" });
    const result = await cf.verifyAndSync(orderId);
    if (!result.found) return res.status(404).json({ error: "Order not found" });
    return res.status(200).json({ paid: result.paid, status: result.status });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};