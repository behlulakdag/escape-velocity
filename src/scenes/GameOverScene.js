// Game over: a torn notebook page taped onto the sketchbook, its bottom edge singed by the
// supernova. Score, NEW BEST circled in red crayon, a handwritten stats list and the next goal.
// GameScene passes score, altitude, reason, newBestAltitude, bestAltitude and (optional)
// topSpeedKmh, maxChain, zoneIndex, seconds; a missing optional stat simply drops its row.
const GO_CARD = { w: 600, h: 700, pad: 34, x: GAME_WIDTH / 2, y: 548, rowTop: -22, rowStep: 54 };

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
    const zone = goNumber(data.zoneIndex);
    this.zoneIndex = zone !== undefined ? Phaser.Math.Clamp(Math.round(zone), 0, ZONES.length - 1) : undefined;
  }

  create() {
    const cx = GAME_WIDTH / 2;
    const previousBest = loadHighScore();
    const isRecord = saveHighScore(this.finalScore);
    uiAddPaper(this, 0);
    uiMakeDoodles(this);
    uiScatterStars(this, [[70, 120], [640, 940], [80, 1180], [650, 1230]]);

    // A card build adds a strip under the page, so the page sits a little higher then.
    const pageY = this.cards.length ? GO_CARD.y - 22 : GO_CARD.y;
    const card = this.add.container(GO_CARD.x, pageY + 40).setRotation(-0.018).setAlpha(0);
    card.add(uiBoilImage(this, 0, 0, goCardTexture(this)));
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
      const label = uiInkText(this, 150, top + 262, 'NEW BEST!', { size: 46, color: uiColorHex(UI_CRAYON.red), stroke: null, rot: -0.08, boil: false });
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
      card.add(uiInkText(this, 0, top + 262, 'best: ' + Math.max(previousBest, this.finalScore), { size: 36, color: pencil, stroke: null, rot: 0.02 }));
    }

    this.statRows().forEach((row, i) => {
      const y = GO_CARD.rowTop + i * GO_CARD.rowStep;
      card.add(uiInkText(this, -228, y, row.label, { size: 30, color: pencil, stroke: null, ox: 0, rot: 0.004 * (i % 2 ? 1 : -1) }));
      card.add(uiInkText(this, 250, y - 2, row.value, { size: 36, color: row.color || dark, stroke: null, ox: 1, rot: -0.01 }));
    });
    const goal = uiInkText(this, 10, GO_CARD.rowTop + 5 * GO_CARD.rowStep + 18, this.nextGoal(), { size: 31, color: '#b4441a', stroke: null, rot: -0.025 });
    goal.setScale(Math.min(1, 480 / goal.width));
    card.add(goal);

    const retry = () => this.scene.start('Game', { skipIntro: true });   // instant restart: no intro
    // With a card build the strip sits under the page, so the buttons shift down a little.
    const hasBuild = this.cards.length > 0;
    makeButton(this, cx, hasBuild ? 1058 : 1002, 'RETRY', retry, {
      width: 460, height: hasBuild ? 128 : 140, fontSize: '72px', color: UI_CRAYON.yellow,
    }).setRotation(0.02);
    makeButton(this, cx, hasBuild ? 1180 : 1145, 'MENU', () => this.scene.start('Menu'), {
      color: UI_CRAYON.blue, width: 320, height: 100, fontSize: '48px',
    }).setRotation(-0.025);
    if (hasBuild) this.showRunCards(930);
    makeMuteButton(this, 92, 116);
    addFullscreenButton(this);
    this.input.keyboard.on('keydown-SPACE', retry);
  }

  // The run's upgrade cards on a taped strip under the page: "build:" then each card as a mini
  // index card with its name scribbled under it. Set-bonus families get a gold crayon loop.
  // Shown at once (the strip slaps down with the page), cards stamped on one after another.
  showRunCards(y) {
    const n = this.cards.length;
    const left = 150;
    const slot = Math.min(118, (GAME_WIDTH - left - 40) / n);
    const sets = typeof activeSetBonuses === 'function' ? activeSetBonuses(this.cards) : [];
    const strip = this.add.container(GAME_WIDTH / 2, y, [uiBoilImage(this, 0, 0, goStripTexture(this))]).setRotation(0.012);
    strip.add(uiInkText(this, -GAME_WIDTH / 2 + 46, -6, 'build:', { size: 30, color: UI_INK.pencilDarkHex, stroke: null, ox: 0, rot: -0.08 }));
    this.cards.forEach((id, i) => {
      const card = cardById(id);
      const x = -GAME_WIDTH / 2 + left + slot / 2 + i * slot;
      const parts = [];
      if (sets.indexOf(card.family) >= 0) parts.push(uiBoilImage(this, 0, -12, cardSetLoopTexture(this)));
      parts.push(cardMakeMini(this, 0, -12, id, 0.82));
      const name = uiInkText(this, 0, 36, card.name, { size: 19, color: UI_INK.darkHex, stroke: null, rot: 0.02, boil: false });
      name.setScale(Math.min(1, (slot - 6) / name.width));
      parts.push(name);
      const item = this.add.container(x, 0, parts).setScale(1.6).setAlpha(0);
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

  // Handwritten list on the page's rule lines; rows without data are left out.
  statRows() {
    const rows = [];
    rows.push({
      label: 'altitude',
      value: this.altitude + ' m' + (this.newBestAltitude ? '  best!' : ''),
      color: this.newBestAltitude ? '#2f7d32' : undefined,
    });
    if (this.topSpeed !== undefined) rows.push({ label: 'top speed', value: Math.round(this.topSpeed) + ' km/s' });
    if (this.maxChain !== undefined) rows.push({ label: 'longest chain', value: this.maxChain >= 2 ? 'x' + this.maxChain + ' perfect' : '-' });
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
function goCardTexture(scene) {
  const { w, h, pad } = GO_CARD;
  const W = w + pad * 2;
  const H = h + pad * 2;
  return uiSketchTexture(scene, 'go_card', W, H, (ctx, shape, jitter) => {
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
    // Rule lines line up with the stat rows (card-local y = rowTop + k*rowStep + 24).
    const toTex = (localY) => localY + h / 2 + pad;
    ctx.lineWidth = 2;
    for (let k = -4; k <= 6; k++) {
      const y = toTex(GO_CARD.rowTop + k * GO_CARD.rowStep + 24);
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
  const H = 128;
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
    for (const ly of [46, 86]) {
      ctx.beginPath();
      ctx.moveTo(0, ly + (shape() - 0.5) * 2);
      ctx.lineTo(W, ly + (shape() - 0.5) * 3);
      ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(214,70,70,0.45)';
    ctx.beginPath();
    ctx.moveTo(126, 0);
    ctx.lineTo(128, H);
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
