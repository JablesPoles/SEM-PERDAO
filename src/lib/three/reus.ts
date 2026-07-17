/**
 * reus.ts — O Júri Encapuzado: avatares do Tribunal do Porão.
 *
 * Design v2 (feedback: silhueta simples e imediatamente reconhecível, vibe
 * Buckshot Roulette, membros soltos estilo Rayman):
 *   - túnica low-poly com capuz pontudo, na cor do avatar
 *   - rosto = VAZIO preto dentro do capuz, com olhos brilhantes (MeshBasic,
 *     ignoram luz — brilham no escuro). A expressão mora nos olhos.
 *   - mãos-luva flutuantes, sem braços
 *   - crachá de escritório preso na túnica (o humor: seita com crachá)
 *   - juiz: capuz mais alto e OLHOS VERMELHOS (vermelho = veredito)
 *   - manequim (bot/ausente): túnica vazia, capuz sem olhos, plaqueta
 *
 * Customização futura: forma/cor dos olhos, formato do capuz, adereços em
 * cima do capuz, rabiscos no crachá.
 */
import * as THREE from 'three';

export type Expressao = 'neutro' | 'riso' | 'choque' | 'desprezo' | 'sono';
export const EXPRESSOES: Expressao[] = ['neutro', 'riso', 'choque', 'desprezo', 'sono'];

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

/**
 * Olhos brilhantes 64x28 — só os olhos, sobre fundo transparente.
 * A expressão inteira é desenhada aqui: é o que se lê a qualquer distância.
 */
function drawOlhos(exp: Expressao, cor: string): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 28;
  const x = c.getContext('2d')!;
  x.fillStyle = cor;
  const par = (draw: (cx: number) => void) => {
    draw(16);
    draw(48);
  };
  switch (exp) {
    case 'neutro': // dois quadrados acesos
      par((cx) => x.fillRect(cx - 5, 8, 10, 10));
      break;
    case 'riso': // olhinhos felizes ^^ (chevrons)
      par((cx) => {
        x.fillRect(cx - 6, 12, 4, 4);
        x.fillRect(cx - 2, 8, 4, 4);
        x.fillRect(cx + 2, 12, 4, 4);
      });
      break;
    case 'choque': // arregalados
      par((cx) => x.fillRect(cx - 6, 4, 12, 18));
      break;
    case 'desprezo': // frestas desconfiadas
      par((cx) => x.fillRect(cx - 7, 11, 14, 4));
      break;
    case 'sono': // apagados, quase fechados
      par((cx) => x.fillRect(cx - 6, 18, 12, 3));
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

export class Reu {
  group = new THREE.Group();
  readonly manequim: boolean;
  expressao: Expressao = 'neutro';

  private corpo = new THREE.Group(); // túnica + capuz + rosto — balança junto
  private olhos: THREE.Mesh | null = null;
  private olhosTex: Partial<Record<Expressao, THREE.CanvasTexture>> = {};
  private maos: THREE.Mesh[] = [];
  private fase = Math.random() * Math.PI * 2;
  private slamT = -1;
  private texturas: THREE.Texture[] = [];

  constructor(nome: string, cor: string, opts: ReuOpts = {}) {
    this.manequim = !!opts.manequim;
    const corTunica = new THREE.Color(this.manequim ? '#4a4855' : cor);
    const matTunica = new THREE.MeshLambertMaterial({ color: corTunica, flatShading: true });

    // túnica: saia larga afunilando nos ombros — a silhueta é UM cone encurvado
    const tunica = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.78, 1.35, 7), matTunica);
    tunica.position.y = 0.4;
    tunica.castShadow = true;

    // capuz pontudo (o do juiz é mais alto — hierarquia por silhueta)
    const alturaCapuz = opts.juiz ? 1.15 : 0.8;
    const capuz = new THREE.Mesh(new THREE.ConeGeometry(0.4, alturaCapuz, 7), matTunica);
    capuz.position.y = 1.08 + alturaCapuz / 2;
    capuz.rotation.x = 0.09; // levemente debruçado sobre a mesa
    capuz.castShadow = true;

    // a gola preenche o vão entre túnica e capuz
    const gola = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.44, 0.35, 7), matTunica);
    gola.position.y = 1.05;

    // o rosto é um buraco: disco preto fosco dentro do capuz
    const rosto = new THREE.Mesh(
      new THREE.CircleGeometry(0.26, 8),
      new THREE.MeshBasicMaterial({ color: 0x0a090c })
    );
    rosto.position.set(0, 1.22, 0.31);
    rosto.rotation.x = -0.06;

    this.corpo.add(tunica, capuz, gola, rosto);

    // olhos brilhantes — a expressão inteira (manequim não tem: capuz vazio)
    if (!this.manequim) {
      const corOlhos = opts.juiz ? '#ff3b2f' : CREME;
      for (const e of EXPRESSOES) {
        const t = drawOlhos(e, corOlhos);
        this.olhosTex[e] = t;
        this.texturas.push(t);
      }
      this.olhos = new THREE.Mesh(
        new THREE.PlaneGeometry(0.42, 0.18),
        new THREE.MeshBasicMaterial({
          map: this.olhosTex.neutro,
          transparent: true,
          depthWrite: false,
        })
      );
      this.olhos.position.set(0, 1.24, 0.33);
      this.olhos.rotation.x = -0.06;
      this.corpo.add(this.olhos);
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

    // mãos-luva flutuantes repousando na beirada da mesa (Rayman de seita)
    if (!this.manequim) {
      const matMao = new THREE.MeshLambertMaterial({ color: '#e9e5db', flatShading: true });
      for (const lado of [-1, 1]) {
        const mao = new THREE.Group();
        const palma = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.14, 0.28), matMao);
        const polegar = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.1, 0.12), matMao);
        polegar.position.set(0.13 * lado, 0.01, -0.04);
        palma.castShadow = true;
        mao.add(palma, polegar);
        mao.position.set(0.52 * lado, 0.28, 0.88);
        this.maos.push(palma);
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
    if (this.olhos && this.olhosTex[e]) {
      (this.olhos.material as THREE.MeshBasicMaterial).map = this.olhosTex[e]!;
      (this.olhos.material as THREE.MeshBasicMaterial).needsUpdate = true;
    }
  }

  /** Mão desce num soco seco na mesa (≤300ms, regra do caos). */
  baterNaMesa() {
    if (!this.manequim && this.slamT < 0) this.slamT = 0;
  }

  tick(t: number, dt: number) {
    // respiração: o corpo inteiro sobe/desce e o capuz oscila — sem esticar malha
    const resp = Math.sin(t * 1.3 + this.fase);
    this.corpo.position.y = resp * 0.025;
    this.corpo.rotation.z = Math.sin(t * 0.45 + this.fase) * 0.035;
    if (this.manequim) return;

    const hover = 0.28;
    if (this.slamT >= 0) {
      this.slamT += dt / 0.3;
      const k = Math.min(this.slamT, 1);
      const soco = Math.sin(k * Math.PI);
      for (const m of this.maos) m.parent!.position.y = hover - soco * 0.24;
      this.corpo.rotation.x = soco * 0.14;
      if (k >= 1) {
        this.slamT = -1;
        this.corpo.rotation.x = 0;
      }
    } else {
      this.maos[0].parent!.position.y = hover + Math.sin(t * 2.1 + this.fase) * 0.03;
      this.maos[1].parent!.position.y = hover + Math.cos(t * 1.8 + this.fase) * 0.03;
    }
  }

  dispose() {
    for (const t of this.texturas) t.dispose();
  }
}
