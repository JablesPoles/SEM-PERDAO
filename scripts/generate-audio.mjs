// Gera os assets de áudio do SEM PERDÃO no ElevenLabs a partir de audio/manifest.mjs.
// Idempotente: só gera o que ainda não existe (economiza crédito). Salva em
// public/audio/<kind>/<id>.mp3.
//
//   npm run audio:gen                 — gera tudo que falta
//   npm run audio:gen -- --force      — regera tudo
//   npm run audio:gen -- --only=hammer-stamp,guilty-1
//   npm run audio:gen -- --kind=sfx,voice
//   npm run audio:gen -- --preset=core — SFX usados pelo jogo + todas as vozes
//   npm run audio:gen -- --list       — só lista o que geraria, sem chamar a API
//   npm run audio:gen -- --index      — reconstrói index.json sem chamar a API
//
// Requer (em .env.local ou no ambiente):
//   ELEVENLABS_API_KEY=...            (obrigatório)
//   ELEVENLABS_VOICE_ID=...           (voz da narração; senão usa um default)
//   ELEVENLABS_MUSIC_MODEL=...        (opcional, default music_v1)
import { mkdir, writeFile, readFile, access, rename, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';
import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js';
import { MANIFEST } from '../audio/manifest.mjs';
import { selectAudioEntries } from './lib/audio-plan.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'public', 'audio');
const OUTPUT_FORMAT = 'mp3_44100_128';
// Voz default: "Callum — Husky Trickster", a mais rasgada do set nativo.
// Vozes da BIBLIOTECA não funcionam no plano gratuito (402), só as nativas.
const DEFAULT_VOICE_ID = 'N2lVS1w4EtoT3dr4eOWO';
const DEFAULT_TTS_MODEL = 'eleven_multilingual_v2';
const TTS_MODELS = ['eleven_multilingual_v2', 'eleven_v3'];

/**
 * Sem isto a API usa o preset da voz, que é neutro demais pro porão — foi o que
 * fez a primeira amostra soar "esquisita". O `v3` usa estabilidade discreta
 * (0 criativo / 0,5 natural / 1 robusto) e ignora `style`/`speed`; o `v2` aceita
 * arrastar a fala, que é o que afunda o timbre.
 */
function voiceSettings(model, stability) {
  return model === 'eleven_v3'
    ? { stability, similarityBoost: 0.85, useSpeakerBoost: true }
    : { stability, similarityBoost: 0.85, style: 0.15, useSpeakerBoost: true, speed: 0.88 };
}

// ── .env.local (sem dependências) ───────────────────────────────────────────
async function loadEnv() {
  const path = join(ROOT, '.env.local');
  if (!existsSync(path)) return;
  const text = await readFile(path, 'utf8');
  for (const line of text.split('\n')) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (process.env[key] === undefined) {
      process.env[key] = rawValue.replace(/^["']|["']$/g, '');
    }
  }
}

const arg = (name) => {
  const raw = process.argv.find((a) => a.startsWith(`--${name}=`));
  return raw ? raw.slice(name.length + 3).split(',').filter(Boolean) : null;
};
const flag = (name) => process.argv.includes(`--${name}`);

function singleArg(name, fallback) {
  const values = arg(name);
  if (!values) return fallback;
  if (values.length !== 1) throw new Error(`--${name} aceita um único valor.`);
  return values[0];
}

async function fileExists(path) {
  try { await access(path); return true; } catch { return false; }
}

// ── chamadas por tipo (SDK oficial @elevenlabs/elevenlabs-js) ───────────────
// Todos os métodos devolvem um ReadableStream<Uint8Array>; juntamos em Buffer.
async function streamToBuffer(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

async function generate(entry, client) {
  const seconds = Math.max(0.5, Number(entry.durationSeconds) || 2);
  let stream;
  switch (entry.kind) {
    case 'sfx':
    case 'ambience':
      // Sound Effects. loop costurável exige o modelo v2 (só pro ambiente).
      stream = await client.textToSoundEffects.convert({
        text: entry.prompt,
        durationSeconds: Math.min(30, seconds),
        promptInfluence: entry.promptInfluence ?? 0.6,
        loop: entry.loop === true,
        ...(entry.loop === true ? { modelId: 'eleven_text_to_sound_v2' } : {}),
        outputFormat: OUTPUT_FORMAT,
      });
      break;
    case 'music':
      // Music: texto → trilha instrumental (sem vocais no jogo).
      stream = await client.music.compose({
        prompt: entry.prompt,
        musicLengthMs: Math.min(600_000, Math.max(3_000, Math.round(seconds * 1000))),
        modelId: process.env.ELEVENLABS_MUSIC_MODEL || 'music_v1',
        forceInstrumental: true,
        outputFormat: OUTPUT_FORMAT,
      });
      break;
    case 'voice': {
      const voiceId = process.env.ELEVENLABS_VOICE_ID || DEFAULT_VOICE_ID;
      const modelId = process.env.ELEVENLABS_TTS_MODEL || DEFAULT_TTS_MODEL;
      const stability = Number(process.env.ELEVENLABS_VOICE_STABILITY ?? (modelId === 'eleven_v3' ? 0.5 : 0.62));
      // Tags de direção só existem no v3; no v2 elas seriam LIDAS em voz alta.
      const ehV3 = modelId === 'eleven_v3';
      const text = ehV3 && entry.direction ? `${entry.direction} ${entry.text}` : entry.text;
      stream = await client.textToSpeech.convert(voiceId, {
        text,
        modelId,
        outputFormat: OUTPUT_FORMAT,
        voiceSettings: voiceSettings(modelId, stability),
        // O v3 sozinho confunde PT-BR com espanhol. `languageCode` não é
        // suportado pelo multilingual_v2, então só vai quando é v3.
        ...ehV3 ? { languageCode: process.env.ELEVENLABS_TTS_LANGUAGE || 'pt' } : {},
      });
      break;
    }
    default:
      throw new Error(`kind desconhecido: ${entry.kind}`);
  }
  return streamToBuffer(stream);
}

// ── loop principal ──────────────────────────────────────────────────────────
async function main() {
  await loadEnv();
  const onlyIds = arg('only');
  const onlyKinds = arg('kind');
  const preset = singleArg('preset', 'all');
  const force = flag('force');
  const listOnly = flag('list');
  const indexOnly = flag('index');

  const musicModel = process.env.ELEVENLABS_MUSIC_MODEL || 'music_v1';
  if (!['music_v1', 'music_v2'].includes(musicModel)) {
    throw new Error('ELEVENLABS_MUSIC_MODEL deve ser music_v1 ou music_v2.');
  }
  const ttsModel = process.env.ELEVENLABS_TTS_MODEL || DEFAULT_TTS_MODEL;
  if (!TTS_MODELS.includes(ttsModel)) {
    throw new Error(`ELEVENLABS_TTS_MODEL deve ser um de: ${TTS_MODELS.join(', ')}.`);
  }
  const stability = Number(process.env.ELEVENLABS_VOICE_STABILITY ?? (ttsModel === 'eleven_v3' ? 0.5 : 0.62));
  if (!Number.isFinite(stability) || stability < 0 || stability > 1) {
    throw new Error('ELEVENLABS_VOICE_STABILITY deve ficar entre 0 e 1.');
  }
  const queue = selectAudioEntries(MANIFEST, { onlyIds, kinds: onlyKinds, preset });

  if (indexOnly) {
    await writeIndex();
    console.log('Índice reconstruído sem chamar a API: public/audio/index.json');
    return;
  }

  const planned = [];
  for (const entry of queue) {
    const out = join(OUT_DIR, entry.kind, `${entry.id}.mp3`);
    if (!force && await fileExists(out)) continue;
    planned.push({ entry, out });
  }

  if (listOnly || !planned.length) {
    console.log(`${planned.length} de ${queue.length} a gerar (preset: ${preset}):`);
    for (const { entry } of planned) console.log(`  [${entry.kind}] ${entry.id}`);
    if (!planned.length) console.log('Nada a fazer (use --force pra regerar).');
    if (listOnly) return;
    if (!planned.length) {
      await writeIndex();
      return;
    }
  }

  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    console.error('Falta ELEVENLABS_API_KEY (em .env.local ou no ambiente).');
    process.exit(1);
  }
  const client = new ElevenLabsClient({ apiKey });

  let done = 0;
  const failures = [];
  for (const { entry, out } of planned) {
    process.stdout.write(`(${++done}/${planned.length}) [${entry.kind}] ${entry.id}… `);
    try {
      const bytes = await generate(entry, client);
      if (bytes.length < 256) throw new Error('a API devolveu um arquivo vazio ou truncado');
      await mkdir(dirname(out), { recursive: true });
      const temporary = `${out}.part`;
      await writeFile(temporary, bytes);
      await rename(temporary, out);
      await writeIndex();
      console.log(`ok (${Math.round(bytes.length / 1024)} KB)`);
    } catch (error) {
      await rm(`${out}.part`, { force: true }).catch(() => {});
      const message = error instanceof Error ? error.message : String(error);
      failures.push({ id: entry.id, message });
      console.log(`FALHOU — ${message}`);
    }
    // gentil com o rate limit
    if (done < planned.length) await new Promise((r) => setTimeout(r, 500));
  }

  await writeIndex();
  if (failures.length) {
    console.error(`Falharam ${failures.length} de ${planned.length} assets. O índice contém apenas os válidos.`);
    process.exitCode = 1;
    return;
  }
  console.log('Pronto. Arquivos em public/audio/. Índice: public/audio/index.json');
}

// Índice do que existe em disco → o loader do jogo só busca o que está aqui
// (sem 404 quando o áudio ainda não foi gerado).
async function writeIndex() {
  const present = [];
  for (const entry of MANIFEST) {
    if (await fileExists(join(OUT_DIR, entry.kind, `${entry.id}.mp3`))) {
      present.push(`${entry.kind}/${entry.id}`);
    }
  }
  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(join(OUT_DIR, 'index.json'), JSON.stringify(present, null, 2));
}

main().catch((error) => { console.error(error); process.exit(1); });
