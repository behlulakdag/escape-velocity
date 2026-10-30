// Supernova death bite pose (art.js) and the game over build strip / NEW CARDS note layout
// (GameOverScene.js). Run: node --test tests/deathbeat-gameover.test.js
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function loadBrowserScripts() {
  const context = vm.createContext({ Phaser: { Scene: class {}, Math: { Clamp: (v, a, b) => Math.max(a, Math.min(b, v)) } }, console });
  for (const file of ['src/config.js', 'src/art.js', 'src/scenes/GameOverScene.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), context, { filename: file });
  }
  return vm.runInContext('({ deathJawsPose, DEATH_JAWS, goStripSlots, goNewCardX, GO_STRIP, GO_NEWCARD, GAME_WIDTH })', context);
}

const m = loadBrowserScripts();
// GameScene's death beat timing (GameScene.DEATH_CLOSE / DEATH_HOLD), in seconds.
const DEATH_CLOSE = 0.3;
const DEATH_HOLD = 0.55;

test('the mouth opens from below, then bites shut exactly at k = 1', () => {
  const start = m.deathJawsPose(0);
  assert.strictEqual(start.gap, 0);
  assert.ok(start.dy > 200, 'starts below the comet');
  const open = m.deathJawsPose(m.DEATH_JAWS.open);
  assert.ok(Math.abs(open.gap - m.DEATH_JAWS.gap) < 1e-9, 'wide open when the face has risen');
  assert.ok(Math.abs(open.dy) < 1e-9, 'mouth line on the comet');
  let prev = open.gap;
  for (let k = m.DEATH_JAWS.open + 0.05; k < 1; k += 0.05) {
    const p = m.deathJawsPose(k);
    assert.ok(p.gap < prev, 'closing never reopens');
    assert.ok(!p.closed);
    prev = p.gap;
  }
  const shut = m.deathJawsPose(1);
  assert.strictEqual(shut.gap, 0);
  assert.ok(shut.closed);
});

test('the bite snaps: most of the closing happens in the last third', () => {
  const J = m.DEATH_JAWS;
  const twoThirds = J.open + (1 - J.open) * (2 / 3);
  assert.ok(m.deathJawsPose(twoThirds).gap > J.gap * 0.6);
});

test('a short freeze after the bite, then the burst, all inside the hold', () => {
  const J = m.DEATH_JAWS;
  assert.strictEqual(m.deathJawsPose(1 + J.freeze * 0.9).burst, 0, 'freeze frame');
  assert.ok(m.deathJawsPose(1 + J.freeze + 0.1).burst > 0, 'burst starts');
  const holdEnd = 1 + DEATH_HOLD / DEATH_CLOSE;
  assert.ok(1 + J.freeze + J.burst <= holdEnd + 1e-9, 'burst finishes before the game over page');
  assert.ok((J.freeze * DEATH_CLOSE) >= 0.08 && (J.freeze * DEATH_CLOSE) <= 0.15, 'freeze reads as a beat, not a stall');
  assert.ok(DEATH_CLOSE + DEATH_HOLD <= 0.9, 'whole death beat <= 0.9 s');
});

test('pose is safe for odd input', () => {
  for (const k of [-1, NaN, undefined, 50]) {
    const p = m.deathJawsPose(k);
    for (const v of [p.gap, p.dy, p.alpha, p.burst, p.squash]) assert.ok(Number.isFinite(v), String(k));
  }
});

test('build slots stay on the strip paper for 1..12 cards', () => {
  for (let n = 1; n <= 12; n++) {
    const s = m.goStripSlots(n);
    const left = s.first - s.slot / 2 + m.GAME_WIDTH / 2;
    const right = s.first + (n - 0.5) * s.slot + m.GAME_WIDTH / 2;
    assert.ok(left >= m.GO_STRIP.left - 1e-9 && right <= m.GO_STRIP.right + 1e-9, 'n=' + n);
    assert.ok(right <= 678 - 12, 'clear of the torn right edge, n=' + n);
    assert.ok(s.labelMaxW < s.slot, 'labels narrower than their slot');
  }
});

test('the NEW CARDS note stays on screen and right of a 7-digit score', () => {
  for (const scale of [0.8, 0.84, 0.9, 1]) {
    const x = m.goNewCardX(scale);
    const N = m.GO_NEWCARD;
    const screenRight = m.GAME_WIDTH / 2 + (x + N.w / 2) * scale + N.tilt;
    assert.ok(screenRight <= m.GAME_WIDTH - N.gutter + 1e-9, 'scale ' + scale);
  }
  // Shipped layout (PROGRESS loaded) draws the page at ~0.84: the note clears a 7-digit score (~215 px half width).
  assert.ok(m.goNewCardX(0.84) - m.GO_NEWCARD.w / 2 > 215);
});
