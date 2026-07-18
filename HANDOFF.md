# HANDOFF — Sem Perdão

Cards Against Humanity em PT-BR, online, pra jogar no escritório. Next.js 16 + Supabase Realtime. Este documento registrou o plano usado para implementar cartas próprias; a funcionalidade foi concluída em julho de 2026.

## Estado atual

- Jogo completo: lobby ritual, 3–8 jogadores, bots, cultistas customizáveis, mesa 3D, modos **1 Juiz** e **Democracia**, relógios, reações/arremessos, chat no cenário, reconexão e migração de host.
- O host escolhe 1/2/3 voltas completas e três ritmos. O limite regulamentar é fixado ao iniciar; empate no fim abre morte súbita.
- Cartas próprias: editor host-only no lobby, persistência em `localStorage`, validação de texto/lacunas e pools autoritativos que sobrevivem aos reshuffles.
- Baralho: 88 cartas pretas + 213 brancas em `src/lib/cards.ts` (abrasileirado do "Cartas Contra Tugas"). Pretas usam `____` por lacuna; `pick` é derivado da contagem de `____`.
- Repo: `github.com/JablesPoles/SEM-PERDAO`; produção parte de `main` e o experimento atual vive em `experimento-3d`. O Vercel está conectado ao push.
- `npm test`, `npm run lint`, `npx tsc --noEmit` e `npm run build` são os gates atuais.

## Arquitetura essencial (não quebrar isto)

- **Host-autoritativo**: o host (`isHost`) guarda o `GameState` completo em `hostGameRef`, aplica as ações e transmite para cada convidado uma cópia **redigida** (`redactStateFor` em `useMultiplayer.ts`). A interface não recebe pools, decks, mãos alheias nem provas lacradas. Como o protótipo usa broadcast público sem autenticação, isso não substitui canais privados/RLS ou backend autoritativo contra um cliente adversarial.
- **Lógica pura** em `src/lib/game.ts` (sem React/UI) — é onde as regras vivem. `initGame`, `applySubmission`, `applyReveal`, `applyJudgePick`, `advanceToNextRound`, `removePlayer`. As pilhas `blackDeck`/`whiteDeck` vivem no `GameState` e são zeradas na redação.
- **Reshuffle**: quando uma pilha esvazia, ela é reconstruída a partir de `ALL_BLACK`/`ALL_WHITE`. **É aqui que mora a armadilha da feature** (abaixo).

## Cartas customizadas — implementação concluída

### A armadilha resolvida

Injetar cartas novas só na pilha inicial do `initGame` **não bastava** — elas sumiam no primeiro reshuffle. A implementação passou a manter `blackPool` e `whitePool` no estado autoritativo:

- `src/lib/game.ts:34` — `drawBlack` reembaralha de `ALL_BLACK`
- `src/lib/game.ts:50` — `refillHands` reembaralha de `ALL_WHITE`
- `src/lib/game.ts:91-92` — `initGame` monta as pilhas iniciais
- `src/hooks/useMultiplayer.ts:472-473` — migração de host redistribui a rodada

### Abordagem implementada: pool no estado

Fazer o baralho-fonte viajar dentro do `GameState`, redigido pros convidados (mesmo padrão de `blackDeck`/`whiteDeck`). Assim as funções seguem puras e só o host carrega o pool.

1. `types.ts`: `blackPool: BlackCard[]` e `whitePool: WhiteCard[]` vivem no `GameState`.
2. `game.ts`: `initGame` mescla cartas base e próprias; `drawBlack` e `refillHands` reembaralham a partir dos pools.
3. `useMultiplayer.ts`: pools, decks e mãos alheias são redigidos; migração de host reconstrói a rodada sem transmitir segredos.

### Regras das cartas novas (não negociáveis)

- **IDs únicos, sem colidir com o base** (`b0..`, `w0..`). Use prefixo `cb-`/`cw-` + índice ou timestamp.
- **Preta**: `pick` = nº de `____` (reusar `countBlanks`). Se o texto não tiver `____`, tratar como 1 lacuna (adicionar ` ____.` no fim, como o baralho base faz implicitamente).
- Validar texto não-vazio e cortar tamanho (ex.: 140 chars) pra não estourar o layout da carta.

### Persistência escolhida

- **Implementado:** `localStorage` do host, chave `sp-custom-cards`. É simples e não exige backend; o baralho acompanha aquele navegador.
- **Próxima evolução possível:** importar/exportar pacotes ou persistir baralhos compartilhados numa tabela Supabase com RLS.

### UI

- Botão "Baralho" no lobby (`src/app/sala/[id]/page.tsx`, host-only, perto do "+ Adicionar bot") abre o editor com campo, toggle preta/branca, prévia, dica de `____`, contadores e remoção.
- Seguir o design 1c: `.card-black`/`.card-white`, `.btn-red`/`.btn-ink`, fontes Archivo Black/Archivo. Tokens em `src/app/globals.css`.

## Rodar / testar / deploy

```bash
npm install
npm run dev            # localhost:3000 (precisa do .env.local com as chaves Supabase)
npm test               # guards de regras/protocolo + projeção pública da mesa
npm run lint
npm run build          # tem que passar limpo antes de commitar
```

- **Testar a lógica:** `tests/game-guards.spec.ts` cobre limites, voltas, morte súbita, democracia, deadlines, kick/troca de juiz, abortos e redação; `src/lib/three/mesaView.test.mjs` cobre o contrato público do renderer. Uma partida longa ainda deve **esgotar e reembaralhar** as pilhas sem perder cartas customizadas ou duplicar IDs.
- **Deploy**: `git push` → Vercel builda sozinho. Não precisa mexer em config.

## Convenções

- Tudo em **PT-BR** (código, comentários, UI). Tom do jogo é pesado/18+ de propósito — não suavizar.
- Commits com identidade `JablesPoles <matheuspolesnunes@gmail.com>`.
- **Nunca** incluir `blackPool`/`whitePool`/`blackDeck`/`whiteDeck`, mãos alheias ou provas lacradas no snapshot renderizado de outro cliente. Qualquer campo novo com carta deve ser zerado em `redactStateFor`. Para anti-cheat real, migrar também o transporte para identidade autenticada e canal privado/backend.
- Não commitar `.env.local` (já está no `.gitignore`).
