'use client';
/**
 * /3d — Experimento: mesa retrô pixelada em Three.js.
 * A UI 2D é o jogo (cartas legíveis, anúncios, emotes); a mesa 3D é o palco.
 * O fluxo de rodada daqui é uma simulação — a integração real virá do GameState.
 */
import { type FormEvent, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ALL_BLACK, ALL_WHITE } from '@/lib/cards';
import { REACTION_CATALOG, REACTION_THROWS } from '@/lib/mesa/reactionCatalog';
import { isMuted, setMuted } from '@/lib/sounds';
import { type Ato, type Reacao3D, type RetroMesa } from '@/lib/three/retroMesa';

const TOTAL_RODADAS = 5;
const TAMANHO_MAO = 8;
const RESPOSTAS_NPC = 6;
const PRETAS_DEMO = ALL_BLACK.filter((carta) => carta.pick === 1);

const ARREMESSOS: { tipo: Reacao3D; emoji: string; rotulo: string }[] = REACTION_THROWS.map(
  ({ kind, emoji, label }) => ({ tipo: kind, emoji, rotulo: label })
);

const EMOTES_TELA = REACTION_CATALOG.map(({ emoji, stamp: rotulo }) => ({ emoji, rotulo }));

const POSICOES_REACAO = [
  { esquerda: 26, topo: 31, giro: -7 },
  { esquerda: 62, topo: 27, giro: 6 },
  { esquerda: 44, topo: 46, giro: -3 },
  { esquerda: 70, topo: 51, giro: 8 },
  { esquerda: 31, topo: 55, giro: 4 },
] as const;

const AUTORES_CHAT = ['GABS', 'VANZO', 'PPVAZ', 'POLES', 'CAROL'] as const;

const CHAT_SEMENTE = [
  { id: 1, autor: 'GABS', texto: 'isso vai terminar em justa causa.' },
  { id: 2, autor: 'VANZO', texto: 'meritíssimo, eu nem tava no grupo.' },
  { id: 3, autor: 'POLES', texto: 'registra em ata que eu avisei.' },
] as const;

const INTERJEICOES = [
  'ISSO É PROVA OU PEDIDO DE SOCORRO?',
  'EU NÃO QUERO SER ASSOCIADO A ISSO.',
  'MERITÍSSIMO, PODE PRENDER.',
  'O RH JÁ FOI EMBORA, NÉ?',
  'CINEMA. ABSOLUTO CINEMA.',
  'ESSA ATA VAI SUMIR.',
] as const;

const ABERTURAS_RODADA = [
  'QUEM ESCREVEU ESSA PERGUNTA?',
  'EU JÁ QUERO TROCAR DE ADVOGADO.',
  'NINGUÉM ASSINA ESSA ATA.',
  'O PORÃO FICOU MAIS FRIO.',
  'ÚLTIMA RODADA. SEM CHORO.',
] as const;

type Fase =
  | 'aguardando'
  | 'jogando'
  | 'julgando'
  | 'deliberando'
  | 'sentenciando'
  | 'condenado'
  | 'fim';

const ROTULO_FASE: Record<Fase, string> = {
  aguardando: 'SESSÃO FECHADA',
  jogando: 'JOGUEM SUAS CARTAS',
  julgando: 'O JÚRI LÊ AS PROVAS',
  deliberando: 'HORA DO VEREDITO',
  sentenciando: 'O MARTELO VAI CAIR',
  condenado: 'SENTENÇA DADA',
  fim: 'TRIBUNAL ENCERRADO',
};

interface Anuncio {
  texto: string;
  tipo: 'normal' | 'stamp';
  duracao?: number;
}

interface ProvaRevelada {
  autor: string;
  branca: string;
}

interface Veredito extends ProvaRevelada {
  pontos: number;
}

interface ReacaoTela {
  id: number;
  emoji: string;
  rotulo: string;
  esquerda: number;
  topo: number;
  giro: number;
}

interface MensagemChat {
  id: number;
  autor: string;
  texto: string;
}

interface FalaVoce {
  id: number;
  texto: string;
}

function sortear<T>(arr: T[], n: number): T[] {
  const copia = [...arr];
  for (let i = copia.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copia[i], copia[j]] = [copia[j], copia[i]];
  }
  return copia.slice(0, n);
}

/** A frase montada: carta preta com a resposta branca na primeira lacuna. */
function Frase({ preta, branca }: { preta: string; branca: string }) {
  const resposta = branca.replace(/\.$/, '');
  const partes = preta.split('____');
  if (partes.length === 1) {
    return (
      <>
        {preta} <span className="text-red">{resposta}</span>
      </>
    );
  }
  return (
    <>
      {partes.map((p, i) => (
        <span key={i}>
          {p}
          {i === 0 && partes.length > 1 && <span className="text-red">{resposta}</span>}
          {i > 0 && i < partes.length - 1 && '____'}
        </span>
      ))}
    </>
  );
}

export default function Mesa3D() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cenaRef = useRef<RetroMesa | null>(null);
  const timersUiRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());
  const timersCenaRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());
  const contadorReacaoRef = useRef(0);
  const contadorMensagemRef = useRef(CHAT_SEMENTE.length);
  const contadorProvaRef = useRef(0);
  const sequenciaCenaRef = useRef(0);
  const [pronto, setPronto] = useState(false);
  const [somMudo, setSomMudo] = useState(false);

  // ── estado da rodada (simulado na vitrine) ──
  const [fase, setFase] = useState<Fase>('aguardando');
  const [rodada, setRodada] = useState(1);
  const [mao, setMao] = useState<string[]>([]);
  const [pretaTexto, setPretaTexto] = useState('');
  const [anuncio, setAnuncio] = useState<Anuncio | null>(null);
  const [revelada, setRevelada] = useState<ProvaRevelada | null>(null);
  const [provasReveladas, setProvasReveladas] = useState<ProvaRevelada[]>([]);
  const [veredito, setVeredito] = useState<Veredito | null>(null);
  const [placar, setPlacar] = useState<Record<string, number>>({ VOCÊ: 0 });
  const [enviouCarta, setEnviouCarta] = useState(false);

  // ── roda de emotes ──
  const [rodaAberta, setRodaAberta] = useState(false);
  const [arremessoEscolhido, setArremessoEscolhido] = useState<Reacao3D | null>(null);
  const [alvos, setAlvos] = useState<string[]>([]);
  const [reacoesTela, setReacoesTela] = useState<ReacaoTela[]>([]);
  const [chatAberto, setChatAberto] = useState(false);
  const [chatTexto, setChatTexto] = useState('');
  const [mensagensChat, setMensagensChat] = useState<MensagemChat[]>([...CHAT_SEMENTE]);
  const [falaVoce, setFalaVoce] = useState<FalaVoce | null>(null);

  useEffect(() => {
    let viva = true;
    let onResize: (() => void) | null = null;
    const timersUi = timersUiRef.current;
    const timersCena = timersCenaRef.current;
    const muteFrame = requestAnimationFrame(() => setSomMudo(isMuted()));
    (async () => {
      // espera as webfonts pra não assar a fonte fallback nas texturas das cartas
      await document.fonts.ready;
      if (!viva || !canvasRef.current) return;
      const { RetroMesa } = await import('@/lib/three/retroMesa');
      if (!viva || !canvasRef.current) return;
      const preta = sortear(PRETAS_DEMO, 1)[0]?.text ?? 'O tribunal exige ____.';
      const cena = new RetroMesa(canvasRef.current, {
        pixelSize: 1,
        pretas: [preta],
        brancas: sortear(ALL_WHITE, RESPOSTAS_NPC).map((c) => c.text),
      });
      cenaRef.current = cena;
      onResize = () => cenaRef.current?.resize();
      window.addEventListener('resize', onResize);
      setPretaTexto(preta);
      setMao(sortear(ALL_WHITE, TAMANHO_MAO).map((c) => c.text));
      const nomes = cena.getAlvos();
      setAlvos(nomes);
      setPlacar(Object.fromEntries([
        ['VOCÊ', 0],
        ...nomes.filter((nome) => nome !== 'NATH').map((nome) => [nome, 0] as const),
      ]));
      setPronto(true);
    })();
    return () => {
      viva = false;
      cancelAnimationFrame(muteFrame);
      if (onResize) window.removeEventListener('resize', onResize);
      for (const timer of timersUi) clearTimeout(timer);
      timersUi.clear();
      for (const timer of timersCena) clearTimeout(timer);
      timersCena.clear();
      cenaRef.current?.dispose();
      cenaRef.current = null;
    };
  }, []);

  // anúncios somem sozinhos — nada acima de ~2.4s segurando a rodada
  useEffect(() => {
    if (!anuncio) return;
    const id = setTimeout(() => setAnuncio(null), anuncio.duracao ?? 2400);
    return () => clearTimeout(id);
  }, [anuncio]);

  const cortar = (a: Ato) => {
    cenaRef.current?.setAto(a);
  };

  const novaSequenciaCena = () => {
    for (const timer of timersCenaRef.current) clearTimeout(timer);
    timersCenaRef.current.clear();
    sequenciaCenaRef.current += 1;
    return sequenciaCenaRef.current;
  };

  const agendarCena = (acao: () => void, atraso: number, sequencia: number) => {
    const timer = setTimeout(() => {
      timersCenaRef.current.delete(timer);
      if (sequencia === sequenciaCenaRef.current) acao();
    }, atraso);
    timersCenaRef.current.add(timer);
  };

  const registrarMensagem = (autor: string, texto: string) => {
    const mensagem = { id: ++contadorMensagemRef.current, autor, texto };
    setMensagensChat((atuais) => [...atuais.slice(-18), mensagem]);
    return mensagem.id;
  };

  const trocarSom = () => {
    const novoMudo = !somMudo;
    setSomMudo(novoMudo);
    setMuted(novoMudo);
    cenaRef.current?.setSomAtivo(!novoMudo);
  };

  const jogarCarta = (i: number) => {
    const texto = mao[i];
    if (fase !== 'jogando' || enviouCarta || !texto) return;
    if (cenaRef.current?.jogarCarta(texto)) {
      setMao((prev) => prev.filter((_, j) => j !== i));
      setEnviouCarta(true);
    }
  };

  const iniciarRodada = (n: number) => {
    const cena = cenaRef.current;
    if (!cena) return;
    const preta = sortear(PRETAS_DEMO, 1)[0]?.text ?? 'O tribunal exige ____.';
    const respostas = sortear(ALL_WHITE, RESPOSTAS_NPC).map((c) => c.text);
    if (!cena.prepararRodada(preta, respostas)) return;
    const sequencia = novaSequenciaCena();
    contadorProvaRef.current = 0;
    setRodada(n);
    setPretaTexto(preta);
    setRevelada(null);
    setProvasReveladas([]);
    setVeredito(null);
    setEnviouCarta(false);
    setFase('jogando');
    setRodaAberta(false);
    setArremessoEscolhido(null);
    if (n === 1 && fase === 'fim') {
      setPlacar((atual) => Object.fromEntries(Object.keys(atual).map((nome) => [nome, 0])));
    }
    cortar('pov');
    setAnuncio({ texto: `RODADA ${n}`, tipo: 'normal', duracao: 900 });
    agendarCena(() => {
      const autor = n === 1 ? 'NATH' : AUTORES_CHAT[(n + 1) % AUTORES_CHAT.length];
      const texto = ABERTURAS_RODADA[(n - 1) % ABERTURAS_RODADA.length];
      registrarMensagem(autor, texto);
      cena.falar(autor, texto, 2.8);
    }, 1100, sequencia);
    setMao((prev) => {
      const faltam = Math.max(0, TAMANHO_MAO - prev.length);
      if (faltam === 0) return prev;
      const disponiveis = ALL_WHITE.filter((carta) => !prev.includes(carta.text));
      return [...prev, ...sortear(disponiveis, faltam).map((c) => c.text)];
    });
  };

  const acaoPrincipal = () => {
    const cena = cenaRef.current;
    if (!cena) return;
    switch (fase) {
      case 'aguardando':
        iniciarRodada(1);
        break;
      case 'jogando': {
        if (!enviouCarta) break;
        const sequencia = novaSequenciaCena();
        if (!cena.julgar(
          (info) => {
            if (sequencia !== sequenciaCenaRef.current) return;
            const prova = { autor: info.autor, branca: info.texto };
            const numero = ++contadorProvaRef.current;
            setRevelada(prova);
            setProvasReveladas((atuais) => [...atuais, prova]);
            setPlacar((atual) => (
              info.autor in atual ? atual : { ...atual, [info.autor]: 0 }
            ));
            cortar('provas');

            const candidatos = AUTORES_CHAT.filter((nome) => nome !== info.autor);
            const autor = candidatos[(numero + rodada) % candidatos.length] ?? AUTORES_CHAT[0];
            const texto = INTERJEICOES[(numero - 1) % INTERJEICOES.length];
            agendarCena(() => {
              cortar('mesa');
              registrarMensagem(autor, texto);
              cena.falar(autor, texto, 1.65);
            }, 1450, sequencia);
          },
          () => {
            if (sequencia !== sequenciaCenaRef.current) return;
            novaSequenciaCena();
            setRevelada(null);
            setFase('deliberando');
            cortar('mesa');
          }
        )) break;
        setFase('julgando');
        cortar('cima');
        setAnuncio({ texto: 'ABRINDO AS PROVAS', tipo: 'normal', duracao: 600 });
        break;
      }
      case 'deliberando': {
        const sequencia = novaSequenciaCena();
        setFase('sentenciando');
        cortar('juiz');
        cena.martelada((nome) => {
          const prova = provasReveladas.find((item) => item.autor === nome);
          const pontos = (placar[nome] ?? 0) + 1;
          setAnuncio({ texto: `CULPADO: ${nome}`, tipo: 'stamp', duracao: 520 });
          agendarCena(() => {
            setPlacar((atual) => ({ ...atual, [nome]: (atual[nome] ?? 0) + 1 }));
            setVeredito({
              autor: nome,
              branca: prova?.branca ?? 'PROVA CONFISCADA PELO TRIBUNAL',
              pontos,
            });
            setFase('condenado');
          }, 620, sequencia);
        });
        break;
      }
      case 'condenado':
        if (rodada >= TOTAL_RODADAS) {
          setFase('fim');
          cortar('mesa');
          setAnuncio({ texto: 'TRIBUNAL ENCERRADO', tipo: 'normal' });
        } else {
          iniciarRodada(rodada + 1);
        }
        break;
      case 'fim':
        iniciarRodada(1);
        break;
      case 'julgando':
      case 'sentenciando':
        break;
    }
  };

  const ROTULO_BOTAO: Record<Fase, string> = {
    aguardando: 'ABRIR A SESSÃO',
    jogando: enviouCarta ? 'ABRIR AS PROVAS →' : 'ESCOLHA UMA CARTA',
    julgando: 'REVELANDO…',
    deliberando: 'VEREDITO ⚖',
    sentenciando: 'SENTENCIANDO…',
    condenado: rodada >= TOTAL_RODADAS ? 'ENCERRAR O TRIBUNAL' : 'PRÓXIMA RODADA →',
    fim: 'REABRIR O TRIBUNAL',
  };

  const arremessar = (nome: string) => {
    if (!arremessoEscolhido) return;
    cenaRef.current?.arremessarEm(nome, arremessoEscolhido);
    setArremessoEscolhido(null);
    setRodaAberta(false);
  };

  const enviarChat = (evento: FormEvent<HTMLFormElement>) => {
    evento.preventDefault();
    const texto = chatTexto.replace(/\s+/g, ' ').trim().slice(0, 90);
    if (!texto) return;
    const id = registrarMensagem('VOCÊ', texto);
    setChatTexto('');
    setFalaVoce({ id, texto });
    cenaRef.current?.falar('VOCÊ', texto, 3);
    const timer = setTimeout(() => {
      setFalaVoce((atual) => atual?.id === id ? null : atual);
      timersUiRef.current.delete(timer);
    }, 3000);
    timersUiRef.current.add(timer);
  };

  const reagirNaTela = (emoji: string, rotulo: string) => {
    const id = ++contadorReacaoRef.current;
    cenaRef.current?.reagir('VOCÊ', emoji, 1.7);
    const posicao = POSICOES_REACAO[(id - 1) % POSICOES_REACAO.length];
    const nova: ReacaoTela = {
      id,
      emoji,
      rotulo,
      ...posicao,
    };
    setReacoesTela((atuais) => [...atuais.slice(-4), nova]);
    setRodaAberta(false);
    const timer = setTimeout(() => {
      setReacoesTela((atuais) => atuais.filter((reacao) => reacao.id !== id));
      timersUiRef.current.delete(timer);
    }, 1700);
    timersUiRef.current.add(timer);
  };

  const placarOrdenado = Object.entries(placar).sort((a, b) => (
    b[1] - a[1] || a[0].localeCompare(b[0])
  ));

  return (
    <div className="fixed inset-0 table-bg overflow-hidden">
      <canvas
        ref={canvasRef}
        className="absolute inset-0 w-full h-full"
        style={{ imageRendering: 'pixelated' }}
      />

      {/* topo esquerdo: identidade */}
      <div className="absolute top-0 left-0 p-4 sm:p-6 pointer-events-auto">
        <Link
          href="/"
          className="inline-block text-paper/60 hover:text-paper text-[12px] font-bold tracking-widest uppercase transition-colors"
        >
          ← voltar
        </Link>
        <h1 className={`font-display text-paper text-2xl sm:text-3xl leading-none mt-1 ${fase !== 'aguardando' ? 'hidden sm:block' : ''}`}>
          MESA 3D<span className="text-red">*</span>
        </h1>
      </div>

      {/* topo centro: a rodada */}
      {fase !== 'aguardando' && (
        <div className="absolute top-0 inset-x-0 flex justify-center p-4 sm:p-6 pointer-events-none">
          <div className="bg-ink/90 border border-paper/20 px-4 py-2 text-center shadow-[4px_5px_0_rgba(0,0,0,.48)]">
            <p className="font-display text-paper text-[13px] tracking-wide">
              RODADA {Math.min(rodada, TOTAL_RODADAS)}
              <span className="text-paper/40"> / {TOTAL_RODADAS}</span>
            </p>
            <p className="text-red text-[9px] font-bold tracking-[0.18em] uppercase mt-0.5">
              {ROTULO_FASE[fase]}
            </p>
          </div>
        </div>
      )}

      {/* A pergunta não depende da textura 3D: fica como um processo físico legível. */}
      {fase === 'jogando' && (
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
              escolha a prova abaixo
              <span className="h-px w-5 bg-red/70" />
            </div>
          </article>
        </div>
      )}

      {fase === 'jogando' && (
        <p className="absolute top-[12.6rem] sm:top-[13.4rem] inset-x-0 text-center pointer-events-none text-paper/35 text-[7px] font-black tracking-[0.2em] uppercase z-10">
          arraste para olhar ao redor • sua cadeira não se move
        </p>
      )}

      {/* topo direito: só configuração real; controles de laboratório saíram */}
      <div className="absolute top-0 right-0 p-4 sm:p-6 pointer-events-auto">
        <button
          onClick={trocarSom}
          aria-label={somMudo ? 'Ativar som' : 'Silenciar som'}
          className="h-9 px-3 bg-ink/90 text-paper/70 border border-paper/20 hover:text-paper hover:border-paper/40 active:translate-y-0.5 font-black text-[9px] tracking-[0.16em] shadow-[3px_4px_0_rgba(0,0,0,.4)] transition-all"
        >
          {somMudo ? 'SOM OFF' : '♪ SOM'}
        </button>
      </div>

      {/* anúncio central — entra, grita, some */}
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

      {/* Reações de tela são efêmeras e não precisam de alvo físico. */}
      <div className="absolute inset-0 pointer-events-none z-30 overflow-hidden" aria-live="polite">
        {reacoesTela.map((reacao) => (
          <div
            key={reacao.id}
            className="absolute card-in"
            style={{
              left: `${reacao.esquerda}%`,
              top: `${reacao.topo}%`,
              rotate: `${reacao.giro}deg`,
            }}
          >
            <div className="relative bg-[#e7decc] text-ink border-2 border-ink px-3 py-1.5 shadow-[4px_5px_0_rgba(23,22,26,0.8)]">
              <span className="text-3xl leading-none">{reacao.emoji}</span>
              <span className="block mt-1 text-[7px] font-black tracking-[0.15em] text-center uppercase">
                {reacao.rotulo}
              </span>
              <span className="absolute -bottom-2 left-3 h-3 w-3 bg-[#e7decc] border-b-2 border-r-2 border-ink rotate-45" />
            </div>
          </div>
        ))}
      </div>

      {/* O jogador ocupa a câmera: a própria fala entra na lente, não sobre um avatar inexistente. */}
      {falaVoce && (
        <div className="absolute left-1/2 top-[58%] -translate-x-1/2 pointer-events-none z-30 w-[min(27rem,86vw)] card-in">
          <div className="relative bg-[#e7decc] text-ink border-2 border-ink px-4 py-2 shadow-[5px_6px_0_rgba(23,22,26,.72)]">
            <span className="block text-[7px] font-black tracking-[0.2em] text-red uppercase mb-1">VOCÊ, DA CADEIRA</span>
            <p className="text-[11px] sm:text-[12px] font-black leading-snug">{falaVoce.texto}</p>
            <span className="absolute -bottom-2 left-1/2 h-3 w-3 bg-[#e7decc] border-b-2 border-r-2 border-ink rotate-45" />
          </div>
        </div>
      )}

      {/* julgamento: o texto é público; a autoria só abre no veredito. */}
      {revelada && (
        <div
          key={`${revelada.autor}-${revelada.branca.slice(0, 10)}`}
          className="absolute bottom-48 sm:bottom-8 left-1/2 -translate-x-1/2 pointer-events-none reveal-in z-10 w-[min(36rem,90vw)]"
        >
          <div
            className="relative bg-[#141318]/95 text-paper border border-paper/25 px-5 py-3.5 shadow-[6px_8px_0_rgba(0,0,0,0.52)]"
            style={{ clipPath: 'polygon(0 3%, 98.5% 0, 100% 92%, 97% 100%, 1% 98%)' }}
          >
            <div className="flex items-center justify-between mb-2 text-[8px] font-black tracking-[0.2em] uppercase">
              <span className="text-red">PROVA {String(provasReveladas.length).padStart(2, '0')}</span>
              <span className="text-paper/35">DE {RESPOSTAS_NPC + 1} • LEITURA EM CURSO</span>
            </div>
            <p className="text-[14px] sm:text-[16px] font-bold leading-snug">
              <Frase preta={pretaTexto} branca={revelada.branca} />
            </p>
            <p className="text-paper/45 text-[8px] font-bold tracking-[0.2em] uppercase mt-2 text-right">
              — AUTORIA SOB SIGILO
            </p>
            <div className="flex gap-1 mt-2">
              {Array.from({ length: RESPOSTAS_NPC + 1 }, (_, index) => (
                <span
                  key={index}
                  className={`h-1 flex-1 ${index < provasReveladas.length ? 'bg-red' : 'bg-paper/15'}`}
                />
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Resultado da rodada: prova vencedora, autoria aberta e placar acumulado. */}
      {fase === 'condenado' && veredito && (
        <div className="absolute inset-x-0 top-[5.2rem] bottom-[14rem] sm:bottom-16 flex items-center justify-center px-3 pointer-events-none z-10">
          <section className="w-[min(48rem,95vw)] grid sm:grid-cols-[1.45fr_0.75fr] gap-2 sm:gap-3 card-in">
            <div className="relative flex bg-[#111015]/95 border border-paper/25 p-3 sm:p-4 shadow-[8px_10px_0_rgba(0,0,0,0.48)]">
              <div className="flex flex-1 items-start gap-3">
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
                    <Frase preta={pretaTexto} branca={veredito.branca} />
                  </p>
                  <div className="absolute bottom-3 inset-x-4 flex items-end justify-between gap-3 border-t border-ink/20 pt-2">
                    <div>
                      <p className="text-[6px] font-black tracking-[0.18em] uppercase text-ink/45">AUTORIA CONFESSA</p>
                      <p className="font-display text-[15px] leading-none">{veredito.autor}</p>
                    </div>
                    <span className="stamp !text-[11px] !border-2 !px-1.5 !bg-transparent">CULPADO</span>
                  </div>
                </div>
              </div>
            </div>

            <aside className="bg-[#111015]/95 border border-paper/25 p-3 shadow-[6px_8px_0_rgba(0,0,0,0.42)]">
              <div className="flex items-center justify-between border-b border-paper/15 pb-2 mb-2">
                <p className="font-display text-paper text-[12px] tracking-wide">PLACAR DO PORÃO</p>
                <span className="bg-red text-ink px-1.5 py-0.5 text-[8px] font-black">+1</span>
              </div>
              <ol className="grid grid-cols-2 sm:grid-cols-1 gap-x-3 gap-y-1">
                {placarOrdenado.map(([nome, pontos], index) => (
                  <li
                    key={nome}
                    className={`flex items-center gap-2 min-w-0 py-0.5 ${nome === veredito.autor ? 'text-red' : 'text-paper/65'}`}
                  >
                    <span className="w-3 text-[8px] font-mono text-paper/25">{index + 1}</span>
                    <span className="flex-1 truncate text-[9px] font-black tracking-[0.1em]">{nome}</span>
                    <span className={`font-display text-[13px] ${nome === veredito.autor ? 'score-pop' : ''}`}>
                      {pontos}
                    </span>
                  </li>
                ))}
              </ol>
              <p className="mt-2 pt-2 border-t border-paper/10 text-[7px] text-paper/30 tracking-[0.16em] uppercase">
                primeiro a 5 escapa da custódia
              </p>
            </aside>
          </section>
        </div>
      )}

      {/* roda de reações: emoji é tela; objeto físico pede um alvo. */}
      <div className="absolute bottom-40 sm:bottom-0 left-0 p-3 sm:p-6 pointer-events-auto z-10">
        {rodaAberta && arremessoEscolhido && (
          <div className="mb-2 max-w-[250px] bg-[#121116]/95 border border-paper/20 p-2.5 shadow-[5px_6px_0_rgba(0,0,0,.45)]">
            <p className="text-red text-[8px] font-black tracking-[0.2em] uppercase mb-2">
              SELECIONE O RÉU
            </p>
            <div className="flex flex-wrap gap-1.5">
              {alvos.map((nome) => (
                <button
                  key={nome}
                  onClick={() => arremessar(nome)}
                  className="h-8 px-2.5 bg-paper/5 text-paper/80 border border-paper/15 hover:bg-red hover:text-ink hover:border-red active:scale-90 font-bold text-[9px] tracking-wider transition-all"
                >
                  {nome}
                </button>
              ))}
            </div>
          </div>
        )}
        {rodaAberta && !arremessoEscolhido && (
          <div className="w-[248px] mb-2 bg-[#121116]/95 border border-paper/20 p-2.5 shadow-[5px_6px_0_rgba(0,0,0,.45)]">
            <p className="text-paper/45 text-[7px] font-black tracking-[0.22em] uppercase mb-1.5">
              REAÇÕES • SEM ALVO
            </p>
            <div className="grid grid-cols-6 gap-1">
              {EMOTES_TELA.map(({ emoji, rotulo }) => (
                <button
                  key={emoji}
                  onClick={() => reagirNaTela(emoji, rotulo)}
                  title={rotulo}
                  aria-label={rotulo}
                  className="h-10 bg-paper/5 border border-paper/10 hover:bg-paper/15 hover:border-paper/25 active:scale-90 transition-all flex items-center justify-center"
                >
                  <span className="text-xl leading-none">{emoji}</span>
                  <span className="sr-only">
                    {rotulo}
                  </span>
                </button>
              ))}
            </div>

            <p className="text-red/75 text-[7px] font-black tracking-[0.22em] uppercase mt-2.5 mb-1.5 border-t border-paper/10 pt-2">
              ARREMESSAR • ESCOLHA UM ALVO
            </p>
            <div className="grid grid-cols-3 gap-1">
              {ARREMESSOS.map(({ tipo, emoji, rotulo }) => (
                <button
                  key={tipo}
                  onClick={() => setArremessoEscolhido(tipo)}
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
          onClick={() => {
            setRodaAberta((v) => !v);
            setArremessoEscolhido(null);
          }}
          aria-label="Abrir reações"
          className={`h-12 w-12 border text-xl transition-all active:scale-90 shadow-[4px_5px_0_rgba(0,0,0,.45)] ${
            rodaAberta
              ? 'btn-red border-transparent'
              : 'bg-ink/85 border-white/20 hover:bg-ink text-paper'
          }`}
        >
          ☠
        </button>
      </div>

      {/* Chat 2D guarda o histórico; falas remotas também ganham um balão no palco 3D. */}
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
              {mensagensChat.slice(-7).map((mensagem) => (
                <div key={mensagem.id} className={mensagem.autor === 'VOCÊ' ? 'text-right' : ''}>
                  <p className={`text-[6px] font-black tracking-[0.17em] uppercase ${mensagem.autor === 'VOCÊ' ? 'text-red' : 'text-paper/35'}`}>
                    {mensagem.autor}
                  </p>
                  <p className={`inline-block max-w-[92%] mt-0.5 px-2 py-1.5 text-left text-[9px] font-bold leading-snug border ${mensagem.autor === 'VOCÊ' ? 'bg-red text-ink border-red' : 'bg-paper/[.06] text-paper/78 border-paper/10'}`}>
                    {mensagem.texto}
                  </p>
                </div>
              ))}
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
          <span className="bg-paper/10 px-1 py-0.5 font-mono text-[7px]">{Math.min(mensagensChat.length, 99)}</span>
        </button>
      </div>

      {/* A SUA MÃO — cartas legíveis são UI */}
      {mao.length > 0 && fase === 'jogando' && !enviouCarta && (
        <div className="absolute bottom-0 left-1/2 -translate-x-1/2 pb-1.5 sm:pb-2 pointer-events-auto w-[calc(100vw-1rem)] sm:w-auto max-w-[calc(100vw-1rem)] sm:max-w-[58vw]">
          <div className="flex justify-start sm:justify-center overflow-x-auto px-4 pt-7 pb-2">
            {mao.map((texto, i) => (
              <div
                key={`${i}-${texto.slice(0, 12)}`}
                className="relative shrink-0"
                style={{
                  marginLeft: i === 0 ? 0 : '-1.05rem',
                  transform: `rotate(${((i % 5) - 2) * 1.15}deg) translateY(${i % 2 ? 2 : 0}px)`,
                  zIndex: i,
                }}
              >
                <button
                  onClick={() => jogarCarta(i)}
                  aria-label={`Jogar carta: ${texto}`}
                  className="group relative w-[6.35rem] h-[9.25rem] sm:w-[7rem] sm:h-[10.2rem] bg-[#e7decc] border-2 border-[#19171a] p-2.5 sm:p-3 text-left flex flex-col transition-transform duration-150 hover:-translate-y-5 hover:z-20 active:translate-y-0 active:scale-95 shadow-[3px_4px_0_#17161a,0_18px_30px_-14px_rgba(0,0,0,0.95)] overflow-hidden"
                  style={{
                    clipPath: 'polygon(1% 0, 97% 1%, 100% 5%, 98% 96%, 94% 100%, 2% 98%, 0 6%)',
                    backgroundImage: 'radial-gradient(circle at 82% 16%,rgba(91,55,32,.10) 0 2px,transparent 3px),repeating-linear-gradient(3deg,rgba(45,36,26,.024) 0 1px,transparent 1px 5px)',
                  }}
                >
                  <span className="absolute -top-1 right-2 w-5 h-3 bg-red/65 rotate-3 opacity-70" />
                  <span className="text-[6px] font-black tracking-[0.2em] text-red uppercase border-b border-ink/15 pb-1 mb-1.5">
                    EVIDÊNCIA {String(i + 1).padStart(2, '0')}
                  </span>
                  <span className="text-[10.5px] sm:text-[11px] font-black text-ink leading-[1.18] flex-1 overflow-hidden">
                    {texto}
                  </span>
                  <span className="flex items-end justify-between gap-1 text-[5.5px] font-black tracking-[0.14em] text-ink/42 mt-1 border-t border-ink/15 pt-1">
                    <span>SEM PERDÃO<span className="text-red">*</span></span>
                    <span className="font-mono">#{rodada}{String(i + 1).padStart(2, '0')}</span>
                  </span>
                  <span className="absolute inset-1 border border-ink/[0.06] pointer-events-none" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ação principal da rodada */}
      <div className="absolute bottom-40 sm:bottom-0 right-0 p-3 sm:p-6 pointer-events-auto z-10">
        <button
          onClick={acaoPrincipal}
          disabled={!pronto || fase === 'julgando' || fase === 'sentenciando' || (fase === 'jogando' && !enviouCarta)}
          className="btn-red h-12 px-5 border-2 border-ink font-display text-[14px] tracking-wide shadow-[4px_5px_0_#17161a] active:translate-y-1 active:shadow-none transition-all disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {ROTULO_BOTAO[fase]}
        </button>
      </div>

      {!pronto && (
        <div className="absolute inset-0 flex items-center justify-center">
          <p className="font-display text-paper/60 text-sm tracking-widest">CARREGANDO A MESA…</p>
        </div>
      )}
    </div>
  );
}
