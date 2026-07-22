import * as THREE from 'three';
import type { ActorRenderMetrics } from '@/lib/mesa/actorContract';

function triangleCount(geometry: THREE.BufferGeometry): number {
  if (geometry.index) return Math.floor(geometry.index.count / 3);
  const positions = geometry.getAttribute('position');
  return positions ? Math.floor(positions.count / 3) : 0;
}

function imageEdge(texture: THREE.Texture): number {
  const image = texture.image as { width?: unknown; height?: unknown } | null | undefined;
  const width = typeof image?.width === 'number' ? image.width : 0;
  const height = typeof image?.height === 'number' ? image.height : 0;
  return Math.max(width, height);
}

/** Estimativa estável antes do render; draw calls reais continuam nas métricas do palco. */
export function collectActorRenderMetrics(root: THREE.Object3D): ActorRenderMetrics {
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  const bones = new Set<THREE.Bone>();
  let meshes = 0;
  let skinnedMeshes = 0;
  let triangles = 0;
  let drawCalls = 0;
  let maxTextureEdge = 0;

  root.traverse((object) => {
    if (object instanceof THREE.Bone) bones.add(object);
    if (!(object instanceof THREE.Mesh)) return;
    meshes += 1;
    triangles += triangleCount(object.geometry);
    drawCalls += Array.isArray(object.material)
      ? Math.max(1, object.geometry.groups.length)
      : 1;
    if (object instanceof THREE.SkinnedMesh) {
      skinnedMeshes += 1;
      object.skeleton.bones.forEach((bone) => bones.add(bone));
    }
    const values = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of values) {
      materials.add(material);
      for (const value of Object.values(material)) {
        if (!(value instanceof THREE.Texture)) continue;
        textures.add(value);
        maxTextureEdge = Math.max(maxTextureEdge, imageEdge(value));
      }
    }
  });

  return {
    meshes,
    skinnedMeshes,
    materials: materials.size,
    textures: textures.size,
    triangles,
    drawCalls,
    bones: bones.size,
    maxTextureEdge,
  };
}
