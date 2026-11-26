import { useSyncExternalStore } from 'react';
import type { MemberInfo } from '@g304/engine';
import { call, socket } from './net';
import { prefs } from './prefs';
import { RelayCapture, RelayPlayer } from './relay';
import { sfx } from './sfx';

/**
 * Room voice (and optional video) chat.
 *
 * WebRTC full mesh (fine for up to 8 players) signalled through the game server,
 * using the "perfect negotiation" pattern so cameras can be switched on and off
 * mid-call. When a direct link can't be made (mobile data, strict NATs, no TURN),
 * audio falls back to a relay through the game server; video needs a direct link.
 */

const ICE: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }];
const turnUrl = import.meta.env.VITE_TURN_URL as string | undefined;
if (turnUrl) {
  ICE.push({
    urls: turnUrl,
    username: import.meta.env.VITE_TURN_USERNAME as string | undefined,
    credential: import.meta.env.VITE_TURN_CREDENTIAL as string | undefined,
  });
}

/** How long to wait for a direct connection before relaying audio through the server. */
const DIRECT_TIMEOUT_MS = 5000;

interface Peer {
  pc: RTCPeerConnection;
  audio: HTMLAudioElement;
  memberId: string | null;
  pending: RTCIceCandidateInit[];
  mode: 'connecting' | 'direct' | 'relay';
  timer: number;
  polite: boolean;
  makingOffer: boolean;
  ignoreOffer: boolean;
  video: MediaStream | null;
  videoSender: RTCRtpSender | null;
  /** The other side told us it isn't receiving our direct audio, so relay to it as well. */
  peerWantsRelay: boolean;
  /** Inbound audio bytes at the last health check, and how many checks they haven't grown. */
  lastBytes: number;
  stalled: number;
}

/** How often to check that a direct link is really delivering sound. */
const HEALTH_MS = 2000;

export interface VoiceLink {
  memberId: string | null;
  mode: Peer['mode'];
}

export interface RemoteVideo {
  memberId: string;
  stream: MediaStream;
}

export interface VoiceState {
  status: 'off' | 'connecting' | 'on' | 'listenOnly' | 'error';
  muted: boolean;
  talking: boolean;
  error: string | null;
  peers: number;
  links: VoiceLink[];
  cameraOn: boolean;
  cameraError: string | null;
  localVideo: MediaStream | null;
  videos: RemoteVideo[];
  /** Member ids of people speaking right now (for the visual speaking indicator). */
  speaking: string[];
  /** You are speaking (mic picking up your voice and not muted). */
  meSpeaking: boolean;
}

/** Voice level (RMS) above which someone counts as speaking. */
const SPEAKING_LEVEL = 0.02;

class Voice {
  private local: MediaStream | null = null;
  private camera: MediaStream | null = null;
  private peers = new Map<string, Peer>();
  private members: MemberInfo[] = [];
  private pttHeld = false;
  private capture: RelayCapture | null = null;
  private player = new RelayPlayer();
  state: VoiceState = {
    status: 'off',
    muted: true, // microphone starts off; players turn it on with Mic (or M)
    talking: false,
    error: null,
    peers: 0,
    links: [],
    cameraOn: false,
    cameraError: null,
    localVideo: null,
    videos: [],
    speaking: [],
    meSpeaking: false,
  };
  private analysers = new Map<string, AnalyserNode>();
  private localAnalyser: AnalyserNode | null = null;
  private lastHeard = new Map<string, number>();
  private listeners = new Set<() => void>();

  constructor() {
    socket.on('signal', (m: { from: string; data: SignalData }) => void this.onSignal(m.from, m.data));
    socket.on('vrelay', (m: { from: string; d: ArrayBuffer }) => this.onRelay(m.from, m.d));
    socket.on('disconnect', () => {
      this.closeAll();
      this.registeredAs = null;
    });
    prefs.subscribe(() => {
      this.applyVolumes();
      this.applyMic();
    });
    const unlock = () => this.unlockAudio();
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    window.setInterval(() => void this.checkHealth(), HEALTH_MS);
    window.setInterval(() => this.measureSpeaking(), 200);
  }

  private analyse(stream: MediaStream): AnalyserNode | null {
    const ctx = sfx.ctx;
    if (!ctx) return null;
    try {
      const a = ctx.createAnalyser();
      a.fftSize = 512;
      ctx.createMediaStreamSource(stream).connect(a);
      return a;
    } catch {
      return null;
    }
  }

  private level(a: AnalyserNode): number {
    const buf = new Float32Array(a.fftSize);
    a.getFloatTimeDomainData(buf);
    let sum = 0;
    for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
    return Math.sqrt(sum / buf.length);
  }

  /** Who is speaking right now: direct audio level, or relay packets arriving. */
  /** Last time each person (and you) was heard: the indicator stays on briefly to avoid flicker. */
  private lastLoud = new Map<string, number>();
  private static readonly HOLD_MS = 900;

  private measureSpeaking() {
    if (this.state.status === 'off') return;
    const now = performance.now();
    const speaking: string[] = [];
    for (const [id, p] of this.peers) {
      if (!p.memberId) continue;
      let talking = now - (this.lastHeard.get(id) ?? -1e9) < 400;
      if (!talking && p.mode === 'direct') {
        let a = this.analysers.get(id);
        if (!a && p.audio.srcObject) {
          a = this.analyse(p.audio.srcObject as MediaStream) ?? undefined;
          if (a) this.analysers.set(id, a);
        }
        if (a) talking = this.level(a) > SPEAKING_LEVEL;
      }
      if (talking) this.lastLoud.set(p.memberId, now);
      if (now - (this.lastLoud.get(p.memberId) ?? -1e9) < Voice.HOLD_MS) speaking.push(p.memberId);
    }
    if (!this.localAnalyser && this.local) this.localAnalyser = this.analyse(this.local);
    if (this.localAnalyser && !this.isMicOff() && this.level(this.localAnalyser) > SPEAKING_LEVEL) this.lastLoud.set('me', now);
    const meSpeaking = !this.isMicOff() && now - (this.lastLoud.get('me') ?? -1e9) < Voice.HOLD_MS;
    const same = speaking.length === this.state.speaking.length && speaking.every((m, i) => m === this.state.speaking[i]);
    if (!same || meSpeaking !== this.state.meSpeaking) this.set({ speaking, meSpeaking });
  }

  /**
   * A link can report "connected" yet deliver no sound (for example after a network
   * change). WebRTC keeps sending packets even during silence, so if the received byte
   * count stops growing for ~6 seconds, switch that person to the server relay.
   */
  private async checkHealth() {
    for (const [id, p] of this.peers) {
      if (p.mode !== 'direct') continue;
      try {
        const stats = await p.pc.getStats();
        let bytes = 0;
        stats.forEach((r) => {
          if (r.type === 'inbound-rtp' && (r as { kind?: string }).kind === 'audio') bytes += (r as { bytesReceived?: number }).bytesReceived ?? 0;
        });
        p.stalled = bytes > p.lastBytes ? 0 : p.stalled + 1;
        p.lastBytes = bytes;
        if (p.stalled >= 3) this.setMode(id, 'relay');
      } catch {
        /* connection closing */
      }
    }
  }

  subscribe = (l: () => void) => {
    this.listeners.add(l);
    return () => {
      this.listeners.delete(l);
    };
  };
  getSnapshot = () => this.state;
  private set(p: Partial<VoiceState>) {
    this.state = { ...this.state, ...p };
    this.listeners.forEach((l) => l());
  }

  // ------------------------------------------------------------- join / leave

  /** Auto-join the room voice channel (open microphone by default). */
  async join() {
    if (this.state.status !== 'off' && this.state.status !== 'error') return;
    this.set({ status: 'connecting', error: null });
    try {
      this.local = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      this.set({ status: 'on' });
      try {
        this.capture = new RelayCapture(
          this.local,
          (d) => {
            // Relay to anyone we can't reach directly, or who says they aren't hearing us directly.
            const to = [...this.peers.entries()].filter(([, p]) => p.mode !== 'direct' || p.peerWantsRelay).map(([id]) => id);
            if (to.length) socket.emit('vrelay', { to, d });
          },
          () => !this.isMicOff(),
        );
      } catch (e) {
        console.warn('relay capture unavailable', e);
      }
    } catch {
      this.local = null;
      this.set({ status: 'listenOnly', error: 'Microphone unavailable — you can still hear others.' });
    }
    this.applyMic();
    this.registeredAs = socket.id ?? null;
    await call('voice', { on: true });
    await call('mic', { muted: this.isMicOff() });
    this.sync(this.members);
  }

  async leave() {
    await this.setCamera(false);
    await call('voice', { on: false });
    this.closeAll();
    this.capture?.close();
    this.capture = null;
    this.localAnalyser?.disconnect();
    this.localAnalyser = null;
    this.local?.getTracks().forEach((t) => t.stop());
    this.local = null;
    this.set({ status: 'off' });
  }

  private closeAll() {
    for (const id of [...this.peers.keys()]) this.drop(id);
  }

  // ------------------------------------------------------------- microphone

  private isMicOff() {
    if (!this.local) return true;
    if (this.state.muted) return true;
    return prefs.get().pushToTalk && !this.pttHeld;
  }

  private applyMic() {
    const off = this.isMicOff();
    this.local?.getAudioTracks().forEach((t) => (t.enabled = !off));
    if (!off !== this.state.talking) this.set({ talking: !off });
  }

  toggleMute(): boolean {
    this.set({ muted: !this.state.muted });
    this.applyMic();
    void call('mic', { muted: this.isMicOff() });
    return this.state.muted;
  }

  /** Push-to-talk: true while the talk button (or V) is held, or latched on by a tap. */
  setPtt(held: boolean) {
    if (this.pttHeld === held) return;
    this.pttHeld = held;
    this.applyMic();
    void call('mic', { muted: this.isMicOff() });
  }

  get pttActive() {
    return this.pttHeld;
  }

  // ------------------------------------------------------------- camera

  /** Turn your own camera on or off (only offered while the host has video enabled). */
  async setCamera(on: boolean) {
    if (on === this.state.cameraOn) return;
    if (on) {
      try {
        this.camera = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 320 }, height: { ideal: 240 }, frameRate: { ideal: 15 } } });
      } catch {
        this.set({ cameraError: 'Camera unavailable or permission denied.' });
        return;
      }
      const track = this.camera.getVideoTracks()[0];
      for (const p of this.peers.values()) p.videoSender = p.pc.addTrack(track, this.camera);
      this.set({ cameraOn: true, cameraError: null, localVideo: this.camera });
      await call('camera', { on: true });
    } else {
      for (const p of this.peers.values()) {
        if (p.videoSender) {
          try {
            p.pc.removeTrack(p.videoSender);
          } catch {
            /* connection already closed */
          }
          p.videoSender = null;
        }
      }
      this.camera?.getTracks().forEach((t) => t.stop());
      this.camera = null;
      this.set({ cameraOn: false, localVideo: null });
      await call('camera', { on: false });
    }
  }

  // ------------------------------------------------------------- peers

  /** Socket id we last registered with the server's voice channel. */
  private registeredAs: string | null = null;

  /**
   * Reconcile peer connections with the room's current voice members.
   * Also repairs our own registration: after a reconnect (new socket) or a server
   * restart, the server no longer lists us in voice, so we join again automatically.
   */
  sync(members: MemberInfo[], videoEnabled = true, myMemberId?: string) {
    this.members = members;
    if (!videoEnabled && this.state.cameraOn) void this.setCamera(false);
    if (this.state.status === 'off' || this.state.status === 'connecting' || !socket.id) return;
    const me = myMemberId ? members.find((m) => m.memberId === myMemberId) : undefined;
    if (me && me.voiceId !== socket.id && this.registeredAs !== socket.id) {
      this.registeredAs = socket.id;
      void call('voice', { on: true }).then(() => call('mic', { muted: this.isMicOff() }));
      if (this.state.cameraOn) void call('camera', { on: true });
      return; // the server's next update lists us and peers connect from there
    }
    const want = new Map(members.filter((m) => m.voiceId && m.voiceId !== socket.id).map((m) => [m.voiceId!, m]));
    for (const id of [...this.peers.keys()]) if (!want.has(id)) this.drop(id);
    for (const [id, m] of want) {
      const p = this.peers.get(id);
      if (p) p.memberId = m.memberId;
      else this.create(id, m.memberId);
    }
    this.applyVolumes();
    this.publishPeers();
  }

  private create(id: string, memberId: string | null): Peer {
    const pc = new RTCPeerConnection({ iceServers: ICE });
    const audio = document.createElement('audio');
    audio.autoplay = true;
    audio.setAttribute('playsinline', '');
    audio.hidden = true;
    document.body.appendChild(audio);
    const peer: Peer = {
      pc,
      audio,
      memberId,
      pending: [],
      mode: 'connecting',
      timer: 0,
      polite: (socket.id ?? '') > id,
      makingOffer: false,
      ignoreOffer: false,
      video: null,
      videoSender: null,
      peerWantsRelay: false,
      lastBytes: 0,
      stalled: 0,
    };
    this.peers.set(id, peer);
    peer.timer = window.setTimeout(() => {
      if (peer.mode === 'connecting') this.setMode(id, 'relay');
    }, DIRECT_TIMEOUT_MS);

    pc.onnegotiationneeded = async () => {
      try {
        peer.makingOffer = true;
        await pc.setLocalDescription();
        socket.emit('signal', { to: id, data: { description: pc.localDescription } });
      } catch (e) {
        console.warn('negotiation failed', e);
      } finally {
        peer.makingOffer = false;
      }
    };
    pc.onicecandidate = (e) => e.candidate && socket.emit('signal', { to: id, data: { candidate: e.candidate.toJSON() } });
    pc.ontrack = (e) => {
      if (e.track.kind === 'audio') {
        audio.srcObject = new MediaStream([e.track]);
        void audio.play().catch(() => undefined);
      } else if (e.track.kind === 'video') {
        peer.video = new MediaStream([e.track]);
        e.track.onunmute = () => this.publishPeers();
        e.track.onended = () => {
          peer.video = null;
          this.publishPeers();
        };
        this.publishPeers();
      }
    };
    pc.onconnectionstatechange = () => {
      const st = pc.connectionState;
      if (st === 'connected') this.setMode(id, 'direct');
      else if (st === 'failed' || st === 'disconnected' || st === 'closed') this.setMode(id, 'relay');
    };

    if (this.local) this.local.getTracks().forEach((t) => pc.addTrack(t, this.local!));
    else pc.addTransceiver('audio', { direction: 'recvonly' });
    if (this.camera) peer.videoSender = pc.addTrack(this.camera.getVideoTracks()[0], this.camera);
    this.applyVolumes();
    return peer;
  }

  private async onSignal(from: string, data: SignalData) {
    if (this.state.status === 'off') return;
    let p = this.peers.get(from);
    if (typeof data.relay === 'boolean') {
      if (p) p.peerWantsRelay = data.relay;
      return;
    }
    try {
      if (data.description) {
        if (!p) {
          const m = this.members.find((x) => x.voiceId === from);
          p = this.create(from, m?.memberId ?? null);
        }
        const d = data.description;
        const collision = d.type === 'offer' && (p.makingOffer || p.pc.signalingState !== 'stable');
        p.ignoreOffer = !p.polite && collision;
        if (p.ignoreOffer) return;
        await p.pc.setRemoteDescription(d);
        if (d.type === 'offer') {
          await p.pc.setLocalDescription();
          socket.emit('signal', { to: from, data: { description: p.pc.localDescription } });
        }
        for (const c of p.pending.splice(0)) await p.pc.addIceCandidate(c).catch(() => undefined);
      } else if (data.candidate && p) {
        const peer = p;
        if (!peer.pc.remoteDescription) peer.pending.push(data.candidate);
        else
          await peer.pc.addIceCandidate(data.candidate).catch((e) => {
            if (!peer.ignoreOffer) console.warn('ice candidate error', e);
          });
      }
    } catch (e) {
      console.warn('voice signal error', e);
    }
  }

  private setMode(id: string, mode: Peer['mode']) {
    const p = this.peers.get(id);
    if (!p || p.mode === mode) return;
    p.mode = mode;
    clearTimeout(p.timer);
    p.stalled = 0;
    // Tell the other side which route we need, so both always agree.
    socket.emit('signal', { to: id, data: { relay: mode !== 'direct' } });
    // Never play the same person twice: silence the direct audio while relayed, and vice versa.
    p.audio.muted = mode === 'relay' || this.isPeerMuted(p);
    if (mode === 'direct') this.player.drop(id);
    this.publishPeers();
  }

  private publishPeers() {
    const links = [...this.peers.values()].map((p) => ({ memberId: p.memberId, mode: p.mode }));
    const videos: RemoteVideo[] = [];
    for (const p of this.peers.values()) {
      const track = p.video?.getVideoTracks()[0];
      if (p.video && p.memberId && track && track.readyState === 'live') videos.push({ memberId: p.memberId, stream: p.video });
    }
    this.set({ links, peers: links.filter((l) => l.mode !== 'connecting').length, videos });
  }

  private drop(id: string) {
    const p = this.peers.get(id);
    if (!p) return;
    clearTimeout(p.timer);
    this.player.drop(id);
    this.analysers.get(id)?.disconnect();
    this.analysers.delete(id);
    p.pc.close();
    p.audio.srcObject = null;
    p.audio.remove();
    this.peers.delete(id);
    this.publishPeers();
  }

  // ------------------------------------------------------------- relay + volume

  private isPeerMuted(p: Peer) {
    return p.memberId ? !!prefs.get().playerMuted[p.memberId] : false;
  }

  private peerVolume(memberId: string | null) {
    const pr = prefs.get();
    if (memberId && pr.playerMuted[memberId]) return 0;
    const per = memberId ? pr.playerVolume[memberId] ?? 100 : 100;
    return Math.max(0, Math.min(1, (pr.voiceVolume / 100) * (per / 100)));
  }

  private onRelay(from: string, d: ArrayBuffer) {
    if (this.state.status === 'off') return;
    const p = this.peers.get(from);
    if (p?.mode === 'direct') return;
    const m = this.members.find((x) => x.voiceId === from);
    if (!p && !m) return;
    this.lastHeard.set(from, performance.now());
    this.player.play(from, d, this.peerVolume(p?.memberId ?? m?.memberId ?? null));
  }

  unlockAudio() {
    this.capture?.resume();
    this.player.resume();
    for (const p of this.peers.values()) if (p.audio.srcObject && p.audio.paused) void p.audio.play().catch(() => undefined);
  }

  /** Voice channel volume × per-player volume, plus per-player mute. */
  applyVolumes() {
    for (const [id, p] of this.peers) {
      const vol = this.peerVolume(p.memberId);
      p.audio.volume = vol;
      p.audio.muted = p.mode === 'relay' || this.isPeerMuted(p);
      this.player.setVolume(id, vol);
    }
  }
}

interface SignalData {
  description?: RTCSessionDescriptionInit;
  candidate?: RTCIceCandidateInit;
  /** "I need your audio through the server relay" (or no longer). */
  relay?: boolean;
}

export const voice = new Voice();

export function useVoice() {
  return useSyncExternalStore(voice.subscribe, voice.getSnapshot);
}
