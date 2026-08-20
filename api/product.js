// /api/product.js
// Serves product.html with real, product-specific <meta og:...> tags
// injected server-side — this is what makes WhatsApp/Facebook/etc.
// show the actual product photo + name + price when someone shares
// a product link, instead of always showing the site logo (which is
// all a pure static site can ever do, since link-preview bots don't
// run JavaScript).
//
// Real visitors get exactly the same page as before — this function
// only changes what's in <head>, never the visible page itself.

const fs = require("fs");
const path = require("path");

const SUPABASE_URL = "https://qwqtialuqxnegqkzbtlo.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF3cXRpYWx1cXhuZWdxa3pidGxvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzczODg5ODMsImV4cCI6MjA5Mjk2NDk4M30.pMzfu6HeGtvJHygY5ZoI77p_aD1kbYFHUtHCdLUgz6o";

module.exports = async (req, res) => {
  const id = req.query.id;
  const baseUrl = getBaseUrl(req);

  let html;
  try {
    html = fs.readFileSync(path.join(process.cwd(), "product.html"), "utf-8");
  } catch (e) {
    res.status(500).send("Could not load page");
    return;
  }

  if (id) {
    try {
      const resp = await fetch(
        `${SUPABASE_URL}/rest/v1/products?id=eq.${encodeURIComponent(id)}&select=name,price,mrp,images`,
        { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` } }
      );
      const rows = await resp.json();
      const product = Array.isArray(rows) ? rows[0] : null;

      if (product) {
        const title = `${product.name} — AOne Bazaar`;
        const image =
          product.images && product.images[0] ? product.images[0] : `${baseUrl}/images/logo512.png`;
        const description = `₹${product.price} — order now on AOne Bazaar, delivered fast.`;
        const url = `${baseUrl}/product.html?id=${encodeURIComponent(id)}`;

        html = injectMeta(html, { title, image, description, url, type: "product" });
      }
    } catch (e) {
      // Supabase hiccup — fall through and serve the page with its
      // default static meta tags rather than failing the request.
    }
  }

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=0, s-maxage=600, stale-while-revalidate=86400");
  res.status(200).send(html);
};

function getBaseUrl(req) {
  const proto = req.headers["x-forwarded-proto"] || "https";
  return `${proto}://${req.headers.host}`;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function injectMeta(html, { title, image, description, url, type }) {
  html = html.replace(/<title>.*?<\/title>/s, `<title>${escapeHtml(title)}</title>`);

  // Remove any static og:/twitter: tags already in the file so we
  // don't end up with duplicates once we add the real ones.
  html = html.replace(/<meta\s+(property="og:[^"]*"|name="twitter:[^"]*")[^>]*>\s*/gi, "");

  const tags = `
    <meta property="og:title" content="${escapeHtml(title)}" />
    <meta property="og:description" content="${escapeHtml(description)}" />
    <meta property="og:image" content="${escapeHtml(image)}" />
    <meta property="og:url" content="${escapeHtml(url)}" />
    <meta property="og:type" content="${type}" />
    <meta property="og:site_name" content="AOne Bazaar" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${escapeHtml(title)}" />
    <meta name="twitter:description" content="${escapeHtml(description)}" />
    <meta name="twitter:image" content="${escapeHtml(image)}" />
  </head>`;

  return html.replace("</head>", tags);
}