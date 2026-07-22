import { pintarRosto, type Expressao } from '../reus';
import {
  CULTIST_FACES,
  DEFAULT_CULTIST_APPEARANCE,
  type CultistFace,
} from '@/lib/types';
import type { ActorExpression, ActorTexturePainter } from '@/lib/mesa/actorContract';

/**
 * Liga a carinha do Sem Perdão ao `textureSlots` do contrato.
 *
 * O ator glTF tem o rosto num plano dentro do capuz, com material emissivo. A
 * arte é a mesma do procedural — `pintarRosto` desenha os dois —, então trocar
 * de runtime não troca a cara do personagem, que é justamente o que dá
 * identidade a ele.
 *
 * Isto mora no jogo, e não na engine, de propósito: `a-mesa` não deve saber
 * desenhar cultista nenhum. Ela só sabe qual material recebe o pixel.
 */

const EXPRESSAO_POR_ATOR: Readonly<Record<ActorExpression, Expressao>> = Object.freeze({
  neutral: 'neutro',
  joy: 'riso',
  shock: 'choque',
  contempt: 'desprezo',
  sleep: 'sono',
});

/** Mesma regra de cor do `Reu`: juiz em vermelho, brasa e ciano por aparência. */
function corDoRosto(face: CultistFace, accent: string | undefined, juiz: boolean): string {
  if (juiz) return '#ff3b2f';
  if (face === 'ember') return '#ff784f';
  if (accent === 'cyan') return '#73fff7';
  return '#f2efe9';
}

function faceValida(valor: string | undefined): CultistFace {
  return (CULTIST_FACES as readonly string[]).includes(valor ?? '')
    ? (valor as CultistFace)
    : DEFAULT_CULTIST_APPEARANCE.face;
}

export function createCultistFacePainter(options: { judge?: boolean } = {}): ActorTexturePainter {
  return ({ slot, expression, appearance }) => {
    // Slot desconhecido não é erro: o asset pode declarar mais do que o jogo
    // sabe pintar, e nesse caso a textura embutida no GLB continua valendo.
    if (slot !== 'face') return null;
    const face = faceValida(appearance.face);
    return pintarRosto(
      EXPRESSAO_POR_ATOR[expression] ?? 'neutro',
      corDoRosto(face, appearance.accent, options.judge === true),
      face
    );
  };
}
