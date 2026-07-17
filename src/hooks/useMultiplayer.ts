'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ChatMessage, GameState, PlayerAction } from '../lib/types';
import { supabase } from '../lib/supabase';
import {
  advanceToNextRound,
  applyJudgePick,
  applySubmission,
  getActivePlayers,
  initGame,
  JUDGE_SECONDS,
  MIN_PLAYERS,
  pendingSubmitters,
  removePlayer,
  Seat,
  seatNewcomers,
  shuffle,
  SUBMIT_SECONDS,
} from '../lib/game';
import { ALL_BLACK, ALL_WHITE } from '../lib/cards';
import { BOT_NAMES, getBotJudgeIndex, getBotSubmission } from '../lib/ai';

export type MultiplayerRole = 'host' | 'guest' | 'connecting';

export interface LobbyPlayer {
  id: number;
  name: string;
  isBot?: boolean;
}

export interface DisconnectedPlayer {
  id: number;
  name: string;
}

/** Alguém batendo na porta de um jogo em andamento, esperando o host. */
export interface PendingJoin {
  clientId: string;
  name: string;
}

interface UseMultiplayerReturn {
  role: MultiplayerRole;
  myPlayerId: number | null;
  lobbyPlayers: LobbyPlayer[];
  gameState: GameState | null;
  isConnected: boolean;
  error: string | null;
  wasKicked: boolean;
  disconnectedPlayer: DisconnectedPlayer | null;
  chatMessages: ChatMessage[];
  pendingJoins: PendingJoin[];
  awaitingApproval: boolean;
  joinRejected: boolean;
  seatedNextRound: boolean;
  isHost: boolean;
  hostId: number;
  becameHost: boolean;
  sendAction: (action: PlayerAction) => void;
  sendChat: (text: string) => void;
  startGame: (scoreLimit: number) => void;
  addBot: () => void;
  removeBot: (botId: number) => void;
  removeDisconnectedPlayer: () => void;
  kickPlayer: (playerId: number) => void;
  approveJoin: (clientId: string) => void;
  rejectJoin: (clientId: string) => void;
  leaveLobby: () => void;
  disconnect: () => void;
}

const MAX_RECONNECT_ATTEMPTS = 10;
// Presença oscila em conexão móvel ruim; só pausa o jogo se o jogador ficar
// fora por este tempo.
const DISCONNECT_GRACE_MS = 5000;
// Ids de bot ficam bem acima dos de humanos para nunca colidirem.
const BOT_ID_BASE = 100;

/**
 * O host guarda o estado completo; cada convidado só recebe o que pode ver:
 * a própria mão, nunca as pilhas de compra, e as jogadas da rodada de acordo
 * com a fase — durante as jogadas só o "quem já jogou" (cartas ocultas),
 * durante o julgamento as cartas anônimas (dono = -1), e na virada da rodada
 * tudo aberto.
 */
function redactStateFor(gs: GameState, targetId: number): GameState {
  return {
    ...gs,
    blackDeck: [],
    whiteDeck: [],
    players: gs.players.map((p) =>
      p.id === targetId ? p : { ...p, hand: [] }
    ),
    submissions: gs.submissions.map((s) => {
      if (gs.phase === 'submitting') {
        return { playerId: s.playerId, cards: [] };
      }
      if (gs.phase === 'judging') {
        return { playerId: -1, cards: s.cards };
      }
      return s;
    }),
  };
}

export function useMultiplayer(
  roomCode: string,
  playerName: string | null,
  initialIsHost: boolean
): UseMultiplayerReturn {
  // Quem comanda a mesa pode mudar no meio do jogo: se o host sair, o próximo
  // pela ordem de entrada assume. Handlers leem refs para a promoção não
  // precisar derrubar e reerguer o canal.
  const [isHost, setIsHost] = useState(initialIsHost);
  const isHostRef = useRef(initialIsHost);
  const [hostId, setHostId] = useState(0);
  const hostIdRef = useRef(0);
  const [becameHost, setBecameHost] = useState(false);
  useEffect(() => { isHostRef.current = isHost; }, [isHost]);
  useEffect(() => { hostIdRef.current = hostId; }, [hostId]);

  const pidKey = `sp-pid-${roomCode}`;
  const hostStateKey = `sp-host-state-${roomCode}`;
  const hostLobbyKey = `sp-host-lobby-${roomCode}`;

  // Convidados lembram o assento entre reloads: F5 volta pro mesmo jogo.
  const [myPlayerId, setMyPlayerId] = useState<number | null>(() => {
    if (isHost) return 0;
    if (typeof window !== 'undefined') {
      const saved = sessionStorage.getItem(pidKey);
      if (saved !== null && !Number.isNaN(Number(saved))) return Number(saved);
    }
    return null;
  });

  // O host restaura um jogo em andamento após reload, pra um F5 não matar a
  // mesa de todo mundo.
  const [restoredHost] = useState(() => {
    const empty = { game: null as GameState | null, lobby: null as LobbyPlayer[] | null, nextPlayerId: 1 };
    if (!isHost || typeof window === 'undefined') return empty;
    try {
      const savedGame = sessionStorage.getItem(hostStateKey);
      const savedLobby = sessionStorage.getItem(hostLobbyKey);
      const meta = savedLobby
        ? (JSON.parse(savedLobby) as { lobby: LobbyPlayer[]; nextPlayerId: number })
        : null;
      return {
        game: savedGame ? (JSON.parse(savedGame) as GameState) : null,
        lobby: meta?.lobby ?? null,
        nextPlayerId: meta?.nextPlayerId ?? 1,
      };
    } catch {
      return empty;
    }
  });

  const [lobbyPlayers, setLobbyPlayers] = useState<LobbyPlayer[]>(
    restoredHost.lobby ?? (isHost && playerName ? [{ id: 0, name: playerName }] : [])
  );
  const [gameState, setGameState] = useState<GameState | null>(restoredHost.game);
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [wasKicked, setWasKicked] = useState(false);
  const [disconnectedPlayer, setDisconnectedPlayer] = useState<DisconnectedPlayer | null>(null);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [pendingJoins, setPendingJoins] = useState<PendingJoin[]>([]);
  const [awaitingApproval, setAwaitingApproval] = useState(false);
  const [joinRejected, setJoinRejected] = useState(false);

  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const hostGameRef = useRef<GameState | null>(restoredHost.game);
  const nextPlayerIdRef = useRef(restoredHost.nextPlayerId);
  const [clientId] = useState(() => Math.random().toString(36).slice(2));
  const clientIdRef = useRef(clientId);
  const pendingNextRoundRef = useRef<Set<number>>(new Set());
  const lobbyPlayersRef = useRef<LobbyPlayer[]>(lobbyPlayers);
  const myPlayerIdRef = useRef<number | null>(myPlayerId);
  const disconnectedPlayerRef = useRef<DisconnectedPlayer | null>(null);
  const isConnectedRef = useRef(false);

  // clientId → playerId: retries de `join` não criam jogador duplicado.
  const clientPlayerMapRef = useRef<Map<string, number>>(new Map());
  // Sequência do lobby: broadcast atrasado não sobrescreve estado mais novo.
  const lobbySeqRef = useRef(0);
  const lastLobbySeqRef = useRef(0);

  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Relógios do host: bots + limite de tempo dos humanos.
  const botTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const scheduleBotRef = useRef<(gs: GameState) => void>(() => {});
  const disconnectTimersRef = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());
  const pendingJoinsRef = useRef<PendingJoin[]>([]);
  const pendingSeatsRef = useRef<{ id: number; name: string }[]>([]);
  const awaitingApprovalRef = useRef(false);
  const gameStateRef = useRef<GameState | null>(restoredHost.game);
  const maybePromoteSelfRef = useRef<(goneHostId: number) => void>(() => {});
  const promotionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => { gameStateRef.current = gameState; }, [gameState]);
  useEffect(() => { pendingJoinsRef.current = pendingJoins; }, [pendingJoins]);
  useEffect(() => { awaitingApprovalRef.current = awaitingApproval; }, [awaitingApproval]);
  useEffect(() => { lobbyPlayersRef.current = lobbyPlayers; }, [lobbyPlayers]);
  useEffect(() => { myPlayerIdRef.current = myPlayerId; }, [myPlayerId]);
  useEffect(() => { disconnectedPlayerRef.current = disconnectedPlayer; }, [disconnectedPlayer]);
  useEffect(() => { isConnectedRef.current = isConnected; }, [isConnected]);

  const send = useCallback((event: string, payload: Record<string, unknown>) => {
    channelRef.current?.send({ type: 'broadcast', event, payload });
  }, []);

  // Host → convidados: uma cópia redigida do estado por convidado humano.
  const broadcastState = useCallback((gs: GameState) => {
    for (const lp of lobbyPlayersRef.current) {
      if (lp.id === hostIdRef.current || lp.isBot) continue;
      send('game_state', { state: redactStateFor(gs, lp.id), target: lp.id });
    }
  }, [send]);

  const broadcastLobby = useCallback((players: LobbyPlayer[]) => {
    send('lobby', { players, seq: lobbySeqRef.current });
  }, [send]);

  const persistHostLobby = useCallback(() => {
    try {
      sessionStorage.setItem(hostLobbyKey, JSON.stringify({
        lobby: lobbyPlayersRef.current,
        nextPlayerId: nextPlayerIdRef.current,
      }));
    } catch { /* storage cheio/indisponível — persistência é melhor esforço */ }
  }, [hostLobbyKey]);

  // Novo estado autoritativo no host: guarda, renderiza, transmite, persiste
  // e agenda os relógios (bots + timeouts).
  const commitHostState = useCallback((gs: GameState) => {
    hostGameRef.current = gs;
    setGameState(gs);
    broadcastState(gs);
    try {
      if (gs.phase === 'game-end') {
        sessionStorage.removeItem(hostStateKey);
      } else {
        sessionStorage.setItem(hostStateKey, JSON.stringify(gs));
      }
    } catch { /* melhor esforço */ }
    scheduleBotRef.current(gs);
  }, [broadcastState, hostStateKey]);

  const clearDisconnected = useCallback((playerId?: number) => {
    const dp = disconnectedPlayerRef.current;
    if (dp && (playerId === undefined || dp.id === playerId)) {
      disconnectedPlayerRef.current = null;
      setDisconnectedPlayer(null);
      if (isHost) send('player_reconnected', { playerId: dp.id });
    }
  }, [isHost, send]);

  const cancelDisconnectTimer = useCallback((playerId: number) => {
    const t = disconnectTimersRef.current.get(playerId);
    if (t) {
      clearTimeout(t);
      disconnectTimersRef.current.delete(playerId);
    }
  }, []);

  const applyHostAction = useCallback((action: PlayerAction, fromPlayerId: number) => {
    let gs = hostGameRef.current;
    if (!gs) return;

    if (action.type === 'submit') {
      if (gs.phase !== 'submitting') return;
      gs = applySubmission(gs, fromPlayerId, action.cardIds);
    } else if (action.type === 'judge') {
      if (gs.phase !== 'judging' || gs.czarId !== fromPlayerId) return;
      if (!Number.isInteger(action.index)) return;
      gs = applyJudgePick(gs, action.index);
    } else if (action.type === 'next_round') {
      pendingNextRoundRef.current.add(fromPlayerId);
      const activeHumans = getActivePlayers(gs.players).filter((p) => p.isHuman);
      if (pendingNextRoundRef.current.size >= activeHumans.length) {
        pendingNextRoundRef.current.clear();
        // Aprovados no meio do jogo só sentam aqui, entre rodadas.
        if (pendingSeatsRef.current.length) {
          gs = seatNewcomers(gs, pendingSeatsRef.current);
          pendingSeatsRef.current = [];
        }
        gs = advanceToNextRound(gs);
      } else {
        return;
      }
    }

    commitHostState(gs);
  }, [commitHostState]);

  const clearBotTimers = useCallback(() => {
    for (const t of botTimersRef.current) clearTimeout(t);
    botTimersRef.current = [];
  }, []);

  /**
   * Relógio do host por fase:
   * - jogadas: bots jogam escalonados; quem for humano e passar do tempo tem
   *   cartas aleatórias jogadas pela mesa (AFK nunca trava a rodada);
   * - julgamento: juiz-bot decide rápido; juiz humano AFK decide no timeout;
   * - fim de rodada: avança sozinho depois de um respiro, sem esperar todos.
   */
  const scheduleBot = useCallback((gs: GameState) => {
    if (!isHostRef.current) return;
    clearBotTimers();

    if (gs.phase === 'submitting') {
      const bots = pendingSubmitters(gs).filter((p) => !p.isHuman);
      bots.forEach((bot, i) => {
        botTimersRef.current.push(setTimeout(() => {
          const cur = hostGameRef.current;
          if (!cur || cur.phase !== 'submitting' || !cur.blackCard) return;
          const b = cur.players.find((p) => p.id === bot.id);
          if (!b || cur.submissions.some((s) => s.playerId === b.id)) return;
          applyHostAction({ type: 'submit', cardIds: getBotSubmission(b.hand, cur.blackCard.pick) }, b.id);
        }, 1200 + i * 900 + Math.random() * 800));
      });

      // Estouro do relógio: a mesa joga pelos humanos que ficaram parados.
      botTimersRef.current.push(setTimeout(() => {
        const cur = hostGameRef.current;
        if (!cur || cur.phase !== 'submitting' || !cur.blackCard) return;
        for (const p of pendingSubmitters(cur)) {
          const now = hostGameRef.current;
          if (!now || now.phase !== 'submitting' || !now.blackCard) return;
          applyHostAction({ type: 'submit', cardIds: getBotSubmission(p.hand, now.blackCard.pick) }, p.id);
        }
      }, SUBMIT_SECONDS * 1000));
    } else if (gs.phase === 'judging') {
      const czar = gs.players.find((p) => p.id === gs.czarId);
      if (!czar || czar.eliminated) return;
      const delay = czar.isHuman ? JUDGE_SECONDS * 1000 : 2500;
      botTimersRef.current.push(setTimeout(() => {
        const cur = hostGameRef.current;
        if (!cur || cur.phase !== 'judging' || cur.czarId !== czar.id) return;
        applyHostAction({ type: 'judge', index: getBotJudgeIndex(cur.submissions.length) }, czar.id);
      }, delay));
    } else if (gs.phase === 'round-end') {
      // Ninguém precisa apertar nada: a rodada vira sozinha.
      botTimersRef.current.push(setTimeout(() => {
        const cur = hostGameRef.current;
        if (!cur || cur.phase !== 'round-end') return;
        pendingNextRoundRef.current.clear();
        let next = cur;
        if (pendingSeatsRef.current.length) {
          next = seatNewcomers(next, pendingSeatsRef.current);
          pendingSeatsRef.current = [];
        }
        commitHostState(advanceToNextRound(next));
      }, 9000));
    }
  }, [applyHostAction, clearBotTimers, commitHostState]);

  useEffect(() => { scheduleBotRef.current = scheduleBot; }, [scheduleBot]);

  /**
   * O host saiu. Entre os presentes, quem entrou primeiro assume a mesa.
   *
   * Um convidado só conhece o próprio estado redigido — nunca viu as mãos dos
   * outros nem as pilhas. A rodada em andamento é redistribuída do zero:
   * baralhos novos, mãos novas, mesma pontuação, mesmo round, próximo juiz.
   * É o preço de nunca enviar a mão de ninguém para outro cliente.
   */
  const maybePromoteSelf = useCallback((goneHostId: number) => {
    if (isHostRef.current) return;
    const myId = myPlayerIdRef.current;
    if (myId === null) return;

    const present = new Set<number>();
    const presence = channelRef.current?.presenceState() ?? {};
    for (const metas of Object.values(presence)) {
      for (const m of metas as unknown as { playerId?: number }[]) {
        if (typeof m.playerId === 'number') present.add(m.playerId);
      }
    }
    present.delete(goneHostId);
    if (!present.size) return;

    const successor = Math.min(...present);
    if (successor !== myId) return;

    isHostRef.current = true;
    setIsHost(true);
    setBecameHost(true);
    hostIdRef.current = myId;
    setHostId(myId);
    try { sessionStorage.setItem('sp-host-room', roomCode); } catch { /* melhor esforço */ }

    // Bots viviam no host antigo; sem o estado deles, saem junto.
    const lobby = lobbyPlayersRef.current.filter((lp) => lp.id !== goneHostId && !lp.isBot);
    lobbyPlayersRef.current = lobby;
    setLobbyPlayers(lobby);
    nextPlayerIdRef.current = Math.max(nextPlayerIdRef.current, ...lobby.map((l) => l.id + 1), 1);

    send('host_changed', { hostId: myId, name: playerName });

    const gs = gameStateRef.current;
    if (gs && gs.phase !== 'game-end' && gs.phase !== 'setup') {
      const players = gs.players
        .filter((p) => p.isHuman)
        .map((p) => (p.id === goneHostId ? { ...p, eliminated: true, hand: [] } : { ...p, hand: [] }));
      const remaining = getActivePlayers(players);
      if (remaining.length < MIN_PLAYERS) {
        const winner = [...remaining].sort((a, b) => b.score - a.score)[0] ?? null;
        commitHostState({ ...gs, players, phase: 'game-end', winner, submissions: [], blackDeck: [], whiteDeck: [] });
      } else {
        // Redistribui a rodada atual com baralhos novos.
        const czarId = remaining.some((p) => p.id === gs.czarId)
          ? gs.czarId
          : remaining[0].id;
        const redealt: GameState = {
          ...gs,
          players,
          czarId,
          submissions: [],
          roundWinnerId: null,
          winner: null,
          phase: 'submitting',
          blackDeck: shuffle(ALL_BLACK),
          whiteDeck: shuffle(ALL_WHITE),
        };
        // Reaproveita init parcial: repõe mãos e tira carta preta nova.
        const withHands = advanceToNextRound({ ...redealt, round: redealt.round - 1, czarId });
        commitHostState({ ...withHands, czarId });
      }
    }
    broadcastLobby(lobby);
    persistHostLobby();
  }, [roomCode, playerName, send, broadcastLobby, commitHostState, persistHostLobby]);

  useEffect(() => { maybePromoteSelfRef.current = maybePromoteSelf; }, [maybePromoteSelf]);

  useEffect(() => {
    if (!playerName) return;

    let disposed = false;
    let reconnectAttempts = 0;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let retryInterval: ReturnType<typeof setInterval> | null = null;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const clearJoinTimers = () => {
      if (retryInterval) { clearInterval(retryInterval); retryInterval = null; }
      if (timeoutId) { clearTimeout(timeoutId); timeoutId = null; }
    };

    // Monta um canal novo com todos os handlers. Chamado no mount e a cada
    // reconexão — canal do Supabase não é reutilizável depois de erro.
    const connect = () => {
      if (disposed) return;

      const channel = supabase.channel(`sp-${roomCode}`);
      channelRef.current = channel;

      channel
        // ── Mensagens de jogo ───────────────────────────────────────────
        .on('broadcast', { event: 'join' }, ({ payload }) => {
          if (!isHostRef.current) return;
          const { clientId: joinerId, name } = payload as { clientId: string; name: string };

          // clientId repetido → só reenvia welcome + estado.
          if (clientPlayerMapRef.current.has(joinerId)) {
            const existingId = clientPlayerMapRef.current.get(joinerId)!;
            send('welcome', { clientId: joinerId, playerId: existingId });
            broadcastLobby(lobbyPlayersRef.current);
            if (hostGameRef.current) broadcastState(hostGameRef.current);
            return;
          }

          const gs = hostGameRef.current;
          const gameOn = !!gs && gs.phase !== 'setup' && gs.phase !== 'game-end';

          // Reconexão de sessão nova (outra aba, celular que morreu): o mesmo
          // nome ainda é dono do assento — devolve em vez de criar jogador.
          const seat = gs?.players.find((p) => p.name === name && !p.eliminated && p.isHuman);
          if (gameOn && seat) {
            clientPlayerMapRef.current.set(joinerId, seat.id);
            cancelDisconnectTimer(seat.id);
            clearDisconnected(seat.id);
            if (!lobbyPlayersRef.current.some((lp) => lp.id === seat.id)) {
              const back = [...lobbyPlayersRef.current, { id: seat.id, name }].sort((a, b) => a.id - b.id);
              lobbyPlayersRef.current = back;
              setLobbyPlayers(back);
              lobbySeqRef.current++;
              broadcastLobby(back);
              persistHostLobby();
            }
            send('welcome', { clientId: joinerId, playerId: seat.id });
            broadcastState(gs!);
            return;
          }

          const dp = disconnectedPlayerRef.current;
          if (dp && dp.name === name) {
            cancelDisconnectTimer(dp.id);
            clearDisconnected(dp.id);
            clientPlayerMapRef.current.set(joinerId, dp.id);
            send('welcome', { clientId: joinerId, playerId: dp.id });
            if (hostGameRef.current) broadcastState(hostGameRef.current);
            return;
          }

          // Cara nova com jogo rolando — o host decide, e só senta na próxima
          // rodada.
          if (gameOn) {
            setPendingJoins((prev) =>
              prev.some((p) => p.clientId === joinerId) ? prev : [...prev, { clientId: joinerId, name }]
            );
            send('join_pending', { clientId: joinerId });
            return;
          }

          // Lobby — qualquer um senta.
          const playerId = nextPlayerIdRef.current++;
          const updated = [...lobbyPlayersRef.current, { id: playerId, name }];
          lobbyPlayersRef.current = updated;
          setLobbyPlayers(updated);
          lobbySeqRef.current++;
          broadcastLobby(updated);
          persistHostLobby();

          clientPlayerMapRef.current.set(joinerId, playerId);
          send('welcome', { clientId: joinerId, playerId });
          if (hostGameRef.current) broadcastState(hostGameRef.current);
        })
        .on('broadcast', { event: 'join_pending' }, ({ payload }) => {
          if (isHostRef.current) return;
          if ((payload as { clientId: string }).clientId === clientIdRef.current) {
            setAwaitingApproval(true);
          }
        })
        .on('broadcast', { event: 'join_rejected' }, ({ payload }) => {
          if (isHostRef.current) return;
          if ((payload as { clientId: string }).clientId === clientIdRef.current) {
            setAwaitingApproval(false);
            setJoinRejected(true);
          }
        })
        .on('broadcast', { event: 'welcome' }, ({ payload }) => {
          if (isHostRef.current) return;
          const { clientId: targetClient, playerId } = payload as { clientId: string; playerId: number };
          if (targetClient === clientIdRef.current) {
            myPlayerIdRef.current = playerId;
            setMyPlayerId(playerId);
            setAwaitingApproval(false);
            setJoinRejected(false);
            try { sessionStorage.setItem(pidKey, String(playerId)); } catch { /* melhor esforço */ }
            clearJoinTimers();
            channel.track({ playerId, name: playerName });
          }
        })
        .on('broadcast', { event: 'lobby' }, ({ payload }) => {
          if (isHostRef.current) return;
          const { players, seq } = payload as { players: LobbyPlayer[]; seq?: number };
          if (seq !== undefined && seq <= lastLobbySeqRef.current) return;
          if (seq !== undefined) lastLobbySeqRef.current = seq;
          setLobbyPlayers(players);
        })
        .on('broadcast', { event: 'game_state' }, ({ payload }) => {
          if (isHostRef.current) return;
          const { state, target } = payload as { state: GameState; target?: number };
          if (target !== undefined && target !== myPlayerIdRef.current) return;
          setGameState(state);
        })
        .on('broadcast', { event: 'action' }, ({ payload }) => {
          if (!isHostRef.current) return;
          const { action, fromPlayerId } = payload as { action: PlayerAction; fromPlayerId: number };
          applyHostAction(action, fromPlayerId);
        })
        // Convidado pede o estado após reconectar — também prova de vida.
        .on('broadcast', { event: 'request_state' }, ({ payload }) => {
          if (!isHostRef.current) return;
          const { playerId } = (payload ?? {}) as { playerId?: number };
          if (playerId !== undefined) {
            cancelDisconnectTimer(playerId);
            clearDisconnected(playerId);
          }
          if (hostGameRef.current) broadcastState(hostGameRef.current);
          broadcastLobby(lobbyPlayersRef.current);
        })
        // ── Chat ────────────────────────────────────────────────────────
        .on('broadcast', { event: 'chat' }, ({ payload }) => {
          setChatMessages((prev) => [...prev, payload as ChatMessage]);
        })
        // ── Kick / saída voluntária ─────────────────────────────────────
        .on('broadcast', { event: 'kicked' }, ({ payload }) => {
          if (isHostRef.current) return;
          const { targetId } = payload as { targetId: number };
          if (targetId === myPlayerIdRef.current) setWasKicked(true);
        })
        .on('broadcast', { event: 'leave_lobby' }, ({ payload }) => {
          if (!isHostRef.current) return;
          const { playerId } = payload as { playerId: number };
          const updated = lobbyPlayersRef.current.filter((p) => p.id !== playerId);
          if (updated.length === lobbyPlayersRef.current.length) return;
          lobbyPlayersRef.current = updated;
          setLobbyPlayers(updated);
          lobbySeqRef.current++;
          broadcastLobby(updated);
          persistHostLobby();
        })
        // ── Quedas (broadcast pra todo mundo ver a pausa) ───────────────
        .on('broadcast', { event: 'player_disconnected' }, ({ payload }) => {
          if (isHostRef.current) return;
          const { playerId, name } = payload as { playerId: number; name: string };
          setDisconnectedPlayer({ id: playerId, name });
        })
        .on('broadcast', { event: 'player_reconnected' }, () => {
          if (isHostRef.current) return;
          setDisconnectedPlayer(null);
        })
        // ── Presença: detecta quedas inesperadas ────────────────────────
        .on('presence', { event: 'leave' }, ({ leftPresences }) => {
          for (const p of leftPresences) {
            const { playerId, name } = p as unknown as { playerId: number; name: string };

            // Convidados vigiam o host: se a mesa perde o dono, o próximo da
            // fila assume em vez de todo mundo encarar um tabuleiro congelado.
            if (!isHostRef.current) {
              if (playerId === hostIdRef.current) {
                cancelDisconnectTimer(playerId);
                const t = setTimeout(() => {
                  disconnectTimersRef.current.delete(playerId);
                  setDisconnectedPlayer({ id: playerId, name: name ?? 'Host' });
                  maybePromoteSelfRef.current(playerId);
                }, DISCONNECT_GRACE_MS);
                disconnectTimersRef.current.set(playerId, t);
              }
              continue;
            }

            if (playerId === hostIdRef.current) continue;

            const gs = hostGameRef.current;
            // Sem jogo → saiu do lobby; libera o assento.
            if (!gs || gs.phase === 'setup') {
              const updated = lobbyPlayersRef.current.filter((lp) => lp.id !== playerId);
              if (updated.length !== lobbyPlayersRef.current.length) {
                lobbyPlayersRef.current = updated;
                setLobbyPlayers(updated);
                lobbySeqRef.current++;
                broadcastLobby(updated);
                persistHostLobby();
              }
              continue;
            }
            if (gs.phase === 'game-end') continue;

            const player = gs.players.find(pl => pl.id === playerId && !pl.eliminated);
            if (!player) continue;

            // Período de graça: conexão instável volta logo — não pausa a
            // mesa por um soluço.
            cancelDisconnectTimer(playerId);
            const timer = setTimeout(() => {
              disconnectTimersRef.current.delete(playerId);
              const dp = { id: playerId, name: player.name ?? name };
              disconnectedPlayerRef.current = dp;
              setDisconnectedPlayer(dp);
              send('player_disconnected', dp);
            }, DISCONNECT_GRACE_MS);
            disconnectTimersRef.current.set(playerId, timer);
          }
        })
        .on('presence', { event: 'join' }, ({ newPresences }) => {
          for (const p of newPresences) {
            const { playerId } = p as unknown as { playerId: number };
            if (playerId === undefined) continue;
            cancelDisconnectTimer(playerId);
            if (
              !isHostRef.current &&
              playerId === hostIdRef.current &&
              disconnectedPlayerRef.current?.id === hostIdRef.current
            ) {
              setDisconnectedPlayer(null);
              send('request_state', { playerId: myPlayerIdRef.current });
            }
            if (isHostRef.current) clearDisconnected(playerId);
          }
        })
        // Novo host se anunciou — todo mundo segue, e o antigo (se voltar)
        // para de achar que ainda manda na mesa.
        .on('broadcast', { event: 'host_changed' }, ({ payload }) => {
          const { hostId: newHostId } = payload as { hostId: number };
          if (promotionTimerRef.current) clearTimeout(promotionTimerRef.current);
          hostIdRef.current = newHostId;
          setHostId(newHostId);
          cancelDisconnectTimer(newHostId);
          setDisconnectedPlayer(null);
          disconnectedPlayerRef.current = null;
          if (newHostId !== myPlayerIdRef.current && isHostRef.current) {
            isHostRef.current = false;
            setIsHost(false);
            try { sessionStorage.removeItem('sp-host-room'); } catch { /* melhor esforço */ }
          }
        })
        .subscribe((status) => {
          if (status === 'SUBSCRIBED') {
            reconnectAttempts = 0;
            setIsConnected(true);
            setError(null);

            if (isHost) {
              channel.track({ playerId: 0, name: playerName });
              if (hostGameRef.current) {
                broadcastState(hostGameRef.current);
                scheduleBotRef.current(hostGameRef.current);
              }
              broadcastLobby(lobbyPlayersRef.current);

              // Heartbeat mantém o canal vivo e recupera convidados que
              // reconectam sem precisar de re-join.
              if (heartbeatRef.current) clearInterval(heartbeatRef.current);
              heartbeatRef.current = setInterval(() => {
                if (hostGameRef.current) broadcastState(hostGameRef.current);
                else broadcastLobby(lobbyPlayersRef.current);
              }, 12000);
            } else {
              if (myPlayerIdRef.current !== null) {
                channel.track({ playerId: myPlayerIdRef.current, name: playerName });
                send('request_state', { playerId: myPlayerIdRef.current });
                return;
              }

              const sendJoin = () => {
                if (myPlayerIdRef.current !== null) return;
                send('join', { clientId: clientIdRef.current, name: playerName });
              };
              sendJoin();
              if (retryInterval) clearInterval(retryInterval);
              retryInterval = setInterval(sendJoin, 2000);
              if (timeoutId) clearTimeout(timeoutId);
              timeoutId = setTimeout(() => {
                if (retryInterval) clearInterval(retryInterval);
                // Esperar o host liberar a entrada não é falha de conexão.
                if (myPlayerIdRef.current === null && !awaitingApprovalRef.current) {
                  setError('Não deu pra entrar na sala. Confira o código e se o host está online.');
                }
              }, 30000);
            }
          } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
            // Não desiste: derruba o canal e reconstrói com backoff. Browser
            // mobile mata o socket sempre que a aba vai pro fundo.
            setIsConnected(false);
            if (disposed) return;

            reconnectAttempts++;
            if (reconnectAttempts > MAX_RECONNECT_ATTEMPTS) {
              setError('Sem conexão com a sala. Confira sua internet e recarregue a página.');
              return;
            }

            clearJoinTimers();
            if (heartbeatRef.current) { clearInterval(heartbeatRef.current); heartbeatRef.current = null; }
            supabase.removeChannel(channel);
            if (channelRef.current === channel) channelRef.current = null;

            const delay = Math.min(1000 * 2 ** (reconnectAttempts - 1), 10000);
            if (reconnectTimer) clearTimeout(reconnectTimer);
            reconnectTimer = setTimeout(() => { reconnectTimer = null; connect(); }, delay);
          }
        });
    };

    connect();

    // Reconecta na hora quando a aba volta pro primeiro plano.
    const onVisible = () => {
      if (document.visibilityState !== 'visible' || disposed) return;
      if (!isConnectedRef.current && !reconnectTimer) {
        reconnectAttempts = 0;
        if (channelRef.current) supabase.removeChannel(channelRef.current);
        channelRef.current = null;
        connect();
      }
    };
    document.addEventListener('visibilitychange', onVisible);

    const timersAtSetup = disconnectTimersRef.current;
    return () => {
      disposed = true;
      document.removeEventListener('visibilitychange', onVisible);
      clearJoinTimers();
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (heartbeatRef.current) { clearInterval(heartbeatRef.current); heartbeatRef.current = null; }
      for (const t of botTimersRef.current) clearTimeout(t);
      botTimersRef.current = [];
      for (const t of timersAtSetup.values()) clearTimeout(t);
      timersAtSetup.clear();
      if (channelRef.current) supabase.removeChannel(channelRef.current);
      channelRef.current = null;
    };
    // `isHost` fica de fora de propósito: handlers leem isHostRef, então a
    // promoção no meio do jogo muda o comportamento sem derrubar o canal
    // (o que perderia presença e o broadcast da promoção).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    roomCode, playerName, pidKey, send, broadcastState, broadcastLobby,
    applyHostAction, cancelDisconnectTimer, clearDisconnected, persistHostLobby,
  ]);

  const sendChat = useCallback((text: string) => {
    const msg: ChatMessage = {
      id: clientIdRef.current + Date.now(),
      playerId: myPlayerIdRef.current ?? 0,
      name: playerName ?? '?',
      text,
      ts: Date.now(),
    };
    setChatMessages((prev) => [...prev, msg]);
    send('chat', msg as unknown as Record<string, unknown>);
  }, [playerName, send]);

  const sendAction = useCallback((action: PlayerAction) => {
    if (isHost) {
      applyHostAction(action, myPlayerIdRef.current ?? 0);
    } else {
      send('action', { action, fromPlayerId: myPlayerIdRef.current ?? 0 });
    }
  }, [isHost, applyHostAction, send]);

  // Bots existem só no lobby do host; entram no jogo como assentos normais.
  const addBot = useCallback(() => {
    if (!isHost) return;
    const bots = lobbyPlayersRef.current.filter((p) => p.isBot);
    if (bots.length >= BOT_NAMES.length) return;
    const name = BOT_NAMES.find(
      (n) => !lobbyPlayersRef.current.some((p) => p.name === n)
    ) ?? `Bot ${bots.length + 1}`;
    const id = BOT_ID_BASE + bots.length;
    const updated = [...lobbyPlayersRef.current, { id, name, isBot: true }];
    lobbyPlayersRef.current = updated;
    setLobbyPlayers(updated);
    lobbySeqRef.current++;
    broadcastLobby(updated);
    persistHostLobby();
  }, [isHost, broadcastLobby, persistHostLobby]);

  const removeBot = useCallback((botId: number) => {
    if (!isHost) return;
    const updated = lobbyPlayersRef.current.filter((p) => p.id !== botId);
    lobbyPlayersRef.current = updated;
    setLobbyPlayers(updated);
    lobbySeqRef.current++;
    broadcastLobby(updated);
    persistHostLobby();
  }, [isHost, broadcastLobby, persistHostLobby]);

  const startGame = useCallback((scoreLimit: number) => {
    if (!isHost) return;
    const lobby = lobbyPlayersRef.current;
    if (lobby.length < MIN_PLAYERS) return;

    const seats: Seat[] = lobby.map((lp) => ({
      id: lp.id,
      name: lp.name,
      isHuman: !lp.isBot,
    }));
    persistHostLobby();
    commitHostState(initGame(seats, scoreLimit));
  }, [isHost, commitHostState, persistHostLobby]);

  const removeDisconnectedPlayer = useCallback(() => {
    if (!isHost) return;
    const dp = disconnectedPlayerRef.current;
    if (!dp) return;
    const gs = hostGameRef.current;
    if (!gs) return;

    commitHostState(removePlayer(gs, dp.id));

    disconnectedPlayerRef.current = null;
    setDisconnectedPlayer(null);
    send('player_reconnected', {});
  }, [isHost, commitHostState, send]);

  // Host remove alguém de propósito (lobby ou meio do jogo).
  const kickPlayer = useCallback((playerId: number) => {
    if (!isHost || playerId === hostIdRef.current) return;
    send('kicked', { targetId: playerId });
    cancelDisconnectTimer(playerId);

    const updatedLobby = lobbyPlayersRef.current.filter((p) => p.id !== playerId);
    lobbyPlayersRef.current = updatedLobby;
    setLobbyPlayers(updatedLobby);
    lobbySeqRef.current++;
    broadcastLobby(updatedLobby);
    persistHostLobby();

    const gs = hostGameRef.current;
    if (!gs) return;
    commitHostState(removePlayer(gs, playerId));
  }, [isHost, broadcastLobby, commitHostState, persistHostLobby, cancelDisconnectTimer, send]);

  // Host libera quem chegou no meio do jogo. Ganha assento e mão na próxima
  // rodada.
  const approveJoin = useCallback((joinerClientId: string) => {
    if (!isHost) return;
    const pending = pendingJoinsRef.current.find((p) => p.clientId === joinerClientId);
    if (!pending) return;

    const playerId = nextPlayerIdRef.current++;
    clientPlayerMapRef.current.set(joinerClientId, playerId);

    const updated = [...lobbyPlayersRef.current, { id: playerId, name: pending.name }];
    lobbyPlayersRef.current = updated;
    setLobbyPlayers(updated);
    lobbySeqRef.current++;
    broadcastLobby(updated);
    persistHostLobby();

    pendingSeatsRef.current = [...pendingSeatsRef.current, { id: playerId, name: pending.name }];
    setPendingJoins((prev) => prev.filter((p) => p.clientId !== joinerClientId));

    send('welcome', { clientId: joinerClientId, playerId });
    if (hostGameRef.current) broadcastState(hostGameRef.current);
  }, [isHost, broadcastLobby, broadcastState, persistHostLobby, send]);

  const rejectJoin = useCallback((joinerClientId: string) => {
    if (!isHost) return;
    send('join_rejected', { clientId: joinerClientId });
    setPendingJoins((prev) => prev.filter((p) => p.clientId !== joinerClientId));
  }, [isHost, send]);

  const leaveLobby = useCallback(() => {
    if (myPlayerIdRef.current !== null) {
      send('leave_lobby', { playerId: myPlayerIdRef.current });
    }
    if (channelRef.current) supabase.removeChannel(channelRef.current);
  }, [send]);

  const disconnect = useCallback(() => {
    if (channelRef.current) supabase.removeChannel(channelRef.current);
  }, []);

  return {
    role: isHost ? 'host' : (myPlayerId !== null ? 'guest' : 'connecting'),
    myPlayerId,
    lobbyPlayers,
    gameState,
    isConnected,
    error,
    wasKicked,
    disconnectedPlayer,
    chatMessages,
    pendingJoins,
    awaitingApproval,
    joinRejected,
    isHost,
    hostId,
    becameHost,
    // Aprovado no meio do jogo: tem assento, mas a mão só chega na próxima
    // rodada.
    seatedNextRound:
      myPlayerId !== null &&
      !!gameState &&
      gameState.phase !== 'game-end' &&
      !gameState.players.some((p) => p.id === myPlayerId),
    sendAction,
    sendChat,
    startGame,
    addBot,
    removeBot,
    removeDisconnectedPlayer,
    kickPlayer,
    approveJoin,
    rejectJoin,
    leaveLobby,
    disconnect,
  };
}
