import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';
import {
  ACTOR_INTENT_PRIORITY,
  normalizeActorIntentCommand,
  type ActorAnchorId,
  type ActorAppearance,
  type ActorTexturePainter,
  type ActorExpression,
  type ActorFrame,
  type ActorIntent,
  type ActorIntentCommand,
  type ActorRenderMetrics,
  type TableActor,
} from '@/lib/mesa/actorContract';
import {
  auditActorManifest,
  type ActorAssetManifest,
  type ActorClipBinding,
} from '@/lib/mesa/actorManifest';
import { collectActorRenderMetrics } from './actorMetrics';

export interface LoadedActorTemplate {
  scene: THREE.Group;
  animations: readonly THREE.AnimationClip[];
}

export interface ActorGltfLoader {
  loadAsync(url: string): Promise<LoadedActorTemplate>;
}

interface CachedActorTemplate {
  refs: number;
  promise: Promise<LoadedActorTemplate>;
  value: LoadedActorTemplate | null;
}

interface MorphTransition {
  startedAt: number;
  durationMs: number;
  meshes: Array<{
    influences: number[];
    from: number[];
    to: number[];
  }>;
}

export interface GltfActorInstanceOptions {
  actorId: string;
  /** Distância prevista da câmera, usada para escolher um LOD declarado. */
  distance?: number;
  castShadow?: boolean;
  receiveShadow?: boolean;
  /**
   * Desenha as texturas dos `textureSlots` do manifesto. Sem isto o ator fica
   * com a textura embutida no asset — no cultista, uma cara congelada.
   */
  paintTexture?: ActorTexturePainter;
}

export interface GltfActorAssetStoreOptions {
  manager?: THREE.LoadingManager;
  renderer?: THREE.WebGLRenderer;
  /** Só configure quando os transcoders Basis estiverem publicados nesse caminho. */
  ktx2TranscoderPath?: string;
  /** Injeção usada por testes e por hosts que já possuem um pipeline de download. */
  loader?: ActorGltfLoader;
}

export function selectActorAssetUri(manifest: ActorAssetManifest, distance = 0): string {
  const safeDistance = Number.isFinite(distance) ? Math.max(0, distance) : 0;
  let uri = manifest.source.uri;
  for (const lod of [...manifest.lods].sort((left, right) => left.minDistance - right.minDistance)) {
    if (lod.minDistance <= safeDistance) uri = lod.uri;
  }
  return uri;
}

function disposeTemplate(template: LoadedActorTemplate): void {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  template.scene.traverse((object) => {
    if (!(object instanceof THREE.Mesh || object instanceof THREE.Points)) return;
    geometries.add(object.geometry);
    const values = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of values) {
      materials.add(material);
      for (const value of Object.values(material)) {
        if (value instanceof THREE.Texture) textures.add(value);
      }
    }
  });
  textures.forEach((texture) => texture.dispose());
  materials.forEach((material) => material.dispose());
  geometries.forEach((geometry) => geometry.dispose());
  template.scene.clear();
}

function cacheKey(manifest: ActorAssetManifest, uri: string): string {
  return `${manifest.id}@${manifest.version}:${uri}`;
}

/**
 * Cache de assets de personagem. Cada instância ganha hierarquia/rig próprios,
 * mas compartilha buffers, materiais e texturas imutáveis do glTF.
 */
export class GltfActorAssetStore {
  private readonly loader: ActorGltfLoader;
  private readonly ktx2Loader: KTX2Loader | null;
  private readonly entries = new Map<string, CachedActorTemplate>();
  private disposed = false;

  constructor(options: GltfActorAssetStoreOptions = {}) {
    if (options.loader) {
      this.loader = options.loader;
      this.ktx2Loader = null;
      return;
    }
    const loader = new GLTFLoader(options.manager);
    loader.setMeshoptDecoder(MeshoptDecoder);
    this.loader = loader;
    if (options.renderer && options.ktx2TranscoderPath) {
      this.ktx2Loader = new KTX2Loader(options.manager)
        .setTranscoderPath(options.ktx2TranscoderPath)
        .detectSupport(options.renderer);
      loader.setKTX2Loader(this.ktx2Loader);
    } else {
      this.ktx2Loader = null;
    }
  }

  private ensure(manifest: ActorAssetManifest, uri: string): CachedActorTemplate {
    if (this.disposed) throw new Error('O cache de atores já foi descartado.');
    const key = cacheKey(manifest, uri);
    const existing = this.entries.get(key);
    if (existing) return existing;

    const entry: CachedActorTemplate = {
      refs: 0,
      value: null,
      promise: Promise.resolve(null as never),
    };
    entry.promise = this.loader.loadAsync(uri).then((gltf) => {
      const value = { scene: gltf.scene, animations: gltf.animations } satisfies LoadedActorTemplate;
      if (this.disposed) {
        disposeTemplate(value);
        throw new Error('O cache de atores foi descartado durante o carregamento.');
      }
      entry.value = value;
      return value;
    }).catch((error: unknown) => {
      if (this.entries.get(key) === entry) this.entries.delete(key);
      throw error;
    });
    this.entries.set(key, entry);
    return entry;
  }

  async preload(manifest: ActorAssetManifest, distance = 0): Promise<void> {
    this.validate(manifest);
    await this.ensure(manifest, selectActorAssetUri(manifest, distance)).promise;
  }

  async create(
    manifest: ActorAssetManifest,
    options: GltfActorInstanceOptions
  ): Promise<GltfTableActor> {
    this.validate(manifest);
    if (!options.actorId || options.actorId.length > 160) throw new Error('ID de ator inválido.');
    const uri = selectActorAssetUri(manifest, options.distance);
    const key = cacheKey(manifest, uri);
    const entry = this.ensure(manifest, uri);
    const template = await entry.promise;
    entry.refs += 1;
    try {
      return new GltfTableActor(manifest, template, options, () => this.release(key));
    } catch (error) {
      this.release(key);
      throw error;
    }
  }

  private validate(manifest: ActorAssetManifest): void {
    const audit = auditActorManifest(manifest);
    if (!audit.valid || manifest.runtime !== 'gltf') {
      const reason = audit.issues.find((entry) => entry.severity === 'error')?.message
        ?? 'O manifesto não descreve um ator glTF.';
      throw new Error(reason);
    }
  }

  private release(key: string): void {
    const entry = this.entries.get(key);
    if (entry) entry.refs = Math.max(0, entry.refs - 1);
  }

  /** Libera somente templates sem instâncias vivas; útil ao trocar de jogo. */
  disposeUnused(): number {
    let disposed = 0;
    for (const [key, entry] of this.entries) {
      if (entry.refs > 0 || !entry.value) continue;
      disposeTemplate(entry.value);
      this.entries.delete(key);
      disposed += 1;
    }
    return disposed;
  }

  stats(): Readonly<{ templates: number; liveInstances: number }> {
    let liveInstances = 0;
    this.entries.forEach((entry) => { liveInstances += entry.refs; });
    return Object.freeze({ templates: this.entries.size, liveInstances });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const entry of this.entries.values()) {
      if (entry.value) disposeTemplate(entry.value);
    }
    this.entries.clear();
    this.ktx2Loader?.dispose();
  }
}

export class GltfTableActor implements TableActor<THREE.Group> {
  readonly source = 'gltf' as const;
  readonly root = new THREE.Group();
  readonly actorId: string;
  currentIntent: ActorIntent = 'idle';
  currentExpression: ActorExpression = 'neutral';

  private readonly model: THREE.Object3D;
  private readonly mixer: THREE.AnimationMixer;
  private readonly clips = new Map<string, THREE.AnimationClip>();
  private readonly release: () => void;
  private activeAction: THREE.AnimationAction | null = null;
  private activePriority = 0;
  private intentEndsAt = 0;
  private morphTransition: MorphTransition | null = null;
  /** Materiais clonados só pra este ator; o template continua compartilhado. */
  private readonly materiaisProprios = new Set<THREE.Material>();
  /** Última aparência aplicada — o pintor de textura depende dela. */
  private aparencia: ActorAppearance = {};
  private readonly texturasProprias = new Set<THREE.Texture>();
  private readonly pintarTextura: ActorTexturePainter | null;
  private disposed = false;

  constructor(
    private readonly manifest: ActorAssetManifest,
    template: LoadedActorTemplate,
    options: GltfActorInstanceOptions,
    release: () => void
  ) {
    this.actorId = options.actorId;
    this.release = release;
    this.pintarTextura = options.paintTexture ?? null;
    const scene = cloneSkeleton(template.scene);
    this.model = manifest.rootNode ? scene.getObjectByName(manifest.rootNode) ?? scene : scene;
    if (manifest.rootNode && this.model === scene && scene.name !== manifest.rootNode) {
      throw new Error(`Nó raiz ausente no glTF: ${manifest.rootNode}`);
    }
    scene.scale.multiplyScalar(manifest.coordinateSystem.metersPerUnit);
    if (manifest.coordinateSystem.forward === '-z') scene.rotation.y += Math.PI;
    scene.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      object.castShadow = options.castShadow ?? true;
      object.receiveShadow = options.receiveShadow ?? false;
    });
    this.root.name = 'actor-root';
    this.root.userData.actorId = options.actorId;
    this.root.userData.actorManifestId = manifest.id;
    this.root.add(scene);
    this.mixer = new THREE.AnimationMixer(scene);
    template.animations.forEach((clip) => this.clips.set(clip.name, clip));
    this.playClip(manifest.clips.idle ?? null);
  }

  private playClip(binding: ActorClipBinding | null): boolean {
    if (!binding) {
      this.activeAction?.fadeOut(0.12);
      this.activeAction = null;
      return false;
    }
    const clip = this.clips.get(binding.clip);
    if (!clip) return false;
    const next = this.mixer.clipAction(clip);
    next.enabled = true;
    next.reset();
    next.setEffectiveTimeScale(binding.speed);
    next.setEffectiveWeight(1);
    if (binding.loop === 'repeat') {
      next.setLoop(THREE.LoopRepeat, Infinity);
      next.clampWhenFinished = false;
    } else {
      next.setLoop(THREE.LoopOnce, 1);
      next.clampWhenFinished = true;
    }
    if (this.activeAction && this.activeAction !== next) {
      next.crossFadeFrom(this.activeAction, binding.fadeMs / 1_000, false);
    }
    next.play();
    this.activeAction = next;
    return true;
  }

  play(value: ActorIntent | Partial<ActorIntentCommand> & { intent: ActorIntent }): boolean {
    if (this.disposed) return false;
    const command = normalizeActorIntentCommand(value);
    if (!command) return false;
    const binding = this.manifest.clips[command.intent];
    if (!binding) return false;
    const now = globalThis.performance?.now?.() ?? Date.now();
    if (now < this.intentEndsAt && command.priority < this.activePriority) return false;
    if (!this.playClip(binding)) return false;

    this.currentIntent = command.intent;
    this.activePriority = command.priority;
    const clip = this.clips.get(binding.clip);
    const naturalDuration = binding.loop === 'once' && clip
      ? Math.round((clip.duration * 1_000) / binding.speed)
      : 0;
    const duration = command.durationMs ?? naturalDuration;
    this.intentEndsAt = duration > 0 ? now + duration : 0;
    if (command.intent === 'idle') this.setExpression('neutral');
    if (command.intent === 'sleep') this.setExpression('sleep');
    return true;
  }

  /**
   * `variants` liga/desliga nós; `palette` pinta material. Slot ou opção que o
   * asset não declara é ignorado — outro cliente pode estar numa versão à
   * frente do vestuário, e isso não pode esvaziar a cadeira.
   */
  setAppearance(appearance: ActorAppearance): void {
    if (this.disposed) return;
    this.aparencia = { ...this.aparencia, ...appearance };
    for (const [slot, opcao] of Object.entries(appearance) as [string, string][]) {
      const variante = this.manifest.variants[slot];
      if (variante) {
        if (!variante[opcao]) continue;
        const ativos = new Set(variante[opcao]);
        for (const nos of Object.values(variante)) {
          for (const nome of nos) {
            const no = this.model.getObjectByName(nome);
            if (no) no.visible = ativos.has(nome);
          }
        }
        continue;
      }
      const tinta = this.manifest.palette[slot];
      const cor = tinta?.values[opcao];
      if (tinta && cor) this.pintar(tinta.material, tinta.property, cor);
    }
    this.repintarTexturas();
  }

  /**
   * Redesenha cada `textureSlot` a partir da aparência e da expressão atuais.
   *
   * É aqui que a carinha do cultista acompanha o jogo: a engine não sabe
   * desenhar um rosto, mas sabe qual material o recebe e quando ele mudou.
   */
  private repintarTexturas(): void {
    if (!this.pintarTextura) return;
    for (const [slot, ligacao] of Object.entries(this.manifest.textureSlots)) {
      const canvas = this.pintarTextura({
        slot,
        expression: this.currentExpression,
        appearance: this.aparencia,
      });
      if (!canvas) continue;
      const textura = new THREE.CanvasTexture(canvas);
      textura.colorSpace = THREE.SRGBColorSpace;
      // Pixel duro: filtro linear borraria os olhos, que têm poucos pixels e
      // são a leitura inteira do personagem a 160 px na tela.
      textura.magFilter = THREE.NearestFilter;
      textura.minFilter = THREE.NearestFilter;
      textura.generateMipmaps = false;
      textura.flipY = false;
      this.aplicarTextura(ligacao.material, ligacao.channel, textura);
    }
  }

  private aplicarTextura(
    nomeMaterial: string,
    canal: 'emissive-mask' | 'base-color',
    textura: THREE.Texture
  ): void {
    let usada = false;
    this.model.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      const lista = Array.isArray(object.material) ? object.material : [object.material];
      lista.forEach((material, indice) => {
        if (material?.name !== nomeMaterial) return;
        let alvo = material as THREE.MeshStandardMaterial;
        if (!this.materiaisProprios.has(material)) {
          alvo = material.clone() as THREE.MeshStandardMaterial;
          this.materiaisProprios.add(alvo);
          if (Array.isArray(object.material)) object.material[indice] = alvo;
          else object.material = alvo;
        }
        // A textura anterior deste ator morre aqui; a do template nunca é
        // tocada, senão a mesa inteira herdaria o rosto de um réu só.
        for (const antiga of [alvo.map, alvo.emissiveMap, alvo.alphaMap]) {
          if (antiga && this.texturasProprias.has(antiga)) {
            this.texturasProprias.delete(antiga);
            antiga.dispose();
          }
        }
        if (canal === 'emissive-mask') {
          alvo.map = textura;
          alvo.emissiveMap = textura;
          // NUNCA `alphaMap` aqui: no Three.js ele amostra o canal VERDE, não o
          // alfa. Um rosto brasa (#ff784f, verde 0,47) caía inteiro no
          // `alphaTest` 0,5 e sumia, enquanto o creme (verde 0,94) passava. O
          // recorte tem que vir do alfa do próprio canvas, via `map`.
          alvo.alphaMap = null;
          alvo.transparent = true;
          alvo.alphaTest = 0.35;
          if (alvo.emissive) alvo.emissive.setRGB(1, 1, 1);
          // Emissão moderada de propósito: o asset vem do Blender com força 12,
          // e a essa intensidade QUALQUER cor satura para branco — o rosto
          // brasa perdia o laranja. 1,7 ainda acende no blackout do ato final
          // sem estourar o matiz.
          alvo.emissiveIntensity = 1.7;
        } else {
          alvo.map = textura;
        }
        alvo.needsUpdate = true;
        usada = true;
      });
    });
    if (usada) this.texturasProprias.add(textura);
    else textura.dispose();
  }

  /**
   * `SkeletonUtils.clone` COMPARTILHA materiais entre instâncias — pintar o
   * material do template repintaria a mesa inteira. Por isso o material é
   * clonado na primeira vez que este ator o pinta, e só ele é descartado no fim.
   */
  private pintar(nomeMaterial: string, propriedade: 'baseColorFactor' | 'emissiveFactor', cor: string): void {
    this.model.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      const lista = Array.isArray(object.material) ? object.material : [object.material];
      lista.forEach((material, indice) => {
        if (material?.name !== nomeMaterial) return;
        let alvo = material;
        if (!this.materiaisProprios.has(material)) {
          alvo = material.clone();
          this.materiaisProprios.add(alvo);
          if (Array.isArray(object.material)) object.material[indice] = alvo;
          else object.material = alvo;
        }
        const destino = propriedade === 'emissiveFactor'
          ? (alvo as THREE.MeshStandardMaterial).emissive
          : (alvo as THREE.MeshStandardMaterial).color;
        destino?.set(cor);
        alvo.needsUpdate = true;
      });
    });
  }

  setExpression(expression: ActorExpression): void {
    if (this.disposed) return;
    const binding = this.manifest.expressions?.[expression]
      ?? (expression === 'neutral' ? { morphTargets: {}, fadeMs: 120 } : null);
    this.currentExpression = expression;
    // Expressão pode ser morph OU pixel. O cultista não tem morph nenhum: a
    // cara dele muda por textura, e sem repintar aqui ele ficaria de pedra.
    this.repintarTexturas();
    if (!binding) return;
    const meshes: MorphTransition['meshes'] = [];
    this.root.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      const dictionary = object.morphTargetDictionary;
      const influences = object.morphTargetInfluences;
      if (!dictionary || !influences) return;
      const from = influences.slice();
      const to = new Array(influences.length).fill(0);
      for (const [name, influence] of Object.entries(binding.morphTargets)) {
        const index = dictionary[name];
        if (index !== undefined) to[index] = influence;
      }
      meshes.push({ influences, from, to });
    });
    const now = globalThis.performance?.now?.() ?? Date.now();
    this.morphTransition = { startedAt: now, durationMs: binding.fadeMs, meshes };
    if (binding.fadeMs === 0) this.updateMorphs(now);
  }

  private updateMorphs(now: number): void {
    const transition = this.morphTransition;
    if (!transition) return;
    const progress = transition.durationMs === 0
      ? 1
      : Math.min(1, Math.max(0, (now - transition.startedAt) / transition.durationMs));
    const eased = 1 - Math.pow(1 - progress, 3);
    for (const mesh of transition.meshes) {
      mesh.influences.forEach((_, index) => {
        mesh.influences[index] = THREE.MathUtils.lerp(mesh.from[index] ?? 0, mesh.to[index] ?? 0, eased);
      });
    }
    if (progress >= 1) this.morphTransition = null;
  }

  update(frame: ActorFrame): void {
    if (this.disposed) return;
    this.mixer.update(frame.delta);
    this.updateMorphs(frame.now);
    if (this.intentEndsAt > 0 && frame.now >= this.intentEndsAt) {
      this.currentIntent = 'idle';
      this.activePriority = ACTOR_INTENT_PRIORITY.idle;
      this.intentEndsAt = 0;
      this.playClip(this.manifest.clips.idle ?? null);
    }
  }

  anchor(id: ActorAnchorId): readonly [number, number, number] | null {
    if (this.disposed) return null;
    const nodeName = this.manifest.anchors[id];
    const node = nodeName ? this.root.getObjectByName(nodeName) : null;
    if (!node) return null;
    this.root.updateMatrixWorld(true);
    const position = node.getWorldPosition(new THREE.Vector3());
    return [position.x, position.y, position.z];
  }

  metrics(): ActorRenderMetrics {
    return collectActorRenderMetrics(this.root);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.root.children[0] ?? this.root);
    this.root.removeFromParent();
    this.root.clear();
    // Só o que ESTE ator clonou; o material do template segue vivo pros outros.
    for (const material of this.materiaisProprios) material.dispose();
    this.materiaisProprios.clear();
    for (const textura of this.texturasProprias) textura.dispose();
    this.texturasProprias.clear();
    this.release();
  }
}
