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
//     grabRangeBonus (px): added to TUNING.grabRange so the drawn grab ring matches the real range,
//     momentum (0..1): MOMENTUM, the flame crown grows and extra flame scribbles peel off the head,
//     perfectFlash (0..1): set on EVERY PERFECT, the head flashes pale and an ink ring bursts out }
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

// Zone object for any page index (orbit.js zoneAt covers the endless pages past 40000 m);
// falls back to the last fixed ZONES entry so nothing here can index out of range.
function artZone(index) {
  const i = Math.max(0, Math.floor(index) || 0);
  if (typeof zoneAt === 'function') {
    const z = zoneAt(i);
    if (z) return z;
  }
  if (typeof ZONES === 'undefined' || !ZONES.length) return null;
  return ZONES[Math.min(i, ZONES.length - 1)];
}

// Perceived brightness test: dark ink (cream ESCAPE VELOCITY, white BIG BANG) gets the light-page treatment.
function artIsDark(color) {
  const r = (color >> 16) & 255;
  const g = (color >> 8) & 255;
  const b = color & 255;
  return r * 0.299 + g * 0.587 + b * 0.114 < 110;
}

function artIsLightPaper(color) {
  return !artIsDark(color) && ((color >> 16) & 255) > 180;
}

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
    const z = artZone(index);
    ART.pageIndex = z ? Math.max(0, Math.floor(index) || 0) : 0;
    ART.zone = z;
    ART.ink = z && z.ink !== undefined ? z.ink : SKETCH.cream;
    ART.inkMode = artIsDark(ART.ink) ? 'd' : 'l';
    ART.inkKey = ART.inkKeyFor(ART.ink);
    ART.backing = ART.inkMode === 'd' ? 0xfff6dc : SKETCH.shadowInk;
    const look = z && ART.pageLooks[z.fx];
    ART.planetTint = look ? look.planetTint : 0xffffff;
    ART.tailEdge = look ? look.tailEdge : undefined;
  },

  // Texture-cache key for an ink color: 'l' (cream), 'd' (the cream page's brown-black) or 'd' +
  // hex for any other dark ink (BIG BANG's navy), so pages with different inks never share bodies.
  inkKeyFor(ink) {
    if (!artIsDark(ink)) return 'l';
    return ink === SKETCH.dark ? 'd' : 'd' + ink.toString(16);
  },
  inkForKey(key) {
    if (key === 'l') return SKETCH.cream;
    if (key === 'd') return SKETCH.dark;
    return parseInt(key.slice(1), 16);
  },

  // Per-medium extras for the late pages (keyed by zone fx). planetTint is a light multiply tint
  // on planet images so the crayon palette shifts a little with each new sheet of paper.
  pageLooks: {
    lightspeed: { planetTint: 0xffeedd, tailEdge: SKETCH.cream },
    spiral: { planetTint: 0xe6f7df },
    blueprint: { planetTint: 0xdfe9ff, tailEdge: SKETCH.cream },
    graph: { planetTint: 0xffffff },
    charcoal: { planetTint: 0xf3e2d6, tailEdge: SKETCH.cream },
  },
  planetTint: 0xffffff,
  zone: null,
  inkKey: 'l',

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
    if (ART._aheadFor !== ART.pageIndex && !scene.headless) {
      ART._aheadFor = ART.pageIndex;
      ART.warmAhead(scene, ART.pageIndex);
    }
    if (!scene.headless) ART.drawPageMarks(scene);
    const job = ART.warmQueue.shift();
    if (job) job(scene);
  },
  // Queues every body texture for one ink (mode 'l' / 'd' or any inkKey), plus the fixed papers
  // on the first (cream ink) call.
  warmAll(scene, inkMode) {
    const ik = inkMode === 'l' || inkMode === 'd' || (inkMode && inkMode[0] === 'd') ? inkMode : 'l';
    if (ART.warmedInks[ik]) return;
    ART.warmedInks[ik] = true;
    const ink = ART.inkForKey(ik);
    const jobs = [];
    if (ik === 'l') {
      for (let i = 0; i < 6; i++) jobs.push((s) => ART.paperTexture(s, i));
    }
    for (let d = 0; d < ASTEROID_DESIGNS; d++) for (let v = 0; v < SKETCH.variants; v++) jobs.push((s) => ART.asteroidTexture(s, d, v, ik));
    for (let v = 0; v < SKETCH.variants; v++) jobs.push((s) => ART.blackHoleTexture(s, v, ik));
    for (const R of PLANET_SIZES_FOR_WARMUP) {
      for (let d = 0; d < PLANET_DESIGNS.length; d++) {
        for (let v = 0; v < SKETCH.variants; v++) jobs.push((s) => ART.planetTextureFor(s, R, d, ik, ink, v));
      }
    }
    ART.warm(jobs);
  },
  warmedInks: {},

  // Called when page `index` starts turning in: queues the NEXT page's paper and body textures, so
  // they are ready long before that page arrives (a fresh 512 px paper costs a frame hitch).
  warmAhead(scene, index) {
    const next = artZone(index + 1);
    if (!next) return;
    ART.warm([(s) => ART.paperTexture(s, index + 1)]);
    ART.warmAll(scene, ART.inkKeyFor(next.ink !== undefined ? next.ink : SKETCH.cream));
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
    const z = artZone(index) || { paper: 0x1d2747, fx: 'none' };
    // Keyed by look, not index: the endless pages past 40000 m reuse the fixed pages' sheets.
    // The seed is the first fixed page with that look, so a reused sheet is the same drawing.
    let seed = Math.max(0, Math.floor(index) || 0);
    if (typeof ZONES !== 'undefined') {
      for (let i = 0; i < ZONES.length; i++) {
        if (ZONES[i].paper === z.paper && ZONES[i].fx === z.fx) { seed = i; break; }
      }
    }
    const key = 'paper_' + z.paper.toString(16) + '_' + z.fx;
    return ART.paperTextureAs(scene, key, z.paper, z.fx, seed);
  },

  paperTextureAs(scene, key, paper, fx, seed) {
    // The heat page is a bigger tile: its sparse marks would show an obvious repeat at 512.
    const size = fx === 'heat' ? 768 : 512;
    return ART.canvasTexture(scene, key, size, size, (c, S) => {
      const rnd = artRandom(9001 + seed * 77);
      c.fillStyle = SKC.css(paper);
      c.fillRect(0, 0, S, S);
      const light = artIsLightPaper(paper);   // the cream page and BIG BANG's graph paper
      // Soft blotches: paper is never one flat color.
      const areaK = (S * S) / (512 * 512);   // keep blotch and fiber density the same on bigger tiles
      for (let i = 0; i < 26 * areaK; i++) {
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
        // A few heat marks in red-orange pencil, scattered on a bigger tile so the repeat never
        // reads as a pattern: wavy dashes, rising curls and little doubled "~~" lines, each its
        // own length, slant and pressure.
        const marks = 7;
        for (let i = 0; i < marks; i++) {
          // One mark per cell of a loose 7-cell stagger, jittered inside its cell (sparse, never clumped).
          const x = ((i * 0.381 + 0.13) % 1) * S + (rnd() - 0.5) * S * 0.12;
          const y = (i / marks) * S + rnd() * S * 0.1;
          const kind = i % 3;
          const col = rnd() < 0.5 ? SKETCH.orange : SKETCH.red;
          const alpha = 0.3 + rnd() * 0.18;
          const len = kind === 1 ? 34 + rnd() * 30 : 40 + rnd() * 60;
          const amp = 2.5 + rnd() * 4;
          const freq = 0.16 + rnd() * 0.14;
          const tilt = kind === 1 ? -Math.PI / 2 + (rnd() - 0.5) * 0.5 : (rnd() - 0.5) * 0.6;
          const width = 1.8 + rnd() * 1.4;
          const lines = kind === 2 ? 2 : 1;
          SKC.wrapped(S, x, y, (px, py) => {
            c.strokeStyle = SKC.css(col, alpha);
            c.lineWidth = width;
            c.lineCap = 'round';
            const ca = Math.cos(tilt);
            const sa = Math.sin(tilt);
            for (let l = 0; l < lines; l++) {
              const off = l * (9 + amp);
              const shrink = l ? 0.7 : 1;
              c.beginPath();
              for (let k = 0; k <= len * shrink; k += 4) {
                // A rising curl grows its wiggle as it climbs, like heat haze.
                const a = kind === 1 ? amp * (0.4 + k / len) : amp;
                const u = k + l * 6;
                const v = Math.sin(k * freq) * a + off;
                const xx = px + u * ca - v * sa;
                const yy = py + u * sa + v * ca;
                if (k === 0) c.moveTo(xx, yy); else c.lineTo(xx, yy);
              }
              c.stroke();
            }
          });
        }
      }
      ART.paintPaperMarks(c, S, fx, paper, rnd);
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
      for (let i = 0; i < 240 * areaK; i++) {
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
      if (fx === 'rays') {
        // Warm gold flecks on the cream page.
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

  // Printed or drawn marks that make each late page read as its own medium (tileable, static:
  // the boiling part of a page lives in drawPageMarks).
  paintPaperMarks(c, S, fx, paper, rnd) {
    c.lineCap = 'round';
    c.lineJoin = 'round';
    const stroke = (col, alpha, w, fn) => {
      c.strokeStyle = SKC.css(col, alpha);
      c.lineWidth = w;
      c.beginPath();
      fn();
      c.stroke();
    };
    if (fx === 'lightspeed') {
      // Kraft paper: dark wood specks, long pale fibers, and faint dashed speed ticks pointing up.
      for (let i = 0; i < 170; i++) {
        const x = rnd() * S;
        const y = rnd() * S;
        const r = 0.6 + rnd() * 1.4;
        const a = 0.25 + rnd() * 0.3;
        SKC.wrapped(S, x, y, (px, py) => { c.fillStyle = SKC.css(0x24140a, a); c.fillRect(px, py, r * 1.6, r); });
      }
      for (let i = 0; i < 40; i++) {
        const x = rnd() * S;
        const y = rnd() * S;
        const len = 14 + rnd() * 26;
        const lean = (rnd() - 0.5) * 6;
        const a = 0.1 + rnd() * 0.1;
        SKC.wrapped(S, x, y, (px, py) => stroke(0xd9b07a, a, 0.9, () => {
          c.moveTo(px, py);
          c.quadraticCurveTo(px + lean, py + len * 0.5, px + lean * 0.4, py + len);
        }));
      }
      for (let i = 0; i < 9; i++) {
        const x = ((i * 0.317 + 0.05) % 1) * S + (rnd() - 0.5) * 30;
        const y = (i / 9) * S + rnd() * 40;
        const n = 3 + Math.floor(rnd() * 3);
        const a = 0.08 + rnd() * 0.06;
        const lean = (rnd() - 0.5) * 0.12;
        const seed = rnd() * 1e6;
        SKC.wrapped(S, x, y, (px, py) => {
          const jr = artRandom(seed);
          let yy = py;
          for (let k = 0; k < n; k++) {
            const len = 12 + jr() * 18;
            const y0 = yy;
            stroke(SKETCH.cream, a * (1 - k * 0.15), 2, () => { c.moveTo(px + (y0 - py) * lean, y0); c.lineTo(px + (y0 - len - py) * lean, y0 - len); });
            yy -= len + 8 + jr() * 6;
          }
        });
      }
    } else if (fx === 'spiral') {
      // Loose pencil spirals, each gone over twice (a pencil never retraces exactly).
      for (let i = 0; i < 4; i++) {
        const x = ((i * 0.43 + 0.2) % 1) * S + (rnd() - 0.5) * 60;
        const y = (i / 4) * S + rnd() * 60;
        const turns = 2.2 + rnd() * 1.3;
        const maxR = 34 + rnd() * 42;
        const rot = rnd() * Math.PI * 2;
        const dir = rnd() < 0.5 ? 1 : -1;
        const seed = rnd() * 1e6;
        SKC.wrapped(S, x, y, (px, py) => {
          for (let pass = 0; pass < 2; pass++) {
            const jr = artRandom(seed + pass * 31);
            stroke(SKETCH.cream, pass ? 0.08 : 0.15, pass ? 1.2 : 1.8, () => {
              const steps = Math.ceil(turns * 22);
              for (let k = 0; k <= steps; k++) {
                const f = k / steps;
                const a = rot + dir * f * turns * Math.PI * 2;
                const r = maxR * f * (0.9 + jr() * 0.18) + pass * 2;
                const xx = px + Math.cos(a) * r;
                const yy = py + Math.sin(a) * r * 0.86;
                if (k === 0) c.moveTo(xx, yy); else c.lineTo(xx, yy);
              }
            });
          }
        });
      }
    } else if (fx === 'blueprint') {
      // Printed blueprint grid (faint), a stronger line every 4 squares, then pencil compass work.
      const gridCol = 0xcfe2f7;
      for (let k = 0; k < S; k += 32) {
        const strong = k % 128 === 0;
        c.fillStyle = SKC.css(gridCol, strong ? 0.2 : 0.1);
        c.fillRect(k, 0, strong ? 2 : 1, S);
        c.fillRect(0, k, S, strong ? 2 : 1);
      }
      for (let i = 0; i < 3; i++) {
        const x = ((i * 0.37 + 0.15) % 1) * S;
        const y = (i / 3) * S + rnd() * 80;
        const r = 50 + rnd() * 70;
        const a0 = rnd() * Math.PI * 2;
        const span = 1.6 + rnd() * 2;
        SKC.wrapped(S, x, y, (px, py) => {
          stroke(SKETCH.cream, 0.16, 1.6, () => c.arc(px, py, r, a0, a0 + span));
          // Center pin and a radius line: how a compass arc is actually drawn.
          stroke(SKETCH.cream, 0.18, 1.4, () => { c.moveTo(px - 6, py); c.lineTo(px + 6, py); c.moveTo(px, py - 6); c.lineTo(px, py + 6); });
          stroke(SKETCH.cream, 0.08, 1, () => { c.moveTo(px, py); c.lineTo(px + Math.cos(a0) * r, py + Math.sin(a0) * r); });
        });
      }
      // A dimension line with end ticks.
      const dx = rnd() * S;
      const dy = rnd() * S;
      SKC.wrapped(S, dx, dy, (px, py) => stroke(SKETCH.cream, 0.15, 1.4, () => {
        c.moveTo(px, py); c.lineTo(px + 120, py);
        c.moveTo(px, py - 7); c.lineTo(px, py + 7);
        c.moveTo(px + 120, py - 7); c.lineTo(px + 120, py + 7);
      }));
    } else if (fx === 'graph') {
      // White graph paper: blue printed squares, then a few navy ink starbursts doodled on it.
      const gridCol = 0x6f9ad0;
      for (let k = 0; k < S; k += 32) {
        const strong = k % 128 === 0;
        c.fillStyle = SKC.css(gridCol, strong ? 0.34 : 0.17);
        c.fillRect(k, 0, strong ? 2 : 1, S);
        c.fillRect(0, k, S, strong ? 2 : 1);
      }
      const ink = 0x1d2747;
      for (let i = 0; i < 4; i++) {
        const x = ((i * 0.29 + 0.1) % 1) * S + (rnd() - 0.5) * 40;
        const y = (i / 4) * S + rnd() * 50;
        const r = 7 + rnd() * 7;
        const seed = rnd() * 1e6;
        const star = i % 2 === 0;
        SKC.wrapped(S, x, y, (px, py) => {
          if (star) SKC.doodleStar(c, px, py, r, ink, 0.3, 1.8, artRandom(seed));
          else SKC.asterisk(c, px, py, r, ink, 0.32, 2, artRandom(seed));
          // Short burst ticks around it.
          const jr = artRandom(seed + 7);
          for (let k = 0; k < 6; k++) {
            const a = (k / 6) * Math.PI * 2 + jr() * 0.4;
            stroke(ink, 0.22, 1.4, () => { c.moveTo(px + Math.cos(a) * r * 1.5, py + Math.sin(a) * r * 1.5); c.lineTo(px + Math.cos(a) * r * 2.1, py + Math.sin(a) * r * 2.1); });
          }
        });
      }
    } else if (fx === 'charcoal') {
      // Charcoal sketch paper: clusters of parallel hatches, each over a rubbed-in smudge.
      for (let i = 0; i < 11; i++) {
        const x = rnd() * S;
        const y = rnd() * S;
        const ang = -0.95 + (rnd() - 0.5) * 0.5;
        const n = 4 + Math.floor(rnd() * 5);
        const len = 22 + rnd() * 26;
        const gap = 4 + rnd() * 3;
        const dark = rnd() < 0.7;
        const seed = rnd() * 1e6;
        const ux = Math.cos(ang);
        const uy = Math.sin(ang);
        SKC.wrapped(S, x, y, (px, py) => {
          const jr = artRandom(seed);
          stroke(0x000000, 0.07, 20, () => { c.moveTo(px - ux * len * 0.3, py - uy * len * 0.3); c.lineTo(px + ux * len * 0.3 + n * gap, py + uy * len * 0.3); });
          for (let k = 0; k < n; k++) {
            const ox = px + k * gap + (jr() - 0.5) * 2;
            const l = len * (0.75 + jr() * 0.4);
            stroke(dark ? 0x0b0806 : 0xa3958a, dark ? 0.32 + jr() * 0.15 : 0.1, 2.2 + jr() * 1.8, () => {
              c.moveTo(ox - ux * l * 0.5, py - uy * l * 0.5);
              c.lineTo(ox + ux * l * 0.5, py + uy * l * 0.5);
            });
          }
        });
      }
    }
  },

  // Screen-space marks for the late pages, redrawn at the boil rate on a layer of our own right
  // above the Game scene's pageFxGfx. The early pages' streaks/rays stay in GameScene.drawPageFx.
  drawPageMarks(scene) {
    if (!scene.pageFxGfx || !scene.add) return;
    let g = scene._artPageMarks;
    if (!g || !g.scene) {
      g = scene.add.graphics().setScrollFactor(0);
      scene.children.moveTo(g, scene.children.getIndex(scene.pageFxGfx) + 1);
      scene._artPageMarks = g;
      g._frame = -1;
      g._fx = '';
    }
    const z = ART.zone || artZone(ART.pageIndex);
    const fx = z && ART.pageLooks[z.fx] ? z.fx : '';
    const frame = Math.floor(scene.time.now / 100);
    if (frame === g._frame && fx === g._fx) return;
    g._frame = frame;
    g._fx = fx;
    g.clear();
    if (!fx) return;
    ART.paintPageMarks(g, fx, frame, z.ink !== undefined ? z.ink : SKETCH.cream);
  },

  paintPageMarks(g, fx, frame, ink) {
    const cx = GAME_WIDTH / 2;
    const cy = GAME_HEIGHT / 2;
    const boil = artRandom(frame * 17 + 3);
    if (fx === 'lightspeed') {
      // Long dashed ink streaks drawn toward a vanishing point above the page, crawling in at 10 fps.
      const vx = cx;
      const vy = -700;
      for (let i = 0; i < 26; i++) {
        const st = artRandom(i * 7919 + 13);
        const a = Math.PI / 2 + (i / 25 - 0.5) * 1.7 + (st() - 0.5) * 0.06 + (boil() - 0.5) * 0.004;
        // Distance from the vanishing point: shrinks a step per boil frame (the streak crawls toward
        // it) and fades out over its last 300 px.
        const travel = (frame * (14 + st() * 10) + st() * 1700) % 1700;
        const d1 = 2550 - travel;
        const len = 220 + st() * 260;
        const ca = Math.cos(a);
        const sa = Math.sin(a);
        // Kraft paper is mid-brown, so the cream ink needs about twice the weight it has on navy.
        const w = 2.6 + st() * 2.8;
        const alpha = (0.26 + st() * 0.2) * Math.min(1, (d1 - 850) / 300);
        if (alpha <= 0.02) continue;
        g.lineStyle(w, ink, alpha);
        // Three dashes, shorter toward the vanishing point.
        let d = d1;
        for (let k = 0; k < 3; k++) {
          const dl = len * (0.5 - k * 0.12);
          g.lineBetween(vx + ca * d, vy + sa * d, vx + ca * (d - dl), vy + sa * (d - dl));
          d -= dl + len * 0.14;
        }
      }
    } else if (fx === 'spiral') {
      // One huge loose pencil spiral, the wormhole, turning a notch per boil frame.
      const ox = cx + 60;
      const oy = cy - 260;
      const rot = frame * 0.015;
      const turns = 3.2;
      const steps = 90;
      for (let pass = 0; pass < 2; pass++) {
        g.lineStyle(pass ? 2 : 3.2, ink, pass ? 0.05 : 0.085);
        g.beginPath();
        for (let k = 0; k <= steps; k++) {
          const f = k / steps;
          const a = rot + f * turns * Math.PI * 2 + pass * 0.05;
          const r = 40 + f * 900 + (boil() - 0.5) * 8;
          const x = ox + Math.cos(a) * r;
          const y = oy + Math.sin(a) * r * 0.82;
          if (k === 0) g.moveTo(x, y); else g.lineTo(x, y);
        }
        g.strokePath();
      }
    } else if (fx === 'blueprint') {
      // Two giant compass arcs with tick marks, centered off the page.
      for (let n = 0; n < 2; n++) {
        const ax = n ? 900 : -160;
        const ay = n ? -260 : 1560;
        const r = n ? 700 : 980;
        const a0 = n ? 1.75 : -1.35;
        const a1 = n ? 2.95 : -0.15;
        g.lineStyle(2.2, ink, 0.13);
        g.beginPath();
        for (let k = 0; k <= 40; k++) {
          const a = a0 + ((a1 - a0) * k) / 40;
          const rr = r + (boil() - 0.5) * 3;
          if (k === 0) g.moveTo(ax + Math.cos(a) * rr, ay + Math.sin(a) * rr); else g.lineTo(ax + Math.cos(a) * rr, ay + Math.sin(a) * rr);
        }
        g.strokePath();
        g.lineStyle(1.6, ink, 0.12);
        for (let k = 0; a0 + k * 0.06 <= a1; k++) {
          const a = a0 + k * 0.06;
          const t0 = r - (k % 5 === 0 ? 18 : 9);
          g.lineBetween(ax + Math.cos(a) * t0, ay + Math.sin(a) * t0, ax + Math.cos(a) * (r + (boil() - 0.5) * 2), ay + Math.sin(a) * r);
        }
      }
    } else if (fx === 'graph') {
      // Red crayon margin (double line) down the left of the graph paper.
      for (let k = 0; k < 2; k++) {
        const x0 = 70 + k * 7;
        g.lineStyle(k ? 1.8 : 2.6, 0xd8432c, k ? 0.2 : 0.3);
        g.beginPath();
        for (let i = 0; i <= 14; i++) {
          const x = x0 + (boil() - 0.5) * 2.4;
          const y = -500 + i * 160;
          if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
        }
        g.strokePath();
      }
    } else if (fx === 'charcoal') {
      // Smudged charcoal hatching along both edges, like the margins of a sketch.
      for (let s = 0; s < 2; s++) {
        const side = s ? 1 : -1;
        const edge = side < 0 ? -10 : GAME_WIDTH + 10;
        for (let i = 0; i < 26; i++) {
          const st = artRandom(i * 131 + (side + 2) * 977);
          const y = -400 + i * 80 + st() * 30;
          const len = 70 + st() * 90;
          const x0 = edge - side * st() * 30;
          const j = (boil() - 0.5) * 3;
          g.lineStyle(10, 0x000000, 0.06);
          g.lineBetween(x0, y, x0 - side * len * 0.8, y - len * 0.55);
          g.lineStyle(2.4 + st() * 1.6, 0x0b0806, 0.38 + st() * 0.14);
          g.lineBetween(x0 + j, y, x0 - side * len * 0.8 + j, y - len * 0.55);
          if (st() < 0.4) {
            g.lineStyle(1.4, ink, 0.07);
            g.lineBetween(x0 - side * 8, y + 10, x0 - side * len * 0.6, y - len * 0.4 + 10);
          }
        }
      }
    }
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

  planetTextureFor(scene, R, design, inkKey, ink, variant) {
    const key = 'pl_' + R + '_' + design + '_' + inkKey + '_' + variant;
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
    // On the cream page (dark ink) warm bodies sit close to the paper's tone: a heavier outline
    // and a graphite drop shadow keep them standing off the page.
    const onCream = artIsDark(ink);
    const inkW = (3 + R * 0.022) * (onCream ? 1.45 : 1);
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

    if (onCream) {
      SKC.fill(c, sil.map((p) => ({ x: p.x + R * 0.07, y: p.y + R * 0.1 })), SKETCH.dark, 0.2);
      SKC.hatch(c, sil.map((p) => ({ x: p.x + R * 0.1, y: p.y + R * 0.14 })), { angle: 0.8, spacing: 6, width: 2, color: SKETCH.dark, alpha: 0.35, rnd: jr, skip: 0.2 });
    }
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
    const key = ART.planetTextureFor(g.scene, s.R, s.design, ART.inkKey, ART.ink, variant);
    const img = ART.bodyImage(g, p, key);
    // The page's crayon shift is fixed per planet when it is first drawn, so nothing pops mid-turn.
    if (s.tint === undefined) s.tint = ART.planetTint;
    if (s.tint !== 0xffffff) img.setTint(s.tint); else if (img.isTinted) img.clearTint();
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

  // Death beat: the supernova's jaws snap shut over (x, y), then a crayon scribble bursts out of
  // them. k: 0..1 while closing, past 1 during the hold (k - 1 = hold time in close-time units).
  drawDeathJaws(g, x, y, k, t) {
    const bf = ART.boilFrame(t);
    const rnd = artRandom(bf * 59 + 11);
    const shut = Math.min(1, k);
    // Ease in, so the bite accelerates and lands with a snap; a tiny rebound after it lands.
    const bite = shut * shut * shut;
    const rebound = k > 1 ? Math.sin(Math.min(1, (k - 1) * 2.5) * Math.PI) * 10 : 0;
    const gap = 170 * (1 - bite) + rebound;
    const W = 150;                 // half width of the mouth
    const lip = 0x3a0d10;          // the nova face's line color
    const tooth = 0xfff3d6;
    for (const side of [-1, 1]) { // -1 = upper jaw, 1 = lower jaw
      const edgeY = y + side * gap * 0.5;
      // Jaw body: a fat crescent bulging away from the bite line, its back a flame-ish wobble.
      const back = [];
      const n = 14;
      for (let i = 0; i <= n; i++) {
        const u = i / n;
        const bx = x - W + u * W * 2;
        const bulge = Math.sin(u * Math.PI) * (90 + (i % 2 ? 18 * rnd() : 0));
        back.push({ x: bx + (rnd() - 0.5) * 6, y: edgeY + side * (bulge + 18) });
      }
      const body = back.slice();
      body.push({ x: x + W + 10, y: edgeY });
      body.push({ x: x - W - 10, y: edgeY });
      g.fillStyle(SKETCH.red, 1);
      g.fillPoints(body.map((p) => ({ x: p.x, y: p.y + side * 10 })), true);   // crayon flame rim
      g.fillStyle(lip, 1);
      g.fillPoints(body, true);
      ART.pen(g, back, false, 6, SKETCH.orange, 0.95, rnd);
      // Zigzag teeth along the bite line, pointing at the other jaw (offset half a tooth, so the
      // two rows interlock when they meet).
      const nT = 6;
      const tw = (W * 2) / nT;
      for (let i = 0; i < nT; i++) {
        const tx = x - W + tw * (i + (side > 0 ? 0.5 : 0));
        if (tx + tw > x + W + 4) continue;
        const len = 30 + (i % 2) * 8;
        const tri = [
          { x: tx + 3, y: edgeY },
          { x: tx + tw * 0.5 + (rnd() - 0.5) * 4, y: edgeY - side * len },
          { x: tx + tw - 3, y: edgeY },
        ];
        g.fillStyle(tooth, 1);
        g.fillPoints(tri, true);
        ART.pen(g, tri, true, 3, lip, 1, rnd);
      }
      ART.pen(g, [{ x: x - W - 10, y: edgeY }, { x: x + W + 10, y: edgeY }], false, 4, SKETCH.deepRed, 1, rnd);
    }
    if (k < 1) return;
    // The snap: a crayon scribble bursting out of the closed jaws, plus a ring of ink asterisks.
    const h = Math.min(1, (k - 1) / 1.6);
    const grow = 1 - (1 - h) * (1 - h);
    const fade = 1 - h * h * 0.7;
    const cols = [SKETCH.yellow, SKETCH.orange, SKETCH.red];
    for (let s = 0; s < 3; s++) {
      const sr = artRandom(s * 131 + bf * 7 + 3);
      const pts = [];
      const loops = 26;
      for (let i = 0; i < loops; i++) {
        const a = i * 2.39 + sr() * 0.8 + s;
        const r = (40 + 150 * grow) * (0.35 + sr() * 0.65);
        pts.push({ x: x + Math.cos(a) * r, y: y + Math.sin(a) * r * 0.8 });
      }
      ART.pen(g, pts, false, 9, ART.backing, 0.35 * fade, sr);
      ART.pen(g, pts, false, 5.5 - s, cols[s], fade, sr);
    }
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2 + 0.4;
      const r = 90 + 120 * grow;
      ART.asterisk(g, x + Math.cos(a) * r, y + Math.sin(a) * r * 0.85, 10 + 6 * (1 - h), i % 2 ? SKETCH.yellow : SKETCH.orange, fade, 3, rnd);
    }
  },

  // ---------- hazards ----------

  asteroidTexture(scene, design, variant, inkKey) {
    const ik = inkKey || ART.inkKey;
    const key = 'ast_' + design + '_' + ik + '_' + variant;
    const ink = ART.inkForKey(ik);
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

  blackHoleTexture(scene, variant, inkKey) {
    const ik = inkKey || ART.inkKey;
    const key = 'bh_' + ik + '_' + variant;
    const ink = ART.inkForKey(ik);
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
    // Skin (ctx.skin = crayon colors from PROGRESS): Classic keeps the original speed-tinted look.
    const skin = ctx.skin && ctx.skinId !== 'classic' ? ctx.skin : null;
    const body = skin ? skin.head : lerpColor(speedCol, SKETCH.yellow, 0.55);
    const cFlame = skin ? skin.flame : SKETCH.orange;
    const cTrail = skin ? skin.trail : SKETCH.red;
    const cHot = skin ? lerpColor(skin.head, skin.flame, 0.35) : SKETCH.yellow;
    const detail = skin ? ctx.skinDetail || null : null;
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
      // Pages whose paper is close to the warm crayons get a pencil edge along the tail: dark ink on
      // the light pages, a thin cream gel-pen line on the brown kraft and charcoal pages.
      const onCream = ART.inkMode === 'd';
      const edgeCol = onCream ? ART.ink : ART.tailEdge;
      const strands = [
        { off: -0.85 * wide, c: tint(cTrail, 0x3a5fd8), w: 5, reach: 0.75 },
        { off: 0.85 * wide, c: tint(cTrail, 0x3a5fd8), w: 5, reach: 0.7 },
        { off: -0.5 * wide, c: tint(cFlame, 0x5aa8f0), w: 6, reach: 0.9 },
        { off: 0.5 * wide, c: tint(cFlame, 0x5aa8f0), w: 6, reach: 0.88 },
        { off: -0.15, c: tint(body, 0xa9dcff), w: 7, reach: 1 },
        { off: 0.2, c: tint(lerpColor(body, 0xffffff, 0.45), 0xf4fbff), w: 5, reach: 0.95 },
      ];
      if (skin && skin.stripes && skin.stripes.length >= 6) {
        // Rainbow: the strands become side-by-side crayon bands, one color each across the tail.
        const byOffset = strands.slice().sort((a, b) => a.off - b.off);
        byOffset.forEach((st, k) => { st.c = tint(skin.stripes[k], 0x8fc8ff); st.w = 7; st.reach = 0.92 - Math.abs(st.off) * 0.15; });
      }
      const normals = [];
      for (let i = 0; i < n; i++) {
        const a = trail[Math.max(0, i - 1)];
        const b = trail[Math.min(n - 1, i + 1)];
        let tx = a.x - b.x;
        let ty = a.y - b.y;
        const len = Math.hypot(tx, ty) || 1;
        normals.push({ x: -ty / len, y: tx / len });
      }
      if (edgeCol !== undefined) {
        // The warm strands would melt into the paper, so the tail gets a pencil edge on both
        // sides first (the strands are drawn over its inner half).
        for (const side of [-1, 1]) {
          const m = Math.max(2, Math.floor(n * 0.8));
          const pts = [];
          for (let i = 0; i < m; i++) {
            const f = 1 - i / m;
            const spread = side * wide * r * (0.35 + 0.75 * f) * 1.08 + (rnd() - 0.5) * 3;
            pts.push({ x: trail[i].x + normals[i].x * spread, y: trail[i].y + normals[i].y * spread });
          }
          g.lineStyle(onCream ? 4.5 : 3, edgeCol, onCream ? 0.85 : 0.6);
          g.strokePoints(pts, false);
        }
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
      g.lineStyle(3, tint(cHot, 0xdff2ff), 0.85);
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

    if (detail) ART.drawSkinDetail(g, 'back', comet, trail, dir, r, skin, detail, rnd, t);

    // PERFECT / zone bursts sit behind the head so the face stays readable.
    const zonePulse = Math.max(0, Math.min(1, ctx.zonePulse || 0));
    if (zonePulse > 0) ART.drawShockBurst(g, comet.x, comet.y, zonePulse, ink, 1.6, t);
    const perfectPulse = Math.max(0, Math.min(1, ctx.perfectPulse || 0));
    if (perfectPulse > 0) ART.drawShockBurst(g, comet.x, comet.y, perfectPulse, SKETCH.gold, 1, t);
    const flash = Math.max(0, Math.min(1, ctx.perfectFlash || 0));
    if (flash > 0) ART.drawPerfectRing(g, comet.x, comet.y, flash, t);
    const mom = Math.max(0, Math.min(1, ctx.momentum || 0));

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
    // The afterburner and MOMENTUM both make the crown lick further back (and a bit wider).
    const long = 1 + 0.5 * burn + 0.9 * mom;
    const tall = 1 + 0.35 * mom;
    const crown = [
      { x: r * 0.3, y: -r * 1.0 },
      { x: -r * 0.9 * long + j(), y: -r * 1.35 * tall + j() },
      { x: -r * 0.8, y: -r * 0.55 },
      { x: -r * 2.3 * long + j(), y: j() * 0.6 },
      { x: -r * 0.8, y: r * 0.55 },
      { x: -r * 0.9 * long + j(), y: r * 1.35 * tall + j() },
      { x: r * 0.3, y: r * 1.0 },
    ];
    if (mom > 0.15) {
      // MOMENTUM: loose red crayon flame tongues behind the crown, more and longer the faster you go.
      const tongues = 1 + Math.floor(mom * 4);
      for (let i = 0; i < tongues; i++) {
        const side = i % 2 ? 1 : -1;
        const y0 = side * r * (0.35 + 0.18 * i);
        const reach = r * (1.6 + 1.6 * mom + rnd() * 0.6);
        const tongue = [
          { x: -r * 0.6, y: y0 - side * r * 0.25 },
          { x: -r * 0.6 - reach * 0.55 + j(), y: y0 + side * r * (0.35 + 0.3 * mom) + j() },
          { x: -r * 0.6 - reach + j(), y: y0 + side * r * 0.15 + j() },
          { x: -r * 0.6 - reach * 0.45, y: y0 - side * r * 0.05 },
        ];
        g.fillStyle(i % 2 ? cTrail : cFlame, 0.9);
        g.fillPoints(tongue, true);
        ART.pen(g, tongue, true, 2.5 + mom * 1.5, ink, 0.9, rnd);
      }
    }
    g.fillStyle(tint(cFlame, 0x4f8fe8), 1);
    g.fillPoints(crown, true);
    g.fillStyle(tint(cHot, 0xd8efff), 1);
    g.fillTriangle(r * 0.2, -r * 0.6, r * 0.2, r * 0.6, -r * 1.6 * long + j(), j() * 0.5);
    if (detail === 'stripes' && skin.stripes) {
      // Rainbow: crayon bands arc over the back of the crown.
      for (let k = 0; k < 4; k++) {
        const arc = [];
        const rr = r * (1.05 + k * 0.2);
        for (let a = 0; a <= 6; a++) {
          const ang = Math.PI * (0.62 + (a / 6) * 0.76);
          arc.push({ x: Math.cos(ang) * rr * 1.25 + (rnd() - 0.5) * 2, y: Math.sin(ang) * rr });
        }
        g.lineStyle(5, skin.stripes[k], 0.95);
        g.strokePoints(arc, false);
      }
    }
    ART.pen(g, crown, true, 3.5, ink, 1, rnd);
    // Head: sticker backing, misregistered crayon fill, hatching, pen outline.
    const head = ART.wobblyLoop(0, 0, r, r, 12, 0.1, rnd, rnd());
    g.fillStyle(ART.backing, 0.9);
    g.fillCircle(0, 0, r + 6);
    // PERFECT flash: the head fill goes pale cream for a moment (crayon, not a glow).
    g.fillStyle(flash > 0 ? lerpColor(body, 0xfffbe8, flash * 0.85) : body, 1);
    g.fillPoints(head.map((p) => ({ x: p.x + 2.5, y: p.y + 2 })), true);
    ART.hatchCircle(g, -r * 0.15, r * 0.25, r * 0.75, -0.9, 6, 3, cFlame, 0.8, rnd);
    ART.pen(g, head, true, 5.5, ink, 1, rnd);
    // Gold: a second, inner pen line in the skin's own ink (the page ink rim stays for contrast).
    if (skin && skin.outline !== undefined) ART.pen(g, head.map((p) => ({ x: p.x * 0.86, y: p.y * 0.86 })), true, 2.5, skin.outline, 0.9, rnd);
    g.restore();
    // Cool light from above: two short pale strokes on the top of the head.
    g.lineStyle(3, 0xffffff, 0.8);
    g.lineBetween(comet.x - r * 0.55, comet.y - r * 0.3, comet.x - r * 0.25, comet.y - r * 0.62);
    g.lineBetween(comet.x - r * 0.3, comet.y - r * 0.2, comet.x - r * 0.08, comet.y - r * 0.45);

    if (detail) ART.drawSkinDetail(g, 'front', comet, trail, dir, r, skin, detail, rnd, t);
    ART.drawCometFace(g, comet.x + dir.x * r * 0.2, comet.y + dir.y * r * 0.2, r, dir, ctx, rnd);
    if (ctx.shieldReady) ART.drawShieldBubble(g, comet.x, comet.y, r, t);
  },

  // Small hand-drawn doodle that tells a skin apart beyond its colors (PROGRESS skin.detail).
  // layer 'back' draws behind the head (tail / halo bits), 'front' on the rim, never over the face.
  // Every doodle gets a page-ink outline or backing so it reads on the navy and the cream pages.
  drawSkinDetail(g, layer, comet, trail, dir, r, skin, detail, rnd, t) {
    const ink = ART.ink;
    const nx = -dir.y;
    const ny = dir.x;
    const behind = Math.atan2(-dir.y, -dir.x);
    const at = (i) => trail[Math.min(trail.length - 1, i)];
    if (detail === 'frost') {
      if (layer === 'back') {
        // Snowflake doodles left behind in the tail.
        for (const i of [4, 10, 16]) {
          if (trail.length <= i) break;
          const p = at(i);
          const side = i % 4 ? 1 : -1;
          const x = p.x + nx * side * r * 0.9;
          const y = p.y + ny * side * r * 0.9;
          ART.asterisk(g, x, y, 10, ART.backing, 0.6, 6, rnd);
          ART.asterisk(g, x, y, 9, ART.inkMode === 'd' ? skin.trail : 0xeaf8ff, 1, 3, rnd);
        }
        return;
      }
      // Icicle teeth hanging straight down off the bottom rim (below the face, never over it).
      for (let k = -1; k <= 1; k++) {
        const a = Math.PI / 2 + k * 0.62;
        const reach = r * (k === 0 ? 1.75 : 1.45);
        const tip = { x: comet.x + Math.cos(a) * reach + (rnd() - 0.5) * 2, y: comet.y + Math.sin(a) * reach + (rnd() - 0.5) * 2 };
        const w = 0.24;
        const tri = [
          { x: comet.x + Math.cos(a - w) * r * 0.88, y: comet.y + Math.sin(a - w) * r * 0.88 },
          tip,
          { x: comet.x + Math.cos(a + w) * r * 0.88, y: comet.y + Math.sin(a + w) * r * 0.88 },
        ];
        g.fillStyle(0xdff4ff, 1);
        g.fillPoints(tri, true);
        ART.pen(g, tri, true, 2.5, ink === SKETCH.cream ? SKETCH.dark : ink, 1, rnd);
        g.lineStyle(2, 0x4f8fe0, 0.9);
        g.lineBetween(comet.x + Math.cos(a) * r * 0.95, comet.y + Math.sin(a) * r * 0.95, (comet.x + Math.cos(a) * r + tip.x) / 2, (comet.y + Math.sin(a) * r + tip.y) / 2);
      }
    } else if (detail === 'splat') {
      const violet = 0x5b4f96;
      if (layer === 'front') {
        // An ink blot splashed over the crown behind the head (the face stays clear in front).
        const cx = comet.x - dir.x * r * 1.25 + nx * r * 0.2;
        const cy = comet.y - dir.y * r * 1.25 + ny * r * 0.2;
        const blot = ART.wobblyLoop(cx, cy, r * 0.62, r * 0.52, 11, 0.7, rnd, rnd() * 6);
        g.fillStyle(violet, 1);
        g.fillPoints(blot, true);
        ART.pen(g, blot, true, 3, ink, 1, rnd);
        for (let k = 0; k < 3; k++) {
          const a = behind + (k - 1) * 0.9 + (rnd() - 0.5) * 0.2;
          const d = r * (1.95 + k * 0.15);
          g.fillStyle(ink, 1);
          g.fillCircle(comet.x + Math.cos(a) * d, comet.y + Math.sin(a) * d, 5.5);
          g.fillStyle(violet, 1);
          g.fillCircle(comet.x + Math.cos(a) * d, comet.y + Math.sin(a) * d, 3.5);
        }
        return;
      }
      for (const i of [3, 7, 12, 17]) {
        if (trail.length <= i) break;
        const p = at(i);
        const side = i % 2 ? 1 : -1;
        const off = r * (0.95 + (i % 3) * 0.25);
        const dr = Math.max(3, 7 - i * 0.2);
        g.fillStyle(ink, 1);
        g.fillCircle(p.x + nx * side * off, p.y + ny * side * off, dr + 2);
        g.fillStyle(violet, 1);
        g.fillCircle(p.x + nx * side * off, p.y + ny * side * off, dr);
      }
    } else if (detail === 'drips') {
      if (layer !== 'front') return;
      // Toxic goo dripping straight down off the head (gravity, whichever way the comet flies).
      [-0.55, 0.05, 0.6].forEach((fx, k) => {
        const x = comet.x + fx * r;
        const y0 = comet.y + Math.sqrt(Math.max(0, 1 - fx * fx)) * r * 0.85;
        const len = r * (0.45 + ((t * 0.9 + k * 0.37) % 1) * 0.5 + (k === 1 ? 0.25 : 0));
        const w = r * 0.17;
        const drip = [
          { x: x - w, y: y0 - 2 }, { x: x - w * 0.8, y: y0 + len * 0.7 }, { x: x - w * 1.2, y: y0 + len },
          { x, y: y0 + len + w * 1.1 }, { x: x + w * 1.2, y: y0 + len }, { x: x + w * 0.8, y: y0 + len * 0.7 },
          { x: x + w, y: y0 - 2 },
        ];
        g.fillStyle(skin.flame, 1);
        g.fillPoints(drip, true);
        ART.pen(g, drip, false, 2.5, ink, 1, rnd);
        g.fillStyle(0xf2ffd0, 0.9);
        g.fillCircle(x - w * 0.3, y0 + len * 0.85, w * 0.35);
      });
    } else if (detail === 'star') {
      if (layer === 'back') {
        // Twinkling asterisks shaken out of the tail.
        for (const i of [5, 11]) {
          if (trail.length <= i) break;
          const p = at(i);
          const side = i === 5 ? 1 : -1;
          ART.asterisk(g, p.x + nx * side * r * 1.1, p.y + ny * side * r * 1.1, 9, ART.inkMode === 'd' ? skin.trail : 0xffe14d, 1, 3.5, rnd);
        }
        return;
      }
      // A crayon star sticker stuck on the back rim of the head.
      const a0 = behind - 0.75;
      const sx = comet.x + Math.cos(a0) * r * 0.95;
      const sy = comet.y + Math.sin(a0) * r * 0.95;
      const pts = [];
      for (let k = 0; k < 10; k++) {
        const ang = -Math.PI / 2 + (k / 10) * Math.PI * 2 + (rnd() - 0.5) * 0.12 + 0.2;
        const rr = (k % 2 ? 0.45 : 1) * r * 0.66 * (0.92 + rnd() * 0.16);
        pts.push({ x: sx + Math.cos(ang) * rr, y: sy + Math.sin(ang) * rr });
      }
      g.fillStyle(0xffe14d, 1);
      g.fillPoints(pts.map((p) => ({ x: p.x + 1.5, y: p.y + 1.5 })), true);
      g.lineStyle(2, skin.flame, 0.9);
      g.lineBetween(sx - r * 0.15, sy + r * 0.1, sx + r * 0.1, sy - r * 0.12);
      ART.pen(g, pts, true, 3, ink === SKETCH.cream ? (skin.outline !== undefined ? skin.outline : SKETCH.dark) : ink, 1, rnd);
    } else if (detail === 'flare') {
      if (layer !== 'back') return;
      // A ring of flare rays around the head, long and short, turning a little with each boil.
      const turn = Math.floor(t * SKETCH.boilFps) * 0.04;
      for (let k = 0; k < 10; k++) {
        const a = turn + (k / 10) * Math.PI * 2 + (rnd() - 0.5) * 0.12;
        const r0 = r * 1.2;
        const r1 = r * (k % 2 ? 1.65 : 2.15) * (0.92 + rnd() * 0.16);
        const x0 = comet.x + Math.cos(a) * r0;
        const y0 = comet.y + Math.sin(a) * r0;
        const x1 = comet.x + Math.cos(a) * r1;
        const y1 = comet.y + Math.sin(a) * r1;
        g.lineStyle(9, ART.backing, 0.55);
        g.lineBetween(x0, y0, x1, y1);
        g.lineStyle(k % 2 ? 3.5 : 5, k % 2 ? skin.trail : skin.flame, 1);
        g.lineBetween(x0, y0, x1, y1);
      }
    }
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
  // PERFECT (every one): a quick hand-inked ring that bursts off the comet, two pen passes that do
  // not quite meet plus short tick marks, so a chained PERFECT reads without any text.
  drawPerfectRing(g, x, y, p, t) {
    const r = TUNING.cometRadius;
    const rnd = artRandom(ART.boilFrame(t || 0) * 97 + 11);
    const k = 1 - p;
    const ringR = r * 1.3 + (1 - (1 - k) * (1 - k)) * 70;
    for (let pass = 0; pass < 2; pass++) {
      const start = rnd() * Math.PI * 2;
      const sweep = Math.PI * (1.7 + pass * 0.25);
      const pts = [];
      for (let i = 0; i <= 18; i++) {
        const a = start + (i / 18) * sweep;
        const rr = ringR + pass * 7 + (rnd() - 0.5) * 5;
        pts.push({ x: x + Math.cos(a) * rr, y: y + Math.sin(a) * rr });
      }
      g.lineStyle((pass ? 3 : 5) * p + 1.5, pass ? SKETCH.gold : ART.ink, Math.min(1, p * 1.6));
      g.strokePoints(pts, false);
    }
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + rnd() * 0.4;
      const from = ringR + 8;
      g.lineStyle(3 * p + 1, ART.ink, p);
      g.lineBetween(x + Math.cos(a) * from, y + Math.sin(a) * from, x + Math.cos(a) * (from + 14 * p + 4), y + Math.sin(a) * (from + 14 * p + 4));
    }
  },

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
