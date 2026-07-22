'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { ACTOR_INTENTS, type ActorIntent } from '@/lib/mesa/actorContract';
import { APPEARANCE_GROUPS, aparenciaAleatoria } from '@/lib/aparencia';
import { DEFAULT_CULTIST_APPEARANCE, type CultistAppearance } from '@/lib/types';
import type { ModelGalleryMetrics, ModelGalleryScene } from '@/lib/three/modelGalleryScene';

const ROTULOS_INTENCAO: Record<ActorIntent, string> = {
  idle: 'Repouso',
  speak: 'Falar',
  laugh: 'Rir',
  point: 'Apontar',
  clap: 'Aplaudir',
  celebrate: 'Celebrar',
  facepalm: 'Facepalm',
  hit: 'Impacto',
  rage: 'Tilt',
  sleep: 'Dormir',
  collapse: 'Tombar',
};

/** Tetos do `ACTOR_PIPELINE.md`, para o custo aparecer junto do limite. */
const TETO_ATOR = 2_500;
const TETO_PROPS = 3_000;

export function ModelGallery() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const sceneRef = useRef<ModelGalleryScene | null>(null);
  const [metricas, setMetricas] = useState<ModelGalleryMetrics | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [appearance, setAppearance] = useState<CultistAppearance>(DEFAULT_CULTIST_APPEARANCE);
  const chaveAparencia = useMemo(() => JSON.stringify(appearance), [appearance]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let cena: ModelGalleryScene | null = null;
    let vivo = true;

    // Import dinâmico: Three.js não pode entrar no bundle do servidor nem
    // atrasar o primeiro paint desta página, que é puramente visual.
    void import('@/lib/three/modelGalleryScene')
      .then(({ ModelGalleryScene: Cena }) => {
        if (!vivo) return;
        cena = new Cena({ canvas, onReady: setMetricas });
        sceneRef.current = cena;
      })
      .catch((causa) => {
        if (vivo) setErro(causa instanceof Error ? causa.message : 'Falha ao montar a vitrine.');
      });

    const aoRedimensionar = () => sceneRef.current?.redimensionar();
    window.addEventListener('resize', aoRedimensionar);
    return () => {
      vivo = false;
      window.removeEventListener('resize', aoRedimensionar);
      cena?.dispose();
      sceneRef.current = null;
    };
  }, []);

  useEffect(() => {
    sceneRef.current?.setAppearance(appearance);
    // a aparência é comparada por valor; o objeto muda de identidade a cada set
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chaveAparencia]);

  const custoAtor = metricas?.triangulosAtor ?? 0;
  const custoProps = metricas?.triangulosProps ?? 0;

  return (
    <main className="min-h-dvh bg-[#0a090c] text-paper px-4 sm:px-8 py-6">
      <header className="flex flex-wrap items-end justify-between gap-4 mb-5">
        <div>
          <p className="text-red text-[10px] font-black tracking-[0.3em] uppercase">
            A MESA ENGINE / DEV TOOL 02
          </p>
          <h1 className="font-display text-4xl sm:text-6xl leading-none">
            ACERVO 3D<span className="text-red">*</span>
          </h1>
          <p className="text-paper/55 text-[12px] mt-2 max-w-lg">
            Tudo que sai de <code className="text-paper/80">tools/blender/</code> em um só
            enquadramento — o teste é se as peças pertencem ao mesmo mundo.
          </p>
        </div>
        <div className="flex gap-2">
          <Link
            href="/lab/actors"
            className="h-10 px-4 flex items-center border border-paper/25 text-[11px] font-black tracking-[0.16em] hover:border-paper/60 transition-colors"
          >
            CHARACTER LAB
          </Link>
          <Link
            href="/3d"
            className="h-10 px-4 flex items-center border border-paper/25 text-[11px] font-black tracking-[0.16em] hover:border-paper/60 transition-colors"
          >
            ← MESA
          </Link>
        </div>
      </header>

      <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
        <div className="relative border border-paper/15 bg-black/50 overflow-hidden">
          <canvas ref={canvasRef} className="block w-full h-[52vh] lg:h-[70vh]" />
          <p className="absolute top-3 left-4 text-[9px] font-black tracking-[0.24em] text-paper/40">
            ARRASTE PARA ORBITAR · SCROLL PARA ZOOM
          </p>
          {!metricas && !erro && (
            <p className="absolute inset-0 grid place-items-center text-[11px] font-black tracking-[0.2em] text-paper/45">
              CARREGANDO ACERVO…
            </p>
          )}
          {erro && (
            <p className="absolute inset-0 grid place-items-center px-6 text-center text-[11px] text-red">
              {erro}
            </p>
          )}
        </div>

        <aside className="flex flex-col gap-4">
          <section className="border border-paper/15 p-3">
            <h2 className="text-[10px] font-black tracking-[0.24em] text-paper/70 mb-2">
              CUSTO GEOMÉTRICO
            </h2>
            <Linha rotulo="Cultista" valor={custoAtor} teto={TETO_ATOR} />
            <Linha rotulo="Props (8)" valor={custoProps} teto={TETO_PROPS} />
            <p className="text-paper/40 text-[10px] mt-2 leading-relaxed">
              Tetos derivados do renderer: o palco desenha em <em>largura/4</em> com
              posterização, então um ator ocupa ~160 px na tela.
            </p>
            {metricas?.falhas.map((falha) => (
              <p key={falha} className="text-red text-[10px] mt-2">{falha}</p>
            ))}
          </section>

          <section className="border border-paper/15 p-3">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-[10px] font-black tracking-[0.24em] text-paper/70">APARÊNCIA</h2>
              <button
                type="button"
                onClick={() => setAppearance(aparenciaAleatoria())}
                className="text-[10px] font-black tracking-[0.16em] text-red hover:text-paper transition-colors"
              >
                SORTEAR
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {APPEARANCE_GROUPS.map((grupo) => (
                <label key={grupo.key} className="flex flex-col gap-1">
                  <span className="text-[9px] font-black tracking-[0.14em] text-paper/45 uppercase">
                    {grupo.label}
                  </span>
                  <select
                    value={appearance[grupo.key]}
                    onChange={(evento) => setAppearance((atual) => ({
                      ...atual,
                      [grupo.key]: evento.target.value,
                    }))}
                    className="bg-black/60 border border-paper/20 text-[11px] font-bold px-2 py-1.5"
                  >
                    {grupo.options.map((opcao) => (
                      <option key={opcao.value} value={opcao.value}>{opcao.label}</option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
            <p className="text-paper/40 text-[10px] mt-2 leading-relaxed">
              Trocar capuz ou adereço liga e desliga nós do mesmo GLB. Cor de túnica
              pinta material. Nada é recarregado.
            </p>
          </section>

          <section className="border border-paper/15 p-3">
            <h2 className="text-[10px] font-black tracking-[0.24em] text-paper/70 mb-2">
              ANIMAÇÕES
            </h2>
            <div className="flex flex-wrap gap-1.5">
              {ACTOR_INTENTS.map((intencao) => (
                <button
                  key={intencao}
                  type="button"
                  onClick={() => sceneRef.current?.playIntent(intencao)}
                  className="px-2.5 py-1.5 border border-paper/20 text-[10px] font-bold hover:border-red hover:text-red transition-colors"
                >
                  {ROTULOS_INTENCAO[intencao]}
                </button>
              ))}
            </div>
          </section>
        </aside>
      </div>
    </main>
  );
}

function Linha({ rotulo, valor, teto }: { rotulo: string; valor: number; teto: number }) {
  const proporcao = teto > 0 ? Math.min(1, valor / teto) : 0;
  const estourou = valor > teto;
  return (
    <div className="mb-2 last:mb-0">
      <div className="flex justify-between text-[11px] font-bold">
        <span className="text-paper/70">{rotulo}</span>
        <span className={estourou ? 'text-red' : 'text-paper/90'}>
          {valor.toLocaleString('pt-BR')} <span className="text-paper/35">/ {teto.toLocaleString('pt-BR')}</span>
        </span>
      </div>
      <div className="h-1.5 mt-1 bg-paper/10">
        <div
          className={`h-full ${estourou ? 'bg-red' : 'bg-paper/55'}`}
          style={{ width: `${proporcao * 100}%` }}
        />
      </div>
    </div>
  );
}
