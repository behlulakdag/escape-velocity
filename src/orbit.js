// Pure comet/orbit math, kept free of Phaser so it can be unit-tested with node.

const TUNING = {
  cometRadius: 28,
  startSpeed: 620,
  minSpeed: 220,          // below this the comet freezes
  maxSpeed: 2400,
  flightDecay: 40,        // px/s lost per second while flying
  flightDecayPerKm: 6,    // extra decay per 1000 px of altitude (difficulty ramp)
  maxFlightDecay: 140,
  orbitGain: 300,         // px/s gained per second while orbiting
  orbitShrink: 18,        // orbit radius lost per second (orbiting forever = crash)
  grabRange: 240,         // extra distance beyond the planet surface where holding catches the orbit
  minOrbitGap: 50,        // closest orbit allowed when latching
  wallBounceKeep: 0.92,   // speed kept after bouncing off a side wall
  assistMaxAngle: 0.45,   // ~25 degrees: releases this close to a planet get steered onto it
  assistMaxDist: 1100,
  assistPassGap: 110,     // how far from the surface an assisted fling passes the planet
  catchBonus: 60,         // instant speed for every planet caught
  hitKeep: 0.7,           // speed kept after hitting a planet
  floorBounceKeep: 0.8,   // speed kept after falling to the bottom of the screen
  hitGrace: 120,          // a hit never leaves you closer than this to minSpeed
  minPlanetGap: 520,      // vertical distance between planets at the start
  maxPlanetGap: 760,
  planetGapPerPx: 0.012,
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

// Aim assist: among planets roughly in front of the release direction, pick the one closest
// in angle and return a point beside it (inside its grab zone, outside its surface), so a
// near-miss release still flies into a catchable orbit instead of into empty space.
function pickAssistTarget(x, y, dirX, dirY, planets, exclude) {
  const len = Math.hypot(dirX, dirY) || 1;
  const ux = dirX / len;
  const uy = dirY / len;
  let best = null;
  for (const p of planets) {
    if (p === exclude) continue;
    const passDist = p.radius + TUNING.assistPassGap;
    const dx = p.x - x;
    const dy = p.y - y;
    const dist = Math.hypot(dx, dy);
    if (dist > TUNING.assistMaxDist || dist <= passDist) continue;
    // The two side points that pass the planet at passDist; take the one nearest the aim.
    const nx = -dy / dist;
    const ny = dx / dist;
    for (const side of [1, -1]) {
      const ax = p.x + nx * passDist * side;
      const ay = p.y + ny * passDist * side;
      const al = Math.hypot(ax - x, ay - y);
      const angle = Math.acos(Math.max(-1, Math.min(1, ((ax - x) * ux + (ay - y) * uy) / al)));
      if (angle <= TUNING.assistMaxAngle && (!best || angle < best.angle)) {
        best = { planet: p, aimX: ax, aimY: ay, angle };
      }
    }
  }
  return best;
}

// Speed after a hit. A hit hurts but never ends the run by itself: it stops at
// minSpeed + hitGrace, leaving a few seconds to catch the next planet.
function speedAfterHit(speed, keep) {
  return Math.max(speed * keep, Math.min(speed, TUNING.minSpeed + TUNING.hitGrace));
}

// Next planet in the column: alternates sides (zigzag) so the path reads clearly,
// mixes small (fast, risky orbits) and big (safe) planets, and spaces them further
// apart as altitude grows. rand() returns [0, 1).
const PLANET_SIZES = [
  { radius: 38, weight: 2 },   // small: tight orbit, spins you up quickly
  { radius: 62, weight: 3 },
  { radius: 85, weight: 3 },
  { radius: 110, weight: 1 },  // big: wide, safe orbit
];

function nextPlanetLayout(prevSide, altitude, worldWidth, rand) {
  let total = 0;
  for (const s of PLANET_SIZES) total += s.weight;
  let pick = rand() * total;
  let radius = PLANET_SIZES[0].radius;
  for (const s of PLANET_SIZES) {
    pick -= s.weight;
    if (pick < 0) { radius = s.radius; break; }
  }
  // Mostly switch sides; sometimes stay, so the rhythm is not fully predictable.
  const side = rand() < 0.8 ? -prevSide : prevSide;
  const margin = 90 + radius;
  const laneCenter = side < 0 ? worldWidth * 0.28 : worldWidth * 0.72;
  const x = Math.max(margin, Math.min(worldWidth - margin, laneCenter + (rand() - 0.5) * 140));
  const baseGap = Math.min(TUNING.maxPlanetGap, TUNING.minPlanetGap + Math.max(0, altitude) * TUNING.planetGapPerPx);
  const gap = baseGap + (rand() - 0.5) * 120;
  return { x, radius, side, gap };
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
  module.exports = { TUNING, PLANET_SIZES, startOrbit, pickAssistTarget, speedAfterHit, nextPlanetLayout, orbitStep, tangentVelocity, flightDecay, speedFraction, speedColor, lerpColor };
}
