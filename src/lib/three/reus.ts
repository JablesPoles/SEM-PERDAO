/**
 * reus.ts — O Júri Encapuzado: avatares do Tribunal do Porão.
 *
 * Design v4 (feedback: menos low-poly/goofy, mais cultista de verdade):
 *   - túnica drapeada (LatheGeometry com perfil curvo, sombreamento suave —
 *     o filtro de pixel/TV é quem faz o retrô, não a malha)
 *   - capuz de tecido: esfera parcial com abertura funda; dentro, o vazio
 *     preto e a carinha luminosa (olhos + boca; juiz em vermelho)
 *   - corda de seita na cintura com pingente
 *   - luvas arredondadas com polegar e punho na cor da túnica
 *   - ações exageradas: antecipação, tremor, cabeça pra trás — nada tímido
 */
import * as THREE from 'three';

export type Expressao = 'neutro' | 'riso' | 'choque' | 'desprezo' | 'sono';
export const EXPRESSOES: Expressao[] = ['neutro', 'riso', 'choque', 'desprezo', 'sono'];

export type Acao = 'soco' | 'apontar' | 'aplaudir' | 'festejar' | 'facepalm' | 'rir';
export const ACOES: Acao[] = ['soco', 'apontar', 'aplaudir', 'festejar', 'facepalm', 'rir'];

const DURACAO: Record<Acao, number> = {
  soco: 0.35,
  apontar: 1.2,
  aplaudir: 1.1,
  festejar: 1.2,
  facepalm: 1.5,
  rir: 1.3,
};

const INK = '#17161a';
const CREME = '#f2efe9';
const ALTURA_ROSTO = 1.5;

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

/** Carinha brilhante 64x48 — olhos E boca sobre fundo transparente. */
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
    const matTunica = new THREE.MeshLambertMaterial({ color: corTunica });

    // túnica drapeada: perfil curvo (bainha larga, cintura, ombros caídos)
    const perfil = [
      [0.02, 0.0],
      [0.85, 0.02],
      [0.8, 0.28],
      [0.66, 0.62],
      [0.54, 0.95],
      [0.46, 1.2],
      [0.38, 1.42],
      [0.31, 1.56],
      [0.17, 1.68],
    ].map(([r, y]) => new THREE.Vector2(r, y));
    const tunica = new THREE.Mesh(new THREE.LatheGeometry(perfil, 20), matTunica);
    tunica.castShadow = true;

    // corda de seita na cintura + pingente caído
    const matCorda = new THREE.MeshLambertMaterial({ color: 0xbfb49a });
    const corda = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.035, 8, 20), matCorda);
    corda.position.y = 0.66;
    corda.rotation.x = Math.PI / 2;
    const pingente = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.34, 8), matCorda);
    pingente.position.set(0.18, 0.5, 0.62);

    // capuz: esfera parcial com abertura funda virada pra mesa
    const capuzGrp = new THREE.Group();
    const capuz = new THREE.Mesh(
      new THREE.SphereGeometry(0.42, 20, 14, 0, Math.PI * 1.55),
      new THREE.MeshLambertMaterial({ color: corTunica, side: THREE.DoubleSide })
    );
    capuz.rotation.y = Math.PI / 2 + (Math.PI * 0.45) / 2; // abertura centrada em +z
    capuz.castShadow = true;
    // o vazio: esfera preta fosca preenchendo o interior
    const vazio = new THREE.Mesh(
      new THREE.SphereGeometry(0.33, 12, 10),
      new THREE.MeshBasicMaterial({ color: 0x0a090c })
    );
    vazio.position.z = -0.04;
    capuzGrp.add(capuz, vazio);
    capuzGrp.position.y = ALTURA_ROSTO + 0.08;
    capuzGrp.rotation.x = 0.12; // debruçado sobre a mesa
    if (opts.juiz) {
      capuzGrp.scale.setScalar(1.18);
      capuzGrp.position.y += 0.08;
    }

    this.corpo.add(tunica, corda, pingente, capuzGrp);

    // carinha luminosa (manequim não tem — capuz vazio)
    if (!this.manequim) {
      const corRosto = opts.juiz ? '#ff3b2f' : CREME;
      for (const e of EXPRESSOES) {
        const t = drawRosto(e, corRosto);
        this.rostoTex[e] = t;
        this.texturas.push(t);
      }
      this.rostoMesh = new THREE.Mesh(
        new THREE.PlaneGeometry(0.42, 0.32),
        new THREE.MeshBasicMaterial({
          map: this.rostoTex.neutro,
          transparent: true,
          depthWrite: false,
        })
      );
      this.rostoMesh.position.set(0, ALTURA_ROSTO, 0.4);
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
    cracha.position.set(0.17, 1.08, 0.47);
    cracha.rotation.x = -0.24;
    cracha.rotation.z = -0.1;
    this.corpo.add(cracha);

    if (this.manequim) {
      const tp = drawPlaqueta(nome);
      this.texturas.push(tp);
      const plaq = new THREE.Mesh(
        new THREE.PlaneGeometry(0.6, 0.34),
        new THREE.MeshLambertMaterial({ map: tp })
      );
      plaq.position.set(0, 0.9, 0.56);
      plaq.rotation.x = -0.26;
      plaq.rotation.z = 0.08;
      this.corpo.add(plaq);
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
    if (this.manequim) return;
    this.anim = { tipo, t: 0 };
    if (tipo === 'rir' || tipo === 'festejar') this.setExpressao('riso');
    if (tipo === 'facepalm') this.setExpressao('desprezo');
    if (tipo === 'soco') this.setExpressao('desprezo');
  }

  /** Compat: soco seco na mesa. */
  baterNaMesa() {
    this.acao('soco');
  }

  tick(t: number, dt: number) {
    // respiração base — as ações somam por cima
    const resp = Math.sin(t * 1.3 + this.fase);
    this.corpo.position.y = resp * 0.025;
    this.corpo.rotation.x = 0;
    this.corpo.rotation.y = 0;
    this.corpo.rotation.z = Math.sin(t * 0.45 + this.fase) * 0.035;
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
