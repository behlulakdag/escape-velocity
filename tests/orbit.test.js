// Run with: node --test tests/orbit.test.js
const test = require('node:test');
const assert = require('node:assert');
const o = require('../src/orbit.js');

test('latching keeps the comet moving the same way', () => {
  // Planet at origin, comet to the right moving up (screen y down => vy negative).
  const orbit = o.startOrbit(0, 0, 150, 0, 0, -600, 60);
  const v = o.tangentVelocity(orbit, 600);
  assert.ok(v.vy < 0, 'should still move up right after latching');
  assert.ok(Math.abs(v.vx) < 1e-6);
});

test('latching too close starts in place, then eases out to the minimum orbit', () => {
  let orbit = o.startOrbit(0, 0, 70, 0, 0, -600, 60);
  assert.strictEqual(orbit.radius, 70, 'no snap on the grab frame');
  for (let i = 0; i < 60; i++) orbit = o.orbitStep(orbit, 600, 1 / 60, 60).orbit;
  assert.strictEqual(orbit.radius, 60 + o.TUNING.minOrbitGap);
});

test('steerToward turns by at most maxTurn and keeps speed', () => {
  const v = o.steerToward(0, -500, 1, 0, 0.1);
  assert.ok(Math.abs(Math.atan2(v.vy, v.vx) - (-Math.PI / 2 + 0.1)) < 1e-9);
  assert.ok(Math.abs(Math.hypot(v.vx, v.vy) - 500) < 1e-9);
  const done = o.steerToward(0, -500, 0, -1, 0.1);
  assert.ok(Math.abs(done.vx) < 1e-9 && Math.abs(done.vy + 500) < 1e-9);
});

test('orbiting gains speed and the orbit stays stable', () => {
  const orbit = o.startOrbit(0, 0, 200, 0, 0, -600, 60);
  const step = o.orbitStep(orbit, 600, 1, 60);
  assert.ok(step.speed > 600);
  assert.strictEqual(step.orbit.radius, orbit.radius);
});

test('closer orbits gain speed faster', () => {
  const close = o.startOrbit(0, 0, 60 + o.TUNING.minOrbitGap, 0, 0, -600, 60);
  const far = o.startOrbit(0, 0, 60 + o.TUNING.grabRange, 0, 0, -600, 60);
  assert.strictEqual(o.orbitCloseness(close.radius, 60), 1);
  assert.strictEqual(o.orbitCloseness(far.radius, 60), 0);
  assert.ok(o.orbitStep(close, 600, 0.5, 60).speed > o.orbitStep(far, 600, 0.5, 60).speed);
});

test('speed never exceeds the cap', () => {
  const orbit = o.startOrbit(0, 0, 200, 0, 0, -600, 60);
  assert.strictEqual(o.orbitStep(orbit, o.TUNING.maxSpeed, 5, 0).speed, o.TUNING.maxSpeed);
});

test('flight decay ramps with altitude and is capped', () => {
  assert.ok(o.flightDecay(5000) > o.flightDecay(0));
  assert.strictEqual(o.flightDecay(1e9), o.TUNING.maxFlightDecay);
});

test('speed fraction and color ends', () => {
  assert.strictEqual(o.speedFraction(0), 0);
  assert.strictEqual(o.speedFraction(1e6), 1);
  assert.strictEqual(o.speedColor(0), 0x8a8aa0);
  assert.strictEqual(o.speedColor(1), 0x8fe3ff);
});

test('assist steers a slightly-off release onto the planet ahead', () => {
  const planet = { x: 0, y: -600, radius: 70 };
  // Aimed straight up but offset 150px to the side: misses without help.
  const hit = o.pickAssistTarget(150, 0, 0.2, -1, [planet], null);
  assert.ok(hit, 'should find the planet');
  assert.strictEqual(hit.planet, planet);
  const passDist = Math.hypot(hit.aimX - planet.x, hit.aimY - planet.y);
  assert.ok(passDist > planet.radius + o.TUNING.cometRadius, 'aim point must not be inside the planet');
  assert.ok(passDist < planet.radius + o.TUNING.grabRange, 'aim point must be catchable');
});

test('assist ignores planets behind, far away, or the one being left', () => {
  const behind = { x: 0, y: 600, radius: 70 };
  const far = { x: 0, y: -5000, radius: 70 };
  const current = { x: 0, y: -500, radius: 70 };
  assert.strictEqual(o.pickAssistTarget(0, 0, 0, -1, [behind, far], null), null);
  assert.strictEqual(o.pickAssistTarget(0, 0, 0, -1, [current], current), null);
});

test('a hit costs speed but never drops you to game over', () => {
  assert.strictEqual(o.speedAfterHit(1000, 0.7), 700);
  const slow = o.TUNING.minSpeed + 50;
  assert.strictEqual(o.speedAfterHit(slow, 0.7), slow, 'already slow: no further loss');
  const mid = o.TUNING.minSpeed + 200;
  assert.strictEqual(o.speedAfterHit(mid, 0.5), o.TUNING.minSpeed + o.TUNING.hitGrace);
  assert.ok(o.speedAfterHit(o.TUNING.minSpeed + 1, 0.1) >= o.TUNING.minSpeed);
});

test('planet layout zigzags, stays on screen and spreads out with altitude', () => {
  let seed = 1;
  const rand = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
  let side = 1;
  let switches = 0;
  const sizes = new Set();
  for (let i = 0; i < 200; i++) {
    const l = o.nextPlanetLayout(side, i * 500, 720, rand);
    assert.ok(l.x - l.radius >= 80 && l.x + l.radius <= 640, 'planet must fit with room to orbit');
    if (l.side !== side) switches++;
    side = l.side;
    sizes.add(l.radius);
  }
  assert.ok(switches > 120, 'mostly alternates sides');
  assert.strictEqual(sizes.size, o.PLANET_SIZES.length, 'all sizes appear');
  const low = o.nextPlanetLayout(1, 0, 720, () => 0.5).gap;
  const high = o.nextPlanetLayout(1, 1e7, 720, () => 0.5).gap;
  assert.strictEqual(low, o.TUNING.minPlanetGap);
  assert.strictEqual(high, o.TUNING.maxPlanetGap);
});

test('orbit spin is capped so fast orbits stay readable', () => {
  const orbit = { angle: 0, radius: 100, dir: 1 };
  const step = o.orbitStep(orbit, 2000, 0.1, 30);
  assert.ok(Math.abs(step.orbit.angle - o.orbitSpinCap(2000) * 0.1) < 1e-9);
  // The cap is maxOrbitSpin up to 450 km/s and grows above it, up to + orbitSpinBoost.
  assert.strictEqual(o.orbitSpinCap(800), o.TUNING.maxOrbitSpin);
  assert.strictEqual(o.orbitSpinCap(4500), o.TUNING.maxOrbitSpin, 'early game keeps the plain cap');
  assert.ok(o.orbitSpinCap(6000) > o.TUNING.maxOrbitSpin);
  assert.strictEqual(o.orbitSpinCap(o.TUNING.maxSpeed), o.TUNING.maxOrbitSpin + o.TUNING.orbitSpinBoost);
});

test('assist never steers toward planets below', () => {
  const below = { x: 0, y: 500, radius: 70 };
  assert.strictEqual(o.pickAssistTarget(0, 0, 0, 1, [below], null), null);
});

test('zones start at 0 and are found by altitude', () => {
  assert.strictEqual(o.ZONES[0].from, 0);
  assert.strictEqual(o.zoneIndexForAltitude(0), 0);
  assert.strictEqual(o.zoneIndexForAltitude(499), 0);
  assert.strictEqual(o.zoneIndexForAltitude(500), 1);
  // Endless pages past the last fixed one: one every 10,000 m.
  const last = o.ZONES.length - 1;
  assert.strictEqual(o.zoneIndexForAltitude(o.ZONES[last].from), last);
  assert.strictEqual(o.zoneIndexForAltitude(o.ZONES[last].from + 9999), last);
  assert.strictEqual(o.zoneIndexForAltitude(o.ZONES[last].from + 10000), last + 1);
  assert.strictEqual(o.zoneIndexForAltitude(1e9), last + Math.floor((1e9 - o.ZONES[last].from) / 10000));
  for (let i = 1; i < o.ZONES.length; i++) assert.ok(o.ZONES[i].from > o.ZONES[i - 1].from);
});

test('speed multiplier goes x1 at minimum to x5 at top speed', () => {
  assert.strictEqual(o.speedMultiplier(o.TUNING.minSpeed), 1);
  assert.strictEqual(o.speedMultiplier(o.TUNING.maxSpeed), 5);
  assert.ok(o.speedMultiplier(1400) > o.speedMultiplier(600));
});

test('black hole bends the path toward it without changing speed', () => {
  // Hole to the right, comet flying straight up.
  const v = o.blackHolePull(100, 0, 0, 0, 0, -800, 0.1);
  assert.ok(v.vx > 0, 'should bend toward the hole');
  assert.ok(Math.abs(Math.hypot(v.vx, v.vy) - 800) < 1e-6, 'speed unchanged');
  const far = o.blackHolePull(5000, 0, 0, 0, 0, -800, 0.1);
  assert.deepStrictEqual(far, { vx: 0, vy: -800 });
});

test('warp through a black hole turns the path ~60 degrees and keeps speed', () => {
  // Flying up (vy<0) with the hole slightly to the right: turn toward the right.
  const w = o.warpVelocity(10, -5, 0, 0, 0, -800);
  assert.ok(w.vx > 0);
  assert.ok(Math.abs(Math.hypot(w.vx, w.vy) - 800) < 1e-6);
  const angle = Math.acos((w.vx * 0 + w.vy * -800) / (800 * 800));
  assert.ok(Math.abs(angle - o.TUNING.blackHoleWarp) < 1e-6);
});

test('supernova speeds up over time and is capped', () => {
  assert.strictEqual(o.novaSpeed(0), o.TUNING.novaBaseSpeed);
  assert.ok(o.novaSpeed(30) > o.novaSpeed(0));
  // Time alone (no altitude) never lifts the wave past the first zone's top speed.
  assert.strictEqual(o.novaSpeed(1e6), o.TUNING.novaMaxSpeed);
});

test('PERFECT chain bonus grows with the chain and is capped', () => {
  assert.strictEqual(o.perfectChainBonus(0), 0);
  assert.strictEqual(o.perfectChainBonus(1), o.FEEL.chainBonus);
  assert.ok(o.perfectChainBonus(3) > o.perfectChainBonus(2));
  assert.strictEqual(o.perfectChainBonus(1000), o.FEEL.chainBonusMax);
});

test('close call arms near the supernova and fires once on escape', () => {
  let s = o.closeCallStep(false, 600);
  assert.deepStrictEqual(s, { armed: false, triggered: false });
  s = o.closeCallStep(s.armed, 150);
  assert.strictEqual(s.armed, true);
  s = o.closeCallStep(s.armed, 300);   // still close: nothing yet
  assert.deepStrictEqual(s, { armed: true, triggered: false });
  s = o.closeCallStep(s.armed, 500);
  assert.deepStrictEqual(s, { armed: false, triggered: true });
  s = o.closeCallStep(s.armed, 600);
  assert.strictEqual(s.triggered, false, 'fires only once');
});

test('slow motion holds low, then eases back to full speed', () => {
  assert.strictEqual(o.slowMoScale(0), o.FEEL.slowMoScale);
  const mid = o.slowMoScale(o.FEEL.slowMoHold + o.FEEL.slowMoEase / 2);
  assert.ok(mid > o.FEEL.slowMoScale && mid < 1);
  assert.strictEqual(o.slowMoScale(5), 1);
});

test('comet stretch is >= 1, grows with speed and acceleration, capped at 1.6', () => {
  assert.strictEqual(o.cometStretch(0, 0), 1);
  assert.ok(o.cometStretch(1, 0) > o.cometStretch(0.5, 0));
  assert.ok(o.cometStretch(0.5, 3000) > o.cometStretch(0.5, 0));
  assert.strictEqual(o.cometStretch(0.5, -5000), o.cometStretch(0.5, 0));
  assert.ok(o.cometStretch(1, 1e9) <= 1.6);
});

test('speed cap starts at the first zone cap, rises through every zone and never passes maxSpeed', () => {
  assert.strictEqual(o.maxSpeedForAltitude(0), o.ZONES[0].maxSpeed);
  assert.strictEqual(o.maxSpeedForAltitude(-50), o.ZONES[0].maxSpeed);
  for (const z of o.ZONES) assert.ok(Math.abs(o.maxSpeedForAltitude(z.from) - z.maxSpeed) < 1e-9, z.name);
  let prev = 0;
  for (let m = 0; m <= 30000; m += 250) {
    const cap = o.maxSpeedForAltitude(m);
    assert.ok(cap >= prev, 'cap never drops (at ' + m + ' m)');
    assert.ok(cap <= o.TUNING.maxSpeed);
    prev = cap;
  }
  assert.ok(o.maxSpeedForAltitude(8000) < o.maxSpeedForAltitude(9000), 'still climbs past the last zone');
  assert.strictEqual(o.maxSpeedForAltitude(1e6), o.TUNING.maxSpeed);
});

test('orbit gain stops at the given cap but never cuts a faster speed down', () => {
  const orbit = o.startOrbit(0, 0, 150, 0, 0, -600, 60);
  assert.strictEqual(o.orbitStep(orbit, 1990, 1, 60, 2000).speed, 2000);
  assert.strictEqual(o.orbitStep(orbit, 2500, 1, 60, 2000).speed, 2500);
});

test('grab zone widens with speed, up to a limit', () => {
  assert.strictEqual(o.grabRangeForSpeed(300), o.TUNING.grabRange);
  assert.strictEqual(o.grabRangeForSpeed(o.TUNING.grabSpeedFrom), o.TUNING.grabRange);
  assert.ok(o.grabRangeForSpeed(2000) > o.TUNING.grabRange);
  assert.strictEqual(o.grabRangeForSpeed(1e6), o.TUNING.grabRange + o.TUNING.grabSpeedMaxExtra);
});

test('only planets above the comet or ahead of its flight can be grabbed', () => {
  const planet = { x: 0, y: 0, radius: 60 };
  // Beside / above the comet: grabbable whatever the direction.
  assert.ok(o.canGrabPlanet(150, 0, 0, -600, planet));
  assert.ok(o.canGrabPlanet(100, 200, 0, -600, planet));
  // Comet already well above the planet, flying up: the planet is behind it.
  assert.ok(!o.canGrabPlanet(100, -200, 0, -600, planet));
  assert.ok(!o.canGrabPlanet(0, -180, 300, -500, planet));
  // ...unless the comet is flying toward it (diving down on purpose).
  assert.ok(o.canGrabPlanet(100, -200, -150, 600, planet));
  // Zero velocity: only the above rule applies.
  assert.ok(!o.canGrabPlanet(0, -300, 0, 0, planet));
});

test('overspeed fling needs time at the cap and an upward tangent', () => {
  const t = o.TUNING.overspeedHold;
  assert.ok(!o.overspeedFling(t - 0.01, 0, -1));
  assert.ok(o.overspeedFling(t, 0, -1));
  assert.ok(!o.overspeedFling(t + 5, 0, 1), 'never flings you down into the supernova');
  assert.ok(!o.overspeedFling(t + 5, 1, 0), 'never flings you sideways');
});

test('auto catch only covers the first assisted flings, early in the run', () => {
  assert.ok(o.autoCatchAllowed(1, 0));
  assert.ok(o.autoCatchAllowed(o.TUNING.autoCatchFlings, 5));
  assert.ok(!o.autoCatchAllowed(o.TUNING.autoCatchFlings + 1, 5));
  assert.ok(!o.autoCatchAllowed(1, o.TUNING.autoCatchSeconds));
  assert.ok(!o.autoCatchAllowed(0, 1));
});

test('the supernova climbs faster at higher altitude, still capped', () => {
  assert.strictEqual(o.novaSpeed(10), o.novaSpeed(10, 0));
  assert.ok(o.novaSpeed(10, 3000) > o.novaSpeed(10, 0));
  assert.strictEqual(o.novaSpeed(1000, 1e6), o.TUNING.novaMaxLate);
  // Past ESCAPE VELOCITY the wave gets faster with altitude even early in a run.
  assert.ok(o.novaSpeed(60, 20000) > o.novaSpeed(60, 9000) + 400);
});

test('orbitStep boost multiplies the orbit gain and the close-orbit bonus', () => {
  const orbit = { angle: 0, radius: 60 + o.TUNING.minOrbitGap, targetRadius: 60 + o.TUNING.minOrbitGap, dir: 1 };
  const base = o.orbitStep(orbit, 600, 0.1, 60, 5000).speed - 600;
  const same = o.orbitStep(orbit, 600, 0.1, 60, 5000, { gainMul: 1, closeMul: 1 }).speed - 600;
  assert.ok(Math.abs(base - same) < 1e-9, 'neutral boost = no boost');
  const gain = o.orbitStep(orbit, 600, 0.1, 60, 5000, { gainMul: 1.25 }).speed - 600;
  assert.ok(Math.abs(gain - base * 1.25) < 1e-9);
  // Skimming the surface (closeness 1): gain = orbitGain * (1 + bonus * closeMul).
  const close = o.orbitStep(orbit, 600, 0.1, 60, 5000, { closeMul: 1.5 }).speed - 600;
  const expected = o.TUNING.orbitGain * (1 + o.TUNING.closeOrbitBonus * 1.5) * 0.1;
  assert.ok(Math.abs(close - expected) < 1e-9);
  assert.ok(close > base);
});

test('chain milestones: 5 NICE, 10 BLAZING, 25 and every +25 UNSTOPPABLE, nothing else', () => {
  assert.strictEqual(o.chainMilestoneLevel(3), 1);
  assert.strictEqual(o.chainMilestoneLevel(6), 2);
  for (const c of [12, 24, 36, 48]) assert.strictEqual(o.chainMilestoneLevel(c), 3, String(c));
  for (const c of [0, 1, 2, 4, 5, 7, 10, 11, 13, 20, 23, 25, 30]) assert.strictEqual(o.chainMilestoneLevel(c), 0, String(c));
  assert.deepStrictEqual(o.CHAIN_MILESTONE_NAMES.slice(1), ['NICE!', 'BLAZING!', 'UNSTOPPABLE!']);
});

test('milestone speed bonus grows with the level and is 0 without one', () => {
  assert.strictEqual(o.milestoneSpeedBonus(0), 0);
  const b = [1, 2, 3].map(o.milestoneSpeedBonus);
  assert.ok(b[0] > 0 && b[1] > b[0] && b[2] > b[1]);
});

test('planet bumps cost 15% in the first two zones and 30% after', () => {
  assert.strictEqual(o.planetHitKeep(0), 0.85);
  assert.strictEqual(o.planetHitKeep(1), 0.85);
  for (const z of [2, 3, 4, 5]) assert.strictEqual(o.planetHitKeep(z), o.TUNING.hitKeep);
});

test('second wind: once per run, below HYPERSONIC, only after a few catches', () => {
  const n = o.TUNING.secondWindMinCatches;
  assert.strictEqual(o.secondWindAllowed(false, 300, n), true);
  assert.strictEqual(o.secondWindAllowed(true, 300, n), false, 'already used');
  assert.strictEqual(o.secondWindAllowed(false, 1500, n), false, 'HYPERSONIC reached');
  assert.strictEqual(o.secondWindAllowed(false, 1499, n), true);
  assert.strictEqual(o.secondWindAllowed(false, 300, n - 1), false, 'idle player never earns it');
  assert.strictEqual(o.secondWindAllowed(false, 300, 0), false);
});

test('momentum is 0 when slow, grows with speed and is 1 at the absolute cap', () => {
  assert.strictEqual(o.momentum(0), 0);
  assert.strictEqual(o.momentum(o.TUNING.momentumFrom), 0);
  assert.strictEqual(o.momentum(o.TUNING.maxSpeed), 1);
  assert.strictEqual(o.momentum(1e9), 1);
  let prev = -1;
  for (let v = 0; v <= o.TUNING.maxSpeed; v += 250) {
    assert.ok(o.momentum(v) >= prev, 'never drops (at ' + v + ')');
    prev = o.momentum(v);
  }
});

test('momentum visuals: nothing when slow, clearly building by 250-300 km/s, monotonic, 1 at the cap', () => {
  assert.strictEqual(o.momentumVisual(o.TUNING.startSpeed), 0);
  assert.strictEqual(o.momentumVisual(2000), 0, 'no cue at 200 km/s');
  assert.ok(o.momentumVisual(2500) > 0.15, 'cue visible at 250 km/s');
  assert.ok(o.momentumVisual(3000) > 0.3, 'cue strong at 300 km/s');
  assert.ok(o.momentumVisual(3000) > o.momentum(3000), 'earlier than the physics curve');
  assert.ok(o.momentumVisual(4500) < 0.9, 'headroom left above 450 km/s');
  assert.strictEqual(o.momentumVisual(o.TUNING.maxSpeed), 1);
  assert.strictEqual(o.momentumVisual(1e9), 1);
  let prev = -1;
  for (let v = 0; v <= o.TUNING.maxSpeed; v += 100) {
    assert.ok(o.momentumVisual(v) >= prev, 'never drops (at ' + v + ')');
    prev = o.momentumVisual(v);
  }
});

test('momentum multiplier: x1 slow, grows with speed, 1 + momentumGain at the cap', () => {
  assert.strictEqual(o.momentumGainMul(o.TUNING.startSpeed), 1);
  assert.ok(o.momentumGainMul(4500) > o.momentumGainMul(2400));
  assert.ok(o.momentumGainMul(2400) > 1);
  assert.ok(Math.abs(o.momentumGainMul(o.TUNING.maxSpeed) - (1 + o.TUNING.momentumGain)) < 1e-9);
});

test('orbit gain snowballs: the same orbit gains more per second when already fast', () => {
  const orbit = { angle: 0, radius: 200, targetRadius: 200, dir: 1 };
  const slow = o.orbitStep(orbit, 800, 0.1, 60, 8000).speed - 800;
  const fast = o.orbitStep(orbit, 5000, 0.1, 60, 8000).speed - 5000;
  assert.ok(fast > slow * 1.4, 'fast ' + fast + ' vs slow ' + slow);
});

test('zone caps keep growing past 450 km/s and the absolute cap is far above it', () => {
  assert.ok(o.TUNING.maxSpeed >= 7500);
  for (let i = 1; i < o.ZONES.length; i++) assert.ok(o.ZONES[i].maxSpeed > o.ZONES[i - 1].maxSpeed, o.ZONES[i].name);
  assert.ok(o.ZONES[o.ZONES.length - 1].maxSpeed > 4500, 'the last zone already starts above the old 450 km/s cap');
  assert.ok(o.maxSpeedForAltitude(20000) > 6000, 'deep runs keep escalating');
});

test('the supernova top speed scales with the zone speed cap and is capped', () => {
  assert.strictEqual(o.novaMaxForAltitude(0), o.TUNING.novaMaxSpeed);
  let prev = 0;
  for (let m = 0; m <= 60000; m += 500) {
    const v = o.novaMaxForAltitude(m);
    assert.ok(v >= prev, 'never drops (at ' + m + ' m)');
    assert.ok(v <= (m <= 8000 ? o.TUNING.novaMaxAbsolute : o.TUNING.novaMaxLate));
    prev = v;
  }
  assert.ok(o.novaMaxForAltitude(8000) > o.novaMaxForAltitude(1500));
  assert.strictEqual(o.novaMaxForAltitude(8000), o.TUNING.novaMaxAbsolute);
  // Every page past ESCAPE VELOCITY turns the screw by novaPerPage...
  assert.strictEqual(o.novaMaxForAltitude(12000), o.TUNING.novaMaxAbsolute + o.TUNING.novaPerPage);
  assert.strictEqual(o.novaMaxForAltitude(17000), o.TUNING.novaMaxAbsolute + 2 * o.TUNING.novaPerPage);
  // ...up to novaMaxLate.
  assert.strictEqual(o.novaMaxForAltitude(1e6), o.TUNING.novaMaxLate);
});

test('new sketchbook pages follow the contract (from, name, paper, ink, fx)', () => {
  const want = [
    [12000, 'LIGHTSPEED', 0x5a3b22, 0xf4ead0, 'lightspeed'],
    [17000, 'WORMHOLE', 0x1f3b2c, 0xf4ead0, 'spiral'],
    [23000, 'EVENT HORIZON', 0x1b3f6b, 0xf4ead0, 'blueprint'],
    [30000, 'BIG BANG', 0xf1eee4, 0x1d2747, 'graph'],
    [40000, 'BEYOND', 0x2a1f1a, 0xf4ead0, 'charcoal'],
  ];
  for (const [from, name, paper, ink, fx] of want) {
    const z = o.ZONES.find((x) => x.name === name);
    assert.ok(z, name);
    assert.deepStrictEqual([z.from, z.sky, z.paper, z.ink, z.fx], [from, paper, paper, ink, fx], name);
  }
  assert.strictEqual(o.ZONES[o.ZONES.length - 1].maxSpeed, o.TUNING.maxSpeed);
});

test('zoneAt covers every page index, endless pages cycle LIGHTSPEED..BEYOND looks', () => {
  for (let i = 0; i < o.ZONES.length; i++) assert.strictEqual(o.zoneAt(i), o.ZONES[i]);
  const last = o.ZONES.length - 1;
  const names = [];
  for (let i = last + 1; i <= last + 12; i++) {
    const z = o.zoneAt(i);
    assert.strictEqual(z.from, o.ZONES[last].from + (i - last) * 10000);
    assert.strictEqual(o.zoneIndexForAltitude(z.from), i);
    assert.strictEqual(z.maxSpeed, o.TUNING.maxSpeed);
    const look = o.ZONES[6 + ((i - last - 1) % 5)];
    assert.deepStrictEqual([z.paper, z.ink, z.fx], [look.paper, look.ink, look.fx]);
    assert.strictEqual(o.zoneAt(i), z, 'cached: same object every time');
    names.push(z.name);
  }
  assert.deepStrictEqual(names.slice(0, 4), ['BEYOND II', 'BEYOND III', 'BEYOND IV', 'BEYOND V']);
  assert.strictEqual(o.zoneAt(last + 9).name, 'BEYOND X');
  assert.strictEqual(o.zoneAt(-3), o.ZONES[0]);
  assert.strictEqual(o.zoneAt(o.zoneIndexForAltitude(1e7)).name.indexOf('BEYOND'), 0);
});

test('pagesPastEscape counts fractional pages from ESCAPE VELOCITY', () => {
  assert.strictEqual(o.pagesPastEscape(0), 0);
  assert.strictEqual(o.pagesPastEscape(7999), 0);
  assert.strictEqual(o.pagesPastEscape(8000), 0);
  assert.strictEqual(o.pagesPastEscape(10000), 0.5);
  assert.strictEqual(o.pagesPastEscape(12000), 1);
  assert.strictEqual(o.pagesPastEscape(50000), 6);
  assert.strictEqual(o.pagesPastEscape(55000), 6.5);
});

test('hazards get denser on every late page, capped', () => {
  assert.deepStrictEqual(o.hazardChances(100), { asteroid: 0, blackHole: 0 });
  const early = o.hazardChances(5000);
  assert.strictEqual(early.asteroid, o.TUNING.asteroidChance);
  assert.strictEqual(early.blackHole, o.TUNING.blackHoleChance);
  assert.ok(o.hazardChances(20000).asteroid > o.hazardChances(12000).asteroid);
  assert.ok(o.hazardChances(20000).blackHole > o.hazardChances(12000).blackHole);
  assert.strictEqual(o.hazardChances(1e7).asteroid, o.TUNING.maxAsteroidChance);
  assert.strictEqual(o.hazardChances(1e7).blackHole, o.TUNING.maxBlackHoleChance);
});

test('high-speed drag: none early, grows with speed, Aerodynamic cuts it, Afterburner only below 600 km/s', () => {
  assert.strictEqual(o.highSpeedDrag(3000, 1, false), 0);
  assert.strictEqual(o.highSpeedDrag(o.TUNING.dragFrom, 1, false), 0);
  assert.ok(o.highSpeedDrag(6000, 1, false) > 0);
  assert.ok(o.highSpeedDrag(7000, 1, false) > o.highSpeedDrag(6000, 1, false));
  assert.strictEqual(o.highSpeedDrag(o.TUNING.maxSpeed, 1, false), o.TUNING.dragMax);
  assert.ok(Math.abs(o.highSpeedDrag(8000, 0.7, false) - 0.7 * o.TUNING.dragMax) < 1e-9);
  assert.strictEqual(o.highSpeedDrag(5900, 1, true), 0, 'Afterburner/Slipstream cancel it below 600 km/s');
  assert.ok(o.highSpeedDrag(8000, 1, true) > 0, '...but not above');
  assert.ok(o.highSpeedDrag(8000, 1, true) < o.highSpeedDrag(8000, 1, false));
});

test('orbit gain tapers off near the top speed', () => {
  assert.strictEqual(o.orbitTaper(3000), 1);
  assert.strictEqual(o.orbitTaper(o.TUNING.orbitTaperFrom), 1);
  assert.ok(o.orbitTaper(7000) < 1 && o.orbitTaper(7000) > o.TUNING.orbitTaperMin);
  assert.ok(Math.abs(o.orbitTaper(o.TUNING.maxSpeed) - o.TUNING.orbitTaperMin) < 1e-9);
  const orbit = { angle: 0, radius: 100, targetRadius: 100, dir: 1 };
  const slow = o.orbitStep(orbit, 5000, 0.1, 60, 8000).speed - 5000;
  const fast = o.orbitStep(orbit, 7600, 0.1, 60, 8000).speed - 7600;
  assert.ok(fast < slow * 0.6, 'near the cap the orbit refills much slower');
});

test('wall bounces cost more at high speed; Wall Kick is limited and never pushes to the cap', () => {
  assert.ok(Math.abs(o.wallBounceKeepAt(0) - o.TUNING.wallBounceKeep) < 1e-9);
  assert.ok(o.wallBounceKeepAt(8000) < o.wallBounceKeepAt(3000));
  assert.ok(o.wallBounceKeepAt(8000) <= 0.8);
  assert.strictEqual(o.wallBounceKeepAt(4500), o.TUNING.wallBounceKeep, 'early game unchanged');
  assert.strictEqual(o.wallKickAllowed(0), true);
  assert.strictEqual(o.wallKickAllowed(1), true);
  assert.strictEqual(o.wallKickAllowed(2), false);
  assert.strictEqual(o.wallKickGain(2000, 5000, 110), 110);
  assert.strictEqual(o.wallKickGain(7900, 8000, 110), 0);
  assert.ok(o.wallKickGain(6750, 8000, 110) < 110);
});

test('planet bumps cost more at high speed', () => {
  assert.strictEqual(o.planetHitKeep(3), o.TUNING.hitKeep);
  assert.ok(o.planetHitKeep(3, 8000) < o.planetHitKeep(3, 2000));
  assert.strictEqual(o.planetHitKeep(3, 4500), o.TUNING.hitKeep, 'early game unchanged');
  assert.strictEqual(o.planetHitKeep(0, 3000), o.TUNING.earlyHitKeep);
  assert.ok(Math.abs(o.planetHitKeep(3, 8000) - (o.TUNING.hitKeep - o.TUNING.hitHighLoss)) < 1e-9);
});

test('finger tutorial: first 2 runs or until 3 good cycles, whichever lasts longer', () => {
  assert.strictEqual(o.tutorialActive({ runs: 0, goodCycles: 0 }), true);
  assert.strictEqual(o.tutorialActive({ runs: 1, goodCycles: 5 }), true, 'still the first 2 runs');
  assert.strictEqual(o.tutorialActive({ runs: 4, goodCycles: 2 }), true, 'not 3 good cycles yet');
  assert.strictEqual(o.tutorialActive({ runs: 2, goodCycles: 3 }), false);
  assert.strictEqual(o.tutorialActive(null), true);
  assert.deepStrictEqual(o.parseTutorialState(null), { runs: 0, goodCycles: 0 });
  assert.deepStrictEqual(o.parseTutorialState('garbage{'), { runs: 0, goodCycles: 0 });
  assert.deepStrictEqual(o.parseTutorialState('{"runs":3,"goodCycles":"2"}'), { runs: 3, goodCycles: 2 });
  assert.deepStrictEqual(o.parseTutorialState('{"runs":-4}'), { runs: 0, goodCycles: 0 });
});

test('speed fraction (colors, score multiplier) still tops out at 450 km/s', () => {
  assert.strictEqual(o.speedFraction(o.TUNING.visualTopSpeed), 1);
  assert.strictEqual(o.speedMultiplier(o.TUNING.visualTopSpeed), 5);
});

test('Tight Spin tighten: the orbit spirals in to the minimum orbit and gains more there', () => {
  let orbit = { angle: 0, radius: 60 + 150, targetRadius: 60 + 150, dir: 1 };
  let loose = { angle: 0, radius: 60 + 150, targetRadius: 60 + 150, dir: 1 };
  let speedT = 1000;
  let speedL = 1000;
  for (let i = 0; i < 240; i++) {
    const a = o.orbitStep(orbit, speedT, 1 / 60, 60, 8000, { tighten: 45 });
    const b = o.orbitStep(loose, speedL, 1 / 60, 60, 8000);
    orbit = a.orbit; speedT = a.speed;
    loose = b.orbit; speedL = b.speed;
  }
  assert.ok(orbit.radius < 60 + 150 - 100, 'spiralled in: ' + orbit.radius);
  assert.ok(orbit.radius >= 60 + o.TUNING.minOrbitGap);
  assert.strictEqual(loose.radius, 60 + 150, 'no tighten = stable orbit');
  assert.ok(speedT > speedL);
  for (let i = 0; i < 600; i++) orbit = o.orbitStep(orbit, 1000, 1 / 60, 60, 8000, { tighten: 45 }).orbit;
  assert.strictEqual(orbit.radius, 60 + o.TUNING.minOrbitGap, 'never inside the minimum orbit');
});

test('machNumber turns the km/s readout into Mach (343 m/s)', () => {
  assert.strictEqual(o.machNumber(343), 1000);
  assert.strictEqual(o.machNumber(537), 1566);
  assert.strictEqual(o.machNumber(0), 0);
  assert.strictEqual(o.machNumber(-5), 0);
});

test('nextMachTier stamps each tier once and only the highest when several are skipped', () => {
  assert.strictEqual(o.nextMachTier(0, 499), 0);
  assert.strictEqual(o.nextMachTier(0, 500), 500);
  assert.strictEqual(o.nextMachTier(500, 900), 0, 'already stamped');
  assert.strictEqual(o.nextMachTier(500, 1600), 1500, 'skipped 1000: one stamp for 1500');
  assert.strictEqual(o.nextMachTier(2500, 9999), 0);
});

test('ghostPositionAt interpolates the path by time and reports its end', () => {
  const pts = [{ t: 0, x: 0, y: 0 }, { t: 1, x: 10, y: -100 }, { t: 2, x: 20, y: -300 }];
  assert.deepStrictEqual(o.ghostPositionAt(pts, 0.5), { x: 5, y: -50, done: false });
  assert.deepStrictEqual(o.ghostPositionAt(pts, 1.5), { x: 15, y: -200, done: false });
  assert.deepStrictEqual(o.ghostPositionAt(pts, 5), { x: 20, y: -300, done: true });
  assert.deepStrictEqual(o.ghostPositionAt(pts, -1), { x: 0, y: 0, done: false });
  assert.strictEqual(o.ghostPositionAt([pts[0]], 0), null);
  assert.strictEqual(o.ghostPositionAt(null, 0), null);
});

test('the supernova leash: unchanged early, more room on the late pages', () => {
  assert.strictEqual(o.novaLeashFor(0), o.TUNING.novaLeash);
  assert.strictEqual(o.novaLeashFor(8000), o.TUNING.novaLeash);
  assert.ok(o.novaLeashFor(9000) > o.TUNING.novaLeash && o.novaLeashFor(9000) < o.TUNING.novaLeashLate);
  assert.strictEqual(o.novaLeashFor(10000), o.TUNING.novaLeashLate);
  assert.strictEqual(o.novaLeashFor(1e6), o.TUNING.novaLeashLate);
});
