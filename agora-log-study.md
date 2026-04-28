# AYBKK Workshop Infrastructure — Complete System Study
**Logged by:** Neo  
**Date:** April 25, 2026  
**Reason:** Boonchu asked Neo to study the code Claude Code CLI built while Boonchu was in China

---

## BACKGROUND

While Boonchu was in China (no Telegram/Hermes connection), he used Claude Code CLI on Mac mini to build the student intake + daily journal system for Huizhou and Guangzhou workshops.

---

## SYSTEM ARCHITECTURE

### TWO SERVERS (dual-server architecture)

**1. server.js (HEAD) — Neo4j-primary**
- Port 3000
- Uses Neo4j (bolt://localhost:7687) as primary database
- Student journal: SelfAssessment nodes in Neo4j
- Railway PostgreSQL: connected for mindmap student queries
- AI summary: DeepSeek via OpenRouter API
- Routes: /api/journal/*, /api/orientations, /api/upload/*

**2. railway-server.js (ALT — Railway deployment)**
- Port 3000 (PORT env var)
- Uses Railway PostgreSQL as primary (shared with booking system)
- /data/ JSON files as fallback when no DATABASE_URL
- Same API endpoints as server.js but PostgreSQL-first
- Deployment: Procfile: web: node server.js → Railway auto-selects server.js

**DEPLOYMENT URL:** https://aybkk-ashtanga.up.railway.app

---

## STUDENT FLOW (3 phases)

### PHASE 1: ORIENTATION (Student creates profile)
1. Student visits orientation page (orientation-gz.html / orientation.html)
2. Fills intake form: name, wechat, experience, injuries, goals, emergency, size
3. Answers 2 Ashtanga quizzes (never reveals correct answer until after registration)
4. Submits → POST /api/orientations
5. Two things created in Neo4j:
   - Orientation node (gz- timestamp-id format)
   - Student node (id=gz-TIMESTAMP-ID, classType='chinese-workshop', oriented=true)
6. Student gets personal journal link: /student.html?id=GZ-ID&name=...&lang=zh&location=guangzhou
7. WeChat share card: canvas-generated image with selfie overlay (NOT the private link)

### PHASE 2: DAILY JOURNAL (Student self-assessment after each class)
1. Student opens /student.html?id=... (or via QR code scanned at studio)
2. Multi-step form (6 steps):
   - Step 1: Last asana learned
   - Step 2: Vinyasa quality (3 buttons: kept moving / stopped to breathe / tired paused)
   - Step 3: Bandha/body (3 buttons: body light / finding lightness / heavy body)
   - Step 4: Stable today (multi-select: breath/mudra/drsti/bandha凝视/stillness/strong stamina/strong focus/other)
   - Step 5: Difficult today (multi-select checkboxes)
   - Step 6: Notes (optional textarea)
3. Submit → POST /api/journal/checkin → SelfAssessment node in Neo4j
4. Can add selfie (resized to 600px max, compressed JPEG 0.82, uploaded to Cloudinary)
5. Success screen shows sutra + shareable canvas card

### PHASE 3: TEACHER TRACKING
1. Teachers use assessment-bot.js (Telegram bot via grammy)
2. /api/journal/students lists all students with check-in counts
3. /journal.html teacher dashboard shows all students' last assessments
4. AI summary: POST /api/journal/ai-summary/:studentId → DeepSeek bilingual progress report

---

## KEY API ROUTES

### JOURNAL (server.js — Neo4j)
- POST /api/journal/profile — Create new student node + QR
- POST /api/journal/checkin — Submit self-assessment
- GET /api/journal/students — List all students with last assessment
- GET /api/journal/student/:id — Student + history (PracticeLog + SelfAssessment merged)
- GET /api/journal/profile/:id — Student orientation profile
- GET /api/journal/profiles — Bulk profiles (chinese-workshop students)
- GET /api/journal/qr/:id — QR code for student journal link
- POST /api/journal/qr/batch — Batch QR generation
- GET /api/journal/history/:days — All assessments in last N days
- GET /api/journal/comments/:studentId — Teacher comments (student-facing)
- POST /api/journal/ai-summary/:studentId — AI progress summary via DeepSeek

### JOURNAL (railway-server.js — PostgreSQL)
- Same routes but pgQuery() first, JSON fallback
- Schema: students table (id, name, source, journal_id), journal_entries table

### ORIENTATION
- POST /api/orientations — Save orientation form, create student + orientation nodes
- GET /api/orientations — List all GZ orientation submissions

### UPLOAD
- POST /api/upload/student-photo — Cloudinary upload, stores URL in Neo4j student.photo

---

## PUBLIC PAGES (35+ files in /public)

### CORE JOURNAL
- student.html — Individual student daily check-in form (multi-step, 6 steps)
- journal.html — Teacher dashboard: all students, check-in counts, last dates
- send-links.html — Teacher tool: search students, copy journal links, QR codes

### ORIENTATION PAGES
- orientation-gz.html — Guangzhou WS 2026 (Chinese primary, EN/TH/RU)
- orientation.html — Huizhou WS (English primary)
- orientation-ru.html — Russia WS (Russian/English)

### STUDENT FACING
- student-report.html — Weekly progress report (student view)
- student-assessment.html — Legacy assessment form
- student-ru.html — Russian WS student page
- student-knowledge.html — Asana knowledge browser (from earlier work)

### TEACHER FACING
- teacher-assessment.html — Teacher assessment form (earlier work)
- gz-students.html — GZ student list dashboard
- weekly-report.html — Weekly report generator

### OTHER
- dashboard.html — Main AYBKK dashboard
- mindmap.html — Yoga pose mindmap (Neo4j + PostgreSQL hybrid)
- quiz.html — Standalone quiz tool
- register.html — Registration form
- walkin.html — Walk-in sign-up
- claim.html — Claim page
- faces.html — Student faces grid
- aybkk-redesign.html — Site redesign mockup
- updog-3d.html — 3D yoga pose viewer (Three.js)
- updog-teach.html — 3D teaching tool
- updog-viewer.html — 3D viewer

### QR CODES: /public/qr-cards/
- aybkk-huizhou-qr.png, huizhou-orientation-qr.png, aybkk-class-qr.png, etc.
- Individual student QR codes (generated on demand)

---

## DATA STORES

### Neo4j (local)
- Student nodes (various classType: regular, chinese-workshop, etc.)
- SelfAssessment nodes (HAS_SELF_ASSESSMENT relationship)
- PracticeLog nodes (from earlier work)
- Orientation nodes (gz-* format IDs)
- TeacherComment nodes

### PostgreSQL (Railway — shared with booking)
- students table: id, name, source, journal_id (UUID), ...
- journal_entries: student_id, session_date, vinyasa, bandha, stable_today, difficult_today, last_asana_note, practice_notes, platform, created_at
- teacher_notes: student_id, comment, focus, updated_at
- Cloudinary: photos stored in Neo4j student.photo field

### JSON FILES (/data or local fallback)
- journal-students.json (~94KB, 100+ students from 2024)
- journal-checkins.json
- teacher-comments.json

---

## TELEGRAM BOT (assessment-bot.js)

Teachers assess students via Telegram inline keyboard
Flow: select student → strength → weakness → energy → consistency → practice flow → last asana → pass/fail
Uses grammy framework, connects to Neo4j
Russia flow attached separately (russia-bot.js)
Chinese students flagged with isChineseStudent=true

---

## KEY FILES

- server.js — Main server (54793 bytes, Neo4j-primary)
- railway-server.js — Railway variant (20572 bytes, PostgreSQL-primary)
- api/student-journal.js — Journal API routes (Neo4j-first)
- assessment-bot.js — Telegram teacher assessment bot (45530 bytes)
- public/student.html — Student journal form (75KB, multi-step)
- public/orientation-gz.html — GZ orientation (66KB)
- public/journal.html — Teacher dashboard (28KB)
- public/send-links.html — Send journal links tool
- generate-qr-cards.py — QR code generator for workshop students

---

## GIT HISTORY (what Claude Code CLI worked on)

- Apr 18 (HEAD): Connect mindmap to PostgreSQL booking system student DB
- Apr 18: Fix photo upload failing silently (localStorage quota)
- Apr 18: Add AYBKK logo to journal share card
- Apr 18: Fix dashboard field names (wechat, goals, journal link)
- Apr 18: Fix orientation share card (canvas image, no private link leak)
- Apr 18: Fix orientation form submission (POST /api/orientations)
- Apr 18: Quiz: reveal correct answer only after Continue
- Apr 18: Fix student-report array handling (stableToday/difficultToday)
- Apr 18: Redesign share card (dark vintage, emojis, 2-quiz flow)
- Apr 18: Refine orientation-gz.html (14 fixes)
- Apr 18: Add photo upload, 2 Ashtanga quizzes, GZ orientation
- Apr 17: Add /api/orientations + update GZ orientation page
- Apr 15-17: Build China/Huizhou/Russia orientation pages
- Apr 13-15: Student journal system (assessment-bot, journal.html, student.html)

---

## CONNECTED SYSTEMS

- Cloudinary (photo upload): Uploaded via /api/upload/student-photo
- OpenRouter (AI summaries): deepseek/deepseek-v3-0324 model
- LINE Bot (student bot): line-student-bot.js + line-webhook-handler.js
- Notion (student directory): sync-notion-students.js (connected but not yet synced to Neo4j)

---

## STATUS & GAPS

- ✓ Orientation → Journal flow: COMPLETE
- ✓ Daily self-assessment: COMPLETE
- ✓ QR codes: COMPLETE
- ✓ AI progress summaries: COMPLETE
- ✓ Telegram teacher bot: COMPLETE
- ✓ WeChat share card: COMPLETE (canvas-generated image)
- ? Real student data from Railway PostgreSQL: Need to check if GZ students are actually in the DB
- ? Notion sync: Notion still not synced to Neo4j
- ? Railway deployment: Needs verification (is aybkk-ashtanga.up.railway.app live?)
