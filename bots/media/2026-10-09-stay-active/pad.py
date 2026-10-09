# Keep the full body: take rows y0..bottom of the original (watermark untouched), pad white on both sides to 4:5.
import sys, os, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from PIL import Image
import crop_o4 as C  # noqa: loads the mask model only
PAD={'9-012':0.03,'9-022':0.08,'9-029':0.09,'9-053':0.11,'9-065':0.0,'9-077':0.05,'9-092':0.02,'9-114':0.10,'9-127':0.08,'9-081':0.0,'9-133':0.0}
def pad(n,y0):
    im=Image.open(f'raw/{n}.jpg').convert('RGB'); w,h=im.size
    top=int(round(h*y0)); H=h-top; W=int(round(H*0.8)); p=(W-w)//2
    can=Image.new('RGB',(W,H),(255,255,255)); can.paste(im.crop((0,top,w,h)),(p,0))
    out=can.resize((1080,1350),Image.LANCZOS); out.save(f'crop/{n}.jpg',quality=92); C.mask(out).save(f'mask/{n}.png')
    return dict(y0=y0,w=w,h=h,W=W,p=p)
if __name__=='__main__':
    info={n:pad(n,y) for n,y in PAD.items() if not sys.argv[1:] or n in sys.argv[1:]}
    json.dump(info,open('pad_info.json','w')); print(info)
