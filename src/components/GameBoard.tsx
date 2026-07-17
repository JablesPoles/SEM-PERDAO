'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ChatMessage, GameState, Reaction, Submission, WhiteCard } from '../lib/types';
import {
  fillBlanks,
  getActivePlayers,
  getGameMode,
  JUDGE_SECONDS,
  SUBMIT_SECONDS,
  voteCountFor,
  votingChoicesFor,
} from '../lib/game';
import { isMuted, playSound, setMuted } from '../lib/sounds';
import { avatarColor, initials } from './avatar';

interface GameBoardProps {
  state: GameState;
  myId: number;
  onSubmit: (cardIds: string[]) => void;
  onReveal: (index: number) => void;
  onJudge: (index: number) => void;
  onVote: (index: number, phaseStartedAt: number) => void;
  onNextRound: () => void;
  onRestart: () => void;
  reactions: Reaction[];
  messages: ChatMessage[];
  onReact: (emoji: string) => void;
}

// Realça as respostas «entre aspas» em vermelho dentro da frase montada.
function Highlighted({ text }: { text: string }) {
  const parts = text.split(/(«[^»]*»)/g);
  return (
    <>
      {parts.map((p, i) =>
        p.startsWith('«') ? (
          <span key={i} className="text-red">{p.slice(1, -1)}</span>
        ) : (
          <span key={i}>{p}</span>
        )
      )}
    </>
  );
}

function BlackCardView({ text }: { text: string }) {
  return (
    <div className="card-black card-in rounded-xl p-5 sm:p-6 w-full max-w-md mx-auto">
      <div className="w-6 h-1.5 bg-red mb-4" />
      <p className="font-display text-lg sm:text-xl leading-snug">
        <Highlighted text={text} />
      </p>
      <div className="flex justify-between items-end mt-5">
        <span className="text-[10px] font-bold tracking-[0.18em] text-paper/40">PERGUNTA</span>
        <span className="font-display text-red text-sm">SP*</span>
      </div>
    </div>
  );
}

// Rotação sutil determinística — cartas "jogadas na mesa", iguais pra todos.
function cardTilt(id: string): number {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return ((h % 9) - 4) * 0.5;
}

function WhiteCardView({
  card,
  index = 0,
  order,
  selected,
  dimmed,
  onClick,
}: {
  card: WhiteCard;
  index?: number;
  order?: number;
  selected?: boolean;
  dimmed?: boolean;
  onClick?: () => void;
}) {
  return (
    <div
      className="card-in"
      style={{ transform: `rotate(${cardTilt(card.id)}deg)`, animationDelay: `${index * 45}ms` }}
    >
      <button
        onClick={onClick}
        disabled={!onClick}
        className={[
          'card-white relative w-full rounded-[10px] p-3.5 text-left transition-all min-h-[92px] flex flex-col justify-between',
          onClick ? 'hover:-translate-y-1 hover:shadow-lg active:scale-[0.97]' : 'cursor-default',
          selected ? 'ring-4 ring-red -translate-y-1.5 shadow-xl' : '',
          dimmed ? 'opacity-35' : '',
        ].join(' ')}
      >
        <span className="font-bold text-[13.5px] leading-snug">{card.text}</span>
        <span className="text-[9px] font-bold tracking-[0.18em] text-gray mt-2">RESPOSTA</span>
        {selected && order !== undefined && (
          <span className="absolute -top-2 -right-2 w-6 h-6 bg-red text-white text-xs font-black rounded-full flex items-center justify-center shadow">
            {order + 1}
          </span>
        )}
      </button>
    </div>
  );
}

function SubmissionView({
  gs,
  submission,
  ownerName,
  winner,
  voteCount,
}: {
  gs: GameState;
  submission: Submission;
  ownerName?: string;
  winner?: boolean;
  voteCount?: number;
}) {
  const text = gs.blackCard ? fillBlanks(gs.blackCard, submission.cards) : '';
  return (
    <div className={`card-white w-full rounded-[10px] p-4 text-left ${winner ? 'ring-4 ring-red' : ''}`}>
      <p className="font-bold text-[14px] leading-snug"><Highlighted text={text} /></p>
      {ownerName && (
        <p className={`text-[11px] font-bold mt-2 tracking-wide ${winner ? 'text-red' : 'text-gray'}`}>
          {winner ? '☠ ' : ''}{ownerName.toUpperCase()}
        </p>
      )}
      {voteCount !== undefined && (
        <p className={`mt-2 text-[10.5px] font-black tracking-wide ${winner ? 'text-red' : 'text-gray'}`}>
          🗳 {voteCount} VOTO{voteCount === 1 ? '' : 'S'}
        </p>
      )}
    </div>
  );
}

// Prova no julgamento: lacrada até o juiz virar — o flip sai na tela de todos.
function JudgingCard({
  gs,
  submission,
  revealed,
  canFlip,
  selected,
  selectable,
  own,
  onFlip,
  onSelect,
}: {
  gs: GameState;
  submission: Submission;
  revealed: boolean;
  canFlip: boolean;
  selected: boolean;
  selectable: boolean;
  own?: boolean;
  onFlip: () => void;
  onSelect: () => void;
}) {
  if (!revealed) {
    return (
      <button
        onClick={canFlip ? onFlip : undefined}
        disabled={!canFlip}
        className={[
          'card-back-sp w-full rounded-[10px] px-4 py-5 flex items-center justify-center gap-3 transition-all',
          canFlip ? 'hover:border-red active:scale-[0.99] cursor-pointer' : 'cursor-default',
        ].join(' ')}
      >
        <span className="font-display text-red text-2xl leading-none">*</span>
        <span className="text-paper/55 text-[11px] font-bold tracking-[0.18em]">
          {canFlip ? 'TOQUE PRA REVELAR A PROVA' : 'PROVA LACRADA'}
        </span>
      </button>
    );
  }
  const text = gs.blackCard ? fillBlanks(gs.blackCard, submission.cards) : '';
  return (
    <button
      onClick={selectable ? onSelect : undefined}
      disabled={!selectable}
      className={[
        'card-white reveal-in w-full rounded-[10px] p-4 text-left transition-all',
        selectable ? 'hover:-translate-y-0.5 active:scale-[0.99]' : 'cursor-default',
        selected ? 'ring-4 ring-red -translate-y-0.5' : '',
        own ? 'ring-2 ring-white/20' : '',
      ].join(' ')}
    >
      <p className="font-bold text-[14.5px] leading-snug"><Highlighted text={text} /></p>
      {own && (
        <span className="mt-2 block text-[9.5px] font-black tracking-[0.15em] text-red">
          SUA CARTA · NÃO VALE ROUBAR
        </span>
      )}
    </button>
  );
}

// Relógio da fase, sincronizado pelo phaseStartedAt do host. Nos últimos 10s
// faz tique-taque — só pra quem ainda precisa agir.
function PhaseTimer({ startedAt, seconds, ticking }: { startedAt: number; seconds: number; ticking: boolean }) {
  const [left, setLeft] = useState(seconds);
  const lastTickRef = useRef(-1);

  useEffect(() => {
    const update = () => {
      const l = Math.max(0, seconds - (Date.now() - startedAt) / 1000);
      setLeft(l);
      if (ticking && l > 0 && l <= 10) {
        const s = Math.ceil(l);
        if (s !== lastTickRef.current) {
          lastTickRef.current = s;
          playSound('tick');
        }
      }
    };
    update();
    const id = setInterval(update, 200);
    return () => clearInterval(id);
  }, [startedAt, seconds, ticking]);

  const pct = Math.max(0, Math.min(100, (left / seconds) * 100));
  const low = left <= 10;
  return (
    <div className="max-w-3xl w-full mx-auto px-4 pt-1 flex items-center gap-2">
      <div className="flex-1 h-1 rounded-full bg-white/10 overflow-hidden">
        <div
          className={`h-full rounded-full transition-[width] duration-200 ${low ? 'bg-red animate-pulse' : 'bg-paper/40'}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className={`text-[10px] font-bold tabular-nums w-7 text-right ${low ? 'text-red' : 'text-paper/40'}`}>
        {Math.ceil(left)}s
      </span>
    </div>
  );
}

// Resumo da entrega; o detalhe de quem já jogou fica vivo na barra lateral.
function SubmitStatus({ gs }: { gs: GameState }) {
  const players = getActivePlayers(gs.players).filter(
    (player) => getGameMode(gs) === 'democracy' || player.id !== gs.czarId
  );
  const submitted = players.filter((p) =>
    gs.submissions.some((submission) => submission.playerId === p.id)
  ).length;
  const pct = players.length ? (submitted / players.length) * 100 : 100;
  return (
    <div className="w-full max-w-[220px] flex flex-col gap-2">
      <div className="flex items-baseline justify-between text-[10px] font-bold tracking-wide">
        <span className="text-paper/45">PROVAS ENTREGUES</span>
        <span className={submitted === players.length ? 'text-ok' : 'text-paper/70'}>
          {submitted}/{players.length}
        </span>
      </div>
      <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
        <div
          className={`h-full rounded-full transition-[width] duration-300 ${submitted === players.length ? 'bg-ok' : 'bg-red'}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

const REACTION_EMOJIS = [
  { emoji: '💀', label: 'Morri' },
  { emoji: '🤣', label: 'Rindo muito' },
  { emoji: '🤡', label: 'Palhaço' },
  { emoji: '🗿', label: 'Chad de pedra' },
  { emoji: '🤮', label: 'Que nojo' },
  { emoji: '👀', label: 'De olho' },
  { emoji: '🫠', label: 'Derretendo' },
  { emoji: '🤨', label: 'Suspeito' },
  { emoji: '💅', label: 'Serviu' },
  { emoji: '🍿', label: 'Só assistindo' },
  { emoji: '🚩', label: 'Red flag' },
  { emoji: '🔥', label: 'Pegou fogo' },
  { emoji: '😭', label: 'Chorando' },
  { emoji: '🤌', label: 'Cinema' },
  { emoji: '🧢', label: 'É mentira' },
  { emoji: '🫡', label: 'Foi de base' },
  { emoji: '👏', label: 'Palmas' },
  { emoji: '🫣', label: 'Nem vi' },
] as const;

const QUICK_REACTIONS = REACTION_EMOJIS.slice(0, 6);
const REACTION_LIFETIME_MS = 2800;
const MESSAGE_LIFETIME_MS = 5200;

function PlayerRail({
  gs,
  myId,
  reactions,
  messages,
}: {
  gs: GameState;
  myId: number;
  reactions: Reaction[];
  messages: ChatMessage[];
}) {
  const [now, setNow] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, []);

  const players = getActivePlayers(gs.players);
  const reactionsByPlayer = new Map<number, Reaction>();
  const messagesByPlayer = new Map<number, ChatMessage>();

  if (now > 0) {
    for (let i = reactions.length - 1; i >= 0; i--) {
      const reaction = reactions[i];
      if (now - reaction.ts >= REACTION_LIFETIME_MS) continue;
      const ownerId = reaction.playerId ?? players.find((p) => p.name === reaction.name)?.id;
      if (ownerId !== undefined && !reactionsByPlayer.has(ownerId)) {
        reactionsByPlayer.set(ownerId, reaction);
      }
    }
    const recentMessages = messages.slice(-40);
    for (let i = recentMessages.length - 1; i >= 0; i--) {
      const message = recentMessages[i];
      if (message.playerId < 0 || now - message.ts >= MESSAGE_LIFETIME_MS) continue;
      if (!messagesByPlayer.has(message.playerId)) {
        messagesByPlayer.set(message.playerId, message);
      }
    }
  }

  return (
    <aside
      aria-label="Jogadores da mesa"
      className="fixed left-0 top-12 bottom-16 w-[46px] lg:w-[180px] z-30 flex items-center px-1 lg:px-3 pointer-events-none"
    >
      <div className="w-full max-h-full flex flex-col gap-1.5">
        {players.map((player) => {
          const democracy = getGameMode(gs) === 'democracy';
          const isCzar = !democracy && player.id === gs.czarId;
          const isOffline = player.connected === false;
          const submitted = gs.submissions.some((submission) => submission.playerId === player.id);
          const voted = (gs.votes ?? []).some((vote) => vote.voterId === player.id);
          const reaction = reactionsByPlayer.get(player.id);
          const message = messagesByPlayer.get(player.id);
          return (
            <div
              key={player.id}
              className={[
                'relative h-10 lg:h-11 rounded-xl border flex items-center gap-2 px-1 lg:px-1.5 transition-colors',
                isOffline
                  ? 'border-white/8 bg-white/[0.02] opacity-55'
                  : isCzar
                  ? 'border-red/80 bg-red/12'
                  : (submitted && gs.phase === 'submitting') || (voted && gs.phase === 'judging')
                    ? 'border-ok/60 bg-ok/10'
                    : player.id === myId
                      ? 'border-white/35 bg-white/[0.08]'
                      : 'border-white/10 bg-white/[0.035]',
              ].join(' ')}
            >
              <div className="relative shrink-0">
                <div
                  className={`w-8 h-8 rounded-full flex items-center justify-center text-[10px] font-black text-white ${isOffline ? 'grayscale' : ''} ${(submitted && gs.phase === 'submitting') || (voted && gs.phase === 'judging') ? 'ring-2 ring-ok' : ''}`}
                  style={{ background: avatarColor(player.id) }}
                >
                  {initials(player.name)}
                </div>
                {isCzar && (
                  <span className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-red text-white text-[8px] flex items-center justify-center shadow">
                    ⚖
                  </span>
                )}
                {((submitted && !isCzar && gs.phase === 'submitting') ||
                  (voted && democracy && gs.phase === 'judging')) && (
                  <span className="absolute -bottom-1 -right-1 w-4 h-4 rounded-full bg-ok text-white text-[9px] font-black flex items-center justify-center shadow">
                    ✓
                  </span>
                )}
                <span className="lg:hidden absolute -bottom-1 -left-1 min-w-4 h-4 px-1 rounded-full bg-ink border border-white/20 text-paper text-[8px] font-black flex items-center justify-center">
                  {player.score}
                </span>
              </div>

              <div className="hidden lg:flex min-w-0 flex-1 items-center gap-1.5">
                <div className="min-w-0 flex-1 flex flex-col">
                  <span className={`truncate text-[11px] font-bold leading-tight ${player.id === myId ? 'text-paper' : 'text-paper/70'}`}>
                    {player.name}
                  </span>
                  <span className={`text-[8px] font-black tracking-widest ${isOffline ? 'text-paper/35' : isCzar ? 'text-red' : (submitted && gs.phase === 'submitting') || (voted && gs.phase === 'judging') ? 'text-ok' : 'text-paper/30'}`}>
                    {isOffline
                      ? 'OFFLINE · AUTO'
                      : isCzar
                        ? 'JUIZ'
                        : voted && democracy && gs.phase === 'judging'
                          ? 'VOTOU'
                          : submitted && gs.phase === 'submitting'
                            ? 'JOGOU'
                            : player.id === myId ? 'VOCÊ' : 'NA MESA'}
                  </span>
                </div>
                <span key={player.score} className="font-display text-paper text-sm score-pop">
                  {player.score}
                </span>
              </div>

              {message && (
                <div
                  key={message.id}
                  className="player-speech absolute left-[calc(100%+8px)] top-1/2 -translate-y-1/2 z-40 w-max max-w-[min(220px,calc(100vw-78px))] rounded-xl bg-paper text-ink px-3 py-2 shadow-xl"
                >
                  <span className="absolute -left-1.5 top-1/2 -translate-y-1/2 w-3 h-3 bg-paper rotate-45" />
                  <span className="relative block text-[11.5px] lg:text-xs font-bold leading-snug line-clamp-2 break-words">
                    {message.text}
                  </span>
                </div>
              )}

              {reaction && (
                <span
                  key={reaction.id}
                  className="player-reaction-shot absolute left-[calc(100%+5px)] top-0 z-50 text-3xl drop-shadow-lg"
                  aria-hidden="true"
                >
                  {reaction.emoji}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </aside>
  );
}

function ReactionBar({ onReact }: { onReact: (emoji: string) => void }) {
  const lastRef = useRef(Number.NEGATIVE_INFINITY);
  const [expanded, setExpanded] = useState(false);

  const fire = (emoji: string, clickedAt: number) => {
    if (clickedAt - lastRef.current < 400) return;
    lastRef.current = clickedAt;
    onReact(emoji);
    setExpanded(false);
  };

  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40 flex gap-0.5 bg-[#100f13]/90 border border-white/10 rounded-full px-1.5 py-1 backdrop-blur-md shadow-xl">
      {expanded && (
        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 grid grid-cols-4 sm:grid-cols-6 gap-1 rounded-2xl border border-white/12 bg-[#100f13]/95 p-2 shadow-2xl backdrop-blur-md">
          {REACTION_EMOJIS.map(({ emoji, label }) => (
            <button
              key={emoji}
              type="button"
              onClick={(event) => fire(emoji, event.timeStamp)}
              className="text-xl leading-none w-9 h-9 rounded-lg hover:bg-white/10 active:scale-125 transition-all"
              title={label}
              aria-label={label}
            >
              {emoji}
            </button>
          ))}
        </div>
      )}

      {QUICK_REACTIONS.map(({ emoji, label }, index) => (
        <button
          key={emoji}
          type="button"
          onClick={(event) => fire(emoji, event.timeStamp)}
          className={`text-lg leading-none w-8 h-8 sm:w-9 sm:h-9 rounded-full hover:bg-white/10 active:scale-125 transition-all ${index >= 3 ? 'hidden sm:block' : ''}`}
          title={label}
          aria-label={label}
        >
          {emoji}
        </button>
      ))}
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        className={`text-paper/70 hover:text-paper w-8 h-8 sm:w-9 sm:h-9 rounded-full border transition-all font-bold text-base ${expanded ? 'border-red bg-red/15 text-red' : 'border-white/10 hover:border-white/30'}`}
        aria-label={expanded ? 'Fechar reações' : 'Mais reações meme'}
        aria-expanded={expanded}
      >
        {expanded ? '×' : '+'}
      </button>
    </div>
  );
}

export function GameBoard({
  state, myId, onSubmit, onReveal, onJudge, onVote, onNextRound, onRestart, reactions, messages, onReact,
}: GameBoardProps) {
  const gs = state;
  const democracy = getGameMode(gs) === 'democracy';
  const me = gs.players.find((p) => p.id === myId);
  const iAmCzar = !democracy && gs.czarId === myId;
  const czar = gs.players.find((p) => p.id === gs.czarId);
  const revealed = gs.revealed ?? [];
  const votes = gs.votes ?? [];

  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [judgePick, setJudgePick] = useState<number | null>(null);
  const [votePick, setVotePick] = useState<number | null>(null);
  const [muted, setMutedState] = useState(false);
  useEffect(() => {
    const id = window.setTimeout(() => setMutedState(isMuted()), 0);
    return () => window.clearTimeout(id);
  }, []);

  const mySubmission = gs.submissions.find((s) => s.playerId === myId);
  const iSubmitted = !!mySubmission;
  const pick = gs.blackCard?.pick ?? 1;

  // Nova rodada: limpa seleções e toca o aviso.
  const roundKey = `${gs.round}-${gs.blackCard?.id ?? ''}`;
  const prevRoundKey = useRef(roundKey);
  useEffect(() => {
    if (prevRoundKey.current !== roundKey) {
      prevRoundKey.current = roundKey;
      setSelectedIds([]);
      setJudgePick(null);
      setVotePick(null);
      if (gs.phase === 'submitting') playSound('turn');
    }
  }, [roundKey, gs.phase]);

  // Sons de transição de fase.
  const prevPhase = useRef(gs.phase);
  useEffect(() => {
    if (prevPhase.current !== gs.phase) {
      if (gs.phase === 'judging' && (iAmCzar || democracy)) playSound('turn');
      if (gs.phase === 'round-end') {
        playSound('stamp');
        if (gs.roundWinnerId === myId) playSound('roundWin');
      }
      if (gs.phase === 'game-end') {
        playSound(gs.winner?.id === myId ? 'victory' : 'defeat');
      }
      prevPhase.current = gs.phase;
    }
  }, [gs.phase, iAmCzar, democracy, gs.roundWinnerId, gs.winner, myId]);

  // Um empate abre outra urna sem mudar a fase nem a rodada.
  const voteRoundKey = `${gs.round}-${gs.votingRound ?? 1}-${gs.phaseStartedAt}`;
  const previousVoteRoundKey = useRef(voteRoundKey);
  useEffect(() => {
    if (previousVoteRoundKey.current !== voteRoundKey) {
      previousVoteRoundKey.current = voteRoundKey;
      setVotePick(null);
    }
  }, [voteRoundKey]);

  // Som de flip quando o juiz vira uma prova (em todas as telas).
  const prevRevealCount = useRef(revealed.length);
  useEffect(() => {
    if (revealed.length > prevRevealCount.current) playSound('flip');
    prevRevealCount.current = revealed.length;
  }, [revealed.length]);

  const selectedCards = useMemo(
    () => selectedIds.map((id) => me?.hand.find((c) => c.id === id)).filter((c): c is WhiteCard => !!c),
    [selectedIds, me?.hand]
  );

  // Preview ao vivo: a frase vai se montando na carta preta enquanto escolhe.
  const blackText = useMemo(() => {
    if (!gs.blackCard) return '';
    if (gs.phase === 'submitting' && (democracy || !iAmCzar)) {
      if (iSubmitted && mySubmission) return fillBlanks(gs.blackCard, mySubmission.cards);
      if (selectedCards.length) return fillBlanks(gs.blackCard, selectedCards);
    }
    return gs.blackCard.text;
  }, [gs.blackCard, gs.phase, democracy, iAmCzar, iSubmitted, mySubmission, selectedCards]);

  const toggleCard = (id: string) => {
    setSelectedIds((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= pick) {
        // Com pick 1, tocar em outra carta troca a seleção.
        if (pick === 1) return [id];
        return prev;
      }
      return [...prev, id];
    });
  };

  const submit = () => {
    if (selectedIds.length !== pick) return;
    playSound('play');
    onSubmit(selectedIds);
    setSelectedIds([]);
  };

  const nameOf = (id: number) => gs.players.find((p) => p.id === id)?.name ?? '?';
  const allRevealed = revealed.length === gs.submissions.length;
  const myVote = votes.find((vote) => vote.voterId === myId);
  const votingOptions = gs.votingOptions?.length
    ? gs.votingOptions
    : gs.submissions.map((_, index) => index);
  const votersTotal = getActivePlayers(gs.players).filter(
    (player) => votingChoicesFor(gs, player.id).length > 0
  ).length;
  const eligibleToVote = !!me && !me.eliminated && votingChoicesFor(gs, myId).length > 0;

  // ── Fim de jogo ─────────────────────────────────────────────────────────
  if (gs.phase === 'game-end') {
    const ranked = [...gs.players].sort((a, b) => b.score - a.score);
    return (
      <div className="min-h-screen table-bg relative">
        <PlayerRail gs={gs} myId={myId} reactions={reactions} messages={messages} />
        <div className="min-h-screen flex flex-col items-center justify-center px-[46px] lg:px-[180px] xl:px-6 py-6 pb-24 gap-6">
            <div className="text-center flex flex-col items-center gap-3">
              <div className="stamp text-xl">VEREDITO FINAL</div>
              <h1 className="font-display text-paper text-5xl sm:text-6xl leading-none card-in">
                {gs.winner ? gs.winner.name.toUpperCase() : 'NINGUÉM'}
              </h1>
              <p className="text-paper/60 font-bold text-sm tracking-wide">
                CULPADO DE SER A PIOR PESSOA DA MESA ☠
              </p>
            </div>

            <div className="w-full max-w-sm flex flex-col gap-2">
              {ranked.map((p, i) => (
                <div
                  key={p.id}
                  className={`card-in flex items-center gap-3 px-4 py-3 rounded-xl ${
                    i === 0 ? 'bg-red text-white' : 'bg-white/[0.06] text-paper'
                  }`}
                  style={{ animationDelay: `${i * 90}ms` }}
                >
                  <span className="font-display text-lg w-7">{i === 0 ? '☠' : `${i + 1}º`}</span>
                  <span className="font-bold flex-1 truncate">
                    {p.name}{p.eliminated ? ' (saiu)' : ''}
                  </span>
                  <span className="font-display text-lg">{p.score}</span>
                </div>
              ))}
            </div>

            <button
              onClick={onRestart}
              className="btn-red h-13 px-8 rounded-xl font-display text-[15px] tracking-wide transition-all hover:brightness-110 active:scale-95"
            >
              VOLTAR AO INÍCIO
            </button>
        </div>
        <ReactionBar onReact={onReact} />
      </div>
    );
  }

  const showTimer = gs.phase === 'submitting' || gs.phase === 'judging';
  const timerSeconds = gs.phase === 'submitting' ? SUBMIT_SECONDS : JUDGE_SECONDS;
  const iNeedToAct =
    (gs.phase === 'submitting' && !!me && (democracy || !iAmCzar) && !iSubmitted) ||
    (gs.phase === 'judging' && (democracy ? eligibleToVote && !myVote : iAmCzar));

  return (
    <div className="min-h-screen table-bg flex flex-col relative">
      <PlayerRail gs={gs} myId={myId} reactions={reactions} messages={messages} />

      <div className="flex flex-1 min-w-0 flex-col px-[46px] lg:px-[180px] xl:px-0">
        {/* Barra superior */}
        <header className="flex items-center justify-between px-2 sm:px-4 pt-4 pb-1 max-w-3xl w-full mx-auto">
          <span className="font-display text-paper text-sm">
            SEM PERDÃO<span className="text-red">*</span>
          </span>
          <span className="text-paper/50 text-[11px] font-bold tracking-[0.18em]">
            <span className="sm:hidden">
              {democracy ? '🗳 DEMO' : '⚖ JUIZ'} · R{gs.round}
            </span>
            <span className="hidden sm:inline">
              {democracy ? '🗳 DEMOCRACIA' : '⚖ 1 JUIZ'} · RODADA {gs.round} · ATÉ {gs.scoreLimit}
            </span>
          </span>
          <button
            onClick={() => { const m = !muted; setMuted(m); setMutedState(m); }}
            className="text-paper/50 hover:text-paper text-sm w-8 h-8 rounded-full border border-white/15 flex items-center justify-center transition-colors"
            title={muted ? 'Ativar sons' : 'Silenciar'}
          >
            {muted ? '🔇' : '🔊'}
          </button>
        </header>

        <div className="flex-1 min-w-0 flex flex-col">
          {showTimer && (
            <PhaseTimer
              startedAt={gs.phaseStartedAt}
              seconds={timerSeconds}
              ticking={iNeedToAct && !muted}
            />
          )}

          <main className="flex-1 flex flex-col gap-5 px-3 sm:px-4 py-4 max-w-3xl w-full mx-auto pb-28">
        {gs.blackCard && gs.phase !== 'round-end' && <BlackCardView text={blackText} />}

        {/* ── Jogando cartas ── */}
        {gs.phase === 'submitting' && (
          <>
            {!me ? (
              <div className="text-center flex flex-col items-center gap-3 mt-2">
                <div className="stamp text-base">👀 NA PLATEIA</div>
                <p className="text-paper/55 text-sm font-medium max-w-xs">
                  Você entra com mão nova no começo da próxima rodada.
                </p>
                <SubmitStatus gs={gs} />
              </div>
            ) : !democracy && iAmCzar ? (
              <div className="text-center flex flex-col items-center gap-4 mt-2">
                <div className="stamp text-base">⚖ VOCÊ É O JUIZ</div>
                <p className="text-paper/60 text-sm font-medium max-w-xs">
                  Aguardando as provas do crime. Depois você vira uma por uma e condena a melhor.
                </p>
                <SubmitStatus gs={gs} />
              </div>
            ) : iSubmitted ? (
              <div className="text-center flex flex-col items-center gap-4 mt-2">
                <p className="text-paper/70 font-bold text-sm">Prova entregue. Sem volta.</p>
                <SubmitStatus gs={gs} />
              </div>
            ) : (
              <>
                <div className="flex items-baseline justify-between">
                  <p className="text-paper/70 text-[12px] font-bold tracking-[0.15em]">
                    SUA MÃO — ESCOLHA {pick > 1 ? `${pick} CARTAS (na ordem)` : '1 CARTA'}
                  </p>
                  <p className="text-paper/40 text-[11px] font-bold">
                    {democracy ? '🗳 TODO MUNDO JOGA' : `⚖ ${czar?.name ?? '?'}`}
                  </p>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                  {(me?.hand ?? []).map((c, i) => (
                    <WhiteCardView
                      key={c.id}
                      card={c}
                      index={i}
                      selected={selectedIds.includes(c.id)}
                      order={selectedIds.indexOf(c.id) >= 0 ? selectedIds.indexOf(c.id) : undefined}
                      dimmed={selectedIds.length >= pick && !selectedIds.includes(c.id) && pick > 1}
                      onClick={() => toggleCard(c.id)}
                    />
                  ))}
                </div>
                <button
                  onClick={submit}
                  disabled={selectedIds.length !== pick}
                  className="btn-red h-13 rounded-xl font-display text-[15px] tracking-wide transition-all hover:brightness-110 active:scale-95 disabled:opacity-30 disabled:cursor-not-allowed sticky bottom-16 shadow-2xl"
                >
                  {selectedIds.length === pick
                    ? 'JOGAR SEM PERDÃO'
                    : `ESCOLHA ${pick - selectedIds.length} CARTA${pick - selectedIds.length > 1 ? 'S' : ''}`}
                </button>
              </>
            )}
          </>
        )}

        {/* ── Julgamento ── */}
        {gs.phase === 'judging' && (
          democracy ? (
            <>
              <div className="text-center flex flex-col items-center gap-2">
                <p className="text-[12px] font-bold tracking-[0.15em] text-paper/70">
                  {(gs.votingRound ?? 1) === 2
                    ? '2º TURNO · SÓ AS FINALISTAS'
                    : myVote
                      ? 'VOTO LACRADO · AGUARDANDO A MESA'
                      : 'ESCOLHA A MELHOR · VOTO SECRETO'}
                </p>
                <div className="flex items-center gap-2 text-[10.5px] font-black tracking-wide">
                  <span className={votes.length === votersTotal ? 'text-ok' : 'text-paper/45'}>
                    🗳 {votes.length}/{votersTotal} VOTARAM
                  </span>
                  {(gs.votingRound ?? 1) === 2 && (
                    <span className="rounded-full border border-red/40 px-2 py-0.5 text-red">DESEMPATE</span>
                  )}
                </div>
              </div>

              <div className="flex flex-col gap-2.5 max-w-md w-full mx-auto">
                {votingOptions.map((index) => {
                  const submission = gs.submissions[index];
                  if (!submission) return null;
                  const own = submission.playerId === myId;
                  return (
                    <JudgingCard
                      key={index}
                      gs={gs}
                      submission={submission}
                      revealed
                      canFlip={false}
                      own={own}
                      selected={!myVote && votePick === index}
                      selectable={eligibleToVote && !myVote && !own}
                      onFlip={() => {}}
                      onSelect={() => setVotePick(index)}
                    />
                  );
                })}
              </div>

              {eligibleToVote && !myVote ? (
                <button
                  onClick={() => votePick !== null && onVote(votePick, gs.phaseStartedAt)}
                  disabled={votePick === null}
                  className="btn-red h-13 rounded-xl font-display text-[15px] tracking-wide transition-all hover:brightness-110 active:scale-95 disabled:opacity-30 disabled:cursor-not-allowed max-w-md w-full mx-auto sticky bottom-16 shadow-2xl"
                >
                  {votePick === null ? 'ESCOLHA UMA RESPOSTA' : 'LACRAR MEU VOTO 🗳'}
                </button>
              ) : myVote ? (
                <p className="text-center text-paper/45 text-[11.5px] font-bold">
                  ninguém vê seu voto antes do resultado
                </p>
              ) : (
                <p className="text-center text-paper/45 text-[11.5px] font-bold">
                  assistindo esta votação — você entra na próxima rodada
                </p>
              )}
            </>
          ) : (
            <>
              <p className="text-center text-[12px] font-bold tracking-[0.15em] text-paper/70">
                {iAmCzar
                  ? allRevealed
                    ? 'AGORA CONDENE A MELHOR'
                    : 'VIRE AS PROVAS, EXCELÊNCIA'
                  : `O JUIZ ${czar?.name?.toUpperCase() ?? ''} ESTÁ ${allRevealed ? 'DECIDINDO' : 'ABRINDO AS PROVAS'}…`}
              </p>
              <div className="flex flex-col gap-2.5 max-w-md w-full mx-auto">
                {gs.submissions.map((s, i) => (
                  <JudgingCard
                    key={i}
                    gs={gs}
                    submission={s}
                    revealed={revealed.includes(i)}
                    canFlip={iAmCzar}
                    selected={iAmCzar && judgePick === i}
                    selectable={iAmCzar && allRevealed}
                    onFlip={() => onReveal(i)}
                    onSelect={() => setJudgePick(i)}
                  />
                ))}
              </div>
              {iAmCzar && (
                <button
                  onClick={() => judgePick !== null && onJudge(judgePick)}
                  disabled={judgePick === null || !allRevealed}
                  className="btn-red h-13 rounded-xl font-display text-[15px] tracking-wide transition-all hover:brightness-110 active:scale-95 disabled:opacity-30 disabled:cursor-not-allowed max-w-md w-full mx-auto sticky bottom-16 shadow-2xl"
                >
                  {allRevealed ? 'CONDENAR VENCEDOR' : `FALTA${gs.submissions.length - revealed.length > 1 ? 'M' : ''} ${gs.submissions.length - revealed.length} PROVA${gs.submissions.length - revealed.length > 1 ? 'S' : ''}`}
                </button>
              )}
            </>
          )
        )}

        {/* ── Fim de rodada ── */}
        {gs.phase === 'round-end' && gs.blackCard && (
          <div className="flex flex-col gap-4 max-w-md w-full mx-auto items-center">
            <p className="font-display text-red text-lg text-center mt-2 card-in">
              {democracy
                ? gs.tieBreak
                  ? `🎲 EMPATE — ${nameOf(gs.roundWinnerId ?? -1).toUpperCase()} LEVOU NO SORTEIO`
                  : `🗳 ${nameOf(gs.roundWinnerId ?? -1).toUpperCase()} VENCEU A VOTAÇÃO`
                : `☠ ${nameOf(gs.roundWinnerId ?? -1).toUpperCase()} LEVOU A RODADA`}
            </p>
            {gs.submissions
              .map((submission, index) => ({ submission, index }))
              .filter(({ submission }) => submission.playerId === gs.roundWinnerId)
              .map(({ submission, index }) => (
                <div key={index} className="relative w-full">
                  <SubmissionView
                    gs={gs}
                    submission={submission}
                    winner
                    ownerName={nameOf(submission.playerId)}
                    voteCount={democracy ? voteCountFor(gs, index) : undefined}
                  />
                  <div className="stamp absolute -top-3 -right-2 text-sm">CULPADO</div>
                </div>
              ))}
            <div className="w-full flex flex-col gap-2 opacity-70">
              {gs.submissions
                .map((submission, index) => ({ submission, index }))
                .filter(({ submission }) => submission.playerId !== gs.roundWinnerId)
                .map(({ submission, index }, position) => (
                  <div key={index} className="card-in" style={{ animationDelay: `${200 + position * 80}ms` }}>
                    <SubmissionView
                      gs={gs}
                      submission={submission}
                      ownerName={nameOf(submission.playerId)}
                      voteCount={democracy ? voteCountFor(gs, index) : undefined}
                    />
                  </div>
                ))}
            </div>
            <button
              onClick={onNextRound}
              className="btn-red h-12 px-8 rounded-xl font-display text-[14px] tracking-wide transition-all hover:brightness-110 active:scale-95"
            >
              PRÓXIMA RODADA →
            </button>
            <p className="text-paper/40 text-[11.5px]">a rodada vira sozinha em alguns segundos</p>
          </div>
        )}
          </main>
        </div>
      </div>

      <ReactionBar onReact={onReact} />
    </div>
  );
}
