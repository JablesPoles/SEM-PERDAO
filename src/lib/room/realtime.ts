export const PRESENCE_ACK_TIMEOUT_MS = 2_500;
export const RECONNECT_GIVE_UP_MS = 45_000;

export type ChannelOutcome = 'subscribed' | 'reconnect' | 'fail' | 'ignore';

export function channelStatusOutcome(status: string, hasRoom: boolean): ChannelOutcome {
  if (status === 'SUBSCRIBED') return 'subscribed';
  if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
    return hasRoom ? 'reconnect' : 'fail';
  }
  return 'ignore';
}

interface PresenceChannel {
  track: (payload: Record<string, unknown>) => Promise<unknown> | unknown;
}

export async function trackPresence(
  channel: PresenceChannel,
  payload: Record<string, unknown>,
  timeoutMs = PRESENCE_ACK_TIMEOUT_MS
): Promise<'ok' | 'error' | 'pending'> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const result = Promise.resolve()
    .then(() => channel.track(payload))
    .then((status) => status === 'ok' ? 'ok' as const : 'error' as const)
    .catch(() => 'error' as const);
  const deadline = new Promise<'pending'>((resolve) => {
    timeoutId = setTimeout(() => resolve('pending'), timeoutMs);
  });
  const status = await Promise.race([result, deadline]);
  if (status !== 'pending' && timeoutId) clearTimeout(timeoutId);
  return status;
}
