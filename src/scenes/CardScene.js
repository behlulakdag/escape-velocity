// Upgrade pick overlay, launched by GameScene on zone entry:
//   this.scene.launch('Cards', { choices: [ids], owned: [ids], timeout: 6 })
// Shows up to 3 cards over the slowed game; a tap (or the auto-pick of the middle card when the
// countdown runs out) plays the exit. Taps count only once every card has landed (+ armDelay), and
// the countdown starts then too (see the pure pick rules below), then emits game.events 'cards:picked' (id) once and stops.
// The exit runs BEFORE the emit because GameScene stops this scene as soon as it hears the pick.
// Card data comes from src/cards.js (CARDS, CARD_FAMILIES, SET_BONUSES, activeSetBonuses).
//
// Sketchbook look: each card is a taped index card dealt onto the page. Family = crayon patch
// behind the ink icon; rarity = common plain outline, rare double ink outline, legendary gold
// crayon border with doodled stars. Everything static is baked into boil-variant textures
// (src/utils.js uiSketchTexture); only the pencil countdown ring is redrawn, on the boil clock.

const CARD_UI = {
  width: 214,
  height: 380,
  pad: 24,              // texture margin around the card for shadow / border strokes
  spacing: 210,
  // The dealt row is drawn at this scale so three cards plus their "+1 SET" scraps keep a
  // >= 16 css px gutter on 360-375 px wide phones (FIT scaling of 720 wide).
  rowScale: 0.88,
  centerY: 850,
  headerY: 548,
  hitSlop: 18,          // px of forgiveness round a card for a tap
  autoWarn: 2,          // seconds left when the middle card starts nudging
  armDelay: 0.35,       // s after the last card lands before a press may pick
  // The countdown only starts once armed, so it is shorter than GameScene's timeout by this much:
  // GameScene's safety net auto-picks at timeout + 1.5 s after opening, and deal-in + arm + the
  // tap grace + the exit animation must all fit inside that.
  countdownTrim: 1,
  tapGrace: 0.6,        // s the auto-pick waits for a finger that is already down on the page
};

// ---- pure pick rules (unit tested in tests/cards-ui.test.js) ----

// Seconds left on the countdown. It does not run until the cards are armed (armAt = null).
function cardCountdownLeft(elapsed, armAt, seconds) {
  if (armAt === null || armAt === undefined) return seconds;
  return Math.max(0, seconds - Math.max(0, elapsed - armAt));
}

// A press counts only if it went down after the cards were armed: a finger already on the
// glass from gameplay, or a press landing on cards still being dealt, never picks.
function cardPressCounts(downAt, armAt) {
  return armAt !== null && armAt !== undefined && downAt >= armAt;
}

// Card picked by a release: the pressed card, only if the finger is still on that same card.
function cardReleasePick(pressedIndex, upIndex) {
  return pressedIndex >= 0 && upIndex === pressedIndex ? pressedIndex : -1;
}

// Time up: auto-pick now, unless a counted finger is still down (it gets `grace` s to lift,
// so the auto-pick never steals a tap in progress). timeUpAt = elapsed when left first hit 0.
function cardAutoPickDue(left, fingerDown, elapsed, timeUpAt, grace) {
  if (left > 0) return false;
  if (!fingerDown) return true;
  return elapsed - timeUpAt >= grace;
}

// Card center x that keeps a card scaled by `scale` (plus its border marks) inside the screen.
function cardSafeX(x, scale) {
  const half = (CARD_UI.width / 2 + 16) * scale * CARD_UI.rowScale + 34;
  return Phaser.Math.Clamp(x, half, GAME_WIDTH - half);
}

// Card face lettering, in card px (the row is drawn at CARD_UI.rowScale, so game px = size *
// 0.88). The card spans y = -190..190; the '+1 set' scrap paper starts at about y = 166.
const CARD_TEXT = {
  tagSize: 27,          // family / rarity words (~24 game px)
  tagGap: 10,           // min px between the two words
  nameSize: 32,
  nameTop: 10,
  nameMaxH: 70,         // two lines of name
  nameMinOneLine: 0.74, // narrowest squeeze a one-line name may take before it wraps instead
  sideMargin: 12,
  descSize: 30,         // ~26 game px before any shrink-to-fit
  descLineSpacing: -3,  // Lilita has short descenders: tighter lines buy a third line
  descGap: 5,
  descBottom: 178,      // lowest ink of the description on a plain card
  descBottomScrap: 148, // ... and above the tape strip of the "+1 set" scrap (its tip reaches y ~ 144 at x ~ -58)
};

// Uniform scale that fits a w x h block inside maxW x maxH, never enlarging it.
function cardFitScale(w, h, maxW, maxH) {
  if (!(w > 0) || !(h > 0)) return 1;
  return Math.min(1, maxW / w, maxH / h);
}

// Exit animation length (ms) before the pick is reported to the game.
const EXIT_MS = 360;

const CARD_RARITY_WORD = {
  common: { text: 'common', color: UI_INK.pencilDarkHex },
  rare: { text: 'rare', color: UI_INK.darkHex },
  legendary: { text: 'legendary!', color: '#9a6a00' },
};

// ---- baked card textures (white/cream; family color comes from tinting the patch) ----

function cardPaperTexture(scene) {
  const { width: w, height: h, pad } = CARD_UI;
  return uiSketchTexture(scene, 'cd_paper', w + pad * 2, h + pad * 2, (ctx, shape, jitter) => {
    const pts = uiWobblyRect(pad, pad, w, h, shape, jitter, 1);
    uiTracePath(ctx, pts.map((p) => ({ x: p.x + 7, y: p.y + 11 })), true);
    ctx.fillStyle = 'rgba(5,6,16,0.45)';
    ctx.fill();
    uiTracePath(ctx, pts, true);
    ctx.fillStyle = uiCss(UI_CRAYON.note);
    ctx.fill();
    ctx.save();
    uiTracePath(ctx, pts, true);
    ctx.clip();
    // Index card: red header rule and blue lines under the text area.
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(214,70,70,0.45)';
    ctx.beginPath();
    ctx.moveTo(pad, pad + h * 0.56 + (shape() - 0.5) * 2);
    ctx.lineTo(pad + w, pad + h * 0.56 + (shape() - 0.5) * 3);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(90,135,200,0.32)';
    for (let k = 1; k <= 4; k++) {
      const y = pad + h * 0.56 + k * 34;
      ctx.beginPath();
      ctx.moveTo(pad, y + (shape() - 0.5) * 2);
      ctx.lineTo(pad + w, y + (shape() - 0.5) * 2);
      ctx.stroke();
    }
    for (let i = 0; i < 70; i++) {
      const x = pad + shape() * w;
      const y = pad + shape() * h;
      const a = shape() * UI_TAU;
      ctx.strokeStyle = 'rgba(120,95,50,0.1)';
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + Math.cos(a) * 14, y + Math.sin(a) * 14);
      ctx.stroke();
    }
    ctx.restore();
    uiStroke(ctx, pts, jitter, { width: 3, color: UI_INK.dark, closed: true, overshoot: 2, retrace: false });
    // Tape across the top edge.
    ctx.save();
    ctx.translate(pad + w / 2 + (shape() - 0.5) * 20, pad + 2);
    ctx.rotate(-0.06 + (shape() - 0.5) * 0.1);
    const tape = [];
    for (let i = 0; i <= 3; i++) tape.push({ x: 40 + (i % 2 ? 5 : 0), y: -12 + i * 8 });
    for (let i = 3; i >= 0; i--) tape.push({ x: -40 - (i % 2 ? 4 : 0), y: -12 + i * 8 });
    uiTracePath(ctx, tape, true);
    ctx.fillStyle = 'rgba(240,232,190,0.62)';
    ctx.fill();
    ctx.restore();
  });
}

// White crayon patch behind the icon (tinted with the family crayon).
function cardPatchTexture(scene) {
  return uiSketchTexture(scene, 'cd_patch', 200, 176, (ctx, shape, jitter) => {
    const pts = uiLoop(100, 88, 80, 68, shape, jitter, { n: 20, amp: 1.2, lop: 0.09 });
    uiHatch(ctx, pts, jitter, { color: 0xffffff, spacing: 5, width: 4.5, alpha: 0.9, angle: -0.95, offX: 5, offY: -3, gaps: 0.08 });
    uiHatch(ctx, pts, jitter, { color: 0xffffff, spacing: 9, width: 3, alpha: 0.5, angle: -0.4, offX: 2, offY: 3, grow: 1, gaps: 0.2 });
    uiGrain(ctx, 200, 176, jitter, 0.02);
  });
}

// Rare: a second, looser ink outline just outside the first.
function cardRareTexture(scene) {
  const { width: w, height: h, pad } = CARD_UI;
  return uiSketchTexture(scene, 'cd_rare', w + pad * 2, h + pad * 2, (ctx, shape, jitter) => {
    const pts = uiWobblyRect(pad - 9, pad - 9, w + 18, h + 18, shape, jitter, 1.6);
    uiStroke(ctx, pts, jitter, { width: 4.5, color: UI_INK.cream, closed: true, overshoot: 3, retrace: true });
    const inner = uiWobblyRect(pad + 7, pad + 7, w - 14, h - 14, shape, jitter, 1.2);
    uiStroke(ctx, inner, jitter, { width: 2, color: UI_INK.dark, alpha: 0.75, closed: true, overshoot: 2, retrace: false });
  });
}

// Legendary: thick gold crayon border scribbled round the card edge.
function cardLegendTexture(scene) {
  const { width: w, height: h, pad } = CARD_UI;
  return uiSketchTexture(scene, 'cd_legend', w + pad * 2, h + pad * 2, (ctx, shape, jitter) => {
    const outer = uiWobblyRect(pad - 13, pad - 13, w + 26, h + 26, shape, jitter, 1.4);
    const inner = uiWobblyRect(pad + 9, pad + 9, w - 18, h - 18, shape, jitter, 1.2);
    // Clip to the band between the two outlines (even-odd ring).
    ctx.save();
    const ring = new Path2D();
    ring.moveTo(outer[0].x, outer[0].y);
    for (const p of outer) ring.lineTo(p.x, p.y);
    ring.closePath();
    ring.moveTo(inner[0].x, inner[0].y);
    for (let i = inner.length - 1; i >= 0; i--) ring.lineTo(inner[i].x, inner[i].y);
    ring.closePath();
    ctx.clip(ring, 'evenodd');
    ctx.lineCap = 'round';
    for (let i = 0; i < 260; i++) {
      // Short crayon strokes all round the band.
      const t = i / 260;
      const per = 2 * (w + h);
      let d = t * per;
      let x; let y;
      if (d < w) { x = pad + d; y = pad; } else if ((d -= w) < h) { x = pad + w; y = pad + d; } else if ((d -= h) < w) { x = pad + w - d; y = pad + h; } else { d -= w; x = pad; y = pad + h - d; }
      ctx.strokeStyle = uiCss(CARD_GOLD, 0.7 + jitter() * 0.3);
      ctx.lineWidth = 4 + jitter() * 3;
      ctx.beginPath();
      ctx.moveTo(x - 12 + (jitter() - 0.5) * 6, y + 12 + (jitter() - 0.5) * 6);
      ctx.lineTo(x + 12 + (jitter() - 0.5) * 6, y - 12 + (jitter() - 0.5) * 6);
      ctx.stroke();
    }
    ctx.restore();
    uiStroke(ctx, outer, jitter, { width: 2.4, color: 0x8a5a10, closed: true, retrace: false });
  });
}

// "+1 SET" hint: a small scrap torn off a notebook page and taped crooked onto the card's
// bottom edge. Deliberately not a label tag: straight scissor cut on top, ragged torn bottom,
// one strip of tape at a corner, hand lettering with a crayon scribble under the set name.
const CARD_SET_SCRAP = { w: 188, h: 64, pad: 18, tear: 7 };

// Ragged torn edge from (x0, y) to (x1, y): small irregular teeth of mixed width and depth,
// never deeper than `depth` either side of the line. rand() -> [0, 1).
function cardTornEdge(x0, x1, y, depth, rand) {
  const pts = [{ x: x0, y }];
  let x = x0;
  let k = 0;
  while (true) {
    x += 5 + rand() * 9;
    if (x >= x1 - 3) break;
    const sign = k++ % 2 ? 1 : -1;
    pts.push({ x, y: y + sign * depth * (0.3 + rand() * 0.7) });
  }
  pts.push({ x: x1, y });
  return pts;
}

// Closed outline of the scrap in texture px: cut top, torn bottom, slightly ragged sides.
function cardSetScrapOutline(rand) {
  const { w, h, pad, tear } = CARD_SET_SCRAP;
  const top = [];
  for (let i = 0; i <= 4; i++) top.push({ x: pad + (w * i) / 4, y: pad + (rand() - 0.5) * 3 + i * 0.8 });
  const bottom = cardTornEdge(pad, pad + w, pad + h, tear, rand).reverse();
  bottom[0].x += 3; // the tear starts a little in from the cut corner
  return top.concat([{ x: pad + w + 2, y: pad + h * 0.5 }], bottom, [{ x: pad - 2, y: pad + h * 0.55 }]);
}

// Css px between the screen edge and the outermost ink of the dealt row (cards and their set
// scraps), on a phone `viewW` css px wide. The game is FIT-scaled from GAME_WIDTH (720).
function cardRowGutterCss(viewW, gameW) {
  const half = Math.max(CARD_UI.width + 14, CARD_SET_SCRAP.w + CARD_SET_SCRAP.pad * 2) / 2 * CARD_UI.rowScale;
  // The outer cards rest tilted up to 2.5 deg and the scrap sits rotated and nudged sideways.
  const slack = 10;
  const edge = gameW / 2 - CARD_UI.spacing - half - slack;
  return edge * (viewW / gameW);
}

function cardSetNoteTexture(scene) {
  const { w, h, pad } = CARD_SET_SCRAP;
  return uiSketchTexture(scene, 'cd_setnote2', w + pad * 2, h + pad * 2, (ctx, shape, jitter) => {
    const outline = cardSetScrapOutline(shape).map((p) => ({ x: p.x + (jitter() - 0.5) * 1.2, y: p.y + (jitter() - 0.5) * 1.2 }));
    // Soft shadow: the scrap lifts a little off the card.
    uiTracePath(ctx, outline.map((p) => ({ x: p.x + 3, y: p.y + 5 })), true);
    ctx.fillStyle = 'rgba(5,6,16,0.35)';
    ctx.fill();
    uiTracePath(ctx, outline, true);
    ctx.fillStyle = uiCss(0xfbefc2);
    ctx.fill();
    // Faint blue notebook rule and the fibres showing along the torn edge.
    ctx.save();
    uiTracePath(ctx, outline, true);
    ctx.clip();
    ctx.strokeStyle = 'rgba(90,130,200,0.35)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(pad - 4, pad + h * 0.36 + (shape() - 0.5) * 2);
    ctx.lineTo(pad + w + 4, pad + h * 0.36 + (shape() - 0.5) * 2);
    ctx.stroke();
    ctx.restore();
    const torn = outline.filter((p) => p.y > pad + h - 12);
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth = 3;
    uiTracePath(ctx, torn.map((p) => ({ x: p.x, y: p.y - 2 })), false);
    ctx.stroke();
    uiStroke(ctx, outline, jitter, { width: 1.8, color: UI_INK.pencilDark, closed: true, retrace: false });
    // One strip of tape holding the top-left corner down.
    ctx.save();
    ctx.translate(pad + 14, pad + 4);
    ctx.rotate(-0.7);
    const tape = [];
    for (let i = 0; i <= 3; i++) tape.push({ x: 24 + (i % 2 ? 3 : 0) + (shape() - 0.5) * 3, y: -11 + i * 7.3 });
    for (let i = 3; i >= 0; i--) tape.push({ x: -24 - (i % 2 ? 3 : 0) + (shape() - 0.5) * 3, y: -11 + i * 7.3 });
    uiTracePath(ctx, tape, true);
    ctx.fillStyle = 'rgba(236,228,190,0.72)';
    ctx.fill();
    ctx.restore();
  });
}

// Crayon scribble under the set name (white, tinted per family).
function cardSetScribbleTexture(scene) {
  return uiSketchTexture(scene, 'cd_setscribble', 170, 22, (ctx, shape, jitter) => {
    const pts = [];
    for (let i = 0; i <= 8; i++) pts.push({ x: 8 + i * 19, y: 9 + Math.sin(i * 1.3 + shape() * 2) * 2 + (jitter() - 0.5) * 2 + i * 0.3 });
    for (let i = 7; i >= 3; i--) pts.push({ x: 12 + i * 19, y: 15 + (jitter() - 0.5) * 2.5 });
    uiStroke(ctx, pts, jitter, { width: 3.6, color: 0xffffff, retrace: false });
  });
}

class CardScene extends Phaser.Scene {
  constructor() {
    super('Cards');
  }

  init(data) {
    this.choices = (data && data.choices) || [];
    this.owned = (data && data.owned) || [];
    this.timeout = (data && data.timeout) || 6;
  }

  create() {
    this.scene.bringToTop();
    this.picked = false;
    this.pressed = null;
    this.pressedPointer = -1;  // id of the pointer holding this.pressed
    this.livePresses = {};     // pointer id -> true for counted presses still down
    this.armAt = null;         // this.elapsed when presses start counting (all cards landed + armDelay)
    this.timeUpAt = null;
    this.countdown = Math.max(2, this.timeout - CARD_UI.countdownTrim);
    // Seconds since opening, summed from update deltas: this.time.now is still 0 inside create()
    // of a freshly launched scene, so a timestamp taken here would expire the countdown at once.
    this.elapsed = 0;
    this.cards = [];
    cardPaperTexture(this);
    cardPatchTexture(this);
    cardRareTexture(this);
    cardLegendTexture(this);
    cardSetNoteTexture(this);
    cardSetScribbleTexture(this);
    uiStarTexture(this);
    uiUnderlineTexture(this);
    uiCircleTexture(this);

    // Dim, not a wash: the slowed game stays readable behind the cards.
    this.dim = this.add.rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT, 0x0b0d1c).setOrigin(0).setAlpha(0);
    this.tweens.add({ targets: this.dim, alpha: 0.55, duration: 180 });

    this.header = uiTitleText(this, GAME_WIDTH / 2, CARD_UI.headerY, 'PICK AN UPGRADE', { size: 64, rot: -0.03, shadowColor: uiColorHex(UI_CRAYON.orange) });
    const headerFit = Math.min(1, (GAME_WIDTH - 60) / this.header.main.width);
    // Held back until the HUD's zone banner (hideBanner) has fully faded: no 'TOP SPEED' ghosting.
    const headerWait = typeof HUD_BANNER !== 'undefined' ? HUD_BANNER.clearMs : 120;
    this.header.setScale(headerFit * 0.4).setAlpha(0);
    this.tweens.add({ targets: this.header, alpha: 1, delay: headerWait, duration: 60 });
    this.tweens.add({ targets: this.header, scale: headerFit, delay: headerWait, duration: 300, ease: 'Back.Out' });
    // Honest cost: every pick feeds the supernova. Written in red crayon with a scrawled underline.
    const novaPct = typeof CARD_TUNING !== 'undefined' ? Math.round(CARD_TUNING.novaPerCard * 100) : 5;
    this.subHeader = uiInkText(this, GAME_WIDTH / 2 + 10, CARD_UI.headerY + 62, 'SUPERNOVA +' + novaPct + '% FASTER', {
      size: 30, color: uiColorHex(UI_CRAYON.red), rot: 0.02,
    }).setAlpha(0);
    this.subLine = uiBoilImage(this, GAME_WIDTH / 2 + 14, CARD_UI.headerY + 86, 'ui_underline')
      .setTint(UI_CRAYON.red).setScale(0, 0.6).setAlpha(0.8).setRotation(0.02);
    this.tweens.add({ targets: this.subHeader, alpha: 1, delay: 150 + headerWait, duration: 200 });
    this.tweens.add({ targets: this.subLine, scaleX: 0.66, delay: 260 + headerWait, duration: 220, ease: 'Quad.Out' });

    const n = this.choices.length;
    this.choices.forEach((id, i) => {
      const x = GAME_WIDTH / 2 + (i - (n - 1) / 2) * CARD_UI.spacing;
      this.cards.push(this.makeCard(id, x, CARD_UI.centerY, i, n));
    });
    this.autoIndex = Math.floor((n - 1) / 2);

    // Pencil countdown ring under the card that gets auto-picked (redrawn on the boil clock).
    this.ringGfx = this.add.graphics();
    this.ringText = uiInkText(this, 0, 0, '', { size: 36, rot: -0.04 });
    this.ringAnchor = this.cards[this.autoIndex]
      ? { x: this.cards[this.autoIndex].baseX, y: CARD_UI.centerY + CARD_UI.height * CARD_UI.rowScale / 2 + 96 }
      : { x: GAME_WIDTH / 2, y: CARD_UI.centerY };
    // The ring (and its clock) only appears once the cards are armed, so every number it shows
    // lasts a real second.
    this.ringText.setPosition(this.ringAnchor.x, this.ringAnchor.y + 1).setAlpha(0).setText(String(this.countdown));
    this.ringGfx.setAlpha(0);
    uiOnBoil(this, (v, tick) => { this.boilTick = tick; this.drawCountdown(); });

    // A tap picks on release, and only the card it went down on and came up on. Presses that went
    // down before the cards were armed (a finger held from gameplay, or a tap meant for the game that
    // lands on the dealing cards) are ignored for their whole life.
    this.input.on('pointerdown', (p) => this.onPointerDown(p));
    this.input.on('pointerup', (p) => this.onPointerUp(p));
    this.input.on('pointerupoutside', (p) => this.onPointerUp(p));

    if (this.input.keyboard) {
      this.input.keyboard.on('keydown', (e) => {
        const k = parseInt(e.key, 10);
        if (k >= 1 && k <= this.cards.length && this.armAt !== null) this.pick(k - 1);
      });
    }

    // The run can end (or restart) under us: never outlive the game scene.
    this.gameScene = this.scene.get('Game');
    this.onGameShutdown = () => this.scene.stop();
    if (this.gameScene) this.gameScene.events.once('shutdown', this.onGameShutdown);
    this.events.once('shutdown', () => {
      if (this.gameScene) this.gameScene.events.off('shutdown', this.onGameShutdown);
    });

    if (!n) this.time.delayedCall(0, () => this.scene.stop());
  }

  // Would taking this card complete its family's set bonus?
  completesSet(card) {
    if (typeof activeSetBonuses !== 'function') return false;
    const before = activeSetBonuses(this.owned);
    const after = activeSetBonuses(this.owned.concat([card.id]));
    return after.indexOf(card.family) >= 0 && before.indexOf(card.family) < 0;
  }

  makeCard(id, x, y, index, count) {
    const card = CARDS.find(c => c.id === id) || { id, family: 'orbit', rarity: 'common', name: id, desc: '', icon: id };
    const w = CARD_UI.width;
    const h = CARD_UI.height;
    const crayon = cardCrayon(card.family);
    const parts = [];

    // Rarity marks sit behind the paper (they stick out around its edge).
    if (card.rarity === 'legendary') parts.push(uiBoilImage(this, 0, 0, 'cd_legend'));
    if (card.rarity === 'rare') parts.push(uiBoilImage(this, 0, 0, 'cd_rare'));
    parts.push(uiBoilImage(this, 0, 0, 'cd_paper'));
    const iconY = -h / 2 + 100;
    parts.push(uiBoilImage(this, 4, iconY + 4, 'cd_patch').setTint(crayon));
    parts.push(uiBoilImage(this, 0, iconY, cardIconTexture(this, card.icon, card.family)).setScale(1.05));

    // Family + rarity, scribbled under the icon. Both words share one line, so a long pair
    // ('flight' + 'legendary!') shrinks together instead of running past the card edge.
    const family = (CARD_FAMILIES[card.family] && CARD_FAMILIES[card.family].name.toLowerCase()) || card.family;
    const word = CARD_RARITY_WORD[card.rarity] || CARD_RARITY_WORD.common;
    const tagFamily = uiInkText(this, -w / 2 + 12, -h / 2 + 182, family, { size: CARD_TEXT.tagSize, color: cardCrayonInk(card.family), stroke: null, ox: 0, rot: -0.03, boil: false });
    const tagRarity = uiInkText(this, w / 2 - 12, -h / 2 + 182, word.text, { size: CARD_TEXT.tagSize, color: word.color, stroke: null, ox: 1, rot: 0.03, boil: false });
    const tagScale = cardFitScale(tagFamily.width + CARD_TEXT.tagGap + tagRarity.width, 1, w - 24, 1);
    tagFamily.setScale(tagScale);
    tagRarity.setScale(tagScale);
    parts.push(tagFamily, tagRarity);

    // Name and description stack top-down under the labels; the description gets whatever room
    // is left above the card bottom (or above the '+1 set' scrap) and wraps, shrinking only when
    // a long one still does not fit.
    const textW = w - CARD_TEXT.sideMargin * 2;
    const name = uiInkText(this, 0, CARD_TEXT.nameTop, card.name.toUpperCase(), { size: CARD_TEXT.nameSize, color: UI_INK.darkHex, stroke: null, oy: 0, rot: -0.015, boil: false });
    // One line when it only needs a light squeeze (keeps room for the description), else wrap.
    if (cardFitScale(name.width, 1, textW, 1) < CARD_TEXT.nameMinOneLine) name.setWordWrapWidth(textW).setAlign('center');
    name.setScale(cardFitScale(name.width, name.height, textW, CARD_TEXT.nameMaxH));
    const descTop = CARD_TEXT.nameTop + name.displayHeight + CARD_TEXT.descGap;
    const hasScrap = this.completesSet(card) && typeof SET_BONUSES !== 'undefined' && !!SET_BONUSES[card.family];
    const descBottom = hasScrap ? CARD_TEXT.descBottomScrap : CARD_TEXT.descBottom;
    const desc = uiInkText(this, 0, descTop, card.desc, { size: CARD_TEXT.descSize, color: UI_INK.pencilDarkHex, stroke: null, oy: 0, rot: 0.01, boil: false, lineSpacing: CARD_TEXT.descLineSpacing });
    desc.setWordWrapWidth(textW).setAlign('center');
    desc.setScale(cardFitScale(desc.width, desc.height, textW, descBottom - descTop));
    parts.push(name, desc);

    // Legendary: a few doodled gold stars stuck around the border.
    if (card.rarity === 'legendary') {
      for (const [sx, sy, s] of [[-w / 2 - 4, -h / 2 + 30, 1.1], [w / 2 + 6, -h / 2 + 140, 0.8], [w / 2 - 2, h / 2 - 22, 1.2], [-w / 2 + 2, h / 2 - 120, 0.7]]) {
        parts.push(uiBoilImage(this, sx, sy, 'ui_star').setTint(CARD_GOLD).setScale(s));
      }
    }

    // "+1 SET" scrap torn from a notebook and taped crooked over the bottom edge.
    if (hasScrap) {
      const ry = h / 2 + 8;
      const note = uiBoilImage(this, 0, 0, 'cd_setnote2');
      const ribTop = uiInkText(this, -CARD_SET_SCRAP.w / 2 + 12, -19, '+1 set', { size: 26, color: UI_INK.pencilDarkHex, stroke: null, ox: 0, rot: -0.04, boil: false });
      const ribName = uiInkText(this, 4, 6, SET_BONUSES[card.family].name.toLowerCase(), { size: 26, color: cardCrayonInk(card.family), stroke: null, rot: -0.02, boil: false });
      ribName.setScale(Math.min(1, (CARD_SET_SCRAP.w - 24) / ribName.width));
      const scribble = uiBoilImage(this, 6, 22, 'cd_setscribble').setTint(cardCrayon(card.family)).setScale(Math.min(1, (ribName.displayWidth + 16) / 170), 1);
      const tilt = (uiHash(card.family) % 2 ? 1 : -1) * 0.06;
      const rib = this.add.container(8 * Math.sign(tilt), ry, [note, scribble, ribTop, ribName]).setRotation(tilt);
      parts.push(rib);
      // A slow flutter, as if the loose torn end lifts a little.
      this.tweens.add({ targets: rib, rotation: { from: tilt - 0.02, to: tilt + 0.02 }, yoyo: true, repeat: -1, duration: 520, ease: 'Sine.InOut' });
    }

    const inner = this.add.container(0, 0, parts).setScale(CARD_UI.rowScale);
    // Slight resting tilt, as if dealt by hand.
    const restAngle = ((uiHash(id) % 100) / 100 - 0.5) * 5;
    const box = this.add.container(GAME_WIDTH / 2, GAME_HEIGHT + h, [inner]);
    box.setSize((w + 14) * CARD_UI.rowScale, (h + 30) * CARD_UI.rowScale);
    // Only for the hand cursor: taps are hit-tested by the scene (see onPointerDown).
    box.setInteractive({ useHandCursor: true });
    const entry = { id, card, box, inner, rarity: card.rarity, color: crayon, baseX: x, baseY: y, restAngle, index, landed: false };

    // Dealt from a deck below the screen, spinning a little, then slapped down onto the page.
    box.setAngle(-30 + index * 25).setScale(0.8);
    this.tweens.add({
      targets: box, x, y, angle: restAngle, scale: 1.08, delay: 40 + index * 110, duration: 260, ease: 'Quad.Out',
      onComplete: () => {
        box.setScale(1.06, 0.92);
        this.tweens.add({ targets: box, scaleX: 1, scaleY: 1, duration: 200, ease: 'Back.Out', onComplete: () => { entry.landed = true; } });
        this.slapMarks(x, y);
      },
    });

    return entry;
  }

  // Little ink impact ticks at a card's corners when it lands.
  slapMarks(x, y) {
    const g = this.add.graphics();
    const w = CARD_UI.width / 2 + 10;
    const h = CARD_UI.height / 2 + 10;
    const seed = Math.floor(Math.random() * 1000);
    let i = 0;
    for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      for (const a of [-0.5, 0.5]) {
        const base = Math.atan2(sy, sx) + a * 0.6;
        const x0 = x + sx * w + Math.cos(base) * 6;
        const y0 = y + sy * h + Math.sin(base) * 6;
        uiScribbleLine(g, x0, y0, x0 + Math.cos(base) * 22, y0 + Math.sin(base) * 22, seed + i++, { width: 3.5, amp: 0.8, passes: 1 });
      }
    }
    this.tweens.add({ targets: g, alpha: 0, delay: 120, duration: 260, onComplete: () => g.destroy() });
  }

  canPick() {
    return !this.picked;
  }

  // Card under a screen point: where it is drawn right now (also mid deal-in) or where it is
  // landing; only cards already on screen count. The nearest center wins.
  cardAtPoint(px, py) {
    const pad = CARD_UI.hitSlop;
    let best = -1;
    let bestD = Infinity;
    this.cards.forEach((c, i) => {
      const hw = (CARD_UI.width / 2) * CARD_UI.rowScale * Math.max(1, c.box.scaleX) + pad;
      const hh = (CARD_UI.height / 2) * CARD_UI.rowScale * Math.max(1, c.box.scaleY) + pad;
      const onScreen = c.box.y - hh < GAME_HEIGHT;
      if (!onScreen) return;
      const inNow = Math.abs(px - c.box.x) <= hw && Math.abs(py - c.box.y) <= hh;
      const inRest = Math.abs(px - c.baseX) <= CARD_UI.width * CARD_UI.rowScale / 2 + pad && Math.abs(py - c.baseY) <= CARD_UI.height * CARD_UI.rowScale / 2 + pad;
      if (!inNow && !inRest) return;
      const d = Math.min(Math.hypot(px - c.box.x, py - c.box.y), Math.hypot(px - c.baseX, py - c.baseY));
      if (d < bestD) { bestD = d; best = i; }
    });
    return best;
  }

  onPointerDown(p) {
    if (!this.canPick() || !cardPressCounts(this.elapsed, this.armAt)) return;
    this.livePresses[p.id] = true;
    const index = this.cardAtPoint(p.x, p.y);
    if (index < 0) return;
    const entry = this.cards[index];
    if (this.pressed && this.pressed !== entry) this.release(this.pressed);
    this.pressed = entry;
    this.pressedPointer = p.id;
    // Pressed: the card snaps to its spot and squashes under the finger.
    // The squash widens it, so an edge card steps inward to keep its labels on screen.
    this.tweens.killTweensOf(entry.box);
    entry.landed = true;
    entry.box.setPosition(cardSafeX(entry.baseX, 1.07), entry.baseY).setAngle(entry.restAngle).setAlpha(1).setScale(1.07, 0.9);
    // The squashed card is wider than its slot: lift it above its neighbours so their edges
    // never cover its family label.
    entry.box.setDepth(4);
  }

  // A press that ends without a pick (another card pressed instead) springs back.
  release(entry) {
    entry.box.setDepth(0);
    this.tweens.add({ targets: entry.box, x: entry.baseX, scaleX: 1, scaleY: 1, duration: 160, ease: 'Back.Out' });
  }

  // Only a counted press (see onPointerDown) can pick, and only the card it is still on: a finger
  // that slid off its card cancels (the card springs back) instead of picking something else.
  onPointerUp(p) {
    if (!this.livePresses[p.id]) return;
    delete this.livePresses[p.id];
    if (this.picked || !this.pressed || p.id !== this.pressedPointer) return;
    const entry = this.pressed;
    this.pressed = null;
    this.pressedPointer = -1;
    const index = cardReleasePick(entry.index, this.cardAtPoint(p.x, p.y));
    if (index >= 0) this.pick(index); else this.release(entry);
  }

  pick(index) {
    if (this.picked || !this.cards[index]) return;
    this.picked = true;
    const chosen = this.cards[index];

    // Chosen card squashes, lifts, then is tossed up toward the HUD's owned-card row.
    this.tweens.killTweensOf(chosen.box);
    // Edge cards slide inward as they grow, so the lifted card (and its family label) never
    // runs off the screen edge.
    chosen.box.setScale(1.14, 0.84).setAngle(0).setX(cardSafeX(chosen.baseX, 1.14));
    chosen.box.setDepth(5);
    this.tweens.chain({
      targets: chosen.box,
      tweens: [
        { scaleX: 1.18, scaleY: 1.18, x: cardSafeX(chosen.baseX, 1.3), y: chosen.baseY - 50, duration: 150, ease: 'Back.Out' },
        { x: GAME_WIDTH - 120, y: 220, scaleX: 0.25, scaleY: 0.25, angle: 14, alpha: 0, duration: 180, delay: 20, ease: 'Quad.In' },
      ],
    });
    cardDoodleBurst(this, chosen.baseX, chosen.baseY - 50, [chosen.color, UI_CRAYON.yellow, UI_INK.cream], { count: 10, reach: 240, depth: 6 });
    for (const other of this.cards) {
      if (other === chosen) continue;
      this.tweens.killTweensOf(other.box);
      const dir = other.baseX < chosen.baseX ? -1 : 1;
      this.tweens.add({
        targets: other.box, y: GAME_HEIGHT + CARD_UI.height, x: other.baseX + dir * 80, angle: dir * 28, alpha: 0.7,
        duration: 340, ease: 'Cubic.In',
      });
    }
    // A very fast pick lands while the header's delayed fade-in is still queued: drop it first.
    this.tweens.killTweensOf([this.header, this.subHeader, this.subLine, this.ringText, this.ringGfx]);
    this.tweens.add({ targets: [this.header, this.subHeader, this.subLine, this.ringText, this.ringGfx], alpha: 0, duration: 200 });
    this.tweens.add({ targets: this.dim, alpha: 0, delay: 80, duration: 260 });
    this.time.delayedCall(EXIT_MS, () => {
      this.game.events.emit('cards:picked', chosen.id);
      if (this.scene.isActive()) this.scene.stop();
    });
  }

  update(time, delta) {
    const t = time / 1000;
    this.elapsed += Math.min(delta, 100) / 1000;   // a stalled tab must not eat the countdown
    for (const c of this.cards) {
      // Gentle idle float once landed (on the inner layer, so it never fights the box tweens).
      c.inner.y = c.landed && !this.picked ? Math.sin(t * 2.6 + c.index * 1.3) * 4 : 0;
    }
    if (this.picked) return;
    if (this.armAt === null && this.cards.length && this.cards.every((c) => c.landed)) {
      this.armAt = this.elapsed + CARD_UI.armDelay;
      this.tweens.add({ targets: [this.ringText, this.ringGfx], alpha: 1, delay: CARD_UI.armDelay * 1000, duration: 150 });
    }
    const left = cardCountdownLeft(this.elapsed, this.armAt, this.countdown);
    const label = String(Math.ceil(left));
    if (this.ringText.text !== label) {
      this.ringText.setText(label);
      if (left < CARD_UI.autoWarn) {
        this.ringText.setScale(1.3);
        this.tweens.add({ targets: this.ringText, scale: 1, duration: 200, ease: 'Back.Out' });
      }
    }
    // Last seconds: the default card nudges so the auto-pick is no surprise.
    const auto = this.cards[this.autoIndex];
    if (auto && auto.landed && left < CARD_UI.autoWarn && this.pressed !== auto) {
      auto.box.setAngle(auto.restAngle + Math.sin(t * 22) * 2.2 * (1 - left / CARD_UI.autoWarn));
    }
    // Time up: a finger still down gets tapGrace to lift (its release picks); after that the
    // card under it wins over the default pick.
    if (left <= 0 && this.timeUpAt === null) this.timeUpAt = this.elapsed;
    const fingerDown = Object.keys(this.livePresses).length > 0;
    if (cardAutoPickDue(left, fingerDown, this.elapsed, this.timeUpAt, CARD_UI.tapGrace)) {
      this.pick(this.pressed ? this.pressed.index : this.autoIndex);
    }
  }

  // Pencil ring: a faint full sketch circle plus a darker arc for the time left, both wobbling
  // with the boil tick. Never a perfect circle: radius drifts with low-frequency noise.
  drawCountdown() {
    if (this.picked || !this.ringGfx) return;
    const g = this.ringGfx;
    const { x, y } = this.ringAnchor;
    const left = cardCountdownLeft(this.elapsed, this.armAt, this.countdown);
    const frac = left / this.countdown;
    const urgent = left < CARD_UI.autoWarn;
    const seed = this.boilTick || 0;
    const r = 34;
    const point = (a, k, s) => {
      const rr = r * (1 + 0.05 * Math.sin(a * 2 + 1.3)) + (uiNoise(seed + s, k) - 0.5) * 2.4;
      return { x: x + Math.cos(a) * rr, y: y + Math.sin(a) * rr };
    };
    const stroke = (a0, a1, width, color, alpha, s) => {
      const n = Math.max(3, Math.ceil(Math.abs(a1 - a0) / 0.22));
      g.lineStyle(width, color, alpha);
      g.beginPath();
      for (let i = 0; i <= n; i++) {
        const p = point(a0 + (a1 - a0) * (i / n), i, s);
        if (i === 0) g.moveTo(p.x, p.y); else g.lineTo(p.x, p.y);
      }
      g.strokePath();
    };
    g.clear();
    stroke(-Math.PI / 2 - 0.3, Math.PI * 1.5 + 0.15, 3, UI_INK.pencil, 0.45, 3);
    if (frac > 0) {
      const color = urgent ? UI_CRAYON.red : UI_INK.cream;
      stroke(-Math.PI / 2, -Math.PI / 2 + UI_TAU * frac, 6, color, 1, 0);
      stroke(-Math.PI / 2 + 0.1, -Math.PI / 2 + UI_TAU * frac * 0.85, 3, color, 0.6, 7);
    }
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { CARD_UI, CARD_TEXT, cardFitScale, CARD_SET_SCRAP, cardTornEdge, cardSetScrapOutline, cardRowGutterCss, cardCountdownLeft, cardPressCounts, cardReleasePick, cardAutoPickDue };
}
