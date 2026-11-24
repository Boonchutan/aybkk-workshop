// bkk-api.js — AYBKK Bangkok: packages, payment (PaySolutions), passes,
// class schedule, bookings, check-in.
//
// Mount:  mountBkk(app, { pgPool })
//
// Owns its own bkk_* tables. It NEVER writes Rezerv's students/classes/
// bookings/passes tables — the two systems run side by side.
//
// Money rule: a pass is only created after the gateway itself confirms the
// payment AND the amount matches. The PaySolutions postback is treated as an
// untrusted nudge (their own plugins accept it blindly; we do not).

const crypto = require('crypto');
const net = require('net');
const { pipeline, Readable } = require('stream');
const QRCode = require('qrcode');
const { sendMail, render } = require('./mailer');
const { REAL_FIT, REAL_FIT_ID, LANDING_TAGS, landingCode } = require('./inbox');
const r2lib = require('./lib/r2');

const TZ_OFFSET = '+07:00';                    // Asia/Bangkok, no DST
const SIGNIN_TTL_MIN = 30;                     // a sign-in link is short-lived
const STAFF_LINK_DAYS = 7;                     // one M sends by LINE/WhatsApp/WeChat
const SIGNIN_QR_MIN = 10;                      // a QR staff show at the desk: one scan, then dead
const SHORT_ALPHABET = '23456789abcdefghjkmnpqrstuvwxyz'; // its short /in/ code: no 0/o, 1/l/i to misread
const SHORT_LEN = 10;                          // 31^10 ≈ 8e14 codes
const SHORT_MISSES_PER_IP_HOUR = 20;           // codes nobody was given, before an address is stopped
const SHORT_MISSES_HOUR = 200;                 // from everywhere: only logged, so a guessing run shows
const SIGNIN_PER_EMAIL_HOUR = 3;               // and cheap to abuse without limits
const SIGNIN_PER_IP_HOUR = 10;
const LETTER_PER_IP_HOUR = 10;                 // letter confirm mails asked from one place (shala wifi)
const LETTER_PER_HOUR = 30;                    // and from everywhere (x-forwarded-for can be faked)
const LETTER_PER_DAY = 60;                     // the same mail account sends receipts and sign-in links
const LETTER_ASKS_PER_DAY = 3;                 // confirm mails to one address
const CANCEL_CUTOFF_HOURS = 5;                 // cancel ≥5h before start → credit back
const LATE_ADD_DAYS = 7;                       // staff put someone who came on a class that is over, this many days back
// A student can still book a class (or buy a drop-in for it) this many minutes
// after it starts (Boonchu, 16 Nov 2026): Mysore 60, every other class 30.
// bookCloseAt is the one place that reads it.
const BOOK_LATE_MIN = { mysore: 60, default: 30 };
// Landing pages counted in bkk_start_events, and the kinds each page may send. The In-Depth
// pages' 'sent' and 'fit' are written by inbox.js when an application is saved, never by a page.
const LANDING_KINDS = { start: ['view', 'tap', 'step'], 'in-depth-zh': ['view', 'step2', 'step3'], 'in-depth-en': ['view', 'step2', 'step3'],
  book: ['consent-shown', 'consent-agreed'] };
// What the weekly box shows for each page, in ladder order. /start's q1..q3 and done are its 'step' rows.
const LANDING_COLS = { 'in-depth-zh': ['view', 'step2', 'step3', 'sent', 'fit'], 'in-depth-en': ['view', 'step2', 'step3', 'sent', 'fit'],
  start: ['view', 'tap', 'q1', 'q2', 'q3', 'done'], book: ['consent-shown', 'consent-agreed'] };
const LANDING_WEEKS = 8;
const LANDING_SPLIT_TOP = 30;                  // a week's split by source or tag: the biggest 30, then one "other" row
// Counts from one address an hour, kept in memory only. Generous: a phone network in China puts
// many people behind one address, and a page load sends at most 3 (In-Depth) or 6 (/start).
const LANDING_PER_HOUR = 300;
// Crawlers that run a page's script are not visitors. The user agent is read, never stored.
// (A Cubot phone has "CUBOT" in its user agent, so that one bot is a visitor.)
const LANDING_BOT_UA = /(?<!cu)bot\b|crawl|spider|slurp|headless|lighthouse/i;
const VAT_PCT = 7;                             // Thai VAT, charged on price + online fee
// The payment watch (Boonchu, 15 Nov 2026): stuck online payments are asked
// about again by the server itself, and Telegram hears only about problems.
const PAY_WATCH = {
  inquiryMs: 15000,                            // one PaySolutions inquiry, at most
  everyMs: 10 * 60000, firstMs: 2 * 60000,     // the sweep timer, and its first run after boot
  minAgeMin: 5, maxAgeH: 48,                   // an order this old is asked about (the student may still be paying before)
  youngH: 2, youngGapMin: 10, oldGapMin: 60,   // under 2 hours old: asked every 10 minutes at most, then hourly
  perRun: 30,                                  // and a run starts no new inquiry after 4 timeouts' worth of time,
                                               // or after one answer slower than a third of the timeout
  stuckMin: 60,                                // not paid after this: a status ping, and a problem in the money line
  doubleH: 72,                                 // a second paid order for the same package this close is a possible double
  failAfter: 2, failMin: 20,                   // "the check is failing" after 2 failures in a row, or 20 minutes of them,
  failGapH: 3,                                 // and at most this often
  sendTries: 3, retryMin: 10,                  // a ping or money line Telegram refused is tried again, 10 minutes apart
  lineMaxDays: 7,                              // a money line covers the time since the last one, at most this far back
};
const MANUAL_NOTE = 'MANUAL ACTIVATION by admin';

// The student agreement and the privacy notice (Nov 2026). One version is the whole agreement:
// a signature (bkk_consents) records it and the sha256 of its exact text, which
// test/bkk-api.test.js pins, so a version is never edited quietly: changed words are a new
// version, and old versions stay here for the people who signed them. EN and TH are "v1 draft 3"
// (20 Nov 2026, Boonchu's lines 5, 6 and 11 and the defaults he took), still before Jamsai's
// Thai check and a Thai lawyer's read of lines 6 and 13, the under-20 tick and the privacy
// notice. Thai calls a third person เค้า, never เขา. {since} in line 17
// is the day the switch first left off; the privacy notice's {legal_name}, {address} and {email}
// come from Admin, Settings. The notice names every service personal data goes to (inbox.js:
// LINE, Meta, Anthropic, Telegram; team-brief.js: LINE; server.js: Neo4j, OpenRouter): a new one is a new version.
const CONSENT_VERSION = 'v1';
const CONSENT_LANGS = ['en', 'th', 'zh', 'ru'];
const CONSENT_TEXT = {
  v1: {
    en: {
      agreement: {
        title: 'Before your first class',
        lead: 'Please read this once. It takes about 2 minutes.',
        confirmTitle: 'A one-time confirm.',
        confirmLead: 'Thank you for practising with us. We now keep this short agreement on file for every student. Read it once. Your pass and bookings stay as they are.',
        groups: [
          ['Your practice', [
            'Ashtanga is a physical practice. Like any exercise, it can cause injury.',
            'You may feel sore or tired the next day, or for a few days, especially when you are new. This is common. Sharp pain, or pain that does not ease, is different: tell the teacher, and see a doctor.',
            'Practise within your own limits. You can stop and rest at any time. If you feel pain, dizziness or unwell, stop and tell the teacher.',
            'Before class, tell the teacher in person about any injury, health condition, surgery or pregnancy. If you are not sure you should practise, ask your doctor first.',
            'Teachers may give hands-on adjustments, from basic to more advanced as you progress over the years of practice. You can say no at any time, before or during class. Consult the teacher if you have any concerns.',
            'AYBKK is not responsible for the normal risks of practice when nobody is at fault. Nothing here limits your rights under Thai law.',
          ]],
          ['In the shala', [
            'Book every class in advance on aybkk.net, and check in at the door before practice. Led classes start together, so please arrive before the start. If you are late, wait at the door for the teacher.',
            'Cancel at least 5 hours before class to keep your credit.',
            'No photos and no videos in the shala. AYBKK staff sometimes take class photos for your private profile. We ask you before we post a photo or video of you in public.',
            'No phones, no talking and no water during practice. If you need water for a health reason, tell the teacher.',
            'We provide a sweat towel and a shower towel. Bring your own mat, or tick "I need a mat" when you book and rent one at the shala for ฿200. After practice, clean your mat and the floor around it with the spray we provide.',
            'The shala is closed on full moon and new moon days. We post other closures on the timetable and on LINE @aybkk, at least 7 days ahead when we can.',
          ]],
          ['Your pass', [
            'All passes are final once purchased, unless we can’t give the classes you paid for (if we close or move), or where Thai law gives you a right to a refund.',
            'Your pass is just for you, not shareable.',
            'Freeze up to 30 days (or as your doctor’s note says, up to 2 months) for a broken bone, an eye problem, surgery, or pregnancy and birth. Other cases: talk with us. Please tell us on LINE @aybkk before it starts.',
            'Moving away, or your doctor says stop? If a freeze doesn’t fit, a 3, 6 or 12-month membership can pass once to someone new to AYBKK. Same end date. Fee ฿1,500. Ask us on LINE @aybkk first.',
            'A pass bought before {since} keeps the terms it was sold with.',
          ]],
          ['Your photo', [
            'A profile photo is your choice. If you add one, it shows on your tile on the check-in iPad at the door, where other students can see it, and in your teachers’ and staff lists. You can remove it any time in My account.',
          ]],
        ],
        tick: 'I have read this and I agree. I am 20 or older.',
        under20: 'Under 20?',
        tickUnder20: 'I have read this and I agree. I am under 20. My parent or guardian will come with me to the shala before my first class to agree.',
        signed: 'Signed as: {name} · {date} · {version}. We email you a copy.',
        dataH: 'Your data:',
        data: 'AYBKK keeps your name, contact details, bookings, check-ins, payments and this agreement, to run your classes. The {privacy} says who else handles them, how long we keep them, and how to see, correct or delete them.',
        privacyLink: 'Privacy notice',
        agreePay: 'Agree and pay {total}', agreeBook: 'Agree and book', agree: 'Agree',
      },
      privacy: {
        title: 'Privacy notice',
        sections: [
          ['Who we are', '{legal_name} runs AYBKK (Ashtanga Yoga Center of Bangkok), {address}. Contact us at {email} or on LINE @aybkk.'],
          ['What we keep', 'Your name, email and phone, the language you use, your bookings, check-ins, passes and payments. The record of the agreement you signed: its version, the name and email you gave, the date and time, and whether you are under 20 (then also your guardian’s name and the day on their paper). Messages you send us on LINE, Instagram or Facebook. What you wrote in an orientation form, which can include injuries and an emergency contact. If there are any: your practice journal, notes your teachers write about your practice, your 12-week check numbers, class photos you are tagged in, and your profile photo. The internet address (IP) a sign-in link was asked from. We never see or keep your card number.'],
          ['Why', 'To run your classes: bookings, check-in, passes, payments and receipts. To show what you agreed to. To help your teachers teach you, including knowing about an injury. To answer your messages. We need these to give you classes. We never sell your data.'],
          ['Who else handles it', 'PaySolutions takes online payments. Resend sends our emails. Cloudinary stores photos. Google: teachers put class photos in Google Drive before they go to profiles, and Google Ads runs only if you tap OK on the cookie bar. Railway runs the server and database of this site. Neo4j stores orientation forms and practice journals. OpenRouter (DeepSeek) writes an AI summary of a practice journal when a teacher asks for one. LINE carries our LINE chats, and the daily class list we send to our staff group (first name and initial, classes and passes). Meta carries Instagram and Facebook messages. Anthropic (Claude) reads the messages you send us, to sort them and draft our replies. Telegram carries alerts to our staff, for example about a payment or a new message, with its text. Some of these services keep data outside Thailand.'],
          ['How long', 'The record of the agreement you signed: 10 years after your last class, because a claim can come that late. Payment records: 5 years, as tax law asks. Messages: 90 days. Everything else: kept while you practise with us. We review it once a year and delete what we no longer need, or sooner if you ask.'],
          ['Your rights', 'You can ask to see your data, get a copy, correct it or delete it. Write to {email} or message LINE @aybkk. You can remove your profile photo yourself in My account. We keep the agreement record and payment records for the times above even if you ask us to delete the rest. If you are not happy with how we handle your data, you can complain to the Personal Data Protection Committee of Thailand.'],
        ],
      },
    },
    th: {
      agreement: {
        title: 'ก่อนเริ่มคลาสแรก',
        lead: 'โปรดอ่านสักครั้ง ใช้เวลาประมาณ 2 นาที',
        confirmTitle: 'ยืนยันครั้งเดียว',
        confirmLead: 'ขอบคุณที่ฝึกกับเรามาตลอด ตอนนี้เราเก็บข้อตกลงสั้น ๆ นี้ไว้ในระบบสำหรับนักเรียนทุกคน อ่านเพียงครั้งเดียว แพ็กเกจและการจองของคุณยังเหมือนเดิม',
        groups: [
          ['การฝึกของคุณ', [
            'อัษฎางคโยคะเป็นการฝึกทางกาย เช่นเดียวกับการออกกำลังกายทั่วไป อาจเกิดการบาดเจ็บได้',
            'วันรุ่งขึ้นหรือหลายวันหลังฝึก คุณอาจรู้สึกปวดเมื่อยหรืออ่อนล้า โดยเฉพาะช่วงแรก ซึ่งพบได้บ่อย แต่หากเจ็บแปลบ หรือเจ็บไม่ทุเลา ให้แจ้งครูและปรึกษาแพทย์',
            'ฝึกตามขีดจำกัดของร่างกายตัวเอง หยุดหรือพักได้ทุกเมื่อ หากรู้สึกเจ็บ เวียนหัว หรือไม่สบาย ให้หยุดและบอกครู',
            'ก่อนเข้าคลาส แจ้งครูโดยตรงหากมีอาการบาดเจ็บ ปัญหาสุขภาพ เคยผ่าตัด หรือตั้งครรภ์ หากไม่แน่ใจว่าควรฝึกหรือไม่ ให้ปรึกษาแพทย์ก่อน',
            'ครูอาจสัมผัสเพื่อช่วยจัดท่า (adjustment) ตั้งแต่ขั้นพื้นฐานไปจนถึงขั้นที่สูงขึ้น ตามความก้าวหน้าในการฝึกของคุณตลอดหลายปี คุณปฏิเสธได้ทุกเมื่อ ทั้งก่อนและระหว่างคลาส หากมีข้อกังวลใด ๆ ให้ปรึกษาครู',
            'AYBKK ไม่ต้องรับผิดต่อความเสี่ยงตามปกติของการฝึก ในกรณีที่ไม่มีผู้ใดเป็นฝ่ายผิด ข้อความในหน้านี้ไม่จำกัดสิทธิ์ใด ๆ ของคุณตามกฎหมายไทย',
          ]],
          ['ในชาลา', [
            'จองทุกคลาสล่วงหน้าที่ aybkk.net และเช็กอินที่หน้าห้องก่อนฝึก ในคลาส Led ทุกคนเริ่มพร้อมกัน จึงขอให้มาก่อนเวลาเริ่มคลาส หากมาสาย ให้รอครูที่หน้าห้อง',
            'ยกเลิกล่วงหน้าอย่างน้อย 5 ชั่วโมงเพื่อไม่เสียสิทธิ์',
            'ห้ามถ่ายรูปและถ่ายวิดีโอในชาลา บางครั้งทีมงาน AYBKK จะถ่ายรูปในคลาสเพื่อเก็บไว้ในโปรไฟล์ส่วนตัวของคุณ เราจะขอความยินยอมจากคุณก่อนเผยแพร่รูปหรือวิดีโอที่มีคุณต่อสาธารณะ',
            'ระหว่างการฝึก ห้ามใช้โทรศัพท์ งดพูดคุย และงดดื่มน้ำ หากจำเป็นต้องดื่มน้ำด้วยเหตุผลด้านสุขภาพ โปรดแจ้งครู',
            'เรามีผ้าเช็ดเหงื่อและผ้าเช็ดตัวสำหรับอาบน้ำไว้ให้ นำเสื่อโยคะมาเอง หรือติ๊ก "ต้องการเช่าเสื่อ" ตอนจอง แล้วเช่าที่ชาลา ฿200 ฝึกเสร็จแล้ว ทำความสะอาดเสื่อและพื้นรอบ ๆ ด้วยสเปรย์ที่เราเตรียมไว้',
            'AYBKK ปิดในวันพระจันทร์เต็มดวงและวันพระจันทร์ดับ (moon day) วันปิดอื่น ๆ เราจะแจ้งในตารางเรียนและทาง LINE @aybkk และหากทำได้ จะแจ้งล่วงหน้าอย่างน้อย 7 วัน',
          ]],
          ['แพ็กเกจของคุณ', [
            'ขอสงวนสิทธิ์ไม่คืนเงินหลังชำระ ยกเว้นกรณีที่เราให้บริการตามที่ชำระไว้ไม่ได้ (เช่น ปิดหรือย้ายสถานที่) หรือกรณีที่คุณมีสิทธิ์ได้รับเงินคืนตามกฎหมายไทย',
            '1 แพ็กเกจต่อ 1 ท่าน ไม่สามารถแบ่งกันใช้ได้',
            'เราพักแพ็กเกจให้ได้สูงสุด 30 วัน (หรือตามใบรับรองแพทย์ ไม่เกิน 2 เดือน) กรณีกระดูกหัก ปัญหาดวงตา ผ่าตัด หรือตั้งครรภ์และคลอดบุตร กรณีอื่นคุยกับเราได้ กรุณาแจ้งทาง LINE @aybkk ก่อนเริ่มพักทุกครั้ง',
            'ต้องย้ายออกจากกรุงเทพฯ หรือแพทย์ให้หยุดฝึก? หากการพักแพ็กเกจไม่ตอบโจทย์ สมาชิก 3, 6 และ 12 เดือน โอนให้ผู้ที่ยังไม่เคยเป็นสมาชิก AYBKK ได้ 1 ครั้ง วันหมดอายุเดิม ค่าธรรมเนียม ฿1,500 กรุณาแจ้งทาง LINE @aybkk ก่อน',
            'แพ็กเกจที่ซื้อก่อนวันที่ {since} ใช้เงื่อนไขตามที่ซื้อไว้',
          ]],
          ['รูปโปรไฟล์', [
            'จะเพิ่มรูปโปรไฟล์หรือไม่ก็ได้ หากเพิ่มรูป รูปจะแสดงบนช่องชื่อของคุณในไอแพดเช็กอินที่หน้าห้อง ซึ่งนักเรียนคนอื่นมองเห็นได้ และในรายชื่อของครูและทีมงาน ลบรูปได้ทุกเมื่อในแท็บ "บัญชีของฉัน"',
          ]],
        ],
        tick: 'ฉันได้อ่านและยอมรับข้อตกลงนี้แล้ว และฉันอายุ 20 ปีขึ้นไป',
        under20: 'อายุต่ำกว่า 20 ปี?',
        tickUnder20: 'ฉันได้อ่านและยอมรับข้อตกลงนี้แล้ว ฉันอายุต่ำกว่า 20 ปี ผู้ปกครองจะมาที่ชาลาพร้อมฉันก่อนคลาสแรก เพื่อลงชื่อให้ความยินยอม',
        signed: 'ลงชื่อโดย: {name} · {date} · {version} เราจะส่งสำเนาไปที่อีเมลของคุณ',
        dataH: 'ข้อมูลของคุณ:',
        data: 'AYBKK เก็บชื่อ ข้อมูลติดต่อ การจอง การเช็กอิน การชำระเงิน และข้อตกลงนี้ไว้ เพื่อจัดการคลาสของคุณ อ่าน{privacy}เพื่อดูว่าใครอีกบ้างที่ดูแลข้อมูล เก็บไว้นานเท่าใด และวิธีขอดู แก้ไข หรือลบข้อมูล',
        privacyLink: 'ประกาศความเป็นส่วนตัว',
        agreePay: 'ยอมรับและชำระเงิน {total}', agreeBook: 'ยอมรับและจองคลาส', agree: 'ยอมรับ',
      },
      privacy: {
        title: 'ประกาศความเป็นส่วนตัว',
        sections: [
          ['เราคือใคร', '{legal_name} เป็นผู้ดำเนินการ AYBKK (Ashtanga Yoga Center of Bangkok) {address} ติดต่อเราได้ที่ {email} หรือ LINE @aybkk'],
          ['ข้อมูลที่เราเก็บ', 'ชื่อ อีเมล เบอร์โทร ภาษาที่คุณใช้ การจอง การเช็กอิน แพ็กเกจ และการชำระเงินของคุณ บันทึกข้อตกลงที่คุณลงชื่อไว้ ได้แก่ ฉบับ ชื่อและอีเมลที่คุณใส่ วันที่และเวลา และคุณอายุต่ำกว่า 20 ปีหรือไม่ (หากใช่ จะมีชื่อผู้ปกครองและวันที่ในเอกสารที่ผู้ปกครองลงชื่อด้วย) ข้อความที่คุณส่งถึงเราทาง LINE, Instagram หรือ Facebook สิ่งที่คุณเขียนในแบบฟอร์มปฐมนิเทศ (orientation) ซึ่งอาจมีอาการบาดเจ็บและผู้ติดต่อกรณีฉุกเฉิน และหากมี: บันทึกการฝึกของคุณ (journal) บันทึกที่ครูเขียนเกี่ยวกับการฝึกของคุณ ตัวเลขการเช็ก 12 สัปดาห์ รูปในคลาสที่มีชื่อคุณ และรูปโปรไฟล์ของคุณ รวมถึงหมายเลขไอพี (IP) ที่ใช้ขอลิงก์เข้าสู่ระบบ เราไม่เห็นและไม่เก็บเลขบัตรของคุณ'],
          ['เก็บไว้เพื่ออะไร', 'เพื่อจัดการคลาสของคุณ ได้แก่ การจอง การเช็กอิน แพ็กเกจ การชำระเงิน และใบเสร็จ เพื่อเป็นหลักฐานว่าคุณยอมรับข้อใดไว้ เพื่อช่วยให้ครูสอนคุณได้ดี รวมถึงรู้เรื่องอาการบาดเจ็บ และเพื่อตอบข้อความของคุณ ข้อมูลเหล่านี้จำเป็นต่อการให้บริการคลาส เราไม่ขายข้อมูลของคุณ'],
          ['ใครอีกบ้างที่ดูแลข้อมูล', 'PaySolutions รับชำระเงินออนไลน์ Resend ส่งอีเมลของเรา Cloudinary เก็บรูปภาพ Google: ครูเก็บรูปในคลาสไว้ใน Google Drive ก่อนนำขึ้นโปรไฟล์ และ Google Ads ทำงานเฉพาะเมื่อคุณกด "ตกลง" ที่แถบคุกกี้ Railway ดูแลเซิร์ฟเวอร์และฐานข้อมูลของเว็บไซต์นี้ Neo4j เก็บแบบฟอร์มปฐมนิเทศและบันทึกการฝึก OpenRouter (DeepSeek) เขียนสรุปบันทึกการฝึกด้วย AI เมื่อครูขอ LINE รับส่งแชต LINE ของเรา และรายชื่อคลาสประจำวันที่เราส่งเข้ากลุ่มทีมงาน (ชื่อและอักษรแรกของนามสกุล คลาส และแพ็กเกจ) Meta รับส่งข้อความ Instagram และ Facebook Anthropic (Claude) อ่านข้อความที่คุณส่งถึงเรา เพื่อจัดลำดับและร่างคำตอบ Telegram ส่งการแจ้งเตือนถึงทีมงาน เช่น เรื่องการชำระเงินหรือข้อความใหม่ พร้อมเนื้อความ บางบริการเก็บข้อมูลไว้นอกประเทศไทย'],
          ['เก็บไว้นานเท่าใด', 'บันทึกข้อตกลงที่คุณลงชื่อ: 10 ปีหลังคลาสสุดท้ายของคุณ เพราะอาจมีการเรียกร้องสิทธิ์ได้นานถึงเท่านั้น บันทึกการชำระเงิน: 5 ปี ตามที่กฎหมายภาษีกำหนด ข้อความแชต: 90 วัน ข้อมูลอื่นทั้งหมด: เก็บไว้ตลอดช่วงที่คุณฝึกกับเรา เราตรวจสอบข้อมูลเหล่านี้ปีละครั้ง และลบส่วนที่ไม่จำเป็นต้องใช้แล้ว หรือลบเร็วกว่านั้นหากคุณขอ'],
          ['สิทธิ์ของคุณ', 'คุณขอดูข้อมูล ขอสำเนา ขอแก้ไข หรือขอลบข้อมูลได้ เขียนมาที่ {email} หรือทักมาที่ LINE @aybkk คุณลบรูปโปรไฟล์เองได้ในแท็บ "บัญชีของฉัน" เราเก็บบันทึกข้อตกลงและบันทึกการชำระเงินไว้ตามระยะเวลาข้างต้น แม้คุณขอให้ลบข้อมูลอื่น หากไม่พอใจวิธีที่เราดูแลข้อมูล คุณร้องเรียนต่อคณะกรรมการคุ้มครองข้อมูลส่วนบุคคลได้'],
        ],
      },
    },
    // NEEDS A NATIVE CHECK: Chinese, translated from the English by Claude (20 Nov 2026 draft 3), not yet
    // read by a native speaker. Keep the switch off until one has. Lines 13 to 16 are the site's own
    // Member notes (bkk.html pol1a..pol4b, 你 and 课程卡), as the English and Thai quote aybkk.net.
    zh: {
      agreement: {
        title: '第一次上课之前',
        lead: '请完整阅读一次，大约需要 2 分钟。',
        confirmTitle: '只需确认一次。',
        confirmLead: '感谢你一直和我们一起练习。现在我们为每一位学生存档这份简短的协议。请阅读一次。你的课程卡和预约都保持不变。',
        groups: [
          ['你的练习', [
            '阿斯汤加是一种身体练习。和任何运动一样，它可能造成受伤。',
            '第二天或之后几天，你可能会感到酸痛或疲倦，刚开始练习时尤其如此。这很常见。但刺痛，或一直不缓解的疼痛就不一样了：请告诉老师，并去看医生。',
            '在自己的能力范围内练习。你可以随时停下来休息。如果感到疼痛、头晕或身体不适，请停下并告诉老师。',
            '上课前，请当面告诉老师你的任何伤病、健康状况、手术或怀孕情况。如果不确定自己是否适合练习，请先咨询医生。',
            '老师可能会用手为你调整体式，随着你多年练习的进步，从基础调整到更进阶的调整。你可以在课前或课中随时拒绝。如有任何顾虑，请咨询老师。',
            '对于无人过错时的正常练习风险，AYBKK 不承担责任。本页任何内容均不限制你依照泰国法律享有的权利。',
          ]],
          ['在道场', [
            '每节课都请提前在 aybkk.net 预约，并在练习前到门口签到。引导课（Led）大家一起开始，请在开课前到达。如果迟到，请在门口等老师。',
            '请至少在上课前 5 小时取消，以保留课次。',
            '道场内禁止拍照和录像。AYBKK 工作人员有时会拍课堂照片，放到你不公开的个人页面。在公开发布有你的照片或视频之前，我们会先征求你的同意。',
            '练习期间禁止使用手机、禁止交谈、禁止喝水。如果因健康原因需要喝水，请告诉老师。',
            '我们提供擦汗毛巾和淋浴毛巾。请自带瑜伽垫，或在预约时勾选“需要租瑜伽垫”，在道场以 ฿200 租用。练习后，请用我们提供的喷雾清洁你的垫子和周围的地面。',
            '每逢满月和新月，道场休息。其他休息日，我们会在课表和 LINE @aybkk 上公布，尽量至少提前 7 天。',
          ]],
          ['你的课程卡', [
            '课程卡一经购买，不予退款，除非我们无法提供你已付费的课程（道场关闭或搬迁），或泰国法律规定你有权退款。',
            '课程卡仅限本人使用，不能与他人共用。',
            '可暂停最多30天（或按医生证明，最多2个月），适用于骨折、眼睛问题、手术、怀孕和生产。其他情况可以和我们商量。请在暂停开始前，通过 LINE @aybkk 告诉我们。',
            '要离开曼谷，或医生让你停练？如果暂停不合适，3个月、6个月或12个月会员可转让一次，给从未在 AYBKK 办过卡的新学员。到期日不变，手续费 ฿1,500。请先在 LINE @aybkk 联系我们。',
            '在 {since} 之前购买的课程卡，保留购买时的条款。',
          ]],
          ['你的照片', [
            '是否添加头像照片由你决定。如果添加，照片会显示在门口签到 iPad 上你的名字格里，其他学生可以看到；也会出现在老师和工作人员的名单中。你可以随时在“我的账户”中删除。',
          ]],
        ],
        tick: '我已阅读并同意。我已年满 20 岁。',
        under20: '未满 20 岁？',
        tickUnder20: '我已阅读并同意。我未满 20 岁。在第一次上课前，我的父母或监护人会陪我到道场表示同意。',
        signed: '签名：{name} · {date} · {version}。我们会把副本发到你的邮箱。',
        dataH: '你的资料：',
        data: 'AYBKK 保存你的姓名、联系方式、预约、签到、付款记录以及这份协议，用于安排你的课程。{privacy}说明了还有谁会处理这些资料、我们保存多久，以及如何查看、更正或删除。',
        privacyLink: '隐私声明',
        agreePay: '同意并支付 {total}', agreeBook: '同意并预约', agree: '同意',
      },
      privacy: {
        title: '隐私声明',
        sections: [
          ['我们是谁', '{legal_name} 经营 AYBKK（Ashtanga Yoga Center of Bangkok），地址：{address}。联系方式：{email} 或 LINE @aybkk。'],
          ['我们保存什么', '你的姓名、邮箱和电话，你使用的语言，你的预约、签到、课程卡和付款记录。你签署的协议记录：版本、你填写的姓名和邮箱、日期和时间，以及你是否未满 20 岁（如果是，还有监护人的姓名和其书面同意上的日期）。你通过 LINE、Instagram 或 Facebook 发给我们的消息。你在入门表格（orientation）中填写的内容，其中可能包括伤病情况和紧急联系人。如果有的话，还包括：你的练习日记、老师写下的关于你练习的笔记、你的 12 周检查数据、标记了你的课堂照片，以及你的头像照片。申请登录链接时使用的网络地址（IP）。我们看不到，也不保存你的银行卡号。'],
          ['为什么保存', '用于安排你的课程：预约、签到、课程卡、付款和收据；证明你同意了哪些内容；帮助老师更好地教你，包括了解你的伤病情况；回复你的消息。我们需要这些资料才能为你提供课程。我们绝不出售你的资料。'],
          ['还有谁处理这些资料', 'PaySolutions 处理在线付款。Resend 发送我们的邮件。Cloudinary 保存照片。Google：老师先把课堂照片放在 Google Drive，再放到个人页面；只有当你在 Cookie 提示栏点击“好的”时，才会使用 Google Ads。Railway 运行本网站的服务器和数据库。Neo4j 保存入门表格和练习日记。老师要求时，OpenRouter（DeepSeek）会为练习日记写一份 AI 摘要。LINE 传送我们的 LINE 聊天，以及我们每天发到员工群的课程名单（名字和姓氏首字母、课程和课程卡）。Meta 传送 Instagram 和 Facebook 消息。Anthropic（Claude）会阅读你发给我们的消息，用于分类并起草我们的回复。Telegram 向我们的工作人员发送提醒，例如关于付款或新消息的提醒，并附上消息内容。其中一些服务会在泰国境外保存资料。'],
          ['保存多久', '你签署的协议记录：在你最后一节课后保存 10 年，因为索赔可能在这么久之后才提出。付款记录：按照税法要求保存 5 年。聊天消息：90 天。其他所有资料：在你和我们一起练习期间保存。我们每年检查一次，删除不再需要的资料；如果你提出要求，可以更早删除。'],
          ['你的权利', '你可以要求查看你的资料、获取副本、更正或删除。请发邮件到 {email}，或通过 LINE @aybkk 联系我们。你可以在“我的账户”中自行删除头像照片。即使你要求删除其他资料，我们也会按上述期限保存协议记录和付款记录。如果你对我们处理资料的方式不满意，可以向泰国个人数据保护委员会投诉。'],
        ],
      },
    },
    // NEEDS A NATIVE CHECK: Russian, translated from the English by Claude (20 Nov 2026 draft 3), not yet
    // read by a native speaker. Keep the switch off until one has. Lines 13 to 16 are the site's own
    // Member notes (bkk.html pol1a..pol4b).
    ru: {
      agreement: {
        title: 'Перед первым занятием',
        lead: 'Пожалуйста, прочитайте это один раз. Это займёт около 2 минут.',
        confirmTitle: 'Подтвердите один раз.',
        confirmLead: 'Спасибо, что практикуете с нами. Теперь мы храним это короткое соглашение для каждого ученика. Прочитайте его один раз. Ваш абонемент и записи остаются как есть.',
        groups: [
          ['Ваша практика', [
            'Аштанга является физической практикой. Как и любые упражнения, она может привести к травме.',
            'На следующий день или несколько дней вы можете чувствовать боль в мышцах или усталость, особенно в начале. Это обычное дело. С острой болью или болью, которая не проходит, всё иначе: скажите учителю и обратитесь к врачу.',
            'Практикуйте в пределах своих возможностей. Вы можете остановиться и отдохнуть в любой момент. Если вы чувствуете боль, головокружение или недомогание, остановитесь и скажите учителю.',
            'Перед занятием лично сообщите учителю о любой травме, проблеме со здоровьем, операции или беременности. Если вы не уверены, что вам можно практиковать, сначала посоветуйтесь с врачом.',
            'Учителя могут делать корректировки руками (ассисты), от базовых до более продвинутых, по мере вашего прогресса за годы практики. Вы можете отказаться в любой момент, до или во время занятия. Если вас что-то беспокоит, обратитесь к учителю.',
            'AYBKK не отвечает за обычные риски практики, когда никто не виноват. Ничто здесь не ограничивает ваши права по законодательству Таиланда.',
          ]],
          ['В шале', [
            'Записывайтесь на каждое занятие заранее на aybkk.net и отмечайтесь у входа перед практикой. На занятиях Led все начинают вместе, поэтому приходите до начала. Если вы опоздали, подождите учителя у входа.',
            'Отменяйте запись минимум за 5 часов до занятия, чтобы оно не списалось.',
            'В шале нельзя фотографировать и снимать видео. Сотрудники AYBKK иногда фотографируют занятия для вашего закрытого профиля. Прежде чем публиковать фото или видео с вами в открытом доступе, мы спрашиваем вас.',
            'Во время практики нельзя пользоваться телефоном, разговаривать и пить воду. Если вам нужна вода по состоянию здоровья, скажите учителю.',
            'Мы выдаём полотенце для пота и полотенце для душа. Приносите свой коврик или отметьте «Нужен коврик» при записи и возьмите коврик в аренду в шале за ฿200. После практики протрите коврик и пол вокруг него спреем, который мы даём.',
            'В дни полнолуния и новолуния шала закрыта. О других днях закрытия мы сообщаем в расписании и в LINE @aybkk, по возможности минимум за 7 дней.',
          ]],
          ['Ваш абонемент', [
            'Оплаченный абонемент не возвращается, кроме случаев, когда мы не можем провести оплаченные занятия (если шала закроется или переедет) или когда законодательство Таиланда даёт вам право на возврат.',
            'Абонемент только для вас, делиться им нельзя.',
            'Заморозка до 30 дней (или по справке врача, до 2 месяцев): перелом, проблемы с глазами, операция, беременность и роды. Другие случаи обсудим. Напишите нам в LINE @aybkk до начала заморозки.',
            'Уезжаете или врач велит сделать перерыв? Если заморозка не подходит, абонемент на 3, 6 или 12 месяцев можно один раз передать человеку, который ещё не занимался в AYBKK. Дата окончания та же. Сбор ฿1,500. Сначала напишите нам в LINE @aybkk.',
            'Абонемент, купленный до {since}, сохраняет условия, на которых он был продан.',
          ]],
          ['Ваше фото', [
            'Фото профиля добавляется по вашему желанию. Если вы его добавите, оно появится на вашей плитке на iPad для отметки у входа, где его видят другие ученики, а также в списках ваших учителей и сотрудников. Удалить фото можно в любой момент в разделе «Мой аккаунт».',
          ]],
        ],
        tick: 'Я прочитал(а) и согласен(на). Мне 20 лет или больше.',
        under20: 'Вам меньше 20?',
        tickUnder20: 'Я прочитал(а) и согласен(на). Мне меньше 20 лет. Перед первым занятием мой родитель или опекун придёт со мной в шалу, чтобы дать согласие.',
        signed: 'Подпись: {name} · {date} · {version}. Мы отправим вам копию на email.',
        dataH: 'Ваши данные:',
        data: 'AYBKK хранит ваше имя, контактные данные, записи, отметки о посещении, платежи и это соглашение, чтобы проводить ваши занятия. В документе «{privacy}» сказано, кто ещё обрабатывает эти данные, как долго мы их храним и как их посмотреть, исправить или удалить.',
        privacyLink: 'Уведомление о конфиденциальности',
        agreePay: 'Согласиться и оплатить {total}', agreeBook: 'Согласиться и записаться', agree: 'Согласиться',
      },
      privacy: {
        title: 'Уведомление о конфиденциальности',
        sections: [
          ['Кто мы', '{legal_name} управляет AYBKK (Ashtanga Yoga Center of Bangkok), {address}. Связаться с нами: {email} или LINE @aybkk.'],
          ['Что мы храним', 'Ваше имя, email и телефон, язык, которым вы пользуетесь, ваши записи, отметки о посещении, абонементы и платежи. Запись о подписанном вами соглашении: версия, указанные вами имя и email, дата и время, а также отметка, если вам меньше 20 лет (тогда ещё имя вашего родителя или опекуна и дата на его бумаге). Сообщения, которые вы пишете нам в LINE, Instagram или Facebook. То, что вы написали в анкете для новичков (orientation): там могут быть травмы и контакт на экстренный случай. Кроме того, если они есть: ваш дневник практики, заметки учителей о вашей практике, ваши данные 12-недельной проверки, фото с занятий, где вы отмечены, и ваше фото профиля. IP-адрес, с которого запросили ссылку для входа. Номер вашей карты мы не видим и не храним.'],
          ['Зачем', 'Чтобы проводить ваши занятия: записи, отметки, абонементы, платежи и чеки. Чтобы подтверждать, с чем вы согласились. Чтобы учителям было легче вас учить, в том числе знать о травме. Чтобы отвечать на ваши сообщения. Без этих данных мы не можем проводить для вас занятия. Мы никогда не продаём ваши данные.'],
          ['Кто ещё обрабатывает данные', 'PaySolutions принимает онлайн-платежи. Resend отправляет наши письма. Cloudinary хранит фотографии. Google: учителя кладут фото с занятий в Google Drive, прежде чем добавить их в профили, а Google Ads работает, только если вы нажмёте OK в панели cookie. Railway обеспечивает работу сервера и базы данных этого сайта. Neo4j хранит анкеты для новичков и дневники практики. OpenRouter (DeepSeek) пишет ИИ-сводку дневника практики, когда об этом просит учитель. LINE передаёт наши чаты в LINE и ежедневный список занятий, который мы отправляем в группу сотрудников (имя и первая буква фамилии, занятия и абонементы). Meta передаёт сообщения Instagram и Facebook. Anthropic (Claude) читает сообщения, которые вы нам пишете, чтобы сортировать их и готовить черновики наших ответов. Telegram доставляет нашим сотрудникам уведомления, например о платеже или новом сообщении, вместе с его текстом. Некоторые из этих сервисов хранят данные за пределами Таиланда.'],
          ['Как долго', 'Запись о подписанном соглашении: 10 лет после вашего последнего занятия, потому что претензия может появиться так поздно. Платёжные записи: 5 лет, как требует налоговое законодательство. Сообщения в чатах: 90 дней. Всё остальное хранится, пока вы занимаетесь с нами. Раз в год мы проверяем эти данные и удаляем то, что больше не нужно, или раньше, если вы попросите.'],
          ['Ваши права', 'Вы можете попросить показать ваши данные, выдать их копию, исправить или удалить их. Напишите на {email} или в LINE @aybkk. Фото профиля можно удалить самостоятельно в разделе «Мой аккаунт». Запись о соглашении и платёжные записи мы храним указанные выше сроки, даже если вы попросите удалить остальное. Если вас не устраивает, как мы обращаемся с вашими данными, вы можете подать жалобу в Комитет по защите персональных данных Таиланда.'],
        ],
      },
    },
  },
};
// The idcn pattern: a version this server would ask people to sign must have English and Thai.
function checkConsentText(text = CONSENT_TEXT, version = CONSENT_VERSION) {
  const v = text[version];
  if (!/^v\d{1,3}$/.test(version) || !v) throw new Error(`bkk-api: consent ${version} has no text`);
  for (const l of ['en', 'th']) {
    const x = v[l];
    if (!x || !x.agreement || !x.privacy || !Array.isArray(x.agreement.groups) || !x.agreement.groups.length)
      throw new Error(`bkk-api: consent ${version} has no ${l.toUpperCase()} text`);
  }
}
checkConsentText();
const consentLangs = (version = CONSENT_VERSION) => CONSENT_LANGS.filter(l => CONSENT_TEXT[version] && CONSENT_TEXT[version][l]);
// What a signature points at: the agreement as written, in the language it was shown in.
const consentSha = (version, lang) => crypto.createHash('sha256').update(JSON.stringify(CONSENT_TEXT[version][lang].agreement)).digest('hex');
const privacySha = (version, lang) => crypto.createHash('sha256').update(JSON.stringify(CONSENT_TEXT[version][lang].privacy)).digest('hex');

// The tee pre-order's own privacy notice (24 Nov 2026), shown at the tee checkout instead of the
// class agreement: a tee buyer in China never signs the shala's agreement. Pinned by its sha256 in
// test/bkk-api.test.js like CONSENT_TEXT: changed words are a new version. {legal_name}, {address}
// and {email} are the class notice's Settings; {purge_days} is the drop's own. ZH NEEDS A NATIVE CHECK:
// translated from the English by Claude, not yet read by a native speaker.
const TEE_NOTICE_VERSION = 't1';
const TEE_NOTICE = {
  t1: {
    en: {
      title: 'Tee pre-order: privacy notice',
      sections: [
        ['Who we are', '{legal_name} runs AYBKK (Ashtanga Yoga Center of Bangkok), {address}. Contact us at {email} or on LINE @aybkk.'],
        ['What we keep', 'Your name, WeChat ID, mobile number if you give one, email, the tees you order, your pickup point, and the payment record (amount, date, reference). We never see or keep your card or wallet details: PaySolutions handles the payment.'],
        ['Why', 'To hand this order to you at the pickup point you chose, to send your receipt, and to answer your questions about this order. We never sell your data.'],
        ['Who else sees it', 'PaySolutions takes the payment and receives your email. Resend sends our emails. Railway runs the server and database of this site. Cloudflare carries this site’s traffic to and from cn.aybkk.net. The AYBKK team member at your pickup point sees your name, WeChat ID and the tees you ordered, to hand them to you. Alerts to our staff on Telegram carry the order reference and how many tees, never your name or contact details.'],
        ['Thailand and China', 'AYBKK is in Thailand. Your details are kept on servers outside China, and travel between Thailand and China so that a team member can hand your order to you in China.'],
        ['How long', 'Your name, WeChat ID, mobile number and email are deleted {purge_days} days after you collect your order, or 7 days after an order is cancelled or left unpaid. If a problem with your order is still open (a swap, a refund, a wrong amount), we keep them until it is settled, at most 60 days longer. The payment record is kept for 5 years, as Thai tax law asks.'],
        ['Your rights', 'You can ask to see your data, get a copy, correct it or delete it. Write to {email} or message LINE @aybkk. We keep the payment record for the time above even if you ask us to delete the rest. If you are not happy with how we handle your data, you can complain to the Personal Data Protection Committee of Thailand.'],
      ],
      tick: 'I have read the privacy notice for this order.',
    },
    zh: {
      title: 'T恤预订：隐私声明',
      sections: [
        ['我们是谁', '{legal_name} 经营 AYBKK（Ashtanga Yoga Center of Bangkok），地址：{address}。联系方式：{email} 或 LINE @aybkk。'],
        ['我们保存什么', '你的姓名、微信号、手机号（如果你填写）、邮箱、你订购的T恤、你选择的领取点，以及付款记录（金额、日期、订单号）。我们看不到，也不保存你的银行卡或钱包信息：付款由 PaySolutions 处理。'],
        ['为什么保存', '用于在你选择的领取点把这份订单交给你、发送收据，以及回答你关于这份订单的问题。我们绝不出售你的资料。'],
        ['还有谁会看到', 'PaySolutions 处理付款，并会收到你的邮箱。Resend 发送我们的邮件。Railway 运行本网站的服务器和数据库。Cloudflare 为 cn.aybkk.net 传送本网站的数据。你所选领取点的 AYBKK 成员会看到你的姓名、微信号和你订购的T恤，以便把T恤交给你。通过 Telegram 发给工作人员的提醒只包含订单号和T恤数量，绝不包含你的姓名或联系方式。'],
        ['泰国和中国', 'AYBKK 位于泰国。你的资料保存在中国境外的服务器上，并会在泰国和中国之间传送，以便 AYBKK 成员在中国把订单交给你。'],
        ['保存多久', '你的姓名、微信号、手机号和邮箱会在你领取订单 {purge_days} 天后删除；订单取消或未付款的，7 天后删除。如果订单还有未解决的问题（换货、退款、金额不符），我们会保留到问题解决为止，最多再保留 60 天。付款记录按照泰国税法要求保存 5 年。'],
        ['你的权利', '你可以要求查看你的资料、获取副本、更正或删除。请发邮件到 {email}，或通过 LINE @aybkk 联系我们。即使你要求删除其他资料，我们也会按上述期限保存付款记录。如果你对我们处理资料的方式不满意，可以向泰国个人数据保护委员会投诉。'],
      ],
      tick: '我已阅读这份订单的隐私声明。',
    },
  },
};
const teeNoticeSha = (version, lang) => crypto.createHash('sha256').update(JSON.stringify(TEE_NOTICE[version][lang])).digest('hex');
const TEE_SIZES = ['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL'];
const TEE_LANGS = ['en', 'zh', 'th', 'ru'];          // what a buyer's page may say it is; mail and notice are zh or en
const TEE_FEW = 3;                                  // "a few left" at this many or fewer, never the number
const TEE_HOLDS_PER_EMAIL = 2;                      // live unpaid holds per drop per email
const TEE_ORDERS_PER_IP_HOUR = 20;                  // a script holding the whole drop, from one address
const TEE_UNPAID_PURGE_DAYS = 7;                    // contact details after a cancel or a lapsed unpaid hold
const TEE_HELD_DAYS = 60;                           // at most this much longer while a problem note or a wrong amount is open
const TEE_GATEWAY_KEEP = ['ReferenceNo', 'OrderNo', 'Status', 'StatusName', 'Total', 'CardType', 'CurrencyCode', 'OrderDateTime'];
const TEE_ORIGIN = 'https://cn.aybkk.net';          // the status link in the receipt: buyers are in China

// ── seed data (from aybkk.com, captured 2026-08-05) ─────────────────────────
// price_thb is the BASE price. The online surcharge is a setting, applied at
// checkout, so it can be changed without touching the catalogue.
const SEED_PRODUCTS = [
  { code: 'dropin',    name_en: 'Drop-in',              name_th: 'ครั้งเดียว',        price_thb: 1500,  kind: 'credits',   credits: 1,  valid_days: 1,   daily_cap: null, sort: 10 },
  { code: 'pack8',     name_en: '8 classes / 2 months',  name_th: '8 ครั้ง / 2 เดือน',  price_thb: 7600,  kind: 'credits',   credits: 8,  valid_days: 60,  daily_cap: null, sort: 20 },
  // Rezerv sold the 8 classes as 1 month (6 to 9 Nov 2026). Never for sale here:
  // it keeps those passes, and passes staff typed in with dates, named as they are.
  { code: 'pack8m1',   name_en: '8 classes / 1 month',   name_th: '8 ครั้ง / 1 เดือน',  price_thb: 7600,  kind: 'credits',   credits: 8,  valid_days: 30,  daily_cap: null, sort: 21, active: false },
  // Not sold since 6 Nov 2026 (pack8 replaced it). Kept for the passes already
  // sold and the Rezerv imports that point at it.
  { code: 'pack10',    name_en: '10 classes / 3 months', name_th: '10 ครั้ง / 3 เดือน', price_thb: 14000, kind: 'credits',   credits: 10, valid_days: 90,  daily_cap: null, sort: 25, active: false },
  { code: 'unlim1',    name_en: '1 month unlimited',     name_th: '1 เดือน ไม่จำกัด',   price_thb: 9600,  kind: 'unlimited', credits: null, valid_days: 30,  daily_cap: 2, sort: 30 },
  { code: 'unlim3',    name_en: '3 months unlimited',    name_th: '3 เดือน ไม่จำกัด',   price_thb: 25800, kind: 'unlimited', credits: null, valid_days: 90,  daily_cap: 2, sort: 50 },
  { code: 'unlim6m',   name_en: '6 months unlimited',    name_th: '6 เดือน ไม่จำกัด',   price_thb: 34200, kind: 'unlimited', credits: null, valid_days: 180, daily_cap: 2, sort: 60, active: false },
  { code: 'unlim12m',  name_en: '12 months unlimited',   name_th: '12 เดือน ไม่จำกัด',  price_thb: 78000, kind: 'unlimited', credits: null, valid_days: 365, daily_cap: 2, sort: 70 },
];
// New prices from 12 Nov 2026 00:00 Bangkok (Boonchu, 2 Nov), with the
// 6-month package on sale again. 3 months is 19,500, 6,500 a month (Boonchu,
// 6 Nov). Nothing runs on a timer here, so the first request from then on
// makes the change (switchPrices). unlim6m is a new code: the old 45,000
// 6-month (unlim6) stays for the passes Rezerv sold.
const PRICE_SWITCH = {
  at: Date.parse('2026-11-12T00:00:00+07:00'),
  key: 'prices_from_2026_11_12',
  prices: { unlim3: 19500, unlim6m: 34200, unlim12m: 63600 },
  opens: ['unlim6m'],
  // 11 Nov evening (Boonchu): 6 months 5,700 a month, 12 months 5,300 a month, so
  // the year never costs less a month than the 40%-off promotion did. A shala that
  // already switched at 32,000 / 59,900 moves once; a price staff set stays.
  raise: { key: 'prices_6m12m_from_2026_11_12', from: { unlim6m: 32000, unlim12m: 59900 } },
};

// weekday: 0=Sun … 6=Sat
// Moon days: the shala is closed on the Bangkok date of every new and full moon.
// Mean-lunation formula with the main periodic terms (Walker's moontool); checked
// against an ephemeris for 2026–2028 with no date wrong.
const rad = d => d * Math.PI / 180;
function moonJD(k) {
  const t = k / 1236.85, t2 = t * t, t3 = t2 * t;
  let jd = 2415020.75933 + 29.53058868 * k + 0.0001178 * t2 - 0.000000155 * t3
    + 0.00033 * Math.sin(rad(166.56 + 132.87 * t - 0.009173 * t2));
  const m = rad(359.2242 + 29.10535608 * k - 0.0000333 * t2 - 0.00000347 * t3);
  const mp = rad(306.0253 + 385.81691806 * k + 0.0107306 * t2 + 0.00001236 * t3);
  const f = rad(21.2964 + 390.67050646 * k - 0.0016528 * t2 - 0.00000239 * t3);
  jd += (0.1734 - 0.000393 * t) * Math.sin(m) + 0.0021 * Math.sin(2 * m)
    - 0.4068 * Math.sin(mp) + 0.0161 * Math.sin(2 * mp) - 0.0004 * Math.sin(3 * mp)
    + 0.0104 * Math.sin(2 * f) - 0.0051 * Math.sin(m + mp) - 0.0074 * Math.sin(m - mp)
    + 0.0004 * Math.sin(2 * f + m) - 0.0004 * Math.sin(2 * f - m)
    - 0.0006 * Math.sin(2 * f + mp) + 0.0010 * Math.sin(2 * f - mp) + 0.0005 * Math.sin(m + 2 * mp);
  return jd;
}
function moonDaysBetween(fromYmd, toYmd) {
  const out = new Map();
  const y = Number(fromYmd.slice(0, 4)) + (Number(fromYmd.slice(5, 7)) - 1) / 12;
  const k0 = Math.floor((y - 1900) * 12.3685) - 2;
  for (let k = k0; k < k0 + 40; k++) {
    for (const [ph, name] of [[0, 'new'], [0.5, 'full']]) {
      const ms = (moonJD(k + ph) - 2440587.5) * 86400000;
      const d = new Date(ms + 7 * 3600000).toISOString().slice(0, 10);
      if (d >= fromYmd && d <= toYmd) out.set(d, name);
    }
  }
  return out;
}

const SEED_SLOTS = [
  // Titles carry no times — the schedule already shows the time in its own column.
  // teachers: one name, or a name per weekday. Saturday Led Primary rotates (SAT_PRIMARY_ROTATION).
  { code: 'my530',   title: 'Mysore (1st batch)',        kind: 'mysore',       weekdays: [2,3,4,5],   start_time: '05:30', duration_min: 120, capacity: 42, is_online: false, teachers: { 2: 'Boonchu', 3: 'M', 4: 'M', 5: 'Boonchu' } },
  { code: 'my730',   title: 'Mysore (2nd batch)',        kind: 'mysore',       weekdays: [2,3,4,5],   start_time: '07:30', duration_min: 120, capacity: 42, is_online: false, teachers: 'Boonchu' },
  { code: 'lp_mon',  title: 'Led Primary series',        kind: 'led_primary',  weekdays: [1],         start_time: '06:30', duration_min: 90,  capacity: 42, is_online: false, teachers: 'Boonchu' },
  { code: 'lp_sat',  title: 'Led Primary series',        kind: 'led_primary',  weekdays: [6],         start_time: '07:00', duration_min: 90,  capacity: 42, is_online: false },
  { code: 'li_sat',  title: 'Led Intermediate series',   kind: 'led_inter',    weekdays: [6],         start_time: '08:45', duration_min: 120, capacity: 42, is_online: false, teachers: 'Boonchu' },
  { code: 'my_sun',  title: 'Mysore Sunday',             kind: 'mysore',       weekdays: [0],         start_time: '07:00', duration_min: 150, capacity: 42, is_online: false, teachers: 'M' },
  { code: 'olp_mon', title: '[Online] Led Primary series',      kind: 'led_primary', weekdays: [1], start_time: '06:30', duration_min: 90,  capacity: 20, is_online: true, teachers: 'Boonchu' },
  { code: 'olp_sat', title: '[Online] Led Primary series',      kind: 'led_primary', weekdays: [6], start_time: '07:00', duration_min: 90,  capacity: 10, is_online: true },
  { code: 'oli_sat', title: '[Online] Led Intermediate series', kind: 'led_inter',   weekdays: [6], start_time: '09:00', duration_min: 120, capacity: 15, is_online: true, teachers: 'Boonchu' },
];
// Saturday Led Primary takes turns week by week, Jamsai first on 17 Oct 2026 (Boonchu, 4 Oct).
const SAT_PRIMARY_ROTATION = { codes: ['lp_sat', 'olp_sat'], from: '2026-10-17', teachers: ['Jamsai', 'M'] };
function rotationTeacher(code, ymdStr) {
  if (!SAT_PRIMARY_ROTATION.codes.some(c => code === `${c}_6`)) return null;
  const weeks = Math.round((Date.parse(ymdStr) - Date.parse(SAT_PRIMARY_ROTATION.from)) / (7 * 86400000));
  const t = SAT_PRIMARY_ROTATION.teachers;
  return t[((weeks % t.length) + t.length) % t.length];
}

// ── reading Rezerv's export (Oct 2026) ──────────────────────────────────────
// Thailand writes the day first, often in the Buddhist year (2569 = 2026), and
// a spreadsheet re-saves dates in its own way, so every shape seen in the wild
// is read. All dates and times are Bangkok.
const MON_EN = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const MON_TH = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
const MON_TH_SHORT = ['มค', 'กพ', 'มีค', 'เมย', 'พค', 'มิย', 'กค', 'สค', 'กย', 'ตค', 'พย', 'ธค'];
function monthOf(word) {
  const w = String(word).toLowerCase().replace(/[.,\s]/g, '');
  if (/^[a-z]{3,}$/.test(w)) return MON_EN[w.slice(0, 3)] || null;
  const i = MON_TH.indexOf(w);
  if (i >= 0) return i + 1;
  const j = MON_TH_SHORT.indexOf(w);
  return j >= 0 ? j + 1 : null;
}
// Two-digit years never overlap: 15–30 are 2015–2030, 58–73 are Buddhist 2558–2573.
function fullYear(y) {
  const n = Number(y);
  if (y.length <= 2) return n >= 50 ? 2500 + n - 543 : 2000 + n;
  return n > 2400 ? n - 543 : n;
}
// A class written as a range, "05:30 - 07:30", is read as its start.
const rangeStart = s => s.replace(/(\d[:.]\d{2}(?::\d{2})?(?:\s*[ap]\.?m\.?|\s*น\.?)?)\s*[-–]\s*\d{1,2}[:.]\d{2}.*$/i, '$1');
// "05:30", "5:30 AM", "05:30:00", "05.30 น." → "05:30"
function parseClock(v) {
  const s = String(v ?? '').trim();
  if (s.length > 40) return null;
  const m = rangeStart(s).match(/^(\d{1,2})[:.](\d{2})(?::\d{2}(?:\.\d+)?)?\s*(a\.?m\.?|p\.?m\.?|น\.?)?$/i);
  if (!m) return null;
  let h = Number(m[1]);
  const ap = (m[3] || '').toLowerCase();
  if (/^[ap]/.test(ap)) {
    if (h < 1 || h > 12) return null;
    if (ap[0] === 'p' && h < 12) h += 12;
    if (ap[0] === 'a' && h === 12) h = 0;
  }
  if (h > 23 || Number(m[2]) > 59) return null;
  return `${String(h).padStart(2, '0')}:${m[2]}`;
}
// → { date: 'YYYY-MM-DD', time: 'HH:MM' | null }, or null when unreadable.
function parseWhen(v) {
  // The era ("พ.ศ. 2569") goes: the year itself says which one it is.
  let s = String(v ?? '').replace(/[พค]\.\s?ศ\./g, ' ').trim().replace(/\s+/g, ' ');
  // A date cell is short. A long one is not a date, and the patterns below
  // backtrack badly on one (a whole server stalls on a 4 KB cell).
  if (!s || s.length > 80) return null;
  // Only an explicit UTC time or offset is converted; anything else is Bangkok already.
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/.test(s)) {
    const t = Date.parse(s);
    if (isNaN(t)) return null;
    const b = new Date(t + 7 * 3600000).toISOString();
    return { date: b.slice(0, 10), time: b.slice(11, 16) };
  }
  s = rangeStart(s);
  let rest = s, time = null;
  const tm = s.match(/(^|[\sT,])(\d{1,2}[.:]\d{2}\s*น\.?|\d{1,2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:\s*[ap]\.?m\.?)?)(?=$|\s)/i);
  if (tm) {
    time = parseClock(tm[2]);
    if (!time) return null;
    rest = (s.slice(0, tm.index) + ' ' + s.slice(tm.index + tm[0].length)).trim();
  }
  rest = rest.replace(/(?:[,\s]*(?:at|เวลา))?[,\s]*$/i, '')
    .replace(/^(sun|mon|tue|wed|thu|fri|sat)[a-z]*\.?,?\s+/i, '').replace(/^วัน[^\s\d]*ที่\s*/, '').trim();
  let y, mo, d, m;
  if ((m = rest.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/))) [y, mo, d] = [fullYear(m[1]), +m[2], +m[3]];
  else if ((m = rest.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/))) [d, mo, y] = [+m[1], +m[2], fullYear(m[3])];
  else if ((m = rest.match(/^(\d{1,2})[\s-]*([^\d\s-]+)[\s-]*(\d{2}|\d{4})$/))) [d, mo, y] = [+m[1], monthOf(m[2]), fullYear(m[3])];
  else if ((m = rest.match(/^([A-Za-z]+)\.?\s+(\d{1,2}),?\s+(\d{4})$/))) [mo, d, y] = [monthOf(m[1]), +m[2], fullYear(m[3])];
  else return null;
  if (!mo || !d || y < 1990 || y > 2100) return null;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return { date: dt.toISOString().slice(0, 10), time };
}
// "฿1,500.00", "THB 9600", "(1,500)" → number; null when it is not an amount.
function parseAmount(v) {
  if (typeof v === 'number') return isFinite(v) ? v : null;
  const s = String(v ?? '').trim();
  if (!s) return null;
  const n = s.replace(/[^\d.,]/g, '').replace(/,/g, '');
  if (!/^\d+(\.\d+)?$/.test(n)) return null;
  return (/^\(.*\)$/.test(s) || s.includes('-')) ? -Number(n) : Number(n);
}
const luhn = digits => {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let x = Number(digits[digits.length - 1 - i]);
    if (i % 2) { x *= 2; if (x > 9) x -= 9; }
    sum += x;
  }
  return sum % 10 === 0;
};
// Card numbers are never kept, not even typed into a note.
const noCards = s => String(s).replace(/\d(?:[ -]?\d){12,18}/g, m => luhn(m.replace(/\D/g, '')) ? '[card number removed]' : m);
// Rezerv's visit statuses, loosely: order matters ("not attended", "late cancel", "ไม่มา").
const VISIT_WORDS = [
  [/late[\s_-]*cancel|ยกเลิกช้า|ยกเลิกกระชั้น/i, 'late'],
  [/no[\s_-]*show|absent|missed|not[\s_-]*(attend|came|show)|did\s*n[o']?t|ไม่มา|ขาด/i, 'noshow'],
  [/wait|รอคิว|สำรอง/i, 'waitlist'],
  [/cancel|ยกเลิก|refund/i, 'cancelled'],
  // "Not checked in", "Unattended", "Incomplete", "ยังไม่เข้าเรียน": did not come
  // (yet). A no-show once the class is over, a seat while it is still to come.
  [/\b(not|no|un|non|never)[\s_-]*(yet[\s_-]*)?(check|attend|complet|came|come|show|visit|present)|incomplete|pending|ไม่/i, 'unchecked'],
  [/attend|check(ed)?[\s_-]*in|present|came|complete|done|visit|เข้าเรียน|มาเรียน|เช็[คก]อิน|เข้าร่วม|มาแล้ว/i, 'attended'],
  [/book|confirm|reserv|upcoming|schedul|จอง|ยืนยัน/i, 'booked'],
];
function visitStatus(v) {
  const s = String(v ?? '').trim();
  if (!s) return null;
  const hit = VISIT_WORDS.find(([re]) => re.test(s));
  return hit ? hit[1] : undefined;
}
// Rezerv's payment states. Only money that came in, or went back, is kept:
// order matters ("Payment failed", "Refund pending", "Unpaid").
const PAY_WORDS = [
  [/fail|declin|reject|pending|await|\bdue\b|overdue|unpaid|not[\s_-]*paid|cancel|void|expir|abandon|incomplete|chargeback|disput|ไม่สำเร็จ|ยกเลิก|รอชำระ|รอดำเนินการ|รอตรวจสอบ|ค้างชำระ|หมดอายุ|ยังไม่ชำระ|ไม่ได้ชำระ/i, 'skip'],
  [/refund|คืนเงิน/i, 'refund'],
  [/paid|success|complete|approv|captur|settl|^ok$|sale|purchase|payment|charge|ชำระแล้ว|จ่ายแล้ว|สำเร็จ|เรียบร้อย|ขาย|ซื้อ/i, 'paid'],
];
function payStatus(v) {
  const s = String(v ?? '').trim();
  if (!s) return null;
  const hit = PAY_WORDS.find(([re]) => re.test(s));
  return hit ? hit[1] : undefined;
}
function payMethod(raw) {
  const s = String(raw || '').toLowerCase();
  if (!s) return 'other';
  if (/cash|เงินสด/.test(s)) return 'cash';
  if (/card|credit|debit|visa|master|amex|jcb|บัตร/.test(s)) return 'card';
  if (/transfer|bank|prompt\s*pay|qr|โอน|พร้อมเพย์|ธนาคาร/.test(s)) return 'transfer';
  if (/online|web|app|stripe|omise|paypal|2c2p|pay\s*solutions?|gateway|ออนไลน์/.test(s)) return 'online';
  return 'other';
}

function mountBkk(app, opts = {}) {
  const pool = opts.pgPool;
  const cloudinary = opts.cloudinary || null;
  const httpFetch = opts.fetch || fetch;
  // New class photos go to Cloudflare R2 when its four variables are set (lib/r2.js).
  const r2 = r2lib.makeR2({ endpoint: opts.r2Endpoint });
  // Tests move the clock the 12 Nov price switch and the face links read.
  const nowMs = typeof opts.now === 'function' ? opts.now : Date.now;
  // No key set means no admin at all: the repo is public, so a default key
  // would open every student's data to anyone.
  const ADMIN_KEY = process.env.BKK_ADMIN_KEY || process.env.SHOP_ADMIN_KEY || '';
  if (!ADMIN_KEY) console.warn('⚠ bkk-api: BKK_ADMIN_KEY not set — admin endpoints are closed');
  // Header only. A key in the query string ends up in access logs, browser
  // history and Referer headers.
  const isAdmin = req => !!ADMIN_KEY && req.headers['x-bkk-key'] === ADMIN_KEY;

  if (!pool) { console.warn('⚠ bkk-api: no pgPool — Bangkok API disabled'); return; }
  const q = (sql, params = []) => pool.query(sql, params);

  // ── schema ────────────────────────────────────────────────────────────────
  async function initSchema() {
    await q(`CREATE TABLE IF NOT EXISTS bkk_settings (
      key TEXT PRIMARY KEY, value JSONB, updated_at TIMESTAMPTZ DEFAULT now())`);
    await q(`CREATE TABLE IF NOT EXISTS bkk_products (
      id SERIAL PRIMARY KEY, code TEXT UNIQUE NOT NULL,
      name_en TEXT NOT NULL, name_th TEXT, price_thb INTEGER NOT NULL,
      kind TEXT NOT NULL, credits INTEGER, valid_days INTEGER NOT NULL,
      daily_cap INTEGER, active BOOLEAN DEFAULT true, sort INTEGER DEFAULT 100)`);
    await q(`CREATE TABLE IF NOT EXISTS bkk_members (
      id SERIAL PRIMARY KEY, code TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL, email TEXT, phone TEXT,
      student_id TEXT, created_at TIMESTAMPTZ DEFAULT now())`);
    await q(`CREATE INDEX IF NOT EXISTS bkk_members_email ON bkk_members (lower(email))`);
    await q(`CREATE TABLE IF NOT EXISTS bkk_orders (
      id SERIAL PRIMARY KEY, refno BIGINT UNIQUE NOT NULL,
      product_id INTEGER REFERENCES bkk_products(id),
      member_id INTEGER REFERENCES bkk_members(id),
      base_thb INTEGER NOT NULL, fee_thb INTEGER NOT NULL DEFAULT 0,
      amount_thb INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      gateway_ref TEXT, gateway_note TEXT,
      verified_at TIMESTAMPTZ, created_at TIMESTAMPTZ DEFAULT now())`);
    await q(`CREATE TABLE IF NOT EXISTS bkk_passes (
      id SERIAL PRIMARY KEY, member_id INTEGER REFERENCES bkk_members(id),
      product_id INTEGER REFERENCES bkk_products(id),
      order_id INTEGER REFERENCES bkk_orders(id),
      kind TEXT NOT NULL, credits_total INTEGER, credits_used INTEGER DEFAULT 0,
      daily_cap INTEGER, valid_days INTEGER NOT NULL,
      valid_from DATE, valid_until DATE,
      status TEXT NOT NULL DEFAULT 'active', created_at TIMESTAMPTZ DEFAULT now())`);
    await q(`CREATE TABLE IF NOT EXISTS bkk_class_slots (
      id SERIAL PRIMARY KEY, code TEXT UNIQUE NOT NULL,
      title TEXT NOT NULL, kind TEXT, teachers TEXT,
      weekday INTEGER NOT NULL, start_time TEXT NOT NULL,
      duration_min INTEGER NOT NULL, capacity INTEGER NOT NULL,
      is_online BOOLEAN DEFAULT false, active BOOLEAN DEFAULT true)`);
    await q(`CREATE TABLE IF NOT EXISTS bkk_class_overrides (
      id SERIAL PRIMARY KEY, slot_id INTEGER REFERENCES bkk_class_slots(id),
      class_date DATE NOT NULL, cancelled BOOLEAN DEFAULT false,
      capacity INTEGER, note TEXT, UNIQUE (slot_id, class_date))`);
    await q(`CREATE TABLE IF NOT EXISTS bkk_bookings (
      id SERIAL PRIMARY KEY, slot_id INTEGER REFERENCES bkk_class_slots(id),
      class_date DATE NOT NULL, start_at TIMESTAMPTZ NOT NULL,
      member_id INTEGER REFERENCES bkk_members(id),
      pass_id INTEGER REFERENCES bkk_passes(id),
      status TEXT NOT NULL DEFAULT 'booked',
      booked_at TIMESTAMPTZ DEFAULT now(), cancelled_at TIMESTAMPTZ,
      checked_in_at TIMESTAMPTZ)`);
    // Single-use sign-in links. The IP is kept only to rate-limit: this endpoint
    // sends mail from the shala's domain, so it must not become a spam cannon.
    await q(`CREATE TABLE IF NOT EXISTS bkk_login_tokens (
      token TEXT PRIMARY KEY,
      member_id INTEGER REFERENCES bkk_members(id),
      email TEXT, ip TEXT,
      expires_at TIMESTAMPTZ NOT NULL, used_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT now())`);
    await q(`CREATE INDEX IF NOT EXISTS bkk_login_tokens_recent
             ON bkk_login_tokens (created_at)`);
    // A staff-made link also has a short code: the 64-character link looked like spam in LINE (14 Nov).
    await q(`ALTER TABLE bkk_login_tokens ADD COLUMN IF NOT EXISTS short_code TEXT`);
    await q(`CREATE UNIQUE INDEX IF NOT EXISTS bkk_login_tokens_short ON bkk_login_tokens (short_code)`);

    // The teaching team. Each teacher has their own passcode, stored hashed —
    // a shared key would make every note say "somebody", and revoking one
    // person would mean changing it for everyone.
    await q(`CREATE TABLE IF NOT EXISTS bkk_teachers (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL, email TEXT,
      key_hash TEXT NOT NULL,
      active BOOLEAN DEFAULT true,
      created_at TIMESTAMPTZ DEFAULT now())`);

    // What a teacher saw, and what the student should work on.
    // share_with_student separates the two audiences deliberately: some notes
    // are for the team ("pushing too hard, watch the shoulder") and some are
    // for the student ("straighten the front leg in Trikonasana").
    await q(`CREATE TABLE IF NOT EXISTS bkk_notes (
      id SERIAL PRIMARY KEY,
      member_id INTEGER REFERENCES bkk_members(id) ON DELETE CASCADE,
      teacher_id INTEGER REFERENCES bkk_teachers(id),
      class_date DATE,
      body TEXT,
      to_work_on TEXT,
      share_with_student BOOLEAN DEFAULT true,
      created_at TIMESTAMPTZ DEFAULT now())`);
    await q(`CREATE INDEX IF NOT EXISTS bkk_notes_member
             ON bkk_notes (member_id, created_at DESC)`);
    // Language the student last chose, so email matches the page they bought on.
    await q(`ALTER TABLE bkk_members ADD COLUMN IF NOT EXISTS lang TEXT`);
    await q(`ALTER TABLE bkk_orders ADD COLUMN IF NOT EXISTS vat_thb INTEGER NOT NULL DEFAULT 0`);
    await q(`ALTER TABLE bkk_orders ADD COLUMN IF NOT EXISTS method TEXT NOT NULL DEFAULT 'online'`);
    await q(`ALTER TABLE bkk_passes ADD COLUMN IF NOT EXISTS reminded_at TIMESTAMPTZ`);

    // Class photos on each student's own profile (Oct 2026). The public feed
    // closed because students didn't want others saving their photos, so a
    // photo is stored private and only shown to the students tagged in it.
    await q(`CREATE TABLE IF NOT EXISTS bkk_photos (
      id SERIAL PRIMARY KEY,
      public_id TEXT UNIQUE NOT NULL,
      class_date DATE NOT NULL,
      width INTEGER, height INTEGER,
      uploaded_by INTEGER REFERENCES bkk_teachers(id),
      created_at TIMESTAMPTZ DEFAULT now())`);
    await q(`CREATE TABLE IF NOT EXISTS bkk_photo_members (
      photo_id INTEGER REFERENCES bkk_photos(id) ON DELETE CASCADE,
      member_id INTEGER REFERENCES bkk_members(id) ON DELETE CASCADE,
      PRIMARY KEY (photo_id, member_id))`);
    await q(`CREATE INDEX IF NOT EXISTS bkk_photo_members_member ON bkk_photo_members (member_id)`);
    // 'main': the photo is about this student. 'other': they are in the frame
    // (Boonchu, 14 Nov 2026). Every tag from before that is 'main'.
    await q(`ALTER TABLE bkk_photo_members ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'main'
             CHECK (role IN ('main','other'))`);
    // Photos pulled from the Drive day folder remember their Drive file, so a
    // second pass over the same folder skips what is already in.
    await q(`ALTER TABLE bkk_photos ADD COLUMN IF NOT EXISTS drive_id TEXT`);
    await q(`CREATE UNIQUE INDEX IF NOT EXISTS bkk_photos_drive ON bkk_photos (drive_id) WHERE drive_id IS NOT NULL`);
    // Where the photo is kept. 'r2': cls/<class date>/<r2_key>/v.jpg and t.webp in R2, r2_key random hex.
    await q(`ALTER TABLE bkk_photos ADD COLUMN IF NOT EXISTS store TEXT NOT NULL DEFAULT 'cloudinary'`);
    await q(`ALTER TABLE bkk_photos ADD COLUMN IF NOT EXISTS r2_key TEXT`);

    // The 12-week proof check (habit #1, Track): numbers the student already
    // has on their watch or phone, at week 0, 6 and 12. One row per day.
    await q(`CREATE TABLE IF NOT EXISTS bkk_checks (
      id SERIAL PRIMARY KEY,
      member_id INTEGER REFERENCES bkk_members(id) ON DELETE CASCADE,
      taken_on DATE NOT NULL,
      resting_hr INTEGER, sleep_hours NUMERIC(3,1), feel INTEGER, note TEXT,
      created_at TIMESTAMPTZ DEFAULT now(),
      UNIQUE (member_id, taken_on))`);

    // A member's id in the workshop journal (Neo4j Student.id). Not the member
    // code: that is their login, and the journal lists student ids publicly.
    await q(`ALTER TABLE bkk_members ADD COLUMN IF NOT EXISTS journal_id TEXT UNIQUE`);

    // Tees sold on aybkk.net in baht. Payment is a PaySolutions link Boonchu
    // makes per tee, so there is no cart here, only a button to that link.
    await q(`CREATE TABLE IF NOT EXISTS bkk_tees (
      id SERIAL PRIMARY KEY, name TEXT NOT NULL, price_thb INTEGER NOT NULL,
      pay_link TEXT NOT NULL, photo TEXT, sizes TEXT,
      active BOOLEAN DEFAULT true, sort INTEGER DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT now())`);

    // /start counts: which Reel (?src=) brings people, and how many tap the button.
    // No IP, no name: only source, language, channel.
    await q(`CREATE TABLE IF NOT EXISTS bkk_start_events (
      id SERIAL PRIMARY KEY, kind TEXT NOT NULL, src TEXT, lang TEXT, ch TEXT,
      created_at TIMESTAMPTZ DEFAULT now())`);
    // The In-Depth pages count here too (18 Nov 2026): page names the landing page, tag the
    // headline it was opened with (?for=). Still no IP, name, email or member id. Every
    // /start and letter count reads page 'start' only, so In-Depth rows never move them.
    await q(`ALTER TABLE bkk_start_events ADD COLUMN IF NOT EXISTS page TEXT NOT NULL DEFAULT 'start'`);
    await q(`ALTER TABLE bkk_start_events ADD COLUMN IF NOT EXISTS tag TEXT`);
    await q(`CREATE INDEX IF NOT EXISTS bkk_start_events_page_at ON bkk_start_events (page, created_at)`);

    // The Monday letter, email door. LINE, WeChat and Telegram readers join in
    // those apps, so only email lives here. An address counts once it is
    // confirmed from its own inbox. asks = confirm mails sent since asked_at's day.
    await q(`CREATE TABLE IF NOT EXISTS bkk_newsletter (
      id SERIAL PRIMARY KEY, email TEXT NOT NULL UNIQUE, lang TEXT, src TEXT,
      status TEXT NOT NULL DEFAULT 'pending', token TEXT NOT NULL UNIQUE,
      created_at TIMESTAMPTZ DEFAULT now(), asked_at TIMESTAMPTZ DEFAULT now(),
      confirmed_at TIMESTAMPTZ, unsubscribed_at TIMESTAMPTZ)`);
    await q(`ALTER TABLE bkk_newsletter ADD COLUMN IF NOT EXISTS asks INTEGER NOT NULL DEFAULT 1`);
    await q(`ALTER TABLE bkk_newsletter DROP COLUMN IF EXISTS ip`);
    // One row per confirm mail sent, kept a day: the caps count mails, not
    // addresses, because one address can be asked again and again.
    await q(`CREATE TABLE IF NOT EXISTS bkk_letter_asks (
      id SERIAL PRIMARY KEY, ip TEXT, at TIMESTAMPTZ DEFAULT now())`);

    // The things a shala actually does to a pass, which Rezerv has and this did
    // not: pause it for an injury, write off a mistake, note why.
    await q(`ALTER TABLE bkk_passes ADD COLUMN IF NOT EXISTS frozen_from DATE`);
    await q(`ALTER TABLE bkk_passes ADD COLUMN IF NOT EXISTS frozen_until DATE`);
    await q(`ALTER TABLE bkk_passes ADD COLUMN IF NOT EXISTS note TEXT`);
    await q(`ALTER TABLE bkk_passes ADD COLUMN IF NOT EXISTS source TEXT`);
    await q(`ALTER TABLE bkk_bookings ADD COLUMN IF NOT EXISTS cancel_reason TEXT`);
    // Every way into a class puts a name on its list (28 Oct 2026). cover is what
    // pays for the seat: 'pass' (an aybkk.net pass) or 'rezerv' (a Rezerv package
    // not moved over yet, so no pass here). source is how the name got there:
    // student, staff, door, order. Older rows stay NULL.
    await q(`ALTER TABLE bkk_bookings ADD COLUMN IF NOT EXISTS cover TEXT`);
    await q(`ALTER TABLE bkk_bookings ADD COLUMN IF NOT EXISTS source TEXT`);
    // A drop-in is bought for one class, and paying for it books that class.
    await q(`ALTER TABLE bkk_orders ADD COLUMN IF NOT EXISTS slot_id INTEGER REFERENCES bkk_class_slots(id)`);
    await q(`ALTER TABLE bkk_orders ADD COLUMN IF NOT EXISTS class_date DATE`);
    // The door's add sheet sends one id per person added, so a second tap after
    // a lost reply finds the first one's seat instead of adding them again.
    await q(`ALTER TABLE bkk_bookings ADD COLUMN IF NOT EXISTS request_id TEXT`);
    // Staff moved this Rezerv-covered class onto an aybkk.net pass (16 Nov 2026):
    // when, so the move, and only the move, can be undone.
    await q(`ALTER TABLE bkk_bookings ADD COLUMN IF NOT EXISTS moved_at TIMESTAMPTZ`);

    // findOrCreateMember and login/request both take the first row for an email
    // with no ORDER BY. Two rows for one address means one of them — and any
    // pass on it — becomes permanently unreachable. A bulk import is exactly
    // how that happens, so make it impossible before importing anyone.
    await q(`CREATE UNIQUE INDEX IF NOT EXISTS bkk_members_email_unique
             ON bkk_members (lower(email)) WHERE email IS NOT NULL`);
    await q(`CREATE INDEX IF NOT EXISTS bkk_bookings_slot_date
             ON bkk_bookings (slot_id, class_date) WHERE status = 'booked'`);
    // One seat per student per class — but only among LIVE bookings. A plain
    // UNIQUE constraint counted cancelled rows too, so a student who cancelled
    // and changed their mind was told "you already booked this class".
    await q(`CREATE UNIQUE INDEX IF NOT EXISTS bkk_bookings_one_live
             ON bkk_bookings (slot_id, class_date, member_id) WHERE status = 'booked'`);
    // Existing databases still carry the old table-level constraint.
    await q(`ALTER TABLE bkk_bookings
             DROP CONSTRAINT IF EXISTS bkk_bookings_slot_id_class_date_member_id_key`);
    await q(`CREATE UNIQUE INDEX IF NOT EXISTS bkk_bookings_request_id
             ON bkk_bookings (request_id) WHERE request_id IS NOT NULL`);

    // Keep all history (28 Oct 2026): everything Rezerv holds moves over, and
    // nothing is deleted to tidy up. source_ref is Rezerv's own id for the row
    // (or a hash of it), so importing the same file twice adds nothing twice.
    await q(`ALTER TABLE bkk_members ADD COLUMN IF NOT EXISTS rezerv_id TEXT`);
    await q(`ALTER TABLE bkk_members ADD COLUMN IF NOT EXISTS joined_on DATE`);
    await q(`ALTER TABLE bkk_members ADD COLUMN IF NOT EXISTS source TEXT`);
    await q(`CREATE UNIQUE INDEX IF NOT EXISTS bkk_members_rezerv ON bkk_members (rezerv_id) WHERE rezerv_id IS NOT NULL`);
    // A past Rezerv class that matches no slot keeps its own title, slot_id NULL.
    // status 'noshow' = booked, never came. Attended = 'booked' and checked in.
    await q(`ALTER TABLE bkk_bookings ADD COLUMN IF NOT EXISTS class_title TEXT`);
    await q(`ALTER TABLE bkk_bookings ADD COLUMN IF NOT EXISTS source_ref TEXT`);
    await q(`CREATE UNIQUE INDEX IF NOT EXISTS bkk_bookings_source_ref
             ON bkk_bookings (source, source_ref) WHERE source_ref IS NOT NULL`);
    await q(`CREATE INDEX IF NOT EXISTS bkk_bookings_member ON bkk_bookings (member_id, class_date)`);
    await q(`CREATE INDEX IF NOT EXISTS bkk_bookings_date ON bkk_bookings (class_date)`);
    await q(`ALTER TABLE bkk_orders ADD COLUMN IF NOT EXISTS item_name TEXT`);
    await q(`ALTER TABLE bkk_orders ADD COLUMN IF NOT EXISTS source TEXT`);
    await q(`ALTER TABLE bkk_orders ADD COLUMN IF NOT EXISTS source_ref TEXT`);
    await q(`CREATE UNIQUE INDEX IF NOT EXISTS bkk_orders_source_ref
             ON bkk_orders (source, source_ref) WHERE source_ref IS NOT NULL`);
    // A pass's end date moves here (pause, extra days), so Rezerv's own pass id
    // finds it again: "Membership Number" or the package's "Transaction Id".
    await q(`ALTER TABLE bkk_passes ADD COLUMN IF NOT EXISTS source_ref TEXT`);
    await q(`CREATE UNIQUE INDEX IF NOT EXISTS bkk_passes_source_ref
             ON bkk_passes (source, source_ref) WHERE source_ref IS NOT NULL`);
    await q(`CREATE INDEX IF NOT EXISTS bkk_orders_member ON bkk_orders (member_id)`);
    // "I need a mat", ticked when booking: a flat ฿200, VAT included, paid at the
    // shala (7 Nov 2026). The morning team brief and the staff lists show it;
    // nothing is charged online, so no order amount ever changes for it.
    // A drop-in bought for a class carries the tick on its order to the seat.
    await q(`ALTER TABLE bkk_bookings ADD COLUMN IF NOT EXISTS need_mat BOOLEAN NOT NULL DEFAULT false`);
    await q(`ALTER TABLE bkk_orders ADD COLUMN IF NOT EXISTS need_mat BOOLEAN NOT NULL DEFAULT false`);
    // One sale, one row (15 Nov 2026). request_id: the desk's id for one sale, so
    // a second tap after a lost reply finds the first sale. twin_of: a Rezerv line
    // that is a copy of an aybkk.net sale (status 'twin') or of its pass (a void
    // pass), one to one. Neither is ever money or a sale.
    await q(`ALTER TABLE bkk_orders ADD COLUMN IF NOT EXISTS request_id TEXT`);
    await q(`CREATE UNIQUE INDEX IF NOT EXISTS bkk_orders_request_id ON bkk_orders (request_id) WHERE request_id IS NOT NULL`);
    await q(`ALTER TABLE bkk_orders ADD COLUMN IF NOT EXISTS twin_of INTEGER REFERENCES bkk_orders(id)`);
    await q(`CREATE UNIQUE INDEX IF NOT EXISTS bkk_orders_twin_of ON bkk_orders (twin_of) WHERE twin_of IS NOT NULL`);
    await q(`ALTER TABLE bkk_passes ADD COLUMN IF NOT EXISTS twin_of INTEGER REFERENCES bkk_passes(id)`);
    await q(`CREATE UNIQUE INDEX IF NOT EXISTS bkk_passes_twin_of ON bkk_passes (twin_of) WHERE twin_of IS NOT NULL`);
    // On a void Rezerv twin pass, what taking the pair apart puts back: used (the
    // classes the import added to the pass kept), from and until (the dates it
    // gave that pass, and untilWas before them), and status (what Rezerv says of
    // this one now, so it comes back paused, or stays void if Rezerv stopped it).
    await q(`ALTER TABLE bkk_passes ADD COLUMN IF NOT EXISTS twin_undo JSONB`);
    // The student's own face (9 Nov 2026), so teachers can greet them by name.
    // photo_id is a private Cloudinary asset. photo_tries counts uploads on
    // photo_tries_on (a Bangkok day), to cap them.
    await q(`ALTER TABLE bkk_members ADD COLUMN IF NOT EXISTS photo_id TEXT`);
    await q(`ALTER TABLE bkk_members ADD COLUMN IF NOT EXISTS photo_at TIMESTAMPTZ`);
    await q(`ALTER TABLE bkk_members ADD COLUMN IF NOT EXISTS photo_tries INTEGER NOT NULL DEFAULT 0`);
    await q(`ALTER TABLE bkk_members ADD COLUMN IF NOT EXISTS photo_tries_on DATE`);
    await q(`CREATE TABLE IF NOT EXISTS bkk_face_orphans (
      photo_id TEXT PRIMARY KEY,
      since TIMESTAMPTZ NOT NULL DEFAULT now(),
      tries INTEGER NOT NULL DEFAULT 1)`);
    // Two profiles for one student (left by the 13 Nov Rezerv import). The
    // folded one stays, empty, pointing at the one it was merged into: its code,
    // email and Rezerv id lead there, and merge_log is what undo puts back.
    await q(`ALTER TABLE bkk_members ADD COLUMN IF NOT EXISTS merged_into INTEGER REFERENCES bkk_members(id)`);
    await q(`ALTER TABLE bkk_members ADD COLUMN IF NOT EXISTS merged_at TIMESTAMPTZ`);
    await q(`ALTER TABLE bkk_members ADD COLUMN IF NOT EXISTS merge_log JSONB`);
    // Names a profile had before staff changed it (Change name), still found by search and the import.
    await q(`ALTER TABLE bkk_members ADD COLUMN IF NOT EXISTS former_names TEXT[]`);
    // The desk's own note on a student (24 Nov 2026): staff only, never on /me, the door or /teach.
    await q(`ALTER TABLE bkk_members ADD COLUMN IF NOT EXISTS desk_note TEXT`);
    await q(`ALTER TABLE bkk_members ADD COLUMN IF NOT EXISTS desk_note_at TIMESTAMPTZ`);
    // Checkout with a folded profile's email: the pass lands on the kept profile,
    // the receipt and its sign-in link go to the address that was typed.
    await q(`ALTER TABLE bkk_orders ADD COLUMN IF NOT EXISTS mail_to TEXT`);
    // A Rezerv row imported while a merge stood remembers the profile its
    // Rezerv details found, so an undo takes it back there.
    for (const t of ['bkk_orders', 'bkk_passes', 'bkk_bookings']) {
      await q(`ALTER TABLE ${t} ADD COLUMN IF NOT EXISTS via_member INTEGER`);
    }
    await q(`CREATE INDEX IF NOT EXISTS bkk_members_merged ON bkk_members (merged_into) WHERE merged_into IS NOT NULL`);
    // The payment watch (15 Nov 2026): when PaySolutions was last asked about an
    // order, and which problem pings an order already sent, so a restart never
    // sends one twice.
    await q(`ALTER TABLE bkk_orders ADD COLUMN IF NOT EXISTS checked_at TIMESTAMPTZ`);
    await q(`CREATE INDEX IF NOT EXISTS bkk_orders_waiting ON bkk_orders (checked_at NULLS FIRST, created_at)
             WHERE status = 'pending' AND source IS NULL`);
    await q(`CREATE TABLE IF NOT EXISTS bkk_pay_alerts (
      order_id INTEGER NOT NULL REFERENCES bkk_orders(id) ON DELETE CASCADE,
      kind TEXT NOT NULL, sent_at TIMESTAMPTZ DEFAULT now(),
      PRIMARY KEY (order_id, kind))`);
    // A ping Telegram refused keeps its text here until a retry gets it through.
    await q(`ALTER TABLE bkk_pay_alerts ADD COLUMN IF NOT EXISTS retry_text TEXT`);
    await q(`ALTER TABLE bkk_pay_alerts ADD COLUMN IF NOT EXISTS tries INTEGER NOT NULL DEFAULT 1`);
    // Who last checked a seat in or out (17 Nov 2026): 'tablet' (the door tablet),
    // 'teacher' (/teach), 'door' (/door on the staff key) or 'admin' (the class
    // view). checkin_by is the tablet's or the teacher's name. Read it with
    // checked_in_at: an undo on /teach leaves 'teacher' here and no time.
    await q(`ALTER TABLE bkk_bookings ADD COLUMN IF NOT EXISTS checkin_via TEXT`);
    await q(`ALTER TABLE bkk_bookings ADD COLUMN IF NOT EXISTS checkin_by TEXT`);
    // The door tablet (17 Nov 2026). One device key at a time, stored only as a
    // hash; the plain key goes to the tablet once. other_ip_at: when it was last
    // used from an address other than the one it was paired from.
    await q(`CREATE TABLE IF NOT EXISTS bkk_door_devices (
      id SERIAL PRIMARY KEY, name TEXT NOT NULL, key_hash TEXT NOT NULL UNIQUE,
      paired_at TIMESTAMPTZ NOT NULL DEFAULT now(), paired_ip TEXT,
      last_seen_at TIMESTAMPTZ, last_ip TEXT, other_ip_at TIMESTAMPTZ, revoked_at TIMESTAMPTZ)`);
    // A pairing the tablet asked for: the short code staff type in Admin and the
    // long secret only that tablet holds, both hashed. Lives 10 minutes.
    await q(`CREATE TABLE IF NOT EXISTS bkk_door_pairings (
      id SERIAL PRIMARY KEY, code_hash TEXT NOT NULL, secret_hash TEXT NOT NULL UNIQUE, ip TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(), expires_at TIMESTAMPTZ NOT NULL,
      approved_at TIMESTAMPTZ, name TEXT, used_at TIMESTAMPTZ,
      device_id INTEGER REFERENCES bkk_door_devices(id))`);
    await q(`CREATE INDEX IF NOT EXISTS bkk_door_pairings_code ON bkk_door_pairings (code_hash)`);
    await q(`CREATE UNIQUE INDEX IF NOT EXISTS bkk_door_devices_one_live ON bkk_door_devices ((true)) WHERE revoked_at IS NULL`);
    // The student agreement (Nov 2026). Append-only: a row is an event, never edited. kind
    // 'agreement' or 'guardian' (more optional ticks can come later; given false withdraws one).
    // via: 'checkout' (the buyer holds the profile), 'checkout-email' (an existing profile's email
    // typed at checkout, written only once paid), 'self' (the student's own phone) or 'desk' (staff
    // recording a guardian's paper; signed_on is the day on that paper). email_at: the email then.
    // No UNIQUE: a merge moves rows, and both profiles may have signed. No IP, browser or health field.
    await q(`CREATE TABLE IF NOT EXISTS bkk_consents (
      id SERIAL PRIMARY KEY, member_id INTEGER NOT NULL REFERENCES bkk_members(id),
      kind TEXT NOT NULL, version TEXT NOT NULL, given BOOLEAN NOT NULL DEFAULT true,
      signed_name TEXT, under20 BOOLEAN NOT NULL DEFAULT false, guardian_name TEXT, signed_on DATE,
      lang TEXT, via TEXT NOT NULL, order_id INTEGER, email_at TEXT, text_sha TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
    await q(`CREATE INDEX IF NOT EXISTS bkk_consents_member ON bkk_consents (member_id, kind, version)`);
    await q(`CREATE INDEX IF NOT EXISTS bkk_consents_order ON bkk_consents (order_id) WHERE order_id IS NOT NULL`);
    // What the checkout's tick said, {agree, version, lang, name, under20}: activateOrder writes
    // the row from it when the buyer did not hold the profile.
    await q(`ALTER TABLE bkk_orders ADD COLUMN IF NOT EXISTS consent JSONB`);

    // The tee pre-order (24 Nov 2026). Its money row is a bkk_orders row of kind 'tee' (no package,
    // no member), so the postback, pay/check, the payment watch, Payments, VAT and the books keep
    // working; it never makes a pass, a booking, a consent row, a login token or a member.
    await q(`ALTER TABLE bkk_orders ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'pass'`);
    await q(`DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bkk_orders_kind_check') THEN
        ALTER TABLE bkk_orders ADD CONSTRAINT bkk_orders_kind_check CHECK (kind IN ('pass','tee'));
      END IF;
    EXCEPTION WHEN duplicate_object THEN NULL; END $$`);
    // A drop: one 7-day pre-order. cap is all its tees together. Pickup points [{key, label}] are
    // typed in Admin and live only here (a label names a city and a team member).
    await q(`CREATE TABLE IF NOT EXISTS bkk_tee_drops (
      id SERIAL PRIMARY KEY, code TEXT UNIQUE NOT NULL CHECK (code ~ '^[a-z0-9-]{3,24}$'),
      title JSONB NOT NULL DEFAULT '{}', opens_at TIMESTAMPTZ NOT NULL, closes_at TIMESTAMPTZ NOT NULL,
      published BOOLEAN NOT NULL DEFAULT false, cap INTEGER NOT NULL CHECK (cap BETWEEN 1 AND 500),
      max_per_order INTEGER NOT NULL DEFAULT 5 CHECK (max_per_order BETWEEN 1 AND 10),
      hold_min INTEGER NOT NULL DEFAULT 30 CHECK (hold_min BETWEEN 5 AND 1440),
      purge_days INTEGER NOT NULL DEFAULT 30 CHECK (purge_days BETWEEN 1 AND 365),
      rmb_rate NUMERIC CHECK (rmb_rate IS NULL OR (rmb_rate > 0 AND rmb_rate < 10)),
      pickups JSONB NOT NULL DEFAULT '[]', costs JSONB, report JSONB, done_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(), CHECK (closes_at > opens_at))`);
    await q(`CREATE TABLE IF NOT EXISTS bkk_tee_stock (
      id SERIAL PRIMARY KEY, drop_id INTEGER NOT NULL REFERENCES bkk_tee_drops(id),
      design TEXT NOT NULL, design_name JSONB NOT NULL DEFAULT '{}', colour TEXT NOT NULL, colour_name JSONB NOT NULL DEFAULT '{}',
      size TEXT NOT NULL CHECK (size IN (${TEE_SIZES.map(s => `'${s}'`).join(',')})),
      price_thb INTEGER NOT NULL CHECK (price_thb > 0),
      photo TEXT CHECK (photo IS NULL OR photo ~ '^/img/[\\w./-]+$'),
      cap INTEGER NOT NULL DEFAULT 0 CHECK (cap >= 0), sort INTEGER NOT NULL DEFAULT 0,
      UNIQUE (drop_id, design, colour, size))`);
    // Stock is never counted down: what is taken is read from the lines (teeTaken).
    await q(`CREATE TABLE IF NOT EXISTS bkk_tee_orders (
      order_id INTEGER PRIMARY KEY REFERENCES bkk_orders(id), drop_id INTEGER NOT NULL REFERENCES bkk_tee_drops(id),
      token TEXT UNIQUE NOT NULL, hold_until TIMESTAMPTZ NOT NULL,
      status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','paid','oversold','handed','cancelled')),
      problem TEXT, lang TEXT, pickup TEXT,
      name TEXT CHECK (name IS NULL OR char_length(name) BETWEEN 2 AND 30),
      wechat TEXT CHECK (wechat IS NULL OR char_length(wechat) BETWEEN 1 AND 40),
      mobile TEXT CHECK (mobile IS NULL OR mobile ~ '^1[3-9][0-9]{9}$'), email TEXT,
      notice_version TEXT, notice_sha TEXT, notice_lang TEXT,
      paid_at TIMESTAMPTZ, handed_at TIMESTAMPTZ, cancelled_at TIMESTAMPTZ, purged_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
    await q(`CREATE INDEX IF NOT EXISTS bkk_tee_orders_drop ON bkk_tee_orders (drop_id, status)`);
    await q(`CREATE INDEX IF NOT EXISTS bkk_tee_orders_email ON bkk_tee_orders (drop_id, lower(email))`);
    await q(`CREATE TABLE IF NOT EXISTS bkk_tee_lines (
      order_id INTEGER NOT NULL REFERENCES bkk_tee_orders(order_id), stock_id INTEGER NOT NULL REFERENCES bkk_tee_stock(id),
      qty INTEGER NOT NULL CHECK (qty BETWEEN 1 AND 10), unit_thb INTEGER NOT NULL,
      PRIMARY KEY (order_id, stock_id))`);
    await q(`CREATE INDEX IF NOT EXISTS bkk_tee_lines_stock ON bkk_tee_lines (stock_id)`);

    // Catalogue: a package added to SEED_PRODUCTS reaches a running shala on the
    // next boot. ON CONFLICT leaves existing rows alone, so a price changed or a
    // package retired in the admin page stays as staff set it.
    const added = await q(`SELECT count(*)::int AS n FROM bkk_products`);
    for (const s of SEED_PRODUCTS) await seedProduct(pool, s);
    // From 21 Oct 2026 a year is 12 months, no free 13th (Boonchu). valid_days
    // never changes under passes already sold, so the 13-month package is
    // retired once and kept for the passes and Rezerv imports that point at it.
    // The marker is written after the UPDATE, so a failed boot tries again.
    const year12 = await q(`SELECT 1 FROM bkk_settings WHERE key = 'year_is_12_months'`);
    if (!year12.rows.length) {
      await q(`UPDATE bkk_products SET active=false WHERE code='unlim12'`);
      await q(`INSERT INTO bkk_settings (key,value) VALUES ('year_is_12_months','true') ON CONFLICT (key) DO NOTHING`);
    }
    // 8 classes / 1 month replaced the 10-class pack on 6 Nov 2026 (Boonchu).
    // Same once-only retire: a 10-pack already sold keeps its 10 classes and 90 days.
    const pack8 = await q(`SELECT 1 FROM bkk_settings WHERE key = 'pack8_replaces_pack10'`);
    if (!pack8.rows.length) {
      await q(`UPDATE bkk_products SET active=false WHERE code='pack10'`);
      await q(`INSERT INTO bkk_settings (key,value) VALUES ('pack8_replaces_pack10','true') ON CONFLICT (key) DO NOTHING`);
    }
    // From 9 Nov 2026 the 8 classes last 2 months, not 1 (Boonchu). The packs
    // already sold here (an order) were sold 3 days earlier as 1 month: they get
    // the 2 months too (a started one ends 30 days later; one not started gets 60
    // days from its first class). Dates from Rezerv, or typed in by staff, stay as
    // they are, and those passes move to the 1-month record so their name is true
    // (and a Rezerv re-import still finds them). Each UPDATE only touches 30-day
    // pack8 rows, so a boot that fails before the marker can run it again safely.
    const pack8two = await q(`SELECT 1 FROM bkk_settings WHERE key = 'pack8_two_months'`);
    if (!pack8two.rows.length) {
      await q(`UPDATE bkk_products SET valid_days=60, name_en='8 classes / 2 months', name_th='8 ครั้ง / 2 เดือน'
               WHERE code='pack8' AND valid_days=30`);
      await q(`UPDATE bkk_passes p SET valid_days=60, valid_until = p.valid_until + 30
               FROM bkk_products pr
               WHERE pr.id = p.product_id AND pr.code='pack8' AND p.valid_days=30
                 AND p.source IS DISTINCT FROM 'rezerv' AND (p.order_id IS NOT NULL OR p.valid_until IS NULL)`);
      await q(`UPDATE bkk_passes p SET product_id = m1.id
               FROM bkk_products pr, bkk_products m1
               WHERE pr.id = p.product_id AND pr.code='pack8' AND m1.code='pack8m1' AND p.valid_days=30`);
      await q(`INSERT INTO bkk_settings (key,value) VALUES ('pack8_two_months','true') ON CONFLICT (key) DO NOTHING`);
    }
    if (added.rows[0].n === 0) console.log(`✓ bkk: seeded ${SEED_PRODUCTS.length} products`);
    const c = await q('SELECT count(*)::int AS n FROM bkk_class_slots');
    if (c.rows[0].n === 0) {
      for (const s of SEED_SLOTS) {
        for (const wd of s.weekdays) {
          await q(`INSERT INTO bkk_class_slots (code,title,kind,weekday,start_time,duration_min,capacity,is_online)
                   VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (code) DO NOTHING`,
            [`${s.code}_${wd}`, s.title, s.kind, wd, s.start_time, s.duration_min, s.capacity, s.is_online]);
        }
      }
      console.log('✓ bkk: seeded weekly timetable');
    }
    // The seed above only fires on an empty table, so renaming a class in
    // SEED_SLOTS would never reach a running shala. Titles are synced on every
    // boot instead. Safe while there is no admin UI for renaming slots — add
    // one, and this has to go.
    for (const s of SEED_SLOTS) {
      for (const wd of s.weekdays) {
        await q('UPDATE bkk_class_slots SET title=$2 WHERE code=$1 AND title <> $2',
          [`${s.code}_${wd}`, s.title]);
        const who = s.teachers && typeof s.teachers === 'object' ? s.teachers[wd] : s.teachers;
        if (who) await q('UPDATE bkk_class_slots SET teachers=$2 WHERE code=$1 AND teachers IS DISTINCT FROM $2',
          [`${s.code}_${wd}`, who]);
      }
    }
    // Monday is Led Primary only (Oct 2026). Earlier databases were seeded with
    // Monday Mysore batches; switch those off once.
    const monFix = await q(`INSERT INTO bkk_settings (key,value) VALUES ('no_monday_mysore','true')
                            ON CONFLICT (key) DO NOTHING RETURNING key`);
    if (monFix.rows.length) {
      await q(`UPDATE bkk_class_slots SET active=false WHERE code IN ('my530_1','my730_1')`);
    }
    // No 2- or 6-month package any more (Oct 2026). Switch off the ones earlier
    // databases were seeded with, once; a pass already sold keeps working.
    const no26 = await q(`INSERT INTO bkk_settings (key,value) VALUES ('retired_unlim2_6','true')
                          ON CONFLICT (key) DO NOTHING RETURNING key`);
    if (no26.rows.length) await q(`UPDATE bkk_products SET active=false WHERE code IN ('unlim2','unlim6')`);
    const st = await q(`SELECT value FROM bkk_settings WHERE key = 'surcharge_pct'`);
    if (!st.rows.length) {
      await q(`INSERT INTO bkk_settings (key,value) VALUES ('surcharge_pct','3')`);
    }
    // One-time move from the old 5% to PaySolutions' real 3% (Oct 2026). The
    // marker keeps a later change in the admin page from being overwritten.
    const moved = await q(`INSERT INTO bkk_settings (key,value) VALUES ('surcharge_set_3pct','true')
                           ON CONFLICT (key) DO NOTHING RETURNING key`);
    if (moved.rows.length) {
      await q(`UPDATE bkk_settings SET value='3', updated_at=now() WHERE key='surcharge_pct' AND value='5'`);
    }
  }

  async function getSetting(key, fallback) {
    try {
      const r = await q('SELECT value FROM bkk_settings WHERE key = $1', [key]);
      return r.rows.length ? r.rows[0].value : fallback;
    } catch (e) { return fallback; }
  }

  const surcharge = async () => Number(await getSetting('surcharge_pct', 3)) || 0;

  const seedProduct = (db, s) => db.query(
    `INSERT INTO bkk_products (code,name_en,name_th,price_thb,kind,credits,valid_days,daily_cap,sort,active)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT (code) DO NOTHING`,
    [s.code, s.name_en, s.name_th, s.price_thb, s.kind, s.credits, s.valid_days, s.daily_cap, s.sort, s.active !== false]);

  // Called before anything reads a price. The marker goes in with the prices in
  // one transaction: two servers racing apply it once (the loser waits on the
  // key, then finds it taken), a failure leaves no marker, so the next request
  // tries again, and a price staff change afterwards is never put back.
  let pricesSwitched = false, switching = null;
  function switchPrices() {
    if (pricesSwitched || nowMs() < PRICE_SWITCH.at) return Promise.resolve();
    switching = switching || applyPriceSwitch().finally(() => { switching = null; });
    return switching;
  }
  async function applyPriceSwitch() {
    // A fresh database is seeded first. If that boot step failed, the rows are
    // added here, or the marker would shut out a package that came later.
    await booted.catch(() => {});
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const mark = await client.query(`INSERT INTO bkk_settings (key,value) VALUES ($1,'true')
                                       ON CONFLICT (key) DO NOTHING RETURNING key`, [PRICE_SWITCH.key]);
      if (mark.rows.length) {
        for (const [code, price] of Object.entries(PRICE_SWITCH.prices)) {
          await seedProduct(client, SEED_PRODUCTS.find(s => s.code === code));
          await client.query(`UPDATE bkk_products SET price_thb=$2, active = active OR $3 WHERE code=$1`,
            [code, price, PRICE_SWITCH.opens.includes(code)]);
        }
      }
      const raise = await client.query(`INSERT INTO bkk_settings (key,value) VALUES ($1,'true')
                                        ON CONFLICT (key) DO NOTHING RETURNING key`, [PRICE_SWITCH.raise.key]);
      let moved = 0;
      if (raise.rows.length) {
        for (const [code, old] of Object.entries(PRICE_SWITCH.raise.from)) {
          moved += (await client.query(`UPDATE bkk_products SET price_thb=$2 WHERE code=$1 AND price_thb=$3`,
            [code, PRICE_SWITCH.prices[code], old])).rowCount;
        }
      }
      await client.query('COMMIT');
      if (moved) console.log(`✓ bkk: 6 months 34,200 / 12 months 63,600 (moved ${moved} of 2 from 32,000 / 59,900)`);
      if (mark.rows.length) console.log('✓ bkk: prices from 12 Nov 2026 are live');
      pricesSwitched = true;
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      throw e;
    } finally { client.release(); }
  }

  // VAT is due on everything the student pays, the online fee included.
  function breakdown(base, pct) {
    const fee = Math.round(base * pct / 100);
    const vat = Math.round((base + fee) * VAT_PCT / 100);
    return { fee, vat, total: base + fee + vat };
  }

  // ── helpers ───────────────────────────────────────────────────────────────
  // The code in a browser is the sign-in, so it must not be guessable: 64 random
  // bits (the old clock-plus-3-characters codes stay valid, but new ones are not).
  const memberCode = () => 'B' + BigInt('0x' + crypto.randomBytes(8).toString('hex')).toString(36).toUpperCase().padStart(13, '0');
  // PaySolutions requires a numeric refno; 10 digits, unique.
  // PaySolutions wants a unique 12-digit numeric reference. 8 digits of clock
  // (unique for ~28h) + 4 random; the UNIQUE index on refno is the backstop.
  const newRefno = () => Number(String(Date.now()).slice(-8) +
    String(Math.floor(Math.random() * 10000)).padStart(4, '0'));
  const refno12 = n => String(n).padStart(12, '0');
  // The class clock: the booking window, the timetable and the door read it. Tests set
  // opts.clock to hit a window's edge to the millisecond (opts.now is the money clock).
  const classClock = typeof opts.clock === 'function' ? opts.clock : Date.now;
  const bkkNow = () => new Date(classClock());
  const startAtISO = (dateStr, hhmm) => `${dateStr}T${hhmm}:00${TZ_OFFSET}`;
  const bkkISO = ms => new Date(ms + 7 * 3600000).toISOString().slice(0, 16) + ':00' + TZ_OFFSET;
  // When a student's booking for this slot on this day closes, in ms: BOOK_LATE_MIN after the
  // start, and never past the end of its Bangkok day, when the timetable stops listing it.
  const bookCloseAt = (slot, dateStr) => Math.min(
    Date.parse(startAtISO(dateStr, slot.start_time))
      + (Object.hasOwn(BOOK_LATE_MIN, slot.kind) ? BOOK_LATE_MIN[slot.kind] : BOOK_LATE_MIN.default) * 60000,
    Date.parse(startAtISO(dateStr, '00:00')) + 86400000);
  const BOOK_CLOSED = 'booking for this class has closed';
  // Calendar date in Bangkok, NOT UTC. toISOString() would put 01:00 Bangkok on
  // the previous day — and 05:30 Mysore is booked in exactly those hours.
  const ymd = d => new Date(d.getTime() + 7 * 3600000).toISOString().slice(0, 10);
  const bkkToday = () => ymd(bkkNow());
  const bkkDaysAgo = n => ymd(new Date(Date.parse(`${bkkToday()}T12:00:00${TZ_OFFSET}`) - n * 86400000));
  const isYmd = d => /^\d{4}-\d{2}-\d{2}$/.test(String(d || ''));
  // "Wed 28 Oct 2026, 07:30" for receipts and the Telegram ping, from the
  // Bangkok class date itself, so the server's own timezone never shifts it.
  const WD3 = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const MON3 = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const classWhen = (dateStr, hhmm) => {
    const d = new Date(`${dateStr}T12:00:00Z`);
    return `${WD3[d.getUTCDay()]} ${d.getUTCDate()} ${MON3[d.getUTCMonth()]} ${d.getUTCFullYear()}, ${hhmm}`;
  };
  const dayName = dateStr => classWhen(dateStr, '').slice(0, -2);
  // A visit they came to: a live seat that was checked in (the door, or the
  // class start for one moved over from Rezerv). Written for bkk_bookings b.
  const ATTENDED = `b.status='booked' AND b.checked_in_at IS NOT NULL`;
  // A no-show: Rezerv said so, or a seat here never checked in by the end of
  // its day (aybkk.net itself never writes 'noshow').
  const NOSHOW = `(b.status='noshow' OR (b.status='booked' AND b.checked_in_at IS NULL
    AND b.class_date < (now() AT TIME ZONE 'Asia/Bangkok')::date))`;
  // A Rezerv class with no time on file is stored at 00:00 with no slot; no
  // class starts at midnight, so that time is shown as unknown.
  const VISIT_TIME = `CASE WHEN b.slot_id IS NULL AND to_char(b.start_at AT TIME ZONE 'Asia/Bangkok','HH24:MI') = '00:00'
    THEN NULL ELSE to_char(b.start_at AT TIME ZONE 'Asia/Bangkok','HH24:MI') END`;
  // A pass that was live on day d, for staff adding someone who came to a
  // class that is over: started by then, not ended, and not paused that day,
  // whatever its state today. A pause is [frozen_from, frozen_until): unfreeze
  // sets frozen_until to the day it ended. Only the latest pause is stored, and
  // a pass paused with no start day on file never counts. For bkk_passes p.
  const PASS_LIVE_ON = d => `(p.status='active' OR (p.status='frozen' AND p.frozen_from IS NOT NULL))
    AND (p.valid_from IS NULL OR p.valid_from <= ${d}) AND (p.valid_until IS NULL OR p.valid_until >= ${d})
    AND NOT (p.frozen_from IS NOT NULL AND p.frozen_from <= ${d} AND (p.frozen_until IS NULL OR ${d} < p.frozen_until))`;
  // The day a Rezerv copy (twin) had its used classes carried onto the pass it
  // copies: twin_undo.on, written by carryOnto, or its first import. For alias a.
  const CARRIED_ON = a => `coalesce((${a}.twin_undo->>'on')::date, (${a}.created_at AT TIME ZONE 'Asia/Bangkok')::date)`;
  // When money came in, as a Bangkok day.
  const PAY_AT = `coalesce(o.verified_at, o.created_at)`;
  const PAY_DAY = `(${PAY_AT} AT TIME ZONE 'Asia/Bangkok')::date`;
  // The same two for another alias, and one package across both systems: Rezerv's
  // old 6 months and the one sold here from 12 Nov 2026 share a name, not an id.
  const payAt = a => `coalesce(${a}.verified_at, ${a}.created_at)`;
  const payDay = a => `(${payAt(a)} AT TIME ZONE 'Asia/Bangkok')::date`;
  const pkgOf = a => `(SELECT lower(name_en) FROM bkk_products WHERE id=${a}.product_id)`;
  // One package under two names: Rezerv's plan text can land on either, and one
  // sale may sit under both (8 classes in 1 month or in 2, a 12- or 13-month
  // year). The import and the doubles list take a family for one package.
  const PKG_FAMILY = { unlim6: ['unlim6', 'unlim6m'], unlim6m: ['unlim6', 'unlim6m'], unlim12: ['unlim12', 'unlim12m'],
    unlim12m: ['unlim12', 'unlim12m'], pack8: ['pack8', 'pack8m1'], pack8m1: ['pack8', 'pack8m1'] };
  const famId = id => `(SELECT CASE code ${Object.keys(PKG_FAMILY).map(c => `WHEN '${c}' THEN '${PKG_FAMILY[c][0]}'`).join(' ')}
    ELSE code END FROM bkk_products WHERE id=${id})`;
  const famOf = a => famId(`${a}.product_id`);
  // A Rezerv copy and the aybkk.net sale it copies sit this many Bangkok days apart at most.
  const COPY_DAYS = 5;
  // Two Rezerv times for one payment: the same minute, or one file that gives no time (00:00).
  const sameTime = (a, b) => `(${a} = ${b} OR ${a} = '00:00' OR ${b} = '00:00')`;
  const hhmm = a => `to_char(${a}.created_at AT TIME ZONE 'Asia/Bangkok','HH24:MI')`;
  const realYmd = d => {
    if (!isYmd(d)) return false;
    const t = Date.parse(`${d}T00:00:00Z`);
    return !isNaN(t) && new Date(t).toISOString().slice(0, 10) === d;
  };

  // A folded profile leads to the one it was merged into, so its code, email or
  // Rezerv id never lands anyone on the empty one.
  async function liveMember(db, m) {
    for (let i = 0; m && m.merged_into && i < 10; i++)
      m = (await db.query('SELECT * FROM bkk_members WHERE id=$1', [m.merged_into])).rows[0];
    return m && !m.merged_into ? m : null;
  }
  // The profile an email belongs to. An email the merge moved onto the kept
  // profile still belongs to the folded one it came from, while the kept profile
  // holds it: a link, a sale or a Rezerv row made with it then follows that
  // profile back on an undo. An address since removed from the kept one is no one's.
  async function rawByEmail(db, email) {
    const e = String(email || '').trim().toLowerCase();
    if (!e) return null;
    const moved = (await db.query(`SELECT x.* FROM bkk_members x
      WHERE x.merged_into IS NOT NULL AND lower(x.merge_log->'fields'->>'email') = $1
        AND EXISTS (SELECT 1 FROM bkk_members l WHERE l.id = x.merged_into AND lower(l.email) = $1)
      ORDER BY x.merged_at LIMIT 1`, [e])).rows[0];
    return moved || (await db.query('SELECT * FROM bkk_members WHERE lower(email)=$1 LIMIT 1', [e])).rows[0] || null;
  }

  // The profile a student's code opens: a folded code opens the kept profile for
  // as long as the merge stands, so an undo needs nothing changed on any phone.
  const memberByCode = async (code, db = pool) =>
    liveMember(db, (await db.query('SELECT * FROM bkk_members WHERE code=$1', [String(code || '')])).rows[0]);

  // The profile checkout would sell to for this email, or null for a new one.
  async function memberByEmail(email, db = pool) {
    const em = (email || '').trim().toLowerCase();
    if (!em) return null;
    return liveMember(db, (await db.query('SELECT * FROM bkk_members WHERE lower(email) = $1 LIMIT 1', [em])).rows[0]);
  }
  async function findOrCreateMember({ name, email, phone }, db = pool) {
    const em = (email || '').trim().toLowerCase();
    const m = await memberByEmail(em, db);
    if (m) return m;
    const r = await db.query(
      `INSERT INTO bkk_members (code,name,email,phone) VALUES ($1,$2,$3,$4) RETURNING *`,
      [memberCode(), (name || '').trim() || 'Student', em || null, (phone || '').trim() || null]);
    return r.rows[0];
  }

  // ── the student agreement (Nov 2026) ──────────────────────────────────────
  // consent_mode: 'off' (nothing anywhere changes), 'ask' (checkout asks; My account and the
  // timetable remind), 'require' (a student's own booking asks too). Staff, the door, /teach,
  // payments and imports are never refused: an unsigned profile is flagged on staff screens.
  const CONSENT_MODES = ['off', 'ask', 'require'];
  const consentMode = async () => { const v = await getSetting('consent_mode', 'off'); return CONSENT_MODES.includes(v) ? v : 'off'; };
  // For pages that only ask "is it on?" (the old /bkk form, /policy, /privacy): a database that
  // accepts and never answers, or a pool with no free connection, reads as off after a moment,
  // so the old form is served as before instead of hanging.
  const CONSENT_MODE_WAIT_MS = 1500;
  const consentModeSoon = () => new Promise(resolve => {
    const t = setTimeout(resolve, CONSENT_MODE_WAIT_MS, 'off');
    consentMode().then(resolve, () => resolve('off')).finally(() => clearTimeout(t));
  });
  // server.js reads it ahead of its static files: the old /bkk orientation form goes to /book while on.
  app.locals.bkkConsentMode = consentModeSoon;
  // The privacy notice names the business: three settings staff fill in, all public text.
  const PRIVACY_KEYS = { name: 'privacy_legal_name', address: 'privacy_address', email: 'privacy_email' };
  async function privacySettings() {
    const r = await q(`SELECT key, value FROM bkk_settings WHERE key = ANY($1::text[])`, [Object.values(PRIVACY_KEYS)]);
    return Object.fromEntries(Object.entries(PRIVACY_KEYS).map(([k, key]) => {
      const v = (r.rows.find(x => x.key === key) || {}).value;
      return [k, typeof v === 'string' ? v : ''];
    }));
  }
  // A member (column or $n) who signed the current agreement, on any route that reads it.
  const SIGNED = a => `EXISTS (SELECT 1 FROM bkk_consents c WHERE c.member_id = ${a} AND c.kind = 'agreement'
    AND c.given AND c.version = '${CONSENT_VERSION}')`;
  // Signed as under 20, and no guardian's paper recorded yet.
  const GUARDIAN_DUE = a => `(EXISTS (SELECT 1 FROM bkk_consents c WHERE c.member_id = ${a} AND c.kind = 'agreement'
    AND c.given AND c.under20 AND c.version = '${CONSENT_VERSION}') AND NOT EXISTS (SELECT 1 FROM bkk_consents g
    WHERE g.member_id = ${a} AND g.kind = 'guardian' AND g.given AND g.version = '${CONSENT_VERSION}'))`;
  const consentOk = async (db, memberId) => (await db.query(`SELECT ${SIGNED('$1::int')} AS ok`, [memberId])).rows[0].ok;
  const sameName = (a, b) => String(a || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
    === String(b || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  // Where a profile stands on the current version. The signature shown is the student's own
  // (their phone or a checkout they held) before one typed by a buyer with their email.
  async function consentOf(db, m) {
    const rows = (await db.query(`SELECT kind, via, signed_name, under20, guardian_name,
        to_char(signed_on,'YYYY-MM-DD') AS signed_on, created_at, lang
      FROM bkk_consents WHERE member_id=$1 AND version=$2 AND given ORDER BY created_at, id`, [m.id, CONSENT_VERSION])).rows;
    const ag = rows.filter(r => r.kind === 'agreement');
    const own = ag.find(r => r.via !== 'checkout-email') || ag[0] || null;
    const g = rows.filter(r => r.kind === 'guardian').pop() || null;
    return { version: CONSENT_VERSION, signed: !!own, signedAt: own ? own.created_at : null, signedName: own ? own.signed_name : null,
      via: own ? own.via : null, nameDiffers: !!own && !sameName(own.signed_name, m.name), under20: !!(own && own.under20),
      guardianSigned: !!g, guardianName: g ? g.guardian_name : null, guardianOn: g ? g.signed_on : null };
  }
  // The tick a page sends: {agree, version, lang, name, under20}. A stale version is a 409 the
  // page answers by loading the new text; no tick is 409 at checkout (show the screen) and 400 elsewhere.
  function readConsent(c, { name, noTick = 409 } = {}) {
    const refuse = (status, extra = {}) => ({ status, body: { error: 'consent', version: CONSENT_VERSION, ...extra } });
    if (!c || typeof c !== 'object') return refuse(noTick);
    if (c.version !== CONSENT_VERSION) return refuse(409, { stale: true });
    if (c.agree !== true) return noTick === 400 ? { status: 400, body: { error: 'Tick the box to agree.' } } : refuse(noTick);
    const n = String(c.name ?? name ?? '').replace(/\s+/g, ' ').trim();
    if (n.length < 2 || n.length > 120) return { status: 400, body: { error: 'Please type your name (2 letters or more).' } };
    if (!consentLangs().includes(c.lang)) return { status: 400, body: { error: `lang must be one of ${consentLangs().join(', ')}` } };
    return { value: { agree: true, version: CONSENT_VERSION, lang: c.lang, name: n, under20: c.under20 === true } };
  }
  const insertConsent = (db, { memberId, kind = 'agreement', name = null, under20 = false, guardianName = null, signedOn = null,
    lang = null, via, orderId = null, email = null, version = CONSENT_VERSION }) => db.query(
    `INSERT INTO bkk_consents (member_id,kind,version,given,signed_name,under20,guardian_name,signed_on,lang,via,order_id,email_at,text_sha)
     VALUES ($1,$2,$3,true,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
    [memberId, kind, version, name, under20 === true, guardianName, signedOn, lang, via, orderId, email,
      lang && CONSENT_TEXT[version] && CONSENT_TEXT[version][lang] ? consentSha(version, lang) : null]).then(r => r.rows[0]);
  // The copy the agreement promises ("We email you a copy"), in the language it was signed in.
  // to: the email at signing. A tick typed at checkout by someone with an existing profile's email
  // ('checkout-email') greets the profile's owner and says someone else may have bought it.
  async function emailAgreement(to, row, owner) {
    if (!to || !CONSENT_TEXT[row.version] || !CONSENT_TEXT[row.version][row.lang || 'en']) return;
    const lang = row.lang || 'en', x = CONSENT_TEXT[row.version][lang].agreement;
    const since = await getSetting('consent_since', null);
    const other = row.via === 'checkout-email';
    const t = render('agreement', lang, { name: other && owner ? owner : row.signed_name, signedName: row.signed_name, other,
      version: row.version, text: x, under20: row.under20,
      date: dayIn(lang, row.created_at), since: typeof since === 'string' ? dayIn(lang, `${since}T12:00:00${TZ_OFFSET}`) : null,
      link: `${baseUrl()}/book?agreement=${row.version}#policy` });
    await sendMail({ to, subject: t.subject, html: t.html, text: t.text, tag: 'agreement' });
  }
  // A checkout's tick is emailed once the order is paid, never before: an unpaid order with a
  // typed email sends nothing to that address, as the receipt.
  async function emailOrderAgreement(order) {
    const row = (await q(`SELECT * FROM bkk_consents WHERE order_id=$1 AND kind='agreement' ORDER BY id LIMIT 1`, [order.id])).rows[0];
    if (!row) return;
    const m = (await q('SELECT name FROM bkk_members WHERE id=$1', [row.member_id])).rows[0];
    await emailAgreement(row.email_at, row, m && m.name);
  }
  const DAY_LOCALE = { en: 'en-GB', th: 'th-TH', zh: 'zh-CN', ru: 'ru-RU' };
  const dayIn = (lang, at) => new Date(at).toLocaleDateString(DAY_LOCALE[lang] || 'en-GB',
    { timeZone: 'Asia/Bangkok', day: 'numeric', month: 'short', year: 'numeric' });

  // Active pass for a member, preferring one that is already started.
  async function activePass(memberId) {
    const r = await q(
      `SELECT p.*, pr.name_en FROM bkk_passes p JOIN bkk_products pr ON pr.id = p.product_id
       WHERE p.member_id = $1 AND p.status = 'active'
         AND (p.valid_until IS NULL OR p.valid_until >= (now() AT TIME ZONE 'Asia/Bangkok')::date)
         AND (p.kind = 'unlimited' OR p.credits_used < p.credits_total)
       ORDER BY p.valid_from NULLS LAST, p.id LIMIT 1`, [memberId]);
    return r.rows[0] || null;
  }

  // Reports how money can be taken, and — when it cannot — which environment
  // variables are missing. Variable NAMES only, which are already public in the
  // repo; no value, no length, no fragment of any key is ever exposed.
  function paymentStatus() {
    const need = ['PAYSO_MERCHANT_ID', 'PAYSO_SECRET_KEY', 'PAYSO_API_KEY'];
    const missing = need.filter(k => !String(process.env[k] || '').trim());
    if (!missing.length) return { mode: 'gateway' };
    if (String(process.env.PAYSO_PAYSN_STORE || '').trim())
      return { mode: 'link', missingForGateway: missing };
    return { mode: 'none', missing };
  }

  // The agreement and the privacy notice, for the page to show: text only, no personal data.
  // ?lang= (English when that version has no such language), ?version= for an older version
  // someone signed. since: the day the agreement first went on (its "a pass bought before"), once it has.
  app.get('/api/bkk/consent', async (req, res) => {
    try {
      const version = Object.hasOwn(CONSENT_TEXT, String(req.query.version || '')) ? String(req.query.version) : CONSENT_VERSION;
      const langs = consentLangs(version);
      const lang = langs.includes(req.query.lang) ? req.query.lang : 'en';
      const [mode, priv, since] = await Promise.all([consentMode(), privacySettings(), getSetting('consent_since', null)]);
      const x = CONSENT_TEXT[version][lang];
      const fill = s => s.replace(/\{(legal_name|address|email)\}/g, (all, k) => priv[k === 'legal_name' ? 'name' : k] || all);
      res.set('Cache-Control', 'no-cache');
      res.json({ mode, version, current: CONSENT_VERSION, lang, langs, since: typeof since === 'string' ? since : null,
        sha: consentSha(version, lang),
        text: { agreement: x.agreement,
          privacy: { title: x.privacy.title, sections: x.privacy.sections.map(([h, p]) => [h, fill(p)]) } } });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
  // /policy (the agreement, which holds the shala's rules) and /privacy open those sections of
  // the booking page, once the agreement is on.
  app.get(['/policy', '/privacy'], async (req, res, next) => {
    if (await consentModeSoon() === 'off') return next();
    res.redirect(302, '/book#' + (/^\/privacy/i.test(req.path) ? 'privacy' : 'policy'));
  });

  // ── public: catalogue + schedule ──────────────────────────────────────────
  app.get('/api/bkk/products', async (req, res) => {
    try {
      await switchPrices();
      const pct = await surcharge();
      const r = await q('SELECT * FROM bkk_products WHERE active ORDER BY sort, id');
      res.json({
        surchargePct: pct,
        vatPct: VAT_PCT,
        // Which way this shala can take money right now. Names only — never a
        // key, never a fragment of one. 'gateway' = verified auto-activation,
        // 'link' = pay.sn plus a human confirming, 'none' = cannot sell online.
        payment: paymentStatus(),
        // The promotion calculator counts real classes, and a doubled 3-month
        // Duo bought on the last day runs about 7 months.
        moonDays: Object.fromEntries(moonDaysBetween(ymd(new Date()), ymd(new Date(Date.now() + 260 * 86400000)))),
        products: r.rows.map(p => {
          const b = breakdown(p.price_thb, pct);
          return { ...p, fee_thb: b.fee, vat_thb: b.vat, total_thb: b.total };
        }),
      });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Schedule is generated from the weekly pattern on read — no cron.
  // One call lists 62 days at most: the booking page loads the rest of this month
  // + next, and asks for later months (from=) as the student moves to them.
  const SCHEDULE_DAYS = 62;
  const addDaysYmd = (d, n) => new Date(Date.parse(`${d}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
  // Booking is open up to this day (Boonchu, 17 Nov 2026: the whole of 2027).
  // Staff set it in Settings. Never less than the rolling 62 days, so a date left
  // behind never closes booking, and never more than two years ahead.
  const OPEN_UNTIL_DEFAULT = '2027-12-31';
  const OPEN_MAX_DAYS = 730;
  // A drop-in opens 2 weeks before its class: today and the next 13 days (Boonchu, 19 Nov 2026).
  const DROPIN_DAYS = 14;
  async function openUntil() {
    const today = bkkToday(), floor = addDaysYmd(today, SCHEDULE_DAYS - 1), cap = addDaysYmd(today, OPEN_MAX_DAYS);
    const v = String(await getSetting('booking_open_until', OPEN_UNTIL_DEFAULT));
    const d = isYmd(v) ? v : OPEN_UNTIL_DEFAULT;
    return d < floor ? floor : d > cap ? cap : d;
  }
  // Teacher names show on the public timetable only for months the team has
  // confirmed, a week before each month (Boonchu, 17 Nov 2026). The setting is
  // the last month shown, 'YYYY-MM'; staff pages always show the plan.
  const TEACHERS_THROUGH_DEFAULT = '2026-12';
  async function teachersThrough() {
    const v = String(await getSetting('teachers_shown_through', TEACHERS_THROUGH_DEFAULT));
    return /^\d{4}-\d{2}$/.test(v) ? v : TEACHERS_THROUGH_DEFAULT;
  }
  // Without the staff key: no capacity, no booked count, and seatsLeft stops at 4. The
  // booking page only needs "full", "last 1-3" and "spots free"; the real numbers would
  // say how many practise in each class.
  const PUBLIC_SEATS_MAX = 4;
  // A class that has started stays listed until the end of its Bangkok day, with
  // bookUntil (bookCloseAt) and, once they hold, started and closed. The days
  // start today, so no earlier day's class is ever listed.
  app.get('/api/bkk/schedule', async (req, res) => {
    const staff = isAdmin(req);
    if (staff) res.set('Cache-Control', 'private, no-store');
    try {
      const days = Math.min(SCHEDULE_DAYS, Math.max(1, parseInt(req.query.days) || 14));
      if (req.query.from !== undefined && !isYmd(req.query.from)) return res.status(400).json({ error: 'from must be YYYY-MM-DD' });
      const today = bkkToday(), until = await openUntil(), through = staff ? null : await teachersThrough();
      const from = req.query.from && req.query.from > today ? req.query.from : today;
      const slots = (await q('SELECT * FROM bkk_class_slots WHERE active')).rows;
      const nowMs = bkkNow().getTime();
      const dates = [];
      for (let i = 0; i < days; i++) {
        const d = addDaysYmd(from, i);
        if (d > until) break;
        dates.push(d);
      }
      if (!dates.length) return res.json({ classes: [], moonDays: {}, from, to: until, openUntil: until,
        cutoffHours: CANCEL_CUTOFF_HOURS, now: nowMs });
      const overrides = (await q(
        `SELECT * FROM bkk_class_overrides WHERE class_date = ANY($1::date[])`, [dates])).rows;
      const counts = (await q(
        `SELECT slot_id, class_date, count(*)::int AS n FROM bkk_bookings
         WHERE status = 'booked' AND class_date = ANY($1::date[])
         GROUP BY slot_id, class_date`, [dates])).rows;

      const moon = moonDaysBetween(dates[0], dates[dates.length - 1]);
      const out = [];
      for (const dstr of dates) {
        if (moon.has(dstr)) continue;
        const wd = new Date(`${dstr}T12:00:00${TZ_OFFSET}`).getUTCDay();
        for (const s of slots.filter(x => x.weekday === wd)) {
          const ov = overrides.find(o => o.slot_id === s.id && ymd(new Date(o.class_date)) === dstr);
          if (ov && ov.cancelled) continue;
          // ?? not || — an override capacity of 0 ("closed today") is a real value.
          const cap = (ov && ov.capacity != null) ? ov.capacity : s.capacity;
          const booked = (counts.find(c => c.slot_id === s.id && ymd(new Date(c.class_date)) === dstr) || {}).n || 0;
          const startAt = startAtISO(dstr, s.start_time), closeMs = bookCloseAt(s, dstr);
          out.push({
            slotId: s.id, date: dstr, startAt, title: s.title, kind: s.kind,
            teachers: !through || dstr.slice(0, 7) <= through ? rotationTeacher(s.code, dstr) || s.teachers || '' : '',
            durationMin: s.duration_min,
            isOnline: s.is_online, bookUntil: bkkISO(closeMs),
            ...(nowMs >= Date.parse(startAt) ? { started: true } : {}),
            ...(nowMs >= closeMs ? { closed: true } : {}),
            ...(staff ? { capacity: cap, booked, seatsLeft: Math.max(0, cap - booked) }
              : { seatsLeft: Math.min(PUBLIC_SEATS_MAX, Math.max(0, cap - booked)) }),
          });
        }
      }
      out.sort((a, b) => a.startAt.localeCompare(b.startAt));
      // to: the last day loaded, so a page knows a later day is not "no class". now: this
      // server's clock, so a phone set a few minutes off still grays a class at bookUntil.
      res.json({ classes: out, moonDays: Object.fromEntries(moon), from: dates[0], to: dates[dates.length - 1], openUntil: until,
        cutoffHours: CANCEL_CUTOFF_HOURS, now: nowMs });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ── buy: create order, hand back a PaySolutions redirect ──────────────────
  app.post('/api/bkk/orders', async (req, res) => {
    try {
      const { productCode, name, email, phone } = req.body || {};
      if (!productCode || !(name || '').trim() || !(email || '').trim())
        return res.status(400).json({ error: 'name, email and product are required' });

      await switchPrices();
      const pr = (await q('SELECT * FROM bkk_products WHERE code = $1 AND active', [productCode])).rows[0];
      if (!pr) return res.status(404).json({ error: 'product not found' });

      // A drop-in is one class, so it is bought FOR a class and paying books it.
      // Checked here as a student booking would be; the seat itself is taken
      // only once the payment is confirmed.
      let cls = null;
      if (singleClass(pr)) {
        const { slotId, date } = req.body;
        if (!slotId || !isYmd(date) || !Number.isInteger(Number(slotId)))
          return res.status(400).json({ error: 'Pick the class for your drop-in.' });
        // Drop-ins open 2 weeks before the class (DROPIN_DAYS); booking stays open longer.
        const until = addDaysYmd(bkkToday(), DROPIN_DAYS - 1);
        if (date > until) return res.status(409).json({
          error: `Drop-ins open 2 weeks before the class: you can buy one for a class up to ${until}.`, dropinUntil: until });
        try {
          const c = await classCheck(pool, slotId, date);
          if (await seatsTaken(pool, slotId, date) >= c.capacity) throw new Error('class is full');
          cls = { slotId: Number(slotId), date };
        } catch (e) { return res.status(409).json({ error: e.message }); }
      }

      const before = await rawByEmail(pool, email);
      // Typing someone's email at checkout must not open their profile (photos,
      // teacher notes): an existing profile's code goes back only to a browser
      // that already holds it (a merged-in code counts, and stays as it is).
      // Everyone else signs in from the receipt email.
      const holder = before && req.body.memberCode ? await memberByCode(req.body.memberCode) : null;
      // The agreement comes before the gateway, and before a profile is made, so a refusal
      // leaves nobody and nothing behind. A browser holding a profile that has signed needs no tick.
      let consent = null;
      if (await consentMode() !== 'off') {
        const target = before ? await memberByEmail(email) : null;
        const signed = !!target && !!holder && holder.id === target.id && await consentOk(pool, target.id);
        if (!signed) {
          const c = readConsent(req.body.consent, { name });
          if (!c.value) return res.status(c.status).json(c.body);
          consent = c.value;
        }
      }
      const pct = await surcharge();
      const { fee, vat, total } = breakdown(pr.price_thb, pct);

      // refno is unique-indexed and partly random, so a clash is possible if two
      // orders land in the same millisecond. Retry rather than 500 at a student.
      // A new profile, the order and its consent row (the buyer holds the profile) go in
      // together, so a failure leaves no profile without its order.
      let o = null, member = null, showCode = false;
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        member = await findOrCreateMember({ name, email, phone }, client);
        showCode = !before || (!!holder && holder.id === member.id);
        for (let attempt = 0; attempt < 5 && !o; attempt++) {
          await client.query('SAVEPOINT o');
          try {
            o = (await client.query(
              `INSERT INTO bkk_orders (refno,product_id,member_id,base_thb,fee_thb,vat_thb,amount_thb,slot_id,class_date,need_mat,mail_to,consent)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
              [newRefno(), pr.id, member.id, pr.price_thb, fee, vat, total,
               cls && cls.slotId, cls && cls.date, !!cls && req.body.needMat === true,
               before && before.id !== member.id ? String(email).trim().toLowerCase() : null,
               consent && JSON.stringify(consent)])).rows[0];
            await client.query('RELEASE SAVEPOINT o');
          } catch (e) {
            await client.query('ROLLBACK TO SAVEPOINT o');
            if (!/duplicate key/.test(e.message) || attempt === 4) throw e;
          }
        }
        // An email that already has a profile, typed by a browser that does not hold it, marks
        // nobody yet: activateOrder writes that row once the order is paid ('checkout-email').
        if (consent && showCode) await insertConsent(client, { memberId: member.id, name: consent.name, under20: consent.under20,
          lang: consent.lang, via: 'checkout', orderId: o.id, email: String(email).trim().toLowerCase() });
        await client.query('COMMIT');
      } catch (e) {
        await client.query('ROLLBACK').catch(() => {});
        throw e;
      } finally { client.release(); }

      const cfg = paysoConfig();
      res.json({
        order: { id: o.id, refno: String(o.refno), amount: total, product: pr.name_en },
        member: showCode ? { code: holder ? String(req.body.memberCode) : member.code } : { existing: true },
        pay: cfg ? buildPayForm(cfg, o, pr, member, req) : null,
        payLink: cfg ? null : paysnLink(o, pr),
        payUnavailable: (cfg || paysnLink(o, pr)) ? undefined :
          'Online payment is not configured yet — the shala will contact you to arrange payment.',
      });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Pay.sn is PaySolutions' no-code product: a payment link, no API key, no
  // secret, and therefore nothing we can verify server-side. Orders paid this
  // way stay 'pending' until a human confirms in the admin — deliberately, since
  // auto-activating on an unverifiable signal would hand out free memberships.
  // Format from the merchant console: pay.sn/<store>/<amount>/<detail>,
  // capped at 300,000 THB per link.
  const PAYSN_MAX_THB = 300000;
  function paysnLink(order, product) {
    const store = (process.env.PAYSO_PAYSN_STORE || '').trim().replace(/^\/+|\/+$/g, '');
    if (!store) return null;
    if (order.amount_thb > PAYSN_MAX_THB) return null;
    const ref = String(order.refno);
    // The detail is a path segment: keep slashes out of it entirely rather than
    // relying on %2F surviving their router.
    const detail = `AYBKK ${product.name_en} ref ${ref}`.replace(/[\/\\?#&]+/g, '-');
    return {
      url: `https://pay.sn/${store}/${order.amount_thb}/${encodeURIComponent(detail)}`,
      refno: ref,
      amount: order.amount_thb,
      // Shown to the student — they must quote this so the payment can be matched.
      note: `Please keep reference #${ref}. Your pass is activated once the shala ` +
            `sees the payment, usually the same day.`,
    };
  }

  // All three keys are required, not just the merchant id: the redirect itself
  // needs only merchantid, but without the Inquiry credentials we could never
  // confirm a payment, and activating on an unverifiable postback would give
  // away memberships. No credentials → no automatic activation, by design.
  function paysoConfig() {
    const merchantId = process.env.PAYSO_MERCHANT_ID;
    const secret = process.env.PAYSO_SECRET_KEY;
    const apiKey = process.env.PAYSO_API_KEY;
    if (!merchantId || !secret || !apiKey) return null;
    return {
      merchantId, secret, apiKey,
      endpoint: process.env.PAYSO_ENDPOINT || 'https://payments.paysolutions.asia/payment',
      inquiryBase: process.env.PAYSO_INQUIRY_BASE || 'https://apis.paysolutions.asia',
    };
  }

  // The redirect is unsigned — PaySolutions publishes no hash, checksum or MAC
  // for it, so every field here is modifiable by the payer before submitting.
  // Nothing is trusted on the way back: the amount is re-read from the Inquiry
  // API and compared with what we recorded.
  // Return URL and Post Back URL are NOT form fields; they are configured once
  // in the merchant panel and PaySolutions appends no parameters to the return.
  // What staff see on the payment in PaySolutions: the package and our ref
  // (Nov 2026: a payment came in that staff could not match to a package).
  // Slashes in package names ('8 classes / 2 months') become dashes, so no
  // screen that splits on a slash can cut the package name off.
  const payDetail = (product, order) => `AYBKK ${product.name_en} ref ${refno12(order.refno)}`
    .replace(/\s*[\/\\]\s*/g, ' - ').replace(/[<>&"']/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 255);
  function buildPayForm(cfg, order, product, member) {
    return {
      action: cfg.endpoint,
      fields: {
        merchantid: String(cfg.merchantId),
        refno: refno12(order.refno),
        customeremail: String(member.email || '').slice(0, 100),
        productdetail: payDetail(product, order),
        total: order.amount_thb.toFixed(2),
        cc: '00',                                   // 00 = Thai baht
        lang: 'EN',
      },
      refno: refno12(order.refno),
    };
  }

  // ── payment confirmation ──────────────────────────────────────────────────
  // The postback carries NO trustworthy signature (PaySolutions' own plugins
  // accept it blindly). It only tells us *which* order to go and verify.
  // The merchant panel sends it as a GET with the fields in the query string
  // (15 Nov 2026: the route took POST only, so every postback was turned away
  // and a payment waited for the student's own page to check it). Both are taken.
  const postback = async (req, res) => {
    const pick = o => o && (o.refno || o.refNo);
    const refno = String(pick(req.body) || pick(req.query) || '').trim();
    res.json({ ok: true });                        // always 200 — never leak state
    if (!/^\d{1,12}$/.test(refno)) return;
    try { await verifyAndActivate(Number(refno)); }
    catch (e) { console.error('[bkk pay] verify failed:', e.message); }
  };
  app.post('/api/bkk/pay/postback', express_urlencoded_safe, postback);
  app.get('/api/bkk/pay/postback', postback);

  // Student's browser comes back here; also triggers a verify so activation is
  // not dependent on the postback arriving.
  app.get('/api/bkk/pay/check/:refno', async (req, res) => {
    try {
      const r = await verifyAndActivate(Number(req.params.refno));
      res.json(r);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // now: the payment watch's clock (paySweep passes its own); out.verdict: what
  // PaySolutions answered, for the sweep.
  // kind: 'pass' or 'tee'; a tee order also says where its tee order stands ({ tee: { status } }).
  async function verifyAndActivate(refno, opts = {}) {
    const o = (await q('SELECT * FROM bkk_orders WHERE refno = $1', [refno])).rows[0];
    if (!o) return { status: 'unknown' };
    const r = await verifyOrder(o, refno, opts);
    if (o.kind !== 'tee') return { ...r, kind: 'pass' };
    const t = (await q(`SELECT t.status, t.hold_until, o.status AS money FROM bkk_tee_orders t JOIN bkk_orders o ON o.id=t.order_id
      WHERE t.order_id=$1`, [o.id])).rows[0];
    return { ...r, kind: 'tee', tee: t ? { status: teeView(t, t.money, nowMs()) } : null };
  }
  async function verifyOrder(o, refno, { now = nowMs(), out = {} } = {}) {
    if (o.status === 'paid') return { status: 'paid', already: true, ...await orderBooking(o) };
    // A Rezerv payment is history: it never goes near the gateway or a pass.
    if (o.source === 'rezerv') return { status: o.status };
    // Voided by staff after a check with the bank or PaySolutions: final. Never
    // asked again, and its "Void:" note stays (15 Nov 2026).
    if (o.status === 'void' || o.status === 'twin') return { status: o.status };

    const cfg = paysoConfig();
    if (!cfg) return { status: o.status, note: 'gateway not configured' };

    const verdict = out.verdict = await inquire(cfg, o);
    await q(`UPDATE bkk_orders SET checked_at = to_timestamp($2::double precision / 1000) WHERE id = $1`, [o.id, now]);
    await (verdict.failed ? checkFailing(verdict.why, now) : checkWorks()).catch(e => console.error('[bkk pay] check health failed:', e.message));
    // Staff (or another path) may have turned the order on while PaySolutions
    // was being asked: a paid order keeps its status and its note.
    const alreadyPaid = async () => ({ status: 'paid', already: true, ...await orderBooking(o) });
    if (!verdict.paid) {
      const upd = await q(`UPDATE bkk_orders SET gateway_note = $2 WHERE id = $1 AND status <> 'paid' RETURNING id`,
        [o.id, (verdict.note || 'not confirmed').slice(0, 300)]);
      if (!upd.rows.length) return alreadyPaid();
      // A record that is not paid an hour on: a status this code does not know
      // ("Y Paid" was one, 15 Nov 2026) looks exactly like this.
      if (!verdict.failed && verdict.record && now - new Date(o.created_at).getTime() >= PAY_WATCH.stuckMin * 60000) stuckPing(o, verdict, now);
      return { status: o.status, note: verdict.note };
    }
    // Amount must match what we asked for. A confirmed payment with no amount
    // is not good enough either — the redirect form is unsigned, so the amount
    // is the one thing a payer could have altered, and it is exactly what must
    // be checked before a pass is created.
    if (verdict.amount == null || Math.round(Number(verdict.amount)) !== o.amount_thb) {
      const upd = await q(`UPDATE bkk_orders SET status='mismatch', gateway_note=$2 WHERE id=$1 AND status <> 'paid' RETURNING id`,
        [o.id, `amount ${verdict.amount} != ${o.amount_thb}`]);
      if (!upd.rows.length) return alreadyPaid();
      console.warn(`[bkk pay] AMOUNT MISMATCH refno=${refno} gateway=${verdict.amount} expected=${o.amount_thb}`);
      alertSoon(o, 'mismatch', `⚠ Wrong amount: PaySolutions says ${verdict.amount == null ? 'no amount'
        : '฿' + thb(Math.round(Number(verdict.amount)))}, the order is ฿${thb(o.amount_thb)}. ${o.kind === 'tee' ? 'Nothing was sold.' : 'No pass was made.'}`,
        'Look in PaySolutions before you do anything.');
      return { status: 'mismatch' };
    }
    await activateOrder(o, verdict);
    return { status: 'paid', ...await orderBooking(o) };
  }

  // ── problem pings (15 Nov 2026) ───────────────────────────────────────────
  // Each names the student (name and member code), the package, the amount and
  // the ref. Never an email, a phone, a link or anything a student wrote: a word
  // with an @, a +, a digit in any script, a slash or a dot before letters is not
  // part of a name.
  const thb = n => Math.round(Number(n) || 0).toLocaleString('en-US');
  const pingName = s => String(s || '').replace(/[\u0000-\u001f\u007f]/g, ' ').split(/\s+/)
    .filter(w => w && !/[@+＠＋/\\:]|\p{Nd}|www\.|[.．]\p{L}{2,}/iu.test(w)).join(' ').slice(0, 60) || 'Student';
  const gwText = s => String(s || '').replace(/\S*@\S*/g, ' ').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40);
  // "Sun 15 Nov 21:05", Bangkok time.
  const bkkClock = ms => { const t = new Date(ms + 7 * 3600000).toISOString(); return `${classWhen(t.slice(0, 10), '').slice(0, -7)} ${t.slice(11, 16)}`; };
  // A tee order names no buyer at all: no name, WeChat ID, mobile or email in Telegram.
  async function orderLine(o) {
    const r = (await q(`SELECT m.name, m.code, pr.name_en, o.kind, o.item_name,
        (SELECT sum(l.qty)::int FROM bkk_tee_lines l WHERE l.order_id=o.id) AS tees
      FROM bkk_orders o LEFT JOIN bkk_members m ON m.id=o.member_id LEFT JOIN bkk_products pr ON pr.id=o.product_id
      WHERE o.id=$1`, [o.id])).rows[0] || {};
    if (r.kind === 'tee') return `Tee order · ${r.item_name || 'AYBKK tee pre-order'} ×${r.tees || 0} · ฿${thb(o.amount_thb)} · ref ${o.refno}`;
    return `${pingName(r.name)} (${r.code || 'no member code'}) · ${r.name_en || 'no package'} · ฿${thb(o.amount_thb)} · ref ${o.refno}`;
  }
  // Claimed before it is sent, so a restart or a second server never sends it
  // again. claimId: the order the claim is kept on (a double keeps one per pair).
  async function alertOnce(o, kind, head, tail, claimId = o.id) {
    const mine = await q(`INSERT INTO bkk_pay_alerts (order_id, kind) VALUES ($1,$2)
      ON CONFLICT DO NOTHING RETURNING order_id`, [claimId, kind]);
    if (!mine.rows.length) return false;
    const text = [head, await orderLine(o), tail].filter(Boolean).join('\n');
    // Telegram said no, or could not be reached: nothing arrived, so resendAlerts tries again.
    if ((await notify(text)).retry) await q(`UPDATE bkk_pay_alerts SET retry_text=$3 WHERE order_id=$1 AND kind=$2`, [claimId, kind, text]);
    return true;
  }
  const alertSoon = (...args) => alertOnce(...args).catch(e => console.error('[bkk pay] alert failed:', e.message));
  // Each refused ping, 10 minutes apart, 3 tries in all. A timeout is never
  // tried again: that message may have arrived.
  async function resendAlerts({ now = nowMs() } = {}) {
    const due = (await q(`UPDATE bkk_pay_alerts SET tries = tries + 1, sent_at = $1
      WHERE retry_text IS NOT NULL AND tries < $2 AND sent_at <= $1::timestamptz - make_interval(mins => $3)
      RETURNING order_id, kind, retry_text, tries`, [new Date(now), PAY_WATCH.sendTries, PAY_WATCH.retryMin])).rows;
    let sent = 0;
    for (const a of due) {
      const r = await notify(a.retry_text);
      if (r.ok) sent++;
      if (!r.retry || a.tries >= PAY_WATCH.sendTries) await q(`UPDATE bkk_pay_alerts SET retry_text=NULL WHERE order_id=$1 AND kind=$2`, [a.order_id, a.kind]);
    }
    return { due: due.length, sent };
  }
  // A record still not paid an hour on. A later paid order for the same package
  // usually means a declined try the student paid again; it can also be a double.
  function stuckPing(o, verdict, now) {
    (async () => {
      const later = (await q(`SELECT x.refno, to_char(coalesce(x.verified_at, x.created_at) AT TIME ZONE 'Asia/Bangkok', 'DD Mon HH24:MI') AS at
        FROM bkk_orders x WHERE x.member_id=$1 AND x.product_id=$2 AND x.id<>$3 AND x.status='paid' AND x.amount_thb > 0
          AND x.source IS DISTINCT FROM 'rezerv' AND x.created_at >= $4 ORDER BY x.created_at LIMIT 1`,
        [o.member_id, o.product_id, o.id, o.created_at])).rows[0];
      await alertOnce(o, 'status', `⚠ Not paid after ${Math.floor((now - new Date(o.created_at).getTime()) / 60000)} min. `
        + `PaySolutions says: status ${gwText(verdict.status) || 'none'} (${gwText(verdict.statusName) || 'no name'})`,
        later ? `They paid ref ${later.refno} (${later.at}). If PaySolutions shows money for this one too, refund one.`
          : 'If PaySolutions shows the money, turn the order on by hand in Payments.');
    })().catch(e => console.error('[bkk pay] alert failed:', e.message));
  }
  // The check failing, for the whole shala: one ping once it failed twice in a
  // row or for 20 minutes (one blip is not news), at most every 3 hours, and one
  // "works again" when an answer comes back after that ping.
  const FAILING = 'pay_check_failing';
  async function checkFailing(why, now) {
    const at = new Date(now).toISOString();
    const v = (await q(`INSERT INTO bkk_settings (key,value) VALUES ($1, jsonb_build_object('since', $2::text, 'fails', 1, 'why', $3::text))
      ON CONFLICT (key) DO UPDATE SET value = bkk_settings.value || jsonb_build_object('since', coalesce(bkk_settings.value->>'since', $2::text),
        'fails', coalesce((bkk_settings.value->>'fails')::int, 0) + 1, 'why', $3::text), updated_at=now()
      RETURNING value`, [FAILING, at, why])).rows[0].value;
    if (v.fails < PAY_WATCH.failAfter && now - Date.parse(v.since) < PAY_WATCH.failMin * 60000) return;
    const mine = await q(`UPDATE bkk_settings SET value = value || jsonb_build_object('pingedAt', $2::text, 'pinged', true), updated_at=now()
      WHERE key=$1 AND value ? 'since'
        AND coalesce((value->>'pingedAt')::timestamptz, '-infinity') <= $2::timestamptz - make_interval(hours => $3) RETURNING key`,
      [FAILING, at, PAY_WATCH.failGapH]);
    if (!mine.rows.length) return;
    notify(`⚠ PaySolutions check is failing (${gwText(why)}): online payments will not turn on by themselves.`)
      .then(r => r.retry && q(`UPDATE bkk_settings SET value = (value - 'pinged') || '{"pingedAt":"1970-01-01T00:00:00Z"}'::jsonb
        WHERE key=$1 AND value->>'pingedAt' = $2`, [FAILING, at])).catch(e => console.error('[bkk pay] alert failed:', e.message));
  }
  async function checkWorks() {
    const r = await q(`WITH old AS (SELECT value FROM bkk_settings WHERE key=$1 AND value ? 'since' FOR UPDATE)
      UPDATE bkk_settings s SET value = s.value - 'since' - 'fails' - 'why' - 'pinged', updated_at=now()
      FROM old WHERE s.key=$1 RETURNING old.value AS was`, [FAILING]);
    const was = r.rows[0] && r.rows[0].was;
    if (was && was.pinged) notify(`✓ PaySolutions check works again (failing since ${bkkClock(Date.parse(was.since))}, ${gwText(was.why)}).`);
  }
  // Another paid order above ฿0 (not Rezerv) for the same package within 72
  // hours, and for a drop-in the same class (both must name one): the student
  // may have paid twice. One ping per pair, whichever of the two turned on last.
  async function doubleCheck(o, pr, byHand) {
    const other = (await q(`SELECT x.id, x.refno, x.amount_thb, x.method,
        to_char(coalesce(x.verified_at, x.created_at) AT TIME ZONE 'Asia/Bangkok', 'DD Mon HH24:MI') AS at
      FROM bkk_orders o JOIN bkk_orders x ON x.member_id=o.member_id AND x.product_id=o.product_id AND x.id<>o.id
        AND (NOT $3::boolean OR (x.slot_id = o.slot_id AND x.class_date = o.class_date))
      WHERE o.id=$1 AND x.status='paid' AND x.amount_thb > 0 AND x.source IS DISTINCT FROM 'rezerv'
        AND coalesce(x.verified_at, x.created_at) > coalesce(o.verified_at, now()) - make_interval(hours => $2)
      ORDER BY coalesce(x.verified_at, x.created_at) DESC LIMIT 1`, [o.id, PAY_WATCH.doubleH, singleClass(pr)])).rows[0];
    if (!other) return;
    await alertOnce(o, `double:${Math.max(o.id, other.id)}`, `⚠ Possible double payment: ${pr.name_en} was already paid ${other.at}`
      + ` (ref ${other.refno}, ฿${thb(other.amount_thb)}, ${other.method || 'online'}). `
      + (byHand ? 'Staff activated this one by hand.' : `This one is ${o.method || 'online'}.`),
      'Check the bank or PaySolutions; refund one if it is a double.', Math.min(o.id, other.id));
  }

  // The class a paid drop-in booked, for the "you are booked into…" message.
  // Read back from the database, so a second check (or a postback that won
  // the race) gets the same answer as the first. The buyer's live seat in the
  // order's class: the one the order's pass took, or one they already had.
  // No seat (the class was cancelled or over by the time the payment came
  // through) is said out loud: the student picked that class and would
  // otherwise travel to it.
  async function orderBooking(o) {
    if (!o.slot_id) return {};
    const b = (await q(
      `SELECT s.title, b.start_at FROM bkk_orders o
       JOIN bkk_bookings b ON b.slot_id=o.slot_id AND b.class_date=o.class_date
         AND b.member_id=o.member_id AND b.status='booked'
       JOIN bkk_class_slots s ON s.id=b.slot_id
       WHERE o.id=$1 LIMIT 1`, [o.id])).rows[0];
    if (b) return { booking: { title: b.title, startAt: b.start_at } };
    const c = (await q(
      `SELECT s.title, s.start_time, to_char(o.class_date,'YYYY-MM-DD') AS class_date
       FROM bkk_orders o JOIN bkk_class_slots s ON s.id=o.slot_id WHERE o.id=$1`, [o.id])).rows[0];
    return c ? { notBooked: { title: c.title, startAt: startAtISO(c.class_date, c.start_time) } } : {};
  }

  // POST /order/orderdetailpost. Header casing is theirs and is inconsistent
  // with their other endpoints — merchantID, merchantSecretKey, apikey — so it
  // is written out literally rather than normalised. merchantID is the LAST 5
  // DIGITS of the merchant id, in both header and body. Unused body fields take
  // the literal placeholders the docs specify ("X", "QWERTY").
  const PAID_STATUS = new Set(['CP', 'Y']);
  // failed: PaySolutions did not answer properly (no 200, a timeout, the network),
  // so nothing can turn on by itself. record: it answered with a record for the order.
  const inquiryMs = Number(opts.inquiryTimeoutMs) || PAY_WATCH.inquiryMs;
  const runMs = inquiryMs * 4, slowMs = inquiryMs / 3;
  async function inquire(cfg, order) {
    const url = `${cfg.inquiryBase.replace(/\/$/, '')}/order/orderdetailpost`;
    const mid5 = String(cfg.merchantId).slice(-5);
    let r, text;
    try {
      r = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          merchantID: mid5,
          merchantSecretKey: cfg.secret,
          apikey: cfg.apiKey,
        },
        body: JSON.stringify({
          merchantID: mid5,
          orderNo: 'X',
          refno: refno12(order.refno),
          productDetail: 'QWERTY',
        }),
        signal: AbortSignal.timeout(inquiryMs),
      });
      text = (await r.text()).trim();
    } catch (e) {
      // Never e.message: Node quotes a bad header value in it, and that value is the secret key.
      const code = String((e.cause && e.cause.code) || '');
      const cause = e.name === 'TimeoutError' || e.name === 'AbortError' ? `timeout after ${+(inquiryMs / 1000).toFixed(1)} s`
        : /^[A-Z][A-Z0-9_]{1,40}$/.test(code) ? code : 'request could not be sent';
      return { paid: false, failed: true, why: cause, note: `inquiry failed: ${cause}` };
    }
    const http = r.status, failed = http !== 200, why = `http ${http}`;
    // Documented failure mode: an unsuccessful payment returns no body at all.
    if (!text) return { paid: false, http, failed, why, note: `no record (http ${http})` };
    let j = null; try { j = JSON.parse(text); } catch (_) {}
    if (!j) return { paid: false, http, failed: true, why: failed ? why : 'an answer that is not JSON',
      note: `inquiry ${http}: ${text.slice(0, 120)}` };
    const d = Array.isArray(j) ? j[0] : (j.data || j);
    // Carry the HTTP status in every note: an unpaid order and a rejected API
    // key both come back "not paid", and the code is what tells them apart.
    const status = d && typeof d === 'object' ? String(d.Status ?? '').trim().toUpperCase() : '';
    // An answer with no Status ({}, {"data":null}, an error message) is no record.
    if (!status) return { paid: false, http, failed, why, note: `no record (http ${http})` };
    // The docs show "CP" (COMPLETE); the live account answers "Y" (Paid) for a
    // finished payment (15 Nov 2026). Either is paid; the amount is still checked.
    const paid = PAID_STATUS.has(status);
    // Total comes back as a JSON number (3900.0), not a string.
    const amount = d.Total == null ? null : Number(d.Total);
    return {
      paid, amount, raw: d, http, failed, why, record: true, status, statusName: String(d.StatusName ?? ''),
      note: paid ? 'confirmed'
        : `http ${http} status=${status} ${d.StatusName || ''} total=${d.Total ?? 'none'}`.trim(),
    };
  }

  // An order bought for a class (a drop-in) also takes its seat, with the new
  // pass. opts.checkIn, opts.source, opts.requestId and opts.late are for a
  // drop-in paid at the door or added by staff. Returns { booking, bookingError },
  // { unsold, seat } when the door's sale was not needed after all (seat: what
  // takeSeat found), or null when the order was already paid.
  async function activateOrder(order, verdict = {}, opts = {}) {
    if (order.kind === 'tee') return activateTee(order, verdict, opts);
    const pr = (await q('SELECT * FROM bkk_products WHERE id = $1', [order.product_id])).rows[0];
    const client = await pool.connect();
    let seat = null, cls = null;
    try {
      await client.query('BEGIN');
      const upd = await client.query(
        `UPDATE bkk_orders SET status='paid', verified_at=now(), gateway_ref=$2, gateway_note=$3
         WHERE id=$1 AND status IN ('pending','failed','mismatch')
         RETURNING slot_id, to_char(class_date,'YYYY-MM-DD') AS class_date, consent, member_id, mail_to`,
        [order.id, verdict.raw ? JSON.stringify(verdict.raw).slice(0, 400) : null, verdict.note || null]);
      if (!upd.rows.length) { await client.query('ROLLBACK'); return null; }   // already activated, or void
      // The checkout's tick for a profile the buyer did not hold lands with the payment, never
      // before it. A failure here is logged and never stops the activation.
      const tick = upd.rows[0].consent;
      if (tick && tick.agree === true && CONSENT_TEXT[tick.version] && CONSENT_TEXT[tick.version][tick.lang]) {
        await client.query('SAVEPOINT consent');
        try {
          if (!(await client.query('SELECT 1 FROM bkk_consents WHERE order_id=$1 LIMIT 1', [order.id])).rows.length) {
            const who = (await client.query('SELECT email FROM bkk_members WHERE id=$1', [upd.rows[0].member_id])).rows[0];
            await insertConsent(client, { memberId: upd.rows[0].member_id, name: tick.name, under20: tick.under20, lang: tick.lang,
              version: tick.version, via: 'checkout-email', orderId: order.id, email: upd.rows[0].mail_to || (who && who.email) || null });
          }
          await client.query('RELEASE SAVEPOINT consent');
        } catch (e) {
          await client.query('ROLLBACK TO SAVEPOINT consent');
          console.error(`[bkk] consent for order ${order.id} not saved:`, e.message);
        }
      }
      // A pass order with no package makes no broken pass: it fails here and stays as it was.
      if (!pr) throw new Error('order has no package');
      const pass = (await client.query(
        `INSERT INTO bkk_passes (member_id,product_id,order_id,kind,credits_total,daily_cap,valid_days)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
        [order.member_id, pr.id, order.id, pr.kind, pr.credits, pr.daily_cap, pr.valid_days])).rows[0];
      const { slot_id: slotId, class_date: date } = upd.rows[0];
      if (slotId && date) {
        // The seat must never cost the student the payment. A class cancelled
        // (or over) while they paid rolls back to here: the order stays paid,
        // the pass stays a 1-class credit, and the shala is told to sort it out.
        // Staff timing: a payment confirmed after 07:30 still books until the end.
        await client.query('SAVEPOINT seat');
        try {
          seat = await takeSeat(client, { member: { id: order.member_id }, slotId, date, staff: true,
            allowOver: true, cover: 'pass', passId: pass.id, checkIn: !!opts.checkIn,
            source: opts.source || 'order', requestId: opts.requestId, onList: true, needMat: order.need_mat === true,
            late: !!opts.late });
          await client.query('RELEASE SAVEPOINT seat');
        } catch (e) {
          await client.query('ROLLBACK TO SAVEPOINT seat');
          seat = { error: e.message };
        }
        // At the door (or staff adding from the calendar) the money is still in
        // the hand. Another phone (or a second tap) put them on the list while
        // this sale was on its way: they keep that seat, and nothing is sold twice.
        if ((opts.source === 'door' || opts.source === 'staff') && seat.already) {
          await client.query('DELETE FROM bkk_passes WHERE id=$1', [pass.id]);
          await client.query('DELETE FROM bkk_orders WHERE id=$1', [order.id]);
          await client.query('COMMIT');
          return { unsold: true, seat };
        }
        const s = (await client.query('SELECT title, start_time FROM bkk_class_slots WHERE id=$1', [slotId])).rows[0];
        cls = { name: s ? s.title : `class ${slotId}`, when: classWhen(date, s ? s.start_time : '') };
      }
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK'); throw e;
    } finally { client.release(); }

    const booked = cls && !seat.error;
    console.log(`✓ bkk: pass activated for order ${order.id} (${pr.name_en})${cls ? (booked
      ? `, booked ${cls.name} ${cls.when}` : `, could NOT book ${cls.name} ${cls.when}: ${seat.error}`) : ''}`);
    // A ping for each sale only when Boonchu asks for it (ping_each_sale): the
    // sales go in the daily money line. Problems always ping; staff's own
    // activation by hand pings neither as a sale nor as "not booked" (the page
    // tells them), only as a possible double.
    (async () => {
      if (cls && !booked && !opts.byHand) await alertOnce(order, 'nobook',
        `⚠ Paid, but could not book ${cls.name}, ${cls.when}: ${seat.error}.`, 'They keep a 1-class credit: book them by hand.');
      if (!opts.byHand && await getSetting('ping_each_sale', 'off') === 'on') {
        const lines = [`💳 AYBKK payment (${order.method || 'online'})`, `${pr.name_en} · ฿${order.amount_thb}`, `refno ${order.refno}`];
        if (booked) lines.push(`📅 ${seat.already ? 'Already on the list' : 'Booked'}: ${cls.name}, ${cls.when}`
          + (seat.overCapacity ? `\n⚠ over capacity: ${seat.taken + 1} for ${seat.capacity} places` : ''));
        await notify(lines.join('\n'));
      }
      await doubleCheck(order, pr, opts.byHand);
    })().catch(e => console.error('[bkk pay] ping failed:', e.message));
    // After COMMIT, and awaited only so failures are logged. The pass already
    // exists; a mail server having a bad day must not undo a paid order.
    emailReceipt(order, pr, cls && { ...cls, booked }).catch(e => console.error('[bkk] receipt failed:', e.message));
    emailOrderAgreement(order).catch(e => console.error('[bkk] agreement copy failed:', e.message));
    return {
      booking: booked ? { title: cls.name, startAt: seat.startAt, overCapacity: seat.overCapacity, already: seat.already } : null,
      bookingError: cls && seat.error ? seat.error : null,
    };
  }

  // The receipt doubles as the student's way back in: it carries a sign-in link,
  // so nobody has to keep a member code safe to keep their pass.
  async function emailReceipt(order, product, cls) {
    const m = (await q('SELECT * FROM bkk_members WHERE id=$1', [order.member_id])).rows[0];
    // Bought with a folded profile's email: mail that address, and its link signs
    // in as that profile (which opens this one while the merge stands).
    const to = order.mail_to ? await rawByEmail(pool, order.mail_to) : null;
    const via = to ? { id: to.id, email: order.mail_to } : m;
    if (!m || !via || !via.email) return;
    const token = crypto.randomBytes(32).toString('hex');
    await q(`INSERT INTO bkk_login_tokens (token,member_id,email,ip,expires_at)
             VALUES ($1,$2,$3,'receipt', now() + interval '30 days')`,
      [token, via.id, via.email]);
    // Once the agreement is on, the receipt says which one the pass was bought under, for the
    // owner to read when someone else bought it for them.
    const agreement = await consentMode() !== 'off' && await consentOk(pool, m.id)
      ? { version: CONSENT_VERSION, link: `${baseUrl()}/book?agreement=${CONSENT_VERSION}#agreement` } : null;
    const t = render('receipt', m.lang || 'en', {
      name: m.name, product: product.name_en,
      amount: order.amount_thb, base: order.base_thb, fee: order.fee_thb, vat: order.vat_thb || 0,
      refno: order.refno, link: `${baseUrl()}/api/bkk/login/${token}`, cls, agreement,
    });
    await sendMail({ to: via.email, subject: t.subject, html: t.html, text: t.text, tag: 'receipt' });
  }

  // Boonchu's private Telegram chat. Never throws. The last result is kept
  // ('telegram_last') so the admin page can say whether the pings get through.
  const telegramSet = () => !!(process.env.TELEGRAM_BOT_TOKEN && process.env.BOONCHU_CHAT_ID);
  const tgBase = () => (process.env.TELEGRAM_API_BASE || 'https://api.telegram.org').replace(/\/+$/, '');
  async function notify(text) {
    const token = process.env.TELEGRAM_BOT_TOKEN, chat = process.env.BOONCHU_CHAT_ID;
    if (!token || !chat) return { ok: false, error: 'not set' };
    let out;
    try {
      const base = tgBase();
      // No link previews: a link in a name or a status never shows up as a card.
      const r = await fetch(`${base}/bot${token}/sendMessage`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chat, text, link_preview_options: { is_disabled: true } }), signal: AbortSignal.timeout(10000),
      });
      const j = await r.json().catch(() => ({}));
      // retry: Telegram answered no, or was never reached, so nothing arrived. A
      // timeout may have arrived, so it is never sent again.
      out = r.ok && j.ok !== false ? { ok: true }
        : { ok: false, retry: true, error: `http ${r.status}${j.description ? ': ' + j.description : ''}` };
    } catch (e) {
      const timeout = e.name === 'TimeoutError';
      out = { ok: false, retry: !timeout, error: timeout ? 'timeout' : (e.cause && e.cause.code) || e.message || 'network error' };
    }
    const at = new Date().toISOString();
    if (!out.ok) out.error = String(out.error).split(token).join('[token]').slice(0, 160);
    await q(`INSERT INTO bkk_settings (key,value) VALUES ('telegram_last',$1::jsonb)
             ON CONFLICT (key) DO UPDATE SET value = bkk_settings.value || $1::jsonb, updated_at=now()`,
      [JSON.stringify(out.ok ? { ok: true, at, okAt: at, error: null } : { ok: false, at, error: out.error })]).catch(() => {});
    return out;
  }

  // ── sign in by email ──────────────────────────────────────────────────────
  // A member code lives in one browser. Lose it and the student is locked out —
  // and the shala has no way to look it up either. A one-time link is the only
  // option here that actually proves the student owns the address: a name is
  // guessable and an email address is not a secret.

  const baseUrl = () => (process.env.PUBLIC_BASE_URL || 'https://cn.aybkk.net').replace(/\/$/, '');
  // Only an address: the column also holds the 'staff', 'qr' and 'receipt' markers,
  // and on cn.aybkk.net x-forwarded-for starts with whatever the client sent, so
  // "x-forwarded-for: staff" made an emailed link reusable (17 Nov 2026).
  const clientIp = req => {
    const first = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    return net.isIP(first) ? first : (req.socket?.remoteAddress || 'unknown');
  };

  app.post('/api/bkk/login/request', async (req, res) => {
    // The answer never varies. Telling a stranger whether an address is
    // registered would leak the shala's student list one guess at a time.
    const vague = { ok: true, message: 'If that address is registered, a link is on its way.' };
    try {
      const email = String((req.body || {}).email || '').trim().toLowerCase();
      const lang = String((req.body || {}).lang || '').slice(0, 5) || null;
      if (!email || !email.includes('@')) return res.json(vague);
      const ip = clientIp(req);

      const [byEmail, byIp] = await Promise.all([
        q(`SELECT count(*)::int AS n FROM bkk_login_tokens
           WHERE email=$1 AND created_at > now() - interval '1 hour'`, [email]),
        q(`SELECT count(*)::int AS n FROM bkk_login_tokens
           WHERE ip=$1 AND created_at > now() - interval '1 hour'`, [ip]),
      ]);
      if (byEmail.rows[0].n >= SIGNIN_PER_EMAIL_HOUR || byIp.rows[0].n >= SIGNIN_PER_IP_HOUR) {
        console.warn(`[bkk login] throttled ${email} from ${ip}`);
        return res.json(vague);
      }

      const hit = await rawByEmail(pool, email);
      const m = await liveMember(pool, hit);
      if (!m) return res.json(vague);
      if (lang) await q('UPDATE bkk_members SET lang=$2 WHERE id=$1', [m.id, lang]);

      // The link signs in as the profile the email is on. A folded one opens the
      // kept profile while the merge stands, and its own again after an undo.
      const token = crypto.randomBytes(32).toString('hex');
      await q(`INSERT INTO bkk_login_tokens (token,member_id,email,ip,expires_at)
               VALUES ($1,$2,$3,$4, now() + ($5 || ' minutes')::interval)`,
        [token, hit.id, email, ip, String(SIGNIN_TTL_MIN)]);

      const t = render('signin', lang || m.lang || 'en',
        { name: m.name, link: `${baseUrl()}/api/bkk/login/${token}` });
      await sendMail({ to: email, subject: t.subject, html: t.html, text: t.text, tag: 'signin' });
      res.json(vague);
    } catch (e) {
      console.error('[bkk login] request failed:', e.message);
      res.json(vague);
    }
  });

  // M sends a student their own sign-in link by LINE, WhatsApp or WeChat: most
  // Rezerv students have no email on file here. Same one-time token as the
  // email link, just longer-lived because it waits in a chat. short_link is the
  // one to send; link stays for anything that still reads it.
  const shortCode = () => Array.from({ length: SHORT_LEN },
    () => SHORT_ALPHABET[crypto.randomInt(SHORT_ALPHABET.length)]).join('');
  // Also handed to idcn-api (the course admin's "Login link"), so both make the same link.
  async function staffSigninLink(memberId) {
    const m = (await q('SELECT id,name FROM bkk_members WHERE id=$1', [memberId])).rows[0];
    if (!m) return null;
    let made;
    for (let tries = 0; !made && tries < 5; tries++) {
      made = (await q(`INSERT INTO bkk_login_tokens (token,member_id,email,ip,expires_at,short_code)
               VALUES ($1,$2,NULL,'staff', now() + ($3 || ' days')::interval, $4)
               ON CONFLICT (short_code) DO NOTHING RETURNING token, short_code`,
        [crypto.randomBytes(32).toString('hex'), m.id, String(STAFF_LINK_DAYS), shortCode()])).rows[0];
    }
    if (!made) throw new Error('could not make a link, please try again');
    return { name: m.name, days: STAFF_LINK_DAYS,
      link: `${baseUrl()}/api/bkk/login/${made.token}`,
      short_link: `${baseUrl()}/in/${made.short_code}` };
  }
  app.post('/api/bkk/admin/members/:code/signin-link', async (req, res) => {
    if (adminOnly(req, res)) return;
    try {
      const m = (await q('SELECT id FROM bkk_members WHERE code=$1', [req.params.code])).rows[0];
      const made = m && await staffSigninLink(m.id);
      if (!made) return res.status(404).json({ error: 'member not found' });
      res.json({ success: true, ...made });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // "Show QR" (17 Nov 2026, the week the shala left Rezerv): the student scans
  // staff's screen at the desk and is signed in on that phone, no email, no
  // chat. One-time like an emailed link (ip 'qr', never the 'staff' reuse rule),
  // so a photo of the screen is dead once the student used it. It opens on the
  // site the desk page is on, as the member code lives in that site's storage,
  // but only a site on this list: anything else gets baseUrl().
  const signinOrigin = given => {
    const norm = s => { try { const u = new URL(String(s).trim()); return /^https?:$/.test(u.protocol) ? u.origin : null; } catch (_) { return null; } };
    const ok = ['https://aybkk.net', 'https://www.aybkk.net', 'https://cn.aybkk.net', 'https://my.aybkk.com', baseUrl(),
      ...String(process.env.BKK_SIGNIN_ORIGINS || '').split(',')].map(norm).filter(Boolean);
    const o = given ? norm(given) : null;
    return o && ok.includes(o) ? o : baseUrl();
  };
  app.post('/api/bkk/admin/members/:code/signin-qr', async (req, res) => {
    if (adminOnly(req, res)) return;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // The row lock puts two taps of Show QR in a line, so only the last QR stays live.
      const m = (await client.query('SELECT id,name FROM bkk_members WHERE code=$1 FOR UPDATE', [req.params.code])).rows[0];
      if (!m) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'member not found' }); }
      await client.query(`UPDATE bkk_login_tokens SET expires_at=now()
        WHERE member_id=$1 AND ip='qr' AND used_at IS NULL AND expires_at > now()`, [m.id]);
      let made;
      for (let tries = 0; !made && tries < 5; tries++) {
        made = (await client.query(`INSERT INTO bkk_login_tokens (token,member_id,email,ip,expires_at,short_code)
                 VALUES ($1,$2,NULL,'qr', now() + ($3 || ' minutes')::interval, $4)
                 ON CONFLICT (short_code) DO NOTHING RETURNING short_code, expires_at`,
          [crypto.randomBytes(32).toString('hex'), m.id, String(SIGNIN_QR_MIN), shortCode()])).rows[0];
      }
      if (!made) throw new Error('could not make a QR, please try again');
      await client.query('COMMIT');
      const shortLink = `${signinOrigin((req.body || {}).origin)}/in/${made.short_code}`;
      const svg = await QRCode.toString(shortLink, { type: 'svg', errorCorrectionLevel: 'M', margin: 4,
        color: { dark: '#000000', light: '#ffffff' } });
      res.set('Cache-Control', 'no-store').json({ success: true, name: m.name, short_link: shortLink,
        short_code: made.short_code, expiresAt: made.expires_at, expiresIn: SIGNIN_QR_MIN * 60, svg });
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      res.status(500).json({ error: e.message });
    } finally { client.release(); }
  });
  // Only reads. expired: never used, and past its time (or ended by a newer QR, Close or a sign-out).
  app.get('/api/bkk/admin/signin-qr/:short/status', async (req, res) => {
    if (adminOnly(req, res)) return;
    try {
      const t = (await q(`SELECT used_at, expires_at <= now() AS gone FROM bkk_login_tokens
                          WHERE short_code=$1 AND ip='qr'`, [req.params.short])).rows[0];
      if (!t) return res.status(404).json({ error: 'not found' });
      res.set('Cache-Control', 'no-store').json({ used: !!t.used_at, expired: !t.used_at && t.gone, usedAt: t.used_at });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
  // The desk closed the panel before a scan: a photo of the screen must not work
  // for the minutes left. A used QR keeps its used_at.
  app.post('/api/bkk/admin/signin-qr/:short/end', async (req, res) => {
    if (adminOnly(req, res)) return;
    try {
      const ended = (await q(`UPDATE bkk_login_tokens SET expires_at=now()
        WHERE short_code=$1 AND ip='qr' AND used_at IS NULL AND expires_at > now()`, [req.params.short])).rowCount > 0;
      if (!ended && !(await q(`SELECT 1 FROM bkk_login_tokens WHERE short_code=$1 AND ip='qr'`, [req.params.short])).rowCount) {
        return res.status(404).json({ error: 'not found' });
      }
      res.set('Cache-Control', 'no-store').json({ success: true, ended });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // The shala fixes an email (8 Oct: a sign-in link went to the wrong student,
  // who typed her own email into the other profile and then could not add it to
  // her own). Empty clears it. An email another profile holds moves only when
  // the request names that profile in takeFrom: a typo never silently steals one.
  // An address that leaves a profile takes its sign-in and receipt links with it,
  // or the person it belongs to could still open the profile it left.
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  // A link made on a profile merged into this one opens this one too.
  const stopLinks = (db, memberId, email) => db.query(
    `UPDATE bkk_login_tokens SET expires_at=now()
     WHERE member_id IN (SELECT id FROM bkk_members WHERE id=$1 OR merged_into=$1)
       AND lower(email)=$2 AND expires_at > now()`, [memberId, email]);
  app.post('/api/bkk/admin/members/:code/email', async (req, res) => {
    if (adminOnly(req, res)) return;
    const b = req.body || {};
    const email = String(b.email || '').trim().toLowerCase();
    if (email && !EMAIL_RE.test(email)) return res.status(400).json({ error: 'not an email address' });
    const clash = async () => {
      const o = (await q('SELECT code,name FROM bkk_members WHERE lower(email)=$1 AND code<>$2',
        [email, req.params.code])).rows[0];
      return o && res.status(409).json({ error: `that email is on ${o.name}'s profile (${o.code})`,
        owner: { code: o.code, name: o.name } });
    };
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // Lock both profiles in id order, so two crossed moves can't deadlock.
      const rows = (await client.query(
        `SELECT id,code,name,email FROM bkk_members
         WHERE code=$1 OR ($2 <> '' AND lower(email)=$2) ORDER BY id FOR UPDATE`,
        [req.params.code, email])).rows;
      const m = rows.find(r => r.code === req.params.code);
      if (!m) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'member not found' }); }
      const owner = rows.find(r => r !== m);
      if (owner) {
        if (b.takeFrom !== owner.code) { await client.query('ROLLBACK'); return clash(); }
        await client.query('UPDATE bkk_members SET email=NULL WHERE id=$1', [owner.id]);
        await stopLinks(client, owner.id, email);
      }
      const old = String(m.email || '').toLowerCase();
      if (old && old !== email) await stopLinks(client, m.id, old);
      await client.query('UPDATE bkk_members SET email=$2 WHERE id=$1', [m.id, email || null]);
      await client.query('COMMIT');
      console.log(`✓ bkk: email of ${m.code} ${email ? 'set' : 'cleared'} by admin${owner ? `, moved from ${owner.code}` : ''}`);
      res.json({ success: true, member: { code: m.code, name: m.name, email: email || null } });
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      // A student saved the same address a moment ago: same answer as a clash.
      if (e.code === '23505' && email && await clash()) return;
      res.status(500).json({ error: e.message });
    } finally { client.release(); }
  });

  // Change a student's name (Boonchu, 20 Nov 2026: a student goes by another
  // name). The old one is kept in former_names, so a search or an import by it
  // still finds this profile; a fix of capitals or spaces only keeps none.
  // { forget } takes one old name off (a rename made by mistake). A folded
  // code changes the profile it was folded into.
  // The desk's note on a student: one box, staff only. at: the saved time the page last saw, so a
  // second desk saving meanwhile is never written over (409 with what is saved now).
  const DESK_NOTE_MAX = 2000;
  app.post('/api/bkk/admin/members/:code/note', async (req, res) => {
    if (adminOnly(req, res)) return;
    const b = req.body || {};
    // Pasted from Word or PowerPoint: their soft breaks become line breaks, other invisible characters go.
    const note = String(b.note ?? '').replace(/\r\n?/g, '\n').replace(/[\u000b\u000c]/g, '\n')
      .replace(/[\u0000-\u0008\u000e-\u001f\u007f]/g, '').trim();
    if (note.length > DESK_NOTE_MAX)
      return res.status(400).json({ error: `a note is up to ${DESK_NOTE_MAX} characters` });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const cols = 'id, code, desk_note, desk_note_at, merged_into';
      let m = (await client.query(`SELECT ${cols} FROM bkk_members WHERE code=$1 FOR UPDATE`, [String(req.params.code || '')])).rows[0];
      for (let hop = 0; m && m.merged_into && hop < 10; hop++)
        m = (await client.query(`SELECT ${cols} FROM bkk_members WHERE id=$1 FOR UPDATE`, [m.merged_into])).rows[0];
      if (!m || m.merged_into) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'member not found' }); }
      const ms = v => v == null || v === '' ? null : new Date(v).getTime();
      if ('at' in b && ms(b.at) !== ms(m.desk_note_at)) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'Someone changed this note meanwhile. This is what is saved now.', changed: true,
          code: m.code, note: m.desk_note, at: m.desk_note_at });
      }
      const r = (await client.query(`UPDATE bkk_members SET desk_note=$2::text,
          desk_note_at=CASE WHEN $2::text IS NULL THEN NULL ELSE now() END WHERE id=$1 RETURNING code, desk_note, desk_note_at`,
        [m.id, note || null])).rows[0];
      await client.query('COMMIT');
      res.json({ success: true, code: r.code, note: r.desk_note, at: r.desk_note_at });
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      res.status(500).json({ error: e.message });
    } finally { client.release(); }
  });
  app.post('/api/bkk/admin/members/:code/name', async (req, res) => {
    if (adminOnly(req, res)) return;
    const b = req.body || {};
    const key = s => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();
    const forget = b.forget != null && b.name == null ? key(b.forget) : null;
    const name = String(b.name || '').replace(/\s+/g, ' ').trim();
    if (forget === null && (!name || name.length > 80 || /[\u0000-\u001f\u007f<>]/.test(name)))
      return res.status(400).json({ error: 'a name is 1 to 80 characters, without < or >' });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // Locked by code, then along merged_into: a merge landing meanwhile is followed, never written past.
      const cols = 'id, code, name, former_names, merged_into';
      let m = (await client.query(`SELECT ${cols} FROM bkk_members WHERE code=$1 FOR UPDATE`, [String(req.params.code || '')])).rows[0];
      for (let hop = 0; m && m.merged_into && hop < 10; hop++)
        m = (await client.query(`SELECT ${cols} FROM bkk_members WHERE id=$1 FOR UPDATE`, [m.merged_into])).rows[0];
      if (!m || m.merged_into) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'member not found' }); }
      const now = forget === null ? name : m.name;
      const was = (m.former_names || []).filter(n => key(n) !== key(now) && key(n) !== forget);
      if (forget === null && m.name && key(m.name) !== key(name) && !was.some(n => key(n) === key(m.name))) was.push(m.name);
      const r = (await client.query('UPDATE bkk_members SET name=$2, former_names=$3 WHERE id=$1 RETURNING code, name, former_names',
        [m.id, now, was.length ? was : null])).rows[0];
      await client.query('COMMIT');
      console.log(`✓ bkk: ${forget === null ? 'name' : 'an old name'} of ${r.code} changed by admin`);
      res.json({ success: true, member: { code: r.code, name: r.name, formerNames: r.former_names || [] } });
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      if (e.code === '40P01') return res.status(409).json({ error: 'this profile was being merged at the same moment: try again' });
      res.status(500).json({ error: e.message });
    } finally { client.release(); }
  });

  // The member code in a browser IS the sign-in: whoever opened a profile keeps
  // it. When the wrong person got in, give the profile a new code and stop all
  // its sign-in links, in one transaction, so every phone is signed out and the
  // real owner gets a new link. clearEmail also removes an email that belongs to
  // the wrong person; left on, it would let her sign straight back in.
  // Bookings, passes, photos and journal hang off the member id, not the code.
  app.post('/api/bkk/admin/members/:code/signout', async (req, res) => {
    if (adminOnly(req, res)) return;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const m = (await client.query('SELECT id,name,email FROM bkk_members WHERE code=$1 AND merged_into IS NULL FOR UPDATE',
        [req.params.code])).rows[0];
      if (!m) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'member not found' }); }
      // A profile merged into this one still opens it with its own code, email
      // and links, so they are signed out with it.
      const folded = (await client.query('SELECT id,email FROM bkk_members WHERE merged_into=$1 ORDER BY merged_at, id FOR UPDATE',
        [m.id])).rows;
      // A profile with an email needs M's answer about THAT email (keep or
      // remove), given against what it is now, not a search from before the
      // wrong person typed hers in (8 Oct review: the stale screen let her back).
      const b = req.body || {};
      const mails = [m, ...folded].map(x => x.email).filter(Boolean);
      const now = mails.length ? mails.join(', ').toLowerCase() : null;
      const saw = b.expectEmail ? String(b.expectEmail).toLowerCase() : null;
      if (now && (saw !== now || typeof b.clearEmail !== 'boolean')) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: `${m.name}'s profile has the email ${mails.join(', ')}: keep it or remove it?`,
          needEmailDecision: true, email: mails.join(', ') });
      }
      const ids = [m.id, ...folded.map(x => x.id)];
      const links = await client.query(`UPDATE bkk_login_tokens SET expires_at=now()
                                        WHERE member_id = ANY($1::int[]) AND expires_at > now()`, [ids]);
      const clear = !!now && b.clearEmail === true;
      const code = (await client.query(
        `UPDATE bkk_members SET code=$2${clear ? ', email=NULL' : ''} WHERE id=$1 RETURNING code`,
        [m.id, memberCode()])).rows[0].code;
      for (const x of folded) {
        await client.query(`UPDATE bkk_members SET code=$2${clear ? ', email=NULL' : ''} WHERE id=$1`, [x.id, memberCode()]);
      }
      await client.query('COMMIT');
      console.log(`✓ bkk: ${req.params.code} signed out everywhere, now ${code} (${links.rowCount} links stopped${clear ? ', email removed' : ''})`);
      res.json({ success: true, member: { code, name: m.name, email: clear ? null : m.email },
        linksStopped: links.rowCount, removedEmail: clear ? mails.join(', ') : undefined });
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      res.status(500).json({ error: e.message });
    } finally { client.release(); }
  });

  // Two profiles for one student. :code stays and keeps its code; body.from is
  // folded into it. Passes, payments, classes, notes, checks and photo tags move
  // across; an email, phone, face photo, journal or language the kept one lacks
  // moves too. The folded one stays as a pointer (merged_into): its code, email,
  // sign-in links and Rezerv id open the kept one while the merge stands, and
  // merge_log is what undo puts back.
  // dryRun runs the same steps and rolls back. Two different emails or phones
  // may be two people with one name: that needs sure:true.
  const MERGE_FIELDS = ['email', 'phone', 'photo_id', 'photo_at', 'journal_id', 'lang', 'desk_note', 'desk_note_at'];
  const last9 = s => { const d = String(s || '').replace(/\D/g, ''); return d.length >= 9 ? d.slice(-9) : ''; };
  const mergeWho = m => ({ code: m.code, name: m.name, email: m.email, phone: m.phone, rezervId: m.rezerv_id,
    source: m.source || 'aybkk', created: m.created_at });
  app.post('/api/bkk/admin/members/:code/merge', async (req, res) => {
    if (adminOnly(req, res)) return;
    const b = req.body || {};
    const from = String(b.from || '').trim().toUpperCase();
    if (!from || from === req.params.code) return res.status(400).json({ error: 'from: the code of the other profile' });
    const client = await pool.connect();
    const stop = async (status, body) => { await client.query('ROLLBACK'); res.status(status).json(body); };
    try {
      await client.query('BEGIN');
      const rows = (await client.query(`SELECT *, to_char(joined_on,'YYYY-MM-DD') AS joined FROM bkk_members
        WHERE code = ANY($1::text[]) ORDER BY id FOR UPDATE`, [[req.params.code, from]])).rows;
      const keep = rows.find(m => m.code === req.params.code), fold = rows.find(m => m.code === from);
      if (!keep || !fold) return await stop(404, { error: 'member not found' });
      if (keep.merged_into || fold.merged_into) return await stop(409, { error: 'already merged into another profile' });
      const differs = [];
      if (keep.email && fold.email && keep.email.toLowerCase() !== fold.email.toLowerCase()) differs.push('email');
      if (last9(keep.phone) && last9(fold.phone) && last9(keep.phone) !== last9(fold.phone)) differs.push('phone');
      const seen = { keep: mergeWho(keep), fold: mergeWho(fold), differs };
      if (differs.length && b.sure !== true && b.dryRun !== true) {
        return await stop(409, { error: `different ${differs.join(' and ')}: two people? Send sure:true if it is one student.`,
          needSure: true, ...seen });
      }
      const K = keep.id, F = fold.id;
      const ids = r => r.rows.map(x => x.id);
      const log = { keep: K, rows: {}, seats: [], fields: {}, refolded: [], mails: fold.email ? [fold.email] : [] };

      // One class booked on both: keep the seat that was checked in, else the one
      // staff took from a pass, else the one made here (not the Rezerv copy), else
      // the kept profile's. The other is cancelled, and a class it took off a
      // pass goes back.
      const both = (await client.query(
        `SELECT f.id AS f, k.id AS k, f.checked_in_at IS NOT NULL AS f_in, k.checked_in_at IS NOT NULL AS k_in,
           f.source = 'rezerv' AS f_rz, k.source = 'rezerv' AS k_rz, f.pass_id AS f_pass, k.pass_id AS k_pass,
           f.moved_at IS NOT NULL AS f_mv, k.moved_at IS NOT NULL AS k_mv
         FROM bkk_bookings f JOIN bkk_bookings k ON k.member_id=$1 AND k.slot_id=f.slot_id
           AND k.class_date=f.class_date AND k.status='booked'
         WHERE f.member_id=$2 AND f.status='booked'`, [K, F])).rows;
      for (const s of both) {
        // A Rezerv class staff took from a pass counts as made here: it is the paid one.
        const dropK = (s.f_in && !s.k_in) || (s.f_in === s.k_in && (s.f_mv !== s.k_mv ? s.f_mv : s.k_rz && !s.f_rz));
        const drop = dropK ? s.k : s.f, kept = dropK ? s.f : s.k, pass = dropK ? s.k_pass : s.f_pass;
        await client.query(`UPDATE bkk_bookings SET status='cancelled', cancelled_at=now(), cancel_reason=$2 WHERE id=$1`,
          [drop, `merged: same class as booking ${kept}`]);
        const mv = dropK ? s.k_mv : s.f_mv;
        if (mv && pass) await client.query('SELECT 1 FROM bkk_passes WHERE id=$1 FOR UPDATE', [pass]);
        const kept0 = mv && await moveAbsorbed(client, drop);
        const back = pass && !kept0 ? (await client.query(`UPDATE bkk_passes SET credits_used = credits_used - 1
          WHERE id=$1 AND kind <> 'unlimited' AND credits_used > 0 RETURNING id`, [pass])).rows.length > 0 : false;
        log.seats.push({ id: drop, pass: back ? pass : null });
      }
      const moveAll = t => client.query(`UPDATE ${t} SET member_id=$1 WHERE member_id=$2 RETURNING id`, [K, F]).then(ids);
      log.rows.bkk_orders = await moveAll('bkk_orders');
      log.rows.bkk_passes = await moveAll('bkk_passes');
      log.rows.bkk_bookings = await moveAll('bkk_bookings');
      log.rows.bkk_notes = await moveAll('bkk_notes');
      log.rows.bkk_consents = await moveAll('bkk_consents');
      // One a day, one tag a photo: what the kept profile already has stays put.
      log.rows.bkk_checks = await client.query(`UPDATE bkk_checks SET member_id=$1 WHERE member_id=$2
        AND taken_on NOT IN (SELECT taken_on FROM bkk_checks WHERE member_id=$1) RETURNING id`, [K, F]).then(ids);
      log.rows.bkk_photo_members = (await client.query(`UPDATE bkk_photo_members SET member_id=$1 WHERE member_id=$2
        AND photo_id NOT IN (SELECT photo_id FROM bkk_photo_members WHERE member_id=$1) RETURNING photo_id`, [K, F]))
        .rows.map(x => x.photo_id);

      const take = MERGE_FIELDS.filter(k => fold[k] != null && keep[k] == null && (k !== 'photo_at' || keep.photo_id == null)
        && (k !== 'desk_note_at' || keep.desk_note == null));
      if (take.length) {
        for (const k of take) log.fields[k] = fold[k];
        // Off the folded one first: email and journal are unique.
        await client.query(`UPDATE bkk_members SET ${take.map(k => `${k}=NULL`).join(', ')} WHERE id=$1`, [F]);
        await client.query(`UPDATE bkk_members SET ${take.map((k, i) => `${k}=$${i + 2}`).join(', ')} WHERE id=$1`,
          [K, ...take.map(k => fold[k])]);
      }
      // Joined: the earlier day is when this student first came.
      if (fold.joined && (!keep.joined || fold.joined < keep.joined)) {
        log.fields.joined_was = keep.joined;
        await client.query('UPDATE bkk_members SET joined_on=$2::date WHERE id=$1', [K, fold.joined]);
      }
      log.refolded = await client.query('UPDATE bkk_members SET merged_into=$1 WHERE merged_into=$2 RETURNING id', [K, F]).then(ids);
      await client.query('UPDATE bkk_members SET merged_into=$1, merged_at=now(), merge_log=$3 WHERE id=$2', [K, F, log]);

      const out = { success: true, dryRun: b.dryRun === true, ...seen,
        moved: Object.fromEntries(Object.entries(log.rows).map(([t, v]) => [t.replace('bkk_', ''), v.length])),
        seatsCancelled: log.seats.length, fieldsTaken: Object.keys(log.fields).filter(k => k !== 'photo_at'),
        left: (await client.query(`SELECT (SELECT count(*)::int FROM bkk_checks WHERE member_id=$1) AS checks,
          (SELECT count(*)::int FROM bkk_photo_members WHERE member_id=$1) AS photos`, [F])).rows[0],
        journalLeft: !!(fold.journal_id && keep.journal_id) };
      await client.query(b.dryRun === true ? 'ROLLBACK' : 'COMMIT');
      if (!out.dryRun) console.log(`✓ bkk: ${fold.code} merged into ${keep.code} (${JSON.stringify(out.moved)})`);
      res.json(out);
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      res.status(500).json({ error: e.message });
    } finally { client.release(); }
  });

  // Undo a merge: :code is the folded profile. Each row recorded in merge_log
  // goes back, and so does each field, if the kept profile still holds it. What
  // was bought since through the folded email goes back too, and a class booked
  // since goes with the pass that paid for it. Several merges into one profile
  // come undone newest first.
  app.post('/api/bkk/admin/members/:code/unmerge', async (req, res) => {
    if (adminOnly(req, res)) return;
    const client = await pool.connect();
    const stop = async (status, body) => { await client.query('ROLLBACK'); res.status(status).json(body); };
    try {
      await client.query('BEGIN');
      const f = (await client.query(`SELECT *, to_char(joined_on,'YYYY-MM-DD') AS joined FROM bkk_members
        WHERE code=$1 FOR UPDATE`, [req.params.code])).rows[0];
      if (!f) return await stop(404, { error: 'member not found' });
      const L = f.merge_log;
      if (!f.merged_into || !L) return await stop(409, { error: 'this profile was not merged' });
      if (L.keep !== f.merged_into) return await stop(409, { error: 'the kept profile was merged again since: undo that one first' });
      const K = L.keep, F = f.id;
      await client.query('SELECT 1 FROM bkk_members WHERE id=$1 FOR UPDATE', [K]);
      if ((await client.query('SELECT 1 FROM bkk_members WHERE merged_into=$1 AND id<>$2 AND merged_at > $3',
        [K, F, f.merged_at])).rows.length) return await stop(409, { error: 'another profile was merged into this one since: undo that one first' });
      const ids = r => r.rows.map(x => x.id);
      for (const t of ['bkk_orders', 'bkk_passes', 'bkk_bookings', 'bkk_notes', 'bkk_checks', 'bkk_consents']) {
        await client.query(`UPDATE ${t} SET member_id=$1 WHERE member_id=$2 AND id = ANY($3::int[])`, [F, K, L.rows[t] || []]);
      }
      await client.query(`UPDATE bkk_photo_members SET member_id=$1 WHERE member_id=$2 AND photo_id = ANY($3::int[])`,
        [F, K, L.rows.bkk_photo_members || []]);
      // Everything this undo takes back: the folded profile and the ones merged
      // into it before (they point back at it below), with every email they had.
      const fam = [F, ...(L.refolded || [])];
      const theirs = (await client.query(`SELECT email, merge_log FROM bkk_members WHERE id = ANY($1::int[])`, [L.refolded || []])).rows;
      const mails = [f.email, (L.fields || {}).email, ...(L.mails || []),
        ...theirs.flatMap(x => [x.email, x.merge_log && x.merge_log.fields && x.merge_log.fields.email, ...((x.merge_log || {}).mails || [])])]
        .filter(Boolean).map(e => String(e).toLowerCase());
      const since = { orders: await client.query(`UPDATE bkk_orders SET member_id=$1 WHERE member_id=$2
        AND (mail_to = ANY($3::text[]) OR (source='rezerv' AND via_member = ANY($4::int[]))) RETURNING id`, [F, K, mails, fam]).then(ids) };
      since.passes = await client.query(`UPDATE bkk_passes SET member_id=$1 WHERE member_id=$2
        AND (order_id = ANY($3::int[]) OR (source='rezerv' AND via_member = ANY($4::int[]))) RETURNING id`,
        [F, K, [...(L.rows.bkk_orders || []), ...since.orders], fam]).then(ids);
      // A checkout's tick goes back with its order: one made with the folded email since, or one
      // paid since on an order the merge moved (activateOrder writes it on whoever holds the order).
      since.consents = await client.query(`UPDATE bkk_consents SET member_id=$1 WHERE member_id=$2 AND order_id = ANY($3::int[])
        RETURNING id`, [F, K, [...(L.rows.bkk_orders || []), ...since.orders]]).then(ids);
      since.visits = await client.query(`UPDATE bkk_bookings b SET member_id=$1 WHERE b.member_id=$2 AND b.source='rezerv'
        AND b.via_member = ANY($3::int[]) AND NOT (b.status='booked' AND EXISTS (SELECT 1 FROM bkk_bookings o WHERE o.member_id=$1
          AND o.slot_id=b.slot_id AND o.class_date=b.class_date AND o.status='booked')) RETURNING b.id`, [F, K, fam]).then(ids);
      // A class goes with the pass that paid for it, unless that student already holds a seat in it,
      // or it is the kept student's own Rezerv-covered class staff took from it (it stays with them; below).
      since.bookings = await client.query(`UPDATE bkk_bookings b SET member_id=$1 WHERE b.member_id=$2 AND b.pass_id = ANY($3::int[])
        AND NOT (b.status='booked' AND EXISTS (SELECT 1 FROM bkk_bookings o WHERE o.member_id=$1 AND o.slot_id=b.slot_id
          AND o.class_date=b.class_date AND o.status='booked'))
        AND NOT (b.moved_at IS NOT NULL AND NOT (b.id = ANY($4::int[]))
          AND (b.via_member IS NULL OR NOT b.via_member = ANY($5::int[]))) RETURNING b.id`,
        [F, K, [...(L.rows.bkk_passes || []), ...since.passes], L.rows.bkk_bookings || [], fam]).then(ids);
      // A Rezerv copy and the sale it copies belong to one student. A pair this
      // undo leaves on two profiles was paired across two people while merged: the
      // Rezerv pass kept void for the other one's pass is live again (no pass
      // lost), and the ฿0 Rezerv line is no longer that sale's twin (it stays ฿0).
      // The classes and start day the import put on the pass kept come off it
      // first: they were the other student's. One Rezerv payment voided as
      // imported twice, with its copy now on the other profile, is a payment again.
      // A Rezerv class staff took from a pass, now on another profile than that
      // pass (still on the list, or cancelled with the class kept used): it stays
      // with its student, back on Rezerv. Picked before the split below, so the
      // split never dates the pass from it.
      const apart = (await client.query(`SELECT b.id, b.pass_id, to_char(b.class_date,'YYYY-MM-DD') AS d
        FROM bkk_bookings b JOIN bkk_passes p ON p.id=b.pass_id
        WHERE b.moved_at IS NOT NULL AND b.member_id = ANY($1::int[]) AND p.member_id = ANY($1::int[]) AND b.member_id <> p.member_id
          AND (b.status='booked' OR (b.status='cancelled' AND coalesce(b.cancel_reason, '') NOT LIKE 'merged:%'))
        FOR UPDATE OF b`, [[K, ...fam]])).rows;
      const across = `((r.member_id=$1 AND a.member_id=$2) OR (r.member_id=$2 AND a.member_id=$1))`;
      const split = (await client.query(`SELECT r.id AS rid, a.id AS aid FROM bkk_passes r JOIN bkk_passes a ON a.id=r.twin_of
        WHERE r.source='rezerv' AND ${across}`, [F, K])).rows;
      await twinCarryBack(client, split.map(x => x.rid), apart.map(x => x.id));
      const twinsBack = await twinPassBack(client, split.map(x => x.aid),
        `the aybkk.net pass it was kept void for is on another profile since a merge was undone on ${bkkToday()}`);
      const twinsOff = (await client.query(`UPDATE bkk_orders r SET status='paid', twin_of=NULL,
          gateway_note = regexp_replace(coalesce(r.gateway_note,''), '^entered in Rezerv for check-in; paid on aybkk\\.net ref ',
            'not the twin of aybkk.net ref ') || ' | that sale is on another profile since a merge was undone on ' || $3
        FROM bkk_orders a WHERE a.id=r.twin_of AND r.source='rezerv' AND r.status='twin' AND ${across} RETURNING r.id`,
        [F, K, bkkToday()])).rows.length;
      const paysBack = (await client.query(`UPDATE bkk_orders r SET status = CASE WHEN r.amount_thb < 0 THEN 'refund' ELSE 'paid' END,
          gateway_note = regexp_replace(r.gateway_note, '^same Rezerv payment as order (\\d+), imported twice',
            'not the same Rezerv payment as order \\1') || ' | that order is on another profile since a merge was undone on ' || $3
        FROM bkk_orders a WHERE a.source='rezerv' AND r.source='rezerv' AND r.status='void'
          AND r.gateway_note LIKE 'same Rezerv payment as order ' || a.refno::text || ', imported twice%' AND ${across} RETURNING r.id`,
        [F, K, bkkToday()])).rows.length;
      // Now, with the pairs this undo splits taken apart, the pass gets each such
      // class back unless a Rezerv copy still paired with it may have counted it.
      // So does a cancelled one kept used on its own student's pass for a copy
      // this undo took apart.
      const moves = { undone: 0, keptUsed: 0, givenBack: 0 };
      const loose = (await client.query(`SELECT b.id, b.pass_id, to_char(b.class_date,'YYYY-MM-DD') AS d FROM bkk_bookings b
        WHERE b.moved_at IS NOT NULL AND b.status='cancelled' AND coalesce(b.cancel_reason, '') NOT LIKE 'merged:%'
          AND b.pass_id = ANY($1::int[]) AND NOT (b.id = ANY($2::int[])) FOR UPDATE`, [split.map(x => x.aid), apart.map(x => x.id)])).rows;
      for (const u of loose) {
        await client.query('SELECT 1 FROM bkk_passes WHERE id=$1 FOR UPDATE', [u.pass_id]);
        if (await moveAbsorbed(client, u.id)) continue;
        await client.query(`UPDATE bkk_passes SET credits_used = GREATEST(0, credits_used - 1),
            note = coalesce(note || ' | ', '') || $2 WHERE id=$1 AND kind <> 'unlimited'`,
          [u.pass_id, `cancelled class ${u.d} given back: the Rezerv copy that kept it used went with a merge undone on ${bkkToday()}`]);
        await client.query(`UPDATE bkk_bookings SET pass_id=NULL, cover='rezerv', moved_at=NULL WHERE id=$1`, [u.id]);
        moves.givenBack++;
      }
      for (const u of apart) {
        await client.query('SELECT 1 FROM bkk_passes WHERE id=$1 FOR UPDATE', [u.pass_id]);
        const kept = await moveAbsorbed(client, u.id);
        if (kept) moves.keptUsed++;
        else await client.query(`UPDATE bkk_passes SET credits_used = GREATEST(0, credits_used - 1) WHERE id=$1 AND kind <> 'unlimited'`, [u.pass_id]);
        await client.query(`UPDATE bkk_passes SET note = coalesce(note || ' | ', '') || $2 WHERE id=$1`, [u.pass_id,
          `class ${u.d} put back on Rezerv${kept ? ', still used (a Rezerv copy may have counted it)' : ''}: another student's, as a merge was undone on ${bkkToday()}`]);
        await client.query(`UPDATE bkk_bookings SET pass_id=NULL, cover='rezerv', moved_at=NULL WHERE id=$1`, [u.id]);
        moves.undone++;
      }
      // A seat the merge cancelled comes back only if its student holds no other
      // seat in that class now, and its pass still has the class to give. One staff
      // took from a pass now on another profile comes back as a Rezerv class: the
      // merge gave its class back already.
      let seatsNotBack = 0;
      for (const s of L.seats || []) {
        const seat = (await client.query(`SELECT b.slot_id, to_char(b.class_date,'YYYY-MM-DD') AS d, b.start_at > now() AS ahead,
            b.moved_at IS NOT NULL AND (SELECT p.member_id FROM bkk_passes p WHERE p.id=b.pass_id) IS DISTINCT FROM b.member_id AS apart
          FROM bkk_bookings b WHERE b.id=$1 AND b.status='cancelled' AND b.cancel_reason LIKE 'merged:%'
            AND NOT EXISTS (SELECT 1 FROM bkk_bookings o WHERE o.member_id=b.member_id AND o.slot_id=b.slot_id
              AND o.class_date=b.class_date AND o.status='booked')`, [s.id])).rows[0];
        let can = !!seat;
        // A class still to come takes the seat only if it still runs and has room, as any booking.
        if (can && seat.ahead && seat.slot_id) {
          await client.query('SELECT pg_advisory_xact_lock($1::int, $2::int)', [seat.slot_id, Number(seat.d.replace(/-/g, ''))]);
          const c = (await client.query(`SELECT coalesce(o.cancelled, false) AS off, coalesce(o.capacity, s.capacity) AS cap
            FROM bkk_class_slots s LEFT JOIN bkk_class_overrides o ON o.slot_id=s.id AND o.class_date=$2 WHERE s.id=$1`,
            [seat.slot_id, seat.d])).rows[0];
          can = !!c && !c.off && (await seatsTaken(client, seat.slot_id, seat.d)) < c.cap;
        }
        if (can && s.pass && !seat.apart) can = (await client.query(`UPDATE bkk_passes SET credits_used = credits_used + 1
          WHERE id=$1 AND (kind='unlimited' OR credits_used < credits_total) RETURNING id`, [s.pass])).rows.length > 0;
        if (!can) { seatsNotBack++; continue; }
        await client.query(`UPDATE bkk_bookings SET status='booked', cancelled_at=NULL, cancel_reason=NULL${seat.apart
          ? `, pass_id=NULL, cover='rezerv', moved_at=NULL` : ''} WHERE id=$1`, [s.id]);
      }
      const back = MERGE_FIELDS.filter(k => k in (L.fields || {}));
      const keepNow = (await client.query('SELECT * FROM bkk_members WHERE id=$1', [K])).rows[0];
      const still = back.filter(k => String(keepNow[k] ?? '') === String(L.fields[k] ?? '')
        || (k === 'photo_at' && back.includes('photo_id') && keepNow.photo_id === L.fields.photo_id)
        || (k === 'desk_note_at' && back.includes('desk_note') && keepNow.desk_note === L.fields.desk_note));
      if (still.length) {
        await client.query(`UPDATE bkk_members SET ${still.map(k => `${k}=NULL`).join(', ')} WHERE id=$1`, [K]);
        await client.query(`UPDATE bkk_members SET ${still.map((k, i) => `${k}=$${i + 2}`).join(', ')} WHERE id=$1`,
          [F, ...still.map(k => L.fields[k])]);
      }
      if ('joined_was' in (L.fields || {})) {
        await client.query('UPDATE bkk_members SET joined_on=$2::date WHERE id=$1 AND joined_on=$3::date', [K, L.fields.joined_was, f.joined]);
      }
      await client.query('UPDATE bkk_members SET merged_into=$1 WHERE merged_into=$2 AND id = ANY($3::int[])', [F, K, L.refolded || []]);
      await client.query('UPDATE bkk_members SET merged_into=NULL, merged_at=NULL, merge_log=NULL WHERE id=$1', [F]);
      await client.query('COMMIT');
      console.log(`✓ bkk: ${f.code} taken back out of member ${K}`);
      res.json({ success: true, code: f.code, fieldsBack: still.filter(k => k !== 'photo_at'),
        fieldsKept: back.filter(k => !still.includes(k) && k !== 'photo_at'), seatsNotBack, moves,
        since: Object.fromEntries(Object.entries(since).map(([k, v]) => [k, v.length])),
        twinsUndone: { passes: twinsBack.length, orders: twinsOff, payments: paysBack } });
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      res.status(500).json({ error: e.message });
    } finally { client.release(); }
  });

  // The student's own proof check. Same trust as the rest of /me: the member
  // code the signed-in browser holds.
  app.get('/api/bkk/me/:code/checks', async (req, res) => {
    try {
      const m = await memberByCode(req.params.code);
      if (!m) return res.status(404).json({ error: 'not found' });
      const r = await q(
        `SELECT to_char(taken_on,'YYYY-MM-DD') AS date, resting_hr, sleep_hours, feel, note
         FROM bkk_checks WHERE member_id=$1 ORDER BY taken_on`, [m.id]);
      res.json({ checks: r.rows.map(c => ({ date: c.date, restingHr: c.resting_hr,
        sleepHours: c.sleep_hours == null ? null : Number(c.sleep_hours), feel: c.feel, note: c.note })) });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.post('/api/bkk/me/:code/checks', async (req, res) => {
    try {
      const m = await memberByCode(req.params.code);
      if (!m) return res.status(404).json({ error: 'not found' });
      const b = req.body || {};
      const hr = b.restingHr === '' || b.restingHr == null ? null : Number(b.restingHr);
      const sleep = b.sleepHours === '' || b.sleepHours == null ? null : Number(b.sleepHours);
      const feel = b.feel === '' || b.feel == null ? null : Number(b.feel);
      if (hr != null && !(Number.isInteger(hr) && hr >= 30 && hr <= 200)) return res.status(400).json({ error: 'resting heart rate must be 30 to 200' });
      if (sleep != null && !(sleep >= 0 && sleep <= 14)) return res.status(400).json({ error: 'sleep must be 0 to 14 hours' });
      if (feel != null && !(Number.isInteger(feel) && feel >= 1 && feel <= 5)) return res.status(400).json({ error: 'feel must be 1 to 5' });
      if (hr == null && sleep == null && feel == null) return res.status(400).json({ error: 'fill in at least one number' });
      await q(`INSERT INTO bkk_checks (member_id,taken_on,resting_hr,sleep_hours,feel,note)
               VALUES ($1,(now() AT TIME ZONE 'Asia/Bangkok')::date,$2,$3,$4,$5)
               ON CONFLICT (member_id,taken_on) DO UPDATE SET resting_hr=$2, sleep_hours=$3, feel=$4, note=$5`,
        [m.id, hr, sleep, feel, String(b.note || '').trim().slice(0, 300) || null]);
      res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // A signed-in student adds their email, so they can sign in again on another
  // phone. Only when none is set: changing one is a job for the shala.
  app.post('/api/bkk/me/:code/email', async (req, res) => {
    try {
      const email = String((req.body || {}).email || '').trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'not an email address' });
      const m = await memberByCode(req.params.code);
      if (!m) return res.status(404).json({ error: 'not found' });
      if (m.email) return res.status(409).json({ error: 'an email is already set; ask the shala to change it' });
      const taken = await q('SELECT 1 FROM bkk_members WHERE lower(email)=$1', [email]);
      if (taken.rows.length) return res.status(409).json({ error: 'that email belongs to another profile; ask the shala' });
      await q('UPDATE bkk_members SET email=$2 WHERE id=$1', [m.id, email]);
      res.json({ success: true });
    } catch (e) {
      if (e.code === '23505') return res.status(409).json({ error: 'that email belongs to another profile; ask the shala' });
      res.status(500).json({ error: e.message });
    }
  });

  // Opening the link (GET) never uses it up: LINE, WhatsApp and WeChat fetch every
  // link to draw a preview, which used up one-time tokens before the student ever
  // tapped (4 Oct). The page posts back to itself, which a preview bot never does.
  // Staff-made links (sent in a private chat) keep working until they expire, so a
  // second phone or a re-open is fine; emailed links stay one-time.
  // The code is handed to the browser, never put in a URL, so it stays out of history.
  const loginPage = (msg, extra = '', lang = 'en') => `<!DOCTYPE html><html lang="${lang}"><meta charset="utf-8">
<meta name="referrer" content="no-referrer">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>AYBKK</title>
<body style="font-family:-apple-system,sans-serif;background:#f7f1f5;color:#17121a;
text-align:center;padding:22vh 20px"><p>${msg}</p>${extra}</body></html>`;
  const live = `expires_at > now() AND (used_at IS NULL OR ip = 'staff')`;
  const usable = `token = $1 AND ${live}`;

  // ── the Monday letter (email sign-ups) ────────────────────────────────────
  // Double opt-in: the address joins only when its owner taps Confirm, so nobody
  // can sign up someone else. Every row came with the consent tick; asked_at and
  // confirmed_at date the latest consent, unsubscribed_at the latest withdrawal.
  // The answer never says whether an address is already on the list. The token
  // in every link is the only key; there is no login.
  const LETTER_LANGS = ['en', 'th', 'zh', 'ru'];
  const letterLang = v => (LETTER_LANGS.includes(String(v || '').slice(0, 2)) ? String(v).slice(0, 2) : 'en');
  const letterOk = { ok: true };
  app.post('/api/bkk/newsletter', async (req, res) => {
    const b = req.body || {};
    const email = String(b.email || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 200) {
      return res.status(400).json({ error: 'email' });
    }
    if (b.consent !== true) return res.status(400).json({ error: 'consent' });
    const lang = letterLang(b.lang);
    const src = String(b.src || '').toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 40) || null;
    try {
      const ip = clientIp(req);
      const sent = (await q(`SELECT count(*) FILTER (WHERE ip=$1 AND at > now() - interval '1 hour')::int AS ip,
          count(*) FILTER (WHERE at > now() - interval '1 hour')::int AS hour, count(*)::int AS day
        FROM bkk_letter_asks WHERE at > now() - interval '1 day'`, [ip])).rows[0];
      // Said out loud, not "check your inbox": a reader on a busy shared
      // network can come back later or take LINE.
      if (sent.ip >= LETTER_PER_IP_HOUR || sent.hour >= LETTER_PER_HOUR || sent.day >= LETTER_PER_DAY) {
        console.warn(`[bkk letter] throttled ${ip}`);
        return res.status(429).json({ error: 'busy' });
      }
      // Every ask gets a new token, so an old link (a forwarded letter's footer)
      // can never confirm a later ask. One address gets at most 3 confirm mails
      // a day, 10 minutes apart, except that someone who left can come back at
      // once. A confirmed reader is left alone.
      const row = (await q(
        `INSERT INTO bkk_newsletter (email,lang,src,token) VALUES ($1,$2,$3,$4)
         ON CONFLICT (email) DO UPDATE SET lang=EXCLUDED.lang, token=EXCLUDED.token, status='pending', asked_at=now(),
           asks = CASE WHEN bkk_newsletter.asked_at < now() - interval '1 day' THEN 1 ELSE bkk_newsletter.asks + 1 END
         WHERE bkk_newsletter.status <> 'confirmed'
           AND (bkk_newsletter.asks < ${LETTER_ASKS_PER_DAY} OR bkk_newsletter.asked_at < now() - interval '1 day')
           AND (bkk_newsletter.status = 'unsubscribed' OR bkk_newsletter.asked_at < now() - interval '10 minutes')
         RETURNING id, token`,
        [email, lang, src, crypto.randomBytes(24).toString('base64url')])).rows[0];
      if (row) {
        const t = render('letterConfirm', lang, { link: `${baseUrl()}/api/bkk/newsletter/confirm/${row.token}` });
        const r = await sendMail({ to: email, subject: t.subject, html: t.html, text: t.text, tag: 'letter-confirm' });
        if (!r.sent) {
          // Mail is off or Resend said no. Undo the ask so a retry goes straight
          // out, and tell the reader instead of sending them to an empty inbox.
          await q(`UPDATE bkk_newsletter SET asks = asks - 1, asked_at = now() - interval '11 minutes' WHERE id=$1`, [row.id]);
          return res.status(503).json({ error: 'mail' });
        }
        await q(`INSERT INTO bkk_letter_asks (ip) VALUES ($1)`, [ip]);
      }
      res.json(letterOk);
    } catch (e) {
      console.error('[bkk letter] sign-up failed:', e.message);
      res.status(500).json({ error: 'failed' });
    }
  });

  // The pages open in the language the reader signed up in.
  const LETTER_PAGE = {
    en: {
      confirm: 'Last step: tap the button to get the AYBKK Monday letter.',
      confirmBtn: 'Yes, send me the letter',
      confirmed: 'Thank you. You are on the list: the AYBKK letter comes every Monday.',
      leave: 'Stop the AYBKK Monday letter?',
      leaveBtn: 'Unsubscribe',
      left: 'Done. You will not get the letter any more. You can sign up again on aybkk.net any time.',
    },
    th: {
      confirm: 'ขั้นสุดท้าย: กดปุ่มด้านล่างเพื่อรับจดหมาย AYBKK ทุกวันจันทร์',
      confirmBtn: 'ยืนยัน ส่งจดหมายให้ฉัน',
      confirmed: 'ขอบคุณค่ะ คุณจะได้รับจดหมายจาก AYBKK ทุกวันจันทร์',
      leave: 'ยกเลิกการรับจดหมาย AYBKK ทุกวันจันทร์ใช่ไหม?',
      leaveBtn: 'ยกเลิกการรับจดหมาย',
      left: 'ยกเลิกเรียบร้อยแล้ว คุณจะไม่ได้รับจดหมายอีก สมัครใหม่ได้ที่ aybkk.net ทุกเมื่อ',
    },
    zh: {
      confirm: '最后一步：点击下方按钮，每周一收到 AYBKK 来信。',
      confirmBtn: '确认订阅',
      confirmed: '谢谢！订阅成功，AYBKK 来信每周一送达。',
      leave: '要退订 AYBKK 每周一来信吗？',
      leaveBtn: '退订',
      left: '已退订，您将不再收到来信。随时可以在 aybkk.net 重新订阅。',
    },
    ru: {
      confirm: 'Последний шаг: нажмите кнопку, чтобы получать письмо AYBKK по понедельникам.',
      confirmBtn: 'Да, присылайте письмо',
      confirmed: 'Спасибо! Вы подписаны: письмо AYBKK приходит каждый понедельник.',
      leave: 'Отписаться от письма AYBKK по понедельникам?',
      leaveBtn: 'Отписаться',
      left: 'Готово. Письмо больше не будет приходить. Подписаться снова можно на aybkk.net в любой момент.',
    },
  };
  const letterDead = () => loginPage('This link is not valid any more. You can sign up again on '
    + '<a href="/book#letter" style="color:#5c2160">aybkk.net</a>.<br>ลิงก์นี้ใช้ไม่ได้แล้ว สมัครใหม่ได้ที่ aybkk.net');
  const letterBtn = (label, bg) => `<form method="post"><button style="font:inherit;font-weight:700;padding:14px 22px;
border:0;border-radius:10px;background:${bg};color:#fff">${label}</button></form>`;
  // A confirm link works for 7 days; then the unconfirmed address is deleted.
  const confirmable = `(status = 'confirmed' OR (status = 'pending' AND asked_at > now() - interval '7 days'))`;
  const letterPurge = () => q(`DELETE FROM bkk_newsletter WHERE status='pending' AND asked_at < now() - interval '7 days'`)
    .then(() => q(`DELETE FROM bkk_letter_asks WHERE at < now() - interval '1 day'`))
    .catch(e => console.error('[bkk letter] purge failed:', e.message));
  setInterval(letterPurge, 24 * 3600 * 1000).unref();
  // GET only shows a page: mail scanners and chat previews open every link,
  // and some run its scripts, so confirming and leaving each take a real tap.
  app.get('/api/bkk/newsletter/confirm/:token', async (req, res) => {
    try {
      const row = (await q(`SELECT status, lang FROM bkk_newsletter WHERE token=$1 AND ${confirmable}`,
        [req.params.token])).rows[0];
      if (!row) return res.status(400).send(letterDead());
      const lang = letterLang(row.lang), p = LETTER_PAGE[lang];
      res.set('Cache-Control', 'no-store').send(row.status === 'confirmed'
        ? loginPage(p.confirmed, '', lang)
        : loginPage(p.confirm, letterBtn(p.confirmBtn, '#e8458c'), lang));
    } catch (e) { res.status(500).send(loginPage('Something went wrong. Please try again.')); }
  });
  app.post('/api/bkk/newsletter/confirm/:token', async (req, res) => {
    try {
      const r = await q(`UPDATE bkk_newsletter SET status='confirmed',
          confirmed_at = CASE WHEN status = 'pending' THEN now() ELSE confirmed_at END
        WHERE token=$1 AND ${confirmable} RETURNING lang`, [req.params.token]);
      if (!r.rows.length) return res.status(400).send(letterDead());
      const lang = letterLang(r.rows[0].lang);
      res.set('Cache-Control', 'no-store').send(loginPage(LETTER_PAGE[lang].confirmed, '', lang));
    } catch (e) { res.status(500).send(loginPage('Something went wrong. Please try again.')); }
  });
  app.get('/api/bkk/newsletter/unsubscribe/:token', async (req, res) => {
    try {
      const row = (await q(`SELECT lang FROM bkk_newsletter WHERE token=$1`, [req.params.token])).rows[0];
      if (!row) return res.status(400).send(letterDead());
      const lang = letterLang(row.lang), p = LETTER_PAGE[lang];
      res.set('Cache-Control', 'no-store').send(loginPage(p.leave, letterBtn(p.leaveBtn, '#5c2160'), lang));
    } catch (e) { res.status(500).send(loginPage('Something went wrong. Please try again.')); }
  });
  // Also the RFC 8058 one-click target: mail apps POST here straight from the
  // List-Unsubscribe header, so this must work with any body and no script.
  app.post('/api/bkk/newsletter/unsubscribe/:token', async (req, res) => {
    try {
      const r = await q(`UPDATE bkk_newsletter SET status='unsubscribed', unsubscribed_at=now()
        WHERE token=$1 RETURNING lang`, [req.params.token]);
      if (!r.rows.length) return res.status(400).send(letterDead());
      const lang = letterLang(r.rows[0].lang);
      res.set('Cache-Control', 'no-store').send(loginPage(LETTER_PAGE[lang].left, '', lang));
    } catch (e) { res.status(500).send(loginPage('Something went wrong. Please try again.')); }
  });
  const deadLink = () => loginPage('That link has already been used, or it has expired.<br>'
    + '<a href="/book" style="color:#5c2160">Ask for a new one</a>');

  // The short link a staff member sends: /in/<code> → the long link, which still
  // only shows the page, so a chat preview opening it uses nothing up. What stops
  // guessing is the code's length (31^10 ≈ 8e14, and a link lives 7 days); the
  // count below (in memory, one process on Railway) only slows one address
  // down and logs a run. Only a well-formed code nobody was given counts: an
  // expired or stopped one is a student tapping an old message, and a shared
  // wifi must not lock everyone out for it.
  const SHORT_RE = new RegExp(`^[${SHORT_ALPHABET}]{${SHORT_LEN}}$`);
  // cn.aybkk.net comes in through cloudflared in this container, so from localhost:
  // there Cloudflare sets cf-connecting-ip, and x-forwarded-for starts with whatever
  // the client sent. Railway's edge rewrites x-forwarded-for itself. The key is a
  // copy: a slice of the header would keep all of it (up to 16 KB) in memory.
  const guessIp = req => Buffer.from(String((/^(::ffff:)?127\.|^::1$/.test(req.socket?.remoteAddress || '')
    && req.headers['cf-connecting-ip']) || clientIp(req)).slice(0, 45)).toString();
  const HOUR_MS = 3600 * 1000;
  const shortMisses = new Map();                 // address → { start, n }
  const allMisses = { start: 0, n: 0 };
  const missesOf = ip => { const t = shortMisses.get(ip); return t && Date.now() - t.start < HOUR_MS ? t.n : 0; };
  const holdMiss = ip => {
    let t = shortMisses.get(ip);
    if (!t || Date.now() - t.start >= HOUR_MS) {
      if (shortMisses.size >= 5000) {
        for (const [k, v] of shortMisses) {      // make room, but never lift a block that is still running
          if (Date.now() - v.start >= HOUR_MS || v.n < SHORT_MISSES_PER_IP_HOUR) shortMisses.delete(k);
          if (shortMisses.size < 4000) break;
        }
      }
      shortMisses.delete(ip);
      shortMisses.set(ip, t = { start: Date.now(), n: 0 });
    }
    t.n++;
    return t;
  };
  // The same count for other doors (17 Nov 2026): wrong teacher passcodes and
  // the door tablet's pairing. limit tries per address in windowMs from the
  // first; past it, 429 until that window ends. hold() before the lookup, n--
  // after a good one, as holdMiss.
  const missCounter = (limit, windowMs) => {
    const seen = new Map();
    const live = t => !!t && Date.now() - t.start < windowMs;
    return {
      over: ip => { const t = seen.get(ip); return live(t) && t.n >= limit; },
      retryS: ip => { const t = seen.get(ip); return live(t) ? Math.ceil((t.start + windowMs - Date.now()) / 1000) : 0; },
      hold: ip => {
        let t = seen.get(ip);
        if (!live(t)) {
          if (seen.size >= 5000) {
            for (const [k, v] of seen) {
              if (!live(v) || v.n < limit) seen.delete(k);
              if (seen.size < 4000) break;
            }
          }
          seen.delete(ip);
          seen.set(ip, t = { start: Date.now(), n: 0 });
        }
        t.n++;
        return t;
      },
    };
  };
  app.get('/in/:code', async (req, res) => {
    const ip = guessIp(req);
    if (missesOf(ip) >= SHORT_MISSES_PER_IP_HOUR) {
      return res.status(429).type('text/plain').send('Too many wrong links. Please try again in an hour.');
    }
    if (!SHORT_RE.test(req.params.code)) return res.status(404).send(deadLink());
    // Counted before the lookup and given back after, so a burst cannot all pass the check at once.
    const t = holdMiss(ip);
    try {
      const row = (await q(`SELECT token, (${live}) AS ok FROM bkk_login_tokens WHERE short_code = $1`,
        [req.params.code])).rows[0];
      if (row) t.n--;
      else {
        if (Date.now() - allMisses.start >= HOUR_MS) Object.assign(allMisses, { start: Date.now(), n: 0 });
        if (++allMisses.n === SHORT_MISSES_HOUR) console.warn(`[bkk login] ${SHORT_MISSES_HOUR} unknown short codes this hour: someone may be guessing`);
      }
      if (!row || !row.ok) return res.status(400).send(deadLink());
      res.set({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' })
        .redirect(302, `/api/bkk/login/${row.token}`);
    } catch (e) {
      t.n--;
      console.error('[bkk login] short link failed:', e.message);
      res.status(500).send(loginPage('Something went wrong. Please try again.'));
    }
  });

  // The form names its own target: workers/china-proxy follows redirects itself,
  // so through it this page can arrive with /in/<code> as its address.
  app.get('/api/bkk/login/:token', async (req, res) => {
    try {
      const row = (await q(`SELECT token FROM bkk_login_tokens WHERE ${usable}`, [req.params.token])).rows[0];
      if (!row) return res.status(400).send(deadLink());
      res.set('Cache-Control', 'no-store').send(loginPage('Opening your AYBKK profile…',
        `<form method="post" action="/api/bkk/login/${row.token}" id="f"><button style="font:inherit;font-weight:700;padding:14px 22px;border:0;
border-radius:10px;background:#e8458c;color:#fff">Open my profile · เปิดโปรไฟล์</button></form>
<script>document.getElementById('f').submit()</script>`));
    } catch (e) {
      console.error('[bkk login] check failed:', e.message);
      res.status(500).send(loginPage('Something went wrong. Please try again.'));
    }
  });

  app.post('/api/bkk/login/:token', async (req, res) => {
    try {
      // One statement: a sign-out landing between "use the link" and "read the
      // code" would otherwise hand this browser the profile's brand-new code.
      const m = (await q(
        `UPDATE bkk_login_tokens SET used_at = COALESCE(used_at, now())
         FROM bkk_members mb WHERE mb.id = bkk_login_tokens.member_id AND ${usable}
         RETURNING mb.code`, [req.params.token])).rows[0];
      if (!m) return res.status(400).send(deadLink());
      res.set('Cache-Control', 'no-store').send(loginPage('Signing you in…',
        `<script>try{localStorage.setItem('aybkk_member',${JSON.stringify(m.code)})}catch(e){}
setTimeout(function(){location.replace('/book?me=1')},400)</script>`));
    } catch (e) {
      console.error('[bkk login] consume failed:', e.message);
      res.status(500).send(loginPage('Something went wrong. Please try again.'));
    }
  });

  // ── member view ───────────────────────────────────────────────────────────
  // Made on first use, then fixed for good, so every entry lands on one journal.
  async function journalId(m) {
    if (m.journal_id) return m.journal_id;
    await q(`UPDATE bkk_members SET journal_id=$2 WHERE id=$1 AND journal_id IS NULL`,
      [m.id, 'bkk-' + crypto.randomBytes(9).toString('base64url')]);
    return (await q('SELECT journal_id FROM bkk_members WHERE id=$1', [m.id])).rows[0].journal_id;
  }
  app.get('/api/bkk/me/:code', async (req, res) => {
    try {
      const m = await memberByCode(req.params.code);
      if (!m) return res.status(404).json({ error: 'not found' });
      const passes = (await q(
        `SELECT p.*, pr.name_en, pr.name_th, pr.code AS product_code,
           p.valid_until IS NOT NULL AND p.valid_until < $2::date AS ended
         FROM bkk_passes p JOIN bkk_products pr ON pr.id=p.product_id
         WHERE p.member_id=$1 ORDER BY p.id DESC`, [m.id, bkkToday()])).rows;
      // For the review ask in My account: study passes beyond the first. A single
      // class is a visit, not a stay, and a void pass was written off, except a
      // Rezerv pack that was used up before its end date: importPass stores it
      // void so it lets no one in, with "<Rezerv status> in Rezerv" in the note.
      const usedUp = p => p.status === 'void' && p.source === 'rezerv'
        && passState((/\| (.+?) in Rezerv/.exec(p.note || '') || [])[1]) === 'ended';
      const stays = passes.filter(p => (['active', 'frozen'].includes(p.status) || usedUp(p)) && p.product_code !== 'dropin'
        && !(p.kind === 'credits' && Number(p.credits_total) === 1)).length;
      // classDate is the Bangkok day as text: class_date comes back as a JS
      // Date, which a browser in another timezone can shift a day. bookings are
      // the classes to come; startedToday, today's seats in a class that has
      // begun, which the timetable still lists and marks as booked.
      const seats = (await q(
        `SELECT b.*, to_char(b.class_date,'YYYY-MM-DD') AS "classDate", s.title, s.start_time, s.is_online,
           b.start_at >= now() AS ahead FROM bkk_bookings b
         JOIN bkk_class_slots s ON s.id=b.slot_id
         WHERE b.member_id=$1 AND b.status='booked'
           AND (b.start_at >= now() OR b.class_date = (now() AT TIME ZONE 'Asia/Bangkok')::date)
         ORDER BY b.start_at`, [m.id])).rows;
      const bookings = seats.filter(b => b.ahead).map(({ ahead, ...b }) => b);
      const startedToday = seats.filter(b => !b.ahead).map(b => ({ id: b.id, slot_id: b.slot_id, classDate: b.classDate }));
      // Only what a teacher chose to share. Notes kept for the team never
      // appear here — the student is not the audience for all of them.
      const notes = (await q(
        `SELECT n.to_work_on, n.body, n.class_date, n.created_at, t.name AS teacher
         FROM bkk_notes n LEFT JOIN bkk_teachers t ON t.id=n.teacher_id
         WHERE n.member_id=$1 AND n.share_with_student
           AND (n.to_work_on IS NOT NULL OR n.body IS NOT NULL)
         ORDER BY n.created_at DESC LIMIT 10`, [m.id])).rows;
      // The habit proof: every class they came to, the ones moved over from
      // Rezerv included.
      const [count, recent] = await Promise.all([
        q(`SELECT count(*)::int AS practised, count(DISTINCT b.class_date)::int AS days,
             count(DISTINCT b.class_date) FILTER (WHERE date_trunc('month', b.class_date) = date_trunc('month', $2::date))::int AS this_month
           FROM bkk_bookings b WHERE b.member_id=$1 AND ${ATTENDED}`, [m.id, bkkToday()]),
        q(`SELECT to_char(b.class_date,'YYYY-MM-DD') AS date, ${VISIT_TIME} AS time, coalesce(s.title, b.class_title) AS class
           FROM bkk_bookings b LEFT JOIN bkk_class_slots s ON s.id=b.slot_id
           WHERE b.member_id=$1 AND ${ATTENDED}
           ORDER BY b.start_at DESC, b.id DESC LIMIT 10`, [m.id]),
      ]);
      const c = count.rows[0];
      // The agreement, once it is on: signed or not, and whether a guardian still has to come.
      const mode = await consentMode();
      const st = mode === 'off' ? null : await consentOf(pool, m);
      res.json({
        ...(st ? { consent: { mode, version: st.version, signed: st.signed, signedAt: st.signedAt, under20: st.under20,
          guardianSigned: st.guardianSigned } } : {}),
        member: { code: m.code, name: m.name, email: m.email, journalId: await journalId(m) },
        photo: faceLinks(m.photo_id, m.code),
        history: { practised: c.practised, days: c.days, thisMonth: c.this_month, recent: recent.rows },
        notes,
        // What the student holds: a void pass (written off, or a used-up Rezerv pack, which lets no one in)
        // never shows, and one whose last day has gone says it ended. Live ones first.
        passes: passes.filter(p => p.status !== 'void').sort((a, b) => a.ended - b.ended).map(p => ({
          name: p.name_en, nameTh: p.name_th, kind: p.kind, status: p.status, ended: p.ended,
          creditsLeft: p.kind === 'unlimited' ? null : (p.credits_total - p.credits_used),
          validFrom: p.valid_from, validUntil: p.valid_until, dailyCap: p.daily_cap,
        })),
        renewals: Math.max(0, stays - 1),
        bookings, startedToday,
      });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // The student signs the agreement on their own phone ('self'), with the same trust as every
  // /me/:code route: the code is the sign-in. Signing again changes nothing; a copy goes by email.
  app.post('/api/bkk/me/:code/consent', async (req, res) => {
    const b = req.body || {};
    if ((b.kind || 'agreement') !== 'agreement') return res.status(400).json({ error: 'kind must be agreement' });
    // Read before the transaction holds a client; every query after BEGIN goes through it.
    const mode = await consentMode();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const m0 = await memberByCode(req.params.code, client);
      if (!m0) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'not found' }); }
      // off: the page opened it while the switch was on; it closes the screen and goes on.
      if (mode === 'off') { await client.query('ROLLBACK'); return res.status(409).json({ error: 'the agreement is not on', off: true }); }
      const c = readConsent(b, { noTick: 400 });
      if (!c.value) { await client.query('ROLLBACK'); return res.status(c.status).json(c.body); }
      // One at a time per profile, so two taps never sign twice.
      const m = (await client.query('SELECT * FROM bkk_members WHERE id=$1 FOR UPDATE', [m0.id])).rows[0];
      let row = null;
      if (!(await consentOk(client, m.id))) row = await insertConsent(client, { memberId: m.id, name: c.value.name,
        under20: c.value.under20, lang: c.value.lang, via: 'self', email: m.email ? String(m.email).toLowerCase() : null });
      await client.query('COMMIT');
      if (row) emailAgreement(row.email_at, row).catch(e => console.error('[bkk] agreement copy failed:', e.message));
      const st = await consentOf(client, m);
      res.json({ success: true, already: !row, emailed: !!(row && m.email),
        consent: { mode, version: st.version, signed: st.signed, signedAt: st.signedAt,
          under20: st.under20, guardianSigned: st.guardianSigned } });
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      res.status(500).json({ error: e.message });
    } finally { client.release(); }
  });

  // ── booking ───────────────────────────────────────────────────────────────
  // Every way into a class goes through takeSeat: a student booking, staff
  // booking for someone, a walk-in added at the door, a paid drop-in. So every
  // one of them puts a name on the list and counts against the same capacity.

  const singleClass = pr => pr.kind === 'credits' && Number(pr.credits) === 1;
  const CLASS_ENDED = 'that class has already ended';
  // A visit moved from Rezerv that matched no slot is history as Rezerv kept it.
  const REZERV_READONLY = 'moved from Rezerv: it cannot be changed here';
  const seatsTaken = async (db, slotId, date) => (await db.query(
    `SELECT count(*)::int AS n FROM bkk_bookings
     WHERE slot_id=$1 AND class_date=$2 AND status='booked'`, [slotId, date])).rows[0].n;

  // Can this class take a name at all? The checks run in the order the student
  // booking always used, so its messages stay the same. The date must be the
  // slot's weekday: each weekday is its own slot with its own capacity and
  // overrides, so Tuesday's slot on a Friday would dodge Friday's full or
  // cancelled class. late (staff only): a class that is over still takes a
  // name, someone who came, for LATE_ADD_DAYS days; over says so.
  async function classCheck(db, slotId, date, { staff = false, endedMsg, late = false } = {}) {
    const slot = (await db.query('SELECT * FROM bkk_class_slots WHERE id=$1 AND active', [slotId])).rows[0];
    if (!slot) throw new Error('class not found');
    if (moonDaysBetween(date, date).size) throw new Error('moon day: the shala is closed');
    if (new Date(`${date}T12:00:00${TZ_OFFSET}`).getUTCDay() !== slot.weekday)
      throw new Error('that class is not on that day');
    const startAt = startAtISO(date, slot.start_time);
    // Students can book until bookCloseAt (BOOK_LATE_MIN after the start). Staff
    // can, for the whole length of the class: someone walks in at 05:35 and has
    // to be put on the list before they can be checked in.
    if (!staff && bkkNow().getTime() >= bookCloseAt(slot, date)) throw new Error(BOOK_CLOSED);
    if (!staff && date > await openUntil()) throw new Error('booking for that class is not open yet');
    const startedAgoMin = (bkkNow() - new Date(startAt)) / 60000;
    const graceMin = slot.duration_min || 120;
    const over = staff && startedAgoMin > graceMin;
    if (staff && startedAgoMin > graceMin && !late) throw new Error(endedMsg || 'that class has already started');
    if (over && date < bkkDaysAgo(LATE_ADD_DAYS)) throw new Error(`that class was more than ${LATE_ADD_DAYS} days ago`);

    const ov = (await db.query(
      'SELECT * FROM bkk_class_overrides WHERE slot_id=$1 AND class_date=$2', [slotId, date])).rows[0];
    if (ov && ov.cancelled) throw new Error('class cancelled');
    const capacity = (ov && ov.capacity != null) ? ov.capacity : slot.capacity;
    return { slot, startAt, capacity, over };
  }

  // Runs inside the caller's transaction; throws to refuse.
  //   staff     may book a class that has begun, until it ends
  //   allowOver past capacity: the person is standing in the room, or has paid
  //   cover     'pass' (an aybkk.net pass, passId to use one in particular),
  //             'rezerv' (no pass here), or null: only an existing seat counts
  //   source    'student' | 'staff' | 'door' | 'order'
  //   requestId the door's id for this add: a seat already carrying it is the
  //             same add sent twice (out.repeat), even for a second new profile
  //   onList    treat a seat the member already holds as "on the list"
  //   late      the admin class view: a class that is over (classCheck) takes
  //             someone as came, checked in at its start, on a pass live that
  //             day (PASS_LIVE_ON). Their Rezerv no-show on the class counts
  //             as on the list: it becomes the visit, as the check-in route does.
  // The door and paid orders (and staff adding from the calendar) treat a seat
  // the member already holds as "on the list" and just check it in (when
  // checkIn); a student is told they already booked it.
  async function takeSeat(db, { member, slotId, date, staff = false, allowOver = false,
    cover = 'pass', passId = null, checkIn = false, source = 'student', requestId = null,
    onList = source === 'door' || source === 'order', needMat = false, late = false }) {
    const door = onList;
    const { slot, startAt, capacity, over } = await classCheck(db, slotId, date,
      { staff, endedMsg: door ? CLASS_ENDED : undefined, late });
    // Nobody is put on a class that is over except as someone who came.
    if (over) checkIn = true;

    // Serialise everyone booking this same class: a transaction-scoped
    // advisory lock keyed on (slot, date). Counting rows cannot be locked
    // directly (Postgres forbids FOR UPDATE with aggregates), and without
    // this two students can each read "41 booked" and both take seat 42.
    await db.query('SELECT pg_advisory_xact_lock($1::int, $2::int)',
      [slotId, Number(String(date).replace(/-/g, ''))]);

    const out = { slot, startAt, capacity, taken: 0, overCapacity: false, already: false };
    if (door) {
      const on = (await db.query(
        `SELECT * FROM bkk_bookings WHERE slot_id=$1 AND class_date=$2
           AND (status='booked'${late ? ` OR status='noshow'` : ''}) AND (member_id=$3 OR request_id=$4)
         ORDER BY request_id IS NOT DISTINCT FROM $4 DESC, status='booked' DESC LIMIT 1`,
        [slotId, date, member.id, requestId])).rows[0];
      if (on) {
        out.booking = checkIn ? (await db.query(
          `UPDATE bkk_bookings SET status='booked',
             checked_in_at = COALESCE(checked_in_at, ${over ? 'start_at' : 'now()'}) WHERE id=$1 RETURNING *`,
          [on.id])).rows[0] : on;
        out.already = true;
        out.repeat = !!requestId && on.request_id === requestId;
        return out;
      }
      if (!cover) return null;
    }

    out.taken = await seatsTaken(db, slotId, date);
    if (out.taken >= capacity) {
      if (!allowOver) throw new Error('class is full');
      out.overCapacity = true;
    }

    let pass = null;
    if (cover === 'pass') {
      // A student books with a one-class credit (a drop-in) only up to 2 weeks
      // ahead, as one is sold (DROPIN_DAYS). Staff, the door and paid orders are not held to it.
      const dropCap = staff ? null : addDaysYmd(bkkToday(), DROPIN_DAYS - 1);
      const args = passId ? [member.id, date, passId, dropCap] : [member.id, date, dropCap];
      const capAt = '$' + args.length + '::date';
      const oneOk = `(p.kind <> 'credits' OR p.credits_total <> 1 OR ${capAt} IS NULL OR $2::date <= ${capAt})`;
      pass = (await db.query(
        `SELECT p.* FROM bkk_passes p
         WHERE p.member_id=$1
           AND ${over ? PASS_LIVE_ON('$2::date') : `p.status='active' AND (p.valid_from IS NULL OR p.valid_from <= $2::date)
             AND (p.valid_until IS NULL OR p.valid_until >= $2::date)`}
           AND (p.kind='unlimited' OR p.credits_used < p.credits_total) AND ${oneOk}
           ${passId ? 'AND p.id=$3' : ''}
         ORDER BY p.valid_from NULLS LAST, p.id LIMIT 1 FOR UPDATE`, args)).rows[0];
      // A pass covers no day before its window. One whose window its first
      // class set (a later class booked first) starts again at this earlier
      // class, keeping its length, while every class booked on it still fits.
      // So a pass bought now and first booked for a class next year is never
      // a second pass for the months before it.
      if (!pass && !over) {
        pass = (await db.query(
          `SELECT p.* FROM bkk_passes p
           WHERE p.member_id=$1 AND p.status='active' AND p.valid_from > $2::date
             AND p.valid_until = p.valid_from + p.valid_days
             AND (p.kind='unlimited' OR p.credits_used < p.credits_total) AND ${oneOk}
             ${passId ? 'AND p.id=$3' : ''}
             AND NOT EXISTS (SELECT 1 FROM bkk_bookings b WHERE b.pass_id=p.id AND b.status <> 'cancelled'
               AND (b.class_date < p.valid_from OR b.class_date > $2::date + p.valid_days))
           ORDER BY p.valid_from, p.id LIMIT 1 FOR UPDATE OF p`, args)).rows[0];
        if (pass) pass = (await db.query(`UPDATE bkk_passes SET valid_from=$2::date, valid_until=$2::date + valid_days
          WHERE id=$1 RETURNING *`, [pass.id, date])).rows[0];
      }
      if (!pass && dropCap && date > dropCap) {
        const held = (await db.query(`SELECT 1 FROM bkk_passes p WHERE p.member_id=$1 AND p.status='active'
            AND p.kind='credits' AND p.credits_total=1 AND p.credits_used < p.credits_total
            AND (p.valid_from IS NULL OR p.valid_from <= $2::date) AND (p.valid_until IS NULL OR p.valid_until >= $2::date)
          LIMIT 1`, [member.id, date])).rows[0];
        if (held) throw Object.assign(new Error(`a drop-in opens 2 weeks before the class: use yours for a class up to ${dropCap}`),
          { dropinUntil: dropCap });
      }
      if (!pass) {
        const later = (await db.query(`SELECT to_char(min(valid_from),'YYYY-MM-DD') AS f FROM bkk_passes
          WHERE member_id=$1 AND status='active' AND valid_from > $2::date`, [member.id, date])).rows[0].f;
        throw Object.assign(new Error(later
          ? `no active pass for that day: your pass starts on ${later}, so a class before it needs another package`
          : 'no active pass — please buy a package first'), { noPass: true, over });
      }

      // daily cap (memberships: 2 bookings per day)
      if (pass.daily_cap) {
        const today = (await db.query(
          `SELECT count(*)::int AS n FROM bkk_bookings
           WHERE member_id=$1 AND class_date=$2 AND status='booked'`, [member.id, date])).rows[0].n;
        if (today >= pass.daily_cap)
          throw new Error(`limit is ${pass.daily_cap} classes per day`);
      }

      // First booking starts the validity window — but ONLY for a pass that has
      // no window yet. A pass imported from Rezerv carries an expiry the student
      // already paid for; testing valid_from alone would overwrite that expiry
      // with today + valid_days the moment they booked, silently and invisibly.
      if (!pass.valid_from && !pass.valid_until) {
        const vu = new Date(`${date}T00:00:00${TZ_OFFSET}`);
        vu.setDate(vu.getDate() + pass.valid_days);
        await db.query('UPDATE bkk_passes SET valid_from=$2, valid_until=$3 WHERE id=$1',
          [pass.id, date, ymd(vu)]);
      }
      if (pass.kind !== 'unlimited') {
        await db.query('UPDATE bkk_passes SET credits_used = credits_used + 1 WHERE id=$1', [pass.id]);
      }
    } else if (cover !== 'rezerv') throw new Error('unknown cover');

    // An online class is practised at home: no mat to rent.
    out.booking = (await db.query(
      `INSERT INTO bkk_bookings (slot_id,class_date,start_at,member_id,pass_id,cover,source,request_id,checked_in_at,need_mat)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,${!checkIn ? 'NULL' : over ? '$3' : 'now()'},$9) RETURNING *`,
      [slotId, date, startAt, member.id, pass ? pass.id : null, cover, source, requestId,
        needMat === true && !slot.is_online])).rows[0];
    return out;
  }

  app.post('/api/bkk/bookings', async (req, res) => {
    const { memberCode: mcode, slotId, date } = req.body || {};
    if (!mcode || !slotId || !date) return res.status(400).json({ error: 'memberCode, slotId and date required' });
    const staff = isAdmin(req);
    // Read before the transaction: a query on the pool while this one holds a client can wait forever.
    const ask = !staff && await consentMode() === 'require';
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const m = await memberByCode(mcode, client);
      if (!m) throw new Error('member not found');
      const { booking: b } = await takeSeat(client, { member: m, slotId, date, staff,
        cover: 'pass', source: staff ? 'staff' : 'student', needMat: req.body.needMat === true });
      // In 'require', a student's own booking that would go through waits for the agreement:
      // after takeSeat, so a full class or a moon day keeps its own answer, and before COMMIT,
      // so the rollback leaves no seat, no pass clock started and no class used. Staff never wait.
      if (ask && !(await consentOk(client, m.id)))
        throw Object.assign(new Error('consent'), { consent: true });
      await client.query('COMMIT');
      res.json({ success: true, booking: b });
    } catch (e) {
      await client.query('ROLLBACK');
      const msg = /duplicate key/.test(e.message) ? 'you already booked this class' : e.message;
      res.status(409).json({ error: msg, ...(e.dropinUntil ? { dropinUntil: e.dropinUntil } : {}),
        ...(e.consent ? { version: CONSENT_VERSION } : {}) });
    } finally { client.release(); }
  });

  // Tick or untick "I need a mat" on a seat already booked. Same ownership rule
  // as cancelling: the member code, or staff. A student can change it until the
  // class starts; staff any time.
  app.post('/api/bkk/bookings/:id/mat', async (req, res) => {
    const { memberCode: mcode, needMat } = req.body || {};
    if (typeof needMat !== 'boolean') return res.status(400).json({ error: 'needMat must be true or false' });
    if (!/^\d{1,9}$/.test(req.params.id)) return res.status(404).json({ error: 'booking not found' });
    try {
      const b = (await q(
        `SELECT b.id, b.status, b.start_at, s.is_online, m.code AS mcode FROM bkk_bookings b
         JOIN bkk_members m ON m.id=b.member_id LEFT JOIN bkk_class_slots s ON s.id=b.slot_id
         WHERE b.id=$1`, [Number(req.params.id)])).rows[0];
      const staff = isAdmin(req);
      const who = staff ? null : await memberByCode(mcode);
      if (!b || (!staff && (!who || b.mcode !== who.code))) return res.status(404).json({ error: 'booking not found' });
      if (b.status !== 'booked') return res.status(409).json({ error: 'already ' + b.status });
      if (b.is_online !== false && needMat) return res.status(409).json({ error: 'an online class needs no mat from the shala' });
      if (!staff && new Date(b.start_at) <= bkkNow()) return res.status(409).json({ error: 'that class has already started' });
      await q('UPDATE bkk_bookings SET need_mat=$2 WHERE id=$1', [b.id, needMat]);
      res.json({ success: true, booking: { id: b.id, needMat } });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.post('/api/bkk/bookings/:id/cancel', async (req, res) => {
    const { memberCode: mcode } = req.body || {};
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const b = (await client.query(
        `SELECT b.*, m.code AS mcode,
           b.booked_at > b.start_at + make_interval(mins => coalesce(s.duration_min, 120)) AS added_late
         FROM bkk_bookings b JOIN bkk_members m ON m.id=b.member_id LEFT JOIN bkk_class_slots s ON s.id=b.slot_id
         WHERE b.id=$1 FOR UPDATE OF b, m`, [req.params.id])).rows[0];
      if (!b) throw new Error('booking not found');
      // The member code is REQUIRED. It used to be optional, which meant omitting
      // it skipped the ownership check entirely and let anyone cancel any booking
      // by guessing its id. Staff cancel through the admin, not through here.
      const who = isAdmin(req) ? null : await memberByCode(mcode, client);
      if (!isAdmin(req) && (!who || b.mcode !== who.code)) throw new Error('not your booking');
      if (b.slot_id == null) throw new Error(REZERV_READONLY);
      if (b.status !== 'booked') throw new Error('already ' + b.status);
      if (b.moved_at && !isAdmin(req)) throw new Error('staff took this class from your pass: ask the shala');

      const hoursLeft = (new Date(b.start_at) - bkkNow()) / 3600000;
      // Staff taking off someone they put on a class after it was over (the
      // wrong person picked): nobody kept a seat from anyone, so the class
      // goes back on the pass. A student cancelling it never gets it back.
      // The same for a Rezerv class staff took from the pass after it was over,
      // which is then a plain Rezerv class again, off the pass.
      if (b.moved_at && b.pass_id) await client.query('SELECT 1 FROM bkk_passes WHERE id=$1 FOR UPDATE', [b.pass_id]);
      const ab = isAdmin(req) && b.moved_at && b.pass_id ? await moveAbsorbed(client, b.id) : null;
      const unmove = isAdmin(req) && !!b.moved_at && !!b.pass_id && !ab;
      const refund = !ab && (hoursLeft >= CANCEL_CUTOFF_HOURS || (isAdmin(req) && b.added_late === true) || unmove);
      await client.query(`UPDATE bkk_bookings SET status='cancelled', cancelled_at=now()${unmove
        ? `, pass_id=NULL, cover='rezerv', moved_at=NULL` : ''} WHERE id=$1`, [b.id]);
      if (refund && b.pass_id) {
        await client.query(
          `UPDATE bkk_passes SET credits_used = GREATEST(0, credits_used - 1)
           WHERE id=$1 AND kind <> 'unlimited'`, [b.pass_id]);
      }
      await client.query('COMMIT');
      res.json({
        success: true, creditReturned: refund, cutoffHours: CANCEL_CUTOFF_HOURS, ...(ab ? { carried: { classes: ab.n, on: ab.on } } : {}),
        message: refund ? 'Cancelled — your credit is back.'
          : `Cancelled. Less than ${CANCEL_CUTOFF_HOURS}h before class, so the credit is used.`,
      });
    } catch (e) {
      await client.query('ROLLBACK'); res.status(409).json({ error: e.message });
    } finally { client.release(); }
  });

  // ── check-in (door) ───────────────────────────────────────────────────────
  // "Is this member booked for a class starting around now?"
  // Staff-only: the door page already holds the admin key, and marking someone
  // present is a claim about the real world that a student must not make alone.
  app.post('/api/bkk/checkin', async (req, res) => {
    if (!isAdmin(req)) return res.status(401).json({ ok: false, reason: 'bad key' });
    try {
      const { memberCode: mcode, windowMin } = req.body || {};
      const win = Math.min(180, Math.max(15, parseInt(windowMin) || 90));
      const m = await memberByCode(mcode);
      if (!m) return res.status(404).json({ ok: false, reason: 'unknown member' });
      const b = (await q(
        `SELECT b.*, s.title FROM bkk_bookings b JOIN bkk_class_slots s ON s.id=b.slot_id
         WHERE b.member_id=$1 AND b.status='booked'
           AND b.start_at BETWEEN now() - ($2 || ' minutes')::interval
                              AND now() + ($2 || ' minutes')::interval
         ORDER BY abs(extract(epoch FROM (b.start_at - now()))) LIMIT 1`, [m.id, win])).rows[0];
      if (!b) return res.json({ ok: false, name: m.name, reason: 'no booking for this time' });
      await q(`UPDATE bkk_bookings SET checked_in_at = COALESCE(checked_in_at, now()),
        checkin_via = CASE WHEN checked_in_at IS NULL THEN 'door' ELSE checkin_via END,
        checkin_by = CASE WHEN checked_in_at IS NULL THEN NULL ELSE checkin_by END WHERE id=$1`, [b.id]);
      res.json({ ok: true, name: m.name, className: b.title, startAt: b.start_at });
    } catch (e) { res.status(500).json({ ok: false, reason: e.message }); }
  });

  // ── admin ─────────────────────────────────────────────────────────────────
  // Newest first by when the order was made, so thousands of Rezerv payments
  // (dated when they were paid) never push today's orders off the list.
  // ?from=&to= (Bangkok days, either end), ?source=rezerv|aybkk, ?limit= (≤2000).
  app.get('/api/bkk/admin/orders', async (req, res) => {
    if (!isAdmin(req)) return res.status(401).json({ error: 'bad key' });
    try {
      const where = [], args = [];
      for (const [k, op] of [['from', '>='], ['to', '<=']]) {
        if (req.query[k] == null || req.query[k] === '') continue;
        if (!realYmd(req.query[k])) return res.status(400).json({ error: `${k} must be a date (YYYY-MM-DD)` });
        args.push(req.query[k]);
        where.push(`${PAY_DAY} ${op} $${args.length}::date`);
      }
      const src = String(req.query.source || '');
      if (src === 'aybkk') where.push('o.source IS NULL');
      else if (src) { args.push(src); where.push(`o.source = $${args.length}`); }
      const limit = Math.min(2000, Math.max(1, parseInt(req.query.limit) || 200));
      const cond = where.length ? 'WHERE ' + where.join(' AND ') : '';
      // name_en falls back to what Rezerv called it, so a payment for a package
      // that is not in the catalogue still says what was bought. A drop-in says
      // its class; a Rezerv copy of a sale here says that sale's ref. rz_pass: a
      // sale here next to a live Rezerv pass of the same package family that starts
      // within 5 days of the sale or of its pass, as the import pairs them, so the
      // student may hold two passes for it.
      const t = args.length + 1;
      const [r, n] = await Promise.all([q(
        `SELECT o.*, coalesce(pr.name_en, o.item_name) AS name_en, pr.name_th, pr.code AS product_code,
           coalesce(pr.name_en, o.item_name) AS item, m.name AS member_name, m.email, m.code AS member_code,
           cs.title AS class_title, to_char(o.class_date,'YYYY-MM-DD') AS class_day, tw.refno::text AS twin_refno,
           td.code AS tee_drop, tt.name AS tee_name, tt.status AS tee_status, tt.pickup AS tee_pickup,
           CASE WHEN o.source IS NULL AND o.status='paid' THEN EXISTS (SELECT 1 FROM bkk_passes rp
             WHERE rp.member_id=o.member_id AND rp.source='rezerv' AND rp.status IN ('active','frozen')
               AND (rp.valid_until IS NULL OR rp.valid_until >= $${t}::date) AND rp.valid_from IS NOT NULL
               AND (abs(${PAY_DAY} - rp.valid_from) <= ${COPY_DAYS} OR EXISTS (SELECT 1 FROM bkk_passes ap
                 WHERE ap.order_id=o.id AND abs(ap.valid_from - rp.valid_from) <= ${COPY_DAYS}))
               AND ${famOf('rp')} = ${famOf('o')}) END AS rz_pass
         FROM bkk_orders o LEFT JOIN bkk_products pr ON pr.id=o.product_id
         LEFT JOIN bkk_members m ON m.id=o.member_id
         LEFT JOIN bkk_class_slots cs ON cs.id=o.slot_id
         LEFT JOIN bkk_orders tw ON tw.id=o.twin_of
         LEFT JOIN bkk_tee_orders tt ON tt.order_id=o.id LEFT JOIN bkk_tee_drops td ON td.id=tt.drop_id
         ${cond}
         ORDER BY o.created_at DESC, o.id DESC LIMIT ${limit}`, [...args, bkkToday()]),
        q(`SELECT count(*)::int AS n FROM bkk_orders o ${cond}`, args)]);
      res.json({ orders: r.rows, total: n.rows[0].n });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Money taken at the desk. A real order, so it shows in Payments, the day's
  // cash count and the books, with VAT and a receipt — unlike "Give a pass".
  // No online fee: nothing went through the gateway.
  const DESK_METHODS = ['cash', 'transfer', 'card'];
  // With a class (slotId, date), the sale also books it: staff timing (until the
  // class ends) and over capacity allowed, since the person is at the desk.
  // saleId: the desk's own id for this sale (bkk_orders.request_id), unique.
  // mailTo: a folded profile's email typed for the sale, as checkout keeps it,
  // so the receipt goes there and an undo of that merge takes the sale back.
  async function deskSale({ member, pr, method, slotId, date, checkIn, source, requestId, late, saleId, mailTo }) {
    const { vat, total } = breakdown(pr.price_thb, 0);
    let o = null;
    for (let attempt = 0; attempt < 5 && !o; attempt++) {
      try {
        o = (await q(
          `INSERT INTO bkk_orders (refno,product_id,member_id,base_thb,fee_thb,vat_thb,amount_thb,method,slot_id,class_date,request_id,mail_to)
           VALUES ($1,$2,$3,$4,0,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
          [newRefno(), pr.id, member.id, pr.price_thb, vat, total, method, slotId || null, slotId ? date : null, saleId || null,
           mailTo || null])).rows[0];
      } catch (e) {
        if (e.constraint === 'bkk_orders_request_id') throw e;
        if (!/duplicate key/.test(e.message) || attempt === 4) throw e;
      }
    }
    const act = await activateOrder(o, { note: `${method} at the desk` }, { checkIn, source, requestId, late });
    return { o, vat, total, act };
  }

  // The sale a desk id already made, answered as it was the first time. One that
  // was recorded but never switched on (the first try failed half way) is switched on now.
  async function saleDone(rid) {
    const o = (await q(`SELECT o.*, m.code, m.name AS member_name
      FROM bkk_orders o JOIN bkk_members m ON m.id=o.member_id WHERE o.request_id=$1`, [rid])).rows[0];
    if (!o) return null;
    if (o.status === 'pending') await activateOrder(o, { note: `${o.method} at the desk` });
    return { success: true, repeat: true, member: { code: o.code, name: o.member_name },
      order: { refno: String(o.refno), amount: o.amount_thb, vat: o.vat_thb, method: o.method } };
  }

  // One desk sale per id at a time in this process: the second waits, then finds
  // the first. Nothing holds a database connection while it waits (a held one
  // while the sale asked for more could use up the pool and stop every route).
  // Between processes the unique request_id is the guard.
  const SALE_TURNS = new Map();
  async function inTurn(key, fn) {
    const before = SALE_TURNS.get(key) || Promise.resolve();
    let done;
    const mine = new Promise(r => { done = r; });
    const tail = before.then(() => mine);
    SALE_TURNS.set(key, tail);
    await before;
    try { return await fn(); } finally {
      done();
      if (SALE_TURNS.get(key) === tail) SALE_TURNS.delete(key);
    }
  }

  // A sale staff tap at the desk. requestId (made once per sale on the page) makes
  // a second tap after a lost reply answer with the first sale, also when both
  // arrive at once. The same person, package and class sold at the desk in the
  // last 15 minutes, or paid online in the last 72 hours, answers 409 repeatOf
  // until confirmRepeat is sent (15 Nov 2026: one sale must be one row).
  app.post('/api/bkk/admin/sales', async (req, res) => {
    if (!isAdmin(req)) return res.status(401).json({ error: 'bad key' });
    const rid = req.body && req.body.requestId ? String(req.body.requestId).slice(0, 64) : null;
    if (rid) return inTurn(rid, () => deskSaleRoute(req, res, rid));
    return deskSaleRoute(req, res, null);
  });
  async function deskSaleRoute(req, res, rid) {
    try {
      const { productCode, name, email, phone, method, slotId, checkIn } = req.body || {};
      if (!DESK_METHODS.includes(method)) return res.status(400).json({ error: 'method must be cash, transfer or card' });
      if (!(name || '').trim()) return res.status(400).json({ error: 'name is required' });
      if (rid) {
        const first = await saleDone(rid);
        if (first) return res.json(first);
      }
      await switchPrices();
      const pr = (await q('SELECT * FROM bkk_products WHERE code = $1 AND active', [productCode])).rows[0];
      if (!pr) return res.status(404).json({ error: 'product not found' });
      const date = req.body.date || bkkToday();
      if (slotId) {
        if (!Number.isInteger(Number(slotId)) || !isYmd(date)) return res.status(400).json({ error: 'slotId and date (YYYY-MM-DD) needed for a class' });
        try {
          await classCheck(pool, slotId, date, { staff: true, endedMsg: CLASS_ENDED });
        } catch (e) { return res.status(409).json({ error: e.message }); }
      }
      // Only someone already here can have bought it before: a new person is made after the check.
      const em = String(email || '').trim().toLowerCase();
      // The profile the sale lands on: an email of a profile merged into another one leads there.
      const typed = em ? await rawByEmail(pool, em) : null;
      const known = typed ? await liveMember(pool, typed) : null;
      if (known && req.body.confirmRepeat !== true) {
        const p = (await q(
          `SELECT o.refno, ${PAY_AT} AS at, o.method, o.amount_thb FROM bkk_orders o
           WHERE o.member_id=$1 AND o.product_id=$2 AND o.source IS NULL AND o.status='paid'
             AND o.slot_id IS NOT DISTINCT FROM $3::int AND o.class_date IS NOT DISTINCT FROM $4::date
             AND ((o.method = ANY($5) AND o.created_at > now() - interval '15 minutes')
               OR (o.method = 'online' AND ${PAY_AT} > now() - interval '72 hours'))
           ORDER BY ${PAY_AT} DESC, o.id DESC LIMIT 1`,
          [known.id, pr.id, slotId ? Number(slotId) : null, slotId ? date : null, DESK_METHODS])).rows[0];
        if (p) return res.status(409).json({
          error: `This student already paid for ${pr.name_en} (${p.method}, ref ${p.refno}). Check Payments before you sell again.`,
          repeatOf: { refno: String(p.refno), at: p.at, method: p.method, amount: p.amount_thb } });
      }
      const member = await findOrCreateMember({ name, email, phone });
      let sale;
      try {
        sale = await deskSale({ member, pr, method, slotId: slotId ? Number(slotId) : null, date, checkIn: !!checkIn, saleId: rid,
          mailTo: typed && typed.id !== member.id ? em : null });
      } catch (e) {
        const first = e.constraint === 'bkk_orders_request_id' && await saleDone(rid);
        if (first) return res.json(first);
        throw e;
      }
      const { o, vat, total, act } = sale;
      res.json({ success: true, member: { code: member.code, name: member.name },
        order: { refno: String(o.refno), amount: total, vat, method },
        booking: act && act.booking || undefined, bookingError: act && act.bookingError || undefined });
    } catch (e) { res.status(500).json({ error: e.message }); }
  }

  // The door: whoever is here goes on the class list, checked in. A student with
  // an aybkk.net pass uses it; most students still hold a Rezerv package that is
  // not in this system yet, so 'rezerv' seats them with no pass; anyone else
  // buys a drop-in on the spot (a real desk sale: today's money, VAT, receipt).
  // Over capacity is allowed and reported: the person is already in the room.
  // The calendar adds the same way, with checkIn: false for a class that has
  // not started: the seat is taken, nobody is checked in, source 'staff'.
  // It also sends late: true, so a class that is over (up to LATE_ADD_DAYS
  // back) still takes someone who came and forgot to book, checked in at the
  // class start, on a pass valid that day; a drop-in is today's money. The
  // door never sends it: there a class that is over is refused.
  const WALKIN_COVERS = ['pass', 'rezerv', 'dropin'];
  // What a door add with this requestId already did, answered again as it was
  // the first time: staff tap a second time when the first reply is lost.
  async function walkinDone(rid) {
    const r = (await q(
      `SELECT m.name, m.code, s.title, b.start_at, b.cover, b.checked_in_at, o.refno
       FROM bkk_bookings b JOIN bkk_members m ON m.id=b.member_id JOIN bkk_class_slots s ON s.id=b.slot_id
       LEFT JOIN bkk_passes p ON p.id=b.pass_id
       LEFT JOIN bkk_orders o ON o.id=p.order_id AND o.slot_id=b.slot_id AND o.class_date=b.class_date
       WHERE b.request_id=$1`, [rid])).rows[0];
    return r && { success: true, repeat: true, name: r.name, code: r.code, className: r.title, startAt: r.start_at,
      overCapacity: false, already: false, checkedIn: !!r.checked_in_at,
      cover: r.refno ? 'dropin' : r.cover, ...(r.refno ? { refno: String(r.refno) } : {}) };
  }

  app.post('/api/bkk/admin/walkin', async (req, res) => {
    if (adminOnly(req, res)) return;
    const b = req.body || {};
    const date = b.date || bkkToday();
    const cover = b.cover;
    if (!WALKIN_COVERS.includes(cover)) return res.status(400).json({ error: 'cover must be pass, rezerv or dropin' });
    if (!b.slotId || !Number.isInteger(Number(b.slotId)) || !isYmd(date))
      return res.status(400).json({ error: 'slotId and date (YYYY-MM-DD) required' });
    if (cover === 'dropin' && !DESK_METHODS.includes(b.method))
      return res.status(400).json({ error: 'method must be cash, transfer or card' });
    if (b.checkIn !== undefined && typeof b.checkIn !== 'boolean')
      return res.status(400).json({ error: 'checkIn must be true or false' });
    if (b.late !== undefined && typeof b.late !== 'boolean')
      return res.status(400).json({ error: 'late must be true or false' });
    const slotId = Number(b.slotId);
    const rid = b.requestId ? String(b.requestId).slice(0, 64) : null;
    const late = b.late === true;
    // Nobody is in the room for a class on a later day: the rule of the
    // check-in from inside a class. The door only ever sends today.
    if (b.checkIn !== false && date > bkkToday()) return res.status(409).json({ error: 'that class is not today yet' });
    try {
      const first = rid && await walkinDone(rid);
      if (first) return res.json(first);
    } catch (e) { return res.status(500).json({ error: e.message }); }
    // Checked again under the lock below; this only spares a new person's
    // profile when the class cannot take them anyway.
    let over;
    try { ({ over } = await classCheck(pool, slotId, date, { staff: true, endedMsg: CLASS_ENDED, late })); }
    catch (e) { return res.status(409).json({ error: e.message }); }
    const checkIn = over || b.checkIn !== false;
    const source = checkIn ? 'door' : 'staff';
    let member, mailTo = null;
    try {
      if (b.memberCode) {
        member = await memberByCode(b.memberCode);
        if (!member) return res.status(404).json({ error: 'member not found' });
      } else {
        if (!String(b.name || '').trim()) return res.status(400).json({ error: 'name is required for a new person' });
        const typed = await rawByEmail(pool, b.email);
        member = await findOrCreateMember({ name: b.name, email: b.email, phone: b.phone });
        if (typed && typed.id !== member.id) mailTo = String(b.email).trim().toLowerCase();
      }
    } catch (e) { return res.status(500).json({ error: e.message }); }

    const reply = (seat, extra = {}) => res.json({ success: true, name: member.name, code: member.code,
      className: seat.title, startAt: seat.startAt, overCapacity: !!seat.overCapacity, already: !!seat.already,
      checkedIn: checkIn, ...extra });
    // A seat takeSeat found rather than made: the same add sent twice, or
    // someone already on the list (checked in unless checkIn is false, nothing sold).
    const listed = s => s.repeat ? walkinDone(rid).then(r => res.json(r))
      : reply({ title: s.slot.title, startAt: s.startAt, overCapacity: s.overCapacity, already: s.already },
        { cover: s.already ? (s.booking.cover || (s.booking.pass_id ? 'pass' : 'rezerv')) : cover });
    // A drop-in is only sold to someone not on the list yet: takeSeat with no
    // cover checks the class and checks in a seat they already hold.
    const client = await pool.connect();
    let seat;
    try {
      await client.query('BEGIN');
      seat = await takeSeat(client, { member, slotId, date, staff: true, allowOver: true,
        cover: cover === 'dropin' ? null : cover, checkIn, source, requestId: rid, onList: true, late });
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      if (e.noPass) return res.status(409).json({ noPass: true, date, error: e.over
        ? `${member.name} has no aybkk.net pass for ${dayName(date)}, the day of that class. Choose Rezerv package or Drop-in.`
        : `${member.name} has no aybkk.net pass for that day. Choose Rezerv package or Drop-in.` });
      return res.status(409).json({ error: /duplicate key/.test(e.message) ? 'already on the list' : e.message });
    } finally { client.release(); }

    try {
      if (seat) return await listed(seat);
      await switchPrices();
      const pr = (await q(`SELECT * FROM bkk_products WHERE code='dropin' AND active`)).rows[0];
      if (!pr) return res.status(404).json({ error: 'the drop-in is not on sale' });
      const { o, act } = await deskSale({ member, pr, method: b.method, slotId, date, checkIn,
        source, requestId: rid, late, mailTo });
      if (act && act.unsold) return await listed(act.seat);
      // Paid, but the seat went in the moment between: the money and the pass
      // stand, and the shala has the Telegram ping to put them on by hand.
      if (!act || !act.booking) return res.status(409).json({ paid: true, refno: String(o.refno),
        error: `Paid (ref ${o.refno}), but could not add to the class: ${act ? act.bookingError : 'already paid'}. Book them by hand.` });
      reply(act.booking, { cover: 'dropin', refno: String(o.refno) });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Deliberate manual override for the day the gateway misbehaves — recorded
  // as such so the books show it was not a verified payment.
  app.post('/api/bkk/admin/orders/:id/force-activate', async (req, res) => {
    if (!isAdmin(req)) return res.status(401).json({ error: 'bad key' });
    try {
      const o = (await q('SELECT * FROM bkk_orders WHERE id=$1', [req.params.id])).rows[0];
      if (!o) return res.status(404).json({ error: 'not found' });
      if (o.status === 'paid') return res.json({ success: true, already: true });
      if (o.source === 'rezerv') return res.status(409).json({ error: 'a payment moved from Rezerv is history: it cannot be activated' });
      if (!['pending', 'failed', 'mismatch'].includes(o.status)) return res.status(409).json({
        error: `This order is ${o.status}: it cannot be activated. Sell or book it again if the student should have a pass.` });
      // Activate on a try whose package the student already paid for (another
      // order, either system, the same class for a drop-in) makes a second pass
      // from nothing: asked first, and the paid ref goes in the note (15 Nov 2026).
      const paid = (await q(
        `SELECT x.refno, ${payAt('x')} AS at, x.method FROM bkk_orders x JOIN bkk_orders o ON o.id=$1
         WHERE x.member_id=o.member_id AND x.id<>o.id AND x.status='paid' AND x.amount_thb > 0
           AND (x.product_id=o.product_id OR ${pkgOf('x')} = ${pkgOf('o')})
           AND x.slot_id IS NOT DISTINCT FROM o.slot_id AND x.class_date IS NOT DISTINCT FROM o.class_date
           AND abs(extract(epoch FROM ${payAt('x')} - o.created_at)) <= 72 * 3600
         ORDER BY abs(extract(epoch FROM ${payAt('x')} - o.created_at)), x.id LIMIT 1`, [o.id])).rows[0];
      if (paid && (req.body || {}).confirm !== true) return res.status(409).json({
        error: `This student already paid for this (ref ${paid.refno}). Send confirm to activate anyway.`,
        paidAlready: { refno: String(paid.refno), at: paid.at, method: paid.method } });
      const act = await activateOrder(o, { note: MANUAL_NOTE + (paid ? `, paid already as ref ${paid.refno}` : '') }, { byHand: true });
      res.json({ success: true, booking: act && act.booking || undefined, bookingError: act && act.bookingError || undefined,
        tee: act && act.tee || undefined });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ── the payment watch (15 Nov 2026) ───────────────────────────────────────
  // An order whose postback never came, from a student who closed the page
  // before the return check, stayed "not paid" until a person acted, and the
  // student might pay twice. The server asks PaySolutions again every 10
  // minutes, through verifyAndActivate: the postback's own path, amount
  // checked. Nothing else here turns a pass on.
  const PAY_KEYS = { paySweep: ['pay_sweep', 'on'], pingEachSale: ['ping_each_sale', 'off'], dailyMoney: ['daily_money', 'on'] };
  const MONEY_AT = ['daily_money_at', '21:00'];
  const isClock = v => /^([01]\d|2[0-3]):[0-5]\d$/.test(String(v));
  async function payWatchSettings() {
    const r = await q(`SELECT key, value FROM bkk_settings WHERE key = ANY($1::text[])`,
      [[...Object.values(PAY_KEYS).map(([k]) => k), MONEY_AT[0]]]);
    const v = k => (r.rows.find(x => x.key === k) || {}).value;
    const out = {};
    for (const [field, [key, dflt]] of Object.entries(PAY_KEYS)) out[field] = ['on', 'off'].includes(v(key)) ? v(key) : dflt;
    out.dailyMoneyAt = isClock(v(MONEY_AT[0])) ? v(MONEY_AT[0]) : MONEY_AT[1];
    return out;
  }

  // One runner at a time across servers: a session lock on a connection of its
  // own, held only for the run (no transaction stays open) and always given back.
  const SWEEP_LOCK = `hashtext('bkk_pay_sweep')`;
  async function paySweep({ now = nowMs(), manual = false } = {}) {
    if (!paysoConfig() || paymentStatus().mode !== 'gateway') return { ran: false, reason: 'gateway not configured', orders: [] };
    if (!manual && (await payWatchSettings()).paySweep === 'off') return { ran: false, reason: 'off', orders: [] };
    const lock = await pool.connect();
    let held = false, broken = false;
    // The pool stops listening once a client is checked out: a connection lost
    // mid-run would otherwise be an uncaught error that ends the server.
    const dropped = e => { broken = true; console.error('[bkk pay] sweep lock connection lost:', e.message); };
    lock.on('error', dropped);
    try {
      try { held = (await lock.query(`SELECT pg_try_advisory_lock(${SWEEP_LOCK}) AS ok`)).rows[0].ok; }
      catch (e) { broken = true; throw e; }
      if (!held) return { ran: false, reason: 'busy', orders: [] };
      const W = PAY_WATCH;
      const due = (await q(`SELECT refno, status FROM bkk_orders
        WHERE status='pending' AND source IS NULL AND method='online' AND amount_thb > 0
          AND created_at <= $1::timestamptz - make_interval(mins => $2)
          AND created_at >= $1::timestamptz - make_interval(hours => $3)
          AND (checked_at IS NULL
            OR (created_at > $1::timestamptz - make_interval(hours => $4) AND checked_at <= $1::timestamptz - make_interval(mins => $5))
            OR (created_at <= $1::timestamptz - make_interval(hours => $4) AND checked_at <= $1::timestamptz - make_interval(mins => $6)))
        ORDER BY checked_at NULLS FIRST, created_at, id LIMIT $7`,
        [new Date(now), W.minAgeMin, W.maxAgeH, W.youngH, W.youngGapMin, W.oldGapMin, W.perRun])).rows;
      const orders = [];
      const t0 = Date.now();
      for (const o of due) {
        // Lock lost (another server may run now), or out of time: the rest wait for the next run.
        if (broken || Date.now() - t0 > runMs) break;
        const out = {}, t1 = Date.now();
        let after = o.status, note = null;
        try {
          const r = await verifyAndActivate(Number(o.refno), { now, out });
          after = r.status;
          note = r.status === 'paid' ? (r.already ? 'already on' : 'turned on') : r.status === 'mismatch' ? 'the amount does not match' : r.note || null;
        } catch (e) { note = `check failed: ${e.message}`.slice(0, 200); }
        orders.push({ refno: String(o.refno), before: o.status, after, note });
        // PaySolutions is not answering: the rest would only wait for the same
        // timeout. They are asked first next time (never checked, or checked longest ago).
        // A slow answer: the next ones would likely be as slow, and the button waits for them all.
        if ((out.verdict && out.verdict.failed) || Date.now() - t1 > slowMs) break;
      }
      return { ran: true, due: due.length, asked: orders.length, paid: orders.filter(x => x.note === 'turned on').length, orders };
    } finally {
      if (held && !broken) await lock.query(`SELECT pg_advisory_unlock(${SWEEP_LOCK})`).catch(() => { broken = true; });
      lock.removeListener('error', dropped);
      lock.release(broken);
    }
  }

  app.post('/api/bkk/admin/pay/sweep', async (req, res) => {
    if (adminOnly(req, res)) return;
    try { res.json(await paySweep({ manual: true })); }
    catch (e) { res.status(500).json({ error: e.message }); }
  });

  // The daily money line: the sales since the last line in one Telegram message
  // instead of a ping each, so a sale after the send time is in the next line,
  // never in none. Money stays in Boonchu's private chat. Sales are paid orders
  // above ฿0 that are not Rezerv history, at the time the money came in.
  const MONEY_MARK = 'daily_money_sent_';
  async function moneyLine({ from, until }) {
    const win = `coalesce(o.verified_at, o.created_at) > $1::timestamptz AND coalesce(o.verified_at, o.created_at) <= $2::timestamptz`;
    const span = [new Date(from), new Date(until)];
    const [sales, refunds, open, failing] = await Promise.all([
      q(`SELECT o.method, count(*)::int AS n, sum(o.amount_thb)::int AS thb,
           count(*) FILTER (WHERE o.gateway_note LIKE $3)::int AS hand
         FROM bkk_orders o WHERE o.status='paid' AND o.amount_thb > 0 AND o.source IS DISTINCT FROM 'rezerv' AND ${win}
         GROUP BY o.method ORDER BY o.method`, [...span, MANUAL_NOTE + '%']),
      q(`SELECT count(*)::int AS n, coalesce(sum(abs(o.amount_thb)), 0)::int AS thb FROM bkk_orders o
         WHERE o.status='refund' AND o.source IS DISTINCT FROM 'rezerv' AND ${win}`, span),
      // Each problem once: a wrong amount found in this line's time, and an
      // online order that turned 1 hour old in it still not paid.
      q(`SELECT count(*) FILTER (WHERE status='mismatch' AND checked_at > $1::timestamptz AND checked_at <= $2::timestamptz)::int AS mismatch,
           count(*) FILTER (WHERE status='pending' AND method='online' AND amount_thb > 0
             AND created_at > $1::timestamptz - make_interval(mins => $3) AND created_at <= $2::timestamptz - make_interval(mins => $3))::int AS stuck
         FROM bkk_orders WHERE source IS NULL`, [...span, PAY_WATCH.stuckMin]),
      getSetting(FAILING, null),
    ]);
    const sum = (rows, k) => rows.reduce((a, r) => a + r[k], 0);
    const online = sales.rows.filter(r => r.method === 'online'), desk = sales.rows.filter(r => r.method !== 'online');
    const rf = refunds.rows[0], op = open.rows[0];
    const head = `AYBKK money, ${bkkClock(from)} to ${bkkClock(until)}`;
    const problems = `New problems: mismatch ${op.mismatch}, online orders started but not paid over 1 hour ${op.stuck}`;
    const check = failing && failing.since && failing.pinged && `PaySolutions check: failing since ${bkkClock(Date.parse(failing.since))} (${gwText(failing.why)})`;
    if (!sales.rows.length && !rf.n) return [`${head}: No sales.`, (op.mismatch || op.stuck) && problems, check].filter(Boolean).join('\n');
    return [head,
      `Online sales: ${sum(online, 'n')}, ฿${thb(sum(online, 'thb'))}`,
      `Desk sales: ${sum(desk, 'n')}, ฿${thb(sum(desk, 'thb'))}`
        + (desk.length ? ` (${desk.map(r => `${r.method} ${r.n}, ฿${thb(r.thb)}`).join('; ')})` : ''),
      `Total: ฿${thb(sum(sales.rows, 'thb'))} (VAT included)`,
      rf.n && `Refunds: ${rf.n}, ฿${thb(rf.thb)}`,
      `Activated by hand: ${sum(sales.rows, 'hand')}`,
      problems, check].filter(Boolean).join('\n');
  }
  // Due from daily_money_at until the end of that Bangkok day: a server that was
  // down at the time sends when it is back, never on the next day. The day's
  // marker is claimed before anything is sent, so two servers or a restart send
  // it once. A send Telegram refused is claimed again 10 minutes on, 3 tries in
  // all; if none gets through, the next line still covers that time.
  async function moneyTick({ now = nowMs() } = {}) {
    const s = await payWatchSettings();
    if (s.dailyMoney !== 'on') return { sent: false, skipped: 'off' };
    if (!telegramSet()) return { sent: false, skipped: 'telegram not set' };
    const date = ymd(new Date(now));
    const dueAt = Date.parse(`${date}T${s.dailyMoneyAt}:00${TZ_OFFSET}`);
    if (now < dueAt) return { sent: false, skipped: 'not yet', date };
    const key = MONEY_MARK + date, at = new Date(now).toISOString();
    const mine = await q(`INSERT INTO bkk_settings (key,value) VALUES ($1, jsonb_build_object('state', 'sending', 'at', $2::text, 'tries', 1))
      ON CONFLICT (key) DO UPDATE SET updated_at=now(), value = bkk_settings.value || jsonb_build_object('state', 'sending', 'at', $2::text,
        'tries', coalesce((bkk_settings.value->>'tries')::int, 1) + 1)
      WHERE bkk_settings.value->>'state' = 'failed' AND bkk_settings.value->>'retry' = 'true'
        AND coalesce((bkk_settings.value->>'tries')::int, 1) < $3
        AND (bkk_settings.value->>'at')::timestamptz <= $2::timestamptz - make_interval(mins => $4)
      RETURNING key`, [key, at, PAY_WATCH.sendTries, PAY_WATCH.retryMin]);
    if (!mine.rows.length) return { sent: false, skipped: 'already', date };
    // From the end of the last line that got through (a week back at most), or
    // yesterday at the set time for the first line.
    const last = (await q(`SELECT value->>'until' AS until FROM bkk_settings
      WHERE left(key, length($1)) = $1 AND key < $2 AND value->>'state' = 'sent' AND value ? 'until'
      ORDER BY key DESC LIMIT 1`, [MONEY_MARK, key])).rows[0];
    const from = Math.min(now, last ? Math.max(Date.parse(last.until), now - PAY_WATCH.lineMaxDays * 86400000) : dueAt - 86400000);
    let text = null, r;
    try { text = await moneyLine({ from, until: now }); r = await notify(text); }
    catch (e) { r = { ok: false, error: e.message }; }
    await q(`UPDATE bkk_settings SET value = value || $2::jsonb, updated_at=now() WHERE key=$1`,
      [key, JSON.stringify(r.ok ? { state: 'sent', from: new Date(from).toISOString(), until: at }
        : { state: 'failed', retry: !!r.retry, error: String(r.error).slice(0, 160) })]);
    q(`DELETE FROM bkk_settings WHERE left(key, length($1)) = $1 AND updated_at < now() - interval '30 days'`, [MONEY_MARK])
      .catch(() => {});
    return { sent: !!r.ok, date, text, error: r.ok ? undefined : r.error };
  }

  // server.js runs both on a clock; a test turns them off (timers: false, or
  // BKK_TIMERS=off) and calls paySweep and moneyTick itself.
  function startPayWatch() {
    const sweep = () => paySweep().catch(e => console.error('[bkk pay] sweep failed:', e.message));
    const line = () => resendAlerts().catch(e => console.error('[bkk pay] resend failed:', e.message))
      .then(() => moneyTick()).catch(e => console.error('[bkk money] daily line failed:', e.message));
    setTimeout(sweep, PAY_WATCH.firstMs).unref();
    setInterval(sweep, PAY_WATCH.everyMs).unref();
    setInterval(line, 60000).unref();
  }

  async function telegramStatus() {
    const last = await getSetting('telegram_last', null);
    return { set: telegramSet(), last: last && typeof last === 'object'
      ? { ok: !!last.ok, at: last.at || null, okAt: last.okAt || null, error: last.ok ? null : last.error || null } : null };
  }
  // A Rezerv pass the import kept void as the copy of an aybkk.net pass is that
  // sale's pass again once the aybkk.net pass is voided: the student keeps one
  // pass, not none. Its own dates and classes used come back with it, paused if
  // Rezerv has it paused. One Rezerv stopped since stays void, no longer paired.
  // The note loses "voided:", so a later import leaves it as it is. said: why,
  // after "live again: ". Gives the ids that are live again.
  async function twinPassBack(db, passIds, said) {
    if (!passIds.length) return [];
    return (await db.query(`UPDATE bkk_passes SET status = coalesce(twin_undo->>'status', 'active'), twin_of=NULL, twin_undo=NULL,
        note = regexp_replace(coalesce(note,''), '^voided: same sale as aybkk\\.net ref \\d+( \\| )?', '') || ' | '
          || CASE WHEN twin_undo->>'status' = 'void' THEN 'not paired now, still void as Rezerv stopped it: ' ELSE 'live again: ' END || $2
      WHERE twin_of = ANY($1) AND source='rezerv' AND status='void' RETURNING id, status`, [passIds, said])).rows
      .filter(r => r.status !== 'void').map(r => r.id);
  }

  // An undo that takes a twin pair apart: the pass kept gives back what the
  // import carried onto it from the other student's Rezerv pass. The classes it
  // added come off; a start day it gave, if the pass still starts then, becomes
  // the first class booked on it (ending its own days later), or none.
  // skip: bookings about to come off the pass (another student's moved classes), never its first class.
  async function twinCarryBack(db, rezervIds, skip = []) {
    for (const id of rezervIds) {
      const r = (await db.query(`SELECT r.twin_undo AS u, a.id, to_char(a.valid_from,'YYYY-MM-DD') AS f,
          (SELECT to_char(min(b.class_date),'YYYY-MM-DD') FROM bkk_bookings b WHERE b.pass_id=a.id AND b.status <> 'cancelled'
            AND NOT (b.id = ANY($2::int[]))) AS first
        FROM bkk_passes r JOIN bkk_passes a ON a.id=r.twin_of WHERE r.id=$1 FOR UPDATE OF a`, [id, skip])).rows[0];
      if (!r || !r.u) continue;
      const dated = !!r.u.from && r.f === r.u.from;
      await db.query(`UPDATE bkk_passes SET credits_used = GREATEST(0, credits_used - $2::int),
          valid_from = CASE WHEN $3::boolean THEN $4::date ELSE valid_from END,
          valid_until = CASE WHEN NOT $3::boolean THEN valid_until WHEN $4::date IS NOT NULL THEN $4::date + valid_days ELSE $5::date END
        WHERE id=$1`, [r.id, Number(r.u.used) || 0, dated, r.first, r.u.untilWas || null]);
    }
  }

  // A paid aybkk.net order a person has checked against the bank or PaySolutions
  // and found recorded twice (15 Nov 2026). Never deleted: the row says "Void:"
  // and why, drops out of all money and counts, and its pass goes too, but only
  // while no class was booked or used on it. Rezerv lines go through /doubles.
  app.post('/api/bkk/admin/orders/:id/void', async (req, res) => {
    if (!isAdmin(req)) return res.status(401).json({ error: 'bad key' });
    const reason = String((req.body || {}).reason || '').replace(/\s+/g, ' ').trim().slice(0, 200);
    if (!reason) return res.status(400).json({ error: 'reason is required' });
    if (!/^\d+$/.test(String(req.params.id))) return res.status(404).json({ error: 'not found' });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const o = (await client.query('SELECT * FROM bkk_orders WHERE id=$1 FOR UPDATE', [req.params.id])).rows[0];
      const stop = async (code, body) => { await client.query('ROLLBACK'); return res.status(code).json(body); };
      if (!o) return await stop(404, { error: 'not found' });
      if (o.source) return await stop(409, { error: 'A payment moved from Rezerv is not voided here. GET /api/bkk/admin/doubles lists the Rezerv lines a rule can settle (a, b) and the ones a person decides (e). If an aybkk.net order is the copy, void that order instead.' });
      if (o.status === 'void') return await stop(200, { success: true, already: true });
      if (o.status !== 'paid') return await stop(409, { error: 'only a paid order can be voided' });
      // Classes the import carried over from the Rezerv copy of this pass were used
      // on that pass, which comes back: they do not stop the void.
      const passes = (await client.query(
        `SELECT p.id, p.status, p.credits_used, coalesce(tw.credits_used, 0) AS carried,
           EXISTS (SELECT 1 FROM bkk_bookings b WHERE b.pass_id=p.id AND b.status <> 'cancelled') AS booked
         FROM bkk_passes p LEFT JOIN bkk_passes tw ON tw.twin_of=p.id AND tw.source='rezerv'
         WHERE p.order_id=$1 FOR UPDATE OF p`, [o.id])).rows;
      if (passes.some(p => p.status !== 'void' && (p.booked || p.credits_used > p.carried))) return await stop(409, { classUsed: true,
        error: 'A class is booked or used on this pass. Cancel that booking first, or keep this sale.' });
      const said = `Void: ${reason} (by staff, ${bkkToday()})`;
      const { gone, back } = await voidMoney(client, o, said);
      await client.query('COMMIT');
      res.json({ success: true, refno: String(o.refno), note: said, passesVoided: gone.length, rezervPassBack: back });
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      res.status(500).json({ error: e.message });
    } finally { client.release(); }
  });
  // A paid order made void, inside the caller's transaction: its passes go (and a Rezerv twin comes
  // back), the row says "Void:" and why, and a tee order's tees are cancelled, which frees them.
  async function voidMoney(db, o, said, now = nowMs()) {
    const gone = (await db.query(`UPDATE bkk_passes SET status='void', note = coalesce(note || ' | ', '') || $2
      WHERE order_id=$1 AND status <> 'void' RETURNING id`, [o.id, `voided: order ${o.refno} void`])).rows.map(p => p.id);
    const back = await twinPassBack(db, gone, `aybkk.net order ${o.refno} was made void on ${bkkToday()}`);
    await db.query(`UPDATE bkk_orders SET status='void', gateway_note = $2 || coalesce(' | ' || gateway_note, '') WHERE id=$1`,
      [o.id, said]);
    if (o.kind === 'tee') await db.query(`UPDATE bkk_tee_orders SET status='cancelled', cancelled_at=coalesce(cancelled_at, $2)
      WHERE order_id=$1 AND status <> 'cancelled'`, [o.id, new Date(now)]);
    return { gone, back };
  }

  // ── one sale shown twice, already in the data (15 Nov 2026) ───────────────
  // GET lists what looks like one sale recorded twice, and changes nothing.
  // POST applies only the two kinds a rule can settle, by the ids the list gave:
  //   a  a ฿0 Rezerv line that is the copy of an aybkk.net sale: status 'twin'
  //   b  one Rezerv payment imported twice under two refs: the later copy 'void'
  // c (two live passes for one sale), d (two paid aybkk.net orders that may be
  // one sale) and e (a Rezerv line with money next to an aybkk.net sale) need a
  // person: Void pass on the profile, or POST orders/:id/void. a, c and e take the
  // import's family and 5 days, so the list shows what the import calls a copy.
  const refKind = r => /^h:/.test(r) ? 'h' : 'id:' + String(r).replace(/\d+/g, '9');
  const hashBase = r => String(r).replace(/#\d+$/, '');
  const greedy = (rows, a, b) => {
    const usedA = new Set(), usedB = new Set(), out = [];
    for (const r of rows) {
      if (usedA.has(r[a]) || usedB.has(r[b])) continue;
      usedA.add(r[a]); usedB.add(r[b]); out.push(r);
    }
    return out;
  };
  async function findDoubles(db) {
    const today = bkkToday();
    const items = [];
    const who = r => ({ code: r.code, name: r.name });
    const ref = v => String(v);
    // The import's pairing of a Rezerv line with a sale here: the same package
    // family within 5 Bangkok days, the same package first, then the nearest. A
    // class credit Rezerv gave back is no sale.
    const lineNear = `JOIN bkk_orders k ON k.member_id=r.member_id AND k.source IS NULL AND k.status='paid' AND k.amount_thb > 0
        AND ${famOf('k')} = ${famOf('r')} AND abs(${payDay('k')} - ${payDay('r')}) <= ${COPY_DAYS}`;
    const lineOrder = `(k.product_id=r.product_id OR ${pkgOf('k')} = ${pkgOf('r')}) DESC, abs(${payDay('k')} - ${payDay('r')}),
        abs(extract(epoch FROM ${payAt('k')} - ${payAt('r')})), r.id, k.id`;
    const noCredit = rows => rows.filter(r => !creditBack(r.rraw || ''));
    // (a) ฿0 Rezerv lines next to a paid aybkk.net sale not paired yet, one to one.
    const a = noCredit((await db.query(`SELECT r.id AS rid, r.refno AS rref, r.item_name AS rraw, to_char(${payDay('r')},'YYYY-MM-DD') AS rday,
        k.id AS kid, k.refno AS kref, k.method AS kmethod, k.amount_thb AS kamount, to_char(${payDay('k')},'YYYY-MM-DD') AS kday,
        coalesce(pr.name_en, r.item_name) AS item, kp.name_en AS kitem, m.code, m.name
      FROM bkk_orders r ${lineNear} AND NOT EXISTS (SELECT 1 FROM bkk_orders x WHERE x.twin_of=k.id)
      JOIN bkk_members m ON m.id=r.member_id LEFT JOIN bkk_products pr ON pr.id=r.product_id
      LEFT JOIN bkk_products kp ON kp.id=k.product_id
      WHERE r.source='rezerv' AND r.status='paid' AND r.amount_thb=0 AND r.twin_of IS NULL
      ORDER BY ${lineOrder}`)).rows);
    for (const r of greedy(a, 'rid', 'kid')) items.push({ id: `a-${r.rid}-${r.kid}`, kind: 'a', member: who(r),
      orders: [{ id: r.rid, refno: ref(r.rref), day: r.rday, source: 'rezerv', amount: 0 },
        { id: r.kid, refno: ref(r.kref), day: r.kday, source: 'aybkk', method: r.kmethod, amount: r.kamount }],
      reason: `A ฿0 ${r.item} line from Rezerv (${r.rday}) next to ${r.kitem} paid on aybkk.net (ref ${r.kref}, ${r.kmethod}, ${r.kday}): staff entered the sale in Rezerv for check-in.`,
      apply: `Mark the Rezerv line as the same sale as ref ${r.kref} (status twin). It stays in the list and never counts as money.` });
    // (b) one Rezerv payment imported twice: same person, day, amount and item,
    // the same minute (or one file with no time), two refs of different shapes
    // (Rezerv's id and a hash, or two id columns), or two hashes. Two ids of one
    // shape are two payments, and h:x#2 is the second of two identical lines in
    // one file. One to one on both sides: a row kept for one copy keeps no other.
    const b = (await db.query(`SELECT x.id AS xid, x.refno AS xref, x.source_ref AS xsrc, x.amount_thb, x.created_at AS xat,
        k.id AS kid, k.refno AS kref, k.source_ref AS ksrc, k.created_at AS kat, to_char(${payDay('x')},'YYYY-MM-DD') AS day,
        to_char(x.created_at AT TIME ZONE 'Asia/Bangkok','HH24:MI') AS xtime, to_char(k.created_at AT TIME ZONE 'Asia/Bangkok','HH24:MI') AS ktime,
        coalesce(pr.name_en, x.item_name) AS item, m.code, m.name
      FROM bkk_orders x JOIN bkk_orders k ON k.source='rezerv' AND k.member_id=x.member_id AND k.id < x.id
        AND ${payDay('k')} = ${payDay('x')} AND k.amount_thb = x.amount_thb
        AND lower(coalesce(k.item_name,'')) = lower(coalesce(x.item_name,'')) AND k.source_ref <> x.source_ref
        AND k.status IN ('paid','refund','twin') AND ${sameTime(hhmm('k'), hhmm('x'))}
      JOIN bkk_members m ON m.id=x.member_id LEFT JOIN bkk_products pr ON pr.id=x.product_id
      WHERE x.source='rezerv' AND x.status IN ('paid','refund')
      ORDER BY x.id, (${hhmm('k')} = ${hhmm('x')}) DESC, k.id`)).rows;
    const gone = new Set(), kept = new Set();
    for (const r of b) {
      if (gone.has(r.xid) || gone.has(r.kid) || kept.has(r.kid) || kept.has(r.xid)) continue;
      const kx = refKind(r.xsrc), kk = refKind(r.ksrc);
      const twice = kx !== kk || (kx === 'h' && hashBase(r.xsrc) !== hashBase(r.ksrc));
      if (!twice) continue;
      gone.add(r.xid); kept.add(r.kid);
      items.push({ id: `b-${r.xid}-${r.kid}`, kind: 'b', member: who(r),
        orders: [{ id: r.xid, refno: ref(r.xref), day: r.day, time: r.xtime, source: 'rezerv', amount: r.amount_thb },
          { id: r.kid, refno: ref(r.kref), day: r.day, time: r.ktime, source: 'rezerv', amount: r.amount_thb }],
        reason: `The same Rezerv payment (${r.item}, ฿${r.amount_thb}, ${r.day}) is here twice, as order ${r.kref} (${r.ktime}) and order ${r.xref} (${r.xtime}), from two files.`,
        apply: `Void order ${r.xref} with the note "same Rezerv payment as order ${r.kref}, imported twice". Order ${r.kref} stays.` });
    }
    // (c) two live passes for one sale: an aybkk.net pass and a Rezerv pass of the
    // same package family that starts within 5 days of the sale or of that pass,
    // and no Rezerv payment above ฿0 for that family within 5 days of its start
    // (then the import keeps both, and e lists that payment). A class credit is
    // never a copy: its note says so (CREDIT_NOTE), and for a Rezerv drop-in
    // imported before that note, the reason says it may be one.
    const c = (await db.query(`SELECT r.id AS rid, a.id AS aid, o.refno, to_char(${payDay('o')},'YYYY-MM-DD') AS paid_on,
        coalesce(pr.name_en, 'pass') AS item, pr.code = 'dropin' AS dropin, m.code, m.name
      FROM bkk_passes r JOIN bkk_passes a ON a.member_id=r.member_id AND a.source IS DISTINCT FROM 'rezerv'
        AND a.status IN ('active','frozen') AND ${famOf('a')} = ${famOf('r')}
        AND (a.valid_until IS NULL OR a.valid_until >= $1::date)
      JOIN bkk_orders o ON o.id=a.order_id AND o.source IS DISTINCT FROM 'rezerv' AND o.status='paid'
      JOIN bkk_members m ON m.id=r.member_id LEFT JOIN bkk_products pr ON pr.id=r.product_id
      WHERE r.source='rezerv' AND r.status IN ('active','frozen') AND (r.valid_until IS NULL OR r.valid_until >= $1::date)
        AND r.valid_from IS NOT NULL
        AND (abs(${payDay('o')} - r.valid_from) <= ${COPY_DAYS} OR abs(a.valid_from - r.valid_from) <= ${COPY_DAYS})
        AND NOT EXISTS (SELECT 1 FROM bkk_passes x WHERE x.twin_of=a.id)
        AND coalesce(r.note, '') NOT LIKE '%${CREDIT_NOTE}%'
        AND NOT EXISTS (SELECT 1 FROM bkk_orders y WHERE y.member_id=r.member_id AND y.source='rezerv' AND y.status='paid'
          AND y.amount_thb > 0 AND ${famOf('y')} = ${famOf('r')} AND abs(${payDay('y')} - r.valid_from) <= ${COPY_DAYS})
      ORDER BY (a.product_id=r.product_id OR ${pkgOf('a')} = ${pkgOf('r')}) DESC,
        LEAST(abs(${payDay('o')} - r.valid_from), abs(a.valid_from - r.valid_from)), r.id, a.id`, [today])).rows;
    const pairs = greedy(c, 'rid', 'aid');
    const ids = [...new Set(pairs.flatMap(p => [p.rid, p.aid]))];
    const use = ids.length ? (await db.query(`SELECT p.id, p.source, p.kind, p.credits_total, p.credits_used,
        to_char(p.valid_from,'YYYY-MM-DD') AS valid_from, to_char(p.valid_until,'YYYY-MM-DD') AS valid_until,
        count(b.id) FILTER (WHERE b.status='booked' AND (b.checked_in_at IS NOT NULL OR b.class_date < $2::date))::int AS used,
        count(b.id) FILTER (WHERE b.status='booked' AND b.checked_in_at IS NULL AND b.class_date >= $2::date)::int AS ahead
      FROM bkk_passes p LEFT JOIN bkk_bookings b ON b.pass_id=p.id WHERE p.id = ANY($1) GROUP BY p.id`, [ids, today])).rows : [];
    const pass = id => { const p = use.find(x => x.id === id);
      return { id, source: p.source === 'rezerv' ? 'rezerv' : 'aybkk', from: p.valid_from, until: p.valid_until,
        classesUsed: p.used, bookingsAhead: p.ahead, ...(p.kind === 'credits' ? { creditsUsed: p.credits_used, creditsTotal: p.credits_total } : {}) }; };
    for (const r of pairs) {
      const rz = pass(r.rid), ay = pass(r.aid);
      items.push({ id: `c-${r.rid}-${r.aid}`, kind: 'c', member: who(r), passes: [rz, ay],
        reason: `Two live ${r.item} passes for what looks like one sale: one from Rezerv (${rz.from} to ${rz.until}, ${rz.classesUsed} classes used, ${rz.bookingsAhead} booked ahead) and the aybkk.net pass of ref ${r.refno} (paid ${r.paid_on}; ${ay.from ? `${ay.from} to ${ay.until}` : 'starts on the first class'}, ${ay.classesUsed} classes used, ${ay.bookingsAhead} booked ahead).${r.dropin ? ' If the Rezerv one is a class Rezerv gave back for a cancelled class, it is no copy: keep both.' : ''}`,
        apply: 'Nothing here. A person chooses which pass to keep and voids the other with Void pass on the profile.' });
    }
    // (d) two paid aybkk.net orders, same person, package and class, that may be
    // one sale: sold at the desk twice within 30 minutes, Activate by hand next to
    // a paid order, or paid online and sold at the desk within 72 hours.
    const d = (await db.query(`SELECT n.id AS nid, n.refno AS nref, n.method AS nmethod, n.gateway_note AS nnote, n.amount_thb AS namount,
        p.id AS pid, p.refno AS pref, p.method AS pmethod, p.gateway_note AS pnote, p.amount_thb AS pamount,
        to_char(${payAt('n')} AT TIME ZONE 'Asia/Bangkok','YYYY-MM-DD HH24:MI') AS nat,
        to_char(${payAt('p')} AT TIME ZONE 'Asia/Bangkok','YYYY-MM-DD HH24:MI') AS pat,
        abs(extract(epoch FROM n.created_at - p.created_at)) AS made_gap, abs(extract(epoch FROM ${payAt('n')} - ${payAt('p')})) AS paid_gap,
        coalesce(pr.name_en, n.item_name) AS item, m.code, m.name
      FROM bkk_orders n JOIN bkk_orders p ON p.member_id=n.member_id AND p.id < n.id AND p.source IS NULL AND p.status='paid'
        AND p.amount_thb > 0 AND p.product_id=n.product_id
        AND p.slot_id IS NOT DISTINCT FROM n.slot_id AND p.class_date IS NOT DISTINCT FROM n.class_date
      JOIN bkk_members m ON m.id=n.member_id LEFT JOIN bkk_products pr ON pr.id=n.product_id
      WHERE n.source IS NULL AND n.status='paid' AND n.amount_thb > 0
        AND abs(extract(epoch FROM ${payAt('n')} - ${payAt('p')})) <= 72 * 3600
      ORDER BY n.id, p.id`)).rows;
    const desk = x => DESK_METHODS.includes(x), byHand = x => /^MANUAL ACTIVATION/.test(x || '');
    for (const r of d) {
      const why2 = desk(r.nmethod) && desk(r.pmethod) && r.made_gap <= 30 * 60 ? 'sold at the desk twice within 30 minutes'
        : byHand(r.nnote) || byHand(r.pnote) ? 'one was activated by hand next to a paid order'
        : desk(r.nmethod) !== desk(r.pmethod) ? 'paid online and sold at the desk within 72 hours' : null;
      if (!why2) continue;
      items.push({ id: `d-${r.nid}-${r.pid}`, kind: 'd', member: who(r),
        orders: [{ id: r.pid, refno: ref(r.pref), at: r.pat, method: r.pmethod, amount: r.pamount, byHand: byHand(r.pnote) },
          { id: r.nid, refno: ref(r.nref), at: r.nat, method: r.nmethod, amount: r.namount, byHand: byHand(r.nnote) }],
        reason: `Two paid ${r.item} orders (ref ${r.pref} and ref ${r.nref}): ${why2}.`,
        apply: 'Nothing here. Check the bank or PaySolutions. If one sale was recorded twice, void that order with POST /api/bkk/admin/orders/:id/void and a reason.' });
    }
    // (e) a Rezerv line with money next to an aybkk.net sale (the import's
    // maybeTwin): the same sale typed in at its price, or a second sale. No rule
    // can settle it: never applied.
    const e = noCredit((await db.query(`SELECT r.id AS rid, r.refno AS rref, r.item_name AS rraw, r.amount_thb AS ramount, r.method AS rmethod,
        to_char(${payDay('r')},'YYYY-MM-DD') AS rday, coalesce(r.item_name, pr.name_en) AS ritem,
        k.id AS kid, k.refno AS kref, k.method AS kmethod, k.amount_thb AS kamount, to_char(${payDay('k')},'YYYY-MM-DD') AS kday,
        kp.name_en AS kitem, m.code, m.name
      FROM bkk_orders r ${lineNear}
      JOIN bkk_members m ON m.id=r.member_id LEFT JOIN bkk_products pr ON pr.id=r.product_id
      LEFT JOIN bkk_products kp ON kp.id=k.product_id
      WHERE r.source='rezerv' AND r.status='paid' AND r.amount_thb > 0 AND r.twin_of IS NULL
      ORDER BY ${lineOrder}`)).rows);
    // One item for each Rezerv line, with its nearest sale, as the import warns on each line.
    const eOne = e.filter((r, i) => e.findIndex(x => x.rid === r.rid) === i);
    for (const r of eOne) items.push({ id: `e-${r.rid}-${r.kid}`, kind: 'e', member: who(r),
      orders: [{ id: r.rid, refno: ref(r.rref), day: r.rday, source: 'rezerv', method: r.rmethod, amount: r.ramount, item: r.ritem },
        { id: r.kid, refno: ref(r.kref), day: r.kday, source: 'aybkk', method: r.kmethod, amount: r.kamount, item: r.kitem }],
      reason: `A ${r.ritem} line from Rezerv (฿${r.ramount}, ${r.rday}) next to ${r.kitem} paid on aybkk.net (ref ${r.kref}, ฿${r.kamount}, ${r.kmethod}, ${r.kday}): it may be one sale entered in both, or two sales.`,
      apply: `Nothing here. Check the bank or PaySolutions, and the student's passes. If the aybkk.net order is the copy, void it with POST /api/bkk/admin/orders/${r.kid}/void and a reason (a Rezerv pass kept void for it comes back). If the Rezerv line is the copy, tell the owner: a Rezerv line with money is not changed by these tools.` });
    return items;
  }

  app.get('/api/bkk/admin/doubles', async (req, res) => {
    if (!isAdmin(req)) return res.status(401).json({ error: 'bad key' });
    try {
      const items = await findDoubles(pool);
      const n = k => items.filter(x => x.kind === k).length;
      res.json({ items, counts: { a: n('a'), b: n('b'), c: n('c'), d: n('d'), e: n('e') } });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Only ids the list gives now, and only kinds a and b: applying twice finds
  // them gone the second time and changes nothing.
  app.post('/api/bkk/admin/doubles/apply', async (req, res) => {
    if (!isAdmin(req)) return res.status(401).json({ error: 'bad key' });
    const want = Array.isArray((req.body || {}).ids) ? [...new Set(req.body.ids.map(String))].slice(0, 2000) : null;
    if (!want || !want.length) return res.status(400).json({ error: 'ids must be a list of ids from GET /api/bkk/admin/doubles' });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // Never next to a Rezerv import, which reads the same rows.
      await client.query(`SELECT pg_advisory_xact_lock(hashtext('bkk_import'))`);
      const now = new Map((await findDoubles(client)).map(x => [x.id, x]));
      const applied = [], skipped = [];
      for (const id of want) {
        const it = now.get(id);
        if (!it) { skipped.push({ id, why: 'not in the list now (done already, or changed)' }); continue; }
        let done;
        if (it.kind === 'a') {
          const [r, k] = it.orders;
          done = await client.query(`UPDATE bkk_orders SET status='twin', twin_of=$2,
              gateway_note = $3 || coalesce(' | ' || gateway_note, '') WHERE id=$1 AND status='paid' AND twin_of IS NULL`,
            [r.id, k.id, `entered in Rezerv for check-in; paid on aybkk.net ref ${k.refno}`]);
        } else if (it.kind === 'b') {
          const [x, k] = it.orders;
          done = await client.query(`UPDATE bkk_orders SET status='void',
              gateway_note = $2 || coalesce(' | ' || gateway_note, '') WHERE id=$1 AND status IN ('paid','refund')`,
            [x.id, `same Rezerv payment as order ${k.refno}, imported twice`]);
        } else { skipped.push({ id, why: 'a person decides this one: it is never applied here' }); continue; }
        if (done.rowCount) applied.push({ id, kind: it.kind });
        else skipped.push({ id, why: 'not in the list now (done already, or changed)' });
      }
      await client.query('COMMIT');
      if (applied.length) console.log(`✓ bkk: doubles applied ${applied.length}`);
      res.json({ success: true, applied, skipped });
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      res.status(500).json({ error: e.message });
    } finally { client.release(); }
  });

  const landingTries = new Map();                // address → { start, n }, this hour's counts
  const landingTry = ip => {
    const now = Date.now();
    if (landingTries.size > 5000) landingTries.clear();
    let t = landingTries.get(ip);
    if (!t || now - t.start >= HOUR_MS) landingTries.set(ip, t = { start: now, n: 0 });
    return ++t.n <= LANDING_PER_HOUR;
  };
  app.post('/api/bkk/start-event', async (req, res) => {
    const b = req.body || {};
    // No page is /start, as every caller before the In-Depth pages.
    const page = b.page == null ? 'start' : typeof b.page === 'string' ? b.page : '';
    if (!Object.hasOwn(LANDING_KINDS, page)) return res.status(400).json({ error: 'page' });
    // The agreement's counts exist only while it is on.
    if (page === 'book' && await consentMode() === 'off') return res.status(400).json({ error: 'page' });
    // Every page names its kind; a body with none (or one that is not JSON) is not a visit.
    if (b.kind == null || b.kind === '') return res.status(400).json({ error: 'kind' });
    // 'step': the first-step ladder (q1..q3 answered, done-<channel> at the end).
    // The staff reports count kind 'view' and 'tap' only, so steps never inflate them.
    // /start counts an unknown kind as a view, as it always has; an In-Depth page sends its own kinds only.
    let kind = LANDING_KINDS[page].includes(b.kind) ? b.kind : null;
    if (!kind && page !== 'start') return res.status(400).json({ error: 'kind' });
    kind = kind || 'view';
    if (LANDING_BOT_UA.test(String(req.headers['user-agent'] || ''))) return res.status(204).end();
    if (!landingTry(guessIp(req))) return res.status(429).json({ error: 'busy' });
    const clean = (v, n) => String(v || '').toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, n) || null;
    // A tag is one of the In-Depth headlines (?for=); /start has none.
    const tag = page === 'start' ? null : LANDING_TAGS.find(t => t === landingCode(b.tag)) || null;
    try {
      await q(`INSERT INTO bkk_start_events (page,kind,src,tag,lang,ch) VALUES ($1,$2,$3,$4,$5,$6)`,
        [page, kind, landingCode(b.src), tag, clean(b.lang, 5), page === 'start' ? clean(b.ch, 10) : null]);
      res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Who gets the Monday letter by email. csv=1 gives the send list: confirmed
  // addresses only, each with its own unsubscribe link for the letter footer.
  app.get('/api/bkk/admin/newsletter', async (req, res) => {
    if (adminOnly(req, res)) return;
    try {
      const counts = (await q(`SELECT status, coalesce(lang,'en') AS lang, count(*)::int AS n
        FROM bkk_newsletter GROUP BY 1,2 ORDER BY 1,2`)).rows;
      if (req.query.csv) {
        const rows = (await q(`SELECT email, coalesce(lang,'en') AS lang, confirmed_at, token
          FROM bkk_newsletter WHERE status='confirmed' ORDER BY confirmed_at`)).rows;
        // A spreadsheet runs a cell that starts with = + - @ as a formula, and the
        // local part of an address is the signer's to choose.
        const cell = v => `"${String(v ?? '').replace(/^[=+\-@\t\r]/, "'$&").replace(/"/g, '""')}"`;
        const lines = [['email', 'lang', 'confirmed_at', 'unsubscribe_url'].join(',')].concat(rows.map(r =>
          [r.email, r.lang, r.confirmed_at && r.confirmed_at.toISOString(),
           `${baseUrl()}/api/bkk/newsletter/unsubscribe/${r.token}`].map(cell).join(',')));
        res.set('Content-Type', 'text/csv; charset=utf-8')
          .set('Content-Disposition', 'attachment; filename="aybkk-letter-emails.csv"')
          .set('Cache-Control', 'no-store');
        return res.send('\ufeff' + lines.join('\n'));
      }
      // Which door the letter box's visitors take (LINE, WeChat, Telegram, email).
      const doors = (await q(`SELECT coalesce(ch,'-') AS ch, count(*)::int AS n FROM bkk_start_events
        WHERE page='start' AND src='letter' AND kind='tap' AND created_at > now() - interval '30 days' GROUP BY 1 ORDER BY n DESC`)).rows;
      res.json({ success: true, counts, doors });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.get('/api/bkk/admin/start-stats', async (req, res) => {
    if (adminOnly(req, res)) return;
    try {
      const { rows } = await q(
        `SELECT coalesce(src, '-') AS src, count(*) FILTER (WHERE kind = 'view')::int AS views,
           count(*) FILTER (WHERE kind = 'tap')::int AS taps
         FROM bkk_start_events WHERE page='start' AND created_at > now() - interval '30 days' AND src IS DISTINCT FROM 'letter'
         GROUP BY 1 ORDER BY taps DESC, views DESC LIMIT 30`);
      res.json({ success: true, sources: rows });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Landing pages by week (18 Nov 2026): Monday to Sunday in Bangkok, the last LANDING_WEEKS
  // weeks, newest first. Each page's ladder, and the same numbers split by source (?src=) and by
  // headline tag (?for=), so the owner sees which source and which step loses people. Counts only:
  // the rows hold no name, address or member id. The letter box's taps are not /start's.
  app.get('/api/bkk/admin/landing-weeks', async (req, res) => {
    if (adminOnly(req, res)) return;
    try {
      const since = `date_trunc('week', now() AT TIME ZONE 'Asia/Bangkok') - interval '${LANDING_WEEKS - 1} weeks'`;
      const weeks = (await q(`SELECT to_char(${since} + i * interval '1 week', 'YYYY-MM-DD') AS w
        FROM generate_series(${LANDING_WEEKS - 1}, 0, -1) i`)).rows.map(r => r.w);
      // Only the (page, number) pairs the box shows are read; the database does the adding up, so
      // the answer stays small however many rows or sources there are.
      const pairs = Object.entries(LANDING_COLS).flatMap(([p, cols]) => cols.map(c => [p, c]));
      const ends = i => `CASE page ${Object.entries(LANDING_COLS).map(([p, c]) => `WHEN '${p}' THEN '${c[i < 0 ? c.length - 1 : i]}'`).join(' ')} END`;
      const kept = `SELECT * FROM (SELECT page, src, tag, ch,
          to_char(date_trunc('week', created_at AT TIME ZONE 'Asia/Bangkok'), 'YYYY-MM-DD') AS week,
          CASE WHEN kind <> 'step' THEN kind WHEN ch LIKE 'done%' THEN 'done' ELSE ch END AS k
        FROM bkk_start_events
        WHERE created_at >= (${since}) AT TIME ZONE 'Asia/Bangkok' AND (page <> 'start' OR src IS DISTINCT FROM 'letter')) e
        WHERE (page, k) IN (SELECT * FROM unnest($1::text[], $2::text[]))`;
      const args = [pairs.map(x => x[0]), pairs.map(x => x[1])];
      // A split keeps its LANDING_SPLIT_TOP biggest (by the ladder's first number, then its last);
      // the rest is one "other" row, so a week's split always adds up to the week.
      const split = dim => q(`WITH e AS (${kept}),
          g AS (SELECT page, week, ${dim} AS key, k, count(*)::int AS n FROM e GROUP BY 1, 2, 3, 4),
          r AS (SELECT page, week, key, row_number() OVER (PARTITION BY page, week ORDER BY
              coalesce(sum(n) FILTER (WHERE k = ${ends(0)}), 0) DESC, coalesce(sum(n) FILTER (WHERE k = ${ends(-1)}), 0) DESC,
              key NULLS LAST) AS rn
            FROM g GROUP BY 1, 2, 3)
        SELECT g.page, g.week, CASE WHEN r.rn <= $3 THEN g.key END AS key, least(r.rn, $3 + 1)::int AS rn, g.k, sum(g.n)::int AS n
        FROM g JOIN r ON r.page = g.page AND r.week = g.week AND r.key IS NOT DISTINCT FROM g.key
        GROUP BY 1, 2, 3, 4, 5`, [...args, LANDING_SPLIT_TOP]);
      const [totals, bySrc, byTag, rules] = await Promise.all([
        q(`SELECT page, week, k, count(*)::int AS n FROM (${kept}) e GROUP BY 1, 2, 3`, args),
        split('src'), split('tag'),
        // The real-fit rule each week's sent and fit rows were counted with (inbox.js REAL_FIT_ID).
        q(`SELECT DISTINCT page, week, ch FROM (${kept}) e WHERE k IN ('sent', 'fit') AND ch IS NOT NULL`, args),
      ]);
      const zero = cols => Object.fromEntries(cols.map(c => [c, 0]));
      // The agreement's counts show once it is on (or once it has any).
      const bookOn = await consentMode() !== 'off' || totals.rows.some(r => r.page === 'book');
      const pages = Object.entries(LANDING_COLS).filter(([page]) => page !== 'book' || bookOn).map(([page, cols]) => ({ page, cols,
        weeks: weeks.map(week => ({ week, n: zero(cols), bySrc: new Map(), byTag: new Map(), olderRule: false })) }));
      const at = r => { const p = pages.find(x => x.page === r.page); return p && p.weeks.find(x => x.week === r.week); };
      for (const r of totals.rows) { const w = at(r); if (w) w.n[r.k] += r.n; }
      for (const r of rules.rows) { const w = at(r); if (w && r.ch !== REAL_FIT_ID) w.olderRule = true; }
      for (const [rows, name, field] of [[bySrc.rows, 'src', 'bySrc'], [byTag.rows, 'tag', 'byTag']]) {
        for (const r of rows) {
          const w = at(r);
          if (!w) continue;
          const cols = pages.find(x => x.page === r.page).cols;
          if (!w[field].has(r.rn)) w[field].set(r.rn, r.rn > LANDING_SPLIT_TOP ? { other: true, n: zero(cols) } : { [name]: r.key, n: zero(cols) });
          w[field].get(r.rn).n[r.k] += r.n;
        }
      }
      for (const p of pages) for (const w of p.weeks) for (const f of ['bySrc', 'byTag']) {
        w[f] = [...w[f]].sort((x, y) => x[0] - y[0]).map(x => x[1]);
      }
      res.json({ success: true, weeks, pages, fitRule: REAL_FIT, fitRuleId: REAL_FIT_ID });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // One look at whether the profile work is being done (Boonchu, 3 Oct): who is
  // in the system, who got a link and opened it, photos and notes today.
  app.get('/api/bkk/admin/progress', async (req, res) => {
    if (adminOnly(req, res)) return;
    try {
      const today = `(now() AT TIME ZONE 'Asia/Bangkok')::date`;
      const one = async (sql) => (await q(sql)).rows[0];
      const [members, links, photos, notes] = await Promise.all([
        one(`SELECT count(*)::int AS total,
               count(*) FILTER (WHERE email IS NOT NULL)::int AS with_email,
               count(*) FILTER (WHERE EXISTS (SELECT 1 FROM bkk_passes p WHERE p.member_id = m.id AND p.status = 'active'
                 AND (p.valid_until IS NULL OR p.valid_until >= ${today})))::int AS active
             FROM bkk_members m WHERE m.merged_into IS NULL`),
        // sent: links staff made for a chat. A desk QR reaches nobody until it is
        // scanned, so it counts apart, as students signed in by QR (and in opened).
        one(`SELECT count(DISTINCT member_id) FILTER (WHERE ip = 'staff')::int AS sent,
               count(DISTINCT member_id) FILTER (WHERE used_at IS NOT NULL)::int AS opened,
               count(*) FILTER (WHERE ip = 'staff' AND (created_at AT TIME ZONE 'Asia/Bangkok')::date = ${today})::int AS sent_today,
               count(DISTINCT member_id) FILTER (WHERE ip = 'qr' AND used_at IS NOT NULL)::int AS qr,
               count(DISTINCT member_id) FILTER (WHERE ip = 'qr' AND (used_at AT TIME ZONE 'Asia/Bangkok')::date = ${today})::int AS qr_today
             FROM bkk_login_tokens`),
        one(`SELECT count(*) FILTER (WHERE p.class_date = ${today})::int AS today,
               count(*) FILTER (WHERE p.class_date = ${today}
                 AND NOT EXISTS (SELECT 1 FROM bkk_photo_members pm WHERE pm.photo_id = p.id))::int AS untagged_today,
               (SELECT count(DISTINCT pm.member_id) FROM bkk_photo_members pm JOIN bkk_photos x ON x.id = pm.photo_id
                 WHERE x.class_date = ${today})::int AS students_today,
               count(*)::int AS total,
               (SELECT count(DISTINCT member_id) FROM bkk_photo_members)::int AS students_total
             FROM bkk_photos p`),
        one(`SELECT count(*) FILTER (WHERE (created_at AT TIME ZONE 'Asia/Bangkok')::date = ${today})::int AS today,
               count(*)::int AS total FROM bkk_notes`),
      ]);
      const byTeacher = (await q(
        `SELECT t.name, count(*)::int AS n FROM bkk_notes n JOIN bkk_teachers t ON t.id = n.teacher_id
         WHERE (n.created_at AT TIME ZONE 'Asia/Bangkok')::date = ${today} GROUP BY t.name ORDER BY n DESC`)).rows;
      const uploaders = (await q(
        `SELECT t.name, count(*)::int AS n FROM bkk_photos p JOIN bkk_teachers t ON t.id = p.uploaded_by
         WHERE p.class_date = ${today} GROUP BY t.name ORDER BY n DESC`)).rows;
      res.json({ members, links, photos, notes: { ...notes, byTeacher }, uploaders });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.get('/api/bkk/admin/today', async (req, res) => {
    if (!isAdmin(req)) return res.status(401).json({ error: 'bad key' });
    try {
      const today = bkkToday();
      // pass_name / dropin let the door label a row: a drop-in, or a Rezerv seat.
      // photo: the student's face, so the door can greet them by name. consent: signed the
      // agreement, only while it is on.
      const on = await consentMode() !== 'off';
      const r = await q(
        `SELECT s.title, b.class_date, b.start_at, m.name, m.code, m.photo_id, b.checked_in_at,${on ? ` ${SIGNED('m.id')} AS consent,` : ''}
           b.slot_id, b.cover, b.source, b.need_mat, pr.name_en AS pass_name,
           coalesce(pr.kind = 'credits' AND pr.credits = 1, false) AS dropin
         FROM bkk_bookings b JOIN bkk_class_slots s ON s.id=b.slot_id
         JOIN bkk_members m ON m.id=b.member_id
         LEFT JOIN bkk_passes p ON p.id=b.pass_id LEFT JOIN bkk_products pr ON pr.id=p.product_id
         WHERE b.status='booked' AND b.class_date = $1::date
         ORDER BY b.start_at, m.name`, [today]);
      const money = (await q(
        `SELECT method, count(*)::int AS n, sum(amount_thb)::int AS total FROM bkk_orders
         WHERE status='paid' AND amount_thb > 0
           AND (verified_at AT TIME ZONE 'Asia/Bangkok')::date = (now() AT TIME ZONE 'Asia/Bangkok')::date
         GROUP BY method ORDER BY method`)).rows;
      // Today's whole timetable, booked or not: the door built its tabs from
      // bookings, so a class nobody had booked could not take a walk-in.
      let classes = [];
      if (!moonDaysBetween(today, today).size) {
        const wd = new Date(`${today}T12:00:00${TZ_OFFSET}`).getUTCDay();
        const [slots, ovs] = await Promise.all([
          q('SELECT * FROM bkk_class_slots WHERE active AND weekday=$1 ORDER BY start_time, id', [wd]),
          q('SELECT * FROM bkk_class_overrides WHERE class_date=$1::date', [today]),
        ]);
        classes = slots.rows.map(s => {
          const ov = ovs.rows.find(o => o.slot_id === s.id);
          if (ov && ov.cancelled) return null;
          const list = r.rows.filter(b => b.slot_id === s.id);
          return { slotId: s.id, date: today, title: s.title, startAt: startAtISO(today, s.start_time),
            durationMin: s.duration_min, isOnline: s.is_online, capacity: (ov && ov.capacity != null) ? ov.capacity : s.capacity,
            booked: list.length, checkedIn: list.filter(b => b.checked_in_at).length,
            mats: list.filter(b => b.need_mat).length };
        }).filter(Boolean);
      }
      res.json({ bookings: r.rows.map(({ photo_id, ...b }) => ({ ...b, photo: faceSmall(photo_id, b.code) })), money, classes });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Links Boonchu can change himself. An allowlist, not a free-for-all: this
  // writes a table the public read below serves, so an arbitrary key here would
  // be an arbitrary value on the student page.
  const LINK_KEYS = ['instagram', 'youtube', 'tiktok', 'line', 'wechat', 'facebook', 'shop', 'telegram'];

  app.get('/api/bkk/settings', async (req, res) => {
    try {
      const r = await q(`SELECT key, value FROM bkk_settings WHERE key = ANY($1::text[])`,
        [LINK_KEYS.map(k => 'link_' + k)]);
      const links = {};
      for (const row of r.rows) {
        const v = typeof row.value === 'string' ? row.value : (row.value ?? '');
        if (v) links[row.key.replace(/^link_/, '')] = v;
      }
      res.json({ links });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // The team LINE group briefs (team-brief.js): the morning teaching brief (05:00
  // to 06:00 by weekday), the 20:00 summary, and their language. Off until switched on here.
  const TEAM_SETTINGS = { teamBriefMorning: ['team_brief_morning', ['on', 'off']],
    teamBriefEvening: ['team_brief_evening', ['on', 'off']], teamBriefLang: ['team_brief_lang', ['th', 'en']] };
  const teamSettings = async () => {
    const r = await q(`SELECT key, value FROM bkk_settings WHERE key = ANY($1::text[])`,
      [Object.values(TEAM_SETTINGS).map(([k]) => k)]);
    const v = k => (r.rows.find(x => x.key === k) || {}).value;
    return { morning: v('team_brief_morning') === 'on' ? 'on' : 'off',
      evening: v('team_brief_evening') === 'on' ? 'on' : 'off', lang: v('team_brief_lang') === 'en' ? 'en' : 'th' };
  };

  // The booking window and the last month whose teachers students see. due: the
  // next month starts within 7 days and its teachers are not confirmed yet.
  // showMonth: the one month the Show button confirms, never one already over:
  // this month when it started with no teacher names (teachersLate). Due: it
  // starts within 7 days, or has started.
  async function bookingSettings() {
    const today = bkkToday(), through = await teachersThrough(), cur = today.slice(0, 7);
    const after = m => addDaysYmd(`${m}-28`, 7).slice(0, 7);
    const show = after(through) > cur ? after(through) : cur;
    return { openUntil: await openUntil(), teachersThrough: through, nextMonth: after(cur), showMonth: show,
      teachersLate: through < cur, teachersDue: addDaysYmd(today, 7) >= `${show}-01`,
      min: addDaysYmd(today, SCHEDULE_DAYS - 1), max: addDaysYmd(today, OPEN_MAX_DAYS) };
  }

  // What keeps the agreement off: a language the current version lacks, or a privacy fact not filled in.
  const consentGaps = priv => [...CONSENT_LANGS.filter(l => !consentLangs().includes(l)).map(l => `${l.toUpperCase()} text`),
    ...Object.keys(PRIVACY_KEYS).filter(k => !priv[k]).map(k => `privacy ${k}`)];
  async function consentSettings() {
    const [mode, priv, since] = await Promise.all([consentMode(), privacySettings(), getSetting('consent_since', null)]);
    const missing = consentGaps(priv);
    return { mode, version: CONSENT_VERSION, langs: consentLangs(), privacy: priv, privacyFilled: Object.values(priv).every(Boolean),
      since: typeof since === 'string' ? since : null, canTurnOn: !missing.length, missing };
  }

  // What the Settings tab shows. Telegram: whether the token and chat are set
  // (never their values) and how the last send went.
  app.get('/api/bkk/admin/settings', async (req, res) => {
    if (!isAdmin(req)) return res.status(401).json({ error: 'bad key' });
    res.set('Cache-Control', 'private, no-store');
    try {
      res.json({ surchargePct: await surcharge(), teamBrief: await teamSettings(),
        payWatch: await payWatchSettings(), telegram: await telegramStatus(), payment: { mode: paymentStatus().mode },
        booking: await bookingSettings(), consent: await consentSettings(), photos: { dailyCap: await photosCap() } });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // A test ping on demand, for the day pings stop arriving: which bot the
  // server's token belongs to (its @name and id, both public) and Telegram's own
  // answer, so a wrong or replaced token, a missing chat or a bot never started
  // shows on the page. Never the token or the chat id.
  app.post('/api/bkk/admin/telegram/test', async (req, res) => {
    if (!isAdmin(req)) return res.status(401).json({ error: 'bad key' });
    res.set('Cache-Control', 'private, no-store');
    try {
      const token = process.env.TELEGRAM_BOT_TOKEN;
      const out = { tokenSet: !!token, chatSet: !!process.env.BOONCHU_CHAT_ID, bot: null, botError: null, sent: false, error: null };
      if (token) {
        try {
          const r = await fetch(`${tgBase()}/bot${token}/getMe`, { signal: AbortSignal.timeout(10000) });
          const j = await r.json().catch(() => ({}));
          if (r.ok && j.ok && j.result) out.bot = { username: j.result.username ? String(j.result.username).slice(0, 64) : null,
            id: Number.isFinite(Number(j.result.id)) ? Number(j.result.id) : null };
          else out.botError = `http ${r.status}${j.description ? ': ' + String(j.description).split(token).join('[token]').slice(0, 120) : ''}`;
        } catch (e) { out.botError = e.name === 'TimeoutError' ? 'timeout' : (e.cause && e.cause.code) || 'network error'; }
      }
      if (out.tokenSet && out.chatSet && !out.botError) {
        const n = await notify('✓ AYBKK test ping from the admin page. If you see this, payment pings reach you.');
        out.sent = !!n.ok; out.error = n.ok ? null : n.error;
      }
      out.telegram = await telegramStatus();
      res.json(out);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.post('/api/bkk/admin/settings', async (req, res) => {
    if (!isAdmin(req)) return res.status(401).json({ error: 'bad key' });
    try {
      const b = req.body || {};
      const team = [];
      for (const [field, [key, allowed]] of Object.entries(TEAM_SETTINGS)) {
        if (b[field] === undefined) continue;
        const val = b[field] === true ? 'on' : b[field] === false ? 'off' : String(b[field]);
        if (!allowed.includes(val)) return res.status(400).json({ error: `${field} must be ${allowed.join(' or ')}` });
        team.push([key, val]);
      }
      for (const [field, [key]] of Object.entries(PAY_KEYS)) {
        if (b[field] === undefined) continue;
        const val = b[field] === true ? 'on' : b[field] === false ? 'off' : b[field];
        if (!['on', 'off'].includes(val)) return res.status(400).json({ error: `${field} must be on or off` });
        team.push([key, val]);
      }
      if (b.dailyMoneyAt !== undefined) {
        const at = typeof b.dailyMoneyAt === 'string' ? b.dailyMoneyAt.trim().replace(/^(\d):/, '0$1:') : '';
        if (!isClock(at)) return res.status(400).json({ error: 'dailyMoneyAt must be a Bangkok time, HH:MM' });
        team.push([MONEY_AT[0], at]);
      }
      if (b.surchargePct !== undefined) team.push(['surcharge_pct', Number(b.surchargePct)]);
      if (b.photosDailyCap !== undefined) {
        const n = Number(b.photosDailyCap);
        if (!Number.isInteger(n) || n < 0 || n > 5000) return res.status(400).json({ error: 'photosDailyCap must be a whole number from 0 (no limit) to 5000' });
        team.push(['photos_daily_cap', n]);
      }
      if (b.bookingOpenUntil !== undefined) {
        const d = String(b.bookingOpenUntil || '').trim(), today = bkkToday();
        if (!isYmd(d) || d < addDaysYmd(today, SCHEDULE_DAYS - 1) || d > addDaysYmd(today, OPEN_MAX_DAYS))
          return res.status(400).json({ error: `bookingOpenUntil must be a date from ${addDaysYmd(today, SCHEDULE_DAYS - 1)} to ${addDaysYmd(today, OPEN_MAX_DAYS)}` });
        team.push(['booking_open_until', d]);
      }
      if (b.teachersThrough !== undefined) {
        const m = String(b.teachersThrough || '').trim();
        if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(m) || m < bkkToday().slice(0, 7) || m > addDaysYmd(bkkToday(), OPEN_MAX_DAYS).slice(0, 7))
          return res.status(400).json({ error: 'teachersThrough must be a month (YYYY-MM), this month or later' });
        team.push(['teachers_shown_through', m]);
      }
      // The agreement switch and the privacy notice's three facts. The switch leaves off only when
      // the current version is in all 4 languages and those facts are filled in, as they would be after this save.
      const priv = await privacySettings();
      for (const [field, k, max] of [['privacyName', 'name', 200], ['privacyAddress', 'address', 400], ['privacyEmail', 'email', 200]]) {
        if (b[field] === undefined) continue;
        const v = typeof b[field] === 'string' ? b[field].replace(/\s+/g, ' ').trim() : null;
        if (v === null || v.length > max || /[<>{}]/.test(v)) return res.status(400).json({ error: `${field}: plain text, up to ${max} characters` });
        if (k === 'email' && v && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return res.status(400).json({ error: 'privacyEmail must be an email address' });
        priv[k] = v;
        team.push([PRIVACY_KEYS[k], v]);
      }
      const modeWas = await consentMode();
      let mode = modeWas;
      if (b.consentMode !== undefined) {
        if (!CONSENT_MODES.includes(b.consentMode)) return res.status(400).json({ error: `consentMode must be ${CONSENT_MODES.join(', ')}` });
        mode = b.consentMode;
      }
      if (mode !== 'off') {
        const gaps = consentGaps(priv);
        if (gaps.length) return res.status(400).json({ error: `the agreement cannot be on yet: ${gaps.join(', ')} missing`, missing: gaps });
      }
      if (b.consentMode !== undefined) team.push(['consent_mode', mode]);
      const links = b.links || {};
      for (const k of LINK_KEYS) {
        if (links[k] === undefined) continue;
        const url = String(links[k] || '').trim();
        // Empty clears the link. Anything else must be a real http(s) URL —
        // a typo here becomes a broken button on every student's page.
        if (url && !/^https?:\/\/[^\s]+$/i.test(url)) {
          return res.status(400).json({ error: `${k} must be a full https:// link, or empty to remove` });
        }
        team.push(['link_' + k, url]);
      }
      // Everything is checked before anything is saved: a 400 saves nothing.
      for (const [key, val] of team) {
        await q(`INSERT INTO bkk_settings (key,value) VALUES ($1,$2)
                 ON CONFLICT (key) DO UPDATE SET value=$2, updated_at=now()`, [key, JSON.stringify(val)]);
      }
      // The policy's "a pass bought before ..." is the day the agreement first went on.
      if (mode !== 'off') await q(`INSERT INTO bkk_settings (key,value) VALUES ('consent_since',$1) ON CONFLICT (key) DO NOTHING`,
        [JSON.stringify(bkkToday())]);
      if (mode !== modeWas) console.log(`✓ bkk: student agreement ${modeWas} → ${mode}`);
      res.json({ success: true, surchargePct: await surcharge(), teamBrief: await teamSettings(),
        payWatch: await payWatchSettings(), telegram: await telegramStatus(), booking: await bookingSettings(),
        consent: await consentSettings(), photos: { dailyCap: await photosCap() } });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ── running the shala ─────────────────────────────────────────────────────
  // Everything below exists because Rezerv can do it and this could not, which
  // meant the only way to close a class, pause a pass for an injury, or find a
  // student who lost their code was hand-written SQL against production.

  const adminOnly = (req, res) => {
    if (isAdmin(req)) return false;
    res.status(401).json({ error: 'bad key' });
    return true;
  };

  // ── tees (baht, PaySolutions link per tee) ───────────────────────────────
  const teeOut = t => ({ id: t.id, name: t.name, priceThb: t.price_thb, payLink: t.pay_link,
    photo: t.photo, sizes: t.sizes, active: t.active, sort: t.sort });
  app.get('/api/bkk/tees', async (req, res) => {
    try {
      const r = await q('SELECT * FROM bkk_tees WHERE active ORDER BY sort, id');
      res.json({ tees: r.rows.map(teeOut) });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
  app.get('/api/bkk/admin/tees', async (req, res) => {
    if (adminOnly(req, res)) return;
    try {
      const r = await q('SELECT * FROM bkk_tees ORDER BY sort, id');
      res.json({ tees: r.rows.map(teeOut) });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
  // With an id it changes that tee; without, it adds one.
  app.post('/api/bkk/admin/tees', async (req, res) => {
    if (adminOnly(req, res)) return;
    try {
      const b = req.body || {};
      const name = String(b.name || '').trim().slice(0, 120);
      const price = Number(b.priceThb);
      const link = String(b.payLink || '').trim();
      const photo = String(b.photo || '').trim();
      if (!name) return res.status(400).json({ error: 'name required' });
      if (!(Number.isInteger(price) && price > 0)) return res.status(400).json({ error: 'price must be a whole number of baht' });
      if (!/^https:\/\/\S+$/.test(link)) return res.status(400).json({ error: 'payment link must start with https://' });
      if (photo && !/^(https:\/\/|\/)\S+$/.test(photo)) return res.status(400).json({ error: 'photo must be a link (https://…) or a site path (/img/…)' });
      const vals = [name, price, link, photo || null, String(b.sizes || '').trim().slice(0, 120) || null,
        b.active !== false, Number.isInteger(Number(b.sort)) ? Number(b.sort) : 0];
      const r = b.id
        ? await q(`UPDATE bkk_tees SET name=$1, price_thb=$2, pay_link=$3, photo=$4, sizes=$5, active=$6, sort=$7
                   WHERE id=$8 RETURNING *`, [...vals, Number(b.id)])
        : await q(`INSERT INTO bkk_tees (name, price_thb, pay_link, photo, sizes, active, sort)
                   VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`, vals);
      if (!r.rows.length) return res.status(404).json({ error: 'tee not found' });
      res.json({ success: true, tee: teeOut(r.rows[0]) });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ── the tee pre-order (24 Nov 2026) ───────────────────────────────────────
  // A drop of tees sold for about 7 days to students in China, paid through PaySolutions and
  // collected from an AYBKK team member in the buyer's city: no shipping, no postal address.
  // Stock is never counted down: teeTaken reads it from the lines. Every order made and every
  // payment turned on first locks the drop's row, so a cap is exact; a lapsed hold, a void or a
  // cancel frees its tees with no sweep. Times are the money clock (nowMs).
  const at = ms => new Date(ms);
  const isoBkk = v => new Date(new Date(v).getTime() + 7 * 3600000).toISOString().slice(0, 19) + TZ_OFFSET;
  const bkkMinute = v => isoBkk(v).slice(0, 16).replace('T', ' ');
  const parseBkkMinute = s => {
    const m = /^(\d{4}-\d{2}-\d{2})[ T]([01]\d|2[0-3]):([0-5]\d)$/.exec(String(s ?? '').trim());
    return m && realYmd(m[1]) ? Date.parse(`${m[1]}T${m[2]}:${m[3]}:00${TZ_OFFSET}`) : null;
  };
  const teeOpen = (d, now) => !!d && d.published && !d.done_at && new Date(d.opens_at).getTime() <= now && now < new Date(d.closes_at).getTime();
  const teeState = (d, now) => now < new Date(d.opens_at).getTime() ? 'soon' : teeOpen(d, now) ? 'open' : 'closed';
  const teeLang = l => l === 'zh' ? 'zh' : 'en';
  const pickLang = (j, l) => (j && typeof j === 'object' && (j[l] || j.en || j.zh)) || '';
  const pickupsOf = d => Array.isArray(d.pickups) ? d.pickups : [];
  const qtyOf = lines => lines.reduce((n, l) => n + l.qty, 0);
  // The buyer's page and the staff list say the same thing: the tee order's own state once it is
  // paid or ended, else the money row's (a void), else whether the hold still runs. A wrong amount comes first:
  // money came in, even on an order that was let go or cancelled, and staff must refund it.
  const TEE_VIEW = n => `CASE WHEN o.status = 'mismatch' THEN 'mismatch' WHEN t.status <> 'new' THEN t.status
    WHEN o.status = 'paid' THEN 'paid' WHEN o.status IN ('void','twin') THEN 'cancelled'
    WHEN t.hold_until > ${n} THEN 'waiting' ELSE 'expired' END`;
  function teeView(t, money, now) {
    if (money === 'mismatch') return 'mismatch';
    if (t.status !== 'new') return t.status;
    if (money === 'paid') return 'paid';
    if (money === 'void' || money === 'twin') return 'cancelled';
    return new Date(t.hold_until).getTime() > now ? 'waiting' : 'expired';
  }
  // Taken: lines of paid and handed orders, and of holds still live on an unpaid money row.
  // except: one order left out (its own payment being turned on, or its size being swapped).
  async function teeTaken(db, dropId, now, except = null) {
    const r = await db.query(`SELECT l.stock_id,
        coalesce(sum(l.qty) FILTER (WHERE t.status IN ('paid','handed')), 0)::int AS sold,
        coalesce(sum(l.qty) FILTER (WHERE t.status = 'new' AND t.hold_until > $2 AND o.status = 'pending'), 0)::int AS held
      FROM bkk_tee_lines l JOIN bkk_tee_orders t ON t.order_id = l.order_id JOIN bkk_orders o ON o.id = t.order_id
      WHERE t.drop_id = $1 AND ($3::int IS NULL OR t.order_id <> $3) GROUP BY l.stock_id`, [dropId, at(now), except]);
    return new Map(r.rows.map(x => [x.stock_id, { sold: x.sold, held: x.held }]));
  }
  const takenOf = (m, id) => { const x = m.get(id); return x ? x.sold + x.held : 0; };
  const takenAll = m => [...m.values()].reduce((n, x) => n + x.sold + x.held, 0);
  // The lines that do not fit: each tee's own cap, then the drop's cap for all its tees together.
  function teeShort(drop, stock, taken, lines) {
    const byId = new Map(stock.map(s => [s.id, s]));
    const short = lines.filter(l => { const s = byId.get(l.stockId); return !s || s.cap - takenOf(taken, l.stockId) < l.qty; })
      .map(l => l.stockId);
    const dropFull = drop.cap - takenAll(taken) < qtyOf(lines);
    return { short, dropFull, soldOut: short.length ? short : dropFull ? lines.map(l => l.stockId) : [] };
  }
  const teeStockRows = (db, dropId) => db.query('SELECT * FROM bkk_tee_stock WHERE drop_id=$1 ORDER BY sort, id', [dropId]).then(r => r.rows);
  // The tee notice for a page, filled in; ready once the three privacy facts are in Settings.
  async function teeNotice(lang, purgeDays) {
    const v = TEE_NOTICE_VERSION, l = TEE_NOTICE[v][lang] ? lang : 'en', x = TEE_NOTICE[v][l];
    const priv = await privacySettings();
    const fill = s => s.replace(/\{(legal_name|address|email|purge_days)\}/g, (all, k) =>
      k === 'purge_days' ? String(purgeDays) : priv[k === 'legal_name' ? 'name' : k] || all);
    const missing = Object.keys(PRIVACY_KEYS).filter(k => !priv[k]);
    return { version: v, lang: l, sha: teeNoticeSha(v, l), ready: !missing.length, missing,
      text: { title: x.title, sections: x.sections.map(([h, p]) => [h, fill(p)]), tick: x.tick } };
  }
  // The pick list for the page: one card per design, its colours and sizes, and only
  // 'ok' / 'few' / 'out' per size: never a stock number.
  function teeDesigns(drop, stock, taken, lang) {
    const L = teeLang(lang), dropLeft = drop.cap - takenAll(taken), designs = [];
    for (const s of stock) {
      let d = designs.find(x => x.design === s.design);
      if (!d) designs.push(d = { design: s.design, name: pickLang(s.design_name, L), photo: null, priceThb: s.price_thb, colours: [] });
      d.priceThb = Math.min(d.priceThb, s.price_thb);
      if (!d.photo && s.photo) d.photo = s.photo;
      let c = d.colours.find(x => x.colour === s.colour);
      if (!c) d.colours.push(c = { colour: s.colour, name: pickLang(s.colour_name, L), photo: null, sizes: [] });
      if (!c.photo && s.photo) c.photo = s.photo;
      const left = Math.min(s.cap - takenOf(taken, s.id), dropLeft);
      c.sizes.push({ stockId: s.id, size: s.size, priceThb: s.price_thb, state: left <= 0 ? 'out' : left <= TEE_FEW ? 'few' : 'ok' });
    }
    for (const d of designs) for (const c of d.colours) c.sizes.sort((a, b) => TEE_SIZES.indexOf(a.size) - TEE_SIZES.indexOf(b.size));
    return designs;
  }
  // The items of one order or of a whole drop (orderIds), names in the buyer's language.
  async function teeItems(db, orderIds, lang) {
    const L = teeLang(lang);
    const rows = (await db.query(`SELECT l.order_id, l.stock_id, l.qty, l.unit_thb, s.design, s.design_name, s.colour,
        s.colour_name, s.size, s.photo FROM bkk_tee_lines l JOIN bkk_tee_stock s ON s.id = l.stock_id
      WHERE l.order_id = ANY($1::int[]) ORDER BY s.sort, s.id`, [orderIds])).rows;
    const by = new Map(orderIds.map(id => [id, []]));
    for (const r of rows) by.get(r.order_id).push({ stockId: r.stock_id, design: r.design, designName: pickLang(r.design_name, L),
      colour: r.colour, colourName: pickLang(r.colour_name, L), size: r.size, qty: r.qty, unitThb: r.unit_thb, photo: r.photo });
    return by;
  }
  const TEE_TEXT_BAD = /[<>"'&\u0000-\u001f\u007f]/;
  function readTeeLines(raw, max) {
    if (!Array.isArray(raw) || !raw.length || raw.length > 20) return { error: 'choose at least one tee' };
    const out = [];
    for (const l of raw) {
      const stockId = Number(l && l.stockId), qty = Number(l && l.qty);
      if (!Number.isInteger(stockId) || stockId <= 0 || !Number.isInteger(qty) || qty < 1 || qty > 10)
        return { error: 'each tee needs a stockId and a quantity from 1 to 10' };
      if (out.some(x => x.stockId === stockId)) return { error: 'the same tee is in the order twice' };
      out.push({ stockId, qty });
    }
    if (qtyOf(out) > max) return { error: `at most ${max} tees in one order`, max };
    return { value: out };
  }
  // The name the team member will know the buyer by, a WeChat ID (how they find each other), an
  // optional mainland mobile, and the email the receipt and PaySolutions get.
  function readTeeBuyer(b) {
    const name = String(b.name ?? '').replace(/\s+/g, ' ').trim();
    if (name.length < 2 || name.length > 30 || TEE_TEXT_BAD.test(name))
      return { error: 'name: 2 to 30 characters, the name the AYBKK team member will know you by', field: 'name' };
    const wechat = String(b.wechat ?? '').trim();
    if (!/^[^\s<>"'&]{1,40}$/.test(wechat)) return { error: 'wechat: your WeChat ID, up to 40 characters, no spaces', field: 'wechat' };
    const email = String(b.email ?? '').trim().toLowerCase();
    if (email.length > 100 || !/^[^\s@<>"'&]+@[^\s@<>"'&]+\.[^\s@<>"'&]+$/.test(email))
      return { error: 'email: the email address for your receipt', field: 'email' };
    let mobile = String(b.mobile ?? '').replace(/[\s\-()]/g, '');
    if (mobile) {
      mobile = mobile.replace(/^(?:\+|00)?86(?=1\d{10}$)/, '');
      if (!/^1[3-9]\d{9}$/.test(mobile)) return { error: 'mobile: a mainland China mobile number (11 digits), or leave it empty', field: 'mobile' };
    }
    return { name, wechat, email, mobile: mobile || null };
  }
  const teeLiveHolds = async (db, dropId, email, now) => (await db.query(`SELECT count(*)::int AS n
    FROM bkk_tee_orders t JOIN bkk_orders o ON o.id = t.order_id
    WHERE t.drop_id = $1 AND lower(t.email) = $2 AND t.status = 'new' AND t.hold_until > $3 AND o.status = 'pending'`,
    [dropId, email, at(now)])).rows[0].n;
  const TEE_HOLDS_ERROR = `This email already has ${TEE_HOLDS_PER_EMAIL} unpaid tee orders waiting. Pay one, or wait until it lapses.`;
  // Orders made from one address in the last hour, in memory only.
  const teeIpHits = new Map();
  const teeIpCount = (ip, now) => {
    if (teeIpHits.size > 10000) for (const [k, ts] of teeIpHits) if (!ts.some(t => t > now - 3600000)) teeIpHits.delete(k);
    const xs = (teeIpHits.get(ip) || []).filter(t => t > now - 3600000);
    if (xs.length) teeIpHits.set(ip, xs); else teeIpHits.delete(ip);
    return xs.length;
  };

  // The open drop, else the next one to open, else one closed in the last 14 days, else none.
  app.get('/api/bkk/tee-drop', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      const now = nowMs(), lang = TEE_LANGS.includes(req.query.lang) ? req.query.lang : 'en';
      const d = (await q(`SELECT * FROM bkk_tee_drops WHERE published AND done_at IS NULL
          AND closes_at > $1::timestamptz - interval '14 days'
        ORDER BY CASE WHEN opens_at <= $1 AND closes_at > $1 THEN 0 WHEN opens_at > $1 THEN 1 ELSE 2 END,
          CASE WHEN opens_at > $1 THEN opens_at END, closes_at DESC LIMIT 1`, [at(now)])).rows[0];
      if (!d) return res.json({ drop: null });
      const [stock, taken, pct, notice] = await Promise.all([teeStockRows(pool, d.id), teeTaken(pool, d.id, now), surcharge(),
        teeNotice(teeLang(lang), d.purge_days)]);
      res.json({ drop: { code: d.code, title: pickLang(d.title, teeLang(lang)), opensAt: isoBkk(d.opens_at), closesAt: isoBkk(d.closes_at),
        now: isoBkk(now), state: teeState(d, now), maxPerOrder: d.max_per_order, holdMin: d.hold_min, surchargePct: pct, vatPct: VAT_PCT,
        rmbRate: d.rmb_rate == null ? null : Number(d.rmb_rate), canPay: !!paysoConfig() && notice.ready,
        pickups: pickupsOf(d).map(p => ({ key: p.key, label: p.label })), designs: teeDesigns(d, stock, taken, lang), notice } });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // A tee order: checked in the order the page shows its errors, then one transaction that locks
  // the drop, checks what is left and writes the money row, the tee order and its lines. Never the
  // class agreement, whatever consent_mode says, and never pay.sn (a link cannot be verified).
  app.post('/api/bkk/tee-orders', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      const b = req.body || {}, now = nowMs();
      const d = (await q('SELECT * FROM bkk_tee_drops WHERE code=$1 AND published', [String(b.drop || '')])).rows[0];
      if (!d) return res.status(404).json({ error: 'no such tee pre-order' });
      const closedBody = dd => { const s = teeState(dd, now); return { error: s === 'soon' ? 'not open yet' : 'closed', state: s }; };
      if (!teeOpen(d, now)) return res.status(409).json(closedBody(d));
      const lines = readTeeLines(b.lines, d.max_per_order);
      if (lines.error) return res.status(400).json({ error: lines.error, field: 'lines', ...(lines.max ? { max: lines.max } : {}) });
      const stock = await teeStockRows(pool, d.id);
      if (lines.value.some(l => !stock.some(s => s.id === l.stockId)))
        return res.status(400).json({ error: 'a tee in this order is not in this pre-order', field: 'lines' });
      const pickup = pickupsOf(d).find(p => p.key === b.pickup);
      if (!pickup) return res.status(400).json({ error: 'choose a pickup point', field: 'pickup' });
      const who = readTeeBuyer(b);
      if (who.error) return res.status(400).json(who);
      const lang = TEE_LANGS.includes(b.lang) ? b.lang : 'en';
      const n = b.notice;
      if (!n || typeof n !== 'object' || n.version !== TEE_NOTICE_VERSION)
        return res.status(409).json({ error: 'notice', version: TEE_NOTICE_VERSION, ...(n && n.version ? { stale: true } : {}) });
      if (n.agree !== true) return res.status(409).json({ error: 'notice', version: TEE_NOTICE_VERSION });
      const notice = await teeNotice(teeLang(lang), d.purge_days);
      if (!notice.ready) return res.status(503).json({ error: 'The privacy notice is not filled in yet, so tee orders are closed until it is.',
        notReady: true, missing: notice.missing });
      if (await teeLiveHolds(pool, d.id, who.email, now) >= TEE_HOLDS_PER_EMAIL) return res.status(429).json({ error: TEE_HOLDS_ERROR, holds: true });
      const ip = guessIp(req);
      if (teeIpCount(ip, now) >= TEE_ORDERS_PER_IP_HOUR) return res.status(429).json({ error: 'Too many orders from here. Try again in an hour.' });
      const cfg = paysoConfig();
      if (!cfg) return res.status(503).json({ error: 'Online payment is not set up yet.', payUnavailable: true });

      const pct = await surcharge();
      const client = await pool.connect();
      let o = null, token = null, holdUntil = null;
      try {
        await client.query('BEGIN');
        const stop = async (code, body) => { await client.query('ROLLBACK'); res.status(code).json(body); return true; };
        const dl = (await client.query('SELECT * FROM bkk_tee_drops WHERE id=$1 FOR UPDATE', [d.id])).rows[0];
        if (!teeOpen(dl, now)) return await stop(409, closedBody(dl));
        if (await teeLiveHolds(client, d.id, who.email, now) >= TEE_HOLDS_PER_EMAIL) return await stop(429, { error: TEE_HOLDS_ERROR, holds: true });
        const st = await teeStockRows(client, d.id);
        const fit = teeShort(dl, st, await teeTaken(client, d.id, now), lines.value);
        if (fit.soldOut.length) return await stop(409, { error: 'sold out', soldOut: fit.soldOut });
        const price = new Map(st.map(s => [s.id, s.price_thb]));
        const base = lines.value.reduce((s, l) => s + l.qty * price.get(l.stockId), 0);
        const { fee, vat, total } = breakdown(base, pct);
        // The same refno retry as a package order: a clash in one millisecond is possible.
        for (let attempt = 0; attempt < 5 && !o; attempt++) {
          await client.query('SAVEPOINT o');
          try {
            o = (await client.query(`INSERT INTO bkk_orders (refno,kind,base_thb,fee_thb,vat_thb,amount_thb,method,item_name)
              VALUES ($1,'tee',$2,$3,$4,$5,'online',$6) RETURNING *`,
              [newRefno(), base, fee, vat, total, `AYBKK tee pre-order ${dl.code}`])).rows[0];
            await client.query('RELEASE SAVEPOINT o');
          } catch (e) {
            await client.query('ROLLBACK TO SAVEPOINT o');
            if (!/duplicate key/.test(e.message) || attempt === 4) throw e;
          }
        }
        token = crypto.randomBytes(16).toString('hex');
        holdUntil = now + dl.hold_min * 60000;
        await client.query(`INSERT INTO bkk_tee_orders (order_id,drop_id,token,hold_until,lang,pickup,name,wechat,mobile,email,
            notice_version,notice_sha,notice_lang) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
          [o.id, d.id, token, at(holdUntil), lang, pickup.key, who.name, who.wechat, who.mobile, who.email,
           notice.version, notice.sha, notice.lang]);
        for (const l of lines.value) await client.query(`INSERT INTO bkk_tee_lines (order_id,stock_id,qty,unit_thb) VALUES ($1,$2,$3,$4)`,
          [o.id, l.stockId, l.qty, price.get(l.stockId)]);
        await client.query('COMMIT');
      } catch (e) {
        await client.query('ROLLBACK').catch(() => {});
        throw e;
      } finally { client.release(); }
      if (!o) return;
      teeIpHits.set(ip, [...(teeIpHits.get(ip) || []), now]);
      res.json({ order: { refno: String(o.refno), amount: o.amount_thb, base: o.base_thb, fee: o.fee_thb, vat: o.vat_thb, holdUntil: isoBkk(holdUntil) },
        token, link: `${TEE_ORIGIN}/book#tee=${token}`,
        pay: buildPayForm(cfg, o, { name_en: `Tee ${d.code} x${qtyOf(lines.value)}` }, { email: who.email }) });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // The buyer's own view, by the token in their link. A money row still waiting is asked about
  // (at most once a minute per order) before it answers. Never the whole email, WeChat ID or mobile, except
  // the email inside a held order's pay form, which PaySolutions needs (only while the hold runs);
  // once the contact details are deleted, only where the order stands, its tees and the pickup point.
  const maskEmail = e => { const [u, dom] = String(e || '').split('@'); return dom ? `${u.slice(0, 1)}***@${dom}` : null; };
  const maskWechat = w => w ? (w.length > 3 ? `${w.slice(0, 2)}***${w.slice(-1)}` : `${w.slice(0, 1)}***`) : null;
  const maskMobile = m => m ? `${m.slice(0, 3)}****${m.slice(-4)}` : null;
  const TEE_ORDER_SQL = `SELECT t.*, o.refno, o.status AS money, o.checked_at, o.amount_thb, o.base_thb, o.fee_thb, o.vat_thb,
      o.gateway_note, d.code AS drop_code, d.title AS drop_title, d.pickups
    FROM bkk_tee_orders t JOIN bkk_orders o ON o.id = t.order_id JOIN bkk_tee_drops d ON d.id = t.drop_id`;
  app.get('/api/bkk/tee-orders/:token', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      const token = String(req.params.token || '');
      if (!/^[0-9a-f]{32}$/.test(token)) return res.status(404).json({ error: 'not found' });
      const load = async () => (await q(`${TEE_ORDER_SQL} WHERE t.token = $1`, [token])).rows[0];
      let t = await load();
      if (!t) return res.status(404).json({ error: 'not found' });
      const now = nowMs();
      if (t.money === 'pending') {
        const mine = await q(`UPDATE bkk_orders SET checked_at = $2 WHERE id = $1 AND status = 'pending'
          AND (checked_at IS NULL OR checked_at <= $2::timestamptz - interval '60 seconds') RETURNING id`, [t.order_id, at(now)]);
        if (mine.rows.length) {
          await verifyAndActivate(Number(t.refno)).catch(e => console.error('[bkk tee] status check failed:', e.message));
          t = await load();
        }
      }
      const L = TEE_LANGS.includes(req.query.lang) ? req.query.lang : t.lang;
      const p = pickupsOf(t).find(x => x.key === t.pickup);
      const status = teeView(t, t.money, now), pickup = { key: t.pickup, label: p ? p.label : null };
      const items = (await teeItems(pool, [t.order_id], L)).get(t.order_id);
      if (t.purged_at) return res.json({ status, kind: 'tee', refno: refno12(t.refno), items, pickup, purged: true });
      const when = v => v ? isoBkk(v) : null;
      // A hold still running can be paid from its link too: a lost tab, "Open in Browser" in WeChat
      // or a wallet that came back unpaid loses nothing. checking: past its hold, but the money row
      // is still open, so a payment that is on its way may yet land.
      const cfg = status === 'waiting' && paysoConfig();
      res.json({ status, kind: 'tee', refno: refno12(t.refno), drop: { code: t.drop_code, title: pickLang(t.drop_title, teeLang(L)) },
        items, qty: qtyOf(items), money: { base: t.base_thb, fee: t.fee_thb, vat: t.vat_thb, amount: t.amount_thb }, pickup,
        holdUntil: when(t.hold_until), createdAt: when(t.created_at), paidAt: when(t.paid_at), handedAt: when(t.handed_at),
        cancelledAt: when(t.cancelled_at), lang: t.lang, checking: status === 'expired' && t.money === 'pending',
        ...(cfg ? { pay: buildPayForm(cfg, { refno: t.refno, amount_thb: t.amount_thb },
          { name_en: `Tee ${t.drop_code} x${qtyOf(items)}` }, { email: t.email }) } : {}),
        buyer: { name: t.name, wechat: maskWechat(t.wechat), mobile: maskMobile(t.mobile), email: maskEmail(t.email) } });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // The buyer lets go of an unpaid order ("Change my order"), so its tees are free for the next
  // one at once. Only while it is still new on an open money row; a payment that lands later
  // still turns it on (activateTee puts a cancelled order back and tells staff).
  app.post('/api/bkk/tee-orders/:token/release', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    const token = String(req.params.token || '');
    if (!/^[0-9a-f]{32}$/.test(token)) return res.status(404).json({ error: 'not found' });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const t0 = (await client.query('SELECT order_id, drop_id FROM bkk_tee_orders WHERE token=$1', [token])).rows[0];
      if (!t0) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'not found' }); }
      await client.query('SELECT id FROM bkk_tee_drops WHERE id=$1 FOR UPDATE', [t0.drop_id]);
      const r = await client.query(`UPDATE bkk_tee_orders t SET status='cancelled', cancelled_at=$2 FROM bkk_orders o
        WHERE t.order_id=$1 AND o.id=t.order_id AND t.status='new' AND o.status IN ('pending','failed') RETURNING t.order_id`,
        [t0.order_id, at(nowMs())]);
      await client.query('COMMIT');
      res.json({ released: r.rowCount === 1 });
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      res.status(500).json({ error: e.message });
    } finally { client.release(); }
  });

  // A tee payment confirmed (any path: postback, pay/check, the watch, the status page, Admin's
  // Activate): the money row's guarded UPDATE as for a pass, so a second path is a no-op. Its tees
  // are counted WITHOUT its own hold: a hold that lapsed gets tees if any are left, else 'oversold'.
  async function activateTee(order, verdict = {}, opts = {}) {
    const now = nowMs();
    const client = await pool.connect();
    let status = null, was = null, n = 0, late = false;
    try {
      await client.query('BEGIN');
      const t0 = (await client.query('SELECT drop_id FROM bkk_tee_orders WHERE order_id=$1', [order.id])).rows[0];
      if (!t0) throw new Error('tee order has no tees');
      const drop = (await client.query('SELECT * FROM bkk_tee_drops WHERE id=$1 FOR UPDATE', [t0.drop_id])).rows[0];
      // Only the fields that say what was paid: the inquiry answer also repeats the buyer's email
      // ("CustomerEmal"), which must go with the contact purge, and this row is kept for years.
      const raw = verdict.raw && typeof verdict.raw === 'object'
        ? JSON.stringify(Object.fromEntries(TEE_GATEWAY_KEEP.filter(k => k in verdict.raw).map(k => [k, verdict.raw[k]]))).slice(0, 400) : null;
      const upd = await client.query(
        `UPDATE bkk_orders SET status='paid', verified_at=now(), gateway_ref=$2, gateway_note=$3
         WHERE id=$1 AND status IN ('pending','failed','mismatch') RETURNING id`,
        [order.id, raw, verdict.note || null]);
      if (!upd.rows.length) { await client.query('ROLLBACK'); return null; }
      const t = (await client.query('SELECT status FROM bkk_tee_orders WHERE order_id=$1 FOR UPDATE', [order.id])).rows[0];
      was = t.status;
      const lines = (await client.query('SELECT stock_id AS "stockId", qty FROM bkk_tee_lines WHERE order_id=$1', [order.id])).rows;
      n = qtyOf(lines);
      if (was === 'new' || was === 'cancelled') {
        // A finished drop has its report frozen and its tees counted out: a payment that lands
        // after that is a refund for staff, never a sale.
        const fit = teeShort(drop, await teeStockRows(client, drop.id), await teeTaken(client, drop.id, now, order.id), lines);
        late = !!drop.done_at;
        status = late || fit.soldOut.length ? 'oversold' : 'paid';
        await client.query(`UPDATE bkk_tee_orders SET status=$2, paid_at=$3, cancelled_at=NULL WHERE order_id=$1`, [order.id, status, at(now)]);
      } else {
        status = was;
        await client.query(`UPDATE bkk_tee_orders SET paid_at=coalesce(paid_at, $2) WHERE order_id=$1`, [order.id, at(now)]);
      }
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      throw e;
    } finally { client.release(); }
    console.log(`✓ bkk: tee order ${order.id} paid (${status})`);
    (async () => {
      if (late) await alertOnce(order, 'oversold', '⚠ Tee order paid after its pre-order was finished.',
        'Refund it in PaySolutions, then cancel it as refunded: Admin, Tees.');
      else if (status === 'oversold') await alertOnce(order, 'oversold', '⚠ Tee order paid, but its tees are sold out.',
        'Swap a size or refund within 3 days: Admin, Tees.');
      if (was === 'cancelled') await alertOnce(order, 'paid-cancelled', '⚠ A cancelled tee order was paid, so it is back on.',
        'Ask the buyer. If they do not want it, refund it in PaySolutions, then cancel it as refunded.');
      if (!opts.byHand && await getSetting('ping_each_sale', 'off') === 'on')
        await notify([`💳 AYBKK tee order (${order.method || 'online'})`, `${order.item_name} ×${n} · ฿${order.amount_thb}`, `refno ${order.refno}`].join('\n'));
    })().catch(e => console.error('[bkk tee] ping failed:', e.message));
    emailTeeReceipt(order.id).catch(e => console.error('[bkk tee] receipt failed:', e.message));
    return { tee: { status } };
  }
  async function emailTeeReceipt(orderId) {
    const t = (await q(`${TEE_ORDER_SQL} WHERE t.order_id = $1`, [orderId])).rows[0];
    if (!t || !t.email) return;
    const L = teeLang(t.lang), p = pickupsOf(t).find(x => x.key === t.pickup);
    const m = render('teeReceipt', L, { name: t.name, title: pickLang(t.drop_title, L), items: (await teeItems(pool, [orderId], L)).get(orderId),
      base: t.base_thb, fee: t.fee_thb, vat: t.vat_thb, amount: t.amount_thb, refno: refno12(t.refno),
      pickup: p ? p.label : t.pickup, link: `${TEE_ORIGIN}/book#tee=${t.token}`, oversold: t.status === 'oversold' });
    await sendMail({ to: t.email, subject: m.subject, html: m.html, text: m.text, tag: 'teeReceipt' });
  }

  // Contact details go: purge_days after hand-over, 7 days after a cancel or after an unpaid hold
  // lapsed. While a problem note or a wrong-amount payment is open they wait, at most TEE_HELD_DAYS
  // longer (the notice says so), and the note goes with them. A row whose money can still turn paid
  // (pending, failed) is never taken early: a late payment must still find its buyer. The tees, the
  // money, the ref, the pickup point and the dates stay. all: the drop's own Delete now (handed
  // orders and settled cancels); done: a finished drop, everything that is settled.
  async function teePurge({ now = nowMs(), dropId = null, all = false, done = false } = {}) {
    const r = await q(`UPDATE bkk_tee_orders t SET name=NULL, wechat=NULL, mobile=NULL, email=NULL, problem=NULL, purged_at=$1
      FROM bkk_orders o, bkk_tee_drops d
      WHERE o.id = t.order_id AND d.id = t.drop_id AND t.purged_at IS NULL
        AND ($2::int IS NULL OR t.drop_id = $2)
        AND ((CASE WHEN t.status = 'handed' THEN t.handed_at + make_interval(days => d.purge_days)
                   WHEN t.status = 'cancelled' THEN t.cancelled_at + make_interval(days => $3)
                   WHEN t.status = 'new' AND o.status IN ('pending','failed','mismatch') THEN t.hold_until + make_interval(days => $3) END)
              + CASE WHEN t.problem IS NOT NULL OR o.status = 'mismatch' THEN make_interval(days => $6) ELSE interval '0' END <= $1::timestamptz
          OR (t.problem IS NULL AND o.status NOT IN ('mismatch','pending','failed')
            AND ($5::boolean OR ($4::boolean AND t.status IN ('handed','cancelled')))))
      RETURNING t.order_id`, [at(now), dropId, TEE_UNPAID_PURGE_DAYS, all, done, TEE_HELD_DAYS]);
    return { purged: r.rowCount };
  }
  const teePurgeTick = () => teePurge().then(r => { if (r.purged) console.log(`✓ bkk tee: contact details deleted on ${r.purged} order(s)`); })
    .catch(e => console.error('[bkk tee] purge failed:', e.message));

  // ── tee pre-order, staff (Admin, Tees) ────────────────────────────────────
  const teeStaff = (req, res) => {
    res.set('Cache-Control', 'private, no-store');
    if (isAdmin(req)) return false;
    res.status(401).json({ error: 'bad key' });
    return true;
  };
  const teeId = v => /^\d{1,9}$/.test(String(v)) ? Number(v) : null;
  function teeDropOut(d, now) {
    const t = d.title && typeof d.title === 'object' ? d.title : {};
    return { id: d.id, code: d.code, title: { en: t.en || '', zh: t.zh || '' }, opensAt: isoBkk(d.opens_at), closesAt: isoBkk(d.closes_at),
      opensAtBkk: bkkMinute(d.opens_at), closesAtBkk: bkkMinute(d.closes_at), published: d.published,
      state: d.done_at ? 'done' : !d.published ? 'draft' : teeState(d, now), cap: d.cap, maxPerOrder: d.max_per_order,
      holdMin: d.hold_min, purgeDays: d.purge_days, rmbRate: d.rmb_rate == null ? null : Number(d.rmb_rate),
      pickups: pickupsOf(d), costs: d.costs || null, doneAt: d.done_at ? isoBkk(d.done_at) : null };
  }
  const teeStockOut = (s, taken, lines) => {
    const x = taken.get(s.id) || { sold: 0, held: 0 };
    return { id: s.id, design: s.design, designName: { en: (s.design_name || {}).en || '', zh: (s.design_name || {}).zh || '' },
      colour: s.colour, colourName: { en: (s.colour_name || {}).en || '', zh: (s.colour_name || {}).zh || '' }, size: s.size,
      priceThb: s.price_thb, photo: s.photo, cap: s.cap, sort: s.sort, sold: x.sold, held: x.held, left: s.cap - x.sold - x.held,
      hasOrders: lines.has(s.id) };
  };
  // Staff totals for one drop: each tee's cap, sold, held and left; orders by where they stand; money.
  // One query after another: db may be a client inside a transaction (Finish).
  async function teeTotals(db, d, now) {
    const stock = await teeStockRows(db, d.id), taken = await teeTaken(db, d.id, now);
    const lined = await db.query(`SELECT DISTINCT l.stock_id FROM bkk_tee_lines l JOIN bkk_tee_stock s ON s.id = l.stock_id WHERE s.drop_id = $1`, [d.id]);
    const byView = await db.query(`SELECT ${TEE_VIEW('$2')} AS view, count(*)::int AS n FROM bkk_tee_orders t JOIN bkk_orders o ON o.id = t.order_id
        WHERE t.drop_id = $1 GROUP BY 1`, [d.id, at(now)]);
    const money = await db.query(`SELECT count(*) FILTER (WHERE o.status = 'paid')::int AS n,
          coalesce(sum(o.amount_thb) FILTER (WHERE o.status = 'paid'), 0)::int AS amount,
          coalesce(sum(o.base_thb) FILTER (WHERE o.status = 'paid'), 0)::int AS base,
          coalesce(sum(o.fee_thb) FILTER (WHERE o.status = 'paid'), 0)::int AS fee,
          coalesce(sum(o.vat_thb) FILTER (WHERE o.status = 'paid'), 0)::int AS vat,
          count(*) FILTER (WHERE o.status = 'void')::int AS refunds,
          coalesce(sum(o.amount_thb) FILTER (WHERE o.status = 'void'), 0)::int AS refunded
        FROM bkk_tee_orders t JOIN bkk_orders o ON o.id = t.order_id WHERE t.drop_id = $1`, [d.id]);
    const lines = new Set(lined.rows.map(r => r.stock_id));
    const rows = stock.map(s => teeStockOut(s, taken, lines));
    const sold = rows.reduce((n, s) => n + s.sold, 0), held = rows.reduce((n, s) => n + s.held, 0);
    const orders = Object.fromEntries(['waiting', 'expired', 'mismatch', 'paid', 'oversold', 'handed', 'cancelled'].map(k => [k, 0]));
    for (const r of byView.rows) orders[r.view] = r.n;
    const m = money.rows[0];
    return { stock: rows, tees: { cap: d.cap, stockCaps: rows.reduce((n, s) => n + s.cap, 0), sold, held, left: d.cap - sold - held },
      orders, money: { n: m.n, amount: m.amount, base: m.base, fee: m.fee, vat: m.vat }, refunds: { n: m.refunds, amount: m.refunded } };
  }
  // A drop as typed in the editor. Times are Bangkok 'YYYY-MM-DD HH:MM'; close defaults to 7 days on.
  // was: the drop being edited, whose values stand for any field not sent.
  function readTeeDrop(b, was = null) {
    const has = k => b[k] !== undefined;
    const code = String(has('code') ? b.code : was ? was.code : '').trim();
    if (!/^[a-z0-9-]{3,24}$/.test(code)) return { error: 'code: 3 to 24 lowercase letters, digits or dashes', field: 'code' };
    const t0 = was && was.title && typeof was.title === 'object' ? was.title : {};
    const title = has('title') ? (b.title && typeof b.title === 'object' ? b.title : {}) : t0;
    const ten = String(title.en ?? '').replace(/\s+/g, ' ').trim(), tzh = String(title.zh ?? '').replace(/\s+/g, ' ').trim();
    if (!ten || !tzh || ten.length > 80 || tzh.length > 80 || /[<>]/.test(ten + tzh)) return { error: 'title: English and Chinese, up to 80 characters each', field: 'title' };
    const opens = has('opensAt') ? parseBkkMinute(b.opensAt) : was ? new Date(was.opens_at).getTime() : null;
    if (opens == null) return { error: 'opensAt: a Bangkok date and time, YYYY-MM-DD HH:MM', field: 'opensAt' };
    const closes = has('closesAt') && b.closesAt !== null && b.closesAt !== '' ? parseBkkMinute(b.closesAt)
      : was && !has('opensAt') ? new Date(was.closes_at).getTime() : opens + 7 * 86400000;
    if (closes == null || closes <= opens) return { error: 'closesAt: a Bangkok date and time after it opens', field: 'closesAt' };
    const int = (k, dflt, lo, hi) => { const v = has(k) ? Number(b[k]) : dflt; return Number.isInteger(v) && v >= lo && v <= hi ? v : null; };
    const cap = int('cap', was ? was.cap : null, 1, 500);
    if (cap == null) return { error: 'cap: all the tees of this pre-order together, 1 to 500', field: 'cap' };
    const maxPerOrder = int('maxPerOrder', was ? was.max_per_order : 5, 1, 10);
    if (maxPerOrder == null) return { error: 'maxPerOrder: 1 to 10', field: 'maxPerOrder' };
    const holdMin = int('holdMin', was ? was.hold_min : 30, 5, 1440);
    if (holdMin == null) return { error: 'holdMin: 5 to 1440 minutes', field: 'holdMin' };
    const purgeDays = int('purgeDays', was ? was.purge_days : 30, 1, 365);
    if (purgeDays == null) return { error: 'purgeDays: 1 to 365', field: 'purgeDays' };
    const rr = has('rmbRate') ? b.rmbRate : was ? was.rmb_rate : null;
    const rmbRate = rr === null || rr === '' || rr === undefined ? null : Number(rr);
    if (rmbRate !== null && !(rmbRate > 0 && rmbRate < 10)) return { error: 'rmbRate: yuan for 1 baht (about 0.2), or empty', field: 'rmbRate' };
    const pk = has('pickups') ? b.pickups : was ? pickupsOf(was) : [];
    if (!Array.isArray(pk) || pk.length > 6) return { error: 'pickups: up to 6 points', field: 'pickups' };
    const pickups = [];
    for (const p of pk) {
      const key = String(p && p.key || ''), label = String(p && p.label || '').replace(/\s+/g, ' ').trim();
      if (!/^[A-F]$/.test(key) || pickups.some(x => x.key === key)) return { error: 'pickups: each key is one of A to F, once', field: 'pickups' };
      if (!label || label.length > 60 || /[<>]/.test(label)) return { error: 'pickups: a label of up to 60 characters (city · name)', field: 'pickups' };
      pickups.push({ key, label });
    }
    const published = has('published') ? b.published === true : was ? was.published : false;
    return { value: { code, title: { en: ten, zh: tzh }, opens, closes, cap, maxPerOrder, holdMin, purgeDays, rmbRate, pickups, published } };
  }

  app.get('/api/bkk/admin/tee/drops', async (req, res) => {
    if (teeStaff(req, res)) return;
    try {
      const now = nowMs(), drops = (await q('SELECT * FROM bkk_tee_drops ORDER BY opens_at DESC, id DESC')).rows;
      res.json({ drops: await Promise.all(drops.map(async d => ({ ...teeDropOut(d, now), totals: await teeTotals(pool, d, now) }))),
        notice: { version: TEE_NOTICE_VERSION, ready: (await teeNotice('en', 30)).ready }, payment: { mode: paymentStatus().mode } });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Create, or with an id edit. A finished drop never changes; once it has an order its code and
  // the pickup points its orders name stay, and its cap never drops below what is taken.
  app.post('/api/bkk/admin/tee/drops', async (req, res) => {
    if (teeStaff(req, res)) return;
    const b = req.body || {}, now = nowMs();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const stop = async (code, body) => { await client.query('ROLLBACK'); res.status(code).json(body); };
      let was = null;
      if (b.id != null) {
        const id = teeId(b.id);
        was = id && (await client.query('SELECT * FROM bkk_tee_drops WHERE id=$1 FOR UPDATE', [id])).rows[0];
        if (!was) return await stop(404, { error: 'no such tee pre-order' });
        if (was.done_at) return await stop(409, { error: 'This pre-order is finished: it cannot change.' });
      }
      const v = readTeeDrop(b, was);
      if (v.error) return await stop(400, v);
      const d = v.value;
      if (was) {
        const used = (await client.query('SELECT DISTINCT pickup FROM bkk_tee_orders WHERE drop_id=$1', [was.id])).rows.map(r => r.pickup);
        if (used.length && d.code !== was.code) return await stop(409, { error: 'The code cannot change once there is an order.', field: 'code' });
        const gone = used.find(k => k && !d.pickups.some(p => p.key === k));
        if (gone) return await stop(409, { error: `Pickup point ${gone} has orders: keep it (its label can change).`, field: 'pickups', pickup: gone });
        const taken = takenAll(await teeTaken(client, was.id, now));
        if (d.cap < taken) return await stop(409, { error: `The cap cannot go below the tees already sold or held (${taken}).`, field: 'cap', taken });
      }
      if (d.published) {
        if (!d.pickups.length) return await stop(400, { error: 'Add a pickup point before publishing.', field: 'pickups' });
        const st = was ? (await client.query('SELECT count(*)::int AS n FROM bkk_tee_stock WHERE drop_id=$1 AND cap > 0', [was.id])).rows[0].n : 0;
        if (!st) return await stop(409, { error: 'Save the tees (with a cap) before publishing.', field: 'published' });
      }
      const vals = [d.code, JSON.stringify(d.title), at(d.opens), at(d.closes), d.published, d.cap, d.maxPerOrder, d.holdMin, d.purgeDays,
        d.rmbRate, JSON.stringify(d.pickups)];
      let row;
      await client.query('SAVEPOINT w');
      try {
        row = was
          ? (await client.query(`UPDATE bkk_tee_drops SET code=$1, title=$2, opens_at=$3, closes_at=$4, published=$5, cap=$6,
              max_per_order=$7, hold_min=$8, purge_days=$9, rmb_rate=$10, pickups=$11 WHERE id=$12 RETURNING *`, [...vals, was.id])).rows[0]
          : (await client.query(`INSERT INTO bkk_tee_drops (code,title,opens_at,closes_at,published,cap,max_per_order,hold_min,purge_days,rmb_rate,pickups)
              VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`, vals)).rows[0];
      } catch (e) {
        await client.query('ROLLBACK TO SAVEPOINT w');
        if (e.code === '23505') return await stop(409, { error: `The code ${d.code} is taken.`, field: 'code' });
        throw e;
      }
      await client.query('COMMIT');
      res.json({ success: true, drop: { ...teeDropOut(row, now), totals: await teeTotals(pool, row, now) } });
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      res.status(500).json({ error: e.message });
    } finally { client.release(); }
  });

  // The whole grid at once. A tee with orders keeps its design, colour, size and price, is never
  // removed, and its cap never goes below what is taken.
  app.put('/api/bkk/admin/tee/drops/:id/stock', async (req, res) => {
    if (teeStaff(req, res)) return;
    const id = teeId(req.params.id), raw = (req.body || {}).stock, now = nowMs();
    if (!id) return res.status(404).json({ error: 'no such tee pre-order' });
    if (!Array.isArray(raw) || raw.length > 200) return res.status(400).json({ error: 'stock: a list of up to 200 tees' });
    const name2 = (j, en) => { const o = j && typeof j === 'object' ? j : {};
      const e = String(o.en ?? '').replace(/\s+/g, ' ').trim(), z = String(o.zh ?? '').replace(/\s+/g, ' ').trim();
      return e && e.length <= 60 && z.length <= 60 && !/[<>]/.test(e + z) ? { en: e, zh: z || e } : null; };
    const rows = [];
    for (const [i, s] of raw.entries()) {
      const bad = (field, error) => res.status(400).json({ error: `row ${i + 1}: ${error}`, row: i, field });
      const r = { id: s && s.id != null ? teeId(s.id) : null, design: String(s && s.design || '').trim(), colour: String(s && s.colour || '').trim(),
        designName: name2(s && s.designName), colourName: name2(s && s.colourName), size: String(s && s.size || '').trim().toUpperCase(),
        priceThb: Number(s && s.priceThb), photo: String(s && s.photo || '').trim() || null, cap: Number(s && s.cap),
        sort: s && s.sort != null && s.sort !== '' ? Number(s.sort) : i * 10 };
      if (s && s.id != null && !r.id) return bad('id', 'unknown id');
      if (!/^[a-z0-9-]{1,24}$/.test(r.design)) return bad('design', 'design: a short key, lowercase letters, digits or dashes');
      if (!/^[a-z0-9-]{1,24}$/.test(r.colour)) return bad('colour', 'colour: a short key, lowercase letters, digits or dashes');
      if (!r.designName) return bad('designName', 'design name: English (and Chinese), up to 60 characters');
      if (!r.colourName) return bad('colourName', 'colour name: English (and Chinese), up to 60 characters');
      if (!TEE_SIZES.includes(r.size)) return bad('size', `size: one of ${TEE_SIZES.join(', ')}`);
      if (!Number.isInteger(r.priceThb) || r.priceThb < 1 || r.priceThb > 100000) return bad('priceThb', 'price: whole baht, before the fee and VAT');
      if (r.photo && (!/^\/img\/[\w./-]+$/.test(r.photo) || r.photo.includes('..'))) return bad('photo', 'photo: a site path under /img/');
      if (!Number.isInteger(r.cap) || r.cap < 0 || r.cap > 500) return bad('cap', 'cap: 0 to 500');
      if (!Number.isInteger(r.sort) || Math.abs(r.sort) > 1e6) return bad('sort', 'sort: a whole number');
      if (rows.some(x => x.design === r.design && x.colour === r.colour && x.size === r.size)) return bad('size', 'this design, colour and size is in the grid twice');
      if (r.id && rows.some(x => x.id === r.id)) return bad('id', 'the same tee is in the grid twice');
      rows.push(r);
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const stop = async (code, body) => { await client.query('ROLLBACK'); res.status(code).json(body); };
      const d = (await client.query('SELECT * FROM bkk_tee_drops WHERE id=$1 FOR UPDATE', [id])).rows[0];
      if (!d) return await stop(404, { error: 'no such tee pre-order' });
      if (d.done_at) return await stop(409, { error: 'This pre-order is finished: it cannot change.' });
      const old = (await client.query(`SELECT s.*, EXISTS (SELECT 1 FROM bkk_tee_lines l WHERE l.stock_id = s.id) AS lined
        FROM bkk_tee_stock s WHERE s.drop_id=$1`, [id])).rows;
      const taken = await teeTaken(client, id, now);
      for (const r of rows) if (r.id && !old.some(x => x.id === r.id)) return await stop(400, { error: `tee ${r.id} is not in this pre-order`, stockId: r.id });
      for (const x of old) {
        const r = rows.find(y => y.id === x.id);
        if (!r) {
          if (x.lined) return await stop(409, { error: `${x.design} ${x.colour} ${x.size} has orders: it cannot be removed (set its cap instead).`, stockId: x.id });
          continue;
        }
        if (x.lined && (r.design !== x.design || r.colour !== x.colour || r.size !== x.size))
          return await stop(409, { error: `${x.design} ${x.colour} ${x.size} has orders: its design, colour and size stay.`, stockId: x.id });
        if (x.lined && r.priceThb !== x.price_thb)
          return await stop(409, { error: `${x.design} ${x.colour} ${x.size} has orders: its price is locked.`, stockId: x.id });
        if (r.cap < takenOf(taken, x.id))
          return await stop(409, { error: `${x.design} ${x.colour} ${x.size}: the cap cannot go below the ${takenOf(taken, x.id)} sold or held.`, stockId: x.id, taken: takenOf(taken, x.id) });
      }
      await client.query('SAVEPOINT g');
      try {
        const keep = rows.filter(r => r.id).map(r => r.id);
        await client.query('DELETE FROM bkk_tee_stock WHERE drop_id=$1 AND NOT (id = ANY($2::int[]))', [id, keep]);
        for (const r of rows) {
          const vals = [r.design, JSON.stringify(r.designName), r.colour, JSON.stringify(r.colourName), r.size, r.priceThb, r.photo, r.cap, r.sort];
          if (r.id) await client.query(`UPDATE bkk_tee_stock SET design=$1, design_name=$2, colour=$3, colour_name=$4, size=$5, price_thb=$6,
            photo=$7, cap=$8, sort=$9 WHERE id=$10`, [...vals, r.id]);
          else await client.query(`INSERT INTO bkk_tee_stock (design,design_name,colour,colour_name,size,price_thb,photo,cap,sort,drop_id)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [...vals, id]);
        }
      } catch (e) {
        await client.query('ROLLBACK TO SAVEPOINT g');
        if (e.code === '23505') return await stop(409, { error: 'Two tees in the grid have the same design, colour and size.' });
        throw e;
      }
      await client.query('COMMIT');
      res.json({ success: true, totals: await teeTotals(pool, d, now) });
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      res.status(500).json({ error: e.message });
    } finally { client.release(); }
  });

  // Close now: the close time comes forward to now. One not open yet is unpublished instead.
  app.post('/api/bkk/admin/tee/drops/:id/close', async (req, res) => {
    if (teeStaff(req, res)) return;
    try {
      const id = teeId(req.params.id), now = nowMs();
      const r = id && (await q(`UPDATE bkk_tee_drops SET
          published = published AND opens_at < $2,
          closes_at = CASE WHEN opens_at < $2 THEN least(closes_at, $2) ELSE closes_at END
        WHERE id=$1 AND done_at IS NULL RETURNING *`, [id, at(now)])).rows[0];
      if (!r) return res.status(404).json({ error: 'no such open tee pre-order' });
      res.json({ success: true, drop: teeDropOut(r, now) });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Every order of a drop, with contact details (staff only), ?status= (a tee status or a view:
  // waiting, expired, mismatch) and ?pickup=, and the drop's totals.
  async function teeOrderRows(db, d, now, { pickup = null } = {}) {
    const rows = (await db.query(`${TEE_ORDER_SQL} WHERE t.drop_id = $1 AND ($2::text IS NULL OR t.pickup = $2)
      ORDER BY t.created_at DESC, t.order_id DESC`, [d.id, pickup])).rows;
    const items = await teeItems(db, rows.map(r => r.order_id), 'en');
    const label = k => (pickupsOf(d).find(p => p.key === k) || {}).label || null;
    const when = v => v ? isoBkk(v) : null;
    return rows.map(r => {
      const it = items.get(r.order_id);
      return { orderId: r.order_id, refno: refno12(r.refno), status: r.status, view: teeView(r, r.money, now), money: r.money,
        name: r.name, wechat: r.wechat, mobile: r.mobile, email: r.email, lang: r.lang, pickup: r.pickup, pickupLabel: label(r.pickup),
        problem: r.problem, items: it, qty: qtyOf(it), amount: r.amount_thb, base: r.base_thb, fee: r.fee_thb, vat: r.vat_thb,
        holdUntil: when(r.hold_until), createdAt: when(r.created_at), paidAt: when(r.paid_at), handedAt: when(r.handed_at),
        cancelledAt: when(r.cancelled_at), purgedAt: when(r.purged_at), note: r.gateway_note };
    });
  }
  const teeDropById = async (db, id, lock = false) => id
    ? (await db.query(`SELECT * FROM bkk_tee_drops WHERE id=$1${lock ? ' FOR UPDATE' : ''}`, [id])).rows[0] : null;
  app.get('/api/bkk/admin/tee/drops/:id/orders', async (req, res) => {
    if (teeStaff(req, res)) return;
    try {
      const now = nowMs(), d = await teeDropById(pool, teeId(req.params.id));
      if (!d) return res.status(404).json({ error: 'no such tee pre-order' });
      const pickup = req.query.pickup ? String(req.query.pickup) : null, want = req.query.status ? String(req.query.status) : null;
      const orders = (await teeOrderRows(pool, d, now, { pickup })).filter(o => !want || o.status === want || o.view === want);
      res.json({ drop: teeDropOut(d, now), orders, totals: await teeTotals(pool, d, now) });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // One order: {pickup?, problem?, swapStockId? (+ fromStockId when it has more than one tee), handed?},
  // applied in that order, all or nothing.
  app.post('/api/bkk/admin/tee/orders/:orderId', async (req, res) => {
    if (teeStaff(req, res)) return;
    const oid = teeId(req.params.orderId), b = req.body || {}, now = nowMs();
    if (!oid) return res.status(404).json({ error: 'not found' });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const stop = async (code, body) => { await client.query('ROLLBACK'); res.status(code).json(body); };
      const t0 = (await client.query('SELECT drop_id FROM bkk_tee_orders WHERE order_id=$1', [oid])).rows[0];
      if (!t0) return await stop(404, { error: 'not found' });
      const d = await teeDropById(client, t0.drop_id, true);
      const t = (await client.query('SELECT * FROM bkk_tee_orders WHERE order_id=$1 FOR UPDATE', [oid])).rows[0];
      let status = t.status;
      if (b.pickup !== undefined) {
        if (!pickupsOf(d).some(p => p.key === b.pickup)) return await stop(400, { error: 'no such pickup point', field: 'pickup' });
        await client.query('UPDATE bkk_tee_orders SET pickup=$2 WHERE order_id=$1', [oid, b.pickup]);
      }
      if (b.problem !== undefined) {
        const note = b.problem === null ? '' : String(b.problem).replace(/\s+/g, ' ').trim().slice(0, 300);
        await client.query('UPDATE bkk_tee_orders SET problem=$2 WHERE order_id=$1', [oid, note || null]);
      }
      if (b.swapStockId !== undefined) {
        if (!['paid', 'oversold'].includes(status)) return await stop(409, { error: 'Only a paid or oversold order can change size.' });
        const st = await teeStockRows(client, d.id);
        const to = Number(b.swapStockId);
        if (!st.some(s => s.id === to)) return await stop(400, { error: 'no such tee in this pre-order', field: 'swapStockId' });
        const lines = (await client.query('SELECT stock_id AS "stockId", qty, unit_thb AS "unitThb" FROM bkk_tee_lines WHERE order_id=$1', [oid])).rows;
        const from = b.fromStockId != null ? Number(b.fromStockId) : lines.length === 1 ? lines[0].stockId : null;
        const line = lines.find(l => l.stockId === from);
        if (!line) return await stop(400, { error: 'say which tee to swap (fromStockId)', field: 'fromStockId' });
        if (to !== from && lines.some(l => l.stockId === to)) return await stop(409, { error: 'That tee is already in this order.' });
        const next = lines.map(l => l === line ? { ...l, stockId: to } : l);
        const fit = teeShort(d, st, await teeTaken(client, d.id, now, oid), next);
        if (fit.soldOut.length) return await stop(409, { error: 'sold out', soldOut: fit.soldOut });
        await client.query('UPDATE bkk_tee_lines SET stock_id=$3 WHERE order_id=$1 AND stock_id=$2', [oid, from, to]);
        status = 'paid';
        await client.query(`UPDATE bkk_tee_orders SET status='paid' WHERE order_id=$1`, [oid]);
      }
      if (b.handed === true) {
        if (status !== 'paid' && status !== 'handed') return await stop(409, { error: 'Only a paid order can be handed over.' });
        if (status === 'paid') await client.query(`UPDATE bkk_tee_orders SET status='handed', handed_at=$2 WHERE order_id=$1`, [oid, at(now)]);
      } else if (b.handed === false && status === 'handed') {
        await client.query(`UPDATE bkk_tee_orders SET status='paid', handed_at=NULL WHERE order_id=$1`, [oid]);
      }
      await client.query('COMMIT');
      const row = (await teeOrderRows(pool, d, now)).find(o => o.orderId === oid);
      res.json({ success: true, order: row });
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      res.status(500).json({ error: e.message });
    } finally { client.release(); }
  });

  // Cancel: an unpaid order is simply cancelled. A paid one only once the refund is done in the
  // PaySolutions panel (refunded: true): its money row goes void, as Void does. Handed over: also confirm.
  app.post('/api/bkk/admin/tee/orders/:orderId/cancel', async (req, res) => {
    if (teeStaff(req, res)) return;
    const oid = teeId(req.params.orderId), b = req.body || {}, now = nowMs();
    if (!oid) return res.status(404).json({ error: 'not found' });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const stop = async (code, body) => { await client.query('ROLLBACK'); res.status(code).json(body); };
      const t0 = (await client.query('SELECT drop_id FROM bkk_tee_orders WHERE order_id=$1', [oid])).rows[0];
      if (!t0) return await stop(404, { error: 'not found' });
      await teeDropById(client, t0.drop_id, true);
      const o = (await client.query('SELECT * FROM bkk_orders WHERE id=$1 FOR UPDATE', [oid])).rows[0];
      const t = (await client.query('SELECT * FROM bkk_tee_orders WHERE order_id=$1 FOR UPDATE', [oid])).rows[0];
      if (t.status === 'cancelled' && o.status !== 'mismatch') return await stop(200, { success: true, already: true, refno: String(o.refno) });
      let note = null;
      // A wrong amount is money received too: it is refunded like a paid order, never just dropped.
      if (o.status === 'paid' || o.status === 'mismatch') {
        if (b.refunded !== true) return await stop(409, { needs: 'refunded',
          error: o.status === 'paid' ? 'This order is paid: refund it in the PaySolutions panel first, then cancel it as refunded.'
            : 'PaySolutions took money for this order (the wrong amount): refund it in the PaySolutions panel first, then cancel it as refunded.' });
        if (t.status === 'handed' && b.confirm !== true) return await stop(409, { needs: 'confirm',
          error: 'These tees were handed over already. Send confirm to cancel and void it anyway.' });
        const reason = String(b.reason || '').replace(/\s+/g, ' ').trim().slice(0, 160);
        note = `Void: tee refund${o.status === 'mismatch' ? ' (wrong amount)' : ''}${reason ? ': ' + reason : ''} (by staff, ${bkkToday()})`;
        await voidMoney(client, o, note, now);
      } else {
        await client.query(`UPDATE bkk_tee_orders SET status='cancelled', cancelled_at=$2 WHERE order_id=$1`, [oid, at(now)]);
      }
      await client.query('COMMIT');
      res.json({ success: true, refno: String(o.refno), voided: !!note, note });
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      res.status(500).json({ error: e.message });
    } finally { client.release(); }
  });

  // The printable pickup list: what to take per design, colour and size (paid and handed), then
  // the buyers by name with their WeChat ID, tees and a box to tick.
  app.get('/api/bkk/admin/tee/drops/:id/pickup', async (req, res) => {
    if (teeStaff(req, res)) return;
    try {
      const now = nowMs(), d = await teeDropById(pool, teeId(req.params.id));
      if (!d) return res.status(404).json({ error: 'no such tee pre-order' });
      const key = req.query.pickup ? String(req.query.pickup) : null;
      const pk = key ? pickupsOf(d).find(p => p.key === key) : null;
      if (key && !pk) return res.status(404).json({ error: 'no such pickup point' });
      const orders = (await teeOrderRows(pool, d, now, { pickup: key })).filter(o => ['paid', 'handed', 'oversold'].includes(o.status));
      const totals = [];
      for (const o of orders.filter(x => x.status !== 'oversold')) for (const it of o.items) {
        const t = totals.find(x => x.stockId === it.stockId);
        if (t) t.qty += it.qty;
        else totals.push({ stockId: it.stockId, design: it.design, designName: it.designName, colour: it.colour, colourName: it.colourName, size: it.size, qty: it.qty });
      }
      totals.sort((a, b) => a.design.localeCompare(b.design) || a.colour.localeCompare(b.colour) || TEE_SIZES.indexOf(a.size) - TEE_SIZES.indexOf(b.size));
      const buyers = orders.map(o => ({ orderId: o.orderId, refno: o.refno, name: o.name, wechat: o.wechat, pickup: o.pickup, status: o.status,
        handed: o.status === 'handed', problem: o.problem,
        items: o.items.map(it => ({ designName: it.designName, colourName: it.colourName, size: it.size, qty: it.qty })), qty: o.qty }))
        .sort((a, b) => String(a.name ?? '￿').localeCompare(String(b.name ?? '￿')) || a.refno.localeCompare(b.refno));
      res.json({ drop: { id: d.id, code: d.code, title: pickLang(d.title, 'en') }, pickup: pk || null, totals,
        total: qtyOf(totals), buyers, oversold: orders.filter(o => o.status === 'oversold').length });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // The paper a carrier declares the tees with at China customs (red channel): design × colour, how
  // many, and the unit price in baht. Paid and handed orders, ?pickup= for one carrier's bag.
  app.get('/api/bkk/admin/tee/drops/:id/declaration', async (req, res) => {
    if (teeStaff(req, res)) return;
    try {
      const d = await teeDropById(pool, teeId(req.params.id));
      if (!d) return res.status(404).json({ error: 'no such tee pre-order' });
      const key = req.query.pickup ? String(req.query.pickup) : null;
      if (key && !pickupsOf(d).some(p => p.key === key)) return res.status(404).json({ error: 'no such pickup point' });
      const rows = (await q(`SELECT s.design, s.design_name, s.colour, s.colour_name, l.unit_thb, sum(l.qty)::int AS qty
        FROM bkk_tee_lines l JOIN bkk_tee_orders t ON t.order_id = l.order_id JOIN bkk_tee_stock s ON s.id = l.stock_id
        WHERE t.drop_id = $1 AND t.status IN ('paid','handed') AND ($2::text IS NULL OR t.pickup = $2)
        GROUP BY s.design, s.design_name, s.colour, s.colour_name, l.unit_thb ORDER BY s.design, s.colour, l.unit_thb`, [d.id, key])).rows;
      const lines = rows.map(r => ({ design: r.design, designName: pickLang(r.design_name, 'en'), designNameZh: pickLang(r.design_name, 'zh'),
        colour: r.colour, colourName: pickLang(r.colour_name, 'en'), colourNameZh: pickLang(r.colour_name, 'zh'),
        qty: r.qty, unitThb: r.unit_thb, totalThb: r.qty * r.unit_thb }));
      res.json({ drop: { id: d.id, code: d.code, title: pickLang(d.title, 'en') }, pickup: key ? pickupsOf(d).find(p => p.key === key) : null, lines,
        total: { qty: lines.reduce((n, l) => n + l.qty, 0), thb: lines.reduce((n, l) => n + l.totalThb, 0) } });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Finish: the books of the drop, frozen with its costs. Refused while a paid order is not handed
  // over (paid or oversold), unless confirm.
  async function teeReport(db, d, costs, now) {
    const tot = await teeTotals(db, d, now);
    const handed = (await db.query(`SELECT l.stock_id, sum(l.qty)::int AS n FROM bkk_tee_lines l
      JOIN bkk_tee_orders t ON t.order_id = l.order_id WHERE t.drop_id = $1 AND t.status = 'handed' GROUP BY 1`, [d.id])).rows;
    const paidAt = (await db.query(`SELECT l.stock_id, sum(l.qty * l.unit_thb)::int AS thb FROM bkk_tee_lines l
      JOIN bkk_tee_orders t ON t.order_id = l.order_id WHERE t.drop_id = $1 AND t.status IN ('paid','handed') GROUP BY 1`, [d.id])).rows;
    const costTotal = Object.values(costs || {}).reduce((n, v) => n + v, 0);
    return { frozenAt: isoBkk(now), drop: { code: d.code, title: pickLang(d.title, 'en'), opensAt: isoBkk(d.opens_at), closesAt: isoBkk(d.closes_at), cap: d.cap },
      stock: tot.stock.map(s => ({ stockId: s.id, design: s.design, designName: s.designName.en, colour: s.colour, colourName: s.colourName.en,
        size: s.size, priceThb: s.priceThb, cap: s.cap, sold: s.sold, thb: (paidAt.find(x => x.stock_id === s.id) || {}).thb || 0,
        handed: (handed.find(h => h.stock_id === s.id) || {}).n || 0 })),
      tees: { sold: tot.tees.sold, handed: handed.reduce((n, h) => n + h.n, 0) }, orders: tot.orders, money: tot.money, refunds: tot.refunds,
      costs: costs || {}, costTotal, baseLessCosts: tot.money.base - costTotal };
  }
  function readCosts(c) {
    if (c == null) return { value: {} };
    if (typeof c !== 'object' || Array.isArray(c) || Object.keys(c).length > 20) return { error: 'costs: up to 20 lines, {label: baht}' };
    const out = {};
    for (const [k, v] of Object.entries(c)) {
      const label = k.replace(/\s+/g, ' ').trim(), n = Number(v);
      if (!label || label.length > 40 || /[<>]/.test(label) || !Number.isInteger(n) || n < 0 || n > 10000000) return { error: `costs: "${label.slice(0, 40)}" needs whole baht` };
      out[label] = n;
    }
    return { value: out };
  }
  app.post('/api/bkk/admin/tee/drops/:id/finish', async (req, res) => {
    if (teeStaff(req, res)) return;
    const id = teeId(req.params.id), b = req.body || {}, now = nowMs();
    const c = readCosts(b.costs);
    if (c.error) return res.status(400).json({ error: c.error, field: 'costs' });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const stop = async (code, body) => { await client.query('ROLLBACK'); res.status(code).json(body); };
      const d = await teeDropById(client, id, true);
      if (!d) return await stop(404, { error: 'no such tee pre-order' });
      if (d.done_at) return await stop(409, { error: 'This pre-order is finished already.', report: d.report });
      if (now < new Date(d.closes_at).getTime() && d.published) return await stop(409, { error: 'Close the pre-order first.' });
      // A buyer still inside their hold may pay yet: finish once the last hold has run out.
      const live = (await client.query(`SELECT count(*)::int AS n, max(t.hold_until) AS until FROM bkk_tee_orders t
        JOIN bkk_orders o ON o.id = t.order_id
        WHERE t.drop_id=$1 AND t.status='new' AND o.status IN ('pending','failed') AND t.hold_until > $2`, [d.id, at(now)])).rows[0];
      if (live.n) return await stop(409, { error: `${live.n} unpaid order(s) can still be paid until ${bkkMinute(live.until)} Bangkok time. Finish after that.`,
        holds: live.n, until: isoBkk(live.until) });
      const open =(await client.query(`SELECT count(*)::int AS n FROM bkk_tee_orders WHERE drop_id=$1 AND status IN ('paid','oversold')`, [d.id])).rows[0].n;
      if (open && b.confirm !== true) return await stop(409, { error: `${open} paid order(s) not handed over yet. Send confirm to finish anyway.`, notHanded: open });
      const report = await teeReport(client, d, c.value, now);
      const row = (await client.query(`UPDATE bkk_tee_drops SET costs=$2, report=$3, done_at=$4 WHERE id=$1 RETURNING *`,
        [d.id, JSON.stringify(c.value), JSON.stringify(report), at(now)])).rows[0];
      await client.query('COMMIT');
      res.json({ success: true, drop: teeDropOut(row, now), report });
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      res.status(500).json({ error: e.message });
    } finally { client.release(); }
  });
  // The frozen report once finished; before that, the same report live, with the costs saved so far.
  app.get(['/api/bkk/admin/tee/drops/:id/report', '/api/bkk/admin/tee/drops/:id/report.csv'], async (req, res) => {
    if (teeStaff(req, res)) return;
    try {
      const now = nowMs(), d = await teeDropById(pool, teeId(req.params.id));
      if (!d) return res.status(404).json({ error: 'no such tee pre-order' });
      const r = d.report ? { ...d.report, live: false } : { ...await teeReport(pool, d, d.costs || {}, now), live: true };
      if (!req.path.endsWith('.csv')) return res.json({ report: r });
      const rows = [['section', 'item', 'qty', 'thb'],
        ...r.stock.map(s => ['tees', `${s.designName} · ${s.colourName} · ${s.size}`, s.sold, s.thb]),
        ['money', 'paid orders', r.money.n, r.money.amount], ['money', 'price (before fee and VAT)', '', r.money.base],
        ['money', 'online fee', '', r.money.fee], ['money', 'VAT 7%', '', r.money.vat],
        ['money', 'refunded orders', r.refunds.n, r.refunds.amount],
        ...Object.entries(r.costs || {}).map(([k, v]) => ['cost', k, '', v]),
        ['result', 'price less costs', '', r.baseLessCosts]];
      res.set('Content-Type', 'text/csv; charset=utf-8')
        .set('Content-Disposition', `attachment; filename="aybkk-tees-${d.code}-report.csv"`);
      res.send('﻿' + rows.map(x => x.map(csvCell).join(',')).join('\r\n') + '\r\n');
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
  // Delete contact details now (confirm): handed, cancelled and lapsed unpaid orders of this drop;
  // on a finished drop every order. A problem note still keeps its order.
  app.post('/api/bkk/admin/tee/drops/:id/purge', async (req, res) => {
    if (teeStaff(req, res)) return;
    try {
      const d = await teeDropById(pool, teeId(req.params.id));
      if (!d) return res.status(404).json({ error: 'no such tee pre-order' });
      if ((req.body || {}).confirm !== true) return res.status(409).json({ error: 'Send confirm to delete the contact details.', needs: 'confirm' });
      const r = await teePurge({ dropId: d.id, all: true, done: !!d.done_at });
      const left = (await q(`SELECT count(*)::int AS n FROM bkk_tee_orders WHERE drop_id=$1 AND purged_at IS NULL`, [d.id])).rows[0].n;
      res.json({ success: true, purged: r.purged, kept: left });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Find a student. There was no way to do this at all, so "I lost my code" had
  // no answer from either side.
  app.get('/api/bkk/admin/members', async (req, res) => {
    if (adminOnly(req, res)) return;
    try {
      const term = String(req.query.q || '').trim();
      // ?consent=missing (once the agreement is on): people with a pass live today who have not
      // signed the current version, with or without a search term.
      const mode = await consentMode();
      const missing = req.query.consent === 'missing' && mode !== 'off';
      if (term.length < 2 && !missing) return res.json({ members: [] });
      const like = `%${term.toLowerCase()}%`;
      // ?on=YYYY-MM-DD: has_pass for a class that is over, as takeSeat's late
      // rule sees it (PASS_LIVE_ON). pass_starts: every pass that counts starts
      // after that day (today without ?on=), so the add box can say so.
      const on = realYmd(req.query.on) ? req.query.on : null;
      const day = on ? '$2::date' : `(now() AT TIME ZONE 'Asia/Bangkok')::date`;
      const usable = `p.member_id = m.id AND ${on ? PASS_LIVE_ON(day) : `p.status='active' AND (p.valid_until IS NULL OR p.valid_until >= ${day})`}
             AND (p.kind='unlimited' OR p.credits_used < p.credits_total)`;
      const live = `EXISTS (SELECT 1 FROM bkk_passes p WHERE p.member_id = m.id AND p.status='active'
        AND (p.valid_until IS NULL OR p.valid_until >= (now() AT TIME ZONE 'Asia/Bangkok')::date)
        AND (p.kind='unlimited' OR p.credits_used < p.credits_total))`;
      const r = await q(
        `SELECT m.*,
           (SELECT count(*)::int FROM bkk_bookings b
             WHERE b.member_id = m.id AND b.status='booked' AND b.start_at >= now()) AS booked,
           ${mode === 'off' ? '' : `${SIGNED('m.id')} AS consent_signed, ${GUARDIAN_DUE('m.id')} AS guardian_due,`}
           EXISTS (SELECT 1 FROM bkk_passes p WHERE ${usable}) AS has_pass,
           (SELECT to_char(min(p.valid_from),'YYYY-MM-DD') FROM bkk_passes p WHERE ${usable}
             HAVING bool_and(coalesce(p.valid_from > ${day}, false))) AS pass_starts
         FROM bkk_members m
         WHERE m.merged_into IS NULL ${missing ? `AND ${live} AND NOT ${SIGNED('m.id')}` : ''}
           AND (${missing && term.length < 2 ? 'true OR ' : ''}lower(m.name) LIKE $1 OR lower(m.email) LIKE $1
            OR EXISTS (SELECT 1 FROM unnest(coalesce(m.former_names, '{}')) n WHERE lower(n) LIKE $1)
            OR lower(m.code) LIKE $1 OR coalesce(m.phone,'') LIKE $1 OR lower(coalesce(m.rezerv_id,'')) LIKE $1
            OR EXISTS (SELECT 1 FROM bkk_members f WHERE f.merged_into = m.id
              AND (lower(f.code) LIKE $1 OR lower(coalesce(f.rezerv_id,'')) LIKE $1 OR lower(f.name) LIKE $1
                OR lower(coalesce(f.email,'')) LIKE $1 OR coalesce(f.phone,'') LIKE $1
                OR EXISTS (SELECT 1 FROM unnest(coalesce(f.former_names, '{}')) n WHERE lower(n) LIKE $1))))
         ORDER BY m.name LIMIT ${missing ? 200 : 25}`, on ? [like, on] : [like]);
      const ids = r.rows.map(m => m.id);
      const [passes, folded] = ids.length ? await Promise.all([q(
        `SELECT p.*, pr.name_en, pr.name_th FROM bkk_passes p JOIN bkk_products pr ON pr.id=p.product_id
         WHERE p.member_id = ANY($1::int[]) ORDER BY p.id DESC`, [ids]), q(
        `SELECT merged_into, code, name, email, rezerv_id, desk_note, to_char(merged_at AT TIME ZONE 'Asia/Bangkok','YYYY-MM-DD') AS merged_on
         FROM bkk_members WHERE merged_into = ANY($1::int[]) ORDER BY merged_at`, [ids])]).then(rs => rs.map(x => x.rows)) : [[], []];
      res.json({
        members: r.rows.map(({ merge_log, consent_signed, guardian_due, ...m }) => ({
          ...m, ...(mode === 'off' ? {} : { consent: { signed: consent_signed, guardianDue: guardian_due } }),
          passes: passes.filter(p => p.member_id === m.id),
          folded: folded.filter(f => f.merged_into === m.id).map(({ merged_into, ...f }) => f),
        })),
      });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Grant a pass with no order behind it: migrating a student who already paid
  // Rezerv, or a comp. Deliberately NOT activateOrder(), which would fabricate a
  // paid order, ping Telegram about money that never arrived, and email the
  // student a receipt for a payment they did not make.
  app.post('/api/bkk/admin/passes', async (req, res) => {
    if (adminOnly(req, res)) return;
    try {
      const { memberCode, name, email, phone, productCode,
              validFrom, validUntil, creditsTotal, creditsUsed, note, source } = req.body || {};
      await switchPrices();
      const pr = (await q('SELECT * FROM bkk_products WHERE code=$1', [productCode])).rows[0];
      if (!pr) return res.status(404).json({ error: 'product not found' });

      let m = memberCode
        ? await memberByCode(memberCode)
        : await findOrCreateMember({ name, email, phone });
      if (!m) return res.status(404).json({ error: 'member not found' });

      // An imported pass MUST carry both ends of its window. With only one end
      // set, the first booking would rewrite the expiry the student paid for.
      const vFrom = validFrom || null;
      const vUntil = validUntil || null;
      if ((vFrom && !vUntil) || (!vFrom && vUntil)) {
        return res.status(400).json({
          error: 'give both validFrom and validUntil, or neither (neither = starts on first booking)' });
      }

      const p = (await q(
        `INSERT INTO bkk_passes
           (member_id,product_id,order_id,kind,credits_total,credits_used,daily_cap,
            valid_days,valid_from,valid_until,note,source)
         VALUES ($1,$2,NULL,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
        [m.id, pr.id, pr.kind,
         creditsTotal != null ? creditsTotal : pr.credits,
         creditsUsed != null ? creditsUsed : 0,
         pr.daily_cap, pr.valid_days, vFrom, vUntil,
         note || null, source || 'manual'])).rows[0];
      console.log(`✓ bkk: pass granted by hand to ${m.code} (${pr.name_en}, source=${source || 'manual'})`);
      res.json({ success: true, member: { code: m.code, name: m.name }, pass: p });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Move students over from Rezerv in one paste (Oct 2026). Safe to run again:
  // a student is matched by email, else by exact name, and a pass with the same
  // package and end date is never added twice. A second run with emails fills
  // them in, which is what lets the student sign in and see their profile.
  // Rezerv's own names: "1 Month unlimited (9600thb + online transaction fee 5%)",
  // "1 Year (13 months)", "10 classes/3mo (…)", "Drop-in". A package named after
  // one of our classes ("Mysore 5.30am (1st batch) (Refunded credits)") is a
  // one-class credit; "Mysore with <guest teachers>" is a workshop, not ours.
  const CLASS_CREDIT = /^(?!.*\b(workshop|with)\b)(\[online\]\s*)?(mysore|led\s+(primary|intermediate)|self[\s-]*practice)\b/i;
  // A class credit Rezerv gives back (a cancelled class) is no sale: never the copy of one.
  const creditBack = s => CLASS_CREDIT.test(s) || /refunded\s*credits?/i.test(s);
  const CREDIT_NOTE = 'a class Rezerv gave back';
  const IMPORT_PLANS = [[/^1\s*month/i, 'unlim1'], [/^2\s*months?/i, 'unlim2'], [/^3\s*months?/i, 'unlim3'],
    [/^6\s*months?/i, 'unlim6'], [/^(12\s*months?|1\s*years?)\b/i, 'unlim12'], [/^10[\s-]*class/i, 'pack10'],
    [/^8[\s-]*class.*\b1\s*(month|mo)\b/i, 'pack8m1'], [/^8[\s-]*class/i, 'pack8'], [/^drop[\s-]*in\b/i, 'dropin'], [CLASS_CREDIT, 'dropin']];
  const RETIRED_PLANS = {
    unlim2: { en: '2 months unlimited', th: '2 เดือน ไม่จำกัด', price: 18200, days: 60, sort: 40 },
    unlim6: { en: '6 months unlimited', th: '6 เดือน ไม่จำกัด', price: 45000, days: 180, sort: 60 },
    unlim12: { en: '12 months unlimited (1 free month)', th: '12 เดือน ไม่จำกัด (ฟรี 1 เดือน)', price: 78000, days: 395, sort: 70 },
  };
  // Rezerv years stay on the 13-month package: valid_from is worked back from
  // the end date, and 365 days on a pass that really runs 395 would start it a
  // month late and block the student's bookings. Too early is harmless.
  const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
  function importDate(v) {
    const s = String(v || '').trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    const m = s.match(/^(\d{1,2})\s+([A-Za-z]{3})[a-z]*\s+(\d{4})$/);
    if (!m || !MONTHS[m[2].toLowerCase()]) return null;
    return `${m[3]}-${String(MONTHS[m[2].toLowerCase()]).padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  }
  // 2- and 6-month plans are no longer sold, but Rezerv students still hold
  // them: keep the package as a retired (never for sale) record.
  async function planProduct(db, code) {
    const pr = (await db.query('SELECT * FROM bkk_products WHERE code=$1', [code])).rows[0];
    if (pr || !RETIRED_PLANS[code]) return pr || null;
    const r = RETIRED_PLANS[code];
    return (await db.query(`INSERT INTO bkk_products (code,name_en,name_th,price_thb,kind,credits,valid_days,daily_cap,sort,active)
                   VALUES ($1,$2,$3,$4,'unlimited',NULL,$5,2,$6,false)
                   ON CONFLICT (code) DO UPDATE SET code=EXCLUDED.code RETURNING *`,
      [code, r.en, r.th, r.price, r.days, r.sort])).rows[0];
  }
  app.post('/api/bkk/admin/import', async (req, res) => {
    if (adminOnly(req, res)) return;
    const rows = Array.isArray((req.body || {}).rows) ? req.body.rows.slice(0, 500) : [];
    const out = { members: 0, newMembers: 0, emailsAdded: 0, passes: 0, skipped: [] };
    try {
      for (const row of rows) {
        const name = String(row.name || '').replace(/\s*\((renewed|staff)\)\s*/gi, ' ').trim();
        const email = String(row.email || '').trim().toLowerCase();
        const phone = String(row.phone || '').trim();
        if (!name) continue;
        const plan = IMPORT_PLANS.find(([re]) => re.test(String(row.plan || '').trim()));
        const until = importDate(row.until);
        if (!plan || !until) { out.skipped.push(`${name}: plan or end date not understood`); continue; }
        const pr = await planProduct(pool, plan[1]);
        if (!pr) { out.skipped.push(`${name}: package ${plan[1]} missing`); continue; }

        let m = email && email.includes('@')
          ? await liveMember(pool, (await q('SELECT * FROM bkk_members WHERE lower(email)=$1 LIMIT 1', [email])).rows[0]) : null;
        if (!m) m = await liveMember(pool, (await q('SELECT * FROM bkk_members WHERE lower(name)=lower($1) ORDER BY id LIMIT 1', [name])).rows[0]);
        // Nobody has the name now: a student who had it before (Change name), when only one did.
        if (!m) {
          const was = new Map();
          for (const r of (await q(`SELECT * FROM bkk_members WHERE lower($1) = ANY (SELECT lower(n) FROM unnest(coalesce(former_names, '{}')) n)
            ORDER BY id`, [name])).rows) { const x = await liveMember(pool, r); if (x) was.set(x.id, x); }
          if (was.size > 1) { out.skipped.push(`${name}: ${was.size} students had this name before, add their email`); continue; }
          m = [...was.values()][0] || null;
        }
        if (!m) {
          m = (await q(`INSERT INTO bkk_members (code,name,email,phone) VALUES ($1,$2,$3,$4) RETURNING *`,
            [memberCode(), name, email.includes('@') ? email : null, phone || null])).rows[0];
          out.newMembers++;
        } else if (email.includes('@') && !m.email) {
          await q('UPDATE bkk_members SET email=$2 WHERE id=$1', [m.id, email]);
          out.emailsAdded++;
        }
        if (phone && !m.phone) await q('UPDATE bkk_members SET phone=$2 WHERE id=$1', [m.id, phone]);
        out.members++;

        const dup = await q(`SELECT 1 FROM bkk_passes WHERE member_id=$1 AND product_id=$2 AND valid_until=$3`,
          [m.id, pr.id, until]);
        if (dup.rows.length) continue;
        const from = new Date(Date.parse(until + 'T00:00:00Z') - (pr.valid_days - 1) * 86400e3).toISOString().slice(0, 10);
        const left = row.classesLeft != null && row.classesLeft !== '' ? Number(row.classesLeft) : null;
        const total = pr.kind === 'credits' ? (pr.credits || 10) : null;
        await q(`INSERT INTO bkk_passes
            (member_id,product_id,order_id,kind,credits_total,credits_used,daily_cap,
             valid_days,valid_from,valid_until,note,source)
          VALUES ($1,$2,NULL,$3,$4,$5,$6,$7,$8,$9,$10,'rezerv')`,
          [m.id, pr.id, pr.kind, total,
           total != null && left != null && !isNaN(left) ? Math.max(0, total - left) : 0,
           pr.daily_cap, pr.valid_days, from, until, 'moved from Rezerv']);
        out.passes++;
      }
      console.log(`✓ bkk: Rezerv import ${JSON.stringify({ ...out, skipped: out.skipped.length })}`);
      res.json({ success: true, ...out });
    } catch (e) { res.status(500).json({ error: e.message, ...out }); }
  });

  // ── keep all history: everything from Rezerv (Oct 2026) ───────────────────
  // Rezerv's export columns were not known when this was written, so the admin
  // page maps the file's columns to the field names below and this reads only
  // those: a birthday, address, ID or card number in the file is never read.
  // One transaction per call, and a dry run is that same run rolled back, so it
  // reports exactly what the import would do. Imports never go through
  // activateOrder (no pass, no Telegram, no receipt) and never touch credits.
  const IMPORT_MAX_ROWS = 1000;
  const clean = (v, n) => noCards(String(v ?? '').replace(/\s+/g, ' ').trim()).slice(0, n);
  // Ids and phones are not free text: the card scrub would turn every tenth
  // long id into the same "[card number removed]" and merge people.
  const cleanId = (v, n = 100) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
  // Excel drops leading zeros (00123 → 123), so an all-digit id is kept without them.
  // Rezerv writes 0 for a booking with no customer account: that is no id at all,
  // and as an id it would put every such guest on one profile.
  const importId = v => { const s = cleanId(v); return /^\d+$/.test(s) ? s.replace(/^0+/, '') : s; };
  // …and writes long ones as 1.23E+15, which no longer says which id it was.
  const excelId = v => /^\d+(\.\d+)?e\+?\d+$/i.test(cleanId(v));

  // Every skip reason and note carries a code and its values, so the admin
  // page can say it in Thai. The English text is for anything else.
  const THEN = { hand: 'check by hand', made: 'made a new student', madeNoEmail: 'made a new student without the email' };
  const IMPORT_EN = {
    noName: () => 'no name',
    sharePhone: (n, p) => `${n} students share the phone ${p}: add email`,
    sameName: (n, name) => `${n} students named ${name}: add email or phone`,
    noWho: () => 'no student on this row: map a customer id, email, phone or name',
    notFound: () => 'student not found: add their name to make a new one',
    clashEmail: (e, name, code, rz, then) => `${e} is on ${name}'s profile (${code}, Rezerv id ${rz}): ${THEN[then]}`,
    clashPhone: (p, name, code, fileName, then) => `phone ${p} is on ${name}'s profile (${code}), the file says ${fileName}: ${THEN[then]}`,
    clashOtherEmail: (name, code, e, then) => `a student named ${name} (${code}) has another email (${e}): ${THEN[then]}`,
    excelId: v => `id "${v}": Excel changed this id: export again without opening in Excel`,
    badDate: v => `date "${v}" not understood`,
    badTime: v => `time "${v}" not understood`,
    badStatus: v => `status "${v}" not understood`,
    waitlist: () => 'a waiting-list place, not a visit',
    noSlot: (time, date) => `no class on our timetable at ${time || 'that time'} on ${classWhen(date, '').slice(0, -2)}: book it by hand`,
    moonDay: d => `${d} is a moon day: the shala is closed`,
    classOff: (title, d) => `${title} on ${d} is cancelled`,
    idReused: (id, what) => `Rezerv id ${id} is already used for a different ${what}: map a per-line id, or none`,
    badAmount: v => `amount "${v}" not understood`,
    payStatus: v => `payment status "${v}" not understood`,
    notMoney: v => `payment status "${v}": no money came in, so it is not kept`,
    payVoided: id => `payment ${id} was voided in Rezerv: it no longer counts as money`,
    twinOfAybkk: ref => `a ฿0 line for the sale paid on aybkk.net as ref ${ref}: kept as the same sale, not counted as money`,
    maybeTwin: (ref, pkg) => `aybkk.net has a paid sale of ${pkg || 'this package'} within 5 days (ref ${ref}): kept as paid; check it is not one sale entered twice`,
    rezervTwin: ref => `the same Rezerv payment is here already as order ${ref}, from a file with or without Rezerv's id: not added again`,
    twinPass: (ref, used, total, from, until, paused) => `the same sale as the aybkk.net pass of ref ${ref}: kept as a void pass, so the student has one pass`
      + (used ? `; the ${used} of ${total} classes used in Rezerv now count on that pass` : '')
      + (from ? `; that pass now starts on ${from}, as in Rezerv${until ? `, and ends on ${until}` : ''}` : '')
      + (paused ? `; Rezerv has it paused${paused !== '-' ? ` from ${paused}` : ''}: the pass kept is not paused here` : ''),
    badPlan: v => `package "${v}" is not one of ours (a workshop, or not understood): not kept as a pass`,
    passStatus: v => `pass status "${v}" not understood: read as no status`,
    neverStarted: v => `never started, and Rezerv says ${v}: nothing to keep`,
    copyOfSale: (pkg, d) => `the same ${pkg} was sold on aybkk.net (${d}) and Rezerv has no payment for this one: a copy, not kept`,
    passOff: v => `Rezerv says ${v}: kept as history, it cannot be used`,
    badFreeze: v => `pause date "${v}" not understood: left out`,
    freezeLater: (a, b) => `Rezerv has a pause from ${a}${b ? ' to ' + b : ''}: pause it here on that day`,
    badUntil: v => `end date "${v}" not understood`,
    badStart: v => `start date "${v}" not understood`,
    startsAfterEnd: () => 'it starts after it ends',
    noPackage: c => `package ${c} missing`,
    badLeft: v => `classes left "${v}" not understood`,
    duplicate: () => 'already there (a duplicate)',
    notEmail: v => `"${v}" is not an email address: left out`,
    badJoined: v => `joined date "${v}" not understood: left out`,
    badCheckIn: v => `check-in time "${v}" not understood: left out`,
    overCap: (n, cap, title, d) => `over capacity: ${n} for ${cap} places in ${title} on ${d}`,
    badVat: v => `VAT "${v}" not understood: 0 kept`,
    emailTaken: (e, name, code, to) => `${e} is on ${name}'s profile (${code}): not added to ${to}`,
    keepsEmail: (name, e, fe) => `${name} keeps the email ${e}; the file says ${fe}`,
    keepsRezervId: (name, id, fid) => `${name} keeps the Rezerv id ${id}; the file says ${fid}`,
    leftOver: (left, total) => `${left} classes left is more than the ${total} in the package: ${total} kept`,
    keptHere: (here, file) => `Rezerv says ${file}, but it is ${here} here: kept as it is here`,
    cameDoor: file => `checked in at our door; Rezerv says ${file}: not added`,
    newStudent: name => `new student: ${name}`,
    pastBooked: n => `${n} past visits say booked, not attended: kept as booked, so they do not count as classes practised. `
      + 'If Rezerv never marked attendance, import again with past bookings counted as attended.',
  };
  const why = (code, ...vals) => ({ code, vals, text: IMPORT_EN[code](...vals) });

  // Who a row is about. rezervKey: the column holding their Rezerv customer id.
  function importWho(row, rezervKey, warn) {
    const raw = String(row.email ?? '').trim().toLowerCase();
    const email = raw && raw.length <= 200 && EMAIL_RE.test(raw) ? raw : null;
    if (raw && !email) warn(why('notEmail', raw.slice(0, 60)));
    // Rezerv writes "+66" alone for a student with no phone: a country code is not a phone.
    const phone = cleanId(row.phone, 40);
    return { rezervId: importId(row[rezervKey]) || null, email, phone: phone.replace(/\D/g, '').length >= 6 ? phone : null,
      name: clean(row.name, 120) || null, bad: excelId(row[rezervKey]) ? why('excelId', cleanId(row[rezervKey], 40)) : null };
  }

  // Rezerv id, then email, then phone (the last 9 digits: 081… and +6681… are
  // one number), then the exact name (or a name staff changed it from). Someone found by phone or name who
  // carries a different Rezerv id is somebody else. One whose email, or for a
  // phone their name, says it is somebody else is a clash: never merged.
  // A folded profile still answers to its own Rezerv id, email, phone and name,
  // and the row lands on the profile it was merged into. raw is the profile the
  // row's own details found: hashed refs are keyed on it, so a row stored before
  // a merge (or during one that was undone) is found again.
  async function importFind(db, f) {
    if (f.rezervId) {
      const raw = (await db.query('SELECT * FROM bkk_members WHERE rezerv_id=$1', [f.rezervId])).rows[0];
      const r = await liveMember(db, raw);
      if (r) return { member: r, raw };
    }
    let clash = null;
    if (f.email) {
      const raw = await rawByEmail(db, f.email);
      const r = await liveMember(db, raw);
      if (r && !(f.rezervId && r.rezerv_id && r.rezerv_id !== f.rezervId)) return { member: r, raw };
      if (r) clash = { code: 'clashEmail', vals: [f.email, r.name, r.code, r.rezerv_id] };
    }
    // Profiles that fit, one answer per student: a merged pair is one person.
    // The student a folded row leads to must fit too: its Rezerv id or email
    // (moved there by the merge) saying somebody else rules it out.
    const perStudent = async fits => {
      const by = new Map();
      for (const raw of fits) {
        const m = await liveMember(db, raw);
        if (m && !other(m) && !emailOff(m)) by.set(m.id, by.has(m.id) ? { member: m, raw: m } : { member: m, raw });
      }
      return [...by.values()];
    };
    const other = m => f.rezervId && m.rezerv_id && m.rezerv_id !== f.rezervId;
    const norm = s => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();
    const emailOff = m => f.email && m.email && m.email.toLowerCase() !== f.email;
    // A name staff changed (former_names) is still this student's.
    const nameOff = m => f.name && norm(m.name) !== norm(f.name) && !(m.former_names || []).some(n => norm(n) === norm(f.name));
    const clashOf = m => emailOff(m) ? { code: 'clashOtherEmail', vals: [m.name, m.code, m.email] }
      : { code: 'clashPhone', vals: [f.phone, m.name, m.code, f.name] };
    const digits = String(f.phone || '').replace(/\D/g, '');
    if (digits.length >= 9) {
      const rows = (await db.query(
        `SELECT * FROM bkk_members WHERE right(regexp_replace(coalesce(phone,''), '\\D', '', 'g'), 9) = $1 ORDER BY id`,
        [digits.slice(-9)])).rows.filter(m => !other(m));
      // A shared family phone, or a placeholder like 0000000000, is no proof alone.
      const fits = await perStudent(rows.filter(m => !emailOff(m) && !nameOff(m)));
      if (fits.length === 1) return fits[0];
      if (fits.length > 1) return { reason: why('sharePhone', fits.length, f.phone) };
      if (rows.length && !clash) clash = clashOf(rows[0]);
    }
    if (f.name) {
      const rows = (await db.query(
        `SELECT * FROM bkk_members WHERE lower(regexp_replace(btrim(name), '\\s+', ' ', 'g')) = lower($1)
           OR EXISTS (SELECT 1 FROM unnest(coalesce(former_names, '{}')) n WHERE lower(regexp_replace(btrim(n), '\\s+', ' ', 'g')) = lower($1))
         ORDER BY id`,
        [f.name.replace(/\s+/g, ' ').trim()])).rows.filter(m => !other(m));
      const fits = await perStudent(rows.filter(m => !emailOff(m)));
      if (fits.length === 1) return fits[0];
      if (fits.length > 1) return { reason: why('sameName', fits.length, f.name) };
      if (rows.length && !clash) clash = clashOf(rows[0]);
    }
    return clash ? { clash } : {};
  }

  const importNewMember = (db, f) => db.query(
    `INSERT INTO bkk_members (code,name,email,phone,rezerv_id,joined_on,source)
     VALUES ($1,$2,$3,$4,$5,$6,'rezerv') RETURNING *`,
    [memberCode(), f.name, f.email, f.phone, f.rezervId, f.joinedOn || null]).then(r => r.rows[0]);

  // Fills what a found student is missing. Never overwrites: a different
  // email or Rezerv id on file stays, and the import says so.
  async function fillMember(db, m, f, warn) {
    const set = {};
    if (f.email && !m.email) {
      const o = (await db.query('SELECT code,name FROM bkk_members WHERE lower(email)=$1 AND id<>$2', [f.email, m.id])).rows[0];
      if (o) warn(why('emailTaken', f.email, o.name, o.code, m.name));
      else set.email = f.email;
    } else if (f.email && String(m.email).toLowerCase() !== f.email
      && !(await db.query('SELECT 1 FROM bkk_members WHERE lower(email)=$1 AND merged_into=$2', [f.email, m.id])).rows.length) {
      warn(why('keepsEmail', m.name, m.email, f.email));
    }
    if (f.phone && !m.phone) set.phone = f.phone;
    if (f.joinedOn && !m.joined_on) set.joined_on = f.joinedOn;
    // A Rezerv id still on a profile folded into this one is already this student's.
    if (f.rezervId && m.rezerv_id !== f.rezervId
      && !(await db.query('SELECT 1 FROM bkk_members WHERE rezerv_id=$1 AND merged_into=$2', [f.rezervId, m.id])).rows.length) {
      if (!m.rezerv_id) set.rezerv_id = f.rezervId;
      else warn(why('keepsRezervId', m.name, m.rezerv_id, f.rezervId));
    }
    const keys = Object.keys(set);
    if (!keys.length) return false;
    await db.query(`UPDATE bkk_members SET ${keys.map((k, i) => `${k}=$${i + 2}`).join(', ')} WHERE id=$1`,
      [m.id, ...keys.map(k => set[k])]);
    return true;
  }

  // For visits, payments and passes: a new student only when a name is given
  // and nobody matches.
  async function importStudent(db, row, ctx, warn) {
    const f = importWho(row, 'memberRezervId', warn);
    if (f.bad) return { skip: f.bad };
    if (!f.rezervId && !f.email && !f.phone && !f.name) return { skip: why('noWho') };
    const hit = await importFind(db, f);
    if (hit.reason) return { skip: hit.reason };
    if (hit.member) return { member: hit.member, f, refId: hit.raw.id };
    // Somebody else's email, phone or name: their visits and money must not
    // land on that profile, and nobody can tell from here who this is.
    if (hit.clash) return { skip: why(hit.clash.code, ...hit.clash.vals, 'hand') };
    if (!f.name) return { skip: why('notFound') };
    ctx.made = f.name;
    const made = await importNewMember(db, f);
    return { member: made, f, refId: made.id };
  }

  // Rezerv's own id for the row, else a hash of what makes it that row. The
  // nth identical row in a file is its own record (two drop-ins on one day):
  // the page numbers them over the whole file (row.nth), as a batch of 1,000
  // rows cannot see the one before it.
  function importRef(kind, rezervId, parts, row, ctx) {
    const id = importId(rezervId);
    if (id) return id;
    const h = crypto.createHash('sha1').update([kind, ...parts].join('|')).digest('hex').slice(0, 24);
    let n = Number.isInteger(row.nth) && row.nth > 0 ? row.nth : 1;
    while (ctx.seen.has(`${h}#${n}`)) n++;
    ctx.seen.add(`${h}#${n}`);
    return `h:${h}${n > 1 ? '#' + n : ''}`;
  }
  // A hashed ref carries the id of the profile the row's details found
  // (parts[0]). A row stored under another profile of the same student (before
  // a merge, or found another way since) is looked for under each of them too.
  async function familyRefs(db, kind, ref, parts, liveId) {
    if (!ref.startsWith('h:')) return [ref];
    const ids = (await db.query('SELECT id FROM bkk_members WHERE id=$1 OR merged_into=$1', [liveId])).rows
      .map(r => r.id).filter(id => id !== parts[0]);
    const nth = ref.slice(26);
    return [ref, ...ids.map(id => 'h:' + crypto.createHash('sha1')
      .update([kind, id, ...parts.slice(1)].join('|')).digest('hex').slice(0, 24) + nth)];
  }

  // Weekday + start time (active or not). Online and shala classes share
  // times, so the class name decides between them; with no time, only a name
  // that one slot that weekday carries. A named online class is never put on a
  // shala slot, or the other way round: Rezerv's online Led Intermediate ran at
  // 08:45, the shala's start, and ours starts at 09:00.
  function matchSlot(slots, date, time, className) {
    const wd = new Date(`${date}T12:00:00${TZ_OFFSET}`).getUTCDay();
    const name = String(className || '').toLowerCase();
    let c = slots.filter(s => s.weekday === wd && (time ? s.start_time === time : name && s.title.toLowerCase() === name));
    if (!time) return c.length === 1 ? c[0] : null;
    if (name) {
      const online = /online|zoom|ออนไลน์/i.test(name);
      c = c.filter(s => !!s.is_online === online);
    }
    if (c.length > 1) {
      const exact = c.filter(s => s.title.toLowerCase() === name);
      if (exact.length) c = exact;
    }
    c.sort((a, b) => (b.active - a.active) || a.id - b.id);
    return c[0] || null;
  }

  async function importMemberRow(db, row, ctx, warn) {
    const f = importWho(row, 'rezervId', warn);
    if (f.bad) return { skip: f.bad };
    if (!f.name) return { skip: why('noName') };
    const jRaw = clean(row.joinedOn, 40);
    const joined = jRaw ? parseWhen(jRaw) : null;
    if (jRaw && !joined) warn(why('badJoined', jRaw));
    f.joinedOn = joined ? joined.date : null;
    const hit = await importFind(db, f);
    if (hit.reason) return { skip: hit.reason };
    if (!hit.member) {
      // Somebody else holds that email, phone or name: a new student, never a merge.
      if (hit.clash) {
        const noEmail = hit.clash.code === 'clashEmail';
        warn(why(hit.clash.code, ...hit.clash.vals, noEmail ? 'madeNoEmail' : 'made'));
        if (noEmail) f.email = null;
      }
      await importNewMember(db, f);
      return { result: 'added' };
    }
    return { result: await fillMember(db, hit.member, f, warn) ? 'updated' : 'matched' };
  }

  // A "Checked in" column of Yes/No instead of a time.
  const CI_YES = /^(yes|y|true|1|[✓✔x]|ใช่|มา)$/i, CI_NO = /^(no|n|false|0|[✗✘]|ไม่|ไม่มา)$/i;
  async function importVisit(db, row, ctx, warn) {
    if (excelId(row.rezervId)) return { skip: why('excelId', cleanId(row.rezervId, 40)) };
    const when = parseWhen(row.date);
    if (!when) return { skip: why('badDate', clean(row.date, 40)) };
    const tRaw = clean(row.time, 20);
    // Excel saves a date-only cell as "04/10/2026 0:00": that is no time at all.
    const time = tRaw ? parseClock(tRaw) : when.time === '00:00' ? null : when.time;
    if (tRaw && !time) return { skip: why('badTime', tRaw) };
    let status = visitStatus(row.status);
    if (status === undefined) return { skip: why('badStatus', clean(row.status, 40)) };
    if (status === 'waitlist') return { skip: why('waitlist') };
    const ciRaw = clean(row.checkedInAt, 40);
    const ciSaid = CI_YES.test(ciRaw) ? 'yes' : CI_NO.test(ciRaw) ? 'no' : null;
    let ci = null;
    if (ciRaw && !ciSaid) {
      ci = parseWhen(ciRaw) || (parseClock(ciRaw) ? { date: when.date, time: parseClock(ciRaw) } : null);
      if (!ci) warn(why('badCheckIn', ciRaw));
    }

    const className = clean(row.className, 120) || null;
    const slot = matchSlot(ctx.slots, when.date, time, className);
    const startAt = startAtISO(when.date, slot ? slot.start_time : (time || '00:00'));
    const begun = new Date(startAt) <= ctx.now;
    if ((ci || ciSaid === 'yes') && (status === null || status === 'booked')) status = 'attended';
    if (ciSaid === 'no' && (status === null || status === 'booked')) status = 'unchecked';
    // Said not to have come: a no-show, never counted as attended by the tick box.
    if (status === 'unchecked') status = begun ? 'noshow' : 'booked';
    // No status: a row in a visits file is a visit, or a booking still to come.
    if (status === null) status = begun ? 'attended' : 'booked';
    if (status === 'booked' && begun) {
      if (ctx.pastBookedAttended) status = 'attended'; else ctx.rowPastBooked = true;
    }
    // A booking still to come is a real seat: it must be a class we run.
    const future = when.date >= ctx.today;
    let ov = null;
    if (status === 'booked' && future) {
      if (!slot || !slot.active) return { skip: why('noSlot', time, when.date) };
      if (moonDaysBetween(when.date, when.date).size) return { skip: why('moonDay', when.date) };
      ov = (await db.query('SELECT * FROM bkk_class_overrides WHERE slot_id=$1 AND class_date=$2', [slot.id, when.date])).rows[0];
      if (ov && ov.cancelled) return { skip: why('classOff', slot.title, when.date) };
    }

    const who = await importStudent(db, row, ctx, warn);
    if (who.skip) return who;
    const m = who.member;
    const own = importId(row.rezervId);
    const parts = [who.refId, when.date, time || '', className || (slot ? slot.title : '')];
    const ref = importRef('visits', row.rezervId, parts, row, ctx);
    const t = {
      status: status === 'attended' || status === 'booked' ? 'booked' : status === 'late' ? 'cancelled' : status,
      checkedIn: status === 'attended' ? (ci && ci.time ? startAtISO(ci.date, ci.time) : startAt) : null,
      reason: status === 'late' ? 'late cancel (Rezerv)' : status === 'cancelled' ? 'cancelled in Rezerv' : null,
    };
    const had = (await db.query(`SELECT *, to_char(class_date,'YYYY-MM-DD') AS d FROM bkk_bookings
      WHERE source='rezerv' AND source_ref = ANY($1::text[]) LIMIT 1`, [await familyRefs(db, 'visits', ref, parts, m.id)])).rows[0];
    if (had) {
      // One Rezerv id on two different visits: a class or order id mapped as the booking id.
      if (own && (had.member_id !== m.id || had.d !== when.date || new Date(had.start_at).getTime() !== Date.parse(startAt))) {
        return { skip: why('idReused', own, 'visit') };
      }
      if (had.status === t.status && !!had.checked_in_at === !!t.checkedIn) return { result: 'matched' };
      // Imported before. Rezerv may since have marked it attended or cancelled,
      // but only forward: a check-in at our door, a seat cancelled on aybkk.net
      // or a no-show is never undone by a later export.
      const here = visitStatusOut(had), file = t.checkedIn ? 'attended' : t.status;
      // Staff took it from a pass here: kept as it is, as a check-in here is.
      if (had.status !== 'booked' || had.checked_in_at || had.moved_at) {
        // Rezerv never sees our door, so "booked" there next to a check-in here is expected.
        if (!(here === 'attended' && file === 'booked')) warn(why('keptHere', here, file));
        return { result: 'matched' };
      }
      await db.query(`UPDATE bkk_bookings SET status=$2, checked_in_at=coalesce(checked_in_at, $3), cancel_reason=$4,
          cancelled_at=CASE WHEN $2='cancelled' THEN coalesce(cancelled_at, now()) ELSE cancelled_at END WHERE id=$1`,
        [had.id, t.status, t.checkedIn, t.reason]);
      return { result: 'updated' };
    }
    if (slot && t.status !== 'booked') {
      // Checked in at our door, which Rezerv never saw: they came, so its
      // no-show or cancel for that class is not added next to the visit. A
      // visit Rezerv itself kept is another booking: a cancel, then a rebook.
      const came = (await db.query(`SELECT 1 FROM bkk_bookings WHERE slot_id=$1 AND class_date=$2 AND member_id=$3
          AND status='booked' AND checked_in_at IS NOT NULL AND source IS DISTINCT FROM 'rezerv'`, [slot.id, when.date, m.id])).rows[0];
      if (came) { warn(why('cameDoor', t.status)); return { result: 'matched' }; }
    }
    if (slot && t.status === 'booked') {
      // On the list here already (the door, or booked on aybkk.net): one visit, not two.
      const seat = (await db.query(
        `SELECT id, checked_in_at FROM bkk_bookings WHERE slot_id=$1 AND class_date=$2 AND member_id=$3 AND status='booked'`,
        [slot.id, when.date, m.id])).rows[0];
      if (seat) {
        if (!t.checkedIn || seat.checked_in_at) return { result: 'matched' };
        await db.query('UPDATE bkk_bookings SET checked_in_at=$2 WHERE id=$1', [seat.id, t.checkedIn]);
        return { result: 'updated' };
      }
      if (future) {
        await db.query('SELECT pg_advisory_xact_lock($1::int, $2::int)', [slot.id, Number(when.date.replace(/-/g, ''))]);
        const cap = ov && ov.capacity != null ? ov.capacity : slot.capacity;
        const taken = await seatsTaken(db, slot.id, when.date);
        if (taken >= cap) warn(why('overCap', taken + 1, cap, slot.title, when.date));
      }
    }
    await db.query(
      `INSERT INTO bkk_bookings (slot_id,class_date,start_at,member_id,status,booked_at,checked_in_at,cancel_reason,cover,source,source_ref,class_title,via_member)
       VALUES ($1,$2,$3,$4,$5,NULL,$6,$7,'rezerv','rezerv',$8,$9,$10)`,
      [slot ? slot.id : null, when.date, startAt, m.id, t.status, t.checkedIn, t.reason, ref, className, who.refId]);
    return { result: 'added' };
  }

  // What was bought, as a package in the catalogue when it clearly is one.
  const ITEM_PLANS = [[/drop[\s-]*in|ครั้งเดียว/i, 'dropin'], ...IMPORT_PLANS];
  async function itemProduct(db, item) {
    if (!item) return null;
    // Rezerv never sold the 6-month from 12 Nov 2026, and it shares its name with the old one.
    const exact = (await db.query(
      `SELECT * FROM bkk_products WHERE (lower(name_en)=lower($1) OR lower(coalesce(name_th,''))=lower($1) OR code=lower($1))
         AND code <> 'unlim6m' ORDER BY id LIMIT 1`, [item])).rows[0];
    if (exact) return exact;
    const plan = ITEM_PLANS.find(([re]) => re.test(item));
    // Payments may come before the passes that make the retired 2-, 6- and 13-month packages.
    return plan ? planProduct(db, plan[1]) : null;
  }

  async function importPayment(db, row, ctx, warn) {
    if (excelId(row.rezervId)) return { skip: why('excelId', cleanId(row.rezervId, 40)) };
    const when = parseWhen(row.date);
    if (!when) return { skip: why('badDate', clean(row.date, 40)) };
    const amount = parseAmount(row.amount);
    if (amount == null) return { skip: why('badAmount', clean(row.amount, 40)) };
    // Only money that came in, or went back: a failed, pending or voided payment is not money.
    const st = payStatus(clean(row.status, 60));
    if (st === undefined) return { skip: why('payStatus', clean(row.status, 40)) };
    if (st === 'skip') {
      // Paid when it came over, voided in Rezerv since: no longer money here either.
      const own = importId(row.rezervId);
      if (own && /void|cancel|ยกเลิก/i.test(clean(row.status, 60))) {
        const v = await db.query(`UPDATE bkk_orders SET status='void', gateway_note=coalesce(gateway_note || ' | ', '') || 'voided in Rezerv'
          WHERE source='rezerv' AND source_ref=$1 AND status IN ('paid','refund') RETURNING id`, [own]);
        if (v.rows.length) { warn(why('payVoided', own)); return { result: 'updated' }; }
      }
      return { skip: why('notMoney', clean(row.status, 40)) };
    }
    const amt = st === 'refund' ? -Math.abs(Math.round(amount)) : Math.round(amount);
    let vat = 0;
    const vRaw = clean(row.vat, 40);
    if (vRaw) {
      const v = parseAmount(vRaw.replace(/%/g, ''));
      if (v == null) warn(why('badVat', vRaw));
      // "7%" is the rate, so the VAT inside the amount paid. A refund takes its VAT back.
      else vat = Math.abs(Math.round(vRaw.includes('%') ? amt * v / (100 + v) : v)) * (amt < 0 ? -1 : 1);
    }
    const item = clean(row.item, 120) || null;
    const methodRaw = clean(row.method, 60);
    const note = clean(row.note, 300);
    const who = await importStudent(db, row, ctx, warn);
    if (who.skip) return who;
    const own = importId(row.rezervId);
    const parts = [who.refId, when.date, when.time || '', item || '', amt];
    const ref = importRef('payments', row.rezervId, parts, row, ctx);
    const had = (await db.query(`SELECT o.member_id, o.amount_thb, o.item_name, to_char(${PAY_DAY},'YYYY-MM-DD') AS d
      FROM bkk_orders o WHERE o.source='rezerv' AND o.source_ref = ANY($1::text[]) LIMIT 1`,
      [await familyRefs(db, 'payments', ref, parts, who.member.id)])).rows[0];
    if (had) {
      // One Rezerv id on two different payments: an order or invoice with several lines.
      if (own && (had.member_id !== who.member.id || had.amount_thb !== amt || had.d !== when.date
        || (had.item_name || '') !== (item || ''))) return { skip: why('idReused', own, 'payment') };
      return { result: 'matched' };
    }
    // The same Rezerv payment already here from another file: one with Rezerv's
    // id, one without it (a hash), at the same minute or with no time in one of
    // them. One to one in a run: a second line with no row left to be its copy
    // is a second payment, and is added. A person looks, as only they can tell
    // two real payments of the same day and amount from one payment twice.
    const hm = when.time || '00:00';
    if (!ctx.copied) ctx.copied = [];
    const copy = (await db.query(`SELECT o.id, o.refno FROM bkk_orders o
      WHERE o.source='rezerv' AND o.member_id=$1 AND ${PAY_DAY}=$2::date AND o.amount_thb=$3
        AND lower(coalesce(o.item_name,''))=lower($4) AND (o.source_ref LIKE 'h:%') <> ($5 LIKE 'h:%')
        AND o.status IN ('paid','refund','twin') AND ${sameTime(hhmm('o'), '$6')} AND o.id <> ALL($7::int[])
      ORDER BY (${hhmm('o')} = $6) DESC, o.id LIMIT 1`,
      [who.member.id, when.date, amt, item || '', ref, hm, ctx.copied])).rows[0];
    if (copy) { ctx.copied.push(copy.id); warn(why('rezervTwin', String(copy.refno))); return { result: 'matched' }; }
    const pr = await itemProduct(db, item);
    const at = startAtISO(when.date, when.time || '00:00');
    // Sold on aybkk.net and entered in Rezerv too (staff still check in there):
    // a paid sale here of the same package family within 5 Bangkok days, the
    // same package first, then the nearest. A ฿0 line is the copy of one not
    // paired yet: kept, never money. A line with money may be the same sale typed
    // in at its price, or a second sale: a person decides, whether or not a ฿0
    // line of that sale came first in the file. A refund (a ฿0 one too), and a
    // class credit Rezerv gives back, are no sale.
    const near = extra => db.query(`SELECT o.id, o.refno, px.name_en FROM bkk_orders o
      JOIN bkk_products px ON px.id=o.product_id
      WHERE o.source IS NULL AND o.status='paid' AND o.amount_thb > 0 AND o.member_id=$1
        AND px.code = ANY($4::text[]) AND abs(${PAY_DAY} - $2::date) <= ${COPY_DAYS} ${extra}
      ORDER BY (o.product_id=$5 OR lower(px.name_en) = lower($6)) DESC, abs(${PAY_DAY} - $2::date),
        abs(extract(epoch FROM ${PAY_AT} - $3::timestamptz)), o.id LIMIT 1`,
      [who.member.id, when.date, at, PKG_FAMILY[pr.code] || [pr.code], pr.id, pr.name_en]).then(r => r.rows[0]);
    const sale = !!pr && st !== 'refund' && amt >= 0 && !creditBack(item || '');
    const twin = sale && amt === 0 ? await near('AND NOT EXISTS (SELECT 1 FROM bkk_orders x WHERE x.twin_of=o.id)') : null;
    const maybe = sale && amt > 0 ? await near('') : null;
    if (twin) warn(why('twinOfAybkk', String(twin.refno)));
    else if (maybe) warn(why('maybeTwin', String(maybe.refno), maybe.name_en));
    let refno = newRefno();
    for (let i = 0; i < 10 && (await db.query('SELECT 1 FROM bkk_orders WHERE refno=$1', [refno])).rows.length; i++) refno = newRefno();
    const said = [methodRaw, note].filter(Boolean).join(' | ');
    await db.query(
      `INSERT INTO bkk_orders (refno,product_id,member_id,base_thb,fee_thb,vat_thb,amount_thb,status,gateway_note,
         verified_at,created_at,method,item_name,source,source_ref,twin_of,via_member)
       VALUES ($1,$2,$3,$4,0,$5,$6,$7,$8,$9,$9,$10,$11,'rezerv',$12,$13,$14)`,
      [refno, pr ? pr.id : null, who.member.id, amt - vat, vat, amt, twin ? 'twin' : st === 'refund' || amt < 0 ? 'refund' : 'paid',
       twin ? [`entered in Rezerv for check-in; paid on aybkk.net ref ${twin.refno}`, said].filter(Boolean).join(' | ')
         : said || 'moved from Rezerv', at, payMethod(methodRaw), item, ref, twin ? twin.id : null, who.refId]);
    return { result: 'added' };
  }

  // Rezerv's pass states, and the "Cancel" column's yes. Order matters:
  // "Inactive" says "active" too.
  const PASS_WORDS = [
    [/inactive|invalid|cancel|void|refund|suspend|terminat|deactiv|ยกเลิก|ระงับ/i, 'off'],
    [/froz|freez|pause|on\s*hold|พัก/i, 'frozen'],
    [/expir|ended|finish|used\s*up|หมดอายุ|หมดแล้ว/i, 'ended'],
    [/active|start|current|valid|ใช้งาน|เริ่ม/i, 'on'],
  ];
  function passState(v) {
    const s = String(v ?? '').trim();
    if (!s) return null;
    const hit = PASS_WORDS.find(([re]) => re.test(s));
    return hit ? hit[1] : undefined;
  }

  // The paste importer's fields plus memberRezervId, start, Rezerv's pass id
  // (rezervId), and Rezerv's status, cancel and freeze columns.
  async function importPass(db, row, ctx, warn) {
    row = { ...row, name: String(row.name || '').replace(/\s*\((renewed|staff)\)\s*/gi, ' ') };
    const planRaw = clean(row.plan, 80);
    const plan = IMPORT_PLANS.find(([re]) => re.test(planRaw));
    if (!plan) return { skip: why('badPlan', planRaw) };
    const stRaw = clean(row.status, 40);
    // A word we do not know is no status, as before the Status column was read.
    let state = passState(stRaw);
    if (state === undefined) { warn(why('passStatus', stRaw)); state = null; }
    const until = parseWhen(row.until);
    if (!until) {
      // Rezerv's "--": a package never started, and Rezerv says it is over. Nothing was held.
      if ((state === 'ended' || state === 'off') && /^-*$/.test(clean(row.until, 40))) return { skip: why('neverStarted', stRaw) };
      return { skip: why('badUntil', clean(row.until, 40)) };
    }
    const sRaw = clean(row.start, 40);
    const start = sRaw && !/^-+$/.test(sRaw) ? parseWhen(sRaw) : null;
    if (sRaw && !/^-+$/.test(sRaw) && !start) return { skip: why('badStart', sRaw) };
    if (start && start.date > until.date) return { skip: why('startsAfterEnd') };
    // A year sold since 21 Oct 2026 has no free month: one that runs a year or
    // less is the 12-month package. A name that says 13 months, or a free month,
    // is what Rezerv sold, whatever its dates (a year cut short by hand).
    const code = plan[1] === 'unlim12' && start && (Date.parse(until.date) - Date.parse(start.date)) / 86400000 <= 366
      && !/13\s*months?|free\s*month/i.test(planRaw) ? 'unlim12m' : plan[1];
    const pr = await planProduct(db, code);
    if (!pr) return { skip: why('noPackage', code) };
    const total = pr.kind === 'credits' ? (pr.credits || 10) : null;
    // "3", "3/10" or "3 classes": the number at the start. Unreadable is never "all left".
    let left = null;
    const lRaw = clean(row.classesLeft, 40);
    if (total != null && lRaw) {
      const lm = lRaw.match(/^(\d+)/);
      if (!lm) return { skip: why('badLeft', lRaw) };
      left = Number(lm[1]);
      if (left > total) warn(why('leftOver', left, total));
    }

    // Cancelled, stopped, or over in Rezerv while its end date is still to
    // come: kept as history, never a pass that lets anyone in.
    const cRaw = clean(row.cancelled, 40), conRaw = clean(row.cancelledOn, 40);
    const cancelledOn = conRaw ? parseWhen(conRaw) : null;
    const cancelled = !!cancelledOn || CI_YES.test(cRaw) || /^(cancell?ed|ยกเลิกแล้ว)$/i.test(cRaw);
    const off = cancelled || state === 'off' || (state === 'ended' && until.date >= ctx.today);
    const said = cancelled ? `cancelled${cancelledOn ? ' on ' + cancelledOn.date : ''}` : stRaw;
    // A pause keeps Rezerv's own end date: Rezerv moved it out already. Paused
    // today stays paused until staff unpause it here; a pause still to come is
    // for staff to start on its day.
    const freeze = [];
    for (const k of ['frozenFrom', 'frozenUntil']) {
      const raw = clean(row[k], 40), d = raw && !/^-+$/.test(raw) ? parseWhen(raw) : null;
      if (raw && !/^-+$/.test(raw) && !d) warn(why('badFreeze', raw));
      freeze.push(d ? d.date : null);
    }
    const [fFrom, fUntil] = freeze;
    const later = fFrom && fFrom > ctx.today;
    const frozen = !off && !later && (state === 'frozen' || (fFrom && fFrom <= ctx.today && (!fUntil || fUntil >= ctx.today)));
    if (!off && later) warn(why('freezeLater', fFrom, fUntil || ''));
    const status = off ? 'void' : frozen ? 'frozen' : 'active';
    // CREDIT_NOTE marks a class credit, which the doubles list never takes for a copy.
    const note = ['moved from Rezerv', creditBack(planRaw) ? CREDIT_NOTE : null, off ? `${said} in Rezerv` : null,
      fFrom || fUntil ? `paused in Rezerv ${fFrom || '?'} to ${fUntil || '?'}` : null].filter(Boolean).join(' | ');

    const who = await importStudent(db, row, ctx, warn);
    if (who.skip) return who;
    const m = who.member;
    // As the paste importer did: an email or phone on the pass list fills a gap.
    if (!ctx.made) await fillMember(db, m, who.f, warn);
    // Rezerv's own pass id first: a pause or extra days here move the end date.
    const ref = importId(row.rezervId) || null;
    const COLS = 'id, member_id, status, source, note, source_ref, twin_of';
    let had = ref ? (await db.query(`SELECT ${COLS} FROM bkk_passes WHERE source='rezerv' AND source_ref=$1`, [ref])).rows[0] : null;
    if (had && had.member_id !== m.id) return { skip: why('idReused', ref, 'pass') };
    // No pass id, or a pass that came over without one: the same package and
    // end date, or Rezerv's own start date. Two pass ids are two passes.
    if (!had) had = (await db.query(`SELECT ${COLS} FROM bkk_passes WHERE member_id=$1 AND product_id=$2
        AND ($4::text IS NULL OR source_ref IS NULL)
        AND (valid_until=$3 OR ($4::text IS NOT NULL AND source='rezerv' AND valid_from=$5::date))
      ORDER BY valid_until=$3 DESC, id LIMIT 1`, [m.id, pr.id, until.date, ref, start ? start.date : null])).rows[0];
    const from = start ? start.date
      : new Date(Date.parse(until.date + 'T00:00:00Z') - (pr.valid_days - 1) * 86400e3).toISOString().slice(0, 10);
    const used = left != null ? Math.max(0, total - left) : 0;
    const pause = [later ? null : fFrom, later ? null : fUntil];
    const copy = { used, total, from, until: until.date, started: from <= ctx.today, status, paused: frozen ? fFrom || '-' : '', today: ctx.today };
    if (had) {
      const tag = had.source === 'rezerv' ? had.source_ref || ref : null;
      if (tag !== had.source_ref) await db.query('UPDATE bkk_passes SET source_ref=$2 WHERE id=$1', [had.id, tag]);
      // A twin stays void as the copy of the pass kept. What Rezerv says of it
      // now is what it comes back as if that pair is taken apart.
      if (had.source === 'rezerv' && had.status === 'void' && had.twin_of) {
        const ch = await db.query(`UPDATE bkk_passes SET twin_undo = coalesce(twin_undo, '{}'::jsonb) || jsonb_build_object('status', $2::text),
            frozen_from=$3, frozen_until=$4,
            note = CASE WHEN $2 = 'void' AND coalesce(twin_undo->>'status', '') <> 'void' THEN note || ' | ' || $5 ELSE note END
          WHERE id=$1 AND (coalesce(twin_undo->>'status', 'active') <> $2
            OR frozen_from IS DISTINCT FROM $3::date OR frozen_until IS DISTINCT FROM $4::date) RETURNING id`,
          [had.id, status, ...pause, `${said} in Rezerv`]);
        return { result: ch.rows.length ? 'updated' : 'matched' };
      }
      // Rezerv lists some passes twice, one copy "Inactive": the copy still in
      // use wins, in either order. Never one staff voided here. One that is the
      // copy of a sale here stays void as its twin, as a new one would.
      if (!off && had.status === 'void' && had.source === 'rezerv' && !/voided:/.test(had.note || '')) {
        const c = await copyOf(db, m, pr, from, planRaw);
        if (c.skip) return c;
        if (c.twin) {
          const undo = await carryOnto(db, c.twin, copy, warn);
          await db.query(`UPDATE bkk_passes SET twin_of=$2, twin_undo=$3, credits_used=$4, frozen_from=$5, frozen_until=$6, note=$7 WHERE id=$1`,
            [had.id, c.twin.id, undo, used, ...pause, `voided: same sale as aybkk.net ref ${c.twin.refno} | ${note}`]);
          return { result: 'updated' };
        }
        await db.query('UPDATE bkk_passes SET status=$2, frozen_from=$3, frozen_until=$4, note=$5 WHERE id=$1',
          [had.id, status, ...pause, note]);
        return { result: 'updated' };
      }
      return { result: 'matched' };
    }
    if (off && until.date >= ctx.today) warn(why('passOff', said));
    const c = off ? {} : await copyOf(db, m, pr, from, planRaw);
    if (c.skip) return c;
    const twin = c.twin || null;
    const undo = twin ? await carryOnto(db, twin, copy, warn) : null;
    await db.query(`INSERT INTO bkk_passes
        (member_id,product_id,order_id,kind,credits_total,credits_used,daily_cap,valid_days,valid_from,valid_until,note,source,
         status,frozen_from,frozen_until,source_ref,twin_of,via_member,twin_undo)
      VALUES ($1,$2,NULL,$3,$4,$5,$6,$7,$8,$9,$10,'rezerv',$11,$12,$13,$14,$15,$16,$17)`,
      [m.id, pr.id, pr.kind, total, used,
       pr.daily_cap, pr.valid_days, from, until.date,
       twin ? `voided: same sale as aybkk.net ref ${twin.refno} | ${note}` : note, twin ? 'void' : status,
       ...pause, ref, twin ? twin.id : null, who.refId, undo]);
    return { result: 'added' };
  }

  // Staff copied aybkk.net sales into Rezerv to check students in (Nov 2026),
  // and each copy came back here as a second pass: one sale, one pass. The copy:
  // a pass here of the same package family from a sale paid within 5 days of
  // this one's start, or starting within 5 days of it, and no Rezerv payment
  // above ฿0 for that family in those days (payments import before passes, so
  // a pass Rezerv was paid for is known here). A class credit Rezerv gives back
  // (a cancelled class) is no sale: never a copy. The nearest live pass here not
  // paired yet, the same package first, stays (twin), and the Rezerv one is kept
  // void as its twin, one to one; "voided:" keeps a later import from bringing
  // it back. With each such pass paired already, or none live, the copy is not
  // kept (skip). A new pass holds no booking (a Rezerv visit never takes a
  // pass), so nothing is left without one.
  async function copyOf(db, m, pr, from, planRaw) {
    if (creditBack(planRaw)) return {};
    const hits = (await db.query(`SELECT p.id, p.valid_from, o.refno, to_char(${PAY_DAY},'YYYY-MM-DD') AS d,
        p.status IN ('active','frozen') AND NOT EXISTS (SELECT 1 FROM bkk_passes x WHERE x.twin_of=p.id) AS free,
        (p.product_id=$4 OR lower(px.name_en) = lower($5)) AS same
      FROM bkk_passes p JOIN bkk_orders o ON o.id=p.order_id JOIN bkk_products px ON px.id=p.product_id
      WHERE p.member_id=$1 AND px.code = ANY($2::text[]) AND o.status='paid' AND o.source IS DISTINCT FROM 'rezerv'
        AND (abs(${PAY_DAY} - $3::date) <= ${COPY_DAYS} OR abs(p.valid_from - $3::date) <= ${COPY_DAYS})
        AND NOT EXISTS (SELECT 1 FROM bkk_orders r JOIN bkk_products rx ON rx.id=r.product_id
          WHERE r.member_id=$1 AND rx.code = ANY($2::text[]) AND r.source='rezerv' AND r.status='paid' AND r.amount_thb > 0
            AND abs(${payDay('r')} - $3::date) <= ${COPY_DAYS})
      ORDER BY 5 DESC, 6 DESC, LEAST(abs(${PAY_DAY} - $3::date), abs(p.valid_from - $3::date)), p.id`,
      [m.id, PKG_FAMILY[pr.code] || [pr.code], from, pr.id, pr.name_en])).rows;
    if (hits.length && !hits[0].free) return { skip: why('copyOfSale', pr.name_en, hits[0].d) };
    return { twin: hits[0] || null };
  }

  // What the student used in Rezerv goes onto the pass they keep: the classes,
  // and for one not started here, the start day of one started in Rezerv. It
  // then ends as Rezerv says for the same package; a package of the family with
  // another length (8 classes in 1 or 2 months, a 12- or 13-month year) runs its
  // own days from that start, as its first class would make it. Warns, and
  // gives what an undo that takes the pair apart puts back (twin_undo).
  async function carryOnto(db, twin, { used, total, from, until, started, status, paused, today }, warn) {
    const k = (await db.query(`SELECT credits_used, to_char(valid_from,'YYYY-MM-DD') AS f, to_char(valid_until,'YYYY-MM-DD') AS u
      FROM bkk_passes WHERE id=$1 FOR UPDATE`, [twin.id])).rows[0];
    const dated = !k.f && started;
    const now = (await db.query(`UPDATE bkk_passes SET credits_used = LEAST(coalesce(credits_total, $2), GREATEST(credits_used, $2)),
        valid_from = CASE WHEN $3::boolean THEN $4::date ELSE valid_from END,
        valid_until = CASE WHEN NOT $3::boolean THEN valid_until WHEN $6::boolean THEN $5::date ELSE $4::date + valid_days END
      WHERE id=$1 RETURNING credits_used, to_char(valid_until,'YYYY-MM-DD') AS u`, [twin.id, used, dated, from, until, twin.same])).rows[0];
    warn(why('twinPass', String(twin.refno), used, total || '', dated ? from : '', dated ? now.u : '', paused));
    // on / at: the day and moment Rezerv's count came over, for the class moves (onto-pass).
    return { used: now.credits_used - k.credits_used, status, on: today, at: new Date().toISOString(),
      ...(dated ? { from, until: now.u, untilWas: k.u } : {}) };
  }

  const IMPORTERS = { members: importMemberRow, visits: importVisit, payments: importPayment, passes: importPass };

  app.post('/api/bkk/admin/import/:kind', async (req, res) => {
    if (adminOnly(req, res)) return;
    const kind = req.params.kind;
    if (!IMPORTERS[kind]) return res.status(404).json({ error: 'kind must be members, visits, payments or passes' });
    const b = req.body || {};
    if (!Array.isArray(b.rows)) return res.status(400).json({ error: 'rows must be a list' });
    if (b.rows.length > IMPORT_MAX_ROWS) return res.status(400).json({ error: `at most ${IMPORT_MAX_ROWS} rows per call: send them in batches` });
    // Writing takes an explicit dryRun:false; anything else only looks.
    const dryRun = b.dryRun !== false;
    const firstRow = Number.isInteger(b.firstRow) && b.firstRow > 0 ? b.firstRow : 1;
    const out = { kind, dryRun, total: b.rows.length, added: 0, matched: 0, updated: 0, newMembers: 0, skipped: [], warnings: [] };
    const ctx = { today: bkkToday(), now: bkkNow(), seen: new Set(), pastBooked: 0, pastBookedAttended: b.pastBookedAttended === true };
    // A reason or note as the page gets it: the English text, plus its code and values to say it in Thai.
    const said = (x, key) => typeof x === 'string' ? { [key]: x } : { [key]: x.text, code: x.code, vals: x.vals };
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // One import at a time: two at once could each make the same new student.
      await client.query(`SELECT pg_advisory_xact_lock(hashtext('bkk_import'))`);
      ctx.slots = (await client.query('SELECT * FROM bkk_class_slots ORDER BY id')).rows;
      for (let i = 0; i < b.rows.length; i++) {
        const row = firstRow + i;
        const notes = [];
        ctx.made = null; ctx.rowPastBooked = false;
        await client.query('SAVEPOINT import_row');
        let r;
        try {
          const data = b.rows[i] && typeof b.rows[i] === 'object' ? b.rows[i] : {};
          r = await IMPORTERS[kind](client, data, ctx, message => notes.push({ row, ...said(message, 'message') }));
        } catch (e) {
          r = { skip: e.code === '23505' ? why('duplicate') : e.message };
        }
        // A skipped row leaves nothing behind, not even a new student.
        if (r.skip) {
          await client.query('ROLLBACK TO SAVEPOINT import_row');
          out.skipped.push({ row, ...said(r.skip, 'reason') });
          continue;
        }
        await client.query('RELEASE SAVEPOINT import_row');
        out[r.result]++;
        if (ctx.rowPastBooked) ctx.pastBooked++;
        if (ctx.made) { out.newMembers++; out.warnings.push({ row, ...said(why('newStudent', ctx.made), 'message') }); }
        out.warnings.push(...notes);
      }
      if (ctx.pastBooked) out.warnings.push({ row: null, ...said(why('pastBooked', ctx.pastBooked), 'message') });
      await client.query(dryRun ? 'ROLLBACK' : 'COMMIT');
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      return res.status(500).json({ error: e.message });
    } finally { client.release(); }
    if (!dryRun) console.log(`✓ bkk: Rezerv ${kind} import: ${out.added} added, ${out.matched} matched, ${out.updated} updated, ${out.skipped.length} skipped`);
    res.json(out);
  });

  // ── admin sees everything ─────────────────────────────────────────────────
  // node-postgres reads a DATE as local midnight, so its local parts are the date.
  const pgDate = d => d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` : null;
  const visitStatusOut = v => v.status === 'booked' && v.checked_in_at ? 'attended' : v.status;
  const passOut = p => ({
    id: p.id, name: p.name_en, nameTh: p.name_th, kind: p.kind, status: p.status,
    source: p.source || (p.order_id ? 'order' : 'manual'), note: p.note,
    creditsTotal: p.credits_total, creditsUsed: p.credits_used,
    creditsLeft: p.kind === 'unlimited' ? null : (p.credits_total || 0) - (p.credits_used || 0),
    dailyCap: p.daily_cap, validFrom: p.from_d, validUntil: p.until_d,
    frozenFrom: p.frozen_from_d, frozenUntil: p.frozen_until_d, createdAt: p.created_at,
  });
  const PASS_DATES = `to_char(p.valid_from,'YYYY-MM-DD') AS from_d, to_char(p.valid_until,'YYYY-MM-DD') AS until_d,
    to_char(p.frozen_from,'YYYY-MM-DD') AS frozen_from_d, to_char(p.frozen_until,'YYYY-MM-DD') AS frozen_until_d`;

  // The profile's membership block: each pass they can use now or soon (not
  // ended, a class left, active or paused) with how they came on it. Built from
  // the history route's own pass and visit rows; every day is a Bangkok date as text.
  function membershipOut(passes, visits, today) {
    const gap = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
    const plus = (d, n) => new Date(Date.parse(d) + n * 86400000).toISOString().slice(0, 10);
    const now = bkkNow();
    const live = passes.filter(p => (p.status === 'active' || p.status === 'frozen')
      && !(p.until_d && p.until_d < today) && (p.kind === 'unlimited' || p.credits_used < p.credits_total));
    // Staff fix a wrong pass by voiding it and giving the right one: its visits stay on the void pass.
    const voided = new Set(passes.filter(p => p.status === 'void').map(p => p.id));
    // Nobody checks in at home: an online class that is over counts as came.
    const came = visits.filter(v => v.date <= today && (visitStatusOut(v) === 'attended'
      || (v.status === 'booked' && v.is_online && now - new Date(v.start_at) > (v.duration_min || 120) * 60000)));
    const rows = live.map(p => {
      const state = p.status === 'frozen' ? 'frozen' : p.from_d && p.from_d > today ? 'starts'
        : !p.from_d && !p.until_d ? 'firstClass' : 'active';
      const started = !!p.from_d && p.from_d <= today;
      // A seat paid by this pass is its day, whatever the date. One with no pass
      // on it (Rezerv), or on a void pass, counts by its date; one paid by another pass does not.
      const mine = started ? came.filter(v => v.pass_id === p.id
        || ((v.pass_id == null || voided.has(v.pass_id)) && v.date >= p.from_d)) : [];
      const days = [...new Set(mine.map(v => v.date))].sort();
      const checkedIn = new Set(mine.filter(v => v.checked_in_at).map(v => v.date));
      const last28 = days.filter(d => d > plus(today, -28)).length;
      // A pause is [frozen_from, frozen_until); one still running has no end yet.
      let paused = 0, pausedLately = false;
      if (started && p.frozen_from_d) {
        const a = p.frozen_from_d > p.from_d ? p.frozen_from_d : p.from_d;
        const b = p.frozen_until_d && p.frozen_until_d <= today ? p.frozen_until_d : plus(today, 1);
        paused = Math.max(0, gap(a, b));
        pausedLately = paused > 0 && b > plus(today, -27);
      }
      // Only the latest pause keeps its dates. A pass paused with no dates on file (moved
      // from Rezerv), or paused more than once (each pause leaves "frozen Nd: " or "paused
      // in Rezerv " in the note), has paused days nobody can count: no weekly number, no tag.
      const pauseKnown = !(p.status === 'frozen' && !p.frozen_from_d)
        && ((p.note || '').match(/frozen \d+d: |paused in Rezerv /g) || []).length < 2;
      const ran = started ? gap(p.from_d, today) + 1 - paused : 0;
      // A class is taken from a pack when it is booked: seats still to come are booked, not used.
      const booked = p.kind === 'unlimited' ? null : Math.min(p.credits_used || 0, visits.filter(v => v.pass_id === p.id
        && v.status === 'booked' && !v.checked_in_at && new Date(v.start_at) > now).length);
      const o = passOut(p);
      return [state === 'frozen' ? 1 : state === 'starts' ? 2 : 0,
        state === 'frozen' ? p.frozen_until_d || '9' : p.from_d || '9', {
          passId: p.id, name: o.name, nameTh: o.nameTh, kind: o.kind, source: o.source, state, started,
          validFrom: o.validFrom, validUntil: o.validUntil, frozenUntil: o.frozenUntil,
          daysLeft: p.until_d ? gap(today, p.until_d) + 1 : null,
          creditsTotal: o.creditsTotal, creditsUsed: o.creditsUsed, creditsLeft: o.creditsLeft,
          creditsBooked: booked, creditsDone: booked == null ? null : (p.credits_used || 0) - booked,
          cameDays: days.length, cameLast28: last28, cameOnline: days.filter(d => !checkedIn.has(d)).length,
          // Whole numbers first: 9 days in 36 and 6 in 24 are the same 1.75, and must round the same way.
          perWeek: ran >= 7 && pauseKnown ? Math.round(days.length * 14 / ran) / 2 : null,
          lastCame: days.length ? days[days.length - 1] : null,
          // For staff only: a membership (not a class pack, whose classes are
          // counted, not its days) over a month long that ends within 14 days
          // with nothing after it, and under 8 days came in the last 28. Never
          // when those 28 days were not all on the pass: it began or was paused inside them.
          endsSoonCameLittle: state === 'active' && p.kind === 'unlimited' && p.valid_days > 31
            && !!p.until_d && p.until_d <= plus(today, 14) && last28 < 8
            && started && p.from_d <= plus(today, -27) && pauseKnown && !pausedLately
            && !live.some(x => x.id !== p.id && (!x.until_d || x.until_d > p.until_d)),
        }];
    });
    return rows.sort((a, b) => a[0] - b[0] || a[1].localeCompare(b[1]) || a[2].passId - b[2].passId).map(r => r[2]);
  }

  // One student, all of it: every visit, payment, pass and note, newest first.
  // A guardian signed the paper agreement at the desk for a student under 20: staff record the
  // guardian's name and the day on the paper ('desk'). Staff never sign for the student.
  app.post('/api/bkk/admin/members/:code/guardian', async (req, res) => {
    if (adminOnly(req, res)) return;
    try {
      const m = await memberByCode(req.params.code);
      if (!m) return res.status(404).json({ error: 'member not found' });
      if (await consentMode() === 'off') return res.status(409).json({ error: 'the agreement is not on' });
      const name = String((req.body || {}).name || '').replace(/\s+/g, ' ').trim();
      const date = String((req.body || {}).date || '').trim();
      if (name.length < 2 || name.length > 120 || /[<>]/.test(name)) return res.status(400).json({ error: "the guardian's name, 2 to 120 letters" });
      if (!realYmd(date) || date > bkkToday() || date < '2026-01-01') return res.status(400).json({ error: 'date: the day on the paper, YYYY-MM-DD, not in the future' });
      await insertConsent(pool, { memberId: m.id, kind: 'guardian', guardianName: name, signedOn: date, via: 'desk' });
      res.json({ success: true, consent: await consentOf(pool, m) });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.get('/api/bkk/admin/members/:code/history', async (req, res) => {
    if (adminOnly(req, res)) return;
    try {
      const m = await memberByCode(req.params.code);
      if (!m) return res.status(404).json({ error: 'member not found' });
      const [visits, pays, passes, notes, photos, checks, active] = await Promise.all([
        q(`SELECT b.id, to_char(b.class_date,'YYYY-MM-DD') AS date, ${VISIT_TIME} AS time,
             coalesce(s.title, b.class_title) AS class, b.status, b.checked_in_at, b.cancelled_at, b.cancel_reason,
             b.cover, b.source, b.slot_id, b.start_at, b.pass_id, b.moved_at, s.is_online, s.duration_min
           FROM bkk_bookings b LEFT JOIN bkk_class_slots s ON s.id=b.slot_id
           WHERE b.member_id=$1 ORDER BY b.class_date DESC, b.start_at DESC, b.id DESC`, [m.id]),
        q(`SELECT o.id, to_char(${PAY_AT} AT TIME ZONE 'Asia/Bangkok','YYYY-MM-DD') AS date,
             to_char(${PAY_AT} AT TIME ZONE 'Asia/Bangkok','HH24:MI') AS time, coalesce(pr.name_en, o.item_name) AS item,
             o.amount_thb, o.base_thb, o.fee_thb, o.vat_thb, o.method, o.status, o.source, o.refno, o.gateway_note
           FROM bkk_orders o LEFT JOIN bkk_products pr ON pr.id=o.product_id
           WHERE o.member_id=$1 ORDER BY ${PAY_AT} DESC, o.id DESC`, [m.id]),
        q(`SELECT p.*, pr.name_en, pr.name_th, ${PASS_DATES} FROM bkk_passes p LEFT JOIN bkk_products pr ON pr.id=p.product_id
           WHERE p.member_id=$1 ORDER BY coalesce(p.valid_from, (p.created_at AT TIME ZONE 'Asia/Bangkok')::date) DESC, p.id DESC`, [m.id]),
        q(`SELECT n.id, to_char(n.class_date,'YYYY-MM-DD') AS date, n.created_at, n.body, n.to_work_on,
             n.share_with_student, t.name AS teacher
           FROM bkk_notes n LEFT JOIN bkk_teachers t ON t.id=n.teacher_id
           WHERE n.member_id=$1 ORDER BY n.created_at DESC`, [m.id]),
        q('SELECT count(*)::int AS n FROM bkk_photo_members WHERE member_id=$1', [m.id]),
        q(`SELECT to_char(taken_on,'YYYY-MM-DD') AS date, resting_hr, sleep_hours, feel, note
           FROM bkk_checks WHERE member_id=$1 ORDER BY taken_on DESC`, [m.id]),
        activePass(m.id),
      ]);
      const today = bkkToday();
      const daysAgo = n => ymd(new Date(Date.parse(`${today}T12:00:00${TZ_OFFSET}`) - n * 86400000));
      const came = visits.rows.filter(v => visitStatusOut(v) === 'attended');
      const money = pays.rows.filter(o => o.status === 'paid' || o.status === 'refund');
      const now = bkkNow();
      const upcoming = v => new Date(v.start_at) > now && v.status === 'booked';
      // Still a booking after its start: a class that is running while they are not in yet,
      // and a Rezerv seat today with no time on file (stored at 00:00), for the whole day.
      const running = v => v.status === 'booked' && !v.checked_in_at && !upcoming(v)
        && (v.time == null ? v.date === today : now - new Date(v.start_at) < (v.duration_min || 120) * 60000);
      const next = visits.rows.filter(v => upcoming(v) || running(v)).reverse();
      const cmode = await consentMode();
      res.json({
        ...(cmode === 'off' ? {} : { consent: { mode: cmode, ...(await consentOf(pool, m)) } }),
        member: { code: m.code, name: m.name, email: m.email, phone: m.phone, joinedOn: pgDate(m.joined_on),
          source: m.source, rezervId: m.rezerv_id, createdAt: m.created_at },
        summary: {
          visits: came.length,
          visitsLast30: came.filter(v => v.date > daysAgo(30)).length,
          visitsLast90: came.filter(v => v.date > daysAgo(90)).length,
          firstVisit: came.length ? came[came.length - 1].date : null,
          lastVisit: came.length ? came[0].date : null,
          noShows: visits.rows.filter(v => v.status === 'noshow' || (v.status === 'booked' && !v.checked_in_at && v.date < today)).length,
          cancellations: visits.rows.filter(v => v.status === 'cancelled').length,
          totalPaid: money.reduce((s, o) => s + o.amount_thb, 0),
          // A ฿0 line (a Rezerv bonus or a pass entered for check-in) is not a payment.
          payments: money.filter(o => o.status === 'paid' && o.amount_thb > 0).length,
          activePass: active ? { name: active.name_en, kind: active.kind,
            until: pgDate(active.valid_until),
            creditsLeft: active.kind === 'unlimited' ? null : active.credits_total - active.credits_used } : null,
        },
        membership: membershipOut(passes.rows, visits.rows, today),
        nextBookings: next.slice(0, 5).map(v => ({ date: v.date, time: v.time, class: v.class, cover: v.cover,
          onNow: v.time != null && running(v) })),
        nextBookingsMore: Math.max(0, next.length - 5),
        passes: passes.rows.map(passOut),
        visits: visits.rows.map(v => ({ id: v.id, date: v.date, time: v.time, class: v.class, status: visitStatusOut(v),
          checkedInAt: v.checked_in_at, cancelledAt: v.cancelled_at, cancelReason: v.cancel_reason,
          cover: v.cover, source: v.source, upcoming: upcoming(v), passId: v.pass_id,
          moved: !!v.moved_at && !!v.pass_id && (v.status === 'booked'
            || (v.status === 'cancelled' && !/^merged:/.test(v.cancel_reason || ''))) })),
        payments: pays.rows.map(o => ({ id: o.id, date: o.date, time: o.time, item: o.item, amount: o.amount_thb,
          base: o.base_thb, fee: o.fee_thb, vat: o.vat_thb, method: o.method, status: o.status,
          source: o.source || 'aybkk', refno: String(o.refno), note: o.gateway_note })),
        notes: notes.rows.map(n => ({ id: n.id, date: n.date, createdAt: n.created_at, teacher: n.teacher,
          body: n.body, toWorkOn: n.to_work_on, shared: n.share_with_student })),
        photos: photos.rows[0].n,
        checks: checks.rows.map(c => ({ date: c.date, restingHr: c.resting_hr,
          sleepHours: c.sleep_hours == null ? null : Number(c.sleep_hours), feel: c.feel, note: c.note })),
      });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ?from=&to= as Bangkok dates, both ends included.
  function dayRange(qs, { required = false, maxDays = null } = {}) {
    const { from, to } = qs;
    if (!from && !to) return required ? { error: 'from and to (YYYY-MM-DD) required' } : { from: null, to: null };
    if (!realYmd(from) || !realYmd(to)) return { error: 'from and to must both be dates (YYYY-MM-DD)' };
    if (from > to) return { error: 'from is after to' };
    if (maxDays && (Date.parse(to) - Date.parse(from)) / 86400000 + 1 > maxDays) return { error: `at most ${maxDays} days at a time` };
    return { from, to };
  }

  // The shala over a stretch of days: who came, what came in, who to call.
  app.get('/api/bkk/admin/report', async (req, res) => {
    if (adminOnly(req, res)) return;
    const r = dayRange(req.query, { required: true, maxDays: 400 });
    if (r.error) return res.status(400).json({ error: r.error });
    const { from, to } = r;
    const today = bkkToday();
    try {
      const all = async (sql, args = [from, to]) => (await q(sql, args)).rows;
      const inRange = `b.class_date BETWEEN $1::date AND $2::date`;
      const paid = `o.status IN ('paid','refund') AND ${PAY_DAY} BETWEEN $1::date AND $2::date`;
      // Counts are payments, money is money: a ฿0 line from Rezerv (a bonus, or a
      // pass entered for check-in) adds no payment and no sale (15 Nov 2026).
      const nPay = `count(*) FILTER (WHERE o.amount_thb > 0)::int`;
      // A refund is money going back, not a payment: counted on its own.
      const nBack = `count(*) FILTER (WHERE o.amount_thb < 0)::int`;
      const manual = `o.status='paid' AND o.gateway_note LIKE 'MANUAL ACTIVATION%'`;
      // A group of ฿0 lines only (no payment, no money) is no line in a table.
      const noZero = `(count(*) FILTER (WHERE o.amount_thb <> 0) > 0)`;
      const [v, first, vDay, vClass, vSource, mTot, mDay, mMethod, mItem, mSource, sold, expiring, notSeen] = await Promise.all([
        all(`SELECT count(*) FILTER (WHERE ${ATTENDED})::int AS total,
               count(*) FILTER (WHERE b.status='booked')::int AS booked,
               count(*) FILTER (WHERE ${NOSHOW})::int AS no_shows,
               count(*) FILTER (WHERE b.status='cancelled')::int AS cancelled,
               count(DISTINCT b.member_id) FILTER (WHERE ${ATTENDED})::int AS students
             FROM bkk_bookings b WHERE ${inRange}`),
        all(`SELECT count(*)::int AS n FROM (SELECT min(b.class_date) AS first FROM bkk_bookings b
               WHERE ${ATTENDED} GROUP BY b.member_id) f WHERE f.first BETWEEN $1::date AND $2::date`),
        all(`SELECT to_char(b.class_date,'YYYY-MM-DD') AS date, count(*) FILTER (WHERE b.checked_in_at IS NOT NULL)::int AS attended,
               count(*)::int AS booked
             FROM bkk_bookings b WHERE b.status='booked' AND ${inRange} GROUP BY b.class_date ORDER BY b.class_date`),
        all(`SELECT coalesce(s.title, b.class_title, 'Class') AS title, ${VISIT_TIME} AS time,
               count(*) FILTER (WHERE b.checked_in_at IS NOT NULL)::int AS attended,
               count(DISTINCT b.class_date) FILTER (WHERE b.checked_in_at IS NOT NULL)::int AS classes
             FROM bkk_bookings b LEFT JOIN bkk_class_slots s ON s.id=b.slot_id
             WHERE b.status='booked' AND ${inRange} GROUP BY 1,2 ORDER BY 2 NULLS LAST, 1`),
        all(`SELECT coalesce(b.source,'aybkk') AS source, count(*)::int AS n FROM bkk_bookings b
             WHERE ${ATTENDED} AND ${inRange} GROUP BY 1 ORDER BY n DESC, 1`),
        all(`SELECT coalesce(sum(o.amount_thb),0)::int AS total, coalesce(sum(o.vat_thb),0)::int AS vat, ${nPay} AS n, ${nBack} AS refunds,
               count(*) FILTER (WHERE ${manual})::int AS manual_n,
               coalesce(sum(o.amount_thb) FILTER (WHERE ${manual}),0)::int AS manual_total
             FROM bkk_orders o WHERE ${paid}`),
        all(`SELECT to_char(${PAY_DAY},'YYYY-MM-DD') AS date, sum(o.amount_thb)::int AS total
             FROM bkk_orders o WHERE ${paid} GROUP BY 1 ORDER BY 1`),
        all(`SELECT o.method, ${nPay} AS n, ${nBack} AS refunds, sum(o.amount_thb)::int AS total
             FROM bkk_orders o WHERE ${paid} GROUP BY 1 HAVING ${noZero} ORDER BY total DESC, 1`),
        // By package, not by name: the old Rezerv 6-month and the 12 Nov 2026 one share a name.
        all(`SELECT coalesce(pr.name_en, o.item_name, 'other') AS item, pr.price_thb AS price, ${nPay} AS n, ${nBack} AS refunds,
               sum(o.amount_thb)::int AS total
             FROM bkk_orders o LEFT JOIN bkk_products pr ON pr.id=o.product_id WHERE ${paid} GROUP BY pr.id, 1, 2 HAVING ${noZero}
             ORDER BY total DESC, 1`),
        all(`SELECT coalesce(o.source,'aybkk') AS source, ${nPay} AS n, ${nBack} AS refunds, sum(o.amount_thb)::int AS total
             FROM bkk_orders o WHERE ${paid} GROUP BY 1 HAVING ${noZero} ORDER BY total DESC, 1`),
        all(`SELECT count(*)::int AS n FROM bkk_orders o
             WHERE o.status='paid' AND o.amount_thb > 0 AND o.product_id IS NOT NULL AND ${PAY_DAY} BETWEEN $1::date AND $2::date`),
        // Ends within 14 days, and nothing after it to carry on with.
        all(`SELECT m.code, m.name, pr.name_en AS item, to_char(p.valid_until,'YYYY-MM-DD') AS until
             FROM bkk_passes p JOIN bkk_members m ON m.id=p.member_id LEFT JOIN bkk_products pr ON pr.id=p.product_id
             WHERE p.status='active' AND p.valid_until BETWEEN $1::date AND $1::date + 14
               AND (p.kind='unlimited' OR p.credits_used < p.credits_total)
               AND NOT EXISTS (SELECT 1 FROM bkk_passes x WHERE x.member_id=p.member_id AND x.id<>p.id
                 AND x.status IN ('active','frozen') AND (x.valid_until IS NULL OR x.valid_until > p.valid_until)
                 AND (x.kind='unlimited' OR x.credits_used < x.credits_total))
             ORDER BY p.valid_until, m.name`, [today]),
        // Holds a pass they can use, and no class in the last 14 days: the "we miss you" list.
        // A pass under 14 days old and no visit yet is a new student, not one who stopped coming.
        all(`SELECT m.code, m.name, to_char(lv.last,'YYYY-MM-DD') AS last_visit, pr.name_en AS pass,
               to_char(p.valid_until,'YYYY-MM-DD') AS until
             FROM bkk_members m
             JOIN LATERAL (SELECT * FROM bkk_passes p WHERE p.member_id=m.id AND p.status='active'
               AND (p.valid_until IS NULL OR p.valid_until >= $1::date)
               AND (p.kind='unlimited' OR p.credits_used < p.credits_total)
               ORDER BY p.valid_from NULLS LAST, p.id LIMIT 1) p ON true
             LEFT JOIN bkk_products pr ON pr.id=p.product_id
             LEFT JOIN LATERAL (SELECT max(b.class_date) AS last FROM bkk_bookings b
               WHERE b.member_id=m.id AND ${ATTENDED}) lv ON true
             WHERE (lv.last IS NULL OR lv.last <= $1::date - 14)
               AND (lv.last IS NOT NULL OR coalesce(p.valid_from, (p.created_at AT TIME ZONE 'Asia/Bangkok')::date) <= $1::date - 14)
             ORDER BY lv.last NULLS FIRST, m.name`, [today]),
      ]);
      const t = v[0], mt = mTot[0];
      res.json({
        from, to,
        visits: {
          total: t.total, booked: t.booked, noShows: t.no_shows, cancelled: t.cancelled,
          uniqueStudents: t.students, newStudents: first[0].n, byDay: vDay,
          byClass: vClass.map(c => ({ ...c, avgPerClass: c.classes ? Math.round(c.attended / c.classes * 10) / 10 : 0 })),
          bySource: vSource,
        },
        money: { total: mt.total, vat: mt.vat, count: mt.n, refunds: mt.refunds, byDay: mDay, byMethod: mMethod, byItem: mItem, bySource: mSource,
          manual: { n: mt.manual_n, total: mt.manual_total } },
        passes: { sold: sold[0].n, expiringNext14: expiring },
        notSeen: notSeen.map(n => ({ code: n.code, name: n.name, lastVisit: n.last_visit, pass: n.pass, until: n.until })),
      });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Spreadsheets of everything. UTF-8 with a BOM so Excel reads Thai; a cell
  // that starts with = + - @ would run as a formula, so it is made plain text.
  const csvCell = v => typeof v === 'number' ? String(v)
    : `"${String(v ?? '').replace(/^[=+\-@\t\r]/, "'$&").replace(/"/g, '""')}"`;
  const EXPORTS = {
    visits: {
      head: ['date', 'time', 'class', 'status', 'checked_in', 'student', 'code', 'email', 'cover', 'source', 'cancel_reason', 'rezerv_ref'],
      sql: `SELECT to_char(b.class_date,'YYYY-MM-DD') AS date, ${VISIT_TIME} AS time, coalesce(s.title, b.class_title) AS class,
              CASE WHEN ${ATTENDED} THEN 'attended' ELSE b.status END AS status,
              to_char(b.checked_in_at AT TIME ZONE 'Asia/Bangkok','YYYY-MM-DD HH24:MI') AS checked_in,
              m.name AS student, m.code, m.email, b.cover, coalesce(b.source,'aybkk') AS source, b.cancel_reason,
              CASE WHEN b.source='rezerv' THEN b.source_ref END AS rezerv_ref
            FROM bkk_bookings b JOIN bkk_members m ON m.id=b.member_id LEFT JOIN bkk_class_slots s ON s.id=b.slot_id
            WHERE ($1::date IS NULL OR b.class_date BETWEEN $1::date AND $2::date) AND ($3::int IS NULL OR b.member_id=$3)
            ORDER BY b.class_date, b.start_at, m.name, b.id`,
    },
    payments: {
      head: ['date', 'time', 'student', 'code', 'email', 'item', 'amount', 'base', 'fee', 'vat', 'method', 'status', 'source', 'refno', 'note', 'rezerv_ref', 'kind'],
      sql: `SELECT to_char(${PAY_AT} AT TIME ZONE 'Asia/Bangkok','YYYY-MM-DD') AS date,
              to_char(${PAY_AT} AT TIME ZONE 'Asia/Bangkok','HH24:MI') AS time, m.name AS student, m.code, m.email,
              coalesce(pr.name_en, o.item_name) AS item, o.amount_thb AS amount, o.base_thb AS base, o.fee_thb AS fee,
              o.vat_thb AS vat, o.method, o.status, coalesce(o.source,'aybkk') AS source, o.refno::text AS refno,
              o.gateway_note AS note, CASE WHEN o.source='rezerv' THEN o.source_ref END AS rezerv_ref, o.kind
            FROM bkk_orders o LEFT JOIN bkk_members m ON m.id=o.member_id LEFT JOIN bkk_products pr ON pr.id=o.product_id
            WHERE ($1::date IS NULL OR ${PAY_DAY} BETWEEN $1::date AND $2::date) AND ($3::int IS NULL OR o.member_id=$3)
            ORDER BY ${PAY_AT}, o.id`,
    },
    // With a range: everyone who booked, came or paid in it, or joined in it.
    members: {
      head: ['code', 'name', 'email', 'phone', 'joined_on', 'source', 'rezerv_id', 'created', 'visits', 'first_visit',
        'last_visit', 'visits_in_range', 'paid_total', 'paid_in_range', 'active_pass', 'pass_until'],
      sql: `SELECT m.code, m.name, m.email, m.phone, to_char(m.joined_on,'YYYY-MM-DD') AS joined_on,
              coalesce(m.source,'aybkk') AS source, m.rezerv_id,
              to_char(m.created_at AT TIME ZONE 'Asia/Bangkok','YYYY-MM-DD') AS created,
              v.visits, to_char(v.first,'YYYY-MM-DD') AS first_visit, to_char(v.last,'YYYY-MM-DD') AS last_visit,
              v.in_range AS visits_in_range, coalesce(pd.total,0)::int AS paid_total, coalesce(pd.in_range,0)::int AS paid_in_range,
              ap.name_en AS active_pass, to_char(ap.valid_until,'YYYY-MM-DD') AS pass_until
            FROM bkk_members m
            LEFT JOIN LATERAL (SELECT count(*)::int AS visits, min(b.class_date) AS first, max(b.class_date) AS last,
                count(*) FILTER (WHERE b.class_date BETWEEN $1::date AND $2::date)::int AS in_range
              FROM bkk_bookings b WHERE b.member_id=m.id AND ${ATTENDED}) v ON true
            LEFT JOIN LATERAL (SELECT sum(o.amount_thb) AS total,
                sum(o.amount_thb) FILTER (WHERE ${PAY_DAY} BETWEEN $1::date AND $2::date) AS in_range
              FROM bkk_orders o WHERE o.member_id=m.id AND o.status IN ('paid','refund')) pd ON true
            LEFT JOIN LATERAL (SELECT p.valid_until, pr.name_en FROM bkk_passes p JOIN bkk_products pr ON pr.id=p.product_id
              WHERE p.member_id=m.id AND p.status='active'
                AND (p.valid_until IS NULL OR p.valid_until >= (now() AT TIME ZONE 'Asia/Bangkok')::date)
                AND (p.kind='unlimited' OR p.credits_used < p.credits_total)
              ORDER BY p.valid_from NULLS LAST, p.id LIMIT 1) ap ON true
            WHERE m.merged_into IS NULL AND ($3::int IS NULL OR m.id=$3) AND ($1::date IS NULL
              OR EXISTS (SELECT 1 FROM bkk_bookings b WHERE b.member_id=m.id AND b.class_date BETWEEN $1::date AND $2::date)
              OR EXISTS (SELECT 1 FROM bkk_orders o WHERE o.member_id=m.id AND o.status IN ('paid','refund')
                AND ${PAY_DAY} BETWEEN $1::date AND $2::date)
              OR m.joined_on BETWEEN $1::date AND $2::date
              OR (m.created_at AT TIME ZONE 'Asia/Bangkok')::date BETWEEN $1::date AND $2::date)
            ORDER BY lower(m.name), m.id`,
    },
  };
  // /export/visits.csv | payments.csv | members.csv, ?from=&to= (both or
  // neither: neither is all time), ?member=CODE for one student.
  app.get('/api/bkk/admin/export/:file', async (req, res) => {
    if (adminOnly(req, res)) return;
    const what = (String(req.params.file).match(/^(visits|payments|members)\.csv$/) || [])[1];
    if (!what) return res.status(404).json({ error: 'export visits.csv, payments.csv or members.csv' });
    const r = dayRange(req.query);
    if (r.error) return res.status(400).json({ error: r.error });
    try {
      let memberId = null, code = '';
      if (req.query.member) {
        const m = (await q('SELECT id, code FROM bkk_members WHERE code=$1', [String(req.query.member)])).rows[0];
        if (!m) return res.status(404).json({ error: 'member not found' });
        memberId = m.id; code = `-${m.code}`;
      }
      const ex = EXPORTS[what];
      const rows = (await q(ex.sql, [r.from, r.to, memberId])).rows;
      const lines = [ex.head.join(',')].concat(rows.map(row => ex.head.map(h => csvCell(row[h])).join(',')));
      const span = r.from ? `-${r.from}-to-${r.to}` : '';
      res.set('Content-Type', 'text/csv; charset=utf-8')
        .set('Content-Disposition', `attachment; filename="aybkk-${what}${code}${span}.csv"`)
        .set('Cache-Control', 'no-store');
      res.send('﻿' + lines.join('\r\n') + '\r\n');
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Pause a pass — the injury case. The clock stops: the expiry moves out by the
  // frozen days, and the pass cannot book while it is paused.
  app.post('/api/bkk/admin/passes/:id/freeze', async (req, res) => {
    if (adminOnly(req, res)) return;
    try {
      const days = Math.max(1, Math.min(365, parseInt((req.body || {}).days) || 0));
      if (!days) return res.status(400).json({ error: 'days required' });
      const reason = String((req.body || {}).reason || '').slice(0, 200);
      const r = await q(
        `UPDATE bkk_passes SET status='frozen',
           frozen_from = (now() AT TIME ZONE 'Asia/Bangkok')::date,
           frozen_until = (now() AT TIME ZONE 'Asia/Bangkok')::date + $2::int,
           valid_until = CASE WHEN valid_until IS NULL THEN NULL ELSE valid_until + $2::int END,
           note = coalesce(note || ' | ', '') || $3
         WHERE id=$1 AND status='active' RETURNING *`,
        [req.params.id, days, `frozen ${days}d: ${reason || 'no reason given'}`]);
      if (!r.rows.length) return res.status(409).json({ error: 'pass not found, or not active' });
      res.json({ success: true, pass: r.rows[0] });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Unpause early — and hand back the days that were not used, so a freeze can
  // never quietly become a gift of extra time.
  app.post('/api/bkk/admin/passes/:id/unfreeze', async (req, res) => {
    if (adminOnly(req, res)) return;
    try {
      const r = await q(
        `UPDATE bkk_passes SET status='active',
           valid_until = CASE
             WHEN valid_until IS NULL OR frozen_until IS NULL THEN valid_until
             ELSE valid_until - GREATEST(0,
               frozen_until - (now() AT TIME ZONE 'Asia/Bangkok')::date) END,
           frozen_until = (now() AT TIME ZONE 'Asia/Bangkok')::date
         WHERE id=$1 AND status='frozen' RETURNING *`, [req.params.id]);
      if (!r.rows.length) return res.status(409).json({ error: 'pass not found, or not frozen' });
      res.json({ success: true, pass: r.rows[0] });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Write off a pass. Nothing ever wrote bkk_passes.status before this, so a bad
  // import or a refunded sale could only be undone by hand in the database.
  app.post('/api/bkk/admin/passes/:id/void', async (req, res) => {
    if (adminOnly(req, res)) return;
    try {
      const reason = String((req.body || {}).reason || '').slice(0, 200);
      const r = await q(
        `UPDATE bkk_passes SET status='void',
           note = coalesce(note || ' | ', '') || $2
         WHERE id=$1 AND status <> 'void' RETURNING *`,
        [req.params.id, `voided: ${reason || 'no reason given'}`]);
      if (!r.rows.length) return res.status(409).json({ error: 'pass not found, or already void' });
      // The Rezerv copy of this pass, kept void by the import, is the sale's pass again.
      const back = await twinPassBack(pool, [r.rows[0].id], `aybkk.net pass ${r.rows[0].id} was made void on ${bkkToday()}`);
      res.json({ success: true, pass: r.rows[0], rezervPassBack: back });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Goodwill: extra days, extra credits, or both.
  app.post('/api/bkk/admin/passes/:id/extend', async (req, res) => {
    if (adminOnly(req, res)) return;
    try {
      const days = Math.max(0, Math.min(730, parseInt((req.body || {}).days) || 0));
      const credits = Math.max(0, Math.min(100, parseInt((req.body || {}).credits) || 0));
      if (!days && !credits) return res.status(400).json({ error: 'days or credits required' });
      const r = await q(
        `UPDATE bkk_passes SET
           valid_until = CASE WHEN valid_until IS NULL THEN NULL ELSE valid_until + $2::int END,
           credits_total = CASE WHEN credits_total IS NULL THEN NULL ELSE credits_total + $3::int END,
           note = coalesce(note || ' | ', '') || $4
         WHERE id=$1 RETURNING *`,
        [req.params.id, days, credits,
         `extended +${days}d +${credits}cr: ${String((req.body || {}).reason || '').slice(0, 120)}`]);
      if (!r.rows.length) return res.status(404).json({ error: 'pass not found' });
      res.json({ success: true, pass: r.rows[0] });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // A class they came to on a Rezerv booking while they held an aybkk.net pass
  // (16 Nov 2026): nothing here paid for it, so staff move it onto the pass and
  // it takes a class, as a booking here would have.
  // - Only a pass whose days had begun and ran that day, not paused. A pass's
  //   days are never changed here: one not begun by then is refused, and says so.
  // - Never a pass moved from Rezerv: Rezerv counted its own classes.
  // - Rezerv may have paid already: a Rezerv package of theirs ran that day, or a
  //   Rezerv copy of one of their passes here, running that day, brought its
  //   used classes over (carryOnto) on or after the class day. That takes
  //   sure:true, once a person has checked. So does a class of theirs already on
  //   a pass that day at the same time, or with no time on either (Rezerv sends
  //   some classes with no time, and the import then cannot see the seat here).
  // dryRun shows the pass, what is left and any checks, and keeps nothing. undo
  // puts a moved class back on Rezerv and gives the class back; when a Rezerv
  // copy paired since may have counted it (moveAbsorbed), only with sure:true.
  // A class staff took from a pass, and after that a Rezerv copy of that pass
  // that had counted classes was paired (carryOnto, at twin_undo.at): its
  // GREATEST may have taken this class in. Giving it back then (undo, a staff
  // cancel, a merge) could give a class away, so it stays used. Call it with
  // the pass locked, so an import pairing it right now is seen.
  async function moveAbsorbed(db, bookingId) {
    return (await db.query(`SELECT x.credits_used AS n, to_char(${CARRIED_ON('x')},'YYYY-MM-DD') AS on
      FROM bkk_bookings bk JOIN bkk_passes x ON x.twin_of=bk.pass_id
      WHERE bk.id=$1 AND bk.moved_at IS NOT NULL AND x.source='rezerv' AND x.credits_used > 0
        AND (x.twin_undo->>'at')::timestamptz >= bk.moved_at AND bk.class_date <= ${CARRIED_ON('x')}
      ORDER BY x.id LIMIT 1`, [bookingId])).rows[0] || null;
  }

  app.post('/api/bkk/admin/bookings/:id/onto-pass', async (req, res) => {
    if (adminOnly(req, res)) return;
    if (!/^\d{1,9}$/.test(req.params.id)) return res.status(404).json({ error: 'booking not found' });
    const { passId = null, dryRun = false, undo = false, sure = false } = req.body || {};
    if (passId != null && !/^\d{1,9}$/.test(String(passId))) return res.status(400).json({ error: 'passId must be a pass id' });
    const why = String((req.body || {}).reason || '').replace(/[\u0000-\u001f\u007f|]/g, ' ').trim().slice(0, 120);
    const fail = (status, error, extra) => { throw Object.assign(new Error(error), { status, extra }); };
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const b = (await client.query(`SELECT b.*, to_char(b.class_date,'YYYY-MM-DD') AS d, ${VISIT_TIME} AS t
        FROM bkk_bookings b WHERE b.id=$1 FOR UPDATE`, [Number(req.params.id)])).rows[0];
      if (!b) fail(404, 'booking not found');
      const what = `class ${[b.d, b.t].filter(Boolean).join(' ')}`;
      let pass;
      const out = {};
      const note = text => client.query(`UPDATE bkk_passes SET note = coalesce(note || ' | ', '') || $2 WHERE id=$1`,
        [pass.id, why ? `${text}: ${why}` : text]);
      if (undo) {
        // A cancelled one still on the pass was kept used for a Rezerv copy: undo is
        // how a person gives it back, so the booking says so and nothing gives it twice.
        if (!b.moved_at || !b.pass_id) fail(409, 'this class was not moved onto a pass here');
        if (b.status !== 'booked' && b.status !== 'cancelled') fail(409, 'already ' + b.status);
        if (/^merged:/.test(b.cancel_reason || '')) fail(409, 'a merge cancelled this seat: undoing the merge brings it back');
        pass = (await client.query('SELECT * FROM bkk_passes WHERE id=$1 FOR UPDATE', [b.pass_id])).rows[0];
        const ab = await moveAbsorbed(client, b.id);
        if (ab) {
          out.needSure = true;
          out.check = { why: 'carried', classes: ab.n, on: ab.on };
          out.warning = `the Rezerv import counted ${ab.n} class${ab.n === 1 ? '' : 'es'} used on this pass's Rezerv copy on ${ab.on}, `
            + 'after this class was moved: it may be one of them, and giving it back may give a class away';
          if (sure !== true && !dryRun) fail(409, `${out.warning}. Check Rezerv, then send sure:true to give it back anyway.`,
            { needSure: true, carried: { classes: ab.n, on: ab.on } });
        }
        await client.query(`UPDATE bkk_passes SET credits_used = GREATEST(0, credits_used - 1)
          WHERE id=$1 AND kind <> 'unlimited'`, [pass.id]);
        await client.query(`UPDATE bkk_bookings SET pass_id=NULL, cover='rezerv', moved_at=NULL WHERE id=$1`, [b.id]);
        await note(`${what} put back on Rezerv${b.status === 'cancelled' ? ' (cancelled, kept used till now)' : ''}${out.needSure ? `, after a check: ${out.warning}` : ''}`);
      } else {
        if (b.pass_id) fail(409, 'this class is already on a pass');
        if (b.cover !== 'rezerv') fail(409, 'only a class on Rezerv can be moved onto a pass');
        if (b.status !== 'booked' || !b.checked_in_at) fail(409, 'only a class they came to can be moved onto a pass');
        const args = passId ? [b.member_id, b.d, Number(passId)] : [b.member_id, b.d];
        const OURS = `p.member_id=$1 AND p.source IS DISTINCT FROM 'rezerv'
          AND (p.kind='unlimited' OR p.credits_used < p.credits_total)${passId ? ' AND p.id=$3' : ''}`;
        pass = (await client.query(`SELECT p.* FROM bkk_passes p
          WHERE ${OURS} AND ${PASS_LIVE_ON('$2::date')} AND p.valid_from IS NOT NULL
          ORDER BY p.valid_from, p.id LIMIT 1 FOR UPDATE`, args)).rows[0];
        if (!pass) {
          const later = (await client.query(`SELECT to_char(p.valid_from,'YYYY-MM-DD') AS f FROM bkk_passes p
            WHERE ${OURS} AND p.status IN ('active','frozen') AND (p.valid_from IS NULL OR p.valid_from > $2::date)
              AND (p.valid_until IS NULL OR p.valid_until >= $2::date)
            ORDER BY p.valid_from NULLS FIRST, p.id LIMIT 1`, args)).rows[0];
          if (later) fail(409, `their pass had not begun on ${b.d} (${later.f ? `it begins ${later.f}` : 'it begins on its first class'}): `
            + 'a pass\'s days are never changed here', { notBegun: later.f || true });
          fail(409, passId ? `that pass cannot take this class: not theirs, from Rezerv, not running on ${b.d}, or no class left`
            : `no aybkk.net pass of theirs with a class left ran on ${b.d}`);
        }
        const VT = VISIT_TIME.replace(/\bb\./g, 'o.');
        const same = (await client.query(`SELECT ${VT} AS t, coalesce(s.title, o.class_title) AS c
          FROM bkk_bookings o LEFT JOIN bkk_class_slots s ON s.id=o.slot_id
          WHERE o.member_id=$1 AND o.class_date=$2::date AND o.id<>$3 AND o.status='booked' AND o.pass_id IS NOT NULL
          ORDER BY o.start_at`, [b.member_id, b.d, b.id])).rows.find(o => !o.t || !b.t || o.t === b.t);
        const paid = (await client.query(
          `(SELECT 'rezerv' AS why, coalesce(pr.name_en, 'Rezerv package') AS name, to_char(r.valid_from,'YYYY-MM-DD') AS f,
             to_char(r.valid_until,'YYYY-MM-DD') AS u, NULL::int AS n, NULL::int AS of
            FROM bkk_passes r LEFT JOIN bkk_products pr ON pr.id=r.product_id
            WHERE r.member_id=$1 AND r.source='rezerv' AND r.twin_of IS NULL AND r.valid_from <= $2::date AND r.valid_until >= $2::date
            ORDER BY r.valid_from LIMIT 1)
           UNION ALL
           (SELECT 'copy', coalesce(pa.name_en, 'pass'), to_char(${CARRIED_ON('x')},'YYYY-MM-DD'), NULL, (x.twin_undo->>'used')::int, x.twin_of
            FROM bkk_passes x JOIN bkk_passes a ON a.id=x.twin_of LEFT JOIN bkk_products pa ON pa.id=a.product_id
            WHERE a.member_id=$1 AND x.source='rezerv' AND coalesce((x.twin_undo->>'used')::int, 0) > 0
              AND x.valid_from <= $2::date AND x.valid_until >= $2::date AND $2::date <= ${CARRIED_ON('x')}
            ORDER BY x.twin_of=$3 DESC, x.id LIMIT 1)`, [b.member_id, b.d, pass.id])).rows;
        const checks = [], warnings = [];
        if (same) {
          checks.push({ why: 'sameDay', time: same.t, class: same.c });
          warnings.push(`they already have ${same.c || 'a class'}${same.t ? ' ' + same.t : ''} on a pass that day: this may be the same class`);
        }
        for (const x of paid) {
          const self = x.of === pass.id;
          checks.push(x.why === 'rezerv' ? { why: 'rezerv', name: x.name, from: x.f, until: x.u }
            : { why: 'copy', classes: x.n, on: x.f, passId: x.of, pass: x.name, same: self });
          warnings.push(x.why === 'rezerv'
            ? `a Rezerv package of theirs (${x.name}, ${x.f} to ${x.u}) ran on ${b.d}: Rezerv may have paid for this class`
            : `${self ? 'this pass' : `their other pass (${x.name})`} already took ${x.n} class${x.n === 1 ? '' : 'es'} used on its Rezerv copy, brought over on ${x.f}: this class may be one of them`);
        }
        if (checks.length) {
          Object.assign(out, { needSure: true, check: checks[0], checks, warning: warnings.join('; ') });
          if (sure !== true && !dryRun) fail(409, `${out.warning}. Check Rezerv, then send sure:true to take it from the pass anyway.`,
            { needSure: true, check: checks[0], checks });
        }
        if (pass.kind !== 'unlimited') await client.query('UPDATE bkk_passes SET credits_used = credits_used + 1 WHERE id=$1', [pass.id]);
        await client.query(`UPDATE bkk_bookings SET pass_id=$2, cover='pass', moved_at=now() WHERE id=$1`, [b.id, pass.id]);
        await note(`${what} moved from Rezerv onto this pass${out.needSure ? `, after a check: ${out.warning}` : ''}`);
      }
      const after = (await client.query(`SELECT p.*, pr.name_en, pr.name_th, ${PASS_DATES}
        FROM bkk_passes p LEFT JOIN bkk_products pr ON pr.id=p.product_id WHERE p.id=$1`, [pass.id])).rows[0];
      await client.query(dryRun ? 'ROLLBACK' : 'COMMIT');
      res.json({ success: true, dryRun: !!dryRun, undo: !!undo,
        booking: { id: b.id, date: b.d, time: b.t, cover: undo ? 'rezerv' : 'pass' }, pass: passOut(after), ...out });
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      res.status(e.status || 500).json({ error: e.message, ...(e.extra || {}) });
    } finally { client.release(); }
  });

  // ── the teaching team ─────────────────────────────────────────────────────
  // Boonchu, Jamsai and M. Each signs in with their own passcode so every note
  // carries a name; the admin passcode is for running the shala, not teaching.

  const hashKey = k => crypto.createHash('sha256').update(String(k)).digest('hex');

  // A random secret made once and kept in the database, never in the code: it
  // signs the door tablet's seat handles and the member refs teachers get.
  let secretP = null;
  const serverSecret = () => secretP || (secretP = (async () => {
    await booted.catch(() => {});
    await q(`INSERT INTO bkk_settings (key,value) VALUES ('door_secret', to_jsonb($1::text)) ON CONFLICT (key) DO NOTHING`,
      [crypto.randomBytes(32).toString('hex')]);
    const v = (await q(`SELECT value FROM bkk_settings WHERE key='door_secret'`)).rows[0].value;
    return Buffer.from(String(v), 'hex');
  })().catch(e => { secretP = null; throw e; }));
  const hmac = (sec, s) => crypto.createHmac('sha256', sec).update(s).digest();
  // Four numbers in one AES block under a key from the server secret, plus a
  // MAC: 43 characters that show no id and cannot be made up. The same numbers
  // give the same string. Only the exact string sealBlock made opens (no other
  // spelling of the same bytes). The last number is a tag that says what it is.
  const blockKeys = (sec, use) => ({ enc: hmac(sec, use + '-enc'), mac: hmac(sec, use + '-mac') });
  function sealBlock(k, nums) {
    const p = Buffer.alloc(16);
    nums.forEach((n, i) => p.writeUInt32BE(n >>> 0, i * 4));
    const c = crypto.createCipheriv('aes-256-ecb', k.enc, null);
    c.setAutoPadding(false);
    const ct = Buffer.concat([c.update(p), c.final()]);
    return Buffer.concat([ct, hmac(k.mac, ct).subarray(0, 16)]).toString('base64url');
  }
  function openBlock(k, t, tag) {
    if (typeof t !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(t)) return null;
    const raw = Buffer.from(t, 'base64url');
    if (raw.length !== 32 || raw.toString('base64url') !== t) return null;
    const ct = raw.subarray(0, 16);
    if (!crypto.timingSafeEqual(raw.subarray(16), hmac(k.mac, ct).subarray(0, 16))) return null;
    const d = crypto.createDecipheriv('aes-256-ecb', k.enc, null);
    d.setAutoPadding(false);
    const p = Buffer.concat([d.update(ct), d.final()]);
    if (p.readUInt32BE(12) !== tag) return null;
    return [0, 1, 2].map(i => p.readUInt32BE(i * 4));
  }
  // Teachers name a student by this ref, not the member code (the student's
  // sign-in, 17 Nov 2026): "m." and a sealed block, so it shows no member id
  // (ids run in order and would tell how many profiles there are). It opens
  // nothing outside /api/bkk/teacher.
  const REF_TAG = 0x4d524631;
  const memberRef = (sec, id) => 'm.' + sealBlock(blockKeys(sec, 'ref'), [id, 0, 0, REF_TAG]);
  const REF_RE = /^m\.[A-Za-z0-9_-]{43}$/;
  const refId = (sec, s) => {
    if (!REF_RE.test(String(s || ''))) return null;
    const v = openBlock(blockKeys(sec, 'ref'), String(s).slice(2), REF_TAG);
    return v && v[0] ? v[0] : null;
  };
  // A teacher route's student: a ref, or a member code typed in.
  async function memberByKey(key, db = pool) {
    if (!REF_RE.test(String(key || ''))) return memberByCode(key, db);
    const id = refId(await serverSecret(), key);
    return id ? liveMember(db, (await db.query('SELECT * FROM bkk_members WHERE id=$1', [id])).rows[0]) : null;
  }

  // Wrong passcodes are counted per address (17 Nov 2026): a passcode can be as
  // short as 8 characters, and teachers can now change who is checked in. Past
  // the limit every passcode from that address is refused for the rest of the
  // window, the right one too, so a hit looks like a miss.
  // At the shala everyone shares one address, so a browser that has signed in
  // once carries a signed "known browser" mark (X-Teacher-Known, 60 days, renewed
  // on use) and is counted on its own: someone guessing on the shala wifi cannot
  // lock the teachers out. The mark opens nothing; the passcode is still checked.
  const TEACHER_MISSES = 8, TEACHER_LOCK_MS = 15 * 60000, KNOWN_DAYS = 60;
  const teacherMisses = missCounter(TEACHER_MISSES, TEACHER_LOCK_MS);
  const knownSig = (sec, id, until) => hmac(sec, `teacher-known:${id}:${until}`).toString('base64url').slice(0, 22);
  const knownMark = (sec, id) => { const until = Math.floor(Date.now() / 86400000) + KNOWN_DAYS; return `${id}.${until}.${knownSig(sec, id, until)}`; };
  const knownId = (sec, s) => {
    const m = /^(\d{1,9})\.(\d{1,7})\.([A-Za-z0-9_-]{22})$/.exec(String(s || ''));
    if (!m || Number(m[2]) < Math.floor(Date.now() / 86400000)) return null;
    return crypto.timingSafeEqual(Buffer.from(knownSig(sec, m[1], m[2])), Buffer.from(m[3])) ? Number(m[1]) : null;
  };
  app.use('/api/bkk/teacher', async (req, res, next) => {
    res.set('Cache-Control', 'private, no-store');
    const key = req.headers['x-teacher-key'];
    if (!key) return next();
    let t = null;
    try {
      const sec = await serverSecret();
      const known = knownId(sec, req.headers['x-teacher-known']);
      const who = known ? `known:${known}` : guessIp(req);
      if (teacherMisses.over(who)) {
        return res.status(429).set('Retry-After', String(teacherMisses.retryS(who))).json({ locked: true,
          error: 'Too many wrong passcodes from here. Try again in 15 minutes, or switch off wifi and use mobile data.' });
      }
      t = teacherMisses.hold(who);
      req.teacher = (await q('SELECT * FROM bkk_teachers WHERE key_hash = $1 AND active', [hashKey(key)])).rows[0] || null;
      if (req.teacher) { t.n--; res.set('X-Teacher-Known', knownMark(sec, req.teacher.id)); }
      next();
    } catch (e) {
      if (t) t.n--;
      res.status(500).json({ error: e.message });
    }
  });
  // Returns the teacher, or null. Admin is NOT a teacher: someone has to own
  // each note, and "the admin" is not a person a student can ask about it.
  async function teacherFrom(req) {
    return req.teacher || null;
  }

  app.get('/api/bkk/teacher/me', async (req, res) => {
    const t = await teacherFrom(req);
    if (!t) return res.status(401).json({ error: 'bad passcode' });
    res.json({ teacher: { id: t.id, name: t.name } });
  });

  // A teacher's view of one student: everything, including notes kept from them.
  app.get('/api/bkk/teacher/student/:code', async (req, res) => {
    const t = await teacherFrom(req);
    if (!t) return res.status(401).json({ error: 'bad passcode' });
    try {
      const m = await memberByKey(req.params.code);
      if (!m) return res.status(404).json({ error: 'not found' });
      const byRef = REF_RE.test(req.params.code);
      const [passes, notes, recent] = await Promise.all([
        q(`SELECT p.*, pr.name_en FROM bkk_passes p JOIN bkk_products pr ON pr.id=p.product_id
           WHERE p.member_id=$1 ORDER BY p.id DESC`, [m.id]),
        q(`SELECT n.*, t.name AS teacher_name FROM bkk_notes n
           LEFT JOIN bkk_teachers t ON t.id=n.teacher_id
           WHERE n.member_id=$1 ORDER BY n.created_at DESC LIMIT 50`, [m.id]),
        q(`SELECT b.class_date, b.checked_in_at, s.title FROM bkk_bookings b
           JOIN bkk_class_slots s ON s.id=b.slot_id
           WHERE b.member_id=$1 AND b.status='booked'
           ORDER BY b.start_at DESC LIMIT 20`, [m.id]),
      ]);
      // Opened from today's list (a ref): the member code stays off the answer.
      const cOn = await consentMode() !== 'off';
      const st = cOn ? await consentOf(pool, m) : null;
      res.json({
        member: { ...(byRef ? {} : { code: m.code }), ref: memberRef(await serverSecret(), m.id),
          name: m.name, email: m.email, phone: m.phone, photo: faceSmall(m.photo_id, m.code), journalId: await journalId(m) },
        ...(st ? { consent: { signed: st.signed, under20: st.under20 && !st.guardianSigned } } : {}),
        passes: passes.rows, notes: notes.rows, recent: recent.rows,
      });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.post('/api/bkk/teacher/notes', async (req, res) => {
    const t = await teacherFrom(req);
    if (!t) return res.status(401).json({ error: 'bad passcode' });
    try {
      const { memberCode, ref, body, toWorkOn, classDate, shareWithStudent } = req.body || {};
      const m = await memberByKey(ref || memberCode);
      if (!m) return res.status(404).json({ error: 'student not found' });
      if (!String(body || '').trim() && !String(toWorkOn || '').trim()) {
        return res.status(400).json({ error: 'write something in one of the two boxes' });
      }
      const n = (await q(
        `INSERT INTO bkk_notes (member_id,teacher_id,class_date,body,to_work_on,share_with_student)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
        [m.id, t.id, classDate || null,
         String(body || '').slice(0, 2000) || null,
         String(toWorkOn || '').slice(0, 500) || null,
         shareWithStudent !== false])).rows[0];
      res.json({ success: true, note: { ...n, teacher_name: t.name } });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Today's seats, for /teach and the photos page. No member code (17 Nov 2026):
  // it is the student's sign-in, and a teacher passcode can be guessed. ref names
  // the student on the teacher routes, bookingId the seat. checkPass: no pass of
  // this member is live today (PASS_LIVE_ON over all of them, so a pause that has
  // ended or a Rezerv twin that came back is not flagged); a Rezerv seat says
  // Rezerv instead. added: put on by /teach today, so /teach can take it off.
  // photo: the small signed face link, or null.
  app.get('/api/bkk/teacher/today', async (req, res) => {
    const t = await teacherFrom(req);
    if (!t) return res.status(401).json({ error: 'bad passcode' });
    try {
      const today = bkkToday();
      const [r, sec, classes] = await Promise.all([q(
        `SELECT b.id AS booking_id, b.member_id, m.name, m.code, m.photo_id, s.title, s.id AS slot_id, s.is_online, b.start_at, b.checked_in_at,
           b.cover, b.checkin_via, b.checkin_by,
           coalesce(b.source = 'teacher' AND (b.booked_at AT TIME ZONE 'Asia/Bangkok')::date = $1::date, false) AS added,
           (b.cover IS DISTINCT FROM 'rezerv' AND NOT EXISTS (SELECT 1 FROM bkk_passes p
              WHERE p.member_id = b.member_id AND ${PASS_LIVE_ON('$1::date')})) AS check_pass,
           (SELECT count(*)::int FROM bkk_notes n WHERE n.member_id=m.id) AS notes,
           ${SIGNED('m.id')} AS signed, ${GUARDIAN_DUE('m.id')} AS under20,
           lm.day AS last_main, lm.days AS last_main_days
         FROM bkk_bookings b
         JOIN bkk_members m ON m.id=b.member_id
         JOIN bkk_class_slots s ON s.id=b.slot_id
         LEFT JOIN LATERAL (
           SELECT to_char(max(p.class_date),'YYYY-MM-DD') AS day,
                  (now() AT TIME ZONE 'Asia/Bangkok')::date - max(p.class_date) AS days
           FROM bkk_photo_members pm JOIN bkk_photos p ON p.id=pm.photo_id
           WHERE pm.member_id=m.id AND pm.role='main') lm ON true
         WHERE b.status='booked' AND b.class_date = $1::date
         ORDER BY b.start_at, m.name, b.id`, [today]), serverSecret(), classesToday(today)]);
      // alsoAt: the member's other seats today, so a wrong class booked by
      // mistake (a second class used) shows on both rows.
      const times = new Map();
      for (const b of r.rows) times.set(b.member_id, [...(times.get(b.member_id) || []), [b.booking_id, bkkHm(new Date(b.start_at).getTime())]]);
      // The agreement, as two true/false only while it is on: signed, and under 20 with no guardian yet.
      const cOn = await consentMode() !== 'off';
      res.json({
        date: today, classes,
        students: r.rows.map(({ member_id, booking_id, slot_id, is_online, checkin_via, checkin_by, check_pass, code, photo_id, signed, under20, ...s }) => ({
          ...s, ...(cOn ? { signed: signed === true, under20: under20 === true } : {}), photo: faceSmall(photo_id, code), ref: memberRef(sec, member_id), bookingId: booking_id, slotId: slot_id, isOnline: is_online,
          checkinVia: checkin_via, checkinBy: checkin_by, rezerv: s.cover === 'rezerv', checkPass: check_pass,
          alsoAt: times.get(member_id).filter(x => x[0] !== booking_id).map(x => x[1]) })),
      });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Today's classes on the timetable (none on a moon day), cancelled ones left
  // out: what /teach can add someone to. end: start + duration_min.
  async function classesToday(today, db = pool) {
    if (moonDaysBetween(today, today).size) return [];
    const wd = new Date(`${today}T12:00:00${TZ_OFFSET}`).getUTCDay();
    const rows = (await db.query(
      `SELECT s.* FROM bkk_class_slots s WHERE s.active AND s.weekday=$1 AND NOT EXISTS (SELECT 1 FROM bkk_class_overrides o
         WHERE o.slot_id=s.id AND o.class_date=$2::date AND o.cancelled) ORDER BY s.start_time, s.id`, [wd, today])).rows;
    return rows.map(s => {
      const start = Date.parse(startAtISO(today, s.start_time));
      return { slotId: s.id, title: s.title, isOnline: s.is_online, startAt: startAtISO(today, s.start_time),
        endAt: bkkISO(start + (s.duration_min || 120) * 60000), ended: bkkNow().getTime() >= start + (s.duration_min || 120) * 60000 };
    });
  }

  // Fixes from a teacher's phone (17 Nov 2026), on today's in-person classes
  // only, each saying who: checkin_via 'teacher', checkin_by their name.
  const TEACH_ONLY_TODAY = 'only today\'s classes at the shala can be fixed here';
  async function teachSeat(db, id, lock = false) {
    if (!/^\d{1,9}$/.test(String(id))) return null;
    return (await db.query(
      `SELECT b.*, to_char(b.class_date,'YYYY-MM-DD') AS day, s.is_online, s.duration_min, s.start_time, m.name
       FROM bkk_bookings b JOIN bkk_class_slots s ON s.id=b.slot_id JOIN bkk_members m ON m.id=b.member_id
       WHERE b.id=$1${lock ? ' FOR UPDATE OF b' : ''}`, [Number(id)])).rows[0] || null;
  }
  const teachable = b => b.day === bkkToday() && b.is_online === false;

  // Check one seat in, or undo it (checked_in_at cleared, classes never touched,
  // as the admin undo). A class already over is checked in at its start.
  app.post('/api/bkk/teacher/bookings/:id/checkin', async (req, res) => {
    const t = await teacherFrom(req);
    if (!t) return res.status(401).json({ error: 'bad passcode' });
    const undo = (req.body || {}).undo === true;
    try {
      const b = await teachSeat(pool, req.params.id);
      if (!b) return res.status(404).json({ error: 'booking not found' });
      if (!teachable(b)) return res.status(409).json({ error: TEACH_ONLY_TODAY });
      if (b.status !== 'booked') return res.status(409).json({ error: 'that booking was cancelled' });
      const nowIso = bkkNow().toISOString();
      const r = (await q(undo
        ? `UPDATE bkk_bookings SET checked_in_at=NULL, checkin_via='teacher', checkin_by=$2
           WHERE id=$1 AND status='booked' RETURNING id, checked_in_at, checkin_via, checkin_by, false AS already`
        : `UPDATE bkk_bookings b SET
             checked_in_at = COALESCE(b.checked_in_at, CASE WHEN $3::timestamptz > b.start_at + make_interval(mins => $4::int)
               THEN b.start_at ELSE $3::timestamptz END),
             checkin_via = CASE WHEN b.checked_in_at IS NULL THEN 'teacher' ELSE b.checkin_via END,
             checkin_by = CASE WHEN b.checked_in_at IS NULL THEN $2 ELSE b.checkin_by END
           FROM bkk_bookings o WHERE b.id=$1 AND o.id=b.id AND b.status='booked'
           RETURNING b.id, b.checked_in_at, b.checkin_via, b.checkin_by, o.checked_in_at IS NOT NULL AS already`,
        undo ? [b.id, t.name] : [b.id, t.name, nowIso, b.duration_min || 120])).rows[0];
      if (!r) return res.status(409).json({ error: 'that booking was cancelled' });
      res.json({ success: true, already: r.already, booking: { id: r.id, checkedInAt: r.checked_in_at, via: r.checkin_via, by: r.checkin_by } });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Add someone who came and has a pass: booked by the staff rules (over the
  // class limit is fine, they are in the room) and checked in. Only a pass live
  // today that has already started: a tap here never starts anyone's pass.
  // Someone already on this class's list is only checked in.
  const NOT_STARTED = 'Pass not started. Ask Boonchu or M.';
  const NO_PASS_TODAY = 'No pass for today. Ask Boonchu or M.';
  app.post('/api/bkk/teacher/add', async (req, res) => {
    const t = await teacherFrom(req);
    if (!t) return res.status(401).json({ error: 'bad passcode' });
    const { ref, slotId } = req.body || {};
    if (!REF_RE.test(String(ref || ''))) return res.status(400).json({ error: 'pick the student from the search' });
    if (!/^\d{1,9}$/.test(String(slotId || ''))) return res.status(400).json({ error: 'slotId required' });
    const today = bkkToday();
    const client = await pool.connect();
    try {
      const member = await memberByKey(ref, client);
      if (!member) return res.status(404).json({ error: 'student not found' });
      await client.query('BEGIN');
      const { slot } = await classCheck(client, Number(slotId), today, { staff: true, endedMsg: CLASS_ENDED });
      if (slot.is_online) throw Object.assign(new Error(TEACH_ONLY_TODAY), { status: 409 });
      await client.query('SELECT pg_advisory_xact_lock($1::int, $2::int)', [slot.id, Number(today.replace(/-/g, ''))]);
      const on = (await client.query(`SELECT id FROM bkk_bookings WHERE slot_id=$1 AND class_date=$2 AND member_id=$3 AND status='booked'`,
        [slot.id, today, member.id])).rows[0];
      if (on) {
        const r = (await client.query(`UPDATE bkk_bookings b SET checked_in_at = COALESCE(b.checked_in_at, $3::timestamptz),
            checkin_via = CASE WHEN b.checked_in_at IS NULL THEN 'teacher' ELSE b.checkin_via END,
            checkin_by = CASE WHEN b.checked_in_at IS NULL THEN $2 ELSE b.checkin_by END
          WHERE b.id=$1 RETURNING b.id, b.checked_in_at`, [on.id, t.name, bkkNow().toISOString()])).rows[0];
        await client.query('COMMIT');
        return res.json({ success: true, already: true, name: member.name, booking: { id: r.id, checkedInAt: r.checked_in_at } });
      }
      const also = (await client.query(`SELECT to_char(b.start_at AT TIME ZONE 'Asia/Bangkok','HH24:MI') AS t FROM bkk_bookings b
        WHERE b.member_id=$1 AND b.class_date=$2::date AND b.status='booked' ORDER BY b.start_at`, [member.id, today])).rows.map(x => x.t);
      const usable = `p.member_id=$1 AND p.status='active' AND (p.kind='unlimited' OR p.credits_used < p.credits_total)`;
      const pass = (await client.query(
        `SELECT p.* FROM bkk_passes p WHERE ${usable} AND ${PASS_LIVE_ON('$2::date')}
           AND p.valid_from IS NOT NULL AND p.valid_from <= $2::date
         ORDER BY p.valid_from, p.id LIMIT 1 FOR UPDATE`, [member.id, today])).rows[0];
      if (!pass) {
        const later = (await client.query(`SELECT 1 FROM bkk_passes p WHERE ${usable}
            AND (p.valid_until IS NULL OR p.valid_until >= $2::date) AND (p.valid_from IS NULL OR p.valid_from > $2::date) LIMIT 1`,
          [member.id, today])).rows.length;
        throw Object.assign(new Error(later ? NOT_STARTED : NO_PASS_TODAY), { status: 409, notStarted: !!later });
      }
      const seat = await takeSeat(client, { member, slotId: slot.id, date: today, staff: true, allowOver: true,
        cover: 'pass', passId: pass.id, checkIn: true, source: 'teacher', onList: false });
      // The class clock (now, but for a test that moves it), so /teach can tell today's adds.
      const at = bkkNow().toISOString();
      seat.booking = (await client.query(`UPDATE bkk_bookings SET checkin_via='teacher', checkin_by=$2, booked_at=$3, checked_in_at=$3
        WHERE id=$1 RETURNING *`, [seat.booking.id, t.name, at])).rows[0];
      await client.query('COMMIT');
      res.json({ success: true, already: false, name: member.name, overCapacity: seat.overCapacity, alsoAt: also,
        booking: { id: seat.booking.id, checkedInAt: seat.booking.checked_in_at } });
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      res.status(e.status || 409).json({ error: /duplicate key/.test(e.message) ? 'already on the list' : e.message,
        ...(e.notStarted ? { notStarted: true } : {}) });
    } finally { client.release(); }
  });

  // Take off a seat /teach added today by mistake: cancelled, and the class goes
  // back on the pass, in one transaction with the pass locked, and said on the
  // pass note. A seat made any other way is not this route's to take off.
  app.post('/api/bkk/teacher/bookings/:id/remove', async (req, res) => {
    const t = await teacherFrom(req);
    if (!t) return res.status(401).json({ error: 'bad passcode' });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const b = await teachSeat(client, req.params.id, true);
      if (!b) throw Object.assign(new Error('booking not found'), { status: 404 });
      if (!teachable(b)) throw Object.assign(new Error(TEACH_ONLY_TODAY), { status: 409 });
      if (b.status !== 'booked') throw Object.assign(new Error('already ' + b.status), { status: 409 });
      if (b.source !== 'teacher' || ymd(new Date(b.booked_at)) !== bkkToday())
        throw Object.assign(new Error('only a name added on /teach today can be taken off here'), { status: 409 });
      if (b.pass_id) await client.query('SELECT 1 FROM bkk_passes WHERE id=$1 FOR UPDATE', [b.pass_id]);
      await client.query(`UPDATE bkk_bookings SET status='cancelled', cancelled_at=now(), cancel_reason=$2,
        checkin_via='teacher', checkin_by=$3 WHERE id=$1`, [b.id, `added on /teach by mistake: taken off by ${t.name}`, t.name]);
      let back = false;
      if (b.pass_id) {
        back = (await client.query(`UPDATE bkk_passes SET credits_used = GREATEST(0, credits_used - 1),
            note = concat_ws(' | ', nullif(note, ''), $2::text)
          WHERE id=$1 AND kind <> 'unlimited' RETURNING id`,
          [b.pass_id, `class ${b.day} ${b.start_time} added on /teach and taken off by ${t.name}: given back`])).rowCount > 0;
        if (!back) await client.query(`UPDATE bkk_passes SET note = concat_ws(' | ', nullif(note, ''), $2::text) WHERE id=$1`,
          [b.pass_id, `class ${b.day} ${b.start_time} added on /teach and taken off by ${t.name}`]);
      }
      await client.query('COMMIT');
      res.json({ success: true, creditReturned: back, name: b.name });
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      res.status(e.status || 500).json({ error: e.message });
    } finally { client.release(); }
  });

  // ── profile photos ────────────────────────────────────────────────────────
  // Chay (on a teacher passcode) uploads the day's photos and taps who is in
  // each one. Stored as Cloudinary "authenticated" assets: no plain URL works,
  // only signed ones, and those are handed out only to the tagged students.
  // Tiles show the whole photo (no crop: a 4:5 fill cut off heads and feet).
  // Each size and each format is one more copy Cloudinary makes and bills as a
  // transformation, the bulk of the bill (Nov 2026), so:
  // 'thumb' is one WebP: f_auto made a copy per browser (JPEG XL, WebP, JPEG).
  // 'full' is what students long-press to keep and repost on Instagram: the
  // stored JPEG itself (uploads are already capped at 2048), no copy made. The
  // f_auto copy it once was looked soft once saved.
  // Never change one of these strings: a new string is a new copy of every photo
  // opened again, billed again (it happened on 2 and 17 Nov 2026).
  // Download ('save') is a plain JPEG sent as a file: the WebP/AVIF that f_auto
  // gives Android can't be long-pressed into a Samsung gallery or out of LINE's
  // browser. It is the stored JPEG itself, sent by this server (photoSave): the
  // Cloudinary attachment link it replaces made one more full-size copy of each
  // photo downloaded, billed and stored for good, of the very same bytes.
  const PHOTO_SIZES = {
    thumb: { width: 600, height: 600, crop: 'limit', quality: 'auto', fetch_format: 'webp' },
    full: null,
  };
  const photoUrl = (publicId, kind) => cloudinary.url(publicId, {
    type: 'authenticated', sign_url: true, secure: true,
    ...(PHOTO_SIZES[kind] ? { transformation: [PHOTO_SIZES[kind]] } : { format: 'jpg' }),
  });
  // A download link never ends, as the Cloudinary one before it never did: a
  // student may leave the page open for days. A path on this site, so it works on
  // aybkk.net and through cn.aybkk.net alike. Signed over the photo's own random
  // public_id too, as that link was: a row id handed out again (a restore, a reset
  // sequence) or another database with the same key never opens someone else's photo.
  const SAVE_KEY = crypto.createHash('sha256').update('aybkk-photo-save:' + (process.env.CLOUDINARY_API_SECRET
    || ADMIN_KEY || crypto.randomBytes(32).toString('hex'))).digest();
  const saveSig = (id, publicId) => crypto.createHmac('sha256', SAVE_KEY).update(`save.${id}.${publicId}`).digest('base64url').slice(0, 22);
  const photoSave = (id, publicId) => `/api/bkk/photo/${id}.${saveSig(id, publicId)}/AYBKK-photo.jpg`;
  // A photo in R2 is served by this site (/ph, below); one on Cloudinary as before.
  const photoLink = (p, kind) => p.store === 'r2' ? r2lib.phPath(p.id, p.r2_key, kind === 'thumb' ? 't' : 'v') : photoUrl(p.public_id, kind);
  const isDate = d => /^\d{4}-\d{2}-\d{2}$/.test(String(d || ''));
  // Who is in a photo, and how: 'main' (the photo is about them) or 'other'
  // (in the frame). Sent as tags: [{ code, role }]; the old memberCodes still
  // works, with one role for all of them (main if none is given).
  // A code that no longer exists (the shala gave that profile a new one while
  // this page was open) stops the save: dropping it would silently untag a student.
  const ROLES = ['main', 'other'];
  async function tagsFrom(b) {
    const given = Array.isArray(b.tags);
    const raw = given ? b.tags.map(x => [x && x.code, x && x.role])
      : (Array.isArray(b.memberCodes) ? b.memberCodes : []).map(code => [code, b.role]);
    const want = new Map();              // code -> role; named twice, main wins
    for (const [code, r] of raw) {
      const role = r ?? 'main';
      if (!ROLES.includes(role)) throw Object.assign(new Error('role must be main or other'), { status: 400 });
      if (want.get(String(code)) !== 'main') want.set(String(code), role);
    }
    const list = [...want.keys()];
    // Cutting the list instead would save the photo without some of them, the main student maybe.
    if (list.length > 30) throw Object.assign(new Error('30 names at most on one photo. Nothing was saved.'), { status: 400 });
    if (!list.length) return { ids: [], roles: [], given };
    // A name is a member code or, from today's list, a ref (17 Nov 2026). One
    // student named both ways is one tag, and main wins.
    const sec = await serverSecret();
    const refs = new Map(list.filter(k => REF_RE.test(k)).map(k => [k, refId(sec, k)]));
    const codes = list.filter(k => !refs.has(k));
    const rows = codes.length ? (await q('SELECT id, code FROM bkk_members WHERE code = ANY($1::text[]) AND merged_into IS NULL', [codes])).rows : [];
    const ids = [...new Set([...refs.values()].filter(Boolean))];
    const live = ids.length ? new Set((await q('SELECT id FROM bkk_members WHERE id = ANY($1::int[]) AND merged_into IS NULL', [ids])).rows.map(r => r.id)) : new Set();
    if (rows.length < codes.length || [...refs.values()].some(id => !live.has(id))) {
      const e = new Error('A student on this photo has a new code. Reload the page and pick them again. Nothing was saved.');
      e.status = 409;
      throw e;
    }
    const byId = new Map();
    const put = (id, role) => { if (byId.get(id) !== 'main') byId.set(id, role); };
    for (const r of rows) put(r.id, want.get(r.code));
    for (const [k, id] of refs) put(id, want.get(k));
    return { ids: [...byId.keys()], roles: [...byId.values()], given };
  }
  // The photo ends with exactly these people. keep: someone already on it keeps
  // the role they have (the old memberCodes body says nothing about roles).
  const setTags = (photoId, t, keep) => q(
    `WITH gone AS (DELETE FROM bkk_photo_members WHERE photo_id = $1::int AND member_id <> ALL($2::int[]))
     INSERT INTO bkk_photo_members (photo_id, member_id, role)
     SELECT $1::int, w.member_id, w.role FROM unnest($2::int[], $3::text[]) AS w(member_id, role)
     ON CONFLICT (photo_id, member_id) DO UPDATE SET role = EXCLUDED.role WHERE NOT $4::boolean`,
    [photoId, t.ids, t.roles, !!keep]);
  // These people are added and nobody leaves. Someone in the frame who is added
  // as main becomes main; a main is never turned into "in the frame" this way.
  const addTags = (photoIds, t) => q(
    `INSERT INTO bkk_photo_members (photo_id, member_id, role)
     SELECT p, w.member_id, w.role FROM unnest($1::int[]) p
       CROSS JOIN unnest($2::int[], $3::text[]) AS w(member_id, role)
     ON CONFLICT (photo_id, member_id) DO UPDATE SET role = 'main'
       WHERE EXCLUDED.role = 'main' AND bkk_photo_members.role <> 'main'`,
    [photoIds, t.ids, t.roles]);
  // Students see the photos they are main in. The ones they are only in the
  // frame of stay hidden unless this setting is true (privacy, the safe default).
  const othersVisible = async () => (await getSetting('photos_others_visible', false)) === true;
  // staff: for the /photos page, which shows a photo imported from Drive by
  // Drive's own thumbnail, so Cloudinary makes a tile only when a student opens
  // it. The Drive id never goes to a student.
  async function photosWithTags(where, args, staff) {
    const rows = (await q(
      `SELECT p.*, to_char(p.class_date, 'YYYY-MM-DD') AS day,
              coalesce(json_agg(json_build_object('id', m.id, 'name', m.name, 'role', pm.role)
                ORDER BY (pm.role <> 'main'), m.name) FILTER (WHERE m.id IS NOT NULL), '[]') AS members
       FROM bkk_photos p
       LEFT JOIN bkk_photo_members pm ON pm.photo_id = p.id
       LEFT JOIN bkk_members m ON m.id = pm.member_id
       WHERE ${where} GROUP BY p.id ORDER BY p.id`, args)).rows;
    const sec = await serverSecret();
    return rows.map(p => ({ id: p.id, date: p.day, members: p.members.map(({ id, ...m }) => ({ ...m, ref: memberRef(sec, id) })),
      thumb: photoLink(p, 'thumb'), full: photoLink(p, 'full'), save: photoSave(p.id, p.public_id),
      ...(staff && p.drive_id ? { drive: p.drive_id } : {}) }));
  }

  // Cloudinary's free plan is 25 credits a rolling 30 days, and an account far
  // past it can be switched off, taking every student photo and door face with
  // it. Its usage is read at most every 30 minutes; a failed read keeps the last
  // good one, and never read is null: no limit then.
  const USAGE_TTL = 30 * 60000, PHOTO_CAP_AT = 90, PHOTO_CAP_DEFAULT = 100;
  let usageAt = 0, usageWait = null, usageLast = null;
  function cloudUsage() {
    const t = nowMs();
    if (usageWait && t >= usageAt && t - usageAt < USAGE_TTL) return usageWait;
    usageAt = t;
    return (usageWait = (async () => {
      let timer;
      try {
        if (!cloudinary || !cloudinary.api || typeof cloudinary.api.usage !== 'function') return usageLast;
        const u = await Promise.race([cloudinary.api.usage(),
          new Promise((_, no) => { timer = setTimeout(() => no(new Error('timeout')), 10000); })]);
        const num = v => v == null || v === '' ? NaN : Number(v);
        const c = (u && u.credits) || {}, used = num(c.usage), limit = num(c.limit);
        const pct = Number.isFinite(num(c.used_percent)) ? num(c.used_percent) : limit > 0 ? 100 * used / limit : NaN;
        if (Number.isFinite(pct)) usageLast = { percent: Math.round(pct * 10) / 10,
          used: Number.isFinite(used) ? used : null, limit: Number.isFinite(limit) ? limit : null };
      } catch (e) {
        console.warn('[bkk photos] Cloudinary usage not read:', (e && (e.message || (e.error && e.error.message))) || e);
      } finally { clearTimeout(timer); }
      return usageLast;
    })());
  }
  // New class photos stored today (Bangkok day), from the phone or from Drive.
  const photosToday = async () => (await q(`SELECT count(*)::int AS n FROM bkk_photos
    WHERE created_at >= date_trunc('day', now() AT TIME ZONE 'Asia/Bangkok') AT TIME ZONE 'Asia/Bangkok'`)).rows[0].n;
  const photosCap = async () => {
    const v = await getSetting('photos_daily_cap', PHOTO_CAP_DEFAULT);
    return typeof v === 'number' || /^\d+$/.test(String(v)) ? Math.max(0, Math.floor(Number(v))) : PHOTO_CAP_DEFAULT;
  };
  async function photoMeter() {
    const [u, cap, today] = await Promise.all([cloudUsage(), photosCap(), photosToday()]);
    // With R2 on, new photos never go to Cloudinary: no limit, and the percent is for faces and older photos.
    return { percent: u ? u.percent : null, used: u ? u.used : null, limit: u ? u.limit : null,
      cap, today, capOn: !r2 && !!u && u.percent >= PHOTO_CAP_AT && cap > 0, ...(r2 ? { store: 'r2' } : {}) };
  }
  // While Cloudinary is nearly full: at most photos_daily_cap NEW photos a day
  // (0: no limit). Changing who is on a photo already in never counts.
  async function photoCapHit() {
    const m = await photoMeter();
    if (!m.capOn || m.today < m.cap) return null;
    return `Not saved: today's limit of ${m.cap} new photos is reached. Cloudinary, where the photos are stored, is at `
      + `${Math.round(m.percent)}% of its free plan and could be switched off. Pick the best ones; the rest can wait.`;
  }

  // Two people (or one person twice) can share a name; a hint of the email
  // tells them apart, without handing the team full addresses: at most two
  // letters of the name part, never all of it ("a@" and "ab@" hide it too).
  const emailHint = e => {
    const s = String(e || ''), at = s.lastIndexOf('@');
    return !s ? '' : at < 1 ? '…' : s.slice(0, Math.min(2, at - 1)) + '…' + s.slice(at);
  };

  // Who Chay can tag: today's bookings first, then a name search, then a quick
  // add for someone not in the system yet (most students are still on Rezerv).
  app.get('/api/bkk/teacher/members', async (req, res) => {
    const t = await teacherFrom(req);
    if (!t) return res.status(401).json({ error: 'bad passcode' });
    try {
      const term = String(req.query.q || '').trim().toLowerCase();
      if (term.length < 2) return res.json({ members: [] });
      // passToday: a pass live today that has started, the one /teach's Add can use.
      const [r, sec] = await Promise.all([q(
        `SELECT m.id, m.code, m.name, m.email, EXISTS (SELECT 1 FROM bkk_passes p WHERE p.member_id=m.id AND p.status='active'
             AND ${PASS_LIVE_ON('$2::date')} AND p.valid_from IS NOT NULL AND p.valid_from <= $2::date
             AND (p.kind='unlimited' OR p.credits_used < p.credits_total)) AS pass_today FROM bkk_members m
         WHERE m.merged_into IS NULL AND (lower(m.name) LIKE $1 OR lower(coalesce(m.email,'')) LIKE $1
           OR EXISTS (SELECT 1 FROM unnest(coalesce(m.former_names, '{}')) n WHERE lower(n) LIKE $1)
           OR EXISTS (SELECT 1 FROM bkk_members f WHERE f.merged_into = m.id
             AND (lower(f.name) LIKE $1 OR lower(coalesce(f.email,'')) LIKE $1
               OR EXISTS (SELECT 1 FROM unnest(coalesce(f.former_names, '{}')) n WHERE lower(n) LIKE $1))))
         ORDER BY m.name LIMIT 20`, [`%${term}%`, bkkToday()]), serverSecret()]);
      res.json({ members: r.rows.map(m => ({ ref: memberRef(sec, m.id), name: m.name, hint: emailHint(m.email),
        passToday: m.pass_today })) });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.post('/api/bkk/teacher/members', async (req, res) => {
    const t = await teacherFrom(req);
    if (!t) return res.status(401).json({ error: 'bad passcode' });
    try {
      const { name, email } = req.body || {};
      if (!String(name || '').trim()) return res.status(400).json({ error: 'name required' });
      if (!String(email || '').includes('@')) {
        return res.status(400).json({ error: 'email required: the student signs in with it to see their photos' });
      }
      const m = await findOrCreateMember({ name, email });
      res.json({ success: true, member: { ref: memberRef(await serverSecret(), m.id), name: m.name } });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.get('/api/bkk/teacher/photos', async (req, res) => {
    const t = await teacherFrom(req);
    if (!t) return res.status(401).json({ error: 'bad passcode' });
    if (!cloudinary) return res.status(503).json({ error: 'photo storage not configured' });
    const date = isDate(req.query.date) ? req.query.date : ymd(bkkNow());
    try {
      res.json({ date, photos: await photosWithTags('p.class_date = $1', [date], true), othersVisible: await othersVisible() });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // The line at the top of /photos: how full Cloudinary is, and today's new photos against the cap.
  app.get('/api/bkk/teacher/photos/meter', async (req, res) => {
    const t = await teacherFrom(req);
    if (!t) return res.status(401).json({ error: 'bad passcode' });
    if (!cloudinary) return res.status(503).json({ error: 'photo storage not configured' });
    try { res.json(await photoMeter()); }
    catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.post('/api/bkk/teacher/photos', async (req, res) => {
    const t = await teacherFrom(req);
    if (!t) return res.status(401).json({ error: 'bad passcode' });
    if (!cloudinary) return res.status(503).json({ error: 'photo storage not configured' });
    try {
      const { date, image } = req.body || {};
      if (!isDate(date)) return res.status(400).json({ error: 'date required (YYYY-MM-DD)' });
      if (!/^data:image\/(jpeg|png|webp);base64,/.test(String(image || ''))) {
        return res.status(400).json({ error: 'image must be a JPEG, PNG or WebP data URL' });
      }
      if (!r2 && typeof cloudinary.config === 'function' && !cloudinary.config().api_secret) {
        return res.status(503).json({ error: 'Photo storage key is missing in Railway. Nothing was saved: tell Boonchu.' });
      }
      if (r2) {
        const buf = Buffer.from(image.slice(image.indexOf(',') + 1), 'base64');
        return res.json({ success: true, photo: await storeR2(t, date, [async () => buf], await tagsFrom(req.body), null) });
      }
      const full = await photoCapHit();
      if (full) return res.status(429).json({ error: full, cap: true });
      res.json({ success: true, photo: await storePhoto(t, date, image, await tagsFrom(req.body), null) });
    } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });

  // Cloudinary answers some refusals (403: plan limit reached, account paused)
  // with no readable message, so the team saw only "unexpected status code -
  // 403". Say what it means, with the plan usage when Cloudinary will tell us.
  async function cloudUpload(file, opts) {
    try {
      return await cloudinary.uploader.upload(file, { type: 'authenticated', resource_type: 'image', ...opts });
    } catch (e) {
      const err = e && e.error ? e.error : e;
      if (err && err.http_code === 403) {
        let usage = '';
        try {
          const u = await cloudinary.api.usage();
          if (u && u.credits) usage = ` Cloudinary plan usage: ${u.credits.usage} of ${u.credits.limit} credits (${u.credits.used_percent}%).`;
        } catch (_) { /* usage is a bonus */ }
        throw new Error('Cloudinary refused to store the photo (403). Check cloudinary.com: Error Reports shows the reason (API key without upload rights, plan limit, or paused account).' + usage);
      }
      throw new Error((err && err.message) || String(e));
    }
  }

  async function storePhoto(t, date, image, tags, driveId) {
    const up = await cloudUpload(image, { folder: `aybkk/profile/${date}`,
      transformation: [{ width: 2048, height: 2048, crop: 'limit', quality: 'auto:best' }] });
    const photo = (await q(
      `INSERT INTO bkk_photos (public_id,class_date,width,height,uploaded_by,drive_id)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [up.public_id, date, up.width || null, up.height || null, t.id, driveId])).rows[0];
    await addTags([photo.id], tags);
    return (await photosWithTags('p.id = $1', [photo.id], true))[0];
  }

  // ── class photos in R2 (lib/r2.js) ────────────────────────────────────────
  // sources: functions that fetch the photo, best first; the first one that can
  // be read is kept. The row goes in only once both copies are stored.
  async function r2Made(sources, none) {
    let why = null;
    for (const src of sources) {
      const buf = await src().catch(() => null);
      if (!buf) continue;
      try { return await r2lib.photoVariants(buf); } catch (e) { why = e; }
    }
    throw Object.assign(new Error(why ? why.message : none), { status: why ? why.status || 502 : 502 });
  }
  async function r2Put(day, key, made) {
    await r2.put(r2lib.objectKey(day, key, 'v'), made.v, 'image/jpeg');
    await r2.put(r2lib.objectKey(day, key, 't'), made.t, 'image/webp');
  }
  // Best effort: a copy left behind is never shown (no row signs a link to it), only stored.
  async function r2Drop(day, key) {
    if (!r2) return console.warn('[bkk photos] R2 is off: a photo\'s copies stay in R2');
    for (const kind of ['v', 't']) {
      await r2.del(r2lib.objectKey(day, key, kind)).catch(e => console.warn('[bkk photos] R2 copy not removed:', e.message));
    }
  }
  async function storeR2(t, date, sources, tags, driveId, none = 'The photo could not be read.') {
    const made = await r2Made(sources, none);
    const key = crypto.randomBytes(12).toString('hex');
    await r2Put(date, key, made);
    let photo;
    try {
      photo = (await q(
        `INSERT INTO bkk_photos (public_id,class_date,width,height,uploaded_by,drive_id,store,r2_key)
         VALUES ($1,$2,$3,$4,$5,$6,'r2',$7) RETURNING id`,
        [`r2/${date}/${key}`, date, made.width, made.height, t.id, driveId, key])).rows[0];
    } catch (e) { await r2Drop(date, key); throw e; }
    await addTags([photo.id], tags);
    return (await photosWithTags('p.id = $1', [photo.id], true))[0];
  }

  // ── photos straight from the Drive day folder (Boonchu, 5 Oct) ────────────
  // Chay's camera folder is "Daily Class Photos/Videos › photos › 3Oct26 …" and
  // is link-shared, so the server lists it through Drive's public folder view and
  // downloads files by id: no Google login, no file ever passes through a phone.
  // Only files listed in that day's folder can be imported, so this is not an
  // open proxy for any Drive file.
  const DRIVE_ROOT = process.env.DRIVE_PHOTOS_FOLDER || '10A--d5dX4cGrt9M4deNod-zzEDJP_R90';
  const MON = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
  const IMG = /\.(jpe?g|png|webp|heic)$/i;
  const unent = s => s.replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
  async function driveList(folderId) {
    const r = await httpFetch(`https://drive.google.com/embeddedfolderview?id=${encodeURIComponent(folderId)}`,
      { signal: AbortSignal.timeout(20000) });
    if (!r.ok) throw new Error(`Drive folder could not be read (${r.status}). Is it still shared by link?`);
    const html = await r.text();
    const out = [];
    const re = /class="flip-entry" id="entry-([\w-]+)"[\s\S]*?<a href="([^"]+)"[\s\S]*?class="flip-entry-title">([^<]*)</g;
    for (let m; (m = re.exec(html));) out.push({ id: m[1], name: unent(m[3]), folder: m[2].includes('/folders/') });
    return out;
  }
  // "3Oct26", "03 Oct 2026", "3October26" → 2026-10-03
  function folderDate(name) {
    const m = String(name).match(/^(\d{1,2})\s*([A-Za-z]{3})[A-Za-z]*\s*(\d{4}|\d{2})\b/);
    if (!m || !MON[m[2].toLowerCase()]) return null;
    const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    return `${y}-${String(MON[m[2].toLowerCase()]).padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  }
  // M picks the day folder himself from the "photos" folder (Boonchu, 5 Oct);
  // only folders directly inside it can be opened.
  const driveCache = new Map();          // folder id -> { at, files }
  async function driveFolders() {
    const days = (await driveList(DRIVE_ROOT)).filter(e => e.folder).map(e => ({ id: e.id, name: e.name, date: folderDate(e.name) }));
    return days.sort((a, b) => (b.date || '').localeCompare(a.date || '') || a.name.localeCompare(b.name));
  }
  async function driveFolder(folderId, fresh) {
    const hit = driveCache.get(folderId);
    if (hit && !fresh && Date.now() - hit.at < 10 * 60e3) return hit.files;
    if (!(await driveFolders()).some(d => d.id === folderId)) throw Object.assign(new Error('That folder is not inside the Drive "photos" folder.'), { status: 400 });
    const files = [];
    for (const e of await driveList(folderId)) {
      if (e.folder) {          // one level down: "3Oct26LedP" and the like
        for (const f of await driveList(e.id)) if (!f.folder && IMG.test(f.name)) files.push({ ...f, sub: e.name });
      } else if (IMG.test(e.name)) files.push(e);
    }
    files.sort((a, b) => (a.sub || '').localeCompare(b.sub || '') || a.name.localeCompare(b.name, undefined, { numeric: true }));
    driveCache.set(folderId, { at: Date.now(), files });
    return files;
  }
  // RIFF alone is also WAV and AVI, and ftyp alone is also MP4, MOV and AVIF:
  // WebP and HEIC need their own marks too.
  const HEIF_BRANDS = new Set(['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'mif1', 'msf1']);
  const sniff = b => {
    const at = (i, j) => b.subarray(i, j).toString('latin1');
    return b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF ? 'image/jpeg'
      : b[0] === 0x89 && at(1, 4) === 'PNG' ? 'image/png'
      : at(0, 4) === 'RIFF' && at(8, 12) === 'WEBP' ? 'image/webp'
      : at(4, 8) === 'ftyp' && HEIF_BRANDS.has(at(8, 12)) ? 'image/heic' : null;
  };

  app.get('/api/bkk/teacher/drive/folders', async (req, res) => {
    const t = await teacherFrom(req);
    if (!t) return res.status(401).json({ error: 'bad passcode' });
    try { res.json({ folders: await driveFolders() }); }
    catch (e) { res.status(502).json({ error: e.message }); }
  });

  app.get('/api/bkk/teacher/drive', async (req, res) => {
    const t = await teacherFrom(req);
    if (!t) return res.status(401).json({ error: 'bad passcode' });
    try {
      const files = await driveFolder(String(req.query.folder || ''), req.query.fresh === '1');
      // tagged: how many people are on it, so the page can grey a done photo from any class date.
      const done = files.length ? (await q(`SELECT p.id, p.drive_id, count(pm.member_id)::int AS tagged
          FROM bkk_photos p LEFT JOIN bkk_photo_members pm ON pm.photo_id = p.id
          WHERE p.drive_id = ANY($1) GROUP BY p.id`, [files.map(f => f.id)])).rows : [];
      const byDrive = new Map(done.map(r => [r.drive_id, r]));
      res.json({ files: files.map(f => {
        const d = byDrive.get(f.id);
        return { id: f.id, name: f.name, sub: f.sub || '', photoId: d ? d.id : null, tagged: d ? d.tagged : 0 };
      }) });
    } catch (e) { res.status(e.status || 502).json({ error: e.message }); }
  });

  const grab = async (url, maxBytes) => {
    const r = await httpFetch(url, { signal: AbortSignal.timeout(60000) });
    if (maxBytes && Number(r.headers.get('content-length')) > maxBytes) { r.body?.cancel().catch(() => {}); return null; }
    const b = Buffer.from(await r.arrayBuffer());
    return r.ok && sniff(b) && !(maxBytes && b.length > maxBytes) ? b : null;
  };
  const DRIVE_ORIGINAL_MAX = 60 * 1024 * 1024;
  const driveSources = driveId => {
    const id = encodeURIComponent(driveId);
    return [() => grab(`https://drive.google.com/uc?export=download&id=${id}`, DRIVE_ORIGINAL_MAX),
      () => grab(`https://drive.google.com/thumbnail?id=${id}&sz=s2048`)];
  };

  app.post('/api/bkk/teacher/photos/from-drive', async (req, res) => {
    const t = await teacherFrom(req);
    if (!t) return res.status(401).json({ error: 'bad passcode' });
    if (!cloudinary) return res.status(503).json({ error: 'photo storage not configured' });
    try {
      const { date, folder, driveId, add } = req.body || {};
      if (!isDate(date)) return res.status(400).json({ error: 'date required (YYYY-MM-DD)' });
      if (!(await driveFolder(String(folder || ''))).some(f => f.id === driveId)) {
        return res.status(400).json({ error: 'That file is not in the chosen Drive folder.' });
      }
      const tags = await tagsFrom(req.body || {});
      const had = (await q('SELECT id FROM bkk_photos WHERE drive_id=$1', [driveId])).rows[0];
      if (had) {               // already in: set who is in it (add: keep who is there)
        await (add ? addTags([had.id], tags) : setTags(had.id, tags, !tags.given));
        return res.json({ success: true, photo: (await photosWithTags('p.id = $1', [had.id], true))[0] });
      }
      if (r2) {
        // The camera original makes the sharp 2560 px copy; Drive's 2048 px JPEG when the
        // original cannot be had or read here (a HEIC, too big). No daily limit: not Cloudinary.
        return res.json({ success: true, photo: await storeR2(t, date, driveSources(driveId), tags, driveId,
          'Drive did not send a photo. Is the folder still shared by link?') });
      }
      if (typeof cloudinary.config === 'function' && !cloudinary.config().api_secret) {
        return res.status(503).json({ error: 'Photo storage key is missing in Railway. Nothing was saved: tell Boonchu.' });
      }
      const full = await photoCapHit();
      if (full) return res.status(429).json({ error: full, cap: true });
      // Ask Drive for a 2048px copy (about 0.5 MB, the size we keep anyway) rather
      // than the 5 MB camera original: smaller to send and store. Original if that fails.
      const id = encodeURIComponent(driveId);
      const buf = await grab(`https://drive.google.com/thumbnail?id=${id}&sz=s2048`)
        || await grab(`https://drive.google.com/uc?export=download&id=${id}`);
      const type = buf && sniff(buf);
      if (!type) return res.status(502).json({ error: 'Drive did not send a photo. Is the folder still shared by link?' });
      const photo = await storePhoto(t, date, `data:${type};base64,${buf.toString('base64')}`, tags, driveId);
      res.json({ success: true, photo });
    } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });

  // Replace who is in a photo.
  app.post('/api/bkk/teacher/photos/:id/tags', async (req, res) => {
    const t = await teacherFrom(req);
    if (!t) return res.status(401).json({ error: 'bad passcode' });
    if (!cloudinary) return res.status(503).json({ error: 'photo storage not configured' });
    try {
      const p = (await q('SELECT id FROM bkk_photos WHERE id=$1', [req.params.id])).rows[0];
      if (!p) return res.status(404).json({ error: 'photo not found' });
      const tags = await tagsFrom(req.body || {});
      await setTags(p.id, tags, !tags.given);
      res.json({ success: true, photo: (await photosWithTags('p.id = $1', [p.id], true))[0] });
    } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });

  // Pick many photos of one person, then the name once (Boonchu, 8 Oct): the
  // name is ADDED to each photo, so other people already on a photo stay.
  // role says how they are in these photos: main (the default) or other.
  app.post('/api/bkk/teacher/photos/tags/add', async (req, res) => {
    const t = await teacherFrom(req);
    if (!t) return res.status(401).json({ error: 'bad passcode' });
    try {
      const b = req.body || {};
      const photoIds = [...new Set((Array.isArray(b.photoIds) ? b.photoIds : []).map(Number))]
        .filter(n => Number.isInteger(n) && n > 0);
      if (!photoIds.length || photoIds.length > 200) return res.status(400).json({ error: 'choose 1 to 200 photos' });
      const tags = await tagsFrom(b);
      if (!tags.ids.length) return res.status(400).json({ error: 'choose who is in them' });
      const found = (await q('SELECT id FROM bkk_photos WHERE id = ANY($1::int[])', [photoIds])).rows.map(r => r.id);
      if (found.length < photoIds.length) return res.status(409).json({ error: 'A photo was deleted meanwhile. Reload the page.' });
      await addTags(photoIds, tags);
      res.json({ success: true, photos: await photosWithTags('p.id = ANY($1::int[])', [photoIds], true) });
    } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });

  app.post('/api/bkk/teacher/photos/:id/delete', async (req, res) => {
    const t = await teacherFrom(req);
    if (!t) return res.status(401).json({ error: 'bad passcode' });
    if (!cloudinary) return res.status(503).json({ error: 'photo storage not configured' });
    try {
      const p = (await q(`DELETE FROM bkk_photos WHERE id=$1 RETURNING public_id, store, r2_key, to_char(class_date,'YYYY-MM-DD') AS day`,
        [req.params.id])).rows[0];
      if (!p) return res.status(404).json({ error: 'photo not found' });
      if (p.store === 'r2') await r2Drop(p.day, p.r2_key);
      else await cloudinary.uploader.destroy(p.public_id, { type: 'authenticated', invalidate: true }).catch(() => {});
      res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // One student's photos, for Chay: how many, how many of them are about this
  // student, and when. Photo data only: no pass, payment or visit.
  app.get('/api/bkk/teacher/members/:code/photos', async (req, res) => {
    const t = await teacherFrom(req);
    if (!t) return res.status(401).json({ error: 'bad passcode' });
    if (!cloudinary) return res.status(503).json({ error: 'photo storage not configured' });
    try {
      const m = await memberByKey(req.params.code);
      if (!m) return res.status(404).json({ error: 'student not found' });
      const byRef = REF_RE.test(req.params.code);
      const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 60, 1), 200);
      const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
      const TAGS = 'FROM bkk_photo_members pm JOIN bkk_photos p ON p.id = pm.photo_id WHERE pm.member_id = $1';
      const MAIN = `FILTER (WHERE pm.role = 'main')`;
      const [totals, months, photos] = await Promise.all([
        q(`SELECT count(*)::int AS photos, count(*) ${MAIN}::int AS main, count(*) FILTER (WHERE pm.role <> 'main')::int AS other,
             count(DISTINCT p.class_date)::int AS mornings,
             to_char(min(p.class_date),'YYYY-MM-DD') AS first, to_char(max(p.class_date),'YYYY-MM-DD') AS last,
             to_char(max(p.class_date) ${MAIN},'YYYY-MM-DD') AS "lastMain",
             (now() AT TIME ZONE 'Asia/Bangkok')::date - max(p.class_date) ${MAIN} AS "lastMainDays" ${TAGS}`, [m.id]),
        q(`SELECT to_char(p.class_date,'YYYY-MM') AS month, count(*) ${MAIN}::int AS main,
             count(*) FILTER (WHERE pm.role <> 'main')::int AS other ${TAGS} GROUP BY 1 ORDER BY 1 DESC`, [m.id]),
        q(`SELECT p.id, p.public_id, p.store, p.r2_key, p.drive_id, to_char(p.class_date,'YYYY-MM-DD') AS date, pm.role ${TAGS}
           ORDER BY p.class_date DESC, (pm.role <> 'main'), p.id DESC LIMIT $2 OFFSET $3`, [m.id, limit, offset]),
      ]);
      res.json({ member: { ...(byRef ? { ref: req.params.code } : { code: m.code }), name: m.name, hint: emailHint(m.email) },
        totals: totals.rows[0], months: months.rows, limit, offset,
        photos: photos.rows.map(p => ({ id: p.id, date: p.date, role: p.role, thumb: photoLink(p, 'thumb'),
          ...(p.drive_id ? { drive: p.drive_id } : {}) })) });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // A student's own photos, newest day first. The member code is what the
  // signed-in browser already holds; nobody else's photos can come back here.
  // Only the photos they are main in, unless photos_others_visible is on: then
  // the ones they are in the frame of follow, after the main ones of that day.
  app.get('/api/bkk/me/:code/photos', async (req, res) => {
    if (!cloudinary) return res.json({ days: [] });
    try {
      const m = await memberByCode(req.params.code);
      if (!m) return res.status(404).json({ error: 'not found' });
      const photos = await photosWithTags(
        `p.id IN (SELECT photo_id FROM bkk_photo_members WHERE member_id = $1 AND (role = 'main' OR $2::boolean))`,
        [m.id, await othersVisible()]);
      const byDay = new Map();           // date -> [photos they are main in, the others]
      const mine = memberRef(await serverSecret(), m.id);
      for (const ph of photos.reverse()) {
        if (!byDay.has(ph.date)) byDay.set(ph.date, [[], []]);
        const main = ph.members.some(x => x.ref === mine && x.role === 'main');
        byDay.get(ph.date)[main ? 0 : 1].push({ id: ph.id, thumb: ph.thumb, full: ph.full, save: ph.save });
      }
      res.json({ days: [...byDay.entries()].sort((a, b) => b[0].localeCompare(a[0]))
        .map(([date, [main, other]]) => ({ date, items: [...main, ...other] })) });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // "Save photo" on My photos: the stored JPEG as a file, fetched here with no
  // transformation, so no copy is made per download. The link is the key (a
  // download sends no header); a deleted photo stops at once. An unknown id is
  // 403 like a bad signature, so which ids exist cannot be probed.
  app.get('/api/bkk/photo/:t/AYBKK-photo.jpg', async (req, res) => {
    const m = /^([1-9]\d{0,9})\.([\w-]{22})$/.exec(req.params.t);
    if (!m) return res.status(404).json({ error: 'not found' });
    if (!cloudinary) return res.status(503).json({ error: 'photo storage not configured' });
    const file = { 'Content-Disposition': 'attachment; filename="AYBKK-photo.jpg"',
      'Cache-Control': 'private, max-age=86400', 'X-Content-Type-Options': 'nosniff' };
    try {
      const row = (await q(`SELECT public_id, store, r2_key, to_char(class_date,'YYYY-MM-DD') AS day FROM bkk_photos WHERE id=$1`,
        [Number(m[1])])).rows[0];
      const want = Buffer.from(saveSig(m[1], row ? row.public_id : '')), got = Buffer.from(m[2]);
      if (!row || want.length !== got.length || !crypto.timingSafeEqual(want, got)) return res.status(403).json({ error: 'bad link' });
      // A HEAD (a link check) gets the headers without pulling the photo from Cloudinary.
      if (req.method === 'HEAD') return res.set({ ...file, 'Content-Type': 'image/jpeg' }).end();
      // In R2: its v.jpg, the same link and file name, so a page open from before a move still saves.
      if (row.store === 'r2') {
        if (!r2) return res.status(503).json({ error: 'photo storage not configured' });
        const r = await r2.get(r2lib.objectKey(row.day, row.r2_key, 'v'));
        if (!r) return res.status(404).json({ error: 'photo not available' });
        return res.set({ ...file, 'Content-Type': 'image/jpeg' }).send(Buffer.from(await r.arrayBuffer()));
      }
      const r = await httpFetch(photoUrl(row.public_id, 'full'), { signal: AbortSignal.timeout(30000) });
      const buf = r.ok ? Buffer.from(await r.arrayBuffer()) : null;
      const type = buf && sniff(buf);
      if (!type) return res.status(r.status === 404 ? 404 : 502).json({ error: 'photo not available' });
      res.set({ ...file, 'Content-Type': type }).send(buf);
    } catch (e) { res.status(502).json({ error: 'photo not available' }); }
  });

  // ── /ph: class photos in R2, served by this site ──────────────────────────
  // Not under /api, and cacheable: the link is the key (signed, never ending, as the
  // Cloudinary links were), so Cloudflare's edge in front of aybkk.net may keep the
  // bytes. One day at most, in browsers and at the edge alike: a deleted photo must
  // stop being served within a day, and nothing here empties Cloudflare's cache.
  // No cookie is set on these answers (Cloudflare would not keep them), and an
  // error is never kept. An unknown id is 403 like a bad signature. Only while R2
  // is on: with it off, /ph is not a route here, as before.
  const PH_FILES = { 't.webp': ['t', 'image/webp'], 'v.jpg': ['v', 'image/jpeg'], 'p.jpg': ['p', 'image/jpeg'] };
  if (r2) app.get('/ph/:t/:f', async (req, res) => {
    const no = (status, error) => res.status(status).set('Cache-Control', 'no-store').json({ error });
    const m = /^([1-9]\d{0,9})\.([\w-]{22})$/.exec(req.params.t), f = PH_FILES[req.params.f];
    if (!m || !f) return no(404, 'not found');
    const [kind, type] = f;
    try {
      const row = (await q(`SELECT r2_key, to_char(class_date,'YYYY-MM-DD') AS day FROM bkk_photos WHERE id=$1 AND store='r2'`,
        [Number(m[1])])).rows[0];
      const want = Buffer.from(r2lib.phSig(m[1], row ? row.r2_key : '', kind)), got = Buffer.from(m[2]);
      if (!row || want.length !== got.length || !crypto.timingSafeEqual(want, got)) return no(403, 'bad link');
      const key = r2lib.objectKey(row.day, row.r2_key, kind);       // p.jpg is made from t.webp
      const head = { 'Content-Type': type, 'Cache-Control': 'public, max-age=86400, s-maxage=86400', 'X-Content-Type-Options': 'nosniff' };
      if (req.method === 'HEAD') {
        const h = await r2.head(key);
        if (!h) return no(404, 'photo not available');
        return res.set(kind === 'p' ? head : { ...head, 'Content-Length': String(h.size) }).end();
      }
      const r = await r2.get(key);
      if (!r) return no(404, 'photo not available');
      if (kind === 'p') return res.set(head).send(await r2lib.tileJpeg(Buffer.from(await r.arrayBuffer())));
      const size = r.headers.get('content-length');
      res.set(size ? { ...head, 'Content-Length': size } : head);
      pipeline(Readable.fromWeb(r.body), res, () => {});
    } catch (e) {
      console.warn('[bkk photos] /ph not served:', e.message);
      if (!res.headersSent) no(502, 'photo not available');
    }
  });

  // ── Admin, Settings, "Photo storage" ──────────────────────────────────────
  // Photo counts only, for staff. The test writes, reads back and deletes one
  // small object under test/ and says OK or R2's refusal; never a key.
  app.get('/api/bkk/admin/photo-store', async (req, res) => {
    if (!isAdmin(req)) return res.status(401).json({ error: 'bad key' });
    res.set('Cache-Control', 'private, no-store');
    try {
      const c = (await q(`SELECT count(*) FILTER (WHERE store = 'r2')::int AS r2,
          count(*) FILTER (WHERE store = 'cloudinary')::int AS cloudinary FROM bkk_photos`)).rows[0];
      res.json({ r2: !!r2, photos: { cloudinary: c.cloudinary, r2: c.r2 }, move: await moveState() });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
  app.post('/api/bkk/admin/photo-store/test', async (req, res) => {
    if (!isAdmin(req)) return res.status(401).json({ error: 'bad key' });
    if (!r2) return res.json({ ok: false, error: `R2 is not set up: ${r2lib.R2_VARS.join(', ')} are needed in Railway.` });
    const t0 = Date.now(), key = `test/${crypto.randomBytes(8).toString('hex')}.txt`;
    const body = Buffer.from(`AYBKK R2 test ${new Date().toISOString()}`);
    try {
      await r2.put(key, body, 'text/plain');
      let back = null;
      try {
        const r = await r2.get(key);
        back = r ? Buffer.from(await r.arrayBuffer()) : null;
      } finally { await r2.del(key); }
      if (!back || !back.equals(body)) throw new Error('R2 sent back something other than what was stored');
      res.json({ ok: true, ms: Date.now() - t0 });
    } catch (e) { res.json({ ok: false, error: e.message }); }
  });

  // ── moving the Cloudinary class photos to R2 (off until Start) ────────────
  // One photo at a time, 3 a minute: the Drive original when the photo came from
  // Drive (else Drive's 2048 px copy), else the JPEG stored on Cloudinary, which
  // makes no new copy there. Both R2 copies are checked (size, and MD5 when R2
  // gives one) before the row switches in one update, and only then is the
  // Cloudinary asset destroyed. A failure leaves the photo on Cloudinary as it
  // was and is listed with its reason; the next Start after the end of a pass
  // tries those again. Same photo id, so who is on it does not change.
  // The place reached is kept in bkk_settings: it never starts by itself, but
  // once started it goes on after a restart, until done or Stop.
  const MOVE_KEY = 'photo_r2_move', MOVE_EVERY_MS = 20000;
  const moveState = async () => ({ on: false, after: 0, moved: 0, failedN: 0, failed: [], cloudLeft: 0,
    ...((await getSetting(MOVE_KEY, null)) || {}) });
  // A step can switch it off (done) but not back on: Stop pressed while a photo was moving holds.
  const saveMove = (s, plain) => q(`INSERT INTO bkk_settings (key,value,updated_at) VALUES ($1,$2::jsonb,now())
    ON CONFLICT (key) DO UPDATE SET updated_at=now(), value = EXCLUDED.value${plain ? ''
      : ` || jsonb_build_object('on', (EXCLUDED.value->>'on')::boolean AND coalesce((bkk_settings.value->>'on')::boolean, false))`}`,
  [MOVE_KEY, JSON.stringify(s)]);
  const errText = e => String((e && (e.message || (e.error && e.error.message))) || e).slice(0, 200);
  async function moveOne() {
    const s = await moveState();
    if (!s.on || !r2 || !cloudinary) return { ...s, on: false };
    const at = new Date(nowMs()).toISOString();
    const p = (await q(`SELECT id, public_id, drive_id, to_char(class_date,'YYYY-MM-DD') AS day FROM bkk_photos
      WHERE store = 'cloudinary' AND id > $1 ORDER BY id LIMIT 1`, [s.after])).rows[0];
    if (!p) { Object.assign(s, { on: false, done: true, at }); await saveMove(s); return s; }
    const key = crypto.randomBytes(12).toString('hex');
    let sent = false;
    try {
      const made = await r2Made([...(p.drive_id ? driveSources(p.drive_id) : []), () => grab(photoUrl(p.public_id, 'full'))],
        'Neither Drive nor Cloudinary sent the photo.');
      sent = true;
      await r2Put(p.day, key, made);
      for (const kind of ['v', 't']) {
        const h = await r2.head(r2lib.objectKey(p.day, key, kind)), b = made[kind];
        if (!h || h.size !== b.length || (/^[0-9a-f]{32}$/.test(h.etag) && h.etag !== crypto.createHash('md5').update(b).digest('hex'))) {
          throw new Error(`R2 does not hold the ${kind === 'v' ? 'photo' : 'tile'} as it was sent`);
        }
      }
      const moved = (await q(`UPDATE bkk_photos SET store='r2', r2_key=$2, width=$3, height=$4
        WHERE id=$1 AND store='cloudinary' RETURNING id`, [p.id, key, made.width, made.height])).rows[0];
      if (!moved) await r2Drop(p.day, key);              // deleted meanwhile
      else {
        s.moved++;
        try {
          const d = await cloudinary.uploader.destroy(p.public_id, { type: 'authenticated', invalidate: true });
          if (!d || !['ok', 'not found'].includes(d.result)) throw new Error(`Cloudinary answered ${d && d.result}`);
        } catch (e) { s.cloudLeft++; s.cloudWhy = `#${p.id}: ${errText(e)}`; }
      }
    } catch (e) {
      if (sent) await r2Drop(p.day, key);
      s.failedN++;
      s.failed = [{ id: p.id, why: errText(e), at }, ...s.failed].slice(0, 20);
    }
    Object.assign(s, { after: p.id, at });
    await saveMove(s);
    return s;
  }
  let moving = null, moveTimer = null;
  const moveStep = () => moving || (moving = moveOne().finally(() => { moving = null; }));
  function moveSoon(ms = MOVE_EVERY_MS) {
    clearTimeout(moveTimer);
    if (!timers) return;                 // a test steps by hand
    moveTimer = setTimeout(() => moveStep().then(s => { if (s.on) moveSoon(); },
      e => { console.error('[bkk photos] move step failed:', e.message); moveSoon(); }), ms);
    moveTimer.unref();
  }
  app.post('/api/bkk/admin/photo-store/move', async (req, res) => {
    if (!isAdmin(req)) return res.status(401).json({ error: 'bad key' });
    const on = (req.body || {}).on;
    if (typeof on !== 'boolean') return res.status(400).json({ error: 'on must be true or false' });
    if (on && (!r2 || !cloudinary)) return res.status(400).json({ error: r2 ? 'Cloudinary is not set up: nothing to move.' : 'R2 is not set up.' });
    try {
      const s = await moveState();
      if (on && !s.on) {
        // After a finished pass, a new one: the photos that failed are tried again.
        if (s.done || !s.startedAt) Object.assign(s, { after: 0, failed: [], failedN: 0, done: false, startedAt: new Date(nowMs()).toISOString() });
        s.on = true;
      } else if (!on) s.on = false;
      await saveMove(s, true);
      if (s.on) moveSoon(1000); else clearTimeout(moveTimer);
      res.json({ move: s });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ── the student's own face (Boonchu, 9 Nov 2026) ──────────────────────────
  // One square photo per student, for the round account button and for staff
  // lists, so the door can greet people by name. Private like class photos: an
  // "authenticated" Cloudinary asset under a random id (never the code or name).
  // Links to it are signed here and expire: Cloudinary's own signed links never
  // do (expiring ones are a paid plan), and this server is reachable from China
  // where Cloudinary is slow. A link carries the photo's id, size and expiry,
  // and works for 6 to 12 hours, the same link all the while so browsers cache it.
  // The member code is signed in as well (it is not in the link), so when staff
  // sign a profile out everywhere, the new code stops every link given out before.
  // /me (the member code) and the staff lists (admin key) hand links out, and so
  // do the check-in screens: Boonchu asked students to add a photo for check-in,
  // so a photo in a profile is shown there (20 Nov 2026). /teach (teacher
  // passcode) gets the small link for any student it opens (today's list, the
  // search, a typed code). The door tablet (door key) gets, for today's open
  // seats only, a link of its own (d): it names the tablet and ends with the
  // class, so it stops when the class ends and at once when the tablet is unpaired.
  const FACE_FOLDER = 'aybkk-profile';
  const FACE_MAX_BYTES = 6 * 1024 * 1024;
  const FACE_PER_DAY = 10;
  const FACE_TYPE = /^data:image\/(jpeg|png|webp|heic|heif);base64,/;
  const FACE_SIZES = {
    s: { width: 160, height: 160, crop: 'fill', gravity: 'face', quality: 'auto', fetch_format: 'jpg' },
    l: { width: 600, height: 600, crop: 'fill', gravity: 'face', quality: 'auto', fetch_format: 'jpg' },
    // The door's: sharp in the 150 px "Is this you?" circle on the tablet's 2x screen.
    d: { width: 320, height: 320, crop: 'fill', gravity: 'face', quality: 'auto', fetch_format: 'jpg' },
  };
  const FACE_STEP = 6 * 3600;
  const FACE_KEY = crypto.createHash('sha256').update('aybkk-face:' + (process.env.CLOUDINARY_API_SECRET
    || ADMIN_KEY || crypto.randomBytes(32).toString('hex'))).digest();
  const faceSig = s => crypto.createHmac('sha256', FACE_KEY).update(s).digest('base64url').slice(0, 22);
  const faceRef = photoId => String(photoId).split('/').pop();
  const faceSign = (photoId, kind, exp, code) => {
    const s = `${faceRef(photoId)}.${kind}.${exp}`;
    return `/api/bkk/face/${s}.${faceSig(`${s}.${code}`)}`;
  };
  const faceUrl = (photoId, code, size) => faceSign(photoId, size, (Math.floor(nowMs() / 1000 / FACE_STEP) + 2) * FACE_STEP, code);
  const faceLinks = (photoId, code) => photoId && cloudinary
    ? { small: faceUrl(photoId, code, 's'), large: faceUrl(photoId, code, 'l') } : null;
  const faceSmall = (photoId, code) => photoId && cloudinary ? faceUrl(photoId, code, 's') : null;
  const doorFace = (photoId, code, dev, endMs) => photoId && cloudinary ? faceSign(photoId, `d${dev}`, Math.ceil(endMs / 1000), code) : null;
  const destroyFace = async id => {
    try {
      if (!cloudinary) throw new Error('photo storage not configured');
      const r = await cloudinary.uploader.destroy(id, { type: 'authenticated', invalidate: true });
      if (r && r.error) throw new Error(r.error.message || String(r.error));
      return true;
    } catch (e) {
      console.warn(`[bkk face] could not delete ${id}:`, (e && e.message) || e);
      return false;
    }
  };
  // A photo that could not be deleted (Cloudinary down or not set up) waits in
  // bkk_face_orphans and is tried again at boot, once a day and after the next
  // photo is stored, so a removed or replaced face never stays in storage for good.
  const dropFace = async id => {
    if (await destroyFace(id)) return;
    await q(`INSERT INTO bkk_face_orphans (photo_id) VALUES ($1)
             ON CONFLICT (photo_id) DO UPDATE SET tries = bkk_face_orphans.tries + 1`, [id])
      .catch(e => console.error(`[bkk face] could not note ${id} to delete later:`, e.message));
  };
  const sweepFaces = async () => {
    if (!cloudinary) return;
    try {
      const left = (await q(`SELECT photo_id FROM bkk_face_orphans
        WHERE photo_id NOT IN (SELECT photo_id FROM bkk_members WHERE photo_id IS NOT NULL)
        ORDER BY since LIMIT 100`)).rows;
      for (const { photo_id: id } of left) {
        await q(await destroyFace(id) ? 'DELETE FROM bkk_face_orphans WHERE photo_id=$1'
          : 'UPDATE bkk_face_orphans SET tries = tries + 1 WHERE photo_id=$1', [id]);
      }
    } catch (e) { console.error('[bkk face] sweep failed:', e.message); }
  };
  setInterval(sweepFaces, 24 * 3600 * 1000).unref();
  // Swaps the member's photo in one statement and returns the one it replaced,
  // so two uploads at once each delete the right old asset.
  const swapFace = (where, args, photoId) => q(
    `UPDATE bkk_members m SET photo_id=$${args.length + 1}, photo_at=${photoId ? 'now()' : 'NULL'}
     FROM (SELECT id, photo_id AS old FROM bkk_members WHERE ${where} FOR UPDATE) o
     WHERE m.id=o.id RETURNING o.old`, [...args, photoId]);
  const BKK_DAY = `(now() AT TIME ZONE 'Asia/Bangkok')::date`;

  app.post('/api/bkk/me/:code/photo', async (req, res) => {
    if (!cloudinary) return res.status(503).json({ error: 'photo storage not configured' });
    try {
      const m = await memberByCode(req.params.code);
      if (!m) return res.status(404).json({ error: 'not found' });
      const img = String((req.body || {}).imageBase64 || '');
      const head = FACE_TYPE.exec(img);
      if (!head) return res.status(400).json({ error: 'not a photo: send a JPEG, PNG, WebP or HEIC image' });
      const b64 = img.slice(head[0].length);
      if (b64.length * 3 / 4 > FACE_MAX_BYTES) return res.status(413).json({ error: 'photo too big: 6 MB at most' });
      // The bytes must be the type the label says: a WAV or MP4 called a JPEG never reaches storage.
      if (sniff(Buffer.from(b64.slice(0, 32), 'base64')) !== `image/${head[1] === 'heif' ? 'heic' : head[1]}`) {
        return res.status(400).json({ error: 'not a photo' });
      }
      if (typeof cloudinary.config === 'function' && !cloudinary.config().api_secret) {
        return res.status(503).json({ error: 'photo storage not configured' });
      }
      const tried = await q(
        `UPDATE bkk_members SET photo_tries = CASE WHEN photo_tries_on = ${BKK_DAY} THEN photo_tries + 1 ELSE 1 END,
           photo_tries_on = ${BKK_DAY}
         WHERE id=$1 AND (photo_tries_on IS DISTINCT FROM ${BKK_DAY} OR photo_tries < $2) RETURNING photo_tries`,
        [m.id, FACE_PER_DAY]);
      if (!tried.rows.length) return res.status(429).json({ error: `${FACE_PER_DAY} photos a day at most: try again tomorrow` });
      let up;
      try {
        up = await cloudUpload(img, { folder: FACE_FOLDER, public_id: crypto.randomBytes(12).toString('hex'),
          overwrite: false, transformation: [{ width: 600, height: 600, crop: 'fill', gravity: 'face', quality: 'auto:good' }] });
      } catch (e) {
        console.error('[bkk face] upload failed:', e.message);
        return res.status(502).json({ error: 'could not store the photo: try again later' });
      }
      let swapped;
      try { swapped = (await swapFace('id=$1', [m.id], up.public_id)).rows[0]; }
      catch (e) { await dropFace(up.public_id); throw e; }
      if (!swapped) { await dropFace(up.public_id); return res.status(404).json({ error: 'not found' }); }
      if (swapped.old && swapped.old !== up.public_id) await dropFace(swapped.old);
      res.json({ success: true, photo: faceLinks(up.public_id, m.code) });
      sweepFaces();
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.post('/api/bkk/me/:code/photo/remove', async (req, res) => {
    try {
      const m = await memberByCode(req.params.code);
      const r = m && (await swapFace('id=$1', [m.id], null)).rows[0];
      if (!r) return res.status(404).json({ error: 'not found' });
      if (r.old) await dropFace(r.old);
      res.json({ success: true, photo: null });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // The link itself is the key: an <img> sends no header. A removed or
  // replaced photo stops at once, whatever its links say, and so does every
  // link from before the member code changed. A door link (d<tablet>) ends on
  // the class clock, and stops once that tablet is unpaired.
  app.get('/api/bkk/face/:t', async (req, res) => {
    const m = /^([0-9a-f]{24})\.([sl]|d[1-9]\d{0,8})\.(\d{9,11})\.([\w-]{22})$/.exec(req.params.t);
    if (!m) return res.status(404).json({ error: 'not found' });
    const [, ref, kind, exp, sig] = m;
    const door = kind[0] === 'd';
    if (!cloudinary) return res.status(503).json({ error: 'photo storage not configured' });
    try {
      const row = (await q('SELECT photo_id, code FROM bkk_members WHERE photo_id = ANY($1::text[]) LIMIT 1',
        [[`${FACE_FOLDER}/${ref}`, ref]])).rows[0];
      if (!row) return res.status(404).json({ error: 'not found' });
      const want = Buffer.from(faceSig(`${ref}.${kind}.${exp}.${row.code}`)), got = Buffer.from(sig);
      if (want.length !== got.length || !crypto.timingSafeEqual(want, got)) return res.status(403).json({ error: 'bad link' });
      const left = Number(exp) - Math.floor((door ? bkkNow().getTime() : nowMs()) / 1000);
      if (left <= 0 || left > 2 * FACE_STEP) return res.status(410).json({ error: 'link expired' });
      if (door && !(await q('SELECT 1 FROM bkk_door_devices WHERE id=$1 AND revoked_at IS NULL', [Number(kind.slice(1))])).rows.length) {
        return res.status(410).json({ error: 'link expired' });
      }
      const r = await httpFetch(cloudinary.url(row.photo_id, { type: 'authenticated', sign_url: true, secure: true,
        transformation: [FACE_SIZES[kind[0]]] }), { signal: AbortSignal.timeout(15000) });
      const buf = r.ok ? Buffer.from(await r.arrayBuffer()) : null;
      const type = buf && sniff(buf);
      if (!type) return res.status(r.status === 404 ? 404 : 502).json({ error: 'photo not available' });
      res.set({ 'Content-Type': type, 'Cache-Control': `private, max-age=${left}`, 'X-Content-Type-Options': 'nosniff' })
        .send(buf);
    } catch (e) { res.status(502).json({ error: 'photo not available' }); }
  });

  // Admin manages who is on the team. Passcodes are shown once, at creation —
  // they are stored hashed, so a forgotten one is reset, never recovered.
  // Admin may type one instead of taking a random one (Boonchu, 2 Oct): at least
  // 8 characters, and never one someone else on the team already uses, since
  // teacherFrom() finds a person by passcode alone.
  async function choosePasscode(wanted, exceptId) {
    if (wanted == null || String(wanted).trim() === '') {
      return { passcode: crypto.randomBytes(6).toString('base64url') };
    }
    const pc = String(wanted).trim();
    if (pc.length < 8) return { error: 'passcode must be at least 8 characters' };
    const taken = await q('SELECT 1 FROM bkk_teachers WHERE key_hash=$1 AND id <> $2',
      [hashKey(pc), exceptId || 0]);
    if (taken.rows.length) return { error: 'someone on the team already uses that passcode' };
    return { passcode: pc };
  }
  app.get('/api/bkk/admin/teachers', async (req, res) => {
    if (adminOnly(req, res)) return;
    try {
      const r = await q('SELECT id,name,email,active,created_at FROM bkk_teachers ORDER BY name');
      res.json({ teachers: r.rows });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.post('/api/bkk/admin/teachers', async (req, res) => {
    if (adminOnly(req, res)) return;
    try {
      const { id, name, email, active } = req.body || {};
      if (id) {
        const r = await q(
          `UPDATE bkk_teachers SET name=COALESCE($2,name), email=COALESCE($3,email),
             active=COALESCE($4,active) WHERE id=$1 RETURNING id,name,email,active`,
          [id, name ?? null, email ?? null, active != null ? !!active : null]);
        if (!r.rows.length) return res.status(404).json({ error: 'not found' });
        return res.json({ success: true, teacher: r.rows[0] });
      }
      if (!String(name || '').trim()) return res.status(400).json({ error: 'name required' });
      const { passcode, error } = await choosePasscode((req.body || {}).passcode);
      if (error) return res.status(400).json({ error });
      const r = await q(
        `INSERT INTO bkk_teachers (name,email,key_hash) VALUES ($1,$2,$3)
         RETURNING id,name,email,active`,
        [String(name).trim(), email || null, hashKey(passcode)]);
      res.json({ success: true, teacher: r.rows[0], passcode,
        note: 'Give this passcode to them now — it cannot be shown again.' });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.post('/api/bkk/admin/teachers/:id/reset', async (req, res) => {
    if (adminOnly(req, res)) return;
    try {
      const { passcode, error } = await choosePasscode((req.body || {}).passcode, Number(req.params.id));
      if (error) return res.status(400).json({ error });
      const r = await q('UPDATE bkk_teachers SET key_hash=$2 WHERE id=$1 RETURNING name',
        [req.params.id, hashKey(passcode)]);
      if (!r.rows.length) return res.status(404).json({ error: 'not found' });
      res.json({ success: true, name: r.rows[0].name, passcode });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Packages. price_thb and active were read but never written, so changing a
  // price or retiring a package meant SQL against production.
  app.post('/api/bkk/admin/products', async (req, res) => {
    if (adminOnly(req, res)) return;
    try {
      const b = req.body || {};
      const code = String(b.code || '').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '');
      if (!code) return res.status(400).json({ error: 'code required' });
      await switchPrices();
      const existing = (await q('SELECT * FROM bkk_products WHERE code=$1', [code])).rows[0];

      if (existing) {
        // Only what was sent — an omitted field must not blank an existing one.
        const r = await q(
          `UPDATE bkk_products SET
             name_en   = COALESCE($2, name_en),
             name_th   = COALESCE($3, name_th),
             price_thb = COALESCE($4, price_thb),
             active    = COALESCE($5, active),
             sort      = COALESCE($6, sort)
           WHERE code=$1 RETURNING *`,
          [code, b.nameEn ?? null, b.nameTh ?? null,
           b.priceThb != null ? Math.max(0, parseInt(b.priceThb)) : null,
           b.active != null ? !!b.active : null,
           b.sort != null ? parseInt(b.sort) : null]);
        return res.json({ success: true, product: r.rows[0], created: false });
      }

      // kind/credits/valid_days define what the pass DOES, so they are required
      // on creation and deliberately not editable afterwards — changing them
      // under passes already sold would silently rewrite what people bought.
      const kind = ['credits', 'unlimited'].includes(b.kind) ? b.kind : null;
      const validDays = parseInt(b.validDays);
      if (!kind || !b.nameEn || !(validDays > 0) || b.priceThb == null) {
        return res.status(400).json({
          error: 'new package needs nameEn, kind (credits|unlimited), priceThb and validDays' });
      }
      const r = await q(
        `INSERT INTO bkk_products (code,name_en,name_th,price_thb,kind,credits,valid_days,daily_cap,sort,active)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,true) RETURNING *`,
        [code, b.nameEn, b.nameTh || null, Math.max(0, parseInt(b.priceThb)), kind,
         kind === 'credits' ? Math.max(1, parseInt(b.credits) || 1) : null,
         validDays,
         b.dailyCap != null ? parseInt(b.dailyCap) : (kind === 'unlimited' ? 2 : null),
         b.sort != null ? parseInt(b.sort) : 100]);
      res.json({ success: true, product: r.rows[0], created: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Close a class — moon day, Songkran, illness, travel.
  // Until now the overrides table was read but never written, so a cancelled
  // class was impossible to express AND every booked student silently lost the
  // credit they had spent on a class that would not run.
  app.post('/api/bkk/admin/classes/cancel', async (req, res) => {
    if (adminOnly(req, res)) return;
    const { slotId, date, reason } = req.body || {};
    if (!slotId || !date) return res.status(400).json({ error: 'slotId and date required' });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO bkk_class_overrides (slot_id,class_date,cancelled,note)
         VALUES ($1,$2,true,$3)
         ON CONFLICT (slot_id,class_date) DO UPDATE SET cancelled=true, note=EXCLUDED.note`,
        [slotId, date, String(reason || '').slice(0, 200) || null]);

      const hit = (await client.query(
        `UPDATE bkk_bookings SET status='cancelled', cancelled_at=now(),
           cancel_reason=$3
         WHERE slot_id=$1 AND class_date=$2 AND status='booked'
         RETURNING id, member_id, pass_id, moved_at`,
        [slotId, date, `class cancelled: ${reason || 'no reason given'}`])).rows;

      // The shala cancelled, not the student — the credit always comes back,
      // whatever the notice period was.
      // A Rezerv class staff took from a pass: as a staff cancel, it goes back to
      // Rezerv with its class, unless a Rezerv copy may have counted it. Then it
      // stays used, the pass says so, and that student gets no mail of a credit.
      const keptUsed = new Set();
      for (const b of hit) {
        if (b.pass_id && b.moved_at) {
          await client.query('SELECT 1 FROM bkk_passes WHERE id=$1 FOR UPDATE', [b.pass_id]);
          if (await moveAbsorbed(client, b.id)) {
            keptUsed.add(b.member_id);
            await client.query(`UPDATE bkk_passes SET note = coalesce(note || ' | ', '') || $2 WHERE id=$1`,
              [b.pass_id, `class ${date} closed, still used (a Rezerv copy may have counted it)`]);
            continue;
          }
          await client.query(`UPDATE bkk_bookings SET pass_id=NULL, cover='rezerv', moved_at=NULL WHERE id=$1`, [b.id]);
        }
        if (b.pass_id) {
          await client.query(
            `UPDATE bkk_passes SET credits_used = GREATEST(0, credits_used - 1)
             WHERE id=$1 AND kind <> 'unlimited'`, [b.pass_id]);
        }
      }
      await client.query('COMMIT');

      const people = hit.length ? (await q(
        `SELECT m.name, m.email, m.lang, s.title, s.start_time
         FROM bkk_members m, bkk_class_slots s
         WHERE m.id = ANY($1::int[]) AND s.id = $2`,
        [hit.map(b => b.member_id).filter(id => !keptUsed.has(id)), slotId])).rows : [];
      for (const p of people) {
        if (!p.email) continue;
        const t = render('classCancelled', p.lang || 'en',
          { name: p.name, className: p.title, date, time: p.start_time, reason });
        sendMail({ to: p.email, subject: t.subject, html: t.html, text: t.text, tag: 'cancelled' })
          .catch(e => console.error('[bkk] cancel mail failed:', e.message));
      }
      console.log(`✓ bkk: class ${slotId} on ${date} cancelled — ${hit.length} booking(s) released`);
      res.json({ success: true, released: hit.length, notified: people.filter(p => p.email).length, keptUsed: keptUsed.size });
    } catch (e) {
      await client.query('ROLLBACK'); res.status(500).json({ error: e.message });
    } finally { client.release(); }
  });

  app.post('/api/bkk/admin/classes/reopen', async (req, res) => {
    if (adminOnly(req, res)) return;
    try {
      const { slotId, date } = req.body || {};
      if (!slotId || !date) return res.status(400).json({ error: 'slotId and date required' });
      // Bookings are NOT restored: the students were told it was off, and some
      // will have made other plans. They rebook, with their credit back.
      await q(`UPDATE bkk_class_overrides SET cancelled=false
               WHERE slot_id=$1 AND class_date=$2`, [slotId, date]);
      res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ── the class calendar (admin) ───────────────────────────────────────────
  // Every class over a stretch of days with its counts, past ones included:
  // the timetable as generated (moon days off), a closed class kept so staff
  // can see it and reopen it, and any class with names on it, even one no
  // longer run or on a moon day, so history never drops off the calendar.
  // A Rezerv class moved over with no slot is one read-only class per
  // (day, title, start time). key is what the page sends back for one class.
  const CAL_TIME = `to_char(b.start_at AT TIME ZONE 'Asia/Bangkok','HH24:MI')`;
  function calClass({ slot, date, ov, n = {}, time, title }) {
    const counts = { booked: n.booked || 0, checkedIn: n.checkedIn || 0, noShows: n.noShows || 0 };
    if (!slot) {
      // The import stores a Rezerv visit with no time at 00:00 (VISIT_TIME):
      // the key keeps it, so the class still opens by time=00:00.
      return { key: `x:${date}:${time}:${title}`, slotId: null, date, startAt: startAtISO(date, time),
        timeKnown: time !== '00:00', title,
        kind: null, teachers: '', durationMin: null, isOnline: /online|zoom|ออนไลน์/i.test(title), capacity: null,
        ...counts, cancelled: false, note: null };
    }
    const cancelled = !!(ov && ov.cancelled);
    return { key: `s:${slot.id}:${date}`, slotId: slot.id, date, startAt: startAtISO(date, slot.start_time), timeKnown: true,
      title: slot.title, kind: slot.kind, teachers: rotationTeacher(slot.code, date) || slot.teachers || '',
      durationMin: slot.duration_min, isOnline: slot.is_online,
      // ?? not || — an override capacity of 0 ("closed today") is a real value.
      capacity: ov && ov.capacity != null ? ov.capacity : slot.capacity,
      ...counts, cancelled, note: cancelled ? ov.note : null };
  }

  app.get('/api/bkk/admin/calendar', async (req, res) => {
    if (adminOnly(req, res)) return;
    const r = dayRange(req.query, { required: true, maxDays: SCHEDULE_DAYS });
    if (r.error) return res.status(400).json({ error: r.error });
    const { from, to } = r;
    try {
      const [slots, ovs, counts] = await Promise.all([
        q('SELECT * FROM bkk_class_slots'),
        q(`SELECT slot_id, to_char(class_date,'YYYY-MM-DD') AS date, cancelled, capacity, note
           FROM bkk_class_overrides WHERE class_date BETWEEN $1::date AND $2::date`, [from, to]),
        q(`SELECT b.slot_id, to_char(b.class_date,'YYYY-MM-DD') AS date,
             CASE WHEN b.slot_id IS NULL THEN coalesce(b.class_title,'') END AS title,
             CASE WHEN b.slot_id IS NULL THEN ${CAL_TIME} END AS time,
             count(*) FILTER (WHERE b.status='booked')::int AS booked,
             count(*) FILTER (WHERE b.status='booked' AND b.checked_in_at IS NOT NULL)::int AS checked_in,
             count(*) FILTER (WHERE b.status='noshow')::int AS no_shows
           FROM bkk_bookings b
           WHERE b.class_date BETWEEN $1::date AND $2::date AND b.status IN ('booked','noshow')
           GROUP BY 1, 2, 3, 4`, [from, to]),
      ]);
      const slotById = new Map(slots.rows.map(s => [s.id, s]));
      const ovOf = new Map(ovs.rows.map(o => [`${o.slot_id}:${o.date}`, o]));
      const moon = moonDaysBetween(from, to);
      const found = new Map(), out = [];
      for (let t = Date.parse(`${from}T12:00:00Z`); t <= Date.parse(`${to}T12:00:00Z`); t += 86400000) {
        const date = new Date(t).toISOString().slice(0, 10);
        if (moon.has(date)) continue;
        const wd = new Date(t).getUTCDay();
        for (const s of slots.rows) if (s.active && s.weekday === wd) found.set(`${s.id}:${date}`, { slot: s, date });
      }
      for (const row of counts.rows) {
        const n = { booked: row.booked, checkedIn: row.checked_in, noShows: row.no_shows };
        if (row.slot_id == null) { out.push(calClass({ date: row.date, time: row.time, title: row.title, n })); continue; }
        if (!slotById.has(row.slot_id)) continue;
        found.set(`${row.slot_id}:${row.date}`, { slot: slotById.get(row.slot_id), date: row.date, n });
      }
      for (const [k, c] of found) out.push(calClass({ ...c, ov: ovOf.get(k) }));
      // A class with no time on file goes last in its day, not first at 00:00.
      out.sort((a, b) => a.date.localeCompare(b.date) || (a.timeKnown ? 0 : 1) - (b.timeKnown ? 0 : 1)
        || a.startAt.localeCompare(b.startAt) || (a.isOnline - b.isOnline) || a.title.localeCompare(b.title));
      res.json({ from, to, today: bkkToday(), moonDays: Object.fromEntries(moon), classes: out });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Inside one class: ?slotId=&date=, or ?date=&time=&title= for a slotless
  // class moved over from Rezerv. No email, phone or birthday on the roster.
  app.get('/api/bkk/admin/class', async (req, res) => {
    if (adminOnly(req, res)) return;
    const { slotId, date } = req.query;
    const bySlot = slotId != null && slotId !== '';
    const time = String(req.query.time || ''), title = String(req.query.title || '');
    if (!realYmd(date)) return res.status(400).json({ error: 'date must be a date (YYYY-MM-DD)' });
    if (bySlot ? !/^\d{1,9}$/.test(String(slotId)) : !/^\d{2}:\d{2}$/.test(time))
      return res.status(400).json({ error: 'slotId, or time (HH:MM) and title, needed' });
    try {
      let slot = null, ov = null;
      if (bySlot) {
        slot = (await q('SELECT * FROM bkk_class_slots WHERE id=$1', [Number(slotId)])).rows[0];
        if (!slot) return res.status(404).json({ error: 'class not found' });
        ov = (await q('SELECT * FROM bkk_class_overrides WHERE slot_id=$1 AND class_date=$2::date', [slot.id, date])).rows[0];
      }
      const rows = (await q(
        `SELECT b.id, b.status, b.checked_in_at, b.booked_at, b.cancelled_at, b.cancel_reason, b.cover, b.source, b.need_mat,
           m.code, m.name, m.photo_id, pr.name_en AS pass_name, coalesce(pr.kind = 'credits' AND pr.credits = 1, false) AS dropin,
           ${SIGNED('m.id')} AS consent
         FROM bkk_bookings b JOIN bkk_members m ON m.id=b.member_id
         LEFT JOIN bkk_passes p ON p.id=b.pass_id LEFT JOIN bkk_products pr ON pr.id=p.product_id
         WHERE b.class_date=$1::date AND ${bySlot ? 'b.slot_id=$2'
           : `b.slot_id IS NULL AND ${CAL_TIME}=$2 AND coalesce(b.class_title,'')=$3`}`,
        bySlot ? [date, slot.id] : [date, time, title])).rows;
      if (!bySlot && !rows.length) return res.status(404).json({ error: 'class not found' });
      const live = rows.filter(b => b.status === 'booked' || b.status === 'noshow');
      // Another weekday's slot is not a class on this day, unless names are
      // already on it: then it is history and is shown.
      const offDay = slot && new Date(`${date}T12:00:00Z`).getUTCDay() !== slot.weekday;
      if (offDay && !live.length) return res.status(400).json({ error: 'that class is not on that day' });
      const c = calClass({ slot, date, ov, time, title, n: {
        booked: live.filter(b => b.status === 'booked').length,
        checkedIn: live.filter(b => b.status === 'booked' && b.checked_in_at).length,
        noShows: live.filter(b => b.status === 'noshow').length } });
      const startMs = Date.parse(c.startAt), now = bkkNow().getTime();
      const dur = slot ? (slot.duration_min || 120) : null;
      const cOn = await consentMode() !== 'off';
      const started = now >= startMs;
      // classCheck's staff rule: a name can go on the list until the class ends,
      // and after it (as someone who came) for LATE_ADD_DAYS days.
      // A slotless class only exists as Rezerv history, so it is over once begun.
      const ended = slot ? (now - startMs) / 60000 > dur : started;
      const canAdd = !!slot && slot.active && !offDay && !c.cancelled && !moonDaysBetween(date, date).size
        && (!ended || date >= bkkDaysAgo(LATE_ADD_DAYS));
      res.json({
        class: { ...c, endAt: slot ? bkkISO(startMs + dur * 60000) : null, started, ended, canAdd,
          mats: live.filter(b => b.status === 'booked' && b.need_mat).length },
        roster: live.map(b => ({ bookingId: b.id, code: b.code, name: b.name, status: b.status,
          checkedInAt: b.checked_in_at, bookedAt: b.booked_at, cover: b.cover, source: b.source,
          passName: b.pass_name, dropin: b.dropin, needMat: b.need_mat, photo: faceSmall(b.photo_id, b.code),
          ...(cOn ? { consent: b.consent } : {}) }))
          .sort((a, b) => String(a.name).localeCompare(String(b.name)) || a.bookingId - b.bookingId),
        cancelledList: rows.filter(b => b.status === 'cancelled')
          .sort((a, b) => (b.cancelled_at || 0) - (a.cancelled_at || 0) || b.id - a.id)
          .map(b => ({ code: b.code, name: b.name, cancelledAt: b.cancelled_at, reason: b.cancel_reason })),
      });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Check one name in from inside a class, or undo it. A class that has ended
  // is checked in at its start (as the Rezerv import does; Boonchu, 30 Oct: a
  // tap at 19:33 must not read "In 19:33" for a 05:30 class), a no-show seen
  // after all becomes a visit, and a class not reached yet cannot be: nobody
  // is in the room. Pass credits are never touched here.
  app.post('/api/bkk/admin/bookings/:id/checkin', async (req, res) => {
    if (adminOnly(req, res)) return;
    if (!/^\d{1,9}$/.test(req.params.id)) return res.status(404).json({ error: 'booking not found' });
    const undo = (req.body || {}).undo === true;
    try {
      const b = (await q(`SELECT id, slot_id, status, to_char(class_date,'YYYY-MM-DD') AS date FROM bkk_bookings WHERE id=$1`,
        [Number(req.params.id)])).rows[0];
      if (!b) return res.status(404).json({ error: 'booking not found' });
      if (b.slot_id == null) return res.status(409).json({ error: REZERV_READONLY });
      if (b.status === 'cancelled') return res.status(409).json({ error: 'that booking was cancelled' });
      const today = bkkToday();
      if (!undo && b.date > today) return res.status(409).json({ error: 'that class is not today yet' });
      const r = (await q(undo
        ? `UPDATE bkk_bookings SET checked_in_at=NULL, checkin_via='admin', checkin_by=NULL
           WHERE id=$1 AND status IN ('booked','noshow') RETURNING id, status, checked_in_at`
        : `UPDATE bkk_bookings b SET status='booked',
             checked_in_at=COALESCE(b.checked_in_at, CASE WHEN b.class_date < $2::date
               OR now() > b.start_at + make_interval(mins => s.duration_min) THEN b.start_at ELSE now() END),
             checkin_via = CASE WHEN b.checked_in_at IS NULL THEN 'admin' ELSE b.checkin_via END,
             checkin_by = CASE WHEN b.checked_in_at IS NULL THEN NULL ELSE b.checkin_by END
           FROM bkk_class_slots s
           WHERE b.id=$1 AND s.id=b.slot_id AND b.status IN ('booked','noshow')
           RETURNING b.id, b.status, b.checked_in_at`,
        undo ? [b.id] : [b.id, today])).rows[0];
      if (!r) return res.status(409).json({ error: 'that booking was cancelled' });
      res.json({ success: true, booking: { id: r.id, status: r.status, checkedInAt: r.checked_in_at } });
    } catch (e) {
      // A no-show whose student is on the same class again (booked twice in Rezerv).
      if (/duplicate key/.test(e.message)) return res.status(409).json({ error: 'already on this class list' });
      res.status(500).json({ error: e.message });
    }
  });

  // ── the door tablet (17 Nov 2026) ────────────────────────────────────────
  // An iPad at the door: students tap their own booked tile, "Is this you?",
  // and are checked in. Nobody is at the desk at 05:30. It holds its own door
  // key (x-door-key), never the admin key: the key opens only /api/bkk/door/*,
  // and those routes take nothing else. What it sees: "Name L." for the seats of
  // today's in-person classes whose window is open (start minus DOOR_EARLY_MIN
  // until the class ends), each with a signed handle for that seat and device,
  // and whether it is checked in. A student with a profile photo also gets a
  // face link (f) for that tablet that ends with the class (doorFace). No code,
  // email, phone, pass or price.
  const DOOR_EARLY_MIN = 60;
  const DOOR_PAIR_MIN = 10;
  const DOOR_ALPHABET = 'ACDEFHJKMNPRTVWXY34679';   // no O/0, I/1/L, S/5, Z/2, B/8, G/6, U/V
  const doorCode = () => Array.from({ length: 8 }, () => DOOR_ALPHABET[crypto.randomInt(DOOR_ALPHABET.length)]).join('');
  const pairStarts = missCounter(12, HOUR_MS);        // pairing codes asked for, per address
  const pairMisses = missCounter(10, HOUR_MS);        // wrong codes typed in Admin, per address
  const bkkHm = ms => new Date(ms + 7 * 3600000).toISOString().slice(11, 16);
  const addDay = (d, n) => ymd(new Date(Date.parse(`${d}T12:00:00${TZ_OFFSET}`) + n * 86400000));

  // The device behind x-door-key, or null; every use says when and from where
  // (guessIp: on cn.aybkk.net the caller writes x-forwarded-for). other_ip_at,
  // for Admin and the 20:00 summary: when it moved to an address other than the
  // one it was paired from. Only a move sets it, not every poll from there, so a
  // new shala address (a router restart) warns once, not every day; Admin's
  // "This is the shala's internet" makes the new address the shala's.
  async function doorFrom(req) {
    const key = req.headers['x-door-key'];
    if (typeof key !== 'string' || !/^dk_[A-Za-z0-9_-]{43}$/.test(key)) return null;
    const ip = guessIp(req);
    return (await q(`UPDATE bkk_door_devices SET last_seen_at=now(), last_ip=$2,
        other_ip_at = CASE WHEN paired_ip IS DISTINCT FROM $2 AND (other_ip_at IS NULL OR last_ip IS DISTINCT FROM $2)
          THEN now() ELSE other_ip_at END
      WHERE key_hash=$1 AND revoked_at IS NULL RETURNING id, name`, [hashKey(key), ip])).rows[0] || null;
  }
  const doorNoKey = res => res.status(401).set({ 'WWW-Authenticate': 'X-Door-Key', 'Cache-Control': 'no-store' })
    .json({ ok: false, error: 'this tablet is not paired' });

  // A seat handle: booking id, device id and the class end (minutes), one AES
  // block under the server secret plus a MAC, so it shows no id and cannot be
  // made up. The same seat gives the same handle until the class ends.
  const DOOR_TAG = 0x44545631;
  const doorKeys = async () => blockKeys(await serverSecret(), 'door');
  const sealSeat = (k, bid, dev, endMs) => sealBlock(k, [bid, dev, Math.ceil(endMs / 60000), DOOR_TAG]);
  const openSeat = (k, t) => {
    const v = openBlock(k, t, DOOR_TAG);
    return v && { bid: v[0], dev: v[1], endMs: v[2] * 60000 };
  };

  // "Ana E.": the first word and the first letter of the last word, built here
  // so a full name never reaches the tablet. A title or a name in brackets is
  // skipped, and a Thai leading vowel does not count as the letter. One word
  // stays one word, but a Chinese name in characters is masked the way Chinese
  // apps do (王*明, 李*), and a word with an @ or a run of digits (an email or a
  // phone typed as a name) shows only its first letter. Two people with the same
  // label in one list get more letters of the last word until they differ (a
  // Thai word then keeps its leading vowel: ใจด.), never the whole word. Labels
  // that still match (the same name twice) are marked same: the tablet sends
  // those people to the teacher, so nobody checks in someone else's seat.
  const DOOR_TITLE = /^(mr|mrs|ms|miss|mx|dr|นาย|นาง|นางสาว|น\.ส\.|ด\.ช\.|ด\.ญ\.)\.?$/i;
  const DOOR_HIDE = /@|\d{3,}/;
  const HAN = /\p{Script=Han}/u;
  const doorFirst = w => {
    const c = Array.from(w);
    if (DOOR_HIDE.test(w)) return c[0] + '.';
    if (HAN.test(w) && c.length > 1) return c[0] + '*'.repeat(Math.max(1, c.length - 2)) + (c.length > 2 ? c[c.length - 1] : '');
    return w;
  };
  const doorWords = name => {
    const s = String(name || '').normalize('NFC');
    let ws = (s.replace(/[(（[][^)）\]]*[)）\]]/g, ' ').trim() || s).split(/\s+/).filter(Boolean);
    if (ws.length > 1 && DOOR_TITLE.test(ws[0])) ws = ws.slice(1);
    const last = ws.length > 1 ? ws[ws.length - 1] : '';
    const cps = Array.from(last);
    let lead = 0;
    while (lead < cps.length - 1 && /[เ-ไ]/.test(cps[lead])) lead++;
    return { first: doorFirst(ws[0] || '?'), last, cps, lead, cmp: cps.slice(lead),
      maxK: DOOR_HIDE.test(last) ? 1 : Math.max(1, cps.length - lead - 1) };
  };
  const lastPart = (p, k) => (k > 1 ? p.cps.slice(0, p.lead + k) : p.cps.slice(p.lead, p.lead + 1)).join('') + '.';
  function doorNames(seats) {
    const people = new Map();
    for (const s of seats) if (!people.has(s.member_id)) people.set(s.member_id, doorWords(s.name));
    const all = [...people.values()];
    const common = (a, b) => { let i = 0; while (i < a.length && i < b.length && a[i] === b[i]) i++; return i; };
    for (const p of all) {
      let k = 1;
      for (const o of all) if (o !== p && p.last && o.last && o.first === p.first && o.last !== p.last) k = Math.max(k, common(p.cmp, o.cmp) + 1);
      p.k = Math.min(k, p.maxK);
      p.n = p.last ? `${p.first} ${lastPart(p, p.k)}` : p.first;
    }
    const count = new Map();
    for (const p of all) count.set(p.n, (count.get(p.n) || 0) + 1);
    return new Map(seats.map(s => { const p = people.get(s.member_id); return [s.id, { n: p.n, same: count.get(p.n) > 1 }]; }));
  }

  // What the door shows now, on the class clock: today's in-person classes
  // whose window is open (never online, cancelled or on a moon day), their live
  // seats, and the next class whose window is still to open (up to a week on).
  async function doorState(db = pool) {
    const nowMs = bkkNow().getTime(), today = ymd(new Date(nowMs)), until = addDay(today, 7);
    const moons = moonDaysBetween(today, until);
    const [slots, ovs] = await Promise.all([
      db.query(`SELECT * FROM bkk_class_slots WHERE active AND is_online IS NOT TRUE ORDER BY start_time, id`),
      db.query(`SELECT slot_id, to_char(class_date,'YYYY-MM-DD') AS d FROM bkk_class_overrides
                WHERE cancelled AND class_date BETWEEN $1::date AND $2::date`, [today, until])]);
    const off = new Set(ovs.rows.map(o => `${o.slot_id}|${o.d}`));
    const on = d => moons.has(d) ? [] : slots.rows
      .filter(s => s.weekday === new Date(`${d}T12:00:00${TZ_OFFSET}`).getUTCDay() && !off.has(`${s.id}|${d}`))
      .map(s => {
        const start = Date.parse(startAtISO(d, s.start_time));
        return { slot: s, date: d, start, end: start + (s.duration_min || 120) * 60000, opens: start - DOOR_EARLY_MIN * 60000 };
      }).sort((a, b) => a.start - b.start || a.slot.id - b.slot.id);
    const live = on(today).filter(c => nowMs >= c.opens && nowMs < c.end);
    let next = null;
    for (let i = 0; i <= 7 && !next; i++) next = on(addDay(today, i)).find(c => c.opens > nowMs) || null;
    const seats = live.length ? (await db.query(
      `SELECT b.id, b.member_id, b.slot_id, b.checked_in_at, m.name, m.code, m.photo_id FROM bkk_bookings b JOIN bkk_members m ON m.id=b.member_id
       WHERE b.class_date=$1::date AND b.status='booked' AND b.slot_id = ANY($2::int[])`, [today, live.map(c => c.slot.id)])).rows : [];
    return { nowMs, today, moon: moons.has(today), live, seats, next };
  }

  // 1. The tablet asks (no key): a short code to show, a long secret to keep.
  app.post('/api/bkk/door/pair/start', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    const ip = guessIp(req);
    if (pairStarts.over(ip)) return res.status(429).set('Retry-After', String(pairStarts.retryS(ip)))
      .json({ error: 'too many pairing codes from here: try again later' });
    pairStarts.hold(ip);
    try {
      await q(`DELETE FROM bkk_door_pairings WHERE expires_at < now() - interval '1 day'`);
      // At most 50 codes wait. A flood from many addresses pushes the oldest
      // unapproved ones out instead of refusing the real tablet, so a code staff
      // type within a few minutes still works.
      await q(`DELETE FROM bkk_door_pairings WHERE id IN (SELECT id FROM bkk_door_pairings
        WHERE expires_at > now() AND used_at IS NULL AND approved_at IS NULL ORDER BY id DESC OFFSET 49)`);
      const secret = crypto.randomBytes(32).toString('base64url');
      let code = null;
      for (let i = 0; i < 5 && !code; i++) {
        const c = doorCode();
        const r = await q(`INSERT INTO bkk_door_pairings (code_hash, secret_hash, ip, expires_at)
          SELECT $1, $2, $3, now() + make_interval(mins => $4) WHERE NOT EXISTS (SELECT 1 FROM bkk_door_pairings
            WHERE code_hash=$1 AND expires_at > now() AND used_at IS NULL) RETURNING id`, [hashKey(c), hashKey(secret), ip, DOOR_PAIR_MIN]);
        if (r.rows.length) code = c;
      }
      if (!code) throw new Error('could not make a code, please try again');
      res.json({ code: `${code.slice(0, 4)} ${code.slice(4)}`, secret, expiresIn: DOOR_PAIR_MIN * 60 });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // 2. Staff type the code the tablet shows. A wrong one counts as a miss.
  app.post('/api/bkk/admin/door/pair', async (req, res) => {
    if (adminOnly(req, res)) return;
    res.set('Cache-Control', 'no-store');
    const ip = guessIp(req);
    if (pairMisses.over(ip)) return res.status(429).set('Retry-After', String(pairMisses.retryS(ip)))
      .json({ error: 'too many wrong codes: try again in an hour' });
    const code = String((req.body || {}).code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    const name = String((req.body || {}).name || '').trim().slice(0, 40) || 'Front door';
    const t = pairMisses.hold(ip);
    try {
      // Typed in the last seconds of its 10 minutes: the tablet still has 2 minutes to claim it.
      const r = (await q(`UPDATE bkk_door_pairings SET approved_at=now(), name=$2, expires_at=greatest(expires_at, now() + interval '2 minutes')
        WHERE code_hash=$1 AND expires_at > now() AND used_at IS NULL AND approved_at IS NULL RETURNING id`,
        [hashKey(code), name])).rows[0];
      if (!r) return res.status(404).json({ error: 'No tablet is showing that code. Check the code on the tablet: it changes every 10 minutes.' });
      t.n--;
      res.json({ success: true, name });
    } catch (e) { t.n--; res.status(500).json({ error: e.message }); }
  });

  // 3. The tablet asks with its secret: once approved, the door key, once. A
  // new device ends every other one (one door key at a time).
  app.post('/api/bkk/door/pair/claim', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    const secret = String((req.body || {}).secret || '');
    if (!/^[A-Za-z0-9_-]{43}$/.test(secret)) return res.status(404).json({ ok: false, gone: true });
    // Looked up first with no lock: polls and made-up secrets never wait on it.
    let look;
    try {
      look = (await q(`SELECT approved_at, used_at, expires_at <= now() AS expired FROM bkk_door_pairings WHERE secret_hash=$1`,
        [hashKey(secret)])).rows[0];
    } catch (e) { return res.status(500).json({ ok: false, error: e.message }); }
    if (!look || look.used_at || look.expired) return res.status(404).json({ ok: false, gone: true });
    if (!look.approved_at) return res.json({ ok: false, waiting: true });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SELECT pg_advisory_xact_lock(hashtext('bkk_door_devices'))`);
      const p = (await client.query(`SELECT *, expires_at <= now() AS expired FROM bkk_door_pairings WHERE secret_hash=$1 FOR UPDATE`,
        [hashKey(secret)])).rows[0];
      if (!p || p.used_at || p.expired) { await client.query('ROLLBACK'); return res.status(404).json({ ok: false, gone: true }); }
      if (!p.approved_at) { await client.query('ROLLBACK'); return res.json({ ok: false, waiting: true }); }
      const key = 'dk_' + crypto.randomBytes(32).toString('base64url');
      const ip = guessIp(req);
      await client.query(`UPDATE bkk_door_devices SET revoked_at=now() WHERE revoked_at IS NULL`);
      const d = (await client.query(`INSERT INTO bkk_door_devices (name, key_hash, paired_ip, last_seen_at, last_ip)
        VALUES ($1,$2,$3,now(),$3) RETURNING id, name`, [p.name || 'Front door', hashKey(key), ip])).rows[0];
      await client.query(`UPDATE bkk_door_pairings SET used_at=now(), device_id=$2 WHERE id=$1`, [p.id, d.id]);
      await client.query('COMMIT');
      console.log(`✓ bkk: door tablet "${d.name}" paired`);
      res.json({ ok: true, key, name: d.name });
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      res.status(500).json({ ok: false, error: e.message });
    } finally { client.release(); }
  });

  // Admin's "Door tablets" box. Never the key or its hash.
  app.get('/api/bkk/admin/door/devices', async (req, res) => {
    if (adminOnly(req, res)) return;
    try {
      // The one in use and the ones unpaired in the last 3 days: old rows do not pile up.
      const r = await q(`SELECT id, name, paired_at, last_seen_at, other_ip_at, revoked_at FROM bkk_door_devices
        WHERE revoked_at IS NULL OR revoked_at > now() - interval '3 days'
        ORDER BY revoked_at IS NULL DESC, paired_at DESC, id DESC LIMIT 5`);
      res.set('Cache-Control', 'no-store').json({ devices: r.rows.map(d => ({ id: d.id, name: d.name, pairedAt: d.paired_at,
        lastSeenAt: d.last_seen_at, otherInternet: !!d.other_ip_at, otherSeenAt: d.other_ip_at, active: !d.revoked_at, revokedAt: d.revoked_at })) });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
  // "This is the shala's internet": the address it was last seen from becomes
  // the shala's (a new address after a router restart), and the warning goes.
  app.post('/api/bkk/admin/door/devices/:id/home', async (req, res) => {
    if (adminOnly(req, res)) return;
    if (!/^\d{1,9}$/.test(req.params.id)) return res.status(404).json({ error: 'not found' });
    try {
      const n = (await q(`UPDATE bkk_door_devices SET paired_ip=last_ip, other_ip_at=NULL WHERE id=$1 AND revoked_at IS NULL`,
        [Number(req.params.id)])).rowCount;
      if (!n) return res.status(404).json({ error: 'not found' });
      res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
  app.post('/api/bkk/admin/door/devices/:id/revoke', async (req, res) => {
    if (adminOnly(req, res)) return;
    if (!/^\d{1,9}$/.test(req.params.id)) return res.status(404).json({ error: 'not found' });
    try {
      const d = (await q(`SELECT id FROM bkk_door_devices WHERE id=$1`, [Number(req.params.id)])).rows[0];
      if (!d) return res.status(404).json({ error: 'not found' });
      const n = (await q(`UPDATE bkk_door_devices SET revoked_at=now() WHERE id=$1 AND revoked_at IS NULL`, [d.id])).rowCount;
      res.json({ success: true, revoked: n > 0 });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // The class list on the tablet. Outside every window only next, moon and now.
  app.get('/api/bkk/door/now', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      const dev = await doorFrom(req);
      if (!dev) return doorNoKey(res);
      const st = await doorState();
      const n = st.next;
      const out = { next: n && { title: n.slot.title, date: n.date, start: bkkHm(n.start), opens: bkkHm(n.opens) }, moon: st.moon, now: st.nowMs };
      if (!st.live.length) return res.json(out);
      const [k, names] = [await doorKeys(), doorNames(st.seats)];
      const cls = new Map(st.live.map(c => [c.slot.id, c]));
      const seats = st.seats.map(s => ({ id: s.id, ...names.get(s.id), c: cls.get(s.slot_id), at: s.checked_in_at,
        f: doorFace(s.photo_id, s.code, dev.id, cls.get(s.slot_id).end) }))
        .sort((a, b) => a.n.localeCompare(b.n, 'en') || a.id - b.id)
        .map(s => ({ t: sealSeat(k, s.id, dev.id, s.c.end), n: s.n, in: !!s.at, at: s.at ? bkkHm(new Date(s.at).getTime()) : null, c: bkkHm(s.c.start),
          ...(s.f ? { f: s.f } : {}), ...(s.same ? { same: true } : {}) }));
      res.json({ classes: st.live.map(c => ({ title: c.slot.title, start: bkkHm(c.start), end: bkkHm(c.end) })), seats, ...out });
    } catch (e) {
      console.error('[bkk door] now failed:', e.message);
      res.status(500).json({ error: 'something went wrong' });
    }
  });

  // A tap, then "Yes". A booked seat is always taken: the class was counted when
  // it was booked, so nothing about the pass is read or written here, and taps
  // are never limited (a prank must not lock out a class). 400: a handle this
  // server never made for this tablet, or its class is over. 409: the seat was
  // cancelled or its window is closed: the page says "see the teacher".
  app.post('/api/bkk/door/checkin', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    let client = null;
    try {
      const dev = await doorFrom(req);
      if (!dev) return doorNoKey(res);
      const h = openSeat(await doorKeys(), (req.body || {}).t);
      if (!h || h.dev !== dev.id || bkkNow().getTime() >= h.endMs) return res.status(400).json({ ok: false, error: 'not a seat on this tablet' });
      const st = await doorState();
      const seat = st.seats.find(s => s.id === h.bid);
      const name = seat && doorNames(st.seats).get(seat.id);
      if (!seat || name.same) return res.status(409).json({ ok: false, refused: true });
      client = await pool.connect();
      await client.query('BEGIN');
      const b = (await client.query(`SELECT checked_in_at FROM bkk_bookings WHERE id=$1 AND status='booked' FOR UPDATE`, [seat.id])).rows[0];
      if (!b) { await client.query('ROLLBACK'); return res.status(409).json({ ok: false, refused: true }); }
      const at = b.checked_in_at || (await client.query(`UPDATE bkk_bookings SET checked_in_at=$2, checkin_via='tablet', checkin_by=$3
        WHERE id=$1 RETURNING checked_in_at`, [seat.id, new Date(st.nowMs).toISOString(), dev.name])).rows[0].checked_in_at;
      await client.query('COMMIT');
      res.json({ ok: true, n: name.n, already: !!b.checked_in_at, at: bkkHm(new Date(at).getTime()) });
    } catch (e) {
      if (client) await client.query('ROLLBACK').catch(() => {});
      console.error('[bkk door] check-in failed:', e.message);
      res.status(500).json({ ok: false, error: 'something went wrong' });
    } finally { if (client) client.release(); }
  });

  // "Not on the list? Book on your phone": a QR to /book on this site, made here.
  app.get('/api/bkk/door/qr', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      const dev = await doorFrom(req);
      if (!dev) return doorNoKey(res);
      const link = `${signinOrigin(req.query.origin)}/book`;
      const svg = await QRCode.toString(link, { type: 'svg', errorCorrectionLevel: 'M', margin: 2,
        color: { dark: '#000000', light: '#ffffff' } });
      res.json({ link, svg });
    } catch (e) { res.status(500).json({ error: 'something went wrong' }); }
  });

  const booted = initSchema();
  // Resolves once the schema, seed and price switch are done (never rejects), so
  // a test can wait for the boot instead of guessing how long it takes. It
  // resolves to the payment watch, which a test runs on its own clock.
  const timers = opts.timers !== false && process.env.BKK_TIMERS !== 'off';
  return booted
    .then(() => {
      console.log('✓ bkk-api mounted (/api/bkk/*)'); letterPurge(); sweepFaces();
      if (timers) { startPayWatch(); teePurgeTick(); setInterval(teePurgeTick, 24 * 3600 * 1000).unref(); }
      // A move of photos to R2 that staff started and did not stop goes on, a minute after a restart.
      if (timers && r2) moveState().then(s => { if (s.on) moveSoon(60000); }).catch(() => {});
      return switchPrices().catch(e => console.error('✗ bkk: price switch failed:', e.message));
    })
    .catch(e => console.error('✗ bkk-api schema init failed:', e.message))
    .then(() => ({ paySweep, moneyTick, moneyLine, resendAlerts, teePurge, findOrCreateMember, staffSigninLink, photoMove: moveStep }));
}

// PaySolutions posts application/x-www-form-urlencoded; make sure that body is
// parsed even though the app defaults to JSON.
const express = require('express');
const express_urlencoded_safe = express.urlencoded({ extended: false });

module.exports = { mountBkk, CANCEL_CUTOFF_HOURS, SEED_PRODUCTS, SEED_SLOTS, moonDaysBetween, rotationTeacher, parseWhen,
  CONSENT_VERSION, CONSENT_TEXT, checkConsentText, TEE_NOTICE_VERSION, TEE_NOTICE };
