// Home-page global search: one box that searches products across ALL
// three stores at once (typo-tolerant), and jumps to the product page.
// Loaded after app.js (uses its levenshteinDistance + supabase client).

(function () {
  const STORE_LABELS = { supermarket: "AOne Bazaar", grocery: "AOne Kirana", cafe: "AOne Cafe" };
  let cache = null, loading = null, debounceTimer = null;

  // Styles injected here so no existing stylesheet needs replacing.
  const style = document.createElement("style");
  style.textContent = `
    .global-search-wrap { position: relative; max-width: 640px; margin: 18px auto 6px; }
    .global-search-wrap .gs-input { width: 100%; padding-left: 44px; height: 48px; font-size: 1rem; box-sizing: border-box; }
    .global-search-wrap .gs-icon { position: absolute; left: 16px; top: 15px; color: var(--ink-faint, #888); pointer-events: none; }
    .global-search-results { position: absolute; top: calc(100% + 6px); left: 0; right: 0; background: var(--surface, #fff);
      border: 1px solid var(--line, #e7e0cf); border-radius: 14px; box-shadow: 0 12px 32px rgba(0,0,0,.14); z-index: 60;
      max-height: 420px; overflow-y: auto; padding: 6px; text-align: left; }
    .gs-item { display: flex; align-items: center; gap: 12px; padding: 8px; border-radius: 10px; text-decoration: none; color: inherit; }
    .gs-item:hover, .gs-item.gs-active { background: var(--surface-sunken, #f4f1e8); }
    .gs-item img { width: 44px; height: 44px; border-radius: 8px; object-fit: cover; flex: 0 0 auto; background: var(--surface-sunken, #f4f1e8); }
    .gs-name { font-size: .92rem; font-weight: 600; line-height: 1.25; }
    .gs-meta { font-size: .76rem; color: var(--ink-faint, #7a766a); margin-top: 2px; }
    .gs-price { margin-left: auto; font-weight: 700; font-size: .9rem; white-space: nowrap; }
    .gs-empty, .gs-note { padding: 12px; font-size: .85rem; color: var(--ink-faint, #7a766a); }
    .gs-oos { color: #b3261e; }
  `;
  document.head.appendChild(style);

  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  function loadAll() {
    if (cache) return Promise.resolve(cache);
    if (!loading) {
      loading = supabase.from("products")
        .select("id,name,price,store,category,images,in_stock")
        .range(0, 4999)
        .then(({ data, error }) => {
          if (error) { console.warn("Global search load failed:", error.message); loading = null; return []; }
          cache = data || [];
          return cache;
        });
    }
    return loading;
  }

  function fuzzy(items, q) {
    const maxD = q.length <= 4 ? 1 : q.length <= 8 ? 2 : 3;
    return items
      .map(p => ({ p, d: Math.min(...String(p.name).toLowerCase().split(/\s+/).map(w => levenshteinDistance(q, w))) }))
      .filter(x => x.d <= maxD)
      .sort((a, b) => a.d - b.d)
      .map(x => x.p);
  }

  function search(items, q) {
    const words = q.split(/\s+/).filter(Boolean);
    let hits = items.filter(p => {
      const hay = (p.name + " " + (p.category || "")).toLowerCase();
      return words.every(w => hay.includes(w));
    });
    // Names starting with the query first.
    hits.sort((a, b) => (b.name.toLowerCase().startsWith(q) ? 1 : 0) - (a.name.toLowerCase().startsWith(q) ? 1 : 0));
    let fuzzyUsed = false;
    if (hits.length === 0 && typeof levenshteinDistance === "function") {
      hits = fuzzy(items, q);
      fuzzyUsed = hits.length > 0;
    }
    return { hits, fuzzyUsed };
  }

  function render(box, hits, q, fuzzyUsed) {
    if (hits.length === 0) {
      box.innerHTML = `<div class="gs-empty">No products found for "${esc(q)}". Try a different word.</div>`;
    } else {
      const top = hits.slice(0, 12);
      box.innerHTML =
        (fuzzyUsed ? `<div class="gs-note">Showing results close to "${esc(q)}"</div>` : "") +
        top.map(p => {
          const thumb = p.images && p.images[0] ? p.images[0] : "images/logo192.png";
          return `<a class="gs-item" href="product.html?id=${encodeURIComponent(p.id)}">
            <img src="${esc(thumb)}" alt="" loading="lazy" />
            <div><div class="gs-name">${esc(p.name)}</div>
              <div class="gs-meta">${esc(STORE_LABELS[p.store] || p.store)}${p.category ? " · " + esc(p.category) : ""}${p.in_stock === false ? ' · <span class="gs-oos">Out of stock</span>' : ""}</div></div>
            <div class="gs-price">₹${esc(p.price)}</div>
          </a>`;
        }).join("") +
        (hits.length > 12 ? `<div class="gs-note">+${hits.length - 12} more — type more letters to narrow down</div>` : "");
    }
    box.classList.remove("hidden");
  }

  window.runGlobalSearch = async function () {
    const input = document.getElementById("globalSearchInput");
    const box = document.getElementById("globalSearchResults");
    if (!input || !box) return;
    const q = input.value.trim().toLowerCase();
    if (!q) { box.classList.add("hidden"); box.innerHTML = ""; return; }
    const items = await loadAll();
    if (input.value.trim().toLowerCase() !== q) return; // stale
    const { hits, fuzzyUsed } = search(items, q);
    render(box, hits, q, fuzzyUsed);
  };

  window.onGlobalSearchInput = function () {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(window.runGlobalSearch, 120);
  };

  window.onGlobalSearchKey = function (e) {
    const box = document.getElementById("globalSearchResults");
    if (e.key === "Escape") { box.classList.add("hidden"); return; }
    if (e.key === "Enter") {
      e.preventDefault();
      const first = box.querySelector(".gs-item");
      if (first) location.href = first.getAttribute("href");
    }
  };

  document.addEventListener("click", e => {
    const wrap = document.querySelector(".global-search-wrap");
    const box = document.getElementById("globalSearchResults");
    if (wrap && box && !wrap.contains(e.target)) box.classList.add("hidden");
  });
})();