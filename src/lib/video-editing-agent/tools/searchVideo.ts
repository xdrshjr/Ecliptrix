import { Type, type Static } from '@mariozechner/pi-ai';
import type { AgentTool } from '@mariozechner/pi-agent-core';
import type { ToolContext } from '../types';
import type { MaterialItem } from '@/types';
import { apiUrl } from './apiHelper';

const SEARCH_TIMEOUT_MS = 15_000;

const parameters = Type.Object({
  query: Type.String({ description: 'Search keywords (English or Chinese — Chinese auto-translated)' }),
  count: Type.Optional(Type.Number({ description: 'Number of results to return (1-15, default 5)' })),
  orientation: Type.Optional(
    Type.Union([
      Type.Literal('landscape'),
      Type.Literal('portrait'),
      Type.Literal('square'),
    ], { description: 'Video orientation filter' })
  ),
  min_duration: Type.Optional(Type.Number({ description: 'Minimum duration in seconds' })),
  max_duration: Type.Optional(Type.Number({ description: 'Maximum duration in seconds' })),
});
type Params = Static<typeof parameters>;

/**
 * Detect whether a string contains Chinese characters.
 */
function containsChinese(text: string): boolean {
  return /[\u4e00-\u9fff\u3400-\u4dbf]/.test(text);
}

/**
 * Translate a Chinese query to English via the translate-search-query API.
 * Falls back to the original query on failure.
 */
async function translateQuery(context: ToolContext, query: string): Promise<string> {
  try {
    const res = await fetch(apiUrl(context, '/api/translate-search-query'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, taskId: `search-video-${Date.now()}` }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return query;
    const data = await res.json();
    return data.translatedQuery || query;
  } catch {
    return query;
  }
}

/** Backend-normalized video search result (from /api/video-search → backend VideoInfo) */
interface VideoSearchResult {
  id: number;
  title: string;
  author: string;
  width: number;
  height: number;
  duration?: number;
  thumbnail?: string;
  video_url?: string;
}

function mapVideoToMaterial(video: VideoSearchResult, query: string): MaterialItem | null {
  if (!video.video_url) return null;

  return {
    id: `pexels-${video.id}`,
    name: video.title || `${query} - Pexels ${video.id}`,
    type: 'video',
    format: 'mp4',
    size: 0,
    duration: video.duration || 0,
    width: video.width,
    height: video.height,
    thumbnailUrl: video.thumbnail || '',
    url: video.video_url,
    createdAt: new Date(),
    tags: [query, 'pexels', '在线素材'],
    description: video.author ? `来自PEXELS的视频素材，作者：${video.author}` : undefined,
    metadata: {
      source: 'pexels',
      sourceId: String(video.id),
    },
  };
}

export function createSearchVideoTool(context: ToolContext): AgentTool<typeof parameters> {
  return {
    name: 'search_video',
    label: 'Search Video',
    description:
      'Search the Pexels video library. Returns matching videos and automatically adds them to the material library. Use list_materials or search_materials afterwards to see them, or add_to_track to place them on the timeline.',
    parameters,

    execute: async (toolCallId, params: Params) => {
      const count = Math.min(Math.max(params.count ?? 5, 1), 15);

      // Auto-translate Chinese keywords
      let searchQuery = params.query.trim();
      if (containsChinese(searchQuery)) {
        searchQuery = await translateQuery(context, searchQuery);
      }

      try {
        // Build request body matching the existing /api/video-search POST contract
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const body: Record<string, any> = {
          query: searchQuery,
          max_videos: count,
        };
        if (params.orientation && params.orientation !== 'square') {
          body.orientation = params.orientation;
        } else if (params.orientation === 'square') {
          // Pexels API doesn't support 'square' directly; omit to get mixed
          body.orientation = 'mixed';
        }

        const res = await fetch(apiUrl(context, '/api/video-search'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
        });

        if (!res.ok) {
          const text = await res.text().catch(() => '');
          const result = { success: false, message: `Video search failed (HTTP ${res.status}): ${text}` };
          return { content: [{ type: 'text', text: JSON.stringify(result) }], details: result };
        }

        const data = await res.json();

        if (!data.success) {
          const result = { success: false, message: data.message || 'Video search returned an error' };
          return { content: [{ type: 'text', text: JSON.stringify(result) }], details: result };
        }

        const videos: VideoSearchResult[] = data.videos || [];

        // Apply duration filters client-side
        let filtered = videos;
        if (params.min_duration != null) {
          filtered = filtered.filter(v => (v.duration ?? 0) >= params.min_duration!);
        }
        if (params.max_duration != null) {
          filtered = filtered.filter(v => (v.duration ?? 0) <= params.max_duration!);
        }

        if (filtered.length === 0) {
          const result = {
            success: true,
            materials: [],
            total_found: 0,
            message: `No videos found for '${searchQuery}'`,
            searchQuery,
          };
          return { content: [{ type: 'text', text: JSON.stringify(result) }], details: result };
        }

        // Map to MaterialItem and record operation for client + push to context
        const materials = filtered.map(v => mapVideoToMaterial(v, searchQuery)).filter((m): m is MaterialItem => m !== null);
        context.recordOperation(toolCallId, { type: 'add_materials', materials });
        // Also push to live context so subsequent tools in the same turn can see them
        for (const m of materials) {
          if (!context.materials.some(existing => existing.id === m.id)) {
            context.materials.push(m);
          }
        }

        const result = {
          success: true,
          materials: materials.map(m => ({ id: m.id, name: m.name, type: m.type, duration: m.duration, width: m.width, height: m.height })),
          total_found: materials.length,
          message: `Found ${materials.length} video(s) for '${searchQuery}'`,
          searchQuery,
        };
        return { content: [{ type: 'text', text: JSON.stringify(result) }], details: result };

      } catch (err) {
        const message = err instanceof DOMException && err.name === 'TimeoutError'
          ? 'Video search timed out'
          : `Video search error: ${String(err)}`;
        const result = { success: false, message };
        return { content: [{ type: 'text', text: JSON.stringify(result) }], details: result };
      }
    },
  };
}
