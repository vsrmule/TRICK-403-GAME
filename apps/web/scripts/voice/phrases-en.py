"""Writes apps/web/public/voice/en/phrases.json: every phrase the English game voice can say.

Edit the wording here, run `python apps/web/scripts/voice/phrases-en.py`, then regenerate the
clips (see docs/VOICE.md). Each phrase is a list of chunks; a chunk holds at most one {slot}.
"you" gives the wording when the slot is the listening player ("You bid" vs "Seat 3 bids").
"""
import json
import os

RANKS = [('J', 'Jack'), ('9', 'Nine'), ('A', 'Ace'), ('10', 'Ten'), ('K', 'King'), ('Q', 'Queen')]
SUITS = [('S', 'Spades'), ('H', 'Hearts'), ('C', 'Clubs'), ('D', 'Diamonds')]
BOTS = ['Asha', 'Ravi', 'Meera', 'Kiran', 'Devi', 'Arun', 'Lata', 'Vijay', 'Gita', 'Mohan', 'Usha', 'Sunil']

who = {'you': 'You'}
who.update({f's{i}': f'Seat {i}' for i in range(1, 13)})
who.update({f'bot-{b.lower()}': f'Bot {b}' for b in BOTS})
who.update({'team-a': 'Team A', 'team-b': 'Team B'})

bid = {}
for b in list(range(160, 301, 10)) + [304]:
    bid[str(b)] = str(b) if b < 200 or b == 304 else ('Jaan' if b == 200 else f'Jaan {b - 200}')

SLOTS = {
    'who': who,
    'bid': bid,
    'card': {r + s: f'{rn} of {sn}' for r, rn in RANKS for s, sn in SUITS},
    'suit': dict(SUITS),
    'num': {str(i): str(i) for i in range(0, 305)},
    'round': {str(i): str(i) for i in range(1, 151)},
    'count': {str(i): ('one card' if i == 1 else f'{i} cards') for i in range(1, 13)},
    'plus': {str(i): str(i) for i in range(1, 21)},
}

E, C, F = 'excited', 'cheerful', 'friendly'


def P(pid, *chunks, style=None):
    d = {'id': pid, 'chunks': [c if isinstance(c, dict) else {'text': c} for c in chunks]}
    if style:
        d['style'] = style
    return d


def W(text, you):
    return {'text': text, 'you': you}


def X(text):
    return {'text': text, 'style': E}


PHRASES = [
    # Start sequence
    P('gameName', 'Trick 304!', style=E),
    P('credit-mvs', 'Designed and developed by MVS.'),
    P('credit-ks', 'Ideated by KS.'),
    P('credit-gvs', 'Guided by GVS.'),
    P('introNarration', 'Welcome to the table. Gather your friends, listen for the cards, and may your Jacks be plenty!', style=F),
    # Rounds and bidding
    P('roundStart', 'Round {round}!', style=E),
    P('deals', W('{who} deals.', 'You deal.')),
    P('handReady', 'Your hand is ready.'),
    P('redeal', 'Everyone passed!', 'Fresh deal coming!', style=E),
    P('cancelledJacks', 'Round cancelled: one team has all four Jacks. Dealing again.', style=E),
    P('cancelledTrump', 'Round cancelled: one team has no card of the trump suit. Dealing again.', style=E),
    P('pass', W('{who} passes.', 'You pass.')),
    P('bid', W('{who} bids', 'You bid'), X('{bid}!')),
    P('challengeCoat', W('{who} calls Challenge Coat!', 'You call Challenge Coat!'), 'Every trick must be won!', style=E),
    P('biddingWon', W('{who} wins the bid at', 'You win the bid at'), X('{bid}!')),
    P('biddingWonChallenge', W('{who} plays Challenge Coat!', 'You play Challenge Coat!'), style=E),
    # Self Coat
    P('selfCoat', W('{who} calls Self Coat!', 'You call Self Coat!'), 'Playing alone, with no trump. Every trick must be won!', style=E),
    P('biddingWonSelf', W('{who} plays Self Coat!', 'You play Self Coat!'), 'No trump this hand.', style=E),
    P('teammatesSitOut', 'The teammates sit out.'),
    P('stopSelfFailed', 'Self Coat failed!', W('{who} lost a trick.', 'You lost a trick.'), style=E),
    P('madeSelf', W('{who} did it! Self Coat made!', 'You did it! Self Coat made!'), style=E),
    P('missedSelf', 'Stopped!', W('{who} missed the Self Coat.', 'You missed the Self Coat.'), style=E),
    # Bid reached: Stop or Continue
    P('bidReachedChoice', 'Your team has already reached its bid!', 'Would you like to continue the game?', style=E),
    P('reachedBid', W('{who} reached the bid!', 'You reached the bid!'), style=E),
    P('continues', W('{who} continues!', 'You continue!'), 'Play on!', style=E),
    # Trump
    P('trumpChosen', W('{who} has placed the trump card.', 'You have placed the trump card.'), 'It stays hidden.'),
    P('yourTrump', 'Your trump card is the {card}.'),
    P('trumpIs', 'Trump is {suit}!', style=E),
    P('onlyYouKnow', 'Only you know it. You can still play this card.', style=F),
    P('isBidder', W('{who} is the bidder.', 'You are the bidder.')),
    P('leadsFirst', W('{who} leads the first trick.', 'You lead the first trick.')),
    P('youPlayedTrumpCard', 'You played your trump card. Trump stays hidden unless you reveal it.'),
    P('asksTrump', W('{who} asks for trump!', 'You ask for trump!'), style=E),
    P('revealsTrump', W('{who} reveals trump!', 'You reveal trump!'), style=E),
    # Card play and tricks
    P('plays', W('{who} plays', 'You play'), 'the {card}.'),
    P('trumps', W('{who} trumps with', 'You trump with'), 'the {card}!', style=E),
    P('takesTrick', W('{who} takes the trick!', 'You take the trick!'), style=E),
    P('num', '{num}'),
    P('pointsFor', 'points for {who}!'),
    P('points', 'points!'),
    P('roundScore', 'Round score:'),
    P('side', W('{who},', 'You,')),
    P('needs', W('{who} needs', 'You need'), '{bid}.'),
    P('mustWinAll', W('{who} must win every trick!', 'You must win every trick!'), style=E),
    P('coatAccepted', 'Coat accepted!', style=E),
    P('needsEveryTrick', W('{who} needs every trick from here!', 'You need every trick from here!'), style=E),
    # Turns
    P('yourTurnBid', 'Your turn to bid!'),
    P('yourTurnTrump', 'You won the bid! Choose one card as your hidden trump card.', style=E),
    P('yourTurnLead', 'Your lead!'),
    P('yourTurnPlay', 'Your turn!'),
    P('waitBid', 'Waiting for {who} to bid.'),
    P('waitTrump', 'Waiting for {who} to choose trump.'),
    # Round and match results
    P('stopBidReached', 'Round stopped!', W('{who} reached the bid!', 'You reached the bid!'), style=E),
    P('stopBidImpossible', 'Round stopped!', W('{who} can no longer reach the bid.', 'You can no longer reach the bid.'), style=E),
    P('stopCoatFailed', 'Coat failed!', W('{who} lost a trick.', 'You lost a trick.'), style=E),
    P('stopChallengeFailed', 'Challenge Coat failed!', W('{who} lost a trick.', 'You lost a trick.'), style=E),
    P('madeBid', W('{who} did it! Bid made!', 'You did it! Bid made!'), style=E),
    P('madeCoat', W('{who} did it! Coat made!', 'You did it! Coat made!'), style=E),
    P('madeChallenge', W('{who} did it! Challenge Coat made!', 'You did it! Challenge Coat made!'), style=E),
    P('missedBid', 'Stopped!', W('{who} missed the bid.', 'You missed the bid.'), style=E),
    P('missedCoat', 'Stopped!', W('{who} missed the Coat.', 'You missed the Coat.'), style=E),
    P('missedChallenge', 'Stopped!', W('{who} missed the Challenge Coat.', 'You missed the Challenge Coat.'), style=E),
    P('plus', 'plus {plus}!'),
    P('scores', 'Scores:'),
    P('matchOver', 'Match over!', style=E),
    P('wins', W('{who} wins!', 'You win!'), style=E),
    P('finalScore', 'Final score:'),
    # Turn-by-turn instructions
    P('guideBid', 'Bid {bid} or higher, or pass.', style=F),
    P('guideNoHigherBid', 'No higher bid is left. Pass.', style=F),
    P('guideCanChallenge', 'You can also call Challenge Coat.', style=F),
    P('guideCanSelfCoat', 'You can also call Self Coat.', style=F),
    P('guideContinue', 'Choose Stop to end the round now, or Continue to play on.', style=F),
    P('guideSittingOut', 'You sit out this hand. Your teammate plays Self Coat alone. Your cards stay in your hand.', style=F),
    P('guideTrump', 'Pick one card as your hidden trump card. Its suit becomes trump. Only you see it, and you can still play it.', style=F),
    P('guideLead', 'You lead this trick. Play any card from your hand.', style=F),
    P('guideCanCoat', 'You can also call Coat.', style=F),
    P('guideCanReveal', 'You can reveal trump at any time on your turn.', style=F),
    P('guideFollow', 'Follow {suit}.', style=F),
    P('guideYouHave', 'You have {count}. Play one of them.', style=F),
    P('guideVoidAsk', 'You have no {suit}. Play any card, or ask for trump.', style=F),
    P('guideVoidReveal', 'You have no {suit}. Play any card, or reveal trump.', 'A trump-suit card can only win once trump is revealed.', style=F),
    P('guideVoidOpen', 'You have no {suit}. Play any card.', style=F),
    P('guideMustTrump', 'You asked for trump, so play a trump card now.', style=F),
    P('guideReady', 'Round over. Choose Ready for next round when you are ready.', style=F),
    P('guideReadyDone', 'You are ready. Waiting for the other players.', style=F),
    P('guideMatchOverHost', 'Match over. Choose Back to lobby to play again.', style=F),
    P('guideMatchOver', 'Match over. Waiting for the host to start a rematch.', style=F),
    P('waitingFor', 'Waiting for {who}.', style=F),
    P('watching', 'You are watching this game.', style=F),
    P('tip', 'Tip: choose What now, or press I, any time to hear what you can do.', style=F),
    P('stillWaiting', 'Still waiting for {who}.', style=F),
    P('turnOf', W("{who}'s turn.", 'Your turn.')),
    # Rooms and controls
    P('joinedRoom', 'Joined room'),
    P('lobbyHost', 'You are in the lobby. Fill empty seats with bots or wait for friends, then choose Start game.', style=F),
    P('lobbyGuest', 'You are in the lobby. Waiting for the host to start the game.', style=F),
    P('homeHelp', 'Enter your name, then create a room or join one with a 6-digit code.', style=F),
    P('gameInProgress', 'Game in progress.'),
    P('youAreHost', 'You are the host.'),
    P('leftRoom', 'You left the room.'),
    P('notInRoom', 'You are not in a room.'),
    P('notStarted', 'The game has not started.'),
    P('voiceChatOff', 'Voice chat is off.'),
    P('noMic', 'No microphone available.'),
    P('micMuted', 'Microphone muted.'),
    P('micOn', 'Microphone on.'),
    P('noHand', 'You have no hand right now.'),
    P('codeCopied', 'Room code copied.'),
    P('inviteCopied', 'Invite link copied.'),
    P('chatNeedsRoom', 'Text chat is available once you are in a room.'),
    P('talking', 'Talking. Activate again to stop.'),
    P('stoppedTalking', 'Stopped talking.'),
    P('tenSeconds', '10 seconds left.', style=E),
    P('coatNotAvailable', 'Coat is not available now.'),
    P('updateAvailable', 'A new version of Trick 304 is available. Choose Download update to install it.', style=F),
    P('testVoice', 'This is the game voice. Have a great game!', style=E),
]

ids = [p['id'] for p in PHRASES]
assert len(ids) == len(set(ids)), 'duplicate phrase id'
book = {'lang': 'en', 'voice': 'en-US-JennyNeural', 'style': C, 'slots': SLOTS, 'phrases': PHRASES}
out = os.path.join(os.path.dirname(__file__), '..', '..', 'public', 'voice', 'en', 'phrases.json')
with open(out, 'w', encoding='utf8') as f:
    json.dump(book, f, ensure_ascii=False, indent=1)
print(f'{len(PHRASES)} phrases -> {os.path.normpath(out)}')
