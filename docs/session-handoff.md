# Session handoff: social media work (updated 27 Sep 2026)

Read this first in a new Claude Code session. It carries what the "Postiz Social media" session
(session_01XThAVTVGUs4TK4ENsd9Yfh) learned, so the work can continue anywhere. Start the new session on
branch `claude/hero-script-social-media-q6cv69` (draft PR #15); `main` does not have these files yet.

Scratchpad files never carry over between sessions. Everything reusable is in git:
- this branch: `scripts/quote-card.js` (AYBKK photo cards), `scripts/trends-fetch.js`, `scripts/trend-image.js`,
  `scripts/trend-card.js`, `scripts/trend-carousel.js`, `.claude/commands/trend.md` (No Cap Daily recipe)
- branch `trend-cards` (orphan, images and logs only): `carousels/`, `aybkk/`, `brand/`, `log.json`

## Postiz channels (integration ids)

| channel | id | platform | use |
|---|---|---|---|
| Ashtanga Yoga Center Of Bangkok | `cmnmyjqex06mrqi0yeynj0y3f` | instagram | AYBKK carousels |
| No Cap Daily \| Trending Facts | `cmujmj95r11xco80yhyrtsp07` | instagram-standalone | /trend only, connected 27 Sep 2026 |
| Boonchu Tantikarun | `cmnmyh2nr06liqi0y0dhsjrkz` | instagram-standalone | never post here from these workflows |

Instagram settings for both: `post_type` = `post`. Content is one `<p>` per line, no empty `<p>`.
Upload media with `uploadFromUrlTool` from commit-SHA raw URLs
(`https://raw.githubusercontent.com/Boonchutan/aybkk-workshop/<sha>/...`); branch URLs get served stale.
Postiz tools cannot delete or edit posts: Boonchu deletes in the Postiz app.

## Routines

- "No Cap Daily — daily trend batch", `trig_01HZvqejQMT7rQCVuhX4CNxB`, cron `30 23 * * *` (06:30 Bangkok),
  fires into session_01XThAVTVGUs4TK4ENsd9Yfh. It runs the eight steps of `.claude/commands/trend.md`, saves
  3 Postiz drafts on the No Cap channel (01:00, 06:00, 12:00 UTC), appends to `log.json` and emails
  boonchutan@gmail.com. A routine cannot be re-pointed: to move it to another session, delete it and create it
  again with `persistent_session_id` set to the new session and the same prompt.

## No Cap Daily (separate account, never AYBKK)

- Instagram account created 27 Sep 2026 (professional). Name: `No Cap Daily | Trending Facts`.
  Bio: "What the world is searching, and the one thing most people don't know. / 3 carousels a day. Facts only. No cap."
- Profile picture: three stand-ins on `trend-cards` at `brand/nocap-daily-profile-A.png` (navy, "NO CAP" ivory and
  amber, amber "DAILY" tag; recommended), `-B` ("NC" monogram), `-C` (navy on amber). Boonchu asked for a
  Cloudflare-generated one: see the script below.
- Drafts for 28 Sep (gradient, to be replaced by photo versions): Primetime `cmukhdjf60gvhqr0yp8f0v7sw`, Kate Upton
  `cmukhdjgi0gviqr0yh6raj4g0`, Muse `cmukhdji40gvjqr0y77z9a5ab`. Google's birthday text is now past tense ("turned 28 on Sunday").
- Drafts waiting in Postiz for 27 Sep: Google's birthday `cmujp6h8i0d0wqr0y3nl73nmj` (11:30 UTC, made as the
  account's first post), meat recall `cmujmp19v0cmeqr0y9rfu1ym6`, Taylor Swift Encore `cmujmp4vx0cmfqr0y8i3b2qqw`,
  FAFSA `cmujmp81l0cmgqr0y40ymk6g5`. Boonchu publishes from Postiz.
- Post type stays `draft` until Boonchu says "go live"; then change the Config row in trend.md to `schedule`.
- Slide images: no `GEMINI_API_KEY`, Kling has 137 credits (under the 200 minimum), so slides render on the
  gradient. `scripts/trend-image.js` now also runs on Cloudflare Workers AI (FLUX.2 [klein] 4B, 4:5, free tier
  covers a carousel a day) once `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` are environment variables
  (tested against a mock API only; the first real run is the test). A token pasted into chat cannot be used:
  the session's safety check blocks it. 28 Sep: both variables are set in the Bt code environment and a Workers AI
  test call worked in the session "Cloudflare image to postiz"; that session re-renders the 27–28 Sep carousels with
  photos and takes over the daily routine.
- Google's birthday carousel with photos: `trend-cards/carousels/2026-09-27-googles-birthday/slides.json` holds the
  text and FLUX prompts. Copy the folder's `slides.json` into a scratch dir, run
  `node scripts/trend-image.js <dir> --cover-candidates 2`, render, review, overwrite the PNGs on `trend-cards`,
  upload, make a new draft, update the log entry's `postizId`, and ask Boonchu to delete the old text-only draft.
- `log.json` has 47 entries through 2026-09-28 (14-day no-repeat rule).

### Cloudflare profile picture (needs env `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN`, Workers AI token)

Never print the values. Generate 2 seeds of each idea, show them in a circle crop at 320, 110 and 44 px, let
Boonchu pick, then upload 1080x1080.

```python
import os, json, base64, urllib.request
acct, tok = os.environ['CLOUDFLARE_ACCOUNT_ID'], os.environ['CLOUDFLARE_API_TOKEN']
PROMPTS = {
 'cap-strike': "Minimal flat vector logo icon: a white baseball cap crossed out by one thick bright amber diagonal stroke, centered on a solid deep navy background, bold, high contrast, clean sharp edges, generous margin around the icon, no text, no letters",
 'nocap-type': "Bold condensed typographic logo that reads exactly NO CAP in two stacked lines, NO in ivory white and CAP in bright amber, centered on a solid deep navy background, flat design, high contrast, clean, generous margin",
 'truth-bubble': "Minimal flat vector logo icon: a bright amber speech bubble with a bold white check mark inside, centered on a solid deep navy background, high contrast, clean sharp edges, generous margin, no text, no letters",
}
for name, prompt in PROMPTS.items():
    for seed in (7, 42):
        req = urllib.request.Request(f'https://api.cloudflare.com/client/v4/accounts/{acct}/ai/run/@cf/black-forest-labs/flux-1-schnell',
            data=json.dumps({'prompt': prompt, 'steps': 8, 'seed': seed}).encode(),
            headers={'Authorization': f'Bearer {tok}', 'Content-Type': 'application/json'})
        img = json.load(urllib.request.urlopen(req, timeout=120))['result']['image']
        open(f'cf-{name}-{seed}.jpg', 'wb').write(base64.b64decode(img))
```

Brand colours: navy `#0F1A2E`, amber `#FFB92E`, ivory `#F4EFE6`; fonts Anton / Oswald (`public/fonts/`).

## AYBKK Instagram carousels (quote and story series)

Boonchu's rules, learned over the Signs and Desire series:
- Photos come from his Google Drive folders (for example "Best 40 sep25 carousel"); 1080x1350 cards.
- Layout (his spec, 25 Sep): text in the top-left or top-right corner, column no wider than 1/4 of the image
  (270 of 1080 px), about 40 px from the edges, aligned to its side. Section title small and bold white; the
  original quote or event in a thick yellow serif (Source Serif 4 Black, `#ffe45c`) with a dense soft shadow; the
  10-year-old-English line in bold white (Inter 800) with a hard black outline. `scripts/quote-card.js` does all of
  this and picks the side with less of the subject under the text; override with `side`, `crop`, `col`, `scale`.
- Never put text over heads, hair, faces (background faces too), hands or feet. Never crop limbs at the bottom:
  use the largest crop that still hides the photo watermark (AYBKK photos `crop` 0.36, named photographers 0.56).
  Review every card at full size before posting.
- Fact-check every quote and event against sources before posting; label paraphrases and loose translations.
- Caption: original-language line / English — Author / one punch line / "Come learn yoga at aybkk.com" /
  "#aybkk #ashtanga #ashtangabangkok #boonchutanti #health".
- Carousels without music (the API cannot add music). Schedule 4 minutes early (05:56 for a 6am Bangkok slot),
  then check about 7 minutes after each slot: Postiz state, and `https://www.instagram.com/aybkk/embed/` shows the
  caption with 10 slides (the sidecar span counts 11 shortcodes including the next post). If a post shows ERROR
  and is not on Instagram, re-post it with type `now`.
- Series so far: Signs of intelligence (24–25 Sep; DdqdmISGHG1, Ddq0-wnGMOx, DdsAg1cGW4M). Desire, Relief, and
  Wanting Nothing (25–27 Sep; DdtP_vBmIhH, DdulTYjGATC, Ddv4uN4GLAO in the new layout, DdxKGXJGCpW). Set 1 card 8
  (Zhuangzi) says "no self to feed"; "to feed" is a loose addition and the post is live.

## Standing rules

- Never commit `.env`; never print keys (check variable names only).
- Push only to `claude/hero-script-social-media-q6cv69` and `trend-cards`; commit as
  `Boonchu Tantikarun <boonchutan@gmail.com>` with the Co-Authored-By and Claude-Session lines.
- /trend never posts to the AYBKK or Boonchu personal channels.
- Obsidian: one note per topic; the Drive connector cannot edit notes, so give the full note text in chat.

## Open items for Boonchu

- Pick the No Cap profile picture (A, B, C or a Cloudflare one) and publish the three drafts.
- Delete the failed Postiz posts: `cmudsdo0r0000qg0yeohrm2lv` (23 Sep), `cmugti7ma01a0qw0yof98blp1` (25 Sep),
  `cmugtwmzz01eiqw0yslt1cs4e` (26 Sep).
- Photo backgrounds for No Cap slides: `GEMINI_API_KEY`, a Kling top-up (450 credits a day) or the Cloudflare option.
- Merge draft PR #15 when ready.
