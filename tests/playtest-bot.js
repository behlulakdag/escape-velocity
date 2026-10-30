// Browser-side playtest simulator (not shipped). Runs the real game logic without rendering,
// so it is fast and works even when the tab is hidden. In the running game page:
//   eval(await (await fetch('tests/playtest-bot.js', { cache: 'no-store' })).text())
//   playtestSummary(['random', 'careful', 'skilled'], 10)
// Styles: random = releases at a random time (confused new player), careful = releases on the
// first green aim, skilled = waits for the gold PERFECT window (gives up after 2.5s), idle = never touches,
// holder = holds the whole run and never lets go (panic player; overspeed flings it on),
// mid = a mid-skill human: holds only once within ~110px of a planet's surface, after a 10-15 frame
// reaction delay, and lets go on the first green aim once 150-400ms (random) into the orbit (never waits for gold).
// expert = grabs early like skilled, but only releases on a dead-center gold aim (< 0.55 x the PERFECT
// window) after 150ms; falls back to any green aim when the supernova gap is under 280px or after 2.2-3.2s.
// masher = a friend tapping the screen at random, ignoring planets: holds 80-900 ms, lets go for 60-700 ms.
// anyAssist = strong policy: grabs early (any grabbable planet), releases on the first green/gold aim after 150 ms.
// FIRST RUN (simulated: the scene gets { simTutorial: true }: the guided HOLD / LET GO tutorial and the learner
// help, never touching real storage):
// newbie = follows the guided tutorial (two planets: HOLD -> the planet carries it a full lap -> LET GO, then
//   the same on the second planet, then NICE!): presses 250-450 ms after a HOLD step starts waiting, lets go
//   250-450 ms after a LET GO step starts waiting (reads scene.tutorialWaiting; the world is stopped meanwhile;
//   a LET GO with the finger already up gets a tap). While the tutorial runs it never presses or lets go on its
//   own (it waits to be told). After it, it plays what it was shown, slowly: holds 250-450 ms after a planet
//   comes within ~110 px of its surface, lets go on the first green aim once 250-450 ms into the orbit, or
//   after 3 s; it gives up a hold that caught nothing after 1.5 s.
// confused = first run (guided tutorial on), taps the screen at random like the masher.
// instant = grabs the nearest grabbable planet and lets go the very next frame (autopilot exploit check).
// rhythmFast = blind rhythm tapping: holds 180 ms, lets go for 180 ms, forever, ignoring the screen.
// humanLike = a returning human: holds 10-15 frames after a planet comes within ~110 px of its surface, and
//   lets go 150-450 ms after the aim first turned green (reaction lag: it may already have swept past), or
//   after 3 s (an auto-caught orbit with no finger on it gets a tap then).
// pinball = Wall Kick exploit check: grabs like careful, lets go when the orbit tangent is flat sideways
//   (|unit vy| < 0.12), aimed or not.
// Orbit warning lead: every supernova death while orbiting reports orbitWarn (s a warning was up before it:
// the HUD band, eta < 1.2 s, or the orbit warning, orbiting with eta < 1.5 s; -1 = none); summaries give
// orbitWarnMin / orbitWarnMed.
// window.simTutorial = true turns the tutorial on for every style (newbie / confused always have it).
// Card picks: every run reports pickDeath (s between the last card pick and a supernova death within 1.5 s,
// else null) and lateEta08 (share of frames at >= 15,000 m with eta < 0.8 s, the late warning band).
// Supernova visibility: every run reports warnBeforeDeath (s the eta < 1.2 s warning was up right before a
// supernova death, -1 = none) and lateVisible (share of frames at >= 15,000 m with the nova on screen or warned).
// Upgrade cards: on every zone entry the headless scene picks a random card at once (reported as cards / avgCards).
// Late start: window.simStart = { altitude: 9000, speed: 8000, cards: ['wallkick', 'aero'], randomCards: 3,
//   seconds: 75 } teleports every fresh run to that state (GameScene.debugTeleport: best altitude, comet,
//   camera, planets, page, supernova just below the screen, cards picked via pickCard; seconds = run time,
//   default altitude / 120) so late-game balance is measured fast. delete window.simStart to go back.
// Speed readout: every run reports minKms / medKms / maxKms (km/s, sampled after the first second).
// Crawl / walls / HUD: slowShare (median share of time below 60 km/s), cruiseKms (median free-flight km/s),
// wallHitsPerMin, wallLossPct (median share of all speed lost that went to side walls), crawlRescue
// (crawl rescues called / with a planet in reach within 1.2 s / caught within 2 s), hudShare (median share of
// frames with a planet or its orbit ring under the bottom-corner HUD blocks). Date.now follows the step clock.
// playtestSummary(styles, runsEach, maxSeconds) - maxSeconds defaults to 600 for expert, 240 otherwise.
// playtestTargets(runsEach, groups, only) - the balance target suite in one call: groups 'normal' (fresh
// starts, all styles), 'late9k' / 'late15k' / 'late9kNoCards' (simStart at 9000 / 15000 m), 'long'
// (anyAssist / expert, 600 s);
// only = limit to these styles. Keep each call under ~40 s of page time (e.g. 15 runs of the long styles).
(() => {
  let clock = performance.now();
  // Date.now follows the step clock while stepping, so anything timed by it matches the simulated time.
  const realDateNow = Date.now.bind(Date);
  const dateOffset = realDateNow() - clock;
  const step = () => {
    clock += 16.67;
    Date.now = () => Math.round(clock + dateOffset);
    try { game.scene.update(clock, 16.67); } finally { Date.now = realDateNow; }
  };

  window.simRun = (style, maxSeconds) => {
    ['Menu', 'GameOver', 'Game'].forEach((k) => game.scene.stop(k));
    // headless: skips the opening scene, hitstop, slow motion and best-altitude saves.
    const simTutorial = style === 'newbie' || style === 'confused' || !!window.simTutorial;
    game.scene.start('Game', { headless: true, simTutorial });
    for (let i = 0; i < 5; i++) step();
    const s = game.scene.keys.Game;
    if (window.simStart) {
      const st = window.simStart;
      const cards = (st.cards || []).slice();
      const pool = CARDS.map((c) => c.id).filter((id) => cards.indexOf(id) < 0);
      for (let k = 0; k < (st.randomCards || 0) && pool.length; k++) cards.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
      s.debugTeleport(Object.assign({}, st, { cards }));
    }
    const speeds = [];
    let mashHold = 0;   // masher: ms left in the current press / gap
    let mashGap = 100 + Math.random() * 600;
    const proto = Object.getPrototypeOf(s);
    let reason = null;
    let perfects = 0;
    let warps = 0;
    let hits = 0;
    let closeCalls = 0;
    let maxChain = 0;
    let secondWinds = 0;
    let milestones = 0;
    s.gameOver = function (r) { reason = r; return proto.gameOver.call(this, r); };
    // Headless GameScene picks a random card itself on zone entry (no CardScene); log when.
    let firstPickAt = null;
    let tutorialDoneAt = null;   // run s the guided tutorial finished (NICE!), null = not finished
    let rescues = 0;
    let lastPickAt = -1e9;
    let minPickGap = null;       // shortest run s between two card picks (null = fewer than 2 picks)
    s.pickCard = function (id, granted) {
      if (!granted) {
        if (firstPickAt === null) firstPickAt = Math.round(this.elapsed * 10) / 10;
        else minPickGap = Math.min(minPickGap === null ? 1e9 : minPickGap, Math.round((this.elapsed - lastPickAt) * 10) / 10);
        lastPickAt = this.elapsed;
      }
      return proto.pickCard.call(this, id, granted);
    };
    s.rescueFromNova = function () { rescues++; return proto.rescueFromNova.call(this); };
    s.secondWind = function () { secondWinds++; return proto.secondWind.call(this); };
    s.chainMilestone = function (level) { milestones++; return proto.chainMilestone.call(this, level); };
    // Speed collapses (the speed readout falls > 60% within 0.5 s with no planet / asteroid hit in that
    // window), wall pinball (>= 3 side-wall hits within 1 s, one count per burst: pinballs = with no orbit in
    // between, i.e. the comet bouncing wall to wall by itself; pinballsAny = also counting orbit -> fling -> wall).
    let lastHitAt = -1e9;
    s.loseSpeed = function (keep) { hits++; lastHitAt = this.elapsed; return proto.loseSpeed.call(this, keep); };
    const wallHits = [];
    let freeHits = [];        // wall hits since the last catch
    let pinballs = 0;
    let pinballsAny = 0;
    let pinballUntil = -1;
    let pinballAnyUntil = -1;
    // Crawl rescue: each call (a planet slid toward a crawling comet), and whether it worked: a grabbable
    // planet in reach within 1.2 s (crawlReach) and a catch within 2 s (crawlCatch).
    let crawlCalls = 0;
    let crawlReach = 0;
    let crawlCatch = 0;
    let crawlAt = -1;         // run s of the last rescue still being watched (-1 = none)
    let crawlReached = false;
    s.updateCrawlRescue = function (dt) {
      const before = this.crawlT;
      const r = proto.updateCrawlRescue.call(this, dt);
      if (before >= 0 && this.crawlT === -TUNING.crawlCooldown) { crawlCalls++; crawlAt = this.elapsed; crawlReached = false; }
      if (crawlAt >= 0 && !crawlReached && this.elapsed - crawlAt <= 1.2 && this.reachablePlanetAhead()) { crawlReached = true; crawlReach++; }
      return r;
    };
    s.latch = function (planet, auto) {
      freeHits = [];
      if (crawlAt >= 0 && this.elapsed - crawlAt <= 2) { crawlCatch++; crawlAt = -1; }
      return proto.latch.call(this, planet, auto);
    };
    let wallLoss = 0;         // px/s lost at side-wall hits
    let totalLoss = 0;        // px/s lost in all (decay, drag, bumps, walls), frame by frame
    s.bounceWalls = function () {
      const before = this.comet.vx;
      const speedBefore = this.speed;
      const r = proto.bounceWalls.call(this);
      if (this.speed < speedBefore) wallLoss += speedBefore - this.speed;
      if (before !== 0 && Math.sign(before) !== Math.sign(this.comet.vx)) {
        wallHits.push(this.elapsed);
        freeHits.push(this.elapsed);
        const recentAny = wallHits.filter((t) => this.elapsed - t <= 1);
        if (recentAny.length >= 3 && this.elapsed > pinballAnyUntil) { pinballsAny++; pinballAnyUntil = this.elapsed + 1; }
        const recent = freeHits.filter((t) => this.elapsed - t <= 1);
        if (recent.length >= 3 && this.elapsed > pinballUntil) {
          pinballs++;
          pinballUntil = this.elapsed + 1;
          if (window.simPinballLog) window.simPinballLog.push({ style, t: Math.round(this.elapsed * 100) / 100, speed: Math.round(this.speed), x: Math.round(this.comet.x), vx: Math.round(this.comet.vx), vy: Math.round(this.comet.vy), holes: this.blackHoles.length, homing: !!this.homing });
        }
      }
      return r;
    };
    const speedHist = [];     // [elapsed, speed] over the last 0.5 s
    let collapses = 0;
    let collapseUntil = -1;
    // window.simNoCards = true runs the base game without cards, for comparison.
    if (window.simNoCards) s.openCardPick = function () {};
    // window.simForceCards = ['spin', ...] picks those cards in order instead of random ones (A/B a build).
    if (window.simForceCards) {
      s.openCardPick = function () {
        const id = window.simForceCards.find((c) => this.ownedCards.indexOf(c) < 0);
        if (id) this.pickCard(id);
      };
    }
    // Only the first PERFECT of a chain pops now, so count them where they happen.
    s.onPerfect = function () { perfects++; proto.onPerfect.call(this); maxChain = Math.max(maxChain, this.perfectChain); };
    s.popText = function (label, color, opts) {
      if (label === 'CLOSE CALL!') closeCalls++;
      if (label === 'WARP!') warps++;
      return proto.popText.call(this, label, color, opts);
    };
    let left = null;
    let held = 0;
    let releaseAfter = 0;
    let reactFrames = -1;     // mid: frames left before the delayed hold lands
    let greenSince = -1;      // mid: ms of orbit when the aim first turned green
    let greenWait = 0;
    let expertPatience = 2500; // expert: ms it waits for a gold aim before taking any green one
    let maxSpeed = 0;
    let frames = 0;
    // newbie: the tutorial step it is reacting to, and ms until its finger lands / lifts.
    let seenStep = '';
    let reactMs = -1;
    let holdNoOrbit = 0;
    let orbitMs = 0;
    let nearMs = -1;          // newbie after the tutorial: ms left before its hold lands
    let greenMs = -1;         // ...and ms into an orbit before it starts looking for the green aim
    // supernova visibility
    let warnSince = -1;       // run seconds the eta < 1.2 s warning has been up since (-1 = off)
    let orbitWarnSince = -1;  // ...and the eta < 1.5 s orbit warning (J), counted from the first warned frame
    let humanGreenMs = -1;    // humanLike: ms since the aim first turned green in this orbit (-1 = not yet)
    let humanLag = 0;
    let lateFrames = 0;
    let lateSeen = 0;
    let lateEta08 = 0;
    let deathOrbiting = false;
    let hudFrames = 0;        // frames with a planet / orbit ring under a bottom HUD block
    const hudRects = typeof HUD_PANEL !== 'undefined' ? [HUD_PANEL, HUD_BADGE_PANEL] : [];
    let flightFrames = 0;     // frames after the first second (speed metrics)
    let slowFrames = 0;       // ...of them below 60 km/s (600 px/s)
    const cruise = [];        // free-flight speeds (no orbit), for the median cruise km/s
    const etaOf = () => (typeof s.novaEta === 'function' ? s.novaEta() : (s.novaY - s.comet.y) / Math.max(1, novaSpeed(s.elapsed, s.bestAltitude)));
    while (!s.isOver && frames < maxSeconds * 60) {
      frames++;
      if (style === 'newbie') {
        const waiting = s.tutorialWaiting || '';
        if (waiting !== seenStep) {
          seenStep = waiting;
          reactMs = waiting ? 250 + Math.random() * 200 : -1;
        }
        if (waiting) {
          reactMs -= 16.67;
          if (reactMs < 0) {
            if (waiting === 'hold' && !s.isHolding) s.pressHold();
            else if (waiting === 'letgo') { if (s.isHolding) s.releaseHold(); else s.pressHold(); }
          }
        } else if (!s.orbit) {
          orbitMs = 0;
          greenMs = -1;
          let near = null;
          for (const p of s.planets) {
            if (p === left || p === s.noGrabPlanet) continue;
            if (s.distanceTo(p) - p.radius < 110 && p.y < s.comet.y + 60) { near = p; break; }
          }
          if (near && !s.isHolding && nearMs < 0 && !s.guided) nearMs = 250 + Math.random() * 200;
          if (nearMs >= 0) {
            nearMs -= 16.67;
            if (nearMs < 0 && !s.isHolding) s.pressHold();
          }
          // A human gives up a hold that caught nothing.
          holdNoOrbit = s.isHolding && !s.orbit ? holdNoOrbit + 16.67 : 0;
          if (holdNoOrbit > 1500) { s.releaseHold(); holdNoOrbit = 0; nearMs = -1; }
        } else {
          left = s.orbitPlanet;
          nearMs = -1;
          holdNoOrbit = 0;
          orbitMs += 16.67;
          // Settles into the orbit for 250-450 ms, then lets go on the green aim it was shown, or after 3 s
          // anyway (once the tutorial is over: until then it waits to be told).
          if (greenMs < 0) greenMs = 250 + Math.random() * 200;
          if (s.isHolding && !s.guided && ((orbitMs > greenMs && s.currentAssist()) || orbitMs > 3000)) s.releaseHold();
        }
      } else if (style === 'rhythmFast') {
        mashHold -= 16.67;
        if (mashHold <= 0) {
          if (s.isHolding) s.releaseHold(); else s.pressHold();
          mashHold = 180;
        }
      } else if (style === 'instant') {
        if (s.orbit) { left = s.orbitPlanet; if (s.isHolding) s.releaseHold(); } else {
          const p = s.nearestGrabbablePlanet();
          if (p && p !== left && !s.isHolding) s.pressHold();
          else if ((!p || p === left) && s.isHolding) s.releaseHold();
        }
      } else if (style === 'masher' || style === 'confused') {
        if (s.isHolding) {
          mashHold -= 16.67;
          if (mashHold <= 0) { s.releaseHold(); mashGap = 60 + Math.random() * 640; }
        } else {
          mashGap -= 16.67;
          if (mashGap <= 0) { s.pressHold(); mashHold = 80 + Math.random() * 820; }
        }
      } else if (style === 'holder') {
        s.isHolding = true;
      } else if (style === 'humanLike' && !s.orbit) {
        let near = null;
        for (const p of s.planets) {
          if (p === left || p === s.noGrabPlanet) continue;
          if (s.distanceTo(p) - p.radius < 110 && p.y < s.comet.y + 60) { near = p; break; }
        }
        if (near && !s.isHolding && reactFrames < 0) reactFrames = 10 + Math.floor(Math.random() * 6);
        if (!near && !s.scrape && reactFrames >= 0) reactFrames = -1;
        if (reactFrames >= 0 && --reactFrames < 0) s.pressHold();
        holdNoOrbit = s.isHolding && !s.orbit ? holdNoOrbit + 16.67 : 0;
        if (holdNoOrbit > 1500) { s.releaseHold(); holdNoOrbit = 0; }
        held = 0;
        humanGreenMs = -1;
      } else if (style === 'humanLike') {
        left = s.orbitPlanet;
        held += 16.67;
        reactFrames = -1;
        if (humanGreenMs < 0 && s.currentAssist()) { humanGreenMs = 0; humanLag = 150 + Math.random() * 300; }
        else if (humanGreenMs >= 0) humanGreenMs += 16.67;
        if ((humanGreenMs >= 0 && humanGreenMs >= humanLag) || held > 3000) {
          // An auto-caught orbit (onboarding) has no finger on it: a human taps to let go.
          if (!s.isHolding) s.pressHold();
          s.releaseHold();
        }
      } else if (style === 'pinball' && s.orbit) {
        left = s.orbitPlanet;
        held += 16.67;
        const u = tangentVelocity(s.orbit, 1);
        if (held > 150 && Math.abs(u.vy) < 0.12) s.releaseHold();
      } else if (style === 'mid' && !s.orbit) {
        // Reacts to how close a planet looks, not to the real grab zone, and only after a delay.
        let near = null;
        for (const p of s.planets) {
          if (p === left) continue;
          if (s.distanceTo(p) - p.radius < 110) { near = p; break; }
        }
        if (near && !s.isHolding && reactFrames < 0) reactFrames = 10 + Math.floor(Math.random() * 6);
        if (!near && !s.scrape) { reactFrames = -1; s.isHolding = false; }
        if (reactFrames >= 0 && --reactFrames < 0) s.isHolding = true;
        held = 0;
        greenSince = -1;
      } else if (style === 'mid') {
        left = s.orbitPlanet;
        held += 16.67;
        reactFrames = -1;
        // Decides to let go 150-400ms into the orbit, then lets go on the first green aim.
        if (greenSince < 0) { greenSince = 0; greenWait = 150 + Math.random() * 250; }
        // A human eventually lets go even without a green line.
        if ((s.currentAssist() && held > greenWait) || held > 3000) s.releaseHold();
      } else if (!s.orbit) {
        const p = s.nearestGrabbablePlanet();
        s.isHolding = style !== 'idle' && !!(p && p !== left);
        held = 0;
        releaseAfter = 300 + Math.random() * 1200;
      } else {
        left = s.orbitPlanet;
        held += 16.67;
        const assist = s.currentAssist();
        if (held <= 16.67) expertPatience = 2200 + Math.random() * 1000;
        const novaGap = s.novaY - s.comet.y;
        const release = style === 'careful' ? assist && held > 200
          : style === 'anyAssist' ? assist && held > 150
          : style === 'expert' ? (assist && assist.angle < 0.55 * s.perfectAngle() && held > 150)
            || (assist && (novaGap < 280 || held > expertPatience)) || held > expertPatience + 1500
          : style === 'skilled' ? (assist && assist.angle < TUNING.perfectAngle && held > 200) || held > 2500
          : held > releaseAfter;
        if (release) s.releaseHold();
      }
      const speedBeforeStep = s.speed;
      step();
      if (s.speed < speedBeforeStep) totalLoss += speedBeforeStep - s.speed;
      if (frames > 60 && !s.isOver) {
        flightFrames++;
        if (s.speed < 600) slowFrames++;
        if (!s.orbit && !s.scrape) cruise.push(s.speed);
        // A planet (or the orbit ring around it) under the bottom-corner HUD blocks (km/s + MACH, xN badge).
        if (hudRects.length) {
          const z = s.cameras.main.zoom;
          const under = s.planets.some((p) => {
            const q = s.worldToScreen(p.x, p.y);
            const r = (p.radius + (p === s.orbitPlanet && s.orbit ? Math.max(0, s.orbit.radius - p.radius) : 0)) * z;
            return hudRects.some((b) => q.x + r > b.left && q.x - r < b.right && q.y + r > b.top && q.y - r < b.bottom);
          });
          if (under) hudFrames++;
        }
      }
      const eta = etaOf();
      if (eta < 1.2) { if (warnSince < 0) warnSince = s.elapsed; } else warnSince = -1;
      // Any warning on screen: the HUD heat band / '!!' (eta < 1.2 s), or the orbit warning (orbiting, eta < 1.5 s).
      if (eta < 1.2 || (s.orbit && eta < 1.5)) { if (orbitWarnSince < 0) orbitWarnSince = s.elapsed; } else if (!s.isOver) orbitWarnSince = -1;
      if (s.bestAltitude >= 15000) {
        lateFrames++;
        const bottom = typeof s.visibleBounds === 'function' ? s.visibleBounds().bottom : Infinity;
        if (s.novaY < bottom || eta < 1.2) lateSeen++;
        if (eta < 0.8) lateEta08++;
      }
      if (!s.isOver) deathOrbiting = !!s.orbit;
      if (simTutorial && tutorialDoneAt === null && !s.guided) tutorialDoneAt = Math.round(s.elapsed * 10) / 10;
      maxSpeed = Math.max(maxSpeed, s.speed);
      if (frames > 60) speeds.push(s.speed);
      speedHist.push([s.elapsed, s.speed]);
      while (speedHist.length && s.elapsed - speedHist[0][0] > 0.5) speedHist.shift();
      if (!s.isOver && s.elapsed > collapseUntil && s.elapsed - lastHitAt > 0.5) {
        const top = Math.max(...speedHist.map((h) => h[1]));
        if (s.speed < top * 0.4) {
          collapses++;
          collapseUntil = s.elapsed + 0.5;
          // window.simCollapseLog = [] collects each collapse with what was going on (debugging).
          if (window.simCollapseLog) window.simCollapseLog.push({ style, t: Math.round(s.elapsed * 100) / 100, from: Math.round(top), to: Math.round(s.speed), orbit: !!s.orbit, alt: s.bestAltitude, walls: wallHits.filter((w) => s.elapsed - w <= 0.5).length, cards: s.ownedCards.join(',') });
        }
      }
    }
    // Phaser reuses the last start data when none is passed: do not leak headless into real play.
    s.sys.settings.data = {};
    delete s.gameOver;
    delete s.popText;
    delete s.pickCard;
    delete s.rescueFromNova;
    delete s.secondWind;
    delete s.onPerfect;
    delete s.chainMilestone;
    delete s.openCardPick;
    delete s.loseSpeed;
    delete s.bounceWalls;
    delete s.latch;
    delete s.updateCrawlRescue;
    speeds.sort((a, b) => a - b);
    const kms = (q) => (speeds.length ? Math.round(speeds[Math.floor(q * (speeds.length - 1))] / 10) : 0);
    const orbitWarn = reason === 'SUPERNOVA!' && deathOrbiting ? (orbitWarnSince >= 0 ? Math.round((s.elapsed - orbitWarnSince) * 100) / 100 : -1) : null;
    const warnBeforeDeath = reason === 'SUPERNOVA!' ? (warnSince >= 0 ? Math.round((s.elapsed - warnSince) * 100) / 100 : -1) : null;
    const lateVisible = lateFrames ? Math.round((lateSeen / lateFrames) * 100) / 100 : null;
    const pickDeath = reason === 'SUPERNOVA!' && s.elapsed - lastPickAt <= 1.5 ? Math.round((s.elapsed - lastPickAt) * 100) / 100 : null;
    const pickDeath10 = !!reason && lastPickAt > 0 && s.elapsed - lastPickAt <= 10;
    // ...and of those, the ones that died crawling (< 80 km/s): the 'nothing to grab after a pick' death.
    const pickCrawlDeath = pickDeath10 && s.speed < 800;
    cruise.sort((a, b) => a - b);
    const cruiseKms = cruise.length ? Math.round(cruise[Math.floor(cruise.length / 2)] / 10) : 0;
    const slowShare = flightFrames ? slowFrames / flightFrames : 0;
    const wallLossShare = totalLoss > 0 ? Math.min(1, wallLoss / totalLoss) : 0;
    const hudShare = flightFrames ? hudFrames / flightFrames : 0;
    return { orbitWarn, hudShare, crawlCalls, crawlReach, crawlCatch, slowShare, cruiseKms, wallLossShare, pinballsAny, pickCrawlDeath, tutorialDoneAt, collapses, pinballs, wallHits: wallHits.length, pickDeath10, pickDeath, deathOrbiting, lateEta08: lateFrames ? Math.round((lateEta08 / lateFrames) * 100) / 100 : null, warnBeforeDeath, lateVisible, ownCatches: s.ownCatches || 0, minKms: kms(0), medKms: kms(0.5), maxKms: kms(1), zone: s.zoneIndex, style, reason, seconds: Math.round(frames / 60), alt: s.bestAltitude, score: Math.floor(s.score), maxSpeed: Math.round(maxSpeed), perfects, maxChain, closeCalls, warps, hits, cards: s.ownedCards.slice(), firstPickAt, minPickGap, rescues, secondWinds, milestones };
  };

  window.playtestSummary = (styles, runsEach, maxSeconds) => {
    const median = (xs) => xs.slice().sort((a, b) => a - b)[Math.floor(xs.length / 2)];
    const out = {};
    for (const style of styles) {
      const runs = Array.from({ length: runsEach }, () => window.simRun(style, maxSeconds || (style === 'expert' ? 600 : 240)));
      out[style] = {
        seconds: runs.map((r) => r.seconds).sort((a, b) => a - b).join(','),
        medianAlt: median(runs.map((r) => r.alt)),
        medianScore: median(runs.map((r) => r.score)),
        reasons: [...new Set(runs.map((r) => r.reason))].join('/'),
        maxChain: Math.max(...runs.map((r) => r.maxChain)),
        closeCalls: runs.reduce((n, r) => n + r.closeCalls, 0),
        avgCards: Math.round((runs.reduce((n, r) => n + r.cards.length, 0) / runs.length) * 10) / 10,
        medianFirstPick: median(runs.filter((r) => r.firstPickAt !== null).map((r) => r.firstPickAt)),
        rescues: runs.reduce((n, r) => n + r.rescues, 0),
        secondWinds: runs.reduce((n, r) => n + r.secondWinds, 0),
        milestones: runs.reduce((n, r) => n + r.milestones, 0),
        // Card pick spacing: earliest first pick and the shortest gap between two picks over all runs.
        minFirstPick: runs.some((r) => r.firstPickAt !== null) ? Math.min(...runs.filter((r) => r.firstPickAt !== null).map((r) => r.firstPickAt)) : null,
        minPickGap: runs.some((r) => r.minPickGap !== null) ? Math.min(...runs.filter((r) => r.minPickGap !== null).map((r) => r.minPickGap)) : null,
        reachedCard: runs.filter((r) => r.firstPickAt !== null).length + '/' + runs.length,
        reached1500: runs.filter((r) => r.alt >= 1500).length + '/' + runs.length,
        medianSeconds: median(runs.map((r) => r.seconds)),
        maxScore: Math.max(...runs.map((r) => r.score)),
        maxAlt: Math.max(...runs.map((r) => r.alt)),
        // Top speed in km/s (the readout): median and best run.
        medianTopKms: Math.round(median(runs.map((r) => r.maxSpeed)) / 10),
        maxTopKms: Math.round(Math.max(...runs.map((r) => r.maxSpeed)) / 10),
        // Speed readout over the runs (km/s): lowest, median-of-medians and highest seen.
        speedKms: Math.min(...runs.map((r) => r.minKms)) + '/' + median(runs.map((r) => r.medKms)) + '/' + Math.max(...runs.map((r) => r.maxKms)),
        died60: runs.filter((r) => r.reason && r.seconds <= 60).length + '/' + runs.length,
        maxZone: Math.max(...runs.map((r) => r.zone)),
        reached500: runs.filter((r) => r.alt >= 500).length + '/' + runs.length,
        reached40k: runs.filter((r) => r.alt >= 40000).length + '/' + runs.length,
        diedBefore6: runs.filter((r) => r.reason && r.seconds < 6).length,
        // Supernova deaths: the shortest time the eta warning was up before one (-1 = a death with no warning).
        minWarnBeforeDeath: runs.some((r) => r.warnBeforeDeath !== null) ? Math.min(...runs.filter((r) => r.warnBeforeDeath !== null).map((r) => (r.warnBeforeDeath < 0 ? -1 : r.warnBeforeDeath))) : null,
        lateVisible: median(runs.filter((r) => r.lateVisible !== null).map((r) => r.lateVisible)),
        lateEta08: median(runs.filter((r) => r.lateEta08 !== null).map((r) => r.lateEta08)),
        orbitWarnMin: runs.some((r) => r.orbitWarn !== null) ? Math.min(...runs.filter((r) => r.orbitWarn !== null).map((r) => r.orbitWarn)) : null,
        orbitWarnMed: runs.some((r) => r.orbitWarn !== null) ? median(runs.filter((r) => r.orbitWarn !== null).map((r) => r.orbitWarn)) : null,
        orbitWarnList: runs.filter((r) => r.orbitWarn !== null).map((r) => r.orbitWarn).sort((a, b) => a - b).join(','),
        warnList: runs.filter((r) => r.warnBeforeDeath !== null).map((r) => r.warnBeforeDeath).sort((a, b) => a - b).join(','),
        pickDeaths: runs.filter((r) => r.pickDeath !== null).length,
        // Deaths within 10 s after a card pick, speed collapses and wall pinball bursts (totals over the runs).
        pickDeaths10: runs.filter((r) => r.pickDeath10).length,
        pickCrawlDeaths: runs.filter((r) => r.pickCrawlDeath).length,
        // First runs: how many finished the guided tutorial, and the median run s it took.
        tutorialDone: runs.filter((r) => r.tutorialDoneAt !== null).length + '/' + runs.length,
        tutorialAt: median(runs.filter((r) => r.tutorialDoneAt !== null).map((r) => r.tutorialDoneAt)),
        collapses: runs.reduce((n, r) => n + r.collapses, 0),
        pinballs: runs.reduce((n, r) => n + r.pinballs, 0),
        pinballsAny: runs.reduce((n, r) => n + r.pinballsAny, 0),
        wallHits: runs.reduce((n, r) => n + r.wallHits, 0),
        orbitDeaths: runs.filter((r) => r.reason && r.deathOrbiting).length + '/' + runs.filter((r) => r.reason).length,
        // Crawl / wall metrics: median share of time below 60 km/s, median free-flight (cruise) km/s,
        // side-wall hits per minute of play, and the median share of all speed lost that went to the walls.
        // Crawl rescues called / with a planet in reach within 1.2 s / caught within 2 s (totals).
        crawlRescue: ['crawlCalls', 'crawlReach', 'crawlCatch'].map((k) => runs.reduce((n, r) => n + r[k], 0)).join('/'),
        hudShare: Math.round(median(runs.map((r) => r.hudShare)) * 100) / 100,
        slowShare: Math.round(median(runs.map((r) => r.slowShare)) * 100) / 100,
        cruiseKms: median(runs.map((r) => r.cruiseKms)),
        wallHitsPerMin: Math.round((runs.reduce((n, r) => n + r.wallHits, 0) / Math.max(1 / 60, runs.reduce((n, r) => n + r.seconds, 0) / 60)) * 10) / 10,
        wallLossPct: Math.round(median(runs.map((r) => r.wallLossShare)) * 100),
        alts: runs.map((r) => r.alt).sort((a, b) => a - b).join(','),
      };
    }
    // Leave the game as a player would find it: no headless Game scene left running in the background.
    game.scene.stop('Game');
    game.scene.start('Menu');
    step();
    return out;
  };

  // Balance targets in one call (see PROGRESS.md for the numbers they must hit). groups: any of 'normal'
  // (fresh starts), 'late9k' (9000 m, full speed, Wall Kick + Aerodynamic + 3 random cards), 'late9kNoCards'
  // (9000 m, 300 km/s, no cards), 'long' (600 s cap); only: limit to these styles. Returns compact rows.
  window.playtestTargets = (runsEach, groups, only) => {
    const n = runsEach || 30;
    const out = {};
    const keys = ['medianSeconds', 'seconds', 'reached500', 'reached40k', 'died60', 'wallHitsPerMin', 'pinballs', 'collapses', 'crawlRescue', 'medianAlt', 'orbitWarnMin', 'orbitWarnMed', 'minWarnBeforeDeath', 'minFirstPick', 'minPickGap'];
    const run = (name, styles, max, start) => {
      if (groups && groups.indexOf(name) < 0) return;
      const list = only ? styles.filter((st) => only.indexOf(st) >= 0) : styles;
      if (!list.length) return;
      if (start) window.simStart = start; else delete window.simStart;
      try {
        const r = window.playtestSummary(list, n, max);
        list.forEach((st) => { const o = {}; keys.forEach((k) => { o[k] = r[st][k]; }); out[name + ':' + st] = o; });
      } finally { delete window.simStart; }
    };
    run('normal', ['rhythmFast', 'idle', 'newbie', 'confused', 'mid', 'careful', 'masher', 'instant', 'random', 'humanLike']);
    run('late9k', ['instant', 'masher', 'rhythmFast', 'pinball', 'humanLike'], 240, { altitude: 9000, speed: 8000, cards: ['wallkick', 'aero'], randomCards: 3, seconds: 75 });
    run('late15k', ['instant', 'masher', 'rhythmFast', 'pinball', 'humanLike'], 240, { altitude: 15000, speed: 8000, cards: ['wallkick', 'aero'], randomCards: 3, seconds: 125 });
    run('late9kNoCards', ['instant', 'masher'], 240, { altitude: 9000, speed: 3000 });
    run('long', ['anyAssist', 'expert'], 600);
    return out;
  };
})();
