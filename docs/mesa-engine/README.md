# A Mesa Engine — núcleo em incubação

Este diretório registra tudo que nasceu no Sem Perdão, mas pertence à futura
base compartilhada d'A Mesa. A regra é simples: regra de jogo continua no jogo;
infraestrutura de sala e apresentação pode virar engine.

O Sem Perdão é o primeiro vertical slice porque hoje é a execução mais completa.
Ele prova os contratos em uma partida real antes de extrair um pacote que Coup,
FDP, MiStory e os próximos jogos teriam de manter.

## O fluxo comum

```text
GameState privado e autoritativo
        ↓ projectTableView(playerId)
TableView segura, específica do jogo
        ↓ emite TableEvent seguro
ExperienceDirector (evento → beats declarativos)
        ↓
ExperienceRuntime (delay, prioridade, interrupção, descarte)
        ├── camera
        ├── actor
        ├── vfx
        ├── audio
        └── hud
             ↓
TabletopStage + UI 2D
```

Eventos de apresentação não substituem o estado autoritativo. Eles descrevem
algo que já aconteceu e dão um `seed` estável para todos os clientes encenarem o
mesmo caos. Nenhum `TableEvent` pode carregar mão, deck, autoria secreta ou outro
dado removido por `projectTableView`.

## O que existe em 22/07/2026

| Camada | Implementação no Sem Perdão | Estado |
| --- | --- | --- |
| Palco | `src/lib/three/tabletopStage.ts` | em uso no jogo |
| Eventos | `src/lib/mesa/tableEvents.ts` | contrato v1 + journal testado |
| Direção | `src/lib/mesa/experienceDirector.ts` | regras puras testadas |
| Timeline | `src/lib/mesa/experienceRuntime.ts` | canais e cancelamento testados |
| Ponte ao vivo | `src/lib/mesa/semPerdaoExperience.ts` | transições reais da partida encenadas |
| Ator | `src/lib/mesa/actorContract.ts` | contrato v1 testado |
| Asset | `src/lib/mesa/actorManifest.ts` | JSON externo, auditoria e budgets |
| Catálogo | `src/lib/mesa/actorCatalog.ts` | procedural/glTF, disponibilidade e fallback |
| glTF | `src/lib/three/actors/gltfActorAssetStore.ts` | runtime compilado; primeiro GLB pendente |
| Legado | `src/lib/three/actors/proceduralCultistActor.ts` | `Reu` adaptado sem alterar regra |
| Reações | `src/lib/mesa/reactionCatalog.ts` | memes e arremessos compartilhados |
| Combos | `src/lib/mesa/reactionCombos.ts` | coro/motim determinísticos e anti-spam |
| Áudio | `scripts/lib/audio-plan.mjs` | manifesto validado e geração por presets |
| Bancada | `/lab/actors` | cenário, câmera, ações, métricas e benchmark |
| Capturas | `scripts/lib/capture-matrix.mjs` | arnês headless genérico + catálogo do Lab |

O contrato glTF já suporta cache de template, clones independentes de rig,
Meshopt, KTX2 opcional, clips semânticos, morph targets, âncoras e LOD. O primeiro
asset real ainda precisa atravessar a bancada; até isso acontecer, o procedural
é o fallback de produção.

## Fronteiras que não podem regredir

- `game.ts` decide o que aconteceu; Three.js nunca decide regra.
- O host continua autoritativo e cada cliente recebe somente sua projeção segura.
- `ExperienceDirector` e contratos de `src/lib/mesa` não importam React, DOM,
  Three.js, Supabase nem código de um jogo.
- Um ator implementa intenções como `celebrate` e `hit`; a engine não chama
  animações internas como `festejar` ou `atingido`.
- Um asset novo precisa de manifesto e budget; colocar um GLB solto em `public/`
  não o torna utilizável.
- Toda criação de renderer, listeners, timers, mixers e recursos GPU precisa de
  caminho explícito de `dispose()`.

## Como validar

```bash
npm run test:engine-core
npm test
npm run lint
npm run build
```

Abra `/lab/actors`, percorra intenções/câmeras em desktop e mobile, rode o
benchmark e copie o relatório. Não aprove um modelo olhando apenas para FPS:
enquadramento, draw calls, triângulos, texturas, movimento reduzido e descarte
também fazem parte do gate.

Para regressão rápida, rode `npm run capture:lab --
--base-url=http://localhost:3000`. A rota aceita `camera`, `quality`,
`expression` e `reducedMotion` na query e só libera a captura depois de aplicar
o estado. O arnês de `scripts/lib/` não conhece Sem Perdão; cada jogo mantém seu
catálogo de planos em um arquivo fino como `scripts/capture-lab.mjs`.

## Documentos

- [Pipeline de personagens e glTF](ACTOR_PIPELINE.md)
- [Plano de convergência entre os repositórios](MIGRATION.md)
- [Registro das mudanças compartilháveis](CHANGELOG.md)
