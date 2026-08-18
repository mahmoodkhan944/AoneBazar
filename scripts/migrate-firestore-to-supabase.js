/***********************************************************
   FIRESTORE → SUPABASE MIGRATION SCRIPT
   Run this ONCE on your own computer to copy the old
   products/categories from Firestore into the new Supabase
   database. It does not touch your live website.

   ── SETUP (5 steps) ─────────────────────────────────────

   1. Install Node.js if you don't have it: https://nodejs.org

   2. In this same folder, run:
        npm init -y
        npm install firebase-admin @supabase/supabase-js

   3. Get a Firebase service account key:
        Firebase Console → aone-like-mart project → ⚙ Project
        Settings → Service accounts → "Generate new private key"
        Save the downloaded file in this folder as:
        serviceAccountKey.json

   4. Get your Supabase SERVICE ROLE key (not the anon key):
        Supabase Dashboard → Settings → API → "service_role secret"
        Paste it into SUPABASE_SERVICE_ROLE_KEY below.
        ⚠ Keep this key local — never put it in the website's
        code or send it in chat. Delete/rotate it once this
        script has run if you're unsure it stayed private.

   5. Run:
        node migrate-firestore-to-supabase.js

   ────────────────────────────────────────────────────────
***********************************************************/

const { initializeApp, cert } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const { createClient } = require("@supabase/supabase-js");

// ---- FILL THESE IN LOCALLY (do not share this file once filled in) ----
const SUPABASE_URL = "https://qwqtialuqxnegqkzbtlo.supabase.co";
const SUPABASE_SERVICE_ROLE_KEY = "PASTE_YOUR_SERVICE_ROLE_KEY_HERE";
// -------------------------------------------------------------------

const serviceAccount = require("./serviceAccountKey.json");

initializeApp({
  credential: cert(serviceAccount)
});

const firestore = getFirestore();
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const VALID_STORES = ["supermarket", "grocery", "cafe"];

function normalizeStore(store) {
  const s = String(store || "").toLowerCase().trim();
  return VALID_STORES.includes(s) ? s : null;
}

async function migrateCategories() {
  console.log("\n📂 Migrating categories...");

  const snap = await firestore.collection("categories").get();

  if (snap.empty) {
    console.log("  No categories found in Firestore.");
    return;
  }

  let migrated = 0;
  let skipped = 0;

  for (const doc of snap.docs) {
    const c = doc.data();
    const store = normalizeStore(c.store);

    if (!store || !c.name) {
      console.warn(`  ⚠ Skipping malformed category doc ${doc.id}:`, c);
      skipped++;
      continue;
    }

    const { error } = await supabase
      .from("categories")
      .upsert({ store, name: c.name }, { onConflict: "store,name" });

    if (error) {
      console.error(`  ✗ Failed to insert category "${c.name}":`, error.message);
      skipped++;
    } else {
      migrated++;
    }
  }

  console.log(`  ✓ ${migrated} categories migrated, ${skipped} skipped.`);
}

async function migrateProducts() {
  console.log("\n📦 Migrating products...");

  const snap = await firestore.collection("products").get();

  if (snap.empty) {
    console.log("  No products found in Firestore.");
    return;
  }

  let migrated = 0;
  let skipped = 0;

  for (const doc of snap.docs) {
    const p = doc.data();
    const store = normalizeStore(p.store);

    if (!store || !p.name || p.price === undefined) {
      console.warn(`  ⚠ Skipping malformed product doc ${doc.id}:`, p);
      skipped++;
      continue;
    }

    const images = Array.isArray(p.images)
      ? p.images
      : (p.img ? [p.img] : []);

    const { error } = await supabase.from("products").insert({
      store,
      category: p.category || "Uncategorized",
      name: p.name,
      price: Number(p.price) || 0,
      images
    });

    if (error) {
      console.error(`  ✗ Failed to insert product "${p.name}":`, error.message);
      skipped++;
    } else {
      migrated++;
    }
  }

  console.log(`  ✓ ${migrated} products migrated, ${skipped} skipped.`);
}

async function main() {
  console.log("Starting Firestore → Supabase migration...");

  if (SUPABASE_SERVICE_ROLE_KEY === "PASTE_YOUR_SERVICE_ROLE_KEY_HERE") {
    console.error("\n✗ Please paste your Supabase service_role key into this file first.");
    process.exit(1);
  }

  await migrateCategories();
  await migrateProducts();

  console.log("\n✅ Migration complete. Check the Supabase Table Editor to confirm.");
  process.exit(0);
}

main().catch(err => {
  console.error("\n✗ Migration failed:", err);
  process.exit(1);
});
