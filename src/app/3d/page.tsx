'use client';
/**
 * /3d — Experimento: mesa retrô pixelada em Three.js.
 * A UI 2D é o jogo (cartas legíveis, anúncios, emotes); a mesa 3D é o palco.
 * O fluxo de rodada daqui é uma simulação — a integração real virá do GameState.
 */
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ALL_BLACK, ALL_WHITE } from '@/lib/cards';
import { isMuted, setMuted } from '@/lib/sounds';
import { type Ato, type Reacao3D, type RetroMesa } from '@/lib/three/retroMesa';

const TOTAL_RODADAS = 5;
const TAMANHO_MAO = 8;
const RESPOSTAS_NPC = 6;
const PRETAS_DEMO = ALL_BLACK.filter((carta) => carta.pick === 1);

const ARREMESSOS: { tipo: Reacao3D; emoji: string; rotulo: string }[] = [
  { tipo: 'tomate', emoji: '🍅', rotulo: 'TOMATE' },
  { tipo: 'sapato', emoji: '👞', rotulo: 'SAPATO' },
  { tipo: 'rosa', emoji: '🌹', rotulo: 'ROSA' },
];

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
  const [pronto, setPronto] = useState(false);
  const [somMudo, setSomMudo] = useState(false);

  // ── estado da rodada (simulado na vitrine) ──
  const [fase, setFase] = useState<Fase>('aguardando');
  const [rodada, setRodada] = useState(1);
  const [mao, setMao] = useState<string[]>([]);
  const [pretaTexto, setPretaTexto] = useState('');
  const [anuncio, setAnuncio] = useState<Anuncio | null>(null);
  const [revelada, setRevelada] = useState<{ autor: string; branca: string } | null>(null);
  const [enviouCarta, setEnviouCarta] = useState(false);

  // ── roda de emotes ──
  const [rodaAberta, setRodaAberta] = useState(false);
  const [arremessoEscolhido, setArremessoEscolhido] = useState<Reacao3D | null>(null);
  const [alvos, setAlvos] = useState<string[]>([]);

  useEffect(() => {
    let viva = true;
    let onResize: (() => void) | null = null;
    const muteFrame = requestAnimationFrame(() => setSomMudo(isMuted()));
    (async () => {
      // espera as webfonts pra não assar a fonte fallback nas texturas das cartas
      await document.fonts.ready;
      if (!viva || !canvasRef.current) return;
      const { RetroMesa } = await import('@/lib/three/retroMesa');
      if (!viva || !canvasRef.current) return;
      const preta = sortear(PRETAS_DEMO, 1)[0]?.text ?? 'O tribunal exige ____.';
      const cena = new RetroMesa(canvasRef.current, {
        pixelSize: 2,
        pretas: [preta],
        brancas: sortear(ALL_WHITE, RESPOSTAS_NPC).map((c) => c.text),
      });
      cenaRef.current = cena;
      onResize = () => cenaRef.current?.resize();
      window.addEventListener('resize', onResize);
      setPretaTexto(preta);
      setMao(sortear(ALL_WHITE, TAMANHO_MAO).map((c) => c.text));
      setAlvos(cena.getAlvos());
      setPronto(true);
    })();
    return () => {
      viva = false;
      cancelAnimationFrame(muteFrame);
      if (onResize) window.removeEventListener('resize', onResize);
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
    setRodada(n);
    setPretaTexto(preta);
    setRevelada(null);
    setEnviouCarta(false);
    setFase('jogando');
    setRodaAberta(false);
    setArremessoEscolhido(null);
    cortar('pov');
    setAnuncio({ texto: `RODADA ${n}`, tipo: 'normal' });
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
      case 'jogando':
        if (!enviouCarta) break;
        if (!cena.julgar(
          (info) => setRevelada({ autor: info.autor, branca: info.texto }),
          () => {
            setRevelada(null);
            setFase('deliberando');
          }
        )) break;
        setFase('julgando');
        cortar('cima');
        setAnuncio({ texto: 'ABRINDO AS PROVAS', tipo: 'normal', duracao: 600 });
        break;
      case 'deliberando':
        setFase('sentenciando');
        cortar('juiz');
        cena.martelada((nome) => {
          setAnuncio({ texto: `CULPADO: ${nome}`, tipo: 'stamp' });
          setFase('condenado');
          cortar('cima');
        });
        break;
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
          <div className="bg-ink/85 border border-white/15 rounded-xl px-4 py-2 text-center">
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

      {/* topo direito: só configuração real; controles de laboratório saíram */}
      <div className="absolute top-0 right-0 p-4 sm:p-6 pointer-events-auto">
        <button
          onClick={trocarSom}
          aria-label={somMudo ? 'Ativar som' : 'Silenciar som'}
          className="h-9 px-3 rounded-lg bg-ink/80 text-paper/70 border border-white/15 hover:text-paper hover:border-white/30 active:scale-90 font-bold text-[10px] tracking-widest transition-all"
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

      {/* julgamento: a frase montada de cada prova, com o autor */}
      {revelada && (
        <div
          key={`${revelada.autor}-${revelada.branca.slice(0, 10)}`}
          className="absolute bottom-52 left-1/2 -translate-x-1/2 pointer-events-none reveal-in z-10 w-[min(34rem,90vw)]"
        >
          <div className="card-black rounded-2xl px-5 py-4">
            <p className="text-[15px] font-bold leading-snug">
              <Frase preta={pretaTexto} branca={revelada.branca} />
            </p>
            <p className="text-paper/50 text-[10px] font-bold tracking-[0.18em] uppercase mt-2.5 text-right">
              — {revelada.autor}
            </p>
          </div>
        </div>
      )}

      {/* roda de emotes: arremessos com alvo (você, da sua cadeira) */}
      <div className="absolute bottom-40 sm:bottom-0 left-16 p-3 sm:p-6 pointer-events-auto z-10">
        {rodaAberta && arremessoEscolhido && (
          <div className="mb-2 max-w-[240px]">
            <p className="text-paper/50 text-[9px] font-bold tracking-widest uppercase mb-1.5">
              em quem?
            </p>
            <div className="flex flex-wrap gap-1.5">
              {alvos.map((nome) => (
                <button
                  key={nome}
                  onClick={() => arremessar(nome)}
                  className="h-8 px-2.5 rounded-lg bg-white/5 text-paper/80 border border-white/15 hover:bg-white/15 active:scale-90 font-bold text-[10px] tracking-wider transition-all"
                >
                  {nome}
                </button>
              ))}
            </div>
          </div>
        )}
        {rodaAberta && !arremessoEscolhido && (
          <div className="flex flex-col gap-1.5 mb-2">
            {ARREMESSOS.map(({ tipo, emoji, rotulo }) => (
              <button
                key={tipo}
                onClick={() => setArremessoEscolhido(tipo)}
                className="h-10 px-3 rounded-xl bg-white/5 text-paper/80 border border-white/15 hover:bg-white/15 active:scale-90 font-bold text-[11px] tracking-wider transition-all flex items-center gap-2"
              >
                <span className="text-base">{emoji}</span> {rotulo}
              </button>
            ))}
          </div>
        )}
        <button
          onClick={() => {
            setRodaAberta((v) => !v);
            setArremessoEscolhido(null);
          }}
          aria-label="Roda de emotes"
          className={`h-12 w-12 rounded-full border text-xl transition-all active:scale-90 ${
            rodaAberta
              ? 'btn-red border-transparent'
              : 'bg-ink/85 border-white/20 hover:bg-ink text-paper'
          }`}
        >
          🍅
        </button>
      </div>

      {/* A SUA MÃO — cartas legíveis são UI */}
      {mao.length > 0 && fase === 'jogando' && !enviouCarta && (
        <div className="absolute bottom-0 left-1/2 -translate-x-1/2 pb-2 sm:pb-3 pointer-events-auto w-[calc(100vw-1rem)] sm:w-auto max-w-[calc(100vw-1rem)] sm:max-w-[56vw]">
          <div className="flex justify-start sm:justify-center overflow-x-auto px-4 pt-6 pb-1">
            {mao.map((texto, i) => (
              <button
                key={`${i}-${texto.slice(0, 12)}`}
                onClick={() => jogarCarta(i)}
                className="w-24 h-36 sm:w-28 sm:h-40 shrink-0 -ml-4 first:ml-0 bg-white border-2 border-ink rounded-2xl p-2.5 text-left flex flex-col transition-all hover:-translate-y-4 hover:z-10 hover:rotate-1 active:scale-95 shadow-[0_16px_28px_-14px_rgba(0,0,0,0.9)]"
              >
                <span className="text-[11px] font-bold text-ink leading-snug flex-1 overflow-hidden">
                  {texto}
                </span>
                <span className="text-[6.5px] font-bold tracking-[0.16em] text-ink/40 mt-1">
                  SEM PERDÃO<span className="text-red">*</span>
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ação principal da rodada */}
      <div className="absolute bottom-40 sm:bottom-0 right-0 p-3 sm:p-6 pointer-events-auto z-10">
        <button
          onClick={acaoPrincipal}
          disabled={!pronto || fase === 'julgando' || fase === 'sentenciando' || (fase === 'jogando' && !enviouCarta)}
          className="btn-red h-12 px-5 rounded-xl font-display text-[14px] tracking-wide active:scale-95 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
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
