export interface StoredRoomSession<T> {
  version: 1;
  roomCode: string;
  savedAt: number;
  value: T;
}

export function saveRoomSession<T>(
  storage: Storage | null | undefined,
  key: string,
  roomCode: string,
  value: T,
  now = Date.now()
): boolean {
  if (!storage || !key || !roomCode) return false;
  try {
    const snapshot: StoredRoomSession<T> = {
      version: 1,
      roomCode: roomCode.toUpperCase(),
      savedAt: now,
      value,
    };
    storage.setItem(key, JSON.stringify(snapshot));
    return true;
  } catch {
    return false;
  }
}

export function loadRoomSession<T>(
  storage: Storage | null | undefined,
  key: string,
  roomCode: string,
  maxAgeMs: number,
  now = Date.now()
): T | null {
  if (!storage || !key || !roomCode) return null;
  try {
    const parsed = JSON.parse(storage.getItem(key) ?? 'null') as StoredRoomSession<T> | null;
    if (
      !parsed
      || parsed.version !== 1
      || parsed.roomCode !== roomCode.toUpperCase()
      || !Number.isFinite(parsed.savedAt)
      || now - parsed.savedAt > maxAgeMs
      || now < parsed.savedAt - 60_000
    ) return null;
    return parsed.value;
  } catch {
    return null;
  }
}

export function clearRoomSession(storage: Storage | null | undefined, key: string): void {
  try {
    storage?.removeItem(key);
  } catch {
    // Persistência é melhor esforço; a sala continua funcionando sem storage.
  }
}
