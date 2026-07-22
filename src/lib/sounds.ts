'use client';

// Sons sintetizados via Web Audio — sem arquivos de áudio, nada para licenciar.
// Este módulo também é o único dono do AudioContext e do mixer global do jogo.

export type SoundName =
  | 'turn'       // rodada nova / sua vez de julgar
  | 'play'       // carta jogada
  | 'flip'       // prova revelada no julgamento
  | 'stamp'      // martelo/carimbo do veredito
  | 'tick'       // reta final do relógio
  | 'countdown'  // contagem ritual antes de começar
  | 'roundWin'   // você levou a rodada
  | 'chat'       // mensagem de outra pessoa
  | 'victory'    // venceu a partida
  | 'defeat'     // a partida acabou e não foi você
  | 'ending';    // encerramento/recap da sessão

export type AudioChannel = 'effects' | 'music' | 'narration';

export const AUDIO_CHANNELS: readonly AudioChannel[] = ['effects', 'music', 'narration'];

const MUTE_KEY = 'sp-muted';
const VOLUME_KEY = 'sp-volume';
const DEFAULT_VOLUME = 0.8;
const MASTER_HEADROOM = 0.9;
const MASTER_RAMP_SECONDS = 0.035;
const CHANNEL_RAMP_SECONDS = 0.08;
const CHANNEL_DEFAULT_VOLUME: Readonly<Record<AudioChannel, number>> = Object.freeze({
  effects: 0.9,
  music: 0.58,
  narration: 0.9,
});
const CHANNEL_ENABLED_KEY: Readonly<Record<AudioChannel, string>> = Object.freeze({
  effects: 'sp-audio-effects-enabled',
  music: 'sp-audio-music-enabled',
  narration: 'sp-audio-narration-enabled',
});
const CHANNEL_VOLUME_KEY: Readonly<Record<AudioChannel, string>> = Object.freeze({
  effects: 'sp-audio-effects-volume',
  music: 'sp-audio-music-volume',
  narration: 'sp-audio-narration-volume',
});

interface AudioMixer {
  context: AudioContext;
  channels: Record<AudioChannel, GainNode>;
  limiter: DynamicsCompressorNode;
  master: GainNode;
}

let mixer: AudioMixer | null = null;
let lifecycleInstalled = false;
let fallbackMuted = false;
let fallbackVolume = DEFAULT_VOLUME;
const fallbackChannelEnabled: Record<AudioChannel, boolean> = {
  effects: true,
  music: true,
  narration: true,
};
const fallbackChannelVolume: Record<AudioChannel, number> = { ...CHANNEL_DEFAULT_VOLUME };

function clampVolume(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_VOLUME;
  return Math.min(1, Math.max(0, value));
}

function readStorage(key: string): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // O mixer continua funcionando mesmo quando o navegador bloqueia storage.
  }
}

export function isMuted(): boolean {
  const stored = readStorage(MUTE_KEY);
  if (stored === null) return fallbackMuted;
  return stored === '1';
}

/** Volume persistido do jogo, sempre normalizado entre 0 e 1. */
export function getVolume(): number {
  const stored = readStorage(VOLUME_KEY);
  if (stored === null) return fallbackVolume;
  const parsed = Number(stored);
  return Number.isFinite(parsed) ? clampVolume(parsed) : fallbackVolume;
}

function targetMasterGain(): number {
  if (isMuted()) return 0;
  // Curva levemente logarítmica: o começo do slider ganha resolução sem perder
  // headroom quando muitas reações acontecem no mesmo instante.
  return Math.pow(getVolume(), 1.35) * MASTER_HEADROOM;
}

export function isAudioChannelEnabled(channel: AudioChannel): boolean {
  const stored = readStorage(CHANNEL_ENABLED_KEY[channel]);
  return stored === null ? fallbackChannelEnabled[channel] : stored !== '0';
}

export function getAudioChannelVolume(channel: AudioChannel): number {
  const stored = readStorage(CHANNEL_VOLUME_KEY[channel]);
  if (stored === null) return fallbackChannelVolume[channel];
  const parsed = Number(stored);
  return Number.isFinite(parsed) ? clampVolume(parsed) : fallbackChannelVolume[channel];
}

function targetChannelGain(channel: AudioChannel): number {
  return isAudioChannelEnabled(channel)
    ? Math.pow(getAudioChannelVolume(channel), 1.2)
    : 0;
}

function updateMasterGain(immediate = false) {
  if (!mixer || mixer.context.state === 'closed') return;
  const { context, master } = mixer;
  const now = context.currentTime;
  const target = targetMasterGain();
  master.gain.cancelScheduledValues(now);
  master.gain.setValueAtTime(master.gain.value, now);
  if (immediate) master.gain.setValueAtTime(target, now);
  else master.gain.linearRampToValueAtTime(target, now + MASTER_RAMP_SECONDS);
}

function updateChannelGains(immediate = false) {
  if (!mixer || mixer.context.state === 'closed') return;
  const now = mixer.context.currentTime;
  for (const channel of AUDIO_CHANNELS) {
    const gain = mixer.channels[channel].gain;
    const target = targetChannelGain(channel);
    gain.cancelScheduledValues(now);
    gain.setValueAtTime(gain.value, now);
    if (immediate) gain.setValueAtTime(target, now);
    else gain.linearRampToValueAtTime(target, now + CHANNEL_RAMP_SECONDS);
  }
}

function installLifecycleHandlers() {
  if (lifecycleInstalled || typeof window === 'undefined') return;
  lifecycleInstalled = true;

  const unlock = () => {
    if (!isMuted()) void resumeAudio();
  };
  const visibilityChanged = () => {
    if (document.hidden) {
      void suspendAudio();
      return;
    }
    const activation = navigator.userActivation;
    if (!isMuted() && (!activation || activation.hasBeenActive)) void resumeAudio();
  };

  // Um contexto suspenso por autoplay ou por troca de aba é retomado no
  // próximo gesto real. Os listeners ficam baratos depois que ele está ativo.
  window.addEventListener('pointerdown', unlock, { capture: true, passive: true });
  window.addEventListener('keydown', unlock, { capture: true });
  window.addEventListener('pagehide', () => void suspendAudio());
  window.addEventListener('pageshow', visibilityChanged);
  document.addEventListener('visibilitychange', visibilityChanged);
  window.addEventListener('storage', (event) => {
    if (event.key === MUTE_KEY) fallbackMuted = event.newValue === '1';
    if (event.key === VOLUME_KEY && event.newValue !== null) {
      fallbackVolume = clampVolume(Number(event.newValue));
    }
    if (event.key === MUTE_KEY || event.key === VOLUME_KEY) updateMasterGain();
    for (const channel of AUDIO_CHANNELS) {
      if (event.key === CHANNEL_ENABLED_KEY[channel]) {
        fallbackChannelEnabled[channel] = event.newValue !== '0';
        updateChannelGains();
      }
      if (event.key === CHANNEL_VOLUME_KEY[channel] && event.newValue !== null) {
        fallbackChannelVolume[channel] = clampVolume(Number(event.newValue));
        updateChannelGains();
      }
    }
  });
}

function ensureMixer(): AudioMixer | null {
  if (typeof window === 'undefined') return null;
  if (mixer?.context.state === 'closed') mixer = null;
  if (mixer) return mixer;

  const AudioContextClass =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextClass) return null;

  const context = new AudioContextClass();
  const channels: Record<AudioChannel, GainNode> = {
    effects: context.createGain(),
    music: context.createGain(),
    narration: context.createGain(),
  };
  const limiter = context.createDynamicsCompressor();
  const master = context.createGain();

  for (const channel of AUDIO_CHANNELS) {
    channels[channel].gain.value = targetChannelGain(channel);
    channels[channel].connect(limiter);
  }
  // Atua como limiter musical: segura rajadas simultâneas sem esmagar o drone.
  limiter.threshold.value = -10;
  limiter.knee.value = 2;
  limiter.ratio.value = 20;
  limiter.attack.value = 0.002;
  limiter.release.value = 0.16;
  master.gain.value = targetMasterGain();

  limiter.connect(master).connect(context.destination);
  mixer = { context, channels, limiter, master };
  installLifecycleHandlers();
  return mixer;
}

/**
 * Contexto compartilhado por sons 2D, ambiente e efeitos 3D.
 * Criá-lo não agenda nem toca som; use resumeAudio após um gesto do usuário.
 */
export function getAudioContext(): AudioContext | null {
  return ensureMixer()?.context ?? null;
}

/** Entrada segura do mixer. Nenhum som do jogo deve ligar direto ao destination. */
export function getAudioDestination(channel: AudioChannel = 'effects'): AudioNode | null {
  return ensureMixer()?.channels[channel] ?? null;
}

/** Retoma o mixer, normalmente a partir de um clique/toque permitido pelo browser. */
export async function resumeAudio(): Promise<AudioContext | null> {
  const current = ensureMixer();
  if (!current) return null;
  try {
    if (current.context.state === 'suspended') await current.context.resume();
  } catch {
    return null;
  }
  if (current.context.state !== 'running') return null;
  updateMasterGain();
  updateChannelGains();
  return current.context;
}

/** Suspende processamento ao esconder/descartar a página; o próximo gesto retoma. */
export async function suspendAudio(): Promise<void> {
  const context = mixer?.context;
  if (!context || context.state !== 'running') return;
  try {
    await context.suspend();
  } catch {
    // Alguns navegadores já suspendem a aba por conta própria.
  }
}

export function setMuted(muted: boolean) {
  if (typeof window === 'undefined') return;
  fallbackMuted = muted;
  writeStorage(MUTE_KEY, muted ? '1' : '0');
  updateMasterGain();
  if (!muted) void resumeAudio();
}

export function setVolume(volume: number) {
  if (typeof window === 'undefined') return;
  fallbackVolume = clampVolume(volume);
  writeStorage(VOLUME_KEY, String(fallbackVolume));
  updateMasterGain();
  if (!isMuted() && fallbackVolume > 0) void resumeAudio();
}

export function setAudioChannelEnabled(channel: AudioChannel, enabled: boolean) {
  fallbackChannelEnabled[channel] = enabled;
  writeStorage(CHANNEL_ENABLED_KEY[channel], enabled ? '1' : '0');
  updateChannelGains();
  if (enabled && !isMuted()) void resumeAudio();
}

export function setAudioChannelVolume(channel: AudioChannel, volume: number) {
  fallbackChannelVolume[channel] = clampVolume(volume);
  writeStorage(CHANNEL_VOLUME_KEY[channel], String(fallbackChannelVolume[channel]));
  updateChannelGains();
  if (fallbackChannelVolume[channel] > 0 && !isMuted()) void resumeAudio();
}

type Note = [freq: number, at: number, dur: number, gain?: number, type?: OscillatorType];

const CUES: Record<SoundName, Note[]> = {
  turn:      [[587, 0, 0.12, 0.18], [880, 0.1, 0.16, 0.18]],
  play:      [[320, 0, 0.06, 0.12, 'triangle']],
  flip:      [[520, 0, 0.05, 0.1, 'triangle'], [780, 0.05, 0.07, 0.1, 'triangle']],
  stamp:     [[150, 0, 0.12, 0.25, 'square'], [90, 0.06, 0.2, 0.22, 'square']],
  tick:      [[880, 0, 0.03, 0.07, 'square']],
  countdown: [[392, 0, 0.07, 0.11, 'square'], [784, 0.045, 0.08, 0.08, 'triangle']],
  roundWin:  [[659, 0, 0.1, 0.16], [988, 0.09, 0.18, 0.16]],
  chat:      [[740, 0, 0.08, 0.12, 'sine']],
  victory:   [[523, 0, 0.14, 0.2], [659, 0.13, 0.14, 0.2], [784, 0.26, 0.14, 0.2], [1047, 0.39, 0.3, 0.22]],
  defeat:    [[392, 0, 0.18, 0.18], [294, 0.16, 0.28, 0.18]],
  ending:    [[196, 0, 0.24, 0.14, 'triangle'], [294, 0.2, 0.22, 0.14, 'triangle'], [392, 0.4, 0.5, 0.16, 'sine']],
};

function scheduleCue(audio: AudioContext, destination: AudioNode, name: SoundName) {
  const now = audio.currentTime + 0.004;
  for (const [freq, at, dur, gain = 0.15, type = 'sine'] of CUES[name]) {
    const osc = audio.createOscillator();
    const env = audio.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, now + at);
    env.gain.setValueAtTime(0.0001, now + at);
    env.gain.exponentialRampToValueAtTime(gain, now + at + 0.01);
    env.gain.exponentialRampToValueAtTime(0.0001, now + at + dur);
    osc.connect(env).connect(destination);
    osc.addEventListener('ended', () => {
      osc.disconnect();
      env.disconnect();
    }, { once: true });
    osc.start(now + at);
    osc.stop(now + at + dur + 0.02);
  }
}

// Cue do jogo → asset gerado no ElevenLabs (public/audio/<path>.mp3). Cues sem
// entrada aqui (ex.: 'turn') continuam 100% sintetizados. Import lazy dentro
// das funções evita ciclo de módulo com audioAssets.
const CUE_ASSETS: Partial<Record<SoundName, string>> = {
  play: 'sfx/card-play',
  flip: 'sfx/card-flip',
  stamp: 'sfx/hammer-stamp',
  tick: 'sfx/tick',
  countdown: 'sfx/countdown-beep',
  roundWin: 'sfx/round-win',
  chat: 'sfx/chat-blip',
  victory: 'music/victory-sting',
  defeat: 'music/defeat-sting',
  ending: 'music/finale-theme',
};

let preloaded = false;

export function playSound(name: SoundName) {
  const channel: AudioChannel = name === 'victory' || name === 'defeat' || name === 'ending'
    ? 'music'
    : 'effects';
  if (isMuted() || !isAudioChannelEnabled(channel)) return;
  const requestedAt = Date.now();
  const audio = getAudioContext();
  if (!audio) return;

  const play = (running: AudioContext) => {
    // Não despeja efeitos antigos quando um autoplay bloqueado só for liberado
    // muito depois por outro gesto.
    if (Date.now() - requestedAt > 600 || isMuted() || !isAudioChannelEnabled(channel)) return;
    const destination = getAudioDestination(channel);
    if (!destination || destination.context !== running) return;

    // Na primeira reprodução (áudio liberado por gesto), aquece os arquivos.
    if (!preloaded) {
      preloaded = true;
      import('./audioAssets').then(({ preloadAssets }) => {
        preloadAssets(Object.values(CUE_ASSETS) as string[]);
      });
    }

    // Arquivo do ElevenLabs se já carregado; senão toca o sintetizado agora e
    // aquece o arquivo pra próxima vez.
    const assetPath = CUE_ASSETS[name];
    if (assetPath) {
      import('./audioAssets').then(({ hasAsset, playAsset, loadAsset }) => {
        if (hasAsset(assetPath)) playAsset(assetPath, { channel });
        else { scheduleCue(running, destination, name); void loadAsset(assetPath); }
      });
      return;
    }
    scheduleCue(running, destination, name);
  };

  if (audio.state === 'running') play(audio);
  else void resumeAudio().then((running) => {
    if (running) play(running);
  });
}
