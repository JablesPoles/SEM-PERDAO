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

function BlackEvidence({ text, pick }: { text: string; pick: number }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className="tribunal-black-card" onClick={() => setOpen(true)} aria-haspopup="dialog">
        <span>PROVA DO CRIME · {pick > 1 ? `${pick} RESPOSTAS` : '1 RESPOSTA'}</span>
        <strong>{text}</strong>
        <small>TOQUE PARA AMPLIAR</small>
      </button>
      {open && (
        <div className="tribunal-modal" role="dialog" aria-modal="true" aria-label="Carta preta da rodada" onClick={() => setOpen(false)}>
          <div className="tribunal-modal__black" onClick={(event) => event.stopPropagation()}>
            <span>RODADA EM JULGAMENTO</span>
            <strong>{text}</strong>
            <button onClick={() => setOpen(false)}>FECHAR ×</button>
          </div>
        </div>
      )}
    </>
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
    <section className="tribunal-hand" aria-label="Sua mão de cartas">
      <header>
        <span>SUA DEFESA · ESCOLHA {pick}</span>
        <span>{selectedIds.length}/{pick}</span>
      </header>
      <div className="tribunal-hand__cards">
        {cards.map((card, index) => {
          const selectedIndex = selectedIds.indexOf(card.id);
          return (
            <button
              key={card.id}
              className={selectedIndex >= 0 ? 'is-selected' : ''}
              style={{ '--card-tilt': `${((index % 5) - 2) * 0.7}deg` } as React.CSSProperties}
              onClick={() => onToggle(card.id)}
              aria-pressed={selectedIndex >= 0}
            >
              {selectedIndex >= 0 && <i>{selectedIndex + 1}</i>}
              <strong>{card.text}</strong>
              <small>SEM PERDÃO*</small>
            </button>
          );
        })}
      </div>
      <button className="tribunal-confirm" disabled={selectedIds.length !== pick} onClick={onSubmit}>
        {selectedIds.length === pick ? 'LACRAR DEPOIMENTO' : `SELECIONE ${pick - selectedIds.length}`}
      </button>
    </section>
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
  // A mesa aberta é o enquadramento-assinatura do jogo (o mesmo da demo em
  // /3d, que é o default da engine). O POV continua a um clique/seta de
  // distância, mas deixou de ser a primeira coisa que se vê.
  const defaultAto: Ato = gs.phase === 'round-end' ? 'juiz' : 'mesa';
  const [cameraChoice, setCameraChoice] = useState<{ key: string; ato: Ato }>({ key: '', ato: 'mesa' });
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
        const initialAto: Ato = viewRef.current.phase === 'round-end'
          ? 'juiz'
          : 'mesa';
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

      {gs.blackCard && gs.phase !== 'game-end' && <BlackEvidence text={gs.blackCard.text} pick={pick} />}
      <TimerDial gs={gs} />
      <ScoreRail gs={gs} myId={props.myId} />
      <CameraDock active={activeAto} onChange={changeAto} />

      <div className="tribunal-settings">
        <label>
          <span>QUALIDADE</span>
          <select value={quality} onChange={(event) => setQuality(event.target.value as Qualidade3D)}>
            <option value="baixa">BAIXA</option><option value="media">MÉDIA</option><option value="alta">ALTA</option>
          </select>
        </label>
        <button onClick={() => setReducedMotion((value) => !value)} aria-pressed={reducedMotion}>
          TREMOR {reducedMotion ? 'OFF' : 'ON'}
        </button>
        <button
          onClick={() => {
            const next = !audioMuted;
            setAudioMuted(next);
            setMuted(next);
          }}
          aria-pressed={!audioMuted}
          title={audioMuted ? 'Ativar música e sons' : 'Silenciar música e sons'}
        >
          SOM {audioMuted ? 'OFF' : 'ON'}
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
