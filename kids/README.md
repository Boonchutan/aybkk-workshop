# kids/

Two self-contained learning pages, one per child.

| App | Source | For |
|---|---|---|
| **Foundation Playground** | `school-skills.src.html` | Boone — Foundation at AISB, plus a Year 1–2 band |
| **Petal Playground** | `petal.src.html` | his sister — pre-K1, age 3 |

**Do not edit the built `.html` files by hand.** They are generated. Edit the
`*.src.html` and run:

    node kids/build.js

The build inlines the woff2 faces from `public/fonts/` as data URIs — the
published page runs under a CSP that blocks every external host, so a font URL
would fail silently — and re-runs the same inline-JS syntax check the repo uses
for `public/*.html`.

Each app emits two files:

- `school-skills.html` / `petal.html` — an HTML **fragment** for the Artifact
  publisher, which supplies its own `<!doctype>`/`<head>`/`<body>`.
- `foundation-playground.html` / `petal-playground.html` — a complete document
  that plays when opened straight off a device, with no account and no network.
  This is the copy to put in Files on an iPad.

The two apps share four mascot SVGs (snail, panda, giraffe, elephant), copied
rather than imported: they are separate deliverables and a change made for one
child should not silently alter the other's page.

Within an app, **every tile has its own animal** — no mascot appears on two
tiles. Adding a game means drawing a new one. Both apps' test suites assert it.

Difficulty in both apps is per game and driven only by stars earned in that
game (`lvl(id)`), so one child's strong subject never drags a weaker one along
with it. Petal levels every 10 stars to a maximum of 4, and a level also
lengthens the game: `winFor(id)` grows the run from four rounds to seven.

`petal.src.html` contains a body-safety game ("Clothes Stay On"). It is
ordinary protective early-years material — the swimsuit rule. Two of its three
round types offer only a positive action, because putting "take them off" on a
button would model the behaviour it teaches against, and no body is ever
depicted. Keep both properties if you edit it.
