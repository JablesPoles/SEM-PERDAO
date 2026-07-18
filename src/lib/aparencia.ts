'use client';
/**
 * aparencia.ts — catálogo e persistência da aparência do cultista.
 * Fonte única para o menu, o lobby ritual e o hook de multiplayer: todos leem
 * e gravam a MESMA chave, então o réu criado no menu entra pronto na sala.
 */
import {
  CULTIST_ROBES,
  CULTIST_HOODS,
  CULTIST_FACES,
  CULTIST_ACCENTS,
  CULTIST_ACCESSORIES,
  DEFAULT_CULTIST_APPEARANCE,
  type CultistAppearance,
} from './types';
import { normalizeCultistAppearance } from './game';

export const CULTIST_APPEARANCE_KEY = 'sp-cultist-appearance';

/** Cores de referência pro preview 2D (minis do lobby) — espelham o 3D. */
export const ROBE_COLORS: Record<CultistAppearance['robe'], [string, string]> = {
  blood: ['#751d1a', '#260d0d'],
  ash: ['#666168', '#201e22'],
  midnight: ['#22243f', '#090a16'],
  moss: ['#415137', '#11180f'],
  violet: ['#4a2a5e', '#160c1e'],
  rust: ['#8a4c1f', '#2b1608'],
  abyss: ['#1e4744', '#0a1716'],
  linen: ['#b3a98f', '#3d382c'],
};

export const ACCENT_COLORS: Record<CultistAppearance['accent'], string> = {
  bone: '#ddd1bb',
  brass: '#c69138',
  scarlet: '#ff3b2f',
  cyan: '#5ee7e7',
  gold: '#e3b341',
  amethyst: '#a06bff',
};

export const FACE_MARKS: Record<CultistAppearance['face'], string> = {
  void: '▪ ▪',
  ember: '▪ ▪',
  grin: '⌒',
  weeping: '┊ ┊',
};

export const ACCESSORY_MARKS: Record<CultistAppearance['accessory'], string> = {
  none: '',
  chain: '⛓',
  candle: '♨',
  relic: '◆',
};

export interface GrupoAparencia {
  key: keyof CultistAppearance;
  label: string;
  options: Array<{ value: string; label: string }>;
}

/** Catálogo curado — cada opção tem implementação visual conhecida no 3D. */
export const APPEARANCE_GROUPS: GrupoAparencia[] = [
  {
    key: 'robe',
    label: 'Tecido do robe',
    options: [
      { value: 'blood', label: 'Sangue' },
      { value: 'ash', label: 'Cinza' },
      { value: 'midnight', label: 'Meia-noite' },
      { value: 'moss', label: 'Musgo' },
      { value: 'violet', label: 'Púrpura' },
      { value: 'rust', label: 'Ferrugem' },
      { value: 'abyss', label: 'Abissal' },
      { value: 'linen', label: 'Linho' },
    ],
  },
  {
    key: 'hood',
    label: 'Forma do capuz',
    options: [
      { value: 'classic', label: 'Clássico' },
      { value: 'spire', label: 'Agulha' },
      { value: 'shrouded', label: 'Mortalha' },
    ],
  },
  {
    key: 'face',
    label: 'Sigilo do rosto',
    options: [
      { value: 'void', label: 'Vazio' },
      { value: 'ember', label: 'Brasa' },
      { value: 'grin', label: 'Riso' },
      { value: 'weeping', label: 'Lágrimas' },
    ],
  },
  {
    key: 'accent',
    label: 'Metal ritual',
    options: [
      { value: 'bone', label: 'Osso' },
      { value: 'brass', label: 'Latão' },
      { value: 'scarlet', label: 'Escarlate' },
      { value: 'cyan', label: 'Ciano' },
      { value: 'gold', label: 'Ouro' },
      { value: 'amethyst', label: 'Ametista' },
    ],
  },
  {
    key: 'accessory',
    label: 'Relíquia',
    options: [
      { value: 'none', label: 'Nenhuma' },
      { value: 'chain', label: 'Corrente' },
      { value: 'candle', label: 'Vela' },
      { value: 'relic', label: 'Relicário' },
    ],
  },
];

export function carregarAparencia(): CultistAppearance {
  if (typeof window === 'undefined') return DEFAULT_CULTIST_APPEARANCE;
  try {
    const saved = window.localStorage.getItem(CULTIST_APPEARANCE_KEY);
    return normalizeCultistAppearance(saved ? JSON.parse(saved) : null);
  } catch {
    return DEFAULT_CULTIST_APPEARANCE;
  }
}

export function salvarAparencia(aparencia: CultistAppearance) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(
      CULTIST_APPEARANCE_KEY,
      JSON.stringify(normalizeCultistAppearance(aparencia))
    );
  } catch {
    // storage cheio/bloqueado: o réu só não sobrevive ao reload
  }
}

export function aparenciaAleatoria(): CultistAppearance {
  const escolher = <T,>(arr: readonly T[]): T => arr[Math.floor(Math.random() * arr.length)];
  return {
    robe: escolher(CULTIST_ROBES),
    hood: escolher(CULTIST_HOODS),
    face: escolher(CULTIST_FACES),
    accent: escolher(CULTIST_ACCENTS),
    accessory: escolher(CULTIST_ACCESSORIES),
  };
}
