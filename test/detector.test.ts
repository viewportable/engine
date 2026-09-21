import { describe, expect, it } from 'vitest';
import { collectRequiredCapabilities, runDetector, type Detector } from '../src/detector.js';
import type { SurfaceNode, SurfaceSnapshot } from '../src/surface.js';

const node: SurfaceNode = {
  index: 1,
  parentIndex: -1,
  rect: { x: 0, y: 0, width: 100, height: 40 },
  isVisible: true,
};

const geometrySurface: SurfaceSnapshot = {
  platform: 'web',
  viewport: { width: 390, height: 900 },
  capabilities: ['geometry'],
  nodes: [node],
};

describe('detector contract', () => {
  it('collects required capabilities once in declaration order', () => {
    expect(
      collectRequiredCapabilities([
        { requires: ['geometry', 'tree'] },
        { requires: ['geometry', 'paint-order'] },
      ]),
    ).toEqual(['geometry', 'tree', 'paint-order']);
  });

  it('runs a detector when its capabilities are available', async () => {
    const detector: Detector<number> = {
      id: 'node-count',
      requires: ['geometry'],
      detect: ({ surface }) => [surface.nodes.length],
    };

    await expect(runDetector(detector, geometrySurface)).resolves.toEqual([1]);
  });

  it('fails before detector execution when a capability is unavailable', async () => {
    const detector: Detector<number> = {
      id: 'pixel-check',
      requires: ['pixels'],
      detect: () => [1],
    };

    await expect(runDetector(detector, geometrySurface)).rejects.toThrow(
      'Detector "pixel-check" requires unavailable capabilities: pixels',
    );
  });
});
