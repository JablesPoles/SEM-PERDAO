import {
  ACTOR_ANCHORS,
  ACTOR_EXPRESSIONS,
  ACTOR_INTENTS,
  type ActorAnchorId,
  type ActorExpression,
  type ActorIntent,
} from './actorContract';

export const ACTOR_MANIFEST_SCHEMA = 'a-mesa.actor/v1' as const;

export interface ActorClipBinding {
  clip: string;
  loop: 'once' | 'repeat';
  fadeMs: number;
  speed: number;
}

export interface ActorLodDefinition {
  id: string;
  uri: string;
  minDistance: number;
  maxTriangles: number;
}

export interface ActorExpressionBinding {
  /** Nome do morph target glTF e influência final (0..1). */
  morphTargets: Readonly<Record<string, number>>;
  fadeMs: number;
}

export interface ActorAssetBudget {
  maxDownloadBytes: number;
  maxTriangles: number;
  maxDrawCalls: number;
  maxBones: number;
  maxTextureEdge: number;
}

export interface ActorAssetManifest {
  schema: typeof ACTOR_MANIFEST_SCHEMA;
  id: string;
  label: string;
  version: number;
  runtime: 'procedural' | 'gltf';
  source: {
    uri: string;
    authoring?: string;
  };
  coordinateSystem: {
    metersPerUnit: number;
    forward: '+z' | '-z';
    up: '+y';
  };
  rootNode?: string;
  clips: Partial<Record<ActorIntent, ActorClipBinding>>;
  expressions?: Partial<Record<ActorExpression, ActorExpressionBinding>>;
  anchors: Partial<Record<ActorAnchorId, string>>;
  /**
   * Peças que ligam e desligam por slot de aparência: `slot → opção → nós`.
   * Uma opção com lista vazia é legítima e quer dizer "nada" (ex.: sem adereço).
   */
  variants: Record<string, Record<string, string[]>>;
  /** Slots resolvidos por cor de material em vez de geometria. */
  palette: Record<string, ActorPaletteBinding>;
  lods: ActorLodDefinition[];
  budget: ActorAssetBudget;
  preload: 'shell' | 'lobby' | 'game' | 'on-demand';
  fallbackActorId?: string;
}

export const ACTOR_PALETTE_PROPERTIES = ['baseColorFactor', 'emissiveFactor'] as const;
export type ActorPaletteProperty = (typeof ACTOR_PALETTE_PROPERTIES)[number];

export interface ActorPaletteBinding {
  material: string;
  property: ActorPaletteProperty;
  /**
   * `opção → cor hex`. A tabela vive no manifesto, e não no runtime, porque
   * acrescentar uma túnica nova precisa ser edição de asset — não de código.
   */
  values: Record<string, string>;
}

export interface ActorAssetObservation {
  downloadBytes?: number;
  triangles?: number;
  drawCalls?: number;
  bones?: number;
  textureEdge?: number;
}

export interface ActorManifestIssue {
  severity: 'error' | 'warning';
  code: string;
  path: string;
  message: string;
}

export interface ActorManifestAudit {
  valid: boolean;
  manifest: ActorAssetManifest | null;
  issues: ActorManifestIssue[];
}

export interface LoadActorManifestOptions {
  signal?: AbortSignal;
  fetcher?: typeof fetch;
  /** Base explícita para testes/SSR; no browser, a URL final da resposta basta. */
  baseUrl?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function positiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0;
}

function safeName(value: unknown, max = 100): value is string {
  return typeof value === 'string' && value.length >= 1 && value.length <= max;
}

function issue(
  issues: ActorManifestIssue[],
  severity: ActorManifestIssue['severity'],
  code: string,
  path: string,
  message: string
): void {
  issues.push({ severity, code, path, message });
}

function parseBudget(value: unknown, issues: ActorManifestIssue[]): ActorAssetBudget | null {
  if (!isRecord(value)) {
    issue(issues, 'error', 'budget.missing', 'budget', 'O manifesto precisa declarar orçamento.');
    return null;
  }
  const keys = [
    'maxDownloadBytes',
    'maxTriangles',
    'maxDrawCalls',
    'maxBones',
    'maxTextureEdge',
  ] as const;
  for (const key of keys) {
    if (!positiveInteger(value[key])) {
      issue(issues, 'error', 'budget.invalid', `budget.${key}`, 'Use um inteiro positivo.');
    }
  }
  if (issues.some((entry) => entry.severity === 'error' && entry.path.startsWith('budget'))) return null;
  return Object.fromEntries(keys.map((key) => [key, Number(value[key])])) as unknown as ActorAssetBudget;
}

function parseClips(value: unknown, issues: ActorManifestIssue[]): ActorAssetManifest['clips'] {
  if (!isRecord(value)) return {};
  const result: ActorAssetManifest['clips'] = {};
  for (const [intent, raw] of Object.entries(value)) {
    if (!(ACTOR_INTENTS as readonly string[]).includes(intent)) {
      issue(issues, 'warning', 'clip.unknown-intent', `clips.${intent}`, 'Intenção desconhecida será ignorada.');
      continue;
    }
    if (!isRecord(raw) || !safeName(raw.clip, 120)) {
      issue(issues, 'error', 'clip.invalid', `clips.${intent}`, 'Binding de animação inválido.');
      continue;
    }
    const loop = raw.loop === 'repeat' ? 'repeat' : 'once';
    const fadeMs = typeof raw.fadeMs === 'number' && Number.isFinite(raw.fadeMs)
      ? Math.max(0, Math.min(5_000, Math.round(raw.fadeMs)))
      : 120;
    const speed = typeof raw.speed === 'number' && Number.isFinite(raw.speed)
      ? Math.max(0.05, Math.min(4, raw.speed))
      : 1;
    result[intent as ActorIntent] = { clip: raw.clip, loop, fadeMs, speed };
  }
  return result;
}

/** `slot → opção → nós`. Slot e opção são livres: o vestuário é do jogo. */
function parseVariants(value: unknown, issues: ActorManifestIssue[]): ActorAssetManifest['variants'] {
  if (!isRecord(value)) return {};
  const result: ActorAssetManifest['variants'] = {};
  for (const [slot, opcoes] of Object.entries(value)) {
    if (!safeName(slot, 40)) {
      issue(issues, 'error', 'variant.slot-invalid', `variants.${slot}`, 'Nome de slot inválido.');
      continue;
    }
    if (!isRecord(opcoes)) {
      issue(issues, 'error', 'variant.invalid', `variants.${slot}`, 'Slot precisa mapear opção → lista de nós.');
      continue;
    }
    const mapa: Record<string, string[]> = {};
    for (const [opcao, nos] of Object.entries(opcoes)) {
      if (!safeName(opcao, 40)) {
        issue(issues, 'error', 'variant.option-invalid', `variants.${slot}.${opcao}`, 'Nome de opção inválido.');
        continue;
      }
      // Lista vazia é intencional: "none" existe e não liga nó nenhum.
      if (!Array.isArray(nos) || nos.some((no) => !safeName(no, 120))) {
        issue(issues, 'error', 'variant.nodes-invalid', `variants.${slot}.${opcao}`, 'Use uma lista de nomes de nó.');
        continue;
      }
      mapa[opcao] = [...new Set(nos as string[])];
    }
    if (!Object.keys(mapa).length) {
      issue(issues, 'warning', 'variant.empty', `variants.${slot}`, 'Slot sem nenhuma opção utilizável.');
      continue;
    }
    result[slot] = mapa;
  }
  return result;
}

function parsePalette(value: unknown, issues: ActorManifestIssue[]): ActorAssetManifest['palette'] {
  if (!isRecord(value)) return {};
  const result: ActorAssetManifest['palette'] = {};
  for (const [slot, binding] of Object.entries(value)) {
    if (!safeName(slot, 40)) {
      issue(issues, 'error', 'palette.slot-invalid', `palette.${slot}`, 'Nome de slot inválido.');
      continue;
    }
    if (!isRecord(binding) || !safeName(binding.material, 120)) {
      issue(issues, 'error', 'palette.invalid', `palette.${slot}`, 'Informe o material a pintar.');
      continue;
    }
    const property = binding.property ?? 'baseColorFactor';
    if (!(ACTOR_PALETTE_PROPERTIES as readonly unknown[]).includes(property)) {
      issue(issues, 'error', 'palette.property', `palette.${slot}.property`, `Use ${ACTOR_PALETTE_PROPERTIES.join(' ou ')}.`);
      continue;
    }
    if (!isRecord(binding.values) || !Object.keys(binding.values).length) {
      issue(issues, 'error', 'palette.values', `palette.${slot}.values`, 'Informe opção → cor hex; sem tabela o slot não pinta nada.');
      continue;
    }
    const values: Record<string, string> = {};
    for (const [opcao, cor] of Object.entries(binding.values)) {
      if (!safeName(opcao, 40) || typeof cor !== 'string' || !/^#[0-9a-f]{6}$/iu.test(cor)) {
        issue(issues, 'error', 'palette.color', `palette.${slot}.values.${opcao}`, 'Use cor no formato #rrggbb.');
        continue;
      }
      values[opcao] = cor.toLowerCase();
    }
    if (!Object.keys(values).length) continue;
    result[slot] = { material: binding.material as string, property: property as ActorPaletteProperty, values };
  }
  return result;
}

function parseAnchors(value: unknown, issues: ActorManifestIssue[]): ActorAssetManifest['anchors'] {
  if (!isRecord(value)) return {};
  const result: ActorAssetManifest['anchors'] = {};
  for (const [anchor, node] of Object.entries(value)) {
    if (!(ACTOR_ANCHORS as readonly string[]).includes(anchor)) {
      issue(issues, 'warning', 'anchor.unknown', `anchors.${anchor}`, 'Âncora desconhecida será ignorada.');
      continue;
    }
    if (!safeName(node, 120)) {
      issue(issues, 'error', 'anchor.invalid', `anchors.${anchor}`, 'Nome de nó inválido.');
      continue;
    }
    result[anchor as ActorAnchorId] = node;
  }
  return result;
}

function parseExpressions(
  value: unknown,
  issues: ActorManifestIssue[]
): NonNullable<ActorAssetManifest['expressions']> {
  if (!isRecord(value)) return {};
  const result: NonNullable<ActorAssetManifest['expressions']> = {};
  for (const [expression, raw] of Object.entries(value)) {
    if (!(ACTOR_EXPRESSIONS as readonly string[]).includes(expression)) {
      issue(
        issues,
        'warning',
        'expression.unknown',
        `expressions.${expression}`,
        'Expressão desconhecida será ignorada.'
      );
      continue;
    }
    if (!isRecord(raw) || !isRecord(raw.morphTargets)) {
      issue(
        issues,
        'error',
        'expression.invalid',
        `expressions.${expression}`,
        'Binding de expressão inválido.'
      );
      continue;
    }
    const morphTargets: Record<string, number> = {};
    for (const [name, influence] of Object.entries(raw.morphTargets)) {
      if (
        !safeName(name, 120)
        || typeof influence !== 'number'
        || !Number.isFinite(influence)
        || influence < 0
        || influence > 1
      ) {
        issue(
          issues,
          'error',
          'expression.morph-invalid',
          `expressions.${expression}.morphTargets.${name}`,
          'Morph target precisa ter nome seguro e influência entre 0 e 1.'
        );
        continue;
      }
      morphTargets[name] = influence;
    }
    const fadeMs = typeof raw.fadeMs === 'number' && Number.isFinite(raw.fadeMs)
      ? Math.max(0, Math.min(5_000, Math.round(raw.fadeMs)))
      : 120;
    result[expression as ActorExpression] = { morphTargets, fadeMs };
  }
  return result;
}

function parseLods(value: unknown, issues: ActorManifestIssue[]): ActorLodDefinition[] {
  if (!Array.isArray(value)) return [];
  const result: ActorLodDefinition[] = [];
  const ids = new Set<string>();
  value.forEach((raw, index) => {
    const path = `lods.${index}`;
    if (
      !isRecord(raw)
      || !safeName(raw.id, 80)
      || !safeName(raw.uri, 300)
      || typeof raw.minDistance !== 'number'
      || !Number.isFinite(raw.minDistance)
      || raw.minDistance < 0
      || !positiveInteger(raw.maxTriangles)
      || ids.has(raw.id)
    ) {
      issue(issues, 'error', 'lod.invalid', path, 'LOD inválido ou duplicado.');
      return;
    }
    ids.add(raw.id);
    result.push({
      id: raw.id,
      uri: raw.uri,
      minDistance: raw.minDistance,
      maxTriangles: raw.maxTriangles,
    });
  });
  return result.sort((left, right) => left.minDistance - right.minDistance);
}

export function auditActorManifest(value: unknown): ActorManifestAudit {
  const issues: ActorManifestIssue[] = [];
  if (!isRecord(value)) {
    issue(issues, 'error', 'manifest.invalid', '$', 'Manifesto precisa ser um objeto.');
    return { valid: false, manifest: null, issues };
  }
  if (value.schema !== ACTOR_MANIFEST_SCHEMA) {
    issue(issues, 'error', 'schema.unsupported', 'schema', `Use ${ACTOR_MANIFEST_SCHEMA}.`);
  }
  if (!safeName(value.id, 100) || !/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/u.test(value.id)) {
    issue(issues, 'error', 'id.invalid', 'id', 'ID precisa ser estável, minúsculo e sem espaços.');
  }
  if (!safeName(value.label, 120)) issue(issues, 'error', 'label.invalid', 'label', 'Rótulo inválido.');
  if (!positiveInteger(value.version)) issue(issues, 'error', 'version.invalid', 'version', 'Versão inválida.');
  if (value.runtime !== 'procedural' && value.runtime !== 'gltf') {
    issue(issues, 'error', 'runtime.invalid', 'runtime', 'Runtime precisa ser procedural ou gltf.');
  }
  if (!isRecord(value.source) || !safeName(value.source.uri, 300)) {
    issue(issues, 'error', 'source.invalid', 'source.uri', 'Fonte do ator inválida.');
  } else if (value.runtime === 'gltf' && !/\.(?:glb|gltf)(?:\?.*)?$/iu.test(value.source.uri)) {
    issue(issues, 'error', 'source.not-gltf', 'source.uri', 'Ator glTF precisa apontar para .glb ou .gltf.');
  }
  if (
    !isRecord(value.coordinateSystem)
    || typeof value.coordinateSystem.metersPerUnit !== 'number'
    || !Number.isFinite(value.coordinateSystem.metersPerUnit)
    || value.coordinateSystem.metersPerUnit <= 0
    || (value.coordinateSystem.forward !== '+z' && value.coordinateSystem.forward !== '-z')
    || value.coordinateSystem.up !== '+y'
  ) {
    issue(issues, 'error', 'coordinates.invalid', 'coordinateSystem', 'Escala/eixos do ator inválidos.');
  }
  const budget = parseBudget(value.budget, issues);
  const clips = parseClips(value.clips, issues);
  const expressions = parseExpressions(value.expressions, issues);
  const anchors = parseAnchors(value.anchors, issues);
  const variants = parseVariants(value.variants, issues);
  const palette = parsePalette(value.palette, issues);
  for (const slot of Object.keys(palette)) {
    if (variants[slot]) {
      issue(issues, 'error', 'slot.duplicado', `palette.${slot}`, 'Slot não pode ser peça e cor ao mesmo tempo.');
    }
  }
  const lods = parseLods(value.lods, issues);
  if (value.runtime === 'gltf') {
    lods.forEach((lod, index) => {
      if (!/\.(?:glb|gltf)(?:\?.*)?$/iu.test(lod.uri)) {
        issue(issues, 'error', 'lod.not-gltf', `lods.${index}.uri`, 'LOD precisa apontar para .glb ou .gltf.');
      }
    });
  }
  const preload = value.preload;
  if (!['shell', 'lobby', 'game', 'on-demand'].includes(String(preload))) {
    issue(issues, 'error', 'preload.invalid', 'preload', 'Grupo de preload inválido.');
  }
  if (!clips.idle) issue(issues, 'warning', 'clip.idle-missing', 'clips.idle', 'Sem idle; runtime usará pose de repouso.');
  for (const required of ['root', 'head'] as const) {
    if (!anchors[required]) {
      issue(issues, 'warning', 'anchor.recommended-missing', `anchors.${required}`, 'Âncora recomendada ausente.');
    }
  }

  const valid = !issues.some((entry) => entry.severity === 'error');
  if (!valid || !budget || !isRecord(value.source) || !isRecord(value.coordinateSystem)) {
    return { valid: false, manifest: null, issues };
  }
  const manifest: ActorAssetManifest = {
    schema: ACTOR_MANIFEST_SCHEMA,
    id: String(value.id),
    label: String(value.label),
    version: Number(value.version),
    runtime: value.runtime as ActorAssetManifest['runtime'],
    source: {
      uri: String(value.source.uri),
      ...(safeName(value.source.authoring, 300) ? { authoring: value.source.authoring } : {}),
    },
    coordinateSystem: {
      metersPerUnit: Number(value.coordinateSystem.metersPerUnit),
      forward: value.coordinateSystem.forward as '+z' | '-z',
      up: '+y',
    },
    ...(safeName(value.rootNode, 120) ? { rootNode: value.rootNode } : {}),
    clips,
    ...(Object.keys(expressions).length ? { expressions } : {}),
    anchors,
    variants,
    palette,
    lods,
    budget,
    preload: preload as ActorAssetManifest['preload'],
    ...(safeName(value.fallbackActorId, 100) ? { fallbackActorId: value.fallbackActorId } : {}),
  };
  return { valid: true, manifest, issues };
}

export function auditActorAsset(
  manifest: ActorAssetManifest,
  observation: ActorAssetObservation
): ActorManifestIssue[] {
  const issues: ActorManifestIssue[] = [];
  const comparisons: Array<{
    observed: keyof ActorAssetObservation;
    budget: keyof ActorAssetBudget;
    label: string;
  }> = [
    { observed: 'downloadBytes', budget: 'maxDownloadBytes', label: 'download' },
    { observed: 'triangles', budget: 'maxTriangles', label: 'triângulos' },
    { observed: 'drawCalls', budget: 'maxDrawCalls', label: 'draw calls' },
    { observed: 'bones', budget: 'maxBones', label: 'ossos' },
    { observed: 'textureEdge', budget: 'maxTextureEdge', label: 'textura' },
  ];
  for (const comparison of comparisons) {
    const observed = observation[comparison.observed];
    const maximum = manifest.budget[comparison.budget];
    if (typeof observed === 'number' && Number.isFinite(observed) && observed > maximum) {
      issue(
        issues,
        'error',
        `budget.exceeded.${comparison.observed}`,
        `budget.${comparison.budget}`,
        `${comparison.label}: ${Math.round(observed)} excede ${maximum}.`
      );
    }
  }
  return issues;
}

function resolveManifestAssetUri(uri: string, baseUrl: string): string {
  if (/^[a-z][a-z0-9+.-]*:/iu.test(uri)) return uri;
  const fallback = globalThis.location?.href ?? 'http://localhost/';
  return new URL(uri, new URL(baseUrl, fallback)).toString();
}

/** Carrega JSON externo, valida o schema e resolve GLBs/LODs relativos ao manifesto. */
export async function loadActorManifest(
  url: string,
  options: LoadActorManifestOptions = {}
): Promise<ActorAssetManifest> {
  const fetcher = options.fetcher ?? globalThis.fetch;
  if (!fetcher) throw new Error('Fetch indisponível para carregar o manifesto do ator.');
  const response = await fetcher(url, { signal: options.signal });
  if (!response.ok) throw new Error(`Manifesto de ator indisponível (${response.status}).`);
  const audit = auditActorManifest(await response.json());
  if (!audit.valid || !audit.manifest) {
    const summary = audit.issues
      .filter((entry) => entry.severity === 'error')
      .slice(0, 3)
      .map((entry) => `${entry.path}: ${entry.message}`)
      .join(' · ');
    throw new Error(`Manifesto de ator inválido${summary ? ` — ${summary}` : '.'}`);
  }
  if (audit.manifest.runtime !== 'gltf') return audit.manifest;
  const baseUrl = options.baseUrl ?? (response.url || url);
  return {
    ...audit.manifest,
    source: {
      ...audit.manifest.source,
      uri: resolveManifestAssetUri(audit.manifest.source.uri, baseUrl),
    },
    lods: audit.manifest.lods.map((lod) => ({
      ...lod,
      uri: resolveManifestAssetUri(lod.uri, baseUrl),
    })),
  };
}
