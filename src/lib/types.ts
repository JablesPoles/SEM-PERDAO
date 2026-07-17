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

export interface Player {
  id: number;
  name: string;
  isHuman: boolean;
  score: number;
  hand: WhiteCard[];
  eliminated: boolean;
}

// Jogada de um jogador na rodada. Durante o julgamento a lista é embaralhada
// e o playerId é redigido (-1) para os clientes — ninguém sabe de quem é.
export interface Submission {
  playerId: number;
  cards: WhiteCard[];
}

export type GamePhase =
  | 'setup'
  | 'submitting'
  | 'judging'
  | 'round-end'
  | 'game-end';

export interface GameState {
  phase: GamePhase;
  players: Player[];
  round: number;
  scoreLimit: number;
  czarId: number;
  blackCard: BlackCard | null;
  submissions: Submission[];
  // Índices (em `submissions`) já virados pelo juiz durante o julgamento.
  revealed: number[];
  // Relógio do host no início da fase — base do timer nos clientes.
  phaseStartedAt: number;
  roundWinnerId: number | null;
  winner: Player | null;
  // Pilhas de compra — só o host conhece; redigidas para os convidados.
  blackDeck: BlackCard[];
  whiteDeck: WhiteCard[];
}

export type PlayerAction =
  | { type: 'submit'; cardIds: string[] }
  | { type: 'reveal'; index: number }
  | { type: 'judge'; index: number }
  | { type: 'next_round' };

// Reação-relâmpago que flutua na tela de todo mundo (efêmera, fora do estado).
export interface Reaction {
  id: string;
  emoji: string;
  name: string;
  ts: number;
}

export interface ChatMessage {
  id: string;
  playerId: number;
  name: string;
  text: string;
  ts: number;
}
