import { expect, test } from 'playwright/test';
import {
  QUICK_REACTIONS,
  REACTION_CATALOG,
  REACTION_THROWS,
  reactionDefinition,
} from '../src/lib/mesa/reactionCatalog';
import { ReactionComboTracker } from '../src/lib/mesa/reactionCombos';

const signal = (id: string, participantId: number, emoji: string, timestamp: number) => ({
  id,
  participantId,
  emoji,
  timestamp,
});

test('três pessoas repetindo o meme formam um coro determinístico', () => {
  const tracker = new ReactionComboTracker();
  expect(tracker.push(signal('r1', 1, '💀', 1_000))).toBeNull();
  expect(tracker.push(signal('r2', 2, '💀', 1_500))).toBeNull();
  expect(tracker.push(signal('r3', 3, '💀', 2_000))).toEqual({
    id: 'chorus:r1:r3',
    kind: 'chorus',
    emoji: '💀',
    count: 3,
    participants: 3,
    startedAt: 1_000,
    endedAt: 2_000,
  });
});

test('spam individual, duplicata e arremesso não fabricam combo', () => {
  const tracker = new ReactionComboTracker();
  expect(tracker.push(signal('r1', 1, '🤣', 1_000))).toBeNull();
  expect(tracker.push(signal('r1', 2, '🤣', 1_100))).toBeNull();
  expect(tracker.push(signal('r2', 1, '🤣', 1_200))).toBeNull();
  expect(tracker.push(signal('r3', 1, '🤣', 1_300))).toBeNull();
  expect(tracker.push(signal('r4', 2, 'throw:tomate:3', 1_400))).toBeNull();
});

test('muitas reações variadas de pessoas distintas formam motim e respeitam cooldown', () => {
  const tracker = new ReactionComboTracker({ cooldownMs: 3_000 });
  const emojis = ['💀', '🤣', '🤡', '🔥', '👀', '🍿'];
  for (let index = 0; index < 5; index += 1) {
    expect(tracker.push(signal(`r${index}`, (index % 3) + 1, emojis[index], 1_000 + index * 150))).toBeNull();
  }
  expect(tracker.push(signal('r5', 3, emojis[5], 1_750))).toMatchObject({
    id: 'riot:r0:r5',
    kind: 'riot',
    emoji: '🔥',
    count: 6,
    participants: 3,
  });

  expect(tracker.push(signal('r6', 1, '💀', 2_000))).toBeNull();
  expect(tracker.push(signal('r7', 2, '💀', 2_100))).toBeNull();
  expect(tracker.push(signal('r8', 3, '💀', 2_200))).toBeNull();

  tracker.reset();
  expect(tracker.push(signal('r6', 1, '💀', 8_000))).toBeNull();
  expect(tracker.push(signal('r7', 2, '💀', 8_100))).toBeNull();
  expect(tracker.push(signal('r8', 3, '💀', 8_200))).toMatchObject({ kind: 'chorus' });
});

test('catálogo compartilhado mantém emojis únicos, memes rápidos e arremessos separados', () => {
  expect(REACTION_CATALOG.length).toBeGreaterThanOrEqual(24);
  expect(new Set(REACTION_CATALOG.map((reaction) => reaction.emoji)).size).toBe(REACTION_CATALOG.length);
  expect(QUICK_REACTIONS).toHaveLength(6);
  expect(QUICK_REACTIONS.every((reaction) => reaction.quick)).toBe(true);
  expect(reactionDefinition('🤌')).toMatchObject({ label: 'Cinema', mood: 'hype' });
  expect(REACTION_THROWS.map((reaction) => reaction.kind)).toEqual(['tomate', 'sapato', 'rosa']);
});
