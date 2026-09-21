import type { SurfaceCapability, SurfaceNode, SurfaceSnapshot } from './surface.js';

export interface DetectorContext<TNode extends SurfaceNode = SurfaceNode> {
  surface: SurfaceSnapshot<TNode>;
}

export interface Detector<TFinding, TNode extends SurfaceNode = SurfaceNode> {
  id: string;
  requires: readonly SurfaceCapability[];
  detect(context: DetectorContext<TNode>): TFinding[] | Promise<TFinding[]>;
}

export function collectRequiredCapabilities(
  detectors: ReadonlyArray<{ requires: readonly SurfaceCapability[] }>,
): SurfaceCapability[] {
  const capabilities = new Set<SurfaceCapability>();

  for (const detector of detectors) {
    for (const capability of detector.requires) {
      capabilities.add(capability);
    }
  }

  return [...capabilities];
}

export async function runDetector<TFinding, TNode extends SurfaceNode>(
  detector: Detector<TFinding, TNode>,
  surface: SurfaceSnapshot<TNode>,
): Promise<TFinding[]> {
  const available = new Set(surface.capabilities);
  const missing = detector.requires.filter((capability) => !available.has(capability));

  if (missing.length > 0) {
    throw new Error(
      `Detector "${detector.id}" requires unavailable capabilities: ${missing.join(', ')}`,
    );
  }

  return detector.detect({ surface });
}
