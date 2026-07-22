// Leitura e auditoria de GLB contra `a-mesa.actor/v1`. Puro: recebe bytes e
// manifesto, devolve achados. Sem Three.js, sem rede, sem disco — o CLI e os
// testes usam a mesma função.
//
// Não valida o SCHEMA do manifesto (isso é `auditActorManifest`, no app). Valida
// o cruzamento: o que o manifesto promete existe mesmo dentro do arquivo, e o
// custo real cabe no orçamento declarado.

const MAGIC_GLTF = 0x46546c67;
const CHUNK_JSON = 0x4e4f534a;
const CHUNK_BIN = 0x004e4942;

/** Intenções que um ator de mesa precisa ter pra não parecer quebrado. */
export const CLIPS_ESSENCIAIS = ['idle'];
/** Âncoras sem as quais nome, fala e projétil não têm onde nascer. */
export const ANCORAS_ESSENCIAIS = ['root', 'head'];

const MODO_TRIANGULOS = new Set([4, 5, 6]);

function achado(severidade, codigo, mensagem, detalhe) {
  // Lista vazia não vira "no GLB: " pendurado — sem nada a mostrar, a mensagem
  // já diz tudo.
  return detalhe === undefined || (Array.isArray(detalhe) && !detalhe.length)
    ? { severidade, codigo, mensagem }
    : { severidade, codigo, mensagem, detalhe };
}

/** Bytes legíveis: KB embaixo de 1 MB, senão MB. */
export function formatarBytes(valor) {
  return valor < 1e6 ? `${Math.round(valor / 1024)} KB` : `${(valor / 1e6).toFixed(2)} MB`;
}

/**
 * Abre o contêiner GLB. Devolve o JSON do glTF e o chunk binário; erro de
 * contêiner é fatal e não vale a pena seguir auditando.
 */
export function lerGlb(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.byteLength < 12) throw new Error('Arquivo pequeno demais para ser um GLB.');
  if (view.getUint32(0, true) !== MAGIC_GLTF) {
    throw new Error('Não é um GLB (assinatura "glTF" ausente). Exporte como .glb binário, não .gltf.');
  }
  const versao = view.getUint32(4, true);
  if (versao !== 2) throw new Error(`GLB versão ${versao}; o contrato exige glTF 2.0.`);

  let offset = 12;
  let json = null;
  let bin = null;
  while (offset + 8 <= bytes.byteLength) {
    const tamanho = view.getUint32(offset, true);
    const tipo = view.getUint32(offset + 4, true);
    const inicio = offset + 8;
    const fim = inicio + tamanho;
    if (fim > bytes.byteLength) throw new Error('Chunk do GLB ultrapassa o fim do arquivo (export truncado).');
    if (tipo === CHUNK_JSON) json = JSON.parse(new TextDecoder().decode(bytes.subarray(inicio, fim)));
    else if (tipo === CHUNK_BIN) bin = bytes.subarray(inicio, fim);
    offset = fim + ((4 - (tamanho % 4)) % 4);
  }
  if (!json) throw new Error('GLB sem chunk JSON.');
  return { json, bin };
}

/** Dimensão de imagem pelos primeiros bytes. Evita decodificar o pixel inteiro. */
export function dimensaoImagem(bytes) {
  if (bytes.length >= 24 && bytes[0] === 0x89 && bytes[1] === 0x50) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return { largura: view.getUint32(16, false), altura: view.getUint32(20, false) };
  }
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let i = 2;
    while (i + 9 < bytes.length) {
      if (bytes[i] !== 0xff) { i += 1; continue; }
      const marcador = bytes[i + 1];
      // SOF0–SOF15, pulando DHT(c4), JPG(c8) e DAC(cc)
      if (marcador >= 0xc0 && marcador <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marcador)) {
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        return { altura: view.getUint16(i + 5, false), largura: view.getUint16(i + 7, false) };
      }
      const tamanho = (bytes[i + 2] << 8) | bytes[i + 3];
      i += 2 + tamanho;
    }
    return null;
  }
  if (bytes.length >= 30 && String.fromCharCode(...bytes.subarray(0, 4)) === 'RIFF') {
    const formato = String.fromCharCode(...bytes.subarray(12, 16));
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (formato === 'VP8 ') return { largura: view.getUint16(26, true) & 0x3fff, altura: view.getUint16(28, true) & 0x3fff };
    if (formato === 'VP8L') {
      const b = view.getUint32(21, true);
      return { largura: (b & 0x3fff) + 1, altura: ((b >> 14) & 0x3fff) + 1 };
    }
    if (formato === 'VP8X') {
      const l = bytes[24] | (bytes[25] << 8) | (bytes[26] << 16);
      const a = bytes[27] | (bytes[28] << 8) | (bytes[29] << 16);
      return { largura: l + 1, altura: a + 1 };
    }
  }
  return null;
}

/** Custo real de render, contado do arquivo e não do que o artista acha. */
export function medirGlb(json, bin, tamanhoBytes) {
  const acessores = json.accessors ?? [];
  let triangulos = 0;
  let drawCalls = 0;
  for (const mesh of json.meshes ?? []) {
    for (const prim of mesh.primitives ?? []) {
      drawCalls += 1;
      const modo = prim.mode ?? 4;
      if (!MODO_TRIANGULOS.has(modo)) continue;
      const vertices = prim.indices !== undefined
        ? (acessores[prim.indices]?.count ?? 0)
        : (acessores[prim.attributes?.POSITION]?.count ?? 0);
      triangulos += modo === 4 ? Math.floor(vertices / 3) : Math.max(0, vertices - 2);
    }
  }

  let ossos = 0;
  for (const skin of json.skins ?? []) ossos = Math.max(ossos, (skin.joints ?? []).length);

  let maiorTextura = 0;
  const texturasDesconhecidas = [];
  const vistas = json.bufferViews ?? [];
  for (const [indice, imagem] of (json.images ?? []).entries()) {
    if (imagem.bufferView === undefined || !bin) {
      texturasDesconhecidas.push(imagem.name ?? `image[${indice}]`);
      continue;
    }
    const vista = vistas[imagem.bufferView];
    if (!vista) continue;
    const inicio = vista.byteOffset ?? 0;
    const dim = dimensaoImagem(bin.subarray(inicio, inicio + Math.min(vista.byteLength ?? 0, 64)));
    if (!dim) { texturasDesconhecidas.push(imagem.name ?? `image[${indice}]`); continue; }
    maiorTextura = Math.max(maiorTextura, dim.largura, dim.altura);
  }

  return {
    bytes: tamanhoBytes,
    triangulos,
    drawCalls,
    ossos,
    maiorTextura,
    malhas: (json.meshes ?? []).length,
    materiais: (json.materials ?? []).length,
    nomesDeMaterial: (json.materials ?? []).map((m, i) => m.name ?? `material[${i}]`),
    primitivasPorNo: primitivasPorNo(json),
    animacoes: (json.animations ?? []).map((a, i) => a.name ?? `animation[${i}]`),
    morphs: nomesDeMorph(json),
    nos: (json.nodes ?? []).map((n, i) => n.name ?? `node[${i}]`),
    texturasDesconhecidas,
  };
}

/** `nome do nó → quantas primitivas ele desenha`. Base do custo por aparência. */
function primitivasPorNo(json) {
  const mapa = new Map();
  (json.nodes ?? []).forEach((no, indice) => {
    if (no.mesh === undefined) return;
    const quantas = (json.meshes?.[no.mesh]?.primitives ?? []).length;
    mapa.set(no.name ?? `node[${indice}]`, quantas);
  });
  return mapa;
}

/**
 * Draw calls REALMENTE na tela. Um ator modular carrega três capuzes e três
 * adereços no mesmo arquivo, mas mostra um de cada — somar tudo reprovaria um
 * asset correto. O custo é o da pior aparência possível: base + o máximo de
 * cada slot.
 */
function drawCallsVisiveis(metricas, variants) {
  const slots = Object.entries(variants ?? {});
  if (!slots.length) return metricas.drawCalls;
  const alternaveis = new Set();
  let pico = 0;
  for (const [, opcoes] of slots) {
    let maiorDoSlot = 0;
    for (const nomes of Object.values(opcoes ?? {})) {
      let custo = 0;
      for (const nome of nomes ?? []) {
        alternaveis.add(nome);
        custo += metricas.primitivasPorNo.get(nome) ?? 0;
      }
      maiorDoSlot = Math.max(maiorDoSlot, custo);
    }
    pico += maiorDoSlot;
  }
  let base = metricas.drawCalls;
  for (const nome of alternaveis) base -= metricas.primitivasPorNo.get(nome) ?? 0;
  return Math.max(0, base) + pico;
}

function nomesDeMorph(json) {
  const nomes = new Set();
  for (const mesh of json.meshes ?? []) {
    const declarados = mesh.extras?.targetNames;
    if (Array.isArray(declarados)) for (const nome of declarados) nomes.add(String(nome));
  }
  return [...nomes];
}

/**
 * Cruza o GLB com o manifesto. `manifesto` é o JSON `a-mesa.actor/v1` que viaja
 * ao lado do asset; se vier `null`, só os limites genéricos são checados.
 */
export function auditarAtorGlb({ json, bin, tamanhoBytes, manifesto = null }) {
  const achados = [];
  const metricas = medirGlb(json, bin, tamanhoBytes);
  metricas.drawCallsVisiveis = drawCallsVisiveis(metricas, manifesto?.variants);
  const nos = new Set(metricas.nos);
  const animacoes = new Set(metricas.animacoes);

  if (manifesto) {
    if (manifesto.schema !== 'a-mesa.actor/v1') {
      achados.push(achado('erro', 'schema', `Manifesto declara "${manifesto.schema}"; esperado "a-mesa.actor/v1".`));
    }
    const raiz = manifesto.rootNode;
    if (raiz && !nos.has(raiz)) {
      achados.push(achado('erro', 'root.ausente', `rootNode "${raiz}" não existe no GLB.`, metricas.nos.slice(0, 12)));
    }

    for (const [ancora, no] of Object.entries(manifesto.anchors ?? {})) {
      if (!nos.has(no)) {
        achados.push(achado('erro', 'ancora.ausente', `Âncora "${ancora}" aponta para o nó "${no}", que não existe no GLB.`));
      }
    }
    for (const ancora of ANCORAS_ESSENCIAIS) {
      if (!(manifesto.anchors ?? {})[ancora]) {
        achados.push(achado('erro', 'ancora.faltando', `Âncora obrigatória "${ancora}" não foi declarada no manifesto.`));
      }
    }

    for (const [intencao, ligacao] of Object.entries(manifesto.clips ?? {})) {
      const clip = ligacao?.clip;
      if (clip && !animacoes.has(clip)) {
        achados.push(achado('erro', 'clip.ausente', `Intenção "${intencao}" pede a animação "${clip}", que não existe no GLB.`, metricas.animacoes.slice(0, 12)));
      }
    }
    for (const intencao of CLIPS_ESSENCIAIS) {
      if (!(manifesto.clips ?? {})[intencao]) {
        achados.push(achado('erro', 'clip.faltando', `Sem clip para "${intencao}": o ator fica congelado na mesa.`));
      }
    }

    // Peças modulares: cada nó de cada opção precisa existir, senão a troca de
    // aparência some com parte do boneco em silêncio.
    for (const [slot, opcoes] of Object.entries(manifesto.variants ?? {})) {
      for (const [opcao, nomes] of Object.entries(opcoes ?? {})) {
        for (const nome of nomes ?? []) {
          if (!nos.has(nome)) {
            achados.push(achado('erro', 'variante.ausente', `Aparência "${slot}: ${opcao}" pede o nó "${nome}", que não existe no GLB.`, metricas.nos.slice(0, 12)));
          }
        }
      }
    }
    for (const [slot, tinta] of Object.entries(manifesto.palette ?? {})) {
      if (tinta?.material && !metricas.nomesDeMaterial.includes(tinta.material)) {
        achados.push(achado('erro', 'palette.ausente', `Slot de cor "${slot}" pinta o material "${tinta.material}", que não existe no GLB.`, metricas.nomesDeMaterial.slice(0, 12)));
      }
    }

    for (const [expressao, def] of Object.entries(manifesto.expressions ?? {})) {
      for (const alvo of Object.keys(def?.morphTargets ?? {})) {
        if (!metricas.morphs.includes(alvo)) {
          achados.push(achado('erro', 'morph.ausente', `Expressão "${expressao}" usa o morph "${alvo}", ausente no GLB.`, metricas.morphs.slice(0, 12)));
        }
      }
    }

    const orcamento = manifesto.budget ?? {};
    const limites = [
      ['maxDownloadBytes', metricas.bytes, 'transferência', formatarBytes],
      ['maxTriangles', metricas.triangulos, 'triângulos', String],
      ['maxDrawCalls', metricas.drawCallsVisiveis, 'draw calls', String],
      ['maxBones', metricas.ossos, 'ossos', String],
      ['maxTextureEdge', metricas.maiorTextura, 'maior textura', (v) => `${v} px`],
    ];
    for (const [chave, real, rotulo, formatar] of limites) {
      const teto = Number(orcamento[chave]);
      if (!Number.isFinite(teto) || teto <= 0) continue;
      if (real > teto) {
        achados.push(achado('erro', 'orcamento', `${rotulo}: ${formatar(real)} passa do teto de ${formatar(teto)}.`));
      } else if (real > teto * 0.9) {
        achados.push(achado('aviso', 'orcamento.limite', `${rotulo}: ${formatar(real)} está a menos de 10% do teto (${formatar(teto)}).`));
      }
    }
  }

  // Achados que independem do manifesto — vícios clássicos de export por IA.
  for (const nome of metricas.morphs) {
    if (!nome.startsWith('expr_')) {
      achados.push(achado('aviso', 'morph.prefixo', `Morph "${nome}" não usa o prefixo "expr_" do contrato.`));
    }
  }
  if (metricas.texturasDesconhecidas.length) {
    achados.push(achado('aviso', 'textura.externa', 'Textura não embutida ou em formato não reconhecido; o tamanho não entrou na conta.', metricas.texturasDesconhecidas));
  }
  if (!metricas.animacoes.length) {
    achados.push(achado('aviso', 'sem.animacao', 'GLB sem nenhuma animação. Exportou as Actions? (NLA ou Fake User antes do export.)'));
  }
  if (!(json.skins ?? []).length && metricas.animacoes.length) {
    achados.push(achado('aviso', 'sem.skin', 'Há animação mas nenhum skin: o ator anima por transform de nó, não por deformação.'));
  }

  return {
    metricas,
    achados,
    ok: !achados.some((entrada) => entrada.severidade === 'erro'),
  };
}
