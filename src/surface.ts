export interface SurfaceRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SurfaceViewport {
  width: number;
  height: number;
}

export type SurfacePlatform = 'web' | 'react-native' | 'capacitor';

export type SurfaceCapability =
  | 'geometry'
  | 'computed-styles'
  | 'paint-order'
  | 'tree'
  | 'text-ranges'
  | 'aria'
  | 'screenshot'
  | 'pixels';

export interface SurfaceNode {
  index: number;
  parentIndex: number;
  rect: SurfaceRect;
  isVisible: boolean;
}

export interface SurfaceSnapshot<TNode extends SurfaceNode = SurfaceNode> {
  platform: SurfacePlatform;
  viewport: SurfaceViewport;
  capabilities: readonly SurfaceCapability[];
  nodes: TNode[];
}
