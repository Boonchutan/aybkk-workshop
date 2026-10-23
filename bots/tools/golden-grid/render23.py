# render one carousel: engine for searched slides, direct20 for hand-placed ones: python render23.py spec.json outdir
import sys, json, os, subprocess
spec, out = sys.argv[1], sys.argv[2]; os.makedirs(out, exist_ok=True); env = dict(os.environ, ENG='eng23')
r = subprocess.run(['python3', 'eng23.py', spec, out], env=env, capture_output=True, text=True)
print('\n'.join(l[:120] for l in r.stdout.splitlines() if not l.startswith('INFO'))); print(r.stderr[-300:] if r.returncode else '')
for i, s in enumerate(json.load(open(spec))):
    if s.get('direct'):
        r = subprocess.run(['python3', 'direct20.py', spec, str(i + 1), os.path.join(out, '%02d.jpg' % (i + 1))], env=env, capture_output=True, text=True)
        print(i + 1, s['word'], 'direct', [l[:100] for l in r.stdout.splitlines() if l.startswith(('word', 'sent'))], r.stderr[-200:] if r.returncode else '')
