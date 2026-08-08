# kids/

`school-skills.html` — "Foundation Playground", a self-contained learning page
for a child starting Foundation (first formal school year) at AISB Bangkok.
Six games, one per learning area in the school's Foundation letter.

**Do not edit `school-skills.html` by hand.** It is generated. Edit
`school-skills.src.html` and run:

    node kids/build.js

The build inlines four woff2 faces from `public/fonts/` as data URIs — the
published page runs under a CSP that blocks every external host, so a font URL
would fail silently — and re-runs the same inline-JS syntax check the repo uses
for `public/*.html`.

The built file is an HTML **fragment** (no `<!doctype>`/`<html>`/`<body>`): the
Artifact publisher supplies that wrapper. To open it locally, wrap it yourself.
