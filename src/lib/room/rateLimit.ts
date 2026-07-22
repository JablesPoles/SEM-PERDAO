export interface RateLimitResult {
  ok: boolean;
  retryAfterMs: number;
}

export interface RateLimitOptions {
  limit: number;
  windowMs: number;
  cooldownMs: number;
}

interface Activity {
  sentAt: number[];
  blockedUntil: number;
}

/** Guarda por identidade, independente de React e do transporte escolhido. */
export function createRateGuard(options: RateLimitOptions) {
  const activityByActor = new Map<string | number, Activity>();

  return {
    accept(actorId: string | number, now = Date.now()): RateLimitResult {
      const activity = activityByActor.get(actorId) ?? { sentAt: [], blockedUntil: 0 };
      if (activity.blockedUntil > now) {
        return { ok: false, retryAfterMs: activity.blockedUntil - now };
      }

      activity.sentAt = activity.sentAt.filter((sentAt) => now - sentAt < options.windowMs);
      if (activity.sentAt.length >= options.limit) {
        activity.sentAt = [];
        activity.blockedUntil = now + options.cooldownMs;
        activityByActor.set(actorId, activity);
        return { ok: false, retryAfterMs: options.cooldownMs };
      }

      activity.sentAt.push(now);
      activity.blockedUntil = 0;
      activityByActor.set(actorId, activity);
      return { ok: true, retryAfterMs: 0 };
    },
    clear(actorId?: string | number) {
      if (actorId === undefined) activityByActor.clear();
      else activityByActor.delete(actorId);
    },
  };
}

export function normalizeRoomText(value: unknown, maxLength = 200): string {
  const withoutControls = Array.from(String(value ?? ''), (character) => {
    const code = character.codePointAt(0) ?? 0;
    return code < 32 || code === 127 ? ' ' : character;
  }).join('');
  return Array.from(withoutControls.replace(/\s+/g, ' ').trim())
    .slice(0, Math.max(1, maxLength))
    .join('');
}
