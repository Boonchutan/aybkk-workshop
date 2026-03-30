# AYBKK Automation Plan - Updated
## Date: March 25, 2026

---

## 1. REZERW LOGIN/SCRAPE - FINDINGS

### What I Found

**Login URL:** https://business.rezerv.co

**Issues Encountered:**
1. React SPA with form state reset issues - browser automation has trouble maintaining input state
2. CloudFront blocks direct API calls (POST to /api/* returns 403)
3. Invisible reCAPTCHA active on login page
4. AYBKK.com domain shows "Customer Facing Booking Website Temporarily Unavailable" error

**Rezerw QR Check-in Flow (from research):**
1. Student books class on Rezerw
2. Student receives booking confirmation (email/SMS)
3. Student arrives at studio → shows booking QR code
4. Teacher/studio scans QR to mark attendance in Rezerw admin
5. Data stored in Rezerw's system

### Daily Attendance Extraction Options

| Method | Pros | Cons |
|--------|------|------|
| Browserbase stealth browser | Works with anti-detect | Rezerw React resets form, slow |
| Puppeteer/Playwright local | Full control | Need to install, OTP issue |
| Rezerw API inquiry | Clean integration | No public API, need to ask |
| QR bypass (our own) | No Rezerw dependency | Student must scan our QR |

### Recommended Approach: Puppeteer with OTP Handling

**Steps:**
1. Install puppeteer in mission-control
2. Write script: `rezerv-scraper.js`
   - Launch headless Chrome
   - Navigate to login
   - Fill credentials (fast, before React resets)
   - Handle OTP if triggered
   - Navigate to Reports → Attendance
   - Export today's check-ins
3. Run daily via cron at 6 AM

**OTP Issue:**
- Rezerw sends OTP to email when logging from new device/location
- OTP expires quickly (Boonchu confirmed)
- Solution: Forward Rezerw emails to me? Or use email API to fetch OTP

---

## 2. ASSESSMENT BOT WORKFLOW (Current)

### Bot: @AYBKKstudentProgress_bot
### File: ~/mission-control/assessment-bot.js

### Flow Steps (12 Steps)

```
STEP 0: /start
├── Show welcome message (EN/TH/ZH)
└── Show language selection buttons

STEP 1: Language Selected
└── → Show main menu:
    ├── 🆕 New Assessment
    ├── 📊 View History
    └── ⚙️ Settings

STEP 2: Select Student
├── Type name to search (fuzzy search)
├── "all" shows all students
├── Sorted by: assessment count DESC, tag count DESC
├── Only active members (membership not expired)
└── Inline keyboard with student name buttons

STEP 3: Select Strengths (Multi-select, weekly reset)
├── Show predefined strength tags from Neo4j
├── Toggle buttons to add/remove
├── "➕ Add New Tag" option
└── Done → Next

STEP 4: Select Weaknesses (Multi-select, weekly reset)
├── Same pattern as strengths
└── Done → Next

STEP 5: Energy Level (Single-select)
├── 🔴 High
├── 🟡 Medium
└── ⚪ Low

STEP 6: Practice Consistency (Single-select)
├── 🟢 Proper Vinyasa
├── 🟡 Rest Often
└── 🔴 Too Much Distractions

STEP 7: Practice Flow (Single-select)
├── Same options as STEP 6

STEP 8: Last Asana Comment (Free text)
├── "Type your comment about the last asana they learned"
└── Max 500 chars

STEP 9: Last Asana Pass? (Single-select)
├── ✅ PASS - Ready for next asana
└── ⏸️ HOLD - Not ready yet

STEP 10: What to Fix First (Free text)
├── "What should they focus on? (Short description)"
└── Max 200 chars

STEP 11: Select Teacher (Single-select)
├── Boonchu, Jamsai, M (configurable in code)
└── Records who did the assessment

STEP 12: Review & Confirm
├── Show all selections in formatted summary
├── Edit button for each section
└── ✅ Confirm & Save → Neo4j `:Assessment` node
```

### Data Model (Neo4j)

```cypher
(:Assessment {
  id: randomUUID(),
  teacher_id: string,
  teacher_name: string,
  energy_level: 'high' | 'medium' | 'low',
  practice_behavior: string,
  last_asana_comment: string,
  last_asana_pass: boolean,
  to_fix_now: string,
  created_at: datetime
})
(:Assessment)-[:FOR_STUDENT]->(:Student)
```

### Improvement Options

1. **Auto-suggest students who checked in today**
   - Needs: Rezerw attendance data → Neo4j `:Session` nodes
   - When teacher starts assessment, show "Today's Students" first

2. **Share assessment to group chat**
   - After save, forward summary to teacher group
   - Transparency across all teachers

3. **Thai/Chinese voice input**
   - Use LINE's voice recognition
   - Convert to text for free-text fields

4. **Quick assessment mode**
   - 1-tap: Energy + One word → Save
   - For fast updates after class

5. **Weekly summary report**
   - Every Sunday noon
   - AI-generated summary per student
   - Senior teacher supportive voice

---

## 3. ATTENDANCE SYNC ARCHITECTURE

### Vision: Complete Student Journey

```
STUDENT:
1. Books class on Rezerw
       ↓
2. Checks in via QR scan at studio
       ↓
3. LINE Bot receives check-in confirmation (maybe via email forward)
       ↓
4. At noon: LINE Bot sends journal collection message
       ↓
5. Student replies: practice notes
       ↓
6. Data stored in Neo4j as `:Session`
       ↓
7. Sunday: AI summary + course recommendation
```

### Option A: LINE Bot Check-in (Recommended)

**Flow:**
1. Student scans our QR code when arriving
2. QR opens LINE Bot with pre-filled check-in
3. LINE Bot confirms: "You're checked in for [Class] at [Time]"
4. Data saved to Neo4j: `(:Session {student_line_id, class, time})`
5. At noon: LINE Bot queries today's sessions → sends journal Q&A

**Pros:**
- No dependency on Rezerw scraping
- Works with any booking system
- Student-friendly (LINE is Thai default)
- Full control over data

**Cons:**
- Student must remember to scan
- Need LINE Official Account setup
- Need student LINE IDs in Neo4j

### Option B: Rezerw Scraping (Still Pursuing)

**Flow:**
1. Browser automation logs into Rezerw admin
2. Navigates to Reports → Attendance
3. Extracts today's check-ins (CSV/Excel or scrape)
4. Saves to Neo4j as `:Session` nodes
5. LINE Bot queries sessions for noon message

**Pros:**
- Automatic, no student action needed
- Accurate attendance data

**Cons:**
- Fragile (depends on Rezerw UI)
- Blocked by reCAPTCHA + OTP
- Rezerw might change UI anytime

### Option C: Rezerw Email Forwarding

**Flow:**
1. Rezerw sends booking confirmation email
2. Forward email to bot email address
3. Bot parses: student name, class, time
4. This is "booked" not "checked in"
5. Cross-reference with LINE check-in for actual attendance

**Pros:**
- No scraping needed
- Rezerw has email already

**Cons:**
- Need to configure email forwarding
- Not real-time check-in

---

## 4. DAILY NOON JOURNAL COLLECTION

### Proposed LINE Bot Flow

```
AT NOON (12:00 PM Bangkok time):
─────────────────────────────
Check Neo4j: Who checked in today?

FOR EACH student:
  Send LINE message:
  
  "Hi [Name]! 🙏
  
  How was your practice today?
  
  Reply with:
  1. 😊 Good / 😐 Okay / 😔 Tough
  2. What felt best? (optional)
  3. What challenged you? (optional)
  4. Any notes? (optional)
  
  Your responses help us support you better 🧘"
  
  ──────────────────────────────
  
  Student replies → stored in Neo4j
  Sunday → AI generates weekly summary
```

### Data Storage

```cypher
(:JournalEntry {
  id: string,
  date: date,
  mood: 'good' | 'okay' | 'tough',
  felt_best: string,
  challenged: string,
  notes: string,
  created_at: datetime
})
(:JournalEntry)-[:FOR_STUDENT]->(:Student)
```

---

## 5. IMMEDIATE NEXT STEPS

| # | Task | Status | Notes |
|---|------|--------|-------|
| 1 | Set up Puppeteer for Rezerw scraping | TODO | Need to install + test |
| 2 | Handle Rezerw OTP | BLOCKED | Need email access for OTP |
| 3 | Set up LINE Bot for check-in | TODO | Need LINE OA setup |
| 4 | Build noon journal collection | TODO | After LINE setup |
| 5 | Connect attendance → assessment | TODO | After scraping works |

---

## 6. QUESTIONS FOR CONFIRMATION

1. **OTP Email Access:** Can I get access to the email that receives Rezerw OTPs? (To auto-capture OTP during login)

2. **LINE Official Account:** Is there an existing LINE OA for AYBKK, or should I create one?

3. **Student LINE IDs:** Do we have student LINE IDs in Neo4j, or do we need to collect them?

4. **Priority:** Which should I tackle first?
   - A) Rezerw scraping (hard, but gives attendance)
   - B) LINE Bot check-in (easier, no dependency on Rezerw)
