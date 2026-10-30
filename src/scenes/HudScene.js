// Overlay scene for score/speed/hints. Lives in its own scene so the game camera can
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
//                             low/medium pops sent while a banner is up wait until it fades
//   flash(color, alpha, duration, maxAlpha?)  alpha capped at 0.12 (maxAlpha may raise it to 0.18)
//   showBanner(title, subtitle, { duration }), hideBanner(), showHint(label), hideHint()
//   bigPrompt(text), clearBigPrompt()  first-run 'HOLD!' / 'LET GO!' in big crayon lettering,
//                             kept off the comet; the small hint line hides while one is up
//   showMachTier(mach)        'MACH 500!' stamp (milestone style); waits for banners, the card
//                             pick and any stamp on screen. The MACH readout under the km/s
//                             number is computed from the shown km/s (setStats' 4th argument)
//   setCards(ownedIds)        row of owned upgrade-card minis (under the score note, right-aligned)
//   setNovaEta(seconds)       every frame: time until the supernova reaches the comet; under ~1.2 s
//                             with the front below the screen, a heat band + pulsing '!!' warn
//   tutorialHold(px, py, pr) / tutorialRelease(cx, cy, dx, dy) / clearTutorial()  finger tutorial
//                             (screen coords): a pressing fingertip by the planet with a dashed
//                             line to it and 'HOLD anywhere', then the lifting finger + 'LET GO'
//   showSetBonus(familyKey)   family-colored SET BONUS banner (SET_BONUSES in src/cards.js)
//   scoreText / hintText are read by GameScene, so they stay Text objects.

// Pop rules (see pop()): only ONE pop line is ever on screen; it never sits on the comet.
const POP = {
  top: 270,              // below the stats note (note + chain line end around y 245)
  topWithCards: 372,     // below the owned-card row when it is shown
  bottomMargin: 330,     // above the hint (y 960) and the bottom-corner speed / xN blocks (y ~1074)
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

// Zone banner title y: lower when the owned-card row is shown, so the row never touches it.
// fadeMs: hideBanner() fade; clearMs: the card header's hold-back, a little longer than the fade.
const HUD_BANNER = { y: 400, yWithCards: 474, fadeMs: 90, clearMs: 120 };

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

// Pure helper (tested): x position and scale of the owned-card row so that its whole span
// (rowLeft..rowRight, relative to the row origin) sits inside the on-screen walls.
function hudFitCardRow(rowLeft, rowRight, preferredX, wallLeft, wallRight, margin) {
  const minX = wallLeft + margin;
  const maxX = wallRight - margin;
  const width = rowRight - rowLeft;
  const scale = Math.min(1, (maxX - minX) / width);
  let x = Math.min(preferredX, maxX - rowRight * scale);
  x = Math.max(x, minX - rowLeft * scale);
  return { x, scale };
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
const HUD_BADGE_PANEL = { left: HUD_BADGE.x - 62, right: HUD_BADGE.x + 62, top: HUD_BADGE.y - 62, bottom: HUD_BADGE.y + 62 };
// Corner blocks' alpha while the comet (or a planet) is under them.
const HUD_PANEL_UNDER = { comet: 0.3, planet: 0.55, cometPad: 90, planetPad: 4 };
// Owned-card row: under the score note (which ends near y 232) and the chain line (y ~246),
// right-aligned. scale 1.34 makes a 64 px mini scrap ~86 px wide.
const HUD_CARDS = { y: 304, scale: 1.34, gap: 94, groupGap: 18, right: GAME_WIDTH - 76, minLeft: 70, cardW: 86, cardH: 99 };
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
const HUD_MACH = { tiers: [500, 1000, 1500, 2000, 2500], size: 28, dy: 30, afterMs: 150, preemptMs: 450 };
const HUD_SAFE_BOTTOM = 106;   // px at the bottom edge kept free of important text
const HUD_HINT_Y = GAME_HEIGHT - 320;   // the small hint line ('HOLD near a planet'), clear of the speed block

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

// First-run big prompts ('HOLD!' / 'LET GO!'): lettering size, comet clearance, preferred gap.
const HUD_PROMPT = { size: 124, cometClear: 130, above: 240, ease: 8 };

// Pure helper (tested): the crayon a big prompt is lettered in (go = green, wait = yellow).
function hudPromptCrayon(text) {
  return /LET GO|RELEASE|NOW/i.test(String(text)) ? 'green' : 'yellow';
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

// ---- Finger tutorial (tutorialHold / tutorialRelease / clearTutorial) ----
// The universal 'tap here' hand: an index FINGERTIP pressing on the page (nail, knuckle creases,
// the other fingers curled under, a short sleeve cuff), drawn in gel pen over peach crayon.
// Layer coords: the fingertip is (0, 0); side +1 = the hand trails off to the right of the tip
// (the target is on its left) and the 'HOLD / anywhere' lettering sits up-right of the tip.
// The hand is anchored to the planet / comet by an offset (re-placed every frame from the
// anchor, never eased in screen space); a new side or mode fades out and back in at the new spot.
const HUD_TUTORIAL = {
  scale: 0.62,           // hand texture 244 px tall -> ~151 px on screen
  lean: 0.42,            // rad: the hand trails down-and-away from the target
  fadeIn: 9,             // per second
  fadeOut: 10,
  swapOut: 22,           // per second: fading out to jump to a new spot / mode (~0.12 s)
  hideAlpha: 0.04,       // below this the hand counts as hidden and may jump
  dwellMs: 700,          // a spot that is still clear is kept at least this long
  staleMs: 400,          // no call for this long: fade out (GameScene stopped asking)
  pressMs: 1000,         // press cycle while holding is wanted
  liftMs: 1200,          // lift + arrow cycle while releasing is wanted
  liftPx: 46,            // how far the finger lifts
  planetGap: 16,         // px between the planet's edge (or rings) and the hand's box
  ringReach: 1.35,       // side spots clear pr * this (rings), not just the planet's body
  planetClear: 14,
  cometClear: 80,
  tailClear: 34,
  arrowFrom: 58,         // arrow starts this far from the comet along dir, ends at arrowTo
  arrowTo: 220,
  arrowClear: 22,
  keepBonus: 45,         // the spot in use wins ties, so the hand never flips side every frame
  memoryMs: 4000,        // the held planet is still avoided this long after the last hold call
  // Round the drawn hand at scale/lean, its ripples and the lettering (side +1; the hand's own
  // outline is checked against these in the hud tests and measured in the browser).
  holdBox: { l: -48, r: 142, t: -66, b: 142 },
  releaseBox: { l: -48, r: 182, t: -100, b: 142 },
  word: { x: 82, releaseX: 104, y: -34, subDy: 38, size: 50, subSize: 25 },
  rippleMax: 44,         // px: outer ripple radius
  dashGap: 10,           // the dashed line from the tip stops this far off the planet's edge
};

// Mirrors a side +1 box for side -1.
function hudTutorialBox(box, side) {
  return side < 0 ? { l: -box.r, r: -box.l, t: box.t, b: box.b } : { l: box.l, r: box.r, t: box.t, b: box.b };
}

// Pure helper (tested): candidate fingertip spots beside a planet (screen coords). Sides first
// (the one away from the comet a little preferred), then above / below as fallbacks. The hand
// always trails away from the planet. Each has its offset from the planet (dx, dy).
function hudTutorialHoldCandidates(px, py, pr, comet) {
  const T = HUD_TUTORIAL;
  const out = [];
  for (const side of [1, -1]) {
    const box = hudTutorialBox(T.holdBox, side);
    const reach = side > 0 ? -box.l : box.r;   // box edge on the planet's side, from the tip
    const awayPref = comet && Math.sign(comet.x - px) === side ? 30 : 0;
    out.push({ key: side > 0 ? 'right' : 'left', side, x: px + side * (pr * T.ringReach + T.planetGap + reach), y: py + 10, box, pref: awayPref });
  }
  // Above / below: the hand trails right, the tip a little left of the planet's middle.
  const up = hudTutorialBox(T.holdBox, 1);
  out.push({ key: 'above', side: 1, x: px - 20, y: py - pr - T.planetGap - up.b, box: up, pref: 90 });
  out.push({ key: 'below', side: 1, x: px - 20, y: py + pr + T.planetGap - up.t, box: up, pref: 110 });
  for (const c of out) { c.dx = c.x - px; c.dy = c.y - py; }
  return out;
}

// Pure helper (tested): candidate spots for the lifted hand round the comet: either side of the
// fling arrow, then behind the comet. Each box is pushed out along its direction until its near
// edge is `gap` px off the comet; the hand trails away from the arrow.
function hudTutorialReleaseCandidates(cx, cy, dx, dy) {
  const T = HUD_TUTORIAL;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const out = [];
  const place = (key, nx, ny, gap, side, along, pref) => {
    const box = hudTutorialBox(T.releaseBox, side);
    const hw = (box.r - box.l) / 2;
    const hh = (box.b - box.t) / 2;
    const ext = hw * Math.abs(nx) + hh * Math.abs(ny);
    const bx = cx + nx * (gap + ext) + ux * along;
    const by = cy + ny * (gap + ext) + uy * along;
    // Box center -> fingertip.
    out.push({ key, side, x: bx - (box.l + box.r) / 2, y: by - (box.t + box.b) / 2, box, pref });
  };
  for (const gap of [90, 150]) {
    for (const s of [1, -1]) {
      const nx = -uy * s;
      const ny = ux * s;
      const side = nx > 0.3 ? 1 : nx < -0.3 ? -1 : (ux > 0 ? -1 : 1);
      place((s > 0 ? 'p' : 'n') + gap, nx, ny, gap, side, 40, gap === 90 ? 0 : 25);
    }
    place('b' + gap, -ux, -uy, gap, ux > 0.2 ? -1 : 1, 0, 40);
  }
  for (const c of out) { c.dx = c.x - cx; c.dy = c.y - cy; }
  return out;
}

// Pure helper (tested): every candidate scored. Each spot is clamped into bounds {left, right,
// top, bottom}; it then pays for every obstacle circle {x, y, r, clear} it comes closer to than
// `clear`, for overlapping a blocked band {top, bottom}, and its own pref. prevKey gets a bonus.
function hudTutorialScore(candidates, obstacles, bounds, bands, prevKey) {
  const out = [];
  for (const c of candidates) {
    const b = c.box;
    let x = c.x;
    let y = c.y;
    const minX = bounds.left - b.l;
    const maxX = bounds.right - b.r;
    x = minX <= maxX ? Math.max(minX, Math.min(maxX, x)) : (minX + maxX) / 2;
    const minY = bounds.top - b.t;
    const maxY = bounds.bottom - b.b;
    y = minY <= maxY ? Math.max(minY, Math.min(maxY, y)) : (minY + maxY) / 2;
    const x0 = x + b.l; const x1 = x + b.r; const y0 = y + b.t; const y1 = y + b.b;
    let cost = c.pref || 0;
    let hits = 0;
    for (const o of obstacles || []) {
      const d = hudBoxDistance(o.x, o.y, x0, y0, x1, y1) - (o.r || 0);
      if (d < o.clear) { cost += 60 + (o.clear - d) * 20; hits++; }
    }
    for (const band of bands || []) {
      const overlap = Math.min(y1, band.bottom) - Math.max(y0, band.top);
      if (overlap > 0) cost += overlap * 10;
    }
    cost += Math.hypot(x - c.x, y - c.y) * 0.3;
    if (c.key === prevKey) cost -= HUD_TUTORIAL.keepBonus;
    out.push({ key: c.key, side: c.side, x, y, box: b, cost, hits });
  }
  return out;
}

// Pure helper (tested): the best candidate (see hudTutorialScore).
function hudTutorialPlace(candidates, obstacles, bounds, bands, prevKey) {
  let best = null;
  for (const s of hudTutorialScore(candidates, obstacles, bounds, bands, prevKey)) if (!best || s.cost < best.cost) best = s;
  return best;
}

// Pure helper (tested): what the hand does this frame. shown = { key, mode, at, target } (what
// is drawn, since when, for which target), best = the best spot now, current = the shown key's
// spot now (or null), target = the current target's number (a new planet gets a new one).
//   'snap'  hidden: jump straight to best (it never glides in from an old spot)
//   'swap'  the mode, target or side changed: fade out fast where it is, then snap
//   'keep'  stay on the shown key's spot (which follows its anchor)
function hudTutorialAction(shown, best, current, mode, alpha, now, target) {
  const T = HUD_TUTORIAL;
  if (!shown || !shown.key || alpha < T.hideAlpha) return 'snap';
  if (shown.mode !== mode) return 'swap';
  if (target !== undefined && shown.target !== undefined && shown.target !== target) return 'swap';
  if (!best || best.key === shown.key) return 'keep';
  if (current && current.hits === 0 && now - (shown.at || 0) < T.dwellMs) return 'keep';
  return 'swap';
}

// Pure helper (tested): the spot's box covers one of the circles {x, y, r} (planet body, comet).
// The hand would rather step away (fade out) than sit on what it points at.
function hudTutorialCovers(spot, circles) {
  if (!spot) return false;
  const b = spot.box;
  for (const c of circles || []) {
    if (!c) continue;
    if (hudBoxDistance(c.x, c.y, spot.x + b.l, spot.y + b.t, spot.x + b.r, spot.y + b.b) - (c.r || 0) < 0) return true;
  }
  return false;
}

// Pure helper (tested): one fade step toward target (0 / 1) at `rate` per second; settles exactly.
function hudTutorialFade(alpha, target, rate, dt) {
  const a = alpha + (target - alpha) * Math.min(1, Math.max(0, dt) * rate);
  if (target <= 0 && a < 0.02) return 0;
  if (target >= 1 && a > 0.98) return 1;
  return a;
}

// ---- Off-screen supernova warning (setNovaEta) ----
// eta: seconds until the nova front reaches the comet. Under HUD_NOVA_WARN.eta s with the front
// still below the screen, an orange crayon heat band grows along the bottom edge and a
// scribbled '!!' pulses, faster as eta shrinks.
const HUD_NOVA_WARN = { eta: 1.2, full: 0.3, minLevel: 0.3, hzMin: 2, hzMax: 9, staleMs: 400, belowMargin: 40, ease: 10 };

// Pure helper (tested): warning level 0..1. 0 when far (or bad input) or when the front is
// already up on screen (the player can see it).
function hudNovaWarnLevel(eta, novaScreenY) {
  const W = HUD_NOVA_WARN;
  if (typeof eta !== 'number' || isNaN(eta) || eta >= W.eta) return 0;
  if (typeof novaScreenY === 'number' && isFinite(novaScreenY) && novaScreenY < GAME_HEIGHT - W.belowMargin) return 0;
  const k = Math.max(0, Math.min(1, (W.eta - Math.max(0, eta)) / (W.eta - W.full)));
  return W.minLevel + (1 - W.minLevel) * k;
}

// Pure helper (tested): '!!' pulse rate (Hz) for a warning level.
function hudNovaWarnHz(level) {
  const W = HUD_NOVA_WARN;
  return W.hzMin + (W.hzMax - W.hzMin) * Math.max(0, Math.min(1, level || 0));
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
const HUD_NOTE = { rect: { left: 15, right: 305, top: 52, bottom: 236 }, under: 0.5, pad: 6, ease: 8 };

// Set bonus: short, high, never in the lower third or on the hint line (HUD_HINT_Y).
const HUD_SETBONUS = { y: 300, rowGap: 110, cometBand: 190, below: 250, maxY: 720, holdMs: 900, fadeMs: 300, labelDy: -82, subDy: 92, subHalf: 24 };

// Pure helper (tested): set bonus center y. High under the card row; pushed under the comet only
// when the comet flies right through that band, and capped well above the hint line.
function hudSetBonusY(cometY, rowBottom) {
  const S = HUD_SETBONUS;
  const high = Math.max(S.y, (rowBottom || 0) + S.rowGap);
  if (typeof cometY === 'number' && isFinite(cometY) && Math.abs(cometY - high) < S.cometBand) {
    return Math.min(S.maxY, Math.max(high, cometY + S.below));
  }
  return Math.min(S.maxY, high);
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
    this.warnText = uiInkText(this, GAME_WIDTH / 2, GAME_HEIGHT - 196, '!!', {
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
    this.chainY = 192;        // right of the score note, above the owned-card row

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
    this.prompt = null;       // the big first-run prompt on screen (or null)
    this.tut = null;          // finger tutorial (built on first use; see tutorialHold)
    this.popWait = [];        // pops waiting for a banner to fade (see POP_WAIT)
    this.bannerClearAt = 0;   // time the last banner stopped being readable
    this.nextWaitAt = 0;      // earliest time the next waiting pop may show

    // Speed written on the page, with a crayon underline (redrawn only on boil ticks / growth).
    // Crayon smudge first, so the underline, crown and number are all drawn on top of it.
    this.speedHalo = uiBoilImage(this, HUD_HALO.x, HUD_HALO.y, 'hud_speed_halo').setTint(HUD_HALO.ink).setAlpha(HUD_HALO.alpha);
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
    this.speedText = uiInkText(this, this.speedBaseX, this.speedBaseY, '', { size: HUD_SPEED.size, rot: -0.03, boil: false });
    // 'MACH 1568' in smaller lettering under the underline: the same speed, a huger number.
    this.machText = uiInkText(this, HUD_SPEED.x - 4, HUD_SPEED.lineY + HUD_MACH.dy, '', {
      size: HUD_MACH.size, color: uiColorHex(UI_CRAYON.yellow), strokeW: 5, rot: -0.025, boilAmount: 0.008,
    });
    this.createMultiplierBadge();
    this.bottomPanel = this.add.container(0, 0, [this.speedHalo, this.speedLine, this.momentumGfx, this.speedText, this.machText, this.badge]);
    // One layer for the stats, so the intro fade never fights the bump tweens on its children.
    this.statsLayer = this.add.container(0, 0, [this.note, this.bottomPanel]);
    const game = this.scene.get('Game');
    if (game && game.introActive) this.statsLayer.setAlpha(0);
    // y: clear of the speed block's flame crown (bottom-left corner).
    this.hintText = uiInkText(this, GAME_WIDTH / 2, HUD_HINT_Y, '', { size: 46, color: uiColorHex(UI_CRAYON.yellow), rot: -0.03 });
    this.tweens.add({ targets: this.hintText, scale: 1.08, yoyo: true, repeat: -1, duration: 420 });
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
    this.cardRowSpan = null;
    this.setBonusLayer = null;
    this.setBonusWait = [];    // set bonuses waiting for the zone banner / card pick / another set
    this.pendingBanner = null; // banner waiting for a set bonus to clear out
    this.bigClearAt = 0;       // last time a banner or set bonus was on screen
    this.fullscreenButton = addFullscreenButton(this);
    uiOnBoil(this, (v, tick) => { this.boilTick = tick; this.drawSpeedLine(true); this.drawMomentum(true); });
  }

  // Owned upgrade cards as taped index-card scraps in one row under the score note, right-aligned
  // (the note, chain line and fullscreen button stay clear). Each family's cards sit together;
  // a completed set gets ONE gold crayon loop round the whole group. New cards are slapped on
  // with an ink burst. Minis are ~86 game px wide (~44 CSS px on a 375 px phone).
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
    // The row is one container anchored at its right end; fitCardRow() slides (and if needed
    // shrinks) it so it always stays inside the side walls, which close in as the camera zooms out.
    if (!this.cardRow) {
      this.cardRow = this.add.container(L.right, L.y);
      this.cardRowFit = { x: L.right, scale: 1 };
    }
    // x per card (relative to the row's right end), right to left; a family change adds a small
    // gap so neighbouring loops never touch.
    const xs = new Array(ids.length);
    let x = 0;
    for (let i = ids.length - 1; i >= 0; i--) {
      xs[i] = x;
      const next = ids[i - 1];
      if (next !== undefined) x -= L.gap + (cardById(next).family !== cardById(ids[i]).family ? L.groupGap : 0);
    }
    // Span used by fitCardRow: the cards plus the set loop margin on both ends.
    this.cardRowSpan = { left: (ids.length ? xs[0] : 0) - L.cardW / 2 - 14, right: L.cardW / 2 + 14 };
    for (const family of sets) {
      const members = ids.map((id, i) => (cardById(id).family === family ? i : -1)).filter(i => i >= 0);
      if (!members.length) continue;
      const x0 = xs[members[0]];
      const x1 = xs[members[members.length - 1]];
      const w = x1 - x0 + L.cardW + 26;
      const loop = uiBoilImage(this, (x0 + x1) / 2, 2, cardSetGroupLoopTexture(this, w, L.cardH + 22, this.lightPage ? 0xc0861a : undefined));
      this.cardRow.add(loop);
      this.cardLoops.push(loop);
      if (members.some(i => known.indexOf(ids[i]) < 0)) {
        // The loop is scrawled round the group once the new card has landed.
        loop.setAlpha(0).setScale(0.85);
        this.tweens.add({ targets: loop, alpha: 1, scale: 1, delay: 380, duration: 200, ease: 'Back.Out' });
      }
    }
    this.fitCardRow(true);
    ids.forEach((id, i) => {
      const card = cardById(id);
      const cx = xs[i];
      const g = cardMakeMini(this, cx, 0, id, L.scale);
      this.cardRow.add(g);
      this.cardBadges.push({ id, gfx: g });
      if (known.indexOf(id) < 0) {
        g.setScale(L.scale * 1.8).setAlpha(0);
        this.tweens.add({ targets: g, scale: L.scale, alpha: 1, duration: 220, delay: 120, ease: 'Quad.In',
          onComplete: () => {
            g.setScale(L.scale * 1.12, L.scale * 0.86);
            this.tweens.add({ targets: g, scaleX: L.scale, scaleY: L.scale, duration: 200, ease: 'Back.Out' });
            const row = this.cardRow;
            cardDoodleBurst(this, row.x + cx * row.scaleX, row.y, [cardCrayon(card.family), this.lightPage ? UI_INK.dark : UI_INK.cream], { count: 6, reach: 100, ink: this.lightPage ? UI_INK.dark : undefined });
          } });
      }
    });
  }

  // Keeps the owned-card row inside the on-screen walls (eased, so it glides as the zoom moves).
  fitCardRow(snap) {
    if (!this.cardRow || !this.cardRowSpan) return;
    const walls = this.wallsOnScreen();
    const fit = hudFitCardRow(this.cardRowSpan.left, this.cardRowSpan.right, HUD_CARDS.right, walls.left, walls.right, 12);
    const f = this.cardRowFit;
    const k = snap ? 1 : 0.2;
    f.x += (fit.x - f.x) * k;
    f.scale += (fit.scale - f.scale) * k;
    this.cardRow.setPosition(f.x, HUD_CARDS.y).setScale(f.scale);
  }

  // Bottom of the owned-card row on screen (0 when no row is shown).
  cardRowBottom() {
    if (!this.cardBadges.length || !this.cardRow) return 0;
    return HUD_CARDS.y + (HUD_CARDS.cardH / 2 + 12) * this.cardRow.scaleY;
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

  // A zone banner, a banner about to show, a set bonus or the card pick is on screen.
  bigMomentBusy() {
    return !!((this.bannerText && this.bannerText.alpha > 0.02) || this.pendingBanner
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
    // High under the card row (hudSetBonusY): never in the lower third, never on the hint line.
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
  showMilestone(name, level) {
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
    this.placeMilestone(stamp);
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
      targets: stamp, alpha: 0, delay: 130 + HUD_MILESTONE.holdMs, duration: HUD_MILESTONE.fadeMs, ease: 'Quad.In',
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
  updateMilestone() {
    const m = this.milestone;
    if (!m || !m.active || !this.comet || m.leaving) return;
    const d = hudBoxDistance(this.comet.x, this.comet.y, m.x - m.halfW, m.y - m.halfH, m.x + m.halfW, m.y + m.halfH);
    if (d < 40) {
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
    const busy = this.bigMomentBusy() || (this.milestone && this.milestone.active) || this.isOverScreen();
    if (busy) { this.machClearAt = now; return; }
    if (now - this.machClearAt < HUD_MACH.afterMs) return;
    // Two tiers passed while waiting: only the highest is stamped (the lower one is old news).
    const top = Math.max.apply(null, this.machWait);
    this.machWait = [];
    this.showMilestone('MACH ' + top + '!', hudMachTierLevel(top));
    if (this.milestone) this.milestone.isMach = true;
  }

  // The run is over (a stamp would land on the death beat).
  isOverScreen() {
    const game = this.scene.get('Game');
    return !!(game && game.isOver);
  }

  // First-run instruction in huge crayon lettering ('HOLD!', then 'LET GO!'). The same text again
  // is a no-op (safe to call every frame); a new text replaces the old one with a fresh slam.
  bigPrompt(text) {
    const label = String(text || '');
    if (!label) { this.clearBigPrompt(); return; }
    if (this.prompt && this.prompt.label === label) return;
    if (this.prompt) { this.tweens.killTweensOf(this.prompt); this.prompt.destroy(); this.prompt = null; }
    const crayon = UI_CRAYON[hudPromptCrayon(label)];
    const title = uiTitleText(this, 0, 0, label, {
      size: HUD_PROMPT.size, color: uiColorHex(crayon), shadowColor: UI_INK.darkHex, shadowDx: 7, shadowDy: 9, rot: 0, boil: false,
    });
    // A wavy crayon underline, so it reads as written on the page, not a UI label.
    const line = uiBoilImage(this, 8, title.main.height / 2 - 6, 'ui_underline').setTint(crayon)
      .setScale(Math.min(1.1, (title.main.width + 30) / 540), 0.9);
    const box = this.add.container(GAME_WIDTH / 2, GAME_HEIGHT / 2, [line, title]);
    box.inkRot = -0.04;
    box.setRotation(box.inkRot);
    uiBoilRotation(this, box, 0.012);
    box.label = label;
    box.title = title;
    box.line = line;
    box.crayon = crayon;
    const walls = this.wallsOnScreen();
    box.fit = Math.min(1, (walls.right - walls.left - 50) / (title.main.width + 20));
    box.halfW = ((title.main.width + 20) * box.fit) / 2;
    box.halfH = ((title.main.height + 30) * box.fit) / 2;
    this.stylePrompt(box);
    box.setY(this.promptSpotY(box));
    this.prompt = box;
    box.setScale(box.fit * 1.9).setAlpha(0);
    this.tweens.add({
      targets: box, scale: box.fit, alpha: 1, duration: 140, ease: 'Quad.In',
      onComplete: () => {
        if (!box.active || this.prompt !== box) return;
        cardDoodleBurst(this, box.x, box.y, [crayon, this.lightPage ? UI_INK.dark : UI_INK.cream],
          { count: 8, reach: 200, squashY: 0.5, ink: this.lightPage ? UI_INK.dark : undefined });
        // A slow breathing pulse while it waits for the player.
        this.tweens.add({ targets: box, scale: box.fit * 1.07, yoyo: true, repeat: -1, duration: 380, ease: 'Sine.InOut' });
      },
    });
    // A pop in its band makes way.
    const live = this.popLine;
    if (live && live.active && Math.abs(live.y - box.y) < box.halfH + 60) this.removePop(live);
  }

  clearBigPrompt() {
    const box = this.prompt;
    if (!box) return;
    this.prompt = null;
    this.tweens.killTweensOf(box);
    this.tweens.add({ targets: box, alpha: 0, scale: box.scale * 1.15, duration: 160, ease: 'Quad.Out', onComplete: () => box.destroy() });
  }

  // Crayon on dark pages; pressed deeper (with an orange off-register copy) on the cream page.
  stylePrompt(box) {
    const ink = this.lightPage ? hudDeepen(box.crayon, 0.7) : box.crayon;
    box.title.main.setColor(uiColorHex(ink));
    box.title.shadow.setColor(this.lightPage ? uiColorHex(UI_CRAYON.orange) : UI_INK.darkHex);
    box.line.setTint(ink);
  }

  // Prompt y: ~HUD_PROMPT.above px above the comet (below it when the comet is high), at least
  // HUD_PROMPT.cometClear from the comet and its tail, never on a banner / set bonus / stamp.
  promptSpotY(box) {
    const walls = this.wallsOnScreen();
    const mid = (walls.left + walls.right) / 2;
    const comet = this.comet || { x: mid, y: GAME_HEIGHT * 0.7 };
    const minY = this.popTop() + box.halfH;
    const maxY = GAME_HEIGHT - POP.bottomMargin + 60 - box.halfH;
    const wantY = Phaser.Math.Clamp(comet.y - HUD_PROMPT.above, minY, maxY);
    const blocked = this.blockedBands(false, true);
    let best = null;
    let fallback = null;
    for (let y = minY; y <= maxY; y += 20) {
      const clearance = this.cometClearance(comet, mid - box.halfW, y - box.halfH, mid + box.halfW, y + box.halfH);
      const free = blocked.every(b => y + box.halfH + 6 <= b.top || y - box.halfH - 6 >= b.bottom);
      if (free && clearance >= HUD_PROMPT.cometClear) {
        const cost = Math.abs(y - wantY);
        if (!best || cost < best.cost) best = { y, cost };
      } else {
        const score = clearance + (free ? 1000 : 0);
        if (!fallback || score > fallback.score) fallback = { y, score };
      }
    }
    return (best || fallback || { y: wantY }).y;
  }

  // The prompt glides to stay clear of the orbiting comet (and centered between the walls).
  updateBigPrompt(dt) {
    const box = this.prompt;
    if (!box || !box.active) return;
    const walls = this.wallsOnScreen();
    const k = Math.min(1, dt * HUD_PROMPT.ease);
    box.x += ((walls.left + walls.right) / 2 - box.x) * k;
    box.y += (this.promptSpotY(box) - box.y) * k;
  }

  // ---- finger tutorial ----

  // Built once per HUD life, then shown / hidden: a layer at the fingertip with the hand
  // (shadow, peach crayon fill, blue sleeve cuff, gel-pen ink, all boiling), the press ripples
  // and the 'HOLD / anywhere' lettering. The dashed line to the planet and the fling arrow are
  // drawn in screen space on their own Graphics.
  buildTutorial() {
    const T = HUD_TUTORIAL;
    const ox = HUD_HAND.tipX / HUD_HAND.w;
    const oy = HUD_HAND.tipY / HUD_HAND.h;
    const shadow = uiBoilImage(this, 5, 7, 'hud_hand2_fill').setOrigin(ox, oy).setTint(UI_INK.dark).setAlpha(0.45);
    const fill = uiBoilImage(this, 0, 0, 'hud_hand2_fill').setOrigin(ox, oy).setTint(HUD_HAND.skin);
    const cuff = uiBoilImage(this, 0, 0, 'hud_hand2_cuff').setOrigin(ox, oy).setTint(UI_CRAYON.blue);
    const ink = uiBoilImage(this, 0, 0, 'hud_hand2_ink').setOrigin(ox, oy);
    const hand = this.add.container(0, 0, [shadow, fill, cuff, ink]).setScale(T.scale);
    const ripples = this.add.graphics();
    const word = uiInkText(this, T.word.x, T.word.y, 'HOLD', { size: T.word.size, color: uiColorHex(UI_CRAYON.yellow), strokeW: 9, rot: -0.05, boilAmount: 0.014 });
    const sub = uiInkText(this, T.word.x, T.word.y + T.word.subDy, 'anywhere', { size: T.word.subSize, strokeW: 6, rot: -0.03, boilAmount: 0.01 });
    const layer = this.add.container(0, 0, [ripples, hand, word, sub]).setAlpha(0).setVisible(false);
    const arrow = this.add.graphics().setAlpha(0).setVisible(false);
    this.tut = {
      layer, hand, fill, ink, shadow, cuff, word, sub, ripples, arrow,
      mode: null,         // wanted: 'hold' | 'release' | null (fade out)
      shown: null,        // drawn: { key, mode, at }
      lastCall: 0,
      alpha: 0,
      x: 0, y: 0,
      side: 1,
      modeAt: 0,          // time the shown mode started (animation phase)
      planet: null,       // last held planet {x, y, r, at}, still avoided while releasing
      release: null,      // {x, y, dx, dy} of the last tutorialRelease
      light: null,        // page ink the parts were last styled for
    };
    this.styleTutorial();
    return this.tut;
  }

  // Hold wanted: the finger presses beside the planet (screen coords, zoom applied). Safe every frame.
  tutorialHold(planetX, planetY, planetRadius) {
    if (![planetX, planetY, planetRadius].every(v => typeof v === 'number' && isFinite(v))) return;
    const t = this.tut || this.buildTutorial();
    const now = this.time.now;
    const old = t.planet;
    // A different planet (not the same one scrolling a few px per frame): a new target, so the
    // hand fades over to it instead of jumping or gliding across the page.
    if (!old || now - old.at > 250 || Math.hypot(planetX - old.x, planetY - old.y) > 40 + Math.abs(planetRadius - old.r)) {
      t.target = (t.target || 0) + 1;
    }
    t.planet = { x: planetX, y: planetY, r: Math.max(0, planetRadius), at: now };
    this.setTutorialMode(t, 'hold');
  }

  // Release wanted: the finger lifts beside the comet, an arrow shows the fling (dir: any length).
  tutorialRelease(cometX, cometY, dirX, dirY) {
    if (![cometX, cometY, dirX, dirY].every(v => typeof v === 'number' && isFinite(v))) return;
    const t = this.tut || this.buildTutorial();
    const len = Math.hypot(dirX, dirY);
    t.release = { x: cometX, y: cometY, dx: len > 0 ? dirX / len : 0, dy: len > 0 ? dirY / len : -1 };
    this.setTutorialMode(t, 'release');
  }

  clearTutorial() {
    if (this.tut) this.tut.mode = null;
  }

  // Only records what is wanted: the drawing switches over in updateTutorial (fade out, then in
  // at the new spot), so the word never changes while the old hand is still on screen.
  setTutorialMode(t, mode) {
    t.lastCall = this.time.now;
    t.mode = mode;
  }

  // The hand now shows `mode` at `spot` (called when it appears or after a swap fade-out).
  showTutorialAt(t, spot, mode) {
    const T = HUD_TUTORIAL;
    const now = this.time.now;
    if (!t.shown || t.shown.mode !== mode) t.modeAt = now;
    t.shown = { key: spot.key, mode, at: now, target: t.target || 0 };
    t.x = spot.x;
    t.y = spot.y;
    t.side = spot.side;
    const side = spot.side;
    t.relOffset = mode === 'release' && t.release ? { dx: spot.x - t.release.x, dy: spot.y - t.release.y, side } : null;
    t.hand.rotation = -side * T.lean;
    t.word.setText(mode === 'hold' ? 'HOLD' : 'LET GO');
    t.word.setPosition(side * (mode === 'release' ? T.word.releaseX : T.word.x), T.word.y - (mode === 'release' ? T.liftPx * 0.6 : 0));
    t.sub.setPosition(side * T.word.x, T.word.y + T.word.subDy).setVisible(mode === 'hold');
    t.light = null;
    this.styleTutorial();
    this.bump(t.word, 1.2);
  }

  // Ink and crayon for the page: cream gel pen on dark paper, dark ink and deeper crayon on pale.
  styleTutorial() {
    const t = this.tut;
    if (!t) return;
    const light = this.lightPage;
    const mode = t.shown ? t.shown.mode : 'hold';
    const key = (light ? 'L' : 'D') + mode;
    if (t.light === key) return;
    t.light = key;
    t.ink.setTint(light ? UI_INK.dark : UI_INK.cream);
    t.fill.setTint(light ? hudDeepen(HUD_HAND.skin, 0.95) : HUD_HAND.skin);
    t.cuff.setTint(light ? hudDeepen(UI_CRAYON.blue, 0.8) : UI_CRAYON.blue);
    t.shadow.setAlpha(light ? 0.22 : 0.45);
    const crayon = UI_CRAYON[hudPromptCrayon(mode === 'release' ? 'LET GO' : 'HOLD')];
    t.word.setColor(uiColorHex(light ? hudDeepen(crayon, 0.7) : crayon))
      .setStroke(UI_INK.darkHex, t.word.style.strokeThickness);   // ink-outlined crayon on every page
    t.sub.setColor(light ? UI_INK.darkHex : UI_INK.creamHex)
      .setStroke(light ? UI_INK.creamHex : UI_INK.darkHex, t.sub.style.strokeThickness);
  }

  // Every spot the hand could take this frame (scored by hudTutorialScore), inside the walls and
  // between the top HUD rows and the bottom blocks, off banners / set bonuses / stamps.
  tutorialSpots(t) {
    const T = HUD_TUTORIAL;
    const walls = this.wallsOnScreen();
    // Down to the safe bottom edge: the speed / multiplier blocks sit in the corners and the hint
    // line hides while the finger shows.
    const bounds = { left: walls.left + 14, right: walls.right - 14, top: this.popTop() - 10, bottom: GAME_HEIGHT - HUD_SAFE_BOTTOM - 20 };
    const obstacles = [];
    const bodies = [];
    const comet = this.comet;
    if (comet) bodies.push({ x: comet.x, y: comet.y, r: 18 });
    if (comet) {
      obstacles.push({ x: comet.x, y: comet.y, r: 0, clear: T.cometClear });
      obstacles.push({ x: comet.x, y: comet.y + 130, r: 0, clear: T.tailClear });
    }
    const now = this.time.now;
    const planet = t.planet && now - t.planet.at < T.memoryMs ? t.planet : null;
    let candidates;
    if (t.mode === 'release' && t.release) {
      const r = t.release;
      obstacles.push({ x: r.x, y: r.y, r: 0, clear: T.cometClear });
      for (let k = 0; k <= 4; k++) {
        const d = T.arrowFrom + ((T.arrowTo - T.arrowFrom) * k) / 4;
        obstacles.push({ x: r.x + r.dx * d, y: r.y + r.dy * d, r: 0, clear: T.arrowClear });
      }
      if (planet) obstacles.push({ x: planet.x, y: planet.y, r: planet.r, clear: 6 });
      bodies.push({ x: r.x, y: r.y, r: 18 });
      candidates = hudTutorialReleaseCandidates(r.x, r.y, r.dx, r.dy);
      // The spot in use keeps the offset it was given: the aim swings round as the comet orbits,
      // and a hand re-placed off the aim every frame would swing round the comet with it.
      const shown = t.shown;
      if (shown && shown.mode === 'release' && t.relOffset) {
        candidates = candidates.map(c => (c.key === shown.key
          ? Object.assign({}, c, { x: r.x + t.relOffset.dx, y: r.y + t.relOffset.dy, side: t.relOffset.side, box: hudTutorialBox(T.releaseBox, t.relOffset.side) })
          : c));
      }
    } else if (t.mode === 'hold' && planet) {
      obstacles.push({ x: planet.x, y: planet.y, r: planet.r, clear: T.planetClear });
      bodies.push({ x: planet.x, y: planet.y, r: planet.r });
      candidates = hudTutorialHoldCandidates(planet.x, planet.y, planet.r, comet);
    } else {
      return null;
    }
    const prev = t.shown && t.shown.mode === t.mode ? t.shown.key : null;
    const spots = hudTutorialScore(candidates, obstacles, bounds, this.blockedBands(false, false), prev);
    // Spots that would sit on the planet body or the comet are never used (no room: fade out).
    for (const s of spots) s.covers = hudTutorialCovers(s, bodies);
    let best = null;
    for (const s of spots) if (!s.covers && (!best || s.cost < best.cost)) best = s;
    return { spots, best };
  }

  updateTutorial(dt) {
    const t = this.tut;
    if (!t) return;
    const T = HUD_TUTORIAL;
    const now = this.time.now;
    if (t.mode && now - t.lastCall > T.staleMs) t.mode = null;
    const placed = t.mode ? this.tutorialSpots(t) : null;
    if (!placed || !placed.best) {
      t.alpha = hudTutorialFade(t.alpha, 0, T.fadeOut, dt);
    } else {
      const shown = t.shown;
      // The shown key's spot round the SAME target only (a new planet's spots would teleport it).
      const sameTarget = shown && shown.mode === t.mode && (t.mode !== 'hold' || shown.target === (t.target || 0));
      const found = sameTarget ? placed.spots.find(s => s.key === shown.key) : null;
      const current = found && !found.covers ? found : null;
      const action = hudTutorialAction(shown, placed.best, current, t.mode, t.alpha, now, t.mode === 'hold' ? (t.target || 0) : undefined);
      if (action === 'snap') {
        this.showTutorialAt(t, placed.best, t.mode);
        t.alpha = hudTutorialFade(t.alpha, 1, T.fadeIn, dt);
      } else if (action === 'swap') {
        // Fade out where it is (still riding its own anchor), then snap to the new spot.
        if (current) { t.x = current.x; t.y = current.y; }
        t.alpha = hudTutorialFade(t.alpha, 0, T.swapOut, dt);
      } else {
        const spot = current || placed.best;
        t.x = spot.x;
        t.y = spot.y;
        t.alpha = hudTutorialFade(t.alpha, 1, T.fadeIn, dt);
      }
    }
    const visible = t.alpha > 0;
    const mode = t.shown ? t.shown.mode : null;
    t.layer.setVisible(visible);
    t.arrow.setVisible(visible);
    if (!visible) { t.shown = null; t.arrow.clear(); return; }
    this.styleTutorial();
    t.layer.setAlpha(t.alpha);
    t.arrow.setAlpha(t.alpha);
    t.layer.setPosition(t.x, t.y);
    const side = t.side;
    const phaseMs = now - t.modeAt;
    const seed = this.boilTick || 0;
    const ink = this.lightPage ? UI_INK.dark : UI_INK.cream;
    t.ripples.clear();
    t.arrow.clear();
    if (mode !== 'release') {
      // Press: the tip comes down onto the page (ease in), holds with ripples spreading from
      // under it, then rises a little. The fingertip squashes as it presses.
      const p = (phaseMs % T.pressMs) / T.pressMs;
      const down = p < 0.3 ? Math.sin((p / 0.3) * Math.PI / 2) : p < 0.72 ? 1 : 1 - (p - 0.72) / 0.28;
      t.hand.y = -16 + down * 16;
      t.hand.x = side * (1 - down) * 6;
      t.hand.setScale(side * T.scale * (1 + down * 0.03), T.scale * (1 - down * 0.04));
      if (p >= 0.25) this.drawTutorialRipples(t.ripples, (p - 0.25) / 0.75, seed, ink, side);
      this.drawTutorialDashes(t, seed, ink);
    } else {
      // Lift: the finger springs up off the page with speed dashes under it, the arrow is drawn
      // out along the fling, then a quick reset.
      const p = (phaseMs % T.liftMs) / T.liftMs;
      const up = p < 0.35 ? 1 - Math.pow(1 - p / 0.35, 3) : p < 0.88 ? 1 : 1 - (p - 0.88) / 0.12;
      t.hand.y = -up * T.liftPx;
      t.hand.x = 0;
      t.hand.setScale(side * T.scale, T.scale);
      if (p > 0.05 && p < 0.6) this.drawLiftDashes(t.ripples, t.hand.y, seed, ink, Math.min(1, (0.6 - p) / 0.25));
      this.drawTutorialArrow(t, Math.min(1, p / 0.4), seed);
    }
  }

  // Three pen ripple arcs spreading from the pressed fingertip (layer coords, tip at 0,0), open
  // on the hand's side so they never cross the finger.
  drawTutorialRipples(g, k, seed, ink, side) {
    // Screen angles (y down): the free side is away from the hand (which trails down-right for
    // side +1), so the arcs run from down-left, round the left, over the top.
    const a0 = 0.62 * Math.PI;
    const a1 = 1.82 * Math.PI;
    for (let ring = 0; ring < 3; ring++) {
      const kk = k * 1.25 - ring * 0.22;
      if (kk <= 0 || kk >= 1) continue;
      const rad = 12 + kk * (HUD_TUTORIAL.rippleMax - 12);
      const alpha = (1 - kk) * 0.95;
      g.lineStyle(4.5 - ring * 1.1, ink, alpha);
      g.beginPath();
      const n = 10;
      for (let i = 0; i <= n; i++) {
        let a = a0 + ((a1 - a0) * i) / n;
        if (side < 0) a = Math.PI - a;
        const wob = (uiNoise(seed + ring * 13, i) - 0.5) * 3;
        const x = Math.cos(a) * (rad + wob);
        const y = Math.sin(a) * (rad + wob) * 0.92;
        if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
      }
      g.strokePath();
    }
  }

  // Dashed ink line from the fingertip to the planet it is about (screen coords), marching
  // toward it on the boil clock. Stops HUD_TUTORIAL.dashGap short of the planet's edge.
  drawTutorialDashes(t, seed, ink) {
    const T = HUD_TUTORIAL;
    const p = t.planet;
    if (!p) return;
    const g = t.arrow;
    const dx = p.x - t.x;
    const dy = p.y - t.y;
    const dist = Math.hypot(dx, dy);
    const ux = dx / (dist || 1);
    const uy = dy / (dist || 1);
    const from = 22;   // clear of the ripples' first ring
    const to = dist - p.r - T.dashGap;
    if (to - from < 18) return;
    const dash = 12;
    const gap = 10;
    const march = (seed % 4) * ((dash + gap) / 4);
    for (let d = from - (dash + gap) + march; d < to; d += dash + gap) {
      const s0 = Math.max(from, d);
      const s1 = Math.min(to, d + dash);
      if (s1 - s0 < 3) continue;
      uiScribbleLine(g, t.x + ux * s0, t.y + uy * s0, t.x + ux * s1, t.y + uy * s1, seed + Math.round(d), {
        width: 4.5, color: ink, alpha: 0.9, amp: 0.8, passes: 1,
      });
    }
  }

  // Upward speed dashes under the lifting finger.
  drawLiftDashes(g, handY, seed, ink, alpha) {
    for (let i = -1; i <= 1; i++) {
      const x = i * 16;
      const y0 = handY + 10 + Math.abs(i) * 6;
      uiScribbleLine(g, x, y0, x, Math.min(-4, y0 + 30 - Math.abs(i) * 8), seed + i * 5, { width: 4, color: ink, alpha, amp: 1, passes: 1 });
    }
  }

  // Curved ink arrow from just off the comet along the fling direction (screen coords), drawn out
  // to `grow` (0..1) of its length. Dark backing so it reads over planets and pale pages alike.
  drawTutorialArrow(t, grow, seed) {
    const g = t.arrow;
    g.clear();
    const r = t.release;
    if (!r || grow <= 0) return;
    const T = HUD_TUTORIAL;
    const sx = r.x + r.dx * T.arrowFrom;
    const sy = r.y + r.dy * T.arrowFrom;
    const len = (T.arrowTo - T.arrowFrom) * grow;
    const ex = sx + r.dx * len;
    const ey = sy + r.dy * len;
    // Bows a little away from the hand, so the stroke reads as drawn, not ruled.
    const bow = -t.side * 0.16 * len;
    const cx = (sx + ex) / 2 - r.dy * bow;
    const cy = (sy + ey) / 2 + r.dx * bow;
    const pts = [];
    const n = 12;
    for (let i = 0; i <= n; i++) {
      const u = i / n;
      const wob = (uiNoise(seed, i) - 0.5) * 3;
      pts.push({
        x: (1 - u) * (1 - u) * sx + 2 * (1 - u) * u * cx + u * u * ex - r.dy * wob,
        y: (1 - u) * (1 - u) * sy + 2 * (1 - u) * u * cy + u * u * ey + r.dx * wob,
      });
    }
    const green = this.lightPage ? hudDeepen(UI_CRAYON.green, 0.62) : UI_CRAYON.green;
    const tip = pts[n];
    const prev = pts[n - 2];
    const ang = Math.atan2(tip.y - prev.y, tip.x - prev.x);
    const head = Math.min(30, 10 + len * 0.15);
    const heads = [ang + 2.6, ang - 2.6].map(a => ({ x: tip.x + Math.cos(a) * head, y: tip.y + Math.sin(a) * head }));
    const stroke = (w, color, alpha) => {
      g.lineStyle(w, color, alpha);
      g.beginPath();
      pts.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)));
      g.strokePath();
      for (const h of heads) {
        g.beginPath();
        g.moveTo(tip.x, tip.y);
        g.lineTo(h.x, h.y);
        g.strokePath();
      }
    };
    stroke(15, UI_INK.dark, this.lightPage ? 0.35 : 0.7);
    stroke(8, green, 1);
    // A lighter re-trace along part of the shaft, like a second pen pass.
    g.lineStyle(3, this.lightPage ? UI_INK.dark : UI_INK.cream, 0.55);
    g.beginPath();
    for (let i = 2; i <= n - 3; i++) {
      const p = pts[i];
      if (i === 2) g.moveTo(p.x + 2, p.y - 2); else g.lineTo(p.x + 2, p.y - 2);
    }
    g.strokePath();
  }

  // The finger tutorial is showing (the small hint line steps aside for it).
  tutorialShowing() {
    return !!(this.tut && this.tut.alpha > 0.05);
  }

  // "x3" written on the page inside a crayon circle that pulses when the multiplier rises.
  createMultiplierBadge() {
    this.badgeCircle = uiBoilImage(this, 0, 0, 'ui_circle').setScale(HUD_BADGE.scaleX, HUD_BADGE.scaleY).setTint(HUD_LEVEL_TINTS[0]);
    this.badgeText = uiInkText(this, 0, 0, 'x1', { size: HUD_BADGE.size, rot: 0.06, boil: false });
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
    this.updateSpeedReadout(time, dt);
    this.updatePageInk();
    this.updatePops();
    this.flushSetBonus(time);
    this.flushMachTier(time);
    this.updateMilestone();
    this.updateBigPrompt(dt);
    this.updateTutorial(dt);
    // One instruction at a time: the small hint line steps aside for a big prompt / the finger.
    this.hintText.setVisible(!this.prompt && !this.tutorialShowing());
    this.fitCardRow(false);
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
    for (const t of [this.speedText, this.badgeText, this.bannerText, this.bannerSub]) t.setColor(ink).setStroke(edge, t.style.strokeThickness);
    this.machText.setColor(light ? uiColorHex(hudDeepen(UI_CRAYON.orange, 0.7)) : uiColorHex(UI_CRAYON.yellow))
      .setStroke(edge, this.machText.style.strokeThickness);
    if (this.prompt) this.stylePrompt(this.prompt);
    this.shown.speedInk = null;   // the momentum crayon is re-applied on the next frame
    this.badgeCircle.setTint(this.levelTint(this.lastMultiplier));
    // Hint: dark ink outlined in orange crayon on cream; yellow on dark pages.
    this.hintText.setColor(light ? UI_INK.darkHex : uiColorHex(UI_CRAYON.yellow))
      .setStroke(light ? uiColorHex(UI_CRAYON.orange) : UI_INK.darkHex, this.hintText.style.strokeThickness);
    for (const t of [this.comboWord, this.comboNum]) t.setStroke(edge, t.style.strokeThickness);
    if (this.chain >= 2) this.styleCombo(this.chain);
    // Fullscreen corners: the tint turns the cream strokes to dark ink.
    const icon = this.fullscreenButton && this.fullscreenButton.list && this.fullscreenButton.list[0];
    if (icon) { if (light) icon.setTint(UI_INK.dark); else icon.clearTint(); }
    if (this.popLine && this.popLine.active) this.stylePop(this.popLine);
    // Set loops are redrawn in the deeper gold (known cards are not slapped in again).
    if (this.cardBadges.length) this.setCards(this.cardBadges.map(b => b.id));
    // Dark ink smudge on dark paper; a cream paper smudge under the dark ink of the cream page.
    if (this.speedHalo) this.speedHalo.setTint(light ? UI_CRAYON.note : HUD_HALO.ink);
    this.drawSpeedLine(true);
  }

  // Multiplier loop color: the warm ramp, pressed harder (and x1 in dark ink) on the cream page.
  levelTint(level) {
    const tint = HUD_LEVEL_TINTS[level - 1];
    if (!this.lightPage) return tint;
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
    this.setTextIfChanged('mach', this.machText, kmPerS > 0 ? 'MACH ' + hudMachNumber(kmPerS) : '');
    this.momentum += (this.momentumTarget - this.momentum) * Math.min(1, dt * HUD_MOMENTUM.ease);
    const style = hudMomentumStyle(this.momentum);
    const ink = this.lightPage ? (this.momentum < 0.3 ? UI_INK.dark : hudDeepen(style.ink, 0.66)) : style.ink;
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
    const color = this.lightPage ? hudDeepen(speedColor(f), 0.7) : speedColor(f);
    const x0 = HUD_SPEED.x - 104;
    g.clear();
    uiScribbleLine(g, x0, HUD_SPEED.lineY, x0 + len, HUD_SPEED.lineY - len * 0.03, seed, { width: 7, color, amp: 2.5 });
    if (f > 0.45) {
      const ink = this.lightPage ? UI_INK.dark : UI_INK.cream;
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
      if (level > previousLevel) this.bump(this.badge, 1.5);
    }
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
      out.push({ x: s.x, y: s.y, r: (p.radius || 0) * zoom * (p.hasRing ? 1.35 : 1) });
    }
    for (const h of game.blackHoles || []) {
      const s = game.worldToScreen(h.x, h.y);
      out.push({ x: s.x, y: s.y, r: 80 * zoom });
    }
    return out;
  }

  // The score note and the two bottom-corner blocks step back while a planet / black hole / the
  // comet is under them, so nothing that matters ever hides behind the HUD.
  updateDeclutter(dt) {
    const bodies = this.screenBodies();
    const c = this.comet;
    const cometCircle = c ? [{ x: c.x, y: c.y, r: 24 }] : [];
    const U = HUD_PANEL_UNDER;
    const under = (rect) => (hudCirclesUnder(rect, cometCircle, U.cometPad) ? U.comet
      : hudCirclesUnder(rect, bodies, U.planetPad) ? U.planet : 1);
    this.panelFadeTarget = under(HUD_PANEL);
    this.badgeFadeTarget = under(HUD_BADGE_PANEL);
    const noteTarget = hudCirclesUnder(HUD_NOTE.rect, bodies.concat(cometCircle), HUD_NOTE.pad) ? HUD_NOTE.under : 1;
    this.noteFade += (noteTarget - this.noteFade) * Math.min(1, dt * HUD_NOTE.ease);
    if (this.note) this.note.setAlpha(this.noteFade);
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
    const target = fresh && !over ? hudNovaWarnLevel(this.novaEta, this.novaScreenY) : 0;
    // Rises at once (every frame of warning counts), eases off.
    this.warnLevel = target >= this.warnLevel ? target : this.warnLevel + (target - this.warnLevel) * Math.min(1, dt * W.ease);
    if (this.warnLevel < 0.01) this.warnLevel = 0;
    const level = this.warnLevel;
    this.warnPhase = (this.warnPhase + dt * hudNovaWarnHz(level)) % 1;
    const beat = 0.5 + 0.5 * Math.cos(this.warnPhase * Math.PI * 2);   // 1 on the beat
    this.heat.setAlpha(level * (0.55 + 0.45 * beat)).setScale(1, 0.55 + level * 0.6);
    this.warnText.setAlpha(level > 0 ? Math.min(1, 0.35 + level) * (0.45 + 0.55 * beat) : 0)
      .setScale(0.8 + level * 0.35 + beat * 0.18);
    if (level > 0) {
      // Under the comet, so the eye is already there; kept between the corner blocks.
      const cx = this.comet ? Phaser.Math.Clamp(this.comet.x, 230, GAME_WIDTH - 230) : GAME_WIDTH / 2;
      this.warnText.x += (cx - this.warnText.x) * Math.min(1, dt * 8);
    }
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
    // A learner never gets '-15% SPEED' printed over HOLD / LET GO (GameScene also holds them back).
    if (this.tut && this.tut.mode && /^\s*-\s*\d+\s*%/.test(String(label))) return;
    const now = this.time.now;
    const priority = opts.priority || popPriority(label);
    const cur = this.popLine && this.popLine.active ? this.popLine : null;
    const age = cur ? now - cur.bornAt : Infinity;
    if (cur && cur.label === label && age < POP.sameLabelMs) {
      // The same event again: re-punch the line in place, no second copy.
      cur.lifetime = Math.max(cur.lifetime, Math.max(450, opts.duration || 700));
      this.animatePop(cur, true);
      return;
    }
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

  // Top of the area pops may use (below the score note, or the owned-card row when shown).
  popTop() {
    return this.cardBadges && this.cardBadges.length ? POP.topWithCards : POP.top;
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
  animatePop(t, again) {
    this.tweens.killTweensOf(t);
    const s = t.fitScale;
    t.drift = 0;
    t.setAlpha(1).setScale(again ? s * POP.overshoot : s * 0.45);
    this.tweens.add({ targets: t, scale: s, duration: 120, ease: again ? 'Quad.Out' : 'Back.Out' });
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
    this.popQueue.length = 0;
    this.popWait = [];
    this.setBonusWait = [];
    this.machWait = [];
    if (this.prompt) { this.prompt.destroy(); this.prompt = null; }
    if (this.tut) {
      this.tut.mode = null;
      this.tut.alpha = 0;
      this.tut.layer.setVisible(false).setAlpha(0);
      this.tut.arrow.clear();
      this.tut.arrow.setVisible(false);
    }
    if (this.milestone) { this.milestone.destroy(); this.milestone = null; }
    if (this.popLine) this.removePop(this.popLine);
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
  blockedBands(skipMilestone, skipPrompt) {
    const out = [];
    const p = this.prompt;
    if (!skipPrompt && p && p.active) out.push({ top: p.y - p.halfH, bottom: p.y + p.halfH });
    const band = this.bannerBand();
    if (band) out.push(band);
    if (this.setBonusLayer && this.setBonusLayer.active) out.push({ top: this.setBonusLayer.y - 140, bottom: this.setBonusLayer.y + 130 });
    const m = this.milestone;
    if (!skipMilestone && m && m.active && m.alpha > 0.1) out.push({ top: m.y - m.halfH, bottom: m.y + m.halfH });
    return out;
  }

  // Waiting pops come out one by one once the banner has faded (and the card pick is closed);
  // stale ones (the moment has passed) are dropped.
  flushWaitingPops(now) {
    if (!this.popWait.length) return;
    if (this.bannerUp() || this.scene.isActive('Cards')) { this.bannerClearAt = 0; return; }
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

  // opts.duration: ms fully visible before the fade (default 1400). A set bonus on screen is
  // hurried off first, so the two never overlap (the zone banner keeps its timing for the pick).
  showBanner(title, subtitle, opts) {
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
    const hold = opts && opts.duration !== undefined ? opts.duration : 1400;
    const parts = this.bannerParts();
    this.tweens.killTweensOf(parts);
    // Pushed down under the owned-card row when it is shown.
    const y = this.cardBadges.length ? Math.max(HUD_BANNER.yWithCards, this.cardRowBottom() + 70) : HUD_BANNER.y;
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
    this.tweens.add({ targets: parts, alpha: 0, delay: hold, duration: 400 });
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

  showHint(label) {
    this.hintHiding = false;
    if (this.hintFade) this.hintFade.stop();   // only the fade: the pulse tween keeps running
    this.hintFade = null;
    this.hintText.setText(label).setAlpha(1);
  }

  // Fast fade (150ms) so a hint never outlives the action it describes.
  hideHint() {
    if (this.hintHiding || this.hintText.alpha === 0) return;
    this.hintHiding = true;
    this.hintFade = this.tweens.add({ targets: this.hintText, alpha: 0, duration: 150 });
  }
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

// Pure helper (tested): the hand outline in layer coords (tip at 0, 0) for a side, with the hand
// shifted by (shiftX, liftY) - exactly how updateTutorial poses it (mirrored, leaned, scaled).
function hudHandPoints(side, liftY, shiftX) {
  const T = HUD_TUTORIAL;
  const H = HUD_HAND;
  const rot = -side * T.lean;
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  return H.outline.map(([px, py]) => {
    const x = (px - H.tipX) * T.scale * side;
    const y = (py - H.tipY) * T.scale;
    return { x: (shiftX || 0) + x * c - y * s, y: (liftY || 0) + x * s + y * c };
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
