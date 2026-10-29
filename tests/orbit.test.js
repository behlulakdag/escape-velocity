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

test('latching too close is pushed out to the minimum orbit', () => {
  const orbit = o.startOrbit(0, 0, 70, 0, 0, -600, 60);
  assert.strictEqual(orbit.radius, 60 + o.TUNING.minOrbitGap);
});

test('orbiting gains speed and tightens the orbit', () => {
  const orbit = o.startOrbit(0, 0, 200, 0, 0, -600, 60);
  const step = o.orbitStep(orbit, 600, 1, 60);
  assert.ok(step.speed > 600);
  assert.ok(step.orbit.radius < orbit.radius);
  assert.strictEqual(step.crashed, false);
});

test('orbiting long enough crashes into the planet', () => {
  let orbit = o.startOrbit(0, 0, 200, 0, 0, -600, 60);
  let speed = 600;
  let crashed = false;
  for (let i = 0; i < 1000 && !crashed; i++) {
    const s = o.orbitStep(orbit, speed, 0.05, 60);
    orbit = s.orbit; speed = s.speed; crashed = s.crashed;
  }
  assert.ok(crashed);
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
  assert.ok(Math.abs(step.orbit.angle - o.TUNING.maxOrbitSpin * 0.1) < 1e-9);
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
  assert.strictEqual(o.zoneIndexForAltitude(1e9), o.ZONES.length - 1);
  for (let i = 1; i < o.ZONES.length; i++) assert.ok(o.ZONES[i].from > o.ZONES[i - 1].from);
});

test('speed multiplier goes x1 at minimum to x5 at top speed', () => {
  assert.strictEqual(o.speedMultiplier(o.TUNING.minSpeed), 1);
  assert.strictEqual(o.speedMultiplier(o.TUNING.maxSpeed), 5);
  assert.ok(o.speedMultiplier(1400) > o.speedMultiplier(600));
});
