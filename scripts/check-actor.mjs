// Audita um ator glTF contra `a-mesa.actor/v1` e o orçamento do manifesto.
// É o comando que você roda no export do Blender antes de colocar o boneco na
// mesa — ou direto no download de um gerador por IA, pra saber o tamanho do
// estrago antes de abrir o Blender.
//
//   npm run actors:check -- public/mesa/actors/<id>/<versao>/actor.glb
//   npm run actors:check -- caminho/actor.glb --manifest=outro/manifest.json
//   npm run actors:check -- caminho/actor.glb --json
//
// Sai com código 1 se houver erro, 0 se passar (avisos não reprovam).
import { readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import process from 'node:process';
import { auditarAtorGlb, formatarBytes, lerGlb } from './lib/actor-glb.mjs';

const CORES = process.stdout.isTTY
  ? { erro: '\x1b[31m', aviso: '\x1b[33m', ok: '\x1b[32m', fraco: '\x1b[90m', fim: '\x1b[0m' }
  : { erro: '', aviso: '', ok: '', fraco: '', fim: '' };

function argumento(nome) {
  const bruto = process.argv.find((a) => a.startsWith(`--${nome}=`));
  return bruto ? bruto.slice(nome.length + 3) : null;
}

function alvo() {
  const livre = process.argv.slice(2).filter((a) => a !== '--' && !a.startsWith('--'));
  if (livre.length !== 1) {
    throw new Error('Informe exatamente um .glb. Ex.: npm run actors:check -- public/mesa/actors/x/1/actor.glb');
  }
  return resolve(livre[0]);
}

function formatarMetricas(m) {
  return [
    ['transferência', formatarBytes(m.bytes)],
    ['triângulos', m.triangulos.toLocaleString('pt-BR')],
    ['draw calls', m.drawCallsVisiveis === m.drawCalls
      ? String(m.drawCalls)
      : `${m.drawCallsVisiveis} na tela (${m.drawCalls} no arquivo)`],
    ['ossos', String(m.ossos)],
    ['maior textura', m.maiorTextura ? `${m.maiorTextura} px` : '—'],
    ['malhas / materiais', `${m.malhas} / ${m.materiais}`],
    ['animações', m.animacoes.length ? m.animacoes.join(', ') : '—'],
    ['morphs', m.morphs.length ? m.morphs.join(', ') : '—'],
  ];
}

async function main() {
  const caminho = alvo();
  if (!existsSync(caminho)) throw new Error(`Arquivo não encontrado: ${caminho}`);

  const caminhoManifesto = resolve(argumento('manifest') ?? join(dirname(caminho), 'manifest.json'));
  let manifesto = null;
  if (existsSync(caminhoManifesto)) {
    manifesto = JSON.parse(await readFile(caminhoManifesto, 'utf8'));
  }

  const bytes = new Uint8Array(await readFile(caminho));
  const { size } = await stat(caminho);
  const { json, bin } = lerGlb(bytes);
  const relatorio = auditarAtorGlb({ json, bin, tamanhoBytes: size, manifesto });

  if (argumento('json') !== null || process.argv.includes('--json')) {
    console.log(JSON.stringify(relatorio, null, 2));
    process.exitCode = relatorio.ok ? 0 : 1;
    return;
  }

  console.log(`\n${caminho}`);
  console.log(manifesto
    ? `${CORES.fraco}manifesto: ${caminhoManifesto}${CORES.fim}`
    : `${CORES.aviso}sem manifest.json ao lado — só os limites genéricos foram checados${CORES.fim}`);

  console.log('');
  for (const [rotulo, valor] of formatarMetricas(relatorio.metricas)) {
    console.log(`  ${rotulo.padEnd(20)} ${valor}`);
  }

  const erros = relatorio.achados.filter((a) => a.severidade === 'erro');
  const avisos = relatorio.achados.filter((a) => a.severidade === 'aviso');
  if (relatorio.achados.length) console.log('');
  for (const entrada of [...erros, ...avisos]) {
    const cor = entrada.severidade === 'erro' ? CORES.erro : CORES.aviso;
    const marca = entrada.severidade === 'erro' ? 'ERRO ' : 'AVISO';
    console.log(`  ${cor}${marca}${CORES.fim} ${entrada.mensagem}`);
    if (entrada.detalhe) {
      console.log(`        ${CORES.fraco}no GLB: ${[].concat(entrada.detalhe).join(', ')}${CORES.fim}`);
    }
  }

  console.log('');
  if (relatorio.ok) {
    console.log(`  ${CORES.ok}PASSOU${CORES.fim}${avisos.length ? ` (${avisos.length} aviso(s))` : ''} — pode ir pro Character Lab.\n`);
  } else {
    console.log(`  ${CORES.erro}REPROVOU${CORES.fim} — ${erros.length} erro(s). Corrija no Blender e exporte de novo.\n`);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(`\n  ${CORES.erro}FALHOU${CORES.fim} ${error.message}\n`);
  process.exit(1);
});
