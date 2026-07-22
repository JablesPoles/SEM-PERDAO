import { expect, test } from 'playwright/test';
import * as THREE from 'three';

import {
  parsePropManifest,
  PropLibrary,
  PROP_MANIFEST_SCHEMA,
} from '../src/lib/three/propLibrary';

const MANIFESTO = {
  schema: PROP_MANIFEST_SCHEMA,
  id: 'teste.props',
  label: 'Props de teste',
  version: 1,
  source: { uri: './props.glb' },
  coordinateSystem: { metersPerUnit: 1, forward: '+z', up: '+y' },
  props: { gavel: 'PropGavel', chair: 'PropChair' },
};

function cenaFalsa() {
  const raiz = new THREE.Group();
  for (const nome of ['PropGavel', 'PropChair']) {
    const no = new THREE.Group();
    no.name = nome;
    const malha = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshStandardMaterial()
    );
    no.add(malha);
    raiz.add(no);
  }
  return raiz;
}

function bibliotecaFalsa(overrides: Record<string, unknown> = {}) {
  let carregamentos = 0;
  const biblioteca = new PropLibrary({
    loader: {
      async loadAsync() {
        carregamentos += 1;
        return { scene: cenaFalsa() };
      },
    },
  });
  const original = globalThis.fetch;
  globalThis.fetch = (async () => ({
    ok: true,
    json: async () => ({ ...MANIFESTO, ...overrides }),
  })) as unknown as typeof fetch;
  return {
    biblioteca,
    contarCarregamentos: () => carregamentos,
    restaurar: () => { globalThis.fetch = original; },
  };
}

test('manifesto de prop recusa schema, coordenada e mapa inválidos', () => {
  expect(parsePropManifest(MANIFESTO)?.id).toBe('teste.props');
  expect(parsePropManifest({ ...MANIFESTO, schema: 'outro/v1' })).toBeNull();
  expect(parsePropManifest({ ...MANIFESTO, props: {} })).toBeNull();
  expect(parsePropManifest({
    ...MANIFESTO,
    coordinateSystem: { metersPerUnit: 0, forward: '+z', up: '+y' },
  })).toBeNull();
  expect(parsePropManifest({
    ...MANIFESTO,
    coordinateSystem: { metersPerUnit: 1, forward: '+x', up: '+y' },
  })).toBeNull();
  // entrada torta é descartada, mas o manifesto sobrevive com o que resta
  const parcial = parsePropManifest({ ...MANIFESTO, props: { gavel: 'PropGavel', '': 'X' } });
  expect(Object.keys(parcial?.props ?? {})).toEqual(['gavel']);
});

test('biblioteca carrega uma vez e entrega clones independentes', async () => {
  const { biblioteca, contarCarregamentos, restaurar } = bibliotecaFalsa();
  try {
    expect(await biblioteca.load('/props/manifest.json')).toBe(true);
    // chamada repetida reaproveita a promessa: um download por sessão
    expect(await biblioteca.load('/props/manifest.json')).toBe(true);
    expect(contarCarregamentos()).toBe(1);
    expect(biblioteca.nomes()).toEqual(['chair', 'gavel']);

    const primeiro = biblioteca.criar('gavel');
    const segundo = biblioteca.criar('gavel');
    expect(primeiro).not.toBeNull();
    expect(primeiro).not.toBe(segundo);
    // mover um clone não pode arrastar o outro
    primeiro!.position.set(3, 0, 0);
    expect(segundo!.position.x).toBe(0);
    expect(biblioteca.criar('inexistente')).toBeNull();
  } finally {
    restaurar();
    biblioteca.dispose();
  }
});

test('falha de rede não lança e a biblioteca fica vazia', async () => {
  const biblioteca = new PropLibrary({
    loader: { async loadAsync() { throw new Error('sem GLB'); } },
  });
  const original = globalThis.fetch;
  globalThis.fetch = (async () => ({ ok: true, json: async () => MANIFESTO })) as unknown as typeof fetch;
  try {
    // O jogo precisa seguir com a geometria procedural; asset ausente jamais
    // pode esvaziar a mesa nem derrubar a montagem da cena.
    expect(await biblioteca.load('/props/manifest.json')).toBe(false);
    expect(biblioteca.pronto).toBe(false);
    expect(biblioteca.criar('gavel')).toBeNull();
  } finally {
    globalThis.fetch = original;
    biblioteca.dispose();
  }
});

test('manifesto ilegível é recusado antes de baixar o GLB', async () => {
  let tentouCarregar = false;
  const biblioteca = new PropLibrary({
    loader: {
      async loadAsync() {
        tentouCarregar = true;
        return { scene: cenaFalsa() };
      },
    },
  });
  const original = globalThis.fetch;
  globalThis.fetch = (async () => ({
    ok: true,
    json: async () => ({ ...MANIFESTO, schema: 'a-mesa.actor/v1' }),
  })) as unknown as typeof fetch;
  try {
    expect(await biblioteca.load('/props/manifest.json')).toBe(false);
    expect(tentouCarregar).toBe(false);
  } finally {
    globalThis.fetch = original;
    biblioteca.dispose();
  }
});

test('descarte libera geometria e impede clones póstumos', async () => {
  const { biblioteca, restaurar } = bibliotecaFalsa();
  try {
    await biblioteca.load('/props/manifest.json');
    const metricas = biblioteca.metricas();
    expect(metricas.props).toBe(2);
    expect(metricas.triangulos).toBeGreaterThan(0);
    biblioteca.dispose();
    expect(biblioteca.pronto).toBe(false);
    expect(biblioteca.criar('gavel')).toBeNull();
    expect(biblioteca.nomes()).toEqual([]);
  } finally {
    restaurar();
  }
});
