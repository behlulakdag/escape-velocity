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
    this.scoreText = this.add.text(32, 40, '0', { ...style, fontSize: '60px' });
    this.altText = this.add.text(34, 110, '0 m', { ...style, fontSize: '32px', color: '#c9bfff', strokeThickness: 8 });
    this.speedText = this.add.text(GAME_WIDTH / 2, GAME_HEIGHT - 130, '', { ...style, fontSize: '56px' }).setOrigin(0.5);
    this.hintText = this.add.text(GAME_WIDTH / 2, GAME_HEIGHT - 240, '', { ...style, fontSize: '44px', color: '#ffe14d' })
      .setOrigin(0.5);
    this.tweens.add({ targets: this.hintText, scale: 1.1, yoyo: true, repeat: -1, duration: 420 });
    this.bannerText = this.add.text(GAME_WIDTH / 2, 400, '', { ...style, fontSize: '84px', color: '#ffe14d', strokeThickness: 14 })
      .setOrigin(0.5).setAlpha(0);
    this.bannerSub = this.add.text(GAME_WIDTH / 2, 480, '', { ...style, fontSize: '34px', strokeThickness: 8 })
      .setOrigin(0.5).setAlpha(0);
    addFullscreenButton(this);
  }

  setStats(score, altitude, speed) {
    this.scoreText.setText(score);
    this.altText.setText(altitude + ' m');
    const f = speedFraction(speed);
    this.speedText.setText(Math.round(speed / 10) + ' km/s  x' + speedMultiplier(speed));
    this.speedText.setColor('#' + speedColor(f).toString(16).padStart(6, '0'));
    this.speedText.setScale(1 + f * 0.15);
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
