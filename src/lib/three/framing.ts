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
