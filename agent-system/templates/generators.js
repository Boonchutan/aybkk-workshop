'use strict';

/**
 * Deterministic, offline file generators used by the template executor.
 *
 * `buildBlueprint(plan)` turns a parsed plan into a data object; the per-agent
 * generators (research/content/frontend/backend) turn that blueprint into the
 * actual files written to a generated project. The same shape is what an agent
 * asks Claude to produce when HERMES_USE_CLAUDE=1, so both backends are
 * interchangeable.
 *
 * Two project types are fully supported:
 *   - 'booking-system'  : the AYBKK yoga class booking app (proof of concept)
 *   - 'webpage'         : a generic single-page site + tiny Express server
 */

const STUDIO = 'Ashtanga Yoga Bangkok';

const DEFAULT_CLASSES = [
  {
    id: 'mysore-am',
    name: 'Mysore Self-Practice',
    description: 'Traditional self-paced Ashtanga practice with individual guidance from the teacher.',
    days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
    time: '06:00–09:00',
    level: 'All levels',
    capacity: 30,
    priceTHB: 400,
  },
  {
    id: 'led-primary-sat',
    name: 'Led Primary Series',
    description: 'Guided count-led primary series. A full traditional Ashtanga sequence as a group.',
    days: ['Sat'],
    time: '08:00–09:45',
    level: 'Beginner-friendly',
    capacity: 25,
    priceTHB: 450,
  },
  {
    id: 'led-primary-sun',
    name: 'Led Primary Series',
    description: 'Sunday morning led primary — a calm, focused way to close the week.',
    days: ['Sun'],
    time: '08:00–09:45',
    level: 'Beginner-friendly',
    capacity: 25,
    priceTHB: 450,
  },
  {
    id: 'orientation',
    name: 'Beginner Orientation',
    description: 'Introduction to Ashtanga fundamentals, breath and the opening sequence. Start here.',
    days: ['Wed'],
    time: '18:00–19:00',
    level: 'New students',
    capacity: 12,
    priceTHB: 300,
  },
];

function buildBlueprint(plan) {
  const studio = STUDIO;
  if (plan.projectType === 'booking-system') {
    return {
      projectType: 'booking-system',
      slug: plan.slug,
      studio,
      appName: `${studio} — Class Booking`,
      description: plan.description,
      classes: DEFAULT_CLASSES,
      copy: {
        hero: 'Book your Ashtanga practice',
        intro:
          'Reserve a spot in Mysore self-practice, led primary series, or a beginner orientation at ' +
          studio + '. Moon days and Saturdays follow the traditional Ashtanga calendar.',
      },
    };
  }
  // generic webpage
  return {
    projectType: 'webpage',
    slug: plan.slug,
    studio,
    appName: `${studio} — ${titleFromDescription(plan.description)}`,
    description: plan.description,
    copy: {
      hero: titleFromDescription(plan.description),
      intro: plan.description,
    },
  };
}

// --- Per-agent generators ----------------------------------------------------

function research(bp) {
  const requirements = {
    project: bp.appName,
    type: bp.projectType,
    studio: bp.studio,
    sourceRequest: bp.description,
    constraints: [
      'Single-process app, no external database (file-backed persistence).',
      'Runnable with `npm install && node server.js`.',
      'Mobile-first; students book from phones.',
    ],
    entities:
      bp.projectType === 'booking-system'
        ? ['Class', 'Booking']
        : ['Page', 'ContactMessage'],
    generatedAt: new Date().toISOString(),
  };
  return [{ path: 'requirements.json', content: JSON.stringify(requirements, null, 2) + '\n' }];
}

function content(bp) {
  if (bp.projectType === 'booking-system') {
    return [{ path: 'classes.json', content: JSON.stringify(bp.classes, null, 2) + '\n' }];
  }
  return [
    {
      path: 'content.json',
      content: JSON.stringify({ hero: bp.copy.hero, intro: bp.copy.intro }, null, 2) + '\n',
    },
  ];
}

function frontend(bp) {
  if (bp.projectType === 'booking-system') {
    return [
      { path: 'public/index.html', content: bookingIndexHtml(bp) },
      { path: 'public/styles.css', content: stylesCss() },
    ];
  }
  return [
    { path: 'public/index.html', content: webpageIndexHtml(bp) },
    { path: 'public/styles.css', content: stylesCss() },
  ];
}

function backend(bp) {
  if (bp.projectType === 'booking-system') {
    return [
      { path: 'server.js', content: bookingServerJs(bp) },
      { path: 'package.json', content: appPackageJson(bp) },
      { path: 'bookings.json', content: '[]\n' },
      { path: 'README.md', content: appReadme(bp) },
    ];
  }
  return [
    { path: 'server.js', content: webpageServerJs(bp) },
    { path: 'package.json', content: appPackageJson(bp) },
    { path: 'README.md', content: appReadme(bp) },
  ];
}

// --- File bodies -------------------------------------------------------------

function appPackageJson(bp) {
  return (
    JSON.stringify(
      {
        name: bp.slug,
        version: '1.0.0',
        description: bp.appName,
        main: 'server.js',
        scripts: { start: 'node server.js' },
        dependencies: { express: '^4.18.2' },
      },
      null,
      2
    ) + '\n'
  );
}

function appReadme(bp) {
  const lines = [
    `# ${bp.appName}`,
    '',
    `_Generated by Hermes (AYBKK multi-agent system) from the request:_`,
    `> ${bp.description}`,
    '',
    '## Run',
    '',
    '```bash',
    'npm install',
    'node server.js',
    '# open http://localhost:5000',
    '```',
    '',
  ];
  if (bp.projectType === 'booking-system') {
    lines.push(
      '## API',
      '',
      '- `GET  /api/classes`  — list bookable classes',
      '- `GET  /api/bookings` — list bookings',
      '- `POST /api/bookings` — create a booking `{ name, email, classId, date }`',
      '',
      'Bookings are stored in `bookings.json`. Capacity is enforced per class per date.',
      ''
    );
  }
  return lines.join('\n');
}

function bookingIndexHtml(bp) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(bp.appName)}</title>
  <link rel="stylesheet" href="styles.css" />
</head>
<body>
  <header class="hero">
    <h1>${escapeHtml(bp.copy.hero)}</h1>
    <p>${escapeHtml(bp.copy.intro)}</p>
  </header>

  <main>
    <section>
      <h2>Schedule</h2>
      <div id="classes" class="class-grid">Loading classes…</div>
    </section>

    <section>
      <h2>Book a spot</h2>
      <form id="booking-form">
        <label>Your name <input name="name" required /></label>
        <label>Email <input name="email" type="email" required /></label>
        <label>Class
          <select name="classId" id="classId" required></select>
        </label>
        <label>Date <input name="date" type="date" required /></label>
        <button type="submit">Reserve</button>
      </form>
      <p id="result" class="result" role="status"></p>
    </section>
  </main>

  <footer><p>${escapeHtml(bp.studio)}</p></footer>

  <script>
    const fmtDays = (d) => Array.isArray(d) ? d.join(', ') : d;

    async function loadClasses() {
      const res = await fetch('/api/classes');
      const classes = await res.json();
      const grid = document.getElementById('classes');
      const select = document.getElementById('classId');
      grid.innerHTML = '';
      select.innerHTML = '';
      classes.forEach((c) => {
        const card = document.createElement('article');
        card.className = 'class-card';
        card.innerHTML =
          '<h3>' + c.name + '</h3>' +
          '<p class="meta">' + fmtDays(c.days) + ' &middot; ' + c.time + '</p>' +
          '<p>' + c.description + '</p>' +
          '<p class="meta">' + c.level + ' &middot; ' + c.priceTHB + ' THB &middot; cap ' + c.capacity + '</p>';
        grid.appendChild(card);

        const opt = document.createElement('option');
        opt.value = c.id;
        opt.textContent = c.name + ' (' + fmtDays(c.days) + ' ' + c.time + ')';
        select.appendChild(opt);
      });
    }

    document.getElementById('booking-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const form = e.target;
      const payload = {
        name: form.name.value,
        email: form.email.value,
        classId: form.classId.value,
        date: form.date.value,
      };
      const result = document.getElementById('result');
      result.textContent = 'Booking…';
      try {
        const res = await fetch('/api/bookings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Booking failed');
        result.className = 'result ok';
        result.textContent = 'Confirmed! ' + data.booking.name + ' is booked for ' + payload.date + '.';
        form.reset();
      } catch (err) {
        result.className = 'result err';
        result.textContent = err.message;
      }
    });

    loadClasses();
  </script>
</body>
</html>
`;
}

function webpageIndexHtml(bp) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(bp.appName)}</title>
  <link rel="stylesheet" href="styles.css" />
</head>
<body>
  <header class="hero">
    <h1>${escapeHtml(bp.copy.hero)}</h1>
    <p>${escapeHtml(bp.copy.intro)}</p>
  </header>
  <main>
    <section>
      <h2>Get in touch</h2>
      <form id="contact-form">
        <label>Name <input name="name" required /></label>
        <label>Email <input name="email" type="email" required /></label>
        <label>Message <textarea name="message" required></textarea></label>
        <button type="submit">Send</button>
      </form>
      <p id="result" class="result" role="status"></p>
    </section>
  </main>
  <footer><p>${escapeHtml(bp.studio)}</p></footer>
  <script>
    document.getElementById('contact-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const form = e.target;
      const result = document.getElementById('result');
      result.textContent = 'Sending…';
      try {
        const res = await fetch('/api/contact', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: form.name.value, email: form.email.value, message: form.message.value }),
        });
        if (!res.ok) throw new Error('Failed to send');
        result.className = 'result ok';
        result.textContent = 'Thanks! We will be in touch.';
        form.reset();
      } catch (err) {
        result.className = 'result err';
        result.textContent = err.message;
      }
    });
  </script>
</body>
</html>
`;
}

function stylesCss() {
  return `:root {
  --ink: #1f2421;
  --paper: #f7f5f0;
  --accent: #b5651d;
  --line: #e2ddd2;
}
* { box-sizing: border-box; }
body {
  margin: 0;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  color: var(--ink);
  background: var(--paper);
  line-height: 1.5;
}
.hero {
  padding: 3rem 1.5rem 2rem;
  background: #fff;
  border-bottom: 1px solid var(--line);
}
.hero h1 { margin: 0 0 .5rem; font-size: 1.9rem; }
.hero p { margin: 0; max-width: 40rem; color: #5c5c54; }
main { max-width: 60rem; margin: 0 auto; padding: 1.5rem; }
section { margin-bottom: 2.5rem; }
h2 { border-bottom: 2px solid var(--accent); display: inline-block; padding-bottom: .2rem; }
.class-grid { display: grid; gap: 1rem; grid-template-columns: repeat(auto-fill, minmax(15rem, 1fr)); }
.class-card { background: #fff; border: 1px solid var(--line); border-radius: 10px; padding: 1rem; }
.class-card h3 { margin: 0 0 .25rem; }
.class-card .meta { color: var(--accent); font-size: .85rem; margin: .15rem 0; }
form { display: grid; gap: .75rem; max-width: 26rem; }
label { display: grid; gap: .25rem; font-weight: 600; font-size: .9rem; }
input, select, textarea {
  padding: .6rem; border: 1px solid var(--line); border-radius: 8px; font: inherit; background: #fff;
}
textarea { min-height: 6rem; }
button {
  padding: .7rem 1.2rem; border: none; border-radius: 8px; background: var(--accent);
  color: #fff; font-weight: 600; cursor: pointer; justify-self: start;
}
button:hover { filter: brightness(1.05); }
.result { font-weight: 600; min-height: 1.2em; }
.result.ok { color: #2e7d32; }
.result.err { color: #c0392b; }
footer { text-align: center; padding: 2rem; color: #8a8a80; }
`;
}

function bookingServerJs(bp) {
  return `'use strict';
// ${bp.appName} — generated by Hermes.
const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 5000;
const CLASSES = JSON.parse(fs.readFileSync(path.join(__dirname, 'classes.json'), 'utf8'));
const BOOKINGS_FILE = path.join(__dirname, 'bookings.json');

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

function readBookings() {
  try { return JSON.parse(fs.readFileSync(BOOKINGS_FILE, 'utf8')); }
  catch { return []; }
}
function writeBookings(list) {
  fs.writeFileSync(BOOKINGS_FILE, JSON.stringify(list, null, 2) + '\\n');
}

app.get('/api/classes', (req, res) => res.json(CLASSES));
app.get('/api/bookings', (req, res) => res.json(readBookings()));

app.post('/api/bookings', (req, res) => {
  const { name, email, classId, date } = req.body || {};
  if (!name || !email || !classId || !date) {
    return res.status(400).json({ error: 'name, email, classId and date are required' });
  }
  const klass = CLASSES.find((c) => c.id === classId);
  if (!klass) return res.status(400).json({ error: 'unknown class' });

  const bookings = readBookings();
  const taken = bookings.filter((b) => b.classId === classId && b.date === date).length;
  if (taken >= klass.capacity) {
    return res.status(409).json({ error: 'this class is full on ' + date });
  }

  const booking = { id: 'b_' + Date.now().toString(36), name, email, classId, date, createdAt: new Date().toISOString() };
  bookings.push(booking);
  writeBookings(bookings);
  res.status(201).json({ booking });
});

app.listen(PORT, () => console.log('${bp.studio} booking app on http://localhost:' + PORT));
`;
}

function webpageServerJs(bp) {
  return `'use strict';
// ${bp.appName} — generated by Hermes.
const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 5000;
const MESSAGES_FILE = path.join(__dirname, 'messages.json');

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.post('/api/contact', (req, res) => {
  const { name, email, message } = req.body || {};
  if (!name || !email || !message) return res.status(400).json({ error: 'all fields required' });
  let list = [];
  try { list = JSON.parse(fs.readFileSync(MESSAGES_FILE, 'utf8')); } catch {}
  list.push({ name, email, message, at: new Date().toISOString() });
  fs.writeFileSync(MESSAGES_FILE, JSON.stringify(list, null, 2) + '\\n');
  res.status(201).json({ ok: true });
});

app.listen(PORT, () => console.log('${bp.studio} site on http://localhost:' + PORT));
`;
}

function titleFromDescription(desc) {
  const t = String(desc || 'New Page').replace(/^(build|create|make|generate)\s+(a|an|the)?\s*/i, '').trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

module.exports = { buildBlueprint, research, content, frontend, backend, STUDIO, DEFAULT_CLASSES };
