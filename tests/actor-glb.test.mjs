import assert from 'node:assert/strict';
import test from 'node:test';

import {
  auditarAtorGlb,
  dimensaoImagem,
  lerGlb,
  medirGlb,
} from '../scripts/lib/actor-glb.mjs';

// ── montagem de GLB de teste ────────────────────────────────────────────────
// Escrever o contêiner à mão é o ponto: se o parser só soubesse ler o que o
// nosso próprio exportador escreve, ele não serviria pra auditar export alheio.

function alinhar4(bytes, preenchimento) {
  const sobra = (4 - (bytes.length % 4)) % 4;
  if (!sobra) return bytes;
  return Buffer.concat([bytes, Buffer.alloc(sobra, preenchimento)]);
}

function montarGlb(json, bin = null) {
  const jsonChunk = alinhar4(Buffer.from(JSON.stringify(json), 'utf8'), 0x20);
  const partes = [Buffer.alloc(12)];
  const cabecalhoJson = Buffer.alloc(8);
  cabecalhoJson.writeUInt32LE(jsonChunk.length, 0);
  cabecalhoJson.writeUInt32LE(0x4e4f534a, 4);
  partes.push(cabecalhoJson, jsonChunk);

  if (bin) {
    const binChunk = alinhar4(Buffer.from(bin), 0);
    const cabecalhoBin = Buffer.alloc(8);
    cabecalhoBin.writeUInt32LE(binChunk.length, 0);
    cabecalhoBin.writeUInt32LE(0x004e4942, 4);
    partes.push(cabecalhoBin, binChunk);
  }

  const total = partes.reduce((soma, parte) => soma + parte.length, 0);
  partes[0].writeUInt32LE(0x46546c67, 0);
  partes[0].writeUInt32LE(2, 4);
  partes[0].writeUInt32LE(total, 8);
  return new Uint8Array(Buffer.concat(partes));
}

function pngDe(largura, altura) {
  const bytes = Buffer.alloc(33);
  bytes[0] = 0x89;
  bytes[1] = 0x50;
  bytes.writeUInt32BE(largura, 16);
  bytes.writeUInt32BE(altura, 20);
  return bytes;
}

const MANIFESTO = {
  schema: 'a-mesa.actor/v1',
  id: 'teste.cultist.v1',
  rootNode: 'ActorRoot',
  clips: {
    idle: { clip: 'idle', loop: 'repeat' },
    celebrate: { clip: 'celebrate', loop: 'once' },
  },
  expressions: { joy: { morphTargets: { expr_joy: 1 } } },
  anchors: { root: 'AnchorRoot', head: 'AnchorHead' },
  variants: { hood: { classic: ['HoodClassic'], none: [] } },
  palette: { robe: { material: 'Tunica', property: 'baseColorFactor', values: { blood: '#8f201b' } } },
  budget: {
    maxDownloadBytes: 2_000_000,
    maxTriangles: 24_000,
    maxDrawCalls: 18,
    maxBones: 64,
    maxTextureEdge: 2048,
  },
};

function gltfValido(sobrescritas = {}) {
  return {
    asset: { version: '2.0' },
    nodes: [{ name: 'ActorRoot' }, { name: 'AnchorRoot' }, { name: 'AnchorHead' }, { name: 'Bone' }, { name: 'HoodClassic' }],
    meshes: [{
      name: 'Corpo',
      extras: { targetNames: ['expr_joy', 'expr_shock'] },
      primitives: [{ indices: 0, attributes: { POSITION: 1 }, mode: 4 }],
    }],
    accessors: [{ count: 900 }, { count: 300 }],
    animations: [{ name: 'idle' }, { name: 'celebrate' }],
    skins: [{ joints: [3] }],
    materials: [{ name: 'Tunica' }, { name: 'Acessorio' }],
    images: [{ name: 'atlas', bufferView: 0 }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 33 }],
    ...sobrescritas,
  };
}

function auditar(gltf, { manifesto = MANIFESTO, bin = pngDe(1024, 1024) } = {}) {
  const bytes = montarGlb(gltf, bin);
  const { json, bin: chunk } = lerGlb(bytes);
  return auditarAtorGlb({ json, bin: chunk, tamanhoBytes: bytes.byteLength, manifesto });
}

const codigos = (relatorio) => relatorio.achados.map((a) => a.codigo);

// ── contêiner ───────────────────────────────────────────────────────────────

test('recusa arquivo que não é GLB binário, com motivo acionável', () => {
  assert.throws(
    () => lerGlb(new Uint8Array(Buffer.from('{"asset":{"version":"2.0"}}', 'utf8'))),
    /Exporte como \.glb binário/u,
    'um .gltf de texto renomeado precisa falhar apontando o conserto'
  );
  assert.throws(() => lerGlb(new Uint8Array(4)), /pequeno demais/u);
});

test('acusa export truncado em vez de auditar lixo', () => {
  const bytes = montarGlb(gltfValido());
  assert.throws(() => lerGlb(bytes.subarray(0, bytes.length - 12)), /ultrapassa o fim/u);
});

test('lê o JSON e o chunk binário de um GLB bem formado', () => {
  const { json, bin } = lerGlb(montarGlb(gltfValido(), pngDe(512, 512)));
  assert.equal(json.nodes.length, 5);
  assert.equal(bin.length % 4, 0);
});

// ── medição ─────────────────────────────────────────────────────────────────

test('conta triângulos por modo, draw calls, ossos e maior textura', () => {
  const { json, bin } = lerGlb(montarGlb(gltfValido({
    meshes: [{
      primitives: [
        { indices: 0, mode: 4 },              // 900 índices → 300 triângulos
        { attributes: { POSITION: 1 }, mode: 5 }, // strip de 300 → 298
        { attributes: { POSITION: 1 }, mode: 0 }, // pontos: não conta
      ],
    }],
  }), pngDe(2048, 1024)));
  const m = medirGlb(json, bin, 1234);
  assert.equal(m.triangulos, 598);
  assert.equal(m.drawCalls, 3);
  assert.equal(m.ossos, 1);
  assert.equal(m.maiorTextura, 2048, 'o lado maior é o que importa pro teto');
  assert.equal(m.bytes, 1234);
});

test('dimensão de imagem funciona em PNG, JPEG e WebP', () => {
  assert.deepEqual(dimensaoImagem(pngDe(256, 128)), { largura: 256, altura: 128 });

  const jpeg = Buffer.alloc(24);
  jpeg[0] = 0xff; jpeg[1] = 0xd8; jpeg[2] = 0xff; jpeg[3] = 0xc0;
  jpeg.writeUInt16BE(17, 4); jpeg.writeUInt16BE(64, 7); jpeg.writeUInt16BE(32, 9);
  assert.deepEqual(dimensaoImagem(jpeg), { largura: 32, altura: 64 });

  const webp = Buffer.alloc(30);
  webp.write('RIFF', 0); webp.write('WEBP', 12); webp.write('VP8 ', 12 + 4 - 4);
  webp.write('VP8 ', 12); webp.writeUInt16LE(300, 26); webp.writeUInt16LE(200, 28);
  assert.deepEqual(dimensaoImagem(webp), { largura: 300, altura: 200 });

  assert.equal(dimensaoImagem(Buffer.from([1, 2, 3])), null);
});

// ── auditoria contra o manifesto ────────────────────────────────────────────

test('ator completo passa sem erro', () => {
  const relatorio = auditar(gltfValido());
  assert.equal(relatorio.ok, true, JSON.stringify(relatorio.achados));
  assert.deepEqual(relatorio.achados.filter((a) => a.severidade === 'erro'), []);
});

test('promessa do manifesto que não existe no arquivo reprova', () => {
  // o caso real: renomear a Action no Blender e esquecer o manifesto
  const semClip = auditar(gltfValido({ animations: [{ name: 'Idle.001' }] }));
  assert.equal(semClip.ok, false);
  assert.ok(codigos(semClip).includes('clip.ausente'));
  // e o erro precisa dizer o que EXISTE, senão o artista fica adivinhando
  const detalhe = semClip.achados.find((a) => a.codigo === 'clip.ausente').detalhe;
  assert.ok(detalhe.includes('Idle.001'));

  const semAncora = auditar(gltfValido({
    nodes: [{ name: 'ActorRoot' }, { name: 'AnchorRoot' }],
  }));
  assert.equal(semAncora.ok, false);
  assert.ok(codigos(semAncora).includes('ancora.ausente'));

  const semMorph = auditar(gltfValido({
    meshes: [{ extras: { targetNames: ['expr_shock'] }, primitives: [{ indices: 0 }] }],
  }));
  assert.equal(semMorph.ok, false);
  assert.ok(codigos(semMorph).includes('morph.ausente'));

  const semRaiz = auditar(gltfValido({ nodes: [{ name: 'Cube' }] }));
  assert.ok(codigos(semRaiz).includes('root.ausente'));
});

test('peça de aparência prometida e ausente reprova o export', () => {
  // O erro que o artista comete: modela um capuz só e declara os três.
  const semPeca = auditar(gltfValido(), {
    manifesto: {
      ...MANIFESTO,
      variants: { hood: { classic: ['HoodClassic'], spire: ['HoodSpire'] } },
    },
  });
  assert.equal(semPeca.ok, false);
  const falha = semPeca.achados.find((a) => a.codigo === 'variante.ausente');
  assert.ok(falha, 'a peça faltando precisa reprovar, não passar batido');
  assert.match(falha.mensagem, /hood: spire/u, 'a mensagem tem que dizer QUAL aparência quebra');

  // …e o material que a paleta pinta também precisa existir de verdade.
  const semMaterial = auditar(gltfValido(), {
    manifesto: {
      ...MANIFESTO,
      palette: { robe: { material: 'RobeMat', values: { blood: '#8f201b' } } },
    },
  });
  assert.equal(semMaterial.ok, false);
  assert.ok(codigos(semMaterial).includes('palette.ausente'));

  // Opção vazia ("sem adereço") é legítima e não pode inventar erro.
  const comNone = auditar(gltfValido(), {
    manifesto: { ...MANIFESTO, variants: { accessory: { none: [] } } },
  });
  assert.equal(comNone.ok, true, JSON.stringify(comNone.achados));
});

test('estouro de orçamento reprova e a beirada só avisa', () => {
  const estouro = auditar(gltfValido(), {
    manifesto: { ...MANIFESTO, budget: { ...MANIFESTO.budget, maxTriangles: 100 } },
  });
  assert.equal(estouro.ok, false);
  assert.ok(codigos(estouro).includes('orcamento'));

  // 300 triângulos com teto 320: passa, mas o artista precisa saber
  const beirada = auditar(gltfValido(), {
    manifesto: { ...MANIFESTO, budget: { ...MANIFESTO.budget, maxTriangles: 320 } },
  });
  assert.equal(beirada.ok, true);
  assert.ok(codigos(beirada).includes('orcamento.limite'));
});

test('vícios clássicos de export por IA viram aviso, não reprovação', () => {
  const semAnimacao = auditar(gltfValido({ animations: [] }), {
    manifesto: { ...MANIFESTO, clips: { idle: { clip: 'idle' } } },
  });
  // o clip prometido some junto, então isso é erro; o aviso é o que interessa
  assert.ok(codigos(semAnimacao).includes('sem.animacao'));

  const morphTorto = auditar(gltfValido({
    meshes: [{ extras: { targetNames: ['expr_joy', 'Key 1'] }, primitives: [{ indices: 0 }] }],
  }));
  assert.equal(morphTorto.ok, true, 'nome de morph fora do padrão não pode barrar o asset');
  assert.ok(codigos(morphTorto).includes('morph.prefixo'));

  const texturaExterna = auditar(gltfValido({ images: [{ name: 'fora', uri: 'atlas.png' }] }));
  assert.ok(codigos(texturaExterna).includes('textura.externa'));
  assert.equal(texturaExterna.metricas.maiorTextura, 0);

  const semSkin = auditar(gltfValido({ skins: [] }));
  assert.ok(codigos(semSkin).includes('sem.skin'));
  assert.equal(semSkin.metricas.ossos, 0);
});

test('sem manifesto ainda mede e avisa, sem inventar reprovação', () => {
  const bytes = montarGlb(gltfValido(), pngDe(4096, 4096));
  const { json, bin } = lerGlb(bytes);
  const relatorio = auditarAtorGlb({ json, bin, tamanhoBytes: bytes.byteLength, manifesto: null });
  assert.equal(relatorio.ok, true);
  assert.equal(relatorio.metricas.maiorTextura, 4096);
  assert.equal(relatorio.metricas.triangulos, 300);
});
