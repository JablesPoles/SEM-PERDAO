import type { ActorAssetManifest } from '@/lib/mesa/actorManifest';

export const PROCEDURAL_CULTIST_MANIFEST: Readonly<ActorAssetManifest> = Object.freeze({
  schema: 'a-mesa.actor/v1',
  id: 'sem-perdao.cultist.procedural-v5',
  label: 'Cultista procedural v5',
  version: 5,
  runtime: 'procedural',
  source: {
    uri: 'procedural:sem-perdao/cultist-v5',
    authoring: 'src/lib/three/reus.ts',
  },
  coordinateSystem: {
    metersPerUnit: 1,
    forward: '+z',
    up: '+y',
  },
  rootNode: 'actor-root',
  clips: {
    idle: { clip: 'idle', loop: 'repeat', fadeMs: 180, speed: 1 },
    speak: { clip: 'apontar', loop: 'once', fadeMs: 90, speed: 1 },
    laugh: { clip: 'rir', loop: 'once', fadeMs: 100, speed: 1 },
    point: { clip: 'apontar', loop: 'once', fadeMs: 80, speed: 1 },
    clap: { clip: 'aplaudir', loop: 'once', fadeMs: 80, speed: 1 },
    celebrate: { clip: 'festejar', loop: 'once', fadeMs: 100, speed: 1 },
    facepalm: { clip: 'facepalm', loop: 'once', fadeMs: 100, speed: 1 },
    hit: { clip: 'atingido', loop: 'once', fadeMs: 45, speed: 1 },
    rage: { clip: 'tilt', loop: 'once', fadeMs: 50, speed: 1 },
    sleep: { clip: 'sleep', loop: 'repeat', fadeMs: 180, speed: 1 },
  },
  expressions: {},
  anchors: {
    root: 'actor-anchor-root',
    head: 'actor-anchor-head',
    chest: 'actor-anchor-chest',
    nameplate: 'actor-anchor-nameplate',
    'left-hand': 'actor-anchor-left-hand',
    'right-hand': 'actor-anchor-right-hand',
    'projectile-origin': 'actor-anchor-projectile-origin',
  },
  // O procedural é a implementação de REFERÊNCIA da aparência modular: ele já
  // monta as 2.304 combinações a partir de peças e cores. Um ator glTF que
  // queira substituí-lo precisa declarar os mesmos slots — senão ligá-lo seria
  // um downgrade, trocando customização por um boneco fixo.
  //
  // Aqui os nós são simbólicos: o `Reu` reconstrói a geometria em vez de
  // esconder nó. O contrato é o mesmo; a forma de cumprir é que muda.
  variants: {
    hood: {
      classic: ['hood-classic'],
      spire: ['hood-spire'],
      shrouded: ['hood-shrouded'],
    },
    accessory: {
      none: [],
      chain: ['prop-chain'],
      candle: ['prop-candle'],
      relic: ['prop-relic'],
    },
    face: {
      void: ['face-void'],
      ember: ['face-ember'],
      grin: ['face-grin'],
      weeping: ['face-weeping'],
    },
  },
  // A tabela de cores vive aqui, não no runtime: túnica nova é edição de asset.
  palette: {
    robe: {
      material: 'tunica',
      property: 'baseColorFactor',
      values: {
        blood: '#8f201b',
        ash: '#625d63',
        midnight: '#25243a',
        moss: '#48563b',
        violet: '#4a2a5e',
        rust: '#8a4c1f',
        abyss: '#1e4744',
        linen: '#b3a98f',
      },
    },
    accent: {
      material: 'acento',
      property: 'baseColorFactor',
      values: {
        bone: '#d8ccb2',
        brass: '#a97d3e',
        scarlet: '#ff3b2f',
        cyan: '#43d9d4',
        gold: '#e3b341',
        amethyst: '#a06bff',
      },
    },
  },
  // O `Reu` desenha o próprio rosto no construtor, mas o slot é declarado
  // para os dois runtimes descreverem a mesma coisa — quem lê o manifesto não
  // deveria adivinhar que só um deles tem cara.
  textureSlots: {
    face: { material: 'rosto', channel: 'emissive-mask' },
  },
  lods: [],
  budget: {
    maxDownloadBytes: 1,
    maxTriangles: 16_000,
    maxDrawCalls: 32,
    maxBones: 1,
    maxTextureEdge: 512,
  },
  preload: 'lobby',
} satisfies ActorAssetManifest);
