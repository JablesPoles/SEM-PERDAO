'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

function JoinByCode() {
  const [code, setCode] = useState('');
  const router = useRouter();

  const handleJoin = () => {
    const normalized = code.trim().toUpperCase();
    if (normalized.length === 5) router.push(`/sala/${normalized}`);
  };

  return (
    <div className="flex gap-2">
      <input
        type="text"
        value={code}
        onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5))}
        onKeyDown={(e) => e.key === 'Enter' && handleJoin()}
        placeholder="Código da sala"
        maxLength={5}
        className="flex-1 h-13 bg-white border-2 border-ink/20 text-ink rounded-xl px-4 outline-none focus:border-ink transition-colors placeholder-ink/30 text-center tracking-[0.25em] font-bold uppercase text-sm"
      />
      <button
        onClick={handleJoin}
        disabled={code.trim().length !== 5}
        className="h-13 px-5 rounded-xl border-2 border-ink text-ink font-bold text-[14px] transition-all hover:bg-ink hover:text-paper active:scale-95 disabled:opacity-30 disabled:cursor-not-allowed"
      >
        Entrar
      </button>
    </div>
  );
}

export default function Home() {
  const router = useRouter();

  return (
    <div className="min-h-screen lobby-bg flex flex-col items-center justify-center p-7">
      {/* Título */}
      <h1 className="font-display text-ink text-7xl sm:text-8xl leading-[0.92] text-center">
        SEM
        <br />
        PERDÃO<span className="text-red">*</span>
      </h1>
      <p className="font-bold text-ink text-[12px] tracking-[0.1em] mt-3">
        *NEM PARA VOCÊ. CONTEÚDO 18+.
      </p>
      <div className="h-0.5 w-16 my-7 bg-ink" />

      <div className="flex flex-col gap-3.5 w-full max-w-sm">
        <button
          onClick={() => router.push('/criar')}
          className="btn-red h-14 rounded-xl font-display text-base tracking-wide transition-all hover:brightness-110 active:scale-95"
        >
          CRIAR SALA
        </button>

        <div className="flex items-center gap-3">
          <div className="flex-1 h-px bg-ink/20" />
          <span className="text-ink/40 text-xs tracking-widest font-bold uppercase">ou</span>
          <div className="flex-1 h-px bg-ink/20" />
        </div>

        <JoinByCode />

        <div className="bg-white border-2 border-ink rounded-2xl px-5 py-4 mt-3">
          <p className="font-display text-ink text-[13px] tracking-wide mb-2">COMO FUNCIONA</p>
          <p className="text-ink/70 text-[13px] leading-relaxed font-medium">
            A cada rodada, um <span className="text-red font-bold">juiz</span> lê a carta preta.
            Os outros jogam a carta branca mais cruel da mão.
            O juiz condena a melhor — e quem fez a graça leva o ponto.
            Primeiro a fechar a conta vence. De 3 a 12 jogadores, na mesma sala ou no grupo do zap.
          </p>
        </div>

        <p className="text-center text-ink/40 text-[11.5px] leading-normal font-medium">
          As piadas são culpa de quem joga.
          <br />
          O jogo só entrega as armas.
        </p>
      </div>
    </div>
  );
}
