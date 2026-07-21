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
import { setMusicScene, startAmbience, stopAllMusic } from '@/lib/music';
import { narrate, preloadNarration, type NarrationEvent } from '@/lib/narrator';
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

const INTERJEICOES = [
  'ISSO É PROVA OU PEDIDO DE SOCORRO?',
  'EU NÃO QUERO SER ASSOCIADO A ISSO.',
  'MERITÍSSIMO, PODE PRENDER.',
  'O RH JÁ FOI EMBORA, NÉ?',
  'CINEMA. ABSOLUTO CINEMA.',
  'ESSA ATA VAI SUMIR.',
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
  const [arremessoPendente, setArremessoPendente] = useState<Reacao3D | null>(null);
  const [chatAberto, setChatAberto] = useState(false);
  const [chatTexto, setChatTexto] = useState('');
  const [placarAberto, setPlacarAberto] = useState(false);
  // contagem do auto-avanço no fim da rodada (o botão vira "apressar")
  const [resultRestante, setResultRestante] = useState(0);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setPlacarAberto(false);
      setChatAberto(false);
      setRodaAberta(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Os painéis 2D de resultado esperam o teatro 3D acontecer primeiro: o
  // martelo cair e carimbar CULPADO no veredito; o blackout, holofote e confete
  // no encerramento. `beatPronto` guarda a fase:rodada já liberada; enquanto o
  // beat atual não bate, o painel fica de fora e a cena aparece sozinha.
  const [beatPronto, setBeatPronto] = useState('');

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

  // carimbo 2D efêmero que flutua na tela (reação/arremesso)
  const spawnReacaoTela = (emoji: string, rotulo: string) => {
    const id = ++contadorReacaoRef.current;
    const posicao = POSICOES_REACAO[(id - 1) % POSICOES_REACAO.length];
    setReacoesTela((atuais) => [...atuais.slice(-4), { id, emoji, rotulo, ...posicao }]);
    window.setTimeout(() => {
      setReacoesTela((atuais) => atuais.filter((reacao) => reacao.id !== id));
    }, 1700);
  };

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
    // trilha do porão: ambiente por baixo + falas prontas (no-op se sem áudio)
    startAmbience();
    preloadNarration();
    return () => {
      disposed = true;
      cancelAnimationFrame(muteFrame);
      stopAllMusic();
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

  // reações remotas (inclui o eco das suas): arremessos viram objeto voando na
  // mesa 3D (origem→alvo), emotes viram balão no réu + carimbo 2D flutuante.
  useEffect(() => {
    const scene = sceneRef.current;
    for (const reaction of props.reactions.slice(-24)) {
      if (processedReactions.current.has(reaction.id)) continue;
      processedReactions.current.add(reaction.id);
      const origem = typeof reaction.playerId === 'number' ? reaction.playerId : -1;
      const arremesso = /^throw:(tomate|sapato|rosa):(-?\d+)$/.exec(reaction.emoji);
      if (arremesso) {
        const tipo = arremesso[1] as Reacao3D;
        const alvo = Number(arremesso[2]);
        const emoji = ARREMESSOS.find((a) => a.tipo === tipo)?.emoji ?? '🍅';
        scene?.arremessarEntre(origem, alvo, tipo);
        const nomeAlvo = gs.players.find((p) => p.id === alvo)?.name ?? '';
        spawnReacaoTela(emoji, nomeAlvo ? `→ ${nomeAlvo}` : reaction.name);
      } else {
        if (origem >= 0) scene?.reagirJogador(origem, reaction.emoji);
        spawnReacaoTela(reaction.emoji, reaction.name);
      }
    }
    // gs.players só pra resolver nome do alvo; não deve re-rodar o efeito.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.reactions]);

  // ── teatro: câmera + anúncio + fala nas transições de fase ──
  // Câmera e falas são efeitos colaterais em sistemas externos (a cena Three);
  // o anúncio é estado React, então é agendado (não setado no corpo do effect,
  // que dispararia render em cascata).
  const prevBeatRef = useRef('');
  const anuncioTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const judgeIntroTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    const beat = `${gs.round}:${gs.phase}`;
    if (beat === prevBeatRef.current) return;
    const primeiraVez = prevBeatRef.current === '';
    prevBeatRef.current = beat;

    // trilha + narração acompanham a fase (no-op silencioso se sem áudio)
    let cena: NarrationEvent | null = null;
    let anuncioNovo: { texto: string; tipo: 'normal' | 'stamp'; duracao?: number } | null = null;
    if (gs.phase === 'submitting') {
      scene.setAto('pov');
      setMusicScene('lobby');
      if (!primeiraVez) { anuncioNovo = { texto: `RODADA ${gs.round}`, tipo: 'normal', duracao: 900 }; cena = 'round-open'; }
      const plateia = gs.players.filter((p) => p.id !== props.myId && p.id !== gs.czarId && p.connected !== false);
      const orador = plateia[gs.round % Math.max(1, plateia.length)];
      if (orador) {
        const linha = ABERTURAS_RODADA[(gs.round - 1) % ABERTURAS_RODADA.length];
        window.setTimeout(() => scene.falarJogador(orador.id, linha), 900);
      }
    } else if (gs.phase === 'judging') {
      // abre de cima ("varredura das provas") e desce pro plano das provas.
      // Guarda o timer: a primeira revelação cancela o sweep e assume o foco.
      scene.setAto('cima');
      setMusicScene('tension');
      cena = 'judging';
      if (judgeIntroTimerRef.current) clearTimeout(judgeIntroTimerRef.current);
      judgeIntroTimerRef.current = setTimeout(() => sceneRef.current?.setAto('provas'), 900);
      anuncioNovo = { texto: 'ABRINDO AS PROVAS', tipo: 'normal', duracao: 700 };
    } else if (gs.phase === 'round-end') {
      // o martelo cai no plano do juiz; um beat depois a câmera dá um close no
      // boneco do culpado, junto do carimbo "FULANO CULPADO".
      scene.setAto('juiz');
      const vencedor = gs.players.find((p) => p.id === gs.roundWinnerId);
      if (vencedor) {
        anuncioNovo = { texto: `CULPADO: ${vencedor.name}`, tipo: 'stamp', duracao: 640 };
        cena = 'guilty';
        const alvoClose = vencedor.id;
        // ágil: o close arranca logo depois do martelo, não fica esperando
        window.setTimeout(() => sceneRef.current?.closeUpReu(alvoClose), 280);
      }
    } else if (gs.phase === 'game-end') {
      // plano da mesa pro blackout + holofote no campeão; o anúncio abre a festa
      scene.setAto('mesa');
      setMusicScene('finale');
      cena = 'finale';
      anuncioNovo = { texto: 'TRIBUNAL ENCERRADO', tipo: 'normal', duracao: 2000 };
    }

    if (cena) narrate(cena);

    if (anuncioNovo) {
      if (anuncioTimerRef.current) clearTimeout(anuncioTimerRef.current);
      anuncioTimerRef.current = setTimeout(() => setAnuncio(anuncioNovo), 0);
    }
  }, [gs.round, gs.phase, gs.czarId, gs.roundWinnerId, gs.players, props.myId]);

  useEffect(() => () => {
    if (anuncioTimerRef.current) clearTimeout(anuncioTimerRef.current);
  }, []);

  // A dança de câmera da revelação: cada prova aberta corta pro plano das
  // provas e, um beat depois, pro plano da mesa (onde entram as reações) —
  // com uma interjeição de um réu qualquer, como na demo.
  const revealCountRef = useRef(0);
  const revealTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    const abertas = gs.phase === 'judging' ? gs.revealed.length : 0;
    if (abertas <= revealCountRef.current) {
      revealCountRef.current = abertas;
      return;
    }
    revealCountRef.current = abertas;
    // a primeira revelação cancela o sweep de abertura e assume o foco
    if (judgeIntroTimerRef.current) { clearTimeout(judgeIntroTimerRef.current); judgeIntroTimerRef.current = null; }
    // Foca a carta recém-revelada no anel (legível em 3D + 2D). A syncMesa já
    // rodou antes (efeito declarado acima) e virou a carta pra cima.
    const idx = gs.revealed[gs.revealed.length - 1];
    scene.focarProva(idx);
    // interjeição de um réu qualquer, sem tirar a câmera da carta
    if (revealTimerRef.current) clearTimeout(revealTimerRef.current);
    revealTimerRef.current = setTimeout(() => {
      const plateia = gs.players.filter((p) => p.id !== gs.czarId && p.connected !== false);
      const orador = plateia[abertas % Math.max(1, plateia.length)];
      if (orador) sceneRef.current?.falarJogador(orador.id, INTERJEICOES[(abertas - 1) % INTERJEICOES.length]);
    }, 700);
  }, [gs.phase, gs.revealed, gs.players, gs.czarId]);

  useEffect(() => () => {
    if (revealTimerRef.current) clearTimeout(revealTimerRef.current);
  }, []);

  // Agenda a liberação do painel de resultado sem tocar em estado de forma
  // síncrona: o setState só roda dentro do timeout. Veredito espera o martelo
  // (~1s); encerramento espera o blackout+holofote+confete (~2.4s).
  useEffect(() => {
    if (gs.phase !== 'round-end' && gs.phase !== 'game-end') return;
    const beat = `${gs.phase}:${gs.round}`;
    // Round-end: 2,2s deixa o martelo cair E o close no culpado respirar antes
    // do painel central cobrir a cena. Game-end: 2,4s pro blackout/confete.
    const atraso = gs.phase === 'game-end' ? 2400 : 2200;
    const t = window.setTimeout(() => setBeatPronto(beat), atraso);
    return () => window.clearTimeout(t);
  }, [gs.phase, gs.round]);
  const vereditoPronto = beatPronto === `round-end:${gs.round}`;
  const finalPronto = beatPronto === `game-end:${gs.round}`;

  // anúncios somem sozinhos
  useEffect(() => {
    if (!anuncio) return;
    const id = window.setTimeout(() => setAnuncio(null), anuncio.duracao ?? 2400);
    return () => window.clearTimeout(id);
  }, [anuncio]);

  // relógio do fim da rodada: alimenta a contagem no botão de próxima rodada.
  // Só seta via interval (nunca síncrono no corpo do efeito).
  useEffect(() => {
    if (gs.phase !== 'round-end') return;
    const endsAt = gs.phaseEndsAt ?? (gs.phaseStartedAt + 9000);
    const id = window.setInterval(
      () => setResultRestante(Math.max(0, Math.ceil((endsAt - Date.now()) / 1000))),
      250,
    );
    return () => window.clearInterval(id);
  }, [gs.phase, gs.phaseStartedAt, gs.phaseEndsAt]);

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

  // Emote e arremesso só disparam via onReact; a própria reação volta em
  // props.reactions e a animação (balão/objeto voando) roda no efeito de
  // reações — evita animar duas vezes.
  const reagirNaTela = (emoji: string) => {
    props.onReact(emoji);
    setRodaAberta(false);
    setArremessoPendente(null);
  };

  const lancar = (tipo: Reacao3D, alvoId: number) => {
    props.onReact(`throw:${tipo}:${alvoId}`);
    setRodaAberta(false);
    setArremessoPendente(null);
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

      {/* topo direito: placar (abre o zoom), som e chat */}
      <div className="absolute top-0 right-0 p-4 sm:p-6 pointer-events-auto flex items-center gap-2">
        <button
          onClick={() => setPlacarAberto(true)}
          aria-label="Ver o placar"
          className="h-9 px-3 bg-ink/90 text-paper/80 border border-paper/20 hover:text-paper hover:border-red active:translate-y-0.5 font-black text-[9px] tracking-[0.16em] shadow-[3px_4px_0_rgba(0,0,0,.4)] transition-all"
        >
          ▤ PLACAR
        </button>
        <button
          onClick={trocarSom}
          aria-label={somMudo ? 'Ativar som' : 'Silenciar som'}
          className="h-9 px-3 bg-ink/90 text-paper/70 border border-paper/20 hover:text-paper hover:border-paper/40 active:translate-y-0.5 font-black text-[9px] tracking-[0.16em] shadow-[3px_4px_0_rgba(0,0,0,.4)] transition-all"
        >
          {somMudo ? 'SOM OFF' : '♪ SOM'}
        </button>
        <button
          onClick={() => setChatAberto((aberto) => !aberto)}
          aria-expanded={chatAberto}
          className={`relative h-9 px-3 border font-black text-[9px] tracking-[0.16em] shadow-[3px_4px_0_rgba(0,0,0,.4)] transition-all ${chatAberto ? 'bg-red text-ink border-red' : 'bg-ink/90 text-paper/80 border-paper/20 hover:border-paper/45'}`}
        >
          ▰ CHAT
          <span className="ml-1 font-mono text-[8px] opacity-70">{Math.min(props.messages.length, 99)}</span>
        </button>
      </div>

      {/* placar em zoom: modal legível, fecha no ESC ou clique fora */}
      {placarAberto && (
        <div
          className="absolute inset-0 z-50 flex items-center justify-center p-5 bg-[rgba(16,15,19,0.82)] backdrop-blur-[2px] pointer-events-auto"
          onClick={() => setPlacarAberto(false)}
          role="dialog"
          aria-modal="true"
          aria-label="Placar"
        >
          <div
            className="w-[min(26rem,94vw)] bg-[#111015] border border-paper/25 shadow-[8px_10px_0_rgba(0,0,0,0.5)]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-paper/15">
              <span className="font-display text-paper text-lg tracking-wide">PLACAR DO PORÃO</span>
              <span className="text-red text-[9px] font-black tracking-[0.16em] uppercase">até {scoreLimit}</span>
            </div>
            <ol className="p-3 flex flex-col gap-1">
              {placarOrdenado.map((player, index) => {
                const juiz = !democracy && player.id === gs.czarId;
                return (
                  <li
                    key={player.id}
                    className={`flex items-center gap-3 px-2 py-2 ${player.id === props.myId ? 'bg-white/[0.05]' : ''}`}
                  >
                    <span className="w-5 font-mono text-[11px] text-paper/35">{index + 1}</span>
                    <span className="flex-1 truncate font-black text-[13px] tracking-[0.06em] text-paper/90">
                      {player.name}
                      {player.id === props.myId && <span className="text-red"> · você</span>}
                      {juiz && <span className="text-paper/40 text-[10px]"> ⚖ juiz</span>}
                    </span>
                    <span className="font-display text-2xl text-paper">{player.score}</span>
                  </li>
                );
              })}
            </ol>
            <p className="px-4 py-2 border-t border-paper/10 text-[9px] text-paper/35 tracking-[0.14em] uppercase text-center">
              clique fora ou ESC pra fechar
            </p>
          </div>
        </div>
      )}

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
              <div className="flex flex-wrap justify-center gap-2 px-4 py-3 max-h-[42vh] overflow-y-auto">
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

      {/* VEREDITO da rodada — prova condenatória + placar (estilo demo).
          Só entra depois do martelo cair (vereditoPronto). */}
      {fase === 'condenado' && vereditoPronto && (
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
        <Finale gs={gs} myId={props.myId} onRestart={props.onRestart} show={finalPronto} />
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
            {!arremessoPendente ? (
              <>
                <p className="text-red/75 text-[7px] font-black tracking-[0.22em] uppercase mt-2.5 mb-1.5 border-t border-paper/10 pt-2">ARREMESSAR</p>
                <div className="grid grid-cols-3 gap-1">
                  {ARREMESSOS.map(({ tipo, emoji, rotulo }) => (
                    <button
                      key={tipo}
                      onClick={() => setArremessoPendente(tipo)}
                      className="h-11 bg-red/8 text-paper/80 border border-red/30 hover:bg-red hover:text-ink active:scale-90 font-bold text-[7px] tracking-wider transition-all flex flex-col items-center justify-center"
                    >
                      <span className="text-base leading-none">{emoji}</span>
                      <span className="mt-1">{rotulo}</span>
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <>
                <div className="flex items-center justify-between mt-2.5 mb-1.5 border-t border-paper/10 pt-2">
                  <p className="text-red/75 text-[7px] font-black tracking-[0.22em] uppercase">
                    {ARREMESSOS.find((a) => a.tipo === arremessoPendente)?.emoji} EM QUEM?
                  </p>
                  <button onClick={() => setArremessoPendente(null)} className="text-paper/45 hover:text-paper text-[9px] font-black">← voltar</button>
                </div>
                <div className="grid grid-cols-2 gap-1 max-h-32 overflow-y-auto">
                  {gs.players.filter((p) => p.id !== props.myId).map((p) => (
                    <button
                      key={p.id}
                      onClick={() => lancar(arremessoPendente, p.id)}
                      className="h-8 px-2 bg-paper/5 text-paper/80 border border-paper/15 hover:bg-red hover:text-ink hover:border-red active:scale-90 font-bold text-[9px] tracking-wider transition-all truncate"
                    >
                      {p.name}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
        <button
          onClick={() => { setRodaAberta((v) => !v); setArremessoPendente(null); }}
          aria-label="Abrir reações"
          className={`h-12 w-12 border text-xl transition-all active:scale-90 shadow-[4px_5px_0_rgba(0,0,0,.45)] ${
            rodaAberta ? 'btn-red border-transparent' : 'bg-ink/85 border-white/20 hover:bg-ink text-paper'
          }`}
        >
          ☠
        </button>
      </div>

      {/* painel do chat: desce do botão CHAT no topo direito */}
      {chatAberto && (
        <div className="absolute top-16 sm:top-20 right-4 sm:right-6 z-40 pointer-events-auto">
          <section className="w-[min(18rem,calc(100vw-1.5rem))] bg-[#111015]/95 border border-paper/25 shadow-[6px_8px_0_rgba(0,0,0,.5)]">
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
        </div>
      )}

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

      {/* ação principal (bottom-right) — canto livre agora que o chat subiu */}
      <div className="absolute bottom-40 sm:bottom-0 right-0 p-3 sm:p-6 pointer-events-auto z-10">
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
            title="A rodada avança sozinha; clique pra apressar (todos na mesa apressando adianta na hora)."
            className="btn-red h-12 px-5 border-2 border-ink font-display text-[14px] tracking-wide shadow-[4px_5px_0_#17161a] active:translate-y-1 active:shadow-none transition-all"
          >
            PRÓXIMA RODADA{resultRestante > 0 ? ` · ${resultRestante}s` : ''} →
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
/**
 * O encerramento não tapa a cena: o blackout, o holofote no campeão e o confete
 * rodam em 3D (via syncMesa→iniciarVitoria). O 2D só entra depois (`show`), com
 * o nome grande no alto e o ranking ancorado embaixo, deixando a festa aparecer.
 */
function Finale({ gs, myId, onRestart, show }: { gs: TimedState; myId: number; onRestart: () => void; show: boolean }) {
  const ranked = [...gs.players].sort((a, b) => b.score - a.score || a.id - b.id);
  const winnerIds = gs.winnerIds?.length ? gs.winnerIds : (gs.winner ? [gs.winner.id] : []);
  const winner = ranked.find((player) => winnerIds.includes(player.id)) ?? ranked[0];
  const didIWin = winnerIds.includes(myId);
  return (
    <>
      {/* nome do campeão no alto — não bloqueia o holofote/confete no centro */}
      <div className="absolute top-16 sm:top-20 inset-x-0 flex flex-col items-center px-4 pointer-events-none z-40">
        <span className="text-red text-[10px] font-black tracking-[0.3em] uppercase mb-1">O TRIBUNAL DECIDIU</span>
        <h1 className="font-display text-paper text-5xl sm:text-7xl text-center leading-none card-in drop-shadow-[0_6px_28px_rgba(0,0,0,0.95)]">
          {winner?.name ?? 'NINGUÉM'}
        </h1>
        <p className="text-paper/75 text-[13px] font-bold mt-2 text-center drop-shadow-[0_2px_10px_rgba(0,0,0,0.9)]">
          {didIWin ? 'VOCÊ SOBREVIVEU AO JULGAMENTO.' : 'CULPADO DE SER A PIOR PESSOA DA MESA.'}
        </p>
      </div>

      {/* ranking + sair, ancorado embaixo, entra depois do teatro 3D */}
      <div
        className={`absolute bottom-0 inset-x-0 flex flex-col items-center px-4 pb-6 pointer-events-auto z-40 transition-all duration-500 ${
          show ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-6'
        }`}
      >
        <div className="w-[min(24rem,92vw)] bg-[#111015]/92 border border-paper/25 p-3 shadow-[6px_8px_0_rgba(0,0,0,0.42)] backdrop-blur-[2px]">
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
          className="btn-red h-12 px-6 mt-3 border-2 border-ink font-display text-[14px] tracking-wide shadow-[4px_5px_0_#17161a] active:translate-y-1 active:shadow-none transition-all"
        >
          SAIR DO PORÃO
        </button>
      </div>
    </>
  );
}
