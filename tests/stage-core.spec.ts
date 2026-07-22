import * as THREE from 'three';
import { expect, test } from 'playwright/test';

import {
  FrameBenchmark,
  summarizeFrameTimes,
} from '../src/lib/three/frameBenchmark';
import {
  STAGE_QUALITY,
  classifyStageViewport,
  resolveCameraDefinition,
} from '../src/lib/three/tabletopStage';
import {
  summarizeProjectedFrame,
  summarizeVisibleMeshFrame,
} from '../src/lib/three/framing';
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

test('viewport do palco distingue retrato, paisagem ampla e paisagem compacta', () => {
  expect(classifyStageViewport(390, 844)).toBe('portrait');
  expect(classifyStageViewport(360, 482)).toBe('portrait');
  expect(classifyStageViewport(1440, 900)).toBe('landscape');
  expect(classifyStageViewport(932, 834)).toBe('landscape');
  expect(classifyStageViewport(844, 390)).toBe('compact-landscape');
  expect(classifyStageViewport(794, 266)).toBe('compact-landscape');
});

test('variante de câmera herda campos ausentes e paisagem compacta tem fallback legado', () => {
  const definition = {
    position: [0, 2, 6],
    target: [0, 1, 0],
    fov: 44,
    portrait: { fov: 38 },
    compactLandscape: { position: [0, 1.8, 4.2] },
  } as const;

  expect(resolveCameraDefinition(definition, 'portrait')).toEqual({
    position: [0, 2, 6],
    target: [0, 1, 0],
    fov: 38,
  });
  expect(resolveCameraDefinition(definition, 'compact-landscape')).toEqual({
    position: [0, 1.8, 4.2],
    target: [0, 1, 0],
    fov: 44,
  });

  const legacyDefinition = {
    position: [3, 2, 5],
    target: [0, 1, 0],
  } as const;
  expect(resolveCameraDefinition(legacyDefinition, 'compact-landscape')).toEqual({
    position: [3, 2, 5],
    target: [0, 1, 0],
    fov: 48,
  });
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

test('enquadramento por mesh não cria falso overflow com AABB global em perspectiva', () => {
  const camera = new THREE.PerspectiveCamera(90, 1, 0.1, 100);
  const root = new THREE.Group();
  const geometry = new THREE.BoxGeometry(0.2, 0.2, 0.2);
  const material = new THREE.MeshBasicMaterial();
  const nearLeft = new THREE.Mesh(geometry, material);
  const farRight = new THREE.Mesh(geometry, material);
  nearLeft.position.set(-0.4, 0, -2);
  farRight.position.set(8, 0, -10);
  root.add(nearLeft, farRight);

  const report = summarizeVisibleMeshFrame(root, camera, 0.05);
  expect(report).toMatchObject({
    fits: true,
    behindCamera: false,
    overflowX: 0,
    overflowY: 0,
  });

  // A implementação antiga unia as duas caixas antes da projeção. Isso cria
  // o canto inexistente (x = 8.1, z = -1.9), muito além da borda direita.
  const globalBox = new THREE.Box3().setFromObject(root);
  const { min, max } = globalBox;
  const globalCorners: THREE.Vector3[] = [];
  for (const x of [min.x, max.x]) {
    for (const y of [min.y, max.y]) {
      for (const z of [min.z, max.z]) {
        globalCorners.push(new THREE.Vector3(x, y, z));
      }
    }
  }
  const legacyReport = summarizeProjectedFrame(globalCorners.map((point) => {
    const projected = point.project(camera);
    return { x: projected.x, y: projected.y, z: projected.z };
  }), 0.05);
  expect(legacyReport?.fits).toBe(false);
  expect(legacyReport?.overflowX).toBeGreaterThan(3);

  geometry.dispose();
  material.dispose();
});
