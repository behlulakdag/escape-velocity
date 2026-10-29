// Upgrade pick overlay, launched by GameScene on zone entry:
//   this.scene.launch('Cards', { choices: [ids], owned: [ids], timeout: 6 })
// Shows up to 3 cards over the slowed game; a tap (or the auto-pick of the middle card when the
// countdown runs out) plays the exit, then emits game.events 'cards:picked' (id) once and stops.
// The exit runs BEFORE the emit because GameScene stops this scene as soon as it hears the pick.
// Card data comes from src/cards.js (CARDS, CARD_FAMILIES, SET_BONUSES, activeSetBonuses).

const CARD_UI = {
  width: 214,
  height: 380,
  spacing: 234,
  centerY: 850,
  headerY: 560,
  trim: 9,
  inputDelay: 280,      // ms before taps count, so a held finger lifting is not a pick
  autoWarn: 2,          // seconds left when the middle card starts nudging
};

// Exit animation length (ms) before the pick is reported to the game.
const EXIT_MS = 360;

const RARITY_STYLE = {
  common: { label: 'COMMON', trim: null, pill: 0x1a1033, pillText: '#ffffff' },
  rare: { label: 'RARE', trim: 0xdfe8f5, pill: 0xdfe8f5, pillText: '#1a1033' },
  legendary: { label: 'LEGENDARY', trim: 0xffe14d, pill: 0xffe14d, pillText: '#1a1033' },
};

function cssColor(color) {
  return '#' + color.toString(16).padStart(6, '0');
}

// Clips a convex polygon to an axis-aligned rect (Sutherland-Hodgman), for the shimmer band.
function clipToRect(pts, left, top, right, bottom) {
  const edges = [
    (p) => p.x >= left, (p) => p.x <= right, (p) => p.y >= top, (p) => p.y <= bottom,
  ];
  const cross = [
    (a, b) => ({ x: left, y: a.y + (b.y - a.y) * (left - a.x) / (b.x - a.x) }),
    (a, b) => ({ x: right, y: a.y + (b.y - a.y) * (right - a.x) / (b.x - a.x) }),
    (a, b) => ({ x: a.x + (b.x - a.x) * (top - a.y) / (b.y - a.y), y: top }),
    (a, b) => ({ x: a.x + (b.x - a.x) * (bottom - a.y) / (b.y - a.y), y: bottom }),
  ];
  let out = pts;
  for (let e = 0; e < 4 && out.length; e++) {
    const input = out;
    out = [];
    for (let i = 0; i < input.length; i++) {
      const cur = input[i];
      const prev = input[(i + input.length - 1) % input.length];
      const curIn = edges[e](cur);
      const prevIn = edges[e](prev);
      if (curIn) {
        if (!prevIn) out.push(cross[e](prev, cur));
        out.push(cur);
      } else if (prevIn) {
        out.push(cross[e](prev, cur));
      }
    }
  }
  return out;
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

    // Dim, not a wash: the slowed game stays readable behind the cards.
    this.dim = this.add.rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT, 0x120a2a).setOrigin(0).setAlpha(0);
    this.tweens.add({ targets: this.dim, alpha: 0.55, duration: 180 });

    const stroke = { stroke: '#1a1033', strokeThickness: 12 };
    this.header = this.add.text(GAME_WIDTH / 2, CARD_UI.headerY, 'PICK AN UPGRADE', {
      fontFamily: FONT, fontSize: '66px', color: '#ffe14d', ...stroke, strokeThickness: 14,
    }).setOrigin(0.5).setShadow(0, 7, '#1a1033', 0, true, true).setScale(0.4);
    this.tweens.add({ targets: this.header, scale: Math.min(1, (GAME_WIDTH - 60) / this.header.width), duration: 300, ease: 'Back.Out' });
    // Honest cost: every pick feeds the supernova.
    const novaPct = typeof CARD_TUNING !== 'undefined' ? Math.round(CARD_TUNING.novaPerCard * 100) : 5;
    this.subHeader = this.add.text(GAME_WIDTH / 2, CARD_UI.headerY + 54, 'SUPERNOVA +' + novaPct + '% FASTER', {
      fontFamily: FONT, fontSize: '28px', color: '#ff9a6b', ...stroke, strokeThickness: 7,
    }).setOrigin(0.5).setAlpha(0);
    this.tweens.add({ targets: this.subHeader, alpha: 1, delay: 150, duration: 200 });

    const n = this.choices.length;
    this.choices.forEach((id, i) => {
      const x = GAME_WIDTH / 2 + (i - (n - 1) / 2) * CARD_UI.spacing;
      this.cards.push(this.makeCard(id, x, CARD_UI.centerY, i, n));
    });
    this.autoIndex = Math.floor((n - 1) / 2);

    // Countdown ring under the card that gets auto-picked.
    this.ringGfx = this.add.graphics();
    this.ringText = this.add.text(0, 0, '', {
      fontFamily: FONT, fontSize: '34px', color: '#ffffff', stroke: '#1a1033', strokeThickness: 7,
    }).setOrigin(0.5);
    this.ringAnchor = this.cards[this.autoIndex]
      ? { x: this.cards[this.autoIndex].baseX, y: CARD_UI.centerY + CARD_UI.height / 2 + 96 }
      : { x: GAME_WIDTH / 2, y: CARD_UI.centerY };
    this.ringText.setPosition(this.ringAnchor.x, this.ringAnchor.y + 1).setAlpha(0);
    this.tweens.add({ targets: this.ringText, alpha: 1, delay: 300, duration: 200 });

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
    const family = CARD_FAMILIES[card.family] || { name: '', color: 0xffffff };
    const rarity = RARITY_STYLE[card.rarity] || RARITY_STYLE.common;
    const w = CARD_UI.width;
    const h = CARD_UI.height;
    const color = family.color;
    const panelColor = lerpColor(color, ART.outline, 0.58);

    const frame = this.add.graphics();
    const tw = CARD_UI.trim;
    frame.fillStyle(0x000000, 0.3);
    frame.fillRoundedRect(-w / 2 + 6, -h / 2 + 16, w, h, 28);
    frame.fillStyle(ART.outline, 1);
    frame.fillRoundedRect(-w / 2 - 7, -h / 2 - 7, w + 14, h + 14, 32);
    frame.fillStyle(rarity.trim || lerpColor(color, ART.outline, 0.3), 1);
    frame.fillRoundedRect(-w / 2, -h / 2, w, h, 26);
    if (rarity.trim) {
      // Engraved inner line on the metal trim.
      frame.fillStyle(lerpColor(rarity.trim, ART.outline, 0.35), 1);
      frame.fillRoundedRect(-w / 2 + tw - 3, -h / 2 + tw - 3, w - 2 * tw + 6, h - 2 * tw + 6, 21);
    }
    frame.fillStyle(color, 1);
    frame.fillRoundedRect(-w / 2 + tw, -h / 2 + tw, w - 2 * tw, h - 2 * tw, 19);
    // Lower text panel in a deep family tone, with a lip on its top edge.
    const panelTop = 14;
    frame.fillStyle(lerpColor(color, ART.outline, 0.3), 1);
    frame.fillRoundedRect(-w / 2 + tw, panelTop - 6, w - 2 * tw, 12, 4);
    frame.fillStyle(panelColor, 1);
    frame.fillRoundedRect(-w / 2 + tw, panelTop, w - 2 * tw, h / 2 - tw - panelTop, { tl: 0, tr: 0, bl: 19, br: 19 });
    frame.fillStyle(0xffffff, 0.32);
    frame.fillRoundedRect(-w / 2 + tw + 12, -h / 2 + tw + 8, w - 2 * tw - 24, 14, 7);
    // Icon disc overlapping the panel edge, so the face is layered rather than one slab.
    const iconY = -h / 2 + 126;
    frame.fillStyle(ART.outline, 1);
    frame.fillCircle(0, iconY + 4, 76);
    frame.fillStyle(lerpColor(color, 0xffffff, 0.35), 1);
    frame.fillCircle(0, iconY, 70);
    frame.fillStyle(panelColor, 1);
    frame.fillCircle(0, iconY, 60);
    ART.drawCardIcon(frame, card.icon, 0, iconY, 92, color);
    frame.fillStyle(0xffffff, 0.3);
    frame.fillEllipse(-22, iconY - 44, 46, 14);

    // Rarity pill on the top edge.
    const pillW = rarity === RARITY_STYLE.legendary ? 150 : rarity === RARITY_STYLE.rare ? 92 : 124;
    const pillY = -h / 2 + 4;
    frame.fillStyle(ART.outline, 1);
    frame.fillRoundedRect(-pillW / 2 - 4, pillY - 21, pillW + 8, 42, 21);
    frame.fillStyle(rarity.pill, 1);
    frame.fillRoundedRect(-pillW / 2, pillY - 17, pillW, 34, 17);
    const pillText = this.add.text(0, pillY + 1, rarity.label, {
      fontFamily: FONT, fontSize: '22px', color: rarity.pillText,
    }).setOrigin(0.5);

    const textW = w - 2 * tw - 16;
    const name = this.add.text(0, panelTop + 42, card.name.toUpperCase(), {
      fontFamily: FONT, fontSize: '32px', color: '#ffffff', stroke: '#1a1033', strokeThickness: 8, align: 'center',
      wordWrap: { width: textW },
    }).setOrigin(0.5);
    name.setScale(Math.min(1, textW / name.width, 74 / name.height));
    const desc = this.add.text(0, panelTop + 114, card.desc, {
      fontFamily: FONT, fontSize: '25px', color: cssColor(lerpColor(color, 0xffffff, 0.7)), align: 'center',
      stroke: '#1a1033', strokeThickness: 5, wordWrap: { width: textW }, lineSpacing: -2,
    }).setOrigin(0.5);
    desc.setScale(Math.min(1, textW / desc.width, 70 / desc.height));

    const shimmer = this.add.graphics();
    const parts = [frame, shimmer, pillText, name, desc];

    // "+1 SET" ribbon hanging off the bottom edge.
    if (this.completesSet(card) && typeof SET_BONUSES !== 'undefined' && SET_BONUSES[card.family]) {
      const rib = this.add.graphics();
      const rw = w + 18;
      const ry = h / 2 + 14;
      rib.fillStyle(ART.outline, 1);
      rib.fillRoundedRect(-rw / 2 - 5, ry - 34, rw + 10, 68, 18);
      // Gold reads as 'bonus'; the gold fling family gets a white ribbon so it does not blend in.
      rib.fillStyle(card.family === 'fling' ? 0xffffff : ART.gold, 1);
      rib.fillRoundedRect(-rw / 2, ry - 29, rw, 58, 14);
      rib.fillStyle(0xffffff, 0.45);
      rib.fillRoundedRect(-rw / 2 + 10, ry - 25, rw - 20, 10, 5);
      const ribTop = this.add.text(0, ry - 12, '+1 SET:', {
        fontFamily: FONT, fontSize: '20px', color: '#1a1033',
      }).setOrigin(0.5);
      const ribName = this.add.text(0, ry + 11, SET_BONUSES[card.family].name, {
        fontFamily: FONT, fontSize: '24px', color: cssColor(lerpColor(color, ART.outline, 0.45)),
      }).setOrigin(0.5);
      ribName.setScale(Math.min(1, (rw - 20) / ribName.width));
      parts.push(rib, ribTop, ribName);
      this.tweens.add({ targets: [ribTop, ribName], scale: '*=1.08', yoyo: true, repeat: -1, duration: 420, ease: 'Sine.InOut' });
    }

    const inner = this.add.container(0, 0, parts);
    const box = this.add.container(x, GAME_HEIGHT + h, [inner]);
    box.setSize(w + 14, h + 30);
    box.setInteractive({ useHandCursor: true });
    const entry = { id, card, box, inner, shimmer, rarity: card.rarity, color, baseX: x, baseY: y, index, landed: false };

    // Fly in from below with a flip (scaleX from edge-on), staggered left to right.
    const side = index - (count - 1) / 2;
    box.setAngle(side * -24).setScale(0.2, 0.9);
    this.tweens.add({
      targets: box, y, angle: 0, scaleX: 1, scaleY: 1, delay: 60 + index * 90, duration: 430, ease: 'Back.Out',
      onComplete: () => { entry.landed = true; },
    });

    box.on('pointerdown', () => {
      if (!this.canPick()) return;
      this.pressed = entry;
      this.tweens.killTweensOf(box);
      box.setScale(1.07, 0.92);
    });
    box.on('pointerout', () => {
      if (this.pressed !== entry || this.picked) return;
      this.pressed = null;
      box.setScale(1);
    });
    box.on('pointerup', () => {
      if (this.pressed !== entry) return;
      this.pick(index);
    });
    return entry;
  }

  canPick() {
    return !this.picked && this.elapsed * 1000 > CARD_UI.inputDelay;
  }

  pick(index) {
    if (this.picked || !this.cards[index]) return;
    this.picked = true;
    const chosen = this.cards[index];

    // Chosen card squashes, then zooms up and pops; the others fall away.
    this.tweens.killTweensOf(chosen.box);
    chosen.box.setScale(1.14, 0.84).setAngle(0);
    chosen.box.setDepth(5);
    this.tweens.chain({
      targets: chosen.box,
      tweens: [
        { scaleX: 1.22, scaleY: 1.22, y: chosen.baseY - 50, duration: 150, ease: 'Back.Out' },
        { scaleX: 1.5, scaleY: 1.5, alpha: 0, duration: 170, delay: 30, ease: 'Quad.In' },
      ],
    });
    this.burst(chosen.baseX, chosen.baseY - 50, chosen.color);
    for (const other of this.cards) {
      if (other === chosen) continue;
      this.tweens.killTweensOf(other.box);
      const dir = other.baseX < chosen.baseX ? -1 : 1;
      this.tweens.add({
        targets: other.box, y: GAME_HEIGHT + CARD_UI.height, x: other.baseX + dir * 80, angle: dir * 28, alpha: 0.7,
        duration: 340, ease: 'Cubic.In',
      });
    }
    this.tweens.add({ targets: [this.header, this.subHeader, this.ringText], alpha: 0, duration: 200 });
    this.tweens.add({ targets: this.dim, alpha: 0, delay: 80, duration: 260 });
    this.ringGfx.clear();
    this.time.delayedCall(EXIT_MS, () => {
      this.game.events.emit('cards:picked', chosen.id);
      if (this.scene.isActive()) this.scene.stop();
    });
  }

  // Family-colored shock ring + sparks where the chosen card pops.
  burst(x, y, color) {
    const ring = this.add.circle(x, y, 40).setStrokeStyle(14, color).setDepth(6);
    this.tweens.add({ targets: ring, radius: 260, alpha: 0, duration: 340, ease: 'Cubic.Out', onComplete: () => ring.destroy() });
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const dot = this.add.circle(x, y, i % 2 ? 9 : 13, i % 3 ? color : 0xffffff).setStrokeStyle(3, ART.outline).setDepth(6);
      const d = Phaser.Math.Between(170, 280);
      this.tweens.add({
        targets: dot, x: x + Math.cos(a) * d, y: y + Math.sin(a) * d, scale: 0.2, alpha: 0,
        duration: Phaser.Math.Between(260, 340), ease: 'Cubic.Out', onComplete: () => dot.destroy(),
      });
    }
  }

  update(time, delta) {
    const t = time / 1000;
    this.elapsed += Math.min(delta, 100) / 1000;   // a stalled tab must not eat the countdown
    const left = Math.max(0, this.timeout - this.elapsed);
    for (const c of this.cards) {
      // Gentle idle float once landed (on the inner layer, so it never fights the box tweens).
      c.inner.y = c.landed && !this.picked ? Math.sin(t * 2.6 + c.index * 1.3) * 4 : 0;
      this.drawShimmer(c, t);
    }
    if (this.picked) return;
    this.drawCountdown(left, t);
    // Last seconds: the default card nudges so the auto-pick is no surprise.
    const auto = this.cards[this.autoIndex];
    if (auto && auto.landed && left < CARD_UI.autoWarn && this.pressed !== auto) {
      auto.box.setAngle(Math.sin(t * 22) * 2.2 * (1 - left / CARD_UI.autoWarn));
    }
    if (left <= 0) this.pick(this.autoIndex);
  }

  drawCountdown(left, t) {
    const g = this.ringGfx;
    const { x, y } = this.ringAnchor;
    const frac = left / this.timeout;
    const r = 30;
    const urgent = left < CARD_UI.autoWarn;
    const color = urgent ? 0xff6f5c : 0xffffff;
    const pulse = urgent ? 1 + Math.max(0, Math.sin(t * 14)) * 0.08 : 1;
    g.clear();
    g.fillStyle(ART.outline, 0.9);
    g.fillCircle(x, y, (r + 10) * pulse);
    g.lineStyle(8, 0x3a2a60, 1);
    g.strokeCircle(x, y, r);
    if (frac > 0) {
      g.lineStyle(8, color, 1);
      g.beginPath();
      g.arc(x, y, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * frac, false);
      g.strokePath();
    }
    const label = String(Math.ceil(left));
    if (this.ringText.text !== label) this.ringText.setText(label);
    this.ringText.setScale(pulse);
  }

  // Legendary: a gold glint sweeping across the face + twinkles on the trim. Rare: a soft
  // silver twinkle. Common: nothing.
  drawShimmer(c, t) {
    const g = c.shimmer;
    g.clear();
    if (c.rarity === 'common') return;
    const w = CARD_UI.width;
    const h = CARD_UI.height;
    const tw = CARD_UI.trim;
    if (c.rarity === 'legendary') {
      const cycle = ((t + c.index * 0.4) % 2.4) / 2.4;     // sweep, then rest
      if (cycle < 0.55) {
        const k = cycle / 0.55;
        const cx = -w + k * w * 2;
        const band = [
          { x: cx - 26, y: -h / 2 }, { x: cx + 16, y: -h / 2 }, { x: cx - 64, y: h / 2 }, { x: cx - 106, y: h / 2 },
        ];
        const clipped = clipToRect(band, -w / 2 + tw + 4, -h / 2 + tw + 4, w / 2 - tw - 4, h / 2 - tw - 4);
        if (clipped.length > 2) {
          g.fillStyle(0xffffff, 0.28);
          g.fillPoints(clipped, true);
        }
      }
      const glow = 0.35 + 0.25 * Math.sin(t * 4 + c.index);
      g.lineStyle(6, ART.gold, glow);
      g.strokeRoundedRect(-w / 2 - 12, -h / 2 - 12, w + 24, h + 24, 36);
      const corners = [[-w / 2 + 6, -h / 2 + 40], [w / 2 - 6, -h / 2 + 90], [w / 2 - 8, h / 2 - 50], [-w / 2 + 8, h / 2 - 110]];
      corners.forEach(([x, y], i) => {
        const tw2 = Math.max(0, Math.sin(t * 3.2 + i * 1.7));
        if (tw2 > 0.05) ART.sparkle(g, x, y, 14 * tw2, t, 0xffffff, tw2);
      });
    } else {
      const tw2 = Math.max(0, Math.sin(t * 2.4 + c.index * 2));
      if (tw2 > 0.05) ART.sparkle(g, w / 2 - 8, -h / 2 + 60, 12 * tw2, t, 0xffffff, tw2);
    }
  }
}
