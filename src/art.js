// All world drawing lives here, so the look can change without touching game logic.
// Style: SKETCHBOOK (see CLAUDE.md "Art direction"). Everything should look drawn by a person:
// gel-pen ink outlines that "boil" (re-wobble ~10 times a second), colored-pencil hatching that
// does not quite match its outline, construction paper with grain. Faces only on the comet
// (hero) and the supernova (villain). No glow halos, no sparkles, no perfect circles.
//
// Every draw function takes a Phaser Graphics `g` in world coordinates and `ctx`:
//   { time (s), comet {x,y,vx,vy}, speed, speedFraction, orbitPlanet, isHolding, danger (0..1),
//     stretch (>=1), perfectChain, closeCall (0..1), squash (0..1), aimKind ('none'|'target'|'perfect'),
//     perfectPulse (0..1), zonePulse (0..1), front (optional Graphics drawn above the bodies),
//     afterburner (0..1): Afterburner card burning, the tail turns to blue crayon flame streaks,
//     shieldReady (bool): a Heat Shield charge is ready, a hand-drawn pink bubble rings the comet,
//     grabRangeBonus (px): added to TUNING.grabRange so the drawn grab ring matches the real range }
//
// Performance: static things (planets, asteroids, black holes, paper) are pre-rendered ONCE into
// canvas textures, 3 boil variants each, and shown as Images that cycle variants every 100 ms.
// Only dynamic things (comet, trail, nova front, aim, effects) are drawn with Graphics per frame,
// and their jitter seed also changes only every 100 ms (a new seed every frame reads as noise).

// Deterministic 0..1 random stream from a seed.
function artRandom(seed) {
  let s = Math.floor(Math.abs(seed)) % 2147483647 || 1;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

const SKETCH = {
  cream: 0xf4ead0,       // gel-pen ink on dark pages
  dark: 0x2a2018,        // ink on the cream page, and face lines on yellow/orange bodies
  yellow: 0xffd23f,
  orange: 0xf5862a,
  red: 0xd8432c,
  deepRed: 0x8e2433,
  green: 0x74e07f,
  gold: 0xffd23f,
  cool: 0xa9d4f0,        // cool light from above
  blush: 0xff8a7a,
  shadowInk: 0x14121c,   // dark backing under bright strokes so they read on any page
  boilFps: 10,
  variants: 3,
};

// Hand-picked planet looks. Color is part of the design so the texture library stays small.
const PLANET_DESIGNS = [
  { body: 0xd2775a, shade: 0x6e2c22, mountains: true, flag: true, craters: 2 },
  { body: 0xe0b050, shade: 0x7d5520, band: 0xc9704a, bands: 3, moon: true },
  { body: 0x8792d0, shade: 0x343c78, craters: 3, scribble: true, rocket: true },
  { body: 0x76b39d, shade: 0x2a5648, band: 0xb5cf7a, bands: 2, ring: 0xe8d9a8 },
  { body: 0xc184b0, shade: 0x55304f, craters: 2, ring: 0xa9d4f0, moon: true },
];
const PLANET_SIZES_FOR_WARMUP = [38, 62, 85, 110];
const ASTEROID_BASE_R = 36;
const ASTEROID_DESIGNS = 6;

// ---------- canvas (texture) drawing helpers ----------

const SKC = {
  css(c, a) {
    return 'rgba(' + ((c >> 16) & 255) + ',' + ((c >> 8) & 255) + ',' + (c & 255) + ',' + (a === undefined ? 1 : a) + ')';
  },
  mid(a, b) { return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; },

  // Smooth closed/open path through midpoints (or straight segments for rocks).
  path(c, pts, closed, straight) {
    const n = pts.length;
    if (straight) {
      c.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < n; i++) c.lineTo(pts[i].x, pts[i].y);
      if (closed) c.closePath();
      return;
    }
    if (closed) {
      const m0 = SKC.mid(pts[n - 1], pts[0]);
      c.moveTo(m0.x, m0.y);
      for (let i = 0; i < n; i++) {
        const m = SKC.mid(pts[i], pts[(i + 1) % n]);
        c.quadraticCurveTo(pts[i].x, pts[i].y, m.x, m.y);
      }
      c.closePath();
    } else {
      c.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < n - 1; i++) {
        const m = SKC.mid(pts[i], pts[i + 1]);
        c.quadraticCurveTo(pts[i].x, pts[i].y, m.x, m.y);
      }
      c.lineTo(pts[n - 1].x, pts[n - 1].y);
    }
  },

  fill(c, pts, color, alpha, straight) {
    c.beginPath();
    SKC.path(c, pts, true, straight);
    c.fillStyle = SKC.css(color, alpha);
    c.fill();
  },

  // Gel-pen line: pressure (width) swells and thins along the stroke, and a closed loop
  // overshoots its start a little, the way a hand never closes a circle exactly.
  pen(c, pts, closed, width, color, rnd, alpha, straight) {
    const n = pts.length;
    c.strokeStyle = SKC.css(color, alpha === undefined ? 1 : alpha);
    c.lineCap = 'round';
    c.lineJoin = 'round';
    const ph = rnd() * 6;
    const segs = closed ? n + 2 : n - 1;
    for (let i = 0; i < segs; i++) {
      const drift = closed && i >= n ? 1.6 * (i - n + 1) : 0;
      const a = pts[i % n];
      const b = pts[(i + 1) % n];
      c.lineWidth = width * (0.6 + 0.55 * (0.5 + 0.5 * Math.sin(i * 0.7 + ph)) + rnd() * 0.15);
      c.beginPath();
      if (straight || !closed) {
        c.moveTo(a.x + drift, a.y + drift);
        c.lineTo(b.x + drift, b.y + drift);
      } else {
        const p = pts[(i + n - 1) % n];
        const m1 = SKC.mid(p, a);
        const m2 = SKC.mid(a, b);
        c.moveTo(m1.x + drift, m1.y + drift);
        c.quadraticCurveTo(a.x + drift, a.y + drift, m2.x + drift, m2.y + drift);
      }
      c.stroke();
    }
  },

  // Colored-pencil hatching clipped to a shape, shifted by (ox, oy) so it is misregistered
  // from the outline. clip2: optional extra clip (fn(c) that builds a path + clips).
  hatch(c, pts, o) {
    const rnd = o.rnd;
    c.save();
    c.beginPath();
    const shifted = pts.map((p) => ({ x: p.x + (o.ox || 0), y: p.y + (o.oy || 0) }));
    SKC.path(c, shifted, true, o.straight);
    c.clip();
    if (o.clip2) o.clip2(c);
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const p of shifted) {
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
    }
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const D = Math.hypot(maxX - minX, maxY - minY) / 2 + 4;
    const dx = Math.cos(o.angle);
    const dy = Math.sin(o.angle);
    c.lineCap = 'round';
    for (let d = -D; d < D; d += o.spacing * (0.75 + 0.5 * rnd())) {
      if (rnd() < (o.skip || 0)) continue;
      const bend = (rnd() - 0.5) * o.spacing * 1.4;
      const a = (rnd() - 0.5) * 0.06;
      const ux = dx + a * -dy;
      const uy = dy + a * dx;
      const px = cx - dy * d;
      const py = cy + dx * d;
      const len = D * (0.9 + rnd() * 0.25);
      c.lineWidth = o.width * (0.7 + 0.6 * rnd());
      c.strokeStyle = SKC.css(o.color, (o.alpha || 1) * (0.7 + 0.3 * rnd()));
      c.beginPath();
      c.moveTo(px - ux * len, py - uy * len);
      c.quadraticCurveTo(px - dy * bend, py + dx * bend, px + ux * len, py + uy * len);
      c.stroke();
    }
    c.restore();
  },

  // Lopsided loop: a few low harmonics (shape, same for every boil variant) + per-point jitter.
  loop(cx, cy, R, n, harm, jitter, jr, ry) {
    const pts = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      let r = 1;
      for (const h of harm) r += h.a * Math.sin(h.k * a + h.p);
      const j = (jr() - 0.5) * jitter;
      pts.push({ x: cx + Math.cos(a) * (R * r + j), y: cy + Math.sin(a) * ((ry || R) * r + j) });
    }
    return pts;
  },

  harmonics(rnd, amount) {
    return [
      { k: 2, a: (rnd() - 0.5) * amount, p: rnd() * 6.3 },
      { k: 3, a: (rnd() - 0.5) * amount * 0.7, p: rnd() * 6.3 },
      { k: 5, a: (rnd() - 0.5) * amount * 0.3, p: rnd() * 6.3 },
    ];
  },

  // Draws fn at the 9 wrapped positions of a tile so it repeats without seams.
  wrapped(size, x, y, fn) {
    for (const ox of [-size, 0, size]) for (const oy of [-size, 0, size]) fn(x + ox, y + oy);
  },

  asterisk(c, x, y, r, color, alpha, width, rnd) {
    c.strokeStyle = SKC.css(color, alpha);
    c.lineCap = 'round';
    c.lineWidth = width;
    const rot = rnd() * Math.PI;
    for (let k = 0; k < 3; k++) {
      const a = rot + (k * Math.PI) / 3 + (rnd() - 0.5) * 0.25;
      const r1 = r * (0.8 + rnd() * 0.4);
      c.beginPath();
      c.moveTo(x - Math.cos(a) * r1, y - Math.sin(a) * r1);
      c.lineTo(x + Math.cos(a) * r1, y + Math.sin(a) * r1);
      c.stroke();
    }
  },

  // Five-point doodle star drawn in one stroke, never quite closed.
  doodleStar(c, x, y, r, color, alpha, width, rnd) {
    c.strokeStyle = SKC.css(color, alpha);
    c.lineWidth = width;
    c.lineCap = 'round';
    c.lineJoin = 'round';
    const rot = -Math.PI / 2 + (rnd() - 0.5) * 0.5;
    c.beginPath();
    for (let i = 0; i <= 5; i++) {
      const a = rot + (i * 4 * Math.PI) / 5;
      const rr = r * (0.85 + rnd() * 0.3);
      const px = x + Math.cos(a) * rr + (i === 5 ? 2 : 0);
      const py = y + Math.sin(a) * rr;
      if (i === 0) c.moveTo(px, py); else c.lineTo(px, py);
    }
    c.stroke();
  },
};

const ART = {
  // Kept for scenes that still reference the old palette names.
  outline: SKETCH.shadowInk,
  white: 0xffffff,
  blush: SKETCH.blush,
  gold: SKETCH.gold,
  green: SKETCH.green,

  // Current sketchbook page (zone). Ink flips dark on the cream ESCAPE VELOCITY page.
  pageIndex: 0,
  ink: SKETCH.cream,
  inkMode: 'l',
  backing: SKETCH.shadowInk,

  setPage(index) {
    const z = (typeof ZONES !== 'undefined' && ZONES[index]) || null;
    ART.pageIndex = z ? index : 0;
    ART.ink = z && z.ink !== undefined ? z.ink : SKETCH.cream;
    ART.inkMode = ART.ink === SKETCH.dark ? 'd' : 'l';
    ART.backing = ART.inkMode === 'd' ? 0xfff6dc : SKETCH.shadowInk;
  },

  boilFrame(t) { return Math.floor(t * SKETCH.boilFps); },
  boilVariant(t) { return Math.floor(t * SKETCH.boilFps) % SKETCH.variants; },

  // Game code still passes its old neon pop colors (bursts, card families); on the page they
  // are drawn with the matching muted crayon instead. Unknown colors pass through.
  crayonMap: {
    0x2ee6c8: 0x5fd3c0, 0xffc93c: 0xffd23f, 0x5cc8ff: 0x7cc0ee, 0xff6fb5: 0xf08cbc,
    0x5eff8f: 0x74e07f, 0xffe14d: 0xffd23f, 0xff9a2e: 0xf5862a, 0xff4d6d: 0xd8432c,
    0xfff1c1: 0xf4ead0, 0xb8a28c: 0xa8998a, 0xffffff: 0xf4ead0,
  },
  crayon(color) {
    // White / cream would vanish on the cream page: there "white" means the page's ink.
    if ((color === 0xffffff || color === 0xfff1c1) && ART.inkMode === 'd') return ART.ink;
    const c = ART.crayonMap[color];
    return c === undefined ? color : c;
  },

  // ---------- small shared helpers ----------

  cometDir(comet, trail) {
    let dx = comet.vx || 0;
    let dy = comet.vy || -1;
    if (trail && trail.length > 2) {
      const tx = comet.x - trail[2].x;
      const ty = comet.y - trail[2].y;
      if (tx * tx + ty * ty > 4) { dx = tx; dy = ty; }
    }
    const len = Math.hypot(dx, dy) || 1;
    return { x: dx / len, y: dy / len };
  },

  lookAt(fromX, fromY, toX, toY) {
    const dx = toX - fromX;
    const dy = toY - fromY;
    const len = Math.hypot(dx, dy) || 1;
    return { x: dx / len, y: dy / len, dist: len };
  },

  // Wobbly loop points for per-frame Graphics shapes (jitter re-rolled by the boil seed).
  wobblyLoop(cx, cy, rx, ry, n, jitter, rnd, rot) {
    const pts = [];
    const r0 = rot || 0;
    for (let i = 0; i < n; i++) {
      const a = r0 + (i / n) * Math.PI * 2;
      const j = 1 + (rnd() - 0.5) * jitter;
      pts.push({ x: cx + Math.cos(a) * rx * j, y: cy + Math.sin(a) * ry * j });
    }
    return pts;
  },

  // Pen stroke on Graphics: the polyline is split into short chunks of different widths.
  pen(g, pts, closed, width, color, alpha, rnd) {
    const n = pts.length;
    if (n < 2) return;
    const segs = closed ? n : n - 1;
    let i = 0;
    while (i < segs) {
      const len = Math.min(segs - i, 2 + Math.floor(rnd() * 3));
      g.lineStyle(width * (0.65 + rnd() * 0.7), color, alpha);
      g.beginPath();
      g.moveTo(pts[i].x, pts[i].y);
      for (let k = 1; k <= len; k++) {
        const p = pts[(i + k) % n];
        g.lineTo(p.x, p.y);
      }
      g.strokePath();
      i += len;
    }
  },

  // Hand-drawn asterisk star (3 crossing strokes).
  asterisk(g, x, y, r, color, alpha, width, rnd) {
    g.lineStyle(width, color, alpha);
    const rot = rnd() * Math.PI;
    for (let k = 0; k < 3; k++) {
      const a = rot + (k * Math.PI) / 3 + (rnd() - 0.5) * 0.3;
      const r1 = r * (0.75 + rnd() * 0.5);
      g.lineBetween(x - Math.cos(a) * r1, y - Math.sin(a) * r1, x + Math.cos(a) * r1, y + Math.sin(a) * r1);
    }
  },

  // Old API name: now an ink asterisk instead of a glossy sparkle.
  sparkle(g, x, y, r, rot, color, alpha) {
    ART.asterisk(g, x, y, r, color, alpha === undefined ? 1 : alpha, Math.max(2, r * 0.25), artRandom(Math.floor(rot * 100) + 7));
  },

  // Dashed hand-drawn ring (dash ends jitter with the boil seed).
  dashedRing(g, x, y, r, dashes, rot, width, color, alpha, rnd) {
    rnd = rnd || artRandom(Math.floor(rot * 1000) + 3);
    g.lineStyle(width, color, alpha);
    const step = (Math.PI * 2) / dashes;
    for (let i = 0; i < dashes; i++) {
      const a0 = rot + i * step + (rnd() - 0.5) * step * 0.2;
      const a1 = a0 + step * (0.4 + rnd() * 0.2);
      const r0 = r * (1 + (rnd() - 0.5) * 0.03);
      const r1 = r * (1 + (rnd() - 0.5) * 0.03);
      g.lineBetween(x + Math.cos(a0) * r0, y + Math.sin(a0) * r0, x + Math.cos(a1) * r1, y + Math.sin(a1) * r1);
    }
  },

  // Chord-clipped hatching inside a circle-ish region (cheap enough for per-frame shapes).
  hatchCircle(g, cx, cy, r, angle, spacing, width, color, alpha, rnd) {
    const dx = Math.cos(angle);
    const dy = Math.sin(angle);
    for (let d = -r + spacing * 0.5; d < r; d += spacing) {
      if (rnd() < 0.12) continue;
      const half = Math.sqrt(Math.max(0, r * r - d * d)) * (0.75 + rnd() * 0.3);
      const ox = cx - dy * d;
      const oy = cy + dx * d;
      g.lineStyle(width * (0.7 + rnd() * 0.6), color, alpha);
      g.lineBetween(ox - dx * half, oy - dy * half, ox + dx * half, oy + dy * half);
    }
  },

  // ---------- texture library (pre-rendered once) ----------

  canvasTexture(scene, key, w, h, draw) {
    if (scene.textures.exists(key)) return key;
    const tex = scene.textures.createCanvas(key, Math.ceil(w), Math.ceil(h));
    draw(tex.getContext(), Math.ceil(w), Math.ceil(h));
    tex.refresh();
    return key;
  },

  // Queue of texture jobs run one per frame (ART.tick), so warming up never hitches a frame.
  warmQueue: [],
  warm(jobs) { for (const j of jobs) ART.warmQueue.push(j); },
  tick(scene) {
    const job = ART.warmQueue.shift();
    if (job) job(scene);
  },
  warmAll(scene, inkMode) {
    const ink = inkMode === 'd' ? SKETCH.dark : SKETCH.cream;
    const jobs = [];
    if (inkMode !== 'd') {
      for (let i = 0; i < 6; i++) jobs.push((s) => ART.paperTexture(s, i));
      for (let d = 0; d < ASTEROID_DESIGNS; d++) for (let v = 0; v < SKETCH.variants; v++) jobs.push((s) => ART.asteroidTexture(s, d, v));
      for (let v = 0; v < SKETCH.variants; v++) jobs.push((s) => ART.blackHoleTexture(s, v));
    }
    for (const R of PLANET_SIZES_FOR_WARMUP) {
      for (let d = 0; d < PLANET_DESIGNS.length; d++) {
        for (let v = 0; v < SKETCH.variants; v++) jobs.push((s) => ART.planetTextureFor(s, R, d, inkMode, ink, v));
      }
    }
    ART.warm(jobs);
  },

  // Bodies are Images placed right above the Graphics `g` they belong to, so whatever the scene
  // draws into a later Graphics (nova, aim, comet) stays on top. Images whose owner was not drawn
  // last frame are destroyed (owners such as planets are dropped by the game without telling us).
  bodyImage(g, owner, key) {
    const scene = g.scene;
    const frame = scene.game.loop.frame;
    const pool = scene._artPool || (scene._artPool = { frame: -1, list: [] });
    if (pool.frame !== frame) {
      pool.frame = frame;
      pool.list = pool.list.filter((img) => {
        if (!img.scene) return false;
        if (img._artFrame < frame - 1) {
          if (img._owner && img._owner._img === img) img._owner._img = null;
          img.destroy();
          return false;
        }
        return true;
      });
    }
    let img = owner._img;
    if (!img || !img.scene) {
      img = scene.add.image(0, 0, key);
      img.setDepth(g.depth);
      // moveAbove() leaves an item that is already higher where it is, so place it explicitly.
      scene.children.moveTo(img, scene.children.getIndex(g) + 1);
      img._owner = owner;
      owner._img = img;
      pool.list.push(img);
    } else if (img.texture.key !== key) {
      img.setTexture(key);
    }
    img._artFrame = frame;
    img.setVisible(g.visible);
    return img;
  },

  // ---------- paper ----------

  // Construction paper tile for a zone: grain, fibers, and the zone's own marks.
  paperTexture(scene, index) {
    const key = 'paper_' + index;
    const z = (typeof ZONES !== 'undefined' && ZONES[index]) || { paper: 0x1d2747, fx: 'none' };
    return ART.paperTextureAs(scene, key, z.paper, z.fx, index);
  },

  paperTextureAs(scene, key, paper, fx, seed) {
    return ART.canvasTexture(scene, key, 512, 512, (c, S) => {
      const rnd = artRandom(9001 + seed * 77);
      c.fillStyle = SKC.css(paper);
      c.fillRect(0, 0, S, S);
      const light = paper > 0x999999 && ((paper >> 16) & 255) > 180;   // the cream page
      // Soft blotches: paper is never one flat color.
      for (let i = 0; i < 26; i++) {
        const x = rnd() * S;
        const y = rnd() * S;
        const r = 40 + rnd() * 90;
        const col = rnd() < 0.5 ? 0xffffff : 0x000000;
        SKC.wrapped(S, x, y, (px, py) => {
          const grd = c.createRadialGradient(px, py, 0, px, py, r);
          grd.addColorStop(0, SKC.css(col, light ? 0.05 : 0.035));
          grd.addColorStop(1, SKC.css(col, 0));
          c.fillStyle = grd;
          c.fillRect(px - r, py - r, r * 2, r * 2);
        });
      }
      if (fx === 'grid') {
        // Graph paper: printed lines, a stronger one every 4 squares.
        const gridCol = lerpColor(paper, 0xc9b8ff, 0.4);
        for (let k = 0; k < S; k += 32) {
          const strong = k % 128 === 0;
          c.fillStyle = SKC.css(gridCol, strong ? 0.5 : 0.28);
          c.fillRect(k, 0, strong ? 2 : 1, S);
          c.fillRect(0, k, S, strong ? 2 : 1);
        }
      }
      if (fx === 'heat') {
        // Heat squiggles drawn with a red-orange pencil.
        for (let i = 0; i < 24; i++) {
          const x = rnd() * S;
          const y = rnd() * S;
          const len = 40 + rnd() * 70;
          const col = rnd() < 0.5 ? SKETCH.orange : SKETCH.red;
          const amp = 3 + rnd() * 4;
          const freq = 0.18 + rnd() * 0.12;
          const alpha = 0.38 + rnd() * 0.2;
          SKC.wrapped(S, x, y, (px, py) => {
            c.strokeStyle = SKC.css(col, alpha);
            c.lineWidth = 2.6;
            c.lineCap = 'round';
            c.beginPath();
            for (let k = 0; k <= len; k += 4) {
              const yy = py + Math.sin(k * freq) * amp;
              if (k === 0) c.moveTo(px + k, yy); else c.lineTo(px + k, yy);
            }
            c.stroke();
          });
        }
      }
      // Grain: per-pixel noise.
      const img = c.getImageData(0, 0, S, S);
      const d = img.data;
      let s = 12345 + seed;
      for (let i = 0; i < d.length; i += 4) {
        s = (s * 1103515245 + 12345) & 0x7fffffff;
        const n = ((s >> 16) & 31) - 15;
        d[i] += n; d[i + 1] += n; d[i + 2] += n;
      }
      c.putImageData(img, 0, 0);
      // Fibers: short light and dark curls pressed into the paper.
      for (let i = 0; i < 240; i++) {
        const x = rnd() * S;
        const y = rnd() * S;
        const len = 5 + rnd() * 16;
        const a = rnd() * Math.PI * 2;
        const bend = (rnd() - 0.5) * 8;
        const col = rnd() < (light ? 0.35 : 0.6) ? 0xffffff : 0x000000;
        const alpha = 0.1 + rnd() * 0.18;
        const w = 0.6 + rnd() * 0.8;
        SKC.wrapped(S, x, y, (px, py) => {
          c.strokeStyle = SKC.css(col, alpha);
          c.lineWidth = w;
          c.beginPath();
          c.moveTo(px, py);
          c.quadraticCurveTo(px + Math.cos(a) * len * 0.5 - Math.sin(a) * bend, py + Math.sin(a) * len * 0.5 + Math.cos(a) * bend,
            px + Math.cos(a) * len, py + Math.sin(a) * len);
          c.stroke();
        });
      }
      if (light) {
        // Warm gold flecks on the final page.
        for (let i = 0; i < 40; i++) {
          const x = rnd() * S;
          const y = rnd() * S;
          SKC.wrapped(S, x, y, (px, py) => {
            c.fillStyle = SKC.css(0xd9a43a, 0.35);
            c.fillRect(px, py, 2, 2);
          });
        }
      }
    });
  },

  // ---------- walls ----------

  // Margin beyond the side walls (only visible when the camera zooms out): a pen line and
  // pencil hatching, like the edge of the drawable area.
  drawWalls(g, view, ctx) {
    if (view.left >= 0) return;
    const t = ctx ? ctx.time : 0;
    const bf = ART.boilFrame(t);
    g.fillStyle(0x000000, ART.inkMode === 'd' ? 0.12 : 0.3);
    g.fillRect(view.left, view.top, -view.left, view.bottom - view.top);
    g.fillRect(GAME_WIDTH, view.top, view.right - GAME_WIDTH, view.bottom - view.top);
    const step = 80;
    const y0 = Math.floor(view.top / step) * step;
    for (const wx of [0, GAME_WIDTH]) {
      const pts = [];
      for (let y = y0; y <= view.bottom + step; y += step) {
        const r = artRandom(Math.floor(y / step) * 31 + bf * 7 + wx);
        pts.push({ x: wx + (r() - 0.5) * 6, y });
      }
      ART.pen(g, pts, false, 5, ART.ink, 0.8, artRandom(bf + wx));
      const side = wx === 0 ? -1 : 1;
      g.lineStyle(2, ART.ink, 0.22);
      for (let y = y0; y <= view.bottom; y += 26) {
        const r = artRandom(Math.floor(y / 26) * 13 + bf * 3 + wx);
        g.lineBetween(wx + side * (6 + r() * 4), y, wx + side * (26 + r() * 10), y + 22);
      }
    }
  },

  // ---------- planets ----------

  // Look derived once from the planet's own fields + position, then cached.
  planetStyle(p) {
    if (p._art && p._art.R !== undefined) return p._art;
    const R = Math.round(p.radius);
    const h = Math.floor(artRandom(p.x * 7.13 + p.y * 3.71 + R * 13)() * 1000);
    // Ringed planets keep their ring (hasRing is the game's own random choice).
    const design = p.hasRing ? 3 + (h % 2) : h % 3;
    p._art = { R, design, seed: h };
    return p._art;
  },

  planetTextureFor(scene, R, design, inkMode, ink, variant) {
    const key = 'pl_' + R + '_' + design + '_' + inkMode + '_' + variant;
    if (scene.textures.exists(key)) return key;
    const D = PLANET_DESIGNS[design];
    const W = ((D.ring || D.moon) ? 3.4 : 2.5) * R + 48;
    const H = 2.9 * R + 56;
    return ART.canvasTexture(scene, key, W, H, (c, w, h) => ART.paintPlanet(c, w / 2, h / 2, R, D, design, ink, variant));
  },

  paintPlanet(c, cx, cy, R, D, design, ink, variant) {
    const shapeRnd = artRandom(design * 977 + R * 31 + 5);     // same for every boil variant
    const jr = artRandom(design * 131 + R * 17 + variant * 7717 + 1);
    const n = 44;
    const harm = SKC.harmonics(shapeRnd, 0.07);
    const peaks = [];
    if (D.mountains) {
      for (let k = 0; k < 3; k++) {
        peaks.push({ a: -2.45 + k * 0.75 + (shapeRnd() - 0.5) * 0.3, h: R * (0.1 + shapeRnd() * 0.1), w: 0.22 + shapeRnd() * 0.12 });
      }
    }
    const jitter = Math.max(2, R * 0.03);
    const sil = [];
    for (let i = 0; i < n; i++) {
      let a = (i / n) * Math.PI * 2;
      if (a > Math.PI) a -= Math.PI * 2;
      let r = R;
      for (const hm of harm) r += R * hm.a * Math.sin(hm.k * a + hm.p);
      for (const pk of peaks) r += pk.h * Math.max(0, 1 - Math.abs(a - pk.a) / pk.w);
      r += (jr() - 0.5) * jitter;
      sil.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });
    }
    const inkW = 3 + R * 0.022;
    const tilt = -0.22;
    const ringPts = (rx, ry, from, to) => {
      const pts = [];
      for (let k = 0; k <= 14; k++) {
        const a = from + ((to - from) * k) / 14;
        const x = Math.cos(a) * rx + (jr() - 0.5) * 2.5;
        const y = Math.sin(a) * ry + (jr() - 0.5) * 2.5;
        pts.push({ x: cx + x * Math.cos(tilt) - y * Math.sin(tilt), y: cy + x * Math.sin(tilt) + y * Math.cos(tilt) });
      }
      return pts;
    };
    // Ring: a crayon band between two pen strokes, back half first.
    const drawRing = (from, to) => {
      c.save();
      c.strokeStyle = SKC.css(D.ring, 0.75);
      c.lineWidth = R * 0.11;
      c.lineCap = 'round';
      c.beginPath();
      SKC.path(c, ringPts(R * 1.5, R * 0.33, from, to), false);
      c.stroke();
      c.restore();
      SKC.pen(c, ringPts(R * 1.6, R * 0.38, from, to), false, inkW * 0.8, ink, jr, 0.95);
      SKC.pen(c, ringPts(R * 1.39, R * 0.28, from + 0.08, to - 0.05), false, inkW * 0.6, ink, jr, 0.8);
    };
    if (D.ring) drawRing(Math.PI, Math.PI * 2);

    // Misregistered under-fill, so the planet hides the stars behind it.
    const ox = (jr() - 0.5) * R * 0.09;
    const oy = (jr() - 0.5) * R * 0.09;
    SKC.fill(c, sil.map((p) => ({ x: p.x + ox, y: p.y + oy })), lerpColor(D.body, 0x161a2a, 0.5), 1);
    const sp = Math.max(4, R * 0.075);
    SKC.hatch(c, sil, { angle: -0.95 + (jr() - 0.5) * 0.1, spacing: sp, width: sp * 0.6, color: D.body, alpha: 0.95, rnd: jr, ox: ox * 0.5, oy: oy * 0.5, skip: 0.06 });
    if (D.bands) {
      c.save();
      c.beginPath();
      SKC.path(c, sil, true);
      c.clip();
      for (let b = 0; b < D.bands; b++) {
        const by = cy + (-0.55 + (b + 0.5) * (1.1 / D.bands)) * R + (shapeRnd() - 0.5) * R * 0.1;
        for (let s = 0; s < 3; s++) {
          c.strokeStyle = SKC.css(D.band, 0.75);
          c.lineWidth = R * 0.05;
          c.lineCap = 'round';
          c.beginPath();
          const yy = by + (s - 1) * R * 0.045 + (jr() - 0.5) * 2;
          c.moveTo(cx - R * 1.1, yy);
          c.bezierCurveTo(cx - R * 0.4, yy - R * 0.08, cx + R * 0.3, yy + R * 0.08, cx + R * 1.1, yy - R * 0.02);
          c.stroke();
        }
      }
      c.restore();
    }
    // Shadow: darker cross-hatch outside the lit area (the middle of the body faces away from both lights).
    SKC.hatch(c, sil, {
      angle: 0.75, spacing: sp * 0.9, width: sp * 0.45, color: D.shade, alpha: 0.75, rnd: jr, skip: 0.1,
      clip2: (cc) => {
        cc.beginPath();
        cc.rect(cx - R * 3, cy - R * 3, R * 6, R * 6);
        cc.ellipse(cx - R * 0.22, cy - R * 0.32, R * 0.98, R * 0.9, 0, 0, Math.PI * 2);
        cc.clip('evenodd');
      },
    });
    // Cool light from above: pale blue strokes on the top-left.
    SKC.hatch(c, sil, {
      angle: -0.95, spacing: sp * 1.3, width: sp * 0.4, color: SKETCH.cool, alpha: 0.55, rnd: jr, skip: 0.25,
      clip2: (cc) => {
        cc.beginPath();
        cc.ellipse(cx - R * 0.35, cy - R * 0.55, R * 0.5, R * 0.36, -0.4, 0, Math.PI * 2);
        cc.clip();
      },
    });
    // Craters: ink circles with a shaded inner crescent.
    const craters = [];
    // Fixed slots with very different sizes, never side by side: two equal circles read as eyes.
    const slots = [{ a: 0.55, d: 0.45, r: 0.17 }, { a: 3.95, d: 0.5, r: 0.085 }, { a: 2.25, d: 0.55, r: 0.06 }];
    for (let k = 0; k < (D.craters || 0); k++) {
      const sl = slots[k];
      const a = sl.a + (shapeRnd() - 0.5) * 0.4;
      const d = R * (sl.d + (shapeRnd() - 0.5) * 0.1);
      craters.push({ x: cx + Math.cos(a) * d, y: cy + Math.sin(a) * d, r: R * sl.r });
    }
    for (const cr of craters) {
      const pts = SKC.loop(cr.x, cr.y, cr.r, 10, SKC.harmonics(shapeRnd, 0.12), cr.r * 0.12, jr, cr.r * 0.85);
      SKC.fill(c, pts.map((p) => ({ x: p.x + 1.5, y: p.y + 1.5 })), D.shade, 0.55);
      SKC.pen(c, pts, true, Math.max(1.8, inkW * 0.55), ink, jr, 0.9);
    }
    if (D.scribble && R >= 50) {
      // A scribbled-over crater: a loose spiral, the way people fill a spot with a pen.
      const sx = cx + R * 0.3;
      const sy = cy + R * 0.25;
      c.strokeStyle = SKC.css(ink, 0.8);
      c.lineWidth = 1.8;
      c.beginPath();
      for (let k = 0; k < 26; k++) {
        const a = k * 0.9;
        const rr = R * 0.03 + k * R * 0.0045;
        const px = sx + Math.cos(a) * rr + (jr() - 0.5) * 1.5;
        const py = sy + Math.sin(a) * rr * 0.8;
        if (k === 0) c.moveTo(px, py); else c.lineTo(px, py);
      }
      c.stroke();
    }
    // Warm rim light from the supernova below: broken orange crayon strokes on the bottom edge.
    const rim = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      if (a > 0.2 * Math.PI && a < 0.82 * Math.PI) {
        const p = sil[i];
        rim.push({ x: cx + (p.x - cx) * (1 - 6 / R), y: cy + (p.y - cy) * (1 - 6 / R) });
      }
    }
    if (rim.length > 3) {
      const cut = Math.floor(rim.length * (0.45 + jr() * 0.15));
      c.save();
      c.strokeStyle = SKC.css(SKETCH.orange, 0.9);
      c.lineWidth = Math.max(3, R * 0.075);
      c.lineCap = 'round';
      c.beginPath();
      SKC.path(c, rim.slice(0, cut + 1), false);
      c.stroke();
      c.lineWidth = Math.max(2, R * 0.05);
      c.beginPath();
      SKC.path(c, rim.slice(cut + 1), false);
      c.stroke();
      c.restore();
    }
    // Outline + a partial re-trace (people go over their lines).
    SKC.pen(c, sil, true, inkW, ink, jr, 1);
    const start = Math.floor(jr() * n);
    const retrace = [];
    for (let k = 0; k < Math.floor(n * 0.3); k++) {
      const p = sil[(start + k) % n];
      retrace.push({ x: p.x + 1.4, y: p.y - 1 });
    }
    SKC.pen(c, retrace, false, inkW * 0.45, ink, jr, 0.6);

    if (D.flag && R >= 50 && peaks.length) {
      // Little flag on the tallest peak.
      const top = peaks.reduce((a, b) => (b.h > a.h ? b : a));
      let r = R;
      for (const hm of harm) r += R * hm.a * Math.sin(hm.k * top.a + hm.p);
      r += top.h;
      const fx = cx + Math.cos(top.a) * r;
      const fy = cy + Math.sin(top.a) * r;
      const ph = R * 0.32;
      SKC.pen(c, [{ x: fx, y: fy + 2 }, { x: fx + 1, y: fy - ph * 0.5 }, { x: fx + (jr() - 0.5) * 2, y: fy - ph }], false, 2.4, ink, jr, 1);
      const flag = [{ x: fx + 1, y: fy - ph }, { x: fx + R * 0.24, y: fy - ph * 0.86 + (jr() - 0.5) * 3 }, { x: fx + 1, y: fy - ph * 0.62 }];
      SKC.fill(c, flag.map((p) => ({ x: p.x + 1.5, y: p.y + 1 })), SKETCH.red, 0.95, true);
      SKC.pen(c, flag, true, 2, ink, jr, 1, true);
    }
    if (D.rocket && R >= 50) {
      // Tiny rocket standing on the surface, upper left.
      const a = -2.25;
      let r = R;
      for (const hm of harm) r += R * hm.a * Math.sin(hm.k * a + hm.p);
      const bx = cx + Math.cos(a) * (r - 2);
      const by = cy + Math.sin(a) * (r - 2);
      const s = R * 0.2;
      c.save();
      c.translate(bx, by);
      c.rotate(a + Math.PI / 2);
      const body = [{ x: -s * 0.35, y: 0 }, { x: -s * 0.4, y: -s * 1.1 }, { x: 0, y: -s * 1.75 }, { x: s * 0.4, y: -s * 1.1 }, { x: s * 0.35, y: 0 }];
      SKC.fill(c, body, 0xf4ead0, 0.95);
      SKC.pen(c, body, true, 2, ink, jr, 1);
      SKC.pen(c, [{ x: -s * 0.35, y: -s * 0.25 }, { x: -s * 0.75, y: s * 0.15 }, { x: -s * 0.3, y: -s * 0.02 }], false, 1.8, ink, jr, 1, true);
      SKC.pen(c, [{ x: s * 0.35, y: -s * 0.25 }, { x: s * 0.75, y: s * 0.15 }, { x: s * 0.3, y: -s * 0.02 }], false, 1.8, ink, jr, 1, true);
      c.fillStyle = SKC.css(SKETCH.red, 0.9);
      c.beginPath();
      c.ellipse(0, -s * 1.0, s * 0.17, s * 0.15, 0, 0, Math.PI * 2);
      c.fill();
      c.restore();
    }
    if (D.moon) {
      const ma = -0.6;
      const mr = R * 0.2;
      const mx = cx + Math.cos(ma) * R * 1.45;
      const my = cy + Math.sin(ma) * R * 1.45;
      // Dotted orbit path drawn by hand.
      c.strokeStyle = SKC.css(ink, 0.45);
      c.lineWidth = 1.6;
      c.lineCap = 'round';
      for (let k = 0; k < 9; k++) {
        const a0 = ma + 0.35 + k * 0.22;
        c.beginPath();
        c.arc(cx, cy, R * 1.45 + (jr() - 0.5) * 2, a0, a0 + 0.09);
        c.stroke();
      }
      const mp = SKC.loop(mx, my, mr, 12, SKC.harmonics(shapeRnd, 0.1), mr * 0.1, jr);
      SKC.fill(c, mp.map((p) => ({ x: p.x + 1.5, y: p.y + 1.2 })), 0x8f8a99, 1);
      SKC.hatch(c, mp, { angle: -0.95, spacing: 4, width: 2.2, color: 0xd9d2c0, alpha: 0.8, rnd: jr, skip: 0.1 });
      SKC.pen(c, mp, true, Math.max(2, inkW * 0.7), ink, jr, 1);
    }
    if (D.ring) drawRing(0, Math.PI);
  },

  // highlighted: comet could grab it / is orbiting it. isTarget: a release now flies to it.
  drawPlanet(g, p, highlighted, isTarget, ctx) {
    const s = ART.planetStyle(p);
    const t = ctx.time;
    const variant = (ART.boilFrame(t) + s.seed) % SKETCH.variants;
    const key = ART.planetTextureFor(g.scene, s.R, s.design, ART.inkMode, ART.ink, variant);
    const img = ART.bodyImage(g, p, key);
    const w = p.wobble || 0;
    const jig = w * 0.14 * Math.sin(t * 32);
    img.setPosition(p.x, p.y);
    img.setScale((1 + jig) * (p.radius / s.R), (1 - jig) * (p.radius / s.R));

    const R = p.radius;
    const orbiting = ctx.orbitPlanet === p;
    const front = ctx.front || g;
    const rnd = artRandom(ART.boilFrame(t) * 13 + s.seed);
    if (isTarget) {
      // Crayon outline hugging the planet: green = a release reaches it, gold = PERFECT.
      const perfect = ctx.aimKind === 'perfect';
      const col = perfect ? SKETCH.gold : SKETCH.green;
      const pts = ART.wobblyLoop(p.x, p.y, R + 13, R + 13, 30, 6 / (R + 13), rnd, rnd());
      ART.pen(front, pts, true, 12, SKETCH.shadowInk, 0.45, rnd);
      ART.pen(front, pts, true, 6.5, col, 1, rnd);
      const pts2 = ART.wobblyLoop(p.x + 2, p.y - 1, R + 20, R + 19, 30, 6 / (R + 20), rnd, rnd());
      ART.pen(front, pts2.slice(0, 18), false, 3, col, 0.8, rnd);
    } else if (highlighted && !orbiting) {
      // Dashed pencil circle at the REAL grab range (Gravity Well widens it).
      const bonus = ctx.grabRangeBonus || 0;
      const zone = R + (ctx.grabRange !== undefined ? ctx.grabRange : TUNING.grabRange + bonus);
      ART.dashedRing(g, p.x, p.y, zone, 26, ART.boilFrame(t) * 0.02, 3.5, ART.ink, 0.35, rnd);
      // With the bonus the ring is gone over a second time in the orbit family's teal pencil,
      // slightly off the first pass, so the bigger reach reads as "drawn wider".
      if (bonus > 0) ART.dashedRing(g, p.x + 1.5, p.y - 1, zone + 2, 26, ART.boilFrame(t) * 0.02 + 0.06, 5, 0x5fd3c0, 0.75, rnd);
    }
  },

  // ---------- supernova ----------

  // A crayon wall of fire with a pen-drawn edge, rising heat squiggles and an angry face.
  drawNova(g, novaY, view, ctx) {
    if (novaY > view.bottom + 40) return;
    const t = ctx.time;
    const bf = ART.boilFrame(t);
    const danger = ctx.danger || 0;
    const left = view.left - 30;
    const right = view.right + 30;
    const step = Math.max(28, (right - left) / 26);
    const bottom = view.bottom + 20;
    const count = Math.ceil((right - left) / step) + 1;

    // Heat squiggles rising off the front (short pencil lines, not a full-width glow).
    for (let k = 0; k < 5; k++) {
      const life = (t * 0.6 + k / 5) % 1;
      const r = artRandom(k * 97 + Math.floor(t * 0.6 + k / 5) * 13);
      const x0 = left + r() * (right - left);
      const y0 = novaY - 40 - life * 220;
      const pts = [];
      for (let i = 0; i < 7; i++) pts.push({ x: x0 + i * 14, y: y0 + Math.sin(i * 1.4 + bf * 0.9) * 6 });
      g.lineStyle(3, SKETCH.orange, 0.55 * (1 - life));
      g.strokePoints(pts, false);
    }

    const layers = [
      { off: 0, color: SKETCH.yellow, hatch: SKETCH.orange },
      { off: 34, color: SKETCH.orange, hatch: SKETCH.red },
      { off: 100, color: SKETCH.red, hatch: SKETCH.deepRed },
      { off: 210, color: SKETCH.deepRed, hatch: null },
    ];
    let edge = null;
    for (const layer of layers) {
      if (novaY + layer.off - 40 > bottom) continue;
      const pts = [];
      for (let i = 0; i < count; i++) {
        const x = left + i * step;
        const r = artRandom(i * 31 + bf * 977 + layer.off);
        // Slow swell (continuous) + hand-drawn flame points that re-wobble with the boil.
        const swell = Math.sin(x * 0.016 + t * 2.5 + layer.off) * 12;
        // Uneven tongues (r*r: mostly short, now and then a tall lick) so the edge never reads
        // as a regular sawtooth.
        const tongue = (i % 2 ? -(8 + r() * r() * 46) : r() * 8) * (1 + danger * 0.6);
        pts.push({ x, y: novaY + layer.off + swell + tongue });
      }
      if (!edge) edge = pts;
      const poly = pts.slice();
      poly.push({ x: right + step, y: bottom });
      poly.push({ x: left, y: bottom });
      g.fillStyle(layer.color, 1);
      g.fillPoints(poly, true);
      if (layer.hatch && novaY + layer.off < view.bottom) {
        // Crayon strokes leaning down from the layer's edge.
        g.lineStyle(4, layer.hatch, 0.55);
        for (let i = 0; i < count - 1; i++) {
          const r = artRandom(i * 17 + bf * 131 + layer.off * 3);
          const p = pts[i];
          const len = 26 + r() * 22;
          g.lineBetween(p.x + step * 0.3, p.y + 10 + r() * 6, p.x + step * 0.3 - len * 0.5, p.y + 10 + len);
          if (r() < 0.6) g.lineBetween(p.x + step * 0.75, p.y + 14, p.x + step * 0.75 - len * 0.4, p.y + 12 + len * 0.8);
        }
      }
    }
    if (edge) {
      // Pen outline along the front edge, in the page's ink.
      ART.pen(g, edge, false, 5, ART.ink, 0.95, artRandom(bf * 7 + 1));
    }

    // Embers: tiny ink crosses floating up.
    for (let i = 0; i < 8; i++) {
      const life = (t * 0.8 + i * 0.37) % 1;
      const r = artRandom(i * 53 + bf);
      const ex = left + ((i * 211 + Math.floor(t * 0.8 + i * 0.37) * 97) % 1000) / 1000 * (right - left);
      const ey = novaY - 20 - life * 170;
      ART.asterisk(g, ex + Math.sin(t * 2 + i) * 8, ey, 5 + 4 * (1 - life), i % 2 ? SKETCH.yellow : SKETCH.orange, 1 - life, 2.5, r);
    }

    ART.drawNovaFace(g, novaY, view, ctx, danger);
  },

  drawNovaFace(g, novaY, view, ctx, danger) {
    const t = ctx.time;
    const bf = ART.boilFrame(t);
    const rnd = artRandom(bf * 41 + 5);
    const cometX = ctx.comet ? ctx.comet.x : (view.left + view.right) / 2;
    // The face slides lazily after the comet, like it is hunting it.
    if (ART._novaX === undefined || Math.abs(ART._novaX - cometX) > 1500) ART._novaX = cometX;
    ART._novaX += (cometX - ART._novaX) * 0.03;
    const fx = Phaser.Math.Clamp(ART._novaX, view.left + 180, view.right - 180);
    const bob = Math.sin(t * 2.4) * 6;
    const er = 26 + danger * 14;
    const gap = 70 + danger * 14;
    const ey = novaY + 30 + bob;   // eyes peek just under the flame edge, above the bottom HUD
    const look = ctx.comet ? ART.lookAt(fx, ey, ctx.comet.x, ctx.comet.y) : { x: 0, y: -1 };
    const line = 0x3a0d10;
    for (const side of [-1, 1]) {
      const x = fx + side * gap;
      const eye = ART.wobblyLoop(x, ey, er * 1.05, er * 0.9, 10, 0.14, rnd, rnd());
      g.fillStyle(0xfff3d6, 1);
      g.fillPoints(eye.map((p) => ({ x: p.x + 2, y: p.y + 2 })), true);
      ART.pen(g, eye, true, 5, line, 1, rnd);
      g.fillStyle(line, 1);
      g.fillCircle(x + look.x * er * 0.42, ey + look.y * er * 0.42, er * 0.42);
      // Angry brow: two heavy strokes slanting down toward the middle.
      // Inner end (toward the nose) low, outer end high: a scowl, not a worried look.
      const bx0 = x - side * er * 1.3;   // inner end
      const bx1 = x + side * er * 1.1;   // outer end
      const by0 = ey - er * 1.0;
      const by1 = ey - er * 1.75 + danger * 4;
      g.lineStyle(10, line, 1);
      g.lineBetween(bx0, by0 + (rnd() - 0.5) * 3, bx1, by1 + (rnd() - 0.5) * 3);
      g.lineStyle(4, line, 0.8);
      g.lineBetween(bx0 + side * 4, by0 - 7, bx1 - side * 6, by1 - 5);
    }
    // Jagged chomping mouth: dark fill, cream zigzag teeth, pen outline.
    const chomp = 0.5 + 0.5 * Math.sin(t * (5 + danger * 8));
    const mw = 110 + danger * 70;
    const mh = 26 + danger * 34 * chomp + 8;
    const my = ey + er + 38;
    const mouth = ART.wobblyLoop(fx, my + mh * 0.3, mw, mh, 14, 0.12, rnd, rnd());
    g.fillStyle(line, 1);
    g.fillPoints(mouth, true);
    const teeth = [];
    const nT = 7;
    for (let i = 0; i <= nT * 2; i++) {
      const x = fx - mw * 0.78 + (i * mw * 1.56) / (nT * 2);
      teeth.push({ x, y: my - mh * 0.45 + (i % 2 ? 18 : 0) + (rnd() - 0.5) * 3 });
    }
    g.lineStyle(5, 0xfff3d6, 1);
    g.strokePoints(teeth, false);
    ART.pen(g, mouth, true, 4, SKETCH.deepRed, 1, rnd);
  },

  // ---------- hazards ----------

  asteroidTexture(scene, design, variant) {
    const key = 'ast_' + design + '_' + ART.inkMode + '_' + variant;
    const ink = ART.ink;
    const R = ASTEROID_BASE_R;
    return ART.canvasTexture(scene, key, R * 2.6 + 20, R * 2.6 + 20, (c, w, h) => {
      const cx = w / 2;
      const cy = h / 2;
      const shapeRnd = artRandom(design * 613 + 3);
      const jr = artRandom(design * 211 + variant * 5113 + 9);
      const n = 9 + (design % 3);
      const pts = [];
      const base = [];
      for (let i = 0; i < n; i++) base.push(0.74 + shapeRnd() * 0.34);
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + (shapeRnd() - 0.5) * 0.25;
        const r = R * base[i] + (jr() - 0.5) * 3;
        pts.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });
      }
      SKC.fill(c, pts.map((p) => ({ x: p.x + 2, y: p.y + 2 })), 0x5b5049, 1, true);
      SKC.hatch(c, pts, { angle: -0.9, spacing: 5, width: 2.6, color: 0xa8998a, alpha: 0.9, rnd: jr, straight: true, skip: 0.1 });
      SKC.hatch(c, pts, { angle: 0.7, spacing: 7, width: 2, color: 0x3a312c, alpha: 0.7, rnd: jr, straight: true, skip: 0.3,
        clip2: (cc) => { cc.beginPath(); cc.rect(cx - R, cy, R * 2, R * 1.4); cc.clip(); } });
      // Scribble: a loose zigzag over the rock.
      c.strokeStyle = SKC.css(ink, 0.55);
      c.lineWidth = 1.6;
      c.beginPath();
      for (let k = 0; k < 7; k++) {
        const px = cx - R * 0.45 + k * R * 0.14 + (jr() - 0.5) * 3;
        const py = cy - R * 0.1 + (k % 2 ? R * 0.28 : -R * 0.12) + (jr() - 0.5) * 3;
        if (k === 0) c.moveTo(px, py); else c.lineTo(px, py);
      }
      c.stroke();
      const a0 = shapeRnd() * 6.3;
      for (let k = 0; k < 2; k++) {
        const a = a0 + k * 2.4;
        const d = R * (0.4 + k * 0.1);
        const cr = R * (0.17 - k * 0.09);
        const cp = SKC.loop(cx + Math.cos(a) * d, cy + Math.sin(a) * d, cr, 8, SKC.harmonics(shapeRnd, 0.2), 1.5, jr);
        SKC.pen(c, cp, true, 1.8, ink, jr, 0.9);
      }
      SKC.pen(c, pts, true, 3.6, ink, jr, 1, true);
      // Warm rim from below.
      c.strokeStyle = SKC.css(SKETCH.orange, 0.8);
      c.lineWidth = 3;
      c.beginPath();
      c.arc(cx, cy, R * 0.72, 0.5, 2.6);
      c.stroke();
    });
  },

  drawAsteroid(g, a, ctx) {
    const R = a.radius;
    const t = ctx.time;
    const bf = ART.boilFrame(t);
    if (a._design === undefined) a._design = Math.floor(Math.random() * ASTEROID_DESIGNS);
    const key = ART.asteroidTexture(g.scene, a._design, bf % SKETCH.variants);
    const img = ART.bodyImage(g, a, key);
    img.setPosition(a.x, a.y);
    img.setScale(R / ASTEROID_BASE_R);
    // Stop-motion spin: rotation advances with the boil, not every frame.
    img.setRotation(Math.round(a.rot * 5) / 5);
    // "Zip" marks behind the drift direction.
    if (a.heading !== undefined) {
      const bx = -Math.cos(a.heading);
      const by = -Math.sin(a.heading);
      const nx = -by;
      const ny = bx;
      const rnd = artRandom(bf * 19 + Math.floor(a.homeY));
      g.lineStyle(3, ART.ink, 0.55);
      for (let k = -1; k <= 1; k++) {
        const s = R + 10 + rnd() * 8;
        const len = 18 + rnd() * 16 - Math.abs(k) * 6;
        const ox = a.x + nx * k * R * 0.45;
        const oy = a.y + ny * k * R * 0.45;
        g.lineBetween(ox + bx * s, oy + by * s, ox + bx * (s + len), oy + by * (s + len));
      }
    }
  },

  blackHoleTexture(scene, variant) {
    const key = 'bh_' + ART.inkMode + '_' + variant;
    const ink = ART.ink;
    const R = TUNING.blackHoleRadius;
    const S = (R + 110) * 2;
    return ART.canvasTexture(scene, key, S, S, (c, w, h) => {
      const cx = w / 2;
      const cy = h / 2;
      const jr = artRandom(variant * 733 + 21);
      // Two ink spiral arms + a mauve crayon arm between them.
      for (let arm = 0; arm < 3; arm++) {
        const pts = [];
        const phase = arm * ((Math.PI * 2) / 3);
        for (let k = 0; k <= 40; k++) {
          const a = phase + k * 0.33;
          const r = R + 4 + k * 2.3 + (jr() - 0.5) * 3;
          pts.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });
        }
        if (arm === 2) {
          c.save();
          c.strokeStyle = SKC.css(0xb07ad0, 0.85);
          c.lineWidth = 7;
          c.lineCap = 'round';
          c.beginPath();
          SKC.path(c, pts, false);
          c.stroke();
          c.restore();
        } else {
          SKC.pen(c, pts, false, arm === 0 ? 4.5 : 3, ink, jr, arm === 0 ? 1 : 0.75);
        }
      }
      // Core: dense dark cross-hatch inside a lopsided pen loop.
      const core = SKC.loop(cx, cy, R + 4, 16, SKC.harmonics(artRandom(77), 0.08), 3, jr);
      SKC.fill(c, core, 0x07060b, 1);
      SKC.hatch(c, core, { angle: 0.8, spacing: 5, width: 1.4, color: 0x3c2b52, alpha: 0.9, rnd: jr });
      SKC.hatch(c, core, { angle: -0.8, spacing: 6, width: 1.2, color: 0x3c2b52, alpha: 0.8, rnd: jr });
      SKC.pen(c, core, true, 4, ink, jr, 1);
    });
  },

  drawBlackHole(g, h, ctx) {
    const t = ctx.time;
    const bf = ART.boilFrame(t);
    const pullR = TUNING.blackHolePullRadius;
    const rnd = artRandom(bf * 29 + Math.floor(h.y));
    // Pull zone: a dashed pencil circle plus a few dashes being sucked in.
    ART.dashedRing(g, h.x, h.y, pullR, 22, -bf * 0.03, 3, ART.ink, 0.3, rnd);
    g.lineStyle(2.5, ART.ink, 0.4);
    for (let i = 0; i < 5; i++) {
      const life = (t * 0.5 + i * 0.2) % 1;
      const a = i * 1.26 - life * 2.2;
      const r0 = pullR * (0.95 - life * 0.7);
      const r1 = r0 - 18;
      g.lineBetween(h.x + Math.cos(a) * r0, h.y + Math.sin(a) * r0, h.x + Math.cos(a + 0.12) * r1, h.y + Math.sin(a + 0.12) * r1);
    }
    const key = ART.blackHoleTexture(g.scene, bf % SKETCH.variants);
    const img = ART.bodyImage(g, h, key);
    img.setPosition(h.x, h.y);
    img.setRotation(-bf * 0.16);   // stop-motion swirl
  },

  // ---------- aim guide ----------

  // Three ink chevrons sliding ahead of the comet along (dx, dy).
  // kind: 'none' = no target (page ink), 'target' = will reach a planet (green), 'perfect' = gold.
  drawAimGuide(g, x, y, dx, dy, length, kind, ctx) {
    const t = ctx.time;
    const bf = ART.boilFrame(t);
    const rnd = artRandom(bf * 37 + 11);
    const color = kind === 'perfect' ? SKETCH.gold : kind === 'target' ? SKETCH.green : ART.ink;
    const backing = kind === 'none' ? ART.backing : SKETCH.shadowInk;
    const nx = -dy;
    const ny = dx;
    const start = TUNING.cometRadius + 22;
    const slide = (t * (kind === 'none' ? 1.5 : 3)) % 1;
    const size = kind === 'none' ? 13 : 19;
    for (let i = 0; i < 3; i++) {
      const f = (i + slide) / 3;
      const d = start + f * 84;
      const cx = x + dx * d;
      const cy = y + dy * d;
      const fade = Math.sin(f * Math.PI);
      const s = size * (0.85 + 0.3 * f);
      const j = () => (rnd() - 0.5) * 3;
      const pts = [
        { x: cx - dx * s + nx * s + j(), y: cy - dy * s + ny * s + j() },
        { x: cx + j(), y: cy + j() },
        { x: cx - dx * s - nx * s + j(), y: cy - dy * s - ny * s + j() },
      ];
      g.lineStyle(15, backing, 0.6 * fade);
      g.strokePoints(pts, false);
      g.lineStyle(8 + (rnd() - 0.5) * 2.5, color, (kind === 'none' ? 0.7 : 1) * fade);
      g.strokePoints(pts, false);
    }
    if (kind === 'perfect') {
      const tx = x + dx * (start + 106);
      const ty = y + dy * (start + 106);
      ART.asterisk(g, tx, ty, 13, SKETCH.shadowInk, 0.6, 7, artRandom(bf));
      ART.asterisk(g, tx, ty, 12, SKETCH.gold, 1, 4, artRandom(bf));
    }
  },

  // ---------- comet ----------

  // trail: recent positions, newest first.
  drawComet(g, comet, trail, ctx) {
    const t = ctx.time;
    const bf = ART.boilFrame(t);
    const rnd = artRandom(bf * 7919 + 13);
    const sf = ctx.speedFraction || 0;
    const speedCol = speedColor(sf);
    const body = lerpColor(speedCol, SKETCH.yellow, 0.55);
    const r = TUNING.cometRadius;
    const dir = ART.cometDir(comet, trail);
    const n = trail.length;
    const ink = ART.ink;
    // Afterburner: the tail (never the head) is redrawn in blue crayon, wider and longer.
    const burn = Math.max(0, Math.min(1, ctx.afterburner || 0));
    const tint = (c, blue) => (burn > 0 ? lerpColor(c, blue, burn) : c);

    // Tail: colored-pencil strands that converge toward the end, plus cross strokes.
    if (n > 2) {
      const wide = 1 + 0.35 * burn;
      const strands = [
        { off: -0.85 * wide, c: tint(SKETCH.red, 0x3a5fd8), w: 5, reach: 0.75 },
        { off: 0.85 * wide, c: tint(SKETCH.red, 0x3a5fd8), w: 5, reach: 0.7 },
        { off: -0.5 * wide, c: tint(SKETCH.orange, 0x5aa8f0), w: 6, reach: 0.9 },
        { off: 0.5 * wide, c: tint(SKETCH.orange, 0x5aa8f0), w: 6, reach: 0.88 },
        { off: -0.15, c: tint(body, 0xa9dcff), w: 7, reach: 1 },
        { off: 0.2, c: tint(lerpColor(body, 0xffffff, 0.45), 0xf4fbff), w: 5, reach: 0.95 },
      ];
      const normals = [];
      for (let i = 0; i < n; i++) {
        const a = trail[Math.max(0, i - 1)];
        const b = trail[Math.min(n - 1, i + 1)];
        let tx = a.x - b.x;
        let ty = a.y - b.y;
        const len = Math.hypot(tx, ty) || 1;
        normals.push({ x: -ty / len, y: tx / len });
      }
      for (const s of strands) {
        const m = Math.max(2, Math.floor(n * s.reach));
        const pts = [];
        for (let i = 0; i < m; i++) {
          const f = 1 - i / m;
          const spread = s.off * r * (0.35 + 0.75 * f) + (rnd() - 0.5) * 4;
          pts.push({ x: trail[i].x + normals[i].x * spread, y: trail[i].y + normals[i].y * spread });
        }
        g.lineStyle(s.w, s.c, 0.95);
        g.strokePoints(pts, false);
      }
      // Diagonal crayon strokes across the tail.
      g.lineStyle(3, tint(SKETCH.yellow, 0xdff2ff), 0.85);
      for (let i = 2; i < n - 2; i += 3) {
        const f = 1 - i / n;
        const w = r * (0.5 + 0.6 * f);
        const p = trail[i];
        const q = trail[Math.min(n - 1, i + 2)];
        const nn = normals[i];
        g.lineBetween(p.x + nn.x * w, p.y + nn.y * w, q.x - nn.x * w, q.y - nn.y * w);
      }
      if (burn > 0.05 && n > 6) {
        // Flame licks: short blue crayon flicks peeling off both sides of the tail, outward and back.
        for (let i = 3; i < n - 2; i += 4) {
          const f = 1 - i / n;
          const p = trail[i];
          const q = trail[Math.min(n - 1, i + 3)];
          const nn = normals[i];
          for (const side of [-1, 1]) {
            const w0 = r * (0.7 + 0.7 * f) * wide;
            const out = r * (0.5 + rnd() * 0.6) * f * burn;
            g.lineStyle(4, i % 8 === 3 ? 0x2f4fc0 : 0x6fbaff, burn * (0.5 + 0.5 * f));
            g.lineBetween(p.x + nn.x * w0 * side, p.y + nn.y * w0 * side,
              q.x + nn.x * (w0 + out) * side, q.y + nn.y * (w0 + out) * side);
          }
        }
      }
    }

    // PERFECT / zone bursts sit behind the head so the face stays readable.
    const zonePulse = Math.max(0, Math.min(1, ctx.zonePulse || 0));
    if (zonePulse > 0) ART.drawShockBurst(g, comet.x, comet.y, zonePulse, ink, 1.6, t);
    const perfectPulse = Math.max(0, Math.min(1, ctx.perfectPulse || 0));
    if (perfectPulse > 0) ART.drawShockBurst(g, comet.x, comet.y, perfectPulse, SKETCH.gold, 1, t);

    const stretch = Math.max(1, Math.min(2.2, ctx.stretch || 1));
    const squash = Math.max(0, Math.min(1, ctx.squash || 0));
    const alongScale = stretch * (1 - 0.32 * squash);
    const acrossScale = (1 / Math.sqrt(stretch)) * (1 + 0.38 * squash);
    const angle = Math.atan2(dir.y, dir.x);
    g.save();
    g.translateCanvas(comet.x, comet.y);
    g.rotateCanvas(angle);
    g.scaleCanvas(alongScale, acrossScale);
    // Flame crown: jagged pen-outlined tongues licking backward.
    const j = () => (rnd() - 0.5) * r * 0.18;
    const long = 1 + 0.5 * burn;   // the afterburner crown licks further back
    const crown = [
      { x: r * 0.3, y: -r * 1.0 },
      { x: -r * 0.9 * long + j(), y: -r * 1.35 + j() },
      { x: -r * 0.8, y: -r * 0.55 },
      { x: -r * 2.3 * long + j(), y: j() * 0.6 },
      { x: -r * 0.8, y: r * 0.55 },
      { x: -r * 0.9 * long + j(), y: r * 1.35 + j() },
      { x: r * 0.3, y: r * 1.0 },
    ];
    g.fillStyle(tint(SKETCH.orange, 0x4f8fe8), 1);
    g.fillPoints(crown, true);
    g.fillStyle(tint(SKETCH.yellow, 0xd8efff), 1);
    g.fillTriangle(r * 0.2, -r * 0.6, r * 0.2, r * 0.6, -r * 1.6 * long + j(), j() * 0.5);
    ART.pen(g, crown, true, 3.5, ink, 1, rnd);
    // Head: sticker backing, misregistered crayon fill, hatching, pen outline.
    const head = ART.wobblyLoop(0, 0, r, r, 12, 0.1, rnd, rnd());
    g.fillStyle(ART.backing, 0.9);
    g.fillCircle(0, 0, r + 6);
    g.fillStyle(body, 1);
    g.fillPoints(head.map((p) => ({ x: p.x + 2.5, y: p.y + 2 })), true);
    ART.hatchCircle(g, -r * 0.15, r * 0.25, r * 0.75, -0.9, 6, 3, SKETCH.orange, 0.8, rnd);
    ART.pen(g, head, true, 5.5, ink, 1, rnd);
    g.restore();
    // Cool light from above: two short pale strokes on the top of the head.
    g.lineStyle(3, 0xffffff, 0.8);
    g.lineBetween(comet.x - r * 0.55, comet.y - r * 0.3, comet.x - r * 0.25, comet.y - r * 0.62);
    g.lineBetween(comet.x - r * 0.3, comet.y - r * 0.2, comet.x - r * 0.08, comet.y - r * 0.45);

    ART.drawCometFace(g, comet.x + dir.x * r * 0.2, comet.y + dir.y * r * 0.2, r, dir, ctx, rnd);
    if (ctx.shieldReady) ART.drawShieldBubble(g, comet.x, comet.y, r, t);
  },

  // Heat Shield charge ready: a pink bubble drawn by hand around the comet. Two pen passes that
  // do not meet (the loop overshoots its start), a sparse pink pencil hatch on the lower-right
  // inside edge, and one short curved highlight stroke. No fill, so the face stays readable.
  drawShieldBubble(g, x, y, r, t) {
    const bf = ART.boilFrame(t);
    const rnd = artRandom(bf * 53 + 17);
    const pink = 0xff7fbf;
    const R = r * 2.05;
    const loop = ART.wobblyLoop(x, y, R, R * 0.96, 18, 0.06, rnd, rnd() * 6);
    // Overshoot: repeat the first two points shifted, the way a hand never closes a circle.
    loop.push({ x: loop[0].x + 3, y: loop[0].y + 2 }, { x: loop[1].x + 4, y: loop[1].y + 3 });
    ART.pen(g, loop, false, 9, ART.backing, 0.45, rnd);
    ART.pen(g, loop, false, 5, pink, 1, rnd);
    const inner = ART.wobblyLoop(x + 2, y + 1, R - 7, R - 8, 14, 0.06, rnd, rnd() * 6);
    ART.pen(g, inner.slice(2, 9), false, 2.2, pink, 0.7, rnd);
    // Pencil shading on the lower-right inner edge.
    g.lineStyle(2.5, pink, 0.55);
    for (let k = 0; k < 6; k++) {
      const a = 0.15 + k * 0.22;
      const r0 = R - 4;
      const r1 = R - 13 - rnd() * 5;
      g.lineBetween(x + Math.cos(a) * r0, y + Math.sin(a) * r0, x + Math.cos(a + 0.12) * r1, y + Math.sin(a + 0.12) * r1);
    }
    // Highlight: one short curved white stroke upper left.
    const hl = [];
    for (let k = 0; k <= 4; k++) {
      const a = Math.PI * (1.1 + k * 0.07);
      hl.push({ x: x + Math.cos(a) * (R - 10), y: y + Math.sin(a) * (R - 10) });
    }
    g.lineStyle(4, 0xffffff, 0.85);
    g.strokePoints(hl, false);
  },

  // Ink doodle burst around (x, y): a dashed ring + pen rays + a few asterisks.
  // p: 1 at the moment of the event, fading to 0. scale widens the burst.
  drawShockBurst(g, x, y, p, color, scale, t) {
    const r = TUNING.cometRadius;
    const k = 1 - p;
    const ease = 1 - (1 - k) * (1 - k);
    const rnd = artRandom(ART.boilFrame(t || 0) * 61 + 3);
    const ringR = r * 1.6 + ease * 140 * scale;
    ART.dashedRing(g, x, y, ringR, 14, rnd() * 6, 9 * p + 3, SKETCH.shadowInk, 0.4 * p, rnd);
    ART.dashedRing(g, x, y, ringR, 14, rnd() * 6, 5 * p + 2, color, Math.min(1, p * 1.5), rnd);
    const rays = 9;
    for (let i = 0; i < rays; i++) {
      const a = (i / rays) * Math.PI * 2 + (rnd() - 0.5) * 0.3;
      const from = r * 1.3 + ease * 70 * scale;
      const len = (i % 2 ? 18 : 30) * scale * p + 6;
      g.lineStyle(4 * p + 2, i % 2 ? ART.ink : color, p);
      g.lineBetween(x + Math.cos(a) * from, y + Math.sin(a) * from, x + Math.cos(a) * (from + len), y + Math.sin(a) * (from + len));
    }
    for (let i = 0; i < 3; i++) {
      const a = i * 2.1 + 0.5;
      ART.asterisk(g, x + Math.cos(a) * ringR, y + Math.sin(a) * ringR, 7 + 8 * p, color, p, 3, rnd);
    }
  },

  // Expression priority: close call > worried > happy (perfect chain) > determined > calm.
  // Drawn with dark ink lines on the yellow head.
  drawCometFace(g, x, y, r, dir, ctx, rnd) {
    rnd = rnd || artRandom(ART.boilFrame(ctx.time) * 7 + 1);
    const t = ctx.time;
    const danger = ctx.danger || 0;
    const closeCall = ctx.closeCall || 0;
    const happy = (ctx.perfectChain || 0) > 0;
    const sf = ctx.speedFraction || 0;
    const blink = (t % 3.7) < 0.12;
    const ex = r * 0.36;
    const ey = y - r * 0.12;
    const lx = dir.x;
    const ly = dir.y;
    const line = SKETCH.dark;
    let er = r * 0.3;
    let mood = 'calm';
    if (closeCall > 0.3) mood = 'phew';
    else if (danger > 0.6) mood = 'worried';
    else if (happy) mood = 'happy';
    else if (sf > 0.4) mood = 'determined';
    if (mood === 'worried' || mood === 'phew') er = r * 0.34;
    const j = () => (rnd() - 0.5) * 1.6;

    if (mood === 'happy') {
      // Blush as three little crayon slashes per cheek.
      g.lineStyle(2.5, SKETCH.red, 0.8);
      for (const side of [-1, 1]) {
        const bx = x + side * (ex + er * 0.7);
        for (let k = 0; k < 3; k++) g.lineBetween(bx - 4 + k * 4, ey + er * 1.7, bx - 1 + k * 4, ey + er * 1.15);
      }
      g.lineStyle(4, line, 1);
      for (const side of [-1, 1]) {
        g.beginPath();
        g.moveTo(x + side * ex - er * 0.8, ey + j());
        g.lineTo(x + side * ex + j(), ey - er * 0.7);
        g.lineTo(x + side * ex + er * 0.8, ey + j());
        g.strokePath();
      }
      const mouth = [];
      for (let k = 0; k <= 6; k++) {
        const a = (k / 6) * Math.PI;
        mouth.push({ x: x + Math.cos(a) * er * 0.95 + j(), y: ey + er * 1.3 + Math.sin(a) * er * 0.8 + j() });
      }
      g.fillStyle(line, 1);
      g.fillPoints(mouth, true);
      return;
    }
    if (blink) {
      g.lineStyle(4, line, 1);
      g.lineBetween(x - ex - er * 0.8, ey + j(), x - ex + er * 0.8, ey + j());
      g.lineBetween(x + ex - er * 0.8, ey + j(), x + ex + er * 0.8, ey + j());
    } else {
      for (const side of [-1, 1]) {
        const cx = x + side * ex;
        const eye = ART.wobblyLoop(cx, ey, er, er * 1.1, 8, 0.16, rnd, rnd());
        g.fillStyle(0xfffaf0, 1);
        g.fillPoints(eye, true);
        ART.pen(g, eye, true, 3, line, 1, rnd);
        const pr = er * (mood === 'phew' ? 0.32 : 0.5);
        g.fillStyle(line, 1);
        g.fillCircle(cx + lx * (er - pr) * 0.7, ey + ly * (er - pr) * 0.7, pr);
      }
    }
    g.lineStyle(4, line, 1);
    if (mood === 'determined') {
      g.lineBetween(x - ex - er, ey - er * 1.3 + j(), x - ex + er * 0.9, ey - er * 0.8);
      g.lineBetween(x + ex + er, ey - er * 1.3 + j(), x + ex - er * 0.9, ey - er * 0.8);
      g.lineBetween(x - er * 0.55, ey + er * 1.7 + j(), x + er * 0.65, ey + er * 1.55 + j());
    } else if (mood === 'worried' || mood === 'phew') {
      g.lineBetween(x - ex - er, ey - er * 1.1, x - ex + er * 0.8, ey - er * 1.6 + j());
      g.lineBetween(x + ex + er, ey - er * 1.1, x + ex - er * 0.8, ey - er * 1.6 + j());
      const my = ey + er * 1.8;
      if (mood === 'phew') {
        const o = ART.wobblyLoop(x, my, er * 0.45, er * 0.5, 7, 0.2, rnd, 0);
        g.fillStyle(line, 1);
        g.fillPoints(o, true);
      } else {
        g.beginPath();
        g.moveTo(x - er * 0.8, my + j());
        g.lineTo(x - er * 0.3, my - 3 + j());
        g.lineTo(x + er * 0.2, my + 3 + j());
        g.lineTo(x + er * 0.8, my + j());
        g.strokePath();
      }
      // Sweat drop: pen outline, cool blue crayon inside.
      const dropX = x + r * 0.95;
      const dropY = y - r * 0.6 + ((t * 1.5) % 1) * 10;
      const drop = [
        { x: dropX, y: dropY - 14 }, { x: dropX + 6, y: dropY - 2 }, { x: dropX + 5, y: dropY + 5 },
        { x: dropX, y: dropY + 7 }, { x: dropX - 5, y: dropY + 5 }, { x: dropX - 6, y: dropY - 2 },
      ];
      g.fillStyle(SKETCH.cool, 1);
      g.fillPoints(drop, true);
      ART.pen(g, drop, true, 2.5, line, 1, rnd);
    } else {
      const smile = [];
      for (let k = 0; k <= 4; k++) {
        const a = Math.PI * (0.2 + 0.6 * (k / 4));
        smile.push({ x: x + Math.cos(a) * er * 0.8 + j(), y: ey + er * 1.15 + Math.sin(a) * er * 0.6 });
      }
      g.strokePoints(smile, false);
    }
  },

  // Ink doodle burst used for game events (GameScene.burst). b: { x, y, color, count, reach, age (0..1), seed }.
  drawBurst(g, b, t) {
    const k = b.age;
    const color = ART.crayon(b.color);
    const ease = 1 - (1 - k) * (1 - k);
    const rnd = artRandom(b.seed + ART.boilFrame(t) * 3);
    const alpha = 1 - k * k;
    for (let i = 0; i < b.count; i++) {
      const a = (i / b.count) * Math.PI * 2 + (b.seed % 7) + (rnd() - 0.5) * 0.35;
      const r0 = 14 + b.reach * 0.55 * ease;
      const len = 10 + b.reach * 0.3 * (1 - k);
      g.lineStyle(5 * (1 - k) + 2, i % 3 === 0 ? ART.ink : color, alpha);
      g.lineBetween(b.x + Math.cos(a) * r0, b.y + Math.sin(a) * r0, b.x + Math.cos(a) * (r0 + len), b.y + Math.sin(a) * (r0 + len));
    }
    if (b.count >= 8 && k < 0.7) {
      ART.asterisk(g, b.x + (rnd() - 0.5) * b.reach * 0.6, b.y + (rnd() - 0.5) * b.reach * 0.6, 10 * (1 - k) + 4, color, alpha, 3, rnd);
    }
  },


  // Shockwave / rescue line across the view at y: a heavy wobbly pen line over a crayon band,
  // hatching trailing above it and ink arrows pointing down at the supernova. a: 1 -> 0 fade.
  drawShockLine(g, left, right, y, a, color, t) {
    if (a <= 0) return;
    const rnd = artRandom(ART.boilFrame(t) * 43 + 9);
    const pts = [];
    for (let x = left; x <= right + 40; x += 40) pts.push({ x, y: y + (rnd() - 0.5) * 9 });
    g.lineStyle(20, color, 0.55 * a);
    g.strokePoints(pts, false);
    // Hatching above the line: the push "smear".
    g.lineStyle(3, color, 0.8 * a);
    for (let x = left + 10; x < right; x += 22) {
      const h = 26 + rnd() * 30;
      g.lineBetween(x, y - 8, x + 14, y - 8 - h);
    }
    ART.pen(g, pts, false, 7, ART.backing, 0.5 * a, rnd);
    ART.pen(g, pts, false, 4.5, ART.ink, a, rnd);
    // Down arrows (open chevrons with a shaft), every ~1/6 of the width.
    const n = 6;
    for (let i = 0; i < n; i++) {
      const x = left + ((i + 0.5) / n) * (right - left) + (rnd() - 0.5) * 10;
      const y0 = y + 14;
      const y1 = y0 + 44 + (1 - a) * 30;
      g.lineStyle(9, ART.backing, 0.45 * a);
      g.lineBetween(x, y0, x, y1);
      g.lineStyle(5, color, a);
      g.lineBetween(x + (rnd() - 0.5) * 3, y0, x, y1);
      g.strokePoints([{ x: x - 14, y: y1 - 16 + (rnd() - 0.5) * 3 }, { x, y: y1 }, { x: x + 14, y: y1 - 16 + (rnd() - 0.5) * 3 }], false);
    }
  },

  // Card event doodles. d: { kind, x, y, age (0..1), seed, side?, r? }.
  //   kick: zigzag impact mark on the wall + a bounce arrow (in to the wall, out and up).
  //   shatter: the rock drawn as pen-outlined shards flying apart.
  //   shield: the bubble outline breaking into arcs that fly outward.
  //   rescue: a big scribbled up-arrow out of the comet + a ring of rays.
  drawCardDoodle(g, d, t) {
    const k = d.age;
    const ease = 1 - (1 - k) * (1 - k);
    const a = 1 - k * k;
    const rnd = artRandom(d.seed + ART.boilFrame(t) * 7);
    const ink = ART.ink;
    if (d.kind === 'kick') {
      const flight = ART.crayon(0x5cc8ff);
      const wx = d.side < 0 ? 0 : GAME_WIDTH;
      // Impact zigzag on the wall.
      const zz = [];
      for (let i = 0; i < 7; i++) zz.push({ x: wx - d.side * (i % 2 ? 22 : 6) * (1 + ease * 0.6), y: d.y - 54 + i * 18 + (rnd() - 0.5) * 4 });
      g.lineStyle(9, ART.backing, 0.45 * a);
      g.strokePoints(zz, false);
      g.lineStyle(5, flight, a);
      g.strokePoints(zz, false);
      // Bounce arrow drawn beside the wall, under the comet's new path (which goes up): in to the
      // wall, then out and up, like a coach's diagram of the kick.
      const s = -d.side;   // away from the wall
      const lift = ease * 30;
      const path = [
        { x: wx + s * 70, y: d.y + 120 - lift },
        { x: wx + s * 34, y: d.y + 92 - lift },
        { x: wx + s * 14, y: d.y + 66 - lift },
        { x: wx + s * 30, y: d.y + 36 - lift },
        { x: wx + s * 62, y: d.y + 6 - lift },
      ];
      ART.pen(g, path, false, 9, ART.backing, 0.4 * a, rnd);
      ART.pen(g, path, false, 5, ink, a, rnd);
      const e = path[path.length - 1];
      const ang = Math.atan2(e.y - path[3].y, e.x - path[3].x);
      g.lineStyle(5, ink, a);
      g.lineBetween(e.x, e.y, e.x + Math.cos(ang + 2.5) * 18, e.y + Math.sin(ang + 2.5) * 18);
      g.lineBetween(e.x, e.y, e.x + Math.cos(ang - 2.5) * 18, e.y + Math.sin(ang - 2.5) * 18);
      return;
    }
    if (d.kind === 'shatter') {
      const R = d.r || 30;
      for (let i = 0; i < 5; i++) {
        const ang = (i / 5) * Math.PI * 2 + (d.seed % 5);
        const dist = R * 0.3 + ease * (90 + (i % 2) * 40);
        const cx = d.x + Math.cos(ang) * dist;
        const cy = d.y + Math.sin(ang) * dist;
        const s = R * (0.78 - i * 0.07) * (1 - k * 0.4);
        const rot = ang + k * 3 * (i % 2 ? 1 : -1);
        const shard = [0, 2.2, 4.1].map((o, m) => ({ x: cx + Math.cos(rot + o) * s * (m === 1 ? 0.7 : 1), y: cy + Math.sin(rot + o) * s * (m === 1 ? 0.7 : 1) }));
        g.fillStyle(i % 2 ? 0xa8998a : 0x5b5049, a);
        g.fillPoints(shard.map((p) => ({ x: p.x + 2, y: p.y + 2 })), true);
        ART.pen(g, shard, true, 3, ink, a, rnd);
      }
      ART.asterisk(g, d.x, d.y, 14 + 16 * (1 - k), ART.crayon(0xff6fb5), a, 4, rnd);
      return;
    }
    if (d.kind === 'shield') {
      const pink = ART.crayon(0xff6fb5);
      const R0 = TUNING.cometRadius * 2.05 + ease * 70;
      for (let i = 0; i < 5; i++) {
        const a0 = (i / 5) * Math.PI * 2 + (d.seed % 6) + ease * 0.4;
        const pts = [];
        for (let m = 0; m <= 4; m++) {
          const aa = a0 + m * 0.18;
          pts.push({ x: d.x + Math.cos(aa) * R0, y: d.y + Math.sin(aa) * R0 });
        }
        ART.pen(g, pts, false, 7, ART.backing, 0.4 * a, rnd);
        ART.pen(g, pts, false, 4.5, pink, a, rnd);
      }
      return;
    }
    if (d.kind === 'rescue') {
      const pink = ART.crayon(0xff6fb5);
      // Ring of short rays.
      for (let i = 0; i < 12; i++) {
        const ang = (i / 12) * Math.PI * 2 + (rnd() - 0.5) * 0.2;
        const r0 = 40 + ease * 120;
        const len = (i % 2 ? 18 : 34) * (1 - k) + 8;
        g.lineStyle(5 * (1 - k) + 2, i % 3 ? pink : ink, a);
        g.lineBetween(d.x + Math.cos(ang) * r0, d.y + Math.sin(ang) * r0, d.x + Math.cos(ang) * (r0 + len), d.y + Math.sin(ang) * (r0 + len));
      }
      // Scribbled up-arrow rising from the comet.
      const top = d.y - 90 - ease * 140;
      const shaft = [];
      for (let i = 0; i <= 6; i++) shaft.push({ x: d.x + (i % 2 ? 7 : -7) + (rnd() - 0.5) * 3, y: d.y - 30 - (i / 6) * (d.y - 30 - top) });
      g.lineStyle(14, ART.backing, 0.4 * a);
      g.strokePoints(shaft, false);
      g.lineStyle(8, pink, a);
      g.strokePoints(shaft, false);
      const head = [{ x: d.x - 34, y: top + 34 }, { x: d.x, y: top - 6 }, { x: d.x + 34, y: top + 34 }];
      ART.pen(g, head, false, 10, ART.backing, 0.45 * a, rnd);
      ART.pen(g, head, false, 6.5, ink, a, rnd);
    }
  },

  // ---------- upgrade card icons ----------

  // Strokes one path twice: thick dark outline under the colored line (the game's ink look).
  inkStroke(g, width, color, drawPath) {
    g.lineStyle(width + 7, ART.outline, 1);
    drawPath();
    g.lineStyle(width, color, 1);
    drawPath();
  },

  inkPoly(g, pts, color, outlineWidth) {
    g.fillStyle(color, 1);
    g.fillPoints(pts, true);
    g.lineStyle(outlineWidth, ART.outline, 1);
    g.strokePoints(pts, true);
  },

  inkCircle(g, x, y, r, color, outlineWidth) {
    g.fillStyle(ART.outline, 1);
    g.fillCircle(x, y, r + outlineWidth);
    g.fillStyle(color, 1);
    g.fillCircle(x, y, r);
  },

  arrowHead(g, x, y, angle, size, color, ow) {
    const pts = [
      { x: x + Math.cos(angle) * size, y: y + Math.sin(angle) * size },
      { x: x + Math.cos(angle + 2.4) * size * 0.85, y: y + Math.sin(angle + 2.4) * size * 0.85 },
      { x: x + Math.cos(angle - 2.4) * size * 0.85, y: y + Math.sin(angle - 2.4) * size * 0.85 },
    ];
    ART.inkPoly(g, pts, color, ow);
  },

  // Card glyph `key` centered on (x, y), fitting a size x size box, in `color` with ink outlines
  // and white accents. Shared by the pick cards, the HUD row and the game over list.
  drawCardIcon(g, key, x, y, size, color) {
    const r = size / 2;
    const w = Math.max(3, r * 0.16);          // main stroke width
    const ow = Math.max(2.5, r * 0.09);       // outline width for filled shapes
    const light = lerpColor(color, 0xffffff, 0.55);
    const P = (px, py) => ({ x: x + px * r, y: y + py * r });
    switch (key) {
      case 'well': {
        // Planet pulling everything in: ring + four arrows pointing at it.
        ART.inkStroke(g, w * 0.7, light, () => g.strokeCircle(x, y, r * 0.82));
        for (let i = 0; i < 4; i++) {
          const a = Math.PI / 4 + (i * Math.PI) / 2;
          ART.arrowHead(g, x + Math.cos(a) * r * 0.6, y + Math.sin(a) * r * 0.6, a + Math.PI, r * 0.2, color, ow);
        }
        ART.inkCircle(g, x, y, r * 0.3, color, ow);
        g.fillStyle(0xffffff, 0.8);
        g.fillCircle(x - r * 0.1, y - r * 0.1, r * 0.09);
        break;
      }
      case 'spin': {
        // Tiny planet with a tight orbit arrow wrapping it.
        const a0 = -Math.PI * 0.35;
        const a1 = Math.PI * 1.25;
        const orbitR = r * 0.62;
        ART.inkStroke(g, w, color, () => { g.beginPath(); g.arc(x, y, orbitR, a0, a1, false); g.strokePath(); });
        ART.arrowHead(g, x + Math.cos(a1) * orbitR, y + Math.sin(a1) * orbitR, a1 + Math.PI / 2, r * 0.3, color, ow);
        ART.inkCircle(g, x, y, r * 0.26, light, ow);
        ART.sparkle(g, x + Math.cos(a0) * orbitR, y + Math.sin(a0) * orbitR, r * 0.22, 0, 0xffffff, 1);
        break;
      }
      case 'overdrive': {
        // Speedometer pinned at the top end.
        const cy = y + r * 0.22;
        const gr = r * 0.72;
        ART.inkStroke(g, w * 1.1, light, () => { g.beginPath(); g.arc(x, cy, gr, Math.PI, Math.PI * 2, false); g.strokePath(); });
        g.lineStyle(w * 1.1, 0xff4d2e, 1);
        g.beginPath(); g.arc(x, cy, gr, Math.PI * 1.7, Math.PI * 2, false); g.strokePath();
        const na = -Math.PI * 0.18;
        ART.inkStroke(g, w * 0.9, color, () => g.lineBetween(x, cy, x + Math.cos(na) * gr * 0.85, cy + Math.sin(na) * gr * 0.85));
        ART.inkCircle(g, x, cy, r * 0.14, color, ow);
        ART.inkStroke(g, w * 0.7, color, () => g.lineBetween(x - gr * 0.9, cy + r * 0.4, x + gr * 0.9, cy + r * 0.4));
        break;
      }
      case 'sling': {
        // Slingshot fork launching a ball up.
        ART.inkStroke(g, w * 1.1, color, () => {
          g.lineBetween(x, y + r * 0.85, x, y + r * 0.2);
          g.lineBetween(x, y + r * 0.22, x - r * 0.5, y - r * 0.35);
          g.lineBetween(x, y + r * 0.22, x + r * 0.5, y - r * 0.35);
        });
        g.lineStyle(w * 0.5, 0xffffff, 1);
        g.lineBetween(x - r * 0.5, y - r * 0.35, x, y - r * 0.05);
        g.lineBetween(x + r * 0.5, y - r * 0.35, x, y - r * 0.05);
        ART.inkCircle(g, x, y - r * 0.68, r * 0.2, light, ow);
        g.lineStyle(w * 0.45, 0xffffff, 0.9);
        g.lineBetween(x - r * 0.12, y - r * 0.36, x - r * 0.12, y - r * 0.2);
        g.lineBetween(x + r * 0.12, y - r * 0.36, x + r * 0.12, y - r * 0.2);
        break;
      }
      case 'perfect': {
        // Bullseye with a star in the center and crosshair ticks.
        ART.inkStroke(g, w * 0.8, color, () => g.strokeCircle(x, y, r * 0.66));
        ART.inkStroke(g, w * 0.8, light, () => g.strokeCircle(x, y, r * 0.38));
        ART.inkStroke(g, w * 0.7, color, () => {
          g.lineBetween(x, y - r * 0.98, x, y - r * 0.78);
          g.lineBetween(x, y + r * 0.98, x, y + r * 0.78);
          g.lineBetween(x - r * 0.98, y, x - r * 0.78, y);
          g.lineBetween(x + r * 0.98, y, x + r * 0.78, y);
        });
        ART.sparkle(g, x, y, r * 0.3, 0, ART.outline, 1);
        ART.sparkle(g, x, y, r * 0.22, 0, 0xffffff, 1);
        break;
      }
      case 'chain': {
        // Three stacked chevrons growing upward: each PERFECT pushes harder.
        for (let i = 0; i < 3; i++) {
          const cy = y + r * (0.55 - i * 0.48);
          const hw = r * (0.42 + i * 0.13);
          const c = i === 2 ? 0xffffff : i === 1 ? light : color;
          ART.inkStroke(g, w * 1.05, c, () => g.strokePoints([
            { x: x - hw, y: cy + hw * 0.55 }, { x, y: cy - hw * 0.15 }, { x: x + hw, y: cy + hw * 0.55 },
          ], false));
        }
        break;
      }
      case 'aero': {
        // Streamlined teardrop slicing up-right with speed lines behind.
        const a = -Math.PI / 4;
        const ux = Math.cos(a);
        const uy = Math.sin(a);
        const pts = [];
        for (let k = 0; k <= 10; k++) {
          const t = Math.PI / 2 + (k / 10) * Math.PI;   // back half circle
          pts.push({ x: x - ux * r * 0.1 + Math.cos(t + a) * r * 0.36, y: y - uy * r * 0.1 + Math.sin(t + a) * r * 0.36 });
        }
        pts.push({ x: x + ux * r * 0.78, y: y + uy * r * 0.78 });
        ART.inkStroke(g, w * 0.6, light, () => {
          for (let i = -1; i <= 1; i++) {
            const ox = -uy * i * r * 0.3;
            const oy = ux * i * r * 0.3;
            const back = 0.5 + (i === 0 ? 0.08 : 0);
            g.lineBetween(x - ux * r * back + ox, y - uy * r * back + oy, x - ux * r * (back + 0.36) + ox, y - uy * r * (back + 0.36) + oy);
          }
        });
        ART.inkPoly(g, pts, color, ow);
        g.fillStyle(0xffffff, 0.85);
        g.fillCircle(x - r * 0.05, y - r * 0.17, r * 0.1);
        break;
      }
      case 'afterburner': {
        // Two-tone jet flame.
        const outer = [P(0, -0.92), P(0.32, -0.42), P(0.5, 0.1), P(0.42, 0.55), P(0, 0.85), P(-0.42, 0.55), P(-0.5, 0.1), P(-0.22, -0.2), P(-0.16, -0.55)];
        ART.inkPoly(g, outer, color, ow);
        const inner = [P(0.02, -0.32), P(0.22, 0.1), P(0.22, 0.45), P(0, 0.62), P(-0.22, 0.45), P(-0.2, 0.12)];
        g.fillStyle(0xffffff, 1);
        g.fillPoints(inner, true);
        break;
      }
      case 'wallkick': {
        // Wall on the left, arrow bouncing off it upward, burst at the kick point.
        const wx = x - r * 0.6;
        g.fillStyle(ART.outline, 1);
        g.fillRect(wx - r * 0.2 - ow, y - r * 0.9 - ow, r * 0.26 + ow * 2, r * 1.8 + ow * 2);
        g.fillStyle(light, 1);
        g.fillRect(wx - r * 0.2, y - r * 0.9, r * 0.26, r * 1.8);
        g.lineStyle(Math.max(2, ow * 0.7), ART.outline, 1);
        for (let i = 1; i < 4; i++) g.lineBetween(wx - r * 0.2, y - r * 0.9 + i * r * 0.45, wx + r * 0.06, y - r * 0.9 + i * r * 0.45);
        const kick = P(-0.3, 0.15);
        const end = P(0.55, -0.62);
        ART.inkStroke(g, w, color, () => g.strokePoints([P(0.35, 0.8), kick, end], false));
        ART.arrowHead(g, end.x, end.y, Math.atan2(end.y - kick.y, end.x - kick.x), r * 0.3, color, ow);
        ART.sparkle(g, kick.x + r * 0.02, kick.y, r * 0.32, 0.4, ART.outline, 1);
        ART.sparkle(g, kick.x + r * 0.02, kick.y, r * 0.24, 0.4, 0xffffff, 1);
        break;
      }
      case 'heatshield': {
        // Heater shield with a white flame emblem.
        const shield = [P(-0.66, -0.7), P(0, -0.86), P(0.66, -0.7), P(0.62, 0.05), P(0.36, 0.55), P(0, 0.86), P(-0.36, 0.55), P(-0.62, 0.05)];
        ART.inkPoly(g, shield, color, ow * 1.2);
        g.fillStyle(lerpColor(color, ART.outline, 0.25), 1);
        g.fillPoints([P(0, -0.8), P(0.6, -0.66), P(0.56, 0.05), P(0.32, 0.52), P(0, 0.8)], true);
        g.fillStyle(0xffffff, 1);
        g.fillPoints([P(0, -0.45), P(0.2, -0.12), P(0.24, 0.18), P(0, 0.42), P(-0.24, 0.18), P(-0.14, -0.06), P(-0.04, 0.06)], true);
        break;
      }
      case 'armor': {
        // Asteroid cracking in two with shards flying off.
        const left = [P(-0.08, -0.62), P(-0.48, -0.5), P(-0.7, -0.05), P(-0.52, 0.45), P(-0.14, 0.6), P(-0.02, 0.18), P(-0.18, -0.12)];
        const right = [P(0.08, -0.66), P(0.5, -0.46), P(0.7, 0.02), P(0.46, 0.5), P(0.04, 0.62), P(0.14, 0.2), P(-0.02, -0.12)];
        ART.inkPoly(g, left.map(p => ({ x: p.x - r * 0.08, y: p.y })), 0xa78fb8, ow);
        ART.inkPoly(g, right.map(p => ({ x: p.x + r * 0.08, y: p.y })), 0xa78fb8, ow);
        g.fillStyle(0x7a6290, 1);
        g.fillCircle(x - r * 0.42, y + r * 0.12, r * 0.12);
        g.fillCircle(x + r * 0.42, y - r * 0.18, r * 0.1);
        ART.inkPoly(g, [P(-0.05, -0.98), P(0.12, -0.78), P(-0.12, -0.74)], color, ow * 0.8);
        ART.inkPoly(g, [P(0.82, -0.62), P(0.98, -0.4), P(0.74, -0.42)], color, ow * 0.8);
        ART.inkPoly(g, [P(-0.84, 0.56), P(-0.66, 0.74), P(-0.9, 0.8)], color, ow * 0.8);
        ART.inkStroke(g, w * 0.5, color, () => {
          g.lineBetween(x - r * 0.2, y + r * 0.72, x - r * 0.3, y + r * 0.92);
          g.lineBetween(x + r * 0.2, y + r * 0.72, x + r * 0.3, y + r * 0.92);
        });
        break;
      }
      case 'shockwave': {
        // Comet on top, shock arcs blasting downward (toward the supernova).
        const cy = y - r * 0.62;
        for (let i = 0; i < 3; i++) {
          const ar = r * (0.5 + i * 0.32);
          ART.inkStroke(g, w * (1.05 - i * 0.18), i === 0 ? 0xffffff : i === 1 ? light : color, () => {
            g.beginPath(); g.arc(x, cy, ar, Math.PI * 0.22, Math.PI * 0.78, false); g.strokePath();
          });
        }
        ART.inkCircle(g, x, cy, r * 0.22, color, ow);
        g.fillStyle(0xffffff, 0.85);
        g.fillCircle(x - r * 0.07, cy - r * 0.07, r * 0.07);
        break;
      }
      default:
        ART.sparkle(g, x, y, r * 0.7, 0, color, 1);
    }
  },

  // Round icon badge: ink rim, family ring, dark tinted disc, glyph, shine. HUD row and lists.
  drawCardBadge(g, key, x, y, size, color) {
    const r = size / 2;
    g.fillStyle(ART.outline, 1);
    g.fillCircle(x, y + 2, r + 4);
    g.fillStyle(color, 1);
    g.fillCircle(x, y, r);
    g.fillStyle(lerpColor(color, ART.outline, 0.62), 1);
    g.fillCircle(x, y, r * 0.84);
    ART.drawCardIcon(g, key, x, y, size * 0.72, color);
    g.fillStyle(0xffffff, 0.35);
    g.fillEllipse(x - r * 0.3, y - r * 0.55, r * 0.7, r * 0.22);
  },

  // ---------- background ----------

  // Generates the shared background textures: 'stars' (cream ink dots + asterisks, tint it for
  // the dark-ink page), 'stars_sparkle' (a few bigger hand-drawn stars) and 'stars_nebula'
  // (the first page's navy construction paper). Scenes may tile any of them.
  makeStarTexture(scene, key) {
    const size = 512;
    ART.canvasTexture(scene, key, size, size, (c) => {
      const rnd = artRandom(4242);
      for (let i = 0; i < 40; i++) {
        const x = rnd() * size;
        const y = rnd() * size;
        const r = 0.8 + rnd() * 1.5;
        const a = 0.35 + rnd() * 0.5;
        SKC.wrapped(size, x, y, (px, py) => {
          c.fillStyle = SKC.css(SKETCH.cream, a);
          c.fillRect(px - r, py - r, r * 2, r * 2 * (0.7 + rnd() * 0.5));
        });
      }
      for (let i = 0; i < 10; i++) {
        const x = rnd() * size;
        const y = rnd() * size;
        const r = 4 + rnd() * 4;
        const a = 0.55 + rnd() * 0.4;
        const seed = rnd() * 1e6;
        SKC.wrapped(size, x, y, (px, py) => SKC.asterisk(c, px, py, r, SKETCH.cream, a, 1.8, artRandom(seed)));
      }
    });
    ART.canvasTexture(scene, 'stars_sparkle', size, size, (c) => {
      const rnd = artRandom(777);
      for (let i = 0; i < 4; i++) {
        const x = rnd() * size;
        const y = rnd() * size;
        const r = 9 + rnd() * 6;
        const seed = rnd() * 1e6;
        SKC.wrapped(size, x, y, (px, py) => SKC.doodleStar(c, px, py, r, SKETCH.cream, 0.85, 2.2, artRandom(seed)));
      }
    });
    const z0 = (typeof ZONES !== 'undefined' && ZONES[0]) || { paper: 0x1d2747, fx: 'none' };
    ART.paperTextureAs(scene, 'stars_nebula', z0.paper, z0.fx, 0);
  },
};
