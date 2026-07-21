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
import { MANIFEST } from '../audio/manifest.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'public', 'audio');
const API = 'https://api.elevenlabs.io/v1';
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

// ── chamadas por tipo ───────────────────────────────────────────────────────
async function requestBytes(url, body, apiKey) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'xi-api-key': apiKey, 'content-type': 'application/json', accept: 'audio/mpeg' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status} ${res.statusText} — ${detail.slice(0, 300)}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

function generate(entry, apiKey) {
  const seconds = Math.max(0.5, Number(entry.durationSeconds) || 2);
  switch (entry.kind) {
    case 'sfx':
    case 'ambience':
      // Sound Effects: texto → efeito. loop=true pede um som costurável.
      return requestBytes(`${API}/sound-generation`, {
        text: entry.prompt,
        duration_seconds: Math.min(30, seconds),
        prompt_influence: entry.promptInfluence ?? 0.6,
        loop: entry.loop === true,
      }, apiKey);
    case 'music':
      // Music: texto → trilha. Endpoint mais novo — confira em docs se mudar.
      return requestBytes(`${API}/music`, {
        prompt: entry.prompt,
        music_length_ms: Math.round(seconds * 1000),
        model_id: process.env.ELEVENLABS_MUSIC_MODEL || 'music_v1',
      }, apiKey);
    case 'voice': {
      const voiceId = process.env.ELEVENLABS_VOICE_ID || DEFAULT_VOICE_ID;
      return requestBytes(`${API}/text-to-speech/${voiceId}`, {
        text: entry.text,
        model_id: 'eleven_multilingual_v2',
        voice_settings: { stability: 0.45, similarity_boost: 0.8, style: 0.6 },
      }, apiKey);
    }
    default:
      throw new Error(`kind desconhecido: ${entry.kind}`);
  }
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

  let done = 0;
  for (const { entry, out } of planned) {
    process.stdout.write(`(${++done}/${planned.length}) [${entry.kind}] ${entry.id}… `);
    try {
      const bytes = await generate(entry, apiKey);
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
