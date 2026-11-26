import { useEffect, useRef } from 'react';
import type { RoomSnapshot } from '@g304/engine';
import { useVoice, voice } from '../voice';

function Tile({ stream, label, mirror }: { stream: MediaStream; label: string; mirror?: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (ref.current && ref.current.srcObject !== stream) ref.current.srcObject = stream;
  }, [stream]);
  return (
    <figure className="video-tile">
      {/* Audio is played separately by the voice channel, so the video element stays muted. */}
      <video ref={ref} autoPlay playsInline muted aria-label={label} className={mirror ? 'mirror' : undefined} />
      <figcaption>{label}</figcaption>
    </figure>
  );
}

/**
 * Video chat. Rendered only while the host has video enabled; until then no camera
 * permission is requested and no video UI is shown. Each player chooses their own camera.
 */
export function VideoPanel({ room }: { room: RoomSnapshot }) {
  const vs = useVoice();
  if (!room.videoEnabled) return null;
  const others = room.members.filter((m) => m.memberId !== room.you.memberId && m.cameraOn);
  return (
    <section className="panel video" aria-labelledby="video-h">
      <div className="row spread">
        <h2 id="video-h">Video chat</h2>
        <button className={`btn ${vs.cameraOn ? 'on' : ''}`} aria-pressed={vs.cameraOn} onClick={() => voice.setCamera(!vs.cameraOn)}>
          {vs.cameraOn ? 'My camera: on' : 'My camera: off'}
        </button>
      </div>
      {vs.cameraError && (
        <p role="alert" className="error">
          {vs.cameraError}
        </p>
      )}
      {others.length === 0 && !vs.cameraOn && <p className="muted small">Nobody has a camera on yet. Turn yours on whenever you like — voice chat works without it.</p>}
      <div className="video-grid">
        {vs.localVideo && <Tile stream={vs.localVideo} label="Your camera" mirror />}
        {others.map((m) => {
          const v = vs.videos.find((x) => x.memberId === m.memberId);
          return v ? (
            <Tile key={m.memberId} stream={v.stream} label={`${m.name}'s camera`} />
          ) : (
            <p key={m.memberId} className="hint">
              {m.name}'s camera is on, connecting…
            </p>
          );
        })}
      </div>
    </section>
  );
}
