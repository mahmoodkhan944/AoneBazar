/***********************
    GLOBAL
************************/
/***********************
    DOM ELEMENTS
************************/
const heroSection = document.getElementById("heroSection");
const storeSection = document.getElementById("storeSection");
const storeTitle = document.getElementById("storeTitle");
const productGrid = document.getElementById("productGrid");

const cartBox = document.getElementById("cartBox");
const cartItems = document.getElementById("cartItems");
const cartTotal = document.getElementById("cartTotal");

const customerName = document.getElementById("customerName");
const customerAddress = document.getElementById("customerAddress");

// db/storage removed — Supabase (js/supabase-client.js) now handles
// everything: products, categories, orders, product images, AND
// login (customer phone OTP, admin email/password). Admin management
// itself lives entirely in admin.html / js/admin.js now.
let tapCount = 0;
let currentStore = "";

// Kept in sync with supabase.auth.onAuthStateChange (see bottom of file)
// so the rest of the app can check "who's logged in" synchronously,
// the same way you'd check a synchronous "current user" elsewhere.
let currentSupabaseUser = null;

let cart = JSON.parse(localStorage.getItem("cart")) || [];
const WHATSAPP_NUMBER = "918009555567";

// Defaults used until site_content has loaded (or if the admin
// hasn't set these yet) — the live values come from window.siteContent,
// editable from Admin → Site Content → "Minimum Order & Delivery Charges".
const DEFAULT_MIN_ORDER = 100;
const DEFAULT_FREE_DELIVERY_THRESHOLD = 300;
const DEFAULT_DELIVERY_CHARGE = 30;

function getMinOrder() {
  const v = window.siteContent && Number(window.siteContent.min_order);
  return v > 0 ? v : DEFAULT_MIN_ORDER;
}

function getFreeDeliveryThreshold() {
  const v = window.siteContent && Number(window.siteContent.free_delivery_threshold);
  return v > 0 ? v : DEFAULT_FREE_DELIVERY_THRESHOLD;
}

function getDeliveryChargeAmount() {
  const v = window.siteContent && Number(window.siteContent.delivery_charge);
  return v >= 0 && window.siteContent && window.siteContent.delivery_charge !== undefined
    ? v
    : DEFAULT_DELIVERY_CHARGE;
}

function calculateDeliveryCharge(goodsTotal) {
  return goodsTotal >= getFreeDeliveryThreshold() ? 0 : getDeliveryChargeAmount();
}

function updateMinOrderNotice() {
  const el = document.getElementById("minOrderNotice");
  if (!el) return;
  const charge = getDeliveryChargeAmount();
  el.innerText = charge > 0
    ? `Minimum order ₹${getMinOrder()} · Free delivery above ₹${getFreeDeliveryThreshold()} (₹${charge} delivery charge below that)`
    : `Minimum order ₹${getMinOrder()} · Free delivery on all orders`;
}

function generateOrderID() {
  return "ORD" + Date.now();
}


/***********************
    CART SAVE
************************/
function saveCart() {
  localStorage.setItem("cart", JSON.stringify(cart));

  const total = cart.reduce((a, b) => a + (b.qty || 1), 0);

  const count = document.getElementById("cartCount");
  if (count) count.innerText = total;

  const countBottom = document.getElementById("cartCountBottom");
  if (countBottom) countBottom.innerText = total;
}

/***********************
    STORE DATA
************************/
// Category name → Hindi name lookup, fetched per store from the
// `categories` table (the product-derived category groups in `data`
// only carry the plain English name, so this fills in the Hindi
// half for the chip labels).
let categoryHindiMap = {};

// Parent → child category structure for this store — { topLevel: [...],
// subByParentId: { [parentId]: [...] } } — powers the "tap Furniture,
// see Almirah/Sofa/Bed" drill-down.
let categoryHierarchy = { topLevel: [], subByParentId: {} };

// When drilled into a parent category's sub-categories, this holds
// that parent's category record; null means we're on the normal
// top-level tile screen.
let currentParentCategoryView = null;

async function loadCategoryHindiMap(store) {
  categoryHindiMap = {};
  categoryHierarchy = { topLevel: [], subByParentId: {} };

  const { data: rows, error } = await supabase
    .from("categories")
    .select("id, name, name_hi, parent_id")
    .eq("store", store)
    .order("name");

  if (error || !rows) return;

  rows.forEach(c => {
    if (c.name_hi) categoryHindiMap[c.name] = c.name_hi;
  });

  rows.forEach(c => {
    if (!c.parent_id) {
      categoryHierarchy.topLevel.push(c);
    } else {
      if (!categoryHierarchy.subByParentId[c.parent_id]) categoryHierarchy.subByParentId[c.parent_id] = [];
      categoryHierarchy.subByParentId[c.parent_id].push(c);
    }
  });
}

/** "Masalas & Spices" → "Masalas & Spices (मसाले)" when a Hindi
 *  translation is on file for that category. */
function displayCategoryName(cat) {
  return categoryHindiMap[cat] ? `${cat} (${categoryHindiMap[cat]})` : cat;
}

/***********************
    SKELETON / EMPTY-STATE HELPERS
    Small reusable bits so "loading" and "nothing here" moments look
    intentional instead of a bare "Loading…" string or blank space.
************************/

function skeletonProductCardsHtml(count = 8) {
  return Array(count).fill(`
    <div class="skeleton-card">
      <div class="skeleton-img shimmer"></div>
      <div class="skeleton-line shimmer" style="width:85%;"></div>
      <div class="skeleton-line shimmer" style="width:45%;"></div>
      <div class="skeleton-line shimmer" style="width:100%;height:32px;border-radius:999px;margin-top:10px;"></div>
    </div>
  `).join("");
}

function skeletonCategoryTilesHtml(count = 8) {
  return Array(count).fill(`
    <div class="skeleton-tile">
      <div class="skeleton-img shimmer"></div>
      <div class="skeleton-line shimmer" style="width:70%;height:9px;"></div>
    </div>
  `).join("");
}

function skeletonRowCardsHtml(count = 3) {
  return Array(count).fill(`
    <div class="skeleton-row-card">
      <div class="skeleton-line shimmer" style="width:40%;"></div>
      <div class="skeleton-line shimmer" style="width:90%;"></div>
      <div class="skeleton-line shimmer" style="width:60%;margin-bottom:0;"></div>
    </div>
  `).join("");
}

function emptyStateHtml(icon, message, subtext) {
  return `
    <div class="empty-state">
      <div class="empty-state-icon"><i class="fa-solid ${icon}"></i></div>
      <p class="empty-state-message">${message}</p>
      ${subtext ? `<p class="empty-state-subtext">${subtext}</p>` : ""}
    </div>
  `;
}

const defaultStores = {
  supermarket: {
    title: "AOne Bazaar",
    categories: {}
  },
  grocery: {
    title: "AOne Kirana Store",
    categories: {}
  },
  cafe: {
    title: "AOne Cafe",
    categories: {}
  }
};

let data =
  JSON.parse(localStorage.getItem("products")) || {};

Object.keys(defaultStores).forEach(k => {
  if (!data[k]) data[k] = defaultStores[k];
});

localStorage.setItem("products", JSON.stringify(data));

/***********************
    STORE VIEW
************************/


let currentCategory = "";

async function openStore(key, jumpToCategory, jumpToPage) {

  currentStore = key;
  currentParentCategoryView = null; // start fresh, not mid-drill-down from a previous store

  heroSection.style.display = "none";
  storeSection.classList.remove("hidden");
  setHomepageFeaturedVisible(false);

  // Show skeletons immediately — the store's own products/categories
  // are about to be fetched, and this is a visibly better first
  // impression than an empty flash before content lands.
  document.getElementById("categoryTiles").innerHTML = skeletonCategoryTilesHtml(6);
  productGrid.innerHTML = skeletonProductCardsHtml(8);

  await loadProducts(key);
  // load this store's products from Supabase
  await loadCategoryHindiMap(key);

  const store = data[key];
  if (!store) return;

  window.scrollTo({
  top: 0,
  behavior: "smooth"
});

  storeTitle.innerText = store.title;

  // Keep the URL in sync so refreshing (or sharing the link) lands
  // back on this same store/category/page instead of resetting.
  updateStoreUrl(key, jumpToCategory || null, jumpToPage);

  const storeSearch = document.getElementById("storeSearch");
  if (storeSearch) storeSearch.value = "";

  // Top-level tiles = registered top-level categories, plus any
  // category name that has products but was never formally added to
  // the categories table (so nothing a shopper could actually buy
  // silently disappears) — minus anything that's a registered
  // sub-category, since those only show up once their parent tile is
  // tapped, not alongside the main tiles.
  const subcategoryNames = new Set(
    Object.values(categoryHierarchy.subByParentId).flat().map(c => c.name)
  );
  const topLevelNames = categoryHierarchy.topLevel.map(c => c.name);
  const orphanNames = Object.keys(store.categories).filter(
    name => !topLevelNames.includes(name) && !subcategoryNames.has(name)
  );
  const cats = [...topLevelNames, ...orphanNames].sort((a, b) => a.localeCompare(b));

  if (cats.length === 0) {
    productGrid.innerHTML = "<p>No products yet</p>";
    document.getElementById("categoryTiles").innerHTML = "";
    return;
  }

  // Jumping straight to a sub-category (e.g. from the mega-menu) —
  // show that sub-category's tile screen (with its siblings), not
  // the top-level tiles, so the shopper sees where they landed.
  if (jumpToCategory && subcategoryNames.has(jumpToCategory)) {
    const allSubs = Object.values(categoryHierarchy.subByParentId).flat();
    const subRecord = allSubs.find(c => c.name === jumpToCategory);
    const parentRecord = subRecord && categoryHierarchy.topLevel.find(c => c.id === subRecord.parent_id);
    if (parentRecord) currentParentCategoryView = parentRecord;
  }

  // Jumping straight to a parent category — land on its sub-category
  // tile screen (like tapping its tile would), while the product
  // grid below still fills with that parent's full combined list via
  // selectStoreCategory below.
  if (jumpToCategory && topLevelNames.includes(jumpToCategory)) {
    const parentRecord = categoryHierarchy.topLevel.find(c => c.name === jumpToCategory);
    const hasSubs = parentRecord && (categoryHierarchy.subByParentId[parentRecord.id] || []).length > 0;
    if (hasSubs) currentParentCategoryView = parentRecord;
  }

  renderCategoryTiles(key, store, cats);

  const startCategory = (jumpToCategory && (cats.includes(jumpToCategory) || subcategoryNames.has(jumpToCategory))) ? jumpToCategory : null;
  selectStoreCategory(key, store, startCategory, jumpToPage || 1);
}

/** The one place that actually applies a category choice — used by
 *  both the "All Categories" tile and every specific-category tile,
 *  so there's a single source of truth for what happens on selection
 *  instead of duplicating this in every click handler. */
/** Flattening `{ category: [products] }` into one list naively
 *  groups everything category-by-category — so adding one product to
 *  "Atta" would drag that category's whole block to the front
 *  (wherever Atta's newest item currently sorts), making it look
 *  like all 5 other Atta products "jumped" too. Re-sorting by actual
 *  timestamp after flattening keeps "All Categories" truly newest
 *  product first, not newest category first. */
function allStoreProductsSorted(store) {
  return Object.values(store.categories)
    .flat()
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
}

/** Shows/hides the whole category-tile bar (top-level tiles, or a
 *  drilled-in parent's sub-category tiles — whichever is currently
 *  rendered inside #categoryTiles) and its matching "Categories"
 *  back button, so picking a specific category can clear the tile
 *  clutter away while browsing its products. */
function setCategoryTilesVisible(visible) {
  const tiles = document.getElementById("categoryTiles");
  const backBtn = document.getElementById("tilesBackBtn");
  if (tiles) tiles.classList.toggle("hidden", !visible);
  if (backBtn) backBtn.classList.toggle("hidden", visible);
}

/** The "Categories" back button's click handler — just reveals
 *  whatever tile screen (top-level or a drilled-in parent's
 *  sub-categories) was showing before the last selection hid it;
 *  it doesn't change the selection or the products on screen. */
function showCategoryTilesAgain() {
  setCategoryTilesVisible(true);
}

/** Works out the product list for a given category selection — a
 *  plain leaf category's own products, a parent category's own +
 *  every child's combined, or the whole store when no category is
 *  selected. Shared by category selection and the brand filter so
 *  both always agree on what's "in scope" right now. */
function getCategoryItems(store, cat) {
  if (!cat) return allStoreProductsSorted(store);

  const catRecord = categoryHierarchy.topLevel.find(c => c.name === cat);
  const subs = catRecord ? (categoryHierarchy.subByParentId[catRecord.id] || []) : [];

  if (subs.length > 0) {
    const own = store.categories[cat] || [];
    const fromSubs = subs.flatMap(sub => store.categories[sub.name] || []);
    return [...own, ...fromSubs].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  }

  return store.categories[cat] || [];
}

function selectStoreCategory(key, store, cat, startPage) {
  currentCategory = cat;

  const storeSearch = document.getElementById("storeSearch");
  if (storeSearch) storeSearch.value = "";
  const brandFilter = document.getElementById("brandFilter");
  if (brandFilter) brandFilter.value = "";
  const sortFilter = document.getElementById("sortFilter");
  if (sortFilter) sortFilter.value = "relevance";

  document.querySelectorAll(".category-tile").forEach(t => {
    t.classList.toggle("active", (t.dataset.tileCategory || null) === cat);
  });

  // A category can be a straightforward leaf (its own product list),
  // or a parent like "Furniture" that groups everything under its
  // sub-categories — in that case, show every product from itself
  // and every child combined, the same way "All Categories" shows
  // every product in the whole store, so opening the parent alone
  // already surfaces everything in it without drilling in first.
  const catRecord = cat ? categoryHierarchy.topLevel.find(c => c.name === cat) : null;
  const subs = catRecord ? (categoryHierarchy.subByParentId[catRecord.id] || []) : [];
  const items = getCategoryItems(store, cat);

  // A genuine leaf pick (a plain category, or a sub-category tapped
  // inside a drilled-in parent's screen) is a final choice — clear
  // the tile bar out of the way so the products take center stage.
  // A parent category (still has children to browse) or "All
  // Categories" keeps the tile bar visible since that's still
  // browsing, not a finished pick.
  const isLeafSelection = !!cat && subs.length === 0;
  setCategoryTilesVisible(!isLeafSelection);

  // Picking a category fresh (from a tile click) always starts back
  // on page 1 — startPage is only ever meaningful when we're
  // restoring state after a refresh, i.e. straight from openStore().
  const targetPage = startPage && startPage > 1 && startPage <= Math.ceil(items.length / PAGE_SIZE)
    ? startPage
    : 1;

  storeProductsPage = targetPage;
  updateStoreUrl(key, cat, targetPage);
  renderProductGrid(items, "No products in this category");
  // The brand dropdown should only ever offer brands that actually
  // exist within whatever's on screen right now — not every brand in
  // the whole store — so switching category always narrows it down.
  populateBrandFilter(key, items);

  // Feels like a fresh page for that category, without an actual
  // page reload — scroll back up so the shopper lands on the new
  // results instead of wherever they'd scrolled to previously.
  window.scrollTo({ top: 0, behavior: "smooth" });
}

/** Fills the "Shop by Brand" dropdown with whatever distinct brands
 *  exist among the given items (the current category's products, or
 *  every product in the store when browsing "All Categories") — and
 *  hides it entirely when none of them have a brand set, so it
 *  doesn't clutter the page. */
function populateBrandFilter(key, items) {
  const select = document.getElementById("brandFilter");
  if (!select || !data[key]) return;

  const brands = [...new Set((items || []).map(p => p.brand).filter(Boolean))].sort();

  if (brands.length === 0) {
    select.classList.add("hidden");
    return;
  }

  select.innerHTML = `<option value="">Shop by Brand — All Brands</option>` +
    brands.map(b => `<option value="${b}">${b}</option>`).join("");
  select.value = "";
  select.classList.remove("hidden");
}

/** Picking a brand narrows down whatever's currently on screen (the
 *  active category, or every product when browsing "All Categories")
 *  to just that brand — matching what the dropdown itself offered,
 *  instead of reaching across the whole store. */
function filterByBrand() {
  const brand = document.getElementById("brandFilter").value;

  if (!brand) {
    showProducts(currentStore, currentCategory);
    return;
  }

  const scopedItems = getCategoryItems(data[currentStore], currentCategory);
  const matches = scopedItems.filter(p => p.brand === brand);

  document.querySelectorAll(".category-tile").forEach(t => t.classList.remove("active"));
  const storeSearch = document.getElementById("storeSearch");
  if (storeSearch) storeSearch.value = "";
  storeProductsPage = 1;
  renderProductGrid(matches, `No products from ${brand} in this category`);
}

function searchStoreProducts() {
  const q = (document.getElementById("storeSearch")?.value || "").trim().toLowerCase();

  if (!q) {
    showProducts(currentStore, currentCategory);
    return;
  }

  // Search across every category in the current store, not just the active one.
  const allItems = allStoreProductsSorted(data[currentStore]);
  const matches = allItems.filter(p => p.name.toLowerCase().includes(q));

  document.querySelectorAll(".category-tile").forEach(t => t.classList.remove("active"));
  storeProductsPage = 1;
  renderProductGrid(matches, `No products match "${q}"`);
}

function showProducts(store, cat) {
  const items = data[store].categories[cat] || [];
  storeProductsPage = 1;
  renderProductGrid(items, "No products in this category");
}

let storeProductsPage = 1;
let currentStoreProductsList = [];

/** The price actually shown on a card — first variant's price if
 *  the product has variants, otherwise the base price. Keeps sorting
 *  consistent with what the shopper sees, not some other field. */
function getEffectivePrice(p) {
  const hasVariants = p.variants && p.variants.length > 0;
  return hasVariants ? p.variants[0].price : p.price;
}

function getEffectiveMrp(p) {
  const hasVariants = p.variants && p.variants.length > 0;
  const mrp = hasVariants ? (p.variants[0].mrp || p.mrp) : p.mrp;
  return mrp || null;
}

function getDiscountPercent(p) {
  const mrp = getEffectiveMrp(p);
  const price = getEffectivePrice(p);
  if (!mrp || mrp <= price) return 0;
  return ((mrp - price) / mrp) * 100;
}

let productRatingsMap = null;

/** Fetched once, lazily — only the shopper who actually picks
 *  "Rating: High to Low" needs this, so there's no point querying it
 *  on every store visit. */
async function loadProductRatingsMap() {
  if (productRatingsMap) return productRatingsMap;

  const { data: rows, error } = await supabase
    .from("product_ratings")
    .select("product_id, avg_rating");

  productRatingsMap = {};
  if (!error && rows) {
    rows.forEach(r => { productRatingsMap[r.product_id] = r.avg_rating; });
  }
  return productRatingsMap;
}

/** Re-sorts whatever's currently on screen (a category, "All
 *  Categories", a search, or a brand filter) according to the Sort
 *  dropdown, then re-renders — the sort applies to the current view
 *  rather than being tied to one specific category or filter. */
async function applySortAndRender() {
  const sortValue = document.getElementById("sortFilter").value;
  let items = [...currentStoreProductsList];

  if (sortValue === "price_low") {
    items.sort((a, b) => getEffectivePrice(a) - getEffectivePrice(b));
  } else if (sortValue === "price_high") {
    items.sort((a, b) => getEffectivePrice(b) - getEffectivePrice(a));
  } else if (sortValue === "discount") {
    items.sort((a, b) => getDiscountPercent(b) - getDiscountPercent(a));
  } else if (sortValue === "rating") {
    await loadProductRatingsMap();
    items.sort((a, b) => (productRatingsMap[b.id] || 0) - (productRatingsMap[a.id] || 0));
  }
  // "relevance" — leave the current (newest-first) order as-is.

  storeProductsPage = 1;
  renderProductGrid(items, "No products in this category");
}


function goToStoreProductsPage(n) {
  storeProductsPage = n;
  updateStoreUrl(currentStore, currentCategory, n);
  renderProductGrid(currentStoreProductsList, "No products in this category");
  window.scrollTo({ top: productGrid.offsetTop - 100, behavior: "smooth" });
}

/** "Sabji Masala" → "Sabji Masala (सब्ज़ी मसाला)" when a Hindi name
 *  is set — used everywhere a product name is shown to customers. */
/** Escapes a plain-text field (like a product description) before
 *  inserting it into innerHTML, so stray "<" or "&" characters an
 *  admin typed don't accidentally break the page's markup. */
function escapeHtmlForDisplay(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML.replace(/\n/g, "<br>");
}

/** Description/Specifications on the product page collapse by
 *  default and expand on tap — mirrors the compact accordion pattern
 *  most shopping apps use so the page doesn't open already sprawling
 *  with text before you've even seen the price or Add to Cart. */
function toggleAccordion(headerEl) {
  const content = headerEl.nextElementSibling;
  const icon = headerEl.querySelector(".accordion-icon");
  const isOpen = content.classList.toggle("open");
  icon.textContent = isOpen ? "\u2212" : "+";
}

function displayProductName(p) {
  return p.name_hi ? `${p.name} <span class="name-hi">(${p.name_hi})</span>` : p.name;
}

function renderProductGrid(items, emptyMessage) {
  currentStoreProductsList = items;
  productGrid.innerHTML = "";

  if (items.length === 0) {
    productGrid.innerHTML = emptyStateHtml("fa-basket-shopping", emptyMessage, "Try a different category or search term.");
    const pagEl = document.getElementById("storeProductsPagination");
    if (pagEl) pagEl.innerHTML = "";
    return;
  }

  const pageItems = paginateArray(items, storeProductsPage, PAGE_SIZE);

  pageItems.forEach(p => {
    const hasVariants = p.variants && p.variants.length > 0;
    const outOfStock = p.in_stock === false;

    // Shown price always matches whichever variant is currently
    // selected in the dropdown (defaults to the first one) — not
    // just "from the cheapest", so it stays accurate as you pick sizes.
    const initial = hasVariants ? p.variants[0] : { price: p.price, mrp: p.mrp };
    const initialMrp = hasVariants ? (initial.mrp || p.mrp) : initial.mrp;
    const hasDiscount = initialMrp && initialMrp > initial.price;
    const discountPct = hasDiscount ? Math.round(((initialMrp - initial.price) / initialMrp) * 100) : 0;

    const priceHtml = hasDiscount
      ? `₹${initial.price} <span class="mrp-strike">₹${initialMrp}</span>`
      : `₹${initial.price}`;

    const variantSelect = hasVariants ? variantDropdownHtml(p, outOfStock) : "";

    const actionHtml = outOfStock
      ? `<button class="out-of-stock-btn" disabled>Out of Stock</button>`
      : (hasVariants
          ? `<button onclick='addFromCardSelect(this, ${JSON.stringify(p)})'>Add to Cart</button>`
          : `<button onclick='addToCart(${JSON.stringify(p)})'>Add to Cart</button>`);

    productGrid.innerHTML += `
      <div class="product${outOfStock ? " product-out-of-stock" : ""}">
        <span id="badge-${p.id}" class="discount-badge" style="${hasDiscount ? "" : "display:none;"}">-${discountPct}%</span>
        <a href="product.html?id=${p.id}" style="text-decoration:none;color:inherit;">
          <img src="${p.images ? p.images[0] : p.img}">
          <h4>${displayProductName(p)}</h4>
          <p id="price-${p.id}">${priceHtml}</p>
        </a>
        ${variantSelect}
        <a class="btn btn-outline btn-sm" href="product.html?id=${p.id}">
          View Details
        </a>
        ${actionHtml}
      </div>`;
  });

  renderPagination("storeProductsPagination", items.length, storeProductsPage, PAGE_SIZE, "goToStoreProductsPage");
}

/** Compact size/pack dropdown shown on a product card (grid or
 *  featured row) — cheaper on space than a row of chip buttons. */
function variantDropdownHtml(p, disabled) {
  const variantsJson = JSON.stringify(p.variants).replace(/'/g, "&apos;").replace(/"/g, "&quot;");
  return `
    <select class="variant-select" ${disabled ? "disabled" : ""}
      data-product-id="${p.id}" data-variants='${variantsJson}' data-product-mrp="${p.mrp || ""}"
      onchange="updateCardPrice(this)">
      ${p.variants.map((v, i) => `<option value="${i}">${v.label} — ₹${v.price}</option>`).join("")}
    </select>
  `;
}

/** Keeps the price / MRP strike-through / discount badge on a product
 *  card in sync with whichever size the shopper just picked. */
function updateCardPrice(selectEl) {
  const productId = selectEl.dataset.productId;
  const variants = JSON.parse(selectEl.dataset.variants.replace(/&quot;/g, '"').replace(/&apos;/g, "'"));
  const v = variants[Number(selectEl.value)];
  if (!v) return;

  const mrp = v.mrp || Number(selectEl.dataset.productMrp) || null;
  const priceEl = document.getElementById("price-" + productId);
  const badgeEl = document.getElementById("badge-" + productId);
  const hasDiscount = mrp && mrp > v.price;

  if (priceEl) {
    priceEl.innerHTML = hasDiscount
      ? `₹${v.price} <span class="mrp-strike">₹${mrp}</span>`
      : `₹${v.price}`;
  }

  if (badgeEl) {
    if (hasDiscount) {
      const pct = Math.round(((mrp - v.price) / mrp) * 100);
      badgeEl.textContent = `-${pct}%`;
      badgeEl.style.display = "";
    } else {
      badgeEl.style.display = "none";
    }
  }
}

/** Reads the <select> right before the clicked "Add to Cart" button
 *  and adds whichever size/pack is currently chosen. */
function addFromCardSelect(button, product) {
  const select = button.parentElement.querySelector(".variant-select");
  const index = select ? Number(select.value) : 0;
  addToCart(product, product.variants[index]);
}

/***********************
    SHARE
    Uses the device's native share sheet (WhatsApp, etc.) where
    available; falls back to copying the link on desktop browsers
    that don't support it.
************************/

async function shareContent(title, text, url) {
  if (navigator.share) {
    try {
      await navigator.share({ title, text, url });
    } catch (e) {
      // user backed out of the share sheet — nothing to do
    }
    return;
  }

  try {
    await navigator.clipboard.writeText(url);
    alert("Link copied! Paste it anywhere to share.");
  } catch (e) {
    if (window.customPrompt) {
      customPrompt("Copy this link to share:", url);
    } else {
      prompt("Copy this link to share:", url);
    }
  }
}

function shareSite() {
  shareContent(
    "AOne Bazaar",
    "Supermarket, kirana store and cafe under one roof — order online from AOne Bazaar!",
    location.origin + "/index.html"
  );
}

function shareCurrentStore() {
  if (!currentStore || !data[currentStore]) return;
  shareContent(
    data[currentStore].title,
    `Check out ${data[currentStore].title} on AOne Bazaar!`,
    `${location.origin}/index.html?store=${currentStore}`
  );
}

function shareCurrentProduct() {
  if (!currentProduct) return;
  shareContent(
    currentProduct.name,
    `${currentProduct.name} — ₹${currentProduct.price} on AOne Bazaar`,
    `${location.origin}/product.html?id=${currentProduct.id}`
  );
}

/** A visual "Shop by Category" tile grid, shown right under the
 *  store title — each tile borrows its thumbnail from the first
 *  product filed under that category, so no separate category-image
 *  upload is needed. Tapping a tile just clicks the matching chip in
 *  the existing category bar, so all the filtering logic stays in
 *  one place. */
function renderCategoryTiles(key, store, cats) {
  const container = document.getElementById("categoryTiles");
  if (!container) return;

  const escapeAttr = str => String(str).replace(/"/g, "&quot;");

  // Drilled into a parent category ("Furniture") — show its
  // children (Almirah, Sofa, Bed) plus a way back, instead of the
  // normal top-level tile screen.
  if (currentParentCategoryView) {
    const parent = currentParentCategoryView;
    const subs = categoryHierarchy.subByParentId[parent.id] || [];

    const backTile = `
      <button type="button" class="category-tile category-tile-back-btn" data-tile-back>
        <span class="category-tile-img-wrap category-tile-all">
          <i class="fa-solid fa-arrow-left"></i>
        </span>
        <span class="category-tile-label">Back</span>
      </button>
    `;

    const subTiles = subs.map(sub => {
      const items = store.categories[sub.name] || [];
      const thumb = (items[0] && items[0].images && items[0].images[0]) || "images/logo192.png";

      return `
        <button type="button" class="category-tile" data-tile-category="${escapeAttr(sub.name)}">
          <span class="category-tile-img-wrap">
            <img src="${thumb}" alt="${escapeAttr(sub.name)}" loading="lazy" />
          </span>
          <span class="category-tile-label">${displayCategoryName(sub.name)}</span>
        </button>
      `;
    }).join("");

    container.innerHTML = `<div class="category-tiles-heading">${displayCategoryName(parent.name)}</div>` + backTile + subTiles;

    container.querySelector("[data-tile-back]").onclick = () => {
      currentParentCategoryView = null;
      renderCategoryTiles(key, store, cats);
      // Back to the top-level tiles should feel like landing on the
      // store fresh again — every product, same as "All Categories".
      selectStoreCategory(key, store, null);
    };

    container.querySelectorAll(".category-tile[data-tile-category]").forEach(tile => {
      tile.onclick = () => {
        selectStoreCategory(key, store, tile.dataset.tileCategory);
      };
    });

    return;
  }

  // Normal top-level screen: "All Categories" first, then every
  // top-level category — every tile's thumbnail is forced into the
  // same circle treatment as a sub-category tile (see
  // .category-tile-img-wrap in style.css), whether it has
  // sub-categories or not; only the small layer-group badge in the
  // corner marks a tile as a parent that drills down.
  const allTile = `
    <button type="button" class="category-tile" data-tile-category="">
      <span class="category-tile-img-wrap category-tile-all">
        <i class="fa-solid fa-border-all"></i>
      </span>
      <span class="category-tile-label">All Categories</span>
    </button>
  `;

  const catTiles = cats.map(cat => {
    const catRecord = categoryHierarchy.topLevel.find(c => c.name === cat);
    const subs = catRecord ? (categoryHierarchy.subByParentId[catRecord.id] || []) : [];
    const hasSubs = subs.length > 0;

    const items = store.categories[cat] || [];
    let thumb = items[0] && items[0].images && items[0].images[0];

    // A parent category with no products of its own (everything's
    // filed under its sub-categories instead) borrows a thumbnail
    // from the first sub-category that has one.
    if (!thumb && hasSubs) {
      for (const sub of subs) {
        const subItems = store.categories[sub.name];
        if (subItems && subItems[0] && subItems[0].images && subItems[0].images[0]) {
          thumb = subItems[0].images[0];
          break;
        }
      }
    }
    thumb = thumb || "images/logo192.png";

    return `
      <button type="button" class="category-tile" data-tile-category="${escapeAttr(cat)}" ${hasSubs ? "data-has-subs" : ""}>
        <span class="category-tile-thumb">
          <span class="category-tile-img-wrap">
            <img src="${thumb}" alt="${escapeAttr(cat)}" loading="lazy" />
          </span>
          ${hasSubs ? `<span class="category-tile-subs-badge"><i class="fa-solid fa-layer-group"></i></span>` : ""}
        </span>
        <span class="category-tile-label">${displayCategoryName(cat)}</span>
      </button>
    `;
  }).join("");

  container.innerHTML = allTile + catTiles;

  container.querySelectorAll(".category-tile[data-tile-category]").forEach(tile => {
    tile.onclick = () => {
      const cat = tile.dataset.tileCategory || null;

      if (cat && tile.hasAttribute("data-has-subs")) {
        currentParentCategoryView = categoryHierarchy.topLevel.find(c => c.name === cat);
        renderCategoryTiles(key, store, cats);
        // Fill the product grid with this category's full combined
        // list right away (own + every sub-category), same as
        // "All Categories" shows everything at once — no need to
        // drill into a specific sub-category just to see products.
        selectStoreCategory(key, store, cat);
        return;
      }

      selectStoreCategory(key, store, cat);
    };
  });
}

function closeStore() {
  storeSection.classList.add("hidden");
  heroSection.style.display = "flex";
  setHomepageFeaturedVisible(true);
  history.replaceState(null, "", location.pathname);
}

/** Keeps ?store=&category= in the URL in sync with what's on screen,
 *  without adding a new history entry for every click — so refreshing
 *  the page (or sharing the link) lands back on the same view. */
function updateStoreUrl(store, category, page) {
  const params = new URLSearchParams();
  if (store) params.set("store", store);
  if (category) params.set("category", category);
  if (page && page > 1) params.set("page", page);
  const query = params.toString();
  history.replaceState(null, "", query ? `${location.pathname}?${query}` : location.pathname);
}

/***********************
    FEATURED HOMEPAGE SECTIONS (admin-curated)
    Products with a `featured_section` set (e.g. "Best Deal",
    "Trending Products") show up here in their own named row on
    the homepage — separate from browsing a specific store.
************************/

/** The homepage's "Best Deal" / "Trending" rows pull featured
 *  products from every store at once — they should only ever show
 *  on the homepage itself, so this hides them entirely once a store
 *  is opened, and brings them back when the shopper backs out. */
function setHomepageFeaturedVisible(visible) {
  const homeContainer = document.getElementById("featuredSections");
  if (homeContainer) homeContainer.style.display = visible ? "" : "none";
}

async function loadFeaturedSections() {
  const container = document.getElementById("featuredSections");
  if (!container) return; // not on the homepage

  const { data: rows, error } = await supabase
    .from("products")
    .select("*")
    .not("featured_section", "is", null)
    .eq("in_stock", true)
    .order("featured_section")
    .order("featured_order", { ascending: true });

  if (error || !rows || rows.length === 0) {
    if (error) console.error(error);
    return;
  }

  const sections = {};
  rows.forEach(p => {
    if (!sections[p.featured_section]) sections[p.featured_section] = [];
    sections[p.featured_section].push(p);
  });

  container.innerHTML = Object.entries(sections).map(([title, items]) => `
    <section class="featured-section">
      <div class="container">
        <h2 class="featured-section-title">${title}</h2>
        <div class="featured-row">
          ${items.map(p => featuredProductCardHtml(p)).join("")}
        </div>
      </div>
    </section>
  `).join("");
}

function featuredProductCardHtml(p) {
  const hasVariants = p.variants && p.variants.length > 0;
  const initial = hasVariants ? p.variants[0] : { price: p.price, mrp: p.mrp };
  const initialMrp = hasVariants ? (initial.mrp || p.mrp) : initial.mrp;
  const hasDiscount = initialMrp && initialMrp > initial.price;
  const discountPct = hasDiscount ? Math.round(((initialMrp - initial.price) / initialMrp) * 100) : 0;

  return `
    <div class="featured-card">
      <span id="badge-${p.id}" class="discount-badge" style="${hasDiscount ? "" : "display:none;"}">-${discountPct}%</span>
      <a href="product.html?id=${p.id}" style="text-decoration:none;color:inherit;">
        <img src="${p.images && p.images[0] ? p.images[0] : p.img || ''}">
        <h4>${displayProductName(p)}</h4>
        <p id="price-${p.id}">${hasDiscount ? `₹${initial.price} <span class="mrp-strike">₹${initialMrp}</span>` : `₹${initial.price}`}</p>
      </a>
      ${hasVariants ? variantDropdownHtml(p, false) : ""}
      ${hasVariants
        ? `<button onclick='addFromCardSelect(this, ${JSON.stringify(p)})'>Add to Cart</button>`
        : `<button onclick='addToCart(${JSON.stringify(p)})'>Add to Cart</button>`
      }
    </div>
  `;
}

/***********************
    QUICK VARIANT PICKER (grid "Add to Cart" for products with sizes)
************************/

let quickVariantProduct = null;

function openVariantPicker(p) {
  quickVariantProduct = p;

  document.getElementById("quickVariantProductName").innerText = p.name;

  document.getElementById("quickVariantOptions").innerHTML = p.variants.map((v, i) => `
    <button type="button" onclick="pickVariantAndAdd(${i})">
      ${v.label} — ₹${v.price}
    </button>
  `).join("");

  document.getElementById("quickVariantModal").classList.remove("hidden");
}

function closeVariantPicker() {
  document.getElementById("quickVariantModal").classList.add("hidden");
  quickVariantProduct = null;
}

function pickVariantAndAdd(index) {
  if (!quickVariantProduct) return;
  addToCart(quickVariantProduct, quickVariantProduct.variants[index]);
  closeVariantPicker();
}

/***********************
    CART
************************/
function openCart() {

  const modal = document.getElementById("cartModal");

  if (!modal) {
    console.error("cartModal not found");
    return;
  }

  modal.classList.remove("hidden");
  updateMinOrderNotice();
  loadSavedAddresses();

  renderCart();
}

/***********************
    SAVED ADDRESSES
    So a repeat customer doesn't have to retype "Master Naseem
    Complex, Lahideeh Bazar..." every single time they order.
************************/

let savedAddressesCache = [];

async function loadSavedAddresses() {
  const select = document.getElementById("savedAddressSelect");
  if (!select) return;

  // Only makes sense once someone's actually signed in (their phone
  // number lookup created a Supabase session) — a first-time visitor
  // won't have one yet, so just leave the dropdown hidden.
  if (!currentSupabaseUser) {
    select.classList.add("hidden");
    return;
  }

  const { data: rows, error } = await supabase
    .from("addresses")
    .select("*")
    .eq("customer_id", currentSupabaseUser.id)
    .order("is_default", { ascending: false })
    .order("created_at", { ascending: false });

  if (error || !rows || rows.length === 0) {
    savedAddressesCache = [];
    select.classList.add("hidden");
    return;
  }

  savedAddressesCache = rows;
  select.innerHTML = `<option value="">+ Use a new address</option>` +
    rows.map(a => `<option value="${a.id}">${a.label} — ${a.address_text.slice(0, 40)}${a.address_text.length > 40 ? "…" : ""}</option>`).join("");
  select.classList.remove("hidden");

  // Auto-fill the most recent (or default) saved address the first
  // time the cart opens, so returning customers barely have to type.
  if (!document.getElementById("customerAddress").value.trim()) {
    select.value = rows[0].id;
    selectSavedAddress();
  }
}

function selectSavedAddress() {
  const select = document.getElementById("savedAddressSelect");
  const addr = savedAddressesCache.find(a => a.id === select.value);
  const addressField = document.getElementById("customerAddress");
  const saveCheckbox = document.getElementById("saveAddressCheckbox");

  if (addr) {
    addressField.value = addr.address_text;
    if (addr.full_name) document.getElementById("customerName").value = addr.full_name;
    // It's already saved — no need to save it again.
    if (saveCheckbox) saveCheckbox.checked = false;
  } else {
    addressField.value = "";
    if (saveCheckbox) saveCheckbox.checked = true;
  }
}

/** Called right after an order goes through — stores the address for
 *  next time, unless it's already saved or the shopper unchecked the
 *  "save this address" box. */
async function maybeSaveAddress(name, address) {
  const saveCheckbox = document.getElementById("saveAddressCheckbox");
  if (!saveCheckbox || !saveCheckbox.checked) return;
  if (!currentSupabaseUser || !address.trim()) return;

  const alreadySaved = savedAddressesCache.some(
    a => a.address_text.trim().toLowerCase() === address.trim().toLowerCase()
  );
  if (alreadySaved) return;

  const label = savedAddressesCache.length === 0 ? "Home" : `Address ${savedAddressesCache.length + 1}`;

  await supabase.from("addresses").insert({
    customer_id: currentSupabaseUser.id,
    label,
    full_name: name,
    address_text: address,
    is_default: savedAddressesCache.length === 0
  });
}

function closeCart() {

  const modal = document.getElementById("cartModal");

  if (modal) {
    modal.classList.add("hidden");
  }

}

function addToCart(p, variant) {
  const cartId = variant ? `${p.id}::${variant.label}` : p.id;
  const found = cart.find(i => i.cartId === cartId);

  if (found) {
    found.qty++;
  } else {
    cart.push({
      ...p,
      cartId,
      variantLabel: variant ? variant.label : null,
      price: variant ? variant.price : p.price,
      qty: 1
    });
  }
  saveCart();
}

let appliedCoupon = null; // { code, discount_amount }

function removeItem(i) {
  cart.splice(i, 1);
  saveCart();
  if (cart.length === 0) removeCoupon();
  renderCart();
}

function changeQty(i, d) {
  cart[i].qty += d;
  if (cart[i].qty <= 0) cart.splice(i, 1);
  saveCart();
  if (cart.length === 0) removeCoupon();
  renderCart();
}

function cartSubtotal() {
  return cart.reduce((sum, item) => sum + item.price * item.qty, 0);
}

function renderCart() {

  const container = document.getElementById("cartItems");
  container.innerHTML = "";

  if (cart.length === 0) {
    container.innerHTML = emptyStateHtml("fa-cart-shopping", "Your cart is empty", "Add something tasty to get started!");
    updateCartTotals();
    return;
  }

  cart.forEach((item, index) => {

    let price = item.price * item.qty;

    container.innerHTML += `
      <div class="cart-item">

        <div>
          <div class="cart-item-name">${item.name}${item.variantLabel ? ` <span style="color:var(--ink-faint);font-weight:400;">(${item.variantLabel})</span>` : ''}</div>
          <div class="cart-item-price">₹${price}</div>
        </div>

        <div class="qty-controls">
          <button onclick="changeQty(${index}, -1)">-</button>
          <span>${item.qty}</span>
          <button onclick="changeQty(${index}, 1)">+</button>
        </div>

      </div>
    `;
  });

  updateCartTotals();
}

function updateCartTotals() {
  const subtotal = cartSubtotal();
  const discount = appliedCoupon ? appliedCoupon.discount_amount : 0;
  const goodsTotal = Math.max(0, subtotal - discount);
  const deliveryCharge = cart.length > 0 ? calculateDeliveryCharge(goodsTotal) : 0;
  const total = goodsTotal + deliveryCharge;

  document.getElementById("cartSubtotal").innerText = subtotal;
  document.getElementById("cartDiscount").innerText = discount;
  document.getElementById("cartTotal").innerText = total;

  document.getElementById("cartSubtotalRow").classList.toggle("hidden", !appliedCoupon);
  document.getElementById("cartDiscountRow").classList.toggle("hidden", !appliedCoupon);

  const deliveryRow = document.getElementById("cartDeliveryRow");
  const deliveryLabel = document.getElementById("cartDeliveryCharge");
  if (deliveryRow && deliveryLabel) {
    if (cart.length === 0) {
      deliveryRow.classList.add("hidden");
    } else {
      deliveryRow.classList.remove("hidden");
      deliveryLabel.innerText = deliveryCharge > 0 ? "₹" + deliveryCharge : "Free";
    }
  }
}

async function applyCoupon() {
  const code = document.getElementById("couponCode").value.trim();
  const msg = document.getElementById("couponMessage");

  if (!code) {
    msg.textContent = "Enter a coupon code";
    msg.className = "coupon-message err";
    return;
  }

  if (cart.length === 0) {
    msg.textContent = "Add items to your cart first";
    msg.className = "coupon-message err";
    return;
  }

  const { data: rows, error } = await supabase.rpc("validate_coupon", {
    p_code: code,
    p_order_total: cartSubtotal()
  });

  if (error) {
    appliedCoupon = null;
    msg.textContent = error.message.replace(/^.*?:\s*/, "");
    msg.className = "coupon-message err";
    updateCartTotals();
    return;
  }

  const result = rows[0];
  appliedCoupon = { code: result.code, discount_amount: result.discount_amount };

  msg.innerHTML = `"${result.code}" applied — you saved ₹${result.discount_amount} <span class="coupon-remove-link" onclick="removeCoupon()">Remove</span>`;
  msg.className = "coupon-message ok";
  updateCartTotals();
}

function removeCoupon() {
  appliedCoupon = null;
  document.getElementById("couponCode").value = "";
  const msg = document.getElementById("couponMessage");
  msg.textContent = "";
  msg.className = "coupon-message";
  updateCartTotals();
}



/***********************
    ORDER
************************/
async function placeOrder() {

  const user = JSON.parse(localStorage.getItem("user"));

  if (!user) {
    alert("Please enter mobile number first");
    openLogin();
    return;
  }

  if (cart.length === 0) {
    alert("Cart empty");
    return;
  }

  const name = customerName.value.trim();
  const address = customerAddress.value.trim();

  if (!name || !address) {
    alert("Enter name and address");
    return;
  }

  const id = generateOrderID();

  let subtotal = 0;
  let message =
    `🛒 *New Order*%0AID: ${id}%0AName: ${name}%0A`;
  message += `%0APhone: ${user.phone}`;

  cart.forEach(p => {
    const price = p.price * p.qty;
    subtotal += price;
    const label = p.name + (p.variantLabel ? ` (${p.variantLabel})` : "");
    message += `%0A• ${label} x${p.qty} = ₹${price}`;
  });

  const discount = appliedCoupon ? appliedCoupon.discount_amount : 0;
  const goodsTotal = Math.max(0, subtotal - discount);

  if (goodsTotal < getMinOrder()) {
    alert(`Minimum order is ₹${getMinOrder()}. Please add more items to your cart.`);
    return;
  }

  const deliveryCharge = calculateDeliveryCharge(goodsTotal);
  const total = goodsTotal + deliveryCharge;

  const amountPaid = selectedPaymentOption === "full" ? total : Math.ceil(total / 2);
  const balanceDue = total - amountPaid;

  if (appliedCoupon) {
    message += `%0ACoupon: ${appliedCoupon.code} (−₹${discount})`;
  }
  message += `%0ASubtotal: ₹${goodsTotal}`;
  message += deliveryCharge > 0 ? `%0ADelivery charge: ₹${deliveryCharge}` : `%0ADelivery: Free`;
  message += `%0ATotal: ₹${total}%0APaid via UPI: ₹${amountPaid} (screenshot attached)`;
  message += balanceDue > 0 ? `%0ABalance on delivery: ₹${balanceDue}` : `%0ABalance on delivery: ₹0 (Paid in full)`;
  message += `%0AAddress: ${address}`;

  const invoiceNo = generateInvoiceNumber();

  const { error } = await supabase.from("orders").insert({
    id,
    invoice_no: invoiceNo,
    customer_id: currentSupabaseUser ? currentSupabaseUser.id : null,
    customer_phone: user.phone,
    customer_name: name,
    address,
    items: cart.map(p => ({ id: p.id, name: p.name + (p.variantLabel ? ` (${p.variantLabel})` : ""), price: p.price, qty: p.qty })),
    subtotal,
    coupon_code: appliedCoupon ? appliedCoupon.code : null,
    discount,
    delivery_charge: deliveryCharge,
    total,
    payment: "COD",
    status: "NEW"
  });

  if (error) {
    // If this fires, the customer isn't fully logged in via Firebase
    // yet (RLS needs a verified identity to accept the order). The
    // order still goes out over WhatsApp so the shop doesn't miss it.
    console.warn("Order not saved to Supabase (needs login):", error.message);
  } else if (appliedCoupon) {
    const { error: redeemError } = await supabase.rpc("redeem_coupon", { p_code: appliedCoupon.code });
    if (redeemError) console.warn("Coupon redeem failed:", redeemError.message);
  }

  await maybeSaveAddress(name, address);

  const order = {
    id,
    invoiceNo,
    name,
    phone: user.phone,
    address,
    items: [...cart],
    total,
    payment: "COD",
    date: new Date().toLocaleString()
  };

  window.open(
    `https://wa.me/${WHATSAPP_NUMBER}?text=${message}`,
    "_blank"
  );

  cart = [];
  removeCoupon();
  saveCart();
  renderCart();
  closeCart();

  // clear input fields
  customerName.value = "";
  customerAddress.value = "";
  backToCartForm();

}

/***********************
    CHECKOUT: UPI half-payment step
************************/

let selectedPaymentOption = "half"; // "half" | "full"
let currentPayableTotal = 0;

function proceedToPayment() {
  const user = JSON.parse(localStorage.getItem("user"));

  if (!user) {
    alert("Please enter mobile number first");
    openLogin();
    return;
  }

  if (cart.length === 0) {
    alert("Cart empty");
    return;
  }

  const name = customerName.value.trim();
  const address = customerAddress.value.trim();

  if (!name || !address) {
    alert("Enter name and address");
    return;
  }

  const discount = appliedCoupon ? appliedCoupon.discount_amount : 0;
  const goodsTotal = Math.max(0, cartSubtotal() - discount);

  if (goodsTotal < getMinOrder()) {
    alert(`Minimum order is ₹${getMinOrder()}. Please add more items to your cart.`);
    return;
  }

  const deliveryCharge = calculateDeliveryCharge(goodsTotal);
  const total = goodsTotal + deliveryCharge;

  const upiId = (window.siteContent && window.siteContent.upi_id) || "";

  if (!upiId) {
    alert("Online payment isn't set up on this site yet — please contact the shop directly (WhatsApp) to place this order.");
    return;
  }

  currentPayableTotal = total;
  selectedPaymentOption = "half";

  document.getElementById("halfAmountLabel").innerText = "₹" + Math.ceil(total / 2);
  document.getElementById("fullAmountLabel").innerText = "₹" + total;
  document.getElementById("upiIdLabel").innerText = upiId;

  document.getElementById("chooseHalfBtn").classList.add("active");
  document.getElementById("chooseFullBtn").classList.remove("active");

  updatePaymentQr();

  document.getElementById("cartFormStep").classList.add("hidden");
  document.getElementById("minOrderNotice").classList.add("hidden");
  document.getElementById("proceedToPaymentBtn").classList.add("hidden");
  document.getElementById("paymentStep").classList.remove("hidden");
  document.getElementById("confirmOrderBtn").classList.remove("hidden");
}

function choosePaymentOption(option) {
  selectedPaymentOption = option;

  document.getElementById("chooseHalfBtn").classList.toggle("active", option === "half");
  document.getElementById("chooseFullBtn").classList.toggle("active", option === "full");

  document.getElementById("paymentChoiceNote").innerText =
    option === "full" ? "Nothing to pay on delivery." : "Pay the remaining amount on delivery.";

  updatePaymentQr();
}

function updatePaymentQr() {
  const upiId = (window.siteContent && window.siteContent.upi_id) || "";
  const amount = selectedPaymentOption === "full"
    ? currentPayableTotal
    : Math.ceil(currentPayableTotal / 2);

  const upiLink = `upi://pay?pa=${encodeURIComponent(upiId)}&pn=${encodeURIComponent("AOne Bazaar")}&am=${amount}&cu=INR`;
  document.getElementById("upiQrImage").src =
    `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(upiLink)}`;
}

function backToCartForm() {
  document.getElementById("cartFormStep").classList.remove("hidden");
  document.getElementById("minOrderNotice").classList.remove("hidden");
  document.getElementById("proceedToPaymentBtn").classList.remove("hidden");
  document.getElementById("paymentStep").classList.add("hidden");
  document.getElementById("confirmOrderBtn").classList.add("hidden");
}


function generateInvoiceNumber() {

  let last = localStorage.getItem("lastInvoice") || "0";
  last = parseInt(last) + 1;

  localStorage.setItem("lastInvoice", last);

  return "INV-" + String(last).padStart(4, "0");
}


/***********************
    SECRET ADMIN TAP
************************/

function secretTap() {
  tapCount++;

  if (tapCount >= 5) {
    tapCount = 0;
    location.href = "admin.html";
  }

  setTimeout(() => tapCount = 0, 2000);
}

let currentImages = [];
let currentIndex = 0;

let currentProduct = null;
let selectedStars = 0;
let myWishlistIds = new Set();

const detailImage = document.getElementById("detailImage");
const detailName = document.getElementById("detailName");
const detailPrice = document.getElementById("detailPrice");
const thumbs = document.getElementById("thumbs");

function updateMainImage() {
  detailImage.src = currentImages[currentIndex];
}


function nextImage() {
  currentIndex =
    (currentIndex + 1) % currentImages.length;
  updateMainImage();
}

function prevImage() {
  currentIndex =
    (currentIndex - 1 + currentImages.length)
    % currentImages.length;
  updateMainImage();
}

function setImage(i) {
  currentIndex = i;
  updateMainImage();
}

function enableMagnifier() {
  const img = document.getElementById("detailImage");
  const lens = document.getElementById("lens");

  if (!img || !lens) return;

  lens.style.backgroundImage = `url('${img.src}')`;
  lens.style.backgroundSize =
    (img.width * 2) + "px " + (img.height * 2) + "px";

  img.addEventListener("mousemove", moveLens);
  lens.addEventListener("mousemove", moveLens);

  img.addEventListener("mouseenter", () => lens.style.display = "block");
  img.addEventListener("mouseleave", () => lens.style.display = "none");

  function moveLens(e) {
    const rect = img.getBoundingClientRect();

    let x = e.clientX - rect.left;
    let y = e.clientY - rect.top;

    let lensHalf = lens.offsetWidth / 2;

    let posX = x - lensHalf;
    let posY = y - lensHalf;

    lens.style.left = posX + "px";
    lens.style.top = posY + "px";

    lens.style.backgroundPosition =
      "-" + (x * 2 - lensHalf) + "px -" +
      (y * 2 - lensHalf) + "px";
  }

  /* fullscreen open */
  img.addEventListener("click", function () {
    document.getElementById("fullImage").src = img.src;
    document
      .getElementById("fullScreenViewer")
      .classList.remove("hidden");
  });
}

function closeFullScreen() {
  document
    .getElementById("fullScreenViewer")
    .classList.add("hidden");
}

async function loadProducts(store) {

  const { data: rows, error } = await supabase
    .from("products")
    .select("*")
    .eq("store", store)
    // Newest first — a freshly added product should appear at the
    // top when browsing "All Categories". (Within a single category
    // by itself this is also newest-first, which is what "Atta"
    // alone should show too.)
    .order("created_at", { ascending: false });

  if (error) {
    console.error(error);
    data[store].categories = {};
    return;
  }

  data[store].categories = {};

  (rows || []).forEach(p => {
    if (!data[store].categories[p.category])
      data[store].categories[p.category] = [];

    data[store].categories[p.category].push(p);
  });
}

function openLogin() {
  document.getElementById("loginModal").classList.remove("hidden");
}

function closeLogin() {
  document.getElementById("loginModal").classList.add("hidden");
}

async function loginWithPhone() {
  const phone = document.getElementById("phoneNumber").value.trim();

  if (!/^[6-9]\d{9}$/.test(phone)) {
    alert("Enter valid 10 digit Indian number");
    return;
  }

  // No OTP — the phone number is trusted as typed. We still create a
  // real (anonymous) Supabase session behind the scenes so orders,
  // wishlist, and reviews can be tied to this customer securely on
  // this device. Logging out keeps that same identity so a return
  // visit with the same number sees the same order history.
  if (!currentSupabaseUser) {
    const { data, error } = await supabase.auth.signInAnonymously();
    if (error) {
      alert("Could not log in: " + error.message);
      return;
    }
    currentSupabaseUser = data.user;
  }

  const { error: profileError } = await supabase
    .from("profiles")
    .update({ phone })
    .eq("id", currentSupabaseUser.id);

  if (profileError) console.warn("Could not save phone to profile:", profileError.message);

  const user = { phone };
  localStorage.setItem("user", JSON.stringify(user));

  document.getElementById("userGreeting").innerText = "Hi " + phone;
  document.querySelector(".logout-btn").style.display = "inline-block";

  closeLogin();
}

window.onload = function () {

  const user = JSON.parse(localStorage.getItem("user"));

  if (user) {
    document.getElementById("userGreeting").innerText =
      "Hi " + user.phone;
  } else {
    openLogin(); // force mobile entry
  }

  const logoutBtn = document.querySelector(".logout-btn");

  if (user) {
    logoutBtn.style.display = "inline-block";
  } else {
    logoutBtn.style.display = "none";
  }

  const logo = document.querySelector(".h-left");

  if (logo) {
    logo.addEventListener("click", goHome);
  }

  saveCart(); // cart count refresh
  updateWhatsAppCTA();
  loadProductPage(); // no-ops unless this is product.html
  loadFeaturedSections(); // no-ops unless #featuredSections exists on this page

  // Coming back from a product page, or from the mega-menu? Jump
  // straight to that store (and category, if given).
  const backParams = new URLSearchParams(location.search);
  const storeParam = backParams.get("store");
  const categoryParam = backParams.get("category");
  const pageParam = parseInt(backParams.get("page"), 10) || 1;
  if (storeParam && typeof openStore === "function" && document.getElementById("storeSection")) {
    openStore(storeParam, categoryParam, pageParam);
  }
};

/***********************
    PRODUCT PAGE (product.html?id=...)
    Gives every product its own shareable URL instead of only
    living inside a modal — better for SEO and for sending a
    direct link to a customer.
************************/

async function loadProductPage() {
  const contentEl = document.getElementById("productPageContent");
  if (!contentEl) return; // not on product.html, nothing to do

  const notFoundEl = document.getElementById("productNotFound");
  const params = new URLSearchParams(location.search);
  const id = params.get("id");

  if (!id) {
    contentEl.classList.add("hidden");
    notFoundEl.classList.remove("hidden");
    return;
  }

  const { data: p, error } = await supabase
    .from("products")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error || !p) {
    contentEl.classList.add("hidden");
    notFoundEl.classList.remove("hidden");
    return;
  }

  currentProduct = p;
  currentStore = p.store;

  document.title = p.name + " — AOne Bazaar";
  const metaDesc = document.querySelector('meta[name="description"]');
  if (metaDesc) {
    metaDesc.setAttribute("content", `${p.name} — ₹${p.price} at AOne Bazaar, Lahideeh-Azamgarh. Order online, pay on delivery.`);
  }

  const backLink = document.getElementById("backToStoreLink");
  if (backLink) backLink.href = `index.html?store=${p.store}`;

  document.getElementById("detailName").innerHTML = displayProductName(p);
  renderVariantSelector(p);

  const descEl = document.getElementById("detailDescription");
  if (descEl) {
    if (p.description) {
      const renderMd = window.renderMarkdownLite || (t => `<p>${escapeHtmlForDisplay(t)}</p>`);
      descEl.innerHTML = `
        <button type="button" class="accordion-header" onclick="toggleAccordion(this)">
          <span>Description</span>
          <span class="accordion-icon">+</span>
        </button>
        <div class="accordion-content">
          <div class="accordion-content-inner">
            <div class="description-en">${renderMd(p.description)}</div>
            ${p.description_hi ? `<div class="description-hi">${renderMd(p.description_hi)}</div>` : ""}
          </div>
        </div>
      `;
      descEl.classList.remove("hidden");
    } else {
      descEl.classList.add("hidden");
    }
  }

  const specsEl = document.getElementById("detailSpecs");
  if (specsEl) {
    if (p.specs && p.specs.length > 0) {
      specsEl.innerHTML = `
        <button type="button" class="accordion-header" onclick="toggleAccordion(this)">
          <span>Specifications</span>
          <span class="accordion-icon">+</span>
        </button>
        <div class="accordion-content">
          <div class="accordion-content-inner">
            <table class="specs-table">
              ${p.specs.map(s => `
                <tr>
                  <td class="specs-label">${escapeHtmlForDisplay(s.label)}</td>
                  <td class="specs-value">${escapeHtmlForDisplay(s.value)}</td>
                </tr>
              `).join("")}
            </table>
          </div>
        </div>
      `;
      specsEl.classList.remove("hidden");
    } else {
      specsEl.classList.add("hidden");
    }
  }

  const addBtn = document.getElementById("addToCartBtn");
  if (p.in_stock === false) {
    addBtn.disabled = true;
    addBtn.innerHTML = "Out of Stock";
    addBtn.classList.add("out-of-stock-btn");
    document.getElementById("variantSelector").classList.add("hidden");
  } else {
    addBtn.disabled = false;
    addBtn.innerHTML = '<i class="fa-solid fa-basket-shopping"></i> Add to Cart';
    addBtn.classList.remove("out-of-stock-btn");
  }

  currentImages = (p.images && p.images.length) ? p.images : (p.img ? [p.img] : []);
  currentIndex = 0;
  updateMainImage();

  const thumbsEl = document.getElementById("thumbs");
  thumbsEl.innerHTML = "";
  currentImages.forEach((img, i) => {
    thumbsEl.innerHTML += `
      <img src="${img}"
        style="width:60px;height:60px;object-fit:contain;background:var(--surface-sunken);border-radius:6px;margin:4px;cursor:pointer"
        onclick="setImage(${i})">
    `;
  });

  setTimeout(enableMagnifier, 200);
  resetStarInput();
  loadReviews(p.id);
  loadRelatedProducts(p);
  trackRecentlyViewed(p.id);
  loadRecentlyViewed(p.id);

  // Reflect saved-wishlist state for just this one product
  if (currentSupabaseUser) {
    const { data: existing } = await supabase
      .from("wishlists")
      .select("product_id")
      .eq("customer_id", currentSupabaseUser.id)
      .eq("product_id", p.id)
      .maybeSingle();

    if (existing) myWishlistIds.add(p.id);
  }
  updateWishlistHeart(p.id);
}

/** Shows a horizontal-scrolling row of other products from the same
 *  category (falling back to the same store) — skips the product
 *  being viewed and anything out of stock. */
const RECENTLY_VIEWED_KEY = "aone_recently_viewed";
const RECENTLY_VIEWED_MAX = 10;

/** Records this product id in localStorage (most-recent-first,
 *  deduped, capped) — purely on this device, no account needed. */
function trackRecentlyViewed(id) {
  if (!id) return;
  let list = [];
  try {
    list = JSON.parse(localStorage.getItem(RECENTLY_VIEWED_KEY)) || [];
  } catch (e) {
    list = [];
  }
  list = list.filter(existingId => existingId !== id);
  list.unshift(id);
  list = list.slice(0, RECENTLY_VIEWED_MAX);
  localStorage.setItem(RECENTLY_VIEWED_KEY, JSON.stringify(list));
}

/** Shows the last few OTHER products the shopper looked at (never
 *  the one they're on right now) as a horizontal row, same card
 *  style as Related Products. */
async function loadRecentlyViewed(currentId) {
  const section = document.getElementById("recentlyViewedSection");
  const row = document.getElementById("recentlyViewedRow");
  if (!section || !row) return;

  let ids = [];
  try {
    ids = JSON.parse(localStorage.getItem(RECENTLY_VIEWED_KEY)) || [];
  } catch (e) {
    ids = [];
  }

  ids = ids.filter(id => id !== currentId).slice(0, 10);

  if (ids.length === 0) {
    section.classList.add("hidden");
    return;
  }

  const { data: rows, error } = await supabase
    .from("products")
    .select("*")
    .in("id", ids)
    .eq("in_stock", true);

  if (error || !rows || rows.length === 0) {
    section.classList.add("hidden");
    return;
  }

  // Keep "most recently viewed first" order — .in() doesn't
  // guarantee it comes back in the order the ids were given.
  const byId = {};
  rows.forEach(p => { byId[p.id] = p; });
  const ordered = ids.map(pid => byId[pid]).filter(Boolean);

  row.innerHTML = ordered.map(p => featuredProductCardHtml(p)).join("");
  section.classList.remove("hidden");
  setupAutoScroll("recentlyViewedRow");
}

async function loadRelatedProducts(p) {
  const section = document.getElementById("relatedProductsSection");
  const row = document.getElementById("relatedProductsRow");
  if (!section || !row) return;

  let { data: rows, error } = await supabase
    .from("products")
    .select("*")
    .eq("store", p.store)
    .eq("category", p.category)
    .eq("in_stock", true)
    .neq("id", p.id)
    .limit(12);

  // Same category is usually empty only for a very small catalog —
  // fall back to "anything else in this store" so the section still
  // has something worth showing.
  if ((!rows || rows.length === 0) && !error) {
    const fallback = await supabase
      .from("products")
      .select("*")
      .eq("store", p.store)
      .eq("in_stock", true)
      .neq("id", p.id)
      .limit(12);
    rows = fallback.data;
  }

  if (error || !rows || rows.length === 0) {
    section.classList.add("hidden");
    return;
  }

  row.innerHTML = rows.map(item => featuredProductCardHtml(item)).join("");
  section.classList.remove("hidden");
  setupAutoScroll("relatedProductsRow");
}

/***********************
    AUTO-SCROLL for horizontal product rows
    Slowly advances the row on its own; pauses while the shopper is
    actually browsing it (hovering with a mouse, or mid-swipe on
    touch), and loops back to the start once it reaches the end.
************************/

const autoScrollTimers = {};

function setupAutoScroll(containerId, pixelsPerSecond = 180) {
  const container = document.getElementById(containerId);
  if (!container) return;

  if (autoScrollTimers[containerId]) {
    cancelAnimationFrame(autoScrollTimers[containerId]);
  }

  if (!container.dataset.autoScrollBound) {
    container.addEventListener("mouseenter", () => { container._autoScrollPaused = true; });
    container.addEventListener("mouseleave", () => { container._autoScrollPaused = false; });
    container.addEventListener("touchstart", () => { container._autoScrollPaused = true; }, { passive: true });
    container.addEventListener("touchend", () => {
      setTimeout(() => { container._autoScrollPaused = false; }, 2500);
    }, { passive: true });
    container.dataset.autoScrollBound = "1";
  }

  let lastTimestamp = null;

  function step(timestamp) {
    if (lastTimestamp === null) lastTimestamp = timestamp;
    const deltaSeconds = (timestamp - lastTimestamp) / 1000;
    lastTimestamp = timestamp;

    if (!container._autoScrollPaused && !document.hidden) {
      const maxScroll = container.scrollWidth - container.clientWidth;

      if (maxScroll > 0) {
        let next = container.scrollLeft + pixelsPerSecond * deltaSeconds;
        if (next >= maxScroll) next = 0; // loop back to the start
        container.scrollLeft = next;
      }
    }

    autoScrollTimers[containerId] = requestAnimationFrame(step);
  }

  autoScrollTimers[containerId] = requestAnimationFrame(step);
}

let selectedVariant = null;

/** Renders the size/pack picker on product.html, if this product has
 *  any variants — and keeps detailPrice in sync with whichever one
 *  is selected (defaults to the first). */
function renderVariantSelector(p) {
  const wrap = document.getElementById("variantSelector");
  const priceEl = document.getElementById("detailPrice");

  if (!p.variants || p.variants.length === 0) {
    selectedVariant = null;
    wrap.classList.add("hidden");
    wrap.innerHTML = "";
    setDetailPrice(p.price, p.mrp);
    return;
  }

  selectedVariant = p.variants[0];
  wrap.classList.remove("hidden");

  wrap.innerHTML = p.variants.map((v, i) => `
    <button type="button" class="${i === 0 ? 'active' : ''}" onclick="selectVariant(${i})">
      ${v.label} — ₹${v.price}
    </button>
  `).join("");

  setDetailPrice(selectedVariant.price, selectedVariant.mrp || p.mrp);
}

function setDetailPrice(price, mrp) {
  const priceEl = document.getElementById("detailPrice");
  if (mrp && mrp > price) {
    const pct = Math.round(((mrp - price) / mrp) * 100);
    priceEl.innerHTML = `₹${price} <span class="mrp-strike">₹${mrp}</span> <span class="discount-badge" style="position:static;display:inline-block;">-${pct}%</span>`;
  } else {
    priceEl.innerText = "₹" + price;
  }
}

function selectVariant(index) {
  if (!currentProduct || !currentProduct.variants) return;

  selectedVariant = currentProduct.variants[index];

  document.querySelectorAll("#variantSelector button").forEach((btn, i) => {
    btn.classList.toggle("active", i === index);
  });

  setDetailPrice(selectedVariant.price, selectedVariant.mrp || currentProduct.mrp);
}

function addCurrentProductToCart() {
  if (!currentProduct || currentProduct.in_stock === false) return;
  addToCart(currentProduct, selectedVariant);
  alert("Added to cart");
}

function logoutUser() {
  // Intentionally NOT calling supabase.auth.signOut() here — since login
  // has no OTP verification, we keep the underlying (anonymous) Supabase
  // identity alive on this device. That way, typing the same phone
  // number back in still shows the same order history / wishlist.
  localStorage.removeItem("user");
  location.reload();
}

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

async function openMyOrders() {

  const user = JSON.parse(localStorage.getItem("user"));

  if (!user) {
    alert("Login first");
    openLogin();
    return;
  }

  const box = document.getElementById("myOrdersList");
  box.innerHTML = skeletonRowCardsHtml(3);
  document.getElementById("myOrdersModal").classList.remove("hidden");

  const { data: rows, error } = await supabase
    .from("orders")
    .select("*")
    .eq("customer_phone", user.phone)
    .order("created_at", { ascending: false });

  if (error) {
    box.innerHTML = "<p style='text-align:center'>Could not load orders</p>";
    console.error(error);
    return;
  }

  const myOrders = (rows || []).map(mapOrderRow);
  myOrdersCache = myOrders; // so the "Order Again" button can look the order back up

  box.innerHTML = "";

  if (myOrders.length === 0) {
    box.innerHTML = emptyStateHtml("fa-receipt", "No previous orders", "Your order history will show up here.");
  } else {

    myOrders.forEach(o => {

      let itemsHTML = "";

      o.items.forEach(p => {
        itemsHTML += `
      <div class="order-item">
        ${p.name} x${p.qty} — ₹${p.price * p.qty}
      </div>
    `;
      });

      box.innerHTML += `
    <div class="order-card">

      <div class="order-top">
        <b>${o.id}</b>
        <span>₹${o.total}</span>
      </div>

      ${orderTrackerHtml(o.status)}

      <div class="order-items">
        ${itemsHTML}
      </div>

      <div class="order-date">
        ${o.date}
      </div>

      <button class="reorder-btn" onclick="reorderItems('${o.id}')">
        <i class="fa-solid fa-rotate-right"></i> Order Again
      </button>

    </div>
  `;
    });
  }
}

let myOrdersCache = [];

/** Re-adds everything from a past order to the current cart — using
 *  today's price and stock, not the price it was bought at, since
 *  both can have changed since then. Anything that's been removed
 *  or gone out of stock is skipped with a note rather than failing
 *  the whole thing. */
async function reorderItems(orderId) {
  const order = myOrdersCache.find(o => o.id === orderId);
  if (!order) return;

  const ids = order.items.map(i => i.id).filter(Boolean);
  if (ids.length === 0) return;

  const { data: liveProducts, error } = await supabase
    .from("products")
    .select("*")
    .in("id", ids);

  if (error) {
    alert("Could not reorder right now: " + error.message);
    return;
  }

  let addedCount = 0;
  let skippedCount = 0;

  order.items.forEach(item => {
    const product = (liveProducts || []).find(p => p.id === item.id);
    if (!product || product.in_stock === false) {
      skippedCount++;
      return;
    }
    for (let i = 0; i < item.qty; i++) addToCart(product);
    addedCount++;
  });

  closeMyOrders();

  if (addedCount === 0) {
    alert("Sorry, none of these items are available right now.");
  } else if (skippedCount > 0) {
    alert(`Added ${addedCount} item(s) to your cart. ${skippedCount} item(s) are no longer available.`);
  } else {
    alert(`Added ${addedCount} item(s) to your cart!`);
  }

  openCart();
}

/** A small "Order Placed → Processing → Delivered" step tracker for
 *  the customer's own order history — cancelled orders get a plain
 *  badge instead, since the step tracker doesn't make sense there. */
function orderTrackerHtml(status) {
  if (status === "CANCELLED") {
    return `<div class="order-cancelled-badge"><i class="fa-solid fa-circle-xmark"></i> Order Cancelled</div>`;
  }

  const steps = [
    { key: "NEW", label: "Placed", icon: "fa-clipboard-check" },
    { key: "PROCESSING", label: "Processing", icon: "fa-box" },
    { key: "OUT_FOR_DELIVERY", label: "Out for Delivery", icon: "fa-truck" },
    { key: "DELIVERED", label: "Delivered", icon: "fa-house" }
  ];

  const activeIndex = Math.max(0, steps.findIndex(s => s.key === status));

  return `
    <div class="order-tracker">
      ${steps.map((s, i) => `
        ${i > 0 ? `<div class="tracker-line ${i <= activeIndex ? "completed" : ""}"></div>` : ""}
        <div class="tracker-step ${i < activeIndex ? "completed" : ""} ${i === activeIndex ? "current" : ""}">
          <div class="tracker-dot"><i class="fa-solid ${i < activeIndex ? "fa-check" : s.icon}"></i></div>
          <span>${s.label}</span>
        </div>
      `).join("")}
    </div>
  `;
}

function closeMyOrders() {
  document.getElementById("myOrdersModal")
    .classList.add("hidden");
}

function updateWhatsAppCTA() {

  const btn = document.getElementById("whatsappFloat");

  const user = JSON.parse(localStorage.getItem("user"));
  const cart = JSON.parse(localStorage.getItem("cart")) || [];

  let message = "🛒 *New Order Inquiry*";

  if (user) {
    message += `%0APhone: ${user.phone}`;
  }

  if (cart.length > 0) {
    message += `%0A%0A*Cart Items:*`;

    let total = 0;

    cart.forEach(p => {
      let price = p.price * p.qty;
      total += price;

      message += `%0A• ${p.name} x${p.qty} = ₹${price}`;
    });

    message += `%0A%0ATotal: ₹${total}`;
  } else {
    message += `%0AHello, I want to place an order`;
  }

  const url = `https://wa.me/918009555567?text=${message}`;

  btn.href = url;
}

window.addEventListener("storage", updateWhatsAppCTA);

function updateCartBar() {
  const bar = document.getElementById("cartBar");
  const summary = document.getElementById("cartSummary");

  if (!bar || !summary) return; // this page doesn't have the floating cart bar

  if (cart.length > 0) {
    let total = cart.reduce((a, b) => a + (b.price * b.qty), 0);
    summary.innerText = cart.length + " items • ₹" + total;
    bar.classList.remove("hidden");
  } else {
    bar.classList.add("hidden");
  }
}
saveCart();
updateCartBar();

function goHome() {

  // सभी store sections hide
  document.querySelectorAll(".store").forEach(s => {
    s.classList.add("hidden");
  });

  // hero show
  const hero = document.querySelector(".hero");
  if (hero) {
    hero.style.display = "flex";
  }
  // 🟢 scroll top (important UX)
  window.scrollTo({
    top: 0,
    behavior: "smooth"
  });

}

/***********************
    WISHLIST
************************/

function requireLogin() {
  const user = JSON.parse(localStorage.getItem("user"));
  if (!user || !currentSupabaseUser) {
    alert("Please login first");
    openLogin();
    return null;
  }
  return currentSupabaseUser;
}

async function toggleWishlistFromModal() {
  if (!currentProduct) return;
  await toggleWishlist(currentProduct.id);
  updateWishlistHeart(currentProduct.id);
}

async function toggleWishlist(productId) {
  const fbUser = requireLogin();
  if (!fbUser) return;

  const isSaved = myWishlistIds.has(productId);

  if (isSaved) {
    const { error } = await supabase
      .from("wishlists")
      .delete()
      .eq("customer_id", fbUser.id)
      .eq("product_id", productId);

    if (error) { alert("Could not update wishlist: " + error.message); return; }
    myWishlistIds.delete(productId);
  } else {
    const { error } = await supabase
      .from("wishlists")
      .insert({ customer_id: fbUser.id, product_id: productId });

    if (error) { alert("Could not update wishlist: " + error.message); return; }
    myWishlistIds.add(productId);
  }
}

function updateWishlistHeart(productId) {
  const btn = document.getElementById("wishlistHeartBtn");
  if (!btn) return;
  const saved = myWishlistIds.has(productId);
  btn.textContent = saved ? "❤️" : "🤍";
  btn.classList.toggle("active", saved);
}

async function openWishlist() {
  const fbUser = requireLogin();
  if (!fbUser) return;

  const box = document.getElementById("wishlistList");
  box.innerHTML = skeletonRowCardsHtml(3);
  document.getElementById("wishlistModal").classList.remove("hidden");

  const { data: rows, error } = await supabase
    .from("wishlists")
    .select("product_id, products(id, name, name_hi, price, images, store, category)")
    .eq("customer_id", fbUser.id)
    .order("created_at", { ascending: false });

  if (error) {
    box.innerHTML = "Could not load wishlist";
    console.error(error);
    return;
  }

  myWishlistIds = new Set((rows || []).map(r => r.product_id));

  if (!rows || rows.length === 0) {
    box.innerHTML = emptyStateHtml("fa-heart", "Your wishlist is empty", "Tap the heart on any product to save it here.");
    return;
  }

  box.innerHTML = rows.map(r => {
    const p = r.products;
    if (!p) return "";
    const img = p.images && p.images[0] ? p.images[0] : "";
    return `
      <div class="wishlist-item">
        <img src="${img}" alt="${p.name}">
        <div class="info">
          <b>${displayProductName(p)}</b>
          <span>₹${p.price}</span>
        </div>
        <button class="btn btn-primary btn-sm" onclick='addToCart(${JSON.stringify(p)})'>Add</button>
        <button class="btn btn-ghost btn-sm" onclick="toggleWishlist('${p.id}').then(openWishlist)">Remove</button>
      </div>
    `;
  }).join("");
}

function closeWishlist() {
  document.getElementById("wishlistModal").classList.add("hidden");
}

/***********************
    REVIEWS
************************/

function resetStarInput() {
  selectedStars = 0;
  document.querySelectorAll("#starInput span").forEach(s => s.classList.remove("filled"));
  document.getElementById("reviewComment").value = "";
}

document.addEventListener("click", e => {
  const star = e.target.closest("#starInput span");
  if (!star) return;
  selectedStars = Number(star.dataset.star);
  document.querySelectorAll("#starInput span").forEach(s => {
    s.classList.toggle("filled", Number(s.dataset.star) <= selectedStars);
  });
});

async function loadReviews(productId) {
  const avgEl = document.getElementById("avgRatingDisplay");
  const listEl = document.getElementById("reviewsList");
  listEl.innerHTML = skeletonRowCardsHtml(2);

  const { data: rows, error } = await supabase
    .from("reviews")
    .select("*")
    .eq("product_id", productId)
    .order("created_at", { ascending: false });

  if (error) {
    listEl.innerHTML = "";
    avgEl.textContent = "Could not load reviews";
    console.error(error);
    return;
  }

  if (!rows || rows.length === 0) {
    avgEl.textContent = "No ratings yet — be the first to review";
    listEl.innerHTML = "";
    return;
  }

  const avg = (rows.reduce((s, r) => s + r.rating, 0) / rows.length).toFixed(1);
  avgEl.innerHTML = `⭐ ${avg} <span style="color:var(--ink-faint)">(${rows.length} review${rows.length > 1 ? "s" : ""})</span>`;

  listEl.innerHTML = rows.map(r => `
    <div class="review-item">
      <span class="stars">${"★".repeat(r.rating)}${"☆".repeat(5 - r.rating)}</span>
      <span class="reviewer">${r.customer_name}</span>
      ${r.comment ? `<p>${r.comment}</p>` : ""}
    </div>
  `).join("");
}

async function submitReview() {
  if (!currentProduct) return;

  const fbUser = requireLogin();
  if (!fbUser) return;

  if (selectedStars === 0) {
    alert("Pick a star rating first");
    return;
  }

  const user = JSON.parse(localStorage.getItem("user")) || {};
  const comment = document.getElementById("reviewComment").value.trim();

  const { error } = await supabase.from("reviews").upsert({
    product_id: currentProduct.id,
    customer_id: fbUser.id,
    customer_name: "Customer " + (user.phone ? user.phone.slice(-4) : ""),
    rating: selectedStars,
    comment: comment || null
  }, { onConflict: "product_id,customer_id" });

  if (error) {
    alert("Could not submit review: " + error.message);
    return;
  }

  alert("Thanks for your review!");
  resetStarInput();
  loadReviews(currentProduct.id);
}

/***********************
    AUTH STATE
    Keeps currentSupabaseUser in sync so the rest of the app can
    check "who's logged in" without an await on every click.
************************/

supabase.auth.onAuthStateChange((_event, session) => {
  currentSupabaseUser = session ? session.user : null;
});

// Restore a session already in progress (e.g. page refresh) before
// window.onload runs its checks.
supabase.auth.getSession().then(({ data }) => {
  currentSupabaseUser = data.session ? data.session.user : null;
});

/***********************
    MEGA MENU ("All Categories")
    Groups every category (across all 3 stores) the way the admin
    has organized them under Categories → Group, and lets a shopper
    jump straight into a store already filtered to that category.
************************/

let megaMenuLoaded = false;

async function toggleMegaMenu() {
  const menu = document.getElementById("megaMenu");
  if (!menu) return;

  const opening = menu.classList.contains("hidden");
  menu.classList.toggle("hidden");

  if (opening && !megaMenuLoaded) {
    await loadMegaMenu();
    megaMenuLoaded = true;
  }
}

async function loadMegaMenu() {
  const menu = document.getElementById("megaMenu");
  if (!menu) return;

  const { data: rows, error } = await supabase
    .from("categories")
    .select("store, name, name_hi")
    .order("name");

  if (error || !rows || rows.length === 0) {
    menu.innerHTML = `<div class="mega-menu-empty">No categories yet</div>`;
    console.error(error);
    return;
  }

  const STORE_LABELS = {
    supermarket: "Supermarket",
    grocery: "Grocery",
    cafe: "Cafe"
  };

  // Grouped by store — automatic, nothing for the admin to fill in —
  // and alphabetical within each group.
  const groups = {};
  rows.forEach(r => {
    const label = STORE_LABELS[r.store] || r.store;
    if (!groups[label]) groups[label] = [];
    groups[label].push(r);
  });

  menu.innerHTML = Object.entries(groups).map(([group, items]) => `
    <div class="mega-menu-group">
      <h4>${group}</h4>
      <ul>
        ${items.map(c => `
          <li><a href="index.html?store=${c.store}&category=${encodeURIComponent(c.name)}">${c.name}${c.name_hi ? ` <span class="mega-menu-hi">(${c.name_hi})</span>` : ""}</a></li>
        `).join("")}
      </ul>
    </div>
  `).join("");
}

// Close the mega-menu when clicking outside it
document.addEventListener("click", e => {
  const wrap = document.querySelector(".mega-menu-wrap");
  const menu = document.getElementById("megaMenu");
  if (!wrap || !menu || menu.classList.contains("hidden")) return;
  if (!wrap.contains(e.target)) menu.classList.add("hidden");
});