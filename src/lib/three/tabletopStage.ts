import * as THREE from 'three';
import {
  FrameBenchmark,
  type FrameBenchmarkResult,
  type FrameBenchmarkState,
} from './frameBenchmark';
import { summarizeProjectedFrame, type FramingReport } from './framing';

export type StageQuality = 'cinematic' | 'balanced' | 'performance';
export type StageViewportMode = 'landscape' | 'portrait';

export interface StageQualityProfile {
  label: string;
  pixelScale: number;
  maxDevicePixelRatio: number;
  shadows: boolean;
}

export const STAGE_QUALITY: Readonly<Record<StageQuality, StageQualityProfile>> = Object.freeze({
  cinematic: Object.freeze({
    label: 'cinema',
    pixelScale: 1.35,
    maxDevicePixelRatio: 1.75,
    shadows: true,
  }),
  balanced: Object.freeze({
    label: 'equilibrado',
    pixelScale: 2,
    maxDevicePixelRatio: 1.25,
    shadows: true,
  }),
  performance: Object.freeze({
    label: 'leve',
    pixelScale: 3,
    maxDevicePixelRatio: 1,
    shadows: false,
  }),
});

export interface StageFrame {
  delta: number;
  elapsed: number;
  now: number;
  frameMs: number;
  reducedMotion: boolean;
  viewportMode: StageViewportMode;
}

export type StageUpdater = (frame: StageFrame) => void;
export type StageRenderer = (frame: StageFrame, stage: TabletopStage) => void;

const CRT_VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position, 1.0);
  }
`;

const CRT_FRAGMENT = /* glsl */ `
  uniform sampler2D uScene;
  uniform float uTime;
  uniform float uGrain;
  uniform float uVignette;
  varying vec2 vUv;

  float random(vec2 point) {
    return fract(sin(dot(point, vec2(12.9898, 78.233))) * 43758.5453);
  }

  void main() {
    vec2 centered = vUv * 2.0 - 1.0;
    float radius = dot(centered, centered);
    vec2 curved = centered * (1.0 + radius * 0.022);
    vec2 uv = curved * 0.5 + 0.5;
    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
      gl_FragColor = vec4(0.012, 0.01, 0.009, 1.0);
      return;
    }
    vec3 color = texture2D(uScene, uv).rgb;
    float scanline = sin(gl_FragCoord.y * 3.14159) * 0.012;
    float noise = (random(gl_FragCoord.xy + uTime * 59.0) - 0.5) * uGrain;
    float vignette = smoothstep(1.28, 0.2, radius) * uVignette + (1.0 - uVignette);
    color = (color - scanline + noise) * vignette;
    color = floor(color * 36.0) / 36.0;
    gl_FragColor = vec4(color, 1.0);
  }
`;

export interface CameraDefinition {
  position: readonly [number, number, number];
  target: readonly [number, number, number];
  fov?: number;
  portrait?: {
    position?: readonly [number, number, number];
    target?: readonly [number, number, number];
    fov?: number;
  };
}

interface ResolvedCameraDefinition {
  position: THREE.Vector3;
  target: THREE.Vector3;
  fov: number;
}

interface CameraAct {
  landscape: ResolvedCameraDefinition;
  portrait: ResolvedCameraDefinition | null;
}

interface CameraTween {
  startedAt: number;
  duration: number;
  fromPosition: THREE.Vector3;
  toPosition: THREE.Vector3;
  fromTarget: THREE.Vector3;
  toTarget: THREE.Vector3;
  fromFov: number;
  toFov: number;
}

export interface StageMetrics extends Record<string, unknown> {
  cssWidth: number;
  cssHeight: number;
  viewportMode: StageViewportMode;
  outputWidth: number;
  outputHeight: number;
  outputPixelRatio: number;
  devicePixelRatio: number;
  pixelScale: number;
  drawCalls: number;
  triangles: number;
  activeLights: number;
  meshCount: number;
  materialCount: number;
  shadowCasters: number;
  hardwareConcurrency: number | null;
  deviceMemoryGb: number | null;
  renderWidth: number;
  renderHeight: number;
}

export interface TabletopStageOptions {
  quality?: StageQuality;
  clearColor?: THREE.ColorRepresentation;
  fogColor?: THREE.ColorRepresentation;
  fogDensity?: number;
  exposure?: number;
  reducedMotion?: boolean;
  powerPreference?: WebGLPowerPreference;
  near?: number;
  far?: number;
  fov?: number;
  autoStart?: boolean;
  disposeRoot?: boolean;
  navigation?: boolean;
  postProcess?: boolean;
  grain?: number;
  vignette?: number;
}

function disposeMaterial(material: THREE.Material): void {
  for (const value of Object.values(material)) {
    if (value instanceof THREE.Texture) value.dispose();
  }
  material.dispose();
}

export function disposeObject3D(object: THREE.Object3D): void {
  object.traverse((child) => {
    if (!(child instanceof THREE.Mesh || child instanceof THREE.Points)) return;
    child.geometry.dispose();
    if (Array.isArray(child.material)) child.material.forEach(disposeMaterial);
    else disposeMaterial(child.material);
  });
  object.removeFromParent();
}

export function canvasTexture(
  draw: (context: CanvasRenderingContext2D, canvas: HTMLCanvasElement) => void,
  { width = 512, height = 256 }: { width?: number; height?: number } = {}
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas 2D indisponível.');
  draw(context, canvas);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  return texture;
}

/**
 * Runtime WebGL compartilhável. Ele conhece viewport, câmera, interação,
 * qualidade, telemetria e descarte — nunca regras, cartas ou fases do jogo.
 */
export class TabletopStage {
  readonly scene = new THREE.Scene();
  readonly root = new THREE.Group();
  readonly camera: THREE.PerspectiveCamera;
  readonly renderer: THREE.WebGLRenderer;
  readonly cameraTarget = new THREE.Vector3();

  private readonly canvas: HTMLCanvasElement;
  private readonly timer = new THREE.Timer();
  private readonly updaters = new Set<StageUpdater>();
  private readonly resizeHandlers = new Set<(width: number, height: number) => void>();
  private readonly cameraActs = new Map<string, CameraAct>();
  private readonly interactiveRoots: THREE.Object3D[] = [];
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2();
  private readonly benchmark = new FrameBenchmark();
  private readonly resizeObserver: ResizeObserver | null;
  private readonly disposeRoot: boolean;
  private readonly navigation: boolean;
  private readonly postProcess: {
    target: THREE.WebGLRenderTarget;
    scene: THREE.Scene;
    camera: THREE.Camera;
    material: THREE.ShaderMaterial;
    quad: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  } | null;

  private quality: StageQuality;
  private pixelScale: number;
  private maxDevicePixelRatio: number;
  private reducedMotion: boolean;
  private viewportMode: StageViewportMode = 'landscape';
  private activeCameraAct: string | null = null;
  private cameraTween: CameraTween | null = null;
  private frameRenderer: StageRenderer | null = null;
  private pickHandler: ((id: string) => void) | null = null;
  private drag: { x: number; y: number; originX: number; originY: number } | null = null;
  private frame = 0;
  private lastFrameNow: number | null = null;
  private running = false;
  private disposed = false;
  private contextLost = false;

  constructor(canvas: HTMLCanvasElement, options: TabletopStageOptions = {}) {
    if (!canvas) throw new Error('TabletopStage precisa de um canvas.');
    this.canvas = canvas;
    this.quality = options.quality ?? 'balanced';
    this.pixelScale = STAGE_QUALITY[this.quality].pixelScale;
    this.maxDevicePixelRatio = STAGE_QUALITY[this.quality].maxDevicePixelRatio;
    this.reducedMotion = options.reducedMotion
      ?? globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches
      ?? false;
    this.disposeRoot = options.disposeRoot ?? true;
    this.navigation = options.navigation ?? true;
    this.root.name = 'tabletop-presentation';
    this.scene.add(this.root);
    this.scene.background = new THREE.Color(options.clearColor ?? 0x080706);
    this.scene.fog = new THREE.FogExp2(
      options.fogColor ?? options.clearColor ?? 0x080706,
      options.fogDensity ?? 0.025
    );
    this.camera = new THREE.PerspectiveCamera(
      options.fov ?? 48,
      1,
      options.near ?? 0.1,
      options.far ?? 100
    );
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      alpha: false,
      powerPreference: options.powerPreference ?? 'high-performance',
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = options.exposure ?? 1.05;
    if (options.postProcess === false) {
      this.postProcess = null;
    } else {
      const target = new THREE.WebGLRenderTarget(1, 1, {
        minFilter: THREE.LinearFilter,
        magFilter: THREE.NearestFilter,
        depthBuffer: true,
      });
      target.texture.colorSpace = THREE.SRGBColorSpace;
      const scene = new THREE.Scene();
      const camera = new THREE.Camera();
      const material = new THREE.ShaderMaterial({
        uniforms: {
          uScene: { value: target.texture },
          uTime: { value: 0 },
          uGrain: { value: options.grain ?? 0.014 },
          uVignette: { value: options.vignette ?? 0.88 },
        },
        vertexShader: CRT_VERTEX,
        fragmentShader: CRT_FRAGMENT,
        depthTest: false,
        depthWrite: false,
      });
      const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
      scene.add(quad);
      this.postProcess = { target, scene, camera, material, quad };
    }
    this.timer.connect(document);

    if (this.navigation) {
      this.canvas.addEventListener('pointerdown', this.handlePointerDown);
      this.canvas.addEventListener('pointermove', this.handlePointerMove);
      this.canvas.addEventListener('pointerup', this.handlePointerUp);
      this.canvas.addEventListener('pointercancel', this.handlePointerCancel);
      this.canvas.addEventListener('wheel', this.handleWheel, { passive: false });
    }
    this.canvas.addEventListener('webglcontextlost', this.handleContextLost);
    this.canvas.addEventListener('webglcontextrestored', this.handleContextRestored);

    this.resizeObserver = typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(() => this.resize());
    if (this.resizeObserver) this.resizeObserver.observe(canvas);
    else window.addEventListener('resize', this.resize);
    this.setQuality(this.quality);
    this.resize();
    if (options.autoStart !== false) this.start();
  }

  add<T extends THREE.Object3D>(object: T): T {
    this.root.add(object);
    return object;
  }

  addUpdater(updater: StageUpdater): () => void {
    this.updaters.add(updater);
    return () => this.updaters.delete(updater);
  }

  addResizeHandler(handler: (width: number, height: number) => void): () => void {
    this.resizeHandlers.add(handler);
    handler(Math.max(1, this.canvas.clientWidth), Math.max(1, this.canvas.clientHeight));
    return () => this.resizeHandlers.delete(handler);
  }

  setFrameRenderer(renderer: StageRenderer | null): void {
    this.frameRenderer = renderer;
  }

  setReducedMotion(reduced: boolean): void {
    this.reducedMotion = reduced;
    if (reduced && this.cameraTween) this.finishCameraTween();
  }

  isReducedMotion(): boolean {
    return this.reducedMotion;
  }

  setQuality(quality: StageQuality): void {
    this.quality = quality;
    const profile = STAGE_QUALITY[quality];
    this.pixelScale = profile.pixelScale;
    this.maxDevicePixelRatio = profile.maxDevicePixelRatio;
    this.renderer.shadowMap.enabled = profile.shadows;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.resize();
  }

  setVisualProfile({
    clearColor,
    fogColor,
    fogDensity,
    exposure,
    grain,
    vignette,
  }: {
    clearColor?: THREE.ColorRepresentation;
    fogColor?: THREE.ColorRepresentation;
    fogDensity?: number;
    exposure?: number;
    grain?: number;
    vignette?: number;
  }): void {
    if (clearColor !== undefined && this.scene.background instanceof THREE.Color) {
      this.scene.background.set(clearColor);
    }
    if (fogColor !== undefined && this.scene.fog) this.scene.fog.color.set(fogColor);
    if (fogDensity !== undefined && this.scene.fog instanceof THREE.FogExp2) {
      this.scene.fog.density = fogDensity;
    }
    if (exposure !== undefined) this.renderer.toneMappingExposure = exposure;
    if (grain !== undefined && this.postProcess) {
      this.postProcess.material.uniforms.uGrain.value = grain;
    }
    if (vignette !== undefined && this.postProcess) {
      this.postProcess.material.uniforms.uVignette.value = vignette;
    }
  }

  getQuality(): StageQuality {
    return this.quality;
  }

  setResolutionProfile({
    pixelScale,
    maxDevicePixelRatio,
  }: { pixelScale?: number; maxDevicePixelRatio?: number }): void {
    if (pixelScale !== undefined) this.pixelScale = Math.max(1, Number(pixelScale) || 1);
    if (maxDevicePixelRatio !== undefined) {
      this.maxDevicePixelRatio = Math.max(1, Number(maxDevicePixelRatio) || 1);
    }
    this.resize();
  }

  getViewportMode(): StageViewportMode {
    return this.viewportMode;
  }

  registerInteractive(object: THREE.Object3D, id: string): () => void {
    object.traverse((child) => { child.userData.interactionId = id; });
    this.interactiveRoots.push(object);
    return () => {
      const index = this.interactiveRoots.indexOf(object);
      if (index >= 0) this.interactiveRoots.splice(index, 1);
    };
  }

  setPickHandler(handler: ((id: string) => void) | null): void {
    this.pickHandler = handler;
  }

  defineCameraAct(name: string, definition: CameraDefinition): void {
    const landscape: ResolvedCameraDefinition = {
      position: new THREE.Vector3(...definition.position),
      target: new THREE.Vector3(...definition.target),
      fov: definition.fov ?? 48,
    };
    const portrait = definition.portrait ? {
      position: new THREE.Vector3(...(definition.portrait.position ?? definition.position)),
      target: new THREE.Vector3(...(definition.portrait.target ?? definition.target)),
      fov: definition.portrait.fov ?? definition.fov ?? 48,
    } : null;
    this.cameraActs.set(name, { landscape, portrait });
  }

  setCameraAct(name: string, { immediate = false, duration = 720 } = {}): void {
    const definition = this.cameraActs.get(name);
    if (!definition) throw new Error(`Ato de câmera desconhecido: ${name}`);
    const act = this.viewportMode === 'portrait' && definition.portrait
      ? definition.portrait
      : definition.landscape;
    this.activeCameraAct = name;
    if (immediate || this.reducedMotion) {
      this.camera.position.copy(act.position);
      this.cameraTarget.copy(act.target);
      this.camera.fov = act.fov;
      this.camera.updateProjectionMatrix();
      this.camera.lookAt(this.cameraTarget);
      this.cameraTween = null;
      return;
    }
    this.cameraTween = {
      startedAt: performance.now(),
      duration: Math.max(0, duration),
      fromPosition: this.camera.position.clone(),
      toPosition: act.position.clone(),
      fromTarget: this.cameraTarget.clone(),
      toTarget: act.target.clone(),
      fromFov: this.camera.fov,
      toFov: act.fov,
    };
  }

  start(): void {
    if (this.running || this.disposed) return;
    this.running = true;
    this.lastFrameNow = null;
    this.frame = requestAnimationFrame(this.animate);
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    cancelAnimationFrame(this.frame);
  }

  resize = (): void => {
    if (this.disposed) return;
    const width = Math.max(1, this.canvas.clientWidth || window.innerWidth);
    const height = Math.max(1, this.canvas.clientHeight || window.innerHeight);
    const nextMode: StageViewportMode = width / height < 0.82 ? 'portrait' : 'landscape';
    const modeChanged = nextMode !== this.viewportMode;
    this.viewportMode = nextMode;
    const devicePixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    const outputPixelRatio = Math.min(devicePixelRatio, this.maxDevicePixelRatio);
    this.renderer.setPixelRatio(outputPixelRatio);
    this.renderer.setSize(width, height, false);
    this.postProcess?.target.setSize(
      Math.max(1, Math.floor((width * devicePixelRatio) / this.pixelScale)),
      Math.max(1, Math.floor((height * devicePixelRatio) / this.pixelScale))
    );
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    for (const handler of this.resizeHandlers) handler(width, height);
    if (modeChanged && this.activeCameraAct) {
      this.setCameraAct(this.activeCameraAct, { immediate: true });
    }
  };

  runPerformanceBenchmark(options: {
    label?: string;
    warmupMs?: number;
    durationMs?: number;
    metadata?: Record<string, unknown>;
  } = {}): Promise<FrameBenchmarkResult | null> {
    return this.benchmark.start(options);
  }

  performanceBenchmarkState(): FrameBenchmarkState | null {
    return this.benchmark.state();
  }

  metrics(): StageMetrics {
    let activeLights = 0;
    let meshCount = 0;
    let shadowCasters = 0;
    const materials = new Set<string>();
    this.scene.traverse((object) => {
      if (object instanceof THREE.Light && object.visible && object.intensity > 0) activeLights += 1;
      if (!(object instanceof THREE.Mesh || object instanceof THREE.Points)) return;
      meshCount += 1;
      if (object.castShadow) shadowCasters += 1;
      const values = Array.isArray(object.material) ? object.material : [object.material];
      values.forEach((value) => { if (value?.uuid) materials.add(value.uuid); });
    });
    const navigatorWithMemory = navigator as Navigator & { deviceMemory?: number };
    return {
      cssWidth: Math.round(this.canvas.clientWidth || 0),
      cssHeight: Math.round(this.canvas.clientHeight || 0),
      viewportMode: this.viewportMode,
      outputWidth: this.renderer.domElement.width,
      outputHeight: this.renderer.domElement.height,
      outputPixelRatio: this.renderer.getPixelRatio(),
      devicePixelRatio: window.devicePixelRatio || 1,
      pixelScale: this.pixelScale,
      drawCalls: this.renderer.info.render.calls,
      triangles: this.renderer.info.render.triangles,
      activeLights,
      meshCount,
      materialCount: materials.size,
      shadowCasters,
      hardwareConcurrency: navigator.hardwareConcurrency ?? null,
      deviceMemoryGb: navigatorWithMemory.deviceMemory ?? null,
      renderWidth: this.postProcess?.target.width ?? this.renderer.domElement.width,
      renderHeight: this.postProcess?.target.height ?? this.renderer.domElement.height,
    };
  }

  framingReportForPoints(
    points: readonly THREE.Vector3[],
    padding = 0.04
  ): FramingReport | null {
    this.camera.updateMatrixWorld(true);
    this.camera.updateProjectionMatrix();
    return summarizeProjectedFrame(
      points.map((point) => {
        const projected = point.clone().project(this.camera);
        return { x: projected.x, y: projected.y, z: projected.z };
      }),
      padding
    );
  }

  framingReport(object: THREE.Object3D = this.root, padding = 0.04): FramingReport | null {
    const box = new THREE.Box3().setFromObject(object);
    if (box.isEmpty()) return null;
    const { min, max } = box;
    return this.framingReportForPoints([
      new THREE.Vector3(min.x, min.y, min.z),
      new THREE.Vector3(min.x, min.y, max.z),
      new THREE.Vector3(min.x, max.y, min.z),
      new THREE.Vector3(min.x, max.y, max.z),
      new THREE.Vector3(max.x, min.y, min.z),
      new THREE.Vector3(max.x, min.y, max.z),
      new THREE.Vector3(max.x, max.y, min.z),
      new THREE.Vector3(max.x, max.y, max.z),
    ], padding);
  }

  private updateCameraTween(now: number): void {
    if (!this.cameraTween) return;
    const tween = this.cameraTween;
    const progress = tween.duration === 0 ? 1 : Math.min(1, (now - tween.startedAt) / tween.duration);
    const eased = 1 - Math.pow(1 - progress, 3);
    this.camera.position.lerpVectors(tween.fromPosition, tween.toPosition, eased);
    this.cameraTarget.lerpVectors(tween.fromTarget, tween.toTarget, eased);
    this.camera.fov = THREE.MathUtils.lerp(tween.fromFov, tween.toFov, eased);
    this.camera.updateProjectionMatrix();
    this.camera.lookAt(this.cameraTarget);
    if (progress >= 1) this.cameraTween = null;
  }

  private finishCameraTween(): void {
    if (!this.cameraTween) return;
    const tween = this.cameraTween;
    this.camera.position.copy(tween.toPosition);
    this.cameraTarget.copy(tween.toTarget);
    this.camera.fov = tween.toFov;
    this.camera.updateProjectionMatrix();
    this.camera.lookAt(this.cameraTarget);
    this.cameraTween = null;
  }

  private pick(clientX: number, clientY: number): string | null {
    if (!this.interactiveRoots.length) return null;
    const rect = this.canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    this.pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hit = this.raycaster.intersectObjects(this.interactiveRoots, true)[0];
    return typeof hit?.object.userData.interactionId === 'string'
      ? hit.object.userData.interactionId
      : null;
  }

  private handlePointerDown = (event: PointerEvent): void => {
    this.drag = {
      x: event.clientX,
      y: event.clientY,
      originX: event.clientX,
      originY: event.clientY,
    };
    this.canvas.setPointerCapture?.(event.pointerId);
  };

  private handlePointerMove = (event: PointerEvent): void => {
    if (!this.drag) {
      if (this.interactiveRoots.length) {
        this.canvas.style.cursor = this.pick(event.clientX, event.clientY) ? 'pointer' : 'grab';
      }
      return;
    }
    if (this.cameraTween) return;
    const dx = event.clientX - this.drag.x;
    const dy = event.clientY - this.drag.y;
    this.drag.x = event.clientX;
    this.drag.y = event.clientY;
    const offset = this.camera.position.clone().sub(this.cameraTarget);
    const spherical = new THREE.Spherical().setFromVector3(offset);
    spherical.theta -= dx * 0.0035;
    spherical.phi = THREE.MathUtils.clamp(spherical.phi + dy * 0.0025, 0.28, Math.PI / 2.02);
    this.camera.position.copy(this.cameraTarget).add(new THREE.Vector3().setFromSpherical(spherical));
    this.camera.lookAt(this.cameraTarget);
    this.canvas.style.cursor = 'grabbing';
  };

  private handlePointerUp = (event: PointerEvent): void => {
    if (!this.drag) return;
    const moved = Math.hypot(
      event.clientX - this.drag.originX,
      event.clientY - this.drag.originY
    );
    this.drag = null;
    this.canvas.releasePointerCapture?.(event.pointerId);
    this.canvas.style.cursor = 'grab';
    if (moved > 7) return;
    const id = this.pick(event.clientX, event.clientY);
    if (id) this.pickHandler?.(id);
  };

  private handlePointerCancel = (): void => {
    this.drag = null;
    this.canvas.style.cursor = 'grab';
  };

  private handleWheel = (event: WheelEvent): void => {
    if (this.interactiveRoots.length === 0 && !this.activeCameraAct) return;
    event.preventDefault();
    if (this.cameraTween) return;
    const offset = this.camera.position.clone().sub(this.cameraTarget);
    const maximum = this.viewportMode === 'portrait' ? 24 : 19;
    offset.setLength(THREE.MathUtils.clamp(offset.length() + event.deltaY * 0.007, 4.2, maximum));
    this.camera.position.copy(this.cameraTarget).add(offset);
    this.camera.lookAt(this.cameraTarget);
  };

  private handleContextLost = (event: Event): void => {
    event.preventDefault();
    this.contextLost = true;
  };

  private handleContextRestored = (): void => {
    this.contextLost = false;
    this.resize();
  };

  private animate = (now: number): void => {
    if (!this.running || this.disposed) return;
    const frameMs = this.lastFrameNow === null ? 0 : now - this.lastFrameNow;
    this.lastFrameNow = now;
    this.timer.update(now);
    const frame: StageFrame = {
      delta: Math.min(this.timer.getDelta(), 0.05),
      elapsed: this.timer.getElapsed(),
      now,
      frameMs,
      reducedMotion: this.reducedMotion,
      viewportMode: this.viewportMode,
    };
    this.updateCameraTween(now);
    for (const updater of this.updaters) updater(frame);
    if (!this.contextLost) {
      if (this.frameRenderer) this.frameRenderer(frame, this);
      else if (this.postProcess) {
        this.postProcess.material.uniforms.uTime.value = frame.elapsed;
        this.renderer.setRenderTarget(this.postProcess.target);
        this.renderer.render(this.scene, this.camera);
        this.renderer.setRenderTarget(null);
        this.renderer.render(this.postProcess.scene, this.postProcess.camera);
      } else {
        this.renderer.render(this.scene, this.camera);
      }
    }
    this.benchmark.record(frameMs, {
      eligible: document.visibilityState !== 'hidden' && !this.contextLost,
      metadata: () => this.metrics(),
    });
    this.frame = requestAnimationFrame(this.animate);
  };

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.stop();
    this.benchmark.cancel();
    this.resizeObserver?.disconnect();
    if (!this.resizeObserver) window.removeEventListener('resize', this.resize);
    if (this.navigation) {
      this.canvas.removeEventListener('pointerdown', this.handlePointerDown);
      this.canvas.removeEventListener('pointermove', this.handlePointerMove);
      this.canvas.removeEventListener('pointerup', this.handlePointerUp);
      this.canvas.removeEventListener('pointercancel', this.handlePointerCancel);
      this.canvas.removeEventListener('wheel', this.handleWheel);
    }
    this.canvas.removeEventListener('webglcontextlost', this.handleContextLost);
    this.canvas.removeEventListener('webglcontextrestored', this.handleContextRestored);
    if (this.disposeRoot) disposeObject3D(this.root);
    else this.root.removeFromParent();
    if (this.postProcess) {
      this.postProcess.quad.geometry.dispose();
      this.postProcess.material.dispose();
      this.postProcess.target.dispose();
    }
    this.timer.dispose();
    this.renderer.dispose();
    this.updaters.clear();
    this.resizeHandlers.clear();
    this.interactiveRoots.length = 0;
  }
}
