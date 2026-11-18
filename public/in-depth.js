// In-Depth Mysore application form. <html lang> picks the messages, and the
// form's data-list names the list the application joins. Each page has only
// the questions its list asks; the checks below run on those alone.
// The form shows one .step at a time: fit first (the bar questions stop a "not
// yet" before any contact detail is asked), then the written answers, then
// contact and video. With JS off every step shows, as one long form.
(() => {
  const MSG = {
    en: { empty: 'Please fill this in.', email: 'Please check the email address.', link: 'Please paste a link that starts with https://',
      consent: 'Please tick the box to send.', long: 'This is too long. Please make it shorter.', check: 'Please check the answers marked above.',
      bar: 'This course needs a yes on the questions marked above.', sending: 'Sending…',
      busy: 'Too many tries from this connection. Please try again in an hour, or message LINE @aybkk.',
      server: 'That did not send. Please try again, or message LINE @aybkk.' },
    zh: { empty: '请填写这一项。', email: '请检查邮箱地址。', link: '请贴上以 https:// 开头的链接。',
      consent: '请勾选同意后再发送。', long: '内容太长，请写短一些。', check: '请检查上面标出的几项。',
      bar: '上面标出的问题，这个课程需要你的答案是“是”或“能”。', sending: '正在发送…',
      busy: '这个网络尝试的次数太多了。请一小时后再试，或加微信 aybkkwechat。',
      server: '没有发送成功。请再试一次，或加微信 aybkkwechat。' },
  };
  const form = document.getElementById('form');
  if (!form) return;
  const M = MSG[document.documentElement.lang.startsWith('zh') ? 'zh' : 'en'];
  const send = document.getElementById('send'), formMsg = document.getElementById('formmsg');
  const back = document.getElementById('back'), next = document.getElementById('next');
  let msgKey = '';
  function say(k) { msgKey = k; formMsg.textContent = k ? M[k] : ''; }

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
    if (!OPTIONAL.includes(k) && v === '') return M.empty;
    if (k === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return M.email;
    if (k === 'video' && !/https:\/\/[^\s]+\.[^\s]+/i.test(v)) return M.link;
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
  function checkBar() {
    let any = false;
    for (const [k, isBad] of Object.entries(BAR)) {
      const box = fieldBox(k);
      if (!box) continue;
      const b = isBad(val(k));
      box.querySelector('.barnote').hidden = !b;
      any = any || b;
    }
    send.disabled = any;
    if (next) next.disabled = any;
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

  // Answers wait on this phone, never on the server, until Send: WeChat often
  // reloads the page when someone leaves it to film the video. Never the
  // honeypot, and not the consent tick, which is given fresh each time.
  const STORE = 'aybkk_apply_' + form.getAttribute('data-list');
  const KEEP_MS = 30 * 24 * 3600 * 1000;
  const SAVED = KEYS.filter(k => k !== 'consent');
  let step = 0;
  function save() {
    const v = {};
    SAVED.forEach(k => { v[k] = String(form.elements[k].value || ''); });
    try { localStorage.setItem(STORE, JSON.stringify({ at: Date.now(), step, v })); } catch (_) {}
  }
  function forget() { try { localStorage.removeItem(STORE); } catch (_) {} }
  // → the step to open on: the saved one, or an earlier one that is not complete.
  function restore() {
    let d = null;
    try { d = JSON.parse(localStorage.getItem(STORE) || 'null'); } catch (_) {}
    if (!d || typeof d !== 'object' || !d.v || typeof d.v !== 'object') return 0;
    if (!(Date.now() - d.at < KEEP_MS)) { forget(); return 0; }
    SAVED.forEach(k => {
      const v = d.v[k], el = form.elements[k];
      if (typeof v !== 'string') return;
      if (el.tagName) el.value = v;
      else if (v) [].forEach.call(el, r => { r.checked = r.value === v; });
    });
    if (!paged) return 0;
    const saved = Math.min(Math.max(0, d.step | 0), steps.length - 1);
    for (let i = 0; i < saved; i++) {
      if (stepKeys(i).some(k => problem(k)) || (i === 0 && barFails())) return i;
    }
    return saved;
  }

  function showStep(i, move) {
    step = i;
    if (!paged) return checkBar();
    steps.forEach((s, n) => { s.hidden = n !== i; });
    back.hidden = i === 0;
    next.hidden = i === steps.length - 1;
    send.hidden = i !== steps.length - 1;
    checkBar();
    if (!move) return;
    form.scrollIntoView({ block: 'start' });
    steps[i].querySelector('.steph').focus({ preventScroll: true });
  }
  function focusField(k) {
    const i = stepOf(k);
    if (i !== step) showStep(i, false);
    const first = fieldBox(k).querySelector('input,select,textarea');
    if (first) first.focus();
  }
  function goNext() {
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
      say('');
      showStep(step - 1, true);
      save();
    });
  }

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
    const body = { list: form.getAttribute('data-list'), website: form.elements.website.value };
    for (const k of KEYS) body[k] = val(k);
    if (byChat()) body.video = '';
    send.disabled = true;
    const label = send.textContent;
    send.textContent = M.sending;
    try {
      const r = await fetch('/api/in-depth/apply', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const j = await r.json().catch(() => ({}));
      if (r.ok && j.ok) {
        forget();
        form.hidden = true;
        const ty = document.getElementById('thanks'), chat = document.getElementById('thanks-chat');
        if (chat) chat.hidden = body.video_by !== 'chat';
        ty.hidden = false;
        ty.scrollIntoView({ block: 'center', behavior: 'instant' });
        ty.focus({ preventScroll: true });
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
      send.textContent = label;
      if (!form.hidden) checkBar();
    }
  });

  const at = restore();
  syncVideo();
  showStep(at, false);
})();
