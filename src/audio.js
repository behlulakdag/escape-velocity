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
  const WALL_MIN_GAP = 1 / 6;          // seconds between wall ticks
  const LOOKAHEAD = 0.12;              // seconds of music scheduled ahead
  const TICK_MS = 25;

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
    limiter.threshold.value = -10;
    limiter.knee.value = 6;
    limiter.ratio.value = 12;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.2;
    limiter.connect(ctx.destination);

    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.8;
    master.connect(limiter);

    sfxBus = ctx.createGain();
    sfxBus.gain.value = 0.9;
    sfxBus.connect(master);

    musicFilter = ctx.createBiquadFilter();
    musicFilter.type = 'lowpass';
    musicFilter.frequency.value = 900;
    musicFilter.Q.value = 0.8;
    musicBus = ctx.createGain();
    musicBus.gain.value = 0.38;
    musicFilter.connect(musicBus);
    musicBus.connect(master);

    // Noise buffer reused by every noisy sound.
    noiseBuffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;

    // Persistent danger drone: two detuned low saws through a lowpass, gain follows danger.
    droneGain = ctx.createGain();
    droneGain.gain.value = 0;
    const droneFilter = ctx.createBiquadFilter();
    droneFilter.type = 'lowpass';
    droneFilter.frequency.value = 260;
    droneFilter.connect(droneGain);
    droneGain.connect(master);
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
    if (ctx.state === 'suspended' && !document.hidden) ctx.resume().catch(() => {});
    if (!unlocked) {
      unlocked = true;
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
  function claimVoice(src, nodes, bus) {
    const isMusic = bus === musicFilter || bus === musicBus;
    if (isMusic ? musicVoices >= MAX_MUSIC_VOICES : voices >= MAX_VOICES) return false;
    if (isMusic) musicVoices++; else voices++;
    src.onended = () => {
      if (isMusic) musicVoices--; else voices--;
      nodes.forEach((n) => { try { n.disconnect(); } catch (e) { /* already gone */ } });
    };
    return true;
  }

  // Oscillator with an attack/decay envelope and optional pitch glide and filter.
  function tone(o) {
    const t = (o.at !== undefined ? o.at : ctx.currentTime) + (o.delay || 0);
    const dur = o.dur || 0.2;
    const osc = ctx.createOscillator();
    const env = ctx.createGain();
    const nodes = [osc, env];
    if (!claimVoice(osc, nodes, o.bus)) return;
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
    if (!claimVoice(src, nodes, o.bus)) return;
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
      // Deep rumble that builds, plus a whine climbing over ~3s.
      noise({ filter: 'lowpass', cutoff: 120, cutoffEnd: 400, dur: 3.2, gain: 0.5, attack: 1.8, q: 4 });
      tone({ type: 'sawtooth', freq: 40, freqEnd: 70, dur: 3.2, gain: 0.25, attack: 1.5, filter: 'lowpass', cutoff: 200 });
      tone({ type: 'sine', freq: 300, freqEnd: 2400, dur: 3.0, glide: 2.9, gain: 0.07, attack: 2.4 });
      tone({ type: 'sine', freq: 305, freqEnd: 2430, dur: 3.0, glide: 2.9, gain: 0.05, attack: 2.4 });
    },
    launch() {
      noise({ filter: 'lowpass', cutoff: 3000, cutoffEnd: 80, dur: 1.6, gain: 0.7, attack: 0.005 });
      noise({ filter: 'bandpass', cutoff: 400, cutoffEnd: 5000, dur: 0.9, gain: 0.3, attack: 0.15, q: 1.5 });
      tone({ type: 'sine', freq: 110, freqEnd: 30, dur: 0.9, gain: 0.7 });
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
      tone({ type: 'sine', freq: 120, freqEnd: 40, dur: 0.25, gain: 0.6 });
      noise({ filter: 'lowpass', cutoff: 1800, cutoffEnd: 200, dur: 0.22, gain: 0.45 });
      noise({ filter: 'bandpass', cutoff: 3000, dur: 0.08, gain: 0.2, q: 2, delay: 0.01 });
    },
    wall() {
      const now = ctx.currentTime;
      if (now - lastWall < WALL_MIN_GAP) return;
      lastWall = now;
      tone({ type: 'triangle', freq: 2200 + Math.random() * 400, dur: 0.035, gain: 0.025 });
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
      tone({ type: 'sine', freq: 70, freqEnd: 45, dur: 0.18, gain: 0.6 });
      tone({ type: 'sine', freq: 70, freqEnd: 45, dur: 0.2, gain: 0.45, delay: 0.2 });
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
      noise({ filter: 'lowpass', cutoff: 2500, cutoffEnd: 60, dur: 1.4, gain: 0.7 });
      tone({ type: 'sine', freq: 90, freqEnd: 25, dur: 1.0, gain: 0.7 });
      tone({ type: 'sawtooth', freq: midiHz(24), freqEnd: midiHz(0), dur: 1.4, glide: 1.3, gain: 0.08, filter: 'lowpass', cutoff: 2000, cutoffEnd: 300, delay: 0.15 });
      duckMusic(2.5);
    },
    speedup(d) {
      const lvl = Math.min(6, (d && d.level) || 1);
      noise({ filter: 'bandpass', cutoff: 800, cutoffEnd: 6000 + lvl * 500, dur: 0.45, gain: 0.12, attack: 0.35, q: 2 });
      tone({ type: 'triangle', freq: midiHz(12 + scaleNote(lvl)), freqEnd: midiHz(24 + scaleNote(lvl)), dur: 0.4, gain: 0.06, attack: 0.3 });
    },
  };

  function play(name, data) {
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

  function duckMusic(seconds) {
    if (!ctx) return;
    const t = ctx.currentTime;
    musicBus.gain.cancelScheduledValues(t);
    musicBus.gain.setValueAtTime(musicBus.gain.value, t);
    musicBus.gain.linearRampToValueAtTime(0.03, t + 0.15);
    musicBus.gain.linearRampToValueAtTime(0.25, t + seconds);
  }

  // ---------- music ----------

  function readGameState() {
    const res = { mode: 'menu', speed: 0, danger: 0 };
    if (!gameRef || !gameRef.scene) return res;
    try {
      const gs = gameRef.scene.keys && gameRef.scene.keys.Game;
      const over = gameRef.scene.keys && gameRef.scene.keys.GameOver;
      if (gs && gameRef.scene.isActive('Game')) {
        if (gs.isOver) { res.mode = 'over'; return res; }
        res.mode = introActive ? 'intro' : 'game';
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
    if (schedulerId || !ctx) return;
    nextStepTime = ctx.currentTime + 0.1;
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
    intensity += ((mode === 'game' ? st.speed : 0) - intensity) * 0.05;
    danger += ((mode === 'game' ? st.danger : 0) - danger) * 0.1;

    const now = ctx.currentTime;
    const targetBpm = mode === 'game' ? 112 + intensity * 40 : mode === 'intro' ? 100 : 88;
    bpm += (targetBpm - bpm) * 0.08;
    const cutoff = mode === 'game' ? 900 + intensity * 5500 : mode === 'over' ? 500 : 1100;
    musicFilter.frequency.setTargetAtTime(cutoff, now, 0.15);
    droneGain.gain.setTargetAtTime(muted ? 0 : danger * 0.16, now, 0.2);

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
    const arpEvery = gameOn ? (intensity > 0.45 ? 1 : 2) : 4;
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
    const hatEvery = intensity > 0.6 ? 1 : 2;
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
    master.gain.setTargetAtTime(muted ? 0 : 0.8, t, 0.03);
  }

  function toggleMute() {
    muted = !muted;
    saveMuted();
    applyMute();
    return muted;
  }

  function onVisibility() {
    if (!ctx) return;
    try {
      if (document.hidden) ctx.suspend().catch(() => {});
      else if (unlocked) ctx.resume().catch(() => {});
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
      voices, musicVoices, mode, bpm: Math.round(bpm), cutoff: ctx ? Math.round(musicFilter.frequency.value) : 0,
      danger: +danger.toFixed(2), intensity: +intensity.toFixed(2), music: !!schedulerId,
    }),
  };
})();
