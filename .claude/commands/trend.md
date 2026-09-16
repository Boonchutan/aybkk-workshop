# /trend — Talk of the Town: 3 posts a day from what the world is searching

**Purpose:** Turn Google Trends (the top searches of the week and of today) into @wealth-style
10-slide carousels: a photoreal image per slide, one big Anton headline per slide, one hidden fact
per slide, with an Edward Sturm caption (what is trending, why, the one thing most people don't know).
3 carousels a day, 100% global (US trends stand in for "global").
Run by hand (`/trend`) or by the daily Routine "Talk of the Town — daily trend batch" (see Config).

**Do not use for:** AYBKK marketing, the China cohort, student comms, or anything posted to the
AYBKK or Boonchu personal channels. This is a separate account with its own voice.

## Config
| key | value |
|---|---|
| series label (card footer) | Talk of the Town |
| Postiz channel | the channel whose name contains "Talk of the Town" or "trend" (case-insensitive). *Not connected yet* — until it exists, deliver the batch in the report only. Never fall back to another channel. |
| posts per day | 3 carousels, all global. No Thailand quota (dropped 16 Sep 2026). |
| slides per carousel | 10: cover, 8 facts, takeaway. 1080×1350. Anton headline over a photoreal image with a dark gradient. |
| images | Kling `text_to_image`, model `gemini-3.1-flash-image`, aspect 4:5, 2k, 15 credits per image = 150 per carousel, 450 per day at 3 carousels. Check `query_membership_and_credits` first; under 200 credits, render on the dark gradient and say so in the report. Never use real people, logos or text in prompts. |
| post times (Bangkok) | 08:00, 13:00, 19:00 = 01:00, 06:00, 12:00 UTC |
| Postiz post type | `draft` until Boonchu says "go live", then `schedule` |
| image hosting | branch `trend-cards` of this repo → `.../trend-cards/carousels/YYYY-MM-DD-<slug>/NN.png` (single cards under `cards/`) |
| memory | `log.json` on the `trend-cards` branch (14-day no-repeat rule) |
| Routine | "Talk of the Town — daily trend batch", 23:30 UTC = 06:30 Bangkok. It fires into the session "Postiz Social media" (session_01XThAVTVGUs4TK4ENsd9Yfh) because that session holds the repo, push access, Postiz and Gmail; a fresh Routine session has none of those. Report goes to boonchutan@gmail.com. |

## Step 1 — Fetch
```
node scripts/trends-fetch.js --geo US,TH --hours 168 --top 100 --out "$SCRATCH/trends.json"
```
- `geos.US.weekly` / `geos.TH.weekly`: the 7-day list (title, volume, growthPct, started, active,
  related, categories) sorted by volume. This is the "top 50 of the week".
- `geos.*.daily`: today's RSS top 10 with news headlines and URLs. Freshest; use for "today" posts.
- Google has no world feed, so US = global. Add `--geo US,GB,IN,TH` when the US list is thin.

## Step 2 — Select (the rubric)
Score every candidate 0–5 on each line; take the top 3 (US weekly + daily lists only).
1. **Volume** — weekly ≥ 100,000 (US) / ≥ 10,000 (TH), or daily ≥ 500+ (US) / ≥ 1000+ (TH).
2. **Heat** — `active: true`, or started in the last 48 h. Ended trends only if the story is still moving.
3. **Angle** — a verifiable "most people don't know" fact that changes how the reader sees the story
   (origin, a number, who really owns it, what it actually does). No angle, no post.
4. **Explainable** — the reader gets it from the caption alone.
5. **Range** — a different category from the other two posts that day, and not in `log.json` within
   14 days (a new development on a logged topic is fine).
6. **Depth** — at least 8 distinct, verifiable facts exist (prices, dates, names, who supplies what,
   who paid whom, what the rule actually says). Fewer than 8 and it is not a carousel topic.

Skip: match fixtures, "X vs Y", lineups (category Sports) unless the angle is off the pitch
(a sponsor, a rule, the money); lottery numbers; weather; allegations about private individuals
without charges or an official statement; deaths of private people; anything that only works as a
rumor. Celebrity news is fine when a major outlet is the source. Politics is fine when it is what
happened (the vote, the number, the statement), never what to think about it.

## Step 3 — Research (per topic, five minutes)
- 2–3 searches. Open the trend's own news links first (`daily[].news`).
- Every number, date, name and quote needs a source you actually opened. Two independent sources
  for the "don't know" fact; primary (government, company, official statement, Wikipedia for
  background) beats blogs.
- Write "reportedly" when only leakers or analysts say it. If a fact will not verify, change the
  fact or drop the topic. Never invent a number.
- Keep the source URLs for the log. They never go in the caption.

## Step 4 — Write (the voice)
Edward Sturm's register: keyword first, numbers early, short declarative lines with one longer
sentence for rhythm, zero hype adjectives. He tells you what is happening, then the thing you did
not know, then a one-line reframe. Confident, plain, a little dry.

Template (60–120 words, four paragraphs, Postiz content as `<p>` per paragraph):
```
"<search term>" — <volume> searches <this week | today> [in Thailand]. <optional one-line size cue>

Why: <what happened, the date, the one number that matters. 2–3 sentences.>

What most people don't know: <the fact. 1–3 sentences. A year, a number, a name.>

Very simply put: <one-line reframe that makes the fact land, or one sharp question.>
```
Rules:
- The search term in quotes, exactly as searched. Thai terms get the English in brackets: "ทองคำ" (gold).
- Numbers as digits. Dates as "September 15". Currency with its symbol.
- Short sentences, one idea each. No emojis, no hashtags, no exclamation marks, no "BREAKING".
- Never explain your reasoning, never mention AI, never cite sources in the caption.
- Opinion only in the last line, and only if it follows from the facts above it.
- Report politics and religion; never judge them.
- Slide copy: headline ≤ 12 words, written in sentence case (the renderer sets it in caps), one fact
  per slide, the number or name inside the headline, a one-line `sub` with the qualifier ("reportedly",
  the source's estimate, the date). Cover headline = the tension line ("Apple's $1,999 foldable has a
  Samsung secret"); cover sub = "10 things most people don't know about <topic>, <size cue>". Slide 10
  headline starts "Very simply put:" and its sub is the follow line. Slides 2–9 are ordered from the
  fact everyone half-knows to the one nobody knows.
- Banned words: journey, transformation, unlock, level up, game-changer, insane, wild, crazy,
  mind-blowing, "let that sink in", "you won't believe".

## Step 5 — Slides
One folder per carousel: `<dir>/slides.json` + `<dir>/bg/slideN.img` → `<dir>/out/01..10.png`.
```
{"topic":"iPhone Duo","slug":"iphone-duo","brand":"iPhone Duo · 10 facts","caption":["…4 paragraphs…"],
 "slides":[{"n":1,"headline":"Apple's $1,999 foldable has a Samsung secret",
            "sub":"10 things most people don't know about the iPhone Duo, the most searched product on Earth this week.",
            "foot":"Swipe →","image":"<photoreal prompt, unbranded, no people's faces, no text, no logos>"}, … ,
           {"n":10,"headline":"Very simply put: …","sub":"Follow Talk of the Town for the story behind what everyone is searching.","foot":"Follow","image":"…"}]}
```
1. Images: for each slide call Kling `text_to_image` (model `gemini-3.1-flash-image`, arguments prompt +
   `aspect_ratio` 4:5 + `img_resolution` 2k + `imageCount` 1, one `taskTraceId` per carousel), poll
   `query_tasks`, download `urlWithoutWatermark` to `bg/slideN.img` (URLs expire in 24 h). A job still
   queuing after 10 minutes: render that slide on the gradient, note it in the report, never resubmit on your own.
2. Render: `NODE_PATH=<scratch>/node_modules node scripts/trend-carousel.js <dir>` (install playwright-core
   first; the install line is at the top of `scripts/trend-card.js`; Chromium is at `/opt/pw-browsers/chromium`).
3. Look at every PNG (Read) before publishing: nothing may overflow, clip or sit on a busy part of the photo.
The single-card layout (`term`/`volume`/`teaser` spec) still exists in `scripts/trend-card.js` for one-image posts.

## Step 6 — Host
```
git fetch origin trend-cards
git worktree add "$SCRATCH/trend-cards" trend-cards      # orphan branch: cards/, log.json, README.md only
mkdir -p "$SCRATCH/trend-cards/carousels/YYYY-MM-DD-<slug>" && cp <dir>/out/*.png there && update "$SCRATCH/trend-cards/log.json"
git -C "$SCRATCH/trend-cards" add -A && git -C "$SCRATCH/trend-cards" commit -m "trend cards YYYY-MM-DD"
git -C "$SCRATCH/trend-cards" push origin trend-cards
```
Public URL: `https://raw.githubusercontent.com/Boonchutan/aybkk-workshop/trend-cards/carousels/YYYY-MM-DD-<slug>/NN.png`
(single cards: `.../trend-cards/cards/<file>.png`).
Cards never go to main or to a feature branch.

## Step 7 — Postiz
1. `integrationList` → the channel named in Config. Missing? Stop here; put the full posts and card
   URLs in the report instead.
2. `uploadFromUrlTool` for each of the 10 slide URLs → 10 media paths.
3. `integrationSchedulePostTool`: one post per slot, `type` from Config, `date` = the slot in UTC,
   content as `<p>` paragraphs, `attachments` = the 10 media paths in order (that is the carousel). Draft first.
4. Never post from this skill to the AYBKK or Boonchu personal channels.

### Step 7b — REST fallback (Routine sessions run without connector tools)
Needs the environment variable `POSTIZ_API_KEY` (claude.ai/code → the environment → variables).
Unset? Skip Postiz and say so in the report. Same channel rule, same `draft` type.
```
curl -sS -H "Authorization: $POSTIZ_API_KEY" https://api.postiz.com/public/v1/integrations
# → pick the id whose name contains "Talk of the Town" / "trend"
curl -sS -H "Authorization: $POSTIZ_API_KEY" -F "file=@cards/<file>.png" https://api.postiz.com/public/v1/upload
# → {"id": "...", "path": "https://uploads.postiz.com/..."}
curl -sS -H "Authorization: $POSTIZ_API_KEY" -H "Content-Type: application/json" https://api.postiz.com/public/v1/posts -d '{
  "type": "draft", "date": "<slot, ISO 8601 UTC>", "shortLink": false, "tags": [],
  "posts": [{ "integration": { "id": "<channel id>" },
              "value": [{ "content": "<p>…</p><p>…</p><p>…</p><p>…</p>", "image": [{ "id": "<upload id>", "path": "<upload path>" }] }],
              "settings": { "__type": "<platform of the channel, e.g. instagram>" } }] }'
```
Shapes are from docs.postiz.com/public-api and are untested until the key exists. If the API rejects
`draft`, stop and put the response in the report; never switch to `schedule` or `now` on your own.

## Step 8 — Log and report
Append to `log.json`: `{date, geo, term, volume, angle, sources[], card | carousel, facts[], postizId}`.
The next run reads it for the 14-day rule.
Report (final message / notification): the 3 captions in full, the 3 card URLs, what was skipped
and why (one line each), and anything that needs Boonchu (channel missing, a fact that would not
verify).

## Calibration — two posts that hit the voice
"iPhone Duo" — 2,000,000+ searches this week. The most searched product on Earth right now.

Why: Apple showed its first folding iPhone on September 9. It opens like a book into one screen 80% bigger than the iPhone Pro's. $1,999 to start, $3,199 with 2TB. Pre-orders open October 16.

What most people don't know: the folding screen is not made by Apple. Samsung Display reportedly has a three-year exclusive deal to supply it, at about $250 per panel. LG and BOE could not meet the spec.

Very simply put: Apple's most expensive phone is built around its biggest rival's screen.

---

"ลิเวอร์พูล พบ สเปอร์ส" (Liverpool vs Spurs) — 20,000+ searches in Thailand today. The biggest search in the country. 9 of Thailand's top 10 searches today are football.

Why: Carabao Cup third round at Anfield. Liverpool won 3–1: Mac Allister 21', Gakpo 54', Szoboszlai 90+1'. Gallagher scored for Spurs.

What most people don't know: the cup is named after a Thai energy drink. Carabao has sponsored the League Cup since 2017 and in March 2026 extended to 2029, the longest title sponsor in the competition's 66-year history. Next season's cup also launches Carabao Lager in the UK.

Very simply put: when Thailand watches Liverpool lift a cup, the name on the cup is Thai.
