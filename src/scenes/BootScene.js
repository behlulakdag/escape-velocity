// Asset'leri yüklediğin sahne. Sketchbook loading page: a doodled planet colored in with crayon.
class BootScene extends Phaser.Scene {
  constructor() {
    super('Boot');
  }

  preload() {
    uiAddPaper(this, 0);
    // Loading = a doodled planet being colored in with crayon, left to right (no progress bar).
    const cx = GAME_WIDTH / 2;
    const y = GAME_HEIGHT / 2;
    const rx = 96;
    const ry = 84;
    uiInkText(this, cx, y - 160, 'ESCAPE VELOCITY', { size: 56, color: uiColorHex(UI_CRAYON.yellow), rot: -0.03, boil: false });
    uiInkText(this, cx, y + 140, 'sharpening crayons...', { size: 28, color: UI_INK.pencilHex, stroke: null, rot: 0.02, boil: false });
    const g = this.add.graphics();
    const rng = uiRng(7);
    const outline = uiLoop(cx, y, rx, ry, rng, rng, { n: 20, amp: 1.5, lop: 0.07 });
    // Hatch strokes are pre-placed once inside the loop; progress just reveals more of them.
    const strokes = [];
    for (let x = -rx + 6; x < rx - 4; x += 7) {
      const half = ry * Math.sqrt(Math.max(0, 1 - (x / rx) * (x / rx))) - 6;
      if (half > 4) strokes.push({ x, half, tilt: 8 + rng() * 8, w: 4 + rng() * 2, a: 0.75 + rng() * 0.25 });
    }
    const drawBar = (p) => {
      g.clear();
      for (const s of strokes) {
        if (s.x + rx > rx * 2 * p) break;
        g.lineStyle(s.w, UI_CRAYON.orange, s.a);
        g.lineBetween(cx + s.x - s.tilt / 2, y + s.half, cx + s.x + s.tilt / 2, y - s.half);
      }
      g.lineStyle(5, UI_INK.cream, 1);
      g.beginPath();
      g.moveTo(outline[0].x, outline[0].y);
      for (let i = 1; i < outline.length; i++) g.lineTo(outline[i].x, outline[i].y);
      g.lineTo(outline[1].x + 4, outline[1].y + 3);   // overshoot: the pen does not close neatly
      g.strokePath();
      // A pen-stroke ring around the planet.
      g.lineStyle(4, UI_INK.cream, 0.9);
      g.beginPath();
      for (let i = 0; i <= 16; i++) {
        const t = Math.PI * 0.05 + (i / 16) * Math.PI * 0.9;
        const px = cx + Math.cos(t) * rx * 1.55;
        const py = y + 10 + Math.sin(t) * ry * 0.32 - Math.cos(t) * 14;
        if (i === 0) g.moveTo(px, py); else g.lineTo(px, py);
      }
      g.strokePath();
    };
    drawBar(0);
    this.load.on('progress', drawBar);

    // ===== ASSET'LERİ BURAYA EKLE =====
    // (Everything is code-drawn or synthesized right now.)
  }

  create() {
    // Generate the shared textures once so every scene can reuse them.
    if (typeof ART !== 'undefined' && ART.makeStarTexture && !this.textures.exists('stars')) ART.makeStarTexture(this, 'stars');
    uiMakeDoodles(this);
    uiMakeHudTextures(this);
    // Phaser bakes text into canvases, so the font must be ready before any text is drawn.
    // Give up after 2s and fall back to Arial Black rather than hang on a slow phone.
    let started = false;
    const go = () => { if (!started) { started = true; this.scene.start('Menu'); } };
    if (document.fonts && document.fonts.load) {
      document.fonts.load('48px "Lilita One"').then(go, go);
      this.time.delayedCall(2000, go);
    } else {
      go();
    }
  }
}
