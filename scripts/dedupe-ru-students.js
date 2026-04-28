/**
 * Merge duplicate Russia WS Student nodes.
 *
 * Groups Student nodes (location='russia' OR id LIKE 'ru-%') by telegramChatId,
 * then by lowercased email for any without a chatId. For each group with >1:
 *   - keeper = node with most journal entries (HAS_PRACTICE_LOG + HAS_SELF_ASSESSMENT),
 *     ties broken by most recent createdAt
 *   - reattach all outgoing rels from drops to keeper
 *   - fill any blank fields on keeper from the freshest drop (photo, email, size, etc.)
 *   - DETACH DELETE drops
 *
 * Orientation nodes are left alone (they're an audit log of every registration).
 *
 * Usage:
 *   railway run -- node scripts/dedupe-ru-students.js          # apply
 *   railway run -- node scripts/dedupe-ru-students.js --dry    # preview only
 */
const neo4j = require('neo4j-driver');

const DRY = process.argv.includes('--dry') || process.argv.includes('--dry-run');

const uri = process.env.NEO4J_URI;
const user = process.env.NEO4J_USER || 'neo4j';
const password = process.env.NEO4J_PASSWORD;

if (!uri || !password) {
  console.error('✗ Missing NEO4J_URI / NEO4J_PASSWORD env vars.');
  process.exit(1);
}

const config = uri.startsWith('neo4j+s') ? {} : { encrypted: 'ENCRYPTION_OFF' };
const driver = neo4j.driver(uri, neo4j.auth.basic(user, password), config);

const FILL_FIELDS = [
  'email', 'size', 'experience', 'lastAsana', 'injuries',
  'photoUrl', 'telegramUsername', 'telegramPhotoFileId',
  'telegramChatId', 'language', 'workshop', 'city',
];

function blank(v) {
  return v === null || v === undefined || v === '';
}

(async () => {
  const session = driver.session();
  let totalGroups = 0;
  let totalDrops = 0;
  try {
    const rows = await session.run(`
      MATCH (s:Student)
      WHERE s.location = 'russia' OR s.id STARTS WITH 'ru-'
      OPTIONAL MATCH (s)-[:HAS_PRACTICE_LOG|:HAS_SELF_ASSESSMENT]->(j)
      WITH s, count(j) AS journals
      RETURN s, journals
      ORDER BY s.createdAt DESC
    `);

    const all = rows.records.map(r => {
      const props = r.get('s').properties;
      return {
        id: props.id,
        name: props.name || '',
        email: (props.email || '').trim(),
        telegramChatId: String(props.telegramChatId || ''),
        createdAt: props.createdAt ? props.createdAt.toString() : '',
        journals: r.get('journals').toNumber ? r.get('journals').toNumber() : Number(r.get('journals')),
        props,
      };
    });

    console.log(`Scanned ${all.length} Russia Student nodes.`);

    // Group
    const groups = new Map();
    for (const s of all) {
      let key;
      if (s.telegramChatId) key = `tg:${s.telegramChatId}`;
      else if (s.email) key = `em:${s.email.toLowerCase()}`;
      else continue; // no reliable identifier — leave alone
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(s);
    }

    const dupGroups = [...groups.entries()].filter(([, arr]) => arr.length > 1);
    console.log(`Found ${dupGroups.length} duplicate group(s).\n`);

    if (!dupGroups.length) {
      console.log('✓ Nothing to merge.');
      return;
    }

    for (const [key, members] of dupGroups) {
      // keeper: most journals, then most recent
      members.sort((a, b) => {
        if (b.journals !== a.journals) return b.journals - a.journals;
        return (b.createdAt || '').localeCompare(a.createdAt || '');
      });
      const keeper = members[0];
      const drops = members.slice(1);
      totalGroups += 1;
      totalDrops += drops.length;

      console.log(`[${key}] ${keeper.name || '(no name)'}`);
      console.log(`  keep  ${keeper.id} · journals=${keeper.journals} · ${keeper.createdAt}`);
      for (const d of drops) {
        console.log(`  drop  ${d.id} · journals=${d.journals} · ${d.createdAt}`);
      }

      if (DRY) continue;

      // Build a map of fill values from the freshest drop that has each field
      const fill = {};
      for (const f of FILL_FIELDS) {
        if (!blank(keeper.props[f])) continue;
        for (const d of drops) {
          if (!blank(d.props[f])) { fill[f] = d.props[f]; break; }
        }
      }

      const dropIds = drops.map(d => d.id);

      // 1. Reattach outgoing rels from each drop to keeper.
      //    apoc not assumed available — copy by relationship type.
      const relTypes = ['HAS_PRACTICE_LOG', 'HAS_SELF_ASSESSMENT', 'HAS_VIDEO'];
      for (const rt of relTypes) {
        await session.run(
          `MATCH (k:Student { id: $keeperId })
           MATCH (d:Student) WHERE d.id IN $dropIds
           MATCH (d)-[r:\`${rt}\`]->(t)
           MERGE (k)-[:\`${rt}\`]->(t)
           DELETE r`,
          { keeperId: keeper.id, dropIds }
        );
      }

      // 2. Fill blank fields on keeper.
      if (Object.keys(fill).length) {
        const setClauses = Object.keys(fill).map(f => `k.${f} = $fill_${f}`).join(', ');
        const params = { keeperId: keeper.id };
        for (const [k, v] of Object.entries(fill)) params[`fill_${k}`] = v;
        await session.run(
          `MATCH (k:Student { id: $keeperId }) SET ${setClauses}`,
          params
        );
      }

      // 3. Detach-delete drops.
      await session.run(
        `MATCH (d:Student) WHERE d.id IN $dropIds DETACH DELETE d`,
        { dropIds }
      );

      console.log(`  ✓ merged ${drops.length} drop(s) into keeper`);
    }

    console.log(`\n${DRY ? '[DRY RUN] would merge' : 'Merged'} ${totalDrops} duplicate(s) across ${totalGroups} group(s).`);
  } catch (e) {
    console.error('✗ Dedupe failed:', e.message);
    process.exit(1);
  } finally {
    await session.close();
    await driver.close();
  }
})();
