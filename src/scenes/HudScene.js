// Overlay scene for score/speed/hints. Lives in its own scene so the game camera can
// zoom out at high speed without shrinking the UI.
class HudScene extends Phaser.Scene {
  constructor() {
    super('Hud');
  }

  create() {
    const style = { fontFamily: FONT, color: COLORS.text, stroke: '#1a1033', strokeThickness: 10 };
    // Red glow from the bottom edge that grows as the supernova closes in.
    this.danger = this.add.graphics().setAlpha(0);
    for (let i = 0; i < 12; i++) {
      this.danger.fillStyle(0xff3a1f, 0.07);
      this.danger.fillRect(0, GAME_HEIGHT - 40 - i * 40, GAME_WIDTH, 40 + i * 40);
    }
    // Soft full-screen flash (PERFECT / close call). A light overlay, so the comet stays visible.
    this.flashRect = this.add.rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT, 0xffffff).setOrigin(0).setAlpha(0);
    this.targetScore = 0;
    this.shownScore = 0;
    this.lastMultiplier = 1;
    this.chain = 0;
    this.lastPop = null;
    // Last values written to each text, so setText/setColor (which re-render the text texture)
    // only run when something actually changed.
    this.shown = {};
    // Kept ~45px lower than the notch-safe minimum: on 9:16 phones y=72 sat only ~21 CSS px from the top.
    this.chainY = 201;
    // Origin at the left-middle so the count-up bump scales in place.
    this.scoreText = this.add.text(32, 117, '0', { ...style, fontSize: '60px' }).setOrigin(0, 0.5);
    this.altText = this.add.text(34, 155, '0 m', { ...style, fontSize: '32px', color: '#c9bfff', strokeThickness: 8 });
    this.chainText = this.add.text(34, this.chainY, '', { ...style, fontSize: '36px', color: '#ffe14d', strokeThickness: 8 })
      .setOrigin(0, 0).setAlpha(0);
    this.speedText = this.add.text(GAME_WIDTH / 2 - 60, GAME_HEIGHT - 130, '', { ...style, fontSize: '52px' }).setOrigin(0.5);
    this.createMultiplierBadge();
    // One layer for the stats, so the intro fade never fights the bump tweens on its children.
    this.statsLayer = this.add.container(0, 0, [this.scoreText, this.altText, this.speedText, this.badge]);
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
  }

  setStats(score, altitude, speed) {
    // A big gain in one go (PERFECT chain, close call) gets a bump.
    if (score - this.targetScore >= 100) this.bump(this.scoreText, 1.3);
    this.targetScore = score;
    this.setTextIfChanged('alt', this.altText, altitude + ' m');
    const f = speedFraction(speed);
    const color = speedColor(f);
    this.setTextIfChanged('speed', this.speedText, Math.round(speed / 10) + ' km/s');
    this.setColorIfChanged('speedColor', this.speedText, '#' + color.toString(16).padStart(6, '0'));
    this.speedText.setScale(1 + f * 0.15);
    const level = speedMultiplier(speed);
    if (level !== this.lastMultiplier) {
      this.badgeText.setText('x' + level);
      if (level > this.lastMultiplier) this.bump(this.badge, 1.5);
      this.lastMultiplier = level;
    }
    this.setColorIfChanged('badgeColor', this.badgeText, level >= 4 ? '#c2410c' : '#1a1033');
    this.tintBadge(color);
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
      this.chainText.setScale(1.5);
      this.tweens.add({ targets: this.chainText, scale: 1, duration: 260, ease: 'Back.Out' });
    } else if (previous >= 2) {
      // Chain broken: drop and fade.
      this.tweens.killTweensOf(this.chainText);
      this.chainText.setText('CHAIN LOST').setColor('#ff4d6d').setScale(1).setY(this.chainY);
      this.tweens.add({
        targets: this.chainText, alpha: 0, y: this.chainY + 20, duration: 600,
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

  // Light screen flash: alpha is capped so it never becomes a solid frame.
  flash(color, alpha, duration) {
    if (!this.flashRect) return;
    this.tweens.killTweensOf(this.flashRect);
    this.flashRect.setFillStyle(color).setAlpha(Math.min(0.35, alpha));
    this.tweens.add({ targets: this.flashRect, alpha: 0, duration: duration || 150, ease: 'Quad.Out' });
  }

  // Screen-space pop text. opts: { x, y, size, stroke, duration (ms) }.
  // Kept between the score block and the bottom HUD band, and never stacked on the previous pop.
  pop(label, color, opts) {
    const size = opts.size || 40;
    const t = this.add.text(0, 0, label, {
      fontFamily: FONT, fontSize: size + 'px', color, stroke: opts.stroke || '#1a1033', strokeThickness: Math.round(size / 5),
    }).setOrigin(0.5).setScale(0.4);
    const top = 250 + t.height / 2;
    const bottom = GAME_HEIGHT - 260 - t.height / 2;
    let y = Phaser.Math.Clamp(opts.y, top, bottom);
    const prev = this.lastPop;
    if (prev && prev.active) {
      // A fresh previous pop stays readable: put the new one just above it. An older one makes way.
      if (this.time.now - prev.bornAt < 300 && Math.abs(prev.y - y) < (prev.height + t.height) / 2) {
        y = prev.y - (prev.height + t.height) / 2 - 6;
        if (y < top) y = Math.min(bottom, prev.y + (prev.height + t.height) / 2 + 6);
      } else {
        this.tweens.killTweensOf(prev);
        this.tweens.add({ targets: prev, alpha: 0, y: prev.y - 30, duration: 120, onComplete: () => prev.destroy() });
      }
    }
    t.setPosition(Phaser.Math.Clamp(opts.x, t.width / 2 + 10, GAME_WIDTH - t.width / 2 - 10), y);
    t.bornAt = this.time.now;
    this.lastPop = t;
    const duration = opts.duration || 700;
    this.tweens.add({ targets: t, scale: 1, duration: 160, ease: 'Back.Out' });
    this.tweens.add({ targets: t, y: y - 70, alpha: 0, delay: duration * 0.35, duration: duration * 0.65, onComplete: () => t.destroy() });
  }

  showBanner(title, subtitle) {
    this.bannerText.setText(title).setScale(1).setAlpha(1);
    const fit = Math.min(1, (GAME_WIDTH - 60) / this.bannerText.width);
    this.bannerText.setScale(fit * 0.4);
    this.bannerSub.setText(subtitle).setAlpha(1);
    this.tweens.killTweensOf([this.bannerText, this.bannerSub]);
    this.tweens.add({ targets: this.bannerText, scale: fit, duration: 350, ease: 'Back.Out' });
    this.tweens.add({ targets: [this.bannerText, this.bannerSub], alpha: 0, delay: 1400, duration: 500 });
  }

  setDanger(level) {
    const pulse = 0.85 + Math.sin(this.time.now / 90) * 0.15;
    this.danger.setAlpha(Math.max(0, Math.min(1, level)) * pulse);
  }

  showHint(label) {
    this.hintText.setText(label).setAlpha(1);
  }

  hideHint() {
    this.tweens.add({ targets: this.hintText, alpha: 0, duration: 400 });
  }
}
