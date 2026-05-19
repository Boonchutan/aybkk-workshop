// Update Agora memory after Russia sync
const neo4j = require('neo4j-driver');
const driver = neo4j.driver('bolt://localhost:7687', neo4j.auth.basic('neo4j', 'aybkk_neo4j_2026'), { encrypted: 'ENCRYPTION_OFF' });
const session = driver.session();

const memory = `AYBKK UPDATE — Russia WS Sync Complete (May 12, 2026)

=== RUSSIA WS 2026 SYSTEM ===
Built by Boonchu + Claude Code during Russia trip (April 25 – May 12, 2026).

**Live App (Railway):** https://aybkk-ashtanga.up.railway.app
- ru-students.html — Russia roster (45 students)
- my-journal.html — student practice journal
- /api/orientations/ru — full JSON API (no auth)

**Telegram Bot (russia-bot.js, 781 lines)**
- @AYBKKstudentProgress_bot — Russian/English orientation + 2-quiz game
- Full registration: profile, photo, T-shirt, experience, difficulties, injuries, goals
- Auto-reminders: 3h before class + 2h after (journal)
- SPb: May 1-3 | Moscow: May 6-10

**Student Data (synced to Neo4j May 12)**
- Source: Railway API /api/orientations/ru (45 students)
- Also in: data/ru-bot-state.json (23 entries, local only)
- Neo4j: 46 students total with source='russia-ws-2026'
- SPb: 28 students | Moscow: 16 students | Unknown: 1 student
- Schema: Student with city, location, experience, lastAsana, injuries, goals, tshirt, journalLink, photoUrl, telegramChatId
- Tags: FROM_CITY (SPB/MOSCOW), ATTENDED (Russia WS 2026), HAS_EXPERIENCE

**Key Files**
- russia-bot.js (781L) — Telegram registration bot
- share-card-renderer.js (273L) — server-side PNG cards
- server.js (2450L) — Mission Control backend
- my-journal.html (982L) — practice journal (warm cream/Spectral design)
- data/ru-bot-state.json — local bot state (23 entries)
- data/journal-students.json — 771 journal entries (not location-tagged)

**Data Status**
- Railway PostgreSQL: students, journal_entries, classes, bookings tables
- Neo4j: 46 Russia WS 2026 students (synced May 12), 645 rezerv students
- Moscow student data: LIVE on Railway (not ephemeral — survived redeploy)
- All students: journal links, photo URLs, Telegram chat IDs

**Moscow 16 students** (from Railway API):
Elena Dmitrenko, Elena Kalsina, Kornodub Olga, Kseniia Meshkova, Marina Tokareva,
Oksana Petunova, Oleg Kiryukhin, Rimma Rychkova, Sasha Kotlyarova, Sergey Shubkin,
Svetlana Rykovanova, Timofey Zuev, Victoria Maltseva, Yarmizina Ekaterina, Yaya,
Марика Абшилава

**SPb 28 students** (from Railway API):
Alena Matsukova, Anisimova Irina, Antonina Krasnova, Dina Linenko, Ekaterina Petrova,
Faina Sluysareva, Galina Konovalova, Ivan Dudich, Krivoshchekovа Margarita, Marina Bragina,
Masha Ashta, Natasha Pastukhova, Olga Krasnova, Polina Orlina, Roman Meshkov,
Roza Khabibulina, Sofia Moroz, Victoria Sagaydachnaya, Yara Khodyreva, Yury Kotlyarov,
b t, Александр Кучеренко, Алёна Кучеренко, Виктория, Елена Днепровская,
Наталья Березовская, Тензиле Катакли, Титкова Ольга

**Design System**
- Colors: warm cream (#FAF6F1), clay (#C2876A), sand (#D4A574), sage green
- Fonts: Spectral (serif body), Inter (UI), Playfair Display (share cards)
- Day-color system: Mon=Sage, Tue=Terra, Wed=Gold, Thu=Orange, Fri=Dusty Blue, Sat=Lavender, Sun=Mist Gray

=== NEO4J STATUS ===
URI: bolt://localhost:7687 | User: neo4j | PW: aybkk_neo4j_2026
Total students: 814 (645 rezerv + 46 russia-ws-2026 + 123 other)
Labels: Student, Tag, Assessment, CheckIn, Membership, etc.
Key rels: HAS_MEMBERSHIP, HAS_STRENGTH, HAS_WEAKNESS, ATTENDED, HAS_DIFFICULTY, HAS_EXPERIENCE

=== TEAM ===
Boonchu Tanti (Founder) — @boonchu_tanti
Nicco (Chief of Staff) — @machiav_bot
Neo (Tech Coder) — @neo_bot

Last updated: May 12, 2026 21:00 ICT by Neo`;

session.run(`
  MERGE (m:TeamMemory {id: 'aybkk-shared'})
  SET m.content = $content, m.updatedAt = datetime()
`, { content: memory })
.then(() => console.log('✓ Agora updated'))
.catch(e => console.error('Error:', e.message))
.finally(() => { session.close(); driver.close(); });