cd "$(dirname "$0")"
ffmpeg -hide_banner -loglevel error -y -i base.mov -i mixed.wav -i top_zh.mov -i caps_zh.mov -filter_complex_script fc_final.txt -map "[v]" -map 1:a -c:v libx264 -preset medium -crf 18 -r 30 -c:a aac -b:a 192k -shortest -movflags +faststart ep3_zh_hq.mp4 || { echo RENDERFAIL; exit 1; }
ffmpeg -hide_banner -loglevel error -y -i ep3_zh_hq.mp4 -c:v libx264 -preset slow -b:v 1700k -pass 1 -passlogfile pz -an -f null /dev/null
ffmpeg -hide_banner -loglevel error -y -i ep3_zh_hq.mp4 -c:v libx264 -preset slow -b:v 1700k -pass 2 -passlogfile pz -c:a aac -b:a 128k -movflags +faststart HiddenStories_Ep3_Ashtavakra_ZH.mp4
ls -l ep3_zh_hq.mp4 HiddenStories_Ep3_Ashtavakra_ZH.mp4
for t in 1 6 12 20 30 36 44 50 58 66 76 82 90 96 104 112 120 124; do ffmpeg -hide_banner -loglevel error -y -ss $t -i HiddenStories_Ep3_Ashtavakra_ZH.mp4 -frames:v 1 -vf scale=216:-2 vz_$t.jpg; done
python3 -c "
from PIL import Image
ts=[1,6,12,20,30,36,44,50,58,66,76,82,90,96,104,112,120,124]; ims=[Image.open(f'vz_{t}.jpg') for t in ts]; w,h=ims[0].size
c=Image.new('RGB',(w*9,h*2)); [c.paste(im,((i%9)*w,(i//9)*h)) for i,im in enumerate(ims)]; c.save('vzsheet.jpg')"
echo RENDER_DONE
