import { ALL_BLACK, ALL_WHITE } from './cards';
import { sanitizeCustomCards } from './customCards';
import { BlackCard, GameMode, GameState, Player, WhiteCard } from './types';

export const HAND_SIZE = 10;
export const MIN_PLAYERS = 3;
export const DEFAULT_SCORE_LIMIT = 7;
// Relógio da mesa: quem não jogar/julgar até o fim do tempo joga aleatório,
// pra um AFK nunca travar a rodada.
export const SUBMIT_SECONDS = 75;
export const JUDGE_SECONDS = 60;

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
}

export function initGame(
  seats: Seat[],
  scoreLimit: number,
  mode: GameMode = 'judge',
  customBlack: BlackCard[] = [],
  customWhite: WhiteCard[] = []
): GameState {
  const custom = sanitizeCustomCards({ black: customBlack, white: customWhite });
  const blackPool = [...ALL_BLACK, ...custom.black];
  const whitePool = [...ALL_WHITE, ...custom.white];
  const players: Player[] = seats.map((s) => ({
    id: s.id,
    name: s.name,
    isHuman: s.isHuman,
    connected: true,
    score: 0,
    hand: [],
    eliminated: false,
  }));
  // O primeiro juiz é sorteado; na Democracia todo mundo joga e vota.
  const czarId = mode === 'judge'
    ? players[Math.floor(Math.random() * players.length)].id
    : -1;
  const base: GameState = {
    phase: 'submitting',
    mode,
    players,
    round: 1,
    scoreLimit,
    czarId,
    blackCard: null,
    submissions: [],
    votes: [],
    votingOptions: [],
    votingRound: 1,
    tieBreak: false,
    revealed: [],
    phaseStartedAt: Date.now(),
    roundWinnerId: null,
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
function startJudging(gs: GameState): GameState {
  if (gs.submissions.length === 0) {
    // Todo mundo sumiu antes de jogar — pula a rodada.
    return advanceToNextRound(gs);
  }
  const submissions = shuffle(gs.submissions);
  const democracy = getGameMode(gs) === 'democracy';
  return {
    ...gs,
    phase: 'judging',
    submissions,
    votes: [],
    votingOptions: democracy ? submissions.map((_, index) => index) : [],
    votingRound: 1,
    tieBreak: false,
    revealed: democracy ? submissions.map((_, index) => index) : [],
    phaseStartedAt: Date.now(),
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
  const winner = players.find((p) => p.score >= gs.scoreLimit) ?? null;
  return {
    ...gs,
    players,
    roundWinnerId: winning.playerId,
    phase: winner ? 'game-end' : 'round-end',
    winner,
    tieBreak,
  };
}

export function applyJudgePick(gs: GameState, index: number): GameState {
  if (gs.phase !== 'judging' || getGameMode(gs) !== 'judge') return gs;
  // Sem julgamento sumário: só depois de virar todas as provas.
  if (gs.revealed.length !== gs.submissions.length) return gs;
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
      votes: [],
      votingOptions: tied,
      votingRound: 2,
      phaseStartedAt: Date.now(),
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

export function advanceToNextRound(gs: GameState): GameState {
  const mode = getGameMode(gs);
  const next: GameState = {
    ...gs,
    phase: 'submitting',
    round: gs.round + 1,
    czarId: mode === 'judge' ? nextActiveId(gs.players, gs.czarId) : -1,
    submissions: [],
    votes: [],
    votingOptions: [],
    votingRound: 1,
    tieBreak: false,
    revealed: [],
    phaseStartedAt: Date.now(),
    roundWinnerId: null,
  };
  return drawBlack(refillHands(next));
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
    players,
    submissions: [],
    votes: [],
    votingOptions: [],
    votingRound: 1,
    revealed: [],
    phaseStartedAt: Date.now(),
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
    return { ...next, players, submissions, phase: 'game-end', winner };
  }

  let czarId = next.czarId;
  if (wasCzar) czarId = nextActiveId(players, playerId);

  // O novo juiz pode já ter carta na mesa — ela volta pra mão dele.
  if (wasCzar) {
    const own = submissions.find((s) => s.playerId === czarId);
    if (own) {
      submissions = submissions.filter((s) => s.playerId !== czarId);
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
      votes: [],
      votingOptions: submissions.map((_, index) => index),
      votingRound: 1,
      tieBreak: false,
      revealed: submissions.map((_, index) => index),
      phaseStartedAt: Date.now(),
    };
  }

  if (next.phase === 'submitting') {
    const waiting = pendingSubmitters(next);
    if (waiting.length === 0) return startJudging(next);
  }
  if (next.phase === 'judging' && submissions.length === 0) {
    return advanceToNextRound(next);
  }
  return next;
}

// Convidados aprovados no meio do jogo sentam entre uma rodada e outra.
export function seatNewcomers(gs: GameState, seats: { id: number; name: string }[]): GameState {
  const fresh: Player[] = seats
    .filter((s) => !gs.players.some((p) => p.id === s.id))
    .map((s) => ({
      id: s.id,
      name: s.name,
      isHuman: true,
      connected: true,
      score: 0,
      hand: [],
      eliminated: false,
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
