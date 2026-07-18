/**
 * vitrineReu.ts — o provador do porão: UM cultista sob a lâmpada, girando
 * devagar, pro jogador ver a própria aparência de verdade (o mesmo modelo 3D
 * da mesa) no menu e no lobby. Sem mesa, sem cartas, sem juiz — só o réu.
 *
 * Mantém a assinatura visual do jogo: render em baixa resolução + posterização
 * + dithering + scanline suave (versão enxuta do filtro CRT da retroMesa).
 */
import * as THREE from 'three';
import { Reu, EXPRESSOES } from './reus';
import type { CultistAppearance } from '../types';

const FUNDO = 0x1b1a21;

function criarBayer(): THREE.DataTexture {
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

export class VitrineReu {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private rt: THREE.WebGLRenderTarget;
  private blitScene = new THREE.Scene();
  private blitCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private blitMat: THREE.ShaderMaterial;
  private timer = new THREE.Timer();
  private reu: Reu | null = null;
  private giro = 0;
  private arrastando = false;
  private ultimoX = 0;
  private ultimoArrasto = -10;
  private proximaCara = 3;
  private raf = 0;
  private disposed = false;
  private canvas: HTMLCanvasElement;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'low-power' });
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.BasicShadowMap;

    // enquadra até o capuz agulha (o mais alto) sem cortar o topo
    this.camera = new THREE.PerspectiveCamera(44, 1, 0.1, 30);
    this.camera.position.set(0, 1.5, 3.8);
    this.camera.lookAt(0, 1.05, 0);

    this.scene.background = new THREE.Color(FUNDO);
    this.scene.fog = new THREE.Fog(FUNDO, 6, 14);

    // luz do provador: lâmpada nua em cima + ambiente pra silhueta existir
    const hemi = new THREE.HemisphereLight(0xfff0dc, 0x55525e, 1.9);
    const chave = new THREE.SpotLight(0xfff4e0, 60, 0, 1.0, 0.5, 2);
    chave.position.set(0, 3.1, 0.4);
    chave.castShadow = true;
    chave.shadow.mapSize.set(256, 256);
    chave.target.position.set(0, 0, 0);
    const preenchimento = new THREE.DirectionalLight(0xf2efe9, 0.8);
    preenchimento.position.set(2.5, 2, 3);
    this.scene.add(hemi, chave, chave.target, preenchimento);

    // a lâmpada nua (fio + bulbo) — mesma narradora do porão
    const fio = new THREE.Mesh(
      new THREE.CylinderGeometry(0.015, 0.015, 1.6, 5),
      new THREE.MeshLambertMaterial({ color: 0x0a0a0c })
    );
    fio.position.set(0, 3.9, 0.4);
    const bulbo = new THREE.Mesh(
      new THREE.SphereGeometry(0.09, 8, 6),
      new THREE.MeshBasicMaterial({ color: 0xfff4e0 })
    );
    bulbo.position.set(0, 3.08, 0.4);
    this.scene.add(fio, bulbo);

    // pedestal do banco dos réus + chão que some no breu
    const pedestal = new THREE.Mesh(
      new THREE.CylinderGeometry(1.15, 1.25, 0.16, 20),
      new THREE.MeshLambertMaterial({ color: 0x26252b })
    );
    pedestal.position.y = -0.08;
    pedestal.receiveShadow = true;
    const chao = new THREE.Mesh(
      new THREE.CircleGeometry(9, 24),
      new THREE.MeshLambertMaterial({ color: 0x141318 })
    );
    chao.rotation.x = -Math.PI / 2;
    chao.position.y = -0.16;
    this.scene.add(pedestal, chao);

    // passe retrô enxuto: posterização + dithering + scanline + vinheta
    this.rt = new THREE.WebGLRenderTarget(2, 2, {
      magFilter: THREE.NearestFilter,
      minFilter: THREE.NearestFilter,
      depthBuffer: true,
    });
    this.blitMat = new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: { value: this.rt.texture },
        tBayer: { value: criarBayer() },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D tDiffuse;
        uniform sampler2D tBayer;
        varying vec2 vUv;
        void main() {
          vec3 c = texture2D(tDiffuse, vUv).rgb;
          float limiar = texture2D(tBayer, gl_FragCoord.xy / 4.0).r - 0.5;
          c += limiar * (0.3 / 12.0);
          c = floor(c * 12.0 + 0.5) / 12.0;
          c = c * 0.94 + vec3(0.05);
          float linha = mod(floor(gl_FragCoord.y), 2.0);
          c *= 1.0 - 0.028 * linha;
          vec2 d = vUv - 0.5;
          float vig = smoothstep(0.9, 0.35, length(d) * 1.3);
          c *= 0.86 + 0.14 * vig;
          gl_FragColor = vec4(c, 1.0);
        }
      `,
      depthTest: false,
      depthWrite: false,
    });
    this.blitScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.blitMat));

    this.timer.connect(document);
    this.resize();
    canvas.addEventListener('pointerdown', this.onDown);
    window.addEventListener('pointermove', this.onMove);
    window.addEventListener('pointerup', this.onUp);
    this.loop();
  }

  /** Troca o réu exibido — reconstruído do zero com a aparência nova. */
  setReu(nome: string, aparencia: CultistAppearance) {
    if (this.reu) {
      const antigo = this.reu;
      antigo.dispose();
      antigo.group.traverse((o) => {
        if (!(o instanceof THREE.Mesh)) return;
        o.geometry.dispose();
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        // materiais são por-réu; as texturas compartilhadas (tecido) sobrevivem
        mats.forEach((m) => m.dispose());
      });
      antigo.group.removeFromParent();
    }
    const reu = new Reu(nome.trim().toUpperCase() || 'RÉU', '#751d1a', { appearance: aparencia });
    reu.group.rotation.y = this.giro;
    this.scene.add(reu.group);
    this.reu = reu;
  }

  /** Reaçãozinha ao randomizar/salvar — o réu comemora a própria cara. */
  celebrar() {
    this.reu?.acao('festejar');
    this.reu?.setExpressao('riso');
  }

  private onDown = (e: PointerEvent) => {
    this.arrastando = true;
    this.ultimoX = e.clientX;
  };

  private onMove = (e: PointerEvent) => {
    if (!this.arrastando) return;
    this.giro += (e.clientX - this.ultimoX) * 0.012;
    this.ultimoX = e.clientX;
    this.ultimoArrasto = this.timer.getElapsed();
  };

  private onUp = () => {
    this.arrastando = false;
  };

  resize() {
    const w = this.canvas.clientWidth || 1;
    const h = this.canvas.clientHeight || 1;
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(w, h, false);
    this.rt.setSize(Math.max(2, w), Math.max(2, h));
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  private loop = (timestamp?: number) => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);
    this.timer.update(timestamp);
    const dt = Math.min(this.timer.getDelta(), 0.05);
    const t = this.timer.getElapsed();

    // giro de provador: automático, pausa enquanto o jogador arrasta
    if (!this.arrastando && t - this.ultimoArrasto > 2) this.giro += dt * 0.35;
    if (this.reu) {
      this.reu.group.rotation.y = this.giro;
      this.reu.tick(t, dt);
    }

    // o réu vive: troca de cara de vez em quando
    if (t > this.proximaCara) {
      this.proximaCara = t + 3 + Math.random() * 3;
      const opcoes = EXPRESSOES.filter((e) => e !== this.reu?.expressao);
      this.reu?.setExpressao(opcoes[Math.floor(Math.random() * opcoes.length)]);
    }

    this.renderer.setRenderTarget(this.rt);
    this.renderer.render(this.scene, this.camera);
    this.renderer.setRenderTarget(null);
    this.renderer.render(this.blitScene, this.blitCam);
  };

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.canvas.removeEventListener('pointerdown', this.onDown);
    window.removeEventListener('pointermove', this.onMove);
    window.removeEventListener('pointerup', this.onUp);
    this.timer.dispose();
    this.reu?.dispose();
    this.rt.dispose();
    this.blitMat.dispose();
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
