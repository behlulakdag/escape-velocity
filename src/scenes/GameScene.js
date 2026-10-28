// ÖRNEK OYUN: yukarıdan düşen engellerden kaç.
// Tek mekanik: parmağını sürükle, karakter yatayda takip etsin.
// Tema gelince bu dosyanın içini değiştireceksin; iskelet (skor, zorluk artışı, oyun sonu) kalabilir.
class GameScene extends Phaser.Scene {
  constructor() {
    super('Game');
  }

  create() {
    this.score = 0;
    this.isOver = false;
    this.spawnDelay = 900;      // ms, zamanla azalır
    this.fallSpeed = 500;       // px/s, zamanla artar

    // Oyuncu (şimdilik dikdörtgen; asset gelince this.physics.add.sprite ile değiştir)
    this.player = this.add.rectangle(GAME_WIDTH / 2, GAME_HEIGHT - 200, 90, 90, COLORS.player);
    this.physics.add.existing(this.player);
    this.player.body.setCollideWorldBounds(true);
    this.player.body.setAllowGravity(false);
    this.targetX = this.player.x;

    // Engeller
    this.obstacles = this.physics.add.group();
    this.physics.add.overlap(this.player, this.obstacles, () => this.gameOver());

    // Dokunmatik + fare: parmak nerede, karakter oraya kayar
    this.input.on('pointerdown', (p) => { this.targetX = p.x; });
    this.input.on('pointermove', (p) => { if (p.isDown) this.targetX = p.x; });

    // Klavye (masaüstünde test için)
    this.cursors = this.input.keyboard.createCursorKeys();

    // Skor yazısı
    this.scoreText = this.add.text(32, 24, '0', {
      fontFamily: FONT,
      fontSize: '64px',
      color: COLORS.text,
    }).setDepth(100);

    // Skor her 0.1 saniyede 1 artar (hayatta kalma süresi)
    this.time.addEvent({
      delay: 100,
      loop: true,
      callback: () => {
        if (this.isOver) return;
        this.score += 1;
        this.scoreText.setText(this.score);
      },
    });

    this.scheduleSpawn();
    addFullscreenButton(this);
  }

  scheduleSpawn() {
    this.time.delayedCall(this.spawnDelay, () => {
      if (this.isOver) return;
      this.spawnObstacle();
      // Zorluk artışı
      this.spawnDelay = Math.max(300, this.spawnDelay - 15);
      this.fallSpeed = Math.min(1400, this.fallSpeed + 8);
      this.scheduleSpawn();
    });
  }

  spawnObstacle() {
    const size = Phaser.Math.Between(70, 140);
    const x = Phaser.Math.Between(size / 2, GAME_WIDTH - size / 2);
    const ob = this.add.rectangle(x, -size, size, size, COLORS.accent);
    this.obstacles.add(ob);
    ob.body.setAllowGravity(false);
    ob.body.setVelocityY(this.fallSpeed);
  }

  update(time, delta) {
    if (this.isOver) return;

    // Klavye kontrolü
    if (this.cursors.left.isDown) this.targetX -= 0.9 * delta;
    if (this.cursors.right.isDown) this.targetX += 0.9 * delta;
    this.targetX = Phaser.Math.Clamp(this.targetX, 45, GAME_WIDTH - 45);

    // Yumuşak takip (lerp): "oyun hissi" için önemli
    this.player.x = Phaser.Math.Linear(this.player.x, this.targetX, 0.25);

    // Ekrandan çıkan engelleri temizle
    this.obstacles.getChildren().forEach((ob) => {
      if (ob.y > GAME_HEIGHT + 200) ob.destroy();
    });
  }

  gameOver() {
    if (this.isOver) return;
    this.isOver = true;
    this.physics.pause();

    // "Juice": sarsıntı + flaş
    this.cameras.main.shake(250, 0.015);
    this.cameras.main.flash(150, 255, 77, 109);

    this.time.delayedCall(700, () => {
      this.scene.start('GameOver', { score: this.score });
    });
  }
}
