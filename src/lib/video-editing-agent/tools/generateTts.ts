import { Type, type Static } from '@mariozechner/pi-ai';
import type { AgentTool } from '@mariozechner/pi-agent-core';
import type { ToolContext } from '../types';
import { apiUrl } from './apiHelper';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_VOICE_TYPE = 'zh_female_shuangkuaisisi_moon_bigtts';
const MAX_TEXT_LENGTH = 5000;

// ---------------------------------------------------------------------------
// Parameters
// ---------------------------------------------------------------------------

const parameters = Type.Object({
  text: Type.String({ description: 'The text to convert to speech' }),
  voice_type: Type.Optional(
    Type.String({
      description:
        'Voice ID. Popular options: zh_female_shuangkuaisisi_moon_bigtts, zh_male_chunhou_moon_bigtts, zh_female_tianmei_moon_bigtts, en_female_arabellaexpressive, en_male_caleb. Defaults to zh_female_shuangkuaisisi_moon_bigtts.',
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

      // --- Call TTS API ---
      try {
        const response = await fetch(apiUrl(context, '/api/tts/convert'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text,
            voice_type: voiceType,
            speed_ratio: speed,
          }),
        });

        if (!response.ok) {
          const err = {
            success: false,
            error: `TTS service unavailable (HTTP ${response.status})`,
          };
          return { content: [{ type: 'text', text: JSON.stringify(err) }], details: err };
        }

        const result = await response.json();

        if (!result.success || !result.data?.audio_url) {
          const err = {
            success: false,
            error: result.message || 'TTS conversion failed',
          };
          return { content: [{ type: 'text', text: JSON.stringify(err) }], details: err };
        }

        // --- Build MaterialItem and record operation ---
        const audioUrl: string = result.data.audio_url;
        const duration: number = result.data.duration || 0;
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
        const err = {
          success: false,
          error: `TTS request failed: ${error instanceof Error ? error.message : String(error)}`,
        };
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
