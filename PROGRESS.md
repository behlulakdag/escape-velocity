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
- [ ] Feel tuning on a real phone
- [ ] Polish: ring in front of planet, stronger aim guide, speed lines, sound, music
- [ ] Hazards later (asteroids), near-miss / perfect fling bonus
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
