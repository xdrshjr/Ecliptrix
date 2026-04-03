import { Type, type Static } from '@mariozechner/pi-ai';
import type { AgentTool } from '@mariozechner/pi-agent-core';
import type { ToolContext } from '../types';
import { toolFetch, parseToolResponse } from './apiHelper';

// ---------------------------------------------------------------------------
// Parameters
// ---------------------------------------------------------------------------

const parameters = Type.Object({
  outline: Type.Optional(
    Type.String({
      description:
        'Script outline to expand. If omitted, uses the current Script panel content.',
    }),
  ),
  expansion_type: Type.Optional(
    Type.Union([Type.Literal('full'), Type.Literal('section')], {
      description: 'Expansion scope: "full" (entire script) or "section" (single section). Default: "full".',
    }),
  ),
  target_word_count: Type.Optional(
    Type.Number({ description: 'Target word/character count for the expanded script' }),
  ),
});

type Params = Static<typeof parameters>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Parse simple markdown-style script content into segment objects.
 * Expects headings like "## 1. Title" followed by body text.
 */
function parseScriptToSegments(
  content: string,
): Array<{ index: number; title: string; scriptText: string }> {
  const segments: Array<{ index: number; title: string; scriptText: string }> = [];
  // Split on markdown headings: ## N. Title
  const parts = content.split(/^##\s+\d+\.\s+/m).filter(Boolean);

  for (let i = 0; i < parts.length; i++) {
    const lines = parts[i].trim().split('\n');
    const title = lines[0]?.trim() || `Scene ${i + 1}`;
    const scriptText = lines.slice(1).join('\n').trim();
    segments.push({ index: i, title, scriptText });
  }

  // Fallback: if no headings found, treat entire content as one segment
  if (segments.length === 0 && content.trim()) {
    segments.push({ index: 0, title: 'Script', scriptText: content.trim() });
  }

  return segments;
}

/** Estimate speech duration from character/word count (rough heuristic). */
function estimateDuration(text: string): number {
  const chineseChars = (text.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g) || []).length;
  const nonChinese = text.length - chineseChars;
  const estimatedWords = nonChinese / 5;
  return Math.round(chineseChars / 4 + estimatedWords / 2.5);
}

// ---------------------------------------------------------------------------
// Tool factory
// ---------------------------------------------------------------------------

export function createExpandVideoScriptTool(_context: ToolContext): AgentTool<typeof parameters> {
  return {
    name: 'expand_video_script',
    label: 'Expand Video Script',
    description:
      'Expand a brief script outline into a full, detailed video script. If no outline is provided, expands the current Script panel content. Results are written back to the Script panel.',
    parameters,

    execute: async (toolCallId, params: Params) => {
      // Resolve the source outline
      // Note: Without client-side store access, we require the outline to be provided.
      // The agent should pass the current script content from its context.
      const outline = params.outline?.trim();
      if (!outline) {
        const err = {
          success: false,
          error: 'No outline provided. Please provide an outline or pass the current script content.',
        };
        return { content: [{ type: 'text', text: JSON.stringify(err) }], details: err };
      }

      try {
        // Parse the outline into segments for per-scene expansion
        const segments = parseScriptToSegments(outline);

        // Expand each segment via the expand API, tracking per-segment errors
        const expandedSegments: Array<{ title: string; expandedText: string }> = [];
        const segmentErrors: Array<{ index: number; title: string; reason: string }> = [];
        let successCount = 0;

        for (let i = 0; i < segments.length; i++) {
          const seg = segments[i];
          const otherSegments = segments
            .filter((_, idx) => idx !== i)
            .map(s => ({ index: s.index, title: s.title, scriptText: s.scriptText }));

          try {
            const response = await toolFetch(_context, '/api/ai-video-script-expand', {
              method: 'POST',
              timeout: 60_000,
              body: JSON.stringify({
                taskId: `agent-expand-${Date.now()}-${i}`,
                segmentIndex: seg.index,
                segmentTitle: seg.title,
                segmentText: seg.scriptText,
                otherSegments,
              }),
            });

            if (!response.ok) {
              let detail = '';
              try { detail = await response.text(); } catch { /* ignore */ }
              segmentErrors.push({
                index: i,
                title: seg.title,
                reason: `HTTP ${response.status}${detail ? `: ${detail.slice(0, 100)}` : ''}`,
              });
              expandedSegments.push({ title: seg.title, expandedText: seg.scriptText });
              continue;
            }

            const data = await parseToolResponse<{
              success: boolean;
              expandedText?: string;
            }>(response);

            if (data.success && 'expandedText' in data && data.expandedText) {
              expandedSegments.push({ title: seg.title, expandedText: data.expandedText });
              successCount++;
            } else {
              segmentErrors.push({
                index: i,
                title: seg.title,
                reason: 'Expansion returned empty or unsuccessful result',
              });
              expandedSegments.push({ title: seg.title, expandedText: seg.scriptText });
            }
          } catch (error) {
            const isTimeout = error instanceof DOMException && error.name === 'TimeoutError';
            segmentErrors.push({
              index: i,
              title: seg.title,
              reason: isTimeout ? 'Timed out after 60s' : (error instanceof Error ? error.message : String(error)),
            });
            expandedSegments.push({ title: seg.title, expandedText: seg.scriptText });
          }
        }

        // Reassemble full script content
        const fullContent = expandedSegments
          .map((seg, i) => `## ${i + 1}. ${seg.title}\n\n${seg.expandedText}`)
          .join('\n\n');

        // Record operation for client-side store update
        _context.recordOperation(toolCallId, {
          type: 'set_script',
          content: fullContent,
          scriptType: 'ai_generated',
        });

        const wordCount = fullContent.length;
        const estimatedDur = estimateDuration(fullContent);

        // Build result message with error details if any segments failed
        const totalSegments = segments.length;
        let message = `Expanded ${successCount}/${totalSegments} scene(s) to ${wordCount} chars (~${estimatedDur}s)`;
        if (segmentErrors.length > 0) {
          const failureDetails = segmentErrors.map(e => `Scene ${e.index + 1} "${e.title}": ${e.reason}`).join('; ');
          message += `. ${segmentErrors.length} failed: [${failureDetails}]`;
        }

        const result = {
          success: successCount > 0,
          script: {
            content_preview:
              fullContent.length > 200 ? fullContent.slice(0, 200) + '...' : fullContent,
            word_count: wordCount,
            estimated_duration: estimatedDur,
            segment_count: expandedSegments.length,
            expanded_count: successCount,
            failed_count: segmentErrors.length,
          },
          message,
          ...(segmentErrors.length > 0 ? { errors: segmentErrors } : {}),
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
            ? 'Script expansion timed out after 60s'
            : `Script expansion failed: ${error instanceof Error ? error.message : String(error)}`,
        };
        return { content: [{ type: 'text', text: JSON.stringify(err) }], details: err };
      }
    },
  };
}
