// Team pages: student lists and counts need the staff key (the Bangkok admin passcode).
// This adds it to the page's own requests and, when the server answers 401 for it,
// asks once and keeps it under the same name bkk-admin.html and bkk-door.html use,
// so a teacher signed in there is not asked again.
// <script src="/staff-key.js" data-ask="no"> only sends a key that is already there:
// for public pages a teacher sometimes opens on the desk.
(() => {
  'use strict';
  const NAME = 'aybkk_bkk_key';
  const mayAsk = !(document.currentScript && document.currentScript.dataset.ask === 'no');
  const store = {
    get: () => { try { return localStorage.getItem(NAME) || ''; } catch { return ''; } },
    set: v => { try { localStorage.setItem(NAME, v); } catch {} },
    del: () => { try { localStorage.removeItem(NAME); } catch {} },
  };
  const raw = window.fetch.bind(window);
  let asking = null;

  function box(wrong) {
    return new Promise(resolve => {
      const wrap = document.createElement('div');
      wrap.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;padding:16px;font:16px/1.4 -apple-system,system-ui,sans-serif';
      wrap.innerHTML = '<form style="background:#fff;color:#222;border-radius:12px;padding:20px;width:100%;max-width:320px;box-shadow:0 8px 30px rgba(0,0,0,.25)">'
        + '<div style="font-weight:600;margin-bottom:4px">Staff passcode · รหัสทีม</div>'
        + '<div data-msg style="font-size:13px;color:#a33;min-height:18px"></div>'
        + '<input type="password" autocomplete="current-password" style="width:100%;box-sizing:border-box;font-size:16px;padding:10px;border:1px solid #bbb;border-radius:8px;margin:6px 0 14px">'
        + '<div style="display:flex;gap:8px;justify-content:flex-end">'
        + '<button type="button" data-cancel style="font-size:15px;padding:8px 14px;border:1px solid #bbb;background:#fff;border-radius:8px">Cancel</button>'
        + '<button type="submit" style="font-size:15px;padding:8px 14px;border:0;background:#222;color:#fff;border-radius:8px">Open</button>'
        + '</div></form>';
      const form = wrap.querySelector('form'), input = wrap.querySelector('input');
      wrap.querySelector('[data-msg]').textContent = wrong ? 'Wrong passcode, try again.' : '';
      const done = v => { wrap.remove(); resolve(v); };
      form.addEventListener('submit', e => { e.preventDefault(); done(input.value.trim()); });
      wrap.querySelector('[data-cancel]').addEventListener('click', () => done(''));
      wrap.addEventListener('keydown', e => { if (e.key === 'Escape') done(''); });
      const show = () => { document.body.appendChild(wrap); input.focus(); };
      document.body ? show() : document.addEventListener('DOMContentLoaded', show, { once: true });
    });
  }
  // One box for all the requests that fail at once.
  const ask = wrong => asking || (asking = box(wrong).finally(() => { asking = null; }));

  const sameOrigin = input => {
    try { return new URL(input instanceof Request ? input.url : String(input), location.href).origin === location.origin; }
    catch { return false; }
  };

  window.fetch = async (input, init = {}) => {
    if (!sameOrigin(input)) return raw(input, init);
    for (let tries = 0; ; tries++) {
      const key = store.get();
      const headers = new Headers(init.headers || (input instanceof Request ? input.headers : undefined));
      if (key && !headers.has('X-Bkk-Key')) headers.set('X-Bkk-Key', key);
      const r = await raw(input, { ...init, headers });
      if (r.status !== 401 || r.headers.get('WWW-Authenticate') !== 'X-Bkk-Key' || !mayAsk || tries >= 3) return r;
      const typed = await ask(!!key);
      if (!typed) return r;
      store.set(typed);
    }
  };
  window.staffKey = { get: store.get, forget: store.del };
})();
