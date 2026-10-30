# itch.io page kit: Escape Velocity

Everything here was recaptured on Oct 31 from the final working tree (12f38dd: tutorial, new zone pages, pause button, redrawn supernova jaws, taped set scraps) running in the browser. Nothing is uploaded yet.
These are page assets only. The game zip still comes from `build.ps1` / `build.sh`.

## Files

| File | Size | What it is | Where it goes on itch |
|---|---|---|---|
| `cover.png` | 630x500, 469 KB | Comet flinging away from the scowling supernova on the maroon HYPERSONIC page, title in the game's own hand-lettering (Oct 30 capture, still current art) | Edit game > Cover image |
| `cover-315x250.png` | 315x250, 141 KB | Close-up: nova face and the worried comet in a PERFECT burst, no title | Spare / small thumbnail (itch scales the 630x500 one itself) |
| `gameplay-page.gif` | 344x550, 9 fps, 6.2 s loop, 2.8 MB | One real autopilot run cut into 6 beats that climb 313 -> 525 km/s, edge-cropped and kept at half size (not 3/8 like the old 270x480 clip) so the HUD text and paper grain stay readable: page turn into the maroon HYPERSONIC page, page turn into WARP SPEED, UNSTOPPABLE! stamp at 389 km/s, page turn into HYPERSPACE at 442 km/s, page turn into the cream ESCAPE VELOCITY page at 521 km/s, ends on BLAZING! at 525 km/s. No stamp or card icon over a banner, no 'combo lost' | Top of the description (under the 3 MB limit) |
| `gameplay.mp4` | 720x1280, 30 fps, 6.3 s, 3.3 MB | Same clip as the GIF, full size and smooth | Social posts / the jam page. itch has no video upload, so link YouTube if you want video |
| `screenshots/01-speed.png` | 720x1280, 2.0 MB | Hero shot: 587 km/s, MACH 1711, flame crown, BLAZING! stamp, combo 8, PERFECT ring, long flame trail, on the kraft-brown LIGHTSPEED page | Screenshots (first) |
| `screenshots/02-tutorial.png` | 720x1280, 1.8 MB | First-run guided tutorial, HOLD step: dimmed page, spotlight on comet and planet, fingertip, big HOLD, "grab the planet!", gravity lines, supernova face at the bottom | Screenshots |
| `screenshots/03-about-to-be-eaten.png` | 720x1280, 1.3 MB | Death beat on the green WORMHOLE page: the supernova rises out of the fire, jaws wide around the sweating comet | Screenshots |
| `screenshots/04-cards.png` | 720x1280, 1.4 MB | Card pick on the maroon HYPERSONIC page: Aerodynamic (flight, +1 set slipstream scrap) / Gravity Well (orbit, +1 set orbit master scrap) / Chain Reaction (legendary fling), SUPERNOVA +5% FASTER, comet above the title, supernova face under the cards | Screenshots |
| `screenshots/05-pages.png` | 720x1280, 2.0 MB | Cream ESCAPE VELOCITY page: PERFECT! at 551 km/s, combo 12, comet climbing with a long crayon trail | Screenshots |
| `screenshots/06-gameover.png` | 720x1280, 1.2 MB | Notebook game over page: SUPERNOVA!, 159431 NEW BEST, top speed 592 km/s headline, LIGHTSPEED reached, build strip with 4 cards (Sharpshooter set circled), missions note with coins, 8 NEW CARDS note | Screenshots |
| `screenshots/07-menu.png` | 720x1280, 1.4 MB | Title page after a run: best score, missions note, 75 coins, SHOP and JOURNAL 8/12 with "new!" tags | Screenshots |
| `description.md` | ~2 KB | Page text (pitch, momentum hook, theme, how to play, features, controls incl. pause, AI tools credits) | Paste into Description |
| `README.md` | this file | Settings checklist | Not uploaded |

Suggested screenshot order: 01, 02, 03, 04, 05, 06, 07 (the numbering). Action first; the menu shows least.

Capture notes: frames were driven by `game.loop.step` (with `Date.now` following the step clock so tweens run at game speed), audio silenced with `AUDIO.setSilentTest(true)` (master gain 0, speaker icon shown on). An expert autopilot played (hold near a grabbable planet, let go on a gold aim). 02, 05, 06 and 07 come from one unforced first run (tutorial included, then autopilot to 15609 m). 01 is from the same run. 03 started from a `debugTeleport` to 17600 m, then the autopilot was switched off and the supernova caught the comet on its own. The GIF and MP4 are one autopilot run that started with a `debugTeleport` to 1200 m (card picks switched off for the clip). For 04 the three choices were forced, the camera was held so the comet sits above the title, the supernova was raised under the cards, and the dimmed speed note / multiplier badge were hidden so nothing ghosts under the cards. Old localStorage was cleared afterwards.

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
