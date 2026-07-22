const encoder = new TextEncoder();
const decoder = new TextDecoder();

export interface EncryptionIdentity {
  cryptoApi: Crypto;
  privateKey: CryptoKey;
  publicKey: JsonWebKey;
  serialized: SerializedEncryptionIdentity;
}

export interface SerializedEncryptionIdentity {
  privateKey: JsonWebKey;
  publicKey: JsonWebKey;
}

export interface EncryptedMessage {
  iv: string;
  data: string;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

export function isEncryptedMessage(value: unknown): value is EncryptedMessage {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as Partial<EncryptedMessage>;
  return typeof candidate.iv === 'string'
    && candidate.iv.length >= 16
    && candidate.iv.length <= 64
    && typeof candidate.data === 'string'
    && candidate.data.length > 0
    && candidate.data.length <= 1_000_000;
}

export function isPublicKey(value: unknown): value is JsonWebKey {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const key = value as JsonWebKey;
  return key.kty === 'EC'
    && key.crv === 'P-256'
    && typeof key.x === 'string'
    && typeof key.y === 'string';
}

function isPrivateKey(value: unknown): value is JsonWebKey {
  return isPublicKey(value)
    && typeof (value as JsonWebKey).d === 'string'
    && (value as JsonWebKey).d!.length >= 32
    && (value as JsonWebKey).d!.length <= 128;
}

export function samePublicKey(left: JsonWebKey | null | undefined, right: JsonWebKey | null | undefined): boolean {
  return Boolean(
    left
    && right
    && left.kty === right.kty
    && left.crv === right.crv
    && left.x === right.x
    && left.y === right.y
  );
}

export function parseSerializedEncryptionIdentity(value: unknown): SerializedEncryptionIdentity | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = value as Partial<SerializedEncryptionIdentity>;
  if (!isPrivateKey(candidate.privateKey) || !isPublicKey(candidate.publicKey)) return null;
  if (!samePublicKey(candidate.privateKey, candidate.publicKey)) return null;
  return { privateKey: candidate.privateKey, publicKey: candidate.publicKey };
}

export async function createEncryptionIdentity(
  cryptoApi: Crypto = globalThis.crypto
): Promise<EncryptionIdentity> {
  if (!cryptoApi?.subtle) throw new Error('Criptografia segura indisponível.');
  const keyPair = await cryptoApi.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveKey']
  );
  const publicKey = await cryptoApi.subtle.exportKey('jwk', keyPair.publicKey);
  const privateKey = await cryptoApi.subtle.exportKey('jwk', keyPair.privateKey);
  return {
    cryptoApi,
    privateKey: keyPair.privateKey,
    publicKey,
    serialized: { privateKey, publicKey },
  };
}

export async function importEncryptionIdentity(
  value: unknown,
  cryptoApi: Crypto = globalThis.crypto
): Promise<EncryptionIdentity> {
  if (!cryptoApi?.subtle) throw new Error('Criptografia segura indisponível.');
  const serialized = parseSerializedEncryptionIdentity(value);
  if (!serialized) throw new Error('Identidade cifrada inválida.');
  const privateKey = await cryptoApi.subtle.importKey(
    'jwk',
    serialized.privateKey,
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveKey']
  );
  return {
    cryptoApi,
    privateKey,
    publicKey: serialized.publicKey,
    serialized,
  };
}

async function sharedKey(
  identity: EncryptionIdentity,
  publicKey: JsonWebKey,
  usage: KeyUsage
): Promise<CryptoKey> {
  if (!isPublicKey(publicKey)) throw new Error('Chave pública inválida.');
  const imported = await identity.cryptoApi.subtle.importKey(
    'jwk',
    publicKey,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    []
  );
  return identity.cryptoApi.subtle.deriveKey(
    { name: 'ECDH', public: imported },
    identity.privateKey,
    { name: 'AES-GCM', length: 256 },
    false,
    [usage]
  );
}

export async function encryptFor(
  identity: EncryptionIdentity,
  recipientPublicKey: JsonWebKey,
  value: unknown
): Promise<EncryptedMessage> {
  const iv = identity.cryptoApi.getRandomValues(new Uint8Array(12));
  const key = await sharedKey(identity, recipientPublicKey, 'encrypt');
  const encrypted = await identity.cryptoApi.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    encoder.encode(JSON.stringify(value))
  );
  return {
    iv: bytesToBase64(iv),
    data: bytesToBase64(new Uint8Array(encrypted)),
  };
}

export async function decryptFrom<T = unknown>(
  identity: EncryptionIdentity,
  senderPublicKey: JsonWebKey,
  encrypted: EncryptedMessage
): Promise<T> {
  if (!isEncryptedMessage(encrypted)) throw new Error('Mensagem cifrada inválida.');
  const key = await sharedKey(identity, senderPublicKey, 'decrypt');
  const decrypted = await identity.cryptoApi.subtle.decrypt(
    { name: 'AES-GCM', iv: base64ToBytes(encrypted.iv) },
    key,
    base64ToBytes(encrypted.data)
  );
  return JSON.parse(decoder.decode(decrypted)) as T;
}
