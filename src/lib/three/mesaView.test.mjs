import assert from 'node:assert/strict';
import test from 'node:test';

import { projectMesaView } from './mesaView.ts';

const black = { id: 'black-2', text: '____ encontrou ____.', pick: 2 };

function player(id, overrides = {}) {
  return {
    id,
    name: `P${id}`,
    isHuman: true,
    connected: true,
    score: 0,
    hand: [{ id: `hand-${id}`, text: `SEGREDO DA MAO ${id}` }],
    eliminated: false,
    ...overrides,
  };
}

function state(overrides = {}) {
  return {
    phase: 'submitting',
    mode: 'judge',
    players: [player(10), player(20), player(30)],
    round: 4,
    scoreLimit: 7,
    czarId: 30,
    blackCard: black,
    submissions: [],
    votes: [],
    votingOptions: [],
    votingRound: 1,
    tieBreak: false,
    revealed: [],
    phaseStartedAt: 1234,
    roundWinnerId: null,
    winner: null,
    blackPool: [{ id: 'pool-black', text: 'SEGREDO PRETO', pick: 1 }],
    whitePool: [{ id: 'pool-white', text: 'SEGREDO BRANCO' }],
    blackDeck: [{ id: 'deck-black', text: 'SEGREDO DECK', pick: 1 }],
    whiteDeck: [{ id: 'deck-white', text: 'SEGREDO DECK BRANCO' }],
    ...overrides,
  };
}

test('rotaciona 3 assentos para myId em azimute zero e marca o juiz dinâmico', () => {
  const view = projectMesaView(state(), 20);

  assert.deepEqual(view.seats.map((seat) => seat.id), [20, 30, 10]);
  assert.equal(view.seats[0].azimuthRad, 0);
  assert.equal(view.seats[1].azimuthRad, (Math.PI * 2) / 3);
  assert.equal(view.seats[2].azimuthRad, (Math.PI * 4) / 3);
  assert.equal(view.selfId, 20);
  assert.equal(view.judgeId, 30);
  assert.equal(view.seats.find((seat) => seat.isJudge)?.id, 30);
});

test('distribui os 8 assentos sem perder a ordem relativa', () => {
  const players = Array.from({ length: 8 }, (_, index) => player(index + 1));
  const view = projectMesaView(state({ players, czarId: 2 }), 5);

  assert.deepEqual(view.seats.map((seat) => seat.id), [5, 6, 7, 8, 1, 2, 3, 4]);
  view.seats.forEach((seat, index) => {
    assert.equal(seat.azimuthRad, index * Math.PI / 4);
  });
});

test('limita snapshot legado a 8 ativos, sem duplicatas, e preserva self e juiz', () => {
  const players = [
    ...Array.from({ length: 10 }, (_, index) => player(index + 1)),
    player(4, { name: 'Duplicado' }),
  ];
  players[2] = player(3, { eliminated: true });

  const view = projectMesaView(state({ players, czarId: 9 }), 10);

  assert.equal(view.seats.length, 8);
  assert.equal(new Set(view.seats.map((seat) => seat.id)).size, 8);
  assert.equal(view.seats[0].id, 10);
  assert.equal(view.seats.some((seat) => seat.id === 3), false);
  assert.equal(view.seats.some((seat) => seat.eliminated), false);
  assert.equal(view.seats.some((seat) => seat.id === 9), true);
  assert.equal(view.judgeId, 9);
});

test('snapshot sem mode usa o modo clássico e mantém o juiz', () => {
  const legacy = state();
  delete legacy.mode;

  const view = projectMesaView(legacy, 10);

  assert.equal(view.mode, 'judge');
  assert.equal(view.judgeId, 30);
  assert.equal(view.seats.find((seat) => seat.id === 30)?.isJudge, true);
});

test('projeta relógio, limite por voltas e morte súbita sem depender do renderer', () => {
  const view = projectMesaView(state({
    turnLimit: 2,
    roundLimit: 6,
    suddenDeath: true,
    phaseId: 'host-phase-42',
    phaseStartedAt: 10_000,
    phaseEndsAt: 22_000,
    submitSeconds: 12,
    judgeSeconds: 23,
    resultSeconds: 6,
  }), 10);

  assert.equal(view.usesRoundLimit, true);
  assert.equal(view.turnLimit, 2);
  assert.equal(view.roundLimit, 6);
  assert.equal(view.suddenDeath, true);
  assert.equal(view.phaseId, 'host-phase-42');
  assert.equal(view.phaseStartedAt, 10_000);
  assert.equal(view.phaseEndsAt, 22_000);
  assert.equal(view.phaseDurationSeconds, 12);
  assert.equal(view.submitSeconds, 12);
  assert.equal(view.judgeSeconds, 23);
  assert.equal(view.resultSeconds, 6);
});

test('snapshot legado preserva scoreLimit e deriva relógio sem inventar roundLimit', () => {
  const view = projectMesaView(state(), 10);

  assert.equal(view.usesRoundLimit, false);
  assert.equal(view.turnLimit, null);
  assert.equal(view.roundLimit, null);
  assert.equal(view.scoreLimit, 7);
  assert.equal(view.phaseId, 'legacy:r4:submitting:1234');
  assert.equal(view.phaseEndsAt, 1234 + 75_000);
  assert.equal(view.phaseDurationSeconds, 75);
});

test('normaliza e congela a aparência pública de cada assento', () => {
  const players = [
    player(10, {
      appearance: {
        robe: 'moss',
        hood: 'spire',
        face: 'weeping',
        accent: 'cyan',
        accessory: 'relic',
      },
    }),
    player(20, { appearance: { robe: 'hack', accessory: 'arbitrary' } }),
    player(30),
  ];
  const view = projectMesaView(state({ players }), 10);

  assert.deepEqual(view.seats[0].appearance, {
    robe: 'moss',
    hood: 'spire',
    face: 'weeping',
    accent: 'cyan',
    accessory: 'relic',
  });
  assert.deepEqual(view.seats[1].appearance, {
    robe: 'blood',
    hood: 'classic',
    face: 'void',
    accent: 'bone',
    accessory: 'none',
  });
  assert.equal(Object.isFrozen(view.seats[0].appearance), true);
});

test('na coleta expõe somente quais assentos enviaram, nunca a prova', () => {
  const gs = state({
    submissions: [{
      playerId: 20,
      cards: [
        { id: 'white-secret-a', text: 'TEXTO ULTRASSECRETO A' },
        { id: 'white-secret-b', text: 'TEXTO ULTRASSECRETO B' },
      ],
    }],
    // Mesmo um snapshot inconsistente não antecipa o resultado.
    roundWinnerId: 20,
    winner: player(20),
  });
  const view = projectMesaView(gs, 10);
  const serialized = JSON.stringify(view);

  assert.equal(view.proofs.length, 0);
  assert.equal(view.seats.find((seat) => seat.id === 20)?.submitted, true);
  assert.equal(view.seats.find((seat) => seat.id === 10)?.submitted, false);
  assert.equal(view.roundWinnerId, null);
  assert.equal(view.gameWinnerId, null);
  assert.doesNotMatch(serialized, /ULTRASSECRETO|white-secret|SEGREDO DA MAO/);
  assert.doesNotMatch(serialized, /SEGREDO BRANCO|SEGREDO DECK/);
});

test('no julgamento lacra texto e autoria, mas revela combos completos na ordem', () => {
  const gs = state({
    phase: 'judging',
    submissions: [
      {
        playerId: 10,
        cards: [
          { id: 'original-a0', text: 'A0' },
          { id: 'original-a1', text: 'A1' },
        ],
      },
      {
        playerId: 20,
        cards: [
          { id: 'original-b0', text: 'B0' },
          { id: 'original-b1', text: 'B1' },
        ],
      },
    ],
    revealed: [1],
    roundWinnerId: 10,
  });
  const view = projectMesaView(gs, 10);

  assert.deepEqual(view.proofs[0], {
    id: 'round:4:proof:0',
    submissionIndex: 0,
    state: 'sealed',
    cardCount: 2,
    cards: [],
    owner: null,
    isWinner: false,
  });
  assert.equal(view.proofs[1].state, 'revealed');
  assert.deepEqual(view.proofs[1].cards.map((card) => card.text), ['B0', 'B1']);
  assert.deepEqual(view.proofs[1].cards.map((card) => card.id), [
    'round:4:proof:1:card:0',
    'round:4:proof:1:card:1',
  ]);
  assert.equal(view.proofs[1].owner, null);
  assert.equal(view.proofs[1].isWinner, false);
  assert.equal(view.roundWinnerId, null);
  assert.doesNotMatch(JSON.stringify(view), /original-[ab][01]/);
});

test('democracia não inventa juiz nem abre autoria durante o julgamento', () => {
  const view = projectMesaView(state({
    mode: 'democracy',
    phase: 'judging',
    czarId: -1,
    submissions: [{ playerId: 20, cards: [{ id: 'c0', text: 'C0' }, { id: 'c1', text: 'C1' }] }],
    revealed: [0],
  }), 20);

  assert.equal(view.judgeId, null);
  assert.equal(view.seats.some((seat) => seat.isJudge), false);
  assert.equal(view.proofs[0].owner, null);
});

test('no resultado abre autoria e decide a prova vencedora por roundWinnerId', () => {
  const view = projectMesaView(state({
    phase: 'round-end',
    submissions: [
      { playerId: 10, cards: [{ id: 'a0', text: 'A0' }, { id: 'a1', text: 'A1' }] },
      { playerId: 20, cards: [{ id: 'b0', text: 'B0' }, { id: 'b1', text: 'B1' }] },
    ],
    // Nenhuma estava em revealed: no resultado ambas precisam estar abertas.
    revealed: [],
    roundWinnerId: 20,
  }), 10);

  assert.equal(view.proofs.every((proof) => proof.state === 'revealed'), true);
  assert.deepEqual(view.proofs[0].owner, { id: 10, name: 'P10' });
  assert.deepEqual(view.proofs[1].owner, { id: 20, name: 'P20' });
  assert.equal(view.proofs[0].isWinner, false);
  assert.equal(view.proofs[1].isWinner, true);
  assert.equal(view.seats.find((seat) => seat.id === 20)?.isRoundWinner, true);
  assert.equal(view.roundWinnerId, 20);
});

test('game-end projeta o vencedor geral sem copiar seu Player/hand', () => {
  const winner = player(30, { hand: [{ id: 'final-secret', text: 'NAO VAZAR' }] });
  const view = projectMesaView(state({ phase: 'game-end', winner, roundWinnerId: 30 }), 10);

  assert.equal(view.gameWinnerId, 30);
  assert.equal(view.seats.find((seat) => seat.id === 30)?.isGameWinner, true);
  assert.doesNotMatch(JSON.stringify(view), /final-secret|NAO VAZAR/);
});

test('winnerIds marca todos os vencedores sem copiar objetos Player', () => {
  const view = projectMesaView(state({
    phase: 'game-end',
    winner: null,
    winnerIds: [20, 30, 30, 999],
  }), 10);

  assert.deepEqual(view.winnerIds, [20, 30]);
  assert.equal(view.gameWinnerId, 20);
  assert.equal(view.seats.find((seat) => seat.id === 20)?.isGameWinner, true);
  assert.equal(view.seats.find((seat) => seat.id === 30)?.isGameWinner, true);
  assert.equal(view.seats.find((seat) => seat.id === 10)?.isGameWinner, false);
  assert.equal(Object.isFrozen(view.winnerIds), true);
});

test('retorna um snapshot congelado e desacoplado do GameState', () => {
  const gs = state({
    phase: 'judging',
    submissions: [{ playerId: 20, cards: [{ id: 'x0', text: 'ANTES' }, { id: 'x1', text: 'DOIS' }] }],
    revealed: [0],
  });
  const view = projectMesaView(gs, 10);

  gs.players[0].name = 'MUTADO';
  gs.submissions[0].cards[0].text = 'DEPOIS';

  assert.equal(view.seats.find((seat) => seat.id === 10)?.name, 'P10');
  assert.equal(view.proofs[0].cards[0].text, 'ANTES');
  assert.equal(Object.isFrozen(view), true);
  assert.equal(Object.isFrozen(view.seats), true);
  assert.equal(Object.isFrozen(view.seats[0]), true);
  assert.equal(Object.isFrozen(view.proofs), true);
  assert.equal(Object.isFrozen(view.proofs[0]), true);
  assert.equal(Object.isFrozen(view.proofs[0].cards), true);
});
