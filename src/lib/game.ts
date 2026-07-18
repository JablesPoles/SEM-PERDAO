import { ALL_BLACK, ALL_WHITE } from './cards';
import { sanitizeCustomCards } from './customCards';
import {
  CULTIST_ACCESSORIES,
  CULTIST_ACCENTS,
  CULTIST_FACES,
  CULTIST_HOODS,
  CULTIST_ROBES,
  DEFAULT_CULTIST_APPEARANCE,
  BlackCard,
  CultistAppearance,
  GameMode,
  GamePhase,
  GameRules,
  GameState,
  Player,
  TurnLimit,
  WhiteCard,
} from './types';

export const HAND_SIZE = 10;
export const MIN_PLAYERS = 3;
export const MAX_PLAYERS = 8;
export const DEFAULT_SCORE_LIMIT = 7;
export const DEFAULT_TURN_LIMIT: TurnLimit = 1;
// Relógio da mesa: quem não jogar/julgar até o fim do tempo joga aleatório,
// pra um AFK nunca travar a rodada.
export const SUBMIT_SECONDS = 75;
export const JUDGE_SECONDS = 60;
export const RESULT_SECONDS = 9;

const MIN_PHASE_SECONDS = 1;
const MAX_PHASE_SECONDS = 10 * 60;
let phaseNonce = 0;

function isOneOf<T extends string>(value: unknown, choices: readonly T[]): value is T {
  return typeof value === 'string' && choices.includes(value as T);
}

/** Valida customização recebida da rede sem deixar valores arbitrários no 3D. */
export function normalizeCultistAppearance(value: unknown): CultistAppearance {
  const candidate = value && typeof value === 'object'
    ? value as Partial<CultistAppearance>
    : {};
  return {
    robe: isOneOf(candidate.robe, CULTIST_ROBES)
      ? candidate.robe
      : DEFAULT_CULTIST_APPEARANCE.robe,
    hood: isOneOf(candidate.hood, CULTIST_HOODS)
      ? candidate.hood
      : DEFAULT_CULTIST_APPEARANCE.hood,
    face: isOneOf(candidate.face, CULTIST_FACES)
      ? candidate.face
      : DEFAULT_CULTIST_APPEARANCE.face,
    accent: isOneOf(candidate.accent, CULTIST_ACCENTS)
      ? candidate.accent
      : DEFAULT_CULTIST_APPEARANCE.accent,
    accessory: isOneOf(candidate.accessory, CULTIST_ACCESSORIES)
      ? candidate.accessory
      : DEFAULT_CULTIST_APPEARANCE.accessory,
  };
}

function normalizeTurnLimit(value: unknown): TurnLimit {
  return value === 2 || value === 3 ? value : DEFAULT_TURN_LIMIT;
}

function normalizePhaseSeconds(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(MAX_PHASE_SECONDS, Math.max(MIN_PHASE_SECONDS, Math.round(value)));
}

export function normalizeGameRules(rules: Partial<GameRules> = {}): GameRules {
  return {
    turnLimit: normalizeTurnLimit(rules.turnLimit),
    submitSeconds: normalizePhaseSeconds(rules.submitSeconds, SUBMIT_SECONDS),
    judgeSeconds: normalizePhaseSeconds(rules.judgeSeconds, JUDGE_SECONDS),
    resultSeconds: normalizePhaseSeconds(rules.resultSeconds, RESULT_SECONDS),
  };
}

/** Reconstitui as regras que não existiam nos snapshots antigos. */
export function getGameRules(gs: GameState): GameRules {
  return normalizeGameRules({
    turnLimit: gs.turnLimit,
    submitSeconds: gs.submitSeconds,
    judgeSeconds: gs.judgeSeconds,
    resultSeconds: gs.resultSeconds,
  });
}

export function getRoundLimit(gs: GameState): number {
  if (Number.isInteger(gs.roundLimit) && (gs.roundLimit ?? 0) > 0) {
    return gs.roundLimit as number;
  }
  return Math.max(1, getActivePlayers(gs.players).length * getGameRules(gs).turnLimit);
}

export function getWinnerIds(gs: GameState): number[] {
  const playerIds = new Set(gs.players.map((player) => player.id));
  const candidates = Array.isArray(gs.winnerIds) && gs.winnerIds.length > 0
    ? gs.winnerIds
    : gs.winner
      ? [gs.winner.id]
      : [];
  return [...new Set(candidates.filter((id) => playerIds.has(id)))];
}

function durationForPhase(phase: GamePhase, rules: GameRules): number | null {
  if (phase === 'submitting') return rules.submitSeconds;
  if (phase === 'judging') return rules.judgeSeconds;
  if (phase === 'round-end') return rules.resultSeconds;
  return null;
}

function phaseTiming(
  phase: GamePhase,
  round: number,
  rules: GameRules
): Pick<GameState, 'phase' | 'phaseId' | 'phaseStartedAt' | 'phaseEndsAt'> {
  const phaseStartedAt = Date.now();
  const duration = durationForPhase(phase, rules);
  phaseNonce += 1;
  return {
    phase,
    phaseId: `r${round}:${phase}:${phaseStartedAt}:${phaseNonce}`,
    phaseStartedAt,
    phaseEndsAt: duration === null ? null : phaseStartedAt + duration * 1000,
  };
}

export function getPhaseId(gs: GameState): string {
  return gs.phaseId
    ?? `legacy:r${gs.round}:${gs.phase}:${Number.isFinite(gs.phaseStartedAt) ? gs.phaseStartedAt : 0}`;
}

export function getPhaseEndsAt(gs: GameState): number | null {
  if (gs.phaseEndsAt === null) return null;
  if (typeof gs.phaseEndsAt === 'number' && Number.isFinite(gs.phaseEndsAt)) {
    return gs.phaseEndsAt;
  }
  const duration = durationForPhase(gs.phase, getGameRules(gs));
  if (duration === null) return null;
  const startedAt = Number.isFinite(gs.phaseStartedAt) ? gs.phaseStartedAt : Date.now();
  return startedAt + duration * 1000;
}

export function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function getActivePlayers(players: Player[]): Player[] {
  return players.filter((p) => !p.eliminated);
}

export function hasAvailableSeat(currentPlayerCount: number): boolean {
  return Number.isInteger(currentPlayerCount)
    && currentPlayerCount >= 0
    && currentPlayerCount < MAX_PLAYERS;
}

// Snapshots anteriores ao modo Democracia não têm `mode` em runtime.
export function getGameMode(gs: GameState): GameMode {
  return gs.mode ?? 'judge';
}

// Quem ainda precisa jogar carta branca nesta rodada.
export function pendingSubmitters(gs: GameState): Player[] {
  const democracy = getGameMode(gs) === 'democracy';
  return getActivePlayers(gs.players).filter(
    (p) => (democracy || p.id !== gs.czarId) && !gs.submissions.some((s) => s.playerId === p.id)
  );
}

export function votingChoicesFor(gs: GameState, voterId: number): number[] {
  if (getGameMode(gs) !== 'democracy' || gs.phase !== 'judging') return [];
  const options = gs.votingOptions?.length
    ? gs.votingOptions
    : gs.submissions.map((_, index) => index);
  return options.filter((index) => {
    const submission = gs.submissions[index];
    return submission && submission.playerId !== voterId;
  });
}

export function pendingVoters(gs: GameState): Player[] {
  if (getGameMode(gs) !== 'democracy' || gs.phase !== 'judging') return [];
  return getActivePlayers(gs.players).filter(
    (player) =>
      !gs.votes.some((vote) => vote.voterId === player.id) &&
      votingChoicesFor(gs, player.id).length > 0
  );
}

export function voteCountFor(gs: GameState, submissionIndex: number): number {
  return gs.votes.filter((vote) => vote.submissionIndex === submissionIndex).length;
}

function drawBlack(gs: GameState): GameState {
  let deck = gs.blackDeck;
  if (deck.length === 0) deck = shuffle(gs.blackPool);
  const [blackCard, ...rest] = deck;
  return { ...gs, blackCard, blackDeck: rest };
}

// Completa a mão de todos até HAND_SIZE. Se a pilha acabar, ela é reconstruída
// com tudo que não está em nenhuma mão (as jogadas voltam ao baralho).
function refillHands(gs: GameState): GameState {
  let deck = gs.whiteDeck;
  const players = gs.players.map((p) => ({ ...p, hand: [...p.hand] }));
  const needed = getActivePlayers(players).reduce(
    (n, p) => n + Math.max(0, HAND_SIZE - p.hand.length),
    0
  );
  if (deck.length < needed) {
    const inHands = new Set(players.flatMap((p) => p.hand.map((c) => c.id)));
    deck = shuffle(gs.whitePool.filter((c) => !inHands.has(c.id)));
  }
  for (const p of players) {
    if (p.eliminated) continue;
    while (p.hand.length < HAND_SIZE && deck.length > 0) {
      p.hand.push(deck[0]);
      deck = deck.slice(1);
    }
  }
  return { ...gs, players, whiteDeck: deck };
}

export interface Seat {
  id: number;
  name: string;
  isHuman: boolean;
  appearance?: CultistAppearance;
}

export function initGame(
  seats: Seat[],
  scoreLimit: number,
  mode: GameMode = 'judge',
  customBlack: BlackCard[] = [],
  customWhite: WhiteCard[] = [],
  ruleOverrides: Partial<GameRules> = {}
): GameState {
  const custom = sanitizeCustomCards({ black: customBlack, white: customWhite });
  const blackPool = [...ALL_BLACK, ...custom.black];
  const whitePool = [...ALL_WHITE, ...custom.white];
  const rules = normalizeGameRules(ruleOverrides);
  // A regra pura também protege a geometria e o protocolo caso um snapshot
  // antigo ou duas entradas concorrentes escapem da validação do lobby.
  const players: Player[] = seats.slice(0, MAX_PLAYERS).map((s) => ({
    id: s.id,
    name: s.name,
    isHuman: s.isHuman,
    connected: true,
    score: 0,
    hand: [],
    eliminated: false,
    appearance: normalizeCultistAppearance(s.appearance),
  }));
  // O primeiro juiz é sorteado; na Democracia todo mundo joga e vota.
  const czarId = mode === 'judge'
    ? players[Math.floor(Math.random() * players.length)].id
    : -1;
  const round = 1;
  const base: GameState = {
    ...phaseTiming('submitting', round, rules),
    mode,
    players,
    round,
    turnLimit: rules.turnLimit,
    roundLimit: getActivePlayers(players).length * rules.turnLimit,
    suddenDeath: false,
    scoreLimit,
    czarId,
    blackCard: null,
    submissions: [],
    votes: [],
    votingOptions: [],
    votingRound: 1,
    tieBreak: false,
    revealed: [],
    submitSeconds: rules.submitSeconds,
    judgeSeconds: rules.judgeSeconds,
    resultSeconds: rules.resultSeconds,
    stateRevision: 0,
    roundWinnerId: null,
    winnerIds: [],
    winner: null,
    blackPool,
    whitePool,
    blackDeck: shuffle(blackPool),
    whiteDeck: shuffle(whitePool),
  };
  return drawBlack(refillHands(base));
}

export function applySubmission(gs: GameState, playerId: number, cardIds: string[]): GameState {
  if (gs.phase !== 'submitting' || !gs.blackCard) return gs;
  if (getGameMode(gs) === 'judge' && playerId === gs.czarId) return gs;
  const player = gs.players.find((p) => p.id === playerId && !p.eliminated);
  if (!player) return gs;
  if (gs.submissions.some((s) => s.playerId === playerId)) return gs;
  if (cardIds.length !== gs.blackCard.pick) return gs;
  if (new Set(cardIds).size !== cardIds.length) return gs;

  const cards: WhiteCard[] = [];
  for (const id of cardIds) {
    const card = player.hand.find((c) => c.id === id);
    if (!card) return gs;
    cards.push(card);
  }

  const players = gs.players.map((p) =>
    p.id === playerId ? { ...p, hand: p.hand.filter((c) => !cardIds.includes(c.id)) } : p
  );
  const submissions = [...gs.submissions, { playerId, cards }];
  const next = { ...gs, players, submissions };

  const waiting = pendingSubmitters(next);
  if (waiting.length === 0) return startJudging(next);
  return next;
}

// Embaralha as jogadas ao entrar no julgamento, para o juiz não deduzir o dono
// pela ordem de chegada.
function restartCurrentRound(gs: GameState): GameState {
  const restarted: GameState = {
    ...gs,
    ...phaseTiming('submitting', gs.round, getGameRules(gs)),
    submissions: [],
    votes: [],
    votingOptions: [],
    votingRound: 1,
    tieBreak: false,
    revealed: [],
    roundWinnerId: null,
    blackCard: null,
  };
  return drawBlack(refillHands(restarted));
}

function startJudging(gs: GameState): GameState {
  if (gs.submissions.length === 0) {
    // Todo mundo sumiu antes de jogar — reinicia sem consumir uma rodada do
    // limite que o lobby prometeu.
    return restartCurrentRound(gs);
  }
  const submissions = shuffle(gs.submissions);
  const democracy = getGameMode(gs) === 'democracy';
  const rules = getGameRules(gs);
  return {
    ...gs,
    ...phaseTiming('judging', gs.round, rules),
    submissions,
    votes: [],
    votingOptions: democracy ? submissions.map((_, index) => index) : [],
    votingRound: 1,
    tieBreak: false,
    revealed: democracy ? submissions.map((_, index) => index) : [],
  };
}

// O juiz vira as provas uma a uma — o flip é sincronizado em todas as telas.
export function applyReveal(gs: GameState, index: number): GameState {
  if (gs.phase !== 'judging' || getGameMode(gs) !== 'judge') return gs;
  if (!Number.isInteger(index) || index < 0 || index >= gs.submissions.length) return gs;
  if (gs.revealed.includes(index)) return gs;
  return { ...gs, revealed: [...gs.revealed, index] };
}

function finishRound(gs: GameState, index: number, tieBreak = false): GameState {
  const winning = gs.submissions[index];
  if (!winning) return gs;

  const players = gs.players.map((p) =>
    p.id === winning.playerId ? { ...p, score: p.score + 1 } : p
  );
  return {
    ...gs,
    ...phaseTiming('round-end', gs.round, getGameRules(gs)),
    players,
    roundWinnerId: winning.playerId,
    winnerIds: [],
    winner: null,
    tieBreak,
  };
}

export function applyJudgePick(gs: GameState, index: number): GameState {
  if (gs.phase !== 'judging' || getGameMode(gs) !== 'judge') return gs;
  // Sem julgamento sumário: cada índice real precisa ter sido aberto. Só
  // comparar comprimentos aceitaria duplicatas ou índices órfãos após kick.
  if (gs.submissions.some((_, proofIndex) => !gs.revealed.includes(proofIndex))) return gs;
  return finishRound(gs, index);
}

export function applyVote(gs: GameState, voterId: number, index: number): GameState {
  if (gs.phase !== 'judging' || getGameMode(gs) !== 'democracy') return gs;
  if (!Number.isInteger(index)) return gs;
  if (!getActivePlayers(gs.players).some((player) => player.id === voterId)) return gs;
  if (gs.votes.some((vote) => vote.voterId === voterId)) return gs;
  if (!votingChoicesFor(gs, voterId).includes(index)) return gs;

  const voted: GameState = {
    ...gs,
    votes: [...gs.votes, { voterId, submissionIndex: index }],
  };
  if (pendingVoters(voted).length > 0) return voted;

  const options = voted.votingOptions.length
    ? voted.votingOptions
    : voted.submissions.map((_, submissionIndex) => submissionIndex);
  const highest = Math.max(...options.map((option) => voteCountFor(voted, option)));
  const tied = options.filter((option) => voteCountFor(voted, option) === highest);

  // Um empate abre um único 2º turno só entre as finalistas. Se empatar de
  // novo, o sorteio impede que a partida fique presa para sempre.
  if (tied.length > 1 && voted.votingRound === 1) {
    return {
      ...voted,
      ...phaseTiming('judging', voted.round, getGameRules(voted)),
      votes: [],
      votingOptions: tied,
      votingRound: 2,
    };
  }

  const winningIndex = tied[Math.floor(Math.random() * tied.length)];
  return finishRound(voted, winningIndex, tied.length > 1);
}

// Próximo jogador ativo na ordem da mesa, a partir de `fromId` (exclusivo).
export function nextActiveId(players: Player[], fromId: number): number {
  const ids = players.map((p) => p.id);
  const start = ids.indexOf(fromId);
  for (let i = 1; i <= players.length; i++) {
    const p = players[(start + i) % players.length];
    if (!p.eliminated) return p.id;
  }
  return fromId;
}

export function getScoreLeaders(gs: GameState): Player[] {
  const active = getActivePlayers(gs.players);
  if (!active.length) return [];
  const highest = Math.max(...active.map((player) => player.score));
  return active.filter((player) => player.score === highest);
}

function hasExplicitRoundLimit(gs: GameState): boolean {
  return Number.isInteger(gs.roundLimit) && (gs.roundLimit ?? 0) > 0;
}

/**
 * A partida só é decidida ao sair do resultado, garantindo que a última
 * prova permaneça visível durante toda a fase round-end.
 */
function winnersAfterResult(gs: GameState): Player[] {
  if (gs.phase !== 'round-end') return [];
  const leaders = getScoreLeaders(gs);
  if (!leaders.length) return [];

  if (hasExplicitRoundLimit(gs)) {
    if (gs.round < getRoundLimit(gs)) return [];
    // Depois do limite, qualquer empate mantém a morte súbita viva.
    return leaders.length === 1 ? leaders : [];
  }

  // Compatibilidade: snapshots antigos continuam encerrando por pontuação.
  const highest = leaders[0]?.score ?? 0;
  return highest >= gs.scoreLimit ? leaders : [];
}

export function advanceToNextRound(gs: GameState): GameState {
  if (gs.phase === 'game-end') return gs;
  const winners = winnersAfterResult(gs);
  if (winners.length) {
    const winnerIds = winners.map((player) => player.id);
    return {
      ...gs,
      ...phaseTiming('game-end', gs.round, getGameRules(gs)),
      winnerIds,
      // Campo singular para clientes e snapshots v1.
      winner: winners[0] ?? null,
    };
  }

  const mode = getGameMode(gs);
  const reachedRoundLimit = gs.phase === 'round-end'
    && hasExplicitRoundLimit(gs)
    && gs.round >= getRoundLimit(gs);
  const round = gs.round + 1;
  const next: GameState = {
    ...gs,
    ...phaseTiming('submitting', round, getGameRules(gs)),
    round,
    suddenDeath: Boolean(gs.suddenDeath || reachedRoundLimit),
    czarId: mode === 'judge' ? nextActiveId(gs.players, gs.czarId) : -1,
    submissions: [],
    votes: [],
    votingOptions: [],
    votingRound: 1,
    tieBreak: false,
    revealed: [],
    roundWinnerId: null,
    winnerIds: [],
    winner: null,
  };
  return drawBlack(refillHands(next));
}

// A mensagem `next_round` vem da rede. Só humanos ativos e conectados podem
// votar pelo avanço, e apenas depois de a rodada realmente terminar.
export function canRequestNextRound(gs: GameState, playerId: number): boolean {
  if (gs.phase !== 'round-end') return false;
  return getActivePlayers(gs.players).some(
    (player) => player.id === playerId && player.isHuman && player.connected !== false
  );
}

// Devolve as cartas jogadas às mãos dos donos (rodada abortada e recomeçada,
// então o relógio da fase também reinicia).
function returnSubmissions(gs: GameState): GameState {
  const byPlayer = new Map(gs.submissions.map((s) => [s.playerId, s.cards]));
  const players = gs.players.map((p) => {
    const cards = byPlayer.get(p.id);
    return cards && !p.eliminated ? { ...p, hand: [...p.hand, ...cards] } : p;
  });
  return {
    ...gs,
    ...phaseTiming('submitting', gs.round, getGameRules(gs)),
    players,
    submissions: [],
    votes: [],
    votingOptions: [],
    votingRound: 1,
    revealed: [],
  };
}

/**
 * Remove um jogador por kick mantendo a rodada viável:
 * - era juiz durante as jogadas → rodada reinicia com outro juiz e as cartas
 *   jogadas voltam às mãos;
 * - era juiz durante o julgamento → o próximo jogador ativo assume o martelo;
 * - tinha jogado carta → a jogada some da mesa.
 */
export function removePlayer(gs: GameState, playerId: number): GameState {
  if (!gs.players.some((p) => p.id === playerId && !p.eliminated)) return gs;

  const democracy = getGameMode(gs) === 'democracy';
  const wasCzar = !democracy && gs.czarId === playerId;
  let next: GameState = gs;

  if (gs.phase === 'submitting' && wasCzar) {
    next = returnSubmissions(next);
  }

  // Tirar uma jogada da mesa desloca os índices — os flips já feitos
  // acompanham, senão o juiz veria a prova errada aberta.
  const removedIdx = next.submissions.findIndex((s) => s.playerId === playerId);
  let submissions = next.submissions.filter((s) => s.playerId !== playerId);
  let revealed = next.revealed;
  if (removedIdx >= 0) {
    revealed = revealed
      .filter((i) => i !== removedIdx)
      .map((i) => (i > removedIdx ? i - 1 : i));
  }
  let players = next.players.map((p) =>
    p.id === playerId ? { ...p, connected: false, eliminated: true, hand: [] } : p
  );

  const remaining = getActivePlayers(players);
  if (remaining.length < MIN_PLAYERS) {
    const winner = [...remaining].sort((a, b) => b.score - a.score)[0] ?? null;
    return {
      ...next,
      ...phaseTiming('game-end', next.round, getGameRules(next)),
      players,
      submissions,
      winnerIds: winner ? [winner.id] : [],
      winner,
    };
  }

  let czarId = next.czarId;
  if (wasCzar) czarId = nextActiveId(players, playerId);

  // O novo juiz pode já ter carta na mesa — ela volta pra mão dele. Esta
  // segunda remoção também desloca os índices das provas já abertas.
  if (wasCzar) {
    const ownIdx = submissions.findIndex((s) => s.playerId === czarId);
    const own = ownIdx >= 0 ? submissions[ownIdx] : null;
    if (own && ownIdx >= 0) {
      submissions = submissions.filter((_, index) => index !== ownIdx);
      revealed = revealed
        .filter((index) => index !== ownIdx)
        .map((index) => (index > ownIdx ? index - 1 : index));
      players = players.map((p) =>
        p.id === czarId ? { ...p, hand: [...p.hand, ...own.cards] } : p
      );
    }
  }

  next = { ...next, players, submissions, revealed, czarId };

  // Kick durante a votação democrática reinicia a urna com os jogadores e
  // cartas restantes. Assim nenhum índice ou voto antigo aponta pra outra carta.
  if (democracy && next.phase === 'judging') {
    next = {
      ...next,
      ...phaseTiming('judging', next.round, getGameRules(next)),
      votes: [],
      votingOptions: submissions.map((_, index) => index),
      votingRound: 1,
      tieBreak: false,
      revealed: submissions.map((_, index) => index),
    };
  }

  if (next.phase === 'submitting') {
    const waiting = pendingSubmitters(next);
    if (waiting.length === 0) return startJudging(next);
  }
  if (next.phase === 'judging' && submissions.length === 0) {
    return restartCurrentRound(next);
  }
  return next;
}

// Convidados aprovados no meio do jogo sentam entre uma rodada e outra.
export function seatNewcomers(
  gs: GameState,
  seats: { id: number; name: string; appearance?: CultistAppearance }[]
): GameState {
  const available = Math.max(0, MAX_PLAYERS - getActivePlayers(gs.players).length);
  const occupiedIds = new Set(gs.players.map((player) => player.id));
  const fresh: Player[] = seats
    .filter((seat) => {
      if (occupiedIds.has(seat.id)) return false;
      occupiedIds.add(seat.id);
      return true;
    })
    .slice(0, available)
    .map((s) => ({
      id: s.id,
      name: s.name,
      isHuman: true,
      connected: true,
      score: 0,
      hand: [],
      eliminated: false,
      appearance: normalizeCultistAppearance(s.appearance),
    }));
  if (!fresh.length) return gs;
  return { ...gs, players: [...gs.players, ...fresh] };
}

// Preenche as lacunas da carta preta com as brancas jogadas (para exibição).
export function fillBlanks(black: BlackCard, cards: WhiteCard[]): string {
  let text = black.text;
  for (const card of cards) {
    const answer = card.text.replace(/\.$/, '');
    if (text.includes('____')) {
      text = text.replace('____', `«${answer}»`);
    } else {
      text = `${text} «${answer}»`;
    }
  }
  return text;
}
