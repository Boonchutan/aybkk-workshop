# 4:5 with NO side bars and NO cut heads: cut top t + bottom b (t+b=1/6); if the bottom cut hides
# the watermark, paste the exact watermark (lifted from 085) back at the same distance from the bottom.
from PIL import Image, ImageFilter
import numpy as np, sys
from ai_edge_litert.interpreter import Interpreter
T3={'029':0.15,'031':0.15,'103':0.0,'033':0.03,'162':1/6,'085':0.07}
src=Image.open('raw/085.jpg'); W0,H0=src.size
box=(1040,int(H0*0.915),2990,int(H0*0.985))
L=np.asarray(src.convert('L').crop(box)).astype(float)
bg=np.asarray(src.convert('L').crop(box).filter(ImageFilter.GaussianBlur(25))).astype(float)
alpha=np.clip((L-bg-4)/np.maximum(255-bg,1),0,1); alpha=Image.fromarray((alpha*255).astype('uint8'))
it=Interpreter(model_path='deeplab.tflite'); it.allocate_tensors()
inp=it.get_input_details()[0]; outd=it.get_output_details()[0]
def mask(img):
    x=np.asarray(img.convert('RGB').resize((257,257)),dtype=np.float32)/127.5-1
    it.set_tensor(inp['index'],x[None]); it.invoke()
    m=(np.argmax(it.get_tensor(outd['index'])[0],-1)==15).astype(np.uint8)*255
    return Image.fromarray(m).resize((1080,1350),Image.BILINEAR)
for n,t in T3.items():
    im=Image.open(f'raw/{n}.jpg').convert('RGB'); w,h=im.size
    top=int(round(h*t)); ch=int(round(w*1.25)); b=h-top-ch
    out=im.crop((0,top,w,top+ch))
    if b>h*0.05:
        assert (w,h)==(W0,H0)
        white=Image.new('RGB',alpha.size,(255,255,255))
        out.paste(white,(box[0],box[1]-top-b),alpha)
    out=out.resize((1080,1350),Image.LANCZOS); out.save(f'crop/{n}.jpg',quality=92); mask(out).save(f'mask/{n}.png')
    print(n,'top',round(t,3),'bottom',round(b/h,3))
