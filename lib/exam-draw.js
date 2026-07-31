'use strict';
/**
 * Deterministic per-student exam draw.
 *
 * Same student always gets the same paper (so a reload or a dropped connection
 * never reshuffles mid-exam), but no two students get the same paper, and the
 * lecture order differs per student so neighbours are never on the same topic
 * at the same moment.
 *
 * The correct answers never leave this module. `drawForStudent` returns a
 * student-safe payload; `answerKeyFor` is server-side only.
 */

// How many questions each student gets from each lecture, and the bank size.
const PLAN = [
  { lecture: 'Psychology of Learning', take: 20 },
  { lecture: 'Shoulder Screening',     take: 10 },
  { lecture: 'Three Doshas',           take: 6 },
  { lecture: 'Hormones',               take: 4 },
  { lecture: 'Five Kleshas',           take: 3 },
  { lecture: 'Pranayama',              take: 3 },
];

// FNV-1a, then xorshift32. Small, dependency free, and stable across restarts.
function seedFrom(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h || 0x9e3779b9;
}

function rng(seed) {
  let s = seed >>> 0;
  return function next() {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5;  s >>>= 0;
    return s / 0x100000000;
  };
}

function shuffled(arr, rand) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * @param bank      array of question objects, each with .lecture and .options
 * @param studentId stable id, e.g. the Neo4j id or a slug of the name
 * @param salt      bump this to reissue a fresh paper for everyone
 * @returns { studentId, questions: [...student-safe...], key: {qid: 'B'} }
 */
function buildPaper(bank, studentId, salt = 'cn2-final-2026', opts = {}) {
  const rand = rng(seedFrom(salt + '::' + studentId));
  // A real student must never sit a short paper, so a thin bank is a hard error.
  // A teacher trying it out can preview whatever exists.
  const allowShort = !!opts.allowShort;

  const byLecture = new Map();
  for (const q of bank) {
    if (!byLecture.has(q.lecture)) byLecture.set(q.lecture, []);
    byLecture.get(q.lecture).push(q);
  }

  // lecture order varies per student, so two people side by side are never
  // on the same subject at the same time
  const blocks = shuffled(PLAN, rand);

  const questions = [];
  const key = {};

  for (const block of blocks) {
    const pool = byLecture.get(block.lecture) || [];
    if (pool.length < block.take && !allowShort) {
      throw new Error(
        `bank too small for ${block.lecture}: need ${block.take}, have ${pool.length}`
      );
    }
    const take = Math.min(block.take, pool.length);
    for (const q of shuffled(pool, rand).slice(0, take)) {
      // option order is shuffled too, so "the answer is C" is useless to a neighbour
      const opts = shuffled(q.options, rand);
      const relabelled = opts.map((o, i) => ({
        label: 'ABCD'[i],
        text_en: o.text_en,
        text_zh: o.text_zh,
      }));
      const correctIdx = opts.findIndex(o => o.correct);
      key[q.id] = 'ABCD'[correctIdx];

      questions.push({
        id: q.id,
        lecture: q.lecture,
        stem_en: q.stem_en,
        stem_zh: q.stem_zh,
        options: relabelled,          // note: no `correct` flag reaches the client
      });
    }
  }

  return { studentId, questions, key };
}

/** Student-safe payload. Never includes the key. */
function drawForStudent(bank, studentId, salt, opts) {
  const { studentId: sid, questions } = buildPaper(bank, studentId, salt, opts);
  return { studentId: sid, questions };
}

/** Server-side only. */
function answerKeyFor(bank, studentId, salt, opts) {
  return buildPaper(bank, studentId, salt, opts).key;
}

module.exports = { PLAN, buildPaper, drawForStudent, answerKeyFor, seedFrom, rng, shuffled };
