import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

/**
 * Biblioteca de props: um GLB, muitos objetos de cena.
 *
 * Personagem tem contrato próprio (`a-mesa.actor/v1`) porque carrega rig, clips
 * e expressão. Prop é mais simples — é malha estática com nome — e um contrato
 * de ator inteiro para uma cadeira seria cerimônia sem retorno. Daí um schema
 * separado e mínimo.
 *
 * Um arquivo para todos os props é deliberado: oito downloads de 10 KB custam
 * mais em latência do que um de 90 KB, e o palco precisa de todos eles juntos
 * de qualquer forma.
 *
 * O carregamento nunca é obrigatório. Quem consome deve continuar funcionando
 * com a geometria procedural quando a biblioteca falhar — asset ausente não
 * pode esvaziar a mesa.
 */

export const PROP_MANIFEST_SCHEMA = 'a-mesa.props/v1' as const;

export interface PropManifest {
  readonly schema: typeof PROP_MANIFEST_SCHEMA;
  readonly id: string;
  readonly label: string;
  readonly version: number;
  readonly source: { readonly uri: string };
  readonly coordinateSystem: {
    readonly metersPerUnit: number;
    readonly forward: '+z' | '-z';
    readonly up: '+y';
  };
  /** `apelido → nome do nó no GLB`. O jogo pede pelo apelido. */
  readonly props: Readonly<Record<string, string>>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function nomeSeguro(value: unknown, maximo = 120): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maximo;
}

export function parsePropManifest(value: unknown): PropManifest | null {
  if (!isRecord(value) || value.schema !== PROP_MANIFEST_SCHEMA) return null;
  if (!nomeSeguro(value.id) || !nomeSeguro(value.label)) return null;
  if (!isRecord(value.source) || !nomeSeguro(value.source.uri, 300)) return null;
  if (!isRecord(value.coordinateSystem)) return null;
  const sistema = value.coordinateSystem;
  if (typeof sistema.metersPerUnit !== 'number' || !Number.isFinite(sistema.metersPerUnit)
    || sistema.metersPerUnit <= 0) return null;
  if (sistema.forward !== '+z' && sistema.forward !== '-z') return null;
  if (sistema.up !== '+y') return null;
  if (!isRecord(value.props)) return null;

  const props: Record<string, string> = {};
  for (const [apelido, no] of Object.entries(value.props)) {
    if (!nomeSeguro(apelido, 60) || !nomeSeguro(no)) continue;
    props[apelido] = no;
  }
  if (!Object.keys(props).length) return null;

  return Object.freeze({
    schema: PROP_MANIFEST_SCHEMA,
    id: value.id,
    label: value.label,
    version: Number(value.version) || 1,
    source: Object.freeze({ uri: value.source.uri }),
    coordinateSystem: Object.freeze({
      metersPerUnit: Number(sistema.metersPerUnit),
      forward: sistema.forward,
      up: '+y' as const,
    }),
    props: Object.freeze(props),
  });
}

export interface PropLibraryOptions {
  /** Injetável para teste: qualquer coisa com `loadAsync`. */
  loader?: { loadAsync(url: string): Promise<{ scene: THREE.Object3D }> };
  manager?: THREE.LoadingManager;
}

/**
 * Carrega o GLB e entrega clones independentes por apelido.
 *
 * Geometria e material ficam compartilhados entre os clones — oito cadeiras na
 * mesa são oito nós apontando para a mesma malha. Quem precisar pintar um clone
 * específico deve clonar o material antes, como o ator glTF faz.
 */
export class PropLibrary {
  private readonly loader: NonNullable<PropLibraryOptions['loader']>;
  private manifest: PropManifest | null = null;
  private modelos = new Map<string, THREE.Object3D>();
  private carregamento: Promise<boolean> | null = null;
  private descartado = false;

  constructor(options: PropLibraryOptions = {}) {
    this.loader = options.loader ?? new GLTFLoader(options.manager);
  }

  /**
   * Resolve `true` quando a biblioteca está pronta e `false` em qualquer falha.
   * Não lança: o chamador segue com a geometria procedural e o jogo continua.
   */
  async load(manifestUrl: string): Promise<boolean> {
    if (this.carregamento) return this.carregamento;
    this.carregamento = (async () => {
      try {
        const resposta = await fetch(manifestUrl);
        if (!resposta.ok) return false;
        const manifest = parsePropManifest(await resposta.json());
        if (!manifest || this.descartado) return false;

        const base = new URL(manifestUrl, globalThis.location?.href ?? 'http://local/');
        const url = new URL(manifest.source.uri, base).toString();
        const gltf = await this.loader.loadAsync(url);
        if (this.descartado) return false;

        const escala = manifest.coordinateSystem.metersPerUnit;
        for (const [apelido, nomeNo] of Object.entries(manifest.props)) {
          const no = gltf.scene.getObjectByName(nomeNo);
          if (!no) continue;
          // Solta do pai para o clone não herdar a transformação da cena do
          // arquivo, que não tem relação com onde o prop vai parar no palco.
          no.removeFromParent();
          no.position.set(0, 0, 0);
          no.rotation.set(0, manifest.coordinateSystem.forward === '-z' ? Math.PI : 0, 0);
          no.scale.setScalar(escala);
          this.modelos.set(apelido, no);
        }
        this.manifest = manifest;
        return this.modelos.size > 0;
      } catch {
        return false;
      }
    })();
    return this.carregamento;
  }

  get pronto(): boolean {
    return !this.descartado && this.modelos.size > 0;
  }

  get id(): string | null {
    return this.manifest?.id ?? null;
  }

  nomes(): readonly string[] {
    return [...this.modelos.keys()].sort();
  }

  /** Clone independente do prop, ou `null` se a biblioteca não o tiver. */
  criar(apelido: string): THREE.Object3D | null {
    const modelo = this.modelos.get(apelido);
    if (!modelo || this.descartado) return null;
    const clone = modelo.clone(true);
    clone.name = apelido;
    clone.traverse((objeto) => {
      if (objeto instanceof THREE.Mesh) {
        objeto.castShadow = true;
        objeto.receiveShadow = false;
      }
    });
    return clone;
  }

  /** Custo geométrico somado de todos os props carregados. */
  metricas(): Readonly<{ props: number; triangulos: number; malhas: number }> {
    let triangulos = 0;
    let malhas = 0;
    for (const modelo of this.modelos.values()) {
      modelo.traverse((objeto) => {
        if (!(objeto instanceof THREE.Mesh)) return;
        malhas += 1;
        const indice = objeto.geometry.getIndex();
        const posicao = objeto.geometry.getAttribute('position');
        const contagem = indice ? indice.count : (posicao?.count ?? 0);
        triangulos += Math.floor(contagem / 3);
      });
    }
    return Object.freeze({ props: this.modelos.size, triangulos, malhas });
  }

  dispose(): void {
    if (this.descartado) return;
    this.descartado = true;
    for (const modelo of this.modelos.values()) {
      modelo.traverse((objeto) => {
        if (!(objeto instanceof THREE.Mesh)) return;
        objeto.geometry.dispose();
        const materiais = Array.isArray(objeto.material) ? objeto.material : [objeto.material];
        for (const material of materiais) material?.dispose();
      });
    }
    this.modelos.clear();
    this.manifest = null;
  }
}

export const TRIBUNAL_PROPS_MANIFEST_URL = '/mesa/props/tribunal-v1/1/manifest.json';
