export const ACTOR_INTENTS = [
  'idle',
  'speak',
  'laugh',
  'point',
  'clap',
  'celebrate',
  'facepalm',
  'hit',
  'rage',
  'sleep',
  /**
   * Terminal: o ator desaba e FICA caído. Diferente de `sleep`, que é um estado
   * reversível de ausência, `collapse` é o fim da participação daquele ator na
   * cena — quem consome precisa manter a pose até um reset explícito.
   */
  'collapse',
] as const;

export const ACTOR_EXPRESSIONS = [
  'neutral',
  'joy',
  'shock',
  'contempt',
  'sleep',
] as const;

export const ACTOR_ANCHORS = [
  'root',
  'head',
  'chest',
  'nameplate',
  'left-hand',
  'right-hand',
  'projectile-origin',
] as const;

/**
 * Aparência de um ator: `slot → opção`. Ex.: `{ hood: 'spire', robe: 'blood' }`.
 *
 * Existe porque personagem customizável não pode virar um asset por combinação.
 * O cultista do Sem Perdão tem 2.304 combinações e **sete** peças de geometria:
 * o resto é cor de material e textura. Um slot é resolvido de duas formas, e o
 * manifesto declara qual — `variants` liga/desliga nós, `palette` pinta material.
 */
export type ActorAppearance = Readonly<Record<string, string>>;

export type ActorIntent = (typeof ACTOR_INTENTS)[number];
export type ActorExpression = (typeof ACTOR_EXPRESSIONS)[number];
export type ActorAnchorId = (typeof ACTOR_ANCHORS)[number];

export interface ActorFrame {
  delta: number;
  elapsed: number;
  now: number;
  reducedMotion: boolean;
}

export interface ActorIntentCommand {
  intent: ActorIntent;
  priority: number;
  intensity: number;
  durationMs: number | null;
  seed: number;
  sourceEventId: string | null;
}

export interface ActorRenderMetrics {
  meshes: number;
  skinnedMeshes: number;
  materials: number;
  textures: number;
  triangles: number;
  drawCalls: number;
  bones: number;
  maxTextureEdge: number;
}

export interface TableActor<TRoot = unknown> {
  readonly actorId: string;
  readonly root: TRoot;
  readonly source: 'procedural' | 'gltf';
  readonly currentIntent: ActorIntent;
  readonly currentExpression: ActorExpression;
  play(command: ActorIntent | Partial<ActorIntentCommand> & { intent: ActorIntent }): boolean;
  setExpression(expression: ActorExpression): void;
  /**
   * Aplica aparência sem trocar o ator. Slot desconhecido é ignorado em silêncio
   * — o jogo evolui o vestuário mais rápido que os assets, e um ator antigo não
   * pode quebrar a sala por não conhecer uma opção nova.
   */
  setAppearance(appearance: ActorAppearance): void;
  update(frame: ActorFrame): void;
  anchor(id: ActorAnchorId): readonly [number, number, number] | null;
  metrics(): ActorRenderMetrics;
  dispose(): void;
}

export const ACTOR_INTENT_PRIORITY: Readonly<Record<ActorIntent, number>> = Object.freeze({
  idle: 0,
  sleep: 0,
  speak: 1,
  point: 1,
  clap: 1,
  laugh: 1,
  celebrate: 2,
  facepalm: 2,
  hit: 4,
  rage: 5,
  // Nada interrompe um tombo: ele encerra a linha daquele ator.
  collapse: 6,
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

export function isActorIntent(value: unknown): value is ActorIntent {
  return typeof value === 'string' && (ACTOR_INTENTS as readonly string[]).includes(value);
}

export function isActorExpression(value: unknown): value is ActorExpression {
  return typeof value === 'string' && (ACTOR_EXPRESSIONS as readonly string[]).includes(value);
}

export function normalizeActorIntentCommand(value: unknown): ActorIntentCommand | null {
  const raw = typeof value === 'string' ? { intent: value } : value;
  if (!isRecord(raw) || !isActorIntent(raw.intent)) return null;
  const priority = typeof raw.priority === 'number' && Number.isFinite(raw.priority)
    ? Math.max(0, Math.min(100, Math.round(raw.priority)))
    : ACTOR_INTENT_PRIORITY[raw.intent];
  const intensity = typeof raw.intensity === 'number' && Number.isFinite(raw.intensity)
    ? Math.max(0, Math.min(1, raw.intensity))
    : 1;
  const durationMs = typeof raw.durationMs === 'number' && Number.isFinite(raw.durationMs)
    ? Math.max(0, Math.min(60_000, Math.round(raw.durationMs)))
    : null;
  const seed = typeof raw.seed === 'number' && Number.isSafeInteger(raw.seed)
    ? Math.abs(raw.seed) % 2_147_483_647
    : 0;
  const sourceEventId = typeof raw.sourceEventId === 'string'
    && raw.sourceEventId.length >= 4
    && raw.sourceEventId.length <= 160
    ? raw.sourceEventId
    : null;
  return { intent: raw.intent, priority, intensity, durationMs, seed, sourceEventId };
}
