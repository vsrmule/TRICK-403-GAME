import type { Rank, Suit } from './cards';
import { RULES } from './rules';

/**
 * Text & speech catalog. Add a language by adding another Catalog to CATALOGS.
 * `v(...)` lists spoken variants: the first is also the screen-reader text, so it
 * must be the clearest; the others add light variety to the built-in voice.
 */
export interface Catalog {
  code: string;
  name: string;
  /** Text direction; 'rtl' languages flip the whole layout. */
  dir: 'ltr' | 'rtl';
  gameName: string;
  suits: Record<Suit, string>;
  ranks: Record<Rank, string>;
  you: string;
  team: (t: number) => string;
  card: (rank: Rank, suit: Suit) => string;
  pts: (n: number) => string;
  bidName: (v: number) => string;
  credits: { id: string; text: string }[];
  intro: { title: string; narration: string };
  ev: {
    roundStart: (round: number, dealer: string, cards: number, seated: boolean) => string[];
    redeal: () => string[];
    bid: (who: string, bid: string) => string[];
    pass: (who: string) => string[];
    challengeCoat: (who: string) => string[];
    selfCoat: (who: string) => string[];
    biddingWon: (who: string, bid: string) => string[];
    biddingWonChallenge: (who: string) => string[];
    biddingWonSelf: (who: string, teamMode: boolean) => string[];
    /** To the bidder: the bid is reached, Stop or Continue? */
    bidReachedChoice: () => string[];
    /** To everyone else while the bidder decides. */
    bidReachedWait: (side: string, bid: string, bidder: string) => string[];
    continued: (who: string) => string[];
    /** Round cancelled and dealt again (exact wording from the game owner). */
    cancelled: { allJacks: string; noTrump: string };
    trumpChosen: (who: string) => string[];
    yourTrump: (card: string, suit: string) => string[];
    firstLead: (bidder: string, leader: string) => string[];
    youPlayedTrumpCard: () => string[];
    trumpAsked: (who: string, suit: string) => string[];
    trumpRevealedByBidder: (who: string, suit: string) => string[];
    cardPlayed: (who: string, card: string, trump: boolean) => string[];
    trickWon: (who: string, side: string, pts: number, n: number, teamMode: boolean) => string[];
    coat: (who: string, side: string) => string[];
    yourTurnBid: () => string[];
    yourTurnTrump: () => string[];
    yourTurnLead: () => string[];
    yourTurnPlay: () => string[];
    waitBid: (who: string) => string[];
    waitTrump: (who: string) => string[];
    roundMade: (side: string, call: string, gained: string) => string[];
    roundStopped: (side: string, call: string, gained: string) => string[];
    scores: (line: string) => string;
    captured: (side: string, pts: number, bid: number) => string;
    /** Score line after every trick (CR v5 change 3). */
    roundScore: (line: string, side: string, bid: string) => string;
    /** Self Coat: the running score, then what the caller must do. */
    roundScoreSelfCoat: (line: string, caller: string) => string;
    /** Why the round stopped early (CR v5). */
    stopped: {
      bidReached: (side: string, bid: string) => string;
      bidImpossible: (side: string, bid: string) => string;
      coatFailed: (side: string) => string;
      challengeCoatFailed: (side: string) => string;
      selfCoatFailed: (side: string) => string;
    };
    matchWon: (winner: string, line: string) => string[];
  };
  /** Turn-by-turn instructions: what you can do right now. */
  guide: {
    bid: (lowest: string | null, challenge: boolean, selfCoat?: boolean) => string;
    continueChoice: () => string;
    sittingOut: (caller: string) => string;
    trump: () => string;
    lead: (coat: boolean) => string;
    follow: (suit: string, count: number, coat: boolean) => string;
    voidAsk: (suit: string) => string;
    voidReveal: (suit: string) => string;
    canReveal: () => string;
    voidOpen: (suit: string) => string;
    mustTrump: () => string;
    coatRefused: (reason: string) => string;
    ready: () => string;
    readyDone: () => string;
    matchOver: (host: boolean) => string;
    waiting: (who: string) => string;
    watching: () => string;
    tip: () => string;
  };
}

/** English verb agreement: "You play" but "Arjun plays". */
const vs = (who: string, verb: string, third = `${verb}s`) => `${who} ${who === 'You' ? verb : third}`;
/** "from Arjun" / "from you". */
const from = (who: string) => (who === 'You' ? 'you' : who);

const en: Catalog = {
  code: 'en',
  name: 'English',
  dir: 'ltr',
  gameName: 'Trick 304',
  suits: { S: 'Spades', H: 'Hearts', C: 'Clubs', D: 'Diamonds' },
  ranks: { J: 'Jack', '9': 'Nine', A: 'Ace', '10': 'Ten', K: 'King', Q: 'Queen' },
  you: 'You',
  team: (t) => (t === 0 ? 'Team A' : 'Team B'),
  card: (r, s) => `${en.ranks[r]} of ${en.suits[s]}`,
  pts: (n) => `${n} ${n === 1 ? 'point' : 'points'}`,
  bidName: (v) => {
    if (v === RULES.bidding.top) return String(v); // DEFAULT: 304 is spoken "304"
    if (v >= RULES.bidding.namedFrom) return v === RULES.bidding.namedFrom ? 'Jaan' : `Jaan ${v - RULES.bidding.namedFrom}`;
    return String(v);
  },
  credits: [
    { id: 'mvs', text: 'Designed and developed by MVS' },
    { id: 'ks', text: 'Ideated by KS' },
    { id: 'gvs', text: 'Guided by GVS' },
  ],
  intro: {
    title: 'Trick 304',
    narration: 'Welcome to the table. Gather your friends, listen for the cards, and may your Jacks be plenty.',
  },
  ev: {
    roundStart: (r, d, k, seated) => [
      `Round ${r}. ${d} dealt ${k} cards each.${seated ? ' Your hand is ready.' : ''}`,
      `Round ${r} begins. ${vs(d, 'deal')} ${k} cards each.`,
    ],
    redeal: () => ['Everyone passed. The cards are dealt again.', 'All passed. Fresh deal coming.'],
    bid: (w, b) => [`${w} bid ${b}.`, `${vs(w, 'say')} ${b}.`, `${b}, from ${from(w)}.`],
    pass: (w) => [`${w} passed.`, `${vs(w, 'pass', 'passes')}.`],
    challengeCoat: (w) => [`${w} called Challenge Coat! Every trick must be won.`, `Challenge Coat from ${from(w)}! Every trick must be won.`],
    selfCoat: (w) => [`${w} called Self Coat! ${vs(w, 'play')} alone, with no trump, and must win every trick.`],
    biddingWon: (w, b) => [`${w} won the bid at ${b}.`, `The bid goes to ${w}, at ${b}.`],
    biddingWonChallenge: (w) => [`${w} plays Challenge Coat.`],
    biddingWonSelf: (w, team) => [`${w} ${w === 'You' ? 'play' : 'plays'} Self Coat. No trump this hand.${team ? ` ${w === 'You' ? 'Your' : `${w}'s`} teammates sit out.` : ''}`],
    bidReachedChoice: () => ['Your team has already reached its bid. Would you like to continue the game?'],
    bidReachedWait: (side, bid, b) => [`${side} reached the bid of ${bid}. Waiting for ${b}.`],
    continued: (w) => [`${w} chose to continue. Play on!`],
    cancelled: {
      allJacks: 'Round cancelled: one team has all four Jacks. Dealing again.',
      noTrump: 'Round cancelled: one team has no card of the trump suit. Dealing again.',
    },
    trumpChosen: (w) => [`${w} has placed the trump card.`, `${w} has placed the trump card. It stays hidden.`],
    yourTrump: (c, s) => [`You placed the ${c} as your trump card. Trump is ${s}. Only you know it. You can still play this card.`],
    firstLead: (b, l) => [`${b} ${b === 'You' ? 'are' : 'is'} the bidder. ${vs(l, 'lead')} the first trick.`],
    youPlayedTrumpCard: () => ['You played your trump card. Trump stays hidden unless you reveal it.'],
    trumpAsked: (w, s) => [`${w} asked for trump. Trump is ${s}.`],
    trumpRevealedByBidder: (w, s) => [`${w} revealed trump. Trump is ${s}.`],
    cardPlayed: (w, c, t) =>
      t
        ? [`${w} played ${c}, trump.`, `${vs(w, 'trump')} with the ${c}.`]
        : [`${w} played ${c}.`, `${vs(w, 'play')} the ${c}.`, `${c}, from ${from(w)}.`],
    trickWon: (w, side, p, n, teamMode) =>
      teamMode
        ? [`${w} won trick ${n} for ${side}, ${p} points.`, `This trick, ${side} got it. ${p} points.`, `${vs(w, 'take')} it! ${p} points to ${side}.`]
        : [`${w} won trick ${n}, ${p} points.`, `${vs(w, 'take')} trick ${n}. ${p} points.`],
    coat: (w, side) => [`Coat accepted. ${w} called Coat: ${side} must win every remaining trick.`, `Coat accepted! ${side} needs every trick from here.`],
    yourTurnBid: () => ['Your turn to bid.', 'Your bid.'],
    yourTurnTrump: () => ['You won the bid. Choose one card as your hidden trump card.'],
    yourTurnLead: () => ['Your turn to lead.', 'Your lead.'],
    yourTurnPlay: () => ['Your turn to play.', 'Your turn.'],
    waitBid: (w) => [`Waiting for ${w} to bid.`],
    waitTrump: (w) => [`Waiting for ${w} to choose trump.`],
    roundMade: (side, call, g) => [`${side} made the ${call}. ${g}.`, `${side} did it! ${call[0].toUpperCase()}${call.slice(1)} made. ${g}.`],
    roundStopped: (side, call, g) => [`${side} was stopped on the ${call}. ${g}.`, `Stopped! ${side} missed the ${call}. ${g}.`],
    scores: (line) => `Scores: ${line}.`,
    captured: (side, p, b) => `${side} captured ${p} of ${b} needed.`,
    roundScore: (line, side, bid) => `Round score: ${line}. ${side} needs ${bid}.`,
    roundScoreSelfCoat: (line, c) => `Round score: ${line}. ${c} must win every trick.`,
    stopped: {
      bidReached: (side, bid) => `Round stopped: ${side} reached the bid of ${bid}.`,
      bidImpossible: (side, bid) => `Round stopped: ${side} can no longer reach the bid of ${bid}.`,
      coatFailed: (side) => `Coat failed: ${side} lost a trick. Round stopped.`,
      challengeCoatFailed: (side) => `Challenge Coat failed: ${side} lost a trick. Round stopped.`,
      selfCoatFailed: (side) => `Self Coat failed: ${side} lost a trick. Round stopped.`,
    },
    matchWon: (w, line) => [`Match over! ${w} wins. Final score ${line}.`, `${w} wins the match! Final score ${line}.`],
  },
  guide: {
    bid: (lo, ch, sc) => {
      const calls = [ch && 'Challenge Coat', sc && 'Self Coat'].filter(Boolean).join(' or ');
      return lo ? `Bid ${lo} or higher, or pass.${calls ? ` You can also call ${calls}.` : ''}` : `No higher bid is left. Pass${calls ? `, or call ${calls}` : ''}.`;
    },
    continueChoice: () => 'Your team has already reached its bid. Choose Stop to end the round now, or Continue to play on.',
    sittingOut: (c) => `You sit out this hand: ${c} plays Self Coat alone. Your cards stay in your hand.`,
    trump: () => 'Pick one card as your hidden trump card. Its suit becomes trump. Only you see it, and you can still play it.',
    lead: (coat) => `You lead this trick. Play any card from your hand.${coat ? ' You can also call Coat.' : ''}`,
    follow: (suit, n, coat) => `Follow ${suit}. You have ${n} ${n === 1 ? 'card' : 'cards'} in ${suit}; play one of them.${coat ? ' You can also call Coat.' : ''}`,
    voidAsk: (suit) => `You have no ${suit}. Play any card, or ask for trump.`,
    voidReveal: (suit) => `You have no ${suit}. Play any card, or reveal trump. A trump-suit card can only win once trump is revealed.`,
    canReveal: () => 'You can reveal trump at any time on your turn.',
    voidOpen: (suit) => `You have no ${suit}. Play any card.`,
    mustTrump: () => 'You asked for trump, so play a trump card now.',
    coatRefused: (r) => `${r}.`,
    ready: () => 'Round over. Choose Ready for next round when you are ready.',
    readyDone: () => 'You are ready. Waiting for the other players.',
    matchOver: (host) => (host ? 'Match over. Choose Back to lobby to play again.' : 'Match over. Waiting for the host to start a rematch.'),
    waiting: (w) => `Waiting for ${w}.`,
    watching: () => 'You are watching this game.',
    tip: () => 'Tip: choose What now, or press I, any time to hear what you can do.',
  },
};

export const CATALOGS: Record<string, Catalog> = { en };
export const DEFAULT_LANG = 'en';

export function catalog(code: string = DEFAULT_LANG): Catalog {
  return CATALOGS[code] ?? CATALOGS[DEFAULT_LANG];
}
