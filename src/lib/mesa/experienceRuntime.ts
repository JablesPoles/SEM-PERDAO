import {
  EXPERIENCE_CHANNELS,
  type DirectedExperienceBeat,
  type ExperienceChannel,
} from './experienceDirector';

export type ExperienceCueCleanup = () => void;
export type ExperienceCueExecutor = (
  beat: DirectedExperienceBeat
) => void | ExperienceCueCleanup;

export interface ExperienceRuntimeClock {
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface ExperienceRuntimeOptions {
  clock?: ExperienceRuntimeClock;
  onError?: (error: unknown, beat: DirectedExperienceBeat) => void;
}

interface ScheduledCue {
  beat: DirectedExperienceBeat;
  order: number;
  timer: unknown | null;
}

interface ActiveCue {
  beat: DirectedExperienceBeat;
  order: number;
  cleanup: ExperienceCueCleanup;
  endTimer: unknown | null;
}

const browserClock: ExperienceRuntimeClock = {
  setTimeout: (callback, delayMs) => globalThis.setTimeout(callback, delayMs),
  clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/**
 * Agenda os beats compilados pelo ExperienceDirector e mantém cancelamento por
 * canal. Continua neutro: os executores injetados decidem como câmera/áudio/3D
 * funcionam em cada cliente.
 */
export class ExperienceRuntime {
  private readonly executors: Partial<Record<ExperienceChannel, ExperienceCueExecutor>>;
  private readonly clock: ExperienceRuntimeClock;
  private readonly onError: ExperienceRuntimeOptions['onError'];
  private readonly scheduled = new Map<string, ScheduledCue>();
  private readonly active = new Map<string, ActiveCue>();
  private order = 0;
  private disposed = false;

  constructor(
    executors: Partial<Record<ExperienceChannel, ExperienceCueExecutor>>,
    options: ExperienceRuntimeOptions = {}
  ) {
    this.executors = { ...executors };
    this.clock = options.clock ?? browserClock;
    this.onError = options.onError;
  }

  run(beats: readonly DirectedExperienceBeat[]): readonly string[] {
    if (this.disposed) return [];
    const ids: string[] = [];
    for (const beat of beats) {
      if (!EXPERIENCE_CHANNELS.includes(beat.channel) || this.scheduled.has(beat.id)) continue;
      this.cancel(beat.id);
      const cue: ScheduledCue = { beat, order: this.order += 1, timer: null };
      this.scheduled.set(beat.id, cue);
      ids.push(beat.id);
      if (beat.delayMs > 0) {
        cue.timer = this.clock.setTimeout(() => this.launch(beat.id), beat.delayMs);
      } else {
        this.launch(beat.id);
      }
    }
    return Object.freeze(ids);
  }

  private launch(id: string): void {
    const cue = this.scheduled.get(id);
    if (!cue || this.disposed) return;
    this.scheduled.delete(id);
    if (cue.beat.interrupt === 'all') {
      this.cancelOlderThan(cue.order);
    } else if (cue.beat.interrupt === 'channel') {
      this.cancelOlderThan(cue.order, cue.beat.channel);
    }
    const executor = this.executors[cue.beat.channel];
    if (!executor) return;
    try {
      const cleanup = executor(cue.beat);
      if (typeof cleanup !== 'function') return;
      const active: ActiveCue = {
        beat: cue.beat,
        order: cue.order,
        cleanup,
        endTimer: null,
      };
      this.active.set(id, active);
      if (typeof cue.beat.durationMs === 'number' && cue.beat.durationMs > 0) {
        active.endTimer = this.clock.setTimeout(() => this.cancel(id), cue.beat.durationMs);
      }
    } catch (error) {
      this.onError?.(error, cue.beat);
    }
  }

  private cancelOlderThan(order: number, channel?: ExperienceChannel): void {
    for (const [id, cue] of this.scheduled) {
      if (cue.order < order && (!channel || cue.beat.channel === channel)) this.cancel(id);
    }
    for (const [id, cue] of this.active) {
      if (cue.order < order && (!channel || cue.beat.channel === channel)) this.cancel(id);
    }
  }

  cancel(id: string): boolean {
    let found = false;
    const scheduled = this.scheduled.get(id);
    if (scheduled) {
      if (scheduled.timer !== null) this.clock.clearTimeout(scheduled.timer);
      this.scheduled.delete(id);
      found = true;
    }
    const active = this.active.get(id);
    if (active) {
      if (active.endTimer !== null) this.clock.clearTimeout(active.endTimer);
      this.active.delete(id);
      try {
        active.cleanup();
      } catch (error) {
        this.onError?.(error, active.beat);
      }
      found = true;
    }
    return found;
  }

  cancelChannel(channel: ExperienceChannel): number {
    let count = 0;
    for (const [id, cue] of [...this.scheduled]) {
      if (cue.beat.channel === channel && this.cancel(id)) count += 1;
    }
    for (const [id, cue] of [...this.active]) {
      if (cue.beat.channel === channel && this.cancel(id)) count += 1;
    }
    return count;
  }

  stats(): Readonly<{ scheduled: number; active: number }> {
    return Object.freeze({ scheduled: this.scheduled.size, active: this.active.size });
  }

  dispose(): void {
    if (this.disposed) return;
    for (const id of [...this.scheduled.keys(), ...this.active.keys()]) this.cancel(id);
    this.disposed = true;
  }
}

