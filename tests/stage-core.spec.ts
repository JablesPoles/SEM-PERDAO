import { expect, test } from 'playwright/test';

import {
  FrameBenchmark,
  summarizeFrameTimes,
} from '../src/lib/three/frameBenchmark';
import { STAGE_QUALITY } from '../src/lib/three/tabletopStage';
import { summarizeProjectedFrame } from '../src/lib/three/framing';
import {
  downgradedQuality,
  nextQualityPreference,
  presentationProfile,
  resolveEffectiveQuality,
} from '../src/lib/presentationPreferences';

test('resumo de frames calcula percentis e ignora amostras inválidas', () => {
  const result = summarizeFrameTimes([16, 17, Number.NaN, -1, 20, 55], {
    label: 'mesa-test',
    recordedAt: 'agora',
  });
  expect(result).toMatchObject({
    label: 'mesa-test',
    recordedAt: 'agora',
    frameCount: 4,
    medianFrameMs: 17,
    p95FrameMs: 20,
    p99FrameMs: 20,
    longFrameCount: 1,
  });
});

test('benchmark separa aquecimento da janela medida e resolve uma vez', async () => {
  const benchmark = new FrameBenchmark(() => 'instante-fixo');
  const completion = benchmark.start({ label: 'retro', warmupMs: 32, durationMs: 1000 });
  benchmark.record(16);
  benchmark.record(16);
  expect(benchmark.state()).toMatchObject({ phase: 'sampling', frameCount: 0 });
  for (let index = 0; index < 63; index += 1) benchmark.record(16);
  const result = await completion;
  expect(result).toMatchObject({
    label: 'retro',
    recordedAt: 'instante-fixo',
    frameCount: 63,
    averageFps: 62.5,
  });
  expect(benchmark.state()).toBeNull();
});

test('perfis reduzem resolução e sombras de forma monotônica', () => {
  expect(STAGE_QUALITY.cinematic.pixelScale).toBeLessThan(STAGE_QUALITY.balanced.pixelScale);
  expect(STAGE_QUALITY.balanced.pixelScale).toBeLessThan(STAGE_QUALITY.performance.pixelScale);
  expect(STAGE_QUALITY.cinematic.shadows).toBe(true);
  expect(STAGE_QUALITY.performance.shadows).toBe(false);
});

test('qualidade automática respeita capacidade e pode degradar por frames reais', () => {
  expect(resolveEffectiveQuality('auto', {
    width: 390,
    height: 844,
    devicePixelRatio: 3,
    hardwareConcurrency: 4,
    deviceMemoryGb: 4,
  })).toBe('low');
  expect(resolveEffectiveQuality('auto', {
    width: 1440,
    height: 900,
    devicePixelRatio: 2,
    hardwareConcurrency: 10,
    deviceMemoryGb: 16,
  })).toBe('high');
  expect(presentationProfile('medium')).toEqual({ quality: 'medium', pixelSize: 2, shadows: true });
  expect(downgradedQuality('high', { p95FrameMs: 34, slowFrameRatio: 0.1 })).toBe('medium');
  expect(downgradedQuality('medium', { p95FrameMs: 18, slowFrameRatio: 0.05 })).toBe('medium');
  expect(['auto', 'high', 'medium', 'low'].map((quality) =>
    nextQualityPreference(quality as 'auto' | 'high' | 'medium' | 'low')
  )).toEqual(['high', 'medium', 'low', 'auto']);
});

test('validador de enquadramento acusa borda, profundidade e margem segura', () => {
  expect(summarizeProjectedFrame([
    { x: -0.8, y: -0.7, z: 0.2 },
    { x: 0.85, y: 0.72, z: 0.5 },
  ], 0.05)).toMatchObject({ fits: true, overflowX: 0, overflowY: 0 });
  const overflowing = summarizeProjectedFrame([
    { x: -1.1, y: 0, z: 0 },
    { x: 0.8, y: 1.04, z: 0 },
  ], 0.05);
  expect(overflowing).toMatchObject({ fits: false });
  expect(overflowing?.overflowX).toBeCloseTo(0.15);
  expect(overflowing?.overflowY).toBeCloseTo(0.09);
  expect(summarizeProjectedFrame([{ x: 0, y: 0, z: 1.2 }]))
    .toMatchObject({ fits: false, behindCamera: true });
});
