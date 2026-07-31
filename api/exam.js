/* api/exam.js — In-depth CN#2 final exam.
   Student side: pick your name, sit a randomly drawn paper, submit.
   Teacher side: token-gated review of every written answer, with a suggested
   grade Boonchu confirms or overrides.

   The question bank never reaches the browser. The server draws each paper,
   strips the correct flags, and grades on submission. */

const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');

const BANK = require('../exam-bank-cn2');
const { drawForStudent, answerKeyFor, buildPaper } = require('../lib/exam-draw');

const COHORT = 'in-depth-mysore-cn2';
const EXAM_ID = 'cn2-final-2026';
const MARKS_PER_Q = 3; // 1 for the tick, 2 for the explanation
const EXAM_MINUTES = 120;
const MIN_WORDS = 5;   // in units: one Latin word, or two Chinese characters

/* Chinese has no spaces, so whitespace tokens would score a whole Chinese sentence
   as one word. Count in units instead: one Latin word, or two Chinese characters,
   which makes the bar mean roughly the same amount of thought in either language.
   The bar only has to stop "ok" and "好". A short correct reason must pass, because
   the marking rubric still gives it most of the explanation marks. */
function countWords(s) {
  const t = String(s || '').trim();
  if (!t) return 0;
  const cjk = (t.match(/[一-鿿぀-ヿ]/g) || []).length;
  const latin = (t.replace(/[一-鿿぀-ヿ]/g, ' ')
                  .match(/[A-Za-z0-9'’À-ɏ]+/g) || []).length;
  return latin + Math.ceil(cjk / 2);
}

/* Two seats for the teachers to sit the paper themselves before the students do.
   They need no Student node, they never write an attempt, and they can retake as
   often as they like, so trying the exam can never touch the real results. */
const TEST_SEATS = [
  { id: 'test-boonchu', name: 'Boonchu (test)', chineseName: '测试席位' },
  { id: 'test-jamsai',  name: 'Jamsai (test)',  chineseName: '测试席位' }
];
const isTestSeat = id => TEST_SEATS.some(s => s.id === id);

/* The eleven who sat Part 3, named explicitly rather than read from classType.
   The tag in the graph is wrong in three ways: it still carries Cris, who did not
   attend, and it is missing QiaoQiao and Xiao Ma entirely, so two students could
   not have sat the exam at all. An exam roster must not depend on a tag being
   tidy on the night.

   Ids were chosen by journal history, because a record with real check-ins is the
   student's actual account and the zero check-in duplicates are workshop signup
   forms. Two are marked verify: they had more than one plausible record.
   Cris Shudi and TinaQian are deliberately absent. */
const COHORT_ROSTER = [
  { id: '4c576442-e2c0-4884-9878-d97cd62ee8d3', name: 'Yi yang',  chineseName: '徐一洋' },
  { id: 'ws-1774548685162',                     name: 'QiaoQiao', chineseName: '乔畅', verify: true },
  { id: '0522af73-efb6-46a5-a73b-c5023f8affeb', name: 'Lisa',     chineseName: '赵丽云' },
  { id: 'ws-1774682257163',                     name: 'Xiao Ma',  chineseName: '马雪琴', verify: true },
  { id: '9453f2ba-ba16-47f1-bbf9-1da116c5dea3', name: 'XiaoQin',  chineseName: '李琴琴' },
  { id: 'd3abf781-32c8-4f0f-b7df-624addca3511', name: 'Yu Lang',  chineseName: '余浪' },
  { id: 'a03da5a9-bc6e-4fc6-bfbf-fa54fcd83e95', name: 'GuiGui',   chineseName: '王国贵' },
  { id: '1971e49e-a9c6-41ea-b7a4-55f104dec8a9', name: 'Lee',      chineseName: '李雨杰' },
  { id: 'c0b4d60e-df44-4b8d-93fa-854b4081de02', name: 'Tinyee',   chineseName: '李亭逸' },
  { id: 'e2568186-8aff-4f58-b429-fc2ce9d94b28', name: 'Much',     chineseName: '马驰' },
  { id: 'd7e82761-191f-4723-bbb5-a9eb7a65b8b1', name: 'Wini',     chineseName: '王榕榕' },
];

/* Append-only disk copy of every submitted paper, written before the graph write.
   This is the safety net: if Neo4j is unreachable, slow, or the write silently
   matches nothing, the student's answers still exist on disk and can be replayed.
   One JSON object per line, so a partial write can never corrupt earlier rows. */
const fs = require('fs');
const path = require('path');
const EXAM_BACKUP_DIR = process.env.EXAM_BACKUP_DIR
  || (fs.existsSync('/data') ? '/data' : path.join(__dirname, '..', 'exam-submissions'));

async function backupSubmission(record) {
  fs.mkdirSync(EXAM_BACKUP_DIR, { recursive: true });
  const file = path.join(EXAM_BACKUP_DIR, `exam-${record.examId}.jsonl`);
  await fs.promises.appendFile(file, JSON.stringify(record) + '\n', 'utf8');
  const { size } = await fs.promises.stat(file);
  return { file, bytes: size };
}

/* Tell Boonchu a paper has landed. Never allowed to break a submission, so every
   failure is swallowed: a student must never see an error because Telegram is down. */
async function notifyBoonchu(text) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.BOONCHU_CHAT_ID;
  if (!token || !chatId) return false;
  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown' })
    });
    return (await r.json()).ok;
  } catch (e) {
    console.error('exam notify failed:', e.message);
    return false;
  }
}

function checkTeacherAuth(req) {
  const expected = process.env.TEACHER_TOKEN;
  if (!expected) return false;
  const got = req.headers['x-teacher-token'] || req.query.token;
  return got === expected;
}

/* ---------------------------------------------------------------- roster */
/* Serves COHORT_ROSTER, the explicit list of the eleven who sat Part 3. The
   graph is consulted only for who has already submitted, so a wrong or missing
   classType tag cannot drop a student from the exam or add one who left. */
router.get('/roster', async (req, res) => {
  const session = req.driver.session();
  try {
    const result = await session.run(
      `MATCH (s:Student)-[:TOOK]->(a:ExamAttempt {examId: $examId})
       WHERE s.id IN $ids OR s.pgId IN $ids OR s.studentId IN $ids
       RETURN DISTINCT s.id AS id`,
      { examId: EXAM_ID, ids: COHORT_ROSTER.map(s => s.id) }
    );
    const done = new Set(result.records.map(r => r.get('id')));
    const students = COHORT_ROSTER.map(s => ({
      id: s.id, name: s.name, chineseName: s.chineseName,
      submitted: done.has(s.id)
    }));
    const seats = TEST_SEATS.map(s => ({ ...s, submitted: false, isTest: true }));
    res.json({ success: true, students: students.concat(seats), count: students.length });
  } catch (error) {
    /* even with the graph down the full roster still renders; only the
       "submitted" badges are lost until it returns */
    console.error('exam roster error:', error);
    const students = COHORT_ROSTER.map(s => ({
      id: s.id, name: s.name, chineseName: s.chineseName, submitted: false
    }));
    const seats = TEST_SEATS.map(s => ({ ...s, submitted: false, isTest: true }));
    res.json({ success: true, students: students.concat(seats), count: students.length, degraded: true });
  } finally {
    await session.close();
  }
});

/* ------------------------------------------------------------------ paper */
/* Deterministic per student, so a reload never reshuffles mid-exam.
   Correct answers are stripped before this leaves the server. */
router.get('/paper/:studentId', async (req, res) => {
  const { studentId } = req.params;

  if (isTestSeat(studentId)) {
    const seat = TEST_SEATS.find(s => s.id === studentId);
    const paper = drawForStudent(BANK, studentId, EXAM_ID, { allowShort: true });
    return res.json({
      success: true, isTest: true,
      studentId, name: seat.name, chineseName: seat.chineseName,
      total: paper.questions.length * MARKS_PER_Q,
      questions: paper.questions
    });
  }

  const session = req.driver.session();
  try {
    const found = await session.run(
      `MATCH (s:Student) WHERE s.id = $id OR s.pgId = $id OR s.studentId = $id
       OPTIONAL MATCH (s)-[:TOOK]->(a:ExamAttempt {examId: $examId})
       RETURN s.name AS name, s.chineseName AS chineseName, count(a) AS attempts`,
      { id: studentId, examId: EXAM_ID }
    );
    if (!found.records.length) return res.status(404).json({ error: 'student not found' });
    if (Number(found.records[0].get('attempts') || 0) > 0) {
      return res.status(409).json({ error: 'already_submitted' });
    }

    const paper = drawForStudent(BANK, studentId, EXAM_ID);
    /* the roster name wins over the graph name, so Xiao Ma is not greeted as
       "Sharma", the alias her database record happens to carry */
    const rosterEntry = COHORT_ROSTER.find(r => r.id === studentId);
    res.json({
      success: true,
      studentId,
      name: (rosterEntry && rosterEntry.name) || found.records[0].get('name'),
      chineseName: (rosterEntry && rosterEntry.chineseName)
        || found.records[0].get('chineseName') || null,
      total: paper.questions.length * MARKS_PER_Q,
      questions: paper.questions
    });
  } catch (error) {
    console.error('exam paper error:', error);
    res.status(500).json({ error: error.message });
  } finally {
    await session.close();
  }
});

/* ------------------------------------------- teacher: preview with answers */
/* The exact paper a given seat will receive, with the correct option marked and
   the model written answer shown. Token gated, because this is the answer key. */
router.get('/preview/:studentId', async (req, res) => {
  if (!checkTeacherAuth(req)) return res.status(401).json({ error: 'unauthorized' });
  try {
    const { studentId } = req.params;

    /* seat "all" shows the whole bank rather than one drawn paper, grouped by
       lecture, so the entire question set can be read in one pass. */
    if (studentId === 'all') {
      const ORDER = ['Psychology of Learning','Shoulder Screening','Three Doshas',
                     'Hormones','Five Kleshas','Pranayama'];
      const sorted = [...BANK].sort(
        (a, b) => ORDER.indexOf(a.lecture) - ORDER.indexOf(b.lecture)
      );
      return res.json({
        success: true, studentId: 'all', count: sorted.length,
        questions: sorted.map((q, i) => ({
          n: i + 1, id: q.id, lecture: q.lecture, topic: q.topic,
          stem_en: q.stem_en, stem_zh: q.stem_zh,
          correct: (q.options.find(o => o.correct) || {}).label,
          options: q.options.map(o => ({
            label: o.label, text_en: o.text_en, text_zh: o.text_zh,
            isCorrect: !!o.correct, note: o.note || ''
          })),
          expected_en: q.explanationExpected_en || '',
          expected_zh: q.explanationExpected_zh || '',
          teacherPoint: q.teacherPoint || ''
        }))
      });
    }
    const paper = buildPaper(BANK, studentId, EXAM_ID, { allowShort: true });
    const byId = new Map(BANK.map(q => [q.id, q]));
    const questions = paper.questions.map((q, i) => {
      const src = byId.get(q.id) || {};
      return {
        n: i + 1,
        id: q.id,
        lecture: q.lecture,
        stem_en: q.stem_en,
        stem_zh: q.stem_zh,
        correct: paper.key[q.id],
        options: q.options.map(o => {
          const orig = (src.options || []).find(
            x => x.text_en === o.text_en
          ) || {};
          return { ...o, isCorrect: o.label === paper.key[q.id], note: orig.note || '' };
        }),
        expected_en: src.explanationExpected_en || '',
        expected_zh: src.explanationExpected_zh || '',
        teacherPoint: src.teacherPoint || ''
      };
    });
    res.json({ success: true, studentId, count: questions.length, questions });
  } catch (error) {
    console.error('exam preview error:', error);
    res.status(500).json({ error: error.message });
  }
});

/* ----------------------------------------------------------------- submit */
/* answers: [{ id, choice: 'A'..'D', explanation: '...' }] */
router.post('/submit', async (req, res) => {
  const session = req.driver.session();
  try {
    const { studentId, answers, language, startedAt, autoSubmit } = req.body;
    if (!studentId || !Array.isArray(answers)) {
      return res.status(400).json({ error: 'studentId and answers required' });
    }

    const key = answerKeyFor(BANK, studentId, EXAM_ID, { allowShort: isTestSeat(studentId) });
    const byId = new Map(BANK.map(q => [q.id, q]));

    /* Every question needs a tick and a real written reason. The bar is low on
       purpose: it blocks "ok" and "好", not short answers, because a brief correct
       reason still earns most of the explanation marks. Chinese has no spaces, so
       a CJK character counts as a word or a 15 character answer would read as one. */
    const incomplete = answers.filter(
      a => !a.choice || countWords(a.explanation) < MIN_WORDS
    );

    /* An automatic submission at the two hour limit must save whatever exists.
       Refusing a partial paper here would throw away the whole sitting. */
    if (incomplete.length && !autoSubmit) {
      return res.status(400).json({
        error: 'incomplete',
        minWords: MIN_WORDS,
        missing: incomplete.map(a => a.id)
      });
    }

    // a teacher trying the paper is scored and shown the result, but nothing is stored
    if (isTestSeat(studentId)) {
      let right = 0;
      const detail = answers.map(a => {
        const ok = a.choice === key[a.id];
        if (ok) right++;
        const q = byId.get(a.id) || {};
        return {
          id: a.id, lecture: q.lecture || '', stem_en: q.stem_en || '',
          choice: a.choice, correct: key[a.id], tickRight: ok,
          expected_en: q.explanationExpected_en || '',
          teacherPoint: q.teacherPoint || ''
        };
      });
      return res.json({
        success: true, isTest: true, stored: false,
        ticksCorrect: right, questionCount: answers.length, detail
      });
    }

    let ticksCorrect = 0;
    const graded = answers.map(a => {
      const correct = key[a.id];
      const isRight = a.choice === correct;
      if (isRight) ticksCorrect++;
      const q = byId.get(a.id) || {};
      return {
        id: a.id,
        lecture: q.lecture || '',
        choice: a.choice,
        correct,
        tickMark: isRight ? 1 : 0,
        explanation: String(a.explanation || '').trim(),
        words: countWords(a.explanation),
        answered: !!a.choice && countWords(a.explanation) >= MIN_WORDS,
        // filled in later by the analysis pass, then confirmed by Boonchu
        suggestedMark: null,
        finalMark: null,
        category: null,
        analysisEn: null,
        analysisZh: null,
        status: 'pending'
      };
    });

    const attemptId = uuidv4();
    const now = new Date().toISOString();
    const answersJson = JSON.stringify(graded); // Neo4j cannot store nested maps

    /* Write a durable copy to disk BEFORE touching the graph. If the graph write
       then fails for any reason, the paper still exists and can be replayed.
       A failure here must never block a student from submitting, so it is caught. */
    let backup = null;
    try {
      backup = await backupSubmission({
        attemptId, studentId, examId: EXAM_ID, submittedAt: now,
        startedAt: startedAt || null, autoSubmitted: !!autoSubmit,
        unanswered: incomplete.length,
        questionCount: graded.length, ticksCorrect,
        language: language || 'zh', answers: graded
      });
    } catch (e) {
      console.error('exam backup failed (continuing):', e.message);
    }

    /* One statement that refuses a second attempt and confirms what it wrote.
       MERGE on the student plus a guard on existing attempts makes a double tap,
       a retry after a timeout, and a duplicate request all land on the same row. */
    const wrote = await session.run(
      `MATCH (s:Student)
       WHERE s.id = $studentId OR s.pgId = $studentId OR s.studentId = $studentId
       OPTIONAL MATCH (s)-[:TOOK]->(prev:ExamAttempt {examId: $examId})
       WITH s, collect(prev) AS existing
       CALL apoc.do.when(
         size(existing) > 0,
         'RETURN existing[0] AS a, true AS dup',
         'CREATE (a:ExamAttempt {
            id: $attemptId, examId: $examId,
            questionCount: $questionCount, totalMarks: $totalMarks,
            ticksCorrect: $ticksCorrect, answers: $answers,
            language: $language, status: "pending",
            startedAt: $startedAt, durationSec: $durationSec,
            autoSubmitted: $autoSubmitted, unanswered: $unanswered,
            submittedAt: datetime($now)
          })
          CREATE (s)-[:TOOK]->(a)
          RETURN a AS a, false AS dup',
         {s:s, existing:existing, attemptId:$attemptId, examId:$examId,
          questionCount:$questionCount, totalMarks:$totalMarks,
          ticksCorrect:$ticksCorrect, answers:$answers, language:$language, now:$now}
       ) YIELD value
       RETURN value.a.id AS id, value.dup AS duplicate`,
      {
        studentId, attemptId, examId: EXAM_ID,
        questionCount: graded.length,
        totalMarks: graded.length * MARKS_PER_Q,
        ticksCorrect, answers: answersJson,
        language: language || 'zh', now,
        startedAt: startedAt || null,
        durationSec: startedAt ? Math.round((Date.parse(now) - Date.parse(startedAt)) / 1000) : null,
        autoSubmitted: !!autoSubmit,
        unanswered: incomplete.length
      }
    ).catch(async (err) => {
      // APOC is not installed on every deployment. Fall back to a guarded
      // two-step, which is still safe because the guard runs server side.
      if (!/apoc/i.test(err.message || '')) throw err;
      const dup = await session.run(
        `MATCH (s:Student)-[:TOOK]->(a:ExamAttempt {examId: $examId})
         WHERE s.id = $studentId OR s.pgId = $studentId OR s.studentId = $studentId
         RETURN a.id AS id LIMIT 1`,
        { studentId, examId: EXAM_ID }
      );
      if (dup.records.length) {
        return { records: [{ get: k => k === 'id' ? dup.records[0].get('id') : true }] };
      }
      return session.run(
        `MATCH (s:Student)
         WHERE s.id = $studentId OR s.pgId = $studentId OR s.studentId = $studentId
         CREATE (a:ExamAttempt {
           id: $attemptId, examId: $examId,
           questionCount: $questionCount, totalMarks: $totalMarks,
           ticksCorrect: $ticksCorrect, answers: $answers,
           language: $language, status: 'pending',
           startedAt: $startedAt, durationSec: $durationSec,
           autoSubmitted: $autoSubmitted, unanswered: $unanswered,
           submittedAt: datetime($now)
         })
         CREATE (s)-[:TOOK]->(a)
         RETURN a.id AS id, false AS duplicate`,
        {
          studentId, attemptId, examId: EXAM_ID,
          questionCount: graded.length,
          totalMarks: graded.length * MARKS_PER_Q,
          ticksCorrect, answers: answersJson,
          language: language || 'zh', now,
          startedAt: startedAt || null,
          durationSec: startedAt ? Math.round((Date.parse(now) - Date.parse(startedAt)) / 1000) : null,
          autoSubmitted: !!autoSubmit,
          unanswered: incomplete.length
        }
      );
    });

    /* The bug this replaces: the old code discarded this result. When the student
       id matched no node, Cypher returned zero rows, nothing was written, and the
       student was still told "submitted". Never report success unwitnessed. */
    if (!wrote.records.length) {
      console.error('exam submit: no node written for studentId', studentId);
      return res.status(500).json({
        error: 'not_saved',
        message: 'Your paper was not saved. Do not close this page, try submitting again.',
        backup: backup || undefined
      });
    }

    const savedId = wrote.records[0].get('id');
    const wasDuplicate = !!wrote.records[0].get('duplicate');

    // Read it back. Only a successful read proves the paper is in the database.
    const verify = await session.run(
      `MATCH (a:ExamAttempt {id: $savedId})
       RETURN a.questionCount AS n, size(a.answers) AS bytes`,
      { savedId }
    );
    if (!verify.records.length) {
      return res.status(500).json({
        error: 'not_verified',
        message: 'Your paper may not have saved. Try submitting again.',
        backup: backup || undefined
      });
    }

    if (!wasDuplicate) {
      const mins = startedAt
        ? Math.round((Date.parse(now) - Date.parse(startedAt)) / 60000) : null;
      notifyBoonchu(
        `*Exam submitted*\n` +
        `Student: \`${studentId}\`\n` +
        `Ticks correct: ${ticksCorrect} of ${graded.length}\n` +
        (mins !== null ? `Took: ${mins} min of ${EXAM_MINUTES}\n` : '') +
        (autoSubmit ? `*Auto submitted at the time limit*\n` : '') +
        (incomplete.length ? `*Unanswered: ${incomplete.length}*\n` : '') +
        `Review: /teacher-exam-review.html`
      );
    }

    res.json({
      success: true,
      attemptId: savedId,
      duplicate: wasDuplicate,
      verified: {
        questions: Number(verify.records[0].get('n')),
        bytes: Number(verify.records[0].get('bytes'))
      },
      ticksCorrect,
      questionCount: graded.length
    });
  } catch (error) {
    console.error('exam submit error:', error);
    res.status(500).json({
      error: error.message,
      message: 'Your paper was not saved. Do not close this page, try submitting again.'
    });
  } finally {
    await session.close();
  }
});

/* ----------------------------------------------------- teacher: the queue */
router.get('/review', async (req, res) => {
  if (!checkTeacherAuth(req)) return res.status(401).json({ error: 'unauthorized' });
  const session = req.driver.session();
  try {
    const result = await session.run(
      `MATCH (s:Student)-[:TOOK]->(a:ExamAttempt {examId: $examId})
       RETURN s.id AS studentId, s.name AS name, s.chineseName AS chineseName,
              a.id AS attemptId, a.answers AS answers, a.ticksCorrect AS ticksCorrect,
              a.questionCount AS questionCount, a.totalMarks AS totalMarks,
              a.status AS status, toString(a.submittedAt) AS submittedAt
       ORDER BY a.submittedAt ASC`,
      { examId: EXAM_ID }
    );
    const byId = new Map(BANK.map(q => [q.id, q]));
    const attempts = result.records.map(r => {
      const answers = JSON.parse(r.get('answers') || '[]').map(a => {
        const q = byId.get(a.id) || {};
        const chosen = (q.options || []).find(o => o.text_en && a.choice);
        return {
          ...a,
          stem_en: q.stem_en || '',
          stem_zh: q.stem_zh || '',
          expected_en: q.explanationExpected_en || '',
          expected_zh: q.explanationExpected_zh || '',
          teacherPoint: q.teacherPoint || ''
        };
      });
      return {
        studentId: r.get('studentId'),
        name: r.get('name'),
        chineseName: r.get('chineseName') || null,
        attemptId: r.get('attemptId'),
        ticksCorrect: Number(r.get('ticksCorrect') || 0),
        questionCount: Number(r.get('questionCount') || 0),
        totalMarks: Number(r.get('totalMarks') || 0),
        status: r.get('status'),
        submittedAt: r.get('submittedAt'),
        answers
      };
    });
    res.json({ success: true, attempts, count: attempts.length });
  } catch (error) {
    console.error('exam review error:', error);
    res.status(500).json({ error: error.message });
  } finally {
    await session.close();
  }
});

/* ------------------------------------------ teacher: analyse the writing */
/* Reads each written explanation (usually Chinese), translates it, works out
   what the student was trying to say, and proposes a mark out of 2. Boonchu
   confirms or overrides. The categories separate a student who understands but
   writes thinly from one who does not understand, because those look alike on
   paper and need opposite responses from a teacher. */
const RUBRIC = `
Mark each explanation out of 2, using exactly one category:

2.0  "understands"  - names the mechanism AND the action, and links them. Length does not matter.
1.5  "thin"         - correct instinct and correct decision, but stops early. Contains a correct
                      causal link, however short. Knows it; needs vocabulary, not re-teaching.
1.0  "trying"       - engaged with the question, but the mechanism is wrong or muddled.
                      Re-teach the mechanism; the willingness is already there.
0.5  "misread"      - a coherent answer to a different question. Often language, not knowledge.
0    "absent"       - blank, restates the option back, or unrelated.

Rules:
- Judge intention, never wording. Second-language phrasing is not a defect. Never deduct for
  grammar or spelling, and never for writing in Chinese.
- A right tick with a wrong reason is worth LESS than a wrong tick with good reasoning.
- The split between 1.5 and 0 is the important one: does the answer contain a correct causal
  link, however short? "Cut the volume, she is not recovering" is 1.5. "Cut the volume" alone
  just repeats the option and is 0.
- If you are genuinely unsure, set needsBoonchu true rather than guessing.
`;

router.post('/analyse', async (req, res) => {
  if (!checkTeacherAuth(req)) return res.status(401).json({ error: 'unauthorized' });
  const session = req.driver.session();
  try {
    const { attemptId } = req.body;
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) return res.status(503).json({ error: 'OPENROUTER_API_KEY not set' });

    const cur = await session.run(
      `MATCH (s:Student)-[:TOOK]->(a:ExamAttempt {id: $attemptId})
       RETURN a.answers AS answers, s.name AS name`,
      { attemptId }
    );
    if (!cur.records.length) return res.status(404).json({ error: 'attempt not found' });

    const studentName = cur.records[0].get('name');
    const answers = JSON.parse(cur.records[0].get('answers') || '[]');
    const byId = new Map(BANK.map(q => [q.id, q]));

    const items = answers.map((a, i) => {
      const q = byId.get(a.id) || {};
      return {
        n: i + 1,
        id: a.id,
        question: q.stem_en || '',
        theyChose: a.choice,
        correctChoice: a.correct,
        tickRight: a.choice === a.correct,
        fullMarksLooksLike: q.explanationExpected_en || '',
        studentWrote: a.explanation || ''
      };
    });

    const prompt = `You are helping Boonchu Tanti mark the final exam of his Ashtanga teacher training in Zhuhai. The student is ${studentName}. Most answers are written in Chinese.

${RUBRIC}

For EACH item below return an object with:
  id, mark (one of 0, 0.5, 1, 1.5, 2), category (one of understands, thin, trying, misread, absent),
  translationEn (a plain English translation of exactly what they wrote; if already English, repeat it),
  readingEn (one or two sentences on what they were trying to say and why you gave that mark),
  readingZh (the same reading in natural Mandarin, addressed about the student not to them),
  needsBoonchu (true if this is a borderline call he should look at first).

ITEMS:
${JSON.stringify(items, null, 1)}

Respond with only valid JSON: {"results":[...]}`;

    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://aybkk-ashtanga.up.railway.app',
        'X-Title': 'AYBKK In-depth CN2 Exam'
      },
      body: JSON.stringify({
        model: 'deepseek/deepseek-v3-0324',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3,
        max_tokens: 6000
      })
    });
    const out = await response.json();
    const content = out.choices && out.choices[0] && out.choices[0].message.content;
    if (!content) return res.status(502).json({ error: 'no analysis returned' });

    const match = content.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(match[0]);
    const byQ = new Map((parsed.results || []).map(r => [r.id, r]));

    const merged = answers.map(a => {
      const r = byQ.get(a.id);
      if (!r) return a;
      return {
        ...a,
        suggestedMark: r.mark,
        finalMark: a.finalMark === null ? r.mark : a.finalMark, // pre-fill, Boonchu can change
        category: r.category,
        translationEn: r.translationEn || '',
        analysisEn: r.readingEn || '',
        analysisZh: r.readingZh || '',
        needsBoonchu: !!r.needsBoonchu
      };
    });

    await session.run(
      `MATCH (a:ExamAttempt {id: $attemptId})
       SET a.answers = $answers, a.status = 'analysed', a.analysedAt = datetime($now)`,
      { attemptId, answers: JSON.stringify(merged), now: new Date().toISOString() }
    );

    res.json({ success: true, answers: merged });
  } catch (error) {
    console.error('exam analyse error:', error);
    res.status(500).json({ error: error.message });
  } finally {
    await session.close();
  }
});

/* ------------------------------------------- teacher: confirm or override */
/* marks: { [questionId]: number }  0, 0.5, 1, 1.5 or 2 */
router.post('/grade', async (req, res) => {
  if (!checkTeacherAuth(req)) return res.status(401).json({ error: 'unauthorized' });
  const session = req.driver.session();
  try {
    const { attemptId, marks, finalise } = req.body;
    if (!attemptId || typeof marks !== 'object') {
      return res.status(400).json({ error: 'attemptId and marks required' });
    }

    const cur = await session.run(
      `MATCH (a:ExamAttempt {id: $attemptId}) RETURN a.answers AS answers`,
      { attemptId }
    );
    if (!cur.records.length) return res.status(404).json({ error: 'attempt not found' });

    const answers = JSON.parse(cur.records[0].get('answers') || '[]').map(a => {
      if (Object.prototype.hasOwnProperty.call(marks, a.id)) {
        const m = Number(marks[a.id]);
        return { ...a, finalMark: isNaN(m) ? a.finalMark : m, status: 'graded' };
      }
      return a;
    });

    const score = answers.reduce(
      (sum, a) => sum + (a.tickMark || 0) + (Number(a.finalMark) || 0), 0
    );
    const total = answers.length * MARKS_PER_Q;
    const pct = total ? Math.round((score / total) * 100) : 0;

    await session.run(
      `MATCH (a:ExamAttempt {id: $attemptId})
       SET a.answers = $answers, a.score = $score, a.pct = $pct,
           a.status = $status, a.gradedBy = 'Boonchu', a.gradedAt = datetime($now)`,
      {
        attemptId,
        answers: JSON.stringify(answers),
        score, pct,
        status: finalise ? 'graded' : 'in-review',
        now: new Date().toISOString()
      }
    );

    res.json({ success: true, score, total, pct });
  } catch (error) {
    console.error('exam grade error:', error);
    res.status(500).json({ error: error.message });
  } finally {
    await session.close();
  }
});

module.exports = router;
