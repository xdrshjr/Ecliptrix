import { http } from '@/lib/api/http-client';

/** Pack type union covering both the existing image-pack router
 *  (``storyboard | character | scene``) and the newer frame-pack router
 *  (``frame``). HTTP-wise ``listImagePacks`` only ever fetches the first
 *  three — frame packs go through ``framePack.ts``. The union is widened
 *  here so the frontend pack-rendering components can switch on a single
 *  literal across all four kinds. */
export type ImagePackType = 'storyboard' | 'character' | 'scene' | 'frame';

export interface ImagePackFrame {
  index: number;
  filename: string;
  url: string;
  row: number;
  col: number;
  sub_view?: string | null;
  description?: string | null;
  timestamp_sec?: number | null;
  width?: number | null;
  height?: number | null;
}

export interface ImagePack {
  pack_id: string;
  pack_type: ImagePackType;
  prompt: string;
  grid_size: string;
  aspect_ratio: string;
  frame_count: number;
  sub_views: string[];
  created_at: string;
  original_image_url: string;
  reference_image_url?: string | null;
  frames: ImagePackFrame[];
  /** Frame-pack-only metadata; absent for storyboard / character / scene. */
  source_material_id?: string | null;
  source_material_name?: string | null;
  source_duration_sec?: number | null;
}

interface ListEnvelope {
  success?: boolean;
  message?: string;
  data?: ImagePack[];
}

interface DetailEnvelope {
  success?: boolean;
  message?: string;
  data?: ImagePack | null;
}

interface BaseEnvelope {
  success?: boolean;
  message?: string;
}

/** Pack types backed by the unified ``/api/image-pack/*`` HTTP router. Frame
 *  packs are served by a separate ``/api/frame-pack/*`` router (see
 *  ``framePack.ts``) so they're excluded here at the function-signature
 *  level. */
export type LegacyImagePackType = Exclude<ImagePackType, 'frame'>;

export async function listImagePacks(type: LegacyImagePackType): Promise<ImagePack[]> {
  const data = await http.get<ListEnvelope>(`/api/image-pack/${type}/list`);
  if (!data.success) {
    throw new Error(data.message || `Failed to list ${type} packs`);
  }
  return data.data || [];
}

export async function getImagePack(type: LegacyImagePackType, packId: string): Promise<ImagePack | null> {
  const data = await http.get<DetailEnvelope>(`/api/image-pack/${type}/${packId}`);
  if (!data.success) {
    throw new Error(data.message || `Failed to load ${type} pack`);
  }
  return data.data || null;
}

export async function deleteImagePack(type: LegacyImagePackType, packId: string): Promise<void> {
  const data = await http.del<BaseEnvelope>(`/api/image-pack/${type}/${packId}`);
  if (!data.success) {
    throw new Error(data.message || `Failed to delete ${type} pack`);
  }
}
