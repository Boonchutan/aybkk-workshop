#!/usr/bin/env python3
"""mkspec.py: turn the reviewed caption data (out/five_result.json) into wxcap2 specs chN.json"""
import json, re, sys, os
J = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
D = {r['ch']: r for r in json.load(open(J + '/out/five_result.json'))}
strip = lambda s: re.sub(r'\{(y|c|w|/)\}', '', s)
OV = json.load(open(J + '/overrides.json')) if os.path.exists(J + '/overrides.json') else {}

def states_from_steps(zh_steps, f1, fmap):
    out = []
    for i, s in enumerate(zh_steps):
        a = fmap(s['clean_f']); b = fmap(zh_steps[i + 1]['clean_f']) if i + 1 < len(zh_steps) else f1
        if b > a: out.append({'f0': a, 'f1': b, 'text': s['text']})
    return out

def build(ch):
    r = D[ch]; fin = {b['id']: b for b in r['final']['blocks']}
    blocks = []
    ident = lambda f: f
    if ch in ('ch2', 'ch8'):   # 24 fps reference: time-locked. ref frame k = round(t*24) -> first clean frame at/after that time
        f2t = {}
        for b in r['read']['blocks']:
            f2t[b['clean_f0']] = b['ref_t0']; f2t[b['clean_f1']] = b['ref_t1']
            for s in b['steps']: f2t[s['clean_f']] = s['ref_t']
        fmap = lambda f: (5 * round(f2t[f] * 24) + 3) // 4
    else:
        fmap = ident
    for b in r['read']['blocks']:
        z = fin[b['id']]; ov = OV.get(ch, {}).get(b['id'], {})
        zs = ov.get('zh_steps', z['zh_steps'])
        f1 = fmap(b['clean_f1'])
        blk = {'id': b['id'], 'layout': zs[-1]['text'], 'en': b['steps'][-1]['text'], 'bt': z['back_translation']}
        if ch == 'ch2' and 'zh_steps' not in ov:
            S = [s for s in json.load(open(J + '/out/agents/ch2_final/zh_states.json')) if s['block'] == b['id']]
            blk['states'] = [{'f0': fmap(s['f0']), 'f1': fmap(s['f1']), 'text': s['text']} for s in S if fmap(s['f1']) > fmap(s['f0'])]
        else:
            blk['states'] = states_from_steps(zs, f1, fmap)
        y0, y1, x0, x1 = b['bbox']
        if ch == 'ch1':
            blk.update(cy=round((y0 + y1) / 2, 4), cx=0.537 if b['id'] in ('b01', 'b02', 'b03', 'b04') else 0.5)
        elif ch == 'ch5': blk.update(cy=0.502, cx=0.5)
        elif ch == 'ch7': blk.update(cy=0.577, cx=0.5, align='left')
        elif ch == 'ch2': blk.update(cy=0.503, cx=0.5)
        elif ch == 'ch8': blk.update(cy=0.500, align='left')
        blk.update(ov.get('style', {}))
        blocks.append(blk)
    DEF = {
        'ch1': dict(font='body', size=0.050, stroke=0.045, shadow=dict(dx=0, dy=0.03, blur=0.05, alpha=0.55), line_gap=1.28),
        'ch5': dict(font='body', size=0.060, stroke=0.06, shadow=dict(dx=0, dy=0.03, blur=0.04, alpha=0.5), line_gap=1.20),
        'ch7': dict(font='body', size=0.066, stroke=0.055, line_gap=1.20),
        'ch2': dict(font='serif', size=0.058, stroke=0.024, shadow=dict(dx=-0.07, dy=0.07, blur=0, alpha=1.0), line_gap=1.22),
        'ch8': dict(font='serif', size=0.075, stroke=0.03, shadow=dict(dx=0.055, dy=0.055, blur=0, alpha=1.0), line_gap=1.08),
    }[ch]
    spec = {'src': f'clean/{ch}.mp4', 'out': f'out/wechat v2 channel{ch[2:]}.mp4', 'defaults': DEF, 'blocks': blocks}
    if ch == 'ch7': spec['audio'] = {'file': 'out/ch7_mix.wav'}
    return spec

if __name__ == '__main__':
    for ch in sys.argv[1:]:
        spec = build(ch)
        if ch == 'ch8':   # one left edge per spoken sentence, centred on the frame by its widest line (computed after layout in wxcap2 units)
            spec['groups'] = [['b01', 'b02', 'b03'], ['b04'], ['b05', 'b06', 'b07'], ['b08', 'b09'], ['b10'], ['b11', 'b12', 'b13'], ['b14', 'b15'], ['b16', 'b17'], ['b18', 'b19'], ['b20', 'b21'], ['b22'], ['b23'], ['b24']]
        json.dump(spec, open(f'{J}/{ch}.json', 'w'), ensure_ascii=False, indent=1)
        print(ch, 'blocks', len(spec['blocks']), 'states', sum(len(b['states']) for b in spec['blocks']))
