/**
 * Envelope neutro do motor de sala. O conteúdo continua pertencendo ao jogo;
 * esta camada só ordena, identifica e rejeita tráfego de outra sala/autoridade.
 */
export const ROOM_PROTOCOL_VERSION = 2 as const;

export interface RoomEnvelope<T = unknown> {
  protocol: typeof ROOM_PROTOCOL_VERSION;
  roomCode: string;
  gameId: string | null;
  authorityEpoch: string;
  hostId: number;
  senderId: number;
  senderConnectionId: string;
  revision: number;
  sentAt: number;
  kind: string;
  payload: T;
}

export interface RoomEnvelopeMeta {
  roomCode: string;
  gameId?: string | null;
  authorityEpoch: string;
  hostId: number;
  senderId: number;
  senderConnectionId: string;
  revision?: number;
  sentAt?: number;
}

export interface RoomEnvelopeExpectation {
  roomCode: string;
  authorityEpoch?: string;
  hostId?: number;
  senderId?: number;
  senderConnectionId?: string;
  kinds?: readonly string[];
}

export interface SnapshotCursor {
  gameId: string;
  authorityEpoch: string;
  revision: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function validId(value: unknown): value is string {
  return typeof value === 'string' && value.length >= 8 && value.length <= 160;
}

function validPlayerId(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

/** Cria um envelope serializável e monotônico sem carregar regra de jogo. */
export function createRoomEnvelope<T>(
  kind: string,
  payload: T,
  meta: RoomEnvelopeMeta
): RoomEnvelope<T> {
  if (!kind || kind.length > 64) throw new Error('Tipo de mensagem de sala inválido.');
  if (!/^[A-Z0-9]{4,12}$/i.test(meta.roomCode)) throw new Error('Código de sala inválido.');
  if (!validId(meta.authorityEpoch)) throw new Error('Época de autoridade inválida.');
  if (!validId(meta.senderConnectionId)) throw new Error('Conexão de origem inválida.');
  if (!validPlayerId(meta.hostId) || !validPlayerId(meta.senderId)) {
    throw new Error('Identidade de sala inválida.');
  }

  return {
    protocol: ROOM_PROTOCOL_VERSION,
    roomCode: meta.roomCode.toUpperCase(),
    gameId: meta.gameId ?? null,
    authorityEpoch: meta.authorityEpoch,
    hostId: meta.hostId,
    senderId: meta.senderId,
    senderConnectionId: meta.senderConnectionId,
    revision: Math.max(0, Math.floor(meta.revision ?? 0)),
    sentAt: meta.sentAt ?? Date.now(),
    kind,
    payload,
  };
}

/**
 * Faz a validação estrutural antes de qualquer cast. Campos adicionais são
 * tolerados para permitir evolução compatível do protocolo.
 */
export function parseRoomEnvelope<T = unknown>(
  value: unknown,
  expected: RoomEnvelopeExpectation
): RoomEnvelope<T> | null {
  if (!isRecord(value) || value.protocol !== ROOM_PROTOCOL_VERSION) return null;
  if (typeof value.roomCode !== 'string' || value.roomCode.toUpperCase() !== expected.roomCode.toUpperCase()) {
    return null;
  }
  if (typeof value.kind !== 'string' || !value.kind || value.kind.length > 64) return null;
  if (expected.kinds && !expected.kinds.includes(value.kind)) return null;
  if (!validId(value.authorityEpoch) || !validId(value.senderConnectionId)) return null;
  if (!validPlayerId(value.hostId) || !validPlayerId(value.senderId)) return null;
  if (!Number.isSafeInteger(value.revision) || Number(value.revision) < 0) return null;
  if (typeof value.sentAt !== 'number' || !Number.isFinite(value.sentAt)) return null;
  if (value.gameId !== null && !validId(value.gameId)) return null;
  if (expected.authorityEpoch !== undefined && value.authorityEpoch !== expected.authorityEpoch) return null;
  if (expected.hostId !== undefined && value.hostId !== expected.hostId) return null;
  if (expected.senderId !== undefined && value.senderId !== expected.senderId) return null;
  if (
    expected.senderConnectionId !== undefined &&
    value.senderConnectionId !== expected.senderConnectionId
  ) return null;

  return value as unknown as RoomEnvelope<T>;
}

export function cursorFromEnvelope(envelope: RoomEnvelope): SnapshotCursor | null {
  if (!envelope.gameId) return null;
  return {
    gameId: envelope.gameId,
    authorityEpoch: envelope.authorityEpoch,
    revision: envelope.revision,
  };
}

/** Nova autoridade ou nova partida reiniciam a sequência; dentro delas, só avança. */
export function shouldAcceptSnapshot(
  current: SnapshotCursor | null,
  incoming: SnapshotCursor
): boolean {
  if (!current) return true;
  if (incoming.authorityEpoch !== current.authorityEpoch) return true;
  if (incoming.gameId !== current.gameId) return true;
  return incoming.revision >= current.revision;
}
