# 4:5, no side bars, no cut heads. Cut top t + bottom b (t+b=1/6). If the bottom cut hides the
# watermark, lift it from the same photo and paste it back the same distance from the bottom.
from PIL import Image, ImageFilter
import numpy as np, sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from ai_edge_litert.interpreter import Interpreter
T={'8-004': 0.12, '8-012': 0.12, '8-017': 0.12, '8-027': 0.12, '8-031': 0.12, '8-052': 0.12, '8-085': 0.0, '8-098': 0.12, '8-101': 0.12, '8-103': 0.0, '8-105': 0.12, '8-110': 0.12, '8-111': 0.12, '8-117': 0.0, '8-119': 0.0, '8-120': 0.12, '8-124': 0.12, '8-134': 0.12, '8-137': 0.12, '8-140': 0.0, '8-142': 0.12, '8-144': 0.12, '8-148': 0.12, '8-149': 0.0, '8-153': 0.12, '8-154': 0.12, '8-157': 0.12, '8-158': 0.07, '8-160': 0.0, '8-167': 0.12}
MOVE={'8-158':0.005}
MOVEX={'8-158':1020}
it=Interpreter(model_path=os.path.join(os.path.dirname(os.path.abspath(__file__)),'deeplab.tflite')); it.allocate_tensors()
inp=it.get_input_details()[0]; outd=it.get_output_details()[0]
def mask(img):
    x=np.asarray(img.convert('RGB').resize((257,257)),dtype=np.float32)/127.5-1
    it.set_tensor(inp['index'],x[None]); it.invoke()
    m=(np.argmax(it.get_tensor(outd['index'])[0],-1)==15).astype(np.uint8)*255
    return Image.fromarray(m).resize((1080,1350),Image.BILINEAR)

for n in (sys.argv[1:] or T):
    t=T[n]; im=Image.open(f'raw/{n}.jpg').convert('RGB'); w,h=im.size
    top=int(round(h*t)); ch=int(round(w*1.25)); b=h-top-ch
    sc=w/4640; box=(int(1450*sc),int(h*0.880),int(3190*sc),int(h*0.955))
    g=im.convert('L').crop(box); L=np.asarray(g).astype(float); bg=np.asarray(g.filter(ImageFilter.GaussianBlur(25))).astype(float)
    A=np.clip((L-bg-4)/np.maximum(255-bg,1),0,1)
    if n in MOVE:
        from scipy import ndimage
        m=ndimage.maximum_filter((A>0.015).astype(float),15); m=ndimage.gaussian_filter(m,3)
        R=np.asarray(im.crop(box)).astype(float); keep=(1-np.clip(m*3,0,1))[...,None]
        est=ndimage.gaussian_filter(R*keep,(18,18,0))/np.maximum(ndimage.gaussian_filter(keep,(18,18,0)),1e-3)
        im.paste(Image.fromarray(np.clip(R*(1-m[...,None])+est*m[...,None],0,255).astype('uint8')),box[:2])
    else:
        assert not (0.047*h < b < 0.115*h), (n,'watermark would be half cut')
    out=im.crop((0,top,w,top+ch))
    if n in MOVE:
        rows=np.where(A.max(1)>0.3)[0]; tb=rows.max()
        y=int(ch-MOVE[n]*h-tb)
        out.paste(Image.new('RGB',(box[2]-box[0],box[3]-box[1]),(255,255,255)),(box[0]+MOVEX.get(n,0),y),Image.fromarray((A*255).astype('uint8')))
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
