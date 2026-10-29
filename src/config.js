// Oyun genelindeki sabitler. Tema gelince renkleri ve ayarları buradan değiştir.
const GAME_WIDTH = 720;
const GAME_HEIGHT = 1280;

const COLORS = {
  background: 0x1a0f2e,
  primary: 0xffc83d,   // butonlar, vurgular
  accent: 0xff4d6d,    // tehlike, düşmanlar
  player: 0x4dd8ff,
  text: '#ffffff',
  textDark: '#1a0f2e',
};

// Lilita One (OFL, assets/fonts) is bundled locally; Arial Black is the fallback until it loads.
const FONT = '"Lilita One", "Arial Black", Arial, sans-serif';

// ---- Sketchbook style (see CLAUDE.md "Art direction: SKETCHBOOK") ----
// Gel-pen inks and crayons. Hex strings are for Phaser text, numbers for textures/tints.
const UI_INK = {
  cream: 0xf6ecd2, creamHex: '#f6ecd2',      // gel pen on dark paper
  dark: 0x1d1b2f, darkHex: '#1d1b2f',        // ink on light paper / text outlines
  pencil: 0xb9b3c9, pencilHex: '#b9b3c9',    // graphite on dark paper
  pencilDark: 0x5c5870, pencilDarkHex: '#5c5870',
};
const UI_CRAYON = {
  yellow: 0xf7c948, orange: 0xf28c38, red: 0xe5533d, green: 0x8fd16a,
  blue: 0x8cc3e8, purple: 0xb48ad8, pink: 0xe88fb4, note: 0xefe3c4,
};
const uiColorHex = (n) => '#' + n.toString(16).padStart(6, '0');
// The game still passes its old neon pop colors; the HUD writes them in the matching crayon.
const UI_CRAYON_REMAP = {
  '#ffe14d': uiColorHex(UI_CRAYON.yellow), '#5eff8f': uiColorHex(UI_CRAYON.green), '#ff4d6d': uiColorHex(UI_CRAYON.red),
  '#ff9a2e': uiColorHex(UI_CRAYON.orange), '#8fe3ff': uiColorHex(UI_CRAYON.blue), '#c77dff': uiColorHex(UI_CRAYON.purple),
  '#c9c3e6': UI_INK.pencilHex, '#ffffff': UI_INK.creamHex, '#1a1033': UI_INK.darkHex, '#c2410c': '#9a3412',
};
function uiCrayonHex(color) {
  return UI_CRAYON_REMAP[String(color).toLowerCase()] || color;
}
// Paper per zone (index = ZONES index). light: the page is pale, so page ink turns dark.
const UI_PAPERS = [
  { paper: 0x1f2a4a, light: false },   // LIFTOFF: navy construction paper
  { paper: 0x173f45, light: false },   // ORBIT: deep teal
  { paper: 0x4a1d22, light: false },   // HYPERSONIC: maroon
  { paper: 0x131218, light: false },   // WARP SPEED: near-black
  { paper: 0x3a2656, light: false },   // HYPERSPACE: purple graph paper
  { paper: 0xe9dcb6, light: true },    // ESCAPE VELOCITY: warm cream
];

// localStorage anahtarı (her oyun için farklı yap, yoksa başka itch oyunlarıyla çakışabilir)
const STORAGE_KEY = 'escape_velocity_best_score';
