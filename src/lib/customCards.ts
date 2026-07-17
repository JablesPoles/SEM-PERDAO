import { countBlanks } from './cards';
import { BlackCard, WhiteCard } from './types';

export const CUSTOM_CARDS_STORAGE_KEY = 'sp-custom-cards';
export const MAX_CUSTOM_CARD_TEXT = 140;
export const MAX_CUSTOM_BLACK_PICK = 3;

export interface CustomCards {
  black: BlackCard[];
  white: WhiteCard[];
}

export function emptyCustomCards(): CustomCards {
  return { black: [], white: [] };
}

function cleanInput(text: string): string {
  return text.trim().replace(/\s+/g, ' ');
}

export function normalizeBlackText(input: string): string | null {
  const clean = cleanInput(input);
  if (!clean) return null;

  const limited = clean.slice(0, MAX_CUSTOM_CARD_TEXT).trimEnd();
  let normalized = limited;
  if (!normalized.includes('____')) {
    const suffix = ' ____.';
    const base = normalized
      .slice(0, MAX_CUSTOM_CARD_TEXT - suffix.length)
      .trimEnd();
    normalized = base ? `${base}${suffix}` : '';
  }
  if (!normalized || countBlanks(normalized) > MAX_CUSTOM_BLACK_PICK) return null;
  return normalized;
}

export function normalizeWhiteText(input: string): string | null {
  const clean = cleanInput(input);
  if (!clean) return null;
  return clean.slice(0, MAX_CUSTOM_CARD_TEXT).trimEnd() || null;
}

function uniqueId(
  prefix: 'cb' | 'cw',
  existingIds: Iterable<string>,
  preferred?: string,
  fallbackIndex?: number
): string {
  const used = new Set(existingIds);
  if (preferred?.startsWith(`${prefix}-`) && !used.has(preferred)) return preferred;

  const stableBase = fallbackIndex === undefined
    ? `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
    : `${prefix}-local-${fallbackIndex}`;
  let candidate = stableBase;
  let suffix = 1;
  while (used.has(candidate)) candidate = `${stableBase}-${suffix++}`;
  return candidate;
}

export function createCustomBlackCard(
  input: string,
  existingIds: Iterable<string>
): BlackCard | null {
  const text = normalizeBlackText(input);
  if (!text) return null;
  return {
    id: uniqueId('cb', existingIds),
    text,
    pick: Math.max(1, countBlanks(text)),
  };
}

export function createCustomWhiteCard(
  input: string,
  existingIds: Iterable<string>
): WhiteCard | null {
  const text = normalizeWhiteText(input);
  if (!text) return null;
  return { id: uniqueId('cw', existingIds), text };
}

function rawEntries(value: unknown, key: 'black' | 'white'): unknown[] {
  if (!value || typeof value !== 'object') return [];
  const entries = (value as Record<string, unknown>)[key];
  return Array.isArray(entries) ? entries : [];
}

function rawText(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (!value || typeof value !== 'object') return null;
  const text = (value as Record<string, unknown>).text;
  return typeof text === 'string' ? text : null;
}

function rawId(value: unknown): string | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const id = (value as Record<string, unknown>).id;
  return typeof id === 'string' ? id : undefined;
}

// Não confia cegamente no localStorage: remove entradas inválidas, corrige ids
// antigos/duplicados e sempre recalcula o pick a partir das lacunas.
export function sanitizeCustomCards(value: unknown): CustomCards {
  const result = emptyCustomCards();
  const blackIds = new Set<string>();
  const whiteIds = new Set<string>();

  rawEntries(value, 'black').forEach((entry, index) => {
    const input = rawText(entry);
    const text = input === null ? null : normalizeBlackText(input);
    if (!text) return;
    const id = uniqueId('cb', blackIds, rawId(entry), index);
    blackIds.add(id);
    result.black.push({ id, text, pick: Math.max(1, countBlanks(text)) });
  });

  rawEntries(value, 'white').forEach((entry, index) => {
    const input = rawText(entry);
    const text = input === null ? null : normalizeWhiteText(input);
    if (!text) return;
    const id = uniqueId('cw', whiteIds, rawId(entry), index);
    whiteIds.add(id);
    result.white.push({ id, text });
  });

  return result;
}

export function loadCustomCards(): CustomCards {
  if (typeof window === 'undefined') return emptyCustomCards();
  try {
    const saved = window.localStorage.getItem(CUSTOM_CARDS_STORAGE_KEY);
    return saved ? sanitizeCustomCards(JSON.parse(saved) as unknown) : emptyCustomCards();
  } catch {
    return emptyCustomCards();
  }
}

export function saveCustomCards(cards: CustomCards): CustomCards {
  const clean = sanitizeCustomCards(cards);
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(CUSTOM_CARDS_STORAGE_KEY, JSON.stringify(clean));
    } catch {
      // Navegação privada/storage cheio: as cartas seguem válidas nesta sessão.
    }
  }
  return clean;
}
