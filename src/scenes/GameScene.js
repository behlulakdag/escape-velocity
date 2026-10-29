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
    this.bestAltitude = 0;
    this.trail = [];

    this.comet = { x: GAME_WIDTH / 2, y: this.startY, vx: 0, vy: -this.speed };

    this.planets = [];
    this.nextPlanetY = this.startY - 560;
    // First planet straight ahead so the very first hold always works.
    this.addPlanet(GAME_WIDTH / 2 + 150, this.nextPlanetY, 70);
    this.nextPlanetY -= 420;
    this.fillPlanets();

    this.createStarfield();
    this.worldGfx = this.add.graphics();
    this.cometGfx = this.add.graphics();
    this.createHud();

    this.input.on('pointerdown', () => { this.isHolding = true; });
    this.input.on('pointerup', () => this.releaseHold());
    this.input.on('pointerupoutside', () => this.releaseHold());
    // Keyboard is an optional extra for desktop testing.
    this.input.keyboard.on('keydown-SPACE', () => { this.isHolding = true; });
    this.input.keyboard.on('keyup-SPACE', () => this.releaseHold());

    addFullscreenButton(this).setScrollFactor(0);
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

  // Keeps planets generated a screen ahead; gaps grow with altitude.
  fillPlanets() {
    const viewTop = this.cameras.main.scrollY;
    while (this.nextPlanetY > viewTop - GAME_HEIGHT) {
      const altitude = this.startY - this.nextPlanetY;
      const radius = Phaser.Math.Between(48, 90);
      const x = Phaser.Math.Between(110 + radius / 2, GAME_WIDTH - 110 - radius / 2);
      this.addPlanet(x, this.nextPlanetY, radius);
      const gap = Math.min(620, 380 + altitude * 0.02);
      this.nextPlanetY -= Phaser.Math.Between(gap - 60, gap + 80);
    }
    const viewBottom = viewTop + GAME_HEIGHT;
    this.planets = this.planets.filter((p) => p.y - p.radius < viewBottom + 400);
  }

  createStarfield() {
    const g = this.make.graphics({ x: 0, y: 0, add: false });
    for (let i = 0; i < 90; i++) {
      g.fillStyle(0xffffff, Phaser.Math.FloatBetween(0.3, 0.9));
      g.fillCircle(Phaser.Math.Between(0, 512), Phaser.Math.Between(0, 512), Phaser.Math.FloatBetween(1, 3));
    }
    g.generateTexture('stars', 512, 512);
    g.destroy();
    this.cameras.main.setBackgroundColor(0x2b1d5c);
    this.starsFar = this.add.tileSprite(0, 0, GAME_WIDTH, GAME_HEIGHT, 'stars').setOrigin(0).setScrollFactor(0).setAlpha(0.5);
    this.starsNear = this.add.tileSprite(0, 0, GAME_WIDTH, GAME_HEIGHT, 'stars').setOrigin(0).setScrollFactor(0).setTileScale(1.6);
  }

  createHud() {
    const style = { fontFamily: FONT, color: COLORS.text, stroke: '#1a1033', strokeThickness: 10 };
    this.altText = this.add.text(32, 40, '0 m', { ...style, fontSize: '56px' }).setScrollFactor(0).setDepth(100);
    this.speedText = this.add.text(GAME_WIDTH / 2, GAME_HEIGHT - 120, '', { ...style, fontSize: '64px' })
      .setOrigin(0.5).setScrollFactor(0).setDepth(100);
    this.hintText = this.add.text(GAME_WIDTH / 2, GAME_HEIGHT - 220, 'HOLD near a planet', { ...style, fontSize: '44px', color: '#ffe14d' })
      .setOrigin(0.5).setScrollFactor(0).setDepth(100);
    this.tweens.add({ targets: this.hintText, scale: 1.1, yoyo: true, repeat: -1, duration: 420 });
    this.hintStage = 0;   // 0: teach hold, 1: teach release, 2: done
  }

  // ---------- input ----------

  releaseHold() {
    this.isHolding = false;
    if (!this.orbit || this.isOver) return;
    const v = tangentVelocity(this.orbit, this.speed);
    this.comet.vx = v.vx;
    this.comet.vy = v.vy;
    const kick = speedFraction(this.speed);
    this.cameras.main.shake(120, 0.004 + kick * 0.01);
    this.burst(this.comet.x, this.comet.y, speedColor(kick), 10);
    this.orbit = null;
    this.orbitPlanet = null;
    if (this.hintStage === 1) {
      this.hintStage = 2;
      this.tweens.add({ targets: this.hintText, alpha: 0, duration: 400 });
    }
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
    const dt = Math.min(delta / 1000, 0.05);
    const altitude = this.startY - this.comet.y;

    if (this.isHolding && !this.orbit) {
      const planet = this.nearestGrabbablePlanet();
      if (planet) {
        this.orbit = startOrbit(planet.x, planet.y, this.comet.x, this.comet.y, this.comet.vx, this.comet.vy, planet.radius);
        this.orbitPlanet = planet;
        this.burst(this.comet.x, this.comet.y, 0xffffff, 6);
        if (this.hintStage === 0) {
          this.hintStage = 1;
          this.hintText.setText('RELEASE to fling!');
        }
      }
    }

    if (this.orbit) {
      const step = orbitStep(this.orbit, this.speed, dt, this.orbitPlanet.radius);
      this.orbit = step.orbit;
      this.speed = step.speed;
      this.comet.x = this.orbitPlanet.x + Math.cos(this.orbit.angle) * this.orbit.radius;
      this.comet.y = this.orbitPlanet.y + Math.sin(this.orbit.angle) * this.orbit.radius;
      if (step.crashed) return this.gameOver('CRASHED!');
    } else {
      this.speed -= flightDecay(altitude) * dt;
      // Keep direction, apply the decayed speed.
      const len = Math.hypot(this.comet.vx, this.comet.vy) || 1;
      this.comet.vx = (this.comet.vx / len) * this.speed;
      this.comet.vy = (this.comet.vy / len) * this.speed;
      this.comet.x += this.comet.vx * dt;
      this.comet.y += this.comet.vy * dt;
      this.bounceWalls();
      for (const p of this.planets) {
        if (Phaser.Math.Distance.Between(this.comet.x, this.comet.y, p.x, p.y) < p.radius + TUNING.cometRadius * 0.7) {
          return this.gameOver('CRASHED!');
        }
      }
      if (this.speed < TUNING.minSpeed) return this.gameOver('TOO SLOW!');
    }

    this.updateCamera(dt);
    if (this.comet.y > this.cameras.main.scrollY + GAME_HEIGHT + 80) return this.gameOver('LOST IN SPACE!');

    this.bestAltitude = Math.max(this.bestAltitude, Math.floor(altitude / 10));
    this.fillPlanets();
    this.recordTrail();
    this.draw();
    this.updateHud();
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

  // Camera only climbs; it eases toward keeping the comet in the lower part of the screen.
  updateCamera(dt) {
    const cam = this.cameras.main;
    const target = this.comet.y - GAME_HEIGHT * 0.62;
    if (target < cam.scrollY) cam.scrollY = Phaser.Math.Linear(cam.scrollY, target, Math.min(1, dt * 8));
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
    const grab = this.isHolding ? null : this.nearestGrabbablePlanet();
    for (const p of this.planets) this.drawPlanet(g, p, p === grab || p === this.orbitPlanet);
    if (this.orbit) this.drawAimGuide(g);
    this.drawComet();
  }

  drawPlanet(g, p, highlighted) {
    // Grab zone: dashed ring so players learn where holding works.
    const zone = p.radius + TUNING.grabRange;
    g.lineStyle(4, 0xffffff, highlighted ? 0.55 : 0.14);
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

  drawAimGuide(g) {
    const v = tangentVelocity(this.orbit, 1);
    g.fillStyle(0xffffff, 0.8);
    for (let i = 1; i <= 7; i++) {
      g.fillCircle(this.comet.x + v.vx * i * 42, this.comet.y + v.vy * i * 42, 7 - i * 0.6);
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
    this.altText.setText(this.bestAltitude + ' m');
    const f = speedFraction(this.speed);
    this.speedText.setText(Math.round(this.speed / 10) + ' km/s');
    this.speedText.setColor('#' + speedColor(f).toString(16).padStart(6, '0'));
    this.speedText.setScale(1 + f * 0.35);
  }

  gameOver(reason) {
    if (this.isOver) return;
    this.isOver = true;
    this.draw();
    this.cameras.main.shake(300, 0.02);
    this.cameras.main.flash(200, 255, 255, 255);
    this.burst(this.comet.x, this.comet.y, 0xff9a2e, 22);
    this.time.delayedCall(800, () => {
      this.scene.start('GameOver', { score: this.bestAltitude, reason });
    });
  }
}
