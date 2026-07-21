'use client';
/**
 * MesaOnline — a mesa 3D do MULTIPLAYER, construída sobre a apresentação da
 * demo `/3d`. A cena 3D (modelos, cartas, martelo, final, lousa) é reconciliada
 * pela mesma engine, via `syncMesa(mesaView)` — idêntica à demo. Por cima entra
 * o HUD 2D da demo (AUTOS DO PROCESSO, leque de EVIDÊNCIAS, veredito, reações,
 * chat) e o teatro (cortes de câmera, falas, anúncios) disparado pelas
 * transições do GameState.
 *
 * A lógica de partida (revelar → julgar, voto em democracia, veredito, final)
 * vem do estado autoritativo do host; aqui só desenhamos e mandamos ações.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { GameBoard } from './GameBoard';
import {
  fillBlanks,
  getGameMode,
  voteCountFor,
  votingChoicesFor,
} from '@/lib/game';
import { projectMesaView } from '@/lib/three/mesaView';
import { isMuted, setMuted } from '@/lib/sounds';
import type { Ato, Reacao3D, RetroMesa } from '@/lib/three/retroMesa';
import type { BlackCard, ChatMessage, GameState, Reaction, WhiteCard } from '@/lib/types';

interface MesaOnlineProps {
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
  onSendChat: (text: string) => void;
}

type TimedState = GameState & {
  phaseEndsAt?: number;
  roundLimit?: number;
  winnerIds?: number[];
};

// ── constantes do HUD da demo (copiadas de /3d, sem alterar) ────────────────

const EMOTES_TELA = [
  { emoji: '💀', rotulo: 'MORRI' },
  { emoji: '🤣', rotulo: 'RINDO MUITO' },
  { emoji: '🤡', rotulo: 'PALHAÇO' },
  { emoji: '🗿', rotulo: 'CHAD DE PEDRA' },
  { emoji: '🤮', rotulo: 'QUE NOJO' },
  { emoji: '👀', rotulo: 'DE OLHO' },
  { emoji: '😵', rotulo: 'DERRETENDO' },
  { emoji: '🤨', rotulo: 'SUSPEITO' },
  { emoji: '💅', rotulo: 'SERVIU' },
  { emoji: '🍿', rotulo: 'SÓ ASSISTINDO' },
  { emoji: '🚩', rotulo: 'RED FLAG' },
  { emoji: '🔥', rotulo: 'PEGOU FOGO' },
  { emoji: '😭', rotulo: 'CHORANDO' },
  { emoji: '🎬', rotulo: 'CINEMA' },
  { emoji: '🧢', rotulo: 'É MENTIRA' },
  { emoji: '⚰️', rotulo: 'FOI DE BASE' },
  { emoji: '👏', rotulo: 'PALMAS' },
  { emoji: '🙈', rotulo: 'NEM VI' },
] as const;

const ARREMESSOS: { tipo: Reacao3D; emoji: string; rotulo: string }[] = [
  { tipo: 'tomate', emoji: '🍅', rotulo: 'TOMATE' },
  { tipo: 'sapato', emoji: '👞', rotulo: 'SAPATO' },
  { tipo: 'rosa', emoji: '🌹', rotulo: 'ROSA' },
];

const POSICOES_REACAO = [
  { esquerda: 26, topo: 31, giro: -7 },
  { esquerda: 62, topo: 27, giro: 6 },
  { esquerda: 44, topo: 46, giro: -3 },
  { esquerda: 70, topo: 51, giro: 8 },
  { esquerda: 31, topo: 55, giro: 4 },
] as const;

const ABERTURAS_RODADA = [
  'QUEM ESCREVEU ESSA PERGUNTA?',
  'EU JÁ QUERO TROCAR DE ADVOGADO.',
  'NINGUÉM ASSINA ESSA ATA.',
  'O PORÃO FICOU MAIS FRIO.',
  'ÚLTIMA RODADA. SEM CHORO.',
] as const;

type FaseVisual = 'jogando' | 'julgando' | 'condenado' | 'fim';

const ROTULO_FASE: Record<FaseVisual, string> = {
  jogando: 'JOGUEM SUAS CARTAS',
  julgando: 'O JÚRI LÊ AS PROVAS',
  condenado: 'SENTENÇA DADA',
  fim: 'TRIBUNAL ENCERRADO',
};

/**
 * A frase montada: a carta preta com cada lacuna `____` preenchida pela carta
 * branca correspondente, em vermelho. Sem lacuna, a resposta entra no fim.
 */
function FraseMontada({ black, cards }: { black: BlackCard; cards: WhiteCard[] }) {
  const respostas = cards.map((c) => c.text.replace(/\.$/, ''));
  const partes = black.text.split('____');
  if (partes.length === 1) {
    return (
      <>
        {black.text} <span className="text-red">{respostas.join(' ')}</span>
      </>
    );
  }
  return (
    <>
      {partes.map((parte, i) => (
        <span key={i}>
          {parte}
          {i < partes.length - 1 && (
            <span className="text-red">{respostas[i] ?? '____'}</span>
          )}
        </span>
      ))}
    </>
  );
}

interface ReacaoTela {
  id: number;
  emoji: string;
  rotulo: string;
  esquerda: number;
  topo: number;
  giro: number;
}

export function MesaOnline(props: MesaOnlineProps) {
  const gs = props.state as TimedState;
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const sceneRef = useRef<RetroMesa | null>(null);
  const view = useMemo(() => projectMesaView(gs, props.myId), [gs, props.myId]);
  const viewRef = useRef(view);
  const processedMessages = useRef(new Set<string>());
  const processedReactions = useRef(new Set<string>());
  const contadorReacaoRef = useRef(0);

  const [pronto, setPronto] = useState(false);
  const [webglError, setWebglError] = useState(false);
  const [somMudo, setSomMudo] = useState(false);
  const [anuncio, setAnuncio] = useState<{ texto: string; tipo: 'normal' | 'stamp'; duracao?: number } | null>(null);
  const [reacoesTela, setReacoesTela] = useState<ReacaoTela[]>([]);

  // roda de reações + chat (2D, como na demo)
  const [rodaAberta, setRodaAberta] = useState(false);
  const [chatAberto, setChatAberto] = useState(false);
  const [chatTexto, setChatTexto] = useState('');

  // ── derivações do estado ──
  const me = gs.players.find((player) => player.id === props.myId);
  const democracy = getGameMode(gs) === 'democracy';
  const iAmJudge = !democracy && gs.czarId === props.myId;
  const submitted = gs.submissions.some((submission) => submission.playerId === props.myId);
  const pick = gs.blackCard?.pick ?? 1;
  const pretaTexto = gs.blackCard?.text ?? '';
  const rodada = gs.round;

  const fase: FaseVisual =
    gs.phase === 'submitting' ? 'jogando'
      : gs.phase === 'judging' ? 'julgando'
        : gs.phase === 'round-end' ? 'condenado'
          : 'fim';

  // seleção da mão (por rodada+fase, pra resetar entre rodadas)
  const selectionKey = `${gs.round}:${gs.blackCard?.id ?? ''}:${gs.phase}`;
  const [selection, setSelection] = useState<{ key: string; ids: string[] }>({ key: '', ids: [] });
  const selectedIds = selection.key === selectionKey ? selection.ids : [];

  // seleção do juiz / voto (por fase)
  const [escolhaProva, setEscolhaProva] = useState<{ key: string; index: number | null }>({ key: '', index: null });
  const provaEscolhida = escolhaProva.key === selectionKey ? escolhaProva.index : null;

  // ── ciclo de vida da cena (idêntico à mesa que já funcionava) ──
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let disposed = false;
    const muteFrame = requestAnimationFrame(() => setSomMudo(isMuted()));
    const start = async () => {
      try {
        await document.fonts.ready;
        const { RetroMesa: Scene } = await import('@/lib/three/retroMesa');
        if (disposed) return;
        const scene = new Scene(canvas, {
          mesaView: viewRef.current,
          pixelSize: 1,
          qualidade: 'alta',
          onSelfImpact: (kind) => spawnReacaoTela(kind === 'tomate' ? '🍅' : kind === 'sapato' ? '👞' : '🌹', 'EM VOCÊ'),
        });
        const initialAto: Ato = viewRef.current.phase === 'judging'
          ? 'provas'
          : viewRef.current.phase === 'round-end'
            ? 'juiz'
            : viewRef.current.phase === 'game-end'
              ? 'mesa'
              : 'pov';
        scene.setAto(initialAto);
        sceneRef.current = scene;
        setPronto(true);
        const resize = () => scene.resize();
        window.addEventListener('resize', resize);
        (scene as RetroMesa & { __resize?: () => void }).__resize = resize;
      } catch (error) {
        console.error('Falha ao iniciar a mesa 3D', error);
        setWebglError(true);
        setPronto(true);
      }
    };
    void start();
    return () => {
      disposed = true;
      cancelAnimationFrame(muteFrame);
      const scene = sceneRef.current as (RetroMesa & { __resize?: () => void }) | null;
      if (scene?.__resize) window.removeEventListener('resize', scene.__resize);
      scene?.dispose();
      sceneRef.current = null;
    };
  }, []);

  // reconcilia a cena a cada mudança de estado
  useEffect(() => {
    viewRef.current = view;
    sceneRef.current?.syncMesa(view);
  }, [view]);

  // falas remotas viram balão no palco 3D (pula narração do sistema)
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    for (const message of props.messages.slice(-20)) {
      if (processedMessages.current.has(message.id)) continue;
      processedMessages.current.add(message.id);
      if (message.playerId < 0) continue;
      scene.falarJogador(message.playerId, message.text);
    }
  }, [props.messages]);

  // reações remotas: emoji flutuando na tela de todo mundo
  useEffect(() => {
    for (const reaction of props.reactions.slice(-24)) {
      if (processedReactions.current.has(reaction.id)) continue;
      processedReactions.current.add(reaction.id);
      const throwMatch = /^throw:(tomate|sapato|rosa):/.exec(reaction.emoji);
      const emoji = throwMatch
        ? (ARREMESSOS.find((a) => a.tipo === throwMatch[1])?.emoji ?? '🍅')
        : reaction.emoji;
      if (typeof reaction.playerId === 'number' && reaction.playerId >= 0) {
        sceneRef.current?.reagirJogador(reaction.playerId, emoji);
      }
      spawnReacaoTela(emoji, reaction.name);
    }
  }, [props.reactions]);

  // ── teatro: câmera + anúncio + fala nas transições de fase ──
  // Câmera e falas são efeitos colaterais em sistemas externos (a cena Three);
  // o anúncio é estado React, então é agendado (não setado no corpo do effect,
  // que dispararia render em cascata).
  const prevBeatRef = useRef('');
  const anuncioTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    const beat = `${gs.round}:${gs.phase}`;
    if (beat === prevBeatRef.current) return;
    const primeiraVez = prevBeatRef.current === '';
    prevBeatRef.current = beat;

    let anuncioNovo: { texto: string; tipo: 'normal' | 'stamp'; duracao?: number } | null = null;
    if (gs.phase === 'submitting') {
      scene.setAto('pov');
      if (!primeiraVez) anuncioNovo = { texto: `RODADA ${gs.round}`, tipo: 'normal', duracao: 900 };
      const plateia = gs.players.filter((p) => p.id !== props.myId && p.id !== gs.czarId && p.connected !== false);
      const orador = plateia[gs.round % Math.max(1, plateia.length)];
      if (orador) {
        const linha = ABERTURAS_RODADA[(gs.round - 1) % ABERTURAS_RODADA.length];
        window.setTimeout(() => scene.falarJogador(orador.id, linha), 900);
      }
    } else if (gs.phase === 'judging') {
      scene.setAto('provas');
      anuncioNovo = { texto: 'ABRINDO AS PROVAS', tipo: 'normal', duracao: 700 };
    } else if (gs.phase === 'round-end') {
      scene.setAto('juiz');
      const vencedor = gs.players.find((p) => p.id === gs.roundWinnerId);
      if (vencedor) anuncioNovo = { texto: `CULPADO: ${vencedor.name}`, tipo: 'stamp', duracao: 640 };
    } else if (gs.phase === 'game-end') {
      scene.setAto('mesa');
    }

    if (anuncioNovo) {
      if (anuncioTimerRef.current) clearTimeout(anuncioTimerRef.current);
      anuncioTimerRef.current = setTimeout(() => setAnuncio(anuncioNovo), 0);
    }
  }, [gs.round, gs.phase, gs.czarId, gs.roundWinnerId, gs.players, props.myId]);

  useEffect(() => () => {
    if (anuncioTimerRef.current) clearTimeout(anuncioTimerRef.current);
  }, []);

  // anúncios somem sozinhos
  useEffect(() => {
    if (!anuncio) return;
    const id = window.setTimeout(() => setAnuncio(null), anuncio.duracao ?? 2400);
    return () => window.clearTimeout(id);
  }, [anuncio]);

  function spawnReacaoTela(emoji: string, rotulo: string) {
    const id = ++contadorReacaoRef.current;
    const posicao = POSICOES_REACAO[(id - 1) % POSICOES_REACAO.length];
    setReacoesTela((atuais) => [...atuais.slice(-4), { id, emoji, rotulo, ...posicao }]);
    window.setTimeout(() => {
      setReacoesTela((atuais) => atuais.filter((reacao) => reacao.id !== id));
    }, 1700);
  }

  const trocarSom = () => {
    const novoMudo = !somMudo;
    setSomMudo(novoMudo);
    setMuted(novoMudo);
    sceneRef.current?.setSomAtivo(!novoMudo);
  };

  const alternarCarta = (id: string) => {
    setSelection((atual) => {
      const ids = atual.key === selectionKey ? atual.ids : [];
      if (ids.includes(id)) return { key: selectionKey, ids: ids.filter((x) => x !== id) };
      if (ids.length >= pick) return { key: selectionKey, ids: pick === 1 ? [id] : ids };
      return { key: selectionKey, ids: [...ids, id] };
    });
  };

  const enviarDepoimento = () => {
    if (selectedIds.length !== pick) return;
    props.onSubmit(selectedIds);
    setSelection({ key: selectionKey, ids: [] });
  };

  const reagirNaTela = (emoji: string) => {
    props.onReact(emoji);
    spawnReacaoTela(emoji, 'VOCÊ');
    setRodaAberta(false);
  };

  const arremessar = (tipo: Reacao3D) => {
    props.onReact(`throw:${tipo}:-1`);
    const emoji = ARREMESSOS.find((a) => a.tipo === tipo)?.emoji ?? '🍅';
    spawnReacaoTela(emoji, 'VOCÊ');
    setRodaAberta(false);
  };

  const enviarChat = (evento: React.FormEvent<HTMLFormElement>) => {
    evento.preventDefault();
    const texto = chatTexto.replace(/\s+/g, ' ').trim().slice(0, 90);
    if (!texto) return;
    props.onSendChat(texto);
    setChatTexto('');
  };

  if (webglError) {
    return <GameBoard {...props} />;
  }

  // ── dados do julgamento / veredito ──
  const nextSealed = gs.submissions.findIndex((_, index) => !gs.revealed.includes(index));
  const todasReveladas = gs.submissions.length > 0 && nextSealed < 0;
  const meuVoto = gs.votes.find((voto) => voto.voterId === props.myId);
  const escolhasVoto = democracy ? votingChoicesFor(gs, props.myId) : [];

  // última prova revelada (painel de leitura, estilo demo)
  const ultimaRevelada = gs.revealed.length > 0 ? gs.revealed[gs.revealed.length - 1] : -1;
  const provaLida = ultimaRevelada >= 0 ? gs.submissions[ultimaRevelada] : null;

  const vencedor = gs.players.find((player) => player.id === gs.roundWinnerId);
  const provaVencedora = gs.submissions.find((submission) => submission.playerId === gs.roundWinnerId);
  const placarOrdenado = [...gs.players].sort((a, b) => b.score - a.score || a.id - b.id);
  const scoreLimit = gs.scoreLimit;

  return (
    <div className="fixed inset-0 table-bg overflow-hidden">
      <canvas
        ref={canvasRef}
        className="absolute inset-0 w-full h-full"
        style={{ imageRendering: 'pixelated', touchAction: 'pan-y', cursor: 'grab' }}
        aria-label="Mesa 3D; arraste para olhar ao redor"
      />

      {/* topo centro: a rodada */}
      <div className="absolute top-0 inset-x-0 flex justify-center p-4 sm:p-6 pointer-events-none">
        <div className="bg-ink/90 border border-paper/20 px-4 py-2 text-center shadow-[4px_5px_0_rgba(0,0,0,.48)]">
          <p className="font-display text-paper text-[13px] tracking-wide">
            RODADA {rodada}
            <span className="text-paper/40"> · até {scoreLimit}</span>
          </p>
          <p className="text-red text-[9px] font-bold tracking-[0.18em] uppercase mt-0.5">
            {ROTULO_FASE[fase]}
          </p>
        </div>
      </div>

      {/* topo direito: só o som, como a demo */}
      <div className="absolute top-0 right-0 p-4 sm:p-6 pointer-events-auto">
        <button
          onClick={trocarSom}
          aria-label={somMudo ? 'Ativar som' : 'Silenciar som'}
          className="h-9 px-3 bg-ink/90 text-paper/70 border border-paper/20 hover:text-paper hover:border-paper/40 active:translate-y-0.5 font-black text-[9px] tracking-[0.16em] shadow-[3px_4px_0_rgba(0,0,0,.4)] transition-all"
        >
          {somMudo ? 'SOM OFF' : '♪ SOM'}
        </button>
      </div>

      {/* A pergunta: processo físico legível (submitting + julgando) */}
      {(fase === 'jogando' || fase === 'julgando') && pretaTexto && (
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
                AUTOS DO PROCESSO • {String(rodada).padStart(2, '0')}
              </span>
              <span className="text-paper/30 text-[7px] font-mono tracking-widest">SP-{2026 + rodada}-P</span>
            </div>
            <p className="font-display text-paper text-[17px] sm:text-[21px] leading-[1.18] pr-3">
              {pretaTexto}
            </p>
            <div className="mt-2 flex items-center gap-2 text-[8px] font-bold tracking-[0.18em] uppercase text-paper/38">
              <span className="h-px flex-1 bg-paper/15" />
              {fase === 'jogando'
                ? (pick > 1 ? `escolha ${pick} provas abaixo` : 'escolha a prova abaixo')
                : (iAmJudge ? 'o martelo é seu' : 'o júri delibera')}
              <span className="h-px w-5 bg-red/70" />
            </div>
          </article>
        </div>
      )}

      {(fase === 'jogando' || fase === 'julgando') && (
        <p className="absolute top-[12.6rem] sm:top-[13.4rem] inset-x-0 text-center pointer-events-none text-paper/35 text-[7px] font-black tracking-[0.2em] uppercase z-10">
          arraste para olhar ao redor • sua cadeira não se move
        </p>
      )}

      {/* anúncio central */}
      {anuncio && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-20">
          {anuncio.tipo === 'stamp' ? (
            <div className="stamp text-3xl sm:text-5xl">{anuncio.texto}</div>
          ) : (
            <h2 className="font-display text-paper text-4xl sm:text-6xl text-center card-in drop-shadow-[0_6px_28px_rgba(0,0,0,0.95)]">
              {anuncio.texto}
            </h2>
          )}
        </div>
      )}

      {/* reações de tela */}
      <div className="absolute inset-0 pointer-events-none z-30 overflow-hidden" aria-live="polite">
        {reacoesTela.map((reacao) => (
          <div
            key={reacao.id}
            className="absolute card-in"
            style={{ left: `${reacao.esquerda}%`, top: `${reacao.topo}%`, rotate: `${reacao.giro}deg` }}
          >
            <div className="relative bg-[#e7decc] text-ink border-2 border-ink px-3 py-1.5 shadow-[4px_5px_0_rgba(23,22,26,0.8)]">
              <span className="text-3xl leading-none">{reacao.emoji}</span>
              <span className="block mt-1 text-[7px] font-black tracking-[0.15em] text-center uppercase">{reacao.rotulo}</span>
              <span className="absolute -bottom-2 left-3 h-3 w-3 bg-[#e7decc] border-b-2 border-r-2 border-ink rotate-45" />
            </div>
          </div>
        ))}
      </div>

      {/* JULGAMENTO — painel de leitura + provas seladas + controle */}
      {fase === 'julgando' && (
        <>
          {provaLida && provaLida.cards.length > 0 && gs.blackCard && (
            <div
              key={`${ultimaRevelada}-${provaLida.cards[0]?.id ?? ''}`}
              className="absolute bottom-48 sm:bottom-8 left-1/2 -translate-x-1/2 pointer-events-none reveal-in z-10 w-[min(36rem,90vw)]"
            >
              <div
                className="relative bg-[#141318]/95 text-paper border border-paper/25 px-5 py-3.5 shadow-[6px_8px_0_rgba(0,0,0,0.52)]"
                style={{ clipPath: 'polygon(0 3%, 98.5% 0, 100% 92%, 97% 100%, 1% 98%)' }}
              >
                <div className="flex items-center justify-between mb-2 text-[8px] font-black tracking-[0.2em] uppercase">
                  <span className="text-red">PROVA {String(gs.revealed.length).padStart(2, '0')}</span>
                  <span className="text-paper/35">DE {gs.submissions.length} • LEITURA EM CURSO</span>
                </div>
                <p className="text-[14px] sm:text-[16px] font-bold leading-snug">
                  <FraseMontada black={gs.blackCard} cards={provaLida.cards} />
                </p>
                <p className="text-paper/45 text-[8px] font-bold tracking-[0.2em] uppercase mt-2 text-right">— AUTORIA SOB SIGILO</p>
                <div className="flex gap-1 mt-2">
                  {gs.submissions.map((_, index) => (
                    <span key={index} className={`h-1 flex-1 ${gs.revealed.includes(index) ? 'bg-red' : 'bg-paper/15'}`} />
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* provas seladas + controle do juiz / voto */}
          <div className="absolute bottom-0 inset-x-0 p-3 sm:p-4 pointer-events-auto z-10">
            <div className="mx-auto w-[min(50rem,96vw)] bg-[#111015]/95 border border-paper/25 shadow-[7px_9px_0_rgba(0,0,0,0.45)]">
              <header className="flex items-center justify-between px-4 py-2 border-b border-paper/15">
                <span className="text-red text-[9px] font-black tracking-[0.2em] uppercase">
                  {democracy ? 'URNA DO TRIBUNAL' : iAmJudge ? 'SEU VEREDITO' : 'PROVAS SOB SIGILO'}
                </span>
                <span className="text-paper/40 text-[9px] font-mono">{gs.revealed.length}/{gs.submissions.length}</span>
              </header>
              <div className="flex gap-2 overflow-x-auto px-4 py-3">
                {gs.submissions.map((submission, index) => {
                  const aberta = democracy || gs.revealed.includes(index);
                  const selecionavel = aberta && (democracy ? escolhasVoto.includes(index) && !meuVoto : iAmJudge && todasReveladas);
                  const escolhida = provaEscolhida === index;
                  return (
                    <button
                      key={index}
                      disabled={!selecionavel}
                      onClick={() => selecionavel && setEscolhaProva({ key: selectionKey, index })}
                      className={`shrink-0 w-[9.5rem] min-h-[6.5rem] border-2 p-2.5 text-left flex flex-col transition-all ${
                        aberta
                          ? `bg-[#e7decc] text-ink ${escolhida ? 'border-red -translate-y-1' : 'border-[#19171a]'} ${selecionavel ? 'hover:-translate-y-1 cursor-pointer' : ''}`
                          : 'bg-[#1b1a20] text-paper/40 border-paper/15'
                      }`}
                    >
                      <span className={`text-[6px] font-black tracking-[0.2em] uppercase mb-1 ${aberta ? 'text-red' : 'text-paper/35'}`}>
                        PROVA {String(index + 1).padStart(2, '0')}
                      </span>
                      <span className="text-[10px] font-black leading-[1.16] flex-1">
                        {aberta && gs.blackCard ? fillBlanks(gs.blackCard, submission.cards) : 'CONTEÚDO LACRADO'}
                      </span>
                      {democracy && gs.phase === 'round-end' && (
                        <span className="text-[7px] font-black text-red mt-1">{voteCountFor(gs, index)} votos</span>
                      )}
                    </button>
                  );
                })}
              </div>
              <div className="px-4 pb-3">
                {!democracy && iAmJudge && !todasReveladas && (
                  <button
                    onClick={() => nextSealed >= 0 && props.onReveal(nextSealed)}
                    className="btn-red w-full h-11 border-2 border-ink font-display text-[13px] tracking-wide shadow-[4px_5px_0_#17161a] active:translate-y-1 active:shadow-none transition-all"
                  >
                    REVELAR PRÓXIMA PROVA
                  </button>
                )}
                {!democracy && iAmJudge && todasReveladas && (
                  <button
                    disabled={provaEscolhida === null}
                    onClick={() => provaEscolhida !== null && props.onJudge(provaEscolhida)}
                    className="btn-red w-full h-11 border-2 border-ink font-display text-[13px] tracking-wide shadow-[4px_5px_0_#17161a] active:translate-y-1 active:shadow-none transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {provaEscolhida === null ? 'ESCOLHA O CULPADO' : 'CRAVAR VEREDITO'}
                  </button>
                )}
                {!democracy && !iAmJudge && (
                  <p className="text-center text-paper/45 text-[10px] font-bold tracking-[0.14em] uppercase">
                    o juiz lê as provas…
                  </p>
                )}
                {democracy && !meuVoto && (
                  <button
                    disabled={provaEscolhida === null}
                    onClick={() => provaEscolhida !== null && props.onVote(provaEscolhida, gs.phaseStartedAt)}
                    className="btn-red w-full h-11 border-2 border-ink font-display text-[13px] tracking-wide shadow-[4px_5px_0_#17161a] active:translate-y-1 active:shadow-none transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {provaEscolhida === null ? 'ESCOLHA UMA PROVA' : 'LACRAR MEU VOTO'}
                  </button>
                )}
                {democracy && meuVoto && (
                  <p className="text-center text-paper/45 text-[10px] font-bold tracking-[0.14em] uppercase">
                    voto lacrado · aguardando a mesa
                  </p>
                )}
              </div>
            </div>
          </div>
        </>
      )}

      {/* VEREDITO da rodada — prova condenatória + placar (estilo demo) */}
      {fase === 'condenado' && (
        <div className="absolute inset-x-0 top-[5.2rem] bottom-[7rem] sm:bottom-16 flex items-center justify-center px-3 pointer-events-none z-10">
          <section className="w-[min(48rem,95vw)] grid sm:grid-cols-[1.45fr_0.75fr] gap-2 sm:gap-3 card-in">
            <div className="relative flex bg-[#111015]/95 border border-paper/25 p-3 sm:p-4 shadow-[8px_10px_0_rgba(0,0,0,0.48)]">
              <div
                className="relative h-full min-h-40 flex-1 bg-[#e5dccb] text-ink border-2 border-ink px-4 py-4 sm:px-5 shadow-[4px_5px_0_#ff3b2f]"
                style={{
                  clipPath: 'polygon(1% 0, 98% 1.5%, 100% 95%, 96% 100%, 2% 98%, 0 5%)',
                  backgroundImage: 'radial-gradient(circle at 78% 18%,rgba(91,55,32,.10) 0 2px,transparent 3px),repeating-linear-gradient(2deg,rgba(45,36,26,.025) 0 1px,transparent 1px 5px)',
                }}
              >
                <p className="text-[8px] font-black tracking-[0.22em] uppercase text-red mb-3">
                  PROVA CONDENATÓRIA • RODADA {rodada}
                </p>
                <p className="text-[15px] sm:text-[18px] font-black leading-[1.18]">
                  {provaVencedora && gs.blackCard
                    ? <FraseMontada black={gs.blackCard} cards={provaVencedora.cards} />
                    : 'PROVA CONFISCADA PELO TRIBUNAL'}
                </p>
                <div className="absolute bottom-3 inset-x-4 flex items-end justify-between gap-3 border-t border-ink/20 pt-2">
                  <div>
                    <p className="text-[6px] font-black tracking-[0.18em] uppercase text-ink/45">AUTORIA CONFESSA</p>
                    <p className="font-display text-[15px] leading-none">{vencedor?.name ?? 'DESCONHECIDO'}</p>
                  </div>
                  <span className="stamp !text-[11px] !border-2 !px-1.5 !bg-transparent">CULPADO</span>
                </div>
              </div>
            </div>

            <aside className="bg-[#111015]/95 border border-paper/25 p-3 shadow-[6px_8px_0_rgba(0,0,0,0.42)]">
              <div className="flex items-center justify-between border-b border-paper/15 pb-2 mb-2">
                <p className="font-display text-paper text-[12px] tracking-wide">PLACAR DO PORÃO</p>
                <span className="bg-red text-ink px-1.5 py-0.5 text-[8px] font-black">+1</span>
              </div>
              <ol className="grid grid-cols-2 sm:grid-cols-1 gap-x-3 gap-y-1">
                {placarOrdenado.map((player, index) => (
                  <li
                    key={player.id}
                    className={`flex items-center gap-2 min-w-0 py-0.5 ${player.id === gs.roundWinnerId ? 'text-red' : 'text-paper/65'}`}
                  >
                    <span className="w-3 text-[8px] font-mono text-paper/25">{index + 1}</span>
                    <span className="flex-1 truncate text-[9px] font-black tracking-[0.1em]">{player.name}</span>
                    <span className={`font-display text-[13px] ${player.id === gs.roundWinnerId ? 'score-pop' : ''}`}>{player.score}</span>
                  </li>
                ))}
              </ol>
              <p className="mt-2 pt-2 border-t border-paper/10 text-[7px] text-paper/30 tracking-[0.16em] uppercase">
                primeiro a {scoreLimit} escapa da custódia
              </p>
            </aside>
          </section>
        </div>
      )}

      {/* FINAL da partida */}
      {fase === 'fim' && (
        <Finale gs={gs} myId={props.myId} onRestart={props.onRestart} />
      )}

      {/* roda de reações (bottom-left ☠) */}
      <div className="absolute bottom-40 sm:bottom-0 left-0 p-3 sm:p-6 pointer-events-auto z-10">
        {rodaAberta && (
          <div className="w-[248px] mb-2 bg-[#121116]/95 border border-paper/20 p-2.5 shadow-[5px_6px_0_rgba(0,0,0,.45)]">
            <p className="text-paper/45 text-[7px] font-black tracking-[0.22em] uppercase mb-1.5">REAÇÕES</p>
            <div className="grid grid-cols-6 gap-1">
              {EMOTES_TELA.map(({ emoji, rotulo }) => (
                <button
                  key={emoji}
                  onClick={() => reagirNaTela(emoji)}
                  title={rotulo}
                  aria-label={rotulo}
                  className="h-10 bg-paper/5 border border-paper/10 hover:bg-paper/15 hover:border-paper/25 active:scale-90 transition-all flex items-center justify-center"
                >
                  <span className="text-xl leading-none">{emoji}</span>
                </button>
              ))}
            </div>
            <p className="text-red/75 text-[7px] font-black tracking-[0.22em] uppercase mt-2.5 mb-1.5 border-t border-paper/10 pt-2">ARREMESSAR</p>
            <div className="grid grid-cols-3 gap-1">
              {ARREMESSOS.map(({ tipo, emoji, rotulo }) => (
                <button
                  key={tipo}
                  onClick={() => arremessar(tipo)}
                  className="h-11 bg-red/8 text-paper/80 border border-red/30 hover:bg-red hover:text-ink active:scale-90 font-bold text-[7px] tracking-wider transition-all flex flex-col items-center justify-center"
                >
                  <span className="text-base leading-none">{emoji}</span>
                  <span className="mt-1">{rotulo}</span>
                </button>
              ))}
            </div>
          </div>
        )}
        <button
          onClick={() => setRodaAberta((v) => !v)}
          aria-label="Abrir reações"
          className={`h-12 w-12 border text-xl transition-all active:scale-90 shadow-[4px_5px_0_rgba(0,0,0,.45)] ${
            rodaAberta ? 'btn-red border-transparent' : 'bg-ink/85 border-white/20 hover:bg-ink text-paper'
          }`}
        >
          ☠
        </button>
      </div>

      {/* chat da audiência (bottom-right) */}
      <div className="absolute bottom-[13.5rem] sm:bottom-[4.8rem] right-0 p-3 sm:p-6 pointer-events-auto z-20">
        {chatAberto && (
          <section className="w-[min(18rem,calc(100vw-1.5rem))] mb-2 bg-[#111015]/95 border border-paper/25 shadow-[6px_8px_0_rgba(0,0,0,.5)]">
            <header className="flex items-center justify-between gap-3 px-3 py-2 border-b border-paper/15">
              <div>
                <p className="font-display text-paper text-[10px] tracking-[0.12em]">CHAT DA AUDIÊNCIA</p>
                <p className="text-red text-[6px] font-black tracking-[0.2em] uppercase mt-0.5">consta nos autos</p>
              </div>
              <button
                type="button"
                onClick={() => setChatAberto(false)}
                className="h-6 w-6 border border-paper/15 text-paper/45 hover:text-paper hover:border-paper/35 text-xs"
                aria-label="Fechar chat"
              >
                ×
              </button>
            </header>
            <div className="h-36 overflow-y-auto px-3 py-2 space-y-2" aria-live="polite">
              {props.messages.slice(-7).map((mensagem) => {
                const meu = mensagem.playerId === props.myId;
                return (
                  <div key={mensagem.id} className={meu ? 'text-right' : ''}>
                    <p className={`text-[6px] font-black tracking-[0.17em] uppercase ${meu ? 'text-red' : 'text-paper/35'}`}>
                      {meu ? 'VOCÊ' : mensagem.name}
                    </p>
                    <p className={`inline-block max-w-[92%] mt-0.5 px-2 py-1.5 text-left text-[9px] font-bold leading-snug border ${meu ? 'bg-red text-ink border-red' : 'bg-paper/[.06] text-paper/78 border-paper/10'}`}>
                      {mensagem.text}
                    </p>
                  </div>
                );
              })}
            </div>
            <form onSubmit={enviarChat} className="flex gap-1.5 p-2 border-t border-paper/15">
              <input
                value={chatTexto}
                onChange={(evento) => setChatTexto(evento.target.value)}
                maxLength={90}
                placeholder="deponha sem pensar…"
                aria-label="Mensagem do chat"
                className="min-w-0 flex-1 h-9 bg-paper/[.06] border border-paper/15 px-2.5 text-paper text-[10px] font-bold outline-none placeholder:text-paper/25 focus:border-red"
              />
              <button
                type="submit"
                disabled={!chatTexto.trim()}
                className="h-9 px-3 bg-red text-ink border border-red font-black text-[8px] tracking-[0.14em] disabled:opacity-35"
              >
                FALAR
              </button>
            </form>
          </section>
        )}
        <button
          type="button"
          onClick={() => setChatAberto((aberto) => !aberto)}
          aria-expanded={chatAberto}
          className={`ml-auto flex h-10 items-center gap-2 border px-3 font-black text-[8px] tracking-[0.16em] shadow-[4px_5px_0_rgba(0,0,0,.45)] transition-colors ${chatAberto ? 'bg-red text-ink border-red' : 'bg-ink/90 text-paper border-paper/20 hover:border-paper/45'}`}
        >
          <span className="text-sm leading-none">▰</span>
          CHAT
          <span className="bg-paper/10 px-1 py-0.5 font-mono text-[7px]">{Math.min(props.messages.length, 99)}</span>
        </button>
      </div>

      {/* A SUA MÃO — cartas legíveis (submitting, se você não é juiz e ainda não jogou) */}
      {fase === 'jogando' && me && !iAmJudge && !submitted && (
        <div className="absolute bottom-0 left-1/2 -translate-x-1/2 pb-1.5 sm:pb-2 pointer-events-auto w-[calc(100vw-1rem)] sm:w-auto max-w-[calc(100vw-1rem)] sm:max-w-[58vw]">
          <div className="flex justify-start sm:justify-center overflow-x-auto px-4 pt-7 pb-2">
            {me.hand.map((card: WhiteCard, i) => {
              const selIndex = selectedIds.indexOf(card.id);
              const sel = selIndex >= 0;
              return (
                <div
                  key={card.id}
                  className="relative shrink-0"
                  style={{
                    marginLeft: i === 0 ? 0 : '-1.05rem',
                    transform: `rotate(${((i % 5) - 2) * 1.15}deg) translateY(${i % 2 ? 2 : 0}px)`,
                    zIndex: sel ? 30 : i,
                  }}
                >
                  <button
                    onClick={() => alternarCarta(card.id)}
                    aria-pressed={sel}
                    aria-label={`Jogar carta: ${card.text}`}
                    className={`group relative w-[6.35rem] h-[9.25rem] sm:w-[7rem] sm:h-[10.2rem] bg-[#e7decc] border-2 p-2.5 sm:p-3 text-left flex flex-col transition-transform duration-150 hover:-translate-y-5 hover:z-20 active:translate-y-0 active:scale-95 shadow-[3px_4px_0_#17161a,0_18px_30px_-14px_rgba(0,0,0,0.95)] overflow-hidden ${sel ? 'border-red -translate-y-5' : 'border-[#19171a]'}`}
                    style={{
                      clipPath: 'polygon(1% 0, 97% 1%, 100% 5%, 98% 96%, 94% 100%, 2% 98%, 0 6%)',
                      backgroundImage: 'radial-gradient(circle at 82% 16%,rgba(91,55,32,.10) 0 2px,transparent 3px),repeating-linear-gradient(3deg,rgba(45,36,26,.024) 0 1px,transparent 1px 5px)',
                    }}
                  >
                    <span className="absolute -top-1 right-2 w-5 h-3 bg-red/65 rotate-3 opacity-70" />
                    {sel && pick > 1 && (
                      <span className="absolute top-1.5 right-1.5 w-4 h-4 bg-red text-white text-[9px] font-black flex items-center justify-center">
                        {selIndex + 1}
                      </span>
                    )}
                    <span className="text-[6px] font-black tracking-[0.2em] text-red uppercase border-b border-ink/15 pb-1 mb-1.5">
                      EVIDÊNCIA {String(i + 1).padStart(2, '0')}
                    </span>
                    <span className="text-[10.5px] sm:text-[11px] font-black text-ink leading-[1.18] flex-1 overflow-hidden">
                      {card.text}
                    </span>
                    <span className="flex items-end justify-between gap-1 text-[5.5px] font-black tracking-[0.14em] text-ink/42 mt-1 border-t border-ink/15 pt-1">
                      <span>SEM PERDÃO<span className="text-red">*</span></span>
                      <span className="font-mono">#{rodada}{String(i + 1).padStart(2, '0')}</span>
                    </span>
                    <span className="absolute inset-1 border border-ink/[0.06] pointer-events-none" />
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ação principal (bottom-right) */}
      <div className="absolute bottom-40 sm:bottom-0 right-0 p-3 sm:p-6 pointer-events-auto z-10" style={{ marginBottom: '3.5rem' }}>
        {fase === 'jogando' && me && !iAmJudge && !submitted && (
          <button
            onClick={enviarDepoimento}
            disabled={selectedIds.length !== pick}
            className="btn-red h-12 px-5 border-2 border-ink font-display text-[14px] tracking-wide shadow-[4px_5px_0_#17161a] active:translate-y-1 active:shadow-none transition-all disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {selectedIds.length === pick ? 'LACRAR DEPOIMENTO' : `ESCOLHA ${pick - selectedIds.length}`}
          </button>
        )}
        {fase === 'jogando' && (iAmJudge || submitted) && (
          <div className="bg-ink/85 border border-paper/20 px-4 py-2.5 text-right shadow-[4px_5px_0_rgba(0,0,0,.45)]">
            <p className="font-display text-paper text-[13px]">{iAmJudge ? 'VOCÊ SEGURA O MARTELO' : 'DEPOIMENTO LACRADO'}</p>
            <p className="text-red text-[8px] font-black tracking-[0.16em] uppercase mt-0.5">
              {gs.submissions.length} provas na mesa
            </p>
          </div>
        )}
        {fase === 'condenado' && (
          <button
            onClick={props.onNextRound}
            className="btn-red h-12 px-5 border-2 border-ink font-display text-[14px] tracking-wide shadow-[4px_5px_0_#17161a] active:translate-y-1 active:shadow-none transition-all"
          >
            PRÓXIMA RODADA →
          </button>
        )}
      </div>

      {!pronto && (
        <div className="absolute inset-0 flex items-center justify-center">
          <p className="font-display text-paper/60 text-sm tracking-widest">CARREGANDO A MESA…</p>
        </div>
      )}
    </div>
  );
}

// ── final da partida (overlay) ──
function Finale({ gs, myId, onRestart }: { gs: TimedState; myId: number; onRestart: () => void }) {
  const ranked = [...gs.players].sort((a, b) => b.score - a.score || a.id - b.id);
  const winnerIds = gs.winnerIds?.length ? gs.winnerIds : (gs.winner ? [gs.winner.id] : []);
  const winner = ranked.find((player) => winnerIds.includes(player.id)) ?? ranked[0];
  const didIWin = winnerIds.includes(myId);
  return (
    <div className="absolute inset-0 z-40 flex flex-col items-center justify-center px-4 pointer-events-auto bg-[rgba(16,15,19,0.72)] backdrop-blur-[2px]">
      <span className="text-red text-[10px] font-black tracking-[0.3em] uppercase mb-2">O TRIBUNAL DECIDIU</span>
      <h1 className="font-display text-paper text-5xl sm:text-7xl text-center leading-none card-in drop-shadow-[0_6px_28px_rgba(0,0,0,0.95)]">
        {winner?.name ?? 'NINGUÉM'}
      </h1>
      <p className="text-paper/70 text-[13px] font-bold mt-3 text-center">
        {didIWin ? 'VOCÊ SOBREVIVEU AO JULGAMENTO.' : 'CULPADO DE SER A PIOR PESSOA DA MESA.'}
      </p>
      <div className="mt-6 w-[min(22rem,90vw)] bg-[#111015]/95 border border-paper/25 p-3 shadow-[6px_8px_0_rgba(0,0,0,0.42)]">
        {ranked.map((player, index) => (
          <div
            key={player.id}
            className={`flex items-center gap-3 py-1 ${winnerIds.includes(player.id) ? 'text-red' : 'text-paper/70'}`}
          >
            <i className="w-4 text-[9px] font-mono not-italic text-paper/30">{index + 1}</i>
            <span className="flex-1 truncate text-[11px] font-black tracking-[0.1em]">{player.name}</span>
            <strong className="font-display text-[15px]">{player.score}</strong>
          </div>
        ))}
      </div>
      <button
        onClick={onRestart}
        className="btn-red h-12 px-6 mt-6 border-2 border-ink font-display text-[14px] tracking-wide shadow-[4px_5px_0_#17161a] active:translate-y-1 active:shadow-none transition-all"
      >
        SAIR DO PORÃO
      </button>
    </div>
  );
}
