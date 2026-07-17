/**
 * reus.ts — O Júri Encapuzado: avatares do Tribunal do Porão.
 *
 * Design v3 (feedback: capuz arredondado em vez de cone pontudo; rosto com
 * boca; mãos com forma de luva de verdade; sistema de ações animadas):
 *   - túnica low-poly + capuz-domo facetado na cor do avatar
 *   - rosto = vazio preto no capuz com OLHOS E BOCA brilhantes (MeshBasic,
 *     ignoram luz). A expressão inteira mora nessa carinha luminosa.
 *   - mãos-luva flutuantes (palma + polegar + punho na cor da túnica)
 *   - ações: soco, apontar, aplaudir, festejar, facepalm, rir — ≤1.4s,
 *     interrompíveis, computadas por envelope (sobe-segura-volta)
 *   - juiz: capuz maior e olhos vermelhos; manequim: capuz vazio, sem olhos
 */
import * as THREE from 'three';

export type Expressao = 'neutro' | 'riso' | 'choque' | 'desprezo' | 'sono';
export const EXPRESSOES: Expressao[] = ['neutro', 'riso', 'choque', 'desprezo', 'sono'];

export type Acao = 'soco' | 'apontar' | 'aplaudir' | 'festejar' | 'facepalm' | 'rir';
export const ACOES: Acao[] = ['soco', 'apontar', 'aplaudir', 'festejar', 'facepalm', 'rir'];

const DURACAO: Record<Acao, number> = {
  soco: 0.3,
  apontar: 1.1,
  aplaudir: 1.0,
  festejar: 1.1,
  facepalm: 1.4,
  rir: 1.2,
};

const INK = '#17161a';
const CREME = '#f2efe9';

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

/** Envelope sobe-segura-volta: 0→1 até `sobe`, 1 até `volta`, 1→0 no fim. */
function pulso(k: number, sobe = 0.2, volta = 0.75): number {
  if (k <= 0 || k >= 1) return 0;
  if (k < sobe) return k / sobe;
  if (k > volta) return 1 - (k - volta) / (1 - volta);
  return 1;
}

/**
 * Carinha brilhante 64x48 — olhos E boca sobre fundo transparente.
 * É o que se lê a qualquer distância; o resto do rosto é breu.
 */
function drawRosto(exp: Expressao, cor: string): THREE.CanvasTexture {
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
      x.fillRect(24, 34, 16, 4); // boca reta
      break;
    case 'riso':
      olhos((cx) => {
        x.fillRect(cx - 6, 12, 4, 4); // ^^
        x.fillRect(cx - 2, 8, 4, 4);
        x.fillRect(cx + 2, 12, 4, 4);
      });
      x.fillRect(20, 30, 24, 8); // bocona aberta
      x.fillRect(24, 38, 16, 4);
      break;
    case 'choque':
      olhos((cx) => x.fillRect(cx - 6, 4, 12, 16));
      x.fillRect(26, 30, 12, 14); // queixo no chão
      break;
    case 'desprezo':
      olhos((cx) => x.fillRect(cx - 7, 10, 14, 4));
      x.fillRect(22, 38, 20, 4); // boca virada pra baixo
      x.fillRect(20, 36, 4, 4);
      x.fillRect(40, 36, 4, 4);
      break;
    case 'sono':
      olhos((cx) => x.fillRect(cx - 6, 16, 12, 3));
      x.fillRect(28, 34, 8, 6); // boquinha ressonando
      break;
  }
  return texCanvas(c);
}

/** Crachá de escritório torto na túnica. */
function drawCracha(nome: string): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 96;
  c.height = 56;
  const x = c.getContext('2d')!;
  x.fillStyle = CREME;
  x.fillRect(0, 0, 96, 56);
  x.strokeStyle = INK;
  x.lineWidth = 6;
  x.strokeRect(3, 3, 90, 50);
  x.fillStyle = INK;
  x.font = `700 20px ${fontDisplay()}`;
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  x.fillText(nome.slice(0, 6), 48, 30);
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
}

const BASE_MAO_Y = 0.28;

export class Reu {
  group = new THREE.Group();
  readonly manequim: boolean;
  expressao: Expressao = 'neutro';

  private corpo = new THREE.Group();
  private rostoMesh: THREE.Mesh | null = null;
  private rostoTex: Partial<Record<Expressao, THREE.CanvasTexture>> = {};
  private maos: THREE.Group[] = []; // [esquerda, direita]
  private baseMaos: THREE.Vector3[] = [];
  private fase = Math.random() * Math.PI * 2;
  private anim: { tipo: Acao; t: number } | null = null;
  private texturas: THREE.Texture[] = [];

  constructor(nome: string, cor: string, opts: ReuOpts = {}) {
    this.manequim = !!opts.manequim;
    const corTunica = new THREE.Color(this.manequim ? '#4a4855' : cor);
    const matTunica = new THREE.MeshLambertMaterial({ color: corTunica, flatShading: true });

    // túnica: saia larga afunilando nos ombros
    const tunica = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.78, 1.35, 7), matTunica);
    tunica.position.y = 0.4;
    tunica.castShadow = true;

    // capuz-domo facetado (juiz = maior, hierarquia por silhueta)
    const escalaCapuz = opts.juiz ? 1.2 : 1.0;
    const capuz = new THREE.Mesh(new THREE.IcosahedronGeometry(0.42, 1), matTunica);
    capuz.scale.set(escalaCapuz, 1.12 * escalaCapuz, 1.02 * escalaCapuz);
    capuz.position.y = 1.34 + (opts.juiz ? 0.06 : 0);
    capuz.rotation.x = 0.1; // debruçado sobre a mesa
    capuz.castShadow = true;

    // gola baixa — não cobre a boca
    const gola = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.4, 0.28, 7), matTunica);
    gola.position.y = 1.0;

    // o rosto é um buraco: disco preto na boca do capuz
    const rosto = new THREE.Mesh(
      new THREE.CircleGeometry(0.3, 8),
      new THREE.MeshBasicMaterial({ color: 0x0a090c })
    );
    rosto.position.set(0, 1.3, 0.42);
    rosto.rotation.x = -0.08;

    this.corpo.add(tunica, capuz, gola, rosto);

    // carinha luminosa: olhos + boca (manequim não tem — capuz vazio)
    if (!this.manequim) {
      const corRosto = opts.juiz ? '#ff3b2f' : CREME;
      for (const e of EXPRESSOES) {
        const t = drawRosto(e, corRosto);
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
      this.rostoMesh.position.set(0, 1.3, 0.45);
      this.rostoMesh.rotation.x = -0.08;
      this.corpo.add(this.rostoMesh);
    }

    // crachá torto preso na túnica — a seita bate ponto
    const tc = drawCracha(nome);
    this.texturas.push(tc);
    const cracha = new THREE.Mesh(
      new THREE.PlaneGeometry(0.44, 0.26),
      new THREE.MeshLambertMaterial({ map: tc })
    );
    cracha.position.set(0.16, 0.72, 0.56);
    cracha.rotation.x = -0.22;
    cracha.rotation.z = -0.1;
    this.corpo.add(cracha);

    if (this.manequim) {
      const tp = drawPlaqueta(nome);
      this.texturas.push(tp);
      const plaq = new THREE.Mesh(
        new THREE.PlaneGeometry(0.6, 0.34),
        new THREE.MeshLambertMaterial({ map: tp })
      );
      plaq.position.set(0, 0.55, 0.62);
      plaq.rotation.x = -0.24;
      plaq.rotation.z = 0.08;
      this.corpo.add(plaq);
    }

    this.group.add(this.corpo);

    // mãos-luva: palma facetada + polegar + punho na cor da túnica
    if (!this.manequim) {
      const matLuva = new THREE.MeshLambertMaterial({ color: '#e9e5db', flatShading: true });
      for (const lado of [-1, 1]) {
        const mao = new THREE.Group();
        const palma = new THREE.Mesh(new THREE.IcosahedronGeometry(0.15, 0), matLuva);
        palma.scale.set(0.85, 0.62, 1.05);
        palma.castShadow = true;
        const polegar = new THREE.Mesh(new THREE.IcosahedronGeometry(0.06, 0), matLuva);
        polegar.position.set(0.12 * lado, 0.02, 0.05);
        const punho = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, 0.1, 7), matTunica);
        punho.position.set(-0.02 * lado, 0.02, -0.14);
        punho.rotation.x = Math.PI / 2;
        mao.add(palma, polegar, punho);
        const base = new THREE.Vector3(0.52 * lado, BASE_MAO_Y, 0.88);
        mao.position.copy(base);
        this.baseMaos.push(base);
        this.maos.push(mao);
        this.group.add(mao);
      }
    }

    // cadeira (trono de encosto alto pro juiz)
    const matCadeira = new THREE.MeshLambertMaterial({ color: 0x1b1a20 });
    const assento = new THREE.Mesh(new THREE.BoxGeometry(1.05, 0.1, 0.95), matCadeira);
    assento.position.set(0, -0.3, -0.1);
    const encosto = new THREE.Mesh(
      new THREE.BoxGeometry(1.05, opts.juiz ? 2.6 : 1.6, 0.1),
      matCadeira
    );
    encosto.position.set(0, opts.juiz ? 1.0 : 0.5, -0.62);
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
    if (this.manequim) return;
    this.anim = { tipo, t: 0 };
    if (tipo === 'rir' || tipo === 'festejar') this.setExpressao('riso');
    if (tipo === 'facepalm') this.setExpressao('desprezo');
  }

  /** Compat: soco seco na mesa. */
  baterNaMesa() {
    this.acao('soco');
  }

  tick(t: number, dt: number) {
    // respiração base — tudo abaixo soma por cima disso
    const resp = Math.sin(t * 1.3 + this.fase);
    this.corpo.position.y = resp * 0.025;
    this.corpo.rotation.x = 0;
    this.corpo.rotation.z = Math.sin(t * 0.45 + this.fase) * 0.035;
    if (this.manequim) return;

    // pose idle das mãos (flutuando na beirada)
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
          const e = Math.sin(k * Math.PI);
          alvo[0].y -= e * 0.26;
          alvo[1].y -= e * 0.26;
          this.corpo.rotation.x = e * 0.14;
          break;
        }
        case 'apontar': {
          // dedo em riste pro centro da mesa, segurando a acusação
          const e = pulso(k, 0.18, 0.72);
          alvo[1].lerp(new THREE.Vector3(0.22, 0.9, 1.45), e);
          this.corpo.rotation.x = e * 0.12;
          break;
        }
        case 'aplaudir': {
          const e = pulso(k, 0.15, 0.85);
          const batida = Math.abs(Math.sin(k * Math.PI * 3)); // 3 palmas
          alvo[0].lerp(new THREE.Vector3(-0.1 - batida * 0.22, 0.72, 0.72), e);
          alvo[1].lerp(new THREE.Vector3(0.1 + batida * 0.22, 0.72, 0.72), e);
          break;
        }
        case 'festejar': {
          // mãos pro alto + pulinhos
          const e = pulso(k, 0.2, 0.8);
          alvo[0].lerp(new THREE.Vector3(-0.5, 1.55, 0.35), e);
          alvo[1].lerp(new THREE.Vector3(0.5, 1.55, 0.35), e);
          this.corpo.position.y += Math.abs(Math.sin(k * Math.PI * 2)) * 0.13 * e;
          break;
        }
        case 'facepalm': {
          const e = pulso(k, 0.22, 0.75);
          alvo[1].lerp(new THREE.Vector3(0.06, 1.24, 0.52), e);
          this.corpo.rotation.x = -e * 0.08; // recosta, decepcionado
          break;
        }
        case 'rir': {
          const e = pulso(k, 0.15, 0.85);
          this.corpo.rotation.z += Math.sin(t * 28) * 0.045 * e; // sacode de rir
          alvo[0].y += Math.abs(Math.sin(t * 14)) * 0.06 * e;
          alvo[1].y += Math.abs(Math.sin(t * 14 + 1)) * 0.06 * e;
          break;
        }
      }
      if (k >= 1) this.anim = null;
    }

    this.maos[0].position.copy(alvo[0]);
    this.maos[1].position.copy(alvo[1]);
  }

  dispose() {
    for (const t of this.texturas) t.dispose();
  }
}
