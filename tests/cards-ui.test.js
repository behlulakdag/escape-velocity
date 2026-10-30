// Run with: node --test tests/cards-ui.test.js
// Pure pick rules of the upgrade card overlay (src/scenes/CardScene.js).
const test = require('node:test');
const assert = require('node:assert');

// CardScene.js is a browser classic script: stub the globals it touches at load time.
global.Phaser = global.Phaser || { Scene: class {} };
global.UI_INK = global.UI_INK || { pencilDarkHex: '#555', darkHex: '#222' };
const ui = require('../src/scenes/CardScene.js');

test('the countdown does not run before the cards are armed', () => {
  assert.strictEqual(ui.cardCountdownLeft(3, null, 5), 5);
  assert.strictEqual(ui.cardCountdownLeft(1.0, 1.0, 5), 5);
  assert.strictEqual(ui.cardCountdownLeft(3.5, 1.0, 5), 2.5);
  assert.strictEqual(ui.cardCountdownLeft(99, 1.0, 5), 0);
});

test('every number on the ring lasts one real second', () => {
  // Label = ceil(left): sample the label each 1/60 s and measure how long each one is up.
  const armAt = 1.07;
  const seen = {};
  for (let e = armAt; e < armAt + 5; e += 1 / 60) {
    const label = Math.ceil(ui.cardCountdownLeft(e, armAt, 5));
    seen[label] = (seen[label] || 0) + 1 / 60;
  }
  assert.deepStrictEqual(Object.keys(seen).map(Number).sort(), [1, 2, 3, 4, 5]);
  for (const k of Object.keys(seen)) assert.ok(Math.abs(seen[k] - 1) < 0.05, k + ': ' + seen[k]);
});

test('presses before arming never count, presses after do', () => {
  assert.strictEqual(ui.cardPressCounts(0.2, null), false);   // cards still dealing
  assert.strictEqual(ui.cardPressCounts(0.9, 1.0), false);    // landed but not armed yet
  assert.strictEqual(ui.cardPressCounts(1.0, 1.0), true);
  assert.strictEqual(ui.cardPressCounts(2.4, 1.0), true);
});

test('a release picks only the card it went down on', () => {
  for (let i = 0; i < 3; i++) assert.strictEqual(ui.cardReleasePick(i, i), i);
  assert.strictEqual(ui.cardReleasePick(0, 1), -1);   // slid onto a neighbour
  assert.strictEqual(ui.cardReleasePick(2, -1), -1);  // slid off the cards
  assert.strictEqual(ui.cardReleasePick(-1, 1), -1);  // no counted press
});

test('the auto-pick waits for a finger already down, but not forever', () => {
  const g = 0.6;
  assert.strictEqual(ui.cardAutoPickDue(0.3, false, 5, null, g), false);
  assert.strictEqual(ui.cardAutoPickDue(0, false, 6, 6, g), true);
  assert.strictEqual(ui.cardAutoPickDue(0, true, 6, 6, g), false);
  assert.strictEqual(ui.cardAutoPickDue(0, true, 6.5, 6, g), false);
  assert.strictEqual(ui.cardAutoPickDue(0, true, 6.61, 6, g), true);
});

test('deal-in + arm + countdown + grace + exit fit inside GameScene\'s safety net', () => {
  // GameScene auto-picks on its own at CARD_TIMEOUT + 1.5 s (6 + 1.5). The last card lands about
  // 40 + 2 * 110 + 260 + 200 ms after opening; the exit animation is 360 ms.
  const timeout = 6;
  const landed = (40 + 2 * 110 + 260 + 200) / 1000;
  const countdown = Math.max(2, timeout - ui.CARD_UI.countdownTrim);
  const worst = landed + ui.CARD_UI.armDelay + countdown + ui.CARD_UI.tapGrace + 0.36;
  assert.ok(worst < timeout + 1.5 - 0.2, 'worst case ' + worst.toFixed(2) + ' s');
  assert.ok(ui.CARD_UI.armDelay >= 0.3 && ui.CARD_UI.armDelay <= 0.4);
});

// Seeded rand for the scrap shape tests.
function seeded(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

test('the torn edge is ragged, stays within its depth and runs left to right', () => {
  for (let seed = 1; seed < 40; seed++) {
    const pts = ui.cardTornEdge(10, 200, 50, 7, seeded(seed));
    assert.ok(pts.length >= 14, 'teeth: ' + pts.length);
    for (let i = 1; i < pts.length; i++) assert.ok(pts[i].x > pts[i - 1].x);
    for (const p of pts) assert.ok(Math.abs(p.y - 50) <= 7);
    assert.ok(pts.some((p) => p.y < 50 - 2) && pts.some((p) => p.y > 50 + 2), 'teeth go both ways');
  }
});

test('the "+1 set" scrap is a torn scrap, not a rounded tag, and fits its texture', () => {
  const S = ui.CARD_SET_SCRAP;
  const out = ui.cardSetScrapOutline(seeded(7));
  const bottom = out.filter((p) => p.y > S.pad + S.h * 0.75);
  assert.ok(bottom.length >= 12, 'torn bottom edge has many teeth');
  for (const p of out) {
    assert.ok(p.x >= 0 && p.x <= S.w + S.pad * 2, 'x in texture');
    assert.ok(p.y >= 0 && p.y <= S.h + S.pad * 2, 'y in texture');
  }
});

test('the dealt row keeps a >= 16 css px gutter on 360 and 375 px wide phones', () => {
  for (const viewW of [360, 375]) {
    const g = ui.cardRowGutterCss(viewW, 720);
    assert.ok(g >= 16, viewW + ' px wide: ' + g.toFixed(1));
  }
});
