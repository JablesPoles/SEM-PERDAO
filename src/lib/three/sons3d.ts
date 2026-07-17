'use client';
/**
 * sons3d.ts — Sons do Tribunal do Porão, sintetizados via Web Audio.
 * Sem arquivos de áudio (mesma filosofia de lib/sounds.ts) e respeitando o
 * mesmo mute do jogo. Tudo lo-fi de propósito: ruído filtrado + osciladores.
 * Nota: o navegador só libera áudio depois do primeiro clique — sons do caos
 * automático antes disso falham em silêncio, e está tudo bem.
 */
import { isMuted } from '@/lib/sounds';

let ctx: AudioContext | null = null;

function ac(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!ctx) {
    const AC =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}

let ruidoBuf: AudioBuffer | null = null;
function bufferRuido(audio: AudioContext): AudioBuffer {
  if (ruidoBuf && ruidoBuf.sampleRate === audio.sampleRate) return ruidoBuf;
  const n = Math.floor(audio.sampleRate * 0.6);
  const b = audio.createBuffer(1, n, audio.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
  ruidoBuf = b;
  return b;
}

/** Rajada de ruído filtrado (percussão, palmas, estalos). */
function ruido(
  audio: AudioContext,
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
  const f = audio.createBiquadFilter();
  f.type = tipo;
  f.frequency.value = freq;
  f.Q.value = q;
  const env = audio.createGain();
  env.gain.setValueAtTime(0.0001, now + at);
  env.gain.exponentialRampToValueAtTime(gain, now + at + 0.006);
  env.gain.exponentialRampToValueAtTime(0.0001, now + at + dur);
  src.connect(f).connect(env).connect(audio.destination);
  src.start(now + at);
  src.stop(now + at + dur + 0.03);
}

/** Tom com glissando (impactos graves, zumbidos, assobios). */
function tom(
  audio: AudioContext,
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
  osc.connect(env).connect(audio.destination);
  osc.start(now + at);
  osc.stop(now + at + dur + 0.03);
}

function tocar(fn: (audio: AudioContext) => void) {
  if (isMuted()) return;
  const audio = ac();
  if (!audio) return;
  fn(audio);
}

/** Martelo do juiz: estalo seco + corpo grave + eco de porão. */
export function somMartelada() {
  tocar((a) => {
    ruido(a, 0, 0.09, 2600, 0.8, 0.5, 'highpass');
    tom(a, 0, 0.3, 100, 38, 0.5, 'sine');
    ruido(a, 0.015, 0.3, 320, 1, 0.22, 'lowpass');
    tom(a, 0.17, 0.22, 70, 42, 0.16, 'sine'); // eco
  });
}

/** Soco na mesa: baque surdo. */
export function somSoco() {
  tocar((a) => {
    tom(a, 0, 0.13, 130, 55, 0.32, 'triangle');
    ruido(a, 0, 0.09, 220, 1, 0.18, 'lowpass');
  });
}

/** Palmas secas em sequência. */
export function somPalmas(n = 4) {
  tocar((a) => {
    for (let i = 0; i < n; i++) {
      ruido(a, i * 0.1 + Math.random() * 0.015, 0.05, 1500 + Math.random() * 500, 1.4, 0.26);
    }
  });
}

/** Festejo: assobio pra cima + palminhas. */
export function somFesta() {
  tocar((a) => {
    tom(a, 0, 0.14, 620, 950, 0.14, 'sine');
    tom(a, 0.15, 0.22, 950, 1350, 0.14, 'sine');
    ruido(a, 0.28, 0.05, 1600, 1.4, 0.2);
    ruido(a, 0.38, 0.05, 1700, 1.4, 0.2);
  });
}

/** Risada grave, meio engasgada — hé hé hé. */
export function somRisada() {
  tocar((a) => {
    const base = 170 + Math.random() * 30;
    for (let i = 0; i < 4; i++) {
      tom(a, i * 0.11, 0.07, base - i * 12, (base - i * 12) * 0.8, 0.1, 'square');
      ruido(a, i * 0.11, 0.05, 900, 0.6, 0.05, 'bandpass');
    }
  });
}

/** Carta virando/deslizando: tique áspero. */
export function somCarta() {
  tocar((a) => {
    ruido(a, 0, 0.05, 2800, 0.7, 0.2, 'highpass');
    ruido(a, 0.03, 0.04, 1200, 1, 0.1, 'bandpass');
  });
}

/** Apagão da lâmpada: estalo elétrico. */
export function somZap() {
  tocar((a) => {
    tom(a, 0, 0.08, 150, 110, 0.1, 'square');
    ruido(a, 0, 0.05, 4200, 2, 0.07, 'highpass');
  });
}
