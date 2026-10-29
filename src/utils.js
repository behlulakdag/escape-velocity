// Küçük yardımcılar: buton, yüksek skor, tam ekran.

// Dokunmatik dostu buton (min. 100px yükseklik önerilir)
function makeButton(scene, x, y, label, onClick, opts = {}) {
  const w = opts.width || 420;
  const h = opts.height || 120;
  const color = opts.color !== undefined ? opts.color : COLORS.primary;

  const bg = scene.add.rectangle(0, 0, w, h, color).setStrokeStyle(6, 0x000000, 0.25);
  const txt = scene.add.text(0, 0, label, {
    fontFamily: FONT,
    fontSize: opts.fontSize || '52px',
    color: opts.textColor || COLORS.textDark,
  }).setOrigin(0.5);

  const btn = scene.add.container(x, y, [bg, txt]);
  btn.setSize(w, h);
  btn.setInteractive({ useHandCursor: true });

  btn.on('pointerdown', () => btn.setScale(0.94));
  btn.on('pointerout', () => btn.setScale(1));
  btn.on('pointerup', () => {
    btn.setScale(1);
    scene.game.events.emit('sfx', 'click', {});
    onClick();
  });
  return btn;
}

// localStorage bazı ortamlarda (gizli sekme, iframe) hata fırlatabilir: try/catch şart
function loadHighScore() {
  try {
    return parseInt(localStorage.getItem(STORAGE_KEY), 10) || 0;
  } catch (e) {
    return 0;
  }
}

function saveHighScore(score) {
  try {
    if (score > loadHighScore()) {
      localStorage.setItem(STORAGE_KEY, String(score));
      return true; // yeni rekor
    }
  } catch (e) { /* sessizce geç */ }
  return false;
}

// Sağ üst köşeye tam ekran butonu
function addFullscreenButton(scene) {
  const btn = scene.add.text(GAME_WIDTH - 24, 24, '⛶', {
    fontFamily: FONT,
    fontSize: '56px',
    color: COLORS.text,
  }).setOrigin(1, 0).setInteractive({ useHandCursor: true }).setDepth(1000);

  btn.on('pointerup', () => {
    if (scene.scale.isFullscreen) {
      scene.scale.stopFullscreen();
    } else {
      scene.scale.startFullscreen();
    }
  });
  return btn;
}
