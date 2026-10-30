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
  return vm.runInContext('({ popPriority, POP_HIGH, POP_MEDIUM, POP_LOW, hudBoxDistance, cardGroupedOrder, hudQueueWaitingPop, POP_WAIT, HUD_MILESTONE, HUD_BANNER, HUD_CARDS, hudSpeedSnap, hudSpeedEase, HUD_SNAP, hudMomentumStyle, HUD_MOMENTUM, UI_INK, UI_CRAYON, hudNovaNear, HUD_NOVA, hudMachNumber, hudMachTierLevel, HUD_MACH, HUD_SPEED, HUD_PANEL, HUD_SAFE_BOTTOM, POP, hudColorBrightness, hudPageIsLight, hudZoneForPage, HUD_HAND, hudHandPoints, HUD_NOVA_WARN, hudNovaWarnLevel, hudNovaWarnHz, hudCirclesUnder, HUD_NOTE, HUD_SETBONUS, hudSetBonusY, HUD_BADGE_PANEL, HUD_HALO, hudNovaWarnX, hudRectGap, hudRectsOverlap, HUD_STEP, hudSpotRadius, hudStepRect, hudStepHudRects, hudStepArrowCircles, hudStepPlace, hudStepSpotClear, hudNiceSpot, hudStepFade, hudBodyRadius, hudStepLayout, hudStepLayoutClear, hudStepScene, hudStepScan, hudStepArrowPath, hudStepArrowPoint, HUD_HAND_OPEN, hudRepeatAllowed, hudPopKind, hudMergePopLabel, HUD_REPEAT, hudCardStripSlots, hudCardStripRect, HUD_POP_GATE, hudIsLossPop, hudPopGate, hudPopGateRecord, hudCardIdForPop, HUD_SCRAP, hudTornScrapPoints, HUD_BADGE })', context);
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

test('owned-card strip: small icons in the top band, out of the play field, never overlapping', () => {
  const L = hud.HUD_CARDS;
  const N = hud.HUD_NOTE;
  assert.strictEqual(hud.hudCardStripSlots(0).length, 0);
  assert.strictEqual(hud.hudCardStripRect(0), null);
  for (let n = 1; n <= 12; n++) {
    const slots = hud.hudCardStripSlots(n);
    assert.strictEqual(slots.length, n);
    const r = hud.hudCardStripRect(n);
    assert.ok(r.left >= N.paper.right + 20, 'right of the score note paper (' + n + ')');
    assert.ok(r.right <= 720 - 150, 'left of the fullscreen button (' + n + ')');
    assert.ok(r.top >= 70 && r.bottom <= 180, 'in the top band, above the pop area (' + n + ')');
    assert.ok(r.bottom + 20 < hud.POP.top, 'pops start below it');
    // Neighbours in a row never overlap.
    for (let i = 1; i < n; i++) {
      if (slots[i].y === slots[i - 1].y) assert.ok(slots[i].x - slots[i - 1].x >= L.cardW, 'no overlap (' + n + ')');
    }
  }
  // Up to perRow cards: one row; more: two rows.
  assert.strictEqual(new Set(hud.hudCardStripSlots(L.perRow).map(s => s.y)).size, 1);
  assert.strictEqual(new Set(hud.hudCardStripSlots(L.perRow + 1).map(s => s.y)).size, 2);
});

test('milestone levels escalate in size; the banner clears the card strip', () => {
  const sizes = hud.HUD_MILESTONE.levels.map(l => l.size);
  for (let i = 1; i < sizes.length; i++) assert.ok(sizes[i] > sizes[i - 1]);
  assert.ok(hud.HUD_MILESTONE.holdMs + hud.HUD_MILESTONE.fadeMs + 130 <= 1100, 'stamp lasts about 0.9 s');
  const rowBottom = hud.hudCardStripRect(12).bottom;
  // Banner title is ~84 px tall: its top must clear the strip.
  assert.ok(hud.HUD_BANNER.y - 50 > rowBottom, 'banner title clears the card strip');
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
  return vm.runInContext('({ uiMissionUnit, uiHasFinishedRun, uiLoadMenuFlags, uiMissionProgressLabel, uiShortNumber, uiShopAction, uiProgressCall, goLayout, goMissionPlan, GO_META, GO_CARD, GO_STRIP, shopTilePositions, SHOP_LAYOUT, journalSlots, journalFoundCount, CARDS, MENU_LAYOUT, GAME_WIDTH, GAME_HEIGHT })', context);
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

test('MACH readout: km/s * 1000 / 343, rounded, safe on junk', () => {
  assert.strictEqual(hud.hudMachNumber(343), 1000);
  assert.strictEqual(hud.hudMachNumber(538), Math.round(538000 / 343));
  assert.strictEqual(hud.hudMachNumber(0), 0);
  assert.strictEqual(hud.hudMachNumber(-5), 0);
  assert.strictEqual(hud.hudMachNumber(NaN), 0);
  assert.strictEqual(hud.hudMachNumber(undefined), 0);
  // The readout sits under the speed underline, out of the phone browser-bar zone at the bottom.
  const machBottom = hud.HUD_SPEED.lineY + hud.HUD_MACH.dy + hud.HUD_MACH.size / 2 + 5;
  assert.ok(machBottom <= 1280 - hud.HUD_SAFE_BOTTOM, 'MACH bottom ' + machBottom);
  assert.ok(hud.HUD_SAFE_BOTTOM >= 100);
  // ...and clear of the underline it hangs from (the line is ~7 px thick).
  assert.ok(hud.HUD_MACH.dy - hud.HUD_MACH.size / 2 >= 8);
  // The speed number stays below the pop area and the hint line.
  assert.ok(hud.HUD_SPEED.y - 40 > 1280 - hud.POP.bottomMargin);
});

test('MACH tier stamps escalate like the chain milestones', () => {
  const levels = hud.HUD_MACH.tiers.map((t) => hud.hudMachTierLevel(t));
  for (let i = 1; i < levels.length; i++) assert.ok(levels[i] >= levels[i - 1]);
  assert.strictEqual(levels[0], 1);
  assert.strictEqual(levels[levels.length - 1], hud.HUD_MILESTONE.levels.length);
});

test('mission progress has units for altitude and speed goals', () => {
  assert.strictEqual(meta.uiMissionProgressLabel({ stat: 'altitude', progress: 312, goal: 500 }), '312/500 m');
  assert.strictEqual(meta.uiMissionProgressLabel({ stat: 'topSpeed', progress: 271, goal: 300 }), '271/300 km/s');
  assert.strictEqual(meta.uiMissionProgressLabel({ stat: 'catches', progress: 3, goal: 5 }), '3/5');
  assert.strictEqual(meta.uiMissionProgressLabel({ stat: 'altitude', progress: 12345, goal: 50000 }), '12.3k/50k m');
  assert.strictEqual(meta.uiMissionUnit(null), '');
});

test('mission units come from the real pool by id', () => {
  const ctx = vm.createContext({ Phaser: { Scene: class {} }, console });
  for (const file of ['src/config.js', 'src/utils.js', 'src/progress.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), ctx, { filename: file });
  }
  const label = vm.runInContext('(m) => uiMissionProgressLabel(m)', ctx);
  assert.strictEqual(label({ id: 'orbit', progress: 312, goal: 500 }), '312/500 m');
  assert.strictEqual(label({ id: 'speed300', progress: 271, goal: 300 }), '271/300 km/s');
  assert.strictEqual(label({ id: 'catch5', progress: 2, goal: 5 }), '2/5');
});

test('first visit: no storage and no best means no finished run yet', () => {
  // localStorage is missing in this context: every read falls back without throwing.
  assert.strictEqual(meta.uiHasFinishedRun(), false);
  assert.deepStrictEqual(Object.assign({}, meta.uiLoadMenuFlags()), { runDone: false, metaSeen: false });
});

test('first-visit menu: PLAY sits under the how-to line and well above the bottom', () => {
  const L = meta.MENU_LAYOUT;
  assert.ok(L.firstPlayY - 65 > L.howY + 40);
  assert.ok(L.firstPlayY + 65 <= meta.GAME_HEIGHT - 200);
});

// ---- page ink ----

test('page ink: pale pages (cream, white graph paper) get dark HUD ink, dark pages keep cream', () => {
  assert.ok(hud.hudColorBrightness(0xffffff) > 0.99);
  assert.ok(hud.hudColorBrightness(0x000000) < 0.01);
  const page = (paper, ink) => ({ paper, sky: paper, ink });
  assert.strictEqual(hud.hudPageIsLight(page(0xefdcae, 0x2a2018)), true);    // ESCAPE VELOCITY
  assert.strictEqual(hud.hudPageIsLight(page(0xf1eee4, 0x1d2747)), true);    // BIG BANG
  for (const paper of [0x1d2747, 0x123f45, 0x4a1a22, 0x121116, 0x2e1d4f, 0x5a3b22, 0x1f3b2c, 0x1b3f6b, 0x2a1f1a]) {
    assert.strictEqual(hud.hudPageIsLight(page(paper, 0xf4ead0)), false, paper.toString(16));
  }
  // Only a sky color, or only an ink color: still decided; nothing at all: the fallback flag.
  assert.strictEqual(hud.hudPageIsLight({ sky: 0xf1eee4 }), true);
  assert.strictEqual(hud.hudPageIsLight({ ink: 0x1d2747 }), true);
  assert.strictEqual(hud.hudPageIsLight(null, true), true);
  assert.strictEqual(hud.hudPageIsLight(undefined, false), false);
});

function hudContext(extra) {
  const ctx = vm.createContext({ Phaser: { Scene: class {} }, console });
  for (const file of ['src/config.js', 'src/cards.js', 'src/cardart.js', 'src/scenes/HudScene.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), ctx, { filename: file });
  }
  vm.runInContext(extra, ctx);
  return ctx;
}

test('page ink: the zone comes from zoneAt() when orbit.js provides it (endless pages too)', () => {
  // The default test context loads no orbit.js: no zone, so the HUD falls back to UI_PAPERS.
  assert.strictEqual(hud.hudZoneForPage(3), null);
  const ctx = hudContext('var zoneAt = (i) => ({ name: "P" + i, paper: i % 2 ? 0xf1eee4 : 0x1d2747 });');
  assert.strictEqual(vm.runInContext('hudZoneForPage(41).name', ctx), 'P41');
  assert.strictEqual(vm.runInContext('hudPageIsLight(hudZoneForPage(41))', ctx), true);
  assert.strictEqual(vm.runInContext('hudPageIsLight(hudZoneForPage(40))', ctx), false);
  // Junk index: page 0, never a throw.
  assert.strictEqual(vm.runInContext('hudZoneForPage(undefined).name', ctx), 'P0');
  // Only the fixed list: clamped to its last page.
  const ctx2 = hudContext('var ZONES = [{ name: "A" }, { name: "B" }];');
  assert.strictEqual(vm.runInContext('hudZoneForPage(9).name', ctx2), 'B');
});

test('page ink: the real zones (orbit.js) - BIG BANG and ESCAPE VELOCITY are the pale pages', () => {
  const ctx = vm.createContext({ Phaser: { Scene: class {} }, console });
  for (const file of ['src/config.js', 'src/orbit.js', 'src/cards.js', 'src/cardart.js', 'src/scenes/HudScene.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), ctx, { filename: file });
  }
  const pale = vm.runInContext('(() => { const out = []; for (let i = 0; i < 16; i++) { const z = hudZoneForPage(i); if (z && hudPageIsLight(z)) out.push(z.name); } return out; })()', ctx);
  assert.ok(pale.indexOf('ESCAPE VELOCITY') >= 0, JSON.stringify(pale));
  if (vm.runInContext('typeof zoneAt', ctx) === 'function') assert.ok(pale.indexOf('BIG BANG') >= 0, JSON.stringify(pale));
});

test('off-screen supernova warning: only the last ~0.8 s with the front below the screen, faster pulse when closer', () => {
  const W = hud.HUD_NOVA_WARN;
  const below = 1280 + 300;
  assert.ok(W.eta <= 0.8 && W.eta >= 0.5, 'up at least 0.5 s before contact, not most of the late game');
  for (const junk of [Infinity, 99, W.eta, 1.0, 1.1, NaN, undefined, null, 'x']) assert.strictEqual(hud.hudNovaWarnLevel(junk, below), 0, String(junk));
  assert.ok(hud.hudNovaWarnLevel(0.75, below) >= W.minLevel);
  assert.ok(hud.hudNovaWarnLevel(0.4, below) > hud.hudNovaWarnLevel(0.7, below));
  assert.strictEqual(hud.hudNovaWarnLevel(0.2, below), 1);
  // The '!!' pulse escalates as the nova closes in.
  assert.ok(hud.hudNovaWarnHz(hud.hudNovaWarnLevel(0.2, below)) > hud.hudNovaWarnHz(hud.hudNovaWarnLevel(0.7, below)) + 4);
  assert.strictEqual(hud.hudNovaWarnLevel(-0.5, below), 1, 'already overdue = full');
  // The front is up on screen: the player can see it, no off-screen warning.
  assert.strictEqual(hud.hudNovaWarnLevel(0.5, 900), 0);
  // Unknown front position: eta alone decides.
  assert.ok(hud.hudNovaWarnLevel(0.5, null) > 0);
  assert.ok(hud.hudNovaWarnHz(1) > hud.hudNovaWarnHz(0.3));
  assert.strictEqual(hud.hudNovaWarnHz(5), W.hzMax);
  assert.strictEqual(hud.hudNovaWarnHz(undefined), W.hzMin);
});

test('declutter: corner blocks keep the middle lane free and are see-through; the note fades over planets', () => {
  assert.ok(hud.HUD_PANEL.right <= 330, 'speed block in the left corner');
  assert.ok(hud.HUD_BADGE_PANEL.left >= 560, 'multiplier loop in the right corner');
  assert.ok(hud.HUD_HALO.alpha >= 0.4 && hud.HUD_HALO.alpha <= 0.6);
  assert.ok(hud.HUD_HALO.w <= 320 && hud.HUD_HALO.h <= 150, 'smudge is small');
  // MACH stays readable.
  assert.ok(hud.HUD_MACH.size >= 26);
  const r = hud.HUD_NOTE.rect;
  assert.strictEqual(hud.hudCirclesUnder(r, [{ x: 600, y: 700, r: 60 }], 6), false);
  assert.strictEqual(hud.hudCirclesUnder(r, [{ x: 200, y: 260, r: 40 }], 6), true, 'planet poking under the note');
  assert.strictEqual(hud.hudCirclesUnder(r, [{ x: 100, y: 100 }], 0), true, 'comet inside');
  assert.strictEqual(hud.hudCirclesUnder(r, [null, { x: NaN, y: 1 }, {}], 6), false, 'junk ignored');
  assert.ok(hud.HUD_NOTE.under >= 0.4 && hud.HUD_NOTE.under <= 0.6);
});

test('set bonus: short, high, clear of the card row, never in the lower third or near the bottom band', () => {
  const S = hud.HUD_SETBONUS;
  const hintY = hud.HUD_PANEL.top - 30;   // the old hint line sat here; the band stays clear
  assert.ok(S.holdMs + S.fadeMs <= 1300 && S.holdMs <= 1000);
  const rowBottom = hud.hudCardStripRect(12).bottom;
  for (const cometY of [100, 300, 450, 520, 640, 780, 900, 1200, undefined]) {
    for (const row of [0, rowBottom]) {
      const y = hud.hudSetBonusY(cometY, row);
      assert.ok(y + S.subDy + S.subHalf < hintY - 30, 'sub clears the bottom band ' + y);
      assert.ok(y + S.subDy + S.subHalf < 1280 * 2 / 3 + 20, 'not in the lower third ' + y);
      assert.ok(y + S.labelDy - 24 >= row, 'label clears the card row ' + y);
    }
  }
  assert.strictEqual(hud.hudSetBonusY(900, 0), S.y, 'comet low: up at ~y 300');
  assert.ok(hud.hudSetBonusY(S.y + 40, 0) > S.y + 40 + 150, 'comet in the band: the set name moves under it');
});

test("off-screen warning: the '!!' never sits over the km/s readout or the multiplier loop", () => {
  const halfW = 60;
  for (const cx of [-50, 0, 60, 166, 250, 360, 500, 650, 720, 900, NaN, undefined]) {
    const x = hud.hudNovaWarnX(cx, halfW);
    assert.ok(x - halfW >= hud.HUD_PANEL.right, 'over km/s at comet x ' + cx + ' -> ' + x);
    assert.ok(x + halfW <= hud.HUD_BADGE_PANEL.left, 'over the x-loop at comet x ' + cx + ' -> ' + x);
  }
  // Still follows the comet inside the middle lane.
  assert.strictEqual(hud.hudNovaWarnX(450, halfW), 450);
});

test('rect helpers: gap and padded overlap', () => {
  const a = { left: 0, top: 0, right: 10, bottom: 10 };
  assert.strictEqual(hud.hudRectGap(a, { left: 5, top: 5, right: 20, bottom: 20 }), 0);
  assert.strictEqual(hud.hudRectGap(a, { left: 13, top: 14, right: 20, bottom: 20 }), 5);
  assert.strictEqual(hud.hudRectsOverlap(a, { left: 12, top: 0, right: 20, bottom: 10 }, 0), false);
  assert.strictEqual(hud.hudRectsOverlap(a, { left: 12, top: 0, right: 20, bottom: 10 }, 5), true);
});

// ---- one-time guided tutorial (showTutorialStep) ----

// Every placed box: inside the 60 px margin and under `top`, clear of the bodies / arrow and the
// HUD blocks, and the word clear of the hand.
function stepCheck(L, label) {
  const S = hud.HUD_STEP;
  const handR = hud.hudStepRect(S.handBox, L.hand.x, L.hand.y, L.hand.scale);
  const wordR = hud.hudStepRect(L.wordBox, L.word.x, L.word.y, L.word.scale);
  for (const [name, r] of [['hand', handR], ['word', wordR]]) {
    const at = label + ' ' + name + ' ' + JSON.stringify(r);
    assert.ok(r.left >= S.margin - 1e-6 && r.right <= 720 - S.margin + 1e-6, 'inside the side margins ' + at);
    assert.ok(r.top >= L.screen.top - 1e-6 && r.bottom <= 1280 - S.margin + 1e-6, 'inside the top / bottom margins ' + at);
    for (const c of L.circles) {
      const d = hud.hudBoxDistance(c.x, c.y, r.left, r.top, r.right, r.bottom) - c.r;
      assert.ok(d >= S.gap - 1e-6, 'covers a body / the arrow ' + JSON.stringify(c) + ' d=' + d + ' ' + at);
    }
    for (const rr of hud.hudStepHudRects()) assert.ok(hud.hudRectGap(rr, r) >= S.rectGap - 1e-6, 'on a HUD block ' + JSON.stringify(rr) + ' ' + at);
  }
  assert.ok(hud.hudRectGap(handR, wordR) >= S.wordGap, label + ' word on the hand');
  assert.strictEqual(L.hand.clean && L.word.clean, true, label + ' clean');
}

test('tutorial step: spotlight radius grows with the planet, clamped; the no-cover body sits inside it', () => {
  const S = hud.HUD_STEP;
  assert.strictEqual(hud.hudSpotRadius('planet', 10), S.spotMin);
  assert.strictEqual(hud.hudSpotRadius('planet', 80), 80 * S.spotScale + S.spotPad);
  assert.ok(hud.hudSpotRadius('planet', 80) > 80 + 20, 'rings / moons fit inside');
  assert.ok(hud.hudSpotRadius('planet', 150) <= S.spotMax, 'capped');
  for (const junk of [NaN, undefined, null, -5, 'x']) assert.strictEqual(hud.hudSpotRadius('planet', junk), S.spotMin);
  assert.strictEqual(hud.hudSpotRadius('comet'), S.cometSpot);
  for (const r of [0, 20, 60, 120, 400]) {
    assert.ok(hud.hudBodyRadius('planet', r) >= r, 'body covers the planet ' + r);
    assert.ok(hud.hudBodyRadius('planet', r) <= hud.hudSpotRadius('planet', r), 'body inside the spotlight ' + r);
  }
  assert.ok(hud.hudBodyRadius('comet') < hud.hudSpotRadius('comet'));
});

test('tutorial step HOLD: finger and word never cover the planet or the comet, stay inside and off the HUD', () => {
  const cases = [
    { px: 360, py: 520, pr: 60, cx: 360, cy: 900 },     // the start: planet straight above the comet
    { px: 360, py: 520, pr: 60, cx: 300, cy: 700 },     // comet closing in
    { px: 520, py: 600, pr: 70, cx: 300, cy: 860 },
    { px: 160, py: 480, pr: 50, cx: 420, cy: 980 },
    { px: 600, py: 420, pr: 90, cx: 360, cy: 760 },     // big planet by the right wall
    { px: 360, py: 700, pr: 120, cx: 360, cy: 1000 },   // huge planet in the middle
    { px: 140, py: 900, pr: 60, cx: 480, cy: 1050 },    // low on the left (km/s block)
    { px: 360, py: 400, pr: 80, cx: 360, cy: 620 },     // high up under the score note
  ];
  for (const k of cases) {
    const L = hud.hudStepLayout('hold', k, 250);
    stepCheck(L, JSON.stringify(k));
    assert.strictEqual(L.spots.length, 2);
    assert.ok(L.hand.scale >= 0.7 && L.word.scale >= 0.7);
    assert.strictEqual(hud.hudStepLayoutClear(L, hud.hudStepLayout('hold', k, 250)), true, 'the same info keeps the layout');
  }
});

test('tutorial step LET GO: clear of the comet, the planet and the whole fling arrow, any direction', () => {
  const S = hud.HUD_STEP;
  const p = { px: 360, py: 520, pr: 60 };
  for (const c of [{ cx: 300, cy: 600 }, { cx: 430, cy: 470 }, { cx: 360, cy: 440 }, { cx: 250, cy: 560 }]) {
    for (const [dirX, dirY] of [[0, -1], [0.7, -0.7], [-0.7, -0.7], [1, 0], [-1, 0], [0.4, 0.9]]) {
      const info = Object.assign({ dirX, dirY }, p, c);
      const L = hud.hudStepLayout('letgo', info, 250);
      stepCheck(L, JSON.stringify(info));
      assert.strictEqual(L.circles.length, 2 + S.arrowSamples + 1, 'the arrow is kept clear');
    }
  }
  // The arrow runs from arrowFrom to arrowTo along the (normalised) direction.
  const a = hud.hudStepArrowCircles(100, 100, 0, -5);
  assert.strictEqual(a[0].y, 100 - S.arrowFrom);
  assert.strictEqual(a[a.length - 1].y, 100 - S.arrowTo);
  // No direction (junk): no arrow, still a layout.
  const L = hud.hudStepLayout('letgo', { cx: 300, cy: 600, px: 360, py: 520, pr: 60, dirX: NaN }, 250);
  assert.strictEqual(L.circles.length, 2);
  assert.ok(L.hand.clean);
});

test('tutorial step: the layout stays put while the page drifts, and moves when something lands on it', () => {
  const k = { px: 360, py: 520, pr: 60, cx: 300, cy: 700 };
  const L = hud.hudStepLayout('hold', k, 250);
  const drift = hud.hudStepLayout('hold', { px: 363, py: 523, pr: 60, cx: 303, cy: 702 }, 250);
  assert.strictEqual(hud.hudStepLayoutClear(L, drift), true, 'a few px in slow motion: kept');
  const hr = hud.hudStepRect(hud.HUD_STEP.handBox, L.hand.x, L.hand.y, L.hand.scale);
  const onHand = hud.hudStepLayout('hold', { px: 360, py: 520, pr: 60, cx: (hr.left + hr.right) / 2, cy: (hr.top + hr.bottom) / 2 }, 250);
  assert.strictEqual(hud.hudStepLayoutClear(L, onHand), false, 'the comet on the hand: re-placed');
  assert.strictEqual(hud.hudStepLayoutClear(L, hud.hudStepLayout('letgo', Object.assign({ dirX: 0, dirY: -1 }, k), 250)), false, 'a new step re-places');
  assert.strictEqual(hud.hudStepLayoutClear(null, L), false);
});

test('tutorial step: the drawn hand (pressing, lifted) stays inside its box', () => {
  const S = hud.HUD_STEP;
  const halo = 8 * S.handScale + 8;   // cream halo (7 texture px) + shadow offset
  for (const [lift, sx, sy] of [[-18, S.handScale, S.handScale], [0, S.handScale * 1.03, S.handScale * 0.95], [-S.liftPx, S.handScale, S.handScale]]) {
    for (const pt of hud.hudHandPoints(lift, sx, sy)) {
      assert.ok(pt.x - halo >= S.handBox.l && pt.x + halo <= S.handBox.r, 'x ' + pt.x);
      assert.ok(pt.y - halo >= S.handBox.t && pt.y + halo <= S.handBox.b, 'y ' + pt.y);
    }
  }
  assert.ok(-S.rippleMax >= S.handBox.t && S.rippleMax <= S.handBox.r && -S.rippleMax >= S.handBox.l, 'ripples inside');
  // Big enough to read as a finger on a phone (~200 px tall); the word is big.
  const pts = hud.hudHandPoints(0);
  const tall = Math.max(...pts.map(p => p.y)) - Math.min(...pts.map(p => p.y));
  assert.ok(tall > 190 && tall < 260, 'hand height ' + tall);
  assert.ok(S.word.holdSize >= 110 && S.word.letgoSize >= 96);
  assert.ok(S.word.subY - S.word.subSize / 2 > S.word.lineY, 'sub line under the underline');
});

test('tutorial step: NICE! lands near the comet but never on it, inside the screen', () => {
  const S = hud.HUD_STEP;
  const halfW = 160;
  const halfH = 70;
  for (const [cx, cy] of [[360, 800], [100, 400], [650, 300], [360, 1000], [360, 600], [NaN, NaN]]) {
    const p = hud.hudNiceSpot(cx, cy, halfW, halfH);
    assert.ok(p.x - halfW >= S.margin - 1e-6 && p.x + halfW <= 720 - S.margin + 1e-6, 'x ' + p.x);
    assert.ok(p.y - halfH >= hud.POP.top - 1e-6, 'below the score note ' + p.y);
    if (isFinite(cx)) {
      const d = hud.hudBoxDistance(cx, cy, p.x - halfW, p.y - halfH, p.x + halfW, p.y + halfH);
      assert.ok(d >= S.niceClear - 1e-6, 'on the comet ' + [cx, cy, d]);
      assert.ok(Math.abs(p.y - cy) <= S.niceAbove + 1, 'near the comet');
    }
  }
});

test('tutorial step fades: in over ~0.25 s, out over ~0.2 s, settling exactly', () => {
  const S = hud.HUD_STEP;
  assert.ok(S.fadeIn >= 0.2 && S.fadeIn <= 0.3);
  assert.ok(S.fadeOut >= 0.15 && S.fadeOut <= 0.25);
  let a = 0;
  let frames = 0;
  while (a < 1 && frames < 100) { a = hud.hudStepFade(a, 1, S.fadeIn, 1 / 60); frames++; }
  assert.strictEqual(a, 1);
  assert.ok(frames >= 14 && frames <= 16, 'fade in frames ' + frames);
  frames = 0;
  while (a > 0 && frames < 100) { a = hud.hudStepFade(a, 0, S.fadeOut, 1 / 60); frames++; }
  assert.strictEqual(a, 0);
  assert.ok(frames >= 11 && frames <= 13, 'fade out frames ' + frames);
  assert.strictEqual(hud.hudStepFade(0.5, 1, S.fadeIn, -1), 0.5, 'negative dt is ignored');
  // The wash darkens the page ~55-65%: flat wash plus hatch strokes over it.
  assert.ok(S.wash >= 0.4 && S.wash <= 0.6 && S.hatch > 0.3);
});

test('LET GO arrow: leaves the comet along the fling tangent and bends onto the target (up-left and up-right)', () => {
  const S = hud.HUD_STEP;
  // Comet orbiting a planet below it; the next planet up-left / up-right, the tangent pointing up or sideways.
  for (const [tx, ty, dirX, dirY] of [[170, 380, 0.2, -1], [560, 360, -0.2, -1], [560, 360, 1, -0.2], [170, 380, -1, -0.3]]) {
    const cx = 360;
    const cy = 700;
    const tr = 60;
    const p = hud.hudStepArrowPath(cx, cy, dirX, dirY, tx, ty, tr);
    assert.ok(p && p.target, 'a target arrow');
    const len = Math.hypot(dirX, dirY);
    // Start: arrowFrom out along the tangent; the curve's first direction is the tangent.
    assert.ok(Math.abs(p.sx - (cx + (dirX / len) * S.arrowFrom)) < 1e-6 && Math.abs(p.sy - (cy + (dirY / len) * S.arrowFrom)) < 1e-6);
    const a = hud.hudStepArrowPoint(p, 0.01);
    const cos = ((a.x - p.sx) * dirX + (a.y - p.sy) * dirY) / (Math.hypot(a.x - p.sx, a.y - p.sy) * len);
    assert.ok(cos > 0.95, 'leaves along the tangent ' + cos);
    // Tip: on the comet->target line, just outside the target's body, and pointing into it.
    const dTip = Math.hypot(p.ex - tx, p.ey - ty);
    assert.ok(Math.abs(dTip - (hud.hudBodyRadius('planet', tr) + S.arrowStop)) < 1e-6, 'tip at the target ' + dTip);
    const b = hud.hudStepArrowPoint(p, 0.97);
    const into = ((p.ex - b.x) * (tx - p.ex) + (p.ey - b.y) * (ty - p.ey)) / (Math.hypot(p.ex - b.x, p.ey - b.y) * dTip);
    assert.ok(into > 0.5, 'the head points at the target ' + into);
    // The last half closes in on the target all the way.
    let last = Infinity;
    for (let u = 0.5; u <= 1.0001; u += 0.05) {
      const q = hud.hudStepArrowPoint(p, Math.min(1, u));
      const d = Math.hypot(q.x - tx, q.y - ty);
      assert.ok(d <= last + 1e-6, 'closing in at u ' + u);
      last = d;
    }
  }
  // Close target: still a readable arrow. No direction: straight at the target. Junk: null.
  const close = hud.hudStepArrowPath(360, 700, 0, -1, 360, 560, 50);
  assert.ok(Math.hypot(close.ex - 360, close.ey - 700) >= S.arrowFrom + S.arrowMin - 1e-6);
  const straight = hud.hudStepArrowPath(360, 700, NaN, NaN, 360, 300, 50);
  assert.ok(Math.abs(straight.sx - 360) < 1e-6 && straight.sy < 700);
  assert.strictEqual(hud.hudStepArrowPath(NaN, 1, 0, -1), null);
  assert.strictEqual(hud.hudStepArrowPath(360, 700, 0, 0), null);
});

test('LET GO with a target: lights the target, keeps the hand and word off the orbit planet, the target and the arrow', () => {
  const S = hud.HUD_STEP;
  const cases = [
    { px: 360, py: 820, pr: 70, cx: 360, cy: 730, dirX: 0.2, dirY: -1, tx: 170, ty: 400, tr: 60 },    // target up-left
    { px: 360, py: 820, pr: 70, cx: 360, cy: 730, dirX: -0.2, dirY: -1, tx: 560, ty: 380, tr: 60 },   // target up-right
    { px: 250, py: 760, pr: 60, cx: 330, cy: 700, dirX: 0.5, dirY: -1, tx: 520, ty: 360, tr: 80 },
    { px: 480, py: 700, pr: 90, cx: 380, cy: 640, dirX: -0.6, dirY: -1, tx: 200, ty: 330, tr: 50 },
    { px: 360, py: 600, pr: 60, cx: 440, cy: 560, dirX: 0, dirY: -1, tx: 300, ty: 980, tr: 60 },      // target below
  ];
  for (const k of cases) {
    const L = hud.hudStepLayout('letgo', k, 250);
    stepCheck(L, JSON.stringify(k));
    assert.strictEqual(L.spots.length, 2, 'target + comet lit');
    assert.ok(Math.hypot(L.spots[0].x - k.tx, L.spots[0].y - k.ty) < 1e-6, 'the target is lit');
    assert.strictEqual(L.bodies.length, 3, 'orbit planet, target and comet kept clear');
    assert.strictEqual(L.circles.length, 3 + S.arrowSamples + 1);
    assert.ok(L.arrow && L.arrow.target);
  }
});

test('LET GO hand is open (fingers apart, thumb out) and stays inside the hand box', () => {
  const S = hud.HUD_STEP;
  const O = hud.HUD_HAND_OPEN;
  const halo = 8 * S.handScale + 8;
  for (const lift of [0, -S.liftPx]) {
    for (const pt of hud.hudHandPoints(lift, S.handScale, S.handScale, O.outline)) {
      assert.ok(pt.x - halo >= S.handBox.l && pt.x + halo <= S.handBox.r, 'x ' + pt.x);
      assert.ok(pt.y - halo >= S.handBox.t && pt.y + halo <= S.handBox.b, 'y ' + pt.y);
    }
  }
  // Same anchor (index tip) as the pressing hand, but five spread digits.
  assert.deepStrictEqual(Array.from(O.fingers[0].slice(2, 4)), [hud.HUD_HAND.tipX, hud.HUD_HAND.tipY]);
  assert.strictEqual(O.fingers.length, 4);
  const tipsX = O.fingers.map(f => f[2]);
  for (let i = 1; i < tipsX.length; i++) assert.ok(tipsX[i] > tipsX[i - 1] + 5, 'fingers fan out');
  assert.ok(O.thumb[2] < O.thumb[0] - 20, 'thumb sticks out');
  for (const f of O.fingers.concat([O.thumb])) {
    assert.ok(f[2] - f[4] >= 0 && f[2] + f[4] <= hud.HUD_HAND.w && f[3] >= 0, 'finger inside the texture ' + f);
  }
});

test('repeats: the same pop / stamp never twice within 1.5 s; penalties merge', () => {
  const R = hud.HUD_REPEAT;
  assert.strictEqual(R.ms, 1500);
  const seen = {};
  assert.strictEqual(hud.hudRepeatAllowed(seen, 'NICE!', 1000), true);
  assert.strictEqual(hud.hudRepeatAllowed(seen, 'NICE!', 1200), false);
  assert.strictEqual(hud.hudRepeatAllowed(seen, 'NICE!', 2499), false);
  assert.strictEqual(hud.hudRepeatAllowed(seen, 'BLAZING!', 1300), true, 'other words are free');
  assert.strictEqual(hud.hudRepeatAllowed(seen, 'NICE!', 2500), true);
  // Numbers do not make a new kind.
  assert.strictEqual(hud.hudPopKind('-15% SPEED'), hud.hudPopKind('-8% SPEED'));
  assert.strictEqual(hud.hudPopKind('PERFECT x4!'), hud.hudPopKind('PERFECT x5!'));
  assert.notStrictEqual(hud.hudPopKind('WALL KICK!'), hud.hudPopKind('WARP!'));
  // Penalties merge into the bigger one (capped), anything else reads as the newer label.
  assert.strictEqual(hud.hudMergePopLabel('-15% SPEED', '-10% SPEED'), '-15% SPEED');
  assert.strictEqual(hud.hudMergePopLabel('-15% SPEED', '-30% SPEED'), '-30% SPEED');
  assert.strictEqual(hud.hudMergePopLabel('-95% SPEED', '-50% SPEED'), '-' + R.maxPenalty + '% SPEED');
  assert.strictEqual(hud.hudMergePopLabel('PERFECT x4!', 'PERFECT x5!'), 'PERFECT x5!');
  assert.strictEqual(hud.hudMergePopLabel('WALL KICK!', 'WALL KICK!'), 'WALL KICK!');
});

test('owned-card strip only greys with a planet body on it; the score note likewise', () => {
  const L = hud.HUD_CARDS;
  const row = hud.hudCardStripRect(7);
  assert.ok(L.under >= 0.4 && L.under <= 0.6);
  // A planet in the play field below the strip (even a big ringed one) leaves it alone.
  assert.strictEqual(hud.hudCirclesUnder(row, [{ x: 450, y: 320, r: 100 }], 0), false);
  assert.strictEqual(hud.hudCirclesUnder(row, [{ x: 450, y: 150, r: 40 }], 0), true);
  const N = hud.HUD_NOTE;
  assert.ok(N.paper.left > N.rect.left && N.paper.bottom < N.rect.bottom);
  assert.strictEqual(hud.hudCirclesUnder(N.paper, [{ x: 200, y: 280, r: 50 }], 0), false, 'body clear of the paper');
  assert.strictEqual(hud.hudCirclesUnder(N.paper, [{ x: 200, y: 250, r: 50 }], 0), true, 'body on the paper');
});

test('loss pops: one family, at most once per 2 s, whatever the number', () => {
  const G = hud.HUD_POP_GATE;
  assert.ok(G.lossMs >= 2000);
  assert.ok(hud.hudIsLossPop('-30% SPEED') && hud.hudIsLossPop('-15% speed') && hud.hudIsLossPop(' -8%SPEED'));
  assert.ok(!hud.hudIsLossPop('+SPEED') && !hud.hudIsLossPop('SHATTER! +SPEED') && !hud.hudIsLossPop('PERFECT!'));
  const gate = { lossAt: -1e9, newAt: -1e9 };
  assert.strictEqual(hud.hudPopGate(gate, '-30% SPEED', hud.POP_LOW, 1000).act, 'show');
  hud.hudPopGateRecord(gate, '-30% SPEED', 1000, false);
  // Another number is the same family: dropped 0.93 s and 1.29 s later (the old exact-string gate let these through).
  assert.strictEqual(hud.hudPopGate(gate, '-15% SPEED', hud.POP_LOW, 1930).act, 'drop');
  assert.strictEqual(hud.hudPopGate(gate, '-30% SPEED', hud.POP_LOW, 2290).act, 'drop');
  assert.strictEqual(hud.hudPopGate(gate, '-30% SPEED', hud.POP_LOW, 1000 + G.lossMs).act, 'show');
  // A merge into the live line restarts the family gate but is not a new line.
  hud.hudPopGateRecord(gate, '-30% SPEED', 1500, true);
  assert.strictEqual(gate.newAt, 1000);
  assert.strictEqual(hud.hudPopGate(gate, '-20% SPEED', hud.POP_LOW, 1000 + G.lossMs).act, 'drop');
  assert.strictEqual(hud.hudPopGate(gate, '-20% SPEED', hud.POP_LOW, 1500 + G.lossMs).act, 'show');
});

test('at most one new pop line per 0.25 s: high pops wait for the gap, the rest are dropped', () => {
  const G = hud.HUD_POP_GATE;
  assert.strictEqual(G.newMs, 250);
  const gate = { lossAt: -1e9, newAt: -1e9 };
  hud.hudPopGateRecord(gate, 'PERFECT!', 5000, false);
  assert.strictEqual(hud.hudPopGate(gate, '+SPEED', hud.POP_LOW, 5070).act, 'drop');
  assert.strictEqual(hud.hudPopGate(gate, 'PERFECT!', hud.POP_MEDIUM, 5100).act, 'drop');
  const d = hud.hudPopGate(gate, 'CLOSE CALL!', hud.POP_HIGH, 5070);
  assert.strictEqual(d.act, 'defer');
  assert.strictEqual(d.at, 5000 + G.newMs);
  assert.strictEqual(hud.hudPopGate(gate, '+SPEED', hud.POP_LOW, 5000 + G.newMs).act, 'show');
  // Junk gate state never blocks.
  assert.strictEqual(hud.hudPopGate({}, '+SPEED', hud.POP_LOW, 10).act, 'show');
  assert.strictEqual(hud.hudPopGate(null, '-10% SPEED', hud.POP_LOW, 10).act, 'show');
});

test('card name pops map to their card (written at most twice a run, then the icon flashes)', () => {
  const cards = [{ id: 'sling', name: 'Slingshot' }, { id: 'wallkick', name: 'Wall Kick' }];
  assert.strictEqual(hud.hudCardIdForPop('SLINGSHOT!', cards), 'sling');
  assert.strictEqual(hud.hudCardIdForPop('WALL KICK!', cards), 'wallkick');
  assert.strictEqual(hud.hudCardIdForPop('SHATTER! +SPEED', cards), null);
  assert.strictEqual(hud.hudCardIdForPop('+SPEED', null), null);
  assert.strictEqual(hud.HUD_POP_GATE.namedMax, 2, 'the pick pop counts as the first of the two');
});

test('paper scraps sit behind the km/s + MACH block and the x-loop, torn but bounded', () => {
  const S = hud.HUD_SCRAP;
  assert.ok(S.alpha >= 0.8 && S.alpha <= 0.9, '~85% opaque');
  const sp = S.speed;
  // The scrap covers the number, the underline and the MACH line.
  assert.ok(sp.y - sp.h / 2 < hud.HUD_SPEED.y - 20 && sp.y + sp.h / 2 > hud.HUD_SPEED.lineY + hud.HUD_MACH.dy + 10);
  assert.ok(sp.x - sp.w / 2 >= 16 && sp.x + sp.w / 2 <= hud.HUD_PANEL.right);
  assert.ok(sp.y + sp.h / 2 <= 1280 - hud.HUD_SAFE_BOTTOM, 'clear of the bottom browser bar');
  const b = S.badge;
  assert.ok(Math.abs(b.x - hud.HUD_BADGE.x) < 10 && b.x + b.w / 2 <= 720 - 16);
  assert.ok(Math.abs(sp.rot) > 0 && Math.abs(sp.rot) < 0.1 && Math.abs(b.rot) > 0 && Math.abs(b.rot) < 0.1, 'slightly tilted');
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const pts = hud.hudTornScrapPoints(200, 100, S.pad, S.tear, rnd);
  assert.ok(pts.length > 40, 'torn edges have many small steps');
  for (const p of pts) {
    assert.ok(p.x >= S.pad - S.tear && p.x <= S.pad + 200 + S.tear && p.y >= S.pad - S.tear && p.y <= S.pad + 100 + S.tear, 'inside the canvas');
  }
  // Not a plain rectangle: the bottom edge wanders.
  const bottom = pts.filter(p => p.y > S.pad + 100 - S.tear);
  assert.ok(Math.max(...bottom.map(p => p.y)) - Math.min(...bottom.map(p => p.y)) > 2);
});

