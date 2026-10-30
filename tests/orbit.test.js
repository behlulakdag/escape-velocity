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
  assert.strictEqual(o.novaSpeed(1000, 1e6), o.TUNING.novaMaxLate + o.TUNING.novaBeyondMax);
  // Past ESCAPE VELOCITY the wave gets faster with altitude even early in a run.
  assert.ok(o.novaSpeed(60, 20000) > o.novaSpeed(60, 9000) + 150);
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
    assert.ok(v <= (m <= 8000 ? o.TUNING.novaMaxAbsolute : o.TUNING.novaMaxLate + o.novaBeyondExtra(m)));
    prev = v;
  }
  assert.ok(o.novaMaxForAltitude(8000) > o.novaMaxForAltitude(1500));
  assert.strictEqual(o.novaMaxForAltitude(8000), o.TUNING.novaMaxAbsolute);
  // Every page past ESCAPE VELOCITY turns the screw by novaPerPage...
  assert.strictEqual(o.novaMaxForAltitude(12000), o.TUNING.novaMaxAbsolute + o.TUNING.novaPerPage);
  assert.strictEqual(o.novaMaxForAltitude(17000), o.TUNING.novaMaxAbsolute + 2 * o.TUNING.novaPerPage);
  // ...up to novaMaxLate, and past BEYOND by novaBeyondPerPage a page, up to novaBeyondMax more.
  assert.strictEqual(o.novaMaxForAltitude(39000), o.TUNING.novaMaxLate);
  assert.strictEqual(o.novaMaxForAltitude(50000), o.TUNING.novaMaxLate + o.TUNING.novaBeyondPerPage);
  assert.strictEqual(o.novaMaxForAltitude(1e6), o.TUNING.novaMaxLate + o.TUNING.novaBeyondMax);
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
  assert.ok(o.wallBounceKeepAt(8000) <= 0.9);
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

test('the supernova leash: unchanged early, by wave travel time on the late pages', () => {
  assert.strictEqual(o.novaLeashFor(0, 900), o.TUNING.novaLeash);
  assert.strictEqual(o.novaLeashFor(8000, 2000), o.TUNING.novaLeash);
  const late = 2800 * o.TUNING.novaLeashSeconds;
  assert.ok(o.novaLeashFor(9000, 2800) > o.TUNING.novaLeash && o.novaLeashFor(9000, 2800) < late);
  assert.ok(Math.abs(o.novaLeashFor(10000, 2800) - late) < 1e-9);
  assert.ok(Math.abs(o.novaLeashFor(1e6, 2800) - late) < 1e-9);
  // Late, the wave is never more than ~0.6-0.8 s of its own travel below the screen.
  for (const v of [1500, 2200, 2900]) {
    const sec = o.novaLeashFor(30000, v) / v;
    assert.ok(sec >= 0.6 && sec <= 0.8, v + ' px/s -> ' + sec + ' s');
  }
  // A slow wave keeps the old px floor.
  assert.strictEqual(o.novaLeashFor(30000, 100), o.TUNING.novaLeash);
});

test('calm start: the wave starts slow and is at full speed by novaCalmSeconds; learning crawls', () => {
  assert.strictEqual(o.novaCalmFactor(0, false), o.TUNING.novaCalmFrom);
  assert.ok(o.novaCalmFactor(5, false) > o.novaCalmFactor(1, false));
  assert.strictEqual(o.novaCalmFactor(o.TUNING.novaCalmSeconds, false), 1);
  assert.strictEqual(o.novaCalmFactor(100, false), 1);
  assert.strictEqual(o.novaCalmFactor(3, true), o.TUNING.novaLearnMul);
  assert.ok(o.TUNING.novaLearnMul < o.TUNING.novaCalmFrom);
  // The tutorial runs ease in over a longer calm start.
  assert.ok(o.novaCalmFactor(10, false, true) < o.novaCalmFactor(10, false, false));
  assert.strictEqual(o.novaCalmFactor(o.TUNING.tutorialCalmSeconds, false, true), 1);
});

test('novaSpeedFor applies cards and calm, never above the hard cap', () => {
  assert.strictEqual(o.novaSpeedFor(10, 0, 1, 1), o.novaSpeed(10, 0));
  assert.ok(Math.abs(o.novaSpeedFor(10, 0, 1.2, 0.5) - o.novaSpeed(10, 0) * 0.6) < 1e-9);
  assert.strictEqual(o.novaSpeedFor(1e4, 30000, 1.6, 1), o.TUNING.novaHardCap);
  assert.strictEqual(o.novaSpeedFor(1e4, 1e6, 1.6, 1), o.TUNING.novaHardCap + o.TUNING.novaBeyondMax);
  assert.ok(o.TUNING.novaHardCap <= 3000 && o.TUNING.novaMaxLate <= o.TUNING.novaHardCap);
});

test('novaEtaSeconds: gap over the wave speed, a falling comet closes faster, a climbing one only a little', () => {
  assert.strictEqual(o.novaEtaSeconds(1000, 1000, 0), 1);
  assert.strictEqual(o.novaEtaSeconds(1000, 1000, 1000), 0.5);
  // A fast climb counts down to etaClimbFloor of the wave speed, never more.
  assert.strictEqual(o.novaEtaSeconds(1000, 1000, -5000), 1000 / (1000 * o.TUNING.etaClimbFloor));
  assert.strictEqual(o.novaEtaSeconds(1000, 1000, -200), 1000 / 800);
  // orbitSwing: a down swing is ignored while the wave is etaSwingUnder s away or more.
  assert.strictEqual(o.novaEtaSeconds(3000, 1000, 2000, true), 3);
  assert.strictEqual(o.novaEtaSeconds(1000, 1000, 1000, true), 0.5);
  assert.strictEqual(o.novaEtaSeconds(-5, 1000, 0), 0);
  assert.ok(isFinite(o.novaEtaSeconds(1000, 0, 0)));
});

test('late game: the wave stays slower than a clean climb and its leash keeps it ~1 s away', () => {
  assert.ok(o.TUNING.novaHardCap <= 3000);
  // At the leash (comet ~715 px above the screen bottom at full zoom-out) the wave needs about a second.
  const v = o.TUNING.novaHardCap;
  const eta = o.novaEtaSeconds(715 + o.novaLeashFor(40000, v), v, 0);
  assert.ok(eta > 0.9 && eta < 1.3, String(eta));
  // Late orbits spin faster so they come round before that.
  assert.ok(o.orbitSpinCap(o.TUNING.maxSpeed) >= 2 * Math.PI / eta);
});

test('pickTutorialTarget: always the next planet above, beside it, with the real angle', () => {
  const low = { x: 200, y: 0, radius: 60 };
  const next = { x: 500, y: -600, radius: 60 };
  const far = { x: 200, y: -1200, radius: 60 };
  const below = { x: 400, y: 400, radius: 60 };
  // Comet orbiting `low`, tangent pointing straight down: no normal assist, the tutorial still aims up.
  const t = o.pickTutorialTarget(200, -100, 0, 1, [low, next, far, below], low, low.y);
  assert.strictEqual(t.planet, next);
  assert.ok(t.wide);
  assert.ok(t.angle > 2);
  const passDist = next.radius + o.TUNING.assistPassGap;
  assert.ok(Math.abs(Math.hypot(t.aimX - next.x, t.aimY - next.y) - passDist) < 1e-6);
  assert.strictEqual(o.pickTutorialTarget(200, -100, 0, 1, [low, below], low, low.y), null);
});

test('learning window: closes on 3 good cycles, 30 s or 1500 m, and at 25 s with no catch', () => {
  const base = { tutorial: true, seconds: 5, meters: 300, goodCycles: 0, ownCatches: 1 };
  assert.ok(o.learningWindowOpen(base));
  assert.ok(!o.learningWindowOpen(Object.assign({}, base, { tutorial: false })));
  assert.ok(!o.learningWindowOpen(Object.assign({}, base, { goodCycles: o.TUNING.learnWindowCycles })));
  assert.ok(o.learningWindowOpen(Object.assign({}, base, { goodCycles: o.TUNING.learnWindowCycles - 1 })));
  assert.ok(!o.learningWindowOpen(Object.assign({}, base, { seconds: o.TUNING.learnWindowSeconds })));
  assert.ok(!o.learningWindowOpen(Object.assign({}, base, { meters: o.TUNING.learnWindowMeters })));
  // A lost player who never caught a planet: the window ends at learnIdleSeconds anyway.
  assert.ok(o.learningWindowOpen(Object.assign({}, base, { ownCatches: 0, seconds: o.TUNING.learnIdleSeconds - 1 })));
  assert.ok(!o.learningWindowOpen(Object.assign({}, base, { ownCatches: 0, seconds: o.TUNING.learnIdleSeconds })));
  assert.ok(o.TUNING.learnIdleSeconds < o.TUNING.learnWindowSeconds);
});

test('learnExitFactor: the wave eases from the crawl up to the calm factor', () => {
  assert.strictEqual(o.learnExitFactor(0.8, 0), o.TUNING.novaLearnMul);
  assert.ok(Math.abs(o.learnExitFactor(0.8, o.TUNING.learnExitSeconds) - 0.8) < 1e-9);
  const mid = o.learnExitFactor(0.8, o.TUNING.learnExitSeconds / 2);
  assert.ok(mid > o.TUNING.novaLearnMul && mid < 0.8);
});

test('tutorialLetGo: green at once; the wide assist after a while or when the wave is close', () => {
  assert.ok(!o.tutorialLetGo(null, 5, 0.1, 10));
  assert.ok(o.tutorialLetGo({ wide: false }, 0, 9, 5000));
  assert.ok(!o.tutorialLetGo({ wide: true }, 0.2, 9, 5000));
  assert.ok(o.tutorialLetGo({ wide: true }, o.TUNING.tutorialLetGoAfter + 0.01, 9, 5000));
  assert.ok(o.tutorialLetGo({ wide: true }, 0.2, o.TUNING.letGoEta - 0.1, 5000));
  assert.ok(o.tutorialLetGo({ wide: true }, 0.2, 9, o.TUNING.letGoGap - 1));
});

test('late orbit fairness: slower wave only right after a PERFECT, late only, fading past BEYOND', () => {
  assert.strictEqual(o.orbitNovaMul(30000, 0.1, false, true), 1);   // in flight
  assert.strictEqual(o.orbitNovaMul(3000, 0.1, true, true), 1);     // early
  assert.strictEqual(o.orbitNovaMul(30000, 0.1, true, true), o.TUNING.orbitNovaMul);
  assert.strictEqual(o.orbitNovaMul(30000, o.TUNING.orbitNovaGracePerfect + 0.01, true, true), 1);
  assert.ok(o.orbitNovaMul(30000, 0.1, true, false) >= o.orbitNovaMul(30000, 0.1, true, true));
  assert.strictEqual(o.orbitNovaMul(o.TUNING.orbitFairFadeFrom + o.TUNING.orbitFairFadeSpan, 0.1, true, true), 1);
  assert.strictEqual(o.lateShare(5000), 0);
  assert.strictEqual(o.lateShare(10000), 1);
});

test('late green coyote time: none early, assistCoyote late', () => {
  assert.strictEqual(o.assistCoyoteTime(3000), 0);
  assert.strictEqual(o.assistCoyoteTime(20000), o.TUNING.assistCoyote);
  assert.ok(o.TUNING.assistCoyote > 0 && o.TUNING.assistCoyote <= 0.2);
});

test('perfectAngleAt: base early, wider with the late spin boost, inside the green cone', () => {
  const b = o.TUNING.perfectAngle;
  assert.strictEqual(o.perfectAngleAt(b, 2000), b);
  assert.ok(o.perfectAngleAt(b, 7000) > b);
  assert.ok(o.perfectAngleAt(b, o.TUNING.maxSpeed) < o.TUNING.assistMaxAngle);
  // A wider card window is never narrowed.
  assert.strictEqual(o.perfectAngleAt(0.22, 2000), 0.22);
});

test('novaOrbitEta: phase aware; far wave = plain gap / speed; wave above the low point = soon', () => {
  const base = { novaY: 5000, cometY: 0, planetY: 0, angle: -Math.PI / 2, radius: 200, dir: 1, spin: 6, wave: 1000 };
  assert.strictEqual(o.novaOrbitEta(base), 5);
  assert.strictEqual(o.novaOrbitEta(Object.assign({}, base, { novaY: -1 })), 0);
  // Close wave: the comet at the top swings down into it, well before the wave climbs the 1000 px to it.
  const top = o.novaOrbitEta(Object.assign({}, base, { novaY: 800, cometY: -200 }));
  assert.ok(top > 0.4 && top <= (800 - 200) / 1000 + 0.04, String(top));
  // The wave already above the orbit's low point: the down swing ends it at once.
  assert.ok(o.novaOrbitEta(Object.assign({}, base, { novaY: 150, cometY: 100, angle: 0.5 })) < 0.1);
  // A slower wave for a moment (late orbit grace) pushes it later.
  assert.ok(o.novaOrbitEta(Object.assign({}, base, { novaY: 800, cometY: -200, slowWave: 500, slowFor: 1 })) > top);
});

test('warpVelocity keepClimbing: a climbing comet is never warped into a dive', () => {
  for (let k = 0; k < 40; k++) {
    const a = -Math.PI + (k / 40) * Math.PI;   // every upward heading
    const vx = Math.cos(a) * 1000;
    const vy = Math.sin(a) * 1000;
    if (vy >= 0) continue;
    for (const hx of [-30, 0, 30]) {
      const w = o.warpVelocity(hx, -10, 0, 0, vx, vy, true);
      assert.ok(w.vy <= 1e-9, 'heading ' + a.toFixed(2) + ' hole ' + hx);
      assert.ok(Math.abs(Math.hypot(w.vx, w.vy) - 1000) < 1e-6);
    }
  }
});

test('guidedTutorialStep: two planets of HOLD -> full lap -> LET GO, then NICE! and done', () => {
  const step = (st, ev) => o.guidedTutorialStep(st, ev);
  assert.strictEqual(o.TUNING.guidedRounds, 2);
  let r = step(null, {});
  assert.deepStrictEqual(r.st, { phase: 'hold', round: 1, waiting: '' });
  assert.strictEqual(r.action, null);
  for (let round = 1; round <= 2; round++) {
    r = step(r.st, { reachable: true });
    assert.strictEqual(r.action, 'showHold');
    assert.strictEqual(r.st.waiting, 'hold');
    // No timeout: it keeps waiting, whatever else happens, until the press.
    for (let i = 0; i < 300; i++) {
      r = step(r.st, { reachable: i % 2 === 0, released: i % 3 === 0 });
      assert.strictEqual(r.action, null);
      assert.strictEqual(r.st.waiting, 'hold');
    }
    r = step(r.st, { pressed: true, holding: true });
    assert.strictEqual(r.action, 'latch');
    assert.deepStrictEqual(r.st, { phase: 'lap', round, waiting: '' });
    // The lap: no LET GO before one full revolution, even with the aim lined up; a release is ignored.
    for (let i = 0; i < 100; i++) {
      r = step(r.st, { orbiting: true, holding: i % 2 === 0, aimReady: true, lapDone: false, released: i % 5 === 0 });
      assert.strictEqual(r.action, null);
      assert.strictEqual(r.st.phase, 'lap');
      assert.strictEqual(o.guidedFlingBlocked(r.st), true);
    }
    // Lap done, aim not lined up yet: still nothing.
    r = step(r.st, { orbiting: true, holding: true, lapDone: true, aimReady: false });
    assert.strictEqual(r.action, null);
    r = step(r.st, { orbiting: true, holding: true, lapDone: true, aimReady: true });
    assert.strictEqual(r.action, 'showLetGo');
    assert.strictEqual(r.st.waiting, 'letgo');
    assert.strictEqual(o.guidedFlingBlocked(r.st), false);
    for (let i = 0; i < 100; i++) {
      r = step(r.st, { orbiting: true, holding: true, lapDone: true, aimReady: i % 2 === 0, pressed: true });
      assert.strictEqual(r.action, null);
    }
    r = step(r.st, { orbiting: true, released: true });
    if (round === 1) {
      assert.strictEqual(r.action, 'fling');
      assert.deepStrictEqual(r.st, { phase: 'hold', round: 2, waiting: '' });
    } else {
      assert.strictEqual(r.action, 'nice');
      assert.deepStrictEqual(r.st, { phase: 'done', round: 2, waiting: '' });
    }
  }
  assert.strictEqual(o.guidedFlingBlocked(r.st), false);
  for (const ev of [{ reachable: true }, { orbiting: true, holding: true, lapDone: true, aimReady: true }, { orbiting: true, released: true }]) {
    r = step(r.st, ev);
    assert.strictEqual(r.action, null);
    assert.strictEqual(r.st.waiting, '');
  }
});

test('guidedTutorialStep: an orbit begun on its own starts the lap; a lost orbit restarts the round', () => {
  // Already holding when the planet comes near: no HOLD step, the player latches by themselves...
  let r = o.guidedTutorialStep({ phase: 'hold', round: 1, waiting: '' }, { reachable: true, holding: true });
  assert.strictEqual(r.action, null);
  assert.strictEqual(r.st.phase, 'hold');
  // ...and that orbit starts the lap.
  r = o.guidedTutorialStep(r.st, { orbiting: true, holding: true });
  assert.strictEqual(r.action, 'lap');
  assert.deepStrictEqual(r.st, { phase: 'lap', round: 1, waiting: '' });
  // A HOLD step still up when an orbit starts some other way: it goes, the lap starts.
  r = o.guidedTutorialStep({ phase: 'hold', round: 2, waiting: 'hold' }, { orbiting: true });
  assert.strictEqual(r.action, 'lap');
  assert.deepStrictEqual(r.st, { phase: 'lap', round: 2, waiting: '' });
  // The orbit ends some other way (overspeed) during the lap or with LET GO up: the round starts over.
  r = o.guidedTutorialStep({ phase: 'lap', round: 2, waiting: '' }, { orbiting: false });
  assert.strictEqual(r.action, 'cancel');
  assert.deepStrictEqual(r.st, { phase: 'hold', round: 2, waiting: '' });
  r = o.guidedTutorialStep({ phase: 'lap', round: 1, waiting: 'letgo' }, { orbiting: false });
  assert.strictEqual(r.action, 'cancel');
  assert.deepStrictEqual(r.st, { phase: 'hold', round: 1, waiting: '' });
  // Old saved shape (no round) reads as round 1; the input state is not mutated.
  const st = { phase: 'hold', waiting: '' };
  r = o.guidedTutorialStep(st, { reachable: true });
  assert.strictEqual(r.st.round, 1);
  assert.deepStrictEqual(st, { phase: 'hold', waiting: '' });
  assert.strictEqual(o.guidedFlingBlocked(null), false);
  assert.strictEqual(o.guidedFlingBlocked({ phase: 'hold', waiting: '' }), true);
});

test('guidedAimLinedUp: the tangent points at the target within guidedAimAngle', () => {
  assert.strictEqual(o.guidedAimLinedUp(0, 0, 0, -1, 0, -500), true);
  assert.strictEqual(o.guidedAimLinedUp(0, 0, 0, -1, 500 * Math.tan(o.TUNING.guidedAimAngle * 0.9), -500), true);
  assert.strictEqual(o.guidedAimLinedUp(0, 0, 0, -1, 500 * Math.tan(o.TUNING.guidedAimAngle * 1.1), -500), false);
  assert.strictEqual(o.guidedAimLinedUp(0, 0, 0, 1, 0, -500), false);
  assert.strictEqual(o.guidedAimLinedUp(0, 0, 0, 0, 0, -500), false);
  assert.strictEqual(o.guidedAimLinedUp(5, 5, 1, 0, 5, 5), false);
});

test('aimAtPlanet: optional passGap puts the pass point that far off the surface', () => {
  const p = { x: 0, y: -600, radius: 60 };
  const a = o.aimAtPlanet(0, 0, 0, -1, p, o.TUNING.guidedPassGap);
  assert.ok(Math.abs(Math.hypot(a.aimX - p.x, a.aimY - p.y) - (p.radius + o.TUNING.guidedPassGap)) < 1e-6);
  const b = o.aimAtPlanet(0, 0, 0, -1, p);
  assert.ok(Math.abs(Math.hypot(b.aimX - p.x, b.aimY - p.y) - (p.radius + o.TUNING.assistPassGap)) < 1e-6);
  // The guided pass is inside the grab zone with room to spare.
  assert.ok(o.TUNING.guidedPassGap < o.TUNING.grabRange * 0.5);
});

test('wallBounceVelocity: a deflection that flips vx, keeps speed, turns it up and inward', () => {
  const sp = 3600;
  const vxCap = o.TUNING.wallCrossWidth / o.TUNING.wallCrossSeconds;
  // Nearly sideways climb into the right wall: comes back mostly upward, still climbing.
  let w = o.wallBounceVelocity(sp * 0.98, -sp * Math.sqrt(1 - 0.98 * 0.98), sp);
  assert.ok(w.vx < 0);
  assert.ok(Math.abs(w.vx) <= Math.min(o.TUNING.wallVxShare * sp, vxCap) + 1e-6);
  assert.ok(w.vy < 0, 'still climbing');
  assert.ok(Math.abs(Math.hypot(w.vx, w.vy) - sp) < 1e-6);
  // Exactly sideways (vy 0) counts as a climb.
  w = o.wallBounceVelocity(-sp, 0, sp);
  assert.ok(w.vx > 0 && w.vy < 0);
  // A flat flight drifting slightly down comes off the wall climbing, not diving...
  w = o.wallBounceVelocity(sp, sp * 0.1, sp);
  assert.ok(w.vy < 0 && Math.abs(w.vx) <= vxCap + 1e-6);
  // ...so does a slow, shallow fall...
  w = o.wallBounceVelocity(300, 150, Math.hypot(300, 150));
  assert.ok(w.vx < 0 && w.vy < 0 && Math.abs(Math.hypot(w.vx, w.vy) - Math.hypot(300, 150)) < 1e-6);
  // ...and so does a steep fall: never a dive off a wall (capped too).
  w = o.wallBounceVelocity(sp * 0.75, sp * Math.sqrt(1 - 0.75 * 0.75), sp);
  assert.ok(w.vy < 0 && Math.abs(w.vx) <= vxCap + 1e-6);
  w = o.wallBounceVelocity(-300, 1000, Math.hypot(300, 1000));
  assert.ok(Math.abs(w.vx - 300) < 1e-6 && Math.abs(w.vy + 1000) < 1e-6, 'a slow steep fall is mirrored up');
  // A steep bounce is only mirrored.
  w = o.wallBounceVelocity(300, -1000, Math.hypot(300, 1000));
  assert.ok(Math.abs(w.vx + 300) < 1e-6 && Math.abs(w.vy + 1000) < 1e-6);
  // A grazing hit leaves the wall with at least wallMinVxShare of the speed sideways (up to the cap), climbing.
  w = o.wallBounceVelocity(-2, -1000, 1000);
  assert.ok(w.vx >= o.TUNING.wallMinVxShare * 1000 - 1e-6 && w.vy < 0);
  assert.ok(Math.abs(Math.hypot(w.vx, w.vy) - 1000) < 1e-6);
});

test('wallBounceVelocity: after a wall hit the opposite wall is >= wallCrossSeconds away at any speed', () => {
  for (const sp of [800, 1500, 2918, 4500, 8000]) {
    for (const a of [0, 0.3, 0.8, 1.2]) {
      const w = o.wallBounceVelocity(sp * Math.cos(a), -sp * Math.sin(a), sp);
      const crossing = o.TUNING.wallCrossWidth / Math.max(1e-9, Math.abs(w.vx));
      assert.ok(crossing >= o.TUNING.wallCrossSeconds - 1e-9, sp + ' ' + a + ': ' + crossing);
      assert.ok(w.vy < 0, 'the rest of the speed climbs');
      assert.ok(Math.abs(Math.hypot(w.vx, w.vy) - sp) < 1e-6);
    }
  }
});

test('wall hits keep a big fling alive: 4 hits from 2918 px/s keep > 80% of it', () => {
  let v = 2918;
  for (let i = 0; i < 4; i++) v *= o.wallBounceKeepAt(v);
  assert.ok(v > 2918 * 0.8, String(v));
  assert.ok(o.wallBounceKeepAt(2000) >= 0.95 - 1e-9);
});

test('crawlRescueStep: 1 s crawling with nothing in reach calls one rescue, then cools down', () => {
  let t = 0;
  let rescues = 0;
  for (let i = 0; i < 60 * 5; i++) {
    const r = o.crawlRescueStep(t, 300, false, 1 / 60);
    t = r.t;
    if (r.rescue) { rescues++; assert.ok(i / 60 > o.TUNING.crawlSeconds - 0.05, String(i)); }
  }
  // 5 s of crawling: first at ~1 s, the next one cooldown + 1 s later (~4 s).
  assert.strictEqual(rescues, 2);
  // Fast, or a planet in reach: the timer resets.
  assert.strictEqual(o.crawlRescueStep(0.9, 2000, false, 0.2).t, 0);
  assert.strictEqual(o.crawlRescueStep(0.9, 300, true, 0.2).rescue, false);
  assert.strictEqual(o.crawlRescueStep(0.9, 300, false, 0.2).rescue, true);
  // Cooling down counts back up to 0 whatever happens.
  assert.ok(o.crawlRescueStep(-1, 300, false, 0.5).t === -0.5);
  assert.ok(o.crawlRescueStep(-0.2, 3000, true, 0.5).t === 0);
});

test('popGapOk: a pop repeats only after its gap', () => {
  assert.strictEqual(o.popGapOk(-1e9, 0, 1500), true);
  assert.strictEqual(o.popGapOk(undefined, 0, 1500), true);
  assert.strictEqual(o.popGapOk(1000, 2000, 1500), false);
  assert.strictEqual(o.popGapOk(1000, 2500, 1500), true);
});

test('guided slow motion: eases down to the slow scale in guidedEaseIn, back up in guidedEaseOut', () => {
  const T = o.TUNING;
  assert.ok(T.guidedSlowScale >= 0.03 && T.guidedSlowScale <= 0.06);
  assert.strictEqual(o.guidedSlowScale(0), 1);
  assert.ok(Math.abs(o.guidedSlowScale(1) - T.guidedSlowScale) < 1e-9);
  let p = 0;
  let prev = 1;
  let t = 0;
  while (p < 1) {
    p = o.guidedSlowProgress(p, true, 1 / 60);
    t += 1 / 60;
    const k = o.guidedSlowScale(p);
    assert.ok(k <= prev + 1e-12, 'only ever slows down while waiting');
    prev = k;
  }
  assert.ok(Math.abs(t - T.guidedEaseIn) < 2 / 60, String(t));
  t = 0;
  while (p > 0) {
    p = o.guidedSlowProgress(p, false, 1 / 60);
    t += 1 / 60;
  }
  assert.ok(Math.abs(t - T.guidedEaseOut) < 2 / 60, String(t));
  assert.strictEqual(o.guidedSlowProgress(0, false, 1), 0);
  assert.strictEqual(o.guidedSlowProgress(1, true, 1), 1);
  assert.strictEqual(o.guidedSlowProgress(undefined, true, -5), 0);
});

test('parseGuidedTutorialDone: only a stored 1 retires it', () => {
  assert.strictEqual(o.parseGuidedTutorialDone('1'), true);
  for (const raw of [null, undefined, '', '0', 'true', '{"done":1}', 1]) assert.strictEqual(o.parseGuidedTutorialDone(raw), false, String(raw));
});

test('aimAtPlanet: the pass point beside the planet nearest the flight direction, wide', () => {
  const planet = { x: 0, y: -1000, radius: 80 };
  const a = o.aimAtPlanet(0, 0, 0, -1, planet);
  assert.strictEqual(a.planet, planet);
  assert.strictEqual(a.wide, true);
  assert.ok(Math.abs(Math.hypot(a.aimX - planet.x, a.aimY - planet.y) - (planet.radius + o.TUNING.assistPassGap)) < 1e-6);
  // Flying right: the right-hand pass point is the closer one.
  const r = o.aimAtPlanet(0, 0, 1, -0.2, planet);
  assert.ok(r.aimX > 0);
  // Pointing straight away still aims at it (any angle), and inside the pass circle there is none.
  assert.ok(o.aimAtPlanet(0, 0, 0, 1, planet).angle > 2.5);
  assert.strictEqual(o.aimAtPlanet(0, -1000, 0, -1, planet), null);
  assert.strictEqual(o.aimAtPlanet(0, 0, 0, -1, null), null);
  // nextPlanetAboveY: the lowest planet above, never the excluded one.
  const low = { x: 0, y: 0, radius: 60 };
  const next = { x: 0, y: -600, radius: 60 };
  const far = { x: 0, y: -1200, radius: 60 };
  assert.strictEqual(o.nextPlanetAboveY([far, low, next], low, low.y), next);
  assert.strictEqual(o.nextPlanetAboveY([low], low, low.y), null);
});

test('passPointInField: a pass point past a side wall swaps to the planet\'s other side', () => {
  const planet = { x: 150, y: -600, radius: 85 };
  // Inside: unchanged.
  assert.deepStrictEqual(o.passPointInField(400, -600, planet, 720, 48), { x: 400, y: -600 });
  // Past the left wall: mirrored through the center (the other side, same pass distance).
  const a = o.passPointInField(-50, -640, planet, 720, 48);
  assert.deepStrictEqual(a, { x: 350, y: -560 });
  assert.ok(Math.abs(Math.hypot(a.x - planet.x, a.y - planet.y) - Math.hypot(-50 - planet.x, -640 - planet.y)) < 1e-9);
  // sameHeight: only across in x.
  assert.deepStrictEqual(o.passPointInField(-50, -700, planet, 720, 48, true), { x: 350, y: -700 });
  // Both sides out (cannot happen on the real field): clamped.
  assert.deepStrictEqual(o.passPointInField(-500, -600, { x: 360, y: -600 }, 720, 48), { x: 48, y: -600 });
});

test('flightDecay with a speed: cruise decay shrinks with speed, a real crawl gets the full decay', () => {
  const alt = 9000;
  assert.strictEqual(o.flightDecay(alt, 3000), o.flightDecay(alt));
  assert.strictEqual(o.flightDecay(alt, o.TUNING.decayFullFrom), o.flightDecay(alt));
  assert.ok(Math.abs(o.flightDecay(alt, 1050) - o.flightDecay(alt) * 0.7) < 1e-9);
  assert.ok(Math.abs(o.flightDecayShare(601) - o.TUNING.decayMinShare) < 0.002);
  assert.ok(o.flightDecay(alt, 1000) < o.flightDecay(alt, 1400));
  assert.strictEqual(o.flightDecay(alt, 300), o.flightDecay(alt), 'crawl: full decay');
  assert.strictEqual(o.flightDecayShare(-5), 1);
  // A mid cruise at 120 km/s keeps above 60 km/s for > 7 s even at the top decay (was ~4.3 s).
  let v = 1200;
  let t = 0;
  while (v > 600 && t < 60) { v -= o.TUNING.maxFlightDecay * o.flightDecayShare(v) / 60; t += 1 / 60; }
  assert.ok(t > 7, String(t));
});

test('isLossPop: one family for every -N% SPEED', () => {
  assert.ok(o.isLossPop('-30% SPEED'));
  assert.ok(o.isLossPop('-15% SPEED'));
  assert.ok(!o.isLossPop('+SPEED'));
  assert.ok(!o.isLossPop('SHATTER! +SPEED'));
  assert.ok(!o.isLossPop(undefined));
});

test('popAdmitted: one new pop per popMinGapMs unless it outranks the last', () => {
  const g = o.POP_GATES.popMinGapMs;
  assert.ok(o.popAdmitted(null, 0, 1));
  assert.ok(!o.popAdmitted({ at: 1000, priority: 2 }, 1000 + g - 1, 2));
  assert.ok(!o.popAdmitted({ at: 1000, priority: 2 }, 1070, 1));
  assert.ok(o.popAdmitted({ at: 1000, priority: 1 }, 1070, 3));
  assert.ok(o.popAdmitted({ at: 1000, priority: 3 }, 1000 + g, 1));
  assert.ok(o.POP_GATES.lossPopGapMs >= 2000);
});

test('novaSpeed: first (tutorial) runs keep the gentler time ramp', () => {
  assert.strictEqual(o.novaSpeed(0, 0, true), o.novaSpeed(0, 0));
  assert.ok(o.novaSpeed(30, 0, true) < o.novaSpeed(30, 0));
  assert.strictEqual(o.novaSpeed(30, 0, true), o.TUNING.novaBaseSpeed + o.TUNING.novaRamp * 30);
  // The early extra ramp stops growing after novaRampEarlySeconds.
  const T = o.TUNING.novaRampEarlySeconds;
  const extra = (t) => o.novaSpeed(t, 0) - o.novaSpeed(t, 0, true);
  assert.ok(Math.abs(extra(T / 2) - o.TUNING.novaRampEarly * T / 2) < 1e-9);
  assert.ok(Math.abs(extra(T + 20) - o.TUNING.novaRampEarly * T) < 1e-9);
  assert.strictEqual(o.novaSpeedFor(30, 0, 1, 1, true), o.novaSpeed(30, 0, true));
  assert.strictEqual(o.novaSpeed(1e6, 0, true), o.novaSpeed(1e6, 0), 'same top speed');
});
