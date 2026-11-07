export const meta = {
  name: 'place-slides-grid',
  description: 'Place big white word and small text on each slide, small text strictly on the golden grid, each slide checked by an independent reviewer',
  phases: [
    { title: 'Make', detail: 'one agent per slide' },
    { title: 'Check', detail: 'independent reviewer per slide' },
    { title: 'Fix', detail: 'up to two more tries if rejected' },
  ],
}
const WD = args.wd
const SET = args.set
const SLIDES = args.slides
const REGRID = !!args.regrid

const GRID = `
THE GRID (owner's rule, strict; he caught slides where the small text ignored it and columns were too wide):
- Slide 1080x1350. Margins: 60 px left, right and top. Golden vertical lines at x=413 and x=667. Golden horizontal lines at y=516 and y=834. The watermark sits around y 1180-1330.
- The small text block (sentence + credit) must sit in ONE of exactly four columns:
    narrow-left  x 60..413  (cws [353])      narrow-right x 667..1020 (cws [353])
    wide-left    x 60..667  (cws [607])      wide-right   x 413..1020 (cws [607])
  Flush-left text (sright false): sxy x = the column start (60, 413 or 667).
  Flush-right text (sright true): sxy x = 'R' (right edge on 1020), 'R667' or 'R413' (right edge on that golden line).
  Never any other width. Never a column that crosses a golden line it does not start or end on.
- Vertical: the block's top on 60, 516 or 834; OR its bottom on 516, 834 or 1120 (1290 only when the watermark sits on the other side); OR, only when all those are blocked, its top on the 52 px baseline grid (60 + 52k).
- The big word: also prefer one vertical edge on a grid line (60, 413, 667, 1020) and its top or bottom on a grid line, but never shrink it much just for that.
- The renderer prints a line 'GRID OK' or 'GRID FAIL: <reason>'. Your final MUST print GRID OK. Pass 'grid' as a 4th argument to also save <out>_grid.jpg with the grid lines drawn (cyan = x lines, magenta = y lines); put those in the work folder and look at them.
- Inside a narrow column use sz 42-46 so lines hold 3+ words; a wide column suits most 20-26 word texts at sz 46.`

const COMMON = `
You are laying out ONE Instagram carousel slide (1080x1350 JPEG, 4:5) for AYBKK (Ashtanga Yoga Bangkok). The slide = a class photo crop + one BIG white keyword (font Inter Black) + a small text block (italic serif, 2-4 short sentences) with an uppercase credit line under it + the "AYBKK SHALA BANGKOK" watermark at the bottom (the renderer adds it).
The texts are final and fact-checked: never change, drop or add a single word of the word, the text or the credit. (Earlier agents cut words to make text fit; that is forbidden. If it does not fit, use the wide column, a smaller sz down to 42, or another spot.)

Working dir WD=${WD}
Renderer: run from cwd ${WD}/tools with env WD set:
  cd ${WD}/tools && WD=${WD} ENG=eng23 python3 direct20g.py <spec.json> 1 <out.jpg> grid
It renders row 1 of a JSON list with hand-set positions. Row fields:
- photo, id, word, line (the small text), credit: never change.
- t: integer 0..270 = top of the 1350-high crop window in the 1080x1620 photo (slide_y = photo_y - t). Never 'pad', never white bars.
- tight (bool), wmain: keep as given. wm: watermark side 'left' | 'right' | 'center' | 'orig' (optional; sits around slide y 1180-1330).
- wwidth: length of the big word in px. wpos: [x_left, y_top] of the word box. ink_w: must be 'light' (white). wshadow: shadow strength behind the white word (default 1.0; 1.2-1.8 for bright areas). wburn: soft darkening behind the word (0..0.3).
- wrot: 0 (normal) or -90 (word reads top to bottom, standing sideways) or 90; with rotation wpos is the top-left of the rotated box and wwidth its length. Use sideways only when no horizontal spot can hold a big word.
- sz: small-text font size (42 to 50, prefer 46; never under 42). cws: [353] or [607] only. sxy: [x, y_top] of the text block (x as in THE GRID). ink_s: 'light' or 'dark'. sright: true to right-align the lines. sburn: soft darkening behind the text block (0..0.4) to make light text readable on a busy or bright area.
- line_br (optional): the same text with manual line breaks (" | " between lines), only to fix an ugly wrap (one-word last line, 'a'/'the' at a line end). The words must stay identical, character for character. Start without line_br and let the renderer wrap.
It prints 'word [x0,y0,x1,y1] <check>', 'sent [x0,y0,x1,y1] <check>' (strict auto-rule hint, may print None for good hand placements) and the GRID line.
Photo grid with labels: ${WD}/grid/<photo>.jpg (720x1080 preview of the full 1080x1620 photo; axis labels are FULL photo pixels). Full photo: ${WD}/full/<photo>.jpg.
Look at images with the Read tool. Make a 432x540 preview (phone size) and full-resolution crops around the text with PIL.
${GRID}

Rules (from the owner, strict):
1. The big word is WHITE and BIG: as large as the clean space allows. Aim for letters at least 110 px tall (short words should be much taller). It never covers a face (also background people), a hand or a foot. It may sit on walls, windows, floor, mats, background people's bodies, and on the teacher's black shirt. It must not cross the main student's body.
2. The small text must be EASY to read on a phone (check the 432x540 preview): calm or dark area for light ink, or a light calm area for dark ink; use sburn if needed. It never covers a face, hand or foot.
3. Word and text block at least 40 px apart; both clear of the watermark.
4. Change t only if no visible head, hand or foot of the main people gets cut.
4b. NEVER put the big word or the text over framed pictures, teacher portraits, photos of gurus or deity statues on the wall shelves (they are sacred to the shala). Keep 30 px clear of them.
4c. The small text may contain Thai, Japanese, Korean, Russian or Chinese words: they render with fallback fonts; check they are complete and readable in the preview.
5. Write candidates to ${WD}/v2/${SET}/work/<NN>_v<k>.jpg (+ .json). Final: ${WD}/v2/${SET}/final/<NN>.jpg and its one-row spec list ${WD}/v2/${SET}/final/<NN>.json (make the folders). Do not touch other files.
Try at least 3 grid layouts (different columns or sides), compare them side by side at phone size, pick the best. Your final message is data, not chat.`

const MAKE = { type: 'object', properties: { nn: { type: 'string' }, final_jpg: { type: 'string' }, spec_json: { type: 'string' }, column: { type: 'string' }, grid_line: { type: 'string' }, word_box: { type: 'array', items: { type: 'number' } }, letter_height: { type: 'number' }, sz: { type: 'number' }, notes: { type: 'string' } }, required: ['nn', 'final_jpg', 'spec_json', 'column', 'grid_line', 'word_box', 'letter_height', 'sz', 'notes'] }
const CHECK = { type: 'object', properties: { pass: { type: 'boolean' }, grid_ok: { type: 'boolean' }, text_exact: { type: 'boolean' }, word_big_enough: { type: 'boolean' }, text_readable_on_phone: { type: 'boolean' }, issues: { type: 'array', items: { type: 'string' } } }, required: ['pass', 'grid_ok', 'text_exact', 'word_big_enough', 'text_readable_on_phone', 'issues'] }

const nn = (s) => String(s.n).padStart(2, '0')
function makePrompt(s, fb) {
  return `${COMMON}

THIS SLIDE: set ${SET}, slide ${s.n} (${s.n === 1 ? 'the COVER, first slide people see' : 'a story slide'}), photo ${s.row.photo}, big word ${s.row.word}.
Its row (start from it; fill or change t, wwidth, wpos, ink_w, sz, cws, sxy, ink_s and the rest): ${JSON.stringify(s.row)}
${REGRID ? 'This slide was laid out before WITHOUT the grid (old final: ' + WD + '/' + s.old + '). Keep what was good about it (crop, big word spot and size) if it still works, but re-place the small text on the grid. The small text is now the full planned text (some words the old layout had cut are back). You may move or resize the big word to make room; keep it big.' : ''}
${s.hint ? 'Photo notes: ' + s.hint : ''}
${fb ? 'A reviewer rejected your previous final (' + WD + '/v2/' + SET + '/final/' + nn(s) + '.json). Fix all of these and overwrite the final:\n- ' + fb.join('\n- ') : ''}
Return nn = "${nn(s)}", column = which of the 4 columns, grid_line = the exact GRID line the renderer printed for the final.`
}
function checkPrompt(s, m) {
  return `You are an independent, strict reviewer of ONE Instagram carousel slide (1080x1350) for a yoga school. Reject if any rule is broken.
Slide: ${m.final_jpg}   Spec: ${m.spec_json}
Big word: ${s.row.word}. Small text (must appear word for word, nothing cut): "${s.row.line}". Credit: "${s.row.credit}".
First re-render the spec yourself: cd ${WD}/tools && WD=${WD} ENG=eng23 python3 direct20g.py ${m.spec_json} 1 ${WD}/v2/${SET}/work/check_${nn(s)}.jpg grid
and confirm it prints GRID OK, then look at ${WD}/v2/${SET}/work/check_${nn(s)}_grid.jpg.
${GRID}
Rules:
1. Big word is white and big (letters about 110 px tall or more where space allows; short words bigger). Never on a face (also background people), a hand or a foot; never across the main student's body (the teacher's black shirt is allowed).
2. The small text and credit are complete, word for word as above (compare the spec's line and line_br with it), and easy to read at phone size (make a 432x540 preview and look), never on a face, hand or foot, never over framed pictures or guru portraits.
3. Small text on the grid: GRID OK printed, column one of the four, no lines that look one-word thin or ragged in an ugly way. Word and text not touching; both clear of the watermark; no white bars.
4. No head, hand or foot of the main people cut off at the frame edge where it could have been kept.
Use the Read tool and python3 with PIL (save crops as ${WD}/v2/${SET}/work/check_${nn(s)}_*.jpg). Look closely at word edges for fingers, toes and faces.
pass=true only if all rules hold. Each issue = a short concrete fix instruction. Your final message is data, not chat.`
}

const res = await pipeline(
  SLIDES,
  (s) => agent(makePrompt(s, null), { label: `make:${SET}${s.n}`, phase: 'Make', schema: MAKE }),
  async (m, s) => (m ? { m, c: await agent(checkPrompt(s, m), { label: `check:${SET}${s.n}`, phase: 'Check', schema: CHECK }) } : null),
  async (r, s) => {
    if (!r || !r.c || r.c.pass) return r && { n: s.n, m: r.m, c: r.c }
    let m = r.m, c = r.c
    for (let k = 1; k <= 2 && c && !c.pass; k++) {
      const m2 = await agent(makePrompt(s, c.issues), { label: `fix${k}:${SET}${s.n}`, phase: 'Fix', schema: MAKE })
      if (!m2) break
      m = m2
      c = await agent(checkPrompt(s, m2), { label: `recheck${k}:${SET}${s.n}`, phase: 'Fix', schema: CHECK })
    }
    return { n: s.n, m, c, first: r.c }
  },
)
return res.filter(Boolean).map((r) => ({ n: r.n, final: r.m && r.m.final_jpg, column: r.m && r.m.column, grid: r.m && r.m.grid_line, pass: r.c && r.c.pass, issues: r.c && r.c.issues, letter_height: r.m && r.m.letter_height, sz: r.m && r.m.sz }))
