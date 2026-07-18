'use client';
/**
 * sons3d.ts — Sons do Tribunal do Porão, sintetizados via Web Audio.
 * Sem arquivos de áudio (mesma filosofia de lib/sounds.ts) e respeitando mute
 * e volume globais. Tudo lo-fi de propósito: ruído filtrado + osciladores.
 */
import {
  getAudioContext,
  getAudioDestination,
  isMuted,
  resumeAudio,
} from '@/lib/sounds';

interface Ambiente {
  audio: AudioContext;
  bus: GainNode;
  fontes: AudioScheduledSourceNode[];
  nodes: AudioNode[];
}

let ambiente: Ambiente | null = null;
let ambientePedido = 0;
let ruidoBuf: { audio: AudioContext; buffer: AudioBuffer } | null = null;

function bufferRuido(audio: AudioContext): AudioBuffer {
  if (ruidoBuf?.audio === audio && ruidoBuf.buffer.sampleRate === audio.sampleRate) {
    return ruidoBuf.buffer;
  }
  const n = Math.floor(audio.sampleRate * 0.6);
  const buffer = audio.createBuffer(1, n, audio.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < n; i++) data[i] = Math.random() * 2 - 1;
  ruidoBuf = { audio, buffer };
  return buffer;
}

/** Rajada de ruído filtrado (percussão, palmas, estalos). */
function ruido(
  audio: AudioContext,
  destination: AudioNode,
  at: number,
  dur: number,
  freq: number,
  q: number,
  gain: number,
  tipo: BiquadFilterType = 'bandpass'
) {
  const now = audio.currentTime;
  const src = audio.createBufferSource();
  src.buffer = bufferRuido(audio);
  const filter = audio.createBiquadFilter();
  filter.type = tipo;
  filter.frequency.value = freq;
  filter.Q.value = q;
  const env = audio.createGain();
  env.gain.setValueAtTime(0.0001, now + at);
  env.gain.exponentialRampToValueAtTime(gain, now + at + 0.006);
  env.gain.exponentialRampToValueAtTime(0.0001, now + at + dur);
  src.connect(filter).connect(env).connect(destination);
  src.addEventListener('ended', () => {
    src.disconnect();
    filter.disconnect();
    env.disconnect();
  }, { once: true });
  src.start(now + at);
  src.stop(now + at + dur + 0.03);
}

/** Tom com glissando (impactos graves, zumbidos, assobios). */
function tom(
  audio: AudioContext,
  destination: AudioNode,
  at: number,
  dur: number,
  f0: number,
  f1: number,
  gain: number,
  tipo: OscillatorType = 'sine'
) {
  const now = audio.currentTime;
  const osc = audio.createOscillator();
  osc.type = tipo;
  osc.frequency.setValueAtTime(f0, now + at);
  osc.frequency.exponentialRampToValueAtTime(Math.max(f1, 1), now + at + dur);
  const env = audio.createGain();
  env.gain.setValueAtTime(0.0001, now + at);
  env.gain.exponentialRampToValueAtTime(gain, now + at + 0.008);
  env.gain.exponentialRampToValueAtTime(0.0001, now + at + dur);
  osc.connect(env).connect(destination);
  osc.addEventListener('ended', () => {
    osc.disconnect();
    env.disconnect();
  }, { once: true });
  osc.start(now + at);
  osc.stop(now + at + dur + 0.03);
}

function executarEfeito(audio: AudioContext, fn: (audio: AudioContext, bus: AudioNode) => void) {
  const destination = getAudioDestination();
  if (!destination || destination.context !== audio || isMuted()) return;

  // Cada reação ganha headroom próprio antes do limiter global. Isso mantém
  // uma salva de palmas/risadas forte, mas impede a soma de estourar o mixer.
  const eventBus = audio.createGain();
  eventBus.gain.value = 0.68;
  eventBus.connect(destination);
  fn(audio, eventBus);
  window.setTimeout(() => eventBus.disconnect(), 1_600);
}

function tocar(fn: (audio: AudioContext, bus: AudioNode) => void) {
  if (isMuted()) return;
  const requestedAt = Date.now();
  const audio = getAudioContext();
  if (!audio) return;

  const play = (running: AudioContext) => {
    // Efeitos automáticos bloqueados por autoplay não devem chegar atrasados em
    // bloco no primeiro clique do jogador.
    if (Date.now() - requestedAt > 600 || isMuted()) return;
    executarEfeito(running, fn);
  };

  if (audio.state === 'running') play(audio);
  else void resumeAudio().then((running) => {
    if (running) play(running);
  });
}

function montarAmbiente(audio: AudioContext, pedido: number) {
  if (pedido !== ambientePedido || ambiente || isMuted()) return;
  const destination = getAudioDestination();
  if (!destination || destination.context !== audio) return;

  const bus = audio.createGain();
  bus.gain.setValueAtTime(0, audio.currentTime);
  bus.gain.linearRampToValueAtTime(0.026, audio.currentTime + 1.8);
  bus.connect(destination);

  const filtro = audio.createBiquadFilter();
  filtro.type = 'lowpass';
  filtro.frequency.value = 230;
  filtro.Q.value = 0.7;
  filtro.connect(bus);

  const fontes: AudioScheduledSourceNode[] = [];
  const nodes: AudioNode[] = [bus, filtro];
  const criarDrone = (freq: number, ganho: number, tipo: OscillatorType, cents: number) => {
    const osc = audio.createOscillator();
    osc.type = tipo;
    osc.frequency.value = freq;
    osc.detune.value = cents;
    const volume = audio.createGain();
    volume.gain.value = ganho;
    osc.connect(volume).connect(filtro);
    osc.start();
    fontes.push(osc);
    nodes.push(osc, volume);
  };

  criarDrone(43.65, 0.55, 'sine', -5);
  criarDrone(65.41, 0.18, 'triangle', 7);

  // Ar parado/ventilação: ruído longo em loop, quase subliminar.
  const n = Math.floor(audio.sampleRate * 4);
  const buffer = audio.createBuffer(1, n, audio.sampleRate);
  const dados = buffer.getChannelData(0);
  let anterior = 0;
  for (let i = 0; i < n; i++) {
    anterior = anterior * 0.985 + (Math.random() * 2 - 1) * 0.015;
    dados[i] = anterior;
  }
  const ar = audio.createBufferSource();
  ar.buffer = buffer;
  ar.loop = true;
  const arFiltro = audio.createBiquadFilter();
  arFiltro.type = 'bandpass';
  arFiltro.frequency.value = 310;
  arFiltro.Q.value = 0.45;
  const arVolume = audio.createGain();
  arVolume.gain.value = 0.2;
  ar.connect(arFiltro).connect(arVolume).connect(bus);
  ar.start();
  fontes.push(ar);
  nodes.push(ar, arFiltro, arVolume);

  // Oscilação lenta: a sala parece respirar sem virar música melódica.
  const lfo = audio.createOscillator();
  lfo.frequency.value = 0.085;
  const lfoGanho = audio.createGain();
  lfoGanho.gain.value = 55;
  lfo.connect(lfoGanho).connect(filtro.frequency);
  lfo.start();
  fontes.push(lfo);
  nodes.push(lfo, lfoGanho);

  ambiente = { audio, bus, fontes, nodes };
}

/**
 * Drone grave contínuo do porão. A criação só termina quando o AudioContext foi
 * liberado por um gesto; pedidos cancelados não deixam fontes órfãs tocando.
 */
export function iniciarAmbiente() {
  if (ambiente || isMuted()) return;
  const activation = navigator.userActivation;
  if (activation && !activation.hasBeenActive) return;
  const pedido = ++ambientePedido;
  const audio = getAudioContext();
  if (!audio) return;

  if (audio.state === 'running') montarAmbiente(audio, pedido);
  else void resumeAudio().then((running) => {
    if (running) montarAmbiente(running, pedido);
  });
}

/** Encerra o drone com fade, sem estalo, quando a cena 3D é desmontada. */
export function pararAmbiente() {
  ambientePedido++;
  if (!ambiente) return;
  const atual = ambiente;
  ambiente = null;
  const { audio } = atual;
  const now = audio.currentTime;
  const fim = now + 0.45;

  if (typeof atual.bus.gain.cancelAndHoldAtTime === 'function') {
    atual.bus.gain.cancelAndHoldAtTime(now);
  } else {
    atual.bus.gain.cancelScheduledValues(now);
    atual.bus.gain.setValueAtTime(atual.bus.gain.value, now);
  }
  atual.bus.gain.linearRampToValueAtTime(0, fim);
  for (const fonte of atual.fontes) {
    try {
      fonte.stop(fim + 0.02);
    } catch {
      // Pode ter sido encerrada pelo navegador ao fechar a página.
    }
  }
  window.setTimeout(() => {
    for (const node of atual.nodes) {
      try {
        node.disconnect();
      } catch {
        // Nó já desconectado pelo evento ended.
      }
    }
  }, 550);
}

/** Objeto cortando o ar por cima da mesa. */
export function somArremesso() {
  tocar((audio, bus) => {
    ruido(audio, bus, 0, 0.22, 950, 0.7, 0.09, 'bandpass');
    tom(audio, bus, 0, 0.2, 360, 150, 0.07, 'triangle');
  });
}

/** Balão pixelado surgindo: estalo curto de máquina de escrever. */
export function somBalao() {
  tocar((audio, bus) => {
    tom(audio, bus, 0, 0.045, 780, 620, 0.07, 'square');
    tom(audio, bus, 0.055, 0.04, 660, 540, 0.05, 'square');
  });
}

/** Martelo do juiz: estalo seco + corpo grave + eco de porão. */
export function somMartelada() {
  tocar((audio, bus) => {
    ruido(audio, bus, 0, 0.09, 2600, 0.8, 0.5, 'highpass');
    tom(audio, bus, 0, 0.3, 100, 38, 0.5, 'sine');
    ruido(audio, bus, 0.015, 0.3, 320, 1, 0.22, 'lowpass');
    tom(audio, bus, 0.17, 0.22, 70, 42, 0.16, 'sine'); // eco
  });
}

/** Soco na mesa: baque surdo. */
export function somSoco() {
  tocar((audio, bus) => {
    tom(audio, bus, 0, 0.13, 130, 55, 0.32, 'triangle');
    ruido(audio, bus, 0, 0.09, 220, 1, 0.18, 'lowpass');
  });
}

/** Palmas secas em sequência. */
export function somPalmas(n = 4) {
  tocar((audio, bus) => {
    const total = Math.min(12, Math.max(1, Math.round(n)));
    for (let i = 0; i < total; i++) {
      ruido(audio, bus, i * 0.1 + Math.random() * 0.015, 0.05, 1500 + Math.random() * 500, 1.4, 0.26);
    }
  });
}

/** Festejo: assobio para cima + palminhas. */
export function somFesta() {
  tocar((audio, bus) => {
    tom(audio, bus, 0, 0.14, 620, 950, 0.14, 'sine');
    tom(audio, bus, 0.15, 0.22, 950, 1350, 0.14, 'sine');
    ruido(audio, bus, 0.28, 0.05, 1600, 1.4, 0.2);
    ruido(audio, bus, 0.38, 0.05, 1700, 1.4, 0.2);
  });
}

/** Risada grave, meio engasgada — hé hé hé. */
export function somRisada() {
  tocar((audio, bus) => {
    const base = 170 + Math.random() * 30;
    for (let i = 0; i < 4; i++) {
      tom(audio, bus, i * 0.11, 0.07, base - i * 12, (base - i * 12) * 0.8, 0.1, 'square');
      ruido(audio, bus, i * 0.11, 0.05, 900, 0.6, 0.05, 'bandpass');
    }
  });
}

/** Carta virando/deslizando: tique áspero. */
export function somCarta() {
  tocar((audio, bus) => {
    ruido(audio, bus, 0, 0.05, 2800, 0.7, 0.2, 'highpass');
    ruido(audio, bus, 0.03, 0.04, 1200, 1, 0.1, 'bandpass');
  });
}

/** Apagão da lâmpada: estalo elétrico. */
export function somZap() {
  tocar((audio, bus) => {
    tom(audio, bus, 0, 0.08, 150, 110, 0.1, 'square');
    ruido(audio, bus, 0, 0.05, 4200, 2, 0.07, 'highpass');
  });
}
