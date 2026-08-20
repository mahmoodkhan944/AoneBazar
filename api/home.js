// /api/home.js
// Only invoked when a link has ?store=... on it (see vercel.json —
// plain homepage visits skip this entirely and load the static file
// directly, so normal browsing stays at full static-site speed).
//
// Injects the correct store name + store banner image into <head>
// so sharing a store link (e.g. from the mega-menu or a store page)
// shows that store's own photo on WhatsApp/Facebook, not just the
// site logo.

const fs = require("fs");
const path = require("path");

const STORE_INFO = {
  supermarket: {
    title: "AOne Bazaar — Supermarket",
    description: "Packaged goods, household items and a wide range of everyday brands.",
    image: "https://i.postimg.cc/rmP1KRDL/image.webp"
  },
  grocery: {
    title: "AOne Kirana Store — Grocery",
    description: "Daily-essentials — atta, dal, masale, oil and the staples every kitchen needs.",
    image: "https://i.postimg.cc/Rhbvr9pG/image-(3).webp"
  },
  cafe: {
    title: "AOne Cafe",
    description: "Coffee, tea and snacks — delivered fresh and hot.",
    image: "https://i.postimg.cc/mDyr5vsx/image-(2).webp"
  }
};

module.exports = async (req, res) => {
  const store = req.query.store;
  const baseUrl = getBaseUrl(req);

  let html;
  try {
    html = fs.readFileSync(path.join(process.cwd(), "index.html"), "utf-8");
  } catch (e) {
    res.status(500).send("Could not load page");
    return;
  }

  const info = STORE_INFO[store];
  if (info) {
    const url = `${baseUrl}/index.html?store=${encodeURIComponent(store)}`;
    const image = info.image.startsWith("http") ? info.image : `${baseUrl}/${info.image}`;
    html = injectMeta(html, { title: info.title, description: info.description, image, url });
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

function injectMeta(html, { title, image, description, url }) {
  html = html.replace(/<title>.*?<\/title>/s, `<title>${escapeHtml(title)}</title>`);
  html = html.replace(/<meta\s+(property="og:[^"]*"|name="twitter:[^"]*")[^>]*>\s*/gi, "");

  const tags = `
    <meta property="og:title" content="${escapeHtml(title)}" />
    <meta property="og:description" content="${escapeHtml(description)}" />
    <meta property="og:image" content="${escapeHtml(image)}" />
    <meta property="og:url" content="${escapeHtml(url)}" />
    <meta property="og:type" content="website" />
    <meta property="og:site_name" content="AOne Bazaar" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${escapeHtml(title)}" />
    <meta name="twitter:description" content="${escapeHtml(description)}" />
    <meta name="twitter:image" content="${escapeHtml(image)}" />
  </head>`;

  return html.replace("</head>", tags);
}