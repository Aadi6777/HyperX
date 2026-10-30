/**
 * Signaling "rooms". Two browsers can only find each other if they join the SAME room.
 *
 * Previously the room was the logged-in user's first workspace id, which meant (a) nobody could
 * connect without signing in, and (b) two different accounts landed in two different rooms and
 * never saw each other. Now the room is a short code kept in the URL (#room=K7M2QX9P) that you
 * share as an invite link. Picking a workspace in the workspace bar still switches the room to
 * that workspace, so team rooms keep working.
 */

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I to avoid typos
const CODE_LENGTH = 8;

export function generateRoomCode(): string {
  const bytes = new Uint8Array(CODE_LENGTH);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < CODE_LENGTH; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join('');
}

/** Accepts a bare code or a full invite link and returns a clean room id ('' if unusable). */
export function parseRoomInput(raw: string): string {
  const s = raw.trim();
  const fromLink = s.match(/[#?&]room=([A-Za-z0-9_-]+)/);
  const candidate = (fromLink ? fromLink[1] : s).replace(/[^A-Za-z0-9_-]/g, '');
  // Short alphanumeric codes are case-insensitive for humans; workspace UUIDs are left untouched.
  return /^[A-Za-z0-9]{4,12}$/.test(candidate) ? candidate.toUpperCase() : candidate;
}

export function getRoomFromHash(): string {
  const m = window.location.hash.match(/room=([A-Za-z0-9_-]+)/);
  return m ? m[1] : '';
}

export function writeRoomToHash(roomId: string) {
  window.history.replaceState(null, '', `#room=${roomId}`);
}

/** Room from the URL if present, otherwise a fresh one (written back to the URL). */
export function initialRoom(): string {
  let room = getRoomFromHash();
  if (!room) {
    room = generateRoomCode();
    writeRoomToHash(room);
  }
  return room;
}

export function buildInviteLink(roomId: string): string {
  return `${window.location.origin}${window.location.pathname}#room=${roomId}`;
}
