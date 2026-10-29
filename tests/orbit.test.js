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
