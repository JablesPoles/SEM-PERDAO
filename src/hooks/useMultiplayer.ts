'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ChatMessage,
  CultistAppearance,
  DEFAULT_CULTIST_APPEARANCE,
  GameState,
  LobbyPlayer,
  LobbyRules,
  PlayerAction,
  Reaction,
} from '../lib/types';
import { CustomCards, sanitizeCustomCards } from '../lib/customCards';
import { CULTIST_APPEARANCE_KEY } from '../lib/aparencia';
import { supabase } from '../lib/supabase';
import {
  advanceToNextRound,
  applyJudgePick,
  applyReveal,
  applySubmission,
  applyVote,
  canRequestNextRound,
  DEFAULT_SCORE_LIMIT,
  DEFAULT_TURN_LIMIT,
  getActivePlayers,
  getGameMode,
  getPhaseId,
  hasAvailableSeat,
  initGame,
  JUDGE_SECONDS,
  MAX_PLAYERS,
  MIN_PLAYERS,
  pendingSubmitters,
  pendingVoters,
  removePlayer,
  RESULT_SECONDS,
  Seat,
  seatNewcomers,
  shuffle,
  SUBMIT_SECONDS,
  normalizeCultistAppearance,
  normalizeGameRules,
  votingChoicesFor,
} from '../lib/game';
import { ALL_BLACK, ALL_WHITE } from '../lib/cards';
import { BOT_NAMES, getBotJudgeIndex, getBotSubmission } from '../lib/ai';
import {
  createRoomEnvelope,
  cursorFromEnvelope,
  parseRoomEnvelope,
  shouldAcceptSnapshot,
  type RoomEnvelope,
  type SnapshotCursor,
} from '../lib/room/protocol';
import {
  channelStatusOutcome,
  RECONNECT_GIVE_UP_MS,
  trackPresence,
} from '../lib/room/realtime';
import { createRateGuard, normalizeRoomText } from '../lib/room/rateLimit';
import {
  createRoomId,
  createSeatToken,
  hashSeatToken,
  isRoomId,
  normalizeReaction,
  normalizeSeatLedger,
  parseAuthenticatedRequest,
  parseHostChallenge,
  parseHostChallengeClaim,
  parseHostHello,
  parseHostProof,
  parseJoinRequest,
  parseResumeProof,
  parseResumeRequest,
  parseSeatCredential,
  parseSecureWelcome,
  ROOM_SESSION_MAX_AGE_MS,
  type AuthenticatedRequest,
  type JoinRequest,
  type SeatCredential,
  type SeatLedgerEntry,
  type SecureClientRequest,
  verifySeatToken,
} from '../lib/room/semPerdaoProtocol';
import {
  createEncryptionIdentity,
  decryptFrom,
  encryptFor,
  importEncryptionIdentity,
  isEncryptedMessage,
  parseSerializedEncryptionIdentity,
  samePublicKey,
  type EncryptionIdentity,
} from '../lib/room/secureChannel';
import { clearRoomSession, loadRoomSession, saveRoomSession } from '../lib/room/session';

export type MultiplayerRole = 'host' | 'guest' | 'connecting';

/** Alguém batendo na porta de um jogo em andamento, esperando o host. */
export interface PendingJoin {
  clientId: string;
  name: string;
  appearance: CultistAppearance;
}

export interface UseMultiplayerReturn {
  role: MultiplayerRole;
  myPlayerId: number | null;
  lobbyPlayers: LobbyPlayer[];
  lobbyRules: LobbyRules;
  countdownEndsAt: number | null;
  gameState: GameState | null;
  isConnected: boolean;
  error: string | null;
  wasKicked: boolean;
  chatMessages: ChatMessage[];
  reactions: Reaction[];
  pendingJoins: PendingJoin[];
  awaitingApproval: boolean;
  joinRejected: boolean;
  seatedNextRound: boolean;
  isHost: boolean;
  hostId: number;
  becameHost: boolean;
  sendAction: (action: PlayerAction) => void;
  sendChat: (text: string) => void;
  sendReaction: (emoji: string) => void;
  startGame: () => void;
  setReady: (ready: boolean) => void;
  setAppearance: (appearance: CultistAppearance) => void;
  updateLobbyRules: (rules: Partial<LobbyRules>) => void;
  addBot: () => void;
  removeBot: (botId: number) => void;
  kickPlayer: (playerId: number) => void;
  approveJoin: (clientId: string) => void;
  rejectJoin: (clientId: string) => void;
  leaveLobby: () => void;
  disconnect: () => Promise<void>;
}

// Presença oscila em conexão móvel ruim; só marca o assento como offline se o
// jogador ficar fora por este tempo. A partida nunca é pausada.
const DISCONNECT_GRACE_MS = 12000;
// Ids de bot ficam bem acima dos de humanos para nunca colidirem.
const BOT_ID_BASE = 100;
const RITUAL_COUNTDOWN_MS = 3000;
const CONTROL_HEARTBEAT_MS = 25000;
const PRIVATE_SUBSCRIBE_TIMEOUT_MS = 8000;

type RoomChannel = ReturnType<typeof supabase.channel>;

type PendingHandshake = JoinRequest;

interface HostPeer {
  playerId: number;
  clientId: string;
  connectionId: string;
  publicKey: JsonWebKey;
  token: string;
  privateTopic: string;
  channel: RoomChannel;
}

interface LobbyWirePayload {
  players: LobbyPlayer[];
  rules: LobbyRules;
  countdownEndsAt: number | null;
  seq: number;
  seatLedger: SeatLedgerEntry[];
}

interface PrivateStatePayload {
  state: GameState;
  seatLedger: SeatLedgerEntry[];
}

interface StoredRoomContext {
  hostId: number;
  gameId: string | null;
  seatLedger: SeatLedgerEntry[];
}

interface PendingAuthority {
  envelope: RoomEnvelope;
  hello: {
    hostId: number;
    hostConnectionId: string;
    publicKey: JsonWebKey;
  };
  challengeNonce: string;
  challengedAt: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isGameStateSnapshot(value: unknown): value is GameState {
  if (!isRecord(value)) return false;
  return ['setup', 'submitting', 'judging', 'round-end', 'game-end'].includes(String(value.phase))
    && Array.isArray(value.players)
    && Array.isArray(value.submissions)
    && Array.isArray(value.blackDeck)
    && Array.isArray(value.whiteDeck)
    && Number.isSafeInteger(value.round)
    && Number.isSafeInteger(value.stateRevision);
}

export const DEFAULT_LOBBY_RULES: LobbyRules = Object.freeze({
  mode: 'judge',
  turnLimit: DEFAULT_TURN_LIMIT,
  submitSeconds: SUBMIT_SECONDS,
  judgeSeconds: JUDGE_SECONDS,
  resultSeconds: RESULT_SECONDS,
});

function normalizeLobbyRules(value: unknown): LobbyRules {
  const candidate = value && typeof value === 'object'
    ? value as Partial<LobbyRules>
    : {};
  return {
    mode: candidate.mode === 'democracy' ? 'democracy' : 'judge',
    ...normalizeGameRules(candidate),
  };
}

function appearanceForId(id: number): CultistAppearance {
  const robes: CultistAppearance['robe'][] = ['blood', 'ash', 'midnight', 'moss'];
  const hoods: CultistAppearance['hood'][] = ['classic', 'spire', 'shrouded'];
  const faces: CultistAppearance['face'][] = ['void', 'ember', 'grin', 'weeping'];
  const accents: CultistAppearance['accent'][] = ['bone', 'brass', 'scarlet', 'cyan'];
  const accessories: CultistAppearance['accessory'][] = ['none', 'chain', 'candle', 'relic'];
  const seed = Math.abs(id);
  return {
    robe: robes[seed % robes.length],
    hood: hoods[(seed * 3 + 1) % hoods.length],
    face: faces[(seed * 5 + 2) % faces.length],
    accent: accents[(seed * 7 + 1) % accents.length],
    accessory: accessories[(seed * 11 + 3) % accessories.length],
  };
}

function readLocalAppearance(): CultistAppearance {
  if (typeof window === 'undefined') return DEFAULT_CULTIST_APPEARANCE;
  try {
    const saved = localStorage.getItem(CULTIST_APPEARANCE_KEY);
    return normalizeCultistAppearance(saved ? JSON.parse(saved) : null);
  } catch {
    return DEFAULT_CULTIST_APPEARANCE;
  }
}

function normalizeLobbyPlayer(player: Partial<LobbyPlayer> & Pick<LobbyPlayer, 'id' | 'name'>): LobbyPlayer {
  return {
    id: player.id,
    name: player.name,
    isBot: player.isBot,
    ready: player.isBot ? true : player.ready === true,
    appearance: normalizeCultistAppearance(player.appearance ?? appearanceForId(player.id)),
  };
}

function normalizeLobbyPlayers(players: LobbyPlayer[] | null | undefined): LobbyPlayer[] {
  return (players ?? []).map((player) => normalizeLobbyPlayer(player));
}

// O relógio visual e os timeouts do host usam a mesma origem. Reagendar após
// uma jogada/revelação nunca devolve o tempo inteiro para a fase.
export function remainingPhaseMs(gs: GameState, seconds: number): number {
  const deadline = typeof gs.phaseEndsAt === 'number' && Number.isFinite(gs.phaseEndsAt)
    ? gs.phaseEndsAt
    : gs.phaseStartedAt + seconds * 1000;
  return Math.max(0, deadline - Date.now());
}

/**
 * O host guarda o estado completo; cada convidado só recebe o que pode ver:
 * a própria mão, nunca as pilhas de compra, e as jogadas da rodada de acordo
 * com a fase — durante as jogadas só o "quem já jogou" (cartas ocultas),
 * durante o julgamento as cartas anônimas (cada jogador só reconhece a sua no
 * modo Democracia), votos secretos até o resultado, e na virada tudo aberto.
 */
export function redactStateFor(gs: GameState, targetId: number): GameState {
  return {
    ...gs,
    blackPool: [],
    whitePool: [],
    blackDeck: [],
    whiteDeck: [],
    players: gs.players.map((p) =>
      p.id === targetId ? p : { ...p, hand: [] }
    ),
    submissions: gs.submissions.map((s, index) => {
      if (gs.phase === 'submitting') {
        return { playerId: s.playerId, cards: [] };
      }
      if (gs.phase === 'judging') {
        const cardsVisible = getGameMode(gs) === 'democracy' || gs.revealed.includes(index);
        return {
          playerId:
            getGameMode(gs) === 'democracy' && s.playerId === targetId
              ? targetId
              : -1,
          cards: cardsVisible ? s.cards : [],
        };
      }
      return s;
    }),
    votes:
      gs.phase === 'judging'
        ? gs.votes.map((vote) => ({ ...vote, submissionIndex: -1 }))
        : gs.votes,
    // `winner` é um atalho legado e não pode reintroduzir a mão completa que
    // acabou de ser removida da lista pública de jogadores.
    winner: gs.winner ? { ...gs.winner, hand: [] } : null,
  };
}

export function useMultiplayer(
  roomCode: string,
  playerName: string | null,
  initialIsHost: boolean,
  customCards: CustomCards
): UseMultiplayerReturn {
  const pidKey = `sp-pid-${roomCode}`;
  const sessionKey = `sp-seat-session-${roomCode}`;
  const contextKey = `sp-room-context-${roomCode}`;
  const hostStateKey = `sp-host-state-${roomCode}`;
  const hostLobbyKey = `sp-host-lobby-${roomCode}`;
  const [restoredSeatSession] = useState<unknown>(() => {
    if (typeof window === 'undefined') return null;
    return loadRoomSession(
      sessionStorage,
      sessionKey,
      roomCode,
      ROOM_SESSION_MAX_AGE_MS
    );
  });
  const [restoredCredential] = useState<SeatCredential | null>(() =>
    parseSeatCredential(restoredSeatSession)
  );
  const [restoredEncryptionIdentity] = useState(() =>
    isRecord(restoredSeatSession)
      ? parseSerializedEncryptionIdentity(restoredSeatSession.encryptionIdentity)
      : null
  );
  const [restoredContext] = useState<StoredRoomContext | null>(() => {
    if (typeof window === 'undefined') return null;
    const value = loadRoomSession<StoredRoomContext>(
      sessionStorage,
      contextKey,
      roomCode,
      ROOM_SESSION_MAX_AGE_MS
    );
    if (!value || !Number.isSafeInteger(value.hostId) || value.hostId < 0) return null;
    return {
      hostId: value.hostId,
      gameId: isRoomId(value.gameId) ? value.gameId : null,
      seatLedger: normalizeSeatLedger(value.seatLedger),
    };
  });
  const initialHostPlayerId = initialIsHost && typeof window !== 'undefined'
    ? restoredCredential?.playerId ?? Number(sessionStorage.getItem(pidKey) ?? 0)
    : 0;

  // Quem comanda a mesa pode mudar no meio do jogo: se o host sair, o próximo
  // pela ordem de entrada assume. Handlers leem refs para a promoção não
  // precisar derrubar e reerguer o canal.
  const [isHost, setIsHost] = useState(initialIsHost);
  const isHostRef = useRef(initialIsHost);
  const [hostId, setHostId] = useState(
    initialIsHost && Number.isFinite(initialHostPlayerId)
      ? initialHostPlayerId
      : restoredContext?.hostId ?? 0
  );
  const hostIdRef = useRef(hostId);
  const [becameHost, setBecameHost] = useState(false);
  useEffect(() => { isHostRef.current = isHost; }, [isHost]);
  useEffect(() => { hostIdRef.current = hostId; }, [hostId]);

  // Convidados lembram o assento entre reloads: F5 volta pro mesmo jogo.
  const [myPlayerId, setMyPlayerId] = useState<number | null>(() => {
    if (isHost) return Number.isFinite(initialHostPlayerId) ? initialHostPlayerId : 0;
    return restoredCredential?.playerId ?? null;
  });

  // O host restaura um jogo em andamento após reload, pra um F5 não matar a
  // mesa de todo mundo.
  const [restoredHost] = useState(() => {
    const empty = {
      game: null as GameState | null,
      lobby: null as LobbyPlayer[] | null,
      rules: DEFAULT_LOBBY_RULES,
      countdownEndsAt: null as number | null,
      lobbySeq: 0,
      nextPlayerId: 1,
      seatLedger: [] as SeatLedgerEntry[],
      gameId: null as string | null,
    };
    if (!isHost || typeof window === 'undefined') return empty;
    try {
      const savedGame = sessionStorage.getItem(hostStateKey);
      const savedLobby = sessionStorage.getItem(hostLobbyKey);
      const meta = savedLobby
        ? (JSON.parse(savedLobby) as {
            lobby: LobbyPlayer[];
            rules?: LobbyRules;
            countdownEndsAt?: number | null;
            lobbySeq?: number;
            nextPlayerId: number;
            seatLedger?: SeatLedgerEntry[];
            gameId?: string | null;
          })
        : null;
      // Snapshot de versão antiga pode não ter os campos novos — completa.
      const parsed = savedGame ? (JSON.parse(savedGame) as GameState) : null;
      const game = parsed
        ? {
            ...parsed,
            mode: parsed.mode ?? 'judge',
            votes: parsed.votes ?? [],
            votingOptions: parsed.votingOptions ?? [],
            votingRound: parsed.votingRound ?? 1,
            tieBreak: parsed.tieBreak ?? false,
            revealed: parsed.revealed ?? [],
            phaseStartedAt: parsed.phaseStartedAt ?? Date.now(),
            stateRevision: parsed.stateRevision ?? 0,
            players: parsed.players.map((player) => ({
              ...player,
              connected: player.connected ?? true,
              appearance: normalizeCultistAppearance(player.appearance),
            })),
            blackPool: parsed.blackPool?.length ? parsed.blackPool : ALL_BLACK,
            whitePool: parsed.whitePool?.length ? parsed.whitePool : ALL_WHITE,
          }
        : null;
      return {
        game,
        lobby: meta?.lobby ? normalizeLobbyPlayers(meta.lobby) : null,
        rules: normalizeLobbyRules(meta?.rules),
        countdownEndsAt:
          typeof meta?.countdownEndsAt === 'number' && Number.isFinite(meta.countdownEndsAt)
            ? meta.countdownEndsAt
            : null,
        lobbySeq: Number.isInteger(meta?.lobbySeq) ? Math.max(0, meta!.lobbySeq!) : 0,
        nextPlayerId: meta?.nextPlayerId ?? 1,
        seatLedger: normalizeSeatLedger(meta?.seatLedger),
        gameId: isRoomId(meta?.gameId) ? meta.gameId : null,
      };
    } catch {
      return empty;
    }
  });

  const [lobbyPlayers, setLobbyPlayers] = useState<LobbyPlayer[]>(
    restoredHost.lobby ?? (isHost && playerName
      ? [normalizeLobbyPlayer({
          id: Number.isFinite(initialHostPlayerId) ? initialHostPlayerId : 0,
          name: playerName,
          ready: false,
          appearance: readLocalAppearance(),
        })]
      : [])
  );
  const [lobbyRules, setLobbyRules] = useState<LobbyRules>(restoredHost.rules);
  const [countdownEndsAt, setCountdownEndsAt] = useState<number | null>(
    restoredHost.countdownEndsAt
  );
  const [gameState, setGameState] = useState<GameState | null>(restoredHost.game);
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [wasKicked, setWasKicked] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [reactions, setReactions] = useState<Reaction[]>([]);
  const [pendingJoins, setPendingJoins] = useState<PendingJoin[]>([]);
  const [awaitingApproval, setAwaitingApproval] = useState(false);
  const [joinRejected, setJoinRejected] = useState(false);

  const channelRef = useRef<RoomChannel | null>(null);
  const hostGameRef = useRef<GameState | null>(restoredHost.game);
  const nextPlayerIdRef = useRef(restoredHost.nextPlayerId);
  const [clientId] = useState(() => createRoomId('client'));
  const [connectionId] = useState(() => createRoomId('connection'));
  const clientIdRef = useRef(clientId);
  const connectionIdRef = useRef(connectionId);
  const authorityEpochRef = useRef(initialIsHost ? createRoomId('authority') : 'authority-pending');
  const hostConnectionIdRef = useRef(initialIsHost ? connectionId : 'connection-pending');
  const gameIdRef = useRef<string | null>(restoredHost.gameId ?? restoredContext?.gameId ?? null);
  const encryptionIdentityRef = useRef<EncryptionIdentity | null>(null);
  const hostPublicKeyRef = useRef<JsonWebKey | null>(null);
  const credentialRef = useRef<SeatCredential | null>(restoredCredential);
  const seatLedgerRef = useRef<SeatLedgerEntry[]>(
    restoredHost.seatLedger.length ? restoredHost.seatLedger : restoredContext?.seatLedger ?? []
  );
  const snapshotCursorRef = useRef<SnapshotCursor | null>(null);
  const guestPrivateChannelRef = useRef<RoomChannel | null>(null);
  const hostPeersRef = useRef<Map<number, HostPeer>>(new Map());
  const pendingHandshakesRef = useRef<Map<string, PendingHandshake>>(new Map());
  const acceptedRequestIdsRef = useRef<Set<string>>(new Set());
  const leavingRef = useRef(false);
  const pendingAuthorityRef = useRef<PendingAuthority | null>(null);
  const sendSecureRequestRef = useRef<(request: SecureClientRequest) => Promise<boolean>>(
    async () => false
  );
  const issueWelcomeRef = useRef<(
    handshake: PendingHandshake,
    playerId: number,
    token?: string
  ) => Promise<boolean>>(async () => false);
  const sendJoinStatusRef = useRef<(
    clientId: string,
    kind: 'join_pending' | 'join_rejected',
    reason?: string
  ) => Promise<void>>(async () => {});
  const announceHostRef = useRef<() => void>(() => {});
  const pendingNextRoundRef = useRef<Set<number>>(new Set());
  const lobbyPlayersRef = useRef<LobbyPlayer[]>(lobbyPlayers);
  const lobbyRulesRef = useRef<LobbyRules>(lobbyRules);
  const countdownEndsAtRef = useRef<number | null>(countdownEndsAt);
  const localAppearanceRef = useRef<CultistAppearance>(
    lobbyPlayers.find((player) => player.id === myPlayerId)?.appearance ?? readLocalAppearance()
  );
  // Debounce do sync de aparência: rajada de cliques vira UMA mensagem.
  const appearanceSyncRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (appearanceSyncRef.current) clearTimeout(appearanceSyncRef.current);
  }, []);
  const myPlayerIdRef = useRef<number | null>(myPlayerId);
  const isConnectedRef = useRef(false);
  const customCardsRef = useRef(customCards);

  // clientId → playerId: retries de `join` não criam jogador duplicado.
  const clientPlayerMapRef = useRef<Map<string, number>>(new Map());
  // Sequência do lobby: broadcast atrasado não sobrescreve estado mais novo.
  const lobbySeqRef = useRef(restoredHost.lobbySeq);
  const lastLobbySeqRef = useRef(-1);
  // Marca do último commit que REALMENTE invalida consentimento (troca de
  // regras). Consentimento anterior a ela não vale; o resto do churn do
  // lobby — presença, aparência, countdown — não derruba um "pronto".
  const consentEpochRef = useRef(-1);

  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Relógios do host: bots + limite de tempo dos humanos.
  const botTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const scheduleBotRef = useRef<(gs: GameState) => void>(() => {});
  const disconnectTimersRef = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());
  const pendingJoinsRef = useRef<PendingJoin[]>([]);
  const pendingSeatsRef = useRef<{ id: number; name: string; appearance: CultistAppearance }[]>([]);
  const awaitingApprovalRef = useRef(false);
  const gameStateRef = useRef<GameState | null>(restoredHost.game);
  const maybePromoteSelfRef = useRef<(goneHostId: number) => void>(() => {});
  const chatRateGuardRef = useRef(createRateGuard({ limit: 6, windowMs: 8_000, cooldownMs: 15_000 }));
  const reactionRateGuardRef = useRef(createRateGuard({ limit: 8, windowMs: 5_000, cooldownMs: 8_000 }));

  useEffect(() => { gameStateRef.current = gameState; }, [gameState]);
  useEffect(() => { pendingJoinsRef.current = pendingJoins; }, [pendingJoins]);
  useEffect(() => { awaitingApprovalRef.current = awaitingApproval; }, [awaitingApproval]);
  useEffect(() => { lobbyPlayersRef.current = lobbyPlayers; }, [lobbyPlayers]);
  useEffect(() => { lobbyRulesRef.current = lobbyRules; }, [lobbyRules]);
  useEffect(() => { countdownEndsAtRef.current = countdownEndsAt; }, [countdownEndsAt]);
  useEffect(() => { myPlayerIdRef.current = myPlayerId; }, [myPlayerId]);
  useEffect(() => { isConnectedRef.current = isConnected; }, [isConnected]);
  useEffect(() => { customCardsRef.current = customCards; }, [customCards]);

  const sendRaw = useCallback((event: string, payload: unknown) => {
    channelRef.current?.send({ type: 'broadcast', event, payload });
  }, []);

  const sendControl = useCallback((
    kind: string,
    payload: unknown,
    revision = 0,
    gameId = gameIdRef.current
  ) => {
    if (!isRoomId(authorityEpochRef.current) || !isRoomId(connectionIdRef.current)) return;
    const envelope = createRoomEnvelope(kind, payload, {
      roomCode,
      gameId,
      authorityEpoch: authorityEpochRef.current,
      hostId: hostIdRef.current,
      senderId: myPlayerIdRef.current ?? 0,
      senderConnectionId: connectionIdRef.current,
      revision,
    });
    sendRaw('room', envelope);
  }, [roomCode, sendRaw]);

  const sendPrivateToPeer = useCallback(async (
    peer: HostPeer,
    kind: string,
    payload: unknown,
    revision = 0,
    gameId = gameIdRef.current
  ) => {
    const identity = encryptionIdentityRef.current;
    if (!identity || !isHostRef.current) return false;
    const envelope = createRoomEnvelope(kind, payload, {
      roomCode,
      gameId,
      authorityEpoch: authorityEpochRef.current,
      hostId: hostIdRef.current,
      senderId: hostIdRef.current,
      senderConnectionId: connectionIdRef.current,
      revision,
    });
    try {
      const encrypted = await encryptFor(identity, peer.publicKey, envelope);
      await peer.channel.send({ type: 'broadcast', event: 'secure', payload: encrypted });
      return true;
    } catch {
      return false;
    }
  }, [roomCode]);

  // Host → convidados: O(N), um canal cifrado por assento. Nenhum convidado
  // recebe os snapshots destinados aos demais, nem mesmo como ciphertext.
  const broadcastState = useCallback((gs: GameState) => {
    const gameId = gameIdRef.current ?? createRoomId('game');
    gameIdRef.current = gameId;
    for (const peer of hostPeersRef.current.values()) {
      void sendPrivateToPeer(peer, 'game_state', {
        state: redactStateFor(gs, peer.playerId),
        seatLedger: seatLedgerRef.current,
      } satisfies PrivateStatePayload, gs.stateRevision ?? 0, gameId);
    }
  }, [sendPrivateToPeer]);

  const broadcastLobby = useCallback((players: LobbyPlayer[]) => {
    const payload = {
      players,
      rules: lobbyRulesRef.current,
      countdownEndsAt: countdownEndsAtRef.current,
      seq: lobbySeqRef.current,
      seatLedger: seatLedgerRef.current,
    } satisfies LobbyWirePayload;
    for (const peer of hostPeersRef.current.values()) {
      void sendPrivateToPeer(peer, 'lobby', payload, lobbySeqRef.current);
    }
  }, [sendPrivateToPeer]);

  const persistHostLobby = useCallback(() => {
    try {
      sessionStorage.setItem(hostLobbyKey, JSON.stringify({
        lobby: lobbyPlayersRef.current,
        rules: lobbyRulesRef.current,
        countdownEndsAt: countdownEndsAtRef.current,
        lobbySeq: lobbySeqRef.current,
        nextPlayerId: nextPlayerIdRef.current,
        seatLedger: seatLedgerRef.current,
        gameId: gameIdRef.current,
      }));
    } catch { /* storage cheio/indisponível — persistência é melhor esforço */ }
  }, [hostLobbyKey]);

  const commitLobby = useCallback((
    players: LobbyPlayer[],
    options: {
      rules?: LobbyRules;
      countdownEndsAt?: number | null;
      invalidatesConsent?: boolean;
    } = {}
  ) => {
    const normalizedPlayers = normalizeLobbyPlayers(players);
    const nextRules = options.rules ?? lobbyRulesRef.current;
    const nextCountdown = options.countdownEndsAt === undefined
      ? countdownEndsAtRef.current
      : options.countdownEndsAt;

    lobbyPlayersRef.current = normalizedPlayers;
    lobbyRulesRef.current = nextRules;
    countdownEndsAtRef.current = nextCountdown;
    setLobbyPlayers(normalizedPlayers);
    setLobbyRules(nextRules);
    setCountdownEndsAt(nextCountdown);
    lobbySeqRef.current++;
    if (options.invalidatesConsent) consentEpochRef.current = lobbySeqRef.current;
    broadcastLobby(normalizedPlayers);
    persistHostLobby();
  }, [broadcastLobby, persistHostLobby]);

  // Novo estado autoritativo no host: guarda, renderiza, transmite, persiste
  // e agenda os relógios (bots + timeouts).
  const commitHostState = useCallback((gs: GameState) => {
    const currentRevision = hostGameRef.current?.stateRevision ?? -1;
    const incomingRevision = gs.stateRevision ?? currentRevision;
    const committed: GameState = {
      ...gs,
      stateRevision: Math.max(currentRevision, incomingRevision) + 1,
    };
    hostGameRef.current = committed;
    gameStateRef.current = committed;
    setGameState(committed);
    broadcastState(committed);
    persistHostLobby();
    try {
      if (committed.phase === 'game-end') {
        sessionStorage.removeItem(hostStateKey);
      } else {
        sessionStorage.setItem(hostStateKey, JSON.stringify(committed));
      }
    } catch { /* melhor esforço */ }
    scheduleBotRef.current(committed);
  }, [broadcastState, hostStateKey, persistHostLobby]);

  const setPlayerConnected = useCallback((playerId: number, connected: boolean) => {
    if (!isHostRef.current) return;
    const gs = hostGameRef.current;
    const player = gs?.players.find((candidate) => candidate.id === playerId && !candidate.eliminated);
    if (!gs || !player || (player.connected ?? true) === connected) return;
    commitHostState({
      ...gs,
      players: gs.players.map((candidate) =>
        candidate.id === playerId ? { ...candidate, connected } : candidate
      ),
    });
  }, [commitHostState]);

  const cancelDisconnectTimer = useCallback((playerId: number) => {
    const t = disconnectTimersRef.current.get(playerId);
    if (t) {
      clearTimeout(t);
      disconnectTimersRef.current.delete(playerId);
    }
  }, []);

  // Uma reconexão pode criar a presença nova antes de a antiga emitir `leave`.
  // Sempre consulta o retrato atual do canal para esse evento atrasado não
  // derrubar alguém que já voltou.
  const isPlayerPresent = useCallback((playerId: number) => {
    const presence = channelRef.current?.presenceState() ?? {};
    return Object.values(presence).some((metas) =>
      (metas as unknown as { playerId?: number }[]).some(
        (meta) => meta.playerId === playerId
      )
    );
  }, []);

  const applyLobbyReady = useCallback((playerId: number, ready: boolean) => {
    if (!isHostRef.current || hostGameRef.current) return;
    const current = lobbyPlayersRef.current;
    const player = current.find((candidate) => candidate.id === playerId);
    if (!player || player.isBot || player.ready === ready) return;
    commitLobby(
      current.map((candidate) => candidate.id === playerId
        ? { ...candidate, ready }
        : candidate),
      { countdownEndsAt: ready ? countdownEndsAtRef.current : null }
    );
  }, [commitLobby]);

  const applyLobbyAppearance = useCallback((
    playerId: number,
    appearance: CultistAppearance
  ) => {
    if (!isHostRef.current || hostGameRef.current) return;
    const current = lobbyPlayersRef.current;
    const player = current.find((candidate) => candidate.id === playerId);
    if (!player || player.isBot) return;
    const normalized = normalizeCultistAppearance(appearance);
    if (JSON.stringify(player.appearance) === JSON.stringify(normalized)) return;
    commitLobby(
      current.map((candidate) => candidate.id === playerId
        ? { ...candidate, appearance: normalized, ready: false }
        : candidate),
      { countdownEndsAt: null }
    );
  }, [commitLobby]);

  const applyHostAction = useCallback((action: PlayerAction, fromPlayerId: number) => {
    let gs = hostGameRef.current;
    if (!gs) return;
    const before = gs;
    // Broadcast atrasado de uma fase anterior nunca atravessa o ritual atual.
    // `phaseId` continua opcional para aceitar clientes/snapshots v1.
    if (action.phaseId && action.phaseId !== getPhaseId(gs)) return;

    if (action.type === 'submit') {
      if (gs.phase !== 'submitting') return;
      gs = applySubmission(gs, fromPlayerId, action.cardIds);
    } else if (action.type === 'reveal') {
      if (gs.phase !== 'judging' || gs.czarId !== fromPlayerId) return;
      gs = applyReveal(gs, action.index);
    } else if (action.type === 'judge') {
      if (gs.phase !== 'judging' || gs.czarId !== fromPlayerId) return;
      if (!Number.isInteger(action.index)) return;
      gs = applyJudgePick(gs, action.index);
    } else if (action.type === 'vote') {
      if (gs.phase !== 'judging' || getGameMode(gs) !== 'democracy') return;
      if (action.phaseStartedAt !== gs.phaseStartedAt) return;
      gs = applyVote(gs, fromPlayerId, action.index);
    } else if (action.type === 'next_round') {
      if (!canRequestNextRound(gs, fromPlayerId)) return;
      pendingNextRoundRef.current.add(fromPlayerId);
      const activeHumans = getActivePlayers(gs.players).filter(
        (p) => p.isHuman && p.connected !== false
      );
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

    // Ação inválida/duplicada não publica uma falsa mutação nem rearma um
    // timeout já vencido em loop de 0 ms.
    if (gs === before) return;
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
   * - democracia: bots/offline votam rápido e humanos AFK votam no timeout;
   * - fim de rodada: avança sozinho depois de um respiro, sem esperar todos.
   */
  const scheduleBot = useCallback((gs: GameState) => {
    if (!isHostRef.current) return;
    clearBotTimers();

    if (gs.phase === 'submitting') {
      const bots = pendingSubmitters(gs).filter((p) => !p.isHuman || p.connected === false);
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
      }, remainingPhaseMs(gs, SUBMIT_SECONDS)));
    } else if (gs.phase === 'judging') {
      if (getGameMode(gs) === 'democracy') {
        const votingRound = gs.votingRound;
        const votingStartedAt = gs.phaseStartedAt;
        const automatic = pendingVoters(gs).filter(
          (player) => !player.isHuman || player.connected === false
        );
        automatic.forEach((player, index) => {
          botTimersRef.current.push(setTimeout(() => {
            const current = hostGameRef.current;
            if (
              !current ||
              current.phase !== 'judging' ||
              getGameMode(current) !== 'democracy' ||
              current.votingRound !== votingRound ||
              current.phaseStartedAt !== votingStartedAt
            ) return;
            const choices = votingChoicesFor(current, player.id);
            if (!choices.length) return;
            const choice = choices[Math.floor(Math.random() * choices.length)];
            applyHostAction({ type: 'vote', index: choice, phaseStartedAt: current.phaseStartedAt }, player.id);
          }, 1100 + index * 750 + Math.random() * 600));
        });

        botTimersRef.current.push(setTimeout(() => {
          const current = hostGameRef.current;
          if (
            !current ||
            current.phase !== 'judging' ||
            getGameMode(current) !== 'democracy' ||
            current.votingRound !== votingRound ||
            current.phaseStartedAt !== votingStartedAt
          ) return;
          for (const player of pendingVoters(current)) {
            const latest = hostGameRef.current;
            if (
              !latest ||
              latest.phase !== 'judging' ||
              getGameMode(latest) !== 'democracy' ||
              latest.votingRound !== votingRound ||
              latest.phaseStartedAt !== votingStartedAt
            ) return;
            const choices = votingChoicesFor(latest, player.id);
            if (!choices.length) continue;
            const choice = choices[Math.floor(Math.random() * choices.length)];
            applyHostAction({ type: 'vote', index: choice, phaseStartedAt: latest.phaseStartedAt }, player.id);
          }
        }, remainingPhaseMs(gs, JUDGE_SECONDS)));
        return;
      }

      const czar = gs.players.find((p) => p.id === gs.czarId);
      if (!czar || czar.eliminated) return;

      if (!czar.isHuman || czar.connected === false) {
        // Juiz-bot faz o teatro completo: vira as provas uma a uma e só
        // depois bate o martelo.
        const unrevealed = gs.submissions
          .map((_, i) => i)
          .filter((i) => !gs.revealed.includes(i));
        unrevealed.forEach((idx, k) => {
          botTimersRef.current.push(setTimeout(() => {
            const cur = hostGameRef.current;
            if (!cur || cur.phase !== 'judging' || cur.czarId !== czar.id) return;
            if (!cur.revealed.includes(idx)) applyHostAction({ type: 'reveal', index: idx }, czar.id);
          }, 1200 + k * 2800));
        });
        const pickDelay = unrevealed.length === 0
          ? 2000
          : 1200 + unrevealed.length * 2800 + 2200;
        botTimersRef.current.push(setTimeout(() => {
          const cur = hostGameRef.current;
          if (!cur || cur.phase !== 'judging' || cur.czarId !== czar.id) return;
          if (cur.revealed.length !== cur.submissions.length) return;
          applyHostAction({ type: 'judge', index: getBotJudgeIndex(cur.submissions.length) }, czar.id);
        }, pickDelay));
      } else {
        // Juiz humano AFK: no estouro do relógio a mesa vira o que faltar e
        // condena aleatório.
        botTimersRef.current.push(setTimeout(() => {
          const cur = hostGameRef.current;
          if (!cur || cur.phase !== 'judging' || cur.czarId !== czar.id) return;
          for (let i = 0; i < cur.submissions.length; i++) {
            const now = hostGameRef.current;
            if (!now || now.phase !== 'judging') return;
            if (!now.revealed.includes(i)) applyHostAction({ type: 'reveal', index: i }, czar.id);
          }
          const fin = hostGameRef.current;
          if (!fin || fin.phase !== 'judging' || fin.czarId !== czar.id) return;
          applyHostAction({ type: 'judge', index: getBotJudgeIndex(fin.submissions.length) }, czar.id);
        }, remainingPhaseMs(gs, JUDGE_SECONDS)));
      }
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
      }, remainingPhaseMs(gs, RESULT_SECONDS)));
    }
  }, [applyHostAction, clearBotTimers, commitHostState]);

  useEffect(() => { scheduleBotRef.current = scheduleBot; }, [scheduleBot]);

  const closeHostPeer = useCallback((playerId: number) => {
    const peer = hostPeersRef.current.get(playerId);
    if (!peer) return;
    hostPeersRef.current.delete(playerId);
    void supabase.removeChannel(peer.channel);
  }, []);

  const appendChat = useCallback((message: ChatMessage) => {
    setChatMessages((previous) => previous.some((item) => item.id === message.id)
      ? previous
      : [...previous.slice(-99), message]);
  }, []);

  const appendReaction = useCallback((reaction: Reaction) => {
    setReactions((previous) => previous.some((item) => item.id === reaction.id)
      ? previous
      : [...previous.slice(-24), reaction]);
  }, []);

  const publishChat = useCallback((playerId: number, rawText: string) => {
    if (!isHostRef.current || !chatRateGuardRef.current.accept(String(playerId)).ok) return;
    const text = normalizeRoomText(rawText, 200);
    const player = lobbyPlayersRef.current.find((candidate) => candidate.id === playerId)
      ?? hostGameRef.current?.players.find((candidate) => candidate.id === playerId);
    if (!text || !player) return;
    const message: ChatMessage = {
      id: createRoomId('chat'),
      playerId,
      name: player.name,
      text,
      ts: Date.now(),
    };
    appendChat(message);
    for (const peer of hostPeersRef.current.values()) {
      void sendPrivateToPeer(peer, 'chat', message);
    }
  }, [appendChat, sendPrivateToPeer]);

  const publishReaction = useCallback((playerId: number, rawEmoji: string) => {
    if (!isHostRef.current || !reactionRateGuardRef.current.accept(String(playerId)).ok) return;
    const emoji = normalizeReaction(rawEmoji);
    const player = lobbyPlayersRef.current.find((candidate) => candidate.id === playerId)
      ?? hostGameRef.current?.players.find((candidate) => candidate.id === playerId);
    if (!emoji || !player) return;
    const thrown = /^throw:(?:tomate|sapato|rosa):(\d{1,6})$/u.exec(emoji);
    if (thrown) {
      const targetId = Number(thrown[1]);
      const targetExists = lobbyPlayersRef.current.some((candidate) => candidate.id === targetId)
        || Boolean(hostGameRef.current?.players.some((candidate) => candidate.id === targetId));
      if (!targetExists) return;
    }
    const reaction: Reaction = {
      id: createRoomId('reaction'),
      emoji,
      name: player.name,
      playerId,
      ts: Date.now(),
    };
    appendReaction(reaction);
    for (const peer of hostPeersRef.current.values()) {
      void sendPrivateToPeer(peer, 'reaction', reaction);
    }
  }, [appendReaction, sendPrivateToPeer]);

  const applyAuthenticatedRequest = useCallback((peer: HostPeer, value: AuthenticatedRequest) => {
    if (!isHostRef.current || value.token !== peer.token) return;
    if (acceptedRequestIdsRef.current.has(value.requestId)) return;
    acceptedRequestIdsRef.current.add(value.requestId);
    if (acceptedRequestIdsRef.current.size > 512) {
      const oldest = acceptedRequestIdsRef.current.values().next().value;
      if (typeof oldest === 'string') acceptedRequestIdsRef.current.delete(oldest);
    }

    const request = value.request;
    cancelDisconnectTimer(peer.playerId);
    if (request.type === 'request_state') {
      setPlayerConnected(peer.playerId, true);
      const state = hostGameRef.current;
      if (state) {
        void sendPrivateToPeer(peer, 'game_state', {
          state: redactStateFor(state, peer.playerId),
          seatLedger: seatLedgerRef.current,
        } satisfies PrivateStatePayload, state.stateRevision ?? 0);
      }
      broadcastLobby(lobbyPlayersRef.current);
      return;
    }
    if (request.type === 'action') {
      applyHostAction(request.action, peer.playerId);
      return;
    }
    if (request.type === 'chat') {
      publishChat(peer.playerId, request.text);
      return;
    }
    if (request.type === 'reaction') {
      publishReaction(peer.playerId, request.emoji);
      return;
    }
    if (request.type === 'ready') {
      if (request.lobbySeq >= consentEpochRef.current) {
        applyLobbyReady(peer.playerId, request.ready);
      }
      return;
    }
    if (request.type === 'appearance') {
      applyLobbyAppearance(peer.playerId, request.appearance);
      return;
    }

    closeHostPeer(peer.playerId);
    const currentGame = hostGameRef.current;
    const gameOn = !!currentGame && currentGame.phase !== 'setup' && currentGame.phase !== 'game-end';
    if (request.scope === 'lobby' && !gameOn) {
      seatLedgerRef.current = seatLedgerRef.current.filter((entry) => entry.playerId !== peer.playerId);
      const updated = lobbyPlayersRef.current.filter((player) => player.id !== peer.playerId);
      commitLobby(updated, { countdownEndsAt: null });
      return;
    }
    setPlayerConnected(peer.playerId, false);
  }, [
    applyHostAction,
    applyLobbyAppearance,
    applyLobbyReady,
    broadcastLobby,
    cancelDisconnectTimer,
    closeHostPeer,
    commitLobby,
    publishChat,
    publishReaction,
    sendPrivateToPeer,
    setPlayerConnected,
  ]);

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
    // `leave` de um socket velho pode chegar depois do `join` do socket novo.
    if (present.has(goneHostId)) return;
    if (!present.size) return;

    const successor = Math.min(...present);
    if (successor !== myId) return;

    const gs = gameStateRef.current;
    const gameOn = !!gs && gs.phase !== 'game-end' && gs.phase !== 'setup';
    isHostRef.current = true;
    setIsHost(true);
    setBecameHost(true);
    hostIdRef.current = myId;
    setHostId(myId);
    authorityEpochRef.current = createRoomId('authority');
    hostConnectionIdRef.current = connectionIdRef.current;
    hostPublicKeyRef.current = encryptionIdentityRef.current?.publicKey ?? null;
    snapshotCursorRef.current = null;
    if (guestPrivateChannelRef.current) {
      void supabase.removeChannel(guestPrivateChannelRef.current);
      guestPrivateChannelRef.current = null;
    }
    try {
      sessionStorage.setItem('sp-host-room', roomCode);
      sessionStorage.setItem(pidKey, String(myId));
    } catch { /* melhor esforço */ }

    // Bots viviam no host antigo; sem o estado deles, saem junto. O assento do
    // host antigo só fica reservado durante uma partida. No lobby ele libera o
    // banco, senão um pronto fantasma poderia bloquear o ritual para sempre.
    const lobby = lobbyPlayersRef.current.filter(
      (lp) => !lp.isBot && (gameOn || lp.id !== goneHostId)
    );
    if (!gameOn) {
      seatLedgerRef.current = seatLedgerRef.current.filter((entry) => entry.playerId !== goneHostId);
    }
    nextPlayerIdRef.current = Math.max(nextPlayerIdRef.current, ...lobby.map((l) => l.id + 1), 1);
    commitLobby(lobby, { countdownEndsAt: null });

    announceHostRef.current();

    if (gs && gameOn) {
      const players = gs.players
        .filter((p) => p.isHuman)
        .map((p) => ({ ...p, connected: present.has(p.id), hand: [] }));
      const remaining = getActivePlayers(players);
      if (remaining.length < MIN_PLAYERS) {
        const winner = [...remaining].sort((a, b) => b.score - a.score)[0] ?? null;
        const endedAt = Date.now();
        commitHostState({
          ...gs,
          players,
          phase: 'game-end',
          phaseId: `migration:game-end:${endedAt}`,
          phaseStartedAt: endedAt,
          phaseEndsAt: null,
          winnerIds: winner ? [winner.id] : [],
          winner,
          submissions: [],
          blackDeck: [],
          whiteDeck: [],
        });
      } else {
        // O pool do host antigo nunca foi enviado (anti-trapaça). Se ele não
        // estiver disponível, o novo host usa seu baralho local e recupera
        // também cartas próprias que já tinham aparecido na tela.
        const local = sanitizeCustomCards(customCardsRef.current);
        const visibleBlack = gs.blackCard?.id.startsWith('cb-') ? [gs.blackCard] : [];
        const visibleWhite = [
          ...gs.players.flatMap((p) => p.hand),
          ...gs.submissions.flatMap((s) => s.cards),
        ].filter((card) => card.id.startsWith('cw-'));
        const dedupe = <T extends { id: string }>(cards: T[]) =>
          [...new Map(cards.map((card) => [card.id, card])).values()];
        const blackPool = gs.blackPool?.length
          ? gs.blackPool
          : dedupe([...ALL_BLACK, ...local.black, ...visibleBlack]);
        const whitePool = gs.whitePool?.length
          ? gs.whitePool
          : dedupe([...ALL_WHITE, ...local.white, ...visibleWhite]);
        const recovered: GameState = {
          ...gs,
          players,
          blackPool,
          whitePool,
          blackDeck: shuffle(blackPool),
          whiteDeck: shuffle(whitePool),
        };

        // O ponto do round-end já foi aplicado. Avança o resultado real para
        // não repetir a mesma rodada — inclusive sentença final/morte súbita.
        if (gs.phase === 'round-end') {
          commitHostState(advanceToNextRound(recovered));
          return;
        }

        // Redistribui a rodada atual com baralhos novos.
        const mode = getGameMode(gs);
        const czarId = mode === 'democracy'
          ? -1
          : remaining.some((p) => p.id === gs.czarId)
            ? gs.czarId
            : remaining[0].id;
        const redealt: GameState = {
          ...recovered,
          mode,
          czarId,
          submissions: [],
          votes: [],
          votingOptions: [],
          votingRound: 1,
          tieBreak: false,
          roundWinnerId: null,
          winner: null,
          phase: 'submitting',
        };
        // Reaproveita init parcial: repõe mãos e tira carta preta nova.
        const withHands = advanceToNextRound({ ...redealt, round: redealt.round - 1, czarId });
        commitHostState({ ...withHands, czarId });
      }
    }
  }, [roomCode, pidKey, commitLobby, commitHostState]);

  useEffect(() => { maybePromoteSelfRef.current = maybePromoteSelf; }, [maybePromoteSelf]);

  // Transporte v2: o canal de controle só descobre a autoridade e negocia
  // credenciais. Todo conteúdo da mesa trafega em um canal cifrado por assento.
  useEffect(() => {
    if (!playerName) return;

    let disposed = false;
    let reconnectAttempts = 0;
    let reconnectStartedAt = 0;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let joinRetryTimer: ReturnType<typeof setInterval> | null = null;
    let joinTimeout: ReturnType<typeof setTimeout> | null = null;
    let connect: () => void = () => {};

    leavingRef.current = false;

    const clearJoinTimers = () => {
      if (joinRetryTimer) clearInterval(joinRetryTimer);
      if (joinTimeout) clearTimeout(joinTimeout);
      joinRetryTimer = null;
      joinTimeout = null;
    };

    const closeGuestPrivate = () => {
      const privateChannel = guestPrivateChannelRef.current;
      guestPrivateChannelRef.current = null;
      if (privateChannel) void supabase.removeChannel(privateChannel);
    };

    const closeAllHostPeers = () => {
      const peers = [...hostPeersRef.current.values()];
      hostPeersRef.current.clear();
      for (const peer of peers) void supabase.removeChannel(peer.channel);
    };

    const persistCredential = (credential: SeatCredential) => {
      credentialRef.current = credential;
      myPlayerIdRef.current = credential.playerId;
      setMyPlayerId(credential.playerId);
      const identity = encryptionIdentityRef.current;
      saveRoomSession(sessionStorage, sessionKey, roomCode, {
        ...credential,
        ...(identity ? { encryptionIdentity: identity.serialized } : {}),
      });
      try { sessionStorage.setItem(pidKey, String(credential.playerId)); } catch { /* melhor esforço */ }
    };

    const persistRoomContext = () => {
      saveRoomSession(sessionStorage, contextKey, roomCode, {
        hostId: hostIdRef.current,
        gameId: gameIdRef.current,
        seatLedger: seatLedgerRef.current,
      } satisfies StoredRoomContext);
    };

    const clearCredential = (clearContext = false) => {
      credentialRef.current = null;
      myPlayerIdRef.current = null;
      setMyPlayerId(null);
      clearRoomSession(sessionStorage, sessionKey);
      if (clearContext) clearRoomSession(sessionStorage, contextKey);
      try { sessionStorage.removeItem(pidKey); } catch { /* melhor esforço */ }
    };

    const hostHelloPayload = () => {
      const identity = encryptionIdentityRef.current;
      if (!identity) return null;
      return {
        hostId: hostIdRef.current,
        hostConnectionId: connectionIdRef.current,
        publicKey: identity.publicKey,
      };
    };

    const sendHostHello = (kind: 'host_hello' | 'host_changed' = 'host_hello') => {
      if (!isHostRef.current) return;
      const hello = hostHelloPayload();
      if (!hello) return;
      sendControl(kind, hello, lobbySeqRef.current);
    };

    const sendSecureControl = async (
      handshake: PendingHandshake,
      kind: 'welcome' | 'join_pending' | 'join_rejected',
      payload: unknown
    ) => {
      const identity = encryptionIdentityRef.current;
      if (!identity || !isHostRef.current) return false;
      const inner = createRoomEnvelope(kind, payload, {
        roomCode,
        gameId: gameIdRef.current,
        authorityEpoch: authorityEpochRef.current,
        hostId: hostIdRef.current,
        senderId: hostIdRef.current,
        senderConnectionId: connectionIdRef.current,
        revision: lobbySeqRef.current,
      });
      try {
        const encrypted = await encryptFor(identity, handshake.publicKey, inner);
        sendControl('secure_control', {
          targetClientId: handshake.clientId,
          targetConnectionId: handshake.connectionId,
          encrypted,
        }, lobbySeqRef.current);
        return true;
      } catch {
        return false;
      }
    };

    const acceptLobby = (envelope: RoomEnvelope) => {
      if (!isRecord(envelope.payload)) return;
      const payload = envelope.payload;
      if (!Array.isArray(payload.players) || !Number.isSafeInteger(payload.seq)) return;
      const validPlayers = payload.players.every((candidate) =>
        isRecord(candidate)
        && Number.isSafeInteger(candidate.id)
        && Number(candidate.id) >= 0
        && typeof candidate.name === 'string'
        && candidate.name.length >= 1
        && candidate.name.length <= 28
        && typeof candidate.ready === 'boolean'
      );
      if (!validPlayers || Number(payload.seq) <= lastLobbySeqRef.current) return;
      const normalizedPlayers = normalizeLobbyPlayers(payload.players as LobbyPlayer[]);
      const normalizedRules = normalizeLobbyRules(payload.rules);
      const normalizedCountdown = typeof payload.countdownEndsAt === 'number'
        && Number.isFinite(payload.countdownEndsAt)
        ? payload.countdownEndsAt
        : null;
      const ledger = normalizeSeatLedger(payload.seatLedger);

      lastLobbySeqRef.current = Number(payload.seq);
      lobbySeqRef.current = Math.max(lobbySeqRef.current, Number(payload.seq));
      lobbyPlayersRef.current = normalizedPlayers;
      lobbyRulesRef.current = normalizedRules;
      countdownEndsAtRef.current = normalizedCountdown;
      seatLedgerRef.current = ledger;
      persistRoomContext();
      setLobbyPlayers(normalizedPlayers);
      setLobbyRules(normalizedRules);
      setCountdownEndsAt(normalizedCountdown);
      const own = normalizedPlayers.find((player) => player.id === myPlayerIdRef.current);
      if (own) localAppearanceRef.current = own.appearance;
    };

    const acceptPrivateEnvelope = (envelope: RoomEnvelope) => {
      if (envelope.kind === 'lobby') {
        acceptLobby(envelope);
        return;
      }
      if (envelope.kind === 'game_state') {
        if (!isRecord(envelope.payload) || !isGameStateSnapshot(envelope.payload.state)) return;
        const state = envelope.payload.state;
        if ((state.stateRevision ?? -1) !== envelope.revision) return;
        const cursor = cursorFromEnvelope(envelope);
        if (!cursor || !shouldAcceptSnapshot(snapshotCursorRef.current, cursor)) return;
        snapshotCursorRef.current = cursor;
        gameIdRef.current = cursor.gameId;
        seatLedgerRef.current = normalizeSeatLedger(envelope.payload.seatLedger);
        persistRoomContext();
        gameStateRef.current = state;
        setGameState(state);
        return;
      }
      if (envelope.kind === 'chat') {
        if (!isRecord(envelope.payload)) return;
        const payload = envelope.payload;
        const text = normalizeRoomText(payload.text, 200);
        if (
          !isRoomId(payload.id)
          || !Number.isSafeInteger(payload.playerId)
          || typeof payload.name !== 'string'
          || payload.name.length > 28
          || typeof payload.ts !== 'number'
          || !text
        ) return;
        appendChat({
          id: payload.id,
          playerId: Number(payload.playerId),
          name: payload.name,
          text,
          ts: payload.ts,
        });
        return;
      }
      if (envelope.kind === 'reaction') {
        if (!isRecord(envelope.payload)) return;
        const payload = envelope.payload;
        const emoji = normalizeReaction(payload.emoji);
        if (
          !isRoomId(payload.id)
          || !Number.isSafeInteger(payload.playerId)
          || typeof payload.name !== 'string'
          || payload.name.length > 28
          || typeof payload.ts !== 'number'
          || !emoji
        ) return;
        appendReaction({
          id: payload.id,
          playerId: Number(payload.playerId),
          name: payload.name,
          emoji,
          ts: payload.ts,
        });
        return;
      }
      if (envelope.kind === 'kicked') {
        clearCredential(true);
        closeGuestPrivate();
        setWasKicked(true);
      }
    };

    const installGuestSender = () => {
      sendSecureRequestRef.current = async (request: SecureClientRequest) => {
        const identity = encryptionIdentityRef.current;
        const hostPublicKey = hostPublicKeyRef.current;
        const credential = credentialRef.current;
        const privateChannel = guestPrivateChannelRef.current;
        if (
          !identity
          || !hostPublicKey
          || !credential
          || !privateChannel
          || (leavingRef.current && request.type !== 'leave')
        ) {
          return false;
        }
        const authenticated: AuthenticatedRequest = {
          requestId: createRoomId('request'),
          token: credential.token,
          request,
        };
        const envelope = createRoomEnvelope('client_request', authenticated, {
          roomCode,
          gameId: gameIdRef.current,
          authorityEpoch: authorityEpochRef.current,
          hostId: hostIdRef.current,
          senderId: credential.playerId,
          senderConnectionId: connectionIdRef.current,
        });
        try {
          const encrypted = await encryptFor(identity, hostPublicKey, envelope);
          const status = await privateChannel.send({
            type: 'broadcast',
            event: 'secure',
            payload: encrypted,
          });
          return status === 'ok';
        } catch {
          return false;
        }
      };
    };

    const openGuestPrivate = async (welcome: ReturnType<typeof parseSecureWelcome>) => {
      if (!welcome || disposed || isHostRef.current) return;
      if (
        welcome.clientId !== clientIdRef.current
        || welcome.connectionId !== connectionIdRef.current
        || welcome.authorityEpoch !== authorityEpochRef.current
        || welcome.hostConnectionId !== hostConnectionIdRef.current
        || !welcome.privateTopic.startsWith('spv2-')
      ) return;

      closeGuestPrivate();
      const identity = encryptionIdentityRef.current;
      const hostPublicKey = hostPublicKeyRef.current;
      if (!identity || !hostPublicKey) return;

      const privateChannel = supabase.channel(welcome.privateTopic);
      guestPrivateChannelRef.current = privateChannel;
      privateChannel
        .on('broadcast', { event: 'secure' }, ({ payload }) => {
          if (guestPrivateChannelRef.current !== privateChannel || !isEncryptedMessage(payload)) return;
          void decryptFrom(identity, hostPublicKey, payload)
            .then((value) => parseRoomEnvelope(value, {
              roomCode,
              authorityEpoch: authorityEpochRef.current,
              hostId: hostIdRef.current,
              senderId: hostIdRef.current,
              senderConnectionId: hostConnectionIdRef.current,
              kinds: ['lobby', 'game_state', 'chat', 'reaction', 'kicked'],
            }))
            .then((envelope) => { if (envelope) acceptPrivateEnvelope(envelope); })
            .catch(() => {});
        })
        .subscribe((status) => {
          if (guestPrivateChannelRef.current !== privateChannel || disposed) return;
          if (status === 'SUBSCRIBED') {
            seatLedgerRef.current = welcome.seatLedger;
            persistCredential({ playerId: welcome.playerId, token: welcome.token });
            persistRoomContext();
            setAwaitingApproval(false);
            setJoinRejected(false);
            clearJoinTimers();
            installGuestSender();
            setIsConnected(true);
            setError(null);
            void trackPresence(channelRef.current ?? privateChannel, {
              playerId: welcome.playerId,
              clientId: clientIdRef.current,
              connectionId: connectionIdRef.current,
              name: playerName,
              appearance: localAppearanceRef.current,
            });
            void sendSecureRequestRef.current({ type: 'request_state' });
            return;
          }
          if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
            guestPrivateChannelRef.current = null;
            setIsConnected(false);
            void supabase.removeChannel(privateChannel);
            window.setTimeout(() => {
              if (!disposed && !leavingRef.current) sendRaw('host_probe', {
                roomCode,
                clientId: clientIdRef.current,
                connectionId: connectionIdRef.current,
              });
            }, 500);
          }
        });
    };

    const issueWelcome = async (
      handshake: PendingHandshake,
      playerId: number,
      suppliedToken?: string
    ) => {
      const identity = encryptionIdentityRef.current;
      if (!identity || disposed || !isHostRef.current) return false;
      const token = suppliedToken ?? createSeatToken();
      const tokenHash = await hashSeatToken(token);
      const knownEntry = seatLedgerRef.current.find((entry) => entry.playerId === playerId);
      const knownHash = knownEntry?.tokenHash;
      if (knownHash && knownHash !== tokenHash) return false;
      // Uma reconexão autenticada pode girar sua chave ECDH. Para conexões
      // normais ela permanece estável no sessionStorage e ancora a eleição.
      seatLedgerRef.current = [
        ...seatLedgerRef.current.filter((entry) => entry.playerId !== playerId),
        { playerId, tokenHash, publicKey: handshake.publicKey },
      ];

      closeHostPeer(playerId);
      const privateTopic = createRoomId(`spv2-${roomCode}-seat`);
      const privateChannel = supabase.channel(privateTopic);
      const peer: HostPeer = {
        playerId,
        clientId: handshake.clientId,
        connectionId: handshake.connectionId,
        publicKey: handshake.publicKey,
        token,
        privateTopic,
        channel: privateChannel,
      };

      privateChannel.on('broadcast', { event: 'secure' }, ({ payload }) => {
        if (hostPeersRef.current.get(playerId)?.channel !== privateChannel) return;
        if (!isEncryptedMessage(payload)) return;
        void decryptFrom(identity, handshake.publicKey, payload)
          .then((value) => parseRoomEnvelope(value, {
            roomCode,
            authorityEpoch: authorityEpochRef.current,
            hostId: hostIdRef.current,
            senderId: playerId,
            senderConnectionId: handshake.connectionId,
            kinds: ['client_request'],
          }))
          .then((envelope) => {
            if (!envelope) return;
            if (
              envelope.gameId !== null
              && gameIdRef.current !== null
              && envelope.gameId !== gameIdRef.current
            ) return;
            const request = parseAuthenticatedRequest(envelope.payload);
            if (request) applyAuthenticatedRequest(peer, request);
          })
          .catch(() => {});
      });

      const subscribed = await new Promise<boolean>((resolve) => {
        let settled = false;
        const settle = (result: boolean) => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          resolve(result);
        };
        const timeout = setTimeout(() => settle(false), PRIVATE_SUBSCRIBE_TIMEOUT_MS);
        privateChannel.subscribe((status) => {
          if (status === 'SUBSCRIBED') settle(true);
          if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
            settle(false);
          }
        });
      });
      if (!subscribed || disposed || !isHostRef.current) {
        void supabase.removeChannel(privateChannel);
        return false;
      }

      hostPeersRef.current.set(playerId, peer);
      const welcome = {
        playerId,
        token,
        clientId: handshake.clientId,
        connectionId: handshake.connectionId,
        authorityEpoch: authorityEpochRef.current,
        hostConnectionId: connectionIdRef.current,
        privateTopic,
        seatLedger: seatLedgerRef.current,
      };
      if (!await sendSecureControl(handshake, 'welcome', welcome)) {
        closeHostPeer(playerId);
        return false;
      }

      clientPlayerMapRef.current.set(handshake.clientId, playerId);
      pendingHandshakesRef.current.delete(handshake.clientId);
      cancelDisconnectTimer(playerId);
      setPlayerConnected(playerId, true);
      persistHostLobby();
      broadcastLobby(lobbyPlayersRef.current);
      const current = hostGameRef.current;
      if (current) {
        void sendPrivateToPeer(peer, 'game_state', {
          state: redactStateFor(current, playerId),
          seatLedger: seatLedgerRef.current,
        } satisfies PrivateStatePayload, current.stateRevision ?? 0);
      }
      return true;
    };

    issueWelcomeRef.current = issueWelcome;
    sendJoinStatusRef.current = async (targetClientId, kind, reason) => {
      const handshake = pendingHandshakesRef.current.get(targetClientId);
      if (!handshake) return;
      await sendSecureControl(handshake, kind, {
        clientId: targetClientId,
        connectionId: handshake.connectionId,
        reason,
      });
    };
    announceHostRef.current = () => {
      sendHostHello('host_changed');
      sendHostHello('host_hello');
      broadcastLobby(lobbyPlayersRef.current);
      if (hostGameRef.current) broadcastState(hostGameRef.current);
      if (heartbeatRef.current) clearInterval(heartbeatRef.current);
      heartbeatRef.current = setInterval(() => sendHostHello(), CONTROL_HEARTBEAT_MS);
    };

    const sendJoinOrResume = async () => {
      if (disposed || isHostRef.current || guestPrivateChannelRef.current) return;
      const identity = encryptionIdentityRef.current;
      const hostPublicKey = hostPublicKeyRef.current;
      if (!identity || !hostPublicKey || !isRoomId(authorityEpochRef.current)) return;
      const credential = credentialRef.current;
      if (credential) {
        const proof = {
          ...credential,
          clientId: clientIdRef.current,
          connectionId: connectionIdRef.current,
          authorityEpoch: authorityEpochRef.current,
        };
        try {
          const encrypted = await encryptFor(identity, hostPublicKey, proof);
          sendControl('resume_request', {
            clientId: clientIdRef.current,
            connectionId: connectionIdRef.current,
            publicKey: identity.publicKey,
            encrypted,
          });
        } catch {
          setError('Este navegador não conseguiu proteger a sessão da sala.');
        }
        return;
      }
      sendControl('join_request', {
        clientId: clientIdRef.current,
        connectionId: connectionIdRef.current,
        name: playerName,
        appearance: localAppearanceRef.current,
        publicKey: identity.publicKey,
      });
    };

    const startJoinRetries = () => {
      if (isHostRef.current || guestPrivateChannelRef.current) return;
      void sendJoinOrResume();
      if (!joinRetryTimer) {
        joinRetryTimer = setInterval(() => { void sendJoinOrResume(); }, 2500);
      }
      if (!joinTimeout) {
        joinTimeout = setTimeout(() => {
          if (!guestPrivateChannelRef.current && !awaitingApprovalRef.current) {
            setError('A sala não respondeu ainda. Continuo tentando reconectar…');
          }
        }, 30000);
      }
    };

    const handleJoinRequest = async (envelope: RoomEnvelope) => {
      if (!isHostRef.current) return;
      const request = parseJoinRequest(envelope.payload);
      if (!request || envelope.senderConnectionId !== request.connectionId || envelope.senderId !== 0) return;
      pendingHandshakesRef.current.set(request.clientId, request);

      const existingId = clientPlayerMapRef.current.get(request.clientId);
      if (existingId !== undefined) {
        const existingPeer = hostPeersRef.current.get(existingId);
        if (existingPeer) await issueWelcome(request, existingId, existingPeer.token);
        return;
      }

      const game = hostGameRef.current;
      const gameOn = !!game && game.phase !== 'setup' && game.phase !== 'game-end';
      if (!hasAvailableSeat(lobbyPlayersRef.current.length)) {
        await sendJoinStatusRef.current(request.clientId, 'join_rejected', 'room_full');
        return;
      }
      if (gameOn) {
        setPendingJoins((previous) => previous.some((item) => item.clientId === request.clientId)
          ? previous
          : [...previous, {
              clientId: request.clientId,
              name: request.name,
              appearance: request.appearance,
            }]);
        await sendJoinStatusRef.current(request.clientId, 'join_pending');
        return;
      }

      const playerId = nextPlayerIdRef.current++;
      const token = createSeatToken();
      const tokenHash = await hashSeatToken(token);
      seatLedgerRef.current = [
        ...seatLedgerRef.current,
        { playerId, tokenHash, publicKey: request.publicKey },
      ];
      clientPlayerMapRef.current.set(request.clientId, playerId);
      const newcomer = normalizeLobbyPlayer({
        id: playerId,
        name: request.name,
        ready: false,
        appearance: request.appearance,
      });
      commitLobby([...lobbyPlayersRef.current, newcomer], { countdownEndsAt: null });
      const accepted = await issueWelcome(request, playerId, token);
      if (!accepted) {
        clientPlayerMapRef.current.delete(request.clientId);
        seatLedgerRef.current = seatLedgerRef.current.filter((entry) => entry.playerId !== playerId);
        commitLobby(lobbyPlayersRef.current.filter((player) => player.id !== playerId), {
          countdownEndsAt: null,
        });
      }
    };

    const handleResumeRequest = async (envelope: RoomEnvelope) => {
      if (!isHostRef.current) return;
      const request = parseResumeRequest(envelope.payload);
      const identity = encryptionIdentityRef.current;
      if (!request || !identity || envelope.senderConnectionId !== request.connectionId) return;
      let proof: ReturnType<typeof parseResumeProof> = null;
      try {
        proof = parseResumeProof(await decryptFrom(identity, request.publicKey, request.encrypted));
      } catch {
        return;
      }
      if (
        !proof
        || proof.clientId !== request.clientId
        || proof.connectionId !== request.connectionId
        || proof.authorityEpoch !== authorityEpochRef.current
        || envelope.senderId !== proof.playerId
      ) return;

      const gamePlayer = hostGameRef.current?.players.find((player) =>
        player.id === proof!.playerId && player.isHuman && !player.eliminated
      );
      const lobbyPlayer = lobbyPlayersRef.current.find((player) => player.id === proof!.playerId);
      const credentialIsValid = await verifySeatToken(
        proof.playerId,
        proof.token,
        seatLedgerRef.current
      );
      if (!credentialIsValid || (!gamePlayer && !lobbyPlayer)) {
        const fallback: PendingHandshake = {
          clientId: request.clientId,
          connectionId: request.connectionId,
          publicKey: request.publicKey,
          name: lobbyPlayer?.name ?? gamePlayer?.name ?? playerName,
          appearance: lobbyPlayer?.appearance
            ?? gamePlayer?.appearance
            ?? localAppearanceRef.current,
        };
        pendingHandshakesRef.current.set(request.clientId, fallback);
        await sendJoinStatusRef.current(request.clientId, 'join_rejected', 'session_invalid');
        return;
      }

      const handshake: PendingHandshake = {
        clientId: request.clientId,
        connectionId: request.connectionId,
        publicKey: request.publicKey,
        name: lobbyPlayer?.name ?? gamePlayer!.name,
        appearance: lobbyPlayer?.appearance
          ?? gamePlayer?.appearance
          ?? localAppearanceRef.current,
      };
      pendingHandshakesRef.current.set(request.clientId, handshake);
      clientPlayerMapRef.current.set(request.clientId, proof.playerId);
      if (!lobbyPlayer && gamePlayer) {
        commitLobby([
          ...lobbyPlayersRef.current,
          normalizeLobbyPlayer({
            id: gamePlayer.id,
            name: gamePlayer.name,
            ready: false,
            appearance: gamePlayer.appearance,
          }),
        ].sort((left, right) => left.id - right.id), { countdownEndsAt: null });
      }
      await issueWelcome(handshake, proof.playerId, proof.token);
    };

    const adoptAuthority = (
      envelope: RoomEnvelope,
      hello: NonNullable<ReturnType<typeof parseHostHello>>
    ) => {
      const authorityChanged = envelope.authorityEpoch !== authorityEpochRef.current
        || hello.hostConnectionId !== hostConnectionIdRef.current
        || hello.hostId !== hostIdRef.current;
      if (authorityChanged) {
        closeGuestPrivate();
        snapshotCursorRef.current = null;
      }
      pendingAuthorityRef.current = null;
      authorityEpochRef.current = envelope.authorityEpoch;
      hostIdRef.current = hello.hostId;
      hostConnectionIdRef.current = hello.hostConnectionId;
      hostPublicKeyRef.current = hello.publicKey;
      if (envelope.gameId) gameIdRef.current = envelope.gameId;
      setHostId(hello.hostId);
      persistRoomContext();

      if (isHostRef.current && hello.hostId !== myPlayerIdRef.current) {
        isHostRef.current = false;
        setIsHost(false);
        closeAllHostPeers();
        clearBotTimers();
        if (heartbeatRef.current) clearInterval(heartbeatRef.current);
        heartbeatRef.current = null;
        try { sessionStorage.removeItem('sp-host-room'); } catch { /* melhor esforço */ }
      }
      startJoinRetries();
      return true;
    };

    const challengeAuthority = async (
      envelope: RoomEnvelope,
      hello: NonNullable<ReturnType<typeof parseHostHello>>
    ) => {
      const identity = encryptionIdentityRef.current;
      if (!identity || disposed) return false;
      const currentChallenge = pendingAuthorityRef.current;
      if (
        currentChallenge
        && currentChallenge.envelope.authorityEpoch === envelope.authorityEpoch
        && currentChallenge.hello.hostId === hello.hostId
        && currentChallenge.hello.hostConnectionId === hello.hostConnectionId
        && samePublicKey(currentChallenge.hello.publicKey, hello.publicKey)
        && Date.now() - currentChallenge.challengedAt < 2_000
      ) return true;

      const challengeNonce = createRoomId('challenge');
      const claim = {
        nonce: challengeNonce,
        targetHostId: hello.hostId,
        authorityEpoch: envelope.authorityEpoch,
        hostConnectionId: hello.hostConnectionId,
        clientId: clientIdRef.current,
        connectionId: connectionIdRef.current,
      };
      try {
        const encrypted = await encryptFor(identity, hello.publicKey, claim);
        if (disposed) return false;
        pendingAuthorityRef.current = {
          envelope,
          hello,
          challengeNonce,
          challengedAt: Date.now(),
        };
        const challengeEnvelope = createRoomEnvelope('host_challenge', {
          targetHostId: hello.hostId,
          clientId: clientIdRef.current,
          connectionId: connectionIdRef.current,
          publicKey: identity.publicKey,
          encrypted,
        }, {
          roomCode,
          gameId: envelope.gameId,
          authorityEpoch: envelope.authorityEpoch,
          hostId: hello.hostId,
          senderId: credentialRef.current?.playerId ?? 0,
          senderConnectionId: connectionIdRef.current,
          revision: envelope.revision,
        });
        sendRaw('room', challengeEnvelope);
        window.setTimeout(() => {
          if (
            disposed
            || pendingAuthorityRef.current?.challengeNonce !== challengeNonce
          ) return;
          pendingAuthorityRef.current = null;
          sendRaw('host_probe', {
            roomCode,
            clientId: clientIdRef.current,
            connectionId: connectionIdRef.current,
          });
        }, 2_500);
        return true;
      } catch {
        return false;
      }
    };

    const acceptAuthority = (envelope: RoomEnvelope) => {
      const hello = parseHostHello(envelope.payload);
      if (
        !hello
        || hello.hostId !== envelope.hostId
        || hello.hostId !== envelope.senderId
        || hello.hostConnectionId !== envelope.senderConnectionId
      ) return false;
      if (isHostRef.current && hello.hostId === hostIdRef.current) return false;

      const alreadyAccepted = envelope.authorityEpoch === authorityEpochRef.current
        && hello.hostId === hostIdRef.current
        && hello.hostConnectionId === hostConnectionIdRef.current
        && samePublicKey(hello.publicKey, hostPublicKeyRef.current);
      if (alreadyAccepted) {
        startJoinRetries();
        return true;
      }

      const knownHost = lobbyPlayersRef.current.some((player) => player.id === hello.hostId);
      const mayAdopt = authorityEpochRef.current === 'authority-pending'
        || myPlayerIdRef.current === null
        || hello.hostId === hostIdRef.current
        || (envelope.kind === 'host_changed' && knownHost);
      if (!mayAdopt) return false;

      const anchoredPublicKey = seatLedgerRef.current.find(
        (entry) => entry.playerId === hello.hostId
      )?.publicKey;
      if (anchoredPublicKey && !samePublicKey(anchoredPublicKey, hello.publicKey)) return false;

      // A primeira entrada na sala ainda depende do código compartilhado. Depois
      // das boas-vindas, cada assento recebe as chaves públicas da mesa e toda
      // troca/reconexão de host precisa provar posse da chave privada ancorada.
      if (!anchoredPublicKey) return adoptAuthority(envelope, hello);
      void challengeAuthority(envelope, hello);
      return true;
    };

    const handleHostChallenge = async (envelope: RoomEnvelope) => {
      if (
        !isHostRef.current
        || envelope.authorityEpoch !== authorityEpochRef.current
        || envelope.hostId !== hostIdRef.current
      ) return;
      const request = parseHostChallenge(envelope.payload);
      const identity = encryptionIdentityRef.current;
      if (
        !request
        || !identity
        || request.targetHostId !== hostIdRef.current
        || request.connectionId !== envelope.senderConnectionId
      ) return;
      let claim: ReturnType<typeof parseHostChallengeClaim> = null;
      try {
        claim = parseHostChallengeClaim(await decryptFrom(identity, request.publicKey, request.encrypted));
      } catch {
        return;
      }
      if (
        !claim
        || claim.targetHostId !== hostIdRef.current
        || claim.authorityEpoch !== authorityEpochRef.current
        || claim.hostConnectionId !== connectionIdRef.current
        || claim.clientId !== request.clientId
        || claim.connectionId !== request.connectionId
      ) return;
      const proof = {
        ...claim,
        hostId: hostIdRef.current,
        targetClientId: request.clientId,
        targetConnectionId: request.connectionId,
      };
      try {
        const encrypted = await encryptFor(identity, request.publicKey, proof);
        sendControl('host_proof', {
          targetClientId: request.clientId,
          targetConnectionId: request.connectionId,
          encrypted,
        }, envelope.revision, envelope.gameId);
      } catch {
        // O próximo heartbeat permite ao convidado repetir o desafio.
      }
    };

    const handleHostProof = async (envelope: RoomEnvelope) => {
      if (!isRecord(envelope.payload)) return;
      const pending = pendingAuthorityRef.current;
      const identity = encryptionIdentityRef.current;
      if (
        !pending
        || !identity
        || envelope.payload.targetClientId !== clientIdRef.current
        || envelope.payload.targetConnectionId !== connectionIdRef.current
        || !isEncryptedMessage(envelope.payload.encrypted)
        || envelope.authorityEpoch !== pending.envelope.authorityEpoch
        || envelope.hostId !== pending.hello.hostId
        || envelope.senderId !== pending.hello.hostId
        || envelope.senderConnectionId !== pending.hello.hostConnectionId
      ) return;
      let proof: ReturnType<typeof parseHostProof> = null;
      try {
        proof = parseHostProof(await decryptFrom(
          identity,
          pending.hello.publicKey,
          envelope.payload.encrypted
        ));
      } catch {
        return;
      }
      if (
        !proof
        || proof.nonce !== pending.challengeNonce
        || proof.hostId !== pending.hello.hostId
        || proof.targetHostId !== pending.hello.hostId
        || proof.authorityEpoch !== pending.envelope.authorityEpoch
        || proof.hostConnectionId !== pending.hello.hostConnectionId
        || proof.clientId !== clientIdRef.current
        || proof.connectionId !== connectionIdRef.current
        || proof.targetClientId !== clientIdRef.current
        || proof.targetConnectionId !== connectionIdRef.current
      ) return;
      adoptAuthority(pending.envelope, pending.hello);
    };

    const handleSecureControl = async (envelope: RoomEnvelope) => {
      if (isHostRef.current || !isRecord(envelope.payload)) return;
      if (
        envelope.payload.targetClientId !== clientIdRef.current
        || envelope.payload.targetConnectionId !== connectionIdRef.current
        || !isEncryptedMessage(envelope.payload.encrypted)
      ) return;
      const identity = encryptionIdentityRef.current;
      const hostPublicKey = hostPublicKeyRef.current;
      if (!identity || !hostPublicKey) return;
      let inner: RoomEnvelope | null = null;
      try {
        inner = parseRoomEnvelope(await decryptFrom(identity, hostPublicKey, envelope.payload.encrypted), {
          roomCode,
          authorityEpoch: authorityEpochRef.current,
          hostId: hostIdRef.current,
          senderId: hostIdRef.current,
          senderConnectionId: hostConnectionIdRef.current,
          kinds: ['welcome', 'join_pending', 'join_rejected'],
        });
      } catch {
        return;
      }
      if (!inner || !isRecord(inner.payload)) return;
      if (inner.kind === 'join_pending') {
        setAwaitingApproval(true);
        clearJoinTimers();
        return;
      }
      if (inner.kind === 'join_rejected') {
        const reason = inner.payload.reason;
        setAwaitingApproval(false);
        if (reason === 'session_invalid') {
          clearCredential();
          gameStateRef.current = null;
          setGameState(null);
          void sendJoinOrResume();
          return;
        }
        setJoinRejected(true);
        clearJoinTimers();
        return;
      }
      const welcome = parseSecureWelcome(inner.payload);
      if (welcome) await openGuestPrivate(welcome);
    };

    const handleControlEnvelope = (value: unknown) => {
      const envelope = parseRoomEnvelope(value, { roomCode });
      if (!envelope) return;
      if (envelope.kind === 'host_hello' || envelope.kind === 'host_changed') {
        acceptAuthority(envelope);
        return;
      }
      if (envelope.kind === 'host_challenge') {
        void handleHostChallenge(envelope);
        return;
      }
      if (envelope.kind === 'host_proof') {
        void handleHostProof(envelope);
        return;
      }
      const fromCurrentHost = parseRoomEnvelope(value, {
        roomCode,
        authorityEpoch: authorityEpochRef.current,
        hostId: hostIdRef.current,
      });
      if (envelope.kind === 'secure_control') {
        if (fromCurrentHost) void handleSecureControl(fromCurrentHost);
        return;
      }
      if (!isHostRef.current) return;
      const forCurrentAuthority = parseRoomEnvelope(value, {
        roomCode,
        authorityEpoch: authorityEpochRef.current,
        hostId: hostIdRef.current,
        kinds: ['join_request', 'resume_request'],
      });
      if (!forCurrentAuthority) return;
      if (forCurrentAuthority.kind === 'join_request') void handleJoinRequest(forCurrentAuthority);
      if (forCurrentAuthority.kind === 'resume_request') void handleResumeRequest(forCurrentAuthority);
    };

    const scheduleReconnect = () => {
      if (disposed || leavingRef.current || reconnectTimer) return;
      reconnectAttempts += 1;
      if (!reconnectStartedAt) reconnectStartedAt = Date.now();
      if (Date.now() - reconnectStartedAt >= RECONNECT_GIVE_UP_MS) {
        setError('A conexão está instável, mas a mesa continua tentando te trazer de volta…');
      }
      const delay = Math.min(750 * 2 ** Math.min(reconnectAttempts - 1, 4), 10_000);
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        connect();
      }, delay);
    };

    connect = () => {
      if (disposed || leavingRef.current) return;
      const previous = channelRef.current;
      if (previous) void supabase.removeChannel(previous);
      closeGuestPrivate();
      if (isHostRef.current) closeAllHostPeers();

      const channel = supabase.channel(`spv2-${roomCode}-control`, {
        config: { presence: { key: connectionIdRef.current } },
      });
      channelRef.current = channel;
      channel
        .on('broadcast', { event: 'host_probe' }, ({ payload }) => {
          if (!isHostRef.current || leavingRef.current || !isRecord(payload)) return;
          if (
            String(payload.roomCode).toUpperCase() !== roomCode.toUpperCase()
            || !isRoomId(payload.connectionId)
          ) return;
          sendHostHello();
        })
        .on('broadcast', { event: 'room' }, ({ payload }) => {
          handleControlEnvelope(payload);
        })
        .on('presence', { event: 'leave' }, ({ leftPresences }) => {
          for (const rawPresence of leftPresences) {
            const presence = rawPresence as unknown as { playerId?: number };
            if (!Number.isSafeInteger(presence.playerId)) continue;
            const playerId = Number(presence.playerId);
            if (!isHostRef.current) {
              if (playerId !== hostIdRef.current) continue;
              cancelDisconnectTimer(playerId);
              const timer = setTimeout(() => {
                disconnectTimersRef.current.delete(playerId);
                if (!isPlayerPresent(playerId)) maybePromoteSelfRef.current(playerId);
              }, DISCONNECT_GRACE_MS);
              disconnectTimersRef.current.set(playerId, timer);
              continue;
            }
            if (playerId === hostIdRef.current) continue;
            cancelDisconnectTimer(playerId);
            const timer = setTimeout(() => {
              disconnectTimersRef.current.delete(playerId);
              if (isPlayerPresent(playerId)) return;
              const current = hostGameRef.current;
              if (current && current.phase !== 'setup' && current.phase !== 'game-end') {
                setPlayerConnected(playerId, false);
                return;
              }
              // No lobby o assento permanece reservado para a credencial; só
              // saída voluntária ou kick o libera. Uma oscilação não apaga ninguém.
              const markedUnready = lobbyPlayersRef.current.map((player) =>
                player.id === playerId && !player.isBot ? { ...player, ready: false } : player
              );
              commitLobby(markedUnready, { countdownEndsAt: null });
            }, DISCONNECT_GRACE_MS);
            disconnectTimersRef.current.set(playerId, timer);
          }
        })
        .on('presence', { event: 'join' }, ({ newPresences }) => {
          for (const rawPresence of newPresences) {
            const presence = rawPresence as unknown as { playerId?: number };
            if (!Number.isSafeInteger(presence.playerId)) continue;
            const playerId = Number(presence.playerId);
            cancelDisconnectTimer(playerId);
            if (isHostRef.current && playerId !== hostIdRef.current) {
              setPlayerConnected(playerId, true);
            }
          }
        })
        .subscribe((status) => {
          if (channelRef.current !== channel || disposed) return;
          const outcome = channelStatusOutcome(status, !leavingRef.current);
          if (outcome === 'subscribed') {
            reconnectAttempts = 0;
            reconnectStartedAt = 0;
            setError(null);
            if (isHostRef.current) {
              setIsConnected(true);
              void trackPresence(channel, {
                playerId: hostIdRef.current,
                clientId: clientIdRef.current,
                connectionId: connectionIdRef.current,
                name: playerName,
                appearance: localAppearanceRef.current,
              });
              sendHostHello();
              broadcastLobby(lobbyPlayersRef.current);
              if (hostGameRef.current) {
                broadcastState(hostGameRef.current);
                scheduleBotRef.current(hostGameRef.current);
              }
              if (heartbeatRef.current) clearInterval(heartbeatRef.current);
              heartbeatRef.current = setInterval(() => sendHostHello(), CONTROL_HEARTBEAT_MS);
            } else {
              setIsConnected(false);
              void trackPresence(channel, {
                clientId: clientIdRef.current,
                connectionId: connectionIdRef.current,
                name: playerName,
              });
              sendRaw('host_probe', {
                roomCode,
                clientId: clientIdRef.current,
                connectionId: connectionIdRef.current,
              });
            }
            return;
          }
          if (outcome === 'reconnect') {
            setIsConnected(false);
            clearJoinTimers();
            closeGuestPrivate();
            if (isHostRef.current) closeAllHostPeers();
            if (heartbeatRef.current) clearInterval(heartbeatRef.current);
            heartbeatRef.current = null;
            channelRef.current = null;
            void supabase.removeChannel(channel);
            scheduleReconnect();
          }
        });
    };

    const start = async () => {
      try {
        let identity = encryptionIdentityRef.current;
        if (!identity && restoredEncryptionIdentity) {
          try {
            identity = await importEncryptionIdentity(restoredEncryptionIdentity);
          } catch {
            // Sessão antiga ou chave rejeitada pelo navegador: a credencial de
            // assento ainda permite autenticar e registrar uma chave nova.
          }
        }
        identity ??= await createEncryptionIdentity();
        if (disposed) return;
        encryptionIdentityRef.current = identity;
        if (isHostRef.current) {
          hostPublicKeyRef.current = identity.publicKey;
          hostConnectionIdRef.current = connectionIdRef.current;
          let credential = credentialRef.current;
          if (!credential || credential.playerId !== hostIdRef.current) {
            credential = { playerId: hostIdRef.current, token: createSeatToken() };
          }
          persistCredential(credential);
          const tokenHash = await hashSeatToken(credential.token);
          seatLedgerRef.current = [
            ...seatLedgerRef.current.filter((entry) => entry.playerId !== credential!.playerId),
            { playerId: credential.playerId, tokenHash, publicKey: identity.publicKey },
          ];
          persistHostLobby();
        }
        installGuestSender();
        connect();
      } catch {
        setError('Criptografia segura indisponível neste navegador.');
      }
    };
    void start();

    const reconnectNow = () => {
      if (disposed || leavingRef.current || document.visibilityState !== 'visible') return;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      reconnectAttempts = 0;
      connect();
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible' && !isConnectedRef.current) reconnectNow();
    };
    window.addEventListener('online', reconnectNow);
    document.addEventListener('visibilitychange', onVisible);

    const timersAtSetup = disconnectTimersRef.current;
    return () => {
      disposed = true;
      window.removeEventListener('online', reconnectNow);
      document.removeEventListener('visibilitychange', onVisible);
      clearJoinTimers();
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (heartbeatRef.current) clearInterval(heartbeatRef.current);
      heartbeatRef.current = null;
      sendSecureRequestRef.current = async () => false;
      issueWelcomeRef.current = async () => false;
      sendJoinStatusRef.current = async () => {};
      announceHostRef.current = () => {};
      pendingAuthorityRef.current = null;
      closeGuestPrivate();
      closeAllHostPeers();
      for (const timer of timersAtSetup.values()) clearTimeout(timer);
      timersAtSetup.clear();
      const channel = channelRef.current;
      channelRef.current = null;
      if (channel) void supabase.removeChannel(channel);
    };
  }, [
    appendChat,
    appendReaction,
    applyAuthenticatedRequest,
    broadcastLobby,
    broadcastState,
    cancelDisconnectTimer,
    clearBotTimers,
    closeHostPeer,
    commitLobby,
    contextKey,
    isPlayerPresent,
    persistHostLobby,
    pidKey,
    playerName,
    roomCode,
    restoredEncryptionIdentity,
    sendControl,
    sendPrivateToPeer,
    sendRaw,
    sessionKey,
    setPlayerConnected,
  ]);

  const sendChat = useCallback((text: string) => {
    const playerId = myPlayerIdRef.current;
    if (playerId === null) return;
    if (isHostRef.current) publishChat(playerId, text);
    else void sendSecureRequestRef.current({ type: 'chat', text });
  }, [publishChat]);

  const sendReaction = useCallback((emoji: string) => {
    const playerId = myPlayerIdRef.current;
    if (playerId === null) return;
    if (isHostRef.current) publishReaction(playerId, emoji);
    else void sendSecureRequestRef.current({ type: 'reaction', emoji });
  }, [publishReaction]);

  const sendAction = useCallback((action: PlayerAction) => {
    if (isHostRef.current) {
      applyHostAction(action, myPlayerIdRef.current ?? 0);
    } else {
      void sendSecureRequestRef.current({ type: 'action', action });
    }
  }, [applyHostAction]);

  // Bots existem só no lobby do host; entram no jogo como assentos normais.
  const addBot = useCallback(() => {
    if (!isHostRef.current || hostGameRef.current) return;
    if (!hasAvailableSeat(lobbyPlayersRef.current.length)) return;
    const bots = lobbyPlayersRef.current.filter((p) => p.isBot);
    if (bots.length >= BOT_NAMES.length) return;
    const name = BOT_NAMES.find(
      (n) => !lobbyPlayersRef.current.some((p) => p.name === n)
    ) ?? `Bot ${bots.length + 1}`;
    const occupiedIds = new Set(lobbyPlayersRef.current.map((player) => player.id));
    let id = BOT_ID_BASE;
    while (occupiedIds.has(id)) id++;
    const updated = [...lobbyPlayersRef.current, normalizeLobbyPlayer({
      id,
      name,
      isBot: true,
      ready: true,
      appearance: appearanceForId(id),
    })];
    commitLobby(updated, { countdownEndsAt: null });
  }, [commitLobby]);

  const removeBot = useCallback((botId: number) => {
    if (!isHostRef.current || hostGameRef.current) return;
    const updated = lobbyPlayersRef.current.filter((p) => p.id !== botId);
    if (updated.length === lobbyPlayersRef.current.length) return;
    commitLobby(updated, { countdownEndsAt: null });
  }, [commitLobby]);

  const setReady = useCallback((ready: boolean) => {
    const playerId = myPlayerIdRef.current;
    if (playerId === null || hostGameRef.current) return;
    if (isHostRef.current) {
      applyLobbyReady(playerId, ready);
      return;
    }
    // Eco local: o selo acende no clique. O broadcast do host continua sendo a
    // verdade e corrige logo em seguida — sem isso, um pedido recusado deixa o
    // convidado apertando um botão que nunca reage.
    setLobbyPlayers((prev) => prev.map((player) => player.id === playerId
      ? { ...player, ready }
      : player));
    void sendSecureRequestRef.current({
      type: 'ready',
      ready,
      lobbySeq: lastLobbySeqRef.current,
    });
  }, [applyLobbyReady]);

  const setAppearance = useCallback((appearance: CultistAppearance) => {
    const playerId = myPlayerIdRef.current;
    if (playerId === null || hostGameRef.current) return;
    const normalized = normalizeCultistAppearance(appearance);
    localAppearanceRef.current = normalized;
    try {
      localStorage.setItem(CULTIST_APPEARANCE_KEY, JSON.stringify(normalized));
    } catch { /* melhor esforço */ }

    // Eco local imediato: o provador reage no clique, sem esperar a rede.
    setLobbyPlayers((prev) => prev.map((player) => player.id === playerId
      ? { ...player, appearance: normalized }
      : player));

    // A rede só vê a ÚLTIMA escolha. Cada clique custava presence.track +
    // broadcast do lobby inteiro; uma sequência de cliques no vestiário
    // estourava o rate limit do Realtime, que FECHA o canal e derrubava a
    // sala inteira ("Sem conexão"). O debounce colapsa a rajada em 1 sync.
    if (appearanceSyncRef.current) clearTimeout(appearanceSyncRef.current);
    appearanceSyncRef.current = setTimeout(() => {
      appearanceSyncRef.current = null;
      const atual = localAppearanceRef.current;
      void channelRef.current?.track({
        playerId,
        clientId: clientIdRef.current,
        connectionId: connectionIdRef.current,
        name: playerName ?? '?',
        appearance: atual,
      });
      if (isHostRef.current) applyLobbyAppearance(playerId, atual);
      else void sendSecureRequestRef.current({ type: 'appearance', appearance: atual });
    }, 450);
  }, [playerName, applyLobbyAppearance]);

  const updateLobbyRules = useCallback((patch: Partial<LobbyRules>) => {
    if (!isHostRef.current || hostGameRef.current) return;
    const nextRules = normalizeLobbyRules({ ...lobbyRulesRef.current, ...patch });
    if (JSON.stringify(nextRules) === JSON.stringify(lobbyRulesRef.current)) return;
    // Qualquer mudança de regra invalida consentimentos anteriores. Bots não
    // precisam consentir e permanecem acesos.
    const resetPlayers = lobbyPlayersRef.current.map((player) => ({
      ...player,
      ready: player.isBot === true,
    }));
    commitLobby(resetPlayers, {
      rules: nextRules,
      countdownEndsAt: null,
      invalidatesConsent: true,
    });
  }, [commitLobby]);

  const startGame = useCallback(() => {
    if (!isHostRef.current || hostGameRef.current) return;
    const lobby = lobbyPlayersRef.current;
    if (lobby.length < MIN_PLAYERS || lobby.length > MAX_PLAYERS) return;
    if (lobby.some((player) => !player.isBot && !player.ready)) return;

    const seats: Seat[] = lobby.map((lp) => ({
      id: lp.id,
      name: lp.name,
      isHuman: !lp.isBot,
      appearance: lp.appearance,
    }));
    countdownEndsAtRef.current = null;
    setCountdownEndsAt(null);
    gameIdRef.current = createRoomId('game');
    snapshotCursorRef.current = null;
    persistHostLobby();
    const custom = sanitizeCustomCards(customCardsRef.current);
    const rules = lobbyRulesRef.current;
    commitHostState(initGame(
      seats,
      DEFAULT_SCORE_LIMIT,
      rules.mode,
      custom.black,
      custom.white,
      rules
    ));
  }, [commitHostState, persistHostLobby]);

  // Todos os humanos, inclusive o host, acendem o próprio selo. Quando o
  // último acende, o host publica um deadline absoluto: todos veem o mesmo 3…2…1.
  useEffect(() => {
    if (!isHost || hostGameRef.current) return;
    const lobby = lobbyPlayersRef.current;
    const validCount = lobby.length >= MIN_PLAYERS && lobby.length <= MAX_PLAYERS;
    const everyoneReady = validCount
      && lobby.every((player) => player.isBot || player.ready);

    if (!everyoneReady) {
      if (countdownEndsAtRef.current !== null) {
        commitLobby(lobby, { countdownEndsAt: null });
      }
      return;
    }

    let deadline = countdownEndsAtRef.current;
    if (deadline === null) {
      deadline = Date.now() + RITUAL_COUNTDOWN_MS;
      commitLobby(lobby, { countdownEndsAt: deadline });
      return;
    }

    const timer = window.setTimeout(startGame, Math.max(0, deadline - Date.now()));
    return () => window.clearTimeout(timer);
  }, [isHost, lobbyPlayers, countdownEndsAt, commitLobby, startGame]);

  // Host remove alguém de propósito (lobby ou meio do jogo).
  const kickPlayer = useCallback((playerId: number) => {
    if (!isHostRef.current || playerId === hostIdRef.current) return;
    const peer = hostPeersRef.current.get(playerId);
    if (peer) {
      void sendPrivateToPeer(peer, 'kicked', { reason: 'removed_by_host' })
        .finally(() => closeHostPeer(playerId));
    }
    cancelDisconnectTimer(playerId);
    seatLedgerRef.current = seatLedgerRef.current.filter((entry) => entry.playerId !== playerId);
    for (const [knownClientId, knownPlayerId] of clientPlayerMapRef.current) {
      if (knownPlayerId === playerId) clientPlayerMapRef.current.delete(knownClientId);
    }

    const updatedLobby = lobbyPlayersRef.current.filter((p) => p.id !== playerId);
    commitLobby(updatedLobby, { countdownEndsAt: null });

    const gs = hostGameRef.current;
    if (!gs) return;
    commitHostState(removePlayer(gs, playerId));
  }, [
    cancelDisconnectTimer,
    closeHostPeer,
    commitHostState,
    commitLobby,
    sendPrivateToPeer,
  ]);

  // Host libera quem chegou no meio do jogo. Ganha assento e mão na próxima
  // rodada.
  const approveJoin = useCallback((joinerClientId: string) => {
    if (!isHostRef.current) return;
    const pending = pendingJoinsRef.current.find((p) => p.clientId === joinerClientId);
    const handshake = pendingHandshakesRef.current.get(joinerClientId);
    if (!pending || !handshake) return;
    if (!hasAvailableSeat(lobbyPlayersRef.current.length)) {
      void sendJoinStatusRef.current(joinerClientId, 'join_rejected', 'room_full');
      setPendingJoins((prev) => prev.filter((p) => p.clientId !== joinerClientId));
      return;
    }

    const playerId = nextPlayerIdRef.current++;
    clientPlayerMapRef.current.set(joinerClientId, playerId);
    const newcomer = normalizeLobbyPlayer({
      id: playerId,
      name: pending.name,
      ready: false,
      appearance: pending.appearance,
    });
    void (async () => {
      const token = createSeatToken();
      const tokenHash = await hashSeatToken(token);
      seatLedgerRef.current = [
        ...seatLedgerRef.current,
        { playerId, tokenHash, publicKey: handshake.publicKey },
      ];
      commitLobby([...lobbyPlayersRef.current, newcomer], { countdownEndsAt: null });
      const accepted = await issueWelcomeRef.current(handshake, playerId, token);
      if (!accepted) {
        clientPlayerMapRef.current.delete(joinerClientId);
        seatLedgerRef.current = seatLedgerRef.current.filter((entry) => entry.playerId !== playerId);
        commitLobby(lobbyPlayersRef.current.filter((player) => player.id !== playerId), {
          countdownEndsAt: null,
        });
        return;
      }
      pendingSeatsRef.current = [...pendingSeatsRef.current, {
        id: playerId,
        name: pending.name,
        appearance: pending.appearance,
      }];
      setPendingJoins((previous) => previous.filter((item) => item.clientId !== joinerClientId));
    })();
  }, [commitLobby]);

  const rejectJoin = useCallback((joinerClientId: string) => {
    if (!isHostRef.current) return;
    void sendJoinStatusRef.current(joinerClientId, 'join_rejected', 'rejected_by_host')
      .finally(() => pendingHandshakesRef.current.delete(joinerClientId));
    setPendingJoins((prev) => prev.filter((p) => p.clientId !== joinerClientId));
  }, []);

  const leaveLobby = useCallback(() => {
    leavingRef.current = true;
    const leaveRequest = !isHostRef.current && myPlayerIdRef.current !== null
      ? sendSecureRequestRef.current({ type: 'leave', scope: 'lobby' })
      : Promise.resolve(false);
    clearRoomSession(sessionStorage, sessionKey);
    clearRoomSession(sessionStorage, contextKey);
    try { sessionStorage.removeItem(pidKey); } catch { /* melhor esforço */ }
    credentialRef.current = null;
    myPlayerIdRef.current = null;
    setMyPlayerId(null);
    setIsConnected(false);
    const closeChannels = async () => {
      if (guestPrivateChannelRef.current) {
        await supabase.removeChannel(guestPrivateChannelRef.current);
        guestPrivateChannelRef.current = null;
      }
      if (channelRef.current) await supabase.removeChannel(channelRef.current);
      channelRef.current = null;
    };
    if (!isHostRef.current) {
      void leaveRequest.finally(closeChannels);
    } else {
      try { sessionStorage.removeItem('sp-host-room'); } catch { /* melhor esforço */ }
      void closeChannels();
    }
  }, [contextKey, pidKey, sessionKey]);

  const disconnect = useCallback(async () => {
    const channel = channelRef.current;
    const playerId = myPlayerIdRef.current;
    const currentGame = gameStateRef.current;
    const gameOn = !!currentGame && currentGame.phase !== 'setup' && currentGame.phase !== 'game-end';

    if (!isHostRef.current && playerId !== null && gameOn) {
      try {
        await sendSecureRequestRef.current({ type: 'leave', scope: 'game' });
      } catch {
        // A presença também detecta a saída; este evento só elimina a espera.
      }
    }

    leavingRef.current = true;
    setIsConnected(false);

    if (isHostRef.current && playerId !== null) {
      try {
        // Saída voluntária: se voltar, retorna como jogador no assento antigo,
        // não como um segundo host com snapshot desatualizado.
        sessionStorage.setItem(pidKey, String(playerId));
        sessionStorage.removeItem('sp-host-room');
      } catch { /* melhor esforço */ }
    }

    if (guestPrivateChannelRef.current) {
      await supabase.removeChannel(guestPrivateChannelRef.current);
      guestPrivateChannelRef.current = null;
    }
    for (const peer of hostPeersRef.current.values()) {
      await supabase.removeChannel(peer.channel);
    }
    hostPeersRef.current.clear();
    if (channel) await supabase.removeChannel(channel);
    if (channelRef.current === channel) channelRef.current = null;
  }, [pidKey]);

  return {
    role: isHost ? 'host' : (myPlayerId !== null ? 'guest' : 'connecting'),
    myPlayerId,
    lobbyPlayers,
    lobbyRules,
    countdownEndsAt,
    gameState,
    isConnected,
    error,
    wasKicked,
    chatMessages,
    reactions,
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
    sendReaction,
    startGame,
    setReady,
    setAppearance,
    updateLobbyRules,
    addBot,
    removeBot,
    kickPlayer,
    approveJoin,
    rejectJoin,
    leaveLobby,
    disconnect,
  };
}
