# SEM PERDÃO* — cartas contra a humanidade

Jogo de cartas estilo Cards Against Humanity para jogar no navegador com a galera do escritório. A partida acontece num tribunal 3D retrô, com lobby ritual, cultistas customizáveis, reações físicas e salas via Next.js + Supabase Realtime.

## Regras

- A cada rodada um jogador é o **juiz** e lê a carta preta (a pergunta).
- Os outros jogam a(s) carta(s) branca(s) mais cruel(is) da mão de 10.
- O juiz escolhe a melhor resposta às cegas — quem jogou leva 1 ponto.
- O host escolhe 1, 2 ou 3 voltas completas. Com `N` réus, são `N × voltas` rodadas regulamentares.
- Ao fim do limite, o líder único vence; empate abre morte súbita até alguém assumir a dianteira.
- São 3 a 8 lugares na mesa e dá para completar o ritual com bots.

O anfitrião escolhe entre dois modos no lobby:

- **1 Juiz:** regra clássica acima; o juiz não joga e decide a rodada.
- **Democracia:** todo mundo joga e vota em segredo, sem poder votar na própria resposta. Empate abre um segundo turno entre as finalistas; persistindo, a mesa sorteia para a rodada nunca travar.

Antes da partida, cada pessoa customiza robe, capuz, rosto, metal e relíquia, acende o próprio selo de pronto e vê as regras escolhidas pelo host. O host também escolhe o ritmo dos relógios de jogada, julgamento e resultado.

## Rodando

```bash
npm install
npm run dev
```

O multiplayer usa [Supabase Realtime](https://supabase.com/docs/guides/realtime) (canais de broadcast — não precisa de banco). Copie `.env.example` para `.env.local` e preencha com as chaves de um projeto Supabase gratuito (pode reusar o do FDP — os canais têm prefixo próprio).

O host da sala é a autoridade do jogo: aplica as ações, roda os bots e redige o estado usado pela interface de cada jogador. Os canais de broadcast públicos do protótipo não são uma fronteira anti-cheat contra alguém inspecionando ou forjando tráfego; um lançamento adversarial deve usar usuários autenticados e canais privados/RLS ou um backend autoritativo.

Se alguém perder a conexão durante a partida, o assento, a mão e os pontos são preservados. A mesa joga automaticamente por esse jogador até ele voltar; ao recarregar ou reabrir a mesma sala, a sessão recupera o lugar. Se o host cair, o próximo jogador conectado assume sem congelar a partida.

## Estrutura

- `src/lib/cards.ts` — o baralho (edite aqui pra mexer nas cartas)
- `src/lib/game.ts` — regras e transições de estado (puro, sem UI)
- `src/lib/ai.ts` — bots (jogam aleatório, estilo Rando Cardrissian)
- `src/hooks/useMultiplayer.ts` — sala online (host autoritativo via Supabase Realtime)
- `src/components/lobby/RitualLobby.tsx` — customização, ready e regras do pré-jogo
- `src/components/Tribunal3DGame.tsx` — HUD e fluxo da partida 3D
- `src/lib/three/` — cena, cultistas, projeção segura do estado e áudio 3D
- `src/lib/mesa/` — contratos neutros incubados para a futura A Mesa Engine
- `src/components/GameBoard.tsx` — fallback 2D quando WebGL não está disponível
- `ref/` — PDF das cartas originais e direções visuais

## Laboratório da engine

Abra `/lab/actors` para validar personagem, ações, expressões, atos de câmera,
enquadramento, qualidade e orçamento gráfico. A arquitetura, o pipeline glTF e o
plano de migração para os outros jogos estão em
[`docs/mesa-engine`](docs/mesa-engine/README.md).

Com o servidor aberto, gere a matriz de referência sem navegar manualmente:

```bash
npm run capture:lab -- --base-url=http://localhost:3000
```

As capturas de palco, controles e telemetria saem em
`captures/character-lab/` para desktop, celular em pé e celular deitado. A pasta
é local e ignorada pelo Git.

## Deploy (Vercel)

Igual o FDP: importa o repo no [vercel.com](https://vercel.com/new), adiciona `NEXT_PUBLIC_SUPABASE_URL` e `NEXT_PUBLIC_SUPABASE_ANON_KEY` nas Environment Variables e pronto.

## Cartas

Baralho adaptado do **Cartas Contra Tugas** (`ref/Cartas Contra Tugas.pdf`), um baralho fã de Cards Against Humanity — abrasileirado: texto em PT-BR natural e referências de Portugal trocadas por equivalentes do Brasil. Cards Against Humanity e derivados são [CC BY-NC-SA](https://creativecommons.org/licenses/by-nc-sa/2.0/) — uso não comercial, mesma licença. Design: "Brutal Minimal — Sem Perdão" (opção 1c das direções visuais em `ref/`).

O anfitrião pode abrir **Baralho** no lobby e acrescentar cartas pretas ou brancas. Elas ficam salvas apenas no `localStorage` daquele navegador e entram junto do baralho base em todos os reshuffles da partida. Nas pretas, cada `____` é uma lacuna (máximo de 3); quando nenhuma é informada, o jogo acrescenta uma automaticamente.
