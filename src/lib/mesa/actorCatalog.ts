import {
  auditActorManifest,
  type ActorAssetManifest,
  type ActorManifestIssue,
} from './actorManifest';

export type ActorCatalogAvailability = 'bundled' | 'on-demand';

interface ActorCatalogEntryBase {
  /** ID estável do manifesto esperado; também é a chave usada pela UI e pelo save. */
  id: string;
  label: string;
  runtime: ActorAssetManifest['runtime'];
  availability: ActorCatalogAvailability;
  description?: string;
  /** Bootstrap do fallback enquanto um manifesto remoto ainda não pôde ser baixado. */
  fallbackActorId?: string;
}

export interface InlineActorCatalogEntry extends ActorCatalogEntryBase {
  source: {
    kind: 'inline-manifest';
    manifest: ActorAssetManifest;
  };
}

export interface RemoteActorCatalogEntry extends ActorCatalogEntryBase {
  runtime: 'gltf';
  source: {
    kind: 'manifest-url';
    url: string;
  };
}

export type ActorCatalogEntry = InlineActorCatalogEntry | RemoteActorCatalogEntry;

export interface ActorCatalogDefinition {
  defaultActorId: string;
  entries: readonly ActorCatalogEntry[];
}

export interface ActorCatalog {
  readonly defaultActorId: string;
  readonly entries: readonly ActorCatalogEntry[];
}

export interface ActorCatalogIssue {
  severity: ActorManifestIssue['severity'];
  code: string;
  path: string;
  message: string;
  actorId: string | null;
}

export interface ActorCatalogAudit {
  valid: boolean;
  issues: ActorCatalogIssue[];
}

export interface SelectActorCatalogOptions {
  unavailableActorIds?: Iterable<string>;
}

export interface ActorCatalogSelection {
  requestedActorId: string;
  entry: ActorCatalogEntry | null;
  chain: readonly string[];
  fallbackUsed: boolean;
  reason: 'requested' | 'unknown-request' | 'unavailable' | 'exhausted';
}

function safeId(value: string): boolean {
  return value.length >= 1
    && value.length <= 100
    && /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/u.test(value);
}

function safeManifestUrl(value: string): boolean {
  if (value.length < 1 || value.length > 500) return false;
  try {
    const parsed = new URL(value, 'https://actor-catalog.invalid/');
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:')
      && !parsed.username
      && !parsed.password
      && /\.json$/iu.test(parsed.pathname);
  } catch {
    return false;
  }
}

function pushIssue(
  issues: ActorCatalogIssue[],
  severity: ActorCatalogIssue['severity'],
  code: string,
  path: string,
  message: string,
  actorId: string | null = null
): void {
  issues.push({ severity, code, path, message, actorId });
}

/**
 * Valida somente o roteamento do catálogo. O conteúdo de manifestos continua
 * pertencendo exclusivamente ao schema `a-mesa.actor/v1`.
 */
export function auditActorCatalog(definition: ActorCatalogDefinition): ActorCatalogAudit {
  const issues: ActorCatalogIssue[] = [];
  const byId = new Map<string, ActorCatalogEntry>();

  if (!safeId(definition.defaultActorId)) {
    pushIssue(
      issues,
      'error',
      'catalog.default-invalid',
      'defaultActorId',
      'O ator padrão precisa ter um ID estável.'
    );
  }

  definition.entries.forEach((entry, index) => {
    const path = `entries.${index}`;
    if (!safeId(entry.id)) {
      pushIssue(issues, 'error', 'catalog.id-invalid', `${path}.id`, 'ID de catálogo inválido.', entry.id);
    }
    if (byId.has(entry.id)) {
      pushIssue(issues, 'error', 'catalog.id-duplicate', `${path}.id`, 'ID de ator duplicado.', entry.id);
    } else {
      byId.set(entry.id, entry);
    }
    if (!entry.label || entry.label.length > 120) {
      pushIssue(issues, 'error', 'catalog.label-invalid', `${path}.label`, 'Rótulo de ator inválido.', entry.id);
    }
    if (entry.availability !== 'bundled' && entry.availability !== 'on-demand') {
      pushIssue(
        issues,
        'error',
        'catalog.availability-invalid',
        `${path}.availability`,
        'Disponibilidade precisa ser bundled ou on-demand.',
        entry.id
      );
    }

    if (entry.source.kind === 'inline-manifest') {
      const audit = auditActorManifest(entry.source.manifest);
      for (const manifestIssue of audit.issues) {
        pushIssue(
          issues,
          manifestIssue.severity,
          `catalog.${manifestIssue.code}`,
          `${path}.source.manifest.${manifestIssue.path}`,
          manifestIssue.message,
          entry.id
        );
      }
      if (audit.manifest) {
        if (audit.manifest.id !== entry.id) {
          pushIssue(
            issues,
            'error',
            'catalog.manifest-id-mismatch',
            `${path}.id`,
            `O catálogo espera ${entry.id}, mas o manifesto declara ${audit.manifest.id}.`,
            entry.id
          );
        }
        if (audit.manifest.runtime !== entry.runtime) {
          pushIssue(
            issues,
            'error',
            'catalog.manifest-runtime-mismatch',
            `${path}.runtime`,
            `O runtime do catálogo não corresponde ao manifesto.`,
            entry.id
          );
        }
        if (
          entry.fallbackActorId
          && audit.manifest.fallbackActorId
          && entry.fallbackActorId !== audit.manifest.fallbackActorId
        ) {
          pushIssue(
            issues,
            'error',
            'catalog.manifest-fallback-mismatch',
            `${path}.fallbackActorId`,
            'O fallback do catálogo não corresponde ao manifesto.',
            entry.id
          );
        }
      }
    } else {
      if (!safeManifestUrl(entry.source.url)) {
        pushIssue(
          issues,
          'error',
          'catalog.manifest-url-invalid',
          `${path}.source.url`,
          'Use uma URL HTTP(S) ou relativa que aponte para um manifesto JSON.',
          entry.id
        );
      }
      if (entry.availability === 'bundled') {
        pushIssue(
          issues,
          'warning',
          'catalog.remote-marked-bundled',
          `${path}.availability`,
          'Manifestos por URL são verificados somente quando carregados.',
          entry.id
        );
      }
    }
  });

  if (!byId.has(definition.defaultActorId)) {
    pushIssue(
      issues,
      'error',
      'catalog.default-missing',
      'defaultActorId',
      'O ator padrão não existe no catálogo.',
      definition.defaultActorId
    );
  }

  definition.entries.forEach((entry, index) => {
    const manifestFallback = entry.source.kind === 'inline-manifest'
      ? entry.source.manifest.fallbackActorId
      : undefined;
    const fallbackActorId = entry.fallbackActorId ?? manifestFallback;
    if (!fallbackActorId) return;
    if (fallbackActorId === entry.id) {
      pushIssue(
        issues,
        'error',
        'catalog.fallback-self',
        `entries.${index}.fallbackActorId`,
        'Um ator não pode ser o próprio fallback.',
        entry.id
      );
    } else if (!byId.has(fallbackActorId)) {
      pushIssue(
        issues,
        'error',
        'catalog.fallback-missing',
        `entries.${index}.fallbackActorId`,
        `Fallback ausente no catálogo: ${fallbackActorId}.`,
        entry.id
      );
    }
  });

  for (const origin of definition.entries) {
    const visited = new Set<string>();
    let current: ActorCatalogEntry | undefined = origin;
    while (current) {
      if (visited.has(current.id)) {
        pushIssue(
          issues,
          'error',
          'catalog.fallback-cycle',
          'entries',
          `Ciclo de fallback detectado a partir de ${origin.id}.`,
          origin.id
        );
        break;
      }
      visited.add(current.id);
      const manifestFallback: string | undefined = current.source.kind === 'inline-manifest'
        ? current.source.manifest.fallbackActorId
        : undefined;
      const nextId: string | undefined = current.fallbackActorId ?? manifestFallback;
      current = nextId ? byId.get(nextId) : undefined;
    }
  }

  return {
    valid: !issues.some((entry) => entry.severity === 'error'),
    issues,
  };
}

export function createActorCatalog(definition: ActorCatalogDefinition): ActorCatalog {
  const audit = auditActorCatalog(definition);
  if (!audit.valid) {
    const summary = audit.issues
      .filter((entry) => entry.severity === 'error')
      .slice(0, 4)
      .map((entry) => `${entry.path}: ${entry.message}`)
      .join(' · ');
    throw new Error(`Catálogo de atores inválido${summary ? ` — ${summary}` : '.'}`);
  }
  return Object.freeze({
    defaultActorId: definition.defaultActorId,
    entries: Object.freeze([...definition.entries]),
  });
}

export function findActorCatalogEntry(
  catalog: ActorCatalog,
  actorId: string
): ActorCatalogEntry | null {
  return catalog.entries.find((entry) => entry.id === actorId) ?? null;
}

export function actorCatalogFallbackId(entry: ActorCatalogEntry): string | null {
  if (entry.fallbackActorId) return entry.fallbackActorId;
  if (entry.source.kind === 'inline-manifest') {
    return entry.source.manifest.fallbackActorId ?? null;
  }
  return null;
}

/** Seleção pura: percorre fallbacks sem fazer fetch nem conhecer Three.js. */
export function selectActorCatalogEntry(
  catalog: ActorCatalog,
  requestedActorId: string | null | undefined,
  options: SelectActorCatalogOptions = {}
): ActorCatalogSelection {
  const unavailable = new Set(options.unavailableActorIds ?? []);
  const requested = requestedActorId || catalog.defaultActorId;
  const requestedEntry = findActorCatalogEntry(catalog, requested);
  const chain: string[] = [];
  let reason: ActorCatalogSelection['reason'] = requestedEntry ? 'requested' : 'unknown-request';
  let currentId = requestedEntry?.id ?? catalog.defaultActorId;
  const visited = new Set<string>();

  if (!requestedEntry && requestedActorId) chain.push(requestedActorId);
  while (!visited.has(currentId)) {
    visited.add(currentId);
    if (!chain.includes(currentId)) chain.push(currentId);
    const entry = findActorCatalogEntry(catalog, currentId);
    if (!entry) break;
    if (!unavailable.has(entry.id)) {
      return {
        requestedActorId: requested,
        entry,
        chain: Object.freeze(chain),
        fallbackUsed: entry.id !== requested,
        reason,
      };
    }
    reason = 'unavailable';
    const fallbackId = actorCatalogFallbackId(entry);
    if (fallbackId) {
      currentId = fallbackId;
    } else if (entry.id !== catalog.defaultActorId) {
      currentId = catalog.defaultActorId;
    } else {
      break;
    }
  }

  return {
    requestedActorId: requested,
    entry: null,
    chain: Object.freeze(chain),
    fallbackUsed: true,
    reason: 'exhausted',
  };
}

/** Confere os campos que só ficam conhecidos após baixar um manifesto remoto. */
export function auditResolvedActorCatalogManifest(
  entry: ActorCatalogEntry,
  manifest: ActorAssetManifest
): ActorCatalogIssue[] {
  const issues: ActorCatalogIssue[] = [];
  const audit = auditActorManifest(manifest);
  for (const manifestIssue of audit.issues) {
    pushIssue(
      issues,
      manifestIssue.severity,
      `catalog.${manifestIssue.code}`,
      `manifest.${manifestIssue.path}`,
      manifestIssue.message,
      entry.id
    );
  }
  if (manifest.id !== entry.id) {
    pushIssue(
      issues,
      'error',
      'catalog.resolved-id-mismatch',
      'manifest.id',
      `A URL de ${entry.id} devolveu o manifesto ${manifest.id}.`,
      entry.id
    );
  }
  if (manifest.runtime !== entry.runtime) {
    pushIssue(
      issues,
      'error',
      'catalog.resolved-runtime-mismatch',
      'manifest.runtime',
      'O runtime baixado não corresponde ao registro do catálogo.',
      entry.id
    );
  }
  if (entry.fallbackActorId && manifest.fallbackActorId !== entry.fallbackActorId) {
    pushIssue(
      issues,
      'error',
      'catalog.resolved-fallback-mismatch',
      'manifest.fallbackActorId',
      'O fallback baixado não corresponde ao registro do catálogo.',
      entry.id
    );
  }
  return issues;
}
