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
import { avatarColor } from '@/components/avatar';
import {
  iniciarAmbiente,
  pararAmbiente,
  somArremesso,
  somBalao,
  somMartelada,
  somCarta,
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

export type Reacao3D = 'tomate' | 'sapato' | 'rosa';

/**
 * Atos de câmera — cortes SECOS (sem tween), linguagem de filme barato.
 * `pov` é a cadeira vazia do azimute 0°: você sentado à mesa, sendo julgado.
 */
export type Ato = 'mesa' | 'pov' | 'provas' | 'juiz' | 'cima';
export const ATOS: Ato[] = ['mesa', 'pov', 'provas', 'juiz', 'cima'];

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
  pov: { pos: [0, 1.5, 5.0], alvo: [0, 1.0, -3.5], dist: [3, 10], polar: [0.38, Math.PI - 0.38], fov: 58 },
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
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private rt: THREE.WebGLRenderTarget;
  private blitScene = new THREE.Scene();
  private blitCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private blitMat: THREE.ShaderMaterial;
  private timer = new THREE.Timer();
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
  private blinkAte = 0;
  private proximoCaos = 3;
  private martelo!: THREE.Group;
  private juizReu: Reu | null = null;
  private marteloT = -1;
  private shake = 0;
  private assentosJogadores: { nome: string; az: number }[] = [];
  private julgamento: {
    fila: Carta[];
    idx: number;
    proximaT: number;
    onRevela: (info: { autor: string; texto: string }) => void;
    onFim: () => void;
  } | null = null;
  private onCulpadoCb: ((nome: string) => void) | null = null;
  private raf = 0;
  private atoAtual: Ato = 'mesa';
  private povAnchor = new THREE.Vector3(...CONFIG_ATO.pov.pos);
  private povDirection = new THREE.Vector3();
  private pixelSize: number;
  private disposed = false;
  private canvas: HTMLCanvasElement;
  private texturas: THREE.Texture[] = [];

  constructor(canvas: HTMLCanvasElement, opts: { pixelSize?: number; pretas: string[]; brancas: string[] }) {
    this.canvas = canvas;
    this.canvas.style.cursor = 'grab';
    this.pixelSize = opts.pixelSize ?? 4;

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'low-power' });
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.BasicShadowMap; // sombra dura = retrô

    this.camera = new THREE.PerspectiveCamera(CONFIG_ATO.mesa.fov, 1, 0.1, 60);
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
    this.montarReus();
    this.montarCartas(opts.pretas, opts.brancas);
    this.timer.connect(document);

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

    this.resize();
    window.addEventListener('pointerdown', this.onPrimeiroGesto);
    this.loop();
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
    const hemi = new THREE.HemisphereLight(0xfff0dc, 0x6b6a72, 2.4);
    const preenchimento = new THREE.DirectionalLight(COR.paper, 1.1);
    preenchimento.position.set(4, 6, 7);
    // Vermelho apagado no cotidiano; só acende quando existe veredito.
    this.recorteVermelho = new THREE.DirectionalLight(COR.red, 0);
    this.recorteVermelho.position.set(-6, 2.5, -6);
    this.scene.add(hemi, preenchimento, this.recorteVermelho);

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
  private montarReus() {
    // MESA CHEIA: 8 lugares. Azimute 0° = a SUA cadeira (POV); os outros 7
    // se espalham a cada 45°. O juiz senta sempre em frente a você (180°).
    // Com menos jogadores, é só omitir assentos — o layout máximo é este.
    const assentos: { nome: string; az: number; juiz?: boolean; manequim?: boolean }[] = [
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
      t0: this.timer.getElapsed(),
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
    const autor = this.reus.find((r) => r.nome === nomeAutor);
    const vemDaCadeiraPov = nomeAutor === 'VOCÊ';
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
      t0: this.timer.getElapsed(),
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
    this.controls.minDistance = cfg.dist[0];
    this.controls.maxDistance = cfg.dist[1];
    this.controls.minPolarAngle = cfg.polar[0];
    this.controls.maxPolarAngle = cfg.polar[1];
    this.lampadaVisual.visible = ato !== 'cima';
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
      t0: this.timer.getElapsed(),
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
      proximaT: this.timer.getElapsed() + 0.7,
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
      t0: this.timer.getElapsed(),
      dur: 0.7,
      giro: new THREE.Vector3(6 + Math.random() * 4, 8, 5),
      aoTerminar: () => {
        alvo.setExpressao(tipo === 'rosa' ? 'riso' : 'choque');
        if (tipo !== 'rosa') alvo.acao('facepalm');
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

  /** O ato do veredito: o juiz ergue o martelo e CRAVA. Screen shake, spotlight
   *  vermelho e carimbo CULPADO esmagando a prova sorteada. */
  martelada(onCulpado?: (nome: string) => void) {
    if (this.marteloT < 0) {
      this.marteloT = 0;
      this.onCulpadoCb = onCulpado ?? null;
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

  /** No impacto do martelo: sorteia a prova culpada, acende e carimba. */
  private condenar() {
    const alvo = this.provas[Math.floor(Math.random() * this.provas.length)];
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

  private montarCartas(pretas: string[], brancas: string[]) {
    this.versoTex = drawBackTexture();
    this.texturas.push(this.versoTex);
    this.montarRodada(pretas[0] ?? 'Cadê a carta preta?', brancas, 0);

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

  private criarObjetoReacao(tipo: Reacao3D): THREE.Group {
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
      t0: this.timer.getElapsed() + atraso,
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

  setPixelSize(px: number) {
    this.pixelSize = Math.max(1, Math.round(px));
    this.resize();
  }

  resize() {
    const w = this.canvas.clientWidth || 1;
    const h = this.canvas.clientHeight || 1;
    // renderiza pequeno; o CSS (image-rendering: pixelated) amplia
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(w, h, false);
    const lw = Math.max(2, Math.floor(w / this.pixelSize));
    const lh = Math.max(2, Math.floor(h / this.pixelSize));
    this.rt.setSize(lw, lh);
    if (this.blitMat) this.blitMat.uniforms.uPixel.value = this.pixelSize;
    this.camera.aspect = w / h;
    this.aplicarFov();
  }

  private loop = (timestamp?: number) => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);
    this.timer.update(timestamp);
    const dt = Math.min(this.timer.getDelta(), 0.05);
    const t = this.timer.getElapsed();

    this.controls.update();
    if (this.atoAtual === 'pov') this.travarPovNaCadeira();

    // lâmpada: balanço lento + zumbido elétrico + apagões de susto
    this.pendulo.rotation.z = Math.sin(t * 0.9) * 0.05;
    this.pendulo.rotation.x = Math.sin(t * 0.63 + 1.7) * 0.035;
    let fator = 0.94 + 0.06 * Math.sin(t * 31) * Math.sin(t * 17.3);
    if (t > this.blinkAte && Math.random() < 0.002) {
      this.blinkAte = t + 0.07 + Math.random() * 0.12;
      somZap();
    }
    if (t < this.blinkAte) fator = 0.12;
    this.spot.intensity = 230 * fator;
    this.brilho.intensity = 10 * fator;
    (this.bulbo.material as THREE.MeshBasicMaterial).color.setHex(fator < 0.5 ? 0x55504a : 0xfff4e0);

    // os réus vivem: respiração + caos aleatório (expressões e ações)
    if (t > this.proximoCaos) {
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
    if (this.shake > 0.003) {
      this.camera.position.x += (Math.random() - 0.5) * this.shake;
      this.camera.position.y += (Math.random() - 0.5) * this.shake;
      this.shake *= Math.exp(-dt * 9);
    }

    // 1º passe: cena → render target pequeno
    this.blitMat.uniforms.uTime.value = t;
    this.renderer.setRenderTarget(this.rt);
    this.renderer.render(this.scene, this.camera);
    // 2º passe: quad fullscreen com posterização + dithering
    this.renderer.setRenderTarget(null);
    this.renderer.render(this.blitScene, this.blitCam);
  };

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    window.removeEventListener('pointerdown', this.onPrimeiroGesto);
    this.controls.dispose();
    this.timer.dispose();
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
    this.renderer.dispose();
  }
}
