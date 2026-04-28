/**
 * AYBKK Russia WS 2026 — Telegram student flow
 *
 * Attaches student-facing handlers to the existing @AYBKKstudentProgress_bot
 * (shares the same bot instance as assessment-bot.js).
 *
 * Responsibilities:
 *  - Conduct full orientation in chat (RU/EN, profile, photo, 2 quizzes)
 *  - Post welcome share card to AYBKK Russia group
 *  - Schedule daily reminders: 3h before class (check-in) + 2h after (journal)
 *  - /journal — re-send student's journal link + QR
 *  - /export — Boonchu only — DM CSV of all RU students
 *  - /help — show available commands
 */

const fs = require('fs');
const path = require('path');
const { InlineKeyboard, InputFile } = require('grammy');

require('dotenv').config();

// ─── Config ─────────────────────────────────────────────────────────────
// Per-city groups (each has its own Telegram chat_id):
const RU_GROUPS = {
  spb: process.env.RU_GROUP_CHAT_ID_SPB || '',
  moscow: process.env.RU_GROUP_CHAT_ID_MOSCOW || '',
};
const BOONCHU_CHAT_ID = process.env.BOONCHU_CHAT_ID || '';
const TEACHER_CHAT_IDS = (process.env.TEACHER_CHAT_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const API_BASE = process.env.RUSSIA_BOT_API_BASE || 'https://aybkk-ashtanga.up.railway.app';

const DATA_DIR = process.env.DATA_DIR || (fs.existsSync('/data') ? '/data' : path.join(__dirname, 'data'));
try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch {}
const STATE_FILE = path.join(DATA_DIR, 'ru-bot-state.json');
const FIRED_FILE = path.join(DATA_DIR, 'ru-reminders-fired.json');

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
function writeJson(file, data) {
  try { fs.writeFileSync(file, JSON.stringify(data, null, 2)); } catch (e) { console.error('write fail', file, e.message); }
}

// ─── Class schedule (MSK = UTC+3, no DST) ───────────────────────────────
const CLASSES = [
  { city: 'spb',    date: '2026-05-01', startMSK: '07:30', type: 'Led Primary' },
  { city: 'spb',    date: '2026-05-02', startMSK: '07:30', type: 'Mysore' },
  { city: 'spb',    date: '2026-05-03', startMSK: '07:30', type: 'Led 1+2' },
  { city: 'moscow', date: '2026-05-06', startMSK: '07:30', type: 'Led Primary' },
  { city: 'moscow', date: '2026-05-07', startMSK: '07:30', type: 'Mysore' },
  { city: 'moscow', date: '2026-05-08', startMSK: '07:30', type: 'Mysore' },
  { city: 'moscow', date: '2026-05-09', startMSK: '07:30', type: 'Mysore' },
  { city: 'moscow', date: '2026-05-10', startMSK: '07:30', type: 'Led 1+2' },
];

function classStartUtcMs(c) {
  // MSK is UTC+3, no DST
  return new Date(`${c.date}T${c.startMSK}:00+03:00`).getTime();
}

// ─── Translations ───────────────────────────────────────────────────────
const T = {
  ru: {
    welcome: '🙏 Добро пожаловать в AYBKK Russia WS 2026!\n\nС вами Boonchu и Jamsai Tanti. Перед началом семинара заполните, пожалуйста, эту анкету и сыграйте в нашу приветственную игру.\n\n📍 Санкт-Петербург: 1–3 мая\n📍 Москва: 6–10 мая\n\nНажмите кнопку, чтобы начать.',
    chooseLang: '🌐 Выберите язык / Choose your language:',
    askName: '👤 Как вас зовут? (Имя и фамилия латиницей)',
    askEmail: '📧 Ваш email:',
    askCity: '📍 В каком городе вы будете заниматься?',
    askSize: '👕 Размер футболки:',
    askExperience: '🧘 Сколько лет вы практикуете?',
    askLastAsana: '📹 Последняя асана, которую вы делаете самостоятельно (например: Marichyasana D):',
    askDifficulties: '💪 Что для вас самое сложное? Выберите всё, что подходит, затем нажмите «Готово»:',
    askInjuries: '🩹 Травмы или физические ограничения? (Напишите «нет», если ничего нет)',
    askGoals: '🎯 Ваши цели на этот семинар:',
    askPhoto: '📸 Пришлите вашу фотографию (селфи) — она появится на вашей приветственной карточке. Просто отправьте фото в чат.',
    photoSaved: '✓ Фото получено',
    quizIntro: '🎮 Приветственная игра — 2 вопроса об аштанга-йоге!',
    quizQ: 'Вопрос {n} из 2',
    quizCorrect: '🥳 Верно!',
    quizWrong: '🙏 Не страшно, пробуйте ещё!',
    quizContinue: 'Продолжить →',
    submitting: 'Сохраняю вашу анкету...',
    submitDone: '✨ Готово! Добро пожаловать в AYBKK Russia WS 2026, {name}!',
    journalLink: '🔒 Ваша личная ссылка на дневник практики:',
    journalHint: 'Открывайте эту ссылку после каждой практики. Не делитесь ей — она только для вас.',
    privateMsg: '🙏 Это ваша приветственная карточка. Поделитесь ею в группе студентов, если хотите!',
    groupCardCaption: '🙏 Добро пожаловать, {name}!\n\n📍 {city}\n🧘 {experience}\n\n«Atha Yoganushasanam» — Йога-сутра 1.1\n\n— Boonchu & Jamsai Tanti\nAYBKK Russia WS 2026',
    yes: 'Да', no: 'Нет', done: '✓ Готово',
    spb: 'Санкт-Петербург', moscow: 'Москва',
    expOpts: ['Меньше года', '1–3 года', '3–5 лет', '5–10 лет', '10+ лет'],
    diffOpts: ['Прогибы', 'Наклоны вперёд', 'Раскрытие бёдер', 'Перевёрнутые', 'Баланс', 'Скрутки', 'Плечи', 'Кор', 'Нога за головой'],
    cmdJournalRefresh: '🔗 Ваша личная ссылка на дневник:',
    cmdHelp: 'Команды:\n/journal — ваша ссылка на дневник\n/help — это сообщение\n\nЗабыли? Напишите /start чтобы начать заново.',
    cmdNotFound: 'Сначала пройдите регистрацию. Нажмите /start.',
    reminderPre: '🌅 Доброе утро! Через 3 часа — {type} в {city} ({time} MSK).\n\nХорошей практики! 🙏\n\nДневник: {link}',
    reminderPost: '🙏 Как прошла практика?\n\nЗапишите ваши заметки в дневнике: {link}',
    classCity: { spb: 'Санкт-Петербурге', moscow: 'Москве' },
  },
  en: {
    welcome: '🙏 Welcome to AYBKK Russia WS 2026!\n\nWith Boonchu & Jamsai Tanti. Before the workshop begins, please fill in this short profile and play our orientation game.\n\n📍 St. Petersburg: May 1–3\n📍 Moscow: May 6–10\n\nTap the button below to begin.',
    chooseLang: '🌐 Choose your language:',
    askName: '👤 Your full name (in English):',
    askEmail: '📧 Your email:',
    askCity: '📍 Which city will you be practicing in?',
    askSize: '👕 T-shirt size:',
    askExperience: '🧘 Years of practice:',
    askLastAsana: '📹 The last asana you can practice independently (e.g. Marichyasana D):',
    askDifficulties: '💪 What is most challenging for you? Select all that apply, then tap "Done":',
    askInjuries: '🩹 Any injuries or physical limitations? (Write "none" if not)',
    askGoals: '🎯 Your goals for this workshop:',
    askPhoto: '📸 Please send a selfie — it will appear on your welcome card. Just send a photo in this chat.',
    photoSaved: '✓ Photo received',
    quizIntro: '🎮 Orientation game — 2 short Ashtanga questions!',
    quizQ: 'Question {n} of 2',
    quizCorrect: '🥳 Correct!',
    quizWrong: '🙏 No worries — keep trying!',
    quizContinue: 'Continue →',
    submitting: 'Saving your profile...',
    submitDone: '✨ Done! Welcome to AYBKK Russia WS 2026, {name}!',
    journalLink: '🔒 Your private practice journal link:',
    journalHint: 'Open this link after each practice. Do NOT share — it is just for you.',
    privateMsg: '🙏 This is your welcome card. Share it with the student group if you like!',
    groupCardCaption: '🙏 Welcome, {name}!\n\n📍 {city}\n🧘 {experience}\n\n"Atha Yoganushasanam" — Yoga Sutra 1.1\n\n— Boonchu & Jamsai Tanti\nAYBKK Russia WS 2026',
    yes: 'Yes', no: 'No', done: '✓ Done',
    spb: 'St. Petersburg', moscow: 'Moscow',
    expOpts: ['Less than 1 year', '1–3 years', '3–5 years', '5–10 years', '10+ years'],
    diffOpts: ['Backbends', 'Forward folds', 'Hip opening', 'Inversions', 'Balance', 'Twists', 'Shoulders', 'Core', 'Leg Behind Head'],
    cmdJournalRefresh: '🔗 Your private journal link:',
    cmdHelp: 'Commands:\n/journal — your journal link\n/help — this message\n\nLost? Send /start to begin again.',
    cmdNotFound: 'Please register first. Send /start.',
    reminderPre: '🌅 Good morning! Class in 3 hours — {type} in {city} ({time} MSK).\n\nHave a good practice 🙏\n\nJournal: {link}',
    reminderPost: '🙏 How was your practice?\n\nLog your notes here: {link}',
    classCity: { spb: 'St. Petersburg', moscow: 'Moscow' },
  },
};

function tt(lang, key, vars = {}) {
  let s = (T[lang] && T[lang][key]) || T.en[key] || key;
  if (typeof s === 'string') for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, v);
  return s;
}

// ─── Quiz pool (RU/EN) ──────────────────────────────────────────────────
const QUIZ = [
  {
    q: { ru: 'Кто создал метод аштанга-йоги?', en: 'Who is the creator of the Ashtanga yoga method?' },
    opts: {
      ru: ['Гуру Пурнима', 'Гуру Шарат Джойс', 'Гуру Патанджали', 'Гуру Паттабхи Джойс'],
      en: ['Guru Purnima', 'Guru Sharath Jois', 'Guru Patanjali', 'Guru Pattabhi Jois'],
    }, answer: 3,
  },
  {
    q: { ru: 'Что означает «аштанга»?', en: 'What does "ashtanga" mean?' },
    opts: {
      ru: ['Мандарин над пеплом', 'Восемь ветвей Йоги', 'Делать суп', 'Трусы-стринги'],
      en: ['Tangerine over ashes', 'Eight limbs of Yoga', 'Making soup', 'Thong underwear'],
    }, answer: 1,
  },
  {
    q: { ru: 'Сколько раз мы повторяем Сурьянамаскару А?', en: 'How many times do we repeat Suryanamaskara A?' },
    opts: {
      ru: ['Несколько раз для разогрева', '5 раз по традиции', 'В моём городе нет солнца ☁️', 'О чём вы говорите 🤔'],
      en: ['A few times to warm up', '5 times is tradition', 'No sun in my city ☁️', 'What are you talking about 🤔'],
    }, answer: 1,
  },
  {
    q: { ru: 'Сколько виньяс в Сурьянамаскаре Б?', en: 'How many vinyasa in Suryanamaskara B?' },
    opts: { ru: ['9', '14', '17', 'Что такое виньяса? 😳'], en: ['9', '14', '17', 'Huh... what is vinyasa? 😳'] },
    answer: 2,
  },
  {
    q: { ru: 'На каком языке считают виньясы в аштанга-йоге?', en: 'What language is used for counting vinyasa in Ashtanga yoga?' },
    opts: { ru: ['Хинди', 'Арабский', 'Тамильский', 'Санскрит'], en: ['Hindi', 'Arabic', 'Tamil', 'Sanskrit'] },
    answer: 3,
  },
  {
    q: { ru: 'Что такое бандха?', en: 'What is bandha?' },
    opts: {
      ru: ['То же, что держать кал', 'Подъём тазового дна — лёгкость', 'Ещё один тип шарфа «бандана»', 'Сленг для пластыря'],
      en: ['Same as holding poop', 'Lifting pelvic floor — feeling light', 'Another type of scarf "Bandana"', 'Slang for bandaid'],
    }, answer: 1,
  },
  {
    q: { ru: 'В чём главная идея практики аштанги?', en: 'What is the main idea of Ashtanga practice?' },
    opts: {
      ru: ['Накачать мышцы — ура!', 'Стойка на руках — я люблю!', 'Дыхание, движение, удержание поз', 'Красивые фото для соцсетей'],
      en: ['Gain big muscles — yeah!', 'Handstand — I love it!', 'Breathing, moving body, holding postures', 'Nice photos for social media'],
    }, answer: 2,
  },
  {
    q: { ru: 'Что такое класс майсор?', en: 'What is a Mysore class?' },
    opts: {
      ru: ['Практика аштанги дома', 'Делать свою последовательность в студии', 'Традиционная аштанга в священном месте с учителем из парампары', 'Практика в студии для красивых фото'],
      en: ['Ashtanga practice at home', 'Do my sequence at a yoga studio', 'Traditional Ashtanga at a sacred space with teacher from parampara', 'Practice at studio for nice photos'],
    }, answer: 2,
  },
];

function pickTwoQuiz() {
  const a = Math.floor(Math.random() * QUIZ.length);
  let b = Math.floor(Math.random() * QUIZ.length);
  while (b === a) b = Math.floor(Math.random() * QUIZ.length);
  return [a, b];
}

// ─── Persistent state ───────────────────────────────────────────────────
// Shape: { byChat: { [chatId]: { step, lang, profile, quiz, studentId, journalLink, photoFileId } } }
// step values: lang, name, email, city, size, experience, lastAsana, difficulties,
//              injuries, goals, photo, quiz1, quiz2, done
let STATE = readJson(STATE_FILE, { byChat: {} });
function saveState() { writeJson(STATE_FILE, STATE); }

function getState(chatId) {
  return STATE.byChat[chatId];
}
function setState(chatId, s) {
  STATE.byChat[chatId] = s;
  saveState();
}
function clearState(chatId) {
  delete STATE.byChat[chatId];
  saveState();
}

// ─── Helpers ────────────────────────────────────────────────────────────
function isTeacher(chatId) {
  return TEACHER_CHAT_IDS.includes(String(chatId));
}

function freshProfile() {
  return { difficulties: [] };
}

// ─── HTTP to backend ────────────────────────────────────────────────────
async function postOrientation(payload) {
  const res = await fetch(`${API_BASE}/api/orientations/ru`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`orientation save failed: ${res.status}`);
  return res.json();
}

async function fetchQrCode(studentId) {
  try {
    const res = await fetch(`${API_BASE}/api/journal/qr/${studentId}`);
    if (!res.ok) return null;
    const j = await res.json();
    return j.qrDataUrl || null;
  } catch { return null; }
}

async function uploadPhotoFromTelegram(api, fileId, studentId) {
  // Download the photo from Telegram, then push base64 to /api/upload/student-photo (Cloudinary)
  try {
    console.log(`[ru-bot] uploading photo for ${studentId} (telegram fileId=${fileId})`);
    const file = await api.getFile(fileId);
    const url = `https://api.telegram.org/file/bot${TELEGRAM_BOT_TOKEN}/${file.file_path}`;
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`telegram fetch ${resp.status}`);
    const buf = Buffer.from(await resp.arrayBuffer());
    console.log(`[ru-bot] downloaded ${buf.length} bytes from Telegram`);
    const dataUrl = `data:image/jpeg;base64,${buf.toString('base64')}`;
    const up = await fetch(`${API_BASE}/api/upload/student-photo`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ studentId, imageBase64: dataUrl }),
    });
    const j = await up.json();
    if (!up.ok || !j.photoUrl) {
      console.error('[ru-bot] cloudinary upload returned:', up.status, JSON.stringify(j).slice(0, 200));
      return null;
    }
    console.log(`[ru-bot] cloudinary photo URL: ${j.photoUrl}`);
    return j.photoUrl;
  } catch (e) {
    console.error('[ru-bot] photo upload failed:', e.message);
    return null;
  }
}

// ─── Conversation flow ─────────────────────────────────────────────────
async function startOnboarding(ctx) {
  const chatId = ctx.from.id;
  setState(chatId, { step: 'lang', lang: 'ru', profile: freshProfile() });
  await ctx.reply(tt('en', 'chooseLang'), {
    reply_markup: new InlineKeyboard().text('🇷🇺 Русский', 'rulang:ru').text('🇬🇧 English', 'rulang:en'),
  });
}

async function askName(ctx, st) {
  st.step = 'name'; setState(ctx.from.id, st);
  await ctx.reply(tt(st.lang, 'welcome'));
  await ctx.reply(tt(st.lang, 'askName'));
}

async function askEmail(ctx, st)        { st.step = 'email'; setState(ctx.from.id, st); await ctx.reply(tt(st.lang, 'askEmail')); }
async function askCity(ctx, st) {
  st.step = 'city'; setState(ctx.from.id, st);
  await ctx.reply(tt(st.lang, 'askCity'), {
    reply_markup: new InlineKeyboard()
      .text('🇷🇺 ' + tt(st.lang, 'spb'), 'rucity:spb').row()
      .text('🇷🇺 ' + tt(st.lang, 'moscow'), 'rucity:moscow'),
  });
}
async function askSize(ctx, st) {
  st.step = 'size'; setState(ctx.from.id, st);
  const kb = new InlineKeyboard();
  ['S', 'M', 'L', 'XL'].forEach(s => kb.text(s, `rusize:${s}`));
  await ctx.reply(tt(st.lang, 'askSize'), { reply_markup: kb });
}
async function askExperience(ctx, st) {
  st.step = 'experience'; setState(ctx.from.id, st);
  const kb = new InlineKeyboard();
  T[st.lang].expOpts.forEach((label, i) => kb.text(label, `ruexp:${i}`).row());
  await ctx.reply(tt(st.lang, 'askExperience'), { reply_markup: kb });
}
async function askLastAsana(ctx, st)    { st.step = 'lastAsana'; setState(ctx.from.id, st); await ctx.reply(tt(st.lang, 'askLastAsana')); }
async function askDifficulties(ctx, st) {
  st.step = 'difficulties'; setState(ctx.from.id, st);
  await ctx.reply(tt(st.lang, 'askDifficulties'), { reply_markup: buildDiffKeyboard(st) });
}
function buildDiffKeyboard(st) {
  const kb = new InlineKeyboard();
  const opts = T[st.lang].diffOpts;
  for (let i = 0; i < opts.length; i += 2) {
    const a = opts[i], b = opts[i + 1];
    const aSel = st.profile.difficulties.includes(i);
    kb.text(`${aSel ? '✅' : '⬜'} ${a}`, `rudiff:${i}`);
    if (b !== undefined) {
      const bSel = st.profile.difficulties.includes(i + 1);
      kb.text(`${bSel ? '✅' : '⬜'} ${b}`, `rudiff:${i + 1}`);
    }
    kb.row();
  }
  kb.text(tt(st.lang, 'done'), 'rudiff:done');
  return kb;
}
async function askInjuries(ctx, st)     { st.step = 'injuries'; setState(ctx.from.id, st); await ctx.reply(tt(st.lang, 'askInjuries')); }
async function askPhoto(ctx, st)        { st.step = 'photo'; setState(ctx.from.id, st); await ctx.reply(tt(st.lang, 'askPhoto')); }

async function startQuiz(ctx, st) {
  const [a, b] = pickTwoQuiz();
  st.quiz = { picks: [a, b], answers: [null, null] };
  st.step = 'quiz1'; setState(ctx.from.id, st);
  await ctx.reply(tt(st.lang, 'quizIntro'));
  await sendQuizQuestion(ctx, st, 0);
}

async function sendQuizQuestion(ctx, st, idx) {
  const q = QUIZ[st.quiz.picks[idx]];
  const opts = q.opts[st.lang];
  const kb = new InlineKeyboard();
  opts.forEach((o, i) => kb.text(o, `ruquiz:${idx}:${i}`).row());
  await ctx.reply(`${tt(st.lang, 'quizQ', { n: idx + 1 })}\n\n${q.q[st.lang]}`, { reply_markup: kb });
}

async function submitOrientation(ctx, st) {
  await ctx.reply(tt(st.lang, 'submitting'));
  const p = st.profile;

  // Upload photo to Cloudinary FIRST (using a temp id; the server will store this URL on the student record)
  let photoUrl = '';
  if (st.photoFileId) {
    // Use 'rutmp-' prefix (NOT 'ru-') so the phantom Student node created by the
    // upload endpoint doesn't show up in the Russia dashboard or get counted as a real student.
    const tmpId = 'rutmp-' + Date.now() + '-' + Math.random().toString(36).substr(2, 6);
    photoUrl = (await uploadPhotoFromTelegram(ctx.api, st.photoFileId, tmpId)) || '';
  }

  const payload = {
    name: p.name,
    email: p.email,
    city: p.city,                // 'spb' | 'moscow'
    size: p.size,
    experience: T[st.lang].expOpts[p.experienceIdx] || '',
    lastAsana: p.lastAsana || '',
    difficulties: p.difficulties.map(i => T.en.diffOpts[i]),
    injuries: p.injuries || '',
    language: st.lang,
    workshop: p.city === 'moscow' ? 'AYBKK Moscow WS May 2026' : 'AYBKK SPB WS May 2026',
    location: 'russia',
    telegramChatId: String(ctx.from.id),
    telegramUsername: ctx.from.username || '',
    telegramFirstName: ctx.from.first_name || '',
    telegramLastName: ctx.from.last_name || '',
    telegramPhotoFileId: st.photoFileId || '', // fallback path for share card if Cloudinary photoUrl is empty
    photoUrl,
    quizResults: st.quiz?.answers.map((sel, i) => {
      const q = QUIZ[st.quiz.picks[i]];
      return { question: q.q.en, correct: sel === q.answer };
    }) || [],
  };

  let result;
  try {
    result = await postOrientation(payload);
  } catch (e) {
    console.error('[ru-bot] save orientation failed:', e.message);
    await ctx.reply('⚠️ ' + (st.lang === 'ru' ? 'Не удалось сохранить — попробуйте позже.' : 'Save failed — please try again later.'));
    return;
  }

  st.studentId = result.studentId;
  st.journalLink = result.journalLink;
  setState(ctx.from.id, st);

  // Fetch the rendered share card from server (matches student.html design exactly)
  const cardCaption = tt(st.lang, 'groupCardCaption', {
    name: p.name,
    city: T[st.lang].classCity[p.city] || p.city,
    experience: T[st.lang].expOpts[p.experienceIdx] || '',
  });

  let cardBuf = null;
  try {
    const cardRes = await fetch(`${API_BASE}/api/share-card/${st.studentId}?type=welcome`);
    if (cardRes.ok) cardBuf = Buffer.from(await cardRes.arrayBuffer());
  } catch (e) {
    console.error('[ru-bot] share card fetch failed:', e.message);
  }

  // DM the welcome card to the student
  if (cardBuf) {
    try {
      await ctx.replyWithPhoto(new InputFile(cardBuf, 'welcome-card.png'), { caption: cardCaption });
    } catch (e) {
      console.error('[ru-bot] DM card send failed:', e.message);
      await ctx.reply(cardCaption);
    }
  } else if (st.photoFileId) {
    // Fallback to raw photo + caption if server-side render unavailable
    try { await ctx.replyWithPhoto(st.photoFileId, { caption: cardCaption }); }
    catch { await ctx.reply(cardCaption); }
  } else {
    await ctx.reply(cardCaption);
  }

  // Sequence: photo card → SHARE LINK (eye-catching, while they're curious) → welcome + journal
  const shareLink = `${API_BASE}/share-card.html?id=${encodeURIComponent(st.studentId)}&type=welcome`;
  const shareLine = st.lang === 'ru'
    ? `📷 Сохранить и поделиться открыткой:\n${shareLink}`
    : `📷 Save & share your card:\n${shareLink}`;
  await ctx.reply(shareLine);

  await ctx.reply(`${tt(st.lang, 'submitDone', { name: p.name })}\n\n${tt(st.lang, 'journalLink')}\n${st.journalLink}\n\n${tt(st.lang, 'journalHint')}`);

  // Try to send QR code
  const qr = await fetchQrCode(st.studentId);
  if (qr) {
    try {
      const qrBuf = Buffer.from(qr.split(',')[1], 'base64');
      await ctx.replyWithPhoto(new InputFile(qrBuf, 'journal-qr.png'), { caption: '📷 ' + (st.lang === 'ru' ? 'QR-код для дневника' : 'Journal QR') });
    } catch {}
  }

  // Post to the city's group (SPB or Moscow) — UNLESS this is Boonchu testing.
  const groupId = RU_GROUPS[p.city];
  const isBoonchuTesting = BOONCHU_CHAT_ID && String(ctx.from.id) === String(BOONCHU_CHAT_ID);

  if (isBoonchuTesting) {
    console.log('[ru-bot] skipping group post — orientation completed by BOONCHU_CHAT_ID (test mode)');
    await ctx.reply('🧪 Test mode — group post skipped (you are the bot owner).');
  } else if (groupId) {
    try {
      if (cardBuf) {
        await ctx.api.sendPhoto(groupId, new InputFile(cardBuf, 'welcome-card.png'), { caption: cardCaption });
      } else if (st.photoFileId) {
        await ctx.api.sendPhoto(groupId, st.photoFileId, { caption: cardCaption });
      } else {
        await ctx.api.sendMessage(groupId, cardCaption);
      }
    } catch (e) {
      console.error(`[ru-bot] group post to ${p.city} failed:`, e.message);
    }
  } else {
    console.warn(`[ru-bot] no group chat_id configured for city ${p.city}`);
  }

  // Mark conversation done; keep studentId/journalLink/lang for /journal command
  st.step = 'done';
  setState(ctx.from.id, st);
}

// ─── Attach to bot ─────────────────────────────────────────────────────
function attach(bot) {
  // /start dispatcher — Russia handles non-teacher chats and the deep-link payload "ru".
  // Only respond in private DMs (never in groups) so we don't talk over the workshop chat.
  bot.command('start', async (ctx, next) => {
    if (ctx.chat?.type !== 'private') return; // ignore /start in groups
    const chatId = ctx.from?.id;
    if (!chatId) return next();
    if (isTeacher(chatId)) return next(); // teacher flow handles
    const payload = (ctx.match || '').trim();
    if (payload === 'ru' || !isTeacher(chatId)) {
      return startOnboarding(ctx);
    }
    return next();
  });

  // /journal — re-send the journal link
  bot.command('journal', async (ctx) => {
    const st = getState(ctx.from.id);
    if (!st || !st.journalLink) {
      await ctx.reply(T.ru.cmdNotFound + '\n' + T.en.cmdNotFound);
      return;
    }
    await ctx.reply(`${tt(st.lang || 'ru', 'cmdJournalRefresh')}\n${st.journalLink}`);
  });

  // /help
  bot.command('help', async (ctx) => {
    if (isTeacher(ctx.from.id)) return; // let teacher bot's default reply happen
    const st = getState(ctx.from.id);
    const lang = st?.lang || 'ru';
    await ctx.reply(tt(lang, 'cmdHelp'));
  });

  // /export — Boonchu only — DM CSV of all RU students
  bot.command('export', async (ctx) => {
    if (BOONCHU_CHAT_ID && String(ctx.from.id) !== String(BOONCHU_CHAT_ID)) {
      return; // silent no-op for non-admins
    }
    try {
      const res = await fetch(`${API_BASE}/api/orientations/ru?format=csv`);
      if (!res.ok) throw new Error('fetch ' + res.status);
      const csv = await res.text();
      const buf = Buffer.from(csv, 'utf8');
      await ctx.replyWithDocument(new InputFile(buf, `aybkk-russia-students-${new Date().toISOString().split('T')[0]}.csv`));
    } catch (e) {
      await ctx.reply('❌ Export failed: ' + e.message);
    }
  });

  // /whoami — debug, returns chat_id (helpful for setting BOONCHU_CHAT_ID, RU_GROUP_CHAT_ID)
  bot.command('whoami', async (ctx) => {
    const lines = [
      `chat_id: ${ctx.chat?.id}`,
      `from.id: ${ctx.from?.id}`,
      `username: @${ctx.from?.username || '(none)'}`,
      `chat type: ${ctx.chat?.type}`,
    ];
    await ctx.reply(lines.join('\n'));
  });

  // Auto-detect when the bot is added/promoted in a group — DM Boonchu the group's chat_id.
  // Fires on any status transition where the bot is now in the group (covers add and promote).
  bot.on('my_chat_member', async (ctx) => {
    try {
      const update = ctx.myChatMember;
      const oldStatus = update.old_chat_member?.status;
      const newStatus = update.new_chat_member?.status;
      const chat = ctx.chat;
      console.log(`[ru-bot] my_chat_member: chat=${chat?.id} title="${chat?.title}" ${oldStatus} → ${newStatus}`);

      // Only fire when bot is currently in the group (member or admin) AND status changed
      if (!['member', 'administrator'].includes(newStatus)) return;
      if (newStatus === oldStatus) return;

      // Record the group regardless of whether we can DM — surfaced by /groups command.
      STATE.knownGroups = STATE.knownGroups || {};
      STATE.knownGroups[chat?.id] = { title: chat?.title || '', type: chat?.type, status: newStatus };
      saveState();

      if (!BOONCHU_CHAT_ID) {
        console.log(`[ru-bot] BOONCHU_CHAT_ID not set — cannot DM the chat_id (${chat?.id})`);
        return;
      }
      const isAdmin = newStatus === 'administrator';
      const guess = chat?.title?.toLowerCase().includes('moscow') || chat?.title?.toLowerCase().includes('москва') ? 'MOSCOW' : 'SPB';
      const lines = [
        `🤖 Status update for "${chat?.title || '(no title)'}"`,
        `chat_id: ${chat?.id}`,
        `type: ${chat?.type}`,
        `status: ${isAdmin ? 'admin ✅ — group posts will work' : 'member only — promote me to admin so I can post welcome cards'}`,
        '',
        `Add to .env:`,
        `RU_GROUP_CHAT_ID_${guess}=${chat?.id}`,
      ];
      // Plain text — no parse_mode — so underscores in env-var names don't trip Markdown parsing.
      await ctx.api.sendMessage(BOONCHU_CHAT_ID, lines.join('\n'));
    } catch (e) {
      console.error('[ru-bot] my_chat_member handler error:', e.message);
    }
  });

  // /groups — Boonchu only — lists all known groups (recorded by the my_chat_member handler).
  // Useful if the bot was added/promoted while the bot wasn't running, so the event was missed.
  bot.command('groups', async (ctx) => {
    if (!BOONCHU_CHAT_ID || String(ctx.from.id) !== String(BOONCHU_CHAT_ID)) return;
    const known = STATE.knownGroups || {};
    const ids = Object.keys(known);
    if (!ids.length) {
      await ctx.reply('No groups recorded yet. Either send /whoami inside each group, or have someone re-add the bot to trigger a my_chat_member event.');
      return;
    }
    const lines = ['Known groups:'];
    for (const id of ids) lines.push(`• ${known[id].title || '(untitled)'} — ${id} (${known[id].status})`);
    await ctx.reply(lines.join('\n'));
  });

  // Callback queries — Russia-specific (prefix "ru"). DM only.
  bot.on('callback_query', async (ctx, next) => {
    if (ctx.chat?.type !== 'private') return; // never react inside a group
    const data = ctx.callbackQuery?.data || '';
    if (!data.startsWith('ru')) return next(); // not ours, defer to teacher handler

    const chatId = ctx.from.id;
    const st = getState(chatId);
    if (!st) {
      await ctx.answerCallbackQuery();
      await ctx.reply(T.ru.cmdNotFound);
      return;
    }
    await ctx.answerCallbackQuery();

    if (data.startsWith('rulang:')) {
      st.lang = data.split(':')[1];
      setState(chatId, st);
      return askName(ctx, st);
    }
    if (data.startsWith('rucity:')) {
      st.profile.city = data.split(':')[1];
      setState(chatId, st);
      return askSize(ctx, st);
    }
    if (data.startsWith('rusize:')) {
      st.profile.size = data.split(':')[1];
      setState(chatId, st);
      return askExperience(ctx, st);
    }
    if (data.startsWith('ruexp:')) {
      st.profile.experienceIdx = parseInt(data.split(':')[1], 10);
      setState(chatId, st);
      return askLastAsana(ctx, st);
    }
    if (data.startsWith('rudiff:')) {
      const v = data.split(':')[1];
      if (v === 'done') {
        return askInjuries(ctx, st);
      }
      const idx = parseInt(v, 10);
      const arr = st.profile.difficulties;
      const at = arr.indexOf(idx);
      if (at >= 0) arr.splice(at, 1); else arr.push(idx);
      setState(chatId, st);
      try {
        await ctx.editMessageReplyMarkup({ reply_markup: buildDiffKeyboard(st) });
      } catch {}
      return;
    }
    if (data.startsWith('ruquiz:')) {
      const [_, idxStr, selStr] = data.split(':');
      const idx = parseInt(idxStr, 10);
      const sel = parseInt(selStr, 10);
      st.quiz.answers[idx] = sel;
      const correct = sel === QUIZ[st.quiz.picks[idx]].answer;
      await ctx.reply(correct ? tt(st.lang, 'quizCorrect') : tt(st.lang, 'quizWrong'));
      setState(chatId, st);
      if (idx === 0) {
        st.step = 'quiz2'; setState(chatId, st);
        return sendQuizQuestion(ctx, st, 1);
      } else {
        return submitOrientation(ctx, st);
      }
    }
  });

  // Message handler — text inputs + photo uploads. DM only (never reply inside groups).
  bot.on('message', async (ctx, next) => {
    if (ctx.chat?.type !== 'private') return next(); // ignore group messages entirely
    const chatId = ctx.from?.id;
    if (!chatId) return next();
    if (isTeacher(chatId)) return next();
    const st = getState(chatId);
    if (!st) return next();

    // Photo upload during 'photo' step
    if (ctx.message?.photo && st.step === 'photo') {
      const photos = ctx.message.photo;
      const largest = photos[photos.length - 1];
      st.photoFileId = largest.file_id;
      // Upload to Cloudinary in background — we can use a temp ID until we have the real studentId
      // (We'll re-upload after orientation creates the student). For now, just store file_id.
      setState(chatId, st);
      await ctx.reply(tt(st.lang, 'photoSaved'));
      return startQuiz(ctx, st);
    }

    // Text inputs
    const txt = (ctx.message?.text || '').trim();
    if (!txt) return; // ignore stickers etc.

    if (st.step === 'name')        { st.profile.name = txt; setState(chatId, st); return askEmail(ctx, st); }
    if (st.step === 'email')       { st.profile.email = txt; setState(chatId, st); return askCity(ctx, st); }
    if (st.step === 'lastAsana')   { st.profile.lastAsana = txt; setState(chatId, st); return askDifficulties(ctx, st); }
    if (st.step === 'injuries')    { st.profile.injuries = txt; setState(chatId, st); return askPhoto(ctx, st); }

    // Otherwise, fall through (teacher handler may still want it, but for safety, gentle nudge)
    if (st.step && st.step !== 'done') {
      const hint = st.lang === 'ru' ? '👉 Используйте кнопки выше чтобы продолжить.' : '👉 Use the buttons above to continue.';
      await ctx.reply(hint);
    }
  });
}

// ─── Scheduler ──────────────────────────────────────────────────────────
function startScheduler(bot) {
  console.log('[ru-bot] scheduler started');
  setInterval(() => tick(bot).catch(e => console.error('[ru-bot] tick error:', e.message)), 60 * 1000);
  // Run once immediately so a missed-by-1-min reminder still fires within 60s of restart
  tick(bot).catch(e => console.error('[ru-bot] initial tick error:', e.message));
}

async function tick(bot) {
  const fired = readJson(FIRED_FILE, {}); // { 'pre:spb:2026-05-01': '2026-05-01T01:30:12Z', ... }
  const now = Date.now();
  let changed = false;

  // Catch-up windows: pre-reminders fire if we're 0–5 min late (so a bot restart still catches it).
  // Post-reminders are nudges; widen to 30 min so a longer outage still doesn't drop them.
  const PRE_CATCHUP_MS = 5 * 60 * 1000;
  const POST_CATCHUP_MS = 30 * 60 * 1000;

  for (const c of CLASSES) {
    const startMs = classStartUtcMs(c);
    const preMs = startMs - 3 * 60 * 60 * 1000;
    const postMs = startMs + 2 * 60 * 60 * 1000;

    const preKey = `pre:${c.city}:${c.date}`;
    const postKey = `post:${c.city}:${c.date}`;

    if (!fired[preKey] && now >= preMs && now < preMs + PRE_CATCHUP_MS) {
      await broadcastReminder(bot, c, 'pre');
      fired[preKey] = new Date().toISOString();
      changed = true;
    }
    if (!fired[postKey] && now >= postMs && now < postMs + POST_CATCHUP_MS) {
      await broadcastReminder(bot, c, 'post');
      fired[postKey] = new Date().toISOString();
      changed = true;
    }
  }

  if (changed) writeJson(FIRED_FILE, fired);
}

async function broadcastReminder(bot, classInfo, kind) {
  // Find all completed RU students for this city
  let studentList = [];
  try {
    const res = await fetch(`${API_BASE}/api/orientations/ru?city=${classInfo.city}`);
    if (res.ok) {
      const j = await res.json();
      studentList = j.students || [];
    }
  } catch (e) {
    console.error('[ru-bot] reminder fetch failed:', e.message);
    return;
  }

  const cityLabel = { spb: 'SPB', moscow: 'Moscow' }[classInfo.city];
  for (const s of studentList) {
    if (!s.telegramChatId) continue;
    const lang = s.language === 'ru' ? 'ru' : 'en';
    const link = s.journalLink || '';
    const text = kind === 'pre'
      ? tt(lang, 'reminderPre', { type: classInfo.type, city: cityLabel, time: classInfo.startMSK, link })
      : tt(lang, 'reminderPost', { link });
    try {
      await bot.api.sendMessage(s.telegramChatId, text);
    } catch (e) {
      console.error(`[ru-bot] reminder send failed for ${s.telegramChatId}:`, e.message);
    }
  }
  console.log(`[ru-bot] sent ${kind} reminders for ${classInfo.city} ${classInfo.date}: ${studentList.length} students`);
}

module.exports = { attach, startScheduler };
