import { Type, type Static } from '@mariozechner/pi-ai';
import type { AgentTool } from '@mariozechner/pi-agent-core';
import type { ToolContext } from '../types';
import type { AsyncTask } from '@/stores/slices/asyncTaskSlice';
import { toolFetch, parseToolResponse } from './apiHelper';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_VOICE_TYPE = 'zh_female_shuangkuaisisi_moon_bigtts';
const MAX_SEGMENTS = 50;

// ---------------------------------------------------------------------------
// Parameters
// ---------------------------------------------------------------------------

const segmentSchema = Type.Object({
  text: Type.String({ description: 'Text content for this segment' }),
  voice_type: Type.Optional(
    Type.String({ description: 'Voice ID override for this segment. Available: zh_female_shuangkuaisisi_moon_bigtts, zh_male_shaonianzixin_moon_bigtts, zh_female_tianmeixiaoyuan_moon_bigtts, en_female_anna_mars_bigtts' }),
  ),
});

const parameters = Type.Object({
  segments: Type.Array(segmentSchema, {
    description: 'Array of text segments to convert. Each may specify its own voice_type.',
  }),
  speed: Type.Optional(
    Type.Number({
      description: 'Speech speed multiplier (0.5–2.0). Applied to all segments. Default: 1.0',
    }),
  ),
});

type Params = Static<typeof parameters>;

// ---------------------------------------------------------------------------
// Tool factory
// ---------------------------------------------------------------------------

export function createBatchGenerateTtsTool(context: ToolContext): AgentTool<typeof parameters> {
  return {
    name: 'batch_generate_tts',
    label: 'Batch Generate TTS',
    description:
      'Batch-convert multiple text segments to speech. Each segment produces an independent audio file. Suitable for script paragraphs. Returns a taskId for tracking progress.',
    parameters,

    execute: async (toolCallId, params: Params) => {
      // --- Validate segments ---
      if (!params.segments || params.segments.length === 0) {
        const err = { success: false, error: 'Segments array must not be empty' };
        return { content: [{ type: 'text', text: JSON.stringify(err) }], details: err };
      }

      if (params.segments.length > MAX_SEGMENTS) {
        const err = {
          success: false,
          error: `Too many segments (max ${MAX_SEGMENTS}, got ${params.segments.length})`,
        };
        return { content: [{ type: 'text', text: JSON.stringify(err) }], details: err };
      }

      // Filter out empty texts
      const validSegments = params.segments.filter((s) => s.text?.trim());
      if (validSegments.length === 0) {
        const err = { success: false, error: 'All segments have empty text' };
        return { content: [{ type: 'text', text: JSON.stringify(err) }], details: err };
      }

      // --- Validate & default optional params ---
      const speed = clamp(params.speed ?? 1.0, 0.5, 2.0);

      // Determine the primary voice type (first segment's or default)
      const primaryVoice = validSegments[0].voice_type || DEFAULT_VOICE_TYPE;

      // Build request segments with segment_id
      const taskId = `batch-tts-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const requestSegments = validSegments.map((seg, idx) => ({
        segment_id: `${taskId}-seg-${idx}`,
        text: seg.text.trim(),
        voice_type: seg.voice_type || primaryVoice,
      }));

      // --- Record async task operation for client-side store ---
      const task: AsyncTask = {
        taskId,
        type: 'batch_tts',
        status: 'pending',
        progress: 0,
        result: null,
        error: null,
        createdAt: Date.now(),
        metadata: {
          totalSegments: validSegments.length,
          voiceType: primaryVoice,
          speed,
        },
      };
      context.recordOperation(toolCallId, { type: 'start_async_task', task });

      // --- Call batch TTS API ---
      try {
        const response = await toolFetch(context, '/api/tts/batch-convert', {
          method: 'POST',
          timeout: 120_000,
          body: JSON.stringify({
            segments: requestSegments,
            voice_type: primaryVoice,
            speed_ratio: speed,
            task_id: taskId,
          }),
        });

        if (!response.ok) {
          let detail = '';
          try {
            detail = await response.text();
          } catch {
            // ignore read errors
          }
          const err = {
            success: false,
            taskId,
            error: `Batch TTS service unavailable (HTTP ${response.status})${detail ? `: ${detail.slice(0, 200)}` : ''}`,
          };
          return { content: [{ type: 'text', text: JSON.stringify(err) }], details: err };
        }

        const result = await parseToolResponse<{
          success: boolean;
          message?: string;
          data?: {
            results?: Array<{
              success: boolean;
              segment_id: string;
              audio_url?: string;
              duration?: number;
            }>;
          };
        }>(response);

        if (!result.success) {
          const err = {
            success: false,
            taskId,
            error: ('message' in result && result.message) || ('error' in result && (result as { error: string }).error) || 'Batch TTS conversion failed',
          };
          return { content: [{ type: 'text', text: JSON.stringify(err) }], details: err };
        }

        // The batch API returns results synchronously — process them now.
        const batchData = 'data' in result ? result.data : undefined;
        const successfulResults: Array<{ segmentId: string; audioUrl: string }> = [];
        const batchMaterials: Array<{
          id: string;
          name: string;
          type: 'audio';
          format: string;
          size: number;
          duration: number;
          url: string;
          serverUrl: string;
          createdAt: Date;
          tags: string[];
          description: string;
        }> = [];

        if (batchData?.results && Array.isArray(batchData.results)) {
          for (const segResult of batchData.results) {
            if (segResult.success && segResult.audio_url) {
              successfulResults.push({
                segmentId: segResult.segment_id,
                audioUrl: segResult.audio_url,
              });

              // Find the original text for the name
              const originalSeg = requestSegments.find(
                (s) => s.segment_id === segResult.segment_id,
              );
              const segText = originalSeg?.text || '';
              const displayName =
                segText.length > 25 ? `TTS: ${segText.slice(0, 22)}...` : `TTS: ${segText}`;
              const materialId = `tts-${segResult.segment_id}`;

              const batchMaterial = {
                id: materialId,
                name: displayName,
                type: 'audio' as const,
                format: 'mp3',
                size: 0,
                duration: segResult.duration ?? 0,
                url: segResult.audio_url,
                serverUrl: segResult.audio_url,
                createdAt: new Date(),
                tags: ['tts', 'generated', 'batch'],
                description: `Batch TTS segment: "${segText.slice(0, 80)}"`,
              };
              batchMaterials.push(batchMaterial);
              context.materials.push(batchMaterial);
            }
          }
        }

        // Record add_materials operation for all generated materials
        if (batchMaterials.length > 0) {
          context.recordOperation(toolCallId, { type: 'add_materials', materials: batchMaterials });
        }

        const payload = {
          success: true,
          taskId,
          total_segments: validSegments.length,
          successful_segments: successfulResults.length,
          failed_segments: validSegments.length - successfulResults.length,
          message: `Batch TTS completed: ${successfulResults.length}/${validSegments.length} segments generated successfully`,
        };

        return {
          content: [{ type: 'text', text: JSON.stringify(payload) }],
          details: payload,
        };
      } catch (error) {
        const isTimeout =
          error instanceof DOMException && error.name === 'TimeoutError';
        const errorMessage = isTimeout
          ? 'Batch TTS request timed out after 120 seconds'
          : `Batch TTS request failed: ${error instanceof Error ? error.message : String(error)}`;
        const err = { success: false, taskId, error: errorMessage };
        return { content: [{ type: 'text', text: JSON.stringify(err) }], details: err };
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
