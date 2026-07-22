"""
Cultista d'A Mesa — construção paramétrica no Blender.

    blender --background --python tools/blender/cultist.py -- --out=<dir>

Por que script e não modelagem à mão:

* **Reprodutível.** Muda um número, roda de novo, saem as sete peças coerentes.
  Personagem modular não tolera peça que "quase" encaixa.
* **Nome de nó é contrato.** `HoodSpire`, `PropCandle`, material `Tunica`: o
  manifesto `a-mesa.actor/v1` liga peça por nome, e errar um nome quebra a
  aparência em silêncio. Escrevendo, acerta-se de primeira.
* **A fonte já existia.** Os perfis vêm de `src/lib/three/reus.ts`, que já
  descrevia o cultista como torno. Aqui ele ganha rig, UV e modificadores.

Direção: PS1 / Inscryption. Contagem baixa de segmentos é intencional — o palco
renderiza em `largura/4` com posterização, então malha lisa demais some no
filtro. O detalhe mora na textura, não na geometria.
"""

import bpy
import bmesh
import math
import os
import sys
from mathutils import Vector

# ── parâmetros da silhueta ──────────────────────────────────────────────────
# Blender é Z-up e a frente do personagem olha para -Y; o exportador converte
# para a convenção glTF (+Y cima, +Z frente) declarada no manifesto.

# Radiais BAIXOS de propósito. O estilo é facetado duro: a graça é ver cada
# plano pegando luz diferente. Passar de 8~10 no capuz apaga as facetas e a
# peça vira um blob arredondado — foi o primeiro erro desta construção.
SEGMENTOS = 10
SEGMENTOS_CAPUZ = 8     # múltiplo de 4: a boca cai exatamente na frente
ALTURA_CINTURA = 1.14
ALTURA_OMBRO = 1.54
# O capuz NASCE dentro do mantelete, não em cima dele. Base acima do topo da
# capa faz o capuz flutuar como chapéu pousado numa prateleira.
ALTURA_BASE_CAPUZ = 1.48

# (raio, z) — saia que abre da cintura até o chão, com a barra pesada
# Largura/altura ≈ 0,58, medido da referência. A versão anterior usava 0,84 e o
# resultado era um sino — com o capuz parecendo pequeno só por comparação.
PERFIL_SAIA = [
    (0.20, 0.00), (0.60, 0.02), (0.58, 0.22), (0.53, 0.54),
    (0.47, 0.84), (0.43, 1.02), (0.39, ALTURA_CINTURA),
]
# torso levemente cônico da cintura ao ombro
PERFIL_TORSO = [
    (0.39, ALTURA_CINTURA), (0.385, 1.34), (0.37, ALTURA_OMBRO),
]
# Mantelete: capa curta sobre os ombros, em queda contínua até uma borda SECA.
# A referência tem um bico definido embaixo; degrau no meio do perfil é o que
# fazia a peça virar pilha de prateleiras sob sombreamento plano.
PERFIL_MANTELETE = [
    (0.23, 1.69), (0.37, 1.59), (0.49, 1.45), (0.56, 1.31), (0.43, 1.26),
]

# Capuz cônico e alto, como nas referências: altura ≳ 1,3× o raio. Abobadado
# some no filtro de pixel; ponta define o personagem mesmo a 160px de altura.
# `boca` = quantos setores dos 8 viram abertura. 2 = 90°, 3 = 135°.
CAPUZES = {
    'HoodClassic': dict(raio=0.47, altura=0.92, inclinacao=0.15, boca=2, aba=0.30, boca_ate=3),
    'HoodSpire': dict(raio=0.40, altura=1.26, inclinacao=0.07, boca=2, aba=0.24, boca_ate=3),
    'HoodShrouded': dict(raio=0.56, altura=0.68, inclinacao=0.24, boca=3, aba=0.48, boca_ate=3),
}

MATERIAIS = {
    # Base CLARA de propósito: a paleta do manifesto multiplica esta cor. Base
    # escura sujaria todas as oito túnicas.
    'Tunica': (0.86, 0.84, 0.80, 1.0),
    'Acessorio': (0.90, 0.86, 0.76, 1.0),
    'Pele': (0.91, 0.89, 0.84, 1.0),
    'Vazio': (0.02, 0.02, 0.03, 1.0),
    'Rosto': (0.95, 0.93, 0.88, 1.0),
}

ANCORAS = {
    'AnchorRoot': (0.0, 0.0, 0.0),
    'AnchorChest': (0.0, -0.10, 1.42),
    'AnchorHead': (0.0, -0.06, 1.92),
    'AnchorNameplate': (0.0, -0.46, 1.30),
    'AnchorLeftHand': (-0.43, -0.70, 0.42),
    'AnchorRightHand': (0.43, -0.70, 0.42),
    'AnchorProjectileOrigin': (0.43, -0.80, 0.50),
}


# ── utilidades ──────────────────────────────────────────────────────────────

def limpar_cena():
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete(use_global=False)
    for colecao in (bpy.data.meshes, bpy.data.materials, bpy.data.armatures,
                    bpy.data.objects, bpy.data.images):
        for item in list(colecao):
            colecao.remove(item)


def textura_rosto():
    """
    A carinha: dois olhos e uma boca acesos sobre transparência.

    Gerada aqui porque o asset precisa de UMA cara padrão para preview e para o
    caso de o runtime não pintar nada. Em partida, `drawRosto` (`reus.ts`) troca
    esta textura por expressão — por isso ela é imagem, e não geometria: olho
    modelado congelaria a expressão no asset.
    """
    largura = 64
    imagem = bpy.data.images.new('RostoLED', largura, largura, alpha=True)
    pixels = [0.0] * (largura * largura * 4)

    def acender(x0, y0, x1, y1, cor):
        for y in range(y0, y1):
            for x in range(x0, x1):
                i = (y * largura + x) * 4
                pixels[i:i + 4] = [cor[0], cor[1], cor[2], 1.0]

    creme = (1.0, 0.96, 0.88)
    # Olhos GRANDES e bem separados. A 160px na tela do jogo, olho pequeno vira
    # um pixel cinza; o exagero aqui é o que sobrevive ao filtro.
    acender(9, 30, 25, 46, creme)
    acender(39, 30, 55, 46, creme)
    # boca: fenda larga e baixa, alinhada ao centro entre os olhos
    acender(24, 14, 40, 20, creme)
    imagem.pixels = pixels
    imagem.pack()
    return imagem


def material(nome):
    if nome in bpy.data.materials:
        return bpy.data.materials[nome]
    mat = bpy.data.materials.new(nome)
    mat.use_nodes = True
    nos = mat.node_tree.nodes
    principled = nos.get('Principled BSDF')
    if principled:
        principled.inputs['Base Color'].default_value = MATERIAIS[nome]
        principled.inputs['Roughness'].default_value = 0.92
        if 'Metallic' in principled.inputs:
            principled.inputs['Metallic'].default_value = 0.0

    if nome == 'Rosto' and principled:
        # EMISSIVO e recortado. É o Veigar: o capuz engole a cabeça e sobram
        # duas luzes no escuro. Sem emissão o rosto morre junto com a sala no
        # blackout do ato final — que é exatamente quando ele mais importa.
        textura = nos.new('ShaderNodeTexImage')
        textura.image = textura_rosto()
        textura.interpolation = 'Closest'      # pixel duro, sem borrar
        textura.location = (-420, 120)
        ligacoes = mat.node_tree.links
        if 'Emission Color' in principled.inputs:
            ligacoes.new(textura.outputs['Color'], principled.inputs['Emission Color'])
            principled.inputs['Emission Strength'].default_value = 12.0
        ligacoes.new(textura.outputs['Alpha'], principled.inputs['Alpha'])
        principled.inputs['Base Color'].default_value = (0, 0, 0, 1)
        mat.blend_method = 'BLEND' if hasattr(mat, 'blend_method') else mat.blend_method
    return mat


def objeto_de(nome, verts, faces, mats):
    """Cria um objeto a partir de listas puras; `faces` traz o índice do material."""
    mesh = bpy.data.meshes.new(nome)
    mesh.from_pydata(verts, [], [f for f, _ in faces])
    mesh.validate(verbose=False)
    for nome_mat in mats:
        mesh.materials.append(material(nome_mat))
    for poligono, (_, indice) in zip(mesh.polygons, faces):
        poligono.material_index = indice
    obj = bpy.data.objects.new(nome, mesh)
    bpy.context.collection.objects.link(obj)
    return obj


def revolver(perfil, segmentos=SEGMENTOS, indice_material=0, pular_frente=None,
             pular_ate=None, deslocamento=(0.0, 0.0, 0.0), escala_z=1.0):
    """
    Revolve um perfil (raio, z) em torno de Z. É o mesmo `LatheGeometry` que o
    `reus.ts` usa; a diferença é que aqui o resultado ganha UV, rig e export.

    `pular_frente` (graus) abre um vão virado para -Y — é assim que o capuz ganha
    boca sem depender de boolean, que é frágil em script. `pular_ate` limita o
    vão aos primeiros anéis do perfil: sem isso o buraco sobe até a ponta e o
    capuz inteiro vira um vazio.
    """
    verts, faces = [], []
    dx, dy, dz = deslocamento
    for s in range(segmentos):
        angulo = 2.0 * math.pi * s / segmentos
        cos_a, sin_a = math.cos(angulo), math.sin(angulo)
        for raio, z in perfil:
            verts.append((raio * cos_a + dx, raio * sin_a + dy, z * escala_z + dz))

    n = len(perfil)
    limite = n if pular_ate is None else pular_ate
    for s in range(segmentos):
        proximo = (s + 1) % segmentos
        meio = 2.0 * math.pi * (s + 0.5) / segmentos
        # -Y é a frente: o vão fica centrado em 270°
        delta = abs((math.degrees(meio) - 270.0 + 180.0) % 360.0 - 180.0)
        na_frente = pular_frente is not None and delta <= pular_frente
        for i in range(n - 1):
            if na_frente and i < limite:
                continue
            a = s * n + i
            b = s * n + i + 1
            c = proximo * n + i + 1
            d = proximo * n + i
            faces.append(((a, b, c, d), indice_material))
    return verts, faces


def juntar(*blocos):
    """Concatena (verts, faces) reindexando — evita objeto extra por peça."""
    verts, faces = [], []
    for bloco_verts, bloco_faces in blocos:
        base = len(verts)
        verts.extend(bloco_verts)
        faces.extend(((tuple(i + base for i in face), mat) for face, mat in bloco_faces))
    return verts, faces


def quad_rosto(largura, altura, centro, indice_material):
    """
    O rosto é UM quad, não uma caixa. Caixa entrega seis faces ao
    `smart_project`, que as espalha em ilhas arbitrárias — a textura da carinha
    caía em qualquer lugar menos na frente. Com um polígono só, o UV é fixado à
    mão logo depois do desdobramento.
    """
    cx, cy, cz = centro
    hx, hz = largura / 2, altura / 2
    verts = [(cx - hx, cy, cz - hz), (cx + hx, cy, cz - hz),
             (cx + hx, cy, cz + hz), (cx - hx, cy, cz + hz)]
    return verts, [((0, 1, 2, 3), indice_material)]


def caixa(largura, profundidade, altura, centro, indice_material=0):
    cx, cy, cz = centro
    hx, hy, hz = largura / 2, profundidade / 2, altura / 2
    verts = [
        (cx - hx, cy - hy, cz - hz), (cx + hx, cy - hy, cz - hz),
        (cx + hx, cy + hy, cz - hz), (cx - hx, cy + hy, cz - hz),
        (cx - hx, cy - hy, cz + hz), (cx + hx, cy - hy, cz + hz),
        (cx + hx, cy + hy, cz + hz), (cx - hx, cy + hy, cz + hz),
    ]
    quads = [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4),
             (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]
    return verts, [(q, indice_material) for q in quads]


def tubo(inicio, fim, raio_inicio, raio_fim, segmentos=8, indice_material=0):
    """Manga em T-pose: cilindro entre dois pontos, com punho mais largo."""
    inicio, fim = Vector(inicio), Vector(fim)
    eixo = (fim - inicio)
    comprimento = eixo.length
    eixo.normalize()
    referencia = Vector((0, 0, 1)) if abs(eixo.z) < 0.9 else Vector((1, 0, 0))
    u = eixo.cross(referencia).normalized()
    v = eixo.cross(u).normalized()

    verts, faces = [], []
    for s in range(segmentos):
        angulo = 2.0 * math.pi * s / segmentos
        direcao = u * math.cos(angulo) + v * math.sin(angulo)
        verts.append(tuple(inicio + direcao * raio_inicio))
        verts.append(tuple(inicio + eixo * comprimento + direcao * raio_fim))
    for s in range(segmentos):
        proximo = (s + 1) % segmentos
        a, b = s * 2, s * 2 + 1
        c, d = proximo * 2 + 1, proximo * 2
        faces.append(((a, b, c, d), indice_material))
    # tampa do punho: o vão escuro que aparece na referência
    tampa = [s * 2 + 1 for s in range(segmentos)]
    faces.append((tuple(reversed(tampa)), indice_material))
    return verts, faces


# ── peças ───────────────────────────────────────────────────────────────────

def construir_corpo():
    """
    Túnica inteira num objeto só: draw call é o orçamento apertado aqui.

    Sem mangas e sem pés de propósito. O cultista é uma silhueta FECHADA — a
    túnica desce direto ao chão e as mãos flutuam soltas, como no procedural.
    É o que dá o ar de aparição em vez de boneco articulado, e de quebra some
    com o pior defeito de deformação: sem junta exposta, nada quebra ao girar.
    """
    saia = revolver(PERFIL_SAIA)
    torso = revolver(PERFIL_TORSO)
    mantelete = manto_recortado(PERFIL_MANTELETE)
    verts, faces = juntar(saia, torso, mantelete)
    return objeto_de('RobeBody', verts, faces, ['Tunica'])


def manto_recortado(perfil, segmentos=SEGMENTOS, bicos=0.09, indice_material=0):
    """
    Mantelete com a barra em bico, não em círculo.

    Um torno puro dá uma borda perfeitamente circular, e sob sombreamento plano
    isso lê como abajur — foi o que a capa virou nas primeiras versões. A
    referência tem pontas: alternar o comprimento da barra a cada setor produz
    esse recorte com zero custo extra de polígono, e é justamente o tipo de
    detalhe que sobrevive à posterização do palco.
    """
    verts, faces = [], []
    n = len(perfil)
    for s in range(segmentos):
        angulo = 2.0 * math.pi * s / segmentos
        cos_a, sin_a = math.cos(angulo), math.sin(angulo)
        # setores pares descem mais: a barra vira zigue-zague
        alonga = bicos if s % 2 == 0 else 0.0
        for i, (raio, z) in enumerate(perfil):
            # só a última aresta se move; o ombro continua colado no corpo
            peso = (i / (n - 1)) ** 2
            verts.append((raio * cos_a, raio * sin_a, z - alonga * peso))

    for s in range(segmentos):
        proximo = (s + 1) % segmentos
        for i in range(n - 1):
            a, b = s * n + i, s * n + i + 1
            c, d = proximo * n + i + 1, proximo * n + i
            faces.append(((a, b, c, d), indice_material))
    return verts, faces


# Mãos flutuando na beirada da mesa, como em `reus.ts` (BASE_MAO_Y = 0.28).
# Elas não pendem de braço nenhum: a animação move os ossos `hand.*` direto.
POSICAO_MAOS = ((-0.43, -0.70, 0.42), (0.43, -0.70, 0.42))


def construir_maos():
    perfil_mao = [(0.0, -0.09), (0.13, -0.05), (0.155, 0.02), (0.12, 0.08), (0.0, 0.11)]
    blocos = []
    for x, y, z in POSICAO_MAOS:
        verts, faces = revolver(perfil_mao, segmentos=8)
        blocos.append(([(vx + x, vy + y, vz + z) for vx, vy, vz in verts], faces))
    verts, faces = juntar(*blocos)
    return objeto_de('Hands', verts, faces, ['Pele'])


def construir_corda():
    """Corda na cintura + cordões caídos + pingente — a peça de acento."""
    cinta = revolver([(0.392, ALTURA_CINTURA - 0.038), (0.425, ALTURA_CINTURA),
                      (0.392, ALTURA_CINTURA + 0.038)])
    cordao_a = tubo((0.06, -0.40, ALTURA_CINTURA), (0.08, -0.38, 0.74), 0.028, 0.022, 6)
    cordao_b = tubo((0.13, -0.38, ALTURA_CINTURA), (0.15, -0.36, 0.84), 0.026, 0.020, 6)
    no_corda = revolver([(0.0, 0.0), (0.10, 0.035), (0.10, 0.115), (0.0, 0.15)], segmentos=6)
    no_corda = ([(x, y - 0.40, z + ALTURA_CINTURA - 0.075) for x, y, z in no_corda[0]], no_corda[1])
    pingente = caixa(0.11, 0.06, 0.14, (0.08, -0.38, 0.66))
    verts, faces = juntar(cinta, no_corda, cordao_a, cordao_b, pingente)
    return objeto_de('Rope', verts, faces, ['Acessorio'])


def construir_capuz(nome, raio, altura, inclinacao, boca, aba, boca_ate):
    """
    Capuz facetado com boca de tecido REAL.

    A construção é casca dupla costurada na borda: a superfície de fora e a de
    dentro são geradas separadamente e depois unidas ao longo do recorte. Isso é
    o que dá espessura visível no contorno da boca — sem essa costura o capuz
    vira papel recortado, que foi como a primeira versão ficou.

    Dentro, o vazio preto e o plano do rosto. A carinha do jogo é textura
    trocada em runtime, não morph target, então o plano precisa existir no asset
    para o runtime ter onde pintar.
    """
    base_z = ALTURA_BASE_CAPUZ
    n_seg = SEGMENTOS_CAPUZ
    # Perfil ANGULOSO: sobe quase reto e vira ponta. Ombro arredondado no meio
    # do perfil é o que fazia o capuz parecer capacete.
    perfil = [
        (raio * 0.76, base_z),
        (raio * 1.00, base_z + altura * 0.15),
        (raio * 0.95, base_z + altura * 0.36),
        (raio * 0.74, base_z + altura * 0.58),
        (raio * 0.40, base_z + altura * 0.82),
        (0.02, base_z + altura),
    ]
    n = len(perfil)
    # Casca de dentro mais justa: lábio fino. Em 0,86 a testa do capuz
    # engrossava e o personagem ganhava cara de capacete.
    espessura = 0.91
    anel_boca = boca_ate

    # A boca fica centrada na frente (-Y). Com n_seg múltiplo de 4, os setores
    # cortados são simétricos em torno de 270°.
    inicio_corte = (n_seg * 3) // 4 - boca // 2
    cortados = {(inicio_corte + i) % n_seg for i in range(boca)}

    def anel(r_escala, s, i):
        angulo = 2.0 * math.pi * s / n_seg
        raio_p, z = perfil[i]
        return (raio_p * r_escala * math.cos(angulo),
                raio_p * r_escala * math.sin(angulo), z)

    verts, faces = [], []
    indice = {}

    def vert(camada, s, i):
        chave = (camada, s % n_seg, i)
        if chave not in indice:
            indice[chave] = len(verts)
            verts.append(anel(1.0 if camada == 'fora' else espessura, s % n_seg, i))
        return indice[chave]

    for s in range(n_seg):
        for i in range(n - 1):
            aberto = s in cortados and 1 <= i < anel_boca
            if not aberto:
                faces.append(((vert('fora', s, i), vert('fora', s, i + 1),
                               vert('fora', s + 1, i + 1), vert('fora', s + 1, i)), 0))
            # A casca de dentro é o vazio que se vê pela boca — mas ela também
            # precisa do recorte. Fechada na frente, ela tapa o rosto: era isso
            # que deixava o capuz sem carinha, com o LED selado lá dentro.
            if not aberto:
                faces.append(((vert('dentro', s + 1, i), vert('dentro', s + 1, i + 1),
                               vert('dentro', s, i + 1), vert('dentro', s, i)), 1))

    # Costura da borda: liga fora↔dentro ao longo do recorte. São as três
    # bordas do vão — as duas laterais e o arco de cima.
    lados = [(inicio_corte, 1), (inicio_corte + boca, -1)]
    for s, sentido in lados:
        for i in range(1, anel_boca):
            a, b = vert('fora', s, i), vert('fora', s, i + 1)
            c, d = vert('dentro', s, i + 1), vert('dentro', s, i)
            faces.append(((a, b, c, d) if sentido > 0 else (d, c, b, a), 0))
    for s in range(inicio_corte, inicio_corte + boca):
        a, b = vert('fora', s, anel_boca), vert('fora', s + 1, anel_boca)
        c, d = vert('dentro', s + 1, anel_boca), vert('dentro', s, anel_boca)
        faces.append(((a, b, c, d), 0))
    # lábio inferior da abertura, agora no anel 1
    for s in range(inicio_corte, inicio_corte + boca):
        a, b = vert('fora', s + 1, 1), vert('fora', s, 1)
        c, d = vert('dentro', s, 1), vert('dentro', s + 1, 1)
        faces.append(((a, b, c, d), 0))

    bloco_capuz = (verts, faces)

    # Aba traseira: a queda de tecido que liga o capuz ao mantelete. Sem ela o
    # capuz fica "pousado" e a nuca some.
    perfil_aba = [
        (raio * 0.74, base_z),
        (raio * 0.92, base_z - aba * 0.45),
        (raio * 0.80, base_z - aba),
    ]
    traseira = revolver(perfil_aba, segmentos=n_seg, indice_material=0,
                        pular_frente=200.0 / max(1, boca), pular_ate=len(perfil_aba))

    # O rosto se alinha à ABERTURA, não à altura total do capuz. Derivar da
    # altura fazia a carinha subir acima da boca no capuz alto (`spire`) e
    # aparecer só a testa — cada capuz tem sua janela, e é nela que a cara mora.
    boca_z0, boca_z1 = perfil[1][1], perfil[anel_boca][1]
    centro_boca = (boca_z0 + boca_z1) / 2
    janela = boca_z1 - boca_z0
    # Recuado o bastante para o capuz cobrir a cabeça, perto o bastante para as
    # luzes serem vistas pela boca. É o equilíbrio do Veigar.
    rosto = quad_rosto(raio * 0.92, janela * 1.10,
                       (0.0, -raio * 0.42, centro_boca), indice_material=2)

    # Tampa do vazio atrás do rosto: sem ela, a boca aberta deixa ver o fundo da
    # cena através do capuz — o vazio precisa ser vazio, não buraco.
    fundo = quad_rosto(raio * 1.06, janela * 1.5,
                       (0.0, raio * 0.10, centro_boca), indice_material=1)

    verts, faces = juntar(bloco_capuz, traseira, fundo, rosto)

    # A ponta cai para a frente — o perfil de carrasco das referências. O giro
    # acontece em torno da BASE do capuz; `rotation_euler` giraria em torno da
    # origem do mundo e o capuz sairia voando para fora do mantelete.
    angulo = math.radians(-inclinacao * 60.0)
    cos_a, sin_a = math.cos(angulo), math.sin(angulo)
    verts = [
        (x,
         y * cos_a - (z - base_z) * sin_a,
         y * sin_a + (z - base_z) * cos_a + base_z)
        for x, y, z in verts
    ]
    return objeto_de(nome, verts, faces, ['Tunica', 'Vazio', 'Rosto'])


def construir_props():
    corrente = juntar(*[
        revolver([(0.05, 0.0), (0.07, 0.02), (0.05, 0.04)], segmentos=6,
                 deslocamento=(0.0, -0.40, 0.0), escala_z=1.0)
        for _ in range(1)
    ])
    corrente = ([(x, y + 0.02 * i, z + 1.06 - 0.07 * i)
                 for i in range(4) for x, y, z in corrente[0]],
                [(tuple(v + i * len(corrente[0]) for v in face), m)
                 for i in range(4) for face, m in corrente[1]])
    chain = objeto_de('PropChain', corrente[0], corrente[1], ['Acessorio'])

    cera = revolver([(0.0, 0.0), (0.05, 0.01), (0.045, 0.26), (0.0, 0.28)], segmentos=8)
    chama = revolver([(0.0, 0.28), (0.025, 0.33), (0.0, 0.41)], segmentos=6)
    verts, faces = juntar(cera, chama)
    verts = [(x - 0.40, y - 0.34, z + 1.22) for x, y, z in verts]
    candle = objeto_de('PropCandle', verts, faces, ['Acessorio'])

    corpo = revolver([(0.0, 0.0), (0.07, 0.06), (0.06, 0.15), (0.0, 0.21)], segmentos=6)
    verts = [(x + 0.28, y - 0.40, z + 0.90) for x, y, z in corpo[0]]
    relic = objeto_de('PropRelic', verts, corpo[1], ['Acessorio'])
    return [chain, candle, relic]


# ── rig, UV e acabamento ────────────────────────────────────────────────────

def construir_armature(pecas):
    """
    Oito ossos. A túnica não tem perna e o palco vê o ator a ~160px: esqueleto
    grande aqui é peso sem retorno.
    """
    armature = bpy.data.armatures.new('ActorArmature')
    obj = bpy.data.objects.new('ActorRoot', armature)
    bpy.context.collection.objects.link(obj)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.mode_set(mode='EDIT')

    # Seis ossos. Sem braço: as mãos flutuam e recebem osso próprio, que é
    # exatamente o vocabulário das animações atuais — o `reus.ts` move a posição
    # das mãos e inclina o tronco, nada mais.
    ossos = [
        ('root', (0, 0, 0.0), (0, 0, 0.36), None),
        ('spine', (0, 0, 0.36), (0, 0, ALTURA_CINTURA), 'root'),
        ('chest', (0, 0, ALTURA_CINTURA), (0, 0, ALTURA_OMBRO), 'spine'),
        ('head', (0, 0, ALTURA_OMBRO), (0, -0.08, 2.20), 'chest'),
        ('hand.L', POSICAO_MAOS[0], (POSICAO_MAOS[0][0], POSICAO_MAOS[0][1], 0.60), 'chest'),
        ('hand.R', POSICAO_MAOS[1], (POSICAO_MAOS[1][0], POSICAO_MAOS[1][1], 0.60), 'chest'),
    ]
    for nome, cabeca, cauda, pai in ossos:
        osso = armature.edit_bones.new(nome)
        osso.head, osso.tail = cabeca, cauda
        if pai:
            osso.parent = armature.edit_bones[pai]
            osso.use_connect = pai in ('root', 'spine', 'shoulder.L', 'shoulder.R')
    bpy.ops.object.mode_set(mode='OBJECT')

    for peca in pecas:
        peca.parent = obj
        modificador = peca.modifiers.new('Armature', 'ARMATURE')
        modificador.object = obj
        if peca.name == 'Hands':
            # As duas mãos vivem no mesmo objeto (um draw call), mas animam
            # separadas — o lado decide o osso.
            esquerda = peca.vertex_groups.new(name='hand.L')
            direita = peca.vertex_groups.new(name='hand.R')
            for vertice in peca.data.vertices:
                alvo = esquerda if vertice.co.x < 0 else direita
                alvo.add([vertice.index], 1.0, 'REPLACE')
            continue
        grupo = peca.vertex_groups.new(name=osso_para(peca.name))
        grupo.add(range(len(peca.data.vertices)), 1.0, 'REPLACE')
    return obj


def osso_para(nome_peca):
    """Skinning rígido por peça: a silhueta é rígida e o estilo agradece."""
    if nome_peca.startswith('Hood'):
        return 'head'
    if nome_peca.startswith('Prop'):
        return 'chest'
    return 'spine'


ROSTO_UV = [(0.0, 0.0), (1.0, 0.0), (1.0, 1.0), (0.0, 1.0)]


def desdobrar_uv(peca):
    bpy.context.view_layer.objects.active = peca
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.02)
    bpy.ops.object.mode_set(mode='OBJECT')

    # O quad do rosto recebe o UV inteiro na mão: a carinha precisa ocupar
    # exatamente a textura, e o desdobramento automático não garante isso.
    indice_rosto = next((i for i, m in enumerate(peca.data.materials)
                         if m and m.name == 'Rosto'), None)
    if indice_rosto is None:
        return
    camada = peca.data.uv_layers.active
    for poligono in peca.data.polygons:
        if poligono.material_index != indice_rosto:
            continue
        for ordem, indice_loop in enumerate(poligono.loop_indices):
            camada.data[indice_loop].uv = ROSTO_UV[ordem % 4]


def sombrear_plano(peca):
    """Flat shading: PS1 não tinha normal suave, e o dithering come o degradê."""
    for poligono in peca.data.polygons:
        poligono.use_smooth = False


# ── animação ────────────────────────────────────────────────────────────────
# Um clip por intenção do `a-mesa.actor/v1`. O vocabulário é o mesmo que o
# `reus.ts` já encena — inclinar o tronco e mover as mãos —, então portar é
# transcrever, não inventar. Poses exageradas de propósito: a 160 px na tela,
# gesto sutil não existe.
#
# Cada quadro é (frame, {osso: {canal: valor}}); canais são `location` e
# `rotation_euler` em espaço de pose.

FPS = 24

CLIPES = {
    'idle': dict(loop=True, quadros=[
        (0, {'spine': {'rot': (0, 0, 0)}, 'hand.L': {'loc': (0, 0, 0)}, 'hand.R': {'loc': (0, 0, 0)}}),
        (24, {'spine': {'rot': (0.012, 0, 0.01)}, 'hand.L': {'loc': (0, 0, 0.022)}, 'hand.R': {'loc': (0, 0, -0.018)}}),
        (48, {'spine': {'rot': (0, 0, 0)}, 'hand.L': {'loc': (0, 0, 0)}, 'hand.R': {'loc': (0, 0, 0)}}),
    ]),
    # dedo em riste: a mão sobe e trava tremendo
    'point': dict(loop=False, quadros=[
        (0, {'chest': {'rot': (0, 0, 0)}, 'hand.R': {'loc': (0, 0, 0)}}),
        (6, {'chest': {'rot': (0.16, 0, 0)}, 'hand.R': {'loc': (0.06, -0.30, 0.46)}}),
        (20, {'chest': {'rot': (0.15, 0, 0)}, 'hand.R': {'loc': (0.05, -0.28, 0.44)}}),
        (30, {'chest': {'rot': (0, 0, 0)}, 'hand.R': {'loc': (0, 0, 0)}}),
    ]),
    'speak': dict(loop=False, quadros=[
        (0, {'head': {'rot': (0, 0, 0)}, 'hand.R': {'loc': (0, 0, 0)}}),
        (8, {'head': {'rot': (0.10, 0, 0.05)}, 'hand.R': {'loc': (0.04, -0.20, 0.30)}}),
        (18, {'head': {'rot': (0.04, 0, -0.04)}, 'hand.R': {'loc': (0.03, -0.18, 0.26)}}),
        (30, {'head': {'rot': (0, 0, 0)}, 'hand.R': {'loc': (0, 0, 0)}}),
    ]),
    # gargalhada: cabeça pra trás e o corpo inteiro sacode
    'laugh': dict(loop=False, quadros=[
        (0, {'chest': {'rot': (0, 0, 0)}, 'head': {'rot': (0, 0, 0)}}),
        (5, {'chest': {'rot': (-0.20, 0, 0.06)}, 'head': {'rot': (-0.26, 0, 0)}}),
        (11, {'chest': {'rot': (-0.14, 0, -0.06)}, 'head': {'rot': (-0.20, 0, 0)}}),
        (17, {'chest': {'rot': (-0.20, 0, 0.06)}, 'head': {'rot': (-0.26, 0, 0)}}),
        (30, {'chest': {'rot': (0, 0, 0)}, 'head': {'rot': (0, 0, 0)}}),
    ]),
    'clap': dict(loop=False, quadros=[
        (0, {'hand.L': {'loc': (0, 0, 0)}, 'hand.R': {'loc': (0, 0, 0)}}),
        (5, {'hand.L': {'loc': (0.34, -0.10, 0.34)}, 'hand.R': {'loc': (-0.34, -0.10, 0.34)}}),
        (9, {'hand.L': {'loc': (0.14, -0.10, 0.34)}, 'hand.R': {'loc': (-0.14, -0.10, 0.34)}}),
        (13, {'hand.L': {'loc': (0.34, -0.10, 0.34)}, 'hand.R': {'loc': (-0.34, -0.10, 0.34)}}),
        (17, {'hand.L': {'loc': (0.14, -0.10, 0.34)}, 'hand.R': {'loc': (-0.14, -0.10, 0.34)}}),
        (28, {'hand.L': {'loc': (0, 0, 0)}, 'hand.R': {'loc': (0, 0, 0)}}),
    ]),
    # mãos pro alto e pulinhos
    'celebrate': dict(loop=False, quadros=[
        (0, {'root': {'loc': (0, 0, 0)}, 'hand.L': {'loc': (0, 0, 0)}, 'hand.R': {'loc': (0, 0, 0)}}),
        (6, {'root': {'loc': (0, 0, 0.16)}, 'hand.L': {'loc': (-0.10, 0.20, 0.92)}, 'hand.R': {'loc': (0.10, 0.20, 0.92)}}),
        (12, {'root': {'loc': (0, 0, 0)}, 'hand.L': {'loc': (-0.06, 0.20, 0.86)}, 'hand.R': {'loc': (0.06, 0.20, 0.86)}}),
        (18, {'root': {'loc': (0, 0, 0.14)}, 'hand.L': {'loc': (-0.10, 0.20, 0.92)}, 'hand.R': {'loc': (0.10, 0.20, 0.92)}}),
        (34, {'root': {'loc': (0, 0, 0)}, 'hand.L': {'loc': (0, 0, 0)}, 'hand.R': {'loc': (0, 0, 0)}}),
    ]),
    'facepalm': dict(loop=False, quadros=[
        (0, {'head': {'rot': (0, 0, 0)}, 'hand.R': {'loc': (0, 0, 0)}}),
        (10, {'head': {'rot': (0.20, 0, 0)}, 'hand.R': {'loc': (-0.34, 0.24, 0.66)}}),
        (24, {'head': {'rot': (0.18, 0, 0.08)}, 'hand.R': {'loc': (-0.34, 0.24, 0.66)}}),
        (36, {'head': {'rot': (0, 0, 0)}, 'hand.R': {'loc': (0, 0, 0)}}),
    ]),
    # recuo seco: o capuz chega atrasado, como no procedural
    'hit': dict(loop=False, quadros=[
        (0, {'spine': {'rot': (0, 0, 0)}, 'head': {'rot': (0, 0, 0)}}),
        (3, {'spine': {'rot': (-0.24, 0, 0.10)}, 'head': {'rot': (-0.30, 0, 0.14)}}),
        (9, {'spine': {'rot': (0.06, 0, -0.05)}, 'head': {'rot': (0.10, 0, -0.06)}}),
        (18, {'spine': {'rot': (0, 0, 0)}, 'head': {'rot': (0, 0, 0)}}),
    ]),
    'rage': dict(loop=False, quadros=[
        (0, {'spine': {'rot': (0, 0, 0)}, 'hand.L': {'loc': (0, 0, 0)}, 'hand.R': {'loc': (0, 0, 0)}}),
        (4, {'spine': {'rot': (0.16, 0, 0.09)}, 'hand.L': {'loc': (-0.24, 0, 0.34)}, 'hand.R': {'loc': (0.24, 0, 0.34)}}),
        (8, {'spine': {'rot': (0.16, 0, -0.09)}, 'hand.L': {'loc': (-0.24, 0, -0.10)}, 'hand.R': {'loc': (0.24, 0, -0.10)}}),
        (12, {'spine': {'rot': (0.16, 0, 0.09)}, 'hand.L': {'loc': (-0.24, 0, 0.34)}, 'hand.R': {'loc': (0.24, 0, 0.34)}}),
        (16, {'spine': {'rot': (0.16, 0, -0.09)}, 'hand.L': {'loc': (-0.24, 0, -0.10)}, 'hand.R': {'loc': (0.24, 0, -0.10)}}),
        (32, {'spine': {'rot': (0, 0, 0)}, 'hand.L': {'loc': (0, 0, 0)}, 'hand.R': {'loc': (0, 0, 0)}}),
    ]),
    'sleep': dict(loop=True, quadros=[
        (0, {'spine': {'rot': (0.12, 0, 0)}, 'head': {'rot': (0.22, 0, 0.06)}}),
        (36, {'spine': {'rot': (0.15, 0, 0)}, 'head': {'rot': (0.28, 0, 0.06)}}),
        (72, {'spine': {'rot': (0.12, 0, 0)}, 'head': {'rot': (0.22, 0, 0.06)}}),
    ]),
    # terminal: desaba sobre a mesa e NÃO volta — o último quadro é a pose final
    'collapse': dict(loop=False, quadros=[
        (0, {'spine': {'rot': (0, 0, 0)}, 'head': {'rot': (0, 0, 0)}, 'root': {'loc': (0, 0, 0)}}),
        (5, {'spine': {'rot': (-0.14, 0, 0)}, 'head': {'rot': (-0.18, 0, 0)}, 'root': {'loc': (0, 0, 0.04)}}),
        (22, {'spine': {'rot': (0.92, 0, 0.22)}, 'head': {'rot': (0.60, 0, 0.10)}, 'root': {'loc': (0, -0.10, -0.30)}}),
        (28, {'spine': {'rot': (0.88, 0, 0.24)}, 'head': {'rot': (0.64, 0, 0.12)}, 'root': {'loc': (0, -0.10, -0.28)}}),
    ]),
}


def criar_clipes(armature):
    """
    Gera uma Action por intenção. Cada uma vira uma animação nomeada no glTF —
    é assim que `clips.<intenção>.clip` do manifesto encontra o movimento.
    """
    bpy.context.view_layer.objects.active = armature
    bpy.ops.object.mode_set(mode='POSE')
    if not armature.animation_data:
        armature.animation_data_create()

    # Interpolação LINEAR na origem. O Blender 5.x guarda as curvas atrás do
    # sistema de slots/layers das Actions, então mexer nelas depois é frágil —
    # já criar os keyframes lineares evita o problema. Linear também é o certo
    # aqui: curva suave brigaria com a posterização e o dithering do palco.
    bpy.context.preferences.edit.keyframe_new_interpolation_type = 'LINEAR'

    for nome, definicao in CLIPES.items():
        acao = bpy.data.actions.new(nome)
        acao.use_fake_user = True          # sem isso o export perde a Action
        armature.animation_data.action = acao

        for osso in armature.pose.bones:
            osso.location = (0, 0, 0)
            osso.rotation_euler = (0, 0, 0)
            osso.rotation_mode = 'XYZ'

        for quadro, poses in definicao['quadros']:
            for nome_osso, canais in poses.items():
                osso = armature.pose.bones.get(nome_osso)
                if not osso:
                    continue
                if 'loc' in canais:
                    osso.location = canais['loc']
                    osso.keyframe_insert('location', frame=quadro)
                if 'rot' in canais:
                    osso.rotation_euler = canais['rot']
                    osso.keyframe_insert('rotation_euler', frame=quadro)

    # Desligar a Action não desfaz a pose: os ossos ficam onde o último keyframe
    # os deixou — e o último clip é o `collapse`. Sem este reset, o preview
    # renderiza o cultista caído de cara e o GLB sai com a pose de defunto.
    armature.animation_data.action = None
    for osso in armature.pose.bones:
        osso.location = (0, 0, 0)
        osso.rotation_euler = (0, 0, 0)
        osso.scale = (1, 1, 1)

    bpy.ops.object.mode_set(mode='OBJECT')
    return list(CLIPES)


def criar_ancoras(raiz):
    for nome, posicao in ANCORAS.items():
        empty = bpy.data.objects.new(nome, None)
        empty.empty_display_size = 0.08
        empty.location = posicao
        empty.parent = raiz
        bpy.context.collection.objects.link(empty)


# ── preview e export ────────────────────────────────────────────────────────

def renderizar_preview(caminho):
    """Um PNG por execução: é como a iteração acontece sem abrir a interface."""
    cena = bpy.context.scene
    # Workbench ignora material e devolve tudo cinza — inútil pra julgar o vazio
    # do capuz, que é justamente onde mora o personagem.
    motores = [item.identifier for item in
               bpy.types.RenderSettings.bl_rna.properties['engine'].enum_items]
    for candidato in ('BLENDER_EEVEE_NEXT', 'BLENDER_EEVEE', 'CYCLES'):
        if candidato in motores:
            cena.render.engine = candidato
            break
    print(f'MOTOR DE RENDER: {cena.render.engine}')
    cena.render.resolution_x, cena.render.resolution_y = 640, 800
    cena.render.film_transparent = False
    cena.world = bpy.data.worlds.new('Mundo')
    cena.world.use_nodes = True
    cena.world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.05, 0.05, 0.06, 1)

    camera_data = bpy.data.cameras.new('Camera')
    camera_data.lens = 52
    camera = bpy.data.objects.new('Camera', camera_data)
    bpy.context.collection.objects.link(camera)
    cena.camera = camera

    luz_data = bpy.data.lights.new('Key', type='AREA')
    luz_data.energy = 480
    luz_data.size = 4
    luz = bpy.data.objects.new('Key', luz_data)
    luz.location = (-2.4, -3.4, 3.6)
    luz.rotation_euler = (math.radians(50), 0, math.radians(-34))
    bpy.context.collection.objects.link(luz)

    # Frontal julga silhueta; 3/4 julga profundidade do capuz — que é onde o
    # personagem mora. Uma vista só engana em qualquer um dos dois.
    return camera


def renderizar_variantes(camera, pecas, destino):
    """
    Uma folha por capuz. Customização só se avalia vendo as opções lado a lado:
    um capuz bonito sozinho pode ser o único bonito do conjunto.
    """
    cena = bpy.context.scene
    vistas = {
        'frente': ((0.0, -5.4, 1.30), (math.radians(88), 0, 0)),
        'tres-quartos': ((-3.6, -3.8, 2.6), (math.radians(76), 0, math.radians(-43))),
    }
    ocultaveis = {p.name for p in pecas if p.name.startswith(('Hood', 'Prop'))}
    for capuz in CAPUZES:
        for peca in pecas:
            if peca.name in ocultaveis:
                peca.hide_render = peca.name != capuz
        for nome_vista, (posicao, rotacao) in vistas.items():
            camera.location = posicao
            camera.rotation_euler = rotacao
            cena.render.filepath = os.path.join(
                destino, f'{capuz.replace("Hood", "capuz-").lower()}-{nome_vista}.png')
            bpy.ops.render.render(write_still=True)
    for peca in pecas:
        peca.hide_render = False


def exportar(caminho):
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.export_scene.gltf(
        filepath=caminho,
        export_format='GLB',
        export_apply=True,
        export_yup=True,
        export_skins=True,
        export_animations=True,
        # Uma Action por intenção precisa virar uma animação NOMEADA no glTF.
        # Sem isto o exportador junta tudo numa timeline só e o manifesto não
        # encontra clip nenhum.
        export_animation_mode='ACTIONS',
        export_nla_strips=False,
        export_materials='EXPORT',
        export_cameras=False,
        export_lights=False,
        use_selection=False,
    )


def main():
    argumentos = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    destino = next((a.split('=', 1)[1] for a in argumentos if a.startswith('--out=')),
                   os.path.join(os.getcwd(), 'build', 'cultist'))
    os.makedirs(destino, exist_ok=True)

    limpar_cena()
    pecas = [construir_corpo(), construir_maos(), construir_corda()]
    pecas += [construir_capuz(nome, **cfg) for nome, cfg in CAPUZES.items()]
    pecas += construir_props()

    for peca in pecas:
        desdobrar_uv(peca)
        sombrear_plano(peca)

    raiz = construir_armature(pecas)
    clipes = criar_clipes(raiz)
    criar_ancoras(raiz)

    camera = renderizar_preview(os.path.join(destino, 'preview.png'))
    renderizar_variantes(camera, pecas, destino)
    exportar(os.path.join(destino, 'actor.glb'))

    triangulos = sum(len(p.data.loop_triangles) if p.data.loop_triangles else
                     sum(len(f.vertices) - 2 for f in p.data.polygons) for p in pecas)
    print(f'PECAS: {len(pecas)}  TRIANGULOS: {triangulos}  CLIPES: {len(clipes)}')
    print(f'SAIDA: {destino}')


if __name__ == '__main__':
    main()
