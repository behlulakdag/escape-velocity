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
    this.targetScore = 0;
    this.shownScore = 0;
    this.lastMultiplier = 1;
    this.chain = 0;
    // Origin at the left-middle so the count-up bump scales in place.
    this.scoreText = this.add.text(32, 72, '0', { ...style, fontSize: '60px' }).setOrigin(0, 0.5);
    this.altText = this.add.text(34, 110, '0 m', { ...style, fontSize: '32px', color: '#c9bfff', strokeThickness: 8 });
    this.chainText = this.add.text(34, 156, '', { ...style, fontSize: '36px', color: '#ffe14d', strokeThickness: 8 })
      .setOrigin(0, 0).setAlpha(0);
    this.speedText = this.add.text(GAME_WIDTH / 2 - 60, GAME_HEIGHT - 130, '', { ...style, fontSize: '52px' }).setOrigin(0.5);
    this.createMultiplierBadge();
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
    this.scoreText.setText(Math.floor(this.shownScore));
  }

  setStats(score, altitude, speed) {
    // A big gain in one go (PERFECT chain, close call) gets a bump.
    if (score - this.targetScore >= 100) this.bump(this.scoreText, 1.3);
    this.targetScore = score;
    this.altText.setText(altitude + ' m');
    const f = speedFraction(speed);
    const color = speedColor(f);
    this.speedText.setText(Math.round(speed / 10) + ' km/s');
    this.speedText.setColor('#' + color.toString(16).padStart(6, '0'));
    this.speedText.setScale(1 + f * 0.15);
    const level = speedMultiplier(speed);
    if (level !== this.lastMultiplier) {
      this.badgeText.setText('x' + level);
      if (level > this.lastMultiplier) this.bump(this.badge, 1.5);
      this.lastMultiplier = level;
    }
    this.badgeText.setColor(level >= 4 ? '#c2410c' : '#1a1033');
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
    this.tweens.killTweensOf(this.chainText);
    if (chain >= 2) {
      this.chainText.setText('PERFECT CHAIN x' + chain).setAlpha(1);
      this.chainText.setColor(chain >= 5 ? '#ffffff' : '#ffe14d');
      this.chainText.setScale(1.5);
      this.tweens.add({ targets: this.chainText, scale: 1, duration: 260, ease: 'Back.Out' });
    } else if (previous >= 2) {
      // Chain broken: drop and fade.
      this.chainText.setText('CHAIN LOST').setColor('#ff4d6d').setScale(1);
      this.tweens.add({ targets: this.chainText, alpha: 0, y: 176, duration: 600, onComplete: () => this.chainText.setY(156) });
    }
  }

  bump(target, scale) {
    this.tweens.killTweensOf(target);
    target.setScale(scale);
    this.tweens.add({ targets: target, scale: 1, duration: 300, ease: 'Back.Out' });
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
