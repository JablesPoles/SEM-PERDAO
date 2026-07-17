# CONCEITO VISUAL — MESA 3D "SEM PERDÃO"

Direção de arte para o ambiente 3D retrô pixelado. Evolui a opção **1c Brutal
Minimal** (`Direções Visuais.dc.html`) para o mundo 3D sem trair a identidade:
creme, preto, vermelho — agora com profundidade, luz e réus sentados à mesa.
Protótipo técnico em `/3d` (branch `experimento-3d`).

---

## 1. A ideia-mãe: o Tribunal do Porão

O jogo já fala em **juiz, provas, condenar, CULPADO**. O mundo 3D assume isso
de vez: a partida acontece num **tribunal clandestino de madrugada** — uma mesa
num porão, uma lâmpada pendurada, escuridão em volta e gente demais disposta a
condenar os amigos. Não é terror realista: é **sinistro-cômico**, o cenário
leva o julgamento a sério e as pessoas não.

O retrô pixelado (PS1/DOS) é o veículo perfeito: a escuridão esconde a
geometria barata, o dithering vira grão de filme, o serrilhado vira textura.

**Referências de régua** (pra conversar, não pra copiar): *Inscryption* (mesa
sombria + cartas + criatura do outro lado), *Buckshot Roulette* (tensão PS1),
*World of Horror* (pavor 1-bit com humor), Rayman (membros flutuantes baratos
e expressivos).

## 2. Pilares do mundo (as regras que não se quebram)

1. **A escuridão é o cenário.** Só existe o que a luz alcança. Nada de paredes
   detalhadas: o breu em volta da mesa É o porão. Fog fecha o mundo a ~25m.
2. **Uma lâmpada só.** Pendurada sobre a mesa, luz quente creme, balança de
   leve e **range**. Ela é a personagem-narradora: pisca quando o host cai,
   acelera o pisca-pisca quando o timer aperta, apaga no veredito final.
3. **O vermelho é veredito, nunca decoração.** Vermelho aparece apenas onde há
   julgamento: friso da mesa, carimbo, spotlight do CULPADO, martelo. Ele não
   tem fonte de luz diegética — o vermelho vem "de lugar nenhum", de propósito.
4. **Barato de propósito.** Low-poly assumido, texturas serrilhadas
   (NearestFilter), sombras duras de 512px, pixel size 3–4, posterização ~7
   níveis + Bayer 4x4. Se um asset parecer "bonito demais", ele está errado.

## 3. Paleta

Mantém o brutal minimal de 3 cores — a disciplina é a identidade:

| Papel | Cor | Uso no 3D |
| --- | --- | --- |
| Tinta | `#17161a` | O breu, cartas pretas, silhuetas |
| Papel | `#f2efe9` | Cartas brancas, luz da lâmpada (levemente quente `#fff4e0`) |
| Veredito | `#ff3b2f` | SOMENTE julgamento (pilar 3) |
| Painel | `#26252b` | Mesa, versos, móveis do porão |
| Sangue seco | `#8a2620` | Vermelho "usado": detalhes envelhecidos, réus |

Os corpos dos réus usam a paleta do `avatar.ts` (que já é essa família de
tons + os desvios laranja/roxo) — a luz da cena amansa tudo pro mesmo mundo.
**Nenhuma cor nova entra** sem passar por aqui.

## 4. Os avatares: "Os Réus"

A mesa é multiplayer — cada jogador é um **réu sentado**. É onde mora a
personalidade e o caos.

### Anatomia (barata e expressiva)

- **Busto low-poly** (cabeça + ombros, sem braços) na cor `avatarColor(id)`,
  com as iniciais do jogador num **crachá** no peito (textura canvas — mesma
  continuidade do 2D).
- **Mãos flutuantes estilo Rayman**: dois "blocos-luva" soltos que só aparecem
  pra agir — bater na mesa, apontar, jogar carta, aplaudir, facepalm. Zero
  rigging, máximo caos.
- **Rosto = sprite pixelado** (billboard na cabeça): meia dúzia de expressões
  desenhadas em canvas e trocadas como frames — neutro, riso, choque,
  desprezo, tédio, dormindo. Troca seca de sprite é mais retrô (e mais
  engraçada) que blend suave.

### Papéis à mesa

- **O Juiz**: cadeira mais alta na cabeceira, **martelo** ao alcance e um
  adereço de autoridade (capuz preto ou peruca branca torta). No modo
  Democracia, todo mundo ganha um martelinho — a anarquia é visual.
- **Ausente/desconectado**: o busto vira um **manequim de loja** com plaqueta
  "AUSENTE" pendurada. A mesa segue jogando por ele (como o jogo já faz).
- **Bots**: manequim de fábrica com crachá "RANDO" (tradição Rando
  Cardrissian).
- **Chapéus/cabeças temáticas** (backlog divertido): saco de papel, balaclava,
  cone de trânsito, caixa de papelão do escritório, abajur na cabeça. Sorteio
  ou escolha no lobby.

## 5. Animação: rápido e caótico

Princípios inegociáveis:

- **Nada acima de ~400ms.** Easing agressivo (easeOutBack/expo). O jogo é uma
  metralhadora de piadas; a animação nunca segura a rodada.
- **Tudo interrompível e sobreposto.** Duas reações ao mesmo tempo? Que se
  atropelem. Caos é feature.
- **Cortes secos de câmera** entre os atos (sem tween suave) — linguagem de
  filme barato, e o ritmo agradece.

### Catálogo por fase

| Fase | O que acontece na mesa |
| --- | --- |
| Lobby | Réus chegam e sentam (a cadeira arrasta), idle respirando dessincronizado, lâmpada range quando alguém entra |
| Submissão | Cartas voam da mão girando feito frisbee e batem no centro com nuvem de poeira; quem já jogou cruza as mãos; timer = lâmpada piscando cada vez mais rápido |
| Julgamento | Corte de câmera pro centro; provas reveladas com o flip+pulo; a carta "sendo lida" levanta e treme; o juiz se inclina |
| Veredito | **Martelo bate** (1 frame de screen shake + som seco), spotlight vermelho cai no culpado, carimbo CULPADO 3D esmaga a carta, +1 pop no placar; os outros vaiam/batem na mesa |
| Reações | Emojis do chat viram objetos arremessados por cima da mesa (tomate, sapato, rosa) que quicam e somem; balões de fala pixelados sobre as cabeças |
| Vitória | Luzes apagam, um spotlight só no vencedor, confete preto e vermelho; opcional-sombrio: alçapão cômico engole os perdedores (fade + risada) |
| Host caiu | A lâmpada pisca, todo mundo olha pra cima, ela estabiliza quando o novo host assume — o problema técnico virou cena |

## 6. Câmera

- **POV base: a sua cadeira.** Primeira pessoa sentada, sua mão em leque na
  parte de baixo da tela (estilo Inscryption). Você não é um drone — você está
  NA mesa, sendo julgado com os outros.
- **Cortes por ato**: mesa inteira → close das provas → juiz → placar.
- Órbita livre limitada ("esticar o pescoço"), volta sozinha pro POV.

## 7. Som (esboço — casa com `lib/sounds.ts`)

Tudo lo-fi/bitcrushed: rangido da lâmpada, carta áspera deslizando, martelo
com reverb de porão, murmúrio de plateia abafado, risada seca. Música: nenhuma
— ou um drone grave quase inaudível. O silêncio é o palco da piada.

## 8. UI dentro do mundo (princípio pra próxima etapa)

**O que puder ser objeto, vira objeto**: placar numa lousa/ficha sobre a mesa,
nomes em crachás, timer na lâmpada. HUD 2D só pro que precisa de precisão
(chat, config, botões de ação) — creme sobre preto, pixelado, mínimo. Detalhar
quando fecharmos esta direção.

## 9. Ordem de construção sugerida (depois do OK neste doc)

1. **Lâmpada + nova escuridão** na cena `/3d` — valida o mood sozinha
2. **Réus**: bustos + crachás + rostos sprite com 4 expressões
3. **Ato do veredito**: martelo, shake, spotlight, carimbo 3D
4. Reações arremessadas + balões
5. Cortes de câmera por ato
6. → Aí sim: design de UI e ligação com o `GameState` real
