from PIL import Image, ImageFilter, ImageEnhance
import numpy as np, glob, os
from ai_edge_litert.interpreter import Interpreter
# fraction of the 2:3 original cut from the top; the rest is fitted and padded with blur
T={'029':0.13,'031':0.13,'085':0.07,'103':0.0,'158':0.05,'146':0.0,'159':0.0,'162':0.0,'033':0.0,'073':0.0}
it=Interpreter(model_path='deeplab.tflite'); it.allocate_tensors()
inp=it.get_input_details()[0]; outd=it.get_output_details()[0]
def mask(img):
    x=np.asarray(img.convert('RGB').resize((257,257)),dtype=np.float32)/127.5-1
    it.set_tensor(inp['index'],x[None]); it.invoke()
    m=(np.argmax(it.get_tensor(outd['index'])[0],-1)==15).astype(np.uint8)*255
    return Image.fromarray(m).resize((1080,1350),Image.BILINEAR)
for f in sorted(glob.glob('raw/*.jpg')):
    n=os.path.basename(f)[:3]; im=Image.open(f).convert('RGB'); w,h=im.size
    t=T.get(n,1/6); top=int(h*t); keep=im.crop((0,top,w,h))
    kh=h-top; kw=w
    s=1350/kh; nw=round(kw*s)
    if nw>=1080:
        out=keep.resize((nw,1350),Image.LANCZOS); x=(nw-1080)//2; out=out.crop((x,0,x+1080,1350))
    else:
        bg=keep.resize((1080,1350)).filter(ImageFilter.GaussianBlur(40))
        bg=ImageEnhance.Brightness(bg).enhance(0.55)
        bg.paste(keep.resize((nw,1350),Image.LANCZOS),((1080-nw)//2,0)); out=bg
    out.save(f'crop/{n}.jpg',quality=92); mask(out).save(f'mask/{n}.png')
    print(n,round(t,3),nw)
