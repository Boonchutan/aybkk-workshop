# 4:5, no side bars, no cut heads. Cut top t + bottom b (t+b=1/6). If the bottom cut hides the
# watermark, lift it from the same photo and paste it back the same distance from the bottom.
from PIL import Image, ImageFilter
import numpy as np, sys
from ai_edge_litert.interpreter import Interpreter
T={'001':1/6,'002':0.0,'003':0.0,'004':1/6,'005':0.03,'006':1/6,'012':0.04,'015':1/6,'016':0.08,'017':1/6,
'018':0.12,'019':0.0,'022':0.0,'024':0.03,'025':1/6,'028':1/6,'030':0.0,'033':1/6,'034':1/6,'037':1/6,
'043':0.0,'046':1/6,'047':1/6,'048':0.12,'050':0.0,'051':1/6,'052':1/6,'053':0.12,'054':1/6,'056':1/6,
'058':0.04,'059':1/6,'062':0.0,'063':0.12,'064':0.12,'067':1/6,'072':1/6,'078':0.08,'080':1/6,'082':0.08,
'085':1/6,'086':0.0,'088':1/6,'092':0.05,'095':0.03,'101':1/6,'103':0.08,'105':0.12,'106':0.05,'107':1/6}
MOVE={'016':0.02,'078':0.02,'082':0.02,'103':0.02,'092':0.02}
MOVEX={'092':-1250}
it=Interpreter(model_path='deeplab.tflite'); it.allocate_tensors()
inp=it.get_input_details()[0]; outd=it.get_output_details()[0]
def mask(img):
    x=np.asarray(img.convert('RGB').resize((257,257)),dtype=np.float32)/127.5-1
    it.set_tensor(inp['index'],x[None]); it.invoke()
    m=(np.argmax(it.get_tensor(outd['index'])[0],-1)==15).astype(np.uint8)*255
    return Image.fromarray(m).resize((1080,1350),Image.BILINEAR)

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
