import { WhiteCard } from './types';
import { shuffle } from './game';

// Bots jogam no espírito "Rando Cardrissian": totalmente aleatório — e mesmo
// assim às vezes ganham, o que é a piada.

export const BOT_NAMES = [
  'Rando',
  'Bot Sem Alma',
  'Estagiário',
  'RH Sombrio',
  'Tio do Pavê',
  'Advogado do Réu',
];

export function getBotSubmission(hand: WhiteCard[], pick: number): string[] {
  return shuffle(hand)
    .slice(0, pick)
    .map((c) => c.id);
}

export function getBotJudgeIndex(submissionCount: number): number {
  return Math.floor(Math.random() * submissionCount);
}
