// Run with: node --test tests/progress.test.js
const test = require('node:test');
const assert = require('node:assert');
const P = require('../src/progress.js');
const orbit = require('../src/orbit.js');
const cards = require('../src/cards.js');

// In-memory localStorage stand-in.
function memoryStore(initial) {
  const data = Object.assign({}, initial || {});
  return {
    data,
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => { data[k] = String(v); },
  };
}
const throwingStore = {
  getItem() { throw new Error('SecurityError'); },
  setItem() { throw new Error('SecurityError'); },
};
function fresh(store) {
  const s = store || memoryStore();
  return { p: P.createProgress(() => s).load(), store: s };
}
// One whole run: events then endRun.
function playRun(p, opts) {
  const o = Object.assign({ catches: 0, altitude: 0, speed: 0, chain: 0, cards: [], closeCalls: 0, warps: 0, wallKicks: 0, setBonuses: 0, secondWinds: 0 }, opts);
  p.startRun();
  for (let i = 0; i < o.catches; i++) p.report('catch');
  for (let i = 1; i <= o.chain; i++) p.report('perfect', i);
  if (o.speed) p.report('speed', o.speed);
  if (o.altitude) p.report('altitude', o.altitude);
  for (const id of o.cards) p.report('card', id);
  for (let i = 0; i < o.closeCalls; i++) p.report('closecall');
  for (let i = 0; i < o.warps; i++) p.report('warp');
  for (let i = 0; i < o.wallKicks; i++) p.report('wallkick');
  for (let i = 0; i < o.setBonuses; i++) p.report('setbonus', 'orbit');
  for (let i = 0; i < o.secondWinds; i++) p.report('secondwind');
  return p.endRun({ score: o.altitude * 2, altitude: o.altitude, topSpeedKmh: o.speed, maxChain: o.chain, zoneIndex: 0, seconds: 30, cards: o.cards });
}

test('mission pool: 18-24 unique, tiered easy -> hard, short English text, sane rewards', () => {
  const pool = P.MISSION_POOL;
  assert.ok(pool.length >= 18 && pool.length <= 24, String(pool.length));
  assert.strictEqual(new Set(pool.map((m) => m.id)).size, pool.length);
  for (let i = 1; i < pool.length; i++) assert.ok(pool[i].tier >= pool[i - 1].tier, 'ordered by tier: ' + pool[i].id);
  for (const m of pool) {
    assert.ok(m.text.length <= 26 && /^[A-Za-z0-9 ,/]+$/.test(m.text), m.text);
    assert.ok(m.goal > 0 && ['run', 'total'].indexOf(m.kind) >= 0, m.id);
    const reward = P.MISSION_REWARDS[m.tier];
    assert.ok(reward >= 25 && reward <= 150, m.id);
  }
  // The pool pays for every skin (with some to spare).
  const poolCoins = pool.reduce((n, m) => n + P.MISSION_REWARDS[m.tier], 0);
  const skinCoins = P.SKINS.reduce((n, s) => n + s.price, 0);
  assert.ok(poolCoins >= skinCoins, poolCoins + ' < ' + skinCoins);
});

test('zone altitude missions match ZONES in orbit.js', () => {
  assert.deepStrictEqual(P.PROGRESS_ZONE_FROM, orbit.ZONES.map((z) => z.from));
  const byName = { orbit: 'ORBIT', hypersonic: 'HYPERSONIC', warp: 'WARP SPEED', hyperspace: 'HYPERSPACE', escape: 'ESCAPE VELOCITY' };
  for (const id of Object.keys(byName)) {
    const m = P.MISSION_POOL.find((x) => x.id === id);
    const zone = orbit.ZONES.find((z) => z.name === byName[id]);
    assert.strictEqual(m.goal, zone.from, id);
    assert.ok(m.text.indexOf(byName[id]) >= 0);
  }
});

test('starts with 3 active missions, the first of the pool, with full fields', () => {
  const { p } = fresh();
  const active = p.activeMissions();
  assert.strictEqual(active.length, 3);
  assert.deepStrictEqual(active.map((m) => m.id), P.MISSION_POOL.slice(0, 3).map((m) => m.id));
  for (const m of active) {
    assert.deepStrictEqual(Object.keys(m).sort(), ['done', 'goal', 'id', 'kind', 'progress', 'reward', 'text', 'tier']);
    assert.strictEqual(m.progress, 0);
    assert.strictEqual(m.done, false);
  }
  assert.strictEqual(p.coins(), 0);
});

test('run progress shows live during a run and counts only within that run', () => {
  const { p } = fresh();
  p.startRun();
  p.report('catch'); p.report('catch'); p.report('catch');
  const catch5 = () => p.activeMissions().find((m) => m.id === 'catch5');
  assert.strictEqual(catch5().progress, 3);
  assert.strictEqual(catch5().done, false);
  p.report('catch'); p.report('catch');
  assert.strictEqual(catch5().done, true, 'done shows live');
  assert.strictEqual(p.coins(), 0, 'coins only arrive at endRun');
  const r = p.endRun({ altitude: 100, topSpeedKmh: 90 });
  assert.deepStrictEqual(r.completed.map((m) => m.id), ['catch5']);
  assert.strictEqual(r.coinsEarned, 25);
  assert.strictEqual(r.coinsTotal, 25);
  assert.strictEqual(p.coins(), 25);
  // Replaced by the next unfinished mission in pool order.
  assert.deepStrictEqual(r.newMissions.map((m) => m.id), ['combo3']);
  assert.deepStrictEqual(p.activeMissions().map((m) => m.id), ['speed150', 'orbit', 'combo3']);
  // A run mission does not add up across runs: two runs at 120 km/s never make 150.
  playRun(p, { speed: 120 });
  playRun(p, { speed: 120 });
  const speed = p.activeMissions().find((m) => m.id === 'speed150');
  assert.strictEqual(speed.done, false);
  assert.strictEqual(speed.progress, 120, 'shows the best attempt');
});

test('several missions complete in one run and all get replaced', () => {
  const { p } = fresh();
  const r = playRun(p, { catches: 8, speed: 200, altitude: 700 });
  assert.deepStrictEqual(r.completed.map((m) => m.id).sort(), ['catch5', 'orbit', 'speed150']);
  assert.strictEqual(r.coinsEarned, 75);
  assert.strictEqual(r.newMissions.length, 3);
  assert.deepStrictEqual(p.activeMissions().map((m) => m.id), ['combo3', 'catch50', 'hypersonic']);
  assert.ok(p.activeMissions().every((m) => !m.done && m.progress === 0 || m.kind === 'total'));
});

test('a mission that becomes active at game over does not count the run that just ended', () => {
  const { p } = fresh();
  const r = playRun(p, { catches: 8, speed: 200, altitude: 2000 });
  assert.ok(r.newMissions.some((m) => m.id === 'hypersonic'));
  const hyper = p.activeMissions().find((m) => m.id === 'hypersonic');
  assert.strictEqual(hyper.done, false);
  assert.strictEqual(hyper.progress, 0);
});

test('cumulative missions add up across runs from when they became active', () => {
  const { p } = fresh();
  playRun(p, { catches: 30, speed: 200, altitude: 700 });   // catch5/speed/orbit done -> catch50 now active
  const catch50 = () => p.activeMissions().find((m) => m.id === 'catch50');
  assert.strictEqual(catch50().progress, 0, 'catches before activation do not count');
  playRun(p, { catches: 20 });
  assert.strictEqual(catch50().progress, 20);
  p.startRun();
  for (let i = 0; i < 15; i++) p.report('catch');
  assert.strictEqual(catch50().progress, 35, 'live total during a run');
  p.endRun({});
  const r = playRun(p, { catches: 15 });
  assert.ok(r.completed.some((m) => m.id === 'catch50'));
});

test('perfect chain, close call, warp, set bonus, second wind and wall kick events', () => {
  const { p } = fresh();
  // Walk the active slots forward by finishing the first missions.
  playRun(p, { catches: 10, speed: 200, altitude: 700 });
  let r = playRun(p, { chain: 3, catches: 50 });
  assert.deepStrictEqual(r.completed.map((m) => m.id).sort(), ['catch50', 'combo3']);
  r = playRun(p, { altitude: 1600, speed: 320, cards: ['well', 'spin', 'aero'] });
  assert.deepStrictEqual(r.completed.map((m) => m.id).sort(), ['cards3', 'hypersonic', 'speed300']);
  r = playRun(p, { chain: 5, closeCalls: 1 });
  assert.deepStrictEqual(r.completed.map((m) => m.id).sort(), ['closecall', 'combo5']);
  assert.deepStrictEqual(p.activeMissions().map((m) => m.id), ['perfect25', 'secondwind', 'warp']);
  assert.strictEqual(p.activeMissions()[0].progress, 5, 'only PERFECTs since it became active');
  r = playRun(p, { secondWinds: 1, altitude: 3100 });
  assert.deepStrictEqual(r.completed.map((m) => m.id).sort(), ['secondwind', 'warp']);
  assert.deepStrictEqual(p.activeMissions().map((m) => m.id), ['perfect25', 'blackhole', 'setbonus']);
  r = playRun(p, { chain: 20, warps: 1, setBonuses: 1 });
  assert.deepStrictEqual(r.completed.map((m) => m.id).sort(), ['blackhole', 'perfect25', 'setbonus']);
  assert.deepStrictEqual(p.activeMissions().map((m) => m.id), ['combo10', 'speed450', 'beatbest']);
  r = playRun(p, { chain: 10, speed: 460, altitude: 3000 });   // 3000 m does not beat the 3100 m best
  assert.deepStrictEqual(r.completed.map((m) => m.id).sort(), ['combo10', 'speed450']);
  r = playRun(p, { altitude: 3200 });
  assert.deepStrictEqual(r.completed.map((m) => m.id), ['beatbest']);
  assert.deepStrictEqual(p.activeMissions().map((m) => m.id), ['wallkick3', 'hyperspace', 'speed600']);
  r = playRun(p, { wallKicks: 2 });
  assert.strictEqual(r.completed.length, 0);
  assert.strictEqual(p.activeMissions()[0].progress, 2);
  r = playRun(p, { wallKicks: 1 });
  assert.deepStrictEqual(r.completed.map((m) => m.id), ['wallkick3']);
});

test('summary fills in maxima when events were missed', () => {
  const { p } = fresh();
  p.startRun();
  const r = p.endRun({ altitude: 800, topSpeedKmh: 160, maxChain: 0, zoneIndex: 1, cards: [] });
  assert.deepStrictEqual(r.completed.map((m) => m.id).sort(), ['orbit', 'speed150']);
  // 'zone' event alone also counts as reaching that zone's altitude.
  p.startRun();
  p.report('zone', 2);
  const hyper = p.activeMissions().find((m) => m.id === 'hypersonic');
  assert.strictEqual(hyper, undefined, 'hypersonic is not active yet');
});

test('report outside a run is ignored and never throws; unknown events are harmless', () => {
  const { p } = fresh();
  p.report('catch');
  p.report('nonsense', 5);
  p.report('speed', NaN);
  p.startRun();
  p.report('nonsense');
  p.report('speed', 'fast');
  p.report('perfect');   // missing chain value counts as a chain of 1
  assert.strictEqual(p.activeMissions()[0].progress, 0);
  p.endRun();
});

test('beat your best: first-ever run counts, later runs must top the best from before the run', () => {
  const { p } = fresh();
  playRun(p, { altitude: 900 });
  assert.strictEqual(p.bestAltitude(), 900);
  const r1 = playRun(p, { altitude: 800 });
  assert.strictEqual(r1.newBest, false);
  const r2 = playRun(p, { altitude: 901 });
  assert.strictEqual(r2.newBest, true);
  assert.strictEqual(p.bestAltitude(), 901);
});

test('mid-skill player: 1-2 missions per early run and the first skin within 3-5 runs', () => {
  // Rough human-ish runs (altitude m, top km/s, max chain, catches), from weaker than the sim's
  // 'mid' bot up to it (see playtestSummary): a new player gets a bit better each run.
  const runs = [
    { altitude: 420, speed: 140, chain: 1, catches: 6 },
    { altitude: 650, speed: 170, chain: 2, catches: 9 },
    { altitude: 1200, speed: 230, chain: 3, catches: 15 },
    { altitude: 1900, speed: 280, chain: 2, catches: 22, cards: ['well', 'aero'] },
    { altitude: 2600, speed: 310, chain: 2, catches: 28, cards: ['well', 'aero', 'sling'] },
  ];
  const { p } = fresh();
  let firstSkinRun = null;
  const perRun = [];
  runs.forEach((run, i) => {
    const r = playRun(p, run);
    perRun.push(r.completed.length);
    if (firstSkinRun === null && p.coins() >= P.SKINS[1].price) firstSkinRun = i + 1;
  });
  assert.ok(perRun.slice(0, 3).every((n) => n >= 1 && n <= 2), 'early runs complete 1-2: ' + perRun);
  assert.ok(firstSkinRun >= 3 && firstSkinRun <= 5, 'first skin after run ' + firstSkinRun);
});

test('skins: classic is free and equipped, others cost coins, buy/equip rules', () => {
  const { p } = fresh();
  const skins = p.skins();
  assert.ok(skins.length >= 6);
  assert.strictEqual(skins[0].id, 'classic');
  assert.strictEqual(skins[0].price, 0);
  assert.ok(skins[0].owned && skins[0].equipped);
  for (let i = 2; i < skins.length; i++) assert.ok(skins[i].price > skins[i - 1].price, 'prices rise');
  assert.strictEqual(p.equippedSkin().id, 'classic');
  assert.strictEqual(p.buySkin('ice'), false, 'too poor');
  assert.strictEqual(p.equipSkin('ice'), false, 'not owned');
  assert.strictEqual(p.equippedSkin().id, 'classic');
  playRun(p, { catches: 8, speed: 200, altitude: 700 });   // +75
  playRun(p, { chain: 3 });                                // +25 -> 100
  assert.strictEqual(p.coins(), 100);
  assert.strictEqual(p.buySkin('nope'), false);
  assert.strictEqual(p.buySkin('ice'), true);
  assert.strictEqual(p.coins(), 0);
  assert.strictEqual(p.buySkin('ice'), false, 'already owned');
  assert.strictEqual(p.equippedSkin().id, 'classic', 'buying does not equip');
  assert.strictEqual(p.equipSkin('ice'), true);
  assert.strictEqual(p.equippedSkin().id, 'ice');
  assert.strictEqual(p.skins().filter((s) => s.equipped).length, 1);
  assert.strictEqual(p.equipSkin('classic'), true);
  // Returned colors are copies: callers cannot repaint the catalog.
  p.equippedSkin().colors.head = 0;
  assert.notStrictEqual(p.equippedSkin().colors.head, 0);
});

// WCAG relative luminance contrast.
function lum(c) {
  const ch = [(c >> 16) & 255, (c >> 8) & 255, c & 255].map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}
function contrast(a, b) {
  const la = lum(a);
  const lb = lum(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

test('skin colors read on every zone page and keep the dark face lines readable', () => {
  const papers = orbit.ZONES.map((z) => z.paper);
  const faceInk = 0x2a2018;
  for (const s of P.SKINS) {
    const c = s.colors;
    for (const key of ['head', 'flame', 'trail']) assert.strictEqual(typeof c[key], 'number', s.id + '.' + key);
    // Face is drawn in dark ink on the head.
    assert.ok(contrast(c.head, faceInk) >= 7, s.id + ' head vs face ' + contrast(c.head, faceInk).toFixed(2));
    for (const paper of papers) {
      if (lum(paper) > 0.5) continue;   // cream page: the art adds a dark pencil edge to tail and head
      for (const key of ['head', 'flame', 'trail']) {
        const k = contrast(c[key], paper);
        assert.ok(k >= 2.5, s.id + '.' + key + ' on ' + paper.toString(16) + ': ' + k.toFixed(2));
      }
    }
  }
});

test('storage blocked: everything works for the session and nothing throws', () => {
  const p = P.createProgress(() => throwingStore).load();
  assert.strictEqual(p.activeMissions().length, 3);
  playRun(p, { catches: 8, speed: 200, altitude: 700 });
  playRun(p, { chain: 3 });
  assert.strictEqual(p.coins(), 100);
  assert.strictEqual(p.buySkin('ice'), true);
  assert.strictEqual(p.equipSkin('ice'), true);
  assert.strictEqual(p.equippedSkin().id, 'ice');
  assert.strictEqual(p.save(), false);
  assert.ok(p.saveGhost([{ t: 0, x: 1, y: 2 }, { t: 1, x: 3, y: 4 }]));
  assert.strictEqual(p.loadGhost().length, 2);
  // A storage getter that itself throws (localStorage access denied) is fine too.
  const q = P.createProgress(() => { throw new Error('denied'); }).load();
  assert.strictEqual(q.activeMissions().length, 3);
  playRun(q, { catches: 5 });
  assert.strictEqual(q.coins(), 25);
});

test('no storage at all (node, null getter)', () => {
  const p = P.createProgress(null).load();
  assert.strictEqual(p.save(), false);
  assert.strictEqual(p.activeMissions().length, 3);
  assert.strictEqual(P.PROGRESS.activeMissions().length, 3, 'global PROGRESS loads without localStorage');
});

test('corrupt or foreign JSON recovers to a fresh state', () => {
  for (const bad of ['{not json', 'null', '42', '"x"', '[]', JSON.stringify({ v: 99, coins: 999 }),
    JSON.stringify({ v: 1, coins: 'lots', owned: 'all', active: 'x', totals: null, discovered: [1, 2], ghost: { points: 'no' } })]) {
    const store = memoryStore({ [P.PROGRESS_STORAGE_KEY]: bad });
    const p = P.createProgress(() => store).load();
    assert.strictEqual(p.coins(), 0, bad);
    assert.strictEqual(p.activeMissions().length, 3, bad);
    assert.strictEqual(p.equippedSkin().id, 'classic', bad);
    assert.deepStrictEqual(p.discovered(), [], bad);
    assert.strictEqual(p.loadGhost(), null, bad);
    playRun(p, { catches: 5 });
    assert.strictEqual(p.coins(), 25);
    assert.doesNotThrow(() => JSON.parse(store.data[P.PROGRESS_STORAGE_KEY]), 'overwritten with valid JSON');
  }
});

test('tampered fields are sanitized: unknown skins/missions dropped, equip falls back to an owned skin', () => {
  const store = memoryStore({ [P.PROGRESS_STORAGE_KEY]: JSON.stringify({
    v: 1, coins: -50, owned: ['gold', 'fake'], equipped: 'fake',
    active: [{ id: 'fake' }, { id: 'combo3', best: 2 }, { id: 'combo3', best: 1 }], completed: ['catch5', 'zzz'],
    discovered: ['well', 'well', 'notacard'], bestAltitude: 'high',
  }) });
  const p = P.createProgress(() => store).load();
  assert.strictEqual(p.coins(), 0);
  assert.deepStrictEqual(p.skins().filter((s) => s.owned).map((s) => s.id), ['classic', 'gold']);
  assert.strictEqual(p.equippedSkin().id, 'classic');
  assert.deepStrictEqual(p.activeMissions().map((m) => m.id), ['combo3', 'speed150', 'orbit']);
  assert.strictEqual(p.activeMissions()[0].progress, 2);
  assert.deepStrictEqual(p.discovered(), ['well']);
  assert.strictEqual(p.bestAltitude(), 0);
});

test('save/load round trip keeps coins, skins, missions, totals, discoveries and the ghost', () => {
  const { p, store } = fresh();
  playRun(p, { catches: 30, speed: 200, altitude: 700, cards: ['well'] });
  playRun(p, { catches: 10, chain: 3 });
  p.buySkin('ice');
  p.equipSkin('ice');
  p.saveGhost([{ t: 0, x: 0, y: 0 }, { t: 0.5, x: 10, y: -50 }, { t: 1, x: 20, y: -100 }], 700);
  const keys = Object.keys(store.data);
  assert.deepStrictEqual(keys, [P.PROGRESS_STORAGE_KEY], 'one single key');
  const q = P.createProgress(() => store).load();
  assert.strictEqual(q.coins(), p.coins());
  assert.strictEqual(q.equippedSkin().id, 'ice');
  assert.deepStrictEqual(q.activeMissions(), p.activeMissions());
  assert.deepStrictEqual(q.discovered(), ['well']);
  assert.deepStrictEqual(q.loadGhost(), p.loadGhost());
  assert.strictEqual(q.bestAltitude(), 700);
});

test('card discovery: offered or picked cards are found once, committed at endRun', () => {
  const { p, store } = fresh();
  assert.deepStrictEqual(p.discovered(), []);
  p.startRun();
  p.report('cardOffered', ['well', 'spin', 'aero']);
  p.report('card', 'spin');
  p.report('cardOffered', ['spin', 'bogus', 'chain']);
  assert.deepStrictEqual(p.discovered(), [], 'nothing saved mid-run (headless runs never commit)');
  const r = p.endRun({ altitude: 600, cards: ['spin'] });
  assert.deepStrictEqual(r.newlyDiscovered, ['well', 'spin', 'aero', 'chain']);
  assert.deepStrictEqual(p.discovered(), ['well', 'spin', 'aero', 'chain']);
  const r2 = playRun(p, { cards: ['spin', 'armor'] });
  assert.deepStrictEqual(r2.newlyDiscovered, ['armor']);
  // Outside a run discoverCards saves at once.
  p.discoverCards(['shockwave', 'shockwave', 'fake']);
  assert.ok(p.discovered().indexOf('shockwave') >= 0);
  assert.ok(JSON.parse(store.data[P.PROGRESS_STORAGE_KEY]).discovered.indexOf('shockwave') >= 0);
  // Never more than the 12 cards.
  p.discoverCards(cards.CARDS.map((c) => c.id));
  assert.strictEqual(p.discovered().length, 12);
});

test('a run that never ends (headless sim) leaves saved progress untouched', () => {
  const { p, store } = fresh();
  playRun(p, { catches: 5 });
  const before = store.data[P.PROGRESS_STORAGE_KEY];
  p.startRun();
  for (let i = 0; i < 100; i++) p.report('catch');
  p.report('speed', 900);
  p.report('cardOffered', ['well', 'spin', 'aero']);
  p.startRun();   // the next (headless) run starts: the old one is dropped
  assert.strictEqual(store.data[P.PROGRESS_STORAGE_KEY], before);
  assert.deepStrictEqual(p.discovered(), []);
  const r = p.endRun({});
  assert.strictEqual(r.completed.length, 0);
  assert.deepStrictEqual(r.newlyDiscovered, []);
});

test('ghost: downsampled to ~10 points/s, capped, ends kept, only the best kept', () => {
  const { p, store } = fresh();
  assert.strictEqual(p.loadGhost(), null);
  // 3 minutes at 60 fps.
  const pts = [];
  for (let i = 0; i <= 180 * 60; i++) pts.push({ t: i / 60, x: 360 + Math.sin(i / 50) * 200, y: -i * 3 });
  assert.ok(p.saveGhost(pts, 5000));
  const g = p.loadGhost();
  assert.ok(g.length <= P.GHOST_MAX_POINTS && g.length >= P.GHOST_MAX_POINTS - 1, String(g.length));
  assert.strictEqual(g[0].t, 0);
  assert.ok(Math.abs(g[g.length - 1].t - 180) < 0.01, 'last point kept');
  for (let i = 1; i < g.length; i++) assert.ok(g[i].t > g[i - 1].t, 'time increases');
  assert.ok(store.data[P.PROGRESS_STORAGE_KEY].length < 40000, 'compact: ' + store.data[P.PROGRESS_STORAGE_KEY].length);
  // A short run at 60 fps keeps one point per 0.1 s.
  const { p: q } = fresh();
  const short = [];
  for (let i = 0; i <= 10 * 60; i++) short.push({ t: i / 60, x: i, y: -i });
  q.saveGhost(short);
  const sg = q.loadGhost();
  assert.ok(sg.length >= 95 && sg.length <= 102, String(sg.length));
  for (let i = 1; i < sg.length; i++) assert.ok(sg[i].t - sg[i - 1].t >= 0.05);
  // A worse run does not replace the best ghost; a better one does.
  assert.strictEqual(p.saveGhost([{ t: 0, x: 0, y: 0 }, { t: 1, x: 1, y: 1 }], 4000), false);
  assert.strictEqual(p.loadGhost().length, g.length);
  assert.strictEqual(p.saveGhost([{ t: 0, x: 0, y: 0 }, { t: 1, x: 1, y: 1 }], 6000), true);
  assert.strictEqual(p.loadGhost().length, 2);
  // Garbage in: rejected, old ghost kept.
  assert.strictEqual(p.saveGhost(null, 9999), false);
  assert.strictEqual(p.saveGhost([{ t: 0, x: NaN, y: 0 }, { t: 'a', x: 1, y: 1 }], 9999), false);
  assert.strictEqual(p.loadGhost().length, 2);
});

test('the pool loops after every mission is done, always 3 active', () => {
  const { p } = fresh();
  const huge = { catches: 400, altitude: 60000, speed: 800, chain: 30, cards: ['well', 'spin', 'aero'], closeCalls: 1, warps: 1, wallKicks: 3, setBonuses: 1, secondWinds: 1 };
  let earned = 0;
  for (let i = 0; i < 12; i++) {
    earned += playRun(p, Object.assign({}, huge, { altitude: 60000 + i })).coinsEarned;
    assert.strictEqual(p.activeMissions().length, 3);
    assert.strictEqual(new Set(p.activeMissions().map((m) => m.id)).size, 3);
  }
  assert.ok(earned > P.MISSION_POOL.reduce((n, m) => n + P.MISSION_REWARDS[m.tier], 0), 'kept paying after one full pass');
  assert.strictEqual(p.coins(), earned);
});

test('reset clears everything', () => {
  const { p } = fresh();
  playRun(p, { catches: 5, cards: ['well'] });
  p.reset();
  assert.strictEqual(p.coins(), 0);
  assert.deepStrictEqual(p.discovered(), []);
  assert.strictEqual(p.activeMissions()[0].id, 'catch5');
});
