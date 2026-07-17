# SEM PERDÃO* — cartas contra a humanidade

Jogo de cartas estilo Cards Against Humanity pra jogar no navegador com a galera do escritório. Mesmo esquema do [FDP](https://github.com/gabrielbueno99/FDP): Next.js + Supabase Realtime, sala por código, sem cadastro.

## Regras

- A cada rodada um jogador é o **juiz** e lê a carta preta (a pergunta).
- Os outros jogam a(s) carta(s) branca(s) mais cruel(is) da mão de 10.
- O juiz escolhe a melhor resposta às cegas — quem jogou leva 1 ponto.
- Primeiro a bater o limite (5/7/10) vence. Mínimo 3 na mesa (dá pra completar com bots).

O anfitrião escolhe entre dois modos no lobby:

- **1 Juiz:** regra clássica acima; o juiz não joga e decide a rodada.
- **Democracia:** todo mundo joga e vota em segredo, sem poder votar na própria resposta. Empate abre um segundo turno entre as finalistas; persistindo, a mesa sorteia para a rodada nunca travar.

## Rodando

```bash
npm install
npm run dev
```

O multiplayer usa [Supabase Realtime](https://supabase.com/docs/guides/realtime) (canais de broadcast — não precisa de banco). Copie `.env.example` para `.env.local` e preencha com as chaves de um projeto Supabase gratuito (pode reusar o do FDP — os canais têm prefixo próprio).

O host da sala é a autoridade do jogo: aplica as ações de todos, roda os bots e envia pra cada jogador só o que ele pode ver (ninguém recebe a mão dos outros; no julgamento as cartas chegam anônimas).

Se alguém perder a conexão durante a partida, o assento, a mão e os pontos são preservados. A mesa joga automaticamente por esse jogador até ele voltar; ao recarregar ou reabrir a mesma sala, a sessão recupera o lugar. Se o host cair, o próximo jogador conectado assume sem congelar a partida.

## Estrutura

- `src/lib/cards.ts` — o baralho (edite aqui pra mexer nas cartas)
- `src/lib/game.ts` — regras e transições de estado (puro, sem UI)
- `src/lib/ai.ts` — bots (jogam aleatório, estilo Rando Cardrissian)
- `src/hooks/useMultiplayer.ts` — sala online (host autoritativo via Supabase Realtime)
- `src/components/GameBoard.tsx` — a mesa
- `ref/` — PDF das cartas originais e direções visuais

## Deploy (Vercel)

Igual o FDP: importa o repo no [vercel.com](https://vercel.com/new), adiciona `NEXT_PUBLIC_SUPABASE_URL` e `NEXT_PUBLIC_SUPABASE_ANON_KEY` nas Environment Variables e pronto.

## Cartas

Baralho adaptado do **Cartas Contra Tugas** (`ref/Cartas Contra Tugas.pdf`), um baralho fã de Cards Against Humanity — abrasileirado: texto em PT-BR natural e referências de Portugal trocadas por equivalentes do Brasil. Cards Against Humanity e derivados são [CC BY-NC-SA](https://creativecommons.org/licenses/by-nc-sa/2.0/) — uso não comercial, mesma licença. Design: "Brutal Minimal — Sem Perdão" (opção 1c das direções visuais em `ref/`).

O anfitrião pode abrir **Baralho** no lobby e acrescentar cartas pretas ou brancas. Elas ficam salvas apenas no `localStorage` daquele navegador e entram junto do baralho base em todos os reshuffles da partida. Nas pretas, cada `____` é uma lacuna (máximo de 3); quando nenhuma é informada, o jogo acrescenta uma automaticamente.
