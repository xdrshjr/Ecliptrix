/** Durable effect documents contain asset identities, never transient URLs. */
export interface EffectInputBinding {
  slot: string;
  assetId: string;
  kind: 'image' | 'video';
  fit: 'cover' | 'contain';
  focalX: number;
  focalY: number;
  index?: number;
  trimStartSeconds?: number;
}

export interface EffectDocument {
  schemaVersion: 1;
  templateId: string;
  templateVersion: number;
  canvas: { width: number; height: number; fps: 30 };
  durationFrames: number;
  seed: number;
  content: { title: string; subtitle: string };
  palette: {
    background: string;
    foreground: string;
    accent: string;
  };
  typography: {
    family: 'sans' | 'serif' | 'mono';
    scale: number;
    align: 'left' | 'center' | 'right';
  };
  motion: { speed: number; intensity: number };
  params: Record<string, string | number | number[]>;
  inputs: EffectInputBinding[];
}

export interface EffectCompositionProps extends Record<string, unknown> {
  document: EffectDocument;
  assets: Record<string, string>;
  fontUrls: Record<'sans' | 'serif' | 'mono', string>;
}

export interface EffectRenderability {
  ready: boolean;
  errors: { path: string; code: string; messageKey: string }[];
}

export interface EffectDraft {
  id: string;
  projectId: string;
  name: string;
  version: number;
  document: EffectDocument;
  documentHash: string;
  renderability: EffectRenderability;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
  readOnly: boolean;
}

export interface EffectOutputProvenance {
  jobId: string;
  draftId: string;
  draftVersion: number;
  documentHash: string;
  inputHash: string;
  durationFrames: number;
  fps: 30;
  canvas: { width: number; height: number };
  baseVideo?: {
    assetId: string;
    sourceSha256: string;
    trimStartFrame: number;
    sourceFrameCount: number;
    displayWidth: number;
    displayHeight: number;
  };
}

export interface EffectMaterialMetadata {
  schemaVersion: 1;
  projectId: string;
  draftId: string;
  draftVersion: number;
  jobId: string;
  assetId: string;
  templateId: string;
  templateVersion: number;
  documentHash: string;
}

export interface EffectAsset {
  id: string;
  projectId: string;
  kind: 'input-image' | 'input-video' | 'output-video';
  sha256: string;
  url: string;
  storageKey: string;
  thumbnailUrl?: string;
  bytes: number;
  width: number;
  height: number;
  durationSeconds?: number;
  createdAt: string;
  provenance?: EffectOutputProvenance;
  effects?: EffectMaterialMetadata;
}

export type EffectJobStatus = 'queued' | 'running' | 'cancelling'
  | 'succeeded' | 'failed' | 'cancelled' | 'interrupted';

export interface EffectRenderJob {
  id: string;
  projectId: string;
  draftId: string;
  draftVersion: number;
  requestId: string;
  status: EffectJobStatus;
  phase: string;
  progress: number;
  retryAfterMs: number;
  createdAt: string;
  updatedAt: string;
  errorCode?: string;
  errorMessage?: string;
  outputAsset?: EffectAsset;
}

export interface EffectTargetSnapshot {
  projectId: string;
  trackId: string;
  clipId: string;
  sourceMaterialId?: string;
  targetFingerprint: string;
  durationSeconds: number;
  sourceSha256?: string;
  trimStartFrame?: number;
  durationFrames?: number;
}

export interface EffectApplyIntent {
  projectId: string;
  operationId: string;
  mode: 'replace' | 'insert';
  target?: EffectTargetSnapshot;
  startTime?: number;
}

export interface EffectTargets {
  drafts: Map<string, EffectTargetSnapshot>;
  outputs: Map<string, EffectTargetSnapshot>;
}

export interface EffectParameterSchema {
  type: 'number' | 'integer' | 'string' | 'array';
  minimum?: number;
  maximum?: number;
  maxLength?: number;
  enum?: string[];
  minItems?: number;
  maxItems?: number;
  items?: { type: 'number'; minimum: number; maximum: number };
}

export interface EffectTemplate {
  id: string;
  libraryId: string;
  version: number;
  componentId: string;
  variant: string;
  nameKey: string;
  descriptionKey: string;
  allowedInputKinds: ('image' | 'video')[];
  slots: { id: string; kinds: ('image' | 'video')[];
    min: number; max: number; required: boolean }[];
  requiredContent: ('title' | 'subtitle')[];
  defaults: EffectDocument['params'];
  parameterSchema: Record<string, EffectParameterSchema>;
  thumbnail: string;
  demoPreview: string;
  minFrames: number;
  maxFrames: number;
}

export interface EffectLibrary {
  id: string;
  nameKey: string;
  templateCount: number;
  thumbnail: string;
}

export interface EffectCapabilities {
  ready: boolean;
  protocolVersion: number;
  engineVersion: string;
  catalogHash: string;
  unavailableReason?: string;
  limits: Record<string, number>;
}

export interface EffectPage<T> {
  items: T[];
  nextCursor?: string;
}

/** Stable domain codes are shared by UI, Agent and timeline transactions. */
export class EffectError extends Error {
  constructor(readonly code: string, message = code) {
    super(message);
    this.name = 'EffectError';
  }
}
