// Browser-side playtest bot (not shipped). Load in the running game page with:
//   eval(await (await fetch('tests/playtest-bot.js', { cache: 'no-store' })).text())
// then: await playtest(['careful', 'greedy', 'random'], 20)
// Styles: careful = release on the first green aim, greedy = orbit ~1.6s then wait for green,
// random = release at a random time (a confused new player).
window.botRun = (secs, style) => new Promise((resolve) => {
  ['Menu', 'GameOver', 'Game'].forEach((k) => game.scene.stop(k));
  game.scene.start('Game');
  let left = null;
  let orbitStart = 0;
  let releaseAfter = 0;
  let maxSpeed = 0;
  let reason = null;
  const t0 = performance.now();
  const finish = (s) => {
    clearInterval(timer);
    resolve({ style, reason, score: s.score, alt: s.bestAltitude, maxSpeed, seconds: Math.round((performance.now() - t0) / 1000) });
  };
  const timer = setInterval(() => {
    const s = game.scene.keys.Game;
    if (!s || !s.comet) return;
    // The Game scene object is reused across restarts, so hook once and read the reason back from it.
    if (!s.__botHooked) {
      s.__botHooked = true;
      const original = s.gameOver.bind(s);
      s.gameOver = (r) => { s.__lastReason = r; return original(r); };
    }
    if (s.__runId !== t0) { s.__runId = t0; s.__lastReason = null; }
    reason = s.__lastReason;
    maxSpeed = Math.max(maxSpeed, Math.round(s.speed));
    if (s.isOver || performance.now() - t0 > secs * 1000) return finish(s);
    if (!s.orbit) {
      const p = s.nearestGrabbablePlanet();
      s.isHolding = !!(p && p !== left);
      orbitStart = performance.now();
      releaseAfter = 300 + Math.random() * 1200;
      return;
    }
    left = s.orbitPlanet;
    const held = performance.now() - orbitStart;
    const green = !!s.currentAssist();
    const release = style === 'careful' ? green && held > 200
      : style === 'greedy' ? green && held > 1600
      : held > releaseAfter;
    if (release) s.releaseHold();
  }, 16);
});

window.playtest = async (styles, secs) => {
  const results = [];
  for (const style of styles) results.push(await window.botRun(secs, style));
  return results;
};
