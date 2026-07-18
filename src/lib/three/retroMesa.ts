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
  pov: { pos: [0, 1.5, 5.0], alvo: [0, 1.0, -3.5], dist: [3, 10], polar: [Math.PI / 2.6, Math.PI / 1.9], fov: 58 },
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
  viradaPraCima: boolean;
  private flipT = -1; // -1 = sem flip em andamento
  private baseY = 0;
  anim: Anim | null = null;
  hover = false;

  constructor(frente: THREE.Texture, verso: THREE.Texture, corLateral: number) {
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
      // hover: levanta de leve
      const alvo = this.baseY + (this.hover ? 0.14 : 0);
      this.group.position.y += (alvo - this.group.position.y) * Math.min(1, dt * 12);
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
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2(-2, -2);
  private cartas: Carta[] = [];
  private provas: Carta[] = [];
  private maoGrp: THREE.Group | null = null;
  private reus: Reu[] = [];
  private reacoesVoo: ReacaoVoo[] = [];
  private baloesFala: BalaoFala[] = [];
  private pendulo!: THREE.Group;
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
  private raf = 0;
  private atoAtual: Ato = 'mesa';
  private pixelSize: number;
  private disposed = false;
  private canvas: HTMLCanvasElement;
  private texturas: THREE.Texture[] = [];

  constructor(canvas: HTMLCanvasElement, opts: { pixelSize?: number; pretas: string[]; brancas: string[] }) {
    this.canvas = canvas;
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
    this.scene.background = new THREE.Color(0x17161c);
    this.scene.fog = new THREE.Fog(0x17161c, 14, 34);

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
        uLevels: { value: 8.0 },
        uDither: { value: 0.58 },
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
          vec2 uv = 0.5 + d * (1.0 + 0.11 * r2);
          if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
            gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
            return;
          }
          // aberração cromática crescendo pra borda
          vec2 ca = d * r2 * 0.022;
          vec3 c;
          c.r = texture2D(tDiffuse, uv + ca).r;
          c.g = texture2D(tDiffuse, uv).g;
          c.b = texture2D(tDiffuse, uv - ca).b;
          // dithering ordenado (Bayer 4x4 por pixelão) + posterização de cor
          float limiar = texture2D(tBayer, gl_FragCoord.xy / (4.0 * uPixel)).r - 0.5;
          c += limiar * (uDither / uLevels);
          c = floor(c * uLevels + 0.5) / uLevels;
          // fósforo nunca apaga: levanta os pretos (o escuro fica VISÍVEL)
          c = c * 0.94 + vec3(0.055);
          // máscara RGB sutil (grade de fósforo) por coluna de pixelão
          float m = mod(floor(gl_FragCoord.x / uPixel), 3.0);
          c *= vec3(0.985) + 0.03 * vec3(
            m == 0.0 ? 1.0 : 0.0,
            m == 1.0 ? 1.0 : 0.0,
            m == 2.0 ? 1.0 : 0.0
          );
          // scanlines alinhadas ao pixelão
          float linha = mod(floor(gl_FragCoord.y / uPixel), 2.0);
          c *= 1.0 - 0.055 * linha;
          // vinheta pesada nos cantos — o sinistro mora na borda
          float vig = smoothstep(0.85, 0.3, length(d) * 1.25);
          c *= 0.68 + 0.32 * vig;
          // grão animado
          float g = fract(sin(dot(gl_FragCoord.xy + mod(uTime, 10.0) * 137.0, vec2(12.9898, 78.233))) * 43758.5453);
          c += (g - 0.5) * 0.025;
          // faixa rolando + tremidinha de sinal fraco
          c *= 1.0 + 0.02 * sin(uv.y * 9.42 - uTime * 1.1);
          c *= 1.0 + 0.008 * sin(uTime * 84.0);
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
    canvas.addEventListener('pointermove', this.onPointerMove);
    canvas.addEventListener('click', this.onClick);
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
    const hemi = new THREE.HemisphereLight(0xfff0dc, 0x6b6a72, 1.75);
    const preenchimento = new THREE.DirectionalLight(COR.paper, 0.65);
    preenchimento.position.set(4, 6, 7);
    // Vermelho apagado no cotidiano; só acende quando existe veredito.
    this.recorteVermelho = new THREE.DirectionalLight(COR.red, 0);
    this.recorteVermelho.position.set(-6, 2.5, -6);
    this.scene.add(hemi, preenchimento, this.recorteVermelho);

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
    this.spot = new THREE.SpotLight(0xfff4e0, 170, 0, 1.12, 0.5, 2);
    this.spot.position.y = -4.4;
    this.spot.castShadow = true;
    this.spot.shadow.mapSize.set(512, 512);
    this.spot.shadow.bias = -0.002;
    this.spot.target.position.set(0, -8.2, 0); // aponta reto pra baixo e acompanha o balanço
    this.brilho = new THREE.PointLight(0xffe9c4, 8, 9, 2);
    this.brilho.position.y = -4.3;
    this.pendulo.add(fio, cupula, this.bulbo, this.spot, this.spot.target, this.brilho);
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

  // ── API de teste (painel "laboratório de caos" da página) ──────────────────

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

  /** Balão billboard curto sobre um réu — primeiro passo do chat dentro do mundo. */
  testarFala() {
    const falas = ['EU EXIJO JUSTIÇA!', 'ISSO É CALÚNIA.', 'CULPA DO ESTAGIÁRIO.', 'OBJEÇÃO, PORRA!'];
    const vivos = this.reus.filter((r) => !r.manequim);
    // No laboratório, o juiz do fundo mantém o balão sempre dentro da câmera.
    // Na integração real, o autor virá do evento de chat.
    const autor = vivos[0];
    if (!autor) return;
    const textura = this.criarTexturaBalao(falas[Math.floor(Math.random() * falas.length)]);
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1.9, 0.95), new THREE.MeshBasicMaterial({
      map: textura,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      fog: false,
      side: THREE.DoubleSide,
    }));
    mesh.position.copy(autor.group.position).multiplyScalar(0.78);
    // Baixo o bastante para não cortar no topo mesmo nos assentos do fundo.
    mesh.position.y = 2.5;
    mesh.quaternion.copy(this.camera.quaternion);
    mesh.renderOrder = 20;
    this.scene.add(mesh);
    this.baloesFala.push({ mesh, textura, t0: this.timer.getElapsed(), dur: 2.6 });
    autor.setExpressao('desprezo');
    somBalao();
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
    this.controls.minDistance = cfg.dist[0];
    this.controls.maxDistance = cfg.dist[1];
    this.controls.minPolarAngle = cfg.polar[0];
    this.controls.maxPolarAngle = cfg.polar[1];
    this.posicionarMao(ato);
    this.aplicarFov();
    this.controls.update();
  }

  /** FOV do ato atual, com abertura extra em tela estreita (celular em pé). */
  private aplicarFov() {
    const base = CONFIG_ATO[this.atoAtual].fov;
    this.camera.fov = this.camera.aspect < 0.9 ? base + 14 : base;
    this.camera.updateProjectionMatrix();
  }

  /** A mão em leque tem duas poses: na beirada (planos gerais) e ERGUIDA na
   *  frente do olho (POV primeira pessoa, como quem segura as cartas). */
  private posicionarMao(ato: Ato) {
    if (!this.maoGrp) return;
    if (ato === 'pov') {
      this.maoGrp.position.set(0, 0.82, 4.05);
      this.maoGrp.rotation.x = -0.62; // leque inclinado pra trás, de frente pro olho
    } else {
      this.maoGrp.position.set(0, 0.6, 3.35);
      this.maoGrp.rotation.x = 0;
    }
  }

  getAto(): Ato {
    return this.atoAtual;
  }

  /** O ato do veredito: o juiz ergue o martelo e CRAVA. Screen shake incluso. */
  martelada() {
    if (this.marteloT < 0) {
      this.marteloT = 0;
      this.frisoMat.color.setHex(COR.red);
      this.recorteVermelho.intensity = 0.7;
    }
  }

  private montarCartas(pretas: string[], brancas: string[]) {
    const agora = 0;
    const verso = drawBackTexture();
    this.texturas.push(verso);

    const criar = (texto: string, preta: boolean) => {
      const frente = drawCardTexture(texto, preta);
      this.texturas.push(frente);
      const carta = new Carta(frente, verso, preta ? COR.ink : COR.paper);
      this.scene.add(carta.group);
      this.cartas.push(carta);
      return carta;
    };

    // carta preta no centro, levemente torta e erguida num apoio pra destacar do tampo
    const preta = criar(pretas[0] ?? 'Cadê a carta preta?', true);
    preta.group.position.set(0, 0.09, -0.4);
    preta.group.rotation.y = 0.06;
    preta.fixarBase();
    this.entrarDoAlto(preta, agora + 0.2);

    // provas: 4 cartas viradas pra baixo em arco na frente do juiz — clique pra revelar
    const provasTextos = brancas.slice(0, 4);
    provasTextos.forEach((t, i) => {
      const c = criar(t, false);
      const x = (i - (provasTextos.length - 1) / 2) * 1.1;
      c.group.position.set(x, 0.02, 1.1);
      c.group.rotation.y = (Math.random() - 0.5) * 0.16;
      c.deitarVirada();
      c.fixarBase();
      this.provas.push(c);
      this.entrarDoAlto(c, agora + 0.5 + i * 0.15);
    });

    // a SUA mão: leque de verdade num grupo próprio (troca de pose no POV).
    // Arco + abre-se em ângulo + escalonada em profundidade (sem z-fight).
    this.maoGrp = new THREE.Group();
    this.scene.add(this.maoGrp);
    const mao = brancas.slice(4, 10);
    mao.forEach((t, i) => {
      const c = criar(t, false);
      this.maoGrp!.add(c.group); // re-parenta da cena pro leque
      const k = i - (mao.length - 1) / 2;
      c.group.position.set(k * 0.55, -Math.abs(k) * 0.06, i * 0.015);
      c.group.rotation.y = -k * 0.1;
      c.group.rotation.z = -k * 0.1; // cartas abrem como num leque segurado
      c.mesh.rotation.x = -0.35;
      c.fixarBase();
      this.entrarDoAlto(c, agora + 1.2 + i * 0.08);
    });
    this.posicionarMao(this.atoAtual);

    // pilha de compra
    const pilha = new Carta(verso, verso, COR.ink);
    pilha.group.position.set(-2.6, 0.1, -1.6);
    pilha.group.scale.setScalar(1);
    pilha.group.rotation.y = -0.3;
    pilha.mesh.scale.z = 14; // pilha gorda
    pilha.deitarVirada();
    pilha.fixarBase();
    this.scene.add(pilha.group);
    this.cartas.push(pilha);
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
    x.font = `700 22px ${fontFamily('--font-archivo-black', 'sans-serif')}`;
    x.textAlign = 'center';
    x.textBaseline = 'middle';
    x.fillText(texto, 128, 51, 210);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.generateMipmaps = false;
    return tex;
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

  private onPointerMove = (e: PointerEvent) => {
    const r = this.canvas.getBoundingClientRect();
    this.pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  };

  private onPrimeiroGesto = () => {
    iniciarAmbiente();
  };

  setSomAtivo(ativo: boolean) {
    if (ativo) iniciarAmbiente();
    else pararAmbiente();
  }

  private onClick = () => {
    const hit = this.provaSobOPonteiro();
    if (hit) {
      hit.flip();
      somCarta();
    }
  };

  private provaSobOPonteiro(): Carta | null {
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const alvos = this.provas.map((p) => p.mesh);
    const hits = this.raycaster.intersectObjects(alvos, false);
    if (!hits.length) return null;
    return (hits[0].object.userData.carta as Carta) ?? null;
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

    // lâmpada: balanço lento + zumbido elétrico + apagões de susto
    this.pendulo.rotation.z = Math.sin(t * 0.9) * 0.05;
    this.pendulo.rotation.x = Math.sin(t * 0.63 + 1.7) * 0.035;
    let fator = 0.94 + 0.06 * Math.sin(t * 31) * Math.sin(t * 17.3);
    if (t > this.blinkAte && Math.random() < 0.002) {
      this.blinkAte = t + 0.07 + Math.random() * 0.12;
      somZap();
    }
    if (t < this.blinkAte) fator = 0.12;
    this.spot.intensity = 170 * fator;
    this.brilho.intensity = 8 * fator;
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
      descartarObjeto(reacao.group);
      return false;
    });

    this.baloesFala = this.baloesFala.filter((balao) => {
      const k = Math.min((t - balao.t0) / balao.dur, 1);
      balao.mesh.position.y += dt * 0.045;
      balao.mesh.quaternion.copy(this.camera.quaternion);
      balao.mesh.material.opacity = k > 0.72 ? (1 - k) / 0.28 : 1;
      if (k < 1) return true;
      balao.mesh.removeFromParent();
      balao.textura.dispose();
      balao.mesh.geometry.dispose();
      balao.mesh.material.dispose();
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

    // hover nas provas
    const sob = this.provaSobOPonteiro();
    for (const p of this.provas) p.hover = p === sob;
    this.canvas.style.cursor = sob ? 'pointer' : 'grab';

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
    this.canvas.removeEventListener('pointermove', this.onPointerMove);
    this.canvas.removeEventListener('click', this.onClick);
    this.controls.dispose();
    this.timer.dispose();
    pararAmbiente();
    for (const reacao of this.reacoesVoo) descartarObjeto(reacao.group);
    for (const balao of this.baloesFala) {
      balao.mesh.removeFromParent();
      balao.textura.dispose();
      balao.mesh.geometry.dispose();
      balao.mesh.material.dispose();
    }
    for (const r of this.reus) r.dispose();
    this.rt.dispose();
    this.blitMat.dispose();
    for (const t of this.texturas) t.dispose();
    this.scene.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose();
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        mats.forEach((m) => m.dispose());
      }
    });
    this.renderer.dispose();
  }
}
