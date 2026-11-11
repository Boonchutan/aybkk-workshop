import sys,numpy as np,cv2
from PIL import Image
def lin(x): x=x/255.0; return np.where(x<=0.04045,x/12.92,((x+0.055)/1.055)**2.4)
def srgb(x): x=np.clip(x,0,1); return np.where(x<=0.0031308,x*12.92,1.055*x**(1/2.4)-0.055)*255
def apply(im,gR,gB):
    L=lin(im.astype(np.float32)); Y0=(L*[0.2126,0.7152,0.0722]).sum(-1).mean()
    L=L*np.array([gR,1.0,gB],np.float32); Y1=(L*[0.2126,0.7152,0.0722]).sum(-1).mean()
    return srgb(L*(Y0/Y1)).round().astype(np.uint8)
def stats(im):
    lab=cv2.cvtColor(im,cv2.COLOR_RGB2LAB).astype(np.float32); Lm=lab[...,0]; a=lab[...,1]-128; b=lab[...,2]-128
    m=Lm>np.percentile(Lm,75); return float(b[m].mean()),float(a[m].mean())
def solve(small,tb,ta):
    best=None
    for gB in np.arange(1.0,1.9,0.02):
        for gR in np.arange(0.80,1.06,0.01):
            b,a=stats(apply(small,gR,gB)); c=(b-tb)**2+(a-ta)**2
            if best is None or c<best[0]: best=(c,gR,gB,b,a)
    return best
if __name__=='__main__':
    src=sys.argv[1]; out=sys.argv[2]
    im=np.asarray(Image.open(src).convert('RGB')); small=np.asarray(Image.fromarray(im).resize((360,540)))
    b0,a0=stats(small); print('orig b*,a*',round(b0,1),round(a0,1))
    tiles=[Image.fromarray(im).resize((540,810))]; labs=['original']
    for tb in (16,12.5,9):
        c,gR,gB,b,a=solve(small,tb,a0+0.5); print('target',tb,'gR %.2f gB %.2f -> b* %.1f a* %.1f'%(gR,gB,b,a))
        tiles.append(Image.fromarray(apply(im,gR,gB)).resize((540,810))); labs.append('b*=%s gR%.2f gB%.2f'%(tb,gR,gB))
    from PIL import ImageDraw,ImageFont
    f=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',22)
    sh=Image.new('RGB',(540*4+30,810),'white')
    for i,t in enumerate(tiles):
        d=ImageDraw.Draw(t); d.rectangle([0,0,330,32],fill=(0,0,0)); d.text((6,3),labs[i],font=f,fill=(255,255,255)); sh.paste(t,(i*550,0))
    sh.save(out,quality=88)
