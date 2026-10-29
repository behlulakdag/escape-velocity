// Asset'leri yüklediğin sahne. Themed loading bar: a little comet rides the progress edge.
class BootScene extends Phaser.Scene {
  constructor() {
    super('Boot');
  }

  preload() {
    this.cameras.main.setBackgroundColor(ZONES[0].sky);
    const barW = 480;
    const barH = 36;
    const x0 = GAME_WIDTH / 2 - barW / 2;
    const y = GAME_HEIGHT / 2;
    this.add.text(GAME_WIDTH / 2, y - 110, 'ESCAPE VELOCITY', {
      fontFamily: FONT, fontSize: '54px', color: '#ffe14d', stroke: '#1a1033', strokeThickness: 12,
    }).setOrigin(0.5);
    const g = this.add.graphics();
    const drawBar = (p) => {
      g.clear();
      g.fillStyle(0x1a1033, 1);
      g.fillRoundedRect(x0 - 8, y - barH / 2 - 8, barW + 16, barH + 16, 26);
      g.fillStyle(0x3d2b78, 1);
      g.fillRoundedRect(x0, y - barH / 2, barW, barH, 18);
      const w = Math.max(barH, barW * p);
      g.fillStyle(0xff9a2e, 1);
      g.fillRoundedRect(x0, y - barH / 2, w, barH, 18);
      g.fillStyle(0xffe14d, 1);
      g.fillRoundedRect(x0 + 6, y - barH / 2 + 5, w - 12, barH * 0.35, 8);
      // Comet head at the leading edge.
      g.fillStyle(0x1a1033, 1);
      g.fillCircle(x0 + w, y, 30);
      g.fillStyle(0xffe14d, 1);
      g.fillCircle(x0 + w, y, 25);
      g.fillStyle(0xfffbe8, 1);
      g.fillCircle(x0 + w + 3, y, 17);
    };
    drawBar(0);
    this.load.on('progress', drawBar);

    // ===== ASSET'LERİ BURAYA EKLE =====
    // (Everything is code-drawn or synthesized right now.)
  }

  create() {
    // Generate the background textures once so every scene can reuse them.
    if (!this.textures.exists('stars')) ART.makeStarTexture(this, 'stars');
    this.scene.start('Menu');
  }
}
