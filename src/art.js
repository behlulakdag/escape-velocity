// All world drawing for the game scene lives here, so the look can change without touching
// game logic. Every function draws into a Phaser Graphics object `g` in world coordinates.
// `ctx` carries read-only state useful for reactive art:
//   { time (seconds), comet {x,y,vx,vy}, speed, speedFraction, orbitPlanet, isHolding, danger (0..1),
//     stretch (>=1), perfectChain (int), closeCall (0..1), squash (0..1, optional),
//     aimKind ('none'|'target'|'perfect', optional),
//     perfectPulse (0..1, optional, default 0): set to 1 on a PERFECT and decay to 0 over ~0.4s;
//       drawComet draws a gold shock ring + rays bursting out of the comet (a LOCAL effect, use it
//       instead of a full-screen flash),
//     zonePulse (0..1, optional, default 0): same, for entering a new zone; a wider cyan/white
//       double ring around the comet,
//     afterburner (0..1, optional): Afterburner card active; the tail turns blue/white,
//     shieldReady (bool, optional): a Heat Shield charge is ready; a bubble surrounds the comet,
//     grabRangeBonus (px, optional): added to TUNING.grabRange so drawn grab rings match the real range }
//   - newer fields may be undefined.
// No function here draws large full-screen translucent fills: big moments stay local to the
// comet / planet / nova front so the palette never washes out at high speed or danger.
// Style: bright cartoon space, thick dark outlines, cel shading, cute faces on everything.
// Performance: everything is redrawn each frame, so shapes stay cheap (circles, short polygons)
// and per-object geometry that never changes is computed once and cached on the object (`_art`).

// Deterministic 0..1 random stream from a seed, so a planet keeps its look every frame.
function artRandom(seed) {
  let s = Math.floor(Math.abs(seed)) % 2147483647 || 1;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

// Unit circle / half-ellipse points reused by rings and accretion disks.
const ART_HALF_ARC = (() => {
  const pts = [];
  for (let i = 0; i <= 16; i++) pts.push(Math.PI * (i / 16));
  return pts;
})();

const ART = {
  outline: 0x1a1033,
  white: 0xffffff,
  blush: 0xff7fae,
  gold: 0xffe14d,
  green: 0x5eff8f,

  // ---------- small shared helpers ----------

  // Direction the comet is travelling. During an orbit vx/vy can be stale, so the trail wins.
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

  // Round cartoon eye: dark rim, white, pupil looking along (lx, ly), sparkle.
  eye(g, x, y, r, lx, ly, pupilScale) {
    g.fillStyle(ART.outline, 1);
    g.fillCircle(x, y, r + Math.max(2, r * 0.22));
    g.fillStyle(0xffffff, 1);
    g.fillCircle(x, y, r);
    const pr = r * (pupilScale || 0.55);
    const px = x + lx * (r - pr) * 0.7;
    const py = y + ly * (r - pr) * 0.7;
    g.fillStyle(ART.outline, 1);
    g.fillCircle(px, py, pr);
    g.fillStyle(0xffffff, 1);
    g.fillCircle(px - pr * 0.35, py - pr * 0.4, Math.max(1.5, pr * 0.38));
  },

  // Closed eye arc: happy = "^" (upper half), else "u" (sleepy / content).
  closedEye(g, x, y, r, happy, width) {
    g.lineStyle(width || Math.max(3, r * 0.45), ART.outline, 1);
    g.beginPath();
    if (happy) g.arc(x, y + r * 0.4, r, Math.PI * 1.15, Math.PI * 1.85, false);
    else g.arc(x, y - r * 0.5, r, Math.PI * 0.15, Math.PI * 0.85, false);
    g.strokePath();
  },

  // Smile: filled half-disc mouth with a tongue (open) or a curved line (closed).
  smile(g, x, y, w, open, width) {
    if (open) {
      g.fillStyle(ART.outline, 1);
      g.beginPath();
      g.arc(x, y, w, 0, Math.PI, false);
      g.closePath();
      g.fillPath();
      g.fillStyle(0xff5c8a, 1);
      g.fillEllipse(x, y + w * 0.6, w * 1.0, w * 0.55);
    } else {
      g.lineStyle(width || Math.max(3, w * 0.35), ART.outline, 1);
      g.beginPath();
      g.arc(x, y - w * 0.4, w, Math.PI * 0.2, Math.PI * 0.8, false);
      g.strokePath();
    }
  },

  // 4-point sparkle star.
  sparkle(g, x, y, r, rot, color, alpha) {
    const pts = [];
    for (let i = 0; i < 8; i++) {
      const a = rot + (i * Math.PI) / 4;
      const d = i % 2 === 0 ? r : r * 0.32;
      pts.push({ x: x + Math.cos(a) * d, y: y + Math.sin(a) * d });
    }
    g.fillStyle(color, alpha === undefined ? 1 : alpha);
    g.fillPoints(pts, true);
  },

  // Dashed circle made of straight chords (much cheaper than many separate arcs).
  dashedRing(g, x, y, r, dashes, rot, width, color, alpha) {
    g.lineStyle(width, color, alpha);
    const step = (Math.PI * 2) / dashes;
    for (let i = 0; i < dashes; i++) {
      const a0 = rot + i * step;
      const a1 = a0 + step * 0.5;
      g.lineBetween(x + Math.cos(a0) * r, y + Math.sin(a0) * r, x + Math.cos(a1) * r, y + Math.sin(a1) * r);
    }
  },

  // ---------- walls ----------

  // Shade outside the side walls (only visible when the camera zooms out).
  drawWalls(g, view) {
    if (view.left >= 0) return;
    g.fillStyle(0x120a2a, 0.75);
    g.fillRect(view.left, view.top, -view.left, view.bottom - view.top);
    g.fillRect(GAME_WIDTH, view.top, view.right - GAME_WIDTH, view.bottom - view.top);
    g.lineStyle(22, 0xff6fb5, 0.18);
    g.lineBetween(0, view.top, 0, view.bottom);
    g.lineBetween(GAME_WIDTH, view.top, GAME_WIDTH, view.bottom);
    g.lineStyle(8, 0xff6fb5, 0.85);
    g.lineBetween(0, view.top, 0, view.bottom);
    g.lineBetween(GAME_WIDTH, view.top, GAME_WIDTH, view.bottom);
  },

  // ---------- planets ----------

  // Look derived once from the planet's own fields + position, then cached.
  planetStyle(p) {
    if (p._art) return p._art;
    const R = p.radius;
    const rnd = artRandom(p.x * 7.13 + p.y * 3.71 + R * 13);
    const kinds = ['bands', 'craters', 'spots', 'ice'];
    const kind = kinds[Math.floor(rnd() * kinds.length)];
    const shadow = lerpColor(p.color, 0x2a1a5e, 0.42);
    const light = lerpColor(p.color, 0xffffff, 0.45);
    const detail = lerpColor(p.color, 0x2a1a5e, 0.25);
    const ringColors = [0xfff1c1, 0x9ff3ff, 0xffd1f0, 0xc8ffb0];
    const style = {
      kind, shadow, light, detail,
      tilt: (rnd() - 0.5) * 0.5,
      ringColor: ringColors[Math.floor(rnd() * ringColors.length)],
      ringInner: lerpColor(p.color, 0xffffff, 0.2),
      bands: [], spots: [], cap: null,
      zPhase: rnd() * 10,
      blinkPhase: rnd() * 5,
      ringBack: [], ringFront: [],
    };
    if (kind === 'bands') {
      // Horizontal stripes clipped to the disc by building them from the circle edge.
      const count = 2 + Math.floor(rnd() * 2);
      for (let b = 0; b < count; b++) {
        const y1 = -R * 0.75 + (b + 0.2 + rnd() * 0.3) * (R * 1.5 / count);
        const y2 = y1 + R * (0.14 + rnd() * 0.12);
        const pts = [];
        for (let k = 0; k <= 4; k++) {
          const y = y1 + ((y2 - y1) * k) / 4;
          pts.push({ x: Math.sqrt(Math.max(0, R * R * 0.94 - y * y)), y });
        }
        for (let k = 4; k >= 0; k--) {
          const y = y1 + ((y2 - y1) * k) / 4;
          pts.push({ x: -Math.sqrt(Math.max(0, R * R * 0.94 - y * y)), y });
        }
        style.bands.push(pts);
      }
    } else if (kind === 'spots') {
      for (let s = 0; s < 4; s++) {
        const a = rnd() * Math.PI * 2;
        const d = rnd() * R * 0.5;
        style.spots.push({ x: Math.cos(a) * d, y: Math.sin(a) * d, r: R * (0.1 + rnd() * 0.12), lightSpot: rnd() < 0.4 });
      }
    } else if (kind === 'ice') {
      // Wavy polar cap above y = -0.55R.
      const capY = -R * 0.55;
      const halfW = Math.sqrt(R * R * 0.95 - capY * capY);
      const pts = [];
      for (let k = 0; k <= 6; k++) {
        const x = -halfW + (2 * halfW * k) / 6;
        pts.push({ x, y: capY + (k % 2 ? R * 0.08 : 0) });
      }
      for (let k = 0; k <= 8; k++) {
        const ang = Math.atan2(capY, halfW);
        const t = ang + (-Math.PI - 2 * ang) * (k / 8);
        pts.push({ x: Math.cos(t) * R * 0.975, y: Math.sin(t) * R * 0.975 });
      }
      style.cap = pts;
    }
    // Tilted ring as two halves so the front half can overlap the planet.
    const rw = R * 1.5;
    const rh = R * 0.42;
    for (const a of ART_HALF_ARC) {
      style.ringBack.push({ x: Math.cos(a + Math.PI) * rw, y: Math.sin(a + Math.PI) * rh });
      style.ringFront.push({ x: Math.cos(a) * rw, y: Math.sin(a) * rh });
    }
    p._art = style;
    return style;
  },

  strokeRing(g, pts, s) {
    g.lineStyle(14, ART.outline, 1);
    g.strokePoints(pts, false);
    g.lineStyle(8, s.ringColor, 1);
    g.strokePoints(pts, false);
    g.lineStyle(2.5, 0xffffff, 0.7);
    g.strokePoints(pts, false);
  },

  // highlighted: comet could grab it / is orbiting it. isTarget: a release now flies to it.
  drawPlanet(g, p, highlighted, isTarget, ctx) {
    const s = ART.planetStyle(p);
    const R = p.radius;
    const t = ctx.time;
    const orbiting = ctx.orbitPlanet === p;
    const look = ctx.comet ? ART.lookAt(p.x, p.y, ctx.comet.x, ctx.comet.y) : { x: 0, y: -1, dist: 9999 };
    const zone = R + TUNING.grabRange + (ctx.grabRangeBonus || 0);

    // The release target only gets a soft rim glow hugging the planet (green, gold for PERFECT):
    // a big filled zone read like a debug hitbox. The grab-zone ring shows only when you could grab.
    if (isTarget) {
      const perfect = ctx.aimKind === 'perfect';
      const glow = perfect ? ART.gold : ART.green;
      const pulse = 0.5 + 0.5 * Math.sin(t * (perfect ? 12 : 7));
      g.lineStyle(18, glow, 0.16 + pulse * 0.14);
      g.strokeCircle(p.x, p.y, R + 16);
      g.lineStyle(5, glow, 0.75 + pulse * 0.25);
      g.strokeCircle(p.x, p.y, R + 12);
    } else if (highlighted && !orbiting) {
      ART.dashedRing(g, p.x, p.y, zone, 28, t * 0.25, 4, 0xffffff, 0.3);
      // Gravity Well: the widened ring reads in the orbit family's teal so the bigger reach shows.
      if (ctx.grabRangeBonus > 0) ART.dashedRing(g, p.x, p.y, zone, 28, t * 0.25, 7, 0x2ee6c8, 0.55);
    }

    let mood = 'idle';
    if (isTarget) mood = 'target';
    else if (orbiting) mood = 'orbit';
    else if (p.mood === 'near' || look.dist < zone + 90) mood = 'near';

    // Squash & jiggle when grabbed; a gentle breathing otherwise.
    const w = p.wobble || 0;
    const jig = w * 0.14 * Math.sin(t * 32);
    const breathe = 0.012 * Math.sin(t * 2 + s.zPhase);
    g.save();
    g.translateCanvas(p.x, p.y);
    g.scaleCanvas(1 + jig + breathe, 1 - jig - breathe);

    if (p.hasRing) {
      g.save();
      g.rotateCanvas(s.tilt);
      ART.strokeRing(g, s.ringBack, s);
      g.restore();
    }
    // Body: outline, shadow side, lit side offset to the upper-left (cel shading).
    g.fillStyle(ART.outline, 1);
    g.fillCircle(0, 0, R + 6);
    g.fillStyle(s.shadow, 1);
    g.fillCircle(0, 0, R);
    g.fillStyle(p.color, 1);
    g.fillCircle(-R * 0.1, -R * 0.1, R * 0.84);

    if (s.kind === 'bands') {
      g.save();
      g.rotateCanvas(s.tilt);
      g.fillStyle(s.detail, 0.55);
      for (const band of s.bands) g.fillPoints(band, true);
      g.restore();
    } else if (s.kind === 'spots') {
      for (const sp of s.spots) {
        g.fillStyle(sp.lightSpot ? s.light : s.detail, 0.8);
        g.fillCircle(sp.x, sp.y, sp.r);
      }
    } else if (s.kind === 'ice') {
      g.fillStyle(0xffffff, 0.92);
      g.fillPoints(s.cap, true);
    }
    if (s.kind === 'craters' || s.kind === 'spots') {
      for (const c of p.craters) {
        const cx = Math.cos(c.a) * c.d;
        const cy = Math.sin(c.a) * c.d;
        g.fillStyle(s.detail, 0.9);
        g.fillCircle(cx, cy, c.r);
        g.fillStyle(s.shadow, 1);
        g.fillCircle(cx + c.r * 0.15, cy + c.r * 0.15, c.r * 0.72);
      }
    }
    // Rim light + shine blob.
    g.fillStyle(0xffffff, 0.45);
    g.fillEllipse(-R * 0.42, -R * 0.5, R * 0.42, R * 0.24);
    g.fillStyle(0xffffff, 0.8);
    g.fillCircle(-R * 0.62, -R * 0.2, Math.max(2.5, R * 0.06));

    ART.drawPlanetFace(g, p, s, mood, look, t);

    if (p.hasRing) {
      g.save();
      g.rotateCanvas(s.tilt);
      ART.strokeRing(g, s.ringFront, s);
      g.restore();
    }
    g.restore();

    // Floating "z" above sleepy planets (outside the squash transform).
    if (mood === 'idle') {
      const life = (t * 0.45 + s.zPhase) % 1;
      const zx = p.x + R * 0.7 + life * 18;
      const zy = p.y - R * 0.9 - life * 40;
      const zs = 7 + R * 0.06;
      g.lineStyle(4, ART.outline, 0.85 * (1 - life));
      g.beginPath();
      g.moveTo(zx - zs, zy - zs);
      g.lineTo(zx + zs, zy - zs);
      g.lineTo(zx - zs, zy + zs);
      g.lineTo(zx + zs, zy + zs);
      g.strokePath();
    }
  },

  drawPlanetFace(g, p, s, mood, look, t) {
    const R = p.radius;
    const er = 4 + R * 0.1;
    const ex = er * 1.25 + R * 0.12;
    const ey = R * 0.05;
    const my = ey + er * 1.9;
    const lx = look.x;
    const ly = look.y;
    if (mood === 'target' || mood === 'orbit') {
      g.fillStyle(ART.blush, 0.55);
      g.fillEllipse(-ex - er * 0.9, my - er * 0.3, er * 1.6, er * 0.9);
      g.fillEllipse(ex + er * 0.9, my - er * 0.3, er * 1.6, er * 0.9);
    }
    if (mood === 'idle') {
      const blink = ((t + s.blinkPhase) % 6) < 0.25;
      ART.closedEye(g, -ex, ey, er * 0.8, false);
      ART.closedEye(g, ex, ey, er * 0.8, false);
      if (blink) { /* sleepy planets are already closed-eyed */ }
      g.fillStyle(ART.outline, 1);
      g.fillEllipse(0, my, er * 0.7, er * 0.5 + Math.sin(t * 2 + s.zPhase) * er * 0.12);
    } else if (mood === 'near') {
      ART.eye(g, -ex, ey, er * 1.05, lx, ly, 0.42);
      ART.eye(g, ex, ey, er * 1.05, lx, ly, 0.42);
      g.fillStyle(ART.outline, 1);
      g.fillCircle(0, my + er * 0.1, er * 0.5);
      g.fillStyle(0xff5c8a, 1);
      g.fillCircle(0, my + er * 0.25, er * 0.25);
    } else if (mood === 'orbit') {
      ART.closedEye(g, -ex, ey, er * 0.85, true);
      ART.closedEye(g, ex, ey, er * 0.85, true);
      ART.smile(g, 0, my - er * 0.3, er * 0.9, true);
    } else {
      // target: excited, sparkly eyes, raised brows, big open grin.
      ART.eye(g, -ex, ey, er * 1.2, lx, ly, 0.6);
      ART.eye(g, ex, ey, er * 1.2, lx, ly, 0.6);
      g.lineStyle(Math.max(3, er * 0.35), ART.outline, 1);
      g.lineBetween(-ex - er * 0.9, ey - er * 2.0, -ex + er * 0.6, ey - er * 2.3);
      g.lineBetween(ex + er * 0.9, ey - er * 2.0, ex - er * 0.6, ey - er * 2.3);
      ART.smile(g, 0, my - er * 0.2, er * 1.15, true);
    }
  },

  // ---------- supernova ----------

  // Layered, wobbling wall of fire with an angry face that tracks the comet.
  drawNova(g, novaY, view, ctx) {
    if (novaY > view.bottom + 40) return;
    const t = ctx.time;
    const danger = ctx.danger || 0;
    const left = view.left - 20;
    const right = view.right + 20;
    const step = Math.max(24, (right - left) / 40);

    // Heat glow above the front.
    // Low alpha on purpose: at high danger this band fills much of the view and must not wash it out.
    g.fillStyle(0xff7a2e, 0.04 + danger * 0.03);
    g.fillRect(left, novaY - 220, right - left, 220);
    g.fillStyle(0xffb347, 0.05 + danger * 0.03);
    g.fillRect(left, novaY - 110, right - left, 110);

    // Heat shimmer: faint wavy lines drifting upward.
    for (let k = 0; k < 3; k++) {
      const life = (t * 0.7 + k / 3) % 1;
      const y0 = novaY - 30 - life * 200;
      const pts = [];
      for (let x = left; x <= right; x += step * 1.5) {
        pts.push({ x, y: y0 + Math.sin(x * 0.03 + t * 6 + k * 2) * 6 });
      }
      g.lineStyle(3, 0xfff1c1, 0.22 * (1 - life));
      g.strokePoints(pts, false);
    }

    const layers = [
      { offset: -10, color: 0xffffff, alpha: 0.9 },
      { offset: 6, color: 0xffe14d, alpha: 1 },
      { offset: 40, color: 0xff9a2e, alpha: 1 },
      { offset: 110, color: 0xff4d2e, alpha: 1 },
      { offset: 220, color: 0xb3203a, alpha: 1 },
    ];
    const bottom = view.bottom + 20;
    for (const layer of layers) {
      if (novaY + layer.offset - 30 > bottom) continue;
      const pts = [];
      for (let x = left; x <= right + step; x += step) {
        // Flame tongues: a fast sharp wave on top of the slow swell.
        const tongue = Math.abs(Math.sin(x * 0.03 - t * 4 + layer.offset)) * 16;
        const wobble = Math.sin(x * 0.018 + t * 3 + layer.offset) * 14 + Math.sin(x * 0.047 - t * 5) * 6 - tongue;
        pts.push({ x, y: novaY + layer.offset + wobble });
      }
      pts.push({ x: right + step, y: bottom });
      pts.push({ x: left, y: bottom });
      g.fillStyle(layer.color, layer.alpha);
      g.fillPoints(pts, true);
    }

    // Flickering white-hot highlights along the front edge.
    const flick = Math.floor(t * 10);
    for (let i = 0; i < 7; i++) {
      const fx = left + (((i * 211 + flick * 97) % 1000) / 1000) * (right - left);
      const fy = novaY + 14 + Math.sin(fx * 0.018 + t * 3 + 6) * 14;
      g.fillStyle(0xffffff, 0.75);
      g.fillEllipse(fx, fy, 34, 8);
    }

    ART.drawNovaFace(g, novaY, view, ctx, danger);

    // Embers rising off the front.
    for (let i = 0; i < 16; i++) {
      const ex = left + ((i * 137 + t * 60) % (right - left));
      const life = (t * 0.9 + i * 0.37) % 1;
      g.fillStyle(i % 2 ? 0xffe14d : 0xff9a2e, 1 - life);
      g.fillCircle(ex + Math.sin(t * 3 + i) * 10, novaY - life * 160, 6 * (1 - life) + 2);
    }
  },

  drawNovaFace(g, novaY, view, ctx, danger) {
    const t = ctx.time;
    const cometX = ctx.comet ? ctx.comet.x : (view.left + view.right) / 2;
    // The face slides lazily after the comet, like it is hunting it.
    if (ART._novaX === undefined || Math.abs(ART._novaX - cometX) > 1500) ART._novaX = cometX;
    ART._novaX += (cometX - ART._novaX) * 0.03;
    const fx = Phaser.Math.Clamp(ART._novaX, view.left + 180, view.right - 180);
    const bob = Math.sin(t * 2.4) * 6;
    const er = 26 + danger * 14;
    const gap = 70 + danger * 14;
    const ey = novaY + 34 + bob;
    const look = ctx.comet ? ART.lookAt(fx, ey, ctx.comet.x, ctx.comet.y) : { x: 0, y: -1 };
    const rim = 0x5a0a1a;
    for (const side of [-1, 1]) {
      const x = fx + side * gap;
      g.fillStyle(0xff4d2e, 0.35);
      g.fillCircle(x, ey, er * 1.6);
      g.fillStyle(rim, 1);
      g.fillCircle(x, ey, er + 6);
      g.fillStyle(0xfff6c8, 1);
      g.fillCircle(x, ey, er);
      g.fillStyle(rim, 1);
      g.fillCircle(x + look.x * er * 0.4, ey + look.y * er * 0.4, er * 0.48);
      g.fillStyle(0xffe14d, 1);
      g.fillCircle(x + look.x * er * 0.4, ey + look.y * er * 0.4, er * 0.2);
      // Angry brow slanting down toward the middle.
      g.lineStyle(14, rim, 1);
      g.lineBetween(x - side * er * 1.2, ey - er * 1.0, x + side * er * 1.15, ey - er * 1.55 + danger * 6);
    }
    // Jagged chomping mouth.
    const chomp = 0.5 + 0.5 * Math.sin(t * (5 + danger * 8));
    const mw = 120 + danger * 70;
    const mh = 22 + danger * 34 * chomp + 10;
    const my = ey + er + 34;
    g.fillStyle(rim, 1);
    g.fillEllipse(fx, my + mh * 0.3, mw * 2, mh * 2);
    g.fillStyle(0xfff6c8, 1);
    const teeth = 6;
    for (let i = 0; i < teeth; i++) {
      const x0 = fx - mw * 0.8 + (i * mw * 1.6) / teeth;
      const x1 = x0 + (mw * 1.6) / teeth;
      g.fillTriangle(x0, my - mh * 0.55, x1, my - mh * 0.55, (x0 + x1) / 2, my - mh * 0.55 + 18);
    }
  },

  // ---------- hazards ----------

  drawAsteroid(g, a, ctx) {
    const R = a.radius;
    const t = ctx.time;
    // Dust puffs trailing behind the drift direction.
    if (a.heading !== undefined) {
      const bx = -Math.cos(a.heading);
      const by = -Math.sin(a.heading);
      for (let k = 1; k <= 3; k++) {
        g.fillStyle(0xd9c8f0, 0.32 - k * 0.08);
        g.fillCircle(a.x + bx * (R + k * 16), a.y + by * (R + k * 16) + Math.sin(t * 6 + k) * 3, R * (0.42 - k * 0.08));
      }
    }
    const pts = [];
    const lit = [];
    for (let i = 0; i < a.shape.length; i++) {
      const ang = a.rot + (i / a.shape.length) * Math.PI * 2;
      const k = a.shape[i];
      pts.push({ x: a.x + Math.cos(ang) * R * k, y: a.y + Math.sin(ang) * R * k });
      lit.push({ x: a.x - R * 0.12 + Math.cos(ang) * R * k * 0.7, y: a.y - R * 0.12 + Math.sin(ang) * R * k * 0.7 });
    }
    g.lineStyle(6, ART.outline, 1);
    g.fillStyle(0x7a6290, 1);
    g.fillPoints(pts, true);
    g.strokePoints(pts, true);
    g.fillStyle(0xa78fb8, 1);
    g.fillPoints(lit, true);
    // Craters spin with the rock.
    for (let c = 0; c < 2; c++) {
      const ang = a.rot + c * 2.6 + 0.8;
      const cx = a.x + Math.cos(ang) * R * 0.48;
      const cy = a.y + Math.sin(ang) * R * 0.48;
      g.fillStyle(0x5c4772, 1);
      g.fillCircle(cx, cy, R * (0.2 - c * 0.04));
    }
    g.fillStyle(0xffffff, 0.35);
    g.fillCircle(a.x - R * 0.35, a.y - R * 0.38, R * 0.14);
    // Grumpy upright face glaring at the comet.
    const look = ctx.comet ? ART.lookAt(a.x, a.y, ctx.comet.x, ctx.comet.y) : { x: 0, y: -1 };
    const er = Math.max(4.5, R * 0.17);
    const ex = R * 0.3;
    const ey = a.y - R * 0.05;
    ART.eye(g, a.x - ex, ey, er, look.x, look.y, 0.55);
    ART.eye(g, a.x + ex, ey, er, look.x, look.y, 0.55);
    g.lineStyle(4, ART.outline, 1);
    g.lineBetween(a.x - ex - er, ey - er * 1.4, a.x - ex + er, ey - er * 0.7);
    g.lineBetween(a.x + ex + er, ey - er * 1.4, a.x + ex - er, ey - er * 0.7);
    g.beginPath();
    g.arc(a.x, ey + er * 2.6, er * 0.9, Math.PI * 1.2, Math.PI * 1.8, false);
    g.strokePath();
  },

  drawBlackHole(g, h, ctx) {
    const t = ctx.time;
    const R = TUNING.blackHoleRadius;
    const pullR = TUNING.blackHolePullRadius;
    // Pull zone hint.
    g.fillStyle(0x8a2be2, 0.07);
    g.fillCircle(h.x, h.y, pullR);
    ART.dashedRing(g, h.x, h.y, pullR, 20, -t * 0.6, 3, 0xc77dff, 0.3);
    // Swirling arms.
    for (let i = 0; i < 3; i++) {
      const r = R + 40 + i * 30;
      const a0 = -t * (2.6 - i * 0.5) + i * 2.1;
      g.lineStyle(7 - i * 2, i === 0 ? 0xff6fb5 : 0xc77dff, 0.75 - i * 0.18);
      g.beginPath();
      g.arc(h.x, h.y, r, a0, a0 + Math.PI * 0.9, false);
      g.strokePath();
      g.beginPath();
      g.arc(h.x, h.y, r, a0 + Math.PI, a0 + Math.PI * 1.9, false);
      g.strokePath();
    }
    // Sparkles spiralling in.
    for (let i = 0; i < 10; i++) {
      const life = (t * 0.45 + i * 0.1) % 1;
      const rad = R + (pullR - R) * 0.95 * (1 - life);
      const ang = i * 0.63 - life * 5 - t * 0.2;
      const sx = h.x + Math.cos(ang) * rad;
      const sy = h.y + Math.sin(ang) * rad;
      ART.sparkle(g, sx, sy, 4 + 5 * (1 - life), t * 3 + i, i % 3 ? 0xffffff : 0xffd1f0, 0.3 + 0.7 * life);
    }
    // Accretion disk: back half, core with lensing ring, front half on top.
    const dw = R * 2.3;
    const dh = R * 0.6;
    const tilt = -0.3;
    const back = [];
    const front = [];
    for (const a of ART_HALF_ARC) {
      back.push({ x: Math.cos(a + Math.PI) * dw, y: Math.sin(a + Math.PI) * dh });
      front.push({ x: Math.cos(a) * dw, y: Math.sin(a) * dh });
    }
    g.save();
    g.translateCanvas(h.x, h.y);
    g.rotateCanvas(tilt);
    ART.strokeDisk(g, back);
    g.restore();

    g.fillStyle(0xff6fb5, 0.35);
    g.fillCircle(h.x, h.y, R + 18 + Math.sin(t * 5) * 3);
    g.lineStyle(4, 0xffffff, 0.8);
    g.strokeCircle(h.x, h.y, R + 10);
    g.fillStyle(ART.outline, 1);
    g.fillCircle(h.x, h.y, R + 6);
    g.fillStyle(0x07030f, 1);
    g.fillCircle(h.x, h.y, R);
    // Tiny curious eyes deep in the dark.
    const look = ctx.comet ? ART.lookAt(h.x, h.y, ctx.comet.x, ctx.comet.y) : { x: 0, y: 0 };
    const blink = (t + h.x * 0.01) % 4 < 0.15;
    for (const side of [-1, 1]) {
      const x = h.x + side * 10 + look.x * 6;
      const y = h.y - 2 + look.y * 6;
      g.fillStyle(0xffffff, 0.9);
      if (blink) g.fillRect(x - 5, y - 1, 10, 3);
      else g.fillEllipse(x, y, 8, 11);
    }

    g.save();
    g.translateCanvas(h.x, h.y);
    g.rotateCanvas(tilt);
    ART.strokeDisk(g, front);
    // Bright clumps riding the disk (only the ones on the front half are drawn on top).
    for (let i = 0; i < 4; i++) {
      const a = (t * 1.8 + i * (Math.PI / 2)) % (Math.PI * 2);
      if (a > Math.PI) continue;
      g.fillStyle(0xffffff, 0.9);
      g.fillCircle(Math.cos(a) * dw, Math.sin(a) * dh, 5);
    }
    g.restore();
  },

  strokeDisk(g, pts) {
    // Hot magenta plasma, deliberately unlike the cream planet rings so the two never get confused.
    g.lineStyle(26, 0xc77dff, 0.3);
    g.strokePoints(pts, false);
    g.lineStyle(16, ART.outline, 1);
    g.strokePoints(pts, false);
    g.lineStyle(10, 0xff4fd8, 1);
    g.strokePoints(pts, false);
    g.lineStyle(4, 0xffd1f0, 1);
    g.strokePoints(pts, false);
  },

  // ---------- aim guide ----------

  // Small direction arrow just ahead of the comet: three chevrons sliding along unit direction
  // (dx, dy), showing where a release goes without drawing a line across the screen.
  // kind: 'none' = no target (white), 'target' = will reach a planet (green), 'perfect' = gold.
  // length is unused now (kept for the caller's signature).
  drawAimGuide(g, x, y, dx, dy, length, kind, ctx) {
    const t = ctx.time;
    const color = kind === 'perfect' ? ART.gold : kind === 'target' ? ART.green : 0xffffff;
    const nx = -dy;
    const ny = dx;
    const start = TUNING.cometRadius + 22;
    const slide = (t * (kind === 'none' ? 1.5 : 3)) % 1;   // chevrons march outward
    const size = kind === 'none' ? 11 : 15;
    for (let i = 0; i < 3; i++) {
      const f = (i + slide) / 3;
      const d = start + f * 66;
      const cx = x + dx * d;
      const cy = y + dy * d;
      const fade = Math.sin(f * Math.PI);                  // fade in near the comet, out at the tip
      const s = size * (0.85 + 0.3 * f);
      const pts = [
        { x: cx - dx * s + nx * s, y: cy - dy * s + ny * s },
        { x: cx, y: cy },
        { x: cx - dx * s - nx * s, y: cy - dy * s - ny * s },
      ];
      g.lineStyle(13, ART.outline, 0.7 * fade);
      g.strokePoints(pts, false);
      let c = color;
      if (kind === 'perfect') c = lerpColor(ART.gold, 0xffffff, 0.5 + 0.5 * Math.sin(t * 20 - i));
      g.lineStyle(7, c, (kind === 'none' ? 0.6 : 1) * fade);
      g.strokePoints(pts, false);
    }
    if (kind === 'perfect') {
      ART.sparkle(g, x + dx * (start + 80), y + dy * (start + 80), 14, t * 4, 0xffffff, 0.9);
    }
  },

  // ---------- comet ----------

  // trail: recent positions, newest first.
  drawComet(g, comet, trail, ctx) {
    const t = ctx.time;
    const sf = ctx.speedFraction || 0;
    const color = speedColor(sf);
    const hot = lerpColor(color, 0xffffff, 0.6);
    const outer = lerpColor(color, 0xff4d2e, 0.5);
    const r = TUNING.cometRadius;
    const dir = ART.cometDir(comet, trail);
    const n = trail.length;
    // Afterburner swaps the tail (not the head) to an electric blue/white burn.
    const burn = Math.max(0, Math.min(1, ctx.afterburner || 0));
    const tailColor = burn > 0 ? lerpColor(color, 0x4da6ff, burn) : color;
    const tailOuter = burn > 0 ? lerpColor(outer, 0x2b5cff, burn) : outer;
    const tailHot = burn > 0 ? lerpColor(hot, 0xffffff, burn) : hot;

    // Flame trail: wide soft glow, colored body, white-hot core line.
    for (let i = n - 1; i >= 1; i--) {
      const f = 1 - i / n;
      g.fillStyle(tailOuter, (0.3 + 0.15 * burn) * f);
      g.fillCircle(trail[i].x, trail[i].y, r * (1.25 + 0.35 * burn) * f + 3);
    }
    for (let i = n - 1; i >= 1; i--) {
      const f = 1 - i / n;
      g.fillStyle(tailColor, 0.9 * f);
      g.fillCircle(trail[i].x, trail[i].y, r * 0.85 * f + 2);
    }
    for (let i = n - 1; i >= 1; i--) {
      const f = 1 - i / n;
      g.lineStyle(r * (0.7 + 0.2 * burn) * f + 1, tailHot, f);
      g.lineBetween(trail[i].x, trail[i].y, trail[i - 1].x, trail[i - 1].y);
    }
    // Afterburner: blue diamond sparks shed along the burn.
    if (burn > 0 && n > 4) {
      for (let k = 0; k < 6; k++) {
        const i = Math.min(n - 1, 1 + ((k * 3 + Math.floor(t * 24)) % (n - 1)));
        const f = 1 - i / n;
        const side = Math.sin(t * 17 + k * 1.7) * r * 1.1;
        ART.sparkle(g, trail[i].x - dir.y * side, trail[i].y + dir.x * side, (6 + 6 * f) * burn, t * 6 + k,
          k % 2 ? 0xffffff : 0x9fd8ff, burn * (0.4 + 0.6 * f));
      }
    }
    // Sparks flicking off the sides of the trail.
    if (n > 4) {
      for (let k = 0; k < 7; k++) {
        const i = Math.min(n - 1, 2 + ((k * 5 + Math.floor(t * 18)) % (n - 2)));
        const f = 1 - i / n;
        const side = Math.sin(t * 13 + k * 2.1) * r * (1.4 - f * 0.6);
        const sx = trail[i].x - dir.y * side;
        const sy = trail[i].y + dir.x * side;
        g.fillStyle(k % 2 ? 0xffffff : ART.gold, 0.9 * f + 0.1);
        g.fillCircle(sx, sy, 2 + 3 * f);
      }
    }

    // PERFECT / zone shock bursts sit behind the head so the face stays readable.
    const zonePulse = Math.max(0, Math.min(1, ctx.zonePulse || 0));
    if (zonePulse > 0) ART.drawShockBurst(g, comet.x, comet.y, zonePulse, 0x5ee6ff, 1.6, t);
    const perfectPulse = Math.max(0, Math.min(1, ctx.perfectPulse || 0));
    if (perfectPulse > 0) ART.drawShockBurst(g, comet.x, comet.y, perfectPulse, ART.gold, 1, t);

    // Head, stretched along the velocity (squash & stretch keeps the area roughly equal).
    const stretch = Math.max(1, Math.min(2.2, ctx.stretch || 1));
    // Impact squash (1 right after a grab/hit, decays to 0): shorter along travel, wider across it.
    const squash = Math.max(0, Math.min(1, ctx.squash || 0));
    const alongScale = stretch * (1 - 0.32 * squash);
    const acrossScale = (1 / Math.sqrt(stretch)) * (1 + 0.38 * squash);
    const angle = Math.atan2(dir.y, dir.x);
    const flick = Math.sin(t * 30) * 4;
    g.save();
    g.translateCanvas(comet.x, comet.y);
    g.rotateCanvas(angle);
    g.scaleCanvas(alongScale, acrossScale);
    g.fillStyle(tailOuter, 0.28);
    g.fillCircle(0, 0, r * 1.55);
    // Flame crown licking backward (longer while the afterburner burns).
    const crown = 1 + 0.45 * burn;
    g.fillStyle(tailOuter, 1);
    g.fillTriangle(r * 0.1, -r * 1.05, r * 0.1, r * 1.05, (-r * 2.3 - flick) * crown, 0);
    g.fillTriangle(0, -r * 0.95, -r * 0.6, -r * 0.2, -r * 1.6 * crown, -r * 1.25 + flick * 0.5);
    g.fillTriangle(0, r * 0.95, -r * 0.6, r * 0.2, -r * 1.6 * crown, r * 1.25 - flick * 0.5);
    g.fillStyle(tailColor, 1);
    g.fillTriangle(r * 0.1, -r * 0.7, r * 0.1, r * 0.7, (-r * 1.7 + flick) * crown, 0);
    if (burn > 0) {
      g.fillStyle(0xffffff, burn);
      g.fillTriangle(r * 0.1, -r * 0.38, r * 0.1, r * 0.38, (-r * 1.2 + flick) * crown, 0);
    }
    g.fillStyle(ART.outline, 1);
    g.fillCircle(0, 0, r + 5);
    g.fillStyle(color, 1);
    g.fillCircle(0, 0, r);
    g.fillStyle(hot, 1);
    g.fillCircle(r * 0.12, 0, r * 0.7);
    g.restore();
    g.fillStyle(0xffffff, 0.85);
    g.fillCircle(comet.x - r * 0.42, comet.y - r * 0.45, r * 0.18);

    ART.drawCometFace(g, comet.x + dir.x * r * 0.2, comet.y + dir.y * r * 0.2, r, dir, ctx);
    if (ctx.shieldReady) ART.drawShieldBubble(g, comet.x, comet.y, r, t);
  },

  // Heat Shield charge ready: a pink soap-bubble around the comet with a rim, a glint and
  // little hex plates drifting round it. Thin and see-through so the face stays readable.
  drawShieldBubble(g, x, y, r, t) {
    const pink = 0xff6fb5;
    const R = r * 2.05 + Math.sin(t * 4) * 2;
    g.fillStyle(pink, 0.2);
    g.fillCircle(x, y, R);
    g.lineStyle(11, ART.outline, 0.5);
    g.strokeCircle(x, y, R);
    g.lineStyle(6, pink, 1);
    g.strokeCircle(x, y, R);
    g.lineStyle(2, 0xffffff, 0.6);
    g.strokeCircle(x, y, R - 6);
    // Curved glint on the upper left.
    g.lineStyle(5, 0xffffff, 0.85);
    g.beginPath();
    g.arc(x, y, R - 10, Math.PI * 1.08, Math.PI * 1.38, false);
    g.strokePath();
    // Three small hexagonal plates orbiting the rim.
    for (let i = 0; i < 3; i++) {
      const a = t * 1.3 + (i * Math.PI * 2) / 3;
      const px = x + Math.cos(a) * R;
      const py = y + Math.sin(a) * R;
      const hex = [];
      for (let k = 0; k < 6; k++) {
        const ha = (k * Math.PI) / 3 + a;
        hex.push({ x: px + Math.cos(ha) * 8, y: py + Math.sin(ha) * 8 });
      }
      g.fillStyle(0xffd1f0, 1);
      g.fillPoints(hex, true);
      g.lineStyle(3, ART.outline, 1);
      g.strokePoints(hex, true);
    }
  },

  // Expanding shock ring + rays around (x, y). p: 1 at the moment of the event, fading to 0.
  // scale widens the burst (zones use a bigger one than PERFECT).
  drawShockBurst(g, x, y, p, color, scale, t) {
    const r = TUNING.cometRadius;
    const k = 1 - p;                                  // 0 -> 1 as the burst expands
    const ease = 1 - (1 - k) * (1 - k);               // fast start, soft end
    const ringR = r * 1.6 + ease * 150 * scale;
    // Brief hot core right at the start (small, so it never reads as a screen flash).
    if (p > 0.7) {
      g.fillStyle(0xffffff, (p - 0.7) * 2.2);
      g.fillCircle(x, y, r * (1.8 + (1 - p) * 3));
    }
    // Outer ring: dark outline under a bright band, so it reads on any background.
    g.lineStyle(6 + 12 * p, ART.outline, 0.45 * p);
    g.strokeCircle(x, y, ringR);
    g.lineStyle(3 + 9 * p, color, Math.min(1, p * 1.4));
    g.strokeCircle(x, y, ringR);
    // Trailing inner ring.
    const innerR = r * 1.3 + ease * 90 * scale;
    g.lineStyle(2 + 4 * p, 0xffffff, 0.8 * p);
    g.strokeCircle(x, y, innerR);
    // Rays shooting out between the rings.
    const rays = 10;
    const spin = (t || 0) * 0.6;
    for (let i = 0; i < rays; i++) {
      const a = spin + (i / rays) * Math.PI * 2 + (i % 2) * 0.12;
      const len = (i % 2 ? 22 : 34) * scale * p + 6;
      const from = innerR + 6;
      const cx = Math.cos(a);
      const cy = Math.sin(a);
      g.lineStyle(5 * p + 2, i % 2 ? 0xffffff : color, p);
      g.lineBetween(x + cx * from, y + cy * from, x + cx * (from + len), y + cy * (from + len));
    }
    // A few sparkles riding the outer ring.
    for (let i = 0; i < 4; i++) {
      const a = -spin * 1.5 + i * (Math.PI / 2) + 0.4;
      ART.sparkle(g, x + Math.cos(a) * ringR, y + Math.sin(a) * ringR, 8 + 10 * p, spin * 3 + i, 0xffffff, p);
    }
  },

  // Expression priority: close call > worried > happy (perfect chain) > determined > calm.
  drawCometFace(g, x, y, r, dir, ctx) {
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
    let er = r * 0.3;
    let mood = 'calm';
    if (closeCall > 0.3) mood = 'phew';
    else if (danger > 0.6) mood = 'worried';
    else if (happy) mood = 'happy';
    else if (sf > 0.4) mood = 'determined';
    if (mood === 'worried' || mood === 'phew') er = r * 0.34;

    if (mood === 'happy') {
      g.fillStyle(ART.blush, 0.6);
      g.fillEllipse(x - ex - er * 0.6, ey + er * 1.4, er * 1.3, er * 0.7);
      g.fillEllipse(x + ex + er * 0.6, ey + er * 1.4, er * 1.3, er * 0.7);
      ART.closedEye(g, x - ex, ey, er * 0.85, true, 4.5);
      ART.closedEye(g, x + ex, ey, er * 0.85, true, 4.5);
      ART.smile(g, x, ey + er * 1.5, er * 0.9, true);
      return;
    }
    if (blink) {
      g.lineStyle(4.5, ART.outline, 1);
      g.lineBetween(x - ex - er * 0.8, ey, x - ex + er * 0.8, ey);
      g.lineBetween(x + ex - er * 0.8, ey, x + ex + er * 0.8, ey);
    } else {
      ART.eye(g, x - ex, ey, er, lx, ly, mood === 'phew' ? 0.35 : 0.55);
      ART.eye(g, x + ex, ey, er, lx, ly, mood === 'phew' ? 0.35 : 0.55);
    }
    g.lineStyle(4.5, ART.outline, 1);
    if (mood === 'determined') {
      // Brows slanting down toward the middle.
      g.lineBetween(x - ex - er, ey - er * 1.25, x - ex + er * 0.9, ey - er * 0.75);
      g.lineBetween(x + ex + er, ey - er * 1.25, x + ex - er * 0.9, ey - er * 0.75);
      g.lineBetween(x - er * 0.55, ey + er * 1.7, x + er * 0.65, ey + er * 1.55);
    } else if (mood === 'worried' || mood === 'phew') {
      // Brows tilted up in the middle + wobbly mouth + sweat drop.
      g.lineBetween(x - ex - er, ey - er * 1.1, x - ex + er * 0.8, ey - er * 1.6);
      g.lineBetween(x + ex + er, ey - er * 1.1, x + ex - er * 0.8, ey - er * 1.6);
      if (mood === 'phew') {
        g.fillStyle(ART.outline, 1);
        g.fillCircle(x, ey + er * 1.8, er * 0.45);
      } else {
        const my = ey + er * 1.8;
        const wv = Math.sin(t * 20) * 1.5;
        g.beginPath();
        g.moveTo(x - er * 0.8, my + wv);
        g.lineTo(x - er * 0.3, my - 3 - wv);
        g.lineTo(x + er * 0.2, my + 3 + wv);
        g.lineTo(x + er * 0.8, my - wv);
        g.strokePath();
      }
      const dropX = x + r * 0.95;
      const dropY = y - r * 0.6 + ((t * 1.5) % 1) * 10;
      g.fillStyle(ART.outline, 1);
      g.fillCircle(dropX, dropY, 7.5);
      g.fillTriangle(dropX - 6.5, dropY - 3, dropX + 6.5, dropY - 3, dropX, dropY - 15);
      g.fillStyle(0x9ff3ff, 1);
      g.fillCircle(dropX, dropY, 5);
      g.fillTriangle(dropX - 4.5, dropY - 2, dropX + 4.5, dropY - 2, dropX, dropY - 11);
    } else {
      ART.smile(g, x, ey + er * 1.6, er * 0.7, false, 4);
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

  // Generates the tiling star texture used for the parallax background. Also generates
  // optional extra layers 'stars_sparkle' (sparse big twinkly stars)
  // and 'stars_nebula' (soft clouds + tiny distant planets, use as the slowest layer) that scenes may add as more tileSprites.
  makeStarTexture(scene, key) {
    const size = 512;
    // Draws fn at the 9 wrapped positions so the tile repeats without seams.
    const wrapped = (g, x, y, fn) => {
      for (const ox of [-size, 0, size]) for (const oy of [-size, 0, size]) fn(x + ox, y + oy);
    };
    const tints = [0xffffff, 0xffffff, 0xffffff, 0xbfe6ff, 0xffd1f0, 0xfff1c1];
    const g = scene.make.graphics({ x: 0, y: 0, add: false });
    // Faint nebula wisps.
    for (let i = 0; i < 3; i++) {
      const nx = Phaser.Math.Between(0, size);
      const ny = Phaser.Math.Between(0, size);
      const nc = [0xc77dff, 0x5ee6ff, 0xff6fb5][i];
      wrapped(g, nx, ny, (x, y) => {
        for (let k = 0; k < 4; k++) {
          g.fillStyle(nc, 0.035);
          g.fillCircle(x + k * 22 - 30, y + Math.sin(k) * 20, 70 - k * 8);
        }
      });
    }
    for (let i = 0; i < 110; i++) {
      const sx = Phaser.Math.Between(0, size);
      const sy = Phaser.Math.Between(0, size);
      const alpha = Phaser.Math.FloatBetween(0.35, 0.95);
      const r = Phaser.Math.FloatBetween(1, 2.8);
      const c = Phaser.Utils.Array.GetRandom(tints);
      wrapped(g, sx, sy, (x, y) => {
        g.fillStyle(c, alpha);
        g.fillCircle(x, y, r);
      });
    }
    for (let i = 0; i < 4; i++) {
      const sx = Phaser.Math.Between(0, size);
      const sy = Phaser.Math.Between(0, size);
      const r = Phaser.Math.FloatBetween(6, 10);
      wrapped(g, sx, sy, (x, y) => {
        g.fillStyle(0xffffff, 0.18);
        g.fillCircle(x, y, r * 0.8);
        ART.sparkle(g, x, y, r, 0, 0xffffff, 0.9);
      });
    }
    g.generateTexture(key, size, size);
    g.clear();

    if (!scene.textures.exists('stars_sparkle')) {
      for (let i = 0; i < 4; i++) {
        const sx = Phaser.Math.Between(0, size);
        const sy = Phaser.Math.Between(0, size);
        const r = Phaser.Math.FloatBetween(10, 16);
        const c = Phaser.Utils.Array.GetRandom(tints);
        wrapped(g, sx, sy, (x, y) => {
          g.fillStyle(c, 0.2);
          g.fillCircle(x, y, r * 0.9);
          ART.sparkle(g, x, y, r, Math.PI / 4 * (i % 2), c, 1);
        });
      }
      g.generateTexture('stars_sparkle', size, size);
      g.clear();
    }
    if (!scene.textures.exists('stars_nebula')) {
      const colors = [0xc77dff, 0x5ee6ff, 0xff6fb5, 0x6fa8ff];
      for (let i = 0; i < 5; i++) {
        const nx = Phaser.Math.Between(0, size);
        const ny = Phaser.Math.Between(0, size);
        const nc = colors[i % colors.length];
        wrapped(g, nx, ny, (x, y) => {
          for (let k = 0; k < 6; k++) {
            g.fillStyle(nc, 0.04);
            g.fillCircle(x + Math.cos(k * 1.7) * 50, y + Math.sin(k * 2.3) * 36, 90 - k * 9);
          }
        });
      }
      // A tiny distant planet (silhouette + rim + ring) for depth.
      const far = [{ x: 120, y: 160, r: 20, c: 0x6a4fb8, ring: true }];
      for (const p of far) {
        wrapped(g, p.x, p.y, (x, y) => {
          g.fillStyle(p.c, 0.4);
          g.fillCircle(x, y, p.r);
          g.fillStyle(0xffffff, 0.18);
          g.fillCircle(x - p.r * 0.3, y - p.r * 0.3, p.r * 0.5);
          if (p.ring) {
            g.lineStyle(3, 0xd9c8f0, 0.45);
            g.strokeEllipse(x, y, p.r * 3, p.r * 0.8);
          }
        });
      }
      g.generateTexture('stars_nebula', size, size);
    }
    g.destroy();
  },
};
