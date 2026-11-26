import json
S = '/tmp/claude-0/-home-user-aybkk-workshop/5fef75e8-f96a-51ec-a2b6-837dec39c8e1/scratchpad/perf/work/'
keep = json.load(open(S + 'cut.json'))['keep_mic']
C = [(0.00, 1.26, "They can smell yesterday's"), (1.26, 3.18, "tiger balm on the next mat."),
     (4.00, 5.00, "This is Yogi superpower."), (5.96, 7.68, "The mat perfectionist."),
     (8.50, 9.84, "That towel always"), (9.84, 11.04, "matches their clothes."),
     (12.08, 13.56, "That mat sits straight"), (13.56, 14.54, "on the floor line."),
     (15.44, 17.30, "That sweat towel is folded,"), (17.30, 19.48, "same spot, every day."),
     (20.10, 20.60, "If it moves,"), (21.38, 23.00, "they stop and put it back."),
     (24.02, 25.18, "Your mat is crooked?"), (25.70, 27.22, "They notice before you did."),
     (28.40, 29.18, "One wrinkle"), (29.18, 30.56, "or the towel under the hand"),
     (30.56, 31.30, "when you jump through,"), (32.50, 33.40, "everything is ruined."),
     (34.50, 36.20, "And this is exactly why"), (36.20, 37.36, "they understand asana."),
     (37.90, 39.42, "They know that right side"), (39.42, 40.58, "is tighter than the left,"),
     (40.58, 42.22, "and by how much,"), (42.22, 43.16, "in centimeter."),
     (43.90, 44.80, "They will tell me:"), (44.80, 46.48, "\"Teacher, my right shoulder"),
     (46.48, 47.66, "locked better today."), (48.28, 49.46, "I feel my lat control"),
     (49.46, 50.90, "down to the seventh rib.\""), (51.78, 52.66, "Seventh rib?"),
     (53.40, 54.60, "It sounds like me"), (54.60, 55.38, "when I teach anatomy."),
     (56.30, 57.64, "And when they get stuck"), (57.64, 58.82, "in any asana,"),
     (59.44, 60.64, "they will come and ask."), (61.84, 62.68, "They would find out."),
     (63.60, 64.88, "And they work on it"), (64.88, 65.80, "until it's fixed."),
     (67.54, 68.78, "It's busy season now."), (69.70, 70.80, "The room is full."),
     (71.40, 73.12, "And everybody is working"), (73.12, 73.96, "on their own practice."),
     (74.30, 75.00, "And yes,"), (75.80, 77.12, "they know whose mat"),
     (77.12, 78.24, "is smelly this week."), (79.30, 80.22, "Send this to"),
     (80.90, 81.76, "you know who."), (82.50, 83.88, "And come practise with us.")]
def out(t):
    acc = 0
    for a, b in keep:
        if t < a: return acc
        if t <= b: return acc + (t - a)
        acc += b - a
    return acc
def ts(x):
    ms = int(round(x * 1000)); return '%02d:%02d:%02d,%03d' % (ms // 3600000, ms // 60000 % 60, ms // 1000 % 60, ms % 1000)
rows = []
for i, (a, b, t) in enumerate(C):
    oa, ob = out(a), out(b)
    if i + 1 < len(C): ob = min(max(ob, oa + 0.6), out(C[i + 1][0]))
    rows.append((oa, ob, t))
open(S + 'captions.srt', 'w').write('\n'.join('%d\n%s --> %s\n%s\n' % (i + 1, ts(a), ts(b), t) for i, (a, b, t) in enumerate(rows)))
json.dump(rows, open(S + 'captions.json', 'w'))
print(len(rows), 'captions, last ends %.2f' % rows[-1][1])
for r in rows[:6]: print(r)
