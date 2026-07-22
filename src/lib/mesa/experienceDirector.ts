import type { TableEvent } from './tableEvents';

export const EXPERIENCE_CHANNELS = ['camera', 'actor', 'vfx', 'audio', 'hud'] as const;
export type ExperienceChannel = (typeof EXPERIENCE_CHANNELS)[number];
export type ExperienceInterrupt = 'none' | 'channel' | 'all';

export interface ExperienceBeatSpec {
  channel: ExperienceChannel;
  cue: string;
  actor?: 'actor' | 'target' | string | null;
  delayMs?: number;
  durationMs?: number | null;
  priority?: number;
  interrupt?: ExperienceInterrupt;
  payload?: Record<string, unknown>;
}

export interface DirectedExperienceBeat extends Required<
  Omit<ExperienceBeatSpec, 'actor' | 'payload' | 'durationMs'>
> {
  id: string;
  eventId: string;
  actorId: string | null;
  durationMs: number | null;
  payload: Readonly<Record<string, unknown>>;
}

export interface ExperienceRule {
  id: string;
  event: string;
  when?: (event: TableEvent) => boolean;
  beats: readonly ExperienceBeatSpec[] | ((event: TableEvent) => readonly ExperienceBeatSpec[]);
}

function eventMatches(pattern: string, kind: string): boolean {
  return pattern.endsWith('.*') ? kind.startsWith(pattern.slice(0, -1)) : pattern === kind;
}

function safeNumber(value: number | null | undefined, fallback: number, maximum: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.min(maximum, Math.round(value)))
    : fallback;
}

function resolveActor(spec: ExperienceBeatSpec['actor'], event: TableEvent): string | null {
  if (spec === 'actor') return event.actorId;
  if (spec === 'target') return event.targetId;
  return typeof spec === 'string' && spec.length >= 4 ? spec : null;
}

/**
 * Compila eventos de jogo em beats audiovisuais. Não toca Three.js, DOM,
 * WebAudio nem regra de jogo; consumidores executam cada canal como quiserem.
 */
export class ExperienceDirector {
  private readonly rules: ExperienceRule[];

  constructor(rules: readonly ExperienceRule[]) {
    const ids = new Set<string>();
    this.rules = rules.filter((rule) => {
      if (!rule.id || ids.has(rule.id) || !rule.event) return false;
      ids.add(rule.id);
      return true;
    });
  }

  plan(event: TableEvent): readonly DirectedExperienceBeat[] {
    const planned: DirectedExperienceBeat[] = [];
    for (const rule of this.rules) {
      if (!eventMatches(rule.event, event.kind) || (rule.when && !rule.when(event))) continue;
      const specs = typeof rule.beats === 'function' ? rule.beats(event) : rule.beats;
      specs.forEach((spec, index) => {
        if (!EXPERIENCE_CHANNELS.includes(spec.channel) || !spec.cue || spec.cue.length > 100) return;
        planned.push(Object.freeze({
          id: `${event.id}:${rule.id}:${index}`,
          eventId: event.id,
          channel: spec.channel,
          cue: spec.cue,
          actorId: resolveActor(spec.actor, event),
          delayMs: safeNumber(spec.delayMs, 0, 60_000),
          durationMs: spec.durationMs === null
            ? null
            : safeNumber(spec.durationMs, 0, 120_000),
          priority: safeNumber(spec.priority, 0, 100),
          interrupt: spec.interrupt ?? 'none',
          payload: Object.freeze({ ...(spec.payload ?? {}) }),
        }));
      });
    }
    return Object.freeze(planned.sort((left, right) =>
      left.delayMs - right.delayMs
      || right.priority - left.priority
      || left.id.localeCompare(right.id)
    ));
  }
}
