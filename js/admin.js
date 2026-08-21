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
  users: loadUsers
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

  const STATUS_LABELS = { NEW: "New", PROCESSING: "Processing", DELIVERED: "Delivered", CANCELLED: "Cancelled" };
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

  doc.setFillColor(0, 150, 136);
  doc.rect(0, 0, 210, 28, "F");

  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.setTextColor(255, 255, 255);
  doc.text("AOne Bazaar", 105, 12, { align: "center" });

  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  doc.text("Fast Delivery | Quality Products", 105, 18, { align: "center" });

  doc.setFontSize(9);
  doc.text("INVOICE", 200, 10, { align: "right" });
  doc.text("ID: " + order.id, 200, 15, { align: "right" });
  doc.text(order.date, 200, 20, { align: "right" });

  doc.setTextColor(0, 0, 0);
  let y = 35;

  doc.setDrawColor(200);
  doc.rect(10, y, 190, 35);
  doc.setFont("helvetica", "bold");
  doc.text("Bill To:", 12, y + 7);
  doc.setFont("helvetica", "normal");
  doc.text(order.name, 12, y + 14);
  doc.text("Phone: " + (order.phone || "-"), 12, y + 20);
  doc.text(order.address, 12, y + 26);

  y += 35;
  doc.setFillColor(230, 230, 230);
  doc.rect(10, y, 190, 8, "F");
  doc.setFont("helvetica", "bold");
  doc.text("Item", 12, y + 6);
  doc.text("Qty", 120, y + 6, { align: "right" });
  doc.text("Price", 160, y + 6, { align: "right" });
  doc.text("Total", 200, y + 6, { align: "right" });

  y += 12;
  doc.setFont("helvetica", "normal");
  let total = 0;

  order.items.forEach(p => {
    let price = p.price * p.qty;
    total += price;
    doc.text(p.name, 12, y);
    doc.text(String(p.qty), 120, y, { align: "right" });
    doc.text("Rs. " + p.price, 160, y, { align: "right" });
    doc.text("Rs. " + price, 200, y, { align: "right" });
    y += 8;
    if (y > 260) { doc.addPage(); y = 20; }
  });

  y += 5;
  doc.line(10, y, 200, y);
  y += 10;

  doc.setFillColor(0, 150, 136);
  doc.rect(120, y, 80, 12, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.text("TOTAL: Rs. " + total, 160, y + 8, { align: "center" });
  doc.setTextColor(0, 0, 0);

  y += 25;
  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  doc.text("Thank you for shopping with us!", 105, y, { align: "center" });
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
});

async function loadCategoryOptions(store) {
  const sel = document.getElementById("pCategory");
  sel.innerHTML = "<option>Loading...</option>";

  const { data: rows, error } = await supabase
    .from("categories")
    .select("name")
    .eq("store", store)
    .order("name");

  if (error) {
    sel.innerHTML = "<option value=''>Could not load categories</option>";
    return;
  }

  const options = (rows || []).map(c => `<option value="${c.name}">${c.name}</option>`).join("");
  sel.innerHTML = (options || "") + `<option value="__add_new__">+ Add New Category…</option>`;
  sel.dataset.prevValue = sel.value;
}

/** Fires when the admin picks "+ Add New Category…" in a category
 *  dropdown (Add Product form, or the Edit Product modal) — lets
 *  them create the category right there instead of leaving the page. */
async function handleCategorySelectChange(selectEl, storeFieldId) {
  if (selectEl.value !== "__add_new__") {
    selectEl.dataset.prevValue = selectEl.value;
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
    await loadEditCategoryOptions(store, name);
  } else {
    await loadCategoryOptions(store);
    selectEl.value = name;
  }
  selectEl.dataset.prevValue = name;
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
  const category = document.getElementById("pCategory").value;
  const brand = document.getElementById("pBrand").value.trim() || null;
  const name = document.getElementById("pName").value.trim();
  const name_hi = document.getElementById("pNameHi").value.trim() || null;
  const price = Number(document.getElementById("pPrice").value) || 0;
  const mrp = Number(document.getElementById("pMrp").value) || null;
  const featured_section = document.getElementById("pFeaturedSection").value.trim() || null;
  const featured_order = Number(document.getElementById("pFeaturedOrder").value) || 0;
  const files = document.getElementById("pImage").files;
  const variants = collectVariants("pVariants");

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
    store, category, brand, name, name_hi, price: effectivePrice, mrp, images: imageURLs, variants,
    featured_section, featured_order
  });

  if (error) {
    alert("Could not add product: " + error.message);
    return;
  }

  alert("Product added!");
  document.getElementById("pName").value = "";
  document.getElementById("pNameHi").value = "";
  document.getElementById("pBrand").value = "";
  document.getElementById("pPrice").value = "";
  document.getElementById("pMrp").value = "";
  document.getElementById("pFeaturedSection").value = "";
  document.getElementById("pFeaturedOrder").value = "";
  document.getElementById("pImage").value = "";
  document.getElementById("pVariants").innerHTML = "";
  loadProducts();
}

let editRemainingImages = [];

async function editProduct(p) {
  editingProductId = p.id;
  document.getElementById("editName").value = p.name;
  document.getElementById("editNameHi").value = p.name_hi || "";
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

  await loadEditCategoryOptions(p.store, p.category);

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
  loadEditCategoryOptions(e.target.value);
});

/** Populates the Category dropdown for the store selected in the
 *  edit-product modal. */
async function loadEditCategoryOptions(store, selectedCategory) {
  const sel = document.getElementById("editCategory");
  sel.innerHTML = "<option>Loading...</option>";

  const { data: rows, error } = await supabase
    .from("categories")
    .select("name")
    .eq("store", store)
    .order("name");

  if (error) {
    sel.innerHTML = "<option value=''>Could not load categories</option>";
    return;
  }

  const options = (rows || []).map(c => `<option value="${c.name}">${c.name}</option>`).join("");
  sel.innerHTML = (options || "") + `<option value="__add_new__">+ Add New Category…</option>`;

  if (selectedCategory && (rows || []).some(c => c.name === selectedCategory)) {
    sel.value = selectedCategory;
  }
  sel.dataset.prevValue = sel.value;
}

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

async function updateProduct() {
  const name = document.getElementById("editName").value;
  const name_hi = document.getElementById("editNameHi").value.trim() || null;
  const brand = document.getElementById("editBrand").value.trim() || null;
  const price = Number(document.getElementById("editPrice").value);
  const mrp = Number(document.getElementById("editMrp").value) || null;
  const featured_section = document.getElementById("editFeaturedSection").value.trim() || null;
  const featured_order = Number(document.getElementById("editFeaturedOrder").value) || 0;
  const store = document.getElementById("editStore").value;
  const category = document.getElementById("editCategory").value;
  const variants = collectVariants("editVariants");

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

  const updateData = { name, name_hi, brand, price, mrp, store, category, images, variants, featured_section, featured_order };

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
  const body = document.getElementById("categoriesBody");
  body.innerHTML = `<tr><td colspan="4" style="text-align:center;">Loading…</td></tr>`;

  const { data: rows, error } = await supabase
    .from("categories")
    .select("*")
    .order("store")
    .order("name");

  if (error) {
    body.innerHTML = `<tr><td colspan="4">Could not load categories</td></tr>`;
    return;
  }

  if (!rows || rows.length === 0) {
    body.innerHTML = `<tr><td colspan="4" style="text-align:center;color:var(--ink-faint);">No categories yet</td></tr>`;
    return;
  }

  allCategoriesCache = rows;
  categoriesPage = 1;
  renderCategoriesTable(rows);
}

let categoriesPage = 1;
let currentCategoriesList = [];

function renderCategoriesTable(list) {
  currentCategoriesList = list;
  const body = document.getElementById("categoriesBody");

  if (list.length === 0) {
    body.innerHTML = `<tr><td colspan="4" style="text-align:center;color:var(--ink-faint);">No categories yet</td></tr>`;
    document.getElementById("categoriesPagination").innerHTML = "";
    return;
  }

  const pageItems = paginateArray(list, categoriesPage, PAGE_SIZE);

  body.innerHTML = pageItems.map(c => `
    <tr>
      <td class="cell-title">${c.name}</td>
      <td data-label="Store">${c.store}</td>
      <td><div class="table-actions">
        <button onclick='editCategory(${JSON.stringify(c)})'>Edit</button>
        <button class="danger" onclick="deleteCategory('${c.id}')">Delete</button>
      </div></td>
    </tr>
  `).join("");

  renderPagination("categoriesPagination", list.length, categoriesPage, PAGE_SIZE, "goToCategoriesPage");
}

function goToCategoriesPage(n) {
  categoriesPage = n;
  renderCategoriesTable(currentCategoriesList);
}

function filterCategories() {
  const q = document.getElementById("categorySearch").value.toLowerCase();
  const storeFilter = document.getElementById("categoryStoreFilter").value;

  const filtered = allCategoriesCache.filter(c =>
    c.name.toLowerCase().includes(q) &&
    (!storeFilter || c.store === storeFilter)
  );

  categoriesPage = 1;
  renderCategoriesTable(filtered);
}

async function addCategory() {
  const store = document.getElementById("catStore").value;
  const name = document.getElementById("catName").value.trim();

  if (!name) { alert("Enter a category name"); return; }

  const { error } = await supabase.from("categories").insert({ store, name });

  if (error) {
    alert(error.code === "23505" ? "That category already exists" : "Could not add: " + error.message);
    return;
  }

  document.getElementById("catName").value = "";
  loadCategoriesView();
}

async function deleteCategory(id) {
  if (!(await customConfirm("Delete this category? Products already in it are unaffected.", "Delete"))) return;
  const { error } = await supabase.from("categories").delete().eq("id", id);
  if (error) { alert("Could not delete: " + error.message); return; }
  loadCategoriesView();
}

let editingCategoryId = null;

function editCategory(c) {
  editingCategoryId = c.id;
  document.getElementById("editCatStore").value = c.store;
  document.getElementById("editCatName").value = c.name;
  document.getElementById("editCategoryModal").classList.remove("hidden");
}

function closeCategoryEdit() {
  document.getElementById("editCategoryModal").classList.add("hidden");
}

async function updateCategory() {
  const store = document.getElementById("editCatStore").value;
  const name = document.getElementById("editCatName").value.trim();

  if (!name) { alert("Enter a category name"); return; }

  // Remember the old store/name so we can re-tag any products that
  // were filed under it — otherwise renaming a category silently
  // orphans its products (they'd keep pointing at a name that no
  // longer exists anywhere).
  const before = allCategoriesCache.find(c => c.id === editingCategoryId);

  const { error } = await supabase
    .from("categories")
    .update({ store, name })
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
    free_delivery_threshold: document.getElementById("cf_free_delivery_threshold").value.trim() || "300"
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
window.addEventListener("resize", () => {
  if (ordersChartInstance) ordersChartInstance.resize();
});

window.addEventListener("DOMContentLoaded", checkAdminSession);