cd "$(dirname "$0")"
ffmpeg -hide_banner -loglevel error -y -i cut.mp4 -i mixed.wav -i top.mov -i caps4.mov -filter_complex_script fc_final.txt -map "[v]" -map 1:a -c:v libx264 -preset medium -crf 18 -r 30 -c:a aac -b:a 192k -shortest -movflags +faststart ep4_hq.mp4 || { echo RENDERFAIL; exit 1; }
ffmpeg -hide_banner -loglevel error -y -i ep4_hq.mp4 -c:v libx264 -preset slow -b:v 1650k -pass 1 -passlogfile p4f -an -f null /dev/null
ffmpeg -hide_banner -loglevel error -y -i ep4_hq.mp4 -c:v libx264 -preset slow -b:v 1650k -pass 2 -passlogfile p4f -c:a aac -b:a 128k -movflags +faststart HiddenStories_Ep4_Tittibhasana.mp4
ls -l ep4_hq.mp4 HiddenStories_Ep4_Tittibhasana.mp4
for t in 1 5 9 13 20 27 33 40 47 56 62 67 72 76 81 88 95 100 104 110 114 119; do ffmpeg -hide_banner -loglevel error -y -ss $t -i HiddenStories_Ep4_Tittibhasana.mp4 -frames:v 1 -vf scale=216:-2 v_$t.jpg; done
python3 -c "
from PIL import Image
ts=[1,5,9,13,20,27,33,40,47,56,62,67,72,76,81,88,95,100,104,110,114,119]; ims=[Image.open(f'v_{t}.jpg') for t in ts]; w,h=ims[0].size
c=Image.new('RGB',(w*11,h*2)); [c.paste(im,((i%11)*w,(i//11)*h)) for i,im in enumerate(ims)]; c.save('vsheet.jpg')"
echo RENDER_DONE
