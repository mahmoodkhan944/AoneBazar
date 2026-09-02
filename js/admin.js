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

  document.getElementById("statTodaySales").innerText = "₹" + Math.round(stats.today_sales || 0);
  document.getElementById("statTotalOrders").innerText = stats.total_orders || 0;
  document.getElementById("statTotalRevenue").innerText = "₹" + Math.round(stats.total_revenue || 0);
  document.getElementById("statPendingOrders").innerText = stats.pending_orders || 0;

  renderOrdersChart(stats.orders_last_7_days || []);

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

  const STATUS_LABELS = { NEW: "New", PROCESSING: "Processing", OUT_FOR_DELIVERY: "Out for Delivery", DELIVERED: "Delivered", CANCELLED: "Cancelled" };
  const statusEl = document.getElementById("ordersByStatusList");
  const statusRows = stats.orders_by_status || [];

  if (statusRows.length === 0) {
    statusEl.innerHTML = "<p style='color:var(--ink-faint);font-size:0.85rem;'>No orders yet</p>";
  } else {
    statusEl.innerHTML = statusRows.map(s => `
      <div class="top-product-row">
        <div><span class="status-pill ${s.status}">${STATUS_LABELS[s.status] || s.status}</span></div>
        <div class="rev">${s.count}</div>
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
      <td data-label="Status"><span class="status-pill ${o.status}">${o.status}</span></td>
      <td data-label="Date">${new Date(o.created_at).toLocaleDateString()}</td>
    </tr>
  `).join("") || `<tr><td colspan="5" style="text-align:center;color:var(--ink-faint);">No orders yet</td></tr>`;
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
    date: new Date(row.created_at).toLocaleString()
  };
}

async function loadOrders() {
  const body = document.getElementById("ordersBody");
  body.innerHTML = `<tr><td colspan="7" style="text-align:center;">Loading…</td></tr>`;

  const { data: rows, error } = await supabase
    .from("orders")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    body.innerHTML = `<tr><td colspan="7">Could not load orders</td></tr>`;
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
    body.innerHTML = `<tr><td colspan="7" style="text-align:center;color:var(--ink-faint);">No orders found</td></tr>`;
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
      <td data-label="Status"><span class="status-pill ${o.status}">${o.status}</span></td>
      <td data-label="Date">${o.date}</td>
      <td>
        <div class="table-actions">
          <button onclick="updateOrderStatus('${o.id}','PROCESSING')">Processing</button>
          <button onclick="updateOrderStatus('${o.id}','OUT_FOR_DELIVERY')">Out for Delivery</button>
          <button onclick="updateOrderStatus('${o.id}','DELIVERED')">Delivered</button>
          <button onclick='downloadInvoiceById("${o.id}")'>Invoice</button>
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
    PROCESSING: `Hi ${order.name}! Your AOne Bazaar order ${order.id} (₹${order.total}) is now being prepared. We'll message you again once it's out for delivery. 🛍️`,
    OUT_FOR_DELIVERY: `Hi ${order.name}! Your AOne Bazaar order ${order.id} (₹${order.total}) is out for delivery and should reach you shortly. 🛵`,
    DELIVERED: `Hi ${order.name}! Your AOne Bazaar order ${order.id} (₹${order.total}) has been delivered. Thank you for shopping with us — see you again soon! 🙏`
  };

  const message = templates[status];
  if (!message || !order.phone) return;

  const digitsOnly = String(order.phone).replace(/\D/g, "");
  const fullNumber = digitsOnly.length === 10 ? "91" + digitsOnly : digitsOnly;

  window.open(`https://wa.me/${fullNumber}?text=${encodeURIComponent(message)}`, "_blank");
}

function downloadInvoiceById(id) {
  const order = cachedOrders.find(o => o.id === id);
  if (!order) { alert("Order not found"); return; }
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

  y += 24;
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
  doc.text("Master Naseem Complex, Lahideeh Bazar, Azamgarh  |  +91 8009555567", 105, y, { align: "center" });
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
  if (!panel.classList.contains("hidden")) loadCategoryOptions(document.getElementById("pStore").value);
}

document.addEventListener("change", e => {
  if (e.target && e.target.id === "pStore") loadCategoryOptions(e.target.value);
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
  productsPage = 1;
  renderProductsTable(allProductsCache);
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
          <button onclick='editProduct(${JSON.stringify(p)})'>Edit</button>
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

function filterProducts() {
  const q = document.getElementById("productSearch").value.toLowerCase();
  const storeFilter = document.getElementById("productStoreFilter").value;

  const filtered = allProductsCache.filter(p =>
    p.name.toLowerCase().includes(q) &&
    (!storeFilter || p.store === storeFilter)
  );

  productsPage = 1;
  renderProductsTable(filtered);
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
    featured_section, featured_order
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

  const updateData = { name, name_hi, description, description_hi, brand, price, mrp, store, category, images, variants, specs, featured_section, featured_order };

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

  const { data: rows, error } = await supabase
    .from("categories")
    .select("*")
    .order("store")
    .order("name");

  if (error) {
    treeEl.innerHTML = `<p style="color:var(--ink-faint);">Could not load categories</p>`;
    return;
  }

  allCategoriesCache = rows || [];
  renderCategoriesTree(allCategoriesCache);
  populateParentCategoryDropdown("catParent", document.getElementById("catStore").value);
}

let currentCategoriesList = [];

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

  const mains = [...mainsToShow.values()].sort((a, b) => a.name.localeCompare(b.name));

  const cardsHtml = mains.map(main => {
    // If the main category itself matched the search, show every one
    // of its sub-categories (not just ones that happened to match
    // too) — only when a main is showing up SOLELY because a child
    // matched do we narrow the list down to just that child.
    const mainMatchedDirectly = matchedIds.has(main.id);
    const subs = mainMatchedDirectly
      ? allCategoriesCache.filter(c => c.parent_id === main.id).sort((a, b) => a.name.localeCompare(b.name))
      : (subsByParentToShow[main.id] || []);

    const subsHtml = subs.map(sub => `
        <div class="cat-tree-sub">
          <div class="cat-tree-sub-info">
            <span class="cat-tree-sub-arrow">↳</span>
            <span>${sub.name}${sub.name_hi ? `<span class="cat-tree-hi"> (${sub.name_hi})</span>` : ""}</span>
          </div>
          <div class="table-actions">
            <button onclick='editCategory(${JSON.stringify(sub)})'>Edit</button>
            <button class="danger" onclick="deleteCategory('${sub.id}')">Delete</button>
          </div>
        </div>
      `).join("");

    return `
        <div class="cat-tree-group">
          <div class="cat-tree-main">
            <div class="cat-tree-main-info">
              <i class="fa-solid fa-folder" style="color:var(--marigold-600);"></i>
              <strong>${main.name}</strong>
              ${main.name_hi ? `<span class="cat-tree-hi">${main.name_hi}</span>` : ""}
              <span class="cat-tree-store-tag">${main.store}</span>
            </div>
            <div class="table-actions">
              <button onclick="quickAddSubcategory('${main.id}', '${main.name.replace(/'/g, "\\'")}', '${main.store}')">+ Sub-category</button>
              <button onclick='editCategory(${JSON.stringify(main)})'>Edit</button>
              <button class="danger" onclick="deleteCategory('${main.id}')">Delete</button>
            </div>
          </div>
          ${subsHtml ? `<div class="cat-tree-subs">${subsHtml}</div>` : ""}
        </div>
      `;
  }).join("");

  treeEl.innerHTML = cardsHtml || `<p style="text-align:center;color:var(--ink-faint);padding:20px 0;">No categories found</p>`;
}

function filterCategories() {
  const q = document.getElementById("categorySearch").value.toLowerCase();
  const storeFilter = document.getElementById("categoryStoreFilter").value;

  const filtered = allCategoriesCache.filter(c =>
    c.name.toLowerCase().includes(q) &&
    (!storeFilter || c.store === storeFilter)
  );

  renderCategoriesTree(filtered);
}

async function addCategory() {
  const isSubMode = document.querySelector(".cat-type-btn.active")?.dataset.type === "sub";
  const store = document.getElementById("catStore").value;
  const name = document.getElementById("catName").value.trim();
  const name_hi = document.getElementById("catNameHi").value.trim() || null;
  const parent_id = document.getElementById("catParent").value || null;

  if (!name) { alert("Enter a category name"); return; }
  if (isSubMode && !parent_id) { alert("Pick a main category for this sub-category to nest under"); return; }

  const { error } = await supabase.from("categories").insert({ store, name, name_hi, parent_id });

  if (error) {
    alert(error.code === "23505" ? "That category already exists" : "Could not add: " + error.message);
    return;
  }

  document.getElementById("catName").value = "";
  document.getElementById("catNameHi").value = "";
  if (!isSubMode) document.getElementById("catParent").value = "";
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

  const { error } = await supabase
    .from("categories")
    .update({ store, name, name_hi, parent_id })
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
          <button onclick='editCoupon(${JSON.stringify(c)})'>Edit</button>
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
  document.getElementById("cf_contact_address").value = content.contact_address || "";
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
    contact_address: document.getElementById("cf_contact_address").value.trim(),
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
  body.innerHTML = `<tr><td colspan="5" style="text-align:center;">Loading…</td></tr>`;

  const { data: rows, error } = await supabase
    .from("profiles")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    body.innerHTML = `<tr><td colspan="5">Could not load users</td></tr>`;
    console.error(error);
    return;
  }

  allUsersCache = rows || [];
  usersPage = 1;
  renderUsersTable(allUsersCache);
}

let usersPage = 1;
let currentUsersList = [];

function renderUsersTable(list) {
  currentUsersList = list;
  const body = document.getElementById("usersBody");

  if (list.length === 0) {
    body.innerHTML = `<tr><td colspan="5" style="text-align:center;color:var(--ink-faint);">No users yet</td></tr>`;
    document.getElementById("usersPagination").innerHTML = "";
    return;
  }

  const pageItems = paginateArray(list, usersPage, PAGE_SIZE);

  body.innerHTML = pageItems.map(u => `
    <tr>
      <td class="cell-title">${u.email || "—"}</td>
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
  const q = document.getElementById("userSearch").value.toLowerCase();
  usersPage = 1;
  renderUsersTable(allUsersCache.filter(u => (u.email || "").toLowerCase().includes(q)));
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