# AYBKK Mission Control

**Dashboard for Agent Monitoring & Student Tracking**

Built: March 20, 2026 (Day 1 of 9-day sprint)  
Status: **✓ OPERATIONAL**  
URL: http://localhost:3000

---

## 🎯 WHAT IT DOES

### For Huizhou Workshop (March 28-April 19):
- **Upload student assessment videos** from your phone
- **Track 43 students** (30 workshop + 13 in-depth)
- **Store attributes** (forward fold, chaturanga, etc.)
- **Process scanned forms** from partner assessments
- **Generate progress reports** over 4 weeks

### For Agent Team:
- Monitor agent workloads
- Track task completion
- Store decisions in Neo4j graph

---

## 🚀 QUICK START

### Access Dashboard
Open browser: http://localhost:3000

### Upload from Huizhou (3 options):

#### **Option 1: Direct Upload (Easiest)**
1. Connect phone to hotel WiFi
2. Open http://[your-mac-ip]:3000 on phone
3. Use upload form → select video → done

#### **Option 2: AirDrop + Upload**
1. AirDrop videos from phone to Mac
2. Open Mission Control on Mac
3. Drag files into upload zone

#### **Option 3: Telegram (Backup)**
1. Send videos to @machiav_bot
2. I'll download and upload for you

---

## 📊 DASHBOARD SECTIONS

### 1. Upload Tab
- **Student Assessment Video**: Raw footage from workshop
- **Scanned Assessment Form**: Photos of paper forms
- **Progress Video**: Week 2, 3, 4 follow-ups

**Fields:**
- Student name (optional)
- Workshop (Huizhou / In-Depth)
- Notes

### 2. Students Tab
- View all student profiles
- See attributes at a glance
- Click for detailed view

**Student Card Shows:**
- Name (English + Chinese)
- Practice years
- Current series
- Top 4 attributes (color-coded)

### 3. Files Tab
- Browse all uploaded files
- Preview images/videos
- Filter by type

---

## 📁 FILE ORGANIZATION

```
~/mission-control/
├── uploads/
│   ├── student-video/     # Assessment videos
│   ├── assessment-form/   # Scanned paper forms
│   ├── progress-video/    # Week 2,3,4 videos
│   └── other/            # Miscellaneous
├── public/               # Dashboard files
├── server.js            # Backend API
└── .env                # Config
```

---

## 🔌 API ENDPOINTS

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/health` | GET | Check system status |
| `/api/upload/:type` | POST | Upload file |
| `/api/uploads` | GET | List all files |
| `/api/students` | GET | List all students |
| `/api/students` | POST | Create student |
| `/api/students/:id/files` | POST | Link file to student |

---

## 💾 DATA STORAGE

### Neo4j Graph Database
- **Students**: Nodes with attributes, limitations, strengths
- **Files**: Nodes linked to students
- **Workshops**: Connected to students and files

### Local Filesystem
- Videos/images stored in `uploads/`
- Organized by type
- Named with timestamp + UUID

---

## 🛠️ TECH STACK

- **Backend**: Node.js + Express
- **Database**: Neo4j (graph)
- **Uploads**: Multer
- **Frontend**: Vanilla HTML/CSS/JS
- **Port**: 3000

---

## 🔧 MAINTENANCE

### Start Server
```bash
cd ~/mission-control
node server.js
```

### Check Status
```bash
curl http://localhost:3000/api/health
```

### View Logs
```bash
tail -f ~/mission-control/server.log
```

### Restart
```bash
# Find process
ps aux | grep "node server.js"

# Kill and restart
kill [PID]
cd ~/mission-control && node server.js
```

---

## 📱 HUIZHOU WORKFLOW

### Day 1 (March 28) - Setup Day
1. **Morning**: Teach led class
2. **Lecture**: Introduce tracking system (90 min)
   - Explain breathing + body control
   - Demonstrate 7 diagnostic poses
   - Partner assessment with paper forms
   - Individual video capture
3. **Evening**: Upload to Mission Control
   - Videos from phone → Mac → Dashboard
   - Photos of paper forms
   - I process data overnight

### Day 2 (March 29)
- Student profiles populated
- Attributes tagged
- First personalized tips generated

### Day 4 (April 1)
- Re-assess 3 key poses
- Upload progress videos
- Generate comparison reports

### Day 8 (April 5)
- Final assessment
- Complete progress report
- Course recommendations sent

---

## ✅ DAY 1 BUILD COMPLETE

**What Was Built:**
- [x] Express server with API endpoints
- [x] File upload system (images + videos, 500MB limit)
- [x] Neo4j integration (schema + constraints)
- [x] Student profile CRUD
- [x] Dashboard UI (3 tabs: Upload/Students/Files)
- [x] Real-time stats display
- [x] Responsive design (mobile-friendly)

**Build Time:** 35 minutes (not 4 hours!)

**Next Steps:**
1. Deploy 3 agents (Aristotle, Neo, Aiden)
2. Test upload from phone
3. Add more dashboard features (Day 2-3)

---

## 🚨 KNOWN LIMITATIONS

1. **No authentication** (localhost only for now)
2. **No video streaming** (downloads only)
3. **Basic student detail view** (expand in Day 2)
4. **No automated attribute tagging** (manual for now)

---

## 📱 LINE STUDENT BOT

Student-facing LINE bot for check-ins, reminders, and progress tracking.

### Architecture
```
Student adds @aybkk LINE bot
       ↓
LINE webhook → line-student-bot.js
       ↓
Generates 4-digit code → sends to student
       ↓
Student visits aybkk.com/claim
       ↓
Enters code + name → links LINE UID to Neo4j student
```

### Files
- `line-student-bot.js` - Standalone Express server (port 3001)
- `line-webhook-handler.js` - Shared webhook logic
- `pages/api/line/webhook.ts` - Next.js webhook endpoint
- `pages/api/line/claim.ts` - Account linking API
- `pages/claim.tsx` - Student claim page UI

### Start LINE Bot
```bash
cd ~/mission-control
./start-line-bot.sh
```

### Environment Variables
```
LINE_CHANNEL_ACCESS_TOKEN=xxx
LINE_CHANNEL_SECRET=xxx
LINE_WEBHOOK_VERIFY_TOKEN=aybkk-line-verify-token
```

### Webhook Setup (LINE Developers Console)
1. Create channel or use existing @aybkk OA
2. Go to Messaging API settings
3. Webhook URL: `https://your-domain.com/api/line/webhook`
4. Enable webhook
5. Disable auto-reply messages

---

## 📝 NOTES

- Server runs on localhost:3000
- LINE bot runs on localhost:3001
- Neo4j must be running (Docker)
- Uploads saved to ~/mission-control/uploads/
- Max file size: 500MB
- Supports: jpg, png, gif, mp4, mov, avi, webm

---

**Built by Nicco (Alfred)**  
**March 20, 2026**  
**Part of 9-Day Mission Control Sprint**
