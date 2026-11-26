import { activity } from './activity';
import { prefs } from './prefs';
import { sfx } from './sfx';

/**
 * Optional background music (off by default so people can talk).
 * A soft, slow chord loop generated in Web Audio — no files, its own mixer
 * channel, and it ducks under announcements like the effects do.
 */
const CHORDS = [
  [220, 261.6, 329.6], // A minor
  [174.6, 220, 261.6], // F
  [196, 246.9, 293.7], // G
  [164.8, 207.7, 246.9], // E
];
const BAR = 4; // seconds per chord

class Music {
  private gain: GainNode | null = null;
  private timer: number | null = null;
  private step = 0;
  private duckUntil = 0;

  private ctx() {
    sfx.unlock();
    return sfx.ctx;
  }

  private level() {
    const p = prefs.get();
    return p.musicOn ? (p.musicVolume / 100) * 0.35 : 0;
  }

  sync() {
    const p = prefs.get();
    activity.setMusic(p.musicOn);
    if (p.musicOn) this.start();
    else this.stop();
    this.apply();
  }

  private apply() {
    const ctx = sfx.ctx;
    if (!ctx || !this.gain) return;
    const ducked = performance.now() < this.duckUntil;
    this.gain.gain.setTargetAtTime(this.level() * (ducked ? 0.35 : 1), ctx.currentTime, 0.3);
  }

  duck(ms: number) {
    if (!prefs.get().duck || !this.gain) return;
    this.duckUntil = Math.max(this.duckUntil, performance.now() + ms);
    this.apply();
    window.setTimeout(() => this.apply(), ms + 30);
  }

  private start() {
    const ctx = this.ctx();
    if (!ctx || this.timer !== null) return;
    this.gain = ctx.createGain();
    this.gain.gain.value = 0;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 900;
    this.gain.connect(lp).connect(ctx.destination);
    const tick = () => this.bar();
    tick();
    this.timer = window.setInterval(tick, BAR * 1000);
  }

  private bar() {
    const ctx = sfx.ctx;
    if (!ctx || !this.gain) return;
    const chord = CHORDS[this.step++ % CHORDS.length];
    const t = ctx.currentTime + 0.05;
    for (const f of chord) {
      for (const detune of [-4, 4]) {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.type = 'triangle';
        o.frequency.value = f;
        o.detune.value = detune;
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(0.08, t + 1.2);
        g.gain.linearRampToValueAtTime(0, t + BAR + 0.6);
        o.connect(g).connect(this.gain);
        o.start(t);
        o.stop(t + BAR + 0.8);
      }
    }
    // A quiet plucked melody note on the off-beat.
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sine';
    o.frequency.value = chord[2] * 2;
    g.gain.setValueAtTime(0, t + BAR / 2);
    g.gain.linearRampToValueAtTime(0.05, t + BAR / 2 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.001, t + BAR / 2 + 1.2);
    o.connect(g).connect(this.gain);
    o.start(t + BAR / 2);
    o.stop(t + BAR / 2 + 1.3);
    this.apply();
  }

  private stop() {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    const g = this.gain;
    const ctx = sfx.ctx;
    if (g && ctx) {
      g.gain.setTargetAtTime(0, ctx.currentTime, 0.3);
      window.setTimeout(() => g.disconnect(), 1500);
    }
    this.gain = null;
  }
}

export const music = new Music();
prefs.subscribe(() => music.sync());
