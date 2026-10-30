# itch.io page kit: Escape Velocity

Everything here was captured from the committed build (4e04f58) running in the browser. Nothing is uploaded yet.
These are page assets only. The game zip still comes from `build.ps1` / `build.sh`.

## Files

| File | Size | What it is | Where it goes on itch |
|---|---|---|---|
| `cover.png` | 630x500, 469 KB | Comet flinging away from the scowling supernova on the maroon HYPERSONIC page, title in the game's own hand-lettering | Edit game > Cover image |
| `cover-315x250.png` | 315x250, 141 KB | Close-up: nova face and the worried comet in a PERFECT burst, no title | Spare / small thumbnail (itch scales the 630x500 one itself) |
| `gameplay.gif` | 360x640, 15 fps, 5.2 s loop, 5.3 MB | Catch, orbit, gold release, PERFECT, NICE/BLAZING milestones, page turn into WARP SPEED | Top of the description (or as the first screenshot) |
| `gameplay.mp4` | 360x640, 30 fps, 5.2 s, 2.5 MB | Same clip as the GIF, sharper and smaller | Social posts / the jam page. itch has no video upload, so link YouTube if you want video |
| `screenshots/01-menu.png` | 720x1280, 1.3 MB | Title page | Screenshots |
| `screenshots/02-cards.png` | 720x1280, 1.5 MB | Upgrade card pick (Tight Spin / Wide Perfect / Afterburner) | Screenshots |
| `screenshots/03-milestone-warp.png` | 720x1280, 2.0 MB | UNSTOPPABLE! chain milestone at 343 km/s on the black WARP SPEED page | Screenshots |
| `screenshots/04-hyperspace.png` | 720x1280, 1.9 MB | HYPERSPACE page (purple graph paper) | Screenshots |
| `screenshots/05-gameover.png` | 720x1280, 1.1 MB | Notebook game over page with stats and build | Screenshots |
| `description.md` | ~2 KB | Page text (pitch, theme, how to play, features, controls, credits) | Paste into Description |
| `README.md` | this file | Settings checklist | Not uploaded |

Suggested screenshot order: 03, 02, 04, 05, 01. Put the action shots first; the menu shows least.

## Upload settings (Edit game)

- **Title:** Escape Velocity. Note: `index.html` still says `<title>Slapjam Game</title>`, so fix it in the game before the final build.
- **Kind of project:** HTML
- **Uploads:** the build zip, with **"This file will be played in the browser"** checked
- **Embed options:**
  - Viewport dimensions: **405 x 720** (or **450 x 800** if the page layout is wide enough). Both are 9:16, so the 720x1280 game scales cleanly
  - **Mobile friendly:** on. Orientation: **Portrait**
  - **Fullscreen button:** on
  - **Automatically start on page load:** off. The click-to-play button also unlocks Web Audio and avoids loading the game in the background on phones
  - Scrollbars: off
- **Genre:** Action. **Tags:** arcade, one-button, mobile, hand-drawn, space, roguelite, speed, game-jam
- **AI disclosure:** yes. Code, art and audio were generated with Claude Code (see description credits)
- **Visibility:** Draft/Restricted until the final phone test, then Public before submitting to the jam

## Page theme (Edit theme)

Match the sketchbook: navy construction paper with cream gel-pen ink and crayon accents.

| Setting | Color | Why |
|---|---|---|
| Background | `#1f2a4a` | LIFTOFF navy paper |
| Inner column background | `#1d2747` | Slightly darker paper so the text column reads as a page |
| Text | `#f6ecd2` | Cream gel-pen ink |
| Links | `#f7c948` | Crayon yellow (the PLAY button / VELOCITY lettering) |
| Buttons | `#f28c38` | Crayon orange (the title underline / comet) |
| Button text | `#1d1b2f` | Dark ink, same as the in-game buttons |
| Borders | `#e5533d` | Crayon red, the supernova's color (optional) |

- Font: pick the boldest rounded header font the theme editor offers (closest to Lilita One), or leave the default.
- Banner: optional. The cover crop works as a header if you want one.
- Background image: none. Plain navy reads cleaner than a texture behind the embed.
