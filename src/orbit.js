// Pure comet/orbit math, kept free of Phaser so it can be unit-tested with node.

const TUNING = {
  cometRadius: 28,
  startSpeed: 620,
  minSpeed: 140,          // the comet never drops below this; the supernova is what kills you
  maxSpeed: 2400,
  flightDecay: 40,        // px/s lost per second while flying
  flightDecayPerKm: 6,    // extra decay per 1000 px of altitude (difficulty ramp)
  maxFlightDecay: 140,
  orbitGain: 300,         // px/s gained per second while orbiting (at the edge of the grab zone)
  closeOrbitBonus: 1.6,   // hugging the surface gains up to (1 + this) times faster
  grabRange: 160,         // extra distance beyond the planet surface where holding catches the orbit
  minOrbitGap: 34,        // closest orbit: just clear of the surface
  orbitSettleSpeed: 220,  // px/s the orbit radius eases out to minOrbitGap after a too-close grab
  homingTurn: 2.6,        // rad/s an assisted release curves toward its target
  homingTime: 0.45,       // seconds the release keeps curving
  wallBounceKeep: 0.92,   // speed kept after bouncing off a side wall
  assistMaxAngle: 0.45,   // ~25 degrees: releases this close to a planet get steered onto it
  assistMaxDist: 1100,
  assistPassGap: 110,     // how far from the surface an assisted fling passes the planet
  catchBonus: 60,         // instant speed for every planet caught
  hitKeep: 0.7,           // speed kept after hitting a planet
  maxOrbitSpin: 5,        // rad/s cap on visible orbit rotation so high speed stays readable
  assistMaxBelow: 40,     // assist never steers toward planets further below than this
  minZoom: 0.68,          // camera zoom at top speed
  perfectAngle: 0.12,     // release within ~7 degrees of the assist line = PERFECT
  perfectBonus: 140,
  asteroidFromMeters: 600,
  asteroidChance: 0.45,
  asteroidKeep: 0.85,
  asteroidRoam: 170,      // how far up/down from its spawn height an asteroid may drift
  blackHoleFromMeters: 1800,
  blackHoleChance: 0.3,
  blackHoleRadius: 34,
  blackHolePullRadius: 270,
  blackHoleWarp: 1.05,    // ~60 degrees: how much flying through the core turns your path
  blackHoleTurn: 6,       // max rad/s the pull can bend your path (at the core); the hole is not solid
  hitGrace: 120,          // a hit never leaves you closer than this to minSpeed
  novaStartBelow: 300,    // how far below the comet the supernova starts
  novaBaseSpeed: 160,     // px/s the wave climbs at the start
  novaRamp: 5,            // extra px/s every second
  novaMaxSpeed: 950,
  novaLeash: 250,         // the wave is never further than this below the visible screen (falling back = death)
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
  const cross = rx * vy - ry * vx;
  // Start exactly where the comet is (no snap) and ease out if it grabbed too close.
  return {
    angle: Math.atan2(ry, rx),
    radius: dist,
    targetRadius: Math.max(dist, planetRadius + TUNING.minOrbitGap),
    dir: cross < 0 ? -1 : 1,
  };
}

// 0 at the outer edge of the grab zone, 1 when skimming the surface.
function orbitCloseness(radius, planetRadius) {
  const t = 1 - (radius - planetRadius - TUNING.minOrbitGap) / (TUNING.grabRange - TUNING.minOrbitGap);
  return Math.max(0, Math.min(1, t));
}

// Advances an orbit by dt seconds. Orbits are stable (no crash); closer orbits gain speed
// faster, so diving in deep before grabbing is the skill.
function orbitStep(orbit, speed, dt, planetRadius) {
  const spin = Math.min(speed / orbit.radius, TUNING.maxOrbitSpin);
  const angle = orbit.angle + orbit.dir * spin * dt;
  const gain = TUNING.orbitGain * (1 + TUNING.closeOrbitBonus * orbitCloseness(orbit.radius, planetRadius));
  const target = orbit.targetRadius || orbit.radius;
  const radius = Math.min(target, orbit.radius + TUNING.orbitSettleSpeed * dt);
  return {
    orbit: { angle, radius, targetRadius: target, dir: orbit.dir },
    speed: Math.min(TUNING.maxSpeed, speed + gain * dt),
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
    if (p === exclude || p.y > y + TUNING.assistMaxBelow) continue;
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

// Altitude milestones (meters). Each one gets a banner and a new sky color, giving the
// run short-term goals beyond the raw number.
const ZONES = [
  { from: 0, name: 'LIFTOFF', sky: 0x2b1d5c },
  { from: 500, name: 'ORBIT', sky: 0x1f3a7a },
  { from: 1500, name: 'MACH 2', sky: 0x5a1f7a },
  { from: 3000, name: 'LIGHTSPEED', sky: 0x13606a },
  { from: 5000, name: 'HYPERSPACE', sky: 0x7a1f4a },
  { from: 8000, name: 'ESCAPE VELOCITY', sky: 0x7a5a12 },
];

function zoneIndexForAltitude(meters) {
  let index = 0;
  for (let i = 0; i < ZONES.length; i++) if (meters >= ZONES[i].from) index = i;
  return index;
}

// Score multiplier x1..x5 by speed: climbing fast is worth more than climbing slow,
// so the game always pushes you toward risky, fast play.
function speedMultiplier(speed) {
  return 1 + Math.min(4, Math.floor(speedFraction(speed) * 5));
}

// Rotates velocity (vx, vy) toward direction (dx, dy) by at most maxTurn radians, keeping speed.
function steerToward(vx, vy, dx, dy, maxTurn) {
  const speed = Math.hypot(vx, vy);
  const current = Math.atan2(vy, vx);
  let diff = Math.atan2(dy, dx) - current;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  const angle = current + Math.max(-maxTurn, Math.min(maxTurn, diff));
  return { vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed };
}

// Black hole pull: bends the velocity toward the hole, stronger when closer, without
// changing speed. Returns the new velocity.
function blackHolePull(hx, hy, x, y, vx, vy, dt) {
  const dx = hx - x;
  const dy = hy - y;
  const dist = Math.hypot(dx, dy);
  if (dist >= TUNING.blackHolePullRadius || dist === 0) return { vx, vy };
  return steerToward(vx, vy, dx, dy, TUNING.blackHoleTurn * (1 - dist / TUNING.blackHolePullRadius) * dt);
}

// Flying through a black hole's core turns your direction by blackHoleWarp, toward the
// side the hole was on (a dead-center pass turns right). Speed is kept.
function warpVelocity(hx, hy, x, y, vx, vy) {
  const cross = vx * (hy - y) - vy * (hx - x);
  const turn = (cross < 0 ? -1 : 1) * TUNING.blackHoleWarp;
  const cos = Math.cos(turn);
  const sin = Math.sin(turn);
  return { vx: vx * cos - vy * sin, vy: vx * sin + vy * cos };
}

// How fast the supernova climbs after `seconds` of play.
function novaSpeed(seconds) {
  return Math.min(TUNING.novaMaxSpeed, TUNING.novaBaseSpeed + TUNING.novaRamp * seconds);
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

// ---------- game feel (pure, no difficulty impact) ----------

const FEEL = {
  chainBonus: 50,          // score per PERFECT in the current chain (x1: 50, x2: 100, ...)
  chainBonusMax: 500,
  closeCallEnter: 180,     // supernova gap (px) that arms a close call
  closeCallExit: 420,      // gap you must get back to for it to count
  closeCallBonus: 250,
  slowMoHold: 0.35,        // seconds at slowMoScale after a close call
  slowMoEase: 0.3,         // seconds to ease back to full speed
  slowMoScale: 0.35,
  hitstopPerfect: 0.065,   // seconds of freeze on PERFECT
  hitstopGrab: 0.035,
};

// Score bonus for the chain-th consecutive PERFECT (chain starts at 1).
function perfectChainBonus(chain) {
  if (chain < 1) return 0;
  return Math.min(FEEL.chainBonusMax, FEEL.chainBonus * chain);
}

// Close call tracker: arms when the supernova gap drops under closeCallEnter and fires
// once when the player gets back over closeCallExit. Returns the new armed flag + trigger.
function closeCallStep(armed, gap) {
  if (!armed) return { armed: gap < FEEL.closeCallEnter, triggered: false };
  if (gap > FEEL.closeCallExit) return { armed: false, triggered: true };
  return { armed: true, triggered: false };
}

// Simulation time scale `seconds` after a close call: hold low, then ease (smoothstep) back to 1.
function slowMoScale(seconds) {
  if (seconds < 0) return 1;
  if (seconds < FEEL.slowMoHold) return FEEL.slowMoScale;
  const t = (seconds - FEEL.slowMoHold) / FEEL.slowMoEase;
  if (t >= 1) return 1;
  const s = t * t * (3 - 2 * t);
  return FEEL.slowMoScale + (1 - FEEL.slowMoScale) * s;
}

// Comet stretch along its velocity: faster and accelerating = longer. Always >= 1.
// accel is the smoothed speed change in px/s per second (negative = braking, ignored).
function cometStretch(fraction, accel) {
  const base = 1 + 0.38 * Math.max(0, Math.min(1, fraction));
  const kick = Math.max(0, Math.min(0.22, accel / 6000));
  return Math.min(1.6, base + kick);
}

if (typeof module !== 'undefined') {
  module.exports = { FEEL, perfectChainBonus, closeCallStep, slowMoScale, cometStretch, TUNING, orbitCloseness, novaSpeed, steerToward, PLANET_SIZES, ZONES, zoneIndexForAltitude, speedMultiplier, blackHolePull, warpVelocity, startOrbit, pickAssistTarget, speedAfterHit, nextPlanetLayout, orbitStep, tangentVelocity, flightDecay, speedFraction, speedColor, lerpColor };
}
