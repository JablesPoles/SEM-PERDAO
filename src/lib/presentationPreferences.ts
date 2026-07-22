export type TableViewMode = '3d' | '2d';
export type QualityPreference = 'auto' | 'high' | 'medium' | 'low';
export type EffectiveQuality = Exclude<QualityPreference, 'auto'>;

export const TABLE_VIEW_KEY = 'sp-table-view-v1';
export const TABLE_QUALITY_KEY = 'sp-table-quality-v1';

export interface DeviceProfile {
  width: number;
  height: number;
  devicePixelRatio: number;
  hardwareConcurrency: number | null;
  deviceMemoryGb: number | null;
}

export interface PresentationProfile {
  quality: EffectiveQuality;
  pixelSize: number;
  shadows: boolean;
}

export function normalizeTableView(value: unknown): TableViewMode {
  return value === '2d' ? '2d' : '3d';
}

export function normalizeQualityPreference(value: unknown): QualityPreference {
  return value === 'high' || value === 'medium' || value === 'low' ? value : 'auto';
}

export function detectDeviceProfile(scope: Window = window): DeviceProfile {
  const navigatorWithMemory = scope.navigator as Navigator & { deviceMemory?: number };
  return {
    width: Math.max(1, scope.innerWidth),
    height: Math.max(1, scope.innerHeight),
    devicePixelRatio: Math.max(1, scope.devicePixelRatio || 1),
    hardwareConcurrency: scope.navigator.hardwareConcurrency ?? null,
    deviceMemoryGb: navigatorWithMemory.deviceMemory ?? null,
  };
}

export function resolveEffectiveQuality(
  preference: QualityPreference,
  device: DeviceProfile
): EffectiveQuality {
  if (preference !== 'auto') return preference;
  const shortestSide = Math.min(device.width, device.height);
  const weakCpu = device.hardwareConcurrency !== null && device.hardwareConcurrency <= 4;
  const lowMemory = device.deviceMemoryGb !== null && device.deviceMemoryGb <= 4;
  if ((weakCpu && lowMemory) || (shortestSide < 430 && (weakCpu || lowMemory))) return 'low';
  const strongCpu = device.hardwareConcurrency === null || device.hardwareConcurrency >= 8;
  const enoughMemory = device.deviceMemoryGb === null || device.deviceMemoryGb >= 8;
  if (strongCpu && enoughMemory && shortestSide >= 700 && device.devicePixelRatio <= 2) return 'high';
  return 'medium';
}

export function presentationProfile(quality: EffectiveQuality): PresentationProfile {
  if (quality === 'high') return { quality, pixelSize: 1, shadows: true };
  if (quality === 'medium') return { quality, pixelSize: 2, shadows: true };
  return { quality, pixelSize: 3, shadows: false };
}

export function nextQualityPreference(current: QualityPreference): QualityPreference {
  if (current === 'auto') return 'high';
  if (current === 'high') return 'medium';
  if (current === 'medium') return 'low';
  return 'auto';
}

export function downgradedQuality(
  current: EffectiveQuality,
  result: { p95FrameMs: number; slowFrameRatio: number }
): EffectiveQuality {
  const struggling = result.p95FrameMs > 28 || result.slowFrameRatio > 0.2;
  if (!struggling) return current;
  if (current === 'high') return 'medium';
  return 'low';
}
