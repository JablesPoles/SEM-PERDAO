import type { CultistAppearance, PlayerAction } from '../types';
import { normalizeCultistAppearance } from '../game';
import { normalizeRoomText } from './rateLimit';
import type { EncryptedMessage } from './secureChannel';
import { isEncryptedMessage, isPublicKey } from './secureChannel';

export const ROOM_SESSION_MAX_AGE_MS = 24 * 60 * 60 * 1000;
export const CHAT_MAX_LENGTH = 200;
export const REACTION_MAX_LENGTH = 80;

export interface SeatCredential {
  playerId: number;
  token: string;
}

export interface SeatLedgerEntry {
  playerId: number;
  tokenHash: string;
  publicKey?: JsonWebKey;
}

export interface HostHello {
  hostId: number;
  hostConnectionId: string;
  publicKey: JsonWebKey;
}

export interface HostChallenge {
  targetHostId: number;
  clientId: string;
  connectionId: string;
  publicKey: JsonWebKey;
  encrypted: EncryptedMessage;
}

export interface HostChallengeClaim {
  nonce: string;
  targetHostId: number;
  authorityEpoch: string;
  hostConnectionId: string;
  clientId: string;
  connectionId: string;
}

export interface HostProof extends HostChallengeClaim {
  hostId: number;
  targetClientId: string;
  targetConnectionId: string;
}

export interface JoinRequest {
  clientId: string;
  connectionId: string;
  name: string;
  appearance: CultistAppearance;
  publicKey: JsonWebKey;
}

export interface ResumeRequest {
  clientId: string;
  connectionId: string;
  publicKey: JsonWebKey;
  encrypted: EncryptedMessage;
}

export interface ResumeProof extends SeatCredential {
  clientId: string;
  connectionId: string;
  authorityEpoch: string;
}

export interface SecureWelcome extends SeatCredential {
  clientId: string;
  connectionId: string;
  authorityEpoch: string;
  hostConnectionId: string;
  privateTopic: string;
  seatLedger: SeatLedgerEntry[];
}

export type SecureClientRequest =
  | { type: 'request_state' }
  | { type: 'action'; action: PlayerAction }
  | { type: 'chat'; text: string }
  | { type: 'reaction'; emoji: string }
  | { type: 'ready'; ready: boolean; lobbySeq: number }
  | { type: 'appearance'; appearance: CultistAppearance }
  | { type: 'leave'; scope: 'lobby' | 'game' };

export interface AuthenticatedRequest {
  requestId: string;
  token: string;
  request: SecureClientRequest;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

export function isRoomId(value: unknown): value is string {
  return typeof value === 'string' && value.length >= 8 && value.length <= 160;
}

export function isPlayerId(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

export function createRoomId(prefix: string): string {
  const safePrefix = prefix.replace(/[^a-z0-9-]/gi, '').slice(0, 24) || 'room';
  const random = globalThis.crypto?.randomUUID?.()
    ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 14)}`;
  return `${safePrefix}-${random}`;
}

export function createSeatToken(cryptoApi: Crypto = globalThis.crypto): string {
  if (!cryptoApi?.getRandomValues) throw new Error('Gerador seguro indisponível.');
  const bytes = cryptoApi.getRandomValues(new Uint8Array(32));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
}

export async function hashSeatToken(
  token: string,
  cryptoApi: Crypto = globalThis.crypto
): Promise<string> {
  if (!isRoomId(token) || !cryptoApi?.subtle) throw new Error('Credencial inválida.');
  const digest = await cryptoApi.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function normalizeSeatLedger(value: unknown): SeatLedgerEntry[] {
  if (!Array.isArray(value)) return [];
  const result = new Map<number, SeatLedgerEntry>();
  for (const candidate of value) {
    if (!isRecord(candidate) || !isPlayerId(candidate.playerId)) continue;
    if (typeof candidate.tokenHash !== 'string' || !/^[a-f0-9]{64}$/u.test(candidate.tokenHash)) continue;
    result.set(candidate.playerId, {
      playerId: candidate.playerId,
      tokenHash: candidate.tokenHash,
      ...(isPublicKey(candidate.publicKey) ? { publicKey: candidate.publicKey } : {}),
    });
  }
  return [...result.values()];
}

export function parseSeatCredential(value: unknown): SeatCredential | null {
  if (!isRecord(value) || !isPlayerId(value.playerId) || !isRoomId(value.token)) return null;
  return { playerId: value.playerId, token: value.token };
}

export function parseHostHello(value: unknown): HostHello | null {
  if (!isRecord(value) || !isPlayerId(value.hostId) || !isRoomId(value.hostConnectionId)) return null;
  if (!isPublicKey(value.publicKey)) return null;
  return {
    hostId: value.hostId,
    hostConnectionId: value.hostConnectionId,
    publicKey: value.publicKey,
  };
}

export function parseHostChallenge(value: unknown): HostChallenge | null {
  if (
    !isRecord(value)
    || !isPlayerId(value.targetHostId)
    || !isRoomId(value.clientId)
    || !isRoomId(value.connectionId)
    || !isPublicKey(value.publicKey)
    || !isEncryptedMessage(value.encrypted)
  ) return null;
  return {
    targetHostId: value.targetHostId,
    clientId: value.clientId,
    connectionId: value.connectionId,
    publicKey: value.publicKey,
    encrypted: value.encrypted,
  };
}

export function parseHostChallengeClaim(value: unknown): HostChallengeClaim | null {
  if (
    !isRecord(value)
    || !isRoomId(value.nonce)
    || !isPlayerId(value.targetHostId)
    || !isRoomId(value.authorityEpoch)
    || !isRoomId(value.hostConnectionId)
    || !isRoomId(value.clientId)
    || !isRoomId(value.connectionId)
  ) return null;
  return {
    nonce: value.nonce,
    targetHostId: value.targetHostId,
    authorityEpoch: value.authorityEpoch,
    hostConnectionId: value.hostConnectionId,
    clientId: value.clientId,
    connectionId: value.connectionId,
  };
}

export function parseHostProof(value: unknown): HostProof | null {
  const challenge = parseHostChallengeClaim(value);
  if (
    !challenge
    || !isRecord(value)
    || !isPlayerId(value.hostId)
    || !isRoomId(value.targetClientId)
    || !isRoomId(value.targetConnectionId)
  ) return null;
  return {
    ...challenge,
    hostId: value.hostId,
    targetClientId: value.targetClientId,
    targetConnectionId: value.targetConnectionId,
  };
}

export function parseJoinRequest(value: unknown): JoinRequest | null {
  if (!isRecord(value) || !isRoomId(value.clientId) || !isRoomId(value.connectionId)) return null;
  if (!isPublicKey(value.publicKey)) return null;
  const name = normalizeRoomText(value.name, 28);
  if (!name) return null;
  return {
    clientId: value.clientId,
    connectionId: value.connectionId,
    name,
    appearance: normalizeCultistAppearance(value.appearance),
    publicKey: value.publicKey,
  };
}

export function parseResumeRequest(value: unknown): ResumeRequest | null {
  if (!isRecord(value) || !isRoomId(value.clientId) || !isRoomId(value.connectionId)) return null;
  if (!isPublicKey(value.publicKey) || !isEncryptedMessage(value.encrypted)) return null;
  return {
    clientId: value.clientId,
    connectionId: value.connectionId,
    publicKey: value.publicKey,
    encrypted: value.encrypted,
  };
}

export function parseResumeProof(value: unknown): ResumeProof | null {
  const credential = parseSeatCredential(value);
  if (!credential || !isRecord(value) || !isRoomId(value.clientId)) return null;
  if (!isRoomId(value.connectionId) || !isRoomId(value.authorityEpoch)) return null;
  return { ...credential, clientId: value.clientId, connectionId: value.connectionId, authorityEpoch: value.authorityEpoch };
}

export function parseSecureWelcome(value: unknown): SecureWelcome | null {
  const proof = parseResumeProof(value);
  if (!proof || !isRecord(value) || !isRoomId(value.hostConnectionId) || !isRoomId(value.privateTopic)) {
    return null;
  }
  const seatLedger = normalizeSeatLedger(value.seatLedger);
  if (!seatLedger.some((entry) => entry.playerId === proof.playerId)) return null;
  return {
    ...proof,
    hostConnectionId: value.hostConnectionId,
    privateTopic: value.privateTopic,
    seatLedger,
  };
}

/** Confere uma credencial sem jamais guardar ou transmitir o segredo em claro. */
export async function verifySeatToken(
  playerId: number,
  token: string,
  ledger: readonly SeatLedgerEntry[],
  cryptoApi: Crypto = globalThis.crypto
): Promise<boolean> {
  if (!isPlayerId(playerId) || !isRoomId(token)) return false;
  const expected = ledger.find((entry) => entry.playerId === playerId)?.tokenHash;
  if (!expected || !/^[a-f0-9]{64}$/u.test(expected)) return false;
  try {
    const received = await hashSeatToken(token, cryptoApi);
    let difference = expected.length ^ received.length;
    for (let index = 0; index < expected.length; index += 1) {
      difference |= expected.charCodeAt(index) ^ (received.charCodeAt(index) || 0);
    }
    return difference === 0;
  } catch {
    return false;
  }
}

export function parsePlayerAction(value: unknown): PlayerAction | null {
  if (!isRecord(value) || typeof value.type !== 'string') return null;
  const phaseId = value.phaseId === undefined
    ? undefined
    : isRoomId(value.phaseId) ? value.phaseId : null;
  if (phaseId === null) return null;

  if (value.type === 'submit') {
    if (!Array.isArray(value.cardIds) || value.cardIds.length < 1 || value.cardIds.length > 3) return null;
    if (!value.cardIds.every((id) => typeof id === 'string' && id.length >= 1 && id.length <= 160)) return null;
    if (new Set(value.cardIds).size !== value.cardIds.length) return null;
    return { type: 'submit', cardIds: value.cardIds, phaseId };
  }
  if (value.type === 'reveal' || value.type === 'judge') {
    if (!Number.isSafeInteger(value.index) || Number(value.index) < 0 || Number(value.index) > 7) return null;
    return { type: value.type, index: Number(value.index), phaseId };
  }
  if (value.type === 'vote') {
    if (!Number.isSafeInteger(value.index) || Number(value.index) < 0 || Number(value.index) > 7) return null;
    if (typeof value.phaseStartedAt !== 'number' || !Number.isFinite(value.phaseStartedAt)) return null;
    return { type: 'vote', index: Number(value.index), phaseStartedAt: value.phaseStartedAt, phaseId };
  }
  if (value.type === 'next_round') return { type: 'next_round', phaseId };
  return null;
}

export function normalizeReaction(value: unknown): string | null {
  const emoji = normalizeRoomText(value, REACTION_MAX_LENGTH);
  if (!emoji) return null;
  if (/^throw:(tomate|sapato|rosa):\d{1,6}$/u.test(emoji)) return emoji;
  // Reações normais são apenas um pequeno agrupamento de emoji, nunca HTML ou texto livre.
  if (/^[\p{Extended_Pictographic}\p{Emoji_Component}\uFE0F\u200D]{1,12}$/u.test(emoji)) return emoji;
  return null;
}

export function parseAuthenticatedRequest(value: unknown): AuthenticatedRequest | null {
  if (!isRecord(value) || !isRoomId(value.requestId) || !isRoomId(value.token)) return null;
  if (!isRecord(value.request) || typeof value.request.type !== 'string') return null;
  const request = value.request;
  let parsed: SecureClientRequest | null = null;

  if (request.type === 'request_state') parsed = { type: 'request_state' };
  if (request.type === 'action') {
    const action = parsePlayerAction(request.action);
    if (action) parsed = { type: 'action', action };
  }
  if (request.type === 'chat') {
    const chat = normalizeRoomText(request.text, CHAT_MAX_LENGTH);
    if (chat) parsed = { type: 'chat', text: chat };
  }
  if (request.type === 'reaction') {
    const emoji = normalizeReaction(request.emoji);
    if (emoji) parsed = { type: 'reaction', emoji };
  }
  if (request.type === 'ready' && typeof request.ready === 'boolean' && Number.isSafeInteger(request.lobbySeq)) {
    parsed = { type: 'ready', ready: request.ready, lobbySeq: Number(request.lobbySeq) };
  }
  if (request.type === 'appearance') {
    parsed = { type: 'appearance', appearance: normalizeCultistAppearance(request.appearance) };
  }
  if (request.type === 'leave' && (request.scope === 'lobby' || request.scope === 'game')) {
    parsed = { type: 'leave', scope: request.scope };
  }
  return parsed ? { requestId: value.requestId, token: value.token, request: parsed } : null;
}
