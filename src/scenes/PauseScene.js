// Pause: launched by the HUD (its top-right '||' scrap, ESC / P, or automatically when the page
// is hidden / the window loses focus during play; see hudCanPause in HudScene.js). Runs on top
// of Game + Hud (+ Cards during a card pick): the page dims under ink hatching and a taped note
// offers RESUME, RESTART, MENU, SOUND on/off and FULLSCREEN (only where the Fullscreen API works
// and never on iOS). RESUME runs a short 3-2-1 ink countdown before play goes on.
//
// GameScene contract (every call guarded; a missing method falls back to Phaser's own scene
// controls, so the pause works even with an older GameScene):
//   pauseGame()   freeze the run: world, supernova, timers, tweens; duck the music
//   resumeGame()  unfreeze; a hold left from before the pause must not stick
//   restart()     a fresh run (like RETRY: no intro)
//   menu()        back to the menu
// Hud (and Cards, if it is up) are paused here as well and resumed with the run.

// Note + buttons, game px (720 x 1280). Every button is >= 100 px tall; all of it sits between
// y 200 and 1080, clear of phone notches and browser bars.
const PAUSE = {
  noteW: 540,
  noteTop: 222,
  notePadTop: 196,      // note top -> first button center (room for the title)
  notePadBottom: 92,    // last button center -> note bottom
  gap: 24,              // between buttons (outlines)
  main: { w: 420, h: 128, font: '60px' },
  side: { w: 420, h: 112, font: '50px' },
  small: { w: 228, h: 108, font: '38px', gap: 24 },
  titleDy: 80,          // note top -> PAUSED title center
  wash: 0.5,            // flat dark wash under the hatching
  hatch: 0.6,
  countWash: 0.3,       // wash level the countdown fades down to (the page shows again)
  countStepMs: 380,     // one countdown digit
  digits: [3, 2, 1],
};

// Pure helper (tested): may the pause note offer FULLSCREEN? env: { available (Phaser's
// device.fullscreen.available), enabled (document.fullscreenEnabled; undefined = unknown),
// userAgent, platform, maxTouchPoints }. Never on iPhone / iPad / iPod (iPadOS reports a Mac
// with touch points): Safari there has no element fullscreen for a game.
function pauseFullscreenSupported(env) {
  if (!env || !env.available || env.enabled === false) return false;
  const ua = String(env.userAgent || '');
  if (/iPhone|iPad|iPod/i.test(ua)) return false;
  if (env.platform === 'MacIntel' && (env.maxTouchPoints || 0) > 1) return false;
  return true;
}

// Pure helper (tested): layout of the note and its buttons. hasFullscreen: the SOUND and
// FULLSCREEN buttons share the last row; without it SOUND gets the row alone (centered).
// Returns { note: {x, y, w, h}, title: {x, y}, buttons: [{ id, x, y, w, h, font }] }.
function pauseLayout(hasFullscreen) {
  const P = PAUSE;
  const cx = GAME_WIDTH / 2;
  const buttons = [];
  let y = P.noteTop + P.notePadTop;
  buttons.push({ id: 'resume', x: cx, y, w: P.main.w, h: P.main.h, font: P.main.font });
  y += P.main.h / 2 + P.gap + P.side.h / 2;
  buttons.push({ id: 'restart', x: cx, y, w: P.side.w, h: P.side.h, font: P.side.font });
  y += P.side.h + P.gap;
  buttons.push({ id: 'menu', x: cx, y, w: P.side.w, h: P.side.h, font: P.side.font });
  y += P.side.h / 2 + P.gap + P.small.h / 2;
  if (hasFullscreen) {
    const dx = (P.small.w + P.small.gap) / 2;
    buttons.push({ id: 'sound', x: cx - dx, y, w: P.small.w, h: P.small.h, font: P.small.font });
    buttons.push({ id: 'fullscreen', x: cx + dx, y, w: P.small.w, h: P.small.h, font: P.small.font });
  } else {
    buttons.push({ id: 'sound', x: cx, y, w: P.small.w + 60, h: P.small.h, font: P.small.font });
  }
  const bottom = y + P.notePadBottom;
  const h = bottom - P.noteTop;
  return {
    note: { x: cx, y: P.noteTop + h / 2, w: P.noteW, h },
    title: { x: cx, y: P.noteTop + P.titleDy },
    buttons,
  };
}

// Pure helper (tested): countdown digit at ms since RESUME (3, 2, 1), 0 once it is over.
function pauseCountdownDigit(ms) {
  const P = PAUSE;
  if (!(ms >= 0)) return P.digits[0];
  const i = Math.floor(ms / P.countStepMs);
  return i < P.digits.length ? P.digits[i] : 0;
}

// Pure helper (tested): the SOUND button's label.
function pauseSoundLabel(muted) {
  return muted ? 'SOUND: OFF' : 'SOUND: ON';
}

class PauseScene extends Phaser.Scene {
  constructor() {
    super('Pause');
  }

  create(data) {
    this.reason = (data && data.reason) || 'button';
    this.counting = false;
    this.leaving = false;
    this.pausedScenes = [];
    this.freezeRun();

    // Swallows every tap that misses a button, so nothing reaches the run below.
    this.add.zone(0, 0, GAME_WIDTH, GAME_HEIGHT).setOrigin(0).setInteractive();
    this.buildWash();
    this.buildNote();

    const keys = this.input.keyboard;
    if (keys) {
      for (const k of ['SPACE', 'ENTER', 'ESC', 'P']) keys.on('keydown-' + k, () => this.resume());
    }
    // Hidden / blurred again mid-countdown: back to the note (never resume while nobody looks).
    const onAway = () => this.cancelCountdown();
    this.game.events.on('hidden', onAway);
    this.game.events.on('blur', onAway);
    this.events.once('shutdown', () => {
      this.game.events.off('hidden', onAway);
      this.game.events.off('blur', onAway);
    });
    this.game.events.emit('sfx', 'pageturn', { index: 0 });
  }

  // ---- the run below ----

  gameScene() {
    const g = this.scene.get('Game');
    return g && g.sys && g.sys.settings && g.sys.settings.status ? g : null;
  }

  // Calls the GameScene contract method, or runs fallback(game) when it is missing or throws.
  callGame(name, fallback) {
    const game = this.gameScene();
    if (game && typeof game[name] === 'function') {
      try {
        game[name]();
        return;
      } catch (e) {
        console.warn('Pause: Game.' + name + ' failed', e);
      }
    }
    if (fallback) fallback(game);
  }

  freezeRun() {
    this.callGame('pauseGame', (game) => {
      if (game && this.scene.isActive('Game')) this.scene.pause('Game');
    });
    for (const key of ['Hud', 'Cards']) {
      if (this.game.scene.keys[key] && this.scene.isActive(key)) {
        this.scene.pause(key);
        this.pausedScenes.push(key);
      }
    }
    this.scene.bringToTop();
  }

  unfreezeRun() {
    for (const key of this.pausedScenes) if (this.scene.isPaused(key)) this.scene.resume(key);
    this.pausedScenes = [];
    this.callGame('resumeGame', (game) => {
      if (game && this.scene.isPaused('Game')) this.scene.resume('Game');
    });
  }

  // ---- drawing ----

  // Dark wash with pencil hatching over the whole page, re-hatched on the boil clock.
  buildWash() {
    const P = PAUSE;
    if (typeof uiMakeStepTextures === 'function') uiMakeStepTextures(this);
    this.wash = this.add.renderTexture(0, 0, GAME_WIDTH, GAME_HEIGHT).setOrigin(0);
    const hasHatch = this.textures.exists('hud_step_hatch_0');
    this.hatch = hasHatch ? this.make.image({ x: 0, y: 0, key: 'hud_step_hatch_0', add: false }).setOrigin(0).setScale(2).setTint(0x07060d).setAlpha(P.hatch) : null;
    const draw = (v) => {
      if (!this.wash || !this.wash.active) return;
      this.wash.clear();
      this.wash.fill(0x07060d, P.wash);
      if (this.hatch) {
        this.hatch.setTexture('hud_step_hatch_' + v);
        this.wash.draw(this.hatch, 0, 0);
      }
    };
    draw(0);
    uiOnBoil(this, draw);
  }

  buildNote() {
    const L = pauseLayout(pauseFullscreenSupported(this.fullscreenEnv()));
    const N = L.note;
    const noteKey = uiNoteTexture(this, N.w, N.h, { rules: { top: 128, step: 58 }, margin: 44 });
    const paper = uiBoilImage(this, 0, 0, noteKey);
    // Same lettering as the game over headline: crayon fill with a thin ink edge. A dark fill under the
    // title helper's thick dark stroke closed the letters up into one blurry blob.
    const title = uiInkText(this, L.title.x - N.x, L.title.y - N.y, 'PAUSED', {
      size: 80, color: '#2f6fa8', stroke: '#16304f', strokeW: 4, rot: -0.04,
    });
    // A little pencil 'zz' by the title: the run is asleep, not over.
    const zz = uiInkText(this, L.title.x - N.x + 178, L.title.y - N.y - 34, 'z z', {
      size: 34, color: UI_INK.pencilDarkHex, stroke: null, rot: -0.3,
    });
    this.noteLayer = this.add.container(N.x, N.y, [paper, title, zz]).setRotation(-0.015);
    this.buttons = [];
    const make = (b, label, onClick, color) => {
      const btn = makeButton(this, b.x, b.y, label, onClick, { width: b.w, height: b.h, fontSize: b.font, color });
      btn.setRotation((this.buttons.length % 2 ? 1 : -1) * 0.018);
      this.buttons.push(btn);
      return btn;
    };
    for (const b of L.buttons) {
      if (b.id === 'resume') make(b, 'RESUME', () => this.resume(), UI_CRAYON.yellow);
      if (b.id === 'restart') make(b, 'RESTART', () => this.restartRun(), UI_CRAYON.orange);
      if (b.id === 'menu') make(b, 'MENU', () => this.toMenu(), UI_CRAYON.blue);
      if (b.id === 'sound') this.soundButton = make(b, pauseSoundLabel(this.isMuted()), () => this.toggleSound(), UI_CRAYON.green);
      if (b.id === 'fullscreen') this.fullButton = make(b, this.scale.isFullscreen ? 'WINDOW' : 'FULLSCREEN', () => this.toggleFullscreen(), UI_CRAYON.purple);
    }
    this.styleSound();
    // Note and buttons move as one sheet (makeButton kills its own tweens on press, so the
    // buttons are never tweened one by one). It drops in like a page slapped onto the desk.
    this.sheet = this.add.container(0, -40, [this.noteLayer, ...this.buttons]).setAlpha(0);
    this.tweens.add({ targets: this.sheet, y: 0, alpha: 1, duration: 170, ease: 'Back.Out' });
  }

  fullscreenEnv() {
    const d = typeof document !== 'undefined' ? document : {};
    const n = typeof navigator !== 'undefined' ? navigator : {};
    let enabled = d.fullscreenEnabled;
    if (enabled === undefined) enabled = d.webkitFullscreenEnabled;
    const fs = this.sys.game.device && this.sys.game.device.fullscreen;
    return { available: !!(fs && fs.available), enabled, userAgent: n.userAgent, platform: n.platform, maxTouchPoints: n.maxTouchPoints };
  }

  // ---- buttons ----

  isMuted() {
    return typeof AUDIO !== 'undefined' && AUDIO.isMuted ? !!AUDIO.isMuted() : false;
  }

  toggleSound() {
    if (typeof AUDIO !== 'undefined' && AUDIO.toggleMute) AUDIO.toggleMute();
    this.styleSound();
  }

  styleSound() {
    const btn = this.soundButton;
    if (!btn || !btn.list) return;
    const muted = this.isMuted();
    const label = btn.list[2];
    if (label && label.setText) label.setText(pauseSoundLabel(muted));
    if (btn.list[0] && btn.list[0].setTint) btn.list[0].setTint(muted ? UI_INK.pencil : UI_CRAYON.green);
  }

  toggleFullscreen() {
    try {
      if (this.scale.isFullscreen) this.scale.stopFullscreen(); else this.scale.startFullscreen();
    } catch (e) { /* the browser said no: the button just does nothing */ }
    // The state flips a moment later (async API).
    this.time.delayedCall(250, () => {
      const label = this.fullButton && this.fullButton.list && this.fullButton.list[2];
      if (label && label.active) label.setText(this.scale.isFullscreen ? 'WINDOW' : 'FULLSCREEN');
    });
  }

  restartRun() {
    if (this.leaving) return;
    this.leaving = true;
    this.unfreezeHelpersOnly();
    this.callGame('restart', (game) => {
      if (game) game.scene.start('Game', { skipIntro: true }); else this.game.scene.start('Game', { skipIntro: true });
    });
    this.scene.stop();
  }

  toMenu() {
    if (this.leaving) return;
    this.leaving = true;
    this.unfreezeHelpersOnly();
    this.callGame('menu', (game) => {
      if (game) game.scene.start('Menu'); else this.game.scene.start('Menu');
    });
    this.scene.stop();
  }

  // Leaving the run: Hud / Cards are stopped with the Game scene; resume them first so nothing
  // is left paused if the Game scene's own restart keeps them.
  unfreezeHelpersOnly() {
    for (const key of this.pausedScenes) if (this.scene.isPaused(key)) this.scene.resume(key);
    this.pausedScenes = [];
  }

  // ---- RESUME: 3-2-1 ink countdown, then play ----

  resume() {
    if (this.counting || this.leaving) return;
    this.counting = true;
    this.countStart = this.time.now;
    this.countShown = -1;
    this.tweens.killTweensOf(this.sheet);
    for (const b of this.buttons) b.disableInteractive();
    this.tweens.add({ targets: this.sheet, alpha: 0, y: 30, duration: 140, ease: 'Quad.In' });
    if (typeof uiCircleTexture === 'function') uiCircleTexture(this);
    this.countRing = this.textures.exists('ui_circle_0')
      ? uiBoilImage(this, GAME_WIDTH / 2, GAME_HEIGHT / 2 - 40, 'ui_circle').setTint(UI_CRAYON.yellow).setScale(1.25, 1.9).setAlpha(0)
      : null;
    this.countText = uiTitleText(this, GAME_WIDTH / 2, GAME_HEIGHT / 2 - 40, '3', { size: 230, color: UI_INK.creamHex, rot: -0.05 }).setAlpha(0);
  }

  // Back to the note (the page was hidden mid-countdown).
  cancelCountdown() {
    if (!this.counting || this.leaving) return;
    this.counting = false;
    if (this.countText) this.countText.destroy();
    if (this.countRing) this.countRing.destroy();
    this.countText = this.countRing = null;
    this.wash.setAlpha(1);
    this.tweens.killTweensOf(this.sheet);
    this.sheet.setAlpha(1).setY(0);
    for (const b of this.buttons) b.setInteractive({ useHandCursor: true });
  }

  update(time) {
    if (!this.counting || this.leaving) return;
    const ms = time - this.countStart;
    const digit = pauseCountdownDigit(ms);
    // The page shows through more and more as the count runs down.
    const k = Math.min(1, ms / (PAUSE.countStepMs * PAUSE.digits.length));
    this.wash.setAlpha(1 - (1 - PAUSE.countWash) * k);
    if (digit === 0) {
      this.leaving = true;
      this.unfreezeRun();
      this.scene.stop();
      return;
    }
    if (digit !== this.countShown) {
      this.countShown = digit;
      const t = this.countText;
      t.main.setText(String(digit));
      t.shadow.setText(String(digit));
      t.setScale(1.7).setAlpha(0);
      this.tweens.killTweensOf(t);
      // Stamped on hard, then a squash like a rubber stamp lifting.
      this.tweens.add({
        targets: t, scale: 1, alpha: 1, duration: 120, ease: 'Quad.In',
        onComplete: () => {
          t.setScale(1.08, 0.9);
          this.tweens.add({ targets: t, scaleX: 1, scaleY: 1, duration: 160, ease: 'Back.Out' });
        },
      });
      if (this.countRing) {
        this.countRing.setAlpha(0.9).setRotation((Math.random() - 0.5) * 0.6);
      }
      this.cameras.main.shake(70, 0.002);
      this.game.events.emit('sfx', 'click', {});
    }
  }
}
