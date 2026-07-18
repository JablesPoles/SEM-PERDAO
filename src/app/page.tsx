'use client';
/**
 * Menu do Tribunal do Porão: identidade escura do jogo 3D já na porta.
 * Aqui vive a criação de personagem — o réu montado no menu persiste
 * (localStorage) e entra pronto em qualquer sala via useMultiplayer.
 */
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { CultistAppearance } from '@/lib/types';
import { DEFAULT_CULTIST_APPEARANCE } from '@/lib/types';
import {
  APPEARANCE_GROUPS,
  ACCENT_COLORS,
  aparenciaAleatoria,
  carregarAparencia,
  salvarAparencia,
} from '@/lib/aparencia';
import { CultistStage3D } from '@/components/CultistStage3D';

const NOME_MAX = 16;

function carregarNome(): string {
  if (typeof window === 'undefined') return '';
  return sessionStorage.getItem('sp-name') ?? localStorage.getItem('sp-name') ?? '';
}

function salvarNome(nome: string) {
  if (typeof window === 'undefined') return;
  sessionStorage.setItem('sp-name', nome);
  localStorage.setItem('sp-name', nome);
}

function EntrarPorCodigo() {
  const [codigo, setCodigo] = useState('');
  const router = useRouter();

  const entrar = () => {
    const normalizado = codigo.trim().toUpperCase();
    if (normalizado.length === 5) router.push(`/sala/${normalizado}`);
  };

  return (
    <div className="flex gap-2">
      <input
        type="text"
        value={codigo}
        onChange={(e) => setCodigo(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5))}
        onKeyDown={(e) => e.key === 'Enter' && entrar()}
        placeholder="Código do tribunal"
        maxLength={5}
        className="flex-1 h-13 bg-white/5 border-2 border-white/15 text-paper rounded-xl px-4 outline-none focus:border-paper/60 transition-colors placeholder:text-paper/30 text-center tracking-[0.25em] font-bold uppercase text-sm"
      />
      <button
        onClick={entrar}
        disabled={codigo.trim().length !== 5}
        className="h-13 px-5 rounded-xl border-2 border-paper/60 text-paper font-bold text-[14px] transition-all hover:bg-paper hover:text-ink active:scale-95 disabled:opacity-30 disabled:cursor-not-allowed"
      >
        Entrar
      </button>
    </div>
  );
}

export default function Home() {
  const router = useRouter();
  const [nome, setNome] = useState('');
  const [aparencia, setAparencia] = useState<CultistAppearance>(DEFAULT_CULTIST_APPEARANCE);
  const [personalizando, setPersonalizando] = useState(false);
  const [celebrar, setCelebrar] = useState(0);
  const [hidratado, setHidratado] = useState(false);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      setNome(carregarNome());
      setAparencia(carregarAparencia());
      setHidratado(true);
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  const mudarNome = (valor: string) => {
    const limpo = valor.slice(0, NOME_MAX);
    setNome(limpo);
    salvarNome(limpo.trim());
  };

  const mudarAparencia = (proxima: CultistAppearance) => {
    setAparencia(proxima);
    salvarAparencia(proxima);
  };

  const sortearReu = () => {
    mudarAparencia(aparenciaAleatoria());
    setCelebrar((n) => n + 1);
  };

  return (
    <div className="min-h-screen table-bg text-paper flex items-center justify-center p-5 sm:p-8">
      <div className="w-full max-w-5xl grid lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] gap-6 lg:gap-10 items-stretch">
        {/* ── o provador: seu réu em 3D ── */}
        <section
          className="bg-ink/70 border border-white/10 rounded-3xl p-5 flex flex-col min-h-[460px]"
          aria-labelledby="reu-title"
        >
          <div className="flex items-baseline justify-between gap-3">
            <h2 id="reu-title" className="font-display text-[15px] tracking-wide">
              SEU RÉU
            </h2>
            <span className="text-paper/40 text-[10px] font-bold tracking-[0.18em] uppercase">
              te acompanha em toda mesa
            </span>
          </div>

          <div className="relative flex-1 min-h-[260px] mt-3 rounded-2xl overflow-hidden border border-white/10">
            {hidratado && (
              <CultistStage3D
                nome={nome.trim() || 'RÉU'}
                aparencia={aparencia}
                celebrarSinal={celebrar}
                className="absolute inset-0 w-full h-full"
              />
            )}
            <span className="absolute bottom-2 inset-x-0 text-center text-paper/35 text-[10px] font-bold tracking-widest uppercase pointer-events-none">
              arrasta pra girar
            </span>
          </div>

          <input
            type="text"
            value={nome}
            onChange={(e) => mudarNome(e.target.value)}
            placeholder="Seu nome na mesa"
            maxLength={NOME_MAX}
            className="mt-4 h-12 bg-white/5 border-2 border-white/15 text-paper rounded-xl px-4 outline-none focus:border-paper/60 transition-colors placeholder:text-paper/30 font-bold text-center tracking-wide"
          />

          <div className="flex gap-2 mt-3">
            <button
              onClick={() => setPersonalizando((v) => !v)}
              className={`flex-1 h-11 rounded-xl font-display text-[13px] tracking-wide transition-all active:scale-95 ${
                personalizando
                  ? 'bg-paper text-ink'
                  : 'border-2 border-paper/50 text-paper hover:bg-paper hover:text-ink'
              }`}
            >
              {personalizando ? 'FECHAR VESTIÁRIO' : 'PERSONALIZAR RÉU'}
            </button>
            <button
              onClick={sortearReu}
              className="h-11 px-4 rounded-xl border-2 border-white/15 text-paper/80 font-bold text-[12px] tracking-wider hover:bg-white/10 active:scale-95 transition-all"
              title="Sortear aparência"
            >
              🎲 SORTEAR
            </button>
          </div>

          {personalizando && (
            <div className="mt-4 flex flex-col gap-3">
              {APPEARANCE_GROUPS.map((grupo) => (
                <fieldset key={grupo.key}>
                  <legend className="text-paper/45 text-[10px] font-bold tracking-[0.18em] uppercase mb-1.5">
                    {grupo.label}
                  </legend>
                  <div className="flex flex-wrap gap-1.5">
                    {grupo.options.map((opcao) => {
                      const selecionada = aparencia[grupo.key] === opcao.value;
                      return (
                        <button
                          key={opcao.value}
                          aria-pressed={selecionada}
                          onClick={() =>
                            mudarAparencia({ ...aparencia, [grupo.key]: opcao.value } as CultistAppearance)
                          }
                          style={
                            selecionada && grupo.key === 'accent'
                              ? { borderColor: ACCENT_COLORS[aparencia.accent] }
                              : undefined
                          }
                          className={`h-9 px-3 rounded-lg font-bold text-[11px] tracking-wide transition-all active:scale-95 border-2 ${
                            selecionada
                              ? 'bg-paper text-ink border-paper'
                              : 'bg-white/5 text-paper/70 border-white/15 hover:bg-white/10'
                          }`}
                        >
                          {opcao.label}
                        </button>
                      );
                    })}
                  </div>
                </fieldset>
              ))}
            </div>
          )}
        </section>

        {/* ── a porta do tribunal ── */}
        <section className="flex flex-col justify-center py-2">
          <h1 className="font-display text-6xl sm:text-7xl leading-[0.92]">
            SEM
            <br />
            PERDÃO<span className="text-red">*</span>
          </h1>
          <p className="font-bold text-paper/70 text-[12px] tracking-[0.1em] mt-3">
            *NEM PARA VOCÊ. CONTEÚDO 18+.
          </p>
          <div className="h-0.5 w-16 my-6 bg-paper/30" />

          <div className="flex flex-col gap-3.5 max-w-sm">
            <button
              onClick={() => router.push('/criar')}
              className="btn-red h-14 rounded-xl font-display text-base tracking-wide transition-all hover:brightness-110 active:scale-95"
            >
              CRIAR TRIBUNAL
            </button>

            <div className="flex items-center gap-3">
              <div className="flex-1 h-px bg-white/15" />
              <span className="text-paper/40 text-xs tracking-widest font-bold uppercase">ou</span>
              <div className="flex-1 h-px bg-white/15" />
            </div>

            <EntrarPorCodigo />

            <div className="bg-white/5 border border-white/10 rounded-2xl px-5 py-4 mt-3">
              <p className="font-display text-[13px] tracking-wide mb-2">COMO FUNCIONA</p>
              <p className="text-paper/60 text-[13px] leading-relaxed font-medium">
                A cada rodada, um <span className="text-red font-bold">juiz</span> lê a carta preta.
                Os outros jogam a carta branca mais cruel da mão.
                O juiz condena a melhor — e quem fez a graça leva o ponto.
                Depois das voltas combinadas, a maior ficha vence. De 3 a 8 cultistas na mesma mesa 3D.
              </p>
            </div>

            <p className="text-paper/35 text-[11.5px] leading-normal font-medium">
              As piadas são culpa de quem joga.
              <br />
              O jogo só entrega as armas.
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}
