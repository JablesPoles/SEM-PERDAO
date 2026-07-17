# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.

# Design

- Direção visual: "Brutal Minimal — Sem Perdão" (opção 1c em `ref/Direções Visuais.dc.html`) — creme `#f2efe9`, preto `#17161a`, vermelho `#ff3b2f`, Archivo Black/Archivo.
- Tokens e utilitários (`.lobby-bg`, `.table-bg`, `.btn-red`, `.btn-ink`, `.card-black`, `.card-white`) vivem em `src/app/globals.css`.

# Jogo

- As cartas vivem em `src/lib/cards.ts` (pretas com `____` por lacuna; pick é derivado). A lógica pura em `src/lib/game.ts`; o online replica o esquema host-autoritativo do FDP em `src/hooks/useMultiplayer.ts`.
