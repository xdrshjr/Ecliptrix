import { Type, type Static } from '@mariozechner/pi-ai';
import type { AgentTool } from '@mariozechner/pi-agent-core';
import type { ToolContext, ScriptOperation } from '../types';
import { toolFetch, parseToolResponse } from './apiHelper';
import { scriptHash, scriptWriteSegments } from '../editorContextPrompt';
import { publishScript, scriptApiFailure } from './scriptTools';

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
  if (!/^##\s+\d+\.\s+/m.test(content)) return [{ index: 0, title: 'Script', scriptText: content }];
  const segments = content.split(/(?=^##\s+\d+\.\s+)/m).filter(s => s.trim()).map((part, index) => {
    const heading = part.match(/^##\s+\d+\.\s+([^\n]*)\n?/);
    return { index, title: heading?.[1].trim() || 'Script', scriptText: heading ? part.slice(heading[0].length).trim() : part };
  });

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

    execute: async (toolCallId, params: Params, signal) => {
      const baselineHash = scriptHash(_context.scriptSegments);
      // 使用当前结构化快照，省略 outline 不会重新解析原稿身份或旁白。
      const outline = params.outline ?? scriptWriteSegments(_context.scriptSegments).map((s, i) => `## ${i + 1}. ${s.title}\n\n${s.scriptText}`).join('\n\n');
      if (!outline.trim()) {
        const err = {
          success: false,
          error: 'No outline provided. Please provide an outline or pass the current script content.',
        };
        return { content: [{ type: 'text', text: JSON.stringify(err) }], details: err };
      }

      try {
        // Parse the outline into segments for per-scene expansion
        const current = scriptWriteSegments(_context.scriptSegments);
        const parsed = parseScriptToSegments(outline);
        const matchesCurrent = !params.outline || (parsed.length === current.length && parsed.every((s, i) => s.scriptText === current[i].scriptText || s.scriptText === current[i].narrationText));
        const segments: Array<Extract<ScriptOperation, { type: 'set_script_with_narration' }>['segments'][number] & { id: string; index: number }> = matchesCurrent ? current.map((s, index) => ({ ...s, index }))
          : parsed.map(s => ({ ...s, id: `agent-segment-${crypto.randomUUID()}`, narrationText: s.scriptText }));

        // Expand each segment via the expand API, tracking per-segment errors
        const expandedSegments = [...segments];
        const segmentErrors: Array<{ index: number; title: string; reason: string; error_code?: string; error_details?: Record<string, unknown> }> = [];
        let successCount = 0;

        for (let i = 0; i < segments.length; i++) {
          signal?.throwIfAborted();
          _context.abortSignal?.throwIfAborted();
          const seg = segments[i];
          const otherSegments = segments
            .filter((_, idx) => idx !== i)
            .map(s => ({ index: s.index, title: s.title, scriptText: s.scriptText }));

          try {
            const response = await toolFetch(_context, '/api/ai-video-script-expand', {
              method: 'POST',
              timeout: 60_000, retry: false, signal,
              body: JSON.stringify({
                taskId: `agent-expand-${Date.now()}-${i}`,
                segmentIndex: seg.index,
                segmentTitle: seg.title,
                segmentText: seg.scriptText,
                otherSegments,
              }),
            });

            if (!response.ok) {
              const failure = await scriptApiFailure(response);
              segmentErrors.push({
                index: i,
                title: seg.title,
                reason: failure.error, error_code: failure.error_code, error_details: failure.error_details,
              });
              if (failure.error_details.failure_class === 'configuration' || response.status === 429) {
                for (let j = i + 1; j < segments.length; j++) segmentErrors.push({ index: j, title: segments[j].title,
                  reason: failure.error, error_code: failure.error_code, error_details: { ...failure.error_details, skipped: true } });
                break;
              }
              continue;
            }

            const data = await parseToolResponse<{
              success: boolean;
              expandedText?: string;
            }>(response);

            if (data.success && 'expandedText' in data && data.expandedText) {
              expandedSegments[i] = { ...seg, scriptText: data.expandedText, sentences: undefined };
              successCount++;
            } else {
              segmentErrors.push({
                index: i,
                title: seg.title,
                reason: 'Expansion returned empty or unsuccessful result',
              });
            }
          } catch (error) {
            if (signal?.aborted || _context.abortSignal?.aborted) throw error;
            const isTimeout = error instanceof DOMException && error.name === 'TimeoutError';
            segmentErrors.push({
              index: i,
              title: seg.title,
              reason: isTimeout ? 'Timed out after 60s' : (error instanceof Error ? error.message : String(error)),
            });
          }
        }

        // Reassemble full script content
        const fullContent = expandedSegments
          .map((seg, i) => `## ${i + 1}. ${seg.title}\n\n${seg.scriptText}`)
          .join('\n\n');

        signal?.throwIfAborted();
        _context.abortSignal?.throwIfAborted();
        if (successCount > 0) publishScript(_context, toolCallId, expandedSegments, baselineHash);

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
          ...(successCount === 0 && segmentErrors[0]?.error_code ? { error_code: segmentErrors[0].error_code, error_details: segmentErrors[0].error_details } : {}),
          ...(successCount > 0 ? { source: 'server_snapshot', persisted: false, application: 'pending_client', hash: scriptHash(_context.scriptSegments) } : {}),
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
          error_code: signal?.aborted || _context.abortSignal?.aborted ? 'SCRIPT_CANCELLED' : error instanceof Error && error.message === 'SCRIPT_CONFLICT' ? 'SCRIPT_CONFLICT' : 'SCRIPT_EXPANSION_FAILED',
          error: isTimeout
            ? 'Script expansion timed out after 60s'
            : `Script expansion failed: ${error instanceof Error ? error.message : String(error)}`,
        };
        return { content: [{ type: 'text', text: JSON.stringify(err) }], details: err };
      }
    },
  };
}
