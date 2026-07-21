// Gera os assets de áudio do SEM PERDÃO no ElevenLabs a partir de audio/manifest.mjs.
// Idempotente: só gera o que ainda não existe (economiza crédito). Salva em
// public/audio/<kind>/<id>.mp3.
//
//   npm run audio:gen                 — gera tudo que falta
//   npm run audio:gen -- --force      — regera tudo
//   npm run audio:gen -- --only=hammer-stamp,guilty-1
//   npm run audio:gen -- --kind=sfx,voice
//   npm run audio:gen -- --list       — só lista o que geraria, sem chamar a API
//
// Requer (em .env.local ou no ambiente):
//   ELEVENLABS_API_KEY=...            (obrigatório)
//   ELEVENLABS_VOICE_ID=...           (voz da narração; senão usa um default)
//   ELEVENLABS_MUSIC_MODEL=...        (opcional, default music_v1)
import { mkdir, writeFile, readFile, access } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';
import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js';
import { MANIFEST } from '../audio/manifest.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'public', 'audio');
const OUTPUT_FORMAT = 'mp3_44100_128';
// Voz default: "Bill" (grave, sóbria). Troque por ELEVENLABS_VOICE_ID.
const DEFAULT_VOICE_ID = 'pqHfZKP75CvOlQylNhV4';

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
        forceInstrumental: true,
        outputFormat: OUTPUT_FORMAT,
      });
      break;
    case 'voice': {
      const voiceId = process.env.ELEVENLABS_VOICE_ID || DEFAULT_VOICE_ID;
      stream = await client.textToSpeech.convert(voiceId, {
        text: entry.text,
        modelId: 'eleven_multilingual_v2',
        outputFormat: OUTPUT_FORMAT,
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
  const force = flag('force');
  const listOnly = flag('list');

  let queue = MANIFEST;
  if (onlyKinds) queue = queue.filter((e) => onlyKinds.includes(e.kind));
  if (onlyIds) queue = queue.filter((e) => onlyIds.includes(e.id));

  const planned = [];
  for (const entry of queue) {
    const out = join(OUT_DIR, entry.kind, `${entry.id}.mp3`);
    if (!force && await fileExists(out)) continue;
    planned.push({ entry, out });
  }

  if (listOnly || !planned.length) {
    console.log(`${planned.length} de ${queue.length} a gerar:`);
    for (const { entry } of planned) console.log(`  [${entry.kind}] ${entry.id}`);
    if (!planned.length) console.log('Nada a fazer (use --force pra regerar).');
    if (listOnly) return;
    if (!planned.length) return;
  }

  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    console.error('Falta ELEVENLABS_API_KEY (em .env.local ou no ambiente).');
    process.exit(1);
  }
  const client = new ElevenLabsClient({ apiKey });

  let done = 0;
  for (const { entry, out } of planned) {
    process.stdout.write(`(${++done}/${planned.length}) [${entry.kind}] ${entry.id}… `);
    try {
      const bytes = await generate(entry, client);
      await mkdir(dirname(out), { recursive: true });
      await writeFile(out, bytes);
      console.log(`ok (${Math.round(bytes.length / 1024)} KB)`);
    } catch (error) {
      console.log(`FALHOU — ${error.message}`);
    }
    // gentil com o rate limit
    await new Promise((r) => setTimeout(r, 500));
  }

  await writeIndex();
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
