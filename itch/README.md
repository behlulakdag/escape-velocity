# itch.io page kit: Escape Velocity

Everything here was captured from the final working tree (818d5be + the last polish round: momentum visuals, milestone queueing, HUD crown backing) running in the browser. Nothing is uploaded yet.
These are page assets only. The game zip still comes from `build.ps1` / `build.sh`.

## Files

| File | Size | What it is | Where it goes on itch |
|---|---|---|---|
| `cover.png` | 630x500, 469 KB | Comet flinging away from the scowling supernova on the maroon HYPERSONIC page, title in the game's own hand-lettering | Edit game > Cover image |
| `cover-315x250.png` | 315x250, 141 KB | Close-up: nova face and the worried comet in a PERFECT burst, no title | Spare / small thumbnail (itch scales the 630x500 one itself) |
| `gameplay.gif` | 360x640, 12.5 fps, 6.7 s loop, 7.2 MB | Real autopilot run cut into 5 beats that climb 310 -> 605 km/s: HYPERSONIC page turn, BLAZING/UNSTOPPABLE stamps and PERFECT rings on WARP SPEED, the flame crown growing, page turn into the cream ESCAPE VELOCITY page, ends on UNSTOPPABLE! at 604 km/s | Top of the description (or as the first screenshot) |
| `gameplay.mp4` | 540x960, 30 fps, 6.7 s, 3.6 MB | Same clip as the GIF, sharper and smoother | Social posts / the jam page. itch has no video upload, so link YouTube if you want video |
| `screenshots/01-about-to-be-eaten.png` | 720x1280, 1.4 MB | The worried comet at 460 km/s with the flame crown, the supernova's jaws right behind it (cream ESCAPE VELOCITY page) | Screenshots |
| `screenshots/02-cards.png` | 720x1280, 1.6 MB | Upgrade card pick: Gravity Well / Overdrive (legendary) / Slingshot | Screenshots |
| `screenshots/03-milestone-hyperspace.png` | 720x1280, 2.0 MB | UNSTOPPABLE! stamp at 459 km/s, combo 49, PERFECT ring, flame crown, on the purple HYPERSPACE page | Screenshots |
| `screenshots/04-escape-velocity-page.png` | 720x1280, 1.9 MB | Page turn from HYPERSPACE into the cream ESCAPE VELOCITY page at 521 km/s | Screenshots |
| `screenshots/05-gameover.png` | 720x1280, 1.1 MB | Notebook game over page: top speed 613 km/s headline, 17256 m, combo 98, build | Screenshots |
| `screenshots/06-menu.png` | 720x1280, 1.3 MB | Title page | Screenshots |
| `description.md` | ~2 KB | Page text (pitch, momentum hook, theme, how to play, features, controls, AI tools credits) | Paste into Description |
| `README.md` | this file | Settings checklist | Not uploaded |

Suggested screenshot order: 01, 03, 04, 02, 05, 06. Put the action shots first; the menu shows least.

Capture notes: frames were driven by `game.loop.step` with audio silenced (master gain 0, speaker shown on). The GIF is a cut of one real expert-autopilot run (no forced speed). Screenshot 01 was staged with console state (altitude teleport, speed pinned at 460 km/s, supernova moved up behind the comet); 02, 03, 04 and 05 come from unforced autopilot runs.

## Upload settings (Edit game)

- **Title:** Escape Velocity (`index.html` already uses this title).
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
