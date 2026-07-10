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
      if (!productId || !size || !(nameEn || nameZh) || !wechatId)
        return res.status(400).json({ error: 'missing fields', errorZh: '请填写完整信息' });

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
      o.status = 'review';
      write(F.orders, orders);
      res.json({ success: true, order: o });
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
    const { orders } = sweep();
    const o = orders.find(x => x.id === req.params.id);
    if (!o) return res.status(404).json({ error: 'not found' });
    if (!['review', 'pending'].includes(o.status)) return res.status(409).json({ error: 'order is ' + o.status });
    o.status = 'paid';                                               // stock stays deducted — final
    o.confirmedAt = new Date().toISOString();
    write(F.orders, orders);
    res.json({ success: true, order: o });
  });

  app.post('/api/shop/admin/orders/:id/reject', (req, res) => {
    if (!isAdmin(req)) return res.status(401).json({ error: 'bad key' });
    const { orders, products } = sweep();
    const o = orders.find(x => x.id === req.params.id);
    if (!o) return res.status(404).json({ error: 'not found' });
    if (['rejected', 'expired'].includes(o.status)) return res.json({ success: true, order: o });
    const p = products.find(x => x.id === o.productId);
    if (o.status !== 'paid' && p && p.sizes[o.size] != null) p.sizes[o.size] += o.qty;  // restock
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
