// Overlay scene for score/speed/hints. Lives in its own scene so the game camera can
// zoom out at high speed without shrinking the UI.
//
// Public API used by GameScene:
//   setStats(score, altitude, speed, displaySpeed?)  displaySpeed (km/s) overrides speed / 10
//   setChain(n), revealStats(), setDanger(0..1), setCometScreen(x, y)
//   pop(label, color, opts)   the only pop path; merges / limits / clamps itself
//   flash(color, alpha, duration, maxAlpha?)  alpha capped at 0.12 (maxAlpha may raise it to 0.18)
//   showBanner(title, subtitle, { duration }), showHint(label), hideHint()

// Pop de-clutter rules (see pop()).
const POP = {
  mergeWindow: 250,      // ms: pops closer together than this become one line
  maxVisible: 2,
  top: 270,              // below the stats block (score/alt/chain end around y 245)
  bottomMargin: 300,     // above the hint (y 1040) and the speed/xN band (y ~1130)
  sideMargin: 22,
  minSize: 34,
  maxSize: 76,
  joiner: ' · ',
  maxLabels: 2,          // labels per merged line
  overshoot: 1.12,       // Back.Out scale-in peak; the fit leaves room for it
};

// Higher = more important: decides the merged line's order, color and size.
function popPriority(label) {
  if (/PERFECT/.test(label)) return 4;
  if (/CLOSE CALL/.test(label)) return 3;
  if (/CLOSE ORBIT/.test(label)) return 2;
  return 1;
}

// Bottom HUD panel (speed readout + multiplier badge) bounds, for fading it under the comet.
const HUD_PANEL = { left: 130, right: 650, top: GAME_HEIGHT - 190, bottom: GAME_HEIGHT - 70 };

class HudScene extends Phaser.Scene {
  constructor() {
    super('Hud');
  }

  create() {
    const style = { fontFamily: FONT, color: COLORS.text, stroke: '#1a1033', strokeThickness: 10 };
    // Red glow from the bottom edge that grows as the supernova closes in. Kept to the lower
    // third and capped (~0.4 at the very edge) so it warns without washing the palette out.
    this.danger = this.add.graphics().setAlpha(0);
    for (let i = 0; i < 10; i++) {
      this.danger.fillStyle(0xff3a1f, 0.05);
      this.danger.fillRect(0, GAME_HEIGHT - 30 - i * 36, GAME_WIDTH, 30 + i * 36);
    }
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
    this.panelFade = 1;       // bottom panel alpha (dims when the comet flies behind it)
    this.panelFadeTarget = 1;
    // Last values written to each text, so setText/setColor (which re-render the text texture)
    // only run when something actually changed.
    this.shown = {};
    // Kept ~45px lower than the notch-safe minimum: on 9:16 phones y=72 sat only ~21 CSS px from the top.
    this.chainY = 196;
    // Origin at the left-middle so the count-up bump scales in place.
    this.scoreText = this.add.text(32, 117, '0', { ...style, fontSize: '60px' }).setOrigin(0, 0.5);
    this.altText = this.add.text(34, 155, '0 m', { ...style, fontSize: '32px', color: '#c9bfff', strokeThickness: 8 });
    // Compact: a small tag under the altitude, so it never competes with the pops.
    this.chainText = this.add.text(34, this.chainY, '', { ...style, fontSize: '26px', color: '#ffe14d', strokeThickness: 7 })
      .setOrigin(0, 0).setAlpha(0);
    this.speedBaseX = GAME_WIDTH / 2 - 60;
    this.speedBaseY = GAME_HEIGHT - 130;
    this.speedText = this.add.text(this.speedBaseX, this.speedBaseY, '', { ...style, fontSize: '52px' }).setOrigin(0.5);
    this.createMultiplierBadge();
    this.bottomPanel = this.add.container(0, 0, [this.speedText, this.badge]);
    // One layer for the stats, so the intro fade never fights the bump tweens on its children.
    this.statsLayer = this.add.container(0, 0, [this.scoreText, this.altText, this.bottomPanel]);
    const game = this.scene.get('Game');
    if (game && game.introActive) this.statsLayer.setAlpha(0);
    this.hintText = this.add.text(GAME_WIDTH / 2, GAME_HEIGHT - 240, '', { ...style, fontSize: '44px', color: '#ffe14d' })
      .setOrigin(0.5);
    this.tweens.add({ targets: this.hintText, scale: 1.1, yoyo: true, repeat: -1, duration: 420 });
    this.bannerText = this.add.text(GAME_WIDTH / 2, 400, '', { ...style, fontSize: '84px', color: '#ffe14d', strokeThickness: 14 })
      .setOrigin(0.5).setAlpha(0);
    this.bannerSub = this.add.text(GAME_WIDTH / 2, 480, '', { ...style, fontSize: '34px', strokeThickness: 8 })
      .setOrigin(0.5).setAlpha(0);
    addFullscreenButton(this);
  }

  // "x3" badge: outlined plate with a lighter top band, pulses when the multiplier rises.
  createMultiplierBadge() {
    this.badgePlate = this.add.graphics();
    this.tintBadge(speedColor(0));
    this.badgeText = this.add.text(0, 2, 'x1', {
      fontFamily: FONT, fontSize: '48px', color: '#1a1033',
    }).setOrigin(0.5);
    this.badge = this.add.container(GAME_WIDTH / 2 + 190, GAME_HEIGHT - 130, [this.badgePlate, this.badgeText]);
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
    this.setTextIfChanged('score', this.scoreText, String(Math.floor(this.shownScore)));
    this.updateSpeedReadout(time, dt);
    // Bottom panel eases toward its target alpha, so it does not blink as the comet passes.
    this.panelFade += (this.panelFadeTarget - this.panelFade) * Math.min(1, dt * 10);
    this.bottomPanel.setAlpha(this.panelFade);
  }

  // The number rolls toward the real speed (fast up, a bit slower down) so gains feel like a
  // climb, and shivers with a hot glow near the top of the range.
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
    // Glow steps (not every frame) because setShadow re-renders the text texture.
    const glow = Math.round(hot * 4);
    if (glow !== this.shown.speedGlow) {
      this.shown.speedGlow = glow;
      if (glow > 0) this.speedText.setShadow(0, 0, '#ffe14d', glow * 5, true, true);
      else this.speedText.setShadow(0, 0, '#000000', 0, false, false);
    }
  }

  // displaySpeed (optional, km/s): the number the readout should show; speed drives the colors.
  setStats(score, altitude, speed, displaySpeed) {
    // A big gain in one go (PERFECT chain, close call) gets a bump.
    if (score - this.targetScore >= 100) this.bump(this.scoreText, 1.3);
    this.targetScore = score;
    this.setTextIfChanged('alt', this.altText, altitude + ' m');
    const f = speedFraction(speed);
    this.speedFrac = f;
    this.targetSpeed = displaySpeed !== undefined ? displaySpeed : speed / 10;
    const color = speedColor(f);
    this.setColorIfChanged('speedColor', this.speedText, '#' + color.toString(16).padStart(6, '0'));
    const level = speedMultiplier(speed);
    if (level !== this.lastMultiplier) {
      this.badgeText.setText('x' + level);
      if (level > this.lastMultiplier) this.bump(this.badge, 1.5);
      this.lastMultiplier = level;
    }
    this.setColorIfChanged('badgeColor', this.badgeText, level >= 4 ? '#c2410c' : '#1a1033');
    this.tintBadge(color);
  }

  // Comet position in screen space (GameScene, every frame). Near the bottom panel the panel
  // dims so the comet stays visible behind it.
  setCometScreen(x, y) {
    const dx = Math.max(HUD_PANEL.left - x, 0, x - HUD_PANEL.right);
    const dy = Math.max(HUD_PANEL.top - y, 0, y - HUD_PANEL.bottom);
    const near = Math.hypot(dx, dy) < 140;
    this.panelFadeTarget = near ? 0.35 : 1;
  }

  // Graphics cannot be tinted, so redraw the plate color only when it changes.
  tintBadge(color) {
    if (color === this.badgeColor) return;
    this.badgeColor = color;
    const w = 124;
    const h = 84;
    const g = this.badgePlate;
    g.clear();
    g.fillStyle(0x1a1033, 1);
    g.fillRoundedRect(-w / 2 - 6, -h / 2 - 6, w + 12, h + 12, 24);
    g.fillStyle(color, 1);
    g.fillRoundedRect(-w / 2, -h / 2, w, h, 18);
    g.fillStyle(0xffffff, 0.35);
    g.fillRoundedRect(-w / 2 + 8, -h / 2 + 6, w - 16, h * 0.32, 10);
  }

  // Current PERFECT chain (0 hides it).
  setChain(chain) {
    if (!this.chainText) return;
    const previous = this.chain;
    this.chain = chain;
    if (chain >= 2) {
      this.tweens.killTweensOf(this.chainText);
      this.chainText.setText('PERFECT CHAIN x' + chain).setAlpha(1).setY(this.chainY);
      this.chainText.setColor(chain >= 5 ? '#ffffff' : '#ffe14d');
      this.chainText.setScale(1.2);
      this.tweens.add({ targets: this.chainText, scale: 1, duration: 200, ease: 'Back.Out' });
    } else if (previous >= 2) {
      // Chain broken: drop and fade.
      this.tweens.killTweensOf(this.chainText);
      this.chainText.setText('CHAIN LOST').setColor('#ff4d6d').setScale(1).setY(this.chainY);
      this.tweens.add({
        targets: this.chainText, alpha: 0, y: this.chainY + 14, duration: 500,
        onComplete: () => this.chainText.setY(this.chainY),
      });
    }
    // chain 0/1 after 0/1: nothing to show, and a running 'CHAIN LOST' fade is left to finish.
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
  // the stats block and the bottom HUD band.
  pop(label, color, opts) {
    opts = opts || {};
    const now = this.time.now;
    const entry = {
      label, color,
      priority: popPriority(label),
      size: Phaser.Math.Clamp(opts.size || 40, POP.minSize, POP.maxSize),
      stroke: opts.stroke || '#1a1033',
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
    const t = this.add.text(0, 0, '', { fontFamily: FONT, fontSize: entry.size + 'px', color }).setOrigin(0.5);
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
    t.setStroke(lead.stroke, Math.round(size / 5));
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
      bottom: hasSub ? this.bannerSub.y + this.bannerSub.height / 2 : this.bannerText.y + titleHalf,
    };
  }

  // opts.duration: ms fully visible before the fade (default 1400).
  showBanner(title, subtitle, opts) {
    const hold = opts && opts.duration !== undefined ? opts.duration : 1400;
    this.bannerText.setText(title).setScale(1).setAlpha(1);
    const fit = Math.min(1, (GAME_WIDTH - 60) / this.bannerText.width);
    this.bannerFit = fit;
    this.bannerText.setScale(fit * 0.4);
    this.bannerSub.setText(subtitle || '').setAlpha(1);
    this.tweens.killTweensOf([this.bannerText, this.bannerSub]);
    this.tweens.add({ targets: this.bannerText, scale: fit, duration: 300, ease: 'Back.Out' });
    // Pops already sitting in the banner's band make way.
    const band = this.bannerBand();
    for (const p of this.pops.slice()) {
      const half = (p.height * p.scaleY) / 2;
      if (p.y + half > band.top && p.y - half < band.bottom) this.removePop(p);
    }
    this.tweens.add({ targets: [this.bannerText, this.bannerSub], alpha: 0, delay: hold, duration: 400 });
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
