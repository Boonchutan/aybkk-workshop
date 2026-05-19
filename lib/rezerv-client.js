/**
 * Minimal Rezerv API client.
 *
 * Auth: the bpShareAccessCookie JWT, sent as an Authorization: Bearer header
 * (NOT as a cookie — verified 2026-05-16). Capture it from Chrome DevTools →
 * Application → Cookies → business.rezerv.co → bpShareAccessCookie → full value.
 * Set as REZERV_TOKEN env var. The JWT carries its own exp (~1 month);
 * when it 401s, grab a fresh one the same way.
 *
 * Response envelope (all endpoints):
 *   { code: 0, message: 'Success', data: { data: [...], hasNextPage, totalPages, currentPage, totalCount } }
 */

const BASE = 'https://business-api.rezerv.co';

function authHeaders() {
  const token = process.env.REZERV_TOKEN;
  if (!token) throw new Error('REZERV_TOKEN env var is not set.');
  return {
    'Accept': 'application/json, text/plain, */*',
    'Referer': 'https://business.rezerv.co/',
    'Origin': 'https://business.rezerv.co',
    'Authorization': `Bearer ${token}`
  };
}

async function get(pathQuery) {
  const r = await fetch(`${BASE}${pathQuery}`, { headers: authHeaders() });
  const text = await r.text();
  let json;
  try { json = JSON.parse(text); } catch { throw new Error(`Rezerv ${r.status} non-JSON: ${text.slice(0, 200)}`); }
  if (json.error_code === 401 || r.status === 401) {
    throw new Error('Rezerv token expired/invalid (401). Grab a fresh bpShareAccessCookie.');
  }
  if (json.code !== 0 && json.code !== undefined) {
    throw new Error(`Rezerv API error: ${json.message || JSON.stringify(json).slice(0, 200)}`);
  }
  return json;
}

/** Generic paginated collector over the standard envelope */
async function paginate(buildPath, { perPage = 100, maxPages = 100 } = {}) {
  const out = [];
  let page = 1;
  while (page <= maxPages) {
    const json = await get(buildPath(page, perPage));
    const d = json.data || {};
    const list = d.data || [];
    out.push(...list);
    if (!d.hasNextPage) break;
    page++;
  }
  return out;
}

/** All customers. status='' for all, 'Active' for active only. */
async function listCustomers({ status = '', perPage = 100 } = {}) {
  return paginate((page, pp) => {
    const params = new URLSearchParams({
      Keyword: '', Status: status, JoinedDate: '',
      SortBy: 'joinedDate', IsDesc: 'true',
      CountPerPage: String(pp), CurrentPage: String(page), rezervPass: ''
    });
    return `/v1/customers?${params}`;
  }, { perPage });
}

/**
 * Roster for ONE scheduled class instance (scheduleId is per-day).
 * bookingStatus 'Booked' for booked; '' for all.
 */
async function getClassRoster(scheduleId, date, opts = {}) {
  return paginate((page, pp) => {
    const params = new URLSearchParams({
      Search: '', Date: date,
      BookingStatus: opts.bookingStatus || 'Booked',
      ScheduleStatus: opts.scheduleStatus || '',
      FilterStatus: '', StartTime: opts.startTime || '',
      CountPerPage: String(pp), CurrentPage: String(page),
      SortBy: '', IsDesc: 'true'
    });
    return `/v1/bookings/class-detail-by-status/${scheduleId}?${params}`;
  }, { perPage: opts.perPage || 100 });
}

/** Raw GET passthrough for discovery/debugging */
async function raw(pathQuery) { return get(pathQuery); }

function attendeeEmail(row) {
  for (const k of ['email', 'Email', 'customerEmail', 'CustomerEmail']) {
    if (row[k]) return String(row[k]).toLowerCase().trim();
  }
  if (row.customer) for (const k of ['email', 'Email']) {
    if (row.customer[k]) return String(row.customer[k]).toLowerCase().trim();
  }
  return null;
}

function attendeeName(row) {
  return row.name || row.fullName || row.customerName || row.CustomerName ||
    (row.customer && (row.customer.name || row.customer.fullName)) || null;
}

module.exports = {
  listCustomers, getClassRoster, raw,
  attendeeEmail, attendeeName
};
