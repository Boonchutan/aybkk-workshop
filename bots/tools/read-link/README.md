# read-link (reads a video file)

Instagram, Facebook, TikTok and YouTube do not let bots download their videos.
We do not get around that: no fake user agents, no downloaders, no logins.
(The first version, 3 Nov, posed as Facebook's link-preview bot. Machi caught it on
4 Nov and it was removed the same day.)

When Boonchu sends a video link:
1. Run `python3 bots/tools/read-link/read_link.py "<link>"`. You get the caption only where
   the platform shares it openly (TikTok and YouTube titles). Instagram and Facebook show
   bots a login page, so there is usually no caption.
2. Ask him for the video file: Instagram's share button, then "Download" (works on most
   public reels), or a screen recording. He can attach it in chat or drop it in Google Drive.
3. Run `python3 bots/tools/read-link/read_link.py <file>`. It prints every spoken line with its
   time, and the paths of up to 20 stills (one every 3 s). Open the stills with your image
   reader to see what is on screen: text labels, faces, setting, edit tricks.

First run on a fresh computer installs faster-whisper and downloads the speech model
(about 1 minute). Add `--model medium` for Thai, Chinese or Russian speech that comes out
wrong, `--no-frames` to skip the stills.

Names and messages of students or leads that show up in a video never go in a file.
