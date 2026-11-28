import { ReactNode, useEffect, useRef, useState } from 'react';
import {
  Card,
  RULES,
  bandOf,
  bidName,
  catalog,
  guidance,
  PlayerView,
  RoomSnapshot,
  SUITS,
  SUIT_NAMES,
  SUIT_SYMBOLS,
  cardLabel,
  cardName,
  describeBid,
  describeContract,
  describeResult,
  points,
  teamLabel,
  trickLeader,
} from '@g304/engine';
import { announcer, useAnnouncer } from '../announcer';
import { usePrefs } from '../prefs';
import { sfx } from '../sfx';
import { ReactBar } from './Chat';
import { Felt } from './Felt';
import { CardFace, Stepper, TeamBadge, act, isTeamMode, names, sideName } from './ui';

export function Table({ room }: { room: RoomSnapshot }) {
  const v = room.view!;
  return (
    <main id="main" className="table">
      <h1 className="sr-only">Trick 304 table, room {room.code}</h1>
      <StatusLine room={room} v={v} />
      <Felt room={room} v={v} />
      {/* The same information as the visual table, as lists for screen readers. */}
      <div className="table-grid sr-only">
        <Seats room={room} v={v} />
        <Trick room={room} v={v} />
      </div>
      <div className="dock">
        <ActionPanel room={room} v={v} />
        <div className="dock-react">
          <span className="dock-react-k" aria-hidden="true">
            React
          </span>
          <ReactBar compact />
        </div>
        {v.seat !== null ? <Hand room={room} v={v} /> : <Spectator room={room} />}
      </div>
    </main>
  );
}

/** Card points each side has captured so far this round. */
function roundPoints(v: PlayerView): number[] {
  const c = new Array(v.numTeams).fill(0);
  for (const t of v.completedTricks) c[t.winnerTeam] += t.points;
  return c;
}

function who(room: RoomSnapshot, seat: number) {
  return seat === room.you.seat ? 'You' : room.seats[seat]?.name ?? `Seat ${seat + 1}`;
}

function StatusLine({ room, v }: { room: RoomSnapshot; v: PlayerView }) {
  const n = names(room);
  const [now, setNow] = useState(Date.now());
  const warned = useRef<number | null>(null);
  useEffect(() => {
    if (!room.turnDeadline) return;
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [room.turnDeadline]);
  const left = room.turnDeadline ? Math.max(0, Math.ceil((room.turnDeadline - now) / 1000)) : null;
  const myTurn = v.turn === v.seat && v.seat !== null;
  useEffect(() => {
    if (left === 10 && myTurn && warned.current !== room.turnDeadline) {
      warned.current = room.turnDeadline;
      announcer.say('10 seconds left.');
    }
  }, [left, myTurn, room.turnDeadline]);

  const trump =
    v.contract?.type === 'selfCoat'
      ? 'Trump: none (Self Coat)'
      : v.trumpRevealed && v.trumpSuit
      ? `Trump: ${SUIT_NAMES[v.trumpSuit]}`
      : v.trumpSuit
        ? `Your trump: ${SUIT_NAMES[v.trumpSuit]} (hidden from the others)`
        : v.contract
          ? 'Trump: hidden'
          : 'Trump: not set';
  // Only the bidder's device knows the suit before the reveal (Issue 6.6 / 6.7).
  const suit = v.trumpSuit;
  const contract = v.contract
    ? v.contract.type === 'selfCoat'
      ? 'Self Coat'
      : v.contract.type === 'challengeCoat'
        ? 'Challenge Coat'
        : bidName(v.contract.value)
    : v.highBid
      ? describeBid(v.highBid.action).replace(/^bid /, '')
      : '—';
  const contractWho = v.contract ? who(room, v.contract.bidder) : v.highBid ? who(room, v.highBid.seat) : '';
  const teamMode = isTeamMode(v.config.numPlayers);
  return (
    <section className="hud" aria-label="Game status">
      <div className="hud-chip">
        <span className="hud-k">Round</span>
        <span className="hud-v">{v.round}</span>
      </div>
      <div className="hud-chip gold">
        <span className="hud-k">{v.contract ? 'Contract' : 'High bid'}</span>
        <span className="hud-v">
          {contract}
          {contractWho && <span className="hud-who"> · {contractWho}</span>}
          {v.coat && <span className="hud-who"> · Coat on</span>}
        </span>
      </div>
      {/* Always present (shows "—" before play) so the scoreboard never changes size. */}
      <div className="hud-chip round-points">
        {!v.contract || v.phase === 'bidding' || v.phase === 'trumpSelect' ? (
          <>
            <span className="hud-k">Round points</span>
            <span className="hud-v">—</span>
          </>
        ) : (
          <>
          <span className="hud-k">Round points</span>
          <span className="hud-v">
            {(v.lastResult && v.phase !== 'playing' ? v.lastResult.capturedPoints : roundPoints(v))
              .map((c, t) => `${teamLabel(t, v.config.numPlayers, n).replace(/^Team /, '')} ${c}`)
              .join(' · ')}
            <span className="hud-who"> / needs {bidName(v.contract.value)}</span>
          </span>
          </>
        )}
      </div>
      <div className={`hud-chip trump${v.trumpRevealed ? ' revealed' : ''}`}>
        {suit ? (
          <span className={`mini-card suit-${suit}${v.trumpRevealed ? ' flip' : ''}`} aria-hidden="true">
            {SUIT_SYMBOLS[suit]}
            <em>{suit}</em>
          </span>
        ) : (
          <span className="trump-q" aria-hidden="true">
            ?
          </span>
        )}
        <span>
          <span className="hud-k">Trump</span>
          <span className="hud-v">
            {v.contract?.type === 'selfCoat'
              ? 'None · Self Coat'
              : v.trumpRevealed && v.trumpSuit
              ? SUIT_NAMES[v.trumpSuit]
              : v.trumpSuit
                ? `Yours: ${SUIT_NAMES[v.trumpSuit]} · hidden`
                : v.contract
                  ? 'Hidden'
                  : 'Not set'}
          </span>
        </span>
      </div>
      <div className="hud-score" role="group" aria-label={`Score: ${v.scores.map((sc, t) => `${teamLabel(t, v.config.numPlayers, n)} ${sc}`).join(', ')}. Playing to ${v.config.matchTarget}.`}>
        {v.scores.map((sc, t) => (
          <div key={t} className={`score-box ${teamMode ? `team-${t}` : `p${t}`}`} aria-hidden="true">
            <span className="hud-k">
              {teamMode ? <TeamBadge team={t} label={teamLabel(t, v.config.numPlayers, n)} /> : teamLabel(t, v.config.numPlayers, n)}
            </span>
            <span className="score-n">{sc}</span>
          </div>
        ))}
        <span className="hud-k to" aria-hidden="true">
          to {v.config.matchTarget}
        </span>
      </div>
      {left !== null && (
        <div className={left <= 10 ? 'hud-chip timer urgent' : 'hud-chip timer'} aria-hidden={!myTurn}>
          <span className="hud-k">{v.phase === 'roundOver' ? 'Next round' : myTurn ? 'Your time' : `${who(room, v.turn)}'s time`}</span>
          <span className="hud-v">{left}s</span>
        </div>
      )}
    </section>
  );
}

function Seats({ room, v }: { room: RoomSnapshot; v: PlayerView }) {
  const team = isTeamMode(v.config.numPlayers);
  return (
    <section className="panel seats" aria-labelledby="seats-h">
      <h2 id="seats-h">Players</h2>
      <ol className="list">
        {room.seats.map((s) => {
          const i = s.seat;
          const lastBid = [...v.bids].reverse().find((b) => b.seat === i);
          const isTurn = v.turn === i && (v.phase === 'bidding' || v.phase === 'playing' || v.phase === 'trumpSelect' || v.phase === 'continueChoice');
          const bits: string[] = [];
          if (team) bits.push(sideName(room, v.teams[i]));
          if (i === v.dealer) bits.push('dealer');
          if (v.contract?.bidder === i) bits.push(v.contract.type === 'selfCoat' ? 'Self Coat, playing alone' : 'bidder');
          if (v.sittingOut[i]) bits.push('sitting out');
          if (v.phase === 'bidding' && lastBid) bits.push(describeBid(lastBid.action));
          const count = v.handCounts[i];
          if (v.phase === 'playing') bits.push(`${count} ${count === 1 ? 'card' : 'cards'}`);
          if (s.kind === 'bot') bits.push('bot');
          else if (!s.connected) bits.push('disconnected');
          else bits.push(s.micMuted ? 'mic off' : 'mic on');
          if (v.phase === 'roundOver' && room.ready.includes(i)) bits.push('ready');
          return (
            <li key={i} className={`seat team-${team ? v.teams[i] : 'x'}${isTurn ? ' turn' : ''}`} aria-current={isTurn ? 'true' : undefined}>
              <span className="seat-name">
                {isTurn && <span aria-hidden="true">▶ </span>}
                {s.name}
                {i === room.you.seat ? ' (you)' : ''}
                {isTurn && <span className="sr-only">, current turn</span>}
              </span>
              <span className="seat-meta">{bits.join(' · ')}</span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function Trick({ room, v }: { room: RoomSnapshot; v: PlayerView }) {
  const t = v.currentTrick;
  const leader = t && t.plays.length ? trickLeader(t.plays, v.trumpRevealed ? v.trumpSuit : null) : null;
  const last = v.completedTricks[v.completedTricks.length - 1];
  return (
    <section className="panel trick" aria-labelledby="trick-h">
      <h2 id="trick-h">{t ? `Table — trick ${t.index + 1} of ${v.cardsEach}` : 'Table'}</h2>
      {t && t.plays.length === 0 && <p>{who(room, t.leader)} to lead.</p>}
      {t && t.plays.length > 0 && (
        <>
          <p>
            {who(room, t.leader)} led {SUIT_NAMES[t.plays[0].card.suit]}.
          </p>
          <ul className="played">
            {t.plays.map((p) => (
              <li key={p.card.id} className={leader?.seat === p.seat ? 'winning' : ''}>
                <CardFace card={p.card} />
                <span>
                  {who(room, p.seat)}: {cardName(p.card)}
                  {p.asTrump ? ' (trump)' : ''}
                  {leader?.seat === p.seat ? ' — winning' : ''}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
      {!t && v.phase === 'bidding' && <p>Bidding in progress.</p>}
      {last && v.phase === 'playing' && (
        <p className="hint">
          Last trick: {who(room, last.winner)} won {last.points} points.
        </p>
      )}
    </section>
  );
}

function ActionPanel({ room, v }: { room: RoomSnapshot; v: PlayerView }) {
  const n = names(room);
  const L = v.legal;
  const myTurn = v.seat !== null && v.turn === v.seat;
  const p = usePrefs();
  const guide = p.guidance ? guidance(v, n, { ready: v.seat !== null && room.ready.includes(v.seat), isHost: room.you.isHost }, catalog(p.lang)) : null;
  return (
    <section className="panel actions" aria-labelledby="act-h">
      <h2 id="act-h">
        {v.phase === 'bidding' ? 'Bidding' : v.phase === 'trumpSelect' ? 'Choosing trump' : v.phase === 'playing' ? 'Your move' : v.phase === 'continueChoice' ? 'Bid reached' : v.phase === 'roundOver' ? 'Round result' : 'Match over'}
      </h2>
      {guide && (
        <p className={`guide${myTurn ? ' mine' : ''}`}>
          <span className="guide-k">{myTurn ? 'Next' : 'Now'}</span> {guide}
        </p>
      )}

      {v.phase === 'bidding' && (
        <>
          {v.lastCancel && (
            <p className="callout">
              {v.lastCancel === 'allJacks'
                ? 'Round cancelled: one team has all four Jacks. Dealing again.'
                : 'Round cancelled: one team has no card of the trump suit. Dealing again.'}
            </p>
          )}
          {myTurn && L ? <BidControls v={v} /> : !guide && <p>Waiting for {who(room, v.turn)} to bid.</p>}
          {v.bids.length > 0 && (
            <details>
              <summary>Bidding history ({v.bids.length})</summary>
              <ol className="list compact">
                {v.bids.map((b, i) => (
                  <li key={i}>
                    {who(room, b.seat)} {describeBid(b.action)}
                  </li>
                ))}
              </ol>
            </details>
          )}
        </>
      )}

      {v.phase === 'continueChoice' &&
        (L?.canChooseContinue ? (
          <div className="continue-choice" role="group" aria-labelledby="continue-q">
            <p id="continue-q" className="callout good">
              Your team has already reached its bid. Would you like to continue the game?
            </p>
            <p className="hint">
              Stop: the round ends now and your side scores the bid. Continue: play on; your side can still call Coat at the start of a trick if it has won every trick so far.
            </p>
            <div className="row wrap">
              <button type="button" className="btn big" onClick={() => act('action', { action: { type: 'stopRound' } })}>
                Stop
              </button>
              <button type="button" className="btn primary big" onClick={() => act('action', { action: { type: 'continueRound' } })}>
                Continue
              </button>
            </div>
          </div>
        ) : (
          <p>Waiting for {who(room, v.turn)}.</p>
        ))}

      {v.phase === 'trumpSelect' &&
        (L?.canSelectTrump ? (
          <p className="callout">You won the bid. Choose one card from your hand below as your hidden trump card. Its suit becomes trump. Only you will see it, and you can still play it.</p>
        ) : (
          <p>{who(room, v.turn)} is choosing trump.</p>
        ))}

      {v.phase === 'playing' && (
        <>
          <p>
            {!guide && (myTurn ? (L?.playable.length ? 'Your turn. Choose a card from your hand.' : 'Your turn.') : `Waiting for ${who(room, v.turn)}.`)}
            {v.contract?.type === 'challengeCoat' && ` Challenge Coat by ${who(room, v.contract.bidder)} is on.`}
            {v.contract?.type === 'selfCoat' && ` Self Coat by ${who(room, v.contract.bidder)} is on: playing alone, no trump.`}
            {v.coat && ` Coat by ${who(room, v.coat.seat)} is on.`}
          </p>
          <div className="row wrap">
            {L?.canAskTrump && (
              <button className="btn warn big" onClick={() => act('action', { action: { type: 'askTrump' } })}>
                Ask for trump
              </button>
            )}
            {L?.canRevealTrump && (
              <button className="btn warn big" onClick={() => act('action', { action: { type: 'revealTrump' } })}>
                Reveal trump
              </button>
            )}
            {L?.coat.show && (
              <button
                className="btn"
                aria-disabled={!L.coat.allowed}
                aria-describedby={L.coat.allowed ? undefined : 'coat-reason'}
                onClick={() => {
                  if (!L.coat.allowed) {
                    announcer.say(L.coat.reason ?? 'Coat is not available now.', { interrupt: true });
                    return;
                  }
                  const b = bandOf(v.contract!.value);
                  if (window.confirm(`Call Coat? Your side must win every remaining trick, including this one. Made: +${b.coatWin}. Stopped: opponents +${b.coatLose}.`))
                    void act('action', { action: { type: 'coat' } });
                }}
              >
                Call Coat
              </button>
            )}
          </div>
          {L?.coat.show && !L.coat.allowed && (
            <p id="coat-reason" className="hint">
              {L.coat.reason}.
            </p>
          )}
          {L?.canAskTrump && (
            <p className="hint">
              You have no {SUIT_NAMES[v.currentTrick!.plays[0].card.suit]}. Play any card, or ask for trump: the bidder must reveal it, and then you must play a trump if you have one.
            </p>
          )}
          {L?.canRevealTrump && <p className="hint">You may reveal trump to everyone now, or keep it hidden. Nobody can make you reveal it unless they ask.</p>}
        </>
      )}

      {(v.phase === 'roundOver' || v.phase === 'matchOver') && v.lastResult && (
        <>
          <p className={v.lastResult.success ? 'callout good' : 'callout bad'}>{describeResult(v.lastResult, v.scores, n, v.config.numPlayers)}</p>
          <h3 className="sr-only">Score breakdown</h3>
          <ul className="list breakdown">
            <li>
              <span>Contract</span>
              <strong>
                {v.lastResult.kind === 'selfCoat' ? 'Self Coat' : v.lastResult.kind === 'challengeCoat' ? 'Challenge Coat' : `${bidName(v.lastResult.bidValue)}${v.lastResult.kind === 'coat' ? ' with Coat' : ''}`} · Band {v.lastResult.band}
              </strong>
            </li>
            {v.lastResult.trumpSuit && (
              <li>
                <span>Trump</span>
                <strong>{SUIT_NAMES[v.lastResult.trumpSuit]}</strong>
              </li>
            )}
            {v.lastResult.capturedPoints.map((cp, t) => (
              <li key={`c${t}`}>
                <span>{teamLabel(t, v.config.numPlayers, n)} captured</span>
                <strong>
                  {cp} points · {v.lastResult!.tricksWon[t]} {v.lastResult!.tricksWon[t] === 1 ? 'trick' : 'tricks'}
                </strong>
              </li>
            ))}
            {v.lastResult.awarded.map((a, t) => (
              <li key={`a${t}`}>
                <span>{teamLabel(t, v.config.numPlayers, n)} this round</span>
                <strong>
                  +{a} → {v.scores[t]} of {v.config.matchTarget}
                </strong>
              </li>
            ))}
          </ul>
        </>
      )}
      {v.phase === 'roundOver' &&
        v.seat !== null &&
        (room.ready.includes(v.seat) ? (
          <p>You are ready. Waiting for the other players.</p>
        ) : (
          <button className="btn primary big" onClick={() => act('ready')}>
            Ready for next round
          </button>
        ))}
      {v.phase === 'matchOver' && (
        <>
          <p className="callout good">Winner: {v.matchWinners!.map((t) => teamLabel(t, v.config.numPlayers, n)).join(' and ')}!</p>
          {room.you.isHost ? (
            <button className="btn primary big" onClick={() => act('backToLobby')}>
              Back to lobby for a rematch
            </button>
          ) : (
            <p>Waiting for the host to start a rematch.</p>
          )}
        </>
      )}
    </section>
  );
}

function BidControls({ v }: { v: PlayerView }) {
  const L = v.legal!;
  const values = L.bidOptions;
  const [choice, setChoice] = useState(values[0] ?? 0);
  useEffect(() => {
    setChoice(values[0] ?? 0);
  }, [values[0]]); // eslint-disable-line react-hooks/exhaustive-deps
  const bid = (action: object) => act('action', { action });
  const full = (b: number) => (b >= RULES.bidding.namedFrom && b !== RULES.bidding.top ? `${bidName(b)} (${b})` : bidName(b));
  const band = values.length ? bandOf(choice).id : null;
  return (
    <div className="bid-controls">
      <p className="callout">
        Your turn to bid. {v.highBid ? `To beat: ${describeBid(v.highBid.action)}.` : `Opening bids start at ${RULES.bidding.min}.`}
      </p>
      {values.length > 0 ? (
        <div className="bid-row">
          <Stepper
            id="bid-step"
            label="Your bid"
            values={values}
            value={choice}
            onChange={setChoice}
            format={(b) => full(b)}
            describe={(b) => `${full(b)}, Band ${bandOf(b).id}`}
          />
          {/* Band shown as text and with a distinct shape, not colour alone. */}
          <span className={`band-chip band-${band}`}>
            <span aria-hidden="true">{band === 1 ? '▪' : '◆'}</span> Band {band}
          </span>
          <button className="btn primary big" onClick={() => bid({ type: 'bid', value: choice })}>
            Bid {bidName(choice)}
          </button>
        </div>
      ) : (
        <p>No higher bid is left.</p>
      )}
      <div className="row wrap">
        <button className="btn big" onClick={() => bid({ type: 'pass' })}>
          Pass
        </button>
        {L.canChallengeCoat && (
          <button
            className="btn warn big"
            onClick={() =>
              window.confirm(`Call Challenge Coat? Your side must win every trick, first to last. Made: +${RULES.challengeCoat.win}. Stopped: opponents +${RULES.challengeCoat.lose}.`) &&
              bid({ type: 'challengeCoat' })
            }
          >
            Call Challenge Coat
          </button>
        )}
        {L.canSelfCoat && (
          <button
            className="btn warn big"
            onClick={() =>
              window.confirm(
                `Call Self Coat? You play alone: your teammates sit out, there is no trump, you lead the first trick and you must win every trick. Made: +${RULES.selfCoat.win}. Stopped: opponents +${RULES.selfCoat.lose}.`,
              ) && bid({ type: 'selfCoat' })
            }
          >
            Call Self Coat
          </button>
        )}
      </div>
      <ul className="band-key">
        <li>
          <span className={`band-chip band-1`}>
            <span aria-hidden="true">▪</span> Band 1
          </span>{' '}
          160 to 190: made +1, stopped: opponents +2.
        </li>
        <li>
          <span className={`band-chip band-2`}>
            <span aria-hidden="true">◆</span> Band 2
          </span>{' '}
          Jaan (200) to Jaan 100 (300), then 304: made +2, stopped: opponents +4.
        </li>
      </ul>
    </div>
  );
}

function Hand({ room, v }: { room: RoomSnapshot; v: PlayerView }) {
  const p = usePrefs();
  const L = v.legal!;
  const [selected, setSelected] = useState<string | null>(null);
  const handRef = useRef<HTMLElement>(null);
  const choosingTrump = L.canSelectTrump;
  const myTurnToPlay = v.phase === 'playing' && v.turn === v.seat;
  const cards: Card[] = v.myHand;

  useEffect(() => {
    setSelected(null);
  }, [v.turn, v.phase, v.currentTrick?.plays.length]);
  useEffect(() => {
    if (p.focusHandOnTurn && (myTurnToPlay || choosingTrump)) {
      const first = handRef.current?.querySelector<HTMLButtonElement>('button.card[aria-disabled="false"]');
      first?.focus();
    }
  }, [myTurnToPlay, choosingTrump, p.focusHandOnTurn, v.currentTrick?.plays.length]);

  const activate = (c: Card) => {
    sfx.unlock();
    if (choosingTrump) {
      if (window.confirm(`Hide ${cardName(c)} as trump? Trump suit will be ${SUIT_NAMES[c.suit]}.`))
        void act('action', { action: { type: 'selectTrump', cardId: c.id } });
      return;
    }
    if (!L.playable.includes(c.id)) {
      sfx.play('error');
      announcer.say(`${cardName(c)}: ${L.disabledReasons[c.id] ?? 'not playable now'}.`, { interrupt: true });
      return;
    }
    if (p.confirmPlay && selected !== c.id) {
      setSelected(c.id);
      announcer.say(`${cardName(c)} selected. Activate again to play.`, { interrupt: true });
      return;
    }
    void act('action', { action: { type: 'play', cardId: c.id } });
  };

  const total = v.myHand.reduce((s, c) => s + points(c), 0);
  return (
    <section ref={handRef} id="hand" tabIndex={-1} className="panel hand" aria-labelledby="hand-h">
      <h2 id="hand-h">
        Your hand: {cards.length} {cards.length === 1 ? 'card' : 'cards'}, {total} points
      </h2>
      {v.myTrumpIndicator && (
        <p className="hidden-trump">
          <span className={`trump-pill suit-${v.myTrumpIndicator.suit}`} aria-hidden="true">
            {SUIT_SYMBOLS[v.myTrumpIndicator.suit]}
          </span>
          Your trump card: {cardName(v.myTrumpIndicator)}, marked "Trump card" in your hand. Only you can see it.{' '}
          {v.trumpRevealed
            ? `Trump has been revealed: ${SUIT_NAMES[v.myTrumpIndicator.suit]}.`
            : `Trump is ${SUIT_NAMES[v.myTrumpIndicator.suit]}. You can play this card at any time — playing it does not reveal trump. You can reveal trump on any of your turns.`}
        </p>
      )}
      {cards.length === 0 && <p>No cards left.</p>}
      {(() => {
        const cardButton = (c: Card) => {
          const playable = choosingTrump || L.playable.includes(c.id);
          const reason = L.disabledReasons[c.id];
          const isTrumpCard = v.myTrumpIndicator?.id === c.id;
          const label = choosingTrump
            ? `${cardName(c)}, ${points(c)} points — Choose as your hidden trump card`
            : cardLabel(c, playable, reason) + (isTrumpCard ? ' — your trump card' : '');
          const blocked = myTurnToPlay && !playable;
          // State shown by shape/text as well as colour: lifted + "Play", hatched + "Can't play", tick + "Selected".
          const tag = selected === c.id ? 'Selected' : choosingTrump ? 'Hide' : myTurnToPlay && playable ? 'Play' : blocked ? "Can't play" : null;
          return (
            <button
              type="button"
              className={`card${playable ? ' playable' : ''}${blocked ? ' dim' : ''}${selected === c.id ? ' selected' : ''}${myTurnToPlay || choosingTrump ? ' live' : ''}`}
              aria-disabled={!playable}
              aria-pressed={p.confirmPlay ? selected === c.id : undefined}
              onClick={() => activate(c)}
            >
              <CardFace card={c} points={p.showPoints} />
              {isTrumpCard && (
                <span className="trump-card-tag" aria-hidden="true">
                  Trump card
                </span>
              )}
              {tag && (
                <span className={`state-tag${blocked ? ' no' : ''}${selected === c.id ? ' sel' : ''}`} aria-hidden="true">
                  {tag}
                </span>
              )}
              {/* The spoken name is real text (not aria-label), so voice-control users can say it too. */}
              <span className="sr-only">{label}</span>
            </button>
          );
        };
        if (p.handLayout === 'fan') {
          return (
            <FanHand count={cards.length}>
              {cards.map((c, i) => (
                <li key={c.id} style={{ ['--i' as string]: i }}>
                  {cardButton(c)}
                </li>
              ))}
            </FanHand>
          );
        }
        return (
          <div className="suits">
            {SUITS.map((suit) => {
              const group = cards.filter((c) => c.suit === suit);
              if (!group.length) return null;
              const headId = `suit-${suit}`;
              return (
                <div key={suit} role="group" aria-labelledby={headId} className="suit-group">
                  <h3 id={headId}>
                    {SUIT_NAMES[suit]} ({group.length})
                  </h3>
                  <ul className="cards">
                    {group.map((c) => (
                      <li key={c.id} style={{ ['--i' as string]: cards.indexOf(c) }}>
                        {cardButton(c)}
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
        );
      })()}
    </section>
  );
}

/**
 * Fan layout: one overlapping row. Sizing rule: each card keeps at least a 48px
 * strip visible (the minimum touch target); if the row can't fit that, it wraps
 * into two fans so up to 12 cards always stay reachable.
 */
function FanHand({ count, children }: { count: number; children: ReactNode }) {
  const ref = useRef<HTMLUListElement>(null);
  const [step, setStep] = useState<number | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fit = () => {
      const card = el.querySelector<HTMLElement>('button.card');
      const cw = card?.offsetWidth ?? 72;
      const w = el.clientWidth;
      const perRow = Math.max(1, Math.ceil(count / (count * 48 + cw > w ? 2 : 1)));
      setStep(Math.max(48, Math.min(cw + 6, (w - cw) / Math.max(1, perRow - 1))));
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [count]);
  return (
    <ul ref={ref} className="cards fan" aria-label={`Your hand, ${count} ${count === 1 ? 'card' : 'cards'}`} style={step ? { ['--step' as string]: `${step}px`, ['--n' as string]: count } : undefined}>
      {children}
    </ul>
  );
}

function Spectator({ room }: { room: RoomSnapshot }) {
  const me = room.members.find((m) => m.memberId === room.you.memberId);
  const bots = room.seats.some((s) => s.kind === 'bot');
  return (
    <section className="panel" aria-labelledby="spec-h">
      <h2 id="spec-h">You are watching</h2>
      <p>You can't see anyone's cards. {bots ? 'You can take over a bot seat when the next round starts.' : 'All seats have players.'}</p>
      {bots && (
        <label className="check">
          <input type="checkbox" checked={!!me?.wantsSeat} onChange={(e) => act('wantSeat', { wants: e.target.checked })} />
          Take a bot's seat next round
        </label>
      )}
    </section>
  );
}

function GameLog() {
  const { history } = useAnnouncer();
  const recent = history.slice(-40).reverse();
  return (
    <section className="panel log" aria-labelledby="log-h">
      <details>
        <summary id="log-h">
          Game log ({history.length}){history.length > 0 && <span className="log-latest"> — latest: {history[history.length - 1].text}</span>}
        </summary>
        <ol className="list compact" reversed>
          {recent.map((e) => (
            <li key={e.id}>{e.text}</li>
          ))}
        </ol>
      </details>
    </section>
  );
}
