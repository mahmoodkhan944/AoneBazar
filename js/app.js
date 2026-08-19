/***********************
    GLOBAL
************************/
/***********************
    DOM ELEMENTS
************************/
const heroSection = document.getElementById("heroSection");
const storeSection = document.getElementById("storeSection");
const storeTitle = document.getElementById("storeTitle");
const categoryBar = document.getElementById("categoryBar");
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

async function openStore(key, jumpToCategory) {

  currentStore = key;

  await loadProducts(key);
  // load this store's products from Supabase

  const store = data[key];
  if (!store) return;

  heroSection.style.display = "none";
  storeSection.classList.remove("hidden");

  window.scrollTo({
  top: 0,
  behavior: "smooth"
});

  storeTitle.innerText = store.title;

  categoryBar.innerHTML = "";

  const storeSearch = document.getElementById("storeSearch");
  if (storeSearch) storeSearch.value = "";

  const cats = Object.keys(store.categories);

  if (cats.length === 0) {
    productGrid.innerHTML = "<p>No products yet</p>";
    return;
  }

  cats.forEach(cat => {
    const btn = document.createElement("button");
    btn.innerText = cat;
    btn.onclick = () => {
      categoryBar.querySelectorAll("button").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      currentCategory = cat;
      if (storeSearch) storeSearch.value = "";
      showProducts(key, cat);
    };
    categoryBar.appendChild(btn);
  });

  const startCat = (jumpToCategory && cats.includes(jumpToCategory)) ? jumpToCategory : cats[0];

  categoryBar.querySelectorAll("button").forEach(b => {
    b.classList.toggle("active", b.innerText === startCat);
  });
  currentCategory = startCat;
  showProducts(key, startCat);
}

/** Search box on the store page: filters the active category by name. */
function searchStoreProducts() {
  const q = (document.getElementById("storeSearch")?.value || "").trim().toLowerCase();

  if (!q) {
    showProducts(currentStore, currentCategory);
    return;
  }

  // Search across every category in the current store, not just the active one.
  const allItems = Object.values(data[currentStore].categories).flat();
  const matches = allItems.filter(p => p.name.toLowerCase().includes(q));

  categoryBar.querySelectorAll("button").forEach(b => b.classList.remove("active"));
  renderProductGrid(matches, `No products match "${q}"`);
}

function showProducts(store, cat) {
  const items = data[store].categories[cat] || [];
  renderProductGrid(items, "No products in this category");
}

function renderProductGrid(items, emptyMessage) {
  productGrid.innerHTML = "";

  if (items.length === 0) {
    productGrid.innerHTML = `<p>${emptyMessage}</p>`;
    return;
  }

  items.forEach(p => {
    const hasVariants = p.variants && p.variants.length > 0;
    const outOfStock = p.in_stock === false;

    const basePrice = hasVariants ? Math.min(...p.variants.map(v => v.price)) : p.price;
    const priceLabel = hasVariants ? `From ₹${basePrice}` : `₹${p.price}`;

    const hasDiscount = p.mrp && p.mrp > basePrice;
    const discountPct = hasDiscount ? Math.round(((p.mrp - basePrice) / p.mrp) * 100) : 0;

    const priceHtml = hasDiscount
      ? `<p>${priceLabel} <span class="mrp-strike">₹${p.mrp}</span></p>`
      : `<p>${priceLabel}</p>`;

    const variantSelect = hasVariants ? variantDropdownHtml(p, outOfStock) : "";

    const actionHtml = outOfStock
      ? `<button class="out-of-stock-btn" disabled>Out of Stock</button>`
      : (hasVariants
          ? `<button onclick='addFromCardSelect(this, ${JSON.stringify(p)})'>Add to Cart</button>`
          : `<button onclick='addToCart(${JSON.stringify(p)})'>Add to Cart</button>`);

    productGrid.innerHTML += `
      <div class="product${outOfStock ? " product-out-of-stock" : ""}">
        ${hasDiscount ? `<span class="discount-badge">-${discountPct}%</span>` : ""}
        <a href="product.html?id=${p.id}" style="text-decoration:none;color:inherit;">
          <img src="${p.images ? p.images[0] : p.img}">
          <h4>${p.name}</h4>
          ${priceHtml}
        </a>
        ${variantSelect}
        <a class="btn btn-outline btn-sm" href="product.html?id=${p.id}">
          View Details
        </a>
        ${actionHtml}
      </div>`;
  });
}

/** Compact size/pack dropdown shown on a product card (grid or
 *  featured row) — cheaper on space than a row of chip buttons. */
function variantDropdownHtml(p, disabled) {
  return `
    <select class="variant-select" ${disabled ? "disabled" : ""}>
      ${p.variants.map((v, i) => `<option value="${i}">${v.label} — ₹${v.price}</option>`).join("")}
    </select>
  `;
}

/** Reads the <select> right before the clicked "Add to Cart" button
 *  and adds whichever size/pack is currently chosen. */
function addFromCardSelect(button, product) {
  const select = button.parentElement.querySelector(".variant-select");
  const index = select ? Number(select.value) : 0;
  addToCart(product, product.variants[index]);
}

function closeStore() {
  storeSection.classList.add("hidden");
  heroSection.style.display = "flex";
}

/***********************
    FEATURED HOMEPAGE SECTIONS (admin-curated)
    Products with a `featured_section` set (e.g. "Best Deal",
    "Trending Products") show up here in their own named row on
    the homepage — separate from browsing a specific store.
************************/

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
  const basePrice = hasVariants ? Math.min(...p.variants.map(v => v.price)) : p.price;
  const priceLabel = hasVariants ? `From ₹${basePrice}` : `₹${p.price}`;
  const hasDiscount = p.mrp && p.mrp > basePrice;
  const discountPct = hasDiscount ? Math.round(((p.mrp - basePrice) / p.mrp) * 100) : 0;

  return `
    <div class="featured-card">
      ${hasDiscount ? `<span class="discount-badge">-${discountPct}%</span>` : ""}
      <a href="product.html?id=${p.id}" style="text-decoration:none;color:inherit;">
        <img src="${p.images && p.images[0] ? p.images[0] : p.img || ''}">
        <h4>${p.name}</h4>
        <p>${priceLabel}${hasDiscount ? ` <span class="mrp-strike">₹${p.mrp}</span>` : ""}</p>
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

  renderCart();
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
    container.innerHTML = `<p style="text-align:center;color:var(--ink-faint);padding:20px 0;">Your cart is empty</p>`;
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
  if (storeParam && typeof openStore === "function" && document.getElementById("storeSection")) {
    openStore(storeParam, categoryParam);
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

  document.getElementById("detailName").innerText = p.name;
  renderVariantSelector(p);

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
        style="width:60px;margin:4px;cursor:pointer"
        onclick="setImage(${i})">
    `;
  });

  setTimeout(enableMagnifier, 200);
  resetStarInput();
  loadReviews(p.id);

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

  setDetailPrice(selectedVariant.price, p.mrp);
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

  setDetailPrice(selectedVariant.price, currentProduct.mrp);
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
  box.innerHTML = "Loading…";
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

  box.innerHTML = "";

  if (myOrders.length === 0) {
    box.innerHTML = "<p style='text-align:center'>No previous orders</p>";
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

      <div class="order-items">
        ${itemsHTML}
      </div>

      <div class="order-date">
        ${o.date}
      </div>

    </div>
  `;
    });
  }
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
  box.innerHTML = "Loading…";
  document.getElementById("wishlistModal").classList.remove("hidden");

  const { data: rows, error } = await supabase
    .from("wishlists")
    .select("product_id, products(id, name, price, images, store, category)")
    .eq("customer_id", fbUser.id)
    .order("created_at", { ascending: false });

  if (error) {
    box.innerHTML = "Could not load wishlist";
    console.error(error);
    return;
  }

  myWishlistIds = new Set((rows || []).map(r => r.product_id));

  if (!rows || rows.length === 0) {
    box.innerHTML = "<p style='text-align:center'>Your wishlist is empty</p>";
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
          <b>${p.name}</b>
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
  listEl.innerHTML = "Loading reviews…";

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
    .select("store, name")
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
          <li><a href="index.html?store=${c.store}&category=${encodeURIComponent(c.name)}">${c.name}</a></li>
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