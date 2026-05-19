// Initial Year Planner contents, committed so the DB can seed itself
// on first boot (data/ is gitignored). Source of truth after seed is Postgres.
module.exports = {
  "lanes": [
    {
      "id": "school",
      "name": "Kids' School & Holidays",
      "color": "#3f5d3a"
    },
    {
      "id": "travel",
      "name": "Travel & Workshops",
      "color": "#8a3f1c"
    },
    {
      "id": "aybkk",
      "name": "AYBKK",
      "color": "#5a3c1c"
    },
    {
      "id": "tee",
      "name": "Tee Shirt Plan",
      "color": "#9a6a14"
    },
    {
      "id": "online",
      "name": "Online Class",
      "color": "#2f5a6b"
    },
    {
      "id": "personal",
      "name": "Personal",
      "color": "#6b2f3f"
    }
  ],
  "events": [
    {
      "id": "ev_q1",
      "title": "Q1: Foundation",
      "laneId": "aybkk",
      "start": "2026-01-01",
      "end": "2026-03-31",
      "color": "",
      "note": "Strategic block from DASHBOARD, Financial Freedom 2026. Neo4j live, student intelligence system, first course outlined, merch shoot, content system.",
      "backdrop": true
    },
    {
      "id": "ev_q2",
      "title": "Q2: Build",
      "laneId": "aybkk",
      "start": "2026-04-01",
      "end": "2026-06-30",
      "color": "",
      "note": "Online course #1 launched, merch shop live, social automation, first digital product.",
      "backdrop": true
    },
    {
      "id": "ev_q3",
      "title": "Q3: Scale",
      "laneId": "aybkk",
      "start": "2026-07-01",
      "end": "2026-09-30",
      "color": "",
      "note": "Course #2, affiliate system, workshop series automated, teaching hours down 20%.",
      "backdrop": true
    },
    {
      "id": "ev_q4",
      "title": "Q4: Optimize",
      "laneId": "aybkk",
      "start": "2026-10-01",
      "end": "2026-12-31",
      "color": "",
      "note": "All 5 streams generating, passive income > 30%, systems delegated, plan 2027.",
      "backdrop": true
    },
    {
      "id": "ev_idp1",
      "title": "In-depth CN #2: Part 1 (Bangkok)",
      "laneId": "aybkk",
      "start": "2026-01-22",
      "end": "2026-01-31",
      "color": "#7a5212",
      "note": "In-depth Mysore Chinese Program #2, 10 days at AYBKK Bangkok.",
      "priority": "high"
    },
    {
      "id": "ev_idp2",
      "title": "In-depth CN #2: Part 2 (Huizhou)",
      "laneId": "aybkk",
      "start": "2026-04-02",
      "end": "2026-04-11",
      "color": "#7a5212",
      "note": "In-depth Mysore Chinese Program #2, 10 days in Huizhou.",
      "priority": "high"
    },
    {
      "id": "ev_idp3",
      "title": "In-depth CN #2: Part 3 (Zhuhai)",
      "laneId": "aybkk",
      "start": "2026-07-23",
      "end": "2026-08-01",
      "color": "#7a5212",
      "note": "In-depth Mysore Chinese Program #2, 10 days in Zhuhai.",
      "priority": "high"
    },
    {
      "id": "ev_nyp",
      "title": "AYBKK New Year Party",
      "laneId": "aybkk",
      "start": "2026-01-01",
      "end": "2026-01-01",
      "color": "",
      "note": "Date to confirm. Monk 11am, eat 12pm, talk 1pm, Ashtanga games 1:25pm.",
      "priority": "low"
    },
    {
      "id": "ev_jp",
      "title": "Japan family trip (Boone + Jai)",
      "laneId": "travel",
      "start": "2026-02-15",
      "end": "2026-02-22",
      "color": "",
      "note": "Nagoya, Gero Onsen, Takayama, ski. Fly home Feb 22."
    },
    {
      "id": "ev_hz",
      "title": "Huizhou WS (China)",
      "laneId": "travel",
      "start": "2026-03-28",
      "end": "2026-04-19",
      "color": "",
      "note": "Flights TG668 Mar 27 BKK→CAN, TG669 Apr 24 CAN→BKK. Team: Boonchu, Jamsai, Boone, Jai, Thananyada. Host: Edison/Amy."
    },
    {
      "id": "ev_gz",
      "title": "Guangzhou WS",
      "laneId": "travel",
      "start": "2026-04-20",
      "end": "2026-04-25",
      "color": "",
      "note": "6 days. Led + 3 mini workshops + 1 conference talk. Room 2504.",
      "priority": "high"
    },
    {
      "id": "ev_ru",
      "title": "Russia: St Petersburg + Moscow",
      "laneId": "travel",
      "start": "2026-04-30",
      "end": "2026-05-12",
      "color": "",
      "note": "SPB May 1-3, Moscow May 6-10. Return SVO May 11. Host Sergey. Translators",
      "priority": "high"
    },
    {
      "id": "ev_mm",
      "title": "Maoming WS",
      "laneId": "travel",
      "start": "2026-06-13",
      "end": "2026-06-16",
      "color": "",
      "note": "Host 冯一一 (Feng Yiyi). Team: Boonchu + Jamsai."
    },
    {
      "id": "ev_sz",
      "title": "Suzhou WS",
      "laneId": "travel",
      "start": "2026-06-19",
      "end": "2026-06-23",
      "color": "",
      "note": "Host Vera. Team: Boonchu + Jamsai."
    },
    {
      "id": "ev_sc",
      "title": "Sichuan Xichang WS",
      "laneId": "travel",
      "start": "2026-06-24",
      "end": "2026-06-28",
      "color": "",
      "note": "Kama Yoga Pilates Studio. Host Maoni (猫腻)."
    },
    {
      "id": "ev_zh",
      "title": "Zhuhai WS",
      "laneId": "travel",
      "start": "2026-07-23",
      "end": "2026-08-08",
      "color": "",
      "note": "Jul 23–Aug 1 + Aug 2-8. Manager Su Zi (苏紫). Overlaps In-depth Part 3.",
      "priority": "high"
    },
    {
      "id": "ev_oc1",
      "title": "Online course #1: launch target",
      "laneId": "online",
      "start": "2026-06-25",
      "end": "2026-06-30",
      "color": "",
      "note": "Target from 2026 plan (Q2 build). Adjust once scoped."
    },
    {
      "id": "ev_oc2",
      "title": "Online course #2: launch target",
      "laneId": "online",
      "start": "2026-09-24",
      "end": "2026-09-30",
      "color": "",
      "note": "Target from 2026 plan (Q3 scale)."
    },
    {
      "id": "ev_tee_ru",
      "title": "Russia tees: 60 pcs",
      "laneId": "tee",
      "start": "2026-04-01",
      "end": "2026-04-28",
      "color": "",
      "note": "Inferred prep window before Russia. SPB 38, Moscow 22. Confirm sizes.",
      "priority": "low"
    },
    {
      "id": "ev_tee_jun",
      "title": "China June tees (Maoming/Suzhou/Sichuan)",
      "laneId": "tee",
      "start": "2026-05-15",
      "end": "2026-06-04",
      "color": "",
      "note": "Inferred prep window. Maoming S2/M8/L9/XL1; Suzhou + Sichuan TBC.",
      "priority": "low"
    },
    {
      "id": "ev_tee_zh",
      "title": "Zhuhai tees",
      "laneId": "tee",
      "start": "2026-06-20",
      "end": "2026-07-15",
      "color": "",
      "note": "Inferred prep window before Zhuhai.",
      "priority": "low"
    },
    {
      "id": "ev_sch_winter1",
      "title": "School holiday: Winter / New Year",
      "laneId": "school",
      "start": "2026-01-01",
      "end": "2026-01-12",
      "color": "",
      "note": "AIS Bangkok. Term 2 starts Jan 13 (Jan 12 teachers-only, no students)."
    },
    {
      "id": "ev_sch_makha",
      "title": "School closed: Makha Bucha Day",
      "laneId": "school",
      "start": "2026-03-03",
      "end": "2026-03-03",
      "color": "",
      "note": "Single closed day mid Term 2.",
      "priority": "low"
    },
    {
      "id": "ev_sch_feb",
      "title": "School holiday: Feb mid-term break",
      "laneId": "school",
      "start": "2026-02-16",
      "end": "2026-02-18",
      "color": "",
      "note": "3-day break. Overlaps the Japan trip window."
    },
    {
      "id": "ev_sch_songkran",
      "title": "School holiday: End of Term 2 + Songkran",
      "laneId": "school",
      "start": "2026-04-10",
      "end": "2026-04-20",
      "color": "",
      "note": "Term 2 last day Apr 9. Term 3 starts Apr 21 (Apr 20 teachers-only)."
    },
    {
      "id": "ev_sch_coronation",
      "title": "School closed: Coronation Day",
      "laneId": "school",
      "start": "2026-05-04",
      "end": "2026-05-04",
      "color": "",
      "note": "Single closed day in Term 3.",
      "priority": "low"
    },
    {
      "id": "ev_sch_summer",
      "title": "School holiday: Summer (year ends Jun 12)",
      "laneId": "school",
      "start": "2026-06-13",
      "end": "2026-08-12",
      "color": "",
      "note": "New academic year Term 1 starts Aug 13, 2026. Longest travel window of the year."
    },
    {
      "id": "ev_sch_summerschool",
      "title": "Summer School (optional)",
      "laneId": "school",
      "start": "2026-06-15",
      "end": "2026-07-10",
      "color": "#6f8a44",
      "note": "Optional, sits inside the summer holiday.",
      "priority": "low"
    },
    {
      "id": "ev_sch_oct13",
      "title": "School closed: King Rama IX Memorial",
      "laneId": "school",
      "start": "2026-10-13",
      "end": "2026-10-13",
      "color": "",
      "note": "Single closed day.",
      "priority": "low"
    },
    {
      "id": "ev_sch_oct",
      "title": "School holiday: Oct mid-term break",
      "laneId": "school",
      "start": "2026-10-19",
      "end": "2026-10-23",
      "color": "",
      "note": "5-day break (2026-27 calendar)."
    },
    {
      "id": "ev_sch_winter2",
      "title": "School holiday: Winter break (into 2027)",
      "laneId": "school",
      "start": "2026-12-21",
      "end": "2026-12-31",
      "color": "",
      "note": "Term 1 (2026-27) last day Dec 18. Resumes Jan 12, 2027."
    }
  ]
};
