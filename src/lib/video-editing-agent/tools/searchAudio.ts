import { Type, type Static } from '@mariozechner/pi-ai';
import type { AgentTool } from '@mariozechner/pi-agent-core';
import type { ToolContext } from '../types';
import type { MaterialItem } from '@/types';
import { apiUrl } from './apiHelper';

const SEARCH_TIMEOUT_MS = 15_000;

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
    const res = await fetch(apiUrl(context, '/api/translate-search-query'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, taskId: `search-audio-${Date.now()}` }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return query;
    const data = await res.json();
    return data.translatedQuery || query;
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

        const res = await fetch(apiUrl(context, '/api/audio-search'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
        });

        if (!res.ok) {
          const text = await res.text().catch(() => '');
          const result = { success: false, message: `Audio search failed (HTTP ${res.status}): ${text}` };
          return { content: [{ type: 'text', text: JSON.stringify(result) }], details: result };
        }

        const data = await res.json();

        if (!data.success) {
          const result = { success: false, message: data.message || 'Audio search returned an error' };
          return { content: [{ type: 'text', text: JSON.stringify(result) }], details: result };
        }

        const audios: AudioSearchResult[] = data.audios || [];

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
        const message = err instanceof DOMException && err.name === 'TimeoutError'
          ? 'Audio search timed out'
          : `Audio search error: ${String(err)}`;
        const result = { success: false, message };
        return { content: [{ type: 'text', text: JSON.stringify(result) }], details: result };
      }
    },
  };
}
