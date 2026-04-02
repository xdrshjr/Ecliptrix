import { Type, type Static } from '@mariozechner/pi-ai';
import type { AgentTool } from '@mariozechner/pi-agent-core';
import type { ToolContext } from '../types';
import { apiUrl } from './apiHelper';

// ---------------------------------------------------------------------------
// Parameters
// ---------------------------------------------------------------------------

const parameters = Type.Object({
  topic: Type.String({ description: 'Video topic or brief description for script generation' }),
  style: Type.Optional(
    Type.String({ description: 'Script style, e.g. "教程", "Vlog", "纪录片", "短视频"' }),
  ),
  duration_target: Type.Optional(
    Type.Number({ description: 'Target video duration in seconds' }),
  ),
  language: Type.Optional(
    Type.Union([Type.Literal('zh'), Type.Literal('en'), Type.Literal('mixed')], {
      description: 'Output language (default: "zh")',
    }),
  ),
  additional_requirements: Type.Optional(
    Type.String({ description: 'Additional requirements for the script' }),
  ),
});

type Params = Static<typeof parameters>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Map the tool's language shorthand to the API's language config value. */
function mapLanguage(lang?: string): 'chinese' | 'english' | 'mixed' {
  if (lang === 'en') return 'english';
  if (lang === 'mixed') return 'mixed';
  return 'chinese';
}

/** Estimate speech duration from character/word count (rough heuristic). */
function estimateDuration(text: string): number {
  // Chinese: ~4 chars/sec; English: ~2.5 words/sec
  const chineseChars = (text.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g) || []).length;
  const nonChinese = text.length - chineseChars;
  const estimatedWords = nonChinese / 5; // rough chars-to-words
  return Math.round(chineseChars / 4 + estimatedWords / 2.5);
}

// ---------------------------------------------------------------------------
// Tool factory
// ---------------------------------------------------------------------------

export function createGenerateVideoScriptTool(context: ToolContext): AgentTool<typeof parameters> {
  return {
    name: 'generate_video_script',
    label: 'Generate Video Script',
    description:
      'Generate an AI video script from a topic/description. The script appears in the Script panel in real time. Returns a content preview, word count, and estimated duration.',
    parameters,

    execute: async (toolCallId, params: Params) => {
      const topic = params.topic?.trim();
      if (!topic) {
        const err = { success: false, error: 'Topic must not be empty' };
        return { content: [{ type: 'text', text: JSON.stringify(err) }], details: err };
      }

      try {
        // Build custom prompt from tool params
        const parts: string[] = [`主题: ${topic}`];
        if (params.style) parts.push(`风格: ${params.style}`);
        if (params.duration_target) parts.push(`目标时长: ${params.duration_target}秒`);
        if (params.additional_requirements) parts.push(`额外要求: ${params.additional_requirements}`);
        const customPrompt = parts.join('\n');

        const language = mapLanguage(params.language);
        const segmentCount = params.duration_target
          ? Math.max(3, Math.min(10, Math.round(params.duration_target / 10)))
          : 5;

        // Call the script generation API
        const response = await fetch(apiUrl(context, '/api/ai-video-script-generation'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            taskId: `agent-script-${Date.now()}`,
            customPrompt,
            durationTarget: params.duration_target,
            scriptConfig: {
              language,
              consistency: 'moderate',
              segmentCount,
              customRequirements: params.additional_requirements || '',
            },
          }),
        });

        if (!response.ok) {
          const text = await response.text().catch(() => '');
          const err = { success: false, error: `Script generation failed (HTTP ${response.status}): ${text}` };
          return { content: [{ type: 'text', text: JSON.stringify(err) }], details: err };
        }

        const data = await response.json();

        if (!data.success || !data.segments) {
          const err = { success: false, error: data.error || 'Script generation returned invalid data' };
          return { content: [{ type: 'text', text: JSON.stringify(err) }], details: err };
        }

        // Build full script content from segments
        const segments: Array<{ title: string; scriptText: string }> = data.segments;
        const fullContent = segments
          .map((seg, i) => `## ${i + 1}. ${seg.title}\n\n${seg.scriptText}`)
          .join('\n\n');

        // Record operation for client-side store update
        context.recordOperation(toolCallId, {
          type: 'set_script',
          content: fullContent,
          scriptType: 'ai_generated',
        });

        // Compute summary metrics
        const wordCount = fullContent.length;
        const estimatedDuration = estimateDuration(fullContent);
        const preview =
          fullContent.length > 200 ? fullContent.slice(0, 200) + '...' : fullContent;

        const result = {
          success: true,
          script: {
            content_preview: preview,
            word_count: wordCount,
            estimated_duration: estimatedDuration,
            segment_count: segments.length,
          },
          message: `Generated ${segments.length}-scene script (${wordCount} chars, ~${estimatedDuration}s)`,
        };

        return {
          content: [{ type: 'text', text: JSON.stringify(result) }],
          details: result,
        };
      } catch (error) {
        const err = {
          success: false,
          error: `Script generation failed: ${error instanceof Error ? error.message : String(error)}`,
        };
        return { content: [{ type: 'text', text: JSON.stringify(err) }], details: err };
      }
    },
  };
}
