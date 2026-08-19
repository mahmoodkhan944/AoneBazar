
if (!window.__AONE_SUPABASE_READY__) {
  window.__AONE_SUPABASE_READY__ = true;

  window.toggleMobileNav = function () {
    const nav = document.getElementById("mainNav");
    if (nav) nav.classList.toggle("mobile-open");
  };

  document.addEventListener("click", e => {
    const nav = document.getElementById("mainNav");
    const toggleBtn = document.querySelector(".mobile-nav-toggle");
    if (!nav || !nav.classList.contains("mobile-open")) return;
    if (nav.contains(e.target) || (toggleBtn && toggleBtn.contains(e.target))) return;
    nav.classList.remove("mobile-open");
  });

  /***********************************************************
     PAGINATION (shared by every paginated list — admin tables
     and the storefront product grid). 12 items per page.
  ***********************************************************/

  window.PAGE_SIZE = 12;

  window.paginateArray = function (array, page, perPage) {
    const start = (page - 1) * (perPage || window.PAGE_SIZE);
    return array.slice(start, start + (perPage || window.PAGE_SIZE));
  };

  /** Renders Prev/1/2/…/Next controls into containerId. `callbackName`
   *  is the name of a global function to call with the chosen page
   *  number, e.g. renderPagination("productsPagination", 42, 3, 12, "goToProductsPage"). */
  window.renderPagination = function (containerId, totalItems, currentPage, perPage, callbackName) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const totalPages = Math.ceil(totalItems / (perPage || window.PAGE_SIZE));
    if (totalPages <= 1) {
      container.innerHTML = "";
      return;
    }

    let start = Math.max(1, currentPage - 2);
    let end = Math.min(totalPages, start + 4);
    start = Math.max(1, end - 4);

    let html = `<button onclick="${callbackName}(${currentPage - 1})" ${currentPage === 1 ? "disabled" : ""}>‹</button>`;

    if (start > 1) {
      html += `<button onclick="${callbackName}(1)">1</button>`;
      if (start > 2) html += `<span style="padding:0 4px;color:var(--ink-faint);">…</span>`;
    }

    for (let i = start; i <= end; i++) {
      html += `<button class="${i === currentPage ? "active" : ""}" onclick="${callbackName}(${i})">${i}</button>`;
    }

    if (end < totalPages) {
      if (end < totalPages - 1) html += `<span style="padding:0 4px;color:var(--ink-faint);">…</span>`;
      html += `<button onclick="${callbackName}(${totalPages})">${totalPages}</button>`;
    }

    html += `<button onclick="${callbackName}(${currentPage + 1})" ${currentPage === totalPages ? "disabled" : ""}>›</button>`;

    container.innerHTML = html;
  };

  /***********************************************************
     TOAST NOTIFICATIONS
  ***********************************************************/

  const ERROR_HINTS = [
    "could not", "failed", "invalid", "enter", "select", "fill in",
    "already", "expired", "minimum", "no user found", "not found",
    "not an admin", "please", "cart empty", "sorry"
  ];

  window.showToast = function (message, type) {
    if (!type) {
      const lower = String(message).toLowerCase();
      type = ERROR_HINTS.some(hint => lower.includes(hint)) ? "error" : "success";
    }

    let container = document.getElementById("toastContainer");
    if (!container) {
      container = document.createElement("div");
      container.id = "toastContainer";
      container.className = "toast-container";
      document.body.appendChild(container);
    }

    const toast = document.createElement("div");
    toast.className = "toast toast-" + type;
    toast.innerHTML =
      `<span class="toast-icon">${type === "error" ? "⚠" : "✓"}</span>` +
      `<span class="toast-message"></span>` +
      `<button class="toast-close" aria-label="Dismiss">×</button>`;
    toast.querySelector(".toast-message").textContent = message;

    const remove = () => {
      toast.classList.add("toast-hide");
      setTimeout(() => toast.remove(), 200);
    };
    toast.querySelector(".toast-close").onclick = remove;

    container.appendChild(toast);
    setTimeout(remove, 4000);
  };

  window.alert = window.showToast;

  (function () {
    const SUPABASE_URL = "https://qwqtialuqxnegqkzbtlo.supabase.co";
    const SUPABASE_ANON_KEY =
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF3cXRpYWx1cXhuZWdxa3pidGxvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzczODg5ODMsImV4cCI6MjA5Mjk2NDk4M30.pMzfu6HeGtvJHygY5ZoI77p_aD1kbYFHUtHCdLUgz6o";

    if (!window.supabase || typeof window.supabase.createClient !== "function") {
      console.error(
        "Supabase library not loaded — check that the @supabase/supabase-js " +
        "<script> tag in this page loaded before js/supabase-client.js " +
        "(open the Network tab and confirm it returned 200, not blocked)."
      );
      return;
    }

    window.createSupabaseClient = window.supabase.createClient;
    window.SUPABASE_URL = SUPABASE_URL;
    window.SUPABASE_ANON_KEY = SUPABASE_ANON_KEY;

    window.supabase = window.createSupabaseClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    window.PRODUCT_IMAGES_BUCKET = "product-images";

    window.getProductImageUrl = function (path) {
      const { data } = window.supabase.storage.from(window.PRODUCT_IMAGES_BUCKET).getPublicUrl(path);
      return data.publicUrl;
    };

    /***********************************************************
       SITE CONTENT (mini CMS)
    ***********************************************************/

    const SITE_CONTENT_DEFAULTS = {
      hero_title: "Three stores, one bazaar.",
      hero_subtitle: "Where would you like to shop today? Pick a store below to browse fresh stock and order in a minute."
    };

    window.loadSiteContent = async function () {
      const { data: rows, error } = await window.supabase.from("site_content").select("key, value");
      if (error || !rows) {
        console.warn("Could not load site content:", error && error.message);
        return;
      }

      const content = {};
      rows.forEach(r => { content[r.key] = r.value; });
      window.siteContent = content;

      const heroTitleEl = document.getElementById("heroTitle");
      if (heroTitleEl && content.hero_title && content.hero_title !== SITE_CONTENT_DEFAULTS.hero_title) {
        heroTitleEl.textContent = content.hero_title;
      }

      const heroSubtitleEl = document.getElementById("heroSubtitle");
      if (heroSubtitleEl && content.hero_subtitle && content.hero_subtitle !== SITE_CONTENT_DEFAULTS.hero_subtitle) {
        heroSubtitleEl.textContent = content.hero_subtitle;
      }

      const bannerEl = document.getElementById("promoBanner");
      if (bannerEl) {
        if (content.banner_active === "true" && content.banner_text) {
          bannerEl.textContent = content.banner_text;
          bannerEl.classList.remove("hidden");
        } else {
          bannerEl.classList.add("hidden");
        }
      }

      document.querySelectorAll("[data-content]").forEach(el => {
        const key = el.getAttribute("data-content");
        if (content[key]) el.textContent = content[key];
      });
    };

    document.addEventListener("DOMContentLoaded", window.loadSiteContent);
  })();
}