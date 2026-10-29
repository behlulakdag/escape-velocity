# Slapjam #2 Jam Game

48-hour game jam entry. Mobile-portrait browser game, built with Phaser 3, shipped on itch.io.

## Hard constraints (never break these)
- Resolution: 720x1280 portrait. Never change GAME_WIDTH / GAME_HEIGHT in src/config.js.
- Must be fully playable with touch only. Keyboard/mouse controls are optional extras, never required.
- Must run in a mobile browser inside the itch.io iframe. No server, no build step, no npm packages at runtime.
- Phaser 3.90 is loaded from lib/phaser.min.js. Do not switch to a CDN or Phaser 4.
- Plain classic scripts (no ES modules, no bundler) so index.html also works when opened directly.
- Every new script file must be added to index.html in the correct order (config/utils, then scenes, main.js last).
- Every scene must be registered in the `scene` array in src/main.js.
- Wrap all localStorage access in try/catch (see utils.js).
- Assets go in assets/ and are loaded in BootScene.preload(). Keep total size small (target under 15 MB) so phones load it fast.
- UI text in the game is in English.

## Design rules
- ONE core mechanic. A single verb that feels great beats many that feel fine.
- Touch targets at least 100px tall. Keep important UI away from the very top/bottom edges (phone notches, browser bars).
- Add "juice" to every important event: screen shake, flash, tweens, particles, sound.
- Difficulty ramps over time. A run should last 30 seconds to 3 minutes.
- Instant restart from the game over screen.

## Structure
- src/config.js: constants (size, colors, font, storage key)
- src/utils.js: makeButton, loadHighScore/saveHighScore, addFullscreenButton
- src/scenes/BootScene.js: asset loading + progress bar
- src/scenes/MenuScene.js: title + play button
- src/scenes/GameScene.js: the actual game (replace the example dodge game with the jam game)
- src/scenes/GameOverScene.js: score, best score, retry

## Workflow
- After every change, the game must still load without console errors.
- Prefer small, testable steps. Keep PROGRESS.md updated with what is done and what is next.
- Before the deadline: run build.ps1 (Windows) or build.sh to create the zip for itch.io.

## Theme
(Fill in when the theme is revealed on Oct 29, 18:00 Turkey time.)
Theme: Speed
Game: ESCAPE VELOCITY. You are a burning comet; speed is your life, score and visuals.
Core mechanic: hold near a planet to lock into orbit and gain speed (gravity assist), release to fling along the tangent. Speed decays in flight; below the minimum the comet freezes (game over). Orbits slowly tighten, so orbiting too long crashes you.
Art style prompt (reuse for every asset): bright cartoon space, thick dark outlines, saturated purple/blue sky, colorful planets with craters and rings, never too dark.
