// Pure comet/orbit math, kept free of Phaser so it can be unit-tested with node.

const TUNING = {
  cometRadius: 28,
  startSpeed: 620,
  minSpeed: 140,          // the comet never drops below this; the supernova is what kills you
  maxSpeed: 8000,          // absolute top speed (800 km/s, deep past the last zone)
  visualTopSpeed: 4500,    // speedFraction() / score multiplier reference: colors and x5 stay where they were
  zoneSpeedPerMeter: 0.1,  // past the last zone the cap keeps creeping up by this per meter
  // MOMENTUM: the faster you go, the faster you accelerate. Every speed gain (orbit, catch,
  // PERFECT, milestone) is multiplied by 1 + momentumGain * momentum(speed).
  momentumFrom: 1000,      // px/s where momentum starts building (0 below)
  momentumGain: 1.2,       // gain multiplier at full momentum = 1 + this
  momentumZoomOut: 0.06,   // extra camera zoom-out at full momentum (feel only)
  momentumVisualFrom: 2000, // px/s (200 km/s) where the momentum VISUALS start building
  momentumVisualEase: 2.5,  // ease-out power: the visuals are clearly up by ~300 km/s
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
  novaMaxSpeed: 950,      // wave top speed in the first zone; it scales with the zone's speed cap...
  novaMaxAbsolute: 1900,  // ...up to this, so late zones at 600-800 km/s stay dangerous
  novaAltitudeRamp: 0.01, // extra px/s per meter of best altitude, so faster zones get a faster wave
  novaLeash: 250,         // the wave is never further than this below the visible screen (falling back = death)
  minPlanetGap: 520,      // vertical distance between planets at the start
  maxPlanetGap: 760,
  planetGapPerPx: 0.012,
  catchGrace: 0.18,       // s: a hold this late after touching a planet still latches (scrape, then orbit)
  scrapeSpeed: 420,       // px/s the comet slides along the surface during the grace window
  grabSpeedFrom: 1000,    // above this speed the grab zone widens, so reactive holds at speed still land
  grabSpeedGrow: 0.04,    // extra grab px per px/s above grabSpeedFrom
  grabSpeedMaxExtra: 70,
  grabBelowMargin: 30,    // a planet whose top is further below the comet than this is "behind" you
  grabForwardCos: 0.5,    // ...unless it is within 60 degrees of where you are flying
  overspeedHold: 1.2,     // s at the speed cap in orbit before the planet lets go of you
  overspeedUp: -0.6,      // the overspeed fling only happens while the tangent points this much upward
  autoCatchFlings: 3,     // the first assisted flings of a run catch their target by themselves...
  autoCatchSeconds: 20,   // ...but only this early in the run
  earlyHitKeep: 0.85,     // planet bumps in the first zones only cost 15% (hitKeep later)
  earlyHitZones: 2,       // zones 0..earlyHitZones-1 (LIFTOFF, ORBIT) use earlyHitKeep
  secondWindBefore: 1500, // meters: the one-time SECOND WIND only saves runs below HYPERSONIC
  secondWindMinCatches: 3, // ...and only runs that caught this many planets (an idle player never earns it)
  secondWindSpeed: 820,   // min speed after it (Unbreakable uses 1000)
  secondWindPush: 400,    // px below the comet the supernova is pushed (Unbreakable: 520)
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
// boost (optional, from upgrade cards): { gainMul, closeMul } multiply orbitGain / closeOrbitBonus.
// boost.tighten (px/s, Tight Spin): the orbit slowly spirals in toward the surface, so even an
// early grab ends up in a fast close orbit. Gains are scaled by momentum (see momentumGainMul).
function orbitStep(orbit, speed, dt, planetRadius, maxSpeed, boost) {
  const gainMul = boost && boost.gainMul ? boost.gainMul : 1;
  const closeMul = boost && boost.closeMul ? boost.closeMul : 1;
  const tighten = boost && boost.tighten ? boost.tighten : 0;
  const spin = Math.min(speed / orbit.radius, TUNING.maxOrbitSpin);
  const angle = orbit.angle + orbit.dir * spin * dt;
  const gain = TUNING.orbitGain * gainMul * momentumGainMul(speed) * (1 + TUNING.closeOrbitBonus * closeMul * orbitCloseness(orbit.radius, planetRadius));
  let target = orbit.targetRadius || orbit.radius;
  if (tighten > 0) target = Math.max(planetRadius + TUNING.minOrbitGap, target - tighten * dt);
  // Ease toward the target either way (out after a too-close grab, in while tightening).
  const settle = TUNING.orbitSettleSpeed * dt;
  const radius = orbit.radius < target ? Math.min(target, orbit.radius + settle) : Math.max(target, orbit.radius - settle);
  return {
    orbit: { angle, radius, targetRadius: target, dir: orbit.dir },
    // Never above the cap, but never cut down either (the cap only grows with altitude).
    speed: Math.max(speed, Math.min(maxSpeed || TUNING.maxSpeed, speed + gain * dt)),
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
// maxSpeed: the speed cap (px/s, readout = /10 km/s) when the zone starts. Between zones the cap
// rises smoothly, so the number keeps climbing for the whole run.
// Visual fields (art only, see src/art.js): each zone is a new sketchbook page.
// sky/paper = paper color, ink = pen color on that page, fx = extra marks drawn on the page.
const ZONES = [
  { from: 0, name: 'LIFTOFF', sky: 0x1d2747, paper: 0x1d2747, ink: 0xf4ead0, fx: 'none', maxSpeed: 2400 },
  { from: 500, name: 'ORBIT', sky: 0x123f45, paper: 0x123f45, ink: 0xf4ead0, fx: 'none', maxSpeed: 2700 },
  { from: 1500, name: 'HYPERSONIC', sky: 0x4a1a22, paper: 0x4a1a22, ink: 0xf4ead0, fx: 'heat', maxSpeed: 3100 },
  { from: 3000, name: 'WARP SPEED', sky: 0x121116, paper: 0x121116, ink: 0xf4ead0, fx: 'streaks', maxSpeed: 3700 },
  { from: 5000, name: 'HYPERSPACE', sky: 0x2e1d4f, paper: 0x2e1d4f, ink: 0xf4ead0, fx: 'grid', maxSpeed: 4400 },
  { from: 8000, name: 'ESCAPE VELOCITY', sky: 0xefdcae, paper: 0xefdcae, ink: 0x2a2018, fx: 'rays', maxSpeed: 5200 },
];

// Speed cap at an altitude (meters): interpolates between zone caps, then creeps up to TUNING.maxSpeed.
function maxSpeedForAltitude(meters) {
  const m = Math.max(0, meters);
  for (let i = 0; i < ZONES.length - 1; i++) {
    const a = ZONES[i];
    const b = ZONES[i + 1];
    if (m < b.from) return a.maxSpeed + (b.maxSpeed - a.maxSpeed) * ((m - a.from) / (b.from - a.from));
  }
  const last = ZONES[ZONES.length - 1];
  return Math.min(TUNING.maxSpeed, last.maxSpeed + (m - last.from) * TUNING.zoneSpeedPerMeter);
}

// Grab zone (px beyond the surface) at a speed: wider when fast, because at 300 km/s a
// human reaction lands the hold a couple of hundred px late.
function grabRangeForSpeed(speed) {
  const extra = Math.max(0, speed - TUNING.grabSpeedFrom) * TUNING.grabSpeedGrow;
  return TUNING.grabRange + Math.min(TUNING.grabSpeedMaxExtra, extra);
}

// Only planets at/above the comet (or ahead of its flight) can be grabbed, so a panic hold
// never latches onto a planet you already passed and drags you back toward the supernova.
function canGrabPlanet(x, y, vx, vy, planet) {
  if (planet.y - planet.radius <= y + TUNING.grabBelowMargin) return true;
  const dx = planet.x - x;
  const dy = planet.y - y;
  const len = Math.hypot(dx, dy) * Math.hypot(vx, vy);
  return len > 0 && (dx * vx + dy * vy) / len >= TUNING.grabForwardCos;
}

// Overspeed: after holding at the cap for overspeedHold seconds the planet lets go, but only while
// the tangent (ux, uy, unit) points upward, so holding forever flings you up instead of trapping you.
function overspeedFling(secondsAtCap, ux, uy) {
  return secondsAtCap >= TUNING.overspeedHold && uy <= TUNING.overspeedUp;
}

// Whether an assisted fling (the n-th of the run, 1-based) at `seconds` catches its target by itself.
function autoCatchAllowed(flingNumber, seconds) {
  return flingNumber >= 1 && flingNumber <= TUNING.autoCatchFlings && seconds < TUNING.autoCatchSeconds;
}

// Speed kept after bumping a planet in zone zoneIndex: softer early, so one mistake does not
// end a learning run before the first card / HYPERSONIC.
function planetHitKeep(zoneIndex) {
  return zoneIndex < TUNING.earlyHitZones ? TUNING.earlyHitKeep : TUNING.hitKeep;
}

// One-time SECOND WIND: the first supernova catch of a run below secondWindBefore meters is survived,
// if the player has been playing (catches = planets caught this run), so idling never earns it.
function secondWindAllowed(used, meters, catches) {
  return !used && meters < TUNING.secondWindBefore && catches >= TUNING.secondWindMinCatches;
}

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

// Supernova top speed at an altitude: grows in step with the zone speed cap (the first zone
// keeps novaMaxSpeed), so a comet doing 700 km/s still has a wave on its tail.
function novaMaxForAltitude(meters) {
  const scale = maxSpeedForAltitude(meters) / ZONES[0].maxSpeed;
  return Math.min(TUNING.novaMaxAbsolute, TUNING.novaMaxSpeed * scale);
}

// How fast the supernova climbs after `seconds` of play; meters (best altitude, optional) adds a
// little and raises its top speed, so the wave keeps pace when the speed cap rises in later zones.
function novaSpeed(seconds, meters) {
  const m = Math.max(0, meters || 0);
  const climb = TUNING.novaAltitudeRamp * m;
  return Math.min(novaMaxForAltitude(m), TUNING.novaBaseSpeed + TUNING.novaRamp * seconds + climb);
}

function flightDecay(altitude) {
  return Math.min(
    TUNING.maxFlightDecay,
    TUNING.flightDecay + (Math.max(0, altitude) / 1000) * TUNING.flightDecayPerKm
  );
}

// 0 = about to freeze, 1 = 450 km/s (visualTopSpeed). Drives the speed colors and the multiplier;
// above it, momentum() carries the escalation.
function speedFraction(speed) {
  const t = (speed - TUNING.minSpeed) / (TUNING.visualTopSpeed - TUNING.minSpeed);
  return Math.max(0, Math.min(1, t));
}

// MOMENTUM 0..1: 0 up to momentumFrom, 1 at the absolute cap. Drives the gain snowball and
// the momentum visuals (flame size, speed-line weight, zoom, the HUD's ink cue).
function momentum(speed) {
  const t = (speed - TUNING.momentumFrom) / (TUNING.maxSpeed - TUNING.momentumFrom);
  return Math.max(0, Math.min(1, t));
}

// MOMENTUM VISUALS 0..1 (flame crown, speed-line weight, extra zoom, HUD cue). Feel only: the
// physics keep momentum(). The linear curve reads as nothing happening until ~400 km/s, so the
// visuals ease out from 200 km/s instead and are clearly snowballing by 250-300 km/s.
function momentumVisual(speed) {
  const u = (speed - TUNING.momentumVisualFrom) / (TUNING.maxSpeed - TUNING.momentumVisualFrom);
  if (u <= 0) return 0;
  if (u >= 1) return 1;
  return 1 - Math.pow(1 - u, TUNING.momentumVisualEase);
}

// Every speed gain is multiplied by this: good play snowballs (x1 slow, up to 1 + momentumGain).
function momentumGainMul(speed) {
  return 1 + TUNING.momentumGain * momentum(speed);
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
  milestoneSpeedBase: 40,  // milestone speed bonus = base + this * level (NICE 120, BLAZING 200, UNSTOPPABLE 280)
  milestoneSpeed: 80,
};

// Score bonus for the chain-th consecutive PERFECT (chain starts at 1).
function perfectChainBonus(chain) {
  if (chain < 1) return 0;
  return Math.min(FEEL.chainBonusMax, FEEL.chainBonus * chain);
}

// PERFECT chain milestones: chain 3 = NICE! (1), 6 = BLAZING! (2), 12 and every +12 = UNSTOPPABLE! (3).
// Low enough that mid-skill players reach the first stamps; 0 for every other chain.
const CHAIN_MILESTONE_NAMES = ['', 'NICE!', 'BLAZING!', 'UNSTOPPABLE!'];

function chainMilestoneLevel(chain) {
  if (chain === 3) return 1;
  if (chain === 6) return 2;
  if (chain >= 12 && chain % 12 === 0) return 3;
  return 0;
}

// Instant speed for reaching a milestone (px/s): grows with the level.
function milestoneSpeedBonus(level) {
  return level > 0 ? FEEL.milestoneSpeed * level + FEEL.milestoneSpeedBase : 0;
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
  module.exports = { momentum, momentumVisual, momentumGainMul, novaMaxForAltitude, planetHitKeep, secondWindAllowed, CHAIN_MILESTONE_NAMES, chainMilestoneLevel, milestoneSpeedBonus, maxSpeedForAltitude, grabRangeForSpeed, canGrabPlanet, overspeedFling, autoCatchAllowed, FEEL, perfectChainBonus, closeCallStep, slowMoScale, cometStretch, TUNING, orbitCloseness, novaSpeed, steerToward, PLANET_SIZES, ZONES, zoneIndexForAltitude, speedMultiplier, blackHolePull, warpVelocity, startOrbit, pickAssistTarget, speedAfterHit, nextPlanetLayout, orbitStep, tangentVelocity, flightDecay, speedFraction, speedColor, lerpColor };
}
