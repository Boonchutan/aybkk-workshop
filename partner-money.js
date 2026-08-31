// partner-money.js — the split arithmetic for partner locations (AYBKK Chengdu
// inside NaSaDi first). Pure functions, no I/O, so every rule here is pinned by
// test/partner-money.test.js before any endpoint uses it.
//
// Non-negotiables, agreed with Boonchu 30 Aug 2026:
// - Money is INTEGER MINOR UNITS (fen). Floats never touch an amount.
// - Percentages are integer hundredths of a percent: 7000 = 70.00%.
// - Rounding happens once, at the final share step. The partner's share is
//   always whole fen with the fraction dropped, so any sub-fen remainder stays
//   on the AYBKK side — "fractions of a fen stay with AYBKK, always."
// - Shares sum EXACTLY to the base by construction: one side is computed, the
//   other is base minus it.

const PCT_BASE = 10000;                       // 10000 = 100.00%

function assertFen(n, name) {
  if (!Number.isSafeInteger(n)) throw new Error(`${name} must be an integer amount in fen, got ${n}`);
}
function assertPct(n, name) {
  if (!Number.isSafeInteger(n) || n < 0 || n > PCT_BASE) {
    throw new Error(`${name} must be an integer 0..${PCT_BASE} (hundredths of a percent), got ${n}`);
  }
}

// The partner's cut of any base amount. Fraction of a fen always drops toward
// zero — for a negative base (a refund-heavy month) the partner gives back
// whole fen only, so the fragment still lands on AYBKK.
function partnerCut(baseFen, partnerPctX100) {
  assertFen(baseFen, 'base');
  assertPct(partnerPctX100, 'partner pct');
  const abs = Math.abs(baseFen) * partnerPctX100;
  if (!Number.isSafeInteger(abs)) throw new Error('amount too large');
  const cut = Math.floor(abs / PCT_BASE);
  return baseFen < 0 ? -cut : cut;
}

// Daily program income for a month.
//   gross_daily = confirmed payments minus refunds (the caller sums; refunds
//   are negative rows, so a plain SUM is already correct)
function splitDaily(grossFen, { dailyPartnerPctX100 }) {
  const partnerFen = partnerCut(grossFen, dailyPartnerPctX100);
  return { grossFen, partnerFen, aybkkFen: grossFen - partnerFen };
}

// Event waterfall (Phase 2 uses this end to end; the function ships now so the
// arithmetic is settled and testable before any event exists).
//   teacher first, then expenses off the host share, then the host split.
function splitEvent(grossFen, expensesFen,
  { eventTeacherPctX100, hostPartnerPctX100 }) {
  assertFen(expensesFen, 'expenses');
  const teacherFen = partnerCut(grossFen, eventTeacherPctX100); // same drop-the-fraction rule
  const hostShareFen = grossFen - teacherFen;
  const hostNetFen = hostShareFen - expensesFen;
  const partnerFen = partnerCut(hostNetFen, hostPartnerPctX100);
  return {
    grossFen, teacherFen, hostShareFen, expensesFen, hostNetFen,
    partnerFen, aybkkFen: hostNetFen - partnerFen,
  };
}

// Who transfers what on the 1st. Positive = the partner transfers to AYBKK.
//   The partner keeps what they collected; their earned share is deducted from
//   it; whatever is left over is AYBKK's money sitting in the partner's account.
function netTransfer({ collectedByPartnerFen, partnerDailyFen, partnerEventFen = 0 }) {
  assertFen(collectedByPartnerFen, 'collectedByPartner');
  assertFen(partnerDailyFen, 'partnerDaily');
  assertFen(partnerEventFen, 'partnerEvent');
  return collectedByPartnerFen - (partnerDailyFen + partnerEventFen);
}

// Display helpers. Formatting is the ONLY place fen meet a decimal point.
function fen(yuan) { return Math.round(yuan * 100); }          // test/seed convenience
function formatFen(n, currency = '¥') {
  const sign = n < 0 ? '-' : '';
  const abs = Math.abs(n);
  const whole = Math.floor(abs / 100).toLocaleString('en-US');
  return `${sign}${currency}${whole}.${String(abs % 100).padStart(2, '0')}`;
}

const DEFAULT_PCTS = {
  daily_aybkk_pct: 7000, daily_partner_pct: 3000,
  event_teacher_pct: 6000,
  host_aybkk_pct: 7000, host_partner_pct: 3000,
};

module.exports = {
  PCT_BASE, DEFAULT_PCTS,
  partnerCut, splitDaily, splitEvent, netTransfer,
  fen, formatFen,
};
