/**
 * reus.ts — Os Réus: avatares low-poly sentados à mesa do Tribunal do Porão.
 *
 * Anatomia (ver ref/CONCEITO-MESA-3D.md §4):
 *   - busto low-poly na cor do avatar + crachá com o nome no peito
 *   - rosto = sprite pixelado 32x32 com expressões trocadas a seco
 *   - mãos-luva flutuantes estilo Rayman (sem braços, zero rigging)
 *   - juiz ganha capuz e cadeira alta; manequim = ausente/bot
 */
import * as THREE from 'three';

export type Expressao = 'neutro' | 'riso' | 'choque' | 'desprezo' | 'sono';
export const EXPRESSOES: Expressao[] = ['neutro', 'riso', 'choque', 'desprezo', 'sono'];

const INK = '#17161a';

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

/** Rosto pixelado 32x32 — feições em tinta sobre fundo transparente. */
function drawFace(exp: Expressao): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 32;
  c.height = 32;
  const x = c.getContext('2d')!;
  x.fillStyle = INK;
  switch (exp) {
    case 'neutro':
      x.fillRect(8, 11, 4, 5);
      x.fillRect(20, 11, 4, 5);
      x.fillRect(12, 22, 8, 2);
      break;
    case 'riso':
      x.fillRect(8, 12, 4, 2);
      x.fillRect(20, 12, 4, 2);
      x.fillRect(11, 19, 10, 6); // boca escancarada
      x.fillStyle = '#f2efe9';
      x.fillRect(12, 19, 8, 2); // dentes
      break;
    case 'choque':
      x.fillRect(7, 9, 5, 7);
      x.fillRect(20, 9, 5, 7);
      x.fillRect(13, 19, 6, 8); // queixo caído
      break;
    case 'desprezo':
      x.fillRect(7, 9, 6, 2); // sobrancelhas pesadas
      x.fillRect(19, 9, 6, 2);
      x.fillRect(8, 13, 4, 3); // olhos meio fechados
      x.fillRect(20, 13, 4, 3);
      x.fillRect(11, 22, 10, 2);
      break;
    case 'sono':
      x.fillRect(8, 14, 5, 2); // olhos fechados
      x.fillRect(19, 14, 5, 2);
      x.fillRect(14, 22, 4, 3); // boquinha aberta
      break;
  }
  return texCanvas(c);
}

/** Crachá de escritório torto no peito. */
function drawCracha(nome: string): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 96;
  c.height = 56;
  const x = c.getContext('2d')!;
  x.fillStyle = '#f2efe9';
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

/** Plaqueta pendurada no pescoço do manequim (RANDO / AUSENTE). */
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
  x.arc(64, 12, 4, 0, Math.PI * 2); // furo do barbante
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

  private tronco: THREE.Mesh;
  private cabecaGrp = new THREE.Group();
  private maos: THREE.Mesh[] = [];
  private sprite: THREE.Sprite | null = null;
  private faces: Partial<Record<Expressao, THREE.SpriteMaterial>> = {};
  private fase = Math.random() * Math.PI * 2;
  private slamT = -1;
  private texturas: THREE.Texture[] = [];

  constructor(nome: string, cor: string, opts: ReuOpts = {}) {
    this.manequim = !!opts.manequim;
    const corBase = new THREE.Color(this.manequim ? '#d8d4cb' : cor);

    // busto: cilindro de 7 lados, facetado de propósito
    this.tronco = new THREE.Mesh(
      new THREE.CylinderGeometry(0.4, 0.62, 1.25, 7),
      new THREE.MeshLambertMaterial({ color: corBase, flatShading: true })
    );
    this.tronco.position.y = 0.35;
    this.tronco.castShadow = true;

    const corCabeca = corBase.clone().lerp(new THREE.Color('#f2efe9'), this.manequim ? 0 : 0.3);
    const cabeca = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.35, 0),
      new THREE.MeshLambertMaterial({ color: corCabeca, flatShading: true })
    );
    cabeca.castShadow = true;
    this.cabecaGrp.position.y = 1.28;
    this.cabecaGrp.add(cabeca);

    // rosto: sprite sempre de frente pra câmera, encostado na cabeça
    if (!this.manequim) {
      for (const e of EXPRESSOES) {
        const t = drawFace(e);
        this.texturas.push(t);
        this.faces[e] = new THREE.SpriteMaterial({ map: t, transparent: true, depthWrite: false });
      }
      this.sprite = new THREE.Sprite(this.faces.neutro!);
      this.sprite.scale.setScalar(0.5);
      this.sprite.position.set(0, 0, 0.33);
      this.cabecaGrp.add(this.sprite);
    }

    // capuz do juiz
    if (opts.juiz) {
      const capuz = new THREE.Mesh(
        new THREE.ConeGeometry(0.4, 0.6, 6),
        new THREE.MeshLambertMaterial({ color: INK, flatShading: true })
      );
      capuz.position.y = 0.42;
      capuz.rotation.y = 0.4;
      capuz.castShadow = true;
      this.cabecaGrp.add(capuz);
    }

    // crachá torto no peito
    const tc = drawCracha(nome);
    this.texturas.push(tc);
    const cracha = new THREE.Mesh(
      new THREE.PlaneGeometry(0.42, 0.24),
      new THREE.MeshLambertMaterial({ map: tc })
    );
    cracha.position.set(0.14, 0.62, 0.5);
    cracha.rotation.x = -0.12;
    cracha.rotation.z = -0.08;

    // plaqueta do manequim
    if (this.manequim) {
      const tp = drawPlaqueta(nome);
      this.texturas.push(tp);
      const plaq = new THREE.Mesh(
        new THREE.PlaneGeometry(0.55, 0.3),
        new THREE.MeshLambertMaterial({ map: tp })
      );
      plaq.position.set(0, 0.5, 0.56);
      plaq.rotation.z = 0.1;
      this.group.add(plaq);
    }

    // mãos-luva flutuantes, repousando na beirada da mesa
    if (!this.manequim) {
      const matMao = new THREE.MeshLambertMaterial({ color: '#e9e5db', flatShading: true });
      for (const lado of [-1, 1]) {
        const mao = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.14, 0.24), matMao);
        mao.position.set(0.5 * lado, 0.28, 0.85);
        mao.castShadow = true;
        this.maos.push(mao);
        this.group.add(mao);
      }
    }

    // cadeira (a do juiz tem encosto de trono)
    const matCadeira = new THREE.MeshLambertMaterial({ color: 0x1b1a20 });
    const assento = new THREE.Mesh(new THREE.BoxGeometry(1.05, 0.1, 0.95), matCadeira);
    assento.position.set(0, -0.3, -0.1);
    const encosto = new THREE.Mesh(
      new THREE.BoxGeometry(1.05, opts.juiz ? 2.3 : 1.5, 0.1),
      matCadeira
    );
    encosto.position.set(0, opts.juiz ? 0.85 : 0.45, -0.6);
    encosto.castShadow = true;

    this.group.add(this.tronco, this.cabecaGrp, cracha, assento, encosto);
  }

  setExpressao(e: Expressao) {
    this.expressao = e;
    if (this.sprite && this.faces[e]) this.sprite.material = this.faces[e]!;
  }

  /** Mão desce num soco seco na mesa (≤300ms, regra do caos). */
  baterNaMesa() {
    if (!this.manequim && this.slamT < 0) this.slamT = 0;
  }

  tick(t: number, dt: number) {
    // respiração dessincronizada + cabeça balançando de leve
    const resp = Math.sin(t * 1.4 + this.fase);
    this.tronco.scale.y = 1 + resp * 0.015;
    this.cabecaGrp.position.y = 1.28 + resp * 0.02;
    this.cabecaGrp.rotation.z = Math.sin(t * 0.5 + this.fase) * 0.05;
    if (this.manequim) return;

    const hover = 0.28;
    if (this.slamT >= 0) {
      this.slamT += dt / 0.3;
      const k = Math.min(this.slamT, 1);
      const soco = Math.sin(k * Math.PI);
      for (const m of this.maos) m.position.y = hover - soco * 0.24;
      this.tronco.rotation.x = soco * 0.18;
      if (k >= 1) {
        this.slamT = -1;
        this.tronco.rotation.x = 0;
      }
    } else {
      this.maos[0].position.y = hover + Math.sin(t * 2.1 + this.fase) * 0.03;
      this.maos[1].position.y = hover + Math.cos(t * 1.8 + this.fase) * 0.03;
    }
  }

  dispose() {
    for (const t of this.texturas) t.dispose();
    for (const f of Object.values(this.faces)) f?.dispose();
  }
}
