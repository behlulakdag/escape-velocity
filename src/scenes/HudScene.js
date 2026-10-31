// Overlay scene for score/speed/stamps. Lives in its own scene so the game camera can
// zoom out at high speed without shrinking the UI.
// Sketchbook look: the score is written on a small taped paper note; speed is written straight
// on the page with a crayon underline that grows with speed; the multiplier is a circled "x3".
//
// Public API used by GameScene:
//   setStats(score, altitude, speed, displaySpeed?)  displaySpeed (km/s) overrides speed / 10
//   setChain(n)               PERFECT chain shown as 'combo N' (no 'x': that is the multiplier's)
//   comboTick(chain)          an ordinary PERFECT in a chain: quick pulse + tally tick on the combo
//   showMilestone(name, lvl)  chain milestone crayon stamp (1 NICE!, 2 BLAZING!, 3 UNSTOPPABLE!)
//   revealStats(), setDanger(0..1), setCometScreen(x, y)
//   setPage(zoneIndex)        page/zone changed: the cream last page switches the HUD to dark ink
//   pop(label, color, opts)   the only pop path: one line at a time, placed away from the comet;
//                             low/medium pops sent while a banner is up wait until it fades;
//                             HUD_POP_GATE: '-N% SPEED' at most once per 2 s (merged into the
//                             bigger number), one new line per 0.25 s, a card name twice a run
//   flash(color, alpha, duration, maxAlpha?)  alpha capped at 0.12 (maxAlpha may raise it to 0.18)
//   showBanner(title, subtitle, { duration }), hideBanner()   (showHint / hideHint: retired no-ops)
//   showMachTier(mach)        'MACH 500!' stamp (milestone style); waits for banners, the card
//                             pick and any stamp on screen. The MACH readout under the km/s
//                             number is computed from the shown km/s (setStats' 4th argument)
//   setCards(ownedIds)        owned upgrade cards as small taped icons in the top band, right of
//                             the score note (hudCardStripSlots), out of the play field
//   flashCard(id)             a card's proc without a pop: its icon wiggles over a crayon flare
//   setNovaEta(seconds)       every frame: time until the supernova reaches the comet; under ~1.2 s
//                             a heat band + pulsing '!!' warn (last 0.8 s in flight; from 1.5 s
//                             while orbiting, wherever the front is: hudNovaWarnTarget)
//   setOrbitDanger(level)     optional, per frame while orbiting: 0..1 danger (max with the above)
//   warnPulse()               { level, beat } of that warning, to pulse the aim line in step
//   cardProc(id, x, y)        a card's effect fired: family-crayon burst on the comet (screen x, y)
//                             + the card's mini index card popping above it for ~0.4 s
//   showFirstRunNote(text)    taped note for ~2 s, clear of the comet / planets / score
//   showCloserFaster(x, y)    'CLOSER = FASTER' stamp by the comet, once per HUD life (GameScene
//                             keeps the lifetime flag)
//   showTutorialStep(step, info) / hideTutorialStep()  one-time guided tutorial (screen coords;
//                             GameScene decides when and slows time). 'hold' {px, py, pr, cx, cy}:
//                             the page dims under ink hatching with spotlights on the planet and
//                             the comet, a pressing fingertip + 'HOLD' / 'anywhere on screen';
//                             'letgo' {cx, cy, dirX, dirY, px, py, pr}: the finger lifts, a curved
//                             arrow along dir + 'LET GO'; 'nice' {cx, cy}: fades out, NICE! stamp.
//                             Idempotent every frame, never interactive (input reaches GameScene).
//                             While a step is up, pops and stamps are dropped (never queued);
//                             banners / set bonuses wait. During its ~0.2 s fade-out they wait.
//   showSetBonus(familyKey)   family-colored SET BONUS banner (SET_BONUSES in src/cards.js)
//   scoreText is read by GameScene, so it stays a Text object.
//   Pause: the top-right '||' scrap (and ESC / P, and auto on page hidden / window blur during
//   play, hudCanPause) launches PauseScene over Game + Hud; see src/scenes/PauseScene.js.

// Pop rules (see pop()): only ONE pop line is ever on screen; it never sits on the comet.
const POP = {
  top: 270,              // below the stats note (note + chain line end around y 245)
  bottomMargin: 330,     // above the bottom-corner speed / xN blocks (y ~1074)
  sideMargin: 26,
  minSize: 34,
  maxSize: 76,
  overshoot: 1.12,       // Back.Out scale-in peak; the fit leaves room for it
  cometClear: 120,       // px kept between the comet and the pop's box
  tailLength: 240,       // the comet's tail trails this far below it on screen
  tailSlack: 50,         // the tail may come 50 px closer than the head (70 px clear)
  guardMs: 300,          // a higher-priority pop younger than this is not replaced
  highHoldMs: 450,       // a high pop shows at least this long before another high pop takes over
  sameLabelMs: 400,      // the same label again this soon just re-punches the line
  underBanner: 130,      // strip under a readable banner that a high pop may not use
};
// Pops (below high priority) sent while a zone / set banner is readable wait for it to fade.
const POP_WAIT = {
  max: 2,                // at most this many waiting pops (the oldest is dropped)
  staleMs: 2600,         // a waiting pop older than this is stale and dropped
  afterMs: 140,          // gap after the banner fades before the first waiting pop shows
};
const POP_HIGH = 3;
const POP_MEDIUM = 2;
const POP_LOW = 1;

// Repeats ('it keeps writing X'): the same pop / stamp word never comes out twice within ms.
// A pop of the same kind arriving while the first is still up merges into it instead
// ('-15% SPEED' then '-30% SPEED' reads '-30% SPEED': the bigger loss; anything else just keeps
// the line up).
const HUD_REPEAT = { ms: 1500, maxPenalty: 90 };

// Pure helper (tested): may `label` come out at `now`? Records it when it may. seen: {label: time}.
function hudRepeatAllowed(seen, label, now) {
  const last = seen[label];
  if (typeof last === 'number' && now - last >= 0 && now - last < HUD_REPEAT.ms) return false;
  seen[label] = now;
  return true;
}

// Pure helper (tested): the kind of a pop with its numbers taken out ('-15% SPEED' and
// '-8% SPEED' are one kind; 'PERFECT x4!' and 'PERFECT x5!' too).
function hudPopKind(label) {
  return String(label).toUpperCase().replace(/[0-9]+(\.[0-9]+)?/g, '#').trim();
}

// Pure helper (tested): one line for two pops of the same kind. Two '-N% X' penalties read as
// the bigger one (capped; adding them up overstated bursts of small bumps); anything else reads
// as the newer label.
function hudMergePopLabel(prev, next) {
  const re = /^-(\d+)%\s*(.*)$/;
  const a = re.exec(String(prev));
  const b = re.exec(String(next));
  if (a && b && a[2] === b[2]) return '-' + Math.min(HUD_REPEAT.maxPenalty, Math.max(Number(a[1]), Number(b[1]))) + '% ' + b[2];
  return String(next);
}

// Pop color in crayon: the old neon pop colors and the card family colors map to their crayons.
function hudPopColor(color) {
  if (typeof CARD_FAMILIES !== 'undefined' && typeof cardCrayon === 'function') {
    for (const key in CARD_FAMILIES) {
      if (uiColorHex(CARD_FAMILIES[key].color) === String(color).toLowerCase()) return uiColorHex(cardCrayon(key));
    }
  }
  return uiCrayonHex(color);
}

// Card and set names (upper case, as the game pops them), built once on first use.
let hudNamedPops = null;
function hudIsNamedPop(label) {
  if (!hudNamedPops) {
    hudNamedPops = [];
    if (typeof CARDS !== 'undefined') for (const c of CARDS) hudNamedPops.push(c.name.toUpperCase());
    if (typeof SET_BONUSES !== 'undefined') for (const k in SET_BONUSES) hudNamedPops.push(SET_BONUSES[k].name.toUpperCase());
  }
  const bare = String(label).toUpperCase().replace(/[!.]+$/, '').trim();
  return hudNamedPops.indexOf(bare) >= 0;
}

// High pops (card/set names, rescues, records, close calls) are never dropped; PERFECT is medium;
// everything else (+SPEED, CLOSE ORBIT, WARP...) is low and gives way.
function popPriority(label) {
  if (/UNBREAKABLE|SHIELD!|NEW BEST|CLOSE CALL/.test(label) || hudIsNamedPop(label)) return POP_HIGH;
  if (/PERFECT/.test(label)) return POP_MEDIUM;
  return POP_LOW;
}

// Crayon pressed harder: a darker shade that stays readable on the cream last page.
function hudDeepen(color, k) {
  k = k === undefined ? 0.62 : k;
  const r = Math.round(((color >> 16) & 255) * k);
  const g = Math.round(((color >> 8) & 255) * k);
  const b = Math.round((color & 255) * k);
  return (r << 16) | (g << 8) | b;
}

// Distance from a point to a box (0 inside).
function hudBoxDistance(px, py, x0, y0, x1, y1) {
  return Math.hypot(Math.max(x0 - px, 0, px - x1), Math.max(y0 - py, 0, py - y1));
}

// Chain milestone stamps (showMilestone): per level the crayon, lettering size and ink burst.
const HUD_MILESTONE = {
  holdMs: 560,           // fully visible, then a 340 ms fade: ~0.9 s in all
  fadeMs: 340,
  cometClear: 140,       // px kept between the comet (and its tail) and the stamp
  levels: [
    { size: 92, crayon: 'yellow', burst: 10, reach: 220 },
    { size: 106, crayon: 'orange', burst: 14, reach: 280 },
    { size: 118, crayon: 'red', burst: 18, reach: 340 },
  ],
};

// Zone banner title y (the owned-card strip lives in the top band now, so it never moves).
// fadeMs: hideBanner() fade; clearMs: the card header's hold-back, a little longer than the fade.
const HUD_BANNER = { y: 400, fadeMs: 90, clearMs: 120 };

// Run-start 'ESCAPE THE SUPERNOVA!' banner. At y 400 it sat right on the first planet. Planets
// sweep DOWN the screen at ~600 px/s as the comet climbs, so the band below the comet is the
// last one the first grab target reaches (it gets there only after the comet has passed it).
// below: title center under the comet; maxY: title bottom stays above the bottom corner blocks;
// half: half the title band (~98 px tall at its fitted scale) plus a little air; cometPad: the
// comet's body and the start of its tail; hitPad: the banner starts its quick fade this far
// before a planet reaches it (hudStartBannerHit). holdMs + fadeMs: 1 s, gone before the first target
// slides into that band.
const HUD_START_BANNER = { below: 175, minY: 300, maxY: 950, half: 56, cometPad: 70, hitPad: 30, holdMs: 750, fadeMs: 250 };

// Pure helper (tested): is any circle {y, r} within hitPad of the start banner's title band?
function hudStartBannerHit(titleY, circles) {
  const S = HUD_START_BANNER;
  return (circles || []).some((b) => b && typeof b.y === 'number' && isFinite(b.y) && Math.abs(b.y - titleY) < S.half + S.hitPad + (b.r || 0));
}

// Pure helper (tested): run-start banner title y. cometY: comet screen y; bodies: planets as
// screen circles {y, r}. Below the comet when there is room, else above it, else the old spot;
// the first candidate that is clear of the comet and of every planet wins.
function hudStartBannerY(cometY, bodies) {
  const S = HUD_START_BANNER;
  if (typeof cometY !== 'number' || !isFinite(cometY)) return HUD_BANNER.y;
  const candidates = [Math.min(S.maxY, cometY + S.below), Math.max(S.minY, cometY - S.below), HUD_BANNER.y];
  const clearOfComet = (y) => Math.abs(y - cometY) >= S.half + S.cometPad;
  return candidates.find((y) => clearOfComet(y) && !hudStartBannerHit(y, bodies))
    || candidates.find(clearOfComet)
    || HUD_BANNER.y;
}

// Pure helper (tested): the next queue after a pop arrives while a banner is up.
// Same label replaces its older copy; the queue keeps the newest POP_WAIT.max entries,
// dropping the oldest low/medium one first (high pops are only dropped when all are high).
function hudQueueWaitingPop(queue, item) {
  const out = queue.filter(q => q.label !== item.label);
  out.push(item);
  while (out.length > POP_WAIT.max) {
    const low = out.findIndex(q => !q.high);
    out.splice(low >= 0 ? low : 0, 1);
  }
  return out;
}

// ---- Pop gates (pop()) ----
// lossMs: the whole '-N% SPEED' family comes out at most once per lossMs (a second loss while the
// first line is still up merges into it, keeping the bigger number). newMs: at most one NEW pop
// line per newMs; a high pop arriving sooner waits for the gap, anything lower is dropped.
// namedMax: a card's name is written at most this often per run (the pick pop + one proc);
// after that the card's own icon in the HUD strip flashes instead (flashCard).
const HUD_POP_GATE = { lossMs: 2000, newMs: 250, namedMax: 2 };
// A card's icon flashes (flashCard) at most once per flashMs: frequent procs (Aerodynamic every
// fling) made the strip flicker all run long.
const HUD_CARD_FLASH = { flashMs: 5000 };

// Pure helper (tested): may card id flash now? seen: id -> time it last flashed.
function hudCardFlashAllowed(seen, id, now) {
  const last = seen && typeof seen[id] === 'number' ? seen[id] : -Infinity;
  return now - last >= HUD_CARD_FLASH.flashMs || now < last;
}

// Pure helper (tested): a '-N% SPEED' loss pop.
function hudIsLossPop(label) {
  return /^-\d+%\s*SPEED/.test(String(label).trim().toUpperCase());
}

// Pure helper (tested): may a new pop line come out now? gate: { lossAt, newAt } (times of the
// last loss pop and the last new line). Returns { act: 'show' } | { act: 'drop' } |
// { act: 'defer', at } (high pops only: shown at `at`).
function hudPopGate(gate, label, priority, now) {
  const G = HUD_POP_GATE;
  const since = (t) => (typeof t === 'number' ? now - t : Infinity);
  const lossAgo = since(gate && gate.lossAt);
  if (hudIsLossPop(label) && lossAgo >= 0 && lossAgo < G.lossMs) return { act: 'drop' };
  const newAgo = since(gate && gate.newAt);
  if (newAgo >= 0 && newAgo < G.newMs) {
    return priority >= POP_HIGH ? { act: 'defer', at: gate.newAt + G.newMs } : { act: 'drop' };
  }
  return { act: 'show' };
}

// Records a new pop line (or a loss merged into the live one) in the gate.
function hudPopGateRecord(gate, label, now, merged) {
  if (!merged) gate.newAt = now;
  if (hudIsLossPop(label)) gate.lossAt = now;
}

// Pure helper (tested): the card id whose name a pop spells ('SLINGSHOT!' -> 'sling'), else null.
function hudCardIdForPop(label, cards) {
  const bare = String(label).toUpperCase().replace(/[!.]+$/, '').trim();
  for (const c of cards || []) if (c && c.name && c.name.toUpperCase() === bare) return c.id;
  return null;
}

// Owned cards: small taped icons in the HUD's top band, right of the score note and left of the
// pause button (x 578+), so they never sit in the play field. Up to perRow cards make one
// row; more wrap into two rows (12 cards: two rows of 6). left/right: card edges.
const HUD_CARDS = { left: 314, right: 570, singleY: 122, rowY: [98, 150], perRow: 5, scale: 0.66, cardW: 42, cardH: 50, maxPitch: 52, under: 0.5, ease: 8 };

// Pure helper (tested): slot centers {x, y} for n owned cards, left to right, row by row.
function hudCardStripSlots(n) {
  const L = HUD_CARDS;
  n = Math.max(0, Math.floor(Number(n) || 0));
  if (!n) return [];
  const rows = n > L.perRow ? 2 : 1;
  const perRow = Math.ceil(n / rows);
  const span = L.right - L.left - L.cardW;
  const pitch = perRow > 1 ? Math.min(L.maxPitch, span / (perRow - 1)) : 0;
  const out = [];
  for (let i = 0; i < n; i++) {
    const r = Math.floor(i / perRow);
    out.push({ x: L.left + L.cardW / 2 + (i % perRow) * pitch, y: rows === 1 ? L.singleY : L.rowY[r] });
  }
  return out;
}

// Pure helper (tested): the strip's screen rect for n cards (null for none).
function hudCardStripRect(n) {
  const slots = hudCardStripSlots(n);
  if (!slots.length) return null;
  const L = HUD_CARDS;
  const xs = slots.map(s => s.x);
  const ys = slots.map(s => s.y);
  return {
    left: Math.min(...xs) - L.cardW / 2, right: Math.max(...xs) + L.cardW / 2,
    top: Math.min(...ys) - L.cardH / 2, bottom: Math.max(...ys) + L.cardH / 2,
  };
}

// Speed readout: any rise shows at once (a boost must read as a jump, never a slow count);
// a big rise punches the number; only a drop eases down.
const HUD_SNAP = {
  punchMin: 5,           // km/s: a rise at least this big (and >= punchFrac of the shown speed) punches
  punchFrac: 0.03,
  punchBase: 0.1,        // punch scale added: punchBase + jump / punchPer, capped at punchMax
  punchPer: 120,
  punchMax: 0.4,
  burstAt: 25,           // km/s: a rise this big also throws a small ink burst off the number
  decayRate: 5,          // per second, easing toward a lower speed
  punchDecay: 9,         // per second, the punch settling back
};

// Pure helper (tested): the readout after a new target. Rises snap; drops keep the shown value
// (hudSpeedEase walks it down). punch: extra scale for the readout (0 = none).
function hudSpeedSnap(shown, target) {
  if (!(target > shown)) return { shown, punch: 0, jump: 0 };
  const jump = target - shown;
  const big = jump >= Math.max(HUD_SNAP.punchMin, shown * HUD_SNAP.punchFrac);
  return { shown: target, jump, punch: big ? Math.min(HUD_SNAP.punchMax, HUD_SNAP.punchBase + jump / HUD_SNAP.punchPer) : 0 };
}

// Pure helper (tested): one frame of the readout walking down toward a lower target.
function hudSpeedEase(shown, target, dt) {
  if (target >= shown) return target;
  const gap = target - shown;
  if (Math.abs(gap) < 0.5) return target;
  return shown + gap * Math.min(1, dt * HUD_SNAP.decayRate);
}

// Momentum cue round the speed readout (setMomentum, 0..1): flame licks doodled behind the
// number, the number pressed in hotter crayon and written bigger, a shiver at the top. Never a bar.
const HUD_MOMENTUM = {
  minShow: 0.08,         // below this nothing is drawn
  maxLicks: 7,
  minH: 30,              // flame height at minShow .. at 1
  maxH: 84,
  ease: 6,               // per second: the shown momentum follows setMomentum
  shakeFrom: 0.7,
  shakeMax: 4,           // px
  scale: 0.16,           // extra readout scale at 1
  // Number crayon on dark pages: cream ink heats to yellow, orange, then red.
  stops: [[0, UI_INK.cream], [0.25, UI_INK.cream], [0.625, UI_CRAYON.yellow], [0.875, UI_CRAYON.orange], [1, UI_CRAYON.red]],
};

function hudLerpColor(a, b, t) {
  const ch = (s) => Math.round(((a >> s) & 255) + (((b >> s) & 255) - ((a >> s) & 255)) * t);
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}

// Pure helper (tested): what the momentum cue looks like at m.
function hudMomentumStyle(m) {
  const M = HUD_MOMENTUM;
  m = Math.max(0, Math.min(1, m || 0));
  // Quantized so the number's texture is re-rendered only a few times over the whole range.
  const q = Math.round(m * 8) / 8;
  let ink = M.stops[M.stops.length - 1][1];
  for (let i = 1; i < M.stops.length; i++) {
    if (q <= M.stops[i][0]) {
      const [t0, c0] = M.stops[i - 1];
      const [t1, c1] = M.stops[i];
      ink = hudLerpColor(c0, c1, (q - t0) / (t1 - t0));
      break;
    }
  }
  if (m < M.minShow) return { licks: 0, height: 0, shake: 0, scale: 0, ink };
  return {
    licks: Math.max(2, Math.round(m * M.maxLicks)),
    height: M.minH + (M.maxH - M.minH) * m,
    shake: Math.max(0, (m - M.shakeFrom) / (1 - M.shakeFrom)) * M.shakeMax,
    scale: m * M.scale,
    ink,
  };
}

// Bottom HUD: the speed readout is a compact block in the bottom-LEFT corner and the multiplier
// loop sits in the bottom-RIGHT corner, so the flight lane up the middle stays clear (planets and
// black holes were hiding behind the old full-width band). HUD_BAND_LIFT keeps the MACH line out
// of the bottom ~110 px (phone browser bars / home indicator).
// HUD_PANEL / HUD_BADGE_PANEL: the two blocks' bounds, for stepping back over the comet / planets.
const HUD_BAND_LIFT = 56;
const HUD_SPEED = { x: 166, y: GAME_HEIGHT - 150 - HUD_BAND_LIFT, lineY: GAME_HEIGHT - 116 - HUD_BAND_LIFT, minLine: 50, maxLine: 214, size: 44 };
const HUD_PANEL = { left: 24, right: 320, top: HUD_SPEED.y - 56, bottom: HUD_SPEED.lineY + 50 };
const HUD_BADGE = { x: GAME_WIDTH - 86, y: HUD_SPEED.y + 6, size: 40, scaleX: 0.5, scaleY: 0.62 };
// Multiplier stamp: the first time a run reaches x2..x5 the number slams down big in the middle of the screen,
// holds a beat, then shrinks and flies into the multiplier note bottom-right (ms; y is the screen center line).
const HUD_MULT_STAMP = { size: 150, y: 540, dodgeY: 760, cometDodge: 200, inMs: 220, holdMs: 520, flyMs: 380, endScale: 0.28 };
const HUD_BADGE_PANEL = { left: HUD_BADGE.x - 62, right: HUD_BADGE.x + 62, top: HUD_BADGE.y - 62, bottom: HUD_BADGE.y + 62 };
// Corner blocks' alpha while the comet (or a planet) is under them.
// planet: no step back at all. The blocks sit on opaque paper and planets simply pass behind
// them; a judge read the old 85% dip (on an 86% scrap) as a glitch. comet: the hero itself
// right under a block (cometPad: only when it really overlaps, not merely sinking toward the
// bottom as the nova rises) is the one case that may step back, so it is never hidden.
const HUD_PANEL_UNDER = { comet: 0.3, planet: 1, floor: 0.85, cometPad: 24, planetPad: 4 };

// Pure helper (tested): a corner block's target alpha. cometUnder / planetUnder: booleans.
function hudCornerFade(cometUnder, planetUnder) {
  const U = HUD_PANEL_UNDER;
  if (cometUnder) return U.comet;
  return planetUnder ? Math.max(U.floor, U.planet) : 1;
}
// Torn cream-paper scraps taped behind the km/s + MACH block and the x-loop, so the numbers
// always read (planets, orbit rings and the supernova used to show through). w x h: the paper;
// x, y: its center; rot: its tilt. alpha 1: opaque paper, so nothing passing behind shows through.
const HUD_SCRAP = {
  speed: { x: 168, y: HUD_SPEED.y + 16, w: 274, h: 134, rot: 0.025 },
  badge: { x: HUD_BADGE.x, y: HUD_BADGE.y + 2, w: 112, h: 118, rot: -0.06 },
  alpha: 1, pad: 20, tear: 7,
};

// Pure helper (tested): outline of a torn scrap in a (w + 2 pad) x (h + 2 pad) canvas, clockwise
// from the top-left corner. The top edge is a clean cut; the other three are torn: short jagged
// steps in and out by up to `tear` px. rnd: () => 0..1 (fixed per texture, so the tear never boils).
function hudTornScrapPoints(w, h, pad, tear, rnd) {
  const pts = [];
  const edge = (x0, y0, x1, y1, torn) => {
    const len = Math.hypot(x1 - x0, y1 - y0);
    const n = torn ? Math.max(4, Math.round(len / 9)) : Math.max(2, Math.round(len / 60));
    const nx = (y1 - y0) / len;   // outward normal of a clockwise edge (y down)
    const ny = -(x1 - x0) / len;
    for (let i = 0; i < n; i++) {
      const t = i / n;
      const off = torn ? (rnd() - 0.6) * tear : (rnd() - 0.5) * 1.5;
      pts.push({ x: x0 + (x1 - x0) * t + nx * off, y: y0 + (y1 - y0) * t + ny * off });
    }
  };
  const l = pad;
  const r = pad + w;
  const t = pad;
  const b = pad + h;
  edge(l, t, r, t, false);
  edge(r, t, r, b, true);
  edge(r, b, l, b, true);
  edge(l, b, l, t, true);
  return pts;
}

// The scrap texture: drop shadow, note cream, paper fibers, a pale fibrous fringe on the torn
// edges, a faint pencil edge and a strip of tape over the top.
function hudScrapTexture(scene, key, w, h) {
  const P = HUD_SCRAP.pad;
  return uiSketchTexture(scene, key, w + P * 2, h + P * 2, (ctx, shape, jitter) => {
    const pts = hudTornScrapPoints(w, h, P, HUD_SCRAP.tear, shape);
    uiTracePath(ctx, pts.map((p) => ({ x: p.x + 4, y: p.y + 6 })), true);
    ctx.fillStyle = 'rgba(5,6,16,0.42)';
    ctx.fill();
    uiTracePath(ctx, pts, true);
    ctx.fillStyle = uiCss(UI_CRAYON.note);
    ctx.fill();
    ctx.save();
    uiTracePath(ctx, pts, true);
    ctx.clip();
    for (let i = 0; i < (w * h) / 500; i++) {
      const x = P + shape() * w;
      const y = P + shape() * h;
      ctx.strokeStyle = 'rgba(120,95,50,' + (0.06 + shape() * 0.08) + ')';
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + (shape() - 0.5) * 22, y + (shape() - 0.5) * 9);
      ctx.stroke();
    }
    ctx.restore();
    uiTracePath(ctx, pts, true);
    ctx.strokeStyle = 'rgba(255,252,238,0.9)';
    ctx.lineWidth = 2.6;
    ctx.stroke();
    uiTracePath(ctx, pts, true);
    ctx.strokeStyle = 'rgba(138,122,90,0.55)';
    ctx.lineWidth = 1.2;
    ctx.stroke();
    ctx.save();
    ctx.translate(P + w * (0.4 + shape() * 0.2), P + 2 + (jitter() - 0.5));
    ctx.rotate((shape() - 0.5) * 0.3);
    const half = Math.min(40, w * 0.26);
    const tape = [];
    for (let i = 0; i <= 3; i++) tape.push({ x: half + (i % 2 ? 4 : 0), y: -11 + i * 7.3 });
    for (let i = 3; i >= 0; i--) tape.push({ x: -half - (i % 2 ? 4 : 0), y: -11 + i * 7.3 });
    uiTracePath(ctx, tape, true);
    ctx.fillStyle = 'rgba(240,232,190,0.62)';
    ctx.fill();
    ctx.restore();
  });
}
// Graphite pencil edge traced round a scrap (shown only on pale pages, where the cream paper
// would melt into the cream page). Built with the scrap's own shape seed, so the torn outline
// matches the scrap exactly whatever boil variant either one is on (the outline uses only the
// shape random; the variant random only moves the tape). Two passes, a little off each other,
// like a pencil going round twice.
function hudScrapEdgeTexture(scene, baseKey, w, h) {
  const P = HUD_SCRAP.pad;
  const key = baseKey + '_edge';
  for (let v = 0; v < UI_BOIL_VARIANTS; v++) {
    const k = key + '_' + v;
    if (scene.textures.exists(k)) continue;
    const tex = scene.textures.createCanvas(k, w + P * 2, h + P * 2);
    const ctx = tex.getContext();
    const pts = hudTornScrapPoints(w, h, P, HUD_SCRAP.tear, uiRng(uiHash(baseKey)));
    const jitter = uiRng(uiHash(key) + (v + 1) * 7919);
    for (const [width, alpha, wob] of [[2.6, 0.85, 0.6], [1.3, 0.55, 1.6]]) {
      uiTracePath(ctx, pts.map((p) => ({ x: p.x + (jitter() - 0.5) * wob, y: p.y + (jitter() - 0.5) * wob })), true);
      ctx.strokeStyle = 'rgba(52,48,66,' + alpha + ')';
      ctx.lineWidth = width;
      ctx.lineJoin = 'round';
      ctx.stroke();
    }
    tex.refresh();
  }
  return key;
}

// Multiplier circle tint by level (x1..x5): the same warm ramp as the comet.
// Supernova front (screen y) near the bottom band: its orange flames sit right behind the speed
// readout and the momentum crown. 0 while the front is below farY, 1 once it is up at nearY.
const HUD_NOVA = { farY: GAME_HEIGHT + 60 - HUD_BAND_LIFT, nearY: GAME_HEIGHT - 120 - HUD_BAND_LIFT, ease: 6 };
// Ink smudge behind the speed readout, so the number reads over black holes / planets / the nova.
// ink: near-black (the page's own dark ink barely shows on navy paper).
// Small and see-through (~45%): planets under it still read.
const HUD_HALO = { x: 170, y: GAME_HEIGHT - 128 - HUD_BAND_LIFT, w: 300, h: 140, alpha: 0.45, novaAlpha: 0.25, ink: 0x07060d };

// Pure helper (tested): how close the supernova front is to the bottom band, 0..1.
function hudNovaNear(novaScreenY) {
  if (typeof novaScreenY !== 'number' || !isFinite(novaScreenY)) return 0;
  const k = (HUD_NOVA.farY - novaScreenY) / (HUD_NOVA.farY - HUD_NOVA.nearY);
  return Math.max(0, Math.min(1, k));
}

// MACH readout and tier stamps. 343 m/s = Mach 1 (sea level); km/s * 1000 / 343.
// dy: MACH line under the underline; with HUD_BAND_LIFT its bottom edge stays >= HUD_SAFE_BOTTOM up.
// holdMs / fadeMs: a MACH stamp is shorter than a chain stamp (the readout under it keeps moving);
// staleRatio: once the readout is below tier * staleRatio the stamp is old news: a waiting one is
// dropped and one on screen wipes off at once.
const HUD_MACH = { tiers: [500, 1000, 1500, 2000, 2500], size: 28, dy: 30, afterMs: 150, preemptMs: 450, holdMs: 380, fadeMs: 160, staleRatio: 0.85 };

// Pure helper (tested): the MACH readout (machNow) has dropped too far below a tier's stamp.
function hudMachStampStale(tier, machNow) {
  const t = Number(tier);
  const m = Number(machNow);
  if (!(t > 0) || !isFinite(m)) return false;
  return m < t * HUD_MACH.staleRatio;
}
const HUD_SAFE_BOTTOM = 106;   // px at the bottom edge kept free of important text

// Pure helper (tested): Mach number for a km/s readout (rounded, never negative / NaN).
function hudMachNumber(kmPerS) {
  const v = typeof kmPerS === 'number' && isFinite(kmPerS) ? kmPerS : 0;
  return Math.max(0, Math.round((v * 1000) / 343));
}

// Pure helper (tested): stamp level (1..3, as HUD_MILESTONE.levels) for a MACH tier.
function hudMachTierLevel(mach) {
  if (mach >= 2000) return 3;
  if (mach >= 1000) return 2;
  return 1;
}

// ---- Page ink (setPage) ----

// The zone object for a page index: zoneAt() (orbit.js, covers the endless pages) when it is
// there, else the fixed ZONES list (clamped), else null (unit tests load no orbit.js).
function hudZoneForPage(index) {
  const i = Math.max(0, Math.floor(Number(index) || 0));
  try {
    if (typeof zoneAt === 'function') return zoneAt(i) || null;
  } catch (e) { /* fall through to the fixed list */ }
  if (typeof ZONES !== 'undefined' && ZONES.length) return ZONES[Math.min(i, ZONES.length - 1)];
  return null;
}

// Pure helper (tested): perceived brightness 0..1 of a 0xRRGGBB color.
function hudColorBrightness(color) {
  const c = Number(color) >>> 0;
  return (0.299 * ((c >> 16) & 255) + 0.587 * ((c >> 8) & 255) + 0.114 * (c & 255)) / 255;
}

// Pure helper (tested): a pale page (cream ESCAPE VELOCITY, white graph-paper BIG BANG) gets the
// dark HUD ink. Reads the zone's paper (or sky); a zone without colors falls back to its ink
// (dark ink means pale paper), then to the old UI_PAPERS flag.
function hudPageIsLight(zone, fallbackLight) {
  if (zone && typeof zone === 'object') {
    const paper = zone.paper !== undefined ? zone.paper : zone.sky;
    if (typeof paper === 'number' && isFinite(paper)) return hudColorBrightness(paper) > 0.55;
    if (typeof zone.ink === 'number' && isFinite(zone.ink)) return hudColorBrightness(zone.ink) < 0.45;
  }
  return !!fallbackLight;
}

// ---- One-time guided tutorial (showTutorialStep / hideTutorialStep) ----
// GameScene decides WHEN (and slows time); the HUD only draws: the page dims under an
// ink-hatched dark wash with soft spotlights round the planet and the comet, a big fingertip
// beside them and ONE hand-lettered word ('HOLD' / 'LET GO') near the finger. Nothing here is
// interactive, so the press anywhere still reaches GameScene's input.
// The hand and the word are placed separately (a phone screen has no room for one tall block
// beside a planet): the hand first, near what it is about, then the word near the hand.
// Hand coords: the fingertip is (0, 0), the hand trails down below it. Word coords: the word's
// center is (0, 0), the small sub line under it.
const HUD_STEP_DEPTH = 900;   // over the stats, under the pause button (1000)
const HUD_STEP = {
  fadeIn: 0.25,          // s
  fadeOut: 0.2,          // s
  wash: 0.55,            // flat paper-dark wash alpha ...
  hatch: 0.62,           // ... plus the hatch strokes over it: ~60% darker overall
  dark: 0x07060d,        // paper-dark ink
  margin: 60,            // everything stays this far inside the screen
  gap: 16,               // px between a box and a body (planet with its rings, comet) / the arrow
  rectGap: 10,           // px between a box and the score note / km/s / x-loop / buttons
  spotScale: 1.25,       // spotlight radius: r * spotScale + spotPad (rings, moons)
  spotPad: 34,
  spotMin: 70,
  spotMax: 260,
  cometSpot: 82,         // the comet's spotlight radius
  bodyScale: 1.3,        // what may never be covered: the planet body and its rings (r * 1.3 + 10)
  bodyPad: 10,
  cometBody: 46,         // the comet's head and the start of its flame
  feather: 0.74,         // brush: fully clear inside this fraction of its radius, soft outside
  handScale: 0.9,        // hand texture 244 px tall -> ~220 px on screen
  lean: 0.2,             // rad: the hand trails down-right of the tip
  scales: [1, 0.93, 0.85, 0.7],  // tried when the full-size box has no clean spot
  grid: 24,              // placement search step (px)
  pressMs: 1000,         // press cycle ('hold')
  liftMs: 1150,          // lift + arrow cycle ('letgo')
  liftPx: 50,
  rippleMax: 54,
  arrowFrom: 70,         // the fling arrow starts this far from the comet along dir ...
  arrowTo: 290,          // ... and ends here (no target given)
  arrowSamples: 6,
  arrowStop: 14,         // with a target: the tip stops this far outside the target's body
  arrowMin: 90,          // ... but the arrow is never shorter than this past arrowFrom
  arrowBend: 0.5,        // control point along the tangent, as a share of the chord
  arrowTargetR: 50,      // target screen radius when GameScene does not pass tr
  // HOLD: 'grab the planet!' (sub) and a smaller 'hold anywhere' (sub2) under it: planets are
  // friends to grab, not obstacles (a playtester dodged them).
  // The big word is cream ink with a fat dark outline (crayon yellow / green read poorly on the
  // navy wash at phone size); the crayon stays on the underline and 'grab the planet!'.
  word: { holdSize: 124, letgoSize: 108, outline: 20, subSize: 48, subY: 108, sub2Size: 38, sub2Y: 152, lineY: 52 },
  // Round the drawn parts at scale 1 (checked in the hud tests and measured in the browser):
  // the hand with its ripples / lift dashes and cream halo, and the lettering.
  handBox: { l: -72, r: 124, t: -78, b: 226 },
  // 'grab the planet!' at 48 px is ~334 px wide (measured), the widest line; 52 px (361) no longer
  // fit beside the planet in the first HOLD and shrank the whole word group to 0.85.
  wordHoldBox: { l: -170, r: 170, t: -84, b: 180 },
  wordLetgoBox: { l: -200, r: 200, t: -76, b: 76 },
  wordGap: 14,           // px between the word and the hand
  niceAbove: 190,        // the NICE! stamp sits this far above the comet (below it when too high)
  niceClear: 120,        // and never closer than this to the comet
};

// Pure helper (tested): spotlight radius round a planet of screen radius r ('planet') or round
// the comet ('comet'). Junk radii fall back to the minimum.
function hudSpotRadius(kind, r) {
  const S = HUD_STEP;
  if (kind === 'comet') return S.cometSpot;
  const rr = typeof r === 'number' && isFinite(r) && r > 0 ? r : 0;
  // Never smaller than the body it lights (a huge planet's rings stay inside the light).
  return Math.max(S.spotMin, Math.min(S.spotMax, rr * S.spotScale + S.spotPad), rr * S.bodyScale + S.bodyPad + 16);
}

// Pure helper (tested): the radius the hand and the word may never come inside (the planet's
// body with its rings / moons, or the comet's head). Always inside the spotlight.
function hudBodyRadius(kind, r) {
  const S = HUD_STEP;
  if (kind === 'comet') return S.cometBody;
  const rr = typeof r === 'number' && isFinite(r) && r > 0 ? r : 0;
  return rr * S.bodyScale + S.bodyPad;
}

// Pure helper (tested): gap between two rects {left, top, right, bottom} (0 when they touch/overlap).
function hudRectGap(a, b) {
  const dx = Math.max(0, a.left - b.right, b.left - a.right);
  const dy = Math.max(0, a.top - b.bottom, b.top - a.bottom);
  return Math.hypot(dx, dy);
}

// Pure helper (tested): rects overlap once each is grown by pad.
function hudRectsOverlap(a, b, pad) {
  const p = pad || 0;
  return a.left - p < b.right && b.left - p < a.right && a.top - p < b.bottom && b.top - p < a.bottom;
}

// Pure helper (tested): the screen rect of a box ({l, r, t, b}) at (x, y) and scale.
function hudStepRect(box, x, y, scale) {
  const k = scale || 1;
  return { left: x + box.l * k, right: x + box.r * k, top: y + box.t * k, bottom: y + box.b * k };
}

// Pure helper (tested): the HUD rects the group keeps off (score note, km/s block, x-loop,
// pause button in the top-right corner).
function hudStepHudRects() {
  return [HUD_NOTE.rect, HUD_PANEL, HUD_BADGE_PANEL, { left: GAME_WIDTH - 170, right: GAME_WIDTH - 14, top: 40, bottom: 196 }];
}

// Pure helper (tested): the LET GO arrow as a quadratic curve {sx, sy, mx, my, ex, ey} (screen
// coords). With a target (tx, ty; tr its screen radius) it leaves the comet along the fling
// tangent (dir) and bends round onto the target, stopping just short of its body, so the arrow
// says "this way, to THAT planet". Without a target: a straight-ish arrow along dir
// (arrowFrom..arrowTo), as before. null when there is nothing to point along.
function hudStepArrowPath(cx, cy, dirX, dirY, tx, ty, tr) {
  const S = HUD_STEP;
  const ok = (v) => typeof v === 'number' && isFinite(v);
  if (!ok(cx) || !ok(cy)) return null;
  const hasTarget = ok(tx) && ok(ty) && Math.hypot(tx - cx, ty - cy) > 1;
  let dx = ok(dirX) ? dirX : 0;
  let dy = ok(dirY) ? dirY : 0;
  let dl = Math.hypot(dx, dy);
  if (!dl && hasTarget) { dx = tx - cx; dy = ty - cy; dl = Math.hypot(dx, dy); }
  if (!dl) return null;
  dx /= dl;
  dy /= dl;
  const sx = cx + dx * S.arrowFrom;
  const sy = cy + dy * S.arrowFrom;
  if (!hasTarget) {
    const ex = cx + dx * S.arrowTo;
    const ey = cy + dy * S.arrowTo;
    return { sx, sy, mx: (sx + ex) / 2, my: (sy + ey) / 2, ex, ey, target: false };
  }
  const tdx = tx - cx;
  const tdy = ty - cy;
  const td = Math.hypot(tdx, tdy);
  const stop = hudBodyRadius('planet', ok(tr) && tr > 0 ? tr : S.arrowTargetR) + S.arrowStop;
  // Never shorter than a readable arrow, even when the target is close.
  const reach = Math.max(S.arrowFrom + S.arrowMin, td - stop);
  const ex = cx + (tdx / td) * reach;
  const ey = cy + (tdy / td) * reach;
  // Control point out along the tangent: the curve leaves the comet the way the fling starts.
  const k = Math.hypot(ex - sx, ey - sy) * S.arrowBend;
  return { sx, sy, mx: sx + dx * k, my: sy + dy * k, ex, ey, target: true };
}

// Pure helper (tested): a point at u (0..1) on a hudStepArrowPath curve.
function hudStepArrowPoint(p, u) {
  const a = (1 - u) * (1 - u);
  const b = 2 * (1 - u) * u;
  const c = u * u;
  return { x: a * p.sx + b * p.mx + c * p.ex, y: a * p.sy + b * p.my + c * p.ey };
}

// Pure helper (tested): the fling arrow as sample circles (screen coords) for placement.
// tx / ty / tr (optional): the target planet the arrow bends onto (see hudStepArrowPath).
function hudStepArrowCircles(cx, cy, dirX, dirY, tx, ty, tr) {
  const S = HUD_STEP;
  const p = hudStepArrowPath(cx, cy, dirX, dirY, tx, ty, tr);
  const out = [];
  if (!p) return out;
  for (let i = 0; i <= S.arrowSamples; i++) out.push(Object.assign(hudStepArrowPoint(p, i / S.arrowSamples), { r: 26 }));
  return out;
}

// Pure helper (tested): every spot for a box, scored. circles: [{x, y, r}] it must clear by
// HUD_STEP.gap (bodies, the arrow); rects: blocks it must clear by HUD_STEP.rectGap; want: the
// point it would like to be near (want.below > 0 makes spots under it cost more). Grid search
// inside the screen margin at each of HUD_STEP.scales. Returns the clean spots, full size first
// and cheapest first within a size, and the least-overlapping full-size spot as a fallback.
function hudStepScan(box, circles, rects, want, screen) {
  const S = HUD_STEP;
  const W = (screen && screen.w) || GAME_WIDTH;
  const H = (screen && screen.h) || GAME_HEIGHT;
  const top = (screen && screen.top) || S.margin;
  const wx = want && isFinite(want.x) ? want.x : W / 2;
  const wy = want && isFinite(want.y) ? want.y : H / 2;
  const below = (want && want.below) || 0;
  const clean = [];
  let fallback = null;
  S.scales.forEach((scale, si) => {
    const x0 = S.margin - box.l * scale;
    const x1 = W - S.margin - box.r * scale;
    const y0 = top - box.t * scale;
    const y1 = H - S.margin - box.b * scale;
    const found = [];
    for (let y = y0; y <= y1 + 0.01; y += S.grid) {
      for (let x = x0; x <= x1 + 0.01; x += S.grid) {
        const r = hudStepRect(box, x, y, scale);
        let overlap = 0;
        for (const c of circles || []) {
          const d = hudBoxDistance(c.x, c.y, r.left, r.top, r.right, r.bottom) - (c.r || 0);
          if (d < S.gap) overlap += S.gap - d;
        }
        for (const rr of rects || []) {
          const d = hudRectGap(rr, r);
          if (d < S.rectGap) overlap += S.rectGap - d + (hudRectsOverlap(rr, r, 0) ? 200 : 0);
        }
        const mx = (r.left + r.right) / 2;
        const my = (r.top + r.bottom) / 2;
        const cost = Math.hypot(mx - wx, my - wy) + (my > wy ? (my - wy) * below : 0);
        if (overlap === 0) found.push({ x, y, scale, cost, clean: true });
        else if (si === 0 && (!fallback || overlap * 50 + cost < fallback.cost)) fallback = { x, y, scale, cost: overlap * 50 + cost, clean: false };
      }
    }
    found.sort((a, b) => a.cost - b.cost);
    for (const f of found) clean.push(f);
  });
  return { clean, fallback: fallback || { x: W / 2, y: H / 2, scale: S.scales[S.scales.length - 1], cost: Infinity, clean: false } };
}

// Pure helper (tested): the best spot for a box (see hudStepScan): {x, y, scale, clean}; clean
// is false only when no size had a free spot (then the least-overlapping full-size spot).
function hudStepPlace(box, circles, rects, want, screen) {
  const scan = hudStepScan(box, circles, rects, want, screen);
  const best = scan.clean[0] || scan.fallback;
  return { x: best.x, y: best.y, scale: best.scale, clean: best.clean };
}

// Pure helper (tested): the spot still works with these circles / rects (kept as it is rather
// than re-placed every frame while the page barely moves in slow motion).
function hudStepSpotClear(box, spot, circles, rects) {
  if (!spot) return false;
  const S = HUD_STEP;
  const r = hudStepRect(box, spot.x, spot.y, spot.scale);
  for (const c of circles || []) {
    if (hudBoxDistance(c.x, c.y, r.left, r.top, r.right, r.bottom) - (c.r || 0) < S.gap * 0.5) return false;
  }
  for (const rr of rects || []) if (hudRectGap(rr, r) < S.rectGap * 0.5) return false;
  return true;
}

// Pure helper (tested): what a step has to keep clear of, from GameScene's info (screen coords;
// cheap, so it runs on every call): the spotlights {x, y, r}, the bodies nothing may cover, the
// circles to clear (bodies + the fling arrow on 'letgo'), the HUD rects and the usable screen.
// top: the highest y the hand / word may use (below the score note / card row).
function hudStepScene(step, info, top) {
  const S = HUD_STEP;
  const num = (v) => (typeof v === 'number' && isFinite(v) ? v : null);
  const i = info || {};
  const cx = num(i.cx);
  const cy = num(i.cy);
  const px = num(i.px);
  const py = num(i.py);
  const pr = num(i.pr);
  const dirX = num(i.dirX);
  const dirY = num(i.dirY);
  const spots = [];
  const bodies = [];
  const planet = px !== null && py !== null ? { x: px, y: py } : null;
  const comet = cx !== null && cy !== null ? { x: cx, y: cy } : null;
  // 'letgo' with tx / ty: px / py / pr is the planet the comet orbits (kept clear, not lit) and
  // tx / ty / tr the target (lit; the arrow bends onto it). Without tx: px is the target.
  const target = step === 'letgo' && num(i.tx) !== null && num(i.ty) !== null
    ? { x: num(i.tx), y: num(i.ty), r: num(i.tr) !== null ? num(i.tr) : S.arrowTargetR } : null;
  if (target) {
    spots.push({ x: target.x, y: target.y, r: hudSpotRadius('planet', target.r) });
    bodies.push({ x: target.x, y: target.y, r: hudBodyRadius('planet', target.r) });
    if (planet) bodies.push({ x: px, y: py, r: hudBodyRadius('planet', pr) });
  } else if (planet) {
    spots.push({ x: px, y: py, r: hudSpotRadius('planet', pr) });
    bodies.push({ x: px, y: py, r: hudBodyRadius('planet', pr) });
  }
  if (comet) {
    spots.push({ x: cx, y: cy, r: hudSpotRadius('comet') });
    bodies.push({ x: cx, y: cy, r: hudBodyRadius('comet') });
  }
  const circles = bodies.slice();
  let arrow = null;
  if (step === 'letgo' && comet) {
    arrow = target ? hudStepArrowPath(cx, cy, dirX, dirY, target.x, target.y, target.r)
      : (dirX !== null && dirY !== null && (dirX || dirY) ? hudStepArrowPath(cx, cy, dirX, dirY) : null);
    if (arrow) {
      for (let k = 0; k <= S.arrowSamples; k++) circles.push(Object.assign(hudStepArrowPoint(arrow, k / S.arrowSamples), { r: 26 }));
    }
  }
  const mid = { x: GAME_WIDTH / 2, y: GAME_HEIGHT / 2 };
  return {
    spots, bodies, circles, arrow, target,
    rects: hudStepHudRects(),
    screen: { top: Math.max(S.margin, typeof top === 'number' && isFinite(top) ? top : S.margin) },
    wordBox: step === 'letgo' ? S.wordLetgoBox : S.wordHoldBox,
    // The hand sits beside what it is about: the planet to hold near, the comet to let go of.
    handWant: step === 'letgo' ? (comet || mid) : (planet || comet || mid),
  };
}

// Pure helper (tested): the whole step laid out: hudStepScene plus the hand and the word spots
// ({x, y, scale, clean}). The hand goes as near its target as it can while still leaving the
// word a clean spot near it (preferably above it: read first, then the finger).
function hudStepLayout(step, info, top) {
  const S = HUD_STEP;
  const scene = hudStepScene(step, info, top);
  const hands = hudStepScan(S.handBox, scene.circles, scene.rects, scene.handWant, scene.screen);
  const tried = [];
  let first = null;
  const tryHand = (hand) => {
    const hr = hudStepRect(S.handBox, hand.x, hand.y, hand.scale);
    const grown = { left: hr.left - S.wordGap, right: hr.right + S.wordGap, top: hr.top - S.wordGap, bottom: hr.bottom + S.wordGap };
    const word = hudStepPlace(scene.wordBox, scene.circles, scene.rects.concat([grown]),
      { x: (hr.left + hr.right) / 2, y: (hr.top + hr.bottom) / 2, below: 0.6 }, scene.screen);
    // The pair reads as one instruction only when the word sits close to the finger: a word
    // far away (or shrunk) costs as much as moving the hand further from its target.
    const wr = hudStepRect(scene.wordBox, word.x, word.y, word.scale);
    const apart = hudRectGap(grown, wr);
    // A shrunk word costs more than a shrunk hand: the lettering is what has to read at phone size.
    const cost = (hand.cost || 0) + apart * 1.5 + (1 - hand.scale) * 200 + (1 - word.scale) * 450;
    return Object.assign({}, scene, { hand: { x: hand.x, y: hand.y, scale: hand.scale, clean: hand.clean }, word, handRect: grown, cost });
  };
  // Up to 16 hand spots, each at least 48 px from the ones already tried; the cheapest pair with
  // a clean word wins.
  let best = null;
  for (const hand of hands.clean) {
    if (tried.length >= 16) break;
    if (tried.some(t => t.scale === hand.scale && Math.hypot(t.x - hand.x, t.y - hand.y) < 48)) continue;
    tried.push(hand);
    const L = tryHand(hand);
    if (!first) first = L;
    if (L.word.clean && (!best || L.cost < best.cost)) best = L;
  }
  return best || first || tryHand(hands.fallback);
}

// Pure helper (tested): a layout still works for a fresh hudStepScene (the hand and word stay put
// while the page drifts a few px in slow motion; re-placed when something moves onto them).
function hudStepLayoutClear(layout, scene) {
  if (!layout || !scene || layout.wordBox !== scene.wordBox || layout.screen.top !== scene.screen.top) return false;
  return hudStepSpotClear(HUD_STEP.handBox, layout.hand, scene.circles, scene.rects)
    && hudStepSpotClear(layout.wordBox, layout.word, scene.circles, scene.rects.concat([layout.handRect]));
}

// Pure helper (tested): NICE! stamp center near the comet: above it, below when too high, never
// within HUD_STEP.niceClear of it, inside the screen margin. halfW / halfH: the stamp's half size.
function hudNiceSpot(cx, cy, halfW, halfH) {
  const S = HUD_STEP;
  const x = Math.max(S.margin + halfW, Math.min(GAME_WIDTH - S.margin - halfW, isFinite(cx) ? cx : GAME_WIDTH / 2));
  const yc = isFinite(cy) ? cy : GAME_HEIGHT / 2;
  const minY = POP.top + halfH;
  const maxY = GAME_HEIGHT - POP.bottomMargin - halfH;
  const above = yc - S.niceAbove;
  if (above >= minY && yc - (above + halfH) >= S.niceClear) return { x, y: above };
  const below = Math.min(maxY, yc + S.niceAbove);
  if (below - halfH - yc >= S.niceClear) return { x, y: below };
  return { x, y: Math.max(minY, Math.min(maxY, above)) };
}

// Pure helper (tested): one fade step toward target (0 / 1) over `seconds`; settles exactly.
function hudStepFade(alpha, target, seconds, dt) {
  const step = Math.max(0, dt) / Math.max(1e-3, seconds);
  return target > alpha ? Math.min(target, alpha + step) : Math.max(target, alpha - step);
}

// ---- Off-screen supernova warning (setNovaEta) ----
// eta: seconds until the nova front reaches the comet. Under HUD_NOVA_WARN.eta s with the front
// still below the screen, an orange crayon heat band grows along the bottom edge and a
// scribbled '!!' pulses, faster as eta shrinks.
// Only the last ~0.8 s: earlier it was up most of the late game and read as decoration.
// y: the '!!' sits ABOVE the bottom corner blocks (never level with the km/s readout), x follows
// the comet inside sideMargin.
const HUD_NOVA_WARN = { eta: 0.8, full: 0.2, minLevel: 0.35, hzMin: 3, hzMax: 11, staleMs: 400, belowMargin: 40, ease: 14, panelPad: 14, sideMargin: 24, y: 0 };
// Center y: half the '!!' at its biggest pulse (96 px font x 1.35) plus a gap over the blocks' top.
HUD_NOVA_WARN.y = Math.min(HUD_PANEL.top, HUD_BADGE_PANEL.top) - 96 * 1.35 / 2 - HUD_NOVA_WARN.panelPad;

// Pure helper (tested): warning level 0..1. 0 when far (or bad input) or when the front is
// already up on screen (the player can see it).
function hudNovaWarnLevel(eta, novaScreenY) {
  const W = HUD_NOVA_WARN;
  if (typeof eta !== 'number' || isNaN(eta) || eta >= W.eta) return 0;
  if (typeof novaScreenY === 'number' && isFinite(novaScreenY) && novaScreenY < GAME_HEIGHT - W.belowMargin) return 0;
  const k = Math.max(0, Math.min(1, (W.eta - Math.max(0, eta)) / (W.eta - W.full)));
  return W.minLevel + (1 - W.minLevel) * k;
}

// Pure helper (tested): '!!' center x. Under the comet, inside the screen; it is drawn at
// HUD_NOVA_WARN.y, above the km/s block and the multiplier loop, so it never covers them.
// halfW: half the '!!' width at its largest.
function hudNovaWarnX(cometX, halfW) {
  const W = HUD_NOVA_WARN;
  const lo = W.sideMargin + (halfW || 0);
  const hi = GAME_WIDTH - W.sideMargin - (halfW || 0);
  const want = typeof cometX === 'number' && isFinite(cometX) ? cometX : GAME_WIDTH / 2;
  return lo <= hi ? Math.max(lo, Math.min(hi, want)) : (lo + hi) / 2;
}

// Pure helper (tested): '!!' pulse rate (Hz) for a warning level.
function hudNovaWarnHz(level) {
  const W = HUD_NOVA_WARN;
  return W.hzMin + (W.hzMax - W.hzMin) * Math.max(0, Math.min(1, level || 0));
}

// Orbit danger: an orbit is where late deaths happen (the comet swings low, the zoomed-out camera
// already shows the front, so the off-screen rule kept the '!!' at alpha 0 right up to the jaws:
// measured at 8300 m, the front was on screen from eta ~1 s). While orbiting, the warning starts
// at `eta` s, so a human letting go 150-450 ms after seeing it still gets out.
// staleMs: a setOrbitDanger(level) older than this no longer counts.
const HUD_ORBIT_DANGER = { eta: 1.5, full: 0.35, minLevel: 0.45, staleMs: 300 };

// Pure helper (tested): orbit warning level 0..1 from the nova eta (s): 0 at/after HUD_ORBIT_DANGER.eta,
// at least minLevel inside it, 1 from `full` down.
function hudOrbitDangerLevel(eta) {
  const D = HUD_ORBIT_DANGER;
  if (typeof eta !== 'number' || isNaN(eta) || eta >= D.eta) return 0;
  const k = Math.max(0, Math.min(1, (D.eta - Math.max(0, eta)) / (D.eta - D.full)));
  return D.minLevel + (1 - D.minLevel) * k;
}

// Pure helper (tested): the level the '!!' and heat band aim for. In flight: the last
// HUD_NOVA_WARN.eta s, wherever the front is (on screen it was never shown, and those were
// the deaths that felt unfair). In an orbit: from HUD_ORBIT_DANGER.eta s. orbitDanger: an explicit
// level from GameScene (setOrbitDanger), 0..1. The strongest wins.
function hudNovaWarnTarget(eta, orbiting, orbitDanger) {
  const flight = hudNovaWarnLevel(eta, null);
  const orbit = orbiting ? hudOrbitDangerLevel(eta) : 0;
  const forced = typeof orbitDanger === 'number' && isFinite(orbitDanger) ? Math.max(0, Math.min(1, orbitDanger)) : 0;
  return Math.max(flight, orbit, forced);
}

// ---- Tutorial HOLD: dashed ink gravity lines from the planet to the comet ----
// Three dashed pen curves fan from the planet's surface to just short of the comet (the outer two
// bow outward, like field lines); the dashes march toward the planet (it pulls), advancing one
// step per boil tick, never every frame. width / under: cream pen and its dark under-stroke.
const HUD_GRAVITY = {
  lines: 3, spread: 0.34, endSpread: 26, bend: 0.2, samples: 14, dash: 30, gap: 14, flowPerTick: 8,
  minLen: 40, surfacePad: 4, cometPad: 40, width: 8.5, widthMid: 10, under: 16,
};

// Pure helper (tested): the gravity lines as curves {x1, y1, mx, my, x2, y2}: x1/y1 at the comet
// end, x2/y2 on the planet's surface, mx/my the quadratic control point (screen coords). [] when
// the gap is too short or input is junk.
function hudGravityLines(px, py, pr, cx, cy) {
  const G = HUD_GRAVITY;
  const ok = (v) => typeof v === 'number' && isFinite(v);
  if (!ok(px) || !ok(py) || !ok(cx) || !ok(cy)) return [];
  const r = ok(pr) && pr > 0 ? pr : 0;
  const d = Math.hypot(cx - px, cy - py);
  const a = Math.atan2(cy - py, cx - px);
  const startR = r * 1.08 + G.surfacePad;
  if (d - startR - G.cometPad < G.minLen) return [];
  const out = [];
  for (let i = 0; i < G.lines; i++) {
    const k = G.lines > 1 ? i / (G.lines - 1) - 0.5 : 0;   // -0.5 .. 0.5
    const sa = a + k * 2 * G.spread;
    const x2 = px + Math.cos(sa) * startR;
    const y2 = py + Math.sin(sa) * startR;
    // Comet end: on the comet's ring, slightly fanned so the three lines stay apart.
    const ea = a + Math.PI;
    const nx = -Math.sin(ea);
    const ny = Math.cos(ea);
    const x1 = cx + Math.cos(ea) * G.cometPad + nx * k * 2 * G.endSpread;
    const y1 = cy + Math.sin(ea) * G.cometPad + ny * k * 2 * G.endSpread;
    // Control point: the chord's middle pushed out sideways (outer lines bow away from the middle one).
    const len = Math.hypot(x2 - x1, y2 - y1) || 1;
    const bx = -(y2 - y1) / len;
    const by = (x2 - x1) / len;
    const bow = k * 2 * G.bend * len;
    out.push({ x1, y1, mx: (x1 + x2) / 2 + bx * bow, my: (y1 + y2) / 2 + by * bow, x2, y2 });
  }
  return out;
}

// Pure helper (tested): dashes along a segment from (x1, y1) to (x2, y2), shifted `phase` px
// toward the end (wraps every dash + gap). Each dash is clipped to the segment.
function hudDashSegments(x1, y1, x2, y2, dash, gap, phase) {
  const len = Math.hypot(x2 - x1, y2 - y1);
  const period = dash + gap;
  if (!(len > 0) || !(period > 0) || !(dash > 0)) return [];
  const ux = (x2 - x1) / len;
  const uy = (y2 - y1) / len;
  const shift = ((phase % period) + period) % period;
  const out = [];
  for (let s = shift - period; s < len; s += period) {
    const a = Math.max(0, s);
    const b = Math.min(len, s + dash);
    if (b - a < 2) continue;
    out.push({ x1: x1 + ux * a, y1: y1 + uy * a, x2: x1 + ux * b, y2: y1 + uy * b });
  }
  return out;
}

// Pure helper (tested): dashes along the quadratic curve L ({x1, y1, mx, my, x2, y2}), as straight
// chords {x1, y1, x2, y2} between points `dash` px apart along the curve (short enough to look
// curved together), shifted `phase` px toward the planet end. Measured on `samples` points.
function hudDashCurve(L, dash, gap, phase, samples) {
  const n = Math.max(2, samples || HUD_GRAVITY.samples);
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const u = 1 - t;
    pts.push({ x: u * u * L.x1 + 2 * u * t * L.mx + t * t * L.x2, y: u * u * L.y1 + 2 * u * t * L.my + t * t * L.y2 });
  }
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
  const len = cum[cum.length - 1];
  const at = (s) => {
    let i = 1;
    while (i < cum.length - 1 && cum[i] < s) i++;
    const seg = cum[i] - cum[i - 1] || 1;
    const f = (s - cum[i - 1]) / seg;
    return { x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * f, y: pts[i - 1].y + (pts[i].y - pts[i - 1].y) * f };
  };
  const period = dash + gap;
  if (!(len > 0) || !(period > 0) || !(dash > 0)) return [];
  const shift = ((phase % period) + period) % period;
  const out = [];
  for (let s = shift - period; s < len; s += period) {
    const a = Math.max(0, s);
    const b = Math.min(len, s + dash);
    if (b - a < 2) continue;
    // Long dashes are split in two chords so they follow the bend.
    const m = (a + b) / 2;
    for (const [s0, s1] of [[a, m], [m, b]]) {
      const p0 = at(s0);
      const p1 = at(s1);
      out.push({ x1: p0.x, y1: p0.y, x2: p1.x, y2: p1.y, dash: out.length >> 1 });
    }
  }
  return out;
}

// ---- First-run taped note ('Planets are your friends: ...') ----
const HUD_FIRST_NOTE = { w: 470, h: 136, size: 36, holdMs: 2000, inMs: 200, outMs: 260, wantY: 560, cometPad: 90, bodyPad: 24 };

// Pure helper (tested): a note's text as at most two lines, split after ':' (or near the middle
// word break when there is no colon).
function hudNoteLines(text) {
  const s = String(text || '').trim();
  const colon = s.indexOf(':');
  if (colon > 0 && colon < s.length - 1) return [s.slice(0, colon + 1).trim(), s.slice(colon + 1).trim()];
  if (s.length <= 24) return [s];
  const mid = Math.floor(s.length / 2);
  let cut = -1;
  for (let k = 0; k <= mid; k++) {
    if (s[mid - k] === ' ') { cut = mid - k; break; }
    if (s[mid + k] === ' ') { cut = mid + k; break; }
  }
  return cut > 0 ? [s.slice(0, cut).trim(), s.slice(cut + 1).trim()] : [s];
}

// Pure helper (tested): where the note goes: clear of the comet, the planets / black holes
// (circles {x, y, r}), the score note, the km/s and x-loop blocks, the pause button and the card
// strip (rects), as near HUD_FIRST_NOTE.wantY as it can. Returns {x, y, scale, clean}.
function hudFirstNotePlace(comet, bodies, extraRects) {
  const N = HUD_FIRST_NOTE;
  const box = { l: -N.w / 2 - 22, r: N.w / 2 + 22, t: -N.h / 2 - 22, b: N.h / 2 + 22 };
  const circles = [];
  if (comet && isFinite(comet.x) && isFinite(comet.y)) circles.push({ x: comet.x, y: comet.y, r: N.cometPad });
  for (const b of bodies || []) if (b && isFinite(b.x) && isFinite(b.y)) circles.push({ x: b.x, y: b.y, r: (b.r || 0) + N.bodyPad });
  const rects = hudStepHudRects().concat(extraRects || []);
  return hudStepPlace(box, circles, rects, { x: GAME_WIDTH / 2, y: N.wantY }, { top: POP.top - 40 });
}

// ---- One-time 'CLOSER = FASTER' stamp and card proc pops ----
// afterMs: a waiting stamp comes out this long after the screen is clear of banners and stamps.
const HUD_CLOSER = { size: 56, holdMs: 1300, fadeMs: 320, cometDodge: 36, afterMs: 250 };

// Pure helper (tested): a waiting CLOSER = FASTER may be stamped now: nothing big on screen
// (busy: banner, card pick, set bonus, tutorial step, another stamp) for at least afterMs.
function hudCloserMayStamp(busy, now, clearAt) {
  if (busy) return false;
  return now - (isFinite(clearAt) ? clearAt : -1e9) >= HUD_CLOSER.afterMs;
}
// Card proc: the card's mini index card pops above the comet for ~0.4 s over a small ink burst in
// its family crayon. gapMs: the same card at most this often; rise: px above the comet.
// iconGapMs: the mini card itself pops at most this often per card, and never while another
// card's icon is still on screen (the burst on the comet still plays every gapMs).
const HUD_PROC = { gapMs: 260, iconGapMs: 3000, rise: 100, scale: 0.95, inMs: 140, holdMs: 120, outMs: 160, burst: 5, reach: 62, minY: 150 };

// Pure helper (tested): a proc's mini card may pop: no icon on screen and this card's last icon
// at least iconGapMs ago (lastIconAt undefined = never).
function hudProcIconAllowed(now, lastIconAt, iconOnScreen) {
  if (iconOnScreen) return false;
  return lastIconAt === undefined || !isFinite(lastIconAt) || now - lastIconAt >= HUD_PROC.iconGapMs;
}

// Pure helper (tested): the proc icon's spot above the comet (below it when the comet is too high),
// kept inside the side margins.
function hudProcSpot(x, y) {
  const P = HUD_PROC;
  const cx = Math.max(60, Math.min(GAME_WIDTH - 60, isFinite(x) ? x : GAME_WIDTH / 2));
  const cy = isFinite(y) ? y : GAME_HEIGHT / 2;
  const up = cy - P.rise;
  return { x: cx, y: up >= P.minY ? up : cy + P.rise, from: cy };
}

// ---- Declutter: the score note and the corner blocks step back over planets / the comet ----

// Pure helper (tested): any circle {x, y, r} (planet, black hole, comet) within pad of the rect.
function hudCirclesUnder(rect, circles, pad) {
  for (const c of circles || []) {
    if (!c || typeof c.x !== 'number' || typeof c.y !== 'number' || !isFinite(c.x) || !isFinite(c.y)) continue;
    const d = hudBoxDistance(c.x, c.y, rect.left, rect.top, rect.right, rect.bottom) - (c.r || 0);
    if (d <= 0 || d < (pad || 0)) return true;
  }
  return false;
}

// Score note (top-left) bounds, and its alpha while something flies under it.
// rect: the whole note texture (kept clear by the tutorial layout); paper: the paper actually
// drawn (texture corners ~20..272 x 22..164 round the note at 160, 142). The note is opaque
// paper and stays at full alpha while planets pass behind it (fading read as a glitch); only
// the comet itself really under the paper steps it back to `under`, so the hero never hides.
const HUD_NOTE = { rect: { left: 15, right: 305, top: 52, bottom: 236 }, paper: { left: 33, right: 289, top: 72, bottom: 218 }, under: 0.5, pad: 6, ease: 8 };

// Set bonus: short, high, never in the lower third or near the bottom speed band.
const HUD_SETBONUS = { y: 300, rowGap: 110, cometBand: 190, below: 250, maxY: 720, holdMs: 900, fadeMs: 300, labelDy: -82, subDy: 92, subHalf: 24 };

// Pure helper (tested): set bonus center y. High under the card row; pushed under the comet only
// when the comet flies right through that band, and capped well above the bottom band.
function hudSetBonusY(cometY, rowBottom) {
  const S = HUD_SETBONUS;
  const high = Math.max(S.y, (rowBottom || 0) + S.rowGap);
  if (typeof cometY === 'number' && isFinite(cometY) && Math.abs(cometY - high) < S.cometBand) {
    return Math.min(S.maxY, Math.max(high, cometY + S.below));
  }
  return Math.min(S.maxY, high);
}

// ---- Pause button (top-right corner, where the fullscreen scrap was) ----
// x, y: center; hit: touch target side (>= 100 px); tex: icon texture side.
const HUD_PAUSE_BUTTON = { x: GAME_WIDTH - 92, y: 116, hit: 116, tex: 120 };

// Pure helper (tested): may the run be paused now? s: pauseState(); reason: 'button' / 'key'
// (the player asked) or 'hidden' / 'blur' (auto). Never in the headless simulator, after the
// run is over or when already paused. Auto-pause only during real play: not in the opening
// scene and not while a tutorial step waits (the world is already frozen there), though the
// button still works there.
function hudCanPause(s, reason) {
  if (!s || !s.gameActive || s.headless || s.isOver || s.paused) return false;
  const auto = reason === 'hidden' || reason === 'blur';
  if (auto) return !!s.launched && !s.introActive && !s.tutorialWaiting;
  return true;
}

// Doodled '||' on a yellow crayon scrap: two thick gel-pen bars of slightly different height
// and tilt, each traced twice, so it reads hand-drawn like the speaker / fullscreen scraps.
function hudPauseTexture(scene) {
  const S = HUD_PAUSE_BUTTON.tex;
  return uiSketchTexture(scene, 'hud_pause_icon', S, S, (ctx, shape, jitter) => {
    uiIconScrap(ctx, shape, jitter, S / 2, S / 2, 80, 78, UI_CRAYON.yellow);
    for (const [cx, top, bottom, lean] of [[S / 2 - 13, 34, 87, -0.06], [S / 2 + 14, 37, 85, 0.05]]) {
      const x0 = cx + (shape() - 0.5) * 3;
      const pts = [];
      for (let i = 0; i <= 4; i++) {
        const t = i / 4;
        const y = top + (bottom - top) * t + (shape() - 0.5) * 2;
        pts.push({ x: x0 + lean * (y - S / 2) + (jitter() - 0.5) * 2, y });
      }
      uiIconLine(ctx, pts, jitter, { width: 11 });
    }
  });
}

function hudMakePauseButton(scene, onPress) {
  const B = HUD_PAUSE_BUTTON;
  const icon = uiBoilImage(scene, 0, 0, hudPauseTexture(scene)).setRotation(-0.04);
  const btn = scene.add.container(B.x, B.y, [icon]).setDepth(1000);
  btn.setSize(B.hit, B.hit);
  btn.setInteractive({ useHandCursor: true });
  btn.on('pointerdown', () => btn.setScale(1.06, 0.9));
  btn.on('pointerout', () => btn.setScale(1));
  btn.on('pointerup', () => {
    btn.setScale(1);
    scene.game.events.emit('sfx', 'click', {});
    onPress();
  });
  return btn;
}

const HUD_LEVEL_TINTS = [UI_INK.cream, UI_CRAYON.yellow, UI_CRAYON.orange, UI_CRAYON.red, UI_CRAYON.pink];

class HudScene extends Phaser.Scene {
  constructor() {
    super('Hud');
  }

  create() {
    uiMakeHudTextures(this);
    // Red crayon scribble along the bottom edge that thickens as the supernova closes in.
    this.danger = uiBoilImage(this, GAME_WIDTH / 2, GAME_HEIGHT, 'hud_danger').setOrigin(0.5, 1).setTint(UI_CRAYON.red).setAlpha(0);
    // Soft full-screen flash (PERFECT / close call). Very light, so the palette never goes pale.
    this.flashRect = this.add.rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT, 0xffffff).setOrigin(0).setAlpha(0);
    // Off-screen supernova warning (setNovaEta): orange crayon heat along the bottom edge and a
    // scribbled '!!' that pulses faster as the nova closes in.
    this.heat = uiBoilImage(this, GAME_WIDTH / 2, GAME_HEIGHT, 'hud_heat').setOrigin(0.5, 1).setTint(UI_CRAYON.orange).setAlpha(0);
    this.warnText = uiInkText(this, GAME_WIDTH / 2, HUD_NOVA_WARN.y, '!!', {
      size: 96, color: uiColorHex(UI_CRAYON.red), strokeW: 12, rot: -0.08, boilAmount: 0.05,
    }).setAlpha(0);
    this.novaEta = Infinity;    // last setNovaEta (seconds)
    this.novaEtaAt = -1e9;      // time it came
    this.novaScreenY = null;    // supernova front, screen y (updateNovaNear)
    this.warnLevel = 0;         // eased hudNovaWarnLevel
    this.warnPhase = 0;         // '!!' pulse phase (turns)
    this.noteFade = 1;          // score note alpha (steps back over planets / the comet)
    this.badgeFade = 1;         // multiplier loop alpha (same)
    this.badgeFadeTarget = 1;
    this.targetScore = 0;
    this.shownScore = 0;
    this.targetSpeed = 0;     // km/s shown by the readout, counted toward smoothly
    this.shownSpeed = 0;
    this.speedFrac = 0;
    this.lastMultiplier = 1;
    this.multStampMax = 1;     // highest multiplier already stamped big this run
    this.chain = 0;
    this.popLine = null;      // the one pop on screen (or null)
    this.popQueue = [];       // high pops waiting for the current high pop's minimum hold
    this.comet = null;        // comet screen position from setCometScreen
    this.panelFade = 1;       // bottom band alpha (dims when the comet flies behind it)
    this.panelFadeTarget = 1;
    this.lightPage = false;   // true on the cream ESCAPE VELOCITY page: page ink turns dark
    this.pageIndex = undefined;  // set by setPage(); until then the Game scene's zone is read
    this.inkZone = undefined;    // zone index the page ink was last decided for (inkLight)
    // Last values written to each text, so setText/setColor (which re-render the text texture)
    // only run when something actually changed.
    this.shown = {};
    this.chainY = 204;        // right of the score note, under the owned-card strip

    // Taped note (top-left, below the notch-safe line): score big, altitude under it.
    const note = uiBoilImage(this, 0, 0, 'hud_note');
    this.scoreText = this.add.text(-112, -16, '0', { fontFamily: FONT, fontSize: '64px', color: UI_INK.darkHex })
      .setOrigin(0, 0.5);
    this.altText = this.add.text(-108, 40, '0 m', { fontFamily: FONT, fontSize: '30px', color: UI_INK.pencilDarkHex })
      .setOrigin(0, 0.5);
    this.note = this.add.container(160, 142, [note, this.scoreText, this.altText]).setRotation(-0.035);
    uiBoilRotation(this, this.note, 0.006);
    // PERFECT chain as 'combo 7': a small pencil word and a big number. No 'x' here: the 'x'
    // belongs only to the score multiplier loop at the bottom.
    this.comboWord = uiInkText(this, 0, 4, 'combo', { size: 26, color: uiColorHex(UI_CRAYON.yellow), ox: 0, rot: 0, boil: false });
    this.comboNum = uiInkText(this, this.comboWord.width + 10, -2, '', { size: 50, color: uiColorHex(UI_CRAYON.yellow), ox: 0, rot: 0, boil: false });
    this.comboTicks = this.add.graphics();
    this.comboLayer = this.add.container(316, this.chainY, [this.comboWord, this.comboNum, this.comboTicks]).setAlpha(0);
    this.comboLayer.inkRot = -0.03;
    this.comboLayer.setRotation(-0.03);
    uiBoilRotation(this, this.comboLayer, 0.012);
    this.chainText = this.comboNum;   // kept for older callers that read hud.chainText
    this.milestone = null;    // the chain milestone (or MACH) stamp on screen (or null)
    this.machWait = [];       // MACH tier stamps waiting for a clear screen
    this.machClearAt = 0;     // last time the screen was busy for a MACH stamp
    this.step = null;         // one-time guided tutorial overlay (built on first use; see showTutorialStep)
    this.stepBanner = null;   // banner asked for while a tutorial step waits
    this.stepMilestone = null;  // chain stamp asked for while a tutorial step waits
    this.stepNiceShown = false;
    this.popSeen = {};        // pop kind -> time it last came out (HUD_REPEAT)
    this.stampSeen = {};      // stamp word -> time it was last stamped
    this.cardRowFade = 1;     // owned-card strip alpha (steps back only with a planet body under it)
    this.cardSetsShown = [];  // families whose set loops are drawn
    this.cardFlashAt = {};    // card id -> time its icon last flashed
    this.popGate = { lossAt: -1e9, newAt: -1e9 };   // HUD_POP_GATE
    this.namedPopCount = {};  // card name pop -> times written this run
    this.popWait = [];      // pops waiting for a banner to fade (see POP_WAIT)
    this.bannerClearAt = 0;   // time the last banner stopped being readable
    this.nextWaitAt = 0;      // earliest time the next waiting pop may show
    this.orbitDanger = 0;     // setOrbitDanger level and when it came
    this.orbitDangerAt = -1e9;
    this.warnBeat = 0;        // '!!' beat (warnPulse)
    this.firstNote = null;    // showFirstRunNote's taped note (or null)
    this.closerStamp = null;  // the one-time 'CLOSER = FASTER' stamp (or null)
    this.closerShown = false; // stamped (or waiting) this HUD life; GameScene keeps the lifetime flag
    this.closerPending = false;
    this.closerClearAt = 0;   // last time the screen was busy for a waiting CLOSER = FASTER
    this.procIcon = null;     // the card proc's mini card above the comet (or null)
    this.procAt = {};         // card id -> time of its last proc burst
    this.procIconAt = {};     // card id -> time of its last proc mini card (hudProcIconAllowed)

    // Speed written on the page, with a crayon underline (redrawn only on boil ticks / growth).
    // Crayon smudge first, so the underline, crown and number are all drawn on top of it.
    // The block is written on a torn cream scrap (HUD_SCRAP) in dark ink on every page, so the
    // number reads over planets, rings and the supernova; the old ink smudge stays hidden.
    this.speedHalo = uiBoilImage(this, HUD_HALO.x, HUD_HALO.y, 'hud_speed_halo').setTint(HUD_HALO.ink).setAlpha(HUD_HALO.alpha).setVisible(false);
    const SS = HUD_SCRAP.speed;
    this.speedScrap = uiBoilImage(this, SS.x, SS.y, 'hud_speed_scrap').setRotation(SS.rot).setAlpha(HUD_SCRAP.alpha);
    const SB = HUD_SCRAP.badge;
    this.badgeScrap = uiBoilImage(this, SB.x, SB.y, 'hud_badge_scrap').setRotation(SB.rot).setAlpha(HUD_SCRAP.alpha);
    // Pencil edges round both scraps, only on the pale pages (updatePageInk).
    this.speedScrapEdge = uiBoilImage(this, SS.x, SS.y, 'hud_speed_scrap_edge').setRotation(SS.rot).setVisible(false);
    this.badgeScrapEdge = uiBoilImage(this, SB.x, SB.y, 'hud_badge_scrap_edge').setRotation(SB.rot).setVisible(false);
    this.novaNear = 0;          // eased hudNovaNear() of the supernova front (Game scene)
    this.novaDrawn = 0;         // novaNear the crown was last drawn at
    this.speedLine = this.add.graphics();
    this.momentumGfx = this.add.graphics();   // flame licks behind the number (setMomentum)
    this.momentum = 0;          // shown momentum, eased toward momentumTarget
    this.momentumTarget = 0;
    this.momentumDrawn = -1;    // momentum the flames were last drawn at
    this.speedPunch = 0;        // extra readout scale from the last boost, settling back
    this.speedSeen = false;     // the first setStats only sets the number (no punch at launch)
    this.speedBaseX = HUD_SPEED.x;
    this.speedBaseY = HUD_SPEED.y;
    this.speedText = uiInkText(this, this.speedBaseX, this.speedBaseY, '', { size: HUD_SPEED.size, rot: -0.03, boil: false, color: UI_INK.darkHex, stroke: UI_INK.creamHex });
    // 'MACH 1568' in smaller lettering under the underline: the same speed, a huger number.
    this.machText = uiInkText(this, HUD_SPEED.x - 4, HUD_SPEED.lineY + HUD_MACH.dy, '', {
      size: HUD_MACH.size, color: uiColorHex(hudDeepen(UI_CRAYON.orange, 0.7)), stroke: UI_INK.creamHex, strokeW: 5, rot: -0.025, boilAmount: 0.008,
    });
    this.createMultiplierBadge();
    this.bottomPanel = this.add.container(0, 0, [this.speedHalo, this.speedScrap, this.badgeScrap, this.speedScrapEdge, this.badgeScrapEdge, this.speedLine, this.momentumGfx, this.speedText, this.machText, this.badge]);
    // One layer for the stats, so the intro fade never fights the bump tweens on its children.
    this.statsLayer = this.add.container(0, 0, [this.note, this.bottomPanel]);
    const game = this.scene.get('Game');
    if (game && game.introActive) this.statsLayer.setAlpha(0);
    // Banner: off-register crayon copy behind the ink title, a scribbled underline, a subtitle.
    this.bannerShadow = this.add.text(GAME_WIDTH / 2 + 6, 407, '', { fontFamily: FONT, fontSize: '84px', color: uiColorHex(UI_CRAYON.orange) })
      .setOrigin(0.5).setAlpha(0).setRotation(-0.035);
    this.bannerText = this.add.text(GAME_WIDTH / 2, 400, '', {
      fontFamily: FONT, fontSize: '84px', color: UI_INK.creamHex, stroke: UI_INK.darkHex, strokeThickness: 10,
    }).setOrigin(0.5).setAlpha(0).setRotation(-0.035);
    this.bannerLine = uiBoilImage(this, GAME_WIDTH / 2 + 8, 452, 'ui_underline').setTint(UI_CRAYON.orange).setAlpha(0).setRotation(-0.02);
    this.bannerSub = uiInkText(this, GAME_WIDTH / 2, 492, '', { size: 34, rot: 0.015 }).setAlpha(0);
    this.cardBadges = [];      // { id, gfx } per owned card, left to right
    this.cardLoops = [];       // gold loops round completed set groups
    // The scene object outlives a restart: drop the last run's (destroyed) row container.
    this.cardRow = null;
    this.setBonusLayer = null;
    this.setBonusWait = [];    // set bonuses waiting for the zone banner / card pick / another set
    this.pendingBanner = null; // banner waiting for a set bonus to clear out
    this.bigClearAt = 0;       // last time a banner or set bonus was on screen
    // Top-right corner: the pause button (fullscreen and sound live on the pause note).
    this.pauseButton = hudMakePauseButton(this, () => this.openPause('button'));
    this.wireAutoPause();
    uiOnBoil(this, (v, tick) => { this.boilTick = tick; this.drawSpeedLine(true); this.drawMomentum(true); });
  }

  // ---- Pause (PauseScene over Game + Hud) ----

  // Snapshot of the Game scene for hudCanPause (missing scene = nothing to pause).
  pauseState() {
    const game = this.scene.get('Game');
    const mgr = this.game.scene;
    return {
      gameActive: !!(game && this.scene.isActive('Game')),
      headless: !!(game && game.headless),
      isOver: !!(game && game.isOver),
      launched: !!(game && game.launched),
      introActive: !!(game && game.introActive),
      tutorialWaiting: !!(game && game.tutorialWaiting),
      paused: !!(mgr.keys.Pause && (this.scene.isActive('Pause') || this.scene.isPaused('Pause'))),
    };
  }

  // reason: 'button' | 'key' (manual) | 'hidden' | 'blur' (auto). Launches PauseScene on top.
  openPause(reason) {
    if (!this.game.scene.keys.Pause) return false;
    if (!hudCanPause(this.pauseState(), reason)) return false;
    this.scene.launch('Pause', { reason });
    this.scene.bringToTop('Pause');
    return true;
  }

  // Auto-pause when the page is hidden or the window loses focus (itch iframe: a click on the
  // page around the game), and ESC / P as optional desktop keys. Unhooked on shutdown, since
  // game.events outlive the scene.
  wireAutoPause() {
    const onHidden = () => this.openPause('hidden');
    const onBlur = () => this.openPause('blur');
    this.game.events.on('hidden', onHidden);
    this.game.events.on('blur', onBlur);
    this.events.once('shutdown', () => {
      this.game.events.off('hidden', onHidden);
      this.game.events.off('blur', onBlur);
    });
    if (this.input.keyboard) {
      this.input.keyboard.on('keydown-ESC', () => this.openPause('key'));
      this.input.keyboard.on('keydown-P', () => this.openPause('key'));
    }
  }

  // Owned upgrade cards as small taped icon scraps in the HUD's top band (hudCardStripSlots):
  // right of the score note, left of the pause button, never in the play field. Each
  // family's cards sit together; every card of a completed set gets a small gold crayon loop.
  // New cards are slapped on with an ink burst; a proc flashes its card (flashCard).
  setCards(ownedIds) {
    const raw = (ownedIds || []).filter(id => typeof cardById === 'function' && cardById(id));
    const ids = typeof cardGroupedOrder === 'function' ? cardGroupedOrder(raw) : raw;
    const sets = typeof activeSetBonuses === 'function' ? activeSetBonuses(ids) : [];
    const known = this.cardBadges.map(b => b.id);
    for (const b of this.cardBadges) b.gfx.destroy();
    for (const l of this.cardLoops) l.destroy();
    this.cardBadges = [];
    this.cardLoops = [];
    const L = HUD_CARDS;
    if (!this.cardRow) this.cardRow = this.add.container(0, 0);
    const slots = hudCardStripSlots(ids.length);
    const ink = this.lightPage ? UI_INK.dark : UI_INK.cream;
    ids.forEach((id, i) => {
      const card = cardById(id);
      const { x, y } = slots[i];
      if (sets.indexOf(card.family) >= 0) {
        const loop = uiBoilImage(this, x, y + 1, cardSetLoopTexture(this)).setScale(L.scale);
        if (this.lightPage) loop.setTint(0xc0861a);
        this.cardRow.add(loop);
        this.cardLoops.push(loop);
        if (known.indexOf(id) < 0 || this.cardSetsShown.indexOf(card.family) < 0) {
          // The loop is scrawled round the card once the new card has landed.
          loop.setAlpha(0).setScale(L.scale * 0.85);
          this.tweens.add({ targets: loop, alpha: 1, scale: L.scale, delay: 380, duration: 200, ease: 'Back.Out' });
        }
      }
      const g = cardMakeMini(this, x, y, id, L.scale);
      this.cardRow.add(g);
      this.cardBadges.push({ id, gfx: g, x, y });
      if (known.indexOf(id) < 0) {
        g.setScale(L.scale * 1.8).setAlpha(0);
        this.tweens.add({ targets: g, scale: L.scale, alpha: 1, duration: 220, delay: 120, ease: 'Quad.In',
          onComplete: () => {
            g.setScale(L.scale * 1.12, L.scale * 0.86);
            this.tweens.add({ targets: g, scaleX: L.scale, scaleY: L.scale, duration: 200, ease: 'Back.Out' });
            cardDoodleBurst(this, x, y, [cardCrayon(card.family), ink], { count: 6, reach: 70, ink: this.lightPage ? UI_INK.dark : undefined });
          } });
      }
    });
    this.cardSetsShown = sets.slice();
  }

  // A card's proc after its name was already written (GameScene.cardProcPop, and pop() once a
  // card name has come out HUD_POP_GATE.namedMax times): the card's taped icon wiggles and a
  // crayon smudge flares behind it in the family color. Rate-limited per card.
  flashCard(id) {
    const badge = this.cardBadges && this.cardBadges.find(b => b.id === id);
    if (!badge || !badge.gfx || !badge.gfx.active) return;
    const now = this.time.now;
    if (!this.cardFlashAt) this.cardFlashAt = {};
    if (!hudCardFlashAllowed(this.cardFlashAt, id, now)) return;
    this.cardFlashAt[id] = now;
    const card = cardById(id);
    const crayon = card ? cardCrayon(card.family) : UI_CRAYON.yellow;
    const L = HUD_CARDS;
    const smudge = uiBoilImage(this, badge.x, badge.y, 'ui_circle').setTint(this.lightPage ? hudDeepen(crayon, 0.75) : crayon)
      .setScale(0.22, 0.34).setAlpha(0.95);
    this.cardRow.addAt(smudge, 0);
    this.tweens.add({ targets: smudge, scaleX: 0.36, scaleY: 0.52, alpha: 0, duration: 420, ease: 'Quad.Out', onComplete: () => smudge.destroy() });
    const g = badge.gfx;
    this.tweens.killTweensOf(g);
    g.setScale(L.scale * 1.3).setAlpha(1);
    g.rotation = g.inkRot || 0;
    this.tweens.add({ targets: g, scale: L.scale, duration: 260, ease: 'Back.Out' });
    this.tweens.add({ targets: g, rotation: (g.inkRot || 0) + 0.28, duration: 60, yoyo: true, repeat: 2, ease: 'Sine.InOut',
      onComplete: () => { if (g.active) g.rotation = g.inkRot || 0; } });
    cardDoodleBurst(this, badge.x, badge.y, [crayon, this.lightPage ? UI_INK.dark : UI_INK.cream], { count: 4, reach: 46, ink: this.lightPage ? UI_INK.dark : undefined });
  }

  // A card's effect fired in play (GameScene, any proc: Slingshot, Tight Spin, Overdrive, Gravity
  // Well, Wall Kick, Shield / Armor, Shockwave, Afterburner, Chain, Perfect, Aero...): a small ink
  // burst in the family crayon on the comet and the card's mini index card popping up above it
  // for ~0.4 s. Visual only (the name pop stays GameScene's), light, one icon at a time, rate-
  // limited per card. x, y: the comet on screen (defaults to setCometScreen's).
  cardProc(id, x, y) {
    const card = typeof cardById === 'function' ? cardById(id) : null;
    if (!card || this.stepUp() || this.isOverScreen()) return;
    const now = this.time.now;
    const P = HUD_PROC;
    if (now - (this.procAt[id] === undefined ? -1e9 : this.procAt[id]) < P.gapMs) return;
    this.procAt[id] = now;
    const c = this.comet || { x: GAME_WIDTH / 2, y: GAME_HEIGHT / 2 };
    const cx = typeof x === 'number' && isFinite(x) ? x : c.x;
    const cy = typeof y === 'number' && isFinite(y) ? y : c.y;
    const crayon = cardCrayon(card.family);
    const ink = this.lightPage ? UI_INK.dark : UI_INK.cream;
    cardDoodleBurst(this, cx, cy, [crayon, ink], { count: P.burst, reach: P.reach, squashY: 0.9, ink: this.lightPage ? UI_INK.dark : undefined });
    const ring = uiBoilImage(this, cx, cy, 'ui_circle').setTint(this.lightPage ? hudDeepen(crayon, 0.75) : crayon).setScale(0.2).setAlpha(0.9);
    this.tweens.add({ targets: ring, scale: 0.42, alpha: 0, duration: 300, ease: 'Quad.Out', onComplete: () => ring.destroy() });
    this.flashCard(id);
    const iconUp = !!(this.procIcon && this.procIcon.active);
    if (!hudProcIconAllowed(now, this.procIconAt[id], iconUp)) return;
    this.procIconAt[id] = now;
    const spot = hudProcSpot(cx, cy);
    const mini = cardMakeMini(this, spot.x, spot.from + (spot.y - spot.from) * 0.35, id, P.scale * 0.5).setAlpha(0.6);
    this.procIcon = mini;
    const rot = mini.inkRot || 0;
    this.tweens.add({ targets: mini, y: spot.y, scale: P.scale, alpha: 1, duration: P.inMs, ease: 'Back.Out' });
    this.tweens.add({
      targets: mini, alpha: 0, y: spot.y - 18, rotation: rot + 0.12, delay: P.inMs + P.holdMs, duration: P.outMs, ease: 'Quad.In',
      onComplete: () => { if (this.procIcon === mini) this.procIcon = null; mini.destroy(); },
    });
  }

  // First run, right after the intro story line (GameScene): a taped note with one line of advice
  // for ~2 s ('Planets are your friends: grab them, swing, let go!'), clear of the comet, the
  // planets and the score. Gone at once when a tutorial step comes up or something flies onto it.
  showFirstRunNote(text) {
    if (!text || this.isOverScreen()) return;
    const N = HUD_FIRST_NOTE;
    if (this.firstNote) { this.tweens.killTweensOf(this.firstNote); this.firstNote.destroy(); this.firstNote = null; }
    const lines = hudNoteLines(text);
    const parts = [uiBoilImage(this, 0, 0, uiNoteTexture(this, N.w, N.h, { tape: 'corners' }))];
    const lineH = N.size * 1.18;
    lines.forEach((ln, k) => {
      const ty = (k - (lines.length - 1) / 2) * lineH;
      // A two-line note: the first line in deep orange crayon, the advice in dark gel pen.
      const color = k === 0 && lines.length > 1 ? uiColorHex(hudDeepen(UI_CRAYON.orange, 0.72)) : UI_INK.darkHex;
      const t = uiInkText(this, 0, ty, ln, { size: N.size, color, stroke: null, rot: (k ? 0.012 : -0.018), boilAmount: 0.006 });
      if (t.width > N.w - 30) t.setScale((N.w - 30) / t.width);
      parts.push(t);
    });
    const rowRect = this.cardBadges.length ? [hudCardStripRect(this.cardBadges.length)] : [];
    const spot = hudFirstNotePlace(this.comet, this.screenBodies(), rowRect);
    const note = this.add.container(spot.x, spot.y, parts).setDepth(HUD_STEP_DEPTH - 10);
    note.inkRot = -0.03;
    note.setRotation(note.inkRot);
    note.fit = spot.scale;
    note.leaving = false;
    // Slapped on: drops in from a little bigger and settles.
    note.setScale(spot.scale * 1.25).setAlpha(0);
    this.tweens.add({ targets: note, scale: spot.scale, alpha: 1, duration: N.inMs, ease: 'Back.Out' });
    note.hideAt = this.time.now + N.inMs + N.holdMs;
    this.firstNote = note;
  }

  hideFirstRunNote(fast) {
    const note = this.firstNote;
    if (!note || note.leaving) return;
    note.leaving = true;
    this.tweens.killTweensOf(note);
    this.tweens.add({
      targets: note, alpha: 0, y: note.y - 14, duration: fast ? 110 : HUD_FIRST_NOTE.outMs, ease: 'Quad.In',
      onComplete: () => { if (this.firstNote === note) this.firstNote = null; note.destroy(); },
    });
  }

  updateFirstNote() {
    const note = this.firstNote;
    if (!note || !note.active || note.leaving) return;
    if (this.stepUp()) return this.hideFirstRunNote(true);
    if (this.time.now >= note.hideAt) return this.hideFirstRunNote(false);
    // The comet flying onto the note: it gets out of the way.
    const c = this.comet;
    const N = HUD_FIRST_NOTE;
    const hw = (N.w / 2 + 10) * note.fit;
    const hh = (N.h / 2 + 10) * note.fit;
    if (c && hudBoxDistance(c.x, c.y, note.x - hw, note.y - hh, note.x + hw, note.y + hh) < 30) this.hideFirstRunNote(true);
  }

  // The first time in a player's life the close-orbit bonus kicks in (GameScene decides and keeps
  // the lifetime flag): 'CLOSER = FASTER' hand-lettered by the comet, once. Waits for a tutorial
  // step to go (then lands by the comet's position at that time).
  showCloserFaster(x, y) {
    if (this.closerShown || this.isOverScreen()) return;
    this.closerShown = true;
    // Never on top of a banner, the card pick, a set bonus or another stamp: it waits its turn
    // (updateCloser) and then lands by the comet's position at that time.
    if (this.closerBusy()) { this.closerPending = true; this.closerClearAt = this.time.now; return; }
    this.stampCloser(x, y);
  }

  closerBusy() {
    return this.bigMomentBusy() || !!(this.milestone && this.milestone.active) || this.isOverScreen();
  }

  stampCloser(x, y) {
    const C = HUD_CLOSER;
    const c = this.comet || { x: GAME_WIDTH / 2, y: GAME_HEIGHT / 2 };
    const cx = typeof x === 'number' && isFinite(x) ? x : c.x;
    const cy = typeof y === 'number' && isFinite(y) ? y : c.y;
    const crayon = this.lightPage ? hudDeepen(UI_CRAYON.orange, 0.78) : UI_CRAYON.orange;
    const title = uiTitleText(this, 0, 0, 'CLOSER = FASTER', {
      size: C.size, color: uiColorHex(crayon), shadowColor: UI_INK.darkHex, shadowDx: 5, shadowDy: 6, rot: 0, boil: true,
    });
    const tw = title.main.width;
    const line = uiBoilImage(this, 8, C.size * 0.62, 'ui_underline').setTint(UI_CRAYON.yellow).setScale(Math.min(1.1, (tw + 20) / 540), 0.75);
    const stamp = this.add.container(0, 0, [line, title]).setDepth(HUD_STEP_DEPTH - 5);
    const fit = Math.min(1, (GAME_WIDTH - 2 * HUD_STEP.margin) / (tw + 20));
    stamp.halfW = ((tw + 20) * fit) / 2;
    stamp.halfH = (C.size * 1.3 * fit) / 2;
    const p = hudNiceSpot(cx, cy, stamp.halfW, stamp.halfH);
    stamp.setPosition(p.x, p.y);
    const tilt = -0.06;
    stamp.setRotation(tilt).setScale(fit * 1.7).setAlpha(0);
    this.tweens.add({
      targets: stamp, scale: fit, alpha: 1, duration: 140, ease: 'Quad.In',
      onComplete: () => {
        if (!stamp.active) return;
        stamp.setScale(fit * 1.1, fit * 0.88);
        this.tweens.add({ targets: stamp, scaleX: fit, scaleY: fit, duration: 200, ease: 'Back.Out' });
        cardDoodleBurst(this, stamp.x, stamp.y, [crayon, UI_CRAYON.yellow], { count: 6, reach: 120, squashY: 0.5, ink: this.lightPage ? UI_INK.dark : undefined });
      },
    });
    this.tweens.add({
      targets: stamp, alpha: 0, delay: 140 + C.holdMs, duration: C.fadeMs, ease: 'Quad.In',
      onComplete: () => { if (this.closerStamp === stamp) this.closerStamp = null; stamp.destroy(); },
    });
    this.closerStamp = stamp;
  }

  updateCloser() {
    if (this.closerPending) {
      const now = this.time.now;
      const busy = this.closerBusy();
      if (busy) this.closerClearAt = now;
      if (hudCloserMayStamp(busy, now, this.closerClearAt)) {
        this.closerPending = false;
        this.stampCloser();
      }
    }
    const m = this.closerStamp;
    if (!m || !m.active || m.leaving || !this.comet) return;
    const d = hudBoxDistance(this.comet.x, this.comet.y, m.x - m.halfW, m.y - m.halfH, m.x + m.halfW, m.y + m.halfH);
    if (d < HUD_CLOSER.cometDodge) {
      m.leaving = true;
      this.tweens.killTweensOf(m);
      this.tweens.add({ targets: m, alpha: 0, duration: 100, onComplete: () => { if (this.closerStamp === m) this.closerStamp = null; m.destroy(); } });
    }
  }

  // A stamp or banner arriving while CLOSER = FASTER is up would land on it: the hint fades out quickly.
  dropCloserStamp() {
    const m = this.closerStamp;
    if (!m || !m.active || m.leaving) return;
    m.leaving = true;
    this.tweens.killTweensOf(m);
    this.tweens.add({ targets: m, alpha: 0, duration: 120, onComplete: () => { if (this.closerStamp === m) this.closerStamp = null; m.destroy(); } });
  }

  // Bottom of the owned-card strip on screen (0 when no card is owned).
  cardRowBottom() {
    const rect = this.cardBadges.length ? hudCardStripRect(this.cardBadges.length) : null;
    return rect ? rect.bottom : 0;
  }

  // Set bonus moment: the set name lettered big in the family crayon between its two cards,
  // above or below the comet. Never on top of a zone banner: while one (or the card pick, or
  // another set bonus) is up, it waits its turn (flushSetBonus).
  showSetBonus(familyKey) {
    if (typeof SET_BONUSES === 'undefined' || !SET_BONUSES[familyKey]) return;
    if (this.bigMomentBusy() || this.setBonusWait.length) {
      if (this.setBonusWait.indexOf(familyKey) < 0) this.setBonusWait.push(familyKey);
      return;
    }
    this.playSetBonus(familyKey);
  }

  // A zone banner, a banner about to show, a set bonus, the card pick or a tutorial step is on screen.
  bigMomentBusy() {
    return !!(this.stepWaiting() || (this.bannerText && this.bannerText.alpha > 0.02) || this.pendingBanner
      || (this.setBonusLayer && this.setBonusLayer.active) || this.scene.isActive('Cards'));
  }

  // Waiting set bonuses come out one after the other, a beat after the screen is clear.
  flushSetBonus(now) {
    if (this.bigMomentBusy()) { this.bigClearAt = now; return; }
    if (!this.setBonusWait.length || now - this.bigClearAt < 150) return;
    this.playSetBonus(this.setBonusWait.shift());
  }

  playSetBonus(familyKey) {
    const bonus = SET_BONUSES[familyKey];
    const crayon = cardCrayon(familyKey);
    // Away from the comet: it must stay visible while the set name is up.
    // With the owned-card row up, the set bonus sits lower so its label clears the row.
    // High under the card row (hudSetBonusY): never in the lower third.
    const cometY = this.comet ? this.comet.y : GAME_HEIGHT;
    const y = hudSetBonusY(cometY, this.cardRowBottom());
    if (this.setBonusLayer) this.setBonusLayer.destroy();
    // Pale pages (BIG BANG, cream ESCAPE VELOCITY): deep crayon and dark ink, never yellow on white.
    const light = this.lightPage;
    const deep = (c) => (light ? hudDeepen(c, 0.68) : c);
    const label = uiInkText(this, 0, HUD_SETBONUS.labelDy, 'SET BONUS!', { size: 40, color: uiColorHex(light ? hudDeepen(UI_CRAYON.orange, 0.72) : UI_CRAYON.yellow), rot: -0.05 });
    const title = uiTitleText(this, 0, 0, bonus.name, { size: 78, color: uiColorHex(deep(crayon)), shadowColor: light ? uiColorHex(UI_CRAYON.note) : UI_INK.darkHex, rot: -0.03 });
    const titleW = title.main.width;
    title.setScale(Math.min(1, (GAME_WIDTH - 250) / titleW));
    const line = uiBoilImage(this, 6, 50, 'ui_underline').setTint(deep(crayon)).setScale(Math.min(1, (titleW * title.scaleX + 30) / 540), 0.8);
    const sub = uiInkText(this, 0, HUD_SETBONUS.subDy, bonus.desc, light
      ? { size: 34, rot: 0.015, color: UI_INK.darkHex, stroke: UI_INK.creamHex }
      : { size: 34, rot: 0.015 });
    sub.setScale(Math.min(1, (GAME_WIDTH - 60) / sub.width));
    // The two family cards that made the set flank the title, each wiggling in place.
    const owned = this.cardBadges.map(b => b.id);
    const shown = (typeof CARDS !== 'undefined' ? CARDS : []).filter(c => c.family === familyKey && owned.indexOf(c.id) >= 0);
    const bx = (titleW * title.scaleX) / 2 + 58;
    const minis = shown.slice(0, 2).map((c, i) => cardMakeMini(this, i ? bx : -bx, 0, c.id, 1.25));
    const layer = this.add.container(GAME_WIDTH / 2, y, [...minis, line, label, title, sub]).setScale(0.3).setAlpha(1);
    this.setBonusLayer = layer;
    this.tweens.add({ targets: layer, scale: 1, duration: 360, ease: 'Back.Out' });
    if (minis.length) this.tweens.add({ targets: minis, angle: { from: -10, to: 10 }, yoyo: true, repeat: -1, duration: 260, ease: 'Sine.InOut' });
    this.tweens.add({
      targets: layer, alpha: 0, y: y - 40, delay: HUD_SETBONUS.holdMs, duration: HUD_SETBONUS.fadeMs,
      onComplete: () => { if (this.setBonusLayer === layer) this.setBonusLayer = null; layer.destroy(); },
    });
    cardDoodleBurst(this, GAME_WIDTH / 2, y, light ? [deep(crayon), deep(UI_CRAYON.orange), UI_INK.dark] : [crayon, UI_CRAYON.yellow, UI_INK.cream],
      { count: 14, reach: 300, squashY: 0.6, ink: light ? UI_INK.dark : undefined });
    this.flash(crayon, 0.1, 220);
    // A pop in the set bonus band makes way, as for zone banners.
    const live = this.popLine;
    if (live && Math.abs(live.y - y) < 160) this.removePop(live);
  }

  // PERFECT chain milestone (GameScene at chain 3 / 6 / 12 / +12): the name rubber-stamped
  // onto the page in crayon with an ink burst and a slight random tilt; bigger and hotter per
  // level (1 NICE!, 2 BLAZING!, 3 UNSTOPPABLE!). ~0.9 s. Placed off the comet and its tail and
  // off any banner; the current pop line makes way.
  // opts.force: stamp now even while a tutorial step fades (the tutorial's own NICE!);
  // opts.at {cx, cy}: the comet to place it by (hudNiceSpot) instead of placeMilestone.
  showMilestone(name, level, opts) {
    opts = opts || {};
    // A tutorial step is up: the stamp is dropped. One fading out: the stamp comes out once it
    // is gone (the newest one only).
    if (!opts.force && this.stepUp()) return;
    if (!opts.force && this.stepWaiting()) { this.stepMilestone = [name, level]; return; }
    this.dropCloserStamp();
    const now = this.time.now;
    // The same word again within HUD_REPEAT.ms (tutorial NICE! then the chain's NICE!, a queued
    // copy) is never stamped twice.
    if (!hudRepeatAllowed(this.stampSeen || (this.stampSeen = {}), String(name), now)) return;
    level = Phaser.Math.Clamp(Math.round(level || 1), 1, HUD_MILESTONE.levels.length);
    const L = HUD_MILESTONE.levels[level - 1];
    if (this.milestone) { this.milestone.destroy(); this.milestone = null; }
    const crayon = UI_CRAYON[L.crayon];
    const ink = this.lightPage ? hudDeepen(crayon, 0.78) : crayon;
    const title = uiTitleText(this, 0, 0, String(name), {
      size: L.size, color: uiColorHex(ink), shadowColor: UI_INK.darkHex, shadowDx: 7, shadowDy: 8, rot: 0, boil: false,
    });
    const tw = title.main.width;
    const th = title.main.height;
    // Rough stamp border round the word, drawn once per size (white, tinted with the crayon).
    const bw = Math.round(tw + 70);
    const bh = Math.round(th + 34);
    const border = uiBoilImage(this, 0, 2, hudStampTexture(this, bw, bh)).setTint(ink);
    const parts = [border, title];
    if (level >= 2) {
      // Hotter levels get doodled stars stuck to the stamp corners.
      uiStarTexture(this);
      const corners = level >= 3 ? [[-1, -1], [1, -1], [1, 1], [-1, 1]] : [[-1, -1], [1, 1]];
      for (const [sx, sy] of corners) {
        parts.push(uiBoilImage(this, sx * (bw / 2 - 6), sy * (bh / 2 - 4), 'ui_star')
          .setTint(level >= 3 ? UI_CRAYON.yellow : ink).setScale(0.9 + level * 0.15));
      }
    }
    const walls = this.wallsOnScreen();
    const fit = Math.min(1, (walls.right - walls.left - 40) / (bw + 20));
    const stamp = this.add.container(GAME_WIDTH / 2, 0, parts);
    stamp.halfW = ((bw + 30) * fit) / 2;
    stamp.halfH = ((bh + 20) * fit) / 2;
    stamp.level = level;
    stamp.label = String(name);
    stamp.bornAt = this.time.now;
    if (opts.at) {
      const p = hudNiceSpot(Number(opts.at.cx), Number(opts.at.cy), stamp.halfW, stamp.halfH);
      stamp.setPosition(p.x, p.y);
      stamp.isTutorial = true;
      stamp.setDepth(HUD_STEP_DEPTH + 50);   // over the overlay that is still fading out
    } else {
      this.placeMilestone(stamp);
    }
    const tilt = (Math.random() < 0.5 ? -1 : 1) * (0.05 + Math.random() * 0.07);
    stamp.setRotation(tilt);
    this.milestone = stamp;
    // Slammed down: big and see-through, then hits the page, squashes and settles.
    stamp.setScale(fit * 2.1).setAlpha(0);
    this.tweens.add({
      targets: stamp, scale: fit, alpha: 1, duration: 130, ease: 'Quad.In',
      onComplete: () => {
        if (!stamp.active) return;
        stamp.setScale(fit * 1.12, fit * 0.86);
        this.tweens.add({ targets: stamp, scaleX: fit, scaleY: fit, duration: 220, ease: 'Back.Out' });
        cardDoodleBurst(this, stamp.x, stamp.y, [crayon, UI_CRAYON.yellow, this.lightPage ? UI_INK.dark : UI_INK.cream],
          { count: L.burst, reach: L.reach, squashY: 0.55, ink: this.lightPage ? UI_INK.dark : undefined });
        this.flash(crayon, 0.06 + level * 0.025, 160 + level * 40, 0.14);
        if (level >= 3) {
          // The top stamp rattles as it lands.
          this.tweens.add({ targets: stamp, rotation: { from: tilt - 0.06, to: tilt + 0.06 }, yoyo: true, repeat: 2, duration: 45,
            onComplete: () => { if (stamp.active) stamp.setRotation(tilt); } });
        }
      },
    });
    this.tweens.add({
      targets: stamp, alpha: 0, delay: 130 + (opts.holdMs || HUD_MILESTONE.holdMs), duration: opts.fadeMs || HUD_MILESTONE.fadeMs, ease: 'Quad.In',
      onComplete: () => { if (this.milestone === stamp) this.milestone = null; stamp.destroy(); },
    });
    // A pop line in the stamp's band makes way (a high one moves).
    const live = this.popLine;
    if (live && live.active) {
      const half = (live.height * live.scaleY) / 2;
      if (live.y + half > stamp.y - stamp.halfH && live.y - half < stamp.y + stamp.halfH) {
        if (live.priority === POP_HIGH) this.placePop(live); else this.removePop(live);
      }
    }
  }

  // Stamp spot: centered between the walls, prefers ~280 px above the comet, keeps
  // HUD_MILESTONE.cometClear from the comet and its tail, never on a banner / set bonus.
  placeMilestone(stamp) {
    const walls = this.wallsOnScreen();
    const mid = (walls.left + walls.right) / 2;
    const comet = this.comet || { x: mid, y: GAME_HEIGHT * 0.7 };
    const minY = this.popTop() + stamp.halfH;
    const maxY = GAME_HEIGHT - POP.bottomMargin + 40 - stamp.halfH;
    const wantY = Phaser.Math.Clamp(comet.y - 280, minY, maxY);
    const blocked = this.blockedBands(true);
    let best = null;
    let fallback = null;
    for (let y = minY; y <= maxY; y += 24) {
      const clearance = this.cometClearance(comet, mid - stamp.halfW, y - stamp.halfH, mid + stamp.halfW, y + stamp.halfH);
      const free = blocked.every(b => y + stamp.halfH + 6 <= b.top || y - stamp.halfH - 6 >= b.bottom);
      if (free && clearance >= HUD_MILESTONE.cometClear) {
        const cost = Math.abs(y - wantY);
        if (!best || cost < best.cost) best = { y, cost };
      } else {
        const score = clearance + (free ? 1000 : 0);
        if (!fallback || score > fallback.score) fallback = { y, score };
      }
    }
    stamp.setPosition(mid, (best || fallback || { y: wantY }).y);
  }

  // The comet flying into the stamp: it gets out of the way at once.
  // A MACH stamp whose readout has dropped far below its tier wipes off too.
  updateMilestone() {
    const m = this.milestone;
    if (!m || !m.active || !this.comet || m.leaving) return;
    const d = hudBoxDistance(this.comet.x, this.comet.y, m.x - m.halfW, m.y - m.halfH, m.x + m.halfW, m.y + m.halfH);
    if (d < 40 || (m.isMach && hudMachStampStale(m.machTier, this.machNow))) {
      m.leaving = true;
      this.tweens.killTweensOf(m);
      this.tweens.add({ targets: m, alpha: 0, duration: 90, onComplete: () => { if (this.milestone === m) this.milestone = null; m.destroy(); } });
    }
  }

  // MACH tier stamp ('MACH 500!') in the chain milestone's stamp style. GameScene calls it the
  // first time a run passes each tier; it waits behind banners, the card pick, set bonuses and
  // any stamp already on screen (never two stamps at once).
  showMachTier(mach) {
    const n = Math.round(Number(mach));
    if (!(n > 0)) return;
    if (this.machWait.indexOf(n) < 0) this.machWait.push(n);
    this.flushMachTier(this.time.now);
  }

  flushMachTier(now) {
    if (!this.machWait.length) return;
    if (this.stepUp()) { this.machWait = []; return; }   // old news by the time the step is done
    const m = this.milestone && this.milestone.active ? this.milestone : null;
    // A chain stamp that has been read for a moment makes way: the MACH tier would otherwise
    // keep waiting and be lost if the run ends (clearPops drops waiting stamps on the death beat).
    if (m && !m.isMach && !m.leaving && !this.bigMomentBusy() && now - (m.bornAt || 0) >= HUD_MACH.preemptMs) {
      m.leaving = true;
      this.tweens.killTweensOf(m);
      this.tweens.add({ targets: m, alpha: 0, duration: 90, onComplete: () => { if (this.milestone === m) this.milestone = null; m.destroy(); } });
      this.milestone = null;
      this.machClearAt = now - HUD_MACH.afterMs;   // no extra gap: the stamp swap is the beat
    }
    const busy = this.bigMomentBusy() || (this.milestone && this.milestone.active) || (this.closerStamp && this.closerStamp.active)
      || this.closerPending || this.isOverScreen();
    if (busy) { this.machClearAt = now; return; }
    if (now - this.machClearAt < HUD_MACH.afterMs) return;
    // Two tiers passed while waiting: only the highest is stamped (the lower one is old news).
    const top = Math.max.apply(null, this.machWait);
    this.machWait = [];
    // Waited so long that the readout already fell well below the tier: old news, not stamped.
    if (hudMachStampStale(top, this.machNow)) return;
    this.showMilestone('MACH ' + top + '!', hudMachTierLevel(top), { holdMs: HUD_MACH.holdMs, fadeMs: HUD_MACH.fadeMs });
    if (this.milestone) { this.milestone.isMach = true; this.milestone.machTier = top; }
  }

  // The run is over (a stamp would land on the death beat).
  isOverScreen() {
    const game = this.scene.get('Game');
    return !!(game && game.isOver);
  }

  // ---- one-time guided tutorial (see HUD_STEP) ----

  // Built once per HUD life: the hatched wash (a RenderTexture redrawn on the boil clock with the
  // spotlights erased out of it), the wobbly spotlight rings, the fling arrow, and the group
  // hand (ripples + fingertip) and the word (word, underline, sub line), placed apart.
  buildStep() {
    const S = HUD_STEP;
    uiMakeStepTextures(this);
    const depth = HUD_STEP_DEPTH;
    const wash = this.add.renderTexture(0, 0, GAME_WIDTH, GAME_HEIGHT).setOrigin(0).setDepth(depth).setAlpha(0).setVisible(false);
    // Drawn into the wash only (never on the display list).
    const hatch = this.make.image({ x: 0, y: 0, key: 'hud_step_hatch_0', add: false }).setOrigin(0).setScale(2).setTint(S.dark).setAlpha(S.hatch);
    const brush = this.make.image({ x: 0, y: 0, key: 'hud_step_brush', add: false });
    const rings = this.add.graphics().setDepth(depth + 1).setAlpha(0).setVisible(false);
    const arrow = this.add.graphics().setDepth(depth + 1).setAlpha(0).setVisible(false);
    // The hand: shadow, a fat cream halo (pops off the dark wash), cream backing under the crayon,
    // peach crayon fill, blue cuff, gel-pen ink. Same textures as before, upright and bigger.
    const ox = HUD_HAND.tipX / HUD_HAND.w;
    const oy = HUD_HAND.tipY / HUD_HAND.h;
    // prefix 'hud_hand2' = the pressing HOLD hand, 'hud_hand3' = the open LET GO hand.
    const makeHand = (prefix) => {
      const shadow = uiBoilImage(this, 6, 8, prefix + '_fill').setOrigin(ox, oy).setTint(UI_INK.dark).setAlpha(0.5);
      const halo = [];
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        halo.push(uiBoilImage(this, Math.cos(a) * 7, Math.sin(a) * 7, prefix + '_ink').setOrigin(ox, oy).setTint(UI_INK.cream).setAlpha(0.9));
      }
      const backing = uiBoilImage(this, 2, -2, prefix + '_fill').setOrigin(ox, oy).setTint(UI_INK.cream);
      const fill = uiBoilImage(this, 0, 0, prefix + '_fill').setOrigin(ox, oy).setTint(hudLerpColor(HUD_HAND.skin, UI_INK.cream, 0.3));
      const cuff = uiBoilImage(this, 0, 0, prefix + '_cuff').setOrigin(ox, oy).setTint(UI_CRAYON.blue);
      const ink = uiBoilImage(this, 0, 0, prefix + '_ink').setOrigin(ox, oy).setTint(UI_INK.cream);
      const h = this.add.container(0, 0, [shadow].concat(halo, [backing, fill, cuff, ink]));
      return h.setScale(S.handScale).setRotation(-S.lean);
    };
    const pressHand = makeHand('hud_hand2');
    const openHand = makeHand('hud_hand3').setVisible(false);
    const hand = pressHand;
    const ripples = this.add.graphics();
    const word = uiTitleText(this, 0, 0, 'HOLD', {
      size: S.word.holdSize, color: UI_INK.creamHex, shadowColor: UI_INK.darkHex, shadowDx: 7, shadowDy: 9, rot: -0.04, boil: true,
    });
    word.main.setStroke(UI_INK.darkHex, S.word.outline);
    const line = uiBoilImage(this, 6, S.word.lineY, 'ui_underline').setTint(UI_CRAYON.yellow);
    const sub = uiInkText(this, 0, S.word.subY, 'grab the planet!', { size: S.word.subSize, color: uiColorHex(UI_CRAYON.yellow), strokeW: 11, rot: -0.02, boilAmount: 0.01 });
    const sub2 = uiInkText(this, 4, S.word.sub2Y, 'hold anywhere', { size: S.word.sub2Size, strokeW: 8, rot: 0.015, boilAmount: 0.01 });
    const handGroup = this.add.container(0, 0, [ripples, pressHand, openHand]).setDepth(depth + 2).setAlpha(0).setVisible(false);
    const wordGroup = this.add.container(0, 0, [line, word, sub, sub2]).setDepth(depth + 2).setAlpha(0).setVisible(false);
    // HOLD only: dashed gravity lines planet -> comet, under the hand and the word.
    const gravity = this.add.graphics().setDepth(depth + 1).setAlpha(0).setVisible(false);
    this.step = {
      wash, hatch, brush, rings, arrow, handGroup, wordGroup, hand, pressHand, openHand, ripples, word, line, sub, sub2, gravity,
      gravityKey: '',      // tick + positions the gravity lines were last drawn for
      arrowPath: null,     // hudStepArrowPath for 'letgo' (comet -> target)
      want: null,          // 'hold' | 'letgo' | null (fading out)
      shown: null,         // the step the group is lettered for
      info: null,          // last info (screen coords)
      spots: [],           // spotlight circles {x, y, r}
      layout: null,        // hudStepLayout: hand / word spots
      alpha: 0,
      startedAt: 0,        // time the shown step started (animation phase)
      drawnTick: -1,       // boil tick the wash was last drawn on
      drawnKey: '',        // spotlights the wash was last drawn for
    };
    return this.step;
  }

  // GameScene: show (or keep showing) a tutorial step. Safe every frame: the same step only
  // updates the spotlights (the group is re-placed only when its spot stops being clear).
  //   'hold'  info {px, py, pr, cx, cy}: the planet and the comet (screen coords, zoom applied)
  //   'letgo' info {cx, cy, dirX, dirY, px, py, pr}: the comet, the fling direction, the target
  //   'nice'  info {cx, cy}: the step overlay fades out and a NICE! stamp lands near the comet
  showTutorialStep(step, info) {
    info = info || {};
    if (step === 'nice') {
      this.hideTutorialStep();
      if (this.stepNiceShown) return;   // once per call burst (idempotent if called each frame)
      this.stepNiceShown = true;
      // Stamped right now, straight at hudNiceSpot: the overlay is still fading out (stepWaiting),
      // which used to queue the stamp and later land a second, misplaced NICE! (and move whatever
      // stamp happened to be on screen). force skips that queue; nothing else waits on it.
      if (this.stepMilestone && this.stepMilestone[0] === 'NICE!') this.stepMilestone = null;
      this.showMilestone('NICE!', 1, { force: true, at: info });
      return;
    }
    if (step !== 'hold' && step !== 'letgo') return;
    this.stepNiceShown = false;
    const num = (v) => (typeof v === 'number' && isFinite(v) ? v : null);
    const s = this.step || this.buildStep();
    s.info = {
      cx: num(info.cx), cy: num(info.cy), px: num(info.px), py: num(info.py), dirX: num(info.dirX), dirY: num(info.dirY),
      tx: num(info.tx), ty: num(info.ty), tr: num(info.tr),
    };
    if (s.want !== step) {
      // A pop or stamp on screen makes way (the step is the only thing to read), and anything
      // still waiting is dropped: shown after the step it would be out of context.
      if (this.popLine) this.removePop(this.popLine);
      if (this.milestone) { this.milestone.destroy(); this.milestone = null; }
      this.dropWaitingPops();
    }
    s.want = step;
    if (s.shown !== step) this.letterStep(s, step);
    const top = this.popTop() - 20;
    // The spotlights follow every call; the hand and word only move when something lands on them.
    const scene = hudStepScene(step, info, top);
    s.spots = scene.spots;
    s.arrowPath = scene.arrow;
    if (!hudStepLayoutClear(s.layout, scene)) s.layout = hudStepLayout(step, info, top);
  }

  // GameScene: the player did what the step asked: everything fades out (~0.2 s).
  hideTutorialStep() {
    if (this.step) this.step.want = null;
  }

  // A tutorial step is up right now (not just fading out): pops and stamps are dropped.
  stepUp() {
    return !!(this.step && this.step.want);
  }

  // Pops, high pops in line and stamps waiting to come out: all dropped (a step started).
  dropWaitingPops() {
    this.popWait = [];
    this.popQueue.length = 0;
    this.machWait = [];
    this.stepMilestone = null;
  }

  // A tutorial step is waiting for the player (pops, stamps and banners hold back meanwhile).
  stepWaiting() {
    return !!(this.step && (this.step.want || this.step.alpha > 0.05));
  }

  // The word, sub line and their crayon for a step (switching steps re-letters and re-places).
  letterStep(s, step) {
    const S = HUD_STEP;
    s.shown = step;
    s.startedAt = this.time.now;
    s.layout = null;
    const crayon = step === 'letgo' ? UI_CRAYON.green : UI_CRAYON.yellow;
    const label = step === 'letgo' ? 'LET GO' : 'HOLD';
    const size = step === 'letgo' ? S.word.letgoSize : S.word.holdSize;
    for (const t of [s.word.main, s.word.shadow]) t.setText(label).setFontSize(size);
    s.word.main.setColor(UI_INK.creamHex).setStroke(UI_INK.darkHex, S.word.outline);
    s.line.setTint(crayon).setScale(Math.min(1.15, (s.word.main.width + 30) / 540), 0.9);
    s.sub.setVisible(step === 'hold');
    s.sub2.setVisible(step === 'hold');
    // HOLD: the pressing index finger; LET GO: the open hand springing off the page.
    s.pressHand.setVisible(step !== 'letgo');
    s.openHand.setVisible(step === 'letgo');
    s.hand = step === 'letgo' ? s.openHand : s.pressHand;
    s.hand.y = 0;
    // A fresh step slams its word in.
    s.word.setScale(1.35);
    this.tweens.killTweensOf(s.word);
    this.tweens.add({ targets: s.word, scale: 1, duration: 220, ease: 'Back.Out' });
  }

  // The hatched wash with the spotlights erased out of it, redrawn on the boil clock (never
  // every frame) or when a spotlight moved.
  drawStepWash(s, force) {
    const tick = this.boilTick || 0;
    const key = s.spots.map(c => Math.round(c.x / 3) + ',' + Math.round(c.y / 3) + ',' + Math.round(c.r / 3)).join(';');
    if (!force && tick === s.drawnTick && key === s.drawnKey) return;
    s.drawnTick = tick;
    s.drawnKey = key;
    const S = HUD_STEP;
    const rt = s.wash;
    rt.clear();
    rt.fill(S.dark, S.wash);
    s.hatch.setTexture('hud_step_hatch_' + (tick % UI_BOIL_VARIANTS));
    rt.draw(s.hatch, 0, 0);
    const brushR = 128;   // the brush texture's radius (hud_step_brush is 256 px)
    for (const c of s.spots) {
      // Fully clear inside c.r, soft out to c.r / feather.
      s.brush.setScale(c.r / (brushR * S.feather));
      rt.erase(s.brush, c.x, c.y);
    }
    // Gel-pen spotlight rings (dark under-stroke, cream pen), lopsided, overshooting their start.
    const g = s.rings;
    g.clear();
    s.spots.forEach((c, k) => {
      for (const [w, color, alpha] of [[9, UI_INK.dark, 0.55], [4.2, UI_INK.cream, 0.95]]) {
        g.lineStyle(w, color, alpha);
        g.beginPath();
        const n = 34;
        const a0 = uiNoise(k * 7 + 1, 3) * Math.PI * 2;
        for (let i = 0; i <= n; i++) {
          const a = a0 + (i / n) * Math.PI * 2 * 1.07;
          const wob = 1 + 0.035 * Math.sin(a * 2 + k) + (uiNoise(tick + k * 13, i) - 0.5) * 0.025;
          const rr = (c.r + 8) * wob + (i / n) * 5;
          const x = c.x + Math.cos(a) * rr;
          const y = c.y + Math.sin(a) * rr * 0.97;
          if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
        }
        g.strokePath();
      }
    });
  }

  updateTutorialStep(dt) {
    const s = this.step;
    if (!s) return;
    const S = HUD_STEP;
    s.alpha = s.want ? hudStepFade(s.alpha, 1, S.fadeIn, dt) : hudStepFade(s.alpha, 0, S.fadeOut, dt);
    const visible = s.alpha > 0;
    for (const o of [s.wash, s.rings, s.arrow, s.handGroup, s.wordGroup, s.gravity]) o.setVisible(visible).setAlpha(s.alpha);
    if (!visible) { s.shown = null; s.layout = null; s.arrow.clear(); s.gravity.clear(); s.gravityKey = ''; return; }
    this.drawStepWash(s, false);
    this.drawStepGravity(s);
    const L = s.layout;
    if (L) {
      s.handGroup.setPosition(L.hand.x, L.hand.y).setScale(L.hand.scale);
      s.wordGroup.setPosition(L.word.x, L.word.y).setScale(L.word.scale);
    }
    const now = this.time.now;
    const seed = this.boilTick || 0;
    const ink = UI_INK.cream;   // always over the dark wash, so cream reads on every page
    s.ripples.clear();
    s.arrow.clear();
    if (s.shown === 'letgo') {
      // Lift: the finger springs up off the page with speed dashes under it while the arrow is
      // drawn out along the fling, then a quick reset.
      const p = ((now - s.startedAt) % S.liftMs) / S.liftMs;
      const up = p < 0.35 ? 1 - Math.pow(1 - p / 0.35, 3) : p < 0.86 ? 1 : 1 - (p - 0.86) / 0.14;
      s.hand.y = -up * S.liftPx;
      s.hand.setScale(S.handScale);
      if (p > 0.05 && p < 0.65) this.drawStepLiftDashes(s.ripples, s.hand.y, seed, ink, Math.min(1, (0.65 - p) / 0.25));
      this.drawStepArrow(s, Math.min(1, p / 0.4), seed);
    } else {
      // Press: the tip comes down (ease in), holds with ripples spreading from under it, rises.
      const p = ((now - s.startedAt) % S.pressMs) / S.pressMs;
      const down = p < 0.3 ? Math.sin((p / 0.3) * Math.PI / 2) : p < 0.72 ? 1 : 1 - (p - 0.72) / 0.28;
      s.hand.y = -18 + down * 18;
      s.hand.setScale(S.handScale * (1 + down * 0.03), S.handScale * (1 - down * 0.05));
      if (p >= 0.25) this.drawStepRipples(s.ripples, (p - 0.25) / 0.75, seed, ink);
    }
  }

  // HOLD: dashed gravity lines from the planet's surface to the comet (hudGravityLines), the dashes
  // marching toward the planet. Redrawn only on the boil clock or when the bodies moved a few px.
  drawStepGravity(s) {
    const g = s.gravity;
    const i = s.info || {};
    if (s.shown !== 'hold' || i.px === null || i.cx === null) {
      if (s.gravityKey) { g.clear(); s.gravityKey = ''; }
      return;
    }
    const tick = this.boilTick || 0;
    const key = tick + ':' + [i.px, i.py, i.pr, i.cx, i.cy].map(v => Math.round((v || 0) / 3)).join(',');
    if (key === s.gravityKey) return;
    s.gravityKey = key;
    g.clear();
    const G = HUD_GRAVITY;
    const lines = hudGravityLines(i.px, i.py, i.pr, i.cx, i.cy);
    lines.forEach((L, k) => {
      const dashes = hudDashCurve(L, G.dash, G.gap, tick * G.flowPerTick + k * 11);
      // Dark under-strokes first (all of them), then the cream pen, so no dash's outline cuts the next.
      dashes.forEach((d, j) => {
        uiScribbleLine(g, d.x1, d.y1, d.x2, d.y2, tick * 7 + k * 31 + j, { width: G.under, color: UI_INK.dark, alpha: 0.6, amp: 0.8, passes: 1 });
      });
      dashes.forEach((d, j) => {
        uiScribbleLine(g, d.x1, d.y1, d.x2, d.y2, tick * 7 + k * 31 + j + 3, { width: k === 1 ? G.widthMid : G.width, color: UI_INK.cream, alpha: 0.97, amp: 0.8, passes: 1 });
      });
    });
  }

  // Three pen ripple arcs spreading from the pressed fingertip (group coords, tip at 0, 0), open
  // at the bottom where the hand is.
  drawStepRipples(g, k, seed, ink) {
    const a0 = 0.72 * Math.PI;
    const a1 = 2.28 * Math.PI;
    for (let ring = 0; ring < 3; ring++) {
      const kk = k * 1.25 - ring * 0.22;
      if (kk <= 0 || kk >= 1) continue;
      const rad = 14 + kk * (HUD_STEP.rippleMax - 14);
      const alpha = (1 - kk) * 0.95;
      g.lineStyle(5 - ring * 1.2, ink, alpha);
      g.beginPath();
      const n = 12;
      for (let i = 0; i <= n; i++) {
        const a = a0 + ((a1 - a0) * i) / n;
        const wob = (uiNoise(seed + ring * 13, i) - 0.5) * 3;
        const x = Math.cos(a) * (rad + wob);
        const y = Math.sin(a) * (rad + wob) * 0.9;
        if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
      }
      g.strokePath();
    }
  }

  // Upward speed dashes under the lifting fingertip (group coords).
  drawStepLiftDashes(g, handY, seed, ink, alpha) {
    for (let i = -1; i <= 1; i++) {
      const x = i * 18;
      const y0 = handY + 12 + Math.abs(i) * 6;
      uiScribbleLine(g, x, y0, x, Math.min(-4, y0 + 34 - Math.abs(i) * 8), seed + i * 5, { width: 4.5, color: ink, alpha, amp: 1, passes: 1 });
    }
  }

  // Curved ink arrow from just off the comet along the fling (screen coords), drawn out to
  // `grow` (0..1) of its length: dark under-stroke, green crayon, a cream second pen pass.
  // With a target the curve leaves along the fling tangent and bends onto it (hudStepArrowPath).
  drawStepArrow(s, grow, seed) {
    const g = s.arrow;
    const path = s.arrowPath;
    if (!path || grow <= 0) return;
    const pts = [];
    const n = 16;
    let len = 0;
    for (let k = 0; k <= n; k++) {
      // Drawn out along the curve up to `grow`, with a little pen wobble across it.
      const u = (k / n) * grow;
      const p = hudStepArrowPoint(path, u);
      const q = hudStepArrowPoint(path, Math.min(1, u + 0.02));
      const tl = Math.hypot(q.x - p.x, q.y - p.y) || 1;
      const wob = (uiNoise(seed, k) - 0.5) * 3;
      pts.push({ x: p.x - ((q.y - p.y) / tl) * wob, y: p.y + ((q.x - p.x) / tl) * wob });
      if (k) len += Math.hypot(pts[k].x - pts[k - 1].x, pts[k].y - pts[k - 1].y);
    }
    const tip = pts[n];
    const prev = pts[n - 2];
    const ang = Math.atan2(tip.y - prev.y, tip.x - prev.x);
    const head = Math.min(34, 12 + len * 0.15);
    const heads = [ang + 2.6, ang - 2.6].map(a => ({ x: tip.x + Math.cos(a) * head, y: tip.y + Math.sin(a) * head }));
    const stroke = (w, color, alpha) => {
      g.lineStyle(w, color, alpha);
      g.beginPath();
      pts.forEach((p, k) => (k ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)));
      g.strokePath();
      for (const h of heads) {
        g.beginPath();
        g.moveTo(tip.x, tip.y);
        g.lineTo(h.x, h.y);
        g.strokePath();
      }
    };
    stroke(17, UI_INK.dark, 0.75);
    stroke(9, UI_CRAYON.green, 1);
    g.lineStyle(3, UI_INK.cream, 0.6);
    g.beginPath();
    for (let k = 2; k <= n - 3; k++) {
      const p = pts[k];
      if (k === 2) g.moveTo(p.x + 2, p.y - 2); else g.lineTo(p.x + 2, p.y - 2);
    }
    g.strokePath();
  }

  // Run ended: the step overlay goes at once (a dead run never waits on it).
  clearTutorialStep() {
    const s = this.step;
    if (!s) return;
    s.want = null;
    s.alpha = 0;
    s.shown = null;
    s.layout = null;
    for (const o of [s.wash, s.rings, s.arrow, s.handGroup, s.wordGroup, s.gravity]) o.setVisible(false).setAlpha(0);
    s.arrow.clear();
    s.gravity.clear();
    s.gravityKey = '';
  }

  // Banners and chain stamps asked for while a step waits come out once it is gone.
  flushStepWaiting() {
    if (this.stepWaiting()) return;
    if (this.stepBanner) { const b = this.stepBanner; this.stepBanner = null; this.showBanner(b[0], b[1], b[2]); }
    if (this.stepMilestone) { const m = this.stepMilestone; this.stepMilestone = null; this.showMilestone(m[0], m[1]); }
  }

  // "x3" written on the page inside a crayon circle that pulses when the multiplier rises.
  createMultiplierBadge() {
    this.badgeCircle = uiBoilImage(this, 0, 0, 'ui_circle').setScale(HUD_BADGE.scaleX, HUD_BADGE.scaleY).setTint(this.levelTint(1));
    this.badgeText = uiInkText(this, 0, 0, 'x1', { size: HUD_BADGE.size, rot: 0.06, boil: false, color: UI_INK.darkHex, stroke: UI_INK.creamHex });
    this.badge = this.add.container(HUD_BADGE.x, HUD_BADGE.y, [this.badgeCircle, this.badgeText]);
    uiBoilRotation(this, this.badge, 0.02);
  }

  // Score, altitude, speed and badge fade in when the comet launches (hidden during the intro).
  revealStats() {
    if (!this.statsLayer || this.statsLayer.alpha >= 1) return;
    this.tweens.add({ targets: this.statsLayer, alpha: 1, duration: 450, ease: 'Sine.Out' });
  }

  // setText/setColor only when the value differs from what is already shown.
  setTextIfChanged(key, textObject, value) {
    if (this.shown[key] === value) return;
    this.shown[key] = value;
    textObject.setText(value);
  }

  setColorIfChanged(key, textObject, color) {
    if (this.shown[key] === color) return;
    this.shown[key] = color;
    textObject.setColor(color);
  }

  update(time, delta) {
    if (!this.scoreText) return;
    // Count up smoothly; never lag far behind on big jumps.
    const dt = Math.min(delta / 1000, 0.05);
    const gap = this.targetScore - this.shownScore;
    if (gap > 0) {
      this.shownScore = Math.min(this.targetScore, this.shownScore + Math.max(1, gap * Math.min(1, dt * 9)));
    } else {
      this.shownScore = this.targetScore;
    }
    const scoreString = String(Math.floor(this.shownScore));
    if (scoreString.length !== this.shown.scoreLength) {
      // Long scores get a smaller pen so they stay on the note.
      this.shown.scoreLength = scoreString.length;
      this.scoreText.setFontSize(scoreString.length <= 5 ? 64 : scoreString.length === 6 ? 54 : 46);
    }
    this.setTextIfChanged('score', this.scoreText, scoreString);
    this.updateNovaNear(dt);
    this.updateNovaWarning(dt);
    this.updateDeclutter(dt);
    this.updateStartBanner();
    this.updateSpeedReadout(time, dt);
    this.updatePageInk();
    this.updatePops();
    this.flushSetBonus(time);
    this.flushMachTier(time);
    this.updateMilestone();
    this.updateTutorialStep(dt);
    this.flushStepWaiting();
    this.updateFirstNote();
    this.updateCloser();
    // Bottom band eases toward its target alpha, so it does not blink as the comet passes.
    // The card pick's countdown ring sits over the speed band, so the band steps back meanwhile.
    const fadeTarget = this.scene.isActive('Cards') ? 0.12 : this.panelFadeTarget;
    this.panelFade += (fadeTarget - this.panelFade) * Math.min(1, dt * 10);
    this.bottomPanel.setAlpha(this.panelFade);
  }

  // Reads the supernova front straight from the Game scene (screen space), eases novaNear and
  // presses the speed smudge darker while the nova's flames are behind the readout.
  updateNovaNear(dt) {
    const game = this.scene.get('Game');
    let target = 0;
    if (game && game.comet && typeof game.novaY === 'number' && game.worldToScreen && game.cameras && game.cameras.main) {
      this.novaScreenY = game.worldToScreen(game.comet.x, game.novaY).y;
      target = hudNovaNear(this.novaScreenY);
    } else {
      this.novaScreenY = null;
    }
    this.novaNear += (target - this.novaNear) * Math.min(1, dt * HUD_NOVA.ease);
    if (this.novaNear < 0.01) this.novaNear = 0;
    if (this.speedHalo) this.speedHalo.setAlpha(HUD_HALO.alpha + HUD_HALO.novaAlpha * this.novaNear);
  }

  // Page/zone changed (GameScene calls this on run start and on every page turn).
  setPage(zoneIndex) {
    this.pageIndex = zoneIndex;
    this.updatePageInk();
  }

  // On the cream last page the gel-pen ink would vanish, so everything written on the page
  // switches to dark ink with deeper crayon accents; dark pages keep the cream ink.
  updatePageInk() {
    let zone = this.pageIndex;
    if (typeof zone !== 'number') {
      const game = this.scene.get('Game');
      zone = game && typeof game.zoneIndex === 'number' ? game.zoneIndex : 0;
    }
    // Decided by the zone's own paper brightness, so every pale page (endless ones too) gets it.
    if (this.inkZone !== zone) {
      this.inkZone = zone;
      const fallback = typeof UI_PAPERS !== 'undefined' && UI_PAPERS[zone] && UI_PAPERS[zone].light;
      this.inkLight = hudPageIsLight(hudZoneForPage(zone), fallback);
    }
    const light = this.inkLight;
    if (light === this.lightPage) return;
    this.lightPage = light;
    const ink = light ? UI_INK.darkHex : UI_INK.creamHex;
    const edge = light ? UI_INK.creamHex : UI_INK.darkHex;
    // The km/s block and the x-loop sit on their own cream scraps: always dark ink, never restyled.
    for (const t of [this.bannerText, this.bannerSub]) t.setColor(ink).setStroke(edge, t.style.strokeThickness);
    for (const t of [this.comboWord, this.comboNum]) t.setStroke(edge, t.style.strokeThickness);
    if (this.chain >= 2) this.styleCombo(this.chain);
    // The pause button is a full-colour crayon scrap (its own dark under-strokes read on any
    // page): a tint would turn it into a black square on the pale pages, so it is never tinted.
    const icon = this.pauseButton && this.pauseButton.list && this.pauseButton.list[0];
    if (icon && icon.isTinted) icon.clearTint();
    // The cream scraps get a pencil edge on pale pages, so they do not melt into the paper.
    for (const e of [this.speedScrapEdge, this.badgeScrapEdge]) if (e) e.setVisible(light);
    if (this.popLine && this.popLine.active) this.stylePop(this.popLine);
    // Set loops are redrawn in the deeper gold (known cards are not slapped in again).
    if (this.cardBadges.length) this.setCards(this.cardBadges.map(b => b.id));
    // Dark ink smudge on dark paper; a cream paper smudge under the dark ink of the cream page.
    if (this.speedHalo) this.speedHalo.setTint(light ? UI_CRAYON.note : HUD_HALO.ink);
    this.drawSpeedLine(true);
  }

  // Multiplier loop color: the warm ramp pressed hard onto its cream scrap (x1 in dark ink).
  levelTint(level) {
    const tint = HUD_LEVEL_TINTS[level - 1];
    return level === 1 ? UI_INK.dark : hudDeepen(tint, 0.72);
  }

  // Combo number crayon by milestone tier (3 / 6 / 12): yellow, orange, red; pressed harder
  // on the cream page.
  chainColor(chain) {
    const crayon = chain >= 12 ? UI_CRAYON.red : chain >= 6 ? UI_CRAYON.orange : chain >= 3 ? UI_CRAYON.yellow : null;
    if (this.lightPage) return crayon ? uiColorHex(hudDeepen(crayon, 0.72)) : UI_INK.darkHex;
    return crayon ? uiColorHex(crayon) : UI_INK.creamHex;
  }

  styleCombo(chain) {
    this.setColorIfChanged('comboNum', this.comboNum, this.chainColor(chain));
    this.setColorIfChanged('comboWord', this.comboWord, this.lightPage ? UI_INK.pencilDarkHex : uiColorHex(UI_CRAYON.yellow));
  }

  // Rises were already snapped in setStats (with a punch); drops ease down here. The number is
  // written bigger and in hotter crayon with momentum, and shivers near the top of the range.
  updateSpeedReadout(time, dt) {
    this.shownSpeed = hudSpeedEase(this.shownSpeed, this.targetSpeed, dt);
    const kmPerS = Math.round(this.shownSpeed);
    this.setTextIfChanged('speed', this.speedText, kmPerS + ' km/s');
    this.machNow = kmPerS > 0 ? hudMachNumber(kmPerS) : 0;
    this.setTextIfChanged('mach', this.machText, kmPerS > 0 ? 'MACH ' + this.machNow : '');
    this.momentum += (this.momentumTarget - this.momentum) * Math.min(1, dt * HUD_MOMENTUM.ease);
    const style = hudMomentumStyle(this.momentum);
    // On its cream scrap: dark ink, heating to pressed-hard crayon with momentum.
    const ink = this.momentum < 0.45 ? UI_INK.dark : hudDeepen(style.ink, 0.66);
    this.setColorIfChanged('speedInk', this.speedText, uiColorHex(ink));
    this.speedPunch *= Math.exp(-dt * HUD_SNAP.punchDecay);
    if (this.speedPunch < 0.005) this.speedPunch = 0;
    const f = this.speedFrac;
    const hot = Math.max(0, (f - 0.6) / 0.4);   // 0 below 60% of max, 1 at max
    this.speedText.setScale(1 + f * 0.06 + style.scale + this.speedPunch);
    const shake = hot * 2 + style.shake;
    this.speedText.setPosition(
      this.speedBaseX + (shake ? Math.sin(time * 0.09) * shake : 0),
      this.speedBaseY + (shake ? Math.cos(time * 0.113) * shake * 0.6 : 0),
    );
    this.drawSpeedLine(false);
    this.drawMomentum(false);
  }

  // Momentum 0..1 from GameScene every frame: drives the flame licks and the number's crayon.
  setMomentum(m) {
    this.momentumTarget = Math.max(0, Math.min(1, typeof m === 'number' && isFinite(m) ? m : 0));
  }

  // Flame licks doodled behind the speed number, rising off its top edge and leaning back
  // (the number is flying). More, taller and hotter with momentum. Redrawn on the boil clock
  // (line boil) or when the momentum moved enough to change the drawing.
  drawMomentum(force) {
    const g = this.momentumGfx;
    if (!g) return;
    const m = this.momentum;
    const nova = this.novaNear || 0;
    if (!force && Math.abs(m - this.momentumDrawn) < 0.04 && Math.abs(nova - this.novaDrawn) < 0.08) return;
    this.momentumDrawn = m;
    this.novaDrawn = nova;
    g.clear();
    const style = hudMomentumStyle(m);
    if (!style.licks) return;
    const seed = (this.boilTick || 0) % 3;   // three boil poses, like the other ink
    const textW = Math.max(150, this.speedText.width * this.speedText.scaleX);
    const textH = this.speedText.height * this.speedText.scaleY;
    const cx = this.speedText.x;
    const baseY = this.speedText.y - textH * 0.34;
    const dark = this.lightPage;
    const outer = dark ? hudDeepen(UI_CRAYON.red, 0.8) : UI_CRAYON.red;
    const mid = dark ? hudDeepen(UI_CRAYON.orange, 0.75) : UI_CRAYON.orange;
    const inner = dark ? hudDeepen(UI_CRAYON.yellow, 0.7) : UI_CRAYON.yellow;
    const ink = dark ? UI_INK.dark : UI_INK.cream;
    // One crown of fire across the top of the number (gel-pen outline, crayon fill); hotter
    // momentum adds a second, yellow crown inside it.
    // Each tongue is ~48 px wide: low momentum is a small fire, high momentum spans the number.
    const span = Math.min(textW * 0.92, style.licks * 48);
    const x0 = cx - textW * 0.02 - span / 2;
    const x1 = x0 + span;
    // Over the supernova's orange flames the crown gets a thick dark-ink backing (same tongues,
    // traced fat behind it) and its fill moves to yellow, so it never melts into the nova.
    let outerFill = m > 0.6 ? mid : outer;
    if (nova > 0.05) {
      inkFlameCrown(g, x0 - 5, x1 + 5, baseY + 3, style.height * 1.06, style.licks, seed * 11 + 1, {
        color: UI_INK.dark, fill: UI_INK.dark, width: 10 + m * 3, alpha: 0.85 * nova,
      });
      if (!dark && nova > 0.5) outerFill = UI_CRAYON.yellow;
    }
    inkFlameCrown(g, x0, x1, baseY, style.height, style.licks, seed * 11 + 1, {
      color: ink, fill: outerFill, width: 2.5 + m * 2, alpha: 0.6 + m * 0.4,
    });
    if (m > 0.45) {
      const pad = textW * 0.08;
      inkFlameCrown(g, x0 + pad, x1 - pad, baseY + 2, style.height * 0.55, Math.max(1, style.licks - 1), seed * 7 + 5, {
        color: m > 0.85 || (!dark && nova > 0.5) ? (dark ? inner : UI_INK.cream) : mid, fill: inner, width: 2, alpha: 0.9,
      });
    }
  }

  // Crayon underline whose length tracks speed, plus "zip" dashes trailing the number when fast.
  // Redrawn only when the length moved a few px or the boil clock ticked (force).
  drawSpeedLine(force) {
    if (!this.speedLine) return;
    const f = this.speedFrac;
    const len = HUD_SPEED.minLine + (HUD_SPEED.maxLine - HUD_SPEED.minLine) * f;
    if (!force && Math.abs(len - (this.lineLen || 0)) < 3) return;
    this.lineLen = len;
    const g = this.speedLine;
    const seed = this.boilTick || 0;
    const color = hudDeepen(speedColor(f), 0.7);   // on the cream scrap
    const x0 = HUD_SPEED.x - 104;
    g.clear();
    uiScribbleLine(g, x0, HUD_SPEED.lineY, x0 + len, HUD_SPEED.lineY - len * 0.03, seed, { width: 7, color, amp: 2.5 });
    if (f > 0.45) {
      const ink = UI_INK.dark;
      const marks = 1 + Math.floor((f - 0.45) / 0.18);
      for (let i = 0; i < marks; i++) {
        const y = HUD_SPEED.y - 20 + i * 18;
        const x = x0 - 6 - (i % 2) * 8;
        // Momentum presses the zip dashes harder (short: the block sits in the corner).
        uiScribbleLine(g, Math.max(10, x - 30 + i * 4 - this.momentum * 10), y, x, y - 3, seed + i * 7, { width: 3.5 + this.momentum * 3, color: ink, amp: 1, passes: 1 });
      }
    }
  }

  // displaySpeed (optional, km/s): the number the readout should show; speed drives the colors.
  setStats(score, altitude, speed, displaySpeed) {
    // A big gain in one go (PERFECT chain, close call) gets a bump.
    if (score - this.targetScore >= 100) this.bump(this.scoreText, 1.3);
    this.targetScore = score;
    this.setTextIfChanged('alt', this.altText, altitude + ' m');
    this.speedFrac = speedFraction(speed);
    this.targetSpeed = displaySpeed !== undefined ? displaySpeed : speed / 10;
    // A rise shows at once; a boost (SECOND WIND, milestone, card) punches the number.
    const snap = hudSpeedSnap(this.shownSpeed, this.targetSpeed);
    this.shownSpeed = snap.shown;
    if (snap.punch && this.speedSeen) {
      this.speedPunch = Math.max(this.speedPunch, snap.punch);
      if (snap.jump >= HUD_SNAP.burstAt && this.statsLayer && this.statsLayer.alpha > 0.5) {
        const ink = this.lightPage ? UI_INK.dark : UI_INK.cream;
        cardDoodleBurst(this, this.speedText.x, this.speedText.y, [UI_CRAYON.yellow, UI_CRAYON.orange, ink],
          { count: 6, reach: 120, squashY: 0.5, ink: this.lightPage ? UI_INK.dark : undefined });
      }
    }
    this.speedSeen = true;
    const level = speedMultiplier(speed);
    if (level !== this.lastMultiplier) {
      const previousLevel = this.lastMultiplier;
      this.badgeText.setText('x' + level);
      this.lastMultiplier = level;
      this.badgeCircle.setTint(this.levelTint(level));
      if (level > previousLevel) {
        if (level > this.multStampMax) {
          this.multStampMax = level;
          this.stampMultiplier(level);
        } else this.bump(this.badge, 1.5);
      }
    }
  }

  // A new best multiplier this run: big crayon 'xN' in the middle, then it flies into the note bottom-right.
  // A banner, card pick or tutorial step owns the screen: then only the note bumps, as before.
  stampMultiplier(level) {
    if (this.bigMomentBusy()) { this.bump(this.badge, 1.5); return; }
    const S = HUD_MULT_STAMP;
    if (this.multStamp) { this.tweens.killTweensOf(this.multStamp); this.multStamp.destroy(); }
    const nearComet = this.comet && Math.abs(this.comet.y - S.y) < S.cometDodge;
    const y = nearComet ? S.dodgeY : S.y;
    const stamp = uiTitleText(this, GAME_WIDTH / 2, y, 'x' + level, {
      size: S.size, color: UI_INK.creamHex, shadowColor: uiColorHex(this.levelTint(level)), rot: -0.08,
    }).setScale(0.2).setAlpha(0);
    this.multStamp = stamp;
    const done = () => { if (this.multStamp === stamp) this.multStamp = null; stamp.destroy(); this.bump(this.badge, 1.6); };
    this.tweens.add({ targets: stamp, scale: 1, alpha: 1, duration: S.inMs, ease: 'Back.Out' });
    this.tweens.add({
      targets: stamp, x: HUD_BADGE.x, y: HUD_BADGE.y, scale: S.endScale, alpha: 0.6,
      delay: S.inMs + S.holdMs, duration: S.flyMs, ease: 'Cubic.In', onComplete: done,
    });
  }

  // Comet position in screen space (GameScene, every frame). Near the bottom band the band
  // dims so the comet stays visible behind it; pops are placed away from it.
  setCometScreen(x, y) {
    if (!this.comet) this.comet = { x, y };
    this.comet.x = x;
    this.comet.y = y;
  }

  // Planets and black holes on screen as circles {x, y, r} (screen coords), read from the Game
  // scene for the declutter fades. Empty when the scene is not there.
  screenBodies() {
    const game = this.scene.get('Game');
    const out = [];
    if (!game || !game.worldToScreen || !game.cameras || !game.cameras.main) return out;
    const zoom = game.cameras.main.zoom || 1;
    for (const p of game.planets || []) {
      const s = game.worldToScreen(p.x, p.y);
      // r: with the rings (corner blocks, card row); core: the body alone (score note).
      out.push({ x: s.x, y: s.y, r: (p.radius || 0) * zoom * (p.hasRing ? 1.35 : 1), core: (p.radius || 0) * zoom });
    }
    const holeR = typeof TUNING !== 'undefined' && TUNING.blackHoleRadius ? TUNING.blackHoleRadius : 34;
    for (const h of game.blackHoles || []) {
      const s = game.worldToScreen(h.x, h.y);
      out.push({ x: s.x, y: s.y, r: 80 * zoom, core: (holeR + 16) * zoom });
    }
    return out;
  }

  // The score note and the two bottom-corner blocks step back only while the comet is under
  // them (planets pass behind the opaque paper); the card strip still steps back for planets.
  updateDeclutter(dt) {
    const bodies = this.screenBodies();
    const c = this.comet;
    const cometCircle = c ? [{ x: c.x, y: c.y, r: 24 }] : [];
    const U = HUD_PANEL_UNDER;
    const under = (rect) => hudCornerFade(hudCirclesUnder(rect, cometCircle, U.cometPad), hudCirclesUnder(rect, bodies, U.planetPad));
    this.panelFadeTarget = under(HUD_PANEL);
    this.badgeFadeTarget = under(HUD_BADGE_PANEL);
    const cores = bodies.map(b => ({ x: b.x, y: b.y, r: b.core !== undefined ? b.core : b.r }));
    const noteTarget = hudCirclesUnder(HUD_NOTE.paper, cometCircle, 0) ? HUD_NOTE.under : 1;
    this.noteFade += (noteTarget - this.noteFade) * Math.min(1, dt * HUD_NOTE.ease);
    if (this.note) this.note.setAlpha(this.noteFade);
    // Owned-card strip (top band, out of the play field): like the note, it only steps back
    // while a planet body or the comet is really under it.
    const row = this.cardBadges.length ? hudCardStripRect(this.cardBadges.length) : null;
    const rowTarget = row && hudCirclesUnder(row, cores.concat(cometCircle), 0) ? HUD_CARDS.under : 1;
    this.cardRowFade += (rowTarget - this.cardRowFade) * Math.min(1, dt * HUD_CARDS.ease);
    if (this.cardRow) this.cardRow.setAlpha(this.cardRowFade);
    this.badgeFade += (this.badgeFadeTarget - this.badgeFade) * Math.min(1, dt * 10);
    if (this.badge) this.badge.setAlpha(this.badgeFade);
  }

  // GameScene, every frame: seconds until the supernova front reaches the comet
  // ((novaY - comet.y) / nova speed). Infinity / huge / junk = far.
  setNovaEta(seconds) {
    this.novaEta = typeof seconds === 'number' && !isNaN(seconds) ? seconds : Infinity;
    this.novaEtaAt = this.time ? this.time.now : 0;
  }

  // Heat band + '!!' while the nova is about to arrive from below the screen.
  updateNovaWarning(dt) {
    if (!this.heat) return;
    const W = HUD_NOVA_WARN;
    const fresh = this.time.now - this.novaEtaAt < W.staleMs;
    const game = this.scene.get('Game');
    const over = game && game.isOver;
    // Orbit danger: GameScene's setOrbitDanger level (while fresh), else read from the orbit itself.
    const D = HUD_ORBIT_DANGER;
    const forced = this.time.now - (this.orbitDangerAt || -1e9) < D.staleMs ? this.orbitDanger : 0;
    const orbiting = !!(game && game.orbit);
    const target = fresh && !over ? hudNovaWarnTarget(this.novaEta, orbiting, forced) : 0;
    // Rises at once (every frame of warning counts), eases off.
    this.warnLevel = target >= this.warnLevel ? target : this.warnLevel + (target - this.warnLevel) * Math.min(1, dt * W.ease);
    if (this.warnLevel < 0.01) this.warnLevel = 0;
    const level = this.warnLevel;
    this.warnPhase = (this.warnPhase + dt * hudNovaWarnHz(level)) % 1;
    const beat = 0.5 + 0.5 * Math.cos(this.warnPhase * Math.PI * 2);   // 1 on the beat
    this.warnBeat = level > 0 ? beat : 0;
    // The heat band throbs harder on the beat (its height pumps too), so it reads at a glance.
    this.heat.setAlpha(Math.min(1, level * (0.5 + 0.6 * beat))).setScale(1, 0.55 + level * (0.5 + 0.35 * beat));
    this.warnText.setAlpha(level > 0 ? Math.min(1, 0.5 + level) * (0.6 + 0.4 * beat) : 0)
      .setScale(0.8 + level * 0.35 + beat * 0.18);
    if (level > 0) {
      // Under the comet, so the eye is already there; above the km/s block and the multiplier
      // loop (half width at the biggest pulse scale).
      const halfW = (this.warnText.width * 1.35) / 2;
      // Beside the comet, toward the open side: right over the comet's orange tail the red '!!'
      // was lost (the tail runs straight down through this row).
      const side = this.comet && this.comet.x > GAME_WIDTH / 2 ? -1 : 1;
      const cx = hudNovaWarnX(this.comet ? this.comet.x + side * (halfW + 40) : undefined, halfW);
      this.warnText.x += (cx - this.warnText.x) * Math.min(1, dt * 8);
      // Never left over the readout while easing in from an old spot.
      this.warnText.x = hudNovaWarnX(this.warnText.x, halfW);
    }
  }

  // GameScene (optional): the orbit danger level 0..1 this frame (e.g. from its own eta); counts for
  // HUD_ORBIT_DANGER.staleMs. Without calls the HUD still warns from setNovaEta while orbiting.
  setOrbitDanger(level) {
    this.orbitDanger = typeof level === 'number' && isFinite(level) ? Math.max(0, Math.min(1, level)) : 0;
    this.orbitDangerAt = this.time ? this.time.now : 0;
  }

  // GameScene: the warning's state for pulsing the aim line in step with the '!!' and the heat
  // band: { level 0..1, beat 0..1 (1 on the beat) }.
  warnPulse() {
    return { level: this.warnLevel || 0, beat: this.warnBeat || 0 };
  }

  // Current PERFECT chain as 'combo N' (0 hides it; 1 shows nothing, the PERFECT! pop says it).
  setChain(chain) {
    if (!this.comboLayer) return;
    const previous = this.chain;
    this.chain = chain;
    if (chain >= 2) {
      this.tweens.killTweensOf(this.comboLayer);
      this.comboLayer.setAlpha(1).setY(this.chainY);
      this.comboWord.setText('combo');
      this.setTextIfChanged('comboNum', this.comboNum, String(chain));
      this.styleCombo(chain);
      if (chain !== previous) this.bump(this.comboNum, 1.25);
    } else if (previous >= 2) {
      // Chain broken: the number is struck out in red, then the note drops and fades.
      this.tweens.killTweensOf(this.comboLayer);
      this.comboWord.setText('combo lost');
      this.setTextIfChanged('comboNum', this.comboNum, '');
      this.comboWord.setColor(uiColorHex(this.lightPage ? hudDeepen(UI_CRAYON.red, 0.8) : UI_CRAYON.red));
      this.shown.comboWord = null;
      this.comboTicks.clear();
      this.tweens.add({
        targets: this.comboLayer, alpha: 0, y: this.chainY + 14, duration: 500,
        onComplete: () => this.comboLayer.setY(this.chainY),
      });
    }
    // chain 0/1 after 0/1: nothing to show, and a running 'combo lost' fade is left to finish.
  }

  // An ordinary PERFECT inside a chain: no pop line, just a quick pulse of the combo number and
  // a pen tick scratched beside it (up to 5 ticks, like a tally; the 6th starts a new tally).
  comboTick(chain) {
    if (!this.comboLayer) return;
    if (chain !== this.chain) this.setChain(chain);
    if (chain < 2) return;
    this.bump(this.comboNum, 1.35);
    const g = this.comboTicks;
    const n = ((chain - 2) % 5) + 1;
    const x0 = this.comboNum.x + Math.max(30, this.comboNum.width) + 14;
    const ink = this.lightPage ? UI_INK.dark : UI_INK.cream;
    const seed = chain * 13;
    g.clear();
    for (let i = 0; i < n; i++) {
      const x = x0 + i * 11;
      if (i === 4) uiScribbleLine(g, x0 - 6, 16, x0 + 40, -12, seed + i, { width: 3.5, color: ink, amp: 1, passes: 1 });
      else uiScribbleLine(g, x, 14, x + 3, -14, seed + i, { width: 3.5, color: ink, amp: 0.8, passes: 1 });
    }
    // The newest tick flicks in.
    g.setAlpha(0.4);
    this.tweens.killTweensOf(g);
    this.tweens.add({ targets: g, alpha: 1, duration: 120, ease: 'Quad.Out' });
  }

  bump(target, scale) {
    this.tweens.killTweensOf(target);
    target.setScale(scale);
    this.tweens.add({ targets: target, scale: 1, duration: 300, ease: 'Back.Out' });
  }

  // Light screen flash. alpha is capped at maxAlpha (default 0.12, never above 0.18) so it
  // tints the screen for a beat instead of washing it out.
  flash(color, alpha, duration, maxAlpha) {
    if (!this.flashRect) return;
    const cap = Math.min(0.18, maxAlpha || 0.12);
    this.tweens.killTweensOf(this.flashRect);
    this.flashRect.setFillStyle(color).setAlpha(Math.min(cap, alpha === undefined ? cap : alpha));
    this.tweens.add({ targets: this.flashRect, alpha: 0, duration: duration || 150, ease: 'Quad.Out' });
  }

  // Screen-space pop text. opts: { size, stroke, duration (ms), priority }; opts.x / opts.y are
  // accepted but ignored: the HUD picks the spot itself, away from the comet (setCometScreen).
  // Only one pop line is ever on screen. A new pop replaces the current one, unless the current
  // one ranks higher and is younger than POP.guardMs (then a low/medium pop is dropped). High
  // pops are never dropped: one arriving while another high pop is still fresh waits its turn.
  pop(label, color, opts) {
    opts = opts || {};
    const now = this.time.now;
    const priority = opts.priority || popPriority(label);
    // A tutorial step is up: nothing prints over it, and nothing is kept for later either (a
    // PERFECT! landing seconds after its fling reads as noise): the pop is dropped. While a
    // step only fades out (~0.2 s, right after the fling) the pop waits for it, then shows.
    if (this.stepUp()) return;
    if (this.stepWaiting()) {
      this.popWait = hudQueueWaitingPop(this.popWait, { label, color, opts, at: now, high: priority >= POP_HIGH });
      return;
    }
    if (!this.popGate) this.popGate = { lossAt: -1e9, newAt: -1e9 };
    // A card's name is written at most HUD_POP_GATE.namedMax times a run (the pick + one proc);
    // after that its icon in the strip flashes instead.
    const named = typeof CARDS !== 'undefined' ? hudCardIdForPop(label, CARDS) : null;
    if (named) {
      if (!this.namedPopCount) this.namedPopCount = {};
      if ((this.namedPopCount[named] || 0) >= HUD_POP_GATE.namedMax) { this.flashCard(named); return; }
    }
    const cur = this.popLine && this.popLine.active ? this.popLine : null;
    const age = cur ? now - cur.bornAt : Infinity;
    const kind = hudPopKind(label);
    if (!this.popSeen) this.popSeen = {};
    if (cur && !cur.leaving && hudPopKind(cur.label) === kind) {
      // The same kind of event while its line is still up: one line, never a second copy. A
      // penalty keeps the bigger number; the same word just stays up a little longer.
      const merged = hudMergePopLabel(cur.label, label);
      cur.lifetime = Math.max(450, opts.duration || 700);
      if (merged !== cur.label) {
        cur.setText(merged);
        cur.label = merged;
        this.fitPop(cur);
        this.animatePop(cur, true);
      } else {
        this.animatePop(cur, age < POP.sameLabelMs ? true : 'quiet');
      }
      this.popSeen[kind] = now;
      hudPopGateRecord(this.popGate, label, now, true);
      return;
    }
    // One gate for the whole loss family and at most one new line per HUD_POP_GATE.newMs.
    const gate = hudPopGate(this.popGate, label, priority, now);
    if (gate.act === 'drop') return;
    if (gate.act === 'defer') {
      if (!this.popQueue.some(q => q.label === label)) this.popQueue.push({ label, color, opts, at: gate.at });
      this.popQueue.sort((a, b) => a.at - b.at);
      return;
    }
    // The same kind came out under HUD_REPEAT.ms ago (and is gone already): not again so soon.
    if (!hudRepeatAllowed(this.popSeen, kind, now)) return;
    if (priority < POP_HIGH && this.bannerUp()) {
      // A zone / set banner is being read: the pop waits for it, never stacks under it.
      this.popWait = hudQueueWaitingPop(this.popWait, { label, color, opts, at: now });
      return;
    }
    if (cur && cur.priority > priority && age < POP.guardMs) return;
    if (cur && priority === POP_HIGH && cur.priority === POP_HIGH && age < POP.highHoldMs) {
      this.popQueue.push({ label, color, opts, at: cur.bornAt + POP.highHoldMs });
      return;
    }
    if (priority === POP_HIGH && this.bannerUp()) {
      // A high pop goes beside / below the comet while a banner is up; when the screen has no
      // clean spot for it there (narrow zoomed-out view), it waits for the banner instead of
      // squeezing under it. High pops are never dropped.
      const t = this.showPop(label, color, opts, priority, cur);
      if (!t.cleanSpot) {
        this.removePop(t);
        this.popWait = hudQueueWaitingPop(this.popWait, { label, color, opts, at: now, high: true });
      }
      return;
    }
    if (cur) this.removePop(cur);
    this.showPop(label, color, opts, priority);
  }

  // replacing: the live pop to remove once the new one has a clean spot (high pop over a banner).
  showPop(label, color, opts, priority, replacing) {
    const crayon = hudPopColor(color);
    const strokeColor = uiCrayonHex(opts.stroke || UI_INK.darkHex);
    const size = Phaser.Math.Clamp(opts.size || 40, POP.minSize, POP.maxSize);
    // Created in its final style, so the text texture is rendered once.
    const t = this.add.text(0, 0, label, this.popStyle(size, crayon, strokeColor)).setOrigin(0.5);
    t.setRotation((Math.random() - 0.5) * 0.1);
    t.label = label;
    t.crayon = crayon;
    t.strokeColor = strokeColor;
    t.priority = priority;
    t.popSize = size;
    t.bornAt = this.time.now;
    t.lifetime = Math.max(450, opts.duration || 700);
    this.fitPop(t);
    this.placePop(t);
    if (replacing && !t.cleanSpot) return t;   // caller queues it; the live pop stays
    if (replacing && replacing.active) this.removePop(replacing);
    this.popLine = t;
    if (this.popGate) hudPopGateRecord(this.popGate, label, t.bornAt, false);
    const named = typeof CARDS !== 'undefined' ? hudCardIdForPop(label, CARDS) : null;
    if (named && this.namedPopCount) this.namedPopCount[named] = (this.namedPopCount[named] || 0) + 1;
    this.animatePop(t, false);
    return t;
  }

  // Crayon letters with an ink outline on dark pages; on the cream page dark ink outlined in
  // the crayon, so the line stays readable on pale paper.
  popStyle(size, crayon, strokeColor) {
    return {
      fontFamily: FONT, fontSize: size + 'px',
      color: this.lightPage ? UI_INK.darkHex : crayon,
      stroke: this.lightPage ? crayon : strokeColor,
      strokeThickness: Math.round(size / 6),
    };
  }

  // Page changed under a live pop: restyle it.
  stylePop(t) {
    t.setStyle(this.popStyle(t.popSize, t.crayon, t.strokeColor));
    this.fitPop(t);
  }

  fitPop(t) {
    const walls = this.wallsOnScreen();
    const room = walls.right - walls.left - POP.sideMargin * 2;
    t.fitScale = Math.min(1, room / (t.width * POP.overshoot));
  }

  // Screen x of the side walls (world x 0 and GAME_WIDTH): they move inward as the camera zooms out.
  wallsOnScreen() {
    const game = this.scene.get('Game');
    const cam = game && game.cameras && game.cameras.main;
    if (!cam) return { left: 0, right: GAME_WIDTH };
    const toScreen = (x) => (x - cam.scrollX - GAME_WIDTH / 2) * cam.zoom + GAME_WIDTH / 2;
    return { left: Math.max(0, toScreen(0)), right: Math.min(GAME_WIDTH, toScreen(GAME_WIDTH)) };
  }

  // Top of the area pops may use (below the score note, the combo line and the card strip).
  popTop() {
    return POP.top;
  }

  // Picks the spot: on the comet's opposite side horizontally and a little above it (where the
  // player looks next), never within POP.cometClear of the comet, inside the walls, between the
  // top HUD and the bottom band, and off any readable banner / set bonus. Cheap grid search.
  placePop(t, tries) {
    tries = tries || 0;
    const halfW = (t.width * t.fitScale * POP.overshoot) / 2;
    const halfH = (t.height * t.fitScale * POP.overshoot) / 2;
    const walls = this.wallsOnScreen();
    const mid = (walls.left + walls.right) / 2;
    const minX = Math.min(mid, walls.left + POP.sideMargin + halfW);
    const maxX = Math.max(mid, walls.right - POP.sideMargin - halfW);
    const minY = this.popTop() + halfH;
    const maxY = GAME_HEIGHT - POP.bottomMargin - halfH;
    const comet = this.comet || { x: GAME_WIDTH / 2, y: GAME_HEIGHT * 0.7 };
    const wantX = Phaser.Math.Clamp(comet.x < mid ? (mid + walls.right) / 2 : (walls.left + mid) / 2, minX, maxX);
    // With a banner up (only high pops get here then) the line goes beside / below the comet,
    // never in the strip right under the banner, where it would read as a third banner line.
    const bannerUp = this.bannerUp();
    const blocked = this.blockedBands().map(b => (bannerUp ? { top: b.top, bottom: b.bottom + POP.underBanner } : b));
    const wantY = Phaser.Math.Clamp(bannerUp ? comet.y + 60 : comet.y - 170, minY, maxY);
    const xs = [wantX, Phaser.Math.Clamp(mid, minX, maxX), Phaser.Math.Clamp(comet.x, minX, maxX), minX, maxX];
    const ys = [wantY];
    for (let y = minY; y <= maxY; y += 32) ys.push(y);
    ys.push(maxY);
    let best = null;
    let fallback = null;
    for (const x of xs) {
      for (const y of ys) {
        const clearance = this.cometClearance(comet, x - halfW, y - halfH, x + halfW, y + halfH);
        const free = blocked.every(b => y + halfH + 6 <= b.top || y - halfH - 6 >= b.bottom);
        if (free && clearance >= POP.cometClear) {
          const cost = Math.abs(y - wantY) + Math.abs(x - wantX) * 0.5;
          if (!best || cost < best.cost) best = { x, y, cost, clearance };
        } else {
          // No clean spot at all (comet mid-screen with a long line): the clearest one wins.
          const score = clearance + (free ? 1000 : 0);
          if (!fallback || score > fallback.score) fallback = { x, y, score, clearance };
        }
      }
    }
    if (!best && tries < 2 && t.popSize * t.fitScale > 44) {
      // No clean spot at this size: write it a little smaller (still >= ~44 px) and look again.
      t.fitScale *= 0.8;
      this.placePop(t, tries + 1);
      return;
    }
    const spot = best || fallback;
    t.cleanSpot = !!best;
    t.setPosition(spot.x, spot.y);
    t.baseY = spot.y;
    // The line rides along with the comet's screen motion (look-ahead camera, zoom), so the gap
    // chosen here holds for its whole life; it stays inside these bounds.
    t.offX = spot.x - comet.x;
    t.offY = spot.y - comet.y;
    t.bounds = { minX, maxX, minY, maxY };
    t.placedClear = Math.min(POP.cometClear, spot.clearance);
  }

  // How far a box stays from the comet: its head (needs POP.cometClear) and its tail, which
  // trails below it as the camera only climbs (needs POP.cometClear - POP.tailSlack).
  cometClearance(comet, x0, y0, x1, y1) {
    let d = hudBoxDistance(comet.x, comet.y, x0, y0, x1, y1);
    for (let k = 1; k <= 4; k++) {
      const ty = comet.y + (POP.tailLength * k) / 4;
      d = Math.min(d, hudBoxDistance(comet.x, ty, x0, y0, x1, y1) + POP.tailSlack);
    }
    return d;
  }

  // Punchy: scale in over 120ms, hold, then a short drift away from the comet + fade.
  // again: true re-punches a live line; 'quiet' only restarts its hold (no second slam).
  animatePop(t, again) {
    this.tweens.killTweensOf(t);
    const s = t.fitScale;
    t.drift = 0;
    if (again === 'quiet') {
      t.setAlpha(1).setScale(s);
    } else {
      t.setAlpha(1).setScale(again ? s * POP.overshoot : s * 0.45);
      this.tweens.add({ targets: t, scale: s, duration: 120, ease: again ? 'Quad.Out' : 'Back.Out' });
    }
    const hold = t.lifetime * 0.55;
    // Fades drifting away from the comet: up when above it, down when below.
    const drift = t.offY < 0 ? -24 : 18;
    this.tweens.add({
      targets: t, drift, alpha: 0, delay: hold, duration: t.lifetime - hold, ease: 'Quad.In',
      onComplete: () => this.removePop(t),
    });
  }

  removePop(t) {
    if (this.popLine === t) this.popLine = null;
    if (t.active) t.destroy();
  }

  // Run ended: drop the live pop and anything queued, so no 'UNBREAKABLE!' or 'CLOSE CALL!'
  // hangs over the death animation reading as "you were saved".
  clearPops() {
    if (this.multStamp) { this.tweens.killTweensOf(this.multStamp); this.multStamp.destroy(); this.multStamp = null; }
    this.popQueue.length = 0;
    this.popWait = [];
    this.setBonusWait = [];
    this.machWait = [];
    this.stepBanner = null;
    this.stepMilestone = null;
    this.clearTutorialStep();
    if (this.milestone) { this.milestone.destroy(); this.milestone = null; }
    if (this.popLine) this.removePop(this.popLine);
    this.closerPending = false;
    for (const k of ['firstNote', 'closerStamp', 'procIcon']) {
      if (this[k]) { this.tweens.killTweensOf(this[k]); this[k].destroy(); this[k] = null; }
    }
  }

  // Waiting high pops get their turn; a live pop the comet flies into fades out early.
  updatePops() {
    const now = this.time.now;
    this.flushWaitingPops(now);
    if (this.popQueue.length && this.popQueue[0].at <= now) {
      const next = this.popQueue.shift();
      const cur = this.popLine && this.popLine.active ? this.popLine : null;
      if (cur) this.removePop(cur);
      this.showPop(next.label, next.color, next.opts, POP_HIGH);
      // The rest of the queue waits for this one's minimum hold.
      for (const q of this.popQueue) q.at = Math.max(q.at, now + POP.highHoldMs);
    }
    const t = this.popLine;
    if (t && t.active && this.comet && t.bounds) {
      const b = t.bounds;
      t.setPosition(
        Phaser.Math.Clamp(this.comet.x + t.offX, b.minX, b.maxX),
        Phaser.Math.Clamp(this.comet.y + t.offY, b.minY, b.maxY) + t.drift,
      );
    }
    if (t && t.active && this.comet && !t.leaving && t.alpha > 0.3) {
      // Pinned against a screen edge, the comet can still catch up with it. A high pop jumps
      // to a new spot once (it must be read); anything else bows out.
      const b = t.getBounds();
      const d = hudBoxDistance(this.comet.x, this.comet.y, b.x, b.y, b.right, b.bottom);
      // Riding with the comet can also carry it into a banner that is up.
      const onBanner = this.blockedBands().some(bb => b.bottom > bb.top && b.y < bb.bottom);
      const crowded = d < t.placedClear - 25 || onBanner;
      if (crowded && t.priority === POP_HIGH && !t.moved) {
        t.moved = true;
        this.placePop(t);
      } else if (crowded) {
        t.leaving = true;
        this.tweens.killTweensOf(t);
        this.tweens.add({ targets: t, alpha: 0, duration: 80, onComplete: () => this.removePop(t) });
      }
    }
  }

  // A zone banner or set bonus is readable right now (low/medium pops wait for it).
  bannerUp() {
    return !!(this.bannerBand() || (this.setBonusLayer && this.setBonusLayer.active && this.setBonusLayer.alpha > 0.15));
  }

  // Screen bands no pop or stamp may cover: the banner, the set bonus and the milestone stamp.
  blockedBands(skipMilestone) {
    const out = [];
    const band = this.bannerBand();
    if (band) out.push(band);
    if (this.setBonusLayer && this.setBonusLayer.active) out.push({ top: this.setBonusLayer.y - 140, bottom: this.setBonusLayer.y + 130 });
    const m = this.milestone;
    if (!skipMilestone && m && m.active && m.alpha > 0.1) out.push({ top: m.y - m.halfH, bottom: m.y + m.halfH });
    // The big multiplier stamp while it is still in the middle (pops find another line).
    const ms = this.multStamp;
    if (ms && ms.active && ms.y < HUD_BADGE.y - 120) out.push({ top: ms.y - 110, bottom: ms.y + 110 });
    return out;
  }

  // Waiting pops come out one by one once the banner has faded (and the card pick is closed);
  // stale ones (the moment has passed) are dropped.
  flushWaitingPops(now) {
    if (!this.popWait.length) return;
    if (this.stepUp()) { this.popWait = []; return; }
    if (this.bannerUp() || this.scene.isActive('Cards') || this.stepWaiting()) { this.bannerClearAt = 0; return; }
    if (!this.bannerClearAt) this.bannerClearAt = now;
    if (now - this.bannerClearAt < POP_WAIT.afterMs || now < (this.nextWaitAt || 0)) return;
    // High pops (card names, rescues) are never stale; the rest are after POP_WAIT.staleMs.
    this.popWait = this.popWait.filter(q => q.high || now - q.at < POP_WAIT.staleMs);
    const next = this.popWait.shift();
    if (!next) return;
    this.nextWaitAt = now + 450;
    this.pop(next.label, next.color, next.opts);
  }

  // Screen band covered by the banner (title + subtitle) while it is readable, else null.
  bannerBand() {
    if (!this.bannerText || this.bannerText.alpha < 0.15) return null;
    // Final scale, not the current one: the title may still be scaling in.
    const titleHalf = (this.bannerText.height * (this.bannerFit || 1)) / 2;
    const hasSub = this.bannerSub.text && this.bannerSub.alpha > 0.15;
    return {
      top: this.bannerText.y - titleHalf,
      bottom: hasSub ? this.bannerSub.y + this.bannerSub.height / 2 : this.bannerText.y + titleHalf + 30,
    };
  }

  // opts.duration: ms fully visible before the fade (default 1400); opts.fadeMs: fade (default
  // 400); opts.place 'start': the run-start spot (hudStartBannerY). A set bonus on screen is
  // hurried off first, so the two never overlap (the zone banner keeps its timing for the pick).
  showBanner(title, subtitle, opts) {
    if (this.stepWaiting()) { this.stepBanner = [title, subtitle, opts]; return; }
    if (this.pendingBanner) { this.pendingBanner.remove(false); this.pendingBanner = null; }
    const layer = this.setBonusLayer;
    if (layer && layer.active && layer.alpha > 0.05) {
      this.tweens.killTweensOf(layer);
      this.tweens.add({ targets: layer, alpha: 0, duration: 140, ease: 'Quad.Out',
        onComplete: () => { if (this.setBonusLayer === layer) this.setBonusLayer = null; layer.destroy(); } });
      this.pendingBanner = this.time.delayedCall(170, () => { this.pendingBanner = null; this.playBanner(title, subtitle, opts); });
      return;
    }
    this.playBanner(title, subtitle, opts);
  }

  playBanner(title, subtitle, opts) {
    this.dropCloserStamp();
    const hold = opts && opts.duration !== undefined ? opts.duration : 1400;
    const parts = this.bannerParts();
    this.tweens.killTweensOf(parts);
    const y = opts && opts.place === 'start' ? this.startBannerY() : HUD_BANNER.y;
    this.startBannerOn = !!(opts && opts.place === 'start');
    this.bannerText.setY(y);
    this.bannerShadow.setY(y + 7);
    this.bannerLine.setY(y + 52);
    this.bannerSub.setY(y + 92);
    this.bannerText.setText(title).setScale(1).setAlpha(1);
    this.bannerShadow.setText(title).setAlpha(1);
    const fit = Math.min(1, (GAME_WIDTH - 60) / this.bannerText.width);
    this.bannerFit = fit;
    this.bannerText.setScale(fit * 0.4);
    this.bannerShadow.setScale(fit * 0.4);
    this.bannerSub.setText(subtitle || '').setAlpha(1);
    // The underline is scrawled in after the title lands.
    this.bannerLine.setAlpha(1).setScale(0, 1);
    this.tweens.add({ targets: [this.bannerText, this.bannerShadow], scale: fit, duration: 300, ease: 'Back.Out' });
    this.tweens.add({ targets: this.bannerLine, scaleX: Math.min(1.05, (this.bannerText.width * fit + 40) / 540), duration: 220, delay: 200, ease: 'Quad.Out' });
    // A pop sitting in the banner's band makes way.
    const band = this.bannerBand();
    const p = this.popLine;
    if (p && p.active && band) {
      const half = (p.height * p.scaleY) / 2;
      if (p.y + half > band.top && p.y - half < band.bottom) this.removePop(p);
    }
    this.tweens.add({ targets: parts, alpha: 0, delay: hold, duration: opts && opts.fadeMs !== undefined ? opts.fadeMs : 400 });
  }

  // The run-start banner clears out (hideBanner's quick fade) the moment a planet or the comet
  // reaches its band: planets sweep down fast after a RETRY, and the grab target is never under text.
  updateStartBanner() {
    if (!this.startBannerOn || !this.bannerText) return;
    if (this.bannerText.alpha < 0.05) { this.startBannerOn = false; return; }
    const c = this.comet;
    const circles = this.screenBodies().concat(c ? [{ x: c.x, y: c.y, r: HUD_START_BANNER.cometPad - HUD_START_BANNER.hitPad }] : []);
    if (hudStartBannerHit(this.bannerText.y, circles)) {
      this.startBannerOn = false;
      this.hideBanner();
    }
  }

  // Run-start banner y from the comet and the planets on screen right now (bodies with rings).
  // The banner goes up on the run's first frame, before setCometScreen has run: the comet is
  // read from the Game scene then.
  startBannerY() {
    let cometY = this.comet ? this.comet.y : NaN;
    const game = this.scene.get('Game');
    if (!this.comet && game && game.comet && game.worldToScreen) cometY = game.worldToScreen(game.comet.x, game.comet.y).y;
    return hudStartBannerY(cometY, this.screenBodies());
  }

  // The card pick is opening: the banner clears out fast so the card header never overlaps it.
  hideBanner() {
    // A banner still waiting for a set bonus to clear is superseded by the card header.
    if (this.pendingBanner) { this.pendingBanner.remove(false); this.pendingBanner = null; }
    const parts = this.bannerParts();
    this.tweens.killTweensOf(parts);
    // Gone (fadeMs) before the card header shows: CardScene holds it back for HUD_BANNER.clearMs,
    // so the 'TOP SPEED' subtitle never ghosts through 'PICK AN UPGRADE'.
    const visible = parts.filter(p => p.alpha > 0);
    if (visible.length) this.tweens.add({ targets: visible, alpha: 0, duration: HUD_BANNER.fadeMs, ease: 'Quad.Out' });
  }

  bannerParts() {
    return [this.bannerText, this.bannerShadow, this.bannerSub, this.bannerLine];
  }

  setDanger(level) {
    const pulse = 0.85 + Math.sin(this.time.now / 90) * 0.15;
    this.danger.setAlpha(Math.max(0, Math.min(1, level)) * pulse);
  }

  // Retired: the repeating in-play hint line ('HOLD near a planet', 'RELEASE to fling!') is gone
  // (the one-time showTutorialStep replaced it). Kept as no-ops so an older caller cannot crash.
  showHint() {}
  hideHint() {}
}

// Rubber-stamp border for chain milestones: a rough double outline with worn gaps and a little
// crayon hatching in two corners, drawn in white for tinting. Cached per size.
function hudStampTexture(scene, w, h) {
  const pad = 18;
  return uiSketchTexture(scene, 'hud_stamp_' + w + 'x' + h, w + pad * 2, h + pad * 2, (ctx, shape, jitter) => {
    const outer = uiWobblyRect(pad, pad, w, h, shape, jitter, 2.2);
    uiStroke(ctx, outer, jitter, { width: 7, color: 0xffffff, closed: true, overshoot: 3, retrace: true });
    const inner = uiWobblyRect(pad + 11, pad + 10, w - 22, h - 20, shape, jitter, 1.6);
    uiStroke(ctx, inner, jitter, { width: 3, color: 0xffffff, alpha: 0.8, closed: true, overshoot: 2, retrace: false });
    // Worn stamp ink: knock a few gaps out of the outlines.
    ctx.save();
    ctx.globalCompositeOperation = 'destination-out';
    for (let i = 0; i < 9; i++) {
      const side = Math.floor(shape() * 4);
      const t = shape();
      const x = side < 2 ? pad + t * w : (side === 2 ? pad : pad + w);
      const y = side < 2 ? (side === 0 ? pad : pad + h) : pad + t * h;
      ctx.beginPath();
      ctx.arc(x + (jitter() - 0.5) * 4, y + (jitter() - 0.5) * 4, 3 + shape() * 5, 0, UI_TAU);
      ctx.fill();
    }
    ctx.restore();
    // Crayon hatching in the top-left and bottom-right corners.
    const tl = [{ x: pad + 4, y: pad + 4 }, { x: pad + 70, y: pad + 4 }, { x: pad + 4, y: pad + 46 }];
    const br = [{ x: pad + w - 4, y: pad + h - 4 }, { x: pad + w - 70, y: pad + h - 4 }, { x: pad + w - 4, y: pad + h - 46 }];
    for (const tri of [tl, br]) uiHatch(ctx, tri, jitter, { color: 0xffffff, spacing: 6, width: 3, alpha: 0.6, angle: -0.8, grow: 1, offX: 0, offY: 0, gaps: 0.2 });
  });
}

// Tutorial hand: texture size, the fingertip pixel (the anchor) and its peach skin crayon.
// The index finger points UP to its tip (we see the back of the hand: nail, knuckle creases),
// the other fingers are curled under it on the right, the thumb tucked on the left, a short
// sleeve cuff at the wrist: the 'tap here' hand everyone knows from phone tutorials.
const HUD_HAND = {
  w: 150, h: 244, tipX: 62, tipY: 8, skin: 0xf0c493,
  // Outermost points of the drawn hand (texture px): tip first, cuff's far corner last.
  outline: [[62, 8], [38, 30], [86, 30], [38, 152], [88, 152], [34, 180], [138, 178], [86, 132], [86, 224],
    [118, 140], [136, 150], [149, 168], [26, 172], [42, 142], [42, 202], [42, 204], [42, 240], [132, 204], [132, 240]],
};

// LET GO hand: the same hand (same texture size and fingertip anchor, same crayon and pen) but
// OPEN: the fingers have sprung apart off the page and the thumb sticks out, so it reads as
// "let go" next to the pressing index finger of HOLD. Fingers as [baseX, baseY, tipX, tipY, r]
// (texture px; the tip is the finger's outermost point). The index tip is the anchor.
const HUD_HAND_OPEN = {
  fingers: [[62, 150, 62, 8, 17], [86, 150, 102, 28, 15], [106, 158, 128, 64, 13], [122, 172, 139, 112, 10]],
  thumb: [52, 180, 20, 132, 12],
  palm: [86, 182, 50, 42],
  outline: [[62, 8], [45, 26], [79, 26], [102, 28], [87, 40], [117, 44], [128, 64], [115, 72], [141, 72],
    [139, 112], [129, 120], [149, 120], [20, 132], [8, 140], [32, 128], [36, 182], [136, 182], [86, 224],
    [46, 208], [130, 208], [46, 236], [130, 236]],
};

// Pure helper (tested): the hand outline in group coords (tip at 0, 0) with the hand lifted by
// liftY and scaled by (sx, sy) - exactly how updateTutorialStep poses it (leaned, scaled).
// outline: texture points (default the pressing hand, HUD_HAND.outline).
function hudHandPoints(liftY, sx, sy, outline) {
  const S = HUD_STEP;
  const H = HUD_HAND;
  const kx = sx === undefined ? S.handScale : sx;
  const ky = sy === undefined ? kx : sy;
  const c = Math.cos(-S.lean);
  const s = Math.sin(-S.lean);
  return (outline || H.outline).map(([px, py]) => {
    const x = (px - H.tipX) * kx;
    const y = (py - H.tipY) * ky;
    return { x: x * c - y * s, y: (liftY || 0) + x * s + y * c };
  });
}

// A rounded finger: half circle at the top (radius r round (cx, top + r)), sides down to bottom.
function hudFingerOutline(cx, top, r, bottom, jitter) {
  const pts = [];
  const cy = top + r;
  for (let i = 0; i <= 8; i++) {
    const a = Math.PI + (Math.PI * i) / 8;
    pts.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });
  }
  for (let i = 1; i <= 4; i++) pts.push({ x: cx + r + i * 0.4, y: cy + ((bottom - cy) * i) / 4 });
  for (let i = 4; i >= 1; i--) pts.push({ x: cx - r - i * 0.3, y: cy + ((bottom - cy) * i) / 4 });
  return pts.map(p => ({ x: p.x + (jitter() - 0.5) * 1.6, y: p.y + (jitter() - 0.5) * 1.6 }));
}

// A finger from its base to its tip at any angle: hudFingerOutline drawn upright, then turned.
function hudFingerOutlineAt(bx, by, tx, ty, r, jitter) {
  const len = Math.hypot(tx - bx, ty - by) || 1;
  const a = Math.atan2(tx - bx, -(ty - by));   // clockwise from straight up
  const c = Math.cos(a);
  const s = Math.sin(a);
  return hudFingerOutline(0, -len, r, 0, jitter).map(p => ({ x: bx + p.x * c - p.y * s, y: by + p.x * s + p.y * c }));
}

// The open (LET GO) hand's parts as point loops, like hudHandShapes.
function hudOpenHandShapes(shape, jitter) {
  const O = HUD_HAND_OPEN;
  const fingers = O.fingers.map(([bx, by, tx, ty, r]) => hudFingerOutlineAt(bx, by, tx, ty, r, jitter));
  const [tbx, tby, ttx, tty, tr] = O.thumb;
  const thumb = hudFingerOutlineAt(tbx, tby, ttx, tty, tr, jitter);
  const [px, py, prx, pry] = O.palm;
  const back = uiLoop(px, py, prx, pry, shape, jitter, { n: 24, lop: 0.06, amp: 1.3 });
  const nail = uiLoop(HUD_HAND.tipX, HUD_HAND.tipY + 22, 12, 15, shape, jitter, { n: 14, lop: 0.04, amp: 0.8 });
  const cuff = uiWobblyRect(46, 208, 84, 28, shape, jitter, 1.3);
  return { fingers, thumb, back, nail, cuff };
}

// The hand's parts as point loops (shared by the fill, cuff and ink textures, so they register).
function hudHandShapes(shape, jitter) {
  const H = HUD_HAND;
  const finger = hudFingerOutline(H.tipX, H.tipY, 22, 152, jitter);
  const nail = uiLoop(H.tipX, H.tipY + 22, 12, 15, shape, jitter, { n: 14, lop: 0.04, amp: 0.8 });
  const back = uiLoop(86, 178, 50, 44, shape, jitter, { n: 24, lop: 0.07, amp: 1.4 });
  // Curled middle / ring / little finger: knuckle bumps stepping down the right of the finger.
  const knuckles = [[101, 142, 15, 14], [120, 152, 14, 13], [135, 168, 12, 12]]
    .map(([x, y, rx, ry]) => uiLoop(x, y, rx, ry, shape, jitter, { n: 14, lop: 0.05, amp: 1 }));
  const thumb = uiLoop(42, 172, 14, 28, shape, jitter, { n: 16, lop: 0.06, amp: 1.1 });
  const cuff = uiWobblyRect(46, 208, 84, 28, shape, jitter, 1.3);
  return { finger, nail, back, knuckles, thumb, cuff };
}

// Tutorial step textures (built on first use): ink hatching for the dark wash at half size
// (drawn at 2x: 3 boil variants of a full-screen canvas would cost ~11 MB of GPU memory) and the
// soft round brush the spotlights are erased with.
function uiMakeStepTextures(scene) {
  uiSketchTexture(scene, 'hud_step_hatch', GAME_WIDTH / 2, GAME_HEIGHT / 2, (ctx, shape, jitter, v, w, h) => {
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#ffffff';
    // Two hatch directions, like a pencil shading the page dark: dense diagonals, sparser cross.
    for (const [angle, spacing, width, alpha] of [[-0.85, 7, 2.1, 0.85], [0.6, 13, 1.5, 0.55]]) {
      const c = Math.cos(angle);
      const sn = Math.sin(angle);
      const reach = w + h;
      for (let d = -reach; d < reach; d += spacing + (shape() - 0.5) * 2) {
        // Strokes broken into lengths with gaps, each a little off line (hand hatching).
        let t = -reach + shape() * 30;
        while (t < reach) {
          const len = 30 + shape() * 90;
          const off = (jitter() - 0.5) * 1.6;
          const x0 = w / 2 + c * t - sn * (d + off);
          const y0 = h / 2 + sn * t + c * (d + off);
          const x1 = w / 2 + c * (t + len) - sn * (d + off + (jitter() - 0.5) * 1.5);
          const y1 = h / 2 + sn * (t + len) + c * (d + off + (jitter() - 0.5) * 1.5);
          t += len + 4 + shape() * 14;
          if (Math.max(x0, x1) < -4 || Math.min(x0, x1) > w + 4 || Math.max(y0, y1) < -4 || Math.min(y0, y1) > h + 4) continue;
          ctx.globalAlpha = alpha * (0.6 + shape() * 0.4);
          ctx.lineWidth = width * (0.75 + jitter() * 0.5);
          ctx.beginPath();
          ctx.moveTo(x0, y0);
          ctx.lineTo(x1, y1);
          ctx.stroke();
        }
      }
    }
    ctx.globalAlpha = 1;
    uiGrain(ctx, w, h, jitter, 0.03);
  });
  if (!scene.textures.exists('hud_step_brush')) {
    const S = 256;
    const tex = scene.textures.createCanvas('hud_step_brush', S, S);
    const ctx = tex.getContext();
    const grad = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(HUD_STEP.feather, 'rgba(255,255,255,1)');
    grad.addColorStop(HUD_STEP.feather + (1 - HUD_STEP.feather) * 0.5, 'rgba(255,255,255,0.45)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, S, S);
    tex.refresh();
  }
}

// HUD-only doodle textures (built once per game; existing keys are skipped).
function uiMakeHudTextures(scene) {
  uiCircleTexture(scene);
  uiUnderlineTexture(scene);
  // Finger tutorial hand: crayon fill (white, tinted peach), the cuff fill (tinted blue) and the
  // gel-pen ink (white, tinted cream / dark): one outline round the hand, plus the nail, the
  // knuckle creases and the cuff. Texture keys are versioned: the old fist-shaped hand is gone.
  const H = HUD_HAND;
  const handBody = (sh) => [sh.back, sh.finger, sh.thumb].concat(sh.knuckles);
  uiSketchTexture(scene, 'hud_hand2_fill', H.w, H.h, (ctx, shape, jitter, v, w, h) => {
    const sh = hudHandShapes(shape, jitter);
    for (const pts of handBody(sh)) {
      // Crayon slightly off the outline (misregistered).
      uiTracePath(ctx, pts.map(p => ({ x: p.x + 2, y: p.y - 2 })), true);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
    }
    // Waxy crayon strokes knocked out of the solid fill; the nail is paler still.
    ctx.save();
    ctx.globalCompositeOperation = 'destination-out';
    for (const pts of handBody(sh)) uiHatch(ctx, pts, jitter, { spacing: 7, width: 2.5, alpha: 0.3, angle: -0.9, offX: 2, offY: -2, gaps: 0.3, color: 0 });
    uiTracePath(ctx, sh.nail, true);
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fill();
    ctx.restore();
    uiGrain(ctx, w, h, jitter, 0.02);
  });
  uiSketchTexture(scene, 'hud_hand2_cuff', H.w, H.h, (ctx, shape, jitter, v, w, h) => {
    const sh = hudHandShapes(shape, jitter);
    uiTracePath(ctx, sh.cuff.map(p => ({ x: p.x + 2, y: p.y - 1 })), true);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.save();
    ctx.globalCompositeOperation = 'destination-out';
    uiHatch(ctx, sh.cuff, jitter, { spacing: 6, width: 2.5, alpha: 0.35, angle: 0.7, offX: 2, offY: -1, gaps: 0.3, color: 0 });
    ctx.restore();
    uiGrain(ctx, w, h, jitter, 0.03);
  });
  uiSketchTexture(scene, 'hud_hand2_ink', H.w, H.h, (ctx, shape, jitter) => {
    const sh = hudHandShapes(shape, jitter);
    const body = handBody(sh);
    // Fat strokes round every part, then the union of the parts is punched out: what is left is
    // one outline round the whole hand, never lines crossing inside it.
    for (const pts of body) uiStroke(ctx, pts, jitter, { width: 9, color: 0xffffff, closed: true, retrace: false });
    ctx.save();
    ctx.globalCompositeOperation = 'destination-out';
    ctx.fillStyle = '#000';
    for (const pts of body.concat([sh.cuff])) { uiTracePath(ctx, pts, true); ctx.fill(); }
    ctx.restore();
    const line = (pts, width) => uiStroke(ctx, pts, jitter, { width: width || 3.2, color: 0xffffff, retrace: false });
    // Fingernail at the tip, with a little shine tick.
    uiStroke(ctx, sh.nail, jitter, { width: 3, color: 0xffffff, closed: true, overshoot: 2, retrace: false });
    line([{ x: H.tipX - 5, y: H.tipY + 15 }, { x: H.tipX - 6, y: H.tipY + 22 }], 2.4);
    // Knuckle creases across the finger (two short double lines).
    line([{ x: 46, y: 84 }, { x: 55, y: 87 }, { x: 66, y: 87 }, { x: 77, y: 84 }]);
    line([{ x: 50, y: 92 }, { x: 62, y: 94 }, { x: 74, y: 92 }], 2.4);
    line([{ x: 46, y: 118 }, { x: 58, y: 121 }, { x: 70, y: 121 }, { x: 78, y: 118 }]);
    // Where the curled fingers fold, and the thumb's edge against the hand.
    line([{ x: 92, y: 150 }, { x: 102, y: 156 }, { x: 110, y: 156 }]);
    line([{ x: 112, y: 162 }, { x: 121, y: 166 }, { x: 128, y: 165 }]);
    line([{ x: 52, y: 150 }, { x: 56, y: 170 }, { x: 54, y: 190 }]);
    // Cuff: its own outline over the wrist, with a pen stripe.
    uiStroke(ctx, sh.cuff, jitter, { width: 5, color: 0xffffff, closed: true, overshoot: 2, retrace: true });
    line([{ x: 52, y: 222 }, { x: 88, y: 221 }, { x: 124, y: 223 }]);
  });
  // The open LET GO hand (HUD_HAND_OPEN): same three layers, same pen and crayon.
  const openBody = (sh) => [sh.back, sh.thumb].concat(sh.fingers);
  uiSketchTexture(scene, 'hud_hand3_fill', H.w, H.h, (ctx, shape, jitter, v, w, h) => {
    const sh = hudOpenHandShapes(shape, jitter);
    for (const pts of openBody(sh)) {
      uiTracePath(ctx, pts.map(p => ({ x: p.x + 2, y: p.y - 2 })), true);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
    }
    ctx.save();
    ctx.globalCompositeOperation = 'destination-out';
    for (const pts of openBody(sh)) uiHatch(ctx, pts, jitter, { spacing: 7, width: 2.5, alpha: 0.3, angle: -0.9, offX: 2, offY: -2, gaps: 0.3, color: 0 });
    uiTracePath(ctx, sh.nail, true);
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fill();
    ctx.restore();
    uiGrain(ctx, w, h, jitter, 0.02);
  });
  uiSketchTexture(scene, 'hud_hand3_cuff', H.w, H.h, (ctx, shape, jitter, v, w, h) => {
    const sh = hudOpenHandShapes(shape, jitter);
    uiTracePath(ctx, sh.cuff.map(p => ({ x: p.x + 2, y: p.y - 1 })), true);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.save();
    ctx.globalCompositeOperation = 'destination-out';
    uiHatch(ctx, sh.cuff, jitter, { spacing: 6, width: 2.5, alpha: 0.35, angle: 0.7, offX: 2, offY: -1, gaps: 0.3, color: 0 });
    ctx.restore();
    uiGrain(ctx, w, h, jitter, 0.03);
  });
  uiSketchTexture(scene, 'hud_hand3_ink', H.w, H.h, (ctx, shape, jitter) => {
    const sh = hudOpenHandShapes(shape, jitter);
    const body = openBody(sh);
    for (const pts of body) uiStroke(ctx, pts, jitter, { width: 9, color: 0xffffff, closed: true, retrace: false });
    ctx.save();
    ctx.globalCompositeOperation = 'destination-out';
    ctx.fillStyle = '#000';
    for (const pts of body.concat([sh.cuff])) { uiTracePath(ctx, pts, true); ctx.fill(); }
    ctx.restore();
    const line = (pts, width) => uiStroke(ctx, pts, jitter, { width: width || 3.2, color: 0xffffff, retrace: false });
    // Each finger's own contour (so the fingers read apart, not as a mitten), stopping where the
    // finger meets the palm: drawn on a scratch canvas, the palm punched out of it, then laid on.
    const tmp = document.createElement('canvas');
    tmp.width = ctx.canvas.width;
    tmp.height = ctx.canvas.height;
    const t = tmp.getContext('2d');
    for (const pts of sh.fingers.concat([sh.thumb])) uiStroke(t, pts, jitter, { width: 3.4, color: 0xffffff, closed: true, retrace: false });
    t.globalCompositeOperation = 'destination-out';
    uiTracePath(t, sh.back, true);
    t.fill();
    ctx.drawImage(tmp, 0, 0);
    uiStroke(ctx, sh.nail, jitter, { width: 3, color: 0xffffff, closed: true, overshoot: 2, retrace: false });
    line([{ x: H.tipX - 5, y: H.tipY + 15 }, { x: H.tipX - 6, y: H.tipY + 22 }], 2.4);
    // Knuckle creases on the index finger, and the palm's crease (the palm faces us).
    line([{ x: 48, y: 96 }, { x: 60, y: 99 }, { x: 74, y: 96 }]);
    line([{ x: 66, y: 168 }, { x: 84, y: 160 }, { x: 104, y: 162 }, { x: 118, y: 172 }], 2.6);
    line([{ x: 70, y: 192 }, { x: 88, y: 186 }, { x: 102, y: 190 }], 2.2);
    uiStroke(ctx, sh.cuff, jitter, { width: 5, color: 0xffffff, closed: true, overshoot: 2, retrace: true });
    line([{ x: 52, y: 222 }, { x: 88, y: 221 }, { x: 124, y: 223 }]);
  });
  // Off-screen supernova warning: orange crayon heat along the bottom edge (white, tinted):
  // wavy crayon rows, thick and dense at the edge, thinning upward, with flame-tongue ticks.
  uiSketchTexture(scene, 'hud_heat', GAME_WIDTH, 200, (ctx, shape, jitter, v, w, h) => {
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (let row = 0; row < 4; row++) {
      const y = h - 8 - row * 20;
      ctx.globalAlpha = 0.85 - row * 0.15;
      ctx.lineWidth = 16 - row * 3;
      ctx.strokeStyle = '#ffffff';
      ctx.beginPath();
      for (let x = -10; x <= w + 10; x += 18) {
        const yy = y + Math.sin(x * 0.05 + row * 1.7 + shape() * 0.6) * (5 + row) + (jitter() - 0.5) * 4;
        if (x === -10) ctx.moveTo(x, yy); else ctx.lineTo(x, yy);
      }
      ctx.stroke();
    }
    // Flame tongues licking up off the band: teardrop outlines, each its own shape.
    for (let i = 0; i < 16; i++) {
      const x = (i + 0.5) * (w / 16) + (shape() - 0.5) * 18;
      const base = h - 62 + (shape() - 0.5) * 8;
      const top = base - 40 - shape() * 70;
      const half = 9 + shape() * 7;
      const lean = (shape() - 0.5) * 16;
      ctx.globalAlpha = 0.5 + shape() * 0.35;
      ctx.lineWidth = 4 + shape() * 2.5;
      ctx.beginPath();
      ctx.moveTo(x - half, base);
      ctx.quadraticCurveTo(x - half * 0.9 + lean * 0.3, (base + top) / 2 + (jitter() - 0.5) * 6, x + lean, top);
      ctx.quadraticCurveTo(x + half * 0.9 + lean * 0.3, (base + top) / 2 + (jitter() - 0.5) * 6, x + half, base);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    uiGrain(ctx, w, h, jitter, 0.015);
  });
  // Small cream note with faint rule lines, a soft shadow and a strip of tape.
  uiSketchTexture(scene, 'hud_note', 290, 180, (ctx, shape, jitter) => {
    const corners = [
      { x: 20 + shape() * 6, y: 26 + shape() * 4 }, { x: 268 - shape() * 6, y: 22 + shape() * 4 },
      { x: 272 - shape() * 4, y: 160 - shape() * 6 }, { x: 18 + shape() * 4, y: 164 - shape() * 4 },
    ];
    // Slightly curled bottom-right corner: an extra point pulled in.
    const page = [corners[0], corners[1], corners[2], { x: 140, y: 162 + (jitter() - 0.5) * 1.5 }, corners[3]];
    uiTracePath(ctx, page.map((p) => ({ x: p.x + 5, y: p.y + 7 })), true);
    ctx.fillStyle = 'rgba(5,6,16,0.4)';
    ctx.fill();
    uiTracePath(ctx, page, true);
    ctx.fillStyle = uiCss(UI_CRAYON.note);
    ctx.fill();
    ctx.save();
    uiTracePath(ctx, page, true);
    ctx.clip();
    ctx.strokeStyle = 'rgba(90,135,200,0.35)';
    ctx.lineWidth = 2;
    for (const y of [70, 112, 150]) {
      ctx.beginPath();
      ctx.moveTo(0, y + (shape() - 0.5) * 2);
      ctx.lineTo(290, y + (shape() - 0.5) * 3);
      ctx.stroke();
    }
    for (let i = 0; i < 50; i++) {
      const x = shape() * 290;
      const y = shape() * 180;
      ctx.strokeStyle = 'rgba(120,95,50,0.12)';
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + (shape() - 0.5) * 24, y + (shape() - 0.5) * 10);
      ctx.stroke();
    }
    ctx.restore();
    // Straight edge (uiStroke would round a 5-point outline into a blob).
    uiTracePath(ctx, page, true);
    ctx.strokeStyle = 'rgba(138,122,90,0.5)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    // Tape across the top edge.
    ctx.save();
    ctx.translate(150, 26);
    ctx.rotate(-0.08 + (shape() - 0.5) * 0.04);
    const tape = [];
    for (let i = 0; i <= 3; i++) tape.push({ x: 48 + (i % 2 ? 5 : 0), y: -13 + i * 8.7 });
    for (let i = 3; i >= 0; i--) tape.push({ x: -48 - (i % 2 ? 4 : 0), y: -13 + i * 8.7 });
    uiTracePath(ctx, tape, true);
    ctx.fillStyle = 'rgba(240,232,190,0.6)';
    ctx.fill();
    ctx.restore();
  });
  // Speed readout smudge (white, tinted dark ink / cream paper): two overlapping lopsided crayon
  // patches, hatched and grained, softer at the edges. Never a panel: no outline, no hard edge.
  uiSketchTexture(scene, 'hud_speed_halo', HUD_HALO.w, HUD_HALO.h, (ctx, shape, jitter, v, w, h) => {
    const lobes = [
      uiLoop(w * 0.47, h * 0.57, w * 0.44, h * 0.3, shape, jitter, { n: 26, lop: 0.1, amp: 3 }),
      uiLoop(w * 0.55, h * 0.36, w * 0.3, h * 0.22, shape, jitter, { n: 20, lop: 0.12, amp: 3 }),
    ];
    for (const pts of lobes) {
      uiTracePath(ctx, pts, true);
      ctx.fillStyle = 'rgba(255,255,255,0.45)';
      ctx.fill();
      uiHatch(ctx, pts, jitter, { spacing: 7, width: 5, alpha: 0.55, angle: -0.5, gaps: 0.12 });
    }
    uiGrain(ctx, w, h, jitter, 0.02);
  });
  // Torn cream scraps behind the km/s block and the x-loop (HUD_SCRAP).
  hudScrapTexture(scene, 'hud_speed_scrap', HUD_SCRAP.speed.w, HUD_SCRAP.speed.h);
  hudScrapTexture(scene, 'hud_badge_scrap', HUD_SCRAP.badge.w, HUD_SCRAP.badge.h);
  hudScrapEdgeTexture(scene, 'hud_speed_scrap', HUD_SCRAP.speed.w, HUD_SCRAP.speed.h);
  hudScrapEdgeTexture(scene, 'hud_badge_scrap', HUD_SCRAP.badge.w, HUD_SCRAP.badge.h);
  // Crayon scribble that is dense at the bottom edge and thins out upward (white, tinted red).
  uiSketchTexture(scene, 'hud_danger', GAME_WIDTH, 300, (ctx, shape, jitter) => {
    ctx.lineCap = 'round';
    for (let i = 0; i < 520; i++) {
      const depth = Math.pow(shape(), 2.2);           // 0 = bottom edge
      const x = shape() * GAME_WIDTH + (jitter() - 0.5) * 6;
      const y = 300 - depth * 300 + (jitter() - 0.5) * 6;
      const len = 20 + shape() * 46;
      ctx.globalAlpha = (1 - depth) * (0.25 + shape() * 0.35);
      ctx.lineWidth = 3 + shape() * 3;
      ctx.strokeStyle = '#ffffff';
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + len * 0.55, y - len * 0.8);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  });
}
