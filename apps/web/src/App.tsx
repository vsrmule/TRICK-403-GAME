import { useEffect, useRef, useState } from 'react';
import { REACTIONS, catalog, describeEvent, guidance, scoreStatus, tableStatus, voiceGuidance, voiceJoined, voiceStillWaiting, voiceTurnOf } from '@g304/engine';
import type { RoomUpdate } from '@g304/engine';
import { announcer, useAnnouncer } from './announcer';
import { onRoomUpdate, useNet } from './net';
import { prefs, usePrefs } from './prefs';
import { music } from './music';
import { sfx } from './sfx';
import { useVoice, voice } from './voice';
import { BasketDialog, HelpDialog, SettingsDialog } from './components/Dialogs';
import { CaptionStrip } from './components/Captions';
import { ChatPanel } from './components/Chat';
import { Home } from './components/Home';
import { Intro } from './components/Intro';
import { VideoPanel } from './components/Video';
import { Lobby } from './components/Lobby';
import { UpdateBanner } from './components/UpdateBanner';
import { Table } from './components/Table';
import { BrandMark, Dialog, Icon, ToolButton, act, names } from './components/ui';

let seed = 0;
let lastChatId = 0;
let tipGiven = false;
/** Reminder when a friend is taking a while on their turn. */
let waitTimer: number | null = null;
const STILL_WAITING_MS = 20000;

/** Turn server pushes into spoken announcements (voice + text) and sound effects. */
function handleUpdate(u: RoomUpdate | null, prevCode: { current: string | null }) {
  if (!u) {
    if (prevCode.current) announcer.say('You left the room.');
    prevCode.current = null;
    return;
  }
  const room = u.room;
  const p = prefs.get();
  const L = catalog(p.lang);
  const firstUpdate = prevCode.current !== room.code;
  if (firstUpdate) {
    const joined =
      room.status === 'lobby'
        ? `Joined room ${room.code.split('').join(' ')}. ${room.you.isHost ? 'You are the host.' : ''}`
        : `Joined room ${room.code.split('').join(' ')}. Game in progress.`;
    announcer.say({ text: joined, voice: joined, clips: voiceJoined(room.code, room.status !== 'lobby', room.you.isHost) });
    prevCode.current = room.code;
    lastChatId = room.chat.length ? room.chat[room.chat.length - 1].id : 0; // don't read old history aloud
  }
  // The "Joined room …" line already covers the first update's own notices (e.g. "You created room …").
  // A cancelled round is always also read by the screen reader, even when the game voice says it.
  if (!firstUpdate) for (const n of u.notices) announcer.say(n, { kind: 'system', alsoScreenReader: /^Round cancelled:/.test(n) });

  const v = room.view;
  // "Still waiting for …": one gentle reminder if another person takes a long time.
  if (waitTimer) clearTimeout(waitTimer);
  waitTimer = null;
  if (v && v.seat !== null && v.turn !== v.seat && v.turn >= 0 && room.seats[v.turn]?.kind === 'human' && ['bidding', 'trumpSelect', 'playing', 'continueChoice'].includes(v.phase)) {
    const text = `Still waiting for ${room.seats[v.turn].name}.`;
    const clips = voiceStillWaiting(v.turn, v.seat, names(room));
    waitTimer = window.setTimeout(() => announcer.say({ text, voice: text, clips }), STILL_WAITING_MS);
  }
  if (v) {
    const n = names(room);
    const me = room.you.seat;
    const myTeam = me !== null ? v.teams[me] : null;
    for (const e of u.events) {
      announcer.say(describeEvent(e, n, me, v, ++seed, L));
      switch (e.kind) {
        case 'roundStart':
          sfx.play('deal');
          break;
        case 'bid':
          sfx.play(e.action.type === 'pass' ? 'pass' : e.action.type === 'challengeCoat' || e.action.type === 'selfCoat' ? 'coat' : 'bid');
          break;
        case 'trumpAsked':
          sfx.play('askTrump');
          break;
        case 'trumpRevealed':
          sfx.play('trump');
          break;
        case 'cardPlayed':
          sfx.play('play');
          break;
        case 'trickWon':
          sfx.play(myTeam === null || myTeam === e.team ? 'trickWin' : 'trickLose');
          break;
        case 'coat':
          sfx.play('coat');
          break;
        case 'bidReached':
          if (e.seat === me) {
            sfx.play('turn');
            if (p.haptics) navigator.vibrate?.(120);
          }
          break;
        case 'turn':
          if (e.seat === me) {
            sfx.play('turn');
            if (p.haptics) navigator.vibrate?.(120);
            // Instruct: tell the player exactly what they can do now (with or without a screen reader).
            if (p.guidance && e === u.events.filter((x) => x.kind === 'turn').pop()) {
              const g = guidance(v, n, { isHost: room.you.isHost }, L);
              announcer.say({ text: g, voice: g, clips: voiceGuidance(v, n, { isHost: room.you.isHost }) });
              if (!tipGiven) {
                tipGiven = true;
                announcer.say(L.guide.tip());
              }
            }
          } else if (e.phase === 'playing' && room.seats[e.seat]?.kind === 'human' && e === u.events.filter((x) => x.kind === 'turn').pop()) {
            // Narrate whose turn it is when we're waiting on another person (bots act within seconds).
            const t = `${n[e.seat]}'s turn.`;
            announcer.say({ text: t, voice: t, clips: voiceTurnOf(e.seat, me, n) });
          }
          break;
        case 'roundOver':
          sfx.play('roundEnd');
          if (p.guidance && me !== null) announcer.say(L.guide.ready());
          // DEFAULT: the encouraging sound plays for the winning side only.
          if (myTeam !== null && e.result.awarded[myTeam] > 0) setTimeout(() => sfx.play('cheer'), 700);
          break;
        case 'matchOver':
          setTimeout(() => sfx.play('matchWin'), 1200);
          break;
      }
    }
  }

  // Text chat: read new messages from others politely, after game announcements.
  for (const m of room.chat) {
    if (m.id <= lastChatId) continue;
    lastChatId = m.id;
    if (m.memberId === room.you.memberId) continue;
    sfx.play('chat');
    if (!p.readChat) continue;
    if (m.kind === 'reaction') announcer.say({ text: `${m.name} reacted ${m.text} ${REACTIONS[m.text] ?? ''}`, voice: `${m.name} reacted: ${REACTIONS[m.text] ?? m.text}.` }, { kind: 'chat' });
    else announcer.say(`${m.name} says: ${m.text}`, { kind: 'chat' });
  }
}

export function App() {
  const net = useNet();
  const p = usePrefs();
  const vs = useVoice();
  const { live } = useAnnouncer();
  const [dialog, setDialog] = useState<'basket' | 'settings' | 'help' | 'more' | null>(null);
  const prevCode = useRef<string | null>(null);
  const room = net.update?.room ?? null;
  const [intro, setIntro] = useState(() => prefs.get().playIntro);
  const ptt = useRef({ down: 0, latched: false });

  useEffect(() => {
    music.sync();
    const replay = () => setIntro(true);
    window.addEventListener('g304:intro', replay);
    return () => window.removeEventListener('g304:intro', replay);
  }, []);

  useEffect(() => onRoomUpdate((u) => handleUpdate(u, prevCode)), []);

  useEffect(() => {
    const el = document.documentElement;
    el.dataset.theme = p.theme;
    el.dataset.suits = p.suits;
    el.dataset.motion = p.motion;
    el.style.setProperty('--text-scale', String(p.textScale));
    const L = catalog(p.lang);
    el.lang = L.code;
    el.dir = L.dir; // right-to-left languages flip the layout
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', p.theme === 'light' ? '#F5F1E8' : p.theme === 'high-contrast' ? '#000000' : '#0A0F1C');
  }, [p.theme, p.suits, p.motion, p.textScale, p.lang]);

  // Auto-join room voice; keep peers in sync with room membership.
  useEffect(() => {
    if (room && vs.status === 'off') void voice.join();
    if (!room && vs.status !== 'off') void voice.leave();
  }, [room?.code]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (room) voice.sync(room.members, room.videoEnabled, room.you.memberId);
  }, [room, vs.status]);

  const readTable = () => {
    if (!room) return announcer.say('You are not in a room.', { interrupt: true });
    if (!room.view) {
      const filled = room.seats.filter((s) => s.kind !== 'empty').length;
      return announcer.say(`Lobby, room ${room.code.split('').join(' ')}. ${filled} of ${room.seats.length} seats filled: ${room.seats.map((s) => s.name).join(', ')}.`, {
        interrupt: true,
      });
    }
    announcer.say(tableStatus(room.view, names(room)), { interrupt: true });
  };
  const readScore = () => {
    if (!room?.view) return announcer.say('The game has not started.', { interrupt: true });
    announcer.say(scoreStatus(room.view, names(room)), { interrupt: true });
  };
  const toggleMic = () => {
    sfx.unlock();
    if (vs.status === 'off' || vs.status === 'listenOnly') {
      announcer.say(vs.status === 'off' ? 'Voice chat is off.' : 'No microphone available.', { interrupt: true });
      return;
    }
    const muted = voice.toggleMute();
    announcer.say(muted ? 'Microphone muted.' : 'Microphone on.', { interrupt: true });
  };
  const focusHand = () => {
    const first = document.querySelector<HTMLElement>('#hand button.card[aria-disabled="false"]') ?? document.getElementById('hand');
    if (first) first.focus();
    else announcer.say('You have no hand right now.', { interrupt: true });
  };

  // Keyboard shortcuts: plain letters outside text fields; Alt+Shift+letter anywhere (works in screen reader browse mode).
  const whatNow = () => {
    if (!room?.view) {
      announcer.say(
        room
          ? room.you.isHost
            ? 'You are in the lobby. Fill empty seats with bots or wait for friends, then choose Start game.'
            : 'You are in the lobby. Waiting for the host to start the game.'
          : 'Enter your name, then create a room or join one with a 6-digit code.',
        { interrupt: true },
      );
      return;
    }
    const v = room.view;
    const opts = { ready: v.seat !== null && room.ready.includes(v.seat), isHost: room.you.isHost };
    const g = guidance(v, names(room), opts, catalog(p.lang));
    announcer.say({ text: g, voice: g, clips: voiceGuidance(v, names(room), opts) }, { interrupt: true });
  };
  const leaveRoom = () => {
    if (window.confirm(room?.status === 'playing' ? 'Leave the game? A bot will take your seat.' : 'Leave the room?')) void act('leaveRoom');
  };
  const copyCode = async () => {
    if (!room) return;
    try {
      await navigator.clipboard.writeText(room.code);
      announcer.say('Room code copied.', { interrupt: true });
    } catch {
      announcer.say(`Room code ${room.code.split('').join(' ')}`, { interrupt: true });
    }
  };
  const focusChat = () => {
    const el = document.getElementById('chat-input') ?? document.getElementById('chat-toggle');
    if (el) el.focus();
    else announcer.say('Text chat is available once you are in a room.', { interrupt: true });
  };
  const handlers = useRef({ readTable, readScore, toggleMic, focusHand, focusChat, whatNow });
  handlers.current = { readTable, readScore, toggleMic, focusHand, focusChat, whatNow };
  useEffect(() => {
    const typing = (t: EventTarget | null) =>
      t instanceof HTMLElement && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName)) && !(t instanceof HTMLInputElement && ['checkbox', 'radio', 'range'].includes(t.type));
    const down = (e: KeyboardEvent) => {
      const combo = e.altKey && e.shiftKey && !e.ctrlKey && !e.metaKey;
      const plain = !e.altKey && !e.ctrlKey && !e.metaKey && !typing(e.target);
      if (!combo && !plain) return;
      const k = e.code.startsWith('Key') ? e.code.slice(3).toLowerCase() : e.key;
      const dialogOpen = !!document.querySelector('dialog[open]');
      const h = handlers.current;
      let used = true;
      if (k === 't') h.readTable();
      else if (k === 's') h.readScore();
      else if (k === 'm') h.toggleMic();
      else if (k === 'b' && !dialogOpen) setDialog('basket');
      else if (k === 'h' && !dialogOpen) h.focusHand();
      else if (k === 'c' && !dialogOpen) h.focusChat();
      else if (k === 'i') h.whatNow();
      else if ((e.key === '?' || k === 'slash') && !dialogOpen) setDialog('help');
      else if (k === 'v' && prefs.get().pushToTalk) {
        if (!e.repeat) voice.setPtt(true);
      } else used = false;
      if (used) e.preventDefault();
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === 'KeyV') voice.setPtt(false);
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, []);

  const micLabel = vs.status === 'on' ? (vs.muted ? 'Mic off' : p.pushToTalk ? 'Mic: push to talk' : 'Mic on') : vs.status === 'listenOnly' ? 'No mic' : 'Voice off';

  return (
    <div className="app" onPointerDown={() => sfx.unlock()}>
      <a href="#main" className="skip">
        Skip to main content
      </a>
      <UpdateBanner />
      {room && (
        <header className={`shell${room.status === 'playing' ? ' playing' : ''}`} role="banner">
          <span className="brand">
            <BrandMark />
            <span className="brand-word">
              Trick <b>304</b>
            </span>
          </span>
          <nav aria-label="Quick status" className="toolbar">
            <ToolButton icon="compass" label="What now?" kbd="I" onClick={whatNow} tone="accent" />
            {room.status === 'playing' && (
              <>
                <ToolButton icon="table" label="Table" kbd="T" onClick={readTable} />
                <ToolButton icon="trophy" label="Score" kbd="S" onClick={readScore} />
                <ToolButton icon="basket" label="Basket" kbd="B" onClick={() => setDialog('basket')} />
              </>
            )}
            <ToolButton
              icon={vs.status === 'on' && !vs.muted ? 'mic' : 'micOff'}
              label={micLabel}
              kbd="M"
              onClick={toggleMic}
              pressed={vs.status === 'on' ? !vs.muted : undefined}
              tone={vs.status === 'on' && !vs.muted ? 'live' : undefined}
            />
            {p.pushToTalk && vs.status === 'on' && !vs.muted && (
              <button
                className={`tb${vs.talking ? ' tb-live' : ''}`}
                aria-pressed={vs.talking}
                aria-describedby="ptt-hint"
                onPointerDown={() => {
                  ptt.current.down = Date.now();
                  voice.setPtt(true);
                }}
                onPointerUp={() => {
                  // A long press is hold-to-talk; a short tap toggles (handled in onClick).
                  if (Date.now() - ptt.current.down >= 400) {
                    voice.setPtt(false);
                    ptt.current.latched = false;
                    ptt.current.down = -1;
                  }
                }}
                onPointerCancel={() => voice.setPtt(false)}
                onClick={() => {
                  if (ptt.current.down === -1) {
                    ptt.current.down = 0;
                    return; // a hold just finished
                  }
                  // Tap, keyboard or screen-reader activation: toggle talking on and off.
                  ptt.current.latched = !ptt.current.latched;
                  voice.setPtt(ptt.current.latched);
                  announcer.say(ptt.current.latched ? 'Talking. Activate again to stop.' : 'Stopped talking.', { interrupt: true });
                }}
              >
                <Icon name="talk" />
                <span className="tb-label">Push to talk: {vs.talking ? 'Talking' : 'Not talking'}</span>
              </button>
            )}
            <span id="ptt-hint" hidden>
              Hold to talk, or activate once to start talking and again to stop.
            </span>
            {room.videoEnabled && (
              <ToolButton
                icon={vs.cameraOn ? 'camera' : 'cameraOff'}
                label={vs.cameraOn ? 'Camera on' : 'Camera off'}
                onClick={() => void voice.setCamera(!vs.cameraOn)}
                pressed={vs.cameraOn}
                tone={vs.cameraOn ? 'live' : undefined}
                className="tb-secondary"
              />
            )}
            <ToolButton icon="chat" label="Chat" kbd="C" onClick={focusChat} className="tb-secondary" />
            <ToolButton icon="gear" label="Settings" onClick={() => setDialog('settings')} className="tb-secondary" />
            <ToolButton icon="help" label="Help" kbd="?" onClick={() => setDialog('help')} className="tb-secondary" />
            <ToolButton icon="leave" label="Leave" onClick={leaveRoom} className="tb-secondary" tone="danger" />
            <ToolButton icon="more" label="More" onClick={() => setDialog('more')} className="tb-more" />
          </nav>
          <button className="room-pill" onClick={copyCode} aria-label={`Room ${room.code}, copy room code`}>
            <span className="room-pill-k">Room</span> {room.code}
            <Icon name="copy" size={16} />
          </button>
        </header>
      )}
      {!net.connected && (
        <p role="alert" className="banner">
          Connection lost. Reconnecting…
        </p>
      )}
      {intro && !room ? (
        <Intro onDone={() => setIntro(false)} />
      ) : !room ? (
        <Home connected={net.connected} />
      ) : (
        <>
          {room.status === 'lobby' ? <Lobby room={room} /> : <Table room={room} />}
          <div className="side-panels">
            <VideoPanel room={room} />
            <ChatPanel room={room} />
          </div>
        </>
      )}
      {(room || !intro) && <CaptionStrip room={room} />}

      {room && <BasketDialog room={room} open={dialog === 'basket'} onClose={() => setDialog(null)} />}
      <SettingsDialog room={room} open={dialog === 'settings'} onClose={() => setDialog(null)} />
      <HelpDialog open={dialog === 'help'} onClose={() => setDialog(null)} />
      <Dialog open={dialog === 'more'} onClose={() => setDialog(null)} title="More">
        <div className="more-menu">
          <button className="btn tonal big" onClick={() => { setDialog(null); setTimeout(focusChat, 50); }}>
            <Icon name="chat" /> Text chat
          </button>
          {room?.videoEnabled && (
            <button className="btn tonal big" aria-pressed={vs.cameraOn} onClick={() => { setDialog(null); void voice.setCamera(!vs.cameraOn); }}>
              <Icon name={vs.cameraOn ? 'camera' : 'cameraOff'} /> {vs.cameraOn ? 'Turn camera off' : 'Turn camera on'}
            </button>
          )}
          <button className="btn tonal big" onClick={() => setDialog('settings')}>
            <Icon name="gear" /> Settings
          </button>
          <button className="btn tonal big" onClick={() => setDialog('help')}>
            <Icon name="help" /> Help and shortcuts
          </button>
          <button className="btn tonal big danger" onClick={() => { setDialog(null); leaveRoom(); }}>
            <Icon name="leave" /> Leave room
          </button>
        </div>
      </Dialog>
      {!room && (
        <footer className="foot">
          <button className="btn ghost" onClick={() => setDialog('settings')}>
            Settings
          </button>
          <button className="btn ghost" onClick={() => setDialog('help')}>
            How to play
          </button>
        </footer>
      )}

      {/* Queued spoken announcements for screen readers. */}
      <div role="log" aria-live="polite" aria-relevant="additions" className="sr-only">
        {live.map((e) => (
          <p key={e.id}>{e.text}</p>
        ))}
      </div>
    </div>
  );
}
