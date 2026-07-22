# Convergência dos jogos para A Mesa Engine

## Decisão de fonte

Durante a incubação, o código executável mora no Sem Perdão e a especificação de
convergência mora também no repositório `a-mesa`. Não copie esse núcleo para três
apps agora: cópias criariam três APIs antes de a primeira estar comprovada.

Depois de duas integrações reais — Sem Perdão e Coup — os módulos neutros serão
movidos, preservando histórico, para um workspace/pacote versionado. Os jogos
consumirão o pacote; não importarão arquivos pelo caminho de um repositório irmão.

## O que migra e o que fica

| Compartilhável | Específico do jogo |
| --- | --- |
| `TableEvent`, journal e seed | regras, baralhos e condições de vitória |
| diretor/timeline de experiência | tabela que traduz regra em eventos |
| contrato, loader e cache de atores | arte, manifestos e paleta do jogo |
| `TabletopStage`, câmera e métricas | montagem da cena e shot list |
| sala/presença/reconnect/host | opções e ações válidas do jogo |
| chat, reação e mixer por canais | frases, emojis e efeitos temáticos |
| Character/Scene Labs | cenários de regressão de cada jogo |

## Sequência de adoção

### 0. Sem Perdão — vertical slice atual

- Manter `game.ts` e multiplayer estáveis.
- Adaptar o `Reu` procedural ao `TableActor` — concluído.
- Validar eventos, timeline, métricas e bancada — implementado, em QA.
- Produzir um cultista glTF real e medir comparação A/B — próximo gate.
- Emitir eventos a partir das transições reais sem adicionar segredo ao payload.

### 1. Coup / La Corte — segunda prova

- Preservar suas regras e `projectTableView`.
- Mapear o `camera-director` para regras do `ExperienceDirector`, sem perder
  enquadramento de duelo.
- Transformar `projectile-cam` em cue do canal `camera`/`vfx` usando as âncoras
  `projectile-origin` e `target`.
- Colocar um personagem existente atrás de `TableActor` e rodar o mesmo Lab.
- Comparar o `tabletop-stage` do Coup com o do Sem Perdão e consolidar uma única
  API, levando testes dos dois lados.

### 2. Extração do pacote

Estrutura alvo, ainda não criada:

```text
packages/
  mesa-engine/          # eventos, runtime, palco, áudio, métricas
  mesa-react/           # hooks e overlays opcionais
  mesa-devtools/        # Character Lab, Scene Lab, benchmark/replay
games/
  sem-perdao-adapter/
  coup-adapter/
```

Versionar os schemas separadamente da versão npm. Um pacote pode evoluir sem
quebrar `a-mesa.event/v1` ou `a-mesa.actor/v1`; mudança incompatível cria `v2` e
mantém parser/fallback do `v1` durante a janela de migração.

### 3. Sala persistente d'A Mesa

Só depois da projeção segura estar padronizada, extrair presença, chat,
reconexão, migração de host e timers. A sala escolhe um adaptador de jogo; não
passa a conhecer suas regras.

### 4. Demais jogos e caos composto

FDP/MiStory adotam sala, eventos e HUD primeiro; 3D é opcional. Reações físicas,
PiP, câmera de projétil e espectadores entram como cues, não como casos dentro do
motor. Um jogo 2D deve continuar sendo consumidor válido da engine.

## Gate para qualquer merge compartilhado

1. Contrato neutro não importa módulo de jogo.
2. Teste de unidade cobre parsing, replay/dedup, decisão ou descarte.
3. Migração tem fallback e não exige big bang.
4. Build dos consumidores passa.
5. Documento em `docs/mesa-engine/CHANGELOG.md` explica impacto e adoção.
6. Mudança de rede prova que nenhum payload privado chegou ao cliente errado.

