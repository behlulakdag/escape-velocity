# Progress

## Jam facts (researched 2026-10-28)
- Start + theme reveal: Oct 29 15:00 UTC = 18:00 Turkey (itch page + Discord)
- Deadline: Oct 31 15:00 UTC = 18:00 Turkey. No updates after, not even bug fixes.
- Judged by hosts only on Fun / Visual Appeal / Theme Following (equal average). Results Nov 7.
- Prizes: $500 / $200 / $100 x3
- Submit: HTML5 playable on itch, private prize-contact email, list AI tools on the page.
- Jam #1 winner had the top Fun score but the lowest Theme score -> Fun matters most.

## Done
- itch draft page works: https://behlulakdag.itch.io/slapjam-test-build (HTML, played in browser, mobile friendly, portrait, fullscreen button, 405x720 embed). itch email verified.
- Fixed build.ps1: Compress-Archive wrote backslash paths (src\main.js) into the zip, so every script 404'd on itch. Now writes "/" paths.
- butler v15.32.0 installed at %USERPROFILE%\tools\butler and logged in. deploy.ps1 builds + pushes to the html5 channel (verified working on the test page). For the real game: create its itch page, pass -Target user/game, tick "played in browser" once.
- RESEARCH.md: Slapjam #1 winners, lessons, mechanic templates
- Template: portrait 720x1280, FIT scaling, touch input, Menu/Game/GameOver scenes, high score, fullscreen button
- Example dodge game in GameScene (to be replaced)

## Jam game: ESCAPE VELOCITY (theme: Speed)
- [x] Prototype: hold near planet = orbit + gain speed, release = fling. Speed decays in flight; too slow / crash / fall off screen = game over. Score = altitude (m).
- [x] Pure orbit math in src/orbit.js, tests: `node --test tests/orbit.test.js` (7 pass)
- [x] Bot playtest: survived 25s, 1911 m with ASAP releases (speed stays ~700). Extra loops double speed -> risk/reward works.
- [x] Easier: aim assist (green line), mistakes cost speed instead of killing, hits never drop below minSpeed+120
- [x] Zigzag planets with 4 sizes and wider gaps; orbit spin cap; camera zooms out with speed (HUD in HudScene)
- [x] Zones (LIFTOFF..ESCAPE VELOCITY), score x1-x5 by speed, gold PERFECT window
- [x] Asteroids (600 m+, any direction, curving) and non-solid black holes (1800 m+, bend path, core warps ~60deg)
- [x] build.ps1 cache-busts scripts (?v=build) so phones load new code after each update
- [x] Headless sim (tests/playtest-bot.js), 10 runs each: random 5-32s, careful 20-74s, skilled 23-102s (highest score)
- [x] Round 3: stable orbits (no crash), smaller grab zone, close-orbit speed bonus; SUPERNOVA wave is the only way to lose (130->160 px/s +5/s, max 250px below screen); minSpeed 140; smooth homing release (96.7% hit) and eased latch
- [x] Sim (8 runs each): idle 10-17s, random 2-7s, careful 26-105s, skilled 33-104s (highest score)
- [x] Agent round (feel/audio/art in parallel + 2 reviewers, then 3 fixers + QA 20/20): hitstop, PERFECT chain, close call slow-mo, best-altitude flag, speed lines, look-ahead camera, squash/stretch, star-explosion intro (RETRY skips it), procedural audio + reactive music + mute, characters with faces (comet, planets, angry supernova), themed menu/game over, screen-space pops, gentle flashes
- [x] Player critic scores: Fun 3.5, Visual 4, Theme 4.5
- [ ] Critic top fixes: teach re-grab + auto-catch first flings; forgiving catch at speed; cut text clutter; lower full-screen flashes/intro white-out; keep speed escalating past 240 km/s (zone names match); keep comet out of bottom HUD; only grab planets at/above the comet
- [x] Bundled Lilita One font; onboarding auto catch only until the player catches once (localStorage flag)
- [x] Art direction: current look is final (sketchbook and glossy UI-kit restyles were tried and rejected; stashed)
- [x] Roguelite upgrade cards (src/cards.js, CardScene): 12 cards / 4 families / set bonuses, pick 1 of 3 at every zone from 500 m, 6% slow-mo while picking, +5% supernova speed per card. Critic: Fun 4 (was 3.5), Visual 4, Theme 4.5
- [ ] Card polish from critic: pick 1.2s after zone banner, pop lane (no pile-up over comet), visible tells for passive cards (Aerodynamic, Overdrive, Tail Armor), legendaries that change behaviour, game over build shown at once, shield cards more reachable, Shockwave line visible, balance per-card nova cost
- [ ] Listen to audio on a real phone (never heard yet)
- [ ] itch page: GIF of PERFECT chain, controls line, menu cover
- [ ] Design pass (art), then sound/music (user wants these last)
- [ ] Real itch page "Escape Velocity" (currently deploying to the test page)

## Next
- [x] Theme revealed -> fill the Theme section in CLAUDE.md
- [x] Decide core mechanic
- [x] Replace GameScene with the jam game
- [ ] Art (one model + one style prompt)
- [ ] Music (Suno) + SFX (ElevenLabs)
- [ ] Upload a build to itch.io on day one
- [ ] Final test on a real phone
- [ ] Submit to the jam page (with the private prize-contact email)
