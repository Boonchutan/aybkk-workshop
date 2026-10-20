export const meta = {
  name: 'review-slides-oct20',
  description: 'Two strict checks per Oct 20 carousel: crop and coverage, then type and layout',
  phases: [{ title: 'Review', detail: 'crop lens and type lens per carousel' }],
}
const O = '/tmp/claude-0/-home-user-aybkk-workshop/5fef75e8-f96a-51ec-a2b6-837dec39c8e1/scratchpad/oct20/work/out/'
const FULL = '/tmp/claude-0/-home-user-aybkk-workshop/5fef75e8-f96a-51ec-a2b6-837dec39c8e1/scratchpad/oct20/work/full/'
const ZOOM = '/tmp/claude-0/-home-user-aybkk-workshop/5fef75e8-f96a-51ec-a2b6-837dec39c8e1/scratchpad/oct20/review/'
const PROBS = ['text_on_face', 'text_on_hand', 'text_on_main_feet', 'hides_key_part_of_asana', 'text_on_background_face', 'body_cut_by_frame', 'too_much_empty_floor', 'no_space_above_head', 'text_cut_off', 'hard_to_read', 'busy_background_behind_text', 'off_grid_or_messy', 'big_empty_area_unused', 'covers_watermark', 'watermark_on_person', 'same_person_as_previous_slide', 'other']
const SCHEMA = { type: 'object', properties: { slides: { type: 'array', items: { type: 'object', properties: {
  file: { type: 'string' },
  verdict: { type: 'string', enum: ['ok', 'fix'] },
  problems: { type: 'array', items: { type: 'string', enum: PROBS } },
  detail: { type: 'string', description: 'what exactly is wrong and where on the slide' },
  better: { type: 'string', description: 'if fix: what to change (e.g. move the sentence to the empty window top-left x 60-600 y 60-400, or crop lower so the feet show), or none' },
}, required: ['file', 'verdict', 'problems', 'detail', 'better'] } } }, required: ['slides'] }
const STYLE = `Style of these slides (locked by the owner): a big bold Helvetica keyword, a smaller serif italic sentence, and a small caps credit, in off-white or charcoal with only a soft shadow, snapped to a golden-ratio grid (margins 60 px, lines at x 413/667 and y 516/834). The keyword and the sentence may sit together (stacked) or apart in two corners (split). The photographer's watermark 'AYBKK SHALA BANGKOK / Oct 20th Mysore / Boonchu Tanti' must stay readable and must not be covered.`
const LENS = {
  crop: `YOUR LENS: crop and coverage. Rules: the 4:5 window may only move up or down (full width always); if a crop would cut the student, the full photo is used with thin white side bars (that is allowed). Never cut legs or feet; leave a little space above the head and under the feet, but no big empty floor under the student. Text may sit on bodies, but NEVER on a face or a hand (main student, teacher or background), and never on the main student's feet or on the key part of the asana (the bind, the gaze, the lifted foot). Compare each slide with its full original photo (listed) to see what the crop cut. Also check that the watermark does not sit on a face or a hand.`,
  type: `YOUR LENS: type and layout. Check: letters cut off at an edge, text hard to read on a phone (low contrast, busy window bars or picture frames behind the small serif sentence), text not aligned to the grid or messy, a big empty calm area left empty while the text is squeezed elsewhere, text touching the watermark, and whether the main student is the same person as on the previous slide (people keep the same clothes all class; the teacher wears a purple tank top).`,
}
const posts = args.posts
const jobs = []
for (const p of posts) for (const lens of ['crop', 'type']) jobs.push({ p, lens })
const res = await parallel(jobs.map(({ p, lens }) => () => agent(`You are a strict photo editor for an Ashtanga yoga studio's Instagram. Open each slide (1080x1350) with the Read tool, in order: ${p.files.map((f, i) => O + p.k + '/' + f + ' (full photo: ' + FULL + p.photos[i] + '.jpg)').join(', ')}.
${STYLE}
${LENS[lens]}
To see small details, you may crop and zoom with python3 -I and PIL into a new file in ${ZOOM} and Read it.
${args.note || ''}
Be picky and concrete. Only flag real problems a careful owner would see on a phone. For 'fix', say exactly what is wrong and what to change.`, { label: `review:${p.k}:${lens}`, phase: 'Review', schema: SCHEMA })))
return res.map((r, i) => ({ post: jobs[i].p.k, lens: jobs[i].lens, slides: r ? r.slides : null }))
