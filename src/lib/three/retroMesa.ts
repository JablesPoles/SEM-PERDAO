/**
 * retroMesa.ts — Experimento visual: mesa 3D estilo retrô pixelado (PS1/DOS).
 *
 * A receita do estilo:
 *   1. Renderizar a cena num render target PEQUENO (largura / pixelSize).
 *   2. Ampliar pro canvas com NearestFilter (pixel gordo, sem blur).
 *   3. Pós-processo: posterização de cores + dithering ordenado (matriz de Bayer 4x4).
 *
 * Sem dependência da lógica do jogo — é uma vitrine pra testarmos o estilão.
 * Se aprovar, o passo seguinte é ligar isso no GameState real (como o FDP fez
 * em src/lib/three/GameScene3D.js, que foi a referência desta cena).
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { Reu, EXPRESSOES, type Expressao, type Acao } from './reus';
import type { MesaProofView, MesaSeatView, MesaView } from './mesaView';
import {
  normalizeActorIntentCommand,
  type ActorIntent,
  type ActorIntentCommand,
} from '@/lib/mesa/actorContract';
import { avatarColor } from '@/components/avatar';
import {
  TabletopStage,
  type StageFrame,
  type StageQuality,
} from './tabletopStage';
import type { FramingReport } from './framing';
import { PropLibrary, TRIBUNAL_PROPS_MANIFEST_URL } from './propLibrary';
import {
  iniciarAmbiente,
  pararAmbiente,
  somArremesso,
  somBalao,
  somFesta,
  somMartelada,
  somCarta,
  somPalmas,
  somSoco,
  somZap,
} from './sons3d';

// Paleta "Brutal Minimal — Sem Perdão" (mesmos tokens do globals.css)
const COR = {
  ink: 0x17161a,
  panel: 0x26252b,
  paper: 0xf2efe9,
  card: 0xffffff,
  red: 0xff3b2f,
  mesa: 0x322f38,
};

const CARD_W = 0.82;
const CARD_H = 1.15;
const CARD_T = 0.015; // espessura — cartas são caixas finas pra ter borda chanfrada

const ACTOR_INTENT_ACTION: Partial<Record<ActorIntent, Acao>> = {
  speak: 'apontar',
  laugh: 'rir',
  point: 'apontar',
  clap: 'aplaudir',
  celebrate: 'festejar',
  facepalm: 'facepalm',
  hit: 'atingido',
  rage: 'tilt',
};

export type Reacao3D = 'tomate' | 'sapato' | 'rosa';

/**
 * Atos de câmera — cortes SECOS (sem tween), linguagem de filme barato.
 * `pov` é a cadeira vazia do azimute 0°: você sentado à mesa, sendo julgado.
 */
export type Ato = 'mesa' | 'pov' | 'provas' | 'juiz' | 'cima';
export const ATOS: Ato[] = ['mesa', 'pov', 'provas', 'juiz', 'cima'];

export type Qualidade3D = 'baixa' | 'media' | 'alta';

export interface RetroMesaOptions {
  pixelSize?: number;
  /** Baralhos de demonstração usados somente pelo laboratório `/3d`. */
  pretas?: string[];
  brancas?: string[];
  /** Quando presente, a cena nasce como renderer da partida real. */
  mesaView?: MesaView;
  qualidade?: Qualidade3D;
  reducedMotion?: boolean;
  onSelfImpact?: (tipo: Reacao3D) => void;
}

interface ConfigAto {
  pos: [number, number, number];
  alvo: [number, number, number];
  dist: [number, number];
  polar: [number, number];
  fov: number;
}

const CONFIG_ATO: Record<Ato, ConfigAto> = {
  // enquadramento de laboratório: a mesa cheia (8 lugares) inteira no quadro
  mesa: { pos: [0, 4.8, 9.2], alvo: [0, 0.45, 0.25], dist: [4.5, 14], polar: [Math.PI / 5, Math.PI / 2.15], fov: 50 },
  // PRIMEIRA PESSOA de verdade: olho na altura da cabeça de quem senta na
  // cadeira vazia (az 0°), mirando o juiz do outro lado. FOV mais aberto
  // pra mesa + réus caberem; a mão em leque entra por baixo do quadro.
  pov: { pos: [0, 1.5, 5.0], alvo: [0, 1.0, -3.5], dist: [3, 10], polar: [0.7, 2.05], fov: 58 },
  // close nas provas lacradas
  provas: { pos: [0, 2.5, 3.6], alvo: [0, 0.05, 1.05], dist: [1.5, 9], polar: [Math.PI / 6, Math.PI / 2.1], fov: 50 },
  // encarando o juiz de perto, do meio da mesa
  juiz: { pos: [0, 1.7, -1.4], alvo: [0, 1.35, -5.15], dist: [2, 8], polar: [Math.PI / 4, Math.PI / 2.05], fov: 45 },
  // plano zenital dramático
  cima: { pos: [0, 9.2, 0.9], alvo: [0, 0, 0], dist: [5, 13], polar: [0.02, Math.PI / 2.3], fov: 50 },
};

// ── Fontes: recupera o nome real que o next/font registrou ────────────────────
function fontFamily(displayVar: string, fallback: string): string {
  if (typeof document === 'undefined') return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(displayVar).trim();
  return v || fallback;
}

// ── Texturas de carta desenhadas em canvas (mesma técnica do FDP) ─────────────
function drawCardTexture(text: string, dark: boolean): THREE.CanvasTexture {
  const W = 256;
  const H = Math.round((W * CARD_H) / CARD_W);
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d')!;

  const bg = dark ? '#17161a' : '#ffffff';
  const fg = dark ? '#f2efe9' : '#17161a';
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);
  // borda
  ctx.strokeStyle = dark ? '#f2efe9' : '#17161a';
  ctx.lineWidth = 10;
  ctx.strokeRect(8, 8, W - 16, H - 16);

  // texto com quebra de linha
  const display = fontFamily('--font-archivo-black', 'sans-serif');
  ctx.fillStyle = fg;
  ctx.font = `700 26px ${display}`;
  ctx.textBaseline = 'top';
  const maxW = W - 52;
  const words = text.split(' ');
  const lines: string[] = [];
  let line = '';
  for (const w of words) {
    const probe = line ? `${line} ${w}` : w;
    if (ctx.measureText(probe).width > maxW && line) {
      lines.push(line);
      line = w;
    } else {
      line = probe;
    }
  }
  if (line) lines.push(line);
  lines.slice(0, 7).forEach((l, i) => ctx.fillText(l, 26, 30 + i * 34));

  // rodapé de marca
  ctx.font = `700 16px ${display}`;
  ctx.fillStyle = fg;
  ctx.fillText('SEM PERDÃO', 26, H - 42);
  const w = ctx.measureText('SEM PERDÃO').width;
  ctx.fillStyle = '#ff3b2f';
  ctx.fillText('*', 26 + w + 2, H - 42);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  // NearestFilter: deixa o texto "serrilhar" junto com o resto — parte do charme
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  return tex;
}

/** Carimbo CULPADO — vermelho, torto, pronto pra esmagar a carta vencedora. */
function drawCarimboTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 96;
  const ctx = c.getContext('2d')!;
  ctx.strokeStyle = '#ff3b2f';
  ctx.lineWidth = 10;
  ctx.strokeRect(8, 8, 240, 80);
  ctx.fillStyle = '#ff3b2f';
  ctx.font = `700 44px ${fontFamily('--font-archivo-black', 'sans-serif')}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('CULPADO', 128, 52);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  return tex;
}

function drawBackTexture(): THREE.CanvasTexture {
  const W = 256;
  const H = Math.round((W * CARD_H) / CARD_W);
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#26252b';
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = 'rgba(242,239,233,0.85)';
  ctx.lineWidth = 8;
  ctx.strokeRect(10, 10, W - 20, H - 20);
  const display = fontFamily('--font-archivo-black', 'sans-serif');
  ctx.fillStyle = '#f2efe9';
  ctx.font = `700 34px ${display}`;
  ctx.textAlign = 'center';
  ctx.fillText('SP', W / 2, H / 2 - 4);
  ctx.fillStyle = '#ff3b2f';
  ctx.font = `700 60px ${display}`;
  ctx.fillText('*', W / 2, H / 2 + 52);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  return tex;
}

// ── Carta = caixa fina com frente/verso texturizados ──────────────────────────
interface Anim {
  alvoPos: THREE.Vector3;
  alvoRot: THREE.Euler;
  origemPos: THREE.Vector3;
  origemRot: THREE.Euler;
  t0: number; // segundos
  dur: number;
}

class Carta {
  group: THREE.Group;
  mesh: THREE.Mesh;
  readonly frente: THREE.Texture;
  viradaPraCima: boolean;
  texto = '';
  autor = '';
  azProva = 0; // ângulo do dono na mesa (VOCÊ = 360, pra julgar por último)
  private flipT = -1; // -1 = sem flip em andamento
  private baseY = 0;
  anim: Anim | null = null;

  constructor(frente: THREE.Texture, verso: THREE.Texture, corLateral: number) {
    this.frente = frente;
    const lado = new THREE.MeshLambertMaterial({ color: corLateral });
    const matFrente = new THREE.MeshLambertMaterial({ map: frente });
    const matVerso = new THREE.MeshLambertMaterial({ map: verso });
    const geom = new THREE.BoxGeometry(CARD_W, CARD_H, CARD_T);
    // ordem dos materiais do BoxGeometry: +x, -x, +y, -y, +z(frente), -z(verso)
    this.mesh = new THREE.Mesh(geom, [lado, lado, lado, lado, matFrente, matVerso]);
    this.mesh.rotation.x = -Math.PI / 2; // deitada na mesa, frente pra cima
    this.mesh.castShadow = true;
    this.group = new THREE.Group();
    this.group.add(this.mesh);
    this.viradaPraCima = true;
    this.mesh.userData.carta = this;
  }

  deitarVirada() {
    this.mesh.rotation.x = Math.PI / 2; // verso pra cima
    this.viradaPraCima = false;
  }

  flip() {
    if (this.flipT >= 0) return;
    this.flipT = 0;
  }

  tick(dt: number) {
    // animação de flip: gira em torno do eixo da própria carta com um pulinho
    if (this.flipT >= 0) {
      this.flipT += dt / 0.5;
      const t = Math.min(this.flipT, 1);
      const e = 1 - Math.pow(1 - t, 3); // easeOutCubic
      const de = this.viradaPraCima ? Math.PI : -Math.PI;
      this.mesh.rotation.x = (this.viradaPraCima ? -Math.PI / 2 : Math.PI / 2) + de * e;
      this.group.position.y = this.baseY + Math.sin(t * Math.PI) * 0.6;
      if (t >= 1) {
        this.flipT = -1;
        this.viradaPraCima = !this.viradaPraCima;
        this.group.position.y = this.baseY;
      }
    } else {
      this.group.position.y += (this.baseY - this.group.position.y) * Math.min(1, dt * 12);
    }
  }

  fixarBase() {
    this.baseY = this.group.position.y;
  }
}

/**
 * A lousa do placar: giz sobre quadro quase preto. Tracinhos em grupos de 5;
 * acima de 18 pontos vira número pra não estourar a linha. O líder ganha um
 * sublinhado vermelho — é quem está mais perto da sentença final.
 */
function drawLousa(
  linhas: { nome: string; score: number; lider: boolean; juiz: boolean }[],
  meta: number
): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 384;
  const x = c.getContext('2d')!;
  x.fillStyle = '#202024';
  x.fillRect(0, 0, 512, 384);
  // poeira de giz
  for (let i = 0; i < 480; i++) {
    x.fillStyle = `rgba(242,239,233,${(Math.random() * 0.05).toFixed(3)})`;
    x.fillRect(Math.floor(Math.random() * 512), Math.floor(Math.random() * 384), 2, 2);
  }
  const display = fontFamily('--font-archivo-black', 'sans-serif');
  x.fillStyle = 'rgba(242,239,233,0.92)';
  x.font = `700 34px ${display}`;
  x.textBaseline = 'top';
  x.fillText('PLACAR', 26, 16);
  x.strokeStyle = 'rgba(242,239,233,0.55)';
  x.lineWidth = 3;
  x.beginPath();
  x.moveTo(24, 58);
  x.lineTo(206 + Math.random() * 10, 61);
  x.stroke();
  x.font = `700 19px ${display}`;
  x.fillStyle = 'rgba(242,239,233,0.55)';
  x.textAlign = 'right';
  x.fillText(`META ${meta}`, 488, 24);
  x.textAlign = 'left';

  linhas.slice(0, 8).forEach((linha, i) => {
    const y = 82 + i * 36;
    const alpha = 0.76 + Math.random() * 0.16;
    x.font = `700 21px ${display}`;
    x.fillStyle = `rgba(242,239,233,${alpha})`;
    const nome = (linha.juiz ? '› ' : '') + linha.nome.toLocaleUpperCase('pt-BR');
    x.fillText(nome.slice(0, 13), 26, y);
    const baseX = 246;
    if (linha.score > 18) {
      x.font = `700 26px ${display}`;
      x.fillText(String(linha.score), baseX, y - 3);
    } else {
      x.strokeStyle = `rgba(242,239,233,${alpha})`;
      x.lineWidth = 3;
      for (let s = 0; s < linha.score; s++) {
        const grupo = Math.floor(s / 5);
        const dentro = s % 5;
        const inicioGrupo = baseX + grupo * 66;
        x.beginPath();
        if (dentro === 4) {
          // o quinto risco corta o grupo na diagonal
          x.moveTo(inicioGrupo - 4, y + 20);
          x.lineTo(inicioGrupo + 42, y - 2);
        } else {
          const gx = inicioGrupo + dentro * 12;
          x.moveTo(gx + (Math.random() - 0.5) * 2, y - 2);
          x.lineTo(gx + (Math.random() - 0.5) * 3, y + 21);
        }
        x.stroke();
      }
    }
    if (linha.lider && linha.score > 0) {
      x.strokeStyle = 'rgba(255,59,47,0.85)';
      x.lineWidth = 4;
      x.beginPath();
      x.moveTo(24, y + 26);
      x.lineTo(214, y + 28);
      x.stroke();
    }
  });

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  return tex;
}

interface FlocoConfete {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  rot: THREE.Euler;
  rotVel: THREE.Vector3;
}

interface ReacaoVoo {
  group: THREE.Group;
  inicio: THREE.Vector3;
  controle: THREE.Vector3;
  fim: THREE.Vector3;
  t0: number;
  dur: number;
  giro: THREE.Vector3;
  aoTerminar?: () => void;
}

interface BalaoFala {
  mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  textura: THREE.Texture;
  t0: number;
  dur: number;
}

function descartarObjeto(group: THREE.Object3D) {
  group.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    o.geometry.dispose();
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    mats.forEach((m) => m.dispose());
  });
  group.removeFromParent();
}

// ── Cena ──────────────────────────────────────────────────────────────────────
export class RetroMesa {
  private stage: TabletopStage;
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private rt: THREE.WebGLRenderTarget;
  private blitScene = new THREE.Scene();
  private blitCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private blitMat: THREE.ShaderMaterial;
  private cartas: Carta[] = [];
  private provas: Carta[] = [];
  private cartaPreta: Carta | null = null;
  private versoTex: THREE.CanvasTexture | null = null;
  private spotCulpado!: THREE.SpotLight;
  private carimbo: THREE.Mesh | null = null;
  private culpadoT = -1;
  private reus: Reu[] = [];
  private reacoesVoo: ReacaoVoo[] = [];
  private baloesFala: BalaoFala[] = [];
  private pendulo!: THREE.Group;
  private lampadaVisual!: THREE.Group;
  private spot!: THREE.SpotLight;
  private brilho!: THREE.PointLight;
  private bulbo!: THREE.Mesh;
  private frisoMat!: THREE.MeshLambertMaterial;
  private recorteVermelho!: THREE.DirectionalLight;
  private hemi!: THREE.HemisphereLight;
  private preench!: THREE.DirectionalLight;
  private holofoteVitoria!: THREE.SpotLight;
  private vitoria: {
    inicioT: number;
    vencedores: Reu[];
    confete: THREE.InstancedMesh | null;
    flocos: FlocoConfete[];
    proximaFesta: number;
    somTocado: boolean;
  } | null = null;
  private luzGeral = 1; // 1 = sala normal; ~0.1 = blackout da vitória
  private lousa: { grupo: THREE.Group; quadro: THREE.Mesh; tex: THREE.CanvasTexture | null } | null = null;
  private lousaSignature = '';
  private blinkAte = 0;
  private proximoCaos = 3;
  private martelo!: THREE.Group;
  private juizReu: Reu | null = null;
  private marteloT = -1;
  private shake = 0;
  private impactoShake = 0;
  private assentosJogadores: { nome: string; az: number }[] = [];
  private reuPorId = new Map<number, Reu>();
  private selfReu: Reu | null = null;
  private nomePorId = new Map<number, string>();
  /**
   * Quem já tombou no ato final. Vive na cena, não no `Reu`, porque `rebuildSeats`
   * descarta e recria os avatares (uma desconexão no game-end basta) e a queda
   * precisa continuar de pé — ou melhor, continuar caída.
   */
  private tombados = new Set<number>();
  /**
   * Props modelados no Blender. Carregam depois da cena montar, então tudo aqui
   * é oportunista: quem chega antes usa a primitiva, e a mesa nunca espera o
   * download para existir.
   */
  private readonly props = new PropLibrary();
  /** Guarda o carregamento assíncrono dos props contra uma cena já descartada. */
  private descartado = false;
  private proofBundles = new Map<string, Carta[]>();
  private proofByCard = new Map<Carta, string>();
  private proofStateSignatures = new Map<string, string>();
  private seatSignature = '';
  private roundSignature = '';
  private verdictProofId: string | null = null;
  private deadlineEndsAt = 0;
  private deadlineDurationMs = 0;
  private reducedMotion = false;
  private onSelfImpact: ((tipo: Reacao3D) => void) | null = null;
  private realMode = false;
  private selfId: number | null = null;
  private presentationPhase: MesaView['phase'] | 'lab' = 'lab';
  private shakeOffset = new THREE.Vector3();
  private julgamento: {
    fila: Carta[];
    idx: number;
    proximaT: number;
    onRevela: (info: { autor: string; texto: string }) => void;
    onFim: () => void;
  } | null = null;
  private onCulpadoCb: ((nome: string) => void) | null = null;
  private atoAtual: Ato = 'mesa';
  private povAnchor = new THREE.Vector3(...CONFIG_ATO.pov.pos);
  private povDirection = new THREE.Vector3();
  private pixelSize: number;
  private canvas: HTMLCanvasElement;
  private texturas: THREE.Texture[] = [];
  private elapsed = 0;

  constructor(canvas: HTMLCanvasElement, opts: RetroMesaOptions) {
    this.canvas = canvas;
    this.canvas.style.cursor = 'grab';
    this.pixelSize = opts.pixelSize ?? 4;
    this.reducedMotion = opts.reducedMotion
      ?? globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches
      ?? false;
    this.onSelfImpact = opts.onSelfImpact ?? null;
    this.realMode = !!opts.mesaView;
    this.selfId = opts.mesaView?.selfId ?? null;

    const stageQuality: Record<Qualidade3D, StageQuality> = {
      baixa: 'performance',
      media: 'balanced',
      alta: 'cinematic',
    };
    this.stage = new TabletopStage(canvas, {
      quality: stageQuality[opts.qualidade ?? 'media'],
      clearColor: 0x1b1a21,
      fogColor: 0x1b1a21,
      reducedMotion: this.reducedMotion,
      powerPreference: opts.qualidade === 'alta' ? 'high-performance' : 'low-power',
      near: 0.1,
      far: 60,
      fov: CONFIG_ATO.mesa.fov,
      autoStart: false,
      disposeRoot: false,
      navigation: false,
      postProcess: false,
    });
    this.stage.setResolutionProfile({ pixelScale: this.pixelSize, maxDevicePixelRatio: 1 });
    this.renderer = this.stage.renderer;
    this.scene = this.stage.scene;
    this.camera = this.stage.camera;
    this.renderer.shadowMap.enabled = opts.qualidade !== 'baixa';
    this.renderer.shadowMap.type = THREE.BasicShadowMap; // sombra dura = retrô

    this.camera.position.set(...CONFIG_ATO.mesa.pos);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.target.set(...CONFIG_ATO.mesa.alvo);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    // A órbita continua livre, mas a composição não foge sozinha nem transforma
    // a mão em uma cerca lateral enquanto o usuário avalia a cena.
    this.controls.autoRotate = false;
    this.controls.minDistance = 4.5;
    this.controls.maxDistance = 13;
    this.controls.maxPolarAngle = Math.PI / 2.15;
    this.controls.minPolarAngle = Math.PI / 5;
    this.controls.enablePan = false;

    // névoa fecha o vazio ao redor da mesa — o breu É o porão
    this.scene.background = new THREE.Color(0x1b1a21);
    this.scene.fog = new THREE.Fog(0x1b1a21, 16, 40);

    this.montarCenario();
    this.montarLampada();
    this.montarReus(opts.mesaView);
    this.montarCartas(opts.pretas ?? [], opts.brancas ?? [], !!opts.mesaView);

    // ── passe de pixelização ──
    this.rt = new THREE.WebGLRenderTarget(2, 2, {
      magFilter: THREE.NearestFilter,
      minFilter: THREE.NearestFilter,
      depthBuffer: true,
    });
    this.blitMat = new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: { value: this.rt.texture },
        tBayer: { value: this.criarBayer() },
        uLevels: { value: 12.0 },
        uDither: { value: 0.3 },
        uPixel: { value: this.pixelSize },
        uTime: { value: 0 },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D tDiffuse;
        uniform sampler2D tBayer;
        uniform float uLevels;
        uniform float uDither;
        uniform float uPixel;
        uniform float uTime;
        varying vec2 vUv;
        void main() {
          // ── vidro do tubo: curvatura de barril ──
          vec2 d = vUv - 0.5;
          float r2 = dot(d, d);
          vec2 uv = 0.5 + d * (1.0 + 0.055 * r2);
          if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
            gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
            return;
          }
          // aberração cromática crescendo pra borda
          vec2 ca = d * r2 * 0.009;
          vec3 c;
          c.r = texture2D(tDiffuse, uv + ca).r;
          c.g = texture2D(tDiffuse, uv).g;
          c.b = texture2D(tDiffuse, uv - ca).b;
          // dithering ordenado (Bayer 4x4 por pixelão) + posterização de cor
          float limiar = texture2D(tBayer, gl_FragCoord.xy / (4.0 * uPixel)).r - 0.5;
          c += limiar * (uDither / uLevels);
          c = floor(c * uLevels + 0.5) / uLevels;
          // fósforo nunca apaga: levanta os pretos (o escuro fica VISÍVEL)
          c = c * 0.95 + vec3(0.05);
          // máscara RGB sutil (grade de fósforo) por coluna de pixelão
          float m = mod(floor(gl_FragCoord.x / uPixel), 3.0);
          c *= vec3(0.992) + 0.016 * vec3(
            m == 0.0 ? 1.0 : 0.0,
            m == 1.0 ? 1.0 : 0.0,
            m == 2.0 ? 1.0 : 0.0
          );
          // scanlines alinhadas ao pixelão
          float linha = mod(floor(gl_FragCoord.y / uPixel), 2.0);
          c *= 1.0 - 0.028 * linha;
          // vinheta presente, mas sem engolir a leitura nos assentos laterais
          float vig = smoothstep(0.85, 0.3, length(d) * 1.25);
          c *= 0.9 + 0.1 * vig;
          // grão animado
          float g = fract(sin(dot(gl_FragCoord.xy + mod(uTime, 10.0) * 137.0, vec2(12.9898, 78.233))) * 43758.5453);
          c += (g - 0.5) * 0.012;
          // faixa rolando + tremidinha de sinal fraco
          c *= 1.0 + 0.009 * sin(uv.y * 9.42 - uTime * 1.1);
          c *= 1.0 + 0.003 * sin(uTime * 84.0);
          // cantos arredondados do vidro
          vec2 q = abs(d) * 2.0;
          c *= smoothstep(1.03, 0.95, max(q.x, q.y) + 0.14 * min(q.x, q.y));
          gl_FragColor = vec4(c, 1.0);
        }
      `,
      depthTest: false,
      depthWrite: false,
    });
    this.blitScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.blitMat));

    this.stage.addResizeHandler((width, height) => this.resizePipeline(width, height));
    this.stage.addUpdater(this.tick);
    this.stage.setFrameRenderer(this.renderFrame);
    window.addEventListener('pointerdown', this.onPrimeiroGesto);
    if (opts.mesaView) this.syncMesa(opts.mesaView);
    this.stage.start();
    void this.carregarProps();
  }

  /**
   * Busca os props modelados em segundo plano e substitui as primitivas que já
   * estão em cena. Nada aqui bloqueia a montagem: se o download falhar, a mesa
   * continua com a geometria procedural e ninguém percebe.
   */
  private async carregarProps(): Promise<void> {
    const pronto = await this.props.load(TRIBUNAL_PROPS_MANIFEST_URL);
    if (!pronto || this.descartado) return;
    this.trocarMartelo();
  }

  private trocarMartelo(): void {
    const modelado = this.props.criar('gavel');
    if (!modelado || !this.martelo) return;
    // Preserva posição e rotação: o martelo já foi colocado ao lado do juiz, e
    // `posicionarMartelo` continua mandando nele depois da troca.
    const posicao = this.martelo.position.clone();
    const rotacao = this.martelo.rotation.clone();
    for (const filho of [...this.martelo.children]) {
      this.martelo.remove(filho);
      descartarObjeto(filho);
    }
    this.martelo.add(modelado);
    this.martelo.position.copy(posicao);
    this.martelo.rotation.copy(rotacao);
  }

  private criarBayer(): THREE.DataTexture {
    // matriz de Bayer 4x4 clássica, normalizada 0..1
    const m = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
    const data = new Uint8Array(m.map((v) => Math.round(((v + 0.5) / 16) * 255)));
    const tex = new THREE.DataTexture(data, 4, 4, THREE.RedFormat);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.needsUpdate = true;
    return tex;
  }

  /** Textura de ruído grayscale (feltro/concreto) — o `color` do material tinge. */
  private texRuido(base: string, forca: number, repetir: number): THREE.CanvasTexture {
    const c = document.createElement('canvas');
    c.width = 128;
    c.height = 128;
    const x = c.getContext('2d')!;
    x.fillStyle = base;
    x.fillRect(0, 0, 128, 128);
    for (let i = 0; i < 2600; i++) {
      const a = (Math.random() * forca).toFixed(3);
      x.fillStyle = Math.random() < 0.5 ? `rgba(0,0,0,${a})` : `rgba(255,255,255,${a})`;
      x.fillRect(Math.floor(Math.random() * 128), Math.floor(Math.random() * 128), 1, 1);
    }
    const t = new THREE.CanvasTexture(c);
    t.wrapS = THREE.RepeatWrapping;
    t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repetir, repetir);
    t.magFilter = THREE.NearestFilter;
    t.minFilter = THREE.NearestFilter;
    t.generateMipmaps = false;
    this.texturas.push(t);
    return t;
  }

  private montarCenario() {
    // Tribunal do Porão v2: cena VISÍVEL — o clima sinistro vem do filtro de
    // TV (scanlines/vinheta/grão no shader) e da lâmpada, não da escuridão.
    // Campos porque o ato da vitória apaga a sala inteira (blackout suave).
    this.hemi = new THREE.HemisphereLight(0xfff0dc, 0x6b6a72, 2.4);
    this.preench = new THREE.DirectionalLight(COR.paper, 1.1);
    this.preench.position.set(4, 6, 7);
    // Vermelho apagado no cotidiano; só acende quando existe veredito.
    this.recorteVermelho = new THREE.DirectionalLight(COR.red, 0);
    this.recorteVermelho.position.set(-6, 2.5, -6);
    this.scene.add(this.hemi, this.preench, this.recorteVermelho);

    // o holofote da vitória: um facho só, apagado até o game-end
    this.holofoteVitoria = new THREE.SpotLight(0xfff4e0, 0, 0, 0.34, 0.4, 2);
    this.holofoteVitoria.position.set(0, 7, 0);
    this.scene.add(this.holofoteVitoria, this.holofoteVitoria.target);

    // o spotlight do culpado: apagado até o juiz cravar o martelo
    this.spotCulpado = new THREE.SpotLight(COR.red, 0, 0, 0.32, 0.35, 2);
    this.spotCulpado.position.set(0, 6, 0);
    this.scene.add(this.spotCulpado, this.spotCulpado.target);

    // mesa: cilindro baixo e largo; o friso só fica vermelho no veredito
    const tampo = new THREE.Mesh(
      new THREE.CylinderGeometry(4.4, 4.4, 0.5, 24),
      new THREE.MeshLambertMaterial({ color: COR.mesa, map: this.texRuido('#cfcfcf', 0.13, 5) })
    );
    tampo.position.y = -0.26;
    tampo.receiveShadow = true;
    this.frisoMat = new THREE.MeshLambertMaterial({ color: COR.panel });
    const friso = new THREE.Mesh(
      new THREE.TorusGeometry(4.4, 0.055, 6, 48),
      this.frisoMat
    );
    friso.rotation.x = Math.PI / 2;
    friso.position.y = -0.01;
    const pe = new THREE.Mesh(
      new THREE.CylinderGeometry(1.1, 1.5, 2.4, 12),
      new THREE.MeshLambertMaterial({ color: COR.panel })
    );
    pe.position.y = -1.7;
    const chao = new THREE.Mesh(
      new THREE.CircleGeometry(24, 32),
      new THREE.MeshLambertMaterial({ color: 0x1c1b21, map: this.texRuido('#c8c8c8', 0.18, 16) })
    );
    chao.rotation.x = -Math.PI / 2;
    chao.position.y = -2.9;
    this.scene.add(tampo, friso, pe, chao);

    // poeira flutuando — profundidade barata
    const n = 130;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 16;
      pos[i * 3 + 1] = Math.random() * 5;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 16;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const poeira = new THREE.Points(
      geo,
      new THREE.PointsMaterial({ color: 0x6b6a72, size: 0.035, transparent: true, opacity: 0.7 })
    );
    this.scene.add(poeira);
  }

  /** A lâmpada pendurada — a personagem-narradora do porão (conceito §2.2). */
  private montarLampada() {
    this.pendulo = new THREE.Group();
    this.lampadaVisual = new THREE.Group();
    this.pendulo.position.set(0, 8.2, 0);
    const fio = new THREE.Mesh(
      new THREE.CylinderGeometry(0.02, 0.02, 4.2, 5),
      new THREE.MeshLambertMaterial({ color: 0x0a0a0c })
    );
    fio.position.y = -2.1;
    const cupula = new THREE.Mesh(
      new THREE.ConeGeometry(0.42, 0.32, 8),
      new THREE.MeshLambertMaterial({ color: COR.panel, flatShading: true })
    );
    cupula.position.y = -4.2;
    this.bulbo = new THREE.Mesh(
      new THREE.SphereGeometry(0.13, 8, 6),
      new THREE.MeshBasicMaterial({ color: 0xfff4e0 })
    );
    this.bulbo.position.y = -4.42;
    // cone calculado pra molhar a mesa inteira E as cabeças dos réus (r=5.15)
    this.spot = new THREE.SpotLight(0xfff4e0, 230, 0, 1.12, 0.5, 2);
    this.spot.position.y = -4.4;
    this.spot.castShadow = true;
    this.spot.shadow.mapSize.set(512, 512);
    this.spot.shadow.bias = -0.002;
    this.spot.target.position.set(0, -8.2, 0); // aponta reto pra baixo e acompanha o balanço
    this.brilho = new THREE.PointLight(0xffe9c4, 10, 9, 2);
    this.brilho.position.y = -4.3;
    // O casco pode sumir no plano zenital sem apagar as luzes que dão volume
    // à mesa. Nos demais atos ele volta exatamente ao mesmo pêndulo.
    this.lampadaVisual.add(fio, cupula, this.bulbo);
    this.pendulo.add(this.lampadaVisual, this.spot, this.spot.target, this.brilho);
    this.scene.add(this.pendulo);
  }

  /** Os réus sentados + o martelo do juiz à espera do veredito. */
  private montarReus(view?: MesaView) {
    // MESA CHEIA: 8 lugares. Azimute 0° = a SUA cadeira (POV); os outros 7
    // se espalham a cada 45°. O juiz senta sempre em frente a você (180°).
    // Com menos jogadores, é só omitir assentos — o layout máximo é este.
    const assentos: { id?: number; nome: string; az: number; juiz?: boolean; manequim?: boolean; appearance?: MesaSeatView['appearance'] }[] = view
      ? view.seats.map((seat) => ({
            id: seat.id,
            nome: seat.name,
            az: THREE.MathUtils.radToDeg(seat.azimuthRad),
            juiz: seat.isJudge,
            manequim: !seat.connected,
            appearance: seat.appearance,
          }))
      : [
          { nome: 'GABS', az: 45 },
          { nome: 'VANZO', az: 90 },
          { nome: 'PPVAZ', az: 135 },
          { nome: 'NATH', az: 180, juiz: true },
          { nome: 'RANDO', az: 225, manequim: true },
          { nome: 'POLES', az: 270 },
          { nome: 'CAROL', az: 315 },
        ];
    assentos.forEach((a, i) => {
      const r = new Reu(a.nome, avatarColor(i + 1), a);
      const rad = (a.az * Math.PI) / 180;
      const R = 5.15;
      r.group.position.set(Math.sin(rad) * R, 0, Math.cos(rad) * R);
      r.group.lookAt(0, 0, 0);
      this.scene.add(r.group);
      this.reus.push(r);
      if (a.id !== undefined) {
        this.reuPorId.set(a.id, r);
        this.nomePorId.set(a.id, a.nome);
        if (a.id === view?.selfId) this.selfReu = r;
      }
      if (a.juiz) this.juizReu = r;
    });
    // quem joga carta nesta rodada: todos menos o juiz (bots inclusos)
    this.assentosJogadores = assentos.filter((a) => !a.juiz).map(({ nome, az }) => ({ nome, az }));

    const martelo = new THREE.Group();
    const cabo = new THREE.Mesh(
      new THREE.CylinderGeometry(0.045, 0.045, 0.55, 6),
      new THREE.MeshLambertMaterial({ color: COR.panel, flatShading: true })
    );
    cabo.rotation.z = Math.PI / 2;
    const cabecaMartelo = new THREE.Mesh(
      new THREE.CylinderGeometry(0.11, 0.11, 0.3, 6),
      new THREE.MeshLambertMaterial({ color: COR.red, flatShading: true })
    );
    cabecaMartelo.rotation.x = Math.PI / 2;
    cabecaMartelo.position.x = -0.25;
    martelo.add(cabo, cabecaMartelo);
    martelo.children.forEach((m) => (m.castShadow = true));
    martelo.position.set(0.7, 0.08, -3.4);
    martelo.rotation.y = 0.5;
    this.scene.add(martelo);
    this.martelo = martelo;
    if (view) this.posicionarMartelo(view.seats, view.judgeId);
  }

  private posicionarMartelo(seats: readonly MesaSeatView[], judgeId: number | null) {
    const judge = judgeId === null ? null : seats.find((seat) => seat.id === judgeId);
    const az = judge?.azimuthRad ?? Math.PI;
    // Fica na borda interna, levemente à direita do juiz. Se o juiz é o próprio
    // jogador, o martelo aparece na beirada inferior do POV.
    const raio = 3.45;
    const lateral = 0.45;
    this.martelo.position.set(
      Math.sin(az) * raio + Math.cos(az) * lateral,
      0.08,
      Math.cos(az) * raio - Math.sin(az) * lateral
    );
    this.martelo.rotation.y = az + 0.5;
  }

  private rebuildSeats(view: MesaView) {
    const signature = view.seats
      .map((seat) => `${seat.id}:${seat.name}:${seat.azimuthRad.toFixed(4)}:${seat.isJudge ? 1 : 0}:${seat.connected ? 1 : 0}`)
      .join('|');
    if (signature === this.seatSignature) {
      this.posicionarMartelo(view.seats, view.judgeId);
      this.juizReu = view.judgeId === null ? null : (this.reuPorId.get(view.judgeId) ?? null);
      return;
    }
    this.seatSignature = signature;
    for (const reu of this.reus) {
      reu.dispose();
      descartarObjeto(reu.group);
    }
    this.reus = [];
    this.reuPorId.clear();
    this.nomePorId.clear();
    this.juizReu = null;
    this.selfReu = null;

    view.seats.forEach((seat, index) => {
      const reu = new Reu(seat.name, avatarColor(seat.id || index + 1), {
        juiz: seat.isJudge,
        manequim: !seat.connected,
        appearance: seat.appearance,
      });
      const raio = 5.15;
      reu.group.position.set(
        Math.sin(seat.azimuthRad) * raio,
        0,
        Math.cos(seat.azimuthRad) * raio
      );
      reu.group.lookAt(0, 0, 0);
      this.scene.add(reu.group);
      this.reus.push(reu);
      this.reuPorId.set(seat.id, reu);
      this.nomePorId.set(seat.id, seat.name);
      if (seat.isJudge) this.juizReu = reu;
    });
    const selfSeat = view.seats.find((seat) => seat.isSelf);
    this.selfReu = selfSeat ? (this.reuPorId.get(selfSeat.id) ?? null) : null;
    if (this.selfReu) this.selfReu.group.visible = this.atoAtual !== 'pov';
    this.posicionarMartelo(view.seats, view.judgeId);
    // corpos novos, mesma sentença: quem já tinha tombado nasce caído, sem
    // reencenar a queda (senão a mesa inteira desaba de novo a cada rebuild)
    for (const id of this.tombados) this.reuPorId.get(id)?.tombar(true);
    // réus foram reconstruídos: a vitória (se ativa) renasce no próximo sync
    this.encerrarVitoria();
  }

  // ── Ferramentas internas de calibração (sem painel na UI final) ────────────

  /** Todos os réus fazem a mesma cara — pra avaliar as expressões. */
  testarExpressao(e: Expressao) {
    for (const r of this.reus) r.setExpressao(e);
  }

  /** Todos os réus executam a ação ao mesmo tempo — visível de qualquer ângulo. */
  testarAcao(a: Acao) {
    for (const r of this.reus) r.acao(a);
  }

  /** Arremessa uma reação física de um réu até o outro lado da mesa. */
  testarReacao(tipo: Reacao3D) {
    const vivos = this.reus.filter((r) => !r.manequim);
    const autor = vivos[Math.floor(Math.random() * vivos.length)];
    if (!autor) return;

    const group = this.criarObjetoReacao(tipo);
    const inicio = autor.group.position.clone().multiplyScalar(0.82);
    inicio.y = 1.12;
    const fim = new THREE.Vector3(
      -inicio.x * 0.72 + (Math.random() - 0.5) * 1.1,
      0.16,
      -inicio.z * 0.72 + (Math.random() - 0.5) * 1.1
    );
    const controle = inicio.clone().lerp(fim, 0.5);
    controle.y = 3.1 + Math.random() * 0.8;
    group.position.copy(inicio);
    this.scene.add(group);
    this.reacoesVoo.push({
      group,
      inicio,
      controle,
      fim,
      t0: this.elapsed,
      dur: 1.05 + Math.random() * 0.2,
      giro: new THREE.Vector3(
        5 + Math.random() * 4,
        7 + Math.random() * 5,
        4 + Math.random() * 5
      ),
    });
    autor.acao('festejar');
    somArremesso();
  }

  /**
   * Balão billboard de chat sobre um participante. Funciona também no POV:
   * a fala acompanha a rotação da câmera e não depende da UI da página.
   */
  mostrarFala(nomeAutor: string, texto: string, duracao = 2.6): boolean {
    const vemDaCadeiraPov = nomeAutor === 'VOCÊ';
    const autor = vemDaCadeiraPov ? this.selfReu : this.reus.find((r) => r.nome === nomeAutor);
    const fala = texto.trim();
    if ((!autor && !vemDaCadeiraPov) || !fala) return false;
    // O próprio assento fica colado ao near plane desta câmera. No POV a
    // página já desenha a fala na lente; criar um plano aqui cobriria a sala.
    if (vemDaCadeiraPov && this.atoAtual === 'pov') return false;

    // Evita que uma rajada de chat acumule planos/texturas até o GC alcançar.
    if (this.baloesFala.length >= 6) {
      const antigo = this.baloesFala.shift();
      if (antigo) this.descartarBalao(antigo);
    }

    const textura = this.criarTexturaBalao(fala);
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1.9, 0.95), new THREE.MeshBasicMaterial({
      map: textura,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      fog: false,
      side: THREE.DoubleSide,
    }));
    if (autor) {
      mesh.position.copy(autor.group.position).multiplyScalar(0.78);
      // Baixo o bastante para não cortar no topo mesmo nos assentos do fundo.
      mesh.position.y = 2.5;
    } else {
      // A câmera ocupa o oitavo assento. Em planos externos, a fala aparece
      // sobre essa cadeira; no POV a UI 2D mantém a própria mensagem legível.
      mesh.position.set(0, 2.0, 4.0);
    }
    mesh.quaternion.copy(this.camera.quaternion);
    mesh.renderOrder = 20;
    this.scene.add(mesh);
    this.baloesFala.push({
      mesh,
      textura,
      t0: this.elapsed,
      dur: Math.min(8, Math.max(1, duracao)),
    });
    autor?.setExpressao('desprezo');
    somBalao();
    return true;
  }

  /** Nome curto usado pela ponte de chat da partida real. */
  falar(nomeAutor: string, texto: string, duracao = 2.6): boolean {
    return this.mostrarFala(nomeAutor, texto, duracao);
  }

  /**
   * Reação efêmera sobre o autor, usando o mesmo billboard e ciclo de vida
   * das falas. Mantém emojis fora do DOM e visíveis durante POV/julgamento.
   */
  reagir(nomeAutor: string, emoji: string, duracao = 1.8): boolean {
    const exibiu = this.mostrarFala(nomeAutor, emoji, duracao);
    if (!exibiu) return false;
    const autor = this.reus.find((r) => r.nome === nomeAutor);
    autor?.setExpressao(/[😂🤣😆❤️🌹]/u.test(emoji) ? 'riso' : 'choque');
    return true;
  }

  falarJogador(playerId: number, texto: string, duracao = 2.6): boolean {
    if (playerId === this.selfId) return this.mostrarFala('VOCÊ', texto, duracao);
    const nome = this.nomePorId.get(playerId);
    return nome ? this.mostrarFala(nome, texto, duracao) : false;
  }

  reagirJogador(playerId: number, emoji: string, duracao = 1.8): boolean {
    if (playerId === this.selfId) return this.reagir('VOCÊ', emoji, duracao);
    const nome = this.nomePorId.get(playerId);
    return nome ? this.reagir(nome, emoji, duracao) : false;
  }

  /** Executa o vocabulário neutro de `TableActor` no cultista real da mesa. */
  playActorIntent(
    playerId: number,
    value: ActorIntent | Partial<ActorIntentCommand> & { intent: ActorIntent }
  ): boolean {
    const reu = this.reuPorId.get(playerId);
    const command = normalizeActorIntentCommand(value);
    if (!reu || !command) return false;
    // `collapse` é terminal e precisa ser lembrado pela cena, não só pelo ator.
    if (command.intent === 'collapse') return this.derrubarReu(playerId);
    const action = ACTOR_INTENT_ACTION[command.intent];
    if (action) reu.acao(action);
    if (command.intent === 'idle') reu.setExpressao('neutro');
    if (command.intent === 'sleep') reu.setExpressao('sono');
    return true;
  }

  /**
   * Apaga um cultista no ato final. `instantaneo` é para quem chega com a cena
   * já decidida (reconexão) e não deve ver a queda acontecer de novo.
   */
  derrubarReu(playerId: number, instantaneo = false): boolean {
    const reu = this.reuPorId.get(playerId);
    if (!reu) return false;
    const novo = !this.tombados.has(playerId);
    this.tombados.add(playerId);
    reu.tombar(instantaneo);
    if (novo && !instantaneo) this.tremor(0.11);
    return true;
  }

  /** Partida nova / saiu do game-end: a mesa inteira se levanta. */
  levantarTodos() {
    if (!this.tombados.size) return;
    this.tombados.clear();
    for (const reu of this.reus) reu.levantar();
  }

  /**
   * O plano do sobrevivente: corte seco para o outro lado da mesa, atravessando
   * os corpos caídos até quem ficou de pé no facho. É deliberadamente ABERTO —
   * um close no vencedor esconderia justamente o que dá sentido à cena.
   */
  planoFinal(playerId: number): boolean {
    const reu = this.reuPorId.get(playerId);
    if (!reu) return false;
    const p = reu.group.position.clone();
    const az = Math.atan2(p.x, p.z);
    const paraCentro = new THREE.Vector3(-Math.sin(az), 0, -Math.cos(az));
    const olho = p.clone().addScaledVector(paraCentro, 8.2);
    olho.y = 2.15;
    const alvo = new THREE.Vector3(p.x * 0.95, 1.2, p.z * 0.95);

    this.atoAtual = 'mesa';
    this.controls.enableZoom = true;
    this.controls.enablePan = false;
    this.controls.rotateSpeed = 1;
    this.controls.minAzimuthAngle = -Infinity;
    this.controls.maxAzimuthAngle = Infinity;
    this.controls.minPolarAngle = 0.2;
    this.controls.maxPolarAngle = Math.PI / 2;
    this.controls.minDistance = 3;
    this.controls.maxDistance = 16;
    this.lampadaVisual.visible = true;
    this.cortarPara(olho, alvo, this.camera.aspect < 0.9 ? 50 : 42);
    this.tremor(0.2);
    return true;
  }

  /** Projétil multiplayer com origem e alvo reais, inclusive a lente do POV. */
  arremessarEntre(sourceId: number, targetId: number, tipo: Reacao3D): boolean {
    const autor = this.reuPorId.get(sourceId);
    const alvo = this.reuPorId.get(targetId);
    const sourceIsSelf = sourceId === this.selfId;
    const targetIsSelf = targetId === this.selfId;
    if ((!autor && !sourceIsSelf) || (!alvo && !targetIsSelf)) return false;
    if (this.reacoesVoo.length >= 8) {
      const antiga = this.reacoesVoo.shift();
      if (antiga) descartarObjeto(antiga.group);
    }
    const group = this.criarObjetoReacao(tipo);
    const inicio = autor
      ? autor.group.position.clone().multiplyScalar(0.86).setY(1.18)
      : new THREE.Vector3(0, 1.2, 4.35);
    const fim = alvo
      ? alvo.group.position.clone().multiplyScalar(0.92).setY(1.1)
      : new THREE.Vector3(0, 1.45, 4.72);
    const controle = inicio.clone().lerp(fim, 0.5).setY(3.0);
    group.position.copy(inicio);
    this.scene.add(group);
    this.reacoesVoo.push({
      group,
      inicio,
      controle,
      fim,
      t0: this.elapsed,
      dur: this.reducedMotion ? 0.45 : 0.75,
      giro: new THREE.Vector3(7, 9, 6),
      aoTerminar: () => {
        if (alvo) {
          alvo.receberImpacto(tipo);
        }
        if (targetIsSelf) {
          this.impactoShake = this.reducedMotion ? 0.025 : (tipo === 'rosa' ? 0.035 : 0.18);
          this.onSelfImpact?.(tipo);
        }
        somSoco();
      },
    });
    autor?.acao('festejar');
    somArremesso();
    return true;
  }

  /** Balão de laboratório; usa a mesma API que receberá o chat real. */
  testarFala() {
    const falas = ['EU EXIJO JUSTIÇA!', 'ISSO É CALÚNIA.', 'CULPA DO ESTAGIÁRIO.', 'OBJEÇÃO, PORRA!'];
    const autor = this.reus.find((r) => !r.manequim);
    if (!autor) return;
    this.falar(autor.nome, falas[Math.floor(Math.random() * falas.length)]);
  }

  /**
   * Corte seco pro ato pedido: posiciona câmera e alvo na hora, sem tween
   * (conceito §6 — cortes de filme barato dão o ritmo). A órbita continua
   * disponível dentro dos limites do ato ("esticar o pescoço").
   */
  setAto(ato: Ato) {
    this.atoAtual = ato;
    const cfg = CONFIG_ATO[ato];
    this.camera.position.set(...cfg.pos);
    this.controls.target.set(...cfg.alvo);
    this.controls.enableZoom = ato !== 'pov';
    this.controls.enablePan = false;
    this.controls.rotateSpeed = ato === 'pov' ? 0.35 : 1;
    this.controls.minAzimuthAngle = ato === 'pov' ? -1.28 : -Infinity;
    this.controls.maxAzimuthAngle = ato === 'pov' ? 1.28 : Infinity;
    this.controls.minDistance = cfg.dist[0];
    this.controls.maxDistance = cfg.dist[1];
    this.controls.minPolarAngle = cfg.polar[0];
    this.controls.maxPolarAngle = cfg.polar[1];
    // O objeto pendurado só entra nos planos largos. Nos planos de prova/POV
    // ele cruzava o rosto dos réus e o relógio; a luz continua funcionando.
    this.lampadaVisual.visible = ato === 'juiz';
    if (this.selfReu) this.selfReu.group.visible = ato !== 'pov';
    if (ato === 'pov') this.povAnchor.copy(this.camera.position);
    this.aplicarFov();
    this.controls.update();
    if (ato === 'pov') this.travarPovNaCadeira();
  }

  /**
   * OrbitControls fornece uma rotação agradável e consistente para mouse e
   * toque, mas normalmente move a câmera ao redor do alvo. No POV convertemos
   * essa órbita em direção de olhar e recolocamos os olhos na cadeira a cada
   * frame. Assim arrastar olha livremente sem caminhar, orbitar ou dar zoom.
   */
  private travarPovNaCadeira() {
    const distanciaDoOlhar = Math.max(1, this.camera.position.distanceTo(this.controls.target));
    this.povDirection.subVectors(this.controls.target, this.camera.position).normalize();
    this.camera.position.copy(this.povAnchor);
    this.controls.target.copy(this.povAnchor).addScaledVector(this.povDirection, distanciaDoOlhar);
    this.camera.lookAt(this.controls.target);
  }

  /** FOV do ato atual, com abertura extra em tela estreita (celular em pé). */
  private aplicarFov() {
    const base = CONFIG_ATO[this.atoAtual].fov;
    this.camera.fov = this.camera.aspect < 0.9 ? base + 14 : base;
    this.camera.updateProjectionMatrix();
  }

  /** Slot da prova ALINHADO com quem jogou: na frente da cadeira dele. */
  private slotProva(az: number): { pos: THREE.Vector3; rotY: number } {
    const a = (az * Math.PI) / 180;
    return {
      pos: new THREE.Vector3(Math.sin(a) * 2.35, 0.02, Math.cos(a) * 2.35),
      rotY: a + (Math.random() - 0.5) * 0.12,
    };
  }

  /**
   * A ponte 2D→3D: a mão do jogador vive na UI da página; ao clicar, a carta
   * entra no mundo voando da sua cadeira até o próximo slot livre do anel.
   * Retorna false quando a prova do jogador já entrou ou o julgamento começou.
   */
  jogarCarta(texto: string): boolean {
    if (!this.versoTex || this.julgamento) return false;
    if (this.provas.some((p) => p.autor === 'VOCÊ')) return false; // já jogou
    const frente = drawCardTexture(texto, false);
    this.texturas.push(frente);
    const carta = new Carta(frente, this.versoTex, COR.paper);
    carta.texto = texto;
    carta.autor = 'VOCÊ';
    carta.azProva = 360; // sua carta é a última do sentido horário
    carta.deitarVirada(); // provas chegam lacradas
    const slot = this.slotProva(0); // seu slot: na frente da SUA cadeira
    carta.group.rotation.y = slot.rotY;
    carta.group.position.set(0, 1.3, 4.3); // nasce "de você" (cadeira do POV)
    this.scene.add(carta.group);
    this.cartas.push(carta);
    this.provas.push(carta);
    carta.anim = {
      alvoPos: slot.pos,
      alvoRot: new THREE.Euler(0, slot.rotY, 0),
      origemPos: carta.group.position.clone(),
      origemRot: carta.group.rotation.clone(),
      t0: this.elapsed,
      dur: 0.55,
    };
    somCarta();
    return true;
  }

  /**
   * O JULGAMENTO: revela as provas em sentido horário (a sua por último),
   * uma a cada ~3.2s. `onRevela` alimenta a UI 2D com autor + resposta;
   * `onFim` avisa que o júri terminou de ler.
   */
  julgar(
    onRevela: (info: { autor: string; texto: string }) => void,
    onFim: () => void
  ): boolean {
    if (this.julgamento || !this.provas.some((p) => p.autor === 'VOCÊ')) return false;
    const fila = [...this.provas].sort((a, b) => a.azProva - b.azProva);
    this.julgamento = {
      fila,
      idx: 0,
      proximaT: this.elapsed + 0.7,
      onRevela,
      onFim,
    };
    return true;
  }

  private limparVeredito() {
    this.julgamento = null;
    this.marteloT = -1;
    this.martelo.rotation.z = 0;
    this.onCulpadoCb = null;
    this.frisoMat.color.setHex(COR.panel);
    this.recorteVermelho.intensity = 0;
    if (this.carimbo) {
      descartarObjeto(this.carimbo);
      this.carimbo = null;
    }
    this.culpadoT = -1;
    this.spotCulpado.intensity = 0;
    this.verdictProofId = null;
  }

  private removerCarta(carta: Carta) {
    this.cartas = this.cartas.filter((c) => c !== carta);
    descartarObjeto(carta.group);
    if (carta.frente !== this.versoTex) {
      this.texturas = this.texturas.filter((textura) => textura !== carta.frente);
      carta.frente.dispose();
    }
  }

  /**
   * Prepara uma rodada nova sem reconstruir o cenário. A pergunta e as seis
   * respostas dos outros jogadores são renovadas; a sétima prova vem da mão 2D.
   */
  prepararRodada(preta: string, brancas: string[]) {
    if (!this.versoTex) return false;
    this.limparVeredito();
    const antigas = [...this.provas];
    if (this.cartaPreta) antigas.push(this.cartaPreta);
    for (const carta of antigas) this.removerCarta(carta);
    this.provas = [];
    this.cartaPreta = null;
    this.montarRodada(preta, brancas, 0);
    return true;
  }

  /**
   * Reconciliador da partida real. Ele só recebe a projeção sanitizada de
   * `MesaView`: nenhuma mão, voto secreto ou decisão de regra entra no Three.
   * Pode ser chamado a cada snapshot; apenas as diferenças visuais são refeitas.
   */
  syncMesa(view: MesaView) {
    if (!this.versoTex) return;
    this.realMode = true;
    this.selfId = view.selfId;
    this.presentationPhase = view.phase;
    this.rebuildSeats(view);

    const durationSeconds = view.phase === 'submitting'
      ? ('submitSeconds' in view ? Number(view.submitSeconds) : 75)
      : view.phase === 'judging'
        ? ('judgeSeconds' in view ? Number(view.judgeSeconds) : 60)
        : ('resultSeconds' in view ? Number(view.resultSeconds) : 9);
    const endsAt = 'phaseEndsAt' in view && Number(view.phaseEndsAt) > 0
      ? Number(view.phaseEndsAt)
      : view.phaseStartedAt + durationSeconds * 1000;
    this.setDeadline(endsAt, durationSeconds * 1000);

    const nextRoundSignature = `${view.round}:${view.blackCard?.id ?? 'none'}`;
    if (nextRoundSignature !== this.roundSignature) {
      this.roundSignature = nextRoundSignature;
      this.limparVeredito();
      this.clearProofBundles();
      if (this.cartaPreta) {
        this.removerCarta(this.cartaPreta);
        this.cartaPreta = null;
      }
      if (view.blackCard) {
        const preta = this.criarCarta(view.blackCard.text, true);
        preta.group.position.set(0, 0.09, -0.4);
        preta.group.rotation.y = 0.06;
        preta.fixarBase();
        this.cartaPreta = preta;
        this.entrarDoAlto(preta, 0.08);
      }
    }

    this.syncProofBundles(view.proofs, view.round, view.phase === 'judging');
    const winning = view.proofs.find((proof) => proof.isWinner);
    if (winning && view.phase !== 'judging' && this.verdictProofId !== winning.id) {
      this.martelada(undefined, winning.id);
    }

    // o ato final: game-end liga a festa fúnebre; qualquer outra fase desliga
    // e devolve os caídos à cadeira (rodada nova não começa com defunto).
    if (view.phase === 'game-end') this.iniciarVitoria(view);
    else {
      this.encerrarVitoria();
      this.levantarTodos();
    }

    this.atualizarLousa(view);
  }

  private setDeadline(endsAt: number, durationMs: number) {
    this.deadlineEndsAt = Number.isFinite(endsAt) ? endsAt : 0;
    this.deadlineDurationMs = Math.max(1, Number.isFinite(durationMs) ? durationMs : 1);
  }

  // ── A lousa do placar: UI dentro do mundo ──────────────────────────────────

  /** Monta o cavalete uma vez, ao lado do juiz, virado pra mesa. */
  private montarLousa() {
    if (this.lousa) return;
    const grupo = new THREE.Group();
    const matMadeira = new THREE.MeshLambertMaterial({ color: 0x2e2126 });
    const moldura = new THREE.Mesh(new THREE.BoxGeometry(2.5, 1.86, 0.09), matMadeira);
    moldura.castShadow = true;
    const quadro = new THREE.Mesh(
      new THREE.PlaneGeometry(2.26, 1.62),
      new THREE.MeshLambertMaterial({ color: 0xffffff })
    );
    quadro.position.z = 0.055;
    const matPerna = new THREE.MeshLambertMaterial({ color: 0x241a1e });
    for (const lado of [-1, 1]) {
      const perna = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.055, 2.6, 7), matPerna);
      perna.position.set(1.05 * lado, -0.85, -0.12);
      perna.rotation.z = -lado * 0.1;
      perna.rotation.x = 0.08;
      grupo.add(perna);
    }
    const pernaTras = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 2.5, 7), matPerna);
    pernaTras.position.set(0, -0.9, -0.5);
    pernaTras.rotation.x = -0.35;
    grupo.add(moldura, quadro, pernaTras);
    const az = (152 * Math.PI) / 180;
    const r = 7.6;
    grupo.position.set(Math.sin(az) * r, 1.72, Math.cos(az) * r);
    grupo.lookAt(0, 1.35, 0);
    this.scene.add(grupo);
    this.lousa = { grupo, quadro, tex: null };
  }

  /** Redesenha o giz só quando nomes/pontos/meta mudam. */
  private atualizarLousa(view: MesaView) {
    this.montarLousa();
    if (!this.lousa) return;
    const linhas = [...view.seats]
      .sort((a, b) => b.score - a.score)
      .map((seat) => ({ nome: seat.name, score: seat.score, juiz: seat.id === view.judgeId }));
    const topo = linhas[0]?.score ?? 0;
    const assinatura =
      `${view.scoreLimit}|` + linhas.map((l) => `${l.nome}:${l.score}:${l.juiz ? 1 : 0}`).join('|');
    if (assinatura === this.lousaSignature) return;
    this.lousaSignature = assinatura;
    const tex = drawLousa(
      linhas.map((l) => ({ ...l, lider: l.score === topo && topo > 0 })),
      view.scoreLimit
    );
    const mat = this.lousa.quadro.material as THREE.MeshLambertMaterial;
    this.lousa.tex?.dispose();
    this.lousa.tex = tex;
    mat.map = tex;
    mat.needsUpdate = true;
  }

  // ── O ATO FINAL: blackout, um holofote só e confete preto/vermelho ─────────

  /** Liga a festa fúnebre do game-end. Idempotente por sync. */
  private iniciarVitoria(view: MesaView) {
    if (this.vitoria) return;
    const vencedores = view.seats
      .filter((seat) => seat.isGameWinner)
      .map((seat) => this.reuPorId.get(seat.id))
      .filter((reu): reu is Reu => !!reu);
    const alvoSeat = view.seats.find((seat) => seat.id === view.gameWinnerId)
      ?? view.seats.find((seat) => seat.isGameWinner);

    // holofote cai na cadeira do campeão (fallback: centro da mesa)
    const raio = 5.15;
    const alvoPos = alvoSeat
      ? new THREE.Vector3(Math.sin(alvoSeat.azimuthRad) * raio, 0, Math.cos(alvoSeat.azimuthRad) * raio)
      : new THREE.Vector3(0, 0, 0);
    this.holofoteVitoria.position.set(alvoPos.x * 0.82, 7, alvoPos.z * 0.82);
    this.holofoteVitoria.target.position.copy(alvoPos);

    // confete: papel picado preto/vermelho/creme caindo dentro do facho
    const NUM = 90;
    const geom = new THREE.PlaneGeometry(0.085, 0.13);
    const mat = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
    const confete = new THREE.InstancedMesh(geom, mat, NUM);
    confete.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    const cores = [new THREE.Color(COR.ink), new THREE.Color(COR.red), new THREE.Color(COR.paper)];
    const flocos: FlocoConfete[] = [];
    const dummy = new THREE.Object3D();
    for (let i = 0; i < NUM; i++) {
      const pos = new THREE.Vector3(
        alvoPos.x * 0.82 + (Math.random() - 0.5) * 3.2,
        2.5 + Math.random() * 4.5,
        alvoPos.z * 0.82 + (Math.random() - 0.5) * 3.2
      );
      flocos.push({
        pos,
        vel: new THREE.Vector3((Math.random() - 0.5) * 0.5, -(0.8 + Math.random() * 0.9), (Math.random() - 0.5) * 0.5),
        rot: new THREE.Euler(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI),
        rotVel: new THREE.Vector3((Math.random() - 0.5) * 6, (Math.random() - 0.5) * 6, (Math.random() - 0.5) * 6),
      });
      dummy.position.copy(pos);
      dummy.updateMatrix();
      confete.setMatrixAt(i, dummy.matrix);
      // preto/vermelho dominam; o creme salpica pra leitura no blackout
      confete.setColorAt(i, cores[i % 4 === 3 ? 2 : i % 2]);
    }
    confete.instanceMatrix.needsUpdate = true;
    if (confete.instanceColor) confete.instanceColor.needsUpdate = true;
    this.scene.add(confete);

    // se a última martelada ainda está caindo, a festa espera a sentença
    const atraso = this.marteloT >= 0 ? 2.3 : 0.5;
    this.vitoria = {
      inicioT: this.elapsed + atraso,
      vencedores,
      confete,
      flocos,
      proximaFesta: 0,
      somTocado: false,
    };
  }

  /** Reacende a sala e recolhe o confete (mudança de fase/partida nova). */
  private encerrarVitoria() {
    if (!this.vitoria) return;
    if (this.vitoria.confete) {
      this.vitoria.confete.geometry.dispose();
      (this.vitoria.confete.material as THREE.Material).dispose();
      this.vitoria.confete.removeFromParent();
    }
    this.holofoteVitoria.intensity = 0;
    this.vitoria = null;
  }

  /** Animação por frame do ato final (chamada pelo loop). */
  private tickVitoria(t: number, dt: number) {
    const v = this.vitoria;
    const ativa = !!v && t >= v.inicioT;
    // blackout suave: a sala morre, sobra o facho
    const alvoLuz = ativa ? 0.1 : 1;
    this.luzGeral += (alvoLuz - this.luzGeral) * Math.min(1, dt * 2.2);
    this.hemi.intensity = 2.4 * this.luzGeral;
    this.preench.intensity = 1.1 * this.luzGeral;
    this.holofoteVitoria.intensity = 170 * (1 - this.luzGeral) * (ativa ? 1 : 0.0);
    if (!v || !ativa) return;

    if (!v.somTocado) {
      v.somTocado = true;
      somFesta();
      somPalmas(6);
    }

    // confete caindo em loop dentro do facho
    if (v.confete) {
      const dummy = new THREE.Object3D();
      for (let i = 0; i < v.flocos.length; i++) {
        const f = v.flocos[i];
        f.pos.addScaledVector(f.vel, dt);
        f.pos.x += Math.sin(t * 2.2 + i) * dt * 0.35; // baila no ar
        f.rot.x += f.rotVel.x * dt;
        f.rot.y += f.rotVel.y * dt;
        f.rot.z += f.rotVel.z * dt;
        if (f.pos.y < 0.02) {
          f.pos.y = 4.5 + Math.random() * 2.5;
        }
        dummy.position.copy(f.pos);
        dummy.rotation.copy(f.rot);
        dummy.updateMatrix();
        v.confete.setMatrixAt(i, dummy.matrix);
      }
      v.confete.instanceMatrix.needsUpdate = true;
    }

    // o campeão festeja; a mesa colapsa de inveja
    if (t > v.proximaFesta) {
      v.proximaFesta = t + 1.7 + Math.random() * 0.9;
      for (const reu of v.vencedores) {
        reu.acao('festejar');
        reu.setExpressao('riso');
      }
      // quem já tombou está fora da cena: nada de facepalm vindo de um defunto
      const perdedores = this.reus.filter((r) => !r.manequim && !r.caido && !v.vencedores.includes(r));
      const azarado = perdedores[Math.floor(Math.random() * perdedores.length)];
      if (azarado) {
        azarado.acao(Math.random() < 0.5 ? 'facepalm' : 'tilt');
        azarado.setExpressao(Math.random() < 0.5 ? 'desprezo' : 'choque');
      }
    }
  }

  private proofSlot(index: number, total: number, round: number) {
    // O anel tem rotação por rodada e nunca acompanha o azimute dos autores.
    // Isso impede deduzir autoria pela cadeira mesmo observando várias rodadas.
    const seed = ((round * 2654435761) >>> 0) / 0xffffffff;
    const offset = -Math.PI / 2 + seed * Math.PI * 2;
    const angle = offset + (Math.PI * 2 * index) / Math.max(1, total);
    const radius = total <= 4 ? 1.75 : 2.2;
    return { angle, pos: new THREE.Vector3(Math.sin(angle) * radius, 0.025, Math.cos(angle) * radius) };
  }

  private proofVisualSignature(proof: MesaProofView): string {
    return [
      proof.state,
      proof.cardCount,
      proof.cards.map((card) => card.text).join('\u241f'),
      proof.owner?.id ?? '',
      proof.isWinner ? 1 : 0,
    ].join(':');
  }

  private createProofBundle(
    proof: MesaProofView,
    proofIndex: number,
    proofTotal: number,
    round: number,
    animateReveal: boolean
  ): Carta[] {
    if (!this.versoTex) return [];
    const slot = this.proofSlot(proofIndex, proofTotal, round);
    const count = Math.max(1, proof.cardCount || proof.cards.length || 1);
    const cards: Carta[] = [];
    for (let cardIndex = 0; cardIndex < count; cardIndex++) {
      const cardView = proof.cards[cardIndex];
      const frente: THREE.Texture = cardView ? drawCardTexture(cardView.text, false) : this.versoTex;
      if (frente !== this.versoTex) this.texturas.push(frente);
      const carta = new Carta(frente, this.versoTex, COR.paper);
      carta.texto = cardView?.text ?? '';
      carta.autor = proof.owner?.name ?? '';
      const lateral = (cardIndex - (count - 1) / 2) * 0.18;
      carta.group.position.copy(slot.pos);
      carta.group.position.x += Math.cos(slot.angle) * lateral;
      carta.group.position.z -= Math.sin(slot.angle) * lateral;
      carta.group.position.y += cardIndex * 0.008;
      carta.group.rotation.y = slot.angle + (cardIndex - (count - 1) / 2) * 0.045;
      if (proof.state === 'sealed' || animateReveal) carta.deitarVirada();
      carta.fixarBase();
      this.scene.add(carta.group);
      this.cartas.push(carta);
      this.provas.push(carta);
      this.proofByCard.set(carta, proof.id);
      cards.push(carta);
      if (proof.state === 'revealed' && animateReveal) carta.flip();
    }
    return cards;
  }

  private syncProofBundles(proofs: readonly MesaProofView[], round: number, animateReveal: boolean) {
    const ids = new Set(proofs.map((proof) => proof.id));
    for (const [proofId, cards] of this.proofBundles) {
      if (ids.has(proofId)) continue;
      for (const card of cards) this.removerProofCard(card);
      this.proofBundles.delete(proofId);
      this.proofStateSignatures.delete(proofId);
    }

    proofs.forEach((proof, proofIndex) => {
      const signature = this.proofVisualSignature(proof);
      if (this.proofStateSignatures.get(proof.id) === signature) return;
      const old = this.proofBundles.get(proof.id) ?? [];
      for (const card of old) this.removerProofCard(card);
      const bundle = this.createProofBundle(proof, proofIndex, proofs.length, round, animateReveal);
      this.proofBundles.set(proof.id, bundle);
      this.proofStateSignatures.set(proof.id, signature);
    });
  }

  private removerProofCard(card: Carta) {
    this.provas = this.provas.filter((item) => item !== card);
    this.proofByCard.delete(card);
    this.removerCarta(card);
  }

  private clearProofBundles() {
    const cards = [...this.proofBundles.values()].flat();
    for (const card of cards) this.removerProofCard(card);
    this.proofBundles.clear();
    this.proofStateSignatures.clear();
    this.verdictProofId = null;
  }

  /** Arremesso COM ALVO: da sua cadeira até o réu escolhido (roda de emotes). */
  arremessarEm(nomeAlvo: string, tipo: Reacao3D): boolean {
    const alvo = this.reus.find((r) => r.nome === nomeAlvo);
    if (!alvo) return false;
    if (this.reacoesVoo.length >= 8) {
      const antiga = this.reacoesVoo.shift();
      if (antiga) descartarObjeto(antiga.group);
    }
    const group = this.criarObjetoReacao(tipo);
    const inicio = new THREE.Vector3(0, 1.2, 4.35);
    const fim = alvo.group.position.clone().multiplyScalar(0.92);
    fim.y = 1.1;
    const controle = inicio.clone().lerp(fim, 0.5);
    controle.y = 2.9;
    group.position.copy(inicio);
    this.scene.add(group);
    this.reacoesVoo.push({
      group,
      inicio,
      controle,
      fim,
      t0: this.elapsed,
      dur: 0.7,
      giro: new THREE.Vector3(6 + Math.random() * 4, 8, 5),
      aoTerminar: () => {
        alvo.receberImpacto(tipo);
        somSoco();
      },
    });
    somArremesso();
    return true;
  }

  /** Participantes visíveis que podem receber reações, na ordem da mesa. */
  getAlvos(): string[] {
    return this.reus.map((r) => r.nome);
  }

  getAto(): Ato {
    return this.atoAtual;
  }

  /**
   * Close 3/4 no boneco de um réu específico — o momento "FULANO CULPADO" do
   * veredito. Sai dos planos fixos e aponta a câmera pra cara dele, um pouco à
   * frente (rumo ao centro) e de lado, na altura do capuz. Volta a arrastar
   * livre; qualquer setAto seguinte reassume um plano fixo.
   */
  closeUpReu(id: number): boolean {
    const reu = this.reuPorId.get(id);
    if (!reu) return false;
    const p = reu.group.position.clone();
    const az = Math.atan2(p.x, p.z);
    // o réu olha pro centro: pra ver o rosto, a câmera fica À FRENTE dele
    // (rumo ao centro), com um leve desvio lateral (3/4), na altura do capuz.
    const paraCentro = new THREE.Vector3(-Math.sin(az), 0, -Math.cos(az));
    const lateral = new THREE.Vector3(Math.cos(az), 0, -Math.sin(az));
    const olho = p.clone().addScaledVector(paraCentro, 3.5).addScaledVector(lateral, 1.0);
    olho.y = 1.66; // pouco acima do rosto, olhando levemente pra baixo
    const alvo = new THREE.Vector3(p.x * 0.99, 1.24, p.z * 0.99);

    this.atoAtual = 'juiz';
    this.controls.enableZoom = true;
    this.controls.enablePan = false;
    this.controls.rotateSpeed = 1;
    this.controls.minAzimuthAngle = -Infinity;
    this.controls.maxAzimuthAngle = Infinity;
    this.controls.minPolarAngle = 0.25;
    this.controls.maxPolarAngle = Math.PI / 2;
    this.controls.minDistance = 1.6;
    this.controls.maxDistance = 9;
    this.lampadaVisual.visible = false;
    if (this.selfReu) this.selfReu.group.visible = true;
    // corte seco + tremor pra dar o baque, sem câmera voando
    this.cortarPara(olho, alvo, this.camera.aspect < 0.9 ? 46 : 40);
    this.tremor(0.16);
    reu.acao('apontar'); // o culpado reage ao ser apontado
    return true;
  }

  /** Posiciona a câmera direto (corte seco) e sincroniza os OrbitControls. */
  private cortarPara(pos: THREE.Vector3, alvo: THREE.Vector3, fov: number) {
    this.camera.position.copy(pos);
    this.controls.target.copy(alvo);
    this.camera.fov = fov;
    this.camera.updateProjectionMatrix();
    this.controls.update();
  }

  /** Uma sacudida de câmera pontual (amortece sozinha no loop de shake). */
  tremor(forca = 0.14) {
    this.shake = Math.max(this.shake, forca);
  }

  /**
   * Foca UMA prova específica no anel (revelação carta a carta), com corte seco
   * e um tremor. Câmera afastada e de fora do anel, olhando pra carta deitada —
   * legível em 3D enquanto o painel 2D mostra o texto. Como o anel embaralha por
   * rodada, revelações seguidas pulam de posição, alternando pela mesa.
   */
  focarProva(index: number): boolean {
    const bundle = [...this.proofBundles.values()][index];
    if (!bundle || !bundle.length) return false;
    const cp = bundle[0].group.position.clone();
    const a = Math.atan2(cp.x, cp.z);
    const paraFora = new THREE.Vector3(Math.sin(a), 0, Math.cos(a));
    const olho = cp.clone().addScaledVector(paraFora, 2.3);
    olho.y = 2.5; // afastado e mais alto: dá pra ler a carta com a mesa em volta
    const alvo = new THREE.Vector3(cp.x, 0.12, cp.z);
    this.atoAtual = 'provas';
    this.controls.enableZoom = true;
    this.controls.enablePan = false;
    this.controls.minAzimuthAngle = -Infinity;
    this.controls.maxAzimuthAngle = Infinity;
    this.controls.minPolarAngle = 0.2;
    this.controls.maxPolarAngle = Math.PI / 2;
    this.controls.minDistance = 1.2;
    this.controls.maxDistance = 11;
    this.lampadaVisual.visible = false;
    this.cortarPara(olho, alvo, this.camera.aspect < 0.9 ? 46 : 40);
    this.tremor(0.08);
    return true;
  }

  /** O ato do veredito: o juiz ergue o martelo e CRAVA. Screen shake, spotlight
   *  vermelho e carimbo CULPADO esmagando a prova sorteada. */
  martelada(onCulpado?: (nome: string) => void, proofId?: string) {
    if (this.marteloT < 0) {
      this.marteloT = 0;
      this.onCulpadoCb = onCulpado ?? null;
      this.verdictProofId = proofId ?? null;
      this.frisoMat.color.setHex(COR.red);
      this.recorteVermelho.intensity = 0.7;
      // limpa o veredito anterior
      if (this.carimbo) {
        descartarObjeto(this.carimbo);
        this.carimbo = null;
      }
      this.culpadoT = -1;
      this.spotCulpado.intensity = 0;
    }
  }

  /** No impacto do martelo: usa o veredito do host; sorteio só no laboratório. */
  private condenar() {
    const bundle = this.verdictProofId ? this.proofBundles.get(this.verdictProofId) : null;
    const alvo = bundle?.[0] ?? this.provas[Math.floor(Math.random() * this.provas.length)];
    if (!alvo) return;
    if (!alvo.viradaPraCima) alvo.flip();
    const pos = alvo.group.position;
    this.spotCulpado.position.set(pos.x, 6, pos.z);
    this.spotCulpado.target.position.set(pos.x, 0, pos.z);
    this.spotCulpado.intensity = 90;
    const tex = drawCarimboTexture();
    this.texturas.push(tex);
    this.carimbo = new THREE.Mesh(
      new THREE.PlaneGeometry(1.1, 0.42),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false })
    );
    this.carimbo.rotation.x = -Math.PI / 2;
    this.carimbo.rotation.z = -0.14;
    this.carimbo.position.set(pos.x, 0.75, pos.z); // acima do pulo do flip
    this.carimbo.renderOrder = 10;
    this.scene.add(this.carimbo);
    this.culpadoT = 0;
    this.onCulpadoCb?.(alvo.autor || 'ALGUÉM');
  }

  private montarCartas(pretas: string[], brancas: string[], realMode = false) {
    this.versoTex = drawBackTexture();
    this.texturas.push(this.versoTex);
    if (!realMode) this.montarRodada(pretas[0] ?? 'Cadê a carta preta?', brancas, 0);

    // pilha de compra, afastada do anel
    const pilha = new Carta(this.versoTex, this.versoTex, COR.ink);
    pilha.group.position.set(-3.2, 0.1, -2.0);
    pilha.group.rotation.y = -0.3;
    pilha.mesh.scale.z = 14; // pilha gorda
    pilha.deitarVirada();
    pilha.fixarBase();
    this.scene.add(pilha.group);
    this.cartas.push(pilha);
  }

  private criarCarta(texto: string, preta: boolean): Carta {
    if (!this.versoTex) throw new Error('Verso das cartas ainda não foi criado.');
    const frente = drawCardTexture(texto, preta);
    this.texturas.push(frente);
    const carta = new Carta(frente, this.versoTex, preta ? COR.ink : COR.paper);
    this.scene.add(carta.group);
    this.cartas.push(carta);
    return carta;
  }

  private montarRodada(pretaTexto: string, brancas: string[], agora: number) {
    // carta preta no centro, levemente torta e erguida num apoio pra destacar do tampo
    const preta = this.criarCarta(pretaTexto, true);
    preta.group.position.set(0, 0.09, -0.4);
    preta.group.rotation.y = 0.06;
    preta.fixarBase();
    this.cartaPreta = preta;
    this.entrarDoAlto(preta, agora + 0.2);

    // provas lacradas ALINHADAS com os donos: cada carta na frente de quem
    // jogou (todos menos o juiz). O slot da frente (az 0) é seu — jogarCarta.
    this.assentosJogadores.forEach((a, i) => {
      const texto = brancas[i] ?? 'Uma carta em branco.';
      const c = this.criarCarta(texto, false);
      c.texto = texto;
      c.autor = a.nome;
      c.azProva = a.az;
      const slot = this.slotProva(a.az);
      c.group.position.copy(slot.pos);
      c.group.rotation.y = slot.rotY;
      c.deitarVirada();
      c.fixarBase();
      this.provas.push(c);
      this.entrarDoAlto(c, agora + 0.5 + i * 0.12);
    });
  }

  /**
   * Arremesso: usa o modelo do Blender quando a biblioteca já chegou e cai na
   * primitiva enquanto não chegou. A troca é invisível — os dois têm a mesma
   * escala e o mesmo ponto de origem.
   */
  private criarObjetoReacao(tipo: Reacao3D): THREE.Group {
    const apelido = { tomate: 'tomato', sapato: 'shoe', rosa: 'rose' }[tipo];
    const modelado = this.props.criar(apelido);
    if (modelado) {
      const group = new THREE.Group();
      group.add(modelado);
      return group;
    }
    return this.criarObjetoReacaoProcedural(tipo);
  }

  private criarObjetoReacaoProcedural(tipo: Reacao3D): THREE.Group {
    const group = new THREE.Group();

    if (tipo === 'tomate') {
      const seco = new THREE.MeshLambertMaterial({ color: 0x8a2620, flatShading: true });
      const escuro = new THREE.MeshLambertMaterial({ color: COR.panel, flatShading: true });
      const corpo = new THREE.Mesh(new THREE.SphereGeometry(0.2, 9, 7), seco);
      corpo.scale.y = 0.82;
      const talo = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.1, 5), escuro);
      talo.position.y = 0.17;
      group.add(corpo, talo);
    } else if (tipo === 'sapato') {
      const papel = new THREE.MeshLambertMaterial({ color: COR.paper, flatShading: true });
      const escuro = new THREE.MeshLambertMaterial({ color: COR.panel, flatShading: true });
      const sola = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.1, 0.2), papel);
      sola.position.y = -0.08;
      const corpo = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.22, 0.22), escuro);
      corpo.position.x = -0.05;
      const bico = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.13, 0.2), escuro);
      bico.position.set(0.25, -0.02, 0);
      group.add(sola, corpo, bico);
    } else {
      const seco = new THREE.MeshLambertMaterial({ color: 0x8a2620, flatShading: true });
      const escuro = new THREE.MeshLambertMaterial({ color: COR.panel, flatShading: true });
      const haste = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.62, 5), escuro);
      haste.rotation.z = Math.PI / 2;
      const flor = new THREE.Mesh(new THREE.DodecahedronGeometry(0.15, 0), seco);
      flor.position.x = -0.34;
      const folha = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.18, 5), escuro);
      folha.position.set(0.08, 0.08, 0);
      folha.rotation.z = -0.8;
      group.add(haste, flor, folha);
    }
    group.traverse((o) => {
      if (o instanceof THREE.Mesh) o.castShadow = true;
    });
    return group;
  }

  private criarTexturaBalao(texto: string): THREE.CanvasTexture {
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 128;
    const x = c.getContext('2d')!;
    x.fillStyle = '#17161a';
    x.strokeStyle = '#f2efe9';
    x.lineWidth = 6;
    x.beginPath();
    x.moveTo(14, 10);
    x.lineTo(242, 10);
    x.lineTo(242, 92);
    x.lineTo(142, 92);
    x.lineTo(118, 119);
    x.lineTo(121, 92);
    x.lineTo(14, 92);
    x.closePath();
    x.fill();
    x.stroke();
    x.fillStyle = '#f2efe9';
    x.font = `700 19px ${fontFamily('--font-archivo-black', 'sans-serif')}`;
    x.textAlign = 'center';
    x.textBaseline = 'middle';
    const normalizado = texto.replace(/\s+/g, ' ').trim().slice(0, 72);
    const palavras = normalizado.split(' ');
    const linhas: string[] = [];
    let linha = '';
    for (const palavra of palavras) {
      const candidata = linha ? `${linha} ${palavra}` : palavra;
      if (x.measureText(candidata).width <= 205 || !linha) {
        linha = candidata;
      } else {
        linhas.push(linha);
        linha = palavra;
      }
      if (linhas.length === 2) break;
    }
    if (linha && linhas.length < 2) linhas.push(linha);
    if (linhas.length === 2 && palavras.join(' ') !== linhas.join(' ')) {
      while (linhas[1].length > 1 && x.measureText(`${linhas[1]}…`).width > 205) {
        linhas[1] = linhas[1].slice(0, -1);
      }
      linhas[1] = `${linhas[1].trimEnd()}…`;
    }
    const yInicial = linhas.length === 1 ? 51 : 40;
    linhas.forEach((conteudo, index) => x.fillText(conteudo, 128, yInicial + index * 24, 210));
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.generateMipmaps = false;
    return tex;
  }

  private descartarBalao(balao: BalaoFala) {
    balao.mesh.removeFromParent();
    balao.textura.dispose();
    balao.mesh.geometry.dispose();
    balao.mesh.material.dispose();
  }

  /** animação de entrada: cai do alto girando até a pose alvo */
  private entrarDoAlto(c: Carta, atraso: number) {
    const alvoPos = c.group.position.clone();
    const alvoRot = c.group.rotation.clone();
    c.group.position.y += 6;
    c.group.rotation.z += 1.6;
    c.anim = {
      alvoPos,
      alvoRot,
      origemPos: c.group.position.clone(),
      origemRot: c.group.rotation.clone(),
      t0: this.elapsed + atraso,
      dur: 0.7,
    };
  }

  private onPrimeiroGesto = () => {
    iniciarAmbiente();
  };

  setSomAtivo(ativo: boolean) {
    if (ativo) iniciarAmbiente();
    else pararAmbiente();
  }

  setReducedMotion(reduced: boolean) {
    this.reducedMotion = reduced;
    this.stage.setReducedMotion(reduced);
    if (reduced) {
      this.shake = 0;
      this.impactoShake = 0;
    }
  }

  setQualidade(qualidade: Qualidade3D) {
    const quality: Record<Qualidade3D, StageQuality> = {
      baixa: 'performance',
      media: 'balanced',
      alta: 'cinematic',
    };
    this.stage.setQuality(quality[qualidade]);
    this.stage.setResolutionProfile({ pixelScale: this.pixelSize, maxDevicePixelRatio: 1 });
    this.renderer.shadowMap.enabled = qualidade !== 'baixa';
    this.renderer.shadowMap.type = THREE.BasicShadowMap;
  }

  runPerformanceBenchmark(durationMs = 8000) {
    return this.stage.runPerformanceBenchmark({
      label: 'sem-perdao-retro-mesa',
      warmupMs: 1000,
      durationMs,
      metadata: {
        quality: this.stage.getQuality(),
        pixelSize: this.pixelSize,
        realMode: this.realMode,
      },
    });
  }

  performanceMetrics() {
    return this.stage.metrics();
  }

  framingReport(): FramingReport | null {
    const points: THREE.Vector3[] = [];
    for (const defendant of this.reus) {
      const position = defendant.group.position;
      points.push(
        new THREE.Vector3(position.x, 0, position.z),
        new THREE.Vector3(position.x, 2.25, position.z)
      );
    }
    // Mesa e carta preta continuam no quadro mesmo quando há poucos réus.
    points.push(
      new THREE.Vector3(-4.7, 0, -3.5),
      new THREE.Vector3(4.7, 0, -3.5),
      new THREE.Vector3(-4.7, 0, 3.8),
      new THREE.Vector3(4.7, 0, 3.8),
      new THREE.Vector3(0, 2.1, 0)
    );
    return this.stage.framingReportForPoints(points, 0.025);
  }

  setPixelSize(px: number) {
    this.pixelSize = Math.max(1, Math.round(px));
    this.stage.setResolutionProfile({ pixelScale: this.pixelSize, maxDevicePixelRatio: 1 });
    this.resize();
  }

  resize() {
    this.stage.resize();
  }

  private resizePipeline(w: number, h: number) {
    // renderiza pequeno; o CSS (image-rendering: pixelated) amplia
    const lw = Math.max(2, Math.floor(w / this.pixelSize));
    const lh = Math.max(2, Math.floor(h / this.pixelSize));
    this.rt.setSize(lw, lh);
    if (this.blitMat) this.blitMat.uniforms.uPixel.value = this.pixelSize;
    this.camera.aspect = w / h;
    this.aplicarFov();
  }

  private tick = ({ delta: dt, elapsed: t }: StageFrame) => {
    this.elapsed = t;

    this.controls.update();
    if (this.atoAtual === 'pov') this.travarPovNaCadeira();

    // lâmpada: balanço lento + zumbido elétrico + apagões de susto
    this.pendulo.rotation.z = Math.sin(t * 0.9) * 0.05;
    this.pendulo.rotation.x = Math.sin(t * 0.63 + 1.7) * 0.035;
    let fator = 0.94 + 0.06 * Math.sin(t * 31) * Math.sin(t * 17.3);
    const deadlineRestante = this.deadlineEndsAt > 0 ? this.deadlineEndsAt - Date.now() : Infinity;
    const warningWindow = Math.min(10_000, this.deadlineDurationMs * 0.25);
    if (deadlineRestante > 0 && deadlineRestante <= warningWindow) {
      const pressa = 1 - deadlineRestante / warningWindow;
      fator *= 0.9 + Math.max(0, Math.sin(t * (5 + pressa * 9))) * (0.1 + pressa * 0.12);
    }
    if (!this.reducedMotion && t > this.blinkAte && Math.random() < 0.002) {
      this.blinkAte = t + 0.07 + Math.random() * 0.12;
      somZap();
    }
    if (t < this.blinkAte) fator = 0.12;
    // no blackout da vitória a lâmpada-narradora também se apaga
    fator *= this.luzGeral;
    this.spot.intensity = 230 * fator;
    this.brilho.intensity = 10 * fator;
    (this.bulbo.material as THREE.MeshBasicMaterial).color.setHex(fator < 0.5 ? 0x55504a : 0xfff4e0);

    this.tickVitoria(t, dt);

    // os réus vivem: respiração + caos aleatório (expressões e ações)
    if ((this.presentationPhase === 'lab' || this.presentationPhase === 'submitting') && t > this.proximoCaos) {
      this.proximoCaos = t + 1.2 + Math.random() * 2.8;
      const vivos = this.reus.filter((r) => !r.manequim);
      const alvo = vivos[Math.floor(Math.random() * vivos.length)];
      if (Math.random() < 0.45) {
        const espontaneas: Acao[] = ['soco', 'rir', 'facepalm', 'apontar'];
        alvo.acao(espontaneas[Math.floor(Math.random() * espontaneas.length)]);
      }
      const exps = EXPRESSOES.filter((e) => e !== alvo.expressao);
      alvo.setExpressao(exps[Math.floor(Math.random() * exps.length)]);
    }
    for (const r of this.reus) r.tick(t, dt);

    // Reações atravessam a mesa numa parábola curta e somem antes de virar lixo.
    this.reacoesVoo = this.reacoesVoo.filter((reacao) => {
      const k = Math.min((t - reacao.t0) / reacao.dur, 1);
      const umMenos = 1 - k;
      reacao.group.position.set(
        umMenos * umMenos * reacao.inicio.x + 2 * umMenos * k * reacao.controle.x + k * k * reacao.fim.x,
        umMenos * umMenos * reacao.inicio.y + 2 * umMenos * k * reacao.controle.y + k * k * reacao.fim.y,
        umMenos * umMenos * reacao.inicio.z + 2 * umMenos * k * reacao.controle.z + k * k * reacao.fim.z
      );
      reacao.group.rotation.x = reacao.giro.x * k;
      reacao.group.rotation.y = reacao.giro.y * k;
      reacao.group.rotation.z = reacao.giro.z * k;
      if (k < 1) return true;
      reacao.aoTerminar?.();
      descartarObjeto(reacao.group);
      return false;
    });

    // o julgamento lê as provas em sentido horário, uma por vez
    if (this.julgamento && t > this.julgamento.proximaT) {
      const j = this.julgamento;
      if (j.idx < j.fila.length) {
        const c = j.fila[j.idx];
        if (!c.viradaPraCima) c.flip();
        somCarta();
        j.onRevela({ autor: c.autor, texto: c.texto });
        if (j.idx % 2 === 0) this.juizReu?.acao('apontar');
        j.idx++;
        // A primeira metade permanece na prova; a segunda abre espaço para o
        // corte de reação/chat sem atropelar a leitura da carta seguinte.
        j.proximaT = t + 3.2;
      } else {
        const fim = j.onFim;
        this.julgamento = null;
        fim();
      }
    }

    this.baloesFala = this.baloesFala.filter((balao) => {
      const k = Math.min((t - balao.t0) / balao.dur, 1);
      balao.mesh.position.y += dt * 0.045;
      balao.mesh.quaternion.copy(this.camera.quaternion);
      balao.mesh.material.opacity = k > 0.72 ? (1 - k) / 0.28 : 1;
      if (k < 1) return true;
      this.descartarBalao(balao);
      return false;
    });

    // martelada do juiz: ergue devagar, crava seco, a sala treme
    if (this.marteloT >= 0) {
      this.marteloT += dt / 0.55;
      const k = Math.min(this.marteloT, 1);
      let ang: number;
      if (k < 0.45) {
        const e = k / 0.45;
        ang = -1.4 * e * (2 - e); // ergue desacelerando
      } else if (k < 0.58) {
        ang = -1.4 + 1.55 * ((k - 0.45) / 0.13); // CRAVA
        if (this.shake === 0 && k > 0.55) {
          this.shake = 0.22;
          this.recorteVermelho.intensity = 2.2;
          somMartelada();
          for (const r of this.reus) r.setExpressao('choque');
          this.juizReu?.acao('soco');
          this.condenar();
        }
      } else {
        ang = 0.15 * (1 - (k - 0.58) / 0.42);
      }
      this.martelo.rotation.z = ang;
      if (k >= 1) {
        this.marteloT = -1;
        this.martelo.rotation.z = 0;
        this.shake = 0;
        this.frisoMat.color.setHex(COR.panel);
        this.recorteVermelho.intensity = 0;
      }
    }

    // o veredito assentando: carimbo desce esmagando, spotlight segura e esvai
    if (this.culpadoT >= 0 && this.carimbo) {
      this.culpadoT += dt;
      const esmago = 1 + 1.8 * Math.exp(-this.culpadoT * 10);
      this.carimbo.scale.setScalar(esmago);
      // desce junto com a carta que volta do pulo do flip
      this.carimbo.position.y = Math.max(0.12, this.carimbo.position.y - dt * 1.4);
      if (this.culpadoT > 1.4) {
        this.spotCulpado.intensity = Math.max(0, 90 * (1 - (this.culpadoT - 1.4) / 2));
      }
      if (this.culpadoT > 3.4) this.culpadoT = -1; // carimbo fica; luz apagou
    }

    // animações de entrada
    for (const c of this.cartas) {
      if (c.anim) {
        const a = c.anim;
        const k = Math.min(Math.max((t - a.t0) / a.dur, 0), 1);
        const e = 1 - Math.pow(1 - k, 3);
        c.group.position.lerpVectors(a.origemPos, a.alvoPos, e);
        c.group.rotation.z = a.origemRot.z + (a.alvoRot.z - a.origemRot.z) * e;
        if (k >= 1) {
          c.anim = null;
          c.fixarBase();
        }
      } else {
        c.tick(dt);
      }
    }

    // screen shake do veredito — 1 frame de violência, decai rápido
    const shakeStrength = Math.max(this.shake, this.impactoShake);
    this.shakeOffset.set(0, 0, 0);
    if (shakeStrength > 0.003) {
      this.shakeOffset.set(
        (Math.random() - 0.5) * shakeStrength,
        (Math.random() - 0.5) * shakeStrength,
        (Math.random() - 0.5) * shakeStrength * 0.25
      );
      this.shake *= Math.exp(-dt * 9);
      this.impactoShake *= Math.exp(-dt * 12);
    }

  };

  private renderFrame = ({ elapsed }: StageFrame) => {
    // 1º passe: cena → render target pequeno
    this.blitMat.uniforms.uTime.value = elapsed;
    this.camera.position.add(this.shakeOffset);
    this.renderer.setRenderTarget(this.rt);
    this.renderer.render(this.scene, this.camera);
    this.camera.position.sub(this.shakeOffset);
    // 2º passe: quad fullscreen com posterização + dithering
    this.renderer.setRenderTarget(null);
    this.renderer.render(this.blitScene, this.blitCam);
  };

  dispose() {
    this.descartado = true;
    this.stage.stop();
    window.removeEventListener('pointerdown', this.onPrimeiroGesto);
    this.controls.dispose();
    this.props.dispose();
    this.encerrarVitoria();
    this.lousa?.tex?.dispose();
    pararAmbiente();
    for (const reacao of this.reacoesVoo) descartarObjeto(reacao.group);
    for (const balao of this.baloesFala) this.descartarBalao(balao);
    for (const r of this.reus) r.dispose();
    this.rt.dispose();
    (this.blitMat.uniforms.tBayer.value as THREE.Texture).dispose();
    this.blitScene.traverse((o) => {
      if (o instanceof THREE.Mesh) o.geometry.dispose();
    });
    this.blitMat.dispose();
    for (const t of this.texturas) t.dispose();
    this.scene.traverse((o) => {
      if (o instanceof THREE.Mesh || o instanceof THREE.Points) {
        o.geometry.dispose();
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        mats.forEach((m) => m.dispose());
      }
    });
    this.stage.dispose();
  }
}
