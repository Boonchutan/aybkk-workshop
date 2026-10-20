export const meta = {
  name: 'frames-oct20',
  description: 'Mark framed pictures, portraits, statues and altar items on the 36 Oct 20 photos so text never covers them',
  phases: [{ title: 'Mark', detail: '4 agents x 9 photos' }, { title: 'Check', detail: 'second pass adds missed items' }],
}
const G = '/tmp/claude-0/-home-user-aybkk-workshop/5fef75e8-f96a-51ec-a2b6-837dec39c8e1/scratchpad/oct20/work/grid/'
const BOX = { type: 'object', properties: { kind: { type: 'string', enum: ['framed_picture', 'portrait_of_teacher', 'statue_or_deity', 'clock', 'other_wall_item'] }, x0: { type: 'integer' }, y0: { type: 'integer' }, x1: { type: 'integer' }, y1: { type: 'integer' } }, required: ['kind', 'x0', 'y0', 'x1', 'y1'] }
const SCHEMA = { type: 'object', properties: { photos: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, items: { type: 'array', items: BOX } }, required: ['id', 'items'] } } }, required: ['photos'] }
const batches = []
for (let i = 0; i < args.ids.length; i += 9) batches.push(args.ids.slice(i, i + 9))
const BRIEF = `Each image is a 1080x1620 photo of an Ashtanga yoga class, shown at 720x1080 with a grid: cyan vertical lines and numbers = x in FULL 1080 coordinates, yellow horizontal lines and numbers = y in FULL 1620 coordinates. Give every box in FULL coordinates. Open each image with the Read tool.
The studio has shelves and walls with framed pictures, small portraits of the lineage teachers (Pattabhi Jois, Sharath Jois and others), deity statues and pictures (Ganesha, Krishna and so on), a wall clock, and other small objects. Mark EVERY framed picture, portrait, statue, deity image and clock you can see, even small, blurred or partly hidden ones, including ones seen in a mirror. Text must never be printed over these. Be generous: a box a little too big is better than one that cuts an item. Do not mark people, windows, curtains, mats or plain shelves.`
phase('Mark')
const out = await pipeline(batches,
  b => agent(`${BRIEF}\n\nPhotos: ${b.map(n => G + n + '.jpg').join(', ')}. Use id like 20-001.`, { label: `mark:${b[0]}`, phase: 'Mark', schema: SCHEMA }),
  (m, b) => agent(`${BRIEF}\n\nA first marker produced the boxes below. Open each photo again, add every missed item (small portraits in a row are often merged or missed: one box per frame is best, one box around a tight row is fine), and fix boxes that cut an item. Return the full corrected set.\n\nFIRST PASS:\n${JSON.stringify(m)}\n\nPhotos: ${b.map(n => G + n + '.jpg').join(', ')}`, { label: `check:${b[0]}`, phase: 'Check', schema: SCHEMA }))
return out.filter(Boolean).flatMap(r => r.photos)
