# Edit jobs (Plato → Edits app on the Mac mini)

Plato can't reach the Edits app (it only runs on the Mac mini). To get a video cut, Plato writes one JSON file here per job. A runner on the mini checks every 10 minutes, builds the edit in Edits as a draft, and writes the result back into the same file.

Drafts only. The runner never posts or shares anything. Boonchu reviews the project in Edits (or the mp4 in Drive `AYBKK/_Plato_Edits/`) and posts it himself.

## File: `bots/edit-jobs/<YYYY-MM-DD>-<slug>.json`

```json
{
  "id": "2026-11-08-ep6-hanuman",
  "created": "2026-11-08T06:50:00+07:00",
  "by": "plato",
  "status": "queued",
  "title": "Ep. 6 Hanuman, adjustment montage",
  "brief": "45s vertical reel. Fast cuts (0.25s) over the adjustment photos, hold 1s on the three fullest-room shots, end on the headstand spot. On-screen hook in the first 2s: <hook>. No music (Boonchu adds it in-app).",
  "media": ["01_China_Program/City_Workshops/Zhuhai/day10"],
  "text": ["<hook line>", "<closing line>"],
  "format": { "aspect": "9:16", "seconds": 45 }
}
```

- `media`: paths relative to Drive `My Drive/AYBKK/`. Folders or files. Only what the job should use.
- `status`: Plato sets `queued`. The runner sets `running`, then `done`, `failed` or `needs-boonchu`, and adds `result` (`project`, `mp4`, `notes`).
- To re-run a failed job, set `status` back to `queued` (fix the brief first).
- Write one job per file. Don't edit a file while it is `running`.
