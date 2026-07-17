'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

function generateRoomCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 5 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

export default function CriarSala() {
  const [name, setName] = useState('');
  const [roomCode] = useState(() => generateRoomCode());
  const router = useRouter();

  const handleCreate = () => {
    if (!name.trim()) return;
    sessionStorage.setItem('sp-name', name.trim());
    sessionStorage.setItem('sp-host-room', roomCode);
    router.push(`/sala/${roomCode}`);
  };

  return (
    <div className="min-h-screen lobby-bg relative flex flex-col items-center justify-center p-7">
      <button
        onClick={() => router.push('/')}
        className="absolute top-6 left-6 text-ink/50 hover:text-red text-sm font-bold transition-colors"
      >
        ← Voltar
      </button>

      <div className="flex flex-col items-center gap-1.5">
        <span className="text-red font-bold text-[12px] tracking-[0.15em]">MONTE O TRIBUNAL</span>
        <h1 className="font-display text-ink text-5xl leading-none">CRIAR SALA</h1>
      </div>

      <div className="w-full max-w-sm flex flex-col gap-4 mt-9">
        <div className="flex flex-col gap-2">
          <label className="text-ink/55 text-[11px] font-bold tracking-[2px] pl-1">SEU NOME NA MESA</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
            placeholder="Como te chamamos?"
            maxLength={16}
            autoFocus
            className="h-[54px] rounded-xl bg-white border-2 border-ink/20 text-ink px-[18px] outline-none focus:border-ink transition-colors placeholder:text-ink/30 font-medium"
          />
        </div>

        <button
          onClick={handleCreate}
          disabled={!name.trim()}
          className="btn-red h-13 rounded-xl font-display text-[15px] tracking-wide transition-all hover:brightness-110 active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          ABRIR A SALA
        </button>

        <p className="text-ink/45 text-xs text-center leading-normal font-medium">
          Você abre a sala e compartilha o código. Precisa de pelo
          <br />
          menos 3 na mesa — dá pra completar com bots.
        </p>
      </div>
    </div>
  );
}
