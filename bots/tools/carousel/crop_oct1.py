# 4:5, no side bars, no cut heads. Cut top t + bottom b (t+b=1/6). If the bottom cut hides the
# watermark, lift it from the same photo and paste it back the same distance from the bottom.
from PIL import Image, ImageFilter
import numpy as np, sys
from ai_edge_litert.interpreter import Interpreter
T={'045':1/6,'066':1/6,'052':0.13,'053':0.017,'039':0.0,'008':1/6,'013':0.13,'019':0.158,'024':1/6,
   '054':0.0,'060':1/6,'062':0.13,'068':0.04,'016':0.05,'032':0.10,'029':0.04,'037':0.13,'011':0.125,'084':0.13,'014':0.13,'073':0.13,'055':0.13,'063':0.13,'048':0.13,'072':0.13,'017':0.13,'059':0.105}
# photos whose watermark must move: lift it, clean the old one away, paste it near the bottom (margin = share of height)
MOVE={'032':0.025,'059':0.025,'023':0.025}
import json as _j
for _n,_v in _j.load(open('autot.json')).items():
    if _v and _v.get('t') is not None and _n not in ('014','073','055','063','048','017','037','024'):
        T.setdefault(_n,_v['t'])
        if _v.get('move'): MOVE[_n]=0.025
it=Interpreter(model_path='deeplab.tflite'); it.allocate_tensors()
inp=it.get_input_details()[0]; outd=it.get_output_details()[0]
def mask(img):
    x=np.asarray(img.convert('RGB').resize((257,257)),dtype=np.float32)/127.5-1
    it.set_tensor(inp['index'],x[None]); it.invoke()
    m=(np.argmax(it.get_tensor(outd['index'])[0],-1)==15).astype(np.uint8)*255
    return Image.fromarray(m).resize((1080,1350),Image.BILINEAR)

T.update({'023':0.06,'041':0.02,'008':1/6,'054':1/6,'073':0.13,'016':1/6,'067':0.04,'018':1/6,'010':1/6,'076':1/6})
for n in (sys.argv[1:] or T):
    t=T[n]; im=Image.open(f'raw/{n}.jpg').convert('RGB'); w,h=im.size
    top=int(round(h*t)); ch=int(round(w*1.25)); b=h-top-ch
    box=(1450,int(h*0.880),3190,int(h*0.955))
    g=im.convert('L').crop(box); L=np.asarray(g).astype(float); bg=np.asarray(g.filter(ImageFilter.GaussianBlur(25))).astype(float)
    A=np.clip((L-bg-4)/np.maximum(255-bg,1),0,1)
    if n in MOVE:
        from scipy import ndimage
        m=ndimage.maximum_filter((A>0.04).astype(float),7); m=ndimage.gaussian_filter(m,2)
        R=np.asarray(im.crop(box)).astype(float); keep=(1-np.clip(m*2,0,1))[...,None]
        est=ndimage.gaussian_filter(R*keep,(18,18,0))/np.maximum(ndimage.gaussian_filter(keep,(18,18,0)),1e-3)
        im.paste(Image.fromarray(np.clip(R*(1-m[...,None])+est*m[...,None],0,255).astype('uint8')),box[:2])
    else:
        assert not (0.047*h < b < 0.115*h), (n,'watermark would be half cut')
    out=im.crop((0,top,w,top+ch))
    if n in MOVE:
        rows=np.where(A.max(1)>0.3)[0]; tb=rows.max()
        y=int(ch-MOVE[n]*h-tb)
        out.paste(Image.new('RGB',(box[2]-box[0],box[3]-box[1]),(255,255,255)),(box[0],y),Image.fromarray((A*255).astype('uint8')))
    if b>0.06*h and n not in MOVE:
        g=im.convert('L').crop(box); L=np.asarray(g).astype(float); bg=np.asarray(g.filter(ImageFilter.GaussianBlur(25))).astype(float)
        alpha=Image.fromarray((np.clip((L-bg-4)/np.maximum(255-bg,1),0,1)*255).astype('uint8'))
        # soft dark floor so the white text reads like the original
        a=out.convert('RGBA'); grad=np.zeros((ch,w),np.uint8); y0=int(ch*0.80)
        grad[y0:]=(np.linspace(0,1,ch-y0)**1.3*150)[:,None].astype(np.uint8)
        dark=Image.new('RGBA',(w,ch),(10,8,6,0)); dark.putalpha(Image.fromarray(grad))
        out=Image.alpha_composite(a,dark).convert('RGB')
        out.paste(Image.new('RGB',alpha.size,(255,255,255)),(box[0],box[1]-top-b),alpha)
    out=out.resize((1080,1350),Image.LANCZOS); out.save(f'crop/{n}.jpg',quality=92); mask(out).save(f'mask/{n}.png')
    print(n,'top',round(t,3),'bottom',round(b/h,3),flush=True)
