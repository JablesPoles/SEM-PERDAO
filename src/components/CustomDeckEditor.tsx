'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import { ALL_BLACK, ALL_WHITE } from '../lib/cards';
import {
  createCustomBlackCard,
  createCustomWhiteCard,
  CustomCards,
  MAX_CUSTOM_BLACK_PICK,
  MAX_CUSTOM_CARD_TEXT,
} from '../lib/customCards';
import { BlackCard, WhiteCard } from '../lib/types';

interface CustomDeckEditorProps {
  open: boolean;
  cards: CustomCards;
  onChange: (cards: CustomCards) => void;
  onClose: () => void;
}

type CardKind = 'black' | 'white';

function isBlackCard(card: BlackCard | WhiteCard): card is BlackCard {
  return 'pick' in card && typeof card.pick === 'number';
}

export function CustomDeckEditor({
  open,
  cards,
  onChange,
  onClose,
}: CustomDeckEditorProps) {
  const [kind, setKind] = useState<CardKind>('black');
  const [text, setText] = useState('');

  const existingIds = useMemo(
    () => [...cards.black, ...cards.white].map((card) => card.id),
    [cards]
  );
  const visibleCards = kind === 'black' ? cards.black : cards.white;
  const blankCount = (text.match(/____/g) ?? []).length;
  const tooManyBlanks = kind === 'black' && blankCount > MAX_CUSTOM_BLACK_PICK;

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  const addCard = (event: FormEvent) => {
    event.preventDefault();
    if (kind === 'black') {
      const card = createCustomBlackCard(text, existingIds);
      if (!card) return;
      onChange({ ...cards, black: [...cards.black, card] });
    } else {
      const card = createCustomWhiteCard(text, existingIds);
      if (!card) return;
      onChange({ ...cards, white: [...cards.white, card] });
    }
    setText('');
  };

  const removeCard = (id: string) => {
    onChange({
      black: cards.black.filter((card) => card.id !== id),
      white: cards.white.filter((card) => card.id !== id),
    });
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-ink/80 backdrop-blur-[3px] flex items-end sm:items-center justify-center sm:p-5"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="custom-deck-title"
        className="w-full sm:max-w-xl max-h-[94vh] bg-paper sm:border-2 sm:border-ink rounded-t-[24px] sm:rounded-[24px] shadow-2xl overflow-hidden flex flex-col"
      >
        <header className="px-5 pt-5 pb-4 sm:px-6 border-b-2 border-ink flex items-start gap-4">
          <div className="flex-1">
            <span className="text-red text-[11px] font-bold tracking-[2px]">BARALHO DO ANFITRIÃO</span>
            <h2 id="custom-deck-title" className="font-display text-ink text-3xl leading-none mt-1">
              CARTAS SEM CENSURA
            </h2>
            <p className="text-ink/55 text-xs font-medium mt-2">
              {ALL_BLACK.length + cards.black.length} pretas · {ALL_WHITE.length + cards.white.length} brancas
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar editor de baralho"
            className="w-9 h-9 rounded-full border-2 border-ink/20 text-ink hover:border-red hover:text-red font-bold text-lg transition-colors"
          >
            ×
          </button>
        </header>

        <div className="overflow-y-auto px-5 py-5 sm:px-6 flex flex-col gap-5">
          <div className="grid grid-cols-2 gap-2 p-1.5 bg-ink/8 rounded-[14px]">
            {(['black', 'white'] as const).map((option) => {
              const selected = kind === option;
              return (
                <button
                  key={option}
                  type="button"
                  onClick={() => setKind(option)}
                  aria-pressed={selected}
                  className={`h-10 rounded-[10px] font-bold text-xs tracking-wide transition-all ${
                    selected
                      ? option === 'black' ? 'bg-ink text-paper' : 'bg-white text-ink shadow-sm'
                      : 'text-ink/45 hover:text-ink'
                  }`}
                >
                  {option === 'black' ? `PRETAS (${cards.black.length})` : `BRANCAS (${cards.white.length})`}
                </button>
              );
            })}
          </div>

          <form onSubmit={addCard} className="flex flex-col gap-2.5">
            <label htmlFor="custom-card-text" className="text-ink/55 text-[11px] font-bold tracking-[2px] px-1">
              {kind === 'black' ? 'NOVA ACUSAÇÃO' : 'NOVA RESPOSTA'}
            </label>
            <textarea
              id="custom-card-text"
              value={text}
              onChange={(event) => setText(event.target.value)}
              maxLength={MAX_CUSTOM_CARD_TEXT}
              rows={3}
              autoFocus
              placeholder={kind === 'black' ? 'O pior jeito de começar a reunião é ____.' : 'Abrir a câmera sem querer.'}
              className="w-full resize-none rounded-xl bg-white border-2 border-ink/20 text-ink px-4 py-3 outline-none focus:border-ink transition-colors placeholder:text-ink/25 font-medium text-sm"
            />
            <div className="flex items-start justify-between gap-3 px-1">
              <span className={`text-[11px] leading-snug font-medium ${tooManyBlanks ? 'text-red' : 'text-ink/45'}`}>
                {kind === 'black'
                  ? tooManyBlanks
                    ? `Máximo de ${MAX_CUSTOM_BLACK_PICK} lacunas por carta.`
                    : `Use ____ em cada lacuna (máximo ${MAX_CUSTOM_BLACK_PICK}). Sem nenhuma, o jogo acrescenta uma no fim.`
                  : 'Curta e cruel costuma funcionar melhor.'}
              </span>
              <span className="text-ink/35 text-[10px] tabular-nums shrink-0">
                {text.length}/{MAX_CUSTOM_CARD_TEXT}
              </span>
            </div>
            <button
              type="submit"
              disabled={!text.trim() || tooManyBlanks}
              className="btn-red h-12 rounded-xl font-display text-sm tracking-wide transition-all hover:brightness-110 active:scale-[0.98] disabled:opacity-35 disabled:cursor-not-allowed"
            >
              + ADICIONAR CARTA {kind === 'black' ? 'PRETA' : 'BRANCA'}
            </button>
          </form>

          <div className="h-px bg-ink/15" />

          <div className="flex flex-col gap-3">
            <div className="flex items-baseline justify-between px-1">
              <span className="text-ink/55 text-[11px] font-bold tracking-[2px]">SUAS CARTAS</span>
              <span className="text-ink/40 text-xs font-medium">salvas neste navegador</span>
            </div>

            {visibleCards.length === 0 ? (
              <div className="rounded-[14px] border-2 border-dashed border-ink/20 px-5 py-8 text-center">
                <p className="font-display text-ink/35 text-lg">NENHUMA AINDA</p>
                <p className="text-ink/40 text-xs font-medium mt-1">
                  As cartas do jogo continuam no baralho normalmente.
                </p>
              </div>
            ) : (
              <div className="grid sm:grid-cols-2 gap-3">
                {visibleCards.map((card) => (
                  <article
                    key={card.id}
                    className={`${kind === 'black' ? 'card-black' : 'card-white'} min-h-32 rounded-[14px] p-4 flex flex-col gap-3 relative`}
                  >
                    <p className="font-bold text-sm leading-snug flex-1 pr-7 break-words">{card.text}</p>
                    <div className="flex items-end justify-between gap-2">
                      <span className={`text-[9px] font-bold tracking-[1.5px] ${kind === 'black' ? 'text-paper/45' : 'text-ink/35'}`}>
                        SEM PERDÃO*
                      </span>
                      {isBlackCard(card) && card.pick > 1 && (
                        <span className="bg-red text-white rounded-full px-2 py-0.5 text-[9px] font-black">
                          ESCOLHA {card.pick}
                        </span>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => removeCard(card.id)}
                      aria-label={`Remover carta: ${card.text}`}
                      className={`absolute top-2.5 right-2.5 w-7 h-7 rounded-full flex items-center justify-center text-sm font-bold transition-colors ${
                        kind === 'black'
                          ? 'bg-white/10 text-paper/50 hover:bg-red hover:text-white'
                          : 'bg-ink/5 text-ink/40 hover:bg-red hover:text-white'
                      }`}
                    >
                      ×
                    </button>
                  </article>
                ))}
              </div>
            )}
          </div>
        </div>

        <footer className="px-5 py-3.5 sm:px-6 border-t border-ink/15 bg-white/45">
          <p className="text-ink/45 text-[11px] text-center font-medium">
            Só quem hospeda a sala usa e guarda este baralho.
          </p>
        </footer>
      </section>
    </div>
  );
}
