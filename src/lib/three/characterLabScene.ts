import * as THREE from 'three';
import type {
  ActorExpression,
  ActorIntent,
  ActorRenderMetrics,
  TableActor,
} from '@/lib/mesa/actorContract';
import {
  auditResolvedActorCatalogManifest,
  findActorCatalogEntry,
  selectActorCatalogEntry,
  type ActorCatalogEntry,
} from '@/lib/mesa/actorCatalog';
import {
  auditActorAsset,
  auditActorManifest,
  loadActorManifest,
  type ActorAssetManifest,
  type ActorManifestIssue,
} from '@/lib/mesa/actorManifest';
import {
  ExperienceDirector,
  type DirectedExperienceBeat,
} from '@/lib/mesa/experienceDirector';
import { ExperienceRuntime } from '@/lib/mesa/experienceRuntime';
import {
  TableEventJournal,
  type TableEvent,
} from '@/lib/mesa/tableEvents';
import type { CultistAppearance } from '@/lib/types';
import type { FrameBenchmarkResult, FrameBenchmarkState } from './frameBenchmark';
import type { FramingReport } from './framing';
import { CHARACTER_ACTOR_CATALOG } from './actors/characterActorCatalog';
import { createCultistFacePainter } from './actors/cultistFacePainter';
import { PROCEDURAL_CULTIST_MANIFEST } from './actors/cultistManifest';
import { GltfActorAssetStore } from './actors/gltfActorAssetStore';
import { ProceduralCultistActor } from './actors/proceduralCultistActor';
import {
  TabletopStage,
  type StageMetrics,
  type StageQuality,
} from './tabletopStage';

export type CharacterLabCamera = 'full' | 'face' | 'profile';

export interface CharacterLabTrace {
  event: TableEvent;
  beats: readonly DirectedExperienceBeat[];
}

export interface CharacterLabActorSourceState {
  requestedId: string;
  activeId: string;
  label: string;
  runtime: ActorAssetManifest['runtime'];
  manifestUri: string;
  manifestUrl: string | null;
  status: 'ready' | 'fallback' | 'error';
  detail: string | null;
  chain: readonly string[];
}

export interface CharacterLabSnapshot {
  stage: StageMetrics;
  actor: ActorRenderMetrics;
  actorSource: CharacterLabActorSourceState;
  camera: CharacterLabCamera;
  framing: FramingReport | null;
  budgetIssues: ActorManifestIssue[];
  manifestIssues: ActorManifestIssue[];
  benchmark: FrameBenchmarkState | null;
  anchors: Partial<Record<'root' | 'head' | 'nameplate' | 'projectile-origin', readonly [number, number, number]>>;
}

const DIRECTOR = new ExperienceDirector([
  {
    id: 'lab-actor-intent',
    event: 'actor.intent',
    beats: (event) => [{
      channel: 'actor',
      cue: typeof event.payload.intent === 'string' ? event.payload.intent : 'idle',
      actor: 'actor',
      priority: typeof event.payload.priority === 'number' ? event.payload.priority : 0,
      payload: {
        intensity: event.payload.intensity ?? 1,
        seed: event.seed,
      },
    }],
  },
  {
    id: 'lab-impact-camera',
    event: 'actor.intent',
    when: (event) => event.payload.intent === 'hit' || event.payload.intent === 'rage',
    beats: [{
      channel: 'camera',
      cue: 'face',
      actor: 'actor',
      delayMs: 40,
      durationMs: 900,
      priority: 4,
      interrupt: 'channel',
    }],
  },
]);

function createEnvironment(): THREE.Group {
  const environment = new THREE.Group();
  environment.name = 'character-lab-environment';

  const hemisphere = new THREE.HemisphereLight(0xfff1dc, 0x302c38, 1.75);
  const key = new THREE.SpotLight(0xffead0, 72, 11, 0.7, 0.5, 1.25);
  key.position.set(-1.7, 4.2, 2.8);
  key.target.position.set(0, 1.05, 0);
  key.castShadow = true;
  key.shadow.mapSize.set(512, 512);
  key.shadow.bias = -0.0008;
  const rim = new THREE.DirectionalLight(0xff3b2f, 2.35);
  rim.position.set(3.2, 2.5, -2.8);
  const fill = new THREE.DirectionalLight(0x8de5ff, 0.58);
  fill.position.set(-3, 1.6, 1.8);
  environment.add(hemisphere, key, key.target, rim, fill);

  const pedestal = new THREE.Mesh(
    new THREE.CylinderGeometry(1.17, 1.28, 0.16, 28),
    new THREE.MeshStandardMaterial({ color: 0x29272e, roughness: 0.82, metalness: 0.08 })
  );
  pedestal.position.y = -0.09;
  pedestal.receiveShadow = true;
  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(11, 40),
    new THREE.MeshStandardMaterial({ color: 0x111014, roughness: 0.96 })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.18;
  floor.receiveShadow = true;

  const halo = new THREE.Mesh(
    new THREE.RingGeometry(1.42, 1.47, 64),
    new THREE.MeshBasicMaterial({ color: 0xff3b2f, transparent: true, opacity: 0.55 })
  );
  halo.rotation.x = -Math.PI / 2;
  halo.position.y = -0.165;
  environment.add(pedestal, floor, halo);
  return environment;
}

export class CharacterLabScene {
  readonly stage: TabletopStage;

  private actor: TableActor<THREE.Group>;
  private activeManifest: ActorAssetManifest;
  private actorSourceState: CharacterLabActorSourceState;
  private readonly gltfStore: GltfActorAssetStore;
  private readonly journal = new TableEventJournal('character-lab-session', 'sem-perdao');
  private readonly trace: ((value: CharacterLabTrace) => void) | null;
  private readonly runtime: ExperienceRuntime;
  private unregisterActor: (() => void) | null = null;
  private selectedCamera: CharacterLabCamera = 'full';
  private activeCamera: CharacterLabCamera = 'full';
  private actorLoadRevision = 0;
  private actorLoadController: AbortController | null = null;
  private disposed = false;

  constructor(
    canvas: HTMLCanvasElement,
    options: {
      name: string;
      appearance: CultistAppearance;
      onTrace?: (value: CharacterLabTrace) => void;
    }
  ) {
    this.trace = options.onTrace ?? null;
    this.stage = new TabletopStage(canvas, {
      quality: 'balanced',
      clearColor: 0x0d0c0f,
      fogColor: 0x0d0c0f,
      fogDensity: 0.032,
      exposure: 1.08,
      postProcess: true,
      grain: 0.012,
      vignette: 0.91,
      navigation: true,
      disposeRoot: true,
    });
    this.gltfStore = new GltfActorAssetStore({ renderer: this.stage.renderer });
    this.stage.add(createEnvironment());
    this.defineCameras();
    const defaultEntry = findActorCatalogEntry(
      CHARACTER_ACTOR_CATALOG,
      CHARACTER_ACTOR_CATALOG.defaultActorId
    );
    if (!defaultEntry || defaultEntry.source.kind !== 'inline-manifest') {
      throw new Error('O catálogo não possui fallback procedural embutido.');
    }
    this.activeManifest = defaultEntry.source.manifest;
    this.actor = this.createProceduralActor(this.activeManifest, options.name, options.appearance);
    this.actorSourceState = {
      requestedId: defaultEntry.id,
      activeId: defaultEntry.id,
      label: defaultEntry.label,
      runtime: defaultEntry.runtime,
      manifestUri: this.activeManifest.source.uri,
      manifestUrl: null,
      status: 'ready',
      detail: null,
      chain: Object.freeze([defaultEntry.id]),
    };
    this.mountActor(this.actor);
    this.runtime = new ExperienceRuntime({
      actor: (beat) => {
        this.actor.play({
          intent: beat.cue as ActorIntent,
          priority: beat.priority,
          intensity: typeof beat.payload.intensity === 'number' ? beat.payload.intensity : 1,
          seed: typeof beat.payload.seed === 'number' ? beat.payload.seed : 0,
          sourceEventId: beat.eventId,
        });
      },
      camera: (beat) => {
        if (beat.cue !== 'face') return;
        this.activeCamera = 'face';
        this.stage.setCameraAct('face', { duration: 260 });
        return () => {
          if (!this.disposed) {
            this.activeCamera = this.selectedCamera;
            this.stage.setCameraAct(this.selectedCamera, { duration: 520 });
          }
        };
      },
    });
    this.stage.setCameraAct('full', { immediate: true });
    this.stage.setPickHandler((id) => {
      if (id === this.actor.actorId) this.emitIntent('celebrate');
    });
    this.stage.addUpdater((frame) => this.actor.update(frame));
  }

  private defineCameras(): void {
    this.stage.defineCameraAct('full', {
      position: [0, 1.5, 4.25],
      target: [0, 1.02, 0.08],
      fov: 43,
      portrait: { position: [0, 1.48, 4.7], target: [0, 1.04, 0.06], fov: 42 },
      compactLandscape: {
        position: [0, 1.46, 3.95],
        target: [0, 1.02, 0.08],
        fov: 43,
      },
    });
    this.stage.defineCameraAct('face', {
      position: [0, 1.82, 2.35],
      target: [0, 1.72, 0.1],
      fov: 35,
      portrait: { position: [0, 1.82, 2.65], target: [0, 1.7, 0.1], fov: 34 },
      compactLandscape: {
        position: [0, 1.82, 2.2],
        target: [0, 1.7, 0.1],
        fov: 35,
      },
    });
    this.stage.defineCameraAct('profile', {
      position: [3.35, 1.58, 2.55],
      target: [0, 1.08, 0.04],
      fov: 42,
      portrait: { position: [3.7, 1.64, 3], target: [0, 1.08, 0.04], fov: 42 },
      compactLandscape: {
        position: [3.15, 1.54, 2.42],
        target: [0, 1.08, 0.04],
        fov: 42,
      },
    });
  }

  private createProceduralActor(
    manifest: ActorAssetManifest,
    name: string,
    appearance: CultistAppearance
  ): ProceduralCultistActor {
    if (
      manifest.runtime !== 'procedural'
      || manifest.source.uri !== PROCEDURAL_CULTIST_MANIFEST.source.uri
    ) {
      throw new Error(`Factory procedural não registrada: ${manifest.source.uri}`);
    }
    const actor = new ProceduralCultistActor({
      actorId: 'lab-player-1',
      name: name.trim().toUpperCase() || 'RÉU',
      appearance,
    });
    actor.root.position.y = 0.02;
    return actor;
  }

  private mountActor(actor: TableActor<THREE.Group>): void {
    this.stage.add(actor.root);
    this.unregisterActor = this.stage.registerInteractive(actor.root, actor.actorId);
  }

  private replaceActor(actor: TableActor<THREE.Group>): void {
    const previous = this.actor;
    this.unregisterActor?.();
    this.unregisterActor = null;
    this.actor = actor;
    this.mountActor(actor);
    previous.dispose();
  }

  private async resolveEntryManifest(
    entry: ActorCatalogEntry,
    signal: AbortSignal
  ): Promise<ActorAssetManifest> {
    if (entry.source.kind === 'inline-manifest') return entry.source.manifest;
    const manifest = await loadActorManifest(entry.source.url, { signal });
    const issues = auditResolvedActorCatalogManifest(entry, manifest)
      .filter((issue) => issue.severity === 'error');
    if (issues.length) {
      throw new Error(issues.slice(0, 3).map((issue) => issue.message).join(' · '));
    }
    return manifest;
  }

  private async createActorForEntry(
    manifest: ActorAssetManifest,
    name: string,
    appearance: CultistAppearance
  ): Promise<TableActor<THREE.Group>> {
    if (manifest.runtime === 'procedural') {
      return this.createProceduralActor(manifest, name, appearance);
    }
    const actor = await this.gltfStore.create(manifest, {
      actorId: 'lab-player-1',
      distance: 4,
      castShadow: true,
      receiveShadow: false,
      paintTexture: createCultistFacePainter(),
    });
    // Um glTF nasce com TODAS as variantes visíveis. Sem aplicar a aparência
    // aqui, o ator entra em cena com os três capuzes empilhados na cabeça.
    actor.setAppearance(appearance);
    return actor;
  }

  private actorLoadError(cause: unknown, entry: ActorCatalogEntry): string {
    if (cause instanceof Error && cause.message) return cause.message;
    return `Asset de ${entry.label} indisponível.`;
  }

  /**
   * Aplica aparência sem trocar de ator.
   *
   * No glTF isso é `setAppearance`: as peças já estão no arquivo, então mudar
   * capuz ou túnica é ligar nó e pintar material — nada é recarregado. O
   * procedural precisa reconstruir a malha (é assim que ele funciona), mas o
   * chamador não vê diferença. Antes disso, aparência simplesmente não existia
   * fora do procedural, o que fazia do slot glTF um downgrade.
   */
  setActor(name: string, appearance: CultistAppearance): void {
    if (this.disposed) return;
    if (this.activeManifest.runtime === 'procedural') {
      this.replaceActor(this.createProceduralActor(this.activeManifest, name, appearance));
      return;
    }
    this.actor.setAppearance(appearance);
  }

  /**
   * Troca uma fonte sem desmontar o ator atual antes da nova ficar pronta.
   * Falhas de manifesto, rede ou GLB percorrem a cadeia declarada no catálogo.
   */
  async setActorSource(
    requestedActorId: string,
    name: string,
    appearance: CultistAppearance
  ): Promise<CharacterLabActorSourceState> {
    if (this.disposed) return this.actorSourceState;
    const revision = this.actorLoadRevision + 1;
    this.actorLoadRevision = revision;
    this.actorLoadController?.abort();
    const controller = new AbortController();
    this.actorLoadController = controller;
    const unavailable = new Set<string>();
    let failureDetail: string | null = null;

    while (!this.disposed && revision === this.actorLoadRevision) {
      const selection = selectActorCatalogEntry(CHARACTER_ACTOR_CATALOG, requestedActorId, {
        unavailableActorIds: unavailable,
      });
      const entry = selection.entry;
      if (!entry) break;
      try {
        const manifest = await this.resolveEntryManifest(entry, controller.signal);
        const actor = await this.createActorForEntry(manifest, name, appearance);
        if (this.disposed || revision !== this.actorLoadRevision) {
          actor.dispose();
          return this.actorSourceState;
        }
        actor.root.position.y = 0.02;
        this.replaceActor(actor);
        this.activeManifest = manifest;
        this.actorSourceState = {
          requestedId: requestedActorId,
          activeId: entry.id,
          label: manifest.label,
          runtime: manifest.runtime,
          manifestUri: manifest.source.uri,
          manifestUrl: entry.source.kind === 'manifest-url' ? entry.source.url : null,
          status: selection.fallbackUsed ? 'fallback' : 'ready',
          detail: selection.fallbackUsed
            ? failureDetail ?? `Fonte solicitada indisponível; usando ${entry.label}.`
            : null,
          chain: selection.chain,
        };
        return this.actorSourceState;
      } catch (cause) {
        if (controller.signal.aborted || revision !== this.actorLoadRevision || this.disposed) {
          return this.actorSourceState;
        }
        unavailable.add(entry.id);
        failureDetail = `${entry.label}: ${this.actorLoadError(cause, entry)}`;
      }
    }

    this.actorSourceState = {
      ...this.actorSourceState,
      requestedId: requestedActorId,
      status: 'error',
      detail: failureDetail ?? 'Nenhuma fonte ou fallback pôde ser carregado.',
    };
    return this.actorSourceState;
  }

  emitIntent(intent: ActorIntent, intensity = 1): CharacterLabTrace | null {
    if (this.disposed) return null;
    const event = this.journal.append({
      kind: 'actor.intent',
      actorId: this.actor.actorId,
      payload: {
        intent,
        intensity,
        ...(intent === 'hit' ? { priority: 4 } : intent === 'rage' ? { priority: 5 } : {}),
      },
    });
    const beats = DIRECTOR.plan(event);
    this.runtime.run(beats);
    const value = { event, beats } satisfies CharacterLabTrace;
    this.trace?.(value);
    return value;
  }

  setExpression(expression: ActorExpression): void {
    this.actor.setExpression(expression);
  }

  setCamera(camera: CharacterLabCamera, options: { immediate?: boolean } = {}): void {
    this.runtime.cancelChannel('camera');
    this.selectedCamera = camera;
    this.activeCamera = camera;
    this.stage.setCameraAct(camera, options);
  }

  setQuality(quality: StageQuality): void {
    this.stage.setQuality(quality);
  }

  setReducedMotion(reduced: boolean): void {
    this.stage.setReducedMotion(reduced);
  }

  snapshot(): CharacterLabSnapshot {
    const actor = this.actor.metrics();
    const manifestIssues = auditActorManifest(this.activeManifest).issues;
    const budgetIssues = auditActorAsset(this.activeManifest, {
      triangles: actor.triangles,
      drawCalls: actor.drawCalls,
      bones: actor.bones,
      textureEdge: actor.maxTextureEdge || undefined,
    });
    const anchors: CharacterLabSnapshot['anchors'] = {};
    for (const id of ['root', 'head', 'nameplate', 'projectile-origin'] as const) {
      const position = this.actor.anchor(id);
      if (position) anchors[id] = position;
    }
    return {
      stage: this.stage.metrics(),
      actor,
      actorSource: this.actorSourceState,
      camera: this.activeCamera,
      framing: this.stage.framingReport(this.actor.root, 0.07),
      budgetIssues,
      manifestIssues,
      benchmark: this.stage.performanceBenchmarkState(),
      anchors,
    };
  }

  benchmark(): Promise<FrameBenchmarkResult | null> {
    return this.stage.runPerformanceBenchmark({
      label: `character-lab/${this.activeManifest.id}@${this.activeManifest.version}`,
      warmupMs: 600,
      durationMs: 4_000,
      metadata: {
        actorManifestId: this.activeManifest.id,
        actorManifestVersion: this.activeManifest.version,
        actorRuntime: this.activeManifest.runtime,
        requestedActorId: this.actorSourceState.requestedId,
        quality: this.stage.getQuality(),
      },
    });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.actorLoadRevision += 1;
    this.actorLoadController?.abort();
    this.runtime.dispose();
    this.unregisterActor?.();
    this.actor.dispose();
    this.gltfStore.dispose();
    this.stage.dispose();
  }
}
