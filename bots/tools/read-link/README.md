# read-link (reads a video link or file)

Boonchu, 6 Nov 2026: "Watching video is not doing bad to someone. Delete that rule."
So the tool fetches a video link ONCE, as a normal visitor. Two lines stay, because the
safety checks enforce them anyway: never pretend to be another company's bot (the 3 Nov
version posed as Facebook's preview bot; removed 4 Nov), and never try to get around a
login wall or a rate limit. When the platform says no, ask Boonchu for the file
(Instagram Share > Download, or a screen recording; in chat or Google Drive).

Run, from the memory folder:

    python3 bots/tools/read-link/read_link.py "<link or file>"

It prints the caption (when the platform shows it), every spoken line with its time, and
the paths of up to 20 stills (one every 3 s). Open the stills with your image reader to see
what is on screen: text labels, faces, setting, edit tricks.

First run on a fresh computer installs yt-dlp and faster-whisper and downloads the speech
model (about 1 minute). `--model medium` for Thai, Chinese or Russian speech that comes out
wrong, `--no-frames` to skip the stills. YouTube often blocks cloud computers: then ask for
the file.

Names and messages of students or leads that show up in a video never go in a file.
