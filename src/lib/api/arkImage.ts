import { http } from '@/lib/api/http-client';

export type ArkImageSize = '1024x1024' | '2048x2048' | '1280x720' | '720x1280' | '1024x576' | '576x1024';
export type ArkImageMode = 'basic' | 'character' | 'scene';

export interface ArkImageGenerateParams {
  prompt: string;
  size: ArkImageSize;
  count: number;
  watermark: boolean;
  mode?: ArkImageMode;
  reference_image?: string;
  reference_images?: string[];
  mentioned_images?: Record<string, string>;
  grid_mode?: boolean;
  aspect_ratio?: '1:1' | '16:9' | '9:16' | '4:3' | '3:4';
}

export interface ArkImageResult {
  image_url: string;
  local_url?: string;
  width: number;
  height: number;
}

export interface ArkImagePackFrame {
  index: number;
  filename: string;
  url: string;
  row: number;
  col: number;
  sub_view?: string | null;
}

export interface ArkImagePack {
  pack_id: string;
  pack_type: 'character' | 'scene';
  prompt: string;
  grid_size: string;
  aspect_ratio: string;
  frame_count: number;
  created_at: string;
  original_image_url: string;
  reference_image_url?: string | null;
  frames: ArkImagePackFrame[];
}

interface ArkImageGenerateEnvelope {
  success?: boolean;
  message?: string;
  images?: ArkImageResult[];
  pack?: ArkImagePack | null;
}

export interface ArkImageGenerateResult {
  images: ArkImageResult[];
  pack: ArkImagePack | null;
}

export async function generateArkImages(params: ArkImageGenerateParams): Promise<ArkImageResult[]> {
  const { images } = await generateArkImagesWithPack(params);
  return images;
}

export async function generateArkImagesWithPack(
  params: ArkImageGenerateParams,
): Promise<ArkImageGenerateResult> {
  const data = await http.post<ArkImageGenerateEnvelope>(
    '/api/ark-image/generate',
    params,
    { timeoutMs: 300_000 },
  );

  if (!data.success) {
    throw new Error(data.message || 'Failed to generate Ark images');
  }

  return {
    images: data.images || [],
    pack: data.pack || null,
  };
}
