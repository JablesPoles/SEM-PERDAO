"""
Props do Tribunal do Porão — mobiliário e objetos de cena.

    blender --background --python tools/blender/props.py -- --out=<dir>

Gera UM GLB com todos os props como nós nomeados. O runtime carrega o arquivo
uma vez e clona por nome; um download serve a mesa inteira.

Estes objetos existem hoje como primitivas montadas à mão em `retroMesa.ts`
(cilindro + cilindro para o martelo, cone + esfera para a lâmpada). Refeitos
aqui eles ganham forma real sem custar mais polígono do que o palco aguenta —
e, principalmente, deixam de ser código: mudar o martelo vira mudar um número
neste arquivo, não editar o renderer.

Direção: PS1 / Inscryption. Madeira gasta, metal fosco, nada polido.
"""

import math
import os
import sys

import bpy

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from mesa_kit import (  # noqa: E402
    caixa, contar_triangulos, desdobrar_uv, exportar_glb, girar_x, girar_z,
    extrudar, juntar, limpar_cena, material, montar_estudio, mover, objeto_de,
    renderizar, revolver, sombrear_plano, tubo,
)

# Paleta do Tribunal: creme, tinta e vermelho — a mesma direção do jogo 2D.
CORES = {
    'Madeira': (0.32, 0.24, 0.18, 1.0),
    'MadeiraClara': (0.52, 0.40, 0.28, 1.0),
    'Metal': (0.30, 0.30, 0.34, 1.0),
    'Tinta': (0.09, 0.09, 0.10, 1.0),
    'Vermelho': (0.62, 0.09, 0.07, 1.0),
    'Papel': (0.88, 0.86, 0.80, 1.0),
    'Verde': (0.18, 0.26, 0.14, 1.0),
    'Chama': (1.0, 0.72, 0.30, 1.0),
}


def mats(*nomes):
    return [material(n, CORES[n], emissivo=CORES['Chama'] if n == 'Chama' else None,
                     forca_emissao=6.0 if n == 'Chama' else 0.0) for n in nomes]


# ── props ───────────────────────────────────────────────────────────────────

def martelo():
    """
    Martelo de juiz: cabeça de madeira com anéis de metal e cabo torneado.

    A versão em `retroMesa.ts` é literalmente dois cilindros. O que faltava não
    era polígono, era leitura: sem os anéis e sem o alargamento do cabo, a peça
    some contra a mesa mesmo no close do veredito.
    """
    # Deitado sobre a mesa: cabeça com eixo em Y, cabo saindo em X. As duas
    # peças precisam ser perpendiculares — cabeça em pé vira marreta, não
    # martelo de juiz.
    cabeca = girar_x(revolver([
        (0.0, -0.16), (0.105, -0.16), (0.115, -0.10),
        (0.115, 0.10), (0.105, 0.16), (0.0, 0.16),
    ], segmentos=8), math.pi / 2)
    aneis = [
        girar_x(revolver([(0.118, z - 0.015), (0.128, z), (0.118, z + 0.015)],
                         segmentos=8, indice_material=1), math.pi / 2)
        for z in (-0.10, 0.10)
    ]
    # cabo torneado: engrossa no punho pra não sumir de perfil
    cabo = tubo((0.0, 0.0, 0.0), (-0.42, 0.0, 0.0), 0.032, 0.046, 6)
    punho = tubo((-0.42, 0.0, 0.0), (-0.50, 0.0, 0.0), 0.052, 0.030, 6)
    return objeto_de('PropGavel', *juntar(cabeca, *aneis, cabo, punho),
                     mats('Madeira', 'Metal'))


def bloco_martelo():
    """A base que apanha. Sem ela a martelada bate no nada."""
    disco = revolver([(0.0, 0.0), (0.26, 0.0), (0.26, 0.05), (0.22, 0.075), (0.0, 0.075)],
                     segmentos=10)
    friso = revolver([(0.225, 0.055), (0.245, 0.065), (0.225, 0.072)],
                     segmentos=10, indice_material=1)
    return objeto_de('PropGavelBlock', *juntar(disco, friso), mats('Madeira', 'MadeiraClara'))


def lampada():
    """
    Lâmpada do porão: cúpula de metal amassada, soquete e bulbo.

    O bulbo é material próprio (`Chama`, emissivo) porque o runtime o acende e
    apaga junto com o blackout do ato final.
    """
    cupula = revolver([
        (0.06, 0.30), (0.10, 0.26), (0.34, 0.05), (0.40, 0.0), (0.36, -0.02),
    ], segmentos=8)
    aro = revolver([(0.37, -0.015), (0.405, -0.005), (0.37, 0.01)],
                   segmentos=8, indice_material=1)
    soquete = revolver([(0.055, 0.30), (0.075, 0.24), (0.075, 0.10), (0.055, 0.06)],
                       segmentos=6, indice_material=1)
    bulbo = revolver([
        (0.0, 0.10), (0.055, 0.06), (0.075, -0.04), (0.06, -0.12), (0.0, -0.155),
    ], segmentos=8, indice_material=2)
    return objeto_de('PropLamp', *juntar(cupula, aro, soquete, bulbo),
                     mats('Metal', 'Tinta', 'Chama'))


def cadeira():
    """Cadeira de tribunal: assento, encosto com ripas e quatro pés."""
    assento = caixa(0.62, 0.58, 0.07, (0, 0, 0.44))
    borda = caixa(0.66, 0.62, 0.03, (0, 0, 0.40), indice_material=1)
    encosto = caixa(0.60, 0.06, 0.12, (0, 0.28, 1.02))
    ripas = [caixa(0.09, 0.05, 0.52, (x, 0.28, 0.72)) for x in (-0.20, 0.0, 0.20)]
    montantes = [caixa(0.07, 0.07, 0.66, (x, 0.28, 0.72)) for x in (-0.28, 0.28)]
    pes = [tubo((x, y, 0.40), (x * 1.12, y * 1.12, 0.0), 0.035, 0.028, 5)
           for x in (-0.26, 0.26) for y in (-0.24, 0.24)]
    return objeto_de('PropChair', *juntar(assento, borda, encosto, *ripas, *montantes, *pes),
                     mats('Madeira', 'MadeiraClara'))


def trono():
    """
    A cadeira do juiz: encosto alto terminando em ogiva, com estofado vermelho.

    A primeira versão revolvia uma "coroa" em torno do eixo do assento — e o
    encosto fica em y=+0,30, então a coroa nascia no ar, à frente das costas,
    como um cogumelo. Aqui a ogiva é construída NO PLANO do encosto.
    """
    base = cadeira_bloco()
    y_costas = 0.30
    costas = caixa(0.66, 0.08, 0.94, (0, y_costas, 1.03))
    # ogiva: dois degraus estreitando até o bico, no mesmo plano do encosto
    remate = juntar(
        caixa(0.50, 0.08, 0.14, (0, y_costas, 1.57)),
        caixa(0.30, 0.08, 0.13, (0, y_costas, 1.69)),
        caixa(0.13, 0.08, 0.12, (0, y_costas, 1.79)),
    )
    # estofado: painel vermelho embutido na frente do encosto
    estofado = caixa(0.50, 0.03, 0.70, (0, y_costas - 0.055, 1.02), indice_material=2)
    # braços, que é o que separa trono de cadeira à distância
    bracos = [
        juntar(
            caixa(0.09, 0.54, 0.09, (x, 0.02, 0.78)),
            caixa(0.09, 0.09, 0.30, (x, -0.22, 0.63)),
        ) for x in (-0.36, 0.36)
    ]
    return objeto_de('PropThrone', *juntar(base, costas, remate, estofado, *bracos),
                     mats('Madeira', 'MadeiraClara', 'Vermelho'))


def cadeira_bloco():
    assento = caixa(0.66, 0.62, 0.08, (0, 0, 0.50))
    borda = caixa(0.70, 0.66, 0.03, (0, 0, 0.455), indice_material=1)
    pes = [tubo((x, y, 0.46), (x * 1.14, y * 1.14, 0.0), 0.042, 0.032, 5)
           for x in (-0.28, 0.28) for y in (-0.26, 0.26)]
    return juntar(assento, borda, *pes)


def tomate():
    """Arremesso 1: gordo, com talo e um amassado — não é uma esfera."""
    corpo = revolver([
        (0.0, -0.17), (0.11, -0.15), (0.185, -0.06), (0.20, 0.02),
        (0.16, 0.11), (0.07, 0.16), (0.0, 0.155),
    ], segmentos=8)
    talo = revolver([(0.0, 0.20), (0.05, 0.16), (0.09, 0.14), (0.0, 0.135)],
                    segmentos=6, indice_material=1)
    return objeto_de('PropTomato', *juntar(corpo, talo), mats('Vermelho', 'Verde'))


def sapato():
    """
    Arremesso 2: o clássico do plenário.

    Voa por menos de um segundo, então tudo depende da SILHUETA lateral —
    e silhueta inclinada se faz extrudando um contorno, não empilhando caixas.
    As duas versões anteriores eram degraus e liam como um bloco qualquer.
    """
    # contorno lateral em (x, z), anti-horário: salto, sola, bico, peito, cano
    contorno = [
        (-0.235, -0.135), (0.300, -0.135), (0.320, -0.088),   # sola até o bico
        (0.300, -0.030), (0.215, 0.010), (0.090, 0.052),      # rampa do peito
        (-0.010, 0.105), (-0.055, 0.205), (-0.235, 0.215),    # subida do cano
        (-0.250, 0.060), (-0.245, -0.060),                    # traseira e salto
    ]
    corpo = extrudar(contorno, 0.185)
    # sola e salto em cor separada: é o contraste que dá leitura de calçado
    sola = extrudar([
        (-0.250, -0.175), (0.320, -0.140), (0.322, -0.086),
        (0.298, -0.086), (-0.250, -0.120),
    ], 0.195, indice_material=1)
    cadarco = caixa(0.16, 0.10, 0.022, (-0.03, 0, 0.115), indice_material=1)
    return objeto_de('PropShoe', *juntar(corpo, sola, cadarco),
                     mats('Tinta', 'MadeiraClara'))


def rosa():
    """
    Arremesso 3: o único elogio da mesa.

    A flor é um BOTÃO fechado, não um cone: pétalas em duas camadas que se
    fecham para cima. A primeira versão empilhava anéis abertos e virava um
    chapéu chinês, e a folha era um retângulo em pé como bandeirinha.
    """
    haste = tubo((0.34, 0, -0.01), (-0.16, 0, 0.02), 0.014, 0.018, 5, indice_material=1)
    # cálice: a base verde que segura o botão
    calice = revolver([(0.0, -0.075), (0.045, -0.05), (0.062, 0.0), (0.03, 0.03)],
                      segmentos=6, indice_material=1)
    # botão: barriga no meio e fechamento no topo — silhueta de rosa fechada
    botao = revolver([
        (0.02, -0.01), (0.075, 0.03), (0.098, 0.09),
        (0.088, 0.15), (0.05, 0.19), (0.0, 0.21),
    ], segmentos=7)
    # segunda camada girada: as pétalas de fora, ligeiramente abertas
    externa = girar_z(revolver([
        (0.05, 0.0), (0.112, 0.045), (0.10, 0.10), (0.055, 0.14),
    ], segmentos=7), math.radians(25))
    flor = mover(juntar(calice, botao, externa), (-0.20, 0, 0.03))
    # folha deitada ao longo da haste, com bico — não um retângulo vertical
    folha = juntar(
        caixa(0.10, 0.075, 0.012, (0.06, 0.055, 0.015)),
        caixa(0.05, 0.035, 0.012, (0.13, 0.075, 0.015)),
    )
    folha = ([(x, y, z) for x, y, z in folha[0]], [(f, 1) for f, _ in folha[1]])
    return objeto_de('PropRose', *juntar(haste, flor, folha), mats('Vermelho', 'Verde'))


PROPS = [martelo, bloco_martelo, lampada, cadeira, trono, tomate, sapato, rosa]

# Onde cada prop é olhado no preview: (distância, altura do alvo).
ENQUADRAMENTO = {
    'PropGavel': (1.9, 0.10), 'PropGavelBlock': (1.4, 0.05),
    'PropLamp': (1.9, 0.05), 'PropChair': (3.4, 0.55),
    'PropThrone': (4.2, 0.75), 'PropTomato': (1.1, 0.0),
    'PropShoe': (1.7, -0.02), 'PropRose': (1.7, 0.03),
}


def main():
    argumentos = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    destino = next((a.split('=', 1)[1] for a in argumentos if a.startswith('--out=')),
                   os.path.join(os.getcwd(), 'build', 'props'))
    os.makedirs(destino, exist_ok=True)

    limpar_cena()
    pecas = [construtor() for construtor in PROPS]
    for peca in pecas:
        desdobrar_uv(peca)
        sombrear_plano(peca)

    camera = montar_estudio(largura=520, altura=520)
    for peca in pecas:
        for outra in pecas:
            outra.hide_render = outra is not peca
        distancia, alvo_z = ENQUADRAMENTO.get(peca.name, (2.4, 0.2))
        renderizar(
            camera,
            (-distancia * 0.72, -distancia * 0.72, alvo_z + distancia * 0.42),
            (math.radians(74), 0, math.radians(-45)),
            os.path.join(destino, f'{peca.name.replace("Prop", "").lower()}.png'),
        )
    for peca in pecas:
        peca.hide_render = False

    exportar_glb(os.path.join(destino, 'props.glb'))
    print(f'PROPS: {len(pecas)}  TRIANGULOS: {contar_triangulos(pecas)}')
    print('NOMES: ' + ', '.join(p.name for p in pecas))
    print(f'SAIDA: {destino}')


if __name__ == '__main__':
    main()
