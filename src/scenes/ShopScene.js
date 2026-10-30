// Comet skin shop: a sketchbook page with every skin drawn on a taped scrap of dark paper.
// Tap a scrap to try it on in the big live preview, then one big button BUYs (and wears) it,
// EQUIPs an owned one, or says how many coins are still missing. Coins come from missions.
// All data goes through PROGRESS (src/progress.js); the comets are drawn by ART.drawComet with
// ctx.skin = the skin's crayon colors, exactly like in the game.
const SHOP_LAYOUT = {
  backX: 150, topY: 116, titleY: 220, coinsY: 292,
  previewY: 450, previewW: 620, previewH: 230,
  tileW: 160, tileH: 196, cols: 4, gridTop: 690, rowStep: 214, gridGap: 8,
  actionY: 1104, actionW: 460, actionH: 124, hintY: 1196,
};

// Tile centers for n skins: rows of `cols`, a shorter last row centered.
function shopTilePositions(n, L) {
  L = L || SHOP_LAYOUT;
  const out = [];
  const step = L.tileW + L.gridGap;
  for (let i = 0; i < n; i++) {
    const row = Math.floor(i / L.cols);
    const inRow = Math.min(L.cols, n - row * L.cols);
    const col = i - row * L.cols;
    out.push({ x: GAME_WIDTH / 2 + (col - (inRow - 1) / 2) * step, y: L.gridTop + row * L.rowStep });
  }
  return out;
}

// A short comet path for a still pose: head at (x, y) flying along angle a, tail curving behind.
function shopPoseTrail(x, y, a, n, step, bend) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const back = a + Math.PI + bend * i * 0.06;
    const prev = pts[i - 1] || { x, y };
    pts.push(i === 0 ? { x, y } : { x: prev.x + Math.cos(back) * step, y: prev.y + Math.sin(back) * step });
  }
  return pts;
}

class ShopScene extends Phaser.Scene {
  constructor() {
    super('Shop');
  }

  create() {
    const L = SHOP_LAYOUT;
    const cx = GAME_WIDTH / 2;
    if (typeof ART !== 'undefined' && ART.setPage) ART.setPage(0);
    uiAddPaper(this, 0);
    uiMakeDoodles(this);
    uiScatterStars(this, [[640, 230], [80, 300], [670, 1180], [50, 1220]]);
    uiCoinTexture(this);

    makeButton(this, L.backX, L.topY, 'BACK', () => this.scene.start('Menu'), {
      width: 200, height: 100, fontSize: '44px', color: UI_CRAYON.blue,
    }).setRotation(-0.03);
    addFullscreenButton(this);
    this.input.keyboard.on('keydown-ESC', () => this.scene.start('Menu'));

    uiTitleText(this, cx, L.titleY, 'COMET SHOP', { size: 76, rot: -0.025, shadowColor: uiColorHex(UI_CRAYON.green) });
    this.coinCounter = uiCoinCounter(this, cx - 50, L.coinsY, 0, { size: 44, color: uiColorHex(UI_CRAYON.yellow), stroke: UI_INK.darkHex });

    this.skins = this.readSkins();
    const worn = this.skins.find((s) => s.equipped) || this.skins[0];
    this.selectedId = worn ? worn.id : null;

    this.buildPreview();
    this.tiles = [];
    const spots = shopTilePositions(this.skins.length);
    this.skins.forEach((skin, i) => this.tiles.push(this.buildTile(skin, spots[i].x, spots[i].y, i)));
    this.selectRing = uiBoilImage(this, 0, 0, 'ui_circle').setTint(UI_CRAYON.red).setScale(0.92, 1.62).setRotation(0.05).setDepth(5);

    this.action = makeButton(this, cx, L.actionY, 'EQUIP', () => this.onAction(), {
      width: L.actionW, height: L.actionH, fontSize: '56px', color: UI_CRAYON.yellow,
    }).setRotation(0.015);
    this.hint = uiInkText(this, cx, L.hintY, 'earn coins by finishing missions', { size: 28, color: UI_INK.pencilHex, stroke: null, rot: -0.02 });
    this.refresh();
  }

  readSkins() {
    return uiProgressCall((P) => P.skins(), []).filter((s) => s && s.id);
  }

  selected() {
    return this.skins.find((s) => s.id === this.selectedId) || this.skins[0];
  }

  // Big framed live preview: the selected skin looping a figure eight, its name and status beside it.
  buildPreview() {
    const L = SHOP_LAYOUT;
    const frame = this.add.container(GAME_WIDTH / 2, L.previewY).setRotation(-0.012);
    frame.add(uiBoilImage(this, 0, 0, uiNoteTexture(this, L.previewW, L.previewH, { paper: 0x121a33, tape: 'corners' })));
    this.previewGfx = this.add.graphics();
    const stage = this.add.container(-150, 4, [this.previewGfx]).setScale(1.05);
    frame.add(stage);
    this.previewName = uiInkText(this, 150, -40, '', { size: 60, color: UI_INK.creamHex, rot: -0.03 });
    this.previewStatus = uiInkText(this, 150, 34, '', { size: 32, color: UI_INK.pencilHex, stroke: null, rot: 0.02 });
    this.previewCoin = uiBoilImage(this, 0, 34, uiCoinTexture(this)).setScale(0.75);
    frame.add([this.previewName, this.previewStatus, this.previewCoin]);
    this.previewTrail = [];
    this.previewT = 0;
  }

  // One skin: a taped scrap of dark paper with the comet drawn on it, the name and the price.
  buildTile(skin, x, y, i) {
    const L = SHOP_LAYOUT;
    const tile = this.add.container(x, y).setRotation(((uiHash(skin.id) % 100) / 100 - 0.5) * 0.08);
    tile.add(uiBoilImage(this, 0, 0, uiNoteTexture(this, L.tileW, L.tileH, { paper: 0x18213d, tape: 'top' })));
    const gfx = this.add.graphics();
    tile.add(this.add.container(4, -6, [gfx]).setScale(0.72));
    const name = uiInkText(this, 0, -L.tileH / 2 + 30, skin.name, { size: 30, color: UI_INK.creamHex, rot: -0.03 });
    name.setScale(Math.min(1, (L.tileW - 20) / name.width));
    const price = uiInkText(this, 12, L.tileH / 2 - 32, '', { size: 30, color: uiColorHex(UI_CRAYON.yellow), rot: 0.02 });
    const coin = uiBoilImage(this, -40, L.tileH / 2 - 32, uiCoinTexture(this)).setScale(0.6);
    const tick = this.add.graphics();
    tile.add([name, price, coin, tick]);
    tile.setSize(L.tileW + 10, L.tileH + 10);
    tile.setInteractive({ useHandCursor: true });
    tile.on('pointerdown', () => tile.setScale(1.04, 0.94));
    tile.on('pointerout', () => tile.setScale(1));
    tile.on('pointerup', () => {
      tile.setScale(1);
      this.game.events.emit('sfx', 'click', {});
      this.selectedId = skin.id;
      this.previewTrail = [];
      this.refresh();
    });
    // Tiles drop in one after another.
    tile.setAlpha(0).setY(y + 26);
    this.tweens.add({ targets: tile, y, alpha: 1, delay: 120 + i * 50, duration: 220, ease: 'Back.Out' });
    // A pose that differs a little per skin so the row does not look stamped.
    const pose = shopPoseTrail(26, -6, -0.55 + (i % 3) * 0.12, 13, 7, 1 + (i % 2));
    const draw = () => {
      gfx.clear();
      this.drawSkinComet(gfx, skin, { x: pose[0].x, y: pose[0].y, vx: Math.cos(-0.55), vy: Math.sin(-0.55) }, pose, 0.35);
    };
    draw();
    uiOnBoil(this, () => { if (gfx.active) draw(); });
    return { skin, tile, price, coin, tick };
  }

  // ART.drawComet with the skin's colors on ctx (the same path the game uses).
  drawSkinComet(g, skin, comet, trail, speedFraction) {
    if (typeof ART === 'undefined' || !ART.drawComet) return;
    try {
      ART.drawComet(g, comet, trail, {
        time: this.time.now / 1000, speedFraction, momentum: 0, skin: skin.colors, skinId: skin.id, skinDetail: skin.detail,
      });
    } catch (e) { /* a broken skin must never take the shop down */ }
  }

  // Re-reads PROGRESS and redraws every state: prices, ticks, selection ring, preview, button.
  refresh() {
    this.skins = this.readSkins();
    const coins = uiProgressCall((P) => P.coins(), 0);
    this.coinCounter.setValue(coins);
    for (const t of this.tiles) {
      const skin = this.skins.find((s) => s.id === t.skin.id) || t.skin;
      t.skin = skin;
      t.tick.clear();
      if (skin.equipped) {
        t.price.setText('on').setColor(uiColorHex(UI_CRAYON.green)).setX(-14);
        t.coin.setVisible(false);
        // Green crayon tick in the scrap's corner: this is the one you wear.
        const seed = 5;
        uiScribbleLine(t.tick, 26, 62, 38, 76, seed, { width: 7, color: UI_CRAYON.green, amp: 1, passes: 1 });
        uiScribbleLine(t.tick, 38, 76, 64, 40, seed + 1, { width: 7, color: UI_CRAYON.green, amp: 1, passes: 1 });
      } else if (skin.owned) {
        t.price.setText('owned').setColor(UI_INK.pencilHex).setX(0);
        t.coin.setVisible(false);
      } else {
        const affordable = coins >= skin.price;
        t.price.setText(String(skin.price)).setColor(affordable ? uiColorHex(UI_CRAYON.yellow) : UI_INK.pencilDarkHex).setX(14);
        t.coin.setVisible(true).setAlpha(affordable ? 1 : 0.55);
      }
    }
    const sel = this.selected();
    const selTile = this.tiles.find((t) => sel && t.skin.id === sel.id);
    if (selTile) this.selectRing.setPosition(selTile.tile.x, selTile.tile.y).setVisible(true);
    else this.selectRing.setVisible(false);
    if (!sel) return;
    this.previewName.setText(sel.name);
    const act = uiShopAction(sel, coins);
    let status = 'wearing it';
    if (act.kind === 'equip') status = 'owned';
    if (act.kind === 'buy' || act.kind === 'short') status = String(sel.price);
    this.previewStatus.setText(status).setColor(act.kind === 'short' ? uiColorHex(UI_CRAYON.red) : (act.kind === 'buy' ? uiColorHex(UI_CRAYON.yellow) : UI_INK.pencilHex));
    const priced = act.kind === 'buy' || act.kind === 'short';
    this.previewCoin.setVisible(priced);
    this.previewStatus.setX(priced ? 172 : 150);
    if (priced) this.previewCoin.setX(172 - this.previewStatus.width / 2 - 26);
    this.setActionButton(act);
  }

  setActionButton(act) {
    const fill = this.action.list[0];
    const label = this.action.list[2];
    const colors = { buy: UI_CRAYON.yellow, equip: UI_CRAYON.green, equipped: 0x9a94ad, short: 0x9a94ad };
    fill.setTint(colors[act.kind]);
    label.setText(act.label);
    label.setScale(Math.min(1, (SHOP_LAYOUT.actionW - 40) / label.width));
    label.setColor(act.kind === 'short' || act.kind === 'equipped' ? '#3b3850' : UI_INK.darkHex);
    this.actionKind = act.kind;
  }

  onAction() {
    const sel = this.selected();
    if (!sel) return;
    if (this.actionKind === 'buy') {
      const bought = uiProgressCall((P) => P.buySkin(sel.id), false);
      if (!bought) { this.refresh(); return; }
      uiProgressCall((P) => P.equipSkin(sel.id), false);
      this.game.events.emit('sfx', 'cardpick', {});
      this.celebrate(sel.id);
      this.refresh();
      // Coins drop: the counter punches.
      this.coinCounter.setScale(1.3);
      this.tweens.add({ targets: this.coinCounter, scale: 1, duration: 260, ease: 'Back.Out' });
    } else if (this.actionKind === 'equip') {
      uiProgressCall((P) => P.equipSkin(sel.id), false);
      this.game.events.emit('sfx', 'cardpick', {});
      this.celebrate(sel.id);
      this.refresh();
    } else if (this.actionKind === 'short') {
      // Not enough coins: the price shakes its head.
      this.tweens.add({ targets: this.previewStatus, x: this.previewStatus.x + 10, yoyo: true, repeat: 3, duration: 50 });
      this.tweens.add({ targets: this.hint, scale: 1.12, yoyo: true, duration: 140 });
    }
  }

  celebrate(id) {
    const t = this.tiles.find((x) => x.skin.id === id);
    if (!t) return;
    if (typeof cardDoodleBurst === 'function') cardDoodleBurst(this, t.tile.x, t.tile.y, [UI_CRAYON.yellow, UI_CRAYON.orange, UI_INK.cream, UI_CRAYON.green], { count: 12, reach: 160 });
    t.tile.setScale(1.12, 0.9);
    this.tweens.add({ targets: t.tile, scaleX: 1, scaleY: 1, duration: 260, ease: 'Back.Out' });
  }

  update(time, delta) {
    const sel = this.selected();
    if (!sel || !this.previewGfx) return;
    // Figure-eight loop inside the frame; the tail is the comet's real recent path.
    this.previewT += delta / 1000;
    const k = this.previewT * 1.7;
    const x = Math.sin(k) * 120;
    const y = Math.sin(k * 2) * 46;
    this.previewTrail.unshift({ x, y });
    if (this.previewTrail.length > 22) this.previewTrail.length = 22;
    const vx = Math.cos(k) * 120;
    const vy = Math.cos(k * 2) * 92;
    this.previewGfx.clear();
    this.drawSkinComet(this.previewGfx, sel, { x, y, vx, vy }, this.previewTrail, 0.55);
  }
}
