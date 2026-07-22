import { expect, test } from 'playwright/test';

import {
  detectSemPerdaoTableEvents,
  SEM_PERDAO_EXPERIENCE_DIRECTOR,
  semPerdaoFinaleTiming,
  SemPerdaoExperienceSession,
} from '../src/lib/mesa/semPerdaoExperience';
import { projectMesaView, type MesaView } from '../src/lib/three/mesaView';
import type { GameState } from '../src/lib/types';

function publicView(overrides: Partial<MesaView> = {}): MesaView {
  return {
    phase: 'submitting',
    mode: 'judge',
    round: 1,
    usesRoundLimit: true,
    turnLimit: 1,
    roundLimit: 3,
    suddenDeath: false,
    scoreLimit: 7,
    phaseId: 'phase-round-1',
    stateRevision: 1,
    phaseStartedAt: 1_000,
    phaseEndsAt: 76_000,
    phaseDurationSeconds: 75,
    submitSeconds: 75,
    judgeSeconds: 60,
    resultSeconds: 9,
    votingRound: 1,
    tieBreak: false,
    selfId: 1,
    judgeId: 3,
    roundWinnerId: null,
    winnerIds: [],
    gameWinnerId: null,
    blackCard: { id: 'black-public', text: 'Pergunta ____', pick: 1 },
    seats: [
      { id: 1, name: 'A', index: 0, azimuthRad: 0, isSelf: true, isJudge: false, isHuman: true, connected: true, eliminated: false, score: 0, appearance: { robe: 'blood', hood: 'classic', face: 'void', accent: 'bone', accessory: 'none' }, submitted: false, isRoundWinner: false, isGameWinner: false },
      { id: 2, name: 'B', index: 1, azimuthRad: 2, isSelf: false, isJudge: false, isHuman: true, connected: true, eliminated: false, score: 0, appearance: { robe: 'ash', hood: 'classic', face: 'void', accent: 'bone', accessory: 'none' }, submitted: false, isRoundWinner: false, isGameWinner: false },
      { id: 3, name: 'C', index: 2, azimuthRad: 4, isSelf: false, isJudge: true, isHuman: true, connected: true, eliminated: false, score: 0, appearance: { robe: 'moss', hood: 'classic', face: 'void', accent: 'bone', accessory: 'none' }, submitted: false, isRoundWinner: false, isGameWinner: false },
    ],
    proofs: [],
    ...overrides,
  };
}

test('eventos são determinísticos mesmo com assentos rotacionados por cliente', () => {
  const beforeA = publicView();
  const beforeB = publicView({ seats: [beforeA.seats[1], beforeA.seats[2], beforeA.seats[0]] });
  const afterA = publicView({
    phase: 'judging', phaseId: 'phase-judging-1', stateRevision: 2,
    proofs: [{ id: 'round:1:proof:0', submissionIndex: 0, state: 'sealed', cardCount: 1, cards: [], owner: null, isWinner: false }],
  });
  const afterB = publicView({ ...afterA, seats: [afterA.seats[2], afterA.seats[0], afterA.seats[1]] });
  const options = { roomSessionId: 'room:ABCD', sequenceStart: 4 };
  expect(detectSemPerdaoTableEvents(beforeA, afterA, options))
    .toEqual(detectSemPerdaoTableEvents(beforeB, afterB, options));
});

test('session não repete snapshot nem evento já aceito', () => {
  const session = new SemPerdaoExperienceSession('room:ABCD', {});
  const first = publicView();
  expect(session.accept(first).map((event) => event.kind)).toEqual(['sem-perdao.round.started']);
  expect(session.accept({ ...first }).length).toBe(0);
  const judging = publicView({ phase: 'judging', phaseId: 'phase-judging-1', stateRevision: 2 });
  expect(session.accept(judging).map((event) => event.kind)).toEqual(['sem-perdao.judgment.started']);
  expect(session.accept({ ...judging }).length).toBe(0);
  session.dispose();
});

test('projeção host pode conter segredos, mas eventos não carregam mão, deck, voto ou autoria', () => {
  const secret = 'SEGREDO-NUNCA-NO-EVENTO';
  const state: GameState = {
    phase: 'judging', mode: 'judge', round: 1, scoreLimit: 7, czarId: 3,
    players: [1, 2, 3].map((id) => ({
      id, name: `P${id}`, isHuman: true, connected: true, score: 0,
      hand: [{ id: `hand-${id}`, text: `${secret}-HAND-${id}` }], eliminated: false,
    })),
    blackCard: { id: 'black-1', text: 'Pergunta ____', pick: 1 },
    submissions: [{ playerId: 1, cards: [{ id: 'submitted-secret', text: secret }] }],
    votes: [{ voterId: 2, submissionIndex: 0 }], votingOptions: [0], votingRound: 1,
    tieBreak: false, revealed: [], phaseStartedAt: 2_000, phaseId: 'phase-secret-test',
    stateRevision: 9, roundWinnerId: null, winner: null,
    blackPool: [{ id: 'pool-secret', text: `${secret}-BLACK`, pick: 1 }],
    whitePool: [{ id: 'pool-white', text: `${secret}-POOL` }],
    blackDeck: [{ id: 'deck-secret', text: `${secret}-DECK`, pick: 1 }],
    whiteDeck: [{ id: 'deck-white', text: `${secret}-WHITE-DECK` }],
  };
  const events = detectSemPerdaoTableEvents(null, projectMesaView(state, 1), {
    roomSessionId: 'room:SAFE',
  });
  const serialized = JSON.stringify(events);
  expect(serialized).not.toContain(secret);
  expect(serialized).not.toMatch(/"(?:hand|blackDeck|whiteDeck|votes|playerId|cards)"/u);
});

function gameEndEvent(winnerId: number, seats = publicView().seats) {
  const before = publicView({ phase: 'round-end', phaseId: 'phase-result-3', seats });
  const after = publicView({
    phase: 'game-end', phaseId: 'phase-game-end', stateRevision: 9,
    winnerIds: [winnerId], gameWinnerId: winnerId,
    seats: seats.map((seat) => ({ ...seat, isGameWinner: seat.id === winnerId })),
  });
  const [event] = detectSemPerdaoTableEvents(before, after, { roomSessionId: 'room:ABCD' });
  return event;
}

test('o velório derruba todo mundo menos o vencedor, na ordem dos assentos', () => {
  const event = gameEndEvent(2);
  expect(event.kind).toBe('sem-perdao.game.finished');
  // ordem por ID de assento, não pela rotação local de quem está olhando
  expect(event.payload.loserActorIds).toEqual(['player:1', 'player:3']);
  expect(event.payload.winnerActorIds).toEqual(['player:2']);

  const beats = SEM_PERDAO_EXPERIENCE_DIRECTOR.plan(event);
  const quedas = beats.filter((beat) => beat.channel === 'actor' && beat.cue === 'collapse');
  expect(quedas.map((beat) => beat.actorId)).toEqual(['player:1', 'player:3']);
  // escalonadas: uma tomba depois da outra, nunca todas de uma vez
  expect(new Set(quedas.map((beat) => beat.delayMs)).size).toBe(2);
  // o tombo é terminal: nada de duração que devolva o ator ao idle
  expect(quedas.every((beat) => beat.durationMs === null)).toBe(true);

  const plano = beats.find((beat) => beat.cue === 'final.wide');
  expect(plano?.actorId).toBe('player:2');
  // a câmera só revela o sobrevivente DEPOIS do último corpo cair
  expect(plano!.delayMs).toBeGreaterThan(Math.max(...quedas.map((beat) => beat.delayMs)));

  const celebra = beats.find((beat) => beat.channel === 'actor' && beat.cue === 'celebrate');
  expect(celebra?.actorId).toBe('player:2');
  expect(celebra!.delayMs).toBeGreaterThan(plano!.delayMs);
});

test('empate condena a mesa inteira e o painel 2D só entra depois do teatro', () => {
  const seats = publicView().seats;
  const before = publicView({ phase: 'round-end', phaseId: 'phase-result-3' });
  const after = publicView({
    phase: 'game-end', phaseId: 'phase-game-end', stateRevision: 9, winnerIds: [],
  });
  const [event] = detectSemPerdaoTableEvents(before, after, { roomSessionId: 'room:ABCD' });
  expect(event.payload.outcome).toBe('draw');
  expect(event.payload.loserActorIds).toEqual(['player:1', 'player:2', 'player:3']);

  const beats = SEM_PERDAO_EXPERIENCE_DIRECTOR.plan(event);
  // sem vencedor não há plano do sobrevivente nem comemoração
  expect(beats.some((beat) => beat.cue === 'final.wide')).toBe(false);
  expect(beats.some((beat) => beat.cue === 'celebrate')).toBe(false);

  const tempo = semPerdaoFinaleTiming(seats.length);
  const ultimo = Math.max(...beats.map((beat) => beat.delayMs));
  expect(tempo.fim).toBeGreaterThan(ultimo);
});

test('mesa cheia encurta o passo em vez de esticar o velório', () => {
  const cheia = semPerdaoFinaleTiming(7);
  const magra = semPerdaoFinaleTiming(2);
  expect(cheia.passo).toBeLessThan(magra.passo);
  // sete condenados não podem custar mais que o dobro de dois
  expect(cheia.fim).toBeLessThan(magra.fim * 2);
  // zero condenados não pode gerar atraso negativo nem NaN
  expect(semPerdaoFinaleTiming(0).ultimaQueda).toBe(semPerdaoFinaleTiming(0).primeiraQueda);
});

test('resultado real vira câmera, ator, VFX, áudio e HUD', () => {
  const before = publicView({ phase: 'judging', phaseId: 'phase-judging-1' });
  const after = publicView({
    phase: 'round-end', phaseId: 'phase-result-1', stateRevision: 3,
    roundWinnerId: 2,
    proofs: [{ id: 'round:1:proof:0', submissionIndex: 0, state: 'revealed', cardCount: 1, cards: [], owner: { id: 2, name: 'B' }, isWinner: true }],
  });
  const [event] = detectSemPerdaoTableEvents(before, after, { roomSessionId: 'room:ABCD' });
  const channels = new Set(SEM_PERDAO_EXPERIENCE_DIRECTOR.plan(event).map((beat) => beat.channel));
  expect(channels).toEqual(new Set(['camera', 'actor', 'vfx', 'audio', 'hud']));
});
