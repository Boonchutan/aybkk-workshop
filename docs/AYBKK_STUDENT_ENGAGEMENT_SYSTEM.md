# AYBKK Student Engagement System - Architecture v1.0
**Date:** March 21, 2026  
**Status:** PLANNING  
**Author:** Neo (Tech Coder)

---

## 1. SYSTEM OVERVIEW

### Purpose
Daily student check-in system with weekly AI-generated progress reports and course recommendations.

### Data Flow
```
Student Books (Rezerw) → Check-in (QR) → Daily Q&A Bot → Neo4j
                                       ↓
                              Weekly Summary (AI)
                                       ↓
                              Sunday Report → Student
```

---

## 2. CURRENT INFRASTRUCTURE

### AYBKK.com Stack
- **Platform:** Rezerw (Polish booking system) - rezerw.com
- **Hosting:** CloudFront CDN
- **Framework:** SPA (likely Next.js/React)
- **Features Found:**
  - Timetable with class schedule
  - Online/In-person class options
  - Book Now buttons
  - Memberships and Packages
  - My Bookings (logged-in area)
  - Contact/FAQ
  - WhatsApp chat widget

### Mission Control Stack
- **Location:** ~/mission-control/
- **Framework:** Express.js + Neo4j
- **Dashboard:** Next.js (localhost:3000)
- **Existing Features:**
  - Student tracking
  - File uploads
  - Progress charts (Chart.js)
  - Timeline view
  - Task management via Neo4j

---

## 3. NEO4J DATA MODEL

### Nodes
```cypher
(:Student {
  id: string,
  name: string,
  email: string,
  phone: string,
  line_id: string,
  wechat_id: string,
  whatsapp: string,
  ig_handle: string,
  fb_id: string,
  created_at: datetime,
  platform: 'line' | 'wechat' | 'whatsapp' | 'ig' | 'fb'
})

(:Tag {
  name: string,  // e.g., 'forwardBend', 'bandha', 'backbend'
  category: string  // 'weakness' | 'strength' | 'interest'
})

(:Asana {
  name: string,  // e.g., 'Paschimattanasana'
  sanskrit: string,
  series: 'primary' | 'intermediate' | 'advanced'
})

(:Course {
  id: string,
  title: string,
  description: string,
  url: string,
  tags: [string]  // related tags
})

(:Session {
  id: string,
  date: date,
  class_name: string,
  mood: string,  // from Q&A
  energy: number,  // 1-5
  note: string,  // optional free text
  completed: boolean
})

(:WeeklyReport {
  id: string,
  week_start: date,
  week_end: date,
  sent_at: datetime,
  opened: boolean
})
```

### Relationships
```cypher
(:Student)-[:HAS_WEAKNESS]->(:Tag)
(:Student)-[:HAS_STRENGTH]->(:Tag)
(:Student)-[:INTERESTED_IN]->(:Tag)
(:Student)-[:PRACTICED {date}]->(:Asana)
(:Student)-[:CHECKED_IN]->(:Session)
(:Session)-[:TAGGED_WITH]->(:Tag)
(:Tag)-[:NEEDED_FOR]->(:Asana)
(:Tag)-[:HELPS_WITH]->(:Course)
(:Course)-[:TARGETED_TO]->(:Tag)
```

---

## 4. DAILY Q&A FLOW

### Trigger
1. Student books class via Rezerw
2. Rezerw sends email/SMS confirmation
3. **Problem:** Rezerw may not have webhook for external triggers

### Alternative Trigger Options
| Option | Pros | Cons |
|--------|------|------|
| QR Code at studio | Direct, in-person | Need hardware |
| Rezerw API | Automatic | May not exist |
| Manual sync | Simple | Delay, manual work |
| Student self-check-in | No integration needed | Requires habit |

### Q&A Structure (2 minutes max)
```
Q1: How was your practice today? [😊 Good] [😐 Okay] [😔 Tough]
Q2: What felt best? [Select from strengths]
Q3: What challenged you? [Select from weaknesses]
Q4: How's your energy? [1-5 scale]
Q5: Anything to note? [Optional text input]
```

### Copy
> "Hi [Name]! 👋 Your practice notes from today will be saved and sent back to you this Sunday for your reflection. See you on the mat!"
> 
> "We'll collect your notes and send them back so you can track your progress 📝"

---

## 5. PLATFORM INTEGRATION

### Priority by Student Type
| Platform | Audience | Integration |
|----------|----------|-------------|
| LINE | Thai students | LINE Official Account + Messaging API |
| WeChat | Chinese students | WeChat Work / Mini Program |
| WhatsApp | International | WhatsApp Business API |
| Instagram | All | IG Direct Bot |
| Facebook | All | FB Messenger Bot |

### Unified Bot Framework
- Single logic layer
- Platform-specific adapters
- Multi-language support (Thai, English, Chinese)

---

## 6. WEEKLY REPORT SYSTEM

### Timing
- **Every Sunday at 12:00 PM (noon)**

### Report Content
```
Hi [Name]! Here's your week in review 🧘

📅 Classes attended: X
🔥 Mood trend: ↑
💪 Most common strength: [X]
🎯 Working on: [X]
📈 Consistency: [Visual bar chart]

💬 Your notes this week:
- "Felt really good in backbends"
- "Need to focus on hip opening"

🎯 Based on your progress, we recommend:
[Course Name] - [Brief description]
[Link]

Keep up the practice! Your dedication is showing.
— AYBKK Team
```

### AI Generation
- Read last 7 days of check-ins
- Identify patterns
- Generate supportive summary
- Select relevant course based on Tags
- Senior teacher voice (not salesy)

---

## 7. COURSE RECOMMENDATION ENGINE

### Logic
```javascript
1. Get student's weakness tags
2. Get student's interest tags
3. Find courses where course.tags overlaps
4. Rank by relevance score
5. Select top recommendation
6. Embed naturally in weekly report
```

### Example
- Student has: weakness=['tightHamstrings'], interest=['backbends']
- Course: "Hamstring Opening Flow" (tags: ['tightHamstrings', 'flexibility'])
- Match score: 1.0

---

## 8. REZERV INTEGRATION ANALYSIS

### Findings
- Rezerw is a Polish booking platform (rezerw.com)
- Used by fitness/yoga studios in Europe
- AYBKK uses white-label version
- No public API documentation found

### Integration Options
| Method | Feasibility | Effort |
|--------|-------------|--------|
| Official API | Unknown - need to contact Rezerw | High |
| Web scraping | Possible but fragile | Medium |
| QR check-in bypass | Add our own QR + link to Rezerw | Low |
| Student self-reporting | Works, no integration needed | Lowest |

### Recommendation
**Start with QR code + self-check-in approach:**
1. Keep Rezerw for booking (no change)
2. Add our own QR at studio entrance
3. QR → opens LINE/WhatsApp check-in
4. Later: ask Rezerw about API access for tighter integration

---

## 9. BUILD ROADMAP

### Phase 1: Foundation (This Week)
- [ ] Design Neo4j schema
- [ ] Set up Neo4j constraints/indexes
- [ ] Create basic Express API for student operations
- [ ] Build LINE bot (Thai students - priority)
- [ ] Design Q&A flow UI

### Phase 2: Daily Q&A (Next Week)
- [ ] Implement Q&A with buttons + text input
- [ ] Store responses in Neo4j
- [ ] Test with small group (5-10 students)
- [ ] Add multi-language support

### Phase 3: Weekly Reports (Week 3)
- [ ] Build weekly aggregation query
- [ ] Integrate AI for report generation
- [ ] Set up scheduled sending (Sunday noon)
- [ ] Track open rates

### Phase 4: Course Recommendations (Week 4)
- [ ] Create Course node structure
- [ ] Build recommendation algorithm
- [ ] Embed in weekly reports
- [ ] Track click-through on course links

### Phase 5: Multi-Platform (Week 5+)
- [ ] WeChat bot (Chinese students)
- [ ] WhatsApp Business API
- [ ] Instagram/FB integration

---

## 10. TECHNICAL DECISIONS NEEDED

1. **Neo4j connection** - Current: bolt://localhost:7687 (OK)
2. **Bot hosting** - Where to run LINE/WhatsApp bots?
3. **QR system** - Own QR or integrate with Rezerw?
4. **AI provider** - Claude for weekly reports?
5. **Course data** - Where are courses stored? Notion?

---

## 11. OPEN QUESTIONS FOR BOONCHU/NICCO

1. Rezerw API access - can we get credentials from them?
2. Course content - where is it stored? Can we create a simple course catalog?
3. QR code hardware - who handles this?
4. LINE Official Account - do we have one set up?
5. International student data - how to identify WeChat users?

---

## APPENDIX: AYBKK.COM FEATURES MAP

```
Home
├── Hero (Promo: Buy 1 Get 1 Free)
├── Mysore/Led class info
├── About AYBKK
├── Location (S31 Hotel, 8th floor)
├── Events (Sharath Jois memorial)
└── Footer (Powered by Rezerv)

Classes → Timetable
├── Date picker
├── Grid/List view toggle
├── Class cards:
│   ├── Time
│   ├── Class name (e.g., "Led Primary series")
│   ├── Location (Online / AYBKK at S31 hotel)
│   └── [Book Now] button
└── Booking modal (login/signup flow)

Pricing
├── Memberships
├── Packages
└── View Memberships

My Bookings (logged in)
├── Upcoming classes
├── Past classes
└── Cancel/Reschedule

Contact Us
├── WhatsApp chat widget (floating)
├── Social links (FB, IG)
└── FAQ
```

---

*Document Version: 1.0*  
*Next Update: After PoC with Phase 1*
