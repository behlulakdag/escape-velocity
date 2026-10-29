// ESCAPE VELOCITY: hold near a planet to orbit and gain speed, release to fling.
// World y grows downward; climbing means y decreases. Altitude = how far up the comet got.
class GameScene extends Phaser.Scene {
  constructor() {
    super('Game');
  }

  create() {
    this.isOver = false;
    this.isHolding = false;
    this.orbit = null;          // { angle, radius, dir } while orbiting
    this.orbitPlanet = null;
    this.speed = TUNING.startSpeed;
    this.startY = GAME_HEIGHT - 260;
    this.bestAltitude = 0;     // meters
    this.bestAltitudePx = 0;
    this.score = 0;
    this.zoneIndex = 0;
    this.trail = [];

    this.comet = { x: GAME_WIDTH / 2, y: this.startY, vx: 0, vy: -this.speed };

    this.planets = [];
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
      this.planetSide = layout.side;
      this.nextPlanetY -= layout.gap;
    }
    this.planets = this.planets.filter((p) => p.y - p.radius < view.bottom + 400);
  }

  createStarfield() {
    const g = this.make.graphics({ x: 0, y: 0, add: false });
    for (let i = 0; i < 90; i++) {
      g.fillStyle(0xffffff, Phaser.Math.FloatBetween(0.3, 0.9));
      g.fillCircle(Phaser.Math.Between(0, 512), Phaser.Math.Between(0, 512), Phaser.Math.FloatBetween(1, 3));
    }
    g.generateTexture('stars', 512, 512);
    g.destroy();
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

  // ---------- input ----------

  releaseHold() {
    this.isHolding = false;
    if (!this.orbit || this.isOver) return;
    const v = tangentVelocity(this.orbit, this.speed);
    const assist = this.currentAssist();
    if (assist && assist.angle < TUNING.perfectAngle) {
      this.speed = Math.min(TUNING.maxSpeed, this.speed + TUNING.perfectBonus);
      this.popText('PERFECT!', '#ffe14d');
      this.cameras.main.flash(120, 255, 225, 77);
    }
    if (assist) {
      const dx = assist.aimX - this.comet.x;
      const dy = assist.aimY - this.comet.y;
      const len = Math.hypot(dx, dy);
      this.comet.vx = (dx / len) * this.speed;
      this.comet.vy = (dy / len) * this.speed;
    } else {
      this.comet.vx = v.vx;
      this.comet.vy = v.vy;
    }
    const kick = speedFraction(this.speed);
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
    if (this.hintStage === 0 && this.hud.hintText && !this.hud.hintText.text) this.hud.showHint('HOLD near a planet');
    const dt = Math.min(delta / 1000, 0.05);
    const altitude = this.startY - this.comet.y;

    if (this.isHolding && !this.orbit) {
      const planet = this.nearestGrabbablePlanet();
      if (planet) {
        this.orbit = startOrbit(planet.x, planet.y, this.comet.x, this.comet.y, this.comet.vx, this.comet.vy, planet.radius);
        this.orbitPlanet = planet;
        this.speed = Math.min(TUNING.maxSpeed, this.speed + TUNING.catchBonus);
        this.popText('+SPEED', '#5eff8f');
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
      if (step.crashed) {
        // Scraping the surface throws the comet off its orbit and costs speed instead of ending the run.
        const v = tangentVelocity(this.orbit, this.speed);
        this.comet.vx = v.vx;
        this.comet.vy = v.vy;
        this.orbit = null;
        this.orbitPlanet = null;
        this.loseSpeed(TUNING.hitKeep);
      }
    } else {
      this.speed -= flightDecay(altitude) * dt;
      // Keep direction, apply the decayed speed.
      const len = Math.hypot(this.comet.vx, this.comet.vy) || 1;
      this.comet.vx = (this.comet.vx / len) * this.speed;
      this.comet.vy = (this.comet.vy / len) * this.speed;
      this.comet.x += this.comet.vx * dt;
      this.comet.y += this.comet.vy * dt;
      this.bounceWalls();
      this.bouncePlanets();
    }

    this.updateCamera(dt);
    this.bounceFloor();
    // Every mistake costs speed; running out of speed is the only way to lose.
    if (this.speed < TUNING.minSpeed) return this.gameOver('TOO SLOW!');

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

  checkZone() {
    const index = zoneIndexForAltitude(this.bestAltitude);
    if (index <= this.zoneIndex) return;
    const from = ZONES[this.zoneIndex].sky;
    const to = ZONES[index].sky;
    this.zoneIndex = index;
    this.hud.showBanner(ZONES[index].name, ZONES[index].from + ' m');
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
      this.cameras.main.shake(90, 0.006);
      this.burst(this.comet.x, this.comet.y, 0xffffff, 6);
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

  // The bottom of the screen is a floor: falling behind bounces you back up, at a cost.
  bounceFloor() {
    const floor = this.visibleBounds().bottom - TUNING.cometRadius;
    if (this.comet.y > floor && !this.orbit) {
      this.comet.y = floor;
      this.comet.vy = -Math.abs(this.comet.vy);
      this.loseSpeed(TUNING.floorBounceKeep);
    }
  }

  loseSpeed(keep) {
    this.speed = speedAfterHit(this.speed, keep);
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
    cam.scrollY = center - GAME_HEIGHT / 2;
    this.starsFar.tilePositionY = cam.scrollY * 0.15;
    this.starsNear.tilePositionY = cam.scrollY * 0.4;
  }

  recordTrail() {
    this.trail.unshift({ x: this.comet.x, y: this.comet.y });
    const maxLen = 6 + Math.floor(speedFraction(this.speed) * 26);
    if (this.trail.length > maxLen) this.trail.length = maxLen;
  }

  // ---------- drawing ----------

  draw() {
    const g = this.worldGfx;
    g.clear();
    this.drawWalls(g);
    const grab = this.isHolding ? null : this.nearestGrabbablePlanet();
    const assist = this.currentAssist();
    for (const p of this.planets) {
      this.drawPlanet(g, p, p === grab || p === this.orbitPlanet, assist && assist.planet === p);
    }
    if (this.orbit) this.drawAimGuide(g, assist);
    this.drawComet();
  }

  // Side walls only show when zoomed out; shade the outside so the play area stays clear.
  drawWalls(g) {
    const v = this.visibleBounds();
    if (v.left >= 0) return;
    g.fillStyle(0x120a2a, 0.75);
    g.fillRect(v.left, v.top, -v.left, v.bottom - v.top);
    g.fillRect(GAME_WIDTH, v.top, v.right - GAME_WIDTH, v.bottom - v.top);
    g.lineStyle(8, 0xff6fb5, 0.8);
    g.lineBetween(0, v.top, 0, v.bottom);
    g.lineBetween(GAME_WIDTH, v.top, GAME_WIDTH, v.bottom);
  }

  drawPlanet(g, p, highlighted, isTarget) {
    // Grab zone: dashed ring so players learn where holding works. Green = release now.
    const zone = p.radius + TUNING.grabRange;
    if (isTarget) {
      g.fillStyle(0x5eff8f, 0.12);
      g.fillCircle(p.x, p.y, zone);
    }
    g.lineStyle(isTarget ? 7 : 4, isTarget ? 0x5eff8f : 0xffffff, isTarget ? 0.9 : highlighted ? 0.55 : 0.14);
    for (let a = 0; a < Math.PI * 2; a += Math.PI / 18) {
      g.beginPath();
      g.arc(p.x, p.y, zone, a, a + Math.PI / 36);
      g.strokePath();
    }
    if (p.hasRing) {
      g.lineStyle(10, 0x1a1033, 1);
      g.strokeEllipse(p.x, p.y, p.radius * 2.9, p.radius * 0.9);
      g.lineStyle(5, 0xfff1c1, 1);
      g.strokeEllipse(p.x, p.y, p.radius * 2.9, p.radius * 0.9);
    }
    g.fillStyle(0x1a1033, 1);
    g.fillCircle(p.x, p.y, p.radius + 6);
    g.fillStyle(p.color, 1);
    g.fillCircle(p.x, p.y, p.radius);
    // Lit side + craters break up the plain disc.
    g.fillStyle(0xffffff, 0.25);
    g.fillCircle(p.x - p.radius * 0.3, p.y - p.radius * 0.3, p.radius * 0.45);
    g.fillStyle(0x000000, 0.18);
    for (const c of p.craters) g.fillCircle(p.x + Math.cos(c.a) * c.d, p.y + Math.sin(c.a) * c.d, c.r);
  }

  // Long dotted line showing where a release goes; turns green when it will reach a planet.
  drawAimGuide(g, assist) {
    let dx;
    let dy;
    let length;
    if (assist) {
      dx = assist.aimX - this.comet.x;
      dy = assist.aimY - this.comet.y;
      length = Math.hypot(dx, dy);
      dx /= length;
      dy /= length;
    } else {
      const v = tangentVelocity(this.orbit, 1);
      dx = v.vx;
      dy = v.vy;
      length = 520;
    }
    // White = no target, green = will reach a planet, gold = PERFECT window.
    const color = !assist ? 0xffffff : assist.angle < TUNING.perfectAngle ? 0xffe14d : 0x5eff8f;
    const dots = Math.floor(length / 34);
    for (let i = 1; i <= dots; i++) {
      const t = i / dots;
      g.fillStyle(0x1a1033, 0.6);
      g.fillCircle(this.comet.x + dx * i * 34, this.comet.y + dy * i * 34, 9 - t * 4);
      g.fillStyle(color, assist ? 1 : 0.85 - t * 0.6);
      g.fillCircle(this.comet.x + dx * i * 34, this.comet.y + dy * i * 34, 6 - t * 3);
    }
  }

  drawComet() {
    const g = this.cometGfx;
    g.clear();
    const f = speedFraction(this.speed);
    const color = speedColor(f);
    const r = TUNING.cometRadius;
    for (let i = this.trail.length - 1; i > 0; i--) {
      const t = 1 - i / this.trail.length;
      g.lineStyle(r * 2 * t + 2, color, t * 0.9);
      g.lineBetween(this.trail[i].x, this.trail[i].y, this.trail[i - 1].x, this.trail[i - 1].y);
    }
    g.fillStyle(0x1a1033, 1);
    g.fillCircle(this.comet.x, this.comet.y, r + 5);
    g.fillStyle(color, 1);
    g.fillCircle(this.comet.x, this.comet.y, r);
    g.fillStyle(0xffffff, 0.9);
    g.fillCircle(this.comet.x - 5, this.comet.y - 5, r * 0.45);
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
    this.draw();
    this.cameras.main.shake(300, 0.02);
    this.cameras.main.flash(200, 255, 255, 255);
    this.burst(this.comet.x, this.comet.y, 0xff9a2e, 22);
    this.time.delayedCall(800, () => {
      this.scene.start('GameOver', { score: Math.floor(this.score), altitude: this.bestAltitude, reason });
    });
  }
}
