import { expect, test } from 'playwright/test';

import {
  canRequestNextRound,
  hasAvailableSeat,
  initGame,
  MAX_PLAYERS,
  seatNewcomers,
  type Seat,
} from '../src/lib/game';

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
