// In-Depth Mysore application form. <html lang> picks the messages, and the
// form's data-list names the list the application joins. Each page has only
// the questions its list asks; the checks below run on those alone.
// The form shows one .step at a time: fit first (the bar questions stop a "not
// yet" before any contact detail is asked), then the written answers, then
// contact and video. With JS off every step shows, as one long form.
(() => {
  const MSG = {
    en: { empty: 'Please fill this in.', email: 'Please check the email address.',
      link: 'Please paste a link that starts with https://, or choose to send it on LINE or WeChat.',
      consent: 'Please tick the box to send.', long: 'This is too long. Please make it shorter.', check: 'Please check the answers marked above.',
      bar: 'This course needs a yes on the questions marked above.', sending: 'Sending…',
      busy: 'Too many tries from this connection. Please try again in an hour, or message LINE @aybkk.',
      server: 'That did not send. Please try again, or message LINE @aybkk.',
      keep: 'Your answers are kept on this device only, and deleted when you send.',
      kept: 'Your earlier answers are still here. They are kept on this device only, and deleted when you send.' },
    zh: { empty: '请填写这一项。', email: '请检查邮箱地址。', link: '请贴上以 https:// 开头的链接，或选“在微信上发给 aybkkwechat”。',
      consent: '请勾选同意后再发送。', long: '内容太长，请写短一些。', check: '请检查上面标出的几项。',
      bar: '上面标出的问题，这个课程需要你的答案是“是”或“能”。', sending: '正在发送…',
      busy: '这个网络尝试的次数太多了。请一小时后再试，或加微信 aybkkwechat。',
      server: '没有发送成功。请再试一次，或加微信 aybkkwechat。',
      keep: '你的回答只保存在本机，发送后自动删除。',
      kept: '你上次填的答案还在。它们只保存在本机，发送后自动删除。' },
  };
  const form = document.getElementById('form');
  if (!form) return;
  const M = MSG[document.documentElement.lang.startsWith('zh') ? 'zh' : 'en'];
  const send = document.getElementById('send'), formMsg = document.getElementById('formmsg');
  const back = document.getElementById('back'), next = document.getElementById('next');
  const thanks = document.getElementById('thanks'), thanksChat = document.getElementById('thanks-chat');
  const again = document.getElementById('again'), keep = document.getElementById('keep');
  const SEND_LABEL = send.textContent;
  let msgKey = '', sending = false;
  function say(k) { msgKey = k; formMsg.textContent = k ? M[k] : ''; }

  // Counts for the staff's weekly box (bkk-api.js): one 'view' each time the page loads, then
  // 'step2' and 'step3' once each when the form first shows them, after a restore too. Where the
  // click came from (?src=) and the headline it was opened with (?for=) go with every count and
  // with the application. Never ?from=: WeChat adds from=singlemessage or from=timeline itself.
  // A count is sent and forgotten: it never waits, and a failed one changes nothing on the page.
  const PAGE = form.getAttribute('data-page');
  const FOR_TAGS = ['teacher', 'practice', 'room'];
  const code = v => String(v || '').toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 40);
  function param(k) {
    const hit = location.search.slice(1).split('&').map(p => p.split('=')).filter(p => p[0] === k)[0];
    if (!hit) return '';
    try { return decodeURIComponent((hit[1] || '').replace(/\+/g, ' ')); } catch (_) { return ''; }
  }
  let SRC = '', TAG = '';
  const reached = {};
  function count(kind) {
    if (!PAGE) return;
    const body = JSON.stringify({ page: PAGE, kind: kind, src: SRC, tag: TAG, lang: M === MSG.zh ? 'zh' : 'en' });
    try {
      if (navigator.sendBeacon && navigator.sendBeacon('/api/bkk/start-event', new Blob([body], { type: 'application/json' }))) return;
    } catch (_) {}
    try {
      fetch('/api/bkk/start-event', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body, keepalive: true })
        .catch(() => {});
    } catch (_) {}
  }

  const steps = [].slice.call(form.querySelectorAll('.step'));
  // A page cached from before the steps still works as one long form.
  const paged = steps.length > 1 && !!back && !!next;
  // Every field in page order, so the first bad one is the first on screen.
  const KEYS = [].map.call(form.querySelectorAll('.f[data-f]'), b => b.getAttribute('data-f')).filter(k => form.elements[k]);
  const OPTIONAL = ['teach', 'injury', 'heard', 'question'];
  const BAR = { primary: v => v === 'not_yet', rooms: v => v === 'not_yet', dates: v => v === 'no' };
  const val = k => {
    const el = form.elements[k];
    if (!el) return '';
    if (el.type === 'checkbox') return el.checked;
    return String(el.value || '').trim();
  };
  const byChat = () => val('video_by') === 'chat';
  const fieldBox = k => form.querySelector(`.f[data-f="${k}"]`);
  const stepOf = k => paged ? steps.indexOf(fieldBox(k).closest('.step')) : 0;
  const stepKeys = i => KEYS.filter(k => stepOf(k) === i);
  function setErr(k, text) {
    const box = fieldBox(k), e = document.getElementById('e-' + k);
    if (!box || !e) return;
    e.textContent = text || '';
    box.classList.toggle('bad', !!text);
    box.querySelectorAll('input,select,textarea').forEach(i => i.setAttribute('aria-invalid', text ? 'true' : 'false'));
  }
  function problem(k) {
    const v = val(k), el = form.elements[k];
    if (k === 'consent') return v ? '' : M.consent;
    if (k === 'video' && byChat()) return '';
    // An empty link gets this message too: it names the other way to send.
    if (k === 'video' && !/https:\/\/[^\s]+\.[^\s]+/i.test(v)) return M.link;
    if (!OPTIONAL.includes(k) && v === '') return M.empty;
    if (k === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return M.email;
    if (k === 'years' && (!/^\d{1,2}$/.test(v) || +v > 60)) return M.empty;
    if (el && el.maxLength > 0 && [...v].length > el.maxLength) return M.long;
    return '';
  }
  function validate(k) {
    const e = problem(k);
    setErr(k, e);
    return !e;
  }
  const barFails = () => Object.keys(BAR).some(k => fieldBox(k) && BAR[k](val(k)));
  // While a send is on its way nothing moves, so nothing is sent twice.
  function checkBar() {
    let any = false;
    for (const [k, isBad] of Object.entries(BAR)) {
      const box = fieldBox(k);
      if (!box) continue;
      const b = isBad(val(k));
      box.querySelector('.barnote').hidden = !b;
      any = any || b;
    }
    send.disabled = any || sending;
    if (next) next.disabled = any || sending;
    if (back) back.disabled = sending;
    if (any) say('bar'); else if (msgKey === 'bar') say('');
    return any;
  }
  const clearCheck = () => { if (msgKey === 'check' && !form.querySelector('.f.bad')) say(''); };

  // A video sent on WeChat (or LINE) needs no link, so the link box goes away.
  function syncVideo() {
    const box = fieldBox('video'), note = document.getElementById('vchat');
    if (!box || !note) return;
    box.hidden = byChat();
    note.hidden = !byChat();
    if (byChat()) setErr('video', '');
  }

  // Answers wait on this device, never on the server, until Send: WeChat often
  // reloads the page when someone leaves it to film the video. Never the
  // honeypot, and not the consent tick, which is given fresh each time. After a
  // send only { sent, video_by } stays, so a reload shows the thanks again.
  const STORE = 'aybkk_apply_' + form.getAttribute('data-list');
  const KEEP_MS = 30 * 24 * 3600 * 1000;
  const SAVED = KEYS.filter(k => k !== 'consent');
  const fresh = t => typeof t === 'number' && t <= Date.now() && Date.now() - t < KEEP_MS;
  let step = 0;
  function put(d) { try { localStorage.setItem(STORE, JSON.stringify(d)); } catch (_) {} }
  function save() {
    const v = {};
    SAVED.forEach(k => { v[k] = String(form.elements[k].value || ''); });
    put({ at: Date.now(), step, v, src: SRC, tag: TAG });
  }
  function forget() { try { localStorage.removeItem(STORE); } catch (_) {} }
  function canStore() {
    try { localStorage.setItem(STORE + '_t', '1'); localStorage.removeItem(STORE + '_t'); return true; } catch (_) { return false; }
  }
  // Tells the person their answers wait on this device, only where they can.
  function sayKeep(back) {
    if (!keep || !canStore()) return;
    keep.textContent = back ? M.kept : M.keep;
    keep.hidden = false;
  }
  function load() {
    let d = null;
    try { d = JSON.parse(localStorage.getItem(STORE) || 'null'); } catch (_) {}
    return d && typeof d === 'object' ? d : null;
  }
  // → { step, any }: the step to open on (the saved one, or an earlier one
  // that is not complete), and whether any answer came back.
  function restore(d) {
    const out = { step: 0, any: false };
    if (!d || !d.v || typeof d.v !== 'object') return out;
    if (!fresh(d.at)) { forget(); return out; }
    SAVED.forEach(k => {
      const v = d.v[k], el = form.elements[k];
      if (typeof v !== 'string') return;
      if (el.tagName) el.value = v;
      else if ([].some.call(el, r => r.value === v)) [].forEach.call(el, r => { r.checked = r.value === v; });
      if (v && k !== 'video_by') out.any = true;
    });
    if (!paged) return out;
    out.step = Math.min(Math.max(0, d.step | 0), steps.length - 1);
    for (let i = 0; i < out.step; i++) {
      if (stepKeys(i).some(k => problem(k)) || (i === 0 && barFails())) { out.step = i; break; }
    }
    return out;
  }

  // Step 1 opens on the form top (title, dates, "3 steps"); steps 2 and 3 on
  // their own heading, so the same intro is not scrolled past three times.
  // For a moment after a move the steps take no taps: a quick second tap on
  // Next would land on a field of the next step and open the keyboard.
  let lockT = 0;
  function showStep(i, move) {
    step = i;
    if (!paged) return checkBar();
    for (let n = 1; n <= i; n++) if (!reached[n]) { reached[n] = true; count('step' + (n + 1)); }
    steps.forEach((s, n) => { s.hidden = n !== i; });
    back.hidden = i === 0;
    next.hidden = i === steps.length - 1;
    send.hidden = i !== steps.length - 1;
    checkBar();
    if (!move) return;
    form.classList.add('moving');
    clearTimeout(lockT);
    lockT = setTimeout(() => form.classList.remove('moving'), 600);
    const head = steps[i].querySelector('.steph');
    (i === 0 ? form : head).scrollIntoView({ block: 'start' });
    head.focus({ preventScroll: true });
  }
  function focusField(k) {
    const i = stepOf(k);
    if (i !== step) showStep(i, false);
    const first = fieldBox(k).querySelector('input,select,textarea');
    if (first) first.focus();
  }
  function goNext() {
    if (sending) return;
    say('');
    if (checkBar()) return;
    const bad = stepKeys(step).filter(k => !validate(k));
    if (bad.length) {
      say('check');
      focusField(bad[0]);
      return;
    }
    showStep(step + 1, true);
    save();
  }
  if (paged) {
    next.addEventListener('click', goNext);
    back.addEventListener('click', () => {
      if (sending) return;
      say('');
      showStep(step - 1, true);
      save();
    });
  }

  // The thanks, after a send or on a later visit. A video still to come by chat
  // brings back what to film, since that list lives in step 3.
  function showThanks(chat, later) {
    form.hidden = true;
    if (thanksChat) {
      thanksChat.hidden = !chat;
      const film = document.getElementById('h-video');
      if (chat && film && !thanksChat.querySelector('.vhelp')) {
        const copy = film.cloneNode(true);
        copy.removeAttribute('id');
        thanksChat.appendChild(copy);
      }
    }
    if (again) again.hidden = !later;
    thanks.hidden = false;
    if (later) return;
    thanks.scrollIntoView({ block: 'center', behavior: 'instant' });
    thanks.focus({ preventScroll: true });
  }
  if (again) again.addEventListener('click', () => {
    forget();
    form.reset();
    KEYS.forEach(k => setErr(k, ''));
    say('');
    sayKeep(false);
    thanks.hidden = true;
    form.hidden = false;
    syncVideo();
    showStep(0, true);
  });

  // During that moment a tap must not move focus off the step heading either.
  form.addEventListener('mousedown', e => { if (form.classList.contains('moving')) e.preventDefault(); });
  form.addEventListener('change', e => {
    const k = e.target.name;
    if (k === 'video_by') syncVideo();
    if (BAR[k]) checkBar();
    if (fieldBox(k) && fieldBox(k).classList.contains('bad')) validate(k);
    clearCheck();
    if (k !== 'website') save();
  });
  form.addEventListener('input', e => {
    const k = e.target.name;
    if (fieldBox(k) && fieldBox(k).classList.contains('bad')) validate(k);
    clearCheck();
    if (k !== 'website') save();
  });
  document.querySelectorAll('[data-apply]').forEach(a => a.addEventListener('click', e => {
    e.preventDefault();
    document.getElementById('apply').scrollIntoView({ block: 'start' });
    setTimeout(() => {
      const first = (paged ? steps[step] : form).querySelector('input,select,textarea');
      if (first && !form.hidden) first.focus({ preventScroll: true });
    }, 350);
  }));

  form.addEventListener('submit', async e => {
    e.preventDefault();
    if (sending) return;
    // Enter in a field before the last step means Next, not Send.
    if (paged && step < steps.length - 1) return goNext();
    say('');
    const bad = KEYS.filter(k => !validate(k));
    if (checkBar()) return showStep(0, true);
    if (bad.length) {
      say('check');
      focusField(bad[0]);
      return;
    }
    const body = { list: form.getAttribute('data-list'), website: form.elements.website.value, src: SRC, for: TAG };
    for (const k of KEYS) body[k] = val(k);
    const chat = byChat();
    if (chat) body.video = '';
    sending = true;
    checkBar();
    send.textContent = M.sending;
    try {
      const r = await fetch('/api/in-depth/apply', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const j = await r.json().catch(() => ({}));
      if (r.ok && j.ok) {
        put({ sent: Date.now(), video_by: chat ? 'chat' : 'link' });
        showThanks(chat, false);
        return;
      }
      if (r.status === 429) say('busy');
      else if (j.error === 'fields' || j.error === 'bar') {
        const fields = (j.fields || []).filter(k => fieldBox(k));
        fields.forEach(k => setErr(k, k === 'video' ? M.link : k === 'email' ? M.email : k === 'consent' ? M.consent : j.error === 'bar' ? M.bar : M.empty));
        say(j.error === 'bar' ? 'bar' : 'check');
        if (fields.length) focusField(fields[0]);
      } else say('server');
    } catch (_) {
      say('server');
    } finally {
      sending = false;
      send.textContent = SEND_LABEL;
      if (!form.hidden) checkBar();
    }
  });

  const saved = load();
  // The source and headline of this visit, or else of the visit the kept answers began on.
  const kept = saved && fresh(saved.at) ? saved : {};
  SRC = code(param('src')) || code(kept.src);
  TAG = [code(param('for')), code(kept.tag)].filter(t => FOR_TAGS.indexOf(t) >= 0)[0] || '';
  count('view');
  if (saved && fresh(saved.sent)) {
    showThanks(saved.video_by === 'chat', true);
    return;
  }
  const at = restore(saved);
  sayKeep(at.any);
  syncVideo();
  showStep(at.step, false);
})();
