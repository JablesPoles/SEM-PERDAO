// Cores de avatar determinísticas por id — iguais em todos os clientes.
const AVATAR_COLORS = [
  '#ff3b2f',
  '#3a3843',
  '#8a2620',
  '#4a4855',
  '#b3554d',
  '#26252b',
  '#d97a30',
  '#5c2e8a',
];

export function avatarColor(id: number): string {
  return AVATAR_COLORS[Math.abs(id) % AVATAR_COLORS.length];
}

export function initials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
}
