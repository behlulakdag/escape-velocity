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
// auto catch and the catch ring never come back, so only the very first run is assisted.
const LEARNED_CATCH_KEY = 'escape_velocity_learned_catch';

// Storage can be blocked (private tab, iframe settings): this session's tutorial progress is also kept in
// memory, so the tutorial still retires after its runs and the auto catch after the first real catch,
// instead of the learner help coming back on every run.
const SESSION_TUTORIAL = { runs: 0, goodCycles: 0, learnedCatch: false };

function hasLearnedCatch() {
  if (SESSION_TUTORIAL.learnedCatch) return true;
  try {
    return localStorage.getItem(LEARNED_CATCH_KEY) === '1';
  } catch (e) {
    return false;
  }
}

function saveLearnedCatch() {
  SESSION_TUTORIAL.learnedCatch = true;
  try {
    localStorage.setItem(LEARNED_CATCH_KEY, '1');
  } catch (e) { /* storage blocked: the player just gets the tutorial again */ }
}

// Learner-run progress: { runs, goodCycles } (rules in tutorialActive, src/orbit.js). It only decides the
// invisible learner help (learning window, calm wave); the on-screen tutorial is the guided one above.
const TUTORIAL_KEY = 'escape_velocity_tutorial_v1';

function loadTutorialState() {
  let stored = { runs: 0, goodCycles: 0 };
  try {
    stored = parseTutorialState(localStorage.getItem(TUTORIAL_KEY));
  } catch (e) { /* storage blocked: the session counter below still counts */ }
  return {
    runs: Math.max(stored.runs, SESSION_TUTORIAL.runs),
    goodCycles: Math.max(stored.goodCycles, SESSION_TUTORIAL.goodCycles),
  };
}

function saveTutorialState(state) {
  SESSION_TUTORIAL.runs = Math.max(SESSION_TUTORIAL.runs, state.runs);
  SESSION_TUTORIAL.goodCycles = Math.max(SESSION_TUTORIAL.goodCycles, state.goodCycles);
  try {
    localStorage.setItem(TUTORIAL_KEY, JSON.stringify({ runs: state.runs, goodCycles: state.goodCycles }));
  } catch (e) { /* storage blocked: the tutorial just shows again next time */ }
}

// Guided first-run tutorial (HOLD, then LET GO, then NICE!; rules in guidedTutorialStep, src/orbit.js):
// shown until it is finished once, then never again. The in-memory flag retires it for the session even
// when storage is blocked.
const GUIDED_TUTORIAL_KEY = 'escape_velocity_tutorial_v2';
let GUIDED_TUTORIAL_DONE_SESSION = false;

function guidedTutorialDone() {
  if (GUIDED_TUTORIAL_DONE_SESSION) return true;
  try {
    return parseGuidedTutorialDone(localStorage.getItem(GUIDED_TUTORIAL_KEY));
  } catch (e) {
    return false;
  }
}

function saveGuidedTutorialDone() {
  GUIDED_TUTORIAL_DONE_SESSION = true;
  try {
    localStorage.setItem(GUIDED_TUTORIAL_KEY, '1');
  } catch (e) { /* storage blocked: the session flag above still retires it */ }
}

// CLOSER = FASTER: stamped the first time in a player's life an orbit hugs a surface (close-orbit bonus),
// then never again (the session flag covers blocked storage).
const CLOSER_FASTER_KEY = 'escape_velocity_closer_faster_v1';
let CLOSER_FASTER_SESSION = false;

function closerFasterSeen() {
  if (CLOSER_FASTER_SESSION) return true;
  try {
    return localStorage.getItem(CLOSER_FASTER_KEY) === '1';
  } catch (e) {
    return false;
  }
}

function saveCloserFasterSeen() {
  CLOSER_FASTER_SESSION = true;
  try {
    localStorage.setItem(CLOSER_FASTER_KEY, '1');
  } catch (e) { /* storage blocked: the session flag above still retires it */ }
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
    this.simTutorial = this.headless && !!data.simTutorial;   // playtest bot: a first-run tutorial, no storage
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
    this.initProgress();
    // Calm start: the wave begins further down (much further on the learner runs). The guided tutorial shows it
    // like normal play instead (visible at the bottom, creeping up; see updateNova): it cannot kill meanwhile.
    this.novaY = this.startY + TUNING.novaStartBelow + (this.tutorialOn && !this.guided ? TUNING.novaLearnStartBelow : TUNING.novaCalmStartBelow);
    this.novaSpeedNow = 0;      // px/s the wave climbed at last frame (eta / leash)

    this.comet = { x: GAME_WIDTH / 2, y: this.startY, vx: 0, vy: -this.speed };

    this.planets = [];
    this.asteroids = [];
    this.blackHoles = [];
    this.nextPlanetY = this.startY - 560;
    // First planet straight ahead so the very first hold always works.
    this.addPlanet(GAME_WIDTH / 2 + 150, this.nextPlanetY, 85);
    this.planetSide = 1;
    // Guided tutorial: the second planet sits a little further up (still on screen at the first LET GO), so
    // the accelerating fling between the two gets a real moment of flight before HOLD 2 stops the world.
    this.nextPlanetY -= TUNING.minPlanetGap + (this.guided ? GameScene.GUIDED_SECOND_GAP : 0);
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
    // Catch ring (drawCatchRing): 0 before the first catch, 1 orbiting, 2 teach catching the next planet, 3 done.
    this.hintStage = 0;
    this.startBannerShown = false;
    this.events.once('shutdown', () => this.scene.stop('Hud'));
    // Menu / GameOver draw with the first page's ink, whatever page this run ended on.
    this.events.once('shutdown', () => ART.setPage(0));

    this.input.on('pointerdown', () => this.pressHold());
    this.input.on('pointerup', () => this.releaseHold());
    this.input.on('pointerupoutside', () => this.releaseHold());
    // Keyboard is an optional extra for desktop testing.
    this.input.keyboard.on('keydown-SPACE', () => this.pressHold());
    this.input.keyboard.on('keyup-SPACE', () => this.releaseHold());
    this.events.once('shutdown', () => {
      this.tweens.timeScale = 1;
      this.hideGuidedStep();
    });
    // CardScene reports the chosen card on the global emitter (it is a separate scene).
    this.onCardPicked = (id) => this.pickCard(id);
    this.game.events.on('cards:picked', this.onCardPicked);
    this.events.once('shutdown', () => {
      this.game.events.off('cards:picked', this.onCardPicked);
      this.closeCardScene();
    });
    this.isPaused = false;      // PauseScene is up (pauseGame / resumeGame); the music reads it too
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
    this.wallKicksUsed = 0;     // Wall Kicks used since the last aimed fling (TUNING.wallKicksPerFling)
    this.windGraceT = 0;        // seconds after SECOND WIND / UNBREAKABLE in which a bump costs nothing
    this.perfectFlashAt = -1e9; // time.now of the last PERFECT (every one, chained or not): comet flash
    this.momentumZoom = 0;      // eased extra zoom-out from momentum (feel only)
    this.lastPopAt = -1e9;      // time.now of the last pop sent (low-priority pops wait for quiet)
    this.lastClosePopAt = -1e9; // time.now of the last CLOSE ORBIT! pop (CLOSE_POP_GAP)
    this.lastLossPopAt = -1e9;  // time.now of the last '-X% SPEED' pop (POP_GATES.lossPopGapMs)
    this.lastPop = null;        // { at, priority } of the last pop sent (popAdmitted)
    this.procPops = {};         // card id -> proc pops written this run (cardProcPop)
    this.wallKickPopShown = false;
    this.lastWallAt = -1e9;     // run s of the last side-wall hit (wallBounceVelocity)
    this.flightNo = 0;          // flings so far this run (a black hole warps each flight once)
    this.slideRumbleOn = false; // a planet is sliding into reach (applySlideRumble)
    this.crawlT = 0;            // crawl rescue timer (crawlRescueStep)
    this.lastFlungFrom = null;  // planet of the last fling (not 'in reach' for the crawl rescue)
    this.hudPage = -1;          // page index the HUD was last told about (hud.setPage)
    this.catchSlowT = -1;       // s into the light catch slow-down (catchSlowScale), -1 = off
    this.lastLatchAt = -1e9;    // time.now of the last catch (chained catches skip the slow-down)
    this.lastKickAt = -1e9;     // run s of the last Wall Kick (TUNING.wallKickCooldown)
    this.closeOrbitNow = 0;     // orbitCloseness of the current orbit (0 = none / far; reset on fling)
    this.closerGlowT = 0;       // s the first CLOSER = FASTER orbit glow still shows
    this.orbitDanger = 0;       // 0..1 orbit warning (orbitDangerLevel): aim line pulse + hud.setOrbitDanger
    this.latchNovaFloor = null; // novaY the leash may not pull above during this orbit (latch fairness push)
    this.flightT = 0;           // s of the current free flight (Aerodynamic proc)
    this.procAt = {};           // card id -> time.now of its last proc doodle (cardProc)
    this.firstNoteT = -1;       // intro: real s the first-run 'planets are friends' note has been up (-1 = not shown)
    this.deathShaken = false;
    // The scene instance is reused between runs, so this must be reset or later runs skip launch().
    this.launched = false;
  }

  pressHold() {
    if (this.introActive) return this.skipIntro();
    if (this.cardPick) return;   // the tap belongs to the cards on top
    this.inputGuard = false;
    // A hold started with a planet coming into reach is a deliberate one (what the HOLD cue teaches);
    // one started in empty space that later drifts into a planet is a lucky tap.
    const wasHolding = this.isHolding;
    if (!this.isHolding) this.holdAimed = !this.orbit && !!this.planetComingIntoReach();
    this.isHolding = true;
    if (!wasHolding && this.guided && this.guided.waiting === 'hold') this.guidedEvent({ pressed: true });
  }

  // ---------- pause (PauseScene calls pauseGame() when it opens, resumeGame() after its countdown) ----------

  // Freezes the run where it is: Phaser's scene pause stops update(), this scene's clock, tweens and camera
  // effects, so the world, the supernova, slow motion and every timer resume exactly where they were.
  // Returns true when the run is now paused (false: nothing to pause, e.g. the run is over).
  pauseGame() {
    if (this.headless || this.isOver || this.deathT >= 0) return false;
    if (this.isPaused) return true;
    this.isPaused = true;
    this.slideRumbleOn = false;
    this.scene.pause();
    return true;
  }

  resumeGame() {
    if (!this.isPaused) return;
    this.isPaused = false;
    // A finger that lifted while paused never sent its pointerup here: only a finger still down holds.
    // (An orbit is kept either way; it flings on the next release.)
    const ptrs = (this.input && this.input.manager && this.input.manager.pointers) || [];
    this.isHolding = ptrs.some((p) => p && p.isDown) && this.isHolding;
    this.scene.resume();
  }

  // Auto-pause (page hidden / focus lost) is wired once, in HudScene.wireAutoPause (Phaser's game 'hidden' /
  // 'blur' events), with the same rules: in play only, not during the tutorial's frozen wait. A second set of
  // listeners here would launch PauseScene twice in one tick.

  // ---------- meta progression (src/progress.js): missions, skins, journal ----------

  initProgress() {
    const P = !this.headless && typeof PROGRESS !== 'undefined' ? PROGRESS : null;
    let skin = null;
    try {
      if (P) skin = P.equippedSkin();
    } catch (e) { /* broken save: classic comet */ }
    this.skin = skin;
    this.reportedKms = 0;        // last km/s integer reported as 'speed'
    this.reportedAlt = 0;
    this.machStamped = 0;        // highest MACH tier already stamped this run
    // Learner help (learning window): in the simulator only as a simulated first run (never saved).
    this.tutorial = this.headless ? (this.simTutorial ? { runs: 0, goodCycles: 0 } : null) : loadTutorialState();
    this.tutorialOn = !!this.tutorial && tutorialActive(this.tutorial);
    // Runs finished before this one: run 1 and run 2 keep the tutorial to the end, whatever the cycle count.
    this.tutorialRunsBefore = this.tutorial ? this.tutorial.runs : 0;
    this.ownCatches = 0;         // catches with a real hold this run (the learning window needs one by TUNING.learnIdleSeconds)
    this.orbitHeldT = 0;         // s in the current orbit (guided LET GO fallback)
    this.tutorialCatch = false;  // the current orbit came from a real (not auto) catch
    // Learning window (wide assist, soft bumps, crawling wave): see learningWindowOpen in src/orbit.js.
    this.learning = this.tutorialOn;
    this.learnGoodCycles = 0;
    this.holdAimed = null;       // the current hold started near a planet (null = set without pressHold)
    this.learnEndT = null;       // run s the learning window closed (the wave eases up from its crawl)
    // Guided tutorial: { phase, waiting } until it is finished (see guidedTutorialStep). The simulator only
    // gets it as a simulated first run (simTutorial), and never saves it.
    this.guided = (this.headless ? this.simTutorial : !guidedTutorialDone()) ? { phase: 'hold', round: 1, waiting: '' } : null;
    this.guidedLeft = null;      // the planet the last tutorial fling left (no HOLD step for it)
    this.guidedFlightT = -1;     // real s since the last tutorial fling (-1 = none in flight; GUIDED_FLIGHT_BEAT)
    this.guidedLap = 0;          // rad the comet has gone round the planet since the tutorial latch (full lap first)
    this.tutorialWaiting = '';   // 'hold' | 'letgo' | '': the step waiting for the player (the playtest bot reads it)
    this.guidedSlow = 0;         // slow-motion progress 0..1 (guidedSlowProgress)
    this.guidedShown = '';       // step the HUD was asked to draw ('' = none)
    this.guidedPlanet = null;    // step 1: the planet the comet will latch onto
    this.guidedTarget = null;    // LET GO: the planet the fling is steered onto
    this.guidedForce = null;     // planet the next fling must be steered onto (a LET GO answered)
    this.guidedNiceT = 0;        // real s the NICE! stamp still owns the screen
    this.hudQueue = [];          // HUD calls (banners, stamps, pops) held back while a step owns the screen
  }

  // Closes the learning window for the rest of the run once any of its limits is hit.
  updateLearning() {
    if (!this.learning) return;
    this.learning = learningWindowOpen({
      tutorial: this.tutorialOn, seconds: this.elapsed, meters: this.bestAltitude,
      goodCycles: this.learnGoodCycles, ownCatches: this.ownCatches,
    });
    if (!this.learning) this.learnEndT = this.elapsed;
  }

  // One run event for missions / coins / journal. The headless sim never reports (no saves at all).
  reportProgress(event, value) {
    if (this.headless || typeof PROGRESS === 'undefined') return;
    try { PROGRESS.report(event, value); } catch (e) { /* progress must never break a run */ }
  }

  // Run stats that only ever grow: top km/s, best altitude, and the MACH tier stamps.
  reportRunStats() {
    if (this.headless) return;
    const kms = Math.floor(this.speed / 10);
    if (kms > this.reportedKms) {
      this.reportedKms = kms;
      this.reportProgress('speed', kms);
      const tier = nextMachTier(this.machStamped, machNumber(this.speed / 10));
      if (tier) this.machTier(tier);
    }
    if (this.bestAltitude > this.reportedAlt) {
      this.reportedAlt = this.bestAltitude;
      this.reportProgress('altitude', this.bestAltitude);
    }
  }

  // First pass of a MACH tier this run: the HUD stamps it (it waits behind banners, the card pick
  // and other stamps itself); a small ink burst marks the moment on the comet right away.
  machTier(tier) {
    this.machStamped = tier;
    this.lastStampAt = this.time.now;
    this.hudCall('showMachTier', tier);
    this.burst(this.comet.x, this.comet.y, 0xff9a2e, 8, 150);
    this.zoomKick = Math.max(this.zoomKick, 0.03);
  }

  // Release after a real catch with a green/gold aim = one good cycle; 3 of them (and 2 runs) retire it.
  countTutorialCycle(assisted) {
    if (!this.tutorial || !this.tutorialOn) return;
    const good = this.tutorialCatch && assisted;
    this.tutorialCatch = false;
    if (!good) return;
    this.learnGoodCycles++;
    this.tutorial.goodCycles++;
    if (!this.headless) saveTutorialState(this.tutorial);
    // Retire mid-run only from run 3 on (runs counted before this run), so runs 1 and 2 keep it.
    if (!tutorialActive({ runs: this.tutorialRunsBefore, goodCycles: this.tutorial.goodCycles })) this.tutorialOn = false;
  }

  // A run starts: count it for the tutorial (the decision for THIS run was made in create()).
  countTutorialRun() {
    if (!this.tutorial) return;
    this.tutorial.runs++;
    if (!this.headless) saveTutorialState(this.tutorial);
  }

  // ---------- guided first-run tutorial (state machine: guidedTutorialStep in src/orbit.js) ----------
  // GameScene decides when and passes SCREEN coordinates; the HUD draws it (showTutorialStep / hideTutorialStep).

  // Every frame (real time): feeds the state machine, eases the slow motion, has the HUD draw the step once
  // the world has come to a stop, ends the NICE! stamp and then plays whatever the steps held back.
  updateGuided(realDt) {
    if (this.guided && this.launched && !this.introActive && !this.cardPick && !this.isOver) this.guidedEvent({});
    const waiting = this.guided ? this.guided.waiting : '';
    this.guidedSlow = guidedSlowProgress(this.guidedSlow, !!waiting, realDt);
    if (waiting && this.guidedSlow >= 1 && this.guidedShown !== waiting) this.showGuidedStep(waiting);
    if (this.guidedFlightT >= 0) this.guidedFlightT += realDt;
    if (this.guidedNiceT > 0) {
      this.guidedNiceT -= realDt;
      if (this.guidedNiceT <= 0) this.hideGuidedStep();
    }
    if (!this.guidedBusy()) this.flushHudQueue();
  }

  // One step of the state machine with this frame's input edges ({ pressed } / { released }), then its action.
  guidedEvent(edges) {
    const g = this.guided;
    if (!g) return null;
    const e = edges || {};
    let reachable = g.phase === 'hold' && !g.waiting && !this.orbit && !this.scrape ? this.guidedReachPlanet() : null;
    // After the first tutorial fling the comet flies for GUIDED_FLIGHT_BEAT s before HOLD 2 (the accelerating
    // flight is the point), unless it is past its closest pass of the planet and leaving the grab zone.
    if (reachable && this.guidedFlightT >= 0 && this.guidedFlightT < GameScene.GUIDED_FLIGHT_BEAT && !this.leavingGrabZone(reachable)) reachable = null;
    let target = null;
    let aimReady = false;
    const lapDone = this.guidedLap >= TUNING.guidedLap;
    if (g.phase === 'lap' && !g.waiting && this.orbit && lapDone) {
      target = this.guidedTargetPlanet();
      const v = tangentVelocity(this.orbit, 1);
      // No planet above at all (should not happen): LET GO once the tangent points up the screen.
      aimReady = target ? guidedAimLinedUp(this.comet.x, this.comet.y, v.vx, v.vy, target.x, target.y) : v.vy < -0.8;
    }
    const r = guidedTutorialStep(g, {
      holding: this.isHolding, orbiting: !!this.orbit, reachable: !!reachable, lapDone, aimReady,
      pressed: !!e.pressed, released: !!e.released,
    });
    this.guided = r.st;
    this.tutorialWaiting = r.st.waiting;
    if (r.action === 'showHold' || r.action === 'showLetGo') {
      if (r.action === 'showHold') {
        this.guidedPlanet = reachable;
        this.guidedFlightT = -1;
      }
      else this.guidedTarget = target;
      // The step owns the screen: a banner already up goes (new ones wait in hudQueue).
      if (!this.headless && this.hud && typeof this.hud.hideBanner === 'function') this.hud.hideBanner();
    } else if (r.action === 'latch') {
      this.guidedLatch();
    } else if (r.action === 'lap') {
      this.hideGuidedStep();
      this.guidedLap = 0;
    } else if (r.action === 'fling') {
      this.hideGuidedStep();
      this.guidedForce = this.guidedLiveTarget();
      // The next HOLD is for that planet, never for the one just left (still in grab reach at the release).
      this.guidedLeft = this.orbitPlanet;
      this.guidedTarget = null;
      this.guidedFlightT = 0;
    } else if (r.action === 'nice') {
      this.guidedNice();
    } else if (r.action === 'cancel') {
      this.hideGuidedStep();
      this.guidedTarget = null;
    }
    return r.action;
  }

  // Whether the comet is past its closest pass of planet p and about to leave its grab zone.
  leavingGrabZone(p) {
    const c = this.comet;
    const receding = (p.x - c.x) * c.vx + (p.y - c.y) * c.vy <= 0;
    return receding && this.distanceTo(p) - p.radius > this.grabRange() * GameScene.GUIDED_LEAVE_SHARE;
  }

  // The closest grabbable planet the comet is about to reach (the HOLD step starts a little before its grab
  // zone; the slow-motion ease-in carries the comet on toward it).
  guidedReachPlanet() {
    const c = this.comet;
    let best = null;
    let bestDist = Infinity;
    for (const p of this.planets) {
      if (p === this.noGrabPlanet || p === this.guidedLeft || !canGrabPlanet(c.x, c.y, c.vx, c.vy, p)) continue;
      const d = this.distanceTo(p);
      if (d < p.radius + this.grabRange() + TUNING.guidedHoldLead && d < bestDist) { best = p; bestDist = d; }
    }
    return best;
  }

  // The planet a tutorial fling goes to: the next one above the orbited planet.
  guidedTargetPlanet() {
    if (!this.orbit) return null;
    return nextPlanetAboveY(this.planets, this.orbitPlanet, this.orbitPlanet.y) || this.nextPlanetAbove();
  }

  // The LET GO target if it still exists, else a fresh pick.
  guidedLiveTarget() {
    const t = this.guidedTarget;
    return t && this.planets.indexOf(t) >= 0 ? t : this.guidedTargetPlanet();
  }

  // The assist for a fling forced onto guidedForce: the pass point close beside that planet (guidedPassGap off
  // its surface, well inside its grab zone), whatever the angle; the fling turns onto it (see fling()).
  guidedFlingAssist() {
    const p = this.guidedForce;
    if (!this.orbit || !p || this.planets.indexOf(p) < 0) return this.currentAssist();
    const v = tangentVelocity(this.orbit, 1);
    return aimAtPlanet(this.comet.x, this.comet.y, v.vx, v.vy, p, TUNING.guidedPassGap) || this.currentAssist();
  }

  // HOLD answered: the comet latches onto that planet now, wherever the slow motion left it (an orbit
  // started outside the grab zone eases in to GUIDED_LATCH_REACH of it), and the full lap starts.
  guidedLatch() {
    this.hideGuidedStep();
    this.guidedLap = 0;
    const p = this.guidedPlanet;
    this.guidedPlanet = null;
    if (!p || this.orbit || this.planets.indexOf(p) < 0) return;
    this.scrape = null;
    this.latch(p, false);
    const reach = Math.max(p.radius + TUNING.minOrbitGap, p.radius + this.grabRange() * GameScene.GUIDED_LATCH_REACH);
    if (this.orbit.targetRadius > reach) this.orbit.targetRadius = reach;
  }

  // Last LET GO answered: the fling goes onto the target, a NICE! stamp, and the tutorial is over for good.
  guidedNice() {
    this.guidedForce = this.guidedLiveTarget();
    this.guidedTarget = null;
    this.guided = null;
    this.tutorialWaiting = '';
    if (!this.headless) saveGuidedTutorialDone();
    // The LET GO overlay goes first; the HUD stamps NICE! once (showTutorialStep('nice')).
    this.hideGuidedStep();
    this.guidedNiceT = GameScene.GUIDED_NICE_TIME;
    this.guidedShown = 'nice';
    this.lastStampAt = this.time.now;
    if (this.headless) return;
    const cs = this.worldToScreen(this.comet.x, this.comet.y);
    if (this.hud && typeof this.hud.showTutorialStep === 'function') this.hud.showTutorialStep('nice', { cx: cs.x, cy: cs.y });
    this.sfx('milestone', { level: 1, chain: 0 });
    this.burst(this.comet.x, this.comet.y, 0xffe14d, 14, 170);
    this.cameras.main.shake(140, 0.006);
  }

  // Has the HUD draw a waiting step, in screen coordinates (the world is stopped, so they stay right).
  //   hold:  { cx, cy, px, py, pr }  comet + the planet to hold on to
  //   letgo: { cx, cy, dirX, dirY, px, py, pr, tx, ty, tr, ax, ay }  comet, the release tangent (unit), the
  //          orbited planet (p*), the target planet (t*), and the point the steered fling passes (a*)
  showGuidedStep(step) {
    this.guidedShown = step;
    if (this.headless || !this.hud || typeof this.hud.showTutorialStep !== 'function') return;
    const zoom = this.cameras.main.zoom;
    const c = this.comet;
    const cs = this.worldToScreen(c.x, c.y);
    if (step === 'hold') {
      const planet = this.guidedPlanet;
      if (!planet) return;
      const ps = this.worldToScreen(planet.x, planet.y);
      const pr = planet.radius * zoom;
      // Planets are friends: the step says 'grab the planet!' (with 'hold anywhere' smaller) and dashed ink
      // gravity lines run from the planet toward the comet (screen coords).
      this.hud.showTutorialStep(step, {
        cx: cs.x, cy: cs.y, px: ps.x, py: ps.y, pr,
        sub: 'grab the planet!', small: 'hold anywhere',
        gravity: GameScene.gravityLines(ps.x, ps.y, pr, cs.x, cs.y),
      });
      return;
    }
    const target = this.guidedTarget;
    if (!target || !this.orbit) return;
    const v = tangentVelocity(this.orbit, 1);
    const os = this.worldToScreen(this.orbitPlanet.x, this.orbitPlanet.y);
    const ts = this.worldToScreen(target.x, target.y);
    const aim = aimAtPlanet(c.x, c.y, v.vx, v.vy, target, TUNING.guidedPassGap);
    const as = aim ? this.worldToScreen(aim.aimX, aim.aimY) : ts;
    this.hud.showTutorialStep(step, {
      cx: cs.x, cy: cs.y, dirX: v.vx, dirY: v.vy,
      px: os.x, py: os.y, pr: this.orbitPlanet.radius * zoom,
      tx: ts.x, ty: ts.y, tr: target.radius * zoom,
      ax: as.x, ay: as.y,
    });
  }

  hideGuidedStep() {
    if (!this.guidedShown) return;
    this.guidedShown = '';
    if (!this.headless && this.hud && typeof this.hud.hideTutorialStep === 'function') this.hud.hideTutorialStep();
  }

  // The world is slowed / stopped for a step: the supernova is frozen and nothing can kill the player.
  guidedHolds() {
    return this.guidedSlow > 0 || !!(this.guided && this.guided.waiting);
  }

  // The tutorial owns the run (a step, or its full lap at normal speed): the supernova waits, nothing kills.
  guidedFreezesNova() {
    return this.guidedHolds() || !!(this.guided && this.guided.phase === 'lap' && this.orbit);
  }

  // A step or its NICE! stamp owns the screen: card picks, banners, stamps and pops wait.
  guidedBusy() {
    return this.guidedHolds() || this.guidedNiceT > 0;
  }

  // A step is up (waiting for the player, easing in or drawn) or its NICE! stamp is: pops are dropped then.
  guidedStepUp() {
    return !!(this.guided && this.guided.waiting) || this.guidedNiceT > 0;
  }

  // World time scale for the guided slow motion: it eases down to guidedSlowScale, and once the step is up
  // the world stands still until the player answers (the step's screen coordinates stay exact).
  guidedTimeScale() {
    if (this.guided && this.guided.waiting && this.guidedSlow >= 1) return 0;
    return guidedSlowScale(this.guidedSlow);
  }

  // A HUD call that waits while a guided step owns the screen (banners, milestone / MACH / set stamps).
  hudCall(name, ...args) {
    if (this.headless || !this.hud || typeof this.hud[name] !== 'function') return;
    // Stamps of the moment (MACH, chain milestones) are dropped while a step is up, never queued; banners
    // wait. In the flight between steps (the world easing back) everything shows at once.
    if (this.guidedStepUp() && GameScene.MOMENT_STAMPS.indexOf(name) >= 0) return;
    if (this.guidedStepUp() || (this.guidedBusy() && GameScene.MOMENT_STAMPS.indexOf(name) < 0)) {
      if (this.hudQueue.length < GameScene.HUD_QUEUE_MAX) this.hudQueue.push({ call: name, args });
      return;
    }
    this.hud[name](...args);
  }

  flushHudQueue() {
    if (!this.hudQueue.length || this.isOver) return;
    const queue = this.hudQueue;
    this.hudQueue = [];
    for (const item of queue) {
      if (item.pop) this.popText(item.pop[0], item.pop[1], item.pop[2]);
      else if (this.hud && typeof this.hud[item.call] === 'function') this.hud[item.call](...item.args);
    }
  }

  // A grabbable planet the comet is about to reach (a little before the grab zone): a hold started then
  // counts as a deliberate one (holdAimed).
  planetComingIntoReach() {
    let best = null;
    let bestDist = Infinity;
    for (const p of this.planets) {
      if (!this.inPromptReach(p)) continue;
      const d = this.distanceTo(p);
      if (d < bestDist) { best = p; bestDist = d; }
    }
    return best;
  }

  inPromptReach(p) {
    const c = this.comet;
    if (p === this.noGrabPlanet || !canGrabPlanet(c.x, c.y, c.vx, c.vy, p)) return false;
    return this.distanceTo(p) < p.radius + this.grabRange() + GameScene.HOLD_PROMPT_LEAD;
  }

  // ---------- late-game test setup (playtest bot window.simStart, manual checks) ----------

  // Moves a fresh run to a late state: { altitude (m), speed (px/s), cards: [ids], seconds (run time,
  // default altitude / 120) }. Best altitude, comet, camera, planets, page and cards all follow, and
  // the supernova starts just below the screen. Not reachable from normal play.
  debugTeleport(opts) {
    const o = opts || {};
    const meters = Math.max(0, o.altitude || 0);
    const c = this.comet;
    this.launch();
    this.orbit = null;
    this.orbitPlanet = null;
    this.scrape = null;
    this.homing = null;
    this.autoCatchTarget = null;
    this.flightTarget = null;
    this.assistedFlings = 99;   // past the onboarding auto catch
    this.catches = Math.max(this.catches, TUNING.secondWindMinCatches);
    this.secondWindUsed = true;   // SECOND WIND is an early-game rescue only
    c.y = this.startY - meters * 10;
    c.x = GAME_WIDTH / 2;
    this.speed = Math.max(TUNING.minSpeed, o.speed || TUNING.startSpeed);
    c.vx = 0;
    c.vy = -this.speed;
    this.bestAltitudePx = meters * 10;
    this.bestAltitude = Math.floor(meters);
    this.elapsed = o.seconds !== undefined ? o.seconds : meters / 120;
    this.zoneIndex = zoneIndexForAltitude(this.bestAltitude);
    this.passedBest = true;
    this.trail = [];
    // Start with the camera already zoomed out for this speed (it would otherwise ease out over ~1 s).
    const zoomF = Phaser.Math.Clamp((this.speed - TUNING.minSpeed) / (ZONES[0].maxSpeed - TUNING.minSpeed), 0, 1);
    this.baseZoom = 1 - zoomF * (1 - TUNING.minZoom);
    this.camCenter = c.y - (0.12 * GAME_HEIGHT) / this.baseZoom;
    this.updateCamera(0.016);
    this.planets = [];
    this.asteroids = [];
    this.blackHoles = [];
    this.nextPlanetY = c.y - 520;
    this.fillPlanets();
    this.novaSpeedNow = this.currentNovaSpeed();
    this.novaY = this.leashBottom() + novaLeashFor(this.bestAltitude, this.novaSpeedNow);
    for (const id of o.cards || []) this.grantCard(id);
    this.shieldCharges = this.mods.heatShieldCharges;
    if (!this.headless) {
      this.turnPage(this.zoneIndex);
      this.hudCall('showBanner', zoneAt(this.zoneIndex).name, 'NOW UP TO ' + Math.round(this.speedCap() / 10) + ' km/s');
    }
  }

  // Gives a card outside a pick (debugTeleport): same effects as picking it.
  grantCard(id) {
    if (!cardById(id) || this.ownedCards.indexOf(id) >= 0) return;
    const pick = this.cardPick;
    this.cardPick = { choices: [id], realT: 0 };
    this.pickCard(id, true);
    this.cardPick = pick;
  }

  // ---------- upgrade cards (rules in src/cards.js, UI in CardScene) ----------

  initCards() {
    this.ownedCards = [];
    this.mods = cardMods(this.ownedCards);
    this.cardPick = null;       // { choices, realT } while the pick is on screen
    this.pickDelay = -1;        // real seconds until a queued card pick may open, -1 = none queued
    this.picksOwed = 0;         // zone card picks earned but not opened yet (they wait for cardPickReady)
    this.novaHoldT = 0;         // real s the supernova holds still after a card pick
    this.orbitLeashY = null;    // the wave's leash limit when the current orbit began (updateNova; null = none)
    this.lastCardPickAt = null; // run s of the last chosen card (its supernova cost eases in: cardNovaMul)
    this.queuedMilestone = null; // { level, chain } stamp held back while a card pick is pending
    this.milestoneWait = 0;      // real seconds after the pick closes before it plays
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
    return perfectAngleAt(this.mods.perfectAngle || TUNING.perfectAngle, this.speed);
  }

  openCardPick() {
    if (this.isOver || this.cardPick) return;
    const choices = drawCardChoices(this.ownedCards, Math.random);
    if (!choices.length) return;
    // The flight resumes exactly as it was when the cards came up (see resumeAfterPick).
    this.prePick = { speed: this.speed, vx: this.comet.vx, vy: this.comet.vy };
    // The simulator has no UI: it picks a random card at once.
    if (this.headless) return this.pickCard(choices[Math.floor(Math.random() * choices.length)]);
    this.cardPick = { choices, realT: 0 };
    this.reportProgress('cardOffered', choices.slice());
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

  // granted: given outside a pick (debugTeleport), with none of a pick's side effects.
  pickCard(id, granted) {
    if (this.isOver || this.ownedCards.indexOf(id) >= 0) return;
    const card = cardById(id);
    if (!card) return;
    if (!this.headless && !granted) {
      if (!this.cardPick || this.cardPick.choices.indexOf(id) < 0) return;
      this.cardPick = null;
      this.closeCardScene();
      // Ease out of the slow motion.
      this.slowMoT = FEEL.slowMoHold;
    }
    if (!granted) {
      // The finger was on the card: swallow its release, and give it time to find the next planet
      // (the simulator gets the same, so its numbers match real play).
      this.inputGuard = true;
      this.isHolding = false;
      this.novaHoldT = FEEL.slowMoEase + CARD_TUNING.pickNovaHold;
      this.lastCardPickAt = this.elapsed;
      this.resumeAfterPick();
    }
    const setsBefore = activeSetBonuses(this.ownedCards);
    this.ownedCards.push(id);
    this.mods = cardMods(this.ownedCards);
    if (id === 'heatshield') this.shieldCharges = this.mods.heatShieldCharges;
    const newSets = activeSetBonuses(this.ownedCards).filter((f) => setsBefore.indexOf(f) < 0);
    if (newSets.indexOf('shield') >= 0) this.rescuesLeft = this.mods.rescues;
    const color = CARD_FAMILIES[card.family].color;
    this.reportProgress('card', id);
    this.sfx('cardpick', { id });
    this.popText(card.name.toUpperCase() + '!', GameScene.hex(color), { size: 40, duration: 900 });
    // The card's name at the pick counts as the first of its written proc pops (SLINGSHOT! 3x in 6 s).
    this.procPops[id] = Math.max(1, this.procPops[id] || 0);
    this.burst(this.comet.x, this.comet.y, color, 14, 150);
    if (this.hud.setCards) this.hud.setCards(this.ownedCards.slice());
    for (const family of newSets) {
      this.reportProgress('setbonus', family);
      this.hudCall('showSetBonus', family);
      this.sfx('setbonus', { family });
      this.burst(this.comet.x, this.comet.y, CARD_FAMILIES[family].color, 22, 220);
      this.cameras.main.shake(180, 0.008);
    }
  }

  // After a card pick: the pre-pick speed and heading come back, and the flight is steered onto a grabbable
  // planet for pickSteerSeconds (one is slid into reach if none is), so a run never dies 4-10 s after a pick
  // drifting at low speed with nothing to grab.
  resumeAfterPick() {
    const pre = this.prePick;
    this.prePick = null;
    if (this.orbit || this.scrape) return;
    const c = this.comet;
    if (pre) {
      this.speed = Math.max(this.speed, pre.speed);
      const len = Math.hypot(pre.vx, pre.vy) || 1;
      c.vx = (pre.vx / len) * this.speed;
      c.vy = (pre.vy / len) * this.speed;
    }
    let p = this.reachablePlanetAhead();
    // Only a slow comet gets a planet slid in (a fast one reaches the next planet anyway, and a planet sliding
    // after a fast comet ends up behind it, low, next to the wave).
    if (!p && this.speed < GameScene.SLIDE_MAX_SPEED) p = this.slidePlanetIntoReach();
    if (!p) return;
    const aim = aimAtPlanet(c.x, c.y, c.vx, c.vy, p, TUNING.guidedPassGap);
    if (aim) this.homing = Object.assign(this.homingPoint(aim), { time: TUNING.pickSteerSeconds, turn: TUNING.pickSteerTurn });
  }

  // A grabbable planet above the comet that the flight can reach in about a second: already in grab range,
  // or within reach and roughly ahead (REACH_AHEAD_COS); never the planet the comet was just flung from
  // (null = none).
  reachablePlanetAhead() {
    const c = this.comet;
    const grab = this.grabRange();
    const reach = grab + Math.max(GameScene.REACH_MIN, this.speed * GameScene.REACH_SECONDS);
    const v = Math.hypot(c.vx, c.vy) || 1;
    let best = null;
    let bestDist = Infinity;
    for (const p of this.planets) {
      if (p === this.noGrabPlanet || p === this.lastFlungFrom || p.y > c.y - 40 || !canGrabPlanet(c.x, c.y, c.vx, c.vy, p)) continue;
      const d = this.distanceTo(p);
      if (d >= p.radius + reach || d >= bestDist) continue;
      const ahead = ((p.x - c.x) * c.vx + (p.y - c.y) * c.vy) / ((d || 1) * v);
      if (d < p.radius + grab || ahead > GameScene.REACH_AHEAD_COS) { best = p; bestDist = d; }
    }
    return best;
  }

  // Crawl rescue / card pick: a planet above slides to where the flight will pass it at grab distance (ahead
  // of the comet, offset to one side so it is caught, not hit). Tries the next planet above first, on the
  // inner side and then the other, then the other planets above (a spot next to another planet is skipped).
  // The drift keeps that spot relative to the comet while it slides, so a moving comet still meets it.
  // Returns that planet (null = none).
  slidePlanetIntoReach() {
    const c = this.comet;
    const exclude = this.lastFlungFrom || this.noGrabPlanet;
    const first = nextPlanetAboveY(this.planets, exclude, c.y);
    const others = this.planets
      .filter((q) => q !== first && q !== exclude && q !== this.lastFlungFrom && q.y < c.y - 40)
      .sort((p1, p2) => this.distanceTo(p1) - this.distanceTo(p2));
    const inner = c.x < GAME_WIDTH / 2 ? 1 : -1;
    for (const p of (first ? [first] : []).concat(others).slice(0, 4)) {
      for (const side of [inner, -inner]) {
        const spot = this.slideSpot(p, side);
        if (!spot) continue;
        p.drift = { side, t: 0, fromX: p.x, fromY: p.y };
        return p;
      }
    }
    return null;
  }

  // Where slidePlanetIntoReach puts planet p for the comet's current flight (side: +1 / -1 of the path),
  // or null when that spot is next to another planet.
  slideSpot(p, side) {
    const c = this.comet;
    const len = Math.hypot(c.vx, c.vy) || 1;
    let ux = c.vx / len;
    let uy = c.vy / len;
    // Falling: the planet comes in above instead (a planet down the screen would only lead into the wave).
    if (uy > -0.2) { ux = 0; uy = -1; }
    const ahead = p.radius + this.grabRange() * 0.5 + this.speed * GameScene.SLIDE_LEAD_SECONDS;
    const off = p.radius + this.grabRange() * 0.45;
    const m = 90 + p.radius;
    const x = Phaser.Math.Clamp(c.x + ux * ahead - uy * off * side, m, GAME_WIDTH - m);
    const y = Math.min(c.y - 60, c.y + uy * ahead + ux * off * side);
    // Never onto another planet (the column keeps its spacing).
    for (const q of this.planets) {
      if (q !== p && Math.hypot(q.x - x, q.y - y) < q.radius + p.radius + GameScene.SLIDE_CLEARANCE) return null;
    }
    return { x, y };
  }

  // Slides planets with a drift toward their slide spot (crawl rescue / card pick), at planetDriftSpeed.
  updatePlanetDrift(dt) {
    let sliding = false;
    for (const p of this.planets) {
      if (!p.drift) continue;
      // Caught (or already passed: it must not keep sliding down behind the comet toward the wave).
      if (p === this.orbitPlanet || p.y > this.comet.y + 40) { p.drift = null; continue; }
      // The spot follows the comet; if it is blocked now, the planet stops where it is.
      const spot = this.slideSpot(p, p.drift.side);
      if (!spot) { p.drift = null; continue; }
      // Timed slide (SLIDE_TIME s, ease-out): fast at first so it is in reach soon, then it visibly settles.
      const dr = p.drift;
      if (dr.fromX === undefined) { dr.fromX = p.x; dr.fromY = p.y; dr.t = 0; }
      dr.t += dt;
      const k = Math.min(1, dr.t / GameScene.SLIDE_TIME);
      const e = 1 - (1 - k) * (1 - k) * (1 - k);
      const nx = dr.fromX + (spot.x - dr.fromX) * e;
      const ny = dr.fromY + (spot.y - dr.fromY) * e;
      const dx = nx - p.x;
      const dy = ny - p.y;
      const d = Math.hypot(dx, dy);
      p.x = nx;
      p.y = ny;
      if (k >= 1) { p.drift = null; continue; }
      // Heading of the slide (the ink speed lines trail behind it) and a low rumble once per slide.
      if (d > 0.01) { dr.ux = dx / d; dr.uy = dy / d; }
      if (!p.drift.rumbled) { p.drift.rumbled = true; this.sfx('rumble'); }
      sliding = true;
    }
    // A gentle continuous shake while a planet is sliding in; it stops the frame it settles (applySlideRumble).
    this.slideRumbleOn = sliding;
  }

  // Slide rumble: a small jitter on the camera scroll (re-set from the look-ahead every frame, so it never
  // accumulates). Not a camera shake effect: a running shake would swallow the real impact shakes meanwhile.
  applySlideRumble() {
    if (!this.slideRumbleOn || this.headless) return;
    const cam = this.cameras.main;
    const a = GameScene.SLIDE_RUMBLE * GAME_WIDTH / Math.max(0.1, cam.zoom);
    cam.scrollX += (Math.random() * 2 - 1) * a;
    cam.scrollY += (Math.random() * 2 - 1) * a;
  }

  // Dashed ink speed lines trailing a planet that slides into reach (10 fps boil, like the rest of the ink).
  drawSlideLines(g) {
    const boil = Math.floor(this.time.now / 100);
    const ink = ART.ink !== undefined ? ART.ink : 0xf4ead0;
    for (const p of this.planets) {
      if (!p.drift || p.drift.ux === undefined) continue;
      const ux = p.drift.ux;
      const uy = p.drift.uy;
      // Perpendicular to the slide: the lines fan across the planet's back.
      const px = -uy;
      const py = ux;
      const rnd = artRandom(boil * 7 + Math.round(p.radius * 13));
      for (let i = 0; i < 4; i++) {
        const off = (i - 1.5) * p.radius * 0.55 + (rnd() - 0.5) * 10;
        const start = p.radius * (0.9 + rnd() * 0.25);
        const len = 60 + rnd() * 70 + (i % 2) * 30;
        const sx = p.x - ux * start + px * off;
        const sy = p.y - uy * start + py * off;
        g.lineStyle(3 + (i % 2), ink, 0.75);
        // Dashes of uneven length, drawn by hand.
        let t = 0;
        while (t < len) {
          const dash = 14 + rnd() * 10;
          const e = Math.min(len, t + dash);
          g.lineBetween(sx - ux * t, sy - uy * t, sx - ux * e, sy - uy * e);
          t = e + 9;
        }
      }
    }
  }

  // Crawl rescue (crawlRescueStep): crawling with nothing in reach for crawlSeconds -> a planet slides in.
  updateCrawlRescue(dt) {
    if (this.orbit || this.scrape || this.cardPick || this.guidedBusy()) { this.crawlT = Math.min(this.crawlT, 0); return; }
    const r = crawlRescueStep(this.crawlT, this.speed, !!this.reachablePlanetAhead(), dt);
    this.crawlT = r.t;
    if (r.rescue) {
      const p = this.slidePlanetIntoReach();
      if (p && !this.headless) p.wobble = 0.6;
    }
  }

  // Heat Shield: a hit that would cost speed is absorbed instead. Returns true when it was.
  useHeatShield() {
    if (this.shieldCharges <= 0) return false;
    this.shieldCharges--;
    this.cardProcPop('heatshield', 'SHIELD!', CARD_FAMILIES.shield.color, { size: 44 });
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
    this.reportProgress('secondwind');
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
    const chance = hazardChances(meters);
    if (Math.random() < chance.blackHole) {
      // Left-side holes sit right of the bottom-left km/s readout's column, so one never ends up under it.
      this.blackHoles.push({ x: planetSide < 0 ? GameScene.LEFT_HOLE_X : GAME_WIDTH * 0.7, y });
      return;
    }
    if (Math.random() < chance.asteroid) {
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
    // Guided tutorial: the LET GO step steers this fling (guidedForce); before it (the full lap) a release
    // does not fling at all: the planet keeps the comet until LET GO is up (a tap then flings).
    if (this.orbit && this.guided) {
      if (this.guided.waiting === 'letgo') this.guidedEvent({ released: true });
      else if (guidedFlingBlocked(this.guided)) return;
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
    this.lastFlungFrom = this.orbitPlanet;   // crawl rescue: the planet just left does not count as 'in reach'
    this.flightNo = (this.flightNo || 0) + 1; // black holes warp a flight once each (applyBlackHoles)
    const v = tangentVelocity(this.orbit, this.speed);
    // A guided tutorial LET GO: steered close past the next planet, with a speed kick on the way.
    const guidedFling = !!this.guidedForce && !overspeed;
    const assist = guidedFling ? this.guidedFlingAssist() : this.currentAssist();
    this.guidedForce = null;
    this.wallKickPopShown = false;   // WALL KICK! is written at most once per flight
    const perfect = !overspeed && assist && assist.angle < this.perfectAngle();
    if (perfect) {
      this.addMomentumSpeed(TUNING.perfectBonus);
      // Wide Perfect: a PERFECT only its wider window made.
      if (this.mods.perfectAngle && assist.angle >= perfectAngleAt(TUNING.perfectAngle, this.speed)) this.cardProc('perfect');
      this.onPerfect();
    } else {
      this.breakChain();
    }
    if (!overspeed && this.mods.releaseBonus > 0) {
      // Slingshot: every release adds a share of the current speed.
      this.addSpeed(this.speed * this.mods.releaseBonus);
      this.burst(this.comet.x, this.comet.y, CARD_FAMILIES.fling.color, 8, 120);
      if (perfect) this.cardProc('sling');
      else this.cardProcPop('sling', 'SLINGSHOT!', CARD_FAMILIES.fling.color, { size: 32, duration: 500, low: true });
    }
    if (overspeed) {
      this.noGrabPlanet = this.orbitPlanet;
      this.popText('OVERSPEED!', '#8fe3ff', { size: 36 });
    }
    // Only a green/gold release counts (the wide learning assist rescues any release, so it teaches nothing).
    if (!overspeed) this.countTutorialCycle(!!assist && !assist.wide);
    // Wall Kick recharges on an AIMED fling (green/gold line) only: a random release gets plain,
    // costly wall bounces, so tapping at random can never ride the walls up.
    // ...and only on a fling that launches upward (its steer heads up the page): a flat sideways release rode
    // the kicks up to BEYOND.
    const aimUp = assist ? (assist.aimY - this.comet.y) / (Math.hypot(assist.aimX - this.comet.x, assist.aimY - this.comet.y) || 1) : 1;
    this.wallKicksUsed = wallKickRecharges(!!assist, aimUp) ? 0 : TUNING.wallKicksPerFling;
    this.flightT = 0;
    this.latchNovaFloor = null;
    this.closeOrbitNow = 0;
    this.flingAt = this.elapsed;
    // (only a flat / falling release next to a wall: the case that pinballed flat into the wave)
    this.steerWallSave = !!assist && !overspeed && v.vy / (Math.hypot(v.vx, v.vy) || 1) > -GameScene.STEER_WALL_FLAT;
    this.flightTarget = assist ? assist.planet : null;
    this.autoCatchTarget = null;
    if (assist) {
      this.assistedFlings++;
      // Onboarding: the first few assisted flings catch their target even without a hold.
      // Not on the finger-tutorial runs: an auto-caught orbit has no finger on it, so no LET GO to follow.
      if (!this.learnedCatch && !this.tutorialOn && autoCatchAllowed(this.assistedFlings, this.elapsed)) this.autoCatchTarget = assist.planet;
    }
    // Leave along the tangent; an assisted release then curves onto its target over a
    // fraction of a second instead of snapping direction on the release frame.
    this.comet.vx = v.vx;
    this.comet.vy = v.vy;
    // A wide tutorial assist or a late green that just swept past may need a sharp turn: it turns within
    // tutorialHomingTime, whatever the angle (for the coyote one, the real angle from the tangent now).
    let turn = TUNING.homingTurn;
    if (assist && assist.wide) turn = Math.max(turn, (assist.angle + 0.2) / TUNING.tutorialHomingTime);
    if (assist && assist.coyote) {
      const ax = assist.aimX - this.comet.x;
      const ay = assist.aimY - this.comet.y;
      const real = Math.acos(Math.max(-1, Math.min(1, (ax * v.vx + ay * v.vy) / ((Math.hypot(ax, ay) * Math.hypot(v.vx, v.vy)) || 1))));
      turn = Math.max(turn, (real + 0.2) / TUNING.tutorialHomingTime);
    }
    this.assistCoyote = null;
    this.homing = assist ? Object.assign(this.homingPoint(assist), { time: TUNING.homingTime, turn }) : null;
    if (guidedFling && assist) {
      // The tutorial fling keeps curving until it reaches the target (a plain one stops after homingTime),
      // and visibly accelerates: a speed kick, a rush of speed lines and a small +SPEED.
      this.addMomentumSpeed(TUNING.guidedFlingBoost);
      const dist = Math.hypot(assist.aimX - this.comet.x, assist.aimY - this.comet.y);
      this.homing.time = Math.max(TUNING.homingTime, dist / Math.max(1, this.speed) + 0.3);
      this.comet.vx = (v.vx / (Math.hypot(v.vx, v.vy) || 1)) * this.speed;
      this.comet.vy = (v.vy / (Math.hypot(v.vx, v.vy) || 1)) * this.speed;
      this.catchRushT = GameScene.CATCH_RUSH_TIME * 2;
      this.zoomKick = Math.max(this.zoomKick, 0.05);
      // The last one is stamped NICE! instead (a pop would only queue behind it).
      if (this.guided) this.popText('+SPEED', '#5eff8f', { size: 34, duration: 600 });
    }
    // An orbit ring can reach past a side wall: a release out there hit the wall on the very first frame, and
    // that hit ends the steer, so an aimed fling flew off along its raw tangent (often down into the wave).
    // The comet is put back in the field and turned off the wall here instead: not a wall hit, the steer stays.
    const wallR = TUNING.cometRadius;
    if ((this.comet.x < wallR && this.comet.vx < 0) || (this.comet.x > GAME_WIDTH - wallR && this.comet.vx > 0)) this.comet.vx = -this.comet.vx;
    this.comet.x = Phaser.Math.Clamp(this.comet.x, wallR, GAME_WIDTH - wallR);
    const kick = speedFraction(this.speed);
    this.sfx('release', { speedFraction: kick });
    this.cameras.main.shake(120, 0.004 + kick * 0.01);
    this.burst(this.comet.x, this.comet.y, speedColor(kick), 10);
    this.zoomKick = 0.025 + kick * 0.05;
    this.orbit = null;
    this.orbitPlanet = null;
    this.capTime = 0;
    // Released: the catch ring now marks the next planet (until the first real mid-flight catch).
    if (this.hintStage === 1) this.hintStage = this.learnedCatch ? 3 : 2;
  }

  // Consecutive PERFECTs build a chain: louder pop, bigger flash, more score.
  onPerfect() {
    this.perfectChain++;
    this.maxChain = Math.max(this.maxChain, this.perfectChain);
    this.perfectPulseAt = this.time.now;
    this.perfectFlashAt = this.time.now;   // art: ink ring burst + comet flash on EVERY PERFECT
    const chain = this.perfectChain;
    this.reportProgress('perfect', chain);
    this.score += perfectChainBonus(chain) * this.mods.chainScoreMul;
    if (this.mods.afterburnerSeconds > 0) {
      this.afterburnerT = this.mods.afterburnerSeconds;
      this.cardProc('afterburner');
    }
    if (this.mods.chainSpeed > 0 && chain > 1) {
      // Chain Reaction: every PERFECT after the first adds more speed, the longer the chain.
      this.addSpeed(this.mods.chainSpeed * Math.min(chain - 1, CARD_TUNING.chainSpeedMaxSteps));
      this.burst(this.comet.x, this.comet.y, CARD_FAMILIES.fling.color, 10, 200);
      this.cardProc('chain');
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
  // The speed bonus lands at once; the stamp waits while a zone banner / card pick owns the screen.
  chainMilestone(level) {
    this.reportProgress('milestone', level);
    this.addMomentumSpeed(milestoneSpeedBonus(level));
    if (this.cardPickPending()) {
      this.queuedMilestone = { level: Math.max(level, this.queuedMilestone ? this.queuedMilestone.level : 0), chain: this.perfectChain };
      return;
    }
    this.playMilestone(level, this.perfectChain);
  }

  // A zone's card pick is counting down (its banner is up) or open.
  cardPickPending() {
    return !!this.cardPick || (this.picksOwed > 0 && this.pickDelay > 0);
  }

  // Plays a queued milestone stamp a beat after the card pick closes (the card name pops first).
  updateQueuedMilestone(realDt) {
    if (!this.queuedMilestone || this.isOver) return;
    if (this.cardPickPending()) { this.milestoneWait = GameScene.MILESTONE_AFTER_PICK; return; }
    this.milestoneWait -= realDt;
    if (this.milestoneWait > 0) return;
    const q = this.queuedMilestone;
    this.queuedMilestone = null;
    this.playMilestone(q.level, q.chain);
  }

  playMilestone(level, chain) {
    this.lastStampAt = this.time.now;
    this.sfx('milestone', { level, chain });
    if (this.headless) return;
    this.hudCall('showMilestone', CHAIN_MILESTONE_NAMES[level], level);
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

  // Remembers the orbit's last green window (best angle seen) for assistCoyoteTime after it sweeps past:
  // late, the first green often comes at the very moment of the catch, faster than a human can let go,
  // and the next one is a full turn away, after the wave has arrived.
  trackAssistCoyote(dt) {
    const v = tangentVelocity(this.orbit, 1);
    const live = pickAssistTarget(this.comet.x, this.comet.y, v.vx, v.vy, this.planets, this.orbitPlanet);
    const k = this.assistCoyote;
    if (live) {
      if (!k || k.planet !== live.planet || k.t > 0 || live.angle < k.angle) {
        this.assistCoyote = { planet: live.planet, aimX: live.aimX, aimY: live.aimY, angle: live.angle, t: 0 };
      }
    } else if (k) {
      k.t += dt;
      if (k.t > assistCoyoteTime(this.bestAltitude)) this.assistCoyote = null;
    }
  }

  // Where a release right now would be steered to (null = straight along the tangent).
  currentAssist() {
    if (!this.orbit) return null;
    const v = tangentVelocity(this.orbit, 1);
    const normal = pickAssistTarget(this.comet.x, this.comet.y, v.vx, v.vy, this.planets, this.orbitPlanet);
    if (normal) return normal;
    // Late: a green that just swept past still counts for a moment (its best angle, gold included).
    const k = this.assistCoyote;
    if (k && k.t <= assistCoyoteTime(this.bestAltitude) && this.planets.indexOf(k.planet) >= 0) {
      return { planet: k.planet, aimX: k.aimX, aimY: k.aimY, angle: k.angle, coyote: true };
    }
    // Early help: in the first seconds of a run a wider cone still steers a release onto a planet above.
    const early = this.learning ? 0 : earlyHelpShare(this.elapsed);
    if (early > 0) {
      const cone = TUNING.assistMaxAngle + (TUNING.earlyAssistAngle - TUNING.assistMaxAngle) * early;
      const wide = pickAssistTarget(this.comet.x, this.comet.y, v.vx, v.vy, this.planets, this.orbitPlanet, cone);
      if (wide) return Object.assign(wide, { early: true });
    }
    if (!this.learning) return null;
    // Learning window: every release goes to the next planet up (see pickTutorialTarget).
    return pickTutorialTarget(this.comet.x, this.comet.y, v.vx, v.vy, this.planets, this.orbitPlanet, this.orbitPlanet.y);
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
    if (!this.startBannerShown && this.hud.scoreText) {
      this.startBannerShown = true;
      this.hudCall('showBanner', 'ESCAPE THE SUPERNOVA!', '', { duration: 1500 });
    }
    this.updateGuided(realDt);
    this.updateFeelTimers(realDt);
    this.updatePickDelay(realDt);
    this.updateQueuedMilestone(realDt);
    this.novaHoldT = Math.max(0, this.novaHoldT - realDt);
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
    if (this.catchSlowT >= 0) {
      // Light catch slow-down (latch): ~0.6x easing back to 1x in under 0.2 s.
      this.catchSlowT += realDt;
      timeScale = Math.min(timeScale, catchSlowScale(this.catchSlowT));
      if (this.catchSlowT >= CATCH_SLOW.time) this.catchSlowT = -1;
    }
    if (this.cardPick) {
      // Deep slow motion while choosing a card: the whole world (supernova included) crawls.
      timeScale = GameScene.CARD_TIME_SCALE;
      this.updateCardPickFallback(realDt);
    }
    // Guided tutorial: near-pause slow motion while a step waits (the simulator gets it too: it is the
    // tutorial itself, not juice).
    if (this.guidedSlow > 0) timeScale = Math.min(timeScale, this.guidedTimeScale());
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
      if (this.guided && this.guided.phase === 'lap') this.guidedLap += Math.abs(step.orbit.angle - this.orbit.angle);
      this.orbit = step.orbit;
      this.speed = step.speed;
      this.orbitHeldT += dt;
      this.closeOrbitNow = orbitCloseness(this.orbit.radius, this.orbitPlanet.radius);
      if (this.closeOrbitNow > GameScene.CLOSE_ORBIT_AT) this.closerFaster();
      this.trackAssistCoyote(dt);
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
      if (!noDecay) this.speed -= flightDecay(altitude, this.speed) * this.mods.flightDecayMul * dt;
      // High-speed drag: an unearned 800 km/s bleeds away (Afterburner / Slipstream only shield it below 600).
      this.speed -= highSpeedDrag(this.speed, this.mods.flightDecayMul, noDecay) * dt;
      // Keep direction, apply the decayed speed.
      const len = Math.hypot(this.comet.vx, this.comet.vy) || 1;
      this.comet.vx = (this.comet.vx / len) * this.speed;
      this.comet.vy = (this.comet.vy / len) * this.speed;
      // A steer whose point the comet has already passed ends (a long one would otherwise turn it round).
      // Passed = it was ahead and is behind now: a wide learning assist starts with its point behind the
      // tangent, and ending that one at once sent the release off along its raw (often falling) tangent.
      if (this.homing) {
        const ahead = (this.homing.x - this.comet.x) * this.comet.vx + (this.homing.y - this.comet.y) * this.comet.vy > 0;
        if (ahead) this.homing.wasAhead = true;
        else if (this.homing.wasAhead) this.homing = null;
      }
      if (this.homing) {
        const h = steerToward(this.comet.vx, this.comet.vy, this.homing.x - this.comet.x, this.homing.y - this.comet.y, (this.homing.turn || TUNING.homingTurn) * dt);
        this.comet.vx = h.vx;
        this.comet.vy = h.vy;
        this.homing.time -= dt;
        if (this.homing.time <= 0) this.homing = null;
      }
      // Early help: a falling (or flat) free flight in the first seconds curls back up toward the next planet.
      this.earlyCurl(dt);
      this.flightT += dt;
      if (this.mods.flightDecayMul < 1 && this.flightT - dt < GameScene.AERO_PROC_AT && this.flightT >= GameScene.AERO_PROC_AT) this.cardProc('aero');
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
    this.updatePlanetDrift(dt);
    this.updateCrawlRescue(dt);

    this.updateCamera(dt);
    this.applySlideRumble();
    this.reportCometScreen();
    this.speed = Math.max(this.speed, TUNING.minSpeed);
    if (this.speed > this.topSpeed) this.topSpeed = this.speed;
    this.updateLearning();
    this.updateNova(dt, realDt, timeScale);
    this.updateOrbitDanger();
    // The supernova is the only way to lose: speed is what keeps you ahead of it.
    // ...except while a guided tutorial step slows the world: nothing can kill the player then.
    if (this.comet.y + TUNING.cometRadius * 0.5 > this.novaY && !this.guidedFreezesNova()) {
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
    this.reportRunStats();
    this.draw();
  }

  updateNova(dt, realDt, timeScale) {
    this.elapsed += dt;
    // Every card makes the wave faster, so upgrades never make the run easy (up to TUNING.novaHardCap).
    this.novaSpeedNow = this.currentNovaSpeed();
    // Right after a card pick the wave holds still (leash included) while the player finds a planet,
    // and it is frozen while a guided tutorial step slows the world.
    if (this.novaHoldT <= 0 && !this.guidedFreezesNova()) {
      // Late orbit fairness: an orbit right after a PERFECT gets a slower wave for a moment (orbitNovaMul).
      const climb = this.novaSpeedNow * orbitNovaMul(this.bestAltitude, this.orbitHeldT, !!this.orbit, this.perfectChain > 0);
      this.novaY -= climb * dt;
      // Never let it fall far behind, so the threat is always close (late: ~0.8 s of travel below the screen).
      let leash = this.leashBottom() + novaLeashFor(this.bestAltitude, this.novaSpeedNow);
      // Before ESCAPE VELOCITY the leash does not tighten during an orbit: after a fast climb the camera is
      // still catching up when the comet latches, and that catch-up dragged the wave ~400 px up at 2000+ px/s
      // into the orbit's down swing (fast early runs died 0.9 s into an orbit). In an orbit the wave closes
      // at its own speed; the leash takes over again in flight.
      if (this.orbit && pagesPastEscape(this.bestAltitude) <= 0) {
        if (this.orbitLeashY === null) this.orbitLeashY = leash;
        leash = Math.max(leash, this.orbitLeashY);
      } else this.orbitLeashY = null;
      // A latch that pushed the wave back (latchFairness) keeps it there for this orbit.
      if (this.orbit && this.latchNovaFloor !== null) leash = Math.max(leash, this.latchNovaFloor);
      this.novaY = Math.min(this.novaY, leash);
    } else if (this.novaHoldT <= 0) this.guidedNovaCreep(dt, realDt, timeScale);
    // Guided tutorial: the wave is always in sight at the bottom of the screen, like in a normal run (but never
    // closer than GUIDED_NOVA_GAP to the comet while a step or the lap holds it).
    if (this.guided) {
      this.novaY = Math.min(this.novaY, this.anchorBottom() - GameScene.GUIDED_NOVA_SHOW);
      if (this.guidedFreezesNova()) this.keepGuidedNovaGap();
    }
    const gap = this.novaY - this.comet.y;
    if (this.hud.setDanger) this.hud.setDanger(1 - (gap - 150) / 450);
    if (typeof this.hud.setNovaEta === 'function') this.hud.setNovaEta(this.novaEta());
  }

  // Guided tutorial step / lap: the wave keeps creeping up at the slowed world time (never fully frozen while a
  // step waits), but it stays GUIDED_NOVA_GAP below the comet (and the orbit's low point): it cannot kill then.
  guidedNovaCreep(dt, realDt, timeScale) {
    const creepDt = this.guidedHolds() ? (realDt || 0) * Math.max(timeScale || 0, TUNING.guidedSlowScale) : dt;
    this.novaY -= this.novaSpeedNow * creepDt;
    this.keepGuidedNovaGap();
  }

  keepGuidedNovaGap() {
    const low = this.orbit && this.orbitPlanet ? Math.max(this.comet.y, this.orbitPlanet.y + this.orbit.radius) : this.comet.y;
    this.novaY = Math.max(this.novaY, low + GameScene.GUIDED_NOVA_GAP);
  }

  // Orbit warning: orbiting with the wave within orbitDangerEta s pulses the aim line and the HUD heat band.
  updateOrbitDanger() {
    const danger = this.orbit && !this.guidedFreezesNova() ? orbitDangerLevel(this.novaEta()) : 0;
    this.orbitDanger = danger;
    if (!this.headless && this.hud && typeof this.hud.setOrbitDanger === 'function') this.hud.setOrbitDanger(danger);
  }

  // Latch fairness: a fresh orbit never starts with the wave under latchMinEta s away (its down swing killed in
  // 0.2-0.3 s, faster than the warning can be read); the wave is pushed back at most latchMaxPush px for it.
  // Only a latch that CREATED the danger is helped: flightEta (the eta just before the catch) was already at
  // least latchMinEta. A comet that was already falling into the wave gets no push (late runs would never end).
  latchFairness(flightEta) {
    this.latchNovaFloor = null;
    if (this.guided || this.novaHoldT > 0) return;
    if (!(flightEta >= TUNING.latchMinEta)) return;
    if (this.novaEta() >= TUNING.latchMinEta) return;
    const from = this.novaY;
    for (let push = 30; push <= TUNING.latchMaxPush; push += 30) {
      this.novaY = from + push;
      if (this.novaEta() >= TUNING.latchMinEta) break;
    }
    this.latchNovaFloor = this.novaY;
  }

  // Wave speed right now (px/s): calm start, the learning crawl on tutorial runs, cards, hard cap.
  currentNovaSpeed() {
    let calm = novaCalmFactor(this.elapsed, this.learning, this.tutorialOn);
    if (this.learnEndT !== null && !this.learning) calm = learnExitFactor(calm, this.elapsed - this.learnEndT);
    const sincePick = this.lastCardPickAt === null ? null : this.elapsed - this.lastCardPickAt;
    return novaSpeedFor(this.elapsed, this.bestAltitude, cardNovaMul(this.ownedCards.length, sincePick), calm, !!this.tutorialOn);
  }

  // Seconds until the wave reaches the comet: the HUD's off-screen warning (see novaEtaSeconds).
  novaEta() {
    // Full wave speed (not the short late orbit grace), so the warning never drops in when the grace ends;
    // 0 while it holds still after a card pick.
    const wave = this.novaHoldT > 0 ? 0 : this.novaSpeedNow || this.currentNovaSpeed();
    if (this.orbit) {
      const o = this.orbit;
      return novaOrbitEta({
        novaY: this.novaY, cometY: this.comet.y, planetY: this.orbitPlanet.y, angle: o.angle, radius: o.radius,
        dir: o.dir, spin: Math.min(this.speed / o.radius, orbitSpinCap(this.speed)), wave,
        slowWave: wave * orbitNovaMul(this.bestAltitude, this.orbitHeldT, true, this.perfectChain > 0),
        slowFor: Math.max(0, (this.perfectChain > 0 ? TUNING.orbitNovaGracePerfect : TUNING.orbitNovaGrace) - this.orbitHeldT),
      });
    }
    return novaEtaSeconds(this.novaY - this.comet.y, wave, this.scrape ? 0 : this.comet.vy);
  }

  checkZone() {
    const index = zoneIndexForAltitude(this.bestAltitude);
    if (index <= this.zoneIndex) return;
    this.zoneIndex = index;
    this.reportProgress('zone', index);
    this.zonePulseAt = this.time.now;
    this.hudCall('showBanner', zoneAt(index).name, 'NOW UP TO ' + Math.round(this.speedCap() / 10) + ' km/s');
    this.sfx('zone', { index });
    this.turnPage(index);
    this.shieldCharges = this.mods.heatShieldCharges;   // Heat Shield recharges every zone
    // Banner and page turn get the stage first; the cards come in once they have been read, and only
    // in free flight while climbing (cardPickReady). The simulator has no banner to wait for.
    this.picksOwed++;
    if (this.pickDelay < 0) this.pickDelay = this.headless ? 0 : GameScene.PICK_DELAY;
  }

  // Real-time countdown (runs through hitstop and slow motion) to the zone's card pick.
  updatePickDelay(realDt) {
    // A guided tutorial step owns the screen: the pick waits (its countdown too).
    if (this.picksOwed <= 0 || this.cardPick || this.isOver || this.introActive || this.guidedBusy()) return;
    if (this.pickDelay > 0) {
      this.pickDelay -= realDt;
      if (this.pickDelay > 0) return;
    }
    this.pickDelay = 0;
    const ready = cardPickReady({
      orbiting: !!this.orbit, scraping: !!this.scrape, vy: this.comet.vy,
      firstRun: this.tutorialOn && this.tutorialRunsBefore === 0, meters: this.bestAltitude, seconds: this.elapsed,
    });
    if (!ready) return;
    this.picksOwed--;
    this.pickDelay = this.picksOwed > 0 ? CARD_TUNING.pickGap : -1;
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
    // Pale pages use dark ink: warm those textures up a page early.
    if (!this.warmedDark && GameScene.isPalePage(zoneAt(index + 1))) {
      this.warmedDark = true;
      ART.warmAll(this, 'd');
    }
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
    const z = zoneAt(this.pageNextIndex);
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
    const z = zoneAt(this.pageNextIndex);
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
    g.fillStyle(zoneAt(ART.pageIndex).paper, 1);
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
    const fx = zoneAt(ART.pageIndex).fx;
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
    const c = this.comet;
    // Only a comet moving INTO the wall bounces (one pushed against it while already leaving does not).
    if ((c.x < r && c.vx < 0) || (c.x > GAME_WIDTH - r && c.vx > 0)) {
      c.x = Phaser.Math.Clamp(c.x, r, GAME_WIDTH - r);
      // A steer still pulling toward the wall would turn the comet straight back into it every few frames
      // (each bounce costing speed: the 3600 -> 250 px/s collapse): a wall hit ends any steer. Except the
      // first wall of an aimed fling right after its release (a flat late green released next to a wall): it
      // keeps turning onto its planet instead of pinballing flat into the wave.
      if (this.homing && this.steerWallSave && this.elapsed - this.flingAt < GameScene.STEER_WALL_SAVE) this.steerWallSave = false;
      else this.homing = null;
      this.lastWallAt = this.elapsed;
      // Wall Kick (a couple of times per aimed flight) is the only wall that turns a flight upward; every
      // other hit is a plain mirror, so a bad fling that was falling keeps falling.
      const kick = this.mods.wallKick && wallKickAllowed(this.wallKicksUsed, this.elapsed - this.lastKickAt);
      if (kick) return this.wallKick(c.vx, c.vy);
      const w = wallBounceVelocity(c.vx, c.vy, this.speed);
      c.vx = w.vx;
      c.vy = w.vy;
      this.sfx('wall');
      this.speed *= wallBounceKeepAt(this.speed);
      this.cameras.main.shake(90, 0.006);
      this.burst(this.comet.x, this.comet.y, 0xffffff, 6);
    }
  }

  // Wall Kick: the bounce turns upward and adds speed instead of costing it. The climb scales with the incoming
  // climb (wallKickClimb): a flat flight only gets a shallow one. (vxIn, vyIn): the velocity hitting the wall.
  wallKick(vxIn, vyIn) {
    const c = this.comet;
    const away = c.x < GAME_WIDTH / 2 ? 1 : -1;
    const len = Math.hypot(vxIn, vyIn) || 1;
    this.addSpeed(wallKickGain(this.speed, this.speedCap(), CARD_TUNING.wallKickBonus));
    let uy;
    let ux;
    if (-vyIn / len >= TUNING.wallKickSteepFrom) {
      // A real climb hitting the wall: the classic kick, up and inward, the sideways speed capped so it can
      // never pinball wall to wall (the rest goes into the climb).
      const w = wallKickVelocity(vxIn, vyIn, this.speed);
      ux = w.vx / this.speed;
      uy = Math.min(w.vy / this.speed, -TUNING.wallKickClimbMax);
      ux = Math.sign(ux || away) * Math.sqrt(Math.max(0, 1 - uy * uy));
      if (Math.abs(ux) * this.speed > TUNING.wallCrossWidth / TUNING.wallCrossSeconds) {
        ux = Math.sign(ux) * (TUNING.wallCrossWidth / TUNING.wallCrossSeconds) / this.speed;
        uy = -Math.sqrt(1 - ux * ux);
      }
    } else {
      // Flat or falling: only a shallow climb, scaled with the incoming one (no free near-vertical climb).
      uy = wallKickClimb(vyIn / len);
      ux = away * Math.sqrt(1 - uy * uy);
    }
    this.lastKickAt = this.elapsed;
    this.cardProc('wallkick');
    this.homing = null;
    this.kickGraceT = GameScene.KICK_GRACE;
    this.wallKicksUsed++;
    c.vx = ux * this.speed;
    c.vy = uy * this.speed;
    this.sfx('wallkick');
    this.reportProgress('wallkick');
    // Written once per flight (and only the first times of a run, see cardProcPop); priority 1 = low.
    if (!this.wallKickPopShown) {
      this.wallKickPopShown = true;
      this.cardProcPop('wallkick', 'WALL KICK!', CARD_FAMILIES.flight.color, { size: 40, priority: 1 });
    }
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
        else if (this.learning) this.softBump();
        else this.loseSpeed(TUNING.asteroidKeep);
      }
    }
  }

  // Tail Armor: the rock bursts apart and the comet gains speed from it.
  shatterAsteroid(a) {
    this.addSpeed(CARD_TUNING.armorBonus);
    this.sfx('shatter');
    this.cardProcPop('armor', 'SHATTER! +SPEED', CARD_FAMILIES.shield.color, { size: 38 });
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
      // One warp per hole per flight: with mirror walls a sideways warp bounced straight back into the same
      // core, and the second warp turned the climb into a dive into the wave.
      if (inside && !h.cometInside && !h.warped && h.warpFlight !== this.flightNo) {
        h.warpFlight = this.flightNo;
        // A warp never turns a climb into a dive or a flat flight (warpVelocity keepClimbing): with mirror
        // side walls that flight ping-pongs down into the wave before a planet can be grabbed.
        const w = warpVelocity(h.x, h.y, this.comet.x, this.comet.y, this.comet.vx, this.comet.vy, true);
        this.comet.vx = w.vx;
        this.comet.vy = w.vy;
        h.warped = true;
        this.reportProgress('warp');
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
        this.comet.x = p.x + nx * (minDist + 2);
        this.comet.y = p.y + ny * (minDist + 2);
        p.wobble = 0.7;
        // Right after a side wall the comet slides round the planet (a small loss) instead of a -30% bump.
        // (The learning window keeps its own soft bounce, which never knocks a learner down.)
        if (!this.learning && this.kickGraceT <= 0 && wallPlanetSlideActive(this.elapsed - this.lastWallAt)) return this.wallPlanetGlance(nx, ny, p);
        const dot = this.comet.vx * nx + this.comet.vy * ny;
        this.comet.vx -= 2 * dot * nx;
        this.comet.vy -= 2 * dot * ny;
        // A Wall Kick that sends you straight into a planet stays a bonus: the bump is free.
        if (this.kickGraceT > 0) return;
        this.planetBump(nx, ny, p);
        return;
      }
    }
  }

  // Planet touched within WALL_PLANET_SLIDE.window s of a side wall: the comet glances off along the surface
  // tangent nearest its heading and keeps WALL_PLANET_SLIDE.keep of its speed (no chain break, no loss pop).
  wallPlanetGlance(nx, ny, planet) {
    const c = this.comet;
    const v = wallPlanetSlide(c.vx, c.vy, nx, ny);
    this.homing = null;
    if (!this.learning) this.speed = Math.max(TUNING.minSpeed, this.speed * WALL_PLANET_SLIDE.keep);
    c.vx = v.vx;
    c.vy = v.vy;
    planet.wobble = 0.5;
    this.jellyT = 0;
    this.sfx('wall');
    this.burst(c.x, c.y, 0xf4ead0, 5, 80);
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
      // Touched right after a side wall: if no hold comes, it glances off (wallPlanetGlance), not a bump.
      afterWall: !this.learning && this.kickGraceT <= 0 && wallPlanetSlideActive(this.elapsed - this.lastWallAt),
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
    if (s.afterWall) {
      this.comet.vx = s.vx;
      this.comet.vy = s.vy;
      this.comet.x += nx * 2;
      this.comet.y += ny * 2;
      return this.wallPlanetGlance(nx, ny, s.planet);
    }
    const dot = s.vx * nx + s.vy * ny;
    this.comet.vx = dot < 0 ? s.vx - 2 * dot * nx : s.vx;
    this.comet.vy = dot < 0 ? s.vy - 2 * dot * ny : s.vy;
    this.comet.x += nx * 2;
    this.comet.y += ny * 2;
    s.planet.wobble = 0.7;
    this.planetBump(nx, ny, s.planet);
  }

  // A planet bump costs speed, except in the learning window, where it is a soft bounce (no penalty).
  // (nx, ny): unit normal from the planet center to the comet.
  planetBump(nx, ny, planet) {
    if (this.learning) {
      // Soft bounce: no speed lost, and never knocked back down toward the wave: a bounce that
      // would head down slides off along the surface on its upward side instead, then curves up
      // past the planet's rim.
      const c = this.comet;
      this.homing = null;
      if (c.vy > 0 && planet) {
        const sp = Math.hypot(c.vx, c.vy);
        let tx = ny;
        let ty = -nx;
        if (ty > 0 || (ty === 0 && c.vx * tx < 0)) { tx = -tx; ty = -ty; }
        c.vx = tx * sp;
        c.vy = ty * sp;
        const side = tx >= 0 ? 1 : -1;
        const pass = planet.radius + TUNING.assistPassGap;
        const p = passPointInField(planet.x + side * pass, planet.y - pass, planet, GAME_WIDTH, GameScene.AIM_MARGIN, true);
        this.homing = { x: p.x, y: p.y, time: 0.6, turn: GameScene.SOFT_BUMP_TURN };
      }
      this.softBump();
      return;
    }
    this.loseSpeed(planetHitKeep(this.zoneIndex, this.speed));
  }

  // Learning-window bump (planet or asteroid): a wobble and a tap, no speed lost, no red flash, no pop.
  softBump() {
    this.jellyT = 0;
    this.sfx('wall');
    this.burst(this.comet.x, this.comet.y, 0xf4ead0, 5, 80);
  }

  // Starts orbiting planet. auto: onboarding catch without a hold (quiet pop, still counts).
  latch(planet, auto) {
    const c = this.comet;
    // Light catch slow-down (feel only): not on top of a hitstop / slow motion / the tutorial, and not for
    // catches chained within CATCH_SLOW.chainGap s (the game stays fast).
    const now0 = this.time.now;
    const chained = now0 - this.lastLatchAt < CATCH_SLOW.chainGap * 1000;
    this.lastLatchAt = now0;
    if (!this.headless && !chained && this.hitstop <= 0 && this.slowMoT < 0 && !this.cardPick && !this.guided) this.catchSlowT = 0;
    const latchDist = this.distanceTo(planet);
    const flightEta = this.orbit ? 0 : this.novaEta();
    this.orbit = startOrbit(planet.x, planet.y, c.x, c.y, c.vx, c.vy, planet.radius);
    this.homing = null;
    this.orbitPlanet = planet;
    this.autoCatchTarget = null;
    this.flightTarget = null;
    this.capTime = 0;
    this.orbitHeldT = 0;
    this.assistCoyote = null;
    this.flightT = 0;
    this.latchFairness(flightEta);
    // Gravity Well: a catch only its wider reach made.
    if (this.mods.grabRangeMul > 1 && latchDist > planet.radius + grabRangeForSpeed(this.speed)) this.cardProc('well');
    if (this.mods.orbitGainMul > 1) this.cardProc('overdrive');
    // Counts toward the tutorial / learning window only when the hold was deliberate (see pressHold).
    this.tutorialCatch = !auto && this.holdAimed !== false;
    this.catches++;
    if (!auto) this.ownCatches++;
    // The first catches of a run must feel like acceleration: ink burst, camera punch, speed-line rush.
    const early = this.catches <= GameScene.EARLY_CATCHES;
    if (early) {
      this.burst(c.x, c.y, 0xffe14d, 12, 170);
      this.zoomKick = Math.max(this.zoomKick, 0.05);
      this.catchRushT = GameScene.CATCH_RUSH_TIME;
      this.cameras.main.shake(110, 0.005);
    }
    this.reportProgress('catch');
    this.addMomentumSpeed(TUNING.catchBonus);
    const closeness = orbitCloseness(this.orbit.targetRadius, planet.radius);
    const close = closeness > 0.7;
    if (this.mods.tightCatchBonus > 0 && closeness > 0.6) {
      // Tight Spin: diving in deep before the hold is rewarded on the spot.
      this.addMomentumSpeed(this.mods.tightCatchBonus);
      this.burst(c.x, c.y, CARD_FAMILIES.orbit.color, 10, 150);
      this.cardProc('spin');
    }
    if (this.mods.catchBurst > 0) {
      // Orbit Master: a speed burst on every catch.
      this.addSpeed(this.mods.catchBurst);
      this.burst(c.x, c.y, CARD_FAMILIES.orbit.color, 14, 170);
      this.zoomKick = Math.max(this.zoomKick, 0.04);
    }
    const now = this.time.now;
    if (auto) this.popText('AUTO CATCH', '#c9c3e6', { size: 30, duration: 600, low: true });
    else if (close && this.mods.closeOrbitMul > 1) this.cardProcPop('spin', 'TIGHT SPIN!', CARD_FAMILIES.orbit.color, { size: 44 });
    else if (early || now - this.lastCatchPopAt > GameScene.CATCH_POP_QUIET) {
      // Catches happen every second or two: name the gain only now and then, the speedometer
      // and speed lines carry it the rest of the time. CLOSE ORBIT! at most once per CLOSE_POP_GAP.
      // Past routineCatchPopsUntil s into the run the readout says it alone (routineCatchPopAllowed).
      this.lastCatchPopAt = now;
      const routine = routineCatchPopAllowed(this.elapsed);
      if (close && routine && popGapOk(this.lastClosePopAt, now, GameScene.CLOSE_POP_GAP)) {
        this.lastClosePopAt = now;
        this.popText('CLOSE ORBIT! +SPEED', '#ffe14d');
      } else if (this.mods.catchBurst > 0) this.cardProcPop('orbitset', 'SPEED BURST!', CARD_FAMILIES.orbit.color, { low: true });
      else if (routine) this.popText('+SPEED', '#5eff8f', { low: true });
    }
    this.sfx('grab', { close });
    this.burst(c.x, c.y, 0xffffff, 6);
    planet.wobble = 1;
    this.jellyT = 0;
    this.freeze(FEEL.hitstopGrab);
    if (this.hintStage === 0) {
      this.hintStage = 1;
    } else if (this.hintStage === 2) {
      this.hintStage = 1;
      if (!auto) {
        // First real mid-flight catch: the loop is learned, for this and every later run.
        this.hintStage = 3;
        if (!this.headless && !this.learnedCatch) saveLearnedCatch();
        this.learnedCatch = true;
      }
    }
  }

  // Early help (earlyHelpShare): a free flight that falls or runs flat in the first seconds of a run curls up
  // toward the next planet above (straight up if none). Not in the learning window (it has its own help),
  // not while a steer runs.
  earlyCurl(dt) {
    if (this.learning || this.homing || this.guided) return;
    const c = this.comet;
    if (c.vy < -GameScene.EARLY_CURL_UNTIL * this.speed) return;
    const share = earlyHelpShare(this.elapsed);
    if (share <= 0) return;
    const p = this.nextPlanetAbove();
    const dx = p ? p.x - c.x : 0;
    const dy = p ? p.y - c.y : -1;
    const v = steerToward(c.vx, c.vy, dx, dy, TUNING.earlyCurlTurn * share * dt);
    c.vx = v.vx;
    c.vy = v.vy;
  }

  // First close orbit of the player's life (once ever): a hand-lettered CLOSER = FASTER stamp by the comet and
  // a bright glow along the orbit. Waits while the tutorial or a card pick owns the screen.
  closerFaster() {
    if (this.closerSeen || this.headless || this.guidedBusy() || this.cardPick || this.guided) return;
    // Never on top of another stamp (NICE!, MACH...): it waits for the screen to clear.
    if (this.time.now - (this.lastStampAt || -1e9) < GameScene.CLOSER_AFTER_STAMP) return;
    if (this.closerSeen === undefined) this.closerSeen = closerFasterSeen();
    if (this.closerSeen) return;
    this.closerSeen = true;
    saveCloserFasterSeen();
    this.closerGlowT = GameScene.CLOSER_GLOW_TIME;
    const sc = this.worldToScreen(this.comet.x, this.comet.y);
    if (this.hud && typeof this.hud.showCloserFaster === 'function') this.hud.showCloserFaster(sc.x, sc.y);
    else this.hudCall('showMilestone', 'CLOSER = FASTER', 1);
    this.sfx('milestone', { level: 1, chain: 0 });
    this.burst(this.comet.x, this.comet.y, 0xffe14d, 12, 150);
    this.zoomKick = Math.max(this.zoomKick, 0.03);
  }

  // A card's effect fired: a short crayon burst on the comet in its family colour, and the HUD pops the card's
  // small icon doodle above the comet (hud.cardProc, screen coords). At most once per PROC_GAP ms per card.
  cardProc(id) {
    if (this.headless) return;
    const card = cardById(id);
    if (!card) return;
    const now = this.time.now;
    if (now - (this.procAt[id] || -1e9) < GameScene.PROC_GAP) return;
    this.procAt[id] = now;
    const color = CARD_FAMILIES[card.family].color;
    this.burst(this.comet.x, this.comet.y, color, 8, 90);
    if (this.hud && typeof this.hud.cardProc === 'function') {
      const sc = this.worldToScreen(this.comet.x, this.comet.y);
      this.hud.cardProc(id, sc.x, sc.y);
    } else if (this.hud && typeof this.hud.flashCard === 'function') this.hud.flashCard(id);
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
    // Bumps can come in bursts (planet, rock, planet): popText lets one '-X% SPEED' out per lossPopGapMs.
    this.popText('-' + Math.round((1 - keep) * 100) + '% SPEED', '#ff4d6d');
  }

  // A card's proc pop: written the first CARD_TUNING.procPopsPerRun times of a run (cardProcPopAllowed),
  // after that only the card's icon flash in the HUD (hud.flashCard, when it has one) and a small ink burst.
  cardProcPop(cardId, label, color, opts) {
    const shown = this.procPops[cardId] || 0;
    // The icon doodle pops every time (cardProc); the words only the first procPopsPerRun times.
    if (cardById(cardId)) this.cardProc(cardId);
    if (cardProcPopAllowed(shown)) {
      this.procPops[cardId] = shown + 1;
      return this.popText(label, GameScene.hex(color), opts);
    }
    if (this.headless || cardById(cardId)) return;
    if (this.hud && typeof this.hud.flashCard === 'function') this.hud.flashCard(cardId);
    this.burst(this.comet.x, this.comet.y, color, 5, 70);
  }

  // Where an assist's steer heads: its pass point, or the one on the planet's other side when that one is past
  // a side wall (steering at it would bounce the comet off the wall again and again).
  homingPoint(assist) {
    return passPointInField(assist.aimX, assist.aimY, assist.planet, GAME_WIDTH, GameScene.AIM_MARGIN);
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
    // Learning window: no '-X% SPEED' pops.
    if (this.learning && label.charAt(0) === '-') return;
    // A guided tutorial step (or its NICE! stamp) owns the screen: the pop is dropped, never queued (a queued
    // PERFECT! came out ~8 s later, out of context). A pop from the flight between steps still shows.
    if (this.guidedStepUp()) return;
    const now = this.time.now;
    if (opts.low && now - this.lastPopAt < GameScene.LOW_POP_QUIET) return;
    // Loss pops are one family ('-30% SPEED', '-15% SPEED'...): one per lossPopGapMs whatever the number.
    const loss = isLossPop(label);
    if (loss && !popGapOk(this.lastLossPopAt, now, POP_GATES.lossPopGapMs)) return;
    // At most one new pop per popMinGapMs; inside that a pop only goes out when it outranks the last one.
    const priority = opts.priority || (typeof popPriority === 'function' ? popPriority(label) : 1);
    if (!popAdmitted(this.lastPop, now, priority)) return;
    this.lastPop = { at: now, priority };
    if (loss) this.lastLossPopAt = now;
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
    this.momentumZoom = Phaser.Math.Linear(this.momentumZoom, momentumVisual(this.speed) * TUNING.momentumZoomOut, Math.min(1, dt * 1.5));
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

  // What the supernova leash hangs from. Early: the gameplay view's bottom. Late (easing in over the first
  // half page past ESCAPE VELOCITY): where that bottom settles for the comet's position, so a camera still
  // catching up after a fast climb never drags the wave up at 6000 px/s while the comet sits in an orbit.
  leashBottom() {
    const k = Math.min(1, pagesPastEscape(this.bestAltitude) * 2);
    const anchor = this.anchorBottom();
    if (k <= 0) return anchor;
    const settled = this.comet.y + (GAME_HEIGHT / 2 - 0.12 * GAME_HEIGHT) / this.baseZoom;
    return anchor + (settled - anchor) * k;
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
    this.reportProgress('closecall');
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
      this.cardProcPop('shockwave', 'SHOCKWAVE!', CARD_FAMILIES.shield.color, { size: 44, duration: 900 });
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
    // Early catches get a short rush of speed lines even at low speed (feel only).
    this.catchRushT = Math.max(0, (this.catchRushT || 0) - dt);
    const rush = (this.catchRushT / GameScene.CATCH_RUSH_TIME) * 0.55;
    const intensity = Math.max(rush, Phaser.Math.Clamp((speedFraction(this.speed) - 0.45) / 0.55, 0, 1));
    const mom = momentumVisual(this.speed);   // from ~250 km/s the lines keep getting heavier
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
    this.createStoryLine();
    this.sfx('intro');
  }

  // Opening story line, hand-lettered over the swelling star: 'Your star went supernova.' then
  // 'RUN!' just before the blast; both fade out before the comet launches (gone on a skip).
  createStoryLine() {
    const make = (y, label, size, rot) => this.add.text(GAME_WIDTH / 2, y, label, {
      fontFamily: FONT, fontSize: size + 'px', color: '#f4ead0', stroke: '#14121c', strokeThickness: 10,
      align: 'center', wordWrap: { width: GAME_WIDTH - 80 },
    }).setOrigin(0.5).setScrollFactor(0).setRotation(rot).setAlpha(0).setDepth(10);
    this.storyLine = make(GameScene.STORY_Y, 'Your star went supernova.', 52, -0.035);
    this.storyRun = make(GameScene.STORY_Y + 92, 'RUN!', 104, 0.05).setColor('#f5862a');
    this.storyRun.baseRot = 0.05;
    this.storyLine.baseRot = -0.035;
    this.storyRunShown = false;
  }

  updateStoryLine() {
    if (!this.storyLine) return;
    const t = this.introT;
    const fadeOut = Phaser.Math.Clamp((GameScene.INTRO_LAUNCH - 0.05 - t) / 0.25, 0, 1);
    const fadeIn = Phaser.Math.Clamp((t - 0.1) / 0.25, 0, 1);
    // Line boil: the lettering re-wobbles at the sketch rate (10/s), never every frame.
    const rnd = artRandom(ART.boilFrame(this.time.now / 1000) * 41 + 5);
    this.storyLine.setAlpha(fadeIn * fadeOut).setRotation(this.storyLine.baseRot + (rnd() - 0.5) * 0.012);
    if (t >= GameScene.STORY_RUN_AT && !this.storyRunShown) {
      this.storyRunShown = true;
      this.storyRun.setScale(1.8);
      this.tweens.add({ targets: this.storyRun, scale: 1, duration: 160, ease: 'Quad.In' });
    }
    if (this.storyRunShown) this.storyRun.setAlpha(fadeOut).setRotation(this.storyRun.baseRot + (rnd() - 0.5) * 0.02);
  }

  destroyStoryLine() {
    if (!this.storyLine) return;
    this.storyLine.destroy();
    this.storyRun.destroy();
    this.storyLine = null;
    this.storyRun = null;
  }

  updateIntro(dt) {
    this.introT += dt;
    const swell = Math.min(1, this.introT / GameScene.INTRO_EXPLODE);
    if (this.explodeT < 0) {
      this.cameras.main.shake(60, 0.001 + swell * swell * 0.008);
      if (this.introT >= GameScene.INTRO_EXPLODE) this.explodeStar();
    } else {
      this.explodeT += dt;
      if (this.introT >= GameScene.INTRO_LAUNCH) {
        if (this.wantsFirstRunNote() && this.firstNoteT < 0) this.showFirstRunNote();
        if (this.firstNoteT >= 0) {
          this.firstNoteT += dt;
          if (this.firstNoteT >= GameScene.FIRST_NOTE_TIME) this.launch();
        } else this.launch();
      }
    }
    if (!this.introActive) return;
    this.updateStoryLine();
    this.draw();
  }

  skipIntro() {
    if (this.explodeT < 0) this.explodeStar();
    this.launch();
  }

  // First run only (guided tutorial, nothing played before), never headless: once the story line is gone, a
  // taped note 'Planets are your friends...' holds the launch for FIRST_NOTE_TIME s (a tap skips it), so it is
  // read and gone before the HOLD step (a friend thought planets were obstacles to dodge).
  wantsFirstRunNote() {
    return !this.headless && !!this.guided && this.tutorialRunsBefore === 0 && !GameScene.firstNoteShown;
  }

  showFirstRunNote() {
    GameScene.firstNoteShown = true;
    this.firstNoteT = 0;
    if (this.hud && typeof this.hud.showFirstRunNote === 'function') this.hud.showFirstRunNote(GameScene.FIRST_NOTE_TEXT);
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
    this.destroyStoryLine();
    // The first-run note never outlives the launch (the HOLD step comes ~0.5 s later).
    if (this.firstNoteT >= 0 && this.hud && typeof this.hud.hideFirstRunNote === 'function') this.hud.hideFirstRunNote();
    this.firstNoteT = -1;
    if (!this.headless && typeof PROGRESS !== 'undefined') {
      try { PROGRESS.startRun(); } catch (e) { /* progress must never block the launch */ }
    }
    this.countTutorialRun();
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
      momentum: momentumVisual(this.speed),
      zonePulse: Math.max(0, 1 - (this.time.now - this.zonePulseAt) / 600),
      intro: this.introActive,
      // Current page (any index, endless pages included): art.js draws its fx / paper / ink from it.
      zoneIndex: this.zoneIndex,
      zone: zoneAt(this.zoneIndex),
      aimKind: assist ? (assist.angle < this.perfectAngle() ? 'perfect' : 'target') : 'none',
      // Card hooks for art.js.
      afterburner: this.mods.afterburnerSeconds > 0 ? this.afterburnerT / this.mods.afterburnerSeconds : 0,
      shieldReady: this.shieldCharges > 0,
      grabRangeBonus: grabRangeForSpeed(this.speed) * (this.mods.grabRangeMul - 1),
      grabRange: this.grabRange(),   // the real grab reach (speed + Gravity Well), for the dashed ring
      // Equipped skin (PROGRESS): crayon colors + the small doodle that sets it apart.
      skin: this.skin ? this.skin.colors : null,
      skinId: this.skin ? this.skin.id : null,
      skinDetail: this.skin ? this.skin.detail : null,
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
    this.drawSlideLines(g);
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
    let frameDt = this.hitstop > 0 ? 0 : Math.min(this.game.loop.delta / 1000, 0.05);
    if (this.guidedSlow > 0) frameDt *= this.guidedTimeScale();   // speed lines and card fx stop with the world
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
    this.drawCloseOrbitGlow(g, ctx);
    this.drawAimPulse(g, assist, ctx);
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

  // Orbit warning (orbitDanger > 0): a pulsing orange crayon stroke over the aim line, faster and heavier as
  // the wave gets closer (no text). Boils at 10 fps like the rest of the ink.
  drawAimPulse(g, assist, ctx) {
    const k = this.orbitDanger;
    if (!(k > 0)) return;
    const c = this.comet;
    let ux;
    let uy;
    let len;
    if (assist) {
      ux = assist.aimX - c.x;
      uy = assist.aimY - c.y;
      len = Math.min(520, Math.hypot(ux, uy));
    } else {
      const v = tangentVelocity(this.orbit, 1);
      ux = v.vx;
      uy = v.vy;
      len = 420;
    }
    const n = Math.hypot(ux, uy) || 1;
    ux /= n;
    uy /= n;
    const pulse = 0.5 + 0.5 * Math.sin(ctx.time * (8 + 10 * k));
    const rnd = artRandom(Math.floor(ctx.time * 10) * 29 + 3);
    const color = SKETCH.orange !== undefined ? SKETCH.orange : 0xf5862a;
    const start = TUNING.cometRadius + 14;
    let t = start;
    while (t < len) {
      const e = Math.min(len, t + 26 + rnd() * 10);
      const j = (rnd() - 0.5) * 4;
      g.lineStyle(14 + 6 * k, SKETCH.shadowInk, 0.25 * pulse * k);
      g.lineBetween(c.x + ux * t - uy * j, c.y + uy * t + ux * j, c.x + ux * e - uy * j, c.y + uy * e + ux * j);
      g.lineStyle(7 + 5 * k * pulse, color, (0.35 + 0.5 * pulse) * Math.min(1, 0.4 + k));
      g.lineBetween(c.x + ux * t - uy * j, c.y + uy * t + ux * j, c.x + ux * e - uy * j, c.y + uy * e + ux * j);
      t = e + 14;
    }
  }

  // Close orbit (orbitCloseness > CLOSE_ORBIT_AT): a short bright crayon arc trailing the comet along the
  // orbit, so hugging the surface visibly runs hotter; extra bright for the first CLOSER = FASTER moment.
  drawCloseOrbitGlow(g, ctx) {
    const close = this.closeOrbitNow;
    if (!this.orbit || !(close > GameScene.CLOSE_ORBIT_AT - 0.1)) return;
    this.closerGlowT = Math.max(0, this.closerGlowT - (this.game.loop.delta || 16) / 1000);
    const k = Math.min(1, (close - (GameScene.CLOSE_ORBIT_AT - 0.1)) / 0.4) * (0.6 + 0.4 * Math.min(1, this.closerGlowT));
    const p = this.orbitPlanet;
    const o = this.orbit;
    const rnd = artRandom(Math.floor(ctx.time * 10) * 37 + 11);
    const span = 1.1 + 0.6 * close;
    const pts = [];
    for (let i = 0; i <= 12; i++) {
      const a = o.angle - o.dir * span * (i / 12);
      const r = o.radius + (rnd() - 0.5) * 4;
      pts.push({ x: p.x + Math.cos(a) * r, y: p.y + Math.sin(a) * r });
    }
    const yellow = SKETCH.yellow !== undefined ? SKETCH.yellow : 0xffe14d;
    g.lineStyle(16, SKETCH.shadowInk, 0.2 * k);
    g.strokePoints(pts, false);
    g.lineStyle(9, yellow, 0.75 * k);
    g.strokePoints(pts.slice(0, 9), false);
    g.lineStyle(5, 0xfff6dc, 0.6 * k);
    g.strokePoints(pts.slice(0, 5), false);
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
      if (this.hud.flash) this.hud.flash(0xff9a2e, 0.18, 220, 0.18);
      this.burst(this.deathAt.x, this.deathAt.y, 0xff9a2e, 22, 200);
      this.burst(this.deathAt.x, this.deathAt.y, 0xffd23f, 16, 140);
    }
    // The snap's shake lands a beat after it, and light: the jaws are the hit, not the camera.
    if (!this.deathShaken && this.deathT >= GameScene.DEATH_CLOSE + GameScene.DEATH_SHAKE_DELAY) {
      this.deathShaken = true;
      this.cameras.main.shake(200, 0.008);
    }
  }

  drawDeathBeat() {
    if (this.deathT < 0) return;
    ART.drawDeathJaws(this.introGfx, this.deathAt.x, this.deathAt.y, this.deathT / GameScene.DEATH_CLOSE, this.time.now / 1000);
  }

  // Missions / coins / journal for the finished run.
  commitProgress(summary) {
    if (this.headless || typeof PROGRESS === 'undefined') return null;
    try {
      return PROGRESS.endRun(summary);
    } catch (e) {
      return null;
    }
  }

  updateHud() {
    if (!this.hud.scoreText) return;   // HUD scene still starting
    this.hud.setStats(Math.floor(this.score), this.bestAltitude, this.speed, this.speed / 10);
    if (this.hud.setMomentum) this.hud.setMomentum(momentumVisual(this.speed));
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
    this.picksOwed = 0;
    // A step still up (not finished: the tutorial comes back next run) and anything it held back go away.
    this.hideGuidedStep();
    this.guidedNiceT = 0;
    this.guidedSlow = 0;
    this.hudQueue = [];
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
    this.draw();
    this.cameras.main.shake(260, 0.012);
    const summary = {
      score: Math.floor(this.score), altitude: this.bestAltitude, reason, newBestAltitude,
      bestAltitude: Math.max(this.bestAltitude, this.prevBestAlt),
      topSpeedKmh: Math.round(this.topSpeed / 10), maxChain: this.maxChain,
      zoneIndex: this.zoneIndex, seconds: Math.floor(this.elapsed),
      cards: this.ownedCards.slice(),
      secondWind: this.secondWindUsed,
    };
    // Commit the run now (not after the death beat), so leaving early never loses it.
    summary.progress = this.commitProgress(summary);
    this.time.delayedCall((GameScene.DEATH_CLOSE + GameScene.DEATH_HOLD) * 1000, () => {
      this.scene.start('GameOver', summary);
    });
  }
}

// x of a left-side black hole: clear of the km/s readout column (HudScene HUD_PANEL, right edge 320).
GameScene.LEFT_HOLE_X = 320 + TUNING.blackHoleRadius + 26;
// Screen px kept free at the bottom for the speed / multiplier HUD panel.
GameScene.COMET_BAND_BOTTOM = 300;
// The BEST label only shows below this screen y, clear of the top-left stats block.
GameScene.BEST_LABEL_MIN_Y = 260;

// Opening scene timeline (seconds): the star swells, explodes, then the comet launches.
GameScene.INTRO_EXPLODE = 1.7;
GameScene.INTRO_LAUNCH = 2.1;
// Opening story line: screen y of the first line, and when 'RUN!' slams in (intro seconds).
// Below the first planet (screen y ~106-361 with its ring) and above the swelling star.
GameScene.STORY_Y = 410;
GameScene.STORY_RUN_AT = 1.15;
// A hold started this many px before a planet's grab zone counts as aimed (holdAimed).
GameScene.HOLD_PROMPT_LEAD = 170;
// Guided tutorial: real s the NICE! stamp owns the screen, the most HUD calls held back meanwhile, and the
// share of the grab range a step-1 latch from outside the zone eases in to.
GameScene.GUIDED_NICE_TIME = 0.9;
GameScene.HUD_QUEUE_MAX = 6;
GameScene.GUIDED_LATCH_REACH = 0.6;
GameScene.SOFT_BUMP_TURN = 6;   // rad/s: a tutorial soft bump curves back up past the planet
// The first catches of every run get the acceleration juice (and a +SPEED pop each); speed-line rush length (s).
GameScene.EARLY_CATCHES = 4;
GameScene.CATCH_RUSH_TIME = 0.45;

// Upgrade card pick: world time scale while the cards are up, and seconds before the middle card is auto-picked.
GameScene.CARD_TIME_SCALE = 0.06;
GameScene.CARD_TIMEOUT = 6;
// Unbreakable rescue: minimum speed after it, and how far below the comet the nova is pushed.
GameScene.RESCUE_SPEED = 1000;
GameScene.RESCUE_PUSH = 520;
GameScene.SHOCK_FX_TIME = 0.5;
// Wall Kick: seconds after the kick in which bumping a planet costs no speed (and pops nothing).
GameScene.KICK_GRACE = 0.45;
GameScene.WIND_GRACE = 1.0;     // s after SECOND WIND / UNBREAKABLE in which a planet bump is free
// Zone entry: real seconds between the zone banner / page turn and the card pick.
GameScene.PICK_DELAY = 1.2;
GameScene.MILESTONE_AFTER_PICK = 0.9;   // real s after a card pick closes before a held-back stamp plays
// ms after any pop in which routine (low) pops are skipped.
GameScene.LOW_POP_QUIET = 600;
GameScene.CATCH_POP_QUIET = 4000;   // ms between catch pops (+SPEED / CLOSE ORBIT / SPEED BURST)
// Reach (reachablePlanetAhead): grab range plus max(REACH_MIN px, REACH_SECONDS s of flight). A slid-in
// planet lands SLIDE_AHEAD px (+ SLIDE_LEAD_SECONDS of flight) ahead of the comet.
GameScene.REACH_MIN = 250;
GameScene.REACH_SECONDS = 1;
GameScene.REACH_AHEAD_COS = 0.35;   // ~70 degrees either side of the flight direction
GameScene.SLIDE_LEAD_SECONDS = 0.35;
GameScene.AIM_MARGIN = TUNING.cometRadius + 20;   // px a steer's point stays inside the side walls
GameScene.SLIDE_RUMBLE = 0.005;       // share of the screen width the camera jitters (~3.6 px) while a planet slides into reach
GameScene.SLIDE_TIME = 0.5;
GameScene.CLOSE_ORBIT_AT = 0.7;      // orbitCloseness from which the close-orbit bonus counts (CLOSE ORBIT!, CLOSER = FASTER)
GameScene.CLOSER_AFTER_STAMP = 1400; // ms after another stamp before CLOSER = FASTER may show
GameScene.CLOSER_GLOW_TIME = 1.6;    // s the first close orbit's glow is extra bright
GameScene.AERO_PROC_AT = 1;          // s into a free flight when Aerodynamic's proc doodle shows (once per flight)
GameScene.STEER_WALL_SAVE = 0.2;     // s after an aimed release in which its first side wall keeps the steer...
GameScene.STEER_WALL_FLAT = 0.3;     // ...when the release tangent climbed less steeply than this (unit vy)
GameScene.PROC_GAP = 400;            // ms between two proc doodles of one card
GameScene.EARLY_CURL_UNTIL = 0.35;   // early help curls a flight until it climbs at this share of its speed
GameScene.GUIDED_NOVA_GAP = 260;     // px the tutorial wave stays below the comet / orbit low point during a step or lap
GameScene.GUIDED_NOVA_SHOW = 70;     // px of the tutorial wave kept in sight above the screen bottom
GameScene.FIRST_NOTE_TIME = 1.9;     // s the first-run 'planets are your friends' note holds the launch
GameScene.FIRST_NOTE_TEXT = 'Planets are your friends: grab them, swing, let go!';          // s a rescued / card-pick planet takes to slide into reach
GameScene.SLIDE_MAX_SPEED = 1200;   // px/s: a card pick slides a planet in only for a comet slower than this
GameScene.SLIDE_CLEARANCE = 160;    // px kept between a slid planet and any other
GameScene.CLOSE_POP_GAP = 6000;     // ms: CLOSE ORBIT! +SPEED at most this often
GameScene.MOMENT_STAMPS = ['showMachTier', 'showMilestone'];
// Extra px between the two guided tutorial planets (see create). At 220 the first LET GO's target sat under the
// top-left score scrap; at 100 it shows clear below it (screen y ~320) and the fling still flies a beat.
GameScene.GUIDED_SECOND_GAP = 100;
GameScene.GUIDED_FLIGHT_BEAT = 0.7; // s (real) of flight after the first tutorial fling before HOLD 2 shows...
GameScene.GUIDED_LEAVE_SHARE = 0.7; // ...unless the comet is leaving the planet's grab zone (this share of it)
// Death beat (seconds, real time): jaws closing, then the hold before the game over page.
GameScene.DEATH_CLOSE = 0.3;
GameScene.DEATH_HOLD = 0.55;
GameScene.DEATH_SHAKE_DELAY = 0.1;  // s after the snap before its (light) shake

// Pale paper (ESCAPE VELOCITY, BIG BANG): page ink turns dark there.
GameScene.isPalePage = (zone) => {
  const p = zone.paper;
  return 0.2126 * ((p >> 16) & 255) + 0.7152 * ((p >> 8) & 255) + 0.0722 * (p & 255) > 128;
};

// 3 dashed gravity lines from planet (px, py, radius pr) toward the comet (cx, cy), all in screen px:
// [{ x1, y1, x2, y2 }], fanned a little round the planet-to-comet direction, stopping short of the comet.
GameScene.gravityLines = (px, py, pr, cx, cy) => {
  const dx = cx - px;
  const dy = cy - py;
  const d = Math.hypot(dx, dy) || 1;
  const base = Math.atan2(dy, dx);
  const lines = [];
  for (const k of [-1, 0, 1]) {
    const a = base + k * 0.32;
    const start = pr + 12;
    const end = Math.max(start + 30, d - 46 - Math.abs(k) * 30);
    lines.push({
      x1: px + Math.cos(a) * start, y1: py + Math.sin(a) * start,
      x2: px + Math.cos(base + k * 0.12) * end, y2: py + Math.sin(base + k * 0.12) * end,
    });
  }
  return lines;
};

GameScene.hex = (color) => '#' + color.toString(16).padStart(6, '0');
