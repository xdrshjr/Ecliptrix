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
      Type.Literal('squarish'),
    ], { description: 'Image orientation filter' })
  ),
  color: Type.Optional(Type.String({ description: 'Dominant color filter (e.g. "blue", "red", "green", "black_and_white")' })),
});
type Params = Static<typeof parameters>;

function containsChinese(text: string): boolean {
  return /[\u4e00-\u9fff\u3400-\u4dbf]/.test(text);
}

async function translateQuery(context: ToolContext, query: string): Promise<string> {
  try {
    const res = await fetch(apiUrl(context, '/api/translate-search-query'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, taskId: `search-image-${Date.now()}` }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return query;
    const data = await res.json();
    return data.translatedQuery || query;
  } catch {
    return query;
  }
}

/** Backend-normalized image search result (from /api/image-search → backend ImageInfo) */
interface ImageSearchResult {
  id: string;
  width: number;
  height: number;
  description?: string;
  alt_description?: string;
  regular_url?: string;
  full_url?: string;
  raw_url?: string;
  small_url?: string;
  thumb_url?: string;
  user_name?: string;
}

function mapImageToMaterial(image: ImageSearchResult, query: string): MaterialItem {
  const url = image.regular_url || image.full_url || image.raw_url || '';
  const thumbnailUrl = image.small_url || image.thumb_url || url;

  return {
    id: `unsplash-${image.id}`,
    name: image.alt_description || image.description || `${query} - Unsplash ${image.id}`,
    type: 'image',
    format: 'jpg',
    size: 0,
    width: image.width,
    height: image.height,
    thumbnailUrl,
    url,
    createdAt: new Date(),
    tags: [query, 'unsplash', '在线素材'],
    description: image.user_name ? `来自Unsplash的图片素材，作者：${image.user_name}` : undefined,
    metadata: {
      source: 'unsplash',
      sourceId: image.id,
    },
  };
}

export function createSearchImageTool(context: ToolContext): AgentTool<typeof parameters> {
  return {
    name: 'search_image',
    label: 'Search Image',
    description:
      'Search the Unsplash image library. Returns matching images and automatically adds them to the material library. Use add_to_track to place them on the timeline.',
    parameters,

    execute: async (toolCallId, params: Params) => {
      const count = Math.min(Math.max(params.count ?? 5, 1), 15);

      let searchQuery = params.query.trim();
      if (containsChinese(searchQuery)) {
        searchQuery = await translateQuery(context, searchQuery);
      }

      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const body: Record<string, any> = {
          query: searchQuery,
          max_images: count,
        };
        if (params.orientation) {
          body.orientation = params.orientation;
        }
        if (params.color) {
          body.color = params.color;
        }

        const res = await fetch(apiUrl(context, '/api/image-search'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
        });

        if (!res.ok) {
          const text = await res.text().catch(() => '');
          const result = { success: false, message: `Image search failed (HTTP ${res.status}): ${text}` };
          return { content: [{ type: 'text', text: JSON.stringify(result) }], details: result };
        }

        const data = await res.json();

        if (!data.success) {
          const result = { success: false, message: data.message || 'Image search returned an error' };
          return { content: [{ type: 'text', text: JSON.stringify(result) }], details: result };
        }

        const images: ImageSearchResult[] = data.images || [];

        if (images.length === 0) {
          const result = {
            success: true,
            materials: [],
            total_found: 0,
            message: `No images found for '${searchQuery}'`,
            searchQuery,
          };
          return { content: [{ type: 'text', text: JSON.stringify(result) }], details: result };
        }

        const materials = images.map(img => mapImageToMaterial(img, searchQuery));
        context.recordOperation(toolCallId, { type: 'add_materials', materials });
        for (const m of materials) {
          if (!context.materials.some(existing => existing.id === m.id)) {
            context.materials.push(m);
          }
        }

        const result = {
          success: true,
          materials: materials.map(m => ({ id: m.id, name: m.name, type: m.type, width: m.width, height: m.height })),
          total_found: materials.length,
          message: `Found ${materials.length} image(s) for '${searchQuery}'`,
          searchQuery,
        };
        return { content: [{ type: 'text', text: JSON.stringify(result) }], details: result };

      } catch (err) {
        const message = err instanceof DOMException && err.name === 'TimeoutError'
          ? 'Image search timed out'
          : `Image search error: ${String(err)}`;
        const result = { success: false, message };
        return { content: [{ type: 'text', text: JSON.stringify(result) }], details: result };
      }
    },
  };
}
