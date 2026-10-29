// Title screen: a sketchbook page. Hand-lettered title, a doodled comet looping around a doodled
// planet (the core verb: orbit, then fling), the supernova peeking from the bottom edge.
// Everything static is a pre-rendered boil texture (see utils.js); only the comet's dashed
// trail is drawn per frame.
class MenuScene extends Phaser.Scene {
  constructor() {
    super('Menu');
  }

  create() {
    const cx = GAME_WIDTH / 2;
    uiAddPaper(this, 0);
    uiMakeDoodles(this);
    uiScatterStars(this, [[80, 330], [655, 250], [610, 720], [70, 600], [655, 990], [110, 960], [250, 520]]);

    // Supernova peeking in at the bottom, behind everything else.
    this.nova = uiBoilImage(this, cx, GAME_HEIGHT - 62, 'ui_nova').setScale(0.8);
    this.tweens.add({ targets: this.nova, y: GAME_HEIGHT - 74, yoyo: true, repeat: -1, duration: 1300, ease: 'Sine.easeInOut' });

    this.hero = { x: cx, y: 650 };
    uiBoilImage(this, 605, 500, 'ui_planet_green');
    uiBoilImage(this, 100, 790, 'ui_planet_orange');
    uiBoilImage(this, this.hero.x, this.hero.y, 'ui_planet_ring');

    this.trailGfx = this.add.graphics();
    this.comet = uiBoilImage(this, cx, 520, 'ui_comet').setScale(0.8);
    this.trail = [];
    this.orbitAngle = -Math.PI / 2;

    this.titleLetters = [
      ...uiTitleWord(this, 'ESCAPE', 200, 96, UI_INK.creamHex, uiColorHex(UI_CRAYON.orange), 0),
      ...uiTitleWord(this, 'VELOCITY', 310, 92, uiColorHex(UI_CRAYON.yellow), uiColorHex(UI_CRAYON.red), 6),
    ];
    const underline = uiBoilImage(this, cx + 10, 372, 'ui_underline').setTint(UI_CRAYON.orange).setRotation(-0.02);
    underline.setScale(0, 1);
    this.tweens.add({ targets: underline, scaleX: 1, duration: 380, delay: 700, ease: 'Quad.Out' });
    uiInkText(this, cx + 30, 430, 'speed is your life', { size: 36, color: uiColorHex(UI_CRAYON.pink), rot: -0.04 });

    // Fresh data object so a previous scene.start's data (e.g. skipIntro from RETRY) never leaks in.
    const startGame = () => this.scene.start('Game', {});
    const play = makeButton(this, cx, 900, 'PLAY', startGame, {
      width: 440, height: 130, fontSize: '68px', color: UI_CRAYON.yellow,
    });
    play.setRotation(-0.025);
    // A little nudge every couple of seconds instead of a constant pulse (press squash stays clean).
    this.time.addEvent({
      delay: 2200, loop: true,
      callback: () => {
        if (!play.active || play.scaleY !== 1) return;
        this.tweens.add({ targets: play, angle: { from: -1.4, to: 1.4 }, yoyo: true, repeat: 1, duration: 90, onComplete: () => play.setAngle(-1.4) });
      },
    });

    const best = loadHighScore();
    if (best > 0) {
      uiInkText(this, cx - 6, 1000, 'best: ' + best, { size: 38, color: UI_INK.pencilHex, stroke: null, rot: 0.03 });
    }
    // Kept ~140 px above the bottom edge: browser bars / home indicators cover the last few px on phones.
    uiInkText(this, cx, 1068, 'hold near a planet to orbit,\nlet go to fling. outrun the supernova!', {
      size: 28, rot: -0.015, strokeW: 5, lineSpacing: 4,
    }).setDepth(5);

    makeMuteButton(this, 92, 116);
    addFullscreenButton(this);
    this.input.keyboard.on('keydown-SPACE', startGame);
  }

  update(time, delta) {
    const t = time / 1000;
    for (const letter of this.titleLetters) letter.y = letter.baseY + Math.sin(t * 2.6 - letter.index * 0.5) * 4;

    // Comet loops the planet on a squashed orbit; the dashed trail is the only per-frame drawing.
    this.orbitAngle += (delta / 1000) * 2.1;
    const orbitR = 178;
    const x = this.hero.x + Math.cos(this.orbitAngle) * orbitR;
    const y = this.hero.y + Math.sin(this.orbitAngle) * orbitR * 0.86;
    this.comet.setPosition(x, y).setRotation(this.orbitAngle + Math.PI / 2);
    this.trail.unshift({ x, y });
    if (this.trail.length > 26) this.trail.length = 26;
    uiDrawDashTrail(this.trailGfx, this.trail, Math.floor(time / UI_BOIL_MS));
  }
}

// ---- doodles shared by Menu / GameOver / Boot ----

// Dashed speed marks behind a moving doodle: every other trail segment, thinning out.
function uiDrawDashTrail(g, trail, seed) {
  g.clear();
  for (let i = 3; i < trail.length - 1; i += 3) {
    const a = trail[i];
    const b = trail[i + 1];
    const k = 1 - i / trail.length;
    uiScribbleLine(g, a.x, a.y, b.x, b.y, seed + i, { width: 6 * k + 1.5, amp: 1, passes: 1, color: UI_CRAYON.orange, alpha: 0.9 * k + 0.1 });
  }
}

function uiScatterStars(scene, spots) {
  uiStarTexture(scene);
  const tints = [UI_INK.cream, UI_CRAYON.yellow, UI_INK.cream, UI_CRAYON.blue];
  spots.forEach(([x, y], i) => {
    uiBoilImage(scene, x, y, 'ui_star').setTint(tints[i % tints.length]).setScale(0.6 + (i % 3) * 0.25).setRotation(i * 0.7).setAlpha(0.85);
  });
}

// Title letters: each a slightly tilted, off-baseline crayon-shadowed letter.
function uiTitleWord(scene, word, y, size, color, shadowColor, indexOffset) {
  const letters = [];
  const rng = uiRng(uiHash(word));
  for (let i = 0; i < word.length; i++) {
    const letter = uiTitleText(scene, 0, y, word[i], {
      size, color, shadowColor, rot: (rng() - 0.5) * 0.16, shadowDx: 5, shadowDy: 7,
    });
    letters.push(letter);
  }
  const widths = letters.map((l) => l.main.width - 12);   // strokes may touch, like real lettering
  let x = GAME_WIDTH / 2 - widths.reduce((a, b) => a + b, 0) / 2;
  letters.forEach((letter, i) => {
    letter.x = x + widths[i] / 2;
    x += widths[i];
    letter.baseY = y + (rng() - 0.5) * 10;
    letter.y = letter.baseY;
    letter.index = i + indexOffset;
    letter.setScale(0);
    scene.tweens.add({ targets: letter, scale: 1, duration: 300, delay: 55 * letter.index, ease: 'Back.easeOut' });
  });
  return letters;
}

// Builds every Menu/GameOver doodle texture once (cheap to call again: existing keys are skipped).
function uiMakeDoodles(scene) {
  uiCometTexture(scene);
  uiNovaTexture(scene);
  uiPlanetTexture(scene, 'ui_planet_ring', 88, UI_CRAYON.purple, 'ring');
  uiPlanetTexture(scene, 'ui_planet_green', 40, UI_CRAYON.green, 'mountains');
  uiPlanetTexture(scene, 'ui_planet_orange', 50, UI_CRAYON.orange, 'craters');
  uiStarTexture(scene);
  uiCircleTexture(scene);
  uiUnderlineTexture(scene);
}

// The hero comet as a doodle (faces +x): crayon flame tail, yellow head, ink face.
function uiCometTexture(scene) {
  return uiSketchTexture(scene, 'ui_comet', 210, 130, (ctx, shape, jitter) => {
    const j = (p, a) => ({ x: p.x + (shape() - 0.5) * a + (jitter() - 0.5) * 2, y: p.y + (shape() - 0.5) * a + (jitter() - 0.5) * 2 });
    const tail = [
      { x: 150, y: 34 }, { x: 108, y: 38 }, { x: 70, y: 48 }, { x: 34, y: 44 }, { x: 52, y: 58 }, { x: 10, y: 66 },
      { x: 54, y: 74 }, { x: 34, y: 88 }, { x: 72, y: 84 }, { x: 108, y: 92 }, { x: 150, y: 96 },
    ].map((p) => j(p, 5));
    uiHatch(ctx, tail, jitter, { color: UI_CRAYON.red, spacing: 5, width: 4, angle: -0.3 });
    const inner = tail.map((p) => ({ x: 150 + (p.x - 150) * 0.62, y: 65 + (p.y - 65) * 0.55 }));
    uiHatch(ctx, inner, jitter, { color: UI_CRAYON.orange, spacing: 4, width: 4, angle: -0.5 });
    uiStroke(ctx, tail, jitter, { width: 3, retrace: false });
    const head = uiLoop(150, 65, 33, 31, shape, jitter, { lop: 0.07, amp: 1.2 });
    uiHatch(ctx, head, jitter, { color: UI_CRAYON.yellow, spacing: 4, width: 5, gaps: 0.03 });
    uiStroke(ctx, head, jitter, { width: 5, closed: true });
    // Face: determined eyes looking ahead + a grin.
    for (const ex of [150, 168]) {
      const eye = uiLoop(ex, 58, 4.5, 6, shape, jitter, { n: 8, amp: 0.5 });
      uiTracePath(ctx, eye, true);
      ctx.fillStyle = uiCss(UI_INK.dark);
      ctx.fill();
      uiStroke(ctx, [{ x: ex - 7, y: 46 + (ex > 155 ? -1 : 2) }, { x: ex + 6, y: 47 + (ex > 155 ? 2 : -1) }], jitter, { width: 3, color: UI_INK.dark, retrace: false });
    }
    uiStroke(ctx, [{ x: 146, y: 74 }, { x: 158, y: 82 }, { x: 172, y: 73 }], jitter, { width: 3.5, color: UI_INK.dark, retrace: false });
  });
}

// The villain: a crayon supernova bulging up from the bottom with an angry ink face.
function uiNovaTexture(scene) {
  return uiSketchTexture(scene, 'ui_nova', 760, 300, (ctx, shape, jitter) => {
    const edge = [];
    const n = 34;
    for (let i = 0; i <= n; i++) {
      const a = Math.PI + (i / n) * Math.PI;
      const flame = i % 2 ? 1 : 1.07 + shape() * 0.05;
      edge.push({ x: 380 + Math.cos(a) * 400 * flame + (jitter() - 0.5) * 4, y: 320 + Math.sin(a) * 250 * flame + (jitter() - 0.5) * 4 });
    }
    const body = edge.concat([{ x: 780, y: 320 }, { x: -20, y: 320 }]);
    const scaled = (k) => edge.map((p) => ({ x: 380 + (p.x - 380) * k, y: 320 + (p.y - 320) * k })).concat([{ x: 380 + 400 * k, y: 320 }, { x: 380 - 400 * k, y: 320 }]);
    uiHatch(ctx, body, jitter, { color: UI_CRAYON.red, spacing: 5, width: 5, gaps: 0.04 });
    uiHatch(ctx, scaled(0.78), jitter, { color: UI_CRAYON.orange, spacing: 5, width: 5, angle: -0.6 });
    uiHatch(ctx, scaled(0.5), jitter, { color: UI_CRAYON.yellow, spacing: 5, width: 4, angle: -1.1 });
    uiGrain(ctx, 760, 300, jitter, 0.01);
    uiStroke(ctx, edge, jitter, { width: 5, color: UI_INK.cream });
    // Angry face near the top so it shows even when only the cap peeks in.
    for (const sx of [-1, 1]) {
      const ex = 380 + sx * 78;
      uiStroke(ctx, [{ x: ex - sx * 42, y: 122 }, { x: ex, y: 132 }, { x: ex + sx * 30, y: 150 }], jitter, { width: 9, color: UI_INK.dark, retrace: false });
      const eye = uiLoop(ex, 166, 20, 16, shape, jitter, { n: 12, amp: 0.8 });
      uiTracePath(ctx, eye, true);
      ctx.fillStyle = uiCss(UI_INK.cream);
      ctx.fill();
      uiStroke(ctx, eye, jitter, { width: 4, color: UI_INK.dark, closed: true, retrace: false });
      const pupil = uiLoop(ex - sx * 5, 170, 8, 9, shape, jitter, { n: 8, amp: 0.4 });
      uiTracePath(ctx, pupil, true);
      ctx.fillStyle = uiCss(UI_INK.dark);
      ctx.fill();
    }
    // Jagged grin.
    const mouth = [];
    for (let i = 0; i <= 10; i++) mouth.push({ x: 300 + i * 16, y: 214 + (i % 2 ? 12 : 0) + Math.sin(i / 10 * Math.PI) * 14 + (jitter() - 0.5) * 2 });
    uiStroke(ctx, mouth, jitter, { width: 6, color: UI_INK.dark, retrace: false });
  });
}

// A planet as a little world: lopsided body, crayon fill, cool light from above, warm rim
// from the supernova below, and one feature (ring / mountains + moon / craters + flag).
function uiPlanetTexture(scene, key, r, color, feature) {
  const S = r * 2 + 130;
  const c = S / 2;
  return uiSketchTexture(scene, key, S, S, (ctx, shape, jitter) => {
    const body = feature === 'mountains'
      ? uiMountainLoop(c, c, r, shape, jitter)
      : uiLoop(c, c, r, r * 0.96, shape, jitter, { lop: 0.05, amp: 1.2, n: 26 });
    const ringPts = (front) => {
      const pts = [];
      for (let i = 0; i <= 12; i++) {
        const a = front ? (i / 12) * Math.PI : Math.PI + (i / 12) * Math.PI;
        pts.push({ x: c + Math.cos(a) * r * 1.6 + (jitter() - 0.5) * 2, y: c + 6 + Math.sin(a) * r * 0.36 + Math.cos(a) * -r * 0.18 + (jitter() - 0.5) * 2 });
      }
      return pts;
    };
    if (feature === 'ring') uiStroke(ctx, ringPts(false), jitter, { width: 4, color: UI_CRAYON.yellow, retrace: false });
    uiHatch(ctx, body, jitter, { color, spacing: 5, width: 4.5 });
    ctx.save();
    uiTracePath(ctx, body, true);
    ctx.clip();
    uiHatch(ctx, [{ x: 0, y: 0 }, { x: S, y: 0 }, { x: S, y: c - r * 0.55 }, { x: 0, y: c - r * 0.75 }], jitter,
      { color: 0xdcecff, spacing: 6, width: 3, alpha: 0.55, angle: -0.3, grow: 1, offX: 0, offY: 0 });
    uiHatch(ctx, [{ x: 0, y: c + r * 0.62 }, { x: S, y: c + r * 0.5 }, { x: S, y: S }, { x: 0, y: S }], jitter,
      { color: UI_CRAYON.orange, spacing: 5, width: 4, alpha: 0.85, angle: 0.5, grow: 1, offX: 0, offY: 0 });
    ctx.restore();
    uiGrain(ctx, S, S, jitter, 0.008);
    uiStroke(ctx, body, jitter, { width: 5, closed: true });
    if (feature === 'ring') {
      uiStroke(ctx, ringPts(true), jitter, { width: 5, color: UI_CRAYON.yellow, retrace: false });
      uiStroke(ctx, ringPts(true).map((p) => ({ x: p.x * 0.97 + c * 0.03, y: p.y - 5 })), jitter, { width: 2.5, color: UI_INK.cream, retrace: false });
    }
    if (feature === 'craters' || feature === 'ring') {
      const spots = feature === 'ring' ? [[-0.35, -0.3, 0.16], [0.4, 0.05, 0.11]] : [[-0.3, -0.25, 0.2], [0.35, 0.2, 0.15], [-0.15, 0.4, 0.1]];
      for (const [dx, dy, cr] of spots) {
        const crater = uiLoop(c + dx * r, c + dy * r, cr * r * 1.15, cr * r, shape, jitter, { n: 10, amp: 0.7, lop: 0.1 });
        uiStroke(ctx, crater, jitter, { width: 3, color: UI_INK.dark, alpha: 0.75, closed: true, retrace: false });
      }
    }
    if (feature === 'craters') {
      // A tiny flag planted on top: someone got here first.
      const top = { x: c + r * 0.2, y: c - r * 0.97 };
      uiStroke(ctx, [top, { x: top.x + 2, y: top.y - 34 }], jitter, { width: 3, retrace: false });
      const flag = [{ x: top.x + 2, y: top.y - 34 }, { x: top.x + 26, y: top.y - 28 }, { x: top.x + 3, y: top.y - 20 }];
      uiHatch(ctx, flag, jitter, { color: UI_CRAYON.red, spacing: 3, width: 3, grow: 1.1 });
      uiStroke(ctx, flag, jitter, { width: 2.5, closed: true, retrace: false });
    }
    if (feature === 'mountains') {
      const moon = uiLoop(c + r * 1.45, c - r * 0.95, r * 0.28, r * 0.26, shape, jitter, { n: 12, amp: 0.8 });
      uiHatch(ctx, moon, jitter, { color: UI_INK.pencil, spacing: 4, width: 3 });
      uiStroke(ctx, moon, jitter, { width: 3.5, closed: true, retrace: false });
    }
  });
}

// Round body whose top edge has a few mountain peaks.
function uiMountainLoop(cx, cy, r, shape, jitter) {
  const pts = [];
  const n = 30;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * UI_TAU;
    let k = 1 + 0.04 * Math.sin(a * 2 + 1.3);
    const up = -Math.sin(a);             // 1 at the top
    if (up > 0.45 && i % 2 === 0) k += 0.22 * up * (0.7 + shape() * 0.6);
    pts.push({ x: cx + Math.cos(a) * r * k + (jitter() - 0.5) * 2, y: cy + Math.sin(a) * r * k + (jitter() - 0.5) * 2 });
  }
  return pts;
}
