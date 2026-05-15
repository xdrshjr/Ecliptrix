/**
 * Infrastructure Layer — Public API
 *
 * Re-exports all infrastructure adapters and error types.
 */

// Adapters
export { TimelineRepository, getSerializedTrackKind } from './TimelineRepository';
export type { TimelineExportData, SerializedTrackKind } from './TimelineRepository';

export { VideoCacheAdapter, MEDIA_PROXY_ORIGIN_PREFIX, isSameOriginVideoUrl } from './VideoCacheAdapter';
export type { VideoCacheConfig } from './VideoCacheAdapter';

export { MediaProxyClient } from './MediaProxyClient';
export type {
  MediaProxyClientOptions,
  PreviewProxyTask,
  PreviewProxyStatus,
} from './MediaProxyClient';

export { CompositionAdapter } from './CompositionAdapter';
export type { CompositionMaterialData } from './CompositionAdapter';

export { RemoteMaterialPrefetchAdapter } from './RemoteMaterialPrefetchAdapter';
export type { RemoteMaterialPrefetchConfig } from './RemoteMaterialPrefetchAdapter';

// Errors
export {
  TimelineExportError,
  TimelineImportError,
  VideoCacheError,
} from './errors';
