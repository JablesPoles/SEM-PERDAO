import * as THREE from 'three';

export interface ProjectedPoint {
  x: number;
  y: number;
  z: number;
}

export interface FramingReport {
  fits: boolean;
  behindCamera: boolean;
  padding: number;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  overflowX: number;
  overflowY: number;
}

export function summarizeProjectedFrame(
  points: readonly ProjectedPoint[],
  padding = 0.04
): FramingReport | null {
  const valid = points.filter((point) =>
    Number.isFinite(point.x) && Number.isFinite(point.y) && Number.isFinite(point.z)
  );
  if (!valid.length) return null;
  const safePadding = Math.min(0.45, Math.max(0, padding));
  const limit = 1 - safePadding;
  const minX = Math.min(...valid.map((point) => point.x));
  const maxX = Math.max(...valid.map((point) => point.x));
  const minY = Math.min(...valid.map((point) => point.y));
  const maxY = Math.max(...valid.map((point) => point.y));
  const behindCamera = valid.some((point) => point.z < -1 || point.z > 1);
  const overflowX = Math.max(0, -limit - minX, maxX - limit);
  const overflowY = Math.max(0, -limit - minY, maxY - limit);
  return Object.freeze({
    fits: !behindCamera && overflowX === 0 && overflowY === 0,
    behindCamera,
    padding: safePadding,
    minX,
    maxX,
    minY,
    maxY,
    overflowX,
    overflowY,
  });
}

function appendProjectedBoxCorners(
  points: ProjectedPoint[],
  box: THREE.Box3,
  worldMatrix: THREE.Matrix4,
  camera: THREE.Camera
): void {
  const projected = new THREE.Vector3();
  const { min, max } = box;
  for (const x of [min.x, max.x]) {
    for (const y of [min.y, max.y]) {
      for (const z of [min.z, max.z]) {
        projected.set(x, y, z).applyMatrix4(worldMatrix).project(camera);
        points.push({ x: projected.x, y: projected.y, z: projected.z });
      }
    }
  }
}

/**
 * Resume o enquadramento a partir das caixas locais de cada mesh visível.
 *
 * Manter as caixas separadas é importante em perspectiva: unir tudo em uma
 * AABB mundial cria combinações de X/Y/Z que não existem no objeto e pode
 * acusar overflow quando todas as partes reais ainda cabem na câmera.
 * Não depende de renderer ou contexto WebGL, portanto pode ser exercitado em
 * testes unitários com apenas as primitivas matemáticas do Three.js.
 */
export function summarizeVisibleMeshFrame(
  object: THREE.Object3D,
  camera: THREE.PerspectiveCamera,
  padding = 0.04
): FramingReport | null {
  object.updateWorldMatrix(true, true);
  camera.updateMatrixWorld(true);
  camera.updateProjectionMatrix();

  const points: ProjectedPoint[] = [];
  const instanceMatrix = new THREE.Matrix4();
  const instanceWorldMatrix = new THREE.Matrix4();

  object.traverseVisible((node) => {
    if (!(node instanceof THREE.Mesh)) return;

    if (node instanceof THREE.InstancedMesh) {
      if (!node.geometry.boundingBox) node.geometry.computeBoundingBox();
      const box = node.geometry.boundingBox;
      if (!box || box.isEmpty()) return;
      for (let index = 0; index < node.count; index += 1) {
        node.getMatrixAt(index, instanceMatrix);
        instanceWorldMatrix.multiplyMatrices(node.matrixWorld, instanceMatrix);
        appendProjectedBoxCorners(points, box, instanceWorldMatrix, camera);
      }
      return;
    }

    let box: THREE.Box3 | null = null;
    if (node instanceof THREE.SkinnedMesh) {
      node.computeBoundingBox();
      box = node.boundingBox;
    } else {
      if (!node.geometry.boundingBox) node.geometry.computeBoundingBox();
      box = node.geometry.boundingBox;
    }
    if (!box || box.isEmpty()) return;
    appendProjectedBoxCorners(points, box, node.matrixWorld, camera);
  });

  return summarizeProjectedFrame(points, padding);
}
