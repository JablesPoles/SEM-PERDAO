// Carta preta: a pergunta/frase com lacunas. `pick` = quantas brancas preenche.
export interface BlackCard {
  id: string;
  text: string;
  pick: number;
}

// Carta branca: a resposta.
export interface WhiteCard {
  id: string;
  text: string;
}

// Customização deliberadamente curada: todas as opções têm implementação
// visual conhecida e o objeto continua pequeno/serializável para snapshots.
export const CULTIST_ROBES = ['blood', 'ash', 'midnight', 'moss'] as const;
export const CULTIST_HOODS = ['classic', 'spire', 'shrouded'] as const;
export const CULTIST_FACES = ['void', 'ember', 'grin', 'weeping'] as const;
export const CULTIST_ACCENTS = ['bone', 'brass', 'scarlet', 'cyan'] as const;
export const CULTIST_ACCESSORIES = ['none', 'chain', 'candle', 'relic'] as const;

export type CultistRobe = (typeof CULTIST_ROBES)[number];
export type CultistHood = (typeof CULTIST_HOODS)[number];
export type CultistFace = (typeof CULTIST_FACES)[number];
export type CultistAccent = (typeof CULTIST_ACCENTS)[number];
export type CultistAccessory = (typeof CULTIST_ACCESSORIES)[number];

export interface CultistAppearance {
  robe: CultistRobe;
  hood: CultistHood;
  face: CultistFace;
  accent: CultistAccent;
  accessory: CultistAccessory;
}

export const DEFAULT_CULTIST_APPEARANCE: CultistAppearance = Object.freeze({
  robe: 'blood',
  hood: 'classic',
  face: 'void',
  accent: 'bone',
  accessory: 'none',
});

export interface Player {
  id: number;
  name: string;
  isHuman: boolean;
  // O assento continua ativo durante uma queda; a mesa joga por ele até voltar.
  connected: boolean;
  score: number;
  hand: WhiteCard[];
  eliminated: boolean;
  // Opcional no tipo para ler snapshots anteriores à customização. Partidas
  // novas sempre recebem uma aparência completa e validada em initGame.
  appearance?: CultistAppearance;
}

// Jogada de um jogador na rodada. Durante o julgamento a lista é embaralhada
// e o playerId é redigido (-1) para os clientes — ninguém sabe de quem é.
export interface Submission {
  playerId: number;
  cards: WhiteCard[];
}

export type GameMode = 'judge' | 'democracy';

export type TurnLimit = 1 | 2 | 3;

export interface GameRules {
  turnLimit: TurnLimit;
  submitSeconds: number;
  judgeSeconds: number;
  resultSeconds: number;
}

export interface LobbyRules extends GameRules {
  mode: GameMode;
}

export interface LobbyPlayer {
  id: number;
  name: string;
  isBot?: boolean;
  ready: boolean;
  appearance: CultistAppearance;
}

export interface Vote {
  voterId: number;
  submissionIndex: number;
}

export type GamePhase =
  | 'setup'
  | 'submitting'
  | 'judging'
  | 'round-end'
  | 'game-end';

export interface GameState {
  phase: GamePhase;
  mode: GameMode;
  players: Player[];
  round: number;
  // Regras por voltas. O limite é calculado uma única vez ao começar e não
  // muda com reconnect, kick ou entrada tardia.
  turnLimit?: TurnLimit;
  roundLimit?: number;
  suddenDeath?: boolean;
  scoreLimit: number;
  czarId: number;
  blackCard: BlackCard | null;
  submissions: Submission[];
  // No modo Democracia, o voto fica secreto durante a votação e só é aberto
  // no resultado. `votingOptions` limita as cartas num eventual 2º turno.
  votes: Vote[];
  votingOptions: number[];
  votingRound: 1 | 2;
  tieBreak: boolean;
  // Índices (em `submissions`) já virados pelo juiz durante o julgamento.
  revealed: number[];
  // Relógio do host no início da fase — base do timer nos clientes.
  phaseStartedAt: number;
  // ID e deadline autoritativos. Opcionais somente para hidratar snapshots
  // antigos; os helpers de game.ts derivam fallbacks compatíveis.
  phaseId?: string;
  // Revisão monotônica do estado autoritativo; clientes ignoram snapshots
  // atrasados mesmo quando pertencem à mesma fase.
  stateRevision?: number;
  phaseEndsAt?: number | null;
  submitSeconds?: number;
  judgeSeconds?: number;
  resultSeconds?: number;
  roundWinnerId: number | null;
  winnerIds?: number[];
  // Campo singular legado, mantido enquanto os clientes antigos existirem.
  winner: Player | null;
  // Baralhos-fonte dos reshuffles — só o host conhece; incluem as cartas
  // personalizadas escolhidas ao abrir a partida.
  blackPool: BlackCard[];
  whitePool: WhiteCard[];
  // Pilhas de compra — só o host conhece; redigidas para os convidados.
  blackDeck: BlackCard[];
  whiteDeck: WhiteCard[];
}

export type PlayerAction =
  | { type: 'submit'; cardIds: string[]; phaseId?: string }
  | { type: 'reveal'; index: number; phaseId?: string }
  | { type: 'judge'; index: number; phaseId?: string }
  | { type: 'vote'; index: number; phaseStartedAt: number; phaseId?: string }
  | { type: 'next_round'; phaseId?: string };

// Reação-relâmpago que flutua na tela de todo mundo (efêmera, fora do estado).
export interface Reaction {
  id: string;
  emoji: string;
  name: string;
  // Opcional para aceitar reações de clientes de uma versão anterior.
  playerId?: number;
  ts: number;
}

export interface ChatMessage {
  id: string;
  playerId: number;
  name: string;
  text: string;
  ts: number;
}
