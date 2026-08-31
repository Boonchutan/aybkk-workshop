// Pure arithmetic tests for the partner split rules. No database, no server —
// run with: node test/partner-money.test.js
const {
  partnerCut, splitDaily, splitEvent, netTransfer, fen, formatFen, DEFAULT_PCTS,
} = require('../partner-money.js');

let PASS = 0, FAIL = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { PASS++; console.log(`  ✓ ${name}`); }
  else { FAIL++; console.log(`  ✗ ${name} ${extra}`); }
};

console.log('\n— the worked example from the deal, to the fen —');
// 50 students × ¥4,000 = ¥200,000. Teacher 60% → 120,000. Host 40% → 80,000.
// Expenses 10,000 → host net 70,000. AYBKK 49,000 / NaSaDi 21,000.
{
  const r = splitEvent(fen(200000), fen(10000),
    { eventTeacherPctX100: 6000, hostPartnerPctX100: 3000 });
  ok('teacher gets ¥120,000', r.teacherFen === fen(120000), formatFen(r.teacherFen));
  ok('host share ¥80,000', r.hostShareFen === fen(80000));
  ok('host net ¥70,000 after expenses', r.hostNetFen === fen(70000));
  ok('AYBKK ¥49,000', r.aybkkFen === fen(49000), formatFen(r.aybkkFen));
  ok('NaSaDi ¥21,000', r.partnerFen === fen(21000), formatFen(r.partnerFen));
  ok('shares sum exactly to host net', r.aybkkFen + r.partnerFen === r.hostNetFen);
}
{
  const r = splitEvent(fen(200000), 0,
    { eventTeacherPctX100: 6000, hostPartnerPctX100: 3000 });
  ok('zero expenses: AYBKK ¥56,000', r.aybkkFen === fen(56000));
  ok('zero expenses: NaSaDi ¥24,000', r.partnerFen === fen(24000));
}

console.log('\n— daily split —');
{
  const r = splitDaily(fen(100000), { dailyPartnerPctX100: 3000 });
  ok('¥100,000 → NaSaDi ¥30,000', r.partnerFen === fen(30000));
  ok('¥100,000 → AYBKK ¥70,000', r.aybkkFen === fen(70000));
}

console.log('\n— the fragment always stays with AYBKK —');
{
  // 101 fen at 30%: raw partner share 30.3 fen → partner 30, AYBKK 71.
  const r = splitDaily(101, { dailyPartnerPctX100: 3000 });
  ok('30.3 raw → partner 30 fen', r.partnerFen === 30, String(r.partnerFen));
  ok('AYBKK takes the fragment (71)', r.aybkkFen === 71);
  ok('sum is exact', r.partnerFen + r.aybkkFen === 101);
}
{
  // THE decided case: raw partner share exactly x.5 fen. 105 fen at 30% = 31.5.
  // Boonchu's ruling: the fragment stays with AYBKK, so partner gets 31, not 32.
  const r = splitDaily(105, { dailyPartnerPctX100: 3000 });
  ok('exactly .5 fen goes to AYBKK, not NaSaDi', r.partnerFen === 31, String(r.partnerFen));
  ok('AYBKK 74', r.aybkkFen === 74);
}
{
  // 1 fen at 30%: partner 0, AYBKK 1. Nothing is ever minted or lost.
  const r = splitDaily(1, { dailyPartnerPctX100: 3000 });
  ok('1 fen: partner 0, AYBKK 1', r.partnerFen === 0 && r.aybkkFen === 1);
}
{
  // Sweep: for every amount 0..9999 the shares are whole fen and sum exactly.
  let good = true;
  for (let g = 0; g <= 9999; g++) {
    const r = splitDaily(g, { dailyPartnerPctX100: 3000 });
    if (r.partnerFen + r.aybkkFen !== g || !Number.isInteger(r.partnerFen)) { good = false; break; }
  }
  ok('10,000-amount sweep: always whole fen, always sums to base', good);
}

console.log('\n— refund-heavy (negative) months —');
{
  // Gross −105 fen at 30%: partner gives back 31 whole fen (not 32) — the
  // fragment still lands on AYBKK, symmetrically.
  const r = splitDaily(-105, { dailyPartnerPctX100: 3000 });
  ok('negative month: partner −31', r.partnerFen === -31, String(r.partnerFen));
  ok('negative month: AYBKK −74', r.aybkkFen === -74);
  ok('negative month sums exactly', r.partnerFen + r.aybkkFen === -105);
}

console.log('\n— net transfer on the 1st —');
{
  // NaSaDi collected ¥60,000; her earned share is ¥30,000 → she transfers ¥30,000.
  const n = netTransfer({ collectedByPartnerFen: fen(60000), partnerDailyFen: fen(30000) });
  ok('partner collected more than her share → she transfers', n === fen(30000), formatFen(n));
}
{
  // NaSaDi collected ¥10,000 but earned ¥30,000 → AYBKK transfers ¥20,000 to her.
  const n = netTransfer({ collectedByPartnerFen: fen(10000), partnerDailyFen: fen(30000) });
  ok('partner collected less than her share → AYBKK transfers (negative)', n === -fen(20000));
}

console.log('\n— guard rails —');
{
  let threw = false;
  try { splitDaily(100.5, { dailyPartnerPctX100: 3000 }); } catch (_) { threw = true; }
  ok('a float amount is refused outright', threw);
  threw = false;
  try { splitDaily(100, { dailyPartnerPctX100: 30 * 1000 }); } catch (_) { threw = true; }
  ok('a percentage over 100.00% is refused', threw);
  threw = false;
  try { partnerCut(100, 30.5); } catch (_) { threw = true; }
  ok('a fractional percentage is refused', threw);
}
{
  ok('defaults are the deal: daily 70/30', DEFAULT_PCTS.daily_aybkk_pct === 7000
    && DEFAULT_PCTS.daily_partner_pct === 3000);
  ok('formatFen renders fen as yuan', formatFen(fen(49000)) === '¥49,000.00'
    && formatFen(-105) === '-¥1.05', formatFen(-105));
}

console.log(`\n${PASS} passed, ${FAIL} failed`);
process.exit(FAIL ? 1 : 0);
