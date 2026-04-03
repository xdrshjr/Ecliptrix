import { Type, type Static } from '@mariozechner/pi-ai';
import type { AgentTool } from '@mariozechner/pi-agent-core';
import type { ToolContext } from '../types';
import type { MaterialItem } from '@/types';
import { toolFetch, parseToolResponse } from './apiHelper';

const parameters = Type.Object({
  query: Type.String({ description: 'Search keywords (English or Chinese — Chinese auto-translated)' }),
  count: Type.Optional(Type.Number({ description: 'Number of results to return (1-15, default 5)' })),
  min_duration: Type.Optional(Type.Number({ description: 'Minimum duration in seconds' })),
  max_duration: Type.Optional(Type.Number({ description: 'Maximum duration in seconds' })),
});
type Params = Static<typeof parameters>;

function containsChinese(text: string): boolean {
  return /[\u4e00-\u9fff\u3400-\u4dbf]/.test(text);
}

async function translateQuery(context: ToolContext, query: string): Promise<string> {
  try {
    const res = await toolFetch(context, '/api/translate-search-query', {
      method: 'POST',
      timeout: 10_000,
      body: JSON.stringify({ query, taskId: `search-audio-${Date.now()}` }),
    });
    if (!res.ok) return query;
    const data = await parseToolResponse<{ translatedQuery?: string }>(res);
    return ('translatedQuery' in data && data.translatedQuery) ? data.translatedQuery : query;
  } catch {
    return query;
  }
}

/** Backend-normalized audio search result (from /api/audio-search → backend AudioInfo) */
interface AudioSearchResult {
  id: number;
  name: string;
  duration: number;
  download_url?: string;
  preview_url?: string;
  waveform_url?: string;
  tags?: string[];
  username?: string;
  license?: string;
}

function mapAudioToMaterial(audio: AudioSearchResult, query: string): MaterialItem {
  const url = audio.preview_url || audio.download_url || '';
  const thumbnailUrl = audio.waveform_url || '';

  return {
    id: `freesound-${audio.id}`,
    name: audio.name || `${query} - Freesound ${audio.id}`,
    type: 'audio',
    format: 'mp3',
    size: 0,
    duration: audio.duration,
    thumbnailUrl,
    url,
    createdAt: new Date(),
    tags: [...(audio.tags || []).slice(0, 5), query, 'freesound', '在线素材'],
    description: audio.username ? `来自Freesound的音频素材，作者：${audio.username}` : undefined,
    metadata: {
      source: 'freesound',
      sourceId: String(audio.id),
    },
  };
}

export function createSearchAudioTool(context: ToolContext): AgentTool<typeof parameters> {
  return {
    name: 'search_audio',
    label: 'Search Audio',
    description:
      'Search the Freesound audio library. Returns matching audio clips and automatically adds them to the material library. Use add_to_track to place them on the timeline.',
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
          max_audios: count,
        };
        if (params.min_duration != null) {
          body.duration_min = params.min_duration;
        }
        if (params.max_duration != null) {
          body.duration_max = params.max_duration;
        }

        const res = await toolFetch(context, '/api/audio-search', {
          method: 'POST',
          timeout: 15_000,
          body: JSON.stringify(body),
        });

        if (!res.ok) {
          let detail = '';
          try { detail = await res.text(); } catch { /* ignore read errors */ }
          const result = { success: false, message: `Audio search failed (HTTP ${res.status})${detail ? `: ${detail.slice(0, 200)}` : ''}` };
          return { content: [{ type: 'text', text: JSON.stringify(result) }], details: result };
        }

        const data = await parseToolResponse<{
          success: boolean;
          message?: string;
          audios?: AudioSearchResult[];
        }>(res);

        if (!data.success) {
          const result = { success: false, message: ('message' in data && data.message) || 'Audio search returned an error' };
          return { content: [{ type: 'text', text: JSON.stringify(result) }], details: result };
        }

        const audios: AudioSearchResult[] = ('audios' in data && data.audios) ? data.audios : [];

        if (audios.length === 0) {
          const result = {
            success: true,
            materials: [],
            total_found: 0,
            message: `No audio found for '${searchQuery}'`,
            searchQuery,
          };
          return { content: [{ type: 'text', text: JSON.stringify(result) }], details: result };
        }

        const materials = audios.map(a => mapAudioToMaterial(a, searchQuery));
        context.recordOperation(toolCallId, { type: 'add_materials', materials });
        for (const m of materials) {
          if (!context.materials.some(existing => existing.id === m.id)) {
            context.materials.push(m);
          }
        }

        const result = {
          success: true,
          materials: materials.map(m => ({ id: m.id, name: m.name, type: m.type, duration: m.duration })),
          total_found: materials.length,
          message: `Found ${materials.length} audio clip(s) for '${searchQuery}'`,
          searchQuery,
        };
        return { content: [{ type: 'text', text: JSON.stringify(result) }], details: result };

      } catch (err) {
        const isTimeout = err instanceof DOMException && err.name === 'TimeoutError';
        const message = isTimeout
          ? 'Audio search timed out after 15s'
          : `Audio search failed: ${err instanceof Error ? err.message : String(err)}`;
        const result = { success: false, message };
        return { content: [{ type: 'text', text: JSON.stringify(result) }], details: result };
      }
    },
  };
}
