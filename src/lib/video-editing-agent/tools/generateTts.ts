import { Type, type Static } from '@mariozechner/pi-ai';
import type { AgentTool } from '@mariozechner/pi-agent-core';
import type { ToolContext } from '../types';
import { toolFetch, parseToolResponse } from './apiHelper';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_VOICE_TYPE = 'zh_female_qingxinnvsheng_uranus_bigtts';
const MAX_TEXT_LENGTH = 5000;

// ---------------------------------------------------------------------------
// Parameters
// ---------------------------------------------------------------------------

const parameters = Type.Object({
  text: Type.String({ description: 'The text to convert to speech' }),
  voice_type: Type.Optional(
    Type.String({
      description:
        'Voice ID (Volcano TTS 2.0, *_uranus_bigtts). Popular options: zh_female_qingxinnvsheng_uranus_bigtts (female, default), zh_female_shuangkuaisisi_uranus_bigtts (crisp female), zh_male_shaonianzixin_uranus_bigtts (male), zh_female_tianmeixiaoyuan_uranus_bigtts (sweet female), zh_male_jieshuoxiaoming_uranus_bigtts (narrator), en_female_dacey_uranus_bigtts (English female). Use explore_tools("tts_tools") to see all available voices. Defaults to zh_female_qingxinnvsheng_uranus_bigtts.',
    }),
  ),
  speed: Type.Optional(
    Type.Number({
      description: 'Speech speed multiplier (0.5–2.0). Default: 1.0',
    }),
  ),
});

type Params = Static<typeof parameters>;

// ---------------------------------------------------------------------------
// Tool factory
// ---------------------------------------------------------------------------

export function createGenerateTtsTool(context: ToolContext): AgentTool<typeof parameters> {
  return {
    name: 'generate_tts',
    label: 'Generate TTS',
    description:
      'Convert text to speech. Supports 100+ voice types. The generated audio is automatically added to the material library.',
    parameters,

    execute: async (toolCallId, params: Params) => {
      // --- Validate text ---
      const text = params.text?.trim();
      if (!text) {
        const err = { success: false, error: 'Text must not be empty' };
        return { content: [{ type: 'text', text: JSON.stringify(err) }], details: err };
      }

      if (text.length > MAX_TEXT_LENGTH) {
        const err = {
          success: false,
          error: `Text exceeds maximum length of ${MAX_TEXT_LENGTH} characters (got ${text.length}). Use batch_generate_tts for longer content.`,
        };
        return { content: [{ type: 'text', text: JSON.stringify(err) }], details: err };
      }

      // --- Validate & default optional params ---
      const voiceType = params.voice_type || DEFAULT_VOICE_TYPE;
      const speed = clamp(params.speed ?? 1.0, 0.5, 2.0);

      // --- Call TTS API (with voice fallback) ---
      try {
        let usedVoice = voiceType;
        let result = await callTtsApi(context, text, usedVoice, speed);

        // If the requested voice failed and it's not the default, retry with default voice
        if (!result.success && usedVoice !== DEFAULT_VOICE_TYPE) {
          console.warn(`[generate_tts] Voice "${usedVoice}" failed, retrying with default voice "${DEFAULT_VOICE_TYPE}"`);
          usedVoice = DEFAULT_VOICE_TYPE;
          result = await callTtsApi(context, text, usedVoice, speed);
        }

        if (!result.success || !('data' in result) || !result.data?.audio_url) {
          const err = {
            success: false,
            error: ('message' in result && result.message) || ('error' in result && (result as { error: string }).error) || 'TTS conversion failed',
          };
          return { content: [{ type: 'text', text: JSON.stringify(err) }], details: err };
        }

        // --- Build MaterialItem and record operation ---
        const audioUrl: string = result.data.audio_url;
        const duration: number = result.data.duration ?? 0;
        const materialId = `tts-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const displayName =
          text.length > 30 ? `TTS: ${text.slice(0, 27)}...` : `TTS: ${text}`;

        const material = {
          id: materialId,
          name: displayName,
          type: 'audio' as const,
          format: 'mp3',
          size: 0,
          duration,
          url: audioUrl,
          serverUrl: audioUrl,
          createdAt: new Date(),
          tags: ['tts', 'generated'],
          description: `Generated speech: "${text.slice(0, 100)}"`,
        };

        // Push to context for same-turn visibility
        context.materials.push(material);
        context.recordOperation(toolCallId, { type: 'add_material', material });

        const payload = {
          success: true,
          material: {
            id: materialId,
            name: displayName,
            type: 'audio',
            duration,
            url: audioUrl,
            format: 'mp3',
          },
          message: `TTS audio generated successfully (${duration.toFixed(1)}s)`,
        };

        return {
          content: [{ type: 'text', text: JSON.stringify(payload) }],
          details: payload,
        };
      } catch (error) {
        const isTimeout =
          error instanceof DOMException && error.name === 'TimeoutError';
        const errorMessage = isTimeout
          ? 'TTS request timed out after 60 seconds'
          : `TTS request failed: ${error instanceof Error ? error.message : String(error)}`;
        const err = { success: false, error: errorMessage };
        return { content: [{ type: 'text', text: JSON.stringify(err) }], details: err };
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type TtsApiResult = {
  success: boolean;
  message?: string;
  error?: string;
  data?: { audio_url?: string; duration?: number };
};

async function callTtsApi(
  context: ToolContext,
  text: string,
  voiceType: string,
  speed: number,
): Promise<TtsApiResult> {
  const response = await toolFetch(context, '/api/tts/convert', {
    method: 'POST',
    timeout: 60_000,
    body: JSON.stringify({
      text,
      voice_type: voiceType,
      speed_ratio: speed,
    }),
  });

  if (!response.ok) {
    let detail = '';
    try {
      detail = await response.text();
    } catch {
      // ignore read errors
    }
    return {
      success: false,
      error: `TTS service error (HTTP ${response.status})${detail ? `: ${detail.slice(0, 200)}` : ''}`,
    };
  }

  return parseToolResponse<TtsApiResult>(response);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
