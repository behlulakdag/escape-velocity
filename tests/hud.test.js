// HUD pop rules and card-row grouping (pure helpers from the browser scripts).
// Run: node --test tests/hud.test.js
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

// The scripts are plain browser files: load them into one context with a tiny Phaser stub.
function loadBrowserScripts() {
  const context = vm.createContext({ Phaser: { Scene: class {} }, console });
  for (const file of ['src/config.js', 'src/cards.js', 'src/cardart.js', 'src/scenes/HudScene.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), context, { filename: file });
  }
  // Top-level const/let bindings are not context properties; read them out through an expression.
  return vm.runInContext('({ popPriority, POP_HIGH, POP_MEDIUM, POP_LOW, hudBoxDistance, cardGroupedOrder, hudQueueWaitingPop, hudFitCardRow, POP_WAIT, HUD_MILESTONE, HUD_BANNER, HUD_CARDS, hudSpeedSnap, hudSpeedEase, HUD_SNAP, hudMomentumStyle, HUD_MOMENTUM, UI_INK, UI_CRAYON })', context);
}

const hud = loadBrowserScripts();

test('important pops are high priority and never rank like +SPEED', () => {
  for (const label of ['UNBREAKABLE!', 'SHIELD!', 'NEW BEST!', 'CLOSE CALL!', 'GRAVITY WELL!', 'CHAIN REACTION!', 'ORBIT MASTER!', 'SHOCKWAVE!']) {
    assert.strictEqual(hud.popPriority(label), hud.POP_HIGH, label);
  }
});

test('PERFECT is medium, small gains are low', () => {
  assert.strictEqual(hud.popPriority('PERFECT!'), hud.POP_MEDIUM);
  assert.strictEqual(hud.popPriority('PERFECT x4! +SPEED'), hud.POP_MEDIUM);
  for (const label of ['+SPEED', 'CLOSE ORBIT!', 'WARP!', 'OVERSPEED!', 'CHAIN BOOST!']) {
    assert.strictEqual(hud.popPriority(label), hud.POP_LOW, label);
  }
});

test('box distance is 0 inside and euclidean outside', () => {
  assert.strictEqual(hud.hudBoxDistance(5, 5, 0, 0, 10, 10), 0);
  assert.strictEqual(hud.hudBoxDistance(13, 14, 0, 0, 10, 10), 5);
  assert.strictEqual(hud.hudBoxDistance(-20, 5, 0, 0, 10, 10), 20);
});

test('owned cards are grouped by family in first-pick order', () => {
  const order = hud.cardGroupedOrder(['aero', 'perfect', 'afterburner', 'chain', 'shockwave']);
  assert.deepStrictEqual(Array.from(order), ['aero', 'afterburner', 'perfect', 'chain', 'shockwave']);
});

test('pops waiting for a banner: same label replaces, the queue keeps the newest few', () => {
  let q = [];
  q = hud.hudQueueWaitingPop(q, { label: '+SPEED', at: 1 });
  q = hud.hudQueueWaitingPop(q, { label: 'PERFECT!', at: 2 });
  q = hud.hudQueueWaitingPop(q, { label: '+SPEED', at: 3 });
  assert.deepStrictEqual(q.map(i => i.label), ['PERFECT!', '+SPEED']);
  assert.strictEqual(q[1].at, 3);
  q = hud.hudQueueWaitingPop(q, { label: 'WARP!', at: 4 });
  assert.strictEqual(q.length, hud.POP_WAIT.max);
  assert.strictEqual(q[q.length - 1].label, 'WARP!');
  // A waiting high pop (card name) outlives newer low ones.
  q = hud.hudQueueWaitingPop([], { label: 'SHOCKWAVE!', at: 1, high: true });
  q = hud.hudQueueWaitingPop(q, { label: '+SPEED', at: 2 });
  q = hud.hudQueueWaitingPop(q, { label: 'WARP!', at: 3 });
  assert.deepStrictEqual(q.map(i => i.label), ['SHOCKWAVE!', 'WARP!']);
});

test('card row stays inside the walls: slides first, shrinks only when it cannot fit', () => {
  const L = hud.HUD_CARDS;
  // 5 cards: span from the left-most card to the right end of the row.
  const left = -4 * L.gap - L.groupGap - L.cardW / 2 - 14;
  const right = L.cardW / 2 + 14;
  // Walls off screen (zoom 1): the row keeps its preferred spot.
  let fit = hud.hudFitCardRow(left, right, L.right, 0, 720, 12);
  assert.strictEqual(fit.x, L.right);
  assert.strictEqual(fit.scale, 1);
  // Camera zoomed out: the right wall at screen x 640 -> the row slides left, still full size.
  fit = hud.hudFitCardRow(left, right, L.right, 80, 640, 12);
  assert.ok(fit.x + right * fit.scale <= 628 + 1e-9, 'right edge inside the wall');
  assert.ok(fit.x + left * fit.scale >= 92 - 1e-9, 'left edge inside the wall');
  assert.strictEqual(fit.scale, 1);
  // Very zoomed out: shrinks to fit between the walls.
  fit = hud.hudFitCardRow(left, right, L.right, 140, 580, 12);
  assert.ok(fit.scale < 1);
  assert.ok(Math.abs(fit.x + right * fit.scale - 568) < 1e-6);
  assert.ok(fit.x + left * fit.scale >= 152 - 1e-6);
});

test('milestone levels escalate in size; the banner sits lower when the card row is up', () => {
  const sizes = hud.HUD_MILESTONE.levels.map(l => l.size);
  for (let i = 1; i < sizes.length; i++) assert.ok(sizes[i] > sizes[i - 1]);
  assert.ok(hud.HUD_MILESTONE.holdMs + hud.HUD_MILESTONE.fadeMs + 130 <= 1100, 'stamp lasts about 0.9 s');
  const rowBottom = hud.HUD_CARDS.y + hud.HUD_CARDS.cardH / 2 + 12;
  // Banner title is ~84 px tall: its top must clear the row.
  assert.ok(hud.HUD_BANNER.yWithCards - 50 > rowBottom, 'banner title clears the card row');
});

test('speed readout: rises snap at once, big rises punch, drops ease down', () => {
  // A small orbit gain shows at once without a punch.
  let r = hud.hudSpeedSnap(300, 302);
  assert.strictEqual(r.shown, 302);
  assert.strictEqual(r.punch, 0);
  // A boost (SECOND WIND, milestone, card) snaps and punches, capped.
  r = hud.hudSpeedSnap(200, 260);
  assert.strictEqual(r.shown, 260);
  assert.ok(r.punch > 0.1 && r.punch <= hud.HUD_SNAP.punchMax);
  assert.strictEqual(hud.hudSpeedSnap(100, 2000).punch, hud.HUD_SNAP.punchMax);
  // A bigger boost punches harder.
  assert.ok(hud.hudSpeedSnap(200, 240).punch > hud.hudSpeedSnap(200, 215).punch);
  // A drop is not snapped by hudSpeedSnap; hudSpeedEase walks down and lands exactly.
  r = hud.hudSpeedSnap(300, 250);
  assert.strictEqual(r.shown, 300);
  let shown = 300;
  for (let i = 0; i < 120; i++) shown = hud.hudSpeedEase(shown, 250, 1 / 60);
  assert.strictEqual(shown, 250);
  const one = hud.hudSpeedEase(300, 250, 1 / 60);
  assert.ok(one < 300 && one > 290, 'eases, does not jump down');
  assert.strictEqual(hud.hudSpeedEase(250, 300, 1 / 60), 300, 'ease never lags a rise');
});

test('momentum cue escalates: more and taller flames, bigger and hotter number, shake only at the top', () => {
  const none = hud.hudMomentumStyle(0);
  assert.strictEqual(none.licks, 0);
  assert.strictEqual(none.shake, 0);
  assert.strictEqual(none.ink, hud.UI_INK.cream);
  let prev = hud.hudMomentumStyle(0.1);
  for (const m of [0.3, 0.5, 0.7, 0.9, 1]) {
    const s = hud.hudMomentumStyle(m);
    assert.ok(s.licks >= prev.licks, 'licks at ' + m);
    assert.ok(s.height > prev.height, 'height at ' + m);
    assert.ok(s.scale > prev.scale, 'scale at ' + m);
    prev = s;
  }
  assert.strictEqual(hud.hudMomentumStyle(0.6).shake, 0, 'no shake at mid momentum');
  assert.ok(hud.hudMomentumStyle(1).shake > 0);
  assert.ok(hud.hudMomentumStyle(1).shake <= hud.HUD_MOMENTUM.shakeMax);
  assert.strictEqual(hud.hudMomentumStyle(1).ink, hud.UI_CRAYON.red);
  assert.strictEqual(hud.hudMomentumStyle(0.625).ink, hud.UI_CRAYON.yellow);
  // Out of range and junk input are clamped.
  assert.deepStrictEqual(hud.hudMomentumStyle(5), hud.hudMomentumStyle(1));
  assert.strictEqual(hud.hudMomentumStyle(NaN).licks, 0);
  // The number's crayon only changes in a few steps (each change re-renders its texture).
  const inks = new Set();
  for (let m = 0; m <= 1; m += 0.01) inks.add(hud.hudMomentumStyle(m).ink);
  assert.ok(inks.size <= 9);
});