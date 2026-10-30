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
  // CRUISE: between decayCruiseFrom and decayFullFrom the decay shrinks with speed (proportional-ish, never
  // under decayMinShare of it), so a flight holds 60-150 km/s for many seconds: a flat 140 px/s per second
  // turned every slow flight into a 14 km/s crawl in a speed game. Below decayCruiseFrom (a real crawl) it
  // is the full decay again: a comet nobody steers still runs down (idle), and the crawl rescue takes over.
  decayFullFrom: 1500,
  decayCruiseFrom: 600,
  decayMinShare: 0.4,
  orbitGain: 300,         // px/s gained per second while orbiting (at the edge of the grab zone)
  closeOrbitBonus: 1.6,   // hugging the surface gains up to (1 + this) times faster
  grabRange: 160,         // extra distance beyond the planet surface where holding catches the orbit
  minOrbitGap: 34,        // closest orbit: just clear of the surface
  orbitSettleSpeed: 220,  // px/s the orbit radius eases out to minOrbitGap after a too-close grab
  homingTurn: 2.6,        // rad/s an assisted release curves toward its target
  homingTime: 0.45,       // seconds the release keeps curving
  // A wall hit is a plain MIRROR (wallBounceVelocity: vx flips, vy unchanged): a fling that was falling keeps
  // falling, so the player has to aim. (Turning every hit up and inward made blind tapping climb forever.)
  wallBounceKeep: 0.93,   // speed kept after bouncing off a side wall from wallKeepFullFrom up...
  wallBounceKeepSlow: 0.96, // ...and at or below wallKeepSlowUnder (a slow comet is not punished twice)
  wallKeepSlowUnder: 800,
  wallKeepFullFrom: 2000,
  wallBounceHighLoss: 0.1, // ...minus up to this at the absolute cap (see highSpeedShare)
  wallKicksPerFling: 2,   // Wall Kick works this many times per flight after an aimed fling (an unaimed one gets none)
  wallKickRechargeUp: 0,  // ...and only after a fling that LAUNCHES upward (its aim's unit vy below -this): a flat
                          // sideways release rode the kicks to BEYOND
  wallKickCooldown: 1.5,  // s between two kicks
  wallKickClimbGain: 1.15, // a kick climbs at the incoming climb x this (unit vy)...
  wallKickClimbMin: 0.3,  // ...at least this (a flat or falling flight gets only a shallow climb)...
  wallKickClimbMax: 0.8,  // ...and at most this, unless it already came in steeper
  wallKickSteepFrom: 0.3, // a flight climbing at least this steeply (unit) gets the classic steep kick instead
  wallKickNearCap: 0.85,  // a kick adds no speed once the comet is this close to its speed cap
  // HIGH-SPEED DRAG: in flight, extra decay that grows with speed so a cap you did not earn bleeds away.
  dragFrom: 4500,         // px/s (450 km/s) where it starts; the early game never feels it
  dragMax: 1600,          // px/s per second at the absolute cap (scaled by highSpeedShare)
  dragNoDecayFrom: 6000,  // Afterburner / Slipstream cancel it only below this speed (600 km/s)
  // Orbit gain tapers off near the top so 800 km/s is reached by PERFECT chains, not by sitting in orbit.
  orbitTaperFrom: 6000,
  orbitTaperMin: 0.2,     // gain multiplier left at the absolute cap
  hitHighLoss: 0.2,       // a planet bump at the absolute cap keeps this much less speed (scaled by highSpeedShare)
  assistMaxAngle: 0.45,   // ~25 degrees: releases this close to a planet get steered onto it
  assistMaxDist: 1100,
  assistPassGap: 110,     // how far from the surface an assisted fling passes the planet
  catchBonus: 60,         // instant speed for every planet caught
  hitKeep: 0.7,           // speed kept after hitting a planet
  maxOrbitSpin: 5,        // rad/s cap on visible orbit rotation so high speed stays readable...
  orbitSpinBoost: 8,      // ...plus up to this at the absolute cap, so a late orbit (fast wave) comes round before the wave arrives
  orbitSpinBoostFrom: 4500, // px/s where that extra spin starts (the early game keeps the plain cap)
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
  novaRamp: 5,            // extra px/s every second...
  novaRampEarly: 3,       // ...plus this much more during the first novaRampEarlySeconds (walls became deflections
  novaRampEarlySeconds: 60, // that climb for you: a mid run got twice as long). Not on the first (tutorial) runs;
                          // capped in time so the late game (strong runs, BEYOND) keeps its balance.
  novaMaxSpeed: 950,      // wave top speed in the first zone; it scales with the zone's speed cap...
  novaMaxAbsolute: 1900,  // ...up to this by ESCAPE VELOCITY (page 5)...
  novaPerPage: 150,       // ...then every new page past ESCAPE VELOCITY raises the top speed by this...
  novaMaxLate: 2250,      // ...up to this (a clean 'release on green' climb stays a little faster, so BEYOND is reachable)
  novaHardCap: 2250,      // px/s: the wave never goes faster than this, upgrade cards (+5% each) included...
  novaBeyondPerPage: 1000, // ...until BEYOND: from there top speed and cap rise by this per endless page (10,000 m)...
  novaBeyondMax: 3000,    // ...by at most this, so a strong run has an end instead of a stable loop (the walls no
                          // longer end runs by pinballing, so the wave has to: ~4-5 min for a strong run)
  novaLateRamp: 0.01,     // extra px/s per meter past ESCAPE VELOCITY (small: the time ramp already reaches the top speed)
  lateHazardPerPage: 0.06, // asteroid / black hole chance added per page past ESCAPE VELOCITY
  maxAsteroidChance: 0.8,
  maxBlackHoleChance: 0.5,
  novaAltitudeRamp: 0.01, // extra px/s per meter of best altitude, so faster zones get a faster wave
  novaLeash: 250,         // the wave is never further than this below the visible screen (falling back = death)
  novaLeashSeconds: 0.8,  // ...growing by 10,000 m (half a page past ESCAPE VELOCITY) to this many seconds of wave travel:
                          // a leash in px is gone in a blink at 2900 px/s; by time the wave always takes ~1 s to reach you
  // CALM START: every run opens with a slow wave that ramps up over the first seconds.
  novaCalmSeconds: 15,    // s the calm start lasts
  novaCalmFrom: 0.7,      // wave speed share at second 0, easing up to 1 by novaCalmSeconds
  novaCalmStartBelow: 120, // extra px below the comet the wave starts (on top of novaStartBelow)
  // First runs (finger tutorial on): a short LEARNING WINDOW (see learningWindowOpen) with a crawling wave,
  // the wide assist, soft bumps and no penalty pops. It is a window, not the whole run: an autopilot that
  // lives inside it forever would poison the best altitude and missions.
  novaLearnMul: 0.35,
  tutorialCalmSeconds: 30, // the calm start on the tutorial runs (after the learning window) lasts this long
  novaLearnStartBelow: 330,
  learnWindowCycles: 3,    // the window closes after this many good catch-and-release cycles of the run...
  learnWindowSeconds: 30,  // ...or this many seconds...
  learnWindowMeters: 1500, // ...or this altitude (HYPERSONIC), whichever comes first...
  learnIdleSeconds: 25,    // ...and at this time anyway if the player never caught a planet (idle / lost player)
  learnExitSeconds: 4,     // s the wave takes to ease from the crawl back to the calm start after the window
  tutorialHomingTime: 0.3, // s an assisted fling in the tutorial takes to turn onto its target, however wide the angle
  // Guided first-run tutorial (guidedTutorialStep): the world eases into near-pause slow motion over
  // guidedEaseIn s while a step waits for the player, and back to normal over guidedEaseOut s.
  guidedSlowScale: 0.04,
  guidedEaseIn: 0.25,
  guidedEaseOut: 0.2,
  guidedHoldLead: 60,      // px before a planet's grab zone where the HOLD step starts (the ease-in carries the comet on)
  guidedRounds: 2,         // planets the guided tutorial walks through (HOLD -> full lap -> LET GO on each)
  guidedLap: Math.PI * 2 - 0.05, // rad of orbit before LET GO may show (one full revolution)
  guidedAimAngle: 0.3,     // rad: after the lap, LET GO shows once the tangent points this close to the target
  guidedPassGap: 50,       // px off the target's surface a guided fling passes (well inside the grab zone)
  guidedFlingBoost: 220,   // px/s added by a guided fling (it visibly accelerates to the next planet)
  warpMinClimbShare: 0.5, // a black-hole warp leaves a climbing comet at least 30 degrees above flat (warpVelocity)
  // Wall Kick bounces (wallKickVelocity, the card only): no sideways crawl, no dive out of a climb, no pinball.
  wallVxShare: 0.6,
  wallCrossWidth: 664,     // px between the walls the comet's center can travel (720 - 2 x cometRadius)...
  wallCrossSeconds: 1,     // ...and the s a crossing takes at least after a wall hit (|vx| cap)
  wallMinVxShare: 0.15,    // ...and leaves the wall with at least this share of its speed sideways
  // Crawl rescue (crawlRescueStep): crawling this slow with no planet in reach this long -> one drifts in.
  crawlSpeed: 600,
  crawlSeconds: 0.6,       // (s crawling before the rescue; the slide then takes ~0.3 s: a planet in reach within ~1 s)
  crawlCooldown: 2,
  planetDriftSpeed: 1500,  // px/s a rescued planet slides into reach
  pickSteerSeconds: 1.5,   // s a fling after a card pick is steered onto a grabbable planet
  pickSteerTurn: 3,        // rad/s of that steer
  tutorialLetGoAfter: 1.2, // s in an orbit with only the wide assist before LET GO shows anyway...
  letGoEta: 2,             // ...or at once when the wave is less than this many s away...
  letGoGap: 1000,          // ...or less than this many px below the comet
  // HUD warning: the orbit's down swing only counts toward the eta once the wave is this close (s),
  // so a calm orbit with the wave far away does not raise false alarms.
  etaSwingUnder: 2,
  etaClimbFloor: 0.6,      // a climbing comet's closing speed is never counted below this share of the wave
  // LATE ORBIT FAIRNESS (past ESCAPE VELOCITY, eased in like the late leash): during the first
  // orbitNovaGrace s of an orbit the wave climbs at orbitNovaMul of its speed, so a late orbit low on the
  // screen comes round to a green aim before the wave closes ~1800 px. An orbit caught right after a
  // PERFECT release gets orbitNovaGracePerfect s instead: waiting for gold is paid back on the next orbit.
  // (The wave sits at its leash late, so pushing it back would be undone next frame: time is the reward.)
  // Past BEYOND the help fades out again over orbitFairFadeSpan m, so the endless pages keep an end.
  assistCoyote: 0.12,      // s a late green (and its gold) stays valid after the window swept past
  orbitNovaGrace: 0,
  orbitNovaGracePerfect: 1.2,
  orbitNovaMul: 0.9,
  orbitFairFadeFrom: 40000,
  orbitFairFadeSpan: 15000,
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
  // EARLY HELP (every run, first earlyHelpSeconds s; full until earlyHelpFull, then fading out): returning
  // players skipping the tutorial died 2-3 s in after one falling fling. A falling free flight curls back up
  // (earlyCurlTurn rad/s, toward the next planet above) and the green aim cone is wider (earlyAssistAngle).
  earlyHelpFull: 10,
  earlyHelpSeconds: 15,
  earlyCurlTurn: 2.2,
  earlyAssistAngle: 0.7,
  // Orbit warning (GameScene: aim line pulse + hud.setOrbitDanger): orbiting with the wave this close (s).
  orbitDangerEta: 1.5,
  orbitDangerFull: 0.3,   // ...full strength at this eta
  // A latch (orbit start) never leaves the wave closer than this many s of orbit eta: the down swing of a
  // fresh orbit low on the screen killed in 0.2-0.3 s, faster than anyone can react to the warning.
  latchMinEta: 0.9,
  latchMaxPush: 450,      // px the wave may be pushed back for that, at most
};

// Catch feel (juice, not difficulty): world time scale t s after a catch: CATCH_SLOW.from easing back to 1
// over CATCH_SLOW.time (light and short: the game must stay fast). 1 outside that.
const CATCH_SLOW = { from: 0.6, time: 0.18, chainGap: 0.4 };
function catchSlowScale(t) {
  if (!(t >= 0) || t >= CATCH_SLOW.time) return 1;
  const k = t / CATCH_SLOW.time;
  return CATCH_SLOW.from + (1 - CATCH_SLOW.from) * k * k * (3 - 2 * k);
}

// Share of the early help (0..1) `seconds` into a run: 1 until earlyHelpFull, fading to 0 at earlyHelpSeconds.
function earlyHelpShare(seconds) {
  const t = seconds || 0;
  if (t <= TUNING.earlyHelpFull) return 1;
  return Math.max(0, 1 - (t - TUNING.earlyHelpFull) / (TUNING.earlyHelpSeconds - TUNING.earlyHelpFull));
}

// Orbit warning strength 0..1 for an orbit eta (s): 0 at orbitDangerEta and above, 1 at orbitDangerFull.
function orbitDangerLevel(eta) {
  if (!(eta < TUNING.orbitDangerEta)) return 0;
  return Math.min(1, (TUNING.orbitDangerEta - eta) / (TUNING.orbitDangerEta - TUNING.orbitDangerFull));
}

// Whether a fling recharges Wall Kick: aimed (assist) and launched upward (unitVy: the aim's unit vy).
function wallKickRecharges(aimed, unitVy) {
  return !!aimed && unitVy < -TUNING.wallKickRechargeUp;
}

// Unit vy a Wall Kick leaves the wall with, from the incoming unit vy: the climb scales with the incoming
// climb (no free near-vertical climb from a flat fling), between wallKickClimbMin and wallKickClimbMax.
function wallKickClimb(uyIn) {
  const up = Math.max(0, -(uyIn || 0));
  const max = Math.max(TUNING.wallKickClimbMax, Math.min(0.98, up));
  return -Math.max(TUNING.wallKickClimbMin, Math.min(max, up * TUNING.wallKickClimbGain));
}

// PERFECT window (rad, half-angle) at a speed: base (TUNING.perfectAngle or a card's) scaled up with the
// late orbit spin boost, so gold stays on screen as long at 600 km/s as it does early (a fixed angle
// shrinks to about one frame at full spin and going for gold becomes a coin toss). Never wider than
// the green assist cone.
function perfectAngleAt(base, speed) {
  const scaled = base * (orbitSpinCap(speed || 0) / TUNING.maxOrbitSpin);
  return Math.min(TUNING.assistMaxAngle * 0.8, Math.max(base, scaled));
}

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
  const spin = Math.min(speed / orbit.radius, orbitSpinCap(speed));
  const angle = orbit.angle + orbit.dir * spin * dt;
  const gain = TUNING.orbitGain * gainMul * momentumGainMul(speed) * orbitTaper(speed) * (1 + TUNING.closeOrbitBonus * closeMul * orbitCloseness(orbit.radius, planetRadius));
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

// Orbit rotation cap (rad/s) at a speed: maxOrbitSpin, rising above orbitSpinBoostFrom up to + orbitSpinBoost.
function orbitSpinCap(speed) {
  const t = (speed - TUNING.orbitSpinBoostFrom) / (TUNING.maxSpeed - TUNING.orbitSpinBoostFrom);
  return TUNING.maxOrbitSpin + TUNING.orbitSpinBoost * Math.max(0, Math.min(1, t));
}

// Orbit gain multiplier near the top: 1 below orbitTaperFrom, falling linearly to orbitTaperMin at the
// absolute cap, so the last 200 km/s come from PERFECTs / chains / milestones, not from spinning.
function orbitTaper(speed) {
  const t = (speed - TUNING.orbitTaperFrom) / (TUNING.maxSpeed - TUNING.orbitTaperFrom);
  if (t <= 0) return 1;
  return 1 - (1 - TUNING.orbitTaperMin) * Math.min(1, t);
}

// 0 up to dragFrom (450 km/s), rising as a square to 1 at the absolute cap: how much of the high-speed
// penalties (drag, harder wall and planet bumps) apply. The early game never feels any of them.
function highSpeedShare(speed, from) {
  const t = (speed - (from === undefined ? TUNING.dragFrom : from)) / (TUNING.maxSpeed - TUNING.dragFrom);
  if (t <= 0) return 0;
  return Math.min(1, t) * Math.min(1, t);
}

// Extra flight decay (px/s per second) at a speed. decayMul: Aerodynamic's flightDecayMul (it cuts the
// drag too). noDecay: Afterburner / Slipstream active; they cancel the drag only below dragNoDecayFrom.
function highSpeedDrag(speed, decayMul, noDecay) {
  const share = highSpeedShare(speed, noDecay ? TUNING.dragNoDecayFrom : TUNING.dragFrom);
  return TUNING.dragMax * share * (decayMul === undefined ? 1 : decayMul);
}

// Speed kept after a plain side-wall bounce: wallBounceKeepSlow for a slow comet, easing to wallBounceKeep by
// wallKeepFullFrom, then minus up to wallBounceHighLoss at the cap.
function wallBounceKeepAt(speed) {
  const v = Math.max(0, speed || 0);
  const t = Math.max(0, Math.min(1, (v - TUNING.wallKeepSlowUnder) / (TUNING.wallKeepFullFrom - TUNING.wallKeepSlowUnder)));
  const base = TUNING.wallBounceKeepSlow + (TUNING.wallBounceKeep - TUNING.wallBounceKeepSlow) * t;
  return base - TUNING.wallBounceHighLoss * highSpeedShare(v);
}

// A planet touched this soon (s) after a side-wall hit is slid round (wallPlanetSlide) instead of bumped:
// the mirrored exit runs straight into planets standing in the edge column, and a -30% bump there read as
// a second penalty for the same wall.
const WALL_PLANET_SLIDE = { window: 0.6, keep: 0.95 };
function wallPlanetSlideActive(sinceWall) {
  return sinceWall >= 0 && sinceWall < WALL_PLANET_SLIDE.window;
}

// Velocity that slides a comet round a planet it touched (unit normal nx, ny from the planet center to the
// comet): the surface tangent closest to its current heading, same speed (the caller takes the loss).
function wallPlanetSlide(vx, vy, nx, ny) {
  const sp = Math.hypot(vx, vy);
  let tx = -ny;
  let ty = nx;
  if (tx * vx + ty * vy < 0) { tx = -tx; ty = -ty; }
  return { vx: tx * sp, vy: ty * sp };
}

// Wall Kick: whether the next wall hit of this flight is still a kick (kicksUsed since the last aimed fling).
// sinceLastKick (s, optional): a kick needs wallKickCooldown s since the last one.
function wallKickAllowed(kicksUsed, sinceLastKick) {
  if (sinceLastKick !== undefined && sinceLastKick < TUNING.wallKickCooldown) return false;
  return kicksUsed < TUNING.wallKicksPerFling;
}

// Speed a Wall Kick adds: the full bonus well below the cap, never more than up to wallKickNearCap * cap.
function wallKickGain(speed, cap, bonus) {
  return Math.max(0, Math.min(bonus, cap * TUNING.wallKickNearCap - speed));
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
// maxAngle (optional): a wider cone than assistMaxAngle (the early help).
function pickAssistTarget(x, y, dirX, dirY, planets, exclude, maxAngle) {
  const cone = maxAngle === undefined ? TUNING.assistMaxAngle : maxAngle;
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
      if (angle <= cone && (!best || angle < best.angle)) {
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
  { from: 12000, name: 'LIGHTSPEED', sky: 0x5a3b22, paper: 0x5a3b22, ink: 0xf4ead0, fx: 'lightspeed', maxSpeed: 5600 },
  { from: 17000, name: 'WORMHOLE', sky: 0x1f3b2c, paper: 0x1f3b2c, ink: 0xf4ead0, fx: 'spiral', maxSpeed: 6100 },
  { from: 23000, name: 'EVENT HORIZON', sky: 0x1b3f6b, paper: 0x1b3f6b, ink: 0xf4ead0, fx: 'blueprint', maxSpeed: 6700 },
  { from: 30000, name: 'BIG BANG', sky: 0xf1eee4, paper: 0xf1eee4, ink: 0x1d2747, fx: 'graph', maxSpeed: 7400 },
  { from: 40000, name: 'BEYOND', sky: 0x2a1f1a, paper: 0x2a1f1a, ink: 0xf4ead0, fx: 'charcoal', maxSpeed: 8000 },
];

// Past the last fixed page a new page comes every ENDLESS_PAGE_METERS, forever, cycling the looks of
// the ENDLESS_CYCLE_FROM..last pages (LIGHTSPEED..BEYOND) and named BEYOND II, BEYOND III, ...
const ENDLESS_PAGE_METERS = 10000;
const ENDLESS_CYCLE_FROM = 6;
const ESCAPE_ZONE_INDEX = 5;   // ESCAPE VELOCITY: the late-game difficulty screw counts pages from here

function romanNumeral(n) {
  const table = [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
  let out = '';
  for (const [v, r] of table) while (n >= v) { out += r; n -= v; }
  return out;
}

// Zone object for any page index >= 0 (fixed ZONES first, then generated endless pages).
// Generated pages are cached so callers can compare them by identity.
const ENDLESS_ZONE_CACHE = {};
function zoneAt(index) {
  const i = Math.max(0, Math.floor(index || 0));
  if (i < ZONES.length) return ZONES[i];
  if (ENDLESS_ZONE_CACHE[i]) return ENDLESS_ZONE_CACHE[i];
  const last = ZONES.length - 1;
  const cycle = ZONES.length - ENDLESS_CYCLE_FROM;
  const look = ZONES[ENDLESS_CYCLE_FROM + ((i - last - 1) % cycle)];
  const zone = {
    from: ZONES[last].from + (i - last) * ENDLESS_PAGE_METERS,
    name: 'BEYOND ' + romanNumeral(i - last + 1),
    sky: look.sky, paper: look.paper, ink: look.ink, fx: look.fx,
    maxSpeed: TUNING.maxSpeed,
    endless: true,
  };
  ENDLESS_ZONE_CACHE[i] = zone;
  return zone;
}

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
// speed (optional): bumps at high speed cost proportionally more (up to hitHighLoss at the cap).
function planetHitKeep(zoneIndex, speed) {
  const base = zoneIndex < TUNING.earlyHitZones ? TUNING.earlyHitKeep : TUNING.hitKeep;
  return base - TUNING.hitHighLoss * highSpeedShare(speed || 0);
}

// One-time SECOND WIND: the first supernova catch of a run below secondWindBefore meters is survived,
// if the player has been playing (catches = planets caught this run), so idling never earns it.
function secondWindAllowed(used, meters, catches) {
  return !used && meters < TUNING.secondWindBefore && catches >= TUNING.secondWindMinCatches;
}

// Page index for an altitude, covering the endless pages past the last fixed one.
function zoneIndexForAltitude(meters) {
  const last = ZONES.length - 1;
  if (meters >= ZONES[last].from) return last + Math.floor((meters - ZONES[last].from) / ENDLESS_PAGE_METERS);
  let index = 0;
  for (let i = 0; i < ZONES.length; i++) if (meters >= ZONES[i].from) index = i;
  return index;
}

// Pages (fractional) past ESCAPE VELOCITY at an altitude: 0 up to 8000 m, 1 at LIGHTSPEED, 1.5 halfway
// to WORMHOLE... Drives the late-game difficulty screw (nova speed, hazard density).
function pagesPastEscape(meters) {
  const m = Math.max(0, meters || 0);
  const i = zoneIndexForAltitude(m);
  if (i < ESCAPE_ZONE_INDEX) return 0;
  const a = zoneAt(i).from;
  const b = zoneAt(i + 1).from;
  return i - ESCAPE_ZONE_INDEX + (m - a) / (b - a);
}

// Hazard chances (between two planets) at an altitude: the base ones, denser on every late page.
function hazardChances(meters) {
  const extra = TUNING.lateHazardPerPage * pagesPastEscape(meters);
  return {
    asteroid: meters > TUNING.asteroidFromMeters ? Math.min(TUNING.maxAsteroidChance, TUNING.asteroidChance + extra) : 0,
    blackHole: meters > TUNING.blackHoleFromMeters ? Math.min(TUNING.maxBlackHoleChance, TUNING.blackHoleChance + extra * 0.5) : 0,
  };
}

// Finger tutorial (first runs): shown while the player has had fewer than 2 runs OR fewer than
// 3 good catch-and-release cycles, whichever lasts longer. state = { runs, goodCycles } (from storage).
const TUTORIAL_RUNS = 2;
const TUTORIAL_GOOD_CYCLES = 3;
function tutorialActive(state) {
  const s = state || {};
  return (s.runs || 0) < TUTORIAL_RUNS || (s.goodCycles || 0) < TUTORIAL_GOOD_CYCLES;
}

// Reads a stored tutorial state; anything broken counts as a brand-new player.
function parseTutorialState(raw) {
  try {
    const o = JSON.parse(raw);
    if (!o || typeof o !== 'object') return { runs: 0, goodCycles: 0 };
    return { runs: Math.max(0, Math.floor(+o.runs) || 0), goodCycles: Math.max(0, Math.floor(+o.goodCycles) || 0) };
  } catch (e) {
    return { runs: 0, goodCycles: 0 };
  }
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
// keepClimbing: a climbing comet is never warped into a dive (the turn goes the other way instead): a
// dive at 500 km/s turns into a wall-to-wall ping-pong down into the supernova, which no aim can save.
function warpVelocity(hx, hy, x, y, vx, vy, keepClimbing) {
  const cross = vx * (hy - y) - vy * (hx - x);
  const rotate = (turn) => {
    const cos = Math.cos(turn);
    const sin = Math.sin(turn);
    return { vx: vx * cos - vy * sin, vy: vx * sin + vy * cos };
  };
  const turn = (cross < 0 ? -1 : 1) * TUNING.blackHoleWarp;
  const w = rotate(turn);
  if (!keepClimbing || vy >= 0) return w;
  // A climb never comes out of the core as a dive, nor as a near-flat flight (flatter than
  // warpMinClimbShare of the speed): with mirror walls that flat flight ping-pongs wall to wall, the hole's
  // pull bends it down, and it is in the wave within a second. The turn goes the other way instead, when
  // that way climbs more steeply.
  const sp = Math.hypot(vx, vy);
  if (w.vy > -TUNING.warpMinClimbShare * sp) {
    const other = rotate(-turn);
    if (other.vy < w.vy) return other;
  }
  return w;
}

// Supernova top speed at an altitude: grows in step with the zone speed cap (the first zone
// keeps novaMaxSpeed), so a comet doing 700 km/s still has a wave on its tail.
// Past ESCAPE VELOCITY every page turns the screw: +novaPerPage of top speed per page, up to novaMaxLate.
function novaMaxForAltitude(meters) {
  const pages = pagesPastEscape(meters);
  if (pages > 0) return Math.min(TUNING.novaMaxLate, TUNING.novaMaxAbsolute + TUNING.novaPerPage * pages) + novaBeyondExtra(meters);
  const scale = maxSpeedForAltitude(meters) / ZONES[0].maxSpeed;
  return Math.min(TUNING.novaMaxAbsolute, TUNING.novaMaxSpeed * scale);
}

// Past BEYOND (the last fixed page) the wave's top speed and hard cap keep rising, novaBeyondPerPage per
// endless page up to novaBeyondMax: with the late green coyote a clean cycle is stable, so this is the end.
function novaBeyondExtra(meters) {
  const from = ZONES[ZONES.length - 1].from;
  const pages = Math.max(0, (meters || 0) - from) / ENDLESS_PAGE_METERS;
  return Math.min(TUNING.novaBeyondMax, TUNING.novaBeyondPerPage * pages);
}

// How fast the supernova climbs after `seconds` of play; meters (best altitude, optional) adds a
// little and raises its top speed, so the wave keeps pace when the speed cap rises in later zones.
// firstRun: a tutorial run (novaRampFirstRun).
function novaSpeed(seconds, meters, firstRun) {
  const m = Math.max(0, meters || 0);
  const late = Math.max(0, m - ZONES[ESCAPE_ZONE_INDEX].from) * TUNING.novaLateRamp;
  const climb = TUNING.novaAltitudeRamp * m + late;
  const t = Math.max(0, seconds || 0);
  const early = firstRun ? 0 : TUNING.novaRampEarly * Math.min(t, TUNING.novaRampEarlySeconds);
  return Math.min(novaMaxForAltitude(m), TUNING.novaBaseSpeed + TUNING.novaRamp * t + early + climb);
}

// How far below the visible screen the wave may lag (px) at an altitude (meters) and wave speed (px/s):
// novaLeash early, easing over the first half page past ESCAPE VELOCITY (8000 -> 10000 m) to
// novaLeashSeconds of wave travel, so the late wave is never more than ~0.7 s below the screen bottom.
function novaLeashFor(meters, waveSpeed) {
  const k = Math.min(1, pagesPastEscape(meters) * 2);
  const late = Math.max(TUNING.novaLeash, (waveSpeed || 0) * TUNING.novaLeashSeconds);
  return TUNING.novaLeash + (late - TUNING.novaLeash) * k;
}

// Learning window on a tutorial run (see TUNING.learnWindow*): open while the run is a tutorial run and
// the player has made fewer than learnWindowCycles good cycles, before learnWindowSeconds and below
// learnWindowMeters, and not past learnIdleSeconds without a single own catch. Whichever ends it first.
// st = { tutorial, seconds, meters, goodCycles, ownCatches }.
function learningWindowOpen(st) {
  const s = st || {};
  if (!s.tutorial) return false;
  const seconds = s.seconds || 0;
  if ((s.goodCycles || 0) >= TUNING.learnWindowCycles) return false;
  if (seconds >= TUNING.learnWindowSeconds || (s.meters || 0) >= TUNING.learnWindowMeters) return false;
  return !((s.ownCatches || 0) === 0 && seconds >= TUNING.learnIdleSeconds);
}

// Guided tutorial LET GO step: with a normal (green/gold) assist at once; with only the wide tutorial assist
// after tutorialLetGoAfter s in the orbit, or at once when the wave is close (eta s / gap px).
function tutorialLetGo(assist, orbitSeconds, eta, gap) {
  if (!assist) return false;
  if (!assist.wide) return true;
  return orbitSeconds > TUNING.tutorialLetGoAfter || eta < TUNING.letGoEta || gap < TUNING.letGoGap;
}

// s a late green window still counts after it swept past (0 early, assistCoyote late; see GameScene).
function assistCoyoteTime(meters) {
  return TUNING.assistCoyote * lateShare(meters);
}

// Late-game share (0 up to ESCAPE VELOCITY, 1 from half a page past it): the late fairness rules ease in with it.
function lateShare(meters) {
  return Math.min(1, pagesPastEscape(meters) * 2);
}

// Wave speed multiplier on an orbiting comet (late orbit fairness): orbitNovaMul during the first
// orbitNovaGrace s of an orbit (orbitNovaGracePerfect after a PERFECT release), eased in with
// lateShare; 1 in flight and early.
function orbitNovaMul(meters, orbitSeconds, orbiting, afterPerfect) {
  const grace = afterPerfect ? TUNING.orbitNovaGracePerfect : TUNING.orbitNovaGrace;
  if (!orbiting || orbitSeconds >= grace) return 1;
  const fade = 1 - Math.max(0, Math.min(1, ((meters || 0) - TUNING.orbitFairFadeFrom) / TUNING.orbitFairFadeSpan));
  return 1 - (1 - TUNING.orbitNovaMul) * lateShare(meters) * fade;
}

// After the learning window closes the wave eases from its crawl (novaLearnMul) up to the calm factor
// `calm` over learnExitSeconds, instead of jumping 2-3x faster in one frame.
function learnExitFactor(calm, secondsSinceEnd) {
  const t = Math.max(0, Math.min(1, (secondsSinceEnd || 0) / TUNING.learnExitSeconds));
  return TUNING.novaLearnMul + (calm - TUNING.novaLearnMul) * t * t * (3 - 2 * t);
}

// Calm start: share of the wave speed `seconds` into a run. learning (the learning window of a
// tutorial run) keeps it at novaLearnMul; otherwise it eases from novaCalmFrom up to 1,
// over novaCalmSeconds (tutorialCalmSeconds on the tutorial runs: tutorial = true).
function novaCalmFactor(seconds, learning, tutorial) {
  if (learning) return TUNING.novaLearnMul;
  const span = tutorial ? TUNING.tutorialCalmSeconds : TUNING.novaCalmSeconds;
  const t = Math.max(0, Math.min(1, (seconds || 0) / span));
  return TUNING.novaCalmFrom + (1 - TUNING.novaCalmFrom) * t * t * (3 - 2 * t);
}

// The wave speed actually used: novaSpeed x card multiplier x calm factor, never above novaHardCap.
function novaSpeedFor(seconds, meters, cardMul, calm, firstRun) {
  const v = novaSpeed(seconds, meters, firstRun) * (cardMul || 1) * (calm === undefined ? 1 : calm);
  return Math.min(TUNING.novaHardCap + novaBeyondExtra(meters), v);
}

// Seconds until the wave reaches the comet (HUD off-screen warning): gap = novaY - cometY (px) over the
// wave speed (px/s). cometVy (px/s, + = moving down, e.g. the down swing of an orbit) closes it faster; a
// climbing comet is NOT counted, so the warning is already up when the climb stops (an orbit late).
// orbitSwing: cometVy is an orbit's down swing, which only counts once the wave is etaSwingUnder s away.
// A climbing comet (cometVy < 0) slows the closing, but by at most etaClimbFloor of the wave speed: the
// climb ends at the next planet, so the warning still comes up before then. (Counting it in full would
// hide the warning until the orbit starts; ignoring it keeps a late warning up through every fast climb.)
function novaEtaSeconds(gap, waveSpeed, cometVy, orbitSwing) {
  if (gap <= 0) return 0;
  const wave = Math.max(1, waveSpeed || 0);
  if (orbitSwing && gap / wave >= TUNING.etaSwingUnder) return gap / wave;
  const vy = cometVy || 0;
  return gap / Math.max(wave * TUNING.etaClimbFloor, wave + vy);
}

// Eta for an ORBITING comet that keeps holding: once the wave is within etaSwingUnder s, the first
// moment the orbit (angle, radius, dir, spin rad/s around planetY) carries the comet into the climbing
// wave. Honest about the phase: on the up swing the next low point is half a turn away, so the warning
// is not raised on every down swing, but it is up well before the swing that kills.
// o = { novaY, cometY, planetY, angle, radius, dir, spin, wave, slowWave, slowFor }: the wave climbs at
// slowWave (px/s) for slowFor more s (the late orbit grace), then at wave.
function novaOrbitEta(o) {
  const gap = o.novaY - o.cometY;
  if (gap <= 0) return 0;
  const wave = Math.max(1, o.wave || 0);
  const reach = TUNING.cometRadius * 0.5;   // the comet dies when its center is this far past the front
  // Far wave: the plain gap, unless the orbit's low point (a big orbit swinging down) is reached sooner.
  const lowPoint = o.planetY + Math.abs(o.radius);
  if (gap / wave >= TUNING.etaSwingUnder && (o.novaY - lowPoint - reach) / wave >= TUNING.etaSwingUnder) return gap / wave;
  const slowFor = Math.max(0, o.slowFor || 0);
  const slow = o.slowWave === undefined ? wave : o.slowWave;
  for (let t = 0; t <= TUNING.etaSwingUnder; t += 0.02) {
    const y = o.planetY + Math.sin(o.angle + o.dir * o.spin * t) * o.radius;
    const front = o.novaY - slow * Math.min(t, slowFor) - wave * Math.max(0, t - slowFor);
    if (y + reach >= front) return t;
  }
  return Math.max(TUNING.etaSwingUnder, gap / wave);
}

// Aim at one planet whatever the angle: the pass point beside it (assistPassGap off its surface) on the side
// closest to the flight direction. Same shape as pickAssistTarget, plus wide: true. null when already inside.
// passGap (optional): px off the surface instead of assistPassGap (the guided / rescue flings pass closer).
function aimAtPlanet(x, y, dirX, dirY, planet, passGap) {
  if (!planet) return null;
  const len = Math.hypot(dirX, dirY) || 1;
  const ux = dirX / len;
  const uy = dirY / len;
  const dx = planet.x - x;
  const dy = planet.y - y;
  const dist = Math.hypot(dx, dy);
  const passDist = planet.radius + (passGap === undefined ? TUNING.assistPassGap : passGap);
  if (dist <= passDist) return null;
  let best = null;
  for (const side of [1, -1]) {
    const ax = planet.x + (-dy / dist) * passDist * side;
    const ay = planet.y + (dx / dist) * passDist * side;
    const al = Math.hypot(ax - x, ay - y) || 1;
    const angle = Math.acos(Math.max(-1, Math.min(1, ((ax - x) * ux + (ay - y) * uy) / al)));
    if (!best || angle < best.angle) best = { planet, aimX: ax, aimY: ay, angle, wide: true };
  }
  return best;
}

// The next planet above fromY (lowest of the ones above), skipping exclude. null = none.
function nextPlanetAboveY(planets, exclude, fromY) {
  let next = null;
  for (const p of planets) {
    if (p === exclude || p.y >= fromY - 40) continue;
    if (!next || p.y > next.y) next = p;
  }
  return next;
}

// Tutorial aim assist (first runs): when no planet is in the normal assist cone, the next planet above
// fromY (the orbited planet) is the target anyway, whatever the angle, so a learner's release never
// sends the comet somewhere strange.
function pickTutorialTarget(x, y, dirX, dirY, planets, exclude, fromY) {
  return aimAtPlanet(x, y, dirX, dirY, nextPlanetAboveY(planets, exclude, fromY));
}

// Guided first-run tutorial, as a pure state machine (TUNING.guidedRounds planets, the same steps on each).
// st = { phase, round, waiting }:
//   phase 'hold' -> the next planet's HOLD step is still to come; 'lap' -> latched: the planet carries the comet
//   round a full lap (a release does not fling yet), then LET GO; 'done' -> finished for good.
//   round   -> 1..guidedRounds: which planet of the tutorial this is.
//   waiting ''    -> playing normally; 'hold' / 'letgo' -> that step is up and the game waits for the player.
// ev = { holding, orbiting, reachable (a grabbable planet just came near), lapDone (one full revolution since
// the latch), aimReady (the tangent lines up with the target planet, see guidedAimLinedUp), pressed, released
// (this frame's input edges) }.
// Returns { st, action }, action one of:
//   'showHold'  HOLD step (slow motion);           'latch'  HOLD answered: latch the planet now (the lap starts)
//   'lap'       an orbit began some other way: the lap starts now (and a HOLD step still up goes away)
//   'showLetGo' after the lap, LET GO (slow motion)
//   'fling'     LET GO answered on an early round: steered, accelerating fling to the next planet (next round)
//   'nice'      LET GO answered on the last round: steered fling + NICE!, done for good
//   'cancel'    the orbit ended some other way (overspeed): the step goes, this round starts over
//   null        nothing to do.
function guidedTutorialStep(st, ev) {
  const s = {
    phase: st && st.phase ? st.phase : 'hold',
    round: st && st.round ? st.round : 1,
    waiting: st && st.waiting ? st.waiting : '',
  };
  const e = ev || {};
  const out = (action) => ({ st: s, action: action || null });
  if (s.phase === 'done') { s.waiting = ''; return out(null); }
  if (s.waiting === 'hold') {
    if (e.pressed) { s.phase = 'lap'; s.waiting = ''; return out('latch'); }
    if (e.orbiting) { s.phase = 'lap'; s.waiting = ''; return out('lap'); }
    return out(null);
  }
  if (s.waiting === 'letgo') {
    if (e.released) {
      s.waiting = '';
      if (s.round >= TUNING.guidedRounds) { s.phase = 'done'; return out('nice'); }
      s.round++;
      s.phase = 'hold';
      return out('fling');
    }
    if (!e.orbiting) { s.waiting = ''; s.phase = 'hold'; return out('cancel'); }
    return out(null);
  }
  if (s.phase === 'hold') {
    if (e.orbiting) { s.phase = 'lap'; return out('lap'); }
    if (e.reachable && !e.holding) { s.waiting = 'hold'; return out('showHold'); }
    return out(null);
  }
  // phase 'lap', nothing waiting
  if (!e.orbiting) { s.phase = 'hold'; return out('cancel'); }
  if (e.lapDone && e.aimReady) { s.waiting = 'letgo'; return out('showLetGo'); }
  return out(null);
}

// While the guided tutorial holds an orbit (its lap, before LET GO is up) a release does not fling: the
// planet keeps the comet for the full lap. st: the guidedTutorialStep state (null = no tutorial).
function guidedFlingBlocked(st) {
  return !!st && st.phase !== 'done' && st.waiting !== 'letgo';
}

// Whether the flight direction (dirX, dirY) from (x, y) points at (tx, ty) within maxAngle rad
// (default TUNING.guidedAimAngle): the guided LET GO waits for this after the lap.
function guidedAimLinedUp(x, y, dirX, dirY, tx, ty, maxAngle) {
  const dx = tx - x;
  const dy = ty - y;
  const l = Math.hypot(dx, dy) * Math.hypot(dirX, dirY);
  if (!(l > 0)) return false;
  const cos = Math.max(-1, Math.min(1, (dx * dirX + dy * dirY) / l));
  return Math.acos(cos) <= (maxAngle === undefined ? TUNING.guidedAimAngle : maxAngle);
}

// Side-wall bounce: a plain mirror. vx flips, vy is unchanged (a fall keeps falling, a climb keeps climbing),
// at `speed`. Only a grazing hit (|vx| under wallMinVxShare of the speed) is pushed off the wall to that
// share, keeping the sign of vy, or it would slide along the wall ticking it every frame. Returns { vx, vy }.
function wallBounceVelocity(vx, vy, speed) {
  const sp = Math.max(1, speed || Math.hypot(vx, vy));
  const len = Math.hypot(vx, vy) || 1;
  let nvx = (-vx / len) * sp;
  let nvy = (vy / len) * sp;
  const minVx = TUNING.wallMinVxShare * sp;
  if (Math.abs(nvx) < minVx) {
    nvx = (nvx === 0 ? Math.sign(-vx) || 1 : Math.sign(nvx)) * minVx;
    nvy = (nvy > 0 ? 1 : -1) * Math.sqrt(sp * sp - minVx * minVx);
  }
  return { vx: nvx, vy: nvy };
}

// Wall Kick bounce (the card, after an aimed fling only; the only wall that turns a flight upward): vx flips
// and the flight is turned up and inward, so a kick never becomes a crawl across the page or a dive, and
// cannot pinball wall to wall at speed: |vx| <= wallVxShare x speed, and never more than
// wallCrossWidth / wallCrossSeconds, so the opposite wall is at least wallCrossSeconds away; the rest of the
// speed goes into climbing. Returns the new { vx, vy } at `speed`.
function wallKickVelocity(vx, vy, speed) {
  const sp = Math.max(1, speed || Math.hypot(vx, vy));
  const maxVx = Math.min(TUNING.wallVxShare * sp, TUNING.wallCrossWidth / TUNING.wallCrossSeconds);
  const len = Math.hypot(vx, vy) || 1;
  let nvx = (-vx / len) * sp;
  let nvy = (vy / len) * sp;
  // A fall turns into a climb (the same angle off the wall, mirrored up).
  if (nvy > 0) nvy = -nvy;
  if (Math.abs(nvx) > maxVx) {
    nvx = Math.sign(nvx) * maxVx;
    nvy = -Math.sqrt(sp * sp - maxVx * maxVx);
  }
  // A grazing hit leaves the wall for real (a comet sliding up it would otherwise tick it every few frames).
  const minVx = Math.min(maxVx, TUNING.wallMinVxShare * sp);
  if (Math.abs(nvx) < minVx) {
    nvx = (nvx === 0 ? Math.sign(-vx) || 1 : Math.sign(nvx)) * minVx;
    nvy = (nvy > 0 ? 1 : -1) * Math.sqrt(sp * sp - minVx * minVx);
  }
  return { vx: nvx, vy: nvy };
}

// Crawl rescue timer: t counts the s the comet has been crawling (speed < crawlSpeed) in free flight with no
// grabbable planet in reach; past crawlSeconds the next planet drifts into reach (rescue), and the timer
// restarts at -crawlCooldown (counting back up to 0) so it is not called again at once. Returns { t, rescue }.
function crawlRescueStep(t, speed, planetInReach, dt) {
  const d = Math.max(0, dt || 0);
  let n = t || 0;
  if (n < 0) n = Math.min(0, n + d);
  else n = speed < TUNING.crawlSpeed && !planetInReach ? n + d : 0;
  if (n > TUNING.crawlSeconds) return { t: -TUNING.crawlCooldown, rescue: true };
  return { t: n, rescue: false };
}

// A steer's pass point (ax, ay) beside planet, kept inside the side walls (margin px in from 0 / worldWidth):
// a point past a wall is swapped for the one on the planet's other side (mirrored through its center, or
// only across it in x when sameHeight), and clamped as a last resort. Clamping alone would pull the point
// into the planet (a bump); keeping it would steer the comet into the wall again after every bounce.
function passPointInField(ax, ay, planet, worldWidth, margin, sameHeight) {
  const inside = (x) => x >= margin && x <= worldWidth - margin;
  if (inside(ax) || !planet) return { x: ax, y: ay };
  const mx = 2 * planet.x - ax;
  if (inside(mx)) return { x: mx, y: sameHeight ? ay : 2 * planet.y - ay };
  return { x: Math.max(margin, Math.min(worldWidth - margin, ax)), y: ay };
}

// Pop rate limit: a pop sent at lastAt (ms) may repeat at now (ms) only after gapMs.
function popGapOk(lastAt, now, gapMs) {
  return now - (lastAt === undefined ? -Infinity : lastAt) >= gapMs;
}

// Guided tutorial slow motion: progress p (0 = normal time, 1 = full slow motion) after realDt s, rising
// over guidedEaseIn while a step waits and falling over guidedEaseOut after it.
function guidedSlowProgress(p, waiting, realDt) {
  const v = p || 0;
  const dt = Math.max(0, realDt || 0);
  return waiting ? Math.min(1, v + dt / TUNING.guidedEaseIn) : Math.max(0, v - dt / TUNING.guidedEaseOut);
}

// World time scale for slow-motion progress p (smoothstep from 1 down to guidedSlowScale).
function guidedSlowScale(p) {
  const t = Math.max(0, Math.min(1, p || 0));
  return 1 - (1 - TUNING.guidedSlowScale) * t * t * (3 - 2 * t);
}

// Guided tutorial storage: done once the stored value is '1' (anything else, missing or broken = not done).
function parseGuidedTutorialDone(raw) {
  return raw === '1';
}

// Flight decay (px/s per second) at an altitude; with a speed, scaled down below decayFullFrom
// (flightDecayShare), so a slow comet bleeds slowly instead of collapsing into a crawl.
function flightDecay(altitude, speed) {
  const base = Math.min(
    TUNING.maxFlightDecay,
    TUNING.flightDecay + (Math.max(0, altitude) / 1000) * TUNING.flightDecayPerKm
  );
  return speed === undefined ? base : base * flightDecayShare(speed);
}

function flightDecayShare(speed) {
  const v = Math.max(0, speed || 0);
  if (v <= TUNING.decayCruiseFrom) return 1;
  return Math.max(TUNING.decayMinShare, Math.min(1, v / TUNING.decayFullFrom));
}

// Pop gates. Loss pops ('-30% SPEED', '-15% SPEED'...) are one family: one per lossPopGapMs whatever the
// number. Any pop: at most one new pop per popMinGapMs, unless it outranks the last one (priority).
const POP_GATES = { lossPopGapMs: 2000, popMinGapMs: 250, routineCatchPopsUntil: 30 };
// The routine catch pops ('+SPEED', 'CLOSE ORBIT! +SPEED') only during the first routineCatchPopsUntil s of
// a run (runSeconds): by then the km/s readout has taught it, and the pops are clutter.
function routineCatchPopAllowed(runSeconds) {
  return (runSeconds || 0) < POP_GATES.routineCatchPopsUntil;
}
function isLossPop(label) {
  return /^-\d+% SPEED$/.test(label || '');
}
// last: { at, priority } of the last pop that went out (null = none). Returns whether this one may go out.
function popAdmitted(last, now, priority) {
  if (!last) return true;
  if (now - last.at >= POP_GATES.popMinGapMs) return true;
  return (priority || 0) > (last.priority || 0);
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

// MACH readout: the HUD's km/s number as a Mach number (343 m/s = Mach 1). Feel only, physics never reads it.
const MACH_TIERS = [500, 1000, 1500, 2000, 2500];

function machNumber(kmPerS) {
  return Math.round((Math.max(0, kmPerS) * 1000) / 343);
}

// Highest MACH tier reached that is above the last one already stamped this run (0 = none new).
// Skipping straight past a tier (one big boost) stamps only the highest, never a burst of stamps.
function nextMachTier(stampedTier, mach) {
  let tier = 0;
  for (const t of MACH_TIERS) if (t > stampedTier && mach >= t) tier = t;
  return tier;
}

if (typeof module !== 'undefined') {
  module.exports = { CATCH_SLOW, catchSlowScale, earlyHelpShare, orbitDangerLevel, wallKickRecharges, wallKickClimb, routineCatchPopAllowed, wallKickVelocity, wallPlanetSlide, wallPlanetSlideActive, WALL_PLANET_SLIDE, flightDecayShare, isLossPop, popAdmitted, POP_GATES, passPointInField, guidedFlingBlocked, guidedAimLinedUp, wallBounceVelocity, crawlRescueStep, popGapOk, novaBeyondExtra, assistCoyoteTime, novaOrbitEta, perfectAngleAt, learnExitFactor, learningWindowOpen, tutorialLetGo, guidedTutorialStep, guidedSlowProgress, guidedSlowScale, parseGuidedTutorialDone, aimAtPlanet, nextPlanetAboveY, lateShare, orbitNovaMul, novaCalmFactor, novaSpeedFor, novaEtaSeconds, pickTutorialTarget, highSpeedShare, novaLeashFor, orbitSpinCap, zoneAt, pagesPastEscape, hazardChances, tutorialActive, parseTutorialState, TUTORIAL_RUNS, TUTORIAL_GOOD_CYCLES, ENDLESS_PAGE_METERS, ESCAPE_ZONE_INDEX, romanNumeral, orbitTaper, highSpeedDrag, wallBounceKeepAt, wallKickAllowed, wallKickGain, MACH_TIERS, machNumber, nextMachTier, momentum, momentumVisual, momentumGainMul, novaMaxForAltitude, planetHitKeep, secondWindAllowed, CHAIN_MILESTONE_NAMES, chainMilestoneLevel, milestoneSpeedBonus, maxSpeedForAltitude, grabRangeForSpeed, canGrabPlanet, overspeedFling, autoCatchAllowed, FEEL, perfectChainBonus, closeCallStep, slowMoScale, cometStretch, TUNING, orbitCloseness, novaSpeed, steerToward, PLANET_SIZES, ZONES, zoneIndexForAltitude, speedMultiplier, blackHolePull, warpVelocity, startOrbit, pickAssistTarget, speedAfterHit, nextPlanetLayout, orbitStep, tangentVelocity, flightDecay, speedFraction, speedColor, lerpColor };
}
