# Builds cards_zh.py from cards3.py: same timing and pictures, Chinese card text, Noto Sans SC font.
import json
Z=json.load(open('zh.json'))['cards']
src=open('cards3.py').read()
R={
"'2,000 years ago'":'years_title',"'his story was told long before him'":'years_sub',
"'Mahabharata'":'maha_title',"'the great old story book'":'maha_sub',
"\"Grey hair doesn't make you old.\"":'grey_q1',"\"What you know makes you old.\"":'grey_q2',"'the boy, age 12'":'grey_who',
"'all six series'":'six_title',"'Guruji taught him everything'":'six_sub',
"'\"I could feel my body'":'heal_q1',"'heal and repair.\"'":'heal_q2',"'Sharathji','💚'":None,
"'Guruji was too weak to teach'":'y2007_sub',
"'300 to 400'":'mysore_title',"'students every morning in Mysore'":'mysore_sub',
"'the truth'":'truth_title',"'a strong body makes the practice'":'truth_1',"'the practice makes the body strong'":'truth_2',
"'both'":'both_title',"'Ashtavakra: a crooked boy'":'both_1',"'Sharathji: a sick boy'":'both_2',"'the practice made them strong'":'both_3',
"'Happy birthday, Sharathji'":'bday_title',"'29 September 1971'":'bday_sub',
}
for k,v in R.items():
    assert k in src, k
    src=src.replace(k, repr(Z['heal_who'])+",'💚'" if v is None else repr(Z[v]))
patch='''from softcards2 import *
import softcards2 as S
from PIL import ImageFont
_zc={}
def zmont(size,wg):
    wg=int(round(wg/50)*50); k=(size,wg)
    if k not in _zc:
        f=ImageFont.truetype('NotoSansSC.ttf',size); f.set_variation_by_axes([wg]); _zc[k]=f
    return _zc[k]
S.mont=zmont; mont=zmont
S.HEADER_TEXT=%r
def g_eight(lt):
    im=S.navy_bg(); d=ImageDraw.Draw(im)
    S.ctext(d,110,%r,56,800,S.GOLD); S.ctext(d,185,%r,56,800,S.GOLD)
    a=smooth((lt-0.6)/0.3)
    if a>0: S.ctext(d,275,%r,44,600,S.fade(S.CREAM,a))
    return im
''' % (Z['header'],Z['eight_1'],Z['eight_2'],Z['eight_3'])
src=src.replace('from softcards2 import *',patch,1)
src=src.replace("'top.mov'","'top_zh.mov'").replace("f'top_{t}.png'","f'topzh_{t}.png'")
open('cards_zh.py','w').write(src); print('ok')
