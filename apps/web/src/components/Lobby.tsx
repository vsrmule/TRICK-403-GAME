import type { PlayerCount, RoomSettings, RoomSnapshot, SeatInfo } from '@g304/engine';
import { cardsPerPlayer } from '@g304/engine';
import { announcer } from '../announcer';
import { Icon, Stepper, TeamBadge, act, isTeamMode, sideName } from './ui';

const MODES: { n: PlayerCount; sub: string }[] = [
  { n: 2, sub: 'Head to head · 12 cards each' },
  { n: 3, sub: 'Bidder plays alone against two · 8 cards each' },
  { n: 4, sub: 'Two teams of two · 6 cards each' },
  { n: 6, sub: 'Two teams of three · 4 cards each' },
  { n: 8, sub: 'Two teams of four · 3 cards each' },
];
const TARGETS = Array.from({ length: 46 }, (_, i) => i + 5); // 5 … 50

/**
 * Lobby. Reading order: heading and status · seats (the table) · invite · setup · start.
 * Desktop/tablet show the seats as chairs around the table; phones show a list.
 */
export function Lobby({ room }: { room: RoomSnapshot }) {
  const host = room.you.isHost;
  const s = room.settings;
  const team = isTeamMode(s.numPlayers);
  const set = (patch: Partial<RoomSettings>) => act('updateSettings', { settings: patch });
  const empty = room.seats.filter((x) => x.kind === 'empty').length;
  const filled = s.numPlayers - empty;
  const spectators = room.members.filter((m) => m.seat === null);
  const hostName = room.seats.find((x) => x.isHost)?.name ?? 'Host';
  const mode = MODES.find((m) => m.n === s.numPlayers)!;

  const fillAndStart = async () => {
    if (empty > 0) {
      const r = await act('fillBots');
      if (!r.ok) return;
    }
    await act('start');
  };

  return (
    <main id="main" className="lobby2">
      <div className="page-head">
        <span className="eyebrow">Lobby · room {room.code}</span>
        <h1>{room.you.isHost ? 'Your table' : `${hostName}'s table`}</h1>
        <p className="muted">
          {filled} of {s.numPlayers} seats filled · {mode.sub} · first to {s.matchTarget}
        </p>
      </div>

      <div className="lobby-grid">
        <section className="stage" aria-labelledby="seats-h">
          <div className="stage-head">
            <h2 id="seats-h">
              Seats <span className="count">{filled}/{s.numPlayers}</span>
            </h2>
            {host && team && (
              <button className="btn text" onClick={() => act('autoAssign')}>
                Auto-assign teams
              </button>
            )}
          </div>
          {team && <p className="muted small">Teams sit in alternating seats. Pick a chair to pick your team.</p>}
          <LobbyTable room={room} />
          <ol className="seat-list">
            {room.seats.map((seat) => (
              <li key={seat.seat} className={`seat-line team-${team ? seat.seat % 2 : 'x'}${seat.kind === 'empty' ? ' empty' : ''}`}>
                <SeatBody room={room} seat={seat} />
              </li>
            ))}
          </ol>
          {spectators.length > 0 && <p className="muted small">Waiting for a seat: {spectators.map((m) => m.name).join(', ')}.</p>}
        </section>

        <aside className="side" aria-label="Invite and setup">
          <InviteCard room={room} />

          <section className="card-surface" aria-labelledby="setup-h">
            <h2 id="setup-h" className="section-k">
              Game setup{host ? '' : ' · chosen by the host'}
            </h2>
            <fieldset className="segmented" disabled={!host}>
              <legend>Players</legend>
              <div className="seg-row">
                {MODES.map((m) => (
                  <label key={m.n} className={`seg${s.numPlayers === m.n ? ' on' : ''}`}>
                    <input type="radio" name="mode" checked={s.numPlayers === m.n} onChange={() => set({ numPlayers: m.n })} />
                    <span>{m.n}</span>
                    <span className="sr-only"> players, {m.sub}</span>
                  </label>
                ))}
              </div>
            </fieldset>
            <p className="muted small seg-sub" aria-hidden="true">
              {mode.sub}
            </p>
            {s.numPlayers === 4 && (
              <label className="check">
                <input type="checkbox" disabled={!host} checked={s.fourCardMode} onChange={(e) => set({ fourCardMode: e.target.checked })} />
                Short game: 4 cards each
              </label>
            )}
            <Stepper
              id="target"
              label="Play to"
              values={TARGETS}
              value={s.matchTarget}
              onChange={(t) => set({ matchTarget: t })}
              format={(t) => `${t} points`}
              describe={(t) => `${t} game points`}
              disabled={!host}
            />
            <details className="more">
              <summary>More settings</summary>
              <fieldset disabled={!host} className="stack">
                <legend className="sr-only">More game settings</legend>
                <label>
                  First trick led by
                  <select className="input" value={s.firstLead} onChange={(e) => set({ firstLead: e.target.value as RoomSettings['firstLead'] })}>
                    <option value="dealerLeft">Player left of the dealer</option>
                    <option value="bidderLeft">Player left of the bidder</option>
                  </select>
                </label>
                <label>
                  Turn timer
                  <select className="input" value={s.turnTimer} onChange={(e) => set({ turnTimer: Number(e.target.value) })}>
                    <option value={0}>Relaxed — no timer</option>
                    <option value={15}>15 seconds</option>
                    <option value={30}>30 seconds</option>
                    <option value={60}>60 seconds</option>
                    <option value={90}>90 seconds</option>
                  </select>
                </label>
                <label>
                  Bot speed
                  <select className="input" value={s.botSpeed} onChange={(e) => set({ botSpeed: e.target.value as RoomSettings['botSpeed'] })}>
                    <option value="relaxed">Relaxed — time to hear every card</option>
                    <option value="normal">Normal</option>
                    <option value="fast">Fast</option>
                  </select>
                </label>
                <label className="check">
                  <input type="checkbox" checked={room.videoEnabled} onChange={(e) => act('setVideo', { on: e.target.checked })} />
                  Allow video chat
                </label>
                <label className="check">
                  <input type="checkbox" checked={room.isPublic} onChange={(e) => act('setPublic', { isPublic: e.target.checked })} />
                  List in public tables
                </label>
              </fieldset>
            </details>
            <p className="muted small">
              {cardsPerPlayer(s)} tricks a round. Bids run 160 → Jaan (200) → Jaan 100 (300) → 304.
            </p>
          </section>

          <section className="start-card" aria-label="Start the game">
            {host ? (
              <>
                <button className="btn primary xl" onClick={fillAndStart}>
                  {empty > 0 ? `Start with ${empty} ${empty === 1 ? 'bot' : 'bots'}` : 'Start game'}
                </button>
                <p className="muted small">{empty > 0 ? `Empty seats are filled with bots. Friends can still take over between rounds.` : 'Everyone is seated.'}</p>
              </>
            ) : (
              <p className="waiting">
                <span className="dot" aria-hidden="true" /> Waiting for {hostName} to start
              </p>
            )}
          </section>
        </aside>
      </div>
    </main>
  );
}

function InviteCard({ room }: { room: RoomSnapshot }) {
  const link = `${window.location.origin}/?room=${room.code}`;
  const spoken = room.code.split('').join(' ');
  const share = async () => {
    const text = `Join my Trick 304 game! Room code ${room.code}`;
    try {
      if (navigator.share) {
        await navigator.share({ title: 'Trick 304', text, url: link });
        return;
      }
      await navigator.clipboard.writeText(`${text}: ${link}`);
      announcer.say('Invite link copied.', { interrupt: true });
    } catch {
      announcer.say(`Room code is ${spoken}`, { interrupt: true });
    }
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(room.code);
      announcer.say('Room code copied.', { interrupt: true });
    } catch {
      announcer.say(`Room code is ${spoken}`, { interrupt: true });
    }
  };
  return (
    <section className="card-surface invite" aria-labelledby="code-h">
      <h2 id="code-h" className="section-k">
        Invite friends
      </h2>
      <p className="code-tiles">
        <span className="sr-only">Room code {spoken}</span>
        {room.code.split('').map((d, i) => (
          <span key={i} aria-hidden="true">
            {d}
          </span>
        ))}
      </p>
      <div className="row">
        <button className="btn primary" onClick={share}>
          <Icon name="share" size={18} /> Share link
        </button>
        <button className="btn tonal" onClick={copy}>
          <Icon name="copy" size={18} /> Copy code
        </button>
      </div>
      <p className="muted small">Works on Android, iPhone and any browser.</p>
    </section>
  );
}

function SeatBody({ room, seat }: { room: RoomSnapshot; seat: SeatInfo }) {
  const host = room.you.isHost;
  const team = isTeamMode(room.settings.numPlayers);
  const mine = room.you.seat === seat.seat;
  const side = team ? sideName(room, seat.seat % 2) : '';
  const label = `Seat ${seat.seat + 1}${team ? `, ${side}` : ''}`;
  const initial = seat.kind === 'empty' ? '' : seat.name.replace(/^Bot\s+/, '').slice(0, 1).toUpperCase();
  return (
    <>
      <span className={`chair-avatar${seat.kind === 'empty' ? ' empty' : ''}`} aria-hidden="true">
        {seat.kind === 'bot' ? <Icon name="bot" size={18} /> : seat.kind === 'empty' ? <Icon name="chair" size={18} /> : initial}
      </span>
      <span className="chair-text">
        <span className="chair-name">
          {seat.kind === 'empty' ? 'Empty seat' : seat.name}
          {mine && <span className="tag">You</span>}
          {seat.isHost && <span className="tag">Host</span>}
        </span>
        <span className="chair-sub">
          {team && <TeamBadge team={seat.seat % 2} label={side} />}
          <span>Seat {seat.seat + 1}</span>
          {seat.kind === 'bot' && <span>Bot</span>}
          {seat.kind === 'human' && !seat.connected && <span>Away</span>}
        </span>
      </span>
      <span className="chair-actions">
        {seat.kind === 'empty' && !mine && (
          <button className="btn tonal sm" onClick={() => act('takeSeat', { seat: seat.seat })} aria-label={`Sit here: ${label}`}>
            Sit here
          </button>
        )}
        {host && seat.kind === 'empty' && (
          <button className="btn text sm" onClick={() => act('setBot', { seat: seat.seat, bot: true })} aria-label={`Add bot: ${label}`}>
            + Bot
          </button>
        )}
        {host && seat.kind === 'bot' && (
          <button className="btn text sm" onClick={() => act('setBot', { seat: seat.seat, bot: false })} aria-label={`Remove bot: ${seat.name}, ${label}`}>
            Remove
          </button>
        )}
        {mine && (
          <button className="btn text sm" onClick={() => act('leaveSeat')}>
            Stand up
          </button>
        )}
      </span>
    </>
  );
}

/** The seats as chairs around the table (desktop and tablet). */
function LobbyTable({ room }: { room: RoomSnapshot }) {
  const n = room.seats.length;
  const me = room.you.seat ?? 0;
  const team = isTeamMode(room.settings.numPlayers);
  const pos = (seat: number) => {
    const a = Math.PI / 2 + (((seat - me + n) % n) * 2 * Math.PI) / n;
    return { left: `${50 + 40 * Math.cos(a)}%`, top: `${50 + 38 * Math.sin(a)}%` };
  };
  return (
    <div className={`lobby-felt n${n}`}>
      <div className="lobby-felt-oval" aria-hidden="true">
        <span className="felt-logo">
          Trick <b>304</b>
        </span>
      </div>
      <ul className="chairs" aria-label="Seats around the table">
        {room.seats.map((seat) => (
          <li key={seat.seat} className={`chair team-${team ? seat.seat % 2 : 'x'}${seat.kind === 'empty' ? ' empty' : ''}${room.you.seat === seat.seat ? ' me' : ''}`} style={pos(seat.seat)}>
            <SeatBody room={room} seat={seat} />
          </li>
        ))}
      </ul>
    </div>
  );
}
