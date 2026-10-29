// AUDIO: procedural sound effects + adaptive music, Web Audio API only (no files).
//
// Public API (global AUDIO):
//   AUDIO.init(game)      hook game.events 'sfx' (called automatically once `game` exists)
//   AUDIO.toggleMute()    -> true when now muted (persisted in localStorage)
//   AUDIO.isMuted()       -> boolean
//   AUDIO.play(name, data) play one event directly (same as game.events.emit('sfx', name, data))
//   AUDIO.debug()         -> { state, voices, mode, bpm, cutoff, danger } for testing
//
// Sound events, received as game.events.emit('sfx', name, data):
//   click {}               UI button tap
//   start {}               a run begins
//   intro {}               opening scene starts: deep rumble + rising whine
//   launch {}              opening scene ends: big explosion whoosh, music kicks in
//   grab {close:boolean}   lock-on blip; extra sparkle when close
//   release {speedFraction} fling whoosh, brighter/higher with speed
//   perfect {chain:int}    chime, one scale step higher per chain level (capped)
//   hit {}                 asteroid: dull thud + crunch
//   wall {}                very subtle tick, rate-limited (fires hundreds of times)
//   warp {}                black hole core: wobbly pitch-bend zap
//   zone {index}           short triumphant arpeggio
//   closecall {}           heartbeat hit + rising swell
//   newbest {}             fanfare
//   gameover {reason}      explosion + falling tone, music ducks
//   speedup {level}        short riser
// Unknown event names are ignored.
//
// Music follows the game by polling game.scene.keys.Game each scheduler tick:
// tempo and filter brightness rise with speedFraction(speed); a heartbeat + drone
// layer fades in with supernova danger; a calm version plays on the menu.
const AUDIO = (() => {
  const MUTE_KEY = 'escape_velocity_muted';
  const MAX_VOICES = 16;               // sound effects
  const MAX_MUSIC_VOICES = 18;         // music has its own pool so it never starves sfx
  const WALL_MIN_GAP = 0.18;           // seconds between wall ticks
  const LOOKAHEAD = 0.12;              // seconds of music scheduled ahead
  const TICK_MS = 25;

  // Mix levels. The music bus gain is owned by the scheduler (see updateMusicLevel), which
  // always steers back to MUSIC_LEVEL, so ducks can never leave the music permanently quieter.
  const MASTER_LEVEL = 0.8;
  const SFX_LEVEL = 0.9;
  const MUSIC_LEVEL = 0.38;
  const MUSIC_DUCKED = 0.03;           // during the game-over blast
  const DUCK_HOLD = 0.35;              // seconds held down before recovering
  const DUCK_RECOVER_TC = 0.45;        // time constant of the recovery (~2.2 s to full)
  const SLOWMO_DUCK = 0.6;             // music multiplier during close-call slow motion
  const DRONE_MAX = 0.25;              // danger drone (routed through the music bus)
  // Smoothing time constants (seconds) so tempo/brightness glide instead of jumping.
  const INTENSITY_TAU = 0.6;
  const DANGER_TAU = 0.3;
  const BPM_TAU = 1.0;
  const VOICE_KILL_TC = 0.03;          // fast fade used when cutting voices (mute, launch, hide)

  // A natural minor, as semitone offsets from A2 (110 Hz).
  const SCALE = [0, 2, 3, 5, 7, 8, 10];
  // i - VI - III - VII (Am F C G): root offsets and triad tones in semitones from A.
  const PROGRESSION = [
    { root: 0, chord: [0, 3, 7] },
    { root: -4, chord: [-4, 0, 3] },
    { root: 3, chord: [3, 7, 10] },
    { root: -2, chord: [-2, 2, 5] },
  ];

  let ctx = null;
  let master = null, sfxBus = null, musicBus = null, musicFilter = null;
  let droneGain = null, droneOscs = [];
  let noiseBuffer = null;
  let gameRef = null;
  let muted = loadMuted();
  let unlocked = false;
  let voices = 0;
  let musicVoices = 0;
  let lastWall = 0;
  const lastPlayed = {};
  const SAME_EVENT_GAP = 0.04;

  // Music state
  let schedulerId = null;
  let nextStepTime = 0;
  let step = 0;                 // 16th-note counter
  let mode = 'menu';            // 'menu' | 'intro' | 'game' | 'over'
  let bpm = 92;
  let intensity = 0;            // smoothed speed fraction
  let danger = 0;               // smoothed danger
  let introActive = false;
  let lastTickTime = 0;
  let duckAt = -1e9;            // ctx time of the last game-over duck
  let arpFast = false;          // latched at bar starts so the arp never changes mid-bar
  let hatFast = false;
  let slowMo = false;
  // Every live one-shot voice: { src, env, tag }. Lets mute/launch/hide fade notes out
  // instead of leaving them ringing (a 2 s pad would otherwise survive a mute toggle).
  const activeVoices = new Set();

  function loadMuted() {
    try { return localStorage.getItem(MUTE_KEY) === '1'; } catch (e) { return false; }
  }
  function saveMuted() {
    try { localStorage.setItem(MUTE_KEY, muted ? '1' : '0'); } catch (e) { /* storage blocked */ }
  }

  function midiHz(semisFromA2) { return 110 * Math.pow(2, semisFromA2 / 12); }
  function scaleNote(degree) {
    const oct = Math.floor(degree / SCALE.length);
    const idx = ((degree % SCALE.length) + SCALE.length) % SCALE.length;
    return SCALE[idx] + 12 * oct;
  }
  function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }

  // ---------- context ----------

  function createContext() {
    if (ctx) return ctx;
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) return null;
    try {
      ctx = new Ctor();
    } catch (e) { ctx = null; return null; }

    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -8;
    limiter.knee.value = 4;
    limiter.ratio.value = 20;          // maximum ratio: acts as a peak limiter on big blasts
    limiter.attack.value = 0.002;
    limiter.release.value = 0.2;
    limiter.connect(ctx.destination);

    master = ctx.createGain();
    master.gain.value = muted ? 0 : MASTER_LEVEL;
    master.connect(limiter);

    sfxBus = ctx.createGain();
    sfxBus.gain.value = SFX_LEVEL;
    sfxBus.connect(master);

    musicFilter = ctx.createBiquadFilter();
    musicFilter.type = 'lowpass';
    musicFilter.frequency.value = 900;
    musicFilter.Q.value = 0.8;
    musicBus = ctx.createGain();
    musicBus.gain.value = MUSIC_LEVEL;
    musicFilter.connect(musicBus);
    musicBus.connect(master);

    // Noise buffer reused by every noisy sound.
    noiseBuffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;

    // Persistent danger drone: two detuned low saws through a lowpass, gain follows danger.
    // It goes through the music bus so it ducks with the rest of the music.
    droneGain = ctx.createGain();
    droneGain.gain.value = 0;
    const droneFilter = ctx.createBiquadFilter();
    droneFilter.type = 'lowpass';
    droneFilter.frequency.value = 260;
    droneFilter.connect(droneGain);
    droneGain.connect(musicBus);
    [55, 55.6, 82.4].forEach((f) => {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f;
      o.connect(droneFilter);
      o.start();
      droneOscs.push(o);
    });
    return ctx;
  }

  function unlock() {
    if (!createContext()) return;
    const firstUnlock = !unlocked;
    unlocked = true;
    if (ctx.state !== 'running' && !document.hidden) resumeAudio();
    if (firstUnlock) {
      // iOS needs a sound started inside the gesture to fully unlock.
      try {
        const b = ctx.createBufferSource();
        b.buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
        b.connect(ctx.destination);
        b.start(0);
      } catch (e) { /* ignore */ }
      startMusic();
    }
  }

  function canPlay() {
    return ctx && unlocked && !muted && ctx.state === 'running';
  }

  // ---------- voice helpers ----------

  // Counts a one-shot voice and cleans it up when it ends. Returns false if over the cap.
  function claimVoice(src, env, nodes, bus, tag) {
    const isMusic = bus === musicFilter || bus === musicBus;
    if (isMusic ? musicVoices >= MAX_MUSIC_VOICES : voices >= MAX_VOICES) return false;
    if (isMusic) musicVoices++; else voices++;
    const voice = { src, env, tag: tag || (isMusic ? 'music' : 'sfx') };
    activeVoices.add(voice);
    src.onended = () => {
      if (isMusic) musicVoices--; else voices--;
      activeVoices.delete(voice);
      nodes.forEach((n) => { try { n.disconnect(); } catch (e) { /* already gone */ } });
    };
    return true;
  }

  // Fades the matching live voices to silence in ~0.1 s and stops them shortly after.
  // `which` is a tag ('intro', 'music', 'sfx') or null for every voice.
  function killVoices(which) {
    if (!ctx) return 0;
    const t = ctx.currentTime;
    let n = 0;
    activeVoices.forEach((v) => {
      if (which && v.tag !== which) return;
      if (v.killed) return;
      v.killed = true;
      n++;
      try {
        const g = v.env.gain;
        if (g.cancelAndHoldAtTime) {
          g.cancelAndHoldAtTime(t);
        } else {
          const cur = g.value;
          g.cancelScheduledValues(t);
          g.setValueAtTime(cur, t);
        }
        g.setTargetAtTime(0, t, VOICE_KILL_TC);
        v.src.stop(t + VOICE_KILL_TC * 6);
      } catch (e) { /* already stopped */ }
    });
    return n;
  }

  function countVoices(which) {
    let n = 0;
    activeVoices.forEach((v) => { if (!v.killed && (!which || v.tag === which)) n++; });
    return n;
  }

  // Oscillator with an attack/decay envelope and optional pitch glide and filter.
  function tone(o) {
    const t = (o.at !== undefined ? o.at : ctx.currentTime) + (o.delay || 0);
    const dur = o.dur || 0.2;
    const osc = ctx.createOscillator();
    const env = ctx.createGain();
    const nodes = [osc, env];
    if (!claimVoice(osc, env, nodes, o.bus, o.tag)) return;
    osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(o.freq, t);
    if (o.freqEnd) osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.freqEnd), t + (o.glide || dur));
    if (o.detune) osc.detune.value = o.detune;
    const peak = o.gain || 0.3;
    const atk = o.attack || 0.005;
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(peak, t + atk);
    env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    let head = osc;
    if (o.filter) {
      const f = ctx.createBiquadFilter();
      f.type = o.filter;
      f.frequency.setValueAtTime(o.cutoff || 2000, t);
      if (o.cutoffEnd) f.frequency.exponentialRampToValueAtTime(o.cutoffEnd, t + dur);
      f.Q.value = o.q || 1;
      head.connect(f);
      head = f;
      nodes.push(f);
    }
    head.connect(env);
    env.connect(o.bus || sfxBus);
    osc.start(t);
    osc.stop(t + dur + 0.05);
    return osc;
  }

  // Filtered noise burst.
  function noise(o) {
    const t = (o.at !== undefined ? o.at : ctx.currentTime) + (o.delay || 0);
    const dur = o.dur || 0.2;
    const src = ctx.createBufferSource();
    const f = ctx.createBiquadFilter();
    const env = ctx.createGain();
    const nodes = [src, f, env];
    if (!claimVoice(src, env, nodes, o.bus, o.tag)) return;
    src.buffer = noiseBuffer;
    src.loop = true;
    f.type = o.filter || 'lowpass';
    f.frequency.setValueAtTime(o.cutoff || 1200, t);
    if (o.cutoffEnd) f.frequency.exponentialRampToValueAtTime(o.cutoffEnd, t + dur);
    f.Q.value = o.q || 0.7;
    const peak = o.gain || 0.3;
    const atk = o.attack || 0.004;
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(peak, t + atk);
    env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f);
    f.connect(env);
    env.connect(o.bus || sfxBus);
    src.start(t, Math.random() * 1.5);
    src.stop(t + dur + 0.05);
  }

  // ---------- sound effects ----------

  const SFX = {
    click() {
      tone({ type: 'square', freq: 1200, freqEnd: 800, dur: 0.06, gain: 0.08, filter: 'lowpass', cutoff: 3000 });
      tone({ type: 'sine', freq: 600, dur: 0.08, gain: 0.12 });
    },
    start() {
      tone({ type: 'triangle', freq: midiHz(12), freqEnd: midiHz(24), dur: 0.35, gain: 0.18, glide: 0.25 });
      noise({ filter: 'bandpass', cutoff: 600, cutoffEnd: 4000, dur: 0.4, gain: 0.12, attack: 0.1 });
    },
    intro() {
      // Deep rumble + climbing whine that peak right at the star blast (GameScene explodes at
      // 1.7 s and launches at 2.1 s). Tagged 'intro' so launch/skip can fade them out at once;
      // the short tail only matters if launch never arrives.
      const tag = 'intro';
      noise({ tag, filter: 'lowpass', cutoff: 120, cutoffEnd: 420, dur: 2.5, gain: 0.42, attack: 1.8, q: 4 });
      tone({ tag, type: 'sawtooth', freq: 40, freqEnd: 70, glide: 1.85, dur: 2.5, gain: 0.22, attack: 1.75, filter: 'lowpass', cutoff: 200 });
      tone({ tag, type: 'sine', freq: 300, freqEnd: 2400, dur: 2.4, glide: 1.9, gain: 0.07, attack: 1.85 });
      tone({ tag, type: 'sine', freq: 305, freqEnd: 2430, dur: 2.4, glide: 1.9, gain: 0.05, attack: 1.85 });
    },
    launch() {
      noise({ filter: 'lowpass', cutoff: 3000, cutoffEnd: 80, dur: 1.6, gain: 0.55, attack: 0.005 });
      noise({ filter: 'bandpass', cutoff: 400, cutoffEnd: 5000, dur: 0.9, gain: 0.28, attack: 0.15, q: 1.5 });
      tone({ type: 'sine', freq: 110, freqEnd: 30, dur: 0.9, gain: 0.55 });
      tone({ type: 'sawtooth', freq: midiHz(12), freqEnd: midiHz(36), dur: 0.6, glide: 0.5, gain: 0.12, filter: 'lowpass', cutoff: 800, cutoffEnd: 6000 });
    },
    grab(d) {
      const base = midiHz(24 + 7);   // E4
      tone({ type: 'square', freq: base, dur: 0.07, gain: 0.08, filter: 'lowpass', cutoff: 2500 });
      tone({ type: 'sine', freq: base * 1.5, delay: 0.05, dur: 0.14, gain: 0.16 });
      tone({ type: 'sine', freq: 90, freqEnd: 60, dur: 0.12, gain: 0.25 });
      if (d && d.close) {
        [0, 1, 2].forEach((i) => tone({ type: 'triangle', freq: base * [2, 2.5, 3][i], delay: 0.08 + i * 0.04, dur: 0.18, gain: 0.07 }));
      }
    },
    release(d) {
      const s = clamp01(d && d.speedFraction !== undefined ? d.speedFraction : 0.3);
      noise({ filter: 'bandpass', cutoff: 500 + s * 1500, cutoffEnd: 2000 + s * 6000, dur: 0.3 + s * 0.15, gain: 0.22 + s * 0.12, attack: 0.03, q: 1.2 });
      tone({ type: 'sawtooth', freq: 140 + s * 200, freqEnd: 400 + s * 900, dur: 0.25, gain: 0.06, filter: 'lowpass', cutoff: 1500 + s * 4000 });
    },
    perfect(d) {
      const chain = Math.min(8, Math.max(1, (d && d.chain) || 1));
      const deg = 7 + chain;                 // one scale step higher per chain level
      const f = midiHz(12 + scaleNote(deg));
      tone({ type: 'sine', freq: f, dur: 0.5, gain: 0.22 });
      tone({ type: 'triangle', freq: f * 2, dur: 0.35, gain: 0.08 });
      tone({ type: 'sine', freq: f * 1.5, delay: 0.07, dur: 0.45, gain: 0.12 });
      tone({ type: 'sine', freq: f * 3, delay: 0.12, dur: 0.3, gain: 0.04 + chain * 0.006 });
      noise({ filter: 'highpass', cutoff: 6000, dur: 0.15, gain: 0.06 });
    },
    hit() {
      tone({ type: 'sine', freq: 120, freqEnd: 40, dur: 0.25, gain: 0.5 });
      noise({ filter: 'lowpass', cutoff: 1800, cutoffEnd: 200, dur: 0.22, gain: 0.38 });
      noise({ filter: 'bandpass', cutoff: 3000, dur: 0.08, gain: 0.2, q: 2, delay: 0.01 });
    },
    wall() {
      const now = ctx.currentTime;
      if (now - lastWall < WALL_MIN_GAP) return;
      lastWall = now;
      tone({ type: 'triangle', freq: 2200 + Math.random() * 400, dur: 0.035, gain: 0.02 });
    },
    warp() {
      const osc = tone({ type: 'sawtooth', freq: 600, freqEnd: 90, dur: 0.6, glide: 0.55, gain: 0.14, filter: 'lowpass', cutoff: 3000, cutoffEnd: 300, q: 6 });
      if (osc) {
        // Wobble the pitch with a fast LFO for the warped feel.
        const lfo = ctx.createOscillator();
        const depth = ctx.createGain();
        lfo.frequency.value = 14;
        depth.gain.value = 600;
        lfo.connect(depth);
        depth.connect(osc.detune);
        lfo.start();
        lfo.stop(ctx.currentTime + 0.65);
        lfo.onended = () => { try { lfo.disconnect(); depth.disconnect(); } catch (e) { /* gone */ } };
      }
      tone({ type: 'sine', freq: 50, freqEnd: 140, dur: 0.5, gain: 0.3 });
    },
    zone(d) {
      const lift = Math.min(4, (d && d.index) || 0);
      [0, 2, 4, 7].forEach((deg, i) => {
        const f = midiHz(12 + scaleNote(deg + lift));
        tone({ type: 'square', freq: f, delay: i * 0.08, dur: 0.22, gain: 0.07, filter: 'lowpass', cutoff: 3200 });
        tone({ type: 'triangle', freq: f * 2, delay: i * 0.08, dur: 0.25, gain: 0.06 });
      });
      tone({ type: 'sawtooth', freq: midiHz(24 + scaleNote(7 + lift)), delay: 0.32, dur: 0.6, gain: 0.07, filter: 'lowpass', cutoff: 2500, cutoffEnd: 800 });
    },
    closecall() {
      tone({ type: 'sine', freq: 70, freqEnd: 45, dur: 0.18, gain: 0.5 });
      tone({ type: 'sine', freq: 70, freqEnd: 45, dur: 0.2, gain: 0.38, delay: 0.2 });
      noise({ filter: 'bandpass', cutoff: 400, cutoffEnd: 5000, dur: 0.7, gain: 0.18, attack: 0.5, q: 1.5, delay: 0.1 });
      tone({ type: 'sawtooth', freq: 220, freqEnd: 880, dur: 0.75, glide: 0.7, gain: 0.05, attack: 0.5, filter: 'lowpass', cutoff: 2000, delay: 0.1 });
    },
    newbest() {
      const notes = [0, 4, 7, 12, 11, 12];       // A C# E A G# A (major, triumphant)
      const times = [0, 0.1, 0.2, 0.3, 0.5, 0.6];
      notes.forEach((n, i) => {
        tone({ type: 'square', freq: midiHz(24 + n), delay: times[i], dur: i === notes.length - 1 ? 0.8 : 0.16, gain: 0.07, filter: 'lowpass', cutoff: 3500 });
        tone({ type: 'triangle', freq: midiHz(12 + n), delay: times[i], dur: 0.2, gain: 0.08 });
      });
      noise({ filter: 'highpass', cutoff: 7000, dur: 0.9, gain: 0.05, delay: 0.6, attack: 0.05 });
    },
    gameover() {
      noise({ filter: 'lowpass', cutoff: 2500, cutoffEnd: 60, dur: 1.4, gain: 0.55 });
      tone({ type: 'sine', freq: 90, freqEnd: 25, dur: 1.0, gain: 0.55 });
      tone({ type: 'sawtooth', freq: midiHz(24), freqEnd: midiHz(0), dur: 1.4, glide: 1.3, gain: 0.08, filter: 'lowpass', cutoff: 2000, cutoffEnd: 300, delay: 0.15 });
      duckMusic();
    },
    speedup(d) {
      const lvl = Math.min(6, (d && d.level) || 1);
      noise({ filter: 'bandpass', cutoff: 800, cutoffEnd: 6000 + lvl * 500, dur: 0.45, gain: 0.12, attack: 0.35, q: 2 });
      tone({ type: 'triangle', freq: midiHz(12 + scaleNote(lvl)), freqEnd: midiHz(24 + scaleNote(lvl)), dur: 0.4, gain: 0.06, attack: 0.3 });
    },
  };

  function play(name, data) {
    // The intro build-up must end the moment gameplay starts (launch at 2.1 s or tap-skip),
    // even when muted or over the voice cap, so this runs before the canPlay checks.
    if (name === 'intro' || name === 'launch' || name === 'gameover' || name === 'start') killVoices('intro');
    if (name === 'intro') introActive = true;
    if (name === 'launch' || name === 'gameover') introActive = false;
    const fn = SFX[name];
    if (!fn || !canPlay() || voices >= MAX_VOICES) return;
    // The same event twice within a few ms sounds like one louder click; skip the repeat.
    const now = ctx.currentTime;
    if (now - (lastPlayed[name] || -1) < SAME_EVENT_GAP) return;
    lastPlayed[name] = now;
    try { fn(data || {}); } catch (e) { /* never let audio break the game */ }
  }

  // Starts a game-over duck; updateMusicLevel() does the actual gain moves each tick.
  function duckMusic() {
    if (!ctx) return;
    duckAt = ctx.currentTime;
    updateMusicLevel(duckAt);
  }

  // Single owner of musicBus.gain: base level, game-over duck, slow-motion dip.
  function updateMusicLevel(now) {
    if (!musicBus) return;
    const sinceDuck = now - duckAt;
    let target = MUSIC_LEVEL * (slowMo ? SLOWMO_DUCK : 1);
    let tc = 0.25;
    if (sinceDuck >= 0 && sinceDuck < DUCK_HOLD) { target = MUSIC_DUCKED; tc = 0.04; }
    else if (sinceDuck >= 0 && sinceDuck < DUCK_HOLD + 5 * DUCK_RECOVER_TC) tc = DUCK_RECOVER_TC;
    musicBus.gain.cancelScheduledValues(now);
    musicBus.gain.setTargetAtTime(target, now, tc);
  }

  // Frame-rate independent exponential smoothing factor.
  function smoothK(dt, tau) { return 1 - Math.exp(-dt / tau); }

  // ---------- music ----------

  function readGameState() {
    const res = { mode: 'menu', speed: 0, danger: 0, slowMo: false };
    if (!gameRef || !gameRef.scene) return res;
    try {
      const gs = gameRef.scene.keys && gameRef.scene.keys.Game;
      const over = gameRef.scene.keys && gameRef.scene.keys.GameOver;
      if (gs && gameRef.scene.isActive('Game')) {
        if (gs.isOver) { res.mode = 'over'; return res; }
        res.mode = introActive ? 'intro' : 'game';
        res.slowMo = typeof gs.slowMoT === 'number' && gs.slowMoT >= 0;
        if (typeof speedFraction === 'function' && typeof gs.speed === 'number') res.speed = speedFraction(gs.speed);
        if (gs.comet && typeof gs.novaY === 'number') {
          res.danger = clamp01(1 - (gs.novaY - gs.comet.y - 150) / 450);
        }
      } else if (over && gameRef.scene.isActive('GameOver')) {
        res.mode = 'over';
      }
    } catch (e) { /* scene not ready */ }
    return res;
  }

  function startMusic() {
    if (schedulerId || !ctx || !unlocked) return;
    nextStepTime = ctx.currentTime + 0.1;
    lastTickTime = ctx.currentTime;
    schedulerId = setInterval(schedule, TICK_MS);
  }

  function stopMusic() {
    if (schedulerId) clearInterval(schedulerId);
    schedulerId = null;
  }

  function schedule() {
    if (!ctx || ctx.state !== 'running') return;
    const st = readGameState();
    mode = st.mode;
    slowMo = st.slowMo;
    const now = ctx.currentTime;
    // Clamp dt so a long stall (throttled timer) eases in instead of snapping.
    const dt = Math.min(0.1, Math.max(0, now - lastTickTime));
    lastTickTime = now;
    intensity += ((mode === 'game' ? st.speed : 0) - intensity) * smoothK(dt, INTENSITY_TAU);
    danger += ((mode === 'game' ? st.danger : 0) - danger) * smoothK(dt, DANGER_TAU);
    // The intro build-up belongs to the Game scene only; cut it if we left that scene.
    if (mode !== 'intro' && mode !== 'game' && countVoices('intro')) killVoices('intro');

    const targetBpm = mode === 'game' ? 112 + intensity * 40 : mode === 'intro' ? 100 : 88;
    bpm += (targetBpm - bpm) * smoothK(dt, BPM_TAU);
    const cutoff = mode === 'game' ? 900 + intensity * 5500 : mode === 'over' ? 500 : 1100;
    musicFilter.frequency.setTargetAtTime(cutoff, now, 0.25);
    droneGain.gain.setTargetAtTime(muted ? 0 : danger * DRONE_MAX, now, 0.3);
    updateMusicLevel(now);

    if (muted) { nextStepTime = now + 0.05; return; }
    if (nextStepTime < now - 0.2) nextStepTime = now + 0.02;   // recover after a stall
    while (nextStepTime < now + LOOKAHEAD) {
      playStep(step, nextStepTime);
      nextStepTime += 60 / bpm / 4;
      step++;
    }
  }

  // Voices for music go through musicFilter so the speed-driven brightness applies.
  function playStep(s, t) {
    const bar = Math.floor(s / 16);
    const pos = s % 16;
    const chord = PROGRESSION[bar % PROGRESSION.length];
    const bus = musicFilter;
    const gameOn = mode === 'game';
    const calm = mode === 'menu' || mode === 'over';
    // Density switches use hysteresis and only change on a bar line, so a speed burst
    // never flips the groove mid-phrase or back and forth.
    if (pos === 0) {
      if (intensity > 0.5) arpFast = true; else if (intensity < 0.4) arpFast = false;
      if (intensity > 0.65) hatFast = true; else if (intensity < 0.55) hatFast = false;
    }

    if (mode === 'intro') {
      if (pos % 4 === 0) tone({ at: t, type: 'sine', freq: midiHz(-12), dur: 0.3, gain: 0.25, bus });
      return;
    }

    // Pad: soft chord at the start of each bar (menu/over), shorter stab in game.
    if (pos === 0) {
      chord.chord.forEach((n) => {
        tone({ at: t, type: 'sawtooth', freq: midiHz(12 + n), dur: calm ? 2.2 : 0.9, attack: calm ? 0.4 : 0.02, gain: calm ? 0.035 : 0.025, detune: 7, bus });
        if (calm) tone({ at: t, type: 'sawtooth', freq: midiHz(12 + n), dur: 2.2, attack: 0.4, gain: 0.035, detune: -7, bus });
      });
    }
    if (mode === 'over') return;

    // Bass: eighth-note octave pulse in game, half notes on the menu.
    const bassHz = midiHz(chord.root - 12 + (chord.root < -2 ? 12 : 0));
    if (gameOn && pos % 2 === 0) {
      tone({ at: t, type: 'sawtooth', freq: pos % 4 === 2 ? bassHz * 2 : bassHz, dur: 0.16, gain: 0.16, filter: 'lowpass', cutoff: 500 + intensity * 900, bus });
    } else if (!gameOn && pos % 8 === 0) {
      tone({ at: t, type: 'triangle', freq: bassHz, dur: 0.8, gain: 0.18, bus });
    }

    // Arp: chord tones climbing; 8ths at low speed, 16ths once fast.
    const arpEvery = gameOn ? (arpFast ? 1 : 2) : 4;
    if (pos % arpEvery === 0) {
      const notes = chord.chord.concat(chord.chord.map((n) => n + 12));
      const n = notes[(s / arpEvery) % notes.length | 0];
      tone({ at: t, type: 'square', freq: midiHz(24 + n), dur: 0.12, gain: gameOn ? 0.035 + intensity * 0.02 : 0.025, filter: 'lowpass', cutoff: 2400, bus });
    }

    if (!gameOn) return;
    // Drums
    if (pos % 4 === 0) {   // four-on-the-floor kick
      tone({ at: t, type: 'sine', freq: 150, freqEnd: 45, glide: 0.12, dur: 0.22, gain: 0.45, bus: musicBus });
    }
    if (pos === 4 || pos === 12) {   // snare
      noise({ at: t, filter: 'bandpass', cutoff: 1800, dur: 0.14, gain: 0.12, q: 0.8, bus: musicBus });
      tone({ at: t, type: 'triangle', freq: 220, freqEnd: 160, dur: 0.08, gain: 0.08, bus: musicBus });
    }
    const hatEvery = hatFast ? 1 : 2;
    if (pos % hatEvery === 0 && pos % 4 !== 0) {
      noise({ at: t, filter: 'highpass', cutoff: 8000, dur: 0.04, gain: pos % 2 ? 0.025 : 0.045, bus: musicBus });
    }
    // Heartbeat layer when the supernova is close: lub-dub on beats 1 and 3.
    if (danger > 0.25 && (pos === 0 || pos === 8)) {
      tone({ at: t, type: 'sine', freq: 60, freqEnd: 38, dur: 0.16, gain: 0.5 * danger, bus: musicBus });
      tone({ at: t + 0.16, type: 'sine', freq: 55, freqEnd: 35, dur: 0.16, gain: 0.35 * danger, bus: musicBus });
    }
  }

  // ---------- mute / visibility ----------

  function applyMute() {
    if (!ctx) return;
    const t = ctx.currentTime;
    master.gain.cancelScheduledValues(t);
    master.gain.setTargetAtTime(muted ? 0 : MASTER_LEVEL, t, 0.03);
  }

  function toggleMute() {
    muted = !muted;
    saveMuted();
    // Cut everything already scheduled (pads ring ~2 s, the lookahead holds future notes),
    // so unmuting later never brings back stale notes; the scheduler restarts cleanly.
    if (ctx) {
      killVoices(null);
      nextStepTime = ctx.currentTime + 0.05;
    }
    applyMute();
    return muted;
  }

  let suspendTimer = null;

  // Hidden tab: stop the scheduler, fade everything, then suspend the context.
  function pauseForHidden() {
    stopMusic();
    if (suspendTimer) clearTimeout(suspendTimer);
    if (!ctx) return;
    killVoices(null);
    const t = ctx.currentTime;
    master.gain.cancelScheduledValues(t);
    master.gain.setTargetAtTime(0, t, 0.015);
    // Let the short fade render before suspending (avoids a click).
    suspendTimer = setTimeout(() => {
      suspendTimer = null;
      if (document.hidden && ctx.state === 'running') ctx.suspend().catch(() => {});
    }, 80);
  }

  function resumeAudio() {
    if (!ctx || !unlocked || document.hidden) return;
    if (suspendTimer) { clearTimeout(suspendTimer); suspendTimer = null; }
    const restart = () => {
      if (document.hidden) return;
      applyMute();
      if (!schedulerId) startMusic();
    };
    if (ctx.state === 'running') { restart(); return; }
    try { ctx.resume().then(restart).catch(() => {}); } catch (e) { /* ignore */ }
  }

  function onVisibility() {
    if (!ctx) return;
    try {
      if (document.hidden) pauseForHidden();
      else resumeAudio();
    } catch (e) { /* ignore */ }
  }

  // ---------- wiring ----------

  function init(game) {
    if (!game || gameRef === game) return;
    gameRef = game;
    try {
      game.events.on('sfx', play);
    } catch (e) { /* no events */ }
  }

  function findGame() {
    // main.js declares `const game` at top level (a global lexical binding, not window.game).
    try {
      if (typeof game !== 'undefined' && game && game.events) return game;
    } catch (e) { /* not declared yet */ }
    if (window.game && window.game.events) return window.game;
    return null;
  }

  function waitForGame(triesLeft) {
    const g = findGame();
    if (g) { init(g); return; }
    if (triesLeft > 0) setTimeout(() => waitForGame(triesLeft - 1), 100);
  }

  ['pointerdown', 'touchstart', 'touchend', 'mousedown', 'keydown'].forEach((ev) => {
    window.addEventListener(ev, unlock, { capture: true, passive: true });
  });
  document.addEventListener('visibilitychange', onVisibility);
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => waitForGame(100));
  } else {
    setTimeout(() => waitForGame(100), 0);
  }

  return {
    init,
    play,
    toggleMute,
    isMuted: () => muted,
    unlock,
    startMusic,
    stopMusic,
    debug: () => ({
      state: ctx ? ctx.state : 'none',
      voices, musicVoices, mode, bpm: +bpm.toFixed(1), cutoff: ctx ? Math.round(musicFilter.frequency.value) : 0,
      danger: +danger.toFixed(2), intensity: +intensity.toFixed(2), music: !!schedulerId,
      live: countVoices(null), introVoices: countVoices('intro'), slowMo,
      masterGain: ctx ? +master.gain.value.toFixed(3) : 0,
      musicGain: ctx ? +musicBus.gain.value.toFixed(3) : 0,
      droneGain: ctx ? +droneGain.gain.value.toFixed(3) : 0,
      time: ctx ? +ctx.currentTime.toFixed(3) : 0,
      levels: { master: MASTER_LEVEL, sfx: SFX_LEVEL, music: MUSIC_LEVEL, slowMo: SLOWMO_DUCK },
    }),
  };
})();
