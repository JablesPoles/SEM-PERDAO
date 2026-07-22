'use client';
import { use, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMultiplayer } from '../../../hooks/useMultiplayer';
import { getPhaseId, MAX_PLAYERS, MIN_PLAYERS } from '../../../lib/game';
import { MesaOnline } from '../../../components/MesaOnline';
import { ChatPanel } from '../../../components/ChatPanel';
import { CustomDeckEditor } from '../../../components/CustomDeckEditor';
import { RitualLobby } from '../../../components/lobby/RitualLobby';
import { avatarColor, initials } from '../../../components/avatar';
import { ChatMessage } from '../../../lib/types';
import { playSound } from '../../../lib/sounds';
import {
  CustomCards,
  emptyCustomCards,
  loadCustomCards,
  saveCustomCards,
} from '../../../lib/customCards';

interface PageProps {
  params: Promise<{ id: string }>;
}

interface ChatWidgetProps {
  messages: ChatMessage[];
  myPlayerId: number | null;
  onSend: (text: string) => void;
  placement?: 'lobby' | 'game';
}

function ChatIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}

function ChatWidget({ messages, myPlayerId, onSend, placement = 'lobby' }: ChatWidgetProps) {
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const prevCount = useRef(0);

  useEffect(() => {
    const n = messages.length;
    if (n > prevCount.current) {
      const fresh = messages.slice(prevCount.current);
      // Sistema não conta como não-lida nem apita; só gente de verdade.
      const humans = fresh.filter((m) => m.playerId !== -99);
      if (!open) setUnread((u) => u + humans.length);
      if (humans.some((m) => m.playerId !== myPlayerId)) playSound('chat');
    }
    prevCount.current = n;
  }, [messages.length, open, messages, myPlayerId]);

  return (
    <div className={placement === 'game'
      ? 'fixed top-1/2 right-3 -translate-y-1/2 z-40 flex flex-col items-end gap-2'
      : 'fixed bottom-4 right-3 z-40 flex flex-col items-end gap-2'}
    >
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
  const [showPlayers, setShowPlayers] = useState(false);
  const [showDeckEditor, setShowDeckEditor] = useState(false);
  const [customCards, setCustomCards] = useState<CustomCards>(emptyCustomCards);

  useEffect(() => {
    const id = window.setTimeout(() => setCustomCards(loadCustomCards()), 0);
    return () => window.clearTimeout(id);
  }, []);

  const initialIsHost =
    typeof window !== 'undefined' && sessionStorage.getItem('sp-host-room') === roomCode;

  const mp = useMultiplayer(roomCode, nameInput, initialIsHost, customCards);
  // Flag viva: o host pode mudar no meio do jogo se o original sair.
  const isHost = mp.isHost;

  useEffect(() => {
    if (mp.wasKicked) router.push('/');
  }, [mp.wasKicked, router]);

  // Narração da mesa no chat: cada cliente gera as próprias mensagens de
  // sistema a partir das transições de estado — sem broadcast extra.
  const [sysMsgs, setSysMsgs] = useState<ChatMessage[]>([]);
  const prevSnapRef = useRef<{ phase: string; round: number; czarId: number | null }>({
    phase: '', round: 0, czarId: null,
  });
  useEffect(() => {
    const gs = mp.gameState;
    if (!gs) return;
    const prev = prevSnapRef.current;
    const nameOf = (id: number) => gs.players.find((p) => p.id === id)?.name ?? '?';
    const push = (text: string) =>
      setSysMsgs((m) => [...m, { id: `sys-${Date.now()}-${m.length}`, playerId: -99, name: 'mesa', text, ts: Date.now() }]);

    if (gs.phase === 'submitting' && (prev.round !== gs.round || prev.czarId !== gs.czarId)) {
      push(
        (gs.mode ?? 'judge') === 'democracy'
          ? `🗳 urna aberta — todo mundo joga na rodada ${gs.round}`
          : `⚖ ${nameOf(gs.czarId)} assumiu o martelo — rodada ${gs.round}`
      );
    }
    if (
      gs.phase === 'judging' &&
      prev.phase !== 'judging' &&
      (gs.mode ?? 'judge') === 'democracy'
    ) {
      push('🗳 votação secreta aberta — não vale votar na própria');
    }
    if (gs.phase === 'round-end' && prev.phase !== 'round-end' && gs.roundWinnerId !== null) {
      push(`☠ ${nameOf(gs.roundWinnerId)} levou a rodada`);
    }
    if (gs.phase === 'game-end' && prev.phase !== 'game-end' && gs.winner) {
      push(`🏁 ${gs.winner.name} venceu a partida`);
    }
    prevSnapRef.current = { phase: gs.phase, round: gs.round, czarId: gs.czarId };
  }, [mp.gameState]);

  const allMessages = useMemo(
    () => [...mp.chatMessages, ...sysMsgs].sort((a, b) => a.ts - b.ts),
    [mp.chatMessages, sysMsgs]
  );

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
      messages={allMessages}
      myPlayerId={mp.myPlayerId}
      onSend={mp.sendChat}
      placement={mp.gameState ? 'game' : 'lobby'}
    />
  );

  if (mp.gameState) {
    const phaseId = getPhaseId(mp.gameState);
    const activePlayers = mp.lobbyPlayers.filter(p => {
      const gs = mp.gameState!;
      return !gs.players.find(gp => gp.id === p.id)?.eliminated;
    });

    return (
      <>
        <MesaOnline
          state={mp.gameState}
          myId={mp.myPlayerId ?? 0}
          roomSessionId={`room:${roomCode}`}
          onSubmit={(cardIds) => mp.sendAction({
            type: 'submit', cardIds, phaseId,
          })}
          onReveal={(index) => mp.sendAction({
            type: 'reveal', index, phaseId,
          })}
          onJudge={(index) => mp.sendAction({
            type: 'judge', index, phaseId,
          })}
          onVote={(index, phaseStartedAt) => mp.sendAction({
            type: 'vote', index, phaseStartedAt, phaseId,
          })}
          onNextRound={() => mp.sendAction({
            type: 'next_round', phaseId,
          })}
          onRestart={() => { void mp.disconnect().finally(() => router.push('/')); }}
          reactions={mp.reactions}
          messages={allMessages}
          onReact={mp.sendReaction}
          onSendChat={mp.sendChat}
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

        {/* Ações flutuantes: canto inferior esquerdo */}
        <div className="fixed top-1/2 left-3 -translate-y-1/2 z-40 flex flex-col items-start gap-2">
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

          <div className="flex flex-col-reverse sm:flex-row gap-2">
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
                {isHost
                  ? 'A mesa continua: outro jogador assume e seu lugar fica guardado.'
                  : 'A mesa continua no automático e seu lugar fica guardado pra volta.'}
              </span>
              <div className="flex gap-3 w-full">
                <button
                  onClick={() => setConfirmLeave(false)}
                  className="flex-1 h-13 rounded-xl border-2 border-white/40 text-paper font-bold text-[14px] transition-all hover:bg-white/[0.06] active:scale-95"
                >
                  Cancelar
                </button>
                <button
                  onClick={() => { void mp.disconnect().finally(() => router.push('/')); }}
                  className="flex-1 h-13 rounded-xl border-2 border-red text-red font-bold text-[14px] transition-all hover:bg-red/10 active:scale-95"
                >
                  Sair
                </button>
              </div>
            </div>
          </div>
        )}
        {/* A mesa 3D já tem o chat da audiência embutido; sem widget flutuante aqui. */}
      </>
    );
  }

  const roomUrl = typeof window !== 'undefined'
    ? `${window.location.origin}/sala/${roomCode}`
    : '';
  const customCardCount = customCards.black.length + customCards.white.length;

  return (
    <>
      <RitualLobby
        roomCode={roomCode}
        roomUrl={roomUrl}
        players={mp.lobbyPlayers}
        myPlayerId={mp.myPlayerId}
        hostId={mp.hostId}
        isHost={isHost}
        rules={mp.lobbyRules}
        countdownEndsAt={mp.countdownEndsAt}
        maxPlayers={MAX_PLAYERS}
        minPlayers={MIN_PLAYERS}
        customCardCount={customCardCount}
        onAppearanceChange={mp.setAppearance}
        onReadyChange={mp.setReady}
        onRulesChange={mp.updateLobbyRules}
        onAddBot={mp.addBot}
        onRemoveBot={mp.removeBot}
        onKickPlayer={mp.kickPlayer}
        onOpenDeck={() => {
          mp.setReady(false);
          setShowDeckEditor(true);
        }}
        onLeave={() => {
          if (isHost) {
            void mp.disconnect().finally(() => router.push('/'));
          } else {
            mp.leaveLobby();
            router.push('/');
          }
        }}
      />
      <CustomDeckEditor
        open={showDeckEditor && isHost}
        cards={customCards}
        onChange={(next) => setCustomCards(saveCustomCards(next))}
        onClose={() => setShowDeckEditor(false)}
      />
      {chatWidget}
    </>
  );
}
