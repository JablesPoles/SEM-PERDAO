'use client';
import { use, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMultiplayer } from '../../../hooks/useMultiplayer';
import { MIN_PLAYERS, DEFAULT_SCORE_LIMIT } from '../../../lib/game';
import { GameBoard } from '../../../components/GameBoard';
import { DisconnectOverlay } from '../../../components/DisconnectOverlay';
import { ChatPanel } from '../../../components/ChatPanel';
import { avatarColor, initials } from '../../../components/avatar';
import { ChatMessage } from '../../../lib/types';
import { playSound } from '../../../lib/sounds';

interface PageProps {
  params: Promise<{ id: string }>;
}

interface ChatWidgetProps {
  messages: ChatMessage[];
  myPlayerId: number | null;
  onSend: (text: string) => void;
}

function ChatIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}

function ChatWidget({ messages, myPlayerId, onSend }: ChatWidgetProps) {
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const prevCount = useRef(0);

  useEffect(() => {
    const n = messages.length;
    if (n > prevCount.current) {
      if (!open) setUnread((u) => u + (n - prevCount.current));
      // Só apita mensagem dos outros, não a sua.
      const last = messages[n - 1];
      if (last && last.playerId !== myPlayerId) playSound('chat');
    }
    prevCount.current = n;
  }, [messages.length, open, messages, myPlayerId]);

  return (
    <div className="fixed bottom-4 right-3 z-40 flex flex-col items-end gap-2">
      {open && (
        <div
          className="w-72 flex flex-col bg-[#100f13]/95 border border-white/10 rounded-2xl shadow-2xl overflow-hidden backdrop-blur-md"
          style={{ height: '320px' }}
        >
          <div className="flex items-center justify-between px-3.5 py-2.5 border-b border-white/10 shrink-0">
            <span className="text-red font-bold text-[10.5px] tracking-[1.5px]">CHAT DO TRIBUNAL</span>
            <button
              onClick={() => setOpen(false)}
              className="text-paper/50 hover:text-red text-lg leading-none transition-colors"
            >
              ×
            </button>
          </div>
          <ChatPanel messages={messages} myPlayerId={myPlayerId} onSend={onSend} />
        </div>
      )}

      <button
        onClick={() => { setOpen((v) => !v); setUnread(0); }}
        className="relative w-11 h-11 rounded-full border border-red/50 bg-[#100f13]/80 hover:border-red active:scale-95 flex items-center justify-center shadow-xl transition-all text-red"
      >
        {open ? <span className="text-lg leading-none">×</span> : <ChatIcon />}
        {!open && unread > 0 && (
          <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-0.5 bg-red text-white text-[9px] font-black rounded-full flex items-center justify-center shadow">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>
    </div>
  );
}

function JoinForm({ roomCode, onJoin }: {
  roomCode: string;
  onJoin: (name: string) => void;
}) {
  const [name, setName] = useState('');
  return (
    <div className="min-h-screen lobby-bg flex flex-col items-center justify-center p-7">
      <h1 className="font-display text-ink text-6xl leading-[0.92] text-center">
        SEM
        <br />
        PERDÃO<span className="text-red">*</span>
      </h1>

      <div className="text-center mt-9 flex flex-col gap-1.5">
        <span className="font-display text-ink text-2xl leading-tight">
          TE CHAMARAM PRO TRIBUNAL
        </span>
        <span className="text-red font-bold text-[13px] tracking-[0.12em]">
          SALA {roomCode}
        </span>
      </div>

      <div className="w-full max-w-sm mt-9 flex flex-col gap-3.5">
        <div className="flex flex-col gap-2">
          <label className="text-ink/55 text-[11px] font-bold tracking-[2px] pl-1">SEU NOME NA MESA</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && name.trim() && onJoin(name.trim())}
            placeholder="Como te chamamos?"
            maxLength={16}
            className="h-[54px] rounded-xl bg-white border-2 border-ink/20 text-ink px-[18px] outline-none focus:border-ink transition-colors placeholder:text-ink/30 font-medium"
          />
        </div>
        <button
          onClick={() => name.trim() && onJoin(name.trim())}
          disabled={!name.trim()}
          className="btn-red h-[54px] rounded-xl font-display text-[15px] tracking-wide transition-all hover:brightness-110 active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          SENTAR NO BANCO DOS RÉUS
        </button>
      </div>

      <p className="text-center text-ink/45 text-xs leading-normal mt-10 font-medium">
        Um juiz. Uma pergunta terrível.
        <br />
        Vence a resposta mais sem perdão.
      </p>
    </div>
  );
}

export default function SalaPage({ params }: PageProps) {
  const { id: roomCode } = use(params);
  const router = useRouter();

  const [nameInput, setNameInput] = useState<string | null>(() => {
    if (typeof window !== 'undefined') return sessionStorage.getItem('sp-name');
    return null;
  });

  const [confirmLeave, setConfirmLeave] = useState(false);
  const [scoreLimit, setScoreLimit] = useState(DEFAULT_SCORE_LIMIT);
  const [showPlayers, setShowPlayers] = useState(false);

  const initialIsHost =
    typeof window !== 'undefined' && sessionStorage.getItem('sp-host-room') === roomCode;

  const mp = useMultiplayer(roomCode, nameInput, initialIsHost);
  // Flag viva: o host pode mudar no meio do jogo se o original sair.
  const isHost = mp.isHost;

  useEffect(() => {
    if (mp.wasKicked) router.push('/');
  }, [mp.wasKicked, router]);

  if (!nameInput) {
    return (
      <JoinForm
        roomCode={roomCode}
        onJoin={(n) => {
          sessionStorage.setItem('sp-name', n);
          setNameInput(n);
        }}
      />
    );
  }

  // Convidado batendo na porta de jogo em andamento — o host decide.
  if (mp.awaitingApproval || mp.joinRejected) {
    return (
      <div className="min-h-screen lobby-bg flex flex-col items-center justify-center p-7">
        <h1 className="font-display text-ink text-5xl leading-[0.92] text-center">
          SEM
          <br />
          PERDÃO<span className="text-red">*</span>
        </h1>
        <div className="text-center mt-9 flex flex-col gap-2 max-w-sm">
          <span className="font-display text-ink text-2xl leading-tight">
            {mp.joinRejected ? 'O JUIZ NEGOU SEU HABEAS CORPUS.' : 'O JULGAMENTO JÁ COMEÇOU.'}
          </span>
          <span className="text-red font-bold text-[13px]">
            {mp.joinRejected
              ? 'talvez na próxima sessão'
              : 'pedimos pro anfitrião te deixar entrar…'}
          </span>
          {!mp.joinRejected && (
            <span className="text-ink/50 text-[13px] mt-1 font-medium">
              Se ele liberar, você entra no começo da próxima rodada.
            </span>
          )}
        </div>
        <button
          onClick={() => router.push('/')}
          className="w-full max-w-sm h-13 rounded-xl border-2 border-ink text-ink font-bold text-[14px] mt-9 transition-all hover:bg-ink hover:text-paper active:scale-95"
        >
          Voltar ao início
        </button>
      </div>
    );
  }

  if (mp.error) {
    return (
      <div className="min-h-screen lobby-bg flex items-center justify-center p-7">
        <div className="w-full max-w-sm text-center flex flex-col items-center gap-4">
          <div className="text-red text-4xl">⚠</div>
          <p className="font-display text-ink text-xl leading-snug">{mp.error}</p>
          <button
            onClick={() => router.push('/')}
            className="w-full h-13 rounded-xl border-2 border-ink text-ink font-bold text-[14px] transition-all hover:bg-ink hover:text-paper active:scale-95"
          >
            Voltar ao início
          </button>
        </div>
      </div>
    );
  }

  if (!mp.isConnected || mp.role === 'connecting') {
    return (
      <div className="min-h-screen lobby-bg flex items-center justify-center">
        <div className="text-center flex flex-col items-center gap-4">
          <div className="font-display text-ink text-5xl">
            SEM PERDÃO<span className="text-red">*</span>
          </div>
          <div className="text-red font-bold animate-pulse text-[14px] tracking-wide">
            conectando à sala {roomCode}…
          </div>
        </div>
      </div>
    );
  }

  const chatWidget = (
    <ChatWidget
      messages={mp.chatMessages}
      myPlayerId={mp.myPlayerId}
      onSend={mp.sendChat}
    />
  );

  if (mp.gameState) {
    const activePlayers = mp.lobbyPlayers.filter(p => {
      const gs = mp.gameState!;
      return !gs.players.find(gp => gp.id === p.id)?.eliminated;
    });

    return (
      <>
        <GameBoard
          state={mp.gameState}
          myId={mp.myPlayerId ?? 0}
          onSubmit={(cardIds) => mp.sendAction({ type: 'submit', cardIds })}
          onJudge={(index) => mp.sendAction({ type: 'judge', index })}
          onNextRound={() => mp.sendAction({ type: 'next_round' })}
          onRestart={() => { mp.disconnect(); router.push('/'); }}
        />

        {/* Host: alguém quer entrar no meio do jogo */}
        {mp.pendingJoins.length > 0 && isHost && (
          <div className="fixed top-3 left-1/2 -translate-x-1/2 z-50 flex flex-col gap-2">
            {mp.pendingJoins.map((j) => (
              <div
                key={j.clientId}
                className="flex items-center gap-3 bg-[#100f13]/95 border border-red/50 rounded-2xl px-4 py-2.5 shadow-2xl backdrop-blur-md"
              >
                <span className="text-paper text-sm">
                  <span className="font-bold text-red">{j.name}</span> quer entrar
                </span>
                <button
                  onClick={() => mp.approveJoin(j.clientId)}
                  className="btn-red h-8 px-3 rounded-lg text-[12.5px] font-bold transition-all hover:brightness-110 active:scale-95"
                >
                  Deixar entrar
                </button>
                <button
                  onClick={() => mp.rejectJoin(j.clientId)}
                  className="h-8 px-3 rounded-lg border border-white/25 text-paper/70 hover:text-paper text-[12.5px] font-bold transition-all active:scale-95"
                >
                  Recusar
                </button>
              </div>
            ))}
          </div>
        )}

        {/* O host antigo saiu e este cliente assumiu a mesa */}
        {mp.becameHost && (
          <div className="fixed top-3 left-1/2 -translate-x-1/2 z-50 bg-[#100f13]/95 border border-red/50 rounded-full px-4 py-2 shadow-xl backdrop-blur-md">
            <span className="text-red font-bold text-[12.5px]">
              o anfitrião saiu — você assumiu a mesa, a rodada foi redistribuída
            </span>
          </div>
        )}

        {/* Aprovado no meio do jogo — sem mão até a próxima rodada */}
        {mp.seatedNextRound && (
          <div className="fixed top-3 left-1/2 -translate-x-1/2 z-50 bg-[#100f13]/95 border border-white/20 rounded-full px-4 py-2 shadow-xl backdrop-blur-md">
            <span className="text-paper/80 font-bold text-[12.5px]">
              você entra no começo da próxima rodada…
            </span>
          </div>
        )}

        {mp.disconnectedPlayer && (
          <DisconnectOverlay
            player={mp.disconnectedPlayer}
            isHost={isHost}
            onRemove={mp.removeDisconnectedPlayer}
          />
        )}

        {/* Ações flutuantes: canto inferior esquerdo */}
        <div className="fixed bottom-4 left-3 z-40 flex flex-col items-start gap-2">
          {isHost && showPlayers && (
            <div className="w-60 bg-[#100f13]/95 border border-white/10 rounded-2xl shadow-2xl overflow-hidden backdrop-blur-md p-3 flex flex-col gap-2">
              <span className="text-red font-bold text-[10.5px] tracking-[1.5px] px-1">JOGADORES</span>
              {activePlayers.filter(p => p.id !== mp.hostId && !p.isBot).map(p => (
                <div key={p.id} className="flex items-center gap-2 px-2 py-1.5 rounded-xl bg-white/[0.04]">
                  <div
                    className="w-7 h-7 rounded-full flex items-center justify-center font-bold text-[11px] shrink-0 text-white"
                    style={{ background: avatarColor(p.id) }}
                  >
                    {initials(p.name)}
                  </div>
                  <span className="text-paper text-sm flex-1 truncate">{p.name}</span>
                  <button
                    onClick={() => mp.kickPlayer(p.id)}
                    className="text-red/70 hover:text-red text-xs px-1.5 py-0.5 rounded transition-colors"
                    title="Remover jogador"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="flex gap-2">
            {isHost && (
              <button
                onClick={() => setShowPlayers(v => !v)}
                className="w-11 h-11 rounded-full border border-white/25 bg-[#100f13]/80 hover:border-paper active:scale-95 flex items-center justify-center shadow-xl transition-all text-paper text-base"
                title="Gerenciar jogadores"
              >
                ≡
              </button>
            )}
            <button
              onClick={() => setConfirmLeave(true)}
              className="w-11 h-11 rounded-full border border-red/40 bg-[#100f13]/80 hover:border-red active:scale-95 flex items-center justify-center shadow-xl transition-all text-red text-base"
              title="Sair da partida"
            >
              ✕
            </button>
          </div>
        </div>

        {confirmLeave && (
          <div className="fixed inset-0 z-50 bg-[rgba(16,15,19,0.92)] backdrop-blur-[3px] flex items-center justify-center p-5">
            <div className="w-full max-w-sm text-center flex flex-col items-center gap-5">
              <span className="font-display text-paper text-3xl leading-tight">SAIR DA PARTIDA?</span>
              <span className="text-red font-bold text-[14px]">
                {isHost ? 'O jogo será encerrado para todos.' : 'Você será removido da mesa.'}
              </span>
              <div className="flex gap-3 w-full">
                <button
                  onClick={() => setConfirmLeave(false)}
                  className="flex-1 h-13 rounded-xl border-2 border-white/40 text-paper font-bold text-[14px] transition-all hover:bg-white/[0.06] active:scale-95"
                >
                  Cancelar
                </button>
                <button
                  onClick={() => { mp.disconnect(); router.push('/'); }}
                  className="flex-1 h-13 rounded-xl border-2 border-red text-red font-bold text-[14px] transition-all hover:bg-red/10 active:scale-95"
                >
                  Sair
                </button>
              </div>
            </div>
          </div>
        )}

        {chatWidget}
      </>
    );
  }

  // Lobby
  const roomUrl = typeof window !== 'undefined' ? `${window.location.origin}/sala/${roomCode}` : '';
  const canStart = mp.lobbyPlayers.length >= MIN_PLAYERS;
  const bots = mp.lobbyPlayers.filter((p) => p.isBot);

  return (
    <>
      <div className="min-h-screen lobby-bg flex flex-col items-center justify-center p-7">
        <div className="w-full max-w-sm flex flex-col">
          <div className="flex flex-col items-center gap-1.5">
            <span className="text-red font-bold text-[12px] tracking-[0.15em]">O TRIBUNAL ESTÁ MONTADO</span>
            <h1 className="font-display text-ink text-4xl leading-none text-center">
              SALA {roomCode}
            </h1>
          </div>

          <div className="mt-7 bg-white border-2 border-ink rounded-2xl px-5 py-[18px] flex flex-col gap-3">
            <span className="text-ink/55 text-[11px] font-bold tracking-[2px]">CÓDIGO DA SALA</span>
            <div className="flex justify-between items-center">
              <span className="font-display text-ink text-4xl tracking-[8px]">{roomCode}</span>
              <button
                onClick={() => navigator.clipboard.writeText(roomUrl)}
                className="btn-ink h-[42px] px-[18px] rounded-[10px] font-bold text-[13px] transition-all hover:brightness-125 active:scale-95"
              >
                Copiar link
              </button>
            </div>
            <div className="h-px bg-ink/15" />
            <span className="text-ink/55 text-[12.5px] text-center font-medium">
              manda no grupo — quem clicar senta na mesa
            </span>
          </div>

          <div className="mt-6 flex flex-col gap-2.5">
            <div className="flex justify-between items-baseline px-1">
              <span className="text-ink/55 text-[11px] font-bold tracking-[2px]">NA MESA</span>
              <span className="text-ink/55 text-xs font-medium">
                {mp.lobbyPlayers.length} jogador{mp.lobbyPlayers.length > 1 ? 'es' : ''}
              </span>
            </div>
            {mp.lobbyPlayers.map((p) => (
              <div
                key={p.id}
                className={`flex items-center gap-3 px-3.5 py-3 rounded-[14px] bg-white border-2 ${
                  p.id === mp.myPlayerId ? 'border-red' : 'border-ink/10'
                }`}
              >
                <div
                  className="w-[38px] h-[38px] rounded-full flex items-center justify-center font-bold text-[13px] text-white"
                  style={{ background: p.id === mp.hostId ? '#17161a' : avatarColor(p.id) }}
                >
                  {p.isBot ? '🤖' : initials(p.name)}
                </div>
                <div className="flex flex-col gap-px flex-1">
                  <span className="text-ink font-bold text-sm">{p.name}</span>
                  <span className={`text-xs font-medium ${p.id === mp.hostId ? 'text-ink/55' : 'text-ok'}`}>
                    {p.id === mp.hostId ? 'anfitrião' : p.isBot ? 'bot — joga aleatório' : 'pronto'}
                  </span>
                </div>
                {p.id === mp.myPlayerId && <span className="text-red text-base font-display">*</span>}
                {isHost && p.id !== mp.hostId && (
                  <button
                    onClick={() => (p.isBot ? mp.removeBot(p.id) : mp.kickPlayer(p.id))}
                    className="text-red/50 hover:text-red text-sm px-1.5 py-0.5 rounded transition-colors"
                    title="Remover da sala"
                  >
                    ✕
                  </button>
                )}
              </div>
            ))}
            {mp.lobbyPlayers.length < MIN_PLAYERS && (
              <div className="flex items-center gap-3 px-3.5 py-3 rounded-[14px] border-2 border-dashed border-ink/25">
                <div className="w-[38px] h-[38px] rounded-full border-2 border-dashed border-ink/25 flex items-center justify-center text-ink/35">
                  ?
                </div>
                <span className="text-ink/40 text-[13.5px] italic font-medium">esperando a galera entrar…</span>
              </div>
            )}
            {isHost && bots.length < 3 && (
              <button
                onClick={mp.addBot}
                className="h-11 rounded-[14px] border-2 border-dashed border-ink/30 text-ink/60 hover:text-ink hover:border-ink font-bold text-[13px] transition-all active:scale-[0.98]"
              >
                + Adicionar bot
              </button>
            )}
          </div>

          <div className="mt-7 flex flex-col gap-3">
            {mp.role === 'host' && (
              <>
                <div className="flex flex-col gap-2">
                  <div className="flex justify-between items-baseline px-1">
                    <span className="text-ink/55 text-[11px] font-bold tracking-[2px]">JOGAR ATÉ</span>
                    <span className="text-ink/45 text-xs font-medium">{scoreLimit} pontos</span>
                  </div>
                  <div className="flex gap-2 justify-center flex-wrap">
                    {[5, 7, 10].map((n) => (
                      <button
                        key={n}
                        onClick={() => setScoreLimit(n)}
                        className={[
                          'h-10 px-5 rounded-[10px] text-[14px] font-bold transition-all',
                          scoreLimit === n
                            ? 'bg-ink text-paper'
                            : 'border-2 border-ink/25 text-ink/60 hover:border-ink hover:text-ink',
                        ].join(' ')}
                      >
                        {n}
                      </button>
                    ))}
                  </div>
                </div>

                <button
                  onClick={() => mp.startGame(scoreLimit)}
                  disabled={!canStart}
                  className="btn-red h-13 rounded-xl font-display text-[15px] tracking-wide transition-all hover:brightness-110 active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {canStart
                    ? `COMEÇAR COM ${mp.lobbyPlayers.length} JOGADORES`
                    : `FALTA${MIN_PLAYERS - mp.lobbyPlayers.length > 1 ? 'M' : ''} ${MIN_PLAYERS - mp.lobbyPlayers.length} PRA COMEÇAR`}
                </button>
                <p className="text-center text-ink/45 text-xs font-medium">
                  {canStart
                    ? 'pode começar agora ou esperar mais gente'
                    : 'compartilhe o código ou complete com bots — mínimo 3'}
                </p>
              </>
            )}
            {mp.role === 'guest' && (
              <>
                <p className="text-red font-bold text-[14px] text-center animate-pulse">
                  aguardando o anfitrião abrir o julgamento…
                </p>
                <button
                  onClick={() => { mp.leaveLobby(); router.push('/'); }}
                  className="h-11 rounded-xl border-2 border-red/40 text-red/80 hover:text-red font-bold text-sm transition-all hover:border-red active:scale-95"
                >
                  Sair da sala
                </button>
              </>
            )}
          </div>
        </div>
      </div>
      {chatWidget}
    </>
  );
}
