import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  console.warn(
    'SEM PERDÃO: NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY não configurados — as salas online não vão conectar. Veja .env.example.'
  );
}

// Placeholders mantêm o app renderizando; o online só conecta com as env vars.
export const supabase = createClient(
  url ?? 'https://placeholder.supabase.co',
  anonKey ?? 'placeholder-anon-key',
  {
    realtime: {
      // Heartbeat padrão é 25s — operadoras/NAT derrubam socket ocioso antes
      // disso. Pingar mais rápido mantém a conexão e detecta queda cedo.
      heartbeatIntervalMs: 15000,
      reconnectAfterMs: (tries: number) => Math.min(1000 * 2 ** (tries - 1), 10000),
    },
  }
);
