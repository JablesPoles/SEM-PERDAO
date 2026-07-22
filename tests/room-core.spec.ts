import { expect, test } from 'playwright/test';

import {
  createRoomEnvelope,
  cursorFromEnvelope,
  parseRoomEnvelope,
  shouldAcceptSnapshot,
} from '../src/lib/room/protocol';
import { channelStatusOutcome, trackPresence } from '../src/lib/room/realtime';
import { createRateGuard, normalizeRoomText } from '../src/lib/room/rateLimit';
import {
  createEncryptionIdentity,
  decryptFrom,
  encryptFor,
  importEncryptionIdentity,
  parseSerializedEncryptionIdentity,
  samePublicKey,
} from '../src/lib/room/secureChannel';
import { clearRoomSession, loadRoomSession, saveRoomSession } from '../src/lib/room/session';
import {
  createSeatToken,
  hashSeatToken,
  normalizeReaction,
  normalizeSeatLedger,
  parseAuthenticatedRequest,
  parseHostChallenge,
  parseHostChallengeClaim,
  parseHostProof,
  parseJoinRequest,
  parsePlayerAction,
  parseSecureWelcome,
  verifySeatToken,
} from '../src/lib/room/semPerdaoProtocol';

const meta = {
  roomCode: 'ABCD5',
  gameId: 'game-00000001',
  authorityEpoch: 'authority-0001',
  hostId: 0,
  senderId: 0,
  senderConnectionId: 'connection-0001',
  revision: 7,
  sentAt: 1234,
};

test('envelope rejeita sala, autoridade, origem e versão incompatíveis', () => {
  const envelope = createRoomEnvelope('game_state', { round: 3 }, meta);

  expect(parseRoomEnvelope(envelope, {
    roomCode: 'ABCD5',
    authorityEpoch: 'authority-0001',
    hostId: 0,
    senderConnectionId: 'connection-0001',
    kinds: ['game_state'],
  })).toEqual(envelope);
  expect(parseRoomEnvelope(envelope, { roomCode: 'OUTRA' })).toBeNull();
  expect(parseRoomEnvelope({ ...envelope, protocol: 1 }, { roomCode: 'ABCD5' })).toBeNull();
  expect(parseRoomEnvelope({ ...envelope, authorityEpoch: 'authority-antiga' }, {
    roomCode: 'ABCD5',
    authorityEpoch: 'authority-0001',
  })).toBeNull();
});

test('cursor ordena revisões e permite uma nova partida ou autoridade', () => {
  const envelope = createRoomEnvelope('game_state', {}, meta);
  const current = cursorFromEnvelope(envelope)!;

  expect(shouldAcceptSnapshot(current, { ...current, revision: 6 })).toBe(false);
  expect(shouldAcceptSnapshot(current, { ...current, revision: 7 })).toBe(true);
  expect(shouldAcceptSnapshot(current, { ...current, revision: 8 })).toBe(true);
  expect(shouldAcceptSnapshot(current, { ...current, gameId: 'game-00000002', revision: 0 })).toBe(true);
  expect(shouldAcceptSnapshot(current, {
    ...current,
    authorityEpoch: 'authority-0002',
    revision: 0,
  })).toBe(true);
});

test('ECDH cifra para uma única conexão e rejeita outra identidade', async () => {
  const host = await createEncryptionIdentity();
  const guest = await createEncryptionIdentity();
  const intruder = await createEncryptionIdentity();
  const encrypted = await encryptFor(host, guest.publicKey, { secret: 'mão privada' });

  await expect(decryptFrom(guest, host.publicKey, encrypted)).resolves.toEqual({ secret: 'mão privada' });
  await expect(decryptFrom(intruder, host.publicKey, encrypted)).rejects.toBeTruthy();

  const restoredHost = await importEncryptionIdentity(host.serialized);
  expect(samePublicKey(restoredHost.publicKey, host.publicKey)).toBe(true);
  await expect(decryptFrom(restoredHost, guest.publicKey, await encryptFor(guest, host.publicKey, {
    secret: 'sobrevive ao F5',
  }))).resolves.toEqual({ secret: 'sobrevive ao F5' });
  expect(parseSerializedEncryptionIdentity({
    ...host.serialized,
    publicKey: guest.publicKey,
  })).toBeNull();
});

test('rate limit é aplicado por identidade e normaliza controles Unicode', () => {
  const guard = createRateGuard({ limit: 2, windowMs: 1_000, cooldownMs: 5_000 });
  expect(guard.accept('a', 0).ok).toBe(true);
  expect(guard.accept('a', 100).ok).toBe(true);
  expect(guard.accept('a', 200)).toEqual({ ok: false, retryAfterMs: 5_000 });
  expect(guard.accept('b', 200).ok).toBe(true);
  expect(guard.accept('a', 5_199).ok).toBe(false);
  expect(guard.accept('a', 5_200).ok).toBe(true);

  expect(normalizeRoomText('  oi\u0000\n  mesa   💀💀  ', 11)).toBe('oi mesa 💀💀');
});

test('sessão expira, respeita a sala e tolera storage indisponível', () => {
  const data = new Map<string, string>();
  const storage = {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { data.set(key, value); },
    removeItem: (key: string) => { data.delete(key); },
  } as unknown as Storage;

  expect(saveRoomSession(storage, 'session', 'ABCD5', { playerId: 2 }, 1_000)).toBe(true);
  expect(loadRoomSession(storage, 'session', 'ABCD5', 10_000, 5_000)).toEqual({ playerId: 2 });
  expect(loadRoomSession(storage, 'session', 'OUTRA', 10_000, 5_000)).toBeNull();
  expect(loadRoomSession(storage, 'session', 'ABCD5', 1_000, 5_000)).toBeNull();
  clearRoomSession(storage, 'session');
  expect(data.has('session')).toBe(false);
});

test('status e confirmação de presença nunca deixam a entrada presa', async () => {
  expect(channelStatusOutcome('SUBSCRIBED', false)).toBe('subscribed');
  expect(channelStatusOutcome('CLOSED', true)).toBe('reconnect');
  expect(channelStatusOutcome('CLOSED', false)).toBe('fail');
  expect(channelStatusOutcome('JOINING', false)).toBe('ignore');

  await expect(trackPresence({ track: async () => 'ok' }, {}, 10)).resolves.toBe('ok');
  await expect(trackPresence({ track: async () => 'error' }, {}, 10)).resolves.toBe('error');
  await expect(trackPresence({ track: () => new Promise(() => {}) }, {}, 2)).resolves.toBe('pending');
});

test('credenciais de assento são fortes, comparáveis por hash e o ledger é curado', async () => {
  const token = createSeatToken();
  const tokenHash = await hashSeatToken(token);

  expect(token.length).toBeGreaterThanOrEqual(40);
  expect(tokenHash).toMatch(/^[a-f0-9]{64}$/);
  expect(await hashSeatToken(token)).toBe(tokenHash);
  expect(await verifySeatToken(2, token, [{ playerId: 2, tokenHash }])).toBe(true);
  expect(await verifySeatToken(2, createSeatToken(), [{ playerId: 2, tokenHash }])).toBe(false);
  expect(normalizeSeatLedger([
    { playerId: 2, tokenHash },
    { playerId: 2, tokenHash },
    { playerId: -1, tokenHash },
    { playerId: 3, tokenHash: 'roubado' },
  ])).toEqual([{ playerId: 2, tokenHash }]);
});

test('troca de host exige desafio válido e boas-vindas carregam a âncora da mesa', async () => {
  const host = await createEncryptionIdentity();
  const guest = await createEncryptionIdentity();
  const token = createSeatToken();
  const tokenHash = await hashSeatToken(token);
  const claim = {
    nonce: 'challenge-000001',
    targetHostId: 2,
    authorityEpoch: 'authority-0002',
    hostConnectionId: 'connection-host2',
    clientId: 'client-00000001',
    connectionId: 'connection-0001',
  };
  const encrypted = await encryptFor(guest, host.publicKey, claim);
  const challenge = parseHostChallenge({
    targetHostId: 2,
    clientId: 'client-00000001',
    connectionId: 'connection-0001',
    publicKey: guest.publicKey,
    encrypted,
  });
  expect(challenge?.targetHostId).toBe(2);
  expect(parseHostChallenge({ ...challenge, publicKey: { kty: 'oct' } })).toBeNull();
  expect(parseHostChallengeClaim(await decryptFrom(host, guest.publicKey, encrypted))).toEqual(claim);

  expect(parseHostChallengeClaim(claim)).toEqual(claim);
  const proof = {
    ...claim,
    hostId: 2,
    targetClientId: 'client-00000001',
    targetConnectionId: 'connection-0001',
  };
  expect(parseHostProof(proof)?.hostId).toBe(2);
  const encryptedProof = await encryptFor(host, guest.publicKey, proof);
  expect(parseHostProof(await decryptFrom(guest, host.publicKey, encryptedProof))).toEqual(proof);

  const welcome = parseSecureWelcome({
    playerId: 4,
    token: createSeatToken(),
    clientId: 'client-00000001',
    connectionId: 'connection-0001',
    authorityEpoch: 'authority-0002',
    hostConnectionId: 'connection-host2',
    privateTopic: 'spv2-private-0001',
    seatLedger: [
      { playerId: 2, tokenHash, publicKey: host.publicKey },
      { playerId: 4, tokenHash, publicKey: guest.publicKey },
    ],
  });
  expect(welcome?.seatLedger).toEqual([
    { playerId: 2, tokenHash, publicKey: host.publicKey },
    { playerId: 4, tokenHash, publicKey: guest.publicKey },
  ]);
});

test('parser de pedidos nunca aceita identidade, ação ou spam arbitrários', async () => {
  const guest = await createEncryptionIdentity();
  const join = parseJoinRequest({
    clientId: 'client-00000001',
    connectionId: 'connection-0001',
    name: '  Fulano\u0000  da Silva  ',
    appearance: { robe: 'violet', hood: 'spire', face: 'grin', accent: 'gold', accessory: 'chain' },
    publicKey: guest.publicKey,
  });
  expect(join?.name).toBe('Fulano da Silva');
  expect(join?.appearance.robe).toBe('violet');

  expect(parsePlayerAction({ type: 'submit', cardIds: ['a', 'a'] })).toBeNull();
  expect(parsePlayerAction({ type: 'judge', index: 999 })).toBeNull();
  expect(parsePlayerAction({ type: 'next_round', playerId: 999 })).toEqual({
    type: 'next_round',
    phaseId: undefined,
  });

  const token = createSeatToken();
  expect(parseAuthenticatedRequest({
    requestId: 'request-0000001',
    token,
    request: { type: 'chat', text: '  alô\u0000   mesa  ' },
  })?.request).toEqual({ type: 'chat', text: 'alô mesa' });
  expect(parseAuthenticatedRequest({
    requestId: 'request-0000002',
    token,
    request: { type: 'ready', ready: 'sim', lobbySeq: 1 },
  })).toBeNull();

  expect(normalizeReaction('💀')).toBe('💀');
  expect(normalizeReaction('throw:tomate:7')).toBe('throw:tomate:7');
  expect(normalizeReaction('<img src=x>')).toBeNull();
});
