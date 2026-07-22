# HANDOFF — Sem Perdão → Claude / próxima IA

Atualizado em **22/07/2026**. Este é o contexto canônico e comprimido do trabalho.
Leia este arquivo inteiro antes de editar. Em seguida leia os documentos citados
na seção “ordem de leitura”. Não tente reconstruir a história pelo chat.

## 1. Missão do produto

O Sem Perdão é um party game de cartas em PT-BR, inspirado em Cards Against
Humanity, jogado online em um tribunal de porão 3D. Ele é simultaneamente:

1. um jogo completo que precisa continuar divertido, bonito e estável;
2. o primeiro vertical slice da futura plataforma **A Mesa**;
3. o lugar onde contratos compartilháveis são provados antes de serem extraídos.

A visão d'A Mesa é uma plataforma robusta para party games de cartas/tabuleiro:
sala persistente, jogadores com identidade, chat e reações, atores, câmeras,
som, animações e caos audiovisual reutilizáveis. Cada jogo conserva suas regras,
seus segredos e sua direção de arte.

Prioridade do usuário: melhorias perceptíveis no jogo e tecnologia que aumente
a liberdade de criar party games. Evite gastar ciclos em micro-QA repetitivo ou
QOL burocrático. Implemente lotes significativos e valide uma vez no final.

## 2. Repositórios e estado Git

- Sem Perdão: `/Users/marco.galvao-ext/Sites/SEM-PERDAO`
- Coup / La Corte: `/Users/marco.galvao-ext/Sites/coup-game`
- Hub A Mesa: `/Users/marco.galvao-ext/Sites/a-mesa`
- Branch atual do Sem Perdão: `main`
- HEAD local observado: `271d24d` (`Fortalece multiplayer e extrai base audiovisual da mesa`)
- `origin/main` observado: `b67b8e0`
- Há um lote grande **não commitado** no Sem Perdão e documentação não commitada
  n'A Mesa. Não use reset/checkout e não descarte mudanças que já estavam no repo.
- Atenção: `271d24d` está commitado localmente mas **não foi enviado**. `main`
  está 1 commit à frente de `origin/main`. Ou seja, há trabalho fora do worktree
  sujo que também ainda não chegou ao Vercel.
- O usuário quer revisar/testar antes do próximo commit/push. Não commitar nem
  enviar sem pedido explícito.

O Vercel publica a partir de push. `.env.local` não é commitado. A identidade de
commit usada historicamente é `JablesPoles <matheuspolesnunes@gmail.com>`.

## 3. Estado funcional do jogo

Já existe e deve continuar funcionando:

- lobby ritual, 3–8 jogadores, bots e customização de cultistas;
- modos **1 Juiz** e **Democracia**;
- na democracia todos votam, ninguém vota na própria carta, empate abre segundo
  turno e persistência do empate termina por sorteio para não travar;
- relógios autoritativos, transições automáticas e proteção contra travar em zero;
- escolha de 1/2/3 voltas, limite regulamentar fixo e morte súbita;
- chat, barra de participantes, reações, arremessos e mesa 3D;
- desconexão preserva assento, mão e pontuação; bot joga temporariamente; jogador
  recupera sessão ao voltar; migração de host evita congelar a partida;
- cartas próprias host-only no lobby, persistidas em `localStorage` e mantidas
  em `blackPool`/`whitePool` através de todos os reshuffles;
- fallback 2D quando WebGL não está disponível;
- 88 cartas pretas + 213 cartas brancas base em `src/lib/cards.ts`;
- host autoritativo com snapshots redigidos para cada convidado.

## 4. Invariantes que não podem ser quebradas

### Regra e rede

- `src/lib/game.ts` é regra pura. React e Three.js não decidem vitória, voto,
  timer, remoção, compra ou reshuffle.
- O host mantém o `GameState` completo e aplica ações. Convidados recebem somente
  uma projeção redigida.
- Mãos alheias, decks, pools, autoria lacrada, votos secretos e decisões futuras
  nunca podem chegar ao cliente errado. Não basta esconder no DOM.
- Qualquer campo privado novo deve ser tratado em `redactStateFor`.
- Broadcast público do protótipo não é segurança contra cliente adversarial. A
  fase de plataforma deve migrar para identidade autenticada + canal privado/RLS
  ou backend autoritativo.

### Apresentação

```text
GameState privado e autoritativo
  → projectMesaView(playerId)
  → MesaView pública e segura
  → eventos de apresentação determinísticos
  → ExperienceDirector
  → ExperienceRuntime
  → câmera | ator | VFX | áudio | HUD
  → TabletopStage + UI 2D
```

- Eventos descrevem algo que já ocorreu; não substituem o estado autoritativo.
- Evento e seed devem ser estáveis para replay/reconnect e deduplicados por journal.
- `src/lib/mesa` não importa React, DOM, Supabase, Three.js ou regra específica.
- A engine pede intenção semântica (`celebrate`, `rage`, `hit`), não o nome de
  um clip interno do personagem.
- Renderer, listeners, timers, mixers e GPU resources precisam de `dispose()`.

### Conteúdo e UI

- UI, comentários e documentação são preferencialmente em PT-BR.
- O tom 18+ e brutal faz parte do produto; não suavizar o baralho automaticamente.
- Carta preta deriva `pick` da quantidade de `____`; validar tamanho e IDs.
- Não commitar `.env.local`, chaves privadas ou credenciais com prefixo público.

## 5. Lote atual não commitado

### 5.1 Motor de experiência ao vivo

- `src/lib/mesa/semPerdaoExperience.ts` observa transições reais da `MesaView`.
- Emite com IDs/seeds determinísticos: início de rodada, julgamento, revelação,
  segundo turno, resultado, fim de jogo, envio de prova e presença.
- `src/components/MesaOnline.tsx` instancia `SemPerdaoExperienceSession` e liga
  seus ports ao palco real: câmera, ator, VFX, mixer, narração e HUD.
- `src/lib/three/retroMesa.ts` expõe `playActorIntent` para o vocabulário neutro.
- Efeitos manuais duplicados foram removidos para evitar teatro duas vezes.
- Testes: `tests/sem-perdao-experience.spec.ts`.

### 5.2 Contratos de engine

- `a-mesa.event/v1`: evento serializável, sequência, seed e journal deduplicado.
- `ExperienceDirector`: evento → beats declarativos.
- `ExperienceRuntime`: delay, duração, prioridade, interrupção e cleanup.
- `TableActor`: intenções, expressão, âncoras e métricas.
- `a-mesa.actor/v1`: manifesto de asset, clips, morphs, LOD, preload, fallback e budget.
- `GltfActorAssetStore`: GLTFLoader, Meshopt, KTX2 opcional, clones de rigs,
  cache de templates e mixers por instância.
- Testes: `tests/engine-core.spec.ts`.

### 5.3 Catálogo e Character Lab

- `src/lib/mesa/actorCatalog.ts`: catálogo validado usando `a-mesa.actor/v1`.
- `src/lib/three/actors/characterActorCatalog.ts`: fonte procedural e slot glTF.
- `/lab/actors`: troca fontes de ator sem derrubar o atual; falha de manifesto ou
  GLB ativa fallback procedural e mostra o motivo.
- Slot de manifesto em `public/mesa/actors/sem-perdao.cultist.gltf-v1/1/`.
- O `actor.glb` desse slot está intencionalmente ausente até existir um modelo real.
- Testes: `tests/actor-catalog.spec.ts`.

### 5.4 Palco, framing e mobile landscape

- `TabletopStage` possui modos `landscape`, `portrait` e `compact-landscape`.
- Altura ≤ 480 e aspect ratio ≥ 1,35 selecionam paisagem compacta.
- A câmera compacta é parcial e herda os campos restantes da câmera base.
- Resize reaplica o ato ativo quando o modo muda.
- O framing projeta as caixas de cada mesh visível; não usa mais uma AABB global
  com cantos imaginários. `SkinnedMesh` recalcula bounding box; instâncias são
  avaliadas individualmente.
- Detalhes `face`/`profile` são marcados como recorte intencional; `full` continua
  sendo gate rígido.
- Testes: `tests/stage-core.spec.ts`.

### 5.5 QA visual headless

- `scripts/lib/capture-matrix.mjs`: arnês neutro portado da ideia usada no Coup.
- `scripts/capture-lab.mjs`: catálogo fino do Sem Perdão.
- `npm run capture:lab -- --base-url=http://localhost:3000` gera desktop
  1440×900, portrait 390×844 e landscape 844×390.
- `/lab/actors` aceita `camera`, `quality`, `expression`, `reducedMotion` e expõe
  `data-capture-ready` para captura determinística.
- Capturas vão para `captures/`, que é ignorada.
- Use essa matriz para regressão visual; não repita pilotagem manual do Browser
  após cada pequena edição.

### 5.6 Reações e caos coletivo

- `src/lib/mesa/reactionCatalog.ts`: 24 memes e três arremessos centralizados.
- `GameBoard`, `/3d` e `MesaOnline` usam o mesmo catálogo.
- `src/lib/mesa/reactionCombos.ts`: janela determinística e anti-spam.
- Três participantes usando o mesmo emoji formam `CORO`.
- Seis reações variadas, pelo menos três participantes e três emojis formam
  `MOTIM NA MESA`.
- Combo dispara anúncio, som, tremor e intenção de ator; duplicata, spam de uma
  pessoa e arremessos não contam.
- Testes: `tests/reaction-combos.spec.ts`.

### 5.7 Áudio / ElevenLabs

O runtime de áudio já está integrado:

- mixer único com canais `effects`, `music`, `narration`, volumes, mute e limiter;
- arquivos gerados têm fallback sintetizado, então ausência de MP3 não quebra;
- `audio/manifest.mjs` possui 32 assets: 14 SFX, 5 músicas, 1 ambiente, 12 vozes;
- `src/lib/audioAssets.ts` só busca caminhos presentes em `public/audio/index.json`;
- `src/lib/music.ts` faz loop/crossfade; `src/lib/narrator.ts` escolhe variantes;
- `public/audio/index.json` começa vazio para não produzir 404;
- `scripts/lib/audio-plan.mjs` valida manifesto e separa presets sem API;
- o gerador valida filtros antes de gastar, escreve MP3 atomicamente, atualiza o
  índice após cada sucesso e retorna erro se alguma geração falhar.

Presets (`starter` é subconjunto; os três lotes completos são disjuntos):

| Preset | Quantidade | Conteúdo |
| --- | ---: | --- |
| `starter` | 5 | amostra mínima; subconjunto do `core` |
| `core` | 20 | 8 SFX ligados ao fluxo + 12 falas |
| `chaos` | 6 | arremesso, impacto, zap, fala, palmas, risada |
| `score` | 6 | 5 músicas + ambiente |
| `all` | 32 | tudo |

O usuário informou que usará o **plano gratuito**. Cota e APIs disponíveis devem
ser verificadas no painel, sem assumir números fixos. A chave ElevenLabs ainda
não está configurada. Não peça para o usuário colar a chave no chat. Ele deve
preencher localmente:

```dotenv
ELEVENLABS_API_KEY=...
ELEVENLABS_VOICE_ID=...       # opcional; o script tem fallback
ELEVENLABS_MUSIC_MODEL=music_v1
```

Sequência segura para não desperdiçar créditos:

```bash
npm run audio:list:starter
npm run audio:gen -- --only=hammer-stamp,guilty-1
# usuário ouve e aprova direção/voz
npm run audio:gen:starter
npm run audio:gen:core
npm run audio:gen -- --preset=chaos
npm run audio:gen -- --preset=score
```

Depois da geração, ouvir e aprovar: pronúncia PT-BR, clipping, volume relativo,
latência percebida, costura dos loops e conflito entre narração/chat/reação.
Ajustar somente os prompts/IDs rejeitados com `--force --only=<id>`. Os MP3 e o
índice devem ser commitados quando aprovados; a chave nunca.

Quando a cota gratuita acabar, o trabalho continua: manter fallbacks Web Audio,
esperar a renovação e repetir comandos idempotentes, ou substituir qualquer
asset por gravação própria, CC0/licença compatível ou geração local. Arquivos
externos usam os mesmos caminhos do manifesto; executar `npm run audio:index` e
registrar proveniência em `public/audio/SOURCES.md`. O runtime não depende do
fornecedor. Não recomendar evasão de limites por múltiplas contas.

## 6. Roadmap em fases

### Fase 0 — congelar o vertical slice atual

Objetivo: transformar o lote não commitado em baseline confiável.

Trabalho:

1. usuário testa uma sala real com 3+ navegadores/dispositivos;
2. validar juiz e democracia, reconnect, migração de host, timer em zero, combo
   de reação, arremesso e fallback 2D;
3. validar `/lab/actors` desktop/mobile com `capture:lab` uma única vez;
4. corrigir somente regressões concretas;
5. separar commit de engine/docs de assets gerados, se isso facilitar revisão.

Gate:

- `npm test`, `npm run lint`, `npm run build`, `git diff --check`;
- nenhum segredo em snapshot de convidado;
- nenhuma duplicação de efeito após reconnect;
- aprovação visual do usuário.

### Fase 1 — direção sonora produzida

Objetivo: substituir os placeholders principais por uma identidade sonora real
sem acoplar o jogo ao fornecedor.

Trabalho:

1. gerar amostra `hammer-stamp` + `guilty-1` e aprovar;
2. completar `starter` e só então consumir o que restar da cota em `core`;
3. normalizar percepção de volume via ganhos do mixer, sem alterar MP3 às cegas;
4. gerar `chaos`, então `score`; no plano gratuito, música longa é a última prioridade;
5. adicionar um Audio Lab/headless report se a quantidade de assets crescer:
   duração, tamanho, pico/loudness, loop e uso por cue;
6. registrar origem, modelo e prompt em metadata de build para regeneração.

Gate:

- jogo continua funcional com `public/audio/index.json = []`;
- autoplay bloqueado não despeja sons atrasados;
- cada fase toca a música correta e crossfade não deixa fontes órfãs;
- narração não atropela outra fala nem ignora mute de canal;
- créditos só são gastos em IDs explicitamente listados.

### Fase 2 — primeiro personagem glTF real

Objetivo: provar que artistas conseguem subir personagens sem hardcode.

Trabalho:

1. produzir/obter cultista rigado com licença e arquivos-fonte;
2. exportar GLB otimizado, dois LODs e texturas comprimidas;
3. mapear clips semânticos: idle, celebrate, rage, hit, speak e sleep;
4. mapear morphs/expressões e âncoras de cabeça, fala, mão e projétil;
5. completar manifesto `a-mesa.actor/v1`;
6. passar no Character Lab em todas as câmeras/qualidades/viewports;
7. comparar procedural/glTF lado a lado e manter fallback;
8. só então permitir seleção do glTF em produção.

Gate:

- budget de triângulos, draw calls, texturas e memória respeitado;
- framing `full` sem overflow acidental;
- reduced motion, reconnect e descarte repetido funcionam;
- falha de rede/asset não deixa a mesa vazia;
- licenças e atribuições registradas.

### Fase 3 — Scene Lab, replay e caos composto

Objetivo: permitir criar/polir cenas de party game sem depender de uma partida
online completa.

Trabalho:

1. criar `/lab/scenes` com timeline, scrub, play/pause e seleção de evento;
2. gravar `MesaView` pública + journal de eventos em fixture redigida;
3. reproduzir câmera/ator/VFX/áudio/HUD deterministicamente por seed;
4. adicionar camera rigs: orbit, close, two-shot, projectile cam, overhead e PiP;
5. regras de prioridade/interrupção para caos simultâneo;
6. reactions dirigidas por mood do catálogo, não regex de emoji;
7. combos compostos: onda de torcida, vaia, spotlight, objetos e crowd response;
8. budgets de intensidade para reduzir caos em mobile/reduced motion;
9. capturas e relatório headless do Scene Lab.

Gate:

- mesma fixture gera mesma ordem/seed/câmera;
- reconnect/replay não duplica cues aceitos;
- nenhum fixture contém segredos;
- timeline é cancelável e não vaza timers, mixers ou GPU.

### Fase 4 — Coup como segundo consumidor

Objetivo: provar que a API é engine, não Sem Perdão renomeado.

Trabalho:

1. preservar regras e `projectTableView` do Coup;
2. adaptar um personagem existente ao `TableActor`;
3. traduzir `camera-director` e `projectile-cam` para eventos/beats;
4. usar âncoras `projectile-origin` e `target`;
5. trocar seu script de captura monolítico pelo mesmo `captureMatrix`;
6. manter catálogo Coup (`duel`, `evidence`, `throne`) fora do arnês comum;
7. comparar as duas versões de `TabletopStage` e consolidar a API mínima;
8. executar testes de ambos os jogos antes de extrair.

Gate:

- nenhum branch no núcleo baseado em nome de jogo;
- Sem Perdão e Coup usam os mesmos schemas v1;
- framing, teardown, quality e captureMatrix passam nos dois;
- adaptação não reescreve regra de Coup.

### Fase 5 — extração da A Mesa Engine

Objetivo: parar de duplicar código entre repositórios.

Estrutura alvo:

```text
packages/
  mesa-engine/       # evento, runtime, palco, atores, áudio, métricas
  mesa-react/        # hooks e overlays opcionais
  mesa-devtools/     # Character Lab, Scene Lab, benchmark, replay, capture
games/
  sem-perdao-adapter/
  coup-adapter/
```

Trabalho:

1. mover preservando histórico, sem copiar arquivos entre jogos;
2. versionar pacote e schemas separadamente;
3. definir adapters de jogo para regra, opções, view pública e scene catalog;
4. CI matricial com os dois consumidores;
5. política de compatibilidade: quebra cria schema v2 e mantém parser/fallback v1;
6. publicar documentação de autoria de ator, cena, reação e áudio.

Gate:

- consumidores importam pacote, nunca caminho de repo irmão;
- contratos não carregam dependências de jogo;
- builds, testes e capturas passam nos dois;
- rollback para a versão anterior do pacote é possível.

### Fase 6 — sala persistente d'A Mesa

Objetivo: um grupo entra uma vez e troca de jogo sem remontar a sessão social.

Trabalho:

1. identidade autenticada ou credencial forte por assento;
2. canal privado/RLS ou backend autoritativo;
3. presença, ready, chat, reações, reconnect e host como `mesa-room`;
4. código da sala sobrevive à troca de jogo;
5. adaptador fornece opções, ações válidas, projeção e resultado;
6. placar/recap da sessão e retorno ao salão;
7. espectador e late join com política explícita;
8. observabilidade de queda, latência e migração de host.

Gate:

- trocar Sem Perdão ↔ Coup sem perder grupo/chat/identidade;
- nenhuma regra específica dentro da sala;
- teste de rede prova isolamento de informação privada;
- reconexão funciona após reload, troca de aba e mudança de host.

### Fase 7 — plataforma de jogos e ferramentas de autoria

Objetivo: reduzir drasticamente o custo de lançar outro party game.

Trabalho:

1. CLI/scaffold de jogo com adapter, schemas, Lab e testes;
2. editor de catálogo de personagens/props/áudio sem hardcode;
3. import/export versionado de baralhos e conteúdo comunitário moderável;
4. FDP e MiStory adotam primeiro sala/eventos/HUD; 3D permanece opcional;
5. Cassino entra como jogo próprio: Blackjack primeiro, Poker depois;
6. telemetry opt-in de performance e falhas, sem conteúdo privado;
7. PWA/offline assets e atualização compatível de sessão.

Gate:

- criar um jogo 2D simples sem importar Three.js;
- criar um jogo 3D reutilizando palco, atores, áudio e Labs;
- conteúdo novo entra por catálogo/manifesto, não por edição espalhada no runtime.

## 7. Decisões abertas

1. Primeiro cultista glTF: produzido do zero, contratado ou asset licenciado?
2. ElevenLabs free: qual voz definitiva e se Music estará disponível na cota atual?
3. Destino físico dos packages: repo `a-mesa` como monorepo ou repo dedicado?
4. Autoridade futura: Supabase privado + Edge Function ou servidor dedicado?
5. Conteúdo comunitário: apenas local/importação ou biblioteca compartilhada com RLS?
6. React overlay comum: quanto pertence a `mesa-react` sem apagar a identidade dos jogos?

Não tome essas decisões silenciosamente. Apresente protótipo/custo/trade-off ao usuário.

## 8. Ordem de leitura para a próxima IA

1. `AGENTS.md`
2. este `HANDOFF.md`
3. `docs/mesa-engine/README.md`
4. `docs/mesa-engine/CHANGELOG.md`
5. `docs/mesa-engine/MIGRATION.md`
6. `docs/mesa-engine/ACTOR_PIPELINE.md`
7. `src/lib/game.ts` e `src/hooks/useMultiplayer.ts`
8. `src/lib/three/mesaView.ts`
9. `src/lib/mesa/semPerdaoExperience.ts`
10. `src/lib/mesa/experienceDirector.ts` e `experienceRuntime.ts`
11. `src/lib/mesa/actorCatalog.ts` e `src/lib/mesa/actorManifest.ts`
12. `src/lib/three/tabletopStage.ts`
13. `audio/README.md` e `audio/manifest.mjs`
14. `/Users/marco.galvao-ext/Sites/a-mesa/ENGINE-MIGRATION.md`
15. `/Users/marco.galvao-ext/Sites/a-mesa/ARQUITETURA.md`

Depois execute `git status --short`; o worktree é deliberadamente sujo.

## 9. Comandos úteis

```bash
cd /Users/marco.galvao-ext/Sites/SEM-PERDAO
npm run dev
npm test
npm run lint
npm run build
npm run capture:lab -- --base-url=http://localhost:3000
npm run audio:list:core
```

Rotas:

- jogo: `http://localhost:3000/`
- demo da mesa: `http://localhost:3000/3d`
- Character Lab: `http://localhost:3000/lab/actors`

## 10. Prompt comprimido para iniciar no Claude

Se o Claude tiver acesso ao workspace, basta enviar:

> Trabalhe no repo `/Users/marco.galvao-ext/Sites/SEM-PERDAO`. Leia primeiro
> `AGENTS.md` e `HANDOFF.md` inteiros, depois siga a ordem de leitura do handoff.
> Preserve o worktree sujo: há um grande lote pronto, ainda não commitado, e
> documentação paralela em `/Users/marco.galvao-ext/Sites/a-mesa`. Não use reset,
> não commite nem faça push sem minha autorização. O Sem Perdão é o vertical slice
> da futura A Mesa Engine; preserve host autoritativo, projeção redigida e separação
> regra → view pública → evento → diretor/runtime → palco. Primeiro me dê um resumo
> do estado real e proponha o próximo lote com base nas fases do handoff. Prefira
> features perceptíveis e infraestrutura reutilizável; evite loops de Browser/QA.

Se o Claude não tiver acesso ao workspace, anexe este arquivo junto dos arquivos
da seção 8. O chat bruto não é necessário: as decisões e o roadmap estão aqui.
