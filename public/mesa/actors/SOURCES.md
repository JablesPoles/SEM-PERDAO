# Procedência dos atores

Uma linha por ator que entra no jogo. Vale pra geração por IA, modelagem
própria, encomenda e asset licenciado. **Não coloque um ator na mesa sem saber
se o projeto pode distribuí-lo** — e sem saber se a licença exige atribuição
visível no produto, não só neste arquivo.

Atenção às licenças com atribuição obrigatória (CC BY, por exemplo): elas são
comuns nos planos gratuitos de geradores por IA. Se o ator ficar, a atribuição
tem que aparecer nos créditos do jogo.

Guarde sempre o **arquivo-fonte** (`.blend`) e o prompt/imagem de entrada. Um GLB
otimizado não é fonte: dele não dá pra refazer o rig nem subir de LOD.

| Ator (`id`) | Origem | Modelo/autor | Entrada (prompt ou imagem) | Licença | Atribuição exigida | Fonte `.blend` | Data |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `sem-perdao.cultist.procedural-v5` | procedural | `src/lib/three/reus.ts` | — | próprio | não | — | 2026-07 |
| `sem-perdao.cultist.gltf-v1` | script Blender | `tools/blender/cultist.py` | referência visual do procedural | próprio | não | o próprio script | 2026-07-22 |
| `sem-perdao.tribunal-props-v1` | script Blender | `tools/blender/props.py` | — | próprio | não | o próprio script | 2026-07-22 |
| _ex.: `sem-perdao.cultist.gltf-v1`_ | _Meshy / Tripo / próprio / CC0_ |  |  |  |  |  |  |
