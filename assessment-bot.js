/**
 * AYBKK Student Progress Bot
 * Teachers assess students via Telegram
 * Sorted by most complete/active students first
 */

const { Bot, InlineKeyboard } = require('grammy');
const neo4j = require('neo4j-driver');
const line = require('@line/bot-sdk');

// Config — load from .env
require('dotenv').config();
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const NEO4J_URI = process.env.NEO4J_URI || 'bolt://localhost:7687';
const NEO4J_USER = process.env.NEO4J_USER || 'neo4j';
const NEO4J_PASSWORD = process.env.NEO4J_PASSWORD;
const LINE_CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;

if (!BOT_TOKEN) { console.error('✗ TELEGRAM_BOT_TOKEN missing in .env'); process.exit(1); }

const driver = neo4j.driver(NEO4J_URI, neo4j.auth.basic(NEO4J_USER, NEO4J_PASSWORD));

const bot = new Bot(BOT_TOKEN);

// Wire Russia student flow EARLY — its handlers run before teacher handlers
// so an in-progress orientation (or /start ru payload) routes to the Russia flow.
let russia = null;
try {
  russia = require('./russia-bot.js');
  russia.attach(bot);
} catch (e) {
  console.error('✗ russia-bot.js not loaded:', e.message);
}

// ============ TRANSLATIONS ============
const T = {
  en: {
    start: '👋 Welcome to AYBKK Student Progress\n\nAssess your students after each class. Track their growth over time.\n\n📌 How it works:\n1. Select a student\n2. Assess their strengths, weaknesses & more\n3. Save → All teachers see the progress',
    chooseLang: '🌐 Choose your language:',
    selectStudent: '👤 Select a student:',
    searchHint: '🔍 Type a name to search, or "all" to see all students',
    noResults: '❌ No students found. Try a different name.',
    strengthLabel: '💪 STRENGTHS\nSelect all that apply:',
    weaknessLabel: '📌 WEAKNESSES\nSelect all that apply:',
    energyLabel: '⚡ ENERGY LEVEL\nHow was their energy today?',
    practiceConsistencyLabel: '🔁 PRACTICE CONSISTENCY\nHow regular is their practice?',
    behaviorLabel: '🏃 PRACTICE FLOW\nHow is their practice flow?',
    lastAsanaLabel: '📹 LAST ASANA COMMENT\nType your comment about the last asana they learned:',
    lastAsanaPassLabel: '📹 Should they pass to the NEXT asana?',
    votePass: 'PASS - Ready for next asana',
    voteHold: 'HOLD - Not ready yet',
    toFixLabel: '🔧 WHAT TO FIX FIRST\nWhat should they focus on? (Short description)',
    reviewTitle: '📋 REVIEW ASSESSMENT',
    teacherLabel: '👨‍🏫 WHO IS TEACHING?\nSelect your name:',
    saved: '✅ Saved! {student} assessed successfully.',
    addedTag: '✅ Added: {tag}',
    removedTag: '➖ Removed: {tag}',
    energy: { high: 'High 🔴', medium: 'Medium 🟡', low: 'Low ⚪' },
    practiceConsistency: { proper_vinyasa: 'Proper Vinyasa 🟢', rest_often: 'Rest Often 🟡', too_much_distractions: 'Too Much Distractions 🔴' },
    behavior: { proper_vinyasa: 'Proper Vinyasa 🟢', rest_often: 'Rest Often 🟡', too_much_distractions: 'Too Much Distractions 🔴' },
    back: '⬅️ Back',
    next: 'Next ➡️',
    confirm: '✅ Confirm & Save',
    addNew: '➕ Add New Tag',
    doneSelecting: '✅ Done Selecting',
    selectFromList: '📋 Select from list',
    typeHere: '💬 Type here',
    cancel: '❌ Cancel',
    editAssessment: '✏️ Edit Assessment',
    newAssessment: '🆕 New Assessment',
    viewHistory: '📊 View History',
    myStudents: '📋 My Assessed Students',
    notAssessed: 'No assessments yet',
    lastAssessed: 'Last assessed: {date}',
    assessmentsDone: '✅ {count} assessments done today',
    noAssessmentsToday: '📭 No assessments today yet',
    todayStudents: "📅 Today's Students",
    allStudents: '📋 All Students',
    topStudents: '⭐ Priority (need attention)',
    searchResults: '🔍 Search Results',
    enterStudentName: '👤 Type student name:',
    langChanged: '✅ Language changed to English',
    complete: 'Complete ✓',
    incomplete: 'Incomplete',
    studentsCount: '{count} students',
    selectClass: '📅 Select class for today:',
    noClassToday: '📭 No classes scheduled for today',
  },
  th: {
    start: '👋 ยินดีต้อนรับสู่ AYBKK Student Progress\n\nประเมินนักเรียนหลังสอนทุกครั้ง ติดตามความก้าวหน้าของพวกเขา\n\n📌 วิธีใช้:\n1. เลือกนักเรียน\n2. ประเมินจุดแข็ง จุดอ่อน & อื่นๆ\n3. บันทึก → ครูทุกคนเห็นความก้าวหน้า',
    chooseLang: '🌐 เลือกภาษาของคุณ:',
    selectStudent: '👤 เลือกนักเรียน:',
    searchHint: '🔍 พิมพ์ชื่อที่จะค้นหา หรือ "all" เพื่อดูทั้งหมด',
    noResults: '❌ ไม่พบนักเรียน ลองชื่ออื่น',
    strengthLabel: '💪 จุดแข็ง\nเลือกทั้งหมดที่เกี่ยวข้อง:',
    weaknessLabel: '📌 จุดอ่อน\nเลือกทั้งหมดที่เกี่ยวข้อง:',
    energyLabel: '⚡ ระดับพลังงาน\nวันนี้พลังงานของพวกเขาเป็นอย่างไร?',
    practiceConsistencyLabel: '🔁 ความสม่ำเสมอในการฝึก\nการฝึกของพวกเขาสม่ำเสมอแค่ไหน?',
    behaviorLabel: '🏃 การไหลของการฝึก\nการฝึกของพวกเขาเป็นอย่างไร?',
    lastAsanaLabel: '📹 คอมเมนต์ Asana ล่าสุด\nพิมพ์ความคิดเห็นเกี่ยวกับ Asana ล่าสุดที่เรียน:',
    lastAsanaPassLabel: '📹 ควรผ่านไป Asana ถัดไปไหม?',
    votePass: 'ผ่าน - พร้อมสำหรับ Asana ถัดไป',
    voteHold: 'รอ - ยังไม่พร้อม',
    toFixLabel: '🔧 ต้องแก้ไขอะไรก่อน\nพวกเขาควรเน้นที่อะไร? (ตอบสั้นๆ)',
    reviewTitle: '📋 ทบทวนการประเมิน',
    teacherLabel: '👨‍🏫 ครูผู้สอน?\nเลือกชื่อของคุณ:',
    saved: '✅ บันทึกแล้ว! ประเมิน {student} เรียบร้อย',
    addedTag: '✅ เพิ่ม: {tag}',
    removedTag: '➖ ลบ: {tag}',
    energy: { high: 'สูง 🔴', medium: 'ปานกลาง 🟡', low: 'ต่ำ ⚪' },
    practiceConsistency: { proper_vinyasa: 'Vinyasa ถูกต้อง 🟢', rest_often: 'พักบ่อย 🟡', too_much_distractions: 'รบกวนมาก 🔴' },
    behavior: { proper_vinyasa: 'ไหลถูกต้อง 🟢', rest_often: 'พักบ่อย 🟡', too_much_distractions: 'รบกวนมากเกินไป 🔴' },
    back: '⬅️ กลับ',
    next: 'ถัดไป ➡️',
    confirm: '✅ ยืนยัน & บันทึก',
    addNew: '➕ เพิ่มแท็กใหม่',
    doneSelecting: '✅ เลือกเสร็จแล้ว',
    selectFromList: '📋 เลือกจากรายการ',
    typeHere: '💬 พิมพ์ที่นี่',
    cancel: '❌ ยกเลิก',
    editAssessment: '✏️ แก้ไขการประเมิน',
    newAssessment: '🆕 ประเมินใหม่',
    viewHistory: '📊 ดูประวัติ',
    myStudents: '📋 นักเรียนที่ประเมินแล้ว',
    notAssessed: 'ยังไม่เคยประเมิน',
    lastAssessed: 'ประเมินล่าสุด: {date}',
    assessmentsDone: '✅ ประเมินแล้ว {count} คนวันนี้',
    noAssessmentsToday: '📭 ยังไม่มีการประเมินวันนี้',
    todayStudents: '📅 นักเรียนวันนี้',
    allStudents: '📋 นักเรียนทั้งหมด',
    topStudents: '⭐ ต้องให้ความสนใจ',
    searchResults: '🔍 ผลการค้นหา',
    enterStudentName: '👤 พิมพ์ชื่อนักเรียน:',
    langChanged: '✅ เปลี่ยนภาษาเป็นไทยแล้ว',
    complete: 'สมบูรณ์ ✓',
    incomplete: 'ยังไม่สมบูรณ์',
    studentsCount: '{count} คน',
    selectClass: '📅 เลือกคลาสวันนี้:',
    noClassToday: '📭 ไม่มีคลาสวันนี้',
  },
  zh: {
    start: '👋 欢迎使用 AYBKK Student Progress\n\n课后评估学生，跟踪他们的进展\n\n📌 使用方法:\n1. 选择学生\n2. 评估优缺点等\n3. 保存 → 所有老师都能看到进度',
    chooseLang: '🌐 选择您的语言:',
    selectStudent: '👤 选择学生:',
    searchHint: '🔍 输入姓名搜索，或输入"all"查看全部',
    noResults: '❌ 未找到学生，请尝试其他姓名',
    strengthLabel: '💪 优势\n选择所有适用项:',
    weaknessLabel: '📌 弱点\n选择所有适用项:',
    energyLabel: '⚡ 能量水平\n今天他们的能量如何？',
    practiceConsistencyLabel: '🔁 练习规律性\n他们的练习有多规律？',
    behaviorLabel: '🏃 练习流动\n他们的练习流动如何？',
    lastAsanaLabel: '📹 最后一个 Asana 评语\n输入关于他们学习的最后一个 Asana 的评语:',
    lastAsanaPassLabel: '📹 他们应该进入下一个 Asana 吗?',
    votePass: '通过 - 可以进入下一个 Asana',
    voteHold: '暂停 - 还没准备好',
    toFixLabel: '🔧 最需要修复什么\n他们应该专注于什么？（简短描述）',
    reviewTitle: '📋 评估回顾',
    teacherLabel: '👨‍🏫 谁在教学？\n选择您的名字:',
    saved: '✅ 已保存！{student} 评估成功',
    addedTag: '✅ 已添加: {tag}',
    removedTag: '➖ 已删除: {tag}',
    energy: { high: '高 🔴', medium: '中 🟡', low: '低 ⚪' },
    practiceConsistency: { proper_vinyasa: '正确Vinyasa 🟢', rest_often: '经常休息 🟡', too_much_distractions: '干扰太多 🔴' },
    behavior: { proper_vinyasa: '流动正确 🟢', rest_often: '休息频繁 🟡', too_much_distractions: '干扰过多 🔴' },
    back: '⬅️ 返回',
    next: '下一个 ➡️',
    confirm: '✅ 确认并保存',
    addNew: '➕ 添加新标签',
    doneSelecting: '✅ 选择完成',
    selectFromList: '📋 从列表选择',
    typeHere: '💬 在此输入',
    cancel: '❌ 取消',
    editAssessment: '✏️ 编辑评估',
    newAssessment: '🆕 新评估',
    viewHistory: '📊 查看历史',
    myStudents: '📋 我评估过的学生',
    notAssessed: '尚未评估',
    lastAssessed: '上次评估: {date}',
    assessmentsDone: '✅ 今天已评估 {count} 人',
    noAssessmentsToday: '📭 今天尚未有评估',
    todayStudents: '📅 今天的学生',
    allStudents: '📋 所有学生',
    topStudents: '⭐ 需要关注',
    searchResults: '🔍 搜索结果',
    enterStudentName: '👤 输入学生姓名:',
    langChanged: '✅ 语言已更改为中文',
    complete: '完整 ✓',
    incomplete: '不完整',
    studentsCount: '{count} 名学生',
    selectClass: '📅 选择今天的课程:',
    noClassToday: '📭 今天没有课程',
  }
};

// ============ USER STATE ============
const userStates = new Map();
// State: { lang, student, strengths[], weaknesses[], energy, behavior, lastAsana, lastAsanaPass, toFix, step, searchMode, kbMessageId, teacherName, strengthsWeekStart, weaknessesWeekStart }

function getState(ctx) {
  const key = ctx.from.id;
  if (!userStates.has(key)) {
    userStates.set(key, {
      lang: 'en',
      student: null,
      strengths: [],
      weaknesses: [],
      energy: null,
      behavior: null,
      practiceConsistency: null,
      lastAsana: '',
      lastAsanaPass: null,
      toFix: '',
      step: 0,
      searchMode: false,
      searchResults: [],
      kbMessageId: null,
      teacherName: null,
      strengthsWeekStart: null, // ISO date string when strengths were last set
      weaknessesWeekStart: null  // ISO date string when weaknesses were last set
    });
  }
  return userStates.get(key);
}

// Check if strengths/weaknesses were set this week (Mon-Sun)
function isThisWeek(dateStr) {
  if (!dateStr) return false;
  const d = new Date(dateStr);
  const now = new Date();
  const startOfWeek = new Date(now);
  startOfWeek.setDate(now.getDate() - now.getDay()); // Sunday
  startOfWeek.setHours(0, 0, 0, 0);
  return d >= startOfWeek;
}

function t(ctx, key, vars = {}) {
  const state = getState(ctx);
  let text = T[state.lang]?.[key] || T.en[key] || key;
  for (const [k, v] of Object.entries(vars)) {
    text = text.replace(`{${k}}`, v);
  }
  return text;
}

// ============ NEO4J HELPERS ============
async function getStudentsSortedByCompleteness() {
  const session = driver.session();
  try {
    // Get students with ACTIVE (non-expired) memberships only
    const result = await session.run(`
      MATCH (s:Student)-[:HAS_MEMBERSHIP]->(m:Membership)
      WHERE s.name IS NOT NULL AND m.status = 'active' AND m.expiresAt >= date()
      OPTIONAL MATCH (s)-[:HAS_STRENGTH|HAS_WEAKNESS|HAS_CURRENT]->(t:Tag)
      OPTIONAL MATCH (a:Assessment)-[:FOR_STUDENT]->(s)
      RETURN s.studentId AS id, s.name AS name,
             count(DISTINCT t) AS tagCount,
             count(DISTINCT a) AS assessmentCount,
             max(a.created_at) AS lastAssessment,
             m.expiresAt AS expiresAt
      ORDER BY assessmentCount DESC, tagCount DESC, s.name ASC
      LIMIT 100
    `);
    return result.records.map(r => ({
      id: r.get('id'),
      name: r.get('name'),
      tagCount: r.get('tagCount').toNumber(),
      assessmentCount: r.get('assessmentCount').toNumber(),
      lastAssessment: r.get('lastAssessment'),
      expiresAt: r.get('expiresAt')
    }));
  } finally {
    session.close();
  }
}

async function getAllStudents() {
  const session = driver.session();
  try {
    const result = await session.run(`
      MATCH (s:Student)-[:HAS_MEMBERSHIP]->(m:Membership)
      WHERE s.name IS NOT NULL AND m.status = 'active' AND m.expiresAt >= date()
      OPTIONAL MATCH (a:Assessment)-[:FOR_STUDENT]->(s)
      RETURN s.studentId AS id, s.name AS name,
             count(DISTINCT a) AS assessmentCount,
             max(a.created_at) AS lastAssessment,
             m.expiresAt AS expiresAt
      ORDER BY s.name ASC
      LIMIT 100
    `);
    return result.records.map(r => ({
      id: r.get('id'),
      name: r.get('name'),
      assessmentCount: r.get('assessmentCount').toNumber(),
      lastAssessment: r.get('lastAssessment'),
      expiresAt: r.get('expiresAt')
    }));
  } finally {
    session.close();
  }
}

async function searchStudents(query) {
  const session = driver.session();
  try {
    const result = await session.run(`
      MATCH (s:Student)-[:HAS_MEMBERSHIP]->(m:Membership)
      WHERE s.name IS NOT NULL AND toLower(s.name) CONTAINS toLower($query)
        AND m.status = 'active' AND m.expiresAt >= date()
      OPTIONAL MATCH (a:Assessment)-[:FOR_STUDENT]->(s)
      RETURN s.studentId AS id, s.name AS name,
             count(DISTINCT a) AS assessmentCount,
             max(a.created_at) AS lastAssessment
      ORDER BY assessmentCount DESC, s.name ASC
      LIMIT 20
    `, { query });
    return result.records.map(r => ({
      id: r.get('id'),
      name: r.get('name'),
      assessmentCount: r.get('assessmentCount').toNumber(),
      lastAssessment: r.get('lastAssessment')
    }));
  } finally {
    session.close();
  }
}

async function getTags(type) {
  const session = driver.session();
  try {
    const result = await session.run(`
      MATCH (t:Tag {type: $type})
      RETURN t.name AS name ORDER BY t.name
    `, { type });
    return result.records.map(r => r.get('name'));
  } finally {
    session.close();
  }
}

async function getStudentTags(studentId) {
  const session = driver.session();
  try {
    const result = await session.run(`
      MATCH (s:Student {studentId: $id})-[r:HAS_CURRENT]->(t:Tag)
      RETURN t.name AS name, t.type AS type, r.assigned_date AS since
    `, { id: studentId });
    return result.records.map(r => ({
      name: r.get('name'),
      type: r.get('type'),
      since: r.get('since')
    }));
  } finally {
    session.close();
  }
}

async function addTag(studentId, tagName, type) {
  const session = driver.session();
  try {
    await session.run(`
      MATCH (s:Student {studentId: $studentId})
      MERGE (t:Tag {name: $tagName, type: $type})
      MERGE (s)-[r:HAS_CURRENT]->(t)
      SET r.assigned_date = date(), t.created_at = coalesce(t.created_at, date())
    `, { studentId, tagName, type });
  } finally {
    session.close();
  }
}

async function removeTag(studentId, tagName, type) {
  const session = driver.session();
  try {
    await session.run(`
      MATCH (s:Student {studentId: $studentId})-[r:HAS_CURRENT]->(t:Tag {name: $tagName, type: $type})
      SET r.removed_date = date()
    `, { studentId, tagName, type });
  } finally {
    session.close();
  }
}

async function saveAssessment(data) {
  const session = driver.session();
  try {
    const { teacherId, teacherName, studentId, strengths, weaknesses, energy, behavior, lastAsana, lastAsanaPass, toFix } = data;
    const result = await session.run(`
      MATCH (s:Student {studentId: $studentId})
      CREATE (a:Assessment {
        id: randomUUID(),
        teacher_id: $teacherId,
        teacher_name: $teacherName,
        energy_level: $energy,
        practice_behavior: $behavior,
        last_asana_comment: $lastAsana,
        last_asana_pass: $lastAsanaPass,
        to_fix_now: $toFix,
        created_at: datetime()
      })
      CREATE (a)-[:FOR_STUDENT]->(s)
      RETURN a.id AS id
    `, {
      teacherId: String(teacherId),
      teacherName: teacherName || 'Teacher',
      studentId,
      energy,
      behavior,
      lastAsana,
      lastAsanaPass,
      toFix
    });
    return result.records[0].get('id');
  } finally {
    session.close();
  }
}

async function getTodayAssessmentCount(teacherId) {
  const session = driver.session();
  try {
    const result = await session.run(`
      MATCH (a:Assessment {teacher_id: $teacherId})
      WHERE a.created_at >= datetime('${new Date().toISOString().split('T')[0]}T00:00:00')
      RETURN count(a) AS cnt
    `, { teacherId: String(teacherId) });
    return result.records[0]?.get('cnt')?.toNumber() || 0;
  } finally {
    session.close();
  }
}

// ============ LINE NOTIFY ============
const LINE_GROUP_ID = 'C92c203fac9632f866baac26d692d4143';

async function notifyLINEGroup(studentName, teacherName, passVote, lastAsanaComment, toFixComment) {
  const passText = passVote === true ? '✅ PASS' : passVote === false ? '❌ HOLD' : '⏳ Awaiting vote';
  const toFixText = toFixComment || '-';
  const asanaText = lastAsanaComment || '-';
  const message = `🔔 *New Assessment - AYBKK*

👤 Student: ${studentName}
👨‍🏫 Teacher: ${teacherName}
📹 Last Asana: ${asanaText}
🔧 To Fix: ${toFixText}
🗳️ Vote: ${passText}
━━━━━━━━━━━━━━━━━
M & Jamsai: Please add your vote on Telegram @AYBKKstudentProgress_bot`;

  // Push to LINE group instead of broadcast
  const response = await fetch('https://api.line.me/v2/bot/message/push', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}`
    },
    body: JSON.stringify({
      to: LINE_GROUP_ID,
      messages: [{ type: 'text', text: message }]
    })
  });

  if (!response.ok) {
    console.error('LINE notify failed:', response.status);
    return false;
  }
  return true;
}

async function getStudentHistory(studentId) {
  const session = driver.session();
  try {
    const result = await session.run(`
      MATCH (a:Assessment)-[:FOR_STUDENT]->(s:Student {studentId: $id})
      RETURN a.energy_level AS energy,
             a.practice_behavior AS behavior,
             a.last_asana_problem AS lastAsana,
             a.to_fix_now AS toFix,
             a.teacher_name AS teacher,
             a.created_at AS date
      ORDER BY a.created_at DESC
      LIMIT 10
    `, { id: studentId });
    return result.records.map(r => ({
      energy: r.get('energy'),
      behavior: r.get('behavior'),
      lastAsana: r.get('lastAsana'),
      toFix: r.get('toFix'),
      teacher: r.get('teacher'),
      date: r.get('date')
    }));
  } finally {
    session.close();
  }
}

// ============ KEYBOARDS ============
function buildLangKeyboard() {
  return new InlineKeyboard()
    .text('🇬🇧 English', 'lang:en')
    .text('🇹🇭 ภาษาไทย', 'lang:th')
    .text('🇨🇳 中文', 'lang:zh');
}

function buildStudentKeyboard(students, ctx, page = 0) {
  const state = getState(ctx);
  const perPage = 8;
  const start = page * perPage;
  const end = start + perPage;
  const pageStudents = students.slice(start, end);
  const totalPages = Math.ceil(students.length / perPage);

  const kb = new InlineKeyboard();
  pageStudents.forEach(s => {
    const completeness = s.assessmentCount > 0 ? '✅' : '⬜';
    const displayName = s.name || 'Unknown';
    kb.text(`${completeness} ${displayName}`, `student:${s.id}`).row();
  });

  // Navigation
  if (totalPages > 1) {
    if (page > 0) kb.text('◀️', `page:${page - 1}`);
    kb.text(`${page + 1}/${totalPages}`, 'noop');
    if (end < students.length) kb.text('▶️', `page:${page + 1}`);
    kb.row();
  }

  kb.text('🔍 Search', 'search').row();
  kb.text('📊 All (A-Z)', 'all').row();
  kb.text(t(ctx, 'cancel'), 'cancel');
  return kb;
}

function buildEnergyKeyboard(ctx) {
  const l = T[getState(ctx).lang];
  return new InlineKeyboard()
    .text(`${l.energy.low}`, 'energy:low').row()
    .text(`${l.energy.medium}`, 'energy:medium').row()
    .text(`${l.energy.high}`, 'energy:high').row()
    .text(l.back, 'back:3');
}

function buildPracticeConsistencyKeyboard(ctx) {
  const l = T[getState(ctx).lang];
  return new InlineKeyboard()
    .text(`${l.practiceConsistency.proper_vinyasa}`, 'pc:proper_vinyasa').row()
    .text(`${l.practiceConsistency.rest_often}`, 'pc:rest_often').row()
    .text(`${l.practiceConsistency.too_much_distractions}`, 'pc:too_much_distractions').row()
    .text(l.back, 'back:3');
}

function buildBehaviorKeyboard(ctx) {
  const l = T[getState(ctx).lang];
  return new InlineKeyboard()
    .text(`${l.behavior.proper_vinyasa}`, 'behavior:proper_vinyasa').row()
    .text(`${l.behavior.rest_often}`, 'behavior:rest_often').row()
    .text(`${l.behavior.too_much_distractions}`, 'behavior:too_much_distractions').row()
    .text(l.back, 'back:5');
}

function buildTagKeyboard(tags, selected, ctx, type) {
  const state = getState(ctx);
  const l = T[state.lang];
  const kb = new InlineKeyboard();

  // Display tags in 2 columns
  for (let i = 0; i < tags.length; i += 2) {
    const tag1 = tags[i];
    const isSel1 = selected.includes(tag1);
    kb.text(`${isSel1 ? '✅' : '⬜'} ${tag1}`, `tag:${tag1}`);

    if (i + 1 < tags.length) {
      const tag2 = tags[i + 1];
      const isSel2 = selected.includes(tag2);
      kb.text(`${isSel2 ? '✅' : '⬜'} ${tag2}`, `tag:${tag2}`);
    }
    kb.row();
  }

  kb.text(`➕ ${l.addNew}`, `addnew:${type}`).row();
  kb.text(`✅ ${l.doneSelecting}`, `done:${type}`).row();
  kb.text(l.back, 'back:strength'.startsWith(type) ? 'back:1' : 'back:2');
  return kb;
}

function buildConfirmKeyboard(ctx) {
  const l = T[getState(ctx).lang];
  return new InlineKeyboard()
    .text(`✅ ${l.confirm}`, 'confirm').row()
    .text(`✏️ ${l.editAssessment}`, 'edit').row()
    .text(`❌ ${l.cancel}`, 'cancel');
}

function buildMainMenuKeyboard(ctx) {
  const state = getState(ctx);
  const l = T[state.lang];
  return new InlineKeyboard()
    .text(`📋 ${l.allStudents}`, 'studentlist').row()
    .text(`🔍 ${l.searchResults}`, 'search')
    .row()
    .text(`🌐 ${l.chooseLang.split(' ')[0]}`, 'changelang')
    .text(`📊 ${l.viewHistory}`, 'history');
}

function buildTeacherKeyboard(ctx) {
  const l = T[getState(ctx).lang];
  return new InlineKeyboard()
    .text('Boonchu', 'teacher:Boonchu').row()
    .text('Jamsai', 'teacher:Jamsai').row()
    .text('M', 'teacher:M').row()
    .text(l.back, 'back:teacher');
}

function buildVoteKeyboard(ctx) {
  const l = T[getState(ctx).lang];
  return new InlineKeyboard()
    .text(`✅ ${l.votePass || 'PASS - Ready for next asana'}`, 'vote:pass').row()
    .text(`❌ ${l.voteHold || 'HOLD - Not ready yet'}`, 'vote:hold').row()
    .text(l.back, 'back:5');
}

function buildNotifyKeyboard(ctx) {
  const l = T[getState(ctx).lang];
  return new InlineKeyboard()
    .text('📱 Notify M & Jamsai via LINE', 'notifyline').row()
    .text(`📋 ${l.newAssessment}`, 'newassessment');
}

// ============ STEP DISPATCHER ============
async function sendStep(ctx, step) {
  const state = getState(ctx);
  const l = T[state.lang];

  const studentName = state.student?.name || '';

  if (step === 1) {
    // Strengths
    const existingTags = await getTags('strength');
    const displayTags = existingTags.length ? existingTags : ['Core Strength', 'Flexibility', 'Breath Control', 'Balance', 'Stamina', 'Focus'];
    const sentMsg = await ctx.reply(`👤 ${studentName}\n\n${l.strengthLabel}`, { reply_markup: buildTagKeyboard(displayTags, state.strengths, ctx, 'strength') });
    state.kbMessageId = sentMsg.message_id;
  } else if (step === 2) {
    // Weaknesses
    const existingTags = await getTags('weakness');
    const displayTags = existingTags.length ? existingTags : ['Chaturanga', 'Jump Back', 'Core', 'Balance', 'Flexibility', 'Breathing'];
    const sentMsg = await ctx.reply(`👤 ${studentName}\n\n${l.weaknessLabel}`, { reply_markup: buildTagKeyboard(displayTags, state.weaknesses, ctx, 'weakness') });
    state.kbMessageId = sentMsg.message_id;
  } else if (step === 3) {
    // Energy
    const sentMsg = await ctx.reply(`👤 ${studentName}\n\n${l.energyLabel}`, { reply_markup: buildEnergyKeyboard(ctx) });
    state.kbMessageId = sentMsg.message_id;
  } else if (step === 4) {
    // Practice Consistency
    const sentMsg = await ctx.reply(`👤 ${studentName}\n\n${l.practiceConsistencyLabel}`, { reply_markup: buildPracticeConsistencyKeyboard(ctx) });
    state.kbMessageId = sentMsg.message_id;
  } else if (step === 5) {
    // Practice Flow (Behavior)
    const sentMsg = await ctx.reply(`👤 ${studentName}\n\n${l.behaviorLabel}`, { reply_markup: buildBehaviorKeyboard(ctx) });
    state.kbMessageId = sentMsg.message_id;
  } else if (step === 6) {
    // Last asana comment (text input)
    await ctx.reply(`👤 ${studentName}\n\n${l.lastAsanaLabel}`);
  } else if (step === 'vote') {
    // Vote: pass or hold for next asana
    const sentMsg = await ctx.reply(`👤 ${studentName}\n\n${l.lastAsanaPassLabel}`, { reply_markup: buildVoteKeyboard(ctx) });
    state.kbMessageId = sentMsg.message_id;
  } else if (step === 7) {
    // To fix now
    await ctx.reply(`👤 ${studentName}\n\n${l.toFixLabel}`);
  } else if (step === 'teacher') {
    // Teacher selection
    const sentMsg = await ctx.reply(`👤 ${studentName}\n\n${l.teacherLabel}`, { reply_markup: buildTeacherKeyboard(ctx) });
    state.kbMessageId = sentMsg.message_id;
  } else if (step === 'review') {
    const sentMsg = await showReview(ctx);
    state.kbMessageId = sentMsg ? sentMsg.message_id : null;
  }
}

async function showReview(ctx) {
  const state = getState(ctx);
  const l = T[state.lang];
  const studentName = state.student?.name || 'Unknown';

  const energyLabel = l.energy[state.energy] || state.energy || '-';
  const behaviorLabel = l.behavior[state.behavior] || state.behavior || '-';
  const strengthsStr = state.strengths.length ? state.strengths.map(s => `✅ ${s}`).join('\n') : '⬜ None';
  const weaknessesStr = state.weaknesses.length ? state.weaknesses.map(w => `❌ ${w}`).join('\n') : '⬜ None';
  const lastAsanaDisplay = state.lastAsana || '-';
  const toFixDisplay = state.toFix || '-';
  const teacherDisplay = state.teacherName || 'Not selected';
  const passDisplay = state.lastAsanaPass === true ? '✅ PASS' : state.lastAsanaPass === false ? '❌ HOLD' : '-';

  const reviewText = `${l.reviewTitle} - ${studentName}\n\n` +
    `👨‍🏫 Teacher: ${teacherDisplay}\n` +
    `📹 Last Asana: ${lastAsanaDisplay}\n\n` +
    `⚡ Energy: ${energyLabel}\n` +
    `🏃 Flow: ${behaviorLabel}\n` +
    `🔧 To Fix: ${toFixDisplay}\n\n` +
    `💪 Strengths:\n${strengthsStr}\n\n` +
    `📌 Weaknesses:\n${weaknessesStr}\n\n` +
    `🗳️ Vote: ${passDisplay}`;

  return await ctx.reply(reviewText, { reply_markup: buildConfirmKeyboard(ctx) });
}

// The assessment flow is DM-only. Bail on any update from a group/supergroup
// so the bot stays silent inside student workshop chats.
const isPrivate = (ctx) => ctx.chat?.type === 'private';

// ============ COMMAND HANDLERS ============
bot.command('start', async (ctx) => {
  if (!isPrivate(ctx)) return;
  const state = getState(ctx);
  state.lang = 'en';
  state.step = 0;
  state.student = null;

  const todayCount = await getTodayAssessmentCount(ctx.from.id);
  const todayMsg = todayCount > 0
    ? `\n\n📅 ${t(ctx, 'assessmentsDone', { count: todayCount })}`
    : '';

  await ctx.reply(t(ctx, 'start') + todayMsg, { reply_markup: buildMainMenuKeyboard(ctx) });
});

bot.command('cancel', async (ctx) => {
  if (!isPrivate(ctx)) return;
  const state = getState(ctx);
  Object.assign(state, { student: null, strengths: [], weaknesses: [], energy: null, behavior: null, practiceConsistency: null, lastAsana: '', lastAsanaPass: null, toFix: '', step: 0, searchMode: false, kbMessageId: null, teacherName: null });
  await ctx.reply('Cancelled. /start to begin again.');
});

bot.command('students', async (ctx) => {
  if (!isPrivate(ctx)) return;
  const state = getState(ctx);
  state.step = 0;
  const students = await getStudentsSortedByCompleteness();
  await ctx.reply(t(ctx, 'selectStudent'), { reply_markup: buildStudentKeyboard(students, ctx) });
});

bot.command('search', async (ctx) => {
  if (!isPrivate(ctx)) return;
  const state = getState(ctx);
  state.searchMode = true;
  await ctx.reply(t(ctx, 'enterStudentName'));
});

// ============ CALLBACK HANDLERS ============
bot.on('callback_query', async (ctx) => {
  if (!isPrivate(ctx)) return;
  const query = ctx.callbackQuery.data;
  const state = getState(ctx);
  const l = T[state.lang];

  await ctx.answerCallbackQuery();

  // Language
  if (query.startsWith('lang:')) {
    state.lang = query.split(':')[1];
    state.step = 0;
    await ctx.reply(T[state.lang].start, { reply_markup: buildMainMenuKeyboard(ctx) });
    return;
  }

  // Noop
  if (query === 'noop') return;

  // Cancel
  if (query === 'cancel') {
    Object.assign(state, { student: null, strengths: [], weaknesses: [], energy: null, behavior: null, practiceConsistency: null, lastAsana: '', lastAsanaPass: null, toFix: '', step: 0, searchMode: false, kbMessageId: null, teacherName: null });
    await ctx.reply('Cancelled.', { reply_markup: buildMainMenuKeyboard(ctx) });
    return;
  }

  // Back navigation
  if (query.startsWith('back:')) {
    const target = query.split(':')[1];
    if (target === 'teacher') {
      state.step = 7;
      await ctx.answerCallbackQuery();
      await ctx.reply(T[state.lang].toFixLabel);
    } else if (target === '6') {
      // back from last asana text → go to step 6 (Practice Flow)
      state.step = 6;
      await ctx.answerCallbackQuery();
      await ctx.reply(T[state.lang].lastAsanaLabel);
    } else if (target === '5') {
      // back from behavior → go to step 5 (Practice Consistency)
      state.step = 5;
      await ctx.answerCallbackQuery();
      await sendStep(ctx, 5);
    } else {
      const targetStep = parseInt(target);
      state.step = targetStep;
      await sendStep(ctx, targetStep);
    }
    return;
  }

  // Pagination
  if (query.startsWith('page:')) {
    const page = parseInt(query.split(':')[1]);
    const students = state.searchResults.length ? state.searchResults : await getStudentsSortedByCompleteness();
    await ctx.reply(t(ctx, 'selectStudent'), { reply_markup: buildStudentKeyboard(students, ctx, page) });
    return;
  }

  // Search
  if (query === 'search') {
    state.searchMode = true;
    await ctx.reply(t(ctx, 'enterStudentName'));
    return;
  }

  // All students (A-Z)
  if (query === 'all') {
    const students = await getAllStudents();
    state.searchResults = students;
    await ctx.reply(t(ctx, 'selectStudent'), { reply_markup: buildStudentKeyboard(students, ctx) });
    return;
  }

  // Student list
  if (query === 'studentlist') {
    const students = await getStudentsSortedByCompleteness();
    await ctx.reply(t(ctx, 'selectStudent'), { reply_markup: buildStudentKeyboard(students, ctx) });
    return;
  }

  // Change language
  if (query === 'changelang') {
    await ctx.reply(t(ctx, 'chooseLang'), { reply_markup: buildLangKeyboard() });
    return;
  }

  // History
  if (query === 'history') {
    await ctx.reply(t(ctx, 'enterStudentName'));
    state.step = 'history_search';
    return;
  }

  // Student selection
  if (query.startsWith('student:')) {
    const studentId = query.split(':')[1];  // UUID string, not integer
    const students = state.searchResults.length ? state.searchResults : await getStudentsSortedByCompleteness();
    const student = students.find(s => s.id === studentId);

    if (!student) {
      await ctx.reply('Student not found. Please search again.');
      return;
    }

    state.student = student;
    state.searchResults = [];
    state.step = 1;
    state.strengths = [];
    state.weaknesses = [];
    state.energy = null;
    state.behavior = null;
    state.practiceConsistency = null;
    state.lastAsana = '';
    state.lastAsanaPass = null;
    state.toFix = '';

    // Load existing tags for this student
    const existingTags = await getStudentTags(studentId);
    state.strengths = existingTags.filter(t => t.type === 'strength').map(t => t.name);
    state.weaknesses = existingTags.filter(t => t.type === 'weakness').map(t => t.name);

    // Weekly strengths/weaknesses: only ask on Mondays (day 1) if not yet set this week
    const today = new Date();
    const dayOfWeek = today.getDay(); // 0=Sun, 1=Mon
    const needsWeekly = dayOfWeek === 1 && (!state.strengths.length || !state.weaknesses.length);

    if (needsWeekly) {
      // Monday and needs setup - ask strengths first
      await sendStep(ctx, 1);
    } else {
      // Skip strengths/weaknesses - go straight to energy (step 3)
      state.step = 3;
      await sendStep(ctx, 3);
    }
    return;
  }

  // Tag toggle
  if (query.startsWith('tag:')) {
    const tagName = query.split(':')[1];
    const currentStep = state.step;

    if (currentStep === 1) {
      const idx = state.strengths.indexOf(tagName);
      if (idx >= 0) {
        state.strengths.splice(idx, 1);
        await removeTag(state.student.id, tagName, 'strength');
      } else {
        state.strengths.push(tagName);
        await addTag(state.student.id, tagName, 'strength');
      }
      const existingTags = await getTags('strength');
      const displayTags = existingTags.length ? existingTags : ['Core Strength', 'Flexibility', 'Breath Control', 'Balance', 'Stamina', 'Focus'];
      const newKeyboard = buildTagKeyboard(displayTags, state.strengths, ctx, 'strength');
      await ctx.answerCallbackQuery();
      if (state.kbMessageId) {
        await ctx.editMessageReplyMarkup({ reply_markup: newKeyboard });
      }
    } else if (currentStep === 2) {
      const idx = state.weaknesses.indexOf(tagName);
      if (idx >= 0) {
        state.weaknesses.splice(idx, 1);
        await removeTag(state.student.id, tagName, 'weakness');
      } else {
        state.weaknesses.push(tagName);
        await addTag(state.student.id, tagName, 'weakness');
      }
      const existingTags = await getTags('weakness');
      const displayTags = existingTags.length ? existingTags : ['Chaturanga', 'Jump Back', 'Core', 'Balance', 'Flexibility', 'Breathing'];
      const newKeyboard = buildTagKeyboard(displayTags, state.weaknesses, ctx, 'weakness');
      await ctx.answerCallbackQuery();
      if (state.kbMessageId) {
        await ctx.editMessageReplyMarkup({ reply_markup: newKeyboard });
      }
    }
    return;
  }

  // Add new tag
  if (query.startsWith('addnew:')) {
    const type = query.split(':')[1];
    state.step = `add_${type}`;
    const prompt = type === 'strength' ? l.strengthLabel : l.weaknessLabel;
    await ctx.reply(`${prompt}\n\n${l.typeHere}:\n(Enter new ${type} name)`);
    return;
  }

  // Done selecting tags
  if (query.startsWith('done:')) {
    const type = query.split(':')[1];
    const today = new Date().toISOString().split('T')[0];
    if (type === 'strength') {
      state.strengthsWeekStart = today;
      state.step = 2;
      await sendStep(ctx, 2);
    } else {
      state.weaknessesWeekStart = today;
      state.step = 3;
      await sendStep(ctx, 3);
    }
    return;
  }

  // Energy
  if (query.startsWith('energy:')) {
    state.energy = query.split(':')[1];
    state.step = 4;
    const newKeyboard = buildPracticeConsistencyKeyboard(ctx);
    await ctx.answerCallbackQuery();
    if (state.kbMessageId) {
      await ctx.editMessageReplyMarkup({ reply_markup: newKeyboard });
    }
    return;
  }

  // Practice Consistency
  if (query.startsWith('pc:')) {
    state.practiceConsistency = query.split(':')[1];
    state.step = 5;
    const newKeyboard = buildBehaviorKeyboard(ctx);
    await ctx.answerCallbackQuery();
    if (state.kbMessageId) {
      await ctx.editMessageReplyMarkup({ reply_markup: newKeyboard });
    }
    return;
  }

  // Behavior
  if (query.startsWith('behavior:')) {
    state.behavior = query.split(':')[1];
    state.step = 6;
    await ctx.answerCallbackQuery();
    // Move to step 6 - last asana (text input, no keyboard to edit)
    await ctx.reply(T[state.lang].lastAsanaLabel);
    return;
  }

  // Teacher selection
  if (query.startsWith('teacher:')) {
    state.teacherName = query.split(':')[1];
    state.step = 'review';
    await ctx.answerCallbackQuery();
    await showReview(ctx);
    return;
  }

  // Vote: pass or hold
  if (query.startsWith('vote:')) {
    const vote = query.split(':')[1];
    state.lastAsanaPass = (vote === 'pass');
    state.step = 7;
    await ctx.answerCallbackQuery();
    await ctx.reply(T[state.lang].toFixLabel);
    return;
  }

  // Confirm
  if (query === 'confirm') {
    const teacherName = state.teacherName || 'Teacher';
    const studentName = state.student.name;

    await saveAssessment({
      teacherId: ctx.from.id,
      teacherName,
      studentId: state.student.id,
      strengths: state.strengths,
      weaknesses: state.weaknesses,
      energy: state.energy,
      behavior: state.behavior,
      lastAsana: state.lastAsana,
      lastAsanaPass: state.lastAsanaPass,
      toFix: state.toFix
    });

    // Store for LINE notify before reset
    const notifyData = { studentName, teacherName, lastAsanaPass: state.lastAsanaPass, lastAsana: state.lastAsana, toFix: state.toFix, practiceConsistency: state.practiceConsistency };
    state._pendingNotify = notifyData;

    await ctx.reply(t(ctx, 'saved', { student: studentName }), { reply_markup: buildNotifyKeyboard(ctx) });

    // Reset assessment state (but keep _pendingNotify)
    Object.assign(state, { student: null, strengths: [], weaknesses: [], energy: null, behavior: null, practiceConsistency: null, lastAsana: '', lastAsanaPass: null, toFix: '', step: 0, kbMessageId: null, teacherName: null });
    return;
  }

  // Notify LINE group
  if (query === 'notifyline') {
    const notifyData = state._pendingNotify;
    if (notifyData) {
      const sent = await notifyLINEGroup(notifyData.studentName, notifyData.teacherName, notifyData.lastAsanaPass, notifyData.lastAsana, notifyData.toFix);
      if (sent) {
        await ctx.answerCallbackQuery({ text: '✅ LINE message sent!' });
      } else {
        await ctx.answerCallbackQuery({ text: '❌ LINE failed. Try again or skip.' });
        return;
      }
    }
    delete state._pendingNotify;
    await ctx.reply('📱 LINE notified! M & Jamsai will see the assessment on their LINE.\n\nReady for next assessment.', { reply_markup: buildMainMenuKeyboard(ctx) });
    return;
  }

  // New assessment (from notify screen)
  if (query === 'newassessment') {
    delete state._pendingNotify;
    await ctx.reply('Select a student to assess:', { reply_markup: buildMainMenuKeyboard(ctx) });
    return;
  }

  // Edit - go back to step 1
  if (query === 'edit') {
    state.step = 1;
    await sendStep(ctx, 1);
    return;
  }
});

// ============ MESSAGE HANDLER ============
bot.on('message', async (ctx) => {
  if (!isPrivate(ctx)) return;
  const state = getState(ctx);
  const msg = ctx.message.text;
  if (!msg) return;
  const l = T[state.lang];

  // Main menu buttons
  if (msg.includes('🌐') || msg.includes('Language') || msg.includes('ภาษา') || msg.includes('语言')) {
    await ctx.reply(t(ctx, 'chooseLang'), { reply_markup: buildLangKeyboard() });
    return;
  }

  if (msg.includes('📋') && msg.includes('All')) {
    const students = await getAllStudents();
    state.searchResults = students;
    await ctx.reply(t(ctx, 'selectStudent'), { reply_markup: buildStudentKeyboard(students, ctx) });
    return;
  }

  if (msg.includes('🔍') || msg.includes('Search')) {
    state.searchMode = true;
    await ctx.reply(t(ctx, 'enterStudentName'));
    return;
  }

  if (msg.includes('📊') && !msg.includes('history')) {
    state.step = 'history_search';
    await ctx.reply(t(ctx, 'enterStudentName'));
    return;
  }

  // Search mode
  if (state.searchMode || state.step === 'history_search') {
    if (msg.toLowerCase() === 'all') {
      const students = await getAllStudents();
      state.searchResults = students;
      state.searchMode = false;
      await ctx.reply(t(ctx, 'selectStudent'), { reply_markup: buildStudentKeyboard(students, ctx) });
      return;
    }

    let results;
    try {
      results = await searchStudents(msg);
    } catch(e) {
      console.error('Search error:', e.message);
      results = [];
    }

    if (results.length === 0) {
      await ctx.reply(l.noResults);
      return;
    }

    if (state.step === 'history_search') {
      // Show history for first result
      const student = results[0];
      const history = await getStudentHistory(student.id);
      if (history.length === 0) {
        await ctx.reply(`📊 ${student.name}\n\n${l.notAssessed}`);
      } else {
        let historyText = `📊 ${student.name} - ${l.viewHistory}\n\n`;
        history.forEach((h, i) => {
          const date = h.date ? new Date(h.date).toLocaleDateString() : 'N/A';
          historyText += `${i + 1}. ${date}\n`;
          historyText += `   ⚡${h.energy || '-'} 🏃${h.behavior || '-'}\n`;
          historyText += `   📹 ${h.lastAsana || '-'}\n`;
          historyText += `   🔧 ${h.toFix || '-'}\n\n`;
        });
        await ctx.reply(historyText, { reply_markup: buildMainMenuKeyboard(ctx) });
      }
      state.step = 0;
      return;
    }

    state.searchResults = results;
    await ctx.reply(t(ctx, 'searchResults') + ` (${results.length})`, { reply_markup: buildStudentKeyboard(results, ctx) });
    return;
  }

  // Add new tag
  if (state.step === 'add_strength' || state.step === 'add_weakness') {
    const type = state.step === 'add_strength' ? 'strength' : 'weakness';
    if (type === 'strength') {
      state.strengths.push(msg);
      await addTag(state.student.id, msg, 'strength');
    } else {
      state.weaknesses.push(msg);
      await addTag(state.student.id, msg, 'weakness');
    }
    state.step = type === 'strength' ? 1 : 2;
    await sendStep(ctx, state.step);
    return;
  }

  // Free text: Last asana comment (step 5) → then go to vote
  if (state.step === 5) {
    state.lastAsana = msg;
    state.step = 'vote';
    await sendStep(ctx, 'vote');
    return;
  }

  // Free text: To fix (step 6)
  if (state.step === 6) {
    state.toFix = msg;
    state.step = 'teacher';
    await sendStep(ctx, 'teacher');
    return;
  }

  // Default: show menu
  if (state.lang) {
    const todayCount = await getTodayAssessmentCount(ctx.from.id);
    const todayMsg = todayCount > 0 ? `\n\n📅 ${t(ctx, 'assessmentsDone', { count: todayCount })}` : '';
    await ctx.reply(t(ctx, 'start') + todayMsg, { reply_markup: buildMainMenuKeyboard(ctx) });
  }
});

// ============ START ============
async function main() {
  try {
    await driver.verifyConnectivity();
    console.log('✓ Neo4j connected');
  } catch (e) {
    console.error('✗ Neo4j connection failed:', e.message);
  }

  // ── Global Error Handlers ──────────────────────────────────────────────
  process.on('uncaughtException', (err) => {
    console.error('UNCAUGHT EXCEPTION:', err.message);
  });

  process.on('unhandledRejection', (reason) => {
    console.error('UNHANDLED REJECTION:', reason);
  });

  bot.catch((err) => {
    console.error('Bot error:', err.message);
  });

  // Russia bot's scheduler starts after bot polls (so it can use bot.api)
  if (russia && russia.startScheduler) russia.startScheduler(bot);

  // Explicitly request my_chat_member updates so the auto-detect-on-add DM works
  // (Telegram doesn't include these in long-poll by default).
  bot.start({
    allowed_updates: ['message', 'callback_query', 'my_chat_member', 'chat_member', 'edited_message'],
  });
  console.log('✓ AYBKK Student Progress Bot started');
  console.log('  Bot: @AYBKKstudentProgress_bot');
}

main().catch(console.error);

process.on('SIGINT', () => {
  driver.close();
  process.exit();
});
