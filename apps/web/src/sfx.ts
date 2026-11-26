import { activity } from './activity';
import { prefs } from './prefs';

/**
 * Synthesised sound effects on their own mixer channel (no asset files).
 * Every sound has a different shape — pitch contour, timbre and rhythm — so they
 * are told apart by ear, not just by loudness.
 */
export type SfxName =
  | 'logo' // start sequence sound logo
  | 'deal' // shuffle and deal
  | 'play' // a card lands on the table
  | 'turn' // your turn
  | 'bid' // a bid is made
  | 'pass'
  | 'trickWin' // your side took the trick
  | 'trickLose' // the other side took it
  | 'askTrump' // someone asks for trump
  | 'trump' // trump revealed
  | 'coat' // Coat / Challenge Coat called
  | 'roundEnd' // a round is decided (everyone)
  | 'cheer' // encouraging: your side won the round
  | 'matchWin' // match won
  | 'chat' // new chat message
  | 'error';

class Sfx {
  ctx: AudioContext | null = null;
  private gain: GainNode | null = null;
  private duckUntil = 0;
  private restoreTimer: number | null = null;

  /** Must run from a user gesture at least once (autoplay policies). */
  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.gain = this.ctx.createGain();
      this.gain.connect(this.ctx.destination);
      this.applyVolume();
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  private level() {
    return prefs.get().sfxVolume / 100;
  }

  applyVolume() {
    if (!this.ctx || !this.gain) return;
    const ducked = performance.now() < this.duckUntil;
    this.gain.gain.setTargetAtTime(this.level() * (ducked ? 0.3 : 1), this.ctx.currentTime, 0.05);
  }

  /** Lower effects while an announcement is spoken (smart ducking). */
  duck(ms: number) {
    if (!prefs.get().duck) return;
    this.duckUntil = Math.max(this.duckUntil, performance.now() + ms);
    this.applyVolume();
    if (this.restoreTimer) clearTimeout(this.restoreTimer);
    this.restoreTimer = window.setTimeout(() => this.applyVolume(), ms + 20);
  }

  private tone(freq: number, start: number, dur: number, type: OscillatorType = 'sine', vol = 0.3, slideTo?: number) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    const t = ctx.currentTime + start;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(this.gain!);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  private noise(start: number, dur: number, vol = 0.2, hp = 1800) {
    const ctx = this.ctx!;
    const buf = ctx.createBuffer(1, Math.max(1, Math.floor(ctx.sampleRate * dur)), ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
    const src = ctx.createBufferSource();
    const g = ctx.createGain();
    const f = ctx.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = hp;
    g.gain.value = vol;
    src.buffer = buf;
    src.connect(f).connect(g).connect(this.gain!);
    src.start(ctx.currentTime + start);
  }

  /** Duration of each sound in ms (used to sequence the start sequence). */
  static readonly LENGTH: Partial<Record<SfxName, number>> = { logo: 1500, cheer: 1600, matchWin: 2200, roundEnd: 900 };

  play(name: SfxName) {
    if (!this.ctx || this.level() === 0) return;
    activity.pulseSfx(name, Sfx.LENGTH[name] ?? 450);
    switch (name) {
      case 'logo': // "Trick 304" sound logo: card riffle, then a bright three-note rise
        for (let i = 0; i < 8; i++) this.noise(i * 0.04, 0.035, 0.22);
        [392, 523, 659].forEach((f, i) => this.tone(f, 0.4 + i * 0.16, 0.5, 'triangle', 0.28));
        this.tone(1047, 0.9, 0.7, 'sine', 0.18);
        break;
      case 'deal': // fast riffle
        for (let i = 0; i < 6; i++) this.noise(i * 0.07, 0.05, 0.25);
        break;
      case 'play': // soft card slap
        this.noise(0, 0.06, 0.3, 1200);
        this.tone(220, 0, 0.08, 'triangle', 0.15);
        break;
      case 'turn': // two-tone chime, rising
        this.tone(660, 0, 0.18);
        this.tone(880, 0.14, 0.25);
        break;
      case 'bid': // single wooden knock
        this.tone(520, 0, 0.09, 'square', 0.12);
        this.tone(390, 0.05, 0.1, 'triangle', 0.12);
        break;
      case 'pass': // low soft blip, falling
        this.tone(300, 0, 0.15, 'sine', 0.14, 220);
        break;
      case 'trickWin': // up-swoop
        this.tone(523, 0, 0.15);
        this.tone(784, 0.1, 0.3);
        break;
      case 'trickLose': // down-swoop
        this.tone(392, 0, 0.18, 'sine', 0.2);
        this.tone(262, 0.14, 0.35, 'sine', 0.2);
        break;
      case 'askTrump': // questioning rise
        this.tone(440, 0, 0.22, 'triangle', 0.22, 700);
        break;
      case 'trump': // sparkling arpeggio
        [523, 659, 784, 1047].forEach((f, i) => this.tone(f, i * 0.09, 0.3, 'triangle', 0.25));
        break;
      case 'coat': // dramatic drum hits
        this.tone(110, 0, 0.3, 'sine', 0.4, 60);
        this.tone(110, 0.25, 0.3, 'sine', 0.4, 60);
        this.tone(880, 0.5, 0.4, 'sawtooth', 0.08);
        break;
      case 'roundEnd': // gong
        this.tone(196, 0, 0.9, 'sine', 0.3);
        this.tone(294, 0, 0.9, 'sine', 0.12);
        break;
      case 'cheer': // encouraging: applause + major fanfare
        for (let i = 0; i < 18; i++) this.noise(i * 0.06 + Math.random() * 0.03, 0.04, 0.12, 2500);
        [523, 659, 784].forEach((f, i) => this.tone(f, 0.15 + i * 0.12, 0.35, 'square', 0.1));
        this.tone(1047, 0.55, 0.8, 'triangle', 0.25);
        break;
      case 'matchWin': // long fanfare
        [392, 523, 659, 784, 1047].forEach((f, i) => this.tone(f, i * 0.15, 0.4, 'square', 0.1));
        [523, 659, 784].forEach((f) => this.tone(f, 0.8, 1.3, 'triangle', 0.18));
        for (let i = 0; i < 24; i++) this.noise(0.8 + i * 0.05, 0.04, 0.1, 2500);
        break;
      case 'chat': // tiny pop
        this.tone(1200, 0, 0.06, 'sine', 0.12);
        break;
      case 'error':
        this.tone(150, 0, 0.2, 'square', 0.12);
        break;
    }
  }
}

export const sfx = new Sfx();
export const SFX_LENGTH = (Sfx as unknown as { LENGTH: Partial<Record<SfxName, number>> }).LENGTH;
prefs.subscribe(() => sfx.applyVolume());
