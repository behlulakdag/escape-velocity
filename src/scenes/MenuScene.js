// Title screen: a living mini-scene (comet orbiting a happy planet, supernova peeking from
// below) drawn with the same ART functions as the game, so the menu sells the real look.
class MenuScene extends Phaser.Scene {
  constructor() {
    super('Menu');
  }

  create() {
    const cx = GAME_WIDTH / 2;
    this.cameras.main.setBackgroundColor(ZONES[0].sky);
    addStarLayers(this);

    this.worldGfx = this.add.graphics();
    this.cometGfx = this.add.graphics();
    this.hero = { x: cx, y: 690, radius: 85, color: 0xc77dff, hasRing: true, craters: makeMenuCraters(85) };
    this.sidePlanets = [
      { x: 610, y: 500, radius: 38, color: 0x5ee6a8, hasRing: false, craters: makeMenuCraters(38) },
      { x: 105, y: 880, radius: 46, color: 0xffb347, hasRing: false, craters: makeMenuCraters(46) },
    ];
    this.comet = { x: cx, y: 520, vx: 0, vy: -1 };
    this.trail = [];
    this.orbitAngle = -Math.PI / 2;

    this.titleLetters = [
      ...makeTitleWord(this, 'ESCAPE', 205, 92, '#ffffff'),
      ...makeTitleWord(this, 'VELOCITY', 315, 90, '#ffe14d'),
    ];
    this.add.text(cx, 405, 'Speed is your life', {
      fontFamily: FONT, fontSize: '36px', color: '#ff9ad5', stroke: '#1a1033', strokeThickness: 8,
    }).setOrigin(0.5);

    const play = makeButton(this, cx, 995, 'PLAY', () => this.scene.start('Game'), {
      width: 440, height: 130, fontSize: '64px',
    });
    this.tweens.add({ targets: play, scale: 1.05, yoyo: true, repeat: -1, duration: 600, ease: 'Sine.easeInOut' });

    const best = loadHighScore();
    if (best > 0) {
      this.add.text(cx, 1108, 'BEST  ' + best, {
        fontFamily: FONT, fontSize: '40px', color: '#ffe14d', stroke: '#1a1033', strokeThickness: 8,
      }).setOrigin(0.5);
    }
    this.add.text(cx, 1172, 'HOLD near a planet to orbit - RELEASE to fling\noutrun the supernova!', {
      fontFamily: FONT, fontSize: '26px', color: '#ffffff', align: 'center', stroke: '#1a1033', strokeThickness: 7,
    }).setOrigin(0.5).setDepth(5);

    makeMuteButton(this, 92, 116);
    addFullscreenButton(this);
    this.input.keyboard.on('keydown-SPACE', () => this.scene.start('Game'));
  }

  update(time, delta) {
    const t = time / 1000;
    scrollStarLayers(this, delta, 0.06);
    bobTitle(this.titleLetters, t);

    // Comet on a slightly squashed orbit around the hero planet.
    this.orbitAngle += (delta / 1000) * 2.1;
    const orbitR = 178;
    this.comet.x = this.hero.x + Math.cos(this.orbitAngle) * orbitR;
    this.comet.y = this.hero.y + Math.sin(this.orbitAngle) * orbitR * 0.92;
    this.trail.unshift({ x: this.comet.x, y: this.comet.y });
    if (this.trail.length > 22) this.trail.length = 22;

    const ctx = {
      time: t, comet: this.comet, speed: 900, speedFraction: 0.62, orbitPlanet: this.hero,
      isHolding: true, danger: 0.15, stretch: 1.12, perfectChain: 0, closeCall: 0,
    };
    const g = this.worldGfx;
    g.clear();
    drawSpeedStreaks(g, t);
    for (const p of this.sidePlanets) ART.drawPlanet(g, p, false, false, ctx);
    ART.drawPlanet(g, this.hero, true, false, ctx);
    ART.drawNova(g, 1238, { left: 0, right: GAME_WIDTH, top: 0, bottom: GAME_HEIGHT }, ctx);
    this.cometGfx.clear();
    ART.drawComet(this.cometGfx, this.comet, this.trail, ctx);
  }
}

// ---- helpers shared by Menu / GameOver / Boot ----

function makeMenuCraters(radius) {
  return [0.6, 2.4, 4.4].map((a, i) => ({ a, d: radius * (0.35 + i * 0.07), r: radius * (0.13 + i * 0.03) }));
}

// Parallax star layers built from ART.makeStarTexture.
function addStarLayers(scene) {
  if (!scene.textures.exists('stars')) ART.makeStarTexture(scene, 'stars');
  scene.starLayers = [
    { sprite: scene.add.tileSprite(0, 0, GAME_WIDTH, GAME_HEIGHT, 'stars_nebula').setOrigin(0).setAlpha(0.9), speed: 0.15 },
    { sprite: scene.add.tileSprite(0, 0, GAME_WIDTH, GAME_HEIGHT, 'stars').setOrigin(0).setAlpha(0.5), speed: 0.35 },
    { sprite: scene.add.tileSprite(0, 0, GAME_WIDTH, GAME_HEIGHT, 'stars').setOrigin(0).setTileScale(1.6), speed: 0.7 },
    { sprite: scene.add.tileSprite(0, 0, GAME_WIDTH, GAME_HEIGHT, 'stars_sparkle').setOrigin(0), speed: 1 },
  ];
}

function scrollStarLayers(scene, delta, rate) {
  for (const layer of scene.starLayers) layer.sprite.tilePositionY -= delta * rate * layer.speed;
}

// Title as separate letters so they can bob in a wave; each letter has a thick outline + drop shadow.
function makeTitleWord(scene, word, y, size, color) {
  const letters = [];
  // Proportional spacing: measure each glyph so narrow letters like "I" do not leave gaps.
  for (let i = 0; i < word.length; i++) {
    const letter = scene.add.text(0, y, word[i], {
      fontFamily: FONT, fontSize: size + 'px', color, stroke: '#1a1033', strokeThickness: 16,
    }).setOrigin(0.5).setShadow(0, 10, '#1a1033', 0, true, true);
    letters.push(letter);
  }
  const overlap = 14;   // strokes may touch so the word reads as one chunky logo
  const widths = letters.map((l) => l.width - overlap);
  let x = GAME_WIDTH / 2 - widths.reduce((a, b) => a + b, 0) / 2;
  letters.forEach((letter, i) => {
    letter.x = x + widths[i] / 2;
    x += widths[i];
    letter.baseY = y;
    letter.index = i + (color === '#ffffff' ? 0 : 6);
    letter.setScale(0);
    scene.tweens.add({ targets: letter, scale: 1, duration: 420, delay: 60 * letter.index, ease: 'Back.easeOut' });
  });
  return letters;
}

function bobTitle(letters, t) {
  for (const letter of letters) {
    letter.y = letter.baseY + Math.sin(t * 3 - letter.index * 0.45) * 8;
    letter.rotation = Math.sin(t * 2 - letter.index * 0.6) * 0.05;
  }
}

// Vertical speed streaks rushing down the screen (sells "going up fast").
function drawSpeedStreaks(g, t) {
  for (let i = 0; i < 9; i++) {
    const x = ((i * 173) % GAME_WIDTH) + 20;
    const life = (t * (0.6 + (i % 3) * 0.25) + i * 0.31) % 1;
    const y = -200 + life * (GAME_HEIGHT + 400);
    g.lineStyle(i % 2 ? 3 : 5, 0xffffff, 0.12);
    g.lineBetween(x, y, x, y + 120 + (i % 3) * 60);
  }
}
