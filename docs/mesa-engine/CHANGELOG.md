# Registro do núcleo compartilhável

Toda mudança geral feita dentro de um jogo deve ganhar uma entrada aqui antes de
ser extraída. Registre contrato afetado, motivo, compatibilidade e ação exigida
dos outros repositórios.

## 2026-07-22 — expressão que não é morph target

### Adicionado

- `textureSlots` no `a-mesa.actor/v1` + `ActorTexturePainter`. Nem toda
  expressão é morph: o cultista tem a carinha desenhada num plano dentro do
  capuz, e essa arte é do jogo. A engine não pode saber desenhar um cultista,
  mas sabe **onde** colar o resultado — o manifesto declara o material e o
  callback entrega o pixel.
- Canal `emissive-mask`: a textura acende e recorta pelo alpha. É o que faz o
  rosto sobreviver ao blackout do ato final, quando ele mais importa.
- O repaint dispara em `setAppearance` **e** em `setExpression`, porque a cara
  depende das duas coisas.

### Compatibilidade e ação nos outros repositórios

- **Aditivo.** Manifesto sem `textureSlots` recebe `{}`; ator sem pintor mantém
  a textura embutida no asset. Slot que o jogo não sabe pintar é ignorado.
- Texturas pintadas são por instância e descartadas com o ator — a do template
  nunca é tocada, senão a mesa inteira herdaria o rosto de um réu só.
- Vale para qualquer jogo cuja expressão seja pixel e não geometria: placa,
  bandeira, mostrador, carta na mão.

## 2026-07-22 — assets saem de script, não de código

### Adicionado

- `tools/blender/` — os modelos do jogo passam a ser **gerados por script**
  headless (`blender --background --python`), não montados à mão em Three.js.
  `mesa_kit.py` traz a geometria paramétrica compartilhada; `cultist.py` e
  `props.py` trazem a direção de cada acervo. Cada execução produz o GLB e os
  PNGs de preview, então iterar é mudar um número e reexecutar.
- `a-mesa.props/v1` + `PropLibrary`: schema mínimo para malha estática nomeada.
  Ator tem contrato próprio porque carrega rig, clips e expressão; uma cadeira
  não precisa de nada disso, e exigir o contrato inteiro seria cerimônia sem
  retorno. Um GLB para todos os props — oito downloads de 10 KB custam mais em
  latência que um de 90 KB.
- `/lab/modelos`: vitrine do acervo inteiro num enquadramento só, com o custo
  geométrico ao lado do teto. O Character Lab valida **um** ator contra o
  contrato; esta página responde outra pergunta — se as peças pertencem ao
  mesmo mundo.

### Compatibilidade e ação nos outros repositórios

- **Carregamento é sempre oportunista.** `PropLibrary.load()` resolve `false`
  em qualquer falha e nunca lança; o consumidor segue com a geometria
  procedural. Asset ausente não pode esvaziar a mesa nem travar a montagem da
  cena — o palco do Sem Perdão troca o martelo **depois** que a biblioteca
  chega, e ninguém espera o download.
- Clones compartilham geometria e material. Quem precisar pintar um clone
  específico deve clonar o material antes, como o ator glTF faz.
- Vale para qualquer jogo d'A Mesa: props são o caso comum e o mais barato de
  portar. O Coup pode registrar o próprio GLB sem tocar em nada do núcleo.

### Armadilhas encontradas na produção destes assets

- **Blender 5.x guarda as curvas atrás de slots/layers de Action.** Mexer em
  `action.fcurves` quebra; definir
  `preferences.edit.keyframe_new_interpolation_type` antes de inserir keyframes
  funciona e é mais simples.
- **Desligar a Action não desfaz a pose.** Os ossos ficam onde o último keyframe
  os deixou — e se o último clip for um tombo, o preview e o GLB saem com a pose
  de defunto. Zere os ossos ao terminar de criar os clips.
- **`export_animation_mode='ACTIONS'` é obrigatório** para uma Action virar uma
  animação nomeada no glTF. Sem isso o exportador junta tudo numa timeline só e
  nenhum manifesto encontra clip.
- **Draw call de ator modular não é a soma do arquivo.** Três capuzes e três
  adereços vivem no mesmo GLB mas só um de cada aparece; somar tudo reprova um
  asset correto. `npm run actors:check` conta o pico da pior aparência.

## 2026-07-22 — ator modular: aparência sem multiplicar assets

### Adicionado

- `variants` e `palette` no `a-mesa.actor/v1`, e `TableActor.setAppearance()`.
  Personagem customizável não pode virar um asset por combinação: o cultista tem
  2.304 aparências e sete peças de geometria. `variants` liga/desliga nós por
  slot; `palette` pinta material por slot, com a **tabela de cores no manifesto**
  — cor nova passa a ser edição de asset, não de código.
- Validação cruzada: slot não pode ser peça e cor ao mesmo tempo, paleta sem
  tabela de cores é erro, cor fora de `#rrggbb` é erro. `npm run actors:check`
  reprova nó de variante e material de paleta que não existam no GLB, dizendo
  **qual aparência** quebra.
- Budgets do pipeline rederivados do renderer em vez de copiados de jogo
  moderno: o palco renderiza em `largura / 4` com posterização, então um ator
  ocupa ~160 px e os tetos caem de 24 mil para 2.500 triângulos e de 2048 para
  512 px de textura. LOD deixou de ser exigido.

### Compatibilidade e ação nos outros repositórios

- **Aditivo.** Manifesto sem `variants`/`palette` continua válido e recebe `{}`.
- `TableActor` ganhou membro obrigatório: quem implementa a interface precisa de
  `setAppearance`, mesmo que seja no-op. O compilador aponta todos os pontos.
- Slot ou opção desconhecida é **ignorada em silêncio**, nunca lançada. Clientes
  ficam em versões diferentes do vestuário e isso não pode esvaziar uma cadeira.
- Armadilha herdada do Three.js: `SkeletonUtils.clone` compartilha materiais
  entre instâncias. Pintar exige clonar o material por ator e descartar só o que
  se clonou; o template segue compartilhado. Vale para qualquer consumidor.
- Budget é **por renderer**. Um jogo d'A Mesa em resolução cheia precisa derivar
  os próprios números medindo a altura real do ator na tela; não copie os do
  Sem Perdão.

## 2026-07-22 — auditoria de ator glTF fora do runtime

### Adicionado

- `scripts/lib/actor-glb.mjs` + `npm run actors:check`: lê o contêiner GLB
  direto, sem Three.js e sem Blender, e cruza o que o manifesto **promete** com
  o que o arquivo **entrega** — `rootNode`, âncoras, clips, morphs de expressão
  — mais os cinco tetos de `budget` medidos do próprio arquivo (triângulos por
  modo de primitiva, draw calls, ossos por skin, maior textura lida do cabeçalho
  PNG/JPEG/WebP, bytes). Código de saída 1 em erro, `--json` pra CI.
- Separação erro/aviso: erro reprova, aviso informa. Morph fora do padrão e
  textura externa não impedem o ator de funcionar; um clip prometido e ausente,
  sim. Quando algo falta, a mensagem lista o que existe no GLB — o erro mais
  comum é renomear a Action e esquecer o manifesto.

### Compatibilidade e ação nos outros repositórios

- Nenhuma dependência nova. O parser de GLB é próprio e mínimo, alinhado ao
  resto de `scripts/lib` (que também não usa dotenv nem SDK pra tarefa simples).
- Vale pra qualquer jogo d'A Mesa: o alvo é `a-mesa.actor/v1`, não Sem Perdão.
  O Coup pode apontar o mesmo comando para os atores dele sem adaptação.
- Isto **não** substitui `auditActorManifest`, que valida o schema do manifesto
  dentro do app. Os dois são complementares e não se sobrepõem: um olha o
  documento, o outro olha o arquivo.

## 2026-07-22 — intenção terminal de ator e sequência encenada

### Adicionado

- `ACTOR_INTENT_PRIORITY.collapse` e a intenção `collapse` em `a-mesa.actor/v1`:
  o ator desaba e **permanece** caído até um reset explícito. É a primeira
  intenção terminal do contrato — todas as outras são pulsos que devolvem o
  corpo ao repouso. Quem implementa `TableActor` precisa manter a pose entre
  frames; um ator que volta ao idle sozinho está errado, não apenas feio.
- Rig de câmera aberto (`planoFinal` no Sem Perdão, cue `final.wide`): corte
  seco para o lado oposto da mesa, enquadrando o sobrevivente **com** os caídos
  no quadro. Complementa `actor.close`, que serve ao oposto — isolar um ator.
- `semPerdaoFinaleTiming(loserCount)`: cronograma puro da sequência final,
  derivado só da contagem de condenados. Existe porque a UI 2D precisa esperar
  o teatro 3D, e duas constantes separadas divergem no primeiro ajuste de ritmo.
  É o padrão recomendado para qualquer cena longa: uma função pura publica os
  marcos, o diretor e a UI leem dela.

- Cue de áudio pode devolver um cancelador. `ExperienceRuntime` já aceitava
  cleanup de executor, mas nenhum canal usava; a rajada de martelo do juiz é o
  primeiro cue que **agenda som no futuro**, e sair da sala no meio não pode
  deixar o efeito tocando sozinho. Quem adicionar cue com cauda deve devolver o
  cancelador em vez de confiar no fim natural do som.
- Cue de som é **semântico** (`gavel`), não literal (`stamp ×3`). Quantas
  batidas e com que intervalo é direção do jogo; o Coup traduz o mesmo cue pro
  que fizer sentido na mesa dele.

### Compatibilidade e ação nos outros repositórios

- Mudança **aditiva**. Manifestos `a-mesa.actor/v1` existentes continuam válidos:
  `clips` é um mapa parcial, então nenhum ator é obrigado a declarar `collapse`.
  Um ator sem o clip simplesmente não tomba.
- `Record<ActorIntent, …>` exaustivos quebram na compilação ao adicionar a
  intenção. Isso é intencional e foi o que pegou os dois pontos esquecidos aqui
  (`INTENT_DURATION_MS` e os rótulos do Character Lab). O Coup vai ver o mesmo
  erro e deve tratá-lo como checklist, não como incômodo.
- Sequências encenadas devem escalonar por **payload**, nunca por relógio local:
  a ordem de queda vem de uma lista ordenada por assento no evento, então todos
  os clientes veem a mesma coisa sem sincronizar tempo.

## 2026-07-22 — direção ao vivo, catálogo de atores e caos coletivo

### Adicionado

- `SemPerdaoExperienceSession`: observa somente a projeção pública da mesa e
  transforma mudanças reais de rodada, julgamento, voto, presença e resultado
  em câmera, intenção de ator, VFX, áudio e HUD deduplicados.
- Catálogo validado de atores com slot procedural e slot glTF por manifesto;
  falha de rede, manifesto ou GLB mantém o ator atual e ativa fallback seguro.
- Câmera `compact-landscape` para celulares deitados e janelas muito baixas,
  com classificação e fallback testados fora do Three.js.
- Catálogo único com 24 reações meme e três arremessos, compartilhado entre as
  mesas 2D, 3D e multiplayer.
- `ReactionComboTracker`: três participantes repetindo um emoji formam um coro;
  seis reações variadas de três participantes formam um motim com tremor,
  reação de ator, som e anúncio. Duplicatas, spam individual e arremessos não contam.
- Pipeline ElevenLabs dividido em presets `core`, `chaos` e `score`, com validação
  anterior à API, escrita atômica, índice incremental e falha explícita para
  proteger créditos e permitir geração parcial recuperável.
- Preset `starter` free-first e reconstrução de índice sem API permitem continuar
  com fallback sintetizado, gravação própria, CC0 ou geração local após a cota.

### Compatibilidade e ação nos outros repositórios

- Nenhuma regra de jogo passou para a camada visual; a sessão observa apenas
  `MesaView`, mantendo segredos e autoridade do host fora da experiência.
- O catálogo usa `a-mesa.actor/v1`; Coup e os próximos jogos podem registrar
  seus próprios atores sem duplicar loader, validação ou política de fallback.
- O catálogo de reações e o agregador de combos não dependem de React, Three.js
  ou Supabase e são candidatos diretos ao pacote compartilhado d'A Mesa.
- Planejamento/validação de assets de áudio também é neutro; prompts e mapeamento
  de cues continuam no adaptador de cada jogo.

## 2026-07-22 — framing por mesh e matriz de capturas

### Adicionado

- Arnês headless genérico `captureMatrix`, portado da instrumentação do Coup e
  separado do catálogo de planos do jogo.
- `npm run capture:lab`: gera palco, controles e telemetria em desktop,
  portrait e landscape sem pilotagem manual do navegador.
- Query determinística do Character Lab (`camera`, `quality`, `expression` e
  `reducedMotion`) com sinal explícito de prontidão para automação.
- Telemetria de overflow X/Y e estado de recorte intencional para câmeras de detalhe.

### Corrigido

- O framing não projeta mais os oito cantos de uma AABB global. Agora projeta
  as caixas das meshes visíveis, evitando cantos imaginários e falsos
  `REVISAR` em perspectiva; SkinnedMesh recalcula seu bounding box.
- Atos temporários de câmera restauram o plano escolhido no Lab, em vez de
  sempre voltar para `full`.
- Copiar relatório tem fallback e estado de erro visível quando a Clipboard API
  é bloqueada.

### Compatibilidade e ação nos outros repositórios

- Nenhum schema de jogo ou multiplayer mudou; `CharacterLabSnapshot` ganhou o
  campo local `camera`.
- Coup pode substituir seu script monolítico pelo arnês genérico mantendo seu
  catálogo de `duel`, `evidence` e `throne`.
- A Mesa deve extrair `capture-matrix` junto do palco; catálogos de planos ficam
  nos jogos consumidores.

## 2026-07-21 — atores e direção de experiência v1

### Adicionado

- `a-mesa.event/v1`: evento serializável, seed determinístico e journal
  monotônico/deduplicado.
- `ExperienceDirector`: traduz tipo de evento em beats de câmera, ator, VFX,
  áudio e HUD sem dependências gráficas.
- `ExperienceRuntime`: agenda delay/duração e cancela cues por canal ou por ID.
- `TableActor`: vocabulário neutro de intenções, expressões, métricas e âncoras.
- `a-mesa.actor/v1`: manifesto validável para procedural/glTF, clips, morphs,
  LOD, preload, fallback e orçamento.
- `GltfActorAssetStore`: GLTFLoader + Meshopt, KTX2 opcional, clone correto de
  rigs, cache de recursos compartilhados e mixers por instância.
- Adaptador do cultista procedural e âncoras semânticas no modelo atual.
- `/lab/actors`: QA visual, cenários, câmeras, budget, framing e benchmark.
- Métricas de memória GPU (`textures`, `geometries`, programas) no palco.

### Compatibilidade

- Nenhuma regra, snapshot ou mensagem multiplayer do Sem Perdão foi alterada.
- O jogo de produção continua usando o cultista procedural.
- Schemas são novos; consumidores antigos simplesmente não os conhecem.
- O loader glTF está pronto, mas não substitui produção até um GLB passar pelo Lab.

### Ação nos outros repositórios

- Não copiar os arquivos ainda.
- Coup deve preparar um adaptador de um ator e mapear seu camera director para
  beats, servindo como segunda prova da API.
- A Mesa deve manter o mapa de migração em `ENGINE-MIGRATION.md` sincronizado.
