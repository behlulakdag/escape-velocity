// Overlay scene for score/speed/hints. Lives in its own scene so the game camera can
// zoom out at high speed without shrinking the UI.
class HudScene extends Phaser.Scene {
  constructor() {
    super('Hud');
  }

  create() {
    const style = { fontFamily: FONT, color: COLORS.text, stroke: '#1a1033', strokeThickness: 10 };
    this.scoreText = this.add.text(32, 40, '0', { ...style, fontSize: '60px' });
    this.altText = this.add.text(34, 110, '0 m', { ...style, fontSize: '32px', color: '#c9bfff', strokeThickness: 8 });
    this.speedText = this.add.text(GAME_WIDTH / 2, GAME_HEIGHT - 130, '', { ...style, fontSize: '64px' }).setOrigin(0.5);
    this.hintText = this.add.text(GAME_WIDTH / 2, GAME_HEIGHT - 240, '', { ...style, fontSize: '44px', color: '#ffe14d' })
      .setOrigin(0.5);
    this.tweens.add({ targets: this.hintText, scale: 1.1, yoyo: true, repeat: -1, duration: 420 });
    addFullscreenButton(this);
  }

  setStats(score, altitude, speed) {
    this.scoreText.setText(score);
    this.altText.setText(altitude + ' m');
    const f = speedFraction(speed);
    this.speedText.setText(Math.round(speed / 10) + ' km/s');
    this.speedText.setColor('#' + speedColor(f).toString(16).padStart(6, '0'));
    this.speedText.setScale(1 + f * 0.35);
  }

  showHint(label) {
    this.hintText.setText(label).setAlpha(1);
  }

  hideHint() {
    this.tweens.add({ targets: this.hintText, alpha: 0, duration: 400 });
  }
}
