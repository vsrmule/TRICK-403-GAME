import { CATALOGS, basketSummary, cardName, RoomSnapshot } from '@g304/engine';
import { announcer } from '../announcer';
import { prefs, usePrefs } from '../prefs';
import { TutorialVideo } from './Tutorial';
import { sfx } from '../sfx';
import { useVoice, voice } from '../voice';
import { CardFace, Dialog, act, isTeamMode, names, sideName } from './ui';

export function BasketDialog({ room, open, onClose }: { room: RoomSnapshot; open: boolean; onClose: () => void }) {
  const v = room.view;
  const who = (s: number) => (s === room.you.seat ? 'You' : room.seats[s]?.name);
  return (
    <Dialog open={open} onClose={onClose} title="Won-tricks basket" wide>
      {!v || v.completedTricks.length === 0 ? (
        <p>The basket is empty. No tricks have been completed this round.</p>
      ) : (
        <>
          <button className="btn" onClick={() => announcer.say(basketSummary(v, names(room)), { interrupt: true })}>
            Read whole basket aloud
          </button>
          {Array.from({ length: v.numTeams }, (_, team) => {
            const tricks = v.completedTricks.filter((t) => t.winnerTeam === team);
            const pts = tricks.reduce((s, t) => s + t.points, 0);
            const label = sideName(room, team);
            const members = isTeamMode(v.config.numPlayers) ? ` (${v.teams.map((t, s) => (t === team ? room.seats[s].name : null)).filter(Boolean).join(', ')})` : '';
            return (
              <section key={team} aria-labelledby={`basket-${team}`}>
                <h3 id={`basket-${team}`}>
                  {label}
                  {members}: {tricks.length} {tricks.length === 1 ? 'trick' : 'tricks'}, {pts} points
                </h3>
                {tricks.length === 0 ? (
                  <p>No tricks won yet.</p>
                ) : (
                  <ol className="list">
                    {tricks.map((t) => (
                      <li key={t.index}>
                        <h4>
                          Trick {t.index + 1}: won by {who(t.winner)}, {t.points} points
                        </h4>
                        <ul className="played">
                          {t.plays.map((p, i) => (
                            <li key={p.card.id} className={p.seat === t.winner ? 'winning' : ''}>
                              <CardFace card={p.card} small />
                              <span>
                                {who(p.seat)}
                                {i === 0 ? ' led' : ''}: {cardName(p.card)}
                                {p.asTrump ? ' (trump)' : ''}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </li>
                    ))}
                  </ol>
                )}
              </section>
            );
          })}
        </>
      )}
    </Dialog>
  );
}

function Slider(props: { id: string; label: string; value: number; onChange: (v: number) => void; hint?: string }) {
  return (
    <div className="slider">
      <label htmlFor={props.id}>
        {props.label}: {props.value}%
      </label>
      <input
        id={props.id}
        type="range"
        min={0}
        max={100}
        step={5}
        value={props.value}
        aria-valuetext={`${props.value} percent`}
        aria-describedby={props.hint ? `${props.id}-hint` : undefined}
        onChange={(e) => props.onChange(Number(e.target.value))}
      />
      {props.hint && (
        <p id={`${props.id}-hint`} className="hint">
          {props.hint}
        </p>
      )}
    </div>
  );
}

function Check(props: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="check">
      <input type="checkbox" checked={props.checked} onChange={(e) => props.onChange(e.target.checked)} />
      {props.label}
    </label>
  );
}

export function SettingsDialog({ room, open, onClose }: { room: RoomSnapshot | null; open: boolean; onClose: () => void }) {
  const p = usePrefs();
  const vs = useVoice();
  const others = room?.members.filter((m) => m.memberId !== room.you.memberId) ?? [];
  return (
    <Dialog open={open} onClose={onClose} title="Settings" wide>
      <section aria-labelledby="mix-h">
        <h3 id="mix-h">Audio mixer</h3>
        <Slider id="vol-voice" label="Voice chat" value={p.voiceVolume} onChange={(v) => prefs.set({ voiceVolume: v })} />
        <Slider
          id="vol-ann"
          label="Announcements (in-game voice)"
          value={p.announceVolume}
          onChange={(v) => prefs.set({ announceVolume: v })}
          hint="Your screen reader's own volume is set in TalkBack, VoiceOver, NVDA or JAWS."
        />
        <Slider
          id="vol-sfx"
          label="Sound effects"
          value={p.sfxVolume}
          onChange={(v) => {
            prefs.set({ sfxVolume: v });
            sfx.unlock();
            sfx.play('play');
          }}
        />
        <Slider id="vol-music" label="Music" value={p.musicVolume} onChange={(v) => prefs.set({ musicVolume: v })} />
        <Check label="Background music (off by default so you can hear each other)" checked={p.musicOn} onChange={(v) => prefs.set({ musicOn: v })} />
        <Check label="Lower effects and music while announcements are spoken" checked={p.duck} onChange={(v) => prefs.set({ duck: v })} />
      </section>

      <section aria-labelledby="speech-h">
        <h3 id="speech-h">Announcements</h3>
        <Check
          label="Game voice: speak announcements in the game's own built-in voice"
          checked={p.gameVoice}
          onChange={(v) => prefs.set({ gameVoice: v })}
        />
        <p className="hint">
          {p.gameVoice
            ? 'The game speaks with its own recorded voice on every device, with or without a screen reader. Chat and other free text go to your screen reader and the captions.'
            : 'Off: announcements go to your screen reader and the captions only.'}
        </p>
        <label>
          Announcement pace
          <select className="input" value={p.speechRate} onChange={(e) => prefs.set({ speechRate: Number(e.target.value) })}>
            <option value={0.85}>Slow</option>
            <option value={1}>Normal</option>
            <option value={1.25}>Fast</option>
            <option value={1.5}>Very fast</option>
          </select>
        </label>
        <label>
          Language
          <select className="input" value={p.lang} onChange={(e) => prefs.set({ lang: e.target.value })}>
            {Object.values(CATALOGS).map((c) => (
              <option key={c.code} value={c.code}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <Check label="Read new chat messages aloud" checked={p.readChat} onChange={(v) => prefs.set({ readChat: v })} />
        <Check
          label="Turn-by-turn instructions: say and show what I can do on each turn"
          checked={p.guidance}
          onChange={(v) => prefs.set({ guidance: v })}
        />
        <div className="row wrap">
          <button className="btn" onClick={() =>
              announcer.say(
                {
                  text: 'Test: This is the game voice. Seat 3 asks for trump! Trump is Hearts!',
                  voice: '',
                  clips: [{ t: 'testVoice' }, { t: 'asksTrump', v: { who: 's3' } }, { t: 'trumpIs', v: { suit: 'H' } }],
                },
                { interrupt: true, always: true },
              )
            }>
            Test announcement
          </button>
        </div>
      </section>

      <section aria-labelledby="intro-h">
        <h3 id="intro-h">Start sequence</h3>
        <Check label="Play the Trick 304 intro at launch" checked={p.playIntro} onChange={(v) => prefs.set({ playIntro: v })} />
        {!room && (
          <button
            className="btn"
            onClick={() => {
              onClose();
              window.dispatchEvent(new Event('g304:intro'));
            }}
          >
            Play the intro now
          </button>
        )}
      </section>

      <section aria-labelledby="voice-h">
        <h3 id="voice-h">Voice chat</h3>
        <p>
          Status:{' '}
          {
            { off: 'off', connecting: 'connecting…', on: `connected, ${vs.muted ? 'muted' : 'mic live'}`, listenOnly: 'listening only (no microphone)', error: 'error' }[
              vs.status
            ]
          }
          {vs.error ? ` — ${vs.error}` : ''}
        </p>
        <div className="row wrap">
          {vs.status === 'off' ? (
            <button className="btn" onClick={() => voice.join()}>
              Join voice
            </button>
          ) : (
            <button className="btn" onClick={() => voice.leave()}>
              Leave voice
            </button>
          )}
        </div>
        <Check label="Push to talk instead of open microphone (hold Talk or the V key, or activate Talk once to start and again to stop)" checked={p.pushToTalk} onChange={(v) => prefs.set({ pushToTalk: v })} />
        {room && room.you.isHost && (
          <Check label="Allow video chat in this room (host only; each player chooses their own camera)" checked={room.videoEnabled} onChange={(v) => void act('setVideo', { on: v })} />
        )}
        {others.length > 0 && (
          <ul className="list">
            {others.map((m) => (
              <li key={m.memberId}>
                <Slider
                  id={`pv-${m.memberId}`}
                  label={`${m.name} — ${!m.voiceId ? 'not in voice' : ({ direct: 'connected directly', relay: 'connected via server relay', connecting: 'connecting…' } as const)[vs.links.find((l) => l.memberId === m.memberId)?.mode ?? 'connecting']}${m.micMuted ? ', mic off' : ''}`}
                  value={p.playerVolume[m.memberId] ?? 100}
                  onChange={(v) => prefs.set({ playerVolume: { ...p.playerVolume, [m.memberId]: v } })}
                />
                <Check
                  label={`Mute ${m.name}`}
                  checked={!!p.playerMuted[m.memberId]}
                  onChange={(v) => prefs.set({ playerMuted: { ...p.playerMuted, [m.memberId]: v } })}
                />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="disp-h">
        <h3 id="disp-h">Display</h3>
        <fieldset>
          <legend>Theme</legend>
          {(
            [
              ['light', 'Light (default)'],
              ['dark', 'Dark night table'],
              ['high-contrast', 'High contrast: black and white with yellow'],
            ] as const
          ).map(([val, label]) => (
            <label key={val} className="check">
              <input type="radio" name="theme" checked={p.theme === val} onChange={() => prefs.set({ theme: val })} />
              {label}
            </label>
          ))}
        </fieldset>
        <label>
          Text size
          <select className="input" value={p.textScale} onChange={(e) => prefs.set({ textScale: Number(e.target.value) })}>
            <option value={1}>100% (default)</option>
            <option value={1.25}>125%</option>
            <option value={1.5}>150%</option>
            <option value={1.75}>175%</option>
            <option value={2}>200%</option>
          </select>
        </label>
        <label>
          Motion
          <select className="input" value={p.motion} onChange={(e) => prefs.set({ motion: e.target.value as typeof p.motion })}>
            <option value="system">Follow my device setting (default)</option>
            <option value="reduce">Reduce motion: fades only, no moving or looping animation</option>
            <option value="full">Full animation</option>
          </select>
        </label>
        <label>
          Your hand
          <select className="input" value={p.handLayout} onChange={(e) => prefs.set({ handLayout: e.target.value as typeof p.handLayout })}>
            <option value="spread">Spread: rows grouped by suit (default)</option>
            <option value="fan">Fan: one overlapping row</option>
          </select>
        </label>
        <Check label="Show point values on cards" checked={p.showPoints} onChange={(v) => prefs.set({ showPoints: v })} />
        <Check
          label="Four-colour suits (spades black, hearts red, clubs green, diamonds blue)"
          checked={p.suits === 'four'}
          onChange={(v) => prefs.set({ suits: v ? 'four' : 'two' })}
        />
      </section>

      <section aria-labelledby="play-h">
        <h3 id="play-h">Gameplay</h3>
        <Check label="Confirm before playing a card (tap once to select, again to play)" checked={p.confirmPlay} onChange={(v) => prefs.set({ confirmPlay: v })} />
        <Check label="Move focus to my hand when it's my turn" checked={p.focusHandOnTurn} onChange={(v) => prefs.set({ focusHandOnTurn: v })} />
        <Check label="Haptics: vibrate on my turn and key moments (phones)" checked={p.haptics} onChange={(v) => prefs.set({ haptics: v })} />
      </section>
    </Dialog>
  );
}

export function HelpDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Dialog open={open} onClose={onClose} title="How to play Trick 304" wide>
      <TutorialVideo />
      <h3>Keyboard shortcuts</h3>
      <p>Single letters work when focus is not in a text field. With NVDA or JAWS in browse mode, use Alt+Shift plus the letter.</p>
      <ul className="list compact">
        <li>T — table status: cards on the table and who led</li>
        <li>S — score and bid: contract, trump status, scores</li>
        <li>B — open the won-tricks basket</li>
        <li>M — mute or unmute your microphone</li>
        <li>H — jump to your hand</li>
        <li>C — jump to text chat</li>
        <li>I — what now? Hear what you can do right now</li>
        <li>V (hold) — push to talk, when enabled</li>
        <li>? — this help</li>
      </ul>
      <h3>Cards</h3>
      <p>24 cards: J, 9, A, 10, K, Q of each suit. Points: Jack 30, Nine 20, Ace 11, Ten 10, King 3, Queen 2 — 304 in total. Highest to lowest: J, 9, A, 10, K, Q.</p>
      <h3>Bidding</h3>
      <p>
        Starting left of the dealer, bid or pass. Bids start at 160 and go up in tens. 200 is called Jaan, 210 is Jaan 10, 220 is Jaan 20, and so on up to 300
        (Jaan 100); after 300 the only higher bid is 304. Once you pass you are out for the round. If everyone passes, the cards are dealt again. On your turn you
        may instead call Challenge Coat: your side must then win every trick of the round.
      </p>
      <h3>Self Coat</h3>
      <p>
        On your turn in bidding you may call Self Coat, the biggest call. It ends the bidding and only one player can make it in a hand. You play alone: your
        teammates sit out and keep their cards, and only you and the other side play. There is no trump (no hidden trump card, no asking or revealing). You lead
        the first trick, and the highest card of the led suit wins each trick. You must win every trick: made +10 for your side; lose one trick and the round
        stops at once, opponents +20.
      </p>
      <h3>Choosing trump</h3>
      <p>
        The winning bidder places one card as the hidden trump card. Its suit is trump — the whole suit — but only the bidder can see the card. It stays playable:
        the bidder can play it at any time, and playing it does not reveal trump. Trump is revealed only when a player with no card of the led suit asks for it, or
        whenever the bidder chooses to reveal it. The player to the bidder's right (next in turn) leads the first trick.
      </p>
      <h3>Playing</h3>
      <p>
        Follow the led suit if you can. If you can't, play any card, or ask for trump: trump is then revealed to everyone, and you must play a trump if you have
        one. The bidder is never forced to reveal on their own; they may reveal on any of their turns. Until trump is revealed, the trump suit has no power: a trump-suit card played then is an ordinary card and cannot win the trick. Highest trump wins the trick; otherwise the highest card of the led suit.
      </p>
      <h3>Coat</h3>
      <p>
        During play, when your side opens a trick (before any card of it is played), the bidding side may call Coat, but only if your side has won every trick so
        far this round, and never in the last trick. From then on your side must win every remaining trick; losing one stops the round at once.
      </p>
      <h3>Early stops</h3>
      <p>
        Without a Coat, Challenge Coat or Self Coat, the round stops as soon as the bidding side can no longer reach its bid with the tricks left (stopped). When
        the bidding side reaches its bid, the bidder is asked once: "Your team has already reached its bid. Would you like to continue the game?" Stop ends the
        round now (made). Continue plays on, so your side can still call Coat if it has won every trick so far. The round score is shown and spoken after every trick. Trump is the whole trump suit: every card of that suit is trump.
      </p>
      <h3>Cancelled rounds</h3>
      <p>
        A round is cancelled, with no points to anyone, and dealt again with a new shuffle when: right after the deal, one team holds all four Jacks; or, when
        trump is revealed, one team holds no card of the trump suit (any tricks already played are discarded). Everyone is told why.
      </p>
      <h3>Scoring (game points)</h3>
      <ul className="list compact">
        <li>Band 1 bids (160–190): made +1; stopped, opponents +2.</li>
        <li>Band 2 bids (Jaan, 200 up to 304): made +2; stopped, opponents +4.</li>
        <li>Coat: Band 1 made +3, stopped opponents +6. Band 2 made +5, stopped opponents +10.</li>
        <li>Challenge Coat: made +6; stopped, opponents +12. It replaces the bid scoring.</li>
        <li>Self Coat: made +10; stopped, opponents +20. It replaces the bid scoring.</li>
      </ul>
      <p>"Stopped" means the bidding side captured fewer card points than its bid. Players and cards: 2 players 12 cards each, 3 players 8, 4 players 6, 6 players 4, 8 players 3, 12 players 2. Teams sit in alternating seats (4, 6, 8 and 12 players); with 3 players the bidder plays alone against the other two.</p>
    </Dialog>
  );
}
