// Best altitude (meters) has its own key, separate from the best score in utils.js.
const BEST_ALTITUDE_KEY = 'escape_velocity_best_altitude';

function loadBestAltitude() {
  try {
    return parseInt(localStorage.getItem(BEST_ALTITUDE_KEY), 10) || 0;
  } catch (e) {
    return 0;
  }
}

// Set once the player catches a planet mid-flight on their own; after that the onboarding
// auto catch and the catch hint never come back, so only the very first run is assisted.
const LEARNED_CATCH_KEY = 'escape_velocity_learned_catch';

function hasLearnedCatch() {
  try {
    return localStorage.getItem(LEARNED_CATCH_KEY) === '1';
  } catch (e) {
    return false;
  }
}

function saveLearnedCatch() {
  try {
    localStorage.setItem(LEARNED_CATCH_KEY, '1');
  } catch (e) { /* storage blocked: the player just gets the tutorial again */ }
}

function saveBestAltitude(meters) {
  try {
    if (meters > loadBestAltitude()) localStorage.setItem(BEST_ALTITUDE_KEY, String(meters));
  } catch (e) { /* storage blocked (private tab / iframe): just skip */ }
}

// ESCAPE VELOCITY: hold near a planet to orbit and gain speed, release to fling.
// World y grows downward; climbing means y decreases. Altitude = how far up the comet got.
class GameScene extends Phaser.Scene {
  constructor() {
    super('Game');
  }

  // data.headless: the playtest bot drives the scene (no intro, hitstop, slow motion or saves).
  create(data) {
    data = data || {};
    this.headless = !!data.headless;
    this.isOver = false;
    this.isHolding = false;
    this.orbit = null;          // { angle, radius, targetRadius, dir } while orbiting
    this.homing = null;         // { x, y, time }: assisted release curving onto its target
    this.orbitPlanet = null;
    this.speed = TUNING.startSpeed;
    this.startY = GAME_HEIGHT - 260;
    this.bestAltitude = 0;     // meters
    this.bestAltitudePx = 0;
    this.score = 0;
    this.zoneIndex = 0;
    this.trail = [];
    this.elapsed = 0;
    this.novaY = this.startY + TUNING.novaStartBelow;   // world y of the supernova front
    this.scrape = null;         // { planet, angle, dir, time, vx, vy }: grace window after touching a planet
    this.noGrabPlanet = null;   // planet that just let go of you (overspeed), not re-grabbed until you leave it
    this.capTime = 0;           // seconds spent orbiting at the speed cap
    this.assistedFlings = 0;
    this.flightTarget = null;   // planet the last assisted fling is heading for
    this.autoCatchTarget = null;
    this.initFeel();

    this.comet = { x: GAME_WIDTH / 2, y: this.startY, vx: 0, vy: -this.speed };

    this.planets = [];
    this.asteroids = [];
    this.blackHoles = [];
    this.nextPlanetY = this.startY - 560;
    // First planet straight ahead so the very first hold always works.
    this.addPlanet(GAME_WIDTH / 2 + 150, this.nextPlanetY, 85);
    this.planetSide = 1;
    this.nextPlanetY -= TUNING.minPlanetGap;
    this.fillPlanets();

    this.createStarfield();
    this.bestGfx = this.add.graphics();
    this.worldGfx = this.add.graphics();
    this.speedGfx = this.add.graphics().setScrollFactor(0);
    this.catchGfx = this.add.graphics();   // teaching ring around the planet to catch next
    this.cometGfx = this.add.graphics();
    this.introGfx = this.add.graphics();
    this.createBestMarker();
    this.scene.launch('Hud');
    this.hud = this.scene.get('Hud');
    this.learnedCatch = hasLearnedCatch();
    this.hintStage = 0;   // 0: teach hold, 1: teach release, 2: teach catching the next planet, 3: done
    this.events.once('shutdown', () => this.scene.stop('Hud'));

    this.input.on('pointerdown', () => this.pressHold());
    this.input.on('pointerup', () => this.releaseHold());
    this.input.on('pointerupoutside', () => this.releaseHold());
    // Keyboard is an optional extra for desktop testing.
    this.input.keyboard.on('keydown-SPACE', () => this.pressHold());
    this.input.keyboard.on('keyup-SPACE', () => this.releaseHold());
    this.events.once('shutdown', () => { this.tweens.timeScale = 1; });
    this.sfx('start');
    if (this.headless || data.skipIntro) this.launch(); else this.startIntro();
  }

  // Juice state. None of it changes the simulation except hitstop/slow motion, which pause or
  // slow everything (supernova included) equally, so difficulty is unchanged.
  initFeel() {
    this.introActive = false;
    this.cometVisible = true;
    this.hitstop = 0;
    this.slowMoT = -1;          // seconds since a close call, -1 = no slow motion
    this.perfectChain = 0;
    this.closeArmed = false;
    this.closeCall = 0;         // 0..1 pulse for art/HUD
    this.accel = 0;             // smoothed speed change, px/s per second
    this.lastSpeed = this.speed;
    this.jellyT = 10;           // seconds since the last grab/hit squash
    this.perfectPulseAt = -1e9; // time.now of the last PERFECT / zone entry, for local art bursts
    this.zonePulseAt = -1e9;
    this.zoomKick = 0;
    this.baseZoom = 1;
    this.camCenter = GAME_HEIGHT / 2;   // camera anchor before look-ahead (the nova leash uses this)
    this.look = { x: 0, y: 0 };
    this.lastMultiplier = speedMultiplier(this.speed);
    this.streaks = [];
    this.prevBestAlt = loadBestAltitude();
    this.passedBest = false;
    this.explodeT = -1;         // seconds since the intro star exploded, -1 = not yet
    // The scene instance is reused between runs, so this must be reset or later runs skip launch().
    this.launched = false;
  }

  pressHold() {
    if (this.introActive) return this.skipIntro();
    this.isHolding = true;
  }

  // ---------- world ----------

  addPlanet(x, y, radius) {
    const palette = [0xff6fb5, 0x5ee6a8, 0xffb347, 0x6fa8ff, 0xc77dff, 0xff7a5c];
    this.planets.push({
      x, y, radius,
      color: Phaser.Utils.Array.GetRandom(palette),
      hasRing: Math.random() < 0.4,
      craters: [0, 1, 2].map(() => ({
        a: Math.random() * Math.PI * 2,
        d: Math.random() * radius * 0.55,
        r: radius * (0.12 + Math.random() * 0.14),
      })),
    });
  }

  // Keeps planets generated a screen ahead.
  fillPlanets() {
    const view = this.visibleBounds();
    while (this.nextPlanetY > view.top - GAME_HEIGHT) {
      const layout = nextPlanetLayout(this.planetSide, this.startY - this.nextPlanetY, GAME_WIDTH, Math.random);
      this.addPlanet(layout.x, this.nextPlanetY, layout.radius);
      this.maybeAddHazard(this.nextPlanetY - layout.gap / 2, layout.side);
      this.planetSide = layout.side;
      this.nextPlanetY -= layout.gap;
    }
    const onScreen = (o) => o.y < view.bottom + 400;
    this.planets = this.planets.filter((p) => onScreen({ y: p.y - p.radius }));
    this.asteroids = this.asteroids.filter((a) => !a.dead && onScreen(a));
    this.blackHoles = this.blackHoles.filter(onScreen);
  }

  // Hazards sit halfway between two planets and only appear past certain altitudes.
  maybeAddHazard(y, planetSide) {
    const meters = (this.startY - y) / 10;
    if (meters > TUNING.blackHoleFromMeters && Math.random() < TUNING.blackHoleChance) {
      this.blackHoles.push({ x: planetSide < 0 ? GAME_WIDTH * 0.3 : GAME_WIDTH * 0.7, y });
      return;
    }
    if (meters > TUNING.asteroidFromMeters && Math.random() < TUNING.asteroidChance) {
      const radius = Phaser.Math.Between(24, 36);
      // Any starting direction plus a slow curve, so each rock drifts on its own path.
      this.asteroids.push({
        x: Phaser.Math.Between(80, GAME_WIDTH - 80), y, homeY: y, radius,
        heading: Math.random() * Math.PI * 2,
        speed: Phaser.Math.Between(90, 170),
        turn: Phaser.Math.FloatBetween(0.4, 1.1) * (Math.random() < 0.5 ? -1 : 1),
        rot: 0,
        shape: Array.from({ length: 9 }, () => 0.72 + Math.random() * 0.38),
      });
    }
  }

  createStarfield() {
    if (!this.textures.exists('stars')) ART.makeStarTexture(this, 'stars');
    this.cameras.main.setBackgroundColor(ZONES[0].sky);
    // Oversized so the background still fills the screen when the camera zooms out.
    const w = GAME_WIDTH / TUNING.minZoom;
    const h = GAME_HEIGHT / TUNING.minZoom;
    const ox = (GAME_WIDTH - w) / 2;
    const oy = (GAME_HEIGHT - h) / 2;
    // Optional extra layers made by ART.makeStarTexture (slowest nebula, fastest sparkles).
    const layer = (key) => this.add.tileSprite(ox, oy, w, h, key).setOrigin(0).setScrollFactor(0);
    this.starsNebula = this.textures.exists('stars_nebula') ? layer('stars_nebula') : null;
    this.starsFar = layer('stars').setAlpha(0.5);
    this.starsNear = layer('stars').setTileScale(1.6);
    this.starsSparkle = this.textures.exists('stars_sparkle') ? layer('stars_sparkle') : null;
  }

  // World-space rectangle the camera currently shows (zoom scales around the screen center).
  visibleBounds() {
    const cam = this.cameras.main;
    const halfW = GAME_WIDTH / (2 * cam.zoom);
    const halfH = GAME_HEIGHT / (2 * cam.zoom);
    const cx = cam.scrollX + GAME_WIDTH / 2;
    const cy = cam.scrollY + GAME_HEIGHT / 2;
    return { left: cx - halfW, right: cx + halfW, top: cy - halfH, bottom: cy + halfH };
  }

  // Announces a game moment for the audio layer (src/audio.js listens on game.events).
  sfx(name, data) {
    if (this.headless) return;   // the simulator plays hundreds of runs: keep it silent
    this.game.events.emit('sfx', name, data || {});
  }

  // ---------- input ----------

  releaseHold() {
    this.isHolding = false;
    if (this.isOver) return;
    if (this.orbit) this.fling(false);
  }

  // Current speed cap: rises with the best altitude so the speed keeps climbing all run.
  speedCap() {
    return maxSpeedForAltitude(this.bestAltitude);
  }

  addSpeed(amount) {
    this.speed = Math.max(this.speed, Math.min(this.speedCap(), this.speed + amount));
  }

  // Leaves the orbit. overspeed: the planet let go by itself (held at the cap too long), which
  // never scores a PERFECT and does not touch isHolding (the finger may still be down).
  fling(overspeed) {
    const v = tangentVelocity(this.orbit, this.speed);
    const assist = this.currentAssist();
    if (!overspeed && assist && assist.angle < TUNING.perfectAngle) {
      this.addSpeed(TUNING.perfectBonus);
      this.onPerfect();
    } else {
      this.breakChain();
    }
    if (overspeed) {
      this.noGrabPlanet = this.orbitPlanet;
      this.popText('OVERSPEED!', '#8fe3ff', { size: 36 });
    }
    this.flightTarget = assist ? assist.planet : null;
    this.autoCatchTarget = null;
    if (assist) {
      this.assistedFlings++;
      // Onboarding: the first few assisted flings catch their target even without a hold.
      if (!this.learnedCatch && autoCatchAllowed(this.assistedFlings, this.elapsed)) this.autoCatchTarget = assist.planet;
    }
    // Leave along the tangent; an assisted release then curves onto its target over a
    // fraction of a second instead of snapping direction on the release frame.
    this.comet.vx = v.vx;
    this.comet.vy = v.vy;
    this.homing = assist ? { x: assist.aimX, y: assist.aimY, time: TUNING.homingTime } : null;
    const kick = speedFraction(this.speed);
    this.sfx('release', { speedFraction: kick });
    this.cameras.main.shake(120, 0.004 + kick * 0.01);
    this.burst(this.comet.x, this.comet.y, speedColor(kick), 10);
    this.zoomKick = 0.025 + kick * 0.05;
    this.orbit = null;
    this.orbitPlanet = null;
    this.capTime = 0;
    if (this.hintStage === 1 && this.learnedCatch) {
      this.hintStage = 3;
      this.hud.hideHint();
    } else if (this.hintStage === 1 || this.hintStage === 2) {
      // 'RELEASE to fling!' is done; now teach the second half of the loop.
      this.hintStage = 2;
      this.hud.showHint('HOLD to catch it!');
    }
  }

  // Consecutive PERFECTs build a chain: louder pop, bigger flash, more score.
  onPerfect() {
    this.perfectChain++;
    this.perfectPulseAt = this.time.now;
    const chain = this.perfectChain;
    this.score += perfectChainBonus(chain);
    const heat = Math.min(1, (chain - 1) / 5);
    const label = chain > 1 ? 'PERFECT x' + chain + '!' : 'PERFECT!';
    const color = '#' + lerpColor(0xffe14d, 0xffffff, heat).toString(16).padStart(6, '0');
    this.popText(label, color, { size: 44 + Math.min(chain, 6) * 8, stroke: heat > 0.5 ? '#c2410c' : '#1a1033' });
    this.sfx('perfect', { chain });
    // Gentle overlay instead of a solid camera flash, so the comet stays visible at high chains.
    if (this.hud.flash) this.hud.flash(0xffe14d, 0.08 + heat * 0.06, 150 + heat * 60, 0.14);
    this.cameras.main.shake(140, 0.006 + heat * 0.008);
    this.burst(this.comet.x, this.comet.y, 0xffe14d, 8 + Math.min(chain, 6) * 3, 160);
    this.freeze(FEEL.hitstopPerfect);
    if (this.hud.setChain) this.hud.setChain(chain);
  }

  breakChain() {
    if (this.perfectChain === 0) return;
    this.perfectChain = 0;
    if (this.hud.setChain) this.hud.setChain(0);
  }

  // Hitstop: a tiny freeze so impacts feel weighty (skipped by the headless bot).
  freeze(seconds) {
    if (!this.headless) this.hitstop = Math.max(this.hitstop, seconds);
  }

  // Where a release right now would be steered to (null = straight along the tangent).
  currentAssist() {
    if (!this.orbit) return null;
    const v = tangentVelocity(this.orbit, 1);
    return pickAssistTarget(this.comet.x, this.comet.y, v.vx, v.vy, this.planets, this.orbitPlanet);
  }

  nearestGrabbablePlanet() {
    let best = null;
    let bestDist = Infinity;
    const range = grabRangeForSpeed(this.speed);
    const c = this.comet;
    for (const p of this.planets) {
      if (p === this.noGrabPlanet || !canGrabPlanet(c.x, c.y, c.vx, c.vy, p)) continue;
      const d = Phaser.Math.Distance.Between(c.x, c.y, p.x, p.y);
      if (d < p.radius + range && d < bestDist) {
        best = p;
        bestDist = d;
      }
    }
    return best;
  }

  // ---------- loop ----------

  update(time, delta) {
    if (this.isOver) return;
    const realDt = Math.min(delta / 1000, 0.05);
    if (this.introActive) return this.updateIntro(realDt);
    if (this.hintStage === 0 && this.hud.hintText && !this.hud.hintText.text) {
      this.hud.showHint('HOLD near a planet');
      this.hud.showBanner('ESCAPE THE SUPERNOVA!', '', { duration: 1500 });
    }
    this.updateFeelTimers(realDt);
    if (this.hitstop > 0) {
      this.hitstop -= realDt;
      this.draw();
      return;
    }
    let timeScale = 1;
    if (this.slowMoT >= 0) {
      this.slowMoT += realDt;
      timeScale = slowMoScale(this.slowMoT);
      if (timeScale >= 1) this.slowMoT = -1;
    }
    this.tweens.timeScale = timeScale;
    const dt = realDt * timeScale;
    const altitude = this.startY - this.comet.y;

    if (this.noGrabPlanet && this.distanceTo(this.noGrabPlanet) > this.noGrabPlanet.radius + grabRangeForSpeed(this.speed)) {
      this.noGrabPlanet = null;
    }
    if (this.scrape) {
      this.updateScrape(dt);
    } else if (!this.orbit) {
      if (this.isHolding) {
        const planet = this.nearestGrabbablePlanet();
        if (planet) this.latch(planet, false);
      } else if (this.autoCatchTarget && this.distanceTo(this.autoCatchTarget) < this.autoCatchTarget.radius + grabRangeForSpeed(this.speed)) {
        this.latch(this.autoCatchTarget, true);
      }
    }

    if (this.scrape) {
      // updateScrape already placed the comet on the surface.
    } else if (this.orbit) {
      const step = orbitStep(this.orbit, this.speed, dt, this.orbitPlanet.radius, this.speedCap());
      this.orbit = step.orbit;
      this.speed = step.speed;
      this.comet.x = this.orbitPlanet.x + Math.cos(this.orbit.angle) * this.orbit.radius;
      this.comet.y = this.orbitPlanet.y + Math.sin(this.orbit.angle) * this.orbit.radius;
      this.capTime = this.speed >= this.speedCap() - 1 ? this.capTime + dt : 0;
      const u = tangentVelocity(this.orbit, 1);
      if (overspeedFling(this.capTime, u.vx, u.vy)) this.fling(true);
    } else {
      this.speed -= flightDecay(altitude) * dt;
      // Keep direction, apply the decayed speed.
      const len = Math.hypot(this.comet.vx, this.comet.vy) || 1;
      this.comet.vx = (this.comet.vx / len) * this.speed;
      this.comet.vy = (this.comet.vy / len) * this.speed;
      if (this.homing) {
        const h = steerToward(this.comet.vx, this.comet.vy, this.homing.x - this.comet.x, this.homing.y - this.comet.y, TUNING.homingTurn * dt);
        this.comet.vx = h.vx;
        this.comet.vy = h.vy;
        this.homing.time -= dt;
        if (this.homing.time <= 0) this.homing = null;
      }
      // Sub-steps so a fast comet cannot tunnel through a small planet in one frame.
      const steps = Math.max(1, Math.ceil((this.speed * dt) / 30));
      for (let i = 0; i < steps && !this.scrape; i++) {
        this.comet.x += (this.comet.vx * dt) / steps;
        this.comet.y += (this.comet.vy * dt) / steps;
        this.bounceWalls();
        this.bouncePlanets();
      }
      this.applyBlackHoles(dt);
    }
    this.updateAsteroids(dt);

    this.updateCamera(dt);
    this.reportCometScreen();
    this.speed = Math.max(this.speed, TUNING.minSpeed);
    this.updateNova(dt);
    // The supernova is the only way to lose: speed is what keeps you ahead of it.
    if (this.comet.y + TUNING.cometRadius * 0.5 > this.novaY) return this.gameOver('SUPERNOVA!');
    this.checkCloseCall();
    this.updateStretch(dt);

    if (altitude > this.bestAltitudePx) {
      // Only new height scores, multiplied by how fast you got there.
      this.score += ((altitude - this.bestAltitudePx) / 10) * speedMultiplier(this.speed);
      this.bestAltitudePx = altitude;
      this.bestAltitude = Math.floor(altitude / 10);
    }
    this.checkBest();
    this.checkMultiplier();
    this.checkZone();
    this.fillPlanets();
    this.recordTrail();
    this.draw();
  }

  updateNova(dt) {
    this.elapsed += dt;
    this.novaY -= novaSpeed(this.elapsed, this.bestAltitude) * dt;
    // Never let it fall far behind, so the threat is always close.
    this.novaY = Math.min(this.novaY, this.anchorBottom() + TUNING.novaLeash);
    const gap = this.novaY - this.comet.y;
    if (this.hud.setDanger) this.hud.setDanger(1 - (gap - 150) / 450);
  }

  checkZone() {
    const index = zoneIndexForAltitude(this.bestAltitude);
    if (index <= this.zoneIndex) return;
    const from = ZONES[this.zoneIndex].sky;
    const to = ZONES[index].sky;
    this.zoneIndex = index;
    this.zonePulseAt = this.time.now;
    this.hud.showBanner(ZONES[index].name, 'TOP SPEED ' + Math.round(this.speedCap() / 10) + ' km/s');
    this.sfx('zone', { index });
    if (this.hud.flash) this.hud.flash(lerpColor(to, 0xffffff, 0.5), 0.12, 250);
    this.tweens.addCounter({
      from: 0, to: 1, duration: 1500,
      onUpdate: (tw) => this.cameras.main.setBackgroundColor(lerpColor(from, to, tw.getValue())),
    });
  }

  bounceWalls() {
    const r = TUNING.cometRadius;
    if (this.comet.x < r || this.comet.x > GAME_WIDTH - r) {
      this.comet.x = Phaser.Math.Clamp(this.comet.x, r, GAME_WIDTH - r);
      this.comet.vx = -this.comet.vx;
      this.speed *= TUNING.wallBounceKeep;
      this.sfx('wall');
      this.cameras.main.shake(90, 0.006);
      this.burst(this.comet.x, this.comet.y, 0xffffff, 6);
    }
  }

  updateAsteroids(dt) {
    for (const a of this.asteroids) {
      a.heading += a.turn * dt;
      let vx = Math.cos(a.heading) * a.speed;
      let vy = Math.sin(a.heading) * a.speed;
      // Bounce off the side walls, and stay within a band around the spawn height so rocks
      // keep guarding the gap between their two planets instead of drifting away.
      if ((a.x < a.radius && vx < 0) || (a.x > GAME_WIDTH - a.radius && vx > 0)) vx = -vx;
      if ((a.y < a.homeY - TUNING.asteroidRoam && vy < 0) || (a.y > a.homeY + TUNING.asteroidRoam && vy > 0)) vy = -vy;
      a.heading = Math.atan2(vy, vx);
      a.x += vx * dt;
      a.y += vy * dt;
      a.rot += a.turn * 1.5 * dt;
      if (!a.dead && Phaser.Math.Distance.Between(a.x, a.y, this.comet.x, this.comet.y) < a.radius + TUNING.cometRadius * 0.8) {
        a.dead = true;
        this.burst(a.x, a.y, 0xb8a28c, 14);
        this.loseSpeed(TUNING.asteroidKeep);
      }
    }
  }

  applyBlackHoles(dt) {
    for (const h of this.blackHoles) {
      const dist = Phaser.Math.Distance.Between(this.comet.x, this.comet.y, h.x, h.y);
      // After a warp the pull stays off until you leave its field, or it would drag you back.
      if (h.warped && dist > TUNING.blackHolePullRadius) h.warped = false;
      if (!h.warped) {
        const v = blackHolePull(h.x, h.y, this.comet.x, this.comet.y, this.comet.vx, this.comet.vy, dt);
        this.comet.vx = v.vx;
        this.comet.vy = v.vy;
      }
      // Not solid: flying through the core turns your path instead of hurting you.
      const inside = dist < TUNING.blackHoleRadius + TUNING.cometRadius;
      if (inside && !h.cometInside && !h.warped) {
        const w = warpVelocity(h.x, h.y, this.comet.x, this.comet.y, this.comet.vx, this.comet.vy);
        this.comet.vx = w.vx;
        this.comet.vy = w.vy;
        h.warped = true;
        this.popText('WARP!', '#c77dff');
        this.sfx('warp');
        this.cameras.main.shake(120, 0.006);
        this.burst(this.comet.x, this.comet.y, 0xc77dff, 10);
      }
      h.cometInside = inside;
    }
  }

  bouncePlanets() {
    for (const p of this.planets) {
      const dx = this.comet.x - p.x;
      const dy = this.comet.y - p.y;
      const dist = Math.hypot(dx, dy);
      const minDist = p.radius + TUNING.cometRadius * 0.7;
      if (dist < minDist) {
        const nx = dx / dist;
        const ny = dy / dist;
        if (!this.isHolding && canGrabPlanet(this.comet.x, this.comet.y, this.comet.vx, this.comet.vy, p)) {
          this.startScrape(p, nx, ny, minDist);
          return;
        }
        const dot = this.comet.vx * nx + this.comet.vy * ny;
        this.comet.vx -= 2 * dot * nx;
        this.comet.vy -= 2 * dot * ny;
        this.comet.x = p.x + nx * (minDist + 2);
        this.comet.y = p.y + ny * (minDist + 2);
        p.wobble = 0.7;
        this.loseSpeed(TUNING.hitKeep);
        return;
      }
    }
  }

  // Catch grace: touching a planet without holding first slides the comet along its surface
  // for TUNING.catchGrace seconds. A hold in that window turns it into a close orbit; otherwise
  // it bounces off exactly as it would have (reflected incoming velocity, speed loss).
  startScrape(planet, nx, ny, minDist) {
    const c = this.comet;
    c.x = planet.x + nx * minDist;
    c.y = planet.y + ny * minDist;
    const cross = nx * c.vy - ny * c.vx;
    this.scrape = {
      planet, angle: Math.atan2(ny, nx), radius: minDist,
      dir: cross < 0 ? -1 : 1, time: TUNING.catchGrace, vx: c.vx, vy: c.vy,
    };
    this.homing = null;
    planet.wobble = 0.4;
  }

  updateScrape(dt) {
    const s = this.scrape;
    if (this.isHolding) {
      this.scrape = null;
      return this.latch(s.planet, false);
    }
    s.angle += (s.dir * TUNING.scrapeSpeed * dt) / s.radius;
    this.comet.x = s.planet.x + Math.cos(s.angle) * s.radius;
    this.comet.y = s.planet.y + Math.sin(s.angle) * s.radius;
    s.time -= dt;
    if (s.time > 0) return;
    this.scrape = null;
    const nx = Math.cos(s.angle);
    const ny = Math.sin(s.angle);
    const dot = s.vx * nx + s.vy * ny;
    this.comet.vx = dot < 0 ? s.vx - 2 * dot * nx : s.vx;
    this.comet.vy = dot < 0 ? s.vy - 2 * dot * ny : s.vy;
    this.comet.x += nx * 2;
    this.comet.y += ny * 2;
    s.planet.wobble = 0.7;
    this.loseSpeed(TUNING.hitKeep);
  }

  // Starts orbiting planet. auto: onboarding catch without a hold (quiet pop, still counts).
  latch(planet, auto) {
    const c = this.comet;
    this.orbit = startOrbit(planet.x, planet.y, c.x, c.y, c.vx, c.vy, planet.radius);
    this.homing = null;
    this.orbitPlanet = planet;
    this.autoCatchTarget = null;
    this.flightTarget = null;
    this.capTime = 0;
    this.addSpeed(TUNING.catchBonus);
    const close = orbitCloseness(this.orbit.targetRadius, planet.radius) > 0.7;
    if (auto) this.popText('AUTO CATCH', '#c9c3e6', { size: 30, duration: 600 });
    else this.popText(close ? 'CLOSE ORBIT!' : '+SPEED', close ? '#ffe14d' : '#5eff8f');
    this.sfx('grab', { close });
    this.burst(c.x, c.y, 0xffffff, 6);
    planet.wobble = 1;
    this.jellyT = 0;
    this.freeze(FEEL.hitstopGrab);
    if (this.hintStage === 0) {
      this.hintStage = 1;
      this.hud.showHint('RELEASE to fling!');
    } else if (this.hintStage === 2) {
      if (auto) {
        this.hud.showHint('TAP to fling!');
      } else {
        // First real mid-flight catch: the loop is learned, for this and every later run.
        this.hintStage = 3;
        this.hud.hideHint();
        if (!this.headless && !this.learnedCatch) saveLearnedCatch();
        this.learnedCatch = true;
      }
    }
  }

  distanceTo(p) {
    return Math.hypot(this.comet.x - p.x, this.comet.y - p.y);
  }

  loseSpeed(keep) {
    this.speed = speedAfterHit(this.speed, keep);
    this.breakChain();
    this.jellyT = 0;
    this.sfx('hit');
    this.cameras.main.shake(160, 0.012);
    if (this.hud.flash) this.hud.flash(0xff4d6d, 0.12, 120);
    this.burst(this.comet.x, this.comet.y, 0xff4d6d, 10);
    this.popText('-' + Math.round((1 - keep) * 100) + '% SPEED', '#ff4d6d');
  }

  // opts: { size (px), stroke, duration (ms) }. Drawn by the HUD in screen space, so it stays
  // readable at any zoom and is not left behind (and dragged onto the bottom HUD) at high speed.
  popText(label, color, opts) {
    if (this.headless || !this.hud.scoreText) return;   // simulator, or HUD scene still starting
    opts = opts || {};
    const f = speedFraction(this.speed);
    // Spawn ahead of the comet along its flight direction, where the player is looking.
    let ux = this.comet.vx;
    let uy = this.comet.vy;
    if (this.orbit) {
      const v = tangentVelocity(this.orbit, 1);
      ux = v.vx;
      uy = v.vy;
    }
    const len = Math.hypot(ux, uy) || 1;
    const ahead = 70 + 110 * f;
    const p = this.worldToScreen(this.comet.x, this.comet.y);
    this.hud.pop(label, color, {
      size: opts.size,
      stroke: opts.stroke,
      // Faster flight = shorter pops, so they never pile up.
      duration: (opts.duration || 700) * (1 - 0.35 * f),
      x: p.x + (ux / len) * ahead,
      y: p.y + (uy / len) * ahead - 50,
    });
  }

  // Camera zoom scales around the screen center: screen = (world - scroll - center) * zoom + center.
  worldToScreen(x, y) {
    const cam = this.cameras.main;
    return {
      x: (x - cam.scrollX - GAME_WIDTH / 2) * cam.zoom + GAME_WIDTH / 2,
      y: (y - cam.scrollY - GAME_HEIGHT / 2) * cam.zoom + GAME_HEIGHT / 2,
    };
  }

  // Camera only climbs, keeps the comet in the lower part of the view, and zooms out with
  // speed: more warning at high speed, and the shrinking world sells the speed.
  // The anchor (camCenter + baseZoom) is the gameplay camera; look-ahead and the zoom punch
  // are layered on top for feel only, so the nova leash and difficulty never depend on them.
  updateCamera(dt) {
    const cam = this.cameras.main;
    const f = speedFraction(this.speed);
    // Zoom by the first zone's cap, not the late-zone top speed: how much the player can see
    // ahead (and how close the supernova leash sits) must not shrink because the cap grew.
    const zoomF = Phaser.Math.Clamp((this.speed - TUNING.minSpeed) / (ZONES[0].maxSpeed - TUNING.minSpeed), 0, 1);
    const targetZoom = 1 - zoomF * (1 - TUNING.minZoom);
    this.baseZoom = Phaser.Math.Linear(this.baseZoom, targetZoom, Math.min(1, dt * 2));
    let center = this.camCenter;
    const targetCenter = this.comet.y - (0.12 * GAME_HEIGHT) / this.baseZoom;
    if (targetCenter < center) center = Phaser.Math.Linear(center, targetCenter, Math.min(1, dt * 8));
    // Falling back: follow enough to keep the comet above the bottom HUD band (screen y
    // GAME_HEIGHT - COMET_BAND_BOTTOM), easing in first and then hard-clamping a bit lower.
    const lowest = this.comet.y - (GAME_HEIGHT / 2 - GameScene.COMET_BAND_BOTTOM - 30) / this.baseZoom;
    if (center < lowest) center = Phaser.Math.Linear(center, lowest, Math.min(1, dt * 8));
    center = Math.max(center, this.comet.y - (GAME_HEIGHT / 2 - GameScene.COMET_BAND_BOTTOM + 40) / this.baseZoom);
    this.camCenter = center;

    // Look ahead along the flight direction (gently while orbiting, where direction spins).
    let lookX = 0;
    let lookY = -30;
    if (!this.orbit) {
      const len = Math.hypot(this.comet.vx, this.comet.vy) || 1;
      lookX = (this.comet.vx / len) * 45 * f;
      lookY = (this.comet.vy / len) * (40 + 80 * f);
    }
    const ease = Math.min(1, dt * 2.5);
    this.look.x = Phaser.Math.Linear(this.look.x, lookX, ease);
    this.look.y = Phaser.Math.Linear(this.look.y, lookY, ease);
    this.zoomKick *= Math.exp(-dt * 7);
    cam.setZoom(this.baseZoom + this.zoomKick);
    cam.scrollX = this.look.x;
    cam.scrollY = center + this.look.y - GAME_HEIGHT / 2;
    // Look-ahead (feel only) must not push the comet into the bottom HUD band either.
    const maxScreenY = GAME_HEIGHT - GameScene.COMET_BAND_BOTTOM;
    const screenY = (this.comet.y - cam.scrollY - GAME_HEIGHT / 2) * cam.zoom + GAME_HEIGHT / 2;
    if (screenY > maxScreenY) cam.scrollY += (screenY - maxScreenY) / cam.zoom;
    this.starsFar.tilePositionY = cam.scrollY * 0.15;
    this.starsNear.tilePositionY = cam.scrollY * 0.4;
    this.starsFar.tilePositionX = cam.scrollX * 0.15;
    this.starsNear.tilePositionX = cam.scrollX * 0.4;
    if (this.starsNebula) {
      this.starsNebula.tilePositionY = cam.scrollY * 0.05;
      this.starsNebula.tilePositionX = cam.scrollX * 0.05;
    }
    if (this.starsSparkle) {
      this.starsSparkle.tilePositionY = cam.scrollY * 0.7;
      this.starsSparkle.tilePositionX = cam.scrollX * 0.7;
    }
  }

  // The HUD dims its bottom panel when the comet is near it.
  reportCometScreen() {
    if (this.headless || !this.hud || !this.hud.setCometScreen) return;
    const p = this.worldToScreen(this.comet.x, this.comet.y);
    this.hud.setCometScreen(p.x, p.y);
  }

  // Bottom of the gameplay view (no look-ahead / punch): what the supernova leash follows.
  anchorBottom() {
    return this.camCenter + GAME_HEIGHT / (2 * this.baseZoom);
  }

  // ---------- feel ----------

  // Real-time decays (keep running during hitstop so pulses fade naturally).
  updateFeelTimers(dt) {
    this.closeCall = Math.max(0, this.closeCall - dt * 1.4);
    this.jellyT += dt;
    if (this.explodeT >= 0 && this.explodeT < 2) this.explodeT += dt;
    for (const p of this.planets) if (p.wobble) p.wobble = Math.max(0, p.wobble - dt * 1.6);
  }

  updateStretch(dt) {
    const rawAccel = dt > 0 ? (this.speed - this.lastSpeed) / dt : 0;
    this.lastSpeed = this.speed;
    this.accel = Phaser.Math.Linear(this.accel, rawAccel, Math.min(1, dt * 8));
  }

  // Grab/hit "jelly": a quick damped wobble on top of the speed stretch.
  cometStretchNow() {
    const jelly = 0.35 * Math.exp(-this.jellyT * 9) * Math.abs(Math.cos(this.jellyT * 32));
    return Math.min(1.6, cometStretch(speedFraction(this.speed), this.accel) + jelly);
  }

  checkCloseCall() {
    const step = closeCallStep(this.closeArmed, this.novaY - this.comet.y);
    this.closeArmed = step.armed;
    if (!step.triggered) return;
    this.score += FEEL.closeCallBonus;
    this.closeCall = 1;
    if (!this.headless) this.slowMoT = 0;
    this.popText('CLOSE CALL!', '#ff9a2e', { size: 56, duration: 1000 });
    this.sfx('closecall');
    if (this.hud.flash) this.hud.flash(0xff9a2e, 0.14, 160, 0.14);
    this.cameras.main.shake(200, 0.01);
    this.burst(this.comet.x, this.comet.y + 40, 0xff9a2e, 14, 150);
  }

  checkMultiplier() {
    const level = speedMultiplier(this.speed);
    if (level > this.lastMultiplier) this.sfx('speedup', { level });
    this.lastMultiplier = level;
  }

  // ---------- best-run marker ----------

  createBestMarker() {
    this.bestY = this.startY - this.prevBestAlt * 10;
    // Right side under the line, below the flag: the stats block is top-left and the zone banner
    // is centered. Hidden near the top of the screen (see drawBestMarker) so it never overlaps the HUD.
    this.bestLabel = this.add.text(GAME_WIDTH - 24, this.bestY + 16, 'BEST ' + this.prevBestAlt + ' m', {
      fontFamily: FONT, fontSize: '30px', color: '#5eff8f', stroke: '#1a1033', strokeThickness: 8,
    }).setOrigin(1, 0).setVisible(this.prevBestAlt > 0);
  }

  checkBest() {
    if (this.passedBest || this.prevBestAlt <= 0 || this.bestAltitude <= this.prevBestAlt) return;
    this.passedBest = true;
    this.popText('NEW BEST!', '#5eff8f', { size: 64, duration: 1200 });
    this.sfx('newbest');
    if (this.hud.flash) this.hud.flash(0x5eff8f, 0.14, 220, 0.14);
    this.cameras.main.shake(160, 0.008);
    this.burst(this.comet.x, this.comet.y, 0x5eff8f, 18, 180);
    this.tweens.add({ targets: this.bestLabel, alpha: 0, scale: 1.6, duration: 600 });
  }

  // Flag line across the world at the previous best height.
  drawBestMarker(view) {
    const g = this.bestGfx;
    g.clear();
    if (this.prevBestAlt <= 0) return;
    const y = this.bestY;
    const labelScreenY = this.worldToScreen(0, y).y;
    this.bestLabel.setVisible(labelScreenY > GameScene.BEST_LABEL_MIN_Y && labelScreenY < GAME_HEIGHT - GameScene.COMET_BAND_BOTTOM);
    if (y < view.top - 60 || y > view.bottom + 60) return;
    const t = this.time.now / 1000;
    const alpha = this.passedBest ? 0.35 : 1;
    g.fillStyle(0x5eff8f, 0.1 * alpha);
    g.fillRect(0, y - 14, GAME_WIDTH, 28);
    // Dashed line with a dark outline under each dash, scrolling slowly, clipped to the play area.
    const offset = (t * 40) % 48;
    for (let x = offset - 48; x < GAME_WIDTH; x += 48) {
      const x0 = Math.max(0, x);
      const x1 = Math.min(GAME_WIDTH, x + 28);
      if (x1 <= x0) continue;
      g.fillStyle(ART.outline, 0.8 * alpha);
      const ox0 = Math.max(0, x0 - 2);
      g.fillRect(ox0, y - 5, Math.min(GAME_WIDTH, x1 + 2) - ox0, 10);
      g.fillStyle(0x5eff8f, alpha);
      g.fillRect(x0, y - 3, x1 - x0, 6);
    }
    // Flag on a pole at the right side.
    const px = GAME_WIDTH - 70;
    const wave = Math.sin(t * 6) * 6;
    g.fillStyle(ART.outline, alpha);
    g.fillRect(px - 5, y - 92, 10, 92);
    g.fillCircle(px, y - 94, 10);
    g.fillTriangle(px + 3, y - 92, px + 3, y - 46, px + 60 + wave, y - 69 + wave * 0.3);
    g.fillStyle(0xfff1c1, alpha);
    g.fillRect(px - 2, y - 90, 4, 90);
    g.fillCircle(px, y - 94, 6);
    g.fillStyle(0x5eff8f, alpha);
    g.fillTriangle(px + 5, y - 87, px + 5, y - 51, px + 50 + wave, y - 69 + wave * 0.3);
    g.fillStyle(0xffffff, 0.5 * alpha);
    g.fillTriangle(px + 5, y - 87, px + 5, y - 74, px + 28 + wave * 0.5, y - 78);
  }

  // ---------- speed lines (screen space) ----------

  updateSpeedLines(dt) {
    const g = this.speedGfx;
    g.clear();
    if (this.headless) return;
    const intensity = Phaser.Math.Clamp((speedFraction(this.speed) - 0.45) / 0.55, 0, 1);
    let ux = this.comet.vx;
    let uy = this.comet.vy;
    if (this.orbit) {
      const v = tangentVelocity(this.orbit, 1);
      ux = v.vx;
      uy = v.vy;
    }
    const len = Math.hypot(ux, uy) || 1;
    ux /= len;
    uy /= len;
    if (intensity > 0 && this.streaks.length < 60) {
      this.spawnCarry = (this.spawnCarry || 0) + dt * (20 + 90 * intensity);
      while (this.spawnCarry >= 1) {
        this.spawnCarry -= 1;
        this.streaks.push({
          x: Math.random() * GAME_WIDTH, y: Math.random() * GAME_HEIGHT,
          life: 0, maxLife: 0.22 + Math.random() * 0.18,
          length: 70 + Math.random() * 120 + intensity * 200,
          speed: 1400 + intensity * 2400,
        });
      }
    }
    // Screen-space objects are still scaled by zoom around the screen center: undo that.
    const zoom = this.cameras.main.zoom;
    const cx = GAME_WIDTH / 2;
    const cy = GAME_HEIGHT / 2;
    const toX = (x) => cx + (x - cx) / zoom;
    const toY = (y) => cy + (y - cy) / zoom;
    this.streaks = this.streaks.filter((s) => {
      s.life += dt;
      if (s.life >= s.maxLife) return false;
      // The world rushes past opposite to the flight direction.
      s.x -= ux * s.speed * dt;
      s.y -= uy * s.speed * dt;
      const k = s.life / s.maxLife;
      const a = Math.sin(k * Math.PI) * (0.25 + intensity * 0.45);
      const x2 = s.x + ux * s.length;
      const y2 = s.y + uy * s.length;
      g.lineStyle(7, 0x8fe3ff, a * 0.35);
      g.lineBetween(toX(s.x), toY(s.y), toX(x2), toY(y2));
      g.lineStyle(2.5, 0xffffff, a);
      g.lineBetween(toX(s.x + ux * s.length * 0.2), toY(s.y + uy * s.length * 0.2), toX(x2), toY(y2));
      return true;
    });
  }

  // ---------- opening scene ----------

  startIntro() {
    this.introActive = true;
    this.introT = 0;
    this.cometVisible = false;
    // Frame the camera exactly where gameplay will put it, so there is no jump at launch.
    this.camCenter = this.startY - 0.12 * GAME_HEIGHT;
    this.cameras.main.scrollY = this.camCenter - GAME_HEIGHT / 2;
    this.sfx('intro');
  }

  updateIntro(dt) {
    this.introT += dt;
    const swell = Math.min(1, this.introT / GameScene.INTRO_EXPLODE);
    if (this.explodeT < 0) {
      this.cameras.main.shake(60, 0.001 + swell * swell * 0.008);
      if (this.introT >= GameScene.INTRO_EXPLODE) this.explodeStar();
    } else {
      this.explodeT += dt;
      if (this.introT >= GameScene.INTRO_LAUNCH) this.launch();
    }
    if (!this.introActive) return;
    this.draw();
  }

  skipIntro() {
    if (this.explodeT < 0) this.explodeStar();
    this.launch();
  }

  explodeStar() {
    this.explodeT = 0;
    const x = GAME_WIDTH / 2;
    const y = this.startY;
    // Warm colored burst, never a white-out: the HUD flash stays at <= 0.18 alpha.
    if (this.hud.flash) this.hud.flash(0xff9a2e, 0.18, 380, 0.18);
    this.cameras.main.shake(400, 0.025);
    this.burst(x, y, 0xfff1c1, 16, 320);
    this.burst(x, y, 0xffe14d, 18, 260);
    this.burst(x, y, 0xff9a2e, 14, 200);
  }

  // Gameplay starts: the comet is flung upward out of the blast.
  launch() {
    if (!this.introActive && this.launched) return;
    this.launched = true;
    this.introActive = false;
    this.cometVisible = true;
    this.comet.x = GAME_WIDTH / 2;
    this.comet.y = this.startY;
    this.comet.vx = 0;
    this.comet.vy = -this.speed;
    this.trail = [];
    this.elapsed = 0;
    this.zoomKick = 0.06;
    this.jellyT = 0;
    if (!this.headless) {
      this.burst(this.comet.x, this.comet.y, 0xffe14d, 10, 140);
      this.cameras.main.shake(160, 0.01);
    }
    // The HUD hides its stats during the opening scene (on a skipped intro it is not created yet).
    if (this.hud && this.hud.revealStats) this.hud.revealStats();
    this.sfx('launch');
  }

  // Swelling star (before the blast), then expanding shock rings (after it).
  drawIntro() {
    const g = this.introGfx;
    g.clear();
    const x = GAME_WIDTH / 2;
    const y = this.startY;
    const t = this.time.now / 1000;
    if (this.introActive && this.explodeT < 0) {
      const s = Math.min(1, this.introT / GameScene.INTRO_EXPLODE);
      const ease = s * s;
      const pulse = Math.sin(t * (8 + 34 * s)) * 7 * s;
      const r = 46 + 120 * ease + pulse;
      const core = lerpColor(0xffb347, 0xffffff, ease);
      g.fillStyle(0xff9a2e, 0.08 + 0.1 * s);
      g.fillCircle(x, y, r * 2.3);
      g.fillStyle(0xffe14d, 0.12 + 0.12 * s);
      g.fillCircle(x, y, r * 1.6);
      // Spiky corona, two counter-rotating layers.
      for (const layer of [{ k: 1.42, spin: 0.6, color: 0xff9a2e, n: 12 }, { k: 1.22, spin: -1.1, color: 0xffe14d, n: 9 }]) {
        const pts = [];
        for (let i = 0; i < layer.n * 2; i++) {
          const a = t * layer.spin + (i / (layer.n * 2)) * Math.PI * 2;
          const rr = i % 2 ? r * 1.02 : r * layer.k;
          pts.push({ x: x + Math.cos(a) * rr, y: y + Math.sin(a) * rr });
        }
        g.fillStyle(layer.color, 0.9);
        g.fillPoints(pts, true);
      }
      g.fillStyle(ART.outline, 1);
      g.fillCircle(x, y, r + 7);
      g.fillStyle(core, 1);
      g.fillCircle(x, y, r);
      g.fillStyle(0xff6a2e, 0.25 * (1 - ease));
      for (let i = 0; i < 4; i++) {
        const a = t * 0.8 + i * 1.7;
        g.fillCircle(x + Math.cos(a) * r * 0.5, y + Math.sin(a) * r * 0.45, r * (0.16 + 0.05 * i));
      }
      g.fillStyle(0xffffff, 0.75);
      g.fillCircle(x - r * 0.32, y - r * 0.32, r * 0.34);
      g.fillStyle(0xffffff, 0.5 * ease);
      g.fillCircle(x, y, r * 0.95);
    }
    if (this.explodeT >= 0 && this.explodeT < 1.4) {
      const k = this.explodeT / 1.4;
      const rings = [
        { speed: 1500, width: 26, color: 0xfff1c1 },
        { speed: 1000, width: 18, color: 0xffe14d },
        { speed: 650, width: 12, color: 0xff9a2e },
      ];
      for (const ring of rings) {
        const rr = 60 + ring.speed * this.explodeT * (1 - k * 0.35);
        const w = ring.width * (1 - k) + 2;
        g.lineStyle(w + 8, ART.outline, 0.5 * (1 - k));
        g.strokeCircle(x, y, rr);
        g.lineStyle(w, ring.color, 1 - k);
        g.strokeCircle(x, y, rr);
      }
      // Fireball core: warm and small, so the blast never washes the screen out.
      g.fillStyle(0xff9a2e, 0.55 * (1 - k) * (1 - k));
      g.fillCircle(x, y, 150 * (1 - k) + 20);
      g.fillStyle(0xffe14d, 0.6 * (1 - k) * (1 - k));
      g.fillCircle(x, y, 80 * (1 - k) + 10);
    }
  }

  recordTrail() {
    this.trail.unshift({ x: this.comet.x, y: this.comet.y });
    const maxLen = 6 + Math.floor(speedFraction(this.speed) * 26);
    if (this.trail.length > maxLen) this.trail.length = maxLen;
  }

  // ---------- drawing (art lives in src/art.js) ----------

  // assist: this frame's currentAssist(), computed once in draw().
  artContext(assist) {
    return {
      time: this.time.now / 1000,
      comet: this.comet,
      speed: this.speed,
      speedFraction: speedFraction(this.speed),
      orbitPlanet: this.orbitPlanet,
      isHolding: this.isHolding,
      danger: Phaser.Math.Clamp(1 - (this.novaY - this.comet.y - 150) / 450, 0, 1),
      stretch: this.cometStretchNow(),
      squash: Math.exp(-this.jellyT * 7),   // extra: 1 right after a grab/hit, decays to 0
      perfectChain: this.perfectChain,
      closeCall: this.closeCall,
      perfectPulse: Math.max(0, 1 - (this.time.now - this.perfectPulseAt) / 400),
      zonePulse: Math.max(0, 1 - (this.time.now - this.zonePulseAt) / 600),
      intro: this.introActive,
      aimKind: assist ? (assist.angle < TUNING.perfectAngle ? 'perfect' : 'target') : 'none',
    };
  }

  draw() {
    const g = this.worldGfx;
    g.clear();
    const assist = this.currentAssist();
    const ctx = this.artContext(assist);
    const view = this.visibleBounds();
    ART.drawWalls(g, view);
    this.drawBestMarker(view);
    const grab = this.isHolding ? null : this.nearestGrabbablePlanet();
    for (const h of this.blackHoles) ART.drawBlackHole(g, h, ctx);
    for (const p of this.planets) {
      const isTarget = !!(assist && assist.planet === p);
      p.mood = p === this.orbitPlanet ? 'orbit' : isTarget ? 'target' : p === grab ? 'near' : 'idle';
      ART.drawPlanet(g, p, p === grab || p === this.orbitPlanet, isTarget, ctx);
    }
    for (const a of this.asteroids) if (!a.dead) ART.drawAsteroid(g, a, ctx);
    // The supernova is born when the opening star explodes.
    if (!this.introActive || this.explodeT >= 0) ART.drawNova(g, this.novaY, view, ctx);
    if (this.orbit) this.drawAimGuide(g, assist, ctx);
    this.drawCatchRing();
    this.updateSpeedLines(this.hitstop > 0 ? 0 : Math.min(this.game.loop.delta / 1000, 0.05));
    this.cometGfx.clear();
    if (this.cometVisible) ART.drawComet(this.cometGfx, this.comet, this.trail, ctx);
    this.drawIntro();
    this.updateHud();
  }

  // Onboarding: until the first real mid-flight catch, the planet you are flying at gets a
  // pulsing ring at the edge of its grab zone that brightens as you approach ("hold here").
  drawCatchRing() {
    const g = this.catchGfx;
    g.clear();
    if (this.headless || this.hintStage !== 2 || this.orbit || this.scrape || this.isOver) return;
    const p = this.flightTarget || this.autoCatchTarget || this.nextPlanetAbove();
    if (!p) return;
    const zone = p.radius + grabRangeForSpeed(this.speed);
    const gap = this.distanceTo(p) - zone;
    const near = Phaser.Math.Clamp(1 - gap / 600, 0.5, 1);
    const t = this.time.now / 1000;
    const k = (t * 1.6) % 1;   // shrinking pulse: from outside the zone onto its edge
    const pulseR = zone + 70 * (1 - k);
    g.lineStyle(10, ART.outline, 0.35 * near * k);
    g.strokeCircle(p.x, p.y, pulseR);
    g.lineStyle(5, 0x5eff8f, 0.85 * near * k);
    g.strokeCircle(p.x, p.y, pulseR);
    // Steady dashed edge of the grab zone.
    const dashes = 28;
    g.lineStyle(5, 0x5eff8f, 0.55 * near);
    for (let i = 0; i < dashes; i++) {
      const a0 = (i / dashes) * Math.PI * 2 + t * 0.6;
      g.beginPath();
      g.arc(p.x, p.y, zone, a0, a0 + (Math.PI * 2) / dashes * 0.55);
      g.strokePath();
    }
  }

  // Closest planet above the comet (catch-ring fallback when the fling had no assist target).
  nextPlanetAbove() {
    let best = null;
    for (const p of this.planets) {
      if (p.y < this.comet.y && (!best || p.y > best.y)) best = p;
    }
    return best;
  }

  // Where the release line points: at the assisted target, or along the tangent.
  drawAimGuide(g, assist, ctx) {
    if (assist) {
      const dx = assist.aimX - this.comet.x;
      const dy = assist.aimY - this.comet.y;
      const length = Math.hypot(dx, dy);
      ART.drawAimGuide(g, this.comet.x, this.comet.y, dx / length, dy / length, length, ctx.aimKind, ctx);
    } else {
      const v = tangentVelocity(this.orbit, 1);
      ART.drawAimGuide(g, this.comet.x, this.comet.y, v.vx, v.vy, 520, 'none', ctx);
    }
  }

  // reach: max travel distance in px (default 110).
  burst(x, y, color, count, reach) {
    if (this.headless) return;   // thousands of tweens would only slow the simulator
    const far = reach || 110;
    for (let i = 0; i < count; i++) {
      const dot = this.add.circle(x, y, Phaser.Math.Between(4, 9), color).setStrokeStyle(2, ART.outline, 0.6);
      const a = Math.random() * Math.PI * 2;
      const d = Phaser.Math.Between(Math.round(far * 0.36), far);
      this.tweens.add({
        targets: dot, x: x + Math.cos(a) * d, y: y + Math.sin(a) * d, alpha: 0, scale: 0.3,
        duration: Phaser.Math.Between(250, 450), onComplete: () => dot.destroy(),
      });
    }
  }

  updateHud() {
    if (!this.hud.scoreText) return;   // HUD scene still starting
    this.hud.setStats(Math.floor(this.score), this.bestAltitude, this.speed);
  }

  gameOver(reason) {
    if (this.isOver) return;
    this.isOver = true;
    this.tweens.timeScale = 1;
    const newBestAltitude = this.bestAltitude > this.prevBestAlt;
    if (!this.headless && newBestAltitude) saveBestAltitude(this.bestAltitude);
    this.sfx('gameover', { reason });
    this.draw();
    this.cameras.main.shake(300, 0.02);
    if (this.hud.flash) this.hud.flash(0xff9a2e, 0.18, 220, 0.18);
    this.burst(this.comet.x, this.comet.y, 0xff9a2e, 22);
    // The simulator must never reach GameOver: it would save the bot's score as the real best.
    if (this.headless) return;
    this.time.delayedCall(800, () => {
      this.scene.start('GameOver', { score: Math.floor(this.score), altitude: this.bestAltitude, reason, newBestAltitude, bestAltitude: Math.max(this.bestAltitude, this.prevBestAlt) });
    });
  }
}

// Screen px kept free at the bottom for the speed / multiplier HUD panel.
GameScene.COMET_BAND_BOTTOM = 300;
// The BEST label only shows below this screen y, clear of the top-left stats block.
GameScene.BEST_LABEL_MIN_Y = 260;

// Opening scene timeline (seconds): the star swells, explodes, then the comet launches.
GameScene.INTRO_EXPLODE = 1.7;
GameScene.INTRO_LAUNCH = 2.1;
