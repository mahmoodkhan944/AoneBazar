// Cashfree online payment (card / UPI / netbanking / wallets).
// Loaded AFTER app.js, so it can use app.js's globals (cart,
// appliedCoupon, selectedPaymentOption, currentPayableTotal, ...).
// No secret keys here - those live only in Vercel env vars.

window.CASHFREE_ENABLED = true;

let cashfreeSdkPromise = null;
function loadCashfreeSdk() {
  if (window.Cashfree) return Promise.resolve();
  if (!cashfreeSdkPromise) {
    cashfreeSdkPromise = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = "https://sdk.cashfree.com/js/v3/cashfree.js";
      s.onload = resolve;
      s.onerror = () => { cashfreeSdkPromise = null; reject(new Error("Could not load payment SDK")); };
      document.head.appendChild(s);
    });
  }
  return cashfreeSdkPromise;
}

async function cfPost(path, body) {
  const r = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || "Request failed");
  return data;
}

async function insertCashfreeOrder(row) {
  let { error } = await supabase.from("orders").insert(row);
  if (error) {
    // Same stale-session retry as the UPI flow.
    const { data, error: authErr } = await supabase.auth.signInAnonymously();
    if (authErr || !data.user) throw new Error(error.message);
    currentSupabaseUser = data.user;
    ({ error } = await supabase.from("orders").insert({ ...row, customer_id: data.user.id }));
    if (error) throw new Error(error.message);
  }
}

async function payOnlineWithCashfree() {
  const btn = document.getElementById("cashfreePayBtn");
  const originalLabel = btn ? btn.innerHTML : "";
  const setBusy = (busy) => { if (btn) { btn.disabled = busy; btn.innerHTML = busy ? "Please wait…" : originalLabel; } };

  const user = JSON.parse(localStorage.getItem("user"));
  if (!user) { alert("Please enter mobile number first"); openLogin(); return; }
  if (cart.length === 0) { alert("Cart empty"); return; }

  const name = customerName.value.trim();
  const address = customerAddress.value.trim();
  if (!name || !address) { alert("Enter name and address"); return; }

  setBusy(true);
  try {
    if (!currentSupabaseUser) {
      const { data } = await supabase.auth.getSession();
      currentSupabaseUser = data.session ? data.session.user : null;
    }
    if (!currentSupabaseUser) {
      const { data, error } = await supabase.auth.signInAnonymously();
      if (!error) currentSupabaseUser = data.user;
    }

    // Delivery area / minimum order were already validated by
    // proceedToPayment() before this step could even appear.
    const subtotal = cartSubtotal();
    const discount = appliedCoupon ? appliedCoupon.discount_amount : 0;
    const goodsTotal = Math.max(0, subtotal - discount);
    if (goodsTotal < getMinOrder()) { alert(`Minimum order is ₹${getMinOrder()}.`); return; }
    const deliveryCharge = calculateDeliveryCharge(goodsTotal, address);
    const total = goodsTotal + deliveryCharge;

    const id = generateOrderID();
    const deliverySlotEl = document.getElementById("deliverySlot");
    const deliverySlot = deliverySlotEl ? deliverySlotEl.value : "";
    const items = cart.map(p => ({ id: p.id, name: p.name + (p.variantLabel ? ` (${p.variantLabel})` : ""), price: p.price, qty: p.qty }));

    // Saved as unpaid (amount_paid 0). The server flips it to paid
    // ONLY after Cashfree confirms the money actually arrived.
    await insertCashfreeOrder({
      id,
      invoice_no: generateInvoiceNumber(id),
      customer_id: currentSupabaseUser ? currentSupabaseUser.id : null,
      customer_phone: user.phone,
      customer_name: name,
      address,
      items,
      subtotal,
      coupon_code: appliedCoupon ? appliedCoupon.code : null,
      discount,
      delivery_charge: deliveryCharge,
      delivery_slot: deliverySlot || null,
      total,
      payment: "ONLINE",
      payment_option: selectedPaymentOption,
      amount_paid: 0,
      balance_due: total,
      status: "NEW"
    });

    const session = await cfPost("/api/cashfree-create-order", { orderId: id });
    let paid = !!session.alreadyPaid;

    if (!paid) {
      await loadCashfreeSdk();
      const cashfree = Cashfree({ mode: session.mode });
      await cashfree.checkout({ paymentSessionId: session.payment_session_id, redirectTarget: "_modal" });
      const v = await cfPost("/api/cashfree-verify", { orderId: id });
      paid = v.paid;
    }

    if (!paid) {
      alert("Payment was not completed. Your order is saved but unpaid — if money was deducted, it will update automatically within a few minutes, or contact the shop with Order ID " + id + ".");
      return;
    }

    if (appliedCoupon) {
      const { error } = await supabase.rpc("redeem_coupon", { p_code: appliedCoupon.code });
      if (error) console.warn("Coupon redeem failed:", error.message);
    }
    await maybeSaveAddress(name, address);
    if (currentSupabaseUser) {
      await supabase.from("profiles").update({ full_name: name }).eq("id", currentSupabaseUser.id);
    }

    const paidNow = selectedPaymentOption === "full" ? total : Math.ceil(total / 2);
    cart = [];
    removeCoupon();
    saveCart();
    renderCart();
    closeCart();
    customerName.value = "";
    customerAddress.value = "";
    backToCartForm();
    alert(`✅ Payment successful! Order ${id} placed.\nPaid online: ₹${paidNow}` + (total - paidNow > 0 ? `\nBalance on delivery: ₹${total - paidNow}` : ""));
  } catch (e) {
    console.error(e);
    alert("Online payment problem: " + e.message);
  } finally {
    setBusy(false);
  }
}

// If the payment app redirected back to the site (?cf_order_id=...),
// confirm the result and tell the customer.
(async function handleCashfreeReturn() {
  const orderId = new URLSearchParams(location.search).get("cf_order_id");
  if (!orderId) return;
  try {
    const v = await cfPost("/api/cashfree-verify", { orderId });
    alert(v.paid ? `✅ Payment successful for order ${orderId}. Thank you!` : `Payment for order ${orderId} is not confirmed yet (status: ${v.status}). It will update automatically if the money was deducted.`);
  } catch (e) { /* ignore */ }
  history.replaceState(null, "", location.pathname);
})();