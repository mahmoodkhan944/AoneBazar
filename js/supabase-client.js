/***********************************************************
   SUPABASE CLIENT + SITE CONTENT
   Everything — data, images, login, and now the editable
   homepage/about/contact text — runs through Supabase.

   The whole file is wrapped in one guard so it's safe even if
   accidentally included twice on the page (a common gotcha with
   plain <script> tags) — without this, the second run would
   throw "Identifier ... has already been declared" and silently
   break every function below it on the page.
***********************************************************/

if (!window.__AONE_SUPABASE_READY__) {
  window.__AONE_SUPABASE_READY__ = true;

  // Mobile nav toggle lives outside the Supabase setup below on purpose —
  // navigation should keep working even if the Supabase library fails to
  // load for some reason (flaky network, ad-blocker, etc).
  window.toggleMobileNav = function () {
    const nav = document.getElementById("mainNav");
    if (nav) nav.classList.toggle("mobile-open");
  };

  /** Safely embeds a JS object into a single-quoted inline HTML
   *  attribute, e.g. onclick='addToCart(${jsonAttr(p)})'. Plain
   *  JSON.stringify() breaks that attribute the moment any field —
   *  a product name, description, category — contains an apostrophe
   *  ("India's 1st...", "Chef's Special"), corrupting the markup and
   *  taking down every button on the page with a syntax error.
   *  Shared by both the storefront and the admin panel. */
  window.jsonAttr = function (obj) {
    return JSON.stringify(obj)
      .replace(/&/g, "&amp;")
      .replace(/'/g, "&#39;")
      .replace(/</g, "&lt;");
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
     A nicer stand-in for window.alert() — used everywhere in the
     app instead of the browser's native alert box. Lives outside
     the Supabase setup below so it always works, even if Supabase
     fails to load.
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

  // Everywhere in the app that used to call alert(...) now calls
  // window.alert(...) unchanged in the source — this override means
  // we didn't have to touch every single call site by hand, and any
  // future alert() call automatically gets the nicer styling too.
  window.alert = window.showToast;

  /***********************************************************
     CUSTOM CONFIRM / PROMPT DIALOGS
     Replace the browser's native confirm()/prompt() popups — which
     always look like a bare OS alert, out of place next to the rest
     of the site — with a modal styled to match everything else.
     Both return a Promise, so call sites use `await`.
  ***********************************************************/

  function escapeForDialog(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  function openCustomDialog(message, opts) {
    return new Promise(resolve => {
      const overlay = document.createElement("div");
      overlay.className = "custom-dialog-overlay";
      overlay.innerHTML = `
        <div class="custom-dialog" role="dialog" aria-modal="true">
          <p class="custom-dialog-message">${escapeForDialog(message)}</p>
          ${opts.showInput ? `<input type="text" class="custom-dialog-input" placeholder="${opts.placeholder || ""}" value="${opts.defaultValue ? escapeForDialog(opts.defaultValue) : ""}" />` : ""}
          <div class="custom-dialog-actions">
            <button type="button" class="custom-dialog-cancel">Cancel</button>
            <button type="button" class="custom-dialog-ok ${opts.danger ? "danger" : ""}">${opts.okLabel || "OK"}</button>
          </div>
        </div>
      `;
      document.body.appendChild(overlay);

      const input = overlay.querySelector(".custom-dialog-input");
      if (input) setTimeout(() => input.focus(), 50);

      function finish(result) {
        overlay.remove();
        resolve(result);
      }

      overlay.querySelector(".custom-dialog-cancel").onclick = () => finish(opts.showInput ? null : false);
      overlay.querySelector(".custom-dialog-ok").onclick = () =>
        finish(opts.showInput ? input.value.trim() : true);

      overlay.addEventListener("click", e => {
        if (e.target === overlay) finish(opts.showInput ? null : false);
      });

      overlay.addEventListener("keydown", e => {
        if (e.key === "Escape") finish(opts.showInput ? null : false);
        if (e.key === "Enter" && (e.target === input || e.target.tagName !== "TEXTAREA")) {
          finish(opts.showInput ? input.value.trim() : true);
        }
      });
    });
  }

  window.customConfirm = function (message, okLabel) {
    return openCustomDialog(message, { okLabel: okLabel || "Yes, continue", danger: true });
  };

  window.customPrompt = function (message, defaultValue) {
    return openCustomDialog(message, { showInput: true, defaultValue, placeholder: "" });
  };

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

    // Keep a handle on the raw library + credentials before we overwrite
    // window.supabase below — admin.html uses this to spin up a second,
    // throwaway client (e.g. for creating a new user) without disturbing
    // the admin's own logged-in session.
    window.createSupabaseClient = window.supabase.createClient;
    window.SUPABASE_URL = SUPABASE_URL;
    window.SUPABASE_ANON_KEY = SUPABASE_ANON_KEY;

    // Replace the library namespace (window.supabase) with the actual
    // client instance — this is the object every other file in the app
    // refers to as the bare global `supabase`.
    window.supabase = window.createSupabaseClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    window.PRODUCT_IMAGES_BUCKET = "product-images";

    window.getProductImageUrl = function (path) {
      const { data } = window.supabase.storage.from(window.PRODUCT_IMAGES_BUCKET).getPublicUrl(path);
      return data.publicUrl;
    };

    /***********************************************************
       SITE CONTENT (mini CMS)
       Shared by every page (index, about, contact, product) so
       the homepage hero, promo banner, and about/contact text
       can be edited from the admin panel without touching code.

       Elements are matched two ways:
       - By id, for a few specific spots (heroTitle, heroSubtitle,
         promoBanner) where the default markup has extra styling
         we don't want to clobber unless the admin changed it.
       - By [data-content="key"] anywhere else — the element's
         text is simply replaced with that key's value.
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

      // Legal pages (Privacy/Terms/Refund) — admin writes plain text
      // in a big textarea; blank lines become new paragraphs, and a
      // line starting with "## " becomes a small bold sub-heading.
      document.querySelectorAll("[data-content-html]").forEach(el => {
        const key = el.getAttribute("data-content-html");
        if (content[key]) el.innerHTML = renderLegalText(content[key]);
      });

      renderSocialLinks(content);
    };

    function escapeHtml(str) {
      const div = document.createElement("div");
      div.textContent = str;
      return div.innerHTML;
    }

    /** A tiny, forgiving text convention — no HTML/Markdown knowledge
     *  needed. Used for Legal Pages, and for product descriptions
     *  too, so any admin can build a properly structured description
     *  ("Key Features", "How to Use", bullet points, etc.) just by
     *  typing plain text with these three rules:
     *    - A blank line starts a new paragraph.
     *    - A line starting with one or more "#" becomes a bold
     *      sub-heading — "#Heading", "# Heading" and "## Heading" all
     *      work, admin names it whatever they want ("Ingredients",
     *      "How to Use"...), as many as they like.
     *    - Lines starting with "- ", "* " or "• " (one after another)
     *      become a bullet list.
     */
    window.renderMarkdownLite = function (raw) {
      if (!raw) return "";

      const headingRe = /^#{1,6}\s*(.*)$/;
      const bulletRe = /^[-*•]\s+(.*)$/;

      return raw
        .split(/\n\s*\n/)
        .map(block => {
          const trimmed = block.trim();
          if (!trimmed) return "";

          const lines = trimmed.split("\n");
          let heading = "";
          let bodyLines = lines;

          const headingMatch = lines[0].match(headingRe);
          if (headingMatch) {
            heading = `<h3>${escapeHtml(headingMatch[1].trim())}</h3>`;
            bodyLines = lines.slice(1);
          }

          if (bodyLines.length === 0) return heading;

          // A block of lines that all start with a bullet marker
          // renders as a bullet list instead of a paragraph.
          const isBulletBlock = bodyLines.every(l => bulletRe.test(l.trim()));

          if (isBulletBlock) {
            const items = bodyLines
              .map(l => `<li>${escapeHtml(l.trim().match(bulletRe)[1].trim())}</li>`)
              .join("");
            return heading + `<ul>${items}</ul>`;
          }

          const paragraph = `<p>${escapeHtml(bodyLines.join("\n")).replace(/\n/g, "<br>")}</p>`;
          return heading + paragraph;
        })
        .join("\n");
    };

    function renderLegalText(raw) {
      return window.renderMarkdownLite(raw);
    }

    // Every social platform we support a link for — admin can leave
    // any of these blank in Site Content, and that icon simply won't
    // appear in the footer at all.
    const SOCIAL_PLATFORMS = [
      { key: "social_facebook", icon: "fab fa-facebook-f", label: "Facebook" },
      { key: "social_instagram", icon: "fab fa-instagram", label: "Instagram" },
      { key: "social_whatsapp", icon: "fab fa-whatsapp", label: "WhatsApp" },
      { key: "social_youtube", icon: "fab fa-youtube", label: "YouTube" },
      { key: "social_twitter", icon: "fab fa-x-twitter", label: "Twitter / X" },
      { key: "social_linkedin", icon: "fab fa-linkedin-in", label: "LinkedIn" }
    ];

    function renderSocialLinks(content) {
      document.querySelectorAll("[data-social-links]").forEach(container => {
        const links = SOCIAL_PLATFORMS.filter(p => content[p.key] && content[p.key].trim());

        if (links.length === 0) {
          container.style.display = "none";
          return;
        }

        container.style.display = "";
        container.innerHTML = links.map(p => `
          <a href="${escapeHtml(content[p.key].trim())}" target="_blank" rel="noopener noreferrer" aria-label="${p.label}">
            <i class="${p.icon}"></i>
          </a>
        `).join("");
      });
    }

    document.addEventListener("DOMContentLoaded", window.loadSiteContent);
  })();
}

// ---- PWA: register the service worker so the site becomes
// installable ("Add to Home Screen") on phones and desktops. Only
// runs on http/https origins (skips file:// during local testing,
// where service workers aren't allowed anyway). ----
if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").then(reg => {
      // A newer sw.js has finished installing while this app was
      // already open (common for an installed/standalone app, which
      // has no address bar to manually refresh) — reload straight
      // away so it's actually running the new version, not just
      // holding a new one in reserve for next launch.
      reg.addEventListener("updatefound", () => {
        const newWorker = reg.installing;
        if (!newWorker) return;
        newWorker.addEventListener("statechange", () => {
          if (newWorker.state === "activated") {
            window.location.reload();
          }
        });
      });

      // Also check for an update every time the app is opened/
      // brought to the foreground, not just at first load — an
      // installed app can stay open for days without a fresh
      // network request ever happening otherwise.
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") reg.update();
      });
    }).catch(() => {
      // Non-fatal — the site still works perfectly without it, it
      // just won't be installable on this particular browser.
    });
  });
}

// Capture the browser's install prompt so we can trigger it from
// our own "Install App" button instead of waiting for the browser's
// own (often-missed) mini-infobar.
let deferredInstallPrompt = null;

window.addEventListener("beforeinstallprompt", e => {
  e.preventDefault();
  deferredInstallPrompt = e;
  document.querySelectorAll("[data-install-app-btn]").forEach(btn => {
    btn.classList.remove("hidden");
  });
});

window.installAoneBazaarApp = async function () {
  if (!deferredInstallPrompt) return;
  deferredInstallPrompt.prompt();
  await deferredInstallPrompt.userChoice;
  deferredInstallPrompt = null;
  document.querySelectorAll("[data-install-app-btn]").forEach(btn => {
    btn.classList.add("hidden");
  });
};

// Once actually installed, hide the button everywhere for good.
window.addEventListener("appinstalled", () => {
  deferredInstallPrompt = null;
  document.querySelectorAll("[data-install-app-btn]").forEach(btn => {
    btn.classList.add("hidden");
  });
});