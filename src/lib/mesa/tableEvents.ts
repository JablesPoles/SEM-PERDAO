export const TABLE_EVENT_SCHEMA = 'a-mesa.event/v1' as const;

export interface TableEvent<TPayload extends Record<string, unknown> = Record<string, unknown>> {
  readonly schema: typeof TABLE_EVENT_SCHEMA;
  readonly id: string;
  readonly roomSessionId: string;
  readonly gameId: string;
  readonly sequence: number;
  readonly kind: string;
  readonly occurredAt: number;
  readonly actorId: string | null;
  readonly targetId: string | null;
  readonly seed: number;
  readonly payload: Readonly<TPayload>;
}

export interface CreateTableEventInput<TPayload extends Record<string, unknown>> {
  id?: string;
  roomSessionId: string;
  gameId: string;
  sequence: number;
  kind: string;
  occurredAt?: number;
  actorId?: string | null;
  targetId?: string | null;
  seed?: number;
  payload?: TPayload;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isSafeId(value: unknown): value is string {
  return typeof value === 'string' && value.length >= 4 && value.length <= 160;
}

function isEventKind(value: unknown): value is string {
  return typeof value === 'string'
    && value.length >= 3
    && value.length <= 80
    && /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)+$/u.test(value);
}

function serializable(value: unknown, depth = 0): boolean {
  if (depth > 6) return false;
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.length <= 64 && value.every((item) => serializable(item, depth + 1));
  if (!isRecord(value) || Object.keys(value).length > 64) return false;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  return Object.entries(value).every(([key, item]) =>
    key.length <= 80 && serializable(item, depth + 1)
  );
}

function immutableSerializableCopy<T>(value: T): T {
  if (Array.isArray(value)) {
    return Object.freeze(value.map((item) => immutableSerializableCopy(item))) as T;
  }
  if (isRecord(value)) {
    return Object.freeze(Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, immutableSerializableCopy(item)])
    )) as T;
  }
  return value;
}

export function seedFromEventId(id: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < id.length; index += 1) {
    hash ^= id.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function randomId(): string {
  const value = globalThis.crypto?.randomUUID?.()
    ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 14)}`;
  return `event-${value}`;
}

export function createTableEvent<TPayload extends Record<string, unknown> = Record<string, never>>(
  input: CreateTableEventInput<TPayload>
): TableEvent<TPayload> {
  const id = input.id ?? randomId();
  if (!isSafeId(id) || !isSafeId(input.roomSessionId) || !isSafeId(input.gameId)) {
    throw new Error('Identidade de evento inválida.');
  }
  if (!isEventKind(input.kind)) throw new Error('Tipo de evento inválido.');
  if (!Number.isSafeInteger(input.sequence) || input.sequence < 0) {
    throw new Error('Sequência de evento inválida.');
  }
  const payload = (input.payload ?? {}) as TPayload;
  if (!serializable(payload)) throw new Error('Payload de evento inválido.');
  const occurredAt = input.occurredAt ?? Date.now();
  if (!Number.isFinite(occurredAt) || occurredAt < 0) throw new Error('Horário de evento inválido.');
  const actorId = input.actorId ?? null;
  const targetId = input.targetId ?? null;
  if (actorId !== null && !isSafeId(actorId)) throw new Error('Ator de evento inválido.');
  if (targetId !== null && !isSafeId(targetId)) throw new Error('Alvo de evento inválido.');
  const seed = Number.isSafeInteger(input.seed) ? Math.abs(input.seed!) >>> 0 : seedFromEventId(id);
  return Object.freeze({
    schema: TABLE_EVENT_SCHEMA,
    id,
    roomSessionId: input.roomSessionId,
    gameId: input.gameId,
    sequence: input.sequence,
    kind: input.kind,
    occurredAt,
    actorId,
    targetId,
    seed,
    payload: immutableSerializableCopy(payload),
  });
}

export function parseTableEvent(value: unknown): TableEvent | null {
  if (!isRecord(value) || value.schema !== TABLE_EVENT_SCHEMA) return null;
  if (!isSafeId(value.id) || !isSafeId(value.roomSessionId) || !isSafeId(value.gameId)) return null;
  if (!isEventKind(value.kind) || !Number.isSafeInteger(value.sequence) || Number(value.sequence) < 0) return null;
  if (typeof value.occurredAt !== 'number' || !Number.isFinite(value.occurredAt) || value.occurredAt < 0) return null;
  if (value.actorId !== null && !isSafeId(value.actorId)) return null;
  if (value.targetId !== null && !isSafeId(value.targetId)) return null;
  if (!Number.isSafeInteger(value.seed) || Number(value.seed) < 0 || Number(value.seed) > 0xffff_ffff) return null;
  if (!isRecord(value.payload) || !serializable(value.payload)) return null;
  return createTableEvent({
    id: value.id,
    roomSessionId: value.roomSessionId,
    gameId: value.gameId,
    sequence: Number(value.sequence),
    kind: value.kind,
    occurredAt: value.occurredAt,
    actorId: value.actorId,
    targetId: value.targetId,
    seed: Number(value.seed),
    payload: value.payload,
  });
}

/** Journal monotônico usado para replay, deduplicação e ferramentas de cena. */
export class TableEventJournal {
  private readonly entries: TableEvent[] = [];
  private readonly ids = new Set<string>();
  private lastSequence = -1;

  constructor(
    readonly roomSessionId: string,
    readonly gameId: string,
    readonly limit = 256
  ) {
    if (!isSafeId(roomSessionId) || !isSafeId(gameId)) throw new Error('Sessão de eventos inválida.');
  }

  accept(value: unknown): value is TableEvent {
    const event = parseTableEvent(value);
    if (
      !event
      || event.roomSessionId !== this.roomSessionId
      || event.gameId !== this.gameId
      || this.ids.has(event.id)
      || event.sequence <= this.lastSequence
    ) return false;
    this.entries.push(event);
    this.ids.add(event.id);
    this.lastSequence = event.sequence;
    while (this.entries.length > Math.max(1, this.limit)) {
      const removed = this.entries.shift();
      if (removed) this.ids.delete(removed.id);
    }
    return true;
  }

  append<TPayload extends Record<string, unknown>>(
    input: Omit<CreateTableEventInput<TPayload>, 'roomSessionId' | 'gameId' | 'sequence'>
  ): TableEvent<TPayload> {
    const event = createTableEvent({
      ...input,
      roomSessionId: this.roomSessionId,
      gameId: this.gameId,
      sequence: this.lastSequence + 1,
    });
    this.accept(event);
    return event;
  }

  replay(): readonly TableEvent[] {
    return this.entries.slice();
  }

  latestSequence(): number {
    return this.lastSequence;
  }
}
