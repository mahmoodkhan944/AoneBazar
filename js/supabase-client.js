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

  document.addEventListener("click", e => {
    const nav = document.getElementById("mainNav");
    const toggleBtn = document.querySelector(".mobile-nav-toggle");
    if (!nav || !nav.classList.contains("mobile-open")) return;
    if (nav.contains(e.target) || (toggleBtn && toggleBtn.contains(e.target))) return;
    nav.classList.remove("mobile-open");
  });

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
    };

    document.addEventListener("DOMContentLoaded", window.loadSiteContent);
  })();
}
