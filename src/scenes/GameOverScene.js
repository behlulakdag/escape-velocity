// Game over: the supernova happily chomps the comet at the bottom while the score counts up.
class GameOverScene extends Phaser.Scene {
  constructor() {
    super('GameOver');
  }

  init(data) {
    this.finalScore = data.score || 0;
    this.reason = data.reason || 'GAME OVER';
    this.altitude = data.altitude || 0;
    this.newBestAltitude = !!data.newBestAltitude;
    this.bestAltitude = Math.max(data.bestAltitude || 0, this.altitude);
    this.cards = (data.cards || []).filter(id => typeof CARDS !== 'undefined' && CARDS.some(c => c.id === id));
    // The run's card list sits under MENU, so the chomping supernova moves down to make room.
    this.novaY = this.cards.length ? 1080 : 1010;
  }

  create() {
    const cx = GAME_WIDTH / 2;
    const previousBest = loadHighScore();
    const isRecord = saveHighScore(this.finalScore);
    this.cameras.main.setBackgroundColor(0x3a1850);
    addStarLayers(this);
    this.novaGfx = this.add.graphics();
    this.cometGfx = this.add.graphics();
    this.comet = { x: cx, y: 1000, vx: 0, vy: -1 };

    const stroke = { stroke: '#1a1033', strokeThickness: 12 };
    const reason = this.add.text(cx, 235, this.reason, {
      fontFamily: FONT, fontSize: '80px', color: '#ff6f5c', ...stroke, strokeThickness: 16,
    }).setOrigin(0.5).setShadow(0, 8, '#1a1033', 0, true, true).setScale(0);
    this.tweens.add({ targets: reason, scale: 1, duration: 450, ease: 'Back.easeOut' });

    this.add.text(cx, 330, 'SCORE', { fontFamily: FONT, fontSize: '34px', color: '#c9bfff', ...stroke, strokeThickness: 8 })
      .setOrigin(0.5);
    const scoreText = this.add.text(cx, 405, '0', { fontFamily: FONT, fontSize: '112px', color: '#ffffff', ...stroke, strokeThickness: 16 })
      .setOrigin(0.5);
    const counter = { value: 0 };
    this.tweens.add({
      targets: counter, value: this.finalScore, duration: Math.min(900, 300 + this.finalScore / 20), ease: 'Cubic.easeOut',
      onUpdate: () => scoreText.setText(String(Math.floor(counter.value))),
      onComplete: () => {
        scoreText.setText(String(this.finalScore));
        this.tweens.add({ targets: scoreText, scale: 1.12, yoyo: true, duration: 120 });
      },
    });

    const bestLine = this.add.text(cx, 500, isRecord ? 'NEW BEST!' : 'BEST  ' + Math.max(previousBest, this.finalScore), {
      fontFamily: FONT, fontSize: isRecord ? '56px' : '40px', color: isRecord ? '#ffe14d' : '#ffffff', ...stroke, strokeThickness: 10,
    }).setOrigin(0.5);
    if (isRecord) {
      this.tweens.add({ targets: bestLine, scale: 1.12, angle: 3, yoyo: true, repeat: -1, duration: 380, ease: 'Sine.easeInOut' });
      this.time.delayedCall(500, () => {
        // A new best altitude already played the fanfare mid-run (flag pass), so a run gets at most one.
        if (!this.newBestAltitude) this.game.events.emit('sfx', 'newbest', {});
        for (let i = 0; i < 14; i++) this.confetti(cx, 500);
      });
    }
    this.add.text(cx, 560, 'ALTITUDE  ' + this.altitude + ' m', {
      fontFamily: FONT, fontSize: '32px', color: '#9ff3ff', ...stroke, strokeThickness: 8,
    }).setOrigin(0.5);
    // Green matches the in-game best-altitude flag and its "NEW BEST!" pop.
    const altBest = this.add.text(cx, 600, this.newBestAltitude ? 'NEW BEST ALTITUDE!' : 'BEST  ' + this.bestAltitude + ' m', {
      fontFamily: FONT, fontSize: this.newBestAltitude ? '30px' : '26px', color: this.newBestAltitude ? '#5eff8f' : '#c9bfff',
      ...stroke, strokeThickness: 7,
    }).setOrigin(0.5);
    if (this.newBestAltitude) {
      this.tweens.add({ targets: altBest, scale: 1.08, yoyo: true, repeat: -1, duration: 420, ease: 'Sine.easeInOut' });
    }

    const retry = () => this.scene.start('Game', { skipIntro: true });   // instant restart: no intro
    makeButton(this, cx, 715, 'RETRY', retry, { width: 460, height: 140, fontSize: '68px' });
    makeButton(this, cx, 875, 'MENU', () => this.scene.start('Menu'), {
      color: 0x9ff3ff, width: 320, height: 104, fontSize: '44px',
    });
    if (this.cards.length) this.showRunCards(980);
    makeMuteButton(this, 92, 116);
    addFullscreenButton(this);
    this.input.keyboard.on('keydown-SPACE', retry);
  }

  // The run's upgrade cards: family-colored badges with their names, popping in one by one.
  showRunCards(y) {
    const n = this.cards.length;
    const slot = Math.min(140, (GAME_WIDTH - 40) / n);
    const size = n > 5 ? 44 : 54;
    const sets = typeof activeSetBonuses === 'function' ? activeSetBonuses(this.cards) : [];
    this.cards.forEach((id, i) => {
      const card = CARDS.find(c => c.id === id);
      const color = CARD_FAMILIES[card.family].color;
      const x = GAME_WIDTH / 2 + (i - (n - 1) / 2) * slot;
      const g = this.add.graphics();
      if (sets.indexOf(card.family) >= 0) {
        g.fillStyle(0x1a1033, 1);
        g.fillCircle(0, 2, size / 2 + 10);
        g.fillStyle(ART.gold, 1);
        g.fillCircle(0, 0, size / 2 + 6);
      }
      ART.drawCardBadge(g, card.icon, 0, 0, size, color);
      const name = this.add.text(0, size / 2 + 20, card.name.toUpperCase(), {
        fontFamily: FONT, fontSize: '22px', color: '#' + lerpColor(color, 0xffffff, 0.45).toString(16).padStart(6, '0'),
        stroke: '#1a1033', strokeThickness: 6, align: 'center', wordWrap: { width: slot - 10 }, lineSpacing: -4,
      }).setOrigin(0.5, 0.5);
      name.setScale(Math.min(1, (slot - 8) / name.width));
      const item = this.add.container(x, y, [g, name]).setScale(0);
      this.tweens.add({ targets: item, scale: 1, delay: 650 + i * 90, duration: 320, ease: 'Back.Out' });
    });
  }

  confetti(x, y) {
    const colors = [0xffe14d, 0xff6fb5, 0x5eff8f, 0x9ff3ff, 0xffffff];
    const piece = this.add.rectangle(x, y, 14, 22, Phaser.Utils.Array.GetRandom(colors)).setStrokeStyle(3, 0x1a1033);
    const a = Math.random() * Math.PI * 2;
    const d = Phaser.Math.Between(140, 300);
    this.tweens.add({
      targets: piece, x: x + Math.cos(a) * d, y: y + Math.sin(a) * d * 0.6 + 120, angle: Phaser.Math.Between(-360, 360),
      alpha: 0, duration: Phaser.Math.Between(700, 1100), ease: 'Cubic.easeOut', onComplete: () => piece.destroy(),
    });
  }

  update(time, delta) {
    const t = time / 1000;
    scrollStarLayers(this, delta, 0.02);
    // The comet is caught in the supernova's mouth (drawn after the nova so it sits over the teeth).
    const novaY = this.novaY;
    this.comet.x = GAME_WIDTH / 2 + Math.sin(t * 1.7) * 12;
    this.comet.y = novaY + 118 + Math.sin(t * 2.4) * 6 + Math.sin(t * 9) * 3;
    const ctx = {
      time: t, comet: this.comet, speed: 900, speedFraction: 0.6, orbitPlanet: null,
      isHolding: false, danger: 1, stretch: 1, perfectChain: 0, closeCall: 0,
    };
    this.novaGfx.clear();
    ART.drawNova(this.novaGfx, novaY, { left: 0, right: GAME_WIDTH, top: 0, bottom: GAME_HEIGHT }, ctx);
    this.cometGfx.clear();
    ART.drawComet(this.cometGfx, this.comet, [], ctx);
  }
}
