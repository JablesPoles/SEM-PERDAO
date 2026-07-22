export type ReactionComboKind = 'chorus' | 'riot';

export interface ReactionComboSignal {
  id: string;
  emoji: string;
  participantId: string | number;
  timestamp: number;
}

export interface ReactionCombo {
  id: string;
  kind: ReactionComboKind;
  emoji: string;
  count: number;
  participants: number;
  startedAt: number;
  endedAt: number;
}

export interface ReactionComboOptions {
  windowMs?: number;
  cooldownMs?: number;
  chorusParticipants?: number;
  riotSignals?: number;
  riotParticipants?: number;
}

const THROW_REACTION = /^throw:/u;

/**
 * Agrega reações já aceitas pelo host em momentos coletivos reproduzíveis.
 * O relógio vem do próprio evento, portanto todos os clientes que recebem a
 * mesma sequência chegam ao mesmo combo sem uma nova mensagem de rede.
 */
export class ReactionComboTracker {
  private readonly windowMs: number;
  private readonly cooldownMs: number;
  private readonly chorusParticipants: number;
  private readonly riotSignals: number;
  private readonly riotParticipants: number;
  private readonly recent: ReactionComboSignal[] = [];
  private readonly seen = new Set<string>();
  private readonly seenOrder: string[] = [];
  private blockedUntil = Number.NEGATIVE_INFINITY;

  constructor(options: ReactionComboOptions = {}) {
    this.windowMs = Math.max(500, options.windowMs ?? 2_600);
    this.cooldownMs = Math.max(this.windowMs, options.cooldownMs ?? 3_600);
    this.chorusParticipants = Math.max(2, options.chorusParticipants ?? 3);
    this.riotSignals = Math.max(3, options.riotSignals ?? 6);
    this.riotParticipants = Math.max(2, options.riotParticipants ?? 3);
  }

  push(signal: ReactionComboSignal): ReactionCombo | null {
    if (!this.accepts(signal)) return null;
    this.seen.add(signal.id);
    this.seenOrder.push(signal.id);
    if (this.seenOrder.length > 512) this.seen.delete(this.seenOrder.shift()!);
    if (THROW_REACTION.test(signal.emoji)) return null;

    const oldest = signal.timestamp - this.windowMs;
    while (this.recent.length && this.recent[0].timestamp < oldest) this.recent.shift();
    this.recent.push(Object.freeze({ ...signal }));
    if (signal.timestamp < this.blockedUntil) return null;

    const byEmoji = new Map<string, ReactionComboSignal[]>();
    for (const entry of this.recent) {
      const entries = byEmoji.get(entry.emoji) ?? [];
      entries.push(entry);
      byEmoji.set(entry.emoji, entries);
    }

    const chorus = [...byEmoji.entries()]
      .map(([emoji, entries]) => ({ emoji, entries, participants: distinctParticipants(entries) }))
      .filter((candidate) => candidate.participants >= this.chorusParticipants)
      .sort((a, b) => b.participants - a.participants || a.emoji.localeCompare(b.emoji))[0];
    if (chorus) return this.finish('chorus', chorus.emoji, chorus.entries);

    const riotParticipants = distinctParticipants(this.recent);
    const riotEmojis = new Set(this.recent.map((entry) => entry.emoji)).size;
    if (
      this.recent.length >= this.riotSignals
      && riotParticipants >= this.riotParticipants
      && riotEmojis >= 3
    ) {
      return this.finish('riot', '🔥', this.recent);
    }
    return null;
  }

  reset(): void {
    this.recent.length = 0;
    this.seen.clear();
    this.seenOrder.length = 0;
    this.blockedUntil = Number.NEGATIVE_INFINITY;
  }

  private accepts(signal: ReactionComboSignal): boolean {
    return Boolean(
      signal
      && typeof signal.id === 'string'
      && signal.id.length > 0
      && !this.seen.has(signal.id)
      && typeof signal.emoji === 'string'
      && signal.emoji.length > 0
      && signal.emoji.length <= 32
      && (typeof signal.participantId === 'string' || Number.isFinite(signal.participantId))
      && Number.isFinite(signal.timestamp)
    );
  }

  private finish(
    kind: ReactionComboKind,
    emoji: string,
    entries: readonly ReactionComboSignal[]
  ): ReactionCombo {
    const first = entries[0];
    const last = entries.at(-1)!;
    this.blockedUntil = last.timestamp + this.cooldownMs;
    return Object.freeze({
      id: `${kind}:${first.id}:${last.id}`,
      kind,
      emoji,
      count: entries.length,
      participants: distinctParticipants(entries),
      startedAt: first.timestamp,
      endedAt: last.timestamp,
    });
  }
}

function distinctParticipants(entries: readonly ReactionComboSignal[]): number {
  return new Set(entries.map((entry) => String(entry.participantId))).size;
}
