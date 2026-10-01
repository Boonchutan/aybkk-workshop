# Limb-safe 4:5 crop: keep the main student (largest person blob) whole, top and bottom, with a margin.
from PIL import Image
import numpy as np, json, sys
from scipy import ndimage
from ai_edge_litert.interpreter import Interpreter
it=Interpreter(model_path='deeplab.tflite'); it.allocate_tensors()
inp=it.get_input_details()[0]; outd=it.get_output_details()[0]
POOL=sys.argv[1:]
res={}
for n in POOL:
    im=Image.open(f'raw/{n}.jpg'); im.draft('RGB',(1200,1800)); im=im.convert('RGB')
    x=np.asarray(im.resize((257,257)),dtype=np.float32)/127.5-1; it.set_tensor(inp['index'],x[None]); it.invoke()
    m=np.argmax(it.get_tensor(outd['index'])[0],-1)==15
    lab,k=ndimage.label(m)
    if not k: res[n]=None; continue
    sz=ndimage.sum(m,lab,range(1,k+1)); big=np.argmax(sz)+1
    rows=np.where((lab==big).any(1))[0]; y0,y1=rows.min()/257,(rows.max()+1)/257
    lo=max(0,y1+0.03-0.8333); hi=min(1/6,y0-0.03)
    ok=[t for t in np.arange(0,0.1667+1e-9,0.005) if lo<=t<=hi]
    if not ok: res[n]=dict(y0=round(y0,3),y1=round(y1,3),t=None); continue
    good=[t for t in ok if t>=0.12] or [t for t in ok if t<=0.052] or ok
    t=good[len(good)//2] if good is ok else (good[0] if good[0]>=0.12 else good[-1])
    res[n]=dict(y0=round(y0,3),y1=round(y1,3),t=round(float(t),3),move=bool(0.052<t<0.12))
    print(n,res[n],flush=True)
json.dump(res,open('autot.json','w'),indent=1)
