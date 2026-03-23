import { Type, type Static } from '@mariozechner/pi-ai';
import type { AgentTool } from '@mariozechner/pi-agent-core';
import type { ToolContext } from '../types';
import type { MaterialItem } from '@/types';

const parameters = Type.Object({
  url: Type.String({ description: 'URL of the material to add' }),
  name: Type.String({ description: 'Display name for the material' }),
  type: Type.Union(
    [Type.Literal('video'), Type.Literal('image'), Type.Literal('audio')],
    { description: 'Material type: video, image, or audio' }
  ),
  metadata: Type.Optional(
    Type.Object(
      {
        duration: Type.Optional(Type.Number({ description: 'Duration in seconds (video/audio)' })),
        width: Type.Optional(Type.Number({ description: 'Width in pixels (video/image)' })),
        height: Type.Optional(Type.Number({ description: 'Height in pixels (video/image)' })),
        format: Type.Optional(Type.String({ description: 'File format (e.g. mp4, jpg, mp3)' })),
        description: Type.Optional(Type.String({ description: 'Description of the material' })),
      },
      { description: 'Optional metadata for the material' }
    )
  ),
});
type Params = Static<typeof parameters>;

function generateMaterialId(): string {
  return `material-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function inferFormat(url: string, type: string): string {
  try {
    const pathname = new URL(url).pathname;
    const ext = pathname.split('.').pop()?.toLowerCase();
    if (ext && ext.length <= 5) return ext;
  } catch {
    // Not a valid URL; fall through to defaults.
  }
  const defaults: Record<string, string> = { video: 'mp4', image: 'jpg', audio: 'mp3' };
  return defaults[type] ?? 'unknown';
}

export function createAddMaterialToLibraryTool(context: ToolContext): AgentTool<typeof parameters> {
  return {
    name: 'add_material_to_library',
    label: 'Add Material to Library',
    description:
      'Add an external material to the material library by URL. Supports video, image, and audio. Use this when a user provides a media URL or when you have a URL from a previous workflow step.',
    parameters,

    execute: async (toolCallId, params: Params) => {
      const id = generateMaterialId();
      const format = params.metadata?.format ?? inferFormat(params.url, params.type);

      const item: MaterialItem = {
        id,
        name: params.name,
        type: params.type,
        url: params.url,
        format,
        size: 0,
        createdAt: new Date(),
        ...(params.metadata?.duration != null && { duration: params.metadata.duration }),
        ...(params.metadata?.width != null && { width: params.metadata.width }),
        ...(params.metadata?.height != null && { height: params.metadata.height }),
        ...(params.metadata?.description != null && { description: params.metadata.description }),
      };

      // Add to the live context array so subsequent tools in the same turn
      // can see the newly added material.
      context.materials.push(item);

      // Record operation for client-side store update via SSE
      context.recordOperation(toolCallId, { type: 'add_material', material: item });

      const result = {
        success: true,
        material: { id, name: item.name, type: item.type, url: item.url },
        message: `Material "${item.name}" added to library.`,
      };

      return {
        content: [{ type: 'text', text: JSON.stringify(result) }],
        details: result,
      };
    },
  };
}
