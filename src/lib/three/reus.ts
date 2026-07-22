/**
 * reus.ts — O Júri Encapuzado: avatares do Tribunal do Porão.
 *
 * Design v5 (capuz em ogiva, cracha ritual e aparencia curada):
 *   - túnica drapeada (LatheGeometry com perfil curvo, sombreamento suave —
 *     o filtro de pixel/TV é quem faz o retrô, não a malha)
 *   - capuz de tecido: esfera parcial com abertura funda; dentro, o vazio
 *     preto e a carinha luminosa (olhos + boca; juiz em vermelho)
 *   - corda de seita na cintura com pingente
 *   - luvas arredondadas com polegar e punho na cor da túnica
 *   - ações exageradas: antecipação, tremor, cabeça pra trás — nada tímido
 */
import * as THREE from 'three';
import {
  DEFAULT_CULTIST_APPEARANCE,
  type CultistAppearance,
  type CultistFace,
  type CultistHood,
} from '../types';
import { somSoco, somPalmas, somFesta, somRisada } from './sons3d';

export type Expressao = 'neutro' | 'riso' | 'choque' | 'desprezo' | 'sono';
export const EXPRESSOES: Expressao[] = ['neutro', 'riso', 'choque', 'desprezo', 'sono'];

export type Acao = 'soco' | 'apontar' | 'aplaudir' | 'festejar' | 'facepalm' | 'rir' | 'atingido' | 'tilt';
export type ImpactoReu = 'tomate' | 'sapato' | 'rosa';
export const ACOES: Acao[] = ['soco', 'apontar', 'aplaudir', 'festejar', 'facepalm', 'rir', 'atingido', 'tilt'];

/**
 * O tombo não é uma `Acao`: ações são pulsos que terminam e devolvem o corpo ao
 * idle. Tombar é um ESTADO terminal que substitui o idle até `levantar()`.
 */
const DURACAO_QUEDA = 1.15;

const DURACAO: Record<Acao, number> = {
  soco: 0.35,
  apontar: 1.2,
  aplaudir: 1.1,
  festejar: 1.2,
  facepalm: 1.5,
  rir: 1.3,
  atingido: 0.72,
  tilt: 1.65,
};

const PRIORIDADE: Record<Acao, number> = {
  apontar: 1,
  aplaudir: 1,
  rir: 1,
  festejar: 2,
  facepalm: 2,
  soco: 3,
  atingido: 4,
  tilt: 5,
};

const INK = '#17161a';
const CREME = '#f2efe9';
const ALTURA_ROSTO = 1.5;

const COR_ROBE: Record<CultistAppearance['robe'], string> = {
  blood: '#8f201b',
  ash: '#625d63',
  midnight: '#25243a',
  moss: '#48563b',
  violet: '#4a2a5e',
  rust: '#8a4c1f',
  abyss: '#1e4744',
  linen: '#b3a98f',
};

const COR_ACENTO: Record<CultistAppearance['accent'], string> = {
  bone: '#d8ccb2',
  brass: '#a97d3e',
  scarlet: '#ff3b2f',
  cyan: '#43d9d4',
  gold: '#e3b341',
  amethyst: '#a06bff',
};

const ESCALA_CAPUZ: Record<CultistHood, readonly [number, number, number]> = {
  classic: [1.08, 1.18, 0.98],
  spire: [1.01, 1.34, 0.95],
  // Mortalha: volume nos lados, sem empurrar tecido pra frente (z <= 1)
  shrouded: [1.15, 1.1, 0.99],
};

function texCanvas(c: HTMLCanvasElement): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  return t;
}

function fontDisplay(): string {
  if (typeof document === 'undefined') return 'sans-serif';
  const v = getComputedStyle(document.documentElement).getPropertyValue('--font-archivo-black').trim();
  return v || 'sans-serif';
}

/**
 * Textura de tecido (compartilhada): dobras verticais onduladas + fibra.
 * Grayscale claro — o `color` do material tinge na cor do avatar.
 */
let tecidoCache: THREE.CanvasTexture | null = null;
function texTecido(): THREE.CanvasTexture {
  if (tecidoCache) return tecidoCache;
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 128;
  const x = c.getContext('2d')!;
  x.fillStyle = '#cfcfcf';
  x.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 14; i++) {
    const cx = (i / 14) * 128 + Math.random() * 6;
    x.strokeStyle = Math.random() < 0.5 ? 'rgba(0,0,0,0.16)' : 'rgba(255,255,255,0.12)';
    x.lineWidth = 3 + Math.random() * 6;
    x.beginPath();
    x.moveTo(cx, -4);
    for (let yy = 0; yy <= 132; yy += 16) x.lineTo(cx + Math.sin(yy * 0.08 + i) * 5, yy);
    x.stroke();
  }
  for (let i = 0; i < 900; i++) {
    x.fillStyle = Math.random() < 0.5 ? 'rgba(0,0,0,0.10)' : 'rgba(255,255,255,0.08)';
    x.fillRect(Math.floor(Math.random() * 128), Math.floor(Math.random() * 128), 1, 1);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(3, 2);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  tecidoCache = t;
  return t;
}

/** Envelope sobe-segura-volta: 0→1 até `sobe`, 1 até `volta`, 1→0 no fim. */
function pulso(k: number, sobe = 0.2, volta = 0.75): number {
  if (k <= 0 || k >= 1) return 0;
  if (k < sobe) return k / sobe;
  if (k > volta) return 1 - (k - volta) / (1 - volta);
  return 1;
}

/**
 * Meia abertura frontal do capuz em cada latitude. A abertura nasce quase
 * fechada no cocuruto, alarga ao redor do rosto e volta a fechar sob o queixo:
 * a silhueta resultante e uma ogiva/gota, nao um triangulo recortado.
 */
function meiaAberturaOgiva(v: number, estilo: CultistHood): number {
  const pontos: Array<readonly [number, number]> = [
    [0, 0.015],
    [0.14, 0.025],
    [0.24, 0.13],
    [0.36, 0.48],
    [0.49, 0.67],
    [0.66, 0.61],
    [0.82, 0.36],
    [0.94, 0.04],
    [1, 0.015],
  ];
  let valor = pontos[pontos.length - 1][1];
  for (let i = 1; i < pontos.length; i++) {
    const anterior = pontos[i - 1];
    const atual = pontos[i];
    if (v <= atual[0]) {
      const k = THREE.MathUtils.smoothstep(v, anterior[0], atual[0]);
      valor = THREE.MathUtils.lerp(anterior[1], atual[1], k);
      break;
    }
  }
  if (estilo === 'spire') return valor * 0.9;
  // Mortalha: abertura bem maior — o tecido cai LARGO pelos lados sem nunca
  // cruzar na frente do plano do rosto (era o overlap reportado).
  if (estilo === 'shrouded') return valor * 1.24;
  return valor;
}

/** Casca esferica com recorte frontal variavel, mantendo UVs para o tecido. */
function criarCascaCapuz(estilo: CultistHood): THREE.BufferGeometry {
  const raio = 0.42;
  const colunas = 24;
  const linhas = 18;
  const posicoes: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  for (let y = 0; y <= linhas; y++) {
    const v = y / linhas;
    const theta = v * Math.PI;
    const abertura = meiaAberturaOgiva(v, estilo);
    const arcoTecido = Math.PI * 2 - abertura * 2;
    for (let x = 0; x <= colunas; x++) {
      const u = x / colunas;
      const phi = abertura + arcoTecido * u;
      const senTheta = Math.sin(theta);
      posicoes.push(
        raio * senTheta * Math.sin(phi),
        raio * Math.cos(theta),
        raio * senTheta * Math.cos(phi)
      );
      uvs.push(u, 1 - v);
    }
  }

  for (let y = 0; y < linhas; y++) {
    for (let x = 0; x < colunas; x++) {
      const a = y * (colunas + 1) + x;
      const b = a + colunas + 1;
      indices.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }

  const geometria = new THREE.BufferGeometry();
  geometria.setAttribute('position', new THREE.Float32BufferAttribute(posicoes, 3));
  geometria.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometria.setIndex(indices);
  geometria.computeVertexNormals();
  return geometria;
}

/** Aro acolchoado acompanha exatamente as duas bordas do recorte em ogiva. */
function criarAroCapuz(estilo: CultistHood, material: THREE.Material): THREE.Mesh {
  const raio = 0.42;
  const pontos: THREE.Vector3[] = [];
  const inicio = 0.105;
  const fim = 0.945;
  const amostras = 20;
  const pontoBorda = (v: number, lado: -1 | 1) => {
    const theta = v * Math.PI;
    const phi = meiaAberturaOgiva(v, estilo) * lado;
    const senTheta = Math.sin(theta);
    return new THREE.Vector3(
      raio * senTheta * Math.sin(phi),
      raio * Math.cos(theta),
      raio * senTheta * Math.cos(phi) + 0.008
    );
  };
  for (let i = 0; i <= amostras; i++) {
    pontos.push(pontoBorda(THREE.MathUtils.lerp(inicio, fim, i / amostras), -1));
  }
  for (let i = amostras; i >= 0; i--) {
    pontos.push(pontoBorda(THREE.MathUtils.lerp(inicio, fim, i / amostras), 1));
  }
  const curva = new THREE.CatmullRomCurve3(pontos, true, 'centripetal');
  const aro = new THREE.Mesh(new THREE.TubeGeometry(curva, 52, 0.027, 7, true), material);
  aro.castShadow = true;
  return aro;
}

/** Carinha brilhante 64x48 — olhos e boca sobre fundo transparente. */
/**
 * Desenha a carinha num canvas 64×48 — dois olhos e uma boca acesos.
 *
 * Exportada porque o ator glTF precisa da MESMA cara: lá o rosto é um plano
 * com material emissivo, e a expressão chega como textura injetada pelo jogo.
 * Sem isso o boneco de Blender fica com um rosto congelado enquanto o
 * procedural reage — e é a carinha que dá identidade ao cultista.
 */
export function pintarRosto(exp: Expressao, cor: string, variante: CultistFace): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 48;
  const x = c.getContext('2d')!;
  x.fillStyle = cor;
  const olhos = (draw: (cx: number) => void) => {
    draw(16);
    draw(48);
  };
  switch (exp) {
    case 'neutro':
      olhos((cx) => x.fillRect(cx - 5, 8, 10, 10));
      x.fillRect(24, 34, 16, 4);
      break;
    case 'riso':
      olhos((cx) => {
        x.fillRect(cx - 6, 12, 4, 4);
        x.fillRect(cx - 2, 8, 4, 4);
        x.fillRect(cx + 2, 12, 4, 4);
      });
      x.fillRect(20, 30, 24, 8);
      x.fillRect(24, 38, 16, 4);
      break;
    case 'choque':
      olhos((cx) => x.fillRect(cx - 6, 4, 12, 16));
      x.fillRect(26, 30, 12, 14);
      break;
    case 'desprezo':
      olhos((cx) => x.fillRect(cx - 7, 10, 14, 4));
      x.fillRect(22, 38, 20, 4);
      x.fillRect(20, 36, 4, 4);
      x.fillRect(40, 36, 4, 4);
      break;
    case 'sono':
      olhos((cx) => x.fillRect(cx - 6, 16, 12, 3));
      x.fillRect(28, 34, 8, 6);
      break;
  }
  // Um sigilo pequeno diferencia as opcoes de rosto sem prejudicar as
  // expressoes usadas durante a partida.
  if (variante === 'ember') {
    x.fillRect(30, 1, 4, 6);
    x.fillRect(27, 4, 10, 3);
  } else if (variante === 'grin' && exp !== 'riso') {
    x.fillRect(18, 29, 28, 4);
    x.fillRect(22, 33, 20, 4);
  } else if (variante === 'weeping') {
    x.fillRect(13, 20, 4, 9);
    x.fillRect(47, 20, 4, 13);
  }
  return c;
}

function drawRosto(exp: Expressao, cor: string, variante: CultistFace): THREE.CanvasTexture {
  return texCanvas(pintarRosto(exp, cor, variante));
}

/** Crachá de escritório: credencial barata de um tribunal clandestino. */
function drawCracha(nome: string): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 80;
  const x = c.getContext('2d')!;
  const gradiente = x.createLinearGradient(0, 0, 128, 80);
  gradiente.addColorStop(0, '#181719');
  gradiente.addColorStop(0.52, '#33291f');
  gradiente.addColorStop(1, '#141316');
  x.fillStyle = gradiente;
  x.fillRect(0, 0, 128, 80);
  let semente = 2166136261;
  for (const ch of nome) semente = Math.imul(semente ^ ch.charCodeAt(0), 16777619);
  for (let i = 0; i < 80; i++) {
    semente = Math.imul(semente ^ (semente >>> 13), 1274126177);
    x.fillStyle = i % 3 === 0 ? 'rgba(235,203,135,.14)' : 'rgba(0,0,0,.2)';
    x.fillRect(Math.abs(semente) % 128, Math.abs(semente >>> 8) % 80, 1 + (i % 2), 1);
  }
  x.strokeStyle = '#b18442';
  x.lineWidth = 5;
  x.strokeRect(3, 3, 122, 74);
  x.fillStyle = '#b18442';
  x.fillRect(7, 7, 114, 21);
  x.fillStyle = INK;
  x.font = `700 11px ${fontDisplay()}`;
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  x.fillText('RÉU · TURNO DA NOITE', 64, 18);
  const nomeCurto = nome.trim().toLocaleUpperCase('pt-BR').slice(0, 16) || 'SEM NOME';
  let linhas = [nomeCurto];
  if (nomeCurto.length > 9) {
    const meio = Math.floor(nomeCurto.length / 2);
    const espacos = [...nomeCurto.matchAll(/\s/g)].map((m) => m.index ?? meio);
    const corte = espacos.length
      ? espacos.reduce((melhor, atual) =>
          Math.abs(atual - meio) < Math.abs(melhor - meio) ? atual : melhor
        )
      : meio;
    linhas = [nomeCurto.slice(0, corte).trim(), nomeCurto.slice(corte).trim()].filter(Boolean);
  }
  x.fillStyle = CREME;
  x.font = `700 ${linhas.length === 1 ? 22 : 16}px ${fontDisplay()}`;
  if (linhas.length === 1) {
    x.fillText(linhas[0], 64, 49, 108);
  } else {
    x.fillText(linhas[0], 64, 43, 108);
    x.fillText(linhas[1], 64, 58, 108);
  }
  x.font = `700 9px ${fontDisplay()}`;
  x.fillText('SEM PERDÃO', 64, 68);
  return texCanvas(c);
}

/** Plaqueta pendurada no manequim (RANDO / AUSENTE). */
function drawPlaqueta(texto: string): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 72;
  const x = c.getContext('2d')!;
  x.fillStyle = '#e9e5db';
  x.fillRect(0, 0, 128, 72);
  x.strokeStyle = INK;
  x.lineWidth = 5;
  x.strokeRect(2, 2, 124, 68);
  x.fillStyle = INK;
  x.beginPath();
  x.arc(64, 12, 4, 0, Math.PI * 2);
  x.fill();
  x.font = `700 24px ${fontDisplay()}`;
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  x.fillText(texto.slice(0, 8), 64, 44);
  return texCanvas(c);
}

export interface ReuOpts {
  juiz?: boolean;
  manequim?: boolean;
  /** Aparencia curada recebida do lobby; campos ausentes usam o preset padrao. */
  appearance?: Partial<CultistAppearance>;
}

const BASE_MAO_Y = 0.28;

function criarCordao(pontos: THREE.Vector3[], material: THREE.Material): THREE.Mesh {
  const curva = new THREE.CatmullRomCurve3(pontos);
  return new THREE.Mesh(new THREE.TubeGeometry(curva, 8, 0.012, 5, false), material);
}

export class Reu {
  group = new THREE.Group();
  readonly nome: string;
  readonly manequim: boolean;
  expressao: Expressao = 'neutro';

  private corpo = new THREE.Group();
  private capuzGrp: THREE.Group | null = null;
  private crachaGrp: THREE.Group | null = null;
  private rostoMesh: THREE.Mesh | null = null;
  private rostoTex: Partial<Record<Expressao, THREE.CanvasTexture>> = {};
  private maos: THREE.Group[] = []; // [esquerda, direita]
  private baseMaos: THREE.Vector3[] = [];
  private fase = Math.random() * Math.PI * 2;
  private anim: { tipo: Acao; t: number } | null = null;
  private nivelTilt = 0;
  private texturas: THREE.Texture[] = [];
  private tombado = false;
  private quedaT = 0;
  /** Lado da queda derivado do nome: todo cliente derruba pro mesmo lado. */
  private quedaLado = 1;

  constructor(nome: string, cor: string, opts: ReuOpts = {}) {
    this.nome = nome;
    this.manequim = !!opts.manequim;
    let hashNome = 0;
    for (let i = 0; i < nome.length; i++) hashNome = (hashNome * 31 + nome.charCodeAt(i)) >>> 0;
    this.quedaLado = hashNome % 2 === 0 ? 1 : -1;
    this.group.name = 'actor-root';
    const rootAnchor = new THREE.Object3D();
    rootAnchor.name = 'actor-anchor-root';
    this.group.add(rootAnchor);
    const appearance: CultistAppearance = {
      ...DEFAULT_CULTIST_APPEARANCE,
      ...opts.appearance,
    };
    const corBase = opts.appearance?.robe ? COR_ROBE[appearance.robe] : cor;
    const corTunica = new THREE.Color(this.manequim ? '#4a4855' : corBase);
    const corAcento = new THREE.Color(COR_ACENTO[appearance.accent]);
    const emissivoTunica = corTunica.clone().multiplyScalar(0.14);
    const matTunica = new THREE.MeshLambertMaterial({
      color: corTunica,
      map: texTecido(),
      emissive: emissivoTunica,
    });

    // Túnica curta e pesada: o corpo abre pouco até a bainha. O perfil antigo
    // subia fino demais até o rosto e virava um triângulo comprido.
    const perfil = [
      [0.02, 0.0],
      [0.85, 0.02],
      [0.82, 0.28],
      [0.76, 0.58],
      [0.68, 0.86],
      [0.58, 1.1],
      [0.46, 1.3],
      [0.34, 1.42],
    ].map(([r, y]) => new THREE.Vector2(r, y));
    const tunica = new THREE.Mesh(new THREE.LatheGeometry(perfil, 20), matTunica);
    tunica.castShadow = true;

    // corda de seita na cintura + pingente caído
    const matCorda = new THREE.MeshLambertMaterial({ color: corAcento });
    const corda = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.035, 8, 20), matCorda);
    corda.position.y = 0.66;
    corda.rotation.x = Math.PI / 2;
    const pingente = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.34, 8), matCorda);
    pingente.position.set(0.18, 0.5, 0.62);

    // Cowl curto nos ombros: liga cabeça e túnica sem construir um cone até o rosto.
    const perfilCowl = [
      [0.67, 0.0],
      [0.62, 0.12],
      [0.54, 0.24],
      [0.44, 0.34],
      [0.36, 0.4],
    ].map(([r, y]) => new THREE.Vector2(r, y));
    const cowl = new THREE.Mesh(new THREE.LatheGeometry(perfilCowl, 20), matTunica);
    cowl.position.y = 1.13;
    // Mortalha: ombros mais largos SEM subir/avançar a gola na frente do
    // queixo — escalar y/z aqui cobria a boca do rosto.
    if (appearance.hood === 'shrouded') cowl.scale.set(1.12, 1.0, 1.02);
    if (appearance.hood === 'spire') cowl.scale.set(0.96, 1.04, 0.96);
    cowl.castShadow = true;

    // Capuz: mais largo/alto no topo, com abertura funda virada pra mesa.
    const capuzGrp = new THREE.Group();
    this.capuzGrp = capuzGrp;
    const formaCapuz = new THREE.Group();
    const materialCapuz = new THREE.MeshLambertMaterial({
      color: corTunica,
      map: texTecido(),
      emissive: emissivoTunica,
      side: THREE.DoubleSide,
    });
    const capuz = new THREE.Mesh(criarCascaCapuz(appearance.hood), materialCapuz);
    capuz.castShadow = true;
    const corAro = corTunica.clone().lerp(corAcento, 0.16).multiplyScalar(1.08);
    const matAro = new THREE.MeshLambertMaterial({
      color: corAro,
      map: texTecido(),
      emissive: corAro.clone().multiplyScalar(0.08),
    });
    const aroCapuz = criarAroCapuz(appearance.hood, matAro);
    formaCapuz.add(capuz, aroCapuz);
    formaCapuz.scale.set(...ESCALA_CAPUZ[appearance.hood]);
    // o vazio: esfera preta fosca preenchendo o interior — o rosto mora NELA
    const vazio = new THREE.Mesh(
      new THREE.SphereGeometry(0.37, 12, 10),
      new THREE.MeshBasicMaterial({ color: 0x0a090c })
    );
    vazio.position.z = -0.015;
    vazio.scale.set(1.04, appearance.hood === 'spire' ? 1.24 : 1.12, 0.94);
    capuzGrp.add(formaCapuz, vazio);

    // carinha luminosa DENTRO do capuz — acompanha inclinação e escala dele
    if (!this.manequim) {
      const corRosto = opts.juiz
        ? '#ff3b2f'
        : appearance.face === 'ember'
          ? '#ff784f'
          : appearance.accent === 'cyan'
            ? '#73fff7'
            : CREME;
      for (const e of EXPRESSOES) {
        const t = drawRosto(e, corRosto, appearance.face);
        this.rostoTex[e] = t;
        this.texturas.push(t);
      }
      this.rostoMesh = new THREE.Mesh(
        new THREE.PlaneGeometry(0.44, 0.33),
        new THREE.MeshBasicMaterial({
          map: this.rostoTex.neutro,
          transparent: true,
          depthWrite: false,
        })
      );
      // Ainda flutua no vazio, mas perto o bastante para pertencer à cabeça.
      // Na mortalha o rosto vem um tico à frente pra folga da borda larga.
      const zRosto = appearance.hood === 'shrouded' ? 0.35 : 0.326;
      this.rostoMesh.position.set(0, appearance.hood === 'spire' ? 0.09 : 0.07, zRosto);
      capuzGrp.add(this.rostoMesh);
    }

    capuzGrp.position.y = ALTURA_ROSTO + 0.13;
    capuzGrp.rotation.x = 0.12; // debruçado sobre a mesa
    const headAnchor = new THREE.Object3D();
    headAnchor.name = 'actor-anchor-head';
    headAnchor.position.set(0, 0.06, 0.42);
    capuzGrp.add(headAnchor);
    if (opts.juiz) {
      capuzGrp.scale.setScalar(1.18);
      capuzGrp.position.y += 0.08;
    }

    this.corpo.add(tunica, cowl, corda, pingente, capuzGrp);
    const chestAnchor = new THREE.Object3D();
    chestAnchor.name = 'actor-anchor-chest';
    chestAnchor.position.set(0, 1.02, 0.7);
    this.corpo.add(chestAnchor);

    if (!this.manequim) {
      // Crachá externo com backing e lanyard em V — a seita bate ponto.
      const tc = drawCracha(nome);
      this.texturas.push(tc);
      const crachaGrp = new THREE.Group();
      this.crachaGrp = crachaGrp;
      const matMetalCracha = new THREE.MeshLambertMaterial({
        color: corAcento.clone().lerp(new THREE.Color('#392b1c'), 0.34),
        emissive: corAcento.clone().multiplyScalar(0.035),
      });
      const backing = new THREE.Mesh(
        new THREE.BoxGeometry(0.6, 0.39, 0.038),
        matMetalCracha
      );
      const frente = new THREE.Mesh(
        new THREE.PlaneGeometry(0.56, 0.35),
        new THREE.MeshBasicMaterial({ map: tc })
      );
      frente.position.z = 0.021;
      crachaGrp.add(backing, frente);
      const nameplateAnchor = new THREE.Object3D();
      nameplateAnchor.name = 'actor-anchor-nameplate';
      nameplateAnchor.position.z = 0.04;
      crachaGrp.add(nameplateAnchor);
      // Duas argolas visiveis prendem a credencial, em vez de ela flutuar no robe.
      for (const lado of [-1, 1]) {
        const argola = new THREE.Mesh(new THREE.TorusGeometry(0.034, 0.009, 6, 12), matCorda);
        argola.position.set(0.19 * lado, 0.16, 0.031);
        const rebite = new THREE.Mesh(new THREE.SphereGeometry(0.018, 7, 5), matMetalCracha);
        rebite.position.set(0.19 * lado, 0.16, 0.038);
        crachaGrp.add(argola, rebite);
      }
      crachaGrp.position.set(0.1, 1.0, 0.735);
      crachaGrp.rotation.x = -0.17;
      crachaGrp.rotation.z = -0.065;
      const cordaoEsq = criarCordao([
        new THREE.Vector3(-0.21, 1.42, 0.38),
        new THREE.Vector3(-0.16, 1.27, 0.55),
        new THREE.Vector3(-0.09, 1.17, 0.71),
      ], matCorda);
      const cordaoDir = criarCordao([
        new THREE.Vector3(0.21, 1.42, 0.38),
        new THREE.Vector3(0.25, 1.28, 0.54),
        new THREE.Vector3(0.29, 1.17, 0.71),
      ], matCorda);
      this.corpo.add(cordaoEsq, cordaoDir, crachaGrp);
    } else {
      // Manequim usa uma única plaqueta grande; nada de crachá enterrado atrás.
      const tp = drawPlaqueta(nome);
      this.texturas.push(tp);
      const plaqGrp = new THREE.Group();
      const backing = new THREE.Mesh(
        new THREE.BoxGeometry(0.65, 0.39, 0.03),
        new THREE.MeshLambertMaterial({ color: 0x26252b })
      );
      const frente = new THREE.Mesh(
        new THREE.PlaneGeometry(0.62, 0.36),
        new THREE.MeshBasicMaterial({ map: tp })
      );
      frente.position.z = 0.017;
      plaqGrp.add(backing, frente);
      const nameplateAnchor = new THREE.Object3D();
      nameplateAnchor.name = 'actor-anchor-nameplate';
      nameplateAnchor.position.z = 0.035;
      plaqGrp.add(nameplateAnchor);
      plaqGrp.position.set(0, 0.9, 0.73);
      plaqGrp.rotation.x = -0.1;
      plaqGrp.rotation.z = 0.06;
      const cordaoEsq = criarCordao([
        new THREE.Vector3(-0.2, 1.4, 0.39),
        new THREE.Vector3(-0.24, 1.22, 0.58),
        new THREE.Vector3(-0.18, 1.09, 0.72),
      ], matCorda);
      const cordaoDir = criarCordao([
        new THREE.Vector3(0.2, 1.4, 0.39),
        new THREE.Vector3(0.24, 1.22, 0.58),
        new THREE.Vector3(0.18, 1.09, 0.72),
      ], matCorda);
      this.corpo.add(cordaoEsq, cordaoDir, plaqGrp);
    }

    if (!this.manequim && appearance.accessory !== 'none') {
      const acessorioGrp = new THREE.Group();
      const matAcessorio = new THREE.MeshLambertMaterial({
        color: corAcento,
        emissive: corAcento.clone().multiplyScalar(0.045),
      });
      if (appearance.accessory === 'chain') {
        for (let i = 0; i < 7; i++) {
          const elo = new THREE.Mesh(new THREE.TorusGeometry(0.055, 0.012, 6, 10), matAcessorio);
          elo.position.set(-0.3 + i * 0.1, 0.88 - Math.abs(3 - i) * 0.018, 0.69);
          elo.rotation.z = i % 2 === 0 ? 0.2 : -0.2;
          elo.rotation.y = i % 2 === 0 ? 0 : Math.PI / 2;
          acessorioGrp.add(elo);
        }
      } else if (appearance.accessory === 'candle') {
        const vela = new THREE.Mesh(
          new THREE.CylinderGeometry(0.045, 0.055, 0.23, 10),
          new THREE.MeshLambertMaterial({ color: '#d9cfb8' })
        );
        vela.position.set(-0.43, 1.38, 0.39);
        const chama = new THREE.Mesh(
          new THREE.SphereGeometry(0.035, 8, 6),
          new THREE.MeshBasicMaterial({ color: '#ff8d3b' })
        );
        chama.scale.set(0.7, 1.4, 0.7);
        chama.position.set(-0.43, 1.53, 0.39);
        acessorioGrp.add(vela, chama);
      } else if (appearance.accessory === 'relic') {
        const relicario = new THREE.Mesh(new THREE.OctahedronGeometry(0.09, 0), matAcessorio);
        relicario.scale.set(0.8, 1.2, 0.35);
        relicario.position.set(-0.27, 0.78, 0.69);
        relicario.rotation.z = 0.24;
        acessorioGrp.add(relicario);
      }
      this.corpo.add(acessorioGrp);
    }

    this.group.add(this.corpo);

    // luvas arredondadas: palma + polegar + punho na cor da túnica
    if (!this.manequim) {
      const matLuva = new THREE.MeshLambertMaterial({ color: '#e9e5db' });
      for (const lado of [-1, 1]) {
        const mao = new THREE.Group();
        const palma = new THREE.Mesh(new THREE.SphereGeometry(0.14, 12, 9), matLuva);
        palma.scale.set(0.9, 0.65, 1.1);
        palma.castShadow = true;
        const polegar = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), matLuva);
        polegar.position.set(0.12 * lado, 0.03, 0.06);
        const punho = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, 0.12, 12), matTunica);
        punho.position.set(-0.02 * lado, 0.02, -0.15);
        punho.rotation.x = Math.PI / 2;
        mao.add(palma, polegar, punho);
        const handAnchor = new THREE.Object3D();
        handAnchor.name = lado < 0 ? 'actor-anchor-left-hand' : 'actor-anchor-right-hand';
        handAnchor.position.set(0, 0.02, 0.12);
        mao.add(handAnchor);
        if (lado > 0) {
          const projectileAnchor = new THREE.Object3D();
          projectileAnchor.name = 'actor-anchor-projectile-origin';
          projectileAnchor.position.set(0.08, 0.06, 0.18);
          mao.add(projectileAnchor);
        }
        const base = new THREE.Vector3(0.52 * lado, BASE_MAO_Y, 0.88);
        mao.position.copy(base);
        this.baseMaos.push(base);
        this.maos.push(mao);
        this.group.add(mao);
      }
    }

    // cadeira (trono de encosto alto pro juiz) — clara o bastante pra existir
    const matCadeira = new THREE.MeshLambertMaterial({ color: 0x35333c });
    const assento = new THREE.Mesh(new THREE.BoxGeometry(1.05, 0.1, 0.95), matCadeira);
    assento.position.set(0, -0.3, -0.1);
    const encosto = new THREE.Mesh(
      new THREE.BoxGeometry(1.05, opts.juiz ? 2.8 : 1.8, 0.1),
      matCadeira
    );
    encosto.position.set(0, opts.juiz ? 1.1 : 0.6, -0.68);
    encosto.castShadow = true;
    this.group.add(assento, encosto);
  }

  setExpressao(e: Expressao) {
    this.expressao = e;
    if (this.rostoMesh && this.rostoTex[e]) {
      const m = this.rostoMesh.material as THREE.MeshBasicMaterial;
      m.map = this.rostoTex[e]!;
      m.needsUpdate = true;
    }
  }

  /** Dispara uma ação animada; a nova interrompe a atual (regra do caos). */
  acao(tipo: Acao) {
    if (this.manequim || this.tombado) return;
    if (this.anim && PRIORIDADE[this.anim.tipo] > PRIORIDADE[tipo]) return;
    this.anim = { tipo, t: 0 };
    if (tipo === 'rir' || tipo === 'festejar') this.setExpressao('riso');
    if (tipo === 'facepalm') this.setExpressao('desprezo');
    if (tipo === 'soco') this.setExpressao('desprezo');
    if (tipo === 'atingido' || tipo === 'tilt') this.setExpressao('choque');
    // trilha sonora do caos (facepalm e apontar são mudos — o silêncio é a piada)
    if (tipo === 'soco') somSoco();
    if (tipo === 'aplaudir') somPalmas(4);
    if (tipo === 'festejar') somFesta();
    if (tipo === 'rir') somRisada();
  }

  /** Impactos acumulam irritação: o segundo golpe próximo dispara tilt total. */
  receberImpacto(tipo: ImpactoReu) {
    if (this.manequim || this.tombado) return;
    if (tipo === 'rosa') {
      this.nivelTilt = Math.max(0, this.nivelTilt - 1);
      this.anim = null;
      this.setExpressao('riso');
      this.acao('festejar');
      return;
    }
    this.nivelTilt = Math.min(3, this.nivelTilt + 1);
    this.acao(this.nivelTilt >= 2 ? 'tilt' : 'atingido');
  }

  /** Compat: soco seco na mesa. */
  baterNaMesa() {
    this.acao('soco');
  }

  /**
   * Apaga o cultista: ele desaba sobre a mesa e não levanta mais. `instantaneo`
   * é para quem chega depois (reconexão, réus reconstruídos) e precisa ver o
   * resultado sem reencenar a queda.
   */
  tombar(instantaneo = false) {
    if (this.tombado) return;
    this.tombado = true;
    this.quedaT = instantaneo ? 1 : 0;
    this.anim = null;
    this.nivelTilt = 0;
    this.setExpressao('sono');
  }

  /** Devolve o corpo ao idle (partida nova, saiu do game-end). */
  levantar() {
    if (!this.tombado) return;
    this.tombado = false;
    this.quedaT = 0;
    this.setExpressao('neutro');
  }

  get caido() {
    return this.tombado;
  }

  tick(t: number, dt: number) {
    // respiração base — as ações somam por cima
    const resp = Math.sin(t * 1.3 + this.fase);
    this.corpo.position.y = resp * 0.025;
    this.corpo.rotation.x = 0;
    this.corpo.rotation.y = 0;
    this.corpo.rotation.z = Math.sin(t * 0.45 + this.fase) * 0.035;

    // Tombo: pose terminal que SUBSTITUI o idle. Quem caiu não respira, não
    // gesticula e não volta — por isso é recalculada aqui, antes de qualquer
    // ação, e não somada por cima como as outras animações.
    if (this.tombado) {
      this.quedaT = Math.min(1, this.quedaT + dt / DURACAO_QUEDA);
      const queda = this.quedaT * this.quedaT * (3 - 2 * this.quedaT);
      // um quique só, no fim da queda: o corpo bate no tampo e assenta
      const quique = this.quedaT > 0.62
        ? Math.sin(((this.quedaT - 0.62) / 0.38) * Math.PI) * 0.05
        : 0;
      this.corpo.rotation.x = 0.92 * queda - quique;
      this.corpo.rotation.z = this.quedaLado * 0.34 * queda;
      this.corpo.position.y = -0.3 * queda + quique * 0.4;
      if (this.capuzGrp) {
        // o capuz tomba junto e engole o rosto: é isso que vende "apagou"
        this.capuzGrp.rotation.x = 0.12 + 0.62 * queda;
        this.capuzGrp.rotation.z = this.quedaLado * 0.2 * queda;
      }
      if (this.crachaGrp) {
        this.crachaGrp.position.y = 1;
        this.crachaGrp.rotation.x = -0.17 + 0.5 * queda;
        this.crachaGrp.rotation.z = -0.065 - this.quedaLado * 0.3 * queda;
      }
      // manequins não têm luvas; o corpo cai do mesmo jeito
      if (this.maos.length === 2) {
        const maoY = BASE_MAO_Y - 0.62 * queda;
        for (let i = 0; i < 2; i++) {
          this.maos[i].position.set(
            this.baseMaos[i].x * (1 + 0.5 * queda),
            maoY,
            this.baseMaos[i].z + 0.34 * queda
          );
        }
      }
      return;
    }

    if (this.manequim) return;

    // pose idle das mãos (flutuando na beirada da mesa)
    const alvo: THREE.Vector3[] = [
      this.baseMaos[0].clone().setY(BASE_MAO_Y + Math.sin(t * 2.1 + this.fase) * 0.03),
      this.baseMaos[1].clone().setY(BASE_MAO_Y + Math.cos(t * 1.8 + this.fase) * 0.03),
    ];

    if (this.anim) {
      const a = this.anim;
      a.t += dt / DURACAO[a.tipo];
      const k = Math.min(a.t, 1);
      switch (a.tipo) {
        case 'soco': {
          // antecipação: sobe rápido, CRAVA na mesa, volta
          let dy: number;
          if (k < 0.35) dy = 0.22 * (k / 0.35);
          else dy = Math.max(0.22 - 0.56 * Math.sin(((k - 0.35) / 0.65) * Math.PI), -0.26);
          alvo[0].y += dy;
          alvo[1].y += dy;
          this.corpo.rotation.x = 0.24 * Math.sin(k * Math.PI);
          break;
        }
        case 'apontar': {
          // dedo em riste, tremendo de raiva enquanto acusa
          const e = pulso(k, 0.15, 0.75);
          const tremor = e >= 1 ? Math.sin(t * 22) * 0.025 : 0;
          alvo[1].lerp(new THREE.Vector3(0.24 + tremor, 0.95 + tremor, 1.6), e);
          this.corpo.rotation.x = e * 0.18;
          break;
        }
        case 'aplaudir': {
          const e = pulso(k, 0.12, 0.85);
          const batida = Math.abs(Math.sin(k * Math.PI * 4)); // 4 palmas
          alvo[0].lerp(new THREE.Vector3(-0.06 - batida * 0.26, 0.85, 0.75), e);
          alvo[1].lerp(new THREE.Vector3(0.06 + batida * 0.26, 0.85, 0.75), e);
          this.corpo.rotation.z += Math.sin(k * Math.PI * 8) * 0.025 * e;
          break;
        }
        case 'festejar': {
          // mãos pro alto abanando + pulinhos
          const e = pulso(k, 0.18, 0.8);
          const abanoL = Math.sin(t * 10) * 0.1 * e;
          const abanoR = Math.sin(t * 10 + Math.PI) * 0.1 * e;
          alvo[0].lerp(new THREE.Vector3(-0.55 + abanoL, 1.85, 0.3), e);
          alvo[1].lerp(new THREE.Vector3(0.55 + abanoR, 1.85, 0.3), e);
          this.corpo.position.y += Math.abs(Math.sin(k * Math.PI * 3)) * 0.18 * e;
          break;
        }
        case 'facepalm': {
          // mão na cara + balançando a cabeça em negação
          const e = pulso(k, 0.2, 0.72);
          alvo[1].lerp(new THREE.Vector3(0.06, ALTURA_ROSTO + 0.02, 0.55), e);
          this.corpo.rotation.x = -e * 0.1;
          this.corpo.rotation.y = Math.sin(t * 9) * 0.08 * e;
          break;
        }
        case 'rir': {
          // gargalhada: cabeça pra trás, mãos na barriga, sacudindo inteiro
          const e = pulso(k, 0.15, 0.85);
          this.corpo.rotation.x = -0.16 * e;
          this.corpo.rotation.z += Math.sin(t * 26) * 0.05 * e;
          alvo[0].lerp(new THREE.Vector3(-0.28, 0.6 + Math.abs(Math.sin(t * 13)) * 0.07, 0.6), e);
          alvo[1].lerp(new THREE.Vector3(0.28, 0.6 + Math.abs(Math.sin(t * 13 + 1)) * 0.07, 0.6), e);
          break;
        }
        case 'atingido': {
          // Recoil seco, mãos protegendo o vazio e capuz chegando atrasado.
          const impacto = Math.sin(Math.min(1, k / 0.42) * Math.PI);
          const recupera = 1 - Math.max(0, (k - 0.42) / 0.58);
          const e = impacto * Math.max(0.25, recupera);
          alvo[0].lerp(new THREE.Vector3(-0.2, 1.15, 0.72), e);
          alvo[1].lerp(new THREE.Vector3(0.2, 1.15, 0.72), e);
          this.corpo.rotation.x = -0.3 * e;
          this.corpo.rotation.z += Math.sin(k * Math.PI * 7) * 0.08 * recupera;
          this.corpo.position.y += impacto * 0.08;
          break;
        }
        case 'tilt': {
          // Tilt total: recua, treme, abre os braços e martela a mesa duas vezes.
          const e = pulso(k, 0.09, 0.9);
          const raiva = Math.sin(k * Math.PI * 8);
          const pancada = Math.max(0, -Math.sin(k * Math.PI * 4));
          alvo[0].lerp(new THREE.Vector3(-0.72, 1.22 - pancada * 0.62, 0.92), e);
          alvo[1].lerp(new THREE.Vector3(0.72, 1.22 - pancada * 0.62, 0.92), e);
          this.corpo.rotation.x = (0.16 + pancada * 0.2) * e;
          this.corpo.rotation.y = raiva * 0.08 * e;
          this.corpo.rotation.z += Math.sin(t * 38) * 0.055 * e;
          this.corpo.position.y += Math.abs(raiva) * 0.07 * e;
          break;
        }
      }
      if (k >= 1) {
        if (a.tipo === 'atingido' || a.tipo === 'tilt') this.setExpressao('desprezo');
        this.anim = null;
      }
    }

    // Capuz e credencial chegam uma fração depois do tronco. É movimento
    // secundário curto, suficiente para vender peso sem virar gelatina.
    if (this.capuzGrp) {
      this.capuzGrp.rotation.x = 0.12 - this.corpo.rotation.x * 0.1 + resp * 0.008;
      this.capuzGrp.rotation.z = -this.corpo.rotation.z * 0.16 + Math.sin(t * 0.8 + this.fase) * 0.008;
    }
    if (this.crachaGrp) {
      this.crachaGrp.position.y = 1 + Math.abs(this.corpo.position.y) * 0.1;
      this.crachaGrp.rotation.x = -0.17 + this.corpo.rotation.x * 0.24 + resp * 0.012;
      this.crachaGrp.rotation.z = -0.065 - this.corpo.rotation.z * 0.42;
    }

    this.maos[0].position.copy(alvo[0]);
    this.maos[1].position.copy(alvo[1]);
  }

  dispose() {
    for (const t of this.texturas) t.dispose();
  }
}
