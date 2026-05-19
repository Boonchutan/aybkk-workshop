// Script to update TeamMemory in Neo4j with Russia WS build info
const neo4j = require('neo4j-driver');
const driver = neo4j.driver('bolt://localhost:7687', neo4j.auth.basic('neo4j', 'aybkk_neo4j_2026'));
const session = driver.session();

const memory = `AYBKK UPDATE — Russia WS Build (May 12, 2026)

=== RUSSIA WS 2026 SYSTEM (built with Claude Code) ===
Built by Boonchu during Russia trip (April 25 – May 12, 2026).

**Telegram Bot (russia-bot.js, 781 lines)**
- @AYBKKstudentProgress_bot — shares bot instance with assessment-bot.js
- Full orientation flow: RU/EN language, profile (name, email, city, T-shirt size, experience, last asana, difficulties, injuries, goals), photo, 2-quiz welcome game
- Auto-generates share card PNG + posts welcome to RU Telegram group
- Schedules daily reminders: 3h before class (check-in) + 2h after (journal)
- /journal — re-send student's journal link + QR
- /export — Boonchu only — CSV of all RU students
- Class schedule: SPb (May 1-3), Moscow (May 6-10)
- Student state: data/ru-bot-state.json (23 students, mostly SPb)

**Share Card Renderer (share-card-renderer.js, 273 lines)**
- Server-side @napi-rs/canvas PNG generator (640×720)
- Mirrors student.html canvas design
- Day-of-week pastel palette (Mon=Sage Green → Sun=Mist Gray)
- Playfair Display font, AYBKK branding
- Inputs: name, subtitle, dateInfo, quote, photoUrl, dayIndex

**Student Journal System (Railway: aybkk-ashtanga.up.railway.app)**
- my-journal.html (982 lines) — mobile-first practice journal, warm cream/Spectral serif design, clay+gold color system
- journal.html (526 lines) — daily practice tracking
- faces.html (325 lines) — student gallery
- mindmap.html (1758 lines) — knowledge/intake mindmap
- register.html (934 lines) — student registration
- DeepSeek AI for practice summaries
- PostgreSQL on Railway + local JSON fallback

**Student Data (as of May 12)**
- 23 students registered via russia-bot (mostly St. Petersburg)
- All: profile, photo (Telegram fileId), quiz scores, journal link
- States: done, photo, lastAsana, quiz2, lang (incomplete)
- No Moscow students yet (classes start May 6)
- File: data/ru-bot-state.json

**Orientation Pages**
- orientation-bkk.html (75KB) — Bangkok orientation
- orientation-gz.html (66KB) — Guangzhou orientation  
- orientation-ru.html (22KB) — Russia orientation

**Infrastructure**
- Railway URL: https://aybkk-ashtanga.up.railway.app
- PostgreSQL: postgresql://postgres:***@monorail.proxy.rlwy.net:38567/railway
- Mission Control (local): http://localhost:3000, dir=~/mission-control/, server.js (2450 lines)

**DATA STATUS: NOT in Neo4j**
- All student data in JSON files (journal-students.json, ru-bot-state.json)
- Neo4j still only has 1 test student
- Real student data needs sync script

=== EXISTING (pre-Russia) ===
- assessment-bot.js (937 lines) — multi-language student assessment flow
- shopify-org/ — Shopify integration
- Mission Control tabs: Progress, Timeline, Kanban, Brainstorm, Heat Map, Students

=== NEO4J CREDENTIALS (unchanged) ===
URI: bolt://localhost:7687, User: neo4j, PW: aybkk_neo4j_2026

=== TEAM ===
Boonchu Tanti (Founder) — @boonchu_tanti
Nicco (Chief of Staff) — @machiav_bot
Neo (Tech Coder) — @neo_bot

Last updated: May 12, 2026 by Neo (Boonchu back from Russia)`;

async function update() {
  const now = new Date().toISOString();
  try {
    await session.run(`
      MERGE (m:TeamMemory {id: 'aybkk-shared'})
      SET m.content = $content, m.updatedAt = datetime($now)
    `, { content: memory, now });
    console.log('✓ Agora memory updated');
  } catch(e) {
    console.error('Error:', e.message);
  } finally {
    session.close();
    driver.close();
  }
}
update();