"""Build the Edits kit for The Perfectionist from plan.json + rendered pieces. Usage: python3 -I kit.py <final.mp4>"""
import json, os, shutil, subprocess, sys, imageio_ffmpeg
FF = imageio_ffmpeg.get_ffmpeg_exe(); P = '/tmp/claude-0/-home-user-aybkk-workshop/5fef75e8-f96a-51ec-a2b6-837dec39c8e1/scratchpad/perf/'
K = P + 'kit/'; shutil.rmtree(K, ignore_errors=True); os.makedirs(K)
BOX = {'chest': (120, 1050, 840, 600), 'head': (90, 262, 900, 760), 'tall': (270, 1025, 540, 640)}
it = json.load(open(P + 'work/plan.json'))['items']
shutil.copy(sys.argv[1], K + '00_REFERENCE_perfectionist_ep1.mp4')
subprocess.run([FF, '-loglevel', 'error', '-y', '-i', P + 'work/aroll_video.mp4', '-i', P + 'work/aroll_audio.wav', '-map', '0:v', '-map', '1:a',
                '-c:v', 'libx264', '-crf', '18', '-preset', 'slow', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '256k', '-movflags', '+faststart',
                K + '01_TALK_cut_with_DJI_mic_audio.mp4'], check=True)
shutil.copy(P + 'work/title.png', K + '02_TITLE_whole_video.png')
shutil.copy(P + 'work/captions.srt', K + '03_captions.srt')
def mmss(t): return '%d:%05.2f' % (int(t // 60), t % 60)
rows = []
for i, x in enumerate(it):
    name = 'B%02d_at_%s_%s.mp4' % (i + 1, mmss(x['out']).replace(':', 'm').replace('.', 's'), x['n'].split(' ', 1)[0])
    shutil.copy(P + f'work/pieces/p{i:02d}.mp4', K + name)
    bx, by, bw, bh = BOX[x['box']]
    rows.append('%s  %s-%s  %-5s box x%d y%d w%d h%d  (%s, from %.1f s of %s)' % (name, mmss(x['out']), mmss(x['out'] + x['dur']), x['box'], bx, by, bw, bh, x['n'], x['src'], x['clip']))
open(K + '04_shot_list.txt', 'w').write('THE PERFECTIONIST, Ep. 1: B-roll boxes over the talking track (times = timeline of 01_TALK).\n'
    'chest = box over his chest, face visible. head = box over his face. tall = narrow box over his chest.\n'
    'Each box: rounded corners, thin white border, quick fade in and out (4 frames).\n\n' + '\n'.join(rows) + '\n')
print('kit files', len(os.listdir(K)))
