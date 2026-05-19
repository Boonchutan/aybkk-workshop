#!/usr/bin/env node
/**
 * AYBKK LINE Broadcast — Phase 1 MVP
 *
 * Sends a class photo (and optional caption) to every student who:
 *   1. has linked their LINE account to AYBKK (Neo4j: Student-[:HAS_LINE]->LineAccount)
 *   2. is in today's attendee list (provided as emails)
 *
 * Usage:
 *   # List everyone currently following the LINE Official Account (no push)
 *   node aybkk-line-broadcast.js --list-followers
 *
 *   # Push a test photo to a single LINE user ID (skip Neo4j lookup)
 *   node aybkk-line-broadcast.js --photo-url https://... --uid Uxxxxxx --caption "test"
 *
 *   # Real broadcast — push to all linked LINE users among given attendee emails
 *   node aybkk-line-broadcast.js --photo-url https://... --emails "a@b.com,c@d.com" \
 *       --caption "Mysore class — May 15"
 *
 * Notes:
 *   - photo URL must be HTTPS, public, and return image/* (LINE rejects HTML wrappers).
 *   - LINE Official Account free tier: 200 messages/month. Multicast counts as N.
 *   - Students must have followed the bot first (push to non-follower silently fails).
 */

require('dotenv').config();
const neo4j = require('neo4j-driver');

const LINE_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const NEO4J_URI = process.env.NEO4J_URI;
const NEO4J_USER = process.env.NEO4J_USER;
const NEO4J_PASS = process.env.NEO4J_PASSWORD;

if (!LINE_TOKEN) {
  console.error('Missing LINE_CHANNEL_ACCESS_TOKEN in .env');
  process.exit(1);
}

const args = parseArgs(process.argv.slice(2));

(async () => {
  if (args['list-followers']) return listFollowers();
  if (args.uid) return pushToUid(args.uid, args['photo-url'], args.caption);
  if (args['all-active']) return broadcastAllActive(args['photo-url'], args.caption);
  if (args.emails) return broadcastByEmails(args.emails, args['photo-url'], args.caption);
  console.error('Need one of: --list-followers | --uid <U...> | --all-active | --emails <a@b,c@d>');
  process.exit(1);
})().catch(err => { console.error('FATAL:', err.message); process.exit(1); });

// Broadcast to every active member who has linked + is following LINE.
// This is the operational daily mode that does not need the Rezerv
// per-class roster endpoint.
async function broadcastAllActive(photoUrl, caption) {
  if (!NEO4J_URI) throw new Error('Missing NEO4J_URI');
  const driver = neo4j.driver(NEO4J_URI, neo4j.auth.basic(NEO4J_USER, NEO4J_PASS));
  const session = driver.session();
  let targets;
  try {
    const result = await session.run(
      `MATCH (s:Student)-[:HAS_LINE]->(la:LineAccount)
       WHERE la.followedBot = true AND la.unfollowedAt IS NULL
         AND (s.rezervStatus = 'active' OR (s)-[:HAS_MEMBERSHIP]->(:Membership {status:'active'}))
       RETURN DISTINCT s.name AS name, la.uid AS uid`
    );
    targets = result.records.map(r => ({ name: r.get('name'), uid: r.get('uid') }));
  } finally {
    await session.close();
    await driver.close();
  }
  if (!targets.length) { console.log('No linked active members yet. Nothing to push.'); return; }
  const messages = buildMessages(photoUrl, caption);
  console.log(`Pushing to ${targets.length} linked active members…`);
  let ok = 0, fail = 0;
  for (const t of targets) {
    const r = await linePush(t.uid, messages);
    if (r.ok) { ok++; console.log(`  ✓ ${t.name}`); }
    else { fail++; console.log(`  ✗ ${t.name} — ${r.status} ${r.body}`); }
  }
  console.log(`\nDone. Sent: ${ok}  Failed: ${fail}`);
}

// ---------- LINE API ----------

async function lineGet(path) {
  const r = await fetch(`https://api.line.me/v2/bot${path}`, {
    headers: { Authorization: `Bearer ${LINE_TOKEN}` }
  });
  if (!r.ok) throw new Error(`LINE GET ${path} → ${r.status} ${await r.text()}`);
  return r.json();
}

async function linePush(uid, messages) {
  const r = await fetch('https://api.line.me/v2/bot/message/push', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${LINE_TOKEN}` },
    body: JSON.stringify({ to: uid, messages })
  });
  return { ok: r.ok, status: r.status, body: r.ok ? null : await r.text() };
}

function buildMessages(photoUrl, caption) {
  const msgs = [];
  if (caption) msgs.push({ type: 'text', text: caption });
  if (photoUrl) {
    msgs.push({
      type: 'image',
      originalContentUrl: photoUrl,
      previewImageUrl: photoUrl
    });
  }
  if (!msgs.length) throw new Error('Need --photo-url and/or --caption');
  return msgs;
}

// ---------- Modes ----------

async function listFollowers() {
  // Paginated: /v2/bot/followers/ids returns up to 1000 per page
  let next = '';
  const ids = [];
  do {
    const data = await lineGet(`/followers/ids${next ? `?start=${next}` : ''}`);
    ids.push(...data.userIds);
    next = data.next || '';
  } while (next);

  console.log(`Followers: ${ids.length}`);
  for (const id of ids) {
    try {
      const profile = await lineGet(`/profile/${id}`);
      console.log(`  ${id}  ${profile.displayName}`);
    } catch (e) {
      console.log(`  ${id}  (profile fetch failed: ${e.message})`);
    }
  }
}

async function pushToUid(uid, photoUrl, caption) {
  const messages = buildMessages(photoUrl, caption);
  console.log(`→ pushing to ${uid}…`);
  const result = await linePush(uid, messages);
  if (result.ok) console.log('  ✓ sent');
  else console.log(`  ✗ ${result.status} ${result.body}`);
}

async function broadcastByEmails(emailsCsv, photoUrl, caption) {
  if (!NEO4J_URI) throw new Error('Missing NEO4J_URI for email→UID lookup');
  const emails = emailsCsv.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  if (!emails.length) throw new Error('No emails after parsing --emails');

  const driver = neo4j.driver(NEO4J_URI, neo4j.auth.basic(NEO4J_USER, NEO4J_PASS));
  const session = driver.session();

  let matches;
  try {
    const result = await session.run(
      `UNWIND $emails AS email
       MATCH (s:Student) WHERE toLower(s.email) = email
       OPTIONAL MATCH (s)-[:HAS_LINE]->(la:LineAccount)
       WHERE la.followedBot = true AND la.unfollowedAt IS NULL
       RETURN email, s.name AS name, la.uid AS uid`,
      { emails }
    );
    matches = result.records.map(r => ({
      email: r.get('email'),
      name: r.get('name'),
      uid: r.get('uid')
    }));
  } finally {
    await session.close();
    await driver.close();
  }

  const linked = matches.filter(m => m.uid);
  const unlinked = matches.filter(m => m.name && !m.uid);
  const notFound = emails.filter(e => !matches.some(m => m.email === e));

  console.log(`Attendees: ${emails.length}`);
  console.log(`  Linked LINE: ${linked.length}`);
  console.log(`  Has profile, no LINE: ${unlinked.length}`);
  console.log(`  Not in Neo4j: ${notFound.length}`);

  if (unlinked.length) {
    console.log('\nUnlinked (need to add LINE bot):');
    unlinked.forEach(m => console.log(`  - ${m.name} <${m.email}>`));
  }
  if (notFound.length) {
    console.log('\nUnknown emails:');
    notFound.forEach(e => console.log(`  - ${e}`));
  }

  if (!linked.length) {
    console.log('\nNothing to push.');
    return;
  }

  const messages = buildMessages(photoUrl, caption);
  console.log(`\nPushing to ${linked.length} students…`);

  const results = { ok: 0, fail: 0 };
  for (const m of linked) {
    const r = await linePush(m.uid, messages);
    if (r.ok) {
      results.ok++;
      console.log(`  ✓ ${m.name}`);
    } else {
      results.fail++;
      console.log(`  ✗ ${m.name} — ${r.status} ${r.body}`);
    }
  }
  console.log(`\nDone. Sent: ${results.ok}  Failed: ${results.fail}`);
}

// ---------- args ----------

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) out[key] = true;
    else { out[key] = next; i++; }
  }
  return out;
}
