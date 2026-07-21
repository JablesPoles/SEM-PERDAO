'use client';

// Música em loop por cena + loop de ambiente do porão. Tudo pelo mixer do jogo
// (o mute global zera o master, então loops silenciam sozinhos). Se o arquivo
// não existir, é no-op silencioso — o jogo funciona sem música gerada.

import { loadAsset, playAsset, type AssetHandle } from './audioAssets';

type MusicScene = 'silent' | 'lobby' | 'tension' | 'finale';

const SCENE_TRACK: Record<Exclude<MusicScene, 'silent'>, { path: string; gain: number }> = {
  lobby: { path: 'music/lobby-loop', gain: 0.5 },
  tension: { path: 'music/tension-loop', gain: 0.55 },
  finale: { path: 'music/finale-theme', gain: 0.6 },
};

const AMBIENCE_PATH = 'ambience/basement-loop';
const CROSSFADE = 1.1;

let currentScene: MusicScene = 'silent';
let musicHandle: AssetHandle | null = null;
let ambienceHandle: AssetHandle | null = null;

/** Troca a trilha de fundo (crossfade). Idempotente por cena. */
export function setMusicScene(scene: MusicScene): void {
  if (scene === currentScene) return;
  currentScene = scene;

  const previous = musicHandle;
  musicHandle = null;
  if (previous) previous.stop(CROSSFADE);

  if (scene === 'silent') return;
  const track = SCENE_TRACK[scene];
  void loadAsset(track.path).then((buffer) => {
    if (!buffer || currentScene !== scene) return;
    const handle = playAsset(track.path, { loop: scene !== 'finale', gain: 0.0001 });
    if (!handle) return;
    musicHandle = handle;
    handle.setGain(track.gain, CROSSFADE);
  });
}

/** Liga o loop de ambiente do porão (bem baixo, por baixo de tudo). */
export function startAmbience(gain = 0.35): void {
  if (ambienceHandle) return;
  void loadAsset(AMBIENCE_PATH).then((buffer) => {
    if (!buffer || ambienceHandle) return;
    const handle = playAsset(AMBIENCE_PATH, { loop: true, gain: 0.0001 });
    if (!handle) return;
    ambienceHandle = handle;
    handle.setGain(gain, 2.5);
  });
}

export function stopAmbience(): void {
  ambienceHandle?.stop(1.5);
  ambienceHandle = null;
}

/** Desliga tudo (sair da partida). */
export function stopAllMusic(): void {
  setMusicScene('silent');
  stopAmbience();
}
