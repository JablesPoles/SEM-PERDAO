// Manifesto de áudio do SEM PERDÃO — a fonte da verdade pra geração no
// ElevenLabs. Cada entrada vira um arquivo em `public/audio/<kind>/<id>.mp3`.
//
// `scripts/generate-audio.mjs` lê isto, gera só o que falta (idempotente) e
// salva os mp3. O jogo toca esses arquivos pelo mixer; se um faltar, cai no
// som sintetizado (nada quebra). Edite os prompts à vontade e rode de novo
// com `--force` no id que quiser refazer.
//
// Direção sonora: TRIBUNAL DO PORÃO. Cru, lo-fi, ritualístico, pesado. Preto,
// creme e vermelho em som: madeira, ferro, vela, zumbido elétrico, sussurro.
// Nada limpo ou "corporativo" — é um porão, não um app.

/** @typedef {'sfx'|'music'|'voice'|'ambience'} AudioKind */

// ── EFEITOS (Sound Effects API) ─────────────────────────────────────────────
// Curtos e punchy. `durationSeconds` guia o tamanho; `promptInfluence` (0–1)
// quão literal seguir o prompt (alto = mais fiel, menos "musical").
export const SFX = [
  {
    id: 'card-play',
    prompt: 'a single playing card thrown down flat onto a heavy wooden table, short paper snap and soft thud, close mic, dry, no music',
    durationSeconds: 0.7,
    promptInfluence: 0.7,
  },
  {
    id: 'card-flip',
    prompt: 'a stiff cardstock card flipped over on a wooden table, quick paper flick and light slap, intimate, dry',
    durationSeconds: 0.6,
    promptInfluence: 0.7,
  },
  {
    id: 'hammer-stamp',
    prompt: 'a heavy judge gavel slamming a wooden block once, then a rubber stamp thump on paper, brutal and final, deep low end, courtroom basement',
    durationSeconds: 1.1,
    promptInfluence: 0.6,
  },
  {
    id: 'tick',
    prompt: 'a single dry mechanical clock tick, cold metal, close and quiet, one hit',
    durationSeconds: 0.25,
    promptInfluence: 0.8,
  },
  {
    id: 'countdown-beep',
    prompt: 'a low ominous ritual bell struck once, dark reverb tail, tension rising, cinematic',
    durationSeconds: 1.2,
    promptInfluence: 0.5,
  },
  {
    id: 'round-win',
    prompt: 'a short sinister sting, a low brass swell with a single dissonant hit, someone was just condemned, dark and satisfying',
    durationSeconds: 1.3,
    promptInfluence: 0.4,
  },
  {
    id: 'chat-blip',
    prompt: 'a soft muffled wooden knock, someone whispering in a basement, very short and quiet notification blip',
    durationSeconds: 0.3,
    promptInfluence: 0.7,
  },
  {
    id: 'throw-whoosh',
    prompt: 'a fast object whooshing through the air thrown across a room, short air swish, no impact',
    durationSeconds: 0.5,
    promptInfluence: 0.75,
  },
  {
    id: 'impact-splat',
    prompt: 'a wet tomato splat hitting a body, soft squish and small thud, comedic and gross, dry',
    durationSeconds: 0.5,
    promptInfluence: 0.75,
  },
  {
    id: 'zap',
    prompt: 'an old ceiling light bulb buzzing and flickering, a brief electrical zap and crackle, horror basement',
    durationSeconds: 0.5,
    promptInfluence: 0.7,
  },
  {
    id: 'speech-pop',
    prompt: 'a tiny comic speech-bubble pop, hollow wooden blip, very short and soft',
    durationSeconds: 0.22,
    promptInfluence: 0.8,
  },
  {
    id: 'applause',
    prompt: 'a small mocking slow clap from a few people in a cold stone room, sarcastic, sparse, with light reverb',
    durationSeconds: 2.0,
    promptInfluence: 0.5,
  },
  {
    id: 'laugh',
    prompt: 'a short group of people laughing cruelly in a basement, dark humor, mid crowd, dry',
    durationSeconds: 1.4,
    promptInfluence: 0.55,
  },
];

// ── MÚSICA (Music API) ──────────────────────────────────────────────────────
// Trilhas por fase. `loop: true` = feita pra repetir sem costura audível.
export const MUSIC = [
  {
    id: 'lobby-loop',
    prompt: 'slow menacing dark ambient loop for a basement tribunal waiting room, low drone, distant detuned music box, sparse heartbeat percussion, lo-fi tape hiss, tense but patient, no melody hooks, seamless loop',
    durationSeconds: 45,
    loop: true,
  },
  {
    id: 'tension-loop',
    prompt: 'rising cinematic tension underscore, pulsing low strings, ticking rhythmic clock, cold dread building while a jury reads evidence, dark, no resolution, seamless loop',
    durationSeconds: 40,
    loop: true,
  },
  {
    id: 'victory-sting',
    prompt: 'a short triumphant but twisted fanfare, a lone survivor escaping a basement trial, dark brass and a single church organ chord, ominous victory, 6 seconds',
    durationSeconds: 8,
    loop: false,
  },
  {
    id: 'defeat-sting',
    prompt: 'a short bleak descending sting, a gavel of doom, low detuned piano and a dying music box, condemned, 6 seconds',
    durationSeconds: 8,
    loop: false,
  },
  {
    id: 'finale-theme',
    prompt: 'a slow eerie funeral waltz for the end of a cruel game, detuned music box and cello, black comedy, sinister and grand, builds to a single held organ note, cinematic outro',
    durationSeconds: 30,
    loop: false,
  },
];

// ── AMBIENTE (Sound Effects API, loops longos) ──────────────────────────────
export const AMBIENCE = [
  {
    id: 'basement-loop',
    prompt: 'continuous basement dungeon room tone, faint electrical hum of a single hanging bulb, occasional distant water drip, very faint indistinct whispers, cold air, seamless background loop, no music',
    durationSeconds: 22,
    promptInfluence: 0.5,
    loop: true,
  },
];

// ── NARRAÇÃO (Text-to-Speech) ───────────────────────────────────────────────
// O narrador sinistro do porão. Lê linhas FIXAS (não fala nomes de jogador —
// TTS por nome é inviável). Cada `event` toca uma variante aleatória.
// Voz: defina ELEVENLABS_VOICE_ID (grave, sombria). Modelo: eleven_multilingual_v2.
export const VOICE = [
  { id: 'guilty-1', event: 'guilty', text: 'Culpado.' },
  { id: 'guilty-2', event: 'guilty', text: 'Sem perdão.' },
  { id: 'guilty-3', event: 'guilty', text: 'O tribunal decidiu.' },
  { id: 'guilty-4', event: 'guilty', text: 'Condenado. Próximo.' },

  { id: 'round-open-1', event: 'round-open', text: 'Que comecem os depoimentos.' },
  { id: 'round-open-2', event: 'round-open', text: 'O porão está aberto.' },
  { id: 'round-open-3', event: 'round-open', text: 'Mostrem suas provas.' },

  { id: 'judging-1', event: 'judging', text: 'O júri lê as provas.' },
  { id: 'judging-2', event: 'judging', text: 'A verdade sempre aparece.' },

  { id: 'finale-1', event: 'finale', text: 'Só um escapa da custódia.' },
  { id: 'finale-2', event: 'finale', text: 'O resto apodrece aqui embaixo.' },
  { id: 'finale-3', event: 'finale', text: 'O tribunal está encerrado.' },
];

/** Tudo junto, anotado com o `kind`, pra o gerador iterar. */
export const MANIFEST = [
  ...SFX.map((e) => ({ ...e, kind: 'sfx' })),
  ...MUSIC.map((e) => ({ ...e, kind: 'music' })),
  ...AMBIENCE.map((e) => ({ ...e, kind: 'ambience' })),
  ...VOICE.map((e) => ({ ...e, kind: 'voice' })),
];
