set -e
cd "$(dirname "$0")"
python3 caps5.py > caps.log 2>&1 &
python3 cards5.py > cards.log 2>&1 &
wait
ffmpeg -hide_banner -loglevel error -y -i cut.mov -i mixed.wav -i top.mov -i caps5.mov -filter_complex_script fc_final.txt -map "[v]" -map 1:a -c:v libx264 -preset medium -crf 18 -r 30 -c:a aac -b:a 192k -shortest -movflags +faststart ep5_hq.mp4
ffmpeg -hide_banner -loglevel error -y -i ep5_hq.mp4 -c:v libx264 -preset slow -b:v 2200k -pass 1 -passlogfile p5f -an -f null /dev/null
ffmpeg -hide_banner -loglevel error -y -i ep5_hq.mp4 -c:v libx264 -preset slow -b:v 2200k -pass 2 -passlogfile p5f -c:a aac -b:a 128k -movflags +faststart HiddenStories_Ep5_GoSmall.mp4
ls -l ep5_hq.mp4 HiddenStories_Ep5_GoSmall.mp4
for t in 1 4 7 10 14 18 21 24 28 31 34 37 40 43 46 49 52 55 58; do ffmpeg -hide_banner -loglevel error -y -ss $t -i HiddenStories_Ep5_GoSmall.mp4 -frames:v 1 -vf scale=216:-2 v_$t.jpg; done
python3 -c "
from PIL import Image
ts=[1,4,7,10,14,18,21,24,28,31,34,37,40,43,46,49,52,55,58]; ims=[Image.open(f'v_{t}.jpg') for t in ts]; w,h=ims[0].size
c=Image.new('RGB',(w*10,h*2)); [c.paste(im,((i%10)*w,(i//10)*h)) for i,im in enumerate(ims)]; c.save('vsheet.jpg')"
echo RENDER_DONE
