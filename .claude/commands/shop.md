# Shop Builder & Operations — AYBKK pre-order shops

**When to use this command:**
Run `/shop` when building or changing an AYBKK shop: adding products, updating
stock or prices, adding a new section (e.g. the planned **AYBKK Bangkok price
list with classes and courses**), or handling order operations.

Do NOT use for: marketing copy, student journals, or workshop orientation pages.

---

## Architecture (what exists and why)

- **`shop-api.js`** — all shop endpoints, mounted by `server.js` (`mountShop(app)`).
  Data lives as JSON on Railway's persistent volume `/data`:
  `shop-products.json`, `shop-orders.json`, `shop-settings.json`.
- **`public/shop.html`** — storefront. Bilingual (zh/en), purple hand-drawn
  style, Shantell Sans self-hosted at `/fonts/shantell-var.woff2`
  (never use Google Fonts .com — blocked in China; .cn mirror only).
- **`public/shop-admin.html`** — admin console, key via `X-Shop-Key`
  (env `SHOP_ADMIN_KEY`, default `aybkk2026`).
- **`shop-seed.json`** — the source of truth Boonchu edits through Claude.
  Loaded at boot by shop-api. Fields:
  - `version` (int) — bump to trigger sync of existing products
  - per product: `id`, `nameEn`, `nameZh`, `price`, `fullPrice`, `photo`,
    `photos[]`, `sizes{}`, `note` (green banner on card), `kids` (bool →
    kids section), `hidden`
  - `setSizes{}` — replace stock with a counted target **minus active orders**
    (pending/review/paid); never oversells, never resurrects sold shirts
  - `soldFromIds[]` — when sizes moved from another product id (e.g. kids
    split), orders on the old id still claim this stock
  - `remove[]` — ids to retire (hidden, kept for order history)
- **Photos pipeline** — originals go in the link-shared Drive folder
  `08_AYBKK Tee Photos for shop`; map driveId→filename in
  `scripts/tee-photos.json`; dispatch workflow `fetch-tee-photos.yml`
  (downloads, auto-orients, resizes 900px q78, commits to `public/img/tees/`
  with `[skip ci]`). After photos land, push an empty commit so Railway
  rebuilds WITH the images.
- **Verification** — dispatch workflow `shop-check.yml`: prints the live
  product list and checks both domains. The sandbox cannot reach the
  server directly; GitHub Actions is the prober.

## Order flow rules (do not break these)

1. Orders hold stock for 10 minutes (`HOLD_MS`), lazy-swept on every request.
2. Chinese name + English name + WeChat ID all required (client gate + server 400).
3. One payment screenshot auto-covers ALL the customer's pending orders
   (matched by wechatId) — one WeChat transfer often pays several orders.
4. Admin can: confirm (also revives expired, re-deducting stock), cancel
   (restocks from pending/review/paid), edit quantity (✎, reprices at
   product price), generate CONFIRMED receipt cards.
5. Receipt cards are drawn client-side on canvas (browser CJK fonts) with
   the bird from `/img/hefei-bird.png` — student side after screenshot
   upload, teacher side from admin on paid orders.
6. Uploads (payment proofs) MUST go to `/data/uploads` — the app directory
   is wiped every deploy.

## China access (hard-won lessons)

- `my.aybkk.com` → Railway directly → **blocked in mainland China**.
- `cn.aybkk.net` → Cloudflare edge → works in China. Always give students
  the cn link. Never put schemeless links in docs (GitHub eats them).
- Fonts, images, API calls: keep everything same-origin relative.

## Building a NEW shop section (e.g. Bangkok classes & courses)

1. Model each class/course/pass as a product; use a section flag like the
   existing `kids: true` (generalize to `section: 'bkk-classes'` and render
   grouped headers in shop.html the same way the kids divider works).
2. **Currency**: the storefront hardcodes `¥` (`yen()` helper in shop.html).
   Bangkok prices are THB — add a `currency` field per product and display
   `฿` accordingly BEFORE launching a THB section. Keep WeChat-pay QR for
   China items; Bangkok items likely need PromptPay QR in
   `shop-settings.json` (extend settings per section).
3. Non-stock items (courses with unlimited seats): give them a large size
   count on a single size key like `"1 course"` — the size-chip UI renders
   any key. For date-bound courses put dates in `note`.
4. Seed it: append products to `shop-seed.json`, bump `version`, push,
   verify with `shop-check.yml`.
5. Update the Obsidian note "AYBKK Tee Shop 2026" (Drive folder with the
   WS notes) with any new links/prices.

## Operating rhythm

- Every stock/price change = seed version bump + push + ~5 min Railway
  deploy + shop-check verification. Never edit `/data` JSON by hand.
- Boonchu gets Telegram pings on payment screenshots (`TELEGRAM_BOT_TOKEN`
  + `BOONCHU_CHAT_ID`).
- Real-world incidents this design already survived: combined payments,
  mis-tapped quantities, accidental confirms, expired-but-paid orders,
  proof photos on ephemeral disk. Check git history of `shop-api.js` for
  the fixes before re-solving any of these.
