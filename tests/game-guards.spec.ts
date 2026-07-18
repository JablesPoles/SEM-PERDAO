import { expect, test } from 'playwright/test';

import {
  JUDGE_SECONDS,
  RESULT_SECONDS,
  SUBMIT_SECONDS,
  advanceToNextRound,
  applyJudgePick,
  applyReveal,
  applySubmission,
  applyVote,
  canRequestNextRound,
  getPhaseEndsAt,
  getPhaseId,
  getWinnerIds,
  hasAvailableSeat,
  initGame,
  MAX_PLAYERS,
  normalizeCultistAppearance,
  removePlayer,
  seatNewcomers,
  type Seat,
} from '../src/lib/game';
import type { GameState } from '../src/lib/types';
import { redactStateFor } from '../src/hooks/useMultiplayer';

function seats(count: number, startAt = 0): Seat[] {
  return Array.from({ length: count }, (_, index) => ({
    id: startAt + index,
    name: `Jogador ${startAt + index}`,
    isHuman: true,
  }));
}

test('a mesa aceita no máximo oito assentos', () => {
  expect(MAX_PLAYERS).toBe(8);
  expect(hasAvailableSeat(7)).toBe(true);
  expect(hasAvailableSeat(8)).toBe(false);

  const game = initGame(seats(9), 7);
  expect(game.players).toHaveLength(MAX_PLAYERS);
});

test('novatos aprovados não ultrapassam os oito jogadores ativos', () => {
  const game = initGame(seats(7), 7);
  const withNewcomers = seatNewcomers(game, [
    { id: 7, name: 'Oitavo' },
    { id: 8, name: 'Nono' },
  ]);

  expect(withNewcomers.players.filter((player) => !player.eliminated)).toHaveLength(MAX_PLAYERS);
  expect(withNewcomers.players.some((player) => player.id === 7)).toBe(true);
  expect(withNewcomers.players.some((player) => player.id === 8)).toBe(false);
});

test('novatos repetidos no mesmo lote ocupam um único assento', () => {
  const game = initGame(seats(6), 7);
  const withNewcomers = seatNewcomers(game, [
    { id: 6, name: 'Primeiro nome' },
    { id: 6, name: 'ID repetido' },
    { id: 7, name: 'Oitavo' },
  ]);

  expect(withNewcomers.players.filter((player) => !player.eliminated)).toHaveLength(8);
  expect(withNewcomers.players.filter((player) => player.id === 6)).toHaveLength(1);
  expect(withNewcomers.players.find((player) => player.id === 6)?.name).toBe('Primeiro nome');
  expect(withNewcomers.players.some((player) => player.id === 7)).toBe(true);
});

test('next_round só é aceito no fim da rodada e para humano ativo conectado', () => {
  const game = initGame(seats(3), 7);
  const playerId = game.players[0].id;

  expect(canRequestNextRound(game, playerId)).toBe(false);
  expect(canRequestNextRound({ ...game, phase: 'round-end' }, playerId)).toBe(true);
  expect(canRequestNextRound({
    ...game,
    phase: 'round-end',
    players: game.players.map((player) =>
      player.id === playerId ? { ...player, connected: false } : player
    ),
  }, playerId)).toBe(false);
  expect(canRequestNextRound({ ...game, phase: 'round-end' }, 999)).toBe(false);
});

test('1/2/3 voltas fixam o limite inicial nos dois modos', () => {
  for (const mode of ['judge', 'democracy'] as const) {
    for (const turnLimit of [1, 2, 3] as const) {
      const game = initGame(seats(4), 7, mode, [], [], { turnLimit });
      expect(game.turnLimit).toBe(turnLimit);
      expect(game.roundLimit).toBe(4 * turnLimit);
      expect(game.suddenDeath).toBe(false);
    }
  }

  const game = initGame(seats(3), 7, 'judge', [], [], { turnLimit: 2 });
  const withNewcomer = seatNewcomers(game, [{ id: 99, name: 'Tardio' }]);
  expect(withNewcomer.roundLimit).toBe(6);
});

function judgmentFor(
  game: GameState,
  round: number,
  scores: Record<number, number>,
  winningPlayerId: number
): GameState {
  return {
    ...game,
    phase: 'judging',
    round,
    players: game.players.map((player) => ({
      ...player,
      score: scores[player.id] ?? 0,
    })),
    submissions: [{
      playerId: winningPlayerId,
      cards: [{ id: `proof-${round}`, text: `Prova ${round}` }],
    }],
    revealed: [0],
  };
}

test('a última rodada sempre mostra round-end antes de declarar game-end', () => {
  const game = initGame(seats(3), 99, 'judge', [], [], {
    turnLimit: 1,
    resultSeconds: 7,
  });
  const leaderId = game.players.find((player) => player.id !== game.czarId)?.id
    ?? game.players[0].id;
  const judged = judgmentFor(game, 3, { [leaderId]: 1 }, leaderId);
  const result = applyJudgePick(judged, 0);

  expect(result.phase).toBe('round-end');
  expect(result.winner).toBeNull();
  expect(result.winnerIds).toEqual([]);
  expect(result.phaseEndsAt! - result.phaseStartedAt).toBe(7_000);

  const ended = advanceToNextRound(result);
  expect(ended.phase).toBe('game-end');
  expect(ended.winner?.id).toBe(leaderId);
  expect(ended.winnerIds).toEqual([leaderId]);
  expect(ended.phaseEndsAt).toBeNull();
});

test('empate no limite entra em morte súbita até surgir líder único', () => {
  const game = initGame(seats(3), 99, 'democracy', [], [], { turnLimit: 1 });
  const [a, b, c] = game.players.map((player) => player.id);
  const tiedResult = applyJudgePick({
    ...judgmentFor(game, 3, { [a]: 1, [b]: 1, [c]: 0 }, c),
    // Exercita o fechamento sem depender da urna; finishRound é compartilhado.
    mode: 'judge',
  }, 0);

  expect(tiedResult.phase).toBe('round-end');
  const overtime = advanceToNextRound(tiedResult);
  expect(overtime.phase).toBe('submitting');
  expect(overtime.round).toBe(4);
  expect(overtime.roundLimit).toBe(3);
  expect(overtime.suddenDeath).toBe(true);
  expect(overtime.winner).toBeNull();

  const decisiveResult = applyJudgePick({
    ...judgmentFor(overtime, 4, { [a]: 1, [b]: 1, [c]: 1 }, a),
    mode: 'judge',
  }, 0);
  expect(decisiveResult.phase).toBe('round-end');

  const ended = advanceToNextRound(decisiveResult);
  expect(ended.phase).toBe('game-end');
  expect(ended.winnerIds).toEqual([a]);
  expect(ended.winner?.id).toBe(a);
});

test('democracia abre segundo turno e desempata sem juiz', () => {
  const game = initGame(seats(3), 99, 'democracy');
  let voting: GameState = {
    ...game,
    phase: 'judging',
    czarId: -1,
    submissions: game.players.map((player, index) => ({
      playerId: player.id,
      cards: [{ id: `democracy-${index}`, text: `Candidato ${index}` }],
    })),
    revealed: [0, 1, 2],
    votingOptions: [0, 1, 2],
    votingRound: 1,
    votes: [],
  };

  // Cada pessoa vota na prova seguinte; o primeiro turno empata em 1–1–1.
  voting = applyVote(voting, game.players[0].id, 1);
  voting = applyVote(voting, game.players[1].id, 2);
  voting = applyVote(voting, game.players[2].id, 0);
  expect(voting.phase).toBe('judging');
  expect(voting.votingRound).toBe(2);
  expect(voting.votes).toEqual([]);

  voting = applyVote(voting, game.players[0].id, 1);
  voting = applyVote(voting, game.players[1].id, 2);
  voting = applyVote(voting, game.players[2].id, 0);
  expect(voting.phase).toBe('round-end');
  expect(voting.tieBreak).toBe(true);
  expect(voting.players.reduce((total, player) => total + player.score, 0)).toBe(1);
});

test('cada transição recebe phaseId e deadline autoritativos', () => {
  let game = initGame(seats(3), 99, 'judge', [], [], {
    turnLimit: 2,
    submitSeconds: 12,
    judgeSeconds: 23,
    resultSeconds: 6,
  });
  const submitPhaseId = getPhaseId(game);
  expect(getPhaseEndsAt(game)! - game.phaseStartedAt).toBe(12_000);

  game = { ...game, blackCard: { id: 'timer-black', text: '____', pick: 1 } };
  for (const player of game.players.filter((candidate) => candidate.id !== game.czarId)) {
    game = applySubmission(game, player.id, [player.hand[0].id]);
  }

  expect(game.phase).toBe('judging');
  expect(getPhaseId(game)).not.toBe(submitPhaseId);
  expect(getPhaseEndsAt(game)! - game.phaseStartedAt).toBe(23_000);
  const judgingPhaseId = getPhaseId(game);

  for (let index = 0; index < game.submissions.length; index += 1) {
    game = applyReveal(game, index);
  }
  game = applyJudgePick(game, 0);
  expect(game.phase).toBe('round-end');
  expect(getPhaseId(game)).not.toBe(judgingPhaseId);
  expect(getPhaseEndsAt(game)! - game.phaseStartedAt).toBe(6_000);

  const next = advanceToNextRound(game);
  expect(next.phase).toBe('submitting');
  expect(getPhaseEndsAt(next)! - next.phaseStartedAt).toBe(12_000);
});

test('snapshot antigo continua encerrando por scoreLimit e winner singular', () => {
  const game = initGame(seats(3), 7);
  const leaderId = game.players[0].id;
  const legacy: GameState = {
    ...game,
    phase: 'round-end',
    roundLimit: undefined,
    turnLimit: undefined,
    phaseId: undefined,
    phaseEndsAt: undefined,
    winnerIds: undefined,
    players: game.players.map((player) => ({
      ...player,
      score: player.id === leaderId ? 7 : 2,
    })),
  };

  expect(getPhaseId(legacy)).toContain('legacy:');
  const ended = advanceToNextRound(legacy);
  expect(ended.phase).toBe('game-end');
  expect(ended.winner?.id).toBe(leaderId);
  expect(getWinnerIds({ ...ended, winnerIds: undefined })).toEqual([leaderId]);
});

test('aparência é curada, serializável e recebe fallback por campo', () => {
  const appearance = normalizeCultistAppearance({
    robe: 'moss',
    hood: 'fora-do-schema',
    face: 'weeping',
    accent: 'cyan',
    accessory: 'relic',
  });
  expect(appearance).toEqual({
    robe: 'moss',
    hood: 'classic',
    face: 'weeping',
    accent: 'cyan',
    accessory: 'relic',
  });
  expect(JSON.parse(JSON.stringify(appearance))).toEqual(appearance);

  const game = initGame([
    ...seats(2),
    { id: 2, name: 'Custom', isHuman: true, appearance },
  ], 7);
  expect(game.players.find((player) => player.id === 2)?.appearance).toEqual(appearance);
  expect(game.players[0].appearance).toEqual(normalizeCultistAppearance(undefined));
  expect(SUBMIT_SECONDS).toBe(75);
  expect(JUDGE_SECONDS).toBe(60);
  expect(RESULT_SECONDS).toBe(9);
});

test('kick do juiz remapeia a segunda prova removida e não trava o veredito', () => {
  const game = initGame(seats(4), 99, 'judge');
  const [oldJudge, newJudge, playerA, playerB] = game.players.map((player) => player.id);
  const judging: GameState = {
    ...game,
    phase: 'judging',
    czarId: oldJudge,
    submissions: [newJudge, playerA, playerB].map((playerId, index) => ({
      playerId,
      cards: [{ id: `kick-proof-${index}`, text: `Prova ${index}` }],
    })),
    revealed: [0, 1, 2],
  };

  const kicked = removePlayer(judging, oldJudge);
  expect(kicked.czarId).toBe(newJudge);
  expect(kicked.submissions.map((submission) => submission.playerId)).toEqual([playerA, playerB]);
  expect(kicked.revealed).toEqual([0, 1]);
  expect(applyJudgePick(kicked, 0).phase).toBe('round-end');
});

test('veredito exige todos os índices reais, não apenas o mesmo comprimento', () => {
  const game = initGame(seats(3), 99, 'judge');
  const players = game.players.filter((player) => player.id !== game.czarId);
  const malformed: GameState = {
    ...game,
    phase: 'judging',
    submissions: players.map((player, index) => ({
      playerId: player.id,
      cards: [{ id: `malformed-${index}`, text: `Malformada ${index}` }],
    })),
    revealed: [0, 0],
  };

  expect(applyJudgePick(malformed, 0)).toBe(malformed);
});

test('rodada abortada sem provas reinicia sem consumir o limite regulamentar', () => {
  const game = initGame(seats(4), 99, 'judge', [], [], { turnLimit: 1 });
  const departing = game.players.find((player) => player.id !== game.czarId)!;
  const aborted = removePlayer({
    ...game,
    phase: 'judging',
    round: game.roundLimit!,
    submissions: [],
    revealed: [],
  }, departing.id);

  expect(aborted.phase).toBe('submitting');
  expect(aborted.round).toBe(game.roundLimit);
  expect(aborted.suddenDeath).toBe(false);
  expect(aborted.blackCard).not.toBeNull();
});

test('snapshot convidado só abre provas reveladas e nunca vaza a mão em winner', () => {
  const game = initGame(seats(3), 99, 'judge');
  const submitters = game.players.filter((player) => player.id !== game.czarId);
  const visible = { id: 'visible-proof', text: 'PROVA VISÍVEL' };
  const sealed = { id: 'sealed-proof', text: 'SEGREDO LACRADO' };
  const judging: GameState = {
    ...game,
    phase: 'judging',
    submissions: [
      { playerId: submitters[0].id, cards: [visible] },
      { playerId: submitters[1].id, cards: [sealed] },
    ],
    revealed: [0],
  };

  const redacted = redactStateFor(judging, game.czarId);
  expect(redacted.submissions[0].cards).toEqual([visible]);
  expect(redacted.submissions[1].cards).toEqual([]);
  expect(JSON.stringify(redacted)).not.toContain('SEGREDO LACRADO');

  const winner = { ...game.players[1], hand: [{ id: 'winner-secret', text: 'MÃO DO VENCEDOR' }] };
  const ended = redactStateFor({
    ...game,
    phase: 'game-end',
    winner,
    winnerIds: [winner.id],
  }, game.players[0].id);
  expect(ended.winner?.hand).toEqual([]);
  expect(JSON.stringify(ended)).not.toContain('MÃO DO VENCEDOR');
});
