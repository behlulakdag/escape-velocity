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
    this.topSpeed = this.speed;   // run stats for the game over screen
    this.maxChain = 0;
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
    this.initCards();

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

    ART.setPage(0);
    this.bursts = [];
    this.createStarfield();
    this.bestGfx = this.add.graphics();
    this.worldGfx = this.add.graphics();
    // Planet / asteroid / black hole Images are slotted in right above worldGfx (see ART.bodyImage),
    // so this layer (nova, aim chevrons, target outline, ink bursts) always draws over them.
    this.frontGfx = this.add.graphics();
    this.speedGfx = this.add.graphics().setScrollFactor(0);
    this.catchGfx = this.add.graphics();   // teaching ring around the planet to catch next
    this.cardFxGfx = this.add.graphics();  // card effects: wind lines, shockwave line, card doodles
    this.cometGfx = this.add.graphics();
    this.introGfx = this.add.graphics();
    this.createBestMarker();
    this.scene.launch('Hud');
    this.hud = this.scene.get('Hud');
    this.learnedCatch = hasLearnedCatch();
    this.hintStage = 0;   // 0: teach hold, 1: teach release, 2: teach catching the next planet, 3: done
    this.events.once('shutdown', () => this.scene.stop('Hud'));
    // Menu / GameOver draw with the first page's ink, whatever page this run ended on.
    this.events.once('shutdown', () => ART.setPage(0));

    this.input.on('pointerdown', () => this.pressHold());
    this.input.on('pointerup', () => this.releaseHold());
    this.input.on('pointerupoutside', () => this.releaseHold());
    // Keyboard is an optional extra for desktop testing.
    this.input.keyboard.on('keydown-SPACE', () => this.pressHold());
    this.input.keyboard.on('keyup-SPACE', () => this.releaseHold());
    this.events.once('shutdown', () => { this.tweens.timeScale = 1; });
    // CardScene reports the chosen card on the global emitter (it is a separate scene).
    this.onCardPicked = (id) => this.pickCard(id);
    this.game.events.on('cards:picked', this.onCardPicked);
    this.events.once('shutdown', () => {
      this.game.events.off('cards:picked', this.onCardPicked);
      this.closeCardScene();
    });
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
    this.deathT = -1;           // real seconds into the death beat (jaws close), -1 = alive
    this.kickGraceT = 0;        // seconds after a Wall Kick in which a planet bump costs nothing
    this.windGraceT = 0;        // seconds after SECOND WIND / UNBREAKABLE in which a bump costs nothing
    this.perfectFlashAt = -1e9; // time.now of the last PERFECT (every one, chained or not): comet flash
    this.momentumZoom = 0;      // eased extra zoom-out from momentum (feel only)
    this.lastPopAt = -1e9;      // time.now of the last pop sent (low-priority pops wait for quiet)
    this.hudPage = -1;          // page index the HUD was last told about (hud.setPage)
    // The scene instance is reused between runs, so this must be reset or later runs skip launch().
    this.launched = false;
  }

  pressHold() {
    if (this.introActive) return this.skipIntro();
    if (this.cardPick) return;   // the tap belongs to the cards on top
    this.inputGuard = false;
    this.isHolding = true;
  }

  // ---------- upgrade cards (rules in src/cards.js, UI in CardScene) ----------

  initCards() {
    this.ownedCards = [];
    this.mods = cardMods(this.ownedCards);
    this.cardPick = null;       // { choices, realT } while the pick is on screen
    this.pickDelay = -1;        // real seconds until the zone's card pick opens, -1 = none pending
    this.inputGuard = false;    // swallows the release of the finger that tapped a card
    this.shieldCharges = 0;     // Heat Shield charges left in this zone
    this.rescuesLeft = 0;       // Unbreakable
    this.secondWindUsed = false; // one-time SECOND WIND (any run, no card needed)
    this.lastCatchPopAt = -1e9;
    this.catches = 0;            // planets caught this run (SECOND WIND needs a few)
    this.afterburnerT = 0;      // seconds of afterburner left
    this.overdriveFxT = 0;
    this.shockFx = null;        // { y, push, t }: shock line pushing the supernova down
    this.cardDoodles = [];      // short ink doodles for card events (drawCardFx)
  }

  grabRange() {
    return grabRangeForSpeed(this.speed) * this.mods.grabRangeMul;
  }

  perfectAngle() {
    return this.mods.perfectAngle || TUNING.perfectAngle;
  }

  openCardPick() {
    if (this.isOver || this.cardPick) return;
    const choices = drawCardChoices(this.ownedCards, Math.random);
    if (!choices.length) return;
    // The simulator has no UI: it picks a random card at once.
    if (this.headless) return this.pickCard(choices[Math.floor(Math.random() * choices.length)]);
    this.cardPick = { choices, realT: 0 };
    // Gameplay input is ignored while choosing; an orbit just keeps spinning (orbits are stable).
    this.isHolding = false;
    this.sfx('cardopen', {});
    if (this.game.scene.keys.Cards) {
      this.scene.launch('Cards', { choices, owned: this.ownedCards.slice(), timeout: GameScene.CARD_TIMEOUT });
    }
  }

  // Safety net in case the card UI never answers: auto-pick the middle card a bit after its timeout.
  updateCardPickFallback(realDt) {
    this.cardPick.realT += realDt;
    if (this.cardPick.realT > GameScene.CARD_TIMEOUT + 1.5) {
      const c = this.cardPick.choices;
      this.pickCard(c[Math.min(1, c.length - 1)]);
    }
  }

  closeCardScene() {
    if (this.game.scene.keys.Cards && this.scene.isActive('Cards')) this.scene.stop('Cards');
  }

  pickCard(id) {
    if (this.isOver || this.ownedCards.indexOf(id) >= 0) return;
    const card = cardById(id);
    if (!card) return;
    if (!this.headless) {
      if (!this.cardPick || this.cardPick.choices.indexOf(id) < 0) return;
      this.cardPick = null;
      this.closeCardScene();
      // Ease out of the slow motion and swallow the release of the tapping finger.
      this.slowMoT = FEEL.slowMoHold;
      this.inputGuard = true;
      this.isHolding = false;
    }
    const setsBefore = activeSetBonuses(this.ownedCards);
    this.ownedCards.push(id);
    this.mods = cardMods(this.ownedCards);
    if (id === 'heatshield') this.shieldCharges = this.mods.heatShieldCharges;
    const newSets = activeSetBonuses(this.ownedCards).filter((f) => setsBefore.indexOf(f) < 0);
    if (newSets.indexOf('shield') >= 0) this.rescuesLeft = this.mods.rescues;
    const color = CARD_FAMILIES[card.family].color;
    this.sfx('cardpick', { id });
    this.popText(card.name.toUpperCase() + '!', GameScene.hex(color), { size: 40, duration: 900 });
    this.burst(this.comet.x, this.comet.y, color, 14, 150);
    if (this.hud.setCards) this.hud.setCards(this.ownedCards.slice());
    for (const family of newSets) {
      if (this.hud.showSetBonus) this.hud.showSetBonus(family);
      this.sfx('setbonus', { family });
      this.burst(this.comet.x, this.comet.y, CARD_FAMILIES[family].color, 22, 220);
      this.cameras.main.shake(180, 0.008);
    }
  }

  // Heat Shield: a hit that would cost speed is absorbed instead. Returns true when it was.
  useHeatShield() {
    if (this.shieldCharges <= 0) return false;
    this.shieldCharges--;
    this.popText('SHIELD!', GameScene.hex(CARD_FAMILIES.shield.color), { size: 44 });
    this.sfx('shield');
    this.cameras.main.shake(120, 0.006);
    this.burst(this.comet.x, this.comet.y, CARD_FAMILIES.shield.color, 16, 130);
    this.cardDoodle('shield', this.comet.x, this.comet.y);
    this.jellyT = 0;
    return true;
  }

  // Unbreakable: the supernova caught you, but once per run the comet is flung back out of it.
  rescueFromNova() {
    this.rescuesLeft--;
    this.orbit = null;
    this.orbitPlanet = null;
    this.scrape = null;
    this.homing = null;
    this.capTime = 0;
    this.speed = Math.max(this.speed, GameScene.RESCUE_SPEED);
    this.comet.vx = 0;
    this.comet.vy = -this.speed;
    const from = this.novaY;
    this.novaY = this.comet.y + GameScene.RESCUE_PUSH;
    this.shockFx = { y: from, push: this.novaY - from, t: 0 };
    this.closeArmed = false;
    this.breakChain();
    this.windGraceT = GameScene.WIND_GRACE;
    this.popText('UNBREAKABLE!', GameScene.hex(CARD_FAMILIES.shield.color), { size: 64, duration: 1200 });
    this.sfx('rescue');
    if (this.hud.flash) this.hud.flash(CARD_FAMILIES.shield.color, 0.16, 260, 0.16);
    this.cameras.main.shake(260, 0.016);
    this.burst(this.comet.x, this.comet.y, CARD_FAMILIES.shield.color, 24, 220);
    this.cardDoodle('rescue', this.comet.x, this.comet.y);
    this.freeze(FEEL.hitstopPerfect);
  }

  // SECOND WIND: once per run, the first supernova catch below HYPERSONIC flings the comet back up
  // (a weaker Unbreakable), so a learning player still sees the first card pick and HYPERSONIC.
  secondWind() {
    this.secondWindUsed = true;
    this.orbit = null;
    this.orbitPlanet = null;
    this.scrape = null;
    this.homing = null;
    this.capTime = 0;
    this.speed = Math.max(this.speed, TUNING.secondWindSpeed);
    this.comet.vx = 0;
    this.comet.vy = -this.speed;
    const from = this.novaY;
    this.novaY = this.comet.y + TUNING.secondWindPush;
    this.shockFx = { y: from, push: this.novaY - from, t: 0 };
    this.closeArmed = false;
    this.breakChain();
    // Priority 3 = the HUD's high priority: it goes below the comet, never queued behind a banner.
    this.windGraceT = GameScene.WIND_GRACE;
    this.popText('SECOND WIND!', '#5eff8f', { size: 60, duration: 1100, priority: 3 });
    this.sfx('secondwind');
    if (this.hud.flash) this.hud.flash(0x5eff8f, 0.14, 240, 0.14);
    this.cameras.main.shake(220, 0.012);
    this.burst(this.comet.x, this.comet.y, 0x5eff8f, 20, 200);
    this.cardDoodle('rescue', this.comet.x, this.comet.y);
    this.freeze(FEEL.hitstopPerfect);
  }

  // Card visuals drawn by the scene itself (the comet's own looks live in art.js via artContext).
  // Everything is ink doodles on the page; jitter seeds change at the boil rate (10/s), not per frame.
  drawCardFx(dt) {
    const g = this.cardFxGfx;
    g.clear();
    if (this.headless || this.isOver) return;
    const c = this.comet;
    const t = this.time.now / 1000;
    const bf = ART.boilFrame(t);
    const flying = !this.orbit && !this.scrape && this.cometVisible;
    const slip = this.mods.climbNoDecay && c.vy < 0;
    if (flying && (this.mods.flightDecayMul < 1 || slip)) {
      // Aerodynamic / Slipstream: dashed pencil wind lines hugging the comet's flanks.
      const len = Math.hypot(c.vx, c.vy) || 1;
      const ux = c.vx / len;
      const uy = c.vy / len;
      const color = slip ? ART.ink : ART.crayon(CARD_FAMILIES.flight.color);
      const rnd = artRandom(bf * 71 + 5);
      for (const side of [-1, 1]) {
        const pts = [];
        for (let i = 0; i <= 6; i++) {
          const k = i / 6;
          const back = 10 + k * (slip ? 130 : 95);
          const off = side * (TUNING.cometRadius + 8 + k * 16) + (rnd() - 0.5) * 5 * k;
          pts.push({ x: c.x - ux * back - uy * off, y: c.y - uy * back + ux * off });
        }
        // Two dashes per side, the second one curling outward a little.
        g.lineStyle(7, ART.backing, 0.35);
        g.strokePoints(pts.slice(0, 4), false);
        g.lineStyle(3.5, color, 0.9);
        g.strokePoints(pts.slice(0, 4), false);
        g.lineStyle(2.5, color, 0.6);
        g.strokePoints(pts.slice(4), false);
      }
    }
    if (this.shockFx) {
      // Shockwave / Unbreakable: a heavy pen line slamming the supernova front down, with
      // ink arrows pointing down and crayon hatching trailing above it.
      const s = this.shockFx;
      // The line starts at the comet and slams down to where the front ends up, so it is seen
      // even when the front itself is off the bottom of the screen.
      if (s.from === undefined) s.from = Math.min(s.y, c.y + TUNING.cometRadius * 2);
      s.t += dt;
      const k = Math.min(1, s.t / GameScene.SHOCK_FX_TIME);
      const y = s.from + (s.y + s.push - s.from) * (1 - (1 - k) * (1 - k));
      const view = this.visibleBounds();
      ART.drawShockLine(g, view.left, view.right, y, 1 - k, ART.crayon(CARD_FAMILIES.shield.color), t);
      if (k >= 1) this.shockFx = null;
    }
    this.cardDoodles = (this.cardDoodles || []).filter((d) => {
      d.age += dt / d.duration;
      if (d.age >= 1) return false;
      ART.drawCardDoodle(g, d, t);
      return true;
    });
  }

  // One-off ink doodle for a card event: 'kick' | 'shatter' | 'shield' | 'rescue' (see ART.drawCardDoodle).
  cardDoodle(kind, x, y, extra) {
    if (this.headless) return;
    if (!this.cardDoodles) this.cardDoodles = [];
    this.cardDoodles.push(Object.assign({ kind, x, y, age: 0, duration: kind === 'rescue' ? 0.9 : 0.55, seed: Math.floor(Math.random() * 1e5) }, extra || {}));
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

  // Sketchbook background: a construction-paper page per zone (locked to the world, like a long
  // drawing), cream ink stars at two depths, and a screen-space layer for page marks (streaks/rays).
  createStarfield() {
    if (!this.textures.exists('stars')) ART.makeStarTexture(this, 'stars');
    if (!this.headless) ART.warmAll(this, 'l');
    this.cameras.main.setBackgroundColor(ZONES[0].paper);
    // Oversized so the background still fills the screen when the camera zooms out.
    const w = GAME_WIDTH / (TUNING.minZoom - TUNING.momentumZoomOut);
    const h = GAME_HEIGHT / (TUNING.minZoom - TUNING.momentumZoomOut);
    this.pageRect = { x: (GAME_WIDTH - w) / 2, y: (GAME_HEIGHT - h) / 2, w, h };
    const layer = (key) => this.add.tileSprite(this.pageRect.x, this.pageRect.y, w, h, key).setOrigin(0).setScrollFactor(0);
    this.paper = layer(ART.paperTexture(this, 0));
    this.pageNext = null;
    this.starsFar = layer('stars').setAlpha(0.3).setTileScale(0.7);
    this.starsNear = layer('stars');
    this.starsSparkle = layer('stars_sparkle').setAlpha(0.8);
    this.pageFxGfx = this.add.graphics().setScrollFactor(0);
    this.pageEdgeGfx = this.add.graphics().setScrollFactor(0);
    this.pageFxFrame = -1;
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
    if (this.isOver || this.cardPick) return;
    if (this.inputGuard) {
      // The finger that tapped a card lifted: not a fling.
      this.inputGuard = false;
      return;
    }
    if (this.orbit) this.fling(false);
  }

  // Current speed cap: rises with the best altitude so the speed keeps climbing all run.
  speedCap() {
    return maxSpeedForAltitude(this.bestAltitude);
  }

  addSpeed(amount) {
    this.speed = Math.max(this.speed, Math.min(this.speedCap(), this.speed + amount));
  }

  // A speed gain that snowballs with momentum (catch, PERFECT, milestone): faster = bigger gains.
  addMomentumSpeed(amount) {
    this.addSpeed(amount * momentumGainMul(this.speed));
  }

  // Leaves the orbit. overspeed: the planet let go by itself (held at the cap too long), which
  // never scores a PERFECT and does not touch isHolding (the finger may still be down).
  fling(overspeed) {
    const v = tangentVelocity(this.orbit, this.speed);
    const assist = this.currentAssist();
    const perfect = !overspeed && assist && assist.angle < this.perfectAngle();
    if (perfect) {
      this.addMomentumSpeed(TUNING.perfectBonus);
      this.onPerfect();
    } else {
      this.breakChain();
    }
    if (!overspeed && this.mods.releaseBonus > 0) {
      // Slingshot: every release adds a share of the current speed.
      this.addSpeed(this.speed * this.mods.releaseBonus);
      this.burst(this.comet.x, this.comet.y, CARD_FAMILIES.fling.color, 8, 120);
      if (!perfect) this.popText('SLINGSHOT!', GameScene.hex(CARD_FAMILIES.fling.color), { size: 32, duration: 500, low: true });
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
    this.maxChain = Math.max(this.maxChain, this.perfectChain);
    this.perfectPulseAt = this.time.now;
    this.perfectFlashAt = this.time.now;   // art: ink ring burst + comet flash on EVERY PERFECT
    const chain = this.perfectChain;
    this.score += perfectChainBonus(chain) * this.mods.chainScoreMul;
    if (this.mods.afterburnerSeconds > 0) this.afterburnerT = this.mods.afterburnerSeconds;
    if (this.mods.chainSpeed > 0 && chain > 1) {
      // Chain Reaction: every PERFECT after the first adds more speed, the longer the chain.
      this.addSpeed(this.mods.chainSpeed * Math.min(chain - 1, CARD_TUNING.chainSpeedMaxSteps));
      this.burst(this.comet.x, this.comet.y, CARD_FAMILIES.fling.color, 10, 200);
    }
    const heat = Math.min(1, (chain - 1) / 5);
    // Only the first PERFECT of a chain pops; later ones tick the HUD combo counter, and the
    // chain milestones (5 / 10 / 25...) get their own stamp, so the feedback never repeats.
    if (chain === 1) this.popText('PERFECT!', '#ffe14d', { size: 48 });
    this.sfx('perfect', { chain });
    // Gentle overlay instead of a solid camera flash, so the comet stays visible at high chains.
    if (this.hud.flash) this.hud.flash(0xffe14d, 0.08 + heat * 0.06, 150 + heat * 60, 0.14);
    this.cameras.main.shake(140, 0.006 + heat * 0.008);
    this.burst(this.comet.x, this.comet.y, 0xffe14d, 8 + Math.min(chain, 6) * 3, 160);
    this.freeze(FEEL.hitstopPerfect);
    if (this.hud.setChain) this.hud.setChain(chain);
    if (chain > 1 && !this.headless && this.hud.comboTick) this.hud.comboTick(chain);
    const level = chainMilestoneLevel(chain);
    if (level > 0) this.chainMilestone(level);
  }

  // NICE! / BLAZING! / UNSTOPPABLE!: a speed bonus scaled by level plus a HUD stamp.
  chainMilestone(level) {
    const chain = this.perfectChain;
    this.addMomentumSpeed(milestoneSpeedBonus(level));
    this.sfx('milestone', { level, chain });
    if (this.headless) return;
    if (this.hud.showMilestone) this.hud.showMilestone(CHAIN_MILESTONE_NAMES[level], level);
    this.cameras.main.shake(160 + level * 40, 0.006 + level * 0.003);
    this.burst(this.comet.x, this.comet.y, level >= 3 ? 0xff9a2e : 0xffe14d, 10 + level * 4, 160 + level * 30);
    this.zoomKick = Math.max(this.zoomKick, 0.03 + level * 0.015);
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
    const range = this.grabRange();
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
    const realDt = Math.min(delta / 1000, 0.05);
    if (this.isOver) {
      if (this.headless) return;
      if (this.deathT >= 0) this.updateDeathBeat(realDt);
      this.draw();   // let the final ink bursts finish (visual only)
      return;
    }
    if (this.introActive) return this.updateIntro(realDt);
    if (this.hintStage === 0 && this.hud.hintText && !this.hud.hintText.text) {
      this.hud.showHint('HOLD near a planet');
      this.hud.showBanner('ESCAPE THE SUPERNOVA!', '', { duration: 1500 });
    }
    this.updateFeelTimers(realDt);
    this.updatePickDelay(realDt);
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
    if (this.cardPick) {
      // Deep slow motion while choosing a card: the whole world (supernova included) crawls.
      timeScale = GameScene.CARD_TIME_SCALE;
      this.updateCardPickFallback(realDt);
    }
    this.tweens.timeScale = timeScale;
    const dt = realDt * timeScale;
    const altitude = this.startY - this.comet.y;
    this.afterburnerT = Math.max(0, this.afterburnerT - dt);
    this.kickGraceT = Math.max(0, this.kickGraceT - dt);
    this.windGraceT = Math.max(0, this.windGraceT - dt);

    if (this.noGrabPlanet && this.distanceTo(this.noGrabPlanet) > this.noGrabPlanet.radius + this.grabRange()) {
      this.noGrabPlanet = null;
    }
    if (this.scrape) {
      this.updateScrape(dt);
    } else if (!this.orbit) {
      if (this.isHolding) {
        const planet = this.nearestGrabbablePlanet();
        if (planet) this.latch(planet, false);
      } else if (this.autoCatchTarget && this.distanceTo(this.autoCatchTarget) < this.autoCatchTarget.radius + this.grabRange()) {
        this.latch(this.autoCatchTarget, true);
      }
    }

    if (this.scrape) {
      // updateScrape already placed the comet on the surface.
    } else if (this.orbit) {
      const boost = { gainMul: this.mods.orbitGainMul, closeMul: this.mods.closeOrbitMul, tighten: this.mods.orbitTighten };
      const step = orbitStep(this.orbit, this.speed, dt, this.orbitPlanet.radius, this.speedCap(), boost);
      this.orbit = step.orbit;
      this.speed = step.speed;
      if (this.mods.orbitGainMul > 1 && this.speed < this.speedCap() - 1) {
        // Overdrive: teal sparks spray off the comet while it spins up.
        this.overdriveFxT -= dt;
        if (this.overdriveFxT <= 0) {
          this.overdriveFxT = 0.12;
          this.burst(this.comet.x, this.comet.y, CARD_FAMILIES.orbit.color, 2, 60);
        }
      }
      this.comet.x = this.orbitPlanet.x + Math.cos(this.orbit.angle) * this.orbit.radius;
      this.comet.y = this.orbitPlanet.y + Math.sin(this.orbit.angle) * this.orbit.radius;
      this.capTime = this.speed >= this.speedCap() - 1 ? this.capTime + dt : 0;
      const u = tangentVelocity(this.orbit, 1);
      if (overspeedFling(this.capTime, u.vx, u.vy)) this.fling(true);
    } else {
      // Aerodynamic cuts the decay; Afterburner (after a PERFECT) and Slipstream (climbing) stop it.
      const noDecay = this.afterburnerT > 0 || (this.mods.climbNoDecay && this.comet.vy < 0);
      if (!noDecay) this.speed -= flightDecay(altitude) * this.mods.flightDecayMul * dt;
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
    if (this.speed > this.topSpeed) this.topSpeed = this.speed;
    this.updateNova(dt);
    // The supernova is the only way to lose: speed is what keeps you ahead of it.
    if (this.comet.y + TUNING.cometRadius * 0.5 > this.novaY) {
      if (secondWindAllowed(this.secondWindUsed, this.bestAltitude, this.catches)) this.secondWind();
      else if (this.rescuesLeft > 0) this.rescueFromNova();
      else return this.gameOver('SUPERNOVA!');
    }
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
    // Every card makes the wave faster, so upgrades never make the run easy.
    this.novaY -= novaSpeed(this.elapsed, this.bestAltitude) * this.mods.novaSpeedMul * dt;
    // Never let it fall far behind, so the threat is always close.
    this.novaY = Math.min(this.novaY, this.anchorBottom() + TUNING.novaLeash);
    const gap = this.novaY - this.comet.y;
    if (this.hud.setDanger) this.hud.setDanger(1 - (gap - 150) / 450);
  }

  checkZone() {
    const index = zoneIndexForAltitude(this.bestAltitude);
    if (index <= this.zoneIndex) return;
    this.zoneIndex = index;
    this.zonePulseAt = this.time.now;
    this.hud.showBanner(ZONES[index].name, 'TOP SPEED ' + Math.round(this.speedCap() / 10) + ' km/s');
    this.sfx('zone', { index });
    this.turnPage(index);
    this.shieldCharges = this.mods.heatShieldCharges;   // Heat Shield recharges every zone
    // Banner and page turn get the stage first; the cards come in once they have been read.
    // The simulator has no UI to wait for, so it picks at once.
    if (this.headless) this.openCardPick();
    else this.pickDelay = GameScene.PICK_DELAY;
  }

  // Real-time countdown (runs through hitstop and slow motion) to the zone's card pick.
  updatePickDelay(realDt) {
    if (this.pickDelay < 0) return;
    this.pickDelay -= realDt;
    if (this.pickDelay > 0) return;
    this.pickDelay = -1;
    if (this.hud.hideBanner) this.hud.hideBanner();   // the card header takes the banner's place
    this.openCardPick();
  }

  // Tells the HUD which page it is drawn over (dark ink on the cream page). A turning page counts
  // once its edge is past the middle of the screen, where the banner and pops sit.
  syncHudPage() {
    if (!this.hud.setPage || !this.hud.scoreText) return;
    let page = ART.pageIndex;
    if (this.pageNext && this.pageNext.y + this.pageNext.height > GAME_HEIGHT / 2) page = this.pageNextIndex;
    if (page === this.hudPage) return;
    this.hudPage = page;
    this.hud.setPage(page);
  }

  // New zone = a new sketchbook page sliding down over the old one (no full-screen flash).
  // Art only: gameplay for a new zone (cards, shield recharge) stays in checkZone, so the
  // headless simulator still gets it.
  turnPage(index) {
    if (this.headless) return;
    // The last page uses dark ink: warm those textures up a page early.
    if (index === ZONES.length - 2) ART.warmAll(this, 'd');
    if (this.pageNext) this.finishPageTurn();
    this.sfx('pageturn', { index });
    const r = this.pageRect;
    const paperKey = ART.paperTexture(this, index);
    const next = this.add.tileSprite(r.x, r.y - r.h, r.w, r.h, paperKey).setOrigin(0).setScrollFactor(0);
    // TileSprite.texture is its own internal copy (destroyed with it), so keep the source key.
    next.paperKey = paperKey;
    this.children.moveTo(next, this.children.getIndex(this.paper) + 1);
    next.tilePositionX = this.paper.tilePositionX;
    next.tilePositionY = this.paper.tilePositionY;
    this.pageNext = next;
    this.pageNextIndex = index;
    this.pageTween = this.tweens.add({
      targets: next, y: r.y, duration: 650, ease: 'Cubic.easeInOut',
      onComplete: () => this.finishPageTurn(),
    });
  }

  finishPageTurn() {
    const next = this.pageNext;
    if (!next) return;
    if (this.pageTween) this.pageTween.stop();
    this.pageNext = null;
    this.paper.setTexture(next.paperKey);
    next.destroy();
    this.pageEdgeGfx.clear();
    const z = ZONES[this.pageNextIndex];
    ART.setPage(this.pageNextIndex);
    this.cameras.main.setBackgroundColor(z.paper);
    for (const s of [this.starsFar, this.starsNear, this.starsSparkle]) {
      if (z.ink === SKETCH.cream) s.clearTint(); else s.setTint(z.ink);
    }
    this.pageFxFrame = -1;
  }

  // Torn paper edge + soft shadow under the page that is sliding in.
  drawPageEdge() {
    const g = this.pageEdgeGfx;
    g.clear();
    const next = this.pageNext;
    if (!next) return;
    const edgeY = next.y + next.height;
    const r = this.pageRect;
    g.fillStyle(0x000000, 0.28);
    g.fillRect(r.x, edgeY, r.w, 18);
    g.fillStyle(0x000000, 0.14);
    g.fillRect(r.x, edgeY + 18, r.w, 20);
    // Slightly ragged edge in the new page's color, then a pen line along it.
    const z = ZONES[this.pageNextIndex];
    const pts = [];
    const rnd = artRandom(Math.floor(this.time.now / 100) * 7 + 3);
    for (let x = r.x; x <= r.x + r.w + 30; x += 30) pts.push({ x, y: edgeY + (rnd() - 0.5) * 8 });
    const poly = pts.slice();
    poly.push({ x: r.x + r.w + 30, y: edgeY - 12 });
    poly.push({ x: r.x, y: edgeY - 12 });
    g.fillStyle(z.paper, 1);
    g.fillPoints(poly, true);
    const ink = z.ink === SKETCH.cream ? 0xf4ead0 : z.ink;
    ART.pen(g, pts, false, 4, ink, 0.7, rnd);
    // Curled corner at the bottom right: the back of the new page folding up, so the slide
    // reads as a page being turned over (the back side is a paler version of the page color).
    // Screen-space layers are still scaled by the camera zoom around the center: this is the
    // visible right edge in this layer's coordinates.
    const zoom = this.cameras.main.zoom;
    const cs = 120 / zoom;
    const cx = Math.min(r.x + r.w, GAME_WIDTH / 2 + GAME_WIDTH / (2 * zoom));
    const back = lerpColor(z.paper, 0xffffff, 0.25);
    // The corner (cx, edgeY) is folded over the line A-B onto C: the triangle A-corner-B shows
    // the old page again, the flap A-B-C shows the back of the new page.
    const A = { x: cx - cs, y: edgeY };
    const B = { x: cx, y: edgeY - cs };
    const C = { x: cx - cs * 0.82 + (rnd() - 0.5) * 3, y: edgeY - cs * 0.82 + (rnd() - 0.5) * 3 };
    g.fillStyle(ZONES[ART.pageIndex].paper, 1);
    g.fillTriangle(A.x, A.y - 13, cx + 2, edgeY + 2, B.x + 2, B.y);
    g.fillStyle(0x000000, 0.3);
    g.fillTriangle(A.x - 4, A.y, B.x, B.y - 4, C.x - 14, C.y - 12);
    const curl = [A, B, C];
    g.fillStyle(back, 1);
    g.fillPoints(curl, true);
    g.lineStyle(2, ink, 0.35);
    for (let k = 1; k < 5; k++) {
      const f = k / 5;
      g.lineBetween(A.x + (B.x - A.x) * f, A.y + (B.y - A.y) * f, C.x + (A.x + B.x - 2 * C.x) * f * 0.15, C.y + (A.y + B.y - 2 * C.y) * f * 0.15);
    }
    ART.pen(g, curl, true, 3.5, ink, 0.85, rnd);
  }

  // Page marks redrawn at the boil rate: WARP SPEED ink streaks out of the center, the final
  // page's gold pencil rays from above. Drawn in screen space, oversized for the zoom.
  drawPageFx() {
    const fx = ZONES[ART.pageIndex].fx;
    const frame = Math.floor(this.time.now / 100);
    if (frame === this.pageFxFrame) return;
    this.pageFxFrame = frame;
    const g = this.pageFxGfx;
    g.clear();
    const rnd = artRandom(frame * 13 + 5);
    const cx = GAME_WIDTH / 2;
    const cy = GAME_HEIGHT / 2;
    if (fx === 'streaks') {
      for (let i = 0; i < 34; i++) {
        const a = (i / 34) * Math.PI * 2 + (rnd() - 0.5) * 0.12;
        const r0 = 260 + rnd() * 260;
        const len = 120 + rnd() * 260;
        const dash = rnd() < 0.5;
        g.lineStyle(1.5 + rnd() * 2.5, 0xf4ead0, 0.12 + rnd() * 0.14);
        if (dash) {
          g.lineBetween(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0, cx + Math.cos(a) * (r0 + len * 0.45), cy + Math.sin(a) * (r0 + len * 0.45));
          g.lineBetween(cx + Math.cos(a) * (r0 + len * 0.6), cy + Math.sin(a) * (r0 + len * 0.6), cx + Math.cos(a) * (r0 + len), cy + Math.sin(a) * (r0 + len));
        } else {
          g.lineBetween(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0, cx + Math.cos(a) * (r0 + len), cy + Math.sin(a) * (r0 + len));
        }
      }
    } else if (fx === 'rays') {
      const sx = cx;
      const sy = -420;
      for (let i = 0; i < 11; i++) {
        const a = Math.PI / 2 + (i - 5) * 0.16 + (rnd() - 0.5) * 0.03;
        for (let k = 0; k < 3; k++) {
          const off = (k - 1) * 0.012;
          g.lineStyle(3, 0xd9a43a, 0.18 + rnd() * 0.1);
          g.lineBetween(sx + Math.cos(a + off) * 300, sy + Math.sin(a + off) * 300, sx + Math.cos(a + off) * (1500 + rnd() * 400), sy + Math.sin(a + off) * (1500 + rnd() * 400));
        }
      }
    }
  }

  bounceWalls() {
    const r = TUNING.cometRadius;
    if (this.comet.x < r || this.comet.x > GAME_WIDTH - r) {
      this.comet.x = Phaser.Math.Clamp(this.comet.x, r, GAME_WIDTH - r);
      this.comet.vx = -this.comet.vx;
      if (this.mods.wallKick) return this.wallKick();
      this.sfx('wall');
      this.speed *= TUNING.wallBounceKeep;
      this.cameras.main.shake(90, 0.006);
      this.burst(this.comet.x, this.comet.y, 0xffffff, 6);
    }
  }

  // Wall Kick: the bounce turns upward and adds speed instead of costing it.
  wallKick() {
    const c = this.comet;
    const away = c.x < GAME_WIDTH / 2 ? 1 : -1;
    const len = Math.hypot(c.vx, c.vy) || 1;
    let ux = c.vx / len;
    let uy = c.vy / len;
    if (uy > GameScene.WALL_KICK_UP) {
      uy = GameScene.WALL_KICK_UP;
      ux = away * Math.sqrt(1 - uy * uy);
    }
    this.homing = null;
    this.kickGraceT = GameScene.KICK_GRACE;
    this.addSpeed(CARD_TUNING.wallKickBonus);
    c.vx = ux * this.speed;
    c.vy = uy * this.speed;
    this.sfx('wallkick');
    // Repeats every bounce, so it must not push PERFECT chain pops off the line (priority 1 = low).
    this.popText('WALL KICK!', GameScene.hex(CARD_FAMILIES.flight.color), { size: 40, priority: 1 });
    this.cameras.main.shake(120, 0.008);
    this.burst(c.x, c.y, CARD_FAMILIES.flight.color, 14, 150);
    this.burst(c.x, c.y, 0xffffff, 6, 90);
    this.cardDoodle('kick', c.x, c.y, { side: c.x < GAME_WIDTH / 2 ? -1 : 1 });
    this.zoomKick = Math.max(this.zoomKick, 0.04);
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
        if (this.mods.tailArmor) this.shatterAsteroid(a);
        else this.loseSpeed(TUNING.asteroidKeep);
      }
    }
  }

  // Tail Armor: the rock bursts apart and the comet gains speed from it.
  shatterAsteroid(a) {
    this.addSpeed(CARD_TUNING.armorBonus);
    this.sfx('shatter');
    this.popText('SHATTER! +SPEED', GameScene.hex(CARD_FAMILIES.shield.color), { size: 38 });
    this.cameras.main.shake(140, 0.01);
    this.burst(a.x, a.y, CARD_FAMILIES.shield.color, 12, 170);
    this.burst(a.x, a.y, 0xb8a28c, 10, 200);
    this.cardDoodle('shatter', a.x, a.y, { r: a.radius });
    this.jellyT = 0;
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
        this.popText('WARP!', '#c77dff', { low: true });
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
        // A Wall Kick that sends you straight into a planet stays a bonus: the bump is free.
        if (this.kickGraceT > 0) return;
        this.loseSpeed(planetHitKeep(this.zoneIndex));
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
    this.loseSpeed(planetHitKeep(this.zoneIndex));
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
    this.catches++;
    this.addMomentumSpeed(TUNING.catchBonus);
    const closeness = orbitCloseness(this.orbit.targetRadius, planet.radius);
    const close = closeness > 0.7;
    if (this.mods.tightCatchBonus > 0 && closeness > 0.6) {
      // Tight Spin: diving in deep before the hold is rewarded on the spot.
      this.addMomentumSpeed(this.mods.tightCatchBonus);
      this.burst(c.x, c.y, CARD_FAMILIES.orbit.color, 10, 150);
    }
    const teal = GameScene.hex(CARD_FAMILIES.orbit.color);
    if (this.mods.catchBurst > 0) {
      // Orbit Master: a speed burst on every catch.
      this.addSpeed(this.mods.catchBurst);
      this.burst(c.x, c.y, CARD_FAMILIES.orbit.color, 14, 170);
      this.zoomKick = Math.max(this.zoomKick, 0.04);
    }
    if (auto) this.popText('AUTO CATCH', '#c9c3e6', { size: 30, duration: 600, low: true });
    else if (close && this.mods.closeOrbitMul > 1) this.popText('TIGHT SPIN!', teal, { size: 44 });
    else if (this.time.now - this.lastCatchPopAt > GameScene.CATCH_POP_QUIET) {
      // Catches happen every second or two: name the gain only now and then, the speedometer
      // and speed lines carry it the rest of the time.
      this.lastCatchPopAt = this.time.now;
      if (close) this.popText('CLOSE ORBIT! +SPEED', '#ffe14d');
      else if (this.mods.catchBurst > 0) this.popText('SPEED BURST!', teal, { low: true });
      else this.popText('+SPEED', '#5eff8f', { low: true });
    }
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
    if (this.windGraceT > 0) {
      // Right after SECOND WIND / UNBREAKABLE: a bump into the next planet is free (no shield used).
      this.burst(this.comet.x, this.comet.y, 0x5eff8f, 6, 110);
      return;
    }
    if (this.useHeatShield()) return;
    this.speed = speedAfterHit(this.speed, keep);
    this.breakChain();
    this.jellyT = 0;
    this.sfx('hit');
    this.cameras.main.shake(160, 0.012);
    if (this.hud.flash) this.hud.flash(0xff4d6d, 0.12, 120);
    this.burst(this.comet.x, this.comet.y, 0xff4d6d, 10);
    this.popText('-' + Math.round((1 - keep) * 100) + '% SPEED', '#ff4d6d');
  }

  // opts: { size (px), stroke, duration (ms), low }. Drawn by the HUD in screen space, so it stays
  // readable at any zoom and is not left behind (and dragged onto the bottom HUD) at high speed.
  // One pop per event; low: a routine pop that is skipped when another pop went out just before,
  // so a catch right after a PERFECT release never stacks a second line. The HUD ranks the rest.
  popText(label, color, opts) {
    if (this.headless || !this.hud.scoreText) return;   // simulator, or HUD scene still starting
    // The card pick owns the screen; the card name pops after it closes (cardPick is cleared first).
    if (this.cardPick || this.isOver) return;
    opts = opts || {};
    const now = this.time.now;
    if (opts.low && now - this.lastPopAt < GameScene.LOW_POP_QUIET) return;
    this.lastPopAt = now;
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
      priority: opts.priority,
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
    // Momentum pulls the camera out a little more (feel only: the anchor and nova leash ignore it).
    this.momentumZoom = Phaser.Math.Linear(this.momentumZoom, momentum(this.speed) * TUNING.momentumZoomOut, Math.min(1, dt * 1.5));
    cam.setZoom(this.baseZoom - this.momentumZoom + this.zoomKick);
    cam.scrollX = this.look.x;
    cam.scrollY = center + this.look.y - GAME_HEIGHT / 2;
    // Look-ahead (feel only) must not push the comet into the bottom HUD band either.
    const maxScreenY = GAME_HEIGHT - GameScene.COMET_BAND_BOTTOM;
    const screenY = (this.comet.y - cam.scrollY - GAME_HEIGHT / 2) * cam.zoom + GAME_HEIGHT / 2;
    if (screenY > maxScreenY) cam.scrollY += (screenY - maxScreenY) / cam.zoom;
    // The paper is locked to the world (everything is drawn on it); stars sit at two depths.
    for (const page of [this.paper, this.pageNext]) {
      if (!page) continue;
      page.tilePositionX = cam.scrollX;
      page.tilePositionY = cam.scrollY;
    }
    this.starsFar.tilePositionX = cam.scrollX * 0.25;
    this.starsFar.tilePositionY = cam.scrollY * 0.25;
    this.starsNear.tilePositionX = cam.scrollX * 0.6;
    this.starsNear.tilePositionY = cam.scrollY * 0.6;
    this.starsSparkle.tilePositionX = cam.scrollX * 0.8;
    this.starsSparkle.tilePositionY = cam.scrollY * 0.8;
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
    if (this.mods.shockwavePush > 0) {
      // Shockwave: the escape blasts the supernova back down.
      this.shockFx = { y: this.novaY, push: this.mods.shockwavePush, t: 0 };
      this.novaY += this.mods.shockwavePush;
      this.sfx('shockwave');
      this.popText('SHOCKWAVE!', GameScene.hex(CARD_FAMILIES.shield.color), { size: 44, duration: 900 });
      this.cameras.main.shake(220, 0.012);
    }
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
      fontFamily: FONT, fontSize: '30px', color: '#8fe39a', stroke: '#14121c', strokeThickness: 8,
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

  // Hand-drawn dashed pen line at the previous best height, with a crayon pennant.
  drawBestMarker(view) {
    const g = this.bestGfx;
    g.clear();
    if (this.prevBestAlt <= 0) return;
    const y = this.bestY;
    const labelScreenY = this.worldToScreen(0, y).y;
    this.bestLabel.setVisible(labelScreenY > GameScene.BEST_LABEL_MIN_Y && labelScreenY < GAME_HEIGHT - GameScene.COMET_BAND_BOTTOM);
    if (y < view.top - 60 || y > view.bottom + 60) return;
    const bf = Math.floor(this.time.now / 100);
    const alpha = this.passedBest ? 0.35 : 1;
    const green = SKETCH.green;
    // Dashes stay put (drawn on the page); only their wobble boils.
    for (let x = 0; x < GAME_WIDTH; x += 44) {
      const r = artRandom(x * 7 + bf * 131);
      const x0 = x + r() * 6;
      const x1 = Math.min(GAME_WIDTH, x + 26 + r() * 8);
      const y0 = y + (r() - 0.5) * 5;
      const y1 = y + (r() - 0.5) * 5;
      g.lineStyle(10, SKETCH.shadowInk, 0.5 * alpha);
      g.lineBetween(x0, y0, x1, y1);
      g.lineStyle(5 + r() * 2, green, alpha);
      g.lineBetween(x0, y0, x1, y1);
    }
    // Pennant on a pen-drawn pole at the right side.
    const px = GAME_WIDTH - 70;
    const r = artRandom(bf * 17 + 5);
    const wave = Math.sin(this.time.now / 1000 * 6) * 5;
    const pole = [{ x: px, y }, { x: px + (r() - 0.5) * 3, y: y - 46 }, { x: px + (r() - 0.5) * 3, y: y - 94 }];
    ART.pen(g, pole, false, 5, ART.ink, alpha, r);
    const flag = [
      { x: px + 3, y: y - 92 + (r() - 0.5) * 3 },
      { x: px + 58 + wave, y: y - 72 + wave * 0.3 + (r() - 0.5) * 4 },
      { x: px + 3, y: y - 52 + (r() - 0.5) * 3 },
    ];
    g.fillStyle(green, 0.9 * alpha);
    g.fillPoints(flag.map((p) => ({ x: p.x + 3, y: p.y + 2 })), true);
    g.lineStyle(2.5, 0x3d8f4a, 0.8 * alpha);
    for (let k = 0; k < 4; k++) g.lineBetween(px + 10 + k * 9, y - 86 + k * 3, px + 6 + k * 9, y - 60 - k * 2);
    ART.pen(g, flag, true, 3.5, ART.ink, alpha, r);
  }

  // ---------- speed lines (screen space) ----------

  updateSpeedLines(dt) {
    const g = this.speedGfx;
    g.clear();
    if (this.headless) return;
    const intensity = Phaser.Math.Clamp((speedFraction(this.speed) - 0.45) / 0.55, 0, 1);
    const mom = momentum(this.speed);   // past 450 km/s the lines keep getting heavier
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
      const a = Math.sin(k * Math.PI) * (0.3 + intensity * 0.5);
      // Dashed pen speed lines: two dashes per streak in the page's ink.
      const L = s.length;
      g.lineStyle(3 + mom * 4, ART.ink, Math.min(1, a + mom * 0.2));
      g.lineBetween(toX(s.x), toY(s.y), toX(s.x + ux * L * 0.5), toY(s.y + uy * L * 0.5));
      g.lineBetween(toX(s.x + ux * L * 0.66), toY(s.y + uy * L * 0.66), toX(s.x + ux * L), toY(s.y + uy * L));
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

  // Swelling crayon star (before the blast), then expanding ink scribble rings (after it).
  drawIntro() {
    const g = this.introGfx;
    g.clear();
    const x = GAME_WIDTH / 2;
    const y = this.startY;
    const t = this.time.now / 1000;
    const bf = Math.floor(t * 10);
    const rnd = artRandom(bf * 53 + 7);
    if (this.introActive && this.explodeT < 0) {
      const s = Math.min(1, this.introT / GameScene.INTRO_EXPLODE);
      const ease = s * s;
      const shake = (rnd() - 0.5) * 8 * s;
      const r = 46 + 120 * ease + shake;
      // Spiky pen-drawn corona: one zigzag loop, points re-rolled with the boil.
      const spikes = [];
      const nS = 14;
      for (let i = 0; i < nS * 2; i++) {
        // Uneven spikes with jittered angles, so it never reads as a clip-art sun.
        const a = ((i + (rnd() - 0.5) * 0.5) / (nS * 2)) * Math.PI * 2 + bf * 0.02;
        const rr = i % 2 ? r * (0.98 + rnd() * 0.1) : r * (1.12 + rnd() * rnd() * 0.9);
        spikes.push({ x: x + Math.cos(a) * rr, y: y + Math.sin(a) * rr });
      }
      g.fillStyle(SKETCH.orange, 1);
      g.fillPoints(spikes, true);
      ART.pen(g, spikes, true, 4, ART.ink, 1, rnd);
      const body = ART.wobblyLoop(x, y, r, r * 0.96, 16, 0.08, rnd, rnd());
      g.fillStyle(SKETCH.yellow, 1);
      g.fillPoints(body.map((p) => ({ x: p.x + 4, y: p.y + 3 })), true);
      ART.hatchCircle(g, x + r * 0.1, y + r * 0.15, r * 0.85, -0.9, 9, 4, SKETCH.orange, 0.75, rnd);
      // It gets whiter (cream crayon) as it is about to blow.
      if (ease > 0.2) ART.hatchCircle(g, x - r * 0.15, y - r * 0.2, r * 0.6 * ease, 0.7, 8, 4, 0xfff6dc, ease, rnd);
      ART.pen(g, body, true, 6, ART.ink, 1, rnd);
      // This star IS the supernova about to be born: it already wears the villain's scowl,
      // eyes squeezing tighter as it swells.
      const line = 0x3a0d10;
      const er = r * 0.17;
      const ey = y - r * 0.08;
      for (const side of [-1, 1]) {
        const ex = x + side * r * 0.33;
        const eye = ART.wobblyLoop(ex, ey, er, er * (1 - 0.45 * ease), 9, 0.15, rnd, rnd());
        g.fillStyle(0xfff3d6, 1);
        g.fillPoints(eye, true);
        ART.pen(g, eye, true, 3.5, line, 1, rnd);
        g.fillStyle(line, 1);
        g.fillCircle(ex - side * er * 0.25, ey + er * 0.1, er * 0.45);
        g.lineStyle(7, line, 1);
        g.lineBetween(ex - side * er * 1.3, ey - er * 1.05, ex + side * er * 1.2, ey - er * 1.9 + (rnd() - 0.5) * 3);
      }
      const mouth = [];
      for (let k = 0; k <= 6; k++) mouth.push({ x: x - r * 0.28 + k * r * 0.093, y: y + r * 0.36 + (k % 2 ? -r * 0.07 : 0) + (rnd() - 0.5) * 2 });
      g.lineStyle(5, line, 1);
      g.strokePoints(mouth, false);
    }
    if (this.explodeT >= 0 && this.explodeT < 1.4) {
      const k = this.explodeT / 1.4;
      const rings = [
        { speed: 1500, width: 10, color: ART.ink },
        { speed: 1000, width: 12, color: SKETCH.yellow },
        { speed: 650, width: 12, color: SKETCH.orange },
      ];
      for (const ring of rings) {
        const rr = 60 + ring.speed * this.explodeT * (1 - k * 0.35);
        const w = ring.width * (1 - k) + 2;
        ART.dashedRing(g, x, y, rr, 22, rnd() * 6, w + 6, SKETCH.shadowInk, 0.35 * (1 - k), rnd);
        ART.dashedRing(g, x, y, rr, 22, rnd() * 6, w, ring.color, 1 - k, rnd);
      }
      // Shrinking crayon fireball scribble (small: the blast never washes the screen out).
      const fr = 120 * (1 - k) + 14;
      const blob = ART.wobblyLoop(x, y, fr, fr, 14, 0.3, rnd, rnd());
      g.fillStyle(SKETCH.orange, (1 - k) * 0.9);
      g.fillPoints(blob, true);
      ART.hatchCircle(g, x, y, fr * 0.7, -0.9, 10, 4, SKETCH.yellow, 1 - k, rnd);
      ART.pen(g, blob, true, 4, ART.ink, 1 - k, rnd);
      for (let i = 0; i < 6; i++) {
        const a = i * 1.05 + 0.3;
        const d = 80 + this.explodeT * 700;
        ART.asterisk(g, x + Math.cos(a) * d, y + Math.sin(a) * d, 14 * (1 - k) + 4, i % 2 ? SKETCH.yellow : ART.ink, 1 - k, 4, rnd);
      }
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
      perfectFlash: Math.max(0, 1 - (this.time.now - this.perfectFlashAt) / 220),
      momentum: momentum(this.speed),
      zonePulse: Math.max(0, 1 - (this.time.now - this.zonePulseAt) / 600),
      intro: this.introActive,
      aimKind: assist ? (assist.angle < this.perfectAngle() ? 'perfect' : 'target') : 'none',
      // Card hooks for art.js.
      afterburner: this.mods.afterburnerSeconds > 0 ? this.afterburnerT / this.mods.afterburnerSeconds : 0,
      shieldReady: this.shieldCharges > 0,
      grabRangeBonus: grabRangeForSpeed(this.speed) * (this.mods.grabRangeMul - 1),
      grabRange: this.grabRange(),   // the real grab reach (speed + Gravity Well), for the dashed ring
    };
  }

  draw() {
    if (this.headless) return;   // the simulator needs no art (it would only cost time)
    const g = this.worldGfx;
    const front = this.frontGfx;
    g.clear();
    front.clear();
    ART.tick(this);
    const assist = this.currentAssist();
    const ctx = this.artContext(assist);
    ctx.front = front;
    const view = this.visibleBounds();
    ART.drawWalls(g, view, ctx);
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
    if (!this.introActive || this.explodeT >= 0) ART.drawNova(front, this.novaY, view, ctx);
    if (this.orbit && !this.isOver) this.drawAimGuide(front, assist, ctx);
    this.drawBursts(front, ctx.time);
    this.drawCatchRing();
    const frameDt = this.hitstop > 0 ? 0 : Math.min(this.game.loop.delta / 1000, 0.05);
    this.drawCardFx(frameDt * (this.cardPick ? GameScene.CARD_TIME_SCALE : 1));
    this.updateSpeedLines(this.isOver ? 0 : frameDt);
    this.drawPageEdge();
    this.drawPageFx();
    this.cometGfx.clear();
    if (this.cometVisible) ART.drawComet(this.cometGfx, this.comet, this.trail, ctx);
    this.drawIntro();
    this.drawDeathBeat();
    this.updateHud();
    this.syncHudPage();
  }

  drawBursts(g, t) {
    const now = this.time.now;
    this.bursts = this.bursts.filter((b) => {
      b.age = (now - b.born) / b.duration;
      if (b.age >= 1) return false;
      ART.drawBurst(g, b, t);
      return true;
    });
  }

  // Onboarding: until the first real mid-flight catch, the planet you are flying at gets a
  // green crayon ring at the edge of its grab zone, plus a pen loop closing onto it ("hold here").
  drawCatchRing() {
    const g = this.catchGfx;
    g.clear();
    if (this.headless || this.hintStage !== 2 || this.orbit || this.scrape || this.isOver) return;
    const p = this.flightTarget || this.autoCatchTarget || this.nextPlanetAbove();
    if (!p) return;
    const zone = p.radius + this.grabRange();
    const gap = this.distanceTo(p) - zone;
    const near = Phaser.Math.Clamp(1 - gap / 600, 0.5, 1);
    const t = this.time.now / 1000;
    const rnd = artRandom(Math.floor(t * 10) * 23 + 9);
    const k = (t * 1.6) % 1;   // shrinking pulse: from outside the zone onto its edge
    const pulseR = zone + 70 * (1 - k);
    const loop = ART.wobblyLoop(p.x, p.y, pulseR, pulseR, 32, 10 / pulseR, rnd, rnd());
    ART.pen(g, loop, true, 10, SKETCH.shadowInk, 0.3 * near * k, rnd);
    ART.pen(g, loop, true, 5, SKETCH.green, 0.85 * near * k, rnd);
    ART.dashedRing(g, p.x, p.y, zone, 28, Math.floor(t * 10) * 0.03, 5, SKETCH.green, 0.6 * near, rnd);
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

  // Ink doodle burst (drawn by ART.drawBurst on the front layer). reach: max travel in px (default 110).
  // Fewer strokes than the count asked for: effects should mean something, not fill the screen.
  burst(x, y, color, count, reach) {
    if (this.headless) return;
    this.bursts.push({
      x, y, color, reach: reach || 110,
      count: Math.max(5, Math.min(12, Math.ceil(count * 0.6))),
      born: this.time.now, duration: 420, age: 0, seed: Math.floor(Math.random() * 100000),
    });
  }

  // Death beat timeline (real time): jaws close, then the snap (shake, flash, scribble burst).
  updateDeathBeat(realDt) {
    const before = this.deathT;
    this.deathT += realDt;
    // The fire front surges up past the comet as the jaws close.
    const k = Math.min(1, this.deathT / GameScene.DEATH_CLOSE);
    this.novaY = this.deathNovaY + (this.deathAt.y - 160 - this.deathNovaY) * (1 - (1 - k) * (1 - k));
    if (before < GameScene.DEATH_CLOSE && this.deathT >= GameScene.DEATH_CLOSE) {
      this.cometVisible = false;
      this.sfx('jaws');
      this.cameras.main.shake(300, 0.02);
      if (this.hud.flash) this.hud.flash(0xff9a2e, 0.18, 220, 0.18);
      this.burst(this.deathAt.x, this.deathAt.y, 0xff9a2e, 22, 200);
      this.burst(this.deathAt.x, this.deathAt.y, 0xffd23f, 16, 140);
    }
  }

  drawDeathBeat() {
    if (this.deathT < 0) return;
    ART.drawDeathJaws(this.introGfx, this.deathAt.x, this.deathAt.y, this.deathT / GameScene.DEATH_CLOSE, this.time.now / 1000);
  }

  updateHud() {
    if (!this.hud.scoreText) return;   // HUD scene still starting
    this.hud.setStats(Math.floor(this.score), this.bestAltitude, this.speed, this.speed / 10);
    if (this.hud.setMomentum) this.hud.setMomentum(momentum(this.speed));
  }

  gameOver(reason) {
    if (this.isOver) return;
    this.isOver = true;
    this.tweens.timeScale = 1;
    if (this.cardPick) {
      this.cardPick = null;
      this.closeCardScene();
    }
    const newBestAltitude = this.bestAltitude > this.prevBestAlt;
    if (!this.headless && newBestAltitude) saveBestAltitude(this.bestAltitude);
    this.pickDelay = -1;
    if (this.hud && this.hud.clearPops) this.hud.clearPops();
    this.sfx('gameover', { reason });
    // The simulator must never reach GameOver: it would save the bot's score as the real best.
    if (this.headless) return;
    // Death beat: the supernova's jaws snap shut over the comet, a crayon scribble bursts out of
    // them, a short hold, then the game over page (whose RETRY stays instant).
    this.deathT = 0;
    this.deathAt = { x: this.comet.x, y: this.comet.y };
    this.deathNovaY = this.novaY;
    this.isHolding = false;
    this.hud.hideHint();   // a 'TAP to fling!' left over the jaws would read as a second chance
    this.draw();
    this.cameras.main.shake(260, 0.012);
    this.time.delayedCall((GameScene.DEATH_CLOSE + GameScene.DEATH_HOLD) * 1000, () => {
      this.scene.start('GameOver', {
        score: Math.floor(this.score), altitude: this.bestAltitude, reason, newBestAltitude,
        bestAltitude: Math.max(this.bestAltitude, this.prevBestAlt),
        topSpeedKmh: Math.round(this.topSpeed / 10), maxChain: this.maxChain,
        zoneIndex: this.zoneIndex, seconds: Math.floor(this.elapsed),
        cards: this.ownedCards.slice(),
        secondWind: this.secondWindUsed,
      });
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

// Upgrade card pick: world time scale while the cards are up, and seconds before the middle card is auto-picked.
GameScene.CARD_TIME_SCALE = 0.06;
GameScene.CARD_TIMEOUT = 6;
// Unbreakable rescue: minimum speed after it, and how far below the comet the nova is pushed.
GameScene.RESCUE_SPEED = 1000;
GameScene.RESCUE_PUSH = 520;
// Wall Kick: the bounce leaves at least this steeply upward (unit vy).
GameScene.WALL_KICK_UP = -0.8;
GameScene.SHOCK_FX_TIME = 0.5;
// Wall Kick: seconds after the kick in which bumping a planet costs no speed (and pops nothing).
GameScene.KICK_GRACE = 0.45;
GameScene.WIND_GRACE = 1.0;     // s after SECOND WIND / UNBREAKABLE in which a planet bump is free
// Zone entry: real seconds between the zone banner / page turn and the card pick.
GameScene.PICK_DELAY = 1.2;
// ms after any pop in which routine (low) pops are skipped.
GameScene.LOW_POP_QUIET = 600;
GameScene.CATCH_POP_QUIET = 4000;   // ms between catch pops (+SPEED / CLOSE ORBIT / SPEED BURST)
// Death beat (seconds, real time): jaws closing, then the hold before the game over page.
GameScene.DEATH_CLOSE = 0.3;
GameScene.DEATH_HOLD = 0.55;

GameScene.hex = (color) => '#' + color.toString(16).padStart(6, '0');
