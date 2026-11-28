import { useEffect, useRef, useState } from 'react';
import { CompletedTrick, Play, PlayerView, RoomSnapshot, SUIT_NAMES, SUIT_SYMBOLS, Suit, bidName, trickLeader } from '@g304/engine';
import { useVoice } from '../voice';
import { CardFace, TeamBadge, isTeamMode } from './ui';

/** How long a finished trick stays on the table so everyone sees who took it. */
const HOLD_MS = 1800;

/**
 * Keep the last completed trick on the table briefly, so the final card and the
 * winner are visible before the cards are gathered.
 */
function useShownTrick(v: PlayerView): { plays: Play[]; winner: number | null; leader: number | null } | null {
  const count = v.completedTricks.length;
  const last: CompletedTrick | undefined = v.completedTricks[count - 1];
  const prev = useRef(count);
  const [hold, setHold] = useState<CompletedTrick | null>(null);
  useEffect(() => {
    if (count > prev.current && last) {
      prev.current = count;
      setHold(last);
      const t = window.setTimeout(() => setHold(null), HOLD_MS);
      return () => clearTimeout(t);
    }
    prev.current = count;
    if (count === 0) setHold(null);
  }, [count]); // eslint-disable-line react-hooks/exhaustive-deps

  const cur = v.currentTrick;
  if (cur && cur.plays.length > 0) {
    const lead = trickLeader(cur.plays, v.trumpRevealed ? v.trumpSuit : null);
    return { plays: cur.plays, winner: null, leader: lead?.seat ?? null };
  }
  if (hold) return { plays: hold.plays, winner: hold.winner, leader: hold.winner };
  return null;
}

/** A short, distinct visual moment when trump is revealed (the words are announced separately). */
function useTrumpMoment(room: RoomSnapshot, v: PlayerView) {
  const prev = useRef(v.trumpRevealed);
  const [moment, setMoment] = useState<{ text: string; suit: Suit } | null>(null);
  useEffect(() => {
    const was = prev.current;
    prev.current = v.trumpRevealed;
    if (was || !v.trumpRevealed || !v.trumpSuit || v.phase !== 'playing') return;
    const by = v.trumpRevealedBy ?? -1;
    const name = by === v.seat ? 'You' : room.seats[by]?.name ?? 'Someone';
    const asked = v.contract && by !== v.contract.bidder;
    setMoment({ text: `${name} ${asked ? 'asked for trump' : 'revealed trump'}. Trump is ${SUIT_NAMES[v.trumpSuit]}.`, suit: v.trumpSuit });
    const t = window.setTimeout(() => setMoment(null), 2800);
    return () => clearTimeout(t);
  }, [v.trumpRevealed]); // eslint-disable-line react-hooks/exhaustive-deps
  return moment;
}

/** Round / match result moment. The encouraging celebration is for the winning side only (DEFAULT). */
function useResultMoment(v: PlayerView) {
  const prev = useRef(v.phase);
  const [moment, setMoment] = useState<{ title: string; sub: string; celebrate: boolean; match: boolean } | null>(null);
  useEffect(() => {
    const was = prev.current;
    prev.current = v.phase;
    const over = v.phase === 'roundOver' || v.phase === 'matchOver';
    if (!over || was === v.phase || !v.lastResult) return;
    const myTeam = v.seat !== null ? v.teams[v.seat] : null;
    const match = v.phase === 'matchOver';
    const won = myTeam !== null && (match ? !!v.matchWinners?.includes(myTeam) : v.lastResult.awarded[myTeam] > 0);
    const teamMode = isTeamMode(v.config.numPlayers);
    setMoment({
      title: match ? (won ? 'Match won!' : 'Match over') : won ? 'Round won!' : 'Round over',
      sub: v.scores.map((sc, t) => `${teamMode ? (t === 0 ? 'Team A' : 'Team B') : `Player ${t + 1}`} ${sc}`).join('  ·  '),
      celebrate: won,
      match,
    });
    const t = window.setTimeout(() => setMoment(null), match ? 6000 : 3200);
    return () => clearTimeout(t);
  }, [v.phase]); // eslint-disable-line react-hooks/exhaustive-deps
  return moment;
}

/**
 * The visual card table: seats around an oval of felt, played cards in front of
 * each player. It is decoration for sighted players (aria-hidden); screen readers
 * get the same information from the Players and Table lists, which stay in the page.
 */
/** Reactions that just arrived, shown floating at the sender's seat for a few seconds. */
function useReactionBubbles(room: RoomSnapshot) {
  const last = useRef(room.chat.length ? room.chat[room.chat.length - 1].id : 0);
  const [bubbles, setBubbles] = useState<{ id: number; seat: number; emoji: string }[]>([]);
  useEffect(() => {
    const fresh = room.chat.filter((c) => c.id > last.current && c.kind === 'reaction' && typeof c.seat === 'number');
    if (room.chat.length) last.current = Math.max(last.current, room.chat[room.chat.length - 1].id);
    if (!fresh.length) return;
    setBubbles((b) => [...b, ...fresh.map((c) => ({ id: c.id, seat: c.seat as number, emoji: c.text }))]);
    const ids = fresh.map((c) => c.id);
    window.setTimeout(() => setBubbles((b) => b.filter((x) => !ids.includes(x.id))), 2800);
  }, [room.chat]);
  return bubbles;
}

/** Narrow screens: pull seats in so their cards stay fully on screen. */
function useNarrow() {
  const q = '(max-width: 720px)';
  const [narrow, setNarrow] = useState(() => window.matchMedia?.(q).matches ?? false);
  useEffect(() => {
    const m = window.matchMedia?.(q);
    if (!m) return;
    const on = () => setNarrow(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);
  return narrow;
}

export function Felt({ room, v }: { room: RoomSnapshot; v: PlayerView }) {
  const narrow = useNarrow();
  const SEAT_RX = narrow ? 34 : 41;
  const bubbles = useReactionBubbles(room);
  const n = v.config.numPlayers;
  const me = v.seat ?? 0;
  const shown = useShownTrick(v);
  const team = isTeamMode(n);
  const vs = useVoice();
  const trumpMoment = useTrumpMoment(room, v);
  const result = useResultMoment(v);
  // Rotate so that you always sit at the bottom.
  const angle = (seat: number) => Math.PI / 2 + (((seat - me + n) % n) * 2 * Math.PI) / n;
  const pos = (seat: number, rx: number, ry: number) => {
    const a = angle(seat);
    return { left: `${50 + rx * Math.cos(a)}%`, top: `${50 + ry * Math.sin(a)}%` };
  };
  /** Cards slide in from the direction of the player who played them. */
  const from = (seat: number) => {
    const a = angle(seat);
    return { ['--dx' as string]: `${Math.round(Math.cos(a) * 90)}px`, ['--dy' as string]: `${Math.round(Math.sin(a) * 70)}px` };
  };
  const live = v.phase === 'bidding' || v.phase === 'trumpSelect' || v.phase === 'playing' || v.phase === 'continueChoice';
  const lastPlayed = shown && shown.winner === null ? shown.plays[shown.plays.length - 1]?.card.id : null;

  return (
    <div className={`felt-wrap n${n}`} aria-hidden="true">
      <div className="felt">
        <div className="felt-center">
          {v.phase === 'playing' && v.currentTrick && (
            <span className="felt-trick">
              Trick {Math.min(v.currentTrick.index + 1, v.cardsEach)} / {v.cardsEach}
            </span>
          )}
          {v.phase === 'bidding' && <span className="felt-trick">Bidding</span>}
          {v.phase === 'trumpSelect' && <span className="felt-trick">Choosing trump</span>}
          {v.phase === 'continueChoice' && <span className="felt-trick">Bid reached · Stop or Continue?</span>}
          {(v.phase === 'roundOver' || v.phase === 'matchOver') && !shown && <span className="felt-trick">Round {v.round} over</span>}
        </div>

        {shown?.plays.map((p) => (
          <div
            key={p.card.id}
            className={`felt-card${shown.leader === p.seat ? ' leading' : ''}${shown.winner === p.seat ? ' won' : ''}${lastPlayed === p.card.id ? ' just' : ''}`}
            style={{ ...pos(p.seat, 21, 19), ...from(p.seat) }}
          >
            <CardFace card={p.card} />
            {p.asTrump && <span className="felt-tag trump">Trump</span>}
            {shown.winner === p.seat && <span className="felt-tag won">Won</span>}
            {lastPlayed === p.card.id && !p.asTrump && <span className="felt-tag just">Just played</span>}
          </div>
        ))}

        {room.seats.map((s) => {
          const i = s.seat;
          const isTurn = live && v.turn === i;
          const lastBid = [...v.bids].reverse().find((b) => b.seat === i);
          const count = v.handCounts[i];
          const won = shown?.winner === i;
          const speaking = i === v.seat ? vs.meSpeaking : !!s.memberId && vs.speaking.includes(s.memberId);
          const badges: string[] = [];
          if (i === v.dealer) badges.push('Dealer');
          if (v.contract?.bidder === i)
            badges.push(v.contract.type === 'selfCoat' ? 'Self Coat' : v.contract.type === 'challengeCoat' ? 'Challenge Coat' : `Bidder · ${bidName(v.contract.value)}`);
          if (v.sittingOut[i]) badges.push('Sitting out');
          if (v.coat?.seat === i) badges.push('Coat');
          return (
            <div
              key={i}
              className={`seat-chip team-${team ? v.teams[i] : `p${i}`}${isTurn ? ' turn' : ''}${won ? ' won' : ''}${i === v.seat ? ' me' : ''}${speaking ? ' speaking' : ''}`}
              style={pos(i, SEAT_RX, 40)}
            >
              <span className="avatar">
                {s.name.replace(/^Bot\s+/, '').slice(0, 1).toUpperCase()}
                {team && (
                  <span className="avatar-badge">
                    <TeamBadge team={v.teams[i]} label="" compact />
                  </span>
                )}
              </span>
              <span className="seat-text">
                <span className="seat-nm">{i === v.seat ? 'You' : s.name}</span>
                <span className="seat-sub">
                  {team ? (v.teams[i] === 0 ? 'Team A' : 'Team B') : ''}
                  {v.phase === 'playing' ? `${team ? ' · ' : ''}${count} card${count === 1 ? '' : 's'}` : ''}
                  {s.kind === 'bot' ? ' · bot' : !s.connected ? ' · away' : s.micMuted ? ' · mic off' : ''}
                </span>
                {isTurn && <span className="seat-turn">{i === v.seat ? 'Your turn' : 'Their turn'}</span>}
                {speaking && <span className="seat-speaking">Talking</span>}
                {badges.length > 0 && <span className="seat-badge">{badges.join(' · ')}</span>}
                {v.phase === 'bidding' && lastBid && (
                  <span key={v.bids.length} className={`bid-bubble${lastBid.action.type === 'pass' ? ' pass' : ''}`}>
                    {lastBid.action.type === 'bid' ? bidName(lastBid.action.value) : lastBid.action.type === 'pass' ? 'Pass' : lastBid.action.type === 'selfCoat' ? 'Self Coat' : 'Challenge Coat'}
                  </span>
                )}
              </span>
              {v.phase === 'playing' && (
                <span className="backs">
                  {Array.from({ length: Math.min(count, 6) }, (_, k) => (
                    <span key={k} className="back" />
                  ))}
                </span>
              )}
            </div>
          );
        })}

        {bubbles.map((b) => (
          <span key={b.id} className="react-float" style={pos(b.seat, SEAT_RX, 26)}>
            {b.emoji}
          </span>
        ))}

        {trumpMoment && (
          <div className="moment trump-moment">
            <span className={`moment-card suit-${trumpMoment.suit}`}>{SUIT_SYMBOLS[trumpMoment.suit]}</span>
            <span className="moment-text">{trumpMoment.text}</span>
          </div>
        )}
        {result && (
          <div className={`moment result-moment${result.celebrate ? ' celebrate' : ''}${result.match ? ' match' : ''}`}>
            {result.celebrate && (
              <span className="confetti">
                {Array.from({ length: 18 }, (_, k) => (
                  <i key={k} style={{ ['--k' as string]: k }} />
                ))}
              </span>
            )}
            <span className="moment-title">{result.title}</span>
            <span className="moment-sub">{result.sub}</span>
          </div>
        )}
      </div>
    </div>
  );
}
