class MenuScene extends Phaser.Scene {
  constructor() {
    super('Menu');
  }

  create() {
    const cx = GAME_WIDTH / 2;

    this.add.text(cx, 380, 'GAME TITLE', {
      fontFamily: FONT,
      fontSize: '88px',
      color: COLORS.text,
      align: 'center',
    }).setOrigin(0.5);

    this.add.text(cx, 480, 'Slapjam #2', {
      fontFamily: FONT,
      fontSize: '36px',
      color: '#ffc83d',
    }).setOrigin(0.5);

    const best = loadHighScore();
    if (best > 0) {
      this.add.text(cx, 600, 'BEST: ' + best, {
        fontFamily: FONT,
        fontSize: '40px',
        color: COLORS.text,
      }).setOrigin(0.5);
    }

    makeButton(this, cx, 800, 'PLAY', () => this.scene.start('Game'));

    this.add.text(cx, 1150, 'Drag left / right to dodge', {
      fontFamily: FONT,
      fontSize: '30px',
      color: '#bbbbbb',
    }).setOrigin(0.5);

    addFullscreenButton(this);
  }
}
