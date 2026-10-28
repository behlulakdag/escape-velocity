// Asset'leri yüklediğin sahne. Yükleme çubuğu hazır.
class BootScene extends Phaser.Scene {
  constructor() {
    super('Boot');
  }

  preload() {
    // Yükleme çubuğu
    const barW = 480;
    const box = this.add.rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, barW + 8, 40, 0xffffff, 0.2);
    const bar = this.add.rectangle(GAME_WIDTH / 2 - barW / 2, GAME_HEIGHT / 2, 0, 32, COLORS.primary).setOrigin(0, 0.5);
    this.load.on('progress', (p) => { bar.width = barW * p; });

    // ===== ASSET'LERİ BURAYA EKLE =====
    // this.load.image('player', 'assets/player.png');
    // this.load.spritesheet('hero', 'assets/hero.png', { frameWidth: 64, frameHeight: 64 });
    // this.load.audio('music', 'assets/music.mp3');
    // this.load.audio('hit', 'assets/hit.mp3');
  }

  create() {
    this.scene.start('Menu');
  }
}
