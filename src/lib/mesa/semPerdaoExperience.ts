import type { ActorIntent, ActorIntentCommand } from './actorContract';
import { isActorIntent } from './actorContract';
import { ExperienceDirector, type ExperienceChannel, type ExperienceRule } from './experienceDirector';
import { ExperienceRuntime, type ExperienceCueExecutor } from './experienceRuntime';
import { createTableEvent, TableEventJournal, type TableEvent } from './tableEvents';
import type { MesaView } from '../three/mesaView';

export const SEM_PERDAO_GAME_ID = 'sem-perdao' as const;

const ROUND_LINES = [
  'QUEM ESCREVEU ESSA PERGUNTA?',
  'EU JÁ QUERO TROCAR DE ADVOGADO.',
  'NINGUÉM ASSINA ESSA ATA.',
  'O PORÃO FICOU MAIS FRIO.',
  'ÚLTIMA RODADA. SEM CHORO.',
] as const;

const REVEAL_LINES = [
  'ISSO É PROVA OU PEDIDO DE SOCORRO?',
  'EU NÃO QUERO SER ASSOCIADO A ISSO.',
  'MERITÍSSIMO, PODE PRENDER.',
  'O RH JÁ FOI EMBORA, NÉ?',
  'CINEMA. ABSOLUTO CINEMA.',
  'ESSA ATA VAI SUMIR.',
] as const;

export type SemPerdaoCameraAct = 'table' | 'pov' | 'proofs' | 'judge' | 'overhead';
export type SemPerdaoMusicScene = 'lobby' | 'tension' | 'finale';
export type SemPerdaoNarrationCue = 'guilty' | 'round-open' | 'judging' | 'finale';
/**
 * `gavel` é semântico de propósito: a engine pede "o martelo do juiz", e o jogo
 * decide que isso são três batidas. Quantas e com que intervalo é direção, não
 * regra — e o Coup pode traduzir o mesmo cue pra outra coisa.
 */
export type SemPerdaoSoundCue = 'turn' | 'flip' | 'collapse' | 'gavel';

export interface SemPerdaoExperiencePorts {
  camera: {
    setAct(act: SemPerdaoCameraAct): void;
    focusProof(index: number): void;
    closeActor(actorId: string): void;
    /** Plano aberto do sobrevivente: precisa mostrar os caídos junto. */
    finalWide(actorId: string): void;
  };
  actor: {
    play(actorId: string, command: ActorIntentCommand): void;
    speak(actorId: string, line: string): void;
  };
  vfx: {
    verdict(proofId: string | null): void;
    pulse(intensity: number): void;
  };
  audio: {
    music(scene: SemPerdaoMusicScene): void;
    narrate(cue: SemPerdaoNarrationCue): void;
    /** Pode devolver um cancelador quando o cue agenda som no futuro. */
    sound(cue: SemPerdaoSoundCue): void | (() => void);
  };
  hud: {
    cue(cue: string, actorId: string | null, payload: Readonly<Record<string, unknown>>): void;
  };
}

interface PendingEvent {
  kind: string;
  key: string;
  actorId?: string | null;
  targetId?: string | null;
  payload?: Record<string, unknown>;
}

export interface DetectSemPerdaoEventsOptions {
  roomSessionId: string;
  sequenceStart?: number;
  gameId?: string;
}

function playerActorId(playerId: number | null): string | null {
  return playerId === null ? null : `player:${playerId}`;
}

function stableHash(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function eventId(roomSessionId: string, phaseId: string, kind: string, key: string): string {
  const source = `${roomSessionId}\u241f${phaseId}\u241f${kind}\u241f${key}`;
  const reverse = [...source].reverse().join('');
  return `sp-event-${stableHash(source).toString(36)}-${stableHash(reverse).toString(36)}`;
}

function deterministicSpeaker(view: MesaView, salt: string): string | null {
  const candidates = view.seats
    .filter((seat) => seat.connected && !seat.eliminated && seat.id !== view.judgeId)
    .map((seat) => seat.id)
    .sort((left, right) => left - right);
  if (!candidates.length) return playerActorId(view.judgeId);
  return playerActorId(candidates[stableHash(`${view.phaseId}:${salt}`) % candidates.length]);
}

/**
 * Detecta somente diferenças presentes em `MesaView`, a projeção pública do
 * jogo. IDs e seeds não dependem da ordem local dos assentos nem de relógio ou
 * aleatoriedade, então clientes que viram a mesma transição produzem o mesmo
 * evento audiovisual.
 */
export function detectSemPerdaoTableEvents(
  previous: MesaView | null,
  current: MesaView,
  options: DetectSemPerdaoEventsOptions
): readonly TableEvent[] {
  const pending: PendingEvent[] = [];
  const initial = previous === null;
  const changedRound = previous !== null && previous.round !== current.round;
  const entered = (phase: MesaView['phase']) => current.phase === phase && (
    initial || previous.phase !== phase || changedRound
  );

  if (current.phase === 'submitting' && (
    entered('submitting') || (previous !== null && previous.phaseId !== current.phaseId)
  )) {
    pending.push({
      kind: 'sem-perdao.round.started',
      key: `round:${current.round}`,
      actorId: deterministicSpeaker(current, `round:${current.round}`),
      targetId: playerActorId(current.judgeId),
      payload: { round: current.round, mode: current.mode, initial, restarted: !initial && !changedRound },
    });
  }

  if (entered('judging') || (
    current.phase === 'judging'
    && previous !== null
    && previous.judgeId !== current.judgeId
    && current.votingRound === previous.votingRound
  )) {
    pending.push({
      kind: 'sem-perdao.judgment.started',
      key: `judgment:${current.round}:${current.votingRound}`,
      actorId: playerActorId(current.judgeId) ?? deterministicSpeaker(current, 'judgment'),
      payload: {
        round: current.round,
        mode: current.mode,
        proofCount: current.proofs.length,
        votingRound: current.votingRound,
        initial,
      },
    });
  }

  if (
    previous !== null
    && previous.phase === 'judging'
    && current.phase === 'judging'
    && current.round === previous.round
  ) {
    const oldProofs = new Map(previous.proofs.map((proof) => [proof.id, proof.state]));
    const newlyRevealed = current.proofs
      .filter((proof) => proof.state === 'revealed' && oldProofs.get(proof.id) !== 'revealed')
      .sort((left, right) => left.submissionIndex - right.submissionIndex);
    newlyRevealed.forEach((proof, ordinal) => pending.push({
      kind: 'sem-perdao.proof.revealed',
      key: proof.id,
      actorId: deterministicSpeaker(current, proof.id),
      targetId: proof.id,
      payload: {
        round: current.round,
        proofId: proof.id,
        proofIndex: proof.submissionIndex,
        ordinal,
      },
    }));

    if (current.votingRound > previous.votingRound) {
      pending.push({
        kind: 'sem-perdao.vote.runoff',
        key: `vote:${current.round}:${current.votingRound}`,
        actorId: deterministicSpeaker(current, `runoff:${current.votingRound}`),
        payload: { round: current.round, votingRound: current.votingRound },
      });
    }
  }

  if (previous !== null && current.phase === 'submitting' && previous.phase === 'submitting') {
    const oldSeats = new Map(previous.seats.map((seat) => [seat.id, seat]));
    current.seats
      .filter((seat) => seat.submitted && oldSeats.get(seat.id)?.submitted === false)
      .sort((left, right) => left.id - right.id)
      .forEach((seat) => pending.push({
        kind: 'sem-perdao.submission.received',
        key: `submission:${current.round}:${seat.id}:${current.stateRevision}`,
        actorId: playerActorId(seat.id),
        payload: { round: current.round },
      }));
  }

  if (entered('round-end')) {
    const winningProof = current.proofs.find((proof) => proof.isWinner)?.id ?? null;
    pending.push({
      kind: 'sem-perdao.round.decided',
      key: `result:${current.round}:${current.roundWinnerId ?? 'draw'}`,
      actorId: playerActorId(current.roundWinnerId),
      targetId: winningProof,
      payload: {
        round: current.round,
        outcome: current.roundWinnerId === null ? 'draw' : 'winner',
        tieBreak: current.tieBreak,
        proofId: winningProof,
      },
    });
  }

  if (entered('game-end')) {
    const winners = new Set(current.winnerIds);
    const winnerActorIds = [...current.winnerIds]
      .sort((left, right) => left - right)
      .map((id) => playerActorId(id) as string);
    // Quem não venceu tomba no ato final. É informação pública (o placar já
    // está aberto no game-end) e a ordem por assento mantém a queda idêntica
    // em todos os clientes, inclusive em quem reconecta no meio do velório.
    const loserActorIds = current.seats
      .map((seat) => seat.id)
      .filter((id) => !winners.has(id))
      .sort((left, right) => left - right)
      .map((id) => playerActorId(id) as string);
    pending.push({
      kind: 'sem-perdao.game.finished',
      key: `game:${current.round}:${winnerActorIds.join(',') || 'draw'}`,
      actorId: winnerActorIds[0] ?? null,
      payload: {
        round: current.round,
        outcome: winnerActorIds.length === 1 ? 'winner' : 'draw',
        winnerActorIds,
        loserActorIds,
      },
    });
  }

  if (previous !== null) {
    const oldSeats = new Map(previous.seats.map((seat) => [seat.id, seat]));
    current.seats
      .filter((seat) => oldSeats.has(seat.id) && oldSeats.get(seat.id)?.connected !== seat.connected)
      .sort((left, right) => left.id - right.id)
      .forEach((seat) => pending.push({
        kind: seat.connected
          ? 'sem-perdao.presence.reconnected'
          : 'sem-perdao.presence.disconnected',
        key: `presence:${seat.id}:${seat.connected ? 1 : 0}:${current.stateRevision}`,
        actorId: playerActorId(seat.id),
        payload: { connected: seat.connected },
      }));
  }

  const sequenceStart = Math.max(0, options.sequenceStart ?? 0);
  return Object.freeze(pending.map((descriptor, index) => createTableEvent({
    id: eventId(options.roomSessionId, current.phaseId, descriptor.kind, descriptor.key),
    roomSessionId: options.roomSessionId,
    gameId: options.gameId ?? SEM_PERDAO_GAME_ID,
    sequence: sequenceStart + index,
    kind: descriptor.kind,
    occurredAt: Math.max(0, current.phaseStartedAt),
    actorId: descriptor.actorId,
    targetId: descriptor.targetId,
    payload: descriptor.payload ?? {},
  })));
}

/**
 * Cronograma do ato final, derivado só da quantidade de condenados. Vive aqui
 * porque a UI 2D precisa esperar o teatro 3D terminar: se cada camada tivesse
 * sua própria constante, o painel de encerramento voltaria a cobrir a cena
 * assim que alguém mexesse no ritmo da queda.
 */
export function semPerdaoFinaleTiming(loserCount: number) {
  const condenados = Math.max(0, Math.floor(loserCount) || 0);
  // Mesa cheia não pode esticar o velório: encurta o passo, não o ato.
  const passo = condenados > 4 ? 210 : 300;
  const primeiraQueda = 700;
  const ultimaQueda = primeiraQueda + Math.max(0, condenados - 1) * passo;
  const revelacao = ultimaQueda + 620;
  return Object.freeze({
    passo,
    primeiraQueda,
    ultimaQueda,
    revelacao,
    narracao: revelacao + 260,
    celebracao: revelacao + 420,
    /** Quando o painel 2D pode entrar sem atropelar o plano do sobrevivente. */
    fim: revelacao + 1_400,
  });
}

function actorList(value: unknown): readonly string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string' && entry.length >= 4)
    : [];
}

function eventRules(): readonly ExperienceRule[] {
  return [
    {
      id: 'sem-perdao-round-open',
      event: 'sem-perdao.round.started',
      beats: (event) => {
        const round = Number(event.payload.round) || 1;
        const initial = event.payload.initial === true;
        return [
          { channel: 'camera', cue: 'act.pov', priority: 70, interrupt: 'channel' },
          { channel: 'audio', cue: 'music.lobby', priority: 20 },
          { channel: 'audio', cue: 'sound.turn', priority: 25 },
          { channel: 'actor', cue: 'speak', actor: 'actor', delayMs: 900, durationMs: 1_200, payload: { line: ROUND_LINES[(round - 1) % ROUND_LINES.length] } },
          ...initial ? [] : [
            { channel: 'audio' as const, cue: 'narration.round-open', priority: 30 },
            { channel: 'hud' as const, cue: 'announce.round', payload: { round } },
          ],
        ];
      },
    },
    {
      id: 'sem-perdao-judgment-open',
      event: 'sem-perdao.judgment.started',
      beats: [
        { channel: 'camera', cue: 'act.overhead', priority: 80, interrupt: 'channel' },
        { channel: 'camera', cue: 'act.proofs', delayMs: 900, priority: 60, interrupt: 'channel' },
        { channel: 'actor', cue: 'point', actor: 'actor', durationMs: 1_200, priority: 40 },
        { channel: 'audio', cue: 'music.tension', priority: 30 },
        // Sessão aberta: martelo primeiro, narrador depois. Se os dois saem
        // juntos a fala some embaixo das batidas.
        { channel: 'audio', cue: 'sound.gavel', priority: 50 },
        { channel: 'audio', cue: 'narration.judging', delayMs: 1_100, priority: 35 },
        { channel: 'hud', cue: 'announce.judgment' },
      ],
    },
    {
      id: 'sem-perdao-proof-reveal',
      event: 'sem-perdao.proof.revealed',
      beats: (event) => {
        const ordinal = Number(event.payload.ordinal) || 0;
        return [
          { channel: 'camera', cue: 'proof.focus', priority: 95, interrupt: 'channel', payload: { proofIndex: event.payload.proofIndex } },
          { channel: 'vfx', cue: 'proof.pulse', priority: 50, payload: { intensity: 0.08 } },
          { channel: 'audio', cue: 'sound.flip', priority: 40 },
          { channel: 'actor', cue: 'speak', actor: 'actor', delayMs: 700, durationMs: 1_200, interrupt: 'channel', payload: { line: REVEAL_LINES[ordinal % REVEAL_LINES.length] } },
        ];
      },
    },
    {
      id: 'sem-perdao-runoff',
      event: 'sem-perdao.vote.runoff',
      beats: [
        { channel: 'camera', cue: 'act.overhead', priority: 85, interrupt: 'channel' },
        { channel: 'actor', cue: 'facepalm', actor: 'actor', priority: 45, durationMs: 1_500 },
        { channel: 'hud', cue: 'announce.runoff' },
      ],
    },
    {
      id: 'sem-perdao-submitted',
      event: 'sem-perdao.submission.received',
      beats: [{ channel: 'actor', cue: 'clap', actor: 'actor', priority: 15, durationMs: 900 }],
    },
    {
      id: 'sem-perdao-round-result',
      event: 'sem-perdao.round.decided',
      beats: (event) => [
        { channel: 'camera', cue: 'act.judge', priority: 100, interrupt: 'channel' },
        { channel: 'vfx', cue: 'verdict', priority: 95, payload: { proofId: event.payload.proofId } },
        { channel: 'camera', cue: 'actor.close', actor: 'actor', delayMs: 280, priority: 90, interrupt: 'channel' },
        { channel: 'actor', cue: 'celebrate', actor: 'actor', delayMs: 850, priority: 55, durationMs: 1_200 },
        { channel: 'audio', cue: 'narration.guilty', priority: 60 },
        { channel: 'hud', cue: event.payload.outcome === 'draw' ? 'announce.draw' : 'announce.winner', actor: 'actor', payload: { tieBreak: event.payload.tieBreak } },
      ],
    },
    {
      /**
       * O velório. A sala apaga, os condenados tombam um a um na ordem dos
       * assentos e a câmera corta para quem sobrou de pé no facho. O
       * escalonamento é derivado só do payload, então todo mundo na sala vê a
       * mesma queda na mesma ordem sem precisar sincronizar relógio.
       */
      id: 'sem-perdao-game-finished',
      event: 'sem-perdao.game.finished',
      beats: (event) => {
        const winnerActorIds = actorList(event.payload.winnerActorIds);
        const loserActorIds = actorList(event.payload.loserActorIds);
        const tempo = semPerdaoFinaleTiming(loserActorIds.length);
        return [
          { channel: 'camera', cue: 'act.overhead', priority: 100, interrupt: 'all' },
          { channel: 'audio', cue: 'music.finale', priority: 80 },
          { channel: 'hud', cue: event.payload.outcome === 'draw' ? 'announce.game-draw' : 'announce.game' },
          ...loserActorIds.flatMap((actor, index) => {
            const delayMs = tempo.primeiraQueda + index * tempo.passo;
            return [
              { channel: 'actor' as const, cue: 'collapse', actor, delayMs, priority: 90, durationMs: null },
              { channel: 'audio' as const, cue: 'sound.collapse', delayMs, priority: 45 },
            ];
          }),
          // Empate não tem sobrevivente: a mesa inteira tomba sob o plano
          // zenital e ninguém acende. Emitir o corte mesmo assim criaria um
          // beat morto que ainda assim interromperia o canal de câmera.
          ...winnerActorIds.length ? [{
            channel: 'camera' as const, cue: 'final.wide', actor: winnerActorIds[0],
            delayMs: tempo.revelacao, priority: 100, interrupt: 'channel' as const,
          }] : [],
          { channel: 'audio', cue: 'narration.finale', delayMs: tempo.narracao, priority: 85 },
          ...winnerActorIds.map((actor) => ({ channel: 'actor' as const, cue: 'celebrate', actor, delayMs: tempo.celebracao, priority: 70, durationMs: 1_500 })),
        ];
      },
    },
    {
      id: 'sem-perdao-disconnected',
      event: 'sem-perdao.presence.disconnected',
      beats: [{ channel: 'actor', cue: 'sleep', actor: 'actor', priority: 80, payload: { line: 'CONEXÃO PERDIDA' } }],
    },
    {
      id: 'sem-perdao-reconnected',
      event: 'sem-perdao.presence.reconnected',
      beats: [{ channel: 'actor', cue: 'celebrate', actor: 'actor', priority: 80, durationMs: 1_200, payload: { line: 'VOLTEI DO ALÉM' } }],
    },
  ];
}

export const SEM_PERDAO_EXPERIENCE_DIRECTOR = new ExperienceDirector(eventRules());

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function createSemPerdaoExperienceExecutors(
  ports: SemPerdaoExperiencePorts
): Partial<Record<ExperienceChannel, ExperienceCueExecutor>> {
  return {
    camera: (beat) => {
      const acts: Record<string, SemPerdaoCameraAct> = {
        'act.table': 'table', 'act.pov': 'pov', 'act.proofs': 'proofs',
        'act.judge': 'judge', 'act.overhead': 'overhead',
      };
      if (acts[beat.cue]) ports.camera.setAct(acts[beat.cue]);
      else if (beat.cue === 'proof.focus') {
        const index = finiteNumber(beat.payload.proofIndex);
        if (index !== null) ports.camera.focusProof(index);
      } else if (beat.cue === 'actor.close' && beat.actorId) ports.camera.closeActor(beat.actorId);
      else if (beat.cue === 'final.wide' && beat.actorId) ports.camera.finalWide(beat.actorId);
    },
    actor: (beat) => {
      if (!beat.actorId || !isActorIntent(beat.cue)) return;
      ports.actor.play(beat.actorId, {
        intent: beat.cue as ActorIntent,
        priority: beat.priority,
        intensity: 1,
        durationMs: beat.durationMs,
        seed: stableHash(beat.id),
        sourceEventId: beat.eventId,
      });
      if (typeof beat.payload.line === 'string') ports.actor.speak(beat.actorId, beat.payload.line);
    },
    vfx: (beat) => {
      if (beat.cue === 'verdict') {
        ports.vfx.verdict(typeof beat.payload.proofId === 'string' ? beat.payload.proofId : null);
      } else if (beat.cue === 'proof.pulse') {
        ports.vfx.pulse(finiteNumber(beat.payload.intensity) ?? 0.08);
      }
    },
    audio: (beat) => {
      if (beat.cue === 'music.lobby') ports.audio.music('lobby');
      else if (beat.cue === 'music.tension') ports.audio.music('tension');
      else if (beat.cue === 'music.finale') ports.audio.music('finale');
      else if (beat.cue === 'narration.round-open') ports.audio.narrate('round-open');
      else if (beat.cue === 'narration.judging') ports.audio.narrate('judging');
      else if (beat.cue === 'narration.guilty') ports.audio.narrate('guilty');
      else if (beat.cue === 'narration.finale') ports.audio.narrate('finale');
      else if (beat.cue === 'sound.turn') ports.audio.sound('turn');
      else if (beat.cue === 'sound.flip') ports.audio.sound('flip');
      else if (beat.cue === 'sound.collapse') ports.audio.sound('collapse');
      // Devolve o cancelador do port: a rajada tem batidas agendadas e o runtime
      // precisa poder abortá-las se a cena for interrompida ou descartada.
      else if (beat.cue === 'sound.gavel') return ports.audio.sound('gavel');
    },
    hud: (beat) => ports.hud.cue(beat.cue, beat.actorId, beat.payload),
  };
}

/** Estado efêmero de uma montagem da cena; `dispose` cancela todos os delays. */
export class SemPerdaoExperienceSession {
  private previous: MesaView | null = null;
  private readonly journal: TableEventJournal;
  private readonly runtime: ExperienceRuntime;

  constructor(
    roomSessionId: string,
    executors: Partial<Record<ExperienceChannel, ExperienceCueExecutor>>
  ) {
    this.journal = new TableEventJournal(roomSessionId, SEM_PERDAO_GAME_ID, 512);
    this.runtime = new ExperienceRuntime(executors);
  }

  accept(view: MesaView): readonly TableEvent[] {
    if (
      this.previous
      && view.stateRevision > 0
      && this.previous.stateRevision > view.stateRevision
    ) return [];
    const events = detectSemPerdaoTableEvents(this.previous, view, {
      roomSessionId: this.journal.roomSessionId,
      sequenceStart: this.journal.latestSequence() + 1,
    });
    this.previous = view;
    const accepted: TableEvent[] = [];
    for (const event of events) {
      if (!this.journal.accept(event)) continue;
      accepted.push(event);
      this.runtime.run(SEM_PERDAO_EXPERIENCE_DIRECTOR.plan(event));
    }
    return Object.freeze(accepted);
  }

  dispose(): void {
    this.runtime.dispose();
    this.previous = null;
  }
}
