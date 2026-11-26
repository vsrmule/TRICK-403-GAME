import { Card, SUIT_NAMES, cardName, points } from './cards';
import { trickLeader } from './game';
import { Catalog, catalog } from './i18n';
import { BidAction, Contract, GameEvent, RoundResult } from './types';
import { PlayerView } from './view';

/** Names indexed by seat. */
export type Names = string[];

/** An announcement: `text` for the screen reader and history, `voice` for the built-in voice. */
export interface Spoken {
  text: string;
  voice: string;
}

export function teamLabel(team: number, numPlayers: number, names: Names, L: Catalog = catalog()): string {
  if (numPlayers === 3 || numPlayers === 2) return names[team] ?? `Player ${team + 1}`;
  return L.team(team);
}

function who(seat: number, me: number | null, names: Names, L: Catalog = catalog()): string {
  return seat === me ? L.you : names[seat] ?? `Seat ${seat + 1}`;
}

export function bidName(v: number, L: Catalog = catalog()): string {
  return L.bidName(v);
}

export function describeBid(a: BidAction, L: Catalog = catalog()): string {
  switch (a.type) {
    case 'bid': return `bid ${L.bidName(a.value)}`;
    case 'pass': return 'passed';
    case 'challengeCoat': return 'called Challenge Coat';
  }
}

export function describeContract(c: Contract, names: Names, me: number | null, L: Catalog = catalog()): string {
  const w = who(c.bidder, me, names, L);
  if (c.type === 'challengeCoat') return `${w}: Challenge Coat (must win every trick)`;
  return `${w}: bid ${L.bidName(c.value)}`;
}

export function cardLabel(c: Card, playable: boolean, reason?: string): string {
  const status = playable ? 'Playable' : `Disabled: ${reason ?? 'Not playable'}`;
  return `${cardName(c)}, ${points(c)} points — ${status}`;
}

const pick = (variants: string[], seed: number) => variants[Math.abs(seed) % variants.length];
const one = (variants: string[], seed: number): Spoken => ({ text: variants[0], voice: pick(variants, seed) });

/** Describe an event. `seed` varies the spoken wording; text stays the first, clearest form. */
export function describeEvent(e: GameEvent, names: Names, me: number | null, v: PlayerView, seed = 0, L: Catalog = catalog()): Spoken | null {
  const n = v.config.numPlayers;
  const W = (s: number) => who(s, me, names, L);
  const teamMode = n === 4 || n === 6 || n === 8;
  // Your own actions are always said the plain way ("You played …"); variety is for others.
  if ('seat' in e && e.seat === me) seed = 0;
  switch (e.kind) {
    case 'roundStart':
      return one(L.ev.roundStart(e.round, W(e.dealer), e.cardsEach, me !== null), seed);
    case 'redeal':
      return one(L.ev.redeal(), seed);
    case 'bid':
      if (e.action.type === 'pass') return one(L.ev.pass(W(e.seat)), seed);
      if (e.action.type === 'challengeCoat') return one(L.ev.challengeCoat(W(e.seat)), seed);
      return one(L.ev.bid(W(e.seat), L.bidName(e.action.value)), seed);
    case 'biddingWon':
      return e.contract.type === 'challengeCoat'
        ? one(L.ev.biddingWonChallenge(W(e.seat)), seed)
        : one(L.ev.biddingWon(W(e.seat), L.bidName(e.contract.value)), seed);
    case 'trumpChosen':
      return e.seat === me ? null : one(L.ev.trumpChosen(names[e.seat]), seed);
    case 'yourTrump':
      return one(L.ev.yourTrump(L.card(e.card.rank, e.card.suit), L.suits[e.card.suit]), seed);
    case 'firstLead':
      return one(L.ev.firstLead(W(e.bidder), W(e.seat)), seed);
    case 'youPlayedTrumpCard':
      return one(L.ev.youPlayedTrumpCard(), seed);
    case 'trumpAsked':
      return null; // announced together with the reveal that immediately follows
    case 'trumpRevealed':
      if (e.how === 'asked') return one(L.ev.trumpAsked(W(e.seat), L.suits[e.suit]), seed);
        return one(L.ev.trumpRevealedByBidder(W(e.seat), L.suits[e.suit]), seed);
    case 'cardPlayed':
      return one(L.ev.cardPlayed(W(e.seat), L.card(e.card.rank, e.card.suit), e.asTrump), seed);
    case 'trickWon': {
      const won = L.ev.trickWon(W(e.seat), teamLabel(e.team, n, names, L), e.points, e.trickIndex + 1, teamMode);
      // CR v5 change 3: the score line follows every trick.
      const line = e.captured.map((c, t) => `${teamLabel(t, n, names, L)} ${c}`).join(', ');
      const score = L.ev.roundScore(line, teamLabel(e.bidderTeam, n, names, L), L.bidName(e.bid));
      return { text: `${won[0]} ${score}`, voice: `${pick(won, seed)} ${score}` };
    }
    case 'coat':
      return one(L.ev.coat(W(e.seat), teamLabel(e.team, n, names, L)), seed);
    case 'turn':
      if (e.seat === me) {
        if (e.phase === 'bidding') return one(L.ev.yourTurnBid(), seed);
        if (e.phase === 'trumpSelect') return one(L.ev.yourTurnTrump(), seed);
        const leading = !!v.currentTrick && v.currentTrick.plays.length === 0 && v.turn === e.seat;
        return one(leading ? L.ev.yourTurnLead() : L.ev.yourTurnPlay(), seed);
      }
      if (e.phase === 'bidding') return one(L.ev.waitBid(names[e.seat]), seed);
      if (e.phase === 'trumpSelect') return one(L.ev.waitTrump(names[e.seat]), seed);
      return null;
    case 'roundOver': {
      const r = describeResultParts(e.result, e.scores, names, n, L);
      const variants = (e.result.success ? L.ev.roundMade : L.ev.roundStopped)(r.side, r.call, r.gained);
      const tail = `${r.captured}${L.ev.scores(r.line)}`;
      const stop = stopText(e.result, names, n, L);
      return { text: `${stop}Round ${e.result.round} over. ${variants[0]} ${tail}`, voice: `${stop}${pick(variants, seed)} ${L.ev.scores(r.line)}` };
    }
    case 'matchOver': {
      const winner = e.winners.map((t) => teamLabel(t, n, names, L)).join(' and ');
      return one(L.ev.matchWon(winner, scoreLine(e.scores, names, n, L)), seed);
    }
  }
}

export function scoreLine(scores: number[], names: Names, n: number, L: Catalog = catalog()): string {
  return scores.map((s, t) => `${teamLabel(t, n, names, L)} ${s}`).join(', ');
}

function describeResultParts(r: RoundResult, scores: number[], names: Names, n: number, L: Catalog) {
  const side = teamLabel(r.callerTeam, n, names, L);
  const call = r.kind === 'challengeCoat' ? 'Challenge Coat' : r.kind === 'coat' ? `Coat on ${L.bidName(r.bidValue)}` : `bid of ${L.bidName(r.bidValue)}`;
  const gained = r.awarded.map((a, t) => (a ? `${teamLabel(t, n, names, L)} +${a}` : null)).filter(Boolean).join(', ');
  const bidderSide = teamLabel(n === 3 ? r.bidder : r.bidder % 2, n, names, L);
  const captured = r.kind === 'normal' ? `${L.ev.captured(bidderSide, r.capturedPoints[n === 3 ? r.bidder : r.bidder % 2], r.bidValue)} ` : '';
  return { side, call, gained, captured, line: scoreLine(scores, names, n, L) };
}

/** "Round stopped: …" sentence for an early stop (CR v5), or empty. */
export function stopText(r: RoundResult, names: Names, n: number, L: Catalog = catalog()): string {
  if (!r.stopReason) return '';
  const side = teamLabel(r.callerTeam, n, names, L);
  const bid = L.bidName(r.bidValue);
  switch (r.stopReason) {
    case 'bidReached': return `${L.ev.stopped.bidReached(side, bid)} `;
    case 'bidImpossible': return `${L.ev.stopped.bidImpossible(side, bid)} `;
    case 'coatFailed': return `${L.ev.stopped.coatFailed(side)} `;
    case 'challengeCoatFailed': return `${L.ev.stopped.challengeCoatFailed(side)} `;
  }
}

export function describeResult(r: RoundResult, scores: number[], names: Names, n: number, L: Catalog = catalog()): string {
  const p = describeResultParts(r, scores, names, n, L);
  const head = (r.success ? L.ev.roundMade : L.ev.roundStopped)(p.side, p.call, p.gained)[0];
  return `${stopText(r, names, n, L)}Round ${r.round} over. ${head} ${p.captured}${L.ev.scores(p.line)}`;
}

/** Spoken "Table Status" readout (T). */
export function tableStatus(v: PlayerView, names: Names, L: Catalog = catalog()): string {
  const me = v.seat;
  const W = (s: number) => who(s, me, names, L);
  if (v.phase === 'bidding') {
    const hb = v.highBid ? `Highest: ${W(v.highBid.seat)} ${describeBid(v.highBid.action, L)}.` : 'No bids yet.';
    return `Bidding. ${hb} Waiting for ${W(v.turn)}.`;
  }
  if (v.phase === 'trumpSelect') return `${W(v.turn)} is choosing trump.`;
  if (v.phase !== 'playing' || !v.currentTrick) return 'No trick in progress.';
  const t = v.currentTrick;
  if (t.plays.length === 0) return `Trick ${t.index + 1} of ${v.cardsEach}. No cards on the table. ${W(t.leader)} to lead.`;
  const cards = t.plays.map((p) => `${W(p.seat)}: ${cardName(p.card)}${p.asTrump ? ' (trump)' : ''}`).join('; ');
  const lead = trickLeader(t.plays, v.trumpRevealed ? v.trumpSuit : null)!;
  return `Trick ${t.index + 1} of ${v.cardsEach}. ${W(t.leader)} led ${SUIT_NAMES[t.plays[0].card.suit]}. ${cards}. Currently winning: ${W(lead.seat)}. Next: ${W(v.turn)}.`;
}

/** Spoken "Score & Bid" readout (S). */
export function scoreStatus(v: PlayerView, names: Names, L: Catalog = catalog()): string {
  const n = v.config.numPlayers;
  const parts: string[] = [];
  if (v.contract) parts.push(`Contract: ${describeContract(v.contract, names, v.seat, L)}.`);
  else if (v.highBid) parts.push(`Highest bid so far: ${who(v.highBid.seat, v.seat, names, L)} ${describeBid(v.highBid.action, L)}.`);
  else parts.push('No contract yet.');
  if (v.coat) parts.push(`Coat called by ${who(v.coat.seat, v.seat, names, L)}.`);
  if (v.contract) {
    if (v.trumpRevealed && v.trumpSuit) parts.push(`Trump: ${SUIT_NAMES[v.trumpSuit]}.`);
    else if (v.myTrumpIndicator) parts.push(`Trump: hidden from the others. Your trump is ${SUIT_NAMES[v.myTrumpIndicator.suit]}.`);
    else if (v.phase === 'playing') parts.push('Trump: hidden.');
  }
  if (v.contract && v.phase === 'playing') {
    const cap = new Array(v.numTeams).fill(0);
    for (const t of v.completedTricks) cap[t.winnerTeam] += t.points;
    parts.push(`Captured this round: ${cap.map((c, t) => `${teamLabel(t, n, names, L)} ${c}`).join(', ')}.`);
  }
  parts.push(`Game points: ${scoreLine(v.scores, names, n, L)}. Target ${v.config.matchTarget}.`);
  if (v.seat !== null && n !== 3 && n !== 2) parts.push(`You are on ${teamLabel(v.teams[v.seat], n, names, L)}.`);
  return parts.join(' ');
}

/** Readout of the won-tricks basket (B). */
export function basketSummary(v: PlayerView, names: Names, L: Catalog = catalog()): string {
  if (v.completedTricks.length === 0) return 'The basket is empty. No tricks completed yet this round.';
  return v.completedTricks
    .map(
      (t) =>
        `Trick ${t.index + 1}, won by ${who(t.winner, v.seat, names, L)}, ${t.points} points: ` +
        t.plays.map((p) => `${who(p.seat, v.seat, names, L)} ${cardName(p.card)}`).join(', '),
    )
    .join('. ');
}

/**
 * Turn-by-turn instruction for this player: what they can do right now.
 * Spoken by the game's own voice and shown on screen, with or without a screen reader.
 */
export function guidance(v: PlayerView, names: Names, opts: { ready?: boolean; isHost?: boolean } = {}, L: Catalog = catalog()): string {
  const me = v.seat;
  if (me === null || !v.legal) return L.guide.watching();
  const G = L.guide;
  const Lg = v.legal;
  if (v.phase === 'matchOver') return G.matchOver(!!opts.isHost);
  if (v.phase === 'roundOver') return opts.ready ? G.readyDone() : G.ready();
  if (v.turn !== me) return G.waiting(names[v.turn] ?? `Seat ${v.turn + 1}`);
  if (v.phase === 'bidding') return G.bid(Lg.bidOptions.length ? L.bidName(Lg.bidOptions[0]) : null, Lg.canChallengeCoat);
  if (v.phase === 'trumpSelect') return G.trump();
  const coat = Lg.coat.allowed;
  // Issue 6.4(b): remind the bidder they can reveal trump whenever they like.
  const rev = Lg.canRevealTrump ? ` ${G.canReveal()}` : '';
  const led = v.currentTrick && v.currentTrick.plays.length ? v.currentTrick.plays[0].card.suit : null;
  if (!led) return G.lead(coat) + rev;
  const suit = L.suits[led];
  const follow = v.myHand.filter((c) => c.suit === led).length;
  if (follow > 0) return G.follow(suit, follow, coat) + rev;
  if (Lg.canAskTrump) return G.voidAsk(suit);
  if (Lg.canRevealTrump) return G.voidReveal(suit);
  if (v.trumpRevealed && v.trumpSuit && Lg.playable.length && Lg.playable.length < v.myHand.length) return G.mustTrump();
  return G.voidOpen(suit) + (coat ? ' You can also call Coat.' : '');
}
