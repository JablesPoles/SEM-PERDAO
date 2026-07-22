import assert from 'node:assert/strict';
import test from 'node:test';
import { MANIFEST } from '../audio/manifest.mjs';
import {
  AUDIO_PRESETS,
  selectAudioEntries,
  validateAudioManifest,
} from '../scripts/lib/audio-plan.mjs';

test('manifesto real tem IDs únicos e entradas válidas', () => {
  assert.equal(validateAudioManifest(MANIFEST), MANIFEST);
  assert.equal(new Set(MANIFEST.map((entry) => entry.id)).size, 32);
});

test('presets dividem o gasto sem perder nem duplicar assets', () => {
  const groups = AUDIO_PRESETS
    .filter((preset) => !['all', 'starter'].includes(preset))
    .flatMap((preset) => selectAudioEntries(MANIFEST, { preset }));
  assert.equal(groups.length, MANIFEST.length);
  assert.equal(new Set(groups.map((entry) => entry.id)).size, MANIFEST.length);
  assert.equal(selectAudioEntries(MANIFEST, { preset: 'core' }).length, 20);
  assert.equal(selectAudioEntries(MANIFEST, { preset: 'chaos' }).length, 6);
  assert.equal(selectAudioEntries(MANIFEST, { preset: 'score' }).length, 6);
  assert.deepEqual(
    selectAudioEntries(MANIFEST, { preset: 'starter' }).map((entry) => entry.id),
    ['card-play', 'card-flip', 'hammer-stamp', 'guilty-1', 'round-open-1']
  );
});

test('filtro inválido falha antes de qualquer chamada paga', () => {
  assert.throws(
    () => selectAudioEntries(MANIFEST, { preset: 'caro-sem-querer' }),
    /Preset inválido/u
  );
  assert.throws(
    () => selectAudioEntries(MANIFEST, { onlyIds: ['nao-existe'] }),
    /IDs inexistentes/u
  );
  assert.throws(
    () => selectAudioEntries(MANIFEST, { kinds: ['video'] }),
    /Kinds inválidos/u
  );
});
