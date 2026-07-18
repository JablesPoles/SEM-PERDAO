# HANDBOOK — MESA 3D "TRIBUNAL DO PORÃO"

Documento-vivo do experimento 3D do Sem Perdão. **Se você é uma sessão/modelo
novo pegando este trabalho: leia este arquivo + `CONCEITO-MESA-3D.md` e está
pronto pra continuar.** Atualize o roadmap aqui a cada entrega.

## Fluxo de trabalho combinado (NÃO mudar sem falar com o Poles)

1. Editar código → `npm run build` (tem que passar limpo) → commitar na branch
   `experimento-3d` → avisar o que mudou e o que observar.
2. **Quem testa é o usuário**, no navegador dele (localhost:3000/3d, hard
   reload Ctrl+Shift+R — HMR não recria a cena 3D). NÃO abrir browser nem
   tirar screenshot por conta própria; ele devolve feedback e segue o ciclo.
3. Commits: identidade `JablesPoles <matheuspolesnunes@gmail.com>`, mensagem
   em PT-BR sem aspas duplas (o here-string do PowerShell engasga).
4. Tudo em PT-BR (código, comentários, UI). Produção (`main`) intocada; o
   deploy de teste será preview do Vercel via push da branch.

## Visão em uma frase

Cards Against Humanity num **tribunal clandestino de porão**, retrô-pixelado
com filtro de TV velha, onde os jogadores são **cultistas encapuzados com
crachá de escritório** — sinistro-cômico, rápido e caótico (Buckshot Roulette
+ Inscryption + Rayman). Pilares no `CONCEITO-MESA-3D.md`; o mais importante:
**vermelho só aparece onde há julgamento**.

## Mapa de arquivos

| Arquivo | O que é |
| --- | --- |
| `src/app/3d/page.tsx` | Página do experimento: monta a cena, seletor de pixel (1/2/3), painel "laboratório de caos" com botões de teste |
| `src/lib/three/retroMesa.ts` | A cena: mesa, lâmpada, cartas, pipeline de render, filtro CRT, caos, martelada |
| `src/lib/three/reus.ts` | Classe `Reu` (cultista): modelo, expressões, ações animadas |
| `src/lib/three/sons3d.ts` | Sons do porão sintetizados (Web Audio, sem assets) |
| `ref/CONCEITO-MESA-3D.md` | Direção de arte completa (aprovada pelo Poles) |
| `FDP/src/lib/three/` (outro repo) | Referência: a mesa 3D do FDP que originou a técnica |

## Sistemas e knobs de ajuste

### Pipeline de render (retroMesa.ts)
Cena → render target pequeno (`largura / pixelSize`, NearestFilter) → quad
fullscreen com o shader do **filtro CRT**. O retrô vem DAÍ, não dos modelos
(modelos podem ser suaves). Uniforms do shader:

- `uLevels` (8) — níveis de posterização por canal
- `uDither` (0.58) — força do dithering Bayer 4x4 (alinhado ao pixelão)
- `uPixel` — tamanho do pixelão (sincronizado com o seletor da página)
- `uTime` — anima grão, faixa rolando e flicker
- No código do shader: curvatura de tubo (0.11), aberração cromática (0.022),
  máscara RGB (±0.015), scanlines (0.055), vinheta (0.68+0.32), pretos
  levantados (0.055), grão (0.025), cantos arredondados. A calibração v3
  preserva a TV velha sem triturar rostos e texto em fragmentos RGB.

### Luz (filosofia: cena VISÍVEL, clima vem do filtro + lâmpada)
- `HemisphereLight` creme/cinza 1.75 + preenchimento creme 0.65 — iluminação
  geral mais uniforme entre os assentos
- Lâmpada pendurada (`montarLampada`): SpotLight 170 (cone 1.12 — calculado
  pra alcançar as cabeças dos réus em raio 5.15), PointLight 8 no bulbo,
  balanço senoidal, zumbido (±6%) e apagões de susto (~0.2% por frame)
- `DirectionalLight` vermelho começa apagado e só acende durante a martelada;
  o friso da mesa segue a mesma regra (painel no cotidiano, vermelho no veredito)

### Os Réus (reus.ts)
- Túnica: LatheGeometry (perfil drapeado) + textura de tecido em canvas;
  capuz: esfera parcial com abertura; dentro, o vazio preto e a **carinha
  luminosa** (olhos+boca MeshBasic — sempre brilham; juiz em vermelho).
  A carinha é FILHA do grupo do capuz (acompanha inclinação/escala).
- Calibração v3: abertura do capuz mais larga; rosto 0.15 acima e um pouco à
  frente do vazio, 0.44×0.33; emissivo sutil no tecido evita réus sumirem.
- Calibração v4: túnica mais curta e menos triangular; cowl próprio liga os
  ombros à cabeça; capuz oval maior no topo; rosto recuado para z=0.335 e
  novamente perto do vazio, ainda com a flutuação estilizada.
- Crachá v2: credencial 128×80 com cabeçalho/nome, backing preto com espessura
  e lanyard tubular em V; fica fora da superfície da túnica. Manequins não
  duplicam mais crachá + placa: usam só a plaqueta RANDO/AUSENTE, também com
  backing e cordão próprios.
- Expressões: neutro, riso, choque, desprezo, sono (`drawRosto`, 64x48 px)
- Ações (`acao()`): soco, apontar, aplaudir, festejar, facepalm, rir —
  durações em `DURACAO`, envelope `pulso()` sobe-segura-volta, tudo
  interrompível. Mãos = luvas flutuantes (Rayman), corpo participa.
- Juiz: capuz 1.18x, rosto vermelho, trono, martelo. Manequim (bot/ausente):
  túnica cinza, capuz SEM rosto, plaqueta pendurada.
- Assentos em `montarReus` (azimute 0° = cadeira do POV futuro do jogador)

### Caos e veredito (retroMesa.ts)
- Gerador de caos: a cada 1.2–4s um réu aleatório muda expressão e/ou faz
  uma ação espontânea (soco/rir/facepalm/apontar)
- `martelada()`: juiz ergue (45% do tempo), CRAVA (13%), assenta; no impacto:
  screen shake 0.22 com decaimento exp, todos fazem cara de choque, som
- API de teste da página: `testarExpressao(e)`, `testarAcao(a)`, `martelada()`
- Câmera de laboratório: enquadramento fixo próximo do POV; órbita manual
  continua disponível, mas a rotação automática foi desligada.
- Reações v1: `testarReacao(tipo)` cria tomate, sapato ou rosa low-poly e
  arremessa numa Bézier curta de um réu ao outro lado da mesa. Objetos giram,
  somem e liberam geometria/material ao fim.
- Fala v1: `testarFala()` cria um plano billboard com balão em textura canvas
  pixelada sobre o juiz; acompanha a câmera, sobe levemente e desaparece.

### Sons (sons3d.ts)
Sintetizados (ruído filtrado + osciladores), respeitam o mute do jogo
(`sp-muted`). Martelada, soco, palmas, carta, zap da lâmpada, risada,
assobio de festa. Um drone grave contínuo (duas notas subgraves + ventilação
filtrada, modulação lenta) começa no primeiro gesto e encerra em fade ao sair
da cena. O seletor SOM na página usa o mesmo mute do jogo. Browsers só liberam
áudio após primeiro gesto — sons do caos automático antes disso falham em
silêncio (ok).
- Reações ganharam whoosh curto; balões usam dois estalos de máquina de escrever.

## Roadmap (atualizar a cada entrega)

### Feito
- [x] Protótipo pixel-pass + mesa + cartas + provas clicáveis (rota /3d)
- [x] Doc de conceito "Tribunal do Porão" aprovado
- [x] Lâmpada pendurada (balanço, zumbido, apagões) + escuridão → v2 visível
- [x] Réus v1 (bustos) → v2 (encapuzados olhos brilhantes) → v3 (domo+boca)
  → v4 (túnica drapeada, capuz tecido, corda, luvas)
- [x] Sistema de ações animadas + painel de teste + martelada com shake
- [x] Filtro CRT v1 (scanlines, vinheta, grão, faixa) → v2 (curvatura,
  aberração cromática, máscara RGB, cantos de vidro, flicker)
- [x] Texturas: tecido nas túnicas, feltro na mesa, concreto no chão
- [x] Sons do porão sintetizados ligados às ações
- [x] Calibração v3: rosto/capuz, leitura do CRT, luz uniforme, vermelho só no
  veredito, câmera fixa e drone ambiente com mute
- [x] Calibração v4 do cultista: túnica curta + cowl + capuz maior no topo +
  rosto recuado
- [x] Crachás v2 externos com backing/lanyard + plaqueta exclusiva do manequim
- [x] Protótipo de reações arremessadas (tomate/sapato/rosa) + balão pixelado
- [x] Atos de câmera com corte seco (`setAto`): mesa, POV (cadeira vazia az 0°,
  mão como faixa inferior), provas, juiz (close no breu, olhos vermelhos) e
  cima; cada ato com limites próprios de órbita ("esticar o pescoço").
  Botões CÂMERA no topo da página. Branch publicada no GitHub → preview Vercel.

### Agora (aguardando feedback do Poles)
- [ ] Validar calibração v4, reações e os 5 atos de câmera (POV/JUIZ novos)

### Próximo (ordem do conceito §9)
- [ ] Timer diegético: lâmpada pisca acelerando; migração de host = lâmpada
  pisca e estabiliza
- [ ] Ato do veredito completo: spotlight vermelho no culpado + carimbo
  CULPADO 3D esmagando a carta
- [ ] Vitória: blackout + spotlight único + confete preto/vermelho
- [ ] Customização dos cultistas (olhos, capuz, adereços, crachá)
- [ ] UI dentro do mundo (placar-lousa, crachás-nome, HUD 2D mínimo)
- [ ] Ligar no `GameState` real (renderer alternativo do GameBoard — a
  arquitetura host-autoritativo/redação NÃO muda, ver HANDOFF.md)
- [ ] Push da branch → preview Vercel pra galera testar

## Armadilhas conhecidas

- Cena 3D não sobrevive a HMR: mudou módulo da cena → usuário precisa de
  hard reload; se aparecer "X is not a function", reiniciar o dev server.
- O loop usa `THREE.Timer` conectado ao `document` (pausa corretamente com a
  aba oculta). Luzes do three são físicas: SpotLight/PointLight em candela —
  números grandes (dezenas/centenas) são normais.
- Fontes: texturas de canvas precisam de `document.fonts.ready` antes (a
  página já espera) e leem a família real via var CSS `--font-archivo-black`.
- Nunca enviar campos secretos novos sem redigir em `redactStateFor`
  (regra do jogo real, ver HANDOFF.md §Convenções).
