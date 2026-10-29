// Browser-side playtest simulator (not shipped). Runs the real game logic without rendering,
// so it is fast and works even when the tab is hidden. In the running game page:
//   eval(await (await fetch('tests/playtest-bot.js', { cache: 'no-store' })).text())
//   playtestSummary(['random', 'careful', 'skilled'], 10)
// Styles: random = releases at a random time (confused new player), careful = releases on the
// first green aim, skilled = waits for the gold PERFECT window (gives up after 2.5s), idle = never touches.
(() => {
  let clock = performance.now();
  const step = () => { clock += 16.67; game.scene.update(clock, 16.67); };

  window.simRun = (style, maxSeconds) => {
    ['Menu', 'GameOver', 'Game'].forEach((k) => game.scene.stop(k));
    game.scene.start('Game');
    for (let i = 0; i < 5; i++) step();
    const s = game.scene.keys.Game;
    const proto = Object.getPrototypeOf(s);
    let reason = null;
    let perfects = 0;
    let warps = 0;
    let hits = 0;
    s.gameOver = function (r) { reason = r; return proto.gameOver.call(this, r); };
    s.popText = function (label, color) {
      if (label === 'PERFECT!') perfects++;
      if (label === 'WARP!') warps++;
      if (label.startsWith('-')) hits++;
      return proto.popText.call(this, label, color);
    };
    let left = null;
    let held = 0;
    let releaseAfter = 0;
    let maxSpeed = 0;
    let frames = 0;
    while (!s.isOver && frames < maxSeconds * 60) {
      frames++;
      if (!s.orbit) {
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
    delete s.gameOver;
    delete s.popText;
    return { style, reason, seconds: Math.round(frames / 60), alt: s.bestAltitude, score: Math.floor(s.score), maxSpeed: Math.round(maxSpeed), perfects, warps, hits };
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
      };
    }
    return out;
  };
})();
