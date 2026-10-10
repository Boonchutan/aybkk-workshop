import html, sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import myths_data as D

SRC = sys.argv[1]
OUT = sys.argv[2]

NAMES = {1:'Happy, then we met',2:'Before and now',3:"They think I'm",4:'After all these years',5:'I can, I cannot',
 6:'The secret',7:'Good answer, silly answer',8:'The empty compliment',9:'So, that',10:'Good news, bad news',
 11:'Three, third breaks',12:'The timeline',13:'Two voices',14:'The honest why',15:'The understatement',16:'The ladder',
 17:'Take the cliche literally',18:'Double down',19:'Reach further',20:'The flat comparison',21:'The confession',
 22:'Bring a cake',23:'Wrong reason',24:'Head vs mirror',25:'The tag',26:'The pedant',27:"I don't like to brag",
 28:'Ask the wrong expert',29:'Nobody talks about',30:'Pick one',31:'The callback',32:'Act it out',33:'Read it flat',
 34:'The tiny fear',35:'What I really mean',36:'Big word, plain thing',37:'Nothing happened',38:'The exact number',
 39:'Hard truth first',40:'The closer'}

e = lambda x: html.escape(x, quote=False)

def card(x):
    o = [f'    <article class="myth" id="m-{x["id"]}">', f'      <h4>{e(x["t"])}</h4>']
    meta = f'<span class="asana">{e(x["a"])}</span>'
    if x.get('used'):
        meta += f' <span class="used">{e(x["used"])}</span>'
    o.append(f'      <p class="meta">{meta}</p>')
    if 's' in x:
        o.append(f'      <p class="story">{e(x["s"])}</p>')
    else:
        o.append(f'      <p class="story"><b class="k">Myth.</b> {e(x["m"])}</p>')
        o.append(f'      <p class="story"><b class="k">What is true.</b> {e(x["f"])}</p>')
    t, u = x['src']
    o.append(f'      <p class="src">Source: <a href="{html.escape(u)}" target="_blank" rel="noopener">{e(t)}</a></p>')
    o.append('      <ul class="lines">')
    for n, line in x['j']:
        o.append(f'        <li><span class="tag"><b>{n}</b> {e(NAMES[n])}</span>{e(line)}</li>')
    o.append('      </ul>')
    o.append('    </article>')
    return '\n'.join(o)

def start(ids, groups):
    by = {x['id']: x for g in groups for x in g[1]}
    li = ''.join(f'<li><a href="#m-{i}">{e(by[i]["t"])}</a></li>' for i in ids)
    return f'  <div class="start"><p class="start-h">Start here: five for Reels</p><ol>{li}</ol></div>'

def panel(pid, h2, note, groups, ids):
    o = [f'<section class="panel" id="{pid}" role="tabpanel">', f'  <h2>{e(h2)}</h2>', f'  <p class="note">{note}</p>', start(ids, groups)]
    for gname, items in groups:
        o.append(f'  <h3 class="group">{e(gname)}</h3>')
        o += [card(x) for x in items]
    o.append('</section>')
    return '\n'.join(o)

NOTE_A = ('Old stories about long life, ageing and moving, most of them behind an asana name. '
          'Tell the story flat, in two or three lines. Then one joke on yourself. Then the true line, slower. '
          '&ldquo;The story goes&rdquo; means legend: say it that way. Every story was checked against the source under it on 10 October 2026. '
          'The number on each joke is its skeleton.')
NOTE_B = ('Things people believe about age, exercise and yoga, and old book promises, each next to what the evidence says. '
          'The joke lands on you, never on the old text or the people in the study. Say &ldquo;linked to&rdquo;, never &ldquo;proves&rdquo;. '
          'Checked against the source under each item on 10 October 2026.')

CSS = '''
  .start {
    margin: 0 0 1.75rem;
    padding: 0.9rem 1rem;
    border-left: 4px solid var(--marigold);
  }
  .start .start-h { margin: 0 0 0.4rem; font-weight: 600; }
  .start ol { margin: 0; padding-left: 1.25rem; }
  .start li { margin: 0 0 0.2rem; }
  .start a, article.myth .src a { color: var(--accent); }
  article.myth { margin: 0 0 2.25rem; scroll-margin-top: 4.5rem; }
  article.myth h4 {
    font-size: 1.2rem;
    font-weight: 800;
    line-height: 1.25;
    margin: 0 0 0.2rem;
    text-wrap: balance;
  }
  article.myth .meta { margin: 0 0 0.5rem; font-size: 0.85rem; color: var(--ink-soft); }
  article.myth .meta .asana { font-weight: 600; color: var(--accent); }
  article.myth .meta .used {
    display: inline-block;
    margin-left: 0.25rem;
    padding: 0 0.45rem;
    border: 1px solid var(--rule);
    border-radius: 999px;
    font-size: 0.78rem;
  }
  article.myth p.story { margin: 0 0 0.5rem; }
  article.myth b.k { font-weight: 600; color: var(--accent); }
  article.myth p.src { margin: 0 0 0.9rem; font-size: 0.82rem; color: var(--ink-soft); overflow-wrap: anywhere; }
  article.myth ul.lines li { margin-bottom: 0.9rem; }
'''

s = open(SRC, encoding='utf-8').read()
anchor_css = '  @media (prefers-reduced-motion: no-preference) {'
assert s.count(anchor_css) == 1
s = s.replace(anchor_css, CSS.lstrip('\n') + '\n' + anchor_css)

anchor_tab = '    <button role="tab" aria-selected="false" data-tab="locked">Second series</button>'
assert s.count(anchor_tab) == 1
s = s.replace(anchor_tab,
  '    <button role="tab" aria-selected="false" data-tab="myths">Asana myths</button>\n'
  '    <button role="tab" aria-selected="false" data-tab="mythfact">Myth vs fact</button>\n' + anchor_tab)

anchor_sec = '<!-- SECOND SERIES (LOCKED) -->'
assert s.count(anchor_sec) == 1
new = ('<!-- ASANA MYTHS -->\n' + panel('myths', 'Asana myths', NOTE_A, D.A_GROUPS, D.START_A) + '\n\n'
       '<!-- MYTH VS FACT -->\n' + panel('mythfact', 'Myth vs fact', NOTE_B, D.B_GROUPS, D.START_B) + '\n\n')
s = s.replace(anchor_sec, new + anchor_sec)

open(OUT, 'w', encoding='utf-8').write(s)
print('ok', len(s))
