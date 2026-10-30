// Card discovery journal: the 12 upgrade cards as index cards taped into the sketchbook, one
// row per family (common, rare, legendary). A card the game has ever offered you is drawn in
// full; the rest are pencil '?' sketches. Tap a found card to hold it up close. Discoveries come
// from PROGRESS.discovered(); every card stays available in play either way.
const JOURNAL_LAYOUT = {
  backX: 150, topY: 116, titleY: 214, countY: 284,
  cardW: 206, cardH: 160, colStep: 222, rowTop: 404, rowStep: 172,
  noteY: 1118, noteW: 640, noteH: 206,
};
const JOURNAL_FAMILY_ORDER = ['orbit', 'fling', 'flight', 'shield'];
const JOURNAL_RARITY_ORDER = ['common', 'rare', 'legendary'];
const JOURNAL_RARITY_STARS = { common: 1, rare: 2, legendary: 3 };

// Cards in journal order (family rows, rarity columns) with their grid slot.
function journalSlots(cards) {
  const out = [];
  JOURNAL_FAMILY_ORDER.forEach((family, row) => {
    JOURNAL_RARITY_ORDER.forEach((rarity, col) => {
      const card = (cards || []).find((c) => c.family === family && c.rarity === rarity);
      if (card) out.push({ card, row, col });
    });
  });
  return out;
}

// How many of the known cards are found (unknown or duplicate ids in storage do not count).
function journalFoundCount(discovered, cards) {
  const ids = (cards || []).map((c) => c.id);
  const seen = [];
  for (const id of discovered || []) if (ids.indexOf(id) >= 0 && seen.indexOf(id) < 0) seen.push(id);
  return seen.length;
}

class JournalScene extends Phaser.Scene {
  constructor() {
    super('Journal');
  }

  create() {
    const L = JOURNAL_LAYOUT;
    const cx = GAME_WIDTH / 2;
    uiAddPaper(this, 0);
    uiMakeDoodles(this);
    uiScatterStars(this, [[650, 250], [70, 300], [670, 1250]]);

    makeButton(this, L.backX, L.topY, 'BACK', () => this.scene.start('Menu'), {
      width: 200, height: 100, fontSize: '44px', color: UI_CRAYON.blue,
    }).setRotation(-0.03);
    addFullscreenButton(this);
    this.input.keyboard.on('keydown-ESC', () => this.scene.start('Menu'));

    const cards = typeof CARDS !== 'undefined' ? CARDS : [];
    const discovered = uiProgressCall((P) => P.discovered(), []);
    this.found = (id) => discovered.indexOf(id) >= 0;
    const count = journalFoundCount(discovered, cards);
    uiTitleText(this, cx, L.titleY, 'CARD JOURNAL', { size: 72, rot: -0.02, shadowColor: uiColorHex(UI_CRAYON.blue) });
    const countText = uiInkText(this, cx, L.countY, count + ' of ' + cards.length + ' found', {
      size: 40, color: uiColorHex(count >= cards.length ? UI_CRAYON.green : UI_CRAYON.yellow), rot: 0.03,
    });
    const under = uiBoilImage(this, cx + 4, L.countY + 30, 'ui_underline').setTint(UI_CRAYON.orange).setScale(0.62, 0.7);
    if (!count) countText.setText('no cards found yet');
    under.setAlpha(count ? 1 : 0);

    journalSlots(cards).forEach((slot, i) => this.buildCard(slot, i));
    this.buildSetNote();
  }

  buildCard(slot, i) {
    const L = JOURNAL_LAYOUT;
    const card = slot.card;
    const x = GAME_WIDTH / 2 + (slot.col - 1) * L.colStep;
    const y = L.rowTop + slot.row * L.rowStep;
    const found = this.found(card.id);
    const box = this.add.container(x, y).setRotation(((uiHash(card.id) % 100) / 100 - 0.5) * 0.09);
    if (found) {
      box.add(uiBoilImage(this, 0, 0, uiNoteTexture(this, L.cardW, L.cardH, { tape: 'top' })));
      box.add(uiBoilImage(this, 0, -34, cardIconTexture(this, card.icon, card.family)).setScale(0.56));
      const name = uiInkText(this, 0, 16, card.name, { size: 26, color: cardCrayonInk(card.family), stroke: null, rot: -0.02 });
      name.setScale(Math.min(1, (L.cardW - 22) / name.width));
      const desc = uiInkText(this, 0, 32, card.desc, {
        size: 21, color: UI_INK.darkHex, stroke: null, oy: 0, rot: 0.01, boil: false, lineSpacing: -5,
      });
      desc.setWordWrapWidth(L.cardW - 20, true);
      desc.setScale(Math.min(1, (L.cardH / 2 - 36) / Math.max(1, desc.height)));
      box.add([name, desc]);
      // Rarity as crayon asterisks in the corner (gold for the legendary).
      const stars = JOURNAL_RARITY_STARS[card.rarity] || 1;
      for (let s = 0; s < stars; s++) {
        box.add(uiBoilImage(this, L.cardW / 2 - 18 - s * 20, -L.cardH / 2 + 22 + (s % 2) * 4, 'ui_star')
          .setTint(card.rarity === 'legendary' ? CARD_GOLD : 0x8a8398).setScale(0.48));
      }
      box.setSize(L.cardW, L.cardH);
      box.setInteractive({ useHandCursor: true });
      box.on('pointerup', () => this.showCloseUp(card));
    } else {
      // Not found yet: a faded scrap with a pencil question mark.
      box.add(uiBoilImage(this, 0, 0, uiNoteTexture(this, L.cardW, L.cardH, { paper: 0x8d8aa0, tape: 'top' })).setAlpha(0.6));
      box.add(uiInkText(this, 0, -12, '?', { size: 96, color: UI_INK.pencilDarkHex, stroke: null, rot: 0.1 }));
      box.add(uiInkText(this, 0, 52, 'not found yet', { size: 21, color: '#3b3850', stroke: null, rot: -0.02, boil: false }));
    }
    box.setAlpha(0).setScale(1.25);
    this.tweens.add({ targets: box, alpha: 1, scale: 1, delay: 80 + i * 40, duration: 200, ease: 'Quad.In' });
  }

  // Set bonuses: one line each, the set's name in its family pen.
  buildSetNote() {
    const L = JOURNAL_LAYOUT;
    if (typeof SET_BONUSES === 'undefined') return;
    const note = this.add.container(GAME_WIDTH / 2, L.noteY).setRotation(-0.01);
    note.add(uiBoilImage(this, 0, 0, uiNoteTexture(this, L.noteW, L.noteH, { rules: { top: 72, step: 38 }, margin: 34 })));
    note.add(uiInkText(this, -L.noteW / 2 + 52, -L.noteH / 2 + 30, 'set bonus: any 2 cards of one family', {
      size: 26, color: uiColorHex(0xb4441a), stroke: null, ox: 0, rot: -0.02,
    }));
    JOURNAL_FAMILY_ORDER.forEach((family, i) => {
      const set = SET_BONUSES[family];
      if (!set) return;
      const y = -L.noteH / 2 + 64 + i * 38;
      const name = uiInkText(this, -L.noteW / 2 + 52, y, set.name, { size: 26, color: cardCrayonInk(family), stroke: null, ox: 0, rot: -0.01 });
      const desc = uiInkText(this, name.x + name.width + 12, y + 1, set.desc, { size: 24, color: UI_INK.darkHex, stroke: null, ox: 0, rot: 0, boil: false });
      desc.setScale(Math.min(1, (L.noteW / 2 - 16 - desc.x) / desc.width));
      note.add([name, desc]);
    });
  }

  // A found card held up close: bigger icon and lettering, tap anywhere to put it back.
  showCloseUp(card) {
    if (this.closeUp) return;
    this.game.events.emit('sfx', 'click', {});
    const shade = this.add.rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT, 0x05060f, 0.55).setOrigin(0).setDepth(50).setInteractive();
    const box = this.add.container(GAME_WIDTH / 2, GAME_HEIGHT / 2 - 40).setDepth(51).setRotation(-0.03);
    box.add(uiBoilImage(this, 0, 0, uiNoteTexture(this, 460, 400, { tape: 'corners' })));
    box.add(uiBoilImage(this, 0, -80, cardIconTexture(this, card.icon, card.family)).setScale(1.2));
    box.add(uiInkText(this, 0, 50, card.name, { size: 50, color: cardCrayonInk(card.family), stroke: null, rot: -0.02 }));
    const desc = uiInkText(this, 0, 100, card.desc, { size: 34, color: UI_INK.darkHex, stroke: null, rot: 0.01, oy: 0 });
    desc.setWordWrapWidth(400, true);
    box.add(desc);
    const fam = (typeof CARD_FAMILIES !== 'undefined' && CARD_FAMILIES[card.family]) ? CARD_FAMILIES[card.family].name : card.family;
    box.add(uiInkText(this, 0, -170, card.rarity + ' ' + String(fam).toLowerCase(), { size: 28, color: UI_INK.pencilDarkHex, stroke: null, rot: 0.02 }));
    box.setScale(0.4).setAlpha(0);
    this.tweens.add({ targets: box, scale: 1, alpha: 1, duration: 200, ease: 'Back.Out' });
    this.closeUp = { shade, box };
    // Listen from the next tap on, so the tap that opened the close-up does not also close it.
    this.time.delayedCall(80, () => shade.on('pointerup', () => {
      shade.destroy();
      box.destroy();
      this.closeUp = null;
    }));
  }
}
