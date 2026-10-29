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
//   setCards(ownedIds)        row of owned upgrade-card minis (under the score note, right-aligned)
//   showSetBonus(familyKey)   family-colored SET BONUS banner (SET_BONUSES in src/cards.js)
//   scoreText / hintText are read by GameScene, so they stay Text objects.

// Pop rules (see pop()): only ONE pop line is ever on screen; it never sits on the comet.
const POP = {
  top: 270,              // below the stats note (note + chain line end around y 245)
  topWithCards: 372,     // below the owned-card row when it is shown
  bottomMargin: 300,     // above the hint (y 1040) and the speed/xN band (y ~1130)
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
const HUD_BANNER = { y: 400, yWithCards: 474 };

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

// Bottom HUD band (speed readout + multiplier) bounds, for fading it under the comet.
const HUD_PANEL = { left: 130, right: 650, top: GAME_HEIGHT - 190, bottom: GAME_HEIGHT - 70 };
const HUD_SPEED = { x: 300, y: GAME_HEIGHT - 140, lineY: GAME_HEIGHT - 100, minLine: 70, maxLine: 330 };
// Owned-card row: under the score note (which ends near y 232) and the chain line (y ~246),
// right-aligned. scale 1.34 makes a 64 px mini scrap ~86 px wide.
const HUD_CARDS = { y: 304, scale: 1.34, gap: 94, groupGap: 18, right: GAME_WIDTH - 76, minLeft: 70, cardW: 86, cardH: 99 };
// Multiplier circle tint by level (x1..x5): the same warm ramp as the comet.
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
    this.milestone = null;    // the chain milestone stamp on screen (or null)
    this.popWait = [];        // pops waiting for a banner to fade (see POP_WAIT)
    this.bannerClearAt = 0;   // time the last banner stopped being readable
    this.nextWaitAt = 0;      // earliest time the next waiting pop may show

    // Speed written on the page, with a crayon underline (redrawn only on boil ticks / growth).
    this.speedLine = this.add.graphics();
    this.speedBaseX = HUD_SPEED.x;
    this.speedBaseY = HUD_SPEED.y;
    this.speedText = uiInkText(this, this.speedBaseX, this.speedBaseY, '', { size: 54, rot: -0.03, boil: false });
    this.createMultiplierBadge();
    this.bottomPanel = this.add.container(0, 0, [this.speedLine, this.speedText, this.badge]);
    // One layer for the stats, so the intro fade never fights the bump tweens on its children.
    this.statsLayer = this.add.container(0, 0, [this.note, this.bottomPanel]);
    const game = this.scene.get('Game');
    if (game && game.introActive) this.statsLayer.setAlpha(0);
    this.hintText = uiInkText(this, GAME_WIDTH / 2, GAME_HEIGHT - 240, '', { size: 46, color: uiColorHex(UI_CRAYON.yellow), rot: -0.03 });
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
    this.fullscreenButton = addFullscreenButton(this);
    uiOnBoil(this, (v, tick) => { this.boilTick = tick; this.drawSpeedLine(true); });
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
  // above or below the comet (it follows a card pick, so the zone banner is already gone).
  showSetBonus(familyKey) {
    if (typeof SET_BONUSES === 'undefined' || !SET_BONUSES[familyKey]) return;
    const bonus = SET_BONUSES[familyKey];
    const crayon = cardCrayon(familyKey);
    // Away from the comet: it must stay visible while the set name is up.
    // With the owned-card row up, the set bonus sits lower so its label clears the row.
    const cometY = this.comet ? this.comet.y : GAME_HEIGHT;
    const high = this.cardBadges.length ? 540 : 470;
    const y = cometY >= high + 200 ? high : Math.min(880, Math.max(high, cometY + 260));
    if (this.setBonusLayer) this.setBonusLayer.destroy();
    const label = uiInkText(this, 0, -82, 'SET BONUS!', { size: 40, color: uiColorHex(UI_CRAYON.yellow), rot: -0.05 });
    const title = uiTitleText(this, 0, 0, bonus.name, { size: 78, color: uiColorHex(crayon), shadowColor: UI_INK.darkHex, rot: -0.03 });
    const titleW = title.main.width;
    title.setScale(Math.min(1, (GAME_WIDTH - 250) / titleW));
    const line = uiBoilImage(this, 6, 50, 'ui_underline').setTint(crayon).setScale(Math.min(1, (titleW * title.scaleX + 30) / 540), 0.8);
    const sub = uiInkText(this, 0, 92, bonus.desc, { size: 34, rot: 0.015 });
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
      targets: layer, alpha: 0, y: y - 40, delay: 1700, duration: 400,
      onComplete: () => { if (this.setBonusLayer === layer) this.setBonusLayer = null; layer.destroy(); },
    });
    cardDoodleBurst(this, GAME_WIDTH / 2, y, [crayon, UI_CRAYON.yellow, UI_INK.cream], { count: 14, reach: 300, squashY: 0.6 });
    this.flash(crayon, 0.1, 220);
    // A pop in the set bonus band makes way, as for zone banners.
    const live = this.popLine;
    if (live && Math.abs(live.y - y) < 160) this.removePop(live);
  }

  // PERFECT chain milestone (GameScene at chain 5 / 10 / 25 / +25): the name rubber-stamped
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

  // "x3" written on the page inside a crayon circle that pulses when the multiplier rises.
  createMultiplierBadge() {
    this.badgeCircle = uiBoilImage(this, 0, 0, 'ui_circle').setScale(0.62, 0.78).setTint(HUD_LEVEL_TINTS[0]);
    this.badgeText = uiInkText(this, 0, 0, 'x1', { size: 50, rot: 0.06, boil: false });
    this.badge = this.add.container(GAME_WIDTH / 2 + 205, HUD_SPEED.y + 4, [this.badgeCircle, this.badgeText]);
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
    this.updateSpeedReadout(time, dt);
    this.updatePageInk();
    this.updatePops();
    this.updateMilestone();
    this.fitCardRow(false);
    // Bottom band eases toward its target alpha, so it does not blink as the comet passes.
    // The card pick's countdown ring sits over the speed band, so the band steps back meanwhile.
    const fadeTarget = this.scene.isActive('Cards') ? 0.12 : this.panelFadeTarget;
    this.panelFade += (fadeTarget - this.panelFade) * Math.min(1, dt * 10);
    this.bottomPanel.setAlpha(this.panelFade);
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
    const light = !!(UI_PAPERS[zone] && UI_PAPERS[zone].light);
    if (light === this.lightPage) return;
    this.lightPage = light;
    const ink = light ? UI_INK.darkHex : UI_INK.creamHex;
    const edge = light ? UI_INK.creamHex : UI_INK.darkHex;
    for (const t of [this.speedText, this.badgeText, this.bannerText, this.bannerSub]) t.setColor(ink).setStroke(edge, t.style.strokeThickness);
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
    this.drawSpeedLine(true);
  }

  // Multiplier loop color: the warm ramp, pressed harder (and x1 in dark ink) on the cream page.
  levelTint(level) {
    const tint = HUD_LEVEL_TINTS[level - 1];
    if (!this.lightPage) return tint;
    return level === 1 ? UI_INK.dark : hudDeepen(tint, 0.72);
  }

  // Combo number crayon by milestone tier (5 / 10 / 25): yellow, orange, red; pressed harder
  // on the cream page.
  chainColor(chain) {
    const crayon = chain >= 25 ? UI_CRAYON.red : chain >= 10 ? UI_CRAYON.orange : chain >= 5 ? UI_CRAYON.yellow : null;
    if (this.lightPage) return crayon ? uiColorHex(hudDeepen(crayon, 0.72)) : UI_INK.darkHex;
    return crayon ? uiColorHex(crayon) : UI_INK.creamHex;
  }

  styleCombo(chain) {
    this.setColorIfChanged('comboNum', this.comboNum, this.chainColor(chain));
    this.setColorIfChanged('comboWord', this.comboWord, this.lightPage ? UI_INK.pencilDarkHex : uiColorHex(UI_CRAYON.yellow));
  }

  // The number rolls toward the real speed (fast up, a bit slower down) so gains feel like a
  // climb, and the handwriting shivers near the top of the range.
  updateSpeedReadout(time, dt) {
    const gap = this.targetSpeed - this.shownSpeed;
    const rate = gap > 0 ? 8 : 5;
    if (Math.abs(gap) < 0.5) this.shownSpeed = this.targetSpeed;
    else this.shownSpeed += gap * Math.min(1, dt * rate);
    this.setTextIfChanged('speed', this.speedText, Math.round(this.shownSpeed) + ' km/s');
    const f = this.speedFrac;
    const hot = Math.max(0, (f - 0.6) / 0.4);   // 0 below 60% of max, 1 at max
    const climbing = gap > 3 ? 0.06 : 0;
    this.speedText.setScale(1 + f * 0.12 + climbing);
    const shake = hot * 3.5;
    this.speedText.setPosition(
      this.speedBaseX + (shake ? Math.sin(time * 0.09) * shake : 0),
      this.speedBaseY + (shake ? Math.cos(time * 0.113) * shake * 0.6 : 0),
    );
    this.drawSpeedLine(false);
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
    const x0 = HUD_SPEED.x - 150;
    g.clear();
    uiScribbleLine(g, x0, HUD_SPEED.lineY, x0 + len, HUD_SPEED.lineY - len * 0.03, seed, { width: 7, color, amp: 2.5 });
    if (f > 0.45) {
      const ink = this.lightPage ? UI_INK.dark : UI_INK.cream;
      const marks = 1 + Math.floor((f - 0.45) / 0.18);
      for (let i = 0; i < marks; i++) {
        const y = HUD_SPEED.y - 24 + i * 22;
        const x = x0 - 18 - (i % 2) * 14;
        uiScribbleLine(g, x - 46 + i * 6, y, x, y - 3, seed + i * 7, { width: 4, color: ink, amp: 1.2, passes: 1 });
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
    const dx = Math.max(HUD_PANEL.left - x, 0, x - HUD_PANEL.right);
    const dy = Math.max(HUD_PANEL.top - y, 0, y - HUD_PANEL.bottom);
    const near = Math.hypot(dx, dy) < 140;
    this.panelFadeTarget = near ? 0.35 : 1;
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
  blockedBands(skipMilestone) {
    const out = [];
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

  // opts.duration: ms fully visible before the fade (default 1400).
  showBanner(title, subtitle, opts) {
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
    const parts = this.bannerParts();
    this.tweens.killTweensOf(parts);
    const visible = parts.filter(p => p.alpha > 0);
    if (visible.length) this.tweens.add({ targets: visible, alpha: 0, duration: 140, ease: 'Quad.Out' });
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

// HUD-only doodle textures (built once per game; existing keys are skipped).
function uiMakeHudTextures(scene) {
  uiCircleTexture(scene);
  uiUnderlineTexture(scene);
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
