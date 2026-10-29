// Küçük yardımcılar: buton, yüksek skor, tam ekran, ses aç/kapa.

// Draws a chunky cartoon button face: dark outline, darker "lip" underneath, face, shine stripe.
function drawButtonFace(g, w, h, color, pressed) {
  const radius = Math.min(36, h * 0.32);
  const lip = pressed ? 4 : 12;
  const dark = lerpColor(color, 0x1a1033, 0.45);
  const shine = lerpColor(color, 0xffffff, 0.5);
  g.clear();
  g.fillStyle(0x000000, 0.25);
  g.fillRoundedRect(-w / 2 + 6, -h / 2 + 18, w, h, radius);
  g.fillStyle(0x1a1033, 1);
  g.fillRoundedRect(-w / 2 - 7, -h / 2 - 7, w + 14, h + 14 + 12, radius + 6);
  g.fillStyle(dark, 1);
  g.fillRoundedRect(-w / 2, -h / 2 + 12, w, h, radius);
  const top = -h / 2 + (12 - lip);
  g.fillStyle(color, 1);
  g.fillRoundedRect(-w / 2, top, w, h, radius);
  g.fillStyle(shine, 0.8);
  g.fillRoundedRect(-w / 2 + 18, top + 10, w - 36, h * 0.2, Math.min(12, h * 0.1));
  return top + h / 2;   // vertical center of the face, where the label sits
}

// Dokunmatik dostu buton (min. 100px yükseklik önerilir)
function makeButton(scene, x, y, label, onClick, opts = {}) {
  const w = opts.width || 420;
  const h = opts.height || 120;
  const color = opts.color !== undefined ? opts.color : COLORS.primary;

  const bg = scene.add.graphics();
  const txt = scene.add.text(0, 0, label, {
    fontFamily: FONT,
    fontSize: opts.fontSize || '52px',
    color: opts.textColor || COLORS.textDark,
  }).setOrigin(0.5);
  const setPressed = (pressed) => { txt.y = drawButtonFace(bg, w, h, color, pressed); };
  setPressed(false);

  const btn = scene.add.container(x, y, [bg, txt]);
  btn.setSize(w + 14, h + 26);
  btn.setInteractive({ useHandCursor: true });

  btn.on('pointerdown', () => { setPressed(true); btn.setScale(0.97); });
  btn.on('pointerout', () => { setPressed(false); btn.setScale(1); });
  btn.on('pointerup', () => {
    setPressed(false);
    btn.setScale(1);
    scene.game.events.emit('sfx', 'click', {});
    onClick();
  });
  return btn;
}

// Round speaker toggle. AUDIO comes from src/audio.js and may be missing, so every call is guarded.
function makeMuteButton(scene, x, y) {
  const size = 104;
  const g = scene.add.graphics();
  const btn = scene.add.container(x, y, [g]);
  const isMuted = () => (typeof AUDIO !== 'undefined' && AUDIO.isMuted ? AUDIO.isMuted() : false);
  const redraw = () => {
    const muted = isMuted();
    g.clear();
    g.fillStyle(0x1a1033, 1);
    g.fillCircle(0, 4, size / 2 + 6);
    g.fillStyle(muted ? 0x8a7fb0 : 0x5ee6ff, 1);
    g.fillCircle(0, 0, size / 2);
    g.fillStyle(0xffffff, 0.45);
    g.fillEllipse(-12, -24, 40, 14);
    // Speaker body.
    g.fillStyle(0x1a1033, 1);
    g.fillRect(-26, -10, 14, 20);
    g.fillTriangle(-14, -10, 4, -24, 4, 24);
    g.fillTriangle(-14, -10, -14, 10, 4, 24);
    g.lineStyle(6, 0x1a1033, 1);
    if (muted) {
      g.lineBetween(12, -12, 30, 12);
      g.lineBetween(30, -12, 12, 12);
    } else {
      g.beginPath();
      g.arc(4, 0, 14, -0.8, 0.8, false);
      g.strokePath();
      g.beginPath();
      g.arc(4, 0, 26, -0.8, 0.8, false);
      g.strokePath();
    }
  };
  redraw();
  btn.setSize(size + 12, size + 12);
  btn.setInteractive({ useHandCursor: true });
  btn.on('pointerdown', () => btn.setScale(0.92));
  btn.on('pointerout', () => btn.setScale(1));
  btn.on('pointerup', () => {
    btn.setScale(1);
    if (typeof AUDIO !== 'undefined' && AUDIO.toggleMute) AUDIO.toggleMute();
    scene.game.events.emit('sfx', 'click', {});
    redraw();
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

// Sağ üst köşeye tam ekran butonu (çentikten uzak dursun diye biraz aşağıda)
function addFullscreenButton(scene) {
  const btn = scene.add.text(GAME_WIDTH - 30, 60, '⛶', {
    fontFamily: FONT,
    fontSize: '60px',
    color: COLORS.text,
    stroke: '#1a1033',
    strokeThickness: 8,
  }).setOrigin(1, 0).setPadding(16).setInteractive({ useHandCursor: true }).setDepth(1000);

  btn.on('pointerup', () => {
    if (scene.scale.isFullscreen) {
      scene.scale.stopFullscreen();
    } else {
      scene.scale.startFullscreen();
    }
  });
  return btn;
}
