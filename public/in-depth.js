// In-Depth Mysore application form. <html lang> picks the messages, and the
// form's data-list names the list the application joins. Each page has only
// the questions its list asks; the checks below run on those alone.
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
  let msgKey = '';
  function say(k) { msgKey = k; formMsg.textContent = k ? M[k] : ''; }

  const KEYS = ['name', 'email', 'contact', 'country', 'call_lang', 'primary', 'rooms', 'dates', 'years', 'mornings', 'series',
    'teaching', 'teach', 'why', 'stuck', 'injury', 'video', 'heard', 'question', 'consent'].filter(k => form.elements[k]);
  const OPTIONAL = ['teach', 'injury', 'heard', 'question'];
  const BAR = { primary: v => v === 'not_yet', rooms: v => v === 'not_yet', dates: v => v === 'no' };
  const val = k => {
    const el = form.elements[k];
    if (!el) return '';
    if (el.type === 'checkbox') return el.checked;
    return String(el.value || '').trim();
  };
  const fieldBox = k => form.querySelector(`.f[data-f="${k}"]`);
  function setErr(k, text) {
    const box = fieldBox(k), e = document.getElementById('e-' + k);
    if (!box || !e) return;
    e.textContent = text || '';
    box.classList.toggle('bad', !!text);
    box.querySelectorAll('input,select,textarea').forEach(i => i.setAttribute('aria-invalid', text ? 'true' : 'false'));
  }
  function validate(k) {
    const v = val(k), el = form.elements[k];
    let e = '';
    if (k === 'consent') e = v ? '' : M.consent;
    else if (!OPTIONAL.includes(k) && v === '') e = M.empty;
    else if (k === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) e = M.email;
    else if (k === 'video' && !/https:\/\/[^\s]+\.[^\s]+/i.test(v)) e = M.link;
    else if (k === 'years' && (!/^\d{1,2}$/.test(v) || +v > 60)) e = M.empty;
    else if (el && el.maxLength > 0 && [...v].length > el.maxLength) e = M.long;
    setErr(k, e);
    return !e;
  }
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
    if (any) say('bar'); else if (msgKey === 'bar') say('');
    return any;
  }
  const clearCheck = () => { if (msgKey === 'check' && !form.querySelector('.f.bad')) say(''); };
  form.addEventListener('change', e => {
    const k = e.target.name;
    if (BAR[k]) checkBar();
    if (fieldBox(k) && fieldBox(k).classList.contains('bad')) validate(k);
    clearCheck();
  });
  form.addEventListener('input', e => {
    const k = e.target.name;
    if (fieldBox(k) && fieldBox(k).classList.contains('bad')) validate(k);
    clearCheck();
  });
  document.querySelectorAll('[data-apply]').forEach(a => a.addEventListener('click', e => {
    e.preventDefault();
    document.getElementById('apply').scrollIntoView({ block: 'start' });
    setTimeout(() => form.elements.name.focus({ preventScroll: true }), 350);
  }));

  form.addEventListener('submit', async e => {
    e.preventDefault();
    say('');
    const bad = KEYS.filter(k => !validate(k));
    if (checkBar()) return;
    if (bad.length) {
      say('check');
      const first = fieldBox(bad[0]).querySelector('input,select,textarea');
      if (first) first.focus();
      return;
    }
    const body = { list: form.dataset.list, website: form.elements.website.value };
    for (const k of KEYS) body[k] = val(k);
    send.disabled = true;
    const label = send.textContent;
    send.textContent = M.sending;
    try {
      const r = await fetch('/api/in-depth/apply', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const j = await r.json().catch(() => ({}));
      if (r.ok && j.ok) {
        form.hidden = true;
        const ty = document.getElementById('thanks');
        ty.hidden = false;
        ty.scrollIntoView({ block: 'center', behavior: 'instant' });
        ty.focus({ preventScroll: true });
        return;
      }
      if (r.status === 429) say('busy');
      else if (j.error === 'fields' || j.error === 'bar') {
        (j.fields || []).forEach(k => setErr(k, k === 'video' ? M.link : k === 'email' ? M.email : k === 'consent' ? M.consent : j.error === 'bar' ? M.bar : M.empty));
        say(j.error === 'bar' ? 'bar' : 'check');
      } else say('server');
    } catch (_) {
      say('server');
    } finally {
      send.textContent = label;
      if (!form.hidden) checkBar();
    }
  });
  checkBar();
})();
