// One photo decoded at a time on the whole server (class photos and faces in lib/r2.js,
// course files and old workshop faces in lib/media-store.js): a camera original takes a
// few hundred MB while it is open.
let queue = Promise.resolve();
module.exports = fn => { const p = queue.then(fn, fn); queue = p.catch(() => {}); return p; };
