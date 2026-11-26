import type { GameEvent, PlayerCount } from './types';
import type { PlayerView } from './view';

export interface RoomSettings {
  numPlayers: PlayerCount;
  matchTarget: number;
  fourCardMode: boolean;
  firstLead: 'dealerLeft' | 'bidderLeft';
  /** Seconds per turn; 0 = relaxed (no timer). */
  turnTimer: number;
  /** How quickly bots act, so announcements can keep up. */
  botSpeed: 'relaxed' | 'normal' | 'fast';
}

export const DEFAULT_SETTINGS: RoomSettings = {
  numPlayers: 4,
  matchTarget: 21,
  fourCardMode: false,
  firstLead: 'dealerLeft',
  turnTimer: 0,
  botSpeed: 'normal',
};

export const BOT_DELAY_MS: Record<RoomSettings['botSpeed'], number> = { relaxed: 2600, normal: 1500, fast: 700 };

export interface SeatInfo {
  seat: number;
  kind: 'empty' | 'human' | 'bot';
  name: string;
  /** Public member id (never the secret reconnect token). */
  memberId: string | null;
  connected: boolean;
  micMuted: boolean;
  isHost: boolean;
}

export interface MemberInfo {
  memberId: string;
  name: string;
  seat: number | null;
  connected: boolean;
  micMuted: boolean;
  /** Socket id used as the WebRTC peer id, when in voice. */
  voiceId: string | null;
  /** Camera on (only meaningful while the host has video enabled). */
  cameraOn: boolean;
  wantsSeat: boolean;
}

export interface RoomSnapshot {
  code: string;
  isPublic: boolean;
  status: 'lobby' | 'playing';
  settings: RoomSettings;
  seats: SeatInfo[];
  members: MemberInfo[];
  you: { memberId: string; seat: number | null; isHost: boolean; name: string };
  view: PlayerView | null;
  /** Seats that pressed "Ready" for the next round. */
  ready: number[];
  /** Epoch ms when the current turn auto-plays, if a timer applies. */
  turnDeadline: number | null;
  /** Video chat: available by default (host can switch it off). Each player's camera starts off. */
  videoEnabled: boolean;
  /** Text chat: on from the start; the host can switch it off. */
  chatEnabled: boolean;
  /** Recent chat messages (oldest first). */
  chat: ChatMessage[];
}

export interface ChatMessage {
  id: number;
  memberId: string;
  name: string;
  /** Message text, or the emoji for a quick reaction. */
  text: string;
  time: number;
  /** 'reaction' = a quick emoji reaction sent to the whole table. */
  kind?: 'text' | 'reaction';
  /** Seat of the sender at the time (for showing reactions at the table). */
  seat?: number | null;
  /** Emoji reactions on this message: emoji → member ids. */
  reactions?: Record<string, string[]>;
}

/** Emoji players can react with, and the words a screen reader / game voice uses for each. */
export const REACTIONS: Record<string, string> = {
  '👍': 'thumbs up',
  '👏': 'clapping hands',
  '😂': 'laughing',
  '😮': 'surprised',
  '🔥': 'fire',
  '❤️': 'heart',
  '😢': 'sad',
  '🎉': 'party',
  '🙏': 'thank you',
  '😎': 'cool',
};

export interface RoomUpdate {
  room: RoomSnapshot;
  /** New game events visible to this player (already privacy filtered). */
  events: GameEvent[];
  /** Human-readable room notices (joins, leaves, timeouts). */
  notices: string[];
}

export interface PublicRoomInfo {
  code: string;
  hostName: string;
  numPlayers: number;
  humans: number;
  openSeats: number;
}

export type Ack<T = unknown> = (res: { ok: true; data?: T } | { ok: false; error: string }) => void;
