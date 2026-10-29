class GameOverScene extends Phaser.Scene {
  constructor() {
    super('GameOver');
  }

  init(data) {
    this.finalScore = data.score || 0;
    this.reason = data.reason || 'GAME OVER';
    this.altitude = data.altitude || 0;
  }

  create() {
    const cx = GAME_WIDTH / 2;
    const isRecord = saveHighScore(this.finalScore);

    this.add.text(cx, 360, this.reason, {
      fontFamily: FONT,
      fontSize: '76px',
      color: '#ff4d6d',
    }).setOrigin(0.5);

    this.add.text(cx, 460, this.altitude + ' m', {
      fontFamily: FONT,
      fontSize: '36px',
      color: '#c9bfff',
    }).setOrigin(0.5);

    this.add.text(cx, 530, String(this.finalScore), {
      fontFamily: FONT,
      fontSize: '60px',
      color: COLORS.text,
    }).setOrigin(0.5);

    this.add.text(cx, 610, isRecord ? 'NEW BEST!' : 'BEST: ' + loadHighScore(), {
      fontFamily: FONT,
      fontSize: '40px',
      color: isRecord ? '#ffc83d' : '#bbbbbb',
    }).setOrigin(0.5);

    makeButton(this, cx, 820, 'RETRY', () => this.scene.start('Game'));
    makeButton(this, cx, 980, 'MENU', () => this.scene.start('Menu'), {
      color: 0xffffff,
      height: 100,
      fontSize: '44px',
    });

    addFullscreenButton(this);
  }
}
