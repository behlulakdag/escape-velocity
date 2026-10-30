// Game over: a torn notebook page taped onto the sketchbook, its bottom edge singed by the
// supernova. Score, NEW BEST circled in red crayon, a handwritten stats list and the next goal.
// GameScene passes score, altitude, reason, newBestAltitude, bestAltitude and (optional)
// topSpeedKmh, maxChain, zoneIndex, seconds, secondWind; a missing optional stat drops its row.
const GO_CARD = { w: 600, h: 700, pad: 34, x: GAME_WIDTH / 2, y: 548 };
// Top speed is the theme's headline stat: written big in hot crayon with doodled flames, between
// the score and the stats list. The list sits on the page's rule lines (row y + 24).
const GO_HEAD = { y: -16, labelX: -228, numX: 150, numSize: 96, unitSize: 40 };
const GO_ROWS = { top: 58, step: 52 };
const GO_GOAL_Y = 264;
// 'NEW CARD FOUND' sticky note, page-local: hangs over the page's right edge between the score and
// the top speed flames (clear of a 6-digit score).
const GO_NEWCARD = { x: 256, y: -166, w: 172, h: 112 };
// Build strip under the page (strip-local coordinates). Five cards get ~127 px slots; names are
// written at 26 px (~13 CSS px on a 360 px phone) on up to two lines.
const GO_STRIP = { y: 914, h: 164, left: 62, right: 700, maxSlot: 150, cardY: -30, cardScale: 0.95, labelY: 6, labelSize: 26 };

// Card name for the narrow build slot: one word per line, and the long single words broken
// with a hand-written hyphen, so every label fits its slot at full size (no shrinking).
const GO_LABEL_BREAKS = { Aerodynamic: 'Aero-\ndynamic', Afterburner: 'After-\nburner', Shockwave: 'Shock-\nwave', Overdrive: 'Over-\ndrive', Slingshot: 'Sling-\nshot' };
function goCardLabel(name) {
  return GO_LABEL_BREAKS[name] || name.split(' ').join('\n');
}

// With the meta layer (PROGRESS) the page shares the screen with a missions note, so the page
// is scaled to fit above it and RETRY / MENU sit side by side at a fixed spot (same place every
// run, so the thumb learns it). Page-local content keeps its coordinates; only the container scales.
const GO_META = {
  pageTop: 172, pageH: 640, pageImageY: -30,     // compact page spans local -350..290 (no goal line)
  noteW: 640, noteH: 214, noteBottom: 1058, rowTop: 86, rowStep: 50, rowW: 600,
  stripScale: 0.86, stripOverlap: 14,
  buttonsY: 1132,
  retry: { x: 262, w: 400, h: 128, font: '68px' },
  menu: { x: 592, w: 200, h: 110, font: '44px' },
};

// Where everything goes. hasBuild: the run picked cards (build strip); hasMeta: PROGRESS loaded.
function goLayout(hasBuild, hasMeta) {
  const cx = GAME_WIDTH / 2;
  if (!hasMeta) {
    return {
      meta: false, pageY: hasBuild ? GO_CARD.y - 22 : GO_CARD.y, pageScale: 1, pageH: GO_CARD.h, pageImageY: 0,
      stripY: GO_STRIP.y, stripScale: 1,
      retry: { x: cx, y: hasBuild ? 1062 : 1002, w: 460, h: hasBuild ? 124 : 140, font: '72px' },
      menu: { x: cx, y: hasBuild ? 1182 : 1145, w: 320, h: 100, font: '48px' },
    };
  }
  const M = GO_META;
  const noteTop = M.noteBottom - M.noteH;
  const stripH = GO_STRIP.h * M.stripScale;
  const stripY = noteTop - stripH / 2 + 8;
  const pageBottom = hasBuild ? stripY - stripH / 2 + M.stripOverlap : noteTop - 4;
  const pageTopLocal = -GO_CARD.h / 2;
  const pageBottomLocal = M.pageImageY + M.pageH / 2;
  const pageScale = Math.min(1, (pageBottom - M.pageTop) / (pageBottomLocal - pageTopLocal));
  return {
    meta: true, pageY: M.pageTop - pageTopLocal * pageScale, pageScale, pageH: M.pageH, pageImageY: M.pageImageY,
    stripY, stripScale: M.stripScale, noteY: noteTop + M.noteH / 2,
    retry: Object.assign({ y: M.buttonsY }, M.retry),
    menu: Object.assign({ y: M.buttonsY }, M.menu),
  };
}

// Mission rows the game over note starts with, and what each becomes: the missions finished this
// run first (crossed out, then replaced by the next from the pool), then the ones still going.
// progress: PROGRESS.endRun() result (or null); active: PROGRESS.activeMissions() after it.
function goMissionPlan(progress, active) {
  const res = progress || {};
  const completed = Array.isArray(res.completed) ? res.completed : [];
  const fresh = Array.isArray(res.newMissions) ? res.newMissions : [];
  const freshIds = fresh.map((m) => m.id);
  const rows = completed.map((m, i) => ({ mission: m, done: true, replaceWith: fresh[i] || null }));
  for (const m of active || []) if (freshIds.indexOf(m.id) < 0) rows.push({ mission: m, done: false, replaceWith: null });
  // More new missions than finished ones (e.g. a short list topped up): they simply appear.
  for (let i = completed.length; i < fresh.length; i++) rows.push({ mission: fresh[i], done: false, replaceWith: null, isNew: true });
  return rows.slice(0, 3);
}

function goNumber(value) {
  return typeof value === 'number' && isFinite(value) ? value : undefined;
}

function goFormatTime(seconds) {
  const s = Math.max(0, Math.round(seconds));
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
}

class GameOverScene extends Phaser.Scene {
  constructor() {
    super('GameOver');
  }

  init(data) {
    data = data || {};
    this.finalScore = data.score || 0;
    this.reason = data.reason || 'GAME OVER';
    this.altitude = data.altitude || 0;
    this.newBestAltitude = !!data.newBestAltitude;
    this.bestAltitude = Math.max(data.bestAltitude || 0, this.altitude);
    this.cards = (data.cards || []).filter(id => typeof CARDS !== 'undefined' && CARDS.some(c => c.id === id));
    this.topSpeed = goNumber(data.topSpeedKmh);
    this.maxChain = goNumber(data.maxChain);
    this.seconds = goNumber(data.seconds);
    this.secondWind = !!data.secondWind;   // the run's one-time SECOND WIND rescue was used
    const zone = goNumber(data.zoneIndex);
    this.zoneIndex = zone !== undefined ? Phaser.Math.Clamp(Math.round(zone), 0, ZONES.length - 1) : undefined;
    this.progress = data.progress && typeof data.progress === 'object' ? data.progress : null;   // PROGRESS.endRun() result
  }

  create() {
    const cx = GAME_WIDTH / 2;
    const previousBest = loadHighScore();
    const isRecord = saveHighScore(this.finalScore);
    uiAddPaper(this, 0);
    uiMakeDoodles(this);
    uiScatterStars(this, [[70, 120], [640, 940], [80, 1180], [650, 1230]]);

    // A card build adds a strip under the page, so the page sits a little higher then.
    const hasBuild = this.cards.length > 0;
    const lay = goLayout(hasBuild, typeof PROGRESS !== 'undefined');
    const pageY = lay.pageY;
    const card = this.add.container(GO_CARD.x, pageY + 40).setRotation(-0.018).setAlpha(0).setScale(lay.pageScale);
    card.add(uiBoilImage(this, 0, lay.pageImageY, goCardTexture(this, lay.pageH, lay.pageImageY)));
    // The page slaps down onto the sketchbook.
    this.tweens.add({ targets: card, y: pageY, alpha: 1, duration: 260, ease: 'Back.Out' });

    const dark = UI_INK.darkHex;
    const pencil = UI_INK.pencilDarkHex;
    const top = -GO_CARD.h / 2;
    const reason = uiInkText(this, 0, top + 62, this.reason, { size: 74, color: uiColorHex(UI_CRAYON.red), stroke: '#6b1a12', strokeW: 4, rot: -0.05 });
    reason.setScale(0);
    this.tweens.add({ targets: reason, scale: 1, duration: 380, delay: 120, ease: 'Back.Out' });
    card.add(reason);
    card.add(uiInkText(this, -232, top + 150, 'score:', { size: 30, color: pencil, stroke: null, rot: -0.12, ox: 0 }));
    const scoreText = uiInkText(this, 0, top + 190, '0', { size: 112, color: dark, stroke: null, rot: -0.02 });
    card.add(scoreText);
    const counter = { value: 0 };
    this.tweens.add({
      targets: counter, value: this.finalScore, duration: Math.min(900, 300 + this.finalScore / 20), ease: 'Cubic.easeOut', delay: 150,
      onUpdate: () => scoreText.setText(String(Math.floor(counter.value))),
      onComplete: () => {
        scoreText.setText(String(this.finalScore));
        this.tweens.add({ targets: scoreText, scale: 1.1, yoyo: true, duration: 110 });
      },
    });

    if (isRecord) {
      // Red crayon loop around the score, scrawled in once the count-up lands.
      const ring = uiBoilImage(this, 0, top + 190, 'ui_circle').setTint(UI_CRAYON.red).setScale(0);
      card.add(ring);
      const label = uiInkText(this, this.topSpeed !== undefined ? -140 : 150, top + 262, 'NEW BEST!', { size: 46, color: uiColorHex(UI_CRAYON.red), stroke: null, rot: -0.08, boil: false });
      label.setAlpha(0);
      card.add(label);
      this.time.delayedCall(550, () => {
        const ringScale = Math.max(1.2, (String(this.finalScore).length * 58 + 90) / 190);
        this.tweens.add({ targets: ring, scaleX: ringScale, scaleY: 1.0, duration: 260, ease: 'Back.Out' });
        this.tweens.add({ targets: label, alpha: 1, duration: 120 });
        this.tweens.add({ targets: label, angle: { from: -10, to: -2 }, yoyo: true, repeat: -1, duration: 420, ease: 'Sine.easeInOut' });
        // A new best altitude already played the fanfare mid-run (flag pass), so a run gets at most one.
        if (!this.newBestAltitude) this.game.events.emit('sfx', 'newbest', {});
        const at = card.getWorldTransformMatrix().transformPoint(0, top + 190);
        this.starBurst(at.x, at.y);
      });
    } else {
      // Left of centre when the top speed flames rise on the right.
      card.add(uiInkText(this, this.topSpeed !== undefined ? -120 : 0, top + 262, 'best: ' + Math.max(previousBest, this.finalScore), { size: 36, color: pencil, stroke: null, rot: 0.02 }));
    }

    if (this.topSpeed !== undefined) this.showTopSpeed(card);
    this.statRows().forEach((row, i) => {
      const y = this.rowY(i);
      card.add(uiInkText(this, -228, y, row.label, { size: 30, color: pencil, stroke: null, ox: 0, rot: 0.004 * (i % 2 ? 1 : -1) }));
      card.add(uiInkText(this, 250, y - 2, row.value, { size: 36, color: row.color || dark, stroke: null, ox: 1, rot: -0.01 }));
    });
    if (this.secondWind) {
      // Pencil aside in the gap of the last stat row (between its label and value).
      const last = Math.max(0, this.statRows().length - 1);
      card.add(uiInkText(this, 22, this.rowY(last), '(second wind used)', { size: 25, color: '#2f6fa8', stroke: null, rot: -0.04, boil: false }));
    }
    // With missions on screen they are the next goals, so the page's own 'Next:' line is left out.
    if (!lay.meta) {
      const goal = uiInkText(this, 10, GO_GOAL_Y, this.nextGoal(), { size: 31, color: '#b4441a', stroke: null, rot: -0.025 });
      goal.setScale(Math.min(1, 480 / goal.width));
      card.add(goal);
    }

    const retry = () => this.scene.start('Game', { skipIntro: true });   // instant restart: no intro
    // With a card build the strip sits under the page, so the buttons shift down a little.
    makeButton(this, lay.retry.x, lay.retry.y, 'RETRY', retry, {
      width: lay.retry.w, height: lay.retry.h, fontSize: lay.retry.font, color: UI_CRAYON.yellow,
    }).setRotation(0.02);
    makeButton(this, lay.menu.x, lay.menu.y, 'MENU', () => this.scene.start('Menu'), {
      color: UI_CRAYON.blue, width: lay.menu.w, height: lay.menu.h, fontSize: lay.menu.font,
    }).setRotation(-0.025);
    if (hasBuild) this.showRunCards(lay.stripY, lay.stripScale);
    if (lay.meta) {
      this.showMissions(lay);
      this.showNewCards(card);
    }
    makeMuteButton(this, 92, 116);
    addFullscreenButton(this);
    this.input.keyboard.on('keydown-SPACE', retry);
  }

  // The run's upgrade cards on a taped strip that overlaps the page's singed bottom edge:
  // "build:" written up the margin, then each card as a mini index card with its name under it
  // (wrapped to two lines, never below ~22 game px = 11 CSS px on a 360 px phone). Each family's
  // cards sit together; a completed set gets one gold crayon loop round the group.
  // Shown at once (the strip slaps down with the page), cards stamped on one after another.
  showRunCards(y, scale) {
    const L = GO_STRIP;
    const ids = typeof cardGroupedOrder === 'function' ? cardGroupedOrder(this.cards) : this.cards;
    const n = ids.length;
    const slot = Math.min(L.maxSlot, (L.right - L.left) / n);
    const x0 = L.left + (L.right - L.left - slot * n) / 2 - GAME_WIDTH / 2;
    const sets = typeof activeSetBonuses === 'function' ? activeSetBonuses(ids) : [];
    const strip = this.add.container(GAME_WIDTH / 2, y, [uiBoilImage(this, 0, 0, goStripTexture(this))]).setRotation(0.012).setScale(scale || 1);
    const build = uiInkText(this, -GAME_WIDTH / 2 + 40, 0, 'build:', { size: 28, color: UI_INK.pencilDarkHex, stroke: null, rot: -Math.PI / 2 + 0.04, boil: false });
    strip.add(build);
    const xOf = (i) => x0 + slot / 2 + i * slot;
    for (const family of sets) {
      const members = ids.map((id, i) => (cardById(id).family === family ? i : -1)).filter(i => i >= 0);
      if (!members.length) continue;
      const a = xOf(members[0]);
      const b = xOf(members[members.length - 1]);
      const loop = uiBoilImage(this, (a + b) / 2, -2, cardSetGroupLoopTexture(this, b - a + slot - 8, L.h - 30, 0xc0861a)).setAlpha(0);
      strip.add(loop);
      this.tweens.add({ targets: loop, alpha: 1, delay: 360 + members[members.length - 1] * 90, duration: 200 });
    }
    ids.forEach((id, i) => {
      const card = cardById(id);
      const parts = [cardMakeMini(this, 0, L.cardY, id, L.cardScale)];
      const name = uiInkText(this, 0, L.labelY, goCardLabel(card.name), {
        size: L.labelSize, color: UI_INK.darkHex, stroke: null, rot: 0.02, boil: false, oy: 0, lineSpacing: -7,
      });
      name.setScale(Math.min(1, (slot - 12) / name.width));
      parts.push(name);
      const item = this.add.container(xOf(i), 0, parts).setScale(1.6).setAlpha(0);
      strip.add(item);
      this.tweens.add({
        targets: item, scale: 1, alpha: 1, delay: 300 + i * 90, duration: 180, ease: 'Quad.In',
        onComplete: () => {
          item.setScale(1.1, 0.88);
          this.tweens.add({ targets: item, scaleX: 1, scaleY: 1, duration: 180, ease: 'Back.Out' });
        },
      });
    });
    strip.setY(y + 30).setAlpha(0);
    this.tweens.add({ targets: strip, y, alpha: 1, delay: 120, duration: 240, ease: 'Back.Out' });
  }

  // Missions note under the page: this run's finished missions get crossed out in red crayon one
  // by one, each paying its coins into the purse (count-up), then slide away for the next ones.
  // Everything here is decoration on a timer: RETRY works from the first frame.
  showMissions(lay) {
    const M = GO_META;
    const res = this.progress || {};
    const active = uiProgressCall((P) => P.activeMissions(), []);
    const plan = goMissionPlan(this.progress, active);
    const totalNow = goNumber(res.coinsTotal) !== undefined ? res.coinsTotal : uiProgressCall((P) => P.coins(), 0);
    const earned = goNumber(res.coinsEarned) || 0;
    let shown = Math.max(0, totalNow - earned);
    const note = this.add.container(GAME_WIDTH / 2, lay.noteY).setRotation(0.008);
    note.add(uiBoilImage(this, 0, 0, uiNoteTexture(this, M.noteW, M.noteH, { rules: { top: 66, step: M.rowStep }, margin: 40 })));
    note.add(uiInkText(this, -M.noteW / 2 + 58, -M.noteH / 2 + 32, 'missions', {
      size: 30, color: uiColorHex(0xb4441a), stroke: null, ox: 0, rot: -0.04,
    }));
    const purse = uiCoinCounter(this, M.noteW / 2 - 150, -M.noteH / 2 + 32, shown, { size: 36 });
    note.add(purse);
    const rowY = (i) => -M.noteH / 2 + M.rowTop + i * M.rowStep;
    const rows = plan.map((p, i) => {
      const row = uiMissionRow(this, 0, rowY(i), p.mission, M.rowW, { size: 28 });
      note.add(row);
      if (p.isNew) this.markNewRow(note, row);
      return row;
    });
    if (!plan.length) note.add(uiInkText(this, 0, 10, 'all missions done. legend!', { size: 32, color: UI_INK.darkHex, stroke: null }));
    note.setY(lay.noteY + 40).setAlpha(0);
    this.tweens.add({ targets: note, y: lay.noteY, alpha: 1, delay: 160, duration: 260, ease: 'Back.Out' });

    const done = plan.map((p, i) => (p.done ? i : -1)).filter((i) => i >= 0);
    const start = 760;
    const step = 520;
    done.forEach((i, k) => {
      this.time.delayedCall(start + k * step, () => {
        rows[i].strike(300, () => {
          this.game.events.emit('sfx', 'perfect', { chain: k + 2 });
          this.payCoins(note, rows[i], purse, plan[i].mission.reward || 0, () => shown, (v) => { shown = v; });
        });
      });
    });
    if (!done.length) return;
    // Then the crossed-out lines slide off and the next missions slide in.
    this.time.delayedCall(start + done.length * step + 650, () => {
      done.forEach((i, k) => {
        const next = plan[i].replaceWith;
        if (!next) return;
        const old = rows[i];
        this.tweens.add({ targets: old, x: -GAME_WIDTH, alpha: 0, delay: k * 140, duration: 260, ease: 'Quad.In', onComplete: () => old.destroy() });
        const row = uiMissionRow(this, GAME_WIDTH, rowY(i), next, M.rowW, { size: 28 });
        note.add(row);
        this.tweens.add({
          targets: row, x: 0, delay: 200 + k * 140, duration: 300, ease: 'Back.Out',
          onComplete: () => this.markNewRow(note, row),
        });
      });
      this.game.events.emit('sfx', 'pageturn', {});
      // Settle the purse on the saved total in case a tween was cut short.
      this.time.delayedCall(700, () => { if (purse.active) purse.setValue(totalNow); });
    });
  }

  // A coin hops from the mission's reward to the purse, which counts up and punches.
  payCoins(note, row, purse, amount, getShown, setShown) {
    const coin = uiBoilImage(this, row.x + GO_META.rowW / 2 - 14, row.y, uiCoinTexture(this)).setScale(0.6);
    note.add(coin);
    this.tweens.add({
      targets: coin, x: purse.x, y: purse.y, scale: 0.9, duration: 360, ease: 'Cubic.easeIn',
      onComplete: () => {
        coin.destroy();
        const from = getShown();
        const to = from + amount;
        setShown(to);
        const c = { v: from };
        this.tweens.add({ targets: c, v: to, duration: 380, onUpdate: () => purse.setValue(Math.floor(c.v)), onComplete: () => purse.setValue(to) });
        purse.setScale(1.3);
        this.tweens.add({ targets: purse, scale: 1, duration: 260, ease: 'Back.Out' });
      },
    });
  }

  // A small red crayon asterisk in the margin marks a mission that just arrived.
  markNewRow(note, row) {
    if (!row.active) return;
    const star = uiBoilImage(this, -GO_META.noteW / 2 + 18, row.y, 'ui_star').setTint(UI_CRAYON.red).setScale(0);
    note.add(star);
    this.tweens.add({ targets: star, scale: 0.75, duration: 200, ease: 'Back.Out' });
    row.setScale(1.06);
    this.tweens.add({ targets: row, scale: 1, duration: 220, ease: 'Back.Out' });
  }

  // Cards seen for the first time this run: a yellow sticky note slapped on the page's corner.
  showNewCards(card) {
    const ids = ((this.progress && this.progress.newlyDiscovered) || []).filter((id) => typeof cardById === 'function' && cardById(id));
    if (!ids.length) return;
    const W = GO_NEWCARD.w;
    const H = GO_NEWCARD.h;
    const sticky = this.add.container(GO_NEWCARD.x, GO_NEWCARD.y).setRotation(0.09);
    sticky.add(uiBoilImage(this, 0, 0, uiNoteTexture(this, W, H, { paper: 0xf3dc7a, tape: 'top' })));
    const header = uiInkText(this, 0, -H / 2 + 26, ids.length > 1 ? ids.length + ' NEW CARDS!' : 'NEW CARD FOUND!', {
      size: 25, color: uiColorHex(UI_CRAYON.red), stroke: null, rot: -0.04,
    });
    header.setScale(Math.min(1, (W - 16) / header.width));
    sticky.add(header);
    if (ids.length === 1) {
      const c = cardById(ids[0]);
      sticky.add(cardMakeMini(this, -52, 18, c.id, 0.56));
      const name = uiInkText(this, -22, 18, c.name.split(' ').join('\n'), { size: 25, color: UI_INK.darkHex, stroke: null, ox: 0, rot: 0.02, lineSpacing: -6 });
      name.setScale(Math.min(1, 100 / name.width));
      sticky.add(name);
    } else {
      const shown = ids.slice(0, 3);
      shown.forEach((id, i) => sticky.add(cardMakeMini(this, (i - (shown.length - 1) / 2) * 44 - (ids.length > 3 ? 12 : 0), 18, id, 0.52)));
      if (ids.length > shown.length) sticky.add(uiInkText(this, W / 2 - 20, 22, '+' + (ids.length - shown.length), { size: 24, color: UI_INK.darkHex, stroke: null }));
    }
    card.add(sticky);
    sticky.setScale(1.6).setAlpha(0);
    this.tweens.add({
      targets: sticky, scale: 1, alpha: 1, delay: 950, duration: 200, ease: 'Quad.In',
      onStart: () => this.game.events.emit('sfx', 'cardopen', {}),
      onComplete: () => {
        sticky.setScale(1.08, 0.9);
        this.tweens.add({ targets: sticky, scaleX: 1, scaleY: 1, duration: 200, ease: 'Back.Out' });
      },
    });
  }

  // Stat row y on the card: under the top speed headline, or one line higher without it.
  rowY(i) {
    return GO_ROWS.top + (i + (this.topSpeed !== undefined ? 0 : -1)) * GO_ROWS.step;
  }

  // "top speed" in pencil, then the number big in hot crayon with flame licks doodled off its top
  // and dashed speed lines trailing it. It counts up with the score, then punches.
  showTopSpeed(card) {
    const H = GO_HEAD;
    const kms = Math.max(0, Math.round(this.topSpeed));
    card.add(uiInkText(this, H.labelX, H.y - 8, 'top speed', { size: 32, color: UI_INK.pencilDarkHex, stroke: null, ox: 0, rot: -0.05 }));
    const flames = this.add.graphics();
    card.add(flames);
    const num = uiInkText(this, H.numX, H.y, '0', { size: H.numSize, color: '#d2501c', stroke: '#4a1606', strokeW: 4, ox: 1, rot: -0.04 });
    const unit = uiInkText(this, H.numX + 12, H.y + 18, 'km/s', { size: H.unitSize, color: '#8a3412', stroke: null, ox: 0, rot: -0.02 });
    card.add([num, unit]);
    // Hotter flames for faster runs: 0 at 100 km/s, full at 600 km/s.
    const heat = Phaser.Math.Clamp((kms - 100) / 500, 0.25, 1);
    const draw = (tick) => {
      flames.clear();
      const w = Math.max(80, num.width * num.scaleX);
      const seed = tick % 3;
      const baseY = H.y - num.height * 0.26;
      const n = 3 + Math.round(heat * 3);
      for (let i = 0; i < n; i++) {
        const u = n === 1 ? 0.5 : i / (n - 1);
        const x = H.numX - w * 0.9 + w * 0.8 * u;
        const h = (26 + heat * 44) * (0.65 + 0.35 * Math.sin(Math.PI * u)) * (0.85 + uiNoise(i * 5 + seed, 2) * 0.3);
        inkFlameLick(flames, x, baseY, h, 22 + heat * 12, -0.4, i * 29 + seed * 7, {
          color: i % 2 ? UI_CRAYON.red : 0xc0561a, fill: i % 2 ? UI_CRAYON.orange : UI_CRAYON.yellow, width: 4, alpha: 0.95,
        });
      }
      // Speed dashes trailing the number to the left.
      for (let i = 0; i < 3; i++) {
        const y = H.y - 20 + i * 20;
        const x1 = H.numX - w - 16 - (i % 2) * 12;
        uiScribbleLine(flames, x1 - 50 - heat * 20, y + 2, x1, y, seed * 11 + i, { width: 4 + heat * 2, color: UI_INK.dark, amp: 1.2, passes: 1 });
      }
    };
    draw(0);
    uiOnBoil(this, (v, tick) => { if (flames.active) draw(tick); });
    const counter = { value: 0 };
    this.tweens.add({
      targets: counter, value: kms, duration: 650, ease: 'Cubic.easeOut', delay: 250,
      onUpdate: () => num.setText(String(Math.floor(counter.value))),
      onComplete: () => {
        num.setText(String(kms));
        num.setScale(1.25);
        this.tweens.add({ targets: num, scale: 1, duration: 260, ease: 'Back.Out' });
      },
    });
  }

  // Handwritten list on the page's rule lines; rows without data are left out.
  statRows() {
    const rows = [];
    rows.push({
      label: 'altitude',
      value: this.altitude + ' m' + (this.newBestAltitude ? '  best!' : ''),
      color: this.newBestAltitude ? '#2f7d32' : undefined,
    });
    // Top speed is not a row: it is the page's headline (showTopSpeed).
    // 'combo N' as in the HUD: the 'x' only ever means the score multiplier.
    if (this.maxChain !== undefined) rows.push({ label: 'best combo', value: this.maxChain >= 1 ? this.maxChain + ' perfect' : '-' });
    if (this.zoneIndex !== undefined) rows.push({ label: 'reached', value: ZONES[this.zoneIndex].name });
    if (this.seconds !== undefined) rows.push({ label: 'time', value: goFormatTime(this.seconds) });
    return rows;
  }

  // The nearest meaningful target: the previous best altitude if it comes before the next zone,
  // else the next zone; at the last zone, the altitude record.
  nextGoal() {
    const zone = this.zoneIndex !== undefined ? this.zoneIndex : zoneIndexForAltitude(this.altitude);
    const best = this.bestAltitude;
    const next = ZONES[zone + 1];
    if (next) {
      if (!this.newBestAltitude && best > this.altitude && best < next.from) return 'Next: beat ' + best + ' m';
      return 'Next: reach ' + next.name + ' (' + next.from + ' m)';
    }
    if (this.newBestAltitude || best <= this.altitude) return 'Next: fly past ' + this.altitude + ' m';
    return 'Next: beat ' + best + ' m';
  }

  // Hand-drawn asterisks thrown out of the circled score.
  starBurst(x, y) {
    const tints = [UI_CRAYON.yellow, UI_CRAYON.red, UI_CRAYON.orange, UI_CRAYON.green, UI_INK.cream];
    for (let i = 0; i < 12; i++) {
      const star = uiBoilImage(this, x, y, 'ui_star').setTint(tints[i % tints.length]).setScale(0.7 + (i % 3) * 0.3);
      const a = (i / 12) * UI_TAU + Math.random() * 0.4;
      const d = Phaser.Math.Between(170, 300);
      this.tweens.add({
        targets: star, x: x + Math.cos(a) * d, y: y + Math.sin(a) * d * 0.7, angle: Phaser.Math.Between(-200, 200),
        alpha: 0, duration: Phaser.Math.Between(650, 1000), ease: 'Cubic.easeOut', onComplete: () => star.destroy(),
      });
    }
  }
}

// Notebook page: binder holes, red margin, blue rule lines, tape on both top corners, and a
// torn bottom edge singed orange/red by the supernova.
// pageH / yOff: page height and its center in card-local y (the compact meta page is shorter at
// the bottom); the rule lines stay on the stat rows either way.
function goCardTexture(scene, pageH, yOff) {
  const { w, pad } = GO_CARD;
  const h = pageH || GO_CARD.h;
  const off = yOff || 0;
  const W = w + pad * 2;
  const H = h + pad * 2;
  return uiSketchTexture(scene, h === GO_CARD.h && !off ? 'go_card' : 'go_card_' + h + '_' + off, W, H, (ctx, shape, jitter) => {
    const page = [];
    page.push({ x: pad + (shape() - 0.5) * 4, y: pad + (shape() - 0.5) * 4 });
    page.push({ x: pad + w + (shape() - 0.5) * 4, y: pad + (shape() - 0.5) * 4 });
    // Torn bottom: irregular zigzag from right to left.
    for (let x = pad + w; x >= pad; x -= 14 + shape() * 14) {
      page.push({ x: x + (jitter() - 0.5) * 2, y: pad + h - 10 + shape() * 20 + (jitter() - 0.5) * 2 });
    }
    page.push({ x: pad + (shape() - 0.5) * 4, y: pad + h });
    // Shadow, then the page.
    uiTracePath(ctx, page.map((p) => ({ x: p.x + 9, y: p.y + 13 })), true);
    ctx.fillStyle = 'rgba(5,6,16,0.45)';
    ctx.fill();
    uiTracePath(ctx, page, true);
    ctx.fillStyle = uiCss(UI_CRAYON.note);
    ctx.fill();
    ctx.save();
    uiTracePath(ctx, page, true);
    ctx.clip();
    // Paper fibers.
    for (let i = 0; i < 160; i++) {
      const x = pad + shape() * w;
      const y = pad + shape() * h;
      const a = shape() * UI_TAU;
      ctx.strokeStyle = 'rgba(120,95,50,' + (0.06 + shape() * 0.08) + ')';
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + Math.cos(a) * (6 + shape() * 18), y + Math.sin(a) * (6 + shape() * 18));
      ctx.stroke();
    }
    // Rule lines line up with the stat rows (card-local y = GO_ROWS.top + k * step + 24).
    const toTex = (localY) => localY - off + h / 2 + pad;
    ctx.lineWidth = 2;
    for (let k = -5; k <= 4; k++) {
      const y = toTex(GO_ROWS.top + k * GO_ROWS.step + 24);
      if (y < pad + 4 || y > pad + h - 30) continue;
      ctx.strokeStyle = 'rgba(90,135,200,0.42)';
      ctx.beginPath();
      ctx.moveTo(pad, y + (shape() - 0.5) * 2);
      ctx.lineTo(pad + w, y + (shape() - 0.5) * 2);
      ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(214,70,70,0.5)';
    ctx.beginPath();
    ctx.moveTo(pad + 66, pad);
    ctx.lineTo(pad + 68, pad + h);
    ctx.stroke();
    // Singed bottom: crayon scorch hatching along the torn edge.
    const scorch = [{ x: pad - 10, y: pad + h - 44 }, { x: pad + w + 10, y: pad + h - 58 }, { x: pad + w + 10, y: H }, { x: pad - 10, y: H }];
    uiHatch(ctx, scorch, jitter, { color: UI_CRAYON.orange, spacing: 6, width: 4, alpha: 0.75, angle: -1.2, grow: 1, offX: 0, offY: 0, gaps: 0.25 });
    const char = [{ x: pad - 10, y: pad + h - 20 }, { x: pad + w + 10, y: pad + h - 26 }, { x: pad + w + 10, y: H }, { x: pad - 10, y: H }];
    uiHatch(ctx, char, jitter, { color: UI_CRAYON.red, spacing: 5, width: 4, alpha: 0.85, angle: -0.7, grow: 1, offX: 0, offY: 0 });
    ctx.restore();
    // Binder holes show the paper underneath.
    for (const hy of [0.18, 0.5, 0.82]) {
      const hole = uiLoop(pad + 30, pad + h * hy, 11, 11, shape, jitter, { n: 10, amp: 0.4 });
      uiTracePath(ctx, hole, true);
      ctx.fillStyle = uiCss(UI_PAPERS[0].paper);
      ctx.fill();
    }
    // Tape strips (translucent, jagged ends) holding the top corners.
    for (const [tx, rot] of [[pad + 18, -0.6], [pad + w - 18, 0.55]]) {
      ctx.save();
      ctx.translate(tx, pad + 6);
      ctx.rotate(rot);
      // Torn ends: the right end runs down, the left end back up, each with a few teeth.
      const tape = [];
      for (let i = 0; i <= 4; i++) tape.push({ x: 56 + (i % 2 ? 5 : 0) + (shape() - 0.5) * 3, y: -17 + i * 8.5 });
      for (let i = 4; i >= 0; i--) tape.push({ x: -56 - (i % 2 ? 5 : 0) + (shape() - 0.5) * 3, y: -17 + i * 8.5 });
      uiTracePath(ctx, tape, true);
      ctx.fillStyle = 'rgba(240,232,190,0.55)';
      ctx.fill();
      ctx.restore();
    }
  });
}

// Long torn strip of notebook paper with tape at both ends, for the card build.
function goStripTexture(scene) {
  const W = GAME_WIDTH - 20;
  const H = GO_STRIP.h;
  return uiSketchTexture(scene, 'go_strip', W, H, (ctx, shape, jitter) => {
    const top = 16;
    const bottom = H - 18;
    const page = [];
    for (let x = 22; x <= W - 22; x += 22 + shape() * 18) page.push({ x, y: top + (shape() - 0.5) * 5 });
    page.push({ x: W - 22, y: top });
    for (let x = W - 22; x >= 22; x -= 12 + shape() * 12) page.push({ x: x + (jitter() - 0.5) * 2, y: bottom - 4 + shape() * 9 });
    page.push({ x: 22, y: bottom });
    uiTracePath(ctx, page.map((p) => ({ x: p.x + 6, y: p.y + 9 })), true);
    ctx.fillStyle = 'rgba(5,6,16,0.45)';
    ctx.fill();
    uiTracePath(ctx, page, true);
    ctx.fillStyle = uiCss(UI_CRAYON.note);
    ctx.fill();
    ctx.save();
    uiTracePath(ctx, page, true);
    ctx.clip();
    ctx.strokeStyle = 'rgba(90,135,200,0.32)';
    ctx.lineWidth = 2;
    for (const ly of [56, 100, 140]) {
      ctx.beginPath();
      ctx.moveTo(0, ly + (shape() - 0.5) * 2);
      ctx.lineTo(W, ly + (shape() - 0.5) * 3);
      ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(214,70,70,0.45)';
    ctx.beginPath();
    ctx.moveTo(58, 0);
    ctx.lineTo(60, H);
    ctx.stroke();
    ctx.restore();
    for (const [tx, rot] of [[34, -0.5], [W - 34, 0.45]]) {
      ctx.save();
      ctx.translate(tx, top + 4);
      ctx.rotate(rot);
      ctx.fillStyle = 'rgba(240,232,190,0.55)';
      ctx.fillRect(-36, -11, 72, 22);
      ctx.restore();
    }
  });
}
