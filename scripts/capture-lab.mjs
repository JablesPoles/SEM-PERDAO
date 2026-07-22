// QA visual em lote do Character Lab. O arnês genérico vive em
// scripts/lib/capture-matrix.mjs; este arquivo contém apenas o catálogo do jogo.
//
// Com o dev server aberto:
//   npm run capture:lab -- --base-url=http://localhost:3000
// Filtros:
//   npm run capture:lab -- --viewports=portrait --shots=full,face
import { captureMatrix, listArg, valueArg } from './lib/capture-matrix.mjs';

const ALL_VIEWPORTS = {
  desktop: { width: 1440, height: 900 },
  portrait: { width: 390, height: 844 },
  landscape: { width: 844, height: 390 },
};

const ALL_SHOTS = [
  {
    id: 'full',
    query: { camera: 'full', quality: 'balanced', reducedMotion: '1' },
    targets: ['stage', 'controls', 'telemetry'],
  },
  {
    id: 'face',
    query: { camera: 'face', quality: 'balanced', expression: 'joy', reducedMotion: '1' },
    targets: ['stage'],
  },
  {
    id: 'profile',
    query: { camera: 'profile', quality: 'balanced', reducedMotion: '1' },
    targets: ['stage'],
  },
];

const viewportNames = listArg('viewports', Object.keys(ALL_VIEWPORTS));
const shotNames = listArg('shots', ALL_SHOTS.map((shot) => shot.id));
const viewports = Object.fromEntries(
  viewportNames.filter((name) => ALL_VIEWPORTS[name]).map((name) => [name, ALL_VIEWPORTS[name]])
);
const shots = ALL_SHOTS.filter((shot) => shotNames.includes(shot.id));

if (!Object.keys(viewports).length) throw new Error('Nenhum viewport válido foi selecionado.');
if (!shots.length) throw new Error('Nenhum plano válido foi selecionado.');

const captures = await captureMatrix({
  baseUrl: valueArg('base-url', 'http://localhost:3000'),
  route: '/lab/actors',
  outputDirectory: 'captures/character-lab',
  viewports,
  shots,
  targets: {
    stage: '[data-capture-target="stage"]',
    controls: '[data-capture-target="controls"]',
    telemetry: '[data-capture-target="telemetry"]',
  },
  readySelector: '[data-capture-ready="true"]',
  pageStyles: 'nextjs-portal { display: none !important; }',
});

console.log(`\n${captures.length} PNG(s) em captures/character-lab/.`);
