'use client';
/**
 * /3d — Experimento: mesa retrô pixelada em Three.js.
 * Vitrine visual, sem multiplayer. Não afeta nada do jogo real.
 */
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ALL_BLACK, ALL_WHITE } from '@/lib/cards';
import { isMuted, setMuted } from '@/lib/sounds';
import type { Reacao3D, RetroMesa } from '@/lib/three/retroMesa';
import { EXPRESSOES, ACOES, type Expressao, type Acao } from '@/lib/three/reus';

const PIXELS = [1, 2, 3];
const REACOES: { tipo: Reacao3D; rotulo: string }[] = [
  { tipo: 'tomate', rotulo: '🍅 TOMATE' },
  { tipo: 'sapato', rotulo: '👞 SAPATO' },
  { tipo: 'rosa', rotulo: '🌹 ROSA' },
];

const ROTULO_ACAO: Record<Acao, string> = {
  soco: 'SOCO NA MESA',
  apontar: 'APONTAR',
  aplaudir: 'APLAUDIR',
  festejar: 'FESTEJAR',
  facepalm: 'FACEPALM',
  rir: 'RIR',
};

function sortear<T>(arr: T[], n: number): T[] {
  const copia = [...arr];
  for (let i = copia.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copia[i], copia[j]] = [copia[j], copia[i]];
  }
  return copia.slice(0, n);
}

export default function Mesa3D() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cenaRef = useRef<RetroMesa | null>(null);
  const [pixel, setPixel] = useState(2);
  const [pronto, setPronto] = useState(false);
  const [somMudo, setSomMudo] = useState(false);

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
      cenaRef.current = new RetroMesa(canvasRef.current, {
        pixelSize: 2,
        pretas: sortear(ALL_BLACK, 1).map((c) => c.text),
        brancas: sortear(ALL_WHITE, 10).map((c) => c.text),
      });
      onResize = () => cenaRef.current?.resize();
      window.addEventListener('resize', onResize);
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

  const trocarPixel = (p: number) => {
    setPixel(p);
    cenaRef.current?.setPixelSize(p);
  };

  const trocarSom = () => {
    const novoMudo = !somMudo;
    setSomMudo(novoMudo);
    setMuted(novoMudo);
    cenaRef.current?.setSomAtivo(!novoMudo);
  };

  return (
    <div className="fixed inset-0 table-bg overflow-hidden">
      <canvas
        ref={canvasRef}
        className="absolute inset-0 w-full h-full"
        style={{ imageRendering: 'pixelated' }}
      />

      {/* topo */}
      <div className="absolute top-0 inset-x-0 flex items-start justify-between p-4 sm:p-6 pointer-events-none">
        <div className="pointer-events-auto">
          <Link
            href="/"
            className="inline-block text-paper/60 hover:text-paper text-[12px] font-bold tracking-widest uppercase transition-colors"
          >
            ← voltar
          </Link>
          <h1 className="font-display text-paper text-2xl sm:text-3xl leading-none mt-1">
            MESA 3D<span className="text-red">*</span>
          </h1>
          <p className="text-paper/50 text-[11px] font-bold tracking-[0.12em] uppercase mt-1">
            *experimento retrô — nada aqui é definitivo
          </p>
        </div>

        <div className="pointer-events-auto flex items-end gap-4">
          <div className="flex flex-col items-end gap-2">
            <span className="text-paper/50 text-[10px] font-bold tracking-widest uppercase">som</span>
            <button
              onClick={trocarSom}
              className="h-9 px-3 rounded-lg bg-white/5 text-paper/80 border border-white/15 hover:bg-white/10 active:scale-90 font-bold text-[11px] transition-all"
              aria-label={somMudo ? 'Ativar som' : 'Silenciar som'}
            >
              {somMudo ? 'MUDO' : '♪ ON'}
            </button>
          </div>
          <div className="flex flex-col items-end gap-2">
            <span className="text-paper/50 text-[10px] font-bold tracking-widest uppercase">pixel</span>
            <div className="flex gap-1.5">
              {PIXELS.map((p) => (
                <button
                  key={p}
                  onClick={() => trocarPixel(p)}
                  className={`h-9 w-9 rounded-lg font-display text-[13px] transition-all active:scale-90 ${
                    pixel === p
                      ? 'btn-red'
                      : 'bg-white/5 text-paper/70 border border-white/15 hover:bg-white/10'
                  }`}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* laboratório de caos: dispara animações pra avaliar */}
      <div className="absolute bottom-0 left-0 p-4 sm:p-6 pointer-events-auto max-w-[300px]">
        <p className="text-paper/50 text-[10px] font-bold tracking-widest uppercase mb-2">
          laboratório de caos
        </p>
        <div className="flex flex-wrap gap-1.5 mb-2">
          {EXPRESSOES.map((e: Expressao) => (
            <button
              key={e}
              onClick={() => cenaRef.current?.testarExpressao(e)}
              className="h-8 px-2.5 rounded-lg bg-white/5 text-paper/80 border border-white/15 hover:bg-white/15 active:scale-90 font-bold text-[10px] tracking-wider uppercase transition-all"
            >
              {e}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-1.5 mb-2">
          {REACOES.map(({ tipo, rotulo }) => (
            <button
              key={tipo}
              onClick={() => cenaRef.current?.testarReacao(tipo)}
              className="h-8 px-2.5 rounded-lg bg-white/5 text-paper/80 border border-white/15 hover:bg-white/15 active:scale-90 font-bold text-[10px] tracking-wider transition-all"
            >
              {rotulo}
            </button>
          ))}
          <button
            onClick={() => cenaRef.current?.testarFala()}
            className="h-8 px-2.5 rounded-lg bg-white/5 text-paper/80 border border-white/15 hover:bg-white/15 active:scale-90 font-bold text-[10px] tracking-wider transition-all"
          >
            💬 FALA
          </button>
        </div>
        <div className="flex flex-wrap gap-1.5 mb-2">
          {ACOES.map((a: Acao) => (
            <button
              key={a}
              onClick={() => cenaRef.current?.testarAcao(a)}
              className="h-8 px-2.5 rounded-lg bg-white/5 text-paper/80 border border-white/15 hover:bg-white/15 active:scale-90 font-bold text-[10px] tracking-wider uppercase transition-all"
            >
              {ROTULO_ACAO[a]}
            </button>
          ))}
        </div>
        <button
          onClick={() => cenaRef.current?.martelada()}
          className="btn-red h-10 px-4 rounded-lg font-display text-[13px] tracking-wide active:scale-95 transition-all"
        >
          MARTELADA ⚖
        </button>
      </div>

      {/* rodapé */}
      <div className="absolute bottom-0 right-0 p-4 sm:p-6 flex justify-end pointer-events-none max-w-[45%]">
        <p className="text-paper/45 text-[11.5px] font-medium tracking-wide text-right">
          arrasta pra orbitar · rolagem aproxima · primeiro gesto liga o porão ·{' '}
          <span className="text-red font-bold">clique nas provas lacradas</span> pra revelar
        </p>
      </div>

      {!pronto && (
        <div className="absolute inset-0 flex items-center justify-center">
          <p className="font-display text-paper/60 text-sm tracking-widest">CARREGANDO A MESA…</p>
        </div>
      )}
    </div>
  );
}
