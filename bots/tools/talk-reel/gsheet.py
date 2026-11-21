# gsheet.py video out.jpg t0 t1 step cellw cols
import sys, subprocess, io
from PIL import Image, ImageDraw
v,out,t0,t1,st,cw,cols=sys.argv[1],sys.argv[2],float(sys.argv[3]),float(sys.argv[4]),float(sys.argv[5]),int(sys.argv[6]),int(sys.argv[7])
ims=[];t=t0
while t<=t1+1e-6:
    p=subprocess.run(['ffmpeg','-v','error','-ss',str(t),'-i',v,'-frames:v','1','-vf',f'scale={cw}:-2','-f','image2pipe','-vcodec','png','-'],capture_output=True).stdout
    if not p: break
    im=Image.open(io.BytesIO(p)).convert('RGB'); d=ImageDraw.Draw(im); d.rectangle([0,0,44,12],fill=(0,0,0)); d.text((2,1),f"{t:.1f}",fill=(255,255,0))
    ims.append(im); t+=st
w,h=ims[0].size; rows=(len(ims)+cols-1)//cols
S=Image.new('RGB',(cols*(w+2),rows*(h+2)),'black')
for i,im in enumerate(ims): S.paste(im,((i%cols)*(w+2),(i//cols)*(h+2)))
S.save(out,quality=82); print(out,len(ims))
