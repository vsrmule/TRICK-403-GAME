/**
 * Server-relayed voice fallback, used when a direct WebRTC connection to a peer
 * can't be established (mobile data, strict NATs, no TURN server).
 *
 * Audio is captured from the (echo-cancelled) microphone stream, downsampled to
 * 16 kHz, µ-law encoded (16 KB/s) and only sent while the speaker is actually
 * talking (simple voice-activity gate), then relayed by the game server.
 */

const RATE = 16000;
const FRAME = 4096;

function encodeMuLaw(sample: number): number {
  const BIAS = 0x84;
  let s = Math.max(-1, Math.min(1, sample)) * 32767;
  const sign = s < 0 ? 0x80 : 0;
  if (s < 0) s = -s;
  s = Math.min(32635, s + BIAS);
  let exp = 7;
  for (let mask = 0x4000; (s & mask) === 0 && exp > 0; exp--, mask >>= 1);
  const mant = (s >> (exp + 3)) & 0x0f;
  return ~(sign | (exp << 4) | mant) & 0xff;
}

const MULAW_TABLE = (() => {
  const t = new Float32Array(256);
  for (let i = 0; i < 256; i++) {
    const u = ~i & 0xff;
    const sign = u & 0x80;
    const exp = (u >> 4) & 0x07;
    const mant = u & 0x0f;
    let s = ((mant << 3) + 0x84) << exp;
    s -= 0x84;
    t[i] = (sign ? -s : s) / 32768;
  }
  return t;
})();

export class RelayCapture {
  private ctx: AudioContext;
  private node: ScriptProcessorNode;
  private src: MediaStreamAudioSourceNode;
  private hangover = 0;

  constructor(stream: MediaStream, private send: (pkt: ArrayBuffer) => void, private enabled: () => boolean) {
    this.ctx = new AudioContext();
    this.src = this.ctx.createMediaStreamSource(stream);
    this.node = this.ctx.createScriptProcessor(FRAME, 1, 1);
    const ratio = this.ctx.sampleRate / RATE;
    this.node.onaudioprocess = (e) => {
      if (!this.enabled()) return;
      const input = e.inputBuffer.getChannelData(0);
      let sum = 0;
      for (let i = 0; i < input.length; i++) sum += input[i] * input[i];
      const rms = Math.sqrt(sum / input.length);
      // Voice-activity gate with ~0.5 s hangover so word endings aren't clipped.
      if (rms > 0.005) this.hangover = 12; // ~1 s of tail so word endings and pauses aren't cut
      else if (this.hangover > 0) this.hangover--;
      else return;
      const n = Math.floor(input.length / ratio);
      const out = new Uint8Array(n);
      for (let i = 0; i < n; i++) out[i] = encodeMuLaw(input[Math.floor(i * ratio)]);
      this.send(out.buffer);
    };
    // A ScriptProcessor only runs while connected to the destination; route it through a silent gain.
    const silent = this.ctx.createGain();
    silent.gain.value = 0;
    this.src.connect(this.node);
    this.node.connect(silent).connect(this.ctx.destination);
  }

  resume() {
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  close() {
    this.node.disconnect();
    this.src.disconnect();
    void this.ctx.close();
  }
}

export class RelayPlayer {
  private ctx: AudioContext | null = null;
  private streams = new Map<string, { gain: GainNode; next: number }>();

  private context(): AudioContext {
    if (!this.ctx) this.ctx = new AudioContext();
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    return this.ctx;
  }

  resume() {
    if (this.ctx?.state === 'suspended') void this.ctx.resume();
  }

  play(from: string, data: ArrayBuffer, volume: number) {
    const ctx = this.context();
    let s = this.streams.get(from);
    if (!s) {
      const gain = ctx.createGain();
      gain.connect(ctx.destination);
      s = { gain, next: 0 };
      this.streams.set(from, s);
    }
    s.gain.gain.value = volume;
    const bytes = new Uint8Array(data);
    if (!bytes.length) return;
    const buf = ctx.createBuffer(1, bytes.length, RATE);
    const ch = buf.getChannelData(0);
    for (let i = 0; i < bytes.length; i++) ch[i] = MULAW_TABLE[bytes[i]];
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(s.gain);
    const now = ctx.currentTime;
    // Small jitter buffer; resync if we fell behind or drifted too far ahead.
    if (s.next < now + 0.03 || s.next > now + 0.6) s.next = now + 0.12;
    src.start(s.next);
    s.next += buf.duration;
  }

  setVolume(from: string, volume: number) {
    const s = this.streams.get(from);
    if (s) s.gain.gain.value = volume;
  }

  drop(from: string) {
    const s = this.streams.get(from);
    if (!s) return;
    s.gain.disconnect();
    this.streams.delete(from);
  }
}
