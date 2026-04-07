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
}

export interface ArkImageResult {
  image_url: string;
  local_url?: string;
  width: number;
  height: number;
}

interface ArkImageGenerateEnvelope {
  success?: boolean;
  message?: string;
  images?: ArkImageResult[];
}

export async function generateArkImages(params: ArkImageGenerateParams): Promise<ArkImageResult[]> {
  const data = await http.post<ArkImageGenerateEnvelope>(
    '/api/ark-image/generate',
    params,
    { timeoutMs: 120_000 },
  );

  if (!data.success) {
    throw new Error(data.message || 'Failed to generate Ark images');
  }

  return data.images || [];
}
