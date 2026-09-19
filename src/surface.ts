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

export interface SurfaceTextBox {
  ownerIdentity: string;
  rect: SurfaceRect;
  start: number;
  length: number;
}

export interface SurfaceEvidence {
  textBoxes?: SurfaceTextBox[];
}

export interface SurfaceNode {
  index: number;
  parentIndex: number;
  identity?: string;
  rect: SurfaceRect;
  isVisible: boolean;
}

export interface SurfaceSnapshot<TNode extends SurfaceNode = SurfaceNode> {
  platform: SurfacePlatform;
  viewport: SurfaceViewport;
  capabilities: readonly SurfaceCapability[];
  nodes: TNode[];
  evidence?: SurfaceEvidence;
}
