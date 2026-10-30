// HUD pop rules and card-row grouping (pure helpers from the browser scripts).
// Run: node --test tests/hud.test.js
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

// The scripts are plain browser files: load them into one context with a tiny Phaser stub.
function loadBrowserScripts() {
  const context = vm.createContext({ Phaser: { Scene: class {} }, console });
  for (const file of ['src/config.js', 'src/cards.js', 'src/cardart.js', 'src/scenes/HudScene.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), context, { filename: file });
  }
  // Top-level const/let bindings are not context properties; read them out through an expression.
  return vm.runInContext('({ popPriority, POP_HIGH, POP_MEDIUM, POP_LOW, hudBoxDistance, cardGroupedOrder, hudQueueWaitingPop, hudFitCardRow, POP_WAIT, HUD_MILESTONE, HUD_BANNER, HUD_CARDS, hudSpeedSnap, hudSpeedEase, HUD_SNAP, hudMomentumStyle, HUD_MOMENTUM, UI_INK, UI_CRAYON, hudNovaNear, HUD_NOVA })', context);
}

const hud = loadBrowserScripts();

test('important pops are high priority and never rank like +SPEED', () => {
  for (const label of ['UNBREAKABLE!', 'SHIELD!', 'NEW BEST!', 'CLOSE CALL!', 'GRAVITY WELL!', 'CHAIN REACTION!', 'ORBIT MASTER!', 'SHOCKWAVE!']) {
    assert.strictEqual(hud.popPriority(label), hud.POP_HIGH, label);
  }
});

test('PERFECT is medium, small gains are low', () => {
  assert.strictEqual(hud.popPriority('PERFECT!'), hud.POP_MEDIUM);
  assert.strictEqual(hud.popPriority('PERFECT x4! +SPEED'), hud.POP_MEDIUM);
  for (const label of ['+SPEED', 'CLOSE ORBIT!', 'WARP!', 'OVERSPEED!', 'CHAIN BOOST!']) {
    assert.strictEqual(hud.popPriority(label), hud.POP_LOW, label);
  }
});

test('box distance is 0 inside and euclidean outside', () => {
  assert.strictEqual(hud.hudBoxDistance(5, 5, 0, 0, 10, 10), 0);
  assert.strictEqual(hud.hudBoxDistance(13, 14, 0, 0, 10, 10), 5);
  assert.strictEqual(hud.hudBoxDistance(-20, 5, 0, 0, 10, 10), 20);
});

test('owned cards are grouped by family in first-pick order', () => {
  const order = hud.cardGroupedOrder(['aero', 'perfect', 'afterburner', 'chain', 'shockwave']);
  assert.deepStrictEqual(Array.from(order), ['aero', 'afterburner', 'perfect', 'chain', 'shockwave']);
});

test('pops waiting for a banner: same label replaces, the queue keeps the newest few', () => {
  let q = [];
  q = hud.hudQueueWaitingPop(q, { label: '+SPEED', at: 1 });
  q = hud.hudQueueWaitingPop(q, { label: 'PERFECT!', at: 2 });
  q = hud.hudQueueWaitingPop(q, { label: '+SPEED', at: 3 });
  assert.deepStrictEqual(q.map(i => i.label), ['PERFECT!', '+SPEED']);
  assert.strictEqual(q[1].at, 3);
  q = hud.hudQueueWaitingPop(q, { label: 'WARP!', at: 4 });
  assert.strictEqual(q.length, hud.POP_WAIT.max);
  assert.strictEqual(q[q.length - 1].label, 'WARP!');
  // A waiting high pop (card name) outlives newer low ones.
  q = hud.hudQueueWaitingPop([], { label: 'SHOCKWAVE!', at: 1, high: true });
  q = hud.hudQueueWaitingPop(q, { label: '+SPEED', at: 2 });
  q = hud.hudQueueWaitingPop(q, { label: 'WARP!', at: 3 });
  assert.deepStrictEqual(q.map(i => i.label), ['SHOCKWAVE!', 'WARP!']);
});

test('card row stays inside the walls: slides first, shrinks only when it cannot fit', () => {
  const L = hud.HUD_CARDS;
  // 5 cards: span from the left-most card to the right end of the row.
  const left = -4 * L.gap - L.groupGap - L.cardW / 2 - 14;
  const right = L.cardW / 2 + 14;
  // Walls off screen (zoom 1): the row keeps its preferred spot.
  let fit = hud.hudFitCardRow(left, right, L.right, 0, 720, 12);
  assert.strictEqual(fit.x, L.right);
  assert.strictEqual(fit.scale, 1);
  // Camera zoomed out: the right wall at screen x 640 -> the row slides left, still full size.
  fit = hud.hudFitCardRow(left, right, L.right, 80, 640, 12);
  assert.ok(fit.x + right * fit.scale <= 628 + 1e-9, 'right edge inside the wall');
  assert.ok(fit.x + left * fit.scale >= 92 - 1e-9, 'left edge inside the wall');
  assert.strictEqual(fit.scale, 1);
  // Very zoomed out: shrinks to fit between the walls.
  fit = hud.hudFitCardRow(left, right, L.right, 140, 580, 12);
  assert.ok(fit.scale < 1);
  assert.ok(Math.abs(fit.x + right * fit.scale - 568) < 1e-6);
  assert.ok(fit.x + left * fit.scale >= 152 - 1e-6);
});

test('milestone levels escalate in size; the banner sits lower when the card row is up', () => {
  const sizes = hud.HUD_MILESTONE.levels.map(l => l.size);
  for (let i = 1; i < sizes.length; i++) assert.ok(sizes[i] > sizes[i - 1]);
  assert.ok(hud.HUD_MILESTONE.holdMs + hud.HUD_MILESTONE.fadeMs + 130 <= 1100, 'stamp lasts about 0.9 s');
  const rowBottom = hud.HUD_CARDS.y + hud.HUD_CARDS.cardH / 2 + 12;
  // Banner title is ~84 px tall: its top must clear the row.
  assert.ok(hud.HUD_BANNER.yWithCards - 50 > rowBottom, 'banner title clears the card row');
});

test('speed readout: rises snap at once, big rises punch, drops ease down', () => {
  // A small orbit gain shows at once without a punch.
  let r = hud.hudSpeedSnap(300, 302);
  assert.strictEqual(r.shown, 302);
  assert.strictEqual(r.punch, 0);
  // A boost (SECOND WIND, milestone, card) snaps and punches, capped.
  r = hud.hudSpeedSnap(200, 260);
  assert.strictEqual(r.shown, 260);
  assert.ok(r.punch > 0.1 && r.punch <= hud.HUD_SNAP.punchMax);
  assert.strictEqual(hud.hudSpeedSnap(100, 2000).punch, hud.HUD_SNAP.punchMax);
  // A bigger boost punches harder.
  assert.ok(hud.hudSpeedSnap(200, 240).punch > hud.hudSpeedSnap(200, 215).punch);
  // A drop is not snapped by hudSpeedSnap; hudSpeedEase walks down and lands exactly.
  r = hud.hudSpeedSnap(300, 250);
  assert.strictEqual(r.shown, 300);
  let shown = 300;
  for (let i = 0; i < 120; i++) shown = hud.hudSpeedEase(shown, 250, 1 / 60);
  assert.strictEqual(shown, 250);
  const one = hud.hudSpeedEase(300, 250, 1 / 60);
  assert.ok(one < 300 && one > 290, 'eases, does not jump down');
  assert.strictEqual(hud.hudSpeedEase(250, 300, 1 / 60), 300, 'ease never lags a rise');
});

test('momentum cue escalates: more and taller flames, bigger and hotter number, shake only at the top', () => {
  const none = hud.hudMomentumStyle(0);
  assert.strictEqual(none.licks, 0);
  assert.strictEqual(none.shake, 0);
  assert.strictEqual(none.ink, hud.UI_INK.cream);
  let prev = hud.hudMomentumStyle(0.1);
  for (const m of [0.3, 0.5, 0.7, 0.9, 1]) {
    const s = hud.hudMomentumStyle(m);
    assert.ok(s.licks >= prev.licks, 'licks at ' + m);
    assert.ok(s.height > prev.height, 'height at ' + m);
    assert.ok(s.scale > prev.scale, 'scale at ' + m);
    prev = s;
  }
  assert.strictEqual(hud.hudMomentumStyle(0.6).shake, 0, 'no shake at mid momentum');
  assert.ok(hud.hudMomentumStyle(1).shake > 0);
  assert.ok(hud.hudMomentumStyle(1).shake <= hud.HUD_MOMENTUM.shakeMax);
  assert.strictEqual(hud.hudMomentumStyle(1).ink, hud.UI_CRAYON.red);
  assert.strictEqual(hud.hudMomentumStyle(0.625).ink, hud.UI_CRAYON.yellow);
  // Out of range and junk input are clamped.
  assert.deepStrictEqual(hud.hudMomentumStyle(5), hud.hudMomentumStyle(1));
  assert.strictEqual(hud.hudMomentumStyle(NaN).licks, 0);
  // The number's crayon only changes in a few steps (each change re-renders its texture).
  const inks = new Set();
  for (let m = 0; m <= 1; m += 0.01) inks.add(hud.hudMomentumStyle(m).ink);
  assert.ok(inks.size <= 9);
});
test('supernova nearness is 0 far below the band, 1 up behind it, and safe on bad input', () => {
  assert.strictEqual(hud.hudNovaNear(hud.HUD_NOVA.farY + 200), 0);
  assert.strictEqual(hud.hudNovaNear(hud.HUD_NOVA.farY), 0);
  assert.strictEqual(hud.hudNovaNear(hud.HUD_NOVA.nearY), 1);
  assert.strictEqual(hud.hudNovaNear(200), 1);
  const mid = hud.hudNovaNear((hud.HUD_NOVA.farY + hud.HUD_NOVA.nearY) / 2);
  assert.ok(mid > 0.45 && mid < 0.55, String(mid));
  assert.strictEqual(hud.hudNovaNear(undefined), 0);
  assert.strictEqual(hud.hudNovaNear(NaN), 0);
});

test('the zone banner is fully faded before the card header shows', () => {
  assert.ok(hud.HUD_BANNER.fadeMs < hud.HUD_BANNER.clearMs);
  assert.ok(hud.HUD_BANNER.clearMs <= 200, 'the header must not feel late');
});

// ---- meta UI: missions / shop / journal / game over layout (pure helpers) ----
function loadMetaUi() {
  const context = vm.createContext({ Phaser: { Scene: class {} }, console });
  for (const file of ['src/config.js', 'src/utils.js', 'src/cards.js', 'src/cardart.js', 'src/scenes/MenuScene.js',
    'src/scenes/GameOverScene.js', 'src/scenes/ShopScene.js', 'src/scenes/JournalScene.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), context, { filename: file });
  }
  return vm.runInContext('({ uiMissionProgressLabel, uiShortNumber, uiShopAction, uiProgressCall, goLayout, goMissionPlan, GO_META, GO_CARD, GO_STRIP, shopTilePositions, SHOP_LAYOUT, journalSlots, journalFoundCount, CARDS, MENU_LAYOUT, GAME_WIDTH, GAME_HEIGHT })', context);
}
const meta = loadMetaUi();

test('mission progress reads like 212/300, big goals shortened, none for one-shot or done', () => {
  assert.strictEqual(meta.uiMissionProgressLabel({ progress: 212, goal: 300 }), '212/300');
  assert.strictEqual(meta.uiMissionProgressLabel({ progress: 999, goal: 300 }), '300/300');
  assert.strictEqual(meta.uiMissionProgressLabel({ progress: 12345, goal: 50000 }), '12.3k/50k');
  assert.strictEqual(meta.uiMissionProgressLabel({ progress: 0, goal: 1 }), '');
  assert.strictEqual(meta.uiMissionProgressLabel({ progress: 5, goal: 5, done: true }), '');
  assert.strictEqual(meta.uiMissionProgressLabel(null), '');
});

test('shop button: wearing / equip / buy / need N more', () => {
  const skin = (o) => Object.assign({ id: 'ice', price: 100, owned: false, equipped: false }, o);
  assert.strictEqual(meta.uiShopAction(skin({ owned: true, equipped: true }), 0).kind, 'equipped');
  assert.strictEqual(meta.uiShopAction(skin({ owned: true }), 0).kind, 'equip');
  assert.deepStrictEqual(Object.assign({}, meta.uiShopAction(skin(), 100)), { kind: 'buy', label: 'BUY 100' });
  const short = meta.uiShopAction(skin(), 60);
  assert.strictEqual(short.kind, 'short');
  assert.strictEqual(short.label, 'NEED 40 MORE');
});

test('PROGRESS calls fall back when it is missing or throws', () => {
  assert.strictEqual(meta.uiProgressCall(() => 5, 0), 0, 'PROGRESS is not loaded in this context');
});

test('game over mission plan: finished first (each with its replacement), then the ones still going', () => {
  const m = (id) => ({ id, text: id, progress: 0, goal: 1, reward: 25 });
  const res = { completed: [m('a'), m('b')], newMissions: [m('d'), m('e')] };
  const active = [m('c'), m('d'), m('e')];
  const plan = meta.goMissionPlan(res, active);
  assert.deepStrictEqual(Array.from(plan.map((r) => r.mission.id)), ['a', 'b', 'c']);
  assert.deepStrictEqual(Array.from(plan.map((r) => r.done)), [true, true, false]);
  assert.deepStrictEqual(Array.from(plan.map((r) => r.replaceWith && r.replaceWith.id)), ['d', 'e', null]);
  // No endRun result (e.g. storage blocked before): just the active list, nothing animated.
  assert.deepStrictEqual(Array.from(meta.goMissionPlan(null, active).map((r) => r.done)), [false, false, false]);
  // Pool ran dry: a finished mission without a replacement stays crossed out.
  assert.strictEqual(meta.goMissionPlan({ completed: [m('z')], newMissions: [] }, []).length, 1);
});

test('game over layout fits the 720x1280 page and keeps RETRY big and clear', () => {
  for (const hasBuild of [false, true]) {
    for (const hasMeta of [false, true]) {
      const L = meta.goLayout(hasBuild, hasMeta);
      assert.ok(L.retry.h >= 100 && L.menu.h >= 100, 'touch targets');
      assert.ok(L.retry.w >= 380, 'RETRY stays the big button');
      assert.ok(L.retry.y + L.retry.h / 2 <= meta.GAME_HEIGHT - 60, 'clear of the bottom edge');
      if (!hasMeta) continue;
      const pageTop = L.pageY - (meta.GO_CARD.h / 2) * L.pageScale;
      assert.ok(pageTop >= 168, 'page below the mute / fullscreen buttons');
      const noteTop = L.noteY - meta.GO_META.noteH / 2;
      const noteBottom = L.noteY + meta.GO_META.noteH / 2;
      assert.ok(noteBottom < L.retry.y - L.retry.h / 2, 'missions note above the buttons');
      if (hasBuild) assert.ok(L.stripY + (meta.GO_STRIP.h * L.stripScale) / 2 <= noteTop + 20, 'strip sits on the note top');
      const pageBottom = L.pageY + (meta.GO_META.pageImageY + meta.GO_META.pageH / 2) * L.pageScale;
      assert.ok(pageBottom <= (hasBuild ? L.stripY : noteTop) + 4, 'page ends above the strip / note');
      assert.ok(L.pageScale >= 0.85, 'page text stays readable on a 360 px phone');
      // RETRY and MENU side by side without overlapping.
      assert.ok(L.retry.x + L.retry.w / 2 < L.menu.x - L.menu.w / 2);
      assert.ok(L.menu.x + L.menu.w / 2 <= meta.GAME_WIDTH - 10);
    }
  }
});

test('shop tiles stay on screen and do not overlap', () => {
  const L = meta.SHOP_LAYOUT;
  const spots = meta.shopTilePositions(7);
  for (const s of spots) {
    assert.ok(s.x - L.tileW / 2 >= 0 && s.x + L.tileW / 2 <= meta.GAME_WIDTH);
    assert.ok(s.y + L.tileH / 2 < L.actionY - L.actionH / 2);
  }
  for (let i = 0; i < spots.length; i++) {
    for (let j = i + 1; j < spots.length; j++) {
      const a = spots[i];
      const b = spots[j];
      assert.ok(Math.abs(a.x - b.x) >= L.tileW || Math.abs(a.y - b.y) >= L.tileH, i + ' vs ' + j);
    }
  }
  assert.ok(L.tileH >= 100 && L.actionH >= 100, 'touch targets');
});

test('journal: 12 slots in family rows x rarity columns, found count ignores junk', () => {
  const slots = meta.journalSlots(meta.CARDS);
  assert.strictEqual(slots.length, 12);
  const keys = new Set(slots.map((s) => s.row + ',' + s.col));
  assert.strictEqual(keys.size, 12);
  assert.strictEqual(meta.journalFoundCount(['well', 'well', 'nope', 'sling'], meta.CARDS), 2);
  assert.strictEqual(meta.journalFoundCount(undefined, meta.CARDS), 0);
});

test('menu: PLAY, the missions note and SHOP / JOURNAL stack without overlapping', () => {
  const L = meta.MENU_LAYOUT;
  assert.ok(L.noteY + L.noteH / 2 < L.playY - 65);
  assert.ok(L.playY + 65 < L.metaY - L.metaH / 2);
  assert.ok(L.metaY + L.metaH / 2 <= meta.GAME_HEIGHT - 60);
  assert.ok(L.metaH >= 100);
});
