import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GltfActorAssetStore } from './actors/gltfActorAssetStore';
import { loadActorManifest } from '@/lib/mesa/actorManifest';
import { PropLibrary, TRIBUNAL_PROPS_MANIFEST_URL } from './propLibrary';
import { RIGGED_CULTIST_MANIFEST_URL } from './actors/characterActorCatalog';
import { createCultistFacePainter } from './actors/cultistFacePainter';
import type { ActorAppearance, ActorIntent, TableActor } from '@/lib/mesa/actorContract';

/**
 * Vitrine dos modelos gerados no Blender.
 *
 * Existe porque os labs anteriores respondem a perguntas diferentes: o Character
 * Lab valida UM ator contra o contrato, e o palco do jogo mostra os modelos
 * dentro da cena. Falta o meio-termo — ver todo o acervo lado a lado, no mesmo
 * enquadramento, para julgar se as peças pertencem ao mesmo mundo.
 *
 * Sem estado de jogo: aqui só existem assets.
 */

export interface ModelGalleryMetrics {
  readonly props: number;
  readonly triangulosProps: number;
  readonly triangulosAtor: number;
  readonly falhas: readonly string[];
}

export interface ModelGalleryOptions {
  canvas: HTMLCanvasElement;
  onReady?: (metrics: ModelGalleryMetrics) => void;
}

const COR_FUNDO = 0x0a090c;
const RAIO_VITRINE = 2.9;

export class ModelGalleryScene {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly controls: OrbitControls;
  private readonly relogio = new THREE.Clock();
  private readonly props = new PropLibrary();
  private readonly gltfStore = new GltfActorAssetStore();
  private readonly pedestais: THREE.Object3D[] = [];
  private ator: TableActor<THREE.Group> | null = null;
  private quadro = 0;
  private descartado = false;
  private falhas: string[] = [];

  constructor(private readonly options: ModelGalleryOptions) {
    const canvas = options.canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
    this.renderer.setPixelRatio(1);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.BasicShadowMap;
    this.scene.background = new THREE.Color(COR_FUNDO);
    this.scene.fog = new THREE.Fog(COR_FUNDO, 12, 26);

    this.camera = new THREE.PerspectiveCamera(46, 1, 0.1, 100);
    this.camera.position.set(0, 2.6, 6.2);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.enablePan = false;
    this.controls.minDistance = 3;
    this.controls.maxDistance = 16;
    this.controls.maxPolarAngle = Math.PI / 2.05;
    this.controls.target.set(0, 0.95, 0);

    this.montarLuz();
    this.montarChao();
    this.redimensionar();
    void this.carregar();
    this.renderer.setAnimationLoop(() => this.tick());
  }

  private montarLuz(): void {
    // Uma chave quente vinda de cima e um preenchimento frio fraco. A vitrine
    // não imita o porão de propósito: aqui o que importa é ler a FORMA, e a
    // iluminação dramática do jogo esconde metade da silhueta.
    const ambiente = new THREE.HemisphereLight(0xfff0dc, 0x2a2830, 1.5);
    const chave = new THREE.DirectionalLight(0xfff4e0, 2.4);
    chave.position.set(-4, 7, 5);
    chave.castShadow = true;
    chave.shadow.mapSize.set(1024, 1024);
    chave.shadow.camera.left = -8;
    chave.shadow.camera.right = 8;
    chave.shadow.camera.top = 8;
    chave.shadow.camera.bottom = -8;
    const contra = new THREE.DirectionalLight(0xff5a4a, 0.5);
    contra.position.set(5, 3, -6);
    this.scene.add(ambiente, chave, contra);
  }

  private montarChao(): void {
    const chao = new THREE.Mesh(
      new THREE.CircleGeometry(9, 40),
      new THREE.MeshLambertMaterial({ color: 0x17161a })
    );
    chao.rotation.x = -Math.PI / 2;
    chao.receiveShadow = true;
    this.scene.add(chao);
    const grade = new THREE.PolarGridHelper(9, 8, 6, 48, 0x3a2a2a, 0x241c1e);
    (grade.material as THREE.Material).opacity = 0.35;
    (grade.material as THREE.Material).transparent = true;
    this.scene.add(grade);
  }

  private async carregar(): Promise<void> {
    const [okProps] = await Promise.all([
      this.props.load(TRIBUNAL_PROPS_MANIFEST_URL),
      this.carregarAtor(),
    ]);
    if (this.descartado) return;
    if (okProps) this.distribuirProps();
    else this.falhas.push('Biblioteca de props indisponível.');

    this.options.onReady?.({
      props: this.props.metricas().props,
      triangulosProps: this.props.metricas().triangulos,
      triangulosAtor: this.ator?.metrics().triangles ?? 0,
      falhas: Object.freeze([...this.falhas]),
    });
  }

  private async carregarAtor(): Promise<void> {
    try {
      const manifest = await loadActorManifest(RIGGED_CULTIST_MANIFEST_URL);
      if (this.descartado) return;
      const ator = await this.gltfStore.create(manifest, {
        actorId: 'gallery-cultist',
        distance: 4,
        castShadow: true,
        paintTexture: createCultistFacePainter(),
      });
      if (this.descartado) {
        ator.dispose();
        return;
      }
      this.ator = ator;
      ator.setAppearance({ hood: 'classic', accessory: 'relic', robe: 'blood', accent: 'bone' });
      ator.play('idle');
      this.scene.add(ator.root);
    } catch (erro) {
      this.falhas.push(`Cultista glTF: ${erro instanceof Error ? erro.message : 'falhou'}`);
    }
  }

  /** Props em círculo ao redor do ator, cada um no seu pedestal. */
  private distribuirProps(): void {
    const nomes = this.props.nomes();
    nomes.forEach((nome, indice) => {
      const angulo = (Math.PI * 2 * indice) / nomes.length - Math.PI / 2;
      const x = Math.cos(angulo) * RAIO_VITRINE;
      const z = Math.sin(angulo) * RAIO_VITRINE;

      // Pedestal discreto: ele situa o objeto, não compete com ele. A primeira
      // versão usava um cilindro largo e escuro que virava o assunto do quadro.
      const pedestal = new THREE.Mesh(
        new THREE.CylinderGeometry(0.34, 0.40, 0.16, 8),
        new THREE.MeshLambertMaterial({ color: 0x2c262c })
      );
      pedestal.position.set(x, 0.08, z);
      pedestal.receiveShadow = true;
      pedestal.castShadow = true;
      this.scene.add(pedestal);

      const prop = this.props.criar(nome);
      if (!prop) return;
      // Cadeira e trono ficam no chão; os pequenos sobem ao pedestal e giram.
      const grande = nome === 'chair' || nome === 'throne';
      const suporte = new THREE.Group();
      suporte.position.set(x, grande ? 0.16 : 0.16 + 0.42, z);
      // Os props são pequenos ao lado de um cultista de 1,9 m. Ampliá-los aqui
      // mentiria sobre a escala do jogo; erguê-los à altura do olhar resolve a
      // leitura sem falsear o tamanho.
      suporte.userData.giratorio = !grande;
      suporte.userData.base = suporte.position.y;
      suporte.userData.fase = indice * 0.7;
      prop.position.y = grande ? 0 : 0.06;
      suporte.add(prop);
      suporte.lookAt(0, suporte.position.y, 0);
      this.scene.add(suporte);
      this.pedestais.push(suporte);
    });
  }

  setAppearance(appearance: ActorAppearance): void {
    this.ator?.setAppearance(appearance);
  }

  playIntent(intent: ActorIntent): void {
    this.ator?.play(intent);
  }

  private tick(): void {
    if (this.descartado) return;
    const delta = Math.min(0.05, this.relogio.getDelta());
    const tempo = this.relogio.elapsedTime;
    this.quadro += 1;

    for (const suporte of this.pedestais) {
      if (!suporte.userData.giratorio) continue;
      suporte.rotation.y += delta * 0.6;
      // flutuação leve: separa o objeto do pedestal sem virar brinquedo
      suporte.position.y = (suporte.userData.base as number)
        + Math.sin(tempo * 1.1 + (suporte.userData.fase as number)) * 0.045;
    }

    this.ator?.update({
      delta,
      elapsed: tempo,
      now: performance.now(),
      reducedMotion: false,
    });

    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  redimensionar(): void {
    const canvas = this.options.canvas;
    const largura = canvas.clientWidth || 960;
    const altura = canvas.clientHeight || 540;
    this.renderer.setSize(largura, altura, false);
    this.camera.aspect = largura / Math.max(1, altura);
    this.camera.updateProjectionMatrix();
  }

  dispose(): void {
    if (this.descartado) return;
    this.descartado = true;
    this.renderer.setAnimationLoop(null);
    this.ator?.dispose();
    this.props.dispose();
    this.gltfStore.dispose();
    this.controls.dispose();
    this.scene.traverse((objeto) => {
      if (!(objeto instanceof THREE.Mesh)) return;
      objeto.geometry.dispose();
      const materiais = Array.isArray(objeto.material) ? objeto.material : [objeto.material];
      for (const material of materiais) material?.dispose();
    });
    this.renderer.dispose();
  }
}
