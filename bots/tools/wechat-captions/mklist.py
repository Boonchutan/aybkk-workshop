#!/usr/bin/env python3
# mklist.py -> out/wechat_v2_caption_list.md : every Chinese caption with its timing, meaning and the English it replaces
import json, re, os
J = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
strip = lambda s: re.sub(r'\{(y|c|w|/)\}', '', s)
t = lambda f: f'{f / 30:.2f}'
out = ['# WeChat v2: Chinese captions and timing (check list)', '',
       'Made by Plato on 21 Nov 2026. Times are seconds from the start of each video, exact to one frame (1/30 s). "Meaning" is a plain English back-translation, so a non-Chinese reader can check it.', '',
       'House style: simplified Chinese, no comma or full stop at the end of a line, asana names in Sanskrit (Latin letters), "体式" for asana, never "姿势".', '']
names = {'ch1': ('channel1', 'Monday led primary (ref 02)'), 'ch2': ('channel2', 'The devil in Kapotasana (ref 05)'), 'ch4': ('channel4', 'Before moon day (ref 07)'),
         'ch5': ('channel5', 'Backbend assistance (ref 01)'), 'ch6': ('channel6', 'After moon day (ref 08)'), 'ch7': ('channel7', 'Hard work: students or teacher? (ref 03)'),
         'ch8': ('channel8', 'Flexible girls and strong men hate this (ref 04)')}
MEAN46 = {'A1': "If you don't practise Ashtanga", 'A2': 'Drink a little red wine', 'A3': 'Have a slice of pizza', 'A4': 'Stay up late watching shows', 'A5': 'If you practise Ashtanga',
          'A6': 'Go to sleep nice and early', 'A7': 'Getting ready to get up at 4 am', 'A8': 'Mula bandha is phoning you', 'A9': "How to practise after moon day? / See the beginner's guide below",
          'B1': 'If you practise yoga / but not Ashtanga', 'B2': 'Tomorrow, practise as usual', 'B3': 'If you practise Ashtanga / but fewer than 6 days a week', 'B4': 'Tomorrow, practise as usual',
          'B5': 'If you practise Ashtanga 6 days a week', 'B6': 'Tomorrow is moon day', 'B7': 'You know', 'B8': 'Day off! (a happy shout)', 'B9': "See the moon day beginner's guide below"}
for ch in ('ch6', 'ch4', 'ch1', 'ch5', 'ch7', 'ch2', 'ch8'):
    P = json.load(open(f'{J}/{ch}.json')); nm, title = names[ch]
    out += [f'## {nm}: {title}', '']
    if 'events' in P:
        out += ['| Start | End | Chinese | Meaning |', '|---|---|---|---|']
        for e in P['events']:
            out.append(f"| {t(e['f0'])} | {t(e['f1'])} | {e['text'].replace(chr(10), ' / ')} | {MEAN46[e['id']]} |")
    else:
        build = any(len(b['states']) > 1 for b in P['blocks'])
        out += ['| Start | End | Chinese | Meaning | English it replaces |' + (' Build-up (second: text added) |' if build else ''), '|---|---|---|---|---|' + ('---|' if build else '')]
        for b in P['blocks']:
            f0, f1 = b['states'][0]['f0'], b['states'][-1]['f1']
            row = f"| {t(f0)} | {t(f1)} | {strip(b['layout']).replace(chr(10), ' / ')} | {b['bt'].replace('|', '/').replace(chr(10), ' ')} | {b['en'].replace(chr(10), ' / ').replace('|', '/')} |"
            if build:
                steps = []; prev = ''
                for s in b['states']:
                    cur = strip(s['text'])
                    if cur != prev:
                        steps.append(f"{t(s['f0'])}: {cur[len(prev):].replace(chr(10), ' / ').strip() or '(line break)'}"); prev = cur
                row += ' ' + ('; '.join(steps) if len(steps) > 1 else 'all at once') + ' |'
            out.append(row)
    out.append('')
open(f'{J}/out/wechat_v2_caption_list.md', 'w').write('\n'.join(out))
print('written', len('\n'.join(out)), 'chars,', len(out), 'lines')
