'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { GameBoard } from './GameBoard';
import {
  fillBlanks,
  getActivePlayers,
  getGameMode,
  JUDGE_SECONDS,
  SUBMIT_SECONDS,
  voteCountFor,
  votingChoicesFor,
} from '@/lib/game';
import { projectMesaView } from '@/lib/three/mesaView';
import { getVolume, isMuted, playSound, setMuted, setVolume } from '@/lib/sounds';
import type { Ato, Qualidade3D, Reacao3D, RetroMesa } from '@/lib/three/retroMesa';
import type { ChatMessage, GameState, Reaction, Submission, WhiteCard } from '@/lib/types';

interface Tribunal3DGameProps {
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

type TimedState = GameState & {
  phaseEndsAt?: number;
  submitSeconds?: number;
  judgeSeconds?: number;
  resultSeconds?: number;
  roundLimit?: number;
  turnLimit?: number;
  suddenDeath?: boolean;
  winnerIds?: number[];
};

const ATOS: { id: Ato; label: string; short: string }[] = [
  { id: 'pov', label: 'Primeira pessoa', short: 'POV' },
  { id: 'mesa', label: 'Plano da mesa', short: 'MESA' },
  { id: 'provas', label: 'Plano das provas', short: 'PROVAS' },
  { id: 'juiz', label: 'Plano do juiz', short: 'JUIZ' },
  { id: 'cima', label: 'Plano superior', short: 'CIMA' },
];

const EMOTES = ['😂', '🤨', '😡', '👏', '💀', '🤡'];
const THROWABLES: { id: Reacao3D; icon: string; label: string }[] = [
  { id: 'tomate', icon: '🍅', label: 'Tomate' },
  { id: 'sapato', icon: '👞', label: 'Sapato' },
  { id: 'rosa', icon: '🌹', label: 'Rosa' },
];

function phaseDuration(gs: TimedState): number {
  if (gs.phase === 'submitting') return gs.submitSeconds ?? SUBMIT_SECONDS;
  if (gs.phase === 'judging') return gs.judgeSeconds ?? JUDGE_SECONDS;
  return gs.resultSeconds ?? 9;
}

function phaseEnd(gs: TimedState): number {
  return gs.phaseEndsAt ?? (gs.phaseStartedAt + phaseDuration(gs) * 1000);
}

function useRemainingSeconds(gs: TimedState) {
  const endsAt = phaseEnd(gs);
  const [seconds, setSeconds] = useState(() => Math.max(0, Math.ceil((endsAt - Date.now()) / 1000)));
  useEffect(() => {
    const update = () => setSeconds(Math.max(0, Math.ceil((endsAt - Date.now()) / 1000)));
    const first = window.setTimeout(update, 0);
    const id = window.setInterval(update, 250);
    return () => { window.clearTimeout(first); window.clearInterval(id); };
  }, [endsAt]);
  return seconds;
}

function splitThrow(value: string): { kind: Reacao3D; targetId: number } | null {
  const match = /^throw:(tomate|sapato|rosa):(-?\d+)$/.exec(value);
  return match ? { kind: match[1] as Reacao3D, targetId: Number(match[2]) } : null;
}

function CardText({ state, submission }: { state: GameState; submission: Submission }) {
  if (!state.blackCard) return null;
  return <>{fillBlanks(state.blackCard, submission.cards)}</>;
}

function TimerDial({ gs }: { gs: TimedState }) {
  const remaining = useRemainingSeconds(gs);
  const lastTick = useRef<number | null>(null);
  const duration = phaseDuration(gs);
  const urgent = remaining <= 10;
  const degrees = Math.max(0, Math.min(360, (remaining / Math.max(1, duration)) * 360));
  useEffect(() => {
    if (!urgent || remaining <= 0 || lastTick.current === remaining) return;
    lastTick.current = remaining;
    playSound('tick');
  }, [remaining, urgent]);
  if (gs.phase !== 'submitting' && gs.phase !== 'judging') return null;
  return (
    <div className={`tribunal-timer ${urgent ? 'tribunal-timer--urgent' : ''}`} role="timer" aria-live={urgent ? 'assertive' : 'off'}>
      <span className="tribunal-timer__dial" style={{ '--timer-deg': `${degrees}deg` } as React.CSSProperties} />
      <time dateTime={`PT${remaining}S`}>{remaining}</time>
      <small>{gs.phase === 'submitting' ? 'DEPOIMENTO' : 'JULGAMENTO'}</small>
    </div>
  );
}

/**
 * O processo físico da demo em /3d: papel timbrado, tarja vermelha na lombada
 * e número de autos. Some a caixinha no canto — a pergunta é o centro da mesa.
 */
function BlackEvidence({ text, pick, round }: { text: string; pick: number; round: number }) {
  return (
    <div className="absolute top-[4.7rem] sm:top-[5.4rem] inset-x-0 flex justify-center px-3 pointer-events-none z-10">
      <article
        className="relative w-[min(34rem,94vw)] bg-[#111015] border border-[#e8dfcf]/30 px-5 py-3.5 sm:px-6 sm:py-4 shadow-[7px_9px_0_rgba(0,0,0,0.42),0_18px_44px_rgba(0,0,0,0.5)]"
        style={{
          clipPath: 'polygon(0.8% 2%, 99% 0, 100% 94%, 97% 100%, 1.4% 98%, 0 8%)',
          backgroundImage: 'repeating-linear-gradient(0deg,rgba(255,255,255,.016) 0 1px,transparent 1px 4px)',
        }}
      >
        <span className="absolute left-0 top-0 bottom-0 w-1.5 bg-red" />
        <div className="flex items-center justify-between gap-3 mb-2">
          <span className="text-red text-[8px] font-black tracking-[0.24em] uppercase">
            AUTOS DO PROCESSO • {String(round).padStart(2, '0')}
          </span>
          <span className="text-paper/30 text-[7px] font-mono tracking-widest">SP-{2026 + round}-P</span>
        </div>
        <p className="font-display text-paper text-[17px] sm:text-[21px] leading-[1.18] pr-3">
          {text}
        </p>
        <div className="mt-2 flex items-center gap-2 text-[8px] font-bold tracking-[0.18em] uppercase text-paper/38">
          <span className="h-px flex-1 bg-paper/15" />
          {pick > 1 ? `escolha ${pick} provas abaixo` : 'escolha a prova abaixo'}
          <span className="h-px w-5 bg-red/70" />
        </div>
      </article>
    </div>
  );
}

function ScoreRail({ gs, myId }: { gs: TimedState; myId: number }) {
  return (
    <aside className="tribunal-score" aria-label="Placar">
      <div>
        <span>RODADA</span>
        <strong>{gs.round}<small>/{gs.roundLimit ?? '∞'}</small></strong>
      </div>
      {[...getActivePlayers(gs.players)].sort((a, b) => b.score - a.score).map((player) => (
        <div key={player.id} className={player.id === myId ? 'is-self' : ''}>
          <span>{player.name}{player.id === gs.czarId && getGameMode(gs) === 'judge' ? ' ⚖' : ''}</span>
          <strong>{player.score}</strong>
        </div>
      ))}
    </aside>
  );
}

function CameraDock({ active, onChange }: { active: Ato; onChange: (ato: Ato) => void }) {
  return (
    <nav className="tribunal-camera" aria-label="Ângulos de câmera">
      {ATOS.map((ato) => (
        <button
          key={ato.id}
          onClick={() => onChange(ato.id)}
          className={active === ato.id ? 'is-active' : ''}
          aria-pressed={active === ato.id}
          title={ato.label}
        >
          {ato.short}
        </button>
      ))}
    </nav>
  );
}

function ReactionDock({ players, myId, onReact }: {
  players: GameState['players'];
  myId: number;
  onReact: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [throwable, setThrowable] = useState<Reacao3D | null>(null);
  const targets = players.filter((player) => !player.eliminated && player.id !== myId);
  return (
    <div className="tribunal-reactions">
      {open && (
        <div className="tribunal-reactions__panel" role="dialog" aria-label="Reações do tribunal">
          {!throwable ? (
            <>
              <span>REAGIR</span>
              <div>
                {EMOTES.map((emoji) => <button key={emoji} onClick={() => { onReact(emoji); setOpen(false); }}>{emoji}</button>)}
              </div>
              <span>ARREMESSAR</span>
              <div>
                {THROWABLES.map((item) => (
                  <button key={item.id} onClick={() => setThrowable(item.id)} title={item.label}>
                    {item.icon}<small>{item.label}</small>
                  </button>
                ))}
              </div>
            </>
          ) : (
            <>
              <span>ESCOLHA O ALVO</span>
              <div className="tribunal-reactions__targets">
                {targets.map((player) => (
                  <button key={player.id} onClick={() => {
                    onReact(`throw:${throwable}:${player.id}`);
                    setThrowable(null);
                    setOpen(false);
                  }}>{player.name}</button>
                ))}
              </div>
              <button className="tribunal-reactions__back" onClick={() => setThrowable(null)}>← VOLTAR</button>
            </>
          )}
        </div>
      )}
      <button className="tribunal-reactions__trigger" onClick={() => { setOpen((value) => !value); setThrowable(null); }} aria-expanded={open}>
        {open ? '×' : '☠'}<span>REAÇÕES</span>
      </button>
    </div>
  );
}

function WhiteHand({ cards, selectedIds, pick, onToggle, onSubmit }: {
  cards: WhiteCard[];
  selectedIds: string[];
  pick: number;
  onToggle: (id: string) => void;
  onSubmit: () => void;
}) {
  return (
    <>
      {/* Leque de provas da demo: papel envelhecido, sobreposto e torto, sem a
          faixa branca chapada que fazia a mesa online parecer outro jogo. */}
      <div className="absolute bottom-0 left-1/2 -translate-x-1/2 pb-1.5 sm:pb-2 pointer-events-auto w-[calc(100vw-1rem)] sm:w-auto max-w-[calc(100vw-1rem)] sm:max-w-[58vw] z-10">
        <div className="flex justify-start sm:justify-center overflow-x-auto px-4 pt-7 pb-2">
          {cards.map((card, index) => {
            const selectedIndex = selectedIds.indexOf(card.id);
            const selected = selectedIndex >= 0;
            return (
              <div
                key={card.id}
                className="relative shrink-0"
                style={{
                  marginLeft: index === 0 ? 0 : '-1.05rem',
                  transform: `rotate(${((index % 5) - 2) * 1.15}deg) translateY(${index % 2 ? 2 : 0}px)`,
                  zIndex: selected ? 30 : index,
                }}
              >
                <button
                  onClick={() => onToggle(card.id)}
                  aria-pressed={selected}
                  aria-label={`Prova: ${card.text}`}
                  className={`group relative w-[6.35rem] h-[9.25rem] sm:w-[7rem] sm:h-[10.2rem] bg-[#e7decc] border-2 p-2.5 sm:p-3 text-left flex flex-col transition-transform duration-150 hover:-translate-y-5 hover:z-20 active:scale-95 shadow-[3px_4px_0_#17161a,0_18px_30px_-14px_rgba(0,0,0,0.95)] overflow-hidden ${
                    selected ? 'border-red -translate-y-5' : 'border-[#19171a]'
                  }`}
                  style={{
                    clipPath: 'polygon(1% 0, 97% 1%, 100% 5%, 98% 96%, 94% 100%, 2% 98%, 0 6%)',
                    backgroundImage:
                      'radial-gradient(circle at 82% 16%,rgba(91,55,32,.10) 0 2px,transparent 3px),repeating-linear-gradient(3deg,rgba(45,36,26,.024) 0 1px,transparent 1px 5px)',
                  }}
                >
                  <span className="absolute -top-1 right-2 w-5 h-3 bg-red/65 rotate-3 opacity-70" />
                  {selected && pick > 1 && (
                    <span className="absolute top-1.5 right-1.5 w-4 h-4 bg-red text-white text-[9px] font-black flex items-center justify-center">
                      {selectedIndex + 1}
                    </span>
                  )}
                  <span className="text-[6px] font-black tracking-[0.2em] text-red uppercase border-b border-ink/15 pb-1 mb-1.5">
                    EVIDÊNCIA {String(index + 1).padStart(2, '0')}
                  </span>
                  <span className="text-[10.5px] sm:text-[11px] font-black text-ink leading-[1.18] flex-1 overflow-hidden">
                    {card.text}
                  </span>
                  <span className="flex items-end justify-between gap-1 text-[5.5px] font-black tracking-[0.14em] text-ink/42 mt-1 border-t border-ink/15 pt-1">
                    <span>SEM PERDÃO<span className="text-red">*</span></span>
                    <span className="font-mono">#{String(index + 1).padStart(2, '0')}</span>
                  </span>
                  <span className="absolute inset-1 border border-ink/[0.06] pointer-events-none" />
                </button>
              </div>
            );
          })}
        </div>
      </div>

      <div className="absolute bottom-40 sm:bottom-0 right-0 p-3 sm:p-6 pointer-events-auto z-10">
        <button
          onClick={onSubmit}
          disabled={selectedIds.length !== pick}
          className="btn-red h-12 px-5 border-2 border-ink font-display text-[14px] tracking-wide shadow-[4px_5px_0_#17161a] active:translate-y-1 active:shadow-none transition-all disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {selectedIds.length === pick ? 'LACRAR DEPOIMENTO' : `ESCOLHA ${pick - selectedIds.length}`}
        </button>
      </div>
    </>
  );
}

function ProofControls({ gs, myId, onReveal, onJudge, onVote }: {
  gs: GameState;
  myId: number;
  onReveal: (index: number) => void;
  onJudge: (index: number) => void;
  onVote: (index: number, phaseStartedAt: number) => void;
}) {
  const democracy = getGameMode(gs) === 'democracy';
  const iAmJudge = !democracy && gs.czarId === myId;
  const [selected, setSelected] = useState<number | null>(null);
  const myVote = gs.votes.find((vote) => vote.voterId === myId);
  const choices = democracy ? votingChoicesFor(gs, myId) : gs.submissions.map((_, index) => index);
  const nextSealed = gs.submissions.findIndex((_, index) => !gs.revealed.includes(index));
  return (
    <section className="tribunal-proofs">
      <header>
        <span>{democracy ? 'URNA DO TRIBUNAL' : iAmJudge ? 'SEU VEREDITO' : 'PROVAS SOB SIGILO'}</span>
        <span>{gs.revealed.length}/{gs.submissions.length}</span>
      </header>
      <div className="tribunal-proofs__list">
        {gs.submissions.map((submission, index) => {
          const revealed = democracy || gs.revealed.includes(index);
          const selectable = revealed && (democracy ? choices.includes(index) && !myVote : iAmJudge);
          return (
            <button
              key={index}
              disabled={!selectable}
              className={`${revealed ? 'is-open' : ''} ${selected === index ? 'is-selected' : ''}`}
              onClick={() => selectable && setSelected(index)}
            >
              <small>PROVA {String(index + 1).padStart(2, '0')}</small>
              <strong>{revealed ? <CardText state={gs} submission={submission} /> : 'CONTEÚDO LACRADO'}</strong>
              {democracy && gs.phase === 'round-end' && <i>{voteCountFor(gs, index)} votos</i>}
            </button>
          );
        })}
      </div>
      {!democracy && iAmJudge && nextSealed >= 0 && (
        <button className="tribunal-confirm" onClick={() => onReveal(nextSealed)}>REVELAR PRÓXIMA PROVA</button>
      )}
      {!democracy && iAmJudge && nextSealed < 0 && (
        <button className="tribunal-confirm" disabled={selected === null} onClick={() => selected !== null && onJudge(selected)}>
          {selected === null ? 'ESCOLHA O CULPADO' : 'CRAVAR VEREDITO'}
        </button>
      )}
      {democracy && !myVote && (
        <button className="tribunal-confirm" disabled={selected === null} onClick={() => selected !== null && onVote(selected, gs.phaseStartedAt)}>
          {selected === null ? 'ESCOLHA UMA PROVA' : 'LACRAR MEU VOTO'}
        </button>
      )}
      {democracy && myVote && <p>VOTO LACRADO · AGUARDANDO A MESA</p>}
    </section>
  );
}

function RoundVerdict({ gs, onNextRound }: { gs: TimedState; onNextRound: () => void }) {
  const winner = gs.players.find((player) => player.id === gs.roundWinnerId);
  const proof = gs.submissions.find((submission) => submission.playerId === gs.roundWinnerId);
  const activeScores = getActivePlayers(gs.players).map((player) => player.score);
  const bestScore = activeScores.length ? Math.max(...activeScores) : 0;
  const tiedAtLimit = gs.round >= (gs.roundLimit ?? Infinity)
    && activeScores.filter((score) => score === bestScore).length > 1;
  return (
    <section className="tribunal-verdict" role="dialog" aria-label="Veredito da rodada">
      <span>VEREDITO · RODADA {gs.round}</span>
      <h2>{winner?.name ?? 'CULPADO DESCONHECIDO'}</h2>
      {proof && gs.blackCard && <blockquote>{fillBlanks(gs.blackCard, proof.cards)}</blockquote>}
      <div>
        {[...gs.players].sort((a, b) => b.score - a.score).map((player) => (
          <p key={player.id}><span>{player.name}</span><strong>{player.score}</strong></p>
        ))}
      </div>
      <button className="tribunal-confirm" onClick={onNextRound}>
        {tiedAtLimit
          ? 'ABRIR MORTE SÚBITA'
          : gs.round >= (gs.roundLimit ?? Infinity)
            ? 'OUVIR A SENTENÇA FINAL'
            : 'PRÓXIMA RODADA'}
      </button>
    </section>
  );
}

function Finale({ gs, myId, onRestart }: { gs: TimedState; myId: number; onRestart: () => void }) {
  const ranked = [...gs.players].sort((a, b) => b.score - a.score || a.id - b.id);
  const winnerIds = useMemo(
    () => gs.winnerIds?.length ? gs.winnerIds : (gs.winner ? [gs.winner.id] : []),
    [gs.winner, gs.winnerIds]
  );
  const winner = ranked.find((player) => winnerIds.includes(player.id)) ?? ranked[0];
  const didIWin = winnerIds.includes(myId);
  const variant = Math.abs(((winner?.id ?? 0) * 31 + gs.round * 17) % 3);
  const titles = ['ABSOLVIDO PELO CAOS', 'CONDENADO COM HONRAS', 'ARQUIVO ENCERRADO'];
  useEffect(() => {
    playSound(didIWin ? 'victory' : 'defeat');
    const ending = window.setTimeout(() => playSound('ending'), 650);
    return () => window.clearTimeout(ending);
  }, [didIWin, gs.phaseStartedAt]);
  return (
    <div className={`tribunal-finale tribunal-finale--${variant}`} role="dialog" aria-modal="true" aria-label="Resultado final">
      <div className="tribunal-finale__spot" />
      <span>O TRIBUNAL DECIDIU</span>
      <h1>{winner?.name ?? 'NINGUÉM'}</h1>
      <h2>{titles[variant]}</h2>
      <p>{winner?.id === myId ? 'VOCÊ SOBREVIVEU AO JULGAMENTO.' : 'CULPADO DE SER A PIOR PESSOA DA MESA.'}</p>
      <div className="tribunal-finale__ranking">
        {ranked.map((player, index) => (
          <div key={player.id} className={winnerIds.includes(player.id) ? 'is-winner' : ''}>
            <i>{index + 1}</i><span>{player.name}</span><strong>{player.score}</strong>
          </div>
        ))}
      </div>
      {ranked.length > 1 && (
        <div className="tribunal-awards">
          <p><span>CÚMPLICE DO CAOS</span><strong>{ranked[1].name}</strong></p>
          <p><span>FICHA LIMPA, POR ACIDENTE</span><strong>{ranked.at(-1)?.name}</strong></p>
          <p><span>RODADAS SOBREVIVIDAS</span><strong>{gs.round}</strong></p>
        </div>
      )}
      <button className="tribunal-confirm" onClick={onRestart}>SAIR DO PORÃO</button>
    </div>
  );
}

export function Tribunal3DGame(props: Tribunal3DGameProps) {
  const gs = props.state as TimedState;
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const sceneRef = useRef<RetroMesa | null>(null);
  const view = useMemo(() => projectMesaView(gs, props.myId), [gs, props.myId]);
  const viewRef = useRef(view);
  const processedMessages = useRef(new Set<string>());
  const processedReactions = useRef(new Set<string>());
  const [loading, setLoading] = useState(true);
  const [webglError, setWebglError] = useState(false);
  const cameraKey = `${gs.round}:${gs.phase}`;
  // A demo abre no plano aberto só enquanto espera; ao jogar ela corta pro POV
  // baixo e perto, que é o enquadramento-assinatura da mesa. Mantemos isso.
  const defaultAto: Ato = gs.phase === 'judging' ? 'mesa' : gs.phase === 'round-end' ? 'juiz' : 'pov';
  const [cameraChoice, setCameraChoice] = useState<{ key: string; ato: Ato }>({ key: '', ato: 'pov' });
  const activeAto = cameraChoice.key === cameraKey ? cameraChoice.ato : defaultAto;
  const selectionKey = `${gs.round}:${gs.blackCard?.id ?? ''}:${gs.phase}`;
  const [selection, setSelection] = useState<{ key: string; ids: string[] }>({ key: '', ids: [] });
  const selectedIds = selection.key === selectionKey ? selection.ids : [];
  const [impact, setImpact] = useState<{ kind: Reacao3D; key: number } | null>(null);
  // A demo roda em fidelidade máxima (pixelSize 1, sombras ligadas). O jogo
  // nascia em 'media', que no compacto ainda dobrava o pixelSize — era metade
  // do motivo da mesa online parecer outro jogo.
  const [quality, setQuality] = useState<Qualidade3D>('alta');
  const [reducedMotion, setReducedMotion] = useState(false);
  const [audioMuted, setAudioMuted] = useState(false);
  const [audioVolume, setAudioVolume] = useState(0.8);
  const [showSettings, setShowSettings] = useState(false);
  const me = gs.players.find((player) => player.id === props.myId);
  const democracy = getGameMode(gs) === 'democracy';
  const iAmJudge = !democracy && gs.czarId === props.myId;
  const submitted = gs.submissions.some((submission) => submission.playerId === props.myId);
  const pick = gs.blackCard?.pick ?? 1;

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReducedMotion(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    const hydrateAudioControls = window.setTimeout(() => {
      setAudioMuted(isMuted());
      setAudioVolume(getVolume());
    }, 0);
    return () => window.clearTimeout(hydrateAudioControls);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let disposed = false;
    const start = async () => {
      try {
        await document.fonts.ready;
        const { RetroMesa: Scene } = await import('@/lib/three/retroMesa');
        if (disposed) return;
        const compact = window.innerWidth < 700;
        const scene = new Scene(canvas, {
          mesaView: viewRef.current,
          pixelSize: quality === 'baixa' ? 3 : quality === 'media' ? (compact ? 2 : 1) : 1,
          qualidade: quality,
          reducedMotion,
          onSelfImpact: (kind) => {
            setImpact({ kind, key: Date.now() });
            window.setTimeout(() => setImpact(null), kind === 'tomate' ? 1800 : 650);
          },
        });
        const initialAto: Ato = viewRef.current.phase === 'judging'
          ? 'mesa'
          : viewRef.current.phase === 'round-end'
            ? 'juiz'
            : 'pov';
        scene.setAto(initialAto);
        sceneRef.current = scene;
        setLoading(false);
        const resize = () => scene.resize();
        window.addEventListener('resize', resize);
        (scene as RetroMesa & { __resize?: () => void }).__resize = resize;
      } catch (error) {
        console.error('Falha ao iniciar o Tribunal 3D', error);
        setWebglError(true);
        setLoading(false);
      }
    };
    void start();
    return () => {
      disposed = true;
      const scene = sceneRef.current as (RetroMesa & { __resize?: () => void }) | null;
      if (scene?.__resize) window.removeEventListener('resize', scene.__resize);
      scene?.dispose();
      sceneRef.current = null;
    };
    // A cena vive durante a partida; qualidade pode ser aplicada sem recriar o GameState.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quality]);

  useEffect(() => {
    viewRef.current = view;
    sceneRef.current?.syncMesa(view);
  }, [view]);

  useEffect(() => {
    sceneRef.current?.setReducedMotion(reducedMotion);
  }, [reducedMotion]);

  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    for (const message of props.messages.slice(-20)) {
      if (processedMessages.current.has(message.id)) continue;
      processedMessages.current.add(message.id);
      scene.falarJogador(message.playerId, message.text);
    }
  }, [props.messages]);

  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    for (const reaction of props.reactions.slice(-24)) {
      if (processedReactions.current.has(reaction.id)) continue;
      processedReactions.current.add(reaction.id);
      const thrown = splitThrow(reaction.emoji);
      if (thrown && reaction.playerId !== undefined) {
        scene.arremessarEntre(reaction.playerId, thrown.targetId, thrown.kind);
      } else if (reaction.playerId !== undefined) {
        scene.reagirJogador(reaction.playerId, reaction.emoji);
      }
    }
  }, [props.reactions]);

  useEffect(() => {
    sceneRef.current?.setAto(activeAto);
  }, [activeAto]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
      const current = ATOS.findIndex((ato) => ato.id === activeAto);
      if (event.key === 'ArrowRight' || event.key === ']') {
        const next = ATOS[(current + 1) % ATOS.length].id;
        setCameraChoice({ key: cameraKey, ato: next }); sceneRef.current?.setAto(next);
      }
      if (event.key === 'ArrowLeft' || event.key === '[') {
        const next = ATOS[(current - 1 + ATOS.length) % ATOS.length].id;
        setCameraChoice({ key: cameraKey, ato: next }); sceneRef.current?.setAto(next);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [activeAto, cameraKey]);

  const toggleCard = (id: string) => setSelection((state) => {
    const current = state.key === selectionKey ? state.ids : [];
    if (current.includes(id)) return { key: selectionKey, ids: current.filter((cardId) => cardId !== id) };
    if (current.length >= pick) return { key: selectionKey, ids: pick === 1 ? [id] : current };
    return { key: selectionKey, ids: [...current, id] };
  });

  const changeAto = (ato: Ato) => {
    setCameraChoice({ key: cameraKey, ato });
    sceneRef.current?.setAto(ato);
  };

  if (webglError) {
    return <GameBoard {...props} />;
  }

  return (
    <div className="tribunal-game">
      <canvas ref={canvasRef} className="tribunal-canvas" aria-label="Tribunal 3D; use os botões de câmera ou as setas para mudar o enquadramento" />
      {loading && <div className="tribunal-loading"><strong>ABRINDO O PORÃO</strong><span>acendendo velas e escondendo provas…</span></div>}
      <div className="tribunal-crt" aria-hidden="true" />
      <div className="tribunal-vignette" aria-hidden="true" />
      {impact && <div key={impact.key} className={`tribunal-impact tribunal-impact--${impact.kind}`} aria-hidden="true" />}

      <div className="sr-only" aria-live="polite">
        Fase {gs.phase}, rodada {gs.round}. {gs.revealed.length} de {gs.submissions.length} provas reveladas.
      </div>

      {gs.blackCard && gs.phase !== 'game-end' && (
        <BlackEvidence text={gs.blackCard.text} pick={pick} round={gs.round} />
      )}
      <TimerDial gs={gs} />
      <ScoreRail gs={gs} myId={props.myId} />
      <CameraDock active={activeAto} onChange={changeAto} />

      {/* A demo mostra só o botão de som. Qualidade/tremor/volume viram gaveta:
          continuam acessíveis, mas param de parecer painel de laboratório. */}
      <div className="tribunal-settings-bar">
        <button
          onClick={() => {
            const next = !audioMuted;
            setAudioMuted(next);
            setMuted(next);
          }}
          aria-pressed={!audioMuted}
          title={audioMuted ? 'Ativar música e sons' : 'Silenciar música e sons'}
        >
          {audioMuted ? 'SOM OFF' : '♪ SOM'}
        </button>
        <button
          onClick={() => setShowSettings((value) => !value)}
          aria-expanded={showSettings}
          title="Ajustes de vídeo e volume"
        >
          ⚙
        </button>
      </div>

      <div className="tribunal-settings" hidden={!showSettings}>
        <label>
          <span>QUALIDADE</span>
          <select value={quality} onChange={(event) => setQuality(event.target.value as Qualidade3D)}>
            <option value="baixa">BAIXA</option><option value="media">MÉDIA</option><option value="alta">ALTA</option>
          </select>
        </label>
        <button onClick={() => setReducedMotion((value) => !value)} aria-pressed={reducedMotion}>
          TREMOR {reducedMotion ? 'OFF' : 'ON'}
        </button>
        <label className="tribunal-settings__volume">
          <span>VOLUME</span>
          <input
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={audioVolume}
            aria-label="Volume da música e dos sons"
            onChange={(event) => {
              const next = Number(event.target.value);
              setAudioVolume(next);
              setVolume(next);
              if (next > 0 && audioMuted) {
                setAudioMuted(false);
                setMuted(false);
              }
            }}
          />
        </label>
      </div>

      {gs.phase === 'submitting' && me && !iAmJudge && !submitted && (
        <WhiteHand
          cards={me.hand}
          selectedIds={selectedIds}
          pick={pick}
          onToggle={toggleCard}
          onSubmit={() => { props.onSubmit(selectedIds); setSelection({ key: selectionKey, ids: [] }); }}
        />
      )}
      {gs.phase === 'submitting' && (iAmJudge || submitted || !me) && (
        <div className="tribunal-status">
          <strong>{iAmJudge ? 'VOCÊ SEGURA O MARTELO' : submitted ? 'DEPOIMENTO LACRADO' : 'ASSISTINDO DA PLATEIA'}</strong>
          <span>{iAmJudge ? 'Aguarde as provas chegarem.' : `${gs.submissions.length} provas já chegaram à mesa.`}</span>
        </div>
      )}
      {gs.phase === 'judging' && (
        <ProofControls key={`${gs.round}:${gs.votingRound}:${gs.phaseStartedAt}`} gs={gs} myId={props.myId} onReveal={props.onReveal} onJudge={props.onJudge} onVote={props.onVote} />
      )}
      {gs.phase === 'round-end' && <RoundVerdict gs={gs} onNextRound={props.onNextRound} />}
      {gs.phase === 'game-end' && <Finale gs={gs} myId={props.myId} onRestart={props.onRestart} />}

      {gs.phase !== 'game-end' && <ReactionDock players={gs.players} myId={props.myId} onReact={props.onReact} />}
    </div>
  );
}
