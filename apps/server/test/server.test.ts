import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { io as connect, Socket } from 'socket.io-client';
import { Action, RoomUpdate, botDecide } from '@g304/engine';
import { startServer } from '../src/server';

let srv: ReturnType<typeof startServer>;
let url = '';
const sockets: Socket[] = [];

beforeAll(async () => {
  srv = startServer({ port: 0, webRoot: null, botDelay: 1, disconnectGrace: 200 });
  url = `http://localhost:${await srv.ready}`;
});
afterAll(async () => {
  for (const s of sockets) s.disconnect();
  await srv.close();
});

let n = 0;
interface Client {
  socket: Socket;
  token: string;
  updates: RoomUpdate[];
  last: () => RoomUpdate;
  call: <T = unknown>(ev: string, payload?: object) => Promise<{ ok: boolean; data?: T; error?: string }>;
  waitFor: (pred: (u: RoomUpdate) => boolean, ms?: number) => Promise<RoomUpdate>;
}

function client(token = `test-token-${++n}-${Date.now()}`): Promise<Client> {
  const socket = connect(url, { auth: { token }, transports: ['websocket'], forceNew: true });
  sockets.push(socket);
  const updates: RoomUpdate[] = [];
  const waiters: { pred: (u: RoomUpdate) => boolean; res: (u: RoomUpdate) => void }[] = [];
  socket.on('room', (u: RoomUpdate | null) => {
    if (!u) return;
    updates.push(u);
    for (const w of [...waiters]) if (w.pred(u)) {
      waiters.splice(waiters.indexOf(w), 1);
      w.res(u);
    }
  });
  const c: Client = {
    socket,
    token,
    updates,
    last: () => updates[updates.length - 1],
    call: (ev, payload = {}) => new Promise((res) => socket.emit(ev, payload, res)),
    waitFor: (pred, ms = 15000) =>
      new Promise((res, rej) => {
        const hit = updates.length && pred(updates[updates.length - 1]) ? updates[updates.length - 1] : null;
        if (hit) return res(hit);
        const t = setTimeout(() => rej(new Error('timeout waiting for update')), ms);
        waiters.push({ pred, res: (u) => (clearTimeout(t), res(u)) });
      }),
  };
  return new Promise((res) => socket.on('connect', () => res(c)));
}

/** Every card id in a payload must be the receiver's own card, own hidden trump, or a played card. */
function assertNoLeak(u: RoomUpdate) {
  const v = u.room.view;
  const json = JSON.stringify(u);
  const ids = [...json.matchAll(/"id":"([^"]+)"/g)].map((m) => m[1]);
  if (!v) {
    expect(ids).toEqual([]);
    return;
  }
  const allowed = new Set<string>();
  v.myHand.forEach((c) => allowed.add(c.id));
  v.currentTrick?.plays.forEach((p) => allowed.add(p.card.id));
  v.completedTricks.forEach((t) => t.plays.forEach((p) => allowed.add(p.card.id)));
  for (const id of ids) expect(allowed.has(id), `leaked card ${id} to seat ${v.seat}`).toBe(true);
  if (v.phase === 'playing' && !v.trumpRevealed && v.contract && v.contract.bidder !== v.seat) {
    // Issue 6.6: until the reveal, a non-bidder device receives no trump suit by any route.
    expect(v.trumpSuit).toBeNull();
    expect(v.myTrumpIndicator).toBeNull();
    expect(json).not.toContain('yourTrump');
    // (lastResult describes the previous, finished round — its trump is public by then.)
    expect(JSON.stringify({ ...u, room: { ...u.room, view: { ...v, lastResult: null } } })).not.toMatch(/"trumpSuit":"[SHCD]"/);
    expect(u.events.some((e) => e.kind === 'trumpRevealed')).toBe(false);
    // Trump-suit plays are not flagged as trump to anyone else while hidden.
    const plays = [...(v.currentTrick?.plays ?? []), ...v.completedTricks.flatMap((t) => t.plays)];
    expect(plays.some((p) => p.asTrump)).toBe(false);
    expect(u.events.some((e) => e.kind === 'cardPlayed' && e.asTrump)).toBe(false);
  }
}

describe('rooms over websockets', () => {
  it('rejects connections without a token', async () => {
    const s = connect(url, { transports: ['websocket'], forceNew: true });
    sockets.push(s);
    const msg = await new Promise((res) => s.on('fatal', res));
    expect(msg).toMatch(/token/);
  });

  it('two humans + bots play a full 4-player match with no card leaks', async () => {
    const host = await client();
    const guest = await client();
    const created = await host.call<string>('createRoom', { name: 'Priya', settings: { numPlayers: 4, matchTarget: 6 } });
    expect(created.ok).toBe(true);
    const code = created.data!;
    expect(code).toMatch(/^\d{6}$/);

    expect((await guest.call('joinRoom', { code: '12', name: 'x' })).ok).toBe(false);
    expect((await guest.call('joinRoom', { code, name: 'Arjun' })).ok).toBe(true);
    // Non-host cannot start; empty seats block the start.
    expect((await guest.call('start')).error).toMatch(/host/);
    expect((await host.call('start')).error).toMatch(/Fill/);
    await host.call('fillBots');
    expect((await host.call('start')).ok).toBe(true);

    // Each human plays with the bot brain, from their own sanitized view only.
    const drive = (c: Client) => {
      c.socket.on('room', (u: RoomUpdate | null) => {
        if (!u?.room.view) return;
        const v = u.room.view;
        if (v.phase === 'roundOver' && v.seat !== null && !u.room.ready.includes(v.seat)) c.call('ready');
        if (v.seat !== null && v.turn === v.seat) {
          const a = botDecide(v) as Action | null;
          if (a) c.call('action', { action: a });
        }
      });
      // Kick off in case it is already our turn.
      const u = c.last();
      const v = u?.room.view;
      if (v && v.turn === v.seat) c.call('action', { action: botDecide(v) });
    };

    const illegal = await guest.call('action', { action: { type: 'play', cardId: 'XX' } });
    expect(illegal.ok).toBe(false);

    drive(host);
    drive(guest);
    const end = await host.waitFor((u) => u.room.view?.phase === 'matchOver', 60000);
    expect(Math.max(...end.room.view!.scores)).toBeGreaterThanOrEqual(6);

    for (const u of [...host.updates, ...guest.updates]) assertNoLeak(u);
    // Each human saw round starts and their own turns announced.
    const kinds = new Set(guest.updates.flatMap((u) => u.events.map((e) => e.kind)));
    expect(kinds.has('roundStart')).toBe(true);
    expect(kinds.has('trickWon')).toBe(true);
    // Only the bidder ever receives the private "your trump" event.
    for (const c of [host, guest])
      for (const u of c.updates)
        for (const e of u.events) if (e.kind === 'yourTrump') expect(e.seat).toBe(u.room.you.seat);

    expect((await host.call('backToLobby')).ok).toBe(true);
    host.socket.disconnect();
    guest.socket.disconnect();
  });

  it('reconnecting with the same token restores the seat; disconnected turns auto-play', async () => {
    const host = await client();
    const code = (await host.call<string>('createRoom', { name: 'Host', settings: { numPlayers: 2 } })).data!;
    const token = `rejoin-token-${Date.now()}`;
    const p2 = await client(token);
    await p2.call('joinRoom', { code, name: 'Meera' });
    await host.call('start');
    const seatBefore = p2.last().room.you.seat;
    expect(seatBefore).toBe(1);
    p2.socket.disconnect();
    await host.waitFor((u) => u.room.seats[1].connected === false);

    const p2b = await client(token);
    const u = await p2b.waitFor((x) => x.room.code === code);
    expect(u.room.you.seat).toBe(1);
    expect(u.room.view!.myHand.length).toBeGreaterThan(0);
    expect(u.room.view!.seat).toBe(1);

    // Disconnect again; if it is that seat's turn a bot plays for it after the grace period.
    p2b.socket.disconnect();
    const before = host.updates.length;
    const v = host.last().room.view!;
    if (v.turn === 1) await host.waitFor((x) => x.room.view!.turn !== 1 || x.room.view!.phase !== v.phase, 5000);
    expect(host.updates.length).toBeGreaterThanOrEqual(before);
    host.socket.disconnect();
  });

  it('a human joining mid-game takes over a bot seat at the next round', async () => {
    const host = await client();
    const code = (await host.call<string>('createRoom', { name: 'Host', settings: { numPlayers: 2, matchTarget: 50 } })).data!;
    await host.call('fillBots');
    await host.call('start');
    const late = await client();
    await late.call('joinRoom', { code, name: 'Late' });
    let u = late.last();
    expect(u.room.you.seat).toBeNull();
    expect(u.room.view!.myHand).toEqual([]);
    assertNoLeak(u);
    // Host autoplays to the end of the round.
    host.socket.on('room', (x: RoomUpdate | null) => {
      const v = x?.room.view;
      if (!v || v.seat === null) return;
      if (v.phase === 'roundOver') host.call('ready');
      else if (v.turn === v.seat) host.call('action', { action: botDecide(v) });
    });
    const v0 = host.last().room.view!;
    if (v0.turn === v0.seat) host.call('action', { action: botDecide(v0) });
    u = await late.waitFor((x) => x.room.you.seat === 1, 30000);
    expect(u.notices.join(' ')).toMatch(/took over seat 2/);
    for (const x of late.updates) assertNoLeak(x);
    host.socket.disconnect();
    late.socket.disconnect();
  });

  it('relays voice signals only between voice participants in the same room', async () => {
    const a = await client();
    const b = await client();
    const outsider = await client();
    const code = (await a.call<string>('createRoom', { name: 'A' })).data!;
    await b.call('joinRoom', { code, name: 'B' });
    await outsider.call('createRoom', { name: 'O' });
    await a.call('voice', { on: true });
    await b.call('voice', { on: true });
    await outsider.call('voice', { on: true });

    const got = new Promise<{ from: string; data: unknown }>((res) => b.socket.on('signal', res));
    let leaked = false;
    a.socket.on('signal', () => (leaked = true));
    outsider.socket.emit('signal', { to: a.socket.id, data: 'evil' });
    a.socket.emit('signal', { to: b.socket.id, data: { sdp: 'offer' } });
    const msg = await got;
    expect(msg).toEqual({ from: a.socket.id, data: { sdp: 'offer' } });
    await new Promise((r) => setTimeout(r, 100));
    expect(leaked).toBe(false);

    const snap = b.last().room;
    expect(snap.members.filter((m) => m.voiceId)).toHaveLength(2);
    await b.call('mic', { muted: true });
    const s2 = await a.waitFor((u) => u.room.members.some((m) => m.name === 'B' && m.micMuted));
    expect(s2.room.seats[1].micMuted).toBe(true);
  });

  it('validates lobby settings', async () => {
    const h = await client();
    await h.call('createRoom', { name: 'H' });
    expect((await h.call('updateSettings', { settings: { numPlayers: 5 } })).ok).toBe(false);
    expect((await h.call('updateSettings', { settings: { turnTimer: 7 } })).ok).toBe(false);
    expect((await h.call('updateSettings', { settings: { numPlayers: 8, turnTimer: 30, botSpeed: 'relaxed' } })).ok).toBe(true);
    expect(h.last().room.seats).toHaveLength(8);
    expect(h.last().room.settings).toMatchObject({ numPlayers: 8, turnTimer: 30, botSpeed: 'relaxed' });
  });
});

describe('voice relay fallback', () => {
  it('relays audio packets only to voice peers in the same room', async () => {
    const a = await client();
    const b = await client();
    const c = await client();
    const code = (await a.call<string>('createRoom', { name: 'A' })).data!;
    await b.call('joinRoom', { code, name: 'B' });
    await c.call('createRoom', { name: 'C' });
    for (const x of [a, b, c]) await x.call('voice', { on: true });
    const got = new Promise<{ from: string; d: ArrayBuffer }>((res) => b.socket.on('vrelay', res));
    let leaked = false;
    c.socket.on('vrelay', () => (leaked = true));
    const pkt = new Uint8Array([1, 2, 3, 4]).buffer;
    a.socket.emit('vrelay', { to: [c.socket.id], d: pkt }); // other room: dropped
    a.socket.emit('vrelay', { to: [b.socket.id], d: new Uint8Array(9000).buffer }); // too big: dropped
    a.socket.emit('vrelay', { to: [b.socket.id], d: pkt });
    const m = await got;
    expect(m.from).toBe(a.socket.id);
    expect([...new Uint8Array(m.d)]).toEqual([1, 2, 3, 4]);
    await new Promise((r) => setTimeout(r, 100));
    expect(leaked).toBe(false);
  });
});

describe('video chat (host controlled)', () => {
  it('is available by default with cameras off; only the host can disable it; disabling turns cameras off', async () => {
    const host = await client();
    const guest = await client();
    const code = (await host.call<string>('createRoom', { name: 'Host' })).data!;
    await guest.call('joinRoom', { code, name: 'Guest' });
    expect(guest.last().room.videoEnabled).toBe(true);
    expect(guest.last().room.members.every((m) => !m.cameraOn)).toBe(true);
    expect((await guest.call('setVideo', { on: false })).error).toMatch(/host/);
    // While the host has video off, nobody can switch a camera on.
    await host.call('setVideo', { on: false });
    await guest.waitFor((x) => !x.room.videoEnabled);
    expect((await guest.call('camera', { on: true })).error).toMatch(/off/);

    expect((await host.call('setVideo', { on: true })).ok).toBe(true);
    let u = await guest.waitFor((x) => x.room.videoEnabled);
    expect(u.notices.join(' ')).toMatch(/turned video chat on/);
    // Each player still chooses their own camera.
    expect(u.room.members.every((m) => !m.cameraOn)).toBe(true);
    expect((await guest.call('camera', { on: true })).ok).toBe(true);
    u = await host.waitFor((x) => x.room.members.some((m) => m.name === 'Guest' && m.cameraOn));

    expect((await host.call('setVideo', { on: false })).ok).toBe(true);
    u = await guest.waitFor((x) => !x.room.videoEnabled);
    expect(u.room.members.every((m) => !m.cameraOn)).toBe(true);
    expect(u.notices.join(' ')).toMatch(/turned video chat off/);
  });
});

describe('text chat and reactions', () => {
  it('is on from the start; only the host can turn it off', async () => {
    const host = await client();
    const guest = await client();
    const code = (await host.call<string>('createRoom', { name: 'Host' })).data!;
    await guest.call('joinRoom', { code, name: 'Guest' });
    expect(guest.last().room.chatEnabled).toBe(true);
    expect((await guest.call('chat', { text: '  hello   all  ' })).ok).toBe(true);
    const u = await host.waitFor((x) => x.room.chat.length > 0);
    expect(u.room.chat[0]).toMatchObject({ name: 'Guest', text: 'hello all', kind: 'text' });
    expect((await guest.call('chat', { text: '   ' })).ok).toBe(false);
    expect((await guest.call('chat', { text: 'x'.repeat(500) })).ok).toBe(true);
    expect((await host.waitFor((x) => x.room.chat.length === 2)).room.chat[1].text).toHaveLength(300);
    expect((await guest.call('setChat', { on: false })).error).toMatch(/host/);
    expect((await host.call('setChat', { on: false })).ok).toBe(true);
    expect((await guest.call('chat', { text: 'hi' })).error).toMatch(/off/);
  });

  it('sends quick emoji reactions and toggles reactions on messages', async () => {
    const host = await client();
    const guest = await client();
    const code = (await host.call<string>('createRoom', { name: 'Host' })).data!;
    await guest.call('joinRoom', { code, name: 'Guest' });
    expect((await guest.call('react', { emoji: '👏' })).ok).toBe(true);
    expect((await guest.call('react', { emoji: '<script>' })).ok).toBe(false);
    let u = await host.waitFor((x) => x.room.chat.some((c) => c.kind === 'reaction'));
    expect(u.room.chat.find((c) => c.kind === 'reaction')).toMatchObject({ name: 'Guest', text: '👏', seat: 1 });
    await host.call('chat', { text: 'nice hand' });
    const msg = (await guest.waitFor((x) => x.room.chat.some((c) => c.text === 'nice hand'))).room.chat.find((c) => c.text === 'nice hand')!;
    await guest.call('reactMessage', { id: msg.id, emoji: '😂' });
    u = await host.waitFor((x) => !!x.room.chat.find((c) => c.id === msg.id)?.reactions?.['😂']);
    expect(u.room.chat.find((c) => c.id === msg.id)!.reactions!['😂']).toHaveLength(1);
    await guest.call('reactMessage', { id: msg.id, emoji: '😂' });
    u = await host.waitFor((x) => !x.room.chat.find((c) => c.id === msg.id)?.reactions?.['😂']);
    expect(u.room.chat.find((c) => c.id === msg.id)!.reactions?.['😂']).toBeUndefined();
  });
});

describe('older installed apps and the Stop / Continue choice', () => {
  /** One human (bidding whenever possible) + 3 bots; resolves with the first bid-reached moment for the human. */
  async function humanReachesBid(features: number | undefined) {
    const token = `feat-${features}-${++n}-${Date.now()}`;
    const socket = connect(url, { auth: features === undefined ? { token } : { token, features }, transports: ['websocket'], forceNew: true });
    sockets.push(socket);
    await new Promise<void>((r) => socket.on('connect', () => r()));
    const call = (ev: string, p: object = {}) => new Promise<{ ok: boolean; data?: string }>((r) => socket.emit(ev, p, r));
    const code = (await call('createRoom', { name: 'Old', settings: { numPlayers: 4, matchTarget: 100 } })).data!;
    expect(code).toMatch(/^\d{6}$/);
    await call('fillBots');
    const updates: RoomUpdate[] = [];
    const seen = new Promise<RoomUpdate>((resolve) => {
      socket.on('room', (u: RoomUpdate | null) => {
        if (!u?.room.view) return;
        updates.push(u);
        const v = u.room.view;
        if (v.phase === 'continueChoice' && v.turn === v.seat) return resolve(u); // never answer it here
        if (v.phase === 'roundOver' && v.seat !== null && !u.room.ready.includes(v.seat)) void call('ready');
        if (v.seat !== null && v.turn === v.seat) {
          // Bid the lowest value whenever possible, so this player is often the bidder.
          const a = v.phase === 'bidding' && v.legal!.bidOptions.length ? { type: 'bid', value: v.legal!.bidOptions[0] } : botDecide(v);
          if (a) void call('action', { action: a });
        }
      });
    });
    await call('start');
    const at = await seen;
    return { socket, call, updates, at };
  }

  it('an app from before the choice (no feature level) is stopped for automatically, as before', async () => {
    const { socket, updates, at } = await humanReachesBid(undefined);
    const since = updates.length;
    await new Promise((r) => setTimeout(r, 1500));
    const after = updates.slice(since);
    expect(after.some((u) => u.events.some((e) => e.kind === 'roundOver' && e.result.stopReason === 'bidReached'))).toBe(true);
    expect(after.some((u) => u.notices.some((t) => /older version/.test(t)))).toBe(true);
    expect(at.room.view!.phase).toBe('continueChoice');
    socket.disconnect();
  }, 60000);

  it('a current app gets the choice and the game waits for it', async () => {
    const { socket, call, updates } = await humanReachesBid(1);
    const since = updates.length;
    await new Promise((r) => setTimeout(r, 1500));
    expect(updates.slice(since).some((u) => u.events.some((e) => e.kind === 'roundOver'))).toBe(false);
    expect((await call('action', { action: { type: 'continueRound' } })).ok).toBe(true);
    socket.disconnect();
  }, 60000);
});
