import { expect, test } from 'playwright/test';

import {
  auditActorCatalog,
  auditResolvedActorCatalogManifest,
  selectActorCatalogEntry,
  type ActorCatalogDefinition,
} from '../src/lib/mesa/actorCatalog';
import { CHARACTER_ACTOR_CATALOG } from '../src/lib/three/actors/characterActorCatalog';
import { PROCEDURAL_CULTIST_MANIFEST } from '../src/lib/three/actors/cultistManifest';

const RIGGED_ID = 'sem-perdao.cultist.gltf-v1';

test('catálogo padrão valida fontes inline e por URL sem outro schema de asset', () => {
  const audit = auditActorCatalog(CHARACTER_ACTOR_CATALOG);
  expect(audit.valid).toBe(true);
  expect(audit.issues).toEqual([]);
  expect(CHARACTER_ACTOR_CATALOG.entries.map((entry) => ({
    id: entry.id,
    runtime: entry.runtime,
    source: entry.source.kind,
  }))).toEqual([
    {
      id: PROCEDURAL_CULTIST_MANIFEST.id,
      runtime: 'procedural',
      source: 'inline-manifest',
    },
    {
      id: RIGGED_ID,
      runtime: 'gltf',
      source: 'manifest-url',
    },
  ]);
});

test('seleção percorre fallback quando o GLB falha e esgota sem loop', () => {
  expect(selectActorCatalogEntry(CHARACTER_ACTOR_CATALOG, RIGGED_ID)).toMatchObject({
    entry: { id: RIGGED_ID },
    fallbackUsed: false,
    reason: 'requested',
  });

  const fallback = selectActorCatalogEntry(CHARACTER_ACTOR_CATALOG, RIGGED_ID, {
    unavailableActorIds: [RIGGED_ID],
  });
  expect(fallback).toMatchObject({
    entry: { id: PROCEDURAL_CULTIST_MANIFEST.id },
    fallbackUsed: true,
    reason: 'unavailable',
  });
  expect(fallback.chain).toEqual([RIGGED_ID, PROCEDURAL_CULTIST_MANIFEST.id]);

  expect(selectActorCatalogEntry(CHARACTER_ACTOR_CATALOG, RIGGED_ID, {
    unavailableActorIds: [RIGGED_ID, PROCEDURAL_CULTIST_MANIFEST.id],
  })).toMatchObject({
    entry: null,
    fallbackUsed: true,
    reason: 'exhausted',
  });
});

test('ID desconhecido cai no default e erros de registro são acionáveis', () => {
  expect(selectActorCatalogEntry(CHARACTER_ACTOR_CATALOG, 'ator.inexistente')).toMatchObject({
    requestedActorId: 'ator.inexistente',
    entry: { id: PROCEDURAL_CULTIST_MANIFEST.id },
    fallbackUsed: true,
    reason: 'unknown-request',
  });

  const remote = CHARACTER_ACTOR_CATALOG.entries.find((entry) => entry.id === RIGGED_ID);
  if (!remote || remote.source.kind !== 'manifest-url') {
    throw new Error('Registro glTF remoto ausente no fixture.');
  }
  const broken: ActorCatalogDefinition = {
    defaultActorId: PROCEDURAL_CULTIST_MANIFEST.id,
    entries: [
      CHARACTER_ACTOR_CATALOG.entries[0],
      {
        ...remote,
        runtime: 'gltf',
        source: { kind: 'manifest-url', url: 'javascript:alert(1)' },
        fallbackActorId: 'ator.ausente',
      },
    ],
  };
  const codes = auditActorCatalog(broken).issues.map((issue) => issue.code);
  expect(codes).toEqual(expect.arrayContaining([
    'catalog.manifest-url-invalid',
    'catalog.fallback-missing',
  ]));
});

test('manifesto remoto precisa corresponder ao ID, runtime e fallback registrados', () => {
  const entry = CHARACTER_ACTOR_CATALOG.entries.find((item) => item.id === RIGGED_ID);
  if (!entry) throw new Error('Registro glTF ausente no fixture.');
  const issues = auditResolvedActorCatalogManifest(entry, PROCEDURAL_CULTIST_MANIFEST);
  expect(issues.map((issue) => issue.code)).toEqual(expect.arrayContaining([
    'catalog.resolved-id-mismatch',
    'catalog.resolved-runtime-mismatch',
    'catalog.resolved-fallback-mismatch',
  ]));
});
