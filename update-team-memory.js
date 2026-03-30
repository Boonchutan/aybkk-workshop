#!/usr/bin/env node
/**
 * Update Team Memory in Neo4j with all AYBKK systems and credentials
 */

const neo4j = require('neo4j-driver');

const driver = neo4j.driver(
  'bolt://localhost:7687',
  neo4j.auth.basic('neo4j', 'aybkk_neo4j_2026')
);

const memoryText = JSON.stringify({
  updatedAt: new Date().toISOString(),
  updatedBy: 'Neo',

  // Core Systems
  missionControl: 'http://localhost:3000, dir=/Users/alfredoagent/mission-control, server.js, PID 98010',

  studentJournal: 'Student self-assessment system built Mar 22, 2026. Web form: http://localhost:3000/student.html (student-facing, 3 lang). Teacher view (mobile): http://localhost:3000/journal.html - tap student → show QR full screen for student to scan. Pending DNS: studentprogress.aybkk.com',

  studentJournalFlow: 'First time: Create profile → Get personal QR. Return: Scan QR → Name pre-filled → Answer 5 questions → Submit. Teachers: View at /journal.html',

  studentJournalQuestions: 'Energy (high/medium/low), Practice Consistency (proper/rest/distractions), Practice Flow (good/okay/needs_work), How Felt (great/good/okay/tired), Learned (text), Work on (text), Comments (text)',

  studentJournalAPI: 'POST /api/journal/profile, POST /api/journal/checkin, GET /api/journal/students, GET /api/journal/history/:days, GET /api/journal/qr/:studentId',

  studentJournalFiles: 'api/student-journal.js (routes), public/student.html (form), public/journal.html (teacher view)',

  studentJournalSchema: 'Student node (id, name, lineId, wechatId, isChineseStudent, classType, createdAt, isActive) → HAS_SELF_ASSESSMENT → SelfAssessment node (energy, practiceConsistency, practiceFlow, howFelt, learned, workOn, comments, platform, checkedInAt)',

  lineStudentBot: 'LINE bot for Thai students to self-report - NOT YET BUILT. Will mirror teacher assessment flow but student-facing.',

  assessmentBot: 'Teacher assessment bot @AYBKKstudentProgress_bot, token 8368539519:AAF12ytC_rr26xBoDxmKVceCFeANRTK69dA, flow: strengths→weaknesses→energy→practiceConsistency→practiceFlow→lastAsana→vote→toFix→confirm. PracticeConsistency = Proper Vinyasa/Rest Often/Too Much Distractions (same as practiceFlow)',

  currentTasks: '1) DNS: Point studentprogress.aybkk.com to server for QR codes 2) Print QR codes for Chinese students 3) Test form end-to-end 4) Build LINE student bot 5) Connect Rezerv check-in → auto-trigger assessment',

  neo4jNodes: 'Student, Membership, Tag, Assessment, SelfAssessment, Session, File',

  neo4jRelationships: 'HAS_MEMBERSHIP, HAS_STRENGTH, HAS_WEAKNESS, HAS_CURRENT, HAS_ASSESSMENT, HAS_SELF_ASSESSMENT, CHECKED_IN, INTERESTED_IN',

  network: 'LINE webhook: /line/webhook, cloudflared tunnel (URL changes on restart - update in LINE Dev Console)',

  rezerv: 'Booking platform. CSV exports at ~/mission-control/data/. Login: Aybkks31@gmail.com. Data: rezwerw_memberships_*.csv (current), legacy_customer_report_*.csv (2018)',

  notion: '21 databases connected. API key configured.',

  shopify: 'Store 7bdc65-2.',

  lineBot: '@AYBKKstudentProgress_bot, token above. Teachers: Boonchu, Jamsai, M. Multi-lang EN/TH/ZH. Flow order: strengths→weaknesses→energy→practiceConsistency→practiceFlow→lastAsana→vote→toFix'
});

async function updateMemory() {
  const session = driver.session();
  try {
    // Delete existing memory
    await session.run('MATCH (m:TeamMemory {id: $id}) DETACH DELETE m', { id: 'aybkk-shared' });

    // Create new memory with stringified JSON
    await session.run(`
      CREATE (m:TeamMemory {
        id: 'aybkk-shared',
        data: $data,
        updatedAt: datetime($updatedAt),
        updatedBy: $updatedBy
      })
    `, {
      data: memoryText,
      updatedAt: new Date().toISOString(),
      updatedBy: 'Neo'
    });

    console.log('✓ Team memory updated successfully');
    console.log('Updated:', new Date().toISOString());
  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    await session.close();
    await driver.close();
  }
}

updateMemory();
