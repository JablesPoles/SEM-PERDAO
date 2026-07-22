# Áudio do SEM PERDÃO (ElevenLabs)

Todo o som pode vir de arquivos gerados no ElevenLabs, tocados pelo mixer do
jogo (volume/mute globais). Se um arquivo faltar, o jogo cai no som
**sintetizado** — nada quebra, dá pra ir gerando aos poucos.

## Fluxo

1. Crie conta em [elevenlabs.io](https://elevenlabs.io) e confirme no painel se
   o plano escolhido cobre SFX, TTS, Music e a licença necessária ao projeto.
   > Limite confirmado no plano gratuito (22/07/2026): **vozes da biblioteca
   > compartilhada não funcionam via API** — a chamada volta `402
   > paid_plan_required`. Só as vozes nativas da conta (`voices.getAll()`)
   > geram. Escolha o narrador entre elas ou o lote de voz falha inteiro.
2. Pegue a key em **Settings → API Keys** e ponha no `.env.local`:
   ```
   ELEVENLABS_API_KEY=...
   ELEVENLABS_VOICE_ID=...   # opcional: voz da narração
   ```
3. No plano gratuito, veja primeiro o preset mínimo (sem gastar crédito):
   ```
   npm run audio:list:starter
   ```
4. Gere e aprove uma amostra de efeito + voz antes de gastar no lote:
   ```
   npm run audio:gen -- --only=hammer-stamp,guilty-1
   ```
5. Se a direção e a voz estiverem boas, complete o `starter` de 5 assets. Os
   dois já gerados serão pulados:
   ```
   npm run audio:gen:starter
   ```
6. Se ainda houver cota, complete os 7 efeitos ligados diretamente ao jogo e
   as 12 falas:
   ```
   npm run audio:gen:core
   ```
7. Só depois complete os outros lotes. `score` deve ser o último no plano
   gratuito, pois música/ambiente são longos e o jogo já tem fallback:
   ```
   npm run audio:gen -- --preset=chaos   # arremessos, impactos e plateia
   npm run audio:gen -- --preset=score   # música e ambiente
   npm run audio:gen                     # tudo que ainda faltar
   npm run audio:gen -- --kind=sfx           # só efeitos
   npm run audio:gen -- --only=hammer-stamp  # um só
   npm run audio:gen -- --force              # regera tudo
   ```
8. Ouça no jogo. Não gostou de um? Ajuste o prompt em `audio/manifest.mjs` e
   rode `npm run audio:gen -- --force --only=<id>`.
9. Os arquivos ficam em `public/audio/<kind>/<id>.mp3` — **comite** pra irem
   pro deploy (a Vercel serve estático; o gerador não roda no build).

`starter` é um subconjunto de 5 assets do `core`. Os lotes completos são
disjuntos: `core` gera 20 assets, `chaos` 6 e `score` 6. O gerador valida
manifesto, preset, kind e IDs antes de chamar a API, grava cada MP3 de forma
atômica e termina com código de erro se qualquer chamada falhar. O
`public/audio/index.json` é atualizado a cada sucesso; uma interrupção não
invalida o que já foi produzido.

## Quando acabar a cota gratuita

O saldo do ElevenLabs nunca bloqueia código ou partida:

1. Continue desenvolvendo normalmente. SFX possuem fallback Web Audio; música e
   narração ausentes ficam silenciosas sem quebrar o jogo.
2. Na próxima renovação da cota, repita o mesmo comando. O gerador é idempotente
   e pula tudo que já existe.
3. Para avançar sem esperar, grave Foley/voz próprios, use assets com licença
   compatível (preferencialmente CC0) ou um gerador local. Exporte MP3 e coloque
   no mesmo caminho descrito pelo manifesto.
4. Depois de adicionar arquivos sem o gerador, rode:
   ```
   npm run audio:index
   ```
5. Registre origem, autor/modelo, prompt e licença em
   `public/audio/SOURCES.md` antes de commitar.

O runtime é baseado em arquivos, não no ElevenLabs: qualquer ferramenta pode
produzir o MP3. Não abra contas extras para contornar limites do plano. A cota e
os recursos disponíveis podem mudar; confirme sempre no painel antes de gerar.

## Onde mexer

- `audio/manifest.mjs` — a direção sonora: cada som → prompt. Comece por aqui.
- `scripts/generate-audio.mjs` — o gerador, via SDK oficial `@elevenlabs/elevenlabs-js`
  (`textToSoundEffects.convert`, `music.compose`, `textToSpeech.convert`).
- `scripts/lib/audio-plan.mjs` — validação e presets puros, sem chamadas pagas.
- `src/lib/audioAssets.ts` — carrega/toca os arquivos pelo mixer, com cache.
- `src/lib/sounds.ts` — mapa cue→arquivo (`CUE_ASSETS`) + fallback sintetizado.

> Música sai instrumental (`forceInstrumental`) e tudo em `mp3_44100_128`. Se um
> tipo falhar (ex.: Music fora do seu plano), o script segue nos outros e você vê
> o motivo por linha; regere só o que faltou com `--only=`.

## Duas lições que custaram amostra

**Não negue nada no prompt de SFX.** O primeiro `hammer-stamp` saiu metálico; a
"correção" acrescentou *"no metal, no bell, no ring, no metallic clang"* e
continuou metálico. Modelo generativo de áudio não faz negação de forma
confiável — citar o que você não quer aumenta a chance de ouvir exatamente
aquilo. Descreva só o objeto e o material (`oak mallet on oak block`), e evite
palavras que carregam o defeito no treino (`gavel` vem com *ring* de filme).

**Narração é `eleven_multilingual_v2`.** O `eleven_v3` tem atuação melhor e
entende as tags de direção, mas lê PT-BR como espanhol; forçar
`languageCode: 'pt'` deixa o português pior que o do v2. Reavalie só com
amostra nova, nunca no meio de um lote.

> A chave é usada somente pelo script local e nunca recebe prefixo
> `NEXT_PUBLIC_`. Não cole a chave em chat, código, Vercel ou arquivo comitado.
