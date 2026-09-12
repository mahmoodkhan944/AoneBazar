/***********************************************************
   ADMIN DASHBOARD (admin.html)
   Self-contained — talks only to Supabase (js/supabase-client.js).
***********************************************************/

let adminUser = null;
let cachedOrders = [];
let cachedProducts = [];
let allProductsCache = [];
let allCategoriesCache = [];
let editingProductId = null;
let ordersChartInstance = null;
let salesByStoreChartInstance = null;

const WHATSAPP_NUMBER = "918009555567";

/***********************
    AUTH
************************/

async function checkAdminSession() {
  const { data } = await supabase.auth.getSession();
  const user = data.session ? data.session.user : null;

  if (!user) {
    showLoginScreen();
    return;
  }

  const { data: profile, error } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();

  if (error || !profile || profile.role !== "admin") {
    showLoginScreen("Signed in, but this account isn't an admin.");
    return;
  }

  adminUser = user;
  document.getElementById("adminEmailLabel").innerText = user.email || "";
  document.getElementById("adminLoginScreen").classList.add("hidden");
  document.getElementById("adminShell").classList.remove("hidden");

  initDashboard();
}

function showLoginScreen(message) {
  document.getElementById("adminShell").classList.add("hidden");
  document.getElementById("adminLoginScreen").classList.remove("hidden");
  if (message) document.getElementById("adminLoginError").innerText = message;
}

async function adminSignIn() {
  const email = document.getElementById("loginEmail").value.trim();
  const password = document.getElementById("loginPassword").value;
  const errEl = document.getElementById("adminLoginError");
  errEl.innerText = "";

  if (!email || !password) {
    errEl.innerText = "Enter email and password";
    return;
  }

  const { data, error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    errEl.innerText = error.message;
    return;
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", data.user.id)
    .maybeSingle();

  if (!profile || profile.role !== "admin") {
    errEl.innerText = "This account is not an admin.";
    await supabase.auth.signOut();
    return;
  }

  checkAdminSession();
}

async function adminSignOut() {
  await supabase.auth.signOut();
  location.reload();
}

/***********************
    NAVIGATION
************************/

const VIEW_LOADERS = {
  dashboard: loadDashboard,
  orders: loadOrders,
  products: loadProducts,
  categories: loadCategoriesView,
  coupons: loadCoupons,
  "abandoned-carts": loadAbandonedCarts,
  "delivery-areas": loadDeliveryAreas,
  "extra-delivery-zones": loadExtraDeliveryZones,
  reviews: loadReviews,
  content: loadSiteContentForm,
  users: loadUsers,
  reports: initReportsView
};

function showAdminView(name) {
  document.querySelectorAll(".admin-view").forEach(v => v.classList.remove("active"));
  document.querySelectorAll(".admin-nav-item").forEach(b => b.classList.remove("active"));

  document.getElementById("view-" + name).classList.add("active");
  document.querySelector(`.admin-nav-item[data-view="${name}"]`).classList.add("active");

  // Remember which section is open in the URL — so refreshing (or
  // bookmarking) the admin panel lands back here instead of always
  // resetting to the dashboard.
  history.replaceState(null, "", "#" + name);

  // A fresh, deliberate switch to the Products tab starts clean at
  // page 1 — only an in-place refresh after saving/editing (which
  // calls loadProducts() directly, not through here) keeps whatever
  // page was already showing.
  if (name === "products") productsPage = 1;

  if (VIEW_LOADERS[name]) VIEW_LOADERS[name]();

  closeAdminSidebar(); // tapping a nav item on mobile should close the drawer
}

function toggleAdminSidebar() {
  document.getElementById("adminSidebar").classList.toggle("open");
  document.getElementById("adminSidebarOverlay").classList.toggle("open");
}

function closeAdminSidebar() {
  document.getElementById("adminSidebar").classList.remove("open");
  document.getElementById("adminSidebarOverlay").classList.remove("open");
}

function initDashboard() {
  const hashView = location.hash.replace("#", "");
  const target = VIEW_LOADERS.hasOwnProperty(hashView) ? hashView : "dashboard";
  showAdminView(target);
}

/***********************
    DASHBOARD
************************/

async function loadDashboard() {
  const { data: stats, error } = await supabase.rpc("get_admin_dashboard_stats");

  if (error) {
    console.error(error);
    return;
  }

  document.getElementById("statTotalOrders").innerText = stats.total_orders || 0;
  document.getElementById("statTotalRevenue").innerText = "₹" + Math.round(stats.total_revenue || 0);
  document.getElementById("statTotalCustomers").innerText = stats.total_customers || 0;
  document.getElementById("statTotalProducts").innerText = stats.total_products || 0;
  document.getElementById("statActiveOffers").innerText = stats.active_offers || 0;

  // "vs last month" — current total against what it stood at the
  // start of this month, i.e. real growth, not a guessed number.
  // A metric with nothing recorded before this month (e.g. a brand
  // new store) shows "New" instead of a division-by-zero percentage.
  renderStatChange("statTotalOrdersChange", stats.total_orders, stats.orders_before_this_month);
  renderStatChange("statTotalRevenueChange", stats.total_revenue, stats.revenue_before_this_month);
  renderStatChange("statTotalCustomersChange", stats.total_customers, stats.customers_before_this_month);
  renderStatChange("statTotalProductsChange", stats.total_products, stats.products_before_this_month);

  // Separate lightweight query rather than folding into the RPC above
  // — keeps that function untouched, and a missing/not-yet-migrated
  // pwa_installs table just shows 0 instead of breaking the rest of
  // the dashboard.
  supabase.from("pwa_installs").select("*", { count: "exact", head: true }).then(({ count, error: installsError }) => {
    const el = document.getElementById("statAppInstalls");
    if (el) el.innerText = installsError ? 0 : (count || 0);
  });

  renderOrdersChart(stats.orders_last_7_days || []);
  renderSalesByStoreChart(stats.sales_by_store || []);

  const STORE_LABELS = { supermarket: "Supermarket", grocery: "Grocery", cafe: "Cafe" };
  const storeEl = document.getElementById("productsByStoreList");
  const storeRows = stats.products_by_store || [];

  if (storeRows.length === 0) {
    storeEl.innerHTML = "<p style='color:var(--ink-faint);font-size:0.85rem;'>No products yet</p>";
  } else {
    storeEl.innerHTML = storeRows.map(s => `
      <div class="top-product-row">
        <div>${STORE_LABELS[s.store] || s.store}${s.inactive_count > 0 ? `<div class="qty">${s.inactive_count} inactive</div>` : ""}</div>
        <div class="rev">${s.active_count} active</div>
      </div>
    `).join("");
  }

  // Same colour language as the status pills used everywhere else in
  // the admin (Orders table, Recent Orders) — just as a small dot
  // here instead of a full pill, to match a denser summary list.
  const STATUS_LABELS = { NEW: "Pending", PROCESSING: "Processing", OUT_FOR_DELIVERY: "Out for Delivery", DELIVERED: "Delivered", CANCELLED: "Cancelled" };
  const STATUS_DOT_COLORS = {
    NEW: "var(--marigold-600)",
    PROCESSING: "var(--indigo-700)",
    OUT_FOR_DELIVERY: "#8e5fd6",
    DELIVERED: "var(--green-700)",
    CANCELLED: "var(--danger-600)"
  };
  const statusEl = document.getElementById("ordersByStatusList");
  const statusRows = stats.orders_by_status || [];

  if (statusRows.length === 0) {
    statusEl.innerHTML = "<p style='color:var(--ink-faint);font-size:0.85rem;'>No orders yet</p>";
  } else {
    statusEl.innerHTML = statusRows.map(s => `
      <div class="status-dot-row">
        <div class="status-dot-label">
          <span class="status-dot" style="background:${STATUS_DOT_COLORS[s.status] || 'var(--ink-faint)'};"></span>
          ${STATUS_LABELS[s.status] || s.status}
        </div>
        <div class="status-dot-count">${s.count}</div>
      </div>
    `).join("");
  }

  const { data: top, error: topError } = await supabase.rpc("get_top_products", { p_limit: 5 });
  const topEl = document.getElementById("topProductsList");

  if (topError || !top || top.length === 0) {
    topEl.innerHTML = "<p style='color:var(--ink-faint);font-size:0.85rem;'>No sales yet</p>";
  } else {
    topEl.innerHTML = top.map(p => `
      <div class="top-product-row">
        <div>${p.name}<div class="qty">${p.total_qty} sold</div></div>
        <div class="rev">₹${Math.round(p.total_revenue)}</div>
      </div>
    `).join("");
  }

  const { data: recent } = await supabase
    .from("orders")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(6);

  const recentBody = document.getElementById("recentOrdersBody");
  recentBody.innerHTML = (recent || []).map(o => `
    <tr>
      <td class="cell-title">${o.id}</td>
      <td data-label="Customer">${o.customer_name}</td>
      <td data-label="Total">₹${o.total}</td>
      <td data-label="Payment">${paymentBreakdownHtml(o)}</td>
      <td data-label="Status"><span class="status-pill ${o.status}">${o.status}</span></td>
      <td data-label="Date">${new Date(o.created_at).toLocaleDateString()}</td>
      <td><button class="table-actions-view-btn" onclick="openOrderDetailModal('${o.id}')"><i class="fa-solid fa-eye"></i> View</button></td>
    </tr>
  `).join("") || `<tr><td colspan="7" style="text-align:center;color:var(--ink-faint);">No orders yet</td></tr>`;
}

/** Order Details modal — fetches this one order fresh (not relying
 *  on the Orders tab having been opened yet this session) and shows
 *  everything about it right there, instead of sending the admin
 *  off to the full Orders table just to look at a single order. */
async function openOrderDetailModal(orderId) {
  const modal = document.getElementById("orderDetailModal");
  const content = document.getElementById("orderDetailContent");
  if (!modal || !content) return;

  modal.classList.remove("hidden");
  content.innerHTML = "Loading…";

  const { data: row, error } = await supabase
    .from("orders")
    .select("*")
    .eq("id", orderId)
    .maybeSingle();

  if (error || !row) {
    content.innerHTML = `<p style="color:var(--danger-600);">Could not load this order.</p>`;
    return;
  }

  const o = mapOrderRow(row);
  currentOrderDetailData = o;

  const itemsHtml = (o.items || []).map(it => `
    <div class="order-detail-item-row">
      <span>${it.name} <span class="qty">× ${it.qty}</span></span>
      <span>₹${it.price * it.qty}</span>
    </div>
  `).join("");

  content.innerHTML = `
    <div class="order-detail-header-row">
      <div>
        <div class="order-detail-id">${o.id}</div>
        <div class="order-detail-date">${o.date}</div>
      </div>
      <span class="status-pill ${o.status}">${o.status}</span>
    </div>

    <div class="order-detail-section">
      <h4>Customer</h4>
      <p>${o.name}<br>${o.phone}<br>${o.address || ""}</p>
    </div>

    <div class="order-detail-section">
      <div class="admin-panel-header-row" style="margin-bottom:8px;">
        <h4 style="margin-bottom:0;">Items</h4>
        <button class="admin-view-all-link" onclick="startEditOrderItems('${o.id}')">Edit Items</button>
      </div>
      <div id="orderItemsDisplay-${o.id}">${itemsHtml}</div>
      <div id="orderItemsEditorWrap-${o.id}" class="hidden">
        <div id="orderItemsEditor-${o.id}"></div>
        <button class="btn btn-primary btn-sm" style="margin-top:10px;" onclick="saveOrderItemsEdit('${o.id}')">Save Item Changes</button>
        <button class="btn btn-outline btn-sm" style="margin-top:10px;" onclick="openOrderDetailModal('${o.id}')">Cancel</button>
      </div>
    </div>

    <div class="order-detail-section order-detail-totals">
      <div class="order-detail-item-row"><span>Subtotal</span><span>₹${o.subtotal}</span></div>
      ${o.discount > 0 ? `<div class="order-detail-item-row"><span>Discount${o.couponCode ? ` (${o.couponCode})` : ""}</span><span>−₹${o.discount}</span></div>` : ""}
      <div class="order-detail-item-row"><span>Delivery</span><span>${o.deliveryCharge > 0 ? "₹" + o.deliveryCharge : "Free"}</span></div>
      <div class="order-detail-item-row order-detail-total-row"><span>Total</span><span>₹${o.total}</span></div>
    </div>

    <div class="order-detail-section">
      <h4>Payment</h4>
      <div>${paymentBreakdownHtml(o)}</div>
      ${o.paymentScreenshotUrl
        ? `<a href="${o.paymentScreenshotUrl}" target="_blank" rel="noopener noreferrer"><img src="${o.paymentScreenshotUrl}" alt="Payment screenshot" class="order-detail-screenshot" /></a>`
        : ""
      }
    </div>

    <div class="table-actions" style="margin-top:16px;">
      <button onclick="updateOrderStatus('${o.id}','PROCESSING').then(() => openOrderDetailModal('${o.id}'))">Processing</button>
      <button onclick="updateOrderStatus('${o.id}','OUT_FOR_DELIVERY').then(() => openOrderDetailModal('${o.id}'))">Out for Delivery</button>
      <button onclick="updateOrderStatus('${o.id}','DELIVERED').then(() => openOrderDetailModal('${o.id}'))">Delivered</button>
      <button onclick='downloadInvoiceById("${o.id}")'>Invoice</button>
      <button class="danger" onclick="cancelOrderWithConfirm('${o.id}').then(() => openOrderDetailModal('${o.id}'))">Cancel Order</button>
    </div>
  `;
}

/** Switches the Items section of the order detail modal from a plain
 *  read-only list into the shared items editor (see ORDER ITEMS
 *  EDITOR above), pre-loaded with this order's current items. */
function startEditOrderItems(orderId) {
  const displayEl = document.getElementById(`orderItemsDisplay-${orderId}`);
  const editorWrap = document.getElementById(`orderItemsEditorWrap-${orderId}`);
  if (!displayEl || !editorWrap) return;

  orderEditorItems = currentOrderDetailData ? currentOrderDetailData.items.map(it => ({ ...it })) : [];
  orderEditorContainerId = `orderItemsEditor-${orderId}`;

  displayEl.classList.add("hidden");
  editorWrap.classList.remove("hidden");
  renderOrderEditorItems();
}

/** Saves the edited items back to the order — recomputes subtotal
 *  and total (subtotal − discount + delivery charge), keeping
 *  whatever discount/delivery charge the order already had rather
 *  than trying to re-derive a coupon or re-check the delivery area
 *  from scratch. */
async function saveOrderItemsEdit(orderId) {
  if (orderEditorItems.length === 0) {
    if (!(await customConfirm("This order will have no items left. Save anyway?", "Save"))) return;
  }

  const { data: row, error: fetchError } = await supabase.from("orders").select("discount, delivery_charge").eq("id", orderId).maybeSingle();
  if (fetchError || !row) { alert("Could not load order to save changes"); return; }

  const subtotal = orderEditorSubtotal();
  const discount = row.discount || 0;
  const deliveryCharge = row.delivery_charge || 0;
  const total = Math.max(0, subtotal - discount) + deliveryCharge;

  const { error } = await supabase
    .from("orders")
    .update({ items: orderEditorItems, subtotal, total })
    .eq("id", orderId);

  if (error) { alert("Could not save item changes: " + error.message); return; }

  orderEditorItems = [];
  orderEditorContainerId = null;
  openOrderDetailModal(orderId);
  loadOrders();
}

/***********************
    CREATE ORDER MANUALLY
    For recovering an order that failed to save on the storefront, or
    taking one over the phone. Needs its own admin-only insert rule
    (see patch-admin-manage-orders.sql) since the normal "customer
    inserts their own order" rule only allows customer_id = the
    logged-in customer themselves, not an admin acting on their behalf.
************************/

let newOrderCustomerId = null; // set by lookupCustomerByPhone() if a matching account is found; null is fine (order just won't show in that customer's "My Orders" until they have one)

function openCreateOrderModal() {
  document.getElementById("newOrderPhone").value = "";
  document.getElementById("newOrderName").value = "";
  document.getElementById("newOrderAddress").value = "";
  document.getElementById("newOrderDeliveryCharge").value = "0";
  document.getElementById("newOrderDiscount").value = "0";
  document.getElementById("newOrderAmountPaid").value = "0";
  document.getElementById("newOrderStatus").value = "NEW";
  document.getElementById("newOrderLookupResult").textContent = "";
  newOrderCustomerId = null;

  orderEditorItems = [];
  orderEditorContainerId = "newOrderItemsEditor";
  renderOrderEditorItems();
  updateNewOrderTotalPreview();

  document.getElementById("createOrderModal").classList.remove("hidden");
}

function closeCreateOrderModal() {
  document.getElementById("createOrderModal").classList.add("hidden");
  orderEditorContainerId = null;
}

/** Looks the phone number up in profiles — if found, the order gets
 *  linked to that real account (so it shows in their "My Orders");
 *  if not, the admin can still create the order, it just won't be
 *  linked to any account until the customer signs up with that
 *  number. */
async function lookupCustomerByPhone() {
  const phone = document.getElementById("newOrderPhone").value.trim();
  const resultEl = document.getElementById("newOrderLookupResult");
  if (!phone) { resultEl.textContent = ""; return; }

  const digitsOnly = phone.replace(/\D/g, "");
  const { data: rows, error } = await supabase
    .from("profiles")
    .select("id, full_name, phone")
    .or(`phone.eq.${phone},phone.eq.${digitsOnly},phone.eq.+91${digitsOnly},phone.eq.91${digitsOnly}`)
    .limit(1);

  if (error || !rows || rows.length === 0) {
    newOrderCustomerId = null;
    resultEl.innerHTML = `<span style="color:var(--marigold-700);">No account found for this number — order will be created without a linked account.</span>`;
    return;
  }

  newOrderCustomerId = rows[0].id;
  resultEl.innerHTML = `<span style="color:var(--green-700);">✓ Found account${rows[0].full_name ? `: ${rows[0].full_name}` : ""} — order will show in their "My Orders".</span>`;
  if (rows[0].full_name && !document.getElementById("newOrderName").value) {
    document.getElementById("newOrderName").value = rows[0].full_name;
  }
}

function updateNewOrderTotalPreview() {
  const subtotal = orderEditorSubtotal();
  const deliveryCharge = Number(document.getElementById("newOrderDeliveryCharge")?.value) || 0;
  const discount = Number(document.getElementById("newOrderDiscount")?.value) || 0;
  const total = Math.max(0, subtotal - discount) + deliveryCharge;
  const el = document.getElementById("newOrderTotalPreview");
  if (el) el.textContent = `Subtotal ₹${subtotal.toFixed(2)} − Discount ₹${discount} + Delivery ₹${deliveryCharge} = Total ₹${total.toFixed(2)}`;
}

async function submitCreateOrder() {
  const phone = document.getElementById("newOrderPhone").value.trim();
  const name = document.getElementById("newOrderName").value.trim();
  const address = document.getElementById("newOrderAddress").value.trim();
  const deliveryCharge = Number(document.getElementById("newOrderDeliveryCharge").value) || 0;
  const discount = Number(document.getElementById("newOrderDiscount").value) || 0;
  const amountPaid = Number(document.getElementById("newOrderAmountPaid").value) || 0;
  const status = document.getElementById("newOrderStatus").value;

  if (!phone || !name || !address) {
    alert("Enter the customer's phone, name, and delivery address");
    return;
  }
  if (orderEditorItems.length === 0) {
    alert("Add at least one item");
    return;
  }

  const subtotal = orderEditorSubtotal();
  const total = Math.max(0, subtotal - discount) + deliveryCharge;
  const balanceDue = Math.max(0, total - amountPaid);
  const id = "ORD" + Date.now();
  const invoiceNo = "INV" + Date.now();

  const { error } = await supabase.from("orders").insert({
    id,
    invoice_no: invoiceNo,
    customer_id: newOrderCustomerId,
    customer_phone: phone,
    customer_name: name,
    address,
    items: orderEditorItems,
    subtotal,
    discount,
    delivery_charge: deliveryCharge,
    total,
    payment: "COD",
    payment_option: balanceDue > 0 ? "half" : "full",
    amount_paid: amountPaid,
    balance_due: balanceDue,
    status
  });

  if (error) {
    alert("Could not create order: " + error.message);
    return;
  }

  alert("Order created" + (newOrderCustomerId ? "" : " (not linked to a customer account — they won't see it in \"My Orders\" unless they later log in with this exact phone number and you re-link it)."));
  closeCreateOrderModal();
  loadOrders();
}

function closeOrderDetail() {
  const modal = document.getElementById("orderDetailModal");
  if (modal) modal.classList.add("hidden");
}

/** Small "Half — ₹350 paid, ₹350 due" / "Full — ₹700 paid" label,
 *  shared by the dashboard's Recent Orders (raw snake_case DB rows),
 *  the full Orders table (camelCase via mapOrderRow), and the
 *  invoice — so an admin can see at a glance how much of an order
 *  is actually settled without opening anything else. Falls back
 *  gracefully for older orders placed before this was tracked. */
function paymentBreakdownHtml(o) {
  const amountPaid = o.amount_paid ?? o.amountPaid;
  const paymentOption = o.payment_option ?? o.paymentOption;
  const balanceDue = o.balance_due ?? o.balanceDue;

  if (amountPaid == null) {
    return `<span style="color:var(--ink-faint);font-size:0.8rem;">—</span>`;
  }

  const optionLabel = paymentOption === "full" ? "Full" : "Half";
  const paidPart = `${optionLabel} — ₹${amountPaid} paid`;
  const duePart = balanceDue > 0
    ? `<span style="color:var(--marigold-700, #b8860b);">₹${balanceDue} due</span>`
    : `<span style="color:var(--green-700);">fully paid</span>`;

  return `<div style="font-size:0.82rem;">${paidPart}<br>${duePart}</div>`;
}

function renderOrdersChart(days) {
  const ctx = document.getElementById("ordersChart");
  if (!ctx) return;

  if (ordersChartInstance) ordersChartInstance.destroy();

  ordersChartInstance = new Chart(ctx, {
    type: "bar",
    data: {
      labels: days.map(d => d.label),
      datasets: [{
        label: "Orders",
        data: days.map(d => d.count),
        backgroundColor: "#1e7a46",
        borderRadius: 6,
        maxBarThickness: 36
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      resizeDelay: 100,
      plugins: { legend: { display: false } },
      scales: {
        y: { beginAtZero: true, ticks: { stepSize: 1 } }
      }
    }
  });

  // Chart.js can under-measure its container on the very first paint
  // (especially right after the dashboard becomes visible) — nudging
  // a resize one frame later fixes the "chart looks cut off" glitch.
  requestAnimationFrame(() => ordersChartInstance && ordersChartInstance.resize());
}

/** The stat cards' "↑12% vs last month" line — computed from real
 *  totals (current vs. what the total stood at the start of this
 *  month), never a guessed number. Shows "New" instead of a
 *  percentage when there's nothing to compare against yet (e.g. the
 *  first month a store has any data at all). */
function renderStatChange(elId, current, before) {
  const el = document.getElementById(elId);
  if (!el) return;

  current = Number(current) || 0;
  before = Number(before) || 0;

  if (before <= 0) {
    el.innerHTML = current > 0
      ? `<span class="stat-change-note">New this month</span>`
      : "";
    return;
  }

  const pct = Math.round(((current - before) / before) * 100);
  const isUp = pct >= 0;
  el.className = "stat-change " + (isUp ? "up" : "down");
  el.innerHTML = `<i class="fa-solid fa-arrow-${isUp ? "up" : "down"}"></i> ${Math.abs(pct)}%<span class="stat-change-note">vs last month</span>`;
}

const STORE_CHART_LABELS = { supermarket: "AOne Bazaar", grocery: "AOne Kirana Store", cafe: "AOne Cafe" };
const STORE_CHART_COLORS = { supermarket: "#c17a3d", grocery: "#2f6fd6", cafe: "#1e7a46" };

/** "Sales Overview" donut — revenue per store, computed server-side
 *  by matching each order's line items back to their product's
 *  store (see sales_by_store in get_admin_dashboard_stats()), since
 *  a single order can include items from all three stores at once. */
function renderSalesByStoreChart(rows) {
  const canvas = document.getElementById("salesByStoreChart");
  const legendEl = document.getElementById("salesByStoreLegend");
  const totalEl = document.getElementById("salesByStoreTotal");
  if (!canvas) return;

  const total = rows.reduce((sum, r) => sum + Number(r.revenue || 0), 0);
  if (totalEl) totalEl.textContent = "₹" + Math.round(total).toLocaleString("en-IN");

  if (salesByStoreChartInstance) salesByStoreChartInstance.destroy();

  if (rows.length === 0) {
    if (legendEl) legendEl.innerHTML = `<p style="color:var(--ink-faint);font-size:0.85rem;">No sales yet</p>`;
    return;
  }

  salesByStoreChartInstance = new Chart(canvas, {
    type: "doughnut",
    data: {
      labels: rows.map(r => STORE_CHART_LABELS[r.store] || r.store),
      datasets: [{
        data: rows.map(r => Number(r.revenue || 0)),
        backgroundColor: rows.map(r => STORE_CHART_COLORS[r.store] || "#999"),
        borderWidth: 0
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      resizeDelay: 100,
      cutout: "72%",
      plugins: { legend: { display: false }, tooltip: { enabled: true } }
    }
  });

  requestAnimationFrame(() => salesByStoreChartInstance && salesByStoreChartInstance.resize());

  if (legendEl) {
    legendEl.innerHTML = rows.map(r => {
      const revenue = Number(r.revenue || 0);
      const pct = total > 0 ? Math.round((revenue / total) * 100) : 0;
      return `
        <div class="donut-legend-row">
          <div class="donut-legend-label">
            <span class="donut-legend-dot" style="background:${STORE_CHART_COLORS[r.store] || "#999"};"></span>
            ${STORE_CHART_LABELS[r.store] || r.store}
          </div>
          <div class="donut-legend-value">
            <strong>₹${Math.round(revenue).toLocaleString("en-IN")}</strong>
            <span>${pct}%</span>
          </div>
        </div>
      `;
    }).join("");
  }
}

/***********************
    ORDERS
************************/

function mapOrderRow(row) {
  return {
    id: row.id,
    invoiceNo: row.invoice_no,
    name: row.customer_name,
    phone: row.customer_phone,
    address: row.address,
    items: row.items || [],
    subtotal: row.subtotal,
    couponCode: row.coupon_code,
    discount: row.discount || 0,
    deliveryCharge: row.delivery_charge || 0,
    total: row.total,
    status: row.status,
    paymentOption: row.payment_option || null,
    amountPaid: row.amount_paid,
    balanceDue: row.balance_due,
    paymentScreenshotUrl: row.payment_screenshot_url || null,
    date: new Date(row.created_at).toLocaleString()
  };
}

async function loadOrders() {
  const body = document.getElementById("ordersBody");
  body.innerHTML = `<tr><td colspan="9" style="text-align:center;">Loading…</td></tr>`;

  const { data: rows, error } = await supabase
    .from("orders")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    body.innerHTML = `<tr><td colspan="9">Could not load orders</td></tr>`;
    console.error(error);
    return;
  }

  cachedOrders = (rows || []).map(mapOrderRow);
  ordersPage = 1;
  renderOrdersTable(cachedOrders);
}

let ordersPage = 1;
let currentOrdersList = [];

function renderOrdersTable(list) {
  currentOrdersList = list;
  const body = document.getElementById("ordersBody");

  if (list.length === 0) {
    body.innerHTML = `<tr><td colspan="9" style="text-align:center;color:var(--ink-faint);">No orders found</td></tr>`;
    document.getElementById("ordersPagination").innerHTML = "";
    return;
  }

  const pageItems = paginateArray(list, ordersPage, PAGE_SIZE);

  body.innerHTML = pageItems.map(o => `
    <tr>
      <td class="cell-title">${o.id}</td>
      <td data-label="Customer">${o.name}</td>
      <td data-label="Phone">${o.phone}</td>
      <td data-label="Total">₹${o.total}</td>
      <td data-label="Payment">${paymentBreakdownHtml(o)}</td>
      <td data-label="Payment Proof">${o.paymentScreenshotUrl
        ? `<a href="${o.paymentScreenshotUrl}" target="_blank" rel="noopener noreferrer"><img src="${o.paymentScreenshotUrl}" alt="Payment screenshot" style="width:44px;height:44px;object-fit:cover;border-radius:6px;border:1px solid var(--line);" /></a>`
        : `<span style="color:var(--ink-faint);font-size:0.8rem;">None</span>`
      }</td>
      <td data-label="Status"><span class="status-pill ${o.status}">${o.status}</span></td>
      <td data-label="Date">${o.date}</td>
      <td>
        <div class="table-actions">
          <button onclick="updateOrderStatus('${o.id}','PROCESSING')">Processing</button>
          <button onclick="updateOrderStatus('${o.id}','OUT_FOR_DELIVERY')">Out for Delivery</button>
          <button onclick="updateOrderStatus('${o.id}','DELIVERED')">Delivered</button>
          <button onclick='downloadInvoiceById("${o.id}")'>Invoice</button>
          <button class="danger" onclick="cancelOrderWithConfirm('${o.id}')">Cancel</button>
        </div>
      </td>
    </tr>
  `).join("");

  renderPagination("ordersPagination", list.length, ordersPage, PAGE_SIZE, "goToOrdersPage");
}

function goToOrdersPage(n) {
  ordersPage = n;
  renderOrdersTable(currentOrdersList);
}

function filterOrders() {
  const q = document.getElementById("orderSearch").value.toLowerCase();
  const filtered = cachedOrders.filter(o =>
    o.id.toLowerCase().includes(q) || o.name.toLowerCase().includes(q)
  );
  ordersPage = 1;
  renderOrdersTable(filtered);
}

/** Cancelling asks first (unlike the other status buttons) since
 *  it's the one destructive, hard-to-walk-back action here — then
 *  reuses updateOrderStatus so the same WhatsApp notification prompt
 *  fires as every other status change. */
async function cancelOrderWithConfirm(id) {
  if (!(await customConfirm("Cancel this order? This can't be undone from here.", "Cancel Order"))) return;
  await updateOrderStatus(id, "CANCELLED");
}

/***********************
    ORDER ITEMS EDITOR
    Shared by "Edit Items" on an existing order and "Create Order"
    (manually adding one from scratch) — a plain working list of
    {name, price, qty} rows, with add/remove/qty-edit and a running
    subtotal, rendered into whichever container is currently using it.
************************/

let orderEditorItems = [];
let orderEditorContainerId = null;
let currentOrderDetailData = null;

function renderOrderEditorItems() {
  const containerId = orderEditorContainerId;
  if (!containerId) return;
  const container = document.getElementById(containerId);
  if (!container) return;

  const rowsHtml = orderEditorItems.map((it, i) => `
    <div class="order-detail-item-row" style="align-items:center;gap:8px;">
      <span style="flex:1;">${it.name}</span>
      <input type="number" min="1" value="${it.qty}" style="width:60px;" onchange="updateOrderEditorItemQty(${i}, this.value)" />
      <span>× ₹${it.price} =</span>
      <span style="min-width:60px;text-align:right;">₹${(it.price * it.qty).toFixed(2)}</span>
      <button type="button" class="danger" style="padding:4px 10px;font-size:0.76rem;border-radius:999px;border:none;background:var(--danger-100);color:var(--danger-600);cursor:pointer;" onclick="removeOrderEditorItem(${i})">×</button>
    </div>
  `).join("");

  const subtotal = orderEditorItems.reduce((sum, it) => sum + it.price * it.qty, 0);

  container.innerHTML = `
    ${rowsHtml || `<p style="color:var(--ink-faint);font-size:0.85rem;">No items yet — add one below.</p>`}
    <div class="order-detail-item-row order-detail-total-row" style="margin-top:8px;">
      <span>Items Subtotal</span><span>₹${subtotal.toFixed(2)}</span>
    </div>
    <div class="admin-form-grid" style="margin-top:12px;">
      <input id="newItemName" placeholder="Product name" list="allProductNamesList" />
      <input id="newItemPrice" type="number" placeholder="Price (per unit)" />
      <input id="newItemQty" type="number" placeholder="Qty" value="1" min="1" />
    </div>
    <datalist id="allProductNamesList">
      ${(allProductsCache || []).map(p => `<option value="${p.name}" data-price="${p.price}">`).join("")}
    </datalist>
    <button type="button" class="btn btn-outline btn-sm" style="margin-top:8px;" onclick="addOrderEditorItem()">+ Add Item</button>
  `;

  updateNewOrderTotalPreview(); // no-op unless the Create Order modal's fields exist
}

function addOrderEditorItem() {
  const nameInput = document.getElementById("newItemName");
  const priceInput = document.getElementById("newItemPrice");
  const qtyInput = document.getElementById("newItemQty");

  const name = nameInput.value.trim();
  const price = Number(priceInput.value);
  const qty = Number(qtyInput.value) || 1;

  if (!name || !price || price <= 0) {
    alert("Enter a product name and a price greater than 0");
    return;
  }

  orderEditorItems.push({ name, price, qty });
  renderOrderEditorItems();
}

function updateOrderEditorItemQty(index, value) {
  const qty = Math.max(1, Number(value) || 1);
  orderEditorItems[index].qty = qty;
  renderOrderEditorItems();
}

function removeOrderEditorItem(index) {
  orderEditorItems.splice(index, 1);
  renderOrderEditorItems();
}

function orderEditorSubtotal() {
  return orderEditorItems.reduce((sum, it) => sum + it.price * it.qty, 0);
}

async function updateOrderStatus(id, newStatus) {
  const { error } = await supabase.from("orders").update({ status: newStatus }).eq("id", id);

  if (error) {
    alert("Could not update order: " + error.message);
    return;
  }

  const order = cachedOrders.find(o => o.id === id);

  cachedOrders = cachedOrders.map(o => {
    if (o.id === id) o.status = newStatus;
    return o;
  });

  renderOrdersTable(cachedOrders);

  if (order) notifyCustomerOnWhatsApp(order, newStatus);
}

/** Opens a pre-filled WhatsApp message to the customer whenever the
 *  admin marks an order Processing or Delivered — admin just has to
 *  hit send. Nothing sends automatically in the background (there's
 *  no paid WhatsApp Business API wired up), this just saves typing. */
function notifyCustomerOnWhatsApp(order, status) {
  const templates = {
    PROCESSING: `Hi ${order.name}! Your AOne Bazaar order ${order.id} (₹${order.total}) is now being prepared. We'll message you again once it's out for delivery. 🛍️

नमस्ते ${order.name}! आपका AOne Bazaar ऑर्डर ${order.id} (₹${order.total}) अब तैयार किया जा रहा है। डिलीवरी के लिए निकलते ही हम आपको फिर से मैसेज करेंगे। 🛍️`,
    OUT_FOR_DELIVERY: `Hi ${order.name}! Your AOne Bazaar order ${order.id} (₹${order.total}) is out for delivery and should reach you shortly. 🛵

नमस्ते ${order.name}! आपका AOne Bazaar ऑर्डर ${order.id} (₹${order.total}) डिलीवरी के लिए निकल चुका है और जल्द ही आप तक पहुंच जाएगा। 🛵`,
    DELIVERED: `Hi ${order.name}! Your AOne Bazaar order ${order.id} (₹${order.total}) has been delivered. Thank you for shopping with us — see you again soon! 🙏

नमस्ते ${order.name}! आपका AOne Bazaar ऑर्डर ${order.id} (₹${order.total}) डिलीवर हो चुका है। हमारे साथ खरीदारी करने के लिए धन्यवाद — फिर मिलेंगे! 🙏`,
    CANCELLED: `Hi ${order.name}, your AOne Bazaar order ${order.id} (₹${order.total}) has been cancelled. If this wasn't expected, please reply here and we'll sort it out right away.

नमस्ते ${order.name}, आपका AOne Bazaar ऑर्डर ${order.id} (₹${order.total}) रद्द कर दिया गया है। अगर ये आपकी जानकारी में नहीं था, तो कृपया यहीं रिप्लाई करें, हम तुरंत सुलझा देंगे।`
  };

  const message = templates[status];
  if (!message || !order.phone) return;

  const digitsOnly = String(order.phone).replace(/\D/g, "");
  const fullNumber = digitsOnly.length === 10 ? "91" + digitsOnly : digitsOnly;

  window.open(`https://wa.me/${fullNumber}?text=${encodeURIComponent(message)}`, "_blank");
}

async function downloadInvoiceById(id) {
  let order = cachedOrders.find(o => o.id === id);

  // Not in cache yet (e.g. invoked from the Dashboard's Order
  // Details modal before the Orders tab has ever been opened this
  // session) — fetch it fresh instead of failing.
  if (!order) {
    const { data: row, error } = await supabase.from("orders").select("*").eq("id", id).maybeSingle();
    if (error || !row) { alert("Order not found"); return; }
    order = mapOrderRow(row);
  }

  downloadInvoice(order);
}

function generateInvoiceNumber() {
  let last = localStorage.getItem("lastInvoice") || "0";
  last = parseInt(last) + 1;
  localStorage.setItem("lastInvoice", last);
  return "INV-" + String(last).padStart(4, "0");
}

async function downloadInvoice(order) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();

  const GREEN = [30, 122, 70];        // brand green
  const GREEN_DARK = [15, 74, 43];    // brand dark green
  const INK = [28, 27, 24];
  const INK_SOFT = [91, 88, 79];
  const LINE = [231, 224, 207];
  const PAPER = [250, 248, 243];

  // ---- Header band ----
  doc.setFillColor(...GREEN_DARK);
  doc.rect(0, 0, 210, 32, "F");

  doc.setFont("helvetica", "bold");
  doc.setFontSize(20);
  doc.setTextColor(255, 255, 255);
  doc.text("AOne Bazaar", 14, 16);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(210, 228, 217);
  doc.text("Supermarket - Kirana - Cafe, Lahideeh, Azamgarh", 14, 23);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.setTextColor(255, 255, 255);
  doc.text("INVOICE", 196, 14, { align: "right" });

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.text(order.invoiceNo || order.id, 196, 21, { align: "right" });
  doc.text(order.date, 196, 27, { align: "right" });

  doc.setTextColor(...INK);
  let y = 44;

  // ---- Bill To box ----
  const addrLines = doc.splitTextToSize(order.address || "-", 168);
  const billBoxH = 22 + addrLines.length * 5;

  doc.setDrawColor(...LINE);
  doc.setFillColor(...PAPER);
  doc.roundedRect(14, y, 182, billBoxH, 2, 2, "FD");

  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.setTextColor(...INK_SOFT);
  doc.text("BILL TO", 20, y + 8);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(...INK);
  doc.text(order.name || "-", 20, y + 15);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(...INK_SOFT);
  doc.text("Phone: " + (order.phone || "-"), 20, y + 21);
  doc.text(addrLines, 20, y + 26);

  y += billBoxH + 12;

  // ---- Items table ----
  doc.setFillColor(...GREEN);
  doc.rect(14, y, 182, 9, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(255, 255, 255);
  doc.text("ITEM", 18, y + 6);
  doc.text("QTY", 130, y + 6, { align: "right" });
  doc.text("PRICE", 160, y + 6, { align: "right" });
  doc.text("TOTAL", 192, y + 6, { align: "right" });

  y += 9;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9.5);
  doc.setTextColor(...INK);

  let rowIndex = 0;
  order.items.forEach(p => {
    const lineTotal = p.price * p.qty;
    const rowH = 9;

    if (y > 255) { doc.addPage(); y = 20; rowIndex = 0; }

    if (rowIndex % 2 === 0) {
      doc.setFillColor(...PAPER);
      doc.rect(14, y, 182, rowH, "F");
    }

    doc.setTextColor(...INK);
    doc.text(String(p.name), 18, y + 6);
    doc.text(String(p.qty), 130, y + 6, { align: "right" });
    doc.text("Rs. " + p.price, 160, y + 6, { align: "right" });
    doc.text("Rs. " + lineTotal, 192, y + 6, { align: "right" });

    y += rowH;
    rowIndex++;
  });

  doc.setDrawColor(...LINE);
  doc.line(14, y, 196, y);
  y += 8;

  // ---- Summary — subtotal, discount, delivery, grand total ----
  if (y > 240) { doc.addPage(); y = 20; }

  const subtotal = order.subtotal || order.items.reduce((s, p) => s + p.price * p.qty, 0);
  const discount = order.discount || 0;
  const delivery = order.deliveryCharge || 0;
  const sx1 = 130, sx2 = 192;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9.5);
  doc.setTextColor(...INK_SOFT);
  doc.text("Subtotal", sx1, y);
  doc.text("Rs. " + subtotal, sx2, y, { align: "right" });
  y += 7;

  if (discount > 0) {
    doc.setTextColor(198, 62, 62);
    doc.text("Discount" + (order.couponCode ? ` (${order.couponCode})` : ""), sx1, y);
    doc.text("- Rs. " + discount, sx2, y, { align: "right" });
    y += 7;
    doc.setTextColor(...INK_SOFT);
  }

  doc.text("Delivery", sx1, y);
  doc.text(delivery > 0 ? "Rs. " + delivery : "Free", sx2, y, { align: "right" });
  y += 4;

  doc.setDrawColor(...LINE);
  doc.line(sx1 - 6, y, sx2, y);
  y += 9;

  doc.setFillColor(...GREEN_DARK);
  doc.rect(sx1 - 6, y - 7, 68, 12, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.setTextColor(255, 255, 255);
  doc.text("TOTAL", sx1, y + 1);
  doc.text("Rs. " + order.total, sx2, y + 1, { align: "right" });

  y += 20;
  if (y > 250) { doc.addPage(); y = 20; }

  // ---- Payment breakdown (half/full UPI + balance on delivery) —
  // older invoices from before this was tracked just skip the
  // section entirely instead of showing blank/zero values. ----
  if (order.amountPaid != null) {
    doc.setDrawColor(...LINE);
    doc.setFillColor(...PAPER);
    const screenshotLine = order.paymentScreenshotUrl ? 8 : 0;
    doc.roundedRect(sx1 - 6, y, 68, 22 + screenshotLine, 2, 2, "FD");

    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.setTextColor(...INK_SOFT);
    doc.text("PAYMENT", sx1 - 2, y + 7);

    const optionLabel = order.paymentOption === "full" ? "Full (UPI)" : "Half (UPI)";
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(...INK);
    doc.text(optionLabel + " paid", sx1 - 2, y + 13);
    doc.text("Rs. " + order.amountPaid, sx2 - 4, y + 13, { align: "right" });

    if (order.balanceDue > 0) {
      doc.setTextColor(198, 130, 30);
      doc.text("Due on delivery", sx1 - 2, y + 19);
      doc.text("Rs. " + order.balanceDue, sx2 - 4, y + 19, { align: "right" });
    } else {
      doc.setTextColor(...GREEN);
      doc.text("Fully paid — nothing due", sx1 - 2, y + 19);
    }

    if (order.paymentScreenshotUrl) {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.setTextColor(50, 90, 200);
      doc.textWithLink("View payment screenshot →", sx1 - 2, y + 26, { url: order.paymentScreenshotUrl });
    }

    y += 22 + screenshotLine + 8;
  }

  if (y > 270) { doc.addPage(); y = 30; }

  // ---- Footer ----
  doc.setDrawColor(...LINE);
  doc.line(14, y, 196, y);
  y += 8;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(...GREEN);
  doc.text("Thank you for shopping with AOne Bazaar!", 105, y, { align: "center" });
  y += 6;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(...INK_SOFT);
  const invoiceAddress = (window.siteContent && window.siteContent.contact_address) || "Master Naseem Complex, Lahideeh Bazar, Azamgarh";
  const invoicePhone = (window.siteContent && window.siteContent.contact_phone) || "+91 8009555567";
  doc.text(`${invoiceAddress}  |  ${invoicePhone}`, 105, y, { align: "center" });
  y += 5;
  doc.text("This is a computer generated invoice.", 105, y, { align: "center" });

  doc.save(`Invoice_${order.id}.pdf`);
}

/***********************
    PRODUCTS
************************/

function toggleProductForm() {
  const panel = document.getElementById("productFormPanel");
  panel.classList.toggle("hidden");
  if (!panel.classList.contains("hidden")) {
    loadCategoryOptions(document.getElementById("pStore").value);
    document.getElementById("pHasExtraAreas").checked = false;
  }
}

/***********************
    EXTRA DELIVERY ZONES
    A separate list from the main Delivery Areas — only used to
    populate the "Extra Delivery Areas" checkbox a product can opt
    into. Each zone can also have its own specific localities nested
    under it, each independently active/inactive — checkout matches
    against a zone's own name AND every active locality under it.
************************/

let currentExtraZonesList = [];
let expandedExtraZoneId = null; // which zone's locality list is currently open, if any

async function loadExtraDeliveryZones() {
  const container = document.getElementById("extraZonesTree");
  container.innerHTML = `<p style="text-align:center;color:var(--ink-faint);">Loading…</p>`;

  const [{ data: zones, error: zonesError }, { data: areas, error: areasError }] = await Promise.all([
    supabase.from("extra_delivery_zones").select("*").order("area_name"),
    supabase.from("extra_delivery_zone_areas").select("*").order("area_name")
  ]);

  if (zonesError || areasError) {
    container.innerHTML = `<p style="color:var(--danger-600);">Could not load extra delivery zones</p>`;
    return;
  }

  currentExtraZonesList = (zones || []).map(z => ({
    ...z,
    localities: (areas || []).filter(a => a.zone_id === z.id)
  }));

  renderExtraZonesTree();
}

function renderExtraZonesTree() {
  const container = document.getElementById("extraZonesTree");

  if (currentExtraZonesList.length === 0) {
    container.innerHTML = `<p style="text-align:center;color:var(--ink-faint);">No extra zones added yet</p>`;
    return;
  }

  container.innerHTML = currentExtraZonesList.map(z => `
    <div class="cat-tree-group">
      <div class="cat-tree-main">
        <div class="cat-tree-main-info">
          <i class="fa-solid fa-map-location-dot" style="color:var(--indigo-800);"></i>
          <strong>${z.area_name}</strong>
          <span class="status-pill ${z.active ? 'DELIVERED' : 'CANCELLED'}">${z.active ? "Active" : "Off"}</span>
          <span class="cat-tree-stats">${z.localities.length} localit${z.localities.length === 1 ? "y" : "ies"}</span>
        </div>
        <div class="table-actions">
          <button onclick="toggleExtraZoneLocalities('${z.id}')">${expandedExtraZoneId === z.id ? "Hide" : "Manage"} Localities</button>
          <button onclick='editExtraDeliveryZone(${jsonAttr(z)})'>Edit</button>
          <button onclick="toggleExtraDeliveryZone('${z.id}', ${!z.active})">${z.active ? "Deactivate" : "Activate"}</button>
          <button class="danger" onclick="deleteExtraDeliveryZone('${z.id}')">Delete</button>
        </div>
      </div>

      ${expandedExtraZoneId === z.id ? `
        <div style="padding:14px 0 4px 30px;">
          <div class="admin-form-grid" style="margin-bottom:10px;">
            <input id="newLocalityInput-${z.id}" placeholder="e.g. Saraimeer Main Market" />
            <button class="btn btn-primary btn-sm" onclick="addExtraDeliveryZoneArea('${z.id}')">Add Locality</button>
          </div>
          ${z.localities.length === 0
            ? `<p style="font-size:0.85rem;color:var(--ink-faint);">No localities under this zone yet — the zone name itself still matches on its own.</p>`
            : z.localities.map(a => `
              <div class="cat-tree-sub">
                <div class="cat-tree-sub-info">
                  <span class="cat-tree-sub-arrow">↳</span>
                  <span>${a.area_name}</span>
                  <span class="status-pill ${a.active ? 'DELIVERED' : 'CANCELLED'}">${a.active ? "Active" : "Off"}</span>
                </div>
                <div class="table-actions">
                  <button onclick='editExtraDeliveryZoneArea(${jsonAttr(a)})'>Edit</button>
                  <button onclick="toggleExtraDeliveryZoneArea('${a.id}', ${!a.active})">${a.active ? "Deactivate" : "Activate"}</button>
                  <button class="danger" onclick="deleteExtraDeliveryZoneArea('${a.id}')">Delete</button>
                </div>
              </div>
            `).join("")
          }
        </div>
      ` : ""}
    </div>
  `).join("");
}

function toggleExtraZoneLocalities(zoneId) {
  expandedExtraZoneId = expandedExtraZoneId === zoneId ? null : zoneId;
  renderExtraZonesTree();
}

async function addExtraDeliveryZone() {
  const area_name = document.getElementById("extraZoneNameInput").value.trim();
  if (!area_name) { alert("Enter an area / locality name"); return; }

  const { error } = await supabase.from("extra_delivery_zones").insert({ area_name });
  if (error) { alert("Could not add: " + error.message); return; }

  document.getElementById("extraZoneNameInput").value = "";
  loadExtraDeliveryZones();
}

async function toggleExtraDeliveryZone(id, active) {
  const { error } = await supabase.from("extra_delivery_zones").update({ active }).eq("id", id);
  if (error) { alert("Could not update: " + error.message); return; }
  loadExtraDeliveryZones();
}

let editingExtraZoneId = null;

function editExtraDeliveryZone(z) {
  editingExtraZoneId = z.id;
  document.getElementById("editExtraZoneName").value = z.area_name;
  document.getElementById("editExtraZoneModal").classList.remove("hidden");
}

function closeExtraZoneEdit() {
  document.getElementById("editExtraZoneModal").classList.add("hidden");
}

async function updateExtraDeliveryZone() {
  const area_name = document.getElementById("editExtraZoneName").value.trim();
  if (!area_name) { alert("Enter an area / locality name"); return; }

  const { error } = await supabase.from("extra_delivery_zones").update({ area_name }).eq("id", editingExtraZoneId);
  if (error) { alert("Could not update: " + error.message); return; }

  closeExtraZoneEdit();
  loadExtraDeliveryZones();
}

async function deleteExtraDeliveryZone(id) {
  if (!(await customConfirm("Delete this extra delivery zone and all its localities? Products already tagged with it will no longer deliver there.", "Delete"))) return;
  const { error } = await supabase.from("extra_delivery_zones").delete().eq("id", id);
  if (error) { alert("Could not delete: " + error.message); return; }
  loadExtraDeliveryZones();
}

async function addExtraDeliveryZoneArea(zoneId) {
  const input = document.getElementById(`newLocalityInput-${zoneId}`);
  const area_name = input.value.trim();
  if (!area_name) { alert("Enter a locality name"); return; }

  const { error } = await supabase.from("extra_delivery_zone_areas").insert({ zone_id: zoneId, area_name });
  if (error) { alert("Could not add: " + error.message); return; }

  loadExtraDeliveryZones();
}

async function toggleExtraDeliveryZoneArea(id, active) {
  const { error } = await supabase.from("extra_delivery_zone_areas").update({ active }).eq("id", id);
  if (error) { alert("Could not update: " + error.message); return; }
  loadExtraDeliveryZones();
}

let editingExtraZoneAreaId = null;

function editExtraDeliveryZoneArea(a) {
  editingExtraZoneAreaId = a.id;
  document.getElementById("editExtraZoneAreaName").value = a.area_name;
  document.getElementById("editExtraZoneAreaModal").classList.remove("hidden");
}

function closeExtraZoneAreaEdit() {
  document.getElementById("editExtraZoneAreaModal").classList.add("hidden");
}

async function updateExtraDeliveryZoneArea() {
  const area_name = document.getElementById("editExtraZoneAreaName").value.trim();
  if (!area_name) { alert("Enter a locality name"); return; }

  const { error } = await supabase.from("extra_delivery_zone_areas").update({ area_name }).eq("id", editingExtraZoneAreaId);
  if (error) { alert("Could not update: " + error.message); return; }

  closeExtraZoneAreaEdit();
  loadExtraDeliveryZones();
}

async function deleteExtraDeliveryZoneArea(id) {
  if (!(await customConfirm("Delete this locality?", "Delete"))) return;
  const { error } = await supabase.from("extra_delivery_zone_areas").delete().eq("id", id);
  if (error) { alert("Could not delete: " + error.message); return; }
  loadExtraDeliveryZones();
}

document.addEventListener("change", e => {
  if (e.target && e.target.id === "pStore") {
    loadCategoryOptions(e.target.value);
  }
  if (e.target && e.target.id === "catStore") populateParentCategoryDropdown("catParent", e.target.value);
  if (e.target && e.target.id === "editCatStore") populateParentCategoryDropdown("editCatParent", e.target.value, editingCategoryId);
});

/** Category names actually in use come from two places that can
 *  drift apart: the formal `categories` table (via "Add Category"),
 *  and whatever a product's `category` field happens to say — a
 *  product can carry a category value that was never formally
 *  registered (e.g. set before "Add Category" existed, or via a
 *  direct import). Merging both here means a product never ends up
 *  hiding its own current category from its own edit dropdown. */
let productFormCategoryCache = []; // full category rows (with parent_id) for whichever store is currently selected in the product form

/** Fetches every category row for a store, PLUS any category name a
 *  product uses that was never formally added via "Add Category" —
 *  those get treated as flat, parent-less categories so a product's
 *  existing assignment is never invisible in its own dropdown. */
async function loadProductFormCategories(store) {
  const [catResult, productResult] = await Promise.all([
    supabase.from("categories").select("*").eq("store", store),
    supabase.from("products").select("category").eq("store", store)
  ]);

  const catRows = catResult.data || [];
  const knownNames = new Set(catRows.map(c => c.name));

  const orphanNames = [...new Set((productResult.data || []).map(p => p.category).filter(Boolean))]
    .filter(name => !knownNames.has(name));

  const orphanRows = orphanNames.map(name => ({ id: `orphan:${name}`, name, parent_id: null, store }));

  productFormCategoryCache = [...catRows, ...orphanRows];
}

/** Populates the "Category" dropdown with MAIN categories only (no
 *  parent) — sub-categories don't clutter this list; they show up
 *  in the separate "Sub-Category" dropdown once a main category
 *  with children is picked. `selectedCategoryName` can be either a
 *  main category's name or a sub-category's name — either way, both
 *  dropdowns end up correctly pre-selected. */
async function populateProductCategoryDropdowns(mainSelectId, subWrapId, subSelectId, store, selectedCategoryName) {
  const mainSelect = document.getElementById(mainSelectId);
  mainSelect.innerHTML = "<option>Loading...</option>";

  try {
    await loadProductFormCategories(store);
  } catch (e) {
    mainSelect.innerHTML = "<option value=''>Could not load categories</option>";
    return;
  }

  const mains = productFormCategoryCache
    .filter(c => !c.parent_id)
    .sort((a, b) => a.name.localeCompare(b.name));

  // The product's saved category might itself be a sub-category —
  // if so, figure out its parent so the MAIN dropdown lands on the
  // right group, and the SUB dropdown lands on the actual value.
  let selectedMain = "";
  let selectedSub = "";

  if (selectedCategoryName) {
    if (mains.some(c => c.name === selectedCategoryName)) {
      selectedMain = selectedCategoryName;
    } else {
      const asSub = productFormCategoryCache.find(c => c.name === selectedCategoryName && c.parent_id);
      const parent = asSub && productFormCategoryCache.find(c => c.id === asSub.parent_id);
      if (parent) {
        selectedMain = parent.name;
        selectedSub = selectedCategoryName;
      }
    }
  }

  mainSelect.innerHTML = mains.map(c => `<option value="${c.name}">${c.name}</option>`).join("") +
    `<option value="__add_new__">+ Add New Category…</option>`;

  if (selectedMain) mainSelect.value = selectedMain;
  mainSelect.dataset.prevValue = mainSelect.value;

  updateSubCategoryDropdown(mainSelectId, subWrapId, subSelectId, selectedSub);
}

/** Fills the "Sub-Category" dropdown based on whichever main
 *  category is currently picked — hides the whole field when that
 *  main category has no children, since there's nothing to choose. */
function updateSubCategoryDropdown(mainSelectId, subWrapId, subSelectId, preSelectSubName) {
  const mainSelect = document.getElementById(mainSelectId);
  const subWrap = document.getElementById(subWrapId);
  const subSelect = document.getElementById(subSelectId);

  const mainName = mainSelect.value;
  const mainRecord = productFormCategoryCache.find(c => c.name === mainName && !c.parent_id);
  const subs = mainRecord
    ? productFormCategoryCache.filter(c => c.parent_id === mainRecord.id).sort((a, b) => a.name.localeCompare(b.name))
    : [];

  if (!mainRecord || subs.length === 0) {
    subWrap.classList.add("hidden");
    subSelect.innerHTML = "";
    return;
  }

  subWrap.classList.remove("hidden");
  subSelect.innerHTML =
    `<option value="">— Use "${mainName}" directly (no sub-category) —</option>` +
    subs.map(s => `<option value="${s.name}">${s.name}</option>`).join("") +
    `<option value="__add_new_sub__">+ Add New Sub-Category…</option>`;

  subSelect.value = preSelectSubName || "";
  subSelect.dataset.prevValue = subSelect.value;
  subSelect.dataset.parentId = mainRecord.id;
}

/** The category a product actually gets saved under — the
 *  sub-category if one's selected, otherwise the main category. */
function getSelectedProductCategory(mainSelectId, subSelectId) {
  const subSelect = document.getElementById(subSelectId);
  const subValue = subSelect && !subSelect.closest("div").classList.contains("hidden") ? subSelect.value : "";
  if (subValue && subValue !== "__add_new_sub__") return subValue;
  return document.getElementById(mainSelectId).value;
}

async function loadCategoryOptions(store) {
  await populateProductCategoryDropdowns("pCategory", "pSubCategoryWrap", "pSubCategory", store, null);
}

/** Fires when the admin picks "+ Add New Category…" in the MAIN
 *  category dropdown — lets them create a new top-level category
 *  right there instead of leaving the page. */
async function handleCategorySelectChange(selectEl, storeFieldId) {
  if (selectEl.value !== "__add_new__") {
    selectEl.dataset.prevValue = selectEl.value;
    const isEdit = selectEl.id === "editCategory";
    updateSubCategoryDropdown(
      selectEl.id,
      isEdit ? "editSubCategoryWrap" : "pSubCategoryWrap",
      isEdit ? "editSubCategory" : "pSubCategory",
      ""
    );
    return;
  }

  const store = document.getElementById(storeFieldId).value;
  const name = ((await customPrompt("New category name:")) || "").trim();
  const prevValue = selectEl.dataset.prevValue || "";

  if (!name) { selectEl.value = prevValue; return; }

  const { error } = await supabase.from("categories").insert({ store, name });

  if (error) {
    alert(error.code === "23505" ? "That category already exists" : "Could not add: " + error.message);
    selectEl.value = prevValue;
    return;
  }

  alert(`"${name}" category added!`);

  if (selectEl.id === "editCategory") {
    await populateProductCategoryDropdowns("editCategory", "editSubCategoryWrap", "editSubCategory", store, name);
  } else {
    await populateProductCategoryDropdowns("pCategory", "pSubCategoryWrap", "pSubCategory", store, name);
  }
}

/** Same idea, but for "+ Add New Sub-Category…" in the SUB dropdown —
 *  nests the new category under whichever main category is
 *  currently selected. */
async function handleSubCategorySelectChange(selectEl) {
  if (selectEl.value !== "__add_new_sub__") {
    selectEl.dataset.prevValue = selectEl.value;
    return;
  }

  const isEdit = selectEl.id === "editSubCategory";
  const mainSelectId = isEdit ? "editCategory" : "pCategory";
  const storeFieldId = isEdit ? "editStore" : "pStore";
  const store = document.getElementById(storeFieldId).value;
  const parentId = selectEl.dataset.parentId;
  const prevValue = selectEl.dataset.prevValue || "";

  const name = ((await customPrompt("New sub-category name:")) || "").trim();
  if (!name) { selectEl.value = prevValue; return; }

  const { error } = await supabase.from("categories").insert({ store, name, parent_id: parentId });

  if (error) {
    alert(error.code === "23505" ? "That category already exists" : "Could not add: " + error.message);
    selectEl.value = prevValue;
    return;
  }

  alert(`"${name}" sub-category added!`);

  if (isEdit) {
    await populateProductCategoryDropdowns("editCategory", "editSubCategoryWrap", "editSubCategory", store, name);
  } else {
    await populateProductCategoryDropdowns("pCategory", "pSubCategoryWrap", "pSubCategory", store, name);
  }
}

async function loadProducts() {
  const body = document.getElementById("productsBody");
  body.innerHTML = `<tr><td colspan="7" style="text-align:center;">Loading…</td></tr>`;

  const { data: rows, error } = await supabase
    .from("products")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    body.innerHTML = `<tr><td colspan="7">Could not load products</td></tr>`;
    console.error(error);
    return;
  }

  allProductsCache = rows || [];

  // Re-applies whatever store filter / search text is already sitting
  // in the boxes, and keeps whatever page the admin was on — this
  // runs after every save/activate/delete too (see updateProduct,
  // addProduct, toggleProductStock, deleteProduct), and without this
  // it used to silently reset back to "All Stores", page 1, every
  // single time, right after editing a product in a store's filtered
  // list further down the pages.
  applyProductsFilter({ resetPage: false });

  loadCategoryOptions(document.getElementById("pStore").value);

  // Populate the "homepage section" datalist so the admin can reuse an
  // existing section name (e.g. "Best Deal") instead of typo-ing a new one.
  const sections = [...new Set(allProductsCache.map(p => p.featured_section).filter(Boolean))];
  const listEl = document.getElementById("featuredSectionList");
  if (listEl) listEl.innerHTML = sections.map(s => `<option value="${s}">`).join("");

  // Same idea for brand names — reuse "Tata" instead of accidentally
  // creating "tata" / "TATA" / "Tata " as separate brands.
  const brands = [...new Set(allProductsCache.map(p => p.brand).filter(Boolean))].sort();
  const brandListEl = document.getElementById("brandList");
  if (brandListEl) brandListEl.innerHTML = brands.map(b => `<option value="${b}">`).join("");
}

let productsPage = 1;
let currentProductsList = [];

function renderProductsTable(list) {
  currentProductsList = list;
  const body = document.getElementById("productsBody");

  if (list.length === 0) {
    body.innerHTML = `<tr><td colspan="7" style="text-align:center;color:var(--ink-faint);">No products yet</td></tr>`;
    document.getElementById("productsPagination").innerHTML = "";
    return;
  }

  // A page number left over from a longer, unfiltered list can end up
  // past the end of a shorter, filtered one (e.g. was on page 5,
  // then picked a store with only 2 pages) — fall back to the last
  // real page instead of rendering nothing.
  const maxPage = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
  if (productsPage > maxPage) productsPage = maxPage;

  const pageItems = paginateArray(list, productsPage, PAGE_SIZE);

  body.innerHTML = pageItems.map(p => `
    <tr>
      <td><img class="thumb" src="${p.images && p.images[0] ? p.images[0] : ''}" alt=""></td>
      <td class="cell-title">${p.name}${p.brand ? `<div style="font-size:0.75rem;color:var(--green-700);font-weight:600;">${p.brand}</div>` : ''}${p.name_hi ? `<div style="font-size:0.78rem;color:var(--ink-faint);font-weight:400;">${p.name_hi}</div>` : ''}${p.variants && p.variants.length ? `<div style="font-size:0.75rem;color:var(--ink-faint);font-weight:400;">${p.variants.length} sizes</div>` : ''}</td>
      <td data-label="Store">${p.store}</td>
      <td data-label="Category">${p.category}</td>
      <td data-label="Price">₹${p.price}</td>
      <td data-label="Status"><span class="status-pill ${p.in_stock ? 'DELIVERED' : 'CANCELLED'}">${p.in_stock ? 'Active' : 'Inactive'}</span></td>
      <td>
        <div class="table-actions">
          <button onclick='editProduct(${jsonAttr(p)})'>Edit</button>
          <button onclick="toggleProductStock('${p.id}', ${!p.in_stock})">${p.in_stock ? 'Deactivate' : 'Activate'}</button>
          <button class="danger" onclick="deleteProduct('${p.id}')">Delete</button>
        </div>
      </td>
    </tr>
  `).join("");

  renderPagination("productsPagination", list.length, productsPage, PAGE_SIZE, "goToProductsPage");
}

function goToProductsPage(n) {
  productsPage = n;
  renderProductsTable(currentProductsList);
}

/** Filters allProductsCache by whatever's currently in the search box
 *  and store dropdown, and renders it. resetPage=true (the default,
 *  used when the admin actually changes the search/store filter
 *  themselves via filterProducts()) jumps back to page 1, since a
 *  new filter is a fresh view. resetPage=false (used by loadProducts()
 *  after a save/refresh) keeps whatever page was already showing. */
function applyProductsFilter({ resetPage = true } = {}) {
  const q = document.getElementById("productSearch").value.toLowerCase();
  const storeFilter = document.getElementById("productStoreFilter").value;

  const filtered = allProductsCache.filter(p =>
    p.name.toLowerCase().includes(q) &&
    (!storeFilter || p.store === storeFilter)
  );

  if (resetPage) productsPage = 1;
  renderProductsTable(filtered);
}

function filterProducts() {
  applyProductsFilter({ resetPage: true });
}

async function toggleProductStock(id, newStatus) {
  const { error } = await supabase.from("products").update({ in_stock: newStatus }).eq("id", id);

  if (error) {
    alert("Could not update: " + error.message);
    return;
  }

  loadProducts();
}

async function addProduct() {
  const store = document.getElementById("pStore").value;
  const category = getSelectedProductCategory("pCategory", "pSubCategory");
  const brand = document.getElementById("pBrand").value.trim() || null;
  const name = document.getElementById("pName").value.trim();
  const name_hi = document.getElementById("pNameHi").value.trim() || null;
  const description = document.getElementById("pDescription").value.trim() || null;
  const description_hi = document.getElementById("pDescriptionHi").value.trim() || null;
  const price = Number(document.getElementById("pPrice").value) || 0;
  const mrp = Number(document.getElementById("pMrp").value) || null;
  const featured_section = document.getElementById("pFeaturedSection").value.trim() || null;
  const featured_order = Number(document.getElementById("pFeaturedOrder").value) || 0;
  const files = document.getElementById("pImage").files;
  const variants = collectVariants("pVariants");
  const specs = collectSpecs("pSpecs");
  const deliver_to_all_extra_zones = document.getElementById("pHasExtraAreas").checked;

  if (!name || !category) {
    alert("Fill in name and category");
    return;
  }
  if (!price && variants.length === 0) {
    alert("Enter a price, or add at least one size/pack with its own price");
    return;
  }
  if (!files.length) {
    alert("Select at least one image");
    return;
  }

  let imageURLs = [];

  for (const file of files) {
    const ext = file.name.split(".").pop();
    const path = `${store}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;

    const { error: uploadError } = await supabase.storage
      .from(PRODUCT_IMAGES_BUCKET)
      .upload(path, file, { upsert: false });

    if (uploadError) {
      alert("Image upload failed: " + uploadError.message);
      continue;
    }
    imageURLs.push(getProductImageUrl(path));
  }

  if (imageURLs.length === 0) {
    alert("No images were uploaded");
    return;
  }

  // If only variants were priced (no base price), use the cheapest
  // variant as the product's headline price for the storefront grid.
  const effectivePrice = price || Math.min(...variants.map(v => v.price));

  const { error } = await supabase.from("products").insert({
    store, category, brand, name, name_hi, description, description_hi, price: effectivePrice, mrp, images: imageURLs, variants, specs,
    featured_section, featured_order,
    deliver_to_all_extra_zones
  });

  if (error) {
    alert("Could not add product: " + error.message);
    return;
  }

  alert("Product added!");
  document.getElementById("pName").value = "";
  document.getElementById("pNameHi").value = "";
  document.getElementById("pDescription").value = "";
  document.getElementById("pDescriptionHi").value = "";
  document.getElementById("pBrand").value = "";
  document.getElementById("pPrice").value = "";
  document.getElementById("pMrp").value = "";
  document.getElementById("pFeaturedSection").value = "";
  document.getElementById("pFeaturedOrder").value = "";
  document.getElementById("pImage").value = "";
  document.getElementById("pVariants").innerHTML = "";
  document.getElementById("pSpecs").innerHTML = "";
  document.getElementById("pHasExtraAreas").checked = false;
  loadProducts();
}

let editRemainingImages = [];

async function editProduct(p) {
  editingProductId = p.id;
  document.getElementById("editName").value = p.name;
  document.getElementById("editNameHi").value = p.name_hi || "";
  document.getElementById("editDescription").value = p.description || "";
  document.getElementById("editDescriptionHi").value = p.description_hi || "";
  document.getElementById("editBrand").value = p.brand || "";
  document.getElementById("editPrice").value = p.price;
  document.getElementById("editMrp").value = p.mrp || "";
  document.getElementById("editFeaturedSection").value = p.featured_section || "";
  document.getElementById("editFeaturedOrder").value = p.featured_order || "";
  document.getElementById("editStore").value = p.store;

  editRemainingImages = p.images ? [...p.images] : [];
  renderEditExistingImages();

  document.getElementById("editImage").value = "";
  document.getElementById("editNewImagePreviews").innerHTML = "";

  renderVariantRows("editVariants", p.variants || []);
  renderSpecRows("editSpecs", p.specs || []);
  document.getElementById("editHasExtraAreas").checked = !!p.deliver_to_all_extra_zones;

  await populateProductCategoryDropdowns("editCategory", "editSubCategoryWrap", "editSubCategory", p.store, p.category);

  document.getElementById("editModal").classList.remove("hidden");
}

function closeEdit() {
  document.getElementById("editModal").classList.add("hidden");
  closeHindiKeyboard();
}

function renderEditExistingImages() {
  const box = document.getElementById("editExistingImages");

  if (editRemainingImages.length === 0) {
    box.innerHTML = `<span style="font-size:0.82rem;color:var(--ink-faint);">No images left — add at least one below</span>`;
    return;
  }

  box.innerHTML = editRemainingImages.map((url, i) => `
    <div class="thumb-wrap">
      <img src="${url}" alt="">
      <button type="button" class="thumb-remove" onclick="removeExistingImage(${i})">×</button>
    </div>
  `).join("");
}

function removeExistingImage(index) {
  editRemainingImages.splice(index, 1);
  renderEditExistingImages();
}

document.getElementById("editImage") && document.getElementById("editImage").addEventListener("change", () => {
  const files = document.getElementById("editImage").files;
  const box = document.getElementById("editNewImagePreviews");
  box.innerHTML = "";

  Array.from(files).forEach(file => {
    box.innerHTML += `<div class="thumb-wrap"><img src="${URL.createObjectURL(file)}" alt=""></div>`;
  });
});

document.getElementById("editStore") && document.getElementById("editStore").addEventListener("change", e => {
  populateProductCategoryDropdowns("editCategory", "editSubCategoryWrap", "editSubCategory", e.target.value, null);
});



/***********************
    VARIANTS (sizes / packs) — shared by Add + Edit forms
************************/

/** Auto-fills the Hindi name field from the English one, using a free
 *  translation API — the admin can still edit or clear the result
 *  before saving, since translations of brand/product names aren't
 *  always perfect. */
/***********************
    ON-SCREEN HINDI KEYBOARD
    Click-to-type Devanagari keyboard for the "Hindi name" fields —
    handy for fixing an imperfect auto-translation without needing a
    physical Hindi keyboard.
************************/

let hindiKeyboardTarget = null;

const HINDI_KEYBOARD_ROWS = [
  ["अ", "आ", "इ", "ई", "उ", "ऊ", "ऋ", "ए", "ऐ", "ओ", "औ", "अं", "अः"],
  ["क", "ख", "ग", "घ", "ङ", "च", "छ", "ज", "झ", "ञ"],
  ["ट", "ठ", "ड", "ढ", "ण", "त", "थ", "द", "ध", "न"],
  ["प", "फ", "ब", "भ", "म", "य", "र", "ल", "व"],
  ["श", "ष", "स", "ह", "़", "्", "ॉ"],
  ["ा", "ि", "ी", "ु", "ू", "े", "ै", "ो", "ौ", "ं", "ः"],
  ["०", "१", "२", "३", "४", "५", "६", "७", "८", "९"]
];

function openHindiKeyboard(fieldId) {
  hindiKeyboardTarget = document.getElementById(fieldId);

  const kb = document.getElementById("hindiKeyboard");
  const overlay = document.getElementById("hindiKeyboardOverlay");
  const rowsEl = document.getElementById("hindiKeyboardRows");

  if (!rowsEl.dataset.built) {
    rowsEl.innerHTML = HINDI_KEYBOARD_ROWS.map(row => `
      <div class="hk-row">
        ${row.map(ch => `<button type="button" onclick="hindiKeyPress('${ch}')">${ch}</button>`).join("")}
      </div>
    `).join("");
    rowsEl.dataset.built = "1";
  }

  overlay.classList.remove("hidden");
  kb.classList.remove("hidden");
}

function closeHindiKeyboard() {
  document.getElementById("hindiKeyboard").classList.add("hidden");
  document.getElementById("hindiKeyboardOverlay").classList.add("hidden");
  hindiKeyboardTarget = null;
}

function hindiKeyPress(char) {
  if (!hindiKeyboardTarget) return;
  const el = hindiKeyboardTarget;
  const start = el.selectionStart ?? el.value.length;
  const end = el.selectionEnd ?? el.value.length;

  el.value = el.value.slice(0, start) + char + el.value.slice(end);

  const newPos = start + char.length;
  el.focus();
  el.setSelectionRange(newPos, newPos);
}

function hindiBackspace() {
  if (!hindiKeyboardTarget) return;
  const el = hindiKeyboardTarget;
  const start = el.selectionStart ?? el.value.length;
  const end = el.selectionEnd ?? el.value.length;

  if (start === end && start > 0) {
    el.value = el.value.slice(0, start - 1) + el.value.slice(end);
    el.focus();
    el.setSelectionRange(start - 1, start - 1);
  } else {
    el.value = el.value.slice(0, start) + el.value.slice(end);
    el.focus();
    el.setSelectionRange(start, start);
  }
}

async function autoTranslateToHindi(englishFieldId, hindiFieldId) {
  const englishEl = document.getElementById(englishFieldId);
  const hindiEl = document.getElementById(hindiFieldId);
  const text = englishEl.value.trim();

  if (!text || hindiEl.value.trim()) return; // don't overwrite a name the admin already typed/edited

  const originalPlaceholder = hindiEl.placeholder;
  hindiEl.placeholder = "Translating…";

  try {
    const resp = await fetch(
      `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=en|hi`
    );
    const data = await resp.json();
    const translated = data && data.responseData && data.responseData.translatedText;
    if (translated) hindiEl.value = translated;
  } catch (e) {
    console.error("Translation failed:", e);
  } finally {
    hindiEl.placeholder = originalPlaceholder;
  }
}

async function translateTextViaApi(text) {
  if (!text.trim()) return "";
  try {
    const resp = await fetch(
      `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=en|hi`
    );
    const data = await resp.json();
    return (data && data.responseData && data.responseData.translatedText) || text;
  } catch (e) {
    console.error("Translation failed:", e);
    return text;
  }
}

/** Descriptions can have "## Heading" lines and "- bullet" lines —
 *  translating the whole block as one lump of text tends to mangle
 *  those markers. This walks it block by block (heading, then each
 *  paragraph or bullet on its own) so the Hindi version keeps the
 *  same headings and bullet structure as the English one. */
async function autoTranslateDescription(englishFieldId, hindiFieldId) {
  const englishEl = document.getElementById(englishFieldId);
  const hindiEl = document.getElementById(hindiFieldId);
  const text = englishEl.value.trim();

  if (!text || hindiEl.value.trim()) return;

  const originalPlaceholder = hindiEl.placeholder;
  hindiEl.placeholder = "Translating…";

  try {
    const blocks = text.split(/\n\s*\n/);
    const translatedBlocks = [];

    for (const block of blocks) {
      const trimmed = block.trim();
      if (!trimmed) continue;

      const lines = trimmed.split("\n");
      let headingLine = "";
      let bodyLines = lines;

      if (lines[0].startsWith("## ")) {
        const headingText = lines[0].slice(3).trim();
        headingLine = "## " + (await translateTextViaApi(headingText));
        bodyLines = lines.slice(1);
      }

      if (bodyLines.length === 0) {
        if (headingLine) translatedBlocks.push(headingLine);
        continue;
      }

      const isBulletBlock = bodyLines.every(l => l.trim().startsWith("- "));

      if (isBulletBlock) {
        const translatedItems = [];
        for (const line of bodyLines) {
          const itemText = line.trim().slice(2).trim();
          translatedItems.push("- " + (await translateTextViaApi(itemText)));
        }
        translatedBlocks.push([headingLine, ...translatedItems].filter(Boolean).join("\n"));
      } else {
        const bodyTranslated = await translateTextViaApi(bodyLines.join(" "));
        translatedBlocks.push([headingLine, bodyTranslated].filter(Boolean).join("\n"));
      }
    }

    hindiEl.value = translatedBlocks.join("\n\n");
  } catch (e) {
    console.error("Description translation failed:", e);
  } finally {
    hindiEl.placeholder = originalPlaceholder;
  }
}

function addVariantRow(containerId, label) {
  const container = document.getElementById(containerId);
  const row = document.createElement("div");
  row.className = "variant-row";
  row.innerHTML = `
    <input class="variant-label" placeholder="e.g. 250g" value="${label || ""}">
    <input class="variant-price" type="number" placeholder="Price (₹)">
    <input class="variant-mrp" type="number" placeholder="MRP (optional)">
    <button type="button" onclick="this.closest('.variant-row').remove()">×</button>
  `;
  container.appendChild(row);
}

function renderVariantRows(containerId, variants) {
  const container = document.getElementById(containerId);
  container.innerHTML = "";
  (variants || []).forEach(v => {
    const row = document.createElement("div");
    row.className = "variant-row";
    row.innerHTML = `
      <input class="variant-label" placeholder="e.g. 250g" value="${v.label || ""}">
      <input class="variant-price" type="number" placeholder="Price (₹)" value="${v.price ?? ""}">
      <input class="variant-mrp" type="number" placeholder="MRP (optional)" value="${v.mrp ?? ""}">
      <button type="button" onclick="this.closest('.variant-row').remove()">×</button>
    `;
    container.appendChild(row);
  });
}

function collectVariants(containerId) {
  const rows = document.querySelectorAll(`#${containerId} .variant-row`);
  const variants = [];

  rows.forEach(row => {
    const label = row.querySelector(".variant-label").value.trim();
    const price = Number(row.querySelector(".variant-price").value);
    const mrp = Number(row.querySelector(".variant-mrp").value) || null;
    if (label && price > 0) variants.push({ label, price, ...(mrp ? { mrp } : {}) });
  });

  return variants;
}

/** Same "add a row, remove a row" pattern as the size/pack variant
 *  builder above, just with a free-text label + value instead —
 *  this is what powers the "Product Specifications" table (Cooling
 *  Area, Body Material, whatever the admin wants to list). */
function addSpecRow(containerId, label, value) {
  const container = document.getElementById(containerId);
  const row = document.createElement("div");
  row.className = "spec-row";
  row.innerHTML = `
    <input class="spec-label" placeholder="e.g. Body Material" value="${label || ""}">
    <input class="spec-value" placeholder="e.g. ABS Plastic" value="${value || ""}">
    <button type="button" onclick="this.closest('.spec-row').remove()">×</button>
  `;
  container.appendChild(row);
}

function renderSpecRows(containerId, specs) {
  const container = document.getElementById(containerId);
  container.innerHTML = "";
  (specs || []).forEach(s => addSpecRow(containerId, s.label, s.value));
}

function collectSpecs(containerId) {
  const rows = document.querySelectorAll(`#${containerId} .spec-row`);
  const specs = [];

  rows.forEach(row => {
    const label = row.querySelector(".spec-label").value.trim();
    const value = row.querySelector(".spec-value").value.trim();
    if (label && value) specs.push({ label, value });
  });

  return specs;
}

async function updateProduct() {
  const name = document.getElementById("editName").value;
  const name_hi = document.getElementById("editNameHi").value.trim() || null;
  const description = document.getElementById("editDescription").value.trim() || null;
  const description_hi = document.getElementById("editDescriptionHi").value.trim() || null;
  const brand = document.getElementById("editBrand").value.trim() || null;
  const price = Number(document.getElementById("editPrice").value);
  const mrp = Number(document.getElementById("editMrp").value) || null;
  const featured_section = document.getElementById("editFeaturedSection").value.trim() || null;
  const featured_order = Number(document.getElementById("editFeaturedOrder").value) || 0;
  const store = document.getElementById("editStore").value;
  const category = getSelectedProductCategory("editCategory", "editSubCategory");
  const variants = collectVariants("editVariants");
  const specs = collectSpecs("editSpecs");
  const deliver_to_all_extra_zones = document.getElementById("editHasExtraAreas").checked;

  let images = [...editRemainingImages];
  const files = document.getElementById("editImage").files;

  for (const file of files) {
    const ext = file.name.split(".").pop();
    const path = `edit/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;

    const { error: uploadError } = await supabase.storage
      .from(PRODUCT_IMAGES_BUCKET)
      .upload(path, file, { upsert: false });

    if (uploadError) {
      alert("Image upload failed: " + uploadError.message);
      continue;
    }
    images.push(getProductImageUrl(path));
  }

  if (images.length === 0) {
    alert("A product needs at least one image");
    return;
  }

  const updateData = { name, name_hi, description, description_hi, brand, price, mrp, store, category, images, variants, specs, featured_section, featured_order, deliver_to_all_extra_zones };

  const { error } = await supabase.from("products").update(updateData).eq("id", editingProductId);

  if (error) {
    alert("Could not update product: " + error.message);
    return;
  }

  alert("Product updated");
  closeEdit();
  loadProducts();
}

async function deleteProduct(id) {
  if (!(await customConfirm("Delete this product? This can't be undone.", "Delete"))) return;

  const { error } = await supabase.from("products").delete().eq("id", id);

  if (error) {
    alert("Could not delete: " + error.message);
    return;
  }

  loadProducts();
}

/***********************
    CATEGORIES
************************/

async function loadCategoriesView() {
  const treeEl = document.getElementById("categoriesTree");
  treeEl.innerHTML = `<p style="text-align:center;color:var(--ink-faint);padding:20px 0;">Loading…</p>`;

  const [{ data: rows, error }, { data: productRows, error: productsError }] = await Promise.all([
    supabase.from("categories").select("*").order("store").order("name"),
    // Just enough columns to count active/inactive products per
    // category — the full product record isn't needed here.
    supabase.from("products").select("category, store, in_stock")
  ]);

  if (error) {
    treeEl.innerHTML = `<p style="color:var(--ink-faint);">Could not load categories</p>`;
    return;
  }

  allCategoriesCache = rows || [];

  // "store::category name" -> { active, inactive } — a category name
  // is only unique within its own store, so both are part of the key.
  categoryProductCounts = {};
  if (!productsError) {
    (productRows || []).forEach(p => {
      const key = `${p.store}::${p.category}`;
      if (!categoryProductCounts[key]) categoryProductCounts[key] = { active: 0, inactive: 0 };
      categoryProductCounts[key][p.in_stock ? "active" : "inactive"]++;
    });
  }

  categoriesPage = 1;
  renderCategoriesTree(allCategoriesCache);
  populateParentCategoryDropdown("catParent", document.getElementById("catStore").value);
}

let currentCategoriesList = [];
let categoryProductCounts = {};
let categoriesPage = 1;
const CATEGORIES_PAGE_SIZE = 12;

// Which main-category cards currently have their sub-categories
// hidden — collapsed by id, expanded (shown) by default, matching
// how the list always looked before this toggle existed.
const collapsedCategoryIds = new Set();

function toggleSubcategoriesVisible(mainId) {
  if (collapsedCategoryIds.has(mainId)) {
    collapsedCategoryIds.delete(mainId);
  } else {
    collapsedCategoryIds.add(mainId);
  }
  renderCategoriesTree(currentCategoriesList);
}

/** Small "N active • N inactive" (plus "N sub-categories" for a main
 *  category) label shown next to a category/sub-category's name, so
 *  an admin can see at a glance how full or empty it is without
 *  opening the Products tab. */
function categoryStatsHtml(cat, subCount) {
  const counts = categoryProductCounts[`${cat.store}::${cat.name}`] || { active: 0, inactive: 0 };
  const parts = [];
  if (subCount !== undefined) {
    parts.push(`${subCount} sub-categor${subCount === 1 ? "y" : "ies"}`);
  }
  parts.push(`${counts.active} active`);
  parts.push(`${counts.inactive} inactive`);
  return `<span class="cat-tree-stats">${parts.join(" · ")}</span>`;
}

function goToCategoriesPage(n) {
  categoriesPage = n;
  renderCategoriesTree(currentCategoriesList);
  document.getElementById("categoriesTree").scrollIntoView({ behavior: "smooth", block: "start" });
}

/** Switches the Add Category form between "Main Category" (no
 *  parent, shows as a big tile) and "Sub-Category" (must pick a
 *  parent) — two clearly separate modes instead of one form with an
 *  easy-to-miss optional dropdown. */
function setCategoryFormType(type) {
  document.querySelectorAll(".cat-type-btn").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.type === type);
  });

  const parentWrap = document.getElementById("catParentWrap");
  const hint = document.getElementById("catFormHint");

  if (type === "sub") {
    parentWrap.classList.remove("hidden");
    hint.textContent = "Pick which main category this nests under — it'll show up when a customer taps that tile.";
    populateParentCategoryDropdown("catParent", document.getElementById("catStore").value);
  } else {
    parentWrap.classList.add("hidden");
    document.getElementById("catParent").value = "";
    hint.textContent = "Main categories are the big tiles a customer sees first on the store page — e.g. \"Furniture\", \"Groceries\".";
  }
}

/** Jumps to the Add Category form pre-set to add a sub-category
 *  under a specific main category — used by the "+ Sub-category"
 *  button on each main-category card, so there's no need to
 *  remember and re-select the parent from a long dropdown. */
function quickAddSubcategory(parentId, parentName, store) {
  setCategoryFormType("sub");
  document.getElementById("catStore").value = store;
  populateParentCategoryDropdown("catParent", store);
  document.getElementById("catParent").value = parentId;
  document.getElementById("catName").value = "";
  document.getElementById("catNameHi").value = "";
  document.getElementById("catName").focus();
  document.getElementById("catName").scrollIntoView({ behavior: "smooth", block: "center" });
}

/** Fills a "Parent Category" dropdown with the top-level (no parent
 *  of their own) categories for one store — a category can only be
 *  nested one level deep, so a category that's already a
 *  sub-category never shows up here as a choice for parent. */
function populateParentCategoryDropdown(selectId, store, excludeId) {
  const select = document.getElementById(selectId);
  if (!select) return;

  const topLevel = allCategoriesCache.filter(c =>
    c.store === store && !c.parent_id && c.id !== excludeId
  );

  select.innerHTML = `<option value="">— Choose a main category —</option>` +
    topLevel.map(c => `<option value="${c.id}">${c.name}</option>`).join("");
}

/** Renders categories as a grouped tree — each main category as its
 *  own card with its sub-categories nested underneath, instead of a
 *  flat table where the parent/child relationship isn't visible at
 *  a glance. `list` may be a search-filtered subset — if a
 *  sub-category matches but its parent's name doesn't, the parent
 *  card still renders (pulled from the full cache) so the match has
 *  somewhere to show up. */
function renderCategoriesTree(list) {
  currentCategoriesList = list;
  const treeEl = document.getElementById("categoriesTree");

  const matchedIds = new Set(list.map(c => c.id));
  const mainsToShow = new Map();
  const subsByParentToShow = {};

  list.forEach(c => {
    if (!c.parent_id) {
      mainsToShow.set(c.id, c);
    } else {
      const parent = allCategoriesCache.find(p => p.id === c.parent_id);
      if (parent) mainsToShow.set(parent.id, parent);
      if (!subsByParentToShow[c.parent_id]) subsByParentToShow[c.parent_id] = [];
      subsByParentToShow[c.parent_id].push(c);
    }
  });

  const allMains = [...mainsToShow.values()].sort((a, b) => a.name.localeCompare(b.name));

  const totalPages = Math.max(1, Math.ceil(allMains.length / CATEGORIES_PAGE_SIZE));
  if (categoriesPage > totalPages) categoriesPage = totalPages;
  const mains = paginateArray(allMains, categoriesPage, CATEGORIES_PAGE_SIZE);

  const cardsHtml = mains.map(main => {
    // If the main category itself matched the search, show every one
    // of its sub-categories (not just ones that happened to match
    // too) — only when a main is showing up SOLELY because a child
    // matched do we narrow the list down to just that child.
    const mainMatchedDirectly = matchedIds.has(main.id);
    const subs = mainMatchedDirectly
      ? allCategoriesCache.filter(c => c.parent_id === main.id).sort((a, b) => a.name.localeCompare(b.name))
      : (subsByParentToShow[main.id] || []);

    const isCollapsed = collapsedCategoryIds.has(main.id);

    const subsHtml = subs.map(sub => `
        <div class="cat-tree-sub">
          <div class="cat-tree-sub-info">
            <span class="cat-tree-sub-arrow">↳</span>
            ${sub.icon_url ? `<img src="${sub.icon_url}" alt="" class="cat-tree-icon" />` : ""}
            <span>${sub.name}${sub.name_hi ? `<span class="cat-tree-hi"> (${sub.name_hi})</span>` : ""}</span>
            ${categoryStatsHtml(sub)}
          </div>
          <div class="table-actions">
            <button onclick='editCategory(${jsonAttr(sub)})'>Edit</button>
            <button class="danger" onclick="deleteCategory('${sub.id}')">Delete</button>
          </div>
        </div>
      `).join("");

    return `
        <div class="cat-tree-group">
          <div class="cat-tree-main">
            <div class="cat-tree-main-info">
              ${main.icon_url ? `<img src="${main.icon_url}" alt="" class="cat-tree-icon" />` : `<i class="fa-solid fa-folder" style="color:var(--marigold-600);"></i>`}
              <strong>${main.name}</strong>
              ${main.name_hi ? `<span class="cat-tree-hi">${main.name_hi}</span>` : ""}
              <span class="cat-tree-store-tag">${main.store}</span>
              ${categoryStatsHtml(main, subs.length)}
            </div>
            <div class="table-actions">
              ${subs.length > 0 ? `<button onclick="toggleSubcategoriesVisible('${main.id}')">${isCollapsed ? `Show Sub-categories (${subs.length})` : "Hide Sub-categories"}</button>` : ""}
              <button onclick="quickAddSubcategory('${main.id}', '${main.name.replace(/'/g, "\\'")}', '${main.store}')">+ Sub-category</button>
              <button onclick='editCategory(${jsonAttr(main)})'>Edit</button>
              <button class="danger" onclick="deleteCategory('${main.id}')">Delete</button>
            </div>
          </div>
          ${subsHtml && !isCollapsed ? `<div class="cat-tree-subs">${subsHtml}</div>` : ""}
        </div>
      `;
  }).join("");

  treeEl.innerHTML = cardsHtml || `<p style="text-align:center;color:var(--ink-faint);padding:20px 0;">No categories found</p>`;

  renderPagination("categoriesPagination", allMains.length, categoriesPage, CATEGORIES_PAGE_SIZE, "goToCategoriesPage");
}

function filterCategories() {
  const q = document.getElementById("categorySearch").value.toLowerCase();
  const storeFilter = document.getElementById("categoryStoreFilter").value;

  const filtered = allCategoriesCache.filter(c =>
    c.name.toLowerCase().includes(q) &&
    (!storeFilter || c.store === storeFilter)
  );

  categoriesPage = 1;
  renderCategoriesTree(filtered);
}

/** Shared by both the Add Category form and the Edit Category modal
 *  — just updates the little preview thumbnail, the actual upload
 *  happens on save (see uploadCategoryIconIfSelected). */
function handleCategoryIconSelected(input, previewId, textId) {
  const file = input.files && input.files[0];
  const preview = document.getElementById(previewId);
  const text = document.getElementById(textId);

  if (!file) {
    if (preview) { preview.classList.add("hidden"); preview.src = ""; }
    if (text) text.classList.remove("hidden");
    return;
  }

  if (preview) {
    preview.src = URL.createObjectURL(file);
    preview.classList.remove("hidden");
  }
  if (text) text.classList.add("hidden");
}

/** Uploads whatever file is currently picked in the given input (if
 *  any) to the category-icons bucket and returns its public URL.
 *  Returns undefined if nothing was picked (caller should then keep
 *  whatever icon_url the category already had), or null if the
 *  upload itself failed (an alert is already shown either way). */
async function uploadCategoryIconIfSelected(inputId) {
  const input = document.getElementById(inputId);
  const file = input && input.files && input.files[0];
  if (!file) return undefined;

  const fileExt = (file.name.split(".").pop() || "png").toLowerCase();
  const filePath = `${Date.now()}-${Math.random().toString(36).slice(2)}.${fileExt}`;

  const { error } = await supabase.storage.from("category-icons").upload(filePath, file);
  if (error) {
    alert("Could not upload icon, saving without it: " + error.message);
    return null;
  }

  const { data } = supabase.storage.from("category-icons").getPublicUrl(filePath);
  return data.publicUrl;
}

function resetCategoryIconPicker(inputId, previewId, textId) {
  const input = document.getElementById(inputId);
  const preview = document.getElementById(previewId);
  const text = document.getElementById(textId);
  if (input) input.value = "";
  if (preview) { preview.classList.add("hidden"); preview.src = ""; }
  if (text) text.classList.remove("hidden");
}

async function addCategory() {
  const isSubMode = document.querySelector(".cat-type-btn.active")?.dataset.type === "sub";
  const store = document.getElementById("catStore").value;
  const name = document.getElementById("catName").value.trim();
  const name_hi = document.getElementById("catNameHi").value.trim() || null;
  const parent_id = document.getElementById("catParent").value || null;

  if (!name) { alert("Enter a category name"); return; }
  if (isSubMode && !parent_id) { alert("Pick a main category for this sub-category to nest under"); return; }

  const icon_url = await uploadCategoryIconIfSelected("catIconInput");
  if (icon_url === null) return; // upload failed, alert already shown

  const { error } = await supabase.from("categories").insert({ store, name, name_hi, parent_id, icon_url: icon_url || null });

  if (error) {
    alert(error.code === "23505" ? "That category already exists" : "Could not add: " + error.message);
    return;
  }

  document.getElementById("catName").value = "";
  document.getElementById("catNameHi").value = "";
  if (!isSubMode) document.getElementById("catParent").value = "";
  resetCategoryIconPicker("catIconInput", "catIconPreview", "catIconUploadText");
  loadCategoriesView();
}

async function deleteCategory(id) {
  if (!(await customConfirm("Delete this category? Products already in it are unaffected. Any sub-categories under it will be deleted too.", "Delete"))) return;
  const { error } = await supabase.from("categories").delete().eq("id", id);
  if (error) { alert("Could not delete: " + error.message); return; }
  loadCategoriesView();
}

let editingCategoryId = null;

function editCategory(c) {
  editingCategoryId = c.id;
  document.getElementById("editCatStore").value = c.store;
  document.getElementById("editCatName").value = c.name;
  document.getElementById("editCatNameHi").value = c.name_hi || "";
  populateParentCategoryDropdown("editCatParent", c.store, c.id);
  document.getElementById("editCatParent").value = c.parent_id || "";

  resetCategoryIconPicker("editCatIconInput", "editCatIconPreview", "editCatIconUploadText");
  if (c.icon_url) {
    const preview = document.getElementById("editCatIconPreview");
    const text = document.getElementById("editCatIconUploadText");
    if (preview) { preview.src = c.icon_url; preview.classList.remove("hidden"); }
    if (text) text.classList.add("hidden");
  }

  document.getElementById("editCategoryModal").classList.remove("hidden");
}

function closeCategoryEdit() {
  document.getElementById("editCategoryModal").classList.add("hidden");
}

async function updateCategory() {
  const store = document.getElementById("editCatStore").value;
  const name = document.getElementById("editCatName").value.trim();
  const name_hi = document.getElementById("editCatNameHi").value.trim() || null;
  const parent_id = document.getElementById("editCatParent").value || null;

  if (!name) { alert("Enter a category name"); return; }

  if (parent_id === editingCategoryId) {
    alert("A category can't be its own parent");
    return;
  }

  // Remember the old store/name so we can re-tag any products that
  // were filed under it — otherwise renaming a category silently
  // orphans its products (they'd keep pointing at a name that no
  // longer exists anywhere).
  const before = allCategoriesCache.find(c => c.id === editingCategoryId);

  const newIconUrl = await uploadCategoryIconIfSelected("editCatIconInput");
  if (newIconUrl === null) return; // upload failed, alert already shown
  // undefined means "nothing new was picked" — keep whatever icon
  // this category already had instead of wiping it out.
  const icon_url = newIconUrl !== undefined ? newIconUrl : (before ? before.icon_url : null);

  const { error } = await supabase
    .from("categories")
    .update({ store, name, name_hi, parent_id, icon_url })
    .eq("id", editingCategoryId);

  if (error) {
    alert(error.code === "23505" ? "A category with that name already exists in that store" : "Could not update: " + error.message);
    return;
  }

  if (before && (before.name !== name || before.store !== store)) {
    const { error: productsError } = await supabase
      .from("products")
      .update({ category: name, store })
      .eq("category", before.name)
      .eq("store", before.store);

    if (productsError) {
      alert("Category renamed, but couldn't re-tag its products: " + productsError.message);
    }
  }

  closeCategoryEdit();
  loadCategoriesView();
}

/***********************
    COUPONS
************************/

async function loadCoupons() {
  const body = document.getElementById("couponsBody");
  body.innerHTML = `<tr><td colspan="6" style="text-align:center;">Loading…</td></tr>`;

  const { data: rows, error } = await supabase
    .from("coupons")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    body.innerHTML = `<tr><td colspan="6">Could not load coupons</td></tr>`;
    return;
  }

  if (!rows || rows.length === 0) {
    body.innerHTML = `<tr><td colspan="6" style="text-align:center;color:var(--ink-faint);">No coupons yet</td></tr>`;
    return;
  }

  couponsPage = 1;
  renderCouponsTable(rows);
}

let couponsPage = 1;
let currentCouponsList = [];

function renderCouponsTable(list) {
  currentCouponsList = list;
  const body = document.getElementById("couponsBody");

  if (list.length === 0) {
    body.innerHTML = `<tr><td colspan="6" style="text-align:center;color:var(--ink-faint);">No coupons yet</td></tr>`;
    document.getElementById("couponsPagination").innerHTML = "";
    return;
  }

  const pageItems = paginateArray(list, couponsPage, PAGE_SIZE);

  body.innerHTML = pageItems.map(c => `
    <tr>
      <td class="cell-title">${c.code}</td>
      <td data-label="Discount">${c.discount_type === "percent" ? c.discount_value + "%" : "₹" + c.discount_value}</td>
      <td data-label="Min Order">₹${c.min_order}</td>
      <td data-label="Used">${c.used_count}${c.usage_limit ? " / " + c.usage_limit : ""}</td>
      <td data-label="Status"><span class="status-pill ${c.active ? 'DELIVERED' : 'CANCELLED'}">${c.active ? "Active" : "Off"}</span></td>
      <td>
        <div class="table-actions">
          <button onclick='editCoupon(${jsonAttr(c)})'>Edit</button>
          <button onclick="toggleCoupon('${c.id}', ${!c.active})">${c.active ? "Deactivate" : "Activate"}</button>
          <button class="danger" onclick="deleteCoupon('${c.id}')">Delete</button>
        </div>
      </td>
    </tr>
  `).join("");

  renderPagination("couponsPagination", list.length, couponsPage, PAGE_SIZE, "goToCouponsPage");
}

function goToCouponsPage(n) {
  couponsPage = n;
  renderCouponsTable(currentCouponsList);
}

async function addCoupon() {
  const code = document.getElementById("couponCodeInput").value.trim();
  const discount_type = document.getElementById("couponType").value;
  const discount_value = Number(document.getElementById("couponValue").value);
  const min_order = Number(document.getElementById("couponMinOrder").value) || 0;
  const usageLimitRaw = document.getElementById("couponUsageLimit").value;
  const usage_limit = usageLimitRaw ? Number(usageLimitRaw) : null;

  if (!code || !discount_value) {
    alert("Enter a code and a discount value");
    return;
  }

  const { error } = await supabase.from("coupons").insert({
    code, discount_type, discount_value, min_order, usage_limit
  });

  if (error) {
    alert(error.code === "23505" ? "That coupon code already exists" : "Could not create: " + error.message);
    return;
  }

  document.getElementById("couponCodeInput").value = "";
  document.getElementById("couponValue").value = "";
  document.getElementById("couponMinOrder").value = "";
  document.getElementById("couponUsageLimit").value = "";

  loadCoupons();
}

async function toggleCoupon(id, active) {
  const { error } = await supabase.from("coupons").update({ active }).eq("id", id);
  if (error) { alert("Could not update: " + error.message); return; }
  loadCoupons();
}

let editingCouponId = null;

function editCoupon(c) {
  editingCouponId = c.id;
  document.getElementById("editCouponCode").value = c.code;
  document.getElementById("editCouponType").value = c.discount_type;
  document.getElementById("editCouponValue").value = c.discount_value;
  document.getElementById("editCouponMinOrder").value = c.min_order;
  document.getElementById("editCouponUsageLimit").value = c.usage_limit || "";
  document.getElementById("editCouponModal").classList.remove("hidden");
}

function closeCouponEdit() {
  document.getElementById("editCouponModal").classList.add("hidden");
}

async function updateCoupon() {
  const code = document.getElementById("editCouponCode").value.trim();
  const discount_type = document.getElementById("editCouponType").value;
  const discount_value = Number(document.getElementById("editCouponValue").value);
  const min_order = Number(document.getElementById("editCouponMinOrder").value) || 0;
  const usageLimitRaw = document.getElementById("editCouponUsageLimit").value;
  const usage_limit = usageLimitRaw ? Number(usageLimitRaw) : null;

  if (!code || !discount_value) {
    alert("Enter a code and a discount value");
    return;
  }

  const { error } = await supabase
    .from("coupons")
    .update({ code, discount_type, discount_value, min_order, usage_limit })
    .eq("id", editingCouponId);

  if (error) {
    alert(error.code === "23505" ? "That coupon code already exists" : "Could not update: " + error.message);
    return;
  }

  closeCouponEdit();
  loadCoupons();
}

async function deleteCoupon(id) {
  if (!(await customConfirm("Delete this coupon?", "Delete"))) return;
  const { error } = await supabase.from("coupons").delete().eq("id", id);
  if (error) { alert("Could not delete: " + error.message); return; }
  loadCoupons();
}

/***********************
    ABANDONED CARTS
    Live cart snapshots (see cart_snapshots table) synced by the
    storefront whenever a logged-in customer's cart changes. Nothing
    here sends anything automatically — every row's WhatsApp button
    just opens a pre-filled chat for the admin to send themselves.
************************/

/** "2h 15m ago" — plain and readable, no library needed for a
 *  single relative-time string. */
function timeAgoText(isoString) {
  const diffMs = Date.now() - new Date(isoString).getTime();
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  const remMinutes = minutes % 60;
  if (hours < 24) return `${hours}h ${remMinutes}m ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

async function loadAbandonedCarts() {
  const box = document.getElementById("abandonedCartsList");
  box.innerHTML = "Loading…";

  const { data: rows, error } = await supabase
    .from("cart_snapshots")
    .select("*")
    .order("updated_at", { ascending: true });

  if (error) {
    box.innerHTML = `<p style="color:var(--danger-600);">Could not load abandoned carts: ${error.message}</p>`;
    return;
  }

  if (!rows || rows.length === 0) {
    box.innerHTML = `<p style="text-align:center;color:var(--ink-faint);">No live carts right now — every logged-in customer's cart is empty.</p>`;
    return;
  }

  const ABANDONED_AFTER_MS = 2 * 60 * 60 * 1000; // matches the storefront's own reminder-banner threshold

  box.innerHTML = rows.map(row => {
    const isStale = Date.now() - new Date(row.updated_at).getTime() > ABANDONED_AFTER_MS;
    const itemsSummary = (row.items || []).map(it => `${it.name} × ${it.qty}`).join(", ");

    const digitsOnly = String(row.phone || "").replace(/\D/g, "");
    const fullNumber = digitsOnly.length === 10 ? "91" + digitsOnly : digitsOnly;
    const message = `Hi! We noticed you left some items (${itemsSummary}) in your AOne Bazaar cart worth ₹${row.total}. Still interested? We can help you complete the order — just reply here!

नमस्ते! हमने देखा कि आपने अपने AOne Bazaar कार्ट में कुछ सामान (${itemsSummary}), कुल ₹${row.total} का, छोड़ दिया है। क्या अभी भी दिलचस्पी है? हम आपका ऑर्डर पूरा करने में मदद कर सकते हैं — बस यहीं रिप्लाई करें!`;
    const waLink = `https://wa.me/${fullNumber}?text=${encodeURIComponent(message)}`;

    return `
      <div class="cat-tree-group">
        <div class="cat-tree-main">
          <div class="cat-tree-main-info">
            <i class="fa-solid fa-cart-shopping" style="color:${isStale ? "var(--danger-600)" : "var(--marigold-600)"};"></i>
            <strong>${row.phone || "Unknown number"}</strong>
            <span class="status-pill ${isStale ? "CANCELLED" : "PROCESSING"}">${isStale ? "Abandoned" : "Active"}</span>
            <span class="cat-tree-stats">${timeAgoText(row.updated_at)} · ₹${row.total}</span>
          </div>
          <div class="table-actions">
            <a class="btn btn-primary btn-sm" href="${waLink}" target="_blank" rel="noopener noreferrer">
              <i class="fa-brands fa-whatsapp"></i> Message on WhatsApp
            </a>
          </div>
        </div>
        <div style="padding:10px 0 4px 30px;font-size:0.85rem;color:var(--ink-soft);">${itemsSummary || "No items"}</div>
      </div>
    `;
  }).join("");
}

/***********************
    DELIVERY AREAS
************************/

async function loadDeliveryAreas() {
  const body = document.getElementById("deliveryAreasBody");
  body.innerHTML = `<tr><td colspan="4" style="text-align:center;">Loading…</td></tr>`;

  const { data: rows, error } = await supabase
    .from("delivery_areas")
    .select("*")
    .order("area_name");

  if (error) {
    body.innerHTML = `<tr><td colspan="4">Could not load delivery areas</td></tr>`;
    return;
  }

  deliveryAreasPage = 1;
  renderDeliveryAreasTable(rows || []);
}

let deliveryAreasPage = 1;
let currentDeliveryAreasList = [];

function renderDeliveryAreasTable(list) {
  currentDeliveryAreasList = list;
  const body = document.getElementById("deliveryAreasBody");

  if (list.length === 0) {
    body.innerHTML = `<tr><td colspan="5" style="text-align:center;color:var(--ink-faint);">No delivery areas added yet</td></tr>`;
    document.getElementById("deliveryAreasPagination").innerHTML = "";
    return;
  }

  const pageItems = paginateArray(list, deliveryAreasPage, PAGE_SIZE);

  body.innerHTML = pageItems.map(a => `
    <tr>
      <td class="cell-title">${a.area_name}</td>
      <td data-label="ETA">${a.eta_text}</td>
      <td data-label="Delivery Charge">${a.delivery_charge != null ? "₹" + a.delivery_charge : `<span style="color:var(--ink-faint);">Site default</span>`}</td>
      <td data-label="Status"><span class="status-pill ${a.active ? 'DELIVERED' : 'CANCELLED'}">${a.active ? "Active" : "Off"}</span></td>
      <td>
        <div class="table-actions">
          <button onclick='editDeliveryArea(${jsonAttr(a)})'>Edit</button>
          <button onclick="toggleDeliveryArea('${a.id}', ${!a.active})">${a.active ? "Deactivate" : "Activate"}</button>
          <button class="danger" onclick="deleteDeliveryArea('${a.id}')">Delete</button>
        </div>
      </td>
    </tr>
  `).join("");

  renderPagination("deliveryAreasPagination", list.length, deliveryAreasPage, PAGE_SIZE, "goToDeliveryAreasPage");
}

function goToDeliveryAreasPage(n) {
  deliveryAreasPage = n;
  renderDeliveryAreasTable(currentDeliveryAreasList);
}

async function addDeliveryArea() {
  const area_name = document.getElementById("areaNameInput").value.trim();
  const eta_text = document.getElementById("areaEtaInput").value.trim() || "30–60 min";
  const chargeInput = document.getElementById("areaChargeInput").value.trim();
  const delivery_charge = chargeInput === "" ? null : Number(chargeInput);

  if (!area_name) {
    alert("Enter an area / locality name");
    return;
  }

  const { error } = await supabase.from("delivery_areas").insert({ area_name, eta_text, delivery_charge });

  if (error) {
    alert("Could not add: " + error.message);
    return;
  }

  document.getElementById("areaNameInput").value = "";
  document.getElementById("areaEtaInput").value = "30–60 min";
  document.getElementById("areaChargeInput").value = "";

  loadDeliveryAreas();
}

async function toggleDeliveryArea(id, active) {
  const { error } = await supabase.from("delivery_areas").update({ active }).eq("id", id);
  if (error) { alert("Could not update: " + error.message); return; }
  loadDeliveryAreas();
}

let editingAreaId = null;

function editDeliveryArea(a) {
  editingAreaId = a.id;
  document.getElementById("editAreaName").value = a.area_name;
  document.getElementById("editAreaEta").value = a.eta_text;
  document.getElementById("editAreaCharge").value = a.delivery_charge != null ? a.delivery_charge : "";
  document.getElementById("editAreaModal").classList.remove("hidden");
}

function closeAreaEdit() {
  document.getElementById("editAreaModal").classList.add("hidden");
}

async function updateDeliveryArea() {
  const area_name = document.getElementById("editAreaName").value.trim();
  const eta_text = document.getElementById("editAreaEta").value.trim() || "30–60 min";
  const chargeInput = document.getElementById("editAreaCharge").value.trim();
  const delivery_charge = chargeInput === "" ? null : Number(chargeInput);

  if (!area_name) {
    alert("Enter an area / locality name");
    return;
  }

  const { error } = await supabase
    .from("delivery_areas")
    .update({ area_name, eta_text, delivery_charge })
    .eq("id", editingAreaId);

  if (error) { alert("Could not update: " + error.message); return; }

  closeAreaEdit();
  loadDeliveryAreas();
}

async function deleteDeliveryArea(id) {
  if (!(await customConfirm("Delete this delivery area?", "Delete"))) return;
  const { error } = await supabase.from("delivery_areas").delete().eq("id", id);
  if (error) { alert("Could not delete: " + error.message); return; }
  loadDeliveryAreas();
}

/***********************
    REVIEWS
************************/

async function loadReviews() {
  const body = document.getElementById("reviewsBody");
  body.innerHTML = `<tr><td colspan="6" style="text-align:center;">Loading…</td></tr>`;

  const { data: rows, error } = await supabase
    .from("reviews")
    .select("*, products(name)")
    .order("created_at", { ascending: false });

  if (error) {
    body.innerHTML = `<tr><td colspan="6">Could not load reviews</td></tr>`;
    console.error(error);
    return;
  }

  if (!rows || rows.length === 0) {
    body.innerHTML = `<tr><td colspan="6" style="text-align:center;color:var(--ink-faint);">No reviews yet</td></tr>`;
    return;
  }

  reviewsPage = 1;
  renderReviewsTable(rows);
}

let reviewsPage = 1;
let currentReviewsList = [];

function renderReviewsTable(list) {
  currentReviewsList = list;
  const body = document.getElementById("reviewsBody");

  if (list.length === 0) {
    body.innerHTML = `<tr><td colspan="6" style="text-align:center;color:var(--ink-faint);">No reviews yet</td></tr>`;
    document.getElementById("reviewsPagination").innerHTML = "";
    return;
  }

  const pageItems = paginateArray(list, reviewsPage, PAGE_SIZE);

  body.innerHTML = pageItems.map(r => `
    <tr>
      <td class="cell-title">${r.products ? r.products.name : "(deleted product)"}</td>
      <td data-label="Rating">${"★".repeat(r.rating)}${"☆".repeat(5 - r.rating)}</td>
      <td data-label="Comment">${r.comment || "—"}</td>
      <td data-label="By">${r.customer_name}</td>
      <td data-label="Date">${new Date(r.created_at).toLocaleDateString()}</td>
      <td><button class="danger" onclick="deleteReview('${r.id}')">Delete</button></td>
    </tr>
  `).join("");

  renderPagination("reviewsPagination", list.length, reviewsPage, PAGE_SIZE, "goToReviewsPage");
}

function goToReviewsPage(n) {
  reviewsPage = n;
  renderReviewsTable(currentReviewsList);
}

async function deleteReview(id) {
  if (!(await customConfirm("Delete this review?", "Delete"))) return;
  const { error } = await supabase.from("reviews").delete().eq("id", id);
  if (error) { alert("Could not delete: " + error.message); return; }
  loadReviews();
}

/***********************
    SITE CONTENT
************************/

async function loadSiteContentForm() {
  const { data: rows, error } = await supabase.from("site_content").select("key, value");
  if (error) { console.error(error); return; }

  const content = {};
  (rows || []).forEach(r => { content[r.key] = r.value; });

  document.getElementById("cf_hero_title").value = content.hero_title || "";
  document.getElementById("cf_hero_subtitle").value = content.hero_subtitle || "";
  document.getElementById("cf_banner_active").checked = content.banner_active === "true";
  document.getElementById("cf_banner_text").value = content.banner_text || "";
  document.getElementById("cf_about_intro").value = content.about_intro || "";
  document.getElementById("cf_contact_phone").value = content.contact_phone || "";
  document.getElementById("cf_contact_whatsapp").value = content.contact_whatsapp || "";
  document.getElementById("cf_contact_address").value = content.contact_address || "";
  document.getElementById("cf_contact_hours").value = content.contact_hours || "";
  document.getElementById("cf_contact_map_url").value = content.contact_map_url || "";
  document.getElementById("cf_upi_id").value = content.upi_id || "";
  document.getElementById("cf_min_order").value = content.min_order || "100";
  document.getElementById("cf_delivery_charge").value = content.delivery_charge || "30";
  document.getElementById("cf_free_delivery_threshold").value = content.free_delivery_threshold || "300";
  document.getElementById("cf_social_facebook").value = content.social_facebook || "";
  document.getElementById("cf_social_instagram").value = content.social_instagram || "";
  document.getElementById("cf_social_whatsapp").value = content.social_whatsapp || "";
  document.getElementById("cf_social_youtube").value = content.social_youtube || "";
  document.getElementById("cf_social_twitter").value = content.social_twitter || "";
  document.getElementById("cf_social_linkedin").value = content.social_linkedin || "";
  document.getElementById("cf_legal_privacy").value = content.legal_privacy_html || "";
  document.getElementById("cf_legal_terms").value = content.legal_terms_html || "";
  document.getElementById("cf_legal_refund").value = content.legal_refund_html || "";
}

async function saveSiteContent() {
  const updates = {
    hero_title: document.getElementById("cf_hero_title").value.trim(),
    hero_subtitle: document.getElementById("cf_hero_subtitle").value.trim(),
    banner_active: document.getElementById("cf_banner_active").checked ? "true" : "false",
    banner_text: document.getElementById("cf_banner_text").value.trim(),
    about_intro: document.getElementById("cf_about_intro").value.trim(),
    contact_phone: document.getElementById("cf_contact_phone").value.trim(),
    contact_whatsapp: document.getElementById("cf_contact_whatsapp").value.trim(),
    contact_address: document.getElementById("cf_contact_address").value.trim(),
    contact_hours: document.getElementById("cf_contact_hours").value.trim(),
    contact_map_url: document.getElementById("cf_contact_map_url").value.trim(),
    upi_id: document.getElementById("cf_upi_id").value.trim(),
    min_order: document.getElementById("cf_min_order").value.trim() || "100",
    delivery_charge: document.getElementById("cf_delivery_charge").value.trim() || "30",
    free_delivery_threshold: document.getElementById("cf_free_delivery_threshold").value.trim() || "300",
    social_facebook: document.getElementById("cf_social_facebook").value.trim(),
    social_instagram: document.getElementById("cf_social_instagram").value.trim(),
    social_whatsapp: document.getElementById("cf_social_whatsapp").value.trim(),
    social_youtube: document.getElementById("cf_social_youtube").value.trim(),
    social_twitter: document.getElementById("cf_social_twitter").value.trim(),
    social_linkedin: document.getElementById("cf_social_linkedin").value.trim(),
    legal_privacy_html: document.getElementById("cf_legal_privacy").value.trim(),
    legal_terms_html: document.getElementById("cf_legal_terms").value.trim(),
    legal_refund_html: document.getElementById("cf_legal_refund").value.trim()
  };

  const rows = Object.entries(updates).map(([key, value]) => ({ key, value }));
  const { error } = await supabase.from("site_content").upsert(rows, { onConflict: "key" });

  if (error) { alert("Could not save: " + error.message); return; }
  alert("Site content saved!");
}

/***********************
    USERS
************************/

let allUsersCache = [];

async function loadUsers() {
  const body = document.getElementById("usersBody");
  body.innerHTML = `<tr><td colspan="6" style="text-align:center;">Loading…</td></tr>`;

  const { data: rows, error } = await supabase
    .from("profiles")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    body.innerHTML = `<tr><td colspan="6">Could not load users</td></tr>`;
    console.error(error);
    return;
  }

  allUsersCache = rows || [];
  usersPage = 1;
  renderUsersTable(applyUsersFilters());
}

let usersPage = 1;
let currentUsersList = [];
let usersRoleFilter = "all"; // "all" | "customer" | "admin"

function setUsersRoleFilter(role) {
  usersRoleFilter = role;
  document.querySelectorAll("#view-users .cat-type-btn").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.role === role);
  });
  filterUsers();
}

/** Combines the search box and the All/Customers/Admins tabs into
 *  one filtered list — kept as its own function so both loadUsers()
 *  and filterUsers() apply the exact same rules. */
function applyUsersFilters() {
  const q = (document.getElementById("userSearch")?.value || "").toLowerCase();

  return allUsersCache.filter(u => {
    const matchesRole = usersRoleFilter === "all" || u.role === usersRoleFilter;
    const matchesSearch = !q ||
      (u.full_name || "").toLowerCase().includes(q) ||
      (u.email || "").toLowerCase().includes(q) ||
      (u.phone || "").toLowerCase().includes(q);
    return matchesRole && matchesSearch;
  });
}

function renderUsersTable(list) {
  currentUsersList = list;
  const body = document.getElementById("usersBody");

  if (list.length === 0) {
    body.innerHTML = `<tr><td colspan="6" style="text-align:center;color:var(--ink-faint);">No users yet</td></tr>`;
    document.getElementById("usersPagination").innerHTML = "";
    return;
  }

  const pageItems = paginateArray(list, usersPage, PAGE_SIZE);

  body.innerHTML = pageItems.map(u => `
    <tr>
      <td class="cell-title">${u.full_name || "—"}</td>
      <td data-label="Email">${u.email || "—"}</td>
      <td data-label="Phone">${u.phone || "—"}</td>
      <td data-label="Role"><span class="status-pill ${u.role === 'admin' ? 'DELIVERED' : 'PROCESSING'}">${u.role}</span></td>
      <td data-label="Joined">${new Date(u.created_at).toLocaleDateString()}</td>
      <td>
        <div class="table-actions">
          ${u.id === adminUser.id
            ? `<span style="font-size:0.78rem;color:var(--ink-faint);">This is you</span>`
            : `<button onclick="toggleUserRole('${u.id}', '${u.role === 'admin' ? 'customer' : 'admin'}')">
                 ${u.role === 'admin' ? 'Make Customer' : 'Make Admin'}
               </button>`
          }
        </div>
      </td>
    </tr>
  `).join("");

  renderPagination("usersPagination", list.length, usersPage, PAGE_SIZE, "goToUsersPage");
}

function goToUsersPage(n) {
  usersPage = n;
  renderUsersTable(currentUsersList);
}

function filterUsers() {
  usersPage = 1;
  renderUsersTable(applyUsersFilters());
}

async function toggleUserRole(id, newRole) {
  if (newRole === "admin" && !(await customConfirm("Give this user admin access to the dashboard?", "Make Admin"))) return;

  const { error } = await supabase.from("profiles").update({ role: newRole }).eq("id", id);

  if (error) {
    alert("Could not update role: " + error.message);
    return;
  }

  loadUsers();
}

async function addUser() {
  const email = document.getElementById("newUserEmail").value.trim();
  const password = document.getElementById("newUserPassword").value;
  const role = document.getElementById("newUserRole").value;

  if (!email || !password) {
    alert("Enter an email and password");
    return;
  }
  if (password.length < 6) {
    alert("Password must be at least 6 characters");
    return;
  }

  // Sign this new user up on a throwaway client — persistSession:false
  // means it never touches localStorage, so it can't disturb the
  // admin's own logged-in session in the main `supabase` client.
  const tempClient = window.createSupabaseClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  const { data, error } = await tempClient.auth.signUp({ email, password });

  if (error) {
    alert("Could not create user: " + error.message);
    return;
  }

  if (role === "admin" && data.user) {
    const { error: roleError } = await supabase
      .from("profiles")
      .update({ role: "admin" })
      .eq("id", data.user.id);

    if (roleError) {
      alert("User created, but couldn't set them as admin yet — try the role toggle below once they show up in the list.");
    }
  }

  alert("User created. If email confirmation is required on this project, they'll need to confirm before logging in.");

  document.getElementById("newUserEmail").value = "";
  document.getElementById("newUserPassword").value = "";
  document.getElementById("newUserRole").value = "customer";

  loadUsers();
}

/***********************
    BOOT
************************/

// Keep the dashboard chart correctly sized through phone rotation /
// browser window resizing — Chart.js's own auto-resize can lag or
// miss this on some mobile browsers.
/***********************
    REPORTS
************************/

/** Defaults the date pickers to "this month so far" the first time
 *  the Reports tab is opened, so there's a sensible report ready to
 *  generate without having to pick dates first. */
function initReportsView() {
  const fromEl = document.getElementById("reportFromDate");
  const toEl = document.getElementById("reportToDate");
  if (!fromEl.value) {
    const now = new Date();
    const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    fromEl.value = firstOfMonth.toISOString().slice(0, 10);
    toEl.value = now.toISOString().slice(0, 10);
  }
}

async function fetchReportOrders() {
  const fromDate = document.getElementById("reportFromDate").value;
  const toDate = document.getElementById("reportToDate").value;

  if (!fromDate || !toDate) {
    alert("Pick both a from and to date first");
    return null;
  }

  // Include the whole "to" day, not just midnight of it.
  const toDateEnd = new Date(toDate + "T23:59:59.999");

  const { data: rows, error } = await supabase
    .from("orders")
    .select("*")
    .gte("created_at", new Date(fromDate + "T00:00:00").toISOString())
    .lte("created_at", toDateEnd.toISOString())
    .order("created_at", { ascending: true });

  if (error) {
    alert("Could not load orders for this range: " + error.message);
    return null;
  }

  return { orders: rows || [], fromDate, toDate };
}

function summarizeOrders(orders) {
  // Cancelled orders never actually became sales — leaving them in
  // would overstate revenue and skew "top products".
  const validOrders = orders.filter(o => o.status !== "CANCELLED");

  const totalSales = validOrders.reduce((sum, o) => sum + Number(o.total || 0), 0);
  const delivered = orders.filter(o => o.status === "DELIVERED").length;
  const cancelled = orders.filter(o => o.status === "CANCELLED").length;

  const productTotals = {};
  validOrders.forEach(o => {
    (o.items || []).forEach(item => {
      if (!productTotals[item.name]) productTotals[item.name] = { qty: 0, revenue: 0 };
      productTotals[item.name].qty += item.qty;
      productTotals[item.name].revenue += item.price * item.qty;
    });
  });

  const topProducts = Object.entries(productTotals)
    .map(([name, v]) => ({ name, ...v }))
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 10);

  return {
    orderCount: orders.length,
    totalSales,
    avgOrderValue: validOrders.length ? totalSales / validOrders.length : 0,
    delivered,
    cancelled,
    topProducts
  };
}

async function generateSalesReport(format) {
  const result = await fetchReportOrders();
  if (!result) return;

  const { orders, fromDate, toDate } = result;
  const summary = summarizeOrders(orders);

  document.getElementById("reportSummary").innerHTML = `
    <div class="admin-form-grid" style="margin-top:4px;">
      <div><strong>${summary.orderCount}</strong><br><span style="color:var(--ink-soft);font-size:0.85rem;">Orders</span></div>
      <div><strong>₹${summary.totalSales.toFixed(0)}</strong><br><span style="color:var(--ink-soft);font-size:0.85rem;">Total Sales</span></div>
      <div><strong>₹${summary.avgOrderValue.toFixed(0)}</strong><br><span style="color:var(--ink-soft);font-size:0.85rem;">Avg Order Value</span></div>
      <div><strong>${summary.delivered}</strong><br><span style="color:var(--ink-soft);font-size:0.85rem;">Delivered</span></div>
    </div>
  `;

  if (orders.length === 0) {
    alert("No orders found in that date range");
    return;
  }

  if (format === "csv") {
    downloadReportCsv(orders, summary, fromDate, toDate);
  } else {
    downloadReportPdf(orders, summary, fromDate, toDate);
  }
}

function downloadReportCsv(orders, summary, fromDate, toDate) {
  const rows = [
    ["AOne Bazaar — Sales Report", `${fromDate} to ${toDate}`],
    [],
    ["Order ID", "Date", "Customer", "Phone", "Items", "Subtotal", "Discount", "Delivery", "Total", "Status"]
  ];

  orders.forEach(o => {
    const itemsStr = (o.items || []).map(i => `${i.name} x${i.qty}`).join("; ");
    rows.push([
      o.id,
      new Date(o.created_at).toLocaleString(),
      o.customer_name || "",
      o.customer_phone || "",
      itemsStr,
      o.subtotal || "",
      o.discount || 0,
      o.delivery_charge || 0,
      o.total,
      o.status
    ]);
  });

  rows.push([]);
  rows.push(["Summary"]);
  rows.push(["Total Orders", summary.orderCount]);
  rows.push(["Total Sales", summary.totalSales.toFixed(2)]);
  rows.push(["Average Order Value", summary.avgOrderValue.toFixed(2)]);
  rows.push(["Delivered", summary.delivered]);
  rows.push(["Cancelled", summary.cancelled]);
  rows.push([]);
  rows.push(["Top Products", "Qty Sold", "Revenue"]);
  summary.topProducts.forEach(p => rows.push([p.name, p.qty, p.revenue.toFixed(2)]));

  const csv = rows
    .map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(","))
    .join("\r\n");

  const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `AOne-Bazaar-Sales-Report_${fromDate}_to_${toDate}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function downloadReportPdf(orders, summary, fromDate, toDate) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();

  const GREEN = [30, 122, 70];
  const GREEN_DARK = [15, 74, 43];
  const INK = [28, 27, 24];
  const INK_SOFT = [91, 88, 79];
  const LINE = [231, 224, 207];
  const PAPER = [250, 248, 243];

  doc.setFillColor(...GREEN_DARK);
  doc.rect(0, 0, 210, 32, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(20);
  doc.setTextColor(255, 255, 255);
  doc.text("AOne Bazaar", 14, 16);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(210, 228, 217);
  doc.text("Sales Report", 14, 23);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(255, 255, 255);
  doc.text(`${fromDate} to ${toDate}`, 196, 16, { align: "right" });

  doc.setTextColor(...INK);
  let y = 44;

  const cards = [
    ["Orders", String(summary.orderCount)],
    ["Total Sales", "Rs. " + summary.totalSales.toFixed(0)],
    ["Avg Order", "Rs. " + summary.avgOrderValue.toFixed(0)],
    ["Delivered", String(summary.delivered)]
  ];
  const cardW = 44;
  cards.forEach((c, i) => {
    const x = 14 + i * (cardW + 3);
    doc.setDrawColor(...LINE);
    doc.setFillColor(...PAPER);
    doc.roundedRect(x, y, cardW, 22, 2, 2, "FD");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(13);
    doc.setTextColor(...GREEN);
    doc.text(c[1], x + cardW / 2, y + 10, { align: "center" });
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(...INK_SOFT);
    doc.text(c[0], x + cardW / 2, y + 17, { align: "center" });
  });

  y += 32;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(...INK);
  doc.text("Top Products", 14, y);
  y += 6;

  doc.setFillColor(...GREEN);
  doc.rect(14, y, 182, 8, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8.5);
  doc.setTextColor(255, 255, 255);
  doc.text("PRODUCT", 18, y + 5.5);
  doc.text("QTY", 150, y + 5.5, { align: "right" });
  doc.text("REVENUE", 192, y + 5.5, { align: "right" });
  y += 8;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  summary.topProducts.forEach((p, i) => {
    if (i % 2 === 0) { doc.setFillColor(...PAPER); doc.rect(14, y, 182, 8, "F"); }
    doc.setTextColor(...INK);
    doc.text(String(p.name).slice(0, 45), 18, y + 5.5);
    doc.text(String(p.qty), 150, y + 5.5, { align: "right" });
    doc.text("Rs. " + p.revenue.toFixed(0), 192, y + 5.5, { align: "right" });
    y += 8;
    if (y > 270) { doc.addPage(); y = 20; }
  });

  y += 10;
  if (y > 260) { doc.addPage(); y = 20; }

  doc.setDrawColor(...LINE);
  doc.line(14, y, 196, y);
  y += 8;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(...INK_SOFT);
  doc.text(`Generated on ${new Date().toLocaleString()}  |  ${summary.orderCount} orders, ${summary.cancelled} cancelled`, 105, y, { align: "center" });

  doc.save(`AOne-Bazaar-Sales-Report_${fromDate}_to_${toDate}.pdf`);
}

window.addEventListener("resize", () => {
  if (ordersChartInstance) ordersChartInstance.resize();
});

window.addEventListener("DOMContentLoaded", checkAdminSession);