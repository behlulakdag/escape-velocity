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

const FONT = 'Arial Black, Arial, sans-serif';

// localStorage anahtarı (her oyun için farklı yap, yoksa başka itch oyunlarıyla çakışabilir)
const STORAGE_KEY = 'escape_velocity_best_score';
