// ESCAPE VELOCITY: hold near a planet to orbit and gain speed, release to fling.
// World y grows downward; climbing means y decreases. Altitude = how far up the comet got.
class GameScene extends Phaser.Scene {
  constructor() {
    super('Game');
  }

  create() {
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
    this.worldGfx = this.add.graphics();
    this.cometGfx = this.add.graphics();
    this.scene.launch('Hud');
    this.hud = this.scene.get('Hud');
    this.hintStage = 0;   // 0: teach hold, 1: teach release, 2: done
    this.events.once('shutdown', () => this.scene.stop('Hud'));

    this.input.on('pointerdown', () => { this.isHolding = true; });
    this.input.on('pointerup', () => this.releaseHold());
    this.input.on('pointerupoutside', () => this.releaseHold());
    // Keyboard is an optional extra for desktop testing.
    this.input.keyboard.on('keydown-SPACE', () => { this.isHolding = true; });
    this.input.keyboard.on('keyup-SPACE', () => this.releaseHold());
    this.sfx('start');
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
    this.starsFar = this.add.tileSprite(ox, oy, w, h, 'stars').setOrigin(0).setScrollFactor(0).setAlpha(0.5);
    this.starsNear = this.add.tileSprite(ox, oy, w, h, 'stars').setOrigin(0).setScrollFactor(0).setTileScale(1.6);
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
    this.game.events.emit('sfx', name, data || {});
  }

  // ---------- input ----------

  releaseHold() {
    this.isHolding = false;
    if (!this.orbit || this.isOver) return;
    const v = tangentVelocity(this.orbit, this.speed);
    const assist = this.currentAssist();
    if (assist && assist.angle < TUNING.perfectAngle) {
      this.speed = Math.min(TUNING.maxSpeed, this.speed + TUNING.perfectBonus);
      this.popText('PERFECT!', '#ffe14d');
      this.sfx('perfect');
      this.cameras.main.flash(120, 255, 225, 77);
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
    this.orbit = null;
    this.orbitPlanet = null;
    if (this.hintStage === 1) {
      this.hintStage = 2;
      this.hud.hideHint();
    }
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
    for (const p of this.planets) {
      const d = Phaser.Math.Distance.Between(this.comet.x, this.comet.y, p.x, p.y);
      if (d < p.radius + TUNING.grabRange && d < bestDist) {
        best = p;
        bestDist = d;
      }
    }
    return best;
  }

  // ---------- loop ----------

  update(time, delta) {
    if (this.isOver) return;
    if (this.hintStage === 0 && this.hud.hintText && !this.hud.hintText.text) {
      this.hud.showHint('HOLD near a planet');
      this.hud.showBanner('ESCAPE THE SUPERNOVA!', '');
    }
    const dt = Math.min(delta / 1000, 0.05);
    const altitude = this.startY - this.comet.y;

    if (this.isHolding && !this.orbit) {
      const planet = this.nearestGrabbablePlanet();
      if (planet) {
        this.orbit = startOrbit(planet.x, planet.y, this.comet.x, this.comet.y, this.comet.vx, this.comet.vy, planet.radius);
        this.homing = null;
        this.orbitPlanet = planet;
        this.speed = Math.min(TUNING.maxSpeed, this.speed + TUNING.catchBonus);
        const close = orbitCloseness(this.orbit.targetRadius, planet.radius);
        this.popText(close > 0.7 ? 'CLOSE ORBIT!' : '+SPEED', close > 0.7 ? '#ffe14d' : '#5eff8f');
        this.sfx('grab', { close: close > 0.7 });
        this.burst(this.comet.x, this.comet.y, 0xffffff, 6);
        if (this.hintStage === 0) {
          this.hintStage = 1;
          this.hud.showHint('RELEASE to fling!');
        }
      }
    }

    if (this.orbit) {
      const step = orbitStep(this.orbit, this.speed, dt, this.orbitPlanet.radius);
      this.orbit = step.orbit;
      this.speed = step.speed;
      this.comet.x = this.orbitPlanet.x + Math.cos(this.orbit.angle) * this.orbit.radius;
      this.comet.y = this.orbitPlanet.y + Math.sin(this.orbit.angle) * this.orbit.radius;
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
      this.comet.x += this.comet.vx * dt;
      this.comet.y += this.comet.vy * dt;
      this.bounceWalls();
      this.bouncePlanets();
      this.applyBlackHoles(dt);
    }
    this.updateAsteroids(dt);

    this.updateCamera(dt);
    this.speed = Math.max(this.speed, TUNING.minSpeed);
    this.updateNova(dt);
    // The supernova is the only way to lose: speed is what keeps you ahead of it.
    if (this.comet.y + TUNING.cometRadius * 0.5 > this.novaY) return this.gameOver('SUPERNOVA!');

    if (altitude > this.bestAltitudePx) {
      // Only new height scores, multiplied by how fast you got there.
      this.score += ((altitude - this.bestAltitudePx) / 10) * speedMultiplier(this.speed);
      this.bestAltitudePx = altitude;
      this.bestAltitude = Math.floor(altitude / 10);
    }
    this.checkZone();
    this.fillPlanets();
    this.recordTrail();
    this.draw();
    this.updateHud();
  }

  updateNova(dt) {
    this.elapsed += dt;
    this.novaY -= novaSpeed(this.elapsed) * dt;
    // Never let it fall far behind, so the threat is always close.
    this.novaY = Math.min(this.novaY, this.visibleBounds().bottom + TUNING.novaLeash);
    const gap = this.novaY - this.comet.y;
    if (this.hud.setDanger) this.hud.setDanger(1 - (gap - 150) / 450);
  }

  checkZone() {
    const index = zoneIndexForAltitude(this.bestAltitude);
    if (index <= this.zoneIndex) return;
    const from = ZONES[this.zoneIndex].sky;
    const to = ZONES[index].sky;
    this.zoneIndex = index;
    this.hud.showBanner(ZONES[index].name, ZONES[index].from + ' m');
    this.sfx('zone', { index });
    this.cameras.main.flash(250, 255, 255, 255);
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
        const dot = this.comet.vx * nx + this.comet.vy * ny;
        this.comet.vx -= 2 * dot * nx;
        this.comet.vy -= 2 * dot * ny;
        this.comet.x = p.x + nx * (minDist + 2);
        this.comet.y = p.y + ny * (minDist + 2);
        this.loseSpeed(TUNING.hitKeep);
        return;
      }
    }
  }

  loseSpeed(keep) {
    this.speed = speedAfterHit(this.speed, keep);
    this.sfx('hit');
    this.cameras.main.shake(160, 0.012);
    this.cameras.main.flash(90, 255, 77, 109);
    this.burst(this.comet.x, this.comet.y, 0xff4d6d, 10);
    this.popText('-' + Math.round((1 - keep) * 100) + '% SPEED', '#ff4d6d');
  }

  popText(label, color) {
    const t = this.add.text(this.comet.x, this.comet.y - 50, label, {
      fontFamily: FONT, fontSize: '40px', color, stroke: '#1a1033', strokeThickness: 8,
    }).setOrigin(0.5).setDepth(50);
    this.tweens.add({ targets: t, y: t.y - 90, alpha: 0, duration: 700, onComplete: () => t.destroy() });
  }

  // Camera only climbs, keeps the comet in the lower part of the view, and zooms out with
  // speed: more warning at high speed, and the shrinking world sells the speed.
  updateCamera(dt) {
    const cam = this.cameras.main;
    const targetZoom = 1 - speedFraction(this.speed) * (1 - TUNING.minZoom);
    cam.setZoom(Phaser.Math.Linear(cam.zoom, targetZoom, Math.min(1, dt * 2)));
    let center = cam.scrollY + GAME_HEIGHT / 2;
    const targetCenter = this.comet.y - (0.12 * GAME_HEIGHT) / cam.zoom;
    if (targetCenter < center) center = Phaser.Math.Linear(center, targetCenter, Math.min(1, dt * 8));
    // Falling back: follow only enough to keep the comet on screen.
    const lowest = this.comet.y - (0.38 * GAME_HEIGHT) / cam.zoom;
    if (center < lowest) center = Phaser.Math.Linear(center, lowest, Math.min(1, dt * 6));
    cam.scrollY = center - GAME_HEIGHT / 2;
    this.starsFar.tilePositionY = cam.scrollY * 0.15;
    this.starsNear.tilePositionY = cam.scrollY * 0.4;
  }

  recordTrail() {
    this.trail.unshift({ x: this.comet.x, y: this.comet.y });
    const maxLen = 6 + Math.floor(speedFraction(this.speed) * 26);
    if (this.trail.length > maxLen) this.trail.length = maxLen;
  }

  // ---------- drawing (art lives in src/art.js) ----------

  artContext() {
    return {
      time: this.time.now / 1000,
      comet: this.comet,
      speed: this.speed,
      speedFraction: speedFraction(this.speed),
      orbitPlanet: this.orbitPlanet,
      isHolding: this.isHolding,
      danger: Phaser.Math.Clamp(1 - (this.novaY - this.comet.y - 150) / 450, 0, 1),
    };
  }

  draw() {
    const g = this.worldGfx;
    g.clear();
    const ctx = this.artContext();
    const view = this.visibleBounds();
    ART.drawWalls(g, view);
    const grab = this.isHolding ? null : this.nearestGrabbablePlanet();
    const assist = this.currentAssist();
    for (const h of this.blackHoles) ART.drawBlackHole(g, h, ctx);
    for (const p of this.planets) {
      ART.drawPlanet(g, p, p === grab || p === this.orbitPlanet, !!(assist && assist.planet === p), ctx);
    }
    for (const a of this.asteroids) if (!a.dead) ART.drawAsteroid(g, a, ctx);
    ART.drawNova(g, this.novaY, view, ctx);
    if (this.orbit) this.drawAimGuide(g, assist, ctx);
    this.cometGfx.clear();
    ART.drawComet(this.cometGfx, this.comet, this.trail, ctx);
  }

  // Where the release line points: at the assisted target, or along the tangent.
  drawAimGuide(g, assist, ctx) {
    if (assist) {
      const dx = assist.aimX - this.comet.x;
      const dy = assist.aimY - this.comet.y;
      const length = Math.hypot(dx, dy);
      const kind = assist.angle < TUNING.perfectAngle ? 'perfect' : 'target';
      ART.drawAimGuide(g, this.comet.x, this.comet.y, dx / length, dy / length, length, kind, ctx);
    } else {
      const v = tangentVelocity(this.orbit, 1);
      ART.drawAimGuide(g, this.comet.x, this.comet.y, v.vx, v.vy, 520, 'none', ctx);
    }
  }

  burst(x, y, color, count) {
    for (let i = 0; i < count; i++) {
      const dot = this.add.circle(x, y, Phaser.Math.Between(4, 9), color);
      const a = Math.random() * Math.PI * 2;
      const d = Phaser.Math.Between(40, 110);
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
    this.sfx('gameover', { reason });
    this.draw();
    this.cameras.main.shake(300, 0.02);
    this.cameras.main.flash(200, 255, 255, 255);
    this.burst(this.comet.x, this.comet.y, 0xff9a2e, 22);
    this.time.delayedCall(800, () => {
      this.scene.start('GameOver', { score: Math.floor(this.score), altitude: this.bestAltitude, reason });
    });
  }
}
