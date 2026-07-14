#!/usr/bin/env node
// generate-hefei-roster.js
// Builds public/rosters/hefei.json (the offline roster the iPad station reads)
// and one QR PNG per student in public/qr-cards/hefei/.
//
// Input (optional): hefei-students.json  OR  hefei-students.csv in this folder.
//   JSON: [{ "name":"燕子", "package":"Full", "journalId":"<uuid>", "phone":"" }, ...]
//   CSV : header row with columns  name,package[,journalId,phone,size]
// If no input file is found, a small SAMPLE cohort is generated so you can test.
//
// Env:
//   BASE_URL=https://aybkk-ashtanga.up.railway.app   (goes into the printed QR)
//   QR_MODE=short|full                                (short => /s/CODE, full => /student.html?id=…)
//
// Re-run any time the paid list changes; it is idempotent per name+journalId.

const fs = require("fs");
const path = require("path");
const QRCode = require("qrcode");
const { v4: uuidv4, v5: uuidv5 } = require("uuid");
const AYBKK_NS = uuidv5("aybkk.org/hefei-2026", uuidv5.DNS); // stable namespace

const BASE_URL = (process.env.BASE_URL || "https://aybkk-ashtanga.up.railway.app").replace(/\/$/, "");
const QR_MODE  = process.env.QR_MODE || "short";

// ── EDIT ME: the Hefei session list ─────────────────────────────────────────
const SESSIONS = [
  { code: "D1-LED", label: "Day 1 · Led Primary",   date: "2026-07-16" },
  { code: "D1-WS",  label: "Day 1 · Workshop 1",    date: "2026-07-16" },
  { code: "D2-MY",  label: "Day 2 · Mysore",        date: "2026-07-17" },
  { code: "D2-WS",  label: "Day 2 · Workshop 2",    date: "2026-07-17" },
  { code: "D3-MY",  label: "Day 3 · Mysore",        date: "2026-07-18" },
  { code: "D3-WS",  label: "Day 3 · Workshop 3",    date: "2026-07-18" },
  { code: "D4-MY",  label: "Day 4 · Mysore",        date: "2026-07-19" },
  { code: "D4-WS",  label: "Day 4 · Workshop 4",    date: "2026-07-19" },
  { code: "D5-LED", label: "Day 5 · Led P+I",       date: "2026-07-20" },
  { code: "D5-QA",  label: "Day 5 · Q&A + Photo",   date: "2026-07-20" },
];

// ── EDIT ME: what each package is allowed to attend ─────────────────────────
// "*" means every session. Full/host/translator/teacher are treated as "*".
const ALL = ["*"];
const PACKAGE_MAP = {
  "full": ALL, "host": ALL, "translator": ALL, "teacher": ALL,
  "weekend": ["D3-MY", "D3-WS", "D4-MY", "D4-WS"],        // Sat + Sun
  "3day":    ["D2-MY", "D2-WS", "D3-MY", "D3-WS", "D4-MY", "D4-WS"],
  "mysore":  ["D2-MY", "D3-MY", "D4-MY"],                  // mysore-only drop-in
  "single":  [],                                           // operator decides at door
};

const SAMPLE = [
  { name: "燕子",      package: "Full" },
  { name: "Xiao Ma",  package: "Full" },
  { name: "颜宁",      package: "Weekend" },
  { name: "Bella",    package: "3day" },
  { name: "老聂",      package: "Mysore" },
  { name: "Maoni 猫腻", package: "Host" },
];

function entitledFor(pkg) {
  const key = String(pkg || "").trim().toLowerCase();
  if (PACKAGE_MAP[key]) return PACKAGE_MAP[key];
  console.warn(`  ⚠ package "${pkg}" not in PACKAGE_MAP — defaulting to full access. Add it to PACKAGE_MAP for the drop-in cross-check.`);
  return ALL;
}

function loadInput() {
  const jsonPath = path.join(__dirname, "hefei-students.json");
  const csvPath  = path.join(__dirname, "hefei-students.csv");
  if (fs.existsSync(jsonPath)) {
    console.log("Reading hefei-students.json");
    return JSON.parse(fs.readFileSync(jsonPath, "utf8"));
  }
  if (fs.existsSync(csvPath)) {
    console.log("Reading hefei-students.csv");
    const { parse } = require("csv-parse/sync");
    return parse(fs.readFileSync(csvPath, "utf8"), { columns: true, skip_empty_lines: true, trim: true });
  }
  console.log("No input file found — generating SAMPLE cohort (for testing).");
  return SAMPLE;
}

function qrPayload(code, journalId, name) {
  if (QR_MODE === "full") {
    return `${BASE_URL}/student.html?id=${encodeURIComponent(journalId)}&name=${encodeURIComponent(name)}&lang=zh`;
  }
  return `${BASE_URL}/s/${code}`;
}

// Short, human-readable slug for the digital door pass (cn.aybkk.net/s/<slug>).
// Explicit `slug` in hefei-students.json wins; else the Latin part of
// "中文 (Yaya)"; else the whole name ASCII-stripped; else the card code.
// Collisions get the card digits appended so every slug stays unique.
const takenSlugs = new Set();
function slugFor(raw, name, code) {
  let base = String(raw.slug || "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!base) {
    const m = String(name).match(/\(([^)]+)\)/);
    base = (m ? m[1] : String(name)).toLowerCase().replace(/[^a-z0-9]/g, "");
  }
  if (!base) base = code.toLowerCase().replace(/[^a-z0-9]/g, "");
  let s = base;
  if (takenSlugs.has(s)) s = base + code.replace(/\D/g, "");
  takenSlugs.add(s);
  return s;
}

async function main() {
  const input = loadInput();
  const outDir = path.join(__dirname, "public", "rosters");
  const qrDir  = path.join(__dirname, "public", "qr-cards", "hefei");
  fs.mkdirSync(outDir, { recursive: true });
  fs.mkdirSync(qrDir, { recursive: true });

  const students = [];
  const cardManifest = [];
  let i = 0;
  for (const raw of input) {
    i++;
    const code = "HEFEI-" + String(i).padStart(3, "0");
    // deterministic: same name → same journal id on every re-run (never orphan a journal)
    const journalId = raw.journalId || uuidv5(String(raw.name || raw.Name || ""), AYBKK_NS);
    const name = raw.name || raw.Name || "";
    const pkg = raw.package || raw.Package || "Full";
    const slug = slugFor(raw, name, code);
    // Per-student override wins (e.g. one-day mysore); otherwise derive from package.
    const entitledSessions = (Array.isArray(raw.entitledSessions) && raw.entitledSessions.length)
      ? raw.entitledSessions : entitledFor(pkg);

    students.push({ id: code, journalId, name, slug, package: pkg, entitledSessions,
                    phone: raw.phone || "", size: raw.size || "",
                    note: raw.note || "", practice: raw.practice || "", lastAsana: raw.lastAsana || "" });

    const payload = qrPayload(code, journalId, name);
    const file = code + ".png";
    // Level H so the Hefei artwork can sit in the QR center (tolerates 30% coverage)
    await QRCode.toFile(path.join(qrDir, file), payload, {
      errorCorrectionLevel: "H", margin: 2, width: 600,
      color: { dark: "#000000", light: "#ffffff" }
    });
    cardManifest.push({ code, name, slug, package: pkg, journalId, file: "qr-cards/hefei/" + file, url: payload });
  }

  const roster = {
    workshop: "hefei",
    title: "Hefei Workshop",
    dates: "2026-07-16..2026-07-20",
    lang: "zh",
    baseUrl: BASE_URL,
    qrMode: QR_MODE,
    generatedAt: new Date().toISOString(),
    sessions: SESSIONS,
    students,
  };
  fs.writeFileSync(path.join(outDir, "hefei.json"), JSON.stringify(roster, null, 2));
  fs.writeFileSync(path.join(qrDir, "manifest.json"), JSON.stringify(cardManifest, null, 2));

  console.log(`\n✓ ${students.length} students`);
  console.log(`✓ roster:  public/rosters/hefei.json`);
  console.log(`✓ QR PNGs: public/qr-cards/hefei/  (mode=${QR_MODE}, base=${BASE_URL})`);
  console.log(`  Full: ${students.filter(s => s.entitledSessions[0] === "*").length}  ·  Partial: ${students.filter(s => s.entitledSessions[0] !== "*").length}`);
}

main().catch(e => { console.error(e); process.exit(1); });
