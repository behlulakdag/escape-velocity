// Overlay scene for score/speed/hints. Lives in its own scene so the game camera can
// zoom out at high speed without shrinking the UI.
// Sketchbook look: the score is written on a small taped paper note; speed is written straight
// on the page with a crayon underline that grows with speed; the multiplier is a circled "x3".
//
// Public API used by GameScene:
//   setStats(score, altitude, speed, displaySpeed?)  displaySpeed (km/s) overrides speed / 10
//   setChain(n), revealStats(), setDanger(0..1), setCometScreen(x, y)
//   pop(label, color, opts)   the only pop path; merges / limits / clamps itself
//   flash(color, alpha, duration, maxAlpha?)  alpha capped at 0.12 (maxAlpha may raise it to 0.18)
//   showBanner(title, subtitle, { duration }), showHint(label), hideHint()
//   setCards(ownedIds)        row of owned upgrade-card badges (top right, under fullscreen)
//   showSetBonus(familyKey)   family-colored SET BONUS banner (SET_BONUSES in src/cards.js)
//   scoreText / hintText are read by GameScene, so they stay Text objects.

// Pop de-clutter rules (see pop()).
const POP = {
  mergeWindow: 250,      // ms: pops closer together than this become one line
  maxVisible: 2,
  top: 270,              // below the stats note (note + chain line end around y 245)
  bottomMargin: 300,     // above the hint (y 1040) and the speed/xN band (y ~1130)
  sideMargin: 22,
  minSize: 34,
  maxSize: 76,
  joiner: ' · ',
  maxLabels: 2,          // labels per merged line
  overshoot: 1.12,       // Back.Out scale-in peak; the fit leaves room for it
};

// Pop color in crayon: the old neon pop colors and the card family colors map to their crayons.
function hudPopColor(color) {
  if (typeof CARD_FAMILIES !== 'undefined' && typeof cardCrayon === 'function') {
    for (const key in CARD_FAMILIES) {
      if (uiColorHex(CARD_FAMILIES[key].color) === String(color).toLowerCase()) return uiColorHex(cardCrayon(key));
    }
  }
  return uiCrayonHex(color);
}

// Higher = more important: decides the merged line's order, color and size.
function popPriority(label) {
  if (/PERFECT/.test(label)) return 4;
  if (/CLOSE CALL/.test(label)) return 3;
  if (/CLOSE ORBIT/.test(label)) return 2;
  return 1;
}

// Bottom HUD band (speed readout + multiplier) bounds, for fading it under the comet.
const HUD_PANEL = { left: 130, right: 650, top: GAME_HEIGHT - 190, bottom: GAME_HEIGHT - 70 };
const HUD_SPEED = { x: 300, y: GAME_HEIGHT - 140, lineY: GAME_HEIGHT - 100, minLine: 70, maxLine: 330 };
// Multiplier circle tint by level (x1..x5): the same warm ramp as the comet.
const HUD_LEVEL_TINTS = [UI_INK.cream, UI_CRAYON.yellow, UI_CRAYON.orange, UI_CRAYON.red, UI_CRAYON.pink];

class HudScene extends Phaser.Scene {
  constructor() {
    super('Hud');
  }

  create() {
    uiMakeHudTextures(this);
    // Red crayon scribble along the bottom edge that thickens as the supernova closes in.
    this.danger = uiBoilImage(this, GAME_WIDTH / 2, GAME_HEIGHT, 'hud_danger').setOrigin(0.5, 1).setTint(UI_CRAYON.red).setAlpha(0);
    // Soft full-screen flash (PERFECT / close call). Very light, so the palette never goes pale.
    this.flashRect = this.add.rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT, 0xffffff).setOrigin(0).setAlpha(0);
    this.targetScore = 0;
    this.shownScore = 0;
    this.targetSpeed = 0;     // km/s shown by the readout, counted toward smoothly
    this.shownSpeed = 0;
    this.speedFrac = 0;
    this.lastMultiplier = 1;
    this.chain = 0;
    this.pops = [];           // visible pops, oldest first
    this.panelFade = 1;       // bottom band alpha (dims when the comet flies behind it)
    this.panelFadeTarget = 1;
    this.lightPage = false;   // true on the cream ESCAPE VELOCITY page: page ink turns dark
    // Last values written to each text, so setText/setColor (which re-render the text texture)
    // only run when something actually changed.
    this.shown = {};
    this.chainY = 228;

    // Taped note (top-left, below the notch-safe line): score big, altitude under it.
    const note = uiBoilImage(this, 0, 0, 'hud_note');
    this.scoreText = this.add.text(-112, -16, '0', { fontFamily: FONT, fontSize: '64px', color: UI_INK.darkHex })
      .setOrigin(0, 0.5);
    this.altText = this.add.text(-108, 40, '0 m', { fontFamily: FONT, fontSize: '30px', color: UI_INK.pencilDarkHex })
      .setOrigin(0, 0.5);
    this.note = this.add.container(160, 142, [note, this.scoreText, this.altText]).setRotation(-0.035);
    uiBoilRotation(this, this.note, 0.006);
    this.chainText = uiInkText(this, 40, this.chainY, '', { size: 28, color: uiColorHex(UI_CRAYON.yellow), ox: 0, oy: 0, rot: 0.02 })
      .setAlpha(0);

    // Speed written on the page, with a crayon underline (redrawn only on boil ticks / growth).
    this.speedLine = this.add.graphics();
    this.speedBaseX = HUD_SPEED.x;
    this.speedBaseY = HUD_SPEED.y;
    this.speedText = uiInkText(this, this.speedBaseX, this.speedBaseY, '', { size: 54, rot: -0.03, boil: false });
    this.createMultiplierBadge();
    this.bottomPanel = this.add.container(0, 0, [this.speedLine, this.speedText, this.badge]);
    // One layer for the stats, so the intro fade never fights the bump tweens on its children.
    this.statsLayer = this.add.container(0, 0, [this.note, this.bottomPanel]);
    const game = this.scene.get('Game');
    if (game && game.introActive) this.statsLayer.setAlpha(0);
    this.hintText = uiInkText(this, GAME_WIDTH / 2, GAME_HEIGHT - 240, '', { size: 46, color: uiColorHex(UI_CRAYON.yellow), rot: -0.03 });
    this.tweens.add({ targets: this.hintText, scale: 1.08, yoyo: true, repeat: -1, duration: 420 });
    // Banner: off-register crayon copy behind the ink title, a scribbled underline, a subtitle.
    this.bannerShadow = this.add.text(GAME_WIDTH / 2 + 6, 407, '', { fontFamily: FONT, fontSize: '84px', color: uiColorHex(UI_CRAYON.orange) })
      .setOrigin(0.5).setAlpha(0).setRotation(-0.035);
    this.bannerText = this.add.text(GAME_WIDTH / 2, 400, '', {
      fontFamily: FONT, fontSize: '84px', color: UI_INK.creamHex, stroke: UI_INK.darkHex, strokeThickness: 10,
    }).setOrigin(0.5).setAlpha(0).setRotation(-0.035);
    this.bannerLine = uiBoilImage(this, GAME_WIDTH / 2 + 8, 452, 'ui_underline').setTint(UI_CRAYON.orange).setAlpha(0).setRotation(-0.02);
    this.bannerSub = uiInkText(this, GAME_WIDTH / 2, 492, '', { size: 34, rot: 0.015 }).setAlpha(0);
    this.cardBadges = [];      // { id, gfx } per owned card, left to right
    this.setBonusLayer = null;
    addFullscreenButton(this);
    uiOnBoil(this, (v, tick) => { this.boilTick = tick; this.drawSpeedLine(true); });
  }

  // Owned upgrade cards as small taped index-card scraps, right-aligned under the fullscreen
  // button (clear of the score note on the left). New cards are slapped on with an ink burst;
  // cards whose family set is complete get a gold crayon loop.
  setCards(ownedIds) {
    const ids = (ownedIds || []).filter(id => typeof cardById === 'function' && cardById(id));
    const gap = 66;
    const y = 214;
    const right = GAME_WIDTH - 62;
    const sets = typeof activeSetBonuses === 'function' ? activeSetBonuses(ids) : [];
    const known = this.cardBadges.map(b => b.id);
    for (const b of this.cardBadges) b.gfx.destroy();
    this.cardBadges = [];
    ids.forEach((id, i) => {
      const card = cardById(id);
      const x = right - (ids.length - 1 - i) * gap;
      const mini = cardMakeMini(this, 0, 0, id, 0.84);
      const parts = [mini];
      if (sets.indexOf(card.family) >= 0) {
        parts.unshift(uiBoilImage(this, 0, 0, cardSetLoopTexture(this)));
      }
      const g = this.add.container(x, y, parts);
      this.cardBadges.push({ id, gfx: g });
      if (known.indexOf(id) < 0) {
        g.setScale(1.8).setAlpha(0);
        this.tweens.add({ targets: g, scale: 1, alpha: 1, duration: 220, delay: 120, ease: 'Quad.In',
          onComplete: () => {
            g.setScale(1.12, 0.86);
            this.tweens.add({ targets: g, scaleX: 1, scaleY: 1, duration: 200, ease: 'Back.Out' });
            cardDoodleBurst(this, x, y, [cardCrayon(card.family), UI_INK.cream], { count: 6, reach: 90 });
          } });
      }
    });
  }

  // Set bonus moment: the set name lettered big in the family crayon between its two cards,
  // below the zone banner band.
  showSetBonus(familyKey) {
    if (typeof SET_BONUSES === 'undefined' || !SET_BONUSES[familyKey]) return;
    const bonus = SET_BONUSES[familyKey];
    const crayon = cardCrayon(familyKey);
    const y = 610;
    if (this.setBonusLayer) this.setBonusLayer.destroy();
    const label = uiInkText(this, 0, -82, 'SET BONUS!', { size: 40, color: uiColorHex(UI_CRAYON.yellow), rot: -0.05 });
    const title = uiTitleText(this, 0, 0, bonus.name, { size: 78, color: uiColorHex(crayon), shadowColor: UI_INK.darkHex, rot: -0.03 });
    const titleW = title.main.width;
    title.setScale(Math.min(1, (GAME_WIDTH - 250) / titleW));
    const line = uiBoilImage(this, 6, 50, 'ui_underline').setTint(crayon).setScale(Math.min(1, (titleW * title.scaleX + 30) / 540), 0.8);
    const sub = uiInkText(this, 0, 92, bonus.desc, { size: 34, rot: 0.015 });
    sub.setScale(Math.min(1, (GAME_WIDTH - 60) / sub.width));
    // The two family cards that made the set flank the title, each wiggling in place.
    const owned = this.cardBadges.map(b => b.id);
    const shown = (typeof CARDS !== 'undefined' ? CARDS : []).filter(c => c.family === familyKey && owned.indexOf(c.id) >= 0);
    const bx = (titleW * title.scaleX) / 2 + 58;
    const minis = shown.slice(0, 2).map((c, i) => cardMakeMini(this, i ? bx : -bx, 0, c.id, 1.25));
    const layer = this.add.container(GAME_WIDTH / 2, y, [...minis, line, label, title, sub]).setScale(0.3).setAlpha(1);
    this.setBonusLayer = layer;
    this.tweens.add({ targets: layer, scale: 1, duration: 360, ease: 'Back.Out' });
    if (minis.length) this.tweens.add({ targets: minis, angle: { from: -10, to: 10 }, yoyo: true, repeat: -1, duration: 260, ease: 'Sine.InOut' });
    this.tweens.add({
      targets: layer, alpha: 0, y: y - 40, delay: 1700, duration: 400,
      onComplete: () => { if (this.setBonusLayer === layer) this.setBonusLayer = null; layer.destroy(); },
    });
    cardDoodleBurst(this, GAME_WIDTH / 2, y, [crayon, UI_CRAYON.yellow, UI_INK.cream], { count: 14, reach: 300, squashY: 0.6 });
    this.flash(crayon, 0.1, 220);
    // Pops in the banner's band make way, as for zone banners.
    for (const p of this.pops.slice()) {
      if (Math.abs(p.y - y) < 140) this.removePop(p);
    }
  }

  // "x3" written on the page inside a crayon circle that pulses when the multiplier rises.
  createMultiplierBadge() {
    this.badgeCircle = uiBoilImage(this, 0, 0, 'ui_circle').setScale(0.62, 0.78).setTint(HUD_LEVEL_TINTS[0]);
    this.badgeText = uiInkText(this, 0, 0, 'x1', { size: 50, rot: 0.06, boil: false });
    this.badge = this.add.container(GAME_WIDTH / 2 + 205, HUD_SPEED.y + 4, [this.badgeCircle, this.badgeText]);
    uiBoilRotation(this, this.badge, 0.02);
  }

  // Score, altitude, speed and badge fade in when the comet launches (hidden during the intro).
  revealStats() {
    if (!this.statsLayer || this.statsLayer.alpha >= 1) return;
    this.tweens.add({ targets: this.statsLayer, alpha: 1, duration: 450, ease: 'Sine.Out' });
  }

  // setText/setColor only when the value differs from what is already shown.
  setTextIfChanged(key, textObject, value) {
    if (this.shown[key] === value) return;
    this.shown[key] = value;
    textObject.setText(value);
  }

  setColorIfChanged(key, textObject, color) {
    if (this.shown[key] === color) return;
    this.shown[key] = color;
    textObject.setColor(color);
  }

  update(time, delta) {
    if (!this.scoreText) return;
    // Count up smoothly; never lag far behind on big jumps.
    const dt = Math.min(delta / 1000, 0.05);
    const gap = this.targetScore - this.shownScore;
    if (gap > 0) {
      this.shownScore = Math.min(this.targetScore, this.shownScore + Math.max(1, gap * Math.min(1, dt * 9)));
    } else {
      this.shownScore = this.targetScore;
    }
    const scoreString = String(Math.floor(this.shownScore));
    if (scoreString.length !== this.shown.scoreLength) {
      // Long scores get a smaller pen so they stay on the note.
      this.shown.scoreLength = scoreString.length;
      this.scoreText.setFontSize(scoreString.length <= 5 ? 64 : scoreString.length === 6 ? 54 : 46);
    }
    this.setTextIfChanged('score', this.scoreText, scoreString);
    this.updateSpeedReadout(time, dt);
    this.updatePageInk();
    // Bottom band eases toward its target alpha, so it does not blink as the comet passes.
    // The card pick's countdown ring sits over the speed band, so the band steps back meanwhile.
    const fadeTarget = this.scene.isActive('Cards') ? 0.12 : this.panelFadeTarget;
    this.panelFade += (fadeTarget - this.panelFade) * Math.min(1, dt * 10);
    this.bottomPanel.setAlpha(this.panelFade);
  }

  // On the cream last page the gel-pen ink would vanish, so page-written text switches to dark ink.
  updatePageInk() {
    const game = this.scene.get('Game');
    const zone = game && typeof game.zoneIndex === 'number' ? game.zoneIndex : 0;
    const light = !!(UI_PAPERS[zone] && UI_PAPERS[zone].light);
    if (light === this.lightPage) return;
    this.lightPage = light;
    const ink = light ? UI_INK.darkHex : UI_INK.creamHex;
    const edge = light ? UI_INK.creamHex : UI_INK.darkHex;
    for (const t of [this.speedText, this.badgeText, this.bannerText, this.bannerSub]) t.setColor(ink).setStroke(edge, t.style.strokeThickness);
    this.badgeCircle.setTint(light && this.lastMultiplier === 1 ? UI_INK.dark : HUD_LEVEL_TINTS[this.lastMultiplier - 1]);
    this.drawSpeedLine(true);
  }

  // The number rolls toward the real speed (fast up, a bit slower down) so gains feel like a
  // climb, and the handwriting shivers near the top of the range.
  updateSpeedReadout(time, dt) {
    const gap = this.targetSpeed - this.shownSpeed;
    const rate = gap > 0 ? 8 : 5;
    if (Math.abs(gap) < 0.5) this.shownSpeed = this.targetSpeed;
    else this.shownSpeed += gap * Math.min(1, dt * rate);
    this.setTextIfChanged('speed', this.speedText, Math.round(this.shownSpeed) + ' km/s');
    const f = this.speedFrac;
    const hot = Math.max(0, (f - 0.6) / 0.4);   // 0 below 60% of max, 1 at max
    const climbing = gap > 3 ? 0.06 : 0;
    this.speedText.setScale(1 + f * 0.12 + climbing);
    const shake = hot * 3.5;
    this.speedText.setPosition(
      this.speedBaseX + (shake ? Math.sin(time * 0.09) * shake : 0),
      this.speedBaseY + (shake ? Math.cos(time * 0.113) * shake * 0.6 : 0),
    );
    this.drawSpeedLine(false);
  }

  // Crayon underline whose length tracks speed, plus "zip" dashes trailing the number when fast.
  // Redrawn only when the length moved a few px or the boil clock ticked (force).
  drawSpeedLine(force) {
    if (!this.speedLine) return;
    const f = this.speedFrac;
    const len = HUD_SPEED.minLine + (HUD_SPEED.maxLine - HUD_SPEED.minLine) * f;
    if (!force && Math.abs(len - (this.lineLen || 0)) < 3) return;
    this.lineLen = len;
    const g = this.speedLine;
    const seed = this.boilTick || 0;
    const color = speedColor(f);
    const x0 = HUD_SPEED.x - 150;
    g.clear();
    uiScribbleLine(g, x0, HUD_SPEED.lineY, x0 + len, HUD_SPEED.lineY - len * 0.03, seed, { width: 7, color, amp: 2.5 });
    if (f > 0.45) {
      const ink = this.lightPage ? UI_INK.dark : UI_INK.cream;
      const marks = 1 + Math.floor((f - 0.45) / 0.18);
      for (let i = 0; i < marks; i++) {
        const y = HUD_SPEED.y - 24 + i * 22;
        const x = x0 - 18 - (i % 2) * 14;
        uiScribbleLine(g, x - 46 + i * 6, y, x, y - 3, seed + i * 7, { width: 4, color: ink, amp: 1.2, passes: 1 });
      }
    }
  }

  // displaySpeed (optional, km/s): the number the readout should show; speed drives the colors.
  setStats(score, altitude, speed, displaySpeed) {
    // A big gain in one go (PERFECT chain, close call) gets a bump.
    if (score - this.targetScore >= 100) this.bump(this.scoreText, 1.3);
    this.targetScore = score;
    this.setTextIfChanged('alt', this.altText, altitude + ' m');
    this.speedFrac = speedFraction(speed);
    this.targetSpeed = displaySpeed !== undefined ? displaySpeed : speed / 10;
    const level = speedMultiplier(speed);
    if (level !== this.lastMultiplier) {
      this.badgeText.setText('x' + level);
      this.badgeCircle.setTint(this.lightPage && level === 1 ? UI_INK.dark : HUD_LEVEL_TINTS[level - 1]);
      if (level > this.lastMultiplier) this.bump(this.badge, 1.5);
      this.lastMultiplier = level;
    }
  }

  // Comet position in screen space (GameScene, every frame). Near the bottom band the band
  // dims so the comet stays visible behind it.
  setCometScreen(x, y) {
    const dx = Math.max(HUD_PANEL.left - x, 0, x - HUD_PANEL.right);
    const dy = Math.max(HUD_PANEL.top - y, 0, y - HUD_PANEL.bottom);
    const near = Math.hypot(dx, dy) < 140;
    this.panelFadeTarget = near ? 0.35 : 1;
  }

  // Current PERFECT chain (0 hides it).
  setChain(chain) {
    if (!this.chainText) return;
    const previous = this.chain;
    this.chain = chain;
    if (chain >= 2) {
      this.tweens.killTweensOf(this.chainText);
      this.chainText.setText('perfect chain x' + chain).setAlpha(1).setY(this.chainY);
      this.chainText.setColor(chain >= 5 ? UI_INK.creamHex : uiColorHex(UI_CRAYON.yellow));
      this.chainText.setScale(1.2);
      this.tweens.add({ targets: this.chainText, scale: 1, duration: 200, ease: 'Back.Out' });
    } else if (previous >= 2) {
      // Chain broken: drop and fade.
      this.tweens.killTweensOf(this.chainText);
      this.chainText.setText('chain lost').setColor(uiColorHex(UI_CRAYON.red)).setScale(1).setY(this.chainY);
      this.tweens.add({
        targets: this.chainText, alpha: 0, y: this.chainY + 14, duration: 500,
        onComplete: () => this.chainText.setY(this.chainY),
      });
    }
    // chain 0/1 after 0/1: nothing to show, and a running 'chain lost' fade is left to finish.
  }

  bump(target, scale) {
    this.tweens.killTweensOf(target);
    target.setScale(scale);
    this.tweens.add({ targets: target, scale: 1, duration: 300, ease: 'Back.Out' });
  }

  // Light screen flash. alpha is capped at maxAlpha (default 0.12, never above 0.18) so it
  // tints the screen for a beat instead of washing it out.
  flash(color, alpha, duration, maxAlpha) {
    if (!this.flashRect) return;
    const cap = Math.min(0.18, maxAlpha || 0.12);
    this.tweens.killTweensOf(this.flashRect);
    this.flashRect.setFillStyle(color).setAlpha(Math.min(cap, alpha === undefined ? cap : alpha));
    this.tweens.add({ targets: this.flashRect, alpha: 0, duration: duration || 150, ease: 'Quad.Out' });
  }

  // Screen-space pop text. opts: { x, y, size, stroke, duration (ms) }.
  // De-clutter: pops within POP.mergeWindow of the newest one merge into it ('PERFECT x3! · +SPEED',
  // most important first); at most POP.maxVisible lines; always fully on screen and kept between
  // the stats note and the bottom HUD band. Written in crayon with a slight random tilt.
  pop(label, color, opts) {
    opts = opts || {};
    const now = this.time.now;
    const entry = {
      label,
      color: hudPopColor(color),
      priority: popPriority(label),
      size: Phaser.Math.Clamp(opts.size || 40, POP.minSize, POP.maxSize),
      stroke: uiCrayonHex(opts.stroke || UI_INK.darkHex),
    };
    const duration = Math.max(450, opts.duration || 700);
    const newest = this.pops[this.pops.length - 1];
    if (newest && newest.active && now - newest.bornAt < POP.mergeWindow) {
      // Same label again just refreshes it; otherwise keep only the two most important labels.
      if (!newest.entries.some(e => e.label === label)) newest.entries.push(entry);
      newest.entries.sort((a, b) => b.priority - a.priority);
      newest.entries.length = Math.min(newest.entries.length, POP.maxLabels);
      newest.lifetime = Math.max(newest.lifetime, duration);
      this.renderPop(newest);
      this.placePop(newest, newest.anchorX, newest.anchorY);
      this.animatePop(newest, true);
      return;
    }
    // Make room: the oldest pops fade out fast; the one left stops rising (so it never drifts
    // into the new line) and bows out early.
    while (this.pops.length >= POP.maxVisible) this.removePop(this.pops[0]);
    for (const older of this.pops) this.retirePop(older);
    const t = this.add.text(0, 0, '', { fontFamily: FONT, fontSize: entry.size + 'px', color: entry.color }).setOrigin(0.5);
    t.setRotation((Math.random() - 0.5) * 0.12);
    t.entries = [entry];
    t.bornAt = now;
    t.lifetime = duration;
    t.anchorX = opts.x === undefined ? GAME_WIDTH / 2 : opts.x;
    t.anchorY = opts.y === undefined ? GAME_HEIGHT / 2 : opts.y;
    this.renderPop(t);
    this.placePop(t, t.anchorX, t.anchorY);
    this.pops.push(t);
    this.animatePop(t, false);
  }

  // Text, size and color come from the most important entry; the line shrinks to fit the width.
  renderPop(t) {
    const lead = t.entries[0];
    // Merged lines grow a little, but the lead entry sets the scale (PERFECT chains are biggest).
    const size = Math.min(POP.maxSize, lead.size + (t.entries.length > 1 ? 4 : 0));
    t.setText(t.entries.map(e => e.label).join(POP.joiner));
    t.setFontSize(size);
    t.setColor(lead.color);
    t.setStroke(lead.stroke, Math.round(size / 6));
    const room = GAME_WIDTH - POP.sideMargin * 2;
    t.fitScale = Math.min(1, room / (t.width * POP.overshoot));
  }

  placePop(t, ax, ay) {
    const halfW = (t.width * t.fitScale * POP.overshoot) / 2;
    const halfH = (t.height * t.fitScale * POP.overshoot) / 2;
    const top = POP.top + halfH;
    const bottom = GAME_HEIGHT - POP.bottomMargin - halfH;
    const want = Phaser.Math.Clamp(ay, top, bottom);
    // Bands this pop must not cover: the other visible pop and a readable banner.
    const blocked = [];
    const other = this.pops.find(p => p !== t && p.active);
    if (other) {
      const otherHalf = (other.height * other.fitScale * POP.overshoot) / 2;
      blocked.push({ top: other.y - otherHalf, bottom: other.y + otherHalf });
    }
    const band = this.bannerBand();
    if (band) blocked.push(band);
    const clear = (y) => y >= top - 0.5 && y <= bottom + 0.5
      && blocked.every(b => y + halfH + 6 <= b.top || y - halfH - 6 >= b.bottom);
    // Candidates: where it wants to be, then just above / below each blocked band; nearest clear wins.
    const candidates = [want];
    for (const b of blocked) candidates.push(b.top - halfH - 7, b.bottom + halfH + 7);
    let y = null;
    for (const c of candidates) {
      if (clear(c) && (y === null || Math.abs(c - want) < Math.abs(y - want))) y = c;
    }
    if (y === null) {
      // No free spot (rare): this line wins and the older pop leaves now.
      y = want;
      if (other) this.removePop(other);
    }
    t.setPosition(Phaser.Math.Clamp(ax, POP.sideMargin + halfW, GAME_WIDTH - POP.sideMargin - halfW), y);
    t.baseY = y;
  }

  // Punchy: scale in over 120ms, hold, then a short rise + fade (the rise never reaches the stats).
  animatePop(t, merged) {
    this.tweens.killTweensOf(t);
    const s = t.fitScale;
    t.setAlpha(1).setY(t.baseY).setScale(merged ? s * POP.overshoot : s * 0.45);
    this.tweens.add({ targets: t, scale: s, duration: 120, ease: merged ? 'Quad.Out' : 'Back.Out' });
    const hold = t.lifetime * 0.55;
    const halfH = (t.height * s) / 2;
    let rise = Math.max(0, Math.min(36, t.baseY - halfH - (POP.top - 20)));
    // Never rise into the other pop or a banner that sits just above.
    const above = this.pops.filter(p => p !== t && p.active && p.y < t.baseY)
      .map(p => p.y + (p.height * p.fitScale) / 2);
    const band = this.bannerBand();
    if (band && band.bottom <= t.baseY) above.push(band.bottom);
    for (const edge of above) rise = Math.min(rise, Math.max(0, t.baseY - halfH - edge - 6));
    this.tweens.add({
      targets: t, y: t.baseY - rise, alpha: 0, delay: hold, duration: t.lifetime - hold, ease: 'Quad.In',
      onComplete: () => this.removePop(t),
    });
  }

  retirePop(t) {
    if (!t.active || t.retired) return;
    t.retired = true;
    this.tweens.killTweensOf(t);
    t.setScale(t.fitScale);
    this.tweens.add({ targets: t, alpha: 0, delay: 120, duration: 220, onComplete: () => this.removePop(t) });
  }

  removePop(t) {
    const i = this.pops.indexOf(t);
    if (i >= 0) this.pops.splice(i, 1);
    if (t.active) t.destroy();
  }

  // Screen band covered by the banner (title + subtitle) while it is readable, else null.
  bannerBand() {
    if (!this.bannerText || this.bannerText.alpha < 0.15) return null;
    // Final scale, not the current one: the title may still be scaling in.
    const titleHalf = (this.bannerText.height * (this.bannerFit || 1)) / 2;
    const hasSub = this.bannerSub.text && this.bannerSub.alpha > 0.15;
    return {
      top: this.bannerText.y - titleHalf,
      bottom: hasSub ? this.bannerSub.y + this.bannerSub.height / 2 : this.bannerText.y + titleHalf + 30,
    };
  }

  // opts.duration: ms fully visible before the fade (default 1400).
  showBanner(title, subtitle, opts) {
    const hold = opts && opts.duration !== undefined ? opts.duration : 1400;
    const parts = [this.bannerText, this.bannerShadow, this.bannerSub, this.bannerLine];
    this.tweens.killTweensOf(parts);
    this.bannerText.setText(title).setScale(1).setAlpha(1);
    this.bannerShadow.setText(title).setAlpha(1);
    const fit = Math.min(1, (GAME_WIDTH - 60) / this.bannerText.width);
    this.bannerFit = fit;
    this.bannerText.setScale(fit * 0.4);
    this.bannerShadow.setScale(fit * 0.4);
    this.bannerSub.setText(subtitle || '').setAlpha(1);
    // The underline is scrawled in after the title lands.
    this.bannerLine.setAlpha(1).setScale(0, 1);
    this.tweens.add({ targets: [this.bannerText, this.bannerShadow], scale: fit, duration: 300, ease: 'Back.Out' });
    this.tweens.add({ targets: this.bannerLine, scaleX: Math.min(1.05, (this.bannerText.width * fit + 40) / 540), duration: 220, delay: 200, ease: 'Quad.Out' });
    // Pops already sitting in the banner's band make way.
    const band = this.bannerBand();
    for (const p of this.pops.slice()) {
      const half = (p.height * p.scaleY) / 2;
      if (p.y + half > band.top && p.y - half < band.bottom) this.removePop(p);
    }
    this.tweens.add({ targets: parts, alpha: 0, delay: hold, duration: 400 });
  }

  setDanger(level) {
    const pulse = 0.85 + Math.sin(this.time.now / 90) * 0.15;
    this.danger.setAlpha(Math.max(0, Math.min(1, level)) * pulse);
  }

  showHint(label) {
    this.hintHiding = false;
    if (this.hintFade) this.hintFade.stop();   // only the fade: the pulse tween keeps running
    this.hintFade = null;
    this.hintText.setText(label).setAlpha(1);
  }

  // Fast fade (150ms) so a hint never outlives the action it describes.
  hideHint() {
    if (this.hintHiding || this.hintText.alpha === 0) return;
    this.hintHiding = true;
    this.hintFade = this.tweens.add({ targets: this.hintText, alpha: 0, duration: 150 });
  }
}

// HUD-only doodle textures (built once per game; existing keys are skipped).
function uiMakeHudTextures(scene) {
  uiCircleTexture(scene);
  uiUnderlineTexture(scene);
  // Small cream note with faint rule lines, a soft shadow and a strip of tape.
  uiSketchTexture(scene, 'hud_note', 290, 180, (ctx, shape, jitter) => {
    const corners = [
      { x: 20 + shape() * 6, y: 26 + shape() * 4 }, { x: 268 - shape() * 6, y: 22 + shape() * 4 },
      { x: 272 - shape() * 4, y: 160 - shape() * 6 }, { x: 18 + shape() * 4, y: 164 - shape() * 4 },
    ];
    // Slightly curled bottom-right corner: an extra point pulled in.
    const page = [corners[0], corners[1], corners[2], { x: 140, y: 162 + (jitter() - 0.5) * 1.5 }, corners[3]];
    uiTracePath(ctx, page.map((p) => ({ x: p.x + 5, y: p.y + 7 })), true);
    ctx.fillStyle = 'rgba(5,6,16,0.4)';
    ctx.fill();
    uiTracePath(ctx, page, true);
    ctx.fillStyle = uiCss(UI_CRAYON.note);
    ctx.fill();
    ctx.save();
    uiTracePath(ctx, page, true);
    ctx.clip();
    ctx.strokeStyle = 'rgba(90,135,200,0.35)';
    ctx.lineWidth = 2;
    for (const y of [70, 112, 150]) {
      ctx.beginPath();
      ctx.moveTo(0, y + (shape() - 0.5) * 2);
      ctx.lineTo(290, y + (shape() - 0.5) * 3);
      ctx.stroke();
    }
    for (let i = 0; i < 50; i++) {
      const x = shape() * 290;
      const y = shape() * 180;
      ctx.strokeStyle = 'rgba(120,95,50,0.12)';
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + (shape() - 0.5) * 24, y + (shape() - 0.5) * 10);
      ctx.stroke();
    }
    ctx.restore();
    // Straight edge (uiStroke would round a 5-point outline into a blob).
    uiTracePath(ctx, page, true);
    ctx.strokeStyle = 'rgba(138,122,90,0.5)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    // Tape across the top edge.
    ctx.save();
    ctx.translate(150, 26);
    ctx.rotate(-0.08 + (shape() - 0.5) * 0.04);
    const tape = [];
    for (let i = 0; i <= 3; i++) tape.push({ x: 48 + (i % 2 ? 5 : 0), y: -13 + i * 8.7 });
    for (let i = 3; i >= 0; i--) tape.push({ x: -48 - (i % 2 ? 4 : 0), y: -13 + i * 8.7 });
    uiTracePath(ctx, tape, true);
    ctx.fillStyle = 'rgba(240,232,190,0.6)';
    ctx.fill();
    ctx.restore();
  });
  // Crayon scribble that is dense at the bottom edge and thins out upward (white, tinted red).
  uiSketchTexture(scene, 'hud_danger', GAME_WIDTH, 300, (ctx, shape, jitter) => {
    ctx.lineCap = 'round';
    for (let i = 0; i < 520; i++) {
      const depth = Math.pow(shape(), 2.2);           // 0 = bottom edge
      const x = shape() * GAME_WIDTH + (jitter() - 0.5) * 6;
      const y = 300 - depth * 300 + (jitter() - 0.5) * 6;
      const len = 20 + shape() * 46;
      ctx.globalAlpha = (1 - depth) * (0.25 + shape() * 0.35);
      ctx.lineWidth = 3 + shape() * 3;
      ctx.strokeStyle = '#ffffff';
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + len * 0.55, y - len * 0.8);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  });
}
