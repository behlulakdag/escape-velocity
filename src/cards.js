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
  { id: 'wallkick', family: 'flight', rarity: 'rare', name: 'Wall Kick', desc: 'Walls kick you upward', icon: 'wallkick' },
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
  novaPerCard: 0.05,          // every card picked makes the supernova 5% faster
};

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

if (typeof module !== 'undefined') {
  module.exports = { CARD_FAMILIES, CARDS, SET_BONUSES, RARITY_WEIGHT, CARD_TUNING, cardById, drawCardChoices, familyCounts, activeSetBonuses, cardMods };
}
