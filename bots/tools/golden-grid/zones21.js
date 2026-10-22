export const meta = {
  name: 'zones-oct21',
  description: 'Mark faces, hands, feet and bodies on the 20 Oct 21 photos, then group photos of the same person',
  phases: [{ title: 'Mark', detail: '3 agents x 7 photos' }, { title: 'Check', detail: 'second pass checks and fixes each batch' }, { title: 'People', detail: 'one agent groups photos of the same person' }],
}
const G = '/tmp/claude-0/-home-user-aybkk-workshop/5fef75e8-f96a-51ec-a2b6-837dec39c8e1/scratchpad/oct21/work/grid/'
const BOX = { type: 'object', properties: { x0: { type: 'integer' }, y0: { type: 'integer' }, x1: { type: 'integer' }, y1: { type: 'integer' } }, required: ['x0', 'y0', 'x1', 'y1'] }
const WHOBOX = { type: 'object', properties: { who: { type: 'string', enum: ['main', 'background'] }, x0: { type: 'integer' }, y0: { type: 'integer' }, x1: { type: 'integer' }, y1: { type: 'integer' } }, required: ['who', 'x0', 'y0', 'x1', 'y1'] }
const SCHEMA = { type: 'object', properties: { photos: { type: 'array', items: { type: 'object', properties: {
  id: { type: 'string' },
  main_body: { type: 'array', items: BOX, description: '2 to 6 boxes that together tightly cover the whole main student(s) body, incl. a teacher who is adjusting them, limbs included' },
  faces: { type: 'array', items: WHOBOX },
  hands: { type: 'array', items: WHOBOX },
  feet: { type: 'array', items: WHOBOX },
  background_bodies: { type: 'array', items: BOX, description: 'other people in the photo (not main), one box each' },
  free_areas: { type: 'array', items: BOX, description: 'up to 3 biggest empty rectangles (no people, no watermark) where text could go' },
  frames: { type: 'array', items: { type: 'object', properties: { kind: { type: 'string', enum: ['framed_picture', 'portrait_of_teacher', 'statue_or_deity', 'clock', 'other_wall_item'] }, x0: { type: 'integer' }, y0: { type: 'integer' }, x1: { type: 'integer' }, y1: { type: 'integer' } }, required: ['kind', 'x0', 'y0', 'x1', 'y1'] }, description: 'every framed picture, teacher portrait, deity statue or picture, and clock on the walls and shelves' },
  asana: { type: 'string', description: 'best guess of the asana name (Ashtanga name) or "unsure"' },
  person: { type: 'string', description: 'short look of the main student: sex, hair, clothes colours, mat; and of the adjusting teacher if any' },
}, required: ['id', 'main_body', 'faces', 'hands', 'feet', 'background_bodies', 'free_areas', 'frames', 'asana', 'person'] } } }, required: ['photos'] }
const IDS = args.ids
const batches = []
for (let i = 0; i < IDS.length; i += 7) batches.push(IDS.slice(i, i + 7))
const BRIEF = `Each image is a 1080x1620 yoga photo shown at 720x1080 with a grid: cyan vertical lines and numbers = x in FULL 1080 coordinates, yellow horizontal lines and numbers = y in FULL 1620 coordinates. Give every box in the FULL coordinates (read them off the grid). Open each image with the Read tool.
For each photo mark: main_body (2-6 boxes covering the main student's whole body including raised legs, arms, hands and feet; if a teacher is adjusting, include the teacher), every face (main and background, even blurred or half faces), the main student's hands and feet as SEPARATE lists (also clearly visible background hands and feet, who=background), other people as background_bodies, every framed picture, small teacher portrait, deity statue or picture and wall clock as frames (one box each; text must never cover them), and up to 3 free_areas (empty wall/window/floor with no people). The photographer's watermark sits at x 330-750, y 1430-1540: free_areas must avoid it. Be generous: boxes should fully cover, a little margin is better than cutting a hand or a toe.`
phase('Mark')
const out = await pipeline(batches,
  b => agent(`${BRIEF}\n\nPhotos: ${b.map(n => G + n + '.jpg').join(', ')}. Use id like 21-007.`, { label: `mark:${b[0]}`, phase: 'Mark', schema: SCHEMA }),
  (m, b) => agent(`${BRIEF}\n\nA first marker produced the boxes below. Open each photo again and CHECK them: add any missing face, hand, foot or body part (raised feet and hands near the top are often missed, and so are hands hidden behind the back), fix boxes that cut a body part, add missed frames, portraits and statues, remove free_areas that touch a person. Return the corrected full set.\n\nFIRST PASS:\n${JSON.stringify(m)}\n\nPhotos: ${b.map(n => G + n + '.jpg').join(', ')}`, { label: `check:${b[0]}`, phase: 'Check', schema: SCHEMA }))
const zones = out.filter(Boolean).flatMap(r => r.photos)
phase('People')
const people = await agent(`These 20 yoga class photos were all taken in one Mysore class at AYBKK on 21 Oct. Find photos that show the SAME main student (or the same adjusting teacher as a main figure), so a carousel never has more than 2 photos of one person and never puts them on two slides in a row.
Open the contact sheets ${G}contact1.jpg and ${G}contact2.jpg (the second sheet may hold only 2 tiles) (each tile is labelled with its number) and open single photos ${G}20-XXX.jpg when you need a closer look. Look at face, hair, body, tattoos, and clothes (people keep the same clothes all class).
Descriptions from earlier markers: ${JSON.stringify(zones.map(z => ({ id: z.id, person: z.person })))}
Return groups of 2 or more photo ids (like "21-007") that share a main person. A photo can be in more than one group if two main people appear (for example a student and the adjusting teacher in a purple tank top). Only group when you are fairly sure; say how sure.`,
  { label: 'people', phase: 'People', schema: { type: 'object', properties: { groups: { type: 'array', items: { type: 'object', properties: { ids: { type: 'array', items: { type: 'string' } }, who: { type: 'string' }, sure: { type: 'string', enum: ['high', 'medium'] } }, required: ['ids', 'who', 'sure'] } } }, required: ['groups'] } })
return { zones, people }
