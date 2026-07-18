# HANDBOOK — MESA 3D "TRIBUNAL DO PORÃO"

Documento-vivo do experimento 3D do Sem Perdão. **Se você é uma sessão/modelo
novo pegando este trabalho: leia este arquivo + `CONCEITO-MESA-3D.md` e está
pronto pra continuar.** Atualize o roadmap aqui a cada entrega.

## Fluxo de trabalho combinado (NÃO mudar sem falar com o Poles)

1. Editar código → `npm run build` (tem que passar limpo) → commitar na branch
   `experimento-3d` → avisar o que mudou e o que observar.
2. Validar também no navegador em desktop e celular quando a alteração for
   visual ou mexer no fluxo. O usuário faz a aprovação final em
   `localhost:3000/3d` (hard reload Ctrl+Shift+R quando o HMR ficar velho).
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
| `src/app/3d/page.tsx` | Harness do experimento: fluxo simulado de 5 rodadas, mão/UI 2D, anúncios e roda de reações com alvo |
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
- `uPixel` — tamanho do pixelão (2 no harness; ainda ajustável pela API da cena)
- `uTime` — anima grão, faixa rolando e flicker
- No código do shader: curvatura de tubo (0.11), aberração cromática (0.022),
  máscara RGB (±0.015), scanlines (0.055), vinheta (0.8+0.2), pretos
  levantados (0.08), grão (0.025), cantos arredondados. A calibração v3
  preserva a TV velha sem triturar rostos e texto em fragmentos RGB.

### Luz (filosofia: cena VISÍVEL, clima vem do filtro + lâmpada)
- `HemisphereLight` creme/cinza 2.4 + preenchimento creme 1.1 — iluminação
  geral mais uniforme entre os assentos
- Lâmpada pendurada (`montarLampada`): SpotLight 230 (cone 1.12 — calculado
  pra alcançar as cabeças dos réus em raio 5.15), PointLight 10 no bulbo,
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
- Assentos em `montarReus`: **layout máximo de 8 jogadores** — az 0° é a SUA
  cadeira (POV), os outros 7 a cada 45°, juiz sempre em frente (180°). Com
  menos jogadores, omitem-se assentos; toda câmera/posição assume esse teto.

### Caos e veredito (retroMesa.ts)
- Gerador de caos: a cada 1.2–4s um réu aleatório muda expressão e/ou faz
  uma ação espontânea (soco/rir/facepalm/apontar)
- `martelada()`: juiz ergue (45% do tempo), CRAVA (13%), assenta; no impacto:
  screen shake 0.22 com decaimento exp, todos fazem cara de choque, som
- Os controles de laboratório saíram da página. Os atos são disparados pelas
  fases da rodada; a órbita manual continua limitada dentro de cada ato.
- Reações v1: `testarReacao(tipo)` cria tomate, sapato ou rosa low-poly e
  arremessa numa Bézier curta de um réu ao outro lado da mesa. Objetos giram,
  somem e liberam geometria/material ao fim.
- Fala v1: `testarFala()` cria um plano billboard com balão em textura canvas
  pixelada sobre o juiz; acompanha a câmera, sobe levemente e desaparece.
- Reações com alvo: `arremessarEm(nome, tipo)` parte da cadeira do jogador,
  acerta o réu escolhido e dispara expressão/ação. A fila é limitada a 8
  objetos simultâneos para spam não crescer sem limite.

### Fluxo do harness `/3d`
- A página simula cinco rodadas: `aguardando → jogando → julgando →
  deliberando → sentenciando → condenado → fim`.
- O máximo são **8 pessoas contando o juiz**. Logo, numa rodada de modo juiz
  existem **7 provas**: seis respostas dos outros réus + a resposta do POV.
- A mão começa com 8 brancas e repõe até 8 na rodada seguinte. O CTA só libera
  o julgamento depois que a carta do POV entrou na mesa.
- Pergunta e respostas dos NPCs são renovadas a cada rodada. O harness sorteia
  apenas pretas `pick: 1`; `pick > 1` será respeitado na integração real.
- Durante o julgamento, as sete provas abrem em sentido horário e a UI mostra
  frase combinada + autor. A mão some para não cobrir o palco.
- Provas não aceitam mais clique manual. O raycast por frame foi removido e as
  texturas de rodadas antigas são descartadas na troca, mantendo memória estável.
- Câmera e tamanho de pixel não são controles da UI final. Som/mute continua
  visível por ser configuração do jogador.

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
- [x] Protótipo pixel-pass + mesa + cartas (as provas deixaram de ser clicáveis
  quando o fluxo automático de julgamento entrou)
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
- [x] Atos de câmera com corte seco (`setAto`): mesa, POV, provas, juiz e
  cima; cada ato com limites próprios de órbita e FOV. A fase escolhe o ato;
  os botões de laboratório foram removidos da UI.
- [x] POV v2 first person de verdade: olho a 1.5 na cadeira vazia mirando o
  juiz, FOV 58 por ato. Mesa cheia de 8 lugares (7 réus a cada 45° + você).
- [x] **Decisão de design (Poles): cartas legíveis são UI 2D; a mesa 3D é o
  palco.** A mão 3D foi removida — virou mão 2D na página, e `jogarCarta()`
  é a ponte: clicou na UI, a carta voa da sua cadeira até o anel de provas.
- [x] Provas alinhadas aos donos durante o harness: 6 chegam lacradas e o 7º
  slot é do jogador. O oitavo assento pertence ao juiz e não envia resposta.
- [x] Veredito completo: a martelada sorteia uma prova, revela, acende
  spotlight vermelho e o carimbo CULPADO esmaga a carta (fica na mesa até a
  próxima martelada; a luz esvai sozinha).
- [x] Harness jogável de 5 rodadas: anúncios, mão 2D, trava de envio, sete
  revelações automáticas, frase+autor, sentença e renovação de cartas.
- [x] Roda de tomate/sapato/rosa com alvo derivado dos réus da cena.
- [x] UI responsiva validada em 1440×900 e 390×844; mão móvel começa na
  primeira carta e rola horizontalmente, sem cobrir o julgamento.
- [x] Higiene de runtime: sem raycast ocioso, limite de reações, descarte das
  texturas de rodada e dos recursos restantes do passe CRT.

### Agora
- [ ] Publicar esta leva e colher a calibração visual final do Poles.
- [ ] Transformar a cena num renderer somente de leitura do `GameState` real,
  mantendo o `GameBoard` 2D como única superfície de ações.

### Próximo (ordem do conceito §9)
- [ ] Criar `MesaView`/projetor sem segredos e `GameStage3D.sync(view)`
  idempotente. Assentos devem ser dinâmicos (3–8), com o cliente em az 0°.
- [ ] No início do julgamento, romper a associação visual prova↔autor e montar
  o anel na ordem embaralhada do host; só revelar texto conforme `gs.revealed`.
- [ ] No `round-end`, derivar culpado de `roundWinnerId`; a cena real nunca
  sorteia resultado. Suportar combos de pretas `pick > 1`.
- [ ] Timer diegético: lâmpada pisca acelerando; migração de host = lâmpada
  pisca e estabiliza
- [ ] Vitória: blackout + spotlight único + confete preto/vermelho
- [ ] Customização dos cultistas (olhos, capuz, adereços, crachá)
- [ ] UI dentro do mundo (placar-lousa, crachás-nome, HUD 2D mínimo)

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
- O `/3d` ainda é um harness local e revela autores para demonstrar a direção.
  No modo juiz real, autor e texto lacrado não podem ser inferidos pela posição.
- O broadcast atual é host-autoritativo contra divergência acidental, mas não
  é um limite de segurança contra cliente malicioso: snapshots por `target`
  compartilham o mesmo canal e eventos não têm autenticação de remetente. Antes
  de produto público, mover autoridade/segredos para transporte privado ou
  servidor autenticado.
