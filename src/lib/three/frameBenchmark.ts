export interface FrameBenchmarkResult extends Record<string, unknown> {
  label: string;
  recordedAt: string;
  frameCount: number;
  sampledMs: number;
  averageFps: number;
  averageFrameMs: number;
  medianFrameMs: number;
  p95FrameMs: number;
  p99FrameMs: number;
  slowFrameRatio: number;
  longFrameCount: number;
}

export interface FrameBenchmarkState {
  phase: 'warmup' | 'sampling';
  progress: number;
  frameCount: number;
}

interface BenchmarkRun {
  label: string;
  warmupMs: number;
  durationMs: number;
  warmupElapsedMs: number;
  sampledElapsedMs: number;
  frameTimes: number[];
  metadata: Record<string, unknown>;
  resolve: (result: FrameBenchmarkResult | null) => void;
}

const rounded = (value: number, digits = 2): number => Number(value.toFixed(digits));

export function summarizeFrameTimes(
  frameTimes: readonly number[],
  metadata: Record<string, unknown> = {}
): FrameBenchmarkResult {
  const samples = frameTimes
    .filter((value) => Number.isFinite(value) && value > 0)
    .sort((left, right) => left - right);
  if (!samples.length) throw new Error('O benchmark precisa de pelo menos um frame válido.');
  const totalMs = samples.reduce((total, value) => total + value, 0);
  const percentile = (ratio: number) =>
    samples[Math.min(samples.length - 1, Math.floor((samples.length - 1) * ratio))];
  const averageFrameMs = totalMs / samples.length;
  return Object.freeze({
    label: typeof metadata.label === 'string' ? metadata.label : 'tabletop',
    recordedAt: typeof metadata.recordedAt === 'string' ? metadata.recordedAt : new Date().toISOString(),
    ...metadata,
    frameCount: samples.length,
    sampledMs: rounded(totalMs, 1),
    averageFps: rounded(1000 / averageFrameMs),
    averageFrameMs: rounded(averageFrameMs),
    medianFrameMs: rounded(percentile(0.5)),
    p95FrameMs: rounded(percentile(0.95)),
    p99FrameMs: rounded(percentile(0.99)),
    slowFrameRatio: rounded(samples.filter((value) => value > 20).length / samples.length, 4),
    longFrameCount: samples.filter((value) => value > 50).length,
  }) as FrameBenchmarkResult;
}

export class FrameBenchmark {
  private run: BenchmarkRun | null = null;

  constructor(private readonly timestamp = () => new Date().toISOString()) {}

  start({
    label = 'tabletop',
    warmupMs = 1500,
    durationMs = 10000,
    metadata = {},
  }: {
    label?: string;
    warmupMs?: number;
    durationMs?: number;
    metadata?: Record<string, unknown>;
  } = {}): Promise<FrameBenchmarkResult | null> {
    if (this.run) throw new Error('Já existe um benchmark 3D em andamento.');
    return new Promise((resolve) => {
      this.run = {
        label,
        warmupMs: Math.max(0, Number(warmupMs) || 0),
        durationMs: Math.max(1000, Number(durationMs) || 10000),
        warmupElapsedMs: 0,
        sampledElapsedMs: 0,
        frameTimes: [],
        metadata,
        resolve,
      };
    });
  }

  state(): FrameBenchmarkState | null {
    const run = this.run;
    if (!run) return null;
    const warmingUp = run.warmupElapsedMs < run.warmupMs;
    return Object.freeze({
      phase: warmingUp ? 'warmup' : 'sampling',
      progress: warmingUp
        ? run.warmupMs === 0 ? 1 : run.warmupElapsedMs / run.warmupMs
        : run.sampledElapsedMs / run.durationMs,
      frameCount: run.frameTimes.length,
    });
  }

  record(
    frameMs: number,
    options: {
      eligible?: boolean;
      metadata?: Record<string, unknown> | (() => Record<string, unknown>);
    } = {}
  ): FrameBenchmarkResult | null {
    const run = this.run;
    if (
      !run
      || options.eligible === false
      || !Number.isFinite(frameMs)
      || frameMs <= 0
      || frameMs > 1000
    ) return null;
    if (run.warmupElapsedMs < run.warmupMs) {
      run.warmupElapsedMs = Math.min(run.warmupMs, run.warmupElapsedMs + frameMs);
      return null;
    }
    run.frameTimes.push(frameMs);
    run.sampledElapsedMs += frameMs;
    if (run.sampledElapsedMs < run.durationMs) return null;
    const completionMetadata = typeof options.metadata === 'function'
      ? options.metadata()
      : options.metadata ?? {};
    const result = summarizeFrameTimes(run.frameTimes, {
      label: run.label,
      recordedAt: this.timestamp(),
      ...run.metadata,
      ...completionMetadata,
    });
    this.run = null;
    run.resolve(result);
    return result;
  }

  cancel(result: FrameBenchmarkResult | null = null): void {
    if (!this.run) return;
    const run = this.run;
    this.run = null;
    run.resolve(result);
  }
}
