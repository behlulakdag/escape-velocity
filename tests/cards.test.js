// Run with: node --test tests/cards.test.js
const test = require('node:test');
const assert = require('node:assert');
const c = require('../src/cards.js');

// Deterministic rand() for repeatable draws.
function seeded(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

test('12 cards, 3 per family, one of each rarity, unique ids and icons', () => {
  assert.strictEqual(c.CARDS.length, 12);
  const ids = new Set(c.CARDS.map((x) => x.id));
  assert.strictEqual(ids.size, 12);
  assert.strictEqual(new Set(c.CARDS.map((x) => x.icon)).size, 12);
  for (const family of Object.keys(c.CARD_FAMILIES)) {
    const cards = c.CARDS.filter((x) => x.family === family);
    assert.strictEqual(cards.length, 3, family);
    assert.deepStrictEqual(cards.map((x) => x.rarity).sort(), ['common', 'legendary', 'rare']);
    assert.ok(c.SET_BONUSES[family].name && c.SET_BONUSES[family].desc);
    assert.strictEqual(typeof c.CARD_FAMILIES[family].color, 'number');
  }
});

test('card descriptions are at most 6 words', () => {
  for (const card of c.CARDS) assert.ok(card.desc.split(/\s+/).length <= 6, card.desc);
  for (const f of Object.keys(c.SET_BONUSES)) assert.ok(c.SET_BONUSES[f].desc.split(/\s+/).length <= 6, f);
});

test('the contract icon keys are all present', () => {
  const icons = c.CARDS.map((x) => x.icon).sort();
  assert.deepStrictEqual(icons, ['afterburner', 'aero', 'armor', 'chain', 'heatshield', 'overdrive', 'perfect', 'shockwave', 'sling', 'spin', 'wallkick', 'well'].sort());
});

test('drawCardChoices returns 3 distinct unowned ids', () => {
  const rand = seeded(1);
  for (let i = 0; i < 500; i++) {
    const owned = c.drawCardChoices([], rand).slice(0, i % 3);
    const picks = c.drawCardChoices(owned, rand);
    assert.strictEqual(picks.length, 3);
    assert.strictEqual(new Set(picks).size, 3);
    for (const id of picks) {
      assert.ok(c.cardById(id), id);
      assert.ok(owned.indexOf(id) < 0, 'never an owned card');
    }
  }
});

test('drawCardChoices returns what is left when fewer than 3 cards remain', () => {
  const all = c.CARDS.map((x) => x.id);
  assert.deepStrictEqual(c.drawCardChoices(all.slice(0, 10), Math.random).sort(), all.slice(10).sort());
  assert.deepStrictEqual(c.drawCardChoices(all, Math.random), []);
});

test('drawCardChoices is rarity weighted: commons show up most, legendaries least', () => {
  const rand = seeded(42);
  const seen = { common: 0, rare: 0, legendary: 0 };
  for (let i = 0; i < 4000; i++) {
    for (const id of c.drawCardChoices([], rand)) seen[c.cardById(id).rarity]++;
  }
  assert.ok(seen.common > seen.rare, JSON.stringify(seen));
  assert.ok(seen.rare > seen.legendary, JSON.stringify(seen));
  assert.ok(seen.legendary > 0);
});

test('drawCardChoices is deterministic for the same rand', () => {
  assert.deepStrictEqual(c.drawCardChoices(['well'], seeded(7)), c.drawCardChoices(['well'], seeded(7)));
});

test('no cards = neutral mods (base game unchanged)', () => {
  const m = c.cardMods([]);
  assert.strictEqual(m.count, 0);
  assert.strictEqual(m.grabRangeMul, 1);
  assert.strictEqual(m.closeOrbitMul, 1);
  assert.strictEqual(m.orbitGainMul, 1);
  assert.strictEqual(m.releaseBonus, 0);
  assert.strictEqual(m.perfectAngle, null);
  assert.strictEqual(m.chainSpeed, 0);
  assert.strictEqual(m.chainScoreMul, 1);
  assert.strictEqual(m.flightDecayMul, 1);
  assert.strictEqual(m.afterburnerSeconds, 0);
  assert.strictEqual(m.wallKick, false);
  assert.strictEqual(m.climbNoDecay, false);
  assert.strictEqual(m.heatShieldCharges, 0);
  assert.strictEqual(m.tailArmor, false);
  assert.strictEqual(m.shockwavePush, 0);
  assert.strictEqual(m.catchBurst, 0);
  assert.strictEqual(m.rescues, 0);
  assert.strictEqual(m.novaSpeedMul, 1);
  assert.deepStrictEqual(c.cardMods(undefined), m);
});

test('each card changes its own mod', () => {
  const T = c.CARD_TUNING;
  assert.strictEqual(c.cardMods(['well']).grabRangeMul, T.grabRangeMul);
  assert.strictEqual(c.cardMods(['spin']).closeOrbitMul, T.closeOrbitMul);
  assert.strictEqual(c.cardMods(['overdrive']).orbitGainMul, T.orbitGainMul);
  assert.strictEqual(c.cardMods(['sling']).releaseBonus, T.releaseBonus);
  assert.strictEqual(c.cardMods(['perfect']).perfectAngle, T.perfectAngleWide);
  assert.strictEqual(c.cardMods(['chain']).chainSpeed, T.chainSpeed);
  assert.strictEqual(c.cardMods(['aero']).flightDecayMul, T.flightDecayMul);
  assert.strictEqual(c.cardMods(['afterburner']).afterburnerSeconds, T.afterburnerSeconds);
  assert.strictEqual(c.cardMods(['wallkick']).wallKick, true);
  assert.strictEqual(c.cardMods(['heatshield']).heatShieldCharges, T.heatShieldCharges);
  assert.strictEqual(c.cardMods(['armor']).tailArmor, true);
  assert.strictEqual(c.cardMods(['shockwave']).shockwavePush, T.shockwavePush);
});

test('mods are stronger than the base (cards are upgrades)', () => {
  assert.ok(c.CARD_TUNING.grabRangeMul > 1);
  assert.ok(c.CARD_TUNING.flightDecayMul < 1);
  assert.ok(c.CARD_TUNING.perfectAngleWide > 0.12);
  assert.ok(c.CARD_TUNING.perfectAngleSet > c.CARD_TUNING.perfectAngleWide);
});

test('set bonus needs 2 cards of the same family', () => {
  assert.deepStrictEqual(c.activeSetBonuses([]), []);
  assert.deepStrictEqual(c.activeSetBonuses(['well', 'sling', 'aero', 'armor']), []);
  assert.deepStrictEqual(c.activeSetBonuses(['well', 'spin']), ['orbit']);
  assert.deepStrictEqual(c.activeSetBonuses(['armor', 'aero', 'shockwave', 'wallkick']), ['flight', 'shield']);
  assert.deepStrictEqual(c.activeSetBonuses(['well', 'spin', 'overdrive']), ['orbit']);
  assert.deepStrictEqual(c.activeSetBonuses(['nope', 'nope2']), []);
});

test('set bonuses switch on their mods', () => {
  const T = c.CARD_TUNING;
  assert.strictEqual(c.cardMods(['well']).catchBurst, 0);
  assert.strictEqual(c.cardMods(['well', 'overdrive']).catchBurst, T.catchBurst);
  assert.strictEqual(c.cardMods(['aero']).climbNoDecay, false);
  assert.strictEqual(c.cardMods(['aero', 'wallkick']).climbNoDecay, true);
  assert.strictEqual(c.cardMods(['armor']).rescues, 0);
  assert.strictEqual(c.cardMods(['armor', 'heatshield']).rescues, T.rescues);
});

test('Sharpshooter widens PERFECT further and doubles the chain bonus', () => {
  const T = c.CARD_TUNING;
  assert.strictEqual(c.cardMods(['perfect', 'sling']).perfectAngle, T.perfectAngleSet);
  // Without Wide Perfect the set still widens the window to the wide value.
  assert.strictEqual(c.cardMods(['sling', 'chain']).perfectAngle, T.perfectAngleWide);
  assert.strictEqual(c.cardMods(['sling', 'chain']).chainSpeed, T.chainSpeed * 2);
  assert.strictEqual(c.cardMods(['sling', 'chain']).chainScoreMul, 2);
  assert.strictEqual(c.cardMods(['chain']).chainScoreMul, 1);
});

test('every card makes the supernova faster', () => {
  let prev = c.cardMods([]).novaSpeedMul;
  const owned = [];
  for (const card of c.CARDS) {
    owned.push(card.id);
    const next = c.cardMods(owned).novaSpeedMul;
    assert.ok(next > prev, card.id);
    prev = next;
  }
  assert.ok(Math.abs(c.cardMods(['well', 'aero']).novaSpeedMul - (1 + 2 * c.CARD_TUNING.novaPerCard)) < 1e-9);
  assert.ok(c.CARD_TUNING.novaPerCard >= 0.04 && c.CARD_TUNING.novaPerCard <= 0.06);
});

test('unknown ids are ignored', () => {
  assert.deepStrictEqual(c.cardMods(['bogus']), c.cardMods([]));
  assert.deepStrictEqual(c.familyCounts(['well', 'bogus', 'armor']), { orbit: 1, fling: 0, flight: 0, shield: 1 });
});
