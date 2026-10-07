# 4:5, no side bars, no cut heads. Cut top t + bottom b (t+b=1/6). If the bottom cut hides the
# watermark, lift it from the same photo and paste it back the same distance from the bottom.
from PIL import Image, ImageFilter
import numpy as np, sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from ai_edge_litert.interpreter import Interpreter
T={'6-002': 0.16666666666666666, '6-008': 0.12, '7-002': 0.12, '7-004': 0.12, '7-010': 0.12, '7-015': 0.12, '7-016': 0.12, '7-019': 0.12, '7-021': 0.12, '7-027': 0.12, '7-028': 0.12, '7-029': 0.0, '7-030': 0.12, '7-032': 0.12, '7-033': 0.12, '7-034': 0.12, '7-036': 0.12, '7-037': 0.12, '7-038': 0.12, '7-039': 0.12, '7-043': 0.12, '7-045': 0.12, '7-046': 0.12, '7-049': 0.12, '7-050': 0.0, '7-051': 0.12, '7-052': 0.0, '7-056': 0.12, '7-059': 0.12, '7-061': 0.12, '7-066': 0.12, '7-068': 0.12, '7-071': 0.12}
MOVE={}
MOVEX={}
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
