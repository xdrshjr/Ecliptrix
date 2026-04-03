import { Type, type Static } from '@mariozechner/pi-ai';
import type { AgentTool } from '@mariozechner/pi-agent-core';
import type { ToolContext } from '../types';
import { toolFetch, parseToolResponse } from './apiHelper';

// ---------------------------------------------------------------------------
// Parameters
// ---------------------------------------------------------------------------

const parameters = Type.Object({
  material_ids: Type.Optional(
    Type.Array(Type.String(), {
      description:
        'IDs of video materials to analyze. If omitted, all video materials in the library are used.',
    }),
  ),
  style: Type.Optional(
    Type.String({ description: 'Narration style, e.g. "旁白", "解说", "故事"' }),
  ),
  language: Type.Optional(
    Type.Union([Type.Literal('zh'), Type.Literal('en'), Type.Literal('mixed')], {
      description: 'Output language (default: "zh")',
    }),
  ),
});

type Params = Static<typeof parameters>;

// ---------------------------------------------------------------------------
// Tool factory
// ---------------------------------------------------------------------------

export function createUnderstandVideoScriptTool(context: ToolContext): AgentTool<typeof parameters> {
  return {
    name: 'understand_video_script',
    label: 'Understand Video Script',
    description:
      'Analyze video materials and generate a narration/commentary script that matches the video content. Results are written to the Script panel.',
    parameters,

    execute: async (toolCallId, params: Params) => {
      // Resolve target video materials
      let videoMaterials = context.materials.filter(m => m.type === 'video');

      if (params.material_ids && params.material_ids.length > 0) {
        videoMaterials = videoMaterials.filter(m => params.material_ids!.includes(m.id));
        if (videoMaterials.length === 0) {
          const err = {
            success: false,
            error: `None of the specified material IDs are video materials in the library: [${params.material_ids.join(', ')}]`,
          };
          return { content: [{ type: 'text', text: JSON.stringify(err) }], details: err };
        }
      }

      if (videoMaterials.length === 0) {
        const err = {
          success: false,
          error: 'No video materials found in the material library. Add video materials first.',
        };
        return { content: [{ type: 'text', text: JSON.stringify(err) }], details: err };
      }

      try {
        // Build selectedVideos array for the API
        const selectedVideos = videoMaterials.map(m => ({
          id: m.id,
          title: m.name,
          url: m.url ?? m.serverUrl ?? '',
          duration: m.duration ?? 0,
          analysis: m.analysisResult?.analysis || undefined,
        }));

        // Build reference text from style/language preferences
        const refParts: string[] = [];
        if (params.style) refParts.push(`解说风格: ${params.style}`);
        if (params.language === 'en') refParts.push('Output language: English');
        else if (params.language === 'mixed') refParts.push('Output language: mixed Chinese and English');
        const referenceText = refParts.join('\n');

        const language = params.language === 'en' ? 'english' : params.language === 'mixed' ? 'mixed' : 'chinese';

        const response = await toolFetch(context, '/api/video-understanding-script', {
          method: 'POST',
          timeout: 60_000,
          body: JSON.stringify({
            taskId: `agent-understand-${Date.now()}`,
            selectedVideos,
            referenceText,
            parameters: {
              language,
              style: params.style ?? 'narration',
            },
          }),
        });

        if (!response.ok) {
          let detail = '';
          try { detail = await response.text(); } catch { /* ignore read errors */ }
          const err = {
            success: false,
            error: `Video understanding script failed (HTTP ${response.status})${detail ? `: ${detail.slice(0, 200)}` : ''}`,
          };
          return { content: [{ type: 'text', text: JSON.stringify(err) }], details: err };
        }

        const data = await parseToolResponse<{
          success: boolean;
          error?: string;
          segments?: Array<{
            title?: string;
            sentences?: Array<{ text?: string }>;
            scriptText?: string;
            text?: string;
          }>;
        }>(response);

        if (!data.success) {
          const err = {
            success: false,
            error: ('error' in data && data.error) || 'Video understanding script returned an error',
          };
          return { content: [{ type: 'text', text: JSON.stringify(err) }], details: err };
        }

        // Build full script content from returned segments.
        const segments = ('segments' in data && data.segments) ? data.segments : [];

        const fullContent = segments
          .map((seg, i) => {
            const title = seg.title || `Scene ${i + 1}`;
            const text =
              seg.sentences && seg.sentences.length > 0
                ? seg.sentences.map(s => s.text || '').join('')
                : seg.scriptText || seg.text || '';
            return `## ${i + 1}. ${title}\n\n${text}`;
          })
          .join('\n\n');

        // Record operation for client-side store update
        context.recordOperation(toolCallId, {
          type: 'set_script',
          content: fullContent,
          scriptType: 'understanding',
        });

        const wordCount = fullContent.length;

        const result = {
          success: true,
          script: {
            content_preview:
              fullContent.length > 200 ? fullContent.slice(0, 200) + '...' : fullContent,
            word_count: wordCount,
            segment_count: segments.length,
            analyzed_videos: videoMaterials.length,
          },
          message: `Generated narration script from ${videoMaterials.length} video(s): ${segments.length} scene(s), ${wordCount} chars`,
        };

        return {
          content: [{ type: 'text', text: JSON.stringify(result) }],
          details: result,
        };
      } catch (error) {
        const isTimeout = error instanceof DOMException && error.name === 'TimeoutError';
        const err = {
          success: false,
          error: isTimeout
            ? 'Video understanding script timed out after 60s'
            : `Video understanding script failed: ${error instanceof Error ? error.message : String(error)}`,
        };
        return { content: [{ type: 'text', text: JSON.stringify(err) }], details: err };
      }
    },
  };
}
