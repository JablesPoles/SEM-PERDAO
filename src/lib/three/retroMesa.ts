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

// Paleta "Brutal Minimal — Sem Perdão" (mesmos tokens do globals.css)
const COR = {
  ink: 0x17161a,
  panel: 0x26252b,
  paper: 0xf2efe9,
  card: 0xffffff,
  red: 0xff3b2f,
  mesa: 0x2a2830,
};

const CARD_W = 0.82;
const CARD_H = 1.15;
const CARD_T = 0.015; // espessura — cartas são caixas finas pra ter borda chanfrada

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
  private clock = new THREE.Clock();
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2(-2, -2);
  private cartas: Carta[] = [];
  private provas: Carta[] = [];
  private raf = 0;
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

    this.camera = new THREE.PerspectiveCamera(50, 1, 0.1, 60);
    this.camera.position.set(0, 5.4, 7.4);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.target.set(0, 0.4, 0);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.autoRotate = true;
    this.controls.autoRotateSpeed = 0.7;
    this.controls.minDistance = 4.5;
    this.controls.maxDistance = 13;
    this.controls.maxPolarAngle = Math.PI / 2.15;
    this.controls.minPolarAngle = Math.PI / 5;
    this.controls.enablePan = false;

    // névoa fecha o vazio ao redor da mesa
    this.scene.background = new THREE.Color(0x131217);
    this.scene.fog = new THREE.Fog(0x131217, 11, 28);

    this.montarCenario();
    this.montarCartas(opts.pretas, opts.brancas);

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
        uLevels: { value: 7.0 },
        uDither: { value: 0.9 },
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
        varying vec2 vUv;
        void main() {
          vec3 c = texture2D(tDiffuse, vUv).rgb;
          // dithering ordenado (Bayer 4x4) + posterização de cor
          float limiar = texture2D(tBayer, gl_FragCoord.xy / 4.0).r - 0.5;
          c += limiar * (uDither / uLevels);
          c = floor(c * uLevels + 0.5) / uLevels;
          gl_FragColor = vec4(c, 1.0);
        }
      `,
      depthTest: false,
      depthWrite: false,
    });
    this.blitScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.blitMat));

    this.resize();
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

  private montarCenario() {
    // luz: hemisfério creme/tinta + chave quente + recorte vermelho (assinatura SP)
    const ambiente = new THREE.HemisphereLight(0xf2efe9, 0x26252b, 1.1);
    const chave = new THREE.DirectionalLight(0xfff4e0, 2.2);
    chave.position.set(3, 8, 4);
    chave.castShadow = true;
    chave.shadow.mapSize.set(512, 512); // sombra de baixa resolução, de propósito
    chave.shadow.camera.left = -6;
    chave.shadow.camera.right = 6;
    chave.shadow.camera.top = 6;
    chave.shadow.camera.bottom = -6;
    const recorte = new THREE.DirectionalLight(COR.red, 1.2);
    recorte.position.set(-6, 2.5, -6);
    this.scene.add(ambiente, chave, recorte);

    // mesa: cilindro baixo e largo, com friso vermelho na borda
    const tampo = new THREE.Mesh(
      new THREE.CylinderGeometry(4.4, 4.4, 0.5, 24),
      new THREE.MeshLambertMaterial({ color: COR.mesa })
    );
    tampo.position.y = -0.26;
    tampo.receiveShadow = true;
    const friso = new THREE.Mesh(
      new THREE.TorusGeometry(4.4, 0.055, 6, 48),
      new THREE.MeshLambertMaterial({ color: COR.red })
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
      new THREE.MeshLambertMaterial({ color: 0x141318 })
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

    // mão em leque na beirada de trás (do ponto de vista inicial da câmera é a "sua" mão)
    const mao = brancas.slice(4, 10);
    mao.forEach((t, i) => {
      const c = criar(t, false);
      const k = i - (mao.length - 1) / 2;
      c.group.position.set(k * 0.62, 0.6 + Math.abs(k) * -0.04, 3.35);
      c.group.rotation.y = -k * 0.14;
      c.mesh.rotation.x = -0.35; // em pé, inclinada pra câmera
      c.fixarBase();
      this.entrarDoAlto(c, agora + 1.2 + i * 0.08);
    });

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
      t0: this.clock.getElapsedTime() + atraso,
      dur: 0.7,
    };
  }

  private onPointerMove = (e: PointerEvent) => {
    const r = this.canvas.getBoundingClientRect();
    this.pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  };

  private onClick = () => {
    const hit = this.provaSobOPonteiro();
    if (hit) hit.flip();
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
    this.camera.aspect = w / h;
    // em tela estreita (celular em pé) abre o FOV pra mesa inteira caber
    this.camera.fov = this.camera.aspect < 0.9 ? 66 : 50;
    this.camera.updateProjectionMatrix();
  }

  private loop = () => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);
    const dt = Math.min(this.clock.getDelta(), 0.05);
    const t = this.clock.getElapsedTime();

    this.controls.update();

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

    // 1º passe: cena → render target pequeno
    this.renderer.setRenderTarget(this.rt);
    this.renderer.render(this.scene, this.camera);
    // 2º passe: quad fullscreen com posterização + dithering
    this.renderer.setRenderTarget(null);
    this.renderer.render(this.blitScene, this.blitCam);
  };

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.canvas.removeEventListener('pointermove', this.onPointerMove);
    this.canvas.removeEventListener('click', this.onClick);
    this.controls.dispose();
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
