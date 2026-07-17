'use client';

interface DisconnectOverlayProps {
  player: { id: number; name: string };
  isHost: boolean;
  onRemove: () => void;
}

export function DisconnectOverlay({ player, isHost, onRemove }: DisconnectOverlayProps) {
  return (
    <div className="fixed inset-0 z-50 bg-[rgba(16,15,19,0.9)] backdrop-blur-[3px] flex items-center justify-center p-5">
      <div className="w-full max-w-sm text-center flex flex-col items-center gap-5">
        <div className="w-14 h-14 rounded-full border border-red/60 bg-red/10 flex items-center justify-center">
          <span className="text-2xl">📶</span>
        </div>

        <div className="flex flex-col gap-1.5">
          <span className="font-display text-paper text-3xl leading-tight">
            {player.name} caiu.
          </span>
          <span className="text-red font-bold text-[15px]">
            jogo pausado — aguardando reconexão
          </span>
        </div>

        {isHost ? (
          <button
            onClick={onRemove}
            className="w-full h-13 rounded-xl border-2 border-red text-red font-display text-[14px] tracking-wide transition-all hover:bg-red/10 active:scale-95"
          >
            REMOVER DA PARTIDA
          </button>
        ) : (
          <p className="text-paper/45 text-xs">
            apenas o anfitrião pode remover jogadores
          </p>
        )}
      </div>
    </div>
  );
}
