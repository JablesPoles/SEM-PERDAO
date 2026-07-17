'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { GameState, Reaction, Submission, WhiteCard } from '../lib/types';
import { fillBlanks, getActivePlayers, JUDGE_SECONDS, SUBMIT_SECONDS } from '../lib/game';
import { isMuted, playSound, setMuted } from '../lib/sounds';
import { avatarColor, initials } from './avatar';

interface GameBoardProps {
  state: GameState;
  myId: number;
  onSubmit: (cardIds: string[]) => void;
  onReveal: (index: number) => void;
  onJudge: (index: number) => void;
  onNextRound: () => void;
  onRestart: () => void;
  reactions: Reaction[];
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
}: {
  gs: GameState;
  submission: Submission;
  ownerName?: string;
  winner?: boolean;
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
  onFlip,
  onSelect,
}: {
  gs: GameState;
  submission: Submission;
  revealed: boolean;
  canFlip: boolean;
  selected: boolean;
  selectable: boolean;
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
      ].join(' ')}
    >
      <p className="font-bold text-[14.5px] leading-snug"><Highlighted text={text} /></p>
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

// Quem já jogou / quem falta — fila de avatares viva.
function SubmitStatus({ gs }: { gs: GameState }) {
  const waiting = getActivePlayers(gs.players).filter((p) => p.id !== gs.czarId);
  return (
    <div className="flex flex-wrap justify-center gap-2">
      {waiting.map((p) => {
        const played = gs.submissions.some((s) => s.playerId === p.id);
        return (
          <div key={p.id} className="flex flex-col items-center gap-1 w-14">
            <div
              className={[
                'w-9 h-9 rounded-full flex items-center justify-center text-[11px] font-black text-white transition-all',
                played ? 'ring-2 ring-ok scale-100' : 'ring-2 ring-white/15 opacity-60 animate-pulse',
              ].join(' ')}
              style={{ background: avatarColor(p.id) }}
            >
              {played ? '✓' : initials(p.name)}
            </div>
            <span className={`text-[9.5px] font-bold truncate w-full text-center ${played ? 'text-ok' : 'text-paper/45'}`}>
              {p.name}
            </span>
          </div>
        );
      })}
    </div>
  );
}

const REACTION_EMOJIS = ['💀', '🤣', '🤮', '👏', '🫣'];

function reactionLane(id: string): number {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return 8 + (h % 80);
}

function ReactionsLayer({ reactions }: { reactions: Reaction[] }) {
  // Tick pra expirar as reações antigas do DOM depois da animação.
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((x) => x + 1), 700);
    return () => clearInterval(id);
  }, []);
  const now = Date.now();
  const live = reactions.filter((r) => now - r.ts < 2700);
  return (
    <div className="fixed inset-0 z-30 pointer-events-none overflow-hidden">
      {live.map((r) => (
        <div
          key={r.id}
          className="absolute bottom-24 react-float flex flex-col items-center gap-0.5"
          style={{ left: `${reactionLane(r.id)}%` }}
        >
          <span className="text-3xl drop-shadow">{r.emoji}</span>
          <span className="text-[9px] font-bold text-paper/80 bg-ink/70 rounded-full px-1.5 py-px">
            {r.name}
          </span>
        </div>
      ))}
    </div>
  );
}

function ReactionBar({ onReact }: { onReact: (emoji: string) => void }) {
  const lastRef = useRef(0);
  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40 flex gap-0.5 bg-[#100f13]/85 border border-white/10 rounded-full px-1.5 py-1 backdrop-blur-md shadow-xl">
      {REACTION_EMOJIS.map((e) => (
        <button
          key={e}
          onClick={() => {
            const n = Date.now();
            if (n - lastRef.current < 400) return;
            lastRef.current = n;
            onReact(e);
          }}
          className="text-lg leading-none w-9 h-9 rounded-full hover:bg-white/10 active:scale-125 transition-all"
        >
          {e}
        </button>
      ))}
    </div>
  );
}

export function GameBoard({
  state, myId, onSubmit, onReveal, onJudge, onNextRound, onRestart, reactions, onReact,
}: GameBoardProps) {
  const gs = state;
  const me = gs.players.find((p) => p.id === myId);
  const iAmCzar = gs.czarId === myId;
  const czar = gs.players.find((p) => p.id === gs.czarId);
  const active = getActivePlayers(gs.players);
  const revealed = gs.revealed ?? [];

  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [judgePick, setJudgePick] = useState<number | null>(null);
  const [muted, setMutedState] = useState(false);
  useEffect(() => { setMutedState(isMuted()); }, []);

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
      if (gs.phase === 'submitting') playSound('turn');
    }
  }, [roundKey, gs.phase]);

  // Sons de transição de fase.
  const prevPhase = useRef(gs.phase);
  useEffect(() => {
    if (prevPhase.current !== gs.phase) {
      if (gs.phase === 'judging' && iAmCzar) playSound('turn');
      if (gs.phase === 'round-end') {
        playSound('stamp');
        if (gs.roundWinnerId === myId) playSound('roundWin');
      }
      if (gs.phase === 'game-end') {
        playSound(gs.winner?.id === myId ? 'victory' : 'defeat');
      }
      prevPhase.current = gs.phase;
    }
  }, [gs.phase, iAmCzar, gs.roundWinnerId, gs.winner, myId]);

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
    if (gs.phase === 'submitting' && !iAmCzar) {
      if (iSubmitted && mySubmission) return fillBlanks(gs.blackCard, mySubmission.cards);
      if (selectedCards.length) return fillBlanks(gs.blackCard, selectedCards);
    }
    return gs.blackCard.text;
  }, [gs.blackCard, gs.phase, iAmCzar, iSubmitted, mySubmission, selectedCards]);

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

  // ── Fim de jogo ─────────────────────────────────────────────────────────
  if (gs.phase === 'game-end') {
    const ranked = [...gs.players].sort((a, b) => b.score - a.score);
    return (
      <div className="min-h-screen table-bg flex flex-col items-center justify-center p-6 gap-6">
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
        <ReactionsLayer reactions={reactions} />
        <ReactionBar onReact={onReact} />
      </div>
    );
  }

  const showTimer = gs.phase === 'submitting' || gs.phase === 'judging';
  const timerSeconds = gs.phase === 'submitting' ? SUBMIT_SECONDS : JUDGE_SECONDS;
  const iNeedToAct =
    (gs.phase === 'submitting' && !iAmCzar && !iSubmitted) ||
    (gs.phase === 'judging' && iAmCzar);

  return (
    <div className="min-h-screen table-bg flex flex-col">
      {/* Barra superior */}
      <header className="flex items-center justify-between px-4 pt-4 pb-1 max-w-3xl w-full mx-auto">
        <span className="font-display text-paper text-sm">
          SEM PERDÃO<span className="text-red">*</span>
        </span>
        <span className="text-paper/50 text-[11px] font-bold tracking-[0.18em]">
          RODADA {gs.round} · ATÉ {gs.scoreLimit}
        </span>
        <button
          onClick={() => { const m = !muted; setMuted(m); setMutedState(m); }}
          className="text-paper/50 hover:text-paper text-sm w-8 h-8 rounded-full border border-white/15 flex items-center justify-center transition-colors"
          title={muted ? 'Ativar sons' : 'Silenciar'}
        >
          {muted ? '🔇' : '🔊'}
        </button>
      </header>

      {showTimer && (
        <PhaseTimer
          startedAt={gs.phaseStartedAt ?? Date.now()}
          seconds={timerSeconds}
          ticking={iNeedToAct && !muted}
        />
      )}

      {/* Placar */}
      <div className="flex gap-2 px-4 py-2 overflow-x-auto max-w-3xl w-full mx-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {gs.players.filter((p) => !p.eliminated).map((p) => (
          <div
            key={p.id}
            className={[
              'flex items-center gap-2 shrink-0 pl-1.5 pr-3 py-1.5 rounded-full border transition-colors',
              p.id === gs.czarId ? 'border-red bg-red/10' : 'border-white/12 bg-white/[0.04]',
            ].join(' ')}
          >
            <div
              className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-black text-white"
              style={{ background: avatarColor(p.id) }}
            >
              {initials(p.name)}
            </div>
            <span className={`text-[12px] font-bold ${p.id === myId ? 'text-paper' : 'text-paper/70'}`}>
              {p.name}
            </span>
            {p.id === gs.czarId && (
              <span className="text-red text-[9px] font-black tracking-widest">⚖ JUIZ</span>
            )}
            <span key={p.score} className="font-display text-paper text-[13px] score-pop">
              {p.score}
            </span>
          </div>
        ))}
      </div>

      <main className="flex-1 flex flex-col gap-5 px-4 py-4 max-w-3xl w-full mx-auto pb-28">
        {gs.blackCard && gs.phase !== 'round-end' && <BlackCardView text={blackText} />}

        {/* ── Jogando cartas ── */}
        {gs.phase === 'submitting' && (
          <>
            {iAmCzar ? (
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
                    ⚖ {czar?.name ?? '?'}
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
        )}

        {/* ── Fim de rodada ── */}
        {gs.phase === 'round-end' && gs.blackCard && (
          <div className="flex flex-col gap-4 max-w-md w-full mx-auto items-center">
            <p className="font-display text-red text-lg text-center mt-2 card-in">
              ☠ {nameOf(gs.roundWinnerId ?? -1).toUpperCase()} LEVOU A RODADA
            </p>
            {gs.submissions
              .filter((s) => s.playerId === gs.roundWinnerId)
              .map((s, i) => (
                <div key={i} className="relative w-full">
                  <SubmissionView gs={gs} submission={s} winner ownerName={nameOf(s.playerId)} />
                  <div className="stamp absolute -top-3 -right-2 text-sm">CULPADO</div>
                </div>
              ))}
            <div className="w-full flex flex-col gap-2 opacity-70">
              {gs.submissions
                .filter((s) => s.playerId !== gs.roundWinnerId)
                .map((s, i) => (
                  <div key={i} className="card-in" style={{ animationDelay: `${200 + i * 80}ms` }}>
                    <SubmissionView gs={gs} submission={s} ownerName={nameOf(s.playerId)} />
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

      <ReactionsLayer reactions={reactions} />
      <ReactionBar onReact={onReact} />
    </div>
  );
}
