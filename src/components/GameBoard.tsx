'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { GameState, Submission, WhiteCard } from '../lib/types';
import { fillBlanks, getActivePlayers } from '../lib/game';
import { isMuted, playSound, setMuted } from '../lib/sounds';
import { avatarColor, initials } from './avatar';

interface GameBoardProps {
  state: GameState;
  myId: number;
  onSubmit: (cardIds: string[]) => void;
  onJudge: (index: number) => void;
  onNextRound: () => void;
  onRestart: () => void;
}

function BlackCardView({ text }: { text: string }) {
  return (
    <div className="card-black rounded-xl p-5 sm:p-6 w-full max-w-md mx-auto">
      <div className="w-6 h-1.5 bg-red mb-4" />
      <p className="font-display text-lg sm:text-xl leading-snug">{text}</p>
      <div className="flex justify-between items-end mt-5">
        <span className="text-[10px] font-bold tracking-[0.18em] text-paper/40">PERGUNTA</span>
        <span className="font-display text-red text-sm">SP*</span>
      </div>
    </div>
  );
}

function WhiteCardView({
  card,
  order,
  selected,
  dimmed,
  onClick,
}: {
  card: WhiteCard;
  order?: number;
  selected?: boolean;
  dimmed?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={!onClick}
      className={[
        'card-white relative rounded-[10px] p-3.5 text-left transition-all min-h-[92px] flex flex-col justify-between',
        onClick ? 'hover:-translate-y-0.5 active:scale-[0.98]' : 'cursor-default',
        selected ? 'ring-4 ring-red -translate-y-1' : '',
        dimmed ? 'opacity-40' : '',
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
  );
}

function SubmissionView({
  gs,
  submission,
  selected,
  ownerName,
  winner,
  onClick,
}: {
  gs: GameState;
  submission: Submission;
  selected?: boolean;
  ownerName?: string;
  winner?: boolean;
  onClick?: () => void;
}) {
  const text = gs.blackCard ? fillBlanks(gs.blackCard, submission.cards) : '';
  return (
    <button
      onClick={onClick}
      disabled={!onClick}
      className={[
        'card-white w-full rounded-[10px] p-4 text-left transition-all',
        onClick ? 'hover:-translate-y-0.5 active:scale-[0.99]' : 'cursor-default',
        selected ? 'ring-4 ring-red' : '',
        winner ? 'ring-4 ring-red' : '',
      ].join(' ')}
    >
      <p className="font-bold text-[14px] leading-snug">{text}</p>
      {ownerName && (
        <p className={`text-[11px] font-bold mt-2 tracking-wide ${winner ? 'text-red' : 'text-gray'}`}>
          {winner ? '☠ ' : ''}{ownerName.toUpperCase()}
        </p>
      )}
    </button>
  );
}

export function GameBoard({ state, myId, onSubmit, onJudge, onNextRound, onRestart }: GameBoardProps) {
  const gs = state;
  const me = gs.players.find((p) => p.id === myId);
  const iAmCzar = gs.czarId === myId;
  const czar = gs.players.find((p) => p.id === gs.czarId);
  const active = getActivePlayers(gs.players);

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

  // Virou julgamento e eu sou o juiz → chama a atenção.
  const prevPhase = useRef(gs.phase);
  useEffect(() => {
    if (prevPhase.current !== gs.phase) {
      if (gs.phase === 'judging' && iAmCzar) playSound('turn');
      if (gs.phase === 'round-end') {
        playSound(gs.roundWinnerId === myId ? 'roundWin' : 'play');
      }
      if (gs.phase === 'game-end') {
        playSound(gs.winner?.id === myId ? 'victory' : 'defeat');
      }
      prevPhase.current = gs.phase;
    }
  }, [gs.phase, iAmCzar, gs.roundWinnerId, gs.winner, myId]);

  const waitingOn = useMemo(
    () =>
      active.filter(
        (p) => p.id !== gs.czarId && !gs.submissions.some((s) => s.playerId === p.id)
      ),
    [active, gs.czarId, gs.submissions]
  );

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

  // ── Fim de jogo ─────────────────────────────────────────────────────────
  if (gs.phase === 'game-end') {
    const ranked = [...gs.players].sort((a, b) => b.score - a.score);
    return (
      <div className="min-h-screen table-bg flex flex-col items-center justify-center p-6 gap-6">
        <div className="text-center">
          <p className="font-display text-red text-xl tracking-tight">VEREDITO FINAL</p>
          <h1 className="font-display text-paper text-5xl sm:text-6xl mt-2 leading-none">
            {gs.winner ? gs.winner.name.toUpperCase() : 'NINGUÉM'}
          </h1>
          <p className="text-paper/60 font-bold text-sm mt-3 tracking-wide">
            CULPADO DE SER A PIOR PESSOA DA MESA
          </p>
        </div>

        <div className="w-full max-w-sm flex flex-col gap-2">
          {ranked.map((p, i) => (
            <div
              key={p.id}
              className={`flex items-center gap-3 px-4 py-3 rounded-xl ${
                i === 0 ? 'bg-red text-white' : 'bg-white/[0.06] text-paper'
              }`}
            >
              <span className="font-display text-lg w-6">{i + 1}º</span>
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
    );
  }

  return (
    <div className="min-h-screen table-bg flex flex-col">
      {/* Barra superior */}
      <header className="flex items-center justify-between px-4 pt-4 pb-2 max-w-3xl w-full mx-auto">
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

      {/* Placar */}
      <div className="flex gap-2 px-4 py-2 overflow-x-auto max-w-3xl w-full mx-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {gs.players.filter((p) => !p.eliminated).map((p) => (
          <div
            key={p.id}
            className={[
              'flex items-center gap-2 shrink-0 pl-1.5 pr-3 py-1.5 rounded-full border',
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
              <span className="text-red text-[9px] font-black tracking-widest">JUIZ</span>
            )}
            <span className="font-display text-paper text-[13px]">{p.score}</span>
          </div>
        ))}
      </div>

      <main className="flex-1 flex flex-col gap-5 px-4 py-4 max-w-3xl w-full mx-auto pb-8">
        {gs.blackCard && gs.phase !== 'round-end' && <BlackCardView text={gs.blackCard.text} />}

        {/* ── Jogando cartas ── */}
        {gs.phase === 'submitting' && (
          <>
            {iAmCzar ? (
              <div className="text-center flex flex-col items-center gap-3 mt-2">
                <p className="font-display text-red text-lg">VOCÊ É O JUIZ</p>
                <p className="text-paper/60 text-sm font-medium max-w-xs">
                  Espera a galera jogar. Depois você escolhe a resposta mais sem perdão.
                </p>
                <div className="flex flex-wrap justify-center gap-1.5 mt-1">
                  {active.filter((p) => p.id !== gs.czarId).map((p) => {
                    const played = gs.submissions.some((s) => s.playerId === p.id);
                    return (
                      <span
                        key={p.id}
                        className={`text-[11px] font-bold px-2.5 py-1 rounded-full border ${
                          played
                            ? 'border-ok/60 text-ok'
                            : 'border-white/15 text-paper/45 animate-pulse'
                        }`}
                      >
                        {played ? '✓ ' : '… '}{p.name}
                      </span>
                    );
                  })}
                </div>
              </div>
            ) : iSubmitted ? (
              <div className="text-center flex flex-col items-center gap-3 mt-2">
                <p className="text-paper/70 font-bold text-sm">Carta na mesa. Sem volta.</p>
                <div className="grid grid-cols-2 gap-2 max-w-sm w-full">
                  {mySubmission!.cards.map((c) => (
                    <WhiteCardView key={c.id} card={c} />
                  ))}
                </div>
                {waitingOn.length > 0 && (
                  <p className="text-paper/45 text-[12.5px] animate-pulse">
                    esperando {waitingOn.map((p) => p.name).join(', ')}…
                  </p>
                )}
              </div>
            ) : (
              <>
                <div className="flex items-baseline justify-between">
                  <p className="text-paper/70 text-[12px] font-bold tracking-[0.15em]">
                    SUA MÃO — ESCOLHA {pick > 1 ? `${pick} CARTAS (na ordem)` : '1 CARTA'}
                  </p>
                  <p className="text-paper/40 text-[11px] font-bold">
                    juiz: {czar?.name ?? '?'}
                  </p>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                  {(me?.hand ?? []).map((c) => (
                    <WhiteCardView
                      key={c.id}
                      card={c}
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
                  className="btn-red h-13 rounded-xl font-display text-[15px] tracking-wide transition-all hover:brightness-110 active:scale-95 disabled:opacity-30 disabled:cursor-not-allowed sticky bottom-4"
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
              {iAmCzar ? 'ESCOLHA A RESPOSTA MAIS CRUEL' : `O JUIZ ${czar?.name?.toUpperCase() ?? ''} ESTÁ DECIDINDO…`}
            </p>
            <div className="flex flex-col gap-2.5 max-w-md w-full mx-auto">
              {gs.submissions.map((s, i) => (
                <SubmissionView
                  key={i}
                  gs={gs}
                  submission={s}
                  selected={iAmCzar && judgePick === i}
                  onClick={iAmCzar ? () => setJudgePick(i) : undefined}
                />
              ))}
            </div>
            {iAmCzar && (
              <button
                onClick={() => judgePick !== null && onJudge(judgePick)}
                disabled={judgePick === null}
                className="btn-red h-13 rounded-xl font-display text-[15px] tracking-wide transition-all hover:brightness-110 active:scale-95 disabled:opacity-30 disabled:cursor-not-allowed max-w-md w-full mx-auto sticky bottom-4"
              >
                CONDENAR VENCEDOR
              </button>
            )}
          </>
        )}

        {/* ── Fim de rodada ── */}
        {gs.phase === 'round-end' && gs.blackCard && (
          <div className="flex flex-col gap-4 max-w-md w-full mx-auto items-center">
            <p className="font-display text-red text-lg text-center mt-2">
              ☠ {nameOf(gs.roundWinnerId ?? -1).toUpperCase()} LEVOU
            </p>
            {gs.submissions
              .filter((s) => s.playerId === gs.roundWinnerId)
              .map((s, i) => (
                <SubmissionView key={i} gs={gs} submission={s} winner ownerName={nameOf(s.playerId)} />
              ))}
            <div className="w-full flex flex-col gap-2 opacity-75">
              {gs.submissions
                .filter((s) => s.playerId !== gs.roundWinnerId)
                .map((s, i) => (
                  <SubmissionView key={i} gs={gs} submission={s} ownerName={nameOf(s.playerId)} />
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
  );
}
