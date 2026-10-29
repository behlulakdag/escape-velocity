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
  return vm.runInContext('({ popPriority, POP_HIGH, POP_MEDIUM, POP_LOW, hudBoxDistance, cardGroupedOrder })', context);
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
