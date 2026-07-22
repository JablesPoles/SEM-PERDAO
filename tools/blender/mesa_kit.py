"""
Kit de construção d'A Mesa — geometria paramétrica para Blender headless.

Ferramentas compartilhadas entre os scripts que geram os assets do jogo. Não
conhece cultista, prop ou cenário: só sabe revolver perfis, montar caixas e
tubos, desdobrar UV e exportar. Cada script de asset traz sua própria direção.

Convenção: Blender é Z-up e a frente do objeto olha para -Y. O exportador
converte para a convenção glTF (+Y cima, +Z frente) declarada nos manifestos.

Direção transversal: PS1 / Inscryption. Contagem de segmentos baixa é
intencional — o palco renderiza em `largura/4` com posterização e dithering,
então malha lisa some no filtro. O detalhe mora na textura, não na geometria.
"""

import bpy
import math
from mathutils import Vector

SEGMENTOS = 10


def limpar_cena():
    """Cena virgem: script headless roda muitas vezes no mesmo processo."""
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete(use_global=False)
    for colecao in (bpy.data.meshes, bpy.data.materials, bpy.data.armatures,
                    bpy.data.objects, bpy.data.images, bpy.data.actions):
        for item in list(colecao):
            colecao.remove(item)


def material(nome, cor, rugosidade=0.92, emissivo=None, forca_emissao=0.0):
    """
    Material chapado. `cor` é RGBA 0–1.

    Base CLARA quando o material vai receber paleta do manifesto: a cor
    declarada lá multiplica esta — base escura sujaria todas as opções.
    """
    if nome in bpy.data.materials:
        return bpy.data.materials[nome]
    mat = bpy.data.materials.new(nome)
    mat.use_nodes = True
    principled = mat.node_tree.nodes.get('Principled BSDF')
    if principled:
        principled.inputs['Base Color'].default_value = cor
        principled.inputs['Roughness'].default_value = rugosidade
        if 'Metallic' in principled.inputs:
            principled.inputs['Metallic'].default_value = 0.0
        if emissivo and 'Emission Color' in principled.inputs:
            principled.inputs['Emission Color'].default_value = emissivo
            principled.inputs['Emission Strength'].default_value = forca_emissao
    return mat


def objeto_de(nome, verts, faces, materiais):
    """
    Cria um objeto a partir de listas puras.

    `faces` é uma lista de `(indices, indice_material)`; `materiais` são objetos
    de material já criados, na ordem dos índices.
    """
    mesh = bpy.data.meshes.new(nome)
    mesh.from_pydata(verts, [], [f for f, _ in faces])
    mesh.validate(verbose=False)
    for mat in materiais:
        mesh.materials.append(mat)
    for poligono, (_, indice) in zip(mesh.polygons, faces):
        poligono.material_index = indice
    obj = bpy.data.objects.new(nome, mesh)
    bpy.context.collection.objects.link(obj)
    return obj


def revolver(perfil, segmentos=SEGMENTOS, indice_material=0, pular_frente=None,
             pular_ate=None, deslocamento=(0.0, 0.0, 0.0), escala_z=1.0):
    """
    Revolve um perfil `(raio, z)` em torno de Z — o `LatheGeometry` do Three.js.

    `pular_frente` (graus) abre um vão virado para -Y sem depender de boolean,
    que é frágil em script. `pular_ate` limita o vão aos primeiros anéis: sem
    isso o buraco sobe até o topo e a peça inteira vira casca aberta.
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
        delta = abs((math.degrees(meio) - 270.0 + 180.0) % 360.0 - 180.0)
        na_frente = pular_frente is not None and delta <= pular_frente
        for i in range(n - 1):
            if na_frente and i < limite:
                continue
            a, b = s * n + i, s * n + i + 1
            c, d = proximo * n + i + 1, proximo * n + i
            faces.append(((a, b, c, d), indice_material))
    return verts, faces


def juntar(*blocos):
    """Concatena `(verts, faces)` reindexando — evita um objeto por peça."""
    verts, faces = [], []
    for bloco_verts, bloco_faces in blocos:
        base = len(verts)
        verts.extend(bloco_verts)
        faces.extend(((tuple(i + base for i in face), mat) for face, mat in bloco_faces))
    return verts, faces


def mover(bloco, deslocamento):
    dx, dy, dz = deslocamento
    verts, faces = bloco
    return ([(x + dx, y + dy, z + dz) for x, y, z in verts], faces)


def girar_z(bloco, radianos):
    cos_a, sin_a = math.cos(radianos), math.sin(radianos)
    verts, faces = bloco
    return ([(x * cos_a - y * sin_a, x * sin_a + y * cos_a, z) for x, y, z in verts], faces)


def girar_x(bloco, radianos, pivo_z=0.0):
    cos_a, sin_a = math.cos(radianos), math.sin(radianos)
    verts, faces = bloco
    return ([(x,
              y * cos_a - (z - pivo_z) * sin_a,
              y * sin_a + (z - pivo_z) * cos_a + pivo_z) for x, y, z in verts], faces)


def caixa(largura, profundidade, altura, centro=(0, 0, 0), indice_material=0):
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


def tubo(inicio, fim, raio_inicio, raio_fim, segmentos=8, indice_material=0,
         tampar=True):
    """Cilindro entre dois pontos, com raio variável. Tampa opcional na ponta."""
    inicio, fim = Vector(inicio), Vector(fim)
    eixo = fim - inicio
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
    if tampar:
        topo = [s * 2 + 1 for s in range(segmentos)]
        base = [s * 2 for s in range(segmentos)]
        faces.append((tuple(reversed(topo)), indice_material))
        faces.append((tuple(base), indice_material))
    return verts, faces


def quad(largura, altura, centro=(0, 0, 0), indice_material=0):
    """
    Um polígono vertical virado para -Y.

    Existe porque uma caixa entrega seis faces ao desdobramento automático, que
    as espalha em ilhas arbitrárias — inútil quando a textura precisa cair
    exatamente na frente (rosto, placa, carta).
    """
    cx, cy, cz = centro
    hx, hz = largura / 2, altura / 2
    verts = [(cx - hx, cy, cz - hz), (cx + hx, cy, cz - hz),
             (cx + hx, cy, cz + hz), (cx - hx, cy, cz + hz)]
    return verts, [((0, 1, 2, 3), indice_material)]


UV_CHEIO = [(0.0, 0.0), (1.0, 0.0), (1.0, 1.0), (0.0, 1.0)]


def desdobrar_uv(peca, materiais_uv_cheio=()):
    """
    Desdobra a peça. Materiais listados em `materiais_uv_cheio` recebem o UV
    inteiro na mão: textura que precisa ocupar exatamente o quadro não pode
    depender do desdobramento automático.
    """
    bpy.context.view_layer.objects.active = peca
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.02)
    bpy.ops.object.mode_set(mode='OBJECT')

    if not materiais_uv_cheio:
        return
    alvos = {i for i, m in enumerate(peca.data.materials)
             if m and m.name in materiais_uv_cheio}
    if not alvos:
        return
    camada = peca.data.uv_layers.active
    for poligono in peca.data.polygons:
        if poligono.material_index not in alvos:
            continue
        for ordem, indice_loop in enumerate(poligono.loop_indices):
            camada.data[indice_loop].uv = UV_CHEIO[ordem % 4]


def sombrear_plano(peca):
    """Flat shading: PS1 não tinha normal suave e o dithering come o degradê."""
    for poligono in peca.data.polygons:
        poligono.use_smooth = False


def exportar_glb(caminho, so_selecionados=False, animacoes=False):
    bpy.ops.object.select_all(action='SELECT')
    argumentos = dict(
        filepath=caminho,
        export_format='GLB',
        export_apply=True,
        export_yup=True,
        export_materials='EXPORT',
        export_cameras=False,
        export_lights=False,
        use_selection=so_selecionados,
    )
    if animacoes:
        argumentos.update(
            export_animations=True,
            export_skins=True,
            # Uma Action por intenção precisa virar animação NOMEADA; sem isto o
            # exportador junta tudo numa timeline só e o manifesto não acha clip.
            export_animation_mode='ACTIONS',
            export_nla_strips=False,
        )
    else:
        argumentos.update(export_animations=False, export_skins=False)
    bpy.ops.export_scene.gltf(**argumentos)


def montar_estudio(largura=640, altura=800, fundo=(0.05, 0.05, 0.06, 1)):
    """
    Cena de preview: motor, luz e câmera. Devolve a câmera para o chamador
    reposicionar por vista.

    Workbench é evitado de propósito — ele ignora material e devolve tudo cinza,
    inútil para julgar vazio de capuz, emissivo ou cor de paleta.
    """
    cena = bpy.context.scene
    motores = [item.identifier for item in
               bpy.types.RenderSettings.bl_rna.properties['engine'].enum_items]
    for candidato in ('BLENDER_EEVEE_NEXT', 'BLENDER_EEVEE', 'CYCLES'):
        if candidato in motores:
            cena.render.engine = candidato
            break
    cena.render.resolution_x, cena.render.resolution_y = largura, altura
    cena.render.film_transparent = False
    cena.world = bpy.data.worlds.new('Mundo')
    cena.world.use_nodes = True
    cena.world.node_tree.nodes['Background'].inputs['Color'].default_value = fundo

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
    return camera


def renderizar(camera, posicao, rotacao, caminho):
    camera.location = posicao
    camera.rotation_euler = rotacao
    bpy.context.scene.render.filepath = caminho
    bpy.ops.render.render(write_still=True)


def contar_triangulos(pecas):
    return sum(sum(len(f.vertices) - 2 for f in p.data.polygons) for p in pecas)
