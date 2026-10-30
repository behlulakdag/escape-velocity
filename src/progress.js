// Meta progression: missions, coins, comet skins, card discovery journal and the best-run ghost.
// Pure logic, free of Phaser, so node can unit-test it (tests/progress.test.js).
//
// Everything lives under ONE versioned localStorage key. Storage can be blocked (private tab,
// itch iframe with cookies off) or hold garbage: every access is wrapped in try/catch and the
// in-memory state keeps working for the session either way.
//
// A run only changes saved progress in endRun(). startRun()/report() just collect run stats, so
// the headless playtest sim (which never calls endRun) can report freely without touching saves.
//
// Speed values are the HUD readout (km/s = px/s / 10), passed as integers.

const PROGRESS_STORAGE_KEY = 'escape_velocity_progress_v1';
const PROGRESS_VERSION = 1;
const PROGRESS_ACTIVE_SLOTS = 3;

// Ghost: ~10 points per second, at most 600 points (a 60 s run at full rate; longer runs are thinned).
const GHOST_MIN_STEP = 0.1;
const GHOST_MAX_POINTS = 600;

// Zone start altitudes (meters), same as ZONES[i].from in orbit.js (a test keeps them in sync).
const PROGRESS_ZONE_FROM = [0, 500, 1500, 3000, 5000, 8000];

const MISSION_REWARDS = { 1: 25, 2: 50, 3: 100, 4: 150 };

// stat: which run stat (or lifetime total) the mission measures.
// kind 'run' = must happen within one run; 'total' = counts up across runs from when it became active.
// The pool is ordered easy -> hard; the 3 active slots are always the first unfinished missions.
const MISSION_POOL = [
  { id: 'catch5', tier: 1, kind: 'run', stat: 'catches', goal: 5, text: 'Catch 5 planets in one run' },
  { id: 'speed150', tier: 1, kind: 'run', stat: 'topSpeed', goal: 150, text: 'Reach 150 km/s' },
  { id: 'orbit', tier: 1, kind: 'run', stat: 'altitude', goal: 500, text: 'Reach ORBIT' },
  { id: 'combo3', tier: 1, kind: 'run', stat: 'maxChain', goal: 3, text: 'Get a 3 combo' },
  { id: 'catch50', tier: 1, kind: 'total', stat: 'catches', goal: 50, text: 'Catch 50 planets total' },
  { id: 'hypersonic', tier: 2, kind: 'run', stat: 'altitude', goal: 1500, text: 'Reach HYPERSONIC' },
  { id: 'speed300', tier: 2, kind: 'run', stat: 'topSpeed', goal: 300, text: 'Reach 300 km/s' },
  { id: 'cards3', tier: 2, kind: 'run', stat: 'cards', goal: 3, text: 'Pick 3 cards in one run' },
  { id: 'combo5', tier: 2, kind: 'run', stat: 'maxChain', goal: 5, text: 'Get a 5 combo' },
  { id: 'closecall', tier: 2, kind: 'run', stat: 'closeCalls', goal: 1, text: 'Survive a close call' },
  { id: 'perfect25', tier: 2, kind: 'total', stat: 'perfects', goal: 25, text: 'Hit 25 PERFECTs total' },
  { id: 'secondwind', tier: 2, kind: 'run', stat: 'secondWinds', goal: 1, text: 'Get a SECOND WIND' },
  { id: 'warp', tier: 3, kind: 'run', stat: 'altitude', goal: 3000, text: 'Reach WARP SPEED' },
  { id: 'blackhole', tier: 3, kind: 'run', stat: 'warps', goal: 1, text: 'Fly through a black hole' },
  { id: 'setbonus', tier: 3, kind: 'run', stat: 'setBonuses', goal: 1, text: 'Complete a set bonus' },
  { id: 'combo10', tier: 3, kind: 'run', stat: 'maxChain', goal: 10, text: 'Get a 10 combo' },
  { id: 'speed450', tier: 3, kind: 'run', stat: 'topSpeed', goal: 450, text: 'Reach 450 km/s' },
  { id: 'beatbest', tier: 3, kind: 'run', stat: 'beatBest', goal: 1, text: 'Beat your best altitude' },
  { id: 'wallkick3', tier: 3, kind: 'total', stat: 'wallKicks', goal: 3, text: 'Wall Kick 3 times' },
  { id: 'hyperspace', tier: 4, kind: 'run', stat: 'altitude', goal: 5000, text: 'Reach HYPERSPACE' },
  { id: 'speed600', tier: 4, kind: 'run', stat: 'topSpeed', goal: 600, text: 'Reach 600 km/s' },
  { id: 'combo25', tier: 4, kind: 'run', stat: 'maxChain', goal: 25, text: 'Get a 25 combo' },
  { id: 'escape', tier: 4, kind: 'run', stat: 'altitude', goal: 8000, text: 'Reach ESCAPE VELOCITY' },
  { id: 'climb50k', tier: 4, kind: 'total', stat: 'altitude', goal: 50000, text: 'Climb 50,000 m total' },
];

// Crayon color sets for the comet. head = head fill, flame = crown + hatching, trail = outer tail
// strands. outline (optional) replaces the pen ink on the head; detail names a small doodle the
// art may add (null = none). Heads stay light so the dark face lines always read.
const SKINS = [
  { id: 'classic', name: 'Classic', price: 0, detail: null,
    colors: { head: 0xffd23f, flame: 0xf5862a, trail: 0xd8432c } },
  { id: 'ice', name: 'Ice', price: 100, detail: 'frost',
    colors: { head: 0xc6ecff, flame: 0x7cc4f2, trail: 0x4f8fe0 } },
  { id: 'ink', name: 'Ink', price: 150, detail: 'splat',
    colors: { head: 0xf4ead0, flame: 0xa9a3bd, trail: 0x8a84a6 } },
  { id: 'toxic', name: 'Toxic', price: 200, detail: 'drips',
    colors: { head: 0xd4f27a, flame: 0x9ad845, trail: 0x5cc23c } },
  { id: 'rainbow', name: 'Rainbow', price: 300, detail: 'stripes',
    colors: { head: 0xffe9a8, flame: 0xe88fb4, trail: 0x9a7ae0,
      stripes: [0xe5533d, 0xf28c38, 0xf7c948, 0x8fd16a, 0x8cc3e8, 0xb48ad8] } },
  { id: 'gold', name: 'Gold', price: 450, detail: 'star',
    colors: { head: 0xffe36e, flame: 0xe8a82a, trail: 0xc98a2c, outline: 0x5a3a10 } },
  { id: 'supernova', name: 'Supernova', price: 600, detail: 'flare',
    colors: { head: 0xfff1d6, flame: 0xff7a3c, trail: 0xe0457a } },
];

const PROGRESS_DEFAULT_SKIN = 'classic';

function progressMissionDef(id) {
  for (const m of MISSION_POOL) if (m.id === id) return m;
  return null;
}

function progressSkinDef(id) {
  for (const s of SKINS) if (s.id === id) return s;
  return null;
}

// Card ids from cards.js when it is loaded (browser global or node require); null = accept any string.
function progressKnownCardIds() {
  try {
    if (typeof CARDS !== 'undefined' && Array.isArray(CARDS)) return CARDS.map((c) => c.id);
  } catch (e) { /* not loaded */ }
  try {
    if (typeof require === 'function') return require('./cards.js').CARDS.map((c) => c.id);
  } catch (e) { /* not available */ }
  return null;
}

function progressDefaultState() {
  return {
    v: PROGRESS_VERSION,
    coins: 0,
    owned: [PROGRESS_DEFAULT_SKIN],
    equipped: PROGRESS_DEFAULT_SKIN,
    active: [],          // [{ id, best, count }]: best = best single-run value, count = total since active
    completed: [],       // mission ids finished in the current pass through the pool
    loops: 0,            // full passes through the pool (missions repeat after the last one)
    totals: { runs: 0, catches: 0, perfects: 0, altitude: 0, wallKicks: 0 },
    discovered: [],
    bestAltitude: 0,
    ghost: null,         // { altitude, points: [[t, x, y], ...] }
  };
}

const progressFiniteOr = (v, d) => (typeof v === 'number' && isFinite(v) ? v : d);
const progressIdList = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []);

// Takes whatever was parsed from storage and returns a valid state (bad fields fall back to defaults).
function progressSanitize(raw) {
  const s = progressDefaultState();
  if (!raw || typeof raw !== 'object' || raw.v !== PROGRESS_VERSION) return s;
  s.coins = Math.max(0, Math.floor(progressFiniteOr(raw.coins, 0)));
  s.owned = progressIdList(raw.owned).filter((id) => progressSkinDef(id));
  if (s.owned.indexOf(PROGRESS_DEFAULT_SKIN) < 0) s.owned.unshift(PROGRESS_DEFAULT_SKIN);
  s.equipped = s.owned.indexOf(raw.equipped) >= 0 ? raw.equipped : PROGRESS_DEFAULT_SKIN;
  s.completed = progressIdList(raw.completed).filter((id) => progressMissionDef(id));
  s.loops = Math.max(0, Math.floor(progressFiniteOr(raw.loops, 0)));
  const seen = {};
  for (const a of Array.isArray(raw.active) ? raw.active : []) {
    if (!a || !progressMissionDef(a.id) || seen[a.id] || s.completed.indexOf(a.id) >= 0) continue;
    seen[a.id] = true;
    s.active.push({ id: a.id, best: Math.max(0, progressFiniteOr(a.best, 0)), count: Math.max(0, progressFiniteOr(a.count, 0)) });
    if (s.active.length >= PROGRESS_ACTIVE_SLOTS) break;
  }
  const t = raw.totals && typeof raw.totals === 'object' ? raw.totals : {};
  for (const k of Object.keys(s.totals)) s.totals[k] = Math.max(0, progressFiniteOr(t[k], 0));
  const known = progressKnownCardIds();
  s.discovered = progressIdList(raw.discovered).filter((id, i, arr) => arr.indexOf(id) === i && (!known || known.indexOf(id) >= 0));
  s.bestAltitude = Math.max(0, progressFiniteOr(raw.bestAltitude, 0));
  const g = raw.ghost;
  if (g && Array.isArray(g.points) && g.points.length >= 2) {
    const pts = g.points.filter((p) => Array.isArray(p) && p.length === 3 && p.every((n) => typeof n === 'number' && isFinite(n)));
    if (pts.length >= 2) s.ghost = { altitude: Math.max(0, progressFiniteOr(g.altitude, 0)), points: pts.slice(0, GHOST_MAX_POINTS) };
  }
  return s;
}

// Keeps a point at most every GHOST_MIN_STEP seconds, then thins evenly to GHOST_MAX_POINTS
// (first and last kept). Returns compact [t, x, y] triples rounded to 0.01 s / 0.1 px.
function progressDownsampleGhost(points) {
  if (!Array.isArray(points)) return [];
  const clean = points.filter((p) => p && [p.t, p.x, p.y].every((n) => typeof n === 'number' && isFinite(n)))
    .slice().sort((a, b) => a.t - b.t);
  if (clean.length < 2) return [];
  const spaced = [clean[0]];
  for (let i = 1; i < clean.length; i++) {
    if (clean[i].t - spaced[spaced.length - 1].t >= GHOST_MIN_STEP - 1e-9) spaced.push(clean[i]);
  }
  const last = clean[clean.length - 1];
  if (spaced[spaced.length - 1] !== last) {
    // Keep the true end of the run; replace the last kept point if it is too close.
    if (spaced.length > 1 && last.t - spaced[spaced.length - 1].t < GHOST_MIN_STEP * 0.5) spaced.pop();
    spaced.push(last);
  }
  let out = spaced;
  if (out.length > GHOST_MAX_POINTS) {
    const thin = [];
    const stepF = (out.length - 1) / (GHOST_MAX_POINTS - 1);
    for (let i = 0; i < GHOST_MAX_POINTS; i++) thin.push(out[Math.round(i * stepF)]);
    out = thin;
  }
  const r = (n, k) => Math.round(n * k) / k;
  return out.map((p) => [r(p.t, 100), r(p.x, 10), r(p.y, 10)]);
}

// Builds a PROGRESS object over a storage-like backend ({ getItem, setItem }); null = no storage.
// The game uses the global PROGRESS (window.localStorage); tests make their own with fakes.
function createProgress(storageGetter) {
  const getStorage = () => {
    try { return storageGetter ? storageGetter() : null; } catch (e) { return null; }
  };
  let state = progressDefaultState();
  let run = null;          // stats of the run in progress (null between runs)
  let pendingCards = [];   // cards discovered during the run, committed in endRun

  function fillActive() {
    let guard = 0;
    while (state.active.length < PROGRESS_ACTIVE_SLOTS && guard++ < MISSION_POOL.length * 3) {
      const taken = (id) => state.completed.indexOf(id) >= 0 || state.active.some((a) => a.id === id);
      const next = MISSION_POOL.find((m) => !taken(m.id));
      if (next) {
        state.active.push({ id: next.id, best: 0, count: 0 });
        continue;
      }
      // Whole pool done: start the next pass (missions still active stay active).
      if (state.completed.length === 0) break;
      state.completed = [];
      state.loops++;
    }
  }

  function freshRunStats() {
    return { catches: 0, perfects: 0, maxChain: 0, altitude: 0, topSpeed: 0, cards: 0, cardIds: [],
      setBonuses: 0, closeCalls: 0, wallKicks: 0, warps: 0, secondWinds: 0, beatBest: 0, zone: 0 };
  }

  // Current value of a mission: within this run (if one is going) or its saved best/total.
  function missionValue(entry, def, stats) {
    if (def.kind === 'total') return entry.count + (stats ? stats[def.stat] || 0 : 0);
    return Math.max(entry.best, stats ? stats[def.stat] || 0 : 0);
  }

  function missionView(entry, stats) {
    const def = progressMissionDef(entry.id);
    const value = missionValue(entry, def, stats);
    return { id: def.id, text: def.text, tier: def.tier, kind: def.kind, progress: Math.min(def.goal, Math.floor(value)),
      goal: def.goal, done: value >= def.goal, reward: MISSION_REWARDS[def.tier] };
  }

  const api = {
    STORAGE_KEY: PROGRESS_STORAGE_KEY,
    MISSION_POOL,
    SKINS,
    GHOST_MAX_POINTS,

    load() {
      let raw = null;
      const store = getStorage();
      if (store) {
        try {
          const text = store.getItem(PROGRESS_STORAGE_KEY);
          raw = text ? JSON.parse(text) : null;
        } catch (e) { raw = null; }   // blocked or corrupt JSON: start fresh
      }
      state = progressSanitize(raw);
      fillActive();
      return api;
    },

    save() {
      const store = getStorage();
      if (!store) return false;
      try {
        store.setItem(PROGRESS_STORAGE_KEY, JSON.stringify(state));
        return true;
      } catch (e) { return false; }   // blocked or full: the session keeps its in-memory state
    },

    activeMissions() {
      return state.active.map((a) => missionView(a, run));
    },

    startRun() {
      run = freshRunStats();
      run.prevBest = state.bestAltitude;
      pendingCards = [];
    },

    // Cheap and safe to call every frame-ish; unknown events and calls outside a run are ignored.
    report(event, value) {
      if (event === 'cardOffered') { api.discoverCards(value); return; }
      if (!run) return;
      const n = typeof value === 'number' && isFinite(value) ? value : 0;
      switch (event) {
        case 'catch': run.catches++; break;
        case 'perfect': run.perfects++; run.maxChain = Math.max(run.maxChain, n || 1); break;
        case 'milestone': break;   // chain milestone level: chains are tracked through 'perfect'
        case 'zone': run.zone = Math.max(run.zone, n); run.altitude = Math.max(run.altitude, PROGRESS_ZONE_FROM[n] || 0); break;
        case 'speed': run.topSpeed = Math.max(run.topSpeed, Math.floor(n)); break;
        case 'altitude':
          run.altitude = Math.max(run.altitude, n);
          if (run.prevBest > 0 ? run.altitude > run.prevBest : run.altitude > 0) run.beatBest = 1;
          break;
        case 'card':
          if (typeof value === 'string' && run.cardIds.indexOf(value) < 0) { run.cardIds.push(value); run.cards = run.cardIds.length; }
          api.discoverCards([value]);
          break;
        case 'setbonus': run.setBonuses++; break;
        case 'closecall': run.closeCalls++; break;
        case 'wallkick': run.wallKicks++; break;
        case 'warp': run.warps++; break;
        case 'secondwind': run.secondWinds++; break;
        default: break;
      }
    },

    // Commits the run: mission progress, rewards, replacements, totals, discoveries, best altitude.
    endRun(summary) {
      const sum = summary || {};
      if (!run) api.startRun();
      const stats = run;
      // The summary is the source of truth for maxima, in case an event was missed.
      stats.altitude = Math.max(stats.altitude, progressFiniteOr(sum.altitude, 0));
      stats.topSpeed = Math.max(stats.topSpeed, Math.floor(progressFiniteOr(sum.topSpeedKmh, 0)));
      stats.maxChain = Math.max(stats.maxChain, progressFiniteOr(sum.maxChain, 0));
      const zone = progressFiniteOr(sum.zoneIndex, 0);
      stats.altitude = Math.max(stats.altitude, PROGRESS_ZONE_FROM[zone] || 0);
      if (Array.isArray(sum.cards)) {
        for (const id of sum.cards) if (typeof id === 'string' && stats.cardIds.indexOf(id) < 0) stats.cardIds.push(id);
        stats.cards = Math.max(stats.cards, stats.cardIds.length);
        api.discoverCards(sum.cards);
      } else if (typeof sum.cards === 'number') {
        stats.cards = Math.max(stats.cards, sum.cards);
      }
      const newBest = stats.altitude > state.bestAltitude;
      if (stats.prevBest > 0 ? stats.altitude > stats.prevBest : stats.altitude > 0) stats.beatBest = 1;

      const completed = [];
      let coinsEarned = 0;
      for (const entry of state.active) {
        const def = progressMissionDef(entry.id);
        if (def.kind === 'total') entry.count += stats[def.stat] || 0;
        else entry.best = Math.max(entry.best, stats[def.stat] || 0);
        const view = missionView(entry, null);
        if (view.done) {
          completed.push(view);
          coinsEarned += view.reward;
        }
      }
      const doneIds = completed.map((m) => m.id);
      state.active = state.active.filter((a) => doneIds.indexOf(a.id) < 0);
      for (const id of doneIds) if (state.completed.indexOf(id) < 0) state.completed.push(id);
      const before = state.active.map((a) => a.id);
      fillActive();
      const newMissions = state.active.filter((a) => before.indexOf(a.id) < 0).map((a) => missionView(a, null));

      state.coins += coinsEarned;
      state.totals.runs++;
      state.totals.catches += stats.catches;
      state.totals.perfects += stats.perfects;
      state.totals.altitude += Math.max(0, stats.altitude);
      state.totals.wallKicks += stats.wallKicks;
      if (newBest) state.bestAltitude = stats.altitude;

      const newlyDiscovered = pendingCards.filter((id) => state.discovered.indexOf(id) < 0);
      for (const id of newlyDiscovered) state.discovered.push(id);
      pendingCards = [];
      run = null;
      api.save();
      return { completed, coinsEarned, coinsTotal: state.coins, newMissions, newlyDiscovered, newBest };
    },

    coins() { return state.coins; },

    skins() {
      return SKINS.map((s) => ({ id: s.id, name: s.name, price: s.price, detail: s.detail,
        owned: state.owned.indexOf(s.id) >= 0, equipped: state.equipped === s.id, colors: Object.assign({}, s.colors) }));
    },

    // Spends coins on a skin. false when unknown, already owned or too expensive.
    buySkin(id) {
      const def = progressSkinDef(id);
      if (!def || state.owned.indexOf(id) >= 0 || state.coins < def.price) return false;
      state.coins -= def.price;
      state.owned.push(id);
      api.save();
      return true;
    },

    // Only owned skins can be worn. Returns whether the skin is now equipped.
    equipSkin(id) {
      if (state.owned.indexOf(id) < 0) return false;
      state.equipped = id;
      api.save();
      return true;
    },

    equippedSkin() {
      return api.skins().find((s) => s.equipped) || api.skins()[0];
    },

    // Saved discoveries (cards found in the run in progress appear after endRun).
    discovered() { return state.discovered.slice(); },

    // Marks cards as found. Inside a run they wait for endRun (so headless sims never save);
    // outside a run they are saved at once.
    discoverCards(ids) {
      const list = Array.isArray(ids) ? ids : [ids];
      const known = progressKnownCardIds();
      let changed = false;
      for (const id of list) {
        if (typeof id !== 'string' || (known && known.indexOf(id) < 0)) continue;
        if (state.discovered.indexOf(id) >= 0 || pendingCards.indexOf(id) >= 0) continue;
        if (run) pendingCards.push(id);
        else { state.discovered.push(id); changed = true; }
      }
      if (changed) api.save();
    },

    bestAltitude() { return state.bestAltitude; },

    // Stores the ghost of a best run. points: [{t, x, y}] in world coords, t = seconds since launch.
    // altitude (optional): refused when lower than the ghost already kept, so only the best survives.
    saveGhost(points, altitude) {
      const alt = progressFiniteOr(altitude, null);
      if (alt !== null && state.ghost && alt < state.ghost.altitude) return false;
      const compact = progressDownsampleGhost(points);
      if (compact.length < 2) return false;
      state.ghost = { altitude: alt !== null ? alt : state.bestAltitude, points: compact };
      api.save();
      return true;
    },

    loadGhost() {
      if (!state.ghost) return null;
      return state.ghost.points.map((p) => ({ t: p[0], x: p[1], y: p[2] }));
    },

    // Test/debug helper: forget everything (also in storage).
    reset() {
      state = progressDefaultState();
      run = null;
      pendingCards = [];
      fillActive();
      api.save();
    },
  };
  state = progressDefaultState();
  fillActive();
  return api;
}

const PROGRESS = createProgress(() => (typeof localStorage !== 'undefined' ? localStorage : null));
PROGRESS.load();

if (typeof module !== 'undefined') {
  module.exports = { PROGRESS, createProgress, MISSION_POOL, MISSION_REWARDS, SKINS, PROGRESS_STORAGE_KEY,
    PROGRESS_ZONE_FROM, GHOST_MAX_POINTS, GHOST_MIN_STEP, progressDownsampleGhost, progressSanitize };
}
