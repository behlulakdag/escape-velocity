// Sketchbook card art: the 12 upgrade icons as gel-pen doodles, the family crayons, and the
// small pre-rendered textures (icon, mini index card) that the HUD, CardScene and GameOver share.
//
// ART.drawCardIcon(target, key, x, y, size, color) is replaced here. `target` is normally a
// CanvasRenderingContext2D (icons are baked once into boil-variant textures, never redrawn per
// frame); a Phaser Graphics also works (no crayon fill then, Graphics cannot clip).
//
// Loaded right after src/art.js (needs ART, UI_* from config.js/utils.js, CARDS from cards.js).

// Family colors as crayons (the neon CARD_FAMILIES colors stay for the in-world effects).
const CARD_CRAYON = {
  orbit: 0x52b9a5,    // teal
  fling: 0xf2c14a,    // gold
  flight: 0x7fbde6,   // sky blue
  shield: 0xe88fb4,   // pink
};
const CARD_GOLD = 0xe8b23a;            // legendary crayon border, set-bonus loops
const CARD_ICON_PX = 128;              // icon texture size; scaled down for the HUD / lists

function cardCrayon(familyKey) {
  return CARD_CRAYON[familyKey] || UI_INK.cream;
}

// Darker pen for writing in a family color on cream paper (the crayon itself is too light).
function cardCrayonInk(familyKey) {
  const c = cardCrayon(familyKey);
  const k = 0.55;
  const r = Math.round(((c >> 16) & 255) * k);
  const g = Math.round(((c >> 8) & 255) * k);
  const b = Math.round((c & 255) * k);
  return '#' + ((r << 16) | (g << 8) | b).toString(16).padStart(6, '0');
}

// Minimal canvas-like adapter over a Phaser Graphics, so the same doodle code can draw into
// either. Curves become their end point (fine at icon scale); clip/hatch are skipped.
function cardGraphicsShim(g) {
  const parse = (css) => {
    const m = /rgba?\(([^)]+)\)/.exec(css || '');
    if (!m) return { color: 0xffffff, alpha: 1 };
    const p = m[1].split(',').map(Number);
    return { color: (p[0] << 16) | (p[1] << 8) | p[2], alpha: p.length > 3 ? p[3] : 1 };
  };
  let pts = [];
  const shim = {
    isGraphicsShim: true,
    lineWidth: 1, strokeStyle: '', fillStyle: '', globalAlpha: 1, lineCap: '', lineJoin: '',
    beginPath() { pts = []; },
    moveTo(x, y) { pts.push({ x, y, move: true }); },
    lineTo(x, y) { pts.push({ x, y }); },
    quadraticCurveTo(cx, cy, x, y) { pts.push({ x, y }); },
    closePath() { if (pts.length) pts.push({ x: pts[0].x, y: pts[0].y }); },
    stroke() {
      const s = parse(shim.strokeStyle);
      g.lineStyle(shim.lineWidth, s.color, s.alpha * shim.globalAlpha);
      g.beginPath();
      pts.forEach((p, i) => (i === 0 || p.move ? g.moveTo(p.x, p.y) : g.lineTo(p.x, p.y)));
      g.strokePath();
    },
    fill() {
      const s = parse(shim.fillStyle);
      g.fillStyle(s.color, s.alpha * shim.globalAlpha);
      g.fillPoints(pts.map((p) => ({ x: p.x, y: p.y })), true);
    },
    save() {}, restore() {}, clip() {}, translate() {}, rotate() {},
  };
  return shim;
}

// ---- the 12 icons ----
// Drawn in dark ink with a crayon accent in the family color. shape(): same for every boil
// variant (the doodle's design); jitter(): per variant (the pen wobble).
function cardDrawIconDoodle(ctx, key, x, y, size, color, shape, jitter) {
  const r = size / 2;
  const ink = UI_INK.dark;
  const w = Math.max(2, size * 0.045);
  const canHatch = !ctx.isGraphicsShim;
  const P = (u, v) => ({ x: x + u * r + (jitter() - 0.5) * r * 0.03, y: y + v * r + (jitter() - 0.5) * r * 0.03 });
  const line = (pts, o) => uiStroke(ctx, pts, jitter, Object.assign({ width: w, color: ink, retrace: false }, o || {}));
  const shapeLine = (pts, o) => line(pts, Object.assign({ closed: true, retrace: true }, o || {}));
  const fill = (pts, c, o) => {
    if (canHatch) uiHatch(ctx, pts, jitter, Object.assign({ color: c, spacing: Math.max(3, size * 0.035), width: Math.max(2, size * 0.035), alpha: 0.95, offX: r * 0.04, offY: -r * 0.03 }, o || {}));
    else { uiTracePath(ctx, pts, true); ctx.fillStyle = uiCss(c, 0.9); ctx.fill(); }
  };
  const loop = (u, v, ru, rv, o) => uiLoop(x + u * r, y + v * r, ru * r, (rv === undefined ? ru : rv) * r, shape, jitter, Object.assign({ n: 18, amp: r * 0.012, lop: 0.07 }, o || {}));
  const arc = (u, v, ru, a0, a1, n, rv) => {
    const pts = [];
    for (let i = 0; i <= n; i++) {
      const a = a0 + (a1 - a0) * (i / n);
      pts.push(P(u + Math.cos(a) * ru, v + Math.sin(a) * (rv === undefined ? ru : rv)));
    }
    return pts;
  };
  const arrowHead = (tip, dirA, len) => {
    line([
      { x: tip.x + Math.cos(dirA + 2.5) * len, y: tip.y + Math.sin(dirA + 2.5) * len },
      tip,
      { x: tip.x + Math.cos(dirA - 2.5) * len, y: tip.y + Math.sin(dirA - 2.5) * len },
    ]);
  };
  const dashes = (pts, every) => {
    for (let i = 0; i < pts.length - 1; i += every) line([pts[i], pts[i + 1]], { width: w * 0.8 });
  };

  switch (key) {
    case 'well': {
      // Planet with a dashed grab range around it and arrows pulling in.
      const planet = loop(0, 0, 0.3);
      fill(planet, color);
      shapeLine(planet);
      dashes(arc(0, 0, 0.82, 0, UI_TAU, 28), 2);
      for (let i = 0; i < 4; i++) {
        const a = -0.6 + i * (UI_TAU / 4);
        const from = P(Math.cos(a) * 0.98, Math.sin(a) * 0.98);
        const to = P(Math.cos(a) * 0.48, Math.sin(a) * 0.48);
        line([from, to]);
        arrowHead(to, a + Math.PI, r * 0.13);
      }
      break;
    }
    case 'spin': {
      // Small planet with a tight spiral wound around it.
      const planet = loop(0, 0, 0.24);
      fill(planet, color);
      shapeLine(planet);
      const spiral = [];
      for (let i = 0; i <= 30; i++) {
        const t = i / 30;
        const a = -1.2 + t * UI_TAU * 1.7;
        const rr = 0.38 + t * 0.5;
        spiral.push(P(Math.cos(a) * rr, Math.sin(a) * rr * 0.86));
      }
      line(spiral);
      const end = spiral[spiral.length - 1];
      const prev = spiral[spiral.length - 3];
      arrowHead(end, Math.atan2(end.y - prev.y, end.x - prev.x), r * 0.16);
      break;
    }
    case 'overdrive': {
      // Ringed planet with a fast orbit and double chevrons riding it.
      const planet = loop(0, 0.05, 0.34);
      fill(planet, color);
      shapeLine(planet);
      line(arc(0, 0.05, 0.86, Math.PI * 0.95, Math.PI * 2.05, 16, 0.34));
      line(arc(0, 0.05, 0.86, Math.PI * 0.05, Math.PI * 0.95, 10, 0.34), { width: w * 0.6, alpha: 0.6 });
      for (const off of [0, 0.22]) {
        line([P(0.28 + off, -0.82), P(0.46 + off, -0.64), P(0.28 + off, -0.46)], { width: w * 1.2 });
      }
      break;
    }
    case 'perfect': {
      // A wide-open window (two arms of an angle) with a star right in the middle.
      line([P(-0.82, -0.62), P(0, 0.78), P(0.82, -0.62)], { width: w * 1.1 });
      line(arc(0, 0.78, 1.1, -Math.PI * 0.66, -Math.PI * 0.34, 10), { width: w * 0.8 });
      const star = [];
      for (let i = 0; i < 10; i++) {
        const a = -Math.PI / 2 + (i / 10) * UI_TAU;
        const rr = i % 2 ? 0.16 : 0.38;
        star.push(P(Math.cos(a) * rr, -0.08 + Math.sin(a) * rr));
      }
      fill(star, color);
      shapeLine(star);
      break;
    }
    case 'sling': {
      // Slingshot fork, pulled band, and a comet loaded in it.
      line([P(0, 0.95), P(0, 0.2)], { width: w * 1.5 });
      line([P(0, 0.2), P(-0.45, -0.55)], { width: w * 1.4 });
      line([P(0, 0.2), P(0.45, -0.55)], { width: w * 1.4 });
      line([P(-0.45, -0.55), P(-0.02, 0.05), P(0.45, -0.55)], { width: w * 0.8 });
      const comet = loop(0, 0.0, 0.17);
      fill(comet, color, { offX: 0, offY: 0 });
      shapeLine(comet);
      for (const dx of [-0.1, 0.12]) line([P(dx, -0.4), P(dx * 1.6, -0.92)], { width: w * 0.7 });
      break;
    }
    case 'chain': {
      // Three linked oval chain links on a diagonal.
      for (let i = 0; i < 3; i++) {
        const u = -0.52 + i * 0.52;
        const v = 0.42 - i * 0.42;
        const link = loop(u, v, 0.34, 0.22, { lop: 0.03 });
        if (i === 1) fill(link, color, { offX: 0, offY: 0 });
        shapeLine(link, { width: w * 1.1 });
      }
      break;
    }
    case 'aero': {
      // Streamlined comet teardrop with air lines sliding off it.
      const drop = [P(0.62, -0.5), P(0.3, -0.22), P(-0.05, 0.12), P(-0.3, 0.5), P(-0.55, 0.38), P(-0.48, 0.05), P(-0.1, -0.24)];
      fill(drop, color);
      line(drop, { closed: true });
      line([P(-0.95, -0.15), P(-0.35, -0.55), P(0.2, -0.82)], { width: w * 0.8 });
      line([P(-0.9, 0.85), P(-0.35, 0.82), P(0.3, 0.45)], { width: w * 0.8 });
      line([P(-0.98, 0.3), P(-0.72, 0.22)], { width: w * 0.7 });
      break;
    }
    case 'wallkick': {
      // A hatched wall on the left, the path hitting it and kicking up and away.
      const wall = [P(-0.92, -0.95), P(-0.62, -0.95), P(-0.62, 0.95), P(-0.92, 0.95)];
      fill(wall, UI_INK.pencilDark, { spacing: size * 0.06, alpha: 0.7 });
      line([P(-0.62, -0.95), P(-0.6, 0.95)], { width: w * 1.3 });
      const path = [P(0.6, 0.85), P(0.05, 0.5), P(-0.56, 0.18), P(-0.1, -0.2), P(0.55, -0.72)];
      line(path, { width: w * 1.1 });
      arrowHead(path[4], Math.atan2(path[4].y - path[3].y, path[4].x - path[3].x), r * 0.2);
      // Impact marks where it kicked.
      for (const a of [-0.6, 0, 0.6]) line([P(-0.5 + Math.cos(a) * 0.1, 0.18 + Math.sin(a) * 0.1), P(-0.5 + Math.cos(a) * 0.28, 0.18 + Math.sin(a) * 0.28)], { width: w * 0.7 });
      const comet = loop(0.55, -0.72, 0.13);
      fill(comet, color, { offX: 0, offY: 0 });
      break;
    }
    case 'afterburner': {
      // Two-tone flame: crayon outer, light inner tongue.
      const outer = [P(0, -0.95), P(0.3, -0.45), P(0.58, 0.05), P(0.52, 0.55), P(0.18, 0.88), P(-0.22, 0.88), P(-0.55, 0.52), P(-0.55, 0.02), P(-0.28, -0.3), P(-0.12, 0.0)];
      fill(outer, color);
      line(outer, { closed: true, width: w * 1.1 });
      const inner = [P(0.02, -0.2), P(0.25, 0.25), P(0.2, 0.62), P(-0.15, 0.66), P(-0.26, 0.32), P(-0.08, 0.1)];
      fill(inner, UI_CRAYON.orange, { offX: 0, offY: 0 });
      line(inner, { closed: true, width: w * 0.8 });
      break;
    }
    case 'heatshield': {
      // Shield with a little flame emblem.
      const shield = [P(-0.66, -0.72), P(0, -0.88), P(0.66, -0.72), P(0.62, 0.05), P(0.34, 0.55), P(0, 0.88), P(-0.34, 0.55), P(-0.62, 0.05)];
      fill(shield, color);
      line(shield, { closed: true, width: w * 1.2, retrace: true });
      const flame = [P(0, -0.45), P(0.2, -0.1), P(0.22, 0.2), P(0, 0.42), P(-0.22, 0.2), P(-0.14, -0.04), P(-0.04, 0.06)];
      fill(flame, UI_CRAYON.orange, { offX: 0, offY: 0 });
      line(flame, { closed: true, width: w * 0.8 });
      break;
    }
    case 'armor': {
      // Asteroid cracking in two, shards flying off.
      const left = [P(-0.16, -0.62), P(-0.55, -0.5), P(-0.76, -0.05), P(-0.6, 0.45), P(-0.22, 0.6), P(-0.1, 0.18), P(-0.26, -0.12)];
      const right = [P(0.06, -0.66), P(0.5, -0.46), P(0.72, 0.02), P(0.48, 0.5), P(0.04, 0.62), P(0.16, 0.2), P(0.0, -0.12)];
      fill(left, 0xa69ab8, { alpha: 0.8 });
      fill(right, 0xa69ab8, { alpha: 0.8 });
      line(left, { closed: true });
      line(right, { closed: true });
      for (const [u, v, a] of [[0.0, -0.9, -1.5], [0.86, -0.6, -0.6], [-0.9, 0.7, 2.4]]) {
        const shard = [P(u, v), P(u + Math.cos(a) * 0.18, v + Math.sin(a) * 0.18), P(u + Math.cos(a + 1.6) * 0.14, v + Math.sin(a + 1.6) * 0.14)];
        fill(shard, color, { offX: 0, offY: 0 });
        line(shard, { closed: true, width: w * 0.8 });
      }
      break;
    }
    case 'shockwave': {
      // Comet on top, shock arcs blasting down toward the supernova.
      for (let i = 0; i < 3; i++) {
        line(arc(0, -0.55, 0.5 + i * 0.3, Math.PI * 0.2, Math.PI * 0.8, 10), { width: w * (1.2 - i * 0.2) });
      }
      const comet = loop(0, -0.55, 0.22);
      fill(comet, color, { offX: 0, offY: 0 });
      shapeLine(comet);
      line([P(-0.12, -0.8), P(-0.3, -0.98)], { width: w * 0.7 });
      line([P(0.14, -0.8), P(0.3, -0.98)], { width: w * 0.7 });
      break;
    }
    default: {
      // Unknown icon: a doodled asterisk.
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI;
        line([P(-Math.cos(a) * 0.6, -Math.sin(a) * 0.6), P(Math.cos(a) * 0.6, Math.sin(a) * 0.6)]);
      }
    }
  }
}

if (typeof ART !== 'undefined') {
  ART.drawCardIcon = function drawCardIcon(target, key, x, y, size, color, rngs) {
    const isCanvas = target && typeof target.quadraticCurveTo === 'function' && !target.lineStyle;
    const ctx = isCanvas ? target : cardGraphicsShim(target);
    const shape = (rngs && rngs.shape) || uiRng(uiHash('icon_' + key));
    const jitter = (rngs && rngs.jitter) || uiRng(uiHash('icon_' + key) + 17);
    cardDrawIconDoodle(ctx, key, x, y, size, color, shape, jitter);
  };
}

// Icon texture (boil variants), white paper not included: put it on a card/scrap. Returns base key.
function cardIconTexture(scene, iconKey, familyKey) {
  const key = 'cd_icon_' + iconKey;
  return uiSketchTexture(scene, key, CARD_ICON_PX, CARD_ICON_PX, (ctx, shape, jitter) => {
    ART.drawCardIcon(ctx, iconKey, CARD_ICON_PX / 2, CARD_ICON_PX / 2, CARD_ICON_PX * 0.8, cardCrayon(familyKey), { shape, jitter });
  });
}

// Small taped index-card scrap in the family crayon, for the HUD row and the game over build.
const CARD_MINI = { w: 64, h: 74, pad: 12 };
function cardMiniTexture(scene, familyKey) {
  const { w, h, pad } = CARD_MINI;
  const key = 'cd_mini_' + familyKey;
  return uiSketchTexture(scene, key, w + pad * 2, h + pad * 2, (ctx, shape, jitter) => {
    const pts = uiWobblyRect(pad, pad, w, h, shape, jitter, 0.8);
    uiTracePath(ctx, pts.map((p) => ({ x: p.x + 3, y: p.y + 5 })), true);
    ctx.fillStyle = 'rgba(5,6,16,0.4)';
    ctx.fill();
    uiTracePath(ctx, pts, true);
    ctx.fillStyle = uiCss(UI_CRAYON.note);
    ctx.fill();
    // Family crayon patch on the lower part, then the pen outline.
    const patch = uiLoop(pad + w / 2, pad + h * 0.56, w * 0.4, h * 0.34, shape, jitter, { n: 14, amp: 0.8, lop: 0.1 });
    uiHatch(ctx, patch, jitter, { color: cardCrayon(familyKey), spacing: 3.5, width: 3, alpha: 0.85, offX: 2, offY: -1 });
    uiStroke(ctx, pts, jitter, { width: 2.2, color: UI_INK.dark, closed: true, retrace: false });
    // Tape strip.
    ctx.save();
    ctx.translate(pad + w / 2 + (shape() - 0.5) * 8, pad + 2);
    ctx.rotate((shape() - 0.5) * 0.4);
    ctx.fillStyle = 'rgba(240,232,190,0.6)';
    ctx.fillRect(-15, -6, 30, 12);
    ctx.restore();
  });
}

// Gold crayon loop scrawled round a mini card: marks a card whose family set is complete.
function cardSetLoopTexture(scene) {
  return uiSketchTexture(scene, 'cd_setloop', 112, 124, (ctx, shape, jitter) => {
    const pts = [];
    const rot = -2 + shape() * 0.5;
    for (let i = 0; i <= 26; i++) {
      const t = i / 26;
      const a = rot + t * UI_TAU * 1.12;
      const k = 1 + 0.05 * Math.sin(a * 2 + 1) - t * 0.06;
      pts.push({ x: 56 + Math.cos(a) * 48 * k + (jitter() - 0.5) * 2.5, y: 62 + Math.sin(a) * 54 * k + (jitter() - 0.5) * 2.5 });
    }
    uiStroke(ctx, pts, jitter, { width: 6, color: CARD_GOLD, retrace: false });
  });
}

// One gold crayon loop scrawled round a whole set group (all cards of a completed family),
// w x h = the group's outer size. Keyed by size (and color), so each group width is baked once.
// color: defaults to the gold crayon; pass a deeper one on cream paper.
function cardSetGroupLoopTexture(scene, w, h, color) {
  const W = Math.round(w);
  const H = Math.round(h);
  const c = color === undefined ? CARD_GOLD : color;
  return uiSketchTexture(scene, 'cd_setgroup_' + W + 'x' + H + '_' + c.toString(16), W + 20, H + 20, (ctx, shape, jitter) => {
    const cx = (W + 20) / 2;
    const cy = (H + 20) / 2;
    const rx = W / 2;
    const ry = H / 2;
    const pts = [];
    const rot = -2.2 + shape() * 0.4;
    // A rounded-rectangle-ish loop (superellipse) so long groups are hugged, overshooting its start.
    for (let i = 0; i <= 40; i++) {
      const t = i / 40;
      const a = rot + t * UI_TAU * 1.08;
      const c = Math.cos(a);
      const s = Math.sin(a);
      const k = 1 - t * 0.05;
      const px = Math.sign(c) * Math.pow(Math.abs(c), 0.55) * rx * k;
      const py = Math.sign(s) * Math.pow(Math.abs(s), 0.55) * ry * k;
      pts.push({ x: cx + px + (jitter() - 0.5) * 3, y: cy + py + (jitter() - 0.5) * 3 });
    }
    uiStroke(ctx, pts, jitter, { width: 6, color: c, retrace: false });
  });
}

// Owned cards in display order: each family's cards side by side (families in the order they
// were first picked), so a completed set can be looped as one group.
function cardGroupedOrder(ids) {
  const families = [];
  for (const id of ids) {
    const c = cardById(id);
    if (c && families.indexOf(c.family) < 0) families.push(c.family);
  }
  const out = [];
  for (const f of families) for (const id of ids) if (cardById(id).family === f) out.push(id);
  return out;
}

// Mini card (scrap + icon) as one container. Returns the container; .scrap and .icon exposed.
function cardMakeMini(scene, x, y, cardId, scale) {
  const card = cardById(cardId) || { family: 'orbit', icon: cardId };
  const scrap = uiBoilImage(scene, 0, 0, cardMiniTexture(scene, card.family));
  const icon = uiBoilImage(scene, 0, 4, cardIconTexture(scene, card.icon, card.family)).setScale(0.5);
  const box = scene.add.container(x, y, [scrap, icon]).setScale(scale || 1);
  box.inkRot = ((uiHash(cardId) % 100) / 100 - 0.5) * 0.16;
  box.setRotation(box.inkRot);
  box.scrap = scrap;
  box.icon = icon;
  return box;
}

// Ink-doodle burst: asterisk stars and short dashes flung out from (x, y). Shared by the card
// pick, set bonus and HUD row. tints: crayon colors to cycle through.
function cardDoodleBurst(scene, x, y, tints, o) {
  o = o || {};
  const count = o.count || 10;
  const reach = o.reach || 220;
  uiStarTexture(scene);
  for (let i = 0; i < count; i++) {
    const a = (i / count) * UI_TAU + Math.random() * 0.5;
    const d = reach * (0.7 + Math.random() * 0.5);
    const star = uiBoilImage(scene, x, y, 'ui_star').setTint(tints[i % tints.length]).setScale(0.6 + (i % 3) * 0.3);
    if (o.depth) star.setDepth(o.depth);
    scene.tweens.add({
      targets: star, x: x + Math.cos(a) * d, y: y + Math.sin(a) * d * (o.squashY || 0.8), angle: Phaser.Math.Between(-200, 200),
      alpha: 0, duration: Phaser.Math.Between(450, 750), ease: 'Cubic.easeOut', onComplete: () => star.destroy(),
    });
  }
  // Dashed speed lines radiating out (one Graphics, drawn once, then faded).
  const g = scene.add.graphics();
  if (o.depth) g.setDepth(o.depth);
  const seed = Math.floor(Math.random() * 1000);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * UI_TAU + 0.3;
    const r0 = reach * 0.3;
    const r1 = reach * 0.55;
    uiScribbleLine(g, x + Math.cos(a) * r0, y + Math.sin(a) * r0 * 0.8, x + Math.cos(a) * r1, y + Math.sin(a) * r1 * 0.8, seed + i,
      { width: 4, color: o.ink === undefined ? UI_INK.cream : o.ink, amp: 1.2, passes: 1 });
  }
  scene.tweens.add({ targets: g, alpha: 0, duration: 380, ease: 'Quad.Out', onComplete: () => g.destroy() });
}
