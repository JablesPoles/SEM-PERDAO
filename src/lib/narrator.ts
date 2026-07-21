'use client';

// O narrador sinistro do porão. Toca uma variante aleatória de fala (gerada no
// ElevenLabs) por evento. Sem arquivo = no-op silencioso. Um cooldown evita
// falas atropeladas.

import { loadAsset, playAsset, preloadAssets } from './audioAssets';

export type NarrationEvent = 'guilty' | 'round-open' | 'judging' | 'finale';

// Precisa bater com os ids de VOICE em audio/manifest.mjs.
const LINES: Record<NarrationEvent, string[]> = {
  guilty: ['voice/guilty-1', 'voice/guilty-2', 'voice/guilty-3', 'voice/guilty-4'],
  'round-open': ['voice/round-open-1', 'voice/round-open-2', 'voice/round-open-3'],
  judging: ['voice/judging-1', 'voice/judging-2'],
  finale: ['voice/finale-1', 'voice/finale-2', 'voice/finale-3'],
};

const COOLDOWN_MS = 1500;
let lastAt = 0;

/** Pré-carrega todas as falas (chame ao entrar na partida). */
export function preloadNarration(): void {
  preloadAssets(Object.values(LINES).flat());
}

/** Toca uma variante aleatória do evento, se houver arquivo e sem cooldown. */
export function narrate(event: NarrationEvent, gain = 0.9): void {
  const now = Date.now();
  if (now - lastAt < COOLDOWN_MS) return;
  const pool = LINES[event];
  if (!pool?.length) return;
  const path = pool[Math.floor(Math.random() * pool.length)];
  lastAt = now;
  void loadAsset(path).then((buffer) => {
    if (buffer) playAsset(path, { gain });
  });
}
