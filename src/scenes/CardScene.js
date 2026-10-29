// Upgrade pick overlay, launched by GameScene on zone entry:
//   this.scene.launch('Cards', { choices: [ids], owned: [ids], timeout: 6 })
// Shows up to 3 cards over the slowed game; a tap (or the auto-pick of the middle card when the
// countdown runs out) plays the exit, then emits game.events 'cards:picked' (id) once and stops.
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
  spacing: 234,
  centerY: 850,
  headerY: 548,
  hitSlop: 18,          // px of forgiveness round a card for a tap
  autoWarn: 2,          // seconds left when the middle card starts nudging
};

// Card center x that keeps a card scaled by `scale` (plus its border marks) inside the screen.
function cardSafeX(x, scale) {
  const half = (CARD_UI.width / 2 + 16) * scale + 8;
  return Phaser.Math.Clamp(x, half, GAME_WIDTH - half);
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

// Small yellow scrap for the "+1 SET" hint, taped across the bottom of a card.
function cardSetNoteTexture(scene) {
  return uiSketchTexture(scene, 'cd_setnote', 250, 92, (ctx, shape, jitter) => {
    const pts = uiWobblyRect(14, 14, 222, 62, shape, jitter, 0.8);
    uiTracePath(ctx, pts.map((p) => ({ x: p.x + 4, y: p.y + 6 })), true);
    ctx.fillStyle = 'rgba(5,6,16,0.4)';
    ctx.fill();
    uiTracePath(ctx, pts, true);
    ctx.fillStyle = uiCss(0xfff6c8);
    ctx.fill();
    uiHatch(ctx, pts, jitter, { color: 0xffffff, spacing: 4, width: 4, alpha: 0.9, offX: 2, offY: -1, grow: 0.98 });
    uiStroke(ctx, pts, jitter, { width: 2.4, color: UI_INK.dark, closed: true, retrace: false });
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
    // Seconds since opening, summed from update deltas: this.time.now is still 0 inside create()
    // of a freshly launched scene, so a timestamp taken here would expire the countdown at once.
    this.elapsed = 0;
    this.cards = [];
    cardPaperTexture(this);
    cardPatchTexture(this);
    cardRareTexture(this);
    cardLegendTexture(this);
    cardSetNoteTexture(this);
    uiStarTexture(this);
    uiUnderlineTexture(this);
    uiCircleTexture(this);

    // Dim, not a wash: the slowed game stays readable behind the cards.
    this.dim = this.add.rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT, 0x0b0d1c).setOrigin(0).setAlpha(0);
    this.tweens.add({ targets: this.dim, alpha: 0.55, duration: 180 });

    this.header = uiTitleText(this, GAME_WIDTH / 2, CARD_UI.headerY, 'PICK AN UPGRADE', { size: 64, rot: -0.03, shadowColor: uiColorHex(UI_CRAYON.orange) });
    const headerFit = Math.min(1, (GAME_WIDTH - 60) / this.header.main.width);
    this.header.setScale(headerFit * 0.4);
    this.tweens.add({ targets: this.header, scale: headerFit, duration: 300, ease: 'Back.Out' });
    // Honest cost: every pick feeds the supernova. Written in red crayon with a scrawled underline.
    const novaPct = typeof CARD_TUNING !== 'undefined' ? Math.round(CARD_TUNING.novaPerCard * 100) : 5;
    this.subHeader = uiInkText(this, GAME_WIDTH / 2 + 10, CARD_UI.headerY + 62, 'SUPERNOVA +' + novaPct + '% FASTER', {
      size: 30, color: uiColorHex(UI_CRAYON.red), rot: 0.02,
    }).setAlpha(0);
    this.subLine = uiBoilImage(this, GAME_WIDTH / 2 + 14, CARD_UI.headerY + 86, 'ui_underline')
      .setTint(UI_CRAYON.red).setScale(0, 0.6).setAlpha(0.8).setRotation(0.02);
    this.tweens.add({ targets: this.subHeader, alpha: 1, delay: 150, duration: 200 });
    this.tweens.add({ targets: this.subLine, scaleX: 0.66, delay: 260, duration: 220, ease: 'Quad.Out' });

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
      ? { x: this.cards[this.autoIndex].baseX, y: CARD_UI.centerY + CARD_UI.height / 2 + 96 }
      : { x: GAME_WIDTH / 2, y: CARD_UI.centerY };
    this.ringText.setPosition(this.ringAnchor.x, this.ringAnchor.y + 1).setAlpha(0);
    this.ringGfx.setAlpha(0);
    this.tweens.add({ targets: [this.ringText, this.ringGfx], alpha: 1, delay: 300, duration: 200 });
    uiOnBoil(this, (v, tick) => { this.boilTick = tick; this.drawCountdown(); });

    // A tap picks on release. Only a press that started in this scene counts (a finger already
    // holding the comet when the pick opened never picks); no time guard beyond that.
    this.input.on('pointerdown', (p) => this.onPointerDown(p));
    this.input.on('pointerup', () => this.onPointerUp());
    this.input.on('pointerupoutside', () => this.onPointerUp());

    if (this.input.keyboard) {
      this.input.keyboard.on('keydown', (e) => {
        const k = parseInt(e.key, 10);
        if (k >= 1 && k <= this.cards.length) this.pick(k - 1);
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

    // Family + rarity, scribbled small under the icon.
    const family = (CARD_FAMILIES[card.family] && CARD_FAMILIES[card.family].name.toLowerCase()) || card.family;
    const word = CARD_RARITY_WORD[card.rarity] || CARD_RARITY_WORD.common;
    const tagFamily = uiInkText(this, -w / 2 + 14, -h / 2 + 182, family, { size: 21, color: cardCrayonInk(card.family), stroke: null, ox: 0, rot: -0.03, boil: false });
    const tagRarity = uiInkText(this, w / 2 - 14, -h / 2 + 182, word.text, { size: 21, color: word.color, stroke: null, ox: 1, rot: 0.03, boil: false });
    parts.push(tagFamily, tagRarity);

    const textW = w - 30;
    const name = uiInkText(this, 0, 42, card.name.toUpperCase(), { size: 32, color: UI_INK.darkHex, stroke: null, rot: -0.015, boil: false });
    name.setWordWrapWidth(textW).setAlign('center');
    name.setScale(Math.min(1, textW / name.width, 66 / name.height));
    const desc = uiInkText(this, 0, 124, card.desc, { size: 25, color: UI_INK.pencilDarkHex, stroke: null, rot: 0.01, boil: false, lineSpacing: 4 });
    desc.setWordWrapWidth(textW).setAlign('center');
    desc.setScale(Math.min(1, textW / desc.width, 84 / desc.height));
    parts.push(name, desc);

    // Legendary: a few doodled gold stars stuck around the border.
    if (card.rarity === 'legendary') {
      for (const [sx, sy, s] of [[-w / 2 - 4, -h / 2 + 30, 1.1], [w / 2 + 6, -h / 2 + 140, 0.8], [w / 2 - 2, h / 2 - 22, 1.2], [-w / 2 + 2, h / 2 - 120, 0.7]]) {
        parts.push(uiBoilImage(this, sx, sy, 'ui_star').setTint(CARD_GOLD).setScale(s));
      }
    }

    // "+1 SET" scrap taped across the bottom edge.
    if (this.completesSet(card) && typeof SET_BONUSES !== 'undefined' && SET_BONUSES[card.family]) {
      const ry = h / 2 + 10;
      const note = uiBoilImage(this, 0, ry, 'cd_setnote').setRotation(-0.05);
      const ribTop = uiInkText(this, -88, ry - 12, '+1 SET:', { size: 20, color: UI_INK.darkHex, stroke: null, ox: 0, rot: -0.06, boil: false });
      const ribName = uiInkText(this, 0, ry + 11, SET_BONUSES[card.family].name, { size: 25, color: cardCrayonInk(card.family), stroke: null, rot: -0.05, boil: false });
      ribName.setScale(Math.min(1, 200 / ribName.width));
      const rib = this.add.container(0, 0, [note, ribTop, ribName]);
      parts.push(rib);
      this.tweens.add({ targets: rib, angle: { from: -2, to: 2 }, yoyo: true, repeat: -1, duration: 420, ease: 'Sine.InOut' });
    }

    const inner = this.add.container(0, 0, parts);
    // Slight resting tilt, as if dealt by hand.
    const restAngle = ((uiHash(id) % 100) / 100 - 0.5) * 5;
    const box = this.add.container(GAME_WIDTH / 2, GAME_HEIGHT + h, [inner]);
    box.setSize(w + 14, h + 30);
    // Only for the hand cursor: taps are hit-tested by the scene (see onPointerDown), so a card
    // still dealing in (moving under the finger) takes the very first tap.
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
      const hw = (CARD_UI.width / 2) * Math.max(1, c.box.scaleX) + pad;
      const hh = (CARD_UI.height / 2) * Math.max(1, c.box.scaleY) + pad;
      const onScreen = c.box.y - hh < GAME_HEIGHT;
      if (!onScreen) return;
      const inNow = Math.abs(px - c.box.x) <= hw && Math.abs(py - c.box.y) <= hh;
      const inRest = Math.abs(px - c.baseX) <= CARD_UI.width / 2 + pad && Math.abs(py - c.baseY) <= CARD_UI.height / 2 + pad;
      if (!inNow && !inRest) return;
      const d = Math.min(Math.hypot(px - c.box.x, py - c.box.y), Math.hypot(px - c.baseX, py - c.baseY));
      if (d < bestD) { bestD = d; best = i; }
    });
    return best;
  }

  onPointerDown(p) {
    if (!this.canPick()) return;
    const index = this.cardAtPoint(p.x, p.y);
    if (index < 0) return;
    const entry = this.cards[index];
    if (this.pressed && this.pressed !== entry) this.release(this.pressed);
    this.pressed = entry;
    // Pressed: the card snaps to its spot (ending the deal-in) and squashes under the finger.
    // The squash widens it, so an edge card steps inward to keep its labels on screen.
    this.tweens.killTweensOf(entry.box);
    entry.landed = true;
    entry.box.setPosition(cardSafeX(entry.baseX, 1.07), entry.baseY).setAngle(entry.restAngle).setAlpha(1).setScale(1.07, 0.9);
  }

  // A press that ends without a pick (another card pressed instead) springs back.
  release(entry) {
    this.tweens.add({ targets: entry.box, x: entry.baseX, scaleX: 1, scaleY: 1, duration: 160, ease: 'Back.Out' });
  }

  // Release anywhere commits the pressed card: the deal-in moves cards under the finger, so a
  // drift off the card between press and release must not cost the pick.
  onPointerUp() {
    if (!this.pressed || this.picked) return;
    this.pick(this.pressed.index);
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
    const left = Math.max(0, this.timeout - this.elapsed);
    for (const c of this.cards) {
      // Gentle idle float once landed (on the inner layer, so it never fights the box tweens).
      c.inner.y = c.landed && !this.picked ? Math.sin(t * 2.6 + c.index * 1.3) * 4 : 0;
    }
    if (this.picked) return;
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
    // Time up: a card under the finger wins over the default pick.
    if (left <= 0) this.pick(this.pressed ? this.pressed.index : this.autoIndex);
  }

  // Pencil ring: a faint full sketch circle plus a darker arc for the time left, both wobbling
  // with the boil tick. Never a perfect circle: radius drifts with low-frequency noise.
  drawCountdown() {
    if (this.picked || !this.ringGfx) return;
    const g = this.ringGfx;
    const { x, y } = this.ringAnchor;
    const left = Math.max(0, this.timeout - this.elapsed);
    const frac = left / this.timeout;
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
