import { randomBytes, randomInt } from 'node:crypto';
import {
  Action,
  ChatMessage,
  REACTIONS,
  BOT_DELAY_MS,
  BOT_NAMES,
  DEFAULT_SETTINGS,
  Game304,
  GameEvent,
  MemberInfo,
  PLAYER_COUNTS,
  PlayerCount,
  PublicRoomInfo,
  RoomSettings,
  RoomSnapshot,
  SeatInfo,
  botDecide,
  eventsFor,
  viewFor,
} from '@g304/engine';

export class RoomError extends Error {}

interface Seat {
  kind: 'empty' | 'human' | 'bot';
  /** Member token for human seats. */
  token: string | null;
  botName: string;
}

export interface Member {
  token: string;
  publicId: string;
  name: string;
  sockets: Set<string>;
  voiceSocket: string | null;
  micMuted: boolean;
  wantsSeat: boolean;
  cameraOn: boolean;
  /** Timestamps of recent chat messages, for rate limiting. */
  chatTimes: number[];
  lastSeen: number;
}

export interface Room {
  code: string;
  isPublic: boolean;
  hostToken: string;
  settings: RoomSettings;
  seats: Seat[];
  members: Map<string, Member>;
  game: Game304 | null;
  ready: Set<number>;
  timer: NodeJS.Timeout | null;
  turnDeadline: number | null;
  emptySince: number | null;
  /** Video chat available by default; the host can switch it off. Each camera starts off. */
  videoEnabled: boolean;
  /** Off until a player or the host turns it on. */
  chatEnabled: boolean;
  chat: ChatMessage[];
  chatSeq: number;
}

const CHAT_KEEP = 100;
const CHAT_MAX_LEN = 300;

export interface ManagerOptions {
  /** Fixed delay before a bot acts (ms); overrides the room's bot speed (used by tests). */
  botDelay?: number;
  /** Auto-play for a disconnected human whose turn it is (ms). */
  disconnectGrace?: number;
  /** Delete rooms nobody is connected to after this long (ms). */
  idleRoomTtl?: number;
  rng?: () => number;
}

/** Called whenever a room changes; `events` are raw (unfiltered) game events. */
export type Publisher = (room: Room, events: GameEvent[], notices: string[]) => void;


const cleanName = (s: unknown) => (typeof s === 'string' ? s.replace(/\s+/g, ' ').trim().slice(0, 20) : '') || 'Player';

export function sanitizeSettings(base: RoomSettings, s: Partial<RoomSettings>): RoomSettings {
  const out = { ...base };
  if (s.numPlayers !== undefined) {
    if (!PLAYER_COUNTS.includes(s.numPlayers as PlayerCount)) throw new RoomError('Seat count must be 2, 3, 4, 6, 8 or 12');
    out.numPlayers = s.numPlayers;
  }
  if (s.matchTarget !== undefined) {
    const t = Math.round(Number(s.matchTarget));
    if (!(t >= 2 && t <= 100)) throw new RoomError('Match target must be between 2 and 100');
    out.matchTarget = t;
  }
  if (s.fourCardMode !== undefined) out.fourCardMode = !!s.fourCardMode;
  if (s.turnTimer !== undefined) {
    if (![0, 15, 30, 60, 90].includes(s.turnTimer)) throw new RoomError('Turn timer must be off, 15, 30, 60 or 90 seconds');
    out.turnTimer = s.turnTimer;
  }
  if (s.botSpeed !== undefined) {
    if (!(s.botSpeed in BOT_DELAY_MS)) throw new RoomError('Bot speed must be relaxed, normal or fast');
    out.botSpeed = s.botSpeed;
  }
  out.fourCardMode = out.numPlayers === 4 && out.fourCardMode;
  return out;
}

export class RoomManager {
  rooms = new Map<string, Room>();
  /** token -> room code */
  private memberRoom = new Map<string, string>();
  private opts: Required<Omit<ManagerOptions, 'botDelay'>> & { botDelay: number | null };

  constructor(private publish: Publisher, opts: ManagerOptions = {}) {
    this.opts = {
      botDelay: opts.botDelay ?? null,
      disconnectGrace: opts.disconnectGrace ?? 30000,
      idleRoomTtl: opts.idleRoomTtl ?? 10 * 60 * 1000,
      rng: opts.rng ?? (() => randomInt(0, 2 ** 32) / 2 ** 32),
    };
  }

  // ----------------------------------------------------------------- lookup

  roomOf(token: string): Room | null {
    const code = this.memberRoom.get(token);
    return code ? this.rooms.get(code) ?? null : null;
  }

  seatOf(room: Room, token: string): number | null {
    const i = room.seats.findIndex((s) => s.kind === 'human' && s.token === token);
    return i >= 0 ? i : null;
  }

  private requireRoom(token: string): Room {
    const r = this.roomOf(token);
    if (!r) throw new RoomError('You are not in a room');
    return r;
  }

  private requireHost(token: string): Room {
    const r = this.requireRoom(token);
    if (r.hostToken !== token) throw new RoomError('Only the host can do that');
    return r;
  }

  private requireLobby(room: Room) {
    if (room.game) throw new RoomError('The game has already started');
  }

  publicRooms(): PublicRoomInfo[] {
    return [...this.rooms.values()]
      .filter((r) => r.isPublic)
      .map((r) => ({
        code: r.code,
        hostName: r.members.get(r.hostToken)?.name ?? 'Host',
        numPlayers: r.settings.numPlayers,
        humans: r.seats.filter((s) => s.kind === 'human').length,
        openSeats: r.seats.filter((s) => s.kind !== 'human').length,
      }))
      .filter((r) => r.openSeats > 0);
  }

  // ----------------------------------------------------------------- membership

  private newCode(): string {
    for (;;) {
      const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
      if (!this.rooms.has(code)) return code;
    }
  }

  private makeSeats(n: number): Seat[] {
    return Array.from({ length: n }, (_, i) => ({ kind: 'empty' as const, token: null, botName: `Bot ${BOT_NAMES[i]}` }));
  }

  private attach(room: Room, token: string, name: string, socketId: string): Member {
    const prev = this.roomOf(token);
    if (prev && prev !== room) this.leave(token);
    let m = room.members.get(token);
    if (!m) {
      m = {
        token,
        publicId: randomBytes(6).toString('hex'),
        name: cleanName(name),
        sockets: new Set(),
        voiceSocket: null,
        micMuted: true, // everyone joins with the mic off until they turn it on
        wantsSeat: false,
        cameraOn: false,
        chatTimes: [],
        lastSeen: Date.now(),
      };
      room.members.set(token, m);
    } else if (name) {
      m.name = cleanName(name);
    }
    m.sockets.add(socketId);
    m.lastSeen = Date.now();
    room.emptySince = null;
    this.memberRoom.set(token, room.code);
    return m;
  }

  createRoom(token: string, name: string, socketId: string, isPublic = false, settings: Partial<RoomSettings> = {}): Room {
    const s = sanitizeSettings(DEFAULT_SETTINGS, settings);
    const room: Room = {
      code: this.newCode(),
      isPublic,
      hostToken: token,
      settings: s,
      seats: this.makeSeats(s.numPlayers),
      members: new Map(),
      game: null,
      ready: new Set(),
      timer: null,
      turnDeadline: null,
      emptySince: null,
      videoEnabled: true,
      chatEnabled: true,
      chat: [],
      chatSeq: 0,
    };
    this.rooms.set(room.code, room);
    const m = this.attach(room, token, name, socketId);
    room.seats[0] = { ...room.seats[0], kind: 'human', token };
    this.publish(room, [], [`${m.name} created room ${room.code}.`]);
    return room;
  }

  joinRoom(code: string, token: string, name: string, socketId: string): Room {
    if (!/^\d{6}$/.test(code)) throw new RoomError('Room codes are 6 digits');
    const room = this.rooms.get(code);
    if (!room) throw new RoomError('Room not found');
    const existing = room.members.get(token);
    const wasConnected = existing ? existing.sockets.size > 0 : false;
    const m = this.attach(room, token, name, socketId);
    const notices: string[] = [];
    if (existing) {
      if (!wasConnected) notices.push(`${m.name} reconnected.`);
    } else {
      notices.push(`${m.name} joined the room.`);
      if (!room.game) {
        const free = room.seats.findIndex((s) => s.kind === 'empty');
        if (free >= 0) room.seats[free] = { ...room.seats[free], kind: 'human', token };
      } else {
        m.wantsSeat = true;
        if (room.seats.some((s) => s.kind === 'bot')) notices.push(`${m.name} will take over a bot seat when the next round starts.`);
      }
    }
    this.publish(room, [], notices);
    this.schedule(room);
    return room;
  }

  quickJoin(token: string, name: string, socketId: string): Room {
    const open = [...this.rooms.values()].find(
      (r) => r.isPublic && !r.members.has(token) && (r.game ? r.seats.some((s) => s.kind === 'bot') : r.seats.some((s) => s.kind === 'empty')),
    );
    if (open) return this.joinRoom(open.code, token, name, socketId);
    return this.createRoom(token, name, socketId, true);
  }

  leave(token: string) {
    const room = this.roomOf(token);
    if (!room) return;
    const m = room.members.get(token)!;
    this.memberRoom.delete(token);
    room.members.delete(token);
    const seat = this.seatOf(room, token);
    const notices = [`${m.name} left the room.`];
    if (seat !== null) {
      if (room.game) {
        room.seats[seat] = { kind: 'bot', token: null, botName: `Bot (${m.name})` };
        notices.push(`A bot is now playing for ${m.name}.`);
      } else {
        room.seats[seat] = { ...room.seats[seat], kind: 'empty', token: null };
      }
      room.ready.delete(seat);
    }
    if (room.hostToken === token) {
      const next = [...room.members.values()].find((x) => x.sockets.size > 0) ?? [...room.members.values()][0];
      if (next) {
        room.hostToken = next.token;
        notices.push(`${next.name} is now the host.`);
      }
    }
    if (room.members.size === 0) return this.deleteRoom(room);
    this.publish(room, [], notices);
    this.schedule(room);
  }

  /** A socket went away. The member keeps their seat so they can reconnect. */
  disconnectSocket(token: string, socketId: string) {
    const room = this.roomOf(token);
    if (!room) return;
    const m = room.members.get(token);
    if (!m) return;
    m.sockets.delete(socketId);
    this.clientFeatures.delete(socketId);
    if (m.voiceSocket === socketId) m.voiceSocket = null;
    if (m.sockets.size === 0) {
      m.lastSeen = Date.now();
      if ([...room.members.values()].every((x) => x.sockets.size === 0)) room.emptySince = Date.now();
      this.publish(room, [], [`${m.name} disconnected.`]);
      this.schedule(room);
    } else {
      this.publish(room, [], []);
    }
  }

  private deleteRoom(room: Room) {
    if (room.timer) clearTimeout(room.timer);
    for (const t of room.members.keys()) this.memberRoom.delete(t);
    this.rooms.delete(room.code);
  }

  /** Remove rooms with nobody connected for a while. */
  sweep(now = Date.now()) {
    for (const r of [...this.rooms.values()]) {
      if (r.emptySince !== null && now - r.emptySince > this.opts.idleRoomTtl) this.deleteRoom(r);
    }
  }

  // ----------------------------------------------------------------- lobby

  updateSettings(token: string, patch: Partial<RoomSettings>) {
    const room = this.requireHost(token);
    this.requireLobby(room);
    const s = sanitizeSettings(room.settings, patch);
    if (s.numPlayers !== room.settings.numPlayers) {
      const humans = room.seats.filter((x) => x.kind === 'human');
      const bots = room.seats.filter((x) => x.kind === 'bot').length;
      const seats = this.makeSeats(s.numPlayers);
      humans.slice(0, s.numPlayers).forEach((h, i) => (seats[i] = { ...seats[i], kind: 'human', token: h.token }));
      for (let i = humans.length, b = 0; i < s.numPlayers && b < bots; i++, b++) seats[i] = { ...seats[i], kind: 'bot' };
      for (const h of humans.slice(s.numPlayers)) {
        const m = room.members.get(h.token!);
        if (m) m.wantsSeat = true;
      }
      room.seats = seats;
    }
    room.settings = s;
    this.publish(room, [], []);
  }

  takeSeat(token: string, seat: number) {
    const room = this.requireRoom(token);
    this.requireLobby(room);
    if (!(seat >= 0 && seat < room.seats.length)) throw new RoomError('Bad seat');
    if (room.seats[seat].kind === 'human') throw new RoomError('That seat is taken');
    if (room.seats[seat].kind === 'bot' && room.hostToken !== token) throw new RoomError('Ask the host to remove that bot');
    const cur = this.seatOf(room, token);
    if (cur !== null) room.seats[cur] = { ...room.seats[cur], kind: 'empty', token: null };
    room.seats[seat] = { ...room.seats[seat], kind: 'human', token };
    room.members.get(token)!.wantsSeat = false;
    this.publish(room, [], []);
  }

  leaveSeat(token: string) {
    const room = this.requireRoom(token);
    this.requireLobby(room);
    const cur = this.seatOf(room, token);
    if (cur !== null) room.seats[cur] = { ...room.seats[cur], kind: 'empty', token: null };
    this.publish(room, [], []);
  }

  setBot(token: string, seat: number, bot: boolean) {
    const room = this.requireHost(token);
    this.requireLobby(room);
    const s = room.seats[seat];
    if (!s) throw new RoomError('Bad seat');
    if (s.kind === 'human') throw new RoomError('That seat has a player');
    room.seats[seat] = { ...s, kind: bot ? 'bot' : 'empty' };
    this.publish(room, [], []);
  }

  fillBots(token: string) {
    const room = this.requireHost(token);
    this.requireLobby(room);
    room.seats = room.seats.map((s) => (s.kind === 'empty' ? { ...s, kind: 'bot' } : s));
    this.publish(room, [], []);
  }

  /** Compact humans into consecutive seats so they alternate between the two teams. */
  autoAssign(token: string) {
    const room = this.requireHost(token);
    this.requireLobby(room);
    const humans = room.seats.filter((s) => s.kind === 'human');
    const others = room.seats.filter((s) => s.kind !== 'human');
    const order = [...humans, ...others];
    room.seats = order.map((s, i) => ({ ...s, botName: `Bot ${BOT_NAMES[i]}` }));
    this.publish(room, [], []);
  }

  setPublic(token: string, isPublic: boolean) {
    const room = this.requireHost(token);
    room.isPublic = !!isPublic;
    this.publish(room, [], []);
  }

  start(token: string) {
    const room = this.requireHost(token);
    this.requireLobby(room);
    if (room.seats.some((s) => s.kind === 'empty')) throw new RoomError('Fill every seat with a player or a bot first');
    const s = room.settings;
    room.game = new Game304(
      { numPlayers: s.numPlayers, matchTarget: s.matchTarget, fourCardMode: s.fourCardMode },
      { rng: this.opts.rng, dealer: Math.floor(this.opts.rng() * s.numPlayers) },
    );
    room.ready.clear();
    this.flush(room, ['The game has started.']);
  }

  /** After a match, return to the lobby keeping seats. */
  backToLobby(token: string) {
    const room = this.requireHost(token);
    if (room.game && room.game.phase !== 'matchOver') throw new RoomError('The match is still in progress');
    room.game = null;
    room.ready.clear();
    this.clearTimer(room);
    this.publish(room, [], ['Back in the lobby.']);
  }

  // ----------------------------------------------------------------- game

  action(token: string, action: Action) {
    const room = this.requireRoom(token);
    const seat = this.seatOf(room, token);
    if (!room.game) throw new RoomError('The game has not started');
    if (seat === null) throw new RoomError('You are watching, not seated');
    room.game.apply(seat, action); // throws GameError on illegal moves
    this.flush(room, []);
  }

  ready(token: string) {
    const room = this.requireRoom(token);
    const seat = this.seatOf(room, token);
    if (!room.game || room.game.phase !== 'roundOver' || seat === null) return;
    room.ready.add(seat);
    this.maybeNextRound(room);
  }

  private maybeNextRound(room: Room, force = false) {
    const g = room.game!;
    if (g.phase !== 'roundOver') return;
    const waiting = room.seats
      .map((s, i) => ({ s, i }))
      .filter(({ s, i }) => s.kind === 'human' && !room.ready.has(i) && (room.members.get(s.token!)?.sockets.size ?? 0) > 0);
    if (waiting.length && !force) {
      this.publish(room, [], []);
      return;
    }
    room.ready.clear();
    const notices = this.swapInWaitingHumans(room);
    g.nextRound();
    this.flush(room, notices);
  }

  /** Between rounds, spectators who want to play take over bot seats. */
  private swapInWaitingHumans(room: Room): string[] {
    const notices: string[] = [];
    for (const m of room.members.values()) {
      if (!m.wantsSeat || this.seatOf(room, m.token) !== null) continue;
      const bot = room.seats.findIndex((s) => s.kind === 'bot');
      if (bot < 0) break;
      room.seats[bot] = { ...room.seats[bot], kind: 'human', token: m.token };
      m.wantsSeat = false;
      notices.push(`${m.name} took over seat ${bot + 1} from a bot.`);
    }
    return notices;
  }

  /** Host turns video chat on or off for this session. Turning it off switches every camera off. */
  setVideo(token: string, on: boolean) {
    const room = this.requireHost(token);
    room.videoEnabled = !!on;
    if (!on) for (const m of room.members.values()) m.cameraOn = false;
    this.publish(room, [], [on ? 'The host turned video chat on. Turn your camera on if you want to.' : 'The host turned video chat off.']);
  }

  setCamera(token: string, on: boolean) {
    const room = this.requireRoom(token);
    if (on && !room.videoEnabled) throw new RoomError('Video chat is off for this room');
    const m = room.members.get(token)!;
    m.cameraOn = !!on;
    this.publish(room, [], []);
  }

  /** Any player may turn text chat on; only the host may turn it off. */
  setChat(token: string, on: boolean) {
    const room = this.requireRoom(token);
    if (!on && room.hostToken !== token) throw new RoomError('Only the host can turn text chat off');
    if (room.chatEnabled === !!on) return;
    room.chatEnabled = !!on;
    const who = room.members.get(token)!.name;
    this.publish(room, [], [on ? `${who} turned text chat on.` : 'The host turned text chat off.']);
  }

  /** Quick emoji reaction to the whole table (shown at the sender's seat and in the chat). */
  react(token: string, emoji: unknown) {
    const room = this.requireRoom(token);
    if (typeof emoji !== 'string' || !(emoji in REACTIONS)) throw new RoomError('Unknown reaction');
    const m = room.members.get(token)!;
    this.rateLimit(m);
    room.chat.push({ id: ++room.chatSeq, memberId: m.publicId, name: m.name, text: emoji, time: Date.now(), kind: 'reaction', seat: this.seatOf(room, token) });
    if (room.chat.length > CHAT_KEEP) room.chat.splice(0, room.chat.length - CHAT_KEEP);
    this.publish(room, [], []);
  }

  /** Add or remove your emoji reaction on a chat message. */
  reactToMessage(token: string, messageId: unknown, emoji: unknown) {
    const room = this.requireRoom(token);
    if (typeof emoji !== 'string' || !(emoji in REACTIONS)) throw new RoomError('Unknown reaction');
    const msg = room.chat.find((c) => c.id === Number(messageId) && c.kind !== 'reaction');
    if (!msg) throw new RoomError('That message is no longer available');
    const me = room.members.get(token)!.publicId;
    const r = (msg.reactions ??= {});
    const list = (r[emoji] ??= []);
    const i = list.indexOf(me);
    if (i >= 0) list.splice(i, 1);
    else list.push(me);
    if (!list.length) delete r[emoji];
    this.publish(room, [], []);
  }

  private rateLimit(m: Member) {
    const now = Date.now();
    m.chatTimes = m.chatTimes.filter((t) => now - t < 10_000);
    if (m.chatTimes.length >= 8) throw new RoomError('You are sending messages too fast. Wait a moment.');
    m.chatTimes.push(now);
  }

  sendChat(token: string, text: unknown) {
    const room = this.requireRoom(token);
    if (!room.chatEnabled) throw new RoomError('The host has turned text chat off.');
    const clean = typeof text === 'string' ? text.replace(/\s+/g, ' ').trim().slice(0, CHAT_MAX_LEN) : '';
    if (!clean) throw new RoomError('Type a message first');
    const m = room.members.get(token)!;
    this.rateLimit(m);
    room.chat.push({ id: ++room.chatSeq, memberId: m.publicId, name: m.name, text: clean, time: Date.now(), kind: 'text', seat: this.seatOf(room, token) });
    if (room.chat.length > CHAT_KEEP) room.chat.splice(0, room.chat.length - CHAT_KEEP);
    this.publish(room, [], []);
  }

  setMic(token: string, muted: boolean) {
    const room = this.requireRoom(token);
    room.members.get(token)!.micMuted = !!muted;
    this.publish(room, [], []);
  }

  setVoice(token: string, socketId: string | null) {
    const room = this.requireRoom(token);
    room.members.get(token)!.voiceSocket = socketId;
    this.publish(room, [], []);
  }

  setWantsSeat(token: string, wants: boolean) {
    const room = this.requireRoom(token);
    const m = room.members.get(token)!;
    m.wantsSeat = !!wants && this.seatOf(room, token) === null;
    this.publish(room, [], []);
  }

  /** Publish pending engine events and (re)schedule bots/timers. */
  private flush(room: Room, notices: string[]) {
    const events = room.game ? room.game.drainEvents() : [];
    this.schedule(room);
    this.publish(room, events, notices);
  }

  private botDelay(room: Room): number {
    return this.opts.botDelay ?? BOT_DELAY_MS[room.settings.botSpeed];
  }

  /** Game features each connected client can show (see CLIENT_FEATURES in the web app). */
  private clientFeatures = new Map<string, number>();
  setClientFeatures(socketId: string, features: number) {
    this.clientFeatures.set(socketId, features);
  }
  /** The best feature level among a member's open connections (0 = an app from before Self Coat). */
  private featuresOf(m: Member): number {
    let best = 0;
    for (const s of m.sockets) best = Math.max(best, this.clientFeatures.get(s) ?? 0);
    return best;
  }

  private clearTimer(room: Room) {
    if (room.timer) clearTimeout(room.timer);
    room.timer = null;
    room.turnDeadline = null;
  }

  private schedule(room: Room) {
    this.clearTimer(room);
    const g = room.game;
    if (!g) return;
    if (g.phase === 'roundOver') {
      const seatedHumanOnline = room.seats.some((s) => s.kind === 'human' && (room.members.get(s.token!)?.sockets.size ?? 0) > 0);
      if (!seatedHumanOnline) {
        // Only bots (and maybe spectators) at the table: keep the match moving.
        room.timer = setTimeout(() => this.maybeNextRound(room, true), Math.max(this.botDelay(room) * 3, 10));
      } else if (room.settings.turnTimer > 0) {
        room.turnDeadline = Date.now() + 30000;
        room.timer = setTimeout(() => this.maybeNextRound(room, true), 30000);
      }
      return;
    }
    if (g.phase === 'matchOver') return;
    const seat = g.turn;
    const s = room.seats[seat];
    if (s.kind === 'bot') {
      room.timer = setTimeout(() => this.autoPlay(room, seat, null), this.botDelay(room));
      return;
    }
    const m = s.token ? room.members.get(s.token) : undefined;
    const disconnected = !m || m.sockets.size === 0;
    if (g.phase === 'continueChoice' && m && !disconnected && this.featuresOf(m) < 1) {
      // An older installed app has no Stop / Continue buttons: stop as those apps always did.
      room.timer = setTimeout(() => this.autoPlay(room, seat, `${m.name}'s app is an older version, so the round stopped at the bid. Update the app to get the Continue choice.`), 300);
      return;
    }
    let ms: number | null = room.settings.turnTimer > 0 ? room.settings.turnTimer * 1000 : null;
    if (disconnected) ms = Math.min(ms ?? Infinity, this.opts.disconnectGrace);
    if (ms !== null) {
      room.turnDeadline = Date.now() + ms;
      const name = m?.name ?? 'Player';
      room.timer = setTimeout(
        () => this.autoPlay(room, seat, disconnected ? `${name} is disconnected; a bot played for them.` : `Time is up for ${name}; a bot played for them.`),
        ms,
      );
    }
  }

  private autoPlay(room: Room, seat: number, notice: string | null) {
    room.timer = null;
    const g = room.game;
    if (!g || !this.rooms.has(room.code) || g.turn !== seat) return;
    const isBot = room.seats[seat].kind === 'bot';
    // Humans on autopilot finish their whole turn; bots act one step at a time.
    let guard = 0;
    do {
      const a = botDecide(viewFor(g, seat));
      if (!a) break;
      g.apply(seat, a);
    } while (!isBot && g.turn === seat && (g.phase === 'playing' || g.phase === 'bidding' || g.phase === 'trumpSelect' || g.phase === 'continueChoice') && ++guard < 5);
    this.flush(room, notice ? [notice] : []);
  }

  // ----------------------------------------------------------------- snapshots

  snapshotFor(room: Room, token: string): RoomSnapshot {
    const me = room.members.get(token)!;
    const mySeat = this.seatOf(room, token);
    const seats: SeatInfo[] = room.seats.map((s, i) => {
      const m = s.token ? room.members.get(s.token) : undefined;
      return {
        seat: i,
        kind: s.kind,
        name: s.kind === 'human' ? m?.name ?? 'Player' : s.kind === 'bot' ? s.botName : 'Empty seat',
        memberId: m?.publicId ?? null,
        connected: s.kind === 'bot' || (m ? m.sockets.size > 0 : false),
        micMuted: m?.micMuted ?? true,
        isHost: !!s.token && s.token === room.hostToken,
      };
    });
    const members: MemberInfo[] = [...room.members.values()].map((m) => ({
      memberId: m.publicId,
      name: m.name,
      seat: this.seatOf(room, m.token),
      connected: m.sockets.size > 0,
      micMuted: m.micMuted,
      voiceId: m.voiceSocket,
      wantsSeat: m.wantsSeat,
      cameraOn: room.videoEnabled && m.cameraOn,
    }));
    return {
      code: room.code,
      isPublic: room.isPublic,
      status: room.game ? 'playing' : 'lobby',
      settings: { ...room.settings },
      seats,
      members,
      you: { memberId: me.publicId, seat: mySeat, isHost: room.hostToken === token, name: me.name },
      view: room.game ? viewFor(room.game, mySeat) : null,
      ready: [...room.ready],
      turnDeadline: room.turnDeadline,
      videoEnabled: room.videoEnabled,
      chatEnabled: room.chatEnabled,
      chat: room.chat.slice(-50),
    };
  }

  eventsFor(room: Room, token: string, events: GameEvent[]): GameEvent[] {
    return eventsFor(events, this.seatOf(room, token));
  }

  /** Socket ids of members of `room` (for routing voice signals). */
  isVoicePeer(room: Room, socketId: string): boolean {
    return [...room.members.values()].some((m) => m.voiceSocket === socketId);
  }
}
