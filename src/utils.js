// Küçük yardımcılar: buton, yüksek skor, tam ekran, ses aç/kapa, and the sketchbook UI toolkit.
//
// Sketchbook toolkit (UI only; the world art lives in art.js):
// - Static doodles are drawn ONCE into UI_BOIL_VARIANTS canvas textures (key_0..key_2) that share
//   the same base shape and differ only in small pen jitter. uiBoilImage cycles them every
//   UI_BOIL_MS, which reads as hand-drawn "line boil" without redrawing anything per frame.
// - Text gets a tiny rotation jitter on the same clock (rotation does not re-render the text).
// - Only truly dynamic marks (an underline that grows with speed, burst doodles) use Graphics.

const UI_BOIL_MS = 100;        // ~10 re-wobbles per second; every frame would look like noise
const UI_BOIL_VARIANTS = 3;
const UI_TAU = Math.PI * 2;

function uiRng(seed) {
  let s = (seed >>> 0) || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function uiHash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// Deterministic 0..1 noise for per-frame Graphics doodles (same seed = same wobble).
function uiNoise(seed, i) {
  const x = Math.sin(seed * 12.9898 + i * 78.233) * 43758.5453;
  return x - Math.floor(x);
}

function uiCss(color, alpha) {
  const r = (color >> 16) & 255;
  const g = (color >> 8) & 255;
  const b = color & 255;
  return 'rgba(' + r + ',' + g + ',' + b + ',' + (alpha === undefined ? 1 : alpha) + ')';
}

// ---- shapes (point lists). shape: rng shared by every boil variant; jitter: per variant. ----

// Lopsided closed loop: low-frequency bulges from `shape` make it never a perfect circle.
function uiLoop(cx, cy, rx, ry, shape, jitter, opts) {
  opts = opts || {};
  const n = opts.n || 22;
  const lop = opts.lop === undefined ? 0.06 : opts.lop;
  const amp = opts.amp === undefined ? 1.4 : opts.amp;
  const p1 = shape() * UI_TAU;
  const p2 = shape() * UI_TAU;
  const a1 = lop * (0.6 + shape() * 0.8);
  const a2 = lop * 0.6 * shape();
  const rot = shape() * UI_TAU;
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = rot + (i / n) * UI_TAU;
    const k = 1 + a1 * Math.sin(a * 2 + p1) + a2 * Math.sin(a * 3 + p2);
    pts.push({
      x: cx + Math.cos(a) * rx * k + (jitter() - 0.5) * 2 * amp,
      y: cy + Math.sin(a) * ry * k + (jitter() - 0.5) * 2 * amp,
    });
  }
  return pts;
}

// Hand-drawn rectangle: corners a bit off, edges slightly bowed.
function uiWobblyRect(x, y, w, h, shape, jitter, amp) {
  amp = amp === undefined ? 1.6 : amp;
  const c = [
    { x: x + (shape() - 0.5) * 8, y: y + (shape() - 0.5) * 8 },
    { x: x + w + (shape() - 0.5) * 8, y: y + (shape() - 0.5) * 8 },
    { x: x + w + (shape() - 0.5) * 8, y: y + h + (shape() - 0.5) * 8 },
    { x: x + (shape() - 0.5) * 8, y: y + h + (shape() - 0.5) * 8 },
  ];
  const pts = [];
  for (let e = 0; e < 4; e++) {
    const a = c[e];
    const b = c[(e + 1) % 4];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const steps = Math.max(3, Math.round(len / 60));
    const bow = (shape() - 0.5) * Math.min(10, len * 0.03);
    const nx = -(b.y - a.y) / len;
    const ny = (b.x - a.x) / len;
    for (let i = 0; i < steps; i++) {
      const t = i / steps;
      const s = Math.sin(t * Math.PI) * bow;
      pts.push({
        x: a.x + (b.x - a.x) * t + nx * s + (jitter() - 0.5) * 2 * amp,
        y: a.y + (b.y - a.y) * t + ny * s + (jitter() - 0.5) * 2 * amp,
      });
    }
  }
  return pts;
}

// ---- canvas drawing ----

function uiTracePath(ctx, pts, closed) {
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  if (closed) ctx.closePath();
}

// Gel-pen stroke: smooth curve, line weight swelling and thinning along the path, the end
// overshooting the start on closed shapes, plus a lighter partial re-trace.
function uiStroke(ctx, pts, jitter, o) {
  o = o || {};
  const width = o.width || 4;
  const color = o.color === undefined ? UI_INK.cream : o.color;
  const alpha = o.alpha === undefined ? 1 : o.alpha;
  const list = o.closed ? pts.concat(pts.slice(0, (o.overshoot === undefined ? 2 : o.overshoot) + 1)) : pts.slice();
  const phase = jitter() * UI_TAU;
  const pass = (points, w, a) => {
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = uiCss(color, a);
    for (let i = 0; i < points.length - 1; i++) {
      const p0 = i === 0 ? points[0] : { x: (points[i - 1].x + points[i].x) / 2, y: (points[i - 1].y + points[i].y) / 2 };
      const p2 = { x: (points[i].x + points[i + 1].x) / 2, y: (points[i].y + points[i + 1].y) / 2 };
      const end = i === points.length - 2 ? points[i + 1] : p2;
      ctx.lineWidth = Math.max(0.8, w * (0.78 + 0.4 * Math.sin(i * 0.8 + phase) + (jitter() - 0.5) * 0.15));
      ctx.beginPath();
      ctx.moveTo(p0.x, p0.y);
      ctx.quadraticCurveTo(points[i].x, points[i].y, end.x, end.y);
      ctx.stroke();
    }
  };
  pass(list, width, alpha);
  if (o.retrace !== false && list.length > 4) {
    const from = Math.floor(jitter() * list.length * 0.4);
    const to = Math.min(list.length, from + Math.floor(list.length * (0.45 + jitter() * 0.35)));
    const re = list.slice(from, to).map((p) => ({ x: p.x + (jitter() - 0.5) * 3, y: p.y + (jitter() - 0.5) * 3 }));
    if (re.length > 2) pass(re, width * 0.55, alpha * 0.6);
  }
}

// Crayon hatching inside pts: diagonal strokes, offset (misregistered) from the outline and a
// little bigger on one side, with skipped strokes for paper gaps.
function uiHatch(ctx, pts, jitter, o) {
  o = o || {};
  const spacing = o.spacing || 6;
  const angle = o.angle === undefined ? -0.9 : o.angle;
  const width = o.width || 4;
  const alpha = o.alpha === undefined ? 0.9 : o.alpha;
  const gaps = o.gaps === undefined ? 0.08 : o.gaps;
  const grow = o.grow || 1.03;
  let cx = 0;
  let cy = 0;
  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
  for (const p of pts) {
    cx += p.x / pts.length; cy += p.y / pts.length;
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
  }
  const ox = o.offX === undefined ? 3 : o.offX;
  const oy = o.offY === undefined ? -2 : o.offY;
  ctx.save();
  uiTracePath(ctx, pts.map((p) => ({ x: cx + (p.x - cx) * grow + ox, y: cy + (p.y - cy) * grow + oy })), true);
  ctx.clip();
  const R = Math.hypot(maxX - minX, maxY - minY) / 2 + 10;
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  ctx.lineCap = 'round';
  for (let c = -R; c < R; c += spacing * (0.75 + jitter() * 0.5)) {
    if (jitter() < gaps) continue;
    const bx = cx + -dy * c + ox;
    const by = cy + dx * c + oy;
    const bend = (jitter() - 0.5) * 6;
    ctx.globalAlpha = alpha * (0.6 + jitter() * 0.4);
    ctx.lineWidth = width * (0.7 + jitter() * 0.6);
    ctx.strokeStyle = uiCss(o.color === undefined ? 0xffffff : o.color);
    ctx.beginPath();
    ctx.moveTo(bx - dx * R, by - dy * R);
    ctx.quadraticCurveTo(bx + -dy * bend, by + dx * bend, bx + dx * R, by + dy * R);
    ctx.stroke();
  }
  ctx.restore();
  ctx.globalAlpha = 1;
}

// Paper tooth: punches tiny holes so crayon looks waxy, not flat.
function uiGrain(ctx, w, h, jitter, amount) {
  ctx.save();
  ctx.globalCompositeOperation = 'destination-out';
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  const count = Math.floor(w * h * (amount || 0.012));
  for (let i = 0; i < count; i++) ctx.fillRect(jitter() * w, jitter() * h, 1 + jitter() * 1.6, 1 + jitter() * 1.2);
  ctx.restore();
}

// ---- texture factory + boil clock ----

// draw(ctx, shapeRng, jitterRng, variant, w, h) runs once per variant. Returns the base key.
function uiSketchTexture(scene, key, w, h, draw) {
  for (let v = 0; v < UI_BOIL_VARIANTS; v++) {
    const k = key + '_' + v;
    if (scene.textures.exists(k)) continue;
    const tex = scene.textures.createCanvas(k, Math.ceil(w), Math.ceil(h));
    draw(tex.getContext(), uiRng(uiHash(key)), uiRng(uiHash(key) + (v + 1) * 7919), v, w, h);
    tex.refresh();
  }
  return key;
}

// fn(variant, tick) runs whenever the boil clock ticks (every UI_BOIL_MS of scene time).
function uiOnBoil(scene, fn) {
  let boil = scene.uiBoil;
  if (!boil) {
    boil = scene.uiBoil = { list: [], last: -1 };
    const tick = () => {
      const f = Math.floor(scene.time.now / UI_BOIL_MS);
      if (f === boil.last) return;
      boil.last = f;
      for (const cb of boil.list) cb(f % UI_BOIL_VARIANTS, f);
    };
    scene.events.on('update', tick);
    scene.events.once('shutdown', () => {
      scene.events.off('update', tick);
      scene.uiBoil = null;
    });
  }
  boil.list.push(fn);
}

function uiBoilImage(scene, x, y, key) {
  const img = scene.add.image(x, y, key + '_0');
  // Each image starts at a different variant so neighbours do not wobble in lockstep.
  const offset = Math.floor(Math.random() * UI_BOIL_VARIANTS);
  uiOnBoil(scene, (v) => { if (img.active) img.setTexture(key + '_' + ((v + offset) % UI_BOIL_VARIANTS)); });
  return img;
}

// Rotation-only jitter around obj.inkRot, so position/scale tweens on the object stay untouched.
function uiBoilRotation(scene, obj, amount) {
  if (obj.inkRot === undefined) obj.inkRot = obj.rotation;
  const steps = [0, amount, -amount * 0.7];
  const offset = Math.floor(Math.random() * 3);
  uiOnBoil(scene, (v) => { if (obj.active) obj.rotation = obj.inkRot + steps[(v + offset) % 3]; });
}

// Hand-lettered ink text: Lilita One, ink outline, slight random tilt, rotation boil.
// o: size, color, stroke (null = none), strokeW, rot, ox, oy, align, boil (false = still), lineSpacing
function uiInkText(scene, x, y, str, o) {
  o = o || {};
  const size = o.size || 40;
  const stroke = o.stroke === undefined ? UI_INK.darkHex : o.stroke;
  const t = scene.add.text(x, y, str, {
    fontFamily: FONT,
    fontSize: size + 'px',
    color: o.color || UI_INK.creamHex,
    stroke: stroke || '#000000',
    strokeThickness: stroke ? (o.strokeW !== undefined ? o.strokeW : Math.max(4, Math.round(size / 7))) : 0,
    align: o.align || 'center',
    lineSpacing: o.lineSpacing || 0,
  }).setOrigin(o.ox === undefined ? 0.5 : o.ox, o.oy === undefined ? 0.5 : o.oy);
  t.inkRot = o.rot !== undefined ? o.rot : (Math.random() - 0.5) * 0.07;
  t.setRotation(t.inkRot);
  if (o.boil !== false) uiBoilRotation(scene, t, o.boilAmount || 0.01);
  return t;
}

// Big lettering with a crayon copy printed slightly off-register behind it.
function uiTitleText(scene, x, y, str, o) {
  o = o || {};
  const size = o.size || 80;
  const shadow = scene.add.text(o.shadowDx === undefined ? 6 : o.shadowDx, o.shadowDy === undefined ? 7 : o.shadowDy, str, {
    fontFamily: FONT, fontSize: size + 'px', color: o.shadowColor || uiColorHex(UI_CRAYON.orange), align: 'center',
  }).setOrigin(0.5);
  const main = scene.add.text(0, 0, str, {
    fontFamily: FONT, fontSize: size + 'px', color: o.color || UI_INK.creamHex,
    stroke: UI_INK.darkHex, strokeThickness: Math.round(size / 9), align: 'center',
  }).setOrigin(0.5);
  const box = scene.add.container(x, y, [shadow, main]);
  box.main = main;
  box.shadow = shadow;
  box.inkRot = o.rot !== undefined ? o.rot : (Math.random() - 0.5) * 0.08;
  box.setRotation(box.inkRot);
  if (o.boil !== false) uiBoilRotation(scene, box, 0.008);
  return box;
}

// Wobbly pen line for per-frame Graphics doodles. Same seed = same wobble, so callers change
// the seed on the boil clock, not every frame.
function uiScribbleLine(g, x1, y1, x2, y2, seed, o) {
  o = o || {};
  const len = Math.hypot(x2 - x1, y2 - y1);
  if (len < 2) return;
  const n = Math.max(3, Math.round(len / 22));
  const amp = o.amp === undefined ? 2.2 : o.amp;
  const nx = -(y2 - y1) / len;
  const ny = (x2 - x1) / len;
  const passes = o.passes || 2;
  for (let p = 0; p < passes; p++) {
    g.lineStyle((o.width || 5) * (p ? 0.6 : 1), o.color === undefined ? UI_INK.cream : o.color, (o.alpha === undefined ? 1 : o.alpha) * (p ? 0.6 : 1));
    g.beginPath();
    const start = p ? 0.08 : 0;
    const end = p ? 0.85 : 1;
    for (let i = 0; i <= n; i++) {
      const t = start + (end - start) * (i / n);
      const off = (uiNoise(seed + p * 31, i) - 0.5) * 2 * amp + (p ? 3 : 0);
      const x = x1 + (x2 - x1) * t + nx * off;
      const y = y1 + (y2 - y1) * t + ny * off;
      if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
    }
    g.strokePath();
  }
}

// ---- shared doodle textures ----

// Construction-paper tile (256px, tiles seamlessly): color noise, darker specks, fibers.
function uiPaperTexture(scene, key, color) {
  if (scene.textures.exists(key)) return key;
  const S = 256;
  const tex = scene.textures.createCanvas(key, S, S);
  const ctx = tex.getContext();
  const rng = uiRng(uiHash(key));
  ctx.fillStyle = uiCss(color);
  ctx.fillRect(0, 0, S, S);
  const light = ((color >> 16) & 255) + ((color >> 8) & 255) + (color & 255) > 450;
  const img = ctx.getImageData(0, 0, S, S);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (rng() - 0.5) * (light ? 16 : 12) + (rng() < 0.02 ? (light ? -22 : 14) : 0);
    d[i] += n; d[i + 1] += n; d[i + 2] += n * 0.9;
  }
  ctx.putImageData(img, 0, 0);
  // Fibers, drawn at the 9 wrap offsets so the tile has no seams.
  for (let f = 0; f < 90; f++) {
    const x = rng() * S;
    const y = rng() * S;
    const a = rng() * UI_TAU;
    const len = 8 + rng() * 34;
    const bend = (rng() - 0.5) * 14;
    const bright = rng() < 0.65;
    ctx.strokeStyle = bright ? (light ? 'rgba(255,255,245,0.35)' : 'rgba(255,245,225,0.09)') : (light ? 'rgba(120,90,40,0.16)' : 'rgba(0,0,10,0.22)');
    ctx.lineWidth = 0.6 + rng() * 0.9;
    for (let ox = -S; ox <= S; ox += S) {
      for (let oy = -S; oy <= S; oy += S) {
        ctx.beginPath();
        ctx.moveTo(x + ox, y + oy);
        ctx.quadraticCurveTo(x + ox + Math.cos(a) * len / 2 - Math.sin(a) * bend, y + oy + Math.sin(a) * len / 2 + Math.cos(a) * bend,
          x + ox + Math.cos(a) * len, y + oy + Math.sin(a) * len);
        ctx.stroke();
      }
    }
  }
  tex.refresh();
  return key;
}

// Full-screen paper page for menu-style scenes: camera color + grain tile + soft edge darkening
// drawn as crayon hatching (no gradients).
function uiAddPaper(scene, zoneIndex) {
  const set = UI_PAPERS[zoneIndex || 0];
  scene.cameras.main.setBackgroundColor(set.paper);
  const key = uiPaperTexture(scene, 'ui_paper_' + (zoneIndex || 0), set.paper);
  return scene.add.tileSprite(0, 0, GAME_WIDTH, GAME_HEIGHT, key).setOrigin(0);
}

// Hand-drawn asterisk star (white, tint it).
function uiStarTexture(scene) {
  return uiSketchTexture(scene, 'ui_star', 44, 44, (ctx, shape, jitter) => {
    const arms = 3 + Math.floor(shape() * 2);
    const rot = shape() * Math.PI;
    for (let i = 0; i < arms; i++) {
      const a = rot + (i / arms) * Math.PI + (jitter() - 0.5) * 0.15;
      const r1 = 13 + shape() * 6;
      uiStroke(ctx, [
        { x: 22 - Math.cos(a) * r1, y: 22 - Math.sin(a) * r1 },
        { x: 22 + (jitter() - 0.5) * 2, y: 22 + (jitter() - 0.5) * 2 },
        { x: 22 + Math.cos(a) * r1, y: 22 + Math.sin(a) * r1 },
      ], jitter, { width: 3, color: 0xffffff, retrace: false });
    }
  });
}

// Scribbled loop that does not close neatly (1.15 turns), for circling things. White, tint it.
function uiCircleTexture(scene) {
  return uiSketchTexture(scene, 'ui_circle', 220, 150, (ctx, shape, jitter) => {
    const pts = [];
    const rot = -2.2 + shape() * 0.4;
    for (let i = 0; i <= 30; i++) {
      const t = i / 30;
      const a = rot + t * UI_TAU * 1.15;
      const k = 1 + 0.06 * Math.sin(a * 2 + 1) - t * 0.08;
      pts.push({ x: 110 + Math.cos(a) * 96 * k + (jitter() - 0.5) * 3, y: 75 + Math.sin(a) * 58 * k + (jitter() - 0.5) * 3 });
    }
    uiStroke(ctx, pts, jitter, { width: 6, color: 0xffffff, retrace: false });
  });
}

// Wavy double underline. White, tint it.
function uiUnderlineTexture(scene) {
  return uiSketchTexture(scene, 'ui_underline', 540, 50, (ctx, shape, jitter) => {
    const pts = [];
    for (let i = 0; i <= 14; i++) pts.push({ x: 14 + i * 36, y: 18 + Math.sin(i * 0.9 + shape() * 3) * 3 + (jitter() - 0.5) * 3 + i * 0.4 });
    for (let i = 13; i >= 4; i--) pts.push({ x: 14 + i * 36 + 10, y: 32 + Math.sin(i * 1.1) * 3 + (jitter() - 0.5) * 3 });
    uiStroke(ctx, pts, jitter, { width: 6, color: 0xffffff, retrace: false });
  });
}

// ---- buttons ----

function uiButtonTextures(scene, w, h) {
  const pad = 26;
  const key = 'ui_btn_' + w + 'x' + h;
  // Crayon fill (white, tinted per button) and the gel-pen outline are separate textures.
  uiSketchTexture(scene, key + '_fill', w + pad * 2, h + pad * 2, (ctx, shape, jitter) => {
    const pts = uiWobblyRect(pad, pad, w, h, shape, jitter, 1);
    uiHatch(ctx, pts, jitter, { spacing: 4.5, width: 5, angle: -0.95, alpha: 1, gaps: 0.04, offX: 4, offY: -3 });
    uiHatch(ctx, pts, jitter, { spacing: 7, width: 3, angle: -0.6, alpha: 0.7, gaps: 0.1, offX: 2, offY: 2, grow: 1.0 });
    uiGrain(ctx, w + pad * 2, h + pad * 2, jitter, 0.02);
  });
  uiSketchTexture(scene, key + '_line', w + pad * 2, h + pad * 2, (ctx, shape, jitter) => {
    const pts = uiWobblyRect(pad, pad, w, h, shape, jitter, 1.6);
    // Dark offset stroke first: reads as a cut-out sitting on the page.
    uiStroke(ctx, pts.map((p) => ({ x: p.x + 4, y: p.y + 7 })), jitter, { width: 8, color: 0x0b0a14, alpha: 0.5, closed: true, retrace: false });
    uiStroke(ctx, pts, jitter, { width: 5, color: UI_INK.cream, closed: true, overshoot: 2 });
  });
  return key;
}

// Touch-friendly hand-drawn button (keep h >= 100). opts: width, height, fontSize, color, textColor.
function makeButton(scene, x, y, label, onClick, opts = {}) {
  const w = opts.width || 420;
  const h = opts.height || 120;
  const color = opts.color !== undefined ? opts.color : UI_CRAYON.yellow;
  const key = uiButtonTextures(scene, w, h);
  const fill = uiBoilImage(scene, 0, 0, key + '_fill').setTint(color);
  const line = uiBoilImage(scene, 0, 0, key + '_line');
  const txt = scene.add.text(2, 2, label, {
    fontFamily: FONT,
    fontSize: opts.fontSize || '52px',
    color: opts.textColor || UI_INK.darkHex,
  }).setOrigin(0.5);
  txt.inkRot = (Math.random() - 0.5) * 0.05;
  txt.setRotation(txt.inkRot);
  uiBoilRotation(scene, txt, 0.012);

  const btn = scene.add.container(x, y, [fill, line, txt]);
  btn.setSize(w + 14, h + 26);
  btn.setInteractive({ useHandCursor: true });

  // Press = squash like paper pressed flat; release springs back.
  const settle = () => {
    scene.tweens.killTweensOf(btn);
    scene.tweens.add({ targets: btn, scaleX: 1, scaleY: 1, duration: 220, ease: 'Back.Out' });
  };
  btn.on('pointerdown', () => {
    scene.tweens.killTweensOf(btn);
    btn.setScale(1.05, 0.88);
  });
  btn.on('pointerout', settle);
  btn.on('pointerup', () => {
    settle();
    scene.game.events.emit('sfx', 'click', {});
    onClick();
  });
  return btn;
}

// Doodled speaker. AUDIO comes from src/audio.js and may be missing, so every call is guarded.
function uiSpeakerTexture(scene, muted) {
  return uiSketchTexture(scene, muted ? 'ui_speaker_off' : 'ui_speaker_on', 130, 130, (ctx, shape, jitter) => {
    const body = [
      { x: 26, y: 52 }, { x: 46, y: 51 }, { x: 70, y: 30 }, { x: 72, y: 100 }, { x: 47, y: 80 }, { x: 25, y: 79 },
    ].map((p) => ({ x: p.x + (shape() - 0.5) * 4 + (jitter() - 0.5) * 2.4, y: p.y + (shape() - 0.5) * 4 + (jitter() - 0.5) * 2.4 }));
    uiHatch(ctx, body, jitter, { color: muted ? UI_INK.pencil : UI_CRAYON.blue, spacing: 5, width: 4, offX: 3, offY: -2 });
    uiStroke(ctx, body, jitter, { width: 5, closed: true });
    if (muted) {
      uiStroke(ctx, [{ x: 84, y: 48 }, { x: 96, y: 64 }, { x: 110, y: 82 }], jitter, { width: 6, color: UI_CRAYON.red, retrace: false });
      uiStroke(ctx, [{ x: 110, y: 46 }, { x: 98, y: 63 }, { x: 85, y: 84 }], jitter, { width: 6, color: UI_CRAYON.red, retrace: false });
    } else {
      for (const r of [16, 32]) {
        const arc = [];
        for (let i = 0; i <= 6; i++) {
          const a = -0.85 + (i / 6) * 1.7;
          arc.push({ x: 76 + Math.cos(a) * r + (jitter() - 0.5) * 2, y: 65 + Math.sin(a) * r + (jitter() - 0.5) * 2 });
        }
        uiStroke(ctx, arc, jitter, { width: 5, retrace: false });
      }
    }
  });
}

function makeMuteButton(scene, x, y) {
  const size = 104;
  const onImg = uiBoilImage(scene, 0, 0, uiSpeakerTexture(scene, false));
  const offImg = uiBoilImage(scene, 0, 0, uiSpeakerTexture(scene, true));
  const btn = scene.add.container(x, y, [onImg, offImg]);
  const isMuted = () => (typeof AUDIO !== 'undefined' && AUDIO.isMuted ? AUDIO.isMuted() : false);
  const redraw = () => {
    const muted = isMuted();
    onImg.setVisible(!muted);
    offImg.setVisible(muted);
  };
  redraw();
  btn.setSize(size + 12, size + 12);
  btn.setInteractive({ useHandCursor: true });
  btn.on('pointerdown', () => btn.setScale(1.06, 0.9));
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

// Four doodled corner brackets; dark under-stroke keeps them readable on light paper too.
function uiFullscreenTexture(scene) {
  return uiSketchTexture(scene, 'ui_fullscreen', 110, 110, (ctx, shape, jitter) => {
    const c = 55;
    const r = 30;
    const arm = 16;
    for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      const pts = [
        { x: c + sx * r, y: c + sy * (r - arm) },
        { x: c + sx * r + (jitter() - 0.5) * 2, y: c + sy * r + (jitter() - 0.5) * 2 },
        { x: c + sx * (r - arm), y: c + sy * r },
      ].map((p) => ({ x: p.x + (shape() - 0.5) * 3, y: p.y + (shape() - 0.5) * 3 }));
      uiStroke(ctx, pts, jitter, { width: 10, color: UI_INK.dark, alpha: 0.8, retrace: false });
      uiStroke(ctx, pts, jitter, { width: 5, retrace: false });
    }
  });
}

// Sağ üst köşeye tam ekran butonu (çentikten uzak dursun diye biraz aşağıda)
function addFullscreenButton(scene) {
  const icon = uiBoilImage(scene, 0, 0, uiFullscreenTexture(scene));
  const btn = scene.add.container(GAME_WIDTH - 92, 116, [icon]).setDepth(1000);
  btn.setSize(110, 110);
  btn.setInteractive({ useHandCursor: true });
  btn.on('pointerdown', () => btn.setScale(0.9));
  btn.on('pointerout', () => btn.setScale(1));
  btn.on('pointerup', () => {
    btn.setScale(1);
    if (scene.scale.isFullscreen) {
      scene.scale.stopFullscreen();
    } else {
      scene.scale.startFullscreen();
    }
  });
  return btn;
}

// ---- progression UI: missions, coins, skins (shared by Menu / GameOver / Shop / Journal) ----
// PROGRESS (src/progress.js) may be missing or throw; every read goes through uiProgressCall so
// the menus still work (just without the meta layer) if it does.

function uiProgressCall(fn, fallback) {
  if (typeof PROGRESS === 'undefined' || !PROGRESS) return fallback;
  try {
    const value = fn(PROGRESS);
    return value === undefined ? fallback : value;
  } catch (e) {
    return fallback;
  }
}

// 12345 -> '12.3k' so a cumulative goal ('Climb 50,000 m total') fits its row.
function uiShortNumber(n) {
  const v = Math.max(0, Math.floor(n || 0));
  if (v < 10000) return String(v);
  const k = v / 1000;
  return (k < 100 ? (Math.floor(k * 10) / 10) : Math.floor(k)) + 'k';
}

// Unit written after a mission's progress: ' m' for altitude goals, ' km/s' for speed goals.
// m.stat when given, else looked up in PROGRESS's mission pool by id ('' when unknown).
const UI_MISSION_UNITS = { altitude: ' m', topSpeed: ' km/s' };
function uiMissionUnit(m) {
  if (!m) return '';
  let stat = m.stat;
  if (!stat && m.id && typeof MISSION_POOL !== 'undefined') {
    const def = MISSION_POOL.find((d) => d.id === m.id);
    stat = def && def.stat;
  }
  return UI_MISSION_UNITS[stat] || '';
}

// Progress written after a mission: '212/300', '312/500 m', '271/300 km/s'. One-shot missions
// (goal 1) and finished ones show none.
function uiMissionProgressLabel(m) {
  if (!m || m.done || !(m.goal > 1)) return '';
  return uiShortNumber(Math.min(m.progress || 0, m.goal)) + '/' + uiShortNumber(m.goal) + uiMissionUnit(m);
}

// Menu onboarding flags, one small JSON key: runDone (a run has reached the game over page),
// metaSeen (the missions / SHOP / JOURNAL layer has been shown once, so 'new!' only shows once).
const UI_MENU_FLAGS_KEY = 'escape_velocity_menu_v1';
function uiLoadMenuFlags() {
  try {
    const raw = JSON.parse(localStorage.getItem(UI_MENU_FLAGS_KEY) || '{}');
    return { runDone: !!(raw && raw.runDone), metaSeen: !!(raw && raw.metaSeen) };
  } catch (e) {
    return { runDone: false, metaSeen: false };
  }
}

function uiSaveMenuFlag(name) {
  const flags = uiLoadMenuFlags();
  if (flags[name]) return;
  flags[name] = true;
  try { localStorage.setItem(UI_MENU_FLAGS_KEY, JSON.stringify(flags)); } catch (e) { /* blocked: the session still knows */ }
  uiMenuSession[name] = true;
}

// Storage may be blocked: the flags also live for the session, so a first run still unlocks the menu.
const uiMenuSession = { runDone: false, metaSeen: false };

// Has the player finished at least one run? Players from before the flag existed count by
// their saved best score / altitude.
function uiHasFinishedRun() {
  if (uiMenuSession.runDone || uiLoadMenuFlags().runDone) return true;
  if (loadHighScore() > 0) return true;
  return uiProgressCall((P) => P.bestAltitude() > 0, false);
}

// What the shop's big button says for the selected skin.
// kind: 'equipped' (already worn), 'equip' (owned), 'buy' (affordable), 'short' (not enough coins).
function uiShopAction(skin, coins) {
  if (!skin || skin.equipped) return { kind: 'equipped', label: 'WEARING' };
  if (skin.owned) return { kind: 'equip', label: 'EQUIP' };
  const have = Math.max(0, Math.floor(coins || 0));
  if (have >= skin.price) return { kind: 'buy', label: 'BUY ' + skin.price };
  return { kind: 'short', label: 'NEED ' + (skin.price - have) + ' MORE', short: skin.price - have };
}

// Doodled coin: yellow crayon disc, dark pen rim, an inked asterisk stamped in the middle.
function uiCoinTexture(scene) {
  return uiSketchTexture(scene, 'ui_coin', 60, 60, (ctx, shape, jitter) => {
    const rim = uiLoop(30, 30, 22, 21, shape, jitter, { n: 16, amp: 0.8, lop: 0.05 });
    uiTracePath(ctx, rim.map((p) => ({ x: p.x + 2, y: p.y + 3 })), true);
    ctx.fillStyle = 'rgba(5,6,16,0.35)';
    ctx.fill();
    uiHatch(ctx, rim, jitter, { color: UI_CRAYON.yellow, spacing: 3, width: 3.5, alpha: 1, gaps: 0.02, offX: 1, offY: -1 });
    const inner = uiLoop(30, 30, 14, 13, shape, jitter, { n: 12, amp: 0.6 });
    uiStroke(ctx, inner, jitter, { width: 2, color: 0xb06a12, closed: true, retrace: false });
    uiStroke(ctx, rim, jitter, { width: 3.5, color: UI_INK.dark, closed: true, retrace: false });
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI + 0.3;
      uiStroke(ctx, [{ x: 30 - Math.cos(a) * 7, y: 30 - Math.sin(a) * 7 }, { x: 30 + Math.cos(a) * 7, y: 30 + Math.sin(a) * 7 }],
        jitter, { width: 2.5, color: 0x8a4a0a, retrace: false });
    }
  });
}

// Taped note: cream scrap with a drop shadow, wobbly edges, fibers, optional blue rule lines
// (o.rules = { top, step } in note px), a red margin (o.margin = x) and tape on top.
// o.paper: fill color (default note cream); o.tape: 'corners' (default) | 'top'.
function uiNoteTexture(scene, w, h, o) {
  o = o || {};
  const pad = 22;
  const paper = o.paper === undefined ? UI_CRAYON.note : o.paper;
  const key = 'ui_note_' + w + 'x' + h + '_' + paper.toString(16) + (o.rules ? '_r' + o.rules.top + '-' + o.rules.step : '') +
    (o.margin ? '_m' + o.margin : '') + '_' + (o.tape || 'corners');
  return uiSketchTexture(scene, key, w + pad * 2, h + pad * 2, (ctx, shape, jitter) => {
    const pts = uiWobblyRect(pad, pad, w, h, shape, jitter, 0.7);
    uiTracePath(ctx, pts.map((p) => ({ x: p.x + 6, y: p.y + 9 })), true);
    ctx.fillStyle = 'rgba(5,6,16,0.42)';
    ctx.fill();
    uiTracePath(ctx, pts, true);
    ctx.fillStyle = uiCss(paper);
    ctx.fill();
    ctx.save();
    uiTracePath(ctx, pts, true);
    ctx.clip();
    for (let i = 0; i < (w * h) / 2200; i++) {
      const x = pad + shape() * w;
      const y = pad + shape() * h;
      const a = shape() * UI_TAU;
      ctx.strokeStyle = 'rgba(120,95,50,' + (0.05 + shape() * 0.08) + ')';
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + Math.cos(a) * (5 + shape() * 14), y + Math.sin(a) * (5 + shape() * 14));
      ctx.stroke();
    }
    if (o.rules) {
      ctx.strokeStyle = 'rgba(90,135,200,0.38)';
      ctx.lineWidth = 2;
      for (let y = o.rules.top; y < h - 6; y += o.rules.step) {
        ctx.beginPath();
        ctx.moveTo(pad, pad + y + (shape() - 0.5) * 2);
        ctx.lineTo(pad + w, pad + y + (shape() - 0.5) * 2);
        ctx.stroke();
      }
    }
    if (o.margin) {
      ctx.strokeStyle = 'rgba(214,70,70,0.48)';
      ctx.beginPath();
      ctx.moveTo(pad + o.margin, pad);
      ctx.lineTo(pad + o.margin + 2, pad + h);
      ctx.stroke();
    }
    ctx.restore();
    const tapes = o.tape === 'top' ? [[pad + w / 2 + (shape() - 0.5) * 30, (shape() - 0.5) * 0.3]] : [[pad + 14, -0.62], [pad + w - 14, 0.58]];
    for (const [tx, rot] of tapes) {
      ctx.save();
      ctx.translate(tx, pad + 4);
      ctx.rotate(rot);
      const half = Math.min(52, w * 0.18);
      const tape = [];
      for (let i = 0; i <= 4; i++) tape.push({ x: half + (i % 2 ? 4 : 0) + (shape() - 0.5) * 3, y: -15 + i * 7.5 });
      for (let i = 4; i >= 0; i--) tape.push({ x: -half - (i % 2 ? 4 : 0) + (shape() - 0.5) * 3, y: -15 + i * 7.5 });
      uiTracePath(ctx, tape, true);
      ctx.fillStyle = 'rgba(240,232,190,0.58)';
      ctx.fill();
      ctx.restore();
    }
  });
}

// Pen checkbox for a mission row (dark ink, for cream notes). done: a green crayon tick in it.
function uiCheckboxTexture(scene, done) {
  return uiSketchTexture(scene, done ? 'ui_check_on' : 'ui_check_off', 48, 48, (ctx, shape, jitter) => {
    const box = uiWobblyRect(10, 12, 26, 26, shape, jitter, 0.7);
    uiStroke(ctx, box, jitter, { width: 3, color: UI_INK.dark, closed: true, retrace: false });
    if (done) {
      uiStroke(ctx, [{ x: 12, y: 24 }, { x: 21, y: 35 }, { x: 42, y: 4 }], jitter, { width: 5.5, color: 0x2f8a3a, retrace: false });
    }
  });
}

// Coin counter: doodled coin + hand-lettered number. Returns a container with setValue(n).
function uiCoinCounter(scene, x, y, value, o) {
  o = o || {};
  const size = o.size || 38;
  const coin = uiBoilImage(scene, 0, 0, uiCoinTexture(scene)).setScale(size / 40);
  const num = uiInkText(scene, size * 0.66, 2, String(value), {
    size, color: o.color || UI_INK.darkHex, stroke: o.stroke === undefined ? null : o.stroke, ox: 0, rot: -0.03,
  });
  const box = scene.add.container(x, y, [coin, num]);
  box.coin = coin;
  box.num = num;
  box.value = value;
  box.setValue = (n) => {
    box.value = n;
    num.setText(String(n));
    return box;
  };
  return box;
}

// One mission line for a cream note: checkbox, short text, pencil progress, '+50' with a coin.
// width: line width in px (row is centered on x). Returns a container with strike(duration, onDone).
function uiMissionRow(scene, x, y, mission, width, o) {
  o = o || {};
  const size = o.size || 28;
  const left = -width / 2;
  const box = uiBoilImage(scene, left + 20, 0, uiCheckboxTexture(scene, false));
  const coin = uiBoilImage(scene, width / 2 - 14, 0, uiCoinTexture(scene)).setScale(0.5);
  const reward = uiInkText(scene, width / 2 - 32, 1, '+' + (mission.reward || 0), {
    size: size - 2, color: '#9a5a08', stroke: null, ox: 1, rot: -0.03, boil: false,
  });
  const progressLabel = uiMissionProgressLabel(mission);
  const progress = uiInkText(scene, reward.x - reward.width - 14, 2, progressLabel, {
    size: size - 5, color: '#2f6fa8', stroke: null, ox: 1, rot: 0.01, boil: false,
  });
  const textLeft = left + 46;
  const textRight = progress.x - (progressLabel ? progress.width : 0) - 12;
  const text = uiInkText(scene, textLeft, 0, mission.text || '', {
    size, color: UI_INK.darkHex, stroke: null, ox: 0, rot: -0.008, boilAmount: 0.006,
  });
  // Long texts are squeezed a little, never wrapped: each mission is one line on the note.
  text.setScale(Math.min(1, (textRight - textLeft) / Math.max(1, text.width)), Math.min(1, Math.max(0.86, (textRight - textLeft) / Math.max(1, text.width))));
  const strikeGfx = scene.add.graphics();
  const row = scene.add.container(x, y, [box, text, progress, reward, coin, strikeGfx]);
  row.mission = mission;
  row.coinIcon = coin;
  row.rewardText = reward;
  // Red crayon scribbled through the text from left to right, like crossing a line off a list.
  row.strike = (duration, onDone) => {
    const x1 = textLeft - 6;
    const x2 = Math.max(textLeft + text.width * text.scaleX, progressLabel ? progress.x : 0) + 8;
    const state = { p: 0 };
    const seed = uiHash(String(mission.id || mission.text || 'm')) % 997;
    const draw = () => {
      strikeGfx.clear();
      uiScribbleLine(strikeGfx, x1, 4, x1 + (x2 - x1) * state.p, -1, seed, { width: 7, color: UI_CRAYON.red, amp: 2.4, passes: 2, alpha: 0.95 });
    };
    scene.tweens.add({
      targets: state, p: 1, duration: duration || 320, ease: 'Quad.easeOut', onUpdate: draw,
      onComplete: () => {
        draw();
        box.destroy();
        row.addAt(uiBoilImage(scene, left + 20, 0, uiCheckboxTexture(scene, true)), 0);
        text.setColor(UI_INK.pencilDarkHex);
        if (onDone) onDone();
      },
    });
  };
  return row;
}
