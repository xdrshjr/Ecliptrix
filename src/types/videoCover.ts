export type CoverMode = 'html' | 'ai' | 'mixed';
export type CoverTemplateId = 'editorial' | 'cinematic' | 'knowledge' | 'product' | 'bold';
export type CoverAspectRatio = '16:9' | '9:16' | '1:1' | '4:3' | '21:9';

export interface CoverDocument {
  schemaVersion: 2;
  mode: CoverMode;
  templateId: CoverTemplateId;
  templateVersion: 1;
  aspectRatio: CoverAspectRatio;
  fields: { title: string; subtitle: string; label: string };
  typography: {
    family: 'sans' | 'serif' | 'mono'; titleScale: number;
    align: 'left' | 'center' | 'right'; textColor: string;
    accentColor: string;
  };
  background: {
    kind: 'solid' | 'gradient' | 'asset'; color: string;
    assetId: string | null; focusX: number; focusY: number;
  };
  generation: { prompt: string; count: 1 | 2 | 4 };
  durationFrames: number;
}
export interface CoverAsset {
  assetId: string; url: string; width: number; height: number;
  sha256: string;
}
export interface CoverRevision {
  id: string; projectId: string; document: CoverDocument;
  documentHash: string; assetId: string; url: string; sha256: string;
  width: number; height: number; createdAt: string;
}
export interface CoverClipMetadata {
  role: 'video-cover';
  cover: {
    schemaVersion: 2; projectId: string; revisionId: string;
    assetId: string; sha256: string;
  };
}
export type CoverJobStatus = 'queued' | 'running' | 'succeeded' |
  'failed' | 'cancelled' | 'interrupted';
export interface CoverJob {
  jobId: string; status: CoverJobStatus; phase?: string;
  baseVersion: number; assets: CoverAsset[]; warnings?: string[];
  errorCode?: string; createdAt?: string;
}
export interface CoverSnapshot {
  document: CoverDocument | null; version: number;
  documentHash: string | null; appliedRevision: CoverRevision | null;
  legacyAvailable: boolean; jobs: CoverJob[]; revisions: CoverRevision[];
  assets?: CoverAsset[];
  generationConfigured?: boolean;
}
export interface CoverSavedDraft {
  version: number; document: CoverDocument; documentHash: string;
}
export type CoverErrorCode = 'COVER_VERSION_CONFLICT' |
  'COVER_TEXT_OVERFLOW' | 'COVER_FONT_UNAVAILABLE' |
  'COVER_BACKGROUND_UNREADABLE' |
  'COVER_REQUEST_CONFLICT' | 'COVER_DRAFT_NOT_READY' |
  'COVER_ASSET_MISSING' | 'COVER_INVALID_ASSET' | 'COVER_RENDER_FAILED' |
  'COVER_GENERATION_FAILED' | 'COVER_GENERATION_TIMEOUT' |
  'COVER_GENERATION_INTERRUPTED' | 'COVER_QUEUE_FULL' |
  'COVER_TIMELINE_CONFLICT' | 'COVER_PROJECT_CHANGED' |
  'COVER_ASPECT_MISMATCH' | 'COVER_EXPORT_FAILED' | 'COVER_V2_ACTIVE';
export class CoverError extends Error {
  constructor(public code: CoverErrorCode, message: string) {
    super(message); this.name = 'CoverError';
  }
}

// These shapes belong to the editor session, never the saved project schema.
export type CoverOperationSource = 'load' | 'save' | 'generate' | 'poll' |
  'upload' | 'copy' | 'render' | 'apply' | 'restore' | 'resources';
export type CoverRecoveryAction = 'retry-save' | 'use-local' | 'use-server' |
  'refresh-status' | 'regenerate' | 'choose-image' | 'retry-operation' |
  'refresh-resources' | 'retry-revision' | 'resume-submission' |
  'cancel-submission' | 'rebuild' | 'reload-initial' | 'dismiss';
export interface CoverIssue {
  id: string;
  kind: 'draft-conflict' | 'operation-stale' | 'other';
  code: string;
  operation: CoverOperationSource;
  projectId: string;
  revisionId?: string;
  retryAction?: 'apply' | 'download' | 'rebuild';
  actions: CoverRecoveryAction[];
}
export interface BackgroundIntentToken {
  session: object;
  sequence: number;
}
export interface CoverRestoreUndo {
  document: CoverDocument;
  resultEdit: number;
  backgroundSequence: number;
  session: object;
}
export interface CoverPendingSubmission {
  session: object;
  requestId: string;
  draft: CoverSavedDraft;
  referenceAssetIds: string[];
  edit: number;
  backgroundSequence: number;
  state: 'submitting' | 'unknown';
}
export type CoverRevisionAvailability = 'unknown' | 'checking' | 'readable' |
  'unavailable';
export interface CoverRevisionEntry {
  id: string;
  revision?: CoverRevision;
  metadataStatus: CoverRevisionAvailability;
  pngStatus: CoverRevisionAvailability;
  backgroundStatus: CoverRevisionAvailability;
}
export type CoverResourceTab = 'images' | 'revisions';
export type CoverActivity = 'idle' | 'preparing' | 'applying' |
  'downloading' | 'restoring';
export interface CoverJobConnection {
  status: 'idle' | 'connected' | 'retrying';
  failedJobIds: string[];
  unavailableJobIds: string[];
}

export type CoverTextField = 'title' | 'subtitle' | 'label';
export type CoverReadinessCode = 'content-empty' | 'background-required' |
  'background-missing' | 'background-unreadable' |
  'font-unavailable' | 'text-overflow';
export interface CoverReadinessIssue {
  code: CoverReadinessCode;
  field?: CoverTextField;
}
export interface CoverTextMeasurement {
  measurable: boolean;
  overflowFields: CoverTextField[];
}
export interface CoverReadinessResult {
  status: 'checking' | 'blocked' | 'ready';
  issues: CoverReadinessIssue[];
  document: CoverDocument | null;
  backgroundUrl?: string;
  readinessKey?: string;
  enabled: boolean;
  canvasNode: HTMLElement | null;
  imageLoadKey: number;
  sequence: number;
}
