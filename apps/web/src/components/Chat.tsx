import { FormEvent, KeyboardEvent, useEffect, useRef, useState } from 'react';
import { REACTIONS } from '@g304/engine';
import type { ChatMessage, RoomSnapshot } from '@g304/engine';
import { act } from './ui';

const EMOJI = Object.keys(REACTIONS);

/** One-tap emoji reactions to the whole table. Each button has a spoken name. */
export function ReactBar({ compact }: { compact?: boolean }) {
  return (
    <div className={`react-bar${compact ? ' compact' : ''}`} role="group" aria-label="Quick reactions">
      {EMOJI.map((e) => (
        <button key={e} type="button" className="react-btn" onClick={() => act('react', { emoji: e })} aria-label={`React: ${REACTIONS[e]}`} title={REACTIONS[e]}>
          <span aria-hidden="true">{e}</span>
        </button>
      ))}
    </div>
  );
}

/**
 * Text chat — on from the start, no switch to flip. New messages and reactions are read out
 * after game announcements (never interrupting); the list can be read back at any time.
 * Works with voice dictation.
 */
export function ChatPanel({ room }: { room: RoomSnapshot }) {
  const [text, setText] = useState('');
  const [picker, setPicker] = useState<number | null>(null);
  const listRef = useRef<HTMLOListElement>(null);
  const me = room.you.memberId;

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [room.chat.length]);

  const send = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!text.trim()) return;
    const r = await act('chat', { text });
    if (r.ok) setText('');
  };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  };
  const who = (m: ChatMessage) => (m.memberId === me ? 'You' : m.name);

  return (
    <section className="panel chat" aria-labelledby="chat-h" id="chat">
      <div className="row spread">
        <h2 id="chat-h">Chat</h2>
        {room.you.isHost && (
          <button className="btn text sm" onClick={() => act('setChat', { on: !room.chatEnabled })}>
            {room.chatEnabled ? 'Turn chat off for everyone' : 'Turn chat back on'}
          </button>
        )}
      </div>
      <ReactBar />
      {room.chat.length === 0 ? (
        <p className="muted small">No messages yet. Say hello, or send a reaction.</p>
      ) : (
        <ol ref={listRef} className="chat-list" aria-label={`Messages, ${room.chat.length}`} tabIndex={0}>
          {room.chat.map((m) =>
            m.kind === 'reaction' ? (
              <li key={m.id} className="msg reaction-line">
                <span className="msg-who">{who(m)}</span> reacted <span className="big-emoji" aria-hidden="true">{m.text}</span>
                <span className="sr-only">{REACTIONS[m.text] ?? m.text}</span>
              </li>
            ) : (
              <li key={m.id} className={`msg${m.memberId === me ? ' mine' : ''}`}>
                <div className="msg-head">
                  <span className="msg-who">{who(m)}</span>
                  <span className="msg-time">{new Date(m.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                </div>
                <p className="msg-text">{m.text}</p>
                <div className="msg-reacts">
                  {Object.entries(m.reactions ?? {}).map(([e, ids]) => {
                    const mine = ids.includes(me);
                    return (
                      <button
                        key={e}
                        type="button"
                        className={`chip${mine ? ' on' : ''}`}
                        aria-pressed={mine}
                        onClick={() => act('reactMessage', { id: m.id, emoji: e })}
                        aria-label={`${REACTIONS[e]}, ${ids.length}. ${mine ? 'Remove your reaction' : 'Add yours'}`}
                      >
                        <span aria-hidden="true">
                          {e} {ids.length}
                        </span>
                      </button>
                    );
                  })}
                  <button
                    type="button"
                    className="chip add"
                    aria-expanded={picker === m.id}
                    onClick={() => setPicker(picker === m.id ? null : m.id)}
                    aria-label={`React to ${who(m)}'s message`}
                  >
                    <span aria-hidden="true">☺+</span>
                  </button>
                </div>
                {picker === m.id && (
                  <div className="react-bar compact" role="group" aria-label={`Reactions for ${who(m)}'s message`}>
                    {EMOJI.map((e) => (
                      <button
                        key={e}
                        type="button"
                        className="react-btn"
                        onClick={() => {
                          void act('reactMessage', { id: m.id, emoji: e });
                          setPicker(null);
                        }}
                        aria-label={REACTIONS[e]}
                      >
                        <span aria-hidden="true">{e}</span>
                      </button>
                    ))}
                  </div>
                )}
              </li>
            ),
          )}
        </ol>
      )}
      {room.chatEnabled ? (
        <form className="chat-form" onSubmit={send}>
          <label htmlFor="chat-input" className="sr-only">
            Message
          </label>
          <textarea
            id="chat-input"
            className="input"
            rows={1}
            maxLength={300}
            value={text}
            placeholder="Message the table…"
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKey}
            aria-describedby="chat-hint"
          />
          <button className="btn primary" type="submit">
            Send
          </button>
          <span id="chat-hint" className="sr-only">
            Enter sends. Shift and Enter adds a new line.
          </span>
        </form>
      ) : (
        <p className="muted small">The host has turned text chat off. Reactions still work.</p>
      )}
    </section>
  );
}
