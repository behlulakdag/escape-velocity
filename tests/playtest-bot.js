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
// Upgrade cards: on every zone entry the headless scene picks a random card at once (reported as cards / avgCards).
// Late start: window.simStart = { altitude: 9000, speed: 8000, cards: ['wallkick', 'aero'], randomCards: 3,
//   seconds: 75 } teleports every fresh run to that state (GameScene.debugTeleport: best altitude, comet,
//   camera, planets, page, supernova just below the screen, cards picked via pickCard; seconds = run time,
//   default altitude / 120) so late-game balance is measured fast. delete window.simStart to go back.
// Speed readout: every run reports minKms / medKms / maxKms (km/s, sampled after the first second).
// playtestSummary(styles, runsEach, maxSeconds) - maxSeconds defaults to 600 for expert, 240 otherwise.
(() => {
  let clock = performance.now();
  const step = () => { clock += 16.67; game.scene.update(clock, 16.67); };

  window.simRun = (style, maxSeconds) => {
    ['Menu', 'GameOver', 'Game'].forEach((k) => game.scene.stop(k));
    // headless: skips the opening scene, hitstop, slow motion and best-altitude saves.
    game.scene.start('Game', { headless: true });
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
    let rescues = 0;
    s.pickCard = function (id) {
      if (firstPickAt === null) firstPickAt = Math.round(this.elapsed * 10) / 10;
      return proto.pickCard.call(this, id);
    };
    s.rescueFromNova = function () { rescues++; return proto.rescueFromNova.call(this); };
    s.secondWind = function () { secondWinds++; return proto.secondWind.call(this); };
    s.chainMilestone = function (level) { milestones++; return proto.chainMilestone.call(this, level); };
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
      if (label.startsWith('-')) hits++;
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
    while (!s.isOver && frames < maxSeconds * 60) {
      frames++;
      if (style === 'masher') {
        if (s.isHolding) {
          mashHold -= 16.67;
          if (mashHold <= 0) { s.releaseHold(); mashGap = 60 + Math.random() * 640; }
        } else {
          mashGap -= 16.67;
          if (mashGap <= 0) { s.pressHold(); mashHold = 80 + Math.random() * 820; }
        }
      } else if (style === 'holder') {
        s.isHolding = true;
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
          : style === 'expert' ? (assist && assist.angle < 0.55 * s.perfectAngle() && held > 150)
            || (assist && (novaGap < 280 || held > expertPatience)) || held > expertPatience + 1500
          : style === 'skilled' ? (assist && assist.angle < TUNING.perfectAngle && held > 200) || held > 2500
          : held > releaseAfter;
        if (release) s.releaseHold();
      }
      step();
      maxSpeed = Math.max(maxSpeed, s.speed);
      if (frames > 60) speeds.push(s.speed);
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
    speeds.sort((a, b) => a - b);
    const kms = (q) => (speeds.length ? Math.round(speeds[Math.floor(q * (speeds.length - 1))] / 10) : 0);
    return { minKms: kms(0), medKms: kms(0.5), maxKms: kms(1), zone: s.zoneIndex, style, reason, seconds: Math.round(frames / 60), alt: s.bestAltitude, score: Math.floor(s.score), maxSpeed: Math.round(maxSpeed), perfects, maxChain, closeCalls, warps, hits, cards: s.ownedCards.slice(), firstPickAt, rescues, secondWinds, milestones };
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
      };
    }
    // Leave the game as a player would find it: no headless Game scene left running in the background.
    game.scene.stop('Game');
    game.scene.start('Menu');
    step();
    return out;
  };
})();
