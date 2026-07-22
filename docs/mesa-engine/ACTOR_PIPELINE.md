# Pipeline de personagens

Objetivo: trocar personagens hardcoded por assets versionados sem sacrificar
identidade, animação, mobile ou estabilidade. O runtime aceita procedural e glTF
atrás do mesmo `TableActor`; portanto a migração é gradual e reversível.

## Convenção de arquivos

```text
public/mesa/actors/<actor-id>/<versao>/
  manifest.json
  actor.glb
  actor-lod1.glb
  actor-lod2.glb
  preview.webp
```

O manifesto deve viajar ao lado do asset. URIs relativas são resolvidas a partir
do próprio `manifest.json`, então o pacote pode mudar de CDN sem edição no jogo.

```json
{
  "schema": "a-mesa.actor/v1",
  "id": "a-mesa.cultist.v1",
  "label": "Cultista rigado",
  "version": 1,
  "runtime": "gltf",
  "source": { "uri": "./actor.glb", "authoring": "cultist.blend" },
  "coordinateSystem": { "metersPerUnit": 1, "forward": "+z", "up": "+y" },
  "rootNode": "ActorRoot",
  "clips": {
    "idle": { "clip": "idle", "loop": "repeat", "fadeMs": 160, "speed": 1 },
    "celebrate": { "clip": "celebrate", "loop": "once", "fadeMs": 90, "speed": 1 },
    "hit": { "clip": "hit", "loop": "once", "fadeMs": 45, "speed": 1 }
  },
  "expressions": {
    "joy": { "morphTargets": { "expr_joy": 1 }, "fadeMs": 100 },
    "shock": { "morphTargets": { "expr_shock": 1 }, "fadeMs": 60 }
  },
  "anchors": {
    "root": "AnchorRoot",
    "head": "AnchorHead",
    "chest": "AnchorChest",
    "nameplate": "AnchorNameplate",
    "left-hand": "AnchorLeftHand",
    "right-hand": "AnchorRightHand",
    "projectile-origin": "AnchorProjectileOrigin"
  },
  "lods": [
    { "id": "lod-1", "uri": "./actor-lod1.glb", "minDistance": 7, "maxTriangles": 8000 },
    { "id": "lod-2", "uri": "./actor-lod2.glb", "minDistance": 14, "maxTriangles": 3000 }
  ],
  "budget": {
    "maxDownloadBytes": 2000000,
    "maxTriangles": 24000,
    "maxDrawCalls": 18,
    "maxBones": 64,
    "maxTextureEdge": 2048
  },
  "preload": "lobby",
  "fallbackActorId": "sem-perdao.cultist.procedural-v5"
}
```

Carregamento:

```ts
const manifest = await loadActorManifest('/mesa/actors/cultist/1/manifest.json');
const store = new GltfActorAssetStore({ renderer: stage.renderer });
const actor = await store.create(manifest, { actorId: player.id, distance: 5 });
stage.add(actor.root);
```

Uma instância clona hierarquia, ossos e mixer; geometria, materiais e texturas
permanecem compartilhados no cache. Ao sair, descarte o ator. Ao trocar de jogo,
chame `disposeUnused()` e, no teardown final, `dispose()` no store.

## Contrato de autoria no Blender

1. Trabalhe em metros, aplique transforms e mantenha `+Y` para cima. A frente
   canônica d'A Mesa é `+Z`; outra orientação deve ser declarada no manifesto.
2. Use um único `ActorRoot`, armature limpa e nomes estáveis para as sete
   âncoras. Âncoras são empties/nós, não meshes invisíveis.
3. Faça cada movimento como Action independente com nome curto e estável. Envie
   as Actions necessárias para NLA ou preserve-as com Fake User antes do export.
4. Pele: no máximo quatro pesos relevantes por vértice, sem ossos auxiliares que
   não deformem. Morph targets de rosto usam o prefixo `expr_`.
5. Materiais devem ser PBR simples. Prefira atlas; transparência e material extra
   custam draw call. Use 1K como padrão e 2K somente quando o relatório justificar.
6. Exporte `.glb` com skins, animações, morph targets e tangents somente quando
   necessários. Gere LODs preservando skeleton, nomes de clips e âncoras.
7. Rode otimização/inspeção, escreva os valores reais no manifesto e passe pelo
   Character Lab antes de conectar o asset à partida.

O exporter glTF do Blender serializa Actions/NLA como animações nomeadas. O glTF
é o formato recomendado pelo Three.js para entrega web e comporta meshes,
materiais, skins, skeletons, morph targets e animações. Referências oficiais:
[Three.js — Loading 3D Models](https://threejs.org/manual/en/loading-3d-models.html),
[Blender — glTF animations](https://docs.blender.org/manual/en/3.3/addons/import_export/scene_gltf2.html).

## Otimização

O runtime configura Meshopt sempre. KTX2 só é ativado quando o app publica os
transcoders Basis e fornece `ktx2TranscoderPath`; não declare KTX2 antes disso.
Para uma primeira passagem reproduzível, use o CLI oficial glTF Transform e
guarde o `.blend` como fonte, nunca o GLB otimizado como única fonte:

```bash
npx @gltf-transform/cli optimize actor.glb actor.optimized.glb \
  --compress meshopt --texture-compress webp
```

Ferramentas: [glTF Transform](https://gltf-transform.dev/),
[Khronos glTF tools](https://www.khronos.org/gltf/) e
[Asset Creation Guidelines 2.0](https://www.khronos.org/blog/introducing-asset-creation-guidelines-2.0-siggraph-2025).

## Budget derivado do renderer, não do costume

O número certo vem da tela, e a tela do Sem Perdão é minúscula de propósito. O
palco renderiza num alvo de `largura / pixelSize` (padrão 4), posteriza a cor e
aplica dithering Bayer 4×4. Numa janela 1440×900 a cena real tem **360×225**, e
no plano mais fechado um cultista ocupa cerca de **160 pixels de altura**.

Isso decide tudo: detalhe geométrico acima de ~800 triângulos é invisível depois
da posterização, e textura acima de 256 px é mais do que o alvo consegue
amostrar. Os números abaixo já embutem folga generosa sobre esse limite.

| Recurso | Teto LOD0 | Alvo prático |
| --- | ---: | ---: |
| Transferência | 300 KB | 100–200 KB |
| Triângulos | 2.500 | 1.200–1.800 |
| Draw calls | 6 | 3–4 |
| Ossos | 24 | 8–12 |
| Maior textura | 512 px | 256 px |
| LODs | nenhum | — |

**LOD é desnecessário aqui.** A 160 px não há o que simplificar; manter dois
arquivos extras custa mais em pipeline do que economiza em GPU. Um jogo d'A Mesa
que renderize em resolução cheia precisa dos próprios números — derive-os da
mesma forma, medindo a altura real do ator na tela, e não copie estes.

Oito cultistas no teto somam 20 mil triângulos, menos do que um único "ator
herói" no budget genérico que este documento carregava antes. A folga toda vai
pra onde o estilo pede: **textura**.

## O detalhe mora na textura

Direção do projeto: PS1 / Inscryption / Buckshot Roulette. Jogo daquela época não
tinha detalhe geométrico — dobra de tecido, bordado, mancha, desgaste e costura
eram **pintados** numa textura pequena. A malha só carregava a silhueta.

Consequência prática pra quem modela: um personagem mais rico **não é um
personagem com mais polígonos**. Gaste o esforço na textura de 256 px e na
silhueta (formato do capuz, caimento da túnica, adereços). Malha lisa demais
inclusive atrapalha — o filtro de pixel e o dithering são o que produzem o
retrô, e uma superfície muito subdividida some no borrão.

Isso também barateia a produção: textura sai de gerador de **imagem**, que é
ordens de grandeza mais barato que gerador 3D, e pode ser refeita à vontade sem
tocar na malha.

## Ator modular: um asset, todas as aparências

Personagem customizável **não pode** virar um asset por combinação. O cultista
tem 2.304 aparências e **sete peças de geometria** — o resto é cor de material e
textura. O manifesto declara isso em dois campos, e o runtime aplica com
`setAppearance({ slot: 'opção' })` sem trocar de ator.

```jsonc
"variants": {
  "hood":      { "classic": ["HoodClassic"], "spire": ["HoodSpire"], "shrouded": ["HoodShrouded"] },
  "accessory": { "none": [], "chain": ["PropChain"], "candle": ["PropCandle"], "relic": ["PropRelic"] }
},
"palette": {
  "robe":   { "material": "Tunica",    "property": "baseColorFactor",
              "values": { "blood": "#8f201b", "ash": "#625d63" } },
  "accent": { "material": "Acessorio", "property": "baseColorFactor",
              "values": { "bone": "#d8ccb2", "brass": "#a97d3e" } }
}
```

`variants` liga e desliga nós; `palette` pinta material. Um slot não pode ser os
dois — o validador reprova. Opção com lista vazia é legítima e quer dizer
"nada" (é assim que `accessory: none` funciona). Manifesto sem os dois campos
continua válido: a adição é retrocompatível.

**A tabela de cores mora no manifesto, não no runtime.** Túnica nova é edição de
asset, não de código — foi por isso que as cores saíram de `reus.ts`.

### O que isso exige de quem modela

| regra | por quê |
| --- | --- |
| Cada peça trocável é um **objeto separado com nome estável** | é o nome que o manifesto liga e desliga |
| Peças de um mesmo slot **compartilham o rig** | trocar capuz não pode reposicionar o esqueleto |
| Material a ser pintado tem **nome próprio** (`Tunica`, `Acessorio`) | é por nome que a paleta encontra |
| A cor base do material pintado é **branca ou clara** | a cor da paleta multiplica; base escura suja toda opção |
| Todas as peças saem **num GLB só** | um download serve todas as combinações |

`npm run actors:check` confere isso: nó de variante que não existe e material de
paleta ausente **reprovam** o export, dizendo qual aparência quebra.

> Detalhe de implementação que morde: `SkeletonUtils.clone` compartilha materiais
> entre instâncias. O runtime clona o material na primeira vez que aquele ator o
> pinta, e descarta só o que clonou — senão pintar um réu repintaria a mesa
> inteira. Quem implementar `TableActor` em outro jogo precisa fazer o mesmo.

O ator procedural (`src/lib/three/actors/proceduralCultistActor.ts`) é a
implementação de **referência**: ele já monta as 2.304 combinações. Um ator glTF
que não declare os mesmos slots é um downgrade — trocaria customização por um
boneco fixo.

## Gerar por script (o caminho adotado)

Os modelos do jogo são **gerados por script headless**, não modelados à mão:

```bash
npm run models:cultist -- --out=build/cultist   # ator modular, 11 clips
npm run models:props   -- --out=build/props     # props do tribunal
npm run actors:check   -- build/cultist/actor.glb
```

Cada execução produz o GLB e PNGs de preview em duas vistas, então iterar é
mudar um número e reexecutar — o ciclo inteiro leva segundos e não precisa de
interface aberta.

| Arquivo | Papel |
| --- | --- |
| `tools/blender/mesa_kit.py` | geometria paramétrica compartilhada: revolver, caixa, tubo, UV, export |
| `tools/blender/cultist.py` | o ator modular: peças, rig, clips, rosto de LED |
| `tools/blender/props.py` | mobiliário e objetos de cena |

Por que script e não sculpt:

- **Reprodutível.** Personagem modular não tolera peça que "quase" encaixa;
  gerar todas na mesma execução garante que os três capuzes partilham o mesmo
  encaixe e o mesmo rig.
- **Nome de nó é contrato.** `HoodSpire`, `PropCandle`, material `Tunica`: o
  manifesto liga peça por nome e errar um nome quebra a aparência em silêncio.
- **O script é a fonte.** Melhor que `.blend` para versionar: dá diff, dá para
  revisar, e a mudança fica explicada no commit.
- **É o que o estilo pede.** PS1/Inscryption é forma primitiva com contagem
  baixa de segmentos — exatamente onde script ganha de escultura.

### Armadilhas do Blender 5.x

- `action.fcurves` não existe mais (Actions têm slots/layers). Defina
  `preferences.edit.keyframe_new_interpolation_type = 'LINEAR'` **antes** de
  inserir keyframes em vez de ajustar as curvas depois.
- Desligar a Action **não** desfaz a pose: os ossos ficam no último keyframe.
  Zere `location`/`rotation_euler`/`scale` de todos os pose bones ao terminar,
  senão o GLB sai com a pose do último clip.
- `export_animation_mode='ACTIONS'` é obrigatório para cada Action virar uma
  animação nomeada; sem isso vira uma timeline só e nenhum clip é encontrado.
- Uma caixa entrega seis faces ao `smart_project`, que as espalha em ilhas
  arbitrárias. Onde a textura precisa cair exatamente na frente (rosto, placa),
  use um quad e fixe o UV à mão.

## Gerar o personagem com IA

Geradores text/image-to-3D resolvem forma e textura, **não** prontidão pra jogo.
O que eles entregam é malha densa e desorganizada, sem armature, sem morph e sem
âncora. Topologia ruim quebra o rigging, rigging quebrado quebra o weight paint,
e a silhueta colapsa quando a junta gira. Por isso a IA entra no começo do
pipeline, nunca no fim.

O cultista é o caso mais favorável possível pra essa rota, e vale entender por
quê antes de escolher outro personagem:

- **Túnica encapuzada é silhueta fechada.** Sem braços e pernas expostos, quase
  não há junta pra deformar errado — o pior defeito da geração por IA quase não
  se aplica.
- **O rosto não é geometria.** `src/lib/three/reus.ts` desenha as expressões em
  canvas e troca a textura dentro do vazio do capuz. Morph facial, a parte mais
  cara de personagem gerado por IA, é opcional aqui.
- **Já existe referência visual.** Image-to-3D a partir de uma captura do
  cultista procedural preserva a direção de arte em vez de sortear um boneco novo.

Ordem sugerida:

1. Gere a forma (image-to-3D a partir do procedural, pra manter a identidade).
2. **Rode `npm run actors:check` no download cru.** Serve pra dimensionar o
   estrago antes de abrir o Blender, não pra passar.
3. Retopologia, armature e âncoras no Blender, seguindo o contrato de autoria.
4. Exporte e rode o validador de novo até passar.
5. Character Lab, comparação com o procedural, e só então produção.

O validador não faz retopologia — essa continua sendo trabalho de Blender. Ele
existe pra você descobrir em segundos, e não quando o boneco entra na mesa.

## Validação automática

```bash
npm run actors:check -- public/mesa/actors/<id>/<versao>/actor.glb
npm run actors:check -- caminho/actor.glb --manifest=outro/manifest.json
npm run actors:check -- caminho/actor.glb --json   # pra CI
```

O comando lê o GLB direto (sem Three.js, sem Blender) e cruza **o que o
manifesto promete com o que o arquivo entrega**: `rootNode`, cada âncora, cada
clip, cada morph de expressão, mais os cinco tetos de `budget` medidos do
próprio arquivo. Sai com código 1 se houver erro, então serve em CI.

Erro reprova; aviso não. A distinção é deliberada: nome de morph fora do padrão
ou textura externa não impedem o ator de funcionar, mas o artista precisa saber.
Quando um clip ou âncora não existe, a mensagem lista o que **existe** no GLB —
o erro mais comum é renomear a Action no Blender e esquecer o manifesto.

A lógica fica em `scripts/lib/actor-glb.mjs` (pura, testada em
`tests/actor-glb.test.mjs`) e o CLI em `scripts/check-actor.mjs`. O mesmo par
serve qualquer jogo d'A Mesa: o contrato é `a-mesa.actor/v1`, não Sem Perdão.

## Checklist de aceitação

- O manifesto passa em `auditActorManifest` sem erro.
- `idle`, `root` e `head` existem; clips ausentes têm fallback intencional.
- `celebrate`, `hit`, `rage` e troca de expressão não estouram nem teleportam.
- Nome, emoji, projétil e VFX acertam as âncoras nos três atos de câmera.
- Corpo inteiro cabe em landscape e portrait com safe area.
- Movimento reduzido não depende de tween para comunicar estado.
- Relatório respeita budgets e não cresce após recriar o ator repetidamente.
- Falha de rede/asset mantém o ator procedural e não bloqueia entrada na sala.

