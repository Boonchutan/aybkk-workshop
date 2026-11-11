# usage: python3 -I wbfix.py <WD> <pid> <target bright b*>   (always starts from the untouched download dl/<pid>.jpg)
import sys,os,importlib.util,numpy as np,cv2
from PIL import Image,ImageDraw,ImageFont
W,pid,tb=sys.argv[1],sys.argv[2],float(sys.argv[3]); sys.path.insert(0,W+'/wb'); import wb
spec=importlib.util.spec_from_file_location('c18',W+'/crop18_lib.py'); c18=importlib.util.module_from_spec(spec); spec.loader.exec_module(c18)
big=np.asarray(Image.open(f'{W}/dl/{pid}.jpg').convert('RGB'))
o1080=np.asarray(Image.fromarray(big).resize((1080,1620),Image.LANCZOS))
small=np.asarray(Image.fromarray(big).resize((360,540))); b0,a0=wb.stats(small)
c,gR,gB,b,a=wb.solve(small,tb,a0+0.5)
fix=wb.apply(big,gR,gB)
reg=o1080[c18.WY0:c18.WY1,c18.WX0:c18.WX1].copy(); al=c18.wm_alpha(reg).astype(np.float32)
A=np.zeros(o1080.shape[:2],np.float32); A[c18.WY0:c18.WY1,c18.WX0:c18.WX1]=cv2.dilate(al,np.ones((3,3),np.uint8))
Af=cv2.resize(A,(big.shape[1],big.shape[0]),interpolation=cv2.INTER_LINEAR)[...,None]
fix=(fix*(1-Af)+big*Af).round().astype(np.uint8)
Image.fromarray(fix).save(f'{W}/wb/AYBKK-Nov11-{pid[3:]}-less-yellow.jpg',quality=95,subsampling=0)
f1080=Image.fromarray(fix).resize((1080,1620),Image.LANCZOS); f1080.save(f'{W}/full/{pid}.jpg',quality=95)
f=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',16)
g=f1080.resize((720,1080),Image.LANCZOS); d=ImageDraw.Draw(g)
for y in range(0,1620,100):
    yy=y*720//1080; d.line([(0,yy),(720,yy)],fill=(255,0,0),width=1); d.text((3,yy+2),str(y),font=f,fill=(255,255,0),stroke_width=2,stroke_fill=(0,0,0))
for x in range(0,1080,100):
    xx=x*720//1080; d.line([(xx,0),(xx,1080)],fill=(0,200,255),width=1); d.text((xx+3,3),str(x),font=f,fill=(0,255,255),stroke_width=2,stroke_fill=(0,0,0))
g.save(f'{W}/grid/{pid}.jpg',quality=85)
Image.fromarray(o1080).save(f'{W}/wb/{pid}_orig_1080.jpg',quality=92)
print(pid,'orig b* %.1f a* %.1f -> b* %.1f a* %.1f  gains R %.2f B %.2f'%(b0,a0,b,a,gR,gB))
