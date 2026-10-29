// Pure comet/orbit math, kept free of Phaser so it can be unit-tested with node.

const TUNING = {
  cometRadius: 22,
  startSpeed: 620,
  minSpeed: 260,          // below this the comet freezes
  maxSpeed: 2400,
  flightDecay: 70,        // px/s lost per second while flying
  flightDecayPerKm: 9,    // extra decay per 1000 px of altitude (difficulty ramp)
  maxFlightDecay: 190,
  orbitGain: 300,         // px/s gained per second while orbiting
  orbitShrink: 24,        // orbit radius lost per second (orbiting forever = crash)
  grabRange: 210,         // extra distance beyond the planet surface where holding catches the orbit
  minOrbitGap: 46,        // closest orbit allowed when latching
  wallBounceKeep: 0.85,   // speed kept after bouncing off a side wall
};

// Rotation direction from the comet's position relative to the planet and its velocity,
// so latching onto an orbit never reverses the comet's motion.
function startOrbit(cx, cy, x, y, vx, vy, planetRadius) {
  const rx = x - cx;
  const ry = y - cy;
  const dist = Math.hypot(rx, ry);
  const radius = Math.max(dist, planetRadius + TUNING.minOrbitGap);
  const cross = rx * vy - ry * vx;
  return {
    angle: Math.atan2(ry, rx),
    radius,
    dir: cross < 0 ? -1 : 1,
  };
}

// Advances an orbit by dt seconds. Returns the new orbit and speed; crashed=true when the
// tightening orbit reaches the planet surface.
function orbitStep(orbit, speed, dt, planetRadius) {
  const angle = orbit.angle + orbit.dir * (speed / orbit.radius) * dt;
  const radius = orbit.radius - TUNING.orbitShrink * dt;
  const newSpeed = Math.min(TUNING.maxSpeed, speed + TUNING.orbitGain * dt);
  return {
    orbit: { angle, radius, dir: orbit.dir },
    speed: newSpeed,
    crashed: radius <= planetRadius + TUNING.cometRadius,
  };
}

// Velocity along the orbit tangent: this is the direction the comet flies when released.
function tangentVelocity(orbit, speed) {
  return {
    vx: -Math.sin(orbit.angle) * orbit.dir * speed,
    vy: Math.cos(orbit.angle) * orbit.dir * speed,
  };
}

function flightDecay(altitude) {
  return Math.min(
    TUNING.maxFlightDecay,
    TUNING.flightDecay + (Math.max(0, altitude) / 1000) * TUNING.flightDecayPerKm
  );
}

// 0 = about to freeze, 1 = top speed. Drives every speed-based visual.
function speedFraction(speed) {
  const t = (speed - TUNING.minSpeed) / (TUNING.maxSpeed - TUNING.minSpeed);
  return Math.max(0, Math.min(1, t));
}

// Comet color by speed: cold grey -> red -> orange -> yellow -> white-blue.
const SPEED_COLOR_STOPS = [
  [0.0, 0x8a8aa0],
  [0.12, 0xff4d4d],
  [0.35, 0xff9a2e],
  [0.6, 0xffe14d],
  [0.85, 0xfffbe8],
  [1.0, 0x8fe3ff],
];

function lerpColor(a, b, t) {
  const r = ((a >> 16) & 255) + (((b >> 16) & 255) - ((a >> 16) & 255)) * t;
  const g = ((a >> 8) & 255) + (((b >> 8) & 255) - ((a >> 8) & 255)) * t;
  const bl = (a & 255) + ((b & 255) - (a & 255)) * t;
  return (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(bl);
}

function speedColor(fraction) {
  for (let i = 1; i < SPEED_COLOR_STOPS.length; i++) {
    const [t1, c1] = SPEED_COLOR_STOPS[i];
    if (fraction <= t1) {
      const [t0, c0] = SPEED_COLOR_STOPS[i - 1];
      return lerpColor(c0, c1, (fraction - t0) / (t1 - t0));
    }
  }
  return SPEED_COLOR_STOPS[SPEED_COLOR_STOPS.length - 1][1];
}

if (typeof module !== 'undefined') {
  module.exports = { TUNING, startOrbit, orbitStep, tangentVelocity, flightDecay, speedFraction, speedColor, lerpColor };
}
