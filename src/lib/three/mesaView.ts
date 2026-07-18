import type { GameMode, GamePhase, GameState } from '../types';

const FULL_TURN = Math.PI * 2;

export const MESA_MIN_SEATS = 3;
export const MESA_MAX_SEATS = 8;

/**
 * Contrato somente-leitura entre as regras da partida e o palco 3D.
 *
 * O projetor abaixo nunca entrega mãos, baralhos, votos ou objetos do
 * GameState por referência. O renderer recebe apenas fatos que pode exibir e
 * não tem callbacks de regra: toda a autoridade continua em game.ts.
 */
export interface MesaCardView {
  /** ID neutro de exibição; nunca é o ID da carta no baralho/mão. */
  readonly id: string;
  readonly text: string;
}

export interface MesaBlackCardView {
  readonly id: string;
  readonly text: string;
  readonly pick: number;
}

export interface MesaSeatView {
  readonly id: number;
  readonly name: string;
  /** Ordem visual depois da rotação para o jogador local. */
  readonly index: number;
  /** Radianos, com o jogador local em zero e sentido horário positivo. */
  readonly azimuthRad: number;
  readonly isSelf: boolean;
  readonly isJudge: boolean;
  readonly isHuman: boolean;
  readonly connected: boolean;
  readonly eliminated: boolean;
  readonly score: number;
  /** Só é usado durante `submitting`; não liga o assento a uma prova. */
  readonly submitted: boolean;
  /** Marcadores de resultado nunca acendem antes do fim da rodada. */
  readonly isRoundWinner: boolean;
  readonly isGameWinner: boolean;
}

export interface MesaProofOwnerView {
  readonly id: number;
  readonly name: string;
}

export type MesaProofState = 'sealed' | 'revealed';

export interface MesaProofView {
  /** Estável do julgamento ao resultado, sem codificar autoria. */
  readonly id: string;
  readonly submissionIndex: number;
  readonly state: MesaProofState;
  /** Permite montar combos pick > 1 mesmo enquanto as faces estão lacradas. */
  readonly cardCount: number;
  /** Vazio enquanto lacrada; preserva a ordem do combo quando revelada. */
  readonly cards: readonly MesaCardView[];
  /** Autoria só existe em round-end/game-end. */
  readonly owner: MesaProofOwnerView | null;
  /** Derivado de roundWinnerId, nunca de posição ou ordem de revelação. */
  readonly isWinner: boolean;
}

export interface MesaView {
  readonly phase: GamePhase;
  readonly mode: GameMode;
  readonly round: number;
  readonly scoreLimit: number;
  readonly phaseStartedAt: number;
  readonly votingRound: 1 | 2;
  readonly tieBreak: boolean;
  readonly selfId: number | null;
  readonly judgeId: number | null;
  readonly roundWinnerId: number | null;
  readonly gameWinnerId: number | null;
  readonly blackCard: MesaBlackCardView | null;
  readonly seats: readonly MesaSeatView[];
  readonly proofs: readonly MesaProofView[];
}

function freezeArray<T>(values: T[]): readonly T[] {
  return Object.freeze(values);
}

function rotatedAroundSelf<T extends { id: number }>(players: readonly T[], myId: number): T[] {
  const selfIndex = players.findIndex((player) => player.id === myId);
  if (selfIndex <= 0) return [...players];
  return [...players.slice(selfIndex), ...players.slice(0, selfIndex)];
}

function stagePlayers(
  players: GameState['players'],
  myId: number,
  judgeId: number | null
): GameState['players'] {
  const seenIds = new Set<number>();
  const active = players.filter((player) => {
    if (player.eliminated || seenIds.has(player.id)) return false;
    seenIds.add(player.id);
    return true;
  });
  const rotated = rotatedAroundSelf(active, myId);
  const visible = rotated.slice(0, MESA_MAX_SEATS);

  // Um snapshot legado pode ter mais de oito ativos. O jogador local fica em
  // zero e, no modo clássico, o juiz continua no palco mesmo se estava além
  // do oitavo item da lista antiga.
  if (judgeId !== null && !visible.some((player) => player.id === judgeId)) {
    const judge = active.find((player) => player.id === judgeId);
    if (judge) {
      if (visible.length === MESA_MAX_SEATS) visible[visible.length - 1] = judge;
      else visible.push(judge);
    }
  }

  return visible;
}

function proofId(round: number, submissionIndex: number): string {
  return `round:${round}:proof:${submissionIndex}`;
}

/**
 * Projeta um snapshot seguro para o palco 3D.
 *
 * A função aceita tanto o estado completo do host quanto o estado já
 * redigido de um convidado. As mesmas barreiras de fase são aplicadas nos
 * dois casos, portanto o renderer nunca deve receber o GameState original.
 */
export function projectMesaView(gs: GameState, myId: number): MesaView {
  const verdict = gs.phase === 'round-end' || gs.phase === 'game-end';
  // `mode` não existia nos primeiros snapshots persistidos.
  const mode = gs.mode ?? 'judge';
  const playerById = new Map(gs.players.map((player) => [player.id, player]));
  const activeJudgeId = mode === 'judge'
    && gs.players.some((player) => player.id === gs.czarId && !player.eliminated)
    ? gs.czarId
    : null;
  const sourcePlayers = stagePlayers(gs.players, myId, activeJudgeId);
  const visiblePlayerIds = new Set(sourcePlayers.map((player) => player.id));
  const submittedIds = new Set(gs.submissions.map((submission) => submission.playerId));
  const selfExists = visiblePlayerIds.has(myId);
  const judgeId = activeJudgeId !== null && visiblePlayerIds.has(activeJudgeId)
    ? activeJudgeId
    : null;
  const roundWinnerId = verdict ? gs.roundWinnerId : null;
  const gameWinnerId = gs.phase === 'game-end' ? (gs.winner?.id ?? null) : null;

  const seats = freezeArray(sourcePlayers.map((player, index) => Object.freeze({
    id: player.id,
    name: player.name,
    index,
    azimuthRad: sourcePlayers.length === 0 ? 0 : (FULL_TURN * index) / sourcePlayers.length,
    isSelf: player.id === myId,
    isJudge: player.id === judgeId,
    isHuman: player.isHuman,
    connected: player.connected,
    eliminated: player.eliminated,
    score: player.score,
    submitted: gs.phase === 'submitting' && submittedIds.has(player.id),
    isRoundWinner: verdict && player.id === roundWinnerId,
    isGameWinner: gs.phase === 'game-end' && player.id === gameWinnerId,
  })));

  // Durante a coleta, o assento sabe apenas que uma prova chegou. Criar uma
  // lista de provas aqui ligaria implicitamente submissionIndex → autor.
  const showProofs = gs.phase === 'judging' || verdict;
  const revealedIndices = new Set(gs.revealed);
  const expectedCardCount = Math.max(0, gs.blackCard?.pick ?? 0);
  const proofs = freezeArray(showProofs
    ? gs.submissions.map((submission, submissionIndex) => {
        const id = proofId(gs.round, submissionIndex);
        const revealed = verdict || revealedIndices.has(submissionIndex);
        const cards = freezeArray(revealed
          ? submission.cards.map((card, cardIndex) => Object.freeze({
              id: `${id}:card:${cardIndex}`,
              text: card.text,
            }))
          : []);
        const sourceOwner = verdict ? playerById.get(submission.playerId) : undefined;
        const owner = sourceOwner
          ? Object.freeze({ id: sourceOwner.id, name: sourceOwner.name })
          : null;

        return Object.freeze({
          id,
          submissionIndex,
          state: revealed ? 'revealed' as const : 'sealed' as const,
          cardCount: expectedCardCount || (revealed ? cards.length : 0),
          cards,
          owner,
          isWinner: verdict && roundWinnerId !== null && submission.playerId === roundWinnerId,
        });
      })
    : []);

  const blackCard = gs.blackCard
    ? Object.freeze({ id: gs.blackCard.id, text: gs.blackCard.text, pick: gs.blackCard.pick })
    : null;

  return Object.freeze({
    phase: gs.phase,
    mode,
    round: gs.round,
    scoreLimit: gs.scoreLimit,
    phaseStartedAt: gs.phaseStartedAt,
    votingRound: gs.votingRound,
    tieBreak: verdict && gs.tieBreak,
    selfId: selfExists ? myId : null,
    judgeId,
    roundWinnerId,
    gameWinnerId,
    blackCard,
    seats,
    proofs,
  });
}
