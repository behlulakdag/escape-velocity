// Phaser yapılandırması: dikey 720x1280, ekrana sığacak şekilde ölçeklenir.
const config = {
  type: Phaser.AUTO,
  parent: 'game',
  backgroundColor: COLORS.background,
  width: GAME_WIDTH,
  height: GAME_HEIGHT,
  scale: {
    mode: Phaser.Scale.FIT,              // oranı koruyarak sığdır
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  physics: {
    default: 'arcade',
    arcade: {
      gravity: { y: 0 },
      debug: false,                       // çarpışma kutularını görmek için true yap
    },
  },
  input: {
    activePointers: 2,                    // çoklu dokunma gerekirse artır
  },
  scene: [BootScene, MenuScene, GameScene, HudScene, GameOverScene, CardScene, ShopScene, JournalScene, PauseScene],
};

const game = new Phaser.Game(config);
