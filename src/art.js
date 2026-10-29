// All world drawing for the game scene lives here, so the look can change without touching
// game logic. Every function draws into a Phaser Graphics object `g` in world coordinates.
// `ctx` carries read-only state useful for reactive art:
//   { time (seconds), comet {x,y,vx,vy}, speed, speedFraction, orbitPlanet, isHolding, danger (0..1) }
const ART = {
  outline: 0x1a1033,

  // Shade outside the side walls (only visible when the camera zooms out).
  drawWalls(g, view) {
    if (view.left >= 0) return;
    g.fillStyle(0x120a2a, 0.75);
    g.fillRect(view.left, view.top, -view.left, view.bottom - view.top);
    g.fillRect(GAME_WIDTH, view.top, view.right - GAME_WIDTH, view.bottom - view.top);
    g.lineStyle(8, 0xff6fb5, 0.8);
    g.lineBetween(0, view.top, 0, view.bottom);
    g.lineBetween(GAME_WIDTH, view.top, GAME_WIDTH, view.bottom);
  },

  // highlighted: comet could grab it / is orbiting it. isTarget: a release now flies to it.
  drawPlanet(g, p, highlighted, isTarget, ctx) {
    // Grab zone: dashed ring so players learn where holding works. Green = release now.
    const zone = p.radius + TUNING.grabRange;
    if (isTarget) {
      g.fillStyle(0x5eff8f, 0.12);
      g.fillCircle(p.x, p.y, zone);
    }
    g.lineStyle(isTarget ? 7 : 4, isTarget ? 0x5eff8f : 0xffffff, isTarget ? 0.9 : highlighted ? 0.55 : 0.14);
    for (let a = 0; a < Math.PI * 2; a += Math.PI / 18) {
      g.beginPath();
      g.arc(p.x, p.y, zone, a, a + Math.PI / 36);
      g.strokePath();
    }
    if (p.hasRing) {
      g.lineStyle(10, ART.outline, 1);
      g.strokeEllipse(p.x, p.y, p.radius * 2.9, p.radius * 0.9);
      g.lineStyle(5, 0xfff1c1, 1);
      g.strokeEllipse(p.x, p.y, p.radius * 2.9, p.radius * 0.9);
    }
    g.fillStyle(ART.outline, 1);
    g.fillCircle(p.x, p.y, p.radius + 6);
    g.fillStyle(p.color, 1);
    g.fillCircle(p.x, p.y, p.radius);
    // Lit side + craters break up the plain disc.
    g.fillStyle(0xffffff, 0.25);
    g.fillCircle(p.x - p.radius * 0.3, p.y - p.radius * 0.3, p.radius * 0.45);
    g.fillStyle(0x000000, 0.18);
    for (const c of p.craters) g.fillCircle(p.x + Math.cos(c.a) * c.d, p.y + Math.sin(c.a) * c.d, c.r);
  },

  // Layered, wobbling wall of fire: white-hot edge, then yellow, orange and deep red below.
  drawNova(g, novaY, view, ctx) {
    if (novaY > view.bottom + 40) return;
    const t = ctx.time;
    const layers = [
      { offset: -10, color: 0xffffff, alpha: 0.9 },
      { offset: 6, color: 0xffe14d, alpha: 1 },
      { offset: 40, color: 0xff9a2e, alpha: 1 },
      { offset: 110, color: 0xff4d2e, alpha: 1 },
      { offset: 220, color: 0xb3203a, alpha: 1 },
    ];
    for (const layer of layers) {
      const pts = [];
      for (let x = view.left - 20; x <= view.right + 20; x += 24) {
        const wobble = Math.sin(x * 0.018 + t * 3 + layer.offset) * 14 + Math.sin(x * 0.047 - t * 5) * 6;
        pts.push({ x, y: novaY + layer.offset + wobble });
      }
      pts.push({ x: view.right + 20, y: view.bottom + 20 });
      pts.push({ x: view.left - 20, y: view.bottom + 20 });
      g.fillStyle(layer.color, layer.alpha);
      g.fillPoints(pts, true);
    }
    // Embers rising off the front.
    for (let i = 0; i < 14; i++) {
      const ex = view.left + ((i * 137 + t * 60) % (view.right - view.left));
      const life = (t * 0.9 + i * 0.37) % 1;
      g.fillStyle(i % 2 ? 0xffe14d : 0xff9a2e, 1 - life);
      g.fillCircle(ex, novaY - life * 140, 6 * (1 - life) + 2);
    }
  },

  drawAsteroid(g, a, ctx) {
    const pts = a.shape.map((k, i) => {
      const ang = a.rot + (i / a.shape.length) * Math.PI * 2;
      return { x: a.x + Math.cos(ang) * a.radius * k, y: a.y + Math.sin(ang) * a.radius * k };
    });
    g.lineStyle(6, ART.outline, 1);
    g.fillStyle(0x9c8672, 1);
    g.fillPoints(pts, true);
    g.strokePoints(pts, true);
    g.fillStyle(0x6e5a4a, 1);
    g.fillCircle(a.x + a.radius * 0.25, a.y + a.radius * 0.15, a.radius * 0.28);
    g.fillStyle(0xffffff, 0.25);
    g.fillCircle(a.x - a.radius * 0.3, a.y - a.radius * 0.3, a.radius * 0.22);
  },

  drawBlackHole(g, h, ctx) {
    const spin = ctx.time * 2.4;
    // Pull zone hint, then swirling rings around a dark core.
    g.fillStyle(0x8a2be2, 0.08);
    g.fillCircle(h.x, h.y, TUNING.blackHolePullRadius);
    for (let i = 0; i < 3; i++) {
      const r = TUNING.blackHoleRadius + 18 + i * 22;
      g.lineStyle(6 - i, i === 0 ? 0xff6fb5 : 0xc77dff, 0.8 - i * 0.2);
      g.beginPath();
      g.arc(h.x, h.y, r, spin * (i + 1), spin * (i + 1) + Math.PI * 1.2);
      g.strokePath();
    }
    g.fillStyle(0xff6fb5, 1);
    g.fillCircle(h.x, h.y, TUNING.blackHoleRadius + 5);
    g.fillStyle(0x0b0618, 1);
    g.fillCircle(h.x, h.y, TUNING.blackHoleRadius);
  },

  // Dotted release line from (x, y) along unit direction (dx, dy).
  // kind: 'none' = no target (white), 'target' = will reach a planet (green), 'perfect' = gold.
  drawAimGuide(g, x, y, dx, dy, length, kind, ctx) {
    const color = kind === 'perfect' ? 0xffe14d : kind === 'target' ? 0x5eff8f : 0xffffff;
    const dots = Math.floor(length / 34);
    for (let i = 1; i <= dots; i++) {
      const t = i / dots;
      g.fillStyle(ART.outline, 0.6);
      g.fillCircle(x + dx * i * 34, y + dy * i * 34, 9 - t * 4);
      g.fillStyle(color, kind !== 'none' ? 1 : 0.85 - t * 0.6);
      g.fillCircle(x + dx * i * 34, y + dy * i * 34, 6 - t * 3);
    }
  },

  // trail: recent positions, newest first.
  drawComet(g, comet, trail, ctx) {
    const color = speedColor(ctx.speedFraction);
    const r = TUNING.cometRadius;
    for (let i = trail.length - 1; i > 0; i--) {
      const t = 1 - i / trail.length;
      g.lineStyle(r * 2 * t + 2, color, t * 0.9);
      g.lineBetween(trail[i].x, trail[i].y, trail[i - 1].x, trail[i - 1].y);
    }
    g.fillStyle(ART.outline, 1);
    g.fillCircle(comet.x, comet.y, r + 5);
    g.fillStyle(color, 1);
    g.fillCircle(comet.x, comet.y, r);
    g.fillStyle(0xffffff, 0.9);
    g.fillCircle(comet.x - 5, comet.y - 5, r * 0.45);
  },

  // Generates the tiling star texture used for the parallax background.
  makeStarTexture(scene, key) {
    const g = scene.make.graphics({ x: 0, y: 0, add: false });
    for (let i = 0; i < 90; i++) {
      g.fillStyle(0xffffff, Phaser.Math.FloatBetween(0.3, 0.9));
      g.fillCircle(Phaser.Math.Between(0, 512), Phaser.Math.Between(0, 512), Phaser.Math.FloatBetween(1, 3));
    }
    g.generateTexture(key, 512, 512);
    g.destroy();
  },
};
