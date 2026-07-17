# HANDOFF — Sem Perdão

Cards Against Humanity em PT-BR, online, pra jogar no escritório. Next.js 16 + Supabase Realtime. Este documento registrou o plano usado para implementar cartas próprias; a funcionalidade foi concluída em julho de 2026.

## Estado atual

- Jogo completo: lobby por código, 3–12 jogadores, bots pra completar, modos **1 Juiz** e **Democracia**, timer, reações, chat com narração, reconexão e migração de host.
- Cartas próprias: editor host-only no lobby, persistência em `localStorage`, validação de texto/lacunas e pools autoritativos que sobrevivem aos reshuffles.
- Baralho: 88 cartas pretas + 213 brancas em `src/lib/cards.ts` (abrasileirado do "Cartas Contra Tugas"). Pretas usam `____` por lacuna; `pick` é derivado da contagem de `____`.
- Repo: `github.com/JablesPoles/SEM-PERDAO` (branch `main`). Deploy Vercel conectado ao push. Env vars (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`) já estão no Vercel e no `.env.local` local (não commitado).
- `npm run build` passa limpo. Não há test runner; validação da lógica pura é via simulação (ver "Testar").

## Arquitetura essencial (não quebrar isto)

- **Host-autoritativo**: o host (`isHost`) guarda o `GameState` completo em `hostGameRef`, aplica todas as ações e transmite pra cada convidado uma cópia **redigida** (`redactStateFor` em `useMultiplayer.ts`). Convidado nunca recebe a mão dos outros, nem as pilhas de compra, nem as provas antes do juiz virar.
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
npm run build          # tem que passar limpo antes de commitar
```

- **Testar a lógica** (sem test runner): compilar `src/lib/{game,cards,ai,types}.ts` com `tsc --module commonjs` num dir temporário e rodar uma simulação de partida (ver histórico de commits — foi assim que validei reshuffle, remoção de jogador e a regra de revelar antes de condenar). Acceptance da feature: uma partida longa (limite alto, 5 jogadores) tem que **esgotar e reembaralhar** as pilhas e as cartas customizadas continuarem aparecendo, sem ID duplicado entre mãos.
- **Deploy**: `git push` → Vercel builda sozinho. Não precisa mexer em config.

## Convenções

- Tudo em **PT-BR** (código, comentários, UI). Tom do jogo é pesado/18+ de propósito — não suavizar.
- Commits com identidade `JablesPoles <matheuspolesnunes@gmail.com>`.
- **Nunca** enviar `blackPool`/`whitePool`/`blackDeck`/`whiteDeck` nem a mão de um jogador pra outro cliente — a redação é a garantia anti-trapaça, qualquer campo novo com carta tem que ser zerado em `redactStateFor`.
- Não commitar `.env.local` (já está no `.gitignore`).
