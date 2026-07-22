'use client';

// Camada de arquivos de áudio (gerados no ElevenLabs, em /public/audio).
// Toca pelo MESMO mixer do jogo (volume/mute globais). Se um arquivo não
// existir ou não carregar, quem chama cai no som sintetizado — nada quebra.
//
// Convenção de caminho: `<kind>/<id>` → /audio/<kind>/<id>.mp3
//   ex.: 'sfx/hammer-stamp', 'music/lobby-loop', 'voice/guilty-1'

import {
  getAudioContext,
  getAudioDestination,
  isAudioChannelEnabled,
  isMuted,
  type AudioChannel,
} from './sounds';

const buffers = new Map<string, AudioBuffer | null>();
const loading = new Map<string, Promise<AudioBuffer | null>>();

// Índice do que foi gerado (public/audio/index.json). Enquanto não houver áudio,
// isto é um Set vazio e nenhum mp3 é buscado — zero 404, camada inerte.
let indexPromise: Promise<Set<string>> | null = null;
function ensureIndex(): Promise<Set<string>> {
  if (!indexPromise) {
    indexPromise = fetch('/audio/index.json')
      .then((res) => (res.ok ? res.json() : []))
      .then((list: unknown) => new Set(Array.isArray(list) ? (list as string[]) : []))
      .catch(() => new Set<string>());
  }
  return indexPromise;
}

function url(path: string): string {
  return `/audio/${path}.mp3`;
}

/** Carrega e decodifica um asset (com cache). `null` = não existe / falhou. */
export async function loadAsset(path: string): Promise<AudioBuffer | null> {
  if (buffers.has(path)) return buffers.get(path)!;
  if (loading.has(path)) return loading.get(path)!;

  const ctx = getAudioContext();
  if (!ctx) return null;

  // Nem tenta buscar o que não foi gerado.
  const index = await ensureIndex();
  if (!index.has(path)) { buffers.set(path, null); return null; }

  const task = (async () => {
    try {
      const res = await fetch(url(path));
      if (!res.ok) throw new Error(String(res.status));
      const bytes = await res.arrayBuffer();
      const buffer = await ctx.decodeAudioData(bytes);
      buffers.set(path, buffer);
      return buffer;
    } catch {
      buffers.set(path, null); // marca ausente pra não tentar de novo
      return null;
    } finally {
      loading.delete(path);
    }
  })();
  loading.set(path, task);
  return task;
}

/** Pré-carrega uma leva de assets (chame no primeiro gesto do usuário). */
export function preloadAssets(paths: string[]): void {
  for (const path of paths) void loadAsset(path);
}

/** `true` se o asset já está carregado e presente (síncrono). */
export function hasAsset(path: string): boolean {
  return buffers.get(path) instanceof AudioBuffer;
}

interface PlayOptions {
  gain?: number;
  loop?: boolean;
  rate?: number;
  channel?: AudioChannel;
}

/** Controle de uma fonte tocando (pra parar loops de música/ambiente). */
export interface AssetHandle {
  stop: (fadeSeconds?: number) => void;
  setGain: (value: number, rampSeconds?: number) => void;
}

/**
 * Toca um asset já carregado pelo mixer. Retorna um handle (loops) ou null se
 * o asset não existe — aí o chamador usa o fallback sintetizado.
 */
export function playAsset(path: string, options: PlayOptions = {}): AssetHandle | null {
  const channel = options.channel ?? 'effects';
  if ((isMuted() || !isAudioChannelEnabled(channel)) && !options.loop) return null;
  const buffer = buffers.get(path);
  if (!(buffer instanceof AudioBuffer)) return null;
  const ctx = getAudioContext();
  const destination = getAudioDestination(channel);
  if (!ctx || !destination) return null;

  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.loop = options.loop === true;
  if (options.rate) source.playbackRate.value = options.rate;

  const gainNode = ctx.createGain();
  gainNode.gain.value = options.gain ?? 1;
  source.connect(gainNode).connect(destination);
  source.start();

  let stopped = false;
  return {
    stop(fadeSeconds = 0) {
      if (stopped) return;
      stopped = true;
      const now = ctx.currentTime;
      if (fadeSeconds > 0) {
        gainNode.gain.cancelScheduledValues(now);
        gainNode.gain.setValueAtTime(gainNode.gain.value, now);
        gainNode.gain.linearRampToValueAtTime(0.0001, now + fadeSeconds);
        source.stop(now + fadeSeconds + 0.02);
      } else {
        source.stop();
      }
    },
    setGain(value, rampSeconds = 0.2) {
      const now = ctx.currentTime;
      gainNode.gain.cancelScheduledValues(now);
      gainNode.gain.setValueAtTime(gainNode.gain.value, now);
      gainNode.gain.linearRampToValueAtTime(Math.max(0.0001, value), now + rampSeconds);
    },
  };
}

/**
 * Toca o primeiro asset carregado da lista; retorna `true` se tocou. Serve pra
 * "arquivo com fallback": playFirst(['sfx/x']) || synthFallback().
 */
export async function playFirstLoaded(paths: string[], options: PlayOptions = {}): Promise<boolean> {
  for (const path of paths) {
    if (hasAsset(path)) return playAsset(path, options) != null;
  }
  // não carregado ainda: tenta carregar o primeiro e tocar se vier a tempo
  const buffer = await loadAsset(paths[0]);
  if (buffer) return playAsset(paths[0], options) != null;
  return false;
}
