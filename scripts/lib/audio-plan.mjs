const AUDIO_KINDS = Object.freeze(['sfx', 'music', 'ambience', 'voice']);

const CORE_SFX = new Set([
  'card-play',
  'card-flip',
  'hammer-stamp',
  'tick',
  'countdown-beep',
  'round-win',
  'chat-blip',
  // o velório do game-end é fluxo principal, não caos opcional
  'body-drop',
]);

const CHAOS_SFX = new Set([
  'throw-whoosh',
  'impact-splat',
  'zap',
  'speech-pop',
  'applause',
  'laugh',
]);

const STARTER_IDS = new Set([
  'card-play',
  'card-flip',
  'hammer-stamp',
  'guilty-1',
  'round-open-1',
]);

export const AUDIO_PRESETS = Object.freeze(['starter', 'core', 'chaos', 'score', 'all']);

export function validateAudioManifest(manifest) {
  if (!Array.isArray(manifest) || manifest.length === 0) {
    throw new Error('Manifesto de áudio vazio ou inválido.');
  }

  const ids = new Set();
  for (const [index, entry] of manifest.entries()) {
    const label = `entrada ${index + 1}`;
    if (!entry || typeof entry !== 'object') throw new Error(`${label}: objeto inválido.`);
    if (!AUDIO_KINDS.includes(entry.kind)) {
      throw new Error(`${label}: kind inválido "${String(entry.kind)}".`);
    }
    if (typeof entry.id !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(entry.id)) {
      throw new Error(`${label}: id inválido "${String(entry.id)}".`);
    }
    if (ids.has(entry.id)) throw new Error(`${label}: id duplicado "${entry.id}".`);
    ids.add(entry.id);

    if (entry.kind === 'voice') {
      if (typeof entry.text !== 'string' || entry.text.trim().length === 0) {
        throw new Error(`${entry.id}: texto de voz vazio.`);
      }
      // A direção é opcional, mas se existir tem que ser só tags — texto solto
      // aqui vira fala acidental do narrador no eleven_v3.
      if (entry.direction !== undefined) {
        if (typeof entry.direction !== 'string' || entry.direction.length > 120) {
          throw new Error(`${entry.id}: direção de voz inválida.`);
        }
        if (entry.direction && !/^(?:\[[a-z ]{2,20}\])+$/u.test(entry.direction)) {
          throw new Error(`${entry.id}: direção deve ser só tags "[assim]".`);
        }
      }
      continue;
    }

    if (typeof entry.prompt !== 'string' || entry.prompt.trim().length === 0) {
      throw new Error(`${entry.id}: prompt vazio.`);
    }
    const duration = Number(entry.durationSeconds);
    const maximum = entry.kind === 'music' ? 600 : 30;
    // SFX muito curtos (tick/blip) são uma intenção de edição; o gerador os
    // limita ao mínimo de 0,5s aceito pela API antes da chamada.
    const minimum = entry.kind === 'music' ? 3 : 0.1;
    if (!Number.isFinite(duration) || duration < minimum || duration > maximum) {
      throw new Error(`${entry.id}: duração deve ficar entre ${minimum}s e ${maximum}s.`);
    }
  }

  return manifest;
}

function matchesPreset(entry, preset) {
  if (preset === 'all') return true;
  if (preset === 'starter') return STARTER_IDS.has(entry.id);
  if (preset === 'core') return entry.kind === 'voice' || CORE_SFX.has(entry.id);
  if (preset === 'chaos') return entry.kind === 'sfx' && CHAOS_SFX.has(entry.id);
  return entry.kind === 'music' || entry.kind === 'ambience';
}

export function selectAudioEntries(manifest, options = {}) {
  validateAudioManifest(manifest);
  const preset = options.preset ?? 'all';
  if (!AUDIO_PRESETS.includes(preset)) {
    throw new Error(`Preset inválido "${preset}". Use: ${AUDIO_PRESETS.join(', ')}.`);
  }

  const kinds = options.kinds ?? null;
  if (kinds) {
    const unknown = kinds.filter((kind) => !AUDIO_KINDS.includes(kind));
    if (unknown.length) throw new Error(`Kinds inválidos: ${unknown.join(', ')}.`);
  }

  const onlyIds = options.onlyIds ?? null;
  if (onlyIds) {
    const knownIds = new Set(manifest.map((entry) => entry.id));
    const unknown = onlyIds.filter((id) => !knownIds.has(id));
    if (unknown.length) throw new Error(`IDs inexistentes: ${unknown.join(', ')}.`);
  }

  const selected = manifest.filter((entry) => (
    matchesPreset(entry, preset)
    && (!kinds || kinds.includes(entry.kind))
    && (!onlyIds || onlyIds.includes(entry.id))
  ));
  if (selected.length === 0) {
    throw new Error('Os filtros não selecionaram nenhum áudio.');
  }
  return selected;
}
