# Reconstruir a mesa online em cima da demo `/3d`

## A decisão

A demo em `src/app/3d/page.tsx` é o visual aprovado. O `Tribunal3DGame.tsx`
é uma segunda implementação que reimplementou o HUD por conta própria e ficou
diferente em tudo: animações, modelos, fluxo de rodada, câmera, cartas.

**Inverter a base:** a demo vira a tela de jogo. O multiplayer entra só como
fonte de dados e ações. **Nada do visual da demo é alterado** — nem tamanho,
nem posição, nem animação, nem cor.

Não tente aproximar o `Tribunal3DGame` atual do visual da demo peça por peça.
Já tentamos; sempre falta alguma coisa. Substitua.

## Passo 1 — extrair a casca da demo

Criar `src/components/tribunal/MesaTribunal.tsx` com **exatamente** o JSX da
demo (`src/app/3d/page.tsx`, linhas 464–878) e a criação da cena
(linhas ~205–232). Copiar, não reescrever: classes Tailwind, `clipPath`,
`boxShadow`, `style`, ordem dos elementos e z-index vão inalterados.

Tudo que hoje é estado local da demo vira prop. Contrato:

```ts
interface MesaTribunalProps {
  // Cena
  mesaView: MesaView;              // do multiplayer; a demo passava pretas/brancas
  pronto: boolean;                 // 'CARREGANDO A MESA…'

  // Cabeçalho
  fase: FaseVisual;                // 'aguardando'|'jogando'|'julgando'|'condenado'|'sentenciando'
  rodada: number;
  totalRodadas: number;

  // Processo (carta preta)
  pretaTexto: string;
  pick: number;

  // Mão
  mao: { id: string; texto: string }[];
  selecionadas: string[];
  onEscolherCarta: (id: string) => void;
  enviouCarta: boolean;

  // Julgamento
  revelada: { autor: string; branca: string } | null;
  provasReveladas: number;
  totalProvas: number;

  // Veredito
  veredito: { autor: string; branca: string } | null;
  placarOrdenado: [string, number][];

  // Ação principal (canto inferior direito)
  rotuloBotao: string;
  botaoDesabilitado: boolean;
  onAcaoPrincipal: () => void;

  // Teatro
  anuncio: { tipo: 'stamp' | 'texto'; texto: string } | null;
  falaVoce: { texto: string } | null;
  reacoesTela: ReacaoTela[];
  alvos: string[];
  onArremessar: (alvo: string) => void;

  // Som
  somMudo: boolean;
  onTrocarSom: () => void;
}
```

## Passo 2 — a demo passa a consumir a casca

`src/app/3d/page.tsx` mantém a simulação (NPCs, sorteio, timers) e passa tudo
por props. **Regressão zero na demo é o critério de aceite do passo 1:** se
`/3d` mudou de aparência, o passo 1 está errado.

## Passo 3 — o multiplayer passa a consumir a casca

Apagar o HUD do `Tribunal3DGame.tsx` (`BlackEvidence`, `WhiteHand`,
`TimerDial`, `ScoreRail`, `CameraDock`, `ProofControls`, `RoundVerdict`,
`Finale`, `tribunal-*` no `globals.css`). O componente vira **só um mapeador**
de `GameState` → `MesaTribunalProps`:

| demo | multiplayer |
|---|---|
| `fase` | `gs.phase` (`submitting`→`jogando`, `judging`→`julgando`, `round-end`→`condenado`, `game-end`→`sentenciando`) |
| `rodada` / `totalRodadas` | `gs.round` / limite das regras |
| `pretaTexto` / `pick` | `gs.blackCard.text` / `.pick` |
| `mao` | `me.hand` |
| `revelada` | `gs.submissions[i]` com `i ∈ gs.revealed` (autoria fica `AUTORIA SOB SIGILO` até o veredito) |
| `veredito` | `gs.roundWinnerId` + submissão vencedora |
| `placarOrdenado` | `gs.players` ordenados por `score` |
| `onEscolherCarta` → `onAcaoPrincipal` | `sendAction({type:'submit', cardIds, phaseId})` |
| botão em `julgando` (juiz) | `sendAction({type:'reveal'})` e `{type:'judge'}` |
| botão em `condenado` | `sendAction({type:'next_round'})` |
| `onArremessar` | `sendReaction` |

Manter o fallback `if (webglError) return <GameBoard {...props} />`.

## O que NÃO pode se perder do multiplayer

- **Redação anti-trapaça:** o cliente só recebe o que pode ver. Nenhuma prop
  nova pode expor mão alheia ou autoria antes do veredito.
- `phaseId` em toda ação (guard contra broadcast atrasado).
- Modo democracia: todos votam, ninguém vota na própria (`onVote`).
- Juiz humano vs. bot, timeout de AFK, migração de host, entrada no meio do
  jogo, kick, reconexão.

## Pontos onde a demo não tem equivalente

- **Timer:** a demo não tem contagem regressiva; o jogo real precisa. Entra
  como elemento novo, no estilo da demo (moldura `bg-ink/90 border
  border-paper/20`, sem inventar linguagem visual nova).
- **Cadeiras vazias:** a demo sempre enche 8 lugares, por isso o POV parece
  cheio. Com 3–4 jogadores reais a mesa fica deserta. Preencher os assentos
  livres com figurantes na cena (não como jogadores no `GameState`).
- **`falaVoce` / `alvos`:** teatro da demo; no online, alimentar do chat e do
  roster real.

## Verificação

1. `/3d` pixel-idêntico ao de antes (passo 1).
2. Sala com host + 1 convidado + 1 bot: lobby → selo → partida, e a tela de
   jogo indistinguível da demo.
3. Rodada completa: jogar carta → revelar provas → veredito → próxima rodada.
4. `npx tsc --noEmit`, `npm test`, `npx eslint`.
