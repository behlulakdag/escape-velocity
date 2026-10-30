// Roguelite upgrade cards: pure data + rules, free of Phaser so node can unit-test them.
// Every card tweaks the one verb (grab / orbit / fling / fly). GameScene reads cardMods().

const CARD_FAMILIES = {
  orbit: { name: 'ORBIT', color: 0x2ee6c8 },
  fling: { name: 'FLING', color: 0xffc93c },
  flight: { name: 'FLIGHT', color: 0x5cc8ff },
  shield: { name: 'SHIELD', color: 0xff6fb5 },
};

// Each family has one common, one rare and one legendary card.
const CARDS = [
  { id: 'well', family: 'orbit', rarity: 'common', name: 'Gravity Well', desc: 'Grab range +30%', icon: 'well' },
  { id: 'spin', family: 'orbit', rarity: 'rare', name: 'Tight Spin', desc: 'Orbits spiral in, close x1.8', icon: 'spin' },
  { id: 'overdrive', family: 'orbit', rarity: 'legendary', name: 'Overdrive', desc: 'Orbit speed gain +25%', icon: 'overdrive' },
  { id: 'perfect', family: 'fling', rarity: 'common', name: 'Wide Perfect', desc: 'Wider PERFECT window', icon: 'perfect' },
  { id: 'sling', family: 'fling', rarity: 'rare', name: 'Slingshot', desc: '+10% speed every release', icon: 'sling' },
  { id: 'chain', family: 'fling', rarity: 'legendary', name: 'Chain Reaction', desc: 'PERFECT chains add speed', icon: 'chain' },
  { id: 'aero', family: 'flight', rarity: 'common', name: 'Aerodynamic', desc: '30% less speed loss', icon: 'aero' },
  { id: 'wallkick', family: 'flight', rarity: 'rare', name: 'Wall Kick', desc: 'Aimed flings: 2 wall kicks up', icon: 'wallkick' },
  { id: 'afterburner', family: 'flight', rarity: 'legendary', name: 'Afterburner', desc: 'No speed loss after PERFECT', icon: 'afterburner' },
  { id: 'heatshield', family: 'shield', rarity: 'common', name: 'Heat Shield', desc: 'First hit each zone: free', icon: 'heatshield' },
  { id: 'armor', family: 'shield', rarity: 'rare', name: 'Tail Armor', desc: 'Smash asteroids for speed', icon: 'armor' },
  { id: 'shockwave', family: 'shield', rarity: 'legendary', name: 'Shockwave', desc: 'CLOSE CALL pushes nova back', icon: 'shockwave' },
];

// Two cards of one family unlock its set bonus.
const SET_BONUSES = {
  orbit: { name: 'ORBIT MASTER', desc: 'Speed burst on every catch' },
  fling: { name: 'SHARPSHOOTER', desc: 'Even wider PERFECT, chain x2' },
  flight: { name: 'SLIPSTREAM', desc: 'No speed loss while climbing' },
  shield: { name: 'UNBREAKABLE', desc: 'One rescue from the supernova' },
};

// Draw weight per rarity: rarer = stronger, drawn less often.
const RARITY_WEIGHT = { common: 6, rare: 3, legendary: 1.5 };

// Balance numbers in one place (all applied by GameScene through cardMods()).
const CARD_TUNING = {
  setSize: 2,                 // cards of one family needed for its set bonus
  grabRangeMul: 1.3,
  closeOrbitMul: 1.8,
  tightenSpeed: 45,           // Tight Spin: px/s the orbit spirals in toward the surface
  tightCatchBonus: 120,       // Tight Spin: px/s kick for a close catch (diving in deep before the hold)
  orbitGainMul: 1.25,
  releaseBonus: 0.1,          // Slingshot: +10% speed on every release
  perfectAngleWide: 0.18,     // rad (base TUNING.perfectAngle is 0.12)
  perfectAngleSet: 0.22,      // with Sharpshooter
  chainSpeed: 45,             // px/s per chain step after the first PERFECT (Chain Reaction)
  chainSpeedMaxSteps: 5,
  flightDecayMul: 0.7,
  afterburnerSeconds: 1,
  wallKickBonus: 110,         // px/s gained on a wall kick
  heatShieldCharges: 1,       // per zone
  armorBonus: 90,             // px/s gained by smashing an asteroid
  shockwavePush: 250,         // px the supernova is pushed down on a CLOSE CALL
  catchBurst: 110,            // Orbit Master: px/s burst on every catch
  rescues: 1,                 // Unbreakable: per run
  novaPerCard: 0.05,          // every card picked makes the supernova 5% faster...
  pickNovaEase: 10,           // ...the newest card's share easing in over this many s after its pick (the
                              // full +5% at once made the wave feel like the pick's fault: deaths 5-10 s later)
  // When a pick may open (see cardPickReady) and what it costs the player.
  pickNovaHold: 1.5,          // real s the supernova holds still after a pick (on top of the slow-motion ease)
  firstRunPickMeters: 1500,   // tutorial run 1: the first pick waits for HYPERSONIC...
  firstRunPickSeconds: 25,    // ...and 25 s into the run, whichever is later
  pickGap: 4,                 // real s between two queued picks
  procPopsPerRun: 2,          // a card's proc pop (SLINGSHOT!, WALL KICK!...) is written this many times per run
};

// Whether a card's proc pop is written out (shownBefore = times it was already written this run); after
// procPopsPerRun times only the card's icon flash and a small ink asterisk mark it (no repeating words).
function cardProcPopAllowed(shownBefore) {
  return (shownBefore || 0) < CARD_TUNING.procPopsPerRun;
}

// Whether a queued card pick may open now. A pick opened mid-orbit leaves the comet spinning with no
// finger and no prompt, and the down swing feeds it to the wave, so picks only open in free flight while
// climbing. firstRun (tutorial run 1): not before firstRunPickMeters AND firstRunPickSeconds.
// st = { orbiting, scraping, vy (px/s, - = up), firstRun, meters, seconds }.
function cardPickReady(st) {
  const s = st || {};
  if (s.orbiting || s.scraping || !(s.vy < 0)) return false;
  if (s.firstRun && ((s.meters || 0) < CARD_TUNING.firstRunPickMeters || (s.seconds || 0) < CARD_TUNING.firstRunPickSeconds)) return false;
  return true;
}

function cardById(id) {
  for (const c of CARDS) if (c.id === id) return c;
  return null;
}

// Up to 3 distinct card ids, rarity weighted, never one already owned. rand() returns [0, 1).
function drawCardChoices(ownedIds, rand) {
  const owned = ownedIds || [];
  const pool = CARDS.filter((c) => owned.indexOf(c.id) < 0);
  const picks = [];
  while (picks.length < 3 && pool.length) {
    let total = 0;
    for (const c of pool) total += RARITY_WEIGHT[c.rarity];
    let roll = rand() * total;
    let index = pool.length - 1;
    for (let i = 0; i < pool.length; i++) {
      roll -= RARITY_WEIGHT[pool[i].rarity];
      if (roll < 0) { index = i; break; }
    }
    picks.push(pool[index].id);
    pool.splice(index, 1);
  }
  return picks;
}

function familyCounts(ownedIds) {
  const counts = { orbit: 0, fling: 0, flight: 0, shield: 0 };
  for (const id of ownedIds || []) {
    const c = cardById(id);
    if (c) counts[c.family]++;
  }
  return counts;
}

// Family keys whose set bonus is active, in CARD_FAMILIES order.
function activeSetBonuses(ownedIds) {
  const counts = familyCounts(ownedIds);
  return Object.keys(CARD_FAMILIES).filter((f) => counts[f] >= CARD_TUNING.setSize);
}

// Everything GameScene needs, as plain numbers/booleans. No cards = the base game exactly.
function cardMods(ownedIds) {
  const owned = (ownedIds || []).filter((id) => cardById(id));
  const has = (id) => owned.indexOf(id) >= 0;
  const sets = activeSetBonuses(owned);
  const set = (f) => sets.indexOf(f) >= 0;
  let perfectAngle = null;   // null = keep TUNING.perfectAngle
  if (has('perfect')) perfectAngle = CARD_TUNING.perfectAngleWide;
  if (set('fling')) perfectAngle = has('perfect') ? CARD_TUNING.perfectAngleSet : CARD_TUNING.perfectAngleWide;
  return {
    count: owned.length,
    grabRangeMul: has('well') ? CARD_TUNING.grabRangeMul : 1,
    closeOrbitMul: has('spin') ? CARD_TUNING.closeOrbitMul : 1,
    orbitTighten: has('spin') ? CARD_TUNING.tightenSpeed : 0,
    tightCatchBonus: has('spin') ? CARD_TUNING.tightCatchBonus : 0,
    orbitGainMul: has('overdrive') ? CARD_TUNING.orbitGainMul : 1,
    releaseBonus: has('sling') ? CARD_TUNING.releaseBonus : 0,
    perfectAngle,
    chainSpeed: has('chain') ? CARD_TUNING.chainSpeed * (set('fling') ? 2 : 1) : 0,
    chainScoreMul: set('fling') ? 2 : 1,
    flightDecayMul: has('aero') ? CARD_TUNING.flightDecayMul : 1,
    afterburnerSeconds: has('afterburner') ? CARD_TUNING.afterburnerSeconds : 0,
    wallKick: has('wallkick'),
    climbNoDecay: set('flight'),
    heatShieldCharges: has('heatshield') ? CARD_TUNING.heatShieldCharges : 0,
    tailArmor: has('armor'),
    shockwavePush: has('shockwave') ? CARD_TUNING.shockwavePush : 0,
    catchBurst: set('orbit') ? CARD_TUNING.catchBurst : 0,
    rescues: set('shield') ? CARD_TUNING.rescues : 0,
    novaSpeedMul: 1 + CARD_TUNING.novaPerCard * owned.length,
  };
}

// Supernova speed multiplier from cards: ownedCount cards, the newest picked secondsSincePick s ago
// (its novaPerCard eases in linearly over pickNovaEase s; null / undefined = long ago).
function cardNovaMul(ownedCount, secondsSincePick) {
  const n = Math.max(0, ownedCount || 0);
  if (n === 0) return 1;
  const t = secondsSincePick === undefined || secondsSincePick === null ? Infinity : Math.max(0, secondsSincePick);
  const newest = Math.min(1, t / CARD_TUNING.pickNovaEase);
  return 1 + CARD_TUNING.novaPerCard * (n - 1 + newest);
}

if (typeof module !== 'undefined') {
  module.exports = { cardNovaMul, cardProcPopAllowed, CARD_FAMILIES, CARDS, SET_BONUSES, RARITY_WEIGHT, CARD_TUNING, cardPickReady, cardById, drawCardChoices, familyCounts, activeSetBonuses, cardMods };
}
