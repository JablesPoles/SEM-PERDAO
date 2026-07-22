import * as THREE from 'three';
import {
  ACTOR_INTENT_PRIORITY,
  normalizeActorIntentCommand,
  type ActorAnchorId,
  type ActorAppearance,
  type ActorExpression,
  type ActorFrame,
  type ActorIntent,
  type ActorIntentCommand,
  type ActorRenderMetrics,
  type TableActor,
} from '@/lib/mesa/actorContract';
import {
  CULTIST_ACCENTS,
  CULTIST_ACCESSORIES,
  CULTIST_FACES,
  CULTIST_HOODS,
  CULTIST_ROBES,
  type CultistAppearance,
} from '@/lib/types';
import { Reu, type Acao, type Expressao } from '../reus';
import { collectActorRenderMetrics } from './actorMetrics';
import { PROCEDURAL_CULTIST_MANIFEST } from './cultistManifest';

const INTENT_ACTION: Partial<Record<ActorIntent, Acao>> = {
  speak: 'apontar',
  laugh: 'rir',
  point: 'apontar',
  clap: 'aplaudir',
  celebrate: 'festejar',
  facepalm: 'facepalm',
  hit: 'atingido',
  rage: 'tilt',
};

const INTENT_DURATION_MS: Readonly<Record<ActorIntent, number>> = Object.freeze({
  idle: 0,
  speak: 1_200,
  laugh: 1_300,
  point: 1_200,
  clap: 1_100,
  celebrate: 1_200,
  facepalm: 1_500,
  hit: 720,
  rage: 1_650,
  sleep: 0,
  // terminal: nunca expira sozinho, senão o ator "acordaria" no idle
  collapse: 0,
});

const EXPRESSION_TO_REU: Readonly<Record<ActorExpression, Expressao>> = Object.freeze({
  neutral: 'neutro',
  joy: 'riso',
  shock: 'choque',
  contempt: 'desprezo',
  sleep: 'sono',
});

const REU_TO_EXPRESSION: Readonly<Record<Expressao, ActorExpression>> = Object.freeze({
  neutro: 'neutral',
  riso: 'joy',
  choque: 'shock',
  desprezo: 'contempt',
  sono: 'sleep',
});

/**
 * Traduz a aparência genérica da engine (`slot → opção`) pra `CultistAppearance`.
 * Só slots conhecidos E opções válidas passam: a sala não pode quebrar porque
 * outro cliente mandou uma túnica que este build ainda não conhece.
 */
function mesclarAparencia(base: CultistAppearance, entrada: ActorAppearance): CultistAppearance {
  const permitido: Record<keyof CultistAppearance, readonly string[]> = {
    robe: CULTIST_ROBES,
    hood: CULTIST_HOODS,
    face: CULTIST_FACES,
    accent: CULTIST_ACCENTS,
    accessory: CULTIST_ACCESSORIES,
  };
  const resultado = { ...base };
  for (const [slot, opcao] of Object.entries(entrada)) {
    const valores = permitido[slot as keyof CultistAppearance];
    if (!valores || !valores.includes(opcao)) continue;
    (resultado as Record<string, string>)[slot] = opcao;
  }
  return resultado;
}

function chaveAparencia(appearance: CultistAppearance): string {
  return `${appearance.robe}|${appearance.hood}|${appearance.face}|${appearance.accent}|${appearance.accessory}`;
}

function disposeProceduralRoot(root: THREE.Object3D): void {
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    object.geometry.dispose();
    const values = Array.isArray(object.material) ? object.material : [object.material];
    values.forEach((material) => material.dispose());
  });
  root.removeFromParent();
}

export interface ProceduralCultistActorOptions {
  actorId: string;
  name: string;
  appearance: CultistAppearance;
  judge?: boolean;
  mannequin?: boolean;
}

export class ProceduralCultistActor implements TableActor<THREE.Group> {
  readonly source = 'procedural' as const;
  readonly root: THREE.Group;
  readonly actorId: string;
  private reu: Reu;
  private appearance: CultistAppearance;
  private readonly options: ProceduralCultistActorOptions;
  private activePriority = 0;
  private intentEndsAt = 0;
  private disposed = false;
  currentIntent: ActorIntent = 'idle';
  currentExpression: ActorExpression = 'neutral';

  constructor(options: ProceduralCultistActorOptions) {
    this.actorId = options.actorId;
    this.options = options;
    this.appearance = options.appearance;
    this.reu = new Reu(options.name, '#751d1a', {
      juiz: options.judge,
      manequim: options.mannequin,
      appearance: options.appearance,
    });
    // O grupo do `Reu` é descartado a cada troca de aparência, então a raiz do
    // ator é um contêiner estável: quem já guardou `root` continua válido.
    this.root = new THREE.Group();
    this.root.name = 'actor-root';
    this.root.add(this.reu.group);
    this.root.userData.actorId = options.actorId;
    this.root.userData.actorManifestId = PROCEDURAL_CULTIST_MANIFEST.id;
  }

  /**
   * Aqui a aparência é geometria reconstruída, não nó escondido — o `Reu` monta
   * capuz, adereço e rosto no construtor. O contrato não se importa com o
   * método; só exige que o slot mude sem trocar de ator.
   *
   * Slot ou opção que este ator não conhece é ignorado, e não zera o resto.
   */
  setAppearance(appearance: ActorAppearance): void {
    if (this.disposed) return;
    const proxima = mesclarAparencia(this.appearance, appearance);
    if (chaveAparencia(proxima) === chaveAparencia(this.appearance)) return;
    this.appearance = proxima;

    const expressao = this.reu.expressao;
    const caido = this.reu.caido;
    this.reu.dispose();
    disposeProceduralRoot(this.reu.group);

    this.reu = new Reu(this.options.name, '#751d1a', {
      juiz: this.options.judge,
      manequim: this.options.mannequin,
      appearance: proxima,
    });
    this.root.add(this.reu.group);
    // Trocar de roupa não ressuscita quem tombou nem apaga a cara de choque.
    if (caido) this.reu.tombar(true);
    else this.reu.setExpressao(expressao);
  }

  play(value: ActorIntent | Partial<ActorIntentCommand> & { intent: ActorIntent }): boolean {
    if (this.disposed) return false;
    const command = normalizeActorIntentCommand(value);
    if (!command) return false;
    const now = globalThis.performance?.now?.() ?? Date.now();
    if (now < this.intentEndsAt && command.priority < this.activePriority) return false;
    this.currentIntent = command.intent;
    this.activePriority = command.priority;
    const duration = command.durationMs ?? INTENT_DURATION_MS[command.intent];
    this.intentEndsAt = duration > 0 ? now + duration : 0;
    const action = INTENT_ACTION[command.intent];
    if (action) this.reu.acao(action);
    if (command.intent === 'idle') {
      this.reu.levantar();
      this.setExpression('neutral');
    }
    if (command.intent === 'sleep') this.setExpression('sleep');
    if (command.intent === 'collapse') this.reu.tombar();
    return true;
  }

  setExpression(expression: ActorExpression): void {
    if (this.disposed) return;
    this.currentExpression = expression;
    this.reu.setExpressao(EXPRESSION_TO_REU[expression]);
  }

  update(frame: ActorFrame): void {
    if (this.disposed) return;
    this.reu.tick(frame.elapsed, frame.delta);
    this.currentExpression = REU_TO_EXPRESSION[this.reu.expressao];
    if (this.intentEndsAt > 0 && frame.now >= this.intentEndsAt) {
      this.currentIntent = 'idle';
      this.activePriority = ACTOR_INTENT_PRIORITY.idle;
      this.intentEndsAt = 0;
    }
  }

  anchor(id: ActorAnchorId): readonly [number, number, number] | null {
    if (this.disposed) return null;
    const nodeName = PROCEDURAL_CULTIST_MANIFEST.anchors[id];
    const node = nodeName ? this.root.getObjectByName(nodeName) : null;
    if (!node) return null;
    this.root.updateMatrixWorld(true);
    const position = node.getWorldPosition(new THREE.Vector3());
    return [position.x, position.y, position.z];
  }

  metrics(): ActorRenderMetrics {
    return collectActorRenderMetrics(this.root);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.reu.dispose();
    disposeProceduralRoot(this.root);
  }
}
