// Browser-side playtest simulator (not shipped). Runs the real game logic without rendering,
// so it is fast and works even when the tab is hidden. In the running game page:
//   eval(await (await fetch('tests/playtest-bot.js', { cache: 'no-store' })).text())
//   playtestSummary(['random', 'careful', 'skilled'], 10)
// Styles: random = releases at a random time (confused new player), careful = releases on the
// first green aim, skilled = waits for the gold PERFECT window (gives up after 2.5s), idle = never touches,
// holder = holds the whole run and never lets go (panic player; overspeed flings it on).
// Upgrade cards: on every zone entry the headless scene picks a random card at once (reported as cards / avgCards).
(() => {
  let clock = performance.now();
  const step = () => { clock += 16.67; game.scene.update(clock, 16.67); };

  window.simRun = (style, maxSeconds) => {
    ['Menu', 'GameOver', 'Game'].forEach((k) => game.scene.stop(k));
    // headless: skips the opening scene, hitstop, slow motion and best-altitude saves.
    game.scene.start('Game', { headless: true });
    for (let i = 0; i < 5; i++) step();
    const s = game.scene.keys.Game;
    const proto = Object.getPrototypeOf(s);
    let reason = null;
    let perfects = 0;
    let warps = 0;
    let hits = 0;
    let closeCalls = 0;
    let maxChain = 0;
    s.gameOver = function (r) { reason = r; return proto.gameOver.call(this, r); };
    // Headless GameScene picks a random card itself on zone entry (no CardScene); log when.
    let firstPickAt = null;
    let rescues = 0;
    s.pickCard = function (id) {
      if (firstPickAt === null) firstPickAt = Math.round(this.elapsed * 10) / 10;
      return proto.pickCard.call(this, id);
    };
    s.rescueFromNova = function () { rescues++; return proto.rescueFromNova.call(this); };
    // window.simNoCards = true runs the base game without cards, for comparison.
    if (window.simNoCards) s.openCardPick = function () {};
    s.popText = function (label, color, opts) {
      if (label.startsWith('PERFECT')) perfects++;
      if (label === 'CLOSE CALL!') closeCalls++;
      maxChain = Math.max(maxChain, this.perfectChain);
      if (label === 'WARP!') warps++;
      if (label.startsWith('-')) hits++;
      return proto.popText.call(this, label, color, opts);
    };
    let left = null;
    let held = 0;
    let releaseAfter = 0;
    let maxSpeed = 0;
    let frames = 0;
    while (!s.isOver && frames < maxSeconds * 60) {
      frames++;
      if (style === 'holder') {
        s.isHolding = true;
      } else if (!s.orbit) {
        const p = s.nearestGrabbablePlanet();
        s.isHolding = style !== 'idle' && !!(p && p !== left);
        held = 0;
        releaseAfter = 300 + Math.random() * 1200;
      } else {
        left = s.orbitPlanet;
        held += 16.67;
        const assist = s.currentAssist();
        const release = style === 'careful' ? assist && held > 200
          : style === 'skilled' ? (assist && assist.angle < TUNING.perfectAngle && held > 200) || held > 2500
          : held > releaseAfter;
        if (release) s.releaseHold();
      }
      step();
      maxSpeed = Math.max(maxSpeed, s.speed);
    }
    // Phaser reuses the last start data when none is passed: do not leak headless into real play.
    s.sys.settings.data = {};
    delete s.gameOver;
    delete s.popText;
    delete s.pickCard;
    delete s.rescueFromNova;
    delete s.openCardPick;
    return { style, reason, seconds: Math.round(frames / 60), alt: s.bestAltitude, score: Math.floor(s.score), maxSpeed: Math.round(maxSpeed), perfects, maxChain, closeCalls, warps, hits, cards: s.ownedCards.slice(), firstPickAt, rescues };
  };

  window.playtestSummary = (styles, runsEach) => {
    const median = (xs) => xs.slice().sort((a, b) => a - b)[Math.floor(xs.length / 2)];
    const out = {};
    for (const style of styles) {
      const runs = Array.from({ length: runsEach }, () => window.simRun(style, 240));
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
      };
    }
    // Leave the game as a player would find it: no headless Game scene left running in the background.
    game.scene.stop('Game');
    game.scene.start('Menu');
    step();
    return out;
  };
})();
