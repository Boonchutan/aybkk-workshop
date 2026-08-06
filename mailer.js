// mailer.js — transactional email for AYBKK.
//
// Two rules, both learned the hard way elsewhere in this repo:
//
// 1. Inert without credentials. The shala must be able to sell a pass and book a
//    class whether or not mail is configured, exactly as payments fall back to a
//    link when the gateway keys are missing.
// 2. Never throw. A send failure is logged and swallowed. Nothing a mail server
//    does should be able to fail a student's booking.
//
// Provider is Resend over plain fetch — no dependency, same shape as the
// Telegram notifier in shop-api.js. MAIL_DRY_RUN=1 records to an in-memory
// outbox instead of sending, which is how the tests inspect what would go out.

const RESEND_ENDPOINT = 'https://api.resend.com/emails';

const outbox = [];                       // dry-run only; never grows in production

function mailStatus() {
  const key = String(process.env.RESEND_API_KEY || '').trim();
  const from = String(process.env.MAIL_FROM || '').trim();
  if (String(process.env.MAIL_DRY_RUN || '') === '1') return { mode: 'dry-run' };
  const missing = [];
  if (!key) missing.push('RESEND_API_KEY');
  if (!from) missing.push('MAIL_FROM');
  return missing.length ? { mode: 'none', missing } : { mode: 'resend' };
}

async function sendMail({ to, subject, html, text, tag }) {
  const st = mailStatus();
  if (!to || !subject) return { sent: false, reason: 'missing recipient or subject' };

  if (st.mode === 'dry-run') {
    outbox.push({ to, subject, html, text, tag, at: new Date().toISOString() });
    return { sent: true, dryRun: true };
  }
  if (st.mode !== 'resend') {
    console.log(`[mail] not configured (${(st.missing || []).join(', ')}) — would send "${subject}" to ${to}`);
    return { sent: false, reason: 'not configured' };
  }

  try {
    const r = await fetch(RESEND_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: process.env.MAIL_FROM,
        to: [to],
        subject,
        html,
        text,                                  // Thai and CJK inboxes dislike HTML-only
        ...(process.env.MAIL_REPLY_TO ? { reply_to: [process.env.MAIL_REPLY_TO] } : {}),
      }),
    });
    if (!r.ok) {
      const body = await r.text().catch(() => '');
      console.error(`[mail] ${tag || 'send'} failed ${r.status}: ${body.slice(0, 200)}`);
      return { sent: false, reason: `http ${r.status}` };
    }
    return { sent: true };
  } catch (e) {
    console.error(`[mail] ${tag || 'send'} threw: ${e.message}`);
    return { sent: false, reason: e.message };
  }
}

// ── templates ───────────────────────────────────────────────────────────────
// Keyed by language so adding Thai/Chinese/Russian is data, not code. English
// is the fallback for any language we do not have yet.

const baht = n => '฿' + Number(n || 0).toLocaleString('en-US');
const esc = s => String(s ?? '').replace(/[&<>"]/g,
  c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function shell(bodyHtml) {
  return `<div style="font-family:-apple-system,'Helvetica Neue',sans-serif;
    max-width:520px;margin:0 auto;color:#17121a;line-height:1.6">
    <div style="background:#17121a;color:#fdf7fa;padding:22px;text-align:center;border-radius:8px 8px 0 0">
      <div style="font-size:28px;letter-spacing:.06em">AYBKK</div>
      <div style="font-size:13px;color:#f0d6e3;margin-top:4px">Ashtanga Yoga Center of Bangkok</div>
    </div>
    <div style="border:1px solid #eadfe6;border-top:none;border-radius:0 0 8px 8px;padding:22px">
      ${bodyHtml}
    </div>
    <p style="color:#8b7f90;font-size:12px;text-align:center;margin-top:14px">
      S31 Hotel, Sukhumvit 31, Bangkok</p>
  </div>`;
}

const TEMPLATES = {
  receipt: {
    en: ({ name, product, amount, base, fee, refno, link }) => ({
      subject: `Your AYBKK pass — ${product}`,
      text: [
        `Hello ${name},`, '',
        `Your ${product} is active.`,
        `Paid ${baht(amount)} (${baht(base)} + ${baht(fee)} online payment fee).`,
        `Reference ${refno}.`, '',
        `Book your classes here: ${link}`,
        'That link signs you in once. If you ever lose your place, use',
        '"Email me a link" on the booking page and we will send a new one.', '',
        'See you in the shala.',
      ].join('\n'),
      html: shell(`
        <p>Hello ${esc(name)},</p>
        <p>Your <b>${esc(product)}</b> is active.</p>
        <table style="width:100%;font-size:14px;margin:16px 0">
          <tr><td style="color:#6b5d70">Package</td><td align="right">${esc(product)}</td></tr>
          <tr><td style="color:#6b5d70">Price</td><td align="right">${baht(base)}</td></tr>
          <tr><td style="color:#6b5d70">Online payment fee</td><td align="right">${baht(fee)}</td></tr>
          <tr><td style="padding-top:8px"><b>Paid</b></td>
              <td align="right" style="padding-top:8px"><b>${baht(amount)}</b></td></tr>
          <tr><td style="color:#6b5d70">Reference</td><td align="right">${esc(refno)}</td></tr>
        </table>
        <p style="text-align:center;margin:22px 0">
          <a href="${esc(link)}" style="background:#5c2160;color:#fdf7fa;text-decoration:none;
             padding:12px 26px;border-radius:8px;display:inline-block;font-weight:600">Book a class</a></p>
        <p style="font-size:13px;color:#6b5d70">That button signs you in once, on any phone.
        If you ever lose your place, use <b>Email me a link</b> on the booking page.</p>`),
    }),
  },

  signin: {
    en: ({ name, link }) => ({
      subject: 'Your AYBKK sign-in link',
      text: [
        `Hello ${name},`, '',
        'Open this link to get back to your pass and bookings:',
        link, '',
        'It works once and expires in 30 minutes.',
        'If you did not ask for this, you can ignore it — nothing has changed.',
      ].join('\n'),
      html: shell(`
        <p>Hello ${esc(name)},</p>
        <p>Here is your way back to your pass and bookings.</p>
        <p style="text-align:center;margin:22px 0">
          <a href="${esc(link)}" style="background:#5c2160;color:#fdf7fa;text-decoration:none;
             padding:12px 26px;border-radius:8px;display:inline-block;font-weight:600">Open my pass</a></p>
        <p style="font-size:13px;color:#6b5d70">It works once and expires in 30 minutes.
        If you did not ask for this, ignore it — nothing has changed.</p>`),
    }),
  },
};

// Falls back to English for any language not written yet, rather than sending
// nothing. A student getting English is a small failure; silence is a big one.
function render(kind, lang, data) {
  const set = TEMPLATES[kind];
  if (!set) throw new Error(`unknown mail template: ${kind}`);
  return (set[lang] || set.en)(data);
}

module.exports = { sendMail, mailStatus, render, outbox };
