// shop-api.js — AYBKK tee shop: products, stock, reservation orders, WeChat-pay proof
//
// Mount:  mountShop(app)
// Flow:   student orders → stock reserved + 10-min payment window → screenshot
//         uploaded → admin confirms (final) or rejects/expires (stock returns).
// Store:  JSON files in the data dir (same pattern as attendance) — /data on Railway.

const fs = require('fs');
const path = require('path');

function mountShop(app, opts = {}) {
  const dataDir = opts.dataDir || (fs.existsSync('/data') ? '/data' : path.join(__dirname, 'data'));
  try { fs.mkdirSync(dataDir, { recursive: true }); } catch {}
  const F = {
    products: path.join(dataDir, 'shop-products.json'),
    orders:   path.join(dataDir, 'shop-orders.json'),
    settings: path.join(dataDir, 'shop-settings.json'),
  };
  const ADMIN_KEY = process.env.SHOP_ADMIN_KEY || 'aybkk2026';
  const HOLD_MS = 10 * 60 * 1000;                    // 10-minute payment window

  const read = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };

  // Boot-time seed from shop-seed.json:
  //  - ids not yet in the store are added
  //  - when seed.version increases, display fields (names/prices/photos) are
  //    synced onto existing ids — but sizes (live stock) and hidden are never
  //    touched, so orders and admin stock edits survive redeploys
  try {
    const seed = JSON.parse(fs.readFileSync(path.join(__dirname, 'shop-seed.json'), 'utf8'));
    const products = read(F.products, []);
    const settings = read(F.settings, {});
    const seedVer = seed.version || 0;
    const syncFields = ['nameEn', 'nameZh', 'price', 'fullPrice', 'photo', 'photo2', 'photos', 'kids', 'note'];
    const known = new Map(products.map(p => [p.id, p]));
    let added = 0, synced = 0;
    for (const sp of seed.products || []) {
      if (!sp.id) continue;
      const cur = known.get(sp.id);
      if (!cur) {
        const np = { createdAt: new Date().toISOString(), ...sp };
        products.push(np); known.set(sp.id, np); added++;
      }
      else if (seedVer > (settings.seedVersion || 0)) {
        let touched = false;
        for (const k of syncFields) {
          if (sp[k] !== undefined && cur[k] !== sp[k]) { cur[k] = sp[k]; touched = true; }
        }
        if (touched) synced++;
      }
    }
    // setSizes: replace a product's stock with a counted target, minus
    // whatever active orders (pending/review/paid) already claimed — so
    // updating real stock never resurrects shirts that are already sold.
    if (seedVer > (settings.seedVersion || 0)) {
      const ordersNow = read(F.orders, []);
      for (const sp of seed.products || []) {
        if (!sp.setSizes) continue;
        const cur = known.get(sp.id);
        if (!cur) continue;
        // soldFromIds: when sizes moved here from another product (e.g. kids
        // sizes split off an adult tee), orders placed against the old id
        // still claim this stock.
        const srcIds = [sp.id, ...(sp.soldFromIds || [])];
        const sold = {};
        for (const ord of ordersNow) {
          if (srcIds.includes(ord.productId) && ['pending', 'review', 'paid'].includes(ord.status))
            sold[ord.size] = (sold[ord.size] || 0) + ord.qty;
        }
        const next = {};
        for (const [sz, target] of Object.entries(sp.setSizes))
          next[sz] = Math.max(0, target - (sold[sz] || 0));
        cur.sizes = next;
        synced++;
      }
    }

    // Retire ids listed in seed.remove (discontinued / never existed).
    // Hidden rather than deleted so past orders keep their product reference.
    let removed = 0;
    if (seedVer > (settings.seedVersion || 0)) {
      for (const rid of seed.remove || []) {
        const cur = known.get(rid);
        if (cur && !cur.hidden) { cur.hidden = true; removed++; }
      }
    }
    if (added || synced || removed) fs.writeFileSync(F.products, JSON.stringify(products, null, 2));
    if (seedVer > (settings.seedVersion || 0)) {
      settings.seedVersion = seedVer;
      fs.writeFileSync(F.settings, JSON.stringify(settings, null, 2));
    }
    if (added || synced || removed) console.log(`✓ shop seed v${seedVer}: +${added} new, ${synced} synced, ${removed} retired (${products.length} total)`);
  } catch (e) { if (e.code !== 'ENOENT') console.warn('shop seed skipped:', e.message); }

  // Telegram ping to Boonchu when a payment screenshot arrives (fire-and-forget)
  async function notifyPayment(order) {
    try {
      const token = process.env.TELEGRAM_BOT_TOKEN, chat = process.env.BOONCHU_CHAT_ID;
      if (!token || !chat) return;
      const text = [
        '👕 付款截图 Payment screenshot!',
        (order.nameZh || '') + ' ' + (order.nameEn || '') + ' (wx: ' + order.wechatId + ')',
        order.productNameZh + ' · ' + order.size + ' × ' + order.qty + ' · ¥' + order.amount,
        'Order ' + order.id,
        '→ https://my.aybkk.com/shop-admin.html  (Confirm / Cancel)'
      ].join('\n');
      await fetch('https://api.telegram.org/bot' + token + '/sendMessage', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chat, text })
      });
    } catch (e) { console.error('shop tg notify failed:', e.message); }
  }
  const write = (f, v) => fs.writeFileSync(f, JSON.stringify(v, null, 2));
  const uid = p => p + '-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6).toUpperCase();
  const isAdmin = req => (req.headers['x-shop-key'] || req.query.key) === ADMIN_KEY;

  // Release expired unpaid reservations (lazy sweep — no cron needed)
  function sweep() {
    const orders = read(F.orders, []);
    const products = read(F.products, []);
    let dirty = false;
    const now = Date.now();
    for (const o of orders) {
      if (o.status === 'pending' && now > o.expiresAt) {
        o.status = 'expired';
        const p = products.find(x => x.id === o.productId);
        if (p && p.sizes[o.size] != null) p.sizes[o.size] += o.qty;   // stock returns
        dirty = true;
      }
    }
    if (dirty) { write(F.orders, orders); write(F.products, products); }
    return { orders, products };
  }

  // ── public ──────────────────────────────────────────────────────────────────
  // GET /api/shop/products — storefront listing (available stock after sweep)
  app.get('/api/shop/products', (req, res) => {
    const { products } = sweep();
    const settings = read(F.settings, {});
    res.json({
      products: products.filter(p => !p.hidden),
      paymentQr: settings.paymentQr || null,
      wechatAccount: settings.wechatAccount || 'AYBKK',
    });
  });

  // POST /api/shop/orders — place order: validates stock, reserves, starts the clock
  app.post('/api/shop/orders', (req, res) => {
    try {
      const { productId, size, qty, nameEn, nameZh, wechatId } = req.body || {};
      const q = Math.max(1, Math.min(10, parseInt(qty) || 1));
      if (!productId || !size || !(nameEn || '').trim() || !(nameZh || '').trim() || !(wechatId || '').trim())
        return res.status(400).json({ error: 'Chinese name, English name and WeChat ID are all required', errorZh: '请填写中文名、英文名和微信号' });

      const { orders, products } = sweep();
      const p = products.find(x => x.id === productId && !x.hidden);
      if (!p) return res.status(404).json({ error: 'product not found', errorZh: '商品不存在' });
      if (p.sizes[size] == null || p.sizes[size] < q)
        return res.status(409).json({ error: 'not enough stock', errorZh: '该尺码库存不足' });

      p.sizes[size] -= q;                                            // reserve
      const order = {
        id: uid('T'),
        productId, productName: p.nameEn, productNameZh: p.nameZh,
        size, qty: q, amount: p.price * q,
        nameEn: nameEn || '', nameZh: nameZh || '', wechatId,
        status: 'pending',
        createdAt: new Date().toISOString(),
        expiresAt: Date.now() + HOLD_MS,
        screenshot: null, confirmedAt: null,
      };
      orders.push(order);
      write(F.orders, orders); write(F.products, products);
      const settings = read(F.settings, {});
      res.json({ success: true, order, paymentQr: settings.paymentQr || null,
                 wechatAccount: settings.wechatAccount || 'AYBKK', holdMinutes: 10 });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // GET /api/shop/orders/:id — student checks their own order state
  app.get('/api/shop/orders/:id', (req, res) => {
    const { orders } = sweep();
    const o = orders.find(x => x.id === req.params.id);
    if (!o) return res.status(404).json({ error: 'not found' });
    res.json({ order: o });
  });

  // POST /api/shop/orders/:id/screenshot — attach payment proof (stops the clock)
  app.post('/api/shop/orders/:id/screenshot', (req, res) => {
    try {
      const { file } = req.body || {};
      if (!file) return res.status(400).json({ error: 'file required' });
      const { orders } = sweep();
      const o = orders.find(x => x.id === req.params.id);
      if (!o) return res.status(404).json({ error: 'not found', errorZh: '订单不存在' });
      if (o.status === 'expired') return res.status(410).json({ error: 'order expired', errorZh: '订单已超时，请重新下单' });
      if (!['pending', 'review'].includes(o.status)) return res.status(409).json({ error: 'order is ' + o.status });
      o.screenshot = file;
      o.status = 'review';                      // clock stops; stock stays held until admin decides
      // One WeChat transfer often covers several orders. Attach the same
      // proof to this customer's OTHER pending orders so their holds stop
      // ticking too, instead of silently expiring.
      const siblings = orders.filter(x =>
        x.id !== o.id && x.status === 'pending' && x.wechatId === o.wechatId);
      for (const s of siblings) { s.screenshot = file; s.status = 'review'; }
      write(F.orders, orders);
      if (siblings.length) {
        const total = o.amount + siblings.reduce((a, s) => a + s.amount, 0);
        notifyPayment({ ...o, productNameZh: (o.productNameZh || o.productName) +
          ` (+${siblings.length} more orders, combined ¥${total})` });
      } else {
        notifyPayment(o);
      }
      res.json({ success: true, order: o, alsoCovered: siblings.map(s => s.id) });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ── admin (X-Shop-Key header or ?key=) ──────────────────────────────────────
  app.post('/api/shop/products', (req, res) => {
    if (!isAdmin(req)) return res.status(401).json({ error: 'bad key' });
    try {
      const products = read(F.products, []);
      const b = req.body || {};
      if (b.id) {                                                    // update
        const p = products.find(x => x.id === b.id);
        if (!p) return res.status(404).json({ error: 'not found' });
        Object.assign(p, { nameEn: b.nameEn ?? p.nameEn, nameZh: b.nameZh ?? p.nameZh,
                           price: b.price ?? p.price, photo: b.photo ?? p.photo,
                           sizes: b.sizes ?? p.sizes, hidden: b.hidden ?? p.hidden });
        write(F.products, products);
        return res.json({ success: true, product: p });
      }
      const p = { id: uid('P'), nameEn: b.nameEn || '', nameZh: b.nameZh || '',
                  price: Number(b.price) || 0, photo: b.photo || null,
                  sizes: b.sizes || {}, hidden: false, createdAt: new Date().toISOString() };
      products.push(p);
      write(F.products, products);
      res.json({ success: true, product: p });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.get('/api/shop/admin/orders', (req, res) => {
    if (!isAdmin(req)) return res.status(401).json({ error: 'bad key' });
    const { orders, products } = sweep();
    res.json({ orders: orders.slice().reverse(), products });
  });

  app.post('/api/shop/admin/orders/:id/confirm', (req, res) => {
    if (!isAdmin(req)) return res.status(401).json({ error: 'bad key' });
    const { orders, products } = sweep();
    const o = orders.find(x => x.id === req.params.id);
    if (!o) return res.status(404).json({ error: 'not found' });
    if (o.status === 'expired') {
      // Revive: customer actually paid (e.g. one screenshot covered several
      // orders) but the hold ran out. Stock was returned on expiry, so it
      // must be deducted again — only possible while it is still available.
      const p = products.find(x => x.id === o.productId);
      if (!p || (p.sizes[o.size] ?? 0) < o.qty)
        return res.status(409).json({ error: `cannot revive: only ${p ? (p.sizes[o.size] ?? 0) : 0} left in ${o.size}` });
      p.sizes[o.size] -= o.qty;
      write(F.products, products);
    } else if (!['review', 'pending'].includes(o.status)) {
      return res.status(409).json({ error: 'order is ' + o.status });
    }
    o.status = 'paid';                                               // stock stays deducted — final
    o.confirmedAt = new Date().toISOString();
    write(F.orders, orders);
    res.json({ success: true, order: o });
  });

  // Fix a mis-typed quantity (customer meant 4, tapped 5). Adjusts stock by
  // the difference and reprices the order. Allowed while the order still
  // holds stock (pending / review / paid).
  app.post('/api/shop/admin/orders/:id/qty', (req, res) => {
    if (!isAdmin(req)) return res.status(401).json({ error: 'bad key' });
    const newQty = Math.max(1, Math.min(20, parseInt(req.body && req.body.qty) || 0));
    if (!newQty) return res.status(400).json({ error: 'qty required' });
    const { orders, products } = sweep();
    const o = orders.find(x => x.id === req.params.id);
    if (!o) return res.status(404).json({ error: 'not found' });
    if (!['pending', 'review', 'paid'].includes(o.status))
      return res.status(409).json({ error: 'order is ' + o.status + ' — no stock held to adjust' });
    const p = products.find(x => x.id === o.productId);
    if (!p) return res.status(404).json({ error: 'product not found' });
    const delta = newQty - o.qty;
    if (delta > 0 && (p.sizes[o.size] ?? 0) < delta)
      return res.status(409).json({ error: `only ${p.sizes[o.size] ?? 0} left in ${o.size}` });
    p.sizes[o.size] = (p.sizes[o.size] ?? 0) - delta;               // + returns, - takes
    o.qty = newQty;
    o.amount = p.price * newQty;
    write(F.orders, orders); write(F.products, products);
    res.json({ success: true, order: o });
  });

  app.post('/api/shop/admin/orders/:id/reject', (req, res) => {
    if (!isAdmin(req)) return res.status(401).json({ error: 'bad key' });
    const { orders, products } = sweep();
    const o = orders.find(x => x.id === req.params.id);
    if (!o) return res.status(404).json({ error: 'not found' });
    if (['rejected', 'expired'].includes(o.status)) return res.json({ success: true, order: o });
    // pending / review / paid all hold stock — cancelling any of them returns it
    const p = products.find(x => x.id === o.productId);
    if (['pending', 'review', 'paid'].includes(o.status) && p && p.sizes[o.size] != null)
      p.sizes[o.size] += o.qty;
    o.status = 'rejected';
    write(F.orders, orders); write(F.products, products);
    res.json({ success: true, order: o });
  });

  app.post('/api/shop/admin/settings', (req, res) => {
    if (!isAdmin(req)) return res.status(401).json({ error: 'bad key' });
    const s = read(F.settings, {});
    if (req.body.paymentQr !== undefined) s.paymentQr = req.body.paymentQr;
    if (req.body.wechatAccount !== undefined) s.wechatAccount = req.body.wechatAccount;
    write(F.settings, s);
    res.json({ success: true, settings: s });
  });

  console.log('✓ shop-api mounted (/api/shop/*)');
}

module.exports = { mountShop };
