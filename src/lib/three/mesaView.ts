import type {
  CultistAppearance,
  GameMode,
  GamePhase,
  GameRules,
  GameState,
  TurnLimit,
} from '../types';

const FULL_TURN = Math.PI * 2;

export const MESA_MIN_SEATS = 3;
export const MESA_MAX_SEATS = 8;

const LEGACY_RULES: GameRules = {
  turnLimit: 1,
  submitSeconds: 75,
  judgeSeconds: 60,
  resultSeconds: 9,
};

function validSeconds(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : fallback;
}

function viewRules(gs: GameState): GameRules {
  return {
    turnLimit: gs.turnLimit === 2 || gs.turnLimit === 3 ? gs.turnLimit : 1,
    submitSeconds: validSeconds(gs.submitSeconds, LEGACY_RULES.submitSeconds),
    judgeSeconds: validSeconds(gs.judgeSeconds, LEGACY_RULES.judgeSeconds),
    resultSeconds: validSeconds(gs.resultSeconds, LEGACY_RULES.resultSeconds),
  };
}

function phaseDuration(gs: GameState, rules: GameRules): number | null {
  if (gs.phase === 'submitting') return rules.submitSeconds;
  if (gs.phase === 'judging') return rules.judgeSeconds;
  if (gs.phase === 'round-end') return rules.resultSeconds;
  return null;
}

function viewPhaseEndsAt(gs: GameState, rules: GameRules): number | null {
  if (gs.phaseEndsAt === null) return null;
  if (typeof gs.phaseEndsAt === 'number' && Number.isFinite(gs.phaseEndsAt)) {
    return gs.phaseEndsAt;
  }
  const duration = phaseDuration(gs, rules);
  return duration === null ? null : gs.phaseStartedAt + duration * 1000;
}

function viewWinnerIds(gs: GameState): number[] {
  const ids = new Set(gs.players.map((player) => player.id));
  const candidates = Array.isArray(gs.winnerIds) && gs.winnerIds.length
    ? gs.winnerIds
    : gs.winner
      ? [gs.winner.id]
      : [];
  return [...new Set(candidates.filter((id) => ids.has(id)))];
}

function viewAppearance(value: CultistAppearance | undefined): CultistAppearance {
  const robe = value?.robe;
  const hood = value?.hood;
  const face = value?.face;
  const accent = value?.accent;
  const accessory = value?.accessory;
  return {
    robe: robe === 'ash' || robe === 'midnight' || robe === 'moss' ? robe : 'blood',
    hood: hood === 'spire' || hood === 'shrouded' ? hood : 'classic',
    face: face === 'ember' || face === 'grin' || face === 'weeping' ? face : 'void',
    accent: accent === 'brass' || accent === 'scarlet' || accent === 'cyan' ? accent : 'bone',
    accessory: accessory === 'chain' || accessory === 'candle' || accessory === 'relic'
      ? accessory
      : 'none',
  };
}

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
  readonly appearance: Readonly<CultistAppearance>;
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
  readonly usesRoundLimit: boolean;
  readonly turnLimit: TurnLimit | null;
  readonly roundLimit: number | null;
  readonly suddenDeath: boolean;
  readonly scoreLimit: number;
  readonly phaseId: string;
  readonly phaseStartedAt: number;
  readonly phaseEndsAt: number | null;
  readonly phaseDurationSeconds: number | null;
  readonly submitSeconds: number;
  readonly judgeSeconds: number;
  readonly resultSeconds: number;
  readonly votingRound: 1 | 2;
  readonly tieBreak: boolean;
  readonly selfId: number | null;
  readonly judgeId: number | null;
  readonly roundWinnerId: number | null;
  readonly winnerIds: readonly number[];
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
  const winnerIds = freezeArray(gs.phase === 'game-end' ? viewWinnerIds(gs) : []);
  const winnerIdSet = new Set(winnerIds);
  const gameWinnerId = winnerIds[0] ?? null;
  const rules = viewRules(gs);
  const usesRoundLimit = Number.isInteger(gs.roundLimit) && (gs.roundLimit ?? 0) > 0;
  const phaseEndsAt = viewPhaseEndsAt(gs, rules);

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
    appearance: Object.freeze(viewAppearance(player.appearance)),
    submitted: gs.phase === 'submitting' && submittedIds.has(player.id),
    isRoundWinner: verdict && player.id === roundWinnerId,
    isGameWinner: gs.phase === 'game-end' && winnerIdSet.has(player.id),
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
    usesRoundLimit,
    turnLimit: usesRoundLimit ? rules.turnLimit : null,
    roundLimit: usesRoundLimit ? gs.roundLimit as number : null,
    suddenDeath: usesRoundLimit && Boolean(gs.suddenDeath),
    scoreLimit: gs.scoreLimit,
    phaseId: gs.phaseId
      ?? `legacy:r${gs.round}:${gs.phase}:${Number.isFinite(gs.phaseStartedAt) ? gs.phaseStartedAt : 0}`,
    phaseStartedAt: gs.phaseStartedAt,
    phaseEndsAt,
    phaseDurationSeconds: phaseEndsAt === null
      ? null
      : Math.max(0, (phaseEndsAt - gs.phaseStartedAt) / 1000),
    submitSeconds: rules.submitSeconds,
    judgeSeconds: rules.judgeSeconds,
    resultSeconds: rules.resultSeconds,
    votingRound: gs.votingRound,
    tieBreak: verdict && gs.tieBreak,
    selfId: selfExists ? myId : null,
    judgeId,
    roundWinnerId,
    winnerIds,
    gameWinnerId,
    blackCard,
    seats,
    proofs,
  });
}
