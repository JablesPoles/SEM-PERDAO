export type ReactionMood = 'laugh' | 'shock' | 'contempt' | 'hype' | 'watch';

export interface ReactionDefinition {
  emoji: string;
  label: string;
  stamp: string;
  mood: ReactionMood;
  quick?: boolean;
}

/** Catálogo único consumido pelas mesas 2D, 3D e futuros jogos d'A Mesa. */
export const REACTION_CATALOG: readonly ReactionDefinition[] = Object.freeze([
  { emoji: '💀', label: 'Morri', stamp: 'MORRI', mood: 'laugh', quick: true },
  { emoji: '🤣', label: 'Rindo muito', stamp: 'RINDO MUITO', mood: 'laugh', quick: true },
  { emoji: '🤡', label: 'Palhaço', stamp: 'PALHAÇO', mood: 'contempt', quick: true },
  { emoji: '🗿', label: 'Chad de pedra', stamp: 'CHAD DE PEDRA', mood: 'contempt', quick: true },
  { emoji: '🤮', label: 'Que nojo', stamp: 'QUE NOJO', mood: 'shock', quick: true },
  { emoji: '👀', label: 'De olho', stamp: 'DE OLHO', mood: 'watch', quick: true },
  { emoji: '🫠', label: 'Derretendo', stamp: 'DERRETENDO', mood: 'shock' },
  { emoji: '🤨', label: 'Suspeito', stamp: 'SUSPEITO', mood: 'watch' },
  { emoji: '💅', label: 'Serviu', stamp: 'SERVIU', mood: 'hype' },
  { emoji: '🍿', label: 'Só assistindo', stamp: 'SÓ ASSISTINDO', mood: 'watch' },
  { emoji: '🚩', label: 'Red flag', stamp: 'RED FLAG', mood: 'contempt' },
  { emoji: '🔥', label: 'Pegou fogo', stamp: 'PEGOU FOGO', mood: 'hype' },
  { emoji: '😭', label: 'Chorando', stamp: 'CHORANDO', mood: 'shock' },
  { emoji: '🤌', label: 'Cinema', stamp: 'CINEMA', mood: 'hype' },
  { emoji: '🧢', label: 'É mentira', stamp: 'É MENTIRA', mood: 'contempt' },
  { emoji: '⚰️', label: 'Foi de base', stamp: 'FOI DE BASE', mood: 'laugh' },
  { emoji: '👏', label: 'Palmas', stamp: 'PALMAS', mood: 'hype' },
  { emoji: '🫣', label: 'Nem vi', stamp: 'NEM VI', mood: 'shock' },
  { emoji: '🥶', label: 'Foi gelado', stamp: 'GELADO DEMAIS', mood: 'hype' },
  { emoji: '🤯', label: 'Explodiu a mente', stamp: 'ABSURDO', mood: 'shock' },
  { emoji: '🫡', label: 'Já era', stamp: 'ATÉ NUNCA', mood: 'laugh' },
  { emoji: '😬', label: 'Climão', stamp: 'CLIMÃO', mood: 'contempt' },
  { emoji: '🙏', label: 'Perdão', stamp: 'SEM PERDÃO', mood: 'laugh' },
  { emoji: '🏆', label: 'Craque do jogo', stamp: 'MVP DO PORÃO', mood: 'hype' },
]);

export const QUICK_REACTIONS = Object.freeze(
  REACTION_CATALOG.filter((reaction) => reaction.quick)
);

export function reactionDefinition(emoji: string): ReactionDefinition | null {
  return REACTION_CATALOG.find((reaction) => reaction.emoji === emoji) ?? null;
}

export type ReactionThrowKind = 'tomate' | 'sapato' | 'rosa';

export interface ReactionThrowDefinition {
  kind: ReactionThrowKind;
  emoji: string;
  label: string;
}

export const REACTION_THROWS: readonly ReactionThrowDefinition[] = Object.freeze([
  { kind: 'tomate', emoji: '🍅', label: 'TOMATE' },
  { kind: 'sapato', emoji: '👞', label: 'SAPATO' },
  { kind: 'rosa', emoji: '🌹', label: 'ROSA' },
]);

export function reactionThrow(kind: string): ReactionThrowDefinition | null {
  return REACTION_THROWS.find((reaction) => reaction.kind === kind) ?? null;
}
