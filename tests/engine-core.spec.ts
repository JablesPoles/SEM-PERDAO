import { expect, test } from 'playwright/test';
import * as THREE from 'three';

import {
  normalizeActorIntentCommand,
} from '../src/lib/mesa/actorContract';
import {
  auditActorAsset,
  auditActorManifest,
  loadActorManifest,
  type ActorAssetManifest,
} from '../src/lib/mesa/actorManifest';
import { ExperienceDirector } from '../src/lib/mesa/experienceDirector';
import {
  ExperienceRuntime,
  type ExperienceRuntimeClock,
} from '../src/lib/mesa/experienceRuntime';
import {
  createTableEvent,
  parseTableEvent,
  seedFromEventId,
  TableEventJournal,
} from '../src/lib/mesa/tableEvents';
import { collectActorRenderMetrics } from '../src/lib/three/actors/actorMetrics';
import { PROCEDURAL_CULTIST_MANIFEST } from '../src/lib/three/actors/cultistManifest';
import {
  GltfActorAssetStore,
  selectActorAssetUri,
} from '../src/lib/three/actors/gltfActorAssetStore';

const GLTF_MANIFEST: ActorAssetManifest = {
  schema: 'a-mesa.actor/v1',
  id: 'a-mesa.actor.test',
  label: 'Ator de teste',
  version: 1,
  runtime: 'gltf',
  source: { uri: '/actors/test/model.glb', authoring: 'test.blend' },
  coordinateSystem: { metersPerUnit: 1, forward: '+z', up: '+y' },
  rootNode: 'ActorRoot',
  clips: {
    idle: { clip: 'idle', loop: 'repeat', fadeMs: 120, speed: 1 },
    hit: { clip: 'hit', loop: 'once', fadeMs: 40, speed: 1.2 },
  },
  expressions: {
    joy: { morphTargets: { smile: 1 }, fadeMs: 90 },
  },
  anchors: { root: 'AnchorRoot', head: 'AnchorHead' },
  variants: {
    hood: { classic: ['HoodClassic'], spire: ['HoodSpire'], none: [] },
  },
  palette: {
    robe: {
      material: 'Tunica',
      property: 'baseColorFactor',
      values: { blood: '#8f201b', ash: '#625d63' },
    },
  },
  lods: [
    { id: 'lod-1', uri: '/actors/test/model-lod1.glb', minDistance: 7, maxTriangles: 8_000 },
    { id: 'lod-2', uri: '/actors/test/model-lod2.glb', minDistance: 14, maxTriangles: 3_000 },
  ],
  budget: {
    maxDownloadBytes: 2_000_000,
    maxTriangles: 24_000,
    maxDrawCalls: 18,
    maxBones: 64,
    maxTextureEdge: 2_048,
  },
  preload: 'lobby',
};

test('comandos de ator ganham defaults sem aceitar lixo ou números perigosos', () => {
  expect(normalizeActorIntentCommand('hit')).toMatchObject({
    intent: 'hit',
    priority: 4,
    intensity: 1,
    durationMs: null,
  });
  expect(normalizeActorIntentCommand({
    intent: 'laugh',
    priority: 999,
    intensity: -4,
    durationMs: 99_999,
    seed: -42,
    sourceEventId: 'event-42',
  })).toEqual({
    intent: 'laugh',
    priority: 100,
    intensity: 0,
    durationMs: 60_000,
    seed: 42,
    sourceEventId: 'event-42',
  });
  expect(normalizeActorIntentCommand('explode')).toBeNull();
});

test('eventos da mesa são serializáveis, determinísticos e validados na entrada', () => {
  const labels = ['caos', 'cinema'];
  const event = createTableEvent({
    id: 'event-round-0001',
    roomSessionId: 'room-session-1',
    gameId: 'sem-perdao',
    sequence: 3,
    kind: 'round.winner',
    occurredAt: 1234,
    actorId: 'player-1',
    targetId: 'player-2',
    payload: { points: 1, labels },
  });
  labels.push('mutação tardia');
  expect(event.seed).toBe(seedFromEventId('event-round-0001'));
  expect(event.payload.labels).toEqual(['caos', 'cinema']);
  expect(Object.isFrozen(event.payload.labels)).toBe(true);
  expect(parseTableEvent(JSON.parse(JSON.stringify(event)))).toEqual(event);
  expect(parseTableEvent({ ...event, kind: 'ROUND WINNER' })).toBeNull();
  expect(() => createTableEvent({
    id: 'event-bad-payload',
    roomSessionId: 'room-session-1',
    gameId: 'sem-perdao',
    sequence: 4,
    kind: 'round.invalid',
    payload: { date: new Date() } as unknown as Record<string, unknown>,
  })).toThrow('Payload de evento inválido');
});

test('journal recusa duplicatas, snapshots fora de ordem e outra sessão', () => {
  const journal = new TableEventJournal('room-session-1', 'sem-perdao', 2);
  const first = journal.append({ id: 'event-0001', kind: 'round.started', payload: { round: 1 } });
  const second = journal.append({ id: 'event-0002', kind: 'round.revealed', payload: {} });
  const third = journal.append({ id: 'event-0003', kind: 'round.winner', payload: {} });
  expect(journal.replay().map((event) => event.id)).toEqual(['event-0002', 'event-0003']);
  expect(journal.accept(second)).toBe(false);
  expect(journal.accept({ ...first, id: 'event-foreign', roomSessionId: 'room-session-2', sequence: 8 }))
    .toBe(false);
  expect(journal.latestSequence()).toBe(third.sequence);
});

test('diretor transforma um evento em beats ordenados sem conhecer Three ou áudio', () => {
  const director = new ExperienceDirector([
    {
      id: 'round-chaos',
      event: 'round.*',
      beats: (event) => [
        { channel: 'camera', cue: 'winner-close', actor: 'target', delayMs: 120, priority: 3 },
        {
          channel: 'actor',
          cue: String(event.payload.intent),
          actor: 'actor',
          delayMs: -1,
          priority: 999,
        },
      ],
    },
    {
      id: 'only-winner',
      event: 'round.winner',
      beats: [{ channel: 'audio', cue: 'sting-win', delayMs: 120, priority: 10 }],
    },
  ]);
  const event = createTableEvent({
    id: 'event-director-1',
    roomSessionId: 'room-session-1',
    gameId: 'sem-perdao',
    sequence: 0,
    kind: 'round.winner',
    actorId: 'player-1',
    targetId: 'player-2',
    payload: { intent: 'celebrate' },
  });
  const beats = director.plan(event);
  expect(beats.map((beat) => `${beat.channel}:${beat.cue}`)).toEqual([
    'actor:celebrate',
    'audio:sting-win',
    'camera:winner-close',
  ]);
  expect(beats[0]).toMatchObject({ actorId: 'player-1', delayMs: 0, priority: 100 });
  expect(beats[2]).toMatchObject({ actorId: 'player-2', delayMs: 120 });
});

test('runtime respeita delay, duração e interrupção por canal', () => {
  let nextHandle = 0;
  const timers = new Map<number, () => void>();
  const clock: ExperienceRuntimeClock = {
    setTimeout(callback) {
      const handle = nextHandle += 1;
      timers.set(handle, callback);
      return handle;
    },
    clearTimeout(handle) {
      timers.delete(handle as number);
    },
  };
  const calls: string[] = [];
  const runtime = new ExperienceRuntime({
    camera: (beat) => {
      calls.push(`start:${beat.cue}`);
      return () => calls.push(`stop:${beat.cue}`);
    },
  }, { clock });
  const base = {
    eventId: 'event-runtime',
    actorId: null,
    payload: {},
    priority: 1,
    durationMs: null,
  } as const;
  runtime.run([
    {
      ...base,
      id: 'beat-wide',
      channel: 'camera',
      cue: 'wide',
      delayMs: 0,
      interrupt: 'none',
    },
    {
      ...base,
      id: 'beat-close',
      channel: 'camera',
      cue: 'close',
      delayMs: 20,
      durationMs: 100,
      interrupt: 'channel',
    },
  ]);
  expect(calls).toEqual(['start:wide']);
  expect(runtime.stats()).toEqual({ scheduled: 1, active: 1 });
  timers.get(1)?.();
  expect(calls).toEqual(['start:wide', 'stop:wide', 'start:close']);
  expect(runtime.stats()).toEqual({ scheduled: 0, active: 1 });
  timers.get(2)?.();
  expect(calls).toEqual(['start:wide', 'stop:wide', 'start:close', 'stop:close']);
  expect(runtime.stats()).toEqual({ scheduled: 0, active: 0 });
  runtime.dispose();
});

test('aparência modular cobre a combinatória inteira com poucas peças', () => {
  // A promessa que justifica o contrato: 8 túnicas × 3 capuzes × 4 rostos ×
  // 6 acentos × 4 adereços = 2.304 aparências. Se isso exigisse um asset por
  // combinação, personagem customizável seria inviável com geração por IA.
  const { variants, palette } = PROCEDURAL_CULTIST_MANIFEST;
  const opcoesPorSlot = [
    ...Object.values(variants).map((slot) => Object.keys(slot).length),
    ...Object.values(palette).map((slot) => Object.keys(slot.values).length),
  ];
  expect(opcoesPorSlot.reduce((total, n) => total * n, 1)).toBe(2_304);

  // …e o custo em geometria é a soma, não o produto. "none" não liga nó nenhum.
  const nos = new Set(Object.values(variants).flatMap((slot) => Object.values(slot).flat()));
  expect(nos.size).toBeLessThanOrEqual(12);
  expect(variants.accessory.none).toEqual([]);
});

test('slot não pode ser peça e cor ao mesmo tempo, e cor exige tabela válida', () => {
  const base = { ...GLTF_MANIFEST } as unknown as Record<string, unknown>;
  const duplicado = auditActorManifest({
    ...base,
    variants: { robe: { blood: ['RobeA'] } },
    palette: { robe: { material: 'Tunica', values: { blood: '#8f201b' } } },
  });
  expect(duplicado.valid).toBe(false);
  expect(duplicado.issues.some((entrada) => entrada.code === 'slot.duplicado')).toBe(true);

  const semTabela = auditActorManifest({ ...base, palette: { robe: { material: 'Tunica' } } });
  expect(semTabela.issues.some((entrada) => entrada.code === 'palette.values')).toBe(true);

  const corTorta = auditActorManifest({
    ...base,
    palette: { robe: { material: 'Tunica', values: { blood: 'vermelho' } } },
  });
  expect(corTorta.issues.some((entrada) => entrada.code === 'palette.color')).toBe(true);

  // Um manifesto antigo, sem os campos novos, continua válido: a adição é aditiva.
  const semAparencia = { ...base };
  delete semAparencia.variants;
  delete semAparencia.palette;
  const legado = auditActorManifest(semAparencia);
  expect(legado.valid).toBe(true);
  expect(legado.manifest?.variants).toEqual({});
  expect(legado.manifest?.palette).toEqual({});
});

test('manifesto audita clips, expressões, LODs e orçamento observado', () => {
  const audit = auditActorManifest(GLTF_MANIFEST);
  expect(audit.valid).toBe(true);
  expect(audit.issues).toEqual([]);
  expect(audit.manifest?.expressions?.joy?.morphTargets.smile).toBe(1);
  expect(selectActorAssetUri(GLTF_MANIFEST, 0)).toBe('/actors/test/model.glb');
  expect(selectActorAssetUri(GLTF_MANIFEST, 9)).toBe('/actors/test/model-lod1.glb');
  expect(selectActorAssetUri(GLTF_MANIFEST, 50)).toBe('/actors/test/model-lod2.glb');
  expect(auditActorAsset(GLTF_MANIFEST, {
    triangles: 24_001,
    drawCalls: 22,
    bones: 32,
  }).map((issue) => issue.code)).toEqual([
    'budget.exceeded.triangles',
    'budget.exceeded.drawCalls',
  ]);

  const broken = auditActorManifest({
    ...GLTF_MANIFEST,
    id: 'Com Espaço',
    source: { uri: '/actors/test/model.fbx' },
    lods: [{ ...GLTF_MANIFEST.lods[0], uri: '/actors/test/model.obj' }],
    expressions: { joy: { morphTargets: { smile: 4 } } },
  });
  expect(broken.valid).toBe(false);
  expect(broken.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining([
    'id.invalid',
    'source.not-gltf',
    'lod.not-gltf',
    'expression.morph-invalid',
  ]));
  expect(auditActorManifest(PROCEDURAL_CULTIST_MANIFEST).valid).toBe(true);
});

test('loader aceita manifesto JSON externo e resolve assets ao lado dele', async () => {
  const fetcher = (async () => ({
    ok: true,
    status: 200,
    url: '',
    json: async () => ({
      ...GLTF_MANIFEST,
      source: { uri: './actor.glb' },
      lods: [{ ...GLTF_MANIFEST.lods[0], uri: './actor-lod1.glb' }],
    }),
  })) as unknown as typeof fetch;
  const manifest = await loadActorManifest('./manifest.json', {
    fetcher,
    baseUrl: 'https://cdn.example/actors/cultist/1/manifest.json',
  });
  expect(manifest.source.uri).toBe('https://cdn.example/actors/cultist/1/actor.glb');
  expect(manifest.lods[0].uri).toBe('https://cdn.example/actors/cultist/1/actor-lod1.glb');
});

test('store glTF compartilha recursos, clona instâncias e só libera template sem uso', async () => {
  const scene = new THREE.Group();
  const actorRoot = new THREE.Group();
  actorRoot.name = 'ActorRoot';
  const anchorRoot = new THREE.Object3D();
  anchorRoot.name = 'AnchorRoot';
  const anchorHead = new THREE.Object3D();
  anchorHead.name = 'AnchorHead';
  anchorHead.position.y = 1.7;
  const geometry = new THREE.BoxGeometry(1, 2, 1);
  const material = new THREE.MeshStandardMaterial();
  actorRoot.add(new THREE.Mesh(geometry, material), anchorRoot, anchorHead);
  scene.add(actorRoot);
  let loads = 0;
  const store = new GltfActorAssetStore({
    loader: {
      async loadAsync() {
        loads += 1;
        return {
          scene,
          animations: [
            new THREE.AnimationClip('idle', 1, []),
            new THREE.AnimationClip('hit', 0.4, []),
          ],
        };
      },
    },
  });
  const first = await store.create(GLTF_MANIFEST, { actorId: 'player-1' });
  const second = await store.create(GLTF_MANIFEST, { actorId: 'player-2' });
  expect(loads).toBe(1);
  expect(first.root).not.toBe(second.root);
  expect(first.metrics()).toMatchObject({ meshes: 1, triangles: 12 });
  expect(first.anchor('head')?.[1]).toBeCloseTo(1.7);
  expect(first.play('hit')).toBe(true);
  expect(store.stats()).toEqual({ templates: 1, liveInstances: 2 });
  first.dispose();
  expect(store.disposeUnused()).toBe(0);
  second.dispose();
  expect(store.disposeUnused()).toBe(1);
  expect(store.stats()).toEqual({ templates: 0, liveInstances: 0 });
  store.dispose();
});

test('métricas do ator contam custo geométrico antes de colocá-lo na mesa', () => {
  const root = new THREE.Group();
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const material = new THREE.MeshStandardMaterial();
  root.add(new THREE.Mesh(geometry, material));
  expect(collectActorRenderMetrics(root)).toEqual({
    meshes: 1,
    skinnedMeshes: 0,
    materials: 1,
    textures: 0,
    triangles: 12,
    drawCalls: 1,
    bones: 0,
    maxTextureEdge: 0,
  });
  geometry.dispose();
  material.dispose();
});
