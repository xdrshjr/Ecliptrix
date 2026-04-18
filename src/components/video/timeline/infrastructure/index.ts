/**
 * Infrastructure Layer — Public API
 *
 * Re-exports all infrastructure adapters and error types.
 */

// Adapters
export { TimelineRepository, getSerializedTrackKind } from './TimelineRepository';
export type { TimelineExportData, SerializedTrackKind } from './TimelineRepository';

export { VideoCacheAdapter } from './VideoCacheAdapter';
export type { VideoCacheConfig } from './VideoCacheAdapter';

export { CompositionAdapter } from './CompositionAdapter';
export type { CompositionMaterialData } from './CompositionAdapter';

// Errors
export {
  TimelineExportError,
  TimelineImportError,
  VideoCacheError,
} from './errors';
