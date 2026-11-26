import subprocess, io, json, sys, os, shutil, imageio_ffmpeg
from PIL import Image, ImageDraw, ImageFont
FF=imageio_ffmpeg.get_ffmpeg_exe(); P='/tmp/claude-0/-home-user-aybkk-workshop/5fef75e8-f96a-51ec-a2b6-837dec39c8e1/scratchpad/perf/'
V, D = sys.argv[1], sys.argv[2]
shutil.rmtree(D, ignore_errors=True); os.makedirs(D)
raw=subprocess.run([FF,'-loglevel','error','-i',V,'-vf','fps=2,scale=270:480','-f','image2pipe','-vcodec','png','-'],capture_output=True).stdout
sig=b'\x89PNG'; ims=[Image.open(io.BytesIO(sig+p)).convert('RGB') for p in raw.split(sig) if p]
f=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',16)
n=0
for k in range(0,len(ims),12):
    sh=Image.new('RGB',(270*6,500*2),(0,0,0)); d=ImageDraw.Draw(sh)
    for j,im in enumerate(ims[k:k+12]):
        x,y=(j%6)*270,(j//6)*500; sh.paste(im,(x,y)); d.text((x+4,y+481),'t=%.1fs'%((k+j)*0.5+0.25),font=f,fill=(255,255,0))
    sh.save(D+f'sheet_{n:02d}.jpg',quality=88); n+=1
it=json.load(open(P+'work/plan.json'))['items']
for i,x in enumerate(it):
    t=x['out']+x['dur']/2
    subprocess.run([FF,'-loglevel','error','-y','-ss','%.3f'%t,'-i',V,'-frames:v','1','-vf','scale=540:960',D+f'box_{i:02d}.jpg'],check=True)
cap=json.load(open(P+'work/captions.json'))
keep=json.load(open(P+'work/cut.json'))['keep_mic']; cuts=[]; acc=0
for a,b in keep[:-1]: acc+=round((b-a)*30)/30; cuts.append(round(acc,3))
open(D+'timeline.txt','w').write('VIDEO: '+V+'\n\nB-ROLL BOXES (output seconds)\n'+'\n'.join('%2d %-22s %6.2f-%6.2f  %s  box=%s'%(i,x['n'],x['out'],x['out']+x['dur'],x['clip'],x['box']) for i,x in enumerate(it))+
  '\n\nTALKING-HEAD JUMP CUTS (output seconds): '+', '.join('%.2f'%c for c in cuts)+'\n\nSPOKEN LINES (output seconds)\n'+'\n'.join('%6.2f-%6.2f %s'%(a,b,t) for a,b,t in cap))
print(len(ims),'frames',n,'sheets',len(it),'boxes')
