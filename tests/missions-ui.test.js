// Missions note labels (pure helper from utils.js).
// Run: node --test tests/missions-ui.test.js
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function loadUtils() {
  const context = vm.createContext({ Phaser: { Scene: class {} }, console });
  for (const file of ['src/config.js', 'src/utils.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), context, { filename: file });
  }
  return vm.runInContext('({ uiMissionRowLabel })', context);
}

const ui = loadUtils();

test('a fresh mission with no progress says next run instead of 0/N', () => {
  assert.strictEqual(ui.uiMissionRowLabel({ stat: 'altitude', progress: 0, goal: 1500 }, true), 'next run');
  assert.strictEqual(ui.uiMissionRowLabel({ progress: 0, goal: 5 }, true), 'next run');
});

test('an old mission keeps its pencil progress', () => {
  assert.strictEqual(ui.uiMissionRowLabel({ progress: 0, goal: 5 }, false), '0/5');
  assert.strictEqual(ui.uiMissionRowLabel({ progress: 3, goal: 5 }, true), '3/5');
});

test('a finished mission has no label', () => {
  assert.strictEqual(ui.uiMissionRowLabel({ progress: 5, goal: 5, done: true }, true), '');
});

// Game over 'reached' / 'Next: reach ...' must follow the endless pages (BEYOND II, III...).
function loadUtilsWith(files, names) {
  const context = vm.createContext({ Phaser: { Scene: class {} }, console });
  for (const file of files) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), context, { filename: file });
  }
  return vm.runInContext('({ ' + names.join(', ') + ' })', context);
}

test('zones past BEYOND are named by zoneAt, not clamped', () => {
  const z = loadUtilsWith(['src/config.js', 'src/orbit.js', 'src/utils.js'], ['uiZone', 'uiClampZoneIndex', 'ZONES']);
  const last = z.ZONES.length - 1;
  assert.strictEqual(z.uiZone(last).name, 'BEYOND');
  assert.strictEqual(z.uiClampZoneIndex(last + 1), last + 1);
  assert.strictEqual(z.uiZone(last + 1).name, 'BEYOND II');
  assert.strictEqual(z.uiZone(last + 2, true).name, 'BEYOND III');
  assert.strictEqual(z.uiClampZoneIndex(-3), 0);
});

test('without zoneAt the fixed list is clamped and strict lookups past it are undefined', () => {
  const z = loadUtilsWith(['src/config.js', 'src/utils.js'], ['uiZone', 'uiClampZoneIndex']);
  // No orbit.js loaded: no ZONES either, so it must not throw.
  assert.strictEqual(z.uiZone(3, true), undefined);
  assert.strictEqual(typeof z.uiZone(3).name, 'string');
  assert.strictEqual(z.uiClampZoneIndex(7), 7);
});
