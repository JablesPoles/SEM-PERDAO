# Áudio do SEM PERDÃO (ElevenLabs)

Todo o som pode vir de arquivos gerados no ElevenLabs, tocados pelo mixer do
jogo (volume/mute globais). Se um arquivo faltar, o jogo cai no som
**sintetizado** — nada quebra, dá pra ir gerando aos poucos.

## Fluxo

1. Crie conta em [elevenlabs.io](https://elevenlabs.io). SFX e voz (TTS) existem
   em todo plano; confirme se o seu cobre **Music**. Starter (~US$5) já dá
   licença comercial.
2. Pegue a key em **Settings → API Keys** e ponha no `.env.local`:
   ```
   ELEVENLABS_API_KEY=...
   ELEVENLABS_VOICE_ID=...   # opcional: voz da narração
   ```
3. Veja o que seria gerado (sem gastar crédito):
   ```
   npm run audio:list
   ```
4. Gere (só o que falta — idempotente):
   ```
   npm run audio:gen
   npm run audio:gen -- --kind=sfx           # só efeitos
   npm run audio:gen -- --only=hammer-stamp  # um só
   npm run audio:gen -- --force              # regera tudo
   ```
5. Ouça no jogo. Não gostou de um? Ajuste o prompt em `audio/manifest.mjs` e
   rode `npm run audio:gen -- --force --only=<id>`.
6. Os arquivos ficam em `public/audio/<kind>/<id>.mp3` — **comite** pra irem
   pro deploy (a Vercel serve estático; o gerador não roda no build).

## Onde mexer

- `audio/manifest.mjs` — a direção sonora: cada som → prompt. Comece por aqui.
- `scripts/generate-audio.mjs` — o gerador (endpoints do ElevenLabs).
- `src/lib/audioAssets.ts` — carrega/toca os arquivos pelo mixer, com cache.
- `src/lib/sounds.ts` — mapa cue→arquivo (`CUE_ASSETS`) + fallback sintetizado.

> Os endpoints do ElevenLabs (sound-generation, music, text-to-speech) mudam de
> vez em quando. Se algo retornar erro, confira os parâmetros em
> `scripts/generate-audio.mjs` contra a doc atual — está tudo centralizado lá.
